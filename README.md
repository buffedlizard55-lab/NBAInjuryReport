# NBA Injury Alert System 🏀🔔

**Live site:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

A free, working **injury alert notification system for all players on all 30 NBA teams**,
modeled on [Basketball Monster's player news](https://basketballmonster.com/playernews.aspx).
No accounts, no API keys — it runs entirely in the browser on GitHub Pages.

## What it does

| Feature | Where | How |
|---|---|---|
| 💬 Live injury wire (chat-like, newest first) | `index.html` | ESPN NBA news API, classified OUT / DOUBTFUL / QUESTIONABLE / PROBABLE / RETURN / MENTION |
| 🔔 Sound + browser-notification alerts | Alert center on `index.html` | Pleasant WebAudio chime (toggle + test button), Notification API, persisted alert log — every alert links its source |
| 🏥 In-game injury monitor | Scoreboard card | ESPN game-summary API `boxscore.players[].statistics[].athletes[] {didNotPlay, reason, ejected}`; injury-reason DNPs alert in real time; non-injury reasons (e.g. directly-observed "COACH'S DECISION") excluded. **Structure-verified 2026-09-17, untested until 2026-10-03 tip-off** |
| 📅 Live-game detection + failover | Scoreboard card | ESPN scoreboard API (primary) → NBA.com CDN JSON (defensive failover, unverified from build env) |
| 🏟 Per-team cross-checks | Teams table | One click to ESPN team injuries, official NBA.com team site, X injury search |
| 📡 Social pulse | Dashboard embeds | Free X timeline embeds (no key) for verified league/insider accounts, with link fallbacks (X rate-limits embeds — links always provided) |
| 🧑‍💼 Verified reporter directory (36 rows) | `reporters.html` | Tiered insiders/beat writers; handles shown **only** when confirmed (25 verified); verification link per row |
| 🏆 Forward-tracking reliability scorecard | `reporters.html` | Log calls with post-URL evidence → points/accuracy/firsts leaderboard, JSON export/import |
| 📚 Line-by-line verification log | `sources.html` | 16 sources with evidence links, 12 irregularity flags, limitations, roadmap |
| 🧪 Logic smoke tests | `tools/smoke_test.js` | 35 checks: classifier, 30-team integrity, in-game extraction incl. "COACH'S DECISION" exclusion |

## Verification re-run 2026-09-17 (this session)

Every source re-checked live via page-fetch: ESPN news/scoreboard/summary APIs, ESPN injuries pages (league + team), official.nba.com report (rules verbatim), Basketball Monster (Mark Williams injury matches ESPN wire), Covers (dated 2026-09-17), RotoBaller (2026-09-16 feed), nba.com/heat (MIA@TOR 10/03 hub), GitHub Pages deployment (built; wire working with live data). Irregularities found were **flagged, not hidden** — see `sources.html` → Flags.

## Verified sources (2026-09-17, evidence linked on `sources.html`)

- **ESPN NBA news/scoreboard/teams JSON APIs** — fetched live; power the wire + scoreboard. Unofficial/undocumented (ESPN retired its public API in 2014), no key needed.
- **Official NBA injury report** — https://official.nba.com/nba-injury-report-2025-26-season/ (deadline rules confirmed: 5pm local day-before, 11am–1pm gameday, 1pm back-to-backs).
- **Official NBA injury PDFs** — `ak-static.cms.nba.com/referee/injury/…` timestamped issues.
- **Basketball Monster player news** — reverse-engineered as the wire *format model* (no public API; link out, don't scrape).
- **ESPN injuries pages** — league + per-team (`/nba/team/injuries/_/name/{abbr}` pattern verified).
- **Covers.com + RotoBaller** — tertiary cross-checks. NBA.com team sites, NBA CDN JSON (fallback).

## Reporter directory highlights

- Tier 1: Shams Charania (ESPN), Chris Haynes (NBA on Prime), Marc Stein, Jake Fischer (Yahoo). **Wojnarowski retired Sept 2024 — excluded from live use.**
- Tier 2/3: 20+ national reporters + verified beat writers (Slater, McMenamin, MacMahon, Begley, Guillory, Winderman…), each with outlet, role, tier, handle status, and a verification link.
- Honest statuses: `handle verified` · `outlet verified, handle unverified (none asserted)` · `community-listed` · `inactive on X` · `retired`.

## Key limitations (documented, not hidden)

1. **No free programmatic X/IG/FB read access** — automated social listening + historical back-testing need X API Basic (~$200/mo) or higher. The site ships embeds + search links + forward-tracking instead.
2. **ESPN endpoints are unofficial** — status indicators + official fallback links included.
3. **Severity is keyword-detected** — confirm via linked sources.
4. **No free feed has structured "questionable to return" data** — QTR in-game alerts ride the news layer + reporter directory (see `NEXT_STEPS.md`).
5. **In-game monitor untested against live games** — offseason now; validate at 2026-10-03 preseason tip.
6. Alerts/scores live in browser localStorage (no server yet).

**Next work:** see [`NEXT_STEPS.md`](NEXT_STEPS.md) — prioritized backlog (P0: live-validate in-game monitor 2026-10-03; P1: server poller via GitHub Actions, beat-writer completion, official PDF watcher) with the honest limitation list.

## Run locally / test

```bash
# any static server, e.g.
python3 -m http.server 8080
# open http://localhost:8080

# logic smoke tests (no browser needed)
node tools/smoke_test.js

# regenerate data/verified_sources.json from assets/js/data.js
node tools/build_verified_sources.js
```

## Verification

- `sources.html` — full registry + flags + methodology + re-verification checklist
- `data/verified_sources.json` — machine-readable source registry
- `assets/js/data.js` — single source of truth for teams, reporters, sources, flags
