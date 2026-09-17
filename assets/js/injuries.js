/* Structured injury board — the primary injury layer.
 *
 * SOURCE (verified live 2026-09-17, see sources.html -> 'espn-injuries-api'):
 *   https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries
 *   -> { season{displayName}, injuries:[ { id, displayName:team, injuries:[ {
 *          id, status, date, shortComment, longComment,
 *          athlete:{ id, displayName, shortName, position{abbreviation}, team{abbreviation}, headshot{ href },
 *                    links:[ {rel:['playercard',...], href} ] },
 *          notes:{ items:[ { date, headline, text, source } ] },
 *          type:{ name:"INJURY_STATUS_*" }, details:{ fantasyStatus{description,abbreviation}, type, location, side, returnDate }
 *      } ] } ] }
 *   ?team=<abbr> verified working (returns one team block).
 *
 * Design rule (same as every other module here): the app never invents an injury.
 * It copies the feed's own words, keeps the feed's own status string, and links every
 * row to (a) ESPN's page for that team, (b) the official NBA injury-report page, and
 * (c) a one-click X search — so any human can re-verify in seconds.
 *
 * ALERTING: entries are keyed by ESPN's injury id + status. A NEW injury id, or a
 * status CHANGE on an existing id, raises an alert (subject to the severity filters).
 * Unchanged rows never re-alert, which is what makes this usable during a slate.
 */
"use strict";

const InjuryBoard = (() => {
  const LS_KEYS = "nba-injury-keys-v1";   // { "<id>": "<status + shortComment hash>" }
  let board = [];                          // normalized flat rows
  let primed = false;                      // first load seeds silently (no alert storm)
  const MAX_ROWS = 700;

  /* ---------- helpers ---------- */
  function athleteUrl(a) {
    const links = (a && a.links) || [];
    const pc = links.find(l => (l.rel || []).includes("playercard"));
    return (pc && pc.href) || ("https://www.espn.com/nba/player/_/id/" + ((a && a.id) || ""));
  }
  function espnTeamInjuries(abbr) {
    return "https://www.espn.com/nba/team/injuries/_/name/" + String(abbr || "").toLowerCase();
  }
  function newestNote(entry) {
    const items = (entry.notes && entry.notes.items) || [];
    return items.length ? items[0] : null;
  }
  /* A short, stable fingerprint of the row's current wording, so a re-worded comment
   * (i.e. new information) counts as an update. */
  function fingerprint(raw, status) {
    const s = String((raw && raw.shortComment) || "").slice(0, 160);
    const n = newestNote(raw);
    const h = String((n && n.headline) || "").slice(0, 120);
    return status + "|" + s + "|" + h;
  }

  /* ---------- normalization ---------- */
  function normalize(data) {
    const out = [];
    const blocks = (data && data.injuries) || [];
    for (const block of blocks) {
      const teamAbbr = (block.displayName && block.id) ? null : null; // team abbr comes off the athlete
      for (const raw of (block.injuries || [])) {
        const athlete = raw.athlete || {};
        const abbr = (athlete.team && athlete.team.abbreviation) || guessAbbrFromBlock(block);
        const statusText = String(raw.status || "");
        const typeName = (raw.type && raw.type.name) || "";
        const fantasy = (raw.details && raw.details.fantasyStatus && raw.details.fantasyStatus.description) || "";
        const norm = (typeof normalizeInjuryStatus === "function")
          ? normalizeInjuryStatus(statusText, typeName, fantasy)
          : { sev: "mention", label: statusText.toUpperCase() };
        const note = newestNote(raw);
        const d = raw.details || {};
        const bodyPart = [d.side, d.type, d.location].filter(Boolean).join(" ");
        out.push({
          id: String(raw.id || (athlete.id + "-" + statusText)),
          player: athlete.displayName || athlete.shortName || "Unknown player",
          playerId: athlete.id || null,
          position: (athlete.position && (athlete.position.abbreviation || athlete.position.displayName)) || "",
          team: abbr || "?",
          status: statusText,
          sev: norm.sev,
          sevLabel: norm.label,
          fantasyStatus: fantasy,                    // e.g. "GTD" (game-time decision)
          injuryType: d.type || "",
          injuryLocation: d.location || "",
          injurySide: d.side || "",
          returnDate: d.returnDate || "",
          bodyPart: bodyPart,
          updated: raw.date || null,                 // when the comment was last modified (feed's own field)
          shortComment: raw.shortComment || "",
          longComment: raw.longComment || "",
          noteHeadline: (note && note.headline) || "",
          noteText: (note && note.text) || "",
          noteDate: (note && note.date) || "",
          noteSource: (note && note.source) || "",
          playerUrl: athleteUrl(athlete),
          teamUrl: espnTeamInjuries(abbr),
          officialUrl: (typeof NBA_OFFICIAL_REPORT_URL !== "undefined") ? NBA_OFFICIAL_REPORT_URL : "https://official.nba.com/",
          headshot: (athlete.headshot && athlete.headshot.href) || null,
          fp: fingerprint(raw, statusText)
        });
      }
    }
    /* newest first by the feed's own updated timestamp */
    out.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
    board = out.slice(0, MAX_ROWS);
    return board;
  }
  const BLOCK_ABBR = { "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN", "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE", "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET", "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND", "LA Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX", "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS", "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS" };
  function guessAbbrFromBlock(block) {
    return BLOCK_ABBR[block && block.displayName] || null;
  }

  /* ---------- fetch ----------
   * Path 1: browser-direct to ESPN (site.web.api.espn.com).
   * Path 2: the same-origin snapshot written every run by the free GitHub Actions poller
   *         (data/live/latest.json). Same origin => CORS cannot apply, so this path always works
   *         once the workflow has run at least once. The UI reports which path was used. */
  let lastPath = "none";
  function path() { return lastPath; }

  async function fetchSnapshot() {
    try {
      const res = await fetch(ENDPOINTS.liveSnapshot + "?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const snap = await res.json();
      if (!snap || !snap.injuries || !Array.isArray(snap.injuries.rows) || !snap.injuries.rows.length) throw new Error("snapshot has no injury rows");
      lastPath = "snapshot " + (snap.generated || "?");
      return snap.injuries;
    } catch (e) {
      console.warn("injury snapshot unavailable", e);
      return null;
    }
  }

  async function fetchBoard(teamAbbr) {
    const url = (teamAbbr && teamAbbr !== "ALL") ? (ENDPOINTS.injuriesTeam + teamAbbr.toLowerCase()) : ENDPOINTS.injuries;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      lastPath = "espn-direct";
      return data;
    } catch (e) {
      console.warn("injury board direct fetch failed — trying same-origin snapshot", e);
      const snap = await fetchSnapshot();
      if (snap) return { season: snap.season, injuries: snap.blocks ? snap.blocks : undefined, rows: snap.rows, __snapshot: true };
      return null;
    } finally { clearTimeout(to); }
  }

  /* Snapshot rows were already normalized by tools/poll_watch.js using THIS module's rules,
   * so they are trusted as-is; we only recompute the fingerprint for alert de-duplication. */
  function normalizeFromSnapshot(rows) {
    board = rows.map(r => Object.assign({}, r, { fp: r.fp || (r.status + "|" + String(r.shortComment || "").slice(0, 160)) })).slice(0, MAX_ROWS);
    return board;
  }

  /* ---------- diffing / alerts ---------- */
  function getKeys() {
    try { return JSON.parse(localStorage.getItem(LS_KEYS) || "{}"); }
    catch (e) { return {}; }
  }
  function saveKeys(k) { localStorage.setItem(LS_KEYS, JSON.stringify(k)); }

  function diffAlerts(rows, isFirstLoad) {
    const keys = getKeys();
    const fresh = [];
    for (const r of rows) {
      const prev = keys[r.id];
      if (prev === undefined) fresh.push({ row: r, kind: "new" });
      else if (prev !== r.fp) fresh.push({ row: r, kind: "update" });
      keys[r.id] = r.fp;
    }
    /* prune keys we no longer see (feed drops resolved entries) but keep it bounded */
    const ids = new Set(rows.map(r => r.id));
    for (const k of Object.keys(keys)) if (!ids.has(k) && Object.keys(keys).length > 900) delete keys[k];
    saveKeys(keys);

    if (!primed) {
      primed = true;
      if (fresh.length) {
        AlertEngine.log(`🏥 Injury board seeded ${fresh.length} existing listing(s) silently (no alert storm on first load).`, null);
        AlertEngine.renderLog();
      }
      return;
    }
    if (isFirstLoad) return;

    const f = (typeof App !== "undefined" && App.getFilters) ? App.getFilters() : null;
    for (const item of fresh) {
      const r = item.row;
      const sevOn = f ? !!f.sevs[r.sev] : (r.sev === "out" || r.sev === "doubtful" || r.sev === "questionable");
      const teamOn = f ? (f.team === "ALL" || f.team === r.team) : true;
      const title = `${item.kind === "new" ? "NEW" : "STATUS CHANGE"} · ${r.player} (${r.team}, ${r.position || "—"}) — ${r.status}` +
        (r.fantasyStatus ? ` [${r.fantasyStatus}]` : "") +
        (r.bodyPart ? ` · ${r.bodyPart}` : "") +
        (r.returnDate ? ` · est. return ${r.returnDate}` : "");
      if (sevOn && teamOn) {
        AlertEngine.fire({ sev: r.sev, sevLabel: r.sevLabel + " · ESPN injury board", title, url: r.teamUrl, extraUrl: r.playerUrl });
      } else {
        AlertEngine.log(`(muted by filter: ${r.sevLabel}) ${title}`, r.teamUrl);
      }
    }
    if (fresh.length) AlertEngine.renderLog();
  }

  /* ---------- render ---------- */
  function render(rows) {
    const countEl = document.getElementById("boardCount");
    const el = document.getElementById("injuryBoard");
    if (countEl) countEl.textContent = `${rows.length} listings · ${new Set(rows.map(r => r.team)).size} teams`;
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="muted">No injury listings returned. Manual review:
        <a href="https://www.espn.com/nba/injuries" target="_blank" rel="noopener">ESPN injuries ↗</a> ·
        <a href="${NBA_OFFICIAL_REPORT_URL}" target="_blank" rel="noopener">official NBA report ↗</a></div>`;
      return;
    }
    const byTeam = {};
    for (const r of rows) (byTeam[r.team] = byTeam[r.team] || []).push(r);
    const order = (typeof TEAMS !== "undefined") ? TEAMS.map(t => t.abbr) : Object.keys(byTeam);
    const teams = Object.keys(byTeam).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    el.innerHTML = teams.map(abbr => {
      const team = (typeof teamByAbbr === "function") ? teamByAbbr(abbr) : null;
      const list = byTeam[abbr].map(r => {
        const when = r.updated ? new Date(r.updated).toLocaleString() : "date not stated";
        const extras = [r.fantasyStatus ? `fantasy: ${r.fantasyStatus}` : "", r.bodyPart, r.returnDate ? "est. return " + r.returnDate : ""].filter(Boolean).join(" · ");
        return `<div class="board-row">
          <span class="tag ${r.sev}">${AlertEngine.escapeHtml(r.sevLabel)}</span>
          <span class="board-player"><a href="${AlertEngine.escapeHtml(r.playerUrl)}" target="_blank" rel="noopener">${AlertEngine.escapeHtml(r.player)}</a>
            <span class="tiny muted">${AlertEngine.escapeHtml(r.position || "")}</span></span>
          <span class="board-status tiny muted">${AlertEngine.escapeHtml(r.status || "—")}${extras ? " · " + AlertEngine.escapeHtml(extras) : ""} · updated ${AlertEngine.escapeHtml(when)}</span>
          ${r.shortComment ? `<div class="board-comment">${AlertEngine.escapeHtml(r.shortComment)}
            ${r.noteSource ? `<span class="tiny muted">— ${AlertEngine.escapeHtml(r.noteSource)}${r.noteDate ? ", " + AlertEngine.escapeHtml(new Date(r.noteDate).toLocaleDateString()) : ""}</span>` : ""}</div>` : ""}
          <div class="wire-links tiny">
            <a href="${AlertEngine.escapeHtml(r.playerUrl)}" target="_blank" rel="noopener">ESPN player ↗</a>
            <a href="${xSearchUrl(r.player + " injury")}" target="_blank" rel="noopener">confirm on X ↗</a>
          </div>
        </div>`;
      }).join("");
      return `<details class="board-team" ${byTeam[abbr].some(r => r.sev === "out") ? "open" : ""}>
        <summary><b>${AlertEngine.escapeHtml(abbr)}</b> ${AlertEngine.escapeHtml(team ? (team.city + " " + team.name) : "")}
          <span class="tiny muted">${byTeam[abbr].length} listing(s)</span>
          <a class="tiny" href="${espnTeamInjuries(abbr)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">ESPN team page ↗</a>
        </summary>${list}</details>`;
    }).join("");
  }

  /* ---------- orchestration (called by App.refresh) ---------- */
  async function check(isFirstLoad) {
    const data = await fetchBoard("ALL");
    const statusEl = document.getElementById("boardStatus");
    if (!data) {
      if (statusEl) statusEl.innerHTML = `<span class="dot bad"></span>injury board unreachable — manual review links below`;
      return null;
    }
    const rows = data.__snapshot ? normalizeFromSnapshot(data.rows) : normalize(data);
    const season = (data.season && data.season.displayName) || "season not stated";
    if (statusEl) {
      statusEl.innerHTML = `<span class="dot ok"></span>OK · ${rows.length} listings · ${season} · via <b>${AlertEngine.escapeHtml(path())}</b> · ${new Date().toLocaleTimeString()}`;
    }
    const seasonEl = document.getElementById("boardSeason");
    if (seasonEl) seasonEl.textContent = season;
    if (isFirstLoad && rows.length) {
      /* keep localStorage-free seed semantics identical to other layers */
    }
    diffAlerts(rows, isFirstLoad);
    render(rows);
    return rows;
  }

  function resetSeen() { localStorage.removeItem(LS_KEYS); primed = false; }

  return { check, normalize, render, fetchBoard, diffAlerts, resetSeen, getRows: () => board, fingerprint, path };
})();
