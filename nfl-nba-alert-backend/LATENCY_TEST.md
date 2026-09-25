# Latency test

**Window:** 2026-09-25, roughly 22:04Z–22:08Z.
**Result:** in-game injury latency was **not measured**. No ESPN event was in `state: "in"`. A number under 60 seconds is not claimed.

## Scoreboard

Read live (page fetch; shell TLS to these hosts was reset — see below):

| Source | URL | What came back |
|---|---|---|
| NFL scoreboard | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260924` | Event `401872948`, Atlanta Falcons at Green Bay Packers, kickoff `2026-09-25T00:15Z`. Status object: `name: STATUS_FINAL`, `state: post`, `completed: true`, `shortDetail: Final`. Abbreviations `ATL` and `GB` as returned. |
| NBA scoreboard | `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` | `day.date` `2026-10-03`. First event `401902644`, Miami Heat at Toronto Raptors, `2026-10-03T23:00Z`, preseason. Not in progress. |

Week 3 NFL games after that Thursday night game had not kicked off. The next NBA tip on that scoreboard is preseason, 2026-10-03.

## What was timed, and what was not

Shell `curl` and Node `fetch` from this workspace failed the TLS handshake to ESPN, Bluesky, Google News and Mastodon (`ECONNRESET` / unexpected EOF after ClientHello). `github.com` answered HTTP 200. So a local poll loop could not record fetch milliseconds against those hosts. The reads below used a page-fetch path that did reach them. That path does not return a reliable round-trip time, so those milliseconds are **not** published as latency.

`tools/live_probe.js` records `ms` around Node `fetch` when a host is reachable. Dispatch `.github/workflows/alert-backend-live.yml` and paste `probe-output/latest.json` under the table at the bottom. Until that artifact exists, the table stays empty on purpose.

## Source clocks that were on the documents

These are the publishers' timestamps, not our first-seen times. Without a running collector at that moment, `latency_ms` cannot be computed for them.

| Fact | Source timestamp | Where |
|---|---|---|
| NFL injuries document | `timestamp` `2026-09-25T22:04:50Z` | unfiltered `site.web.api.espn.com` NFL injuries |
| Dadrion Taylor-Demerson, Cardinals, status Out | `date` `2026-09-25T21:56Z` | first row of that document |
| Zach Charbonnet, Seahawks, status Out | `date` `2026-09-25T20:50Z`; document `timestamp` `2026-09-25T21:11:46Z` | `?team=sea`, which was behind the unfiltered document |
| ESPN news, Love and Okada ruled out | `published` `2026-09-25T21:58:49Z` | article `50029379` |
| ESPN news, Commanders out Sunday | `published` `2026-09-25T21:53:22Z` | article `50029122` |
| Rapoport, Darnold will play | `createdAt` `2026-09-25T20:31:47.119Z`, `indexedAt` `2026-09-25T20:31:47.360Z` | `getAuthorFeed` `rapsheet.bsky.social` |
| Rapoport, Nacua doubtful | `createdAt` `2026-09-25T18:13:29.256Z` | same feed |
| Google News, Bosa calf | `pubDate` `Fri, 25 Sep 2026 15:20:53 GMT` | RSS search `NFL injury when:1d` |
| Google News, Week 3 roundup | `pubDate` `Fri, 25 Sep 2026 20:33:00 GMT` | same RSS |
| Mastodon `#nfl` | `created_at` `2026-09-25T22:02:47Z` | status URL was `twitter.com`; collector drops it |

The only sub-second figure in that table is Bluesky's own index lag on the Darnold post: `indexedAt` minus `createdAt` is about **241 ms**. That is Bluesky indexing a post, not this service seeing it, and the post is a clearance, not an injury alert.

## Design bound, not a measurement

If the process is awake and a game is `in`:

- Play-by-play is polled every 5 seconds, plus one HTTP fetch.
- Bluesky accounts in the active set (at most 16) are polled every 10 seconds.
- News and the injury board every 20 seconds.
- Mastodon every 30 seconds.
- A post older than 30 minutes is dropped, so a late poll cannot "catch up" inside the alert rule.

Best case, a fresh play string could reach `/api/alerts` in one 5-second tick plus fetch time. That is a ceiling on the loop, not evidence from a game. Pages then polls every 2 seconds, which adds up to 2 seconds after the API has the row, if the tab is open and the browser is not throttling. None of that was timed against a broadcast.

## Next window that can actually be measured

1. Deploy the process somewhere TLS to ESPN works and the process stays up (Render free tier will not, unless something keeps it awake — see `LIMITATIONS.md`).
2. During a game whose scoreboard `state` is `in`, note the wall clock when a play or a reporter post first carries an injury designation. The source timestamp is on the row.
3. Poll `GET /api/alerts?sport=nfl&team=...` until that player appears.
4. Record `timestamp_source`, `timestamp_first_seen`, `latency_ms`, and the clock when the Pages tab rendered it.
5. Put the rows in the table below. Do not copy the design bound into that table.

## Probe results

| Ran at | Runner | Active games | NFL scoreboard | NBA scoreboard | Injuries | Bluesky | Google News | Mastodon |
|---|---|---|---|---|---|---|---|---|
| 2026-09-25T22:22:12Z | this sandbox | not read | 61 ms, ECONNRESET | 13 ms, ECONNRESET | 25 ms, ECONNRESET | 13 ms, ECONNRESET | 4 ms, ECONNRESET | 5 ms, ECONNRESET |

Those milliseconds are the time to a failed handshake, not a fetch of the document. They are not an injury latency. A later row belongs here only after `node tools/live_probe.js` exits 0.
