# Session 20 (2026-09-19) — Three-pass review & PR merge

## Pass 1 — Implementation verification

Re-ran the full shipped test suite against the committed tree after reviewing every module
end-to-end:

| Test suite | Result |
|---|---|
| `tools/smoke_test.js` | **237 passed, 0 failed** |
| `tools/impact_test.js` | **99 passed, 0 failed** |
| `tools/intelligence_test.js` | **23 passed** |
| `tools/integration_test.js` | **106 passed, 0 failed** |
| `tools/poll_fixture_test.js` | **25 passed, 0 failed** |
| `tools/verify_reporters_test.js` | **171 passed, 0 failed** |
| `tools/regression_test.js` | **28 groups passed** |
| `tools/test_*.py` (Python) | **26 passed, 0 failed** |
| `replay_posts.js --check` | 75 rows / 137 posts, 0 invariant violations |
| `backfill_registry_recency.js --check` | registry in sync (78 measured, 0 updates) |
| `git diff --check` | clean |
| All `getElementById` references | every id resolves in one of the three HTML pages |
| HTTP static serve (`python3 -m http.server`) | index/reporters/sources all serve 200 |

All twelve requirements from the brief are implemented and wired:

1. **Injury board for all 30 teams** — first card after the status bar (`index.html`,
   `assets/js/injuries.js`); ESPN structured injuries feed; 30-chip team strip (empty teams
   rendered with warn chips, "NOT clearance"); search; status + lineup-impact quick filters;
   "Basketball Monster Player News" card view and team-by-team grid view.
2. **Lineup-impact intelligence layer** — `assets/js/role.js` model v2 (60% stake / 20% exposure
   / 20% recurrence); minutes, start share, offense scoring share, assists share, bounded
   on-court +/−; schedule load including back-to-backs, road games, travel miles and time-zone
   shifts via `assets/js/geo.js` (great-circle, documented time model); injury-listing
   recurrence; four rules (R1 starter+Out/Doubtful=HIGH, R2 rotation+Out/Doubtful≥MEDIUM, R3
   depth caps at LOW, R4 no stake evidence=UNKNOWN). Every row prints its factors, score,
   confidence/coverage, and the rules applied.
3. **High lineup-impact watch list** — `#impactWatch` renders immediately above the board
   toolbar; any HIGH-grade listing also carries a distinct ⚡ HIGH LINEUP IMPACT chime.
4. **Alert center with sound on/off toggle + test button** — `assets/js/alerts.js`; two pure
   WebAudio sine-wave chimes (soft E5→A5 bell for standard; rising A5→C#6→E6 figure for high
   impact); toggle persisted in localStorage; opt-in browser Notification API; two test
   buttons (standard voice + high-impact voice) plus a TEST-ONLY synthetic OUT/QTR delivery
   test that uses a fictional player and never pollutes the wire; configurable poll interval
   30–300 s.
5. **Alerts for ongoing games (in-game QTR/out)** — `assets/js/ingame.js` fires an alert when
   an ESPN game-summary listing carries Out/Doubtful/Questionable/Day-To-Day status OR
   contains "return"/"remainder"/"locker" language about a recognized player. DNP rows are
   explicitly flagged `alertEligible: false` (never confused with an exit).
6. **Alerts for official out + verified social posts** — the board layer fires on new/changed
   listings (freshness judged by observation time, not ESPN's stale source stamp — the
   session-16 fix); the social layer fires on posts from allow-listed Bluesky accounts that
   carry injury language, bound to post time so resurfaced old posts cannot re-alert; both
   layers attach lineup-impact when the player resolves, play the high-impact voice when
   appropriate, and carry the source URL for manual review.
7. **Live chat-style injury wire** — `assets/js/wire.js`, newest-first, merges ESPN news,
   board, social, in-game and official layers; severity colour edges; per-team filter;
   severity checkboxes; mark-read / clear buttons; unread badges.
8. **Social-media verification layer (second lane)** — `assets/js/social.js` polls the free
   Bluesky/AT-Protocol public API; allow-list is the reporter registry in
   `assets/js/data.js`; Bluesky-verified accounts show ✓, bio-verified accounts show
   ◐-evidence; impersonation labels fail closed; X/Instagram/Facebook have documented
   platform-evidenced reasons (tokenless oEmbed removed 2020-10-24; IG Basic Display broken
   since 2024-12-04; Graph API needs App Access Token + Page Public Content Access review) and
   are manual-review links only — no API key is assumed.
9. **Forward-collected reporter scorecard** — `tools/build_intelligence.js` +
   `assets/js/intelligence.js`; one-player exact-name resolution; claims reconcile against
   the official NBA PDF (3 pts, authority) then against the ESPN structured board (1 pt,
   board postdates post within 72 h, both sighting time and ESPN's own stamp must postdate);
   conflicts review-only and never subtract; agreement is not accuracy; rendered as
   `#autoScorecard` on the dashboard and a full table on `reporters.html`.
10. **Verified-reporters subpage** — `reporters.html` / `assets/js/reporters.js`: every
    account carries the verbatim bio it was verified from, the re-checkable API URL, the
    Bluesky verification object status, recency (active/dormant/unmeasured, 30-day
    threshold), an in-arena 30-team coverage matrix, a verifier-drift & beat-change watch
    panel, the official club-channel probe table (26/30 still unverified; impersonation
    labels surfaced), and X-handle / Bluesky / outlet links for manual check.
11. **Official evidence links everywhere** — the dashboard, reporter page and sources page
    link to official.nba.com, ESPN injuries, ESPN scoreboard, Basketball Monster, Covers,
    RotoBaller, team NBA.com pages, X searches and Bluesky searches; the official NBA
    adapter is wired but the 2026-27 season page still answers 404 (re-verified XID
    72640245) so no PDF URL is guessed.
12. **Player history & injury recurrence** — `data/history/*.jsonl` (3 days retained in
    working tree, 30 days / 10,000 changes in the ledger); `firsts.json` for per-player
    first observations; forward-scoring ledger retains dated evidence per claim.

Site is the existing GitHub Pages site at
https://buffedlizard55-lab.github.io/NBAInjuryReport/ — deployed via `.github/workflows/pages.yml`
with both legacy-branch and workflow modes supported; `.nojekyll` present; injury-watch
collector runs on a 10-minute schedule and commits dated snapshots.

## Pass 2 — Bug / edge-case review

Checked each common failure mode:

- DOM wiring: every `getElementById` in every JS module resolves to an `id=` in one of the
  three shipped HTML pages (Node-scripted audit, see above).
- Stale-data guards: undated / stale / future-dated box-score production cannot resurrect a
  HIGH score (pinned by 6 impact_test assertions); future-dated injury listings do not
  count as recurrence; null/blank/boolean minutes are not coerced to zero.
- Alert eligibility: board changes judged by `observedAt`, not by ESPN's editorial stamp
  (which can be 40+ days old on re-listed items, pinned by regression_test "July-stamped"
  case); social posts judged by `ts` (post time) so resurfaced items cannot re-alert.
- Sound coalescing: 1.5 s burst guard prevents a cascade of chimes when many updates land
  at once.
- Synthetic test labels itself `TEST ONLY` on every delivery surface (notification title,
  alert log, chime) and never inserts into Wire or the evidence ledger.
- DNP ≠ in-game exit: `assets/js/ingame.js` explicitly sets `alertEligible:false` on DNP
  rows and `alertEligible:true` only on real Out/Doubtful/Questionable/Day-To-Day listings
  or "return"/"remainder"/"locker" language.
- Identity gating: unverified team accounts and refused reporter identities are visible in
  the feed but never sound an alert; only accounts with recorded evidence (bio or Bluesky
  verification) enter the alert path.
- Severity CSS: smoke tests pin every status class the modules emit against the stylesheet
  (sev-border-out/doubtful/questionable/probable/return/mention; pill ok/warn/bad/dim; tag
  ok/warn/gtd; good/bad/warn bare classes; post-head).
- Prose/measurement consistency: a registry-wide invariant fails if any reporter row's
  hand-written ACTIVITY sentence contradicts the machine-measured newest-post date; drift
  is surfaced as a warn-level badge, not a failed build.
- Negative-age arithmetic clamped to 0 in both copies; newest-post timestamps legitimately
  newer than the reference clock render as ACTIVE with an "ahead of clock" note.

No new defects were introduced in this session; every test passes.

## Pass 3 — Re-check against the original request

The brief had two NFL-worded sentences about "offensive players" and "NFL players during
NFL football games". The README and `FLAGS` log in `data.js` address this directly:
basketball has no offensive/defensive units, so the closest real concept is an
offensive-production tier (PRIMARY/SECONDARY/ROTATION/LIMITED measured from the player's
share of his team's scoring in collected games). PRIMARY-option alerts carry a
`[PRIMARY OFFENSIVE OPTION]` prefix; nothing is excluded, so the NFL-style reading of the
requirement is a strict subset of what ships. The site is NBA-only — no NFL code paths.

Every claim in the UI carries either (a) collected evidence with factors printed inline,
(b) a re-checkable source URL for manual review, or (c) an explicit "unknown / not
assessed / no free source" label. No fabricated data, no medical severity claims, no
guessed PDF URLs, no X API keys.

## Remaining work / limitations for the next session

These are real blockers and must be handled when the underlying facts change; nothing in
the codebase can remove them today:

1. **Official 2026-27 NBA injury report is still 404** (XID 72640245, re-read 2026-09-19).
   The adapter is wired and has a real PDF parser (229-row historical fixture in
   regression tests). The first moment the page returns 200 with linked PDFs the CI audit
   will fire CAPABILITY-DRIFT by design; that is the trigger to exercise discovery end to
   end on real data.
2. **No 2026-27 games exist yet.** Training camp opens 2026-09-22 (overseas) / 2026-09-29,
   preseason tips 2026-10-03, opening night 2026-10-20. Until box scores start flowing:
   - `roleStats` is empty by design → most board rows read IMPACT UNKNOWN (R4 rule, not a bug).
   - In-game QTR/exit latency is structurally tested but **empirically unvalidated** — the
     first preseason game is the first chance to measure publication → observation → alert
     times on real exits.
   - The forward-score ledger starts at zero corroborated/agreement points; all existing
     claims are pending because every captured post predates its board evidence.
3. **Three teams missing from ESPN's injuries feed in this snapshot (CLE, DET, LAL)** —
   named explicitly on the board with "NOT clearance" chips and per-team review links.
   Re-check at training camp; if they remain empty while games are live that is a
   source-coverage problem, not an offseason artifact.
4. **Three teams with dormant-only Bluesky writers (DAL, LAL, UTA)** and 12 teams still
   missing a Bluesky-verified in-arena writer (ATL, BKN, CHA, CHI, DEN, IND, MIA, NOP,
   ORL, SAC, SAS, UTA). CHA's paper of record eliminated its Hornets beat on 2026-09-14;
   UTA lost Andy Larsen to a "former Jazz beat writer" bio change (surfaced by verifier
   drift); identities cannot be invented.
5. **26 of 30 NBA franchises have no verified Bluesky club account** (41-handle probe
   re-run 2026-09-19 found exactly one real club channel: `nuggets.bsky.social`; 5
   candidate handles carry Bluesky's own `impersonation` label — kept visible, never
   polled).
6. **X / Instagram / Facebook remain manual-review links, permanently.** Re-verified with
   dated platform evidence (see sources.html); no free keyless read exists and no
   production key is assumed. The X embeds on the dashboard are eyeballs-only and never
   feed alerts.
7. **Closed-tab push delivery does not exist** — the alert engine requires an open browser
   tab. Browser throttling, source publication delays and 10-minute scheduled polling
   make "low latency" a best-effort property, not a guarantee; building seconds-level
   latency would need an always-on backend with durable storage.
8. **Travel model is city-centroid great-circle with a documented time model**, never
   charter-flight data — the UI labels every number "model". No free source publishes
   private-terminal logistics.

Next session's first priority, once preseason tips 2026-10-03: confirm `roleStats` starts
populating, that a starter OUT produces a ⚡ HIGH LINEUP IMPACT chime, and that the first
real in-game exit from a monitored writer produces an alert with the post link. Until then
all empirical latency and impact claims are correctly labelled unvalidated.
