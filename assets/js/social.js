/* =====================================================================================
 * social.js — free, keyless social layer (Bluesky / AT Protocol)
 *
 * WHY BLUESKY AND NOT X: X's API has no free read tier (~$200/mo entry), and scraping X or
 * Instagram breaks their terms. Bluesky serves a fully public, keyless HTTP API, so it is the
 * only major network where a serious-but-broke injury tracker can follow verified reporters
 * legitimately. It is NOT a replacement for X — it is a second layer, and the UI says so.
 *
 * VERIFIED LIVE 2026-09-17, no key and no account:
 *   ✅ app.bsky.feed.getAuthorFeed            (per-account posts)
 *   ✅ app.bsky.actor.searchActorsTypeahead   (handle discovery / existence check)
 *   ✅ app.bsky.graph.getList                 (members of a curated list)
 *   ✅ app.bsky.graph.getFollows              (who an account follows)
 *   ❌ app.bsky.feed.searchPosts              → HTTP 403 without auth
 * The 403 is the important one: this layer follows KNOWN accounts reliably but cannot keyword
 * search. So it polls a verified allow-list (data.js SOCIAL_ACCOUNTS + BSKY_REPORTERS, every
 * handle carrying its own evidence) instead of pretending to search.
 *
 * TWO BUGS FOUND BY REPLAYING THE FIRST LIVE CI SNAPSHOT (tools/replay_posts.js):
 *   1. getAuthorFeed also returns REPOSTS, whose author is somebody else entirely — five
 *      never-vetted accounts leaked into the layer that way. Only the account's own posts count.
 *   2. Free-form posts produced false positives: "THE VOICE IS BACK." read as an injury,
 *      "locker room culture" read as an in-game exit, a rest/roster decision read as an injury.
 *      Fixed with an explicit injury gate + vocabulary rule in data.js, validated by replay.
 *
 * REACHABILITY: three paths, in order, and the UI always states which one was used —
 *   1. direct         (browser → public.api.bsky.app; CORS could NOT be proven from the build
 *                      sandbox, which has no browser and no response headers — flagged, not hidden)
 *   2. ci-snapshot    (same-origin data/live/latest.json from the GitHub Actions poller; cannot
 *                      be blocked by CORS and needs no key, at the cost of being as fresh as the
 *                      last scheduled run)
 *   3. relay (opt-in) (public CORS relay, OFF by default, labelled wherever it is used)
 * ===================================================================================== */
const Social = (function () {
  const SEEN_KEY = "nba-social-seen-v1";
  const RELAY_KEY = "nba-social-relay";
  const ALERT_SEV = { out: true, doubtful: true, questionable: true };

  const WATCH_RE = (typeof INGAME_WATCH_RE !== "undefined") ? INGAME_WATCH_RE
    : /\b(won'?t return|will not return|head(ed|ing)? (to|for) the locker room|left the game|helped off)\b/i;
  const GATE_RE = (typeof SOCIAL_INJURY_GATE_RE !== "undefined") ? SOCIAL_INJURY_GATE_RE : /\b(injur\w+|questionable|doubtful|ruled out)\b/i;
  const VOCAB_RE = (typeof SOCIAL_INJURY_VOCAB_RE !== "undefined") ? SOCIAL_INJURY_VOCAB_RE : /(injur\w+|knee|ankle|surg\w*)/i;

  const SEV_LABEL = {
    out: "OUT (social report)", doubtful: "DOUBTFUL", questionable: "QUESTIONABLE / DAY-TO-DAY",
    probable: "PROBABLE", return: "CLEARED / RETURNING", mention: "INJURY MENTION"
  };

  let posts = [], accounts = {}, fetchedAt = null, path = null, error = null;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };

  const esc = (typeof AlertEngine !== "undefined" && AlertEngine.escapeHtml)
    ? AlertEngine.escapeHtml
    : (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  /* ---------- classification ---------- */

  function classifyPost(text) {
    const t = String(text || "");
    if (!GATE_RE.test(t) && !WATCH_RE.test(t)) return null;

    /* RULE: an injury signal requires injury VOCABULARY, or in-game exit language.
     * Availability news with no injury word — "out for rest", "will be without X tonight",
     * a rotation plan — is at most a non-injury mention. Replaying the first live CI snapshot
     * (tools/replay_posts.js) is how this rule was validated against real posts. */
    const hasVocab = VOCAB_RE.test(t);
    const isWatch = WATCH_RE.test(t);
    if (!hasVocab && !isWatch) {
      return { sev: "mention", sevLabel: "NON-INJURY (rest / roster / decision)", kind: "non-injury" };
    }

    /* IN-GAME EXIT language always wins the label and is ALWAYS marked unconfirmed: a social
     * post is not a league designation and the UI must never imply that it is. */
    if (isWatch) {
      const ord = (typeof classifySocialSeverity === "function") ? classifySocialSeverity(t) : { sev: "questionable" };
      const escalated = ord.sev === "out" || ord.sev === "doubtful";
      return {
        sev: escalated ? ord.sev : "questionable",
        sevLabel: escalated ? "OUT FOR THE GAME (in-game, social report)" : "⚠ IN-GAME EXIT WATCH (social, unconfirmed)",
        kind: "ingame-watch"
      };
    }
    const sev = (typeof classifySocialSeverity === "function") ? classifySocialSeverity(t).sev : "mention";
    return { sev: sev, sevLabel: SEV_LABEL[sev] || "INJURY MENTION", kind: sev === "mention" ? "mention" : "designation" };
  }

  /* ---------- transport ---------- */

  function isRelayOn() { return LS.get(RELAY_KEY, "0") === "1"; }
  function setRelay(on) { LS.set(RELAY_KEY, on ? "1" : "0"); }
  function wrap(url) { return isRelayOn() ? (ENDPOINTS.corsRelay + encodeURIComponent(url)) : url; }

  async function getJSON(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
      const res = await fetch(wrap(url), { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /* Both registries hold feed-enabled accounts; normalise them to one shape. */
  function feedAccounts() {
    const out = [];
    for (const a of (typeof SOCIAL_ACCOUNTS !== "undefined" ? SOCIAL_ACCOUNTS : [])) {
      if (a.feed) out.push({ handle: a.handle, name: a.name, kind: a.kind, team: a.team || null, outlet: a.outlet || null, role: a.role || null, verified: !!a.bskyVerified, url: a.url || ("https://bsky.app/profile/" + a.handle) });
    }
    for (const r of (typeof BSKY_REPORTERS !== "undefined" ? BSKY_REPORTERS : [])) {
      if (r.feed !== false) out.push({ handle: r.handle, name: r.name, kind: "reporter", team: r.team || null, outlet: r.outlet || null, role: r.role || null, verified: !!r.bskyVerified, url: r.evidence || ("https://bsky.app/profile/" + r.handle) });
    }
    return out;
  }

  /* getAuthorFeed also returns reposts, whose author is somebody else entirely. Only the
   * polled account's OWN posts belong to this layer. */
  function isOwnPost(item, handle) {
    if (!item || !item.post) return false;
    if (item.reason) return false;
    const author = (item.post.author || {}).handle;
    return !!author && author.toLowerCase() === String(handle).toLowerCase();
  }

  function normalizeFeed(data, acct) {
    const out = [];
    for (const item of ((data && data.feed) || [])) {
      if (!isOwnPost(item, acct.handle)) continue;
      const p = item.post;
      const rec = p.record || {};
      const text = String(rec.text || "");
      const cls = classifyPost(text);
      if (!cls) continue;                                  // not injury-related → dropped, not shown
      const rkey = String(p.uri || "").split("/").pop();
      out.push({
        uri: p.uri || (acct.handle + "-" + rkey),
        text: text,
        handle: acct.handle,
        name: acct.name || (p.author && p.author.displayName) || acct.handle,
        verified: !!acct.verified,
        kind: acct.kind,
        team: acct.team,
        outlet: acct.outlet,
        role: acct.role,
        accountUrl: acct.url,
        account: { url: acct.url, team: acct.team, kind: acct.kind, outlet: acct.outlet, name: acct.name },
        createdAt: rec.createdAt || p.indexedAt || null,
        indexedAt: p.indexedAt || null,
        url: "https://bsky.app/profile/" + acct.handle + "/post/" + rkey,
        sev: cls.sev,
        sevLabel: cls.sevLabel,
        inGameWatch: cls.kind === "ingame-watch",
        kindLabel: cls.kind
      });
    }
    return out;
  }

  async function fetchDirect() {
    const list = feedAccounts();
    const got = [];
    const status = {};
    for (const acct of list) {
      try {
        const data = await getJSON(ENDPOINTS.bskyAuthorFeed + encodeURIComponent(acct.handle) + "&limit=20&filter=posts_no_replies", 12000);
        const mine = normalizeFeed(data, acct);
        status[acct.handle] = { ok: true, count: mine.length, name: acct.name, kind: acct.kind, team: acct.team };
        got.push.apply(got, mine);
      } catch (e) {
        status[acct.handle] = { ok: false, error: e.message, name: acct.name, kind: acct.kind, team: acct.team };
      }
    }
    /* defensive de-duplication: one post must never be counted (or alerted) twice */
    const byUri = new Map();
    for (const p of got) if (!byUri.has(p.uri)) byUri.set(p.uri, p);
    const deduped = Array.from(byUri.values());
    const okCount = Object.values(status).filter(s => s.ok).length;
    if (list.length && okCount === 0) {
      throw new Error("all " + list.length + " author feeds failed (first: " + ((status[list[0].handle] || {}).error || "?") + ")");
    }
    return { posts: deduped, accounts: status, path: "direct", duplicatesDropped: got.length - deduped.length };
  }

  async function fetchSnapshot() {
    const snap = await getJSON(ENDPOINTS.socialSnapshot, 10000);
    if (!snap || !Array.isArray(snap.posts)) throw new Error("snapshot has no posts");
    const status = {};
    for (const row of (snap.accounts || [])) {
      status[row.handle] = { ok: !!row.ok, count: row.count || 0, error: row.error || null, name: row.name, kind: row.kind, team: row.team || null };
    }
    const got = snap.posts.map(p => Object.assign({}, p, {
      sevLabel: p.sevLabel || SEV_LABEL[p.sev] || "INJURY MENTION",
      kindLabel: p.inGameWatch ? "ingame-watch" : (p.sev === "mention" ? "mention" : "designation"),
      account: { url: p.accountUrl, team: p.team, kind: p.kind, outlet: p.outlet, name: p.name }
    }));
    return { posts: got, accounts: status, path: "ci-snapshot", generated: snap.generated };
  }

  async function fetchAll() {
    const attempts = [];
    try {
      const r = await fetchDirect();
      return Object.assign({ fetchedAt: new Date().toISOString(), error: null, relayUsed: isRelayOn() }, r);
    } catch (e1) { attempts.push("direct: " + e1.message); }
    try {
      const r = await fetchSnapshot();
      return Object.assign({ fetchedAt: r.generated || null, error: null, relayUsed: false }, r);
    } catch (e2) { attempts.push("ci-snapshot: " + e2.message); }
    return { posts: [], accounts: {}, fetchedAt: null, path: null, relayUsed: isRelayOn(), error: attempts.join(" · ") };
  }

  /* ---------- seen-state / alerts ---------- */

  function seenSet() { try { return new Set(JSON.parse(LS.get(SEEN_KEY, "[]")) || []); } catch (e) { return new Set(); } }
  function saveSeen(set) { LS.set(SEEN_KEY, JSON.stringify(Array.from(set).slice(-1200))); }

  function checkAlerts(list, isFirstLoad) {
    const seen = seenSet();
    const firstEver = seen.size === 0;
    const fresh = [];
    for (const p of list) {
      if (seen.has(p.uri)) continue;
      seen.add(p.uri);
      fresh.push(p);
    }
    saveSeen(seen);
    if (isFirstLoad || firstEver) return { alerts: [], fresh: fresh.length, first: true };
    const alerts = fresh
      .filter(p => p.inGameWatch || ALERT_SEV[p.sev])
      .map(p => ({
        kind: p.inGameWatch ? "social-ingame" : "social",
        sev: p.sev, sevLabel: p.sevLabel,
        title: (p.inGameWatch ? "IN-GAME EXIT (unconfirmed) — " : "") + p.name + (p.team ? " (" + p.team + ")" : ""),
        detail: p.text,
        url: p.url,
        source: "Bluesky · @" + p.handle + (p.outlet ? " · " + p.outlet : ""),
        ts: p.createdAt
      }));
    return { alerts: alerts, fresh: fresh.length, first: false };
  }

  function resetSeen() { saveSeen(new Set(posts.map(p => p.uri))); return posts.length; }

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

  function linkify(text) {
    return esc(text)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi, function (m, h) {
        return '<a href="https://bsky.app/profile/' + esc(h) + '" target="_blank" rel="noopener">' + esc(m) + '</a>';
      });
  }

  function renderStatus() {
    const el = document.getElementById("socialStatus");
    if (!el) return;
    const all = Object.values(accounts);
    const ok = all.filter(a => a.ok).length;
    const label = { "direct": "browser → Bluesky (direct)", "ci-snapshot": "CI snapshot (data/live/latest.json)" }[path] || "no path";
    if (error) {
      el.innerHTML = '<span class="bad">✖ social layer unavailable</span> · ' + esc(error) +
        ' · <button class="btn sm" onclick="Social.toggleRelay()">' + (isRelayOn() ? "disable relay" : "try CORS relay") + '</button>';
      return;
    }
    el.innerHTML = 'via <b>' + esc(label) + '</b>' + (isRelayOn() ? ' <span class="tag warn">relay</span>' : '') +
      ' · accounts reachable <b>' + ok + '/' + all.length + '</b>' +
      (fetchedAt ? ' · ' + esc(ago(fetchedAt)) : "") +
      (path === "ci-snapshot" ? ' <span class="muted tiny">(direct access blocked from this browser — the CI snapshot is same-origin, so it always works)</span>' : "");
  }

  function renderDetail() {
    const el = document.getElementById("socialDetail");
    if (!el) return;
    const rows = Object.entries(accounts);
    if (!rows.length) { el.innerHTML = '<span class="muted tiny">No account data yet.</span>'; return; }
    el.innerHTML = '<table class="table tiny"><thead><tr><th>account</th><th>kind</th><th>team</th><th>reachable</th><th>injury posts</th></tr></thead><tbody>' +
      rows.sort((a, b) => a[0].localeCompare(b[0])).map(([handle, a]) =>
        '<tr><td><a href="https://bsky.app/profile/' + esc(handle) + '" target="_blank" rel="noopener">@' + esc(handle) + '</a>' +
        (a.name ? '<div class="muted tiny">' + esc(a.name) + '</div>' : "") + '</td>' +
        '<td>' + esc(a.kind || "reporter") + '</td><td>' + esc(a.team || "—") + '</td>' +
        '<td>' + (a.ok ? '<span class="good">yes</span>' : '<span class="bad" title="' + esc(a.error || "") + '">no</span>') + '</td>' +
        '<td>' + (a.count == null ? "—" : a.count) + '</td></tr>').join("") + '</tbody></table>';
  }

  function renderFeed(filters) {
    const el = document.getElementById("socialFeed");
    if (!el) return;
    const f = filters || (typeof App !== "undefined" && App.getFilters ? App.getFilters() : null);
    const shown = posts.filter(p => !(f && f.team && f.team !== "ALL" && p.team !== f.team))
      .slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (!shown.length) {
      el.innerHTML = '<div class="empty">' + (error
        ? esc(error)
        : "No injury-related posts from the verified accounts right now. Keyword search is not available on Bluesky without auth (HTTP 403), so this layer only shows accounts on the verified allow-list — it will not invent posts.") + '</div>';
      return;
    }
    el.innerHTML = shown.map(p => {
      const cls = p.inGameWatch ? "ingame-watch" : p.sev;
      return '<div class="post sev-border-' + esc(p.inGameWatch ? "out" : p.sev) + '">' +
        '<div class="post-head"><span class="tag ' + esc(cls) + '">' + esc(p.sevLabel) + '</span>' +
        '<b>' + esc(p.name) + '</b>' +
        (p.verified ? '<span class="tag ok" title="Bluesky verification or outlet-domain verification">✓</span>' : "") +
        (p.outlet ? '<span class="muted tiny">' + esc(p.outlet) + '</span>' : "") +
        (p.team ? '<span class="tag team">' + esc(p.team) + '</span>' : "") +
        '<span class="post-when tiny muted">' + esc(ago(p.createdAt)) + '</span></div>' +
        '<div class="post-text">' + linkify(p.text) + '</div>' +
        '<div class="post-foot tiny"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">open on Bluesky ↗</a>' +
        ' · <span class="muted">' + esc(p.role || (p.kind === "official-team" ? "official team account" : p.kind === "official-league" ? "official league account" : "reporter")) + '</span></div></div>';
    }).join("");
  }

  function render(filters) { renderStatus(); renderFeed(filters); renderDetail(); }

  /* ---------- diagnostics: what actually happened in THIS browser ---------- */

  async function testFeeds() {
    const out = document.getElementById("testFeeds");
    if (out) out.innerHTML = "testing…";
    const first = feedAccounts()[0] || { handle: "nba.com" };
    const lines = [];
    const t0 = Date.now();
    try {
      const d = await getJSON(ENDPOINTS.bskyAuthorFeed + encodeURIComponent(first.handle) + "&limit=5", 10000);
      lines.push("✅ direct Bluesky GET @" + first.handle + " — " + ((d.feed || []).length) + " items in " + (Date.now() - t0) + "ms");
    } catch (e) {
      lines.push("❌ direct Bluesky GET @" + first.handle + " — " + e.message + (/40[13]/.test(e.message) ? " (the browser blocked this cross-origin request)" : ""));
    }
    try {
      const d = await getJSON(ENDPOINTS.socialSnapshot, 8000);
      lines.push("✅ same-origin CI snapshot — generated " + (d.generated || "?") + ", " + ((d.posts || []).length) + " injury posts from " + ((d.accounts || []).length) + " accounts");
    } catch (e) {
      lines.push("❌ same-origin CI snapshot — " + e.message + (/404/.test(e.message) ? " (run the injury-watch workflow to publish it)" : ""));
    }
    if (out) out.innerHTML = lines.map(l => '<div>' + esc(l) + '</div>').join("");
    return lines;
  }

  /* ---------- entry point used by app.js ---------- */

  async function check(isFirstLoad, force) {
    const res = await fetchAll();
    posts = res.posts; accounts = res.accounts; fetchedAt = res.fetchedAt; path = res.path; error = res.error;
    const diff = checkAlerts(posts, !!isFirstLoad);
    if (!isFirstLoad && diff.alerts.length && typeof AlertEngine !== "undefined") {
      for (const a of diff.alerts) AlertEngine.fire(a);
      AlertEngine.renderLog();
    }
    render();
    const nowEl = document.getElementById("socialNow");
    if (nowEl) nowEl.textContent = posts.length ? (posts.length + " injury posts · newest " + ago(posts.map(p => p.createdAt).sort().pop())) : "no injury posts right now";
    return posts;
  }

  function toggleRelay() {
    setRelay(!isRelayOn());
    const box = document.getElementById("relayToggle");
    if (box) box.checked = isRelayOn();
    const state = document.getElementById("relayState");
    if (state) state.textContent = isRelayOn() ? "ON (third-party relay)" : "off (direct only)";
    return check(false, true);
  }

  return {
    check: check, classifyPost: classifyPost, fetchAll: fetchAll, isOwnPost: isOwnPost,
    render: render, renderFeed: renderFeed, testFeeds: testFeeds, resetSeen: resetSeen,
    setRelay: setRelay, isRelayOn: isRelayOn, toggleRelay: toggleRelay,
    getPosts: () => posts, feedAccounts: feedAccounts, accountStatus: () => accounts,
    getMeta: () => ({ path: path, error: error, fetchedAt: fetchedAt, count: posts.length }),
    INGAME_WATCH_RE: WATCH_RE, GATE_RE: GATE_RE
  };
})();
