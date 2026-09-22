/* Dashboard orchestrator: pulls every layer, feeds the unified wire, drives alerts.
 *
 * Layers (all free, all key-less):
 *   1. InjuryBoard  -> ESPN structured injuries API (all 30 teams)      [primary designation source]
 *   2. News         -> ESPN NBA news API                                 [editorial, fast in-game updates]
 *   3. Social       -> Bluesky public API, verified allow-list           [reporters + official accounts]
 *   4. InGame       -> ESPN game summary API while a game is live       [in-arena absences]
 * Plus always-visible links to the OFFICIAL NBA report for manual verification.
 */
"use strict";

const App = (() => {
  const LS_SEEN = "nba-wire-seen-v1";
  const LS_FILTERS = "nba-wire-filters-v1";
  const DEFAULT_FILTERS = { team: "ALL", sevs: { out: true, doubtful: true, questionable: true, probable: false, return: false, mention: false } };

  let pollTimer = null;
  let refreshing = false;
  let pollIntervalSec = 60;
  let lastGoodNews = null;
  let newsPrimed = false;
  let newsItems = [];      // kept for the ESPN-news layer only
  let socialMirrored = new Set();

  function getSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveSeen(set) { localStorage.setItem(LS_SEEN, JSON.stringify([...set].slice(-800))); }

  function getFilters() {
    try { return Object.assign({}, DEFAULT_FILTERS, JSON.parse(localStorage.getItem(LS_FILTERS) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULT_FILTERS); }
  }
  function saveFilters(f) { localStorage.setItem(LS_FILTERS, JSON.stringify(f)); }

  /* ---------- shared classifier (ESPN news headline/description) ---------- */
  function classify(headline, desc) {
    const text = (headline + " " + (desc || "")).trim();
    for (const s of SIGNALS) if (s.re.test(text)) return { sev: s.sev, sevLabel: s.label };
    return null;
  }
  function detectTeams(headline, desc) {
    const text = (" " + headline + " " + (desc || "")).toLowerCase();
    const found = [];
    for (const t of TEAMS) {
      const aliases = TEAM_ALIASES[t.abbr] || [];
      if (aliases.some(a => text.includes(a))) found.push(t.abbr);
    }
    const upper = (" " + headline + " " + (desc || "")).toUpperCase().replace(/[^A-Z]/g, " ");
    for (const t of TEAMS) if (!found.includes(t.abbr) && upper.split(/\s+/).includes(t.abbr)) found.push(t.abbr);
    return found;
  }
  function articleUrl(a) {
    return (a.links && a.links.web && a.links.web.href) || (a.links && a.links.mobile && a.links.mobile.href) || "https://www.espn.com/nba/";
  }

  /* ---------- layer 2: ESPN news ---------- */
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

  function ingestNews(articles, isFirstLoad) {
    isFirstLoad = isFirstLoad || !newsPrimed;
    newsPrimed = true;
    const seen = getSeen();
    const fresh = [];
    for (const a of articles) {
      const headline = a.headline || "(no headline)";
      const desc = a.description || "";
      const hit = classify(headline, desc);
      if (!hit) continue;
      const id = String(a.id || a.nowId || headline);
      if (seen.has(id)) continue;
      seen.add(id);
      const teams = detectTeams(headline, desc);
      const resolved = (typeof Intelligence !== "undefined" && typeof Intelligence.resolveText === "function") ? Intelligence.resolveText(headline + " " + desc) : null;
      const ctx = (typeof Intelligence !== "undefined" && typeof Intelligence.impactContext === "function") ? Intelligence.impactContext() : {};
      const impact = (resolved && typeof LineupImpact !== "undefined")
        ? LineupImpact.assess({ player: resolved.player, playerId: resolved.playerId, team: resolved.team || teams[0], sev: hit.sev }, ctx)
        : null;
      const item = {
        id, key: "news-" + id, ts: a.published || a.lastModified || new Date().toISOString(),
        title: headline, desc, byline: a.byline || "ESPN", url: articleUrl(a),
        sev: hit.sev, sevLabel: hit.sevLabel, teams, team: (resolved && resolved.team) || teams[0] || null,
        player: resolved?.player || null, playerId: resolved?.playerId || null, impact, layer: "espn-news"
      };
      newsItems.push(item);
      /* the wire expects {text, detail} — the news object carries {title, desc}, so map explicitly
       * (a mismatch here renders "undefined" in the stream; the integration test covers it) */
      Wire.push({
        key: item.key, ts: item.ts, sev: item.sev, sevLabel: item.sevLabel, layer: "espn-news",
        text: item.title, detail: item.desc, url: item.url,
        team: teams[0] || null, player: null, source: item.byline
      });
      fresh.push(item);
    }
    saveSeen(seen);
    newsItems.sort((x, y) => new Date(y.ts || 0) - new Date(x.ts || 0));
    if (!isFirstLoad) {
      const f = getFilters();
      for (const item of fresh) {
        if (f.sevs[item.sev]) AlertEngine.fire({ ...item });
        else AlertEngine.log(`(muted by filter: ${item.sevLabel}) ${item.title}`, item.url);
      }
      AlertEngine.renderLog();
    }
    return fresh;
  }

  /* ---------- layer 1: structured injury board ---------- */
  async function runBoard(isFirstLoad) {
    try {
      const rows = await InjuryBoard.check(isFirstLoad);
      if (rows) {
        for (const r of rows) {
          Wire.push({
            key: "board-" + r.id + "-" + r.fp,
            ts: r.updated || new Date().toISOString(),
            sev: r.sev, sevLabel: r.sevLabel, layer: "espn-board",
            text: `${r.player} (${r.team}${r.position ? ", " + r.position : ""}) — ${r.status}`,
            /* lineup impact rides along with the listing it was computed from, so the wire never
             * shows a bare "Out" without saying whether it removes a starter or a depth player */
            detail: [r.shortComment, r.bodyPart ? "injury: " + r.bodyPart : "", r.returnDate ? "est. return " + r.returnDate : "",
              typeof InjuryBoard !== "undefined" && InjuryBoard.impactFor ? LineupImpact.summaryText(InjuryBoard.impactFor(r)) : ""].filter(Boolean).join(" · "),
            url: r.teamUrl, extraUrl: r.playerUrl, team: r.team, player: r.player,
            source: "ESPN injury board" + (r.fantasyStatus ? " · " + r.fantasyStatus : "")
          });
        }
      }
      return rows;
    } catch (e) {
      console.warn("injury board layer error", e);
      return null;
    }
  }

  /* ---------- layer 3: social ---------- */
  async function runSocial(isFirstLoad, force) {
    try {
      const posts = await Social.check(isFirstLoad, force);
      for (const p of posts) {
        const resolved = typeof Intelligence !== "undefined" ? Intelligence.resolveText(p.text) : null;
        const c = Social.classifyPost(p.text);
        if (!c) continue;
        const key = "social-" + p.uri + "-" + c.sev;
        if (socialMirrored.has(key)) continue;
        socialMirrored.add(key);
        Wire.push({
          key, ts: p.createdAt || p.indexedAt || new Date().toISOString(),
          sev: c.sev, sevLabel: c.sevLabel, layer: "social",
          text: `${p.name}${p.verified ? " ✓" : ""} (@${p.handle}): ${p.text.slice(0, 220)}`,
          url: p.url, extraUrl: p.account && p.account.url, team: resolved?.team || null, player: resolved?.player || null,
          source: p.account && p.account.kind === "reporter" ? (p.account.outlet || "reporter") : (p.account && p.account.kind === "official-team" ? "official team account" : "official league account")
        });
      }
      return posts;
    } catch (e) {
      console.warn("social layer error", e);
      return [];
    }
  }

  /* ---------- layer 4: in-game ---------- */
  async function runInGame(events, isFirstLoad) {
    if (!Array.isArray(events)) {
      const box = document.getElementById("ingameBox");
      if (box) box.textContent = "In-game monitor unavailable: scoreboard failed. No assertion about live games or player health.";
      return;
    }
    try {
      await InGame.check(events || [], isFirstLoad);
      for (const f of (InGame.getFindings ? InGame.getFindings() : [])) {
        Wire.push({
          key: "ingame-" + f.id, ts: new Date().toISOString(), sev: f.sev, sevLabel: f.sevLabel, layer: "in-game",
          text: `${f.player} (${f.team}) — ${f.reason} [${f.matchup}]`,
          detail: "Detected from ESPN's game summary while the game is live. DNP = did not play, reason as stated by ESPN.",
          url: f.url, player: f.player, team: f.team === "?" ? null : f.team, source: "ESPN game summary"
        });
      }
    } catch (e) { console.warn("in-game monitor error", e); }
  }

  /* ---------- scoreboard ---------- */
  function yyyymmdd(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }
  function normalizeCdn(games) {
    return (games || []).map(g => ({
      id: g.gameId || ("cdn-" + Math.random().toString(36).slice(2)),
      date: g.gameTimeUTC || null,
      links: { web: { href: "https://www.nba.com/games" } },
      competitions: [{
        status: { type: { state: g.gameStatus === 2 ? "in" : g.gameStatus === 3 ? "post" : "pre", shortDetail: String(g.gameStatusText || "") } },
        competitors: [
          { homeAway: "away", team: { abbreviation: (g.awayTeam && g.awayTeam.teamTricode) || "?" }, score: g.awayTeam && g.awayTeam.score != null ? String(g.awayTeam.score) : "" },
          { homeAway: "home", team: { abbreviation: (g.homeTeam && g.homeTeam.teamTricode) || "?" }, score: g.homeTeam && g.homeTeam.score != null ? String(g.homeTeam.score) : "" }
        ]
      }]
    }));
  }

  async function fetchScoreboard() {
    const el = document.getElementById("games");
    const srcEl = document.getElementById("gamesSrc");
    try {
      const res = await fetch(`${ENDPOINTS.scoreboard}?dates=${yyyymmdd(new Date())}`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setApiStatus("sb", true, `OK · ${(data.events || []).length} games · ${new Date().toLocaleTimeString()}`);
      if (srcEl) srcEl.innerHTML = `Source: ESPN scoreboard API · <a href="https://www.espn.com/nba/scoreboard" target="_blank" rel="noopener">open ESPN scoreboard ↗</a>`;
      renderGames(data.events || []);
      return data.events || [];
    } catch (e) {
      console.warn("ESPN scoreboard failed, trying NBA.com CDN failover", e);
      try {
        const res = await fetch(ENDPOINTS.nbaCdnScoreboard, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const games = (data.scoreboard && data.scoreboard.games) || [];
        const events = normalizeCdn(games);
        if (!events.length && !Array.isArray(games)) throw new Error("unexpected CDN payload");
        setApiStatus("sb", true, `⚠ ESPN failed — NBA.com CDN failover · ${events.length} games · ${new Date().toLocaleTimeString()} (untested path — cross-check ESPN)`);
        if (srcEl) srcEl.innerHTML = `Source: NBA.com CDN (experimental failover — unverified; cross-check <a href="https://www.espn.com/nba/scoreboard" target="_blank" rel="noopener">ESPN ↗</a> or <a href="https://www.nba.com/scores" target="_blank" rel="noopener">nba.com/scores ↗</a>)`;
        renderGames(events);
        return events;
      } catch (e2) {
        setApiStatus("sb", false, "failed (ESPN: " + e.message + "; CDN: " + e2.message + ")");
        if (el) el.innerHTML = `<div class="muted small">Scoreboard unavailable from both feeds. Manual review: <a href="https://www.espn.com/nba/scoreboard" target="_blank" rel="noopener">ESPN scoreboard</a> · <a href="https://www.nba.com/scores" target="_blank" rel="noopener">nba.com/scores</a></div>`;
        return null;
      }
    }
  }

  function renderGames(events) {
    const el = document.getElementById("games");
    if (!el) return;
    if (!events.length) {
      el.innerHTML = `<div class="muted">No games returned for today. No live-game coverage can be validated in this refresh. <a href="https://www.nba.com/schedule" target="_blank" rel="noopener">NBA schedule ↗</a></div>`;
      return;
    }
    el.innerHTML = events.map(ev => {
      const comp = (ev.competitions || [])[0] || {};
      const cs = (comp.competitors || []).slice();
      const away = cs.find(c => c.homeAway === "away") || {};
      const home = cs.find(c => c.homeAway === "home") || {};
      const st = (comp.status && comp.status.type) || {};
      const state = st.state || "pre";
      const detail = (comp.status && (st.shortDetail || st.detail)) || ev.date;
      const when = ev.date ? new Date(ev.date).toLocaleString() : "";
      const matchup = `${(away.team && away.team.abbreviation) || "?"} @ ${(home.team && home.team.abbreviation) || "?"}`;
      const score = (state === "in" || state === "post") ? `${away.score != null ? away.score : ""} – ${home.score != null ? home.score : ""}` : when;
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

  /* ---------- refresh ---------- */
  async function refresh(isFirstLoad, opts) {
    if (refreshing) return;
    refreshing = true;
    opts = opts || {};
    try {
      await Promise.all([
        fetchNews().then(arts => { if (arts) ingestNews(arts, isFirstLoad); }),
        runBoard(isFirstLoad),
        runSocial(isFirstLoad, !!opts.forceSocial),
        fetchScoreboard().then(events => runInGame(events, isFirstLoad)),
        typeof Intelligence !== "undefined" ? Intelligence.refresh(isFirstLoad) : Promise.resolve()
      ]);
      Wire.render([]);
      const upd = document.getElementById("lastUpdated");
      if (upd) upd.textContent = "Last refresh attempt: " + new Date().toLocaleString();
    } finally { refreshing = false; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => refresh(false), pollIntervalSec * 1000);
    const el = document.getElementById("pollState");
    if (el) el.textContent = `Auto-refresh every ${pollIntervalSec}s · ON`;
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------- filters UI ---------- */
  function buildTeamFilter() {
    const sel = document.getElementById("teamFilter");
    if (!sel) return;
    sel.innerHTML = `<option value="ALL">All teams</option>` +
      TEAMS.map(t => `<option value="${t.abbr}">${t.abbr} — ${t.city} ${t.name}</option>`).join("");
    sel.value = getFilters().team;
    sel.addEventListener("change", () => {
      const f = getFilters(); f.team = sel.value; saveFilters(f); Wire.render([]); InjuryBoard.render(); Social.renderFeed();
    });
  }
  function buildSevChecks() {
    const box = document.getElementById("sevChecks");
    if (!box) return;
    const f = getFilters();
    const defs = [["out", "OUT"], ["doubtful", "DOUBTFUL"], ["questionable", "QUESTIONABLE / QTR"], ["probable", "PROBABLE"], ["return", "RETURN/GOOD"], ["mention", "MENTIONS"]];
    box.innerHTML = defs.map(([k, label]) =>
      `<label><input type="checkbox" data-sev="${k}"${f.sevs[k] ? " checked" : ""}> ${label}</label>`).join("");
    box.querySelectorAll("input").forEach(inp => inp.addEventListener("change", () => {
      const ff = getFilters(); ff.sevs[inp.dataset.sev] = inp.checked; saveFilters(ff); Wire.render([]); InjuryBoard.render(); Social.renderFeed();
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
      <td><a href="https://bsky.app/search?q=${encodeURIComponent(t.city + " " + t.name)}" target="_blank" rel="noopener">Bluesky search ↗</a></td>
    </tr>`).join("");
  }

  function wireControls() {
    const t = document.getElementById("soundToggle");
    if (t) {
      t.checked = AlertEngine.isSoundOn();
      const paint = () => {
        const s = document.getElementById("soundState");
        if (s) s.textContent = t.checked ? "ON — you will hear the chime on new qualifying alerts" : "OFF — silent (log + browser notifications only)";
      };
      t.addEventListener("change", () => { AlertEngine.setSoundOn(t.checked); paint(); });
      paint();
    }
    const relay = document.getElementById("relayToggle");
    if (relay) {
      relay.checked = Social.isRelayOn();
      const paintRelay = () => {
        const s = document.getElementById("relayState");
        if (s) s.textContent = relay.checked
          ? "ON — if the browser blocks public.api.bsky.app directly, requests are routed through the third-party api.allorigins.win relay (only Bluesky public data passes through; nothing about you is sent)."
          : "OFF — direct browser access only. If the social panel says 'unreachable', tick this box.";
      };
      relay.addEventListener("change", () => { Social.setRelay(relay.checked); paintRelay(); });
      paintRelay();
    }
  }

  function init() {
    buildTeamFilter();
    buildSevChecks();
    buildTeamsTable();
    wireControls();
    AlertEngine.renderLog();

    const testBtn = document.getElementById("testSound");
    if (testBtn) testBtn.addEventListener("click", () => {
      const ok = AlertEngine.testSound();
      testBtn.textContent = ok ? "🔔 Playing chime…" : "⚠ Audio unavailable";
      setTimeout(() => { testBtn.textContent = "▶ Test sound"; }, 1400);
    });
    /* The high-impact voice is a SEPARATE button on purpose: a user must be able to hear exactly
     * what a ⚡HIGH LINEUP IMPACT absence sounds like before trusting the alert. */
    const hiBtn = document.getElementById("testHighImpactSound");
    if (hiBtn) hiBtn.addEventListener("click", () => {
      const ok = AlertEngine.testHighImpactSound();
      hiBtn.textContent = ok ? "🔔⚡ Playing high-impact chime…" : "⚠ Audio unavailable";
      setTimeout(() => { hiBtn.textContent = "▶⚡ Test high-impact sound"; }, 1400);
    });
    const liveAlertBtn = document.getElementById("testLiveAlertBtn");
    if (liveAlertBtn) liveAlertBtn.addEventListener("click", () => {
      const res = AlertEngine.testLiveAlert();
      liveAlertBtn.textContent = res.delivered ? "Synthetic test delivered" : "Test silent — check filters";
      setTimeout(() => { liveAlertBtn.textContent = "▶ Test synthetic alert (OUT / QTR)"; }, 1500);
    });
    const bSearch = document.getElementById("boardSearch");
    if (bSearch) {
      bSearch.addEventListener("input", () => {
        if (typeof InjuryBoard !== "undefined" && InjuryBoard.setSearch) {
          InjuryBoard.setSearch(bSearch.value);
        }
      });
    }
    const bReset = document.getElementById("boardResetFilter");
    if (bReset) {
      bReset.addEventListener("click", () => {
        if (typeof InjuryBoard !== "undefined" && InjuryBoard.resetFilter) {
          InjuryBoard.resetFilter();
        }
      });
    }
    if (typeof document !== "undefined" && document.querySelectorAll) {
      document.querySelectorAll(".board-tab[data-board-status]").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".board-tab[data-board-status]").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          if (typeof InjuryBoard !== "undefined" && InjuryBoard.setStatusFilter) {
            InjuryBoard.setStatusFilter(tab.dataset.boardStatus);
          }
        });
      });
      /* Lineup-impact filter: independent of the status filter, so "everyone OUT" and
       * "everything HIGH impact" can be read separately. */
      document.querySelectorAll(".impact-tab[data-impact-filter]").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".impact-tab[data-impact-filter]").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          if (typeof InjuryBoard !== "undefined" && InjuryBoard.setImpactFilter) {
            InjuryBoard.setImpactFilter(tab.dataset.impactFilter);
          }
        });
      });
      /* View mode switcher: Basketball Monster Player News vs Team-by-Team Grid */
      document.querySelectorAll(".view-tab[data-board-view]").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".view-tab[data-board-view]").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          if (typeof InjuryBoard !== "undefined" && InjuryBoard.setView) {
            InjuryBoard.setView(tab.dataset.boardView);
          }
        });
      });
    }
    const wireMarkRead = document.getElementById("wireMarkRead");
    if (wireMarkRead) wireMarkRead.addEventListener("click", () => Wire.markRead());
    const wireClear = document.getElementById("wireClear");
    if (wireClear) wireClear.addEventListener("click", () => Wire.clear());
    const testFeeds = document.getElementById("testFeeds");
    if (testFeeds) testFeeds.addEventListener("click", async () => {
      testFeeds.disabled = true; testFeeds.textContent = "Testing…";
      await Social.testFeeds();
      testFeeds.disabled = false; testFeeds.textContent = "🔎 Test feeds";
    });
    const socialNow = document.getElementById("socialNow");
    if (socialNow) socialNow.addEventListener("click", async () => {
      socialNow.disabled = true; socialNow.textContent = "Polling…";
      await runSocial(false, true);
      Wire.render([]);
      socialNow.disabled = false; socialNow.textContent = "↻ Poll social now";
    });
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
      localStorage.removeItem(LS_SEEN);
      newsItems = []; socialMirrored = new Set();
      if (typeof InGame !== "undefined") InGame.resetSeen();
      if (typeof InjuryBoard !== "undefined") InjuryBoard.resetSeen();
      if (typeof Social !== "undefined") Social.resetSeen();
      Wire.clear();
      AlertEngine.log("↺ Seen-history reset across every layer — next refresh re-seeds silently.", null);
      AlertEngine.renderLog(); refresh(true);
    });
    const pollSel = document.getElementById("pollSel");
    if (pollSel) pollSel.addEventListener("change", () => { pollIntervalSec = parseInt(pollSel.value, 10) || 60; startPolling(); });
    const nowBtn = document.getElementById("refreshNow");
    if (nowBtn) nowBtn.addEventListener("click", () => refresh(false));

    const strip = document.getElementById("boardTeamStrip");
    if (strip) strip.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-team]") : null;
      if (!btn) return;
      const sel = document.getElementById("teamFilter");
      const next = (sel && sel.value === btn.dataset.team) ? "ALL" : btn.dataset.team;
      if (sel) {
        sel.value = next;
        sel.dispatchEvent(new Event("change"));
      } else {
        const ff = getFilters(); ff.team = next; saveFilters(ff);
        if (typeof InjuryBoard !== "undefined") InjuryBoard.render();
      }
    });

    renderSeasonClock();
    renderInArenaSummary();
    refresh(true).then(() => startPolling());
  }

  function snapshotAgeText(generatedIso, nowMs) {
    if (!generatedIso) return null;
    const t = Date.parse(generatedIso);
    if (!Number.isFinite(t)) return null;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const ms = now - t;
    if (ms < 0) return "fresh";
    const hours = ms / 3600000;
    const days = ms / 86400000;
    if (days >= 1) return Math.floor(days) + "d " + Math.floor(hours % 24) + "h ago";
    if (hours >= 1) return Math.floor(hours) + "h " + Math.floor((ms % 3600000) / 60000) + "m ago";
    return Math.floor(ms / 60000) + "m ago";
  }

  function renderSeasonClock() {
    const el = document.getElementById("seasonClock");
    if (!el || typeof seasonClock !== "function") return;
    const clock = seasonClock();
    const esc = AlertEngine.escapeHtml;
    const nowMs = Date.now();
    const next = clock.next;
    const todayEvents = (clock.events || []).filter(e => e.state === "today");
    const todayBanner = todayEvents.length
      ? ('<div class="today-banner">🔴 LIVE TODAY — ' + todayEvents.map(e => esc(e.label)).join(" · ") +
         ' <span class="pill today" style="margin-left:6px">TODAY</span></div>')
      : "";
    const nextBit = next
      ? (next.days === 0
        ? ('<b>🔴 ' + esc(next.label) + '</b> — <span class="today-badge">LIVE TODAY</span> <span class="tiny muted">(' + esc(next.at) + ')</span>')
        : ('<b>' + esc(next.label) + '</b> in <b>' + next.days + '</b> day' + (next.days === 1 ? "" : "s") +
           ' <span class="tiny muted">(' + esc(next.at) + ')</span>'))
      : '<span class="muted">No upcoming dated gate in the calendar.</span>';
    const events = (clock.events || []).map(e => {
      let cls = e.state === "today" ? "today" : e.state === "upcoming" ? "" : "dim";
      const when = e.days == null ? "" : e.days === 0 ? "today" : e.days > 0 ? ("in " + e.days + "d") : (Math.abs(e.days) + "d ago");
      const href = (e.sources && e.sources[0] && e.sources[0].url) || "";
      const todayTag = e.state === "today" ? ' <span class="today-badge sm">TODAY</span>' : "";
      return '<span class="pill ' + cls + '">' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(e.label) + ' ↗</a>' : esc(e.label)) +
        ' · ' + esc(when) + todayTag + '</span>';
    }).join("");
    const conflict = (clock.conflicts || []).map(c =>
      '<div class="tiny muted">⚠ Tip-time conflict kept visible: ' + esc(c.a) + ' vs ' + esc(c.b) + ' — ' + esc(c.action) + '</div>'
    ).join("");
    let snapGen = null;
    try {
      if (typeof InjuryBoard !== "undefined" && InjuryBoard.lastSnapshotMeta) snapGen = InjuryBoard.lastSnapshotMeta().generated;
      else if (typeof window !== "undefined" && window.__LIVE_SNAPSHOT_GENERATED) snapGen = window.__LIVE_SNAPSHOT_GENERATED;
    } catch (e2) {}
    const age = snapGen ? snapshotAgeText(snapGen, nowMs) : null;
    const stale = age && snapGen && (nowMs - Date.parse(snapGen)) > 24 * 3600000;
    const staleLine = age
      ? ('<div class="tiny ' + (stale ? 'bad' : 'muted') + '" style="margin-top:6px">' +
         (stale ? '⚠ Snapshot stale — ' : 'Snapshot age — ') + esc(age) + ' (generated ' + esc(snapGen) + ')' +
         (stale ? ' · <a href="https://github.com/buffedlizard55-lab/NBAInjuryReport/actions" target="_blank" rel="noopener">check Actions run ↗</a>' : '') +
         '</div>')
      : "";
    el.innerHTML = todayBanner + '<div class="season-clock-next">📅 ' + nextBit +
      ' <span class="tiny muted">· calendar re-read ' + esc(clock.checkedAt) + '</span></div>' +
      '<div class="pill-row" style="margin-top:8px">' + events + '</div>' + staleLine + conflict;
    const staleEl = document.getElementById("snapshotStaleness");
    if (staleEl) {
      if (age) staleEl.innerHTML = (stale ? '⚠ <span class="bad">Snapshot stale</span> — ' : '') + 'Snapshot generated ' + esc(snapGen) + ' (' + esc(age) + ')';
      else staleEl.textContent = "";
    }
  }

  /* The dashboard's one-line view of the second verification layer. Computed from arenaCoverage()
   * in data.js, so the dashboard and reporters.html can never disagree about who is covered —
   * and the wording never rounds "13 teams have a pollable writer" up to "all 30 covered". */
  function renderInArenaSummary() {
    const el = document.getElementById("inArenaSummary");
    if (!el || typeof arenaCoverageSummary !== "function") return;
    const s = arenaCoverageSummary();
    const esc = AlertEngine.escapeHtml;
    el.innerHTML = `<span class="pill ok">✓ ${s.verifiedPollable}/30 teams: verified in-arena writer polled</span>
      <span class="pill warn">◐ ${s.bioPollable}/30: bio-verified only</span>
      <span class="pill bad">✗ ${s.officialOnly}/30: no writer account — official club channel only</span>
      <span class="pill">${s.pollableWriters} pollable accounts · ${s.blsSkyVerifiedWriters} Bluesky-verified</span>
      <span class="pill ${s.activeTeams === 30 ? "ok" : "warn"}">⏱ ${s.activeTeams}/30 have a writer who posted within ${s.dormantThresholdDays} days${s.dormantOnlyTeams.length ? " — no active writer: " + esc(s.dormantOnlyTeams.join(", ")) : ""}</span>
      <span class="tiny muted">Gaps are named per team (${esc(s.withGaps.slice(0, 6).join(", "))}${s.withGaps.length > 6 ? ", …" : ""}).</span>`;
  }

  return { init, getFilters, refresh, classify, detectTeams };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
