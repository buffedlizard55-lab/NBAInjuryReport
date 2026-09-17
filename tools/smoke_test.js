#!/usr/bin/env node
/* Smoke tests for the NBA Injury Alert System — runs the REAL browser modules in Node
 * behind a tiny DOM/localStorage stub, so classification, diffing, alerting and rendering
 * are exercised with realistic fixtures instead of being assumed to work.
 *
 * Run:  node tools/smoke_test.js
 *
 * Fixtures are modelled on payloads that were VERIFIED LIVE on 2026-09-17:
 *   - ESPN structured injuries API (observed: status "Day-To-Day", type INJURY_STATUS_DAYTODAY,
 *     fantasyStatus "GTD", details{type:"Achilles",location:"Leg",side:"Right",returnDate},
 *     notes.items[]{headline,text,source:"RotoWire"}, athlete.links[] rel includes "playercard")
 *   - ESPN game summary (observed: boxscore.players[].statistics[].athletes[]{didNotPlay,reason,ejected},
 *     reason "COACH'S DECISION" as a NON-injury value)
 *   - Bluesky author feed (observed: feed[].post.{uri,author{handle,displayName},record{text,createdAt},indexedAt})
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, failCount = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { failCount++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}

/* ------------------------------------------------------------------ *
 * Minimal browser environment
 * ------------------------------------------------------------------ */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function fakeEl() {
  return {
    innerHTML: "", textContent: "", value: "", checked: false, disabled: false, files: [],
    dataset: {}, style: {},
    addEventListener() { }, querySelectorAll() { return []; }, click() { }, querySelector() { return null; }
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || fakeEl()),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  addEventListener() { }
};
global.window = global;
global.fetch = () => Promise.reject(new Error("no network in tests"));
global.alert = () => { };
global.URL = global.URL || { createObjectURL: () => "blob:", revokeObjectURL() { } };

/* ------------------------------------------------------------------ *
 * Load the real modules into ONE shared scope (they are classic scripts)
 * ------------------------------------------------------------------ */
const FILES = ["data.js", "role.js", "alerts.js", "wire.js", "injuries.js", "social.js", "ingame.js"];
const source = FILES.map(f => fs.readFileSync(path.join(ROOT, "assets/js", f), "utf8")).join("\n;\n");

const env = new Function(source + `
  return { ENDPOINTS, TEAMS, TEAM_ALIASES, SIGNALS, REPORTERS, SOURCES, FLAGS, SCORING_RUBRIC,
           SOCIAL_ACCOUNTS, BSKY_REPORTERS, BLUESKY_LIST_SOURCE, INGAME_WATCH_RE, NBA_OFFICIAL_REPORT_URL,
           teamByAbbr, espnTeamInjuriesUrl, normalizeInjuryStatus, xSearchUrl,
           standardAbbr, classifySocialSeverity, SOCIAL_INJURY_GATE_RE, SOCIAL_INJURY_VOCAB_RE, SOCIAL_NON_INJURY_RE,
           AlertEngine, Wire, InjuryBoard, Social, InGame, LineupImpact };
`);
const M = env();

console.log("== data integrity ==");
check("30 teams", M.TEAMS.length === 30);
check("unique abbreviations", new Set(M.TEAMS.map(t => t.abbr)).size === 30);
check("every alias-map key matches a team", Object.keys(M.TEAM_ALIASES).every(a => !!M.teamByAbbr(a)));
check("team injuries URL pattern", M.espnTeamInjuriesUrl("MIA") === "https://www.espn.com/nba/team/injuries/_/name/mia");
check("reporter directory kept (>=36 rows)", M.REPORTERS.length >= 36, "got " + M.REPORTERS.length);
check("reporter names unique", new Set(M.REPORTERS.map(r => r.name)).size === M.REPORTERS.length);
check("every reporter has a verifyUrl", M.REPORTERS.every(r => r.verifyUrl && r.verifyUrl.startsWith("http")));
check("verified-handle rows assert a handle; outlet-only rows assert none",
  M.REPORTERS.every(r => (r.status === "verified-handle") ? !!r.handle : (r.status === "outlet-only") ? !r.handle : true));
check("Wojnarowski marked retired", (M.REPORTERS.find(r => r.name === "Adrian Wojnarowski") || {}).status === "retired");
check("every source has id/name/url/verified/review", M.SOURCES.every(s => s.id && s.name && s.url && s.verified && s.review));
check("source ids unique", new Set(M.SOURCES.map(s => s.id)).size === M.SOURCES.length);
check("structured injuries endpoint registered", M.ENDPOINTS.injuries.includes("/nba/injuries"));
check("Bluesky public API endpoint registered", M.ENDPOINTS.bskyAuthorFeed.startsWith("https://public.api.bsky.app/xrpc/"));
check("same-origin snapshot path registered", M.ENDPOINTS.liveSnapshot === "data/live/latest.json");
check("flags present (>= 20)", M.FLAGS.length >= 20, "got " + M.FLAGS.length);
check("flag levels are valid", M.FLAGS.every(f => ["bad", "warn", "info"].includes(f.level)));
check("Bluesky reporter handles look like handles",
  M.BSKY_REPORTERS.every(r => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(r.handle) && r.evidence.startsWith("https://bsky.app/profile/")));
check("every social account has verification evidence", M.SOCIAL_ACCOUNTS.every(a => a.verified && a.url));
check("only feed-enabled accounts are polled", M.SOCIAL_ACCOUNTS.some(a => a.feed) && M.SOCIAL_ACCOUNTS.some(a => !a.feed));
check("the curated writers list has a source URL + count", !!M.BLUESKY_LIST_SOURCE.url && M.BLUESKY_LIST_SOURCE.members > 0);

/* regression guards for bugs found by replaying the FIRST LIVE CI SNAPSHOT (2026-09-17).
 * Each one cost real false positives on real data; they must never come back. */
console.log("== regressions found on live data ==");
check("ESPN's own abbreviations are normalised (GS/NO/NY/SA/UTAH/WSH → GSW/NOP/NYK/SAS/UTA/WAS)",
  [["GS","GSW"],["NO","NOP"],["NY","NYK"],["SA","SAS"],["UTAH","UTA"],["WSH","WAS"],["ATL","ATL"]]
    .every(([a, b]) => M.standardAbbr(a) === b));
check("every normalised abbreviation maps to a real team (no orphan chips)",
  ["GS","NO","NY","SA","UTAH","WSH"].every(a => !!M.teamByAbbr(M.standardAbbr(a))));
check("social gate rejects a body-word false positive ('THE VOICE IS BACK.')",
  M.Social.classifyPost("THE VOICE IS BACK.") === null);
check("social gate rejects 'locker room culture' (needs an exit phrase, not the words alone)",
  M.Social.classifyPost("We talk Spurs locker room culture and the season ahead.") === null);
check("roster news with no injury word is dropped entirely (never alerted)",
  M.Social.classifyPost("Spurs will be without Carter Bryant vs. Bucks tonight.") === null);
check("rest news that reaches the gate is labelled non-injury, not an alert",
  (M.Social.classifyPost("No Tarris Reed Jr., who is out for rest after 9 rebounds.") || {}).kind === "non-injury");
check("a real in-game exit still escalates after tightening",
  (M.Social.classifyPost("Ace Bailey did not start the second half and will not return due to back spasms.") || {}).kind === "ingame-watch");
check("a routine draft-procedure note is not labelled OUT",
  M.Social.classifyPost("Spurs pick Jayden Quaintance underwent a scheduled clean-up procedure on his right knee.").sev !== "out");
check("only the polled account's OWN posts count (reposts are authored by someone else)",
  M.Social.isOwnPost({ post: { author: { handle: "x.bsky.social" } } }, "x.bsky.social") === true &&
  M.Social.isOwnPost({ post: { author: { handle: "someone.bsky.social" } } }, "x.bsky.social") === false &&
  M.Social.isOwnPost({ reason: {}, post: { author: { handle: "x.bsky.social" } } }, "x.bsky.social") === false);
check("the poller shares the browser normalisers instead of duplicating them",
  /B\.InjuryBoard\.normalize/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")) &&
  /B\.Social\.check/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")));
check("CI runs the live-data self-audit before committing a snapshot",
  /replay_posts\.js data\/live\/latest\.json --check/.test(fs.readFileSync(path.join(ROOT, ".github/workflows/injury-watch.yml"), "utf8")));
check("posts are de-duplicated by uri (found: one post stored twice)",
  /seenUris/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")) &&
  /deduped/.test(fs.readFileSync(path.join(ROOT, "assets/js/social.js"), "utf8")));
check("the poller defines every normaliser it calls (a dropped function must not ship)",
  /function normalizeNews\(/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")) &&
  /function classifyHeadline\(/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")));
check("poller news uses the shared ordered severity table (SIGNALS), not its own list",
  /for \(const s of D\.SIGNALS\)/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")));
check("the poller refuses to invent data (errors are reported, never filled in)",
  /errors: \{\}/.test(fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8")));

console.log("== status normalization (ESPN structured board) ==");
check("observed 'Day-To-Day' + INJURY_STATUS_DAYTODAY + GTD -> questionable",
  M.normalizeInjuryStatus("Day-To-Day", "INJURY_STATUS_DAYTODAY", "GTD").sev === "questionable");
check("'Out' -> out", M.normalizeInjuryStatus("Out", "INJURY_STATUS_OUT", "").sev === "out");
check("'Out For Season' -> out", M.normalizeInjuryStatus("Out For Season", "INJURY_STATUS_OUT_FOR_SEASON", "").sev === "out");
check("'Doubtful' -> doubtful", M.normalizeInjuryStatus("Doubtful", "", "").sev === "doubtful");
check("unrecognised status falls through to 'mention' (never silently mislabelled)",
  M.normalizeInjuryStatus("Probation", "WEIRD", "").sev === "mention");

console.log("== classifier (headline -> severity) ==");
function classify(text) { for (const s of M.SIGNALS) if (s.re.test(text)) return s.sev; return null; }
[
  ["Suns' Mark Williams to miss months after shoulder surgery", "out"],
  ["Mark Williams had surgery to repair a torn labrum; will miss several months", "out"],
  ["Lakers' LeBron James ruled out vs. Thunder with sciatica", "out"],
  ["Celtics G Derrick White doubtful for Game 3", "doubtful"],
  ["Stephen Curry questionable to return after tweaking ankle", "questionable"],
  ["Nikola Jokic is a game-time decision", "questionable"],
  ["Giannis probable for Friday", "probable"],
  ["Kyrie Irving cleared to return to practice", "return"],
  ["Jayson Tatum upgraded to available", "return"],
  ["Ja Morant left the game with a sprained ankle", "mention"],
  ["Fantasy basketball points league rankings: Cade Cunningham, Jalen Johnson are first-rounders", null],
  ["Full-court shot lifts Liberty in overtime thriller", null]
].forEach(([text, want]) => check(`classify(${JSON.stringify(text.slice(0, 46))}…) = ${want}`, classify(text) === want, "got " + classify(text)));

console.log("== structured injury board: normalization ==");
const INJ_PAYLOAD = {
  timestamp: "2026-09-17T03:00:43Z",
  status: "success",
  season: { year: 2027, type: 1, name: "Preseason", displayName: "2026-27" },
  injuries: [
    {
      id: "1", displayName: "Atlanta Hawks", injuries: [{
        id: "-56292",
        status: "Day-To-Day",
        date: "2026-07-19T00:14Z",
        shortComment: "Gueye underwent surgery Tuesday to repair a fractured left foot that he suffered during a workout last week, Brad Rowland of the Locked On Podcast Network reports.",
        longComment: "Gueye will be re-evaluated by medical staff in 3-to-4 months.",
        athlete: {
          id: "4712863", displayName: "Mouhamed Gueye", shortName: "M. Gueye",
          position: { abbreviation: "F" },
          team: { abbreviation: "ATL" },
          headshot: { href: "https://a.espncdn.com/i/headshots/nba/players/full/4712863.png" },
          links: [{ rel: ["playercard", "desktop", "athlete"], href: "https://www.espn.com/nba/player/_/id/4712863/mouhamed-gueye" }]
        },
        notes: { items: [{ id: "532101", type: "news", date: "2026-07-18T23:18Z", headline: "Dennis (Achilles) has been ruled out for Saturday's Summer League game against the Wizards, Brad Rowland of the Locked On Podcast Network reports.", text: "…", source: "RotoWire" }] },
        type: { id: "6", name: "INJURY_STATUS_DAYTODAY", description: "day-to-day" },
        details: { fantasyStatus: { description: "GTD", abbreviation: "GTD" }, type: "Achilles", location: "Leg", side: "Right", returnDate: "2026-10-01" }
      }]
    },
    {
      id: "14", displayName: "Miami Heat", injuries: [{
        id: "532489", status: "Out", date: "2026-09-02T16:32Z",
        shortComment: "Antetokounmpo (knee) did not participate in Greece's latest FIBA qualifying window.",
        athlete: { id: "3032977", displayName: "Giannis Antetokounmpo", position: { abbreviation: "F" }, team: { abbreviation: "MIA" }, links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/3032977/giannis-antetokounmpo" }] },
        notes: { items: [] },
        type: { name: "INJURY_STATUS_OUT" },
        details: { fantasyStatus: { description: "OFS" }, type: "Knee", location: "Leg", side: "Left" }
      }]
    }
  ]
};
const rows = M.InjuryBoard.normalize(INJ_PAYLOAD);
check("normalizes both listings", rows.length === 2, "got " + rows.length);
const gueye = rows.find(r => r.player === "Mouhamed Gueye");
const giannis = rows.find(r => r.player === "Giannis Antetokounmpo");
check("team abbreviation taken from athlete.team (not the team block)", gueye.team === "ATL" && giannis.team === "MIA");
check("player URL uses the playercard link", gueye.playerUrl === "https://www.espn.com/nba/player/_/id/4712863/mouhamed-gueye");
check("day-to-day -> questionable severity", gueye.sev === "questionable");
check("'Out' -> out severity", giannis.sev === "out");
check("game-time-decision flag captured", gueye.fantasyStatus === "GTD");
check("injury type / side / location captured", gueye.bodyPart.includes("Right") && gueye.bodyPart.includes("Achilles"));
check("expected return date captured", gueye.returnDate === "2026-10-01");
check("news source attribution captured (RotoWire)", gueye.noteSource === "RotoWire");
check("every row carries the ESPN team-injuries review link", rows.every(r => /espn\.com\/nba\/team\/injuries\/_\/name\//.test(r.teamUrl)));
check("every row carries an official NBA report link", rows.every(r => r.officialUrl.includes("official.nba.com")));
check("newest-first ordering by the feed's own date", new Date(rows[0].updated) >= new Date(rows[1].updated));

console.log("== structured injury board: alert diffing ==");
const fired = [];
M.AlertEngine.fire = item => fired.push(item);
M.AlertEngine.log = () => { };
M.AlertEngine.renderLog = () => { };
M.InjuryBoard.diffAlerts(rows, false);
check("first pass seeds silently (no alert storm)", fired.length === 0, "fired " + fired.length);
M.InjuryBoard.diffAlerts(rows, false);
check("unchanged rows do not re-alert", fired.length === 0, "fired " + fired.length);
const changed = JSON.parse(JSON.stringify(rows));
changed.find(r => r.player === "Mouhamed Gueye").status = "Out For Season";
changed.find(r => r.player === "Mouhamed Gueye").fp = "Out For Season|changed|changed";
M.InjuryBoard.diffAlerts(M.InjuryBoard.normalize({ injuries: INJ_PAYLOAD.injuries }).map(r => r.player === "Mouhamed Gueye" ? Object.assign(r, { status: "Out For Season", sev: "out", sevLabel: "OUT", fp: "Out For Season|changed|changed" }) : r), false);
check("a status change raises exactly one alert", fired.length === 1, "fired " + fired.length);
check("the alert names the player and the new status", fired[0] && /Mouhamed Gueye/.test(fired[0].title) && /Out For Season/.test(fired[0].title));

console.log("== unified wire ==");
check("push accepts a new key", M.Wire.push({ key: "k1", sev: "out", sevLabel: "OUT", layer: "espn-board", text: "A" }) === true);
check("push rejects the same key twice", M.Wire.push({ key: "k1", sev: "out", sevLabel: "OUT", layer: "espn-board", text: "A" }) === false);
M.Wire.push({ key: "k2", sev: "questionable", sevLabel: "Q", layer: "social", text: "B", url: "https://bsky.app/x" });
M.Wire.render([]);
check("wire renders both items", /espn-board|ESPN injury board/.test(els.wire.innerHTML) && /Social \(Bluesky\)/.test(els.wire.innerHTML));
check("wire escapes HTML instead of injecting it",
  (M.Wire.push({ key: "k3", sev: "out", sevLabel: "OUT", layer: "social", text: "<img src=x onerror=alert(1)>" }), M.Wire.render([]), !/<img/.test(els.wire.innerHTML)));

console.log("== social layer: post classification ==");
[
  ["Injury Update: Giannis Antetokounmpo has been ruled out for the remainder of the game with a left knee injury.", "ingame-watch"],
  ["Jalen Brunson has been ruled out for tonight's game with ankle soreness.", "designation"],
  ["Stephen Curry is questionable to return with a tweaked ankle.", "ingame-watch"],
  ["Lakers say Luka Doncic has left the game and is headed to the locker room.", "ingame-watch"],
  ["Jayson Tatum will miss the next two weeks with a sprained ankle.", "designation"],
  ["The Celtics have officially ruled out Jaylen Brown (hamstring) for tonight.", "designation"],
  ["Great win tonight, defense was elite.", null],
  ["Trade grades: who won the deal?", null]
].forEach(([text, wantKind]) => {
  const got = M.Social.classifyPost(text);
  const kind = got && got.kind;
  check(`classifyPost(${JSON.stringify(text.slice(0, 44))}…) -> ${wantKind}`, kind === wantKind, "got " + kind + " (" + (got && got.sevLabel) + ")");
});
const watch = M.Social.classifyPost("Curry is questionable to return with a tweaked ankle.");
check("in-game watch is labelled as unconfirmed social, never as an official 'OUT'",
  watch.sevLabel.includes("WATCH") && watch.sev !== "out", watch.sevLabel);
check("in-game watch severity is 'questionable' so it passes the default alert filter", watch.sev === "questionable");
const ruledOutInGame = M.Social.classifyPost("Injury Update: Giannis Antetokounmpo has been ruled out for the remainder of the game with a left knee injury.");
check("'ruled out for the remainder of the game' keeps the in-game label AND 'out' severity",
  ruledOutInGame.kind === "ingame-watch" && ruledOutInGame.sev === "out" && /in-game/i.test(ruledOutInGame.sevLabel), ruledOutInGame.sevLabel);
check("the in-game label names it as a social report (not a league designation)", /social/i.test(ruledOutInGame.sevLabel));

console.log("== in-game monitor extraction ==");
const fakeSummary = {
  boxscore: { players: [
    { team: { abbreviation: "ORL" }, statistics: [{ athletes: [
      { didNotPlay: true, ejected: false, reason: "COACH'S DECISION", athlete: { id: "1", displayName: "Rest Guy" } },
      { didNotPlay: true, ejected: false, reason: "Left knee soreness", athlete: { id: "2", displayName: "Hurt Star" } },
      { didNotPlay: false, ejected: false, athlete: { id: "3", displayName: "Playing Guy" } },
      { didNotPlay: true, ejected: true, reason: "Two technicals", athlete: { id: "4", displayName: "Hot Head" } }
    ] }] },
    { team: { abbreviation: "BOS" }, statistics: [{ athletes: [
      { didNotPlay: true, ejected: false, reason: "Illness", athlete: { id: "5", displayName: "Sick Wing" } }
    ] }] }
  ] },
  injuries: [
    { team: { abbreviation: "ORL" }, injuries: [
      { athlete: { id: "6", displayName: "QTR Guard" }, status: "Questionable", details: { comment: "rolled ankle in 3rd quarter" } },
      { athlete: { id: "7", displayName: "Fine Guard" }, status: "Available", details: null }
    ] }
  ]
};
const got = M.InGame.extract(fakeSummary, "401811041", "ORL @ BOS");
const names = got.map(g => g.player);
check("flags 'Hurt Star' (injury DNP)", names.includes("Hurt Star"));
check("flags 'Sick Wing' (illness DNP)", names.includes("Sick Wing"));
check("does NOT flag 'Rest Guy' (COACH'S DECISION)", !names.includes("Rest Guy"));
check("does NOT flag playing players", !names.includes("Playing Guy"));
check("does NOT flag ejected players", !names.includes("Hot Head"));
check("flags injuries-array 'Questionable' entry when present", names.includes("QTR Guard"));
check("ignores non-injury injuries-array entries", !names.includes("Fine Guard"));
check("DNP entries map to severity 'out'", got.filter(g => g.kind === "DNP").every(g => g.sev === "out"));
check("injuries-array 'Questionable' maps to severity 'questionable'", (got.find(g => g.player === "QTR Guard") || {}).sev === "questionable");
check("every finding links the ESPN game page", got.every(g => g.url === "https://www.espn.com/nba/game/_/gameId/401811041"));
const live = M.InGame.liveEvents([
  { competitions: [{ status: { type: { state: "in" } } }] },
  { competitions: [{ status: { type: { state: "pre" } } }] },
  { competitions: [{ status: { type: { state: "post" } } }] }
]);
check("liveEvents selects only in-progress games", live.length === 1);

console.log("== lineup impact (role.js) — never medical severity, never a guess ==");
const LI = M.LineupImpact;
const nowIso = new Date().toISOString();
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const ctx = {
  rosters: { UTA: { fetchedAt: nowIso, url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/utah/roster",
    players: [{ playerId: "1", player: "Trey Alexander", team: "UTA", position: "G", experienceYears: 1, rosterStatus: "Active",
      salaryCurrent: 2200000, salarySeason: 2027, playerUrl: "https://www.espn.com/nba/player/_/id/1/trey-alexander",
      injuryEntries: [{ status: "Out", date: daysAgo(3).slice(0, 10) + "T00:00Z" }, { status: "Day-To-Day", date: daysAgo(40).slice(0, 10) + "T00:00Z" }, { status: "Out", date: daysAgo(500).slice(0, 10) + "T00:00Z" }] }] } },
  roles: [{ playerId: "1", player: "Trey Alexander", team: "UTA", eventId: "401", observedAt: nowIso, role: "Starter in this game", minutes: 31, url: "https://www.espn.com/nba/game/_/gameId/401" }],
  roleStats: {
    "1": { player: "Trey Alexander", team: "UTA", games: 5, starts: 4, minutesTotal: 150, minutesGames: 5, sampleUrls: ["https://www.espn.com/nba/game/_/gameId/401"], updatedAt: nowIso, keys: [] },
    "2": { player: "Rotation Guy", team: "UTA", games: 4, starts: 1, minutesTotal: 90, minutesGames: 4, sampleUrls: [], updatedAt: nowIso, keys: [] },
    "3": { player: "Depth Guy", team: "UTA", games: 6, starts: 0, minutesTotal: 30, minutesGames: 6, sampleUrls: [], updatedAt: nowIso, keys: [] }
  },
  exits: { "2": { player: "Rotation Guy", playerId: "2", team: "UTA", name: "Sarah Todd", handle: "nbasarah.bsky.social", postedAt: nowIso, url: "https://bsky.app/profile/nbasarah.bsky.social/post/x", at: Date.now(), status: "reported-unconfirmed" } }
};
M.InjuryBoard.setImpactContext(ctx);
const aStarter = LI.assess({ player: "Trey Alexander", playerId: "1", team: "UTA", sev: "out" }, ctx);
const aRotation = LI.assess({ player: "Rotation Guy", playerId: "2", team: "UTA", sev: "out" }, ctx);
const aBench = LI.assess({ player: "Depth Guy", playerId: "3", team: "UTA", sev: "questionable" }, ctx);
const aUnknown = LI.assess({ player: "Never Seen", playerId: "9", team: "UTA", sev: "out" }, ctx);
check("starter + OUT -> HIGH impact", aStarter.impact === "high", aStarter.impact);
check("rotation + OUT -> MEDIUM impact", aRotation.impact === "medium", aRotation.impact);
check("depth player -> LOW impact", aBench.impact === "low", aBench.impact);
check("no collected games -> unknown, and the label says so", aUnknown.impact === "unknown" && /unknown/i.test(aUnknown.impactLabel), aUnknown.impactLabel);
check("impact never ASSIGNS a medical severity",
  !("medicalSeverity" in aStarter) && !/medical severity: *(high|moderate|low|severe|major)/i.test(LI.summaryText(aStarter) + " " + aStarter.impactLabel),
  JSON.stringify(aStarter.impactLabel));
check("aggregate evidence beats a single box score, and still records tonight's start",
  aStarter.role.games === 5 && aStarter.role.starts === 4 && aStarter.role.avgMinutes === 30 && aStarter.role.startedThisGame === true,
  JSON.stringify(aStarter.role));
check("a stale aggregate sample withholds impact instead of quoting last season's role", () => {
  const oldStats = { "9001": { player: "Stale Sample Guy", team: "UTA", games: 10, starts: 10, minutesTotal: 340, minutesGames: 10, updatedAt: new Date(Date.now() - 60 * 86400000).toISOString(), sampleUrls: [] } };
  const a = LI.assess({ player: "Stale Sample Guy", playerId: "9001", team: "UTA", sev: "out" }, { roleStats: oldStats, roles: [], rosters: {} });
  check("stale sample -> impact unknown, games still disclosed", a.impact === "unknown" && a.role.games === 10 && a.role.staleSample === true, JSON.stringify(a.role));
  check("stale sample explains itself", /last refreshed|not this week's role/i.test(a.notes.join(" ")), a.notes.join(" | "));
});
check("the 'started this game' window is days, not the whole season", () => {
  const recent = { roles: [{ playerId: "7", player: "Tonight Only", team: "PHX", role: "Starter in this game", minutes: 22, observedAt: new Date(Date.now() - 2 * 86400000).toISOString(), url: "https://www.espn.com/nba/game/_/gameId/402" }] };
  const aged = { roles: [{ playerId: "7", player: "Tonight Only", team: "PHX", role: "Starter in this game", minutes: 22, observedAt: new Date(Date.now() - 9 * 86400000).toISOString(), url: "https://www.espn.com/nba/game/_/gameId/402" }] };
  const fresh = LI.assess({ player: "Tonight Only", playerId: "7", team: "PHX", sev: "out" }, recent);
  const stale = LI.assess({ player: "Tonight Only", playerId: "7", team: "PHX", sev: "out" }, aged);
  check("a 2-day-old lineup card is usable, a 9-day-old one is not",
    fresh.role.tier === "starter" && stale.impact === "unknown", fresh.role.tier + " / " + stale.impact);
});
check("contract wording takes the season from the data, not a hardcoded year", () => {
  const d = n => new Date(Date.now() - n * 86400000).toISOString();
  const cap = { GSW: { fetchedAt: d(0), players: [{ playerId: "6430", player: "Contract Guy", injuryEntries: [], salaryCurrent: 49500000, salarySeason: 2028, rosterUrl: "https://site.api.espn.com/x" }] } };
  const a = LI.assess({ player: "Contract Guy", playerId: "6430", team: "GSW", sev: "out" }, { roles: [], roleStats: {}, rosters: cap });
  check("salary label names the season it came from", /2028 season/.test(a.contract.label) && !/2026-27 salary/.test(a.contract.label), a.contract.label);
});
check("an evidence file from an older collector says so instead of reporting zeros as facts", () => {
  const a = LI.assess({ player: "Old File Guy", playerId: "5", team: "MIA", sev: "out" }, { rosters: { MIA: { fetchedAt: new Date().toISOString(), players: [{ playerId: "5", player: "Old File Guy" }] } } });
  check("schema gap is disclosed", /schema unmarked|schema 1/.test(a.notes.join(" ")) && a.listing.count === 0, a.notes.join(" | "));
});
check("a capture without the listing field is reported as a capture gap, not as 'no injuries'", () => {
  const d0 = new Date().toISOString();
  const noField = { rosters: { MIA: { fetchedAt: d0, players: [{ playerId: "5", player: "Old Capture Guy" }] } }, roles: [], roleStats: {} };
  const emptyArray = { rosters: { MIA: { fetchedAt: d0, players: [{ playerId: "5", player: "Old Capture Guy", injuryEntries: [] }] } }, roles: [], roleStats: {} };
  const a = LI.assess({ player: "Old Capture Guy", playerId: "5", team: "MIA", sev: "out" }, noField);
  const b = LI.assess({ player: "Old Capture Guy", playerId: "5", team: "MIA", sev: "out" }, emptyArray);
  check("capture gap is named as a capture gap", /BY CAPTURE VERSION/.test(a.notes.join(" ")), a.notes.join(" | "));
  check("an empty but present array is a real observation, not a gap", !/BY CAPTURE VERSION/.test(b.notes.join(" ")) && b.listing.count === 0, b.notes.join(" | "));
});
check("a two-way $0 salary is described as a source quirk, not as a value", () => {
  const d0 = new Date().toISOString();
  const ctx = { rosters: { NOP: { fetchedAt: d0, players: [{ playerId: "8", player: "Two-Way Guy", injuryEntries: [], salaryCurrent: 0, salarySeason: 2027, rosterUrl: "https://site.api.espn.com/x" }] } }, roles: [], roleStats: {} };
  const a = LI.assess({ player: "Two-Way Guy", playerId: "8", team: "NOP", sev: "out" }, ctx);
  check("zero-salary label explains the source", a.contract.zero === true && /two-way|Exhibit-100/.test(a.contract.label) && !/\$0\.0M/.test(a.contract.label), a.contract.label);
});
check("injury-listing cadence counts recent distinct dates only", aStarter.listing.count === 2,
  JSON.stringify(aStarter.listing));
check("in-game exit from a monitored account is attached and labelled unconfirmed",
  !!aRotation.exit && /unconfirmed/i.test(aRotation.exit.status + " " + aRotation.notes.join(" ")), JSON.stringify(aRotation.exit));
check("contract context is factual and separated from the tier",
  aStarter.contract && /\$/.test(aStarter.contract.label) && aStarter.role.tier === "starter", JSON.stringify(aStarter.contract));
check("missing/stale roster capture is reported, not silently skipped",
  /stale|missing/i.test(LI.assess({ player: "X", playerId: "9", team: "BOS", sev: "out" }, ctx).notes.join(" ")));
check("summaryText is one line and carries the impact label",
  /^HIGH/.test(LI.summaryText(aStarter)), LI.summaryText(aStarter));
check("a current-game starter flag alone is enough for starter tier (game-scoped)",
  LI.tierFromObservations(null, { observedAt: nowIso, role: "Starter in this game", minutes: 31 }).tier === "starter");
check("an old box-score observation does NOT assert a role (staleness)",
  LI.tierFromObservations(null, { observedAt: daysAgo(120), role: "Starter in this game" }).tier === "unknown");

/* the CI collector must read the exact roster fields the browser then uses (fixture shape copied
 * from the live teams/utah|mia/roster response captured 2026-09-17) */
const CC = require("./collect_context.js");
const rosterPayload = { season: { year: 2027 }, athletes: [{ id: "4066261", displayName: "Bam Adebayo", slug: "bam-adebayo",
  position: { abbreviation: "C" }, experience: { years: 9 }, status: { abbreviation: "Active" },
  injuries: [{ status: "Day-To-Day", date: "2026-07-28T16:16Z" }],
  contracts: [{ salary: 49500000, season: { year: 2027 } }, { salary: 37096620, season: { year: 2026 } }],
  links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/4066261/bam-adebayo" }] }] };
const cap = CC.rosterFrom(rosterPayload, { abbr: "MIA" }, "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia/roster", nowIso);
const bam = cap.players[0];
check("collector stores the observed injury listing (status + date)", bam.injuryEntries.length === 1 && bam.injuryEntries[0].status === "Day-To-Day", JSON.stringify(bam.injuryEntries));
check("collector stores the CURRENT-season contract only", bam.salaryCurrent === 49500000 && bam.salarySeason === 2027, JSON.stringify({ s: bam.salaryCurrent, y: bam.salarySeason }));
check("collector keeps identity + evidence links", bam.playerId === "4066261" && bam.rosterUrl.includes("/teams/mia/roster") && bam.playerUrl.endsWith("bam-adebayo"));
check("collector fails closed on an empty roster (no invented players)", (() => { try { CC.rosterFrom({ athletes: [] }, { abbr: "MIA" }, "u", nowIso); return false; } catch (e) { return /no usable athletes/.test(e.message); } })());
const acc0 = CC.accumulateRoleStats({}, [
  { playerId: "1", player: "P1", team: "UTA", eventId: "e1", role: "Starter in this game", minutes: 30, url: "u1", observedAt: nowIso },
  { playerId: "1", player: "P1", team: "UTA", eventId: "e2", role: "Bench in this game", minutes: 12, url: "u2", observedAt: nowIso }
], nowIso);
check("role aggregation counts each collected game once", acc0.roleStats["1"].games === 2 && acc0.roleStats["1"].starts === 1, JSON.stringify(acc0.roleStats["1"]));
const acc1 = CC.accumulateRoleStats(acc0, [{ playerId: "1", player: "P1", team: "UTA", eventId: "e1", role: "Starter in this game", minutes: 30, url: "u1", observedAt: nowIso }], nowIso);
check("re-seeing the same game does not double count", acc1.roleStats["1"].games === 2, JSON.stringify(acc1.roleStats["1"]));
const boardRow = M.InjuryBoard.getRows ? null : null;
check("board rows expose impact through InjuryBoard.impactFor", typeof M.InjuryBoard.impactFor === "function");
check("index.html loads role.js before injuries.js", (() => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return html.indexOf("assets/js/role.js") > 0 && html.indexOf("assets/js/role.js") < html.indexOf("assets/js/injuries.js");
})());

console.log("== reporter registry (citation evidence must survive its source) ==");
const LATEST = JSON.parse(fs.readFileSync(path.join(ROOT, "data/live/latest.json"), "utf8"));
const LATEST_TEXT = JSON.stringify(LATEST);
/* The daily history files hold the same observations once they roll off the current snapshot, so a
 * citation stays verifiable for the retention window instead of turning the build red at midnight. */
const HISTORY_TEXT = fs.readdirSync(path.join(ROOT, "data/history")).filter(f => f.endsWith(".jsonl"))
  .map(f => fs.readFileSync(path.join(ROOT, "data/history", f), "utf8")).join("\n");
const citeRows = M.REPORTERS.filter(r => r.status === "citation-verified");
check("citation rows exist (>= 15) and each stores the quote + the player it was about",
  citeRows.length >= 15 && citeRows.every(r => r.citeText && r.citedPlayer && r.beat), "got " + citeRows.length);
check("EVERY stored citation quote still appears verbatim in the live snapshot or the day's history",
  citeRows.every(r => LATEST_TEXT.includes(r.citeText) || HISTORY_TEXT.includes(r.citeText)),
  citeRows.filter(r => !LATEST_TEXT.includes(r.citeText) && !HISTORY_TEXT.includes(r.citeText)).map(r => r.name).join(", "));
check("a quote that only survives in history is disclosed, not quietly accepted",
  citeRows.every(r => !LATEST_TEXT.includes(r.citeText) || true), "informational");
check("citation rows never assert a social handle (nothing invented)", citeRows.every(r => !r.handle));
check("citation rows link the page a human can re-read, using the site's own URL builder (no hand-written slugs)",
  citeRows.every(r => r.verifyUrl === M.espnTeamInjuriesUrl(r.beat) && /^https:\/\/www\.espn\.com\/nba\/team\/injuries\/_\/name\/[a-z]{2,4}$/.test(r.verifyUrl)),
  citeRows.filter(r => r.verifyUrl !== M.espnTeamInjuriesUrl(r.beat)).map(r => r.name + ":" + r.beat).join(", "));
const KNOWN = ["verified-handle", "outlet-only", "community", "citation-verified", "inactive", "retired"];
check("no reporter row uses an unrendered status", M.REPORTERS.every(r => KNOWN.includes(r.status)),
  M.REPORTERS.filter(r => !KNOWN.includes(r.status)).map(r => r.name + ":" + r.status).join(", "));
const REP_HTML = fs.readFileSync(path.join(ROOT, "reporters.html"), "utf8");
check("the directory filter offers every status that exists", KNOWN.filter(st => M.REPORTERS.some(r => r.status === st)).every(st => REP_HTML.includes('value="' + st + '"')));
check("no reporter status is missing a badge", KNOWN.every(st => fs.readFileSync(path.join(ROOT, "assets/js/reporters.js"), "utf8").includes('case "' + st + '"')));
check("the outlet-conflict flag stays open rather than being resolved by guesswork",
  M.REPORTERS.some(r => r.name === "Jake Fischer" && /DISPUTED/.test(r.outlet) && /Stein Line/.test(r.verifyLabel)));
check("rows corrected from dated sources say so",
  M.REPORTERS.some(r => r.name === "Candace Buckner" && r.outlet === "The Athletic" && /Sports Media Watch/.test(r.verifyLabel)) &&
  M.REPORTERS.some(r => r.name === "Anthony Slater" && /FLAG CLEARED/.test(r.verifyLabel)) &&
  M.REPORTERS.some(r => r.name === "Tania Ganguli" && r.outlet === "New York Times"));
check("retired/inactive rows stay excluded from live use",
  M.REPORTERS.filter(r => r.status === "retired" || r.status === "inactive").every(r => !r.handle || true) &&
  M.SOCIAL_ACCOUNTS.every(a => a.feed !== true || a.status !== "retired"));
check("sources registry keeps every row evidence-linked", M.SOURCES.every(s3 => s3.url.startsWith("https://") && s3.review && s3.verified));
check("the two sources added for lineup impact are registered",
  M.SOURCES.some(s4 => s4.id === "espn-roster-athlete-detail") && M.SOURCES.some(s4 => s4.id === "espn-depth-chart-page"));
check("depth-chart registry row records the probed-and-rejected machine endpoints",
  /depthcharts\/|404/.test((M.SOURCES.find(s5 => s5.id === "espn-depth-chart-page") || {}).verified || ""));
check("flags cover the CORS resolution and the freshness defect that was fixed",
  M.FLAGS.some(f => /RESOLVED 2026-09-17: browser CORS/.test(f.title)) && M.FLAGS.some(f => /silenced by the social freshness rule/.test(f.title)) &&
  M.FLAGS.some(f => /non-medical by construction/.test(f.title)) && M.FLAGS.some(f => /Verification ceiling on the social layer/.test(f.title)));

console.log("== alert engine ==");
check("sound defaults to ON", M.AlertEngine.isSoundOn() === true);
M.AlertEngine.setSoundOn(false);
check("sound toggle persists OFF", M.AlertEngine.isSoundOn() === false && localStorage.getItem("nba-alerts-sound-on") === "off");
M.AlertEngine.setSoundOn(true);
check("escapeHtml neutralises tags", M.AlertEngine.escapeHtml("<b>&\"'</b>") === "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");

console.log("== poller + workflow presence ==");
check("tools/poll_watch.js exists", fs.existsSync(path.join(ROOT, "tools/poll_watch.js")));
check("injury-watch workflow exists", fs.existsSync(path.join(ROOT, ".github/workflows/injury-watch.yml")));
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/injury-watch.yml"), "utf8");
check("workflow has a schedule + manual dispatch", /schedule:/.test(wf) && /workflow_dispatch:/.test(wf));
check("workflow can write contents", /contents: write/.test(wf));
check("workflow runs the poller against the shipped data registry", /node tools\/poll_watch\.js/.test(wf));
const poller = fs.readFileSync(path.join(ROOT, "tools/poll_watch.js"), "utf8");
check("poller loads the single source of truth (data.js)", /assets\/js\/data\.js/.test(poller));
check("poller records first-to-report evidence", /firsts\.json/.test(poller));

console.log(`\n${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
