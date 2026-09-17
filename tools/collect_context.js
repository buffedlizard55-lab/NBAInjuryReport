#!/usr/bin/env node
"use strict";
// Roster identity and current-game role observations, not medical judgments.
const fs = require('fs'), path = require('path');
const ROOT = process.env.NBA_WATCH_OUT || path.join(__dirname, '..');
const { ENDPOINTS, TEAMS, standardAbbr } = new Function(fs.readFileSync(path.join(__dirname, '../assets/js/data.js'), 'utf8') + ';return {ENDPOINTS,TEAMS,standardAbbr};')();
const dest = path.join(ROOT, 'data/live/context.json');
const read = p => { try { return JSON.parse(fs.readFileSync(p)); } catch { return {}; } };
async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  return res.json();
}
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
async function main() {
  const prev = read(dest), now = new Date().toISOString();
  const out = { checkedAt: now, rosters: prev.rosters || {}, roles: [], errors: {} };
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < TEAMS.length) {
      const team = TEAMS[cursor++];
      const cached = out.rosters[team.abbr];
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 3600000) continue;
      const url = ENDPOINTS.teams + '/' + team.abbr.toLowerCase() + '/roster';
      try {
        const d = await json(url);
        if (!Array.isArray(d.athletes) || !d.athletes.length) throw Error('Missing roster athletes');
        out.rosters[team.abbr] = { fetchedAt: now, url,
          players: d.athletes.filter(a => a.id && a.displayName).map(a => ({ playerId: String(a.id), player: a.displayName, team: team.abbr })) };
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
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log('context:', Object.keys(out.rosters).length, 'rosters;', out.roles.length, 'current roles;', Object.keys(out.errors).length, 'errors');
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { roles };
