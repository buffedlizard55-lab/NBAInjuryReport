# Limitations

These are gaps, not a backlog of things the code quietly does anyway.

## No in-game latency number yet

On 2026-09-25 at 22:05Z the ESPN NFL scoreboard's inspected game (Falcons at Packers, event `401872948`) was `state: "post"`, `STATUS_FINAL`. The NBA scoreboard's day field was `2026-10-03`, the next preseason date (Heat at Raptors, event `401902644`), not a live game. Nothing with `state: "in"` was observed. A `<60 second` claim for a live injury would be invented. It is not made. See `LATENCY_TEST.md`.

## This process was not deployed

Render and Supabase accounts were not created from this workspace. There is no `onrender.com` URL and no populated Supabase project. `render.yaml` and `schema.sql` are the deployment artifacts. Until someone applies them, the only running process is whatever host you start `node server.js` on, and its database is a local JSON file.

## Render free tier does not run 24/7

A free Render web service sleeps after roughly 15 minutes without an inbound HTTP request. The collector loop dies with the process. An injury that happens while it is asleep is invisible until the next request wakes it, and the cold start is itself longer than 60 seconds. Free instance hours are also capped for the month. A background worker is not on the free plan.

Pinging `/api/health` from outside can reduce sleep. That ping is another moving part, and it does not raise the monthly hour cap. GitHub Actions cron is the wrong tool for a 60-second target: the existing injury-watch workflow already documents that scheduled runs are delayed and disabled after inactivity.

## The "only while the game is in" gate misses the news that actually moved on 2026-09-25

The brief says injury detection runs only during active games, and posts older than 30 minutes are discarded. Both rules are implemented (`GAME_WINDOW_HOURS` defaults to 0).

The consequence is intentional and sharp. Ian Rapoport's Bluesky post at `2026-09-25T20:31:47Z` ("Sam Darnold … will play") and ESPN's news item at `2026-09-25T21:58:49Z` ("Julian Love and Ty Okada have been ruled out") are Friday designations. By Sunday kickoff they are older than 30 minutes, so they will not become in-game alerts, and on Friday there is no `state=in` game to attach them to. The service will not report them unless you set `GAME_WINDOW_HOURS` and the process is awake within 30 minutes of the source timestamp.

That is the right behavior for "someone just got carted off." It is the wrong behavior if you wanted Friday's injury report. The 10-minute GitHub Pages poller in the repository root is still the pregame board.

## Twitter / X is not a source

There is no free read API. The collector does not scrape X. Mastodon posts whose URL is `twitter.com` or `x.com` are dropped. On 2026-09-25 the public `#nfl` timeline on mastodon.social was mostly those mirrors (sportsbots.xyz → twitter.com). Dropping them means the Mastodon collector will often be empty. That is better than laundering a blocked source through a bot.

## Bluesky is an allow-list, not a search

`app.bsky.feed.searchPosts` was HTTP 403 without auth when this project measured it (recorded in `assets/js/social.js`). This service uses `getAuthorFeed` only.

Fourteen NFL insiders were requested. Ten journalist accounts plus `espn.com` had a valid verification object and a matching bio on 2026-09-25. The rest did not, and they are not polled:

- `adamschefter.bsky.social` carries Bluesky's impersonation label (applied 2023-09-29).
- `ianrapoport.bsky.social` is an empty placeholder. The account that posted on 2026-09-25 is `rapsheet.bsky.social`.
- `tompelissero.bsky.social` is active and has no verification object.
- `kevinclark.bsky.social` and `lindsayjones.bsky.social` are different people.
- `mikeflorio.bsky.social` says it is not Mike Florio.
- Russini, Fowler, Garafolo, Schultz, Graziano: no verified posting account found by `getProfiles` / typeahead.
- `theathletic.com` returned `verifiedStatus: invalid`.
- `nfl.com` did not resolve. `peterking.bsky.social` is not readable without auth.

NBA coverage is the existing registry (74 feed-enabled reporters). Many clubs have one or two Bluesky writers. That is not a full press box. Handles are not re-verified on every tick; identity evidence is the 2026-09-25 read plus `data.js`. A handle that later loses its verification object will still be polled until that file is updated.

The Bluesky tick caps at 16 accounts so a Sunday slate does not hammer the public API. If the beat-plus-national set is larger than 16, the rest are not fetched that tick.

## ESPN is unofficial, large, and sometimes cached

ESPN's site APIs are keyless and undocumented. They are not the NFL injury report and not the NBA's official PDF. A row can be wrong. The UI must not be read as a league designation.

The league injuries document is enormous because every athlete carries a logo array (the unfiltered NFL document was over a thousand page-fetch chunks on 2026-09-25). The collector uses `?team=`. That filter returned a flat row list for `team=sea`, but the payload's own `timestamp` was `2026-09-25T21:11:46Z` while the unfiltered document read a minute later said `2026-09-25T22:04:50Z`. The filtered URL can be staler than the full one. Polling it every 20 seconds does not create a fresher ESPN stamp.

Play-by-play text often has no injury keyword. The core plays feed for `401872948` (185 plays) started with a coin toss and a kickoff. An in-game injury that ESPN never writes into a play string will not be seen here. DNP reasons are not treated as play-by-play; the existing dashboard already records that a DNP is not an in-game exit.

`site.api.espn.com` has returned HTTP 403 to some clients while answering Node on the same runner (recorded in the repository audit). If this process is 403'd, health shows the error. It does not fall through to a guessed injury.

## Google News RSS is a personal feed, and it is slow

Google's RSS document says the feed is for a personal, non-commercial feed reader and that other use is prohibited. It is included because the brief required it. If that term is a problem for how you host this, unset the collector by not running the process, or delete the Google News tick before you deploy. The code does not strip the restriction away.

RSS items observed on 2026-09-25 were editorial roundups (`pubDate` 15:20Z, 20:33Z), not play-by-play. A 20-second poll of a feed that updates in minutes does not produce a 60-second injury alert. Items are unverified until an ESPN or Bluesky row names the same player.

## Player names from prose are incomplete

Structured ESPN athlete fields are used when they exist. Prose falls back to capitalized names and position prefixes (`WR Puka Nacua`). A sentence with no recoverable name produces no alert, on purpose. Two players who share a last name can collapse if only the last name was printed. "Will play", "off the injury report", and "will return … since his injury" are not alerts. Those rules were checked against the Rapoport posts fetched on 2026-09-25.

Doubtful is stored as `QUESTIONABLE_TO_RETURN` because the brief has no Doubtful status. The verbatim text still says doubtful.

## What this is not

- Not a push notification. Pages has to poll.
- Not closed-tab delivery.
- Not official NFL or NBA confirmation.
- Not a medical severity or lineup-impact model. That remains in `assets/js/role.js` for the NBA board.
- Not a 30-day history until the process has been inserting for 30 days.
- Not a measurement of broadcast-to-alert latency. No broadcast clock was compared.
