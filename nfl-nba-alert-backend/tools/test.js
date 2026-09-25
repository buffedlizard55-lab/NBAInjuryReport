#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const espn = require("../collectors/espn");
const bsky = require("../collectors/bluesky");
const gnews = require("../collectors/google-news");
const masto = require("../collectors/mastodon");
const { statusFromText, shouldEmit, isStale } = require("../models/alert");
const { accept } = require("../dedup");
const { FileStore } = require("../db/file-store");
const { nflAccounts } = require("../models/reporters");
const { createServer } = require("../server");
const { collectPlayByPlay } = require("../loop");
const { createRuntime } = require("../loop");

const FIX = path.join(__dirname, "..", "fixtures");
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok  " + name);
  } catch (e) {
    console.error("FAIL " + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok  " + name);
  } catch (e) {
    console.error("FAIL " + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}

const NOW = Date.parse("2026-09-25T22:06:00Z");

check("scoreboard fixture: ATL @ GB is final, not active", () => {
  const games = espn.parseScoreboard(load("espn-scoreboard-atl-gb.json"), "nfl");
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].game_id, "401872948");
  assert.strictEqual(games[0].state, "post");
  assert.deepStrictEqual(games[0].clubs.slice().sort(), ["ATL", "GB"]);
  assert.strictEqual(games[0].team_ids["1"], "ATL");
  assert.strictEqual(games[0].team_ids["9"], "GB");
  assert.strictEqual(espn.activeGames(games).length, 0);
});

check("scoreboard: state=in is the only active gate", () => {
  const raw = load("espn-scoreboard-atl-gb.json");
  raw.events[0].competitions[0].status.type = { state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "Q2 8:11" };
  const games = espn.parseScoreboard(raw, "nfl");
  assert.strictEqual(espn.activeGames(games).length, 1);
  assert.strictEqual(games[0].detail, "Q2 8:11");
});

check("injury board fixture: Taylor-Demerson Out → OUT_FOR_GAME, ARI, verified", () => {
  const alerts = espn.alertsFromInjuries(load("espn-injury-ari.json"), "nfl", { nowMs: NOW, clubs: ["ARI"] });
  assert.strictEqual(alerts.length, 1);
  const a = alerts[0];
  assert.strictEqual(a.player_name, "Dadrion Taylor-Demerson");
  assert.strictEqual(a.team, "ARI");
  assert.strictEqual(a.status, "OUT_FOR_GAME");
  assert.strictEqual(a.source, "espn-injuries");
  assert.strictEqual(a.verified, true);
  assert.strictEqual(a.timestamp_source, "2026-09-25T21:56Z");
  assert.ok(a.source_url.includes("4428633"));
  assert.ok(a.latency_ms < 30 * 60 * 1000);
});

check("injury board: other clubs are ignored when a club filter is set", () => {
  const alerts = espn.alertsFromInjuries(load("espn-injury-ari.json"), "nfl", { nowMs: NOW, clubs: ["SEA"] });
  assert.strictEqual(alerts.length, 0);
});

check("injury board flat team payload: Charbonnet parsed", () => {
  const alerts = espn.alertsFromInjuries(load("espn-injury-sea-flat.json"), "nfl", { nowMs: NOW, clubs: ["SEA"] });
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].player_name, "Zach Charbonnet");
  assert.strictEqual(alerts[0].team, "SEA");
  assert.strictEqual(alerts[0].status, "OUT_FOR_GAME");
});

check("kickoff play fixture has no injury keyword → no alert", () => {
  const play = load("espn-play-kickoff.json");
  const game = espn.parseScoreboard(load("espn-scoreboard-atl-gb.json"), "nfl")[0];
  const alerts = espn.alertsFromPlays(espn.corePlays(play), "nfl", game, NOW);
  assert.strictEqual(alerts.length, 0);
});

check("classifier example (not a live play): evaluated → QUESTIONABLE_TO_RETURN", () => {
  const game = { game_id: "example", clubs: ["KC"], team_ids: {}, sport: "nfl" };
  const plays = [{
    id: "example-1",
    text: "Patrick Mahomes is being evaluated for a knee injury.",
    shortText: "Patrick Mahomes evaluated",
    wallclock: "2026-09-25T22:00:00Z",
    team: { abbreviation: "KC" }
  }];
  const alerts = espn.alertsFromPlays(plays, "nfl", game, NOW);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].source, "play-by-play");
  assert.strictEqual(alerts[0].player_name, "Patrick Mahomes");
  assert.strictEqual(alerts[0].status, "QUESTIONABLE_TO_RETURN");
  assert.strictEqual(alerts[0].team, "KC");
});

check("ESPN news fixture: Love and Okada out, Darnold not alerted", () => {
  const alerts = espn.alertsFromNews(load("espn-news-darnold.json"), "nfl", { nowMs: NOW, clubs: ["SEA", "WSH"] });
  const names = alerts.map(a => a.player_name).sort();
  assert.ok(!names.includes("Sam Darnold"), "cleared player must not alert: " + names.join(", "));
  assert.ok(names.includes("Julian Love"));
  assert.ok(names.includes("Ty Okada"));
  const love = alerts.find(a => a.player_name === "Julian Love");
  assert.strictEqual(love.status, "OUT_FOR_GAME");
  assert.strictEqual(love.team, "SEA");
  assert.strictEqual(love.verified, true);
  assert.strictEqual(love.source, "espn-news");
  const cosmi = alerts.find(a => /cosmi/i.test(a.player_name));
  assert.ok(cosmi, "Cosmi should parse from the Commanders headline");
  assert.strictEqual(cosmi.team, "WSH");
  assert.strictEqual(cosmi.status, "OUT_FOR_GAME");
});

check("Bluesky fixture: cleared and return posts drop, doubtful Nacua alerts as LAR", () => {
  const account = { handle: "rapsheet.bsky.social", sport: "nfl", team: null, bskyVerified: true, name: "Ian Rapoport" };
  const alerts = bsky.alertsFromFeed(load("bsky-rapsheet.json"), account, { nowMs: NOW });
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].player_name, "Puka Nacua");
  assert.strictEqual(alerts[0].status, "QUESTIONABLE_TO_RETURN");
  assert.strictEqual(alerts[0].team, "LAR");
  assert.strictEqual(alerts[0].source, "bluesky");
  assert.strictEqual(alerts[0].verified, true);
  assert.ok(alerts[0].source_url.includes("rapsheet.bsky.social"));
  assert.ok(alerts[0].verbatim_text.includes("doubtful"));
});

check("Bluesky reposts are not the author's alert", () => {
  const data = {
    feed: [{
      reason: { $type: "app.bsky.feed.defs#reasonRepost" },
      post: {
        uri: "at://did:example/app.bsky.feed.post/abc",
        author: { handle: "someone.else", verification: { verifiedStatus: "valid", verifications: [{ isValid: true }] } },
        record: { text: "WR Puka Nacua ruled out.", createdAt: "2026-09-25T22:00:00Z" }
      }
    }]
  };
  const alerts = bsky.alertsFromFeed(data, { handle: "rapsheet.bsky.social", sport: "nfl", bskyVerified: true }, { nowMs: NOW });
  assert.strictEqual(alerts.length, 0);
});

check("Google News RSS sample parses the observed Bosa item", () => {
  const xml = fs.readFileSync(path.join(FIX, "google-news-sample.xml"), "utf8");
  const items = gnews.parseRss(xml);
  assert.strictEqual(items.length, 2);
  assert.ok(items[0].title.includes("Nick Bosa"));
  assert.strictEqual(items[0].pubDate, "Fri, 25 Sep 2026 15:20:53 GMT");
  const alerts = gnews.alertsFromItems(items, "nfl", { nowMs: NOW });
  const bosa = alerts.find(a => a.player_name === "Nick Bosa");
  assert.ok(bosa);
  assert.strictEqual(bosa.team, "SF");
  assert.strictEqual(bosa.source, "google-news");
  assert.strictEqual(bosa.verified, false);
  assert.strictEqual(bosa.status, "INJURY_REPORTED");
});

check("Mastodon: twitter.com mirror is dropped; native injury text can alert", () => {
  const live = load("mastodon-nfl.json").statuses;
  assert.strictEqual(masto.isBlockedMirror(live[0]), true);
  assert.strictEqual(masto.alertsFromStatuses(live, "nfl", { nowMs: NOW, clubs: ["PIT", "GB"] }).length, 0);
  const synthetic = [{
    id: "local-example",
    created_at: "2026-09-25T22:05:00Z",
    url: "https://mastodon.social/@reporter/1",
    content: "<p>WR Puka Nacua ruled out for the Rams.</p>"
  }];
  const alerts = masto.alertsFromStatuses(synthetic, "nfl", { nowMs: NOW, clubs: ["LAR"] });
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].source, "mastodon");
  assert.strictEqual(alerts[0].verified, false);
  assert.strictEqual(alerts[0].status, "OUT_FOR_GAME");
  assert.strictEqual(alerts[0].team, "LAR");
});

check("cleared / historical sentences do not classify", () => {
  assert.strictEqual(statusFromText("Seahawks QB Sam Darnold (glute) is off the injury report and will play against the Commanders."), null);
  assert.strictEqual(statusFromText("Star DT Nnamdi Madubuike will return to the field for the first time since his neck injury."), null);
  assert.strictEqual(statusFromText("T.Smack kicks 59 yards from GB 35 to ATL 6."), null);
});

check("NFL allow-list excludes the impersonation-labelled Schefter handle", () => {
  const handles = nflAccounts().map(a => a.handle);
  assert.ok(handles.includes("rapsheet.bsky.social"));
  assert.ok(!handles.includes("adamschefter.bsky.social"));
  assert.ok(!handles.includes("ianrapoport.bsky.social"));
  assert.ok(handles.length >= 10);
  assert.ok(handles.length < 14, "do not pad the list to 14 — " + handles.length + " verified");
});

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
  const store = new FileStore(dir);
  const injury = espn.alertsFromInjuries(load("espn-injury-ari.json"), "nfl", { nowMs: NOW, clubs: ["ARI"] })[0];

  await checkAsync("dedup: same alert twice inserts once", async () => {
    const first = await accept(store, [injury], NOW);
    assert.strictEqual(first.emitted.length, 1);
    const second = await accept(store, [injury], NOW + 60 * 1000);
    assert.strictEqual(second.emitted.length, 0);
    assert.ok(second.skipped.some(s => s.reason === "dedup-5min" || s.reason === "same-source-post"));
  });

  await checkAsync("dedup: status upgrade inside 5 minutes emits", async () => {
    const reported = Object.assign({}, injury, {
      status: "INJURY_REPORTED",
      player_name: "Upgrade Example",
      source_url: "https://example.test/upgrade",
      timestamp_source: new Date(NOW).toISOString()
    });
    const out = Object.assign({}, reported, { status: "OUT_FOR_GAME", source_url: "https://example.test/upgrade-out" });
    const a = await accept(store, [reported], NOW);
    assert.strictEqual(a.emitted.length, 1);
    const b = await accept(store, [out], NOW + 60 * 1000);
    assert.strictEqual(b.emitted.length, 1);
    assert.strictEqual(b.emitted[0].status, "OUT_FOR_GAME");
  });

  await checkAsync("stale post older than 30 minutes is discarded", async () => {
    const stale = Object.assign({}, injury, {
      player_name: "Stale Example",
      timestamp_source: new Date(NOW - 31 * 60 * 1000).toISOString(),
      source_url: "https://example.test/stale"
    });
    assert.strictEqual(isStale(stale.timestamp_source, NOW), true);
    const result = await accept(store, [stale], NOW);
    assert.strictEqual(result.emitted.length, 0);
    assert.ok(result.skipped.some(s => s.reason === "stale"));
  });

  await checkAsync("shouldEmit is a pure function of recent rows", () => {
    const rows = [{ sport: "nfl", team: "KC", player_name: "Patrick Mahomes", status: "INJURY_REPORTED", timestamp_first_seen: new Date(NOW).toISOString(), source_url: "https://example.test/a" }];
    const same = shouldEmit(rows, Object.assign({}, rows[0]), NOW + 1000);
    assert.strictEqual(same.emit, false);
    const up = shouldEmit(rows, Object.assign({}, rows[0], { status: "OUT_FOR_GAME", source_url: "https://example.test/b" }), NOW + 1000);
    assert.strictEqual(up.emit, true);
    assert.strictEqual(up.reason, "status-upgrade");
  });

  await checkAsync("GET /api/alerts and /api/health return 200", async () => {
    const { server, runtime, store: s } = createServer({ store });
    runtime.active = [];
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const get = (p) => new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path: p }, res => {
        let body = "";
        res.on("data", c => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) }));
      }).on("error", reject);
    });
    const alerts = await get("/api/alerts?sport=nfl&team=ARI&limit=20");
    assert.strictEqual(alerts.status, 200);
    assert.ok(Array.isArray(alerts.json.alerts));
    assert.ok(alerts.json.alerts.some(a => a.player_name === "Dadrion Taylor-Demerson"));
    assert.ok(alerts.json.game_window);
    assert.ok(Array.isArray(alerts.json.collectors));
    assert.strictEqual(alerts.headers["access-control-allow-origin"], "*");
    const health = await get("/api/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(typeof health.json.uptime_seconds, "number");
    assert.ok(health.json.alerts_total >= 1);
    assert.ok(health.json.last_alert);
    assert.strictEqual(health.json.db_connection, "file");
    const page = await new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path: "/" }, res => {
        let body = "";
        res.on("data", c => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }).on("error", reject);
    });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes("/api/alerts"));
    server.close();
  });

  await checkAsync("play-by-play collector idles when no game is in progress", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-idle-"));
    const s2 = new FileStore(dir2);
    const rt = createRuntime(s2, { fetchJson: async () => { throw new Error("should not fetch"); } });
    rt.active = [];
    await collectPlayByPlay(rt);
    const health = await s2.listHealth();
    assert.strictEqual(health.find(h => h.collector_name === "espn-pbp").status, "idle");
  });

  await checkAsync("play-by-play collector fetches only the active game", async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-pbp-"));
    const s3 = new FileStore(dir3);
    const called = [];
    const rt = createRuntime(s3, {
      fetchJson: async (url) => {
        called.push(url);
        if (url.includes("/summary")) {
          return { ok: true, status: 200, ms: 10, bytes: 2, json: { drives: { previous: [] }, plays: [] } };
        }
        return { ok: true, status: 200, ms: 10, bytes: 2, json: { items: [] } };
      }
    });
    rt.active = [{ sport: "nfl", game_id: "401872948", clubs: ["ATL", "GB"], team_ids: { "1": "ATL", "9": "GB" }, state: "in" }];
    await collectPlayByPlay(rt);
    assert.ok(called.some(u => u.includes("401872948")));
    assert.ok(called.every(u => u.includes("401872948")));
    const health = await s3.listHealth();
    assert.strictEqual(health.find(h => h.collector_name === "espn-pbp").status, "ok");
  });

  if (process.exitCode) {
    console.error("\n" + passed + " passed, failures above");
    process.exit(process.exitCode);
  }
  console.log("\n" + passed + " passed");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
