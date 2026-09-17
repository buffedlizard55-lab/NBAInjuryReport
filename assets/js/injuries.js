/* =====================================================================================
 * injuries.js — STRUCTURED injury board (all 30 teams)
 *
 * Source: ESPN's site API injuries endpoint (keyless, verified live twice on 2026-09-17):
 *   https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries
 *   https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries?team=mia
 *
 * This is a different class of data from the news wire: every row arrives with a status, an
 * injury type/side, a game-time-decision flag, an estimated return date and a sourced comment.
 * So the board reports instead of guessing, and it alerts on CHANGES — new listing, status
 * change, return-date change — which is what a beat reporter actually needs to see.
 *
 * Honest limits, surfaced in the UI:
 *   - ESPN is a public but unofficial endpoint; it is one of 21 sources on sources.html.
 *     Nothing here is presented as a league designation.
 *   - ESPN returns its OWN abbreviations for six clubs (GS/NO/NY/SA/UTAH/WSH — observed live in
 *     the first CI snapshot). standardAbbr() in data.js normalises them; without it those teams'
 *     chips, filters and review links silently break.
 *   - The payload's season block says 2026-27 Preseason while still carrying July Summer League
 *     items. Both are rendered with their own dates and never relabelled.
 *
 * Fallback path: if the browser cannot reach ESPN (CORS/offline), the same-origin snapshot
 * data/live/latest.json written by the GitHub Actions poller is used instead. The status line
 * always states which path produced the rows.
 * ===================================================================================== */
const InjuryBoard = (function () {
  const KEY = "nba-injury-seen-v1";

  let rows = [], season = "", fetchedAt = null, path = null, error = null;

  const LS = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }
  };

  const esc = (typeof AlertEngine !== "undefined" && AlertEngine.escapeHtml)
    ? AlertEngine.escapeHtml
    : (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  function fp(row) {
    return [row.status, row.bodyPart || "", row.returnDate || "", row.fantasyStatus || ""].join("|");
  }

  /* ---------- lineup impact (never medical severity) ----------
   * Context comes from the same-origin evidence files (data/live/context.json + the exits map in
   * data/live/intelligence.json). With no context the answer is "unknown", never a guess. */
  let injectedContext = null;                       // used by the CI poller, which has no DOM/Intelligence
  function setImpactContext(ctx) { injectedContext = ctx || null; return true; }
  function impactContext() {
    if (typeof Intelligence !== "undefined" && Intelligence.impactContext) {
      const c = Intelligence.impactContext();
      if (c) return c;
    }
    return injectedContext;
  }
  function impactFor(row) {
    if (typeof LineupImpact === "undefined") return null;
    const ctx = impactContext() || {};
    if (row && row._impact && row._impactKey === row.fp && row._impactCtx === ctx) return row._impact;  // cached per listing per context load
    const a = LineupImpact.assess(row, ctx);
    if (row) { row._impact = a; row._impactKey = row.fp; row._impactCtx = ctx; }
    return a;
  }

  /* ---------- normalization ---------- */

  function teamOf(block, athlete) {
    const raw = (athlete && athlete.team && athlete.team.abbreviation) ||
      (block && (block.abbreviation || block.shortDisplayName)) || "";
    const abbr = (typeof standardAbbr === "function") ? standardAbbr(raw) : String(raw).toUpperCase();
    const team = (typeof teamByAbbr === "function") ? teamByAbbr(abbr) : null;
    return { abbr: abbr, name: (team && (team.city + " " + team.name)) || (block && block.displayName) || null };
  }

  function normalize(payload) {
    const out = [];
    const blocks = (payload && payload.injuries) || [];
    for (const block of blocks) {
      for (const inj of (block.injuries || [])) {
        const a = inj.athlete || {};
        const det = inj.details || {};
        const note = ((inj.notes && inj.notes.items) || [])[0] || {};
        const t = teamOf(block, a);
        const status = String(inj.status || "Unknown");
        const norm = (typeof normalizeInjuryStatus === "function")
          ? normalizeInjuryStatus(status, (inj.type && inj.type.name) || "", (det.fantasyStatus && det.fantasyStatus.description) || "")
          : { sev: "mention", label: status };
        const links = a.links || [];
        const card = links.filter(l => (l.rel || []).indexOf("playercard") >= 0)[0] || links[0] || null;
        const row = {
          id: String(inj.id || ((a.id || a.displayName || "?") + "-" + status)),
          player: a.displayName || "Unknown player",
          playerId: a.id || ((card && card.href || "").match(/\/id\/(\d+)/) || [])[1] || null,
          position: (a.position && a.position.abbreviation) || null,
          team: t.abbr,
          teamName: t.name,
          status: status,
          sev: norm.sev,
          sevLabel: norm.label,
          updated: inj.date || note.date || null,
          returnDate: det.returnDate || null,
          fantasyStatus: (det.fantasyStatus && det.fantasyStatus.description) || null,
          injuryType: det.type || null,
          injuryLocation: det.location || null,
          injurySide: det.side || null,
          bodyPart: [det.side, det.type, det.location].filter(Boolean).join(" ") || null,
          shortComment: inj.shortComment || note.headline || "",
          longComment: inj.longComment || note.text || "",
          noteHeadline: note.headline || null,
          noteText: note.text || null,
          noteDate: note.date || null,
          noteSource: note.source || null,
          headshot: (a.headshot && a.headshot.href) || null,
          playerUrl: (card && card.href) || null,
          teamUrl: (typeof espnTeamInjuriesUrl === "function") ? espnTeamInjuriesUrl(t.abbr) : null,
          officialUrl: (typeof NBA_OFFICIAL_REPORT_URL !== "undefined") ? NBA_OFFICIAL_REPORT_URL : "https://official.nba.com/",
          searchUrl: (typeof xSearchUrl === "function") ? xSearchUrl(row_query(a.displayName)) : null
        };
        row.fp = fp(row);
        out.push(row);
      }
    }
    // newest-first, exactly as the feed dates them
    out.sort((x, y) => new Date(y.updated || 0) - new Date(x.updated || 0));
    return out;
  }
  function row_query(name) { return String(name || "") + " injury"; }

  /* ---------- fetch: direct -> same-origin CI snapshot ---------- */

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async function fetchBoard() {
    try {
      const data = await fetchWithTimeout(ENDPOINTS.injuries, 15000);
      if (!Array.isArray(data.injuries)) throw new Error("invalid injuries schema");
      rows = normalize(data);
      season = (data && data.season && (data.season.displayName || data.season.name)) || "";
      fetchedAt = new Date().toISOString();
      path = "espn-direct";
      error = null;
    } catch (e1) {
      try {
        const snap = await fetchWithTimeout(ENDPOINTS.liveSnapshot, 10000);
        if (!snap || !snap.injuries || !Array.isArray(snap.injuries.rows)) throw new Error("snapshot has no rows");
        if (snap.errors?.injuries) throw new Error("collector: " + snap.errors.injuries);
        if (!AlertEngine.isFresh(snap.generated)) throw new Error("stale snapshot: " + snap.generated);
        rows = snap.injuries.rows.map(r => Object.assign({}, r, { fp: r.fp || fp(r) }));
        season = (snap.injuries.seasonRaw && snap.injuries.seasonRaw.displayName) || snap.injuries.season || "";
        fetchedAt = snap.generated || null;
        path = "ci-snapshot";
        error = null;
      } catch (e2) {
        // Keep last-good rows and baseline on failure, never interpret failure as recovery.
        error = "ESPN direct: " + e1.message + " · CI snapshot: " + e2.message +
          (String(e2.message).indexOf("404") >= 0 || String(e2.message).indexOf("Failed to fetch") >= 0
            ? " (404 usually means the Actions poller has not published data yet)" : "");
        path = null;
      }
    }
    return rows;
  }

  /* ---------- alert diffing ---------- */

  function alertFor(kind, row, extra) {
    const title = (kind === "new" ? "NEW LISTING — " : "STATUS CHANGE — ") + row.player + " (" + row.team + "): " + row.status;
    const impact = impactFor(row);
    return {
      kind: kind, sev: row.sev, sevLabel: row.sevLabel, title: title,
      impact: impact ? { tier: impact.impact, label: impact.impactLabel } : null,
      detail: [extra, typeof LineupImpact !== "undefined" ? LineupImpact.summaryText(impact) : null, row.shortComment || row.longComment,
        row.bodyPart ? "injury: " + row.bodyPart : "",
        row.returnDate ? "est. return " + row.returnDate : ""].filter(Boolean).join(" · "),
      url: row.teamUrl || row.playerUrl, reviewUrl: row.playerUrl, player: row.player, team: row.team,
      ts: row.updated || null, observedAt: new Date().toISOString(), maxAgeMs: 24 * 60 * 60 * 1000,
      alertEligible: AlertEngine.isFresh(row.updated, 24 * 60 * 60 * 1000)
    };
  }

  function saveBaseline(list, seededAt) {
    const map = {};
    for (const r of list) map[r.id] = r.fp;
    LS.set({ map: map, seededAt: seededAt || Date.now() });
  }

  /* silent=true only on first load: an alert list that fires for ~75 pre-existing listings the
   * moment the page opens is noise, and noise trains people to ignore alerts. The UI says so. */
  function diffAlerts(list, silent) {
    const store = LS.get();
    if (!store.map || !store.seededAt || silent) {
      saveBaseline(list, store.seededAt || Date.now());
      return [];
    }
    const alerts = [];
    for (const r of list) {
      const prev = store.map[r.id];
      if (prev === undefined) alerts.push(alertFor("new", r));
      else if (prev !== r.fp) {
        const parts = [];
        const [pStatus, pBody, pRet] = String(prev).split("|");
        if (pStatus !== r.status) parts.push(pStatus + " → " + r.status);
        if (pBody !== (r.bodyPart || "")) parts.push("injury: " + (r.bodyPart || "—"));
        if (pRet !== (r.returnDate || "")) parts.push("est. return " + (pRet || "—") + " → " + (r.returnDate || "—"));
        alerts.push(alertFor("change", r, parts.join(" · ")));
      }
    }
    saveBaseline(list, store.seededAt);
    if (alerts.length && typeof AlertEngine !== "undefined") {
      for (const a of alerts) AlertEngine.fire(a);
      if (AlertEngine.renderLog) AlertEngine.renderLog();
    }
    return alerts;
  }

  /* ---------- rendering ---------- */

  function ago(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }

  const SEV_ORDER = { out: 0, doubtful: 1, questionable: 2, mention: 3, probable: 4, return: 5 };
  const IMPACT_ORDER = { high: 0, medium: 1, unknown: 2, low: 3 };

  function impactShort(imp) {
    if (!imp) return "";
    if (imp.impact === "unknown") return "IMPACT: UNKNOWN";
    const role = imp.role.tier === "starter" ? "starter" : imp.role.tier === "rotation" ? "rotation" : imp.role.tier === "bench" ? "depth" : "role?";
    return imp.impact.toUpperCase() + " IMPACT · " + role;
  }
  function espnTeamDepthUrl(abbr) {
    const slug = (typeof espnAbbr === "function") ? espnAbbr(abbr) : String(abbr).toLowerCase();
    return "https://www.espn.com/nba/team/depth/_/name/" + slug;   // verified live 2026-09-17 (human page, RotoWire-supplied)
  }

  /* ---------- coverage gaps: which teams the snapshot says NOTHING about ----------
   * A board titled "every team" that quietly omits three of them invites exactly the wrong
   * inference. Observed live 2026-09-17: ESPN's injuries feed returned 27 team blocks; CLE, DET
   * and LAL had no block at all. That is a statement about the snapshot, never about the players —
   * an omitted block is not clearance, and this says so next to each team's own review link. */
  function coverageGaps(list) {
    if (typeof TEAMS === "undefined" || !Array.isArray(TEAMS)) return [];
    const snapshot = Array.isArray(list) ? list : rows;
    const present = new Set(snapshot.map(r => r && r.team).filter(Boolean));
    return TEAMS.filter(t => !present.has(t.abbr))
      .map(t => ({ abbr: t.abbr, name: t.city + " " + t.name, url: espnTeamInjuriesUrl(t.abbr), nbaUrl: nbaTeamUrl(t.abbr) }));
  }

  function renderCoverage(list) {
    const el = document.getElementById("boardCoverage");
    if (!el) return;
    const snapshot = Array.isArray(list) ? list : rows;
    if (error) {
      el.innerHTML = '<span class="muted tiny">Refresh failed, so no team-coverage statement can be made from this snapshot — ' +
        'the rows below are last-good data. <a href="https://www.espn.com/nba/injuries" target="_blank" rel="noopener">ESPN injuries ↗</a></span>';
      return;
    }
    if (!snapshot.length) {
      el.innerHTML = '<span class="muted tiny">This snapshot carries no listings at all, so no per-team coverage claim is made. ' +
        'Zero listings is not evidence that every player is healthy.</span>';
      return;
    }
    const gaps = coverageGaps(snapshot);
    const covered = TEAMS.length - gaps.length;
    el.innerHTML = gaps.length
      ? '<span class="tag warn">coverage gap</span> <b>' + covered + '/' + TEAMS.length + '</b> teams returned at least one listing in this snapshot; <b>' +
        gaps.length + '</b> returned none: ' +
        gaps.map(g => '<a href="' + esc(g.url) + '" target="_blank" rel="noopener" title="' + esc(g.name) + ' — confirm manually; absence here is not clearance">' + esc(g.abbr) + ' ↗</a>').join(", ") +
        ' <span class="muted tiny">— ESPN omitting a team block is NOT evidence that nobody on it is injured. Each link opens that team\'s own ESPN injuries page.</span>'
      : '<span class="good">all ' + TEAMS.length + ' teams returned at least one listing in this snapshot</span>' +
        ' <span class="muted tiny">— still not clearance: a block with no rows is not a verified-healthy roster.</span>';
  }

  let boardSearchQuery = "";
  let boardStatusFilter = "ALL";

  function setSearch(q) {
    boardSearchQuery = String(q || "");
    render();
  }

  function setStatusFilter(st) {
    boardStatusFilter = String(st || "ALL");
    render();
  }

  function resetFilter() {
    boardSearchQuery = "";
    boardStatusFilter = "ALL";
    const inp = document.getElementById("boardSearch");
    if (inp) inp.value = "";
    if (typeof document !== "undefined" && document.querySelectorAll) {
      document.querySelectorAll(".board-tab").forEach(t => t.classList.toggle("active", t.dataset.boardStatus === "ALL"));
    }
    render();
  }

  function render(filters) {
    const box = document.getElementById("injuryBoard");
    if (!box) return;
    const f = filters || (typeof App !== "undefined" && App.getFilters ? App.getFilters() : null);

    const searchInput = document.getElementById("boardSearch");
    const q = (searchInput && searchInput.value ? searchInput.value : boardSearchQuery).trim().toLowerCase();

    const counts = { ALL: rows.length, out: 0, doubtful: 0, questionable: 0, probable: 0, return: 0 };
    for (const r of rows) {
      if (counts[r.sev] !== undefined) counts[r.sev]++;
    }
    const cAll = document.getElementById("countAll"); if (cAll) cAll.textContent = counts.ALL;
    const cOut = document.getElementById("countOut"); if (cOut) cOut.textContent = counts.out;
    const cDtf = document.getElementById("countDtf"); if (cDtf) cDtf.textContent = counts.doubtful;
    const cQst = document.getElementById("countQst"); if (cQst) cQst.textContent = counts.questionable;
    const cPrb = document.getElementById("countPrb"); if (cPrb) cPrb.textContent = counts.probable;
    const cRet = document.getElementById("countRet"); if (cRet) cRet.textContent = counts.return;

    const shown = rows.filter(r => {
      if (f && f.team && f.team !== "ALL" && r.team !== f.team) return false;
      if (boardStatusFilter !== "ALL" && r.sev !== boardStatusFilter) return false;
      if (boardStatusFilter === "ALL" && f && f.sevs && typeof f.sevs === "object") {
        const want = Object.keys(f.sevs).filter(k => f.sevs[k]);
        if (want.length && want.indexOf(r.sev) < 0) return false;
      }
      if (q) {
        const hay = [r.player, r.team, r.teamName, r.position, r.status, r.bodyPart, r.shortComment].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const count = document.getElementById("boardCount");
    const seasonEl = document.getElementById("boardSeason");
    const statusEl = document.getElementById("boardStatus");
    if (count) count.textContent = shown.length + (shown.length !== rows.length ? " of " + rows.length : "") + " listings";
    if (seasonEl) seasonEl.textContent = season || "—";
    if (statusEl) {
      statusEl.innerHTML = error
        ? '<span class="bad">✖ refresh failed — last-good data, alerts paused</span> · ' + esc(error)
        : 'via <b>' + esc(path || "—") + '</b>' + (fetchedAt ? ' · ' + esc(ago(fetchedAt)) : "");
    }
    /* Rendered BEFORE the "nothing matches" early return so a coverage gap is still stated when the
     * current filter hides every row. */
    renderCoverage();

    if (!shown.length) {
      box.innerHTML = error
        ? '<div class="empty">No structured board available. Tried the ESPN injuries endpoint directly, then the same-origin CI snapshot.<br><span class="tiny muted">' + esc(error) + '</span></div>'
        : '<div class="empty">No listings match the current filters' + (rows.length ? " (" + rows.length + " exist)" : "") + '.</div>';
      return;
    }

    const byTeam = {};
    for (const r of shown) (byTeam[r.team] = byTeam[r.team] || []).push(r);
    const teams = Object.keys(byTeam).sort((a, b) => {
      const wa = Math.min.apply(null, byTeam[a].map(r => SEV_ORDER[r.sev] ?? 9));
      const wb = Math.min.apply(null, byTeam[b].map(r => SEV_ORDER[r.sev] ?? 9));
      return wa - wb || a.localeCompare(b);
    });

    box.innerHTML = teams.map(team => {
      const list = byTeam[team].slice().sort((x, y) =>
        (SEV_ORDER[x.sev] ?? 9) - (SEV_ORDER[y.sev] ?? 9) || IMPACT_ORDER[(impactFor(x) || {}).impact] - IMPACT_ORDER[(impactFor(y) || {}).impact]
        || new Date(y.updated || 0) - new Date(x.updated || 0));
      return '<div class="board-team">' +
        '<div class="board-team-head"><b class="abbr">' + esc(team) + '</b>' +
        '<span class="muted tiny">' + esc(list[0].teamName || "") + ' · ' + list.length + '</span>' +
        '<a class="tiny" href="' + espnTeamDepthUrl(team) + '" target="_blank" rel="noopener">ESPN depth chart ↗</a></div>' +
        list.map(r => {
          const imp = impactFor(r);
          const listing = imp && imp.listing && imp.listing.count
            ? '<div class="br-history tiny"><b>' + (imp.listing.count > 1 ? "Injury-listing cadence" : "Dated injury listings observed") + ' (ESPN roster feed, ' + imp.listing.count + ' listing' + (imp.listing.count > 1 ? "s" : "") + ' in ~9 months):</b> ' +
              esc(imp.listing.dates.slice(-6).join(", ")) +
              (imp.listing.source ? ' · <a href="' + esc(imp.listing.source) + '" target="_blank" rel="noopener">source JSON ↗</a>' : "") +
              '<br><span class="muted">Cadence is how often the player appeared on a listing — not a medical history.</span></div>'
            : "";
          return '<div class="board-row sev-border-' + esc(r.sev) + '">' +
          '<div class="br-top"><span class="tag ' + esc(r.sev) + '">' + esc(r.sevLabel) + '</span>' +
          '<b class="br-player">' + esc(r.player) + '</b>' +
          (r.position ? '<span class="muted tiny">' + esc(r.position) + '</span>' : "") +
          (imp ? '<span class="tag impact-' + esc(imp.impact) + '" title="' + esc(imp.notes.join(" ")) + '">' + esc(impactShort(imp)) + '</span>' : "") +
          (imp && imp.exit ? '<span class="tag watch" title="Reported by a monitored account — not a league designation">IN-GAME EXIT (reported)</span>' : "") +
          (r.fantasyStatus ? '<span class="tag gtd" title="ESPN fantasy status">' + esc(r.fantasyStatus) + '</span>' : "") +
          '<span class="br-when tiny muted" title="' + esc(r.updated || "") + '">' + esc(ago(r.updated)) + '</span></div>' +
          '<div class="br-meta tiny muted">' +
          (r.bodyPart ? esc(r.bodyPart) + " · " : "") +
          (r.returnDate ? "est. return " + esc(r.returnDate) + " · " : "") +
          "Lineup impact: " + esc(imp ? imp.impactLabel : "not computed") +
          (imp && imp.role.games ? " · role from " + imp.role.starts + "/" + imp.role.games + " collected box score(s)" + (imp.role.avgMinutes != null ? ", " + imp.role.avgMinutes + " min avg" : "") + (imp.role.medianMinutes != null ? ", median " + imp.role.medianMinutes : "") : "") +
          (imp && imp.role.teamChanged ? " · ⚠ sample collected with previous team" : "") +
          (imp && imp.contract && imp.contract.label ? " · " + esc(imp.contract.label) : "") +
          " · Medical severity: not assessed · ESPN: " + esc(r.status) + (r.noteSource ? " · per " + esc(r.noteSource) : "") +
          '</div>' +
          (imp ? '<div class="br-why tiny muted">' + esc(imp.notes[0] || "") + (imp.role.evidence.length ? ' · <a href="' + esc(imp.role.evidence[0]) + '" target="_blank" rel="noopener">box-score evidence ↗</a>' : "") + '</div>' : "") +
          (r.shortComment ? '<div class="br-comment">' + esc(r.shortComment) + '</div>' : "") +
          listing +
          '<div class="br-links tiny">' +
          (r.playerUrl ? '<a href="' + esc(r.playerUrl) + '" target="_blank" rel="noopener">player page</a>' : "") +
          (r.teamUrl ? ' · <a href="' + esc(r.teamUrl) + '" target="_blank" rel="noopener">team injuries</a>' : "") +
          (r.officialUrl ? ' · <a href="' + esc(r.officialUrl) + '" target="_blank" rel="noopener">NBA report index (not row confirmation)</a>' : "") +
          (r.searchUrl ? ' · <a href="' + esc(r.searchUrl) + '" target="_blank" rel="noopener">search reporting</a>' : "") +
          '</div></div>';
        }).join("") +
        '</div>';
    }).join("");
  }

  /* ---------- entry point used by app.js ---------- */

  async function check(isFirstLoad) {
    await fetchBoard();
    if (!error) diffAlerts(rows, !!isFirstLoad);   // fires through AlertEngine (see diffAlerts)
    render();
    return rows;
  }

  function resetSeen() { saveBaseline([], Date.now()); return true; }

  return {
    check: check, normalize: normalize, diffAlerts: diffAlerts, render: render,
    fetchBoard: fetchBoard, resetSeen: resetSeen, getRows: () => rows, fp: fp,
    impactFor: impactFor, setImpactContext: setImpactContext, impactShort: impactShort, depthUrl: espnTeamDepthUrl,
    coverageGaps: coverageGaps, renderCoverage: renderCoverage,
    alertFor: alertFor, setSearch: setSearch, setStatusFilter: setStatusFilter, resetFilter: resetFilter,
    fingerprint: fp, getMeta: () => ({ path: path, error: error, fetchedAt: fetchedAt, season: season, count: rows.length })
  };
})();
