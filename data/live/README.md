# data/live — generated snapshots (do not hand-edit)

`latest.json` is written by `tools/poll_watch.js`, which runs in GitHub Actions
(`.github/workflows/injury-watch.yml`, every 10 minutes + manual dispatch).

It exists so the browser can read injury/social data **same-origin** — that path cannot be
blocked by CORS, which is why the dashboard falls back to it automatically.

Shape:

```json
{
  "generated": "ISO timestamp",
  "source": "github-actions-poller",
  "injuries": { "season": "2026-27", "rows": [ "…normalized board rows…" ], "blocks": 30 },
  "news": [ "…classified ESPN news items…" ],
  "posts": [ "…injury-relevant Bluesky posts from the verified allow-list…" ],
  "social": { "accounts": { "handle": { "ok": true, "count": 20 } } },
  "errors": { "…": "per-source failure message, never a fabricated value" }
}
```

The file is absent until the workflow runs for the first time. The dashboard handles that
(it says so in the UI instead of showing an empty panel as if it were real data).

## `reporter_verify.json` — identity re-verification evidence

Written by `tools/verify_reporters.js`, which runs in `.github/workflows/live-audit.yml`
(daily at 09:17 UTC, on registry changes, and on manual dispatch). It re-reads the evidence
behind every in-arena reporter row and every official club channel, keyless:

```json
{
  "generated": "ISO timestamp",
  "dormantThresholdDays": 30,
  "summary": { "checked": 0, "ok": 0, "bioDrift": 0, "dormant": 0, "missing": 0, "verificationLost": 0, "noQuote": 0, "fatal": 0 },
  "rows": [ { "handle": "…", "status": "ok|bio-drift|dormant|missing|verification-lost|no-quote", "fatal": false, "bio": "…", "latestPostAt": "…", "notes": ["…"] } ],
  "channels": [ { "abbr": "CLE", "url": "https://www.nba.com/cavaliers/news", "http": 200, "ok": true } ],
  "channelSummary": { "checked": 30, "ok": 30, "failed": [] }
}
```

Rules the file obeys, because a verification artifact that lies is worse than none:

- `missing` and `verification-lost` are **fatal** (the workflow exits 1). Everything else is
  recorded for review: a reporter changing outlets must be visible, not build-breaking.
- If the network is unavailable, the run prints `UNREACHABLE` and the existing file is preserved
  (only a `lastAttempt` note is added). A sandbox without egress must never erase real evidence.
- The page renders this file when it exists and says so when it does not — it never shows an
  empty panel that could read as "no problems found".
