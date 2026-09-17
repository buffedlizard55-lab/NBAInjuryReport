# Correctness and source audit — 2026-09-17

## Scope and evidence standard

Reviewed data normalization, classification, alert delivery, refresh orchestration, source registry, collection/history writers, directory/scoring UI and deployment configuration. Ran existing tests before changes. Added adversarial regression and real historical NBA PDF tests. This is **not a claim that every line of inherited prose, reporter affiliation or external source has been independently reverified**. Legacy registry assertions are visibly qualified; sources not rechecked remain review items.

No NFL feeds are used. All NBA players can participate offensively; starter/rotation importance is distinct from medical injury severity. Neither playing role nor a surgery headline establishes medical severity or an official OUT designation.

## Source-by-source live checks

Machine-readable [HTTP evidence](data/audit/latest.json) was produced by [runner 35179202590](https://github.com/buffedlizard55-lab/NBAInjuryReport/actions/runs/35179202590). It records collection time, exact requested URL, final URL, status, content type and SHA-256 where available. An HTTP 200 proves retrieval, not accuracy, permission for unlimited use, identity of every quoted person, or end-to-end browser CORS.

| Source | Observation | Interpretation / manual review |
|---|---|---|
| [NBA 2026–27 report](https://official.nba.com/nba-injury-report-2026-27-season/) | 404 | Current-season adapter cannot claim a live designation. |
| [NBA 2025–26 report](https://official.nba.com/nba-injury-report-2025-26-season/) | 200; no timestamped report links in received HTML | Rules page accessible, not a currently ingestible injury feed. Collector tries current then prior season, without guessing PDF URLs. |
| [Official historical PDF](https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf) | 200; hash in audit | April 12, 2026 at 1 PM Eastern, historical only. Text fixture preserved for regression, not loaded as current injuries. |
| [ESPN injuries](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries) | 200; 74 rows, 27 blocks, 2026–27 season metadata | Editorial structured status. Old row timestamps coexist with new season metadata. No-listing is not healthy. |
| [ESPN teams](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams) | 403 in runner | Roster collection must surface gaps, not assume all-player identity coverage. |
| [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard) | 403 in runner | Do not convert a failed scoreboard into “no live games.” |
| [NBA Bluesky profile](https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com) | 200; DID and valid verification object captured | Evidence for this account at this time, not all allow-listed accounts or all posts. |
| [Bluesky search](https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1) | 403 in runner | Environment observation, not proof that all keyword search universally requires auth/payment. |
| [Basketball Monster](https://basketballmonster.com/playernews.aspx) | 200 | Product reference and human-review source links. No undocumented paid/private interfaces used. |
| [Bluesky official API docs](https://endpoints.bsky.app/#bluesky-app) | Independently opened via page-fetch tool | Documents most app.bsky GETs as public on public.api.bsky.app and links Jetstream. Investigate as next latency upgrade. |
| [X pricing docs](https://docs.x.com/x-api/getting-started/pricing) | Page-fetch returned 403 | Earlier fixed dollar prices are unverified historical statements, not current requirements. No X read connector configured. |

NBA rules page text was also independently opened: it specifies day-before and game-day reporting requirements and continual report updates. That does **not** promise seconds-level in-game detection by this application.

## Line-level behavioral findings and fixes

| Area | Finding | Resolution / test |
|---|---|---|
| `assets/js/ingame.js:extract` | DNP promoted to “OUT — IN-GAME LISTING”; a DNP player may never have entered | Label DNP explicitly; `alertEligible:false`. No exit assertion without separate evidence. |
| Same | Unknown/available injury-array status could default to OUT | Recognized status allow-list and shared normalization; generic arrays remain non-alerting exit evidence. |
| Same | Summary failure rendered as no findings | Failed game IDs displayed as collection warnings. |
| `assets/js/app.js:runInGame` | Scoreboard failure was passed as an empty schedule | Failure is now unavailable, not “no games.” |
| `assets/js/injuries.js:fetchBoard/check` | Failed fetch emptied rows and reset baseline | Preserve last-good rows/baseline; reject stale/error snapshots; pause alerts on failure. |
| `assets/js/injuries.js:normalize` | ESPN athlete IDs absent in injury objects despite IDs in playercard URLs | Extract ID from the observed `/id/<digits>/` playercard link when explicit ID absent. |
| `assets/js/alerts.js:fire` | Only some producer paths respected filters | Central team/severity policy, freshness suppression, audit log for silent events. Test sound remains independent of mute. |
| Same | Multiple events could stack many chimes | Coalesce chime bursts to one per 1.5 seconds; retain each log entry. |
| `assets/js/social.js:fetchDirect` | Sequential account requests and replies excluded | Four concurrent workers, last 50 author-feed entries including own replies. Reposts remain excluded. This is still bounded polling, not full historical capture. |
| Same | Snapshot account status read from wrong location | Read `social.accounts`; reject stale/error fallback data. |
| `assets/js/social.js:classifyPost` | Doubtful in-game reports could receive an OUT label | Only explicit OUT escalates to OUT; negated OUT phrases are review-only. |
| `assets/js/data.js:SIGNALS` | Surgery/fracture alone promoted news to OUT | Medical terms alone are mentions. This is still a heuristic, not a comprehensive language parser. |
| `assets/js/social.js:checkAlerts` | Reporter's name/beat substituted for injured player/team | Alert text includes the actual post. Sound requires one exactly recognized NBA player and allow-listed identity evidence; unresolved items stay visible silently. |
| `assets/js/app.js:runSocial` | A reporter's assigned beat was used as each post's team | Wire now uses resolved player identity or leaves team unknown. |
| `assets/js/data.js:REPORTERS` | Shams Charania row incorrectly contained John Hollinger's Bluesky handle | Wrong field removed; separate identities preserved. No guessed replacement handle. |
| `assets/js/social.js:testFeeds` / `index.html` | Diagnostic results overwrote the test button; nested table placed inside tbody | Dedicated diagnostic output and valid standalone table container. |
| `assets/js/app.js:refresh` | Slow refreshes could overlap and sequential feeds delay one another | Single-flight orchestration with parallel independent layers. |
| `tools/poll_watch.js` | History omitted source URLs and truncated post evidence | Retain review links, player IDs, reason and full post text; bounded working-tree retention. |
| `tools/collect_official.py` | Official PDF previously link-only | Discover linked reports, parse wrapped player blocks, preserve source time/hash, quarantine malformed layouts, expose stale/unavailable health. |
| `tools/collect_context.js` | No current role or roster collector | Best-effort roster IDs and explicit current-game starter/bench observations; no invented rotation role. |
| `tools/build_intelligence.js` | Accuracy scorecard required manual input | Automatic observation ledger and narrow game-date comparisons. Conflicts are review items, not negative accuracy points. Legacy local annotations clearly separated. |
| `.github/workflows/pages.yml` | GITHUB_TOKEN collector commits do not reliably trigger legacy Pages updates | Explicit Pages deployment after the collector workflow, plus main pushes. |

## Official PDF parser validation

Captured `pdftotext -layout` output from the linked historical PDF is in `data/audit/sample-report.txt`. Real output changes column offsets per page and can place a wrapped reason before the vertically centered player name. Initial fixed-column reasoning would have been incorrect. Parser instead uses blank-separated player blocks, inherited game/team context and page-continuation handling, with ambiguity flags.

Tests assert 229 parsed rows / 30 team names; no duplicate player/game keys; exact Alexander-Walker toe sprain, Towns cross-page elbow reason, Jalen Johnson rest, and Lakers late-page entries. This is one real layout fixture, **not validation against every report layout**. An unknown or ambiguous layout fails closed. “Not yet submitted” is retained as raw coverage evidence, not converted into healthy players.

## Remaining irregularities / deployment acceptance

1. **Critical:** no live official report currently discovered. Adapter ready, but official alerting cannot be demonstrated with current evidence.
2. **Critical:** free low-latency coverage for every reporter/team/game is not achieved. GitHub cron is delayed/best-effort; browser polling is open-tab only.
3. **Critical:** X/Instagram/Facebook reads and live TV/radio transcription are not connected. No bypasses or invented posts.
4. **High:** directory identity verification is still primarily legacy static evidence, not pinned-DID continuous verification for every account. Require per-account identity refresh before production trust claims; a verified badge is not proof of injury accuracy.
5. **High:** exact-name matching misses nicknames and ambiguity; it intentionally suppresses alerts rather than guessing. Active-roster fetch failures lower coverage. A name not on collected rosters may still be picked up from the injury board; trades need better reconciliation.
6. **High:** medical severity and stable rotation role are not reliably inferable from available fields. UI says unknown. Current-game starter flags alone are not season-long role history.
7. **High:** no independent game-scoped return outcome feed, so QTR/exit reliability cannot yet be automatically scored. A later official status change is not necessarily a false original report.
8. **Medium:** post edits/deletions and all historical posts are not captured; a 50-entry author window can miss burst traffic. First observed by this project is not global first report.
9. **Medium:** cross-layer semantic duplicate alerts and multi-tab duplicates are not fully eliminated. Browser storage/notification support varies. Chime playback can be browser-tested but pleasantness/audibility on the user's device cannot be proven remotely.
10. **Medium:** working-tree retention does not remove old Git objects. Move event storage out of Git for sustainable production collection.

See [NEXT_STEPS.md](NEXT_STEPS.md) for the next-session acceptance checklist.

## GitHub permission findings

The session connection can push the fixed branch and create a PR, but workflow dispatch and changing Pages configuration returned `403 Resource not accessible by integration`. These are operation-specific permission limits, not a request for credentials. Live collection is tested via a branch push trigger. The Pages workflow preserves the existing branch-based configuration and requests a rebuild with its scoped workflow token; artifact deployment remains supported if the repository later uses workflow mode. Deployment success must be checked after merge.

## Follow-up live collection and browser checks

[Collector run 35179796453](https://github.com/buffedlizard55-lab/NBAInjuryReport/actions/runs/35179796453) succeeded with 74 injury listings, 13 social observations, and an automatic 74-entry initial injury history. Main snapshot errors were empty. Context collection reached 28 team rosters / 522 roster entries; NOP and UTA returned 400. Their routing was corrected to ESPN's canonical `no` and `utah` codes (not a guessed numeric team ID). Official collection correctly reported no discoverable report links. No current-game role observations were available.

[Chromium run 35179912267](https://github.com/buffedlizard55-lab/NBAInjuryReport/actions/runs/35179912267) passed the fixture-backed browser checks, including actual WebAudio context activation, persisted mute, filtering, diagnostics and mobile overflow. The hidden custom checkbox was replaced by a keyboard-focusable control. Audio activation is not a guarantee of audibility on another device.

A subsequent collector self-audit rejected a new explicit `will not return` OUT classification because the independent replay validator did not yet include that phrase. This failure prevented publication. The replay guard and regression test were updated together; actual social delivery still requires a recent post, one recognized NBA player, identity evidence and enabled filters.

---

# Third pass — same day, 2026-09-17 (deployed-page observation, lineup-impact layer, registry corrections)

## What changed in the evidence picture

The previous section's audit was produced by a runner in a network where ESPN `teams`/`scoreboard` returned 403.
This pass re-observed the same endpoints **from the deployed browser origin**, and the result is different, so both
observations are kept instead of overwritten: browser-direct fetch of the injuries API rendered 74 listings labelled
`via espn-direct · just now`, and the social panel reported `polled 13 of 13 allow-listed accounts browser-direct`.
Consequence: the long-standing "CORS could not be verified" item is resolved for the deployed origin; a runner IP is
not a browser and is not treated as evidence about browser behaviour in either direction.

## Line-by-line source checks added in this pass

| Claim being checked | Independent observation | Consequence in this repo |
|---|---|---|
| X API pricing docs URL | `docs.x.ai` is **xAI's** product, not X's developer docs. `docs.x.com/x-api/getting-started/pricing` returns 403 to automated fetchers. | Registry row corrected; pricing statements stay explicitly unconfirmed. No free-tier claim rewritten into a number. |
| balldontlie injury webhooks | Tier page read directly: FREE = Teams/Players/Games; Player Injuries + Game Player Stats = ALL-STAR/GOAT; Season Averages = GOAT; ALL-ACCESS $299.99/mo. **No webhooks section exists on the page.** | "webhooks solve latency properly" removed; row now says the claim is unconfirmed. Paid-only injuries is why rotation role is derived from our own box-score collection. |
| ESPN rotation data availability | `teams/mia/depthchart` → `{}`; `sports.core …/depthcharts/<slug>` → 404; `apis/fitt/v3` → 404; the human depth-chart page (RotoWire-powered) is HTML only. | Registered as `espn-depth-chart-page` with the rejected routes recorded, and linked from each affected board row for **manual** cross-check. No HTML scraping: an unparsed table is exactly how invented roles get into a product. |
| Per-player injury history | ESPN roster API carries `injuries:[{status,date}]` (current listing only) and `contracts:[{salary,season}]`. No free source reviewed publishes a career injury log. | Cadence/recurrence is computed from **dates we observe ourselves** (`collect_context.js` schema 2), capped and labelled; the UI says so. |
| Howard Beck's Bluesky writers list | `getList` returned 150 members; the list description contains a doubled word upstream. | Description now quoted verbatim (earlier text had a transcription error of ours). Membership is still identity evidence only, never an outlet. |
| Official in-game injury report delivery | `ak-static.cms.nba.com/referee/injury/` → 500 (no index); 2026-27 landing → 404; 2025-26 rules page → 200; the April 12 2026 gameday PDF → 200. | "Official confirmation is impossible today" restated as a *documented blocker* with three re-checkable URLs rather than a vague caveat. `tools/verify_live.py` now expects those statuses and will flag DRIFT if one changes. |
| Team-account coverage for verification | `getFollows(nba.com)` → 6 follows (POR, DEN, PHI, WNBA verified; DAL not). | New flag: at most 4/30 teams have an official Bluesky account the league follows — the ceiling on single-source social verification. |
| Reporter employment | Buckner → The Athletic (Sports Media Watch Feb 2026 + author page). Ganguli → still NYT (Muck Rack), so a prior "possible move" note was **removed as unsupported**. Slater → ESPN (FOS 2025-06-13) — flag cleared. Fischer → 2026 bylines say "The Stein Line"/"The People's Insider" while the row said Yahoo Sports. | First three corrected with dated evidence. Fischer is left `DISPUTED` with the conflict written into the row: no guess. |
| Opening-night schedule | Basketball Monster slate says BOS@DET 2:00pm; the NBA's own Bluesky bio says 3:00pm/et for the same game. | Flagged as an unresolved upstream conflict, both sources linked. Not silently reconciled. |
| Reporter directory completeness | ESPN's injury comments name bylines that were absent from the directory (Rowland, Schuhmann, Collier, Murray, Emerman, Boone, Sheikh, Baraheni, Binkley, Linn, Holmes, Beede, Siegel, Rankin, Hill, Almanza, Blackburn, Anderson, Gambadoro, Toporek). | 20 rows added as `citation-verified`, each storing the **verbatim** citation plus the player/team it concerned. `smoke_test.js` fails if any stored quote no longer appears in `data/live/latest.json`, so a row cannot outlive its evidence. No handle is asserted for any of them. |

## Defect found and fixed while wiring the new layer

`AlertEngine.fire()` applied the **social** freshness rule (30 minutes on the post timestamp) to *every* alert. Board and official
items legitimately carry older source stamps — ESPN dates a listing when it is filed, and the NBA PDF is issued 11am–1pm local
for a night game — so a genuinely new OUT row could be dropped **with no message at all**. Fixed by separating the policies:
social alerts are judged on post time (30 min, unchanged: an old post must not re-alert), while board/official alerts carry
`observedAt` (the moment the change reached us) with 24h/12h windows and the source timestamp printed in the log line.
`tools/regression_test.js` now pins all four behaviours (fresh observation passes, stale source stamp would have failed, social
staleness still suppresses, filtered items are logged rather than dropped).

## Lineup-impact policy (new module, `assets/js/role.js`)

- Three axes, deliberately unmixed: **availability** (source status), **lineup impact** (production vacated, from collected box
  scores: starter share of games, minutes per game, current-game starts), **injury-listing cadence** (dated history of the
  player's appearances on ESPN's listings) — plus contract context as a factual, separate line.
- Matrix: starter × (out|doubtful) = HIGH · starter × questionable = MEDIUM · rotation × (out|doubtful) = MEDIUM ·
  anything × bench = LOW · no evidence = UNKNOWN. A reported in-game exit appends "in-game exit reported (unconfirmed)".
- Medical severity is **never** computed, asserted or implied; the legend and every tooltip say so, and a test asserts no
  `medicalSeverity` field or severity grade appears in an assessment.
- Failure modes are visible, not silent: stale roster capture, empty roster, per-team collector errors and missing games all
  produce labelled notes; `roleStats` is keyed on `playerId` + game id so a re-seen game cannot double count.
- Alert content is unchanged in eligibility terms — impact adds wording (`⚡ HIGH LINEUP IMPACT`) and never lets an item that
  would be silent become audible. That is tested, because an impact heuristic must not become a false-positive generator.
- Current state of the data: `roleStats` is empty for all 30 teams, because the 2026-27 season has not tipped off
  (first games 2026-10-03). Every row therefore reads IMPACT UNKNOWN today. That is the intended output, not a stub.

## Test surface after this pass

`smoke_test.js` 140 checks · `integration_test.js` 48 · `poll_fixture_test.js` 24 · `regression_test.js` 21 groups ·
`python3 -m unittest discover -s tools` 4 · `replay_posts.js --check` on the live snapshot: 74 rows / 13 posts, no violations.
New coverage in this pass: the impact matrix and its refusal to guess; collector roster/roleStats unit checks; the alert-freshness
policy split; the citation-quotable registry invariants; script-load order for `role.js`; the CI snapshot's impact fields and the
absence of internal cache keys; browser assertions for the tag, tooltip, legend, cadence block, depth-chart link and unknown path.

## Honest limitations of this pass

1. Verification came from fetched page text plus the deployed browser; **no live game data exists yet**, so the impact layer is
   structurally sound but empirically untested until preseason games produce box scores.
2. `data/live/*.json` written by CI is newer than this branch's last commit. A `git fetch` + merge of CI-pushed `data/live/*`
   is required before the next data-dependent assertion — otherwise a stale local snapshot gets treated as current evidence.
3. Bluesky is the only automatically pollable social layer. X/Instagram/Facebook remain manual-review embeds and links, and the
   20 new citation rows carry no handles because profiles cannot be read from the build environment.
4. `tools/verify_live.py` now fails on unexpected statuses, but runner→source reachability differs from browser→source
   reachability (that is exactly the ESPN 403-vs-200 case above); `UNREACHABLE-FROM-RUNNER` is therefore not reported as a source failure.

## Addendum after the first CI audit run of the rewritten checker (05:08Z)

The committed verdicts (`data/audit/latest.json`) corrected **this tool's own** explanations, and the
correction matters more than the pass:

| Observation, same runner, minutes apart | What it disproves |
|---|---|
| Python audit client → `site.api.espn.com` `/teams`, `/scoreboard`, `/teams/mia/roster`: **403** | "ESPN is blocked from CI." |
| `tools/collect_context.js` (Node fetch) → the same URLs: **30 rosters, 559 players** written into `data/live/context.json` | "the endpoint is unavailable to servers." |
| Deployed browser page → `site.web.api.espn.com/…/injuries`: **200, 74 rows** | "the endpoint is unavailable to browsers." |
| `www.espn.com` human pages → **202, empty body** to the audit client | "the page was removed." |
| The audit client → `official.nba.com` 2025-26 page: 200; 2026-27 page: **404**; PDF index: **503**; sample PDF: **200, 103 KB, parsed** | the registry's official-layer claims, all confirmed from a third network |

Conclusion written into the registry as a flag: ESPN is **fingerprinting clients, not blocking
runners or IPs**, so every "unreachable" claim in this project must name the client that observed it.
The audit therefore classifies 403/406/202/5xx as `ENV-BLOCKED` with an explanation, never as drift,
and it does **not** spoof browser headers to get a nicer number.

Three defects in the checker itself surfaced the same way and are fixed: probing gzipped bytes as text
(which produced bogus "expected wording missing" on three pages), calling `app.bsky.graph.getList` with
`actor=` instead of `user=` (an HTTP 400 that would have been misread as the writers list vanishing),
and literal-string probes against CMS-rendered markup. A fourth finding is not a bug but a constraint:
Basketball Monster's `INJURED / NOTE / TRADED` tags are **absent from the raw HTML** (client-rendered),
which independently confirms the link-out-instead-of-scrape policy — parsing that page without running
its JavaScript would yield empty rows, and guessing from empty rows is how fabricated data is born.
