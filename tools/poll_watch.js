#!/usr/bin/env node
/* Free server-side injury watcher — runs in GitHub Actions (no API keys, no secrets).
 *
 * WHY IT EXISTS
 *   1. Latency + CORS: fetching from a server removes every browser limitation, and the
 *      browser reads the result SAME-ORIGIN from data/live/latest.json.
 *   2. History: every run appends a timestamped line, which is the only honest way to
 *      decide who reported an injury FIRST (paid X history is not available — see FLAGS).
 *   3. First-to-report attribution: data/history/firsts.json records, per player,
 *      the earliest timestamp + source this project observed.
 *
 * SOURCES (each verified live 2026-09-17 — see sources.html)
 *   - https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries   (structured, all 30 teams)
 *   - https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50
 *   - https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&limit=20  (verified allow-list)
 *
 * WHAT IT DOES NOT DO
 *   - it does not scrape X/Instagram/Facebook (no free read access — documented limitation)
 *   - it does not invent data: every stored field comes from the source response
 *
 * Usage:  node tools/poll_watch.js            (writes data/live/latest.json + data/history/*)
 *         node tools/poll_watch.js --dry-run  (prints a summary, writes nothing)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
/* Writable root is overridable so tests can run the poller end-to-end without dirtying the repo:
 *   NBA_WATCH_OUT=/tmp/x node --require ./stub.js tools/poll_watch.js
 * In CI and normal use it is the repository root. */
const OUT_ROOT = process.env.NBA_WATCH_OUT || ROOT;
const DRY = process.argv.includes("--dry-run");
const TIMEOUT_MS = 20000;
const UA = "NBAInjuryReport-poller (+https://github.com/buffedlizard55-lab/NBAInjuryReport)";

/* ---- load the single source of truth (data.js is plain data + pure functions) ---- */
const dataSrc = fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8");
const D = new Function(dataSrc + `
  return { ENDPOINTS, TEAMS, SIGNALS, SOCIAL_ACCOUNTS, BSKY_REPORTERS, INGAME_WATCH_RE,
           SOCIAL_INJURY_GATE_RE, SOCIAL_NON_INJURY_RE, classifySocialSeverity, standardAbbr, normalizeInjuryStatus, teamByAbbr, BLUESKY_LIST_SOURCE };
`)();

/* The browser modules are IIFEs that assume a DOM. Stub the few globals they touch so the poller
 * and the dashboard run the SAME normaliser and the SAME classifier — duplicated logic drifts,
 * and drift here means the site and the archive disagree about what an injury is.
 * (This is exactly how the bugs fixed on 2026-09-17 were found: the first live snapshot had rows
 * whose fields the browser could not read, because the two paths had drifted.) */
const _store = {};
global.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; }
};
global.document = { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }), addEventListener() { } };
global.window = global;
const moduleSrc = ["assets/js/data.js", "assets/js/alerts.js", "assets/js/injuries.js", "assets/js/social.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
const B = new Function(moduleSrc + "\n;return { InjuryBoard, Social, AlertEngine };")();

async function getJson(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(to); }
}

/* ---------------- layer 1: structured ESPN injury board ---------------- */
/* NOTE: the injuries + social normalisers used to be duplicated here. They now come from
 * assets/js/injuries.js and assets/js/social.js (loaded above with DOM stubs) so the archive and
 * the dashboard can never disagree about what a row or a post means. */

/* News classification — the ORDERED severity table lives in data.js (SIGNALS), so the poller and
 * the dashboard classify headlines with the same rules; only the output shape differs.
 * Regression note: an earlier refactor of this file accidentally dropped this function, and the
 * live run reported errors={"news":"normalizeNews is not defined"} instead of silently writing an
 * empty news array. That is the intended failure mode: report, never fabricate. */
function classifyHeadline(headline, desc) {
  const text = String(headline || "") + " " + String(desc || "");
  for (const s of D.SIGNALS) if (s.re.test(text)) return { sev: s.sev, sevLabel: s.label };
  return null;
}
function normalizeNews(data) {
  const out = [];
  for (const a of ((data && data.articles) || [])) {
    const hit = classifyHeadline(a.headline, a.description);
    if (!hit) continue;                                  // not an injury story → not stored
    out.push({
      id: String(a.id || a.headline),
      ts: a.published || a.lastModified || null,
      sev: hit.sev,
      sevLabel: hit.sevLabel,
      title: a.headline || "",
      desc: a.description || "",
      url: (a.links && a.links.web && a.links.web.href) || null,
      byline: (a.byline && a.byline) || null
    });
  }
  out.sort((x, y) => new Date(y.ts || 0) - new Date(x.ts || 0));
  return out;
}

/* ---------------- history + first-to-report ---------------- */
function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; }
}
function recordHistory(rows, posts, news) {
  const dir = path.join(OUT_ROOT, "data/history");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, day + ".jsonl");
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    injuries: rows.map(r => ({ id: r.id, player: r.player, team: r.team, playerId: r.playerId, status: r.status, sev: r.sev, fp: r.fp, updated: r.updated, url: r.teamUrl, reason: r.bodyPart })),
    posts: posts.map(p => ({ uri: p.uri, handle: p.handle, createdAt: p.createdAt, sev: p.sev, inGameWatch: p.inGameWatch, text: p.text, url: p.url })),
    news: news.map(n => ({ id: n.id, ts: n.ts, sev: n.sev, title: n.title, url: n.url }))
  });
  if (!DRY) fs.appendFileSync(file, line + "\n");

  /* firsts: earliest observation per player, per project */
  const fpath = path.join(dir, "firsts.json");
  const firsts = readJsonSafe(fpath, {});
  const now = new Date().toISOString();
  for (const r of rows) {
    const key = r.player + " (" + r.team + ")";
    if (!firsts[key]) {
      firsts[key] = {
        firstSeenByThisProject: now,
        status: r.status, sev: r.sev, updated: r.updated,
        source: "ESPN structured injuries API",
        evidence: r.teamUrl
      };
    } else {
      /* a later status change is recorded too — that is a real "update" event */
      firsts[key].lastStatus = r.status;
      firsts[key].lastSeen = now;
    }
  }
  for (const p of posts) {
    if (!p.inGameWatch) continue;
    const key = "SOCIAL-WATCH @" + p.handle + " " + (p.createdAt || "");
    if (!firsts[key]) {
      firsts[key] = { firstSeenByThisProject: now, postedAt: p.createdAt, source: "Bluesky @" + p.handle, evidence: p.url, text: p.text.slice(0, 200) };
    }
  }
  if (!DRY) fs.writeFileSync(fpath, JSON.stringify(firsts, null, 2) + "\n");

  /* index */
  const ipath = path.join(dir, "index.json");
  const index = readJsonSafe(ipath, { days: {}, lastRun: null });
  index.days[day] = (index.days[day] || 0) + 1;
  index.lastRun = now;
  index.note = "Appended by tools/poll_watch.js via .github/workflows/injury-watch.yml. Cron is best-effort; gaps can include missed observations and failed source access.";
  // Bound the working tree. Git history is not a long-term event database.
  if (!DRY) for (const name of fs.readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && Date.now() - Date.parse(name.slice(0, 10)) > 7 * 86400000) {
      fs.unlinkSync(path.join(dir, name)); delete index.days[name.slice(0, 10)];
    }
  }
  if (!DRY) fs.writeFileSync(ipath, JSON.stringify(index, null, 2) + "\n");

  return { day, firsts: Object.keys(firsts).length };
}

/* ---------------- main ---------------- */
(async () => {
  const out = { generated: new Date().toISOString(), source: "github-actions-poller", errors: {} };
  let rows = [], news = [], posts = [], socialStatus = {}, season = null, seasonRaw = null;

  /* injuries — shared normaliser (assets/js/injuries.js), same rows the dashboard renders */
  try {
    const payload = await getJson(D.ENDPOINTS.injuries);
    if (!Array.isArray(payload.injuries)) throw new Error("invalid injuries schema");
    seasonRaw = (payload && payload.season) || null;
    season = (seasonRaw && (seasonRaw.displayName || seasonRaw.name)) || null;
    rows = B.InjuryBoard.normalize(payload);          // identical to the browser path
    out.injuries = { season, seasonRaw, rows, blocks: (payload.injuries || []).length };
  } catch (e) {
    out.errors.injuries = e.message;
    out.injuries = { season: null, seasonRaw: null, rows: [] };
  }

  /* news — the same ordered SIGNALS classifier the dashboard uses */
  try {
    const nw = await getJson(D.ENDPOINTS.news);
    news = normalizeNews(nw);
    out.news = news;
  } catch (e) { out.errors.news = e.message; out.news = []; }

  /* social — shared fetch + classifier (assets/js/social.js). check() also updates seen-state in
   * the stubbed localStorage, which is harmless because nothing is persisted from here. */
  try {
    await B.Social.check(true, true);
    posts = B.Social.getPosts();
    socialStatus = B.Social.accountStatus();
    const meta = B.Social.getMeta();
    if (meta && meta.error) out.errors.social = meta.error;
    if (meta && meta.path) out.socialPath = meta.path;
  } catch (e) { out.errors.social = e.message; }
  /* one post must never be stored twice (found in the first snapshot: a repost picked up from a
   * second account produced a duplicate uri, which would have double-counted and double-alerted) */
  const seenUris = new Set();
  posts = posts.filter(p => !seenUris.has(p.uri) && seenUris.add(p.uri));
  posts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  out.social = { accounts: socialStatus };
  out.posts = posts;

  const hist = recordHistory(rows, posts, news);

  const liveDir = path.join(OUT_ROOT, "data/live");
  if (!DRY) {
    if (!fs.existsSync(liveDir)) fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, "latest.json"), JSON.stringify(out, null, 2) + "\n");
  }

  console.log(`poll_watch: injuries=${rows.length} news=${news.length} posts=${posts.length} socialAccounts=${Object.keys(socialStatus).length}`);
  console.log(`  history day ${hist.day} · firsts tracked: ${hist.firsts}`);
  console.log(`  team codes: ${new Set(rows.map(r => r.team)).size} distinct (all must be standard 3-letter codes)`);
  if (Object.keys(out.errors).length) console.log("  errors:", out.errors);
  if (DRY) console.log("  (dry run — nothing written)");
})().catch(e => { console.error("poll_watch failed:", e); process.exit(1); });
