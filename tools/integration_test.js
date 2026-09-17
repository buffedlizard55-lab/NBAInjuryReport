#!/usr/bin/env node
/* Integration test: boots the REAL dashboard scripts against fixture HTTP responses and a DOM stub.
 *
 * Two things this catches that unit tests cannot:
 *   1. Wiring — every element id referenced by JS actually exists in the HTML page that loads it.
 *   2. Runtime — App.init() runs the whole refresh chain (news -> board -> social -> scoreboard ->
 *      in-game -> wire) without throwing, and the panels get populated with the fixture data.
 *
 * Run:  node tools/integration_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}

/* ---------------- 1. static wiring check: JS ids vs HTML ids ---------------- */
const PAGES = {
  "index.html": ["assets/js/data.js", "assets/js/alerts.js", "assets/js/wire.js", "assets/js/injuries.js", "assets/js/social.js", "assets/js/ingame.js", "assets/js/app.js"],
  "reporters.html": ["assets/js/data.js", "assets/js/alerts.js", "assets/js/reporters.js"]
};
console.log("== wiring: element ids referenced in JS exist in the HTML that loads it ==");
for (const [page, scripts] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const referenced = new Set();
  for (const s of scripts) {
    const src = fs.readFileSync(path.join(ROOT, s), "utf8");
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) referenced.add(m[1]);
  }
  const missing = [...referenced].filter(id => !ids.has(id));
  check(`${page}: ${referenced.size} ids referenced, all present`, missing.length === 0, "missing: " + missing.join(", "));
  /* every script tag exists on disk and the load order is the documented one */
  for (const s of scripts) check(`${page} loads ${s}`, html.includes(`src="${s}"`) && fs.existsSync(path.join(ROOT, s)));
}
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const order = [...html.matchAll(/<script src="assets\/js\/([a-z]+\.js)"><\/script>/g)].map(m => m[1]);
  check("index.html script order is data -> alerts -> wire -> injuries -> social -> ingame -> app",
    order.join(",") === "data.js,alerts.js,wire.js,injuries.js,social.js,ingame.js,app.js", order.join(","));
  check("sources.html loads data.js + alerts.js", /src="assets\/js\/data\.js"/.test(fs.readFileSync(path.join(ROOT, "sources.html"), "utf8")));
  check(".nojekyll present (GitHub Pages doesn't preprocess assets)", fs.existsSync(path.join(ROOT, ".nojekyll")));
}

/* ---------------- 2. runtime boot with fixtures ---------------- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function fakeEl(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", checked: false, disabled: false, files: [],
    dataset: {}, style: {},
    addEventListener() { }, querySelectorAll() { return []; }, querySelector() { return null; }, click() { }, reset() { }
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || fakeEl(id)),
  querySelectorAll: () => [],
  createElement: () => fakeEl("tmp"),
  addEventListener(evt, cb) { if (evt === "DOMContentLoaded") global.__domReady = cb; }
};
global.window = global;
global.alert = () => { };

/* Fixtures modelled on the live payloads verified 2026-09-17 */
const FIX = {
  injuries: {
    timestamp: "2026-09-17T03:00:43Z", status: "success",
    season: { year: 2027, type: 1, name: "Preseason", displayName: "2026-27" },
    injuries: [{
      id: "1", displayName: "Atlanta Hawks", injuries: [{
        id: "-56292", status: "Day-To-Day", date: "2026-07-19T00:14Z",
        shortComment: "Gueye underwent surgery Tuesday to repair a fractured left foot, Brad Rowland of the Locked On Podcast Network reports.",
        athlete: { id: "4712863", displayName: "Mouhamed Gueye", position: { abbreviation: "F" }, team: { abbreviation: "ATL" }, links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/4712863/mouhamed-gueye" }] },
        notes: { items: [{ headline: "Gueye (foot) out 3-4 months", source: "RotoWire", date: "2026-07-18T23:18Z" }] },
        type: { name: "INJURY_STATUS_DAYTODAY" }, details: { fantasyStatus: { description: "GTD" }, type: "Foot", side: "Left", returnDate: "2026-11-01" }
      }]
    }]
  },
  news: { articles: [
    { id: 49961989, headline: "Suns' Mark Williams to miss months after shoulder surgery", description: "Phoenix loses its starting center.", published: "2026-09-17T02:52:39Z", links: { web: { href: "https://www.espn.com/nba/story/_/id/49961989/x" } } },
    { id: 49961990, headline: "Suns add center depth in wake of Mark Williams injury", description: "A mention-level item that must be captured but hidden by the default severity filters.", published: "2026-09-17T02:53:39Z", links: { web: { href: "https://www.espn.com/nba/story/_/id/49961990/x" } } }
  ] },
  scoreboard: { events: [] },
  bsky: { feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", author: { handle: "howardbeck.bsky.social", displayName: "Howard Beck" }, record: { text: "Lakers say Luka Doncic has left the game and is headed to the locker room.", createdAt: "2026-09-17T02:00:00Z" }, indexedAt: "2026-09-17T02:00:01Z" } }] }
};
const requested = [];
global.fetch = async (url) => {
  const u = String(url);
  requested.push(u);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes("/nba/injuries")) return ok(FIX.injuries);
  if (u.includes("/nba/news")) return ok(FIX.news);
  if (u.includes("/scoreboard")) return ok(FIX.scoreboard);
  if (u.includes("public.api.bsky.app")) return ok(FIX.bsky);
  return { ok: false, status: 404, json: async () => ({}) };
};

/* load the real scripts exactly as index.html does */
const source = PAGES["index.html"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
const M = new Function(source + "\n; return { App, InjuryBoard, Social, Wire, InGame, AlertEngine, TEAMS, REPORTERS };")();

console.log("== runtime: App.init() refresh chain ==");
(async () => {
  if (typeof global.__domReady === "function") { global.__domReady(); }
  else { M.App.init(); }
  await new Promise(r => setTimeout(r, 300));

  check("the app requested the structured injuries feed", requested.some(u => u.includes("/nba/injuries")));
  check("the app requested the ESPN news feed", requested.some(u => u.includes("/nba/news")));
  check("the app requested the scoreboard", requested.some(u => u.includes("/scoreboard")));
  check("the app polled the Bluesky allow-list", requested.some(u => u.includes("public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed")));
  check("it also looks for the CORS-proof snapshot", requested.some(u => u.includes("data/live/latest.json")));

  check("injury board panel rendered the fixture player", /Mouhamed Gueye/.test(els.injuryBoard.innerHTML), els.injuryBoard.innerHTML.slice(0, 120));
  check("injury board shows the team group", /ATL/.test(els.injuryBoard.innerHTML));
  check("injury board shows the injury detail + GTD flag", /GTD/.test(els.injuryBoard.innerHTML) && /Foot/.test(els.injuryBoard.innerHTML));
  check("injury board status line reports the fetch path", /via/.test(els.boardStatus.innerHTML));
  check("board season label populated", els.boardSeason.textContent === "2026-27", els.boardSeason.textContent);
  check("board count populated", /listing/.test(els.boardCount.textContent), els.boardCount.textContent);

  check("wire rendered merged items", /wire-item/.test(els.wire.innerHTML));
  check("wire contains the social in-game exit post", /locker room/i.test(els.wire.innerHTML));
  check("wire labels the in-game exit as unconfirmed social", /IN-GAME EXIT WATCH/.test(els.wire.innerHTML));
  check("wire contains the OUT-severity ESPN-news item", /to miss months after shoulder surgery/.test(els.wire.innerHTML));
  check("mention-level items are captured but hidden by the default severity filters",
    M.Wire.all().some(i => /add center depth/.test(i.text)) && !/add center depth/.test(els.wire.innerHTML));
  check("wire contains the structured-board item", /Mouhamed Gueye/.test(els.wire.innerHTML));

  check("social panel rendered the fixture post", /Howard Beck/.test(els.socialFeed.innerHTML));
  check("social status line reports account reachability", /reachable|unreachable|not polled/.test(els.socialStatus.innerHTML));
  check("social detail table lists every allow-listed account", (els.socialDetail.innerHTML.match(/<tr>/g) || []).length >= 5);

  check("scoreboard panel shows the offseason/live-games message", /No games today/.test(els.games.innerHTML));
  check("in-game monitor rendered an armed state", /In-game monitor/.test(els.ingameBox.innerHTML));
  check("teams table rendered all 30 teams", (els.teamsTable.innerHTML.match(/<tr>/g) || []).length === 30);
  check("filter controls built", /option value="ALL"/.test(els.teamFilter.innerHTML) && /data-sev="out"/.test(els.sevChecks.innerHTML));
  check("alert log rendered without throwing", typeof els.alertLog.innerHTML === "string");
  check("last-refresh stamp written", /Last refresh:/.test(document.getElementById("lastUpdated").textContent));
  check("no alert storm on first load (fixtures seed silently)", !/🚨/.test(els.alertLog.innerHTML), els.alertLog.innerHTML.slice(0, 160));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("integration test crashed:", e); process.exit(1); });
