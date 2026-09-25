#!/usr/bin/env node
"use strict";

/* Live read of every free source. Writes timings to stdout and to
 * probe-output/latest.json. Does not insert alerts. Does not invent rows
 * when a host refuses the connection.
 *
 *   node tools/live_probe.js
 *   node tools/live_probe.js --write-fixtures   (overwrites fixtures/live-raw/ only)
 */

const fs = require("fs");
const path = require("path");
const { fetchJson, fetchText, log } = require("../collectors/http");
const espn = require("../collectors/espn");
const bsky = require("../collectors/bluesky");
const gnews = require("../collectors/google-news");
const masto = require("../collectors/mastodon");
const { nflAccounts } = require("../models/reporters");

const OUT = path.join(__dirname, "..", "probe-output");
const writeRaw = process.argv.includes("--write-fixtures");

async function time(name, fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { name, ok: true, ms: Date.now() - t0, value };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: e.message };
  }
}

function slim(obj, max) {
  const s = JSON.stringify(obj);
  if (s.length <= (max || 4000)) return obj;
  return { truncated: true, bytes: s.length, preview: s.slice(0, max || 4000) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const started = new Date().toISOString();
  const report = { started, host: process.env.GITHUB_SHA || null, sources: {} };

  for (const sport of ["nfl", "nba"]) {
    const row = await time(sport + "-scoreboard", () => fetchJson(espn.scoreboardUrl(sport), { timeoutMs: 20000 }));
    const res = row.value || {};
    const games = res.ok ? espn.parseScoreboard(res.json, sport) : [];
    const active = games.filter(g => g.state === "in");
    report.sources[sport + "-scoreboard"] = {
      ok: !!res.ok,
      http: res.status || 0,
      ms: res.ms || row.ms,
      bytes: res.bytes || 0,
      error: res.error || row.error || null,
      games: games.length,
      active: active.map(g => ({ game_id: g.game_id, clubs: g.clubs, detail: g.detail, kickoff_time: g.kickoff_time })),
      states: games.reduce((m, g) => { m[g.state] = (m[g.state] || 0) + 1; return m; }, {}),
      sample: games.slice(0, 4).map(g => ({ game_id: g.game_id, name: g.name, state: g.state, clubs: g.clubs, kickoff_time: g.kickoff_time, detail: g.detail }))
    };
    log("probe", sport + " scoreboard " + (res.ok ? "ok" : "FAIL") + " " + (res.ms || row.ms) + "ms active=" + active.length);
  }

  const inj = await time("nfl-injuries-sea", () => fetchJson(espn.injuriesUrl("nfl", "sea"), { timeoutMs: 25000 }));
  const injRes = inj.value || {};
  const injAlerts = injRes.ok ? espn.alertsFromInjuries(injRes.json, "nfl", { nowMs: Date.now(), clubs: ["SEA"] }) : [];
  report.sources["nfl-injuries-sea"] = {
    ok: !!injRes.ok,
    http: injRes.status || 0,
    ms: injRes.ms || inj.ms,
    bytes: injRes.bytes || 0,
    error: injRes.error || null,
    espn_timestamp: injRes.json && injRes.json.timestamp,
    parsed_alerts: injAlerts.length,
    sample: injAlerts.slice(0, 3).map(a => ({ player: a.player_name, status: a.status, timestamp_source: a.timestamp_source, latency_ms: a.latency_ms }))
  };

  const acct = nflAccounts().find(a => a.handle === "rapsheet.bsky.social");
  const feed = await time("bsky-rapsheet", () => fetchJson(bsky.feedUrl(acct.handle, 5), { timeoutMs: 15000 }));
  const feedRes = feed.value || {};
  const feedAlerts = feedRes.ok ? bsky.alertsFromFeed(feedRes.json, acct, { nowMs: Date.now() }) : [];
  report.sources["bsky-rapsheet"] = {
    ok: !!feedRes.ok,
    http: feedRes.status || 0,
    ms: feedRes.ms || feed.ms,
    bytes: feedRes.bytes || 0,
    error: feedRes.error || null,
    posts: feedRes.json && feedRes.json.feed ? feedRes.json.feed.length : 0,
    parsed_alerts: feedAlerts.length,
    sample_texts: ((feedRes.json && feedRes.json.feed) || []).slice(0, 3).map(i => (i.post && i.post.record && i.post.record.text) || "").map(t => t.slice(0, 180))
  };

  const rssUrl = gnews.searchUrl(gnews.teamQuery("SEA", "nfl"));
  const rss = await time("google-news-sea", () => fetchText(rssUrl, { timeoutMs: 15000 }));
  const rssRes = rss.value || {};
  const items = rssRes.ok ? gnews.parseRss(rssRes.text) : [];
  report.sources["google-news-sea"] = {
    ok: !!rssRes.ok,
    http: rssRes.status || 0,
    ms: rssRes.ms || rss.ms,
    bytes: rssRes.bytes || 0,
    error: rssRes.error || null,
    items: items.length,
    first: items[0] ? { title: items[0].title, pubDate: items[0].pubDate, link: items[0].link } : null
  };

  const tag = await time("mastodon-nflinjury", () => fetchJson(masto.tagUrl("nflinjury", 10), { timeoutMs: 15000 }));
  const tagRes = tag.value || {};
  const statuses = Array.isArray(tagRes.json) ? tagRes.json : [];
  report.sources["mastodon-nflinjury"] = {
    ok: !!tagRes.ok,
    http: tagRes.status || 0,
    ms: tagRes.ms || tag.ms,
    bytes: tagRes.bytes || 0,
    error: tagRes.error || null,
    statuses: statuses.length,
    mirrors_dropped: statuses.filter(masto.isBlockedMirror).length
  };

  const boards = ["nfl", "nba"].map(s => report.sources[s + "-scoreboard"]);
  const boardsOk = boards.every(s => s.ok);
  const activeCount = boards.reduce((n, s) => n + ((s.active || []).length), 0);
  report.finished = new Date().toISOString();
  report.active_games = boardsOk ? activeCount : null;
  report.in_game_latency_measured = false;
  report.note = !boardsOk
    ? "Scoreboard fetch failed. active_games is null because the document was not read, not because zero games were in progress."
    : activeCount
      ? "At least one game is state=in. parsed_alerts.latency_ms is source-timestamp to this probe, not browser delivery."
      : "Scoreboard was read and no event had state=in. In-game injury latency was not measured. Collector HTTP timings are fetch latency only.";

  const file = path.join(OUT, "latest.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  log("probe", "wrote " + file);

  if (writeRaw && injRes.ok) {
    const rawDir = path.join(__dirname, "..", "fixtures", "live-raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, "injuries-sea.json"), JSON.stringify(slim(injRes.json, 20000)));
  }

  const failed = Object.values(report.sources).filter(s => !s.ok);
  if (failed.length) process.exitCode = 2;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
