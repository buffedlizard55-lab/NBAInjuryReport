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

## 3. Harden player and reporter identity

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

## 5. Role/impact and injury history

- Collect dated recent game logs and starter/minutes history; define a transparent configurable rotation heuristic, minimum sample and staleness threshold.
- Use fresh game lineup evidence for “starter this game”; don't carry it into the next game as a guaranteed lineup.
- Separate availability status, source confidence, medical severity (usually unknown) and lineup impact.
- Corroborate injury episodes and body-part/reinjury transitions without treating a player's first project observation as injury onset.

## 6. Delivery, storage and operations

- Add opt-in Web Push/Discord/email on a backend for closed-tab delivery; never put delivery secrets in public static assets.
- Cross-tab coordination and player/game/status semantic deduplication across sources.
- Automatic source-health monitoring, rate-limit backoff, last-good persistence and explicit missed-coverage windows.
- Replace repeated Git snapshots with an append-only database/object store. Current raw working-tree snapshots: seven days; ledger: 30 days / 10,000 changes. Old Git objects remain.
- Verify deployed Pages output after every collector change. `pages.yml` explicitly deploys after main's collector workflow.

## External access limitations

No authorized X, Instagram, Facebook or live broadcast connector is configured. Review each platform's current official access/licensing terms; do not rely on inherited fixed pricing statements or evade access controls. Free publicly accessible ESPN endpoints are undocumented and may change or return 403. The present system is a best-effort monitoring foundation, not complete verified real-time coverage.
