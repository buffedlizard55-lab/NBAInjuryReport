# NBA Injury Watch

**Dashboard:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

**Directory:** https://buffedlizard55-lab.github.io/NBAInjuryReport/reporters.html

NBA-only injury monitoring for all 30 teams, inspired by [Basketball Monster player news](https://basketballmonster.com/playernews.aspx). All NBA players are in scope, not an NFL-style offensive roster subset.

## What works, and what is not established

| Capability | Implementation / boundary |
|---|---|
| Injury board | Public ESPN structured injuries endpoint, with source timestamps, status, reason, estimated return and review links. ESPN is **not official NBA confirmation**. Missing listings do not mean healthy players. |
| Team coverage gaps | Every refresh names the teams the current snapshot says **nothing** about (re-read 2026-09-19: still 27 of 30 — CLE, DET and LAL absent), each linked to that team's own ESPN injuries page. A 30-chip strip and, in the unfiltered team-grid, empty franchise cards make the same three visible instead of only naming them in a coverage line. An omitted block is never reported as a healthy roster. |
| Season clock | Dated public pages, not a guess: overseas camp 2026-09-22, rest of league 2026-09-29, preseason 2026-10-03, opening night 2026-10-20. ESPN/NBA list the opener at 3pm / 7pm / 9:30pm ET; Basketball Monster lists 2:00pm / 6:00pm / 8:30pm — both claims are shown. |
| Live-style wire | Browser polling of ESPN news, injuries, allow-listed Bluesky author feeds and game summaries. Default 60 seconds; configurable 30–300 seconds. Source publication delays and browser throttling are additional. |
| Severity colour-coding | Wire, social feed and injury-board rows carry a severity edge (out → return), pinned by tests that compare the emitted class names against the stylesheet — this pairing had drifted apart and the colours were not rendering at all until 2026-09-17. |
| Sound / notifications | Pleasant WebAudio bell with a **separate high-impact voice** (rising A5→C#6→E6 figure) so a `⚡ HIGH LINEUP IMPACT` absence is distinguishable by ear; on/off toggle, two sound tests, opt-in browser notifications and source-linked alert log. **Keep the tab open.** Browser audio requires a gesture; press a Test button. No closed-tab push delivery. |
| Alert safeguards | First successful observations seed silently. Failed/stale snapshots cannot clear the injury baseline. Team/severity filters apply centrally. Old posts, unknown-player social signals and unverified-identity posts do not sound. Bursts coalesce sound, not log entries. |
| In-game signals | Recent social exit/QTR language is a **reported, unconfirmed signal**, not a league designation. DNP and generic game injury arrays do **not** establish an in-game exit and do not sound. Actual live-game exit latency has not been validated. |
| Official NBA adapter | Season-page link discovery → linked PDF → layout parser → health flags. Never guesses timestamped URLs. Real historical PDF regression fixture: 229 rows across 30 teams. **No live report discovered in this audit**; automatic official confirmation remains blocked until an official page exposes report links. |
| Player identity/context | Daily best-effort all-team ESPN roster collection; explicit starter/bench observations during current games. Unknown if absent, stale or blocked. No inferred medical severity, no unsupported season-long rotation classification. |
| Lineup impact (not medical severity) | `assets/js/role.js` **model v2** (2026-09-18) grades each listing HIGH ≥ 65 / MEDIUM ≥ 40 / LOW / UNKNOWN as a weighted score over three **collected-evidence** components: **STAKE 60%** (avg minutes, start share, the player's share of the team's own collected scoring, assists, bounded on-court +/−) · **EXPOSURE 20%** (games in the next 7 days, back-to-backs, road games, city-to-city travel miles and time zones from the published schedule) · **RECURRENCE 20%** (dated ESPN roster listings plus reported in-game exits). Missing components are dropped and the remainder renormalised, with the coverage fraction printed on every row. Four documented rules: R1 starter + Out/Doubtful = HIGH · R2 rotation + Out/Doubtful ≥ MEDIUM · R3 depth caps at LOW · R4 no stake evidence = UNKNOWN **even on a heavy road trip**. Offseason reality: no 2026-27 games have been collected yet, so most rows read UNKNOWN — by design, never guessed. |
| Travel model (not flight data) | `assets/js/geo.js` — 37 city rows covering all 30 NBA home cities, great-circle distances cross-checked against published values (BOS→LAX 2,591 vs ~2,611 mi), IANA time-zone offsets read per game date, rest days from the schedule, and a documented time model (450 mph + 2.0 h overhead; ground under 250 mi at 45 mph). An unknown venue city is reported as unresolved, never approximated. No free source publishes charter or private-terminal logistics, and none is claimed. |
| History | Automatic, source-linked forward injury-listing changes. First observation is **not injury onset**. Not a complete medical history. Working ledger retains 30 days / up to 10,000 changes. |
| Social intelligence | Automatic post ledger, one-player exact-name resolution, original text/URL/hash, posted/first-observed times. A narrow game-date-matched official comparison can mark corroboration or conflict for review. **No established accuracy scores or global first-to-report rankings.** In-game claims stay pending without game-specific outcomes. |
| Reporter directory / in-arena layer | Now **computed per team** (`arenaCoverage()` in `assets/js/data.js`), not a typed table. Re-measured 2026-09-19 (session 15 live sweep + `data/live/reporter_verify.json`): **18 of 30 teams have a Bluesky-verified in-arena writer whose feed is polled automatically, the other 12 have a bio-verified pollable writer, 0 have no writer account, and 0 teams have no source at all** — the 12 short of Bluesky-verified are named as gaps on the page, never rendered as covered. **65 pollable accounts, 21 Bluesky-verified, 0 of them unmeasured; 47 active / 18 dormant by the 30-day rule** (recomputed 2026-09-19 from the committed registry plus `data/live/reporter_verify.json`; session 15 had read 46/19 before the daily CI run measured Michael Grange's 2026-09-19 post and moved him off the dormant list — see AUDIT.md, session 17). Two of those 12 gaps are honest dead ends rather than unsearched ones: Charlotte's paper of record eliminated its Hornets beat on 2026-09-14, so CHA's supported identities are a podcast analyst (`bgeisinger`) and a culture-site journalist (`britishbuzz`) — the name-matched `rodboone` handle has no bio and is REFUSED — and UTA, which lost its writer to MIN in session 13, reads **dormant-only** on all three of its rows. Every row stores the verbatim bio it was verified from, the re-checkable API URL, and the counts observed that day. A verified account is not a verified claim, a tier is not an accuracy score, and an assigned beat does not prove attendance at a game. |
| Identity **and** activity | `arenaCoverage()` returns a per-team `recency` state and a per-writer `recency` object, computed from the newest post actually measured (`ARENA_DORMANT_DAYS` = 30). Identity answers *who*; recency answers *whether anyone is still posting*. Session 14 closed the "30 of 40 writers unmeasured" hole at both ends: `tools/backfill_registry_recency.js` copies the measured date back into every registry row (and `live-audit.yml` now runs it and fails a run where the registry is behind), while six `getAuthorFeed?limit=1` reads measured the rows that had never been read. Result — **the page reads identically with and without the CI evidence file**: 34 writers active, 16 dormant, **0 unmeasured**; 27 teams with an active writer; **DAL, LAL and UTA dormant-only and labelled as such**; CLE (Danny Cunningham, −17d) and DEN (Joel Rush, −2d) both leave the dormant list on measurement, not on hope. Boundaries the numbers keep: a dormant row is kept, not deleted, because the identity is still evidenced; an ACTIVE feed still has to clear the injury-vocabulary gate before it can alert; and the quietest pollable writer (Jason Lloyd, CLE, 638 days) is printed, not hidden. |
| Official club Bluesky accounts | **Measured, not assumed:** one keyless `actor.getProfiles` request probed **25 candidate club handles** — **16 resolved, 9 do not exist at all, 0 carry a valid Bluesky verification object, and 3 carry Bluesky's own `impersonation` label** (`memphisgrizzlies`, `nyknicks`, `charlottehornetsbb`; a 4th, `dallas-maverick-s`, came from a typeahead search). Every row with its verdict is rendered on the reporter page (`NBA_OFFICIAL_ACCOUNT_PROBE`) and the verifier now fails a job on an impersonation-labelled handle in the alert path. Only POR, DEN, PHI and the league account carry a valid verification object, so only they are upgraded to polled. **Session-14 re-sweep (2026-09-19):** six more candidate handles read — four are self-evidently placeholders (`charlottehornets` 1 follower/0 posts, `dallasmavericks` 0/0, `denvernuggets` 1/7, `losangeleslakers` 2/0), **exactly one confirmed club channel was found** (`nuggets.bsky.social`, valid Bluesky verification created 2025-07-08 — DEN therefore has a verified club channel after all), and three more `impersonation`-labelled handles were recorded (`cavs.com`, `dallas-maverick-s`, `memphisgrizzlies`), taking the impersonation-labelled total to **5**. **26 of 30 franchises still have no verified club Bluesky account**, and the page says so per team. |
| X / Instagram / Facebook read access | Re-checked 2026-09-18 with dated platform evidence: tokenless oEmbed was removed **2020-10-24**; the Instagram Basic Display API errors on **all** requests since **2024-12-04**; the Instagram API needs an IG business/creator account linked to a Facebook Page; the Graph API needs an App Access Token plus the reviewable **Page Public Content Access** feature (and `appsecret_proof` since v5.0). No keyless JSON endpoint exists for a page we do not administer, so both are published as **manual-review links only** and the Bluesky allow-list remains the only free machine-readable social layer. |
| Identity re-verification (no manual input) | `tools/verify_reporters.js` re-runs the exact API call each row cites (bio, verification object, newest post) plus all 30 official club channels. A handle that stops resolving or a claimed verification object that disappears **fails the job**; bio drift and dormancy are written to `data/live/reporter_verify.json` and shown on the reporter page. Scheduled daily in `live-audit.yml`. |
| Self-consistency of the human layer | **Session 17.** The registry stored activity twice — as `observed.latestPostAt` (machine, backfilled from CI) and as a hand-written `ACTIVITY:` sentence inside `verified` — and nothing compared them, so one row shipped saying **DORMANT, 39 days** while its own stored date said **today**. `detectProseActivity()` in `tools/verify_reporters.js` now compares the ACTIVE/DORMANT verdict (not the day count, which is simply older with time), emits a warn-level `prose-drift` status that still counts as live coverage, renders a `prose ≠ measurement` badge with both numbers on the reporter page, and is pinned by a registry-wide invariant that fails on a fresh clone. Separately, the age arithmetic in both copies (`arenaDaysSince`, `ageDays`) now floors at 0: a newest post can legitimately be newer than the reference clock, which used to render "-1 days since newest post". See [AUDIT.md](AUDIT.md), session 17. |
| Official club channels | `nba.com/<slug>/news` for all 30 franchises — free, keyless, first-party. **Measured 2026-09-18: all 30 answered HTTP 403 to the CI runner**, while CLE's page answered 200 to a browser-shaped client the same day. So this is a **manual-review link**, not a machine-read feed, and the UI says exactly that per row (`NBA_TEAM_NEWS_PROBE`). Deliberately **not** an injury feed either: club releases cover signings and promotions far more often than injuries. Corroboration only, never the alert trigger. |

## Reproducible audit, September 17, 2026

See [AUDIT.md](AUDIT.md) for findings and verification scope, and [data/audit/latest.json](data/audit/latest.json) for independent runner HTTP statuses, timestamps and body hashes. Since the session-7 fix each row also carries an explicit `verified` flag: **OK** is reserved for a response that actually verifies the claim, and a tolerated refusal (HTTP 403 on a JSON endpoint this client is fingerprinted out of) is **ENV-BLOCKED** with `verified=false`. Before that fix four checks that had read nothing printed OK.

- Official 2026–27 injury-report page: **404** (re-read 2026-09-19 ~18:50Z, `XID: 72640245`; earlier XIDs 71103381 / 44289229 / 74717976). Still no PDF link, and no filename has been guessed.
- Post-fix runner audit (`2026-09-17T21:22:35Z`, 22 checks, 0 drift, 0 tool errors): **16 of 22 claims verified by that run**, 6 `ENV-BLOCKED` — four `site.api.espn.com` JSON calls fingerprinted to **403** (`espn-teams`, `espn-scoreboard`, `espn-roster-mia`, `espn-teams-mia`) and two `www.espn.com` HTML pages returning the **202** bot-challenge interstitial. The Node collector and the deployed browser reach all of them.
- Previous season page: **200**, but no timestamped injury-PDF links observed.
- Known historical official PDF: **200**, parsed and tested for page breaks and wrapped reasons.
- ESPN injuries: **200**, 75 rows in 27 team blocks (21:22Z run; re-read 2026-09-19 ~18:50Z, `timestamp 2026-09-19T18:50:34Z`, same 27 blocks and the same three omissions) — **CLE, DET and LAL returned no block at all**, which the board now names explicitly. The team dropdown *does* list all 30, so the omission is in the data, not the navigation.
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
3. Roster + schedule + current-game collection (`tools/collect_context.js`) — dated injury listings, contracts, live/next-7/last-2 games with venues, rest days, city-to-city travel and time-zone shifts, and box-score minutes/points/assists/on-court +/− deduped per game (schema 3); feeds both halves of the lineup-impact model.
4. ESPN and Bluesky snapshot collection using shared browser classifiers.
5. Automatic observation ledger and source-linked injury history.
6. Live-snapshot invariant check, snapshot/history commit and artifact upload.

`live-audit.yml` runs daily (`17 9 * * *`, plus manual dispatch) and re-verifies the human layer independently of the collector: every stored reporter identity (bio + verification object + newest post) and all 30 official club channels. It fails only on a broken identity claim, then runs `tools/backfill_registry_recency.js` (and `--check`) so the measured newest-post date is stored in the registry as well as in the evidence file, and commits both — so a stale "verified" tick cannot survive a day unnoticed, and a fresh clone or fork build shows measured recency instead of *unmeasured*.

`pages.yml` checks the existing Pages mode on main pushes and after the main collector completes: it requests a rebuild for the existing branch-based site, or deploys a Pages artifact when workflow mode is configured. This avoids relying on a bot commit to trigger legacy Pages builds. Scheduled workflows can be delayed/disabled; **ten-minute scheduling is not a low-latency service guarantee**. Raw daily snapshots are retained in the working tree for seven days; artifacts for 14 days. Git still retains earlier objects—move collection to a database/object store for production.

## Run / test

```sh
python3 -m http.server 8080 --bind 0.0.0.0
node tools/smoke_test.js                 # board strip + season clock + social allow-list + OUT-label invariant
node tools/impact_test.js                # geo, collector math, impact model v2, wiring (every getElementById must exist)
node tools/integration_test.js           # boots the real dashboard AND the reporter page; pins the board as the
                                      # second section, and pins the verifier-drift panel rendering
node tools/poll_fixture_test.js          # poller set DERIVED from the registry, held-out rows never polled; real poller, fixture transports
node tools/verify_reporters_test.js      # identity policy + the REAL CLI run offline against a stubbed network
                                      # + the registry-wide prose/measurement invariant (session 17)
node tools/regression_test.js            # includes the 40-day ESPN stamp that used to silent-drop board alerts
python3 -m unittest discover -s tools -p 'test_*.py'   # 26 tests, incl. the audit tool itself
node tools/replay_posts.js data/live/latest.json --check
node tools/verify_reporters.js        # live identity + club-channel re-verification (needs network)
                                      # exit 1 iff a handle stops resolving or a claimed
                                      # verification object disappears; drift/dormancy are recorded
node tools/backfill_registry_recency.js --check   # exit 1 if the registry is behind the CI measurement of
                                      # record; no args = write the measured dates back (idempotent)
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
