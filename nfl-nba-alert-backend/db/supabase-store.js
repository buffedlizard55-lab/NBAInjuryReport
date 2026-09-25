"use strict";

const { samePlayer } = require("../models/alert");

/* PostgREST only. No @supabase/supabase-js. The free project's anon or service
 * key goes in SUPABASE_KEY. schema.sql has to be applied once in the SQL editor.
 */

class SupabaseStore {
  constructor(opts) {
    this.url = String(opts.url || "").replace(/\/$/, "");
    this.key = opts.key;
    this.kind = "supabase";
  }

  _headers(extra) {
    return Object.assign({
      apikey: this.key,
      authorization: "Bearer " + this.key,
      "content-type": "application/json",
      accept: "application/json"
    }, extra || {});
  }

  async _req(method, table, query, body, prefer) {
    const url = this.url + "/rest/v1/" + table + (query ? "?" + query : "");
    const res = await fetch(url, {
      method,
      headers: this._headers(prefer ? { prefer } : {}),
      body: body == null ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch (e) { json = text; }
    }
    if (!res.ok) {
      const msg = (json && json.message) || text || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async ping() {
    await this._req("GET", "alerts", "select=id&limit=1");
    return { ok: true, kind: "supabase" };
  }

  async insertAlert(alert) {
    const rows = await this._req("POST", "alerts", "", {
      sport: alert.sport,
      team: alert.team,
      player_name: alert.player_name,
      status: alert.status,
      source: alert.source,
      timestamp_source: alert.timestamp_source,
      timestamp_first_seen: alert.timestamp_first_seen,
      latency_ms: alert.latency_ms,
      verbatim_text: alert.verbatim_text,
      source_url: alert.source_url,
      verified: alert.verified,
      game_id: alert.game_id
    }, "return=representation");
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async findRecent(candidate, nowMs) {
    const since = new Date((nowMs == null ? Date.now() : nowMs) - 5 * 60 * 1000).toISOString();
    const filters = [
      "sport=eq." + encodeURIComponent(candidate.sport),
      "team=eq." + encodeURIComponent(candidate.team),
      "timestamp_first_seen=gte." + encodeURIComponent(since),
      "select=*",
      "limit=50"
    ];
    let rows = await this._req("GET", "alerts", filters.join("&"));
    rows = Array.isArray(rows) ? rows : [];
    if (candidate.source_url) {
      const more = await this._req("GET", "alerts", "source_url=eq." + encodeURIComponent(candidate.source_url) + "&select=*");
      for (const r of (Array.isArray(more) ? more : [])) {
        if (!rows.some(x => x.id === r.id)) rows.push(r);
      }
    }
    return rows.filter(r => samePlayer(r.player_name, candidate.player_name));
  }

  async recentVerified(sinceMs) {
    const since = new Date(sinceMs).toISOString();
    const rows = await this._req("GET", "alerts", "verified=eq.true&timestamp_first_seen=gte." + encodeURIComponent(since) + "&select=*");
    return Array.isArray(rows) ? rows : [];
  }

  async queryAlerts(q) {
    const parts = ["select=*", "order=created_at.desc"];
    if (q.sport) parts.push("sport=eq." + encodeURIComponent(String(q.sport).toLowerCase()));
    if (q.team) parts.push("team=eq." + encodeURIComponent(String(q.team).toUpperCase()));
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    parts.push("limit=" + limit);
    const rows = await this._req("GET", "alerts", parts.join("&"));
    return Array.isArray(rows) ? rows : [];
  }

  async countAlerts() {
    const url = this.url + "/rest/v1/alerts?select=id";
    const res = await fetch(url, {
      method: "HEAD",
      headers: this._headers({ prefer: "count=exact", range: "0-0" })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const range = res.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  async lastAlert() {
    const rows = await this.queryAlerts({ limit: 1 });
    return rows[0] || null;
  }

  async upsertGame(game) {
    const rows = await this._req("POST", "games", "on_conflict=sport,game_id", {
      sport: game.sport,
      game_id: game.game_id,
      club_1: game.club_1,
      club_2: game.club_2,
      state: game.state,
      kickoff_time: game.kickoff_time,
      last_checked: new Date().toISOString()
    }, "resolution=merge-duplicates,return=representation");
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async listGames() {
    const rows = await this._req("GET", "games", "select=*&order=kickoff_time.desc&limit=80");
    return Array.isArray(rows) ? rows : [];
  }

  async upsertHealth(h) {
    const rows = await this._req("POST", "health_check", "on_conflict=collector_name", {
      collector_name: h.collector_name,
      last_run: h.last_run || new Date().toISOString(),
      status: h.status,
      error_msg: h.error_msg || null
    }, "resolution=merge-duplicates,return=representation");
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async listHealth() {
    const rows = await this._req("GET", "health_check", "select=*");
    return Array.isArray(rows) ? rows : [];
  }

  async purgeOlderThan(days) {
    const cut = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await this._req("DELETE", "alerts", "created_at=lt." + encodeURIComponent(cut));
    return null;
  }
}

module.exports = { SupabaseStore };
