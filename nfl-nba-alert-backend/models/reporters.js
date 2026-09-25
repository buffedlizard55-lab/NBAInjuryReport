"use strict";

const fs = require("fs");
const path = require("path");

const nfl = require("./nfl-reporters.json");
const nbaSnap = require("./nba-reporters.json");

function loadNbaFromRepo() {
  const dataJs = path.join(__dirname, "..", "..", "assets", "js", "data.js");
  if (!fs.existsSync(dataJs)) return null;
  try {
    const src = fs.readFileSync(dataJs, "utf8");
    const D = new Function(src + "\nreturn { BSKY_REPORTERS, SOCIAL_ACCOUNTS };")();
    const reporters = (D.BSKY_REPORTERS || [])
      .filter(r => r && r.feed !== false && r.handle)
      .map(r => ({
        handle: r.handle,
        name: r.name,
        team: r.team || null,
        outlet: r.outlet || null,
        bskyVerified: !!r.bskyVerified,
        kind: "reporter",
        sport: "nba"
      }));
    const social = (D.SOCIAL_ACCOUNTS || [])
      .filter(a => a && a.feed && a.handle)
      .map(a => ({
        handle: a.handle,
        name: a.name,
        team: a.team || null,
        outlet: a.outlet || null,
        bskyVerified: !!a.bskyVerified,
        kind: a.kind || "official",
        sport: "nba"
      }));
    return { reporters, social, source: dataJs };
  } catch (e) {
    return null;
  }
}

function nbaAccounts() {
  const live = loadNbaFromRepo();
  const snap = live || {
    reporters: (nbaSnap.reporters || []).map(r => Object.assign({ sport: "nba" }, r)),
    social: (nbaSnap.social || []).map(r => Object.assign({ sport: "nba" }, r)),
    source: "models/nba-reporters.json"
  };
  const seen = new Set();
  const out = [];
  for (const a of snap.social.concat(snap.reporters)) {
    const h = String(a.handle).toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(a);
  }
  return { accounts: out, source: snap.source };
}

function nflAccounts() {
  return (nfl.accounts || []).map(a => Object.assign({ sport: "nfl", kind: a.kind || "reporter" }, a));
}

function accountsFor(sport) {
  if (sport === "nfl") return nflAccounts();
  if (sport === "nba") return nbaAccounts().accounts;
  return nflAccounts().concat(nbaAccounts().accounts);
}

/* Beat writers for the clubs that are actually playing, plus national accounts.
 * Cap keeps a Sunday slate from hammering the keyless Bluesky API. */
function selectForGames(games, cap) {
  const limit = cap == null ? 16 : cap;
  const bySport = {};
  for (const g of games || []) {
    if (!bySport[g.sport]) bySport[g.sport] = new Set();
    for (const c of g.clubs || []) bySport[g.sport].add(c);
  }
  const picked = [];
  const seen = new Set();
  for (const sport of Object.keys(bySport)) {
    const clubs = bySport[sport];
    const beat = [];
    const national = [];
    for (const a of accountsFor(sport)) {
      if (a.team && clubs.has(a.team)) beat.push(a);
      else if (!a.team) national.push(a);
    }
    for (const a of beat.concat(national)) {
      const h = a.handle.toLowerCase();
      if (seen.has(h)) continue;
      seen.add(h);
      picked.push(a);
    }
  }
  return {
    accounts: picked.slice(0, limit),
    truncated: picked.length > limit,
    total: picked.length
  };
}

module.exports = {
  nflAccounts, nbaAccounts, accountsFor, selectForGames, nflRejected: nfl.rejected || []
};
