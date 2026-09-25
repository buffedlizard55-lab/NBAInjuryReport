# NFL / NBA injury alert backend

A plain Node 18+ process. No npm dependencies, no build step, no paid API.

It watches free public feeds and writes injury alerts the existing GitHub Pages site can read. The Pages dashboard in the repository root is unchanged. `live-alerts.html` at the repository root polls this service every 2 seconds once you give it an origin.

This directory is the service. It is not a second GitHub repository. Render's `rootDir` is `nfl-nba-alert-backend`.

## What it does

Every 30 seconds it reads the keyless ESPN scoreboard for NFL and NBA. A game is active only when `competitions[0].status.type.state` is `in`. That field was read live on 2026-09-25 for Falcons at Packers (`STATUS_FINAL` / `post`).

While at least one game is `in`, collectors run on their own clocks:

| Collector | Interval | What it reads |
|---|---|---|
| ESPN play-by-play | 5 s | Game summary drives/plays, then the core plays feed if the summary has no play list |
| ESPN injuries | 20 s | `site.web.api.espn.com` injuries, `?team=` for each active club |
| ESPN news | 20 s | League news, athlete categories when present |
| Bluesky | 10 s | `getAuthorFeed` for verified accounts whose beat is an active club, plus nationals, capped at 16 |
| Google News RSS | 20 s | One query per active club, capped at 8 |
| Mastodon | 30 s | Public hashtag timelines on mastodon.social |

No game in `in` means those collectors record `idle` and do not insert. Set `GAME_WINDOW_HOURS` only if you also want the hours before kickoff. Posts older than 30 minutes are discarded either way.

Dedup is `(sport, team, player, status)` inside 5 minutes. A higher status (`INJURY_REPORTED` → `QUESTIONABLE_TO_RETURN` → `OUT_FOR_GAME`) is a new alert. The same source URL is never inserted twice.

## API

`GET /api/alerts?sport=nfl&team=KC&limit=20`

```json
{
  "alerts": [],
  "game_window": { "active_games": [], "clubs": [], "window_hours": 0 },
  "collectors": []
}
```

`GET /api/health`

```json
{
  "uptime_seconds": 0,
  "alerts_total": 0,
  "last_alert": null,
  "db_connection": "file"
}
```

`Access-Control-Allow-Origin` is `*` on GET so Pages can call a Render origin. Responses are `no-store`.

Alert `source` is `play-by-play`, `espn-injuries`, `espn-news`, `bluesky`, `google-news`, or `mastodon`. The brief named the first, third-from-last, and Google News. The other three are labeled as themselves so a structured ESPN row is not called a play.

`latency_ms` is `timestamp_first_seen - timestamp_source`. It is not network RTT, and it is not time-to-browser.

`verified` is true for ESPN structured fields and for a Bluesky account whose verification object was valid on the 2026-09-25 read (or, for NBA reporters, the evidence already recorded in `assets/js/data.js`). Google News and Mastodon stay unverified unless the same player and team was also seen from a verified source in the same batch.

## Run

```sh
cd nfl-nba-alert-backend
node tools/test.js
node server.js
```

Listens on `0.0.0.0:$PORT` (default 8787). `node server.js --no-loop` serves the API without collecting.

Without `SUPABASE_URL` and `SUPABASE_KEY` the database is `data/state.json`. That file is gitignored. It is not 30-day history you can share across restarts of a sleeping host — a new disk loses it. Supabase is the durable store.

## Supabase

1. Create a free project.
2. Paste `schema.sql` into the SQL editor and run it.
3. Set `SUPABASE_URL` to the project URL and `SUPABASE_KEY` to the **service role** key. The anon key can read (RLS policies are select-only) and cannot insert. Do not put the service role key in Pages or in this file.

The process deletes alerts older than 30 days. That is the retention the brief asked for. It is not a backfill of the last 30 days — history starts when the process starts inserting.

## Render

`render.yaml` is a free web service, health check `/api/health`, no build. Connect the GitHub repo and set the two Supabase variables. This workspace cannot create the Render account or the Supabase project. There is no `*.onrender.com` URL until you do that.

Free web services sleep after a period with no HTTP traffic. A sleeping process misses the injury. See `LIMITATIONS.md`.

## Sources that are actually polled

NFL Bluesky accounts are the ones that returned `verifiedStatus: valid` on 2026-09-25 and whose bio matched the journalist. Ten people plus the ESPN outlet account. Not 14. The rejected list, including the impersonation-labelled `adamschefter.bsky.social`, is in `models/nfl-reporters.json` and is not fetched.

NBA accounts come from `assets/js/data.js` when that file is present, otherwise from `models/nba-reporters.json` (74 feed-enabled reporters plus 4 official feeds, snapshotted from that file). During a game only the two clubs' beats and the national accounts are polled, and never more than 16 per tick.

## Tests

`node tools/test.js` is offline. It uses the fixtures in `fixtures/`, which are trimmed live responses from 2026-09-25, plus a few classifier strings that are marked as examples and are not claimed to be API payloads.

`node tools/live_probe.js` hits the network and writes `probe-output/latest.json`. Dispatch `.github/workflows/alert-backend-live.yml` from a runner that can open TLS. This sandbox cannot: the handshake to ESPN, Bluesky, Google News and Mastodon is reset. GitHub.com itself answers.

Measurements: `LATENCY_TEST.md`. Gaps: `LIMITATIONS.md`.
