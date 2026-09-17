# NBA Injury Watch

**Dashboard:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

**Directory:** https://buffedlizard55-lab.github.io/NBAInjuryReport/reporters.html

NBA-only injury monitoring for all 30 teams, inspired by [Basketball Monster player news](https://basketballmonster.com/playernews.aspx). All NBA players are in scope, not an NFL-style offensive roster subset.

## What works, and what is not established

| Capability | Implementation / boundary |
|---|---|
| Injury board | Public ESPN structured injuries endpoint, with source timestamps, status, reason, estimated return and review links. ESPN is **not official NBA confirmation**. Missing listings do not mean healthy players. |
| Live-style wire | Browser polling of ESPN news, injuries, allow-listed Bluesky author feeds and game summaries. Default 60 seconds; configurable 30–300 seconds. Source publication delays and browser throttling are additional. |
| Sound / notifications | Pleasant WebAudio bell, on/off toggle, sound test, opt-in browser notifications and source-linked alert log. **Keep the tab open.** Browser audio requires a gesture; press Test sound. No closed-tab push delivery. |
| Alert safeguards | First successful observations seed silently. Failed/stale snapshots cannot clear the injury baseline. Team/severity filters apply centrally. Old posts, unknown-player social signals and unverified-identity posts do not sound. Bursts coalesce sound, not log entries. |
| In-game signals | Recent social exit/QTR language is a **reported, unconfirmed signal**, not a league designation. DNP and generic game injury arrays do **not** establish an in-game exit and do not sound. Actual live-game exit latency has not been validated. |
| Official NBA adapter | Season-page link discovery → linked PDF → layout parser → health flags. Never guesses timestamped URLs. Real historical PDF regression fixture: 229 rows across 30 teams. **No live report discovered in this audit**; automatic official confirmation remains blocked until an official page exposes report links. |
| Player identity/context | Daily best-effort all-team ESPN roster collection; explicit starter/bench observations during current games. Unknown if absent, stale or blocked. No inferred medical severity, no unsupported season-long rotation classification. |
| History | Automatic, source-linked forward injury-listing changes. First observation is **not injury onset**. Not a complete medical history. Working ledger retains 30 days / up to 10,000 changes. |
| Social intelligence | Automatic post ledger, one-player exact-name resolution, original text/URL/hash, posted/first-observed times. A narrow game-date-matched official comparison can mark corroboration or conflict for review. **No established accuracy scores or global first-to-report rankings.** In-game claims stay pending without game-specific outcomes. |
| X / Instagram / Facebook | **No authorized read connector configured.** X embeds and links are manual review only, not alert inputs. Current pricing and access entitlements are not asserted. |
| Reporter directory | Legacy curated identity evidence plus automatic forward ledger. A verified account is not a verified claim, a tier is not an accuracy score, and an assigned beat does not prove attendance at a game. |

## Reproducible audit, September 17, 2026

See [AUDIT.md](AUDIT.md) for findings and verification scope, and [data/audit/latest.json](data/audit/latest.json) for independent runner HTTP statuses, timestamps and body hashes.

- Official 2026–27 injury-report page: **404**.
- Previous season page: **200**, but no timestamped injury-PDF links observed.
- Known historical official PDF: **200**, parsed and tested for page breaks and wrapped reasons.
- ESPN injuries: **200**, 74 rows in 27 team blocks in that audit.
- ESPN teams and scoreboard: **403** in that runner; access is endpoint/environment-dependent.
- NBA Bluesky profile: **200**, valid verification object observed.
- Bluesky search: **403 observed**, not a universal conclusion about its API access model.
- Basketball Monster player news: **200**; reference/source links only, not scraped into alerts.

These observations do not certify every legacy reporter link or guarantee later access. The UI exposes failures rather than inventing coverage.

## Data pipeline / Pages

`injury-watch.yml` runs every ten minutes (best effort):

1. Offline logic, integration, poller, regression and official-PDF tests.
2. Official report discovery and PDF parsing (`poppler-utils`).
3. Roster/current-game role collection.
4. ESPN and Bluesky snapshot collection using shared browser classifiers.
5. Automatic observation ledger and source-linked injury history.
6. Live-snapshot invariant check, snapshot/history commit and artifact upload.

`pages.yml` deploys the static site on main pushes and after the main collector completes. This avoids relying on a bot commit to trigger legacy Pages builds. Scheduled workflows can be delayed/disabled; **ten-minute scheduling is not a low-latency service guarantee**. Raw daily snapshots are retained in the working tree for seven days; artifacts for 14 days. Git still retains earlier objects—move collection to a database/object store for production.

## Run / test

```sh
python3 -m http.server 8080 --bind 0.0.0.0
node tools/smoke_test.js
node tools/integration_test.js
node tools/poll_fixture_test.js
node tools/regression_test.js
python3 -m unittest discover -s tools -p 'test_*.py'
node tools/replay_posts.js data/live/latest.json --check
```

Real Chromium UI tests (fixture transports, not proof of live coverage):

```sh
npm install --no-save --package-lock=false playwright@1.55.0
npx playwright install chromium
node tools/browser_test.js
```

Network collectors, without credentials:

```sh
python3 tools/collect_official.py    # requires pdftotext on PATH
node tools/collect_context.js
node tools/poll_watch.js
node tools/build_intelligence.js
python3 tools/verify_live.py         # reproducible source audit
```

`NBA_WATCH_OUT=/path/to/scratch` redirects collector output for isolated tests. `poll_watch.js --dry-run` writes nothing. Shell HTTPS egress is restricted in this workspace; independent GitHub runners were used to verify live responses. No access controls are bypassed.

**Next priorities and limitations:** [NEXT_STEPS.md](NEXT_STEPS.md).
