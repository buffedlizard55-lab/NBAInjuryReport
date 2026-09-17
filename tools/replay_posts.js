#!/usr/bin/env node
/* Replays a captured social snapshot through the CURRENT classifier and prints what the
 * dashboard would alert on. This is how classifier changes get validated against real posts
 * instead of made-up ones — every tightening decision in this project was made with it.
 *
 * Usage:  node tools/replay_posts.js [path-to-snapshot.json]
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const file = process.argv[2] || path.join(ROOT, "data", "social", "latest.json");
if (!fs.existsSync(file)) { console.error("no snapshot at " + file + " (run the poller / workflow first)"); process.exit(1); }
const snap = JSON.parse(fs.readFileSync(file, "utf8"));
/* load data.js + social.js exactly as the browser does (with DOM stubs) and use the REAL
 * Social.classifyPost — a replay that re-implements the classifier would not catch regressions */
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.document = { getElementById: () => ({ innerHTML: "", textContent: "", addEventListener() { }, querySelectorAll() { return []; } }), querySelectorAll: () => [], createElement: () => ({ style: {}, click() { } }), addEventListener() { } };
global.window = global;
const src = ["assets/js/data.js", "assets/js/alerts.js", "assets/js/social.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
const M = new Function(src + "\n;return {Social, SOCIAL_INJURY_GATE_RE, SOCIAL_INJURY_VOCAB_RE, INGAME_WATCH_RE, SOCIAL_SEVERITY, classifySocialSeverity};")();

const allow = new Set(Object.keys((snap.social && snap.social.accounts) || {}));
const buckets = { alert: [], mention: [], nonInjury: [], dropped: [], foreign: [] };
for (const p of (snap.posts || [])) {
  if (allow.size && !allow.has(p.handle)) { buckets.foreign.push(p); continue; }
  const c = M.Social.classifyPost(String(p.text || ""));
  if (!c) { buckets.dropped.push(p); continue; }
  if (c.kind === "non-injury") buckets.nonInjury.push(p);
  else if (c.sev === "mention") buckets.mention.push(p);
  else buckets.alert.push({ p, sev: c.sev, label: c.sevLabel });
}
const head = s => (s || "").replace(/\s+/g, " ").slice(0, 120);
console.log(`snapshot: ${snap.generated || "?"}  posts: ${(snap.posts || []).length}  accounts: ${allow.size}`);
console.log(`\nALERT-WORTHY (${buckets.alert.length})`);
buckets.alert.forEach(({ p, sev }) => console.log(`  [${sev}] ${p.label || ""} @${p.handle} — ${head(p.text)}`));
console.log(`\nMENTION (${buckets.mention.length})`);
buckets.mention.slice(0, 10).forEach(p => console.log(`  @${p.handle} — ${head(p.text)}`));
console.log(`\nNON-INJURY / REST (${buckets.nonInjury.length})`);
buckets.nonInjury.slice(0, 10).forEach(p => console.log(`  @${p.handle} — ${head(p.text)}`));
console.log(`\nDROPPED by gate (${buckets.dropped.length})   FOREIGN author (${buckets.foreign.length})`);

/* ---- --check: assert invariants over a FRESH live snapshot (used by CI) --------------------
 * This is a self-audit on real data, not a fixture: it is what would have caught the six-club
 * abbreviation bug and the classifier false positives automatically, in CI, on the day they
 * appeared. Exit code 1 on any violation.
 */
if (process.argv.includes("--check")) {
  const problems = [];
  const ours = new Set((new Function(src + "\n;return {TEAMS};")()).TEAMS.map(t => t.abbr));
  for (const r of ((snap.injuries && snap.injuries.rows) || [])) {
    if (!ours.has(r.team)) problems.push(`row uses non-standard team code "${r.team}" (${r.player})`);
    if (!r.player || !r.status) problems.push(`row missing player/status: ${JSON.stringify(r).slice(0, 80)}`);
    if (!r.teamUrl) problems.push(`row has no review link: ${r.player}`);
  }
  for (const p of (snap.posts || [])) {
    const c = M.Social.classifyPost(p.text);
    if (!c) continue;
    const watch = c.kind === "ingame-watch";
    const vocab = /(injur\w+|hurt|sore\w*|spasms?|sprain\w*|strain\w*|torn|tore|fracture\w*|concussion\w*|illness|sick|surg\w*|procedure|achilles|acl\b|mcl\b|meniscus|hamstring|ankle|knee|calf|groin|wrist|thumb|quad|oblique|ribs?|protocol|walking boot)/i.test(p.text);
    if (!watch && !vocab && c.sev !== "mention") problems.push(`"${String(p.text).slice(0, 50)}…" labelled ${c.sev} without injury vocabulary`);
    if (c.sev === "out" && !/(ruled out|out for|out tonight|out tomorrow|out vs|will not play|won'?t play|will miss|sidelined|season-?ending|surgery)/i.test(p.text))
      problems.push(`"${String(p.text).slice(0, 50)}…" labelled OUT without an explicit out phrase`);
  }
  const seen = new Set();
  for (const p of (snap.posts || [])) {
    if (seen.has(p.uri)) problems.push(`duplicate post in snapshot: ${p.uri}`);
    seen.add(p.uri);
  }
  if (problems.length) { console.error("REPLAY CHECK FAILED:\n  - " + problems.join("\n  - ")); process.exit(1); }
  console.log(`replay check OK — ${((snap.injuries && snap.injuries.rows) || []).length} rows, ${(snap.posts || []).length} posts, no invariant violations`);
  process.exit(0);
}
