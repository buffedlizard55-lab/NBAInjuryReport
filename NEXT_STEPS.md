# Next steps, known gaps & limitations

Prioritized backlog for the next sessions. Live view: [sources.html](https://buffedlizard55-lab.github.io/NBAInjuryReport/sources.html) → Roadmap & Flags.
Everything below is stated honestly — no claim is made without a verified source behind it.

## ✅ Working today (verified 2026-09-17, evidence linked in `sources.html`)

| Capability | Status | Evidence |
|---|---|---|
| Structured injury board, all 30 teams (status, injury type/side, GTD flag, est. return, sourced comment) | **Working, verified on real data** | ESPN structured injuries API + the first CI snapshot (73 rows); 103 logic + 45 integration checks green |
| Chat-style merged wire across 4 layers | Working | `assets/js/wire.js` + tests (dedupe, escaping, severity tags) |
| Sound alert with on/off toggle + test button, browser notifications, per-severity filters, clickable source on every alert | Working | `assets/js/alerts.js`; fires on new listing **and** status change (`InjuryBoard.diffAlerts`, tested) |
| Free social layer for verified accounts (league, teams, reporters) | Working code path; browser CORS still to confirm once by hand | Bluesky public API verified unauthenticated for 4 endpoints; 403 for `searchPosts` (documented) |
| In-game exit **social** alerts ("left the game", "locker room", "questionable to return", "out for the remainder of the game") | Working | `INGAME_WATCH_RE` shared by browser + poller; tested incl. the ruled-out-but-in-game case |
| In-game absence monitor (injury-reason DNPs during live games) | Structure-verified, **not live-tested** | ESPN summary API, completed game 401811041 |
| Reporter directory with identity evidence | 25 X handles + 8 Bluesky reporters + 7 official/outlet accounts verified; ~21 teams still lack a named in-arena writer | `reporters.html`, evidence link per row |
| Reliability scorecard (forward-collected, evidence URLs, JSON export/import) | Working | `reporters.html`; rubric + points are tested |
| Free server-side poller (snapshots + history + first-seen timestamps) | **Working — ran on GitHub 2026-09-17T03:10:21Z** and committed a snapshot with 0 errors | Run `35177148985`; `data/live/latest.json`, `data/history/2026-09-17.jsonl`, `firsts.json` |
| CI self-audit on live data (team codes, OUT labels, duplicates) | Working | `tools/replay_posts.js --check`, wired into the workflow **before** the commit step |

## 🚧 Action required by a human (cannot be automated from this environment)

1. **Open the live site once and check the two data paths.** The build sandbox blocks shell HTTPS and returns no response headers, so browser CORS is unproven for
   `site.web.api.espn.com/…/injuries` and `public.api.bsky.app`. Expected: the board status line says `via espn-direct`, and the social panel says
   `via direct`. If either says `snapshot` or `unreachable`, tick **Allow public relay fallback** (Bluesky only) or rely on the poller snapshot. Record the result in `sources.html`.
2. ~~Confirm the first Actions run.~~ **Done 2026-09-17** — run `35177148985` succeeded and committed a real snapshot (73 rows / 13-of-13 accounts / no errors).
   Still worth a glance after any change to `tools/poll_watch.js`: the new self-audit step fails the run loudly rather than committing a suspect snapshot.
3. **Swap in the 2026-27 official injury report URL** the moment `official.nba.com/nba-injury-report-2026-27-season/` stops returning 404
   (verified 404 on 2026-09-17). One constant: `NBA_OFFICIAL_REPORT_URL` in `assets/js/data.js`, then re-run `tools/build_verified_sources.js`.
4. **Live-validate the in-game monitor on 2026-10-03** (preseason tip, MIA @ TOR). Opening night is 2026-10-20 (BOS@DET, PHI@NYK, OKC@SAS — confirmed by the official NBA account).

## ✅ Resolved during this session (kept as a record, not a to-do)

The pre-fix snapshot DID fail the new self-audit (13 rows with ESPN's own team codes, one duplicated post).
The push containing the fix regenerated it — verified on the deployed site: `errors = {}`, 74 rows / 27 team
blocks, **every team code standard** (`GSW NOP NYK SAS UTA WAS`), 8 news items classified, 8 posts (author-only,
de-duplicated), and `replay_posts --check` passing on the published file. The audit now runs **before** the commit
step, so a suspect snapshot fails the run instead of reaching the site.

## ⛔ Hard limitations (blockers, not excuses)

1. **X / Instagram / Facebook automated reading is not free.** X reads start around $200/mo; historical X search is more. IG/FB have no free public post APIs.
   *What ships instead:* a genuinely free **Bluesky** allow-list layer (verified), X embeds for eyeballing, X search links on every alert, and manual forward-scoring.
2. **Bluesky keyword search is 403 unauthenticated.** The social layer is a verified allow-list, not a firehose — an injury first reported by an unlisted account will not be caught by it.
3. **No free feed carries structured "questionable to return" in-game data.** In-game exits come from (a) verified accounts' wording, clearly labelled as a social report, and
   (b) ESPN's injury-reason DNPs, which appear after the fact. There is no free structured QTR feed — that is a data-availability limit, not a code limit.
4. **The official NBA report is link-only right now**: the 2026-27 page 404s and the PDF directory index returns HTTP 500, so nothing official can be polled automatically yet.
5. **ESPN endpoints are unofficial and internally inconsistent** (the injuries feed says season 2026-27 while the scoreboard league block says 2025-26). They work today; they can change without notice.
   Mitigation: multi-layer design, source status lines, cached/snapshot fallbacks, official manual links everywhere.
6. **The Actions poller is a recorder, not a push channel.** GitHub documents scheduled workflows as best-effort (delays under load, disabled after 60 days of repo inactivity) and the cadence is 10 minutes.
7. **Browser-local state.** Alerts, scorecard and seen-history live in `localStorage`: no cross-device sync, no alerting with the tab closed, no shared scorecard until the poller's committed history is used as the source.
8. **Automated historical back-testing of reporters is not available for free** (X history paywalled, Bluesky search 403). This project forward-collects and now builds its own timestamp history, which is the honest path.

## 🗺 Prioritized backlog

### P0 — before the first live games (2026-10-03 / 2026-10-20)
- Human check of the two browser CORS paths (above) and record the outcome.
- Live-validate the in-game monitor + confirm the poller runs on schedule during a real slate.
- Swap the official injury-report URL when the 2026-27 page appears.
- Decide whether auto-committing snapshots to `main` is acceptable (alternative: commit history to a `data` branch so the published site stays clean).

### P1 — high value, feasible free
- **Beat-writer completion:** one verified in-arena writer per team (SAS + UTA done via Bluesky this session; ~21 teams left) using the same evidence standard.
- **Official-PDF watcher** driven by the season page (the directory index is HTTP 500), alerting on each new issue.
- **Wire quality:** player-name extraction for social posts, cross-source de-duplication (same injury from ESPN board + reporter), and quiet hours / per-severity sound choices.
- **Notifications with the tab closed:** Web Push, Discord webhook, or email relay fed by the poller's events.
- **Scorekeeper from history:** derive "first to report" automatically by comparing `firsts.json` timestamps across layers, then propose scorecard entries for confirmation.

### P2 — worth doing, needs design
- **Roster/rotation weighting:** ESPN exposes verified team-roster links (`/nba/team/roster/_/name/mia`); weight alerts by starter vs bench instead of the (meaningless in basketball) "offensive player" idea.
- **Snapshot retention policy:** `data/history/*.jsonl` grows forever; add monthly roll-ups + a size guard.
- **Multi-sport adapter:** the requested "NFL" wording is a copy-paste artefact (flagged). If a genuinely multi-league system is wanted, the layer abstraction (board / news / social / in-game) is already league-agnostic — only the endpoints and team tables differ.

### P3 — paid / optional
- **X API Basic** filtered stream over the Tier-1/2 handle list → automated X alerts + real historical backfill for accuracy scores (~$200/mo).
- **balldontlie ALL-ACCESS** injury webhooks as a paid, push-based, official-ish channel (free tier has **no** injuries — verify before budgeting).
- **Hosted always-on poller** (small worker) if 10-minute cron proves too coarse for in-game latency.

## 🔁 Standing rule for every session
Re-run `node tools/smoke_test.js` (90 checks) and the `sources.html` checklist before adding features; every new claim ships with an evidence link; irregularities go into `FLAGS` instead of being worked around silently.
