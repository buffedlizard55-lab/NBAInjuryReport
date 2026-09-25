"use strict";

const { normalizeAbbr, teamByAbbr } = require("../models/teams");
const { statusFromEspn, statusFromText, buildAlert, extractNames } = require("../models/alert");

const LEAGUES = {
  nfl: { sport: "football", league: "nfl", path: "football/nfl", site: "nfl" },
  nba: { sport: "basketball", league: "nba", path: "basketball/nba", site: "nba" }
};

function scoreboardUrl(sport) {
  return "https://site.api.espn.com/apis/site/v2/sports/" + LEAGUES[sport].path + "/scoreboard";
}
function injuriesUrl(sport, team) {
  const base = "https://site.web.api.espn.com/apis/site/v2/sports/" + LEAGUES[sport].path + "/injuries";
  return team ? base + "?team=" + encodeURIComponent(String(team).toLowerCase()) : base;
}
function summaryUrl(sport, eventId) {
  return "https://site.api.espn.com/apis/site/v2/sports/" + LEAGUES[sport].path + "/summary?event=" + encodeURIComponent(eventId);
}
function playsUrl(sport, eventId) {
  const L = LEAGUES[sport];
  return "https://sports.core.api.espn.com/v2/sports/" + L.sport + "/leagues/" + L.league +
    "/events/" + encodeURIComponent(eventId) + "/competitions/" + encodeURIComponent(eventId) + "/plays?limit=200";
}
function newsUrl(sport) {
  return "https://site.api.espn.com/apis/site/v2/sports/" + LEAGUES[sport].path + "/news?limit=30";
}
function gameUrl(sport, eventId) {
  return "https://www.espn.com/" + LEAGUES[sport].site + "/game/_/gameId/" + eventId;
}

function parseScoreboard(data, sport) {
  const events = (data && data.events) || [];
  const games = [];
  for (const ev of events) {
    const comp = (ev.competitions || [])[0] || {};
    const status = (comp.status && comp.status.type) || {};
    const clubs = [];
    const ids = {};
    for (const c of comp.competitors || []) {
      const abbr = normalizeAbbr(c.team && c.team.abbreviation, sport);
      if (!abbr) continue;
      clubs.push(abbr);
      if (c.team && c.team.id) ids[String(c.team.id)] = abbr;
      if (c.homeAway === "home") ids.home = abbr;
      if (c.homeAway === "away") ids.away = abbr;
    }
    games.push({
      sport,
      game_id: String(ev.id || comp.id || ""),
      club_1: clubs[0] || null,
      club_2: clubs[1] || null,
      clubs,
      team_ids: ids,
      state: status.state || "unknown",
      status_name: status.name || null,
      detail: status.shortDetail || status.detail || null,
      kickoff_time: ev.date || comp.date || null,
      name: ev.name || ev.shortName || null,
      play_by_play: comp.playByPlayAvailable === true
    });
  }
  return games;
}

function activeGames(games) {
  return (games || []).filter(g => g.state === "in");
}

function playerLink(athlete) {
  const links = (athlete && athlete.links) || [];
  const card = links.find(l => (l.rel || []).indexOf("playercard") >= 0 || (l.rel || []).indexOf("overview") >= 0);
  return (card && card.href) || (links[0] && links[0].href) || null;
}

function injuryRows(data) {
  const blocks = (data && data.injuries) || [];
  const rows = [];
  for (const block of blocks) {
    if (Array.isArray(block.injuries)) {
      for (const row of block.injuries) rows.push(row);
    } else if (block && block.athlete) {
      rows.push(block);
    }
  }
  return rows;
}

function alertsFromInjuries(data, sport, opts) {
  const now = opts && opts.nowMs;
  const allow = opts && opts.clubs ? new Set(opts.clubs) : null;
  const gameId = (opts && opts.game_id) || null;
  const out = [];
  for (const row of injuryRows(data)) {
    const athlete = row.athlete || {};
    const team = normalizeAbbr(athlete.team && athlete.team.abbreviation, sport);
    if (allow && team && !allow.has(team)) continue;
    const name = athlete.displayName || athlete.fullName;
    if (!name || !team) continue;
    const comment = [row.shortComment, row.longComment].filter(Boolean).join(" — ");
    const status = statusFromEspn(row.status, comment);
    if (!status) continue;
    out.push(buildAlert({
      source: "espn-injuries",
      sport,
      team,
      player_name: name,
      status,
      timestamp_source: row.date || (data && data.timestamp) || null,
      verbatim_text: ((row.status || status) + (comment ? " — " + comment : "")).slice(0, 500),
      source_url: playerLink(athlete) || ("https://www.espn.com/" + LEAGUES[sport].site + "/injuries"),
      verified: true,
      game_id: gameId
    }, now));
  }
  return out;
}

function teamFromRef(ref, idMap) {
  if (!ref || !idMap) return null;
  const m = String(ref).match(/teams\/(\d+)/);
  if (!m) return null;
  return idMap[m[1]] || null;
}

function iterPlays(summary) {
  const plays = [];
  const drives = (summary && summary.drives) || {};
  const buckets = [].concat(drives.previous || [], drives.current ? [drives.current] : []);
  for (const d of buckets) {
    for (const p of (d && d.plays) || []) plays.push(p);
  }
  for (const p of (summary && summary.plays) || []) plays.push(p);
  return plays;
}

function alertsFromPlays(plays, sport, game, nowMs) {
  const out = [];
  const idMap = (game && game.team_ids) || {};
  for (const p of plays || []) {
    const text = [p.text, p.shortText, p.alternativeText].filter(Boolean).join(" ");
    if (!text || !statusFromText(text)) continue;
    const team = normalizeAbbr(p.team && p.team.abbreviation, sport) ||
      normalizeAbbr(p.start && p.start.team && p.start.team.abbreviation, sport) ||
      teamFromRef(p.team && p.team.$ref, idMap) ||
      teamFromRef(p.start && p.start.team && p.start.team.$ref, idMap);
    const names = extractNames(p.shortText || p.text || "");
    for (const name of names) {
      const status = statusFromText(text);
      if (!status) continue;
      const club = team || (game && game.clubs && game.clubs.length === 1 ? game.clubs[0] : null);
      if (!club) continue;
      out.push(buildAlert({
        source: "play-by-play",
        sport,
        team: club,
        player_name: name,
        status,
        timestamp_source: p.wallclock || p.modified || null,
        verbatim_text: text.slice(0, 500),
        source_url: gameUrl(sport, game.game_id) + "#play-" + (p.id || ""),
        verified: true,
        game_id: game.game_id
      }, nowMs));
    }
  }
  return out;
}

function articleTeam(article, sport) {
  const cats = article.categories || [];
  const team = cats.find(c => c.type === "team" && (c.team || c.description));
  if (!team) return null;
  const abbr = (team.team && team.team.abbreviation) || null;
  return abbr ? normalizeAbbr(abbr, sport) : null;
}

function articleAthletes(article) {
  const names = [];
  for (const c of article.categories || []) {
    if (c.type === "athlete" && c.description) names.push(c.description);
  }
  return names;
}

function alertsFromNews(data, sport, opts) {
  const now = opts && opts.nowMs;
  const allow = opts && opts.clubs ? new Set(opts.clubs) : null;
  const out = [];
  for (const a of (data && data.articles) || []) {
    const text = [a.headline, a.description].filter(Boolean).join(" — ");
    if (!statusFromText(text) && !/injur|ruled out|questionable|doubtful/i.test(text)) continue;
    const team = articleTeam(a, sport);
    if (allow && team && !allow.has(team)) continue;
    const names = articleAthletes(a);
    const fallback = names.length ? names : extractNames(text);
    for (const name of fallback) {
      const local = text;
      const idx = local.toLowerCase().indexOf(name.toLowerCase());
      const slice = idx >= 0 ? local.slice(Math.max(0, idx - 80), idx + name.length + 90) : local;
      const status = statusFromText(slice);
      if (!status) continue;
      const club = team || null;
      if (!club) continue;
      out.push(buildAlert({
        source: "espn-news",
        sport,
        team: club,
        player_name: name,
        status,
        timestamp_source: a.published || a.lastModified || null,
        verbatim_text: text.slice(0, 500),
        source_url: (a.links && a.links.web && (a.links.web.href || (a.links.web.self && a.links.web.self.href))) || null,
        verified: true,
        game_id: (opts && opts.game_id) || null
      }, now));
    }
  }
  return out;
}

function corePlays(data) {
  return (data && data.items) || [];
}

module.exports = {
  LEAGUES, scoreboardUrl, injuriesUrl, summaryUrl, playsUrl, newsUrl, gameUrl,
  parseScoreboard, activeGames, alertsFromInjuries, alertsFromPlays, alertsFromNews,
  iterPlays, corePlays, injuryRows, teamByAbbr
};
