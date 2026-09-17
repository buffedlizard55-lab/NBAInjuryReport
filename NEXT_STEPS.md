# Next steps, known gaps & limitations

Prioritized backlog for upcoming sessions. Live roadmap view: [sources.html](https://buffedlizard55-lab.github.io/NBAInjuryReport/sources.html) → Roadmap.
Everything below is stated honestly — no claimed capability without a verified source behind it.

## ✅ Validated working today (2026-09-17, re-verified this session)

| Capability | Status | Evidence |
|---|---|---|
| Live injury wire (chat-like, newest first) | Working on deployed site | ESPN news API returned 50 articles to the live page; wire shows real item (Mark Williams OUT, shoulder) that cross-matches Basketball Monster |
| Sound alert (pleasant chime) + on/off toggle + test button | Working (code-reviewed, browser APIs standard) | `assets/js/alerts.js` |
| Browser notifications + persisted alert log with review links | Working | same |
| Live-game scoreboard | Working (ESPN), failover added (NBA.com CDN, untested) | `assets/js/app.js` |
| In-game injury monitor (DNP-with-injury-reason detection) | **Structure-verified, NOT live-tested** | payload basis: ESPN summary API, completed game 401811041 |
| Verified reporter directory (36 rows, 25 verified handles) | Re-verified selectively | BM/ESPN citations today: ShamsCharania, JakeLFischer, WillGuillory, IraHeatBeat, MacMahon, Stein, K.C. Johnson, Winderman, Reynolds, Scotto, C. Clark |
| Forward-tracking reliability scorecard | Working (localStorage) | `reporters.html` |
| GitHub Pages deployment | Built & serving | https://buffedlizard55-lab.github.io/NBAInjuryReport/ (status: built) |

## ⛔ Hard limitations (blockers — cannot be solved for free)

1. **No free programmatic X/Instagram/Facebook read access.** The requested "scan reporters' posts automatically + historical back-testing of injury accuracy" is not possible free of charge. X reads start at ~$200/mo (Basic); historical search is paywalled higher. IG/FB have no free public post APIs at all. *What we ship instead:* X embeds, one-click searches, verified directory, manual forward-scoring with evidence URLs, JSON export/import.
2. **No free feed carries structured "questionable to return" (QTR) in-game data.** ESPN's summary API exposes DNP + reason (verified) but not a live QTR designation. QTR alerts therefore arrive via the ESPN news layer (minutes of latency) or a beat writer's post (manual review link). This is a data-availability limit, not a code limit.
3. **ESPN endpoints are unofficial/undocumented** (public API retired 2014). They work today; they can break without notice. Mitigations in place: dual-source scoreboard failover, status indicators, cached "last good" wire, official manual links everywhere.
4. **In-game monitor is untested against real live games** — the NBA is in the offseason; structure was verified against a completed game's payload. Must be validated at the 2026-10-03 preseason tip (top priority next session).
5. **State is browser-local** (localStorage). No cross-device sync, no alerting while the tab is closed, no shared reporter scorecard.

## 🗺 Prioritized backlog

### P0 — must do at season start (2026-10-03)
- **Live-validate the in-game monitor** against real preseason games; fix `assets/js/ingame.js` extraction if ESPN's live summary shape differs. *(Est: 1 session)*
- **Force-test the NBA.com CDN failover** once from a real browser (block site.api.espn.com in devtools). Keep or remove based on result.
- **Swap in the 2026-27 official injury report URL** when official.nba.com rolls it over (expected ~Oct 2026); update README + sources registry + quick links.

### P1 — high value, feasible free
- **Server-side history poller (GitHub Actions cron, free):** snapshot ESPN news/scoreboard/summaries every 1–2 min during game windows into `data/history/*.json`. Unlocks: true "first-to-report" timestamps (needed for the +3 scoring tier), shared alert history, no-localStorage dependency, and a data trail for auditing reporter accuracy later.
- **Beat-writer completion:** one verified in-arena writer per team × 30 (same line-by-line standard as the existing 36 rows). Pipeline started: DAL/LAL/GSW/MIA/CHI/NYK/BKN/NOP covered.
- **Official PDF watcher:** poll the official.nba.com season page for newly issued injury-report PDFs; alert on new issues (highest-authority designation source).
- **Notification center polish:** per-severity sound choices, quiet hours, "only starters" toggle once roster data exists.

### P2 — worth doing, needs design
- **Roster/rotation layer:** ESPN **verified** team-roster links exist (seen in today’s verification: `/nba/team/roster/_/name/mia`) — weight alerts by rotation relevance (starters vs two-ways).
- **Wire quality:** player-name extraction per item (first-class player field instead of headline parsing), dedupe cross-source repeats, fantasy-noise suppression during offseason.
- **Scorecard semantics:** define "first" rigorously — needs the P1 history poller's timestamps to be fair.

### P3 — paid/optional
- **X API Basic** filtered stream on the Tier-1/2 handle list → automated social alerts + historical backfill for real accuracy scores. (~$200/mo — budget decision required.)
- **balldontlie ALL-ACCESS** injury webhooks — proper low-latency official-ish push (paid only; free tier has NO injuries).
- **Web Push / Discord / email relay** for alerts when the tab is closed.

## 🔁 Standing rule for every session
Re-run the line-by-line verification (sources.html checklist) before adding features; every new claim must carry an evidence link; flag irregularities in `FLAGS` instead of working around them silently.
