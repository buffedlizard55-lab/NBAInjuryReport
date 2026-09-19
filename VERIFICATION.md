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
