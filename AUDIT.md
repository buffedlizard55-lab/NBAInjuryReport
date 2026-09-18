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
| `assets/js/alerts.js:fire` | `item.impact.tier === "high"` compared undefined (`assess` returns `impact.impact`) | Changed to `(item.impact.impact === "high" || item.impact.tier === "high")` so `⚡ HIGH LINEUP IMPACT` alert prefix fires on high-impact starters. Regression test added. |
| `assets/js/ingame.js:extract` | Live game summary `injuries` section was hardcoded `alertEligible: false` | Enabled `alertEligible: true` for in-game Out, Questionable, Doubtful and exit listings in live games, alerting users when a player gets hurt during ongoing play. DNP stays ineligible. |
| `assets/js/injuries.js:render` / `index.html` | Board lacked instant search and quick status filter tabs similar to Basketball Monster | Added instant search (`#boardSearch`), reset button (`#boardResetFilter`), and status tabs (`#boardStatusFilters`) with live count badges for All, OUT, Doubtful, Questionable/GTD, Probable, Return. |
| `assets/js/social.js:checkAlerts` | Social alerts did not attach lineup impact | Attached `LineupImpact.assess` result to social alert objects when player is resolved, surfacing starter impact on breaking posts. |
| `assets/js/app.js:ingestNews` | ESPN news wire items did not resolve player or attach lineup impact | Added player resolution and `impact` attachment on classified news items. |
| `assets/js/reporters.js` / `reporters.html` | Subpage lacked unified categorization and complete 30-team in-arena exit tracking matrix | Added Category Tabs (`All`, `Official League & Team`, `Lead Insiders`, `In-Arena Beat Writers`, `Cited Wire Bylines`, `Others & Review`), in-arena exit detection badges, and dedicated 30-Team In-Arena Coverage Matrix card. |
| `assets/js/alerts.js` / `assets/js/app.js` | Test sound button lacked immediate visual feedback on click | Added visual feedback state (`🔔 Playing chime…` / `⚠ Audio unavailable`) while WebAudio two-note chime plays. |
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
and literal-string probes against CMS-rendered markup. A fourth item is a **retraction of a claim made earlier in this same pass**: it was written that
Basketball Monster's `INJURED / NOTE / TRADED` tags are absent from the raw HTML and therefore
client-rendered. That was read off an audit run that was still decompressing nothing — the probe could
not have matched, so the absence proved nothing about the page. The claim is withdrawn, the probe
restored (with decompression in place) for the next run to settle, and the reason for recording the
withdrawal is the general lesson: a bug in a verification tool produces confident, specific, wrong
findings faster than anything else in the system. Linking out instead of scraping stays the policy on
its own merits either way.

---

# Fourth pass — 2026-09-17, session 4 (~14:15–14:50Z): full re-read, live re-verification, identity-gate fix

## Scope

Re-read every shipped file line by line: `index.html`, `reporters.html`, `sources.html`, all nine `assets/js` modules, `assets/css/style.css`, all of `tools/` (poller, collectors, ledger, validators, audit), all four `.github/workflows`, and the data contracts (`data/live/*.json`, `data/audit/latest.json`, `data/verified_sources.json`). Ran the full local test surface before touching anything: 147 smoke + 48 integration + 24 poll-fixture + 21 regression groups + 4 Python tests + `replay_posts --check` on the live snapshot — all green.

## Live re-verification (this session, direct fetch channel, 2026-09-17 ~14:25Z)

| Source | Observation | Consequence |
|---|---|---|
| [NBA 2026–27 report](https://official.nba.com/nba-injury-report-2026-27-season/) | **404** ("404 Error \| Not Found", XID 62906610) | Official adapter remains blocked by a missing page, not broken. The 2026-09-17 finding stands. |
| [NBA 2025–26 report](https://official.nba.com/nba-injury-report-2025-26-season/) | **200**; deadline rules text re-read: 5 p.m. day-before, 11 a.m.–1 p.m. gameday (8–10 a.m. if tip ≤5 p.m.), 1 p.m. back-to-back, "updated on a continual basis" — verbatim match with the registry | Registry row now cites both re-reads. |
| [ESPN injuries API](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries) | **200**; `season {year:2027, name:"Preseason", displayName:"2026-27"}`; per-block schema unchanged; sampled Mouhamed Gueye (ATL) `Day-To-Day` dated 2026-07-19 with the Brad Rowland byline intact | The primary board is stable across all four same-day reads. |
| [NBA Bluesky profile](https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com) | **200**; `verification.verifiedStatus: "valid"` (issuer bsky.app, `isValid: true`); bio still states the Oct 20 openers (Celtics/Pistons 3:00pm/et, 76ers/Knicks 7:00pm/et, Thunder/Spurs 9:30pm/et); `followersCount: 122,490`, `followsCount: 6` | The 4-of-30 official-team-account ceiling on the social layer still holds. |

The remaining 18 registry checks (official PDF index, PDF sample, ESPN teams/scoreboard/roster/depth/injuries-page, Bluesky follows/list/search, X pricing docs, Basketball Monster, Covers, RotoBaller, balldontlie, and the two dated reporter-move evidence pages) are re-run by the independent GitHub Actions audit (`Public source audit`) — this session's `data.js` changes trigger it, and the verdicts land in `data/audit/latest.json` for the reader to check.

**Tool irregularity, recorded not hidden:** the page-fetch proxy intermittently failed with its own `InvalidAccessKeyId` error (an error in the fetch channel, not in any source). Four retries on the Basketball Monster URL all hit it; those checks are therefore settled by the runner audit above, not by this pass.

## Defects found and fixed in this pass

| Area | Finding | Resolution / test |
|---|---|---|
| `assets/js/social.js:feedAccounts/checkAlerts` | **Alert eligibility was keyed on the Bluesky verification object alone.** Four of the eight allow-listed reporters — Jeff McDonald and Tom Orsborn (Spurs beat writers), Tom Haberstroh, John Hollinger — carry *recorded* identity evidence (Howard Beck's 150-member list membership + self-declared beat, the same standard the reporter directory applies to every row) but no verification object, so their posts could **never sound an alert** even when they named exactly one recognized NBA player with explicit OUT language. Meanwhile the eligibility rule's stated purpose ("sound requires identity evidence") was not actually the rule in the code. | `feedAccounts()` now carries two fields: `bskyVerified` (the verification object → the ✓ badge) and `verified` (alert eligibility): **reporters qualify on recorded evidence; official league/team accounts still require the verification object**, so the flagged `dallasmavs` account (followed by the NBA but object-less, row says "treat as club-run only after a second source confirms") stays silent. The feed shows a distinct `◐ evidence` badge; the evidence ledger stores both fields (`identityVerifiedAtCollection` + `bskyVerified`). Pinned by two new regression groups (`regression_test.js`): eligible reporter, verified league account, silent team account, and same-post eligible/silent via `checkAlerts`. The CI poller runs the same function, so browser and archive agree. |
| `assets/css/style.css` | `.tag.ok`, `.tag.warn`, `.tag.gtd` were used by `social.js` (✓ badge, relay tag) and `injuries.js` (GTD tag) but **never defined** — those badges rendered with the base dark tag style, so a Bluesky-verified post and an unverified one looked the same. | Styles added for all three classes. |
| `tools/build_verified_sources.js` | `scheduled_collection.status` still read "NOT yet executed by GitHub" and the schedule note said "re-verified live this session" as if session 2 had not ended — the poller has run on GitHub since 2026-09-17 (first successful end-to-end run documented in FLAGS). Stale text in a verification artifact is exactly what the audit exists to catch. | Text corrected to state the running state (every 10 min on main + arena/**, rebase-retry commit step, best-effort cron caveat); `data/verified_sources.json` regenerated (30 teams / 23 sources / 56 reporters / 36 flags). |

## Line-by-line observations (no change required)

- **Alert engine** (`alerts.js`): the two freshness policies remain correctly separated (social judged on post time 30 min; board/official judged on `observedAt` with 24h/12h windows); chime burst coalescing (1.5 s) and the mute-independent test sound are intact.
- **Injury board** (`injuries.js`): failed/stale snapshots keep last-good rows and the baseline (tested); the `standardAbbr` six-club mapping is pinned by the smoke test; per-row impact tags, cadence block and review links all present.
- **In-game monitor** (`ingame.js`): DNP rows are display-only and never sound (`alertEligible: false`, tested); `COACH'S DECISION` and similar non-injury reasons excluded; failed game IDs surface as a warning, not as "no findings".
- **Ledger** (`tools/build_intelligence.js`): forward-only, no absence-based verdicts; reconciliation is game-scoped within 4 h and labels a later official row "later official designation, not proof of predictive accuracy"; conflict → review, never an automatic wrong-report penalty.
- **Collector/audit tooling** (`tools/poll_watch.js`, `tools/collect_context.js`, `tools/collect_official.py`, `tools/verify_live.py`, all workflows): single-flight, rebase-retry push, self-audit on real data before commit, fail-closed PDF layout parser, and the `CAPABILITY-DRIFT`/`ENV-BLOCKED`/`UNREACHABLE-FROM-RUNNER` verdict vocabulary all intact. The runner-side re-audit triggered by this session's push is the independent check for the 18 URLs this pass could not re-read.
- **UI** (`index.html`): alert center now states explicitly that in-game exit / "questionable to return" language from a monitored account raises an *unconfirmed* alert with the post link, and that DNP reasons never sound; the social panel now explains the ✓ vs ◐-evidence badges.

## Test surface after this pass

`smoke_test.js` 147 · `integration_test.js` 48 · `poll_fixture_test.js` 24 · `regression_test.js` **23 groups** (+2 new identity-gate groups) · `python3 -m unittest discover -s tools` 4 · `replay_posts.js --check` on the live snapshot: 74 rows / 12 posts, no invariant violations. The GitHub `Tests` job additionally runs the Chromium UI suite on merge.

## Remaining irregularities (unchanged from the third pass unless noted)

1. **Critical (time-gated):** no live official report exists to discover — the 2026-27 page is still 404 (re-verified this pass); the adapter is ready and fails closed.
2. **Critical (structural):** free low-latency coverage for every reporter/team/game is not achieved; browser polling is open-tab, Actions cron is best-effort.
3. **Critical (access):** X/Instagram/Facebook reads and live-broadcast transcription remain unconnected; no bypasses.
4. **High:** in-game behavior (exit, QTR, return-to-game) is still empirically unexercised — first games tip 2026-10-03; the impact layer's `roleStats` will start filling only then.
5. **High:** identity verification is now evidence-based for reporters (fixed this pass) but the *legacy X rows* still rest on first-pass evidence; revalidation of every X row remains open.
6. **Medium–Low:** as itemized in [NEXT_STEPS.md](NEXT_STEPS.md) — Git-as-storage, cross-tab dedupe, QTR outcome scoring, depth-chart corroboration.

---

# Fifth pass — 2026-09-17, session 6 (~19:00Z): the verifier verified, four registry rows re-validated

## Scope

Re-read line by line: all four workflows, `assets/js/data.js`, `alerts.js`, `role.js`, `injuries.js`, `social.js`, `ingame.js`, `app.js`, `intelligence.js`, `wire.js`, `index.html`, `reporters.html`, `tools/poll_watch.js`, `tools/collect_context.js`, `tools/build_intelligence.js`, `tools/collect_official.py`, `tools/build_verified_sources.js`, `tools/replay_posts.js`, `tools/verify_live.py` (header/check table), `tools/smoke_test.js`, and the live data contracts (`data/live/latest.json`, `context.json`, `intelligence.json`, `official.json`, `verified_sources.json`). Full local test surface run before any change (147 smoke · 48 integration · 24 poll-fixture · 26 regression groups · 4 Python · live replay: 74 rows / 12 posts, clean).

## Live re-verification this session (page-fetch channel, ~19:00Z)

| Source | Observation | Consequence |
|---|---|---|
| [NBA 2026–27 report](https://official.nba.com/nba-injury-report-2026-27-season/) | **404** (XID 70197203) | Official adapter still blocked by a missing page, not broken. Time-gated until the season page exists. |
| [NBA 2025–26 report](https://official.nba.com/nba-injury-report-2025-26-season/) | **200**, deadline rules text re-read verbatim (5 p.m. day-before; 11 a.m.–1 p.m. gameday; 8–10 a.m. if tip ≤5 p.m.; 1 p.m. back-to-back; "updated on a continual basis") | Registry row stands. |
| [ESPN injuries API](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries) | **200** (payload timestamp 2026-09-17T19:00:08Z); season 2026-27 Preseason; ATL block row 1 still Mouhamed Gueye `Day-To-Day` 2026-07-19 with the Brad Rowland byline | Primary board stable across five same-day reads. |
| [NBA Bluesky profile](https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com) | **200**; `verification.verifiedStatus: "valid"` (issuer bsky.app); bio still lists the Oct 20 openers; `followersCount 122,544`, `followsCount 6` | The ~4-of-30 official team-account ceiling still holds. |
| [Bluesky searchPosts](https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1) | **403** | Keyword search remains unauthenticated — allow-list design stands; no capability drift. |
| [Basketball Monster](https://basketballmonster.com/playernews.aspx) | **200**; `INJURED` / `NOTE` / `TRADED` status tags ARE present in the server-returned HTML | Settles the probe question left open after the third-pass retraction (the earlier "client-rendered" claim had been made from a broken gzip probe and was withdrawn). Link-out policy stands regardless. BM slate still lists `BOS at DET 2:00pm` vs the NBA bio's `3:00pm/et` — the recorded upstream tip-time conflict is **unchanged**. |
| [The Stein Line (Substack)](https://marcstein.substack.com/p/the-latest-from-the-nbas-soon-to) | **200** (post dated 2026-04-08); guest-post byline fetched live and quoted verbatim: "Founded by @JakeLFischer, former Yahoo! Sports Senior NBA reporter. Bleacher Report NBA Insider. Contributor to The Stein Line." | **Jake Fischer outlet question RESOLVED by the outlet's own words.** |

Dated search evidence (cross-checked in two independent articles each): Chris Haynes → Amazon Prime NBA insider (Front Office Sports, **2025-09-29**: network confirmed exclusively); Candace Buckner → The Athletic national columnist (Sports Media Watch **2026-02-26** quoting the NYT announcement, plus TheWrap same day; the SMW slug says "new-york-times-…" because NYT owns The Athletic — no contradiction); Will Guillory → The Athletic "Staff Writer, Rockets and Pelicans", Pelicans beat since 2016 (his nytimes.com/athletic author page); Jake Fischer's Yahoo exit (NiemanLab 2025-03-19).

## Defects found and fixed

| Area | Finding | Resolution / test |
|---|---|---|
| `tools/smoke_test.js:check()` | **The harness accepted a function object as truthy and never executed it.** Six `check(name, () => { … })` grouping closures in the lineup-impact section were declared but dead — 12 inner assertions had literally never run, while the suite reported 147 passes including "✓ an evidence file from an older collector says so…". A verifier that cannot fail is worse than none. | `check()` now executes closures: thrown exceptions and inner failures are counted honestly (group pass only when every inner assertion passes). Revived immediately: see the next row. |
| `assets/js/role.js` + both context builders | Fixing the harness exposed a real product gap: the dead assertion expected assessments to **disclose a schema-unmarked context file**, and `role.js` never emitted such a note (nor did `intelligence.js` / `tools/poll_watch.js` even pass a `schema` field through). A pre-schema-2 file's gaps would read as facts about the player. | `assess()` now discloses a schema-unmarked context ("capture gap, not a fact about the player") when a roster capture exists; `schema` is threaded through `Intelligence.rebuildContext` and the poller's `impactContextFor`. Real schema-2 files do not trigger the note; the revived assertion proves it. |
| `assets/js/data.js` / `reporters.html` | Session-4 follow-ups left one opened question (`Jake Fischer` DISPUTED outlet) and three rows needing dated re-validation (Haynes, Buckner, Guillory). | All four resolved against dated, quoted evidence (above). A smoke assertion now fails if any row re-introduces a silent DISPUTED outlet; reporters.html pills/bullets updated from "1 outlet DISPUTED" to the resolved state; `method` in `tools/build_verified_sources.js` says six passes; registry JSON regenerated (30 teams / 23 sources / 56 reporters / 36 flags). |

## Improvements shipped (from NEXT_STEPS §5 refinements)

1. **Median minutes next to the mean.** The collector now keeps bounded per-game values (`minutesValues`, capped at 60) inside `roleStats`; `role.js` quotes the median and **discloses** a wide mean–median gap ("median 40 vs mean 28.3 — a blowout-heavy or injury-shortened sample") instead of letting a six-game average pretend to be a role. Ready for the 2026-10-03 tip.
2. **Trade/team-change flag.** `roleStats` keeps the team the sample was collected under; when the listing's team differs, the assessment sets `role.teamChanged`, names both teams, and refuses to silently reassign minutes. Shown on the board as "⚠ sample collected with previous team".
3. **No-contract-entry is named, not skipped.** A rostered player whose `contracts[]` array is empty previously rendered no contract line at all; now the assessment returns `contract.missing` and the label "ESPN's roster feed filed no contract entry … a two-way, an expired deal or an unpublished one; the source does not say which". The board prints contract labels in every state (previously only when a salary existed).
4. **Guillory role refined**: Rockets + Pelicans staff writer — a HOU mention in his feed is normal, not a mis-attribution.

## Test surface after this pass

`smoke_test.js` **165** (was 147: 6 dead closures revived + new assertions for the disclosure, median, team-change and contract-missing paths) · `integration_test.js` 48 · `poll_fixture_test.js` 24 · `regression_test.js` 26 groups · Python 4 · `replay_posts.js --check` on the live snapshot: 74 rows / 12 posts, clean. Chromium UI suite runs in CI (its browser download is blocked in this sandbox; no spoofing attempted).

## New irregularities flagged for manual review

1. **Basketball Monster's countdown moved "34 days" → "33 days" between same-day reads** (~14:00Z vs ~19:00Z). A source-side display quirk (timezone rounding); harmless because our site never copies that counter — recorded so the next reader does not treat it as data drift.
2. `data/verified_sources.json`'s `counts.reportersByStatus` shifted only via label text this pass; no row was added or removed. The four revalidated rows (Fischer, Haynes, Buckner, Guillory) keep their statuses: evidence was strengthened, identity classes untouched.
3. The legacy X rows outside these four still rest on first-pass evidence; per-row revalidation continues in the next session (X profiles cannot be fetched from the build environment — revalidation uses dated third-party reports and outlet pages only, quoted).

# Seventh pass — 2026-09-17, session 7 (~21:00Z): the audit tool audited, and the coverage gap named

## Scope

Re-read line by line: `tools/verify_live.py` (every check spec, `json_peek`, the verdict ladder), `tools/poll_watch.js`,
`tools/collect_context.js`, `tools/build_intelligence.js`, all ten `assets/js` modules, `index.html`, `sources.html`,
the four workflows, and the committed data contracts (`data/live/latest.json`, `context.json`, `intelligence.json`,
`official.json`, `data/audit/latest.json`). Ran the whole local surface before changing anything: 165 smoke · 48
integration · 24 poll fixtures · 26 regression groups · 4 Python · live replay — all green.

The session's premise: a verification script that is quietly wrong is worse than none, and the runner audit is the only
independent re-reader of the 18 URLs this sandbox cannot reach. So it was read as a source of claims, not as a formality.
Four of its checks were wrong. Each produced a confident, specific, wrong number in `data/audit/latest.json` while the job
stayed green and the sources page printed **OK**.

## Live re-verification this session (page-fetch channel, ~20:55–21:05Z)

| Source | Observation (verbatim where quoted) | Consequence |
|---|---|---|
| [NBA 2026–27 report](https://official.nba.com/nba-injury-report-2026-27-season/) | **404** — page body `Error 404 / Not Found / NBA \| XID: 74717976` | Official adapter still blocked by a missing page. Time-gated, unchanged. |
| [Bluesky `getList`, AT-URI form](https://public.api.bsky.app/xrpc/app.bsky.graph.getList?list=at%3A%2F%2Fdid%3Aplc%3Arkpzrwxex34r36ypejhew7ml%2Fapp.bsky.graph.list%2F3llmezwbnrp2d&limit=3) | **200** — `list.name` "NBA Writers/Broadcasters/Podcasters/Bloggers", `listItemCount` **150**, `purpose` `app.bsky.graph.defs#referencelist`, list `indexedAt` 2025-03-30T17:36:52.604Z, creator `howardbeck.bsky.social` (`did:plc:rkpzrwxex34r36ypejhew7ml`) `verifiedStatus: "valid"` (issuer bsky.app), description verbatim "A list of of everyone I'm following who writes, reports, blogs, pods, analyzes or otherwise yammers about the NBA for a living." Sampled items: `kingjosiah54.bsky.social`, `samvecenie.bsky.social` (verified by theathletic.com), `keithfujimoto.bsky.social` | **Settles the question the audit had been failing to ask.** The 150-member count in the registry is real and re-readable; the earlier HTTP 400 was our bad parameter, not the list disappearing. |
| [Bluesky `getFollows(nba.com)`](https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=nba.com&limit=50) | **200** — exactly 6 follows: `trailblazers.bsky.social` (valid), `dallasmavs.bsky.social` (**no verification object**, bio "Mavs.com"), `nuggets.bsky.social` (valid), `sixersnba.bsky.social` (valid), `wnba.com` (valid), `bsky.app` (`trustedVerifierStatus: "valid"`, `verifiedStatus: "none"`). Subject `nba.com` itself `verifiedStatus: "valid"`, bio still carries the Oct 20 slate | The 4-of-30 ceiling holds: 4 followed club accounts carry valid objects, 3 of them NBA clubs. A trusted verifier is not a verified account — the counting code now distinguishes them. |
| [ESPN injuries, `?team=mia`](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries?team=mia) | **200** — payload `timestamp 2026-09-17T17:01:02Z`, `season {year:2027, name:"Preseason", displayName:"2026-27"}`, row 1 Giannis Antetokounmpo `Day-To-Day` dated 2026-09-02T16:32Z, shortComment about skipping Greece's FIBA window | Primary board stable; same schema the normaliser expects. |
| [ESPN roster, `/teams/mia/roster`](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia/roster) | **200** — `timestamp 2026-09-17T21:00:13Z`, athletes carried in a **top-level `athletes[]`** array (no `team.roster.entries` key anywhere in the payload). Bam Adebayo: `position.abbreviation "C"`, `experience.years 9`, `status.abbreviation "Active"`, `injuries [{status:"Day-To-Day", date:"2026-07-28T16:16Z"}]`, `contracts [{salary 49500000 → season 2027}, {37096620 → 2026}, …]` | Proves the audit's roster path was reading a key that does not exist. Also independently confirms what `tools/collect_context.js` collects (30 rosters / 559 entries in the committed snapshot). |
| Committed snapshot `data/live/latest.json` | `generated 2026-09-17T20:44:43.144Z`, **75 rows in 27 team blocks**, 7 news items, 12 posts, 13/13 allow-listed accounts reachable, `errors {}` | The three absent blocks are **CLE, DET and LAL** — now named on the board instead of implied away. |
| Committed `data/live/context.json` | schema 2, 30 rosters, 559 roster entries, 54 players with dated injury listings, **0 collector errors**, `roles` 0, `roleStats` 0 | Offseason reality unchanged: lineup impact stays UNKNOWN until the 2026-10-03 tip. |
| Committed `data/audit/latest.json` (run 19:25:36Z, produced by the *old* tool) | `bluesky-list` **400** → verdict `OK-PAGE-CHANGED`; `espn-scoreboard` **403** → `OK`; `espn-roster-mia` **403** → `OK`; `espn-teams-mia` **403** → `OK`; `bluesky-follows` `verifiedFollows` **0** | The evidence for all four defects below, from the artefact itself. |

## Defects found and fixed

| Area | Finding | Resolution / test |
|---|---|---|
| `tools/verify_live.py` — `bluesky-list` check | Requested `?user=howardbeck.bsky.social&list=did:plc:3llmezwbnrp2dfckxyx3lnca`. `user=` is not a parameter of `app.bsky.graph.getList` and a bare DID is not an AT-URI, so the endpoint answered **HTTP 400 on every run**; the verdict printed `OK-PAGE-CHANGED / members returned missing`, which read like "the writers list may have moved". The registry's 150 members therefore rested on a read the audit never repeated. An earlier "fix" (changing `actor=` → `user=`) was itself wrong. | The check now requests `list=<AT-URI>` with the URI read out of `assets/js/data.js` at run time (`registry_list_uri()`), so the audited URL and the published URL cannot drift. Live-verified 200 with 150 members the same day. `json_peek` also read `list.displayName`; the record's field is `list.name`, so `listName` was null even on success — now `name` with `displayName` fallback, plus `listItemCount` and the creator handle. Pinned by `test_the_list_check_uses_the_at_uri_form_and_never_user` and `test_the_list_url_comes_from_the_registry_so_the_two_cannot_drift`. |
| `tools/verify_live.py` — `verifiedFollows` | Counted `(verification or {}).get('verified')`. Bluesky returns no such field (the real ones are `verification.verifiedStatus` and `verifications[].isValid`), so the count was **0 on every run** while the registry's "4 of the 6 follows carry valid verification objects" claim went unchecked. | New `verified_object()` helper reads `verifiedStatus == 'valid'` or any `verifications[].isValid`, and the row now also lists `unverifiedHandles`. Pinned by three tests, including one that reproduces the measured 4-of-6 from the live payload and one asserting `bsky.app` (a *trusted verifier*) is not counted as verified. |
| `tools/verify_live.py` — roster `json_peek` | Read `data['team']['roster']['entries']`. ESPN's roster payload carries `athletes[]` at the top level (re-read live this session), so even a 200 would have reported `athletes: 0` — the check could never have corroborated the lineup-impact layer's only machine-readable input. | Reads top-level `athletes[]`, keeps the old path as an explicitly labelled fallback (`athletesPath` says which one was used), so a future shape change is reported rather than silently zero. Pinned by three tests on the live payload shape. |
| `tools/verify_live.py` — verdict ladder | Printed **OK** whenever `200` was merely *tolerated* by `expect`. On the last committed run `espn-scoreboard`, `espn-roster-mia` and `espn-teams-mia` were all **403** — they had read nothing — and all printed OK; `bluesky-search` printed OK for the 403 that *is* its documented state, with no way to tell the two cases apart. A reader of `sources.html` could not distinguish "verified" from "could not be checked". | Each check now declares `verifiesOn` (the statuses that can verify its claim, default `[200]`) and `blockerVerdict` where the claim *is* the refusal. The ladder moved into a pure, unit-tested `classify_verdict()`; every row carries an explicit `verified` boolean; `OK` is reserved for verified claims; the summary publishes `verifiedByThisRun` / `notVerifiedByThisRun`. The CAPABILITY-DRIFT tripwires are unchanged and still fire (official page going live, PDF index exposing links, keyword search opening up). Pinned by 10 verdict-mapping tests. |
| `assets/js/injuries.js` + `index.html` | The board is titled "every team" but a snapshot that omits a team block said nothing about it. The committed 2026-09-17 snapshot has **27 of 30 blocks**; CLE, DET and LAL were simply absent from the render. | New `InjuryBoard.coverageGaps(list)` + `#boardCoverage`: names every absent team with a link to that team's own ESPN injuries page, prints `27/30`, and states that "ESPN omitting a team block is NOT evidence that nobody on it is injured". A full-coverage snapshot says so *and* still denies clearance; an empty snapshot makes no per-team claim at all. Rendered before the "no rows match the filter" early-return, so the gap survives filtering. 8 smoke + 3 integration assertions, driven by the real committed snapshot. |
| `assets/css/style.css` (three panels) | **The severity colour-coding never rendered.** `wire.js`, `social.js` and `injuries.js` all emit `sev-border-<sev>`, but the stylesheet only defined `.wire-item.sev-<sev>` and `.post.watch`, and `.board-row` had no left border at all. So every wire item showed the default blue edge and every board row showed none — an OUT item looked identical to a "cleared/returning" one at the edge. Additionally `class="good"` / `class="bad"` had no bare rule (only `.btn.good`, `.badge.bad`, `.pill.bad`, `.dot.bad`, `.callout.bad`), so the board's "✖ refresh failed — last-good data, alerts paused" line and the social layer's reachable yes/no column printed in ordinary body colour; `.empty` had no rule either. Same class of defect as the missing `.tag.ok/.warn/.gtd` rules found in session 4 — a class name in markup with no rule is invisible, which is not the same as intentional. | Added bare `.sev-border-*` rules (all six severities) appended after the base rules so they win the specificity tie, a `border-left` declaration for `.board-row`, bare `.good` / `.bad` / `.empty`, plus `.tag.team` and `.tag.ingame-watch`. Seven smoke assertions pin them, and each was **checked against the pre-fix stylesheet to prove it is not vacuous** (0 of 6 severity edges styled before, no bare `.good`/`.bad`/`.empty`). |
| `sources.html` | The audit panel showed verdict counts only, so four unrun checks looked identical to four verified ones. | Per-row `claim verified` / `claim NOT verified by this run` badge, a `N/M claims verified by this run` counter, the roster read-path, the list member count, and `verifiedFollows` relabelled "with a valid verification object". The verdict glossary explains the change. |

## Independent confirmation from the runner (21:22Z, after this change was pushed)

The `Public source audit` job re-ran on the branch with the fixed tool and committed
`data/audit/latest.json` (`checkedAt 2026-09-17T21:22:35Z`, 22 checks, `capabilityDrift 0`,
`toolErrors 0`). Every one of the four defects is confirmed fixed by a machine that is not this
sandbox:

| Check | Before (19:25Z run, old tool) | After (21:22Z run, fixed tool) |
|---|---|---|
| `bluesky-list` | **400** → `OK-PAGE-CHANGED`, `listItems 0`, `listName null` | **200** → `OK`, `verified: true`, `listName` "NBA Writers/Broadcasters/Podcasters/Bloggers", `listItemCount` **150**, `listItems` 5, both probes pass |
| `bluesky-follows` | `verifiedFollows` **0** | `verifiedFollows` **4**, `unverifiedHandles: ["dallasmavs.bsky.social", "bsky.app"]` — exactly the live read |
| `espn-scoreboard` / `espn-roster-mia` / `espn-teams-mia` | **403** → `OK` | **403** → `ENV-BLOCKED`, `verified: false` |
| summary | no verification accounting | `verifiedByThisRun: 16`, `notVerifiedByThisRun: 6`, `byVerdict {OK 13, ENV-BLOCKED 6, DOCUMENTED-BLOCKER 3}` |

The same run's `injury-watch` collected a fresh snapshot (`generated 2026-09-17T21:22:40.303Z`):
**75 rows in 27 team blocks, `errors {}`, 12 posts, 7 news items** — and **CLE, DET and LAL are
still the absent blocks**, independently re-collected 38 minutes after the snapshot this session
started from. `context.json`: 30 rosters, `roleStats` 0, 0 collector errors.

## Deliberately *not* changed

- `Social.check`'s `if (!res.error) posts = res.posts; accounts = …; error = res.error;` — I suspected the unbraced `if` was
  hiding a failed social fetch behind "no injury posts right now". Reproduced it with a harness that fails every fetch: the
  statement list is sequential, so `error` **is** assigned and the panel does render "✖ social layer unavailable". No defect;
  no change. Recorded because the shape invites exactly that misreading.
- Medical severity: still not computed anywhere. No free source re-read this session publishes a clinical grade.
- `data/audit/latest.json` was **not** regenerated locally. This sandbox has no HTTPS egress; running the audit here would
  have overwritten committed evidence with 22 `UNREACHABLE-FROM-RUNNER` rows. The runner regenerates it on push.

## Test surface after this pass

`smoke_test.js` **188** (was 165: 8 coverage-gap + 8 audit-contract + 7 CSS-completeness assertions) ·
`integration_test.js` **52** (was 48) · `poll_fixture_test.js` 24 · `regression_test.js` 26 groups ·
`python3 -m unittest discover -s tools` **26** (was 4 — new `tools/test_verify_live.py`) · `replay_posts.js --check` on the
live snapshot: 75 rows / 12 posts, no invariant violations.

## New irregularities flagged for manual review

1. **The runner audit had been wrong about four of its own checks for at least one full day** (the committed 19:25Z run
   carries all four). Everything downstream that quoted those numbers — `AUDIT.md`'s "22 checks, no drift", the sources-page
   glossary, the `bluesky-reporter-list` row — has been corrected or re-evidenced this session. Standing lesson, same as the
   gzip-probe retraction: read the *check*, not just the verdict.
2. **`nba-pdf-index` status wording**: the registry said the PDF directory "returns HTTP 500"; the committed audit run
   observed **503** (278-byte error page, no links). Both are non-browsable, so the claim stands, but the row and the flag
   now quote both statuses instead of one.
3. **The stylesheet and the markup had drifted apart in three panels.** Nothing broke loudly — the panels rendered, the
   tests were green, and the missing colours are the kind of thing only a side-by-side read of `class=` strings against
   selector lists reveals. Every status class the modules emit is now pinned by a smoke assertion, so the next drift fails
   the build instead of quietly flattening the UI.
4. **Coverage gap is a live question, not a historical one**: CLE/DET/LAL absent on 2026-09-17 is unsurprising in the
   offseason, but the same three absent blocks *during* the 2026-10-03+ preseason would mean the primary board is not
   covering every team. The board now says which case you are looking at, every refresh.

---

# Session 9 pass — the lineup-impact intelligence layer, 2026-09-18

## What this pass added (and what it refused to add)

The brief asks for an intelligence layer that defines "high lineup impact" from minutes, offensive
production, on-court +/−, team schedule and travel — not from availability text. Model v2 implements
exactly that, from **collected** evidence only, and refuses the parts no free source can support.

| Component | Weight | Evidence used | Refused |
|---|---|---|---|
| STAKE | 60% | Box scores this project fetched: minutes, start share, player's share of his own team's collected scoring, assists, on-court +/− (bounded ±8) | No league-average substitution, no salary/tier assumptions, no "star" label from reputation |
| EXPOSURE | 20% | Published schedule: games next 7 days, back-to-backs, road games, city-to-city miles, time-zone shifts | No flight plans, charters, traffic, private terminals — unavailable free, so never claimed |
| RECURRENCE | 20% | Dated ESPN roster injury listings, reported in-game exits (unconfirmed) | No medical history, no severity inference from listing wording |

Grades: **HIGH ≥ 65, MEDIUM ≥ 40, else LOW**, plus R1 (starter + Out/Doubtful = HIGH), R2 (rotation +
Out/Doubtful ≥ MEDIUM), R3 (depth caps at LOW) and **R4 (no stake evidence ⇒ UNKNOWN, even on a 4-in-6
road trip)**. Missing components are dropped and the remaining weights renormalised; the coverage fraction
is printed on every row, so a 40%-coverage grade cannot masquerade as a complete one.

## Defects found and fixed in this pass

| Area | Finding | Resolution / test |
|---|---|---|
| `assets/js/alerts.js` | `impactGrade`/`offenseTier` understood only the social layer's full assessment object. The board's flattened clone (`{tier}`), a bare grade string and a flattened archive row all read as **no impact**, so a HIGH absence got the ordinary chime | Readers now accept all four shapes; `tools/smoke_test.js` pins each one, including that MEDIUM/LOW never escalate and a missing object does not throw |
| `assets/js/intelligence.js` | The **official NBA designation layer** fired alerts with no impact attached, so an official Out for a starter sounded identical to a bench listing | Official rows now run `LineupImpact.assess` before firing, and the log line carries the impact label |
| `assets/js/ingame.js` | In-game game listings fired with no impact attached; findings also lacked the player id the lookup keys on | Impact attached for listings only (DNP rows stay ineligible and never reach the call); `playerId` now carried on both extraction paths |
| `assets/js/injuries.js` | Board alerts passed only `{tier, label}`, dropping grade/offense tier/score | Alert payload now carries grade, offenseTier and score |
| `tools/collect_context.js` | The box-score backfill built an unused ordering map from one arbitrary team and then took the last 12 candidate ids in TEAMS order — the "most recent games" sample was biased toward whichever teams sat last in the list | Extracted to a tested `recentBackfill()` that sorts by each finished game's own published date, dedupes, and sorts an unparsable date last |
| `tools/smoke_test.js` | No coverage at all for the schedule/exposure path, the availability-risk path or the four alert shapes (which is why a/g slipped through) | 8 new checks for the alert shapes; the schedule/model path is covered by the new `tools/impact_test.js` |

## New permanent test surface: `tools/impact_test.js` (69 checks)

1. **geo.js** — all 30 home cities resolve; unmapped city returns null (never an approximation); distances
   cross-checked against published values; ground vs air mode at the 250-mile line; time-zone offsets read
   from the runtime database in winter **and** summer (DST); `restDaysBetween` 0 = back-to-back; a state
   mismatch is flagged for review.
2. **collect_context.js** — keyed stat parsing (a reordered key list cannot silently shift columns);
   per-event dedupe (re-reading the same game cannot inflate games, starts or the team baseline); a new
   event accumulates; the event ledger is bounded at 1,500; the schedule chain keeps only parsable games,
   names unresolved venues, records rest days and home games as no-travel, and the backfill ordering.
3. **role.js** — HIGH for a 34.6 mpg / 9-of-10-starts / 24.6 ppg top option listed Out; the offense share is
   measured against the same collected games; on-court +/− is bounded and labelled noisy; exposure reads the
   schedule (4 games in 7 days, 2 back-to-backs); recurrence counts dated listings; a 27.5 mpg sixth man is
   graded on production, not start count; the same player as a game-time decision gets a separate
   availability-risk reading; a 4.5 mpg depth player is LOW by R3; no sample at all is UNKNOWN by R4;
   a stale sample withholds the stake; `gradeOf` renormalises weights (stake alone at 100 = HIGH at 0.6
   coverage); the model is versioned.
4. **Wiring** — the board is the first card after the status bar; the watchlist, both sound tests and all
   five impact tabs exist; the board renders factors/production/travel/availability risk; every
   `getElementById` in the shipped modules resolves to an id in `index.html`; the official and in-game
   producers assess impact; CI runs the suite before collecting.

## Verification status of this pass

- `node tools/smoke_test.js` **197/0** · `node tools/impact_test.js` **69/0** · `node tools/integration_test.js`
  **52/0** · `node tools/poll_fixture_test.js` **24/0** · `node tools/regression_test.js` **26 groups** ·
  `python3 -m unittest discover -s tools` **26 OK** · `node tools/replay_posts.js data/live/latest.json
  --check` **75 rows / 12 posts, no invariant violations**.
- `node tools/build_verified_sources.js` regenerated: **25 sources / 43 flags** (was 23/39).
- Live endpoint evidence fetched this session through the page-fetch channel: ESPN `injuries?team=mia`
  (2026-27 preseason; the `?team=` filter works), ESPN `teams/mia/schedule` (season 2026-27 preseason; first
  event `401902644`, 2026-10-03T23:00Z, MIA @ TOR at Videotron Centre, Quebec City) and ESPN
  `summary?event=401811041` (confirms the box-score shape and the real DNP reason strings the in-game
  monitor parses). Shell egress remains restricted, so `context.json` on disk is still **schema 2** until the
  workflow runs the new collector — `role.js` discloses that state on the page rather than guessing.

## New irregularities flagged for manual review (session 9)

1. **"Travel times" cannot be verified to the minute for free.** The model measures city-centre great-circle
   miles between consecutive game cities and applies a stated speed/overhead. It is accurate for *relative*
   load (a Denver→LA→Phoenix trip vs two home games) and wrong for any specific flight claim. If the intent
   was "exact travel time", that requires a paid data source and is flagged, not silently approximated.
2. **A player with no collected box score stays UNKNOWN even on the heaviest road trip** (rule R4). This is
   deliberate — schedule load alone says nothing about who the player is to the team — but it means a
   brand-new signing or two-way player is invisible to the top of the board until a game is collected.
3. **The alert escalation defect was a *shape* mismatch, not a logic error**, which is the failure mode to
   watch in this codebase: three producers, three different impact shapes, one reader that understood one of
   them. Any new producer must be added to the smoke list of shapes.
4. **Two sources were added to the registry this pass** (ESPN team-schedule API, the city-coordinate travel
   model) with explicit what-it-is / what-it-is-NOT wording; both are in `data/verified_sources.json`.
