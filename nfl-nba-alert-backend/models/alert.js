"use strict";

/* Status vocabulary is the brief's, not ESPN's.
 *   OUT_FOR_GAME            ruled out / will not return / carted off / ESPN status Out
 *   QUESTIONABLE_TO_RETURN  questionable, doubtful, being evaluated, day-to-day
 *   INJURY_REPORTED         injury mentioned, no designation yet
 * Doubtful has no slot in the brief, so it maps to QUESTIONABLE_TO_RETURN and the
 * verbatim text keeps the word "doubtful". Probable is not an alert.
 *
 * Cleared language is a hard stop. The 2026-09-25 Rapoport post
 * "Sam Darnold (glute) is off the injury report and will play" must not alert.
 */

const RANK = { INJURY_REPORTED: 1, QUESTIONABLE_TO_RETURN: 2, OUT_FOR_GAME: 3 };
const STALE_MS = 30 * 60 * 1000;
const DEDUP_MS = 5 * 60 * 1000;

const CLEARED_RE = /\b(off the injury report|will play|is playing|has been cleared|cleared to play|expected to play|will start|activated from|good news|upgraded to probable)\b/i;
const OUT_RE = /\b(ruled out|out for (?:the )?(?:game|season|year|sunday|monday|thursday|saturday)|out (?:on )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|tonight|today)|will not return|won'?t return|will not play|won'?t play|has been ruled out|carted off|carted to|left the game and (?:is|was) out)\b/i;
const OUT_SHORT_RE = /\bout\b/i;
const QTR_RE = /\b(questionable(?: to return)?|doubtful|game-time decision|day-to-day|being evaluated|to be evaluated|evaluated for|limited in)\b/i;
const INJURY_RE = /\b(injur\w*|hurt|carted|limping|headed (?:to|for) the locker|left the game|helped off|sprain|strain|torn|fracture|concussion)\b/i;
const NON_INJURY_RE = /\b(coach'?s decision|\brest\b|suspension|suspended|personal reason|ejected|not injury|out of bounds|out of the pocket|knocked out of|timeout|sold out|breakout|shoutout)\b/i;
const HISTORICAL_RETURN_RE = /\bwill return\b/i;

const POS_TOKEN = "(?:QB|RB|WR|TE|LB|CB|DB|DT|DE|DL|OL|OT|OG|K|P|FB|ILB|OLB|FS|SS|NT|MLB|EDGE|RG|LG|RT|LT|S|C|G|T)";
const POS_RE = new RegExp("\\b" + POS_TOKEN + "\\b", "i");
const NAME_RE = /\b([A-Z][a-zA-Z'’.-]+(?:\s+(?:[A-Z]\.)?[A-Z][a-zA-Z'’.-]+){1,2}(?:\s+(?:Jr\.|Sr\.|II|III|IV))?)\b/g;
const POS_NAME_RE = /\b(?:QB|RB|WR|TE|LB|CB|DB|DT|DE|DL|OL|OT|OG|K|P|FB|ILB|OLB|FS|SS|NT|MLB|EDGE|RG|LG|RT|LT|S|C|G|T)\s+([A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){0,2}(?:\s+(?:Jr\.|Sr\.|II|III|IV))?)/g;

const STOP = new Set(`
  nfl nba injury report reports reported week final updates update latest player players status
  fantasy weather coach head star good news sunday monday thursday friday saturday tuesday
  wednesday today tonight game games against versus from with have been has was were will
  this that they their both starting down back first look national insider espn athletic
  command commander's seahawks packers falcons ravens chiefs eagles bears bills
  ian rapoport field yates mina kimes
`.split(/\s+/).filter(Boolean));

function normalizePlayer(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function samePlayer(a, b) {
  const na = normalizePlayer(a).split(" ").filter(Boolean);
  const nb = normalizePlayer(b).split(" ").filter(Boolean);
  if (!na.length || !nb.length) return false;
  if (na.join(" ") === nb.join(" ")) return true;
  const la = na[na.length - 1];
  const lb = nb[nb.length - 1];
  if (la.length < 4 || la !== lb) return false;
  if (na.length > 1 && nb.length > 1) return na[0] === nb[0];
  return true;
}

function isStale(timestampSource, nowMs, maxMs) {
  const t = Date.parse(timestampSource || "");
  if (!Number.isFinite(t)) return true;
  const now = nowMs == null ? Date.now() : nowMs;
  const limit = maxMs == null ? STALE_MS : maxMs;
  if (t > now + 2 * 60 * 1000) return true;
  return now - t > limit;
}

function latencyMs(timestampSource, firstSeenMs) {
  const t = Date.parse(timestampSource || "");
  if (!Number.isFinite(t)) return null;
  return Math.max(0, firstSeenMs - t);
}

function statusFromText(text) {
  const t = String(text || "");
  if (!t.trim()) return null;
  const cleared = CLEARED_RE.test(t) && !OUT_RE.test(t);
  const historical = HISTORICAL_RETURN_RE.test(t) && /\bsince\b/i.test(t) && !OUT_RE.test(t) && !QTR_RE.test(t);
  if (cleared || historical) return null;
  if (NON_INJURY_RE.test(t) && !INJURY_RE.test(t) && !OUT_RE.test(t) && !QTR_RE.test(t)) return null;
  if (OUT_RE.test(t)) return "OUT_FOR_GAME";
  if (QTR_RE.test(t)) return "QUESTIONABLE_TO_RETURN";
  if (INJURY_RE.test(t)) return "INJURY_REPORTED";
  return null;
}

function statusFromEspn(status, comment) {
  const s = String(status || "").trim().toLowerCase();
  const blob = s + " " + String(comment || "");
  if (/probable/.test(s)) return null;
  if (/suspension/.test(s) && !INJURY_RE.test(blob)) return null;
  if (/^(out|injured reserve|ir|pup|reserve)$/.test(s) || /\bout\b/.test(s)) return "OUT_FOR_GAME";
  if (/questionable|doubtful|day-to-day|day to day/.test(s)) return "QUESTIONABLE_TO_RETURN";
  if (INJURY_RE.test(blob) || OUT_SHORT_RE.test(s)) return statusFromText(blob) || "INJURY_REPORTED";
  return null;
}

function windowAround(text, name, pad) {
  const src = String(text || "");
  const i = src.toLowerCase().indexOf(String(name || "").toLowerCase());
  if (i < 0) return src;
  const n = pad == null ? 90 : pad;
  return src.slice(Math.max(0, i - n), Math.min(src.length, i + String(name).length + n));
}

function cleanName(name) {
  return String(name || "").replace(new RegExp("^" + POS_TOKEN + "\\s+", "i"), "").replace(/\s+/g, " ").trim();
}

function looksLikeName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 1) return false;
  const last = parts[parts.length - 1].replace(/\.$/, "");
  if (STOP.has(last.toLowerCase())) return false;
  if (parts.length === 1) return last.length >= 4 && !STOP.has(last.toLowerCase());
  if (parts.some(p => STOP.has(p.toLowerCase().replace(/\.$/, "")))) return false;
  return true;
}

function extractNames(text) {
  const src = String(text || "");
  const found = [];
  const push = (name, kind) => {
    const n = cleanName(String(name || "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, ""));
    if (!looksLikeName(n)) return;
    if (new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+(told|said|says|shares|reports|reported|writes)\\b", "i").test(src)) return;
    if (found.some(f => samePlayer(f.name, n))) return;
    found.push({ name: n, kind });
  };
  let m;
  const pos = new RegExp(POS_NAME_RE.source, "g");
  while ((m = pos.exec(src))) push(m[1], "position");
  const plain = new RegExp(NAME_RE.source, "g");
  while ((m = plain.exec(src))) push(m[1], "plain");
  if (found.some(f => f.kind === "position")) {
    const pos = found.filter(f => f.kind === "position");
    const plain = found.filter(f => f.kind === "plain");
    const merged = pos.map(p => {
      const fuller = plain.find(q => samePlayer(q.name, p.name) && normalizePlayer(q.name).length > normalizePlayer(p.name).length);
      return fuller ? fuller.name : p.name;
    });
    for (const q of plain) {
      if (!merged.some(n => samePlayer(n, q.name))) merged.push(q.name);
    }
    return merged;
  }
  return found.map(f => f.name);
}

function alertsFromText(opts) {
  const text = String(opts.text || "");
  const statusFallback = opts.forceStatus || null;
  const names = (opts.names && opts.names.length) ? opts.names.slice() : extractNames(text);
  const out = [];
  for (const name of names) {
    const local = windowAround(text, name);
    let status = statusFromText(local);
    if (!status && statusFallback && names.length === 1) status = statusFallback;
    if (!status) continue;
    out.push({ player_name: name, status, verbatim_text: text.trim().slice(0, 500) });
  }
  return out;
}

function buildAlert(fields, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const timestamp_source = fields.timestamp_source || null;
  const timestamp_first_seen = new Date(now).toISOString();
  return {
    source: fields.source,
    sport: fields.sport,
    team: fields.team,
    player_name: fields.player_name,
    status: fields.status,
    timestamp_source,
    timestamp_first_seen,
    latency_ms: latencyMs(timestamp_source, now),
    verbatim_text: String(fields.verbatim_text || "").slice(0, 500),
    source_url: fields.source_url || null,
    verified: !!fields.verified,
    game_id: fields.game_id || null
  };
}

function shouldEmit(recentRows, candidate, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const rows = recentRows || [];
  const identity = rows.find(r =>
    candidate.source_url &&
    r.source_url === candidate.source_url &&
    samePlayer(r.player_name, candidate.player_name) &&
    r.status === candidate.status
  );
  if (identity) return { emit: false, reason: "same-source-post" };
  const windowRows = rows.filter(r =>
    r.sport === candidate.sport &&
    r.team === candidate.team &&
    samePlayer(r.player_name, candidate.player_name) &&
    now - Date.parse(r.timestamp_first_seen || r.created_at || 0) <= DEDUP_MS
  );
  if (!windowRows.length) return { emit: true, reason: "new" };
  const best = Math.max(...windowRows.map(r => RANK[r.status] || 0));
  if ((RANK[candidate.status] || 0) > best) return { emit: true, reason: "status-upgrade" };
  return { emit: false, reason: "dedup-5min" };
}

function crossCheck(candidates, priorVerified) {
  const list = candidates.slice();
  const keys = new Set();
  const add = (c) => keys.add(c.sport + "|" + c.team + "|" + normalizePlayer(c.player_name));
  for (const c of list) if (c.verified) add(c);
  for (const c of priorVerified || []) add(c);
  for (const c of list) {
    if (!c.verified && keys.has(c.sport + "|" + c.team + "|" + normalizePlayer(c.player_name))) {
      c.verified = true;
      c.verified_via = "cross-check";
    }
  }
  return list;
}

module.exports = {
  RANK, STALE_MS, DEDUP_MS, POS_RE,
  normalizePlayer, samePlayer, isStale, latencyMs,
  statusFromText, statusFromEspn, extractNames, alertsFromText,
  buildAlert, shouldEmit, crossCheck, windowAround
};
