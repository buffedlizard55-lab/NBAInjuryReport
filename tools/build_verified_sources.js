#!/usr/bin/env node
/* Regenerates data/verified_sources.json from assets/js/data.js (single source of truth).
 * Run from repo root:  node tools/build_verified_sources.js
 * data.js is plain data + pure helpers, so it can be evaluated safely in Node. */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataSrc = fs.readFileSync(path.join(root, "assets/js/data.js"), "utf8");

const extract = new Function(dataSrc + `
  return { ENDPOINTS, TEAMS, REPORTERS, SOURCES, FLAGS, SCORING_RUBRIC };
`);
const { ENDPOINTS, TEAMS, REPORTERS, SOURCES, FLAGS, SCORING_RUBRIC } = extract();

const statusCounts = REPORTERS.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

const out = {
  generated: new Date().toISOString().slice(0, 10),
  project: "NBAInjuryReport — live injury alert notification system (all 30 NBA teams)",
  live_site: "https://buffedlizard55-lab.github.io/NBAInjuryReport/",
  method: "Single source of truth: assets/js/data.js. Each entry verified line-by-line against live official pages/APIs on 2026-09-17 (verification channel: assistant page-fetch tool; shell HTTPS egress is blocked in the build environment). See sources.html for evidence links.",
  endpoints: ENDPOINTS,
  counts: {
    teams: TEAMS.length,
    sources: SOURCES.length,
    reporters: REPORTERS.length,
    reportersByStatus: statusCounts,
    flags: FLAGS.length
  },
  official_review_links: {
    nba_official_injury_report: "https://official.nba.com/nba-injury-report-2025-26-season/",
    nba_injury_pdf_example: "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf",
    espn_injuries_all_teams: "https://www.espn.com/nba/injuries",
    espn_team_injuries_pattern: "https://www.espn.com/nba/team/injuries/_/name/{abbr-lowercase}",
    basketball_monster_player_news: "https://basketballmonster.com/playernews.aspx",
    covers_nba_injuries: "https://www.covers.com/sport/basketball/nba/injuries",
    rotoballer_nba_news: "https://www.rotoballer.com/player-news?sport=nba"
  },
  schedule_verified: {
    as_of: "2026-09-17",
    state: "offseason (ESPN scoreboard returns zero events today; calendar shows games from 2026-10-03)",
    preseason_tip: "2026-10-03 MIA @ TOR (ESPN scoreboard event 401902644, Videotron Centre, Quebec City)",
    opening_night: "2026-10-20: BOS@DET, PHI@NYK, OKC@SAS (per Basketball Monster page text)"
  },
  sources: SOURCES,
  flags: FLAGS,
  scoring_rubric: SCORING_RUBRIC,
  key_limitations: [
    "X API has no usable free read tier (reads start ~$200/mo) — automated social listening + historical scoring blocked until paid tier.",
    "Instagram/Facebook have no free public injury-post APIs.",
    "No free feed carries structured 'questionable to return' in-game data — QTR alerts rely on the news layer + reporter directory.",
    "In-game injury monitor verified against completed-game payload structure only; untested against live games until 2026-10-03.",
    "NBA.com CDN failover unreachable from build environment — defensive implementation, validate in a real browser.",
    "ESPN JSON endpoints are unofficial/undocumented (public API retired 2014) — subject to change; app shows feed status + official fallback links.",
    "balldontlie Player Injuries + injury webhooks are paid-only — not a free source.",
    "Severity labels are keyword-detected — confirm via linked sources."
  ]
};

fs.writeFileSync(
  path.join(root, "data/verified_sources.json"),
  JSON.stringify(out, null, 2) + "\n"
);
console.log("OK — wrote data/verified_sources.json:",
  out.counts.teams, "teams /", out.counts.sources, "sources /",
  out.counts.reporters, "reporters /", out.counts.flags, "flags");
