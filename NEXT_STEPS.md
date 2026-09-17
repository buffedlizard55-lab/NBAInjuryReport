# Next-session priorities

## 1. Establish a genuinely live official injury stream

- Inspect NBA season-report delivery when the current-season page exposes report links. Current result: 2026–27 page 404; prior season HTML has no timestamped injury PDF links.
- Do not guess a report timestamp or present a historical PDF as current.
- Add several dated official fixtures: report rollover, amended status, multiple game dates, not-yet-submitted teams, new PDF layout.
- Acceptance: an actual newly published report is discovered automatically, every player/game row matches the PDF, its source timestamp is preserved, and a later official OUT update triggers one source-linked alert.

## 2. Measure real game-time behavior, then improve latency

- Record actual ESPN scoreboard, summary and official NBA live-data responses during a game; preserve source/observed timestamps and HTTP errors.
- Verify explicit injury exit, questionable-to-return, returned-to-game and out-for-remainder signals. A DNP row is never sufficient.
- Evaluate [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) with a DID allow-list, reconnect cursor and outage accounting. Its existence is not proof of adequate NBA reporter coverage.
- Run an always-on collector with durable storage if seconds-level latency is required. GitHub scheduled jobs and static Pages cannot provide that guarantee.
- Acceptance: measure median/p95 publication-to-observation-to-alert latency on real events; don't substitute poll interval for measured latency.

## 3. Harden player and reporter identity (partly advanced 2026-09-17: 20 directory rows now carry verbatim injury-feed citations, corrected outlets and cleared flags)

- Revalidate each legacy directory row using outlet bios and official outbound account links; flag employment/handle changes and retired/inactive accounts.
- Pin account DIDs, retain dated verification evidence and stop trusting an account if identity changes. Explicitly separate official team, outlet-verified reporter, community-listed and unverified.
- Build an all-30-team coverage matrix with actual reachable accounts, recent posting activity and gaps. Do not infer attendance at a game from a beat assignment.
- Reconcile ESPN roster IDs across transfers/duplicate names; keep nicknames and ambiguous multi-player posts pending until resolved safely.
- Acceptance: 30 recently retrieved rosters or visible per-team failures, every eligible alert names exactly one supported NBA player, and every reporter identity has re-openable independent evidence.

## 4. Finish game-specific reliability scoring

- Expand automatic ledger beyond exact-name/single-player statements with conservative, tested claim extraction and a human-review queue for ambiguity (collection itself stays automatic).
- Preserve post edits/corrections/deletions and immutable per-observation evidence.
- Match claims to a specific game and claim time, not simply a later season-level injury row.
- Establish independent outcomes for QTR and exits. Absence of an update is not wrong; a later status change need not contradict an earlier report.
- Publish resolved sample size, coverage, abstention rate and uncertainty before any accuracy score. Keep “first observed among monitored sources” separate from global first-to-report.
- Historical backtesting requires obtainable, permitted original posts and contemporaneous outcome evidence. Until then, collect forward and label unknown.

## 5. Role/impact and injury history — first pass SHIPPED 2026-09-17, refinements remain

Shipped: `assets/js/role.js` (`LineupImpact`) separates four things that are usually conflated —
**availability** (the source's status), **lineup impact** (how much production the absence vacates, computed only from evidence this project
collected), **listing cadence** (dated history of ESPN injury listings = recurrence indicator) and **contract cost of the vacated minutes**.
Config is one object (`minGames 3`, `starterShare 0.6`, `rotationMinutes 18`, `benchMinutes 10`, `roleFreshMs 45d`, `rosterFreshMs 48h`) and every
label states which evidence produced it. `tools/collect_context.js` (schema 2) accumulates per-player starter/minutes observations across runs
with a dedupe key so one game is never counted twice; `tools/build_intelligence.js` publishes `exits` (latest reported in-game exit per player,
status `reported-unconfirmed`), and the board, alerts, history table and CI snapshot all carry the impact observation.
**Medical severity is not computed and no code path may add it**: no free source re-read on 2026-09-17 publishes a clinical grade.

Remaining:
- Backfill is impossible without games: `roleStats` stays empty until the 2026-10-03 preseason tip. First acceptance check is therefore *"IMPACT UNKNOWN
  is displayed for most rows in October, and starts filling in as box scores are collected"* — not a populated column on day one.
- Depth charts exist only as HTML (`espn-depth-chart-page` records the probed-and-rejected JSON routes). To use them: capture a real fixture,
  write a parser that fails closed on layout change, keep it as corroboration only. Never scrape blind.
- Reconcile trades: `rosterUrl`/`playerId` drift when a player moves mid-season; the collector keys on `playerId` and re-keys on roster fetch,
  but the accumulated `roleStats` still carry the old team label. Add an explicit team-change note instead of silently reassigning minutes.
- Contract capture takes the newest `season.year`; it must also flag a player whose contract entry is missing (two-way/two-way-expired) rather
  than printing "contract not collected" for a player who simply has no entry.
- Add recurrence corroboration across seasons (same body part twice) **only** if listing history is retained long enough; today `injuryEntries`
  is capped at 8 per player and 270 days of listing recency, and first observation must never be presented as injury onset.
- Minutes are averages over collected games; a 6-game sample of a blowout-heavy stretch misleads. Consider median minutes and per-game spread.

## 6. Delivery, storage and operations

- Add opt-in Web Push/Discord/email on a backend for closed-tab delivery; never put delivery secrets in public static assets.
- Cross-tab coordination and player/game/status semantic deduplication across sources.
- Automatic source-health monitoring, rate-limit backoff, last-good persistence and explicit missed-coverage windows.
- Replace repeated Git snapshots with an append-only database/object store. Current raw working-tree snapshots: seven days; ledger: 30 days / 10,000 changes. Old Git objects remain.
- Verify deployed Pages output after every collector change. `pages.yml` explicitly deploys after main's collector workflow.

## External access limitations

No authorized X, Instagram, Facebook or live broadcast connector is configured. Review each platform's current official access/licensing terms; do not rely on inherited fixed pricing statements or evade access controls. Free publicly accessible ESPN endpoints are undocumented and may change or return 403. The present system is a best-effort monitoring foundation, not complete verified real-time coverage.
