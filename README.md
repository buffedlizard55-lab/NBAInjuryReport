# NBA Injury Watch

**Dashboard:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

**Directory:** https://buffedlizard55-lab.github.io/NBAInjuryReport/reporters.html

NBA-only injury monitoring for all 30 teams, inspired by [Basketball Monster player news](https://basketballmonster.com/playernews.aspx). All NBA players are in scope, not an NFL-style offensive roster subset.

## What works, and what is not established

| Capability | Implementation / boundary |
|---|---|
| Injury board | Public ESPN structured injuries endpoint, with source timestamps, status, reason, estimated return and review links. ESPN is **not official NBA confirmation**. Missing listings do not mean healthy players. |
| Team coverage gaps | Every refresh names the teams the current snapshot says **nothing** about (2026-09-17 snapshot: 27 of 30 blocks — CLE, DET and LAL absent), each linked to that team's own ESPN injuries page. An omitted block is never reported as a healthy roster; a full 30/30 snapshot still says it is not clearance. |
| Live-style wire | Browser polling of ESPN news, injuries, allow-listed Bluesky author feeds and game summaries. Default 60 seconds; configurable 30–300 seconds. Source publication delays and browser throttling are additional. |
| Severity colour-coding | Wire, social feed and injury-board rows carry a severity edge (out → return), pinned by tests that compare the emitted class names against the stylesheet — this pairing had drifted apart and the colours were not rendering at all until 2026-09-17. |
| Sound / notifications | Pleasant WebAudio bell, on/off toggle, sound test, opt-in browser notifications and source-linked alert log. **Keep the tab open.** Browser audio requires a gesture; press Test sound. No closed-tab push delivery. |
| Alert safeguards | First successful observations seed silently. Failed/stale snapshots cannot clear the injury baseline. Team/severity filters apply centrally. Old posts, unknown-player social signals and unverified-identity posts do not sound. Bursts coalesce sound, not log entries. |
| In-game signals | Recent social exit/QTR language is a **reported, unconfirmed signal**, not a league designation. DNP and generic game injury arrays do **not** establish an in-game exit and do not sound. Actual live-game exit latency has not been validated. |
| Official NBA adapter | Season-page link discovery → linked PDF → layout parser → health flags. Never guesses timestamped URLs. Real historical PDF regression fixture: 229 rows across 30 teams. **No live report discovered in this audit**; automatic official confirmation remains blocked until an official page exposes report links. |
| Player identity/context | Daily best-effort all-team ESPN roster collection; explicit starter/bench observations during current games. Unknown if absent, stale or blocked. No inferred medical severity, no unsupported season-long rotation classification. |
| Lineup impact (not medical severity) | `assets/js/role.js` grades each listing HIGH/MEDIUM/LOW/UNKNOWN from **collected** evidence only: box-score starts/minutes (≥3 games, ≥60% starts for a starter), the current game's lineup card, injury-listing cadence from dated ESPN roster entries, and reported in-game exits from the ledger. Offseason reality: no 2026-27 games have been collected yet, so most rows read IMPACT UNKNOWN — by design, never guessed. |
| History | Automatic, source-linked forward injury-listing changes. First observation is **not injury onset**. Not a complete medical history. Working ledger retains 30 days / up to 10,000 changes. |
| Social intelligence | Automatic post ledger, one-player exact-name resolution, original text/URL/hash, posted/first-observed times. A narrow game-date-matched official comparison can mark corroboration or conflict for review. **No established accuracy scores or global first-to-report rankings.** In-game claims stay pending without game-specific outcomes. |
| X / Instagram / Facebook | **No authorized read connector configured.** X embeds and links are manual review only, not alert inputs. Current pricing and access entitlements are not asserted. |
| Reporter directory | Legacy curated identity evidence plus automatic forward ledger. A verified account is not a verified claim, a tier is not an accuracy score, and an assigned beat does not prove attendance at a game. |

## Reproducible audit, September 17, 2026

See [AUDIT.md](AUDIT.md) for findings and verification scope, and [data/audit/latest.json](data/audit/latest.json) for independent runner HTTP statuses, timestamps and body hashes. Since the session-7 fix each row also carries an explicit `verified` flag: **OK** is reserved for a response that actually verifies the claim, and a tolerated refusal (HTTP 403 on a JSON endpoint this client is fingerprinted out of) is **ENV-BLOCKED** with `verified=false`. Before that fix four checks that had read nothing printed OK.

- Official 2026–27 injury-report page: **404** (re-read again this session, ~21:00Z, `XID: 74717976`).
- Post-fix runner audit (`2026-09-17T21:22:35Z`, 22 checks, 0 drift, 0 tool errors): **16 of 22 claims verified by that run**, 6 `ENV-BLOCKED` — four `site.api.espn.com` JSON calls fingerprinted to **403** (`espn-teams`, `espn-scoreboard`, `espn-roster-mia`, `espn-teams-mia`) and two `www.espn.com` HTML pages returning the **202** bot-challenge interstitial. The Node collector and the deployed browser reach all of them.
- Previous season page: **200**, but no timestamped injury-PDF links observed.
- Known historical official PDF: **200**, parsed and tested for page breaks and wrapped reasons.
- ESPN injuries: **200**, 75 rows in 27 team blocks (21:22Z run) — **CLE, DET and LAL returned no block at all**, which the board now names explicitly.
- ESPN teams and scoreboard: **403** in that runner; access is endpoint/environment-dependent.
- NBA Bluesky profile: **200**, valid verification object observed.
- Bluesky `getFollows(nba.com)`: **200**, 6 follows — 4 carry valid verification objects (POR, DEN, PHI, WNBA), DAL does not, `bsky.app` is a *trusted verifier* (not the same thing).
- Bluesky `getList` with the correct `list=<AT-URI>`: **200**, `listItemCount` 150. The audit had been requesting an invalid parameter form and printing 400; fixed this session and confirmed by the runner.
- Bluesky search: **403 observed**, not a universal conclusion about its API access model.
- ESPN roster payload: **200**, athletes in a **top-level `athletes[]`** array — the shape `tools/collect_context.js` collects and the shape the audit now reads (it previously read a key that does not exist).
- Basketball Monster player news: **200**; reference/source links only, not scraped into alerts.

These observations do not certify every legacy reporter link or guarantee later access. The UI exposes failures rather than inventing coverage.

## Data pipeline / Pages

`injury-watch.yml` runs every ten minutes (best effort):

1. Offline logic, integration, poller, regression and official-PDF tests.
2. Official report discovery and PDF parsing (`poppler-utils`).
3. Roster/current-game role collection (`tools/collect_context.js`) — dated injury listings, contracts, starter/minutes samples deduped per game; feeds the lineup-impact layer.
4. ESPN and Bluesky snapshot collection using shared browser classifiers.
5. Automatic observation ledger and source-linked injury history.
6. Live-snapshot invariant check, snapshot/history commit and artifact upload.

`pages.yml` checks the existing Pages mode on main pushes and after the main collector completes: it requests a rebuild for the existing branch-based site, or deploys a Pages artifact when workflow mode is configured. This avoids relying on a bot commit to trigger legacy Pages builds. Scheduled workflows can be delayed/disabled; **ten-minute scheduling is not a low-latency service guarantee**. Raw daily snapshots are retained in the working tree for seven days; artifacts for 14 days. Git still retains earlier objects—move collection to a database/object store for production.

## Run / test

```sh
python3 -m http.server 8080 --bind 0.0.0.0
node tools/smoke_test.js                 # 188 checks
node tools/integration_test.js           # 52 checks (boots the real dashboard on fixtures)
node tools/poll_fixture_test.js          # 24 checks (real poller, fixture transports)
node tools/regression_test.js            # 26 groups
python3 -m unittest discover -s tools -p 'test_*.py'   # 26 tests, incl. the audit tool itself
node tools/replay_posts.js data/live/latest.json --check
python3 tools/verify_live.py          # records drift if a source's HTTP behaviour changes
                                      # (needs network: do NOT run it in a sandbox with no egress —
                                      #  it would overwrite committed evidence with UNREACHABLE rows)
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
