# NBA Injury Alert System 🏀🔔

**Live site:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

A free, working **injury alert notification system for all players on all 30 NBA teams**, modelled on
[Basketball Monster's player news](https://basketballmonster.com/playernews.aspx). No accounts, no API keys,
no paid tiers — it runs entirely in the browser on GitHub Pages, with a free server-side poller for history.

## What it does now

| Feature | Where | How |
|---|---|---|
| 🏥 **Structured injury board — all 30 teams** | `index.html` | **New this session.** ESPN's structured injuries API gives status, injury type/side/location, game-time-decision flag, estimated return date and a sourced news line per player — no headline guessing |
| 💬 Live injury wire (chat-style, merged) | `index.html` | One reverse-chronological stream fed by the injury board, ESPN news, the social layer and the in-game monitor |
| 🔔 Alerts: pleasant chime (toggle + test), browser notifications, per-severity filters, review links | Alert center | Fires on **new** listings and **status changes**; already-seen items never re-alert; every alert links its source |
| 📡 **Social layer — free and live** | `index.html` | **New this session.** Bluesky/AT-Protocol public API (no key) for a verified allow-list: official NBA account, verified team accounts, verified reporters. In-game exit language triggers an "out for the game / in-game exit watch" alert, labelled as a social report |
| 🏥 In-game monitor | Scoreboard card | ESPN game summary: players not playing for injury reasons during live games (the observed non-injury value "COACH'S DECISION" is excluded). Structure-verified 2026-09-17, live-untested until 2026-10-03 |
| 🧑‍💼 Verified directory: X **and** Bluesky | `reporters.html` | X layer from session 1 (25 verified handles) + Bluesky layer verified live this session (8 reporters, 7 official/outlet accounts) with per-row evidence links |
| 🏆 Reliability scorecard | `reporters.html` | Forward-collected: log each call with its post URL → points, accuracy, firsts; JSON export/import. "First" becomes defensible once the poller has timestamp history |
| 🕒 **Free server-side poller** | `.github/workflows/injury-watch.yml` | **New this session.** Every 10 min: snapshots injuries/news/social → `data/live/latest.json` (same-origin, CORS-proof) + appends `data/history/*.jsonl` + records first-seen timestamps per player |
| 📚 Line-by-line verification log | `sources.html` | 21 sources, 21 irregularity flags, evidence links, limitations, roadmap, re-verification checklist |
| 🧪 Logic + integration tests | `tools/smoke_test.js`, `tools/integration_test.js`, `tools/poll_fixture_test.js` | **105 logic checks** against the real modules in Node (DOM stub) + **45 integration checks** that boot the actual page scripts against fixture responses, assert every element id exists in the page that loads it, and exercise the ESPN-blocked → CI-snapshot fallback + **19 checks** that run the real CI poller end-to-end against fixtures and audit what it writes |
| 🔎 Live-data self-audit | `tools/replay_posts.js [snapshot] --check` | Replays a real captured snapshot through the current classifier and fails on invariant violations (non-standard team codes, OUT labels without an out phrase, duplicate posts). Runs in CI **before** any snapshot is committed |

## Verification performed 2026-09-17 (all links re-openable)

Everything below was fetched live during this session; evidence links are in `sources.html`.

- **ESPN structured injuries API** — all-30-team payload with `status`, `date`, `shortComment`, `athlete{…,links}`,
  `notes.items[]` (sourced news line), `type.name` enum and `details{fantasyStatus,type,side,returnDate}`.
  Sampled real rows: Mouhamed Gueye (ATL, fractured left foot), Jayson Tatum (BOS), Giannis Antetokounmpo (MIA). `?team=` filter verified.
- **ESPN news + scoreboard + teams + summary APIs** — re-verified; scoreboard returned **0 events** for 2026-09-17 (offseason).
- **Bluesky public API** — `getAuthorFeed`, `searchActorsTypeahead`, `graph.getList`, `graph.getFollows` all work unauthenticated;
  `searchPosts` returns **403** (documented, not worked around).
- **Official NBA Bluesky account** — valid Bluesky verification object; bio independently confirms opening night
  2026-10-20 (BOS@DET 3pm ET, PHI@NYK 7pm ET, OKC@SAS 9:30pm ET).
- **Official NBA injury report** — 2025-26 page live with the full deadline rules text; the 2026-27 URL returns **404**.
- **Official injury-PDF index** — `ak-static.cms.nba.com/referee/injury/` returns **HTTP 500** (link-only).
- **Howard Beck's 150-member NBA writers list on Bluesky** — read live; used to build the reporter roster from real data instead of memory.

Irregularities were **flagged, not hidden** — see `sources.html` → Flags (21 of them).

## What the first live run changed (real data beat the fixtures)

The free GitHub Actions poller ran for real on **2026-09-17T03:10:21Z** (run `35177148985`) and committed a snapshot:
**73 structured injury rows, 8 classified news items, 34 injury-relevant social posts, 13/13 accounts reachable, zero errors.**
Reading that snapshot row-by-row — then replaying every post through the classifier — found four defects that no fixture would have caught:

| Defect found on live data | Why it mattered | Fix |
|---|---|---|
| ESPN returns **its own** team codes for six clubs (`GS`, `NO`, `NY`, `SA`, `UTAH`, `WSH`) | 13 rows in the first snapshot had orphan chips, missed the team filter and produced broken links | `standardAbbr()` in `data.js`, applied in both the board and the poller; six mappings pinned by tests |
| `getAuthorFeed` also returns **reposts**, authored by someone else | five never-vetted accounts (`businessdecisionmv`, `katelynburns.com`, `cornpuzzle`, `playest`, `yourmandevine`) leaked into the "verified" layer | only the polled account's own posts are accepted |
| Free-form posts produced false positives — "THE VOICE IS BACK.", "locker room culture", "out for rest" | an injury alert that cries wolf is worse than no alert | explicit injury vocabulary is required; the in-game regex now needs an exit phrase; rest/roster news is labelled non-injury |
| The same post was stored twice (repost reached two feeds) | double-counting and double-alerting in the history/first-to-report trail | de-duplicated by post uri in both the layer and the poller |
| A later refactor of the poller **dropped its news classifier** | the next live run produced zero news items — it reported `errors={"news":"normalizeNews is not defined"}` rather than writing a silent empty array | restored against the shared `SIGNALS` table; `tools/poll_fixture_test.js` now runs the real poller end-to-end offline (19 checks) **before** the live poll in CI, and a smoke check asserts every normaliser it calls is defined |

The poller also no longer duplicates the browser's logic: it loads `assets/js/injuries.js` and `assets/js/social.js`
behind a DOM stub and calls the same `normalize()` / `classifyPost()` the dashboard uses, so the archive and the page
can never disagree about what an injury is. `node tools/replay_posts.js <snapshot> --check` re-asserts the invariants
on fresh data in CI, before anything is committed.

## Really-free reality check

| Want | Status |
|---|---|
| Official NBA designations | ✅ linked, but the 2026-27 page does not exist yet (404) |
| Structured, all-team status feed | ✅ ESPN structured injuries API (unofficial but working) |
| Automated social listening | ✅ **Bluesky** (no key). ❌ X/Instagram/Facebook — X reads start ~$200/mo, IG/FB have no free public API |
| Historical back-testing of reporters | ⚠️ X history is paywalled; Bluesky keyword search is 403. This project forward-collects instead, with the poller building timestamp history |
| Alerts while the tab is closed | ❌ not yet (needs Web Push/Discord/email — roadmap) |

## Run locally / test

```bash
python3 -m http.server 8080      # open http://localhost:8080

node tools/smoke_test.js         # 103 logic checks (no browser needed)
node tools/integration_test.js   # 45 checks: boots the real page scripts against fixtures
node tools/poll_fixture_test.js  # 19 checks: the real poller end-to-end against fixtures (offline)
node tools/replay_posts.js data/live/latest.json --check   # self-audit a real snapshot
node tools/poll_watch.js --dry-run   # exercise the poller without writing
node tools/poll_watch.js         # write data/live/latest.json + data/history/*
node tools/build_verified_sources.js # regenerate data/verified_sources.json
```

## Files

- `index.html` — dashboard: alert center, injury board, social layer, games/in-game, wire, team links
- `reporters.html` — verified directory (X + Bluesky) and the reliability scorecard
- `sources.html` — verification log, flags, methodology, limitations, roadmap
- `assets/js/data.js` — **single source of truth**: endpoints, 30 teams, 21 sources, 36 reporters, social allow-list, flags
- `assets/js/injuries.js` — structured board + change detection
- `assets/js/social.js` — Bluesky layer + 3-path transport + in-game exit classification
- `assets/js/wire.js` — unified chat-style stream
- `assets/js/ingame.js` — live-game absence monitor
- `tools/poll_watch.js` + `.github/workflows/injury-watch.yml` — free server-side poller (snapshots + history + firsts); shares the browser's normalisers
- `tools/replay_posts.js` — replays a real snapshot through the classifier; `--check` mode is the CI live-data self-audit
- `tools/smoke_test.js`, `tools/integration_test.js`, `tools/poll_fixture_test.js` — 105 logic + 45 integration + 19 poller checks
- `data/verified_sources.json` — machine-readable registry (generated)

**Next work and limitations:** [`NEXT_STEPS.md`](NEXT_STEPS.md).
