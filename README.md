# NBA Injury Alert System 🏀🔔

**Live site:** https://buffedlizard55-lab.github.io/NBAInjuryReport/

A free, working **injury alert notification system for all players on all 30 NBA teams**,
modeled on [Basketball Monster's player news](https://basketballmonster.com/playernews.aspx).
No accounts, no API keys — it runs entirely in the browser on GitHub Pages.

## What it does

| Feature | Where | How |
|---|---|---|
| 💬 Live injury wire (chat-like, newest first) | `index.html` | ESPN NBA news API, classified OUT / DOUBTFUL / QUESTIONABLE / PROBABLE / RETURN / MENTION |
| 🔔 Sound + browser-notification alerts | Alert center on `index.html` | Pleasant WebAudio chime (toggle + test button), Notification API, persisted alert log — every alert links its source |
| 📅 Live-game detection | Scoreboard card | ESPN scoreboard API; in-game alerts arm automatically once games tip |
| 🏟 Per-team cross-checks | Teams table | One click to ESPN team injuries, official NBA.com team site, X injury search |
| 📡 Social pulse | Dashboard embeds | Free X timeline embeds (no key) for verified league/insider accounts, with link fallbacks |
| 🧑‍💼 Verified reporter directory (36 rows) | `reporters.html` | Tiered insiders/beat writers; handles shown **only** when confirmed (25 verified); verification link per row |
| 🏆 Forward-tracking reliability scorecard | `reporters.html` | Log calls with post-URL evidence → points/accuracy/firsts leaderboard, JSON export/import |
| 📚 Line-by-line verification log | `sources.html` | 15 sources with evidence links, irregularity flags, limitations, roadmap |

## Verified sources (2026-09-17, evidence linked on `sources.html`)

- **ESPN NBA news/scoreboard/teams JSON APIs** — fetched live; power the wire + scoreboard. Unofficial/undocumented (ESPN retired its public API in 2014), no key needed.
- **Official NBA injury report** — https://official.nba.com/nba-injury-report-2025-26-season/ (deadline rules confirmed: 5pm local day-before, 11am–1pm gameday, 1pm back-to-backs).
- **Official NBA injury PDFs** — `ak-static.cms.nba.com/referee/injury/…` timestamped issues.
- **Basketball Monster player news** — reverse-engineered as the wire *format model* (no public API; link out, don't scrape).
- **ESPN injuries pages** — league + per-team (`/nba/team/injuries/_/name/{abbr}` pattern verified).
- **Covers.com + RotoBaller** — tertiary cross-checks. NBA.com team sites, NBA CDN JSON (fallback).

## Reporter directory highlights

- Tier 1: Shams Charania (ESPN), Chris Haynes (NBA on Prime), Marc Stein, Jake Fischer (Yahoo). **Wojnarowski retired Sept 2024 — excluded from live use.**
- Tier 2/3: 20+ national reporters + verified beat writers (Slater, McMenamin, MacMahon, Begley, Guillory, Winderman…), each with outlet, role, tier, handle status, and a verification link.
- Honest statuses: `handle verified` · `outlet verified, handle unverified (none asserted)` · `community-listed` · `inactive on X` · `retired`.

## Run locally

```bash
# any static server, e.g.
python3 -m http.server 8080
# open http://localhost:8080
```

## Key limitations (documented, not hidden)

1. **No free programmatic X/IG/FB read access** — automated social listening + historical back-testing need X API Basic (~$200/mo) or higher. The site ships embeds + search links + forward-tracking instead.
2. **ESPN endpoints are unofficial** — status indicators + official fallback links included.
3. **Severity is keyword-detected** — confirm via linked sources.
4. **Offseason (Sept 2026):** no games until preseason 2026-10-03; opening night 2026-10-20. In-game tracking arms automatically.
5. Alerts/scores live in browser localStorage (no server yet).

See `sources.html` → Roadmap for next sessions (server poller, PDF watcher, paid social tier, push alerts).

## Verification

- `sources.html` — full registry + flags + methodology + re-verification checklist
- `data/verified_sources.json` — machine-readable source registry
- `assets/js/data.js` — single source of truth for teams, reporters, sources, flags
