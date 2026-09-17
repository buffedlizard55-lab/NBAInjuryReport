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
const DRY = process.argv.includes("--dry-run");
const TIMEOUT_MS = 20000;

/* ---- load the single source of truth (data.js is plain data + pure functions) ---- */
const dataSrc = fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8");
const D = new Function(dataSrc + `
  return { ENDPOINTS, TEAMS, SIGNALS, SOCIAL_ACCOUNTS, BSKY_REPORTERS, INGAME_WATCH_RE,
           normalizeInjuryStatus, teamByAbbr, BLUESKY_LIST_SOURCE };
`)();

async function getJson(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "NBAInjuryReport-poller (+https://github.com/buffedlizard55-lab/NBAInjuryReport)" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(to); }
}

/* ---------------- layer 1: structured ESPN injury board ---------------- */
function espnTeamInjuries(abbr) { return "https://www.espn.com/nba/team/injuries/_/name/" + String(abbr || "").toLowerCase(); }
function athleteUrl(a) {
  const pc = ((a && a.links) || []).find(l => (l.rel || []).includes("playercard"));
  return (pc && pc.href) || ("https://www.espn.com/nba/player/_/id/" + ((a && a.id) || ""));
}
function normalizeInjuries(data) {
  const rows = [];
  for (const block of ((data && data.injuries) || [])) {
    for (const raw of (block.injuries || [])) {
      const athlete = raw.athlete || {};
      const abbr = (athlete.team && athlete.team.abbreviation) || "?";
      const statusText = String(raw.status || "");
      const typeName = (raw.type && raw.type.name) || "";
      const fantasy = (raw.details && raw.details.fantasyStatus && raw.details.fantasyStatus.description) || "";
      const norm = D.normalizeInjuryStatus(statusText, typeName, fantasy);
      const note = (((raw.notes || {}).items) || [])[0] || {};
      const d = raw.details || {};
      const item = {
        id: String(raw.id || (athlete.id + "-" + statusText)),
        player: athlete.displayName || athlete.shortName || "Unknown player",
        playerId: athlete.id || null,
        position: (athlete.position && (athlete.position.abbreviation || athlete.position.displayName)) || "",
        team: abbr,
        status: statusText,
        sev: norm.sev,
        sevLabel: norm.label,
        fantasyStatus: fantasy,
        injuryType: d.type || "",
        injuryLocation: d.location || "",
        injurySide: d.side || "",
        returnDate: d.returnDate || "",
        bodyPart: [d.side, d.type, d.location].filter(Boolean).join(" "),
        updated: raw.date || null,
        shortComment: raw.shortComment || "",
        longComment: raw.longComment || "",
        noteHeadline: note.headline || "",
        noteText: note.text || "",
        noteDate: note.date || "",
        noteSource: note.source || "",
        playerUrl: athleteUrl(athlete),
        teamUrl: espnTeamInjuries(abbr),
        officialUrl: "https://official.nba.com/nba-injury-report-2025-26-season/",
        headshot: (athlete.headshot && athlete.headshot.href) || null
      };
      item.fp = item.status + "|" + item.shortComment.slice(0, 160) + "|" + item.noteHeadline.slice(0, 120);
      rows.push(item);
    }
  }
  rows.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
  return rows;
}

/* ---------------- layer 2: ESPN news (classified) ---------------- */
function classify(text) {
  for (const s of D.SIGNALS) if (s.re.test(text)) return { sev: s.sev, sevLabel: s.label };
  return null;
}
function normalizeNews(data) {
  const out = [];
  for (const a of ((data && data.articles) || [])) {
    const text = (a.headline || "") + " " + (a.description || "");
    const hit = classify(text);
    if (!hit) continue;
    out.push({
      id: String(a.id || ""), ts: a.published || a.lastModified || null,
      title: a.headline || "", desc: a.description || "", byline: a.byline || "ESPN",
      url: (a.links && a.links.web && a.links.web.href) || "https://www.espn.com/nba/",
      sev: hit.sev, sevLabel: hit.sevLabel
    });
  }
  return out;
}

/* ---------------- layer 3: Bluesky verified allow-list ---------------- */
function socialAccounts() {
  const official = D.SOCIAL_ACCOUNTS.filter(a => a.feed).map(a => ({
    handle: a.handle, name: a.name, kind: a.kind, team: a.team, verified: !!a.bskyVerified, url: a.url, outlet: null, role: null
  }));
  const reps = D.BSKY_REPORTERS.filter(a => a.feed).map(a => ({
    handle: a.handle, name: a.name, kind: "reporter", team: a.team, verified: !!a.bskyVerified,
    url: a.evidence, outlet: a.outlet || null, role: a.role || null
  }));
  return official.concat(reps);
}
function postUrl(handle, uri) {
  const rkey = String(uri || "").split("/").pop();
  return rkey ? ("https://bsky.app/profile/" + handle + "/post/" + rkey) : ("https://bsky.app/profile/" + handle);
}
async function fetchSocial() {
  const accts = socialAccounts();
  const posts = [];
  const status = {};
  /* sequential-ish batches of 4 to stay polite to a free public API */
  for (let i = 0; i < accts.length; i += 4) {
    const batch = accts.slice(i, i + 4);
    const results = await Promise.all(batch.map(async a => {
      try {
        const data = await getJson(D.ENDPOINTS.bskyAuthorFeed + encodeURIComponent(a.handle) + "&limit=20");
        status[a.handle] = { ok: true, count: (data.feed || []).length };
        return ((data.feed) || []).map(item => {
          const p = item.post || {};
          const rec = p.record || {};
          const author = p.author || {};
          const handle = author.handle || a.handle;
          const text = String(rec.text || "").trim();
          const t = text;
          const inj = /\b(injur\w+|hurt|sore|soreness|sprain|strain|torn|fracture\w*|concussion|illness|sick|surgery|achilles|acl|mcl|meniscus|hamstring|ankle|knee|calf|groin|wrist|thumb|quad|oblique|hip|foot|leg|back|shoulder|elbow|hand|finger|toe|neck|ribs?|protocol|questionable|doubtful|probable|out|gtd|day-?to-?day|locker room|limp\w*)\b/i;
          if (!inj.test(t) && !D.INGAME_WATCH_RE.test(t)) return null;   // keep only injury-relevant posts
          const sev = classify(t);
          return {
            uri: p.uri, text,
            handle, name: author.displayName || a.name,
            createdAt: rec.createdAt || p.indexedAt || null,
            indexedAt: p.indexedAt || null,
            url: postUrl(handle, p.uri),
            verified: !!a.verified, kind: a.kind, team: a.team, outlet: a.outlet, role: a.role,
            accountUrl: a.url,
            sev: sev ? sev.sev : "mention",
            sevLabel: sev ? sev.sevLabel : "INJURY MENTION",
            inGameWatch: D.INGAME_WATCH_RE.test(t)
          };
        }).filter(Boolean);
      } catch (e) {
        status[a.handle] = { ok: false, error: e.message };
        return [];
      }
    }));
    results.forEach(r => posts.push(...r));
  }
  posts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return { posts, status };
}

/* ---------------- history + first-to-report ---------------- */
function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; }
}
function recordHistory(rows, posts, news) {
  const dir = path.join(ROOT, "data/history");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, day + ".jsonl");
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    injuries: rows.map(r => ({ id: r.id, player: r.player, team: r.team, status: r.status, sev: r.sev, fp: r.fp, updated: r.updated })),
    posts: posts.map(p => ({ uri: p.uri, handle: p.handle, createdAt: p.createdAt, sev: p.sev, inGameWatch: p.inGameWatch, text: p.text.slice(0, 300) })),
    news: news.map(n => ({ id: n.id, ts: n.ts, sev: n.sev, title: n.title }))
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
  index.note = "Appended by tools/poll_watch.js via .github/workflows/injury-watch.yml. Cron is best-effort; gaps are GitHub scheduler delays, not lost data.";
  if (!DRY) fs.writeFileSync(ipath, JSON.stringify(index, null, 2) + "\n");

  return { day, firsts: Object.keys(firsts).length };
}

/* ---------------- main ---------------- */
(async () => {
  const out = { generated: new Date().toISOString(), source: "github-actions-poller", errors: {} };
  let rows = [], news = [], posts = [], socialStatus = {};

  try {
    const inj = await getJson(D.ENDPOINTS.injuries);
    rows = normalizeInjuries(inj);
    out.injuries = { season: (inj.season && inj.season.displayName) || null, seasonRaw: inj.season || null, rows, blocks: (inj.injuries || []).length };
  } catch (e) { out.errors.injuries = e.message; out.injuries = { season: null, rows: [] }; }

  try {
    const nw = await getJson(D.ENDPOINTS.news);
    news = normalizeNews(nw);
    out.news = news;
  } catch (e) { out.errors.news = e.message; out.news = []; }

  try {
    const soc = await fetchSocial();
    posts = soc.posts; socialStatus = soc.status;
  } catch (e) { out.errors.social = e.message; }
  out.social = { accounts: socialStatus };
  out.posts = posts;

  const hist = recordHistory(rows, posts, news);

  const liveDir = path.join(ROOT, "data/live");
  if (!DRY) {
    if (!fs.existsSync(liveDir)) fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, "latest.json"), JSON.stringify(out, null, 2) + "\n");
  }

  console.log(`poll_watch: injuries=${rows.length} news=${news.length} posts=${posts.length} socialAccounts=${Object.keys(socialStatus).length}`);
  console.log(`  history day ${hist.day} · firsts tracked: ${hist.firsts}`);
  if (Object.keys(out.errors).length) console.log("  errors:", out.errors);
  if (DRY) console.log("  (dry run — nothing written)");
})().catch(e => { console.error("poll_watch failed:", e); process.exit(1); });
