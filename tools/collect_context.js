#!/usr/bin/env node
"use strict";
/* Roster identity, injury-listing cadence, contract context, current-game role observations,
 * box-score PRODUCTION history and the published SCHEDULE each team still has to play.
 *
 * These are OBSERVATIONS, not judgments: nothing here infers a rotation role from an injury, and
 * nothing here asserts medical severity. Every stored value comes from a field that was actually
 * read back from the endpoint named in `url` next to it.
 *
 * Sources verified line-by-line (see sources.html for the registry rows):
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<abbr>/roster   `espn-roster-athlete-detail`
 *   -> athletes[] carries {id, displayName, slug, position.abbreviation, experience.years,
 *      status.abbreviation, injuries[{status,date}], contracts[{salary,season{year}}], links[]}
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=<id>      `espn-summary-api`
 *   -> boxscore.players[].statistics[] carries names/keys/labels plus athletes[]{athlete,starter,
 *      didNotPlay,reason,ejected,stats[]}. Keys re-read VERBATIM 2026-09-18 on event 401811041 (ORL@BOS):
 *        ["minutes","points","fieldGoalsMade-fieldGoalsAttempted","threePointFieldGoalsMade-threePointFieldGoalsAttempted",
 *         "freeThrowsMade-freeThrowsAttempted","rebounds","assists","turnovers","steals","blocks",
 *         "offensiveRebounds","defensiveRebounds","fouls","plusMinus"]
 *      with labels ["MIN","PTS","FG","3PT","FT","REB","AST","TO","STL","BLK","OREB","DREB","PF","+/-"] and the
 *      label description for plusMinus reading "Teams net points while player is on the court."
 *      Example row read back that day: Luka Garza ["38","27","10-18","3-6","4-4","12","1","2","1","0","4","8","4","+13"].
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<abbr>/schedule   `espn-team-schedule-api`
 *   -> events[]{id, date, shortName, competitions[0]{date, venue{fullName, address{city,state}},
 *      competitors[]{homeAway, team{abbreviation}}, status{type{state, completed}}}}
 *      Observed 2026-09-18 on teams/mia/schedule: season 2026-27 Preseason, first event 401902644
 *      on 2026-10-03T23:00Z "MIA @ TOR" at Videotron Centre, Quebec City.
 *
 * Role accumulation: `roles` holds the CURRENT game's starter/bench flags from the box score;
 * `roleStats` aggregates those observations across runs (deduplicated per event id) so the site can
 * say "started 12 of the 14 games this project has collected" instead of guessing a role — and now
 * also carries the offensive production and the on-court plusMinus those same box scores published,
 * because "how much of this team's offense does the absence remove" cannot be answered by minutes alone.
 */
const fs = require('fs'), path = require('path');
const ROOT = process.env.NBA_WATCH_OUT || path.join(__dirname, '..');
const REPO = path.join(__dirname, '..');
const Geo = require(path.join(REPO, 'assets/js/geo.js'));
const { ENDPOINTS, TEAMS, standardAbbr, espnAbbr } = new Function(fs.readFileSync(path.join(REPO, 'assets/js/data.js'), 'utf8') + ';return {ENDPOINTS,TEAMS,standardAbbr,espnAbbr};')();
const dest = path.join(ROOT, 'data/live/context.json');
const read = p => { try { return JSON.parse(fs.readFileSync(p)); } catch { return {}; } };
const MAX_ROLE_EVENTS = 1500;      // a full 1,230-game season fits, so per-game dedupe never expires mid-season
const MAX_INJURY_ENTRIES = 8;      // per player
const STAT_MAX_AGE_MS = 120 * 86400000;  // drop role aggregates older than ~4 months (one season)
const BACKFILL_PER_RUN = 12;       // summaries of already-finished games fetched per run (bounded download)
const UPCOMING_GAMES_KEPT = 7;     // future games stored per team for the travel/load model
const ROSTER_CACHE_MS = 24 * 3600000;
const SCHEDULE_CACHE_MS = 6 * 3600000;

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  return res.json();
}

/* ---- box-score stat line: keyed lookup, so a reordered or extended key list cannot silently
 * shift every number into the wrong column (the failure mode positional parsing would produce). ---- */
function numFromStat(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '-' || s === '--') return null;
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*-\s*(\d+))?$/);   // "27", "+13", "10-18" (made-attempted)
  if (m) return Number(m[1]);
  return null;
}
function parseStatLine(keys, values) {
  const out = {};
  if (!Array.isArray(keys) || !Array.isArray(values)) return out;
  for (let i = 0; i < keys.length; i++) {
    const v = numFromStat(values[i]);
    if (v == null) continue;
    out[keys[i]] = v;
  }
  return out;
}

/* One row per player per game, straight from ESPN's summary box score. */
function roles(summary, eventId, observedAt) {
  const out = [];
  for (const side of summary.boxscore?.players || []) {
    const team = standardAbbr(side.team?.abbreviation);
    for (const stat of side.statistics || []) for (const a of stat.athletes || []) {
      if (!a.athlete?.id || typeof a.starter !== 'boolean') continue;
      const line = parseStatLine(stat.keys, a.stats);
      out.push({
        playerId: String(a.athlete.id), player: a.athlete.displayName,
        team, eventId, observedAt,
        role: a.starter ? 'Starter in this game' : 'Bench in this game',
        didNotPlay: a.didNotPlay === true,
        minutes: (a.stats || [])[(stat.keys || []).indexOf('minutes')] ?? null,
        /* production + on-court net, taken verbatim from the same box score that supplies minutes */
        points: line.points ?? null, assists: line.assists ?? null, rebounds: line.rebounds ?? null,
        plusMinus: line.plusMinus ?? null,
        fga: line['fieldGoalsMade-fieldGoalsAttempted'] ?? null,
        fta: line['freeThrowsMade-freeThrowsAttempted'] ?? null,
        turnovers: line.turnovers ?? null,
        url: 'https://www.espn.com/nba/game/_/gameId/' + eventId
      });
    }
  }
  return out;
}

/* Which team won the game's stat line — needed for the opponent and for the team production
 * baseline. Derived from the competitor list, never assumed from array order. */
function compTeams(summary, eventId) {
  const players = summary?.boxscore?.players || [];
  const sides = summary?.header?.competitions?.[0]?.competitors || [];
  const byTeam = {};
  for (const s of sides) byTeam[standardAbbr(s.team?.abbreviation)] = s.homeAway;
  return { sides: players.map(s => standardAbbr(s.team?.abbreviation)), homeAway: byTeam, eventId };
}

/* Accumulate per-player production AND per-team production, never double-counting a game.
 * Dedupe is by EVENT ID against the persisted list: one game contributes once, and a full
 * season of event ids is retained (MAX_ROLE_EVENTS) so re-collection cannot inflate a role. */
function accumulateRoleStats(prev, freshRows, now) {
  const stats = {};
  for (const [key, s] of Object.entries(prev?.roleStats || {})) {
    if (Date.parse(s.updatedAt || 0) > Date.now() - STAT_MAX_AGE_MS) stats[key] = { ...s };
  }
  const teamStats = {};
  for (const [key, s] of Object.entries(prev?.teamStats || {})) {
    if (Date.parse(s.updatedAt || 0) > Date.now() - STAT_MAX_AGE_MS) teamStats[key] = { ...s };
  }
  const seen = new Set(prev?.roleEventIds || []);
  const eventIds = [...seen];
  const playedEvents = new Set();
  for (const r of freshRows) {
    if (seen.has(r.eventId)) continue;              // this game was already folded in on an earlier run
    playedEvents.add(r.eventId);
    const key = String(r.playerId || r.player);
    if (!stats[key]) stats[key] = { player: r.player, team: r.team, games: 0, starts: 0, minutesTotal: 0, minutesGames: 0, sampleUrls: [], firstObservedAt: now, updatedAt: now };
    const s = stats[key];
    s.games++; s.starts += r.role && /Starter/.test(r.role) ? 1 : 0;
    const mins = Number(r.minutes);
    /* Per-game values are kept (bounded, most recent) so role.js can quote a MEDIAN next to the
     * mean — a blowout-heavy or injury-shortened sample swings the mean while the median barely
     * moves, and the UI is supposed to say so instead of pretending the average is settled. */
    if (Number.isFinite(mins) && r.didNotPlay !== true) {
      s.minutesTotal += mins; s.minutesGames++;
      s.minutesValues = (s.minutesValues || []).concat([mins]).slice(-40);
      /* production is only averaged over games actually played — a DNP row carries no stat line */
      for (const [field, src] of [['points', 'points'], ['assists', 'assists'], ['rebounds', 'rebounds'], ['plusMinus', 'plusMinus']]) {
        if (Number.isFinite(r[src])) {
          s[field + 'Total'] = (s[field + 'Total'] || 0) + r[src];
          s[field + 'Games'] = (s[field + 'Games'] || 0) + 1;
        }
      }
    }
    s.updatedAt = now;
    s.team = r.team || s.team; s.player = r.player || s.player;
    s.sampleUrls = [...new Set([r.url, ...(s.sampleUrls || [])])].slice(0, 5);
    if (!eventIds.includes(r.eventId)) eventIds.push(r.eventId);
  }
  /* team production baseline: sum the points of every box-score row on the same team in the same
   * game, once per event — this is what makes "share of the team's offense" a measured number
   * instead of a league-average assumption. */
  const perEventTeam = new Map();
  for (const r of freshRows) {
    if (seen.has(r.eventId) || !Number.isFinite(r.points)) continue;
    const k = r.eventId + '|' + r.team;
    perEventTeam.set(k, (perEventTeam.get(k) || 0) + r.points);
  }
  for (const [k, pts] of perEventTeam) {
    const [eventId, team] = k.split('|');
    if (!team) continue;
    const t = teamStats[team] || (teamStats[team] = { team, games: 0, pointsTotal: 0, updatedAt: now, sampleUrls: [] });
    t.games++; t.pointsTotal += pts; t.updatedAt = now;
    t.sampleUrls = [...new Set(['https://www.espn.com/nba/game/_/gameId/' + eventId, ...(t.sampleUrls || [])])].slice(0, 5);
  }
  void playedEvents;
  return { roleStats: stats, teamStats, roleEventIds: eventIds.slice(-MAX_ROLE_EVENTS) };
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

/* ---- schedule + travel ------------------------------------------------------------------
 * The published schedule is public fact; distance/time-zone/rest-load are derived from it with
 * the documented model in assets/js/geo.js. Every derived number carries the city it came from,
 * and an unrecognised city is reported as `unmappedCity` instead of being approximated. */
function scheduleFrom(payload, team, url, now) {
  const homeCity = Geo.coordsFor(team.city, null);
  const events = (payload.events || [])
    .map(ev => {
      const comp = (ev.competitions || [])[0] || {};
      const mine = (comp.competitors || []).find(c => standardAbbr(c.team?.abbreviation) === team.abbr) || {};
      const other = (comp.competitors || []).find(c => c !== mine) || {};
      const addr = comp.venue?.address || {};
      return {
        id: String(ev.id || comp.id || ''),
        date: comp.date || ev.date || null,
        opponent: standardAbbr(other.team?.abbreviation) || null,
        homeAway: mine.homeAway || null,
        venue: comp.venue?.fullName || null,
        city: addr.city || null, state: addr.state || null,
        completed: comp.status?.type?.completed === true || comp.status?.type?.state === 'post'
      };
    })
    .filter(g => g.id && g.date && Number.isFinite(Date.parse(g.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  /* travel chain: the origin of each trip is the PREVIOUS game's city (a home game leaves the
   * team at home, which is exactly what the previous venue records). */
  let prev = null;
  let prevCity = null;
  const enriched = events.map(g => {
    const c = Geo.coordsFor(g.city, g.state);
    /* When the previous venue is unknown the trip is measured from the team's own city — a
     * fallback that is DISCLOSED on the row (`travelFromFallback`) rather than passed off as
     * the real previous stop. */
    const fromFallback = !prevCity && !!(prev && prev.homeAway === 'away');
    const leg = g.homeAway === 'home' ? { miles: 0, hours: 0, mode: 'home game — no travel leg', unmapped: false }
      : Geo.estimateTravel(prevCity || homeCity, c);
    const tzHome = Geo.utcOffsetHours(homeCity && homeCity.tz, g.date);
    const tzGame = c ? Geo.utcOffsetHours(c.tz, g.date) : null;
    const out = {
      ...g,
      restDays: prev ? Geo.restDaysBetween(prev.date, g.date) : null,
      travelMiles: leg.miles, travelHours: leg.hours, travelMode: leg.mode,
      tzShiftHours: (tzHome != null && tzGame != null) ? Math.abs(tzGame - tzHome) : null,
      unmappedCity: c ? null : [g.city, g.state].filter(Boolean).join(', ') || 'unknown venue city'
    };
    if (fromFallback && leg.miles != null) out.travelFromFallback = true;
    if (c && c.stateMismatch) out.stateMismatch = c.stateMismatch;
    prev = g; prevCity = c || prevCity;
    return out;
  });

  const nowMs = Date.parse(now);
  const upcoming = enriched.filter(g => Date.parse(g.date) >= nowMs - 6 * 3600000).slice(0, UPCOMING_GAMES_KEPT);
  const recent = enriched.filter(g => Date.parse(g.date) < nowMs - 6 * 3600000).slice(-2);
  return {
    fetchedAt: now, url, team: team.abbr,
    season: payload.season?.displayName || null,
    homeCity: homeCity ? { city: homeCity.city, lat: homeCity.lat, lon: homeCity.lon } : null,
    games: recent.concat(upcoming),
    completedIds: enriched.filter(g => g.completed).map(g => g.id).slice(-40),
    /* id+date pairs so the backfill can pick the MOST RECENT finished games across the league
     * instead of whichever teams happen to sit last in the TEAMS array */
    completedGames: enriched.filter(g => g.completed).map(g => ({ id: g.id, date: g.date })).slice(-40),
    geoNote: 'Distances are city-centroid great-circle miles between consecutive game cities; travel hours use the documented model in assets/js/geo.js. Not flight data.',
    unresolvedCities: [...new Set(enriched.filter(g => g.unmappedCity).map(g => g.unmappedCity))]
  };
}

/* Most recent finished games first, league-wide. Extracted (and exported) so a test can pin the
 * ordering: an earlier version sorted candidates by array position, which silently biased the
 * backfill toward whichever teams happened to sit last in the TEAMS list. */
function recentBackfill(schedules, candidates, limit) {
  const gameDate = new Map();
  for (const abbr of Object.keys(schedules || {})) {
    for (const g of ((schedules[abbr] || {}).completedGames || [])) gameDate.set(g.id, g.date);
  }
  return [...new Set(candidates)]
    .sort((a, b) => (Date.parse(gameDate.get(b)) || 0) - (Date.parse(gameDate.get(a)) || 0))
    .slice(0, limit);
}

async function main() {
  const prev = read(dest), now = new Date().toISOString();
  const out = {
    checkedAt: now, schema: 3, rosters: prev.rosters || {}, roles: [], errors: {},
    schedules: prev.schedules || {}, teamStats: prev.teamStats || {},
    roleStats: prev.roleStats || {}, roleEventIds: prev.roleEventIds || []
  };

  /* 1. rosters (cached 24h) */
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < TEAMS.length) {
      const team = TEAMS[cursor++];
      const cached = out.rosters[team.abbr];
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < ROSTER_CACHE_MS && (cached.players || []).length && cached.players[0].rosterUrl !== undefined) continue;
      const url = ENDPOINTS.teams + '/' + espnAbbr(team.abbr) + '/roster';
      try {
        const d = await json(url);
        if (!Array.isArray(d.athletes) || !d.athletes.length) throw Error('Missing roster athletes');
        out.rosters[team.abbr] = rosterFrom(d, team, url, now);
      } catch (e) { out.errors[team.abbr] = e.message; }
    }
  }));

  /* 2. schedules (cached 6h) — the schedule side of the lineup-impact model */
  cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < TEAMS.length) {
      const team = TEAMS[cursor++];
      const cached = out.schedules[team.abbr];
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < SCHEDULE_CACHE_MS && Array.isArray(cached.games)) continue;
      const url = ENDPOINTS.teams + '/' + espnAbbr(team.abbr) + '/schedule';
      try { out.schedules[team.abbr] = scheduleFrom(await json(url), team, url, now); }
      catch (e) { out.errors['schedule-' + team.abbr] = e.message; }
    }
  }));

  /* 3. games to read: live now, plus recently finished games this project has not folded in yet.
   *    Without the backfill, a role/production sample would only exist for games that happened to
   *    be in progress during a scheduled run — one missed window would silently drop a whole game. */
  const already = new Set(out.roleEventIds || []);
  const toRead = new Map();      // eventId -> { url }
  try {
    const board = await json(ENDPOINTS.scoreboard);
    if (!Array.isArray(board.events)) throw Error('Missing events');
    for (const ev of board.events) {
      const st = ev.status?.type?.state || ev.competitions?.[0]?.status?.type?.state;
      if (st === 'in' || st === 'post') toRead.set(String(ev.id), { live: st === 'in' });
    }
  } catch (e) { out.errors.scoreboard = e.message; }

  const candidates = [];
  for (const team of TEAMS) {
    for (const gid of (out.schedules[team.abbr]?.completedIds || [])) {
      if (already.has(gid) || toRead.has(gid)) continue;
      candidates.push(gid);
    }
  }
  /* Most recent first: the freshest production sample is the one that matters for tonight's
   * listing. Ordering uses each finished game's OWN published date; a previous version sorted by
   * array position, which silently favoured whichever teams sat last in the TEAMS list. */
  const backfill = recentBackfill(out.schedules, candidates, BACKFILL_PER_RUN);
  for (const id of backfill) toRead.set(id, { live: false });

  const eventsRead = [];
  for (const [eventId] of toRead) {
    try {
      const summary = await json(ENDPOINTS.summary + eventId);
      const rows = roles(summary, eventId, now);
      if (!rows.length) throw Error('no box-score rows');
      out.roles.push(...rows);
      eventsRead.push(eventId);
      compTeams(summary, eventId);
    } catch (e) { out.errors['game-' + eventId] = e.message; }
  }
  out.roles = out.roles.filter(r => !already.has(r.eventId));

  /* 4. accumulate */
  const acc = accumulateRoleStats(prev, out.roles, now);
  out.roleStats = acc.roleStats;
  out.teamStats = acc.teamStats;
  out.roleEventIds = acc.roleEventIds;
  out.roleNote = 'roleStats aggregates only box scores this project fetched; games:0 means "not collected", not "not a starter". plusMinus is the box score\'s own on-court net value and is noisy in small samples.';
  out.eventsRead = eventsRead.length;
  out.travelNote = 'schedules[team].games carry the published dates/venues plus city-centroid distance, rest days and time-zone shift computed by assets/js/geo.js. Unresolved venue cities are named in unresolvedCities.';

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  const agg = Object.keys(out.roleStats || {}).length;
  console.log('context:', Object.keys(out.rosters).length, 'rosters;', Object.keys(out.schedules).length, 'schedules;',
    out.roles.length, 'box-score rows read;', agg, 'players with aggregated role/production history;',
    Object.keys(out.teamStats).length, 'team production baselines;', Object.keys(out.errors).length, 'errors');
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { roles, accumulateRoleStats, rosterFrom, scheduleFrom, recentBackfill, parseStatLine, numFromStat };
