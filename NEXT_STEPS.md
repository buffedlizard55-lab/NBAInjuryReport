# Next-session priorities

## State at the end of session 9 (2026-09-18) — read this first

Branch `arena/01a0b254-nbainjuryreport`. This session built the **lineup-impact intelligence layer v2**
(the thing the brief calls "an intelligence layer that defines what a high lineup impact is") and closed
two real defects found while reviewing it. Everything below is verified locally: **197 smoke · 69 impact ·
52 integration · 24 poll fixtures · 26 regression groups · 26 Python tests · replay check 75 rows / 12 posts,
no invariant violations.**

1. **`assets/js/geo.js` (new) — the travel half of the model, and it is honest about being a model.**
   41 city rows cover all 30 NBA home cities plus long-standing and newly observed venues (asserted by
   `tools/impact_test.js`). The list is not a guess: the first schema-3 CI run reported four unresolved
   venue cities, and each was a real city on the published schedule — Inglewood, CA (the Clippers'
   Intuit Dome, whose feed identity says Los Angeles), Boulder, Ames and Tulsa (neutral pre-season
   sites) — so each earned a row. A venue whose address arrives EMPTY (observed: "Venetian Arena")
   is resolved from the venue NAME and marked `venueNameResolved: true` so the weaker provenance
   reaches the UI. Verified against the live snapshot: **14 of 14** previously unresolved rows resolve.
   Every capture carries `geoModel = Geo.MODEL_VERSION`, so a schedule cached under an older city table
   is re-collected instead of being served forever — the deployed board kept printing "travel withheld"
   after the table was fixed, because the 6-hour cache could see age but not provenance. Distances are
   cross-checked against published values; great-circle distances
   cross-checked against published values (Boston→Los Angeles 2,591 vs ~2,611 mi, Chicago→New York 711 vs
   ~713); IANA time-zone offsets read from the runtime database per game date (winter ET −5 / PT −8 /
   Phoenix −7, summer ET −4), so DST is data, not a hard-coded table; `restDaysBetween` returns 0 for a
   back-to-back. Travel time uses a documented model (450 mph cruise + 2.0 h airport overhead; ground under
   250 mi at 45 mph) and every surfaced number says "city-to-city" or "model". An unknown venue city yields
   `unmappedCity`, never an approximation.
2. **`tools/collect_context.js` → schema 3.** Adds a per-team schedule capture (next 7 games plus the last 2,
   with venue city/state, rest days, city-to-city miles, hours and time-zone shift) plus per-player
   production aggregates (points/assists/rebounds/on-court +/− over the games this project actually fetched,
   keyed by stat NAME so a reordered ESPN key list cannot shift columns) and per-team scoring baselines.
   Box-score rows are deduped by event id and the backfill now orders candidates by each game's own date.
3. **`assets/js/role.js` — impact model v2.** `score = 0.6·STAKE + 0.2·EXPOSURE + 0.2·RECURRENCE`,
   renormalised over whichever components have evidence, with the coverage fraction printed. STAKE: minutes,
   start share, the player's share of his team's own collected scoring, assists, and a ±8-point bounded
   on-court +/−. EXPOSURE: games in the next 7 days, back-to-backs, road games, travel miles, time zones.
   RECURRENCE: dated ESPN roster listings and reported in-game exits. Grades HIGH ≥ 65, MEDIUM ≥ 40, else LOW,
   plus R1–R4 (R4: no stake evidence ⇒ UNKNOWN even on a 4-in-6 road trip — schedule load alone can never
   produce HIGH). Game-time decisions additionally get a separate **availability-risk** reading.
4. **Two real defects found and fixed while verifying (both pinned by tests):**
   a. *Alert escalation read only one impact shape.* `AlertEngine.impactGrade`/`offenseTier` understood the
      social layer's full assessment but not the board's flattened clone, a bare grade string, or a flattened
      archive row; and the **official NBA layer and the in-game monitor were firing without any impact
      attached at all**. An official "Out" for a starter, or an in-game listing for a top option, arrived with
      the ordinary chime. Fixed in `assets/js/alerts.js` (all four shapes), `injuries.js` (grade/offenseTier/
      score on board alerts), `intelligence.js` (official designations) and `ingame.js` (game listings, never
      DNP rows). `tools/smoke_test.js` now pins every shape, `tools/impact_test.js` pins the producer wiring.
   b. *The box-score backfill was biased.* `collect_context.js` built an unused ordering map from one
      arbitrary team and then took the last 12 candidate ids in TEAMS order — so the "most recent games"
      sample favoured whichever teams sat last in the list. Extracted to a tested `recentBackfill()` that
      sorts by each game's published date.
5. **New permanent test surface: `tools/impact_test.js` (69 checks)** — geo distances/time zones/rest/model,
   keyed stat parsing, per-event dedupe, team baselines, schedule→travel chain, the whole grade matrix
   (incl. R1–R4 and both cross-checks on the same player: Out vs Questionable), plus a wiring audit asserting
   **every `getElementById` in the shipped modules resolves to an id in `index.html`** and that the board
   renders before the alert center and wire.
6. **Board-first layout + live UI wiring finished.** `renderImpactWatch()` is now called from `render()`;
   `app.js` binds the new high-impact sound-test button and the impact filter tabs; new CSS for the
   watchlist, offense/risk tags and model lines; `intelligence.js` hands the model the schedule and
   team-production captures and rewrote the on-page legend to describe the real formula.
7. **Registry regenerated:** `node tools/build_verified_sources.js` → **25 sources / 44 flags** (two new
   verified sources: the ESPN team-schedule API and the city-coordinate travel model, both with what-it-is /
   what-it-is-NOT wording).

Facts a new session can rely on (in addition to session 8's):
- The impact model is **lineup impact, never medical severity** — that phrase appears on the board, the
  legend and every factor label, and `tools/impact_test.js` fails if a result starts claiming a medical grade.
- `data/live/context.json` on disk is still **schema 2** until `injury-watch.yml` runs the new collector;
  `role.js` discloses that in a note ("schema 2 … components dropped and disclosed"), so a schema-2 file
  degrades to v1 behaviour instead of guessing. First CI run after merge upgrades it to 3.
- `assets/js/geo.js` is only loaded by Node tooling, deliberately: the browser reads the collector's derived
  numbers from `context.json` instead of recomputing geography per page load.

### Still open after session 9 (unchanged blockers)
- **X / Instagram / Facebook live reads** — no authorized free connector; embeds + search links remain manual
  review only and never feed alerts (documented in `sources.html`, `AUDIT.md`, FLAGS).
- **Bluesky keyword search** is 403 unauthenticated; the layer works per-account from an allow-list.
- **Official 2026-27 injury-report page** was 404 on 2026-09-17; the collector tries current then prior
  season and never guesses PDF URLs.
- **Live-game validation** cannot happen before the first tip (2026-10-03, Heat @ Raptors per the schedule
  capture). In-game latency, exit detection and the QTR path remain fixture-verified only.
- **Closed-tab push** does not exist (browser open-tab alerts only), and GitHub scheduled runs are
  best-effort — ten-minute polling is not a low-latency guarantee.
- **Real geographic precision** would need arena coordinates and charter data, neither of which is free;
  the model is city-centroid by design and labelled as such.

## State at the end of session 8 (2026-09-17, ~23:30Z) — read this first

Shipped on branch `arena/01a0b196-nbainjuryreport`: **the deployed page, audited line by line, with its one
rendering defect fixed and three stale limitation claims corrected.** This session re-read every module in
`assets/js/`, every page, the workflows and the committed data files, and — critically — read the LIVE rendered
output of the deployed GitHub Pages site instead of trusting that the code and the page agree.

1. **Real defect found and fixed: the lineup-impact legend printed `undefined` on the deployed site.**
   The rendered page showed "needs at least **undefined** collected games". Cause: `assets/js/intelligence.js`
   interpolated `${c.minGames}` while `LineupImpact.CONFIG` (role.js) only exposes `minGamesForRole`. Fixed by
   reading the real key, and pinned by a new smoke check that renders the legend template against the actual
   CONFIG and fails on any missing key or any `undefined` in the output (verified: the new check fails on the
   pre-fix code, 188/189; passes on the fix, 189/189). Recorded as a session-8 FLAGS entry.
2. **Three stale limitation claims in sources.html corrected to match verified state.** The "CORS unproven"
   item now records the resolution (deployed origin fetched both endpoints directly — re-confirmed this session),
   the "poller has not run yet" item now records that it runs on schedule with the best-effort caveat, and
   roadmap item 1 is marked done with the standing "keep the evidence current" follow-up. `tools/build_verified_sources.js`
   and the regenerated `data/verified_sources.json` carry the same corrected wording (flags 38 → 39).
3. **Live re-verification this session (assistant page-fetch channel, ~23:03–23:15Z):** ESPN injuries API **200**
   (2026-27 Preseason, per-team blocks, sampled Mouhamed Gueye ATL fractured foot with Brad Rowland byline) ·
   ESPN news API **200** (top items dated 2026-09-17 22:19–22:43Z, incl. Shams Charania Pelicans/Bey item) ·
   Bluesky `getProfile?actor=nba.com` **200** (valid verification, 122,589 followers, 6 follows, Oct 20 opener
   in bio) · deployed page **live** (board 75 listings via espn-direct, coverage gaps CLE/DET/LAL named with
   per-team links, news OK 50 articles, scoreboard OK 0 events — offseason).
4. **Everything else re-verified green locally:** 189 smoke · 52 integration · 24 poll fixtures · 26 regression
   groups · 26 Python tests · replay check 75 rows / 12 posts, no invariant violations. Registry counts
   recomputed and confirmed: 30 teams · 23 sources · 56 reporters (25 verified-handle, 20 citation-verified,
   4 outlet-only, 1 retired, 1 inactive) · 8 Bluesky reporters · 7 official/outlet accounts · 39 flags.

Facts a new session can rely on (in addition to session 7's):
- The deployed page renders correctly except where a future edit reintroduces a bug — the new legend check plus
  the browser test (`node tools/browser_test.js`) are the guards.
- `data/verified_sources.json` is regenerated from `assets/js/data.js` by `node tools/build_verified_sources.js`
  after any registry change (session 8 added a flag and corrected the CORS notes; it was regenerated).
- The two remaining "human check" items from the old limitations list are DONE (CORS proven on the deployed
  origin). The genuinely open blockers are unchanged: X/IG/FB free reads, Bluesky keyword search, official
  2026-27 report page (404 until rollover), live-game validation (first tip 2026-10-03), closed-tab push.

## State at the end of session 7 (2026-09-17, ~21:30Z) — read this first

Shipped on branch `arena/01a0b126-nbainjuryreport`: **the audit tool audited.** Session 6 fixed the test harness so a dead
assertion could not hide; session 7 pointed the same suspicion at the runner audit — the only component that independently
re-reads the 18 URLs this sandbox cannot reach. Four of its checks were wrong, each printing a confident wrong number while
the job stayed green.

1. **`tools/verify_live.py` — four defects, all fixed and all now unit-tested (`tools/test_verify_live.py`, 22 assertions).**
   - `bluesky-list` requested `?user=<handle>&list=<bare DID>`. Neither is valid for `app.bsky.graph.getList`, so it was
     answered **HTTP 400 on every run** and the 150-member writers list was never re-verified; the verdict read like "the
     list may have moved". Now requests `list=<AT-URI>` read out of `data.js` at run time (so the audited and published URLs
     cannot drift) and was live-verified the same day: **200, listItemCount 150**.
   - `verifiedFollows` counted `verification.verified`, a field Bluesky does not return → **always 0**. Real fields are
     `verification.verifiedStatus` / `verifications[].isValid`; live read: 6 follows, **4** with valid objects.
   - The roster check read `data['team']['roster']['entries']`; ESPN carries `athletes[]` at the **top level** (re-read live:
     response timestamp 2026-09-17T21:00:13Z), so even a 200 would have reported `athletes: 0`.
   - The verdict ladder printed **OK** whenever 200 was merely *tolerated* by `expect` — so `espn-scoreboard`,
     `espn-roster-mia` and `espn-teams-mia`, all 403 and having read nothing, all printed OK. Each check now declares
     `verifiesOn`, every row carries an explicit `verified` flag, `OK` means verified, and the summary reports
     `verifiedByThisRun`. The CAPABILITY-DRIFT tripwires are unchanged.
2. **Team-coverage gap is now stated on the board** (`InjuryBoard.coverageGaps` + `#boardCoverage`). The committed
   2026-09-17 snapshot carries **75 rows in 27 of 30 team blocks — CLE, DET and LAL absent**. The board names every absent
   team with a link to its own ESPN injuries page and states that an omitted block is not clearance; a 30/30 snapshot still
   denies clearance; an empty snapshot makes no per-team claim.
3. **`sources.html` audit panel** now shows per-row `claim verified` / `claim NOT verified by this run`, an
   `N/M claims verified by this run` counter, the roster read path, the list member count, and relabels `verifiedFollows`
   as "with a valid verification object".
3b. **The stylesheet had drifted from the markup in three panels** (`assets/css/style.css`). `wire.js`, `social.js` and
   `injuries.js` emit `sev-border-<sev>` but the CSS only had `.wire-item.sev-<sev>` / `.post.watch`, and `.board-row` had
   no left border — so the severity edge never rendered anywhere and an OUT item looked like a cleared one. `class="good"`
   / `class="bad"` had no bare rule either, so "✖ refresh failed — alerts paused" printed in body colour. Fixed, and seven
   smoke assertions now pin every status class the modules emit (each verified non-vacuous against the pre-fix stylesheet).
4. **Live re-verification (~20:55–21:05Z):** 2026-27 official page still **404** (`XID: 74717976`) · `getList` AT-URI form
   **200/150 members** · `getFollows(nba.com)` **200**, 6 follows, 4 valid objects, DAL unverified, `bsky.app` a *trusted
   verifier* not a verified account · ESPN `injuries?team=mia` **200** (payload timestamp 17:01:02Z, 2026-27 Preseason) ·
   ESPN `/teams/mia/roster` **200** with top-level `athletes[]` · committed snapshot 75 rows / 27 blocks / 13-of-13 accounts
   / `errors {}`.
5. **A suspected defect that was NOT a defect, recorded so nobody re-investigates it:** `Social.check`'s unbraced
   `if (!res.error) posts = …; accounts = …; error = res.error;` looks like it swallows a failed fetch. Reproduced with a
   harness that fails every request: the statements run sequentially, `error` is assigned, and the panel renders
   "✖ social layer unavailable". No change made.

Facts a new session can rely on:
- Test surface: **188 smoke · 52 integration · 24 poll fixtures · 26 regression groups · 26 Python · live replay 75 rows /
  12 posts.** If a number drops after editing a closure, suspect the harness, not the code.
- `data/audit/latest.json` was regenerated by the runner at **21:22Z with the fixed tool**: 22 checks, 0 drift,
  `verifiedByThisRun: 16`, `notVerifiedByThisRun: 6` (four ESPN API calls fingerprinted to 403, two ESPN HTML pages returning the 202 bot-challenge interstitial).
  `bluesky-list` is 200/150 members and `verifiedFollows` is 4. Read the `verifiedByThisRun` counter, not just "no drift".
- **Never run `tools/verify_live.py` in a sandbox with no HTTPS egress** — it would overwrite committed evidence with 22
  `UNREACHABLE-FROM-RUNNER` rows. It is a runner job (and `workflow_dispatch`).
- Same time gates as session 6: `roleStats` fills from the 2026-10-03 preseason tip; the 2026-27 official page is expected
  around early October; the CI audit tripwire (`CAPABILITY-DRIFT`) fires the moment it goes live. **New:** after 2026-10-03,
  check whether CLE/DET/LAL (or any team) is still missing a board block *while games are live* — that would be a
  source-coverage problem, not an offseason artefact.

## State at the end of session 6 (2026-09-17, ~19:00Z) — read this first

Shipped on branch `arena/01a0b0ba-nbainjuryreport`: the **test-harness integrity fix of the project**, four dated registry re-validations (incl. closing the Fischer outlet dispute), and three lineup-impact refinements that were on this list.

1. **Dead test closures revived (`tools/smoke_test.js`) — the single most important fix this session.**
   `check(name, () => {…})` accepted the closure as truthy and never ran it: 6 grouping closures / 12 inner
   assertions in the lineup-impact section had NEVER executed while the suite reported all-green. The harness now
   executes closures honestly. Moment it was fixed, one previously-dead assertion went red for real: `role.js`
   never disclosed a schema-unmarked context file (and neither `intelligence.js` nor the poller even passed
   `schema` through). Implemented end-to-end; the assertion is now green because the disclosure exists.
2. **Registry re-validation with dated evidence:** Jake Fischer → **The Stein Line ("The People's Insider")**,
   resolved by quoting the outlet's own Substack byline fetched live (post dated 2026-04-08) — the DISPUTED flag is
   closed; Chris Haynes → Amazon Prime (FOS 2025-09-29); Candace Buckner → The Athletic national columnist
   (Sports Media Watch + TheWrap, both 2026-02-26); Will Guillory → The Athletic Rockets + Pelicans staff writer.
   A smoke assertion now fails on any silent DISPUTED outlet. `data/verified_sources.json` regenerated (30/23/56/36).
3. **Impact refinements (were §5 "Remaining"):** median per-game minutes quoted next to the mean with a
   blowout/divergence disclosure (collector keeps bounded `minutesValues`); a **team-change flag** when the
   collected sample belongs to a previous team; and a **named** "no contract entry" state (two-way/expired/
   unpublished — the source does not say which) instead of silence.
4. **Live re-verification (~19:00Z):** 2026-27 official page still 404 · 2025-26 rules page intact verbatim ·
   ESPN injuries 200 with the same schema · nba.com Bluesky verification still valid (followsCount 6) ·
   searchPosts still 403 · Basketball Monster status tags confirmed present in server HTML (settles the
   third-pass retraction question).

Facts a new session can rely on:
- Test surface is now honestly reported: **165 smoke** · 48 integration · 24 poll fixtures · 26 regression groups ·
  4 Python · live replay 74 rows / 12 posts. If a smoke number ever *drops* after editing a closure, suspect the
  harness, not the code.
- Same time gates as session 5: `roleStats` fills from the 2026-10-03 preseason tip; the 2026-27 official page
  is expected around early October; the CI audit tripwire (`CAPABILITY-DRIFT`) fires the moment it goes live.

## State at the end of session 5 (2026-09-17) — read this first

Shipped on branch `arena/01a0b045-nbainjuryreport`: Session 5 enhancements covering real-time in-game alerting, Basketball Monster-style quick search and status filtering, lineup impact alert propagation, and verified reporter directory subpage upgrades.

**Key enhancements and defect fixes:**
1. **Lineup impact alert propagation (`assets/js/alerts.js`, `assets/js/social.js`, `assets/js/app.js`):**
   Fixed property mismatch where `alerts.js:fire` checked `item.impact.tier === "high"` (which was undefined because `LineupImpact.assess` sets `out.impact = "high"` and `out.role.tier = "starter"`). Alerts now check `(item.impact.impact === "high" || item.impact.tier === "high")` and prepend `⚡ HIGH LINEUP IMPACT` to the alert label and log. Attached lineup impact assessments directly to social post alerts and classified news wire items whenever an NBA player is identified. Pinned with new regression checks (26 total passed).
2. **Basketball Monster-style Injury Board toolbar (`index.html`, `assets/js/injuries.js`, `assets/css/style.css`):**
   Added an instant search bar (`#boardSearch`, `#boardResetFilter`) and quick status filter tabs (`#boardStatusFilters`) with live count badges for `All`, `🔴 OUT`, `🟠 Doubtful`, `🟡 Questionable / GTD`, `🟢 Probable`, and `🔵 Return / Good` directly above the structured injury board. Users can filter by player name, injury detail, or status in real time.
3. **Live ongoing game injury alerting (`assets/js/ingame.js`):**
   Updated `InGame.extract` so that in-game injury designations from live ESPN summaries (status Out, Questionable, Doubtful, or in-game exit notes like "questionable to return", "locker room") are alert-eligible (`alertEligible: true`), fulfilling the requirement to alert on players injured during ongoing games while keeping pre-game DNP scratches alert-ineligible.
4. **Reporter directory subpage categorization & 30-team matrix (`reporters.html`, `assets/js/reporters.js`):**
   Added interactive Category Filter Tabs (`All Directory`, `Official League & Team`, `Lead Insiders (Tier 1)`, `In-Arena Beat Writers (30 Teams)`, `Cited Wire Bylines`, `Others & Review`), an In-Arena Live Exit Reporting capability column and filter (`#inArenaFilter`), and a dedicated **30-Team In-Arena Coverage & Live Exit Intelligence Matrix** card (`#matrixCard`, `#arenaMatrixTable`) showing each franchise's verified beat writer, outlet, courtside exit tracking status, profile link, and manual verification link.
5. **Sound test visual feedback (`assets/js/app.js`):**
   Added button state feedback (`🔔 Playing chime…` / `⚠ Audio unavailable`) when `#testSound` is clicked, providing immediate confirmation alongside WebAudio chime playback.
6. **Registry text synchronization:**
   Corrected outdated "NOT yet executed by GitHub" text in `assets/js/data.js` and regenerated `data/verified_sources.json`.
7. **Test suite passing:**
   All 147 unit tests (`smoke_test.js`), 26 regression groups (`regression_test.js`), 48 integration/runtime/wiring checks (`integration_test.js`), 24 end-to-end poll fixture tests (`poll_fixture_test.js`), 4 Python unit tests, and post replay checks pass with 0 errors.

Facts a new session can rely on:
- Live site: https://buffedlizard55-lab.github.io/NBAInjuryReport/
- Directory: https://buffedlizard55-lab.github.io/NBAInjuryReport/reporters.html
- `data/live/context.json` is schema 2; box-score role stats will accumulate once the 2026-10-03 preseason tips.
- The 2026-27 official injury report landing page is expected around October 2026; until then, the last verified page (2025-26 rules) is linked and the 404 is tracked by the runner audit.

## State at the end of session 4 (2026-09-17, ~14:50Z)

Merged to `main`: session-4 pass — full line-by-line re-read of every shipped file, four direct live re-verifications
(2026-27 official page still 404; 2025-26 rules text verbatim; injuries feed identical schema; nba.com Bluesky verification
still valid with `followsCount` 6), one real defect fixed, two cosmetic/stale defects fixed.

**The defect that mattered:** social alert eligibility was keyed on the Bluesky *verification object* alone, so four of the eight
allow-listed reporters (McDonald, Orsborn, Haberstroh, Hollinger) could never sound an alert despite recorded identity evidence.
Now: reporters qualify on recorded evidence (the same standard the directory uses), official team accounts still require the
verification object (the flagged `dallasmavs` account stays silent), the feed shows ✓ vs ◐-evidence badges, and the evidence
ledger stores both fields. Pinned by two new regression groups — 23 total. Also: missing `.tag.ok/.warn/.gtd` CSS added (verified
posts and unverified posts used to look identical), and the stale "poller never ran on GitHub" text in the registry generator fixed
+ `data/verified_sources.json` regenerated.

Facts a new session can rely on:
- Everything green on `main`: `Tests` (incl. Chromium suite), `injury-watch`, `Public source audit`, `Deploy dashboard`.
  The session-4 push re-triggered the runner audit over all 22 checks; read `data/audit/latest.json` first — it is the independent
  re-verification of the 18 URLs the build sandbox cannot re-fetch.
- `data/live/context.json` is still schema 2 with empty `roleStats` — **nothing fills until the 2026-10-03 preseason tip.**
  First acceptance check after tip: `roleStats` gains entries, a starter's OUT alert renders `HIGH IMPACT` + `⚡` prefix, and an
  in-game exit alert from a monitored account carries the post link (and, since session 4, can come from a reporter with evidence
  but no verification object).
- The official report page is expected to exist around the season start (~Oct 2026). The moment
  `https://official.nba.com/nba-injury-report-2026-27-season/` returns 200 with timestamped PDF links, the runner audit fails with
  CAPABILITY-DRIFT **by design** — that is the tripwire. Then: parse the first real report (the April 12 2026 fixture proves the
  parser handles the current layout), confirm every row, and let `Intelligence.officialAlerts` do its job.

## State at the end of session 3 (2026-09-17, ~05:26Z)

Merged to `main`: PR #8 (lineup-impact layer, alert-freshness fix, CI trigger fix, registry re-verification, 20 citation-verified
reporter rows, rewritten source audit) and PR #9 (three claims the first audit run disproved, corrected in place).
Everything below is green on `main`: `Tests` (including the extended Chromium suite), `injury-watch`, `Public source audit`,
`Deploy dashboard`. Deployed: https://buffedlizard55-lab.github.io/NBAInjuryReport/ — rows currently read `IMPACT: UNKNOWN`
with real salary/cadence lines, because `roleStats` is empty until the 2026-10-03 preseason tip. That is correct behaviour.

Facts a new session can rely on without re-deriving:
- `data/live/context.json` is schema 2: 30 rosters, 559 players, 54 with dated injury listings, 0 collector errors.
  `data/live/latest.json` publishes impact fields on 74/74 rows. Both are written only by CI — never hand-edit them.
- The repo's own runner audit (22 checks, no drift) is committed to `data/audit/latest.json` and rendered on the sources page,
  with a per-check `meaning` line. Verdict vocabulary: `CAPABILITY-DRIFT` (fails the job), `DOCUMENTED-BLOCKER`, `ENV-BLOCKED`,
  `OK-PAGE-CHANGED`, `UNREACHABLE-FROM-RUNNER`, `TOOL-ERROR`.
- ESPN refuses *this Python client* (403 on `site.api.espn.com`, 202 with empty body on `www.espn.com`) while Node on the same
  runner and a browser on the deployed origin succeed. Do not generalise a blockage into "the source is down"; do not spoof
  browser headers to make the audit greener.
- Branch hygiene: this session's branch is written by the collector bot, the audit bot and the human at once. Pushes will be
  rejected occasionally; `git fetch` + rebase (or merge with `-X theirs` for `data/**`, which CI owns) is the fix, and the
  commit steps now do exactly that.

The single most valuable next action is **time-based, not code-based**: after 2026-10-03, confirm `roleStats` starts filling
from box scores, that a starter's OUT alert renders `HIGH IMPACT` + the `⚡` log prefix, and that an in-game exit alert carries
the post link. Until then the impact layer is structurally tested but empirically unexercised — say so rather than implying otherwise.

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

## 3. Harden player and reporter identity (partly advanced 2026-09-17: 20 directory rows now carry verbatim injury-feed citations, corrected outlets and cleared flags; session 4 made alert eligibility evidence-based for reporters)

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
- ~~Team-change note~~ **SHIPPED session 6**: when the accumulated sample's team differs from the listing's team, the assessment sets
  `role.teamChanged`, names both teams and shows "⚠ sample collected with previous team" on the board. Still open: reconciling `playerId`
  drift on trades at the *collector* level (re-keying history when ESPN issues a new roster entry).
- ~~Missing contract entry~~ **SHIPPED session 6**: `contract.missing` + "ESPN's roster feed filed no contract entry … (two-way, expired or
  unpublished; the source does not say which)" is now explicit instead of silence.
- Add recurrence corroboration across seasons (same body part twice) **only** if listing history is retained long enough; today `injuryEntries`
  is capped at 8 per player and 270 days of listing recency, and first observation must never be presented as injury onset.
- ~~Median minutes~~ **SHIPPED session 6**: the collector keeps bounded per-game `minutesValues`, `role.js` quotes the median next to the mean
  and discloses a wide divergence ("blowout-heavy or injury-shortened sample"). Still open: trimming outliers (e.g. <8 min games for
  DNP-return/injured-exit artifacts) once real games show how often they occur.

## 6. Delivery, storage and operations

- Add opt-in Web Push/Discord/email on a backend for closed-tab delivery; never put delivery secrets in public static assets.
- Cross-tab coordination and player/game/status semantic deduplication across sources.
- Automatic source-health monitoring, rate-limit backoff, last-good persistence and explicit missed-coverage windows.
- Replace repeated Git snapshots with an append-only database/object store. Current raw working-tree snapshots: seven days; ledger: 30 days / 10,000 changes. Old Git objects remain.
- Verify deployed Pages output after every collector change. `pages.yml` explicitly deploys after main's collector workflow.

## 7. Standing practice added in session 7: verify the verifier

Two sessions in a row, the highest-value defect was in a **check**, not in the product: session 6 found a test harness that
accepted a closure as truthy and never ran it; session 7 found four audit checks that printed confident wrong numbers. Both
were invisible while everything was green. Concretely, for the next session:

- Any new `verify_live.py` check must state `verifiesOn` (the statuses that can verify its claim) and must have at least one
  unit test in `tools/test_verify_live.py` against a **real captured payload**, not an invented shape. A check with no
  fixture is a check that cannot fail.
- When a check's verdict is `OK-PAGE-CHANGED` or `ENV-BLOCKED` more than twice in a row, read the URL and the probe regex by
  hand. "The source moved" is the least likely explanation for a check that has never once verified anything.
- Before quoting any number out of `data/audit/latest.json`, confirm the field is one the API actually returns
  (`verifiedFollows` was 0 for that reason; `listName` was null for the same reason).
- The `#boardCoverage` line is a cheap honesty instrument: if it ever reads `30/30` during live games, that is worth
  recording too — it means the primary board covered every team that day, which is the claim this project most wants to be
  able to make and currently cannot.

## External access limitations

No authorized X, Instagram, Facebook or live broadcast connector is configured. Review each platform's current official access/licensing terms; do not rely on inherited fixed pricing statements or evade access controls. Free publicly accessible ESPN endpoints are undocumented and may change or return 403. The present system is a best-effort monitoring foundation, not complete verified real-time coverage.
