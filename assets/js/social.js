/* Social second layer — FREE, key-less, allow-list based.
 *
 * WHAT IT IS: the Bluesky / AT-Protocol public API (public.api.bsky.app) read per
 * VERIFIED account. Verified live 2026-09-17: getAuthorFeed works with no key and no
 * account; searchPosts does NOT (HTTP 403 unauthenticated) — that limitation is
 * documented in data.js FLAGS and is why this layer polls an allow-list of accounts
 * instead of searching for keywords.
 *
 * THREE TRANSPORT PATHS (in order), because browser CORS could not be proven from the
 * sandbox that built this:
 *   1. browser-direct  -> public.api.bsky.app (fastest, no third party)
 *   2. same-origin     -> data/social/latest.json, written by the free GitHub Actions
 *                         poller (tools/poll_watch.js). Same origin = CORS cannot apply.
 *   3. relay (opt-in)  -> a public CORS relay, only if the user explicitly enables it.
 * The panel prints which path each account actually used, so nothing is hidden.
 *
 * ALERTING: a post is alerted when it is new (by post URI) and matches an injury signal.
 * Posts that merely MENTION an injury are logged, not alerted — see classifyPost().
 * In-game exit language ("left the game", "locker room", "won't return", "questionable
 * to return") raises an IN-GAME EXIT WATCH alert even before any official designation,
 * clearly labelled as a social report rather than a league designation.
 */
"use strict";

const Social = (() => {
  const LS_SEEN = "nba-social-seen-v1";
  const LS_RELAY = "nba-social-relay-on";
  const LS_LAST = "nba-social-last-poll";
  const POLL_EVERY_MS = 3 * 60 * 1000;   // be polite to a free public API
  const PER_ACCOUNT_LIMIT = 20;
  const MAX_POSTS = 120;

  let posts = [];
  let accountStatus = {};
  let lastPoll = Number(localStorage.getItem(LS_LAST) || 0);
  let relayOn = localStorage.getItem(LS_RELAY) === "on";
  let primed = false;

  /* ---------- injury classification for free text ---------- */
  /* In-game exit language — the highest-latency-value signal in this whole project,
   * because it can appear SECONDS after a player walks to the locker room. */
  /* Canonical regex lives in data.js so the CI poller classifies identically to the browser. */
  const WATCH_RE = (typeof INGAME_WATCH_RE !== "undefined") ? INGAME_WATCH_RE : /\b(won'?t return|locker room|left the game|questionable to return|limping|helped off)\b/i;
  /* Hard designations */
  const DESIGNATION_RE = /\b(ruled out|officially out|out for|is out|will miss|out indefinitely|season-?ending|surgery|torn|fracture\w*|sprain\w*|strain\w*|soreness|illness|concussion|injury report|doubtful|probable|day-?to-?day|gtd|game-?time decision|questionable|available|cleared|active|will play)\b/i;

  function classifyPost(text) {
    const t = String(text || "");
    const inj = /\b(injur\w+|hurt|sore|soreness|sprain|strain|torn|fracture\w*|concussion|illness|sick|surgery|achilles|acl|mcl|meniscus|hamstring|ankle|knee|calf|groin|wrist|thumb|quad|oblique|hip|foot|leg|back|shoulder|elbow|hand|finger|toe|neck|ribs?|protocol|questionable|doubtful|probable|out|gtd|day-?to-?day|locker room|limp\w*)\b/i;
    if (!inj.test(t) && !WATCH_RE.test(t)) return null;

    /* 1. severity by the SAME ordered classifier used by the ESPN news wire */
    let sev = "mention", sevLabel = "INJURY MENTION";
    if (typeof SIGNALS !== "undefined") {
      for (const s of SIGNALS) {
        if (s.re.test(t)) { sev = s.sev; sevLabel = s.label; break; }
      }
    }
    /* 2. IN-GAME EXIT language always wins the label, because that is the single most
     *    time-critical case: a player leaving a game in progress. If the post also states a
     *    hard designation ("ruled out for the remainder of the game") severity is 'out';
     *    otherwise it is 'questionable to return'-class — both pass the default filter.
     *    The label always says it is a social report, never a league designation. */
    if (WATCH_RE.test(t)) {
      if (sev === "out") return { sev: "out", sevLabel: "OUT FOR THE GAME (in-game, social report)", kind: "ingame-watch" };
      return { sev: "questionable", sevLabel: "⚠ IN-GAME EXIT WATCH (social, unconfirmed)", kind: "ingame-watch" };
    }
    if (sev === "out" && DESIGNATION_RE.test(t)) {
      return { sev: "out", sevLabel: "OUT (social report)", kind: "designation" };
    }
    return { sev, sevLabel, kind: "mention" };
  }

  /* ---------- transport ---------- */
  function relayUrl(u) { return ENDPOINTS.corsRelay + encodeURIComponent(u); }

  async function getJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { data: await res.json(), path: "direct" };
    } finally { clearTimeout(to); }
  }

  /* Try direct, then (if enabled) relay. Returns {data, path} or throws. */
  async function getJsonWithFallback(url) {
    const tried = [];
    try { const r = await getJson(url); return r; }
    catch (e) { tried.push("direct: " + e.message); }
    if (relayOn) {
      try { const r = await getJson(relayUrl(url), 20000); r.path = "relay"; return r; }
      catch (e) { tried.push("relay: " + e.message); }
    }
    const err = new Error(tried.join(" | "));
    err.tried = tried;
    throw err;
  }

  async function getSnapshot() {
    try {
      const res = await fetch(ENDPOINTS.socialSnapshot + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) { return null; }
  }

  /* ---------- account list ---------- */
  function feedAccounts() {
    const official = (typeof SOCIAL_ACCOUNTS !== "undefined" ? SOCIAL_ACCOUNTS : []).filter(a => a.feed);
    const reporters = (typeof BSKY_REPORTERS !== "undefined" ? BSKY_REPORTERS : []).filter(a => a.feed);
    return official.concat(reporters.map(r => ({
      handle: r.handle, name: r.name, kind: "reporter", team: r.team, bskyVerified: r.bskyVerified,
      outlet: r.outlet, role: r.role, url: r.evidence
    })));
  }

  function postUrl(handle, uri) {
    const rkey = String(uri || "").split("/").pop();
    return rkey ? ("https://bsky.app/profile/" + handle + "/post/" + rkey) : ("https://bsky.app/profile/" + handle);
  }

  function normalizeFeed(data, acct) {
    const out = [];
    for (const item of ((data && data.feed) || [])) {
      const p = item.post; if (!p) continue;
      const rec = p.record || {};
      const author = p.author || {};
      const handle = author.handle || acct.handle;
      const text = String(rec.text || "").trim();
      out.push({
        uri: p.uri,
        text,
        handle,
        name: author.displayName || acct.name,
        createdAt: rec.createdAt || p.indexedAt || null,
        indexedAt: p.indexedAt || null,
        url: postUrl(handle, p.uri),
        account: acct,
        verified: !!acct.bskyVerified
      });
    }
    return out;
  }

  function getSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveSeen(set) { localStorage.setItem(LS_SEEN, JSON.stringify([...set].slice(-1200))); }

  /* ---------- alerting ---------- */
  function alertPosts(list, isFirstLoad) {
    const seen = getSeen();
    const fresh = [];
    for (const p of list) {
      if (seen.has(p.uri)) continue;
      seen.add(p.uri);
      fresh.push(p);
    }
    saveSeen(seen);

    if (!primed) {
      primed = true;
      if (fresh.length) {
        AlertEngine.log(`📡 Social layer seeded ${fresh.length} existing post(s) silently (no alert storm on first load).`, null);
        AlertEngine.renderLog();
      }
      return [];
    }
    if (isFirstLoad) return [];
    const f = (typeof App !== "undefined" && App.getFilters) ? App.getFilters() : null;
    for (const p of fresh) {
      const c = classifyPost(p.text);
      if (!c) continue;
      const where = p.account.kind === "reporter" ? `${p.account.outlet || "reporter"}` : (p.account.kind === "official-team" ? "official team account" : "official league account");
      const who = p.verified ? `${p.name} (@${p.handle}, Bluesky-verified)` : `${p.name} (@${p.handle})`;
      const title = `${c.sevLabel} · ${who} [${where}] — "${p.text.slice(0, 180)}"`;
      const allowedSev = f ? !!f.sevs[c.sev] : ["out", "doubtful", "questionable"].includes(c.sev);
      const allowedTeam = f ? (f.team === "ALL" || !p.account.team || f.team === p.account.team) : true;
      if (c.kind !== "mention" && allowedSev && allowedTeam) {
        AlertEngine.fire({ sev: c.sev, sevLabel: c.sevLabel + " · Bluesky", title, url: p.url, extraUrl: p.account.url });
      } else {
        AlertEngine.log(`(logged, not alerted: ${c.sevLabel}) ${p.name}: ${p.text.slice(0, 140)}`, p.url);
      }
    }
    AlertEngine.renderLog();
    return fresh;
  }

  /* ---------- main fetch ---------- */
  async function fetchAll(reason) {
    const accts = feedAccounts();
    const results = await Promise.all(accts.map(async acct => {
      const url = ENDPOINTS.bskyAuthorFeed + encodeURIComponent(acct.handle) + "&limit=" + PER_ACCOUNT_LIMIT;
      try {
        const { data, path } = await getJsonWithFallback(url);
        const list = normalizeFeed(data, acct);
        accountStatus[acct.handle] = { ok: true, path, count: list.length, at: new Date().toISOString(), error: null };
        return list;
      } catch (e) {
        accountStatus[acct.handle] = { ok: false, path: "failed", count: 0, at: new Date().toISOString(), error: e.message, tried: e.tried || [] };
        return [];
      }
    }));
    lastPoll = Date.now();
    localStorage.setItem(LS_LAST, String(lastPoll));
    return { posts: results.flat(), reason };
  }

  function mergeAndSort(list) {
    const byUri = {};
    for (const p of list.concat(posts)) byUri[p.uri] = p;
    posts = Object.values(byUri)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, MAX_POSTS);
    return posts;
  }

  /* ---------- render ---------- */
  function renderStatus() {
    const el = document.getElementById("socialStatus");
    if (!el) return;
    const accts = feedAccounts();
    const ok = accts.filter(a => accountStatus[a.handle] && accountStatus[a.handle].ok);
    const fail = accts.filter(a => accountStatus[a.handle] && !accountStatus[a.handle].ok);
    const paths = [...new Set(ok.map(a => accountStatus[a.handle].path))];
    const skipped = accts.filter(a => !accountStatus[a.handle]);
    let html = `<span class="dot ${ok.length ? "ok" : (fail.length ? "bad" : "warn")}"></span>`;
    html += ok.length
      ? `${ok.length}/${accts.length} verified accounts reachable via <b>${paths.join(" + ")}</b> · last poll ${new Date(lastPoll).toLocaleTimeString()}`
      : (fail.length ? `0/${accts.length} reachable — ${AlertEngine.escapeHtml(fail[0].name)}: ${AlertEngine.escapeHtml(accountStatus[fail[0].handle].error || "")}` : `not polled yet`);
    if (skipped.length) html += ` · ${skipped.length} not polled`;
    if (fail.length) html += ` · ${fail.length} failed`;
    el.innerHTML = html;

    const detail = document.getElementById("socialDetail");
    if (detail) {
      detail.innerHTML = accts.map(a => {
        const s = accountStatus[a.handle];
        const badge = s ? (s.ok ? `<span class="badge ok">${s.count} posts · ${s.path}</span>` : `<span class="badge bad">unreachable</span>`) : `<span class="badge dim">not polled</span>`;
        return `<tr><td><a href="${a.url || ("https://bsky.app/profile/" + a.handle)}" target="_blank" rel="noopener">${AlertEngine.escapeHtml(a.name)}</a>
          <br><span class="tiny muted">@${AlertEngine.escapeHtml(a.handle)}${a.outlet ? " · " + AlertEngine.escapeHtml(a.outlet) : ""}${a.role ? " · " + AlertEngine.escapeHtml(a.role) : ""}</span></td>
          <td>${a.kind === "official-league" ? "official league" : a.kind === "official-team" ? ("official team " + (a.team || "")) : "reporter/insider"}</td>
          <td>${a.bskyVerified ? '<span class="badge ok">Bluesky-verified</span>' : '<span class="badge warn">no verification object</span>'}</td>
          <td>${badge}${s && !s.ok ? `<br><span class="tiny muted">${AlertEngine.escapeHtml(s.error || "")}</span>` : ""}</td></tr>`;
      }).join("");
    }
  }

  function renderFeed() {
    const el = document.getElementById("socialFeed");
    if (!el) return;
    if (!posts.length) {
      el.innerHTML = `<div class="muted small">No posts loaded yet. Free social access needs either (a) browser access to public.api.bsky.app, or (b) the same-origin snapshot the free poller writes to <span class="kbd">data/social/latest.json</span>. Click <b>Test feeds</b> for a per-account diagnosis, or read the accounts directly via the links above.</div>`;
      return;
    }
    el.innerHTML = posts.slice(0, 40).map(p => {
      const c = classifyPost(p.text);
      const when = p.createdAt ? new Date(p.createdAt).toLocaleString() : "time unknown";
      return `<div class="post${c && c.kind === "ingame-watch" ? " watch" : ""}">
        <div class="wire-meta">
          ${c ? `<span class="tag ${c.sev}">${AlertEngine.escapeHtml(c.sevLabel)}</span>` : `<span class="tag mention">NO INJURY SIGNAL</span>`}
          <span><b>${AlertEngine.escapeHtml(p.name)}</b> @${AlertEngine.escapeHtml(p.handle)}</span>
          <span>· ${AlertEngine.escapeHtml(when)}</span>
          ${p.verified ? '<span class="badge ok">verified</span>' : ''}
          ${p.account.kind === "official-team" || p.account.kind === "official-league" ? '<span class="badge info">official</span>' : ''}
        </div>
        <div>${AlertEngine.escapeHtml(p.text).slice(0, 700)}</div>
        <div class="wire-links tiny">
          <a href="${AlertEngine.escapeHtml(p.url)}" target="_blank" rel="noopener">open post on Bluesky ↗</a>
          <a href="${xSearchUrl(p.text.split(/[.\n]/)[0].slice(0, 60))}" target="_blank" rel="noopener">find on X ↗</a>
        </div>
      </div>`;
    }).join("");
  }

  /* ---------- diagnostics ---------- */
  async function testFeeds() {
    const out = [];
    const probe = feedAccounts()[0] || { handle: "nba.com", name: "NBA" };
    const url = ENDPOINTS.bskyAuthorFeed + encodeURIComponent(probe.handle) + "&limit=1";
    try { const r = await getJson(url); out.push(`direct OK (${r.data.feed ? r.data.feed.length : 0} posts) for @${probe.handle}`); }
    catch (e) { out.push(`direct FAILED for @${probe.handle}: ${e.message}`); }
    if (relayOn) {
      try { const r = await getJson(relayUrl(url), 20000); out.push(`relay OK (${r.data.feed ? r.data.feed.length : 0} posts)`); }
      catch (e) { out.push(`relay FAILED: ${e.message}`); }
    } else { out.push("relay disabled (tick 'allow public relay' to test it)"); }
    const snap = await getSnapshot();
    out.push(snap ? `snapshot OK (generated ${snap.generated || "?"})` : "snapshot missing (data/social/latest.json not written yet — the Actions poller has not run)");
    AlertEngine.log("🔎 Social feed test → " + out.join(" · "), null);
    AlertEngine.renderLog();
    return out;
  }

  /* ---------- called by App.refresh ---------- */
  async function check(isFirstLoad, force) {
    /* Same-origin snapshot first: instant paint, and it is the only path guaranteed
     * to work regardless of CORS. Live refresh still happens on its own cadence. */
    const snap = await getSnapshot();
    if (snap && Array.isArray(snap.posts)) {
      for (const p of snap.posts) if (!accountStatus[p.handle]) accountStatus[p.handle] = { ok: true, path: "snapshot", count: 0, at: snap.generated, error: null };
      mergeAndSort(snap.posts.map(p => Object.assign({}, p, {
        url: p.url, account: p.account || { handle: p.handle, name: p.name || p.handle, kind: p.kind || "reporter", team: p.team || null, bskyVerified: !!p.verified, url: "https://bsky.app/profile/" + p.handle }
      })));
      renderFeed(); renderStatus();
    }
    const due = force || (Date.now() - lastPoll) > POLL_EVERY_MS;
    if (!due && posts.length) { renderStatus(); return posts; }

    const before = posts.length;
    const { posts: fetched } = await fetchAll(force ? "manual" : "scheduled");
    mergeAndSort(fetched);
    alertPosts(fetched, isFirstLoad || before === 0);
    renderFeed();
    renderStatus();
    return posts;
  }

  function setRelay(on) {
    relayOn = !!on;
    localStorage.setItem(LS_RELAY, relayOn ? "on" : "off");
    return relayOn;
  }
  function isRelayOn() { return relayOn; }
  function resetSeen() { localStorage.removeItem(LS_SEEN); primed = false; }

  return { check, fetchAll, classifyPost, renderFeed, renderStatus, testFeeds, setRelay, isRelayOn, resetSeen, getPosts: () => posts, feedAccounts, accountStatus: () => accountStatus, getSnapshot, INGAME_WATCH_RE: WATCH_RE };
})();
