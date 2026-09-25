"use strict";

const { shouldEmit, isStale, crossCheck, STALE_MS } = require("./models/alert");

function prepare(candidates, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const fresh = [];
  const discarded = [];
  for (const c of candidates || []) {
    if (!c || !c.player_name || !c.team || !c.sport || !c.status) {
      discarded.push({ reason: "incomplete", player_name: c && c.player_name });
      continue;
    }
    if (isStale(c.timestamp_source, now, STALE_MS)) {
      discarded.push({ reason: "stale", player_name: c.player_name, timestamp_source: c.timestamp_source });
      continue;
    }
    fresh.push(c);
  }
  return { fresh: crossCheck(fresh), discarded };
}

async function accept(store, candidates, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const prepared = prepare(candidates, now);
  const emitted = [];
  const skipped = prepared.discarded.slice();
  for (const c of prepared.fresh) {
    const recent = await store.findRecent(c, now);
    const decision = shouldEmit(recent, c, now);
    if (!decision.emit) {
      skipped.push({ reason: decision.reason, player_name: c.player_name, status: c.status });
      continue;
    }
    const row = await store.insertAlert(c);
    emitted.push(row);
  }
  return { emitted, skipped };
}

module.exports = { prepare, accept };
