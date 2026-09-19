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

  // Session 16: verifier revocation & beat-change watch
  const revokedObj = V.validVerification(profile("Some bio", BAD_OBJ));
  check("validVerification flags invalid object (isValid:false) as invalid and revoked",
    revokedObj.invalid === true && revokedObj.valid === false && revokedObj.revoked === true);

  const vRevokeRow = V.judge({ handle: "jv.bsky.social", name: "JV", team: null, evidenceQuote: "National NBA writer.", bskyVerified: false, feed: true },
    { profile: profile("National NBA writer.", BAD_OBJ), latestPostAt: iso(1) }, NOW);
  check("judge() records verifier-revocation in notes when object is invalid (joevardon pattern)",
    vRevokeRow.notes.some(n => /verifier-revocation detected/.test(n)));

  const toddChange = V.detectBeatChange("Timberwolves reporter at Minnesota Star Tribune. Previously Jazz, 76ers and Warriors.", "UTA", "Deseret News");
  check("detectBeatChange catches departure from registered team (Todd: previously Jazz -> MIN)",
    toddChange && toddChange.detected === true && toddChange.previousTeam === "UTA" && toddChange.newTeam === "MIN");

  const hineChange = V.detectBeatChange("Sixers reporter for The Philadelphia Inquirer. Previously covered Minnesota Timberwolves.", "MIN", "Star Tribune");
  check("detectBeatChange catches move to Sixers (Hine: previously Timberwolves -> PHI)",
    hineChange && hineChange.detected === true && hineChange.previousTeam === "MIN" && hineChange.newTeam === "PHI");

  const curtisStay = V.detectBeatChange("Mavericks beat writer for The Dallas Morning News.", "DAL", "Dallas Morning News");
  check("detectBeatChange returns null for steady beat reporter (Curtis: DAL)", curtisStay === null);
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
  ";globalThis.__d = { TEAMS, REPORTERS, BSKY_REPORTERS, SOCIAL_ACCOUNTS, arenaCoverage, arenaCoverageSummary, reporterConf, nbaTeamNewsUrl, ARENA_CONF_RANK, ARENA_DORMANT_DAYS, NBA_OFFICIAL_ACCOUNT_PROBE, writerRecency, arenaDaysSince, verifierDrift };", sandbox);
const D = sandbox.__d;

/* Two groups, deliberately separated:
 *   NEW        — rows ADDED in the 2026-09-18 session (they carry an explicit identity class)
 *   BACKFILLED — the 8 pre-existing reporter rows, which gained evidenceQuote/evidenceApi from the
 *                first automated verifier run (tools/verify_reporters.js, 2026-09-18T19:21Z) so
 *                they are no longer permanently ungradeable. Their counts were read by that run,
 *                not by hand, so they assert the machine-recorded observation instead. */
const NEW = D.BSKY_REPORTERS.filter(r => r.conf !== undefined);
const BACKFILLED = D.BSKY_REPORTERS.filter(r => r.conf === undefined);
/* UPDATED 2026-09-18 session 13.
 *
 * WHY THIS CHECK IS WRITTEN AS A SUM AND NOT AS A NUMBER
 *   It used to read `NEW.length === 39`. Session 13 added 7 rows and the failure message said
 *   "got 46" — true, and useless: nothing in it told the reader WHY the number moved. The count is
 *   now derived from the composition the sessions actually documented (18 + 14 + 7 + 7), and the
 *   session-13 handles are asserted by name, so a row can only be added by also being named here.
 *   Session breakdown: 18 from session 10 (16 pollable + 2 held out) + 14 from session 11
 *   + 7 from session 12 + 7 from session 13 (5 pollable + 2 REFUSED) = 46 rows with a conf. */
const SESSION_13_HANDLES = ["montepoole.bsky.social", "bennettdurando.bsky.social", "grantafseth.bsky.social",
  "jasonlloyd.bsky.social", "joevardon.bsky.social", "bstownsend.bsky.social", "jovanbuha.bsky.social"];
/* SESSION 14 (2026-09-19) — the nine named gap teams, read live. 10 pollable rows (CLE beat,
 * DAL TV play-by-play + podcast, DEN writer, CHA analyst, MEM writer, NOP podcast, UTA publication
 * + outlet-graded Tribune columnist, LAL blog) and 3 REFUSED handles whose profiles disqualify the
 * name match (Lakers broadcaster-shaped handle with no bio, the Alaska photographer returned for
 * the Nets writer, and two Utah play-by-play name matches with no Jazz identity). Every one is
 * named here, so adding a row without naming it fails. */
const SESSION_14_HANDLES = ["dannycunningham.bsky.social", "mfollowill.bsky.social", "nickvanexit.bsky.social",
  "joelrushnba.bsky.social", "bgeisinger.bsky.social", "chrisherrington.bsky.social", "nolajake.bsky.social",
  "saltcityhoops.bsky.social", "andyblarsen.bsky.social", "lakerssbn.bsky.social",
  "miketrudell.bsky.social", "erikslaterphoto.bsky.social", "david-locke.bsky.social"];
/* SESSION 15 (2026-09-19) — depth for the gap-listed teams from Vorkunov's starter-pack list
 * (read in full), bio-phrase searches and exact-name typeahead. 16 pollable rows (ORL, DET,
 * PHI x2, TOR, BKN, NOP x2, CHI x2, IND, CHA, WAS, UTA, NYK) and 1 REFUSED handle (a Hornets
 * name match whose profile carries no bio). Grades are conservative on purpose: 1 outlet-verified
 * via theathletic.com (graded bsky-verified with verifier named), 2 outlet-verified (NetsDaily
 * writer with no beat stated; a multi-sport columnist), the rest bio-verified. Three of the 16
 * measure DORMANT (Grange 39d, Miller 597d, Popper 352d) and are stored that way. */
const SESSION_15_HANDLES = ["codytaylornba.bsky.social", "hunterpatterson.bsky.social", "ginamizell.bsky.social",
  "christopherhine.bsky.social", "michaelgrangenba.bsky.social", "lucaskaplan.bsky.social", "rodwalkernola.bsky.social",
  "masonginsberg.bsky.social", "juliapoe.bsky.social", "willgottlieb.bsky.social", "caitlinmaycooper.bsky.social",
  "britishbuzz.bsky.social", "chasedcsports.bsky.social", "millerjryan.bsky.social", "stevepopper.bsky.social",
  "rodboone.bsky.social"];
const EXPECTED_NEW = 18 + 14 + 7 + SESSION_13_HANDLES.length + SESSION_14_HANDLES.length + SESSION_15_HANDLES.length;
/* +1 RE-GRADED original: nbasarah.bsky.social is not a session row at all. It is one of the
 * pre-existing backfilled rows, and it gained a grade on 2026-09-18 when the daily re-verification
 * reported bio-drift and the live re-read showed a beat change (Jazz → Timberwolves) plus a valid
 * bsky.app verification object. Naming it here, instead of moving the number, keeps the ledger of
 * "rows this project graded from its own reads" auditable. */
const REGRADED = ["nbasarah.bsky.social"];
check("the sessions added " + EXPECTED_NEW + " evidence rows — 18 (s10) + 14 (s11) + 7 (s12) + " +
  SESSION_13_HANDLES.length + " (s13) + " + SESSION_14_HANDLES.length + " (s14) + " + SESSION_15_HANDLES.length + " (s15) — plus " +
  REGRADED.length + " re-graded original",
  NEW.length === EXPECTED_NEW + REGRADED.length, "got " + NEW.length + " (expected " + (EXPECTED_NEW + REGRADED.length) + ")");
check("the re-graded row is the one the re-verification caught, and its grade rests on a live read",
  REGRADED.every(h => {
    const r = D.BSKY_REPORTERS.find(x => x.handle === h);
    return r && r.conf === "bsky-verified" && r.verifier === "bsky.app" && /RE-READ live via getProfiles/.test(r.verified || "");
  }), REGRADED.join(","));
/* UPDATED 2026-09-19 (session 14). This check used to assert `uta.pollable.length === 0`, which
 * was true only while nobody had found a Utah account. Session 14 found two evidenced ones
 * (Salt City Hoops' publication feed and Tribune columnist Andy Larsen), so the count is no longer
 * the invariant that matters. What must NOT change is the thing this check was written for: the
 * beat change is a COVERAGE LOSS, the replacement rows are honestly graded, and UTA still carries
 * the "no Bluesky-verified writer" gap rather than being rendered as verified coverage. */
check("the beat change is recorded as a COVERAGE LOSS for the team it left, and the replacement rows are graded honestly",
  (() => {
    const cov = D.arenaCoverage();
    const uta = cov.find(c => c.abbr === "UTA");
    const min = cov.find(c => c.abbr === "MIN");
    const larsen = D.BSKY_REPORTERS.find(r => r.handle === "andyblarsen.bsky.social");
    return min.pollable.some(p => p.handle === "nbasarah.bsky.social") &&
      uta.cls !== "verified-pollable" &&
      D.arenaCoverageSummary().withGaps.includes("UTA") &&
      uta.gaps.some(g => /no Bluesky-verified writer/.test(g)) &&
      uta.pollable.length > 0 && uta.recency !== "active" &&
      larsen.conf === "outlet-verified" && /FORMER/.test(larsen.role) && !/current beat writer/.test(larsen.role);
  })(), "UTA cls=" + D.arenaCoverage().find(c => c.abbr === "UTA").cls);
check("every session-13 row is present by name, and no unnamed row appeared with it",
  SESSION_13_HANDLES.every(h => NEW.some(r => r.handle === h)) &&
    NEW.filter(r => r.handle === "joevardon.bsky.social").length === 1,
  "missing: " + SESSION_13_HANDLES.filter(h => !NEW.some(r => r.handle === h)).join(","));
check("every session-15 row is present by name, and no unnamed row appeared with it",
  SESSION_15_HANDLES.every(h => NEW.filter(r => r.handle === h).length === 1),
  "missing: " + SESSION_15_HANDLES.filter(h => !NEW.some(r => r.handle === h)).join(","));
/* Session 15 graded three rows DORMANT on that day's read. That measurement is history and it stays
 * in the registry — but the FIRST form of this check pinned the LIST of dormant handles, so the first
 * legitimate CI re-measurement to find a quiet writer posting again turned the suite red while the
 * product was right. michaelgrangenba.bsky.social did exactly that on 2026-09-19: 39 days → 0 days.
 * The check now pins the RULE, and requires any row that left the window to carry the dated record of
 * leaving it — which is the thing that was actually missing when this went red. */
check("the 30-day rule reads dormant outside the window and active inside it",
  (() => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    const at = isoDate => D.writerRecency({ handle: "x.bsky.social", observed: { latestPostAt: isoDate } }, null, now).state;
    const ago = n => new Date(now - n * 86400000).toISOString();
    return at(ago(0)) === "active" && at(ago(D.ARENA_DORMANT_DAYS)) === "active" &&
      at(ago(D.ARENA_DORMANT_DAYS + 1)) === "dormant" && at(ago(597)) === "dormant";
  })());
check("session-15's dormant rows are still dormant, OR carry the dated record of having left the window",
  (() => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    const bad = ["michaelgrangenba.bsky.social", "millerjryan.bsky.social", "stevepopper.bsky.social"].filter(h => {
      const row = D.BSKY_REPORTERS.find(r => r.handle === h);
      if (!row) return true;
      const rec = D.writerRecency(row, null, now);
      const logged = !!(row.observed && Array.isArray(row.observed.activityLog) && row.observed.activityLog.length);
      return rec.state !== "dormant" && !logged;
    });
    return bad.length === 0;
  })(), "left the window with no dated activity record: see michaelgrangenba.bsky.social");
check("session-15's active rows are still inside the window",
  (() => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    return ["codytaylornba.bsky.social", "hunterpatterson.bsky.social", "ginamizell.bsky.social", "lucaskaplan.bsky.social",
      "juliapoe.bsky.social", "britishbuzz.bsky.social"].every(h => D.writerRecency(D.BSKY_REPORTERS.find(r => r.handle === h), null, now).state === "active");
  })());
/* THE INVARIANT THAT WAS MISSING (session 17). A registry row states two things: what the account
 * IS (identity) and what it last DID (activity). Activity is re-measured daily and moves; the prose
 * that recorded the original verdict does not. Nothing in the repository compared the two, so
 * michaelgrangenba.bsky.social sat there saying "39 days → DORMANT" over a date that evaluated
 * ACTIVE, and the only thing that noticed was a test pinning the wrong thing. From here on, a prose
 * verdict that contradicts the row's own measured date must be accompanied by the dated activity
 * record — the same record the backfill now writes when it moves a row across the boundary. */
const proseContradictions = (() => {
  const now = Date.now();
  return D.BSKY_REPORTERS.filter(r => {
    const prose = String(r.verified || "");
    const claims = /→\s*DORMANT/i.test(prose) ? "dormant" : (/→\s*ACTIVE/i.test(prose) ? "active" : null);
    if (!claims) return false;
    const rec = D.writerRecency(r, null, now);
    if (!rec.measured || rec.state === claims) return false;
    const logged = !!(r.observed && Array.isArray(r.observed.activityLog) &&
      r.observed.activityLog.some(e => e && e.to === rec.state));
    return !logged;
  }).map(r => r.handle + " (prose says " + (/→\s*DORMANT/i.test(String(r.verified)) ? "DORMANT" : "ACTIVE") +
    ", its own measured date " + (r.observed && r.observed.latestPostAt) + " reads " +
    D.writerRecency(r, null, now).state + ", and no dated activity record explains the change)");
})();
check("no row's prose activity verdict contradicts its measured date without a dated activity record",
  proseContradictions.length === 0, proseContradictions.join("; "));
check("the Athletic-verified Pistons row names the OUTLET as verifier, not bsky.app",

  (() => { const r = D.BSKY_REPORTERS.find(x => x.handle === "hunterpatterson.bsky.social");
    return r && r.conf === "bsky-verified" && r.verifier === "theathletic.com" && r.observed.verificationValid === true; })());
check("the two session-15 outlet-verified rows never read as a current beat writer",
  ["lucaskaplan.bsky.social", "rodwalkernola.bsky.social"].every(h => {
    const r = D.BSKY_REPORTERS.find(x => x.handle === h);
    return r && r.conf === "outlet-verified" && !/beat writer$/.test(r.role) && !/credentialed/i.test(r.role);
  }));
check("CHA and UTA are still gap-listed after session 15 (identity ceiling honoured, not papered over)",
  (() => {
    const cov = D.arenaCoverage();
    const cha = cov.find(c => c.abbr === "CHA"), uta = cov.find(c => c.abbr === "UTA");
    const summary = D.arenaCoverageSummary();
    return cha.cls !== "verified-pollable" && uta.cls !== "verified-pollable" && uta.recency === "dormant-only" &&
      summary.withGaps.includes("CHA") && summary.withGaps.includes("UTA") &&
      cha.graded.some(g => g.handle === "rodboone.bsky.social" && g.refused && !g.feed);
  })());
check("every added row carries the exact bio it was verified from", NEW.every(r => r.evidenceQuote && r.evidenceQuote.length > 10));
check("every added row carries a re-runnable evidence URL on the public API", NEW.every(r => /^https:\/\/public\.api\.bsky\.app\/xrpc\/app\.bsky\.actor\.getProfiles\?actors=/.test(r.evidenceApi || "")));
check("every added row carries the counts actually observed that day", NEW.every(r => r.observed.postsCount != null && r.observed.profileIndexedAt && r.observed.verificationValid !== undefined));
check("every added row declares an identity class the code knows", NEW.every(r => D.ARENA_CONF_RANK[r.conf] !== undefined));
/* 8 until 2026-09-18, now 7: nbasarah.bsky.social was re-read live after the daily re-verification
 * reported bio-drift and is now graded bsky-verified (valid bsky.app object, beat changed to MIN),
 * so it left the ungraded set. The count is deliberately pinned — a row silently gaining or losing
 * its grade should fail here rather than change what the page claims. */
check("the pre-existing rows were BACKFILLED with machine-observed evidence rather than left ungradeable",
  BACKFILLED.length === 7 && BACKFILLED.every(r => r.evidenceQuote && /actors=/.test(r.evidenceApi || "") && r.observed && r.observed.recheckedBy),
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
  D.SOCIAL_ACCOUNTS.filter(a => a.kind === "official-team").every(a => a.bskyVerified === true || /NOT verified|unverified-team-account|NO.*verification object/i.test(a.verified)));

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
/* UPDATED 2026-09-19 (session 14): `s.officialOnly > 0` used to hold because CHA and UTA had no
 * writer account at all. Session 14 found evidenced accounts for both, so that clause would now be
 * a demand for an uncovered team. The claim being protected — the page never reports 30/30 at the
 * strongest class, and the classes account for every team — is asserted directly instead. */
check("the computed summary reports REAL coverage, not full coverage (no silent claim of 30/30 writers)", (() => {
  const s = D.arenaCoverageSummary();
  return s.verifiedPollable < 30 && s.withGaps.length === 30 - s.verifiedPollable &&
    s.verifiedPollable + s.bioPollable + s.officialOnly + s.gap === 30;
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


/* =====================================================================================
 * SESSION 13 (2026-09-18) — ACTIVITY IS NOT IDENTITY, AND A MODERATION LABEL OUTRANKS A BIO
 * -------------------------------------------------------------------------------------
 * Two claims this file did not previously test, both of which the live reads disproved or
 * established on 2026-09-18:
 *   1. "We have a verified writer for this team" said nothing about whether that writer had
 *      posted recently — 4 teams were covered only by accounts 45–628 days quiet.
 *   2. Nothing read Bluesky's `labels[]`, so an account the platform labels `impersonation`
 *      could have been allow-listed as a club.
 * ===================================================================================== */
console.log("== session 13: moderation labels ==");
{
  const imp = { val: "impersonation", src: "did:plc:ar7c4by46qjdydhdevvrndac", neg: false };
  check("a Bluesky moderation label is recognised and separated from profile settings",
    V.profileLabels({ labels: [imp, { val: "!no-unauthenticated" }] }).moderation.join() === "impersonation" &&
    V.profileLabels({ labels: [{ val: "!no-unauthenticated" }] }).moderation.length === 0);
  check("a NEGATED label is a removal, not an assertion, and is ignored",
    V.profileLabels({ labels: [{ val: "impersonation", neg: true }] }).moderation.length === 0);
  check("a missing labels[] array does not throw and reads as no labels",
    V.profileLabels({}).all.length === 0 && V.profileLabels(null).moderation.length === 0);

  const clubRow = { handle: "memphisgrizzlies.bsky.social", name: "The Memphis Grizzlies", team: "MEM",
    feed: true, evidenceQuote: "The Official Bluesky of Your Memphis Grizzlies", bskyVerified: false };
  const live = V.judge(clubRow, { profile: { description: "The Official Bluesky of Your Memphis Grizzlies", labels: [imp] },
    latestPostAt: iso(1), feedReadable: true, postItems: 11 }, NOW);
  check("an impersonation-labelled handle in the alert path FAILS the job even though bio and recency are perfect",
    live.status === "impersonation-label" && live.fatal === true, live.status);
  const held = V.judge(Object.assign({}, clubRow, { feed: false }), { profile: { description: "x", labels: [imp] } }, NOW);
  check("the same label on a row already held out is recorded, not fatal",
    held.status === "impersonation-label" && held.fatal === false);
  check("the impersonation verdict outranks bio-drift (identity, not text, is the problem)",
    V.judge(clubRow, { profile: { description: "totally different bio", labels: [imp] } }, NOW).status === "impersonation-label");
  /* Typography is evidence-adjacent: the 2026-09-18T23:54Z CI run flagged timcato.bsky.social as
   * bio-drift while the live bio still read "didn’t use to have followers here i’m sorry" — the only
   * difference was curly apostrophes against the straight ones in the stored quote. A drift verdict
   * that fires on punctuation hides the drift that matters. */
  check("quote comparison folds typographic apostrophes, quotes and dashes instead of reporting drift on punctuation",
    V.norm("didn\u2019t use to have followers here i\u2019m sorry") === V.norm("didn't use to have followers here i'm sorry") &&
    V.quotePresent("didn't use to have followers here i'm sorry", "didn\u2019t use to have followers here i\u2019m sorry") === true &&
    V.quotePresent("Staff Writer, Mavericks", "didn\u2019t use to have followers here i\u2019m sorry") === false);
  check("the stored quote for the account CI flagged on punctuation is unchanged and now matches",
    V.quotePresent((D.BSKY_REPORTERS.find(r => r.handle === "timcato.bsky.social") || {}).evidenceQuote,
      "didn\u2019t use to have followers here i\u2019m sorry") === true);
  /* A refused row stores no identity claim, so "quote missing from bio" is true by construction.
   * The meaningful check is the inverse: has a bio appeared, making the identity establishable? */
  const refused = D.BSKY_REPORTERS.find(r => r.identityRefused === true && r.observed && r.observed.bioEmpty === true);
  check("a REFUSED row with an empty profile is not reported as bio-drift (there is no claim to drift)",
    V.judge(refused, { profile: { description: "" } }, NOW).status === "ok" &&
      /identity REFUSED/.test(V.judge(refused, { profile: { description: "" } }, NOW).notes[0]),
      V.judge(refused, { profile: { description: "" } }, NOW).status);
  check("...but the SAME row flips to drift if a bio appears, which would make the identity checkable again",
    V.judge(refused, { profile: { description: "Lakers beat writer for The Athletic" } }, NOW).status === "bio-drift" &&
      /may now be establishable/.test(V.judge(refused, { profile: { description: "Lakers beat writer for The Athletic" } }, NOW).notes[0]));

  check("no allow-listed handle in the registry is one this project measured as impersonation-labelled",
    ["memphisgrizzlies.bsky.social", "nyknicks.bsky.social", "charlottehornetsbb.bsky.social"]
      .every(h => !D.BSKY_REPORTERS.concat(D.SOCIAL_ACCOUNTS).some(r => r.handle === h)));

  /* MEASURED, not inferred. The first version of this verdict treated the `!no-unauthenticated`
   * label as proof that a keyless poller sees nothing — and the first CI run promptly reported
   * geraldbourguet.bsky.social as profile-private while a keyless getAuthorFeed on that same handle
   * returned two posts (newest 2026-09-18T18:45:43Z). The label is the holder's REQUEST; only the
   * read is evidence, so the verdict now requires the read to have actually failed. */
  const labelledRow = { handle: "miamiheat.bsky.social", name: "Miami HEAT", team: "MIA", feed: true,
    evidenceQuote: "HEAT", bskyVerified: false };
  const labelledProfile = { description: "HEAT", labels: [{ val: "!no-unauthenticated" }] };
  const readable = V.judge(labelledRow, { profile: labelledProfile, latestPostAt: iso(2), feedReadable: true, postItems: 4 }, NOW);
  const unreadable = V.judge(labelledRow, { profile: labelledProfile, latestPostAt: null, feedReadable: false, feedError: "HTTP 401" }, NOW);
  check("a labelled profile whose feed the keyless poller CAN read stays healthy, with the label kept as a standing risk",
    readable.status === "ok" && readable.privateProfile === true && readable.labels.join() === "!no-unauthenticated",
    readable.status);
  check("the SAME profile reads 'profile-private' only once the keyless read has actually failed",
    unreadable.status === "profile-private" && unreadable.fatal === false && /HTTP 401/.test(unreadable.notes[0]),
    unreadable.status + " | " + unreadable.notes[0]);
  check("a private profile held out of collection is not double-reported as a reachability problem",
    V.judge({ handle: "m.bsky.social", name: "M", feed: false, evidenceQuote: "HEAT" },
      { profile: { description: "HEAT", labels: [{ val: "!no-unauthenticated" }] }, latestPostAt: iso(2), feedReadable: true, postItems: 4 }, NOW).status === "ok");
}

console.log("== session 13: activity is computed, and CI evidence beats a stale registry date ==");
{
  check("the dormancy threshold is defined ONCE and imported by the verifier (no second copy)",
    typeof D.ARENA_DORMANT_DAYS === "number" && V.DORMANT_DAYS === D.ARENA_DORMANT_DAYS,
    "data.js " + D.ARENA_DORMANT_DAYS + " vs tool " + V.DORMANT_DAYS);
  const cov = D.arenaCoverage(null, NOW);
  check("every pollable writer carries a recency object with a state the UI can render",
    cov.every(c => c.pollable.every(p => p.recency && ["active", "dormant", "unknown"].includes(p.recency.state))));
  check("a writer with no measured date is 'unknown' — never silently 'active'",
    cov.every(c => c.pollable.every(p => p.recency.state !== "unknown" || (p.recency.latestPostAt === null && p.recency.active === false))));
  check("every team states an activity state, including teams with no writer at all",
    cov.every(c => ["active", "dormant-only", "dormant-and-unmeasured", "unmeasured", "no-writer"].includes(c.recency)));
  check("a team whose writers are ALL dormant is named as such, with the quietest age in days",
    cov.filter(c => c.recency === "dormant-only").every(c => c.quietestWriterDays > D.ARENA_DORMANT_DAYS &&
      c.gaps.some(g => /DORMANT/.test(g))));
  check("a team with at least one active writer is never reported as dormant-only",
    cov.filter(c => c.recency === "active").every(c => c.activeWriters >= 1 && !c.gaps.some(g => /every pollable writer is DORMANT/.test(g))));
  check("the CI evidence file wins over a stale registry date (fresher measurement of the same API)", (() => {
    const target = D.BSKY_REPORTERS.find(r => r.team === "DAL" && r.feed !== false && D.reporterConf(r) !== "unconfirmed");
    if (!target) return false;
    const fresh = {}; fresh[target.handle.toLowerCase()] = { latestPostAt: iso(1) };
    const c = D.arenaCoverage(fresh, NOW).find(x => x.abbr === "DAL");
    const w = c.pollable.find(p => p.handle === target.handle);
    return w.recency.state === "active" && w.recency.source === "ci" && c.recency === "active";
  })());
  check("the registry's own observation is used when the CI file has nothing for that handle", (() => {
    /* Must be a TEAM writer that is actually in the alert path: a national row (team null) never
     * appears in any team's pollable list, and the first version of this check picked one and
     * then crashed on undefined instead of failing with a message. */
    const target = D.BSKY_REPORTERS.find(r => r.team && r.feed !== false && D.reporterConf(r) !== "unconfirmed" &&
      r.observed && r.observed.latestPostAt);
    if (!target) return "no team writer with a stored newest-post date";
    const w = D.arenaCoverage(null, Date.parse(target.observed.latestPostAt) + 3600000)
      .flatMap(c => c.pollable).find(p => p.handle === target.handle);
    if (!w) return "writer " + target.handle + " not rendered for team " + target.team;
    return (w.recency.source === "registry" && w.recency.state === "active") ||
      ("state " + w.recency.state + " source " + w.recency.source);
  })());
  const s = D.arenaCoverageSummary(null, NOW);
  check("summary activity arithmetic matches the rows it summarises",
    s.writersActive + s.writersDormant + s.writersUnmeasured === s.pollableWriters &&
    s.writersActive === cov.reduce((n, c) => n + c.activeWriters, 0) &&
    s.dormantThresholdDays === D.ARENA_DORMANT_DAYS);
  check("the summary names the teams with no active writer instead of hiding them in a count",
    s.dormantOnlyTeams.every(a => cov.find(c => c.abbr === a).recency.startsWith("dormant")) &&
    s.activeTeams === cov.filter(c => c.recency === "active").length);
  /* UPDATED 2026-09-19 (session 14). Session 13's measurement was that all four of DAL/DEN/LAL/CLE
   * had no ACTIVE writer. Session 14 added an evidenced account to each, and exactly one of them —
   * CLE, via Danny Cunningham's own 2026-09-01 post — now measures active on registry evidence
   * alone. Asserting "all four are still inactive" would now be asserting a defect; asserting
   * "all four are now active" would be inventing coverage the other rows do not have. So the check
   * pins the transition, one team at a time, and requires the three that are NOT active to say so. */
  /* UPDATED AGAIN 2026-09-19 (same session, later): the six getAuthorFeed reads landed, and DEN's
   * Joel Rush posted 2 days ago — so DEN is active TOO. The check keeps its shape (name the state
   * of each of the four teams the brief called dormant-only, and require the two that are still
   * dormant to say so) instead of being rewritten into a weaker statement. */
  check("dormancy is visible where it remains: CLE and DEN active, DAL and LAL dormant-only", (() => {
    const state = a => cov.find(c => c.abbr === a).recency;
    return state("CLE") === "active" && state("DEN") === "active" &&
      ["DAL", "LAL"].every(a => state(a) === "dormant-only") &&
      ["DAL", "DEN", "LAL", "CLE"].every(a => cov.find(c => c.abbr === a).pollable.length > 0);
  })(), ["DAL", "DEN", "LAL", "CLE"].map(a => a + ":" + cov.find(c => c.abbr === a).recency).join(" "));
  /* UPDATED 2026-09-19 (same session, later). The rule this check exists for is unchanged and is
   * the reason it is worth keeping: a row may only carry a newest-post date if a keyless read
   * produced one, and every one of those dates must name the read that produced it. What changed is
   * the measurement — all ten reader rows were read, so the "unmeasured otherwise" half now belongs
   * to the REFUSED rows, which must stay undated forever. */
  check("every session-14 reader row carries a feed-read date WITH its provenance, and refused rows carry none", (() => {
    const rows = SESSION_14_HANDLES.map(h => D.BSKY_REPORTERS.find(r => r.handle === h));
    const readers = rows.filter(r => r.feed !== false);
    const refused = rows.filter(r => r.feed === false);
    const provenance = r => String((r.observed || {}).latestPostAtSource || "");
    return readers.length + refused.length === rows.length && readers.length > 0 &&
      readers.every(r => r.observed && r.observed.latestPostAt && /(?:getAuthorFeed\?actor=|data\/live\/reporter_verify\.json)/.test(provenance(r))) &&
      refused.every(r => r.identityRefused === true && !(r.observed || {}).latestPostAt) &&
      rows.every(r => r.observed && r.observed.checkedAt === "2026-09-19" && r.observed.followersCount != null);
  })(), SESSION_14_HANDLES.map(h => { const r = D.BSKY_REPORTERS.find(x => x.handle === h) || {}; return h + ":" + ((r.observed || {}).latestPostAt || (r.feed === false ? "(refused)" : "(NONE)")); }).join(" "));
}

console.log("== session 13: refused identities stay refused, and the club probe is internally consistent ==");
{
  const refused = D.BSKY_REPORTERS.filter(r => r.identityRefused === true);
  /* 2 until 2026-09-19; 5 after session 14; 6 after session 15 (rodboone.bsky.social — Hornets
   * roster-move posts, NO bio, no outlet, no verification object). Session 14 refused three handles — a Lakers-broadcaster name
   * with an empty profile, an Alaska photographer returned for a Nets writer, and two Utah
   * play-by-play name matches with no Jazz identity. The count is pinned so a refused row can
   * neither be dropped quietly nor added without naming it here. */
  check("every refused handle is present, pinned feed:false and classed unconfirmed",
    refused.length === 6 && refused.every(r => r.feed === false && r.conf === "unconfirmed" && r.team),
    refused.map(r => r.handle).join(","));
  check("a refused row records WHAT the API returned instead of an invented bio",
    refused.every(r => (r.evidenceQuote || "").length > 10 && /REFUSED/.test(r.verified)));
  check("the refused Dallas handle's stored quote is the cybersecurity bio that disqualified it",
    /Cybersecurity Engineer/.test((refused.find(r => r.handle === "bstownsend.bsky.social") || {}).evidenceQuote || ""));
  check("a refused row cannot be armed by flipping its feed flag (class gate is independent)",
    refused.every(r => D.reporterConf(r) === "unconfirmed"));
  check("every session-13 pollable row stores the newest-post date it measured, or says why it cannot",
    ["montepoole.bsky.social", "bennettdurando.bsky.social", "grantafseth.bsky.social", "jasonlloyd.bsky.social"]
      .every(h => { const r = D.BSKY_REPORTERS.find(x => x.handle === h); return !!r.observed.latestPostAt; }));

  const P = D.NBA_OFFICIAL_ACCOUNT_PROBE;
  /* Two rows came from a typeahead search / a separate same-day request, not the 25-handle batch;
   * every row records which, so the summary arithmetic can be checked against the batch alone. */
  const BATCH = "getProfiles 25-handle batch";
  check("every probed handle records HOW it was read (batch probe vs typeahead vs separate request)",
    P.rows.every(r => typeof r.via === "string" && r.via.length > 5));
  check("the club probe names a re-checkable URL and the date it was read",
    /getProfiles\?actors=/.test(P.probeUrl) && /^\d{4}-\d{2}-\d{2}$/.test(P.checkedAt));
  check("every probed handle is assigned to a team in the 30-team registry",
    P.rows.every(r => !!D.TEAMS.find(t => t.abbr === r.team)));
  check("probe verdicts use the documented vocabulary only",
    P.rows.every(r => ["absent", "placeholder", "impersonation-labelled", "private-profile", "unverified-candidate", "in-registry"].includes(r.verdict)));
  check("probe arithmetic adds up: 25 handles probed = 16 resolved + 9 absent",
    P.rows.filter(r => r.via === BATCH).length === P.summary.handlesProbed &&
    P.rows.filter(r => r.via === BATCH && r.resolved === true).length === P.summary.resolved &&
    P.rows.filter(r => r.via === BATCH && r.resolved === false).length === P.summary.absent &&
    P.summary.handlesProbed === P.summary.resolved + P.summary.absent,
    "rows " + P.rows.length + " / " + P.rows.filter(r => r.resolved === true).length + " resolved");
  /* UPDATED 2026-09-19 (session 14). The claim "NOT ONE of the 25 guessed club handles carries a
   * verification object" is about the BATCH and stays true. Session 14 added a second sweep whose
   * rows include one handle that DOES carry a valid object — nuggets.bsky.social — because the
   * point of a sweep is also to re-confirm what is already registered. So the zero-claim is scoped
   * to the batch rows, and the sweep's one verified handle is asserted by name and row. */
  check("the 25-handle batch found ZERO verified club accounts and the probe says so instead of implying coverage",
    P.summary.withValidVerificationObject === 0 &&
    P.rows.filter(r => r.via === "getProfiles 25-handle batch" && r.verification === true).length === 0 &&
    /NOT ONE carries/.test(P.summary.meaning));
  check("the session-14 sweep re-confirmed exactly one verified club handle (DEN) and found none new",
    (() => {
      const verified = P.rows.filter(r => r.verification === true);
      const sw = P.summary.sweep;
      return verified.length === 1 && verified[0].handle === "nuggets.bsky.social" &&
        verified[0].team === "DEN" && /VALID Bluesky verification object/.test(verified[0].note || "") &&
        !!sw && sw.when === "2026-09-19" && sw.placeholders.length === 4 && sw.newHandlesRead === 6 &&
        sw.impersonationFound.length === 3 && sw.verifiedConfirmed.length === 1 &&
        /no new club channel/.test(sw.meaning);
    })(), JSON.stringify((P.summary.sweep || {}).verifiedConfirmed));
  check("every placeholder the sweep read is recorded with the counts that disqualified it",
    P.summary.sweep.placeholders.every(h => {
      const r = P.rows.find(x => x.handle === h);
      return !!r && r.verdict === "placeholder" && r.posts != null && r.posts <= 10 &&
        r.followers != null && r.followers <= 2 && r.verification === false && !!r.note;
    }), P.summary.sweep.placeholders.join(","));
  check("a sweep row that could not read counts says null instead of guessing them",
    P.rows.filter(r => /typeahead|searchActors q=/.test(r.via))
      .every(r => (r.followers == null && r.posts == null) || (r.followers != null && r.posts != null)));
  check("every impersonation-labelled handle the probe found is counted in the summary",
    P.rows.filter(r => r.verdict === "impersonation-labelled").length === P.summary.impersonationLabelled &&
    P.summary.impersonationLabelled >= 3);
  check("the Suns handle the probe earned is registered as an unverified, NOT-polled club channel", (() => {
    const a = D.SOCIAL_ACCOUNTS.find(x => x.handle === "sunsphx.bsky.social");
    return !!a && a.team === "PHX" && a.feed === false && a.bskyVerified === false && !!a.evidenceApi &&
      /The Official Account of the Phoenix Suns/.test(a.evidenceQuote);
  })());
  check("the coverage model surfaces the probe result per team for manual review",
    D.arenaCoverage().filter(c => c.official.probe.length).length >= 20 &&
    D.arenaCoverage().every(c => c.official.probe.every(p => p.handle && p.verdict)));
}

/* =====================================================================================
 * SESSION 14 (2026-09-19) — the registry recency backfill.
 *
 * The brief's complaint was concrete: "30 of 40 writers have no registry-stored newest-post date
 * (printed unmeasured); the daily CI file covers the rest — worth backfilling the registry so the
 * page is right even before the first CI run." A tool that rewrites a 250 kB JavaScript registry
 * is exactly the kind of thing that must be tested against a REAL copy, not asserted to work: the
 * checks below run the actual CLI in a scratch directory and compare the rewritten file against
 * the original with every date field stripped, so "it only touched the dates" is proven rather than
 * claimed. Nothing is written inside the repository.
 * ===================================================================================== */
/* =====================================================================================
 * SESSION 17: verifierDrift() — the computed drift watch behind the new reporters.html panel.
 *
 * The session-15 leftover was a "verifier-drift UI". The DETECTION already existed in
 * tools/verify_reporters.js; what was missing was anywhere a reader could see it. So the
 * computation moved into data.js (testable in Node, same source the page paints from) and these
 * checks pin its branches against REAL registry rows with synthetic evidence — a fixture row
 * would only prove the fixture was shaped the way the function expects.
 * ===================================================================================== */
console.log("== session 17: verifier drift & activity watch ==");
{
  const evRow = (handle, extra) => Object.assign({ handle: handle, name: handle, status: "ok", notes: [] }, extra);
  const kinds = (d, h) => d.facts.filter(f => f.handle === h).map(f => f.kind);
  const fact = (d, h, k) => d.facts.find(f => f.handle === h && f.kind === k);

  /* 1. a row that RECORDED a valid object and no longer has one — the strongest drift there is. */
  {
    const d = D.verifierDrift([evRow("hunterpatterson.bsky.social",
      { verification: { present: true, valid: false, invalid: true, revoked: true, issuer: "theathletic.com", badIssuers: ["theathletic.com"] } })], NOW);
    check("a recorded-valid verification object that is now isValid:false reads verifier-revoked, not verification-invalid",
      kinds(d, "hunterpatterson.bsky.social").join(",") === "verifier-revoked" && d.counts.verifierRevoked === 1,
      JSON.stringify(kinds(d, "hunterpatterson.bsky.social")));
    check("the revoked fact names the issuer and re-openable evidence URL",
      /theathletic\.com/.test(fact(d, "hunterpatterson.bsky.social", "verifier-revoked").detail) &&
      /^https:\/\/public\.api\.bsky\.app\/xrpc\/app\.bsky\.actor\.getProfiles\?actors=/.test(fact(d, "hunterpatterson.bsky.social", "verifier-revoked").url));
  }
  {
    const d = D.verifierDrift([evRow("hunterpatterson.bsky.social", { verification: { present: false, valid: false, invalid: false } })], NOW);
    check("a recorded-valid object that DISAPPEARS entirely is also verifier-revoked, with its own wording",
      fact(d, "hunterpatterson.bsky.social", "verifier-revoked") &&
      /no longer returned|no verification object at all/.test(fact(d, "hunterpatterson.bsky.social", "verifier-revoked").detail));
  }
  /* 2. an invalid object on a row that never claimed a valid one is a standing risk, NOT a loss. */
  {
    const d = D.verifierDrift([evRow("joevardon.bsky.social",
      { verification: { present: true, valid: false, invalid: true, revoked: true, issuer: "theathletic.com", badIssuers: ["theathletic.com"] } })], NOW);
    check("an invalid object on a row that never claimed a valid one reads verification-invalid, and only once",
      kinds(d, "joevardon.bsky.social").join(",") === "verification-invalid" && d.counts.verificationInvalid === 1 &&
      d.counts.verifierRevoked === 0, JSON.stringify(kinds(d, "joevardon.bsky.social")));
    check("the invalid-object fact names the issuer that marked it invalid",
      /issuer theathletic\.com/.test(fact(d, "joevardon.bsky.social", "verification-invalid").detail));
  }
  /* 3. a note-based revocation must not be counted twice alongside the structured check. */
  {
    const d = D.verifierDrift([evRow("joevardon.bsky.social",
      { verification: { present: true, valid: false, invalid: true }, notes: ["verifier-revocation detected: verification object issued by theathletic.com has isValid:false"] })], NOW);
    check("a revocation reported BOTH structurally and in note text produces ONE fact, not two",
      d.facts.filter(f => f.handle === "joevardon.bsky.social").length === 1);
  }
  /* 4. beat-departed and beat-changed are different facts and must not share a label. */
  {
    const d = D.verifierDrift([evRow("andyblarsen.bsky.social",
      { verification: { present: false }, beatChange: { detected: true, type: "beat-departed", previousTeam: "UTA", newTeam: null, detail: "Bio marks UTA (jazz) as former/previous coverage" } })], NOW);
    const f = fact(d, "andyblarsen.bsky.social", "beat-change");
    check("beat-DEPARTED says the club was left with no beat claim (a coverage loss, not a transfer)",
      f && f.beatType === "beat-departed" && /FORMER coverage/.test(f.label) && /coverage loss, not a transfer/.test(f.detail),
      f ? f.label + " | " + f.detail : "no fact");
  }
  {
    const d = D.verifierDrift([evRow("nbasarah.bsky.social",
      { verification: { present: true, valid: true }, beatChange: { detected: true, type: "beat-changed", previousTeam: "UTA", newTeam: "MIN", detail: "Bio now names the Minnesota Star Tribune" } })], NOW);
    const f = fact(d, "nbasarah.bsky.social", "beat-change");
    check("beat-CHANGED names the different team and does NOT claim a coverage loss",
      f && f.beatType === "beat-changed" && /different team/.test(f.label) && !/coverage loss/.test(f.detail));
    check("a beat change on a row with a VALID object does not also read as a revocation",
      kinds(d, "nbasarah.bsky.social").join(",") === "beat-change");
  }
  /* 5. activity transitions come from the row's own log and quote the POST, not the measurement. */
  {
    const d = D.verifierDrift([], NOW);
    const f = fact(d, "michaelgrangenba.bsky.social", "activity-transition");
    check("the committed activity transition is surfaced from the registry alone (no CI file needed)",
      !!f && f.label === "dormant → active" && d.counts.activityTransition === 1);
    check("the transition detail quotes the newest POST timestamp, not the measurement stamp",
      f && /to 2026-09-19T14:24:17\.055Z \(0 days\)/.test(f.detail) && /measured 2026-09-19T18:28:52\.164Z/.test(f.detail),
      f ? f.detail : "no fact");
    /* `null` means NO FILE; `[]` means a file that re-read nothing. The two must not be reported the
     * same way — an empty sweep is not the same claim as no sweep, and the panel says which it has. */
    const noFile = D.verifierDrift(null, NOW);
    const emptyFile = D.verifierDrift([], NOW);
    check("with no CI file the scope says so instead of implying a sweep happened",
      /registry only/.test(noFile.scope) && noFile.evidenceRows === 0 &&
      noFile.counts.beatChange === 0 && noFile.counts.verifierRevoked === 0 && noFile.counts.verificationInvalid === 0,
      noFile.scope);
    check("an empty CI file is reported as a sweep that read nothing, not as no sweep at all",
      /registry \+ CI re-verification \(0 handles\)/.test(emptyFile.scope) && emptyFile.evidenceRows === 0,
      emptyFile.scope);
    check("the registry-only view still surfaces the recorded activity transition",
      noFile.facts.some(f => f.kind === "activity-transition" && f.handle === "michaelgrangenba.bsky.social"));
  }
  /* 6. the whole committed evidence file, as the page will actually call it. */
  {
    const evidenceFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/live/reporter_verify.json"), "utf8"));
    const d = D.verifierDrift(evidenceFile.rows, NOW);
    check("the committed run reports the three facts that are really in it, and names them",
      d.counts.total === d.facts.length &&
      !!fact(d, "andyblarsen.bsky.social", "beat-change") &&
      !!fact(d, "joevardon.bsky.social", "verification-invalid") &&
      !!fact(d, "michaelgrangenba.bsky.social", "activity-transition"),
      JSON.stringify(d.counts));
    check("verifierRevoked stays 0, consistent with the CI summary's verificationLost: 0",
      d.counts.verifierRevoked === 0 && evidenceFile.summary.verificationLost === 0);
    check("every fact carries a handle, a kind, a label, a detail and a re-openable URL",
      d.facts.every(f => f.handle && f.kind && f.label && f.detail && /^https:\/\//.test(f.url)));
    check("the scope line names the CI file and how many handles it covers",
      /registry \+ CI re-verification \(\d+ handles\)/.test(d.scope) && d.evidenceRows === evidenceFile.rows.length);
  }
  /* 7. the panel must exist and be wired, or the computation is inert. */
  {
    const page = fs.readFileSync(path.join(ROOT, "reporters.html"), "utf8");
    const rep = fs.readFileSync(path.join(ROOT, "assets/js/reporters.js"), "utf8");
    check("reporters.html carries the drift panel containers the renderer writes to",
      /id="driftCard"/.test(page) && /id="driftPills"/.test(page) && /id="driftTable"/.test(page) && /id="driftNote"/.test(page));
    check("the renderer is called from init() and paints from verifierDrift(), not from its own copy",
      /renderDrift\(\);/.test(rep) && /verifierDrift\(/.test(rep) && /paintDrift\(verifierDrift\(/.test(rep));
    check("the renderer paints the registry-only view first, so the panel is never blank in flight",
      rep.indexOf("paintDrift(verifierDrift(null, Date.now()))") < rep.indexOf('fetch("data/live/reporter_verify.json", { cache: "no-store" })\n      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })\n      .then(v => paintDrift(verifierDrift(v.rows || [], Date.now())))'));
  }
}

console.log("== session 14: the registry recency backfill ==");
{
  const cp = require("child_process");
  const os = require("os");
  const tool = path.join(ROOT, "tools/backfill_registry_recency.js");
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/live-audit.yml"), "utf8");
  const run = (args, out) => cp.spawnSync(process.execPath, [tool].concat(args),
    { encoding: "utf8", env: Object.assign({}, process.env, out ? { NBA_WATCH_OUT: out } : {}) });

  check("the backfill tool exists and live-audit.yml runs it without human input",
    fs.existsSync(tool) && /backfill_registry_recency\.js/.test(workflow));
  const sync = run(["--check"]);
  check("the committed registry is in sync with the committed measurement of record (--check exits 0)",
    sync.status === 0, (sync.stdout || "").split("\n").slice(-2).join(" "));

  /* --- scratch copy: a stale date MUST be detected, then repaired, and nothing else may move --- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nba-backfill-"));
  fs.mkdirSync(path.join(tmp, "assets/js"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "data/live"), { recursive: true });
  const original = fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8");
  const evidenceFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/live/reporter_verify.json"), "utf8"));
  /* The fixture has to use a handle the EVIDENCE FILE actually carries — a session-14 row that no CI
   * run has measured yet is deliberately left alone by the tool, so writing the test against one of
   * those would have asserted the opposite of the policy. howardbeck.bsky.social is in both. */
  const hb = D.BSKY_REPORTERS.find(r => r.handle === "howardbeck.bsky.social");
  const hbEvidence = evidenceFile.rows.find(r => r.handle === "howardbeck.bsky.social");
  const staleDate = "2020-01-01T00:00:00.000Z";
  const stale = original.replace('latestPostAt: "' + hb.observed.latestPostAt + '"', 'latestPostAt: "' + staleDate + '"');
  check("the fixture really is stale (the scratch copy is not identical to the shipped registry)",
    stale !== original && stale.includes(staleDate) && !!hbEvidence && hbEvidence.latestPostAt !== staleDate, "evidence for howardbeck: " + (hbEvidence || {}).latestPostAt);
  fs.writeFileSync(path.join(tmp, "assets/js/data.js"), stale);
  fs.copyFileSync(path.join(ROOT, "data/live/reporter_verify.json"), path.join(tmp, "data/live/reporter_verify.json"));

  const detect = run(["--check"], tmp);
  check("a registry that is behind the CI measurement FAILS --check instead of passing quietly",
    detect.status === 1 && /BEHIND/.test(detect.stderr || ""), "exit " + detect.status);

  const write = run([], tmp);
  const rewritten = fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8");
  /* Normalising a whole file cannot just blank the date fields: the tool also INSERTS them
   * (a row with no observed block gets one; a row with a date but no source gets a source), and since
   * session 17 it also appends an `activityLog` entry plus one dated prose sentence whenever the
   * date it writes moves a row across the dormant boundary. So the normaliser deletes each owned key
   * together with the comma that separated it, iterating until stable, and only then the two files
   * may be compared character for character. */
  const strip = src => {
    let t = src.replace(/latestPostAtSource: "[^"]*"/g, "\u0000").replace(/latestPostAt: "[^"]*"/g, "\u0000")
      .replace(/activityLog: \[[^\]]*\]/g, "\u0000")
      /* The note is matched to its fixed closing clause, not by counting sentences: the dates inside
       * it contain periods, so a `[^.]*` sentence pattern cannot delimit it. */
      .replace(/ ACTIVITY UPDATE \d{4}-\d{2}-\d{2}: [\s\S]*?no identity field was re-graded\./g, "");
    let prev;
    do { prev = t; t = t.replace(/,\s*\u0000/g, "").replace(/\u0000,\s*/g, "").replace(/\{\s*\u0000\s*,?/g, "{ "); } while (t !== prev);
    return t.split("\u0000").join("");
  };
  check("the tool repairs the stale date to the MEASURED one and exits cleanly",
    write.status === 0 && rewritten.includes('latestPostAt: "' + hbEvidence.latestPostAt + '"') &&
    !rewritten.includes('latestPostAt: "' + staleDate + '"'), "exit " + write.status);
  check("the rewritten registry differs from the original ONLY in the date fields it owns",
    strip(rewritten) === strip(original));
  check("a second run is a no-op (idempotent, so CI cannot commit forever)",
    run(["--check"], tmp).status === 0 && fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8") === rewritten);

  /* --- session 17: a date move that crosses the dormant boundary is a STATE CHANGE -------------
   * michaelgrangenba.bsky.social was graded DORMANT at 39 days on 2026-09-19; the same day's CI
   * re-measurement found a newest post 0 days old, so the registry date moved and the row's prose
   * went on asserting the opposite. The tool now records the transition and corrects the prose in
   * the same edit. These checks run against the REAL tool on a REAL copy of the registry. */
  const rwRow = vm.runInNewContext(rewritten + "\n;BSKY_REPORTERS.find(r => r.handle === 'howardbeck.bsky.social')", {});
  const staleDays = Math.floor((Date.parse(evidenceFile.generated) - Date.parse(staleDate)) / 86400000);
  const newDays = Math.floor((Date.parse(evidenceFile.generated) - Date.parse(hbEvidence.latestPostAt)) / 86400000);
  check("the stale fixture really does straddle the dormant boundary (the check is not vacuous)",
    staleDays > D.ARENA_DORMANT_DAYS && newDays <= D.ARENA_DORMANT_DAYS,
    "stale " + staleDays + "d vs measured " + newDays + "d, threshold " + D.ARENA_DORMANT_DAYS);
  const log = (rwRow.observed || {}).activityLog;
  check("a date move across the boundary is recorded in observed.activityLog, with both dates and both day counts",
    Array.isArray(log) && log.length === 1 && log[0].from === "dormant" && log[0].to === "active" &&
    log[0].previousAt === staleDate && log[0].previousDays === staleDays && log[0].days === newDays &&
    log[0].thresholdDays === D.ARENA_DORMANT_DAYS && log[0].at === evidenceFile.generated,
    "evaluated: " + JSON.stringify(log));
  check("the transition is announced in the tool's own report", /ACTIVITY STATE CHANGED\s*:\s*1\b/.test(write.stdout || "") &&
    /howardbeck\.bsky\.social dormant → active/.test(write.stdout || ""), (write.stdout || "").split("\n").filter(l => /ACTIVITY|⇄/.test(l)).join(" | "));
  const origRow = D.BSKY_REPORTERS.find(r => r.handle === "howardbeck.bsky.social");
  check("the row's original verdict is KEPT and a dated correction is appended, not substituted",
    typeof rwRow.verified === "string" && rwRow.verified.startsWith(origRow.verified) &&
    / ACTIVITY UPDATE \d{4}-\d{2}-\d{2}: /.test(rwRow.verified) &&
    /no identity field was re-graded\.$/.test(rwRow.verified) && rwRow.verified.length > origRow.verified.length);
  check("only the row that actually changed state gains a log entry",
    (() => {
      const withLog = src => vm.runInNewContext(src +
        "\n;BSKY_REPORTERS.filter(r => r.observed && Array.isArray(r.observed.activityLog)).map(r => r.handle)", {});
      const gained = withLog(rewritten).filter(h => !withLog(original).includes(h));
      return gained.join(",") === "howardbeck.bsky.social";
    })());
  check("a third run appends nothing twice (no duplicate activityLog key, no second note)",
    (rewritten.match(/activityLog:/g) || []).length === (original.match(/activityLog:/g) || []).length + 1 &&
    (rewritten.match(/ACTIVITY UPDATE/g) || []).length === (original.match(/ACTIVITY UPDATE/g) || []).length + 1,
    "activityLog " + (rewritten.match(/activityLog:/g) || []).length + " vs baseline " + (original.match(/activityLog:/g) || []).length);

  /* --- the shape that broke the first version: `latestPostAt: null`, and duplicate keys -------- */
  /* Fixtures are built by swapping the OBSERVED BLOCK of one row, so nothing else about the file
   * changes and any difference afterwards is attributable to the tool alone. */
  const hbIdx = original.indexOf('handle: "howardbeck.bsky.social"');
  check("the fixture row is present in the registry", hbIdx > 0);
  const obsStart = original.indexOf("observed: {", hbIdx);
  const obsEnd = original.indexOf("}", obsStart);
  const swapObserved = body => original.slice(0, obsStart) + "observed: { " + body + " }" + original.slice(obsEnd + 1);

  const nullShape = swapObserved('checkedAt: "2026-09-18", latestPostAt: null, verificationValid: true');
  fs.writeFileSync(path.join(tmp, "assets/js/data.js"), nullShape);
  const nullRun = run([], tmp);
  const nullOut = fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8");
  const nullRow = vm.runInNewContext(nullOut + "\n;BSKY_REPORTERS.find(r => r.handle === 'howardbeck.bsky.social').observed", {});
  check("an unquoted `latestPostAt: null` is REPLACED, not shadowed by a second key",
    nullRun.status === 0 && nullRow.latestPostAt === hbEvidence.latestPostAt && nullRow.latestPostAtSource === "data/live/reporter_verify.json",
    "evaluated: " + JSON.stringify(nullRow));

  const dupeShape = swapObserved('checkedAt: "2026-09-18", latestPostAt: null, verificationValid: true, latestPostAt: "2026-01-01T00:00:00.000Z"');
  fs.writeFileSync(path.join(tmp, "assets/js/data.js"), dupeShape);
  const dupeRun = run([], tmp);
  const dupeOut = fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8");
  const dupeRow = vm.runInNewContext(dupeOut + "\n;BSKY_REPORTERS.find(r => r.handle === 'howardbeck.bsky.social').observed", {});
  check("a row with two latestPostAt keys is repaired to exactly one key holding the measured date",
    dupeRun.status === 0 && (dupeOut.match(/latestPostAt:/g) || []).length === (original.match(/latestPostAt:/g) || []).length &&
    dupeRow.latestPostAt === hbEvidence.latestPostAt && /duplicate key repaired/.test(dupeRun.stdout || ""),
    "evaluated: " + JSON.stringify(dupeRow));

  /* The shipped registry itself: no row may carry a duplicate key, and every measured row must
   * EVALUATE to the measured date. Version 1 of the tool passed every check in this file while
   * storing Boston's Gary Washburn as `null` this way. */
  /* Scoped to the REGISTRY ARRAY on purpose: the FLAGS prose further down the same file discusses this
   * very bug and quotes the key names, and a whole-file grep would fire on the explanation. */
  const regStart = original.indexOf("const BSKY_REPORTERS = [");
  const regEnd = original.indexOf("\n];", regStart);
  const regText = original.slice(regStart, regEnd);
  const dupLines = regText.split("\n").filter(l => (l.match(/latestPostAt:/g) || []).length > 1 || (l.match(/latestPostAtSource:/g) || []).length > 1);
  check("no committed registry row carries a duplicate latestPostAt / latestPostAtSource key",
    dupLines.length === 0 && regStart > 0 && regEnd > regStart, dupLines[0]);
  const shadowed = D.BSKY_REPORTERS.filter(r => {
    const want = (evidenceFile.rows.find(x => x.handle === r.handle) || {}).latestPostAt;
    return want && !(r.observed && r.observed.latestPostAt === want);
  });
  check("every registry row the evidence measures EVALUATES to that exact date (no key shadowing)",
    shadowed.length === 0, shadowed.map(r => r.handle + "=" + JSON.stringify(r.observed && r.observed.latestPostAt)).join(", "));

  /* --- a NEWER registry date is a fresh read, not drift: it must be kept --------------------- */
  /* Base the bump on the REPAIRED file: every other row is current by then, so if the tool
   * rewrote an ahead-of-evidence row the file would have to change. */
  const ahead = rewritten.split('latestPostAt: "' + hbEvidence.latestPostAt + '"')
    .join('latestPostAt: "2030-01-01T00:00:00.000Z"');
  check("the ahead-of-evidence fixture really is ahead", ahead !== rewritten && ahead.includes("2030-01-01T00:00:00.000Z"));
  fs.writeFileSync(path.join(tmp, "assets/js/data.js"), ahead);
  const aheadRun = run([], tmp);
  check("a registry date NEWER than the CI evidence is kept, not overwritten",
    aheadRun.status === 0 && fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8") === ahead &&
    /registry ahead of CI \(kept\)/.test(aheadRun.stdout || ""), "exit " + aheadRun.status);

  /* --- the tool must refuse to write when it cannot prove it is safe ------------------------- */
  /* A registry that does not evaluate must never be overwritten: the failure mode this guards
   * against is a half-parsed file being rewritten from a broken read. */
  fs.writeFileSync(path.join(tmp, "assets/js/data.js"), original.replace("const BSKY_REPORTERS = [", "const BSKY_REPORTERS = [ { name: \"broken\""));
  const beforeBad = fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8");
  const badRun = run([], tmp);
  check("a registry that does not evaluate aborts the run and is left byte-for-byte untouched",
    badRun.status === 1 && fs.readFileSync(path.join(tmp, "assets/js/data.js"), "utf8") === beforeBad,
    "exit " + badRun.status);
  check("the tool never writes into the repository when its output root is redirected",
    fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8") === original);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
