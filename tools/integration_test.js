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
  "index.html": ["assets/js/data.js", "assets/js/alerts.js", "assets/js/wire.js", "assets/js/role.js", "assets/js/injuries.js", "assets/js/social.js", "assets/js/ingame.js", "assets/js/intelligence.js", "assets/js/app.js"],
  "reporters.html": ["assets/js/data.js", "assets/js/alerts.js", "assets/js/intelligence.js", "assets/js/reporters.js"]
};
console.log("== wiring: element ids referenced in JS exist in the HTML that loads it ==");
for (const [page, scripts] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const referenced = new Set();
  for (const s of scripts) {
    const src = fs.readFileSync(path.join(ROOT, s), "utf8");
    /* Tolerates `getElementById( "id" )` and single quotes: a stricter pattern than the code's own
     * formatting silently audits nothing, which is how impact_test.js and this file came to disagree. */
    for (const m of src.matchAll(/getElementById\(\s*["']([^"'$]+)["']/g)) referenced.add(m[1]);
  }
  /* intelligence.js is loaded on both pages. Dashboard-only nodes are null-guarded
   * (officialEvidence, playerHistory, historySearch, impactLegend). Requiring them on
   * reporters.html would force fake markup; dropping them from the dashboard is already
   * caught by the index.html pass and by tools/impact_test.js. */
  const sharedOptional = page === "reporters.html"
    ? new Set(["officialEvidence", "playerHistory", "historySearch", "impactLegend"])
    : new Set();
  const missing = [...referenced].filter(id => !ids.has(id) && !sharedOptional.has(id));
  check(`${page}: ${referenced.size} ids referenced, all present`, missing.length === 0, "missing: " + missing.join(", "));
  /* every script tag exists on disk and the load order is the documented one */
  for (const s of scripts) check(`${page} loads ${s}`, html.includes(`src="${s}"`) && fs.existsSync(path.join(ROOT, s)));

  /* SESSION 17 — one layer down from the id audit: a status CLASS a module emits but the stylesheet
   * never defined renders in ordinary body colour, so a "revoked" badge and an ordinary one look the
   * same. This project has shipped that defect twice (.sev-border-*, then .good/.bad) and .pill.info
   * would have been the third.
   *
   * FIVE earlier versions of this check were wrong, and only a non-vacuity run each time exposed
   * them: (1) it collected class NAMES and looked each up anywhere in the stylesheet, so deleting
   * .pill.info passed because .badge.info exists; (2) it handled a lookup-table form the drift panel
   * does not use and missed the ternary form it does; (3) it took every quoted word on the line and
   * accused the stylesheet of missing .pill.noopener; (4) it read m.length — the match ARRAY length,
   * always 1 — instead of m[0].length, so it parsed no attribute at all; (5) it matched the selector
   * inside CSS comments, so the very comment documenting .pill.info counted as its rule.
   * The version below parses the class ATTRIBUTE (walking ${} depth so a nested quote cannot end it
   * early), only considers the six status prefixes, strips comments before matching, and treats a
   * token as satisfied when either the prefixed rule or a bare utility rule exists — a prefix plus a
   * class is ONE selector. Verified non-vacuous by deleting .pill.info and .pill.dim in turn.
   * It immediately found a REAL shipped defect: .pill.dim has been emitted by reporters.js since
   * session 13 and was never defined, so the "CI file not loaded" pill rendered in body colour. */
  {
    /* Comments are stripped first: the .pill.info comment added this session names the selector, and
     * a rule lookup that reads prose would have called the missing rule present. */
    const css = fs.readFileSync(path.join(ROOT, "assets/css/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const STATUS_PREFIX = ["badge", "pill", "tag", "callout", "dot", "btn"];
    const classAttrs = src => {
      const out = [];
      const re = /class="/g;
      let m;
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length, depth = 0, val = "";
        while (i < src.length) {
          const c = src[i];
          if (c === "$" && src[i + 1] === "{") { depth++; val += "${"; i += 2; continue; }
          if (depth > 0 && c === "{") { depth++; val += c; i++; continue; }
          if (depth > 0 && c === "}") { depth--; val += c; i++; continue; }
          if (c === '"' && depth === 0) break;
          val += c; i++;
        }
        out.push(val);
      }
      return out;
    };
    /* A rule lookup must be ANCHORED: the first version of hasRule used /\.info\b/, which matches
     * inside .badge.info — so the bare-utility excuse below was satisfied by a prefixed rule and the
     * check stayed green with .pill.info deleted. A bare selector starts a rule or follows a comma. */
    const hasRule = sel => new RegExp("(^|[,}\\s])\\." + sel.replace(/\./g, "\\.") + "\\b").test(css);
    const pairs = new Set();
    for (const s of scripts) {
      const src = fs.readFileSync(path.join(ROOT, s), "utf8");
      for (const val of classAttrs(src)) {
        const head = /^([a-z][a-z-]*)\b/.exec(val.trim());
        if (!head || !STATUS_PREFIX.includes(head[1])) continue;
        const prefix = head[1];
        /* literal tokens: `class="pill tiny warn"` — the value's own words, never template syntax and
         * never a variable spliced in by concatenation. `' + cls + '` is a name, not a class, and
         * counting it accused the stylesheet of a missing `.pill.cls`. */
        const literal = val.replace(/'\s*\+\s*[A-Za-z0-9_.$()[\]]+(\s*\+\s*[A-Za-z0-9_.$()[\]]+)*\s*\+\s*'/g, " ");
        for (const tok of literal.trim().split(/\s+/).slice(1)) {
          if (/^[a-z][a-z-]*$/.test(tok)) pairs.add(prefix + "." + tok);
        }
        /* every quoted word a ${} expression can evaluate to (ternaries, fallbacks) */
        for (const q of val.matchAll(/"([a-z][a-z-]*)"/g)) pairs.add(prefix + "." + q[1]);
        /* an identifier inside the expression resolves to the object literal it is defined by */
        for (const id of val.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\[/g)) {
          const tbl = new RegExp(id[1] + " = \\{([\\s\\S]*?)\\n  \\};").exec(src);
          if (tbl) for (const x of tbl[1].matchAll(/"[a-z-]+":\s*"([a-z-]+)"/g)) pairs.add(prefix + "." + x[1]);
        }
      }
    }
    /* A token is satisfied by its prefixed rule OR by a bare utility rule (.tiny, .muted, .small…),
     * which is how the stylesheet actually defines the layout words that sit next to status words. */
    const undef = [...pairs].filter(pc => {
      const [prefix, tok] = pc.split(".");
      return !hasRule(pc) && !hasRule(tok);
    });
    if (undef.length) console.log("      emitted with no stylesheet rule: " + undef.join(", "));
    check(`${page}: every prefix+status class pair the scripts emit has its own rule in style.css`,
      undef.length === 0 && pairs.size >= 6,
      undef.join(", ") || ([...pairs].sort().join(", ")));
  }
}
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const order = [...html.matchAll(/<script src="assets\/js\/([a-z]+\.js)"><\/script>/g)].map(m => m[1]);
  check("index.html script order is data -> alerts -> wire -> role -> injuries -> social -> ingame -> intelligence -> app",
    order.join(",") === "data.js,alerts.js,wire.js,role.js,injuries.js,social.js,ingame.js,intelligence.js,app.js", order.join(","));
  check("sources.html loads data.js + alerts.js", /src="assets\/js\/data\.js"/.test(fs.readFileSync(path.join(ROOT, "sources.html"), "utf8")));
  check(".nojekyll present (GitHub Pages doesn't preprocess assets)", fs.existsSync(path.join(ROOT, ".nojekyll")));

  /* THE BRIEF'S FIRST ORDERING REQUIREMENT: "the injury board … must be at the very top and the main
   * focus". It is a layout property, so nothing else in the suite would notice a redesign that pushed
   * the board below the wire or the alert center — the page would still render and every other check
   * would still pass. Pinned structurally: the hero is the only thing above it, and every other card
   * comes after it. */
  const boardAt = html.indexOf('id="injuryBoardCard"');
  const sectionStarts = [...html.matchAll(/<section\b/g)].map(m => m.index);
  check("the injury board is the SECOND section on the dashboard (hero, then board) — nothing pushes it down",
    boardAt > 0 && sectionStarts.length > 2 && sectionStarts[0] < boardAt && sectionStarts[1] < boardAt && sectionStarts[2] > boardAt,
    "board@" + boardAt + " section offsets: " + sectionStarts.slice(0, 4).join(","));
  const afterBoard = ["Alert center", "Live injury wire", "Social layer", "Today's games", "Player history", "X (Twitter) view", "cross-check links", "trusted sources"]
    .map(t => [t, html.indexOf(t)]);
  check("every other dashboard panel renders AFTER the injury board",
    afterBoard.every(([, i]) => i > boardAt), afterBoard.filter(([, i]) => i < boardAt).map(([t]) => t).join(", "));
  check("the board heading claims all 30 teams and the page still says lineup impact is not medical severity",
    /INJURY BOARD — every team/.test(html) && /lineup impact is not medical severity/.test(html));
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
let blockEspn = false;
global.fetch = async (url) => {
  const u = String(url);
  requested.push(u);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes("/nba/injuries")) return blockEspn ? { ok: false, status: 403, json: async () => ({}) } : ok(FIX.injuries);
  if (u.includes("data/live/latest.json")) return ok({ generated: new Date().toISOString(), injuries: { season: "2026-27", rows: [{ id: "ci-1", player: "CI Snapshot Star", playerId: null, position: "G", team: "BOS", teamName: "Boston Celtics", status: "Out", sev: "out", sevLabel: "OUT", fantasyStatus: null, bodyPart: "Left Knee", returnDate: null, updated: "2026-09-16T12:00:00Z", shortComment: "from the CI snapshot", longComment: "", noteSource: "RotoWire", playerUrl: null, teamUrl: "https://www.espn.com/nba/team/injuries/_/name/bos", officialUrl: "https://official.nba.com/", fp: "Out|Left Knee||" }], blocksRaw: [] }, posts: [], accounts: [] });
  if (u.includes("/nba/news")) return ok(FIX.news);
  if (u.includes("/scoreboard")) return ok(FIX.scoreboard);
  if (u.includes("public.api.bsky.app")) return ok(FIX.bsky);
  return { ok: false, status: 404, json: async () => ({}) };
};

/* load the real scripts exactly as index.html does */
const source = PAGES["index.html"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
const M = new Function(source + "\n; return { App, InjuryBoard, Social, Wire, InGame, AlertEngine, TEAMS, REPORTERS, arenaCoverageSummary };")();

console.log("== runtime: App.init() refresh chain ==");
(async () => {
  if (typeof global.__domReady === "function") { global.__domReady(); }
  else { M.App.init(); }
  await new Promise(r => setTimeout(r, 300));

  check("the app requested the structured injuries feed", requested.some(u => u.includes("/nba/injuries")));
  check("the app requested the ESPN news feed", requested.some(u => u.includes("/nba/news")));
  check("the app requested the scoreboard", requested.some(u => u.includes("/scoreboard")));
  check("the app polled the Bluesky allow-list", requested.some(u => u.includes("public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed")));


  check("injury board panel rendered the fixture player", /Mouhamed Gueye/.test(els.injuryBoard.innerHTML), els.injuryBoard.innerHTML.slice(0, 120));
  check("injury board shows the team group", /ATL/.test(els.injuryBoard.innerHTML));
  check("injury board shows the injury detail + GTD flag", /GTD/.test(els.injuryBoard.innerHTML) && /Foot/.test(els.injuryBoard.innerHTML));
  check("injury board status line reports the fetch path", /via/.test(els.boardStatus.innerHTML));
  check("board season label populated", els.boardSeason.textContent === "2026-27", els.boardSeason.textContent);
  check("board count populated", /listing/.test(els.boardCount.textContent), els.boardCount.textContent);
  /* Coverage gap: the fixture board carries one team block (ATL), so 29 teams must be named as
   * saying nothing — a board titled "every team" must not let an absent block read as a healthy
   * roster, and the one team that IS covered must not appear in the gap list. */
  check("board names the teams this snapshot says nothing about, and spares the one it covers",
    /coverage gap/.test(els.boardCoverage.innerHTML) && /Boston Celtics/.test(els.boardCoverage.innerHTML) &&
    !/Atlanta Hawks/.test(els.boardCoverage.innerHTML) &&
    els.boardCoverage.innerHTML.replace(/<[^>]+>/g, " ").indexOf("1/30") >= 0,
    els.boardCoverage.innerHTML.slice(0, 240));
  check("the coverage line refuses to treat an absent block as clearance",
    /NOT evidence that nobody/.test(els.boardCoverage.innerHTML));
  check("season clock names the next dated gate from the sourced calendar",
    /Training camp/.test(els.seasonClock.innerHTML) && /calendar re-read/.test(els.seasonClock.innerHTML),
    (els.seasonClock.innerHTML || "").replace(/<[^>]+>/g, " ").slice(0, 160));
  check("30-chip strip renders every franchise",
    (els.boardTeamStrip.innerHTML.match(/team-strip-chip/g) || []).length === 30,
    String((els.boardTeamStrip.innerHTML.match(/team-strip-chip/g) || []).length));
  check("strip marks omitted teams as no-listings (fixture is ATL-only)",
    (els.boardTeamStrip.innerHTML.match(/no-listings/g) || []).length === 29 &&
    /data-team="CLE"/.test(els.boardTeamStrip.innerHTML));
  M.InjuryBoard.setView("teams");
  check("team-grid paints empty cards for omitted franchises instead of hiding them",
    (els.injuryBoard.innerHTML.match(/board-team-empty/g) || []).length === 29 &&
    /CLE/.test(els.injuryBoard.innerHTML) && /not clearance/.test(els.injuryBoard.innerHTML),
    String((els.injuryBoard.innerHTML.match(/board-team-empty/g) || []).length));
  check("dashboard reporter scorecard container exists so intelligence.js can write it",
    typeof els.autoScorecard !== "undefined");
  check("every absent team links its own ESPN injuries page",
    (els.boardCoverage.innerHTML.match(/espn\.com\/nba\/team\/injuries\/_\/name\//g) || []).length >= 28,
    String((els.boardCoverage.innerHTML.match(/espn\.com\/nba\/team\/injuries/g) || []).length));

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

  check("scoreboard panel shows the offseason/live-games message", /No games returned/.test(els.games.innerHTML));
  check("in-game monitor rendered an armed state", /In-game monitor/.test(els.ingameBox.innerHTML));
  check("teams table rendered all 30 teams", (els.teamsTable.innerHTML.match(/<tr>/g) || []).length === 30);
  check("filter controls built", /option value="ALL"/.test(els.teamFilter.innerHTML) && /data-sev="out"/.test(els.sevChecks.innerHTML));
  check("alert log rendered without throwing", typeof els.alertLog.innerHTML === "string");
  check("last-refresh stamp written", /Last refresh attempt:/.test(document.getElementById("lastUpdated").textContent));
  /* The dashboard now surfaces the second verification layer too. It must render the COMPUTED
   * numbers and must not round "N of 30 teams have a pollable in-arena writer" up to "30/30". */
  {
    const IN = els.inArenaSummary ? els.inArenaSummary.innerHTML : "";
    const S = M.arenaCoverageSummary();
    check("dashboard renders the in-arena coverage summary from the same computed model",
      IN.includes(S.verifiedPollable + "/30") && IN.includes(S.officialOnly + "/30") && IN.includes(String(S.pollableWriters)),
      IN.replace(/<[^>]+>/g, " ").slice(0, 160));
    check("dashboard summary names the gap teams instead of implying every team is covered",
      S.withGaps.length === 0 || S.withGaps.slice(0, 3).every(a => IN.includes(a)));
  }
  check("no alert storm on first load (fixtures seed silently)", !/🚨/.test(els.alertLog.innerHTML), els.alertLog.innerHTML.slice(0, 160));

  /* --- scenario 2: ESPN unreachable in the browser -> same-origin CI snapshot must take over --- */
  console.log("== fallback: ESPN blocked -> same-origin CI snapshot ==");
  blockEspn = true;
  await M.InjuryBoard.check(true);
  check("falls back to the CI snapshot when the browser cannot reach ESPN", M.InjuryBoard.getMeta().path === "ci-snapshot", JSON.stringify(M.InjuryBoard.getMeta()));
  check("snapshot rows render (with the CI-authored fields)", /CI Snapshot Star/.test(els.injuryBoard.innerHTML));
  check("status line names the path so the reader knows the provenance", /ci-snapshot/.test(els.boardStatus.innerHTML));
  check("no error is shown when a fallback worked", !/no board data/.test(els.boardStatus.innerHTML));
  check("the coverage line follows the snapshot that actually served the rows",
    /coverage gap/.test(els.boardCoverage.innerHTML) && /Atlanta Hawks/.test(els.boardCoverage.innerHTML) &&
    !/Boston Celtics/.test(els.boardCoverage.innerHTML) &&
    els.boardCoverage.innerHTML.replace(/<[^>]+>/g, " ").indexOf("29") >= 0, els.boardCoverage.innerHTML.slice(0, 240));

  /* --- scenario 3: reporters.html boots its own scripts and must render COMPUTED coverage --- *
   * The verification page is the deliverable a human reads before trusting an alert, so it is
   * booted here for real (same four scripts the HTML loads) against a stub DOM, and the numbers
   * it prints are compared against arenaCoverageSummary() instead of being hardcoded — a page that
   * drifts from the registry must fail this test, not pass it. */
  console.log("== reporters.html runtime: computed coverage, gaps named, re-verification file handled ==");
  {
    const pageEls = {};
    const prevDoc = global.document;
    global.document = {
      getElementById: id => (pageEls[id] = pageEls[id] || fakeEl(id)),
      querySelectorAll: () => [],
      createElement: () => fakeEl("tmp"),
      addEventListener(evt, cb) { if (evt === "DOMContentLoaded") global.__repReady = cb; }
    };
    /* the re-verification file does not exist yet in this fixture: the page must SAY so, not
     * render an empty panel that reads like "0 problems" */
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const repSrc = PAGES["reporters.html"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
    const R = new Function(repSrc + "\n; return { Reporters, arenaCoverage, arenaCoverageSummary, TEAMS, BSKY_REPORTERS, NBA_OFFICIAL_ACCOUNT_PROBE };")();
    if (global.__repReady) global.__repReady();
    await new Promise(r => setTimeout(r, 60));

    const S = R.arenaCoverageSummary();
    const matrix = pageEls.arenaMatrixTable ? pageEls.arenaMatrixTable.innerHTML : "";
    const matrixText = matrix.replace(/<[^>]+>/g, " ");
    const summary = pageEls.coverageSummary ? pageEls.coverageSummary.innerHTML : "";
    const worklist = pageEls.coverageWorklist ? pageEls.coverageWorklist.innerHTML : "";

    check("reporters page boots the real scripts without throwing and renders the matrix", matrix.length > 2000, String(matrix.length));
    check("matrix renders exactly one row per team", (matrix.match(/<tr>/g) || []).length === 30, String((matrix.match(/<tr>/g) || []).length));
    check("matrix never prints the 'no source at all' class (every team has an official channel)", !/NO SOURCE/.test(matrix));
    check("matrix names the coverage class on every row", (matrix.match(/badge (ok|warn|bad)">[^<]*(verified in-arena writer|bio-verified identity|official channel only)/g) || []).length === 30,
      String((matrix.match(/official channel only|verified in-arena writer|bio-verified identity/g) || []).length));
    check("every team links its official club news channel", (matrix.match(/nba\.com\/[a-z]+\/news/g) || []).length === 30,
      String((matrix.match(/nba\.com\/[a-z]+\/news/g) || []).length));
    check("every team carries a re-check API link for its polled writer where one exists",
      R.arenaCoverage().filter(c => c.pollable.length).every(c => c.pollable.every(p => !p.evidenceApi || matrixText.includes("@") )) &&
      matrixText.includes("re-check API"));
    check("the identity class of each polled writer is rendered, not summarised away",
      matrixText.includes("Bluesky-verified") && matrixText.includes("bio states outlet + beat"));
    check("rows held out of the alert path are shown as held out", /held out of alerts/.test(matrixText));
    check("the dormant Heat account appears as feed-off, not as coverage", /Anthony Chiang/.test(matrixText) && /feed off/.test(matrixText));

    check("summary numbers are the COMPUTED ones", summary.includes(S.verifiedPollable + "/30") &&
      summary.includes(S.bioPollable + "/30") && summary.includes(S.officialOnly + "/30"), summary.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("summary states zero teams with no source at all", new RegExp("^" + S.gap + " teams with no source at all|" + S.gap + " teams with no source at all").test(summary.replace(/<[^>]+>/g, " ")));
    check("summary reports the pollable-account count rather than claiming 30 verified writers",
      summary.includes(String(S.pollableWriters)) && summary.includes(String(S.blsSkyVerifiedWriters)) && S.verifiedPollable < 30);

    check("the worklist names every team that is not yet verified in-arena", S.withGaps.every(abbr => worklist.includes(abbr)),
      S.withGaps.filter(a => !worklist.includes(a)).join(","));
    check("the worklist states WHY each one falls short", /no pollable in-arena writer account|no Bluesky-verified writer/.test(worklist));
    /* Absence of the CI evidence file must be DISCLOSED, and the page must say what the displayed
     * evidence actually is (the dated manual pass) — an unexplained empty panel would read as
     * "nothing to report", which is the opposite of the truth here. */
    check("missing re-verification file is disclosed, and the page names what the evidence really is",
      /No automated re-verification file yet/.test(pageEls.verifyStatus.innerHTML) &&
      /daily/.test(pageEls.verifyStatus.innerHTML) &&
      /session-10 manual pass of 2026-09-18/.test(pageEls.verifyStatus.innerHTML),
      pageEls.verifyStatus.innerHTML.replace(/<[^>]+>/g, " ").slice(0, 200));

    /* SESSION 17 — the verifier-drift panel. Booted for real: with the CI file MISSING the panel
     * must still say something true (the registry's own recorded transition) and must label its
     * scope as registry-only, because an unlabelled panel reading "0 drift facts" is the exact
     * shape of a claim this project refuses to make. */
    const driftRows0 = pageEls.driftTable ? pageEls.driftTable.innerHTML : "";
    const driftNote0 = pageEls.driftNote ? pageEls.driftNote.innerHTML : "";
    const driftPills0 = (pageEls.driftPills ? pageEls.driftPills.innerHTML : "").replace(/<[^>]+>/g, " ");
    check("the drift panel renders the registry's own recorded activity transition with no CI file at all",
      /michaelgrangenba\.bsky\.social/.test(driftRows0) && /activity change/.test(driftRows0) &&
      /dormant → active/.test(driftRows0), driftRows0.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("with no CI file the drift panel labels its scope as registry-only instead of implying a sweep",
      /registry only/.test(driftNote0) && /no CI re-verification file loaded/.test(driftPills0 + driftNote0),
      driftNote0.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("every drift row carries a re-openable evidence link",
      (driftRows0.match(/re-open the evidence ↗/g) || []).length === (driftRows0.match(/<tr>/g) || []).length,
      String((driftRows0.match(/re-open the evidence ↗/g) || []).length));
    check("the drift panel states that none of its facts downgrades an identity on its own",
      /beat change<\/b> is a coverage loss/.test(driftNote0) && /never re-grades it/.test(driftNote0));

    /* The verification DATE must be derived too. This page used to print "verified against the
     * public API 2026-09-17" forever while the registry underneath was re-read on 2026-09-18 — the
     * same defect as a hardcoded count. With NO CI file loaded it must quote the newest dated read
     * in the registry (checked below, before the mock); once the file loads it must quote the
     * file's own timestamp (checked after). */
    const pills0 = (pageEls.reporterPills.innerHTML || "").replace(/<[^>]+>/g, " ");
    check("the reporter pills quote a verification date derived from the registry, not a typed one",
      !/public API 2026-09-17/.test(pills0) && /public API \d{4}-\d{2}-\d{2}/.test(pills0) &&
        pills0.includes("re-checked daily by live-audit.yml"), pills0.slice(0, 220));

    /* now pretend CI has run: problems must surface, and a clean run must not invent any */
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
      generated: "2026-09-19T09:17:00Z",
      summary: { checked: 26, ok: 22, bioDrift: 2, dormant: 1, missing: 1, fatal: 1 },
      rows: [{ handle: "someone.bsky.social", name: "Someone", status: "missing", notes: ["handle did not resolve: not returned by getProfiles"] }],
      channelSummary: { ok: 29, checked: 30, failed: ["MIA:http403"] }
    }) });
    R.Reporters.init();
    await new Promise(r => setTimeout(r, 60));
    const vs = pageEls.verifyStatus.innerHTML;
    check("a CI run renders its counts and names each problem row", /26 handles checked/.test(vs) && /missing/.test(vs) && /someone\.bsky\.social/.test(vs));
    check("club-channel results are reported separately from identity results", /club channels 29\/30/.test(vs));

    /* once the CI file loads, the drift panel must quote IT and widen its scope line */
    const driftNote1 = pageEls.driftNote ? pageEls.driftNote.innerHTML : "";
    check("once the CI file loads the drift panel's scope line quotes the CI re-verification",
      /registry \+ CI re-verification \(1 handles\)/.test(driftNote1) && !/registry only/.test(driftNote1),
      driftNote1.replace(/<[^>]+>/g, " ").slice(0, 220));
    /* A dedicated drift scenario: a CI row carrying a DEPARTED beat must render as a coverage loss,
     * and a row carrying a recorded-valid object that is now invalid must render as revoked. Both are
     * branches of verifierDrift() that the committed evidence file happens not to contain, so they are
     * driven by a fixture here rather than left unexercised. */
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
      generated: "2026-09-19T19:00:00Z",
      summary: { checked: 2, ok: 0, dormant: 2, verificationLost: 0 },
      rows: [
        { handle: "andyblarsen.bsky.social", status: "dormant", latestPostAt: "2026-08-18T20:20:32Z",
          verification: { present: false, valid: false, invalid: false },
          beatChange: { detected: true, type: "beat-departed", previousTeam: "UTA", newTeam: null, detail: "Bio marks UTA (jazz) as former/previous coverage" },
          notes: [] },
        { handle: "hunterpatterson.bsky.social", status: "dormant", latestPostAt: "2026-09-18T23:54:58Z",
          verification: { present: true, valid: false, invalid: true, revoked: true, issuer: "theathletic.com", badIssuers: ["theathletic.com"] },
          notes: [] }
      ],
      channelSummary: { ok: 0, checked: 0, failed: [] }
    }) });
    R.Reporters.init();
    await new Promise(r => setTimeout(r, 60));
    const driftRows2 = pageEls.driftTable.innerHTML;
    const driftText2 = driftRows2.replace(/<[^>]+>/g, " ");
    check("a departed beat renders as FORMER coverage and is called a coverage loss, not a transfer",
      /FORMER coverage/.test(driftText2) && /coverage loss, not a transfer/.test(driftText2) &&
      /andyblarsen\.bsky\.social/.test(driftRows2));
    check("a recorded-valid object that is now invalid renders as verification revoked, with the issuer named",
      /verification object revoked/.test(driftText2) && /theathletic\.com/.test(driftText2) &&
      /hunterpatterson\.bsky\.social/.test(driftRows2));
    check("the drift pills count each drift kind separately so a reader can see what moved",
      /verification revoked/.test((pageEls.driftPills.innerHTML || "").replace(/<[^>]+>/g, " ")) &&
      /beat change/.test((pageEls.driftPills.innerHTML || "").replace(/<[^>]+>/g, " ")) &&
      /activity change/.test((pageEls.driftPills.innerHTML || "").replace(/<[^>]+>/g, " ")));
    check("the drift panel never claims an identity was downgraded by a drift fact",
      !/identity (was )?(downgraded|revoked|removed)/i.test(driftText2));

    /* ------------------------------------------------------------------------------------
     * SESSION 13 — the panels added for the official-account probe, the documented X/IG/FB
     * blockers, and the activity numbers. These are booted for real against the stub DOM:
     * a panel that renders nothing, or renders a number the registry does not support, fails here
     * rather than on the deployed page.
     * ------------------------------------------------------------------------------------ */
    const clubRows = pageEls.clubProbeTable ? pageEls.clubProbeTable.innerHTML : "";
    const clubMeta = pageEls.clubProbeMeta ? pageEls.clubProbeMeta.innerHTML : "";
    const blockers = pageEls.socialBlockers ? pageEls.socialBlockers.innerHTML : "";
    /* UPDATED 2026-09-19 (session 14). This used to read `=== 27`, a number that had to be edited
     * every time the probe grew — the failure text said "34" and nothing else. It now counts the
     * rows the REGISTRY declares, and separately asserts that the session-14 sweep rows reached the
     * page, so a rendering regression and a registry growth are different messages. */
    const probeRowCount = (R.NBA_OFFICIAL_ACCOUNT_PROBE && Array.isArray(R.NBA_OFFICIAL_ACCOUNT_PROBE.rows))
      ? R.NBA_OFFICIAL_ACCOUNT_PROBE.rows.length : -1;
    check("the official club probe table renders one row per probed handle",
      (clubRows.match(/<tr>/g) || []).length === probeRowCount,
      (clubRows.match(/<tr>/g) || []).length + " rendered vs " + probeRowCount + " registered");
    check("the session-14 sweep rows reach the page, including the ones that found nothing",
      ["cavs.com", "charlottehornets.bsky.social", "denvernuggets.bsky.social", "nuggets.bsky.social", "dallas-maverick-s.bsky.social"]
        .every(h => clubRows.includes(h)) &&
      /Bluesky-labelled impersonation/.test(clubRows) && /placeholder — no club claim/.test(clubRows));
    check("the probe table shows the misses too — handles that do not exist, not just the finds",
      /no such handle/.test(clubRows) && /handle does not exist/.test(clubRows));
    check("the probe table surfaces Bluesky's own impersonation labels",
      /impersonation/.test(clubRows) && /memphisgrizzlies\.bsky\.social/.test(clubRows) && /nyknicks\.bsky\.social/.test(clubRows));
    check("the probe meta line states the measured totals and links the re-runnable API call",
      /25<\/b> candidate handles probed|<b>25<\/b>/.test(clubMeta) && /getProfiles/.test(clubMeta) && /re-run the probe/.test(clubMeta),
      clubMeta.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("the probe meta states plainly that ZERO probed club accounts carry a verification object",
      /<b class="bad">0<\/b> with a valid/.test(clubMeta), clubMeta.replace(/<[^>]+>/g, " ").slice(0, 240));
    check("X, Instagram and Facebook are each named as manual-review only, with evidence links",
      /Instagram/.test(blockers) && /Facebook/.test(blockers) && (blockers.match(/evidence ↗/g) || []).length >= 3,
      blockers.replace(/<[^>]+>/g, " ").slice(0, 160));

    /* A CI file that measures dormancy must change what the matrix prints — that is the whole
     * point of session 13. Fixture: every DAL writer last posted 600 days ago. */
    const dalHandles = R.arenaCoverage().find(c => c.abbr === "DAL").pollable.map(p => p.handle);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
      generated: "2026-09-19T09:17:00Z",
      summary: { checked: 50, ok: 30, dormant: 15, activeInAlertPath: 30, inAlertPath: 45, dormantInAlertPath: 15,
        unmeasuredInAlertPath: 0, quietestInAlertPath: 628, dormantThresholdDays: 30 },
      rows: dalHandles.map(h => ({ handle: h, status: "dormant", latestPostAt: "2024-12-01T00:00:00Z", dormantDays: 600, notes: ["fixture"] })),
      channelSummary: { ok: 0, checked: 30, failed: [] }
    }) });
    R.Reporters.init();
    await new Promise(r => setTimeout(r, 60));
    const matrix2 = (pageEls.arenaMatrixTable.innerHTML || "").replace(/<[^>]+>/g, " ");
    /* The page computes the age itself from the CI date (the file's own `dormantDays` is not
     * trusted), so the expected number is derived here the same way rather than typed. */
    const expectedDays = Math.floor((Date.now() - Date.parse("2024-12-01T00:00:00Z")) / 86400000);
    check("a CI measurement of dormancy is fed back into the matrix (not left on the registry date)",
      /ALL writers dormant/.test(matrix2) && matrix2.includes(expectedDays + " days since newest post"),
      "expected " + expectedDays + "d · " + matrix2.replace(/\s+/g, " ").slice(0, 200));
    check("the verify panel reports the activity line from the CI summary, including the quietest account",
      /activity:/.test(pageEls.verifyStatus.innerHTML) && /628 days/.test(pageEls.verifyStatus.innerHTML));
    check("once the CI evidence file loads, the pills quote ITS timestamp instead of the registry date",
      /re-verified by CI 2026-09-19/.test((pageEls.reporterPills.innerHTML || "").replace(/<[^>]+>/g, " ")),
      (pageEls.reporterPills.innerHTML || "").replace(/<[^>]+>/g, " ").slice(0, 200));
    check("the coverage summary counts teams with a recent writer separately from teams with a verified one",
      /teams have a writer who posted within 30 days/.test(pageEls.coverageSummary.innerHTML) &&
      /DORMANT/.test(pageEls.coverageSummary.innerHTML));

    global.document = prevDoc;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("integration test crashed:", e); process.exit(1); });

