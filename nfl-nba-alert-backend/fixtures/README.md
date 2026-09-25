# Fixtures

These files are subsets of responses read live on **2026-09-25** between 22:04Z and 22:08Z. Shell HTTPS from this workspace reset during the TLS handshake (`ECONNRESET` to ESPN, Bluesky, Google News and Mastodon). The reads were made with the page-fetch tool, which did reach the hosts. Fields the parsers do not use (logo arrays, video URLs, avatars) were removed so the repo stays small. Nothing in these files was invented to make a test pass.

`tools/live_probe.js` re-fetches the same URLs when the process has egress and writes timings next to these files. A unit-test string that is not in this directory is a classifier example, not a claimed API response.
