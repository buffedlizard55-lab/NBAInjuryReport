"use strict";

/* Club table used only to turn a nickname in free text into an abbreviation, and to
 * build a Google News query. Game detection itself trusts the abbreviation ESPN
 * returns on the scoreboard — an unknown abbr is kept, not dropped.
 *
 * NFL abbreviations below are the ones ESPN returned on 2026-09-25 (WSH for the
 * Commanders, not WAS). NBA abbreviations match assets/js/data.js.
 */

const NFL = [
  ["ARI", "Arizona", "Cardinals"],
  ["ATL", "Atlanta", "Falcons"],
  ["BAL", "Baltimore", "Ravens"],
  ["BUF", "Buffalo", "Bills"],
  ["CAR", "Carolina", "Panthers"],
  ["CHI", "Chicago", "Bears"],
  ["CIN", "Cincinnati", "Bengals"],
  ["CLE", "Cleveland", "Browns"],
  ["DAL", "Dallas", "Cowboys"],
  ["DEN", "Denver", "Broncos"],
  ["DET", "Detroit", "Lions"],
  ["GB", "Green Bay", "Packers"],
  ["HOU", "Houston", "Texans"],
  ["IND", "Indianapolis", "Colts"],
  ["JAX", "Jacksonville", "Jaguars"],
  ["KC", "Kansas City", "Chiefs"],
  ["LV", "Las Vegas", "Raiders"],
  ["LAC", "Los Angeles", "Chargers"],
  ["LAR", "Los Angeles", "Rams"],
  ["MIA", "Miami", "Dolphins"],
  ["MIN", "Minnesota", "Vikings"],
  ["NE", "New England", "Patriots"],
  ["NO", "New Orleans", "Saints"],
  ["NYG", "New York", "Giants"],
  ["NYJ", "New York", "Jets"],
  ["PHI", "Philadelphia", "Eagles"],
  ["PIT", "Pittsburgh", "Steelers"],
  ["SF", "San Francisco", "49ers"],
  ["SEA", "Seattle", "Seahawks"],
  ["TB", "Tampa Bay", "Buccaneers"],
  ["TEN", "Tennessee", "Titans"],
  ["WSH", "Washington", "Commanders"]
];

const NBA = [
  ["ATL", "Atlanta", "Hawks"],
  ["BOS", "Boston", "Celtics"],
  ["BKN", "Brooklyn", "Nets"],
  ["CHA", "Charlotte", "Hornets"],
  ["CHI", "Chicago", "Bulls"],
  ["CLE", "Cleveland", "Cavaliers"],
  ["DAL", "Dallas", "Mavericks"],
  ["DEN", "Denver", "Nuggets"],
  ["DET", "Detroit", "Pistons"],
  ["GSW", "Golden State", "Warriors"],
  ["HOU", "Houston", "Rockets"],
  ["IND", "Indiana", "Pacers"],
  ["LAC", "Los Angeles", "Clippers"],
  ["LAL", "Los Angeles", "Lakers"],
  ["MEM", "Memphis", "Grizzlies"],
  ["MIA", "Miami", "Heat"],
  ["MIL", "Milwaukee", "Bucks"],
  ["MIN", "Minnesota", "Timberwolves"],
  ["NOP", "New Orleans", "Pelicans"],
  ["NYK", "New York", "Knicks"],
  ["OKC", "Oklahoma City", "Thunder"],
  ["ORL", "Orlando", "Magic"],
  ["PHI", "Philadelphia", "76ers"],
  ["PHX", "Phoenix", "Suns"],
  ["POR", "Portland", "Trail Blazers"],
  ["SAC", "Sacramento", "Kings"],
  ["SAS", "San Antonio", "Spurs"],
  ["TOR", "Toronto", "Raptors"],
  ["UTA", "Utah", "Jazz"],
  ["WAS", "Washington", "Wizards"]
];

const ALIASES = {
  nfl: { WAS: "WSH", WFT: "WSH", JAC: "JAX", LA: "LAR" },
  nba: { GS: "GSW", SA: "SAS", NY: "NYK", PHO: "PHX", NO: "NOP", UTAH: "UTA" }
};

const NICK_EXTRA = {
  nfl: { niners: "SF", "49ers": "SF", bucs: "TB", buccaneers: "TB", pats: "NE" },
  nba: { sixers: "PHI", cavs: "CLE", mavs: "DAL", blazers: "POR", wolves: "MIN" }
};

function row(sport, abbr, city, name) {
  return {
    sport,
    abbr,
    city,
    name,
    displayName: city + " " + name,
    query: city + " " + name
  };
}

const BY_SPORT = {
  nfl: NFL.map(([a, c, n]) => row("nfl", a, c, n)),
  nba: NBA.map(([a, c, n]) => row("nba", a, c, n))
};

const INDEX = {};
for (const sport of Object.keys(BY_SPORT)) {
  INDEX[sport] = {};
  for (const t of BY_SPORT[sport]) INDEX[sport][t.abbr] = t;
}

function normalizeAbbr(abbr, sport) {
  const raw = String(abbr || "").trim().toUpperCase();
  if (!raw) return "";
  const aliased = (ALIASES[sport] && ALIASES[sport][raw]) || raw;
  return aliased;
}

function teamByAbbr(abbr, sport) {
  const a = normalizeAbbr(abbr, sport);
  if (sport && INDEX[sport] && INDEX[sport][a]) return INDEX[sport][a];
  if (!sport) {
    for (const s of Object.keys(INDEX)) if (INDEX[s][a]) return INDEX[s][a];
  }
  if (!a) return null;
  return { sport: sport || null, abbr: a, city: "", name: a, displayName: a, query: a };
}

/* Prefer a nickname over a shared city ("Miami" is Dolphins or Heat). */
function inferTeam(text, sport) {
  const t = " " + String(text || "").toLowerCase() + " ";
  const teams = BY_SPORT[sport] || [];
  const hits = [];
  const extra = NICK_EXTRA[sport] || {};
  for (const [nick, abbr] of Object.entries(extra)) {
    const i = t.indexOf(" " + nick);
    if (i >= 0) hits.push({ abbr, at: i, via: "nick" });
  }
  for (const team of teams) {
    const nick = team.name.toLowerCase();
    const i = t.indexOf(nick);
    if (i >= 0) hits.push({ abbr: team.abbr, at: i, via: "name" });
  }
  if (!hits.length) {
    for (const team of teams) {
      const city = team.city.toLowerCase();
      if (city.length < 5) continue;
      const i = t.indexOf(city);
      if (i >= 0) hits.push({ abbr: team.abbr, at: i, via: "city" });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.at - b.at);
  return hits[0].abbr;
}

/* Team word that appears before the player, else the first hit. */
function inferTeamBefore(text, player, sport) {
  const idx = player ? String(text || "").toLowerCase().indexOf(String(player).toLowerCase()) : -1;
  const slice = idx > 0 ? String(text).slice(0, idx) : String(text || "");
  return inferTeam(slice, sport) || inferTeam(text, sport);
}

function allTeams(sport) {
  return (BY_SPORT[sport] || []).slice();
}

module.exports = {
  NFL, NBA, normalizeAbbr, teamByAbbr, inferTeam, inferTeamBefore, allTeams
};
