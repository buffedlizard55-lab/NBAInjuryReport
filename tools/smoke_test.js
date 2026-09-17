#!/usr/bin/env node
/* Smoke tests for the NBA Injury Alert System logic — no browser required.
 * Run from repo root:  node tools/smoke_test.js
 * Exits non-zero on failure. */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataSrc = fs.readFileSync(path.join(root, "assets/js/data.js"), "utf8");
const ingameSrc = fs.readFileSync(path.join(root, "assets/js/ingame.js"), "utf8");

// Evaluate data.js + ingame.js together. Both are DOM-free at load time
// (all browser APIs are only touched inside functions).
const load = new Function(dataSrc + "\n" + ingameSrc + `
  return { TEAMS, TEAM_ALIASES, REPORTERS, SOURCES, FLAGS, SIGNALS, ENDPOINTS,
           teamByAbbr, espnTeamInjuriesUrl, xSearchUrl, InGame };
`);
const { TEAMS, TEAM_ALIASES, REPORTERS, SOURCES, FLAGS, SIGNALS, ENDPOINTS,
        teamByAbbr, espnTeamInjuriesUrl, xSearchUrl, InGame } = load();

let pass = 0, failCount = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { failCount++; console.error("  ✗ FAIL:", name, extra || ""); }
}

console.log("== data integrity ==");
check("30 teams", TEAMS.length === 30);
check("unique abbreviations", new Set(TEAMS.map(t => t.abbr)).size === 30);
check("every alias map key matches a team", Object.keys(TEAM_ALIASES).every(a => !!teamByAbbr(a)));
check("team injury URL pattern", espnTeamInjuriesUrl("MIA") === "https://www.espn.com/nba/team/injuries/_/name/mia");
check("reporter count is 36", REPORTERS.length === 36, "got " + REPORTERS.length);
check("reporter names unique", new Set(REPORTERS.map(r => r.name)).size === REPORTERS.length);
check("every reporter has a verifyUrl", REPORTERS.every(r => r.verifyUrl && r.verifyUrl.startsWith("http")));
check("verified-handle rows assert a handle; outlet-only rows assert none",
  REPORTERS.every(r => (r.status === "verified-handle") ? !!r.handle : (r.status === "outlet-only") ? !r.handle : true));
check("Wojnarowski is marked retired (never a live source)",
  (REPORTERS.find(r => r.name === "Adrian Wojnarowski") || {}).status === "retired");
check("every source has id/name/url/verified/review", SOURCES.every(s => s.id && s.name && s.url && s.verified && s.review));
check("flags present", FLAGS.length >= 8);
check("summary endpoint constant present", typeof ENDPOINTS.summary === "string" && ENDPOINTS.summary.includes("summary?event="));

console.log("== classifier (headline -> severity) ==");
function classify(text) { for (const s of SIGNALS) if (s.re.test(text)) return s.sev; return null; }
const cases = [
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
];
for (const [text, want] of cases) check(`classify(${JSON.stringify(text.slice(0, 48))}…) = ${want}`, classify(text) === want, "got " + classify(text));

console.log("== in-game monitor extraction ==");
// Realistic summary fragment modeled on the VERIFIED 2026-04-12 payload (boxscore.players[].statistics[].athletes[]).
const fakeSummary = {
  boxscore: { players: [
    { team: { abbreviation: "ORL" }, statistics: [{ athletes: [
      { didNotPlay: true, ejected: false, reason: "COACH'S DECISION", // directly observed non-injury value -> must NOT alert
        athlete: { id: "1", displayName: "Rest Guy" } },
      { didNotPlay: true, ejected: false, reason: "Left knee soreness",
        athlete: { id: "2", displayName: "Hurt Star" } },
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
const got = InGame.extract(fakeSummary, "401811041", "ORL @ BOS");
const names = got.map(g => g.player);
check("flags 'Hurt Star' (injury DNP)", names.includes("Hurt Star"));
check("flags 'Sick Wing' (illness DNP)", names.includes("Sick Wing"));
check("does NOT flag 'Rest Guy' (COACH'S DECISION)", !names.includes("Rest Guy"));
check("does NOT flag playing players", !names.includes("Playing Guy"));
check("does NOT flag ejected players", !names.includes("Hot Head"));
check("flags injuries-array 'Questionable' entry when present", names.includes("QTR Guard"));
check("ignores non-injury injuries-array entries", !names.includes("Fine Guard"));
check("DNP entries map to severity 'out'", got.filter(g => g.kind === "DNP").every(g => g.sev === "out"));
check("injuries-array 'Questionable' maps to severity 'questionable'",
  (got.find(g => g.player === "QTR Guard") || {}).sev === "questionable");
check("every finding links the ESPN game page", got.every(g => g.url === "https://www.espn.com/nba/game/_/gameId/401811041"));
const live = InGame.liveEvents([
  { competitions: [{ status: { type: { state: "in" } } }] },
  { competitions: [{ status: { type: { state: "pre" } } }] },
  { competitions: [{ status: { type: { state: "post" } } }] }
]);
check("liveEvents selects only in-progress games", live.length === 1);

console.log(`\n${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
