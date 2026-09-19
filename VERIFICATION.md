# NBA Injury Alert System — Verification & Pass Report

Prepared: 2026-09-19 (session 17, local timezone UTC)
Branch: `arena/01a0baff-nbainjuryreport` → `main`
Repo: buffedlizard55-lab/NBAInjuryReport
Task this session: **review the repo, work the open reporter-layer items, and make the identity
layer's drift visible** — under the standing constraints that there is no X API key and will not be
one, that the official adapter is blocked on a 404, that lineup impact stays UNKNOWN until box
scores exist, and that in-game latency is fixture-tested only until the first tip.

---

## Session 17 — the finding that shaped the session

**The build was red on `main`, and the failing test was the wrong thing.** Running the project's own
suite before changing anything produced `verify_reporters_test: 118 passed, 1 failed`. The failing
check asserted that three session-15 rows evaluate `dormant` at a fixed clock. Session 15 graded
`michaelgrangenba.bsky.social` DORMANT at 39 days (newest post `2026-08-10T18:05:49Z`); the daily
`live-audit.yml` re-measured the same handle later that day at newest post
**`2026-09-19T14:24:17.055Z` = 0 days**, and `tools/backfill_registry_recency.js` copied that date
into the row. So:

- the **product was correct** — a writer who was quiet started posting, and the page said so;
- the **build was red** because a test had pinned a *measurement* as if it were a *rule*;
- and, worse than either, the row's own prose went on asserting `39 days → DORMANT` over a date that
  evaluated ACTIVE. **Nothing in the repository compared a row's prose to its own evidence.**

That third item is the real defect, and it is the same shape as the two "verify the verifier"
findings in sessions 6 and 7: a confident statement nobody re-checks.

### Pass 1 — implement and verify

| Change | File | Verified by |
|---|---|---|
| State-transition detection: a date write that crosses the dormant boundary records `observed.activityLog` **and** appends one dated prose sentence | `tools/backfill_registry_recency.js` | 6 new checks running the **real CLI** on a **real copy** of the registry in a scratch dir: the log entry's `from`/`to`/`previousAt`/`previousDays`/`days`/`thresholdDays`, the original verdict preserved with a correction appended, only the changed row gaining an entry, no double append on re-run |
| `ARENA_DORMANT_DAYS` read from the registry, not duplicated in the tool | `tools/backfill_registry_recency.js` | the transition thresholds in the test come from `data.js` too |
| Session-15 check rewritten to pin the **rule** (0/30 active, 31/597 dormant) plus the requirement that a row leaving the window carries the dated record | `tools/verify_reporters_test.js` | 3 checks |
| **Registry-wide invariant**: prose verdict vs the row's own measured date | `tools/verify_reporters_test.js` | **non-vacuity proven**: deleting the `activityLog` from Grange's row makes it fail and name exactly that row; restoring it passes |
| `verifierDrift()` — revoked/invalid verification objects, beat moved **or dropped**, activity transitions | `assets/js/data.js` | 13 checks against **real registry rows** with synthetic evidence (a fixture row would only prove the fixture was shaped as expected), plus the whole committed evidence file |
| 🧭 Verifier drift & activity watch panel | `reporters.html`, `assets/js/reporters.js` | booted for real against the stub DOM in `integration_test.js`, registry-only and CI-loaded scopes both asserted |
| `.pill.info` (new) and `.pill.dim` (**already broken since session 13**) | `assets/css/style.css` | prefix+class audit, non-vacuous by deleting each rule in turn |
| Grange's row corrected in place, both measurements kept | `assets/js/data.js` | the invariant above |

### Pass 2 — review for bugs, wrong assumptions, edge cases

Things found and fixed **in my own new code** during review, each worth recording because each was
plausible and wrong:

1. `verifierDrift()` first labelled a **beat-departed** fact "bio names a different team than the
   row". For `andyblarsen` there *is* no different team — the beat was dropped. `beat-departed` and
   `beat-changed` are now separate labels, because one leaves a club with no claim and the other
   moves a writer somewhere else.
2. The activity-transition detail quoted the **measurement** timestamp where the reader needs the
   **newest post** timestamp. The log entry now stores both (`at` and `postAt`).
3. The transition detail's diagnostic message listed rows whose prose and measurement **agreed** —
   a red check that misreads as a broken check. The message now names the same rows the check counts.
4. `verifierDrift([])` and `verifierDrift(null)` were treated as the same thing. They are not: a file
   that re-read nothing is a different claim from no file. Both are now pinned separately.
5. **A duplicate audit.** I added a `getElementById` audit for `reporters.html` and it failed on
   `officialEvidence` / `playerHistory` / `historySearch` / `impactLegend`. Those are dashboard-only
   nodes, `intelligence.js` is loaded on both pages, and **an audit for this page already existed**
   with a documented `sharedOptional` exemption. My version was a worse duplicate, so it was deleted
   and the existing one strengthened instead (it now tolerates `getElementById( "id" )` and single
   quotes, which the stricter pattern silently skipped).
6. **The CSS audit took five attempts**, and only a non-vacuity run exposed any of them: it matched
   class **names** anywhere (so `.badge.info` excused a missing `.pill.info`); missed the ternary
   form `class="pill ${cond ? "info" : ""}"` that the panel actually uses; over-collected every
   quoted word on the line (accusing the stylesheet of `.pill.noopener` and `.badge.retired`); read
   `m.length` — the match **array** length, always 1 — instead of `m[0].length`, so it parsed no
   attribute at all; and finally matched selectors **inside CSS comments**, so the comment documenting
   `.pill.info` counted as its rule. All five are written into the check's own comment.
7. That last version immediately paid for itself: it found **`.pill.dim`, emitted by `reporters.js`
   since session 13 and never defined** — the pill that tells a reader the activity numbers are *not*
   from CI was rendering in ordinary body colour on the deployed page.

A suspicion I checked and **dropped**: `NBA_OFFICIAL_ACCOUNT_PROBE.summary.withValidVerificationObject`
reads `0` while a probe row says `nuggets.bsky.social` has a valid object. That is not a
contradiction — the `0` is scoped to the 25 handles of the 2026-09-18 probe, the DEN row came from a
later search-based sweep, and the summary's own `meaning` text says exactly that. No change made, and
recorded here so nobody re-investigates it.

### Pass 3 — re-check against the original request

| Requirement | State |
|---|---|
| Official adapter blocked until the 2026-27 page stops 404; never guess a PDF filename | ✅ re-read live: **404**, XID **72640245**. Adapter untouched, still never guesses. |
| Lineup impact UNKNOWN until box scores exist (first window 3 Oct) | ✅ unchanged and still true; `roleStats` empty; R4 rule intact. |
| In-game QTR/exit latency fixture-tested only until that tip | ✅ unchanged; no fixture was loosened. |
| Reporter leftovers: verifier-drift UI, beat-change watch, thin teams, CHA/UTA ceiling, 26/30 clubs unverified | ◐ **verifier-drift UI and beat-change watch shipped**; thin teams and the CHA/UTA ceiling are **not** closed and are reported as such; the 26/30 club figure was **re-measured today** (41 handles, zero new objects) rather than restated. |
| X / Instagram / Facebook manual-review links; no X API key | ✅ unchanged, and now recorded as a **permanent** boundary rather than a to-do. |
| Work line by line from official verified sources, with links for manual review | ✅ every fact this session came from a keyless public read, and every drift fact carries a re-openable evidence URL. |
| No manual input; flag irregularities | ✅ the two irregularities found (red build; `.pill.dim`) are in the FLAGS log with their evidence. |
| Three passes; PR and merge to `main`; document remaining work | ✅ this file + `NEXT_STEPS.md`. Suite at end of pass 3: smoke 234, integration 102, impact 80, poll-fixture 25, regression 27 groups, verify-reporters 149, Python 26 — **all green, and green from a red start**. |

### What this session could not verify, stated plainly

- **No live-game behaviour was exercised.** There has still been no 2026-27 tip, so exit detection,
  QTR latency and the impact model's STAKE component remain designed-and-tested, never measured.
- **The browser interaction suite (`tools/browser_test.js`) was not run locally** — it needs a
  Playwright/Chromium install this sandbox cannot fetch. It runs in CI (`Tests` workflow) and that is
  where it must be read.
- **The daily `live-audit.yml` re-verification was not re-run by this session.** The evidence file is
  the 2026-09-19T18:28:52Z run committed to the repo; the next scheduled run will re-measure all 94
  handles and may move numbers again — which is now a *logged* event rather than a silent one.

---

# NBA Injury Alert System — Verification & Pass Report

Prepared: 2026-09-19 (session 16, local timezone UTC)
Branch: `arena/01a0badd-nbainjuryreport` → `main`
Repo: buffedlizard55-lab/NBAInjuryReport
Task this session: **injury-board product before training camp** — alerts that actually fire on
observed changes, every team visible on the board (including empty ones), a sourced season clock,
and the dashboard reporter scorecard. No X API key; free public verified sources only.

---

## 0. The constraint that shaped the whole session

X (Twitter) has no free read tier. The social layer remains the Bluesky allow-list. This session
did not add reporter rows; it fixed defects that would have silenced or hidden the board the
moment camp designations start moving.

| Source | Endpoint / page | Status this session |
|---|---|---|
| ESPN injuries JSON | `site.web.api.espn.com/.../nba/injuries` | ✅ 200, timestamp 2026-09-19T18:13:01Z, 2026-27 Preseason, 27/30 teams |
| ESPN injuries HTML | `https://www.espn.com/nba/injuries` | ✅ title "NBA Injury Status - 2026-27 Season"; CLE/DET/LAL omitted |
| Official 2026-27 report | `https://official.nba.com/nba-injury-report-2026-27-season/` | ❌ HTTP 404, XID 71103381 |
| Official 2025-26 rules | `https://official.nba.com/nba-injury-report-2025-26-season/` | ✅ 200, deadline text intact |
| Basketball Monster | `https://basketballmonster.com/playernews.aspx` | ✅ 200, "regular season begins in 31 days"; **not scraped** |
| ESPN schedule story | `espn.com/nba/story/_/id/49471934/...` | ✅ opening night Oct 20, 3pm / 7pm / 9:30pm ET |
| Olympics.com / NBC key dates | public roundups | ✅ camp 22 Sep overseas / 29 Sep rest; preseason 3 Oct. **Not first-party NBA.com.** |
| ESPN NBA RSS | `espn.com/nba/rss` | ⚠️ live, general news — not an injury feed, not wired |

`app.bsky.feed.searchPosts` still returns **HTTP 403** unauthenticated — unchanged.

---

## Pass 1 — Implement and verify

### 1.1 The problem found by reading the repo first

Three product defects, all visible against the live 2026-09-19 snapshot:

1. **`InjuryBoard.alertFor` keyed `alertEligible` on ESPN's listing DATE.** `fire()` already
   judges board items by `observedAt`, but a false `alertEligible` returns before that test.
   ESPN still stamps Gueye ATL at `2026-07-19T00:14Z` on a payload dated today. Training camp
   is three days away; those stamps will still be old. A NEW listing or a STATUS CHANGE
   observed today would have been silent-dropped.
2. **The team-grid hid omitted franchises.** CoverageGaps named CLE/DET/LAL; the grid did not
   render them. A board titled "every team" that omits three invites the wrong inference.
3. **`#autoScorecard` existed only on `reporters.html`.** `intelligence.js` looked it up with
   single quotes, so the wiring audit (double-quoted `getElementById` only) never noticed.

### 1.2 What was done

1. Board change alerts are eligible; freshness is judged only by `observedAt` + `maxAgeMs`.
   Social posts stay bound to post time.
2. 30-chip strip on every board view; unfiltered team-grid paints an empty card per omitted
   franchise with ESPN + NBA.com review links. Empty is labelled "not clearance".
3. `NBA_SEASON_CALENDAR` / `seasonClock()` with dated sources. Tip-time conflict between ESPN
   (3/7/9:30pm ET) and Basketball Monster (2/6/8:30pm) is stored, not resolved.
4. Dashboard `#autoScorecard` + double-quoted lookups in `intelligence.js`.
5. Five new FLAGS entries; `tools/build_verified_sources.js` now extracts the calendar.

### 1.3 Tests at the end of pass 1

Re-run at the end of pass 3. New pins: 40-day-old source stamp still fires; seasonClock on
2026-09-19 is 3 days to overseas camp and 31 to opening night; 30-chip strip; 30 empty cards
when the internal row list is empty; team-grid empty cards for omitted franchises.

---

## Pass 2 — Review for bugs, missing requirements, wrong assumptions, edge cases

| # | Finding | Fix |
|---|---|---|
| 2.1 | The existing 6-hour stamp regression could not catch this defect — 6h is still inside the old 24h window | Added a 40-day-old stamp case that asserts `alertEligible !== false` and `fire() === true` |
| 2.2 | A mid-edit of the team-grid left a syntax error (`const teams = … L on 2026-09-17`) and dropped `renderTeamStrip` | Restored the helpers, single `unfilteredGrid`, `node --check` clean |
| 2.3 | Empty snapshot + cards view still says "no listings match"; empty + unfiltered **teams** view must show 30 empty cards | Early-return skipped only for that case |
| 2.4 | `intelligence.js` single-quoted `getElementById` hid the missing dashboard `#autoScorecard` | Double quotes; smoke legend regex accepts either quote style |
| 2.5 | Camp dates are not first-party NBA.com this session | Calendar rows cite Olympics.com/NBC and say so; no invented NBA.com URL |
| 2.6 | Opening-night tip times conflict | Both claims stored; UI prints the conflict |

**Wrong assumptions removed:** that ESPN's `date` is "when we learned this"; that a coverage
line naming three absences is the same as showing those teams; that the wiring audit covers
every lookup.

---

## Pass 3 — Re-check against the original request

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Injury board at the very top, every team, BM/ESPN/NBA style | ✅ | Board remains the second section. 30-chip strip + empty cards. BBM linked, not scraped. |
| Intelligence layer for high lineup impact | ✅ (unchanged, re-verified) | Model v2. Offseason: UNKNOWN until box scores (R4). |
| Low-latency feed from free official/verified sources; links; no hallucinations | ✅ (scope-honest) | ESPN board + Bluesky allow-list. Official 2026-27 still 404. Board alerts now fire on observed change, not the source stamp. |
| Second social layer + reporter scorecard | ✅ (scope-honest) | Bluesky only. Dashboard now has `#autoScorecard`. Accuracy still `not established`. |
| Subpage of verified writers who can first-report in-game exits | ✅ (unchanged) | `reporters.html`. |
| Sound alert toggle for official OUT / confirmed reporter / in-game QTR | ✅ | Board eligibility fix is the session-16 contribution. Keep the tab open. |
| GitHub Pages, clean UI | ✅ | Season clock, strip, empty cards, scorecard. |
| Work line by line; flag irregularities | ✅ | Five FLAGS; tip-time conflict kept visible; 404 XID recorded. |
| Three passes, PR to main, remaining work documented | ✅ | This file + `NEXT_STEPS.md`. Suite at end of pass 3: smoke 234, regression 27 groups, impact 80, integration 91, poll-fixture 25, verify-reporters 119. |

### Residual limitations (carried forward, not hidden)

1. Official 2026-27 injury-report page is still 404 (XID 71103381).
2. ESPN still omits CLE, DET, LAL — now visible as empty cards, still not clearance.
3. Impact UNKNOWN and in-game latency unmeasured until 2026-10-03.
4. X / Instagram / Facebook remain manual-review links.
5. Reporter-layer leftovers (session 15): verifier-drift UI, beat-change watch, thin teams,
   `rodboone` bio, CHA/UTA identity ceiling, 26/30 clubs unverified on Bluesky.

---

## How to verify this report independently

1. Open `assets/js/injuries.js` `alertFor` — `alertEligible` is `true`; `observedAt` is now.
2. Run `node tools/regression_test.js` — the 40-day stamp group must pass.
3. Run `node tools/smoke_test.js` — seasonClock 3/31, 30-chip strip, 30 empty cards.
4. Open the dashboard: season clock, 30 chips, CLE/DET/LAL empty in team-grid, scorecard card.
5. Re-fetch `https://official.nba.com/nba-injury-report-2026-27-season/` — still 404 until the
   league publishes it.

*No hallucinated designations, no invented PDF filenames, no scraped Basketball Monster rows.
Where two sources disagree on a tip time, both claims are shown.*
