#!/usr/bin/env node
"use strict";
/* Roster identity, injury-listing cadence, contract context and current-game role observations.
 *
 * These are OBSERVATIONS, not judgments: nothing here infers a rotation role from an injury, and
 * nothing here asserts medical severity. Every stored value comes from a field that was actually
 * read back from the endpoint named in `url` next to it.
 *
 * Source verified line-by-line on 2026-09-17 (see sources.html, `espn-roster-athlete-detail`):
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<abbr>/roster
 *   -> athletes[] carries {id, displayName, slug, position.abbreviation, experience.years,
 *      status.abbreviation, injuries[{status,date}], contracts[{salary,season{year}}], links[]}
 *   Example read back verbatim that day: Bam Adebayo (id 4066261) carried
 *      injuries:[{status:"Day-To-Day",date:"2026-07-28T16:16Z"}] and a 2027 contract of 49,500,000.
 *
 * Role accumulation: `roles` holds the CURRENT game's starter/bench flags from the box score;
 * `roleStats` aggregates those observations across runs (deduplicated per event id) so the site can
 * say "started 12 of the 14 games this project has collected" instead of guessing a role.
 */
const fs = require('fs'), path = require('path');
const ROOT = process.env.NBA_WATCH_OUT || path.join(__dirname, '..');
const REPO = path.join(__dirname, '..');
const { ENDPOINTS, TEAMS, standardAbbr, espnAbbr } = new Function(fs.readFileSync(path.join(REPO, 'assets/js/data.js'), 'utf8') + ';return {ENDPOINTS,TEAMS,standardAbbr,espnAbbr};')();
const dest = path.join(ROOT, 'data/live/context.json');
const read = p => { try { return JSON.parse(fs.readFileSync(p)); } catch { return {}; } };
const MAX_ROLE_EVENTS = 240;       // bounded: this file ships to a static site
const MAX_INJURY_ENTRIES = 8;      // per player
const STAT_MAX_AGE_MS = 120 * 86400000;  // drop role aggregates older than ~4 months (one season)

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  return res.json();
}

/* One row per player per game, straight from ESPN's summary box score. */
function roles(summary, eventId, observedAt) {
  const out = [];
  for (const side of summary.boxscore?.players || []) {
    for (const stat of side.statistics || []) for (const a of stat.athletes || []) {
      if (!a.athlete?.id || typeof a.starter !== 'boolean') continue;
      out.push({ playerId: String(a.athlete.id), player: a.athlete.displayName,
        team: standardAbbr(side.team?.abbreviation), eventId, observedAt,
        role: a.starter ? 'Starter in this game' : 'Bench in this game',
        didNotPlay: a.didNotPlay === true, minutes: a.stats?.[(stat.keys || []).indexOf('minutes')] ?? null,
        url: 'https://www.espn.com/nba/game/_/gameId/' + eventId });
    }
  }
  return out;
}

/* Accumulate role observations per player, never double-counting the same game. */
function accumulateRoleStats(prev, freshRows, now) {
  const stats = {};
  for (const [key, s] of Object.entries(prev?.roleStats || {})) {
    if (Date.parse(s.updatedAt || 0) > Date.now() - STAT_MAX_AGE_MS) stats[key] = { ...s };
  }
  const seen = new Set(prev?.roleEventIds || []);
  const eventIds = [...seen];
  for (const r of freshRows) {
    const key = String(r.playerId || r.player);
    const dedupeKey = key + ':' + r.eventId;
    if (seen.has(dedupeKey + ':v2')) continue;
    if (!stats[key]) stats[key] = { player: r.player, team: r.team, games: 0, starts: 0, minutesTotal: 0, minutesGames: 0, sampleUrls: [], firstObservedAt: now, updatedAt: now, keys: [] };
    const s = stats[key];
    s.keys = s.keys || [];
    if (s.keys.includes(dedupeKey + ':v2')) continue;
    s.keys.push(dedupeKey + ':v2');
    if (s.keys.length > 120) s.keys = s.keys.slice(-120);
    s.games++; s.starts += r.role && /Starter/.test(r.role) ? 1 : 0;
    const mins = Number(r.minutes);
    if (Number.isFinite(mins)) { s.minutesTotal += mins; s.minutesGames++; }
    s.updatedAt = now;
    s.team = r.team || s.team; s.player = r.player || s.player;
    s.sampleUrls = [...new Set([r.url, ...(s.sampleUrls || [])])].slice(0, 5);
    seen.add(dedupeKey + ':v2');
    if (!eventIds.includes(r.eventId)) eventIds.push(r.eventId);
  }
  return { roleStats: stats, roleEventIds: eventIds.slice(-MAX_ROLE_EVENTS) };
}

/* Roster capture: identity + injury-listing entries + contract context, each with its source URL. */
function rosterFrom(payload, team, url, now) {
  const players = [];
  for (const a of payload.athletes || []) {
    if (!a.id || !a.displayName) continue;
    const inj = Array.isArray(a.injuries) ? a.injuries
      .filter(e => e && (e.date || e.status))
      .slice(0, MAX_INJURY_ENTRIES)
      .map(e => ({ status: e.status || null, date: e.date || null, type: e.type || null, detail: e.detail || null })) : [];
    const seasonYear = payload.season?.year || null;
    const contracts = Array.isArray(a.contracts) ? a.contracts : [];
    const cur = (seasonYear && contracts.find(c => c?.season?.year === seasonYear)) || contracts[0] || null;
    const card = (a.links || []).filter(l => (l.rel || []).includes('playercard'))[0];
    players.push({
      playerId: String(a.id), player: a.displayName, team: team.abbr,
      slug: a.slug || null,
      position: a.position?.abbreviation || null,
      experienceYears: a.experience?.years ?? null,
      rosterStatus: a.status?.abbreviation || a.status?.name || null,
      injuryEntries: inj,
      salaryCurrent: typeof cur?.salary === 'number' ? cur.salary : null,
      salarySeason: cur?.season?.year ?? null,
      playerUrl: card?.href || (a.slug ? 'https://www.espn.com/nba/player/_/id/' + a.id + '/' + a.slug : null),
      rosterUrl: url
    });
  }
  if (!players.length) throw Error('Roster payload had no usable athletes');
  return { fetchedAt: now, url, players };
}

async function main() {
  const prev = read(dest), now = new Date().toISOString();
  const out = { checkedAt: now, schema: 2, rosters: prev.rosters || {}, roles: [], errors: {} };
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < TEAMS.length) {
      const team = TEAMS[cursor++];
      const cached = out.rosters[team.abbr];
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 3600000 && (cached.players || []).length && cached.players[0].rosterUrl !== undefined) continue;
      const url = ENDPOINTS.teams + '/' + espnAbbr(team.abbr) + '/roster';
      try {
        const d = await json(url);
        if (!Array.isArray(d.athletes) || !d.athletes.length) throw Error('Missing roster athletes');
        out.rosters[team.abbr] = rosterFrom(d, team, url, now);
      } catch (e) { out.errors[team.abbr] = e.message; }
    }
  }));
  try {
    const board = await json(ENDPOINTS.scoreboard);
    if (!Array.isArray(board.events)) throw Error('Missing events');
    for (const ev of board.events.filter(e => e.status?.type?.state === 'in' || e.competitions?.[0]?.status?.type?.state === 'in')) {
      try { out.roles.push(...roles(await json(ENDPOINTS.summary + ev.id), ev.id, now)); }
      catch (e) { out.errors['game-' + ev.id] = e.message; }
    }
  } catch (e) { out.errors.scoreboard = e.message; }
  const acc = accumulateRoleStats(prev, out.roles, now);
  out.roleStats = acc.roleStats;
  out.roleEventIds = acc.roleEventIds;
  out.roleNote = 'roleStats aggregates only box scores this project fetched; games:0 means "not collected", not "not a starter".';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  const agg = Object.keys(out.roleStats || {}).length;
  console.log('context:', Object.keys(out.rosters).length, 'rosters;', out.roles.length, 'current roles;', agg, 'aggregated role players;', Object.keys(out.errors).length, 'errors');
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { roles, accumulateRoleStats, rosterFrom };
