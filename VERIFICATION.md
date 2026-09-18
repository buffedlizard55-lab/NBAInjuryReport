# NBA Injury Alert System — Verification & Pass Report

Prepared: 2026-09-18 (session 10, local timezone UTC)
Branch: `arena/01a0b5ed-nbainjuryreport` → `main`
Repo: buffedlizard55-lab/NBAInjuryReport
Task this session: **expand in-arena reporter verification**, with no X API key — every added fact
must come from a free, publicly reachable, re-checkable source.

---

## 0. The constraint that shaped the whole session

X (Twitter) has no free read tier, so **no X API key is available and none is assumed**. Everything
added this session therefore comes from sources that answer **without a key and without an account**:

| Source | Endpoint used | Status this session |
|---|---|---|
| Bluesky identity | `public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?actors=…` (batch, ≤25 actors) | ✅ read live, no key |
| Bluesky discovery | `…/app.bsky.actor.searchActorsTypeahead?q=…` | ✅ read live, no key |
| Bluesky posts | `…/app.bsky.feed.getAuthorFeed?actor=…&limit=1` | ✅ read live, no key |
| Official club channels | `https://www.nba.com/<slug>/news` | ✅ read live for CLE; all 30 re-checked by CI |
| Basketball-Monster-style discovery list | Substack beat-writer list (Oct 2025) | ⚠️ used for **name discovery only**, never as evidence |

`app.bsky.feed.searchPosts` still returns **HTTP 403** unauthenticated — unchanged, and not worked
around. Keyword firehose scanning is therefore still out of scope; the layer is an allow-list.

---

## Pass 1 — Implement and verify

### 1.1 The problem found by reading the repo first

The directory listed in-arena coverage for **22 of 30 teams**. Eight teams — CLE, DET, MIL, MIN,
PHI, POR, SAC, WAS — had **no writer row at all**, and the matrix rendered from "whatever rows
exist", which produced a green `✓ In-arena live coverage` badge for teams whose only row was a
byline citation. That is the exact failure mode a verification page must not have.

### 1.2 What was done

1. **18 evidence rows added to `BSKY_REPORTERS`** (8 → 26 rows), each with: the verbatim bio the
   identity was read from (`evidenceQuote`), the re-checkable API URL (`evidenceApi`), the class
   (`conf`), the verifier domain when a Bluesky verification object was present, and the counts
   actually observed that day (`observed`).
   - **Bluesky-verified (valid object; issuer `bsky.app` or the outlet's own domain):**
     Jon Krawczynski (MIN, The Athletic) · Omari Sankofa II (DET, Detroit Free Press) ·
     Kyle Neubeck (PHI, PHLY) · Sean Highkin (POR, Rose Garden Report) ·
     Josh Robbins (WAS, The Athletic → verified by `theathletic.com`) ·
     Josh Lewenberg (TOR, TSN) · Law Murray (LAC, The Athletic → verified by `theathletic.com`) ·
     Jim Owczarski (MIL, Milwaukee Journal Sentinel) · Gerald Bourguet (PHX, Suns After Dark) ·
     Kelly Iko (Yahoo Sports, national).
   - **Bio-verified (account states outlet + beat; no verification object):** Jason Beede (ORL,
     Orlando Sentinel) · James Ham (SAC, ESPN 1320 / The Kings Beat) · Ethan Sands (CLE,
     cleveland.com) · Brad Rowland (ATL, Locked On Hawks) · Scott Agness (IND, Fieldhouse Files) ·
     Ira Winderman (MIA, South Florida Sun Sentinel).
   - **Held out of the alert path (visible, never polled):** Anthony Chiang (MIA, Miami Herald —
     **dormant**, newest post 2024-12-11) and Keith Pompey (PHI — handle **unconfirmed**, bio names
     no outlet).
2. **`arenaCoverage()` + `arenaCoverageSummary()` in `assets/js/data.js`** — coverage is computed
   per team from the registries, with an explicit gap list per row.
3. **Official club channels for all 30 franchises** (`nba.com/<slug>/news`), generated from the
   team registry rather than typed twice.
4. **`tools/verify_reporters.js`** — re-runs the exact API call each row cites, plus all 30 club
   channels. Fails only on a broken identity claim; records drift and dormancy.
5. **`tools/verify_reporters_test.js`** — 37 offline checks pinning every verdict branch.
6. **UI** — `reporters.html` gained an in-arena verification status block, a rewritten 30-row
   matrix (polled writers + evidence + class + gaps + official channel + manual-review links) and
   an expansion log; the dashboard gained a computed coverage summary.

### 1.3 Measured result (computed, not typed)

```
teams 30 · verified-pollable 10 · bio-pollable 7 · official-only 13 · gap 0
pollable writers 18 · Bluesky-verified writers 10
```

The 13 official-channel-only teams are **BOS, BKN, CHA, CHI, DAL, DEN, GSW, HOU, LAL, MEM, NOP,
NYK, OKC** — named on the page as needing work, not rendered as covered.

### 1.4 Tests at the end of pass 1

`smoke_test.js` 209 ✓ · `integration_test.js` 71 ✓ · `verify_reporters_test.js` 37 ✓ ·
`impact_test.js` 80 (re-run in pass 3) · `poll_fixture_test.js`, `regression_test.js`,
`python3 -m unittest`, `replay_posts --check` — all re-run at the end of pass 3.

---

## Pass 2 — Review for bugs, missing requirements, wrong assumptions, edge cases

Three real defects were found by the new tests, plus four by reading the code back:

| # | Finding | Fix |
|---|---|---|
| 2.1 | `judge()` marked a `feed:false` row **dormant**, i.e. it judged a row on recency it never claimed and would have flagged the recorded dormant account forever as a new problem | Recency is only applied when the row makes a coverage claim (`feed !== false`); the ok verdict now carries "held out of the alert path" instead. Pinned by a test that also proves **identity drift on such a row is still caught**. |
| 2.2 | A test compared the raw `conf` field, which is absent on the 8 legacy rows — a false alarm, and a check that would have gone on to mis-grade every legacy row | The test now asserts the two things that matter: **nobody may claim `bsky-verified` without the object**, and legacy rows are graded by their recorded evidence. |
| 2.3 | The dormant account's newest post existed only as prose inside its evidence string, so nothing could be re-checked mechanically | Added `observed.latestPostAt = "2024-12-11T18:15:24.950Z"` and pinned it in the test. |
| 2.4 | The unconfirmed handle was excluded from polling **only** by its `feed` flag — one careless edit would arm it | `Social.feedAccounts()` now applies **two independent gates** (`feed !== false` **and** `conf !== "unconfirmed"`), with a smoke test that flips the flag at runtime and asserts the account still does not reach the allow-list. |
| 2.5 | The old matrix printed `✓ In-arena live coverage` for teams with no pollable writer | Class + gaps are now rendered from `arenaCoverage()`; the integration test asserts 30/30 rows carry a class and that the "no source" state is reported honestly. |
| 2.6 | `sources.html` stated "all 90 checks must stay green" (stale since several sessions ago) | Replaced with a rule that cannot go stale: point the reader at the command, plus the new re-verification step. |
| 2.7 | A workflow step's `if:` expression I wrote reduced to a tautology | Removed — the job runs on every trigger, matching the audit job. |

**Edge cases explicitly handled:** reformatted bios (whitespace/newlines) do **not** count as
identity drift; a dormant row is still checked for identity; an unresolvable handle is never
silently skipped (AT Protocol's `getProfiles` omits unknown actors, so omissions are recorded
explicitly); a network-less environment prints `UNREACHABLE` and **preserves** the previous
evidence file instead of overwriting it; the reporter page states that the automated file has not
run yet rather than showing an empty panel.

**Wrong assumptions removed:** that a name match identifies a person (the doppelgänger "Brad
Rowland" account would have been a coin flip); that a handle that looks like a team is a team
(`cavaliers.bsky.social` is a Sapporo food blog, `bucks.bsky.social` has 39 followers and zero
posts); that an active account is a useful one (Pompey's handle is active and unconfirmable); that
The Athletic author pages can be read from this environment (they answer **HTTP 403**).

---

## Pass 3 — Re-check against the original request

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Expand in-arena reporter verification | ✅ | 18 evidence rows added, 8 previously-empty teams closed, coverage now computed per team, matrix rewritten. |
| No X API key; free, publicly available verified sources only | ✅ | Every added fact came from keyless Bluesky public API calls or `nba.com` club pages. X remains manual-review links only. |
| Subpage listing verified/official writers who report live from the game | ✅ | `reporters.html` — matrix, verification status block, expansion log, Bluesky allow-list table, directory table; every row links its own evidence and re-check call. |
| Severity by team role / rotation / history / ruled-out / in-game exit | ✅ (unchanged, re-verified) | Impact model v2 (`role.js`) + in-game monitor; this session did not alter it. |
| Second layer from social media with forward scoring | ✅ (scope-honest) | Pollable allow-list now 18 writers; forward scoring ledger unchanged. **X/Instagram/Facebook remain unreadable for free** and are labelled as such. |
| Alerts with links for manual review + sound toggle | ✅ (unchanged, re-verified) | `alerts.js`; each alert carries a source URL. New: an unconfirmed handle can never sound. |
| Injury board — every team, at the top, main focus | ✅ (unchanged, re-verified) | `index.html` board remains the first content block; the dashboard now also shows the computed in-arena coverage summary with the gap teams named. |
| GitHub Pages site, clean and organised | ✅ | `reporters.html`, `sources.html`, dashboard; CSS added for the new matrix. |
| Work performed line by line; links for manual review; no hallucinations | ✅ | Every added row carries the exact bio text, the exact API URL and a dated observation; nothing was inferred, and three identities were **refused** rather than assumed. |
| Flag irregularities for review | ✅ | 8 new `FLAGS` entries + 6 rows documented in `sources.html` and the expansion log: doppelgänger, mirror account, dormant account, unconfirmed handle, squatted team handles, 403-blocked outlet pages. |

## Pass 2b — what the automated re-verification found once it actually ran

The claim behind this session was "the verifier keeps the identity layer honest". On the first real
run (GitHub runner, 2026-09-18T19:21Z and 19:27Z) it did — and the findings are the strongest
evidence in this report, because nobody typed them:

| Finding | Evidence | Action |
|---|---|---|
| **A stale claim in this project's own data** | `theathletic.com` was recorded on 2026-09-17 as carrying a valid Bluesky verification object. The API now returns `isValid: false`, `verifiedStatus: 'invalid'` (object issued 2025-04-21). It also still returns `trustedVerifierStatus: 'valid'`, and the objects it issued to staff (Vecenie, Vorkunov, Robbins, Murray) remain valid. | Row corrected (the OUTLET has no valid badge; the STAFF rows stand), the narrow scope written next to the row, and a FLAG records that the automated run — not a human — caught it. |
| **Club channels are not machine-readable from CI** | All 30 `nba.com/<slug>/news` URLs answered **HTTP 403** to the runner, while the same page answered 200 to a browser-shaped client the same day. | `NBA_TEAM_NEWS_PROBE` records the probe result; the matrix states it per row; the layer is documented as a **manual-review link**, never as a verified feed. The probe now sends ordinary browser Accept headers with an identifying User-Agent, and the per-channel result is stored so a change is visible as data. |
| **Measured dormancy** | `dallasmavs` newest post 2023-05-05 (1,231 days) and still no verification object · `trailblazers` 308 days · `clevelandcavaliers` and `basketball-reference` zero posts · reporter rows `kellyiko` 99 days, `ejelite1` 45 days, `samvecenie` 73, `tomhaberstroh` 57. | Dormancy is now a number in the evidence file rather than an assumption. `dallasmavs` was additionally taken **out of collection** (`feed:false`), since an unverified, dormant handle cannot add a wire item or an alert. |
| **A hand-copied rule inside the audit** | The collector run failed with `"#Cavs Craig Porter Jr. suffered a left groin strai…" labelled OUT without an explicit out phrase`. The classifier was right — the audit's own phrase list had drifted from the classifier's. | The OUT-language rule now exists **once**, as `SOCIAL_OUT_LANGUAGE_RE` in `data.js`, and the audit asserts against that constant (its independent checks — injury vocabulary, negation guard, duplicate detection — are unchanged). Smoke tests pin the invariant in both directions, including the real text that failed CI. |
| **A truncated failure message** | The failure annotation read only `REPLAY CHECK FAILED:`. | The audit now emits one annotation per violation (capped at 40 with a remainder count), so a red run names its own evidence in the UI and via the API. |
| **A failing read that looked like a pass** | `latestPost` returned `null` both for "never posted" and "request failed". | Now returns readability + item count; the verifier reports `recency-unknown` instead of implying a clean bill of health, and a readable-but-empty feed is reported as dormant with "ZERO posts" in the note. |

After those corrections the same job reports: **34 handles checked · 27 ok · 0 bio drift · 6 dormant
· 0 unresolvable · 0 verification-lost · 0 fatal**, with club channels at 0/30 answered by the runner
(recorded, and stated in the UI rather than hidden).

### Residual limitations (carried forward, not hidden)

1. **13 teams still have no pollable writer account.** X cannot be read for free; closing these
   needs a Bluesky account for a beat writer, or an official channel that publishes designations.
2. **A verified account is not in-arena attendance.** Verification proves who someone is; a beat
   assignment is a coverage claim. Only corroboration against designations is evidence about a report.
3. **`data/live/reporter_verify.json` did not exist when this report was written**, because this
   build environment has no shell network egress — the file is produced by the first
   `live-audit.yml` run. The page says so explicitly until then.
4. **29 of 30 club `/news` pages are labelled "pattern, not re-read this session"** until the
   verifier checks them on its first run.
5. **No historical accuracy scores** exist yet: the scorecard is forward-collecting. With the
   allow-list now covering 18 writers across 17 teams, the observation window actually has data to
   grade once games start (2026-10-03 preseason, 2026-10-20 opening night).
6. **The official NBA injury report for 2026-27 is still 404**; `official.json` stays flagged.

---

## How to verify this report independently

1. Pick any added row in `assets/js/data.js`; open its `evidenceApi` URL in a browser — you get the
   same bio, verification object and counts without a key.
2. Compare the `evidenceQuote` with the `description` field returned.
3. Open `reporters.html` → the matrix shows the class and the gaps; the status block shows the
   re-verification file state honestly.
4. Run `node tools/verify_reporters_test.js` (offline) and `node tools/smoke_test.js`.
5. Run `node tools/verify_reporters.js` where there is network, then read
   `data/live/reporter_verify.json`.

*No hallucinated identities, no fabricated handle claims, no invented quotes. Where evidence could
not be obtained, the row says so and is wired into nothing.*
