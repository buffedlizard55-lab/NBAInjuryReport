#!/usr/bin/env node
/* =====================================================================================
 * impact_test.js — tests for the LINEUP IMPACT INTELLIGENCE LAYER (model v2)
 *
 * What this pins, in the order the model is built:
 *   1. assets/js/geo.js        city coordinates, great-circle distance, time-zone offsets,
 *                              rest days, the documented travel model, and the refusal to
 *                              resolve a city it does not know.
 *   2. tools/collect_context.js keyed stat-line parsing, per-event dedupe of role/production
 *                              accumulation, per-team production baselines, and the schedule
 *                              -> travel chain.
 *   3. assets/js/role.js       the three components, their weights and renormalisation, the
 *                              four grade rules, the availability-risk split, and the two
 *                              promises the UI makes: never a medical grade, never a guess.
 *
 * Run: node tools/impact_test.js
 * ===================================================================================== */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const Geo = require(path.join(ROOT, "assets/js/geo.js"));
const LI = require(path.join(ROOT, "assets/js/role.js"));
const CC = require(path.join(ROOT, "tools/collect_context.js"));
const vm = require("vm");
/* data.js is a plain browser script; run it in a sandbox so the test can assert against the REAL
 * team registry instead of a copy that could drift from it. */
function loadData() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  /* `const` at the top level of a vm script creates a LEXICAL binding, not a property of the
   * sandbox object — the first version of this helper read an empty registry and the checks below
   * passed vacuously. Expose them explicitly, and fail loudly rather than testing nothing. */
  vm.runInContext(fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8") +
    ";globalThis.__data = { TEAMS, SOURCES, FLAGS, SIGNALS };", sandbox);
  const D = sandbox.__data;
  if (!D || !Array.isArray(D.TEAMS) || D.TEAMS.length !== 30) {
    throw Error("data.js registry did not load (TEAMS: " + (D && D.TEAMS && D.TEAMS.length) + ")");
  }
  return D;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}
function close(a, b, tol) { return a != null && b != null && Math.abs(a - b) <= tol; }

const now = new Date().toISOString();
const iso = ms => new Date(ms).toISOString();

/* ============================== 1. geo.js ========================================= */
console.log("== geo.js — distance, time zones, rest, travel model ==");
const bos = Geo.coordsFor("Boston"), lax = Geo.coordsFor("Los Angeles");
check("a mapped city resolves", !!bos && bos.tz === "America/New_York");
check("an unmapped city returns null rather than an approximation",
  Geo.coordsFor("Boise") === null && Geo.coordsFor("") === null);
check("the venue names the LIVE 2026-27 feed actually used now resolve (Inglewood/Intuit Dome, Boulder, Ames, Tulsa)",
  !!Geo.coordsFor("Inglewood", "CA") && !!Geo.coordsFor("Boulder", "CO") && !!Geo.coordsFor("Ames", "IA") && !!Geo.coordsFor("Tulsa", "OK"));
check("a venue-name resolution carries its weaker provenance instead of looking like feed data",
  Geo.coordsForVenue("Venetian Arena").venueNameResolved === true && Geo.coordsForVenue("Venetian Arena").city === "Las Vegas" &&
  Geo.coordsForVenue("Not A Real Arena") === null);
check("the Clippers' arena city overrides their feed city for the travel-origin fallback only",
  Geo.homeCoords({ abbr: "LAC", city: "Los Angeles" }).city === "Inglewood" &&
  Geo.homeCoords({ abbr: "LAL", city: "Los Angeles" }).city === "Los Angeles");
check("EVERY club's home city resolves — a region name in TEAMS.city must never silently null a travel leg",
  (() => {
    const D = loadData();
    const bad = (D.TEAMS || []).filter(t => !Geo.homeCoords(t));
    if (bad.length) console.log("      unresolved home cities: " + bad.map(t => t.abbr + " (" + t.city + ")").join(", "));
    return bad.length === 0;
  })());
check("the five clubs whose TEAMS.city is a region name are mapped to a real city",
  (() => {
    const D = loadData();
    const regions = (D.TEAMS || []).filter(t => !Geo.coordsFor(t.city, null)).map(t => t.abbr).sort();
    const mapped = Object.keys(Geo.TEAM_HOME_CITY).sort();
    if (regions.join(",") !== mapped.join(",")) console.log("      regions: " + regions.join(",") + " | mapped: " + mapped.join(","));
    return regions.join(",") === mapped.join(",");
  })());
check("every club's home city carries a usable IANA time zone (the home half of every time-zone shift)",
  (() => {
    const D = loadData();
    const now = new Date().toISOString();
    const bad = (D.TEAMS || []).filter(t => {
      const h = Geo.homeCoords(t);
      return !h || Geo.utcOffsetHours(h.tz, now) == null;
    });
    if (bad.length) console.log("      no time zone: " + bad.map(t => t.abbr).join(", "));
    return bad.length === 0;
  })());
check("every NBA team home city resolves", ["Atlanta", "Boston", "Brooklyn", "Charlotte", "Chicago", "Cleveland", "Dallas",
  "Denver", "Detroit", "San Francisco", "Houston", "Indianapolis", "Los Angeles", "Memphis", "Miami", "Milwaukee",
  "Minneapolis", "New Orleans", "New York", "Oklahoma City", "Orlando", "Philadelphia", "Phoenix", "Portland",
  "Sacramento", "Salt Lake City", "San Antonio", "Toronto", "Washington"].every(c => !!Geo.coordsFor(c)));
check("Boston -> Los Angeles is ~2,591 city-centre miles (public great-circle value ~2,611; <=10% apart)",
  close(Geo.haversineMiles(bos, lax), 2591, 20), String(Geo.haversineMiles(bos, lax)));
check("New York -> Brooklyn is a cross-town hop, not a flight",
  Geo.haversineMiles(Geo.coordsFor("New York"), Geo.coordsFor("Brooklyn")) < 10);
check("the same city is zero distance", Geo.haversineMiles(lax, Geo.coordsFor("Los Angeles")) === 0);
check("Chicago -> New York is ~711 miles (public value ~713)", close(Geo.haversineMiles(Geo.coordsFor("Chicago"), Geo.coordsFor("New York")), 711, 15));
check("a short trip is modelled as ground, a long one as air",
  Geo.estimateTravel(Geo.coordsFor("New York"), Geo.coordsFor("Philadelphia")).mode === "ground (model)" &&
  Geo.estimateTravel(bos, lax).mode === "air (model)");
check("travel time uses the documented model, not an invented number",
  close(Geo.estimateTravel(bos, lax).hours, 2591 / Geo.TRAVEL_MODEL.cruiseMph + Geo.TRAVEL_MODEL.airportOverheadHours, 0.2));
check("an unmapped endpoint is reported as unmapped, with no distance",
  Geo.estimateTravel(bos, Geo.coordsFor("Boise")).unmapped === true && Geo.estimateTravel(bos, Geo.coordsFor("Boise")).miles === null);
check("winter offsets are read from the tz database, not hard-coded (ET -5, PT -8, AZ -7)",
  Geo.utcOffsetHours("America/New_York", "2027-01-15T00:00:00Z") === -5 &&
  Geo.utcOffsetHours("America/Los_Angeles", "2027-01-15T00:00:00Z") === -8 &&
  Geo.utcOffsetHours("America/Phoenix", "2027-01-15T00:00:00Z") === -7);
check("summer offsets shift with DST (ET -4)", Geo.utcOffsetHours("America/New_York", "2026-07-15T00:00:00Z") === -4);
check("rest days: same calendar day is 0 (a back-to-back), skipping two days is 2",
  Geo.restDaysBetween("2026-10-03T23:00:00Z", "2026-10-04T23:00:00Z") === 0 &&
  Geo.restDaysBetween("2026-10-03T23:00:00Z", "2026-10-06T23:00:00Z") === 2);
check("a venue with an empty address is resolved from its name AND flagged on the row",
  (() => {
    const team = { abbr: "LAC", city: "Los Angeles", name: "Clippers" };
    const pay = { season: { displayName: "2026-27" }, events: [{ id: "V1", date: "2026-10-09T12:00Z", competitions: [{ date: "2026-10-09T12:00Z", venue: { fullName: "Venetian Arena", address: {} }, competitors: [{ homeAway: "away", team: { abbreviation: "LAC" } }, { homeAway: "home", team: { abbreviation: "DAL" } }], status: { type: { state: "pre", completed: false } } }] }] };
    const s = CC.scheduleFrom(pay, team, "u", "2026-09-18T03:00:00Z");
    const g = s.games[0];
    return g.venueNameResolved === true && g.city === "Las Vegas" && s.unresolvedCities.length === 0 && g.travelMiles > 100;
  })());
check("a state mismatch is flagged for review instead of silently shifting the lookup",
  !!(Geo.coordsFor("Portland", "ME") || {}).stateMismatch && !(Geo.coordsFor("Portland", "OR") || {}).stateMismatch);

/* ==================== 2. collect_context.js (pure functions) ====================== */
console.log("== collect_context.js — keyed stat lines, dedupe, team baselines, schedule chain ==");
const KEYS = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks",
  "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus"];
const GARZA = ["38", "27", "10-18", "3-6", "4-4", "12", "1", "2", "1", "0", "4", "8", "4", "+13"];
const line = CC.parseStatLine(KEYS, GARZA);
check("stat lines are read by KEY, so a reordered key list cannot shift the columns",
  line.points === 27 && line.rebounds === 12 && line.assists === 1 && line.plusMinus === 13 && line.minutes === 38,
  JSON.stringify(line));
check("a reordered key list yields reordered values, not corrupted ones",
  CC.parseStatLine(["points", "rebounds"], ["12", "27"]).points === 12);
check("made-attempted strings and negatives are parsed, empties are skipped",
  CC.parseStatLine(["points", "plusMinus", "rebounds"], ["10-18", "-14", ""]).points === 10 &&
  CC.parseStatLine(["points", "plusMinus", "rebounds"], ["10-18", "-14", ""]).plusMinus === -14 &&
  CC.parseStatLine(["points", "plusMinus", "rebounds"], ["10-18", "-14", ""]).rebounds === undefined);

function summaryFixture(team, playerId, player, starter, stats, reason) {
  return { boxscore: { players: [{ team: { abbreviation: team }, statistics: [{ keys: KEYS, athletes: [
    { athlete: { id: playerId, displayName: player }, starter, didNotPlay: !stats.length, reason: reason || "COACH'S DECISION", stats }
  ] }] }] } };
}
const rowsA = CC.roles(summaryFixture("GS", "1", "Star Guy", true, GARZA), "E1", now);
check("a box-score row carries minutes, production, on-court net and the game link",
  rowsA[0].points === 27 && rowsA[0].plusMinus === 13 && rowsA[0].team === "GSW" && /gameId\/E1/.test(rowsA[0].url));
const acc1 = CC.accumulateRoleStats({}, rowsA.concat(CC.roles(summaryFixture("GS", "2", "Bench Guy", false, ["10", "2", "1-3", "0-1", "0-0", "1", "1", "0", "0", "0", "0", "1", "1", "-4"]), "E1", now)), now);
check("one game contributes one aggregate row per player and one team baseline",
  acc1.roleStats["1"].games === 1 && acc1.teamStats.GSW.games === 1 && acc1.teamStats.GSW.pointsTotal === 29,
  JSON.stringify(acc1.teamStats));
const acc2 = CC.accumulateRoleStats(acc1, rowsA, now);
check("re-reading the SAME event id never inflates games, starts or the team baseline",
  acc2.roleStats["1"].games === 1 && acc2.roleStats["1"].starts === 1 && acc2.teamStats.GSW.games === 1,
  JSON.stringify({ r: acc2.roleStats["1"].games, t: acc2.teamStats.GSW.games }));
const acc3 = CC.accumulateRoleStats(acc2, CC.roles(summaryFixture("GS", "1", "Star Guy", true, ["40", "30", "11-20", "4-9", "4-4", "8", "5", "2", "1", "1", "1", "7", "2", "+8"]), "E2", now), now);
check("a NEW event id accumulates (2 games, 2 starts, 57 team points)",
  acc3.roleStats["1"].games === 2 && acc3.roleStats["1"].starts === 2 && acc3.teamStats.GSW.pointsTotal === 59,
  JSON.stringify({ g: acc3.roleStats["1"].games, t: acc3.teamStats.GSW.pointsTotal }));
check("per-game minutes are kept for the median",
  Array.isArray(acc3.roleStats["1"].minutesValues) && acc3.roleStats["1"].minutesValues.length === 2);
check("the event ledger is bounded but far larger than a season",
  acc3.roleEventIds.length === 2 && LI.CONFIG && CC.accumulateRoleStats({ roleEventIds: Array.from({ length: 5000 }, (_, i) => "X" + i) }, [], now).roleEventIds.length === 1500);

const MIA = { abbr: "MIA", city: "Miami", name: "Heat" };
const schedulePayload = { season: { displayName: "2026-27" }, events: [
  { id: "P1", date: "2026-10-03T23:00Z", competitions: [{ date: "2026-10-03T23:00Z", venue: { fullName: "Videotron Centre", address: { city: "Quebec City", state: "PQ" } },
    competitors: [{ homeAway: "away", team: { abbreviation: "MIA" } }, { homeAway: "home", team: { abbreviation: "TOR" } }],
    status: { type: { state: "pre", completed: false } } }] },
  { id: "P2", date: "2026-10-06T23:30Z", competitions: [{ date: "2026-10-06T23:30Z", venue: { fullName: "Kaseya Center", address: { city: "Miami", state: "FL" } },
    competitors: [{ homeAway: "home", team: { abbreviation: "MIA" } }, { homeAway: "away", team: { abbreviation: "ATL" } }],
    status: { type: { state: "pre", completed: false } } }] },
  { id: "P0", date: "2026-09-30T23:00Z", competitions: [{ date: "2026-09-30T23:00Z", venue: { fullName: "Unknown Gym", address: { city: "Nowhere" } },
    competitors: [{ homeAway: "away", team: { abbreviation: "MIA" } }, { homeAway: "home", team: { abbreviation: "ORL" } }],
    status: { type: { state: "post", completed: true } } }] }
] };
const sched = CC.scheduleFrom(schedulePayload, MIA, "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia/schedule", now);
check("a schedule capture is stamped with the geography that derived it", sched.geoModel === Geo.MODEL_VERSION);
check("a cached capture derived by an OLDER geography is re-collected even if it is seconds old",
  (() => {
    const now = Date.parse("2026-09-18T03:00:00Z"), SIX = 6 * 3600000;
    const base = { games: [], fetchedAt: "2026-09-18T02:37:00Z", geoModel: Geo.MODEL_VERSION };
    return CC.scheduleCacheFresh(base, now, SIX) === true &&
      CC.scheduleCacheFresh({ ...base, geoModel: Geo.MODEL_VERSION - 1 }, now, SIX) === false &&
      CC.scheduleCacheFresh({ ...base, fetchedAt: "2026-09-17T19:00:00Z" }, now, SIX) === false &&
      CC.scheduleCacheFresh({ games: [] }, now, SIX) === false &&
      CC.scheduleCacheFresh(undefined, now, SIX) === false;
  })());
check("the schedule keeps only games with an id and a parsable date, sorted by date",
  sched.games.length === 3 && sched.games[0].id === "P0" && sched.games[2].id === "P2");
check("a home game is recorded as no travel leg, and a road leg is measured in city-centre miles",
  sched.games.find(g => g.id === "P2").travelMiles === 0 && sched.games.find(g => g.id === "P1").travelMiles > 1000,
  JSON.stringify(sched.games.map(g => [g.id, g.travelMiles])));
check("when the previous venue is unknown the leg falls back to the team's own city AND says so",
  sched.games.find(g => g.id === "P1").travelFromFallback === true,
  JSON.stringify(sched.games.find(g => g.id === "P1")));
check("an unrecognised venue city is named in unresolvedCities and never given a distance",
  sched.unresolvedCities.includes("Nowhere") && sched.games.find(g => g.id === "P0").travelMiles === null &&
  sched.games.find(g => g.id === "P0").unmappedCity === "Nowhere");
check("the completed-game ids are retained for the backfill, and the geo note is attached",
  sched.completedIds.includes("P0") && /city-centroid/.test(sched.geoNote));
check("rest days come from the schedule itself (Oct 3 -> Oct 6 is 2 rest days)",
  sched.games.find(g => g.id === "P2").restDays === 2, String(sched.games.find(g => g.id === "P2").restDays));
check("the finished-game ledger keeps id+date pairs for the backfill ordering",
  Array.isArray(sched.completedGames) && sched.completedGames.length === 1 && sched.completedGames[0].id === "P0" &&
  sched.completedGames[0].date === "2026-09-30T23:00Z");
check("the backfill reads the most RECENT finished games league-wide, deduped",
  (() => {
    const s2 = { A: { completedGames: [{ id: "A1", date: "2026-09-10T00:00:00Z" }, { id: "A2", date: "2026-09-14T00:00:00Z" }] },
      B: { completedGames: [{ id: "B1", date: "2026-09-16T00:00:00Z" }] } };
    return CC.recentBackfill(s2, ["A1", "A2", "B1", "B1"], 2).join(",") === "B1,A2";
  })(),
  JSON.stringify(CC.recentBackfill({ A: { completedGames: [{ id: "A1", date: "2026-09-10T00:00:00Z" }, { id: "A2", date: "2026-09-14T00:00:00Z" }] }, B: { completedGames: [{ id: "B1", date: "2026-09-16T00:00:00Z" }] } }, ["A1", "A2", "B1", "B1"], 2)));
check("a game with an unparsable date sorts last rather than crashing the run",
  CC.recentBackfill({ A: { completedGames: [{ id: "X", date: null }, { id: "Y", date: "2026-09-12T00:00:00Z" }] } }, ["X", "Y"], 2).join(",") === "Y,X");

/* ============================== 3. role.js model ================================== */
console.log("== role.js — stake, exposure, recurrence, weighting and the four rules ==");
const near = d => iso(Date.now() + d * 86400000);
const baseCtx = {
  schema: 3,
  teamStats: { UTA: { team: "UTA", games: 10, pointsTotal: 1160, updatedAt: now } },
  rosters: { UTA: { fetchedAt: now, url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/utah/roster", players: [
    { playerId: "1", player: "Star Wing", team: "UTA", rosterUrl: "u1", injuryEntries: [{ status: "Out", date: iso(Date.now() - 3 * 86400000) }, { status: "Day-To-Day", date: iso(Date.now() - 40 * 86400000) }] },
    { playerId: "2", player: "Sixth Man", team: "UTA", rosterUrl: "u1", injuryEntries: [{ status: "Out", date: iso(Date.now() - 5 * 86400000) }] },
    { playerId: "3", player: "Deep Bench", team: "UTA", rosterUrl: "u1", injuryEntries: [] }
  ] } },
  schedules: { UTA: { fetchedAt: now, url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/utah/schedule", season: "2026-27",
    geoNote: "city-centroid model", unresolvedCities: [],
    games: [
      { id: "1", date: near(1), opponent: "DEN", homeAway: "away", city: "Denver", restDays: 0, travelMiles: 371, travelHours: 2.8, tzShiftHours: 0 },
      { id: "2", date: near(3), opponent: "LAL", homeAway: "away", city: "Los Angeles", restDays: 1, travelMiles: 590, travelHours: 3.3, tzShiftHours: 1 },
      { id: "3", date: near(5), opponent: "PHX", homeAway: "away", city: "Phoenix", restDays: 1, travelMiles: 430, travelHours: 3.0, tzShiftHours: 0 },
      { id: "4", date: near(6), opponent: "PHX", homeAway: "away", city: "Phoenix", restDays: 0, travelMiles: 0, travelHours: 0, tzShiftHours: 0 }
    ] } },
  roles: [], exits: {},
  roleStats: {
    "1": { player: "Star Wing", team: "UTA", games: 10, starts: 9, minutesTotal: 346, minutesGames: 10, pointsTotal: 246, pointsGames: 10, assistsTotal: 62, assistsGames: 10, plusMinusTotal: 41, plusMinusGames: 10, minutesValues: [36, 34, 38, 35, 33, 36, 34, 37, 32, 31], updatedAt: now, sampleUrls: ["https://www.espn.com/nba/game/_/gameId/1"] },
    "2": { player: "Sixth Man", team: "UTA", games: 10, starts: 0, minutesTotal: 275, minutesGames: 10, pointsTotal: 168, pointsGames: 10, assistsTotal: 40, assistsGames: 10, plusMinusTotal: 12, plusMinusGames: 10, updatedAt: now, sampleUrls: [] },
    "3": { player: "Deep Bench", team: "UTA", games: 4, starts: 0, minutesTotal: 18, minutesGames: 4, pointsTotal: 5, pointsGames: 4, updatedAt: now, sampleUrls: [] }
  }
};
const star = LI.assess({ player: "Star Wing", playerId: "1", team: "UTA", sev: "out" }, baseCtx);
check("a 34.6 mpg, 9-of-10-starts, 24.6 ppg top option listed OUT grades HIGH",
  star.impact === "high" && star.score >= LI.CONFIG.gradeHigh, star.impact + " " + star.score);
check("the offense share is measured against the SAME collected games, not a league average",
  star.production.ppg === 24.6 && star.production.teamPpg === 116 && (star.stake.parts.find(p => p.key === "offenseShare") || {}).share === 0.212,
  JSON.stringify(star.production));
check("on-court +/- is part of the stake, bounded, and labelled as noisy",
  !!star.stake.parts.find(p => p.key === "plusMinus") && /noisy/.test(star.stake.parts.find(p => p.key === "plusMinus").label));
check("exposure reads the schedule: 4 games in 7 days, 2 back-to-backs, 3 road games",
  star.exposure.parts.find(p => p.key === "gamesNext7").pts === 40 &&
  star.exposure.parts.find(p => p.key === "backToBacks").pts === 30 &&
  star.exposure.parts.find(p => p.key === "road7").pts === 12, JSON.stringify(star.exposure.parts));
check("travel miles and time-zone shift are part of exposure",
  !!star.exposure.parts.find(p => p.key === "travelMiles") && !!star.exposure.parts.find(p => p.key === "tzShift"));
check("recurrence counts dated listings and how recent the newest is",
  !!star.recurrence.parts.find(p => p.key === "cadence") && !!star.recurrence.parts.find(p => p.key === "listingRecency"));
check("every factor names its component, points and max — the grade is explainable",
  star.factors.length >= 8 && star.factors.every(f => f.component && f.key && typeof f.pts === "number" && typeof f.max === "number"));
check("evidence coverage reports the share of the model's weight that had evidence",
  star.confidence === 1, String(star.confidence));
check("the label carries the score, the coverage and the collected production",
  /impact score \d/.test(star.impactLabel) && /evidence coverage 100%/.test(star.impactLabel) && /24\.6 ppg/.test(star.impactLabel));
check("production and travel are exposed as structured fields for the UI",
  star.travel && star.travel.opponent === "DEN" && star.travel.restDays === 0 && star.schedule.upcoming.length === 4);
check("the result never claims a medical grade",
  !("medicalSeverity" in star) && !/medical severity: *(high|moderate|low|severe)/i.test(star.impactLabel + LI.summaryText(star)));

const sixth = LI.assess({ player: "Sixth Man", playerId: "2", team: "UTA", sev: "out" }, baseCtx);
check("a 27.5 mpg sixth man scoring 14.5 ppg is graded on his production, not on his start count",
  sixth.impact === "medium" && sixth.score >= LI.CONFIG.gradeMedium && sixth.score < LI.CONFIG.gradeHigh,
  sixth.impact + " " + sixth.score);
const sixthQ = LI.assess({ player: "Sixth Man", playerId: "2", team: "UTA", sev: "questionable" }, baseCtx);
check("the same player as a game-time decision keeps a separate AVAILABILITY RISK reading",
  sixthQ.availabilityRisk && sixthQ.availabilityRisk.score === sixthQ.exposure.score && ["low", "medium", "high"].includes(sixthQ.availabilityRisk.level),
  JSON.stringify(sixthQ.availabilityRisk));
const deep = LI.assess({ player: "Deep Bench", playerId: "3", team: "UTA", sev: "out" }, baseCtx);
check("a 4.5 mpg depth player is LOW — rule R3 caps depth at low",
  deep.impact === "low" && (deep.rules || []).some(r => /R3/.test(r)), deep.impact + " " + (deep.rules || []).join(";"));
const nobody = LI.assess({ player: "Never Seen", playerId: "99", team: "UTA", sev: "out" }, baseCtx);
check("no collected sample at all is UNKNOWN (never low, never high-on-schedule) even with a schedule present",
  nobody.impact === "unknown" && nobody.score === null && /unknown/i.test(nobody.impactLabel) && (nobody.rules || []).some(r => /R4/.test(r)), nobody.impact);
check("an UNKNOWN still reports what the schedule says, so the module never invents a stake",
  !!nobody.exposure && nobody.exposure.score >= 0 && nobody.stake.score === null);

const starterNoSample = LI.assess({ player: "Call-Up Guy", playerId: "7", team: "UTA", sev: "out" },
  { schema: 3, roles: [{ playerId: "7", player: "Call-Up Guy", team: "UTA", role: "Starter in this game", observedAt: now, url: "g" }] });
check("a player named in the collected starting lineup is HIGH when ruled out (rule R1, lineup-card evidence)",
  starterNoSample.impact === "high" && (starterNoSample.rules || []).some(r => /R1/.test(r)), starterNoSample.impact);

const stale = LI.assess({ player: "Old Sample", playerId: "8", team: "UTA", sev: "out" },
  { schema: 3, roleStats: { "8": { player: "Old Sample", team: "UTA", games: 10, starts: 10, minutesTotal: 340, minutesGames: 10, updatedAt: iso(Date.now() - 90 * 86400000), sampleUrls: [] } } });
check("a stale sample withholds the stake instead of quoting last season's role", stale.impact === "unknown" && stale.role.staleSample === true);

// A role-only stale fixture missed a production backdoor: old points/+/- still scored STAKE.
for (const stamp of [undefined, null, "", "not-a-date", iso(Date.now() - 90 * 86400000), iso(Date.now() + 86400000)]) {
  const old = { ...baseCtx.roleStats["1"], updatedAt: stamp };
  const result = LI.assess({ player: "Star Wing", playerId: "1", team: "UTA", sev: "out" },
    { ...baseCtx, roleStats: { "1": old } });
  check("undated/stale/future production cannot resurrect impact: " + stamp,
    result.impact === "unknown" && result.score === null && result.stake.parts.length === 0 && result.production === null);
}
for (const minutes of [null, "", "  ", false, undefined]) {
  const result = LI.assess({ player: "Demo", playerId: "7", team: "UTA", sev: "out" },
    { roles: [{ playerId: "7", team: "UTA", role: "Starter in this game", minutes, observedAt: now }] });
  check("missing minutes stay unknown rather than zero: " + JSON.stringify(minutes),
    result.role.avgMinutes === null && result.stake.parts.some(p => p.key === "lineupCard"));
}
const datedListings = LI.listingCadence({ injuryEntries: [
  { date: iso(Date.now() + 86400000), status: "Out" },
  { date: now, status: "Out" }, { date: "bad", status: "Out" }
] });
check("future-dated listings do not count as past injury recurrence", datedListings.count === 1);

const refreshedStarter = LI.assess({ playerId: "1", team: "UTA", sev: "out" }, {
  roleStats: { "1": { ...baseCtx.roleStats["1"], updatedAt: "invalid" } },
  roles: [{ playerId: "1", team: "UTA", role: "Starter in this game", observedAt: now }]
});
check("fresh lineup evidence survives an unusable older aggregate without importing its production",
  refreshedStarter.impact === "high" && refreshedStarter.role.games === 1 && refreshedStarter.production === null);
const staleTeam = LI.assess({ playerId: "1", team: "UTA", sev: "out" }, {
  ...baseCtx, teamStats: { UTA: { ...baseCtx.teamStats.UTA, updatedAt: "invalid" } }
});
check("unknown-age team production is never used as a scoring-share denominator",
  !staleTeam.stake.parts.some(p => p.key === "offenseShare") && staleTeam.production.teamPpg === null);
for (const minutes of [null, "", "  ", false, undefined]) {
  const collected = CC.accumulateRoleStats({}, [{ ...rowsA[0], minutes }], now);
  check("collector never persists missing minutes as a zero-minute game: " + JSON.stringify(minutes),
    collected.roleStats["1"].minutesGames === 0 && !collected.roleStats["1"].minutesValues);
}

const noWeights = LI.gradeOf({ stake: null, exposure: null, recurrence: null }, "out", "unknown");
check("gradeOf with no components is unknown with confidence 0 — silence is not LOW",
  noWeights.grade === "unknown" && noWeights.confidence === 0 && noWeights.rules.length === 0);
const weights = LI.gradeOf({ stake: { score: 100 }, exposure: null, recurrence: null }, "out", "rotation");
check("weights renormalise over available evidence: stake alone at 100 is HIGH",
  weights.grade === "high" && weights.confidence === 0.6, JSON.stringify(weights));
check("a 60% stake outranks a zero exposure in a blend",
  LI.gradeOf({ stake: { score: 60 }, exposure: { score: 0 }, recurrence: null }, "questionable", "rotation").score === 45 &&
  LI.gradeOf({ stake: { score: 60 }, exposure: { score: 0 }, recurrence: null }, "questionable", "rotation").confidence === 0.8);

const c = LI.CONFIG;
check("the documented thresholds are all present as named constants (no magic numbers in the model)",
  ["weightStake", "weightExposure", "weightRecurrence", "gradeHigh", "gradeMedium", "minutesHigh", "offenseShareHigh",
    "plusMinusCap", "games7High", "backToBackWeight", "miles7High", "tzShiftHigh", "cadenceHigh", "scheduleFreshMs", "exitReportedPoints"]
    .every(k => typeof c[k] === "number"), ["weightStake", "weightExposure", "weightRecurrence", "gradeHigh", "gradeMedium"].filter(k => typeof c[k] !== "number").join(","));
check("the model is versioned", LI.MODEL.version === 2 && LI.MODEL.since === "2026-09-18");

/* Geography guard: derived rows live in a 6-hour cache, so a table edit that does not bump
 * Geo.MODEL_VERSION keeps stale numbers in circulation (this happened twice: the city-table fix
 * and then the TEAM_HOME_CITY fix). The digest below fails the suite until it is refreshed, which
 * is the reminder to bump the version. To update: node -e "…" prints the new hash, see the check. */
const GEO_EXPECTED_VERSION = 3;
const GEO_EXPECTED_HASH = 2581360607;
check("Geo.MODEL_VERSION matches the recorded geography revision",
  Geo.MODEL_VERSION === GEO_EXPECTED_VERSION,
  "Geo.MODEL_VERSION is " + Geo.MODEL_VERSION + " but the suite expects " + GEO_EXPECTED_VERSION);
check("the city/venue/team-home/travel tables are unchanged since that revision was recorded",
  (() => {
    const d = Geo.tableDigest();
    let h = 5381;
    for (const ch of d) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    if (h !== GEO_EXPECTED_HASH) console.log("      geography digest changed: " + h + " (expected " + GEO_EXPECTED_HASH + ") — bump Geo.MODEL_VERSION and update GEO_EXPECTED_HASH");
    return h === GEO_EXPECTED_HASH;
  })());

/* ================= 4. the deployed page actually uses all of this ================= */
console.log("== wiring: the page must show what the model computes ==");
const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const boardAt = idx.indexOf('id="injuryBoardCard"'), alertAt = idx.indexOf('id="alertLog"'), wireAt = idx.indexOf('id="wire"');
check("the injury board is the FIRST card after the status bar", boardAt > 0 && boardAt < alertAt && boardAt < wireAt);
check("the high-impact watchlist container exists on the page", /id="impactWatch"/.test(idx));
check("the impact filter tabs exist", (idx.match(/data-impact-filter=/g) || []).length === 5);
check("both sound-test buttons exist", /id="testSound"/.test(idx) && /id="testHighImpactSound"/.test(idx));
/* Wiring audit: every element id the shipped modules look up must exist in index.html, or a
 * feature is silently inert (a listener that never binds because getElementById returned null).
 * This is the check that would have caught an unbound filter tab or a dead test-sound button. */
check("every getElementById in the shipped modules resolves to an id in index.html",
  (() => {
    const ids = new Set([...idx.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
    const missing = [];
    for (const f of ["alerts.js", "app.js", "injuries.js", "social.js", "ingame.js", "intelligence.js", "wire.js"]) {
      const src = fs.readFileSync(path.join(ROOT, "assets/js", f), "utf8");
      for (const m of src.matchAll(/getElementById\(\s*"([^"$]+)"/g)) if (!ids.has(m[1])) missing.push(f + " -> " + m[1]);
    }
    if (missing.length) console.log("      missing ids: " + missing.join(", "));
    return missing.length === 0;
  })());
const inj = fs.readFileSync(path.join(ROOT, "assets/js/injuries.js"), "utf8");
check("the board renders the model factors, production and travel lines",
  /factorsLine\(imp\)/.test(inj) && /br-prod/.test(inj) && /br-travel/.test(inj) && /availabilityRisk/.test(inj));
check("the query index.js exports the widgets app.js binds to", /renderImpactWatch/.test(inj) && /setImpactFilter/.test(inj));
const alerts = fs.readFileSync(path.join(ROOT, "assets/js/alerts.js"), "utf8");
check("the alert engine has a separate high-impact voice and a test for it",
  /playHighImpactChime/.test(alerts) && /testHighImpactSound/.test(alerts) && /if \(high\) playHighImpactChime\(\); else playChime\(\);/.test(alerts));
/* Session-9 defect class: three producers fired alerts without ever passing the impact
 * assessment, so an official NBA "Out" for a starter and an in-game listing for a top option
 * both arrived with the ordinary chime. Every producer must hand the alarm the assessment. */
const intelSrc = fs.readFileSync(path.join(ROOT, "assets/js/intelligence.js"), "utf8");
const ingame = fs.readFileSync(path.join(ROOT, "assets/js/ingame.js"), "utf8");
check("the official NBA layer assesses lineup impact before firing an official designation alert",
  /LineupImpact\.assess\(/.test(intelSrc) && /impact: imp \? \{ tier: imp\.impact/.test(intelSrc));
check("the in-game monitor assesses lineup impact for a game listing (never for a DNP row)",
  /LineupImpact\.assess\(/.test(ingame) && /f\.alertEligible !== false && typeof LineupImpact/.test(ingame));
check("in-game findings carry the player id the impact lookup keys on",
  (ingame.match(/playerId: \((row|inj)\.athlete && \1\.athlete\.id\) \|\| null/g) || []).length === 2);
check("the board alert carries grade, offense tier and score (not just a tier string)",
  /offenseTier: impact\.offenseTier, score: impact\.score/.test(inj));
const intel = fs.readFileSync(path.join(ROOT, "assets/js/intelligence.js"), "utf8");
check("the dashboard hands the impact model the schedule and team-production captures",
  /schedules: context\.schedules/.test(intel) && /teamStats: context\.teamStats/.test(intel));
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/injury-watch.yml"), "utf8");
check("CI runs this suite before collecting", /node tools\/impact_test\.js/.test(wf));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
