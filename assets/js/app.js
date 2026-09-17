/* Dashboard: live ESPN-powered injury wire + scoreboard + polling + filters. */
"use strict";

const App = (() => {
  const LS_SEEN = "nba-wire-seen-v1";
  const LS_FILTERS = "nba-wire-filters-v1";
  let wireItems = [];       // all classified injury items, newest first
  let pollTimer = null;
  let pollIntervalSec = 60;
  let lastGoodNews = null;

  function getSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveSeen(set) {
    localStorage.setItem(LS_SEEN, JSON.stringify([...set].slice(-500)));
  }

  function getFilters() {
    try {
      return Object.assign(
        { team: "ALL", sevs: { out: true, doubtful: true, questionable: true, probable: false, return: false, mention: false } },
        JSON.parse(localStorage.getItem(LS_FILTERS) || "{}")
      );
    } catch (e) {
      return { team: "ALL", sevs: { out: true, doubtful: true, questionable: true, probable: false, return: false, mention: false } };
    }
  }
  function saveFilters(f) { localStorage.setItem(LS_FILTERS, JSON.stringify(f)); }

  function classify(headline, desc) {
    const text = (headline + " " + (desc || "")).trim();
    for (const s of SIGNALS) {
      if (s.re.test(text)) return { sev: s.sev, sevLabel: s.label };
    }
    return null;
  }

  function detectTeams(headline, desc) {
    const text = (" " + headline + " " + (desc || "")).toLowerCase();
    const found = [];
    for (const t of TEAMS) {
      const aliases = TEAM_ALIASES[t.abbr] || [];
      if (aliases.some(a => text.includes(a))) found.push(t.abbr);
    }
    // bare abbreviation match (e.g. "MIA @ TOR") as a second pass
    const upper = (" " + headline + " " + (desc || "")).toUpperCase().replace(/[^A-Z]/g, " ");
    for (const t of TEAMS) {
      if (!found.includes(t.abbr) && upper.split(/\s+/).includes(t.abbr)) found.push(t.abbr);
    }
    return found;
  }

  function articleUrl(a) {
    return (a.links && a.links.web && a.links.web.href) || a.links?.mobile?.href || "https://www.espn.com/nba/";
  }

  async function fetchNews() {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(ENDPOINTS.news, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      lastGoodNews = { at: new Date().toISOString(), count: (data.articles || []).length };
      setApiStatus("news", true, `OK · ${(data.articles || []).length} articles · ${new Date().toLocaleTimeString()}`);
      return data.articles || [];
    } catch (e) {
      console.warn("news fetch failed", e);
      setApiStatus("news", false, "failed (" + (e.name === "AbortError" ? "timeout" : e.message) + ") — showing last good data");
      return null;
    } finally { clearTimeout(to); }
  }

  function ingest(articles, isFirstLoad) {
    const seen = getSeen();
    const fresh = [];
    for (const a of articles) {
      const headline = a.headline || "(no headline)";
      const desc = a.description || "";
      const hit = classify(headline, desc);
      if (!hit) continue;
      const id = String(a.id || a.nowId || headline);
      if (seen.has(id)) continue;
      const teams = detectTeams(headline, desc);
      const item = {
        id,
        title: headline,
        desc,
        byline: a.byline || "ESPN",
        published: a.published || a.lastModified || null,
        url: articleUrl(a),
        sev: hit.sev,
        sevLabel: hit.sevLabel,
        teams,
        fresh: true
      };
      fresh.push(item);
      seen.add(id);
    }
    saveSeen(seen);
    // merge: newest first by published desc
    wireItems = wireItems.concat(fresh).sort((x, y) =>
      new Date(y.published || 0) - new Date(x.published || 0));
    // alerts only for new qualifying items after first load (first load seeds silently)
    if (!isFirstLoad) {
      const f = getFilters();
      for (const item of fresh) {
        if (f.sevs[item.sev]) AlertEngine.fire(item);
        else { AlertEngine.log(`(muted by filter: ${item.sevLabel}) ${item.title}`, item.url); }
      }
      AlertEngine.renderLog();
    }
    renderWire(fresh.map(i => i.id));
  }

  function renderWire(flashIds) {
    const el = document.getElementById("wire");
    const countEl = document.getElementById("wireCount");
    if (!el) return;
    const f = getFilters();
    const flash = new Set(flashIds || []);
    const shown = wireItems.filter(i =>
      (f.team === "ALL" || i.teams.includes(f.team) || (f.team === "UNK" && i.teams.length === 0)) &&
      f.sevs[i.sev]);
    if (countEl) countEl.textContent = `${shown.length} shown · ${wireItems.length} tracked this session`;
    if (!shown.length) {
      el.innerHTML = `<div class="muted">No wire items match the current filters. ` +
        (wireItems.length ? `Try enabling more severities. ` : `The wire seeds on each refresh from ESPN's latest NBA news. `) +
        `Manual review: <a href="https://www.espn.com/nba/injuries" target="_blank" rel="noopener">ESPN injuries</a> · ` +
        `<a href="https://basketballmonster.com/playernews.aspx" target="_blank" rel="noopener">Basketball Monster</a> · ` +
        `<a href="https://official.nba.com/nba-injury-report-2025-26-season/" target="_blank" rel="noopener">Official NBA report</a></div>`;
      return;
    }
    el.innerHTML = shown.slice(0, 80).map(i => {
      const when = i.published ? new Date(i.published).toLocaleString() : "time unknown";
      const chips = i.teams.map(t => {
        const team = teamByAbbr(t);
        return `<a class="team-chip" style="border-color:${team.color}" href="${espnTeamInjuriesUrl(t)}" target="_blank" rel="noopener" title="ESPN ${team.city} ${team.name} injuries (manual review)">${t}</a>`;
      }).join("");
      return `<div class="wire-item sev-${i.sev}${flash.has(i.id) ? " flash" : ""}">
        <div class="wire-meta"><span class="tag ${i.sev}">${AlertEngine.escapeHtml(i.sevLabel)}</span>
        <span>${AlertEngine.escapeHtml(when)}</span><span>· ${AlertEngine.escapeHtml(i.byline)}</span>${chips}</div>
        <div class="wire-title">${AlertEngine.escapeHtml(i.title)}</div>
        ${i.desc ? `<p class="wire-desc">${AlertEngine.escapeHtml(i.desc)}</p>` : ""}
        <div class="wire-links"><a href="${AlertEngine.escapeHtml(i.url)}" target="_blank" rel="noopener">ESPN source ↗</a>
        <a href="${xSearchUrl(i.title.split(":")[0].slice(0, 80))}" target="_blank" rel="noopener">search X for confirmation ↗</a></div>
      </div>`;
    }).join("");
  }

  /* --- Scoreboard --- */
  function yyyymmdd(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }
  async function fetchScoreboard() {
    const el = document.getElementById("games");
    try {
      const res = await fetch(`${ENDPOINTS.scoreboard}?dates=${yyyymmdd(new Date())}`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setApiStatus("sb", true, `OK · ${(data.events || []).length} games · ${new Date().toLocaleTimeString()}`);
      renderGames(data.events || []);
    } catch (e) {
      console.warn("scoreboard failed", e);
      setApiStatus("sb", false, "failed (" + e.message + ")");
      if (el) el.innerHTML = `<div class="muted small">Scoreboard unavailable. Manual review: <a href="https://www.espn.com/nba/scoreboard" target="_blank" rel="noopener">ESPN scoreboard</a></div>`;
    }
  }
  function renderGames(events) {
    const el = document.getElementById("games");
    if (!el) return;
    if (!events.length) {
      el.innerHTML = `<div class="muted">No games today. Verified schedule notes: preseason tips <b>2026-10-03</b> (MIA @ TOR per ESPN) and opening night is <b>2026-10-20</b> — BOS@DET, PHI@NYK, OKC@SAS (per Basketball Monster). In-game alerts activate automatically once live games appear here.</div>`;
      return;
    }
    el.innerHTML = events.map(ev => {
      const comp = (ev.competitions || [])[0] || {};
      const cs = (comp.competitors || []).slice().sort((a, b) => (a.homeAway === "home" ? 1 : -1));
      const away = cs.find(c => c.homeAway === "away") || {};
      const home = cs.find(c => c.homeAway === "home") || {};
      const st = (comp.status && comp.status.type) || {};
      const state = st.state || "pre";
      const detail = (comp.status && (comp.status.type.shortDetail || comp.status.type.detail)) || ev.date;
      const when = ev.date ? new Date(ev.date).toLocaleString() : "";
      const matchup = `${away.team?.abbreviation || "?"} @ ${home.team?.abbreviation || "?"}`;
      const score = (state === "in" || state === "post") ? `${away.score ?? ""} – ${home.score ?? ""}` : when;
      const gameUrl = (ev.links && ev.links.web && ev.links.web.href) || `https://www.espn.com/nba/game/_/gameId/${ev.id}`;
      return `<div class="game${state === "in" ? " live" : ""}">
        <span class="st ${state}">${state === "in" ? "● LIVE" : state === "post" ? "FINAL" : "SCHEDULED"}</span>
        <span class="teams">${AlertEngine.escapeHtml(matchup)}</span>
        <span class="score">${AlertEngine.escapeHtml(score)}</span>
        <span class="muted small">${AlertEngine.escapeHtml(detail || "")}</span>
        <span style="margin-left:auto" class="small"><a href="${AlertEngine.escapeHtml(gameUrl)}" target="_blank" rel="noopener">ESPN game ↗</a></span>
      </div>`;
    }).join("");
  }

  function setApiStatus(which, ok, text) {
    const el = document.getElementById(which === "news" ? "newsStatus" : "sbStatus");
    if (!el) return;
    el.innerHTML = `<span class="dot ${ok ? "ok" : "bad"}"></span>${AlertEngine.escapeHtml(text)}`;
  }

  async function refresh(isFirstLoad) {
    const arts = await fetchNews();
    if (arts) ingest(arts, isFirstLoad);
    else renderWire([]);
    await fetchScoreboard();
    const upd = document.getElementById("lastUpdated");
    if (upd) upd.textContent = "Last refresh: " + new Date().toLocaleString();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => refresh(false), pollIntervalSec * 1000);
    const el = document.getElementById("pollState");
    if (el) el.textContent = `Auto-refresh every ${pollIntervalSec}s · ON`;
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* --- Filters UI --- */
  function buildTeamFilter() {
    const sel = document.getElementById("teamFilter");
    if (!sel) return;
    sel.innerHTML = `<option value="ALL">All teams</option>` +
      TEAMS.map(t => `<option value="${t.abbr}">${t.abbr} — ${t.city} ${t.name}</option>`).join("") +
      `<option value="UNK">No team detected</option>`;
    sel.value = getFilters().team;
    sel.addEventListener("change", () => {
      const f = getFilters(); f.team = sel.value; saveFilters(f); renderWire([]);
    });
  }
  function buildSevChecks() {
    const box = document.getElementById("sevChecks");
    if (!box) return;
    const f = getFilters();
    const defs = [["out", "OUT"], ["doubtful", "DOUBTFUL"], ["questionable", "QUESTIONABLE"], ["probable", "PROBABLE"], ["return", "RETURN/GOOD"], ["mention", "MENTIONS"]];
    box.innerHTML = defs.map(([k, label]) =>
      `<label><input type="checkbox" data-sev="${k}"${f.sevs[k] ? " checked" : ""}> ${label}</label>`).join("");
    box.querySelectorAll("input").forEach(inp => inp.addEventListener("change", () => {
      const ff = getFilters(); ff.sevs[inp.dataset.sev] = inp.checked; saveFilters(ff); renderWire([]);
    }));
  }
  function buildTeamsTable() {
    const el = document.getElementById("teamsTable");
    if (!el) return;
    el.innerHTML = TEAMS.map(t => `<tr>
      <td><b>${t.abbr}</b> ${AlertEngine.escapeHtml(t.city + " " + t.name)}</td>
      <td><a href="${espnTeamInjuriesUrl(t.abbr)}" target="_blank" rel="noopener">ESPN injuries ↗</a></td>
      <td><a href="${nbaTeamUrl(t.abbr)}" target="_blank" rel="noopener">NBA.com ↗</a></td>
      <td><a href="${xSearchUrl(t.city + " " + t.name + " injury")}" target="_blank" rel="noopener">X search ↗</a></td>
    </tr>`).join("");
  }

  function wireSoundToggle() {
    const t = document.getElementById("soundToggle");
    if (!t) return;
    t.checked = AlertEngine.isSoundOn();
    const paint = () => {
      const s = document.getElementById("soundState");
      if (s) s.textContent = t.checked ? "ON — you will hear the chime on new alerts" : "OFF — alerts are silent (log + notifications only)";
    };
    t.addEventListener("change", () => { AlertEngine.setSoundOn(t.checked); paint(); });
    paint();
  }

  function init() {
    buildTeamFilter();
    buildSevChecks();
    buildTeamsTable();
    wireSoundToggle();
    AlertEngine.renderLog();
    const testBtn = document.getElementById("testSound");
    if (testBtn) testBtn.addEventListener("click", () => AlertEngine.testSound());
    const notifBtn = document.getElementById("notifBtn");
    const paintNotif = () => {
      if (!notifBtn) return;
      const p = AlertEngine.notifPermission();
      notifBtn.textContent = p === "granted" ? "✓ Browser notifications enabled" : p === "unsupported" ? "Notifications not supported here" : "Enable browser notifications";
      notifBtn.disabled = (p === "granted" || p === "unsupported");
    };
    if (notifBtn) notifBtn.addEventListener("click", async () => { await AlertEngine.requestNotifPermission(); paintNotif(); });
    paintNotif();
    const clearBtn = document.getElementById("clearLog");
    if (clearBtn) clearBtn.addEventListener("click", () => AlertEngine.clearLog());
    const resetSeen = document.getElementById("resetSeen");
    if (resetSeen) resetSeen.addEventListener("click", () => {
      localStorage.removeItem(LS_SEEN); wireItems = [];
      AlertEngine.log("↺ Seen-history reset — next refresh re-seeds the wire.", null);
      AlertEngine.renderLog(); refresh(true);
    });
    const pollSel = document.getElementById("pollSel");
    if (pollSel) pollSel.addEventListener("change", () => { pollIntervalSec = parseInt(pollSel.value, 10) || 60; startPolling(); });
    const nowBtn = document.getElementById("refreshNow");
    if (nowBtn) nowBtn.addEventListener("click", () => refresh(false));
    refresh(true).then(() => startPolling());
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
