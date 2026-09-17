# data/history — append-only observation log (do not hand-edit)

Written by `tools/poll_watch.js` on every run:

- `YYYY-MM-DD.jsonl` — one JSON line per poll: the injury board rows seen, the injury-relevant
  social posts seen (with post timestamps), and the classified news items.
- `firsts.json` — the **earliest timestamp this project observed** each player's listing, plus an
  entry for every in-game-exit social post. This is the honest evidence trail for "who reported it
  first" — it is *our* observation time, not a claim about who posted first in the world.
- `index.json` — run counts per day.

Why this matters: X's historical search is paywalled and Bluesky keyword search returns 403
without auth, so a historical back-test cannot be bought for free. Forward collection with
timestamps is the honest alternative — and it is the only thing that can later justify a
"+3 first to report" score.
