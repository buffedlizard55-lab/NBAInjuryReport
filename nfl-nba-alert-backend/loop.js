"use strict";

const espn = require("./collectors/espn");
const bsky = require("./collectors/bluesky");
const gnews = require("./collectors/google-news");
const masto = require("./collectors/mastodon");
const { fetchJson, fetchText, log } = require("./collectors/http");
const { selectForGames } = require("./models/reporters");
const { accept } = require("./dedup");

function windowHours() {
  const n = Number(process.env.GAME_WINDOW_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function inWindow(game, nowMs) {
  if (game.state === "in") return true;
  const hours = windowHours();
  if (!hours || !game.kickoff_time) return false;
  const kick = Date.parse(game.kickoff_time);
  if (!Number.isFinite(kick)) return false;
  const start = kick - hours * 60 * 60 * 1000;
  const end = kick + 5 * 60 * 60 * 1000;
  return nowMs >= start && nowMs <= end && game.state !== "post";
}

function createRuntime(store, deps) {
  const fetchJ = (deps && deps.fetchJson) || fetchJson;
  const fetchT = (deps && deps.fetchText) || fetchText;
  const rt = {
    store,
    startedAt: Date.now(),
    games: [],
    active: [],
    windowed: [],
    lastScoreboardAt: null,
    fetchJson: fetchJ,
    fetchText: fetchT
  };
  return rt;
}

async function mark(store, name, status, error) {
  try {
    await store.upsertHealth({
      collector_name: name,
      last_run: new Date().toISOString(),
      status,
      error_msg: error || null
    });
  } catch (e) {
    log(name, "health write failed " + (e && e.message));
  }
}

async function emit(store, name, candidates) {
  const result = await accept(store, candidates, Date.now());
  log(name, "candidates=" + candidates.length + " emitted=" + result.emitted.length + " skipped=" + result.skipped.length);
  return result;
}

async function refreshScoreboard(rt) {
  const all = [];
  const errors = [];
  for (const sport of ["nfl", "nba"]) {
    const res = await rt.fetchJson(espn.scoreboardUrl(sport), { timeoutMs: 15000 });
    if (!res.ok) {
      errors.push(sport + " " + (res.error || res.status));
      log("espn.scoreboard", sport + " FAIL " + res.ms + "ms " + (res.error || res.status));
      continue;
    }
    const games = espn.parseScoreboard(res.json, sport);
    log("espn.scoreboard", sport + " ok " + res.ms + "ms bytes=" + res.bytes + " games=" + games.length + " in=" + games.filter(g => g.state === "in").length);
    for (const g of games) {
      all.push(g);
      try { await rt.store.upsertGame(g); } catch (e) { errors.push("db " + e.message); }
    }
  }
  rt.games = all;
  rt.active = espn.activeGames(all);
  const now = Date.now();
  rt.windowed = all.filter(g => inWindow(g, now));
  rt.lastScoreboardAt = new Date().toISOString();
  await mark(rt.store, "espn-scoreboard", errors.length ? "error" : "ok", errors.join("; ") || null);
  return rt;
}

function targetGames(rt) {
  return rt.windowed && rt.windowed.length ? rt.windowed : rt.active;
}

function clubsOf(games) {
  const set = new Set();
  for (const g of games || []) for (const c of g.clubs || []) set.add(c);
  return [...set];
}

async function collectPlayByPlay(rt) {
  const games = rt.active || [];
  if (!games.length) {
    await mark(rt.store, "espn-pbp", "idle", null);
    return;
  }
  const errors = [];
  const candidates = [];
  for (const g of games) {
    const summary = await rt.fetchJson(espn.summaryUrl(g.sport, g.game_id), { timeoutMs: 15000 });
    if (summary.ok) {
      const plays = espn.iterPlays(summary.json);
      log("espn-pbp", g.sport + " " + g.game_id + " summary " + summary.ms + "ms plays=" + plays.length);
      candidates.push(...espn.alertsFromPlays(plays, g.sport, g, Date.now()));
      if (!plays.length) {
        const core = await rt.fetchJson(espn.playsUrl(g.sport, g.game_id), { timeoutMs: 15000 });
        if (core.ok) {
          const items = espn.corePlays(core.json);
          log("espn-pbp", g.sport + " " + g.game_id + " core " + core.ms + "ms plays=" + items.length);
          candidates.push(...espn.alertsFromPlays(items, g.sport, g, Date.now()));
        } else errors.push(g.game_id + " plays " + (core.error || core.status));
      }
    } else {
      errors.push(g.game_id + " summary " + (summary.error || summary.status));
      log("espn-pbp", g.game_id + " FAIL " + (summary.error || summary.status));
    }
  }
  await emit(rt.store, "espn-pbp", candidates);
  await mark(rt.store, "espn-pbp", errors.length ? "error" : "ok", errors.join("; ") || null);
}

async function collectInjuries(rt) {
  const games = targetGames(rt);
  if (!games.length) {
    await mark(rt.store, "espn-injuries", "idle", null);
    return;
  }
  const errors = [];
  const candidates = [];
  const bySport = {};
  for (const g of games) {
    if (!bySport[g.sport]) bySport[g.sport] = new Set();
    for (const c of g.clubs || []) bySport[g.sport].add(c);
  }
  for (const sport of Object.keys(bySport)) {
    const clubs = [...bySport[sport]].slice(0, 8);
    for (const club of clubs) {
      const res = await rt.fetchJson(espn.injuriesUrl(sport, club), { timeoutMs: 20000 });
      if (!res.ok) {
        errors.push(sport + " " + club + " " + (res.error || res.status));
        continue;
      }
      log("espn-injuries", sport + " " + club + " ok " + res.ms + "ms bytes=" + res.bytes + " espn_ts=" + (res.json && res.json.timestamp));
      const game = games.find(g => g.sport === sport && (g.clubs || []).indexOf(club) >= 0);
      candidates.push(...espn.alertsFromInjuries(res.json, sport, {
        nowMs: Date.now(),
        clubs: [club],
        game_id: game && game.game_id
      }));
    }
  }
  await emit(rt.store, "espn-injuries", candidates);
  await mark(rt.store, "espn-injuries", errors.length ? "error" : "ok", errors.join("; ") || null);
}

async function collectEspnNews(rt) {
  const games = targetGames(rt);
  if (!games.length) {
    await mark(rt.store, "espn-news", "idle", null);
    return;
  }
  const errors = [];
  const candidates = [];
  const sports = [...new Set(games.map(g => g.sport))];
  for (const sport of sports) {
    const res = await rt.fetchJson(espn.newsUrl(sport), { timeoutMs: 15000 });
    if (!res.ok) {
      errors.push(sport + " " + (res.error || res.status));
      continue;
    }
    const clubs = clubsOf(games.filter(g => g.sport === sport));
    log("espn-news", sport + " ok " + res.ms + "ms articles=" + ((res.json && res.json.articles) || []).length);
    candidates.push(...espn.alertsFromNews(res.json, sport, { nowMs: Date.now(), clubs }));
  }
  await emit(rt.store, "espn-news", candidates);
  await mark(rt.store, "espn-news", errors.length ? "error" : "ok", errors.join("; ") || null);
}

async function collectBluesky(rt) {
  const games = targetGames(rt);
  if (!games.length) {
    await mark(rt.store, "bluesky", "idle", null);
    return;
  }
  const sel = selectForGames(games, 16);
  const errors = [];
  const candidates = [];
  for (const account of sel.accounts) {
    const res = await rt.fetchJson(bsky.feedUrl(account.handle, 12), { timeoutMs: 12000 });
    if (!res.ok) {
      errors.push(account.handle + " " + (res.error || res.status));
      log("bluesky", account.handle + " FAIL " + (res.error || res.status));
      if (res.status === 429) break;
      continue;
    }
    const clubs = clubsOf(games.filter(g => g.sport === account.sport));
    const found = bsky.alertsFromFeed(res.json, account, { nowMs: Date.now(), clubs });
    log("bluesky", account.handle + " ok " + res.ms + "ms posts=" + ((res.json && res.json.feed) || []).length + " alerts=" + found.length);
    candidates.push(...found);
  }
  if (sel.truncated) errors.push("truncated " + sel.total + " accounts to 16");
  await emit(rt.store, "bluesky", candidates);
  await mark(rt.store, "bluesky", errors.length && !candidates.length ? "error" : "ok", errors.join("; ") || null);
}

async function collectGoogleNews(rt) {
  const games = targetGames(rt);
  if (!games.length) {
    await mark(rt.store, "google-news", "idle", null);
    return;
  }
  const errors = [];
  const candidates = [];
  const pairs = [];
  for (const g of games) for (const c of g.clubs || []) pairs.push({ sport: g.sport, team: c, game_id: g.game_id });
  const seen = new Set();
  const todo = [];
  for (const p of pairs) {
    const k = p.sport + p.team;
    if (seen.has(k)) continue;
    seen.add(k);
    todo.push(p);
  }
  for (const p of todo.slice(0, 8)) {
    const url = gnews.searchUrl(gnews.teamQuery(p.team, p.sport));
    const res = await rt.fetchText(url, { timeoutMs: 15000 });
    if (!res.ok) {
      errors.push(p.team + " " + (res.error || res.status));
      log("google-news", p.team + " FAIL " + (res.error || res.status));
      continue;
    }
    const items = gnews.parseRss(res.text);
    log("google-news", p.sport + " " + p.team + " ok " + res.ms + "ms items=" + items.length);
    candidates.push(...gnews.alertsFromItems(items, p.sport, {
      nowMs: Date.now(),
      team: p.team,
      clubs: [p.team],
      game_id: p.game_id
    }));
  }
  await emit(rt.store, "google-news", candidates);
  await mark(rt.store, "google-news", errors.length ? "error" : "ok", errors.join("; ") || null);
}

async function collectMastodon(rt) {
  const games = targetGames(rt);
  if (!games.length) {
    await mark(rt.store, "mastodon", "idle", null);
    return;
  }
  const errors = [];
  const candidates = [];
  const sports = [...new Set(games.map(g => g.sport))];
  for (const sport of sports) {
    const clubs = clubsOf(games.filter(g => g.sport === sport));
    for (const tag of masto.tagsFor(sport, clubs).slice(0, 3)) {
      const res = await rt.fetchJson(masto.tagUrl(tag, 20), { timeoutMs: 12000 });
      if (!res.ok) {
        errors.push(tag + " " + (res.error || res.status));
        log("mastodon", tag + " FAIL " + (res.error || res.status));
        continue;
      }
      const rows = Array.isArray(res.json) ? res.json : [];
      log("mastodon", tag + " ok " + res.ms + "ms statuses=" + rows.length);
      candidates.push(...masto.alertsFromStatuses(rows, sport, { nowMs: Date.now(), clubs }));
    }
  }
  await emit(rt.store, "mastodon", candidates);
  await mark(rt.store, "mastodon", errors.length ? "error" : "ok", errors.join("; ") || null);
}

function startLoop(rt) {
  const busy = {};
  const timers = [];
  const every = (ms, name, fn) => {
    const tick = async () => {
      if (busy[name]) return;
      busy[name] = true;
      try { await fn(); }
      catch (e) {
        log(name, "crash " + (e && e.stack || e));
        await mark(rt.store, name, "error", e && e.message);
      } finally { busy[name] = false; }
    };
    tick();
    timers.push(setInterval(tick, ms));
  };
  every(30 * 1000, "espn-scoreboard", async () => {
    await refreshScoreboard(rt);
  });
  every(5 * 1000, "espn-pbp", () => collectPlayByPlay(rt));
  every(20 * 1000, "espn-injuries", () => collectInjuries(rt));
  every(20 * 1000, "espn-news", () => collectEspnNews(rt));
  every(10 * 1000, "bluesky", () => collectBluesky(rt));
  every(20 * 1000, "google-news", () => collectGoogleNews(rt));
  every(30 * 1000, "mastodon", () => collectMastodon(rt));
  timers.push(setInterval(() => {
    rt.store.purgeOlderThan(30).catch(e => log("purge", e.message));
  }, 60 * 60 * 1000));
  return () => timers.forEach(clearInterval);
}

function snapshot(rt) {
  const games = rt.windowed || rt.active || [];
  return {
    as_of: new Date().toISOString(),
    last_scoreboard_at: rt.lastScoreboardAt,
    window_hours: windowHours(),
    active_games: (rt.active || []).map(publicGame),
    window_games: games.map(publicGame),
    clubs: clubsOf(rt.active && rt.active.length ? rt.active : games)
  };
}

function publicGame(g) {
  return {
    sport: g.sport,
    game_id: g.game_id,
    clubs: g.clubs,
    state: g.state,
    detail: g.detail,
    kickoff_time: g.kickoff_time,
    name: g.name
  };
}

module.exports = {
  createRuntime, startLoop, refreshScoreboard, snapshot, windowHours, inWindow,
  collectPlayByPlay, collectInjuries, collectEspnNews, collectBluesky, collectGoogleNews, collectMastodon
};
