#!/usr/bin/env node
/* =====================================================================================
 * verify_reporters_test.js — offline tests for the reporter re-verification layer
 *
 * Three things are pinned here, in the order they matter:
 *   1. judge() verdicts: every branch (ok / bio-drift / dormant / verification-lost /
 *      missing / no-quote) is exercised with fixtures, INCLUDING the traps — a handle that
 *      resolves but whose bio changed, and a row that CLAIMS a verification object the API
 *      no longer returns. Without these the tool could quietly print "all clear" forever.
 *   2. Registry invariants for the 2026-09-18 in-arena expansion: every row added this
 *      session must carry the exact bio it was verified from, the re-check URL, the date,
 *      and an identity class; and rows that are NOT allowed to alert (dormant / unconfirmed)
 *      must be pinned as feed:false so a later edit cannot silently arm them.
 *   3. Coverage honesty: arenaCoverage() must name every team and every gap, and must never
 *      report a team as covered when it has no pollable writer and no official channel.
 *
 * Run: node tools/verify_reporters_test.js
 * ===================================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const V = require("./verify_reporters.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}

const NOW = Date.parse("2026-09-18T12:00:00Z");
const iso = d => new Date(NOW - d * 86400000).toISOString();
function profile(description, verifications) {
  return { handle: "x.bsky.social", displayName: "X", description: description,
    verification: verifications ? { verifications: verifications, verifiedStatus: "valid" } : undefined };
}
const GOOD_OBJ = [{ isValid: true, issuerHandle: "bsky.app" }];
const BAD_OBJ = [{ isValid: false, issuerHandle: "bsky.app" }];

console.log("== judge(): every verdict branch ==");
{
  const row = { handle: "a.bsky.social", name: "A", evidenceQuote: "Pistons beat writer for the Detroit Free Press.", bskyVerified: true, feed: true };
  const ok = V.judge(row, { profile: profile("Pistons beat writer for the Detroit Free Press.\nCo-host of a podcast.", GOOD_OBJ), latestPostAt: iso(1) }, NOW);
  check("matching bio + valid object + a post yesterday = ok", ok.status === "ok" && !ok.fatal, ok.status);

  const whitespace = V.judge(row, { profile: profile("Pistons   beat writer for the\nDetroit Free Press.", GOOD_OBJ), latestPostAt: iso(2) }, NOW);
  check("reformatting (newlines/spacing) is NOT reported as identity drift", whitespace.status === "ok", whitespace.status);

  const drift = V.judge(row, { profile: profile("Now covering the Cleveland Cavaliers for a different outlet.", GOOD_OBJ), latestPostAt: iso(1) }, NOW);
  check("changed bio = bio-drift (warning, not a build failure)", drift.status === "bio-drift" && drift.fatal === false, drift.status);

  const dormant = V.judge(row, { profile: profile("Pistons beat writer for the Detroit Free Press.", GOOD_OBJ), latestPostAt: iso(120) }, NOW);
  check("matching bio but no post for 120 days = dormant", dormant.status === "dormant" && dormant.dormantDays === 120, dormant.status + " " + dormant.dormantDays);

  const boundary = V.judge(row, { profile: profile("Pistons beat writer for the Detroit Free Press.", GOOD_OBJ), latestPostAt: iso(V.DORMANT_DAYS + 1) }, NOW);
  check("dormancy threshold is enforced and exported (" + V.DORMANT_DAYS + " days)", boundary.status === "dormant");

  const lost = V.judge(row, { profile: profile("Pistons beat writer for the Detroit Free Press.", BAD_OBJ), latestPostAt: iso(1) }, NOW);
  check("row claims verification and the API returns an invalid object = verification-lost (FATAL)", lost.status === "verification-lost" && lost.fatal === true);

  const gone = V.judge(row, { profile: profile("Pistons beat writer for the Detroit Free Press.", undefined), latestPostAt: iso(1) }, NOW);
  check("row claims verification and there is no object at all = verification-lost (FATAL)", gone.status === "verification-lost" && gone.fatal === true);

  const missing = V.judge(row, { profile: null, error: "not returned by getProfiles" }, NOW);
  check("unresolvable handle = missing (FATAL)", missing.status === "missing" && missing.fatal === true);

  const legacy = V.judge({ handle: "l.bsky.social", name: "Legacy" }, { profile: profile("Some bio", GOOD_OBJ), latestPostAt: iso(1) }, NOW);
  check("legacy row with no stored quote is reported 'no-quote', never graded ok", legacy.status === "no-quote" && legacy.fatal === false);

  const noObjectRow = V.judge({ handle: "b.bsky.social", name: "B", evidenceQuote: "Covering the Sixers for PHLY.", bskyVerified: false, feed: true },
    { profile: profile("Covering the Sixers for PHLY.", BAD_OBJ), latestPostAt: iso(3) }, NOW);
  check("a bio-verified row with no object is still ok (the object is not claimed)", noObjectRow.status === "ok", noObjectRow.status);

  const noFeed = V.judge({ handle: "c.bsky.social", name: "C", evidenceQuote: "Miami Heat reporter for the Miami Herald.", bskyVerified: false, feed: false },
    { profile: profile("Miami Heat reporter for the Miami Herald.", undefined), latestPostAt: iso(300) }, NOW);
  check("a feed:false (dormant) row is judged on identity, not recency — it never claimed coverage",
    noFeed.status === "ok" && /held out of the alert path/.test(noFeed.notes[0]), noFeed.status + " | " + noFeed.notes[0]);
  const noFeedDrift = V.judge({ handle: "c.bsky.social", name: "C", evidenceQuote: "Miami Heat reporter for the Miami Herald.", feed: false },
    { profile: profile("Now a chef in Coral Gables.", undefined) }, NOW);
  check("...but its identity claim is still checked: a changed bio is still bio-drift", noFeedDrift.status === "bio-drift", noFeedDrift.status);
}
{
  const s = V.summarize([
    { handle: "a", status: "ok", fatal: false }, { handle: "b", status: "bio-drift", fatal: false },
    { handle: "c", status: "missing", fatal: true }, { handle: "d", status: "ok", fatal: false }
  ]);
  check("summarize() counts statuses and lists the problem rows", s.checked === 4 && s.ok === 2 && s.bioDrift === 1 && s.missing === 1 && s.fatal === 1 &&
    s.withProblems.join(",") === "b (bio-drift),c (missing)");
  check("batch plan keeps getProfiles under the 25-actor API limit", V.chunk(Array.from({ length: 26 }, (_, i) => i), 25).map(c => c.length).join(",") === "25,1");
}

console.log("== registry: the 2026-09-18 in-arena expansion ==");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8") +
  ";globalThis.__d = { TEAMS, REPORTERS, BSKY_REPORTERS, SOCIAL_ACCOUNTS, arenaCoverage, arenaCoverageSummary, reporterConf, nbaTeamNewsUrl, ARENA_CONF_RANK };", sandbox);
const D = sandbox.__d;

/* Two groups, deliberately separated:
 *   NEW        — rows ADDED in the 2026-09-18 session (they carry an explicit identity class)
 *   BACKFILLED — the 8 pre-existing reporter rows, which gained evidenceQuote/evidenceApi from the
 *                first automated verifier run (tools/verify_reporters.js, 2026-09-18T19:21Z) so
 *                they are no longer permanently ungradeable. Their counts were read by that run,
 *                not by hand, so they assert the machine-recorded observation instead. */
const NEW = D.BSKY_REPORTERS.filter(r => r.conf !== undefined);
const BACKFILLED = D.BSKY_REPORTERS.filter(r => r.conf === undefined);
check("the session added 18 evidence rows (16 pollable + 2 held out)", NEW.length === 18, "got " + NEW.length);
check("every added row carries the exact bio it was verified from", NEW.every(r => r.evidenceQuote && r.evidenceQuote.length > 10));
check("every added row carries a re-runnable evidence URL on the public API", NEW.every(r => /^https:\/\/public\.api\.bsky\.app\/xrpc\/app\.bsky\.actor\.getProfiles\?actors=/.test(r.evidenceApi || "")));
check("every added row carries the counts actually observed that day", NEW.every(r => r.observed.postsCount != null && r.observed.profileIndexedAt && r.observed.verificationValid !== undefined));
check("every added row declares an identity class the code knows", NEW.every(r => D.ARENA_CONF_RANK[r.conf] !== undefined));
check("the pre-existing rows were BACKFILLED with machine-observed evidence rather than left ungradeable",
  BACKFILLED.length === 8 && BACKFILLED.every(r => r.evidenceQuote && /actors=/.test(r.evidenceApi || "") && r.observed && r.observed.recheckedBy),
  "backfilled " + BACKFILLED.length);
check("a backfilled row's API link cannot point at a different account",
  BACKFILLED.every(r => String(r.evidenceApi).endsWith("actors=" + r.handle)));
check("every reporter row in the registry is now gradeable (no silent no-quote rows in BSKY_REPORTERS)",
  D.BSKY_REPORTERS.every(r => !!r.evidenceQuote));
check("no row asserts a team that is not in the 30-team registry", D.BSKY_REPORTERS.every(r => r.team == null || !!D.TEAMS.find(t => t.abbr === r.team)));
/* Over-claiming is the dangerous direction: declaring the strongest class without the object.
 * Under-claiming (an object present but a weaker class written) is merely conservative. */
check("no row claims the strongest class without a verification object behind it",
  D.BSKY_REPORTERS.every(r => r.conf !== "bsky-verified" || (r.bskyVerified === true && !!r.verifier)));
check("rows upgraded to bsky-verified name the issuer actually seen (bsky.app or the outlet domain)",
  D.BSKY_REPORTERS.filter(r => r.conf === "bsky-verified").every(r => /^(bsky\.app|[a-z0-9-]+\.[a-z]{2,})$/.test(r.verifier)));
check("legacy rows without a declared class are graded by their recorded evidence, not defaulted to the top",
  D.BSKY_REPORTERS.some(r => r.conf === undefined) && D.BSKY_REPORTERS.filter(r => r.conf === undefined).every(r => D.reporterConf(r) === (r.bskyVerified ? "bsky-verified" : "bio-verified")));

/* The two rows that must never sound. This is the single most important assertion in the file:
 * a dormant account and an unconfirmed handle are the two shapes that would otherwise produce
 * confident-looking alerts from evidence that does not support them. */
const dormantRow = D.BSKY_REPORTERS.find(r => r.handle === "anthonychiang.bsky.social");
const unconfirmedRow = D.BSKY_REPORTERS.find(r => r.handle === "pompeyonsixers.bsky.social");
check("the dormant Heat account is pinned feed:false with the MEASURED newest post stored",
  !!dormantRow && dormantRow.feed === false && /DORMANT/.test(dormantRow.verified) &&
  dormantRow.observed.latestPostAt === "2024-12-11T18:15:24.950Z" && dormantRow.observed.postsCount === 4);
check("the unconfirmed 76ers handle is pinned feed:false, classed unconfirmed, and never cites an outlet it cannot prove",
  !!unconfirmedRow && unconfirmedRow.feed === false && unconfirmedRow.conf === "unconfirmed" && /NOT established/.test(unconfirmedRow.outlet));
check("every feed:false reporter row states WHY in its evidence text",
  D.BSKY_REPORTERS.filter(r => r.feed === false).every(r => /feed:false|DORMANT|unconfirmed|UNCONFIRMED|not polled/.test(r.verified)));
check("the doppelgänger ATL account is excluded and the ambiguity is recorded",
  !D.BSKY_REPORTERS.some(r => r.handle === "frodorowland.bsky.social") && /doppelg|frodorowland/.test((D.BSKY_REPORTERS.find(r => r.handle === "btrowland.bsky.social") || {}).verified || ""));
check("no Eric Nehm 'mirror' or handle.invalid row can exist in any registry",
  D.BSKY_REPORTERS.concat(D.SOCIAL_ACCOUNTS).every(r => r.handle !== "handle.invalid" && !/mirror/i.test(r.handle)));
check("no squatting team-name handle is registered as an official account",
  D.SOCIAL_ACCOUNTS.filter(a => a.kind === "official-team").every(a => a.bskyVerified === true || /NOT verified|unverified-team-account/i.test(a.verified)));

console.log("== coverage: all 30 teams, gaps named ==");
const cov = D.arenaCoverage();
check("coverage is computed for all 30 teams", cov.length === 30 && new Set(cov.map(c => c.abbr)).size === 30);
check("no team is left with zero sources (class 'gap')", cov.every(c => c.cls !== "gap"), cov.filter(c => c.cls === "gap").map(c => c.abbr).join(","));
check("every team carries a clickable official club channel", cov.every(c => c.official.site && c.official.news && c.official.news.endsWith("/news")));
check("every team row states its gaps explicitly (even when none apply to identity)", cov.every(c => Array.isArray(c.gaps)));
check("the eight teams that had NO writer row before this session now have one",
  ["CLE", "DET", "MIL", "MIN", "PHI", "POR", "SAC", "WAS"].every(a => (cov.find(c => c.abbr === a) || {}).directory.length + (cov.find(c => c.abbr === a) || {}).pollable.length > 0));
check("a team is never classed as writer-covered unless a pollable writer exists",
  cov.every(c => /^(verified-pollable|bio-pollable)$/.test(c.cls) ? c.pollable.length > 0 : c.pollable.length === 0));
check("summary arithmetic matches the rows it summarises", (() => {
  const s = D.arenaCoverageSummary();
  return s.teams === 30 && s.verifiedPollable + s.bioPollable + s.officialOnly + s.gap === 30 && s.pollableWriters === cov.reduce((n, c) => n + c.pollable.length, 0);
})());
check("the computed summary reports REAL coverage, not full coverage (no silent claim of 30/30 writers)", (() => {
  const s = D.arenaCoverageSummary();
  return s.verifiedPollable < 30 && s.officialOnly > 0 && s.withGaps.length === 30 - s.verifiedPollable;
})());

/* ---- recency: "could not read the feed" must never look like a clean bill of health -------- */
{
  const row = { handle: "d.bsky.social", name: "D", evidenceQuote: "Pistons beat writer", bskyVerified: false, feed: true };
  const readableEmpty = V.judge(row, { profile: profile("Pistons beat writer"), latestPostAt: null, feedReadable: true, postItems: 0 }, NOW);
  check("a readable feed with ZERO posts is dormant, not fine",
    readableEmpty.status === "dormant" && /ZERO posts/.test(readableEmpty.notes[0]), readableEmpty.status);
  const unreadable = V.judge(row, { profile: profile("Pistons beat writer"), latestPostAt: null, feedReadable: false, feedError: "HTTP 500" }, NOW);
  check("an UNREADABLE feed is reported as recency-unknown, never as a pass",
    unreadable.status === "recency-unknown" && /NOT established/.test(unreadable.notes[0]), unreadable.status);
  const heldOut = V.judge({ handle: "e.bsky.social", name: "E", evidenceQuote: "Pistons beat writer", feed: false },
    { profile: profile("Pistons beat writer"), feedReadable: false }, NOW);
  check("a feed:false row is not accused of a recency it never claimed", heldOut.status === "ok", heldOut.status);
  const summary = V.summarize([readableEmpty, unreadable, heldOut]);
  check("the summary counts recency-unknown separately from ok and dormant",
    summary.recencyUnknown === 1 && summary.dormant === 1 && summary.ok === 1, JSON.stringify(summary));
}

/* =====================================================================================
 * END-TO-END: run the REAL CLI with a stubbed network.
 *
 * Why this exists: on 2026-09-18 the live job went red with exit 1 while every unit test passed.
 * The cause was a single dangling call site inside main() (`latestPostAt` after it had been renamed
 * to `latestPost`) — code that no unit test touched, so the failure surfaced in production instead
 * of here. The stub below answers getProfiles / getAuthorFeed / club-channel requests, and the test
 * asserts exit 0, so anything that throws anywhere in the pipeline fails a build in seconds.
 * ===================================================================================== */
console.log("== end to end: the real CLI against a stubbed network ==");
{
  const os = require("os");
  const { spawnSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vr-stub-"));
  const stub = path.join(dir, "stub.js");
  fs.writeFileSync(stub, `
const NOW = new Date().toISOString();
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), url: u });
  if (u.includes("getProfiles")) {
    const actors = (u.split("actors=").slice(1).join("&actors=")).split("&actors=").map(decodeURIComponent);
    return json({ profiles: actors.map(h => ({
      handle: h, description: "bio for " + h,
      verification: { verifications: [{ isValid: true, issuerHandle: "bsky.app" }] }
    })) });
  }
  if (u.includes("getAuthorFeed")) return json({ feed: [{ post: { record: { createdAt: NOW } } }] });
  /* club channels: answer like a normal news index */
  return { ok: true, status: 200, text: async () => "<html>news</html>", json: async () => ({}), url: u };
};
`);
  const evidence = path.join(ROOT, "data/live/reporter_verify.json");
  const before = fs.existsSync(evidence) ? fs.readFileSync(evidence, "utf8") : null;
  const res = spawnSync(process.execPath, ["-r", stub, path.join(ROOT, "tools/verify_reporters.js"), "--dry-run"], { encoding: "utf8" });
  check("the CLI completes end-to-end offline (no dangling reference anywhere in the pipeline)",
    res.status === 0, "exit " + res.status + " · " + String(res.stderr || "").slice(0, 300));
  check("it reports verdicts and club-channel results rather than silently doing nothing",
    /verdicts:/.test(res.stdout || "") && /club channels: 30\/30/.test(res.stdout || ""), String(res.stdout || "").slice(-200));
  const after = fs.existsSync(evidence) ? fs.readFileSync(evidence, "utf8") : null;
  check("--dry-run leaves the committed evidence file byte-for-byte untouched", before === after,
    before === after ? "" : "file was rewritten by a dry run");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
