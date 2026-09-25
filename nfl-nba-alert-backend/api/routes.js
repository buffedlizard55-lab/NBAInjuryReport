"use strict";

const { snapshot } = require("../loop");

function publicAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    sport: row.sport,
    team: row.team,
    player_name: row.player_name,
    status: row.status,
    timestamp_source: row.timestamp_source,
    timestamp_first_seen: row.timestamp_first_seen,
    latency_ms: row.latency_ms,
    verbatim_text: row.verbatim_text,
    source_url: row.source_url,
    verified: row.verified,
    game_id: row.game_id,
    created_at: row.created_at
  };
}

async function handle(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    res.end();
    return;
  }
  if (req.method !== "GET") {
    send(res, 405, { error: "method not allowed" });
    return;
  }
  if (url.pathname === "/api/health") {
    let db = ctx.store.kind;
    let dbOk = true;
    try { await ctx.store.ping(); }
    catch (e) { dbOk = false; db = "error: " + e.message; }
    const last = await ctx.store.lastAlert().catch(() => null);
    const total = await ctx.store.countAlerts().catch(() => null);
    send(res, 200, {
      uptime_seconds: Math.round((Date.now() - ctx.runtime.startedAt) / 1000),
      alerts_total: total,
      last_alert: publicAlert(last),
      db_connection: dbOk ? db : db
    });
    return;
  }
  if (url.pathname === "/api/alerts") {
    const sport = url.searchParams.get("sport");
    const team = url.searchParams.get("team");
    const limit = url.searchParams.get("limit") || "20";
    let alerts = [];
    let collectors = [];
    try {
      alerts = await ctx.store.queryAlerts({ sport, team, limit });
      collectors = await ctx.store.listHealth();
    } catch (e) {
      send(res, 500, { error: e.message, alerts: [], game_window: snapshot(ctx.runtime), collectors: [] });
      return;
    }
    send(res, 200, {
      alerts: alerts.map(publicAlert),
      game_window: snapshot(ctx.runtime),
      collectors
    });
    return;
  }
  send(res, 404, { error: "not found" });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store"
  };
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, Object.assign({ "content-type": "application/json; charset=utf-8" }, cors()));
  res.end(json);
}

module.exports = { handle, publicAlert };
