"use strict";

const fs = require("fs");
const path = require("path");
const { samePlayer, DEDUP_MS } = require("../models/alert");

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.kind = "file";
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
    this.state = this._load();
  }

  _load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, "utf8"));
      s.alerts = s.alerts || [];
      s.games = s.games || [];
      s.health = s.health || [];
      s.seq = s.seq || 1;
      return s;
    } catch (e) {
      return { alerts: [], games: [], health: [], seq: 1 };
    }
  }

  _save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  async ping() {
    return { ok: true, kind: "file" };
  }

  async insertAlert(alert) {
    const row = Object.assign({}, alert, {
      id: this.state.seq++,
      created_at: alert.timestamp_first_seen || new Date().toISOString()
    });
    this.state.alerts.push(row);
    this._save();
    return row;
  }

  async findRecent(candidate, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    return this.state.alerts.filter(r => {
      if (candidate.source_url && r.source_url === candidate.source_url && samePlayer(r.player_name, candidate.player_name)) return true;
      if (r.sport !== candidate.sport || r.team !== candidate.team) return false;
      if (!samePlayer(r.player_name, candidate.player_name)) return false;
      return now - Date.parse(r.timestamp_first_seen || r.created_at || 0) <= DEDUP_MS;
    });
  }

  async recentVerified(sinceMs) {
    return this.state.alerts.filter(r => r.verified && Date.parse(r.timestamp_first_seen || 0) >= sinceMs);
  }

  async queryAlerts(q) {
    let rows = this.state.alerts.slice();
    if (q.sport) rows = rows.filter(r => r.sport === String(q.sport).toLowerCase());
    if (q.team) rows = rows.filter(r => r.team === String(q.team).toUpperCase());
    rows.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    return rows.slice(0, limit);
  }

  async countAlerts() {
    return this.state.alerts.length;
  }

  async lastAlert() {
    const rows = this.state.alerts.slice().sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    return rows[0] || null;
  }

  async upsertGame(game) {
    const i = this.state.games.findIndex(g => g.sport === game.sport && g.game_id === game.game_id);
    const row = Object.assign({}, game, { last_checked: new Date().toISOString() });
    if (i >= 0) this.state.games[i] = Object.assign(this.state.games[i], row);
    else {
      row.id = this.state.seq++;
      this.state.games.push(row);
    }
    this._save();
    return row;
  }

  async listGames() {
    return this.state.games.slice();
  }

  async upsertHealth(h) {
    const i = this.state.health.findIndex(x => x.collector_name === h.collector_name);
    const row = {
      collector_name: h.collector_name,
      last_run: h.last_run || new Date().toISOString(),
      status: h.status,
      error_msg: h.error_msg || null
    };
    if (i >= 0) this.state.health[i] = Object.assign({ id: this.state.health[i].id }, row);
    else {
      row.id = this.state.seq++;
      this.state.health.push(row);
    }
    this._save();
    return row;
  }

  async listHealth() {
    return this.state.health.slice();
  }

  async purgeOlderThan(days) {
    const cut = Date.now() - days * 24 * 60 * 60 * 1000;
    const before = this.state.alerts.length;
    this.state.alerts = this.state.alerts.filter(r => Date.parse(r.created_at || 0) >= cut);
    this._save();
    return before - this.state.alerts.length;
  }
}

module.exports = { FileStore };
