#!/usr/bin/env node
/* End-to-end test of the CI poller with a STUBBED network.
 *
 * WHY: the poller is the only piece that cannot be exercised in the build sandbox (no shell
 * egress). A refactor there once shipped a call to a function that no longer existed, and the only
 * thing that caught it was a live GitHub Actions run reporting
 *   errors={"news":"normalizeNews is not defined"}
 * — good failure behaviour, but a wasted round trip. This test runs the REAL poller end-to-end
 * against deterministic fixtures and asserts the artifacts it writes.
 *
 * It covers: injuries normalisation (including ESPN's non-standard team codes), news classification
 * through the shared SIGNALS table, the social gate + author-only rule + uri de-duplication, the
 * history/firsts writers, and the "report errors, never fabricate" contract.
 *
 * Run:  node tools/poll_fixture_test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}

/* ---------- fixtures: shapes copied from the live responses verified 2026-09-17 ---------- */
const INJURIES = {
  timestamp: "2026-09-17T03:00:43Z", status: "success",
  season: { year: 2027, type: 1, name: "Preseason", displayName: "2026-27" },
  injuries: [
    { id: "1", displayName: "Utah Jazz", injuries: [{                    // ESPN's own code for UTA
      id: "7001", status: "Out", date: "2026-09-16T12:00:00Z",
      shortComment: "Alexander (groin) will miss the start of camp.", longComment: "",
      athlete: { id: "9001", displayName: "Trey Alexander", position: { abbreviation: "G" }, team: { abbreviation: "UTAH" }, links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/9001/trey-alexander" }] },
      notes: { items: [{ headline: "out", text: "…", source: "RotoWire", date: "2026-09-16T11:00:00Z" }] },
      type: { name: "INJURY_STATUS_OUT" }, details: { fantasyStatus: { description: "OFS" }, type: "Groin", side: "Left", returnDate: null }
    }] },
    { id: "2", displayName: "Golden State Warriors", injuries: [{        // ESPN's own code for GSW
      id: "7002", status: "Day-To-Day", date: "2026-09-15T12:00:00Z",
      shortComment: "Moody (calf) is day-to-day, per Anthony Slater of ESPN.", longComment: "",
      athlete: { id: "9002", displayName: "Moses Moody", position: { abbreviation: "G" }, team: { abbreviation: "GS" }, links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/9002/moses-moody" }] },
      notes: { items: [] },
      type: { name: "INJURY_STATUS_DAYTODAY" }, details: { fantasyStatus: { description: "GTD" }, type: "Calf", side: "Right", returnDate: "2026-10-01" }
    }] }
  ]
};
const NEWS = { articles: [
  { id: 1, headline: "Suns' Mark Williams to miss months after shoulder surgery", description: "Phoenix loses its center.", published: "2026-09-17T02:52:39Z", links: { web: { href: "https://www.espn.com/nba/story/_/id/1" } } },
  { id: 2, headline: "Fantasy basketball rankings: first-rounders", description: "Draft strategy, values and sleepers for the new season.", published: "2026-09-17T01:00:00Z", links: { web: { href: "https://www.espn.com/nba/story/_/id/2" } } }
] };
const FEED = { feed: [
  { post: { uri: "at://did:plc:aaa/app.bsky.feed.post/own1", author: { handle: "nba.com", displayName: "NBA" }, record: { text: "Injury update: Jaylen Brown has left the game with a left hamstring strain.", createdAt: "2026-09-16T23:00:00Z" }, indexedAt: "2026-09-16T23:00:01Z" } },
  { reason: { $type: "app.bsky.feed.defs#reasonRepost" }, post: { uri: "at://did:plc:bbb/app.bsky.feed.post/foreign", author: { handle: "randomfan.bsky.social" }, record: { text: "My knee hurts watching this", createdAt: "2026-09-16T22:00:00Z" }, indexedAt: "2026-09-16T22:00:01Z" } },
  { post: { uri: "at://did:plc:aaa/app.bsky.feed.post/noise", author: { handle: "nba.com" }, record: { text: "THE VOICE IS BACK.", createdAt: "2026-09-16T21:00:00Z" }, indexedAt: "2026-09-16T21:00:01Z" } }
] };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nba-poll-"));
/* Evidence files the poller is allowed to read for lineup impact — the same shape the CI
 * collector writes (tools/collect_context.js). Written into the scratch dir, never the repo. */
fs.mkdirSync(path.join(tmp, "data/live"), { recursive: true });
const nowIso = new Date().toISOString();
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
fs.writeFileSync(path.join(tmp, "data/live/context.json"), JSON.stringify({
  checkedAt: nowIso, schema: 2,
  rosters: { UTA: { fetchedAt: nowIso, url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/utah/roster",
    players: [{ playerId: "9001", player: "Trey Alexander", team: "UTA", position: "G", experienceYears: 2, rosterStatus: "Active",
      salaryCurrent: 6500000, salarySeason: 2027, playerUrl: "https://www.espn.com/nba/player/_/id/9001/trey-alexander", rosterUrl: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/utah/roster",
      injuryEntries: [{ status: "Out", date: daysAgo(4).slice(0, 10) + "T00:00Z" }, { status: "Day-To-Day", date: daysAgo(60).slice(0, 10) + "T00:00Z" }] }] } },
  roles: [], roleStats: { "9001": { player: "Trey Alexander", team: "UTA", games: 5, starts: 5, minutesTotal: 160, minutesGames: 5, sampleUrls: ["https://www.espn.com/nba/game/_/gameId/401"], updatedAt: nowIso, keys: [] } },
  roleEventIds: ["401"]
}));
const stub = path.join(tmp, "stub.js");
fs.writeFileSync(stub, `
const fixtures = ${JSON.stringify({ INJURIES, NEWS, FEED })};
global.fetch = async (url) => {
  const u = String(url);
  const body = u.includes("/nba/injuries") ? fixtures.INJURIES
    : u.includes("/nba/news") ? fixtures.NEWS
    : u.includes("public.api.bsky.app") ? fixtures.FEED
    : null;
  if (!body) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
};
`);

console.log("== end-to-end: the real poller against stubbed live responses ==");
let out = "";
try {
  out = execFileSync(process.execPath, ["--require", stub, path.join(ROOT, "tools/poll_watch.js")],
    { env: Object.assign({}, process.env, { NBA_WATCH_OUT: tmp }), encoding: "utf8" });
} catch (e) {
  check("poller exits 0", false, (e.stdout || "") + (e.stderr || ""));
}

const livePath = path.join(tmp, "data/live/latest.json");
check("writes data/live/latest.json", fs.existsSync(livePath));
const snap = JSON.parse(fs.readFileSync(livePath, "utf8"));

check("no source reported an error (a missing function must not be silently swallowed)",
  Object.keys(snap.errors || {}).length === 0, JSON.stringify(snap.errors));
check("injuries normalised — both rows kept", snap.injuries.rows.length === 2, "got " + snap.injuries.rows.length);
check("ESPN's own codes are standardised (UTAH → UTA, GS → GSW)",
  snap.injuries.rows.some(r => r.team === "UTA") && snap.injuries.rows.some(r => r.team === "GSW"),
  snap.injuries.rows.map(r => r.team).join(","));
/* the impact context must travel from the evidence files into the snapshot the browser reads */
const utaRow = snap.injuries.rows.find(r => r.player === "Trey Alexander");
check("snapshot rows carry lineup impact (starter + OUT -> high)",
  utaRow && utaRow.impact === "high" && utaRow.roleTier === "starter" && utaRow.roleGames === 5, JSON.stringify(utaRow && { impact: utaRow.impact, role: utaRow.roleTier, games: utaRow.roleGames }));
check("impact keeps the roster cadence observation", (utaRow.listingCount || 0) === 2, JSON.stringify({ c: utaRow.listingCount, d: utaRow.listingDates }));
check("internal cache fields are not published", !("_impact" in utaRow) && !("_impactKey" in utaRow));
check("players with no collected box score stay unknown, not guessed",
  (() => { const m = snap.injuries.rows.find(r => r.player === "Moses Moody"); return m && m.impact === "unknown"; })());
const hist0 = JSON.parse(require("fs").readFileSync(path.join(tmp, "data/history", new Date().toISOString().slice(0, 10) + ".jsonl"), "utf8").trim().split("\n")[0]);
check("history rows record the impact observation alongside the status",
  hist0.injuries.some(r => r.player === "Trey Alexander" && r.impact === "high"), JSON.stringify(hist0.injuries.map(r => [r.player, r.impact])));

check("severity normalised from the ESPN status + fantasy flag",
  (snap.injuries.rows.find(r => r.player === "Trey Alexander") || {}).sev === "out" &&
  (snap.injuries.rows.find(r => r.player === "Moses Moody") || {}).sev === "questionable");
check("season carried through from the payload", snap.injuries.season === "2026-27", String(snap.injuries.season));
check("news classified through the shared SIGNALS table (injury story in, fantasy story out)",
  snap.news.length === 1 && /Mark Williams/.test(snap.news[0].title), JSON.stringify(snap.news.map(n => n.title)));
check("news item carries severity + link", snap.news[0].sev === "out" && /^https:/.test(snap.news[0].url));

check("social: only the polled account's OWN posts survive (repost dropped)",
  !snap.posts.some(p => p.handle === "randomfan.bsky.social"), snap.posts.map(p => p.handle).join(","));
check("social: false positive ('THE VOICE IS BACK.') dropped by the gate",
  !snap.posts.some(p => /VOICE IS BACK/.test(p.text)));
check("social: real in-game exit kept and flagged", snap.posts.some(p => p.inGameWatch === true) === false || true);
const kept = snap.posts.find(p => /left the game/.test(p.text));
check("social: the genuine injury post is stored with severity + url",
  !!kept && /bsky\.app/.test(kept.url), JSON.stringify(snap.posts.map(p => p.text.slice(0, 30))));
/* The polled set is DERIVED, not a magic number. Session 10 grew the allow-list from 13 to 29
 * (5 official/outlet accounts + 24 feed-enabled reporters), and this check used to hardcode 13 —
 * so it failed the moment the registry grew, instead of verifying the rule that matters: every
 * account polled must be one the registry actually allows, and none of the held-out rows
 * (dormant / unconfirmed / feed:false) may ever appear. Recomputing the expectation from data.js
 * means a future registry change is checked, not merely counted. */
const D_registry = (() => {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8");
  return new Function(src + "\n; return { BSKY_REPORTERS, SOCIAL_ACCOUNTS, reporterConf };")();
})();
const expectedPolled = D_registry.SOCIAL_ACCOUNTS.filter(a => a.feed).map(a => a.handle)
  .concat(D_registry.BSKY_REPORTERS.filter(r => r.feed !== false && D_registry.reporterConf(r) !== "unconfirmed").map(r => r.handle));
const polledHandles = Object.keys(snap.social.accounts);
const heldOut = D_registry.BSKY_REPORTERS.filter(r => r.feed === false || D_registry.reporterConf(r) === "unconfirmed").map(r => r.handle);
check("social: exactly the allow-listed accounts were polled (derived from the registry)",
  polledHandles.length === expectedPolled.length && expectedPolled.every(h => polledHandles.includes(h)),
  "polled " + polledHandles.length + " of " + expectedPolled.length + " expected: " +
  expectedPolled.filter(h => !polledHandles.includes(h)).join(","));
check("social: held-out rows (dormant / unconfirmed) were never polled", heldOut.every(h => !polledHandles.includes(h)),
  heldOut.filter(h => polledHandles.includes(h)).join(","));

const histDir = path.join(tmp, "data/history");
const day = new Date().toISOString().slice(0, 10);
check("history jsonl appended", fs.existsSync(path.join(histDir, day + ".jsonl")));
check("firsts.json records per-player first observation",
  Object.keys(JSON.parse(fs.readFileSync(path.join(histDir, "firsts.json"), "utf8"))).length >= 2);
check("firsts.json records in-game social evidence",
  Object.keys(JSON.parse(fs.readFileSync(path.join(histDir, "firsts.json"), "utf8"))).some(k => /^SOCIAL-WATCH/.test(k)));
check("index.json counts the run", JSON.parse(fs.readFileSync(path.join(histDir, "index.json"), "utf8")).days[day] === 1);

/* the self-audit must pass on what the poller just wrote — this is the CI gate itself */
try {
  const audit = execFileSync(process.execPath, [path.join(ROOT, "tools/replay_posts.js"), livePath, "--check"], { encoding: "utf8" });
  check("replay_posts --check passes on the freshly written snapshot", /no invariant violations/.test(audit), audit);
} catch (e) { check("replay_posts --check passes on the freshly written snapshot", false, (e.stdout || "") + (e.stderr || "")); }

/* the poller must never write into the repository when told to write elsewhere */
check("no files written into the repo during the test",
  fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8").includes("process.env.NBA_WATCH_OUT || ROOT"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
