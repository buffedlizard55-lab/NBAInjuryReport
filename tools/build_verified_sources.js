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
  return { ENDPOINTS, TEAMS, REPORTERS, SOURCES, FLAGS, SCORING_RUBRIC, SOCIAL_ACCOUNTS, BSKY_REPORTERS, BLUESKY_LIST_SOURCE };
`);
const { ENDPOINTS, TEAMS, REPORTERS, SOURCES, FLAGS, SCORING_RUBRIC, SOCIAL_ACCOUNTS, BSKY_REPORTERS, BLUESKY_LIST_SOURCE } = extract();

const statusCounts = REPORTERS.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

const out = {
  generated: new Date().toISOString().slice(0, 10),
  project: "NBAInjuryReport — live injury alert notification system (all 30 NBA teams)",
  live_site: "https://buffedlizard55-lab.github.io/NBAInjuryReport/",
  method: "Single source of truth: assets/js/data.js. Each entry verified line-by-line against live official pages/APIs on 2026-09-17 across six passes (verification channels: assistant page-fetch tool + GitHub Actions runner audit data/audit/latest.json; shell HTTPS egress is blocked in the build environment). See sources.html for evidence links. Session 2 added the structured all-30-team ESPN injuries API and the free Bluesky/AT-Protocol social layer; session 4 re-verified the official/ESPN/Bluesky rows and fixed the social alert-eligibility gate (identity evidence, not only the verification object); session 6 resolved the Jake Fischer outlet question from the outlet's own byline and re-verified the Buckner/Haynes/Guillory rows against dated 2025-2026 reports; all rows carry their exact evidence strings below.",
  endpoints: ENDPOINTS,
  counts: {
    teams: TEAMS.length,
    sources: SOURCES.length,
    reporters: REPORTERS.length,
    reportersByStatus: statusCounts,
    flags: FLAGS.length,
    socialAccounts: SOCIAL_ACCOUNTS.length,
    socialAccountsPolled: SOCIAL_ACCOUNTS.filter(a => a.feed).length,
    blueskyReporters: BSKY_REPORTERS.length,
    blueskyReportersPolled: BSKY_REPORTERS.filter(a => a.feed).length,
    blueskyListMembers: BLUESKY_LIST_SOURCE.members
  },
  social_layer: {
    transport: "Bluesky / AT-Protocol public API (public.api.bsky.app) — no key, no account",
    verified_working_unauthenticated: ["app.bsky.feed.getAuthorFeed", "app.bsky.actor.searchActorsTypeahead", "app.bsky.graph.getList", "app.bsky.graph.getFollows"],
    verified_blocked_unauthenticated: { "app.bsky.feed.searchPosts": "HTTP 403 Forbidden (2026-09-17) — keyword search is NOT free; the project therefore polls a verified allow-list" },
    identity_evidence: "Bluesky verification objects (issuer bsky.app, or an outlet's own domain account such as theathletic.com) + membership of Howard Beck's curated 150-member NBA writers list",
    list_source: BLUESKY_LIST_SOURCE,
    accounts: SOCIAL_ACCOUNTS,
    reporters: BSKY_REPORTERS,
    cors_note: "Browser cross-origin behaviour could not be verified from the build sandbox. Three transport paths are shipped: browser-direct, same-origin CI snapshot (data/live/latest.json), and an explicitly labelled opt-in public relay. The UI prints which path each account used."
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
    state: "offseason (ESPN scoreboard ?dates=20260917 returned ZERO events — re-verified live on 2026-09-17, session-4 pass: 2026-27 official page still 404, injuries feed still 200, nba.com Bluesky verification still valid)",
    preseason_tip: "2026-10-03 MIA @ TOR (ESPN scoreboard event 401902644, Videotron Centre, Quebec City)",
    opening_night: "2026-10-20: BOS@DET 3pm ET, PHI@NYK 7pm ET, OKC@SAS 9:30pm ET — confirmed by the OFFICIAL NBA Bluesky account bio on 2026-09-17, independently of Basketball Monster",
    metadata_irregularity: "ESPN's scoreboard league block still describes season '2025-26' with a calendar ending 2026-06-13 while ESPN's own injuries endpoint reports season 2026-27 Preseason. Flagged; the app ignores the scoreboard league block."
  },
  sources: SOURCES,
  flags: FLAGS,
  scoring_rubric: SCORING_RUBRIC,
  scheduled_collection: {
    mechanism: "GitHub Actions workflow .github/workflows/injury-watch.yml running tools/poll_watch.js every 10 minutes (plus manual dispatch)",
    writes: ["data/live/latest.json (same-origin snapshot: injuries, news, social posts)", "data/history/YYYY-MM-DD.jsonl (append-only timestamped history)", "data/history/firsts.json (earliest observed timestamp per player / per in-game-watch post)", "data/history/index.json (run counts per day)"],
    status: "RUNNING: first successful end-to-end run 2026-09-17 (GitHub Actions, see FLAGS entry \"First fully-automated collection run verified end-to-end\"); every 10 minutes on main and arena/** plus manual dispatch. Snapshots commit to data/live and data/history with a rebase-retry because the branch is written by collector, audit bot and humans at once. GitHub documents scheduled runs as best-effort; they are a recorder, not a push channel.",
    caveats: ["GitHub documents scheduled workflows as best-effort (delays under load)", "scheduled workflows are disabled after 60 days without repository activity", "runs every 10 minutes, so it is a recorder, not a real-time push channel"]
  },
  key_limitations: [
    "X API has no usable free read tier (reads start ~$200/mo) — automated X listening and X-based historical scoring remain blocked.",
    "Bluesky's searchPosts endpoint returns HTTP 403 without auth, so the free social layer is a verified allow-list rather than a keyword firehose: a first report from an unlisted account will not be caught.",
    "Browser CORS for the two newly used endpoints (site.web.api.espn.com/injuries and public.api.bsky.app) could not be verified from the build sandbox; both modules fall back to the same-origin CI snapshot and print which path succeeded.",
    "The official NBA injury-report page has not rolled over to 2026-27 (verified HTTP 404); the site links the last verified page and flags the rollover.",
    "The official injury-PDF index (ak-static.cms.nba.com/referee/injury/) returns HTTP 500, so no directory listing can be polled for new PDFs.",
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
