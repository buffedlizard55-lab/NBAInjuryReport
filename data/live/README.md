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
