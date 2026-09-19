#!/usr/bin/env node
/* =====================================================================================
 * intelligence_test.js — tests for the AUTOMATIC REPORTER EVIDENCE LEDGER + FORWARD SCORE
 *
 * The ledger (tools/build_intelligence.js) resolves one-player social claims against two
 * layers, official first:
 *   lane 1 — the NBA game-day report PDF (highest authority; reconcile)
 *   lane 2 — the ESPN structured injury board (secondary, never official; reconcileBoard)
 * and computes a forward score that counts AGREEMENT ONLY — never an accuracy rating:
 * official corroboration 3 pts, board agreement 1 pt, conflicts review-only (0, never negative).
 *
 * These tests pin the timestamp guards that keep the board lane honest:
 *   - only board evidence that PROVABLY postdates the post can resolve it
 *     (our sighting time AND ESPN's own status stamp must both be after the post), and
 *   - anything later than 72 h after the post no longer speaks to it, and
 *   - silence is not a verdict: an unanswered claim stays pending forever,
 *   - an unverified identity is never auto-adjudicated,
 *   - an official designation overrides a board outcome, never the reverse.
 *
 * Run: node tools/intelligence_test.js
 * ===================================================================================== */
"use strict";
const assert = require("node:assert/strict");
const { identify, claimStatus, reconcile, reconcileBoard, boardStatus, BOARD_WINDOW_MS, build } = require("./build_intelligence");

let checks = 0;
function check(name, fn) { try { fn(); checks++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n", e); process.exitCode = 1; } }

const NOW = "2026-09-19T12:00:00.000Z";
const POST = "2026-09-19T10:00:00.000Z";
function claim(over = {}) {
  return { uri: "at://x/1", handle: "rep.bsky.social", name: "Reporter", text: "Ace Bailey is out tonight", url: "https://bsky.app/profile/rep.bsky.social/post/1",
    textSha256: "x", postedAt: POST, firstObservedAt: NOW, player: "Ace Bailey", playerId: "77", team: "UTA",
    status: "Out", inGameWatch: false, identityVerifiedAtCollection: true, outcome: "pending", ...over };
}
const obs = (over = {}) => ({ player: "Ace Bailey", playerId: "77", team: "UTA", status: "Out", sourceAt: "2026-09-19T10:30Z", observedAt: "2026-09-19T11:00Z", url: "https://www.espn.com/nba/team/injuries/_/name/utah", ...over });

check("boardStatus maps the ESPN vocabulary to the claim tri-state and refuses everything else", () => {
  assert.equal(boardStatus("Out"), "Out");
  assert.equal(boardStatus("Out For Season"), "Out");
  assert.equal(boardStatus("out indefinitely"), "Out");
  assert.equal(boardStatus("Doubtful"), "Doubtful");
  assert.equal(boardStatus("Day-To-Day"), "Questionable");
  assert.equal(boardStatus("Questionable"), "Questionable");
  assert.equal(boardStatus("Probable"), null);
  assert.equal(boardStatus("Available"), null);
  assert.equal(boardStatus(""), null);
  assert.equal(boardStatus(null), null);
});

check("reconcileBoard: exact same-status board evidence postdating the post resolves as board-agreement", () => {
  const ev = reconcileBoard(claim(), [obs()]);
  assert.equal(ev.outcome, "board-agreement");
  assert.equal(ev.layer, "espn-board");
  assert.equal(ev.status, "Out");
  assert.equal(ev.observedAt, "2026-09-19T11:00:00.000Z");
  assert.match(ev.note, /not official/i);
});

check("reconcileBoard: status disagreement is flagged for review, never an error verdict", () => {
  const ev = reconcileBoard(claim(), [obs({ status: "Day-To-Day" })]);
  assert.equal(ev.outcome, "board-conflict-review");
  assert.equal(ev.status, "Questionable");
});

check("reconcileBoard: STALE ESPN STAMP cannot resolve — the Furphy guard", () => {
  // Real counter-example from the committed 2026-09-19 history: a listing stamped 2026-02-09 first
  // observed 2026-09-17 must not resolve a September post. Sighting is after the post; stamp is not.
  const ev = reconcileBoard(claim(), [obs({ sourceAt: "2026-02-09T21:43Z", observedAt: "2026-09-19T11:00Z" })]);
  assert.equal(ev, null);
});

check("reconcileBoard: a listing we first sighted BEFORE the post is not later evidence", () => {
  assert.equal(reconcileBoard(claim(), [obs({ observedAt: "2026-09-19T09:30Z", sourceAt: "2026-09-19T11:30Z" })]), null);
});

check("reconcileBoard: evidence later than 72 h after the post no longer speaks to it", () => {
  assert.equal(BOARD_WINDOW_MS, 3 * 86400000);
  assert.equal(reconcileBoard(claim(), [obs({ observedAt: "2026-09-22T10:30Z", sourceAt: "2026-09-22T10:15Z" })]), null);
  // boundary: evidence time exactly 72 h after the post still counts
  const ev = reconcileBoard(claim(), [obs({ observedAt: "2026-09-22T10:00:00.000Z", sourceAt: "2026-09-22T10:00Z" })]);
  assert.ok(ev && ev.outcome === "board-agreement");
});

check("reconcileBoard: the window judges EVIDENCE time, so a poller gap cannot erase in-time evidence", () => {
  // Status was public (stamp) 1 h after the post; this project only sighted it 5 days later.
  // The stamp proves the evidence was in time — the claim still resolves.
  const ev = reconcileBoard(claim(), [obs({ observedAt: "2026-09-24T12:00Z", sourceAt: "2026-09-19T11:00Z" })]);
  assert.ok(ev && ev.outcome === "board-agreement");
  assert.equal(ev.observedAt, "2026-09-24T12:00:00.000Z", "sighting time recorded for review");
  // …but no stamp means the sighting itself is the evidence time, and a 5-day sighting is too late.
  assert.equal(reconcileBoard(claim(), [obs({ observedAt: "2026-09-24T12:00Z", sourceAt: null })]), null);
});

check("reconcileBoard: comparator is the earliest by EVIDENCE time, sighting breaks ties", () => {
  const ev = reconcileBoard(claim(), [
    obs({ status: "Out", observedAt: "2026-09-19T11:30Z", sourceAt: "2026-09-19T11:00Z" }),
    obs({ status: "Day-To-Day", observedAt: "2026-09-19T11:05Z", sourceAt: "2026-09-19T10:45Z" })
  ]);
  assert.equal(ev && ev.outcome, "board-conflict-review", "10:45 evidence precedes the 11:00 Out read");
});

check("reconcileBoard: the earliest qualifying observation is the comparator", () => {
  const ev = reconcileBoard(claim(), [
    obs({ status: "Day-To-Day", observedAt: "2026-09-19T15:00Z", sourceAt: "2026-09-19T14:30Z" }),
    obs({ status: "Out", observedAt: "2026-09-19T11:00Z", sourceAt: "2026-09-19T10:30Z" })
  ]);
  assert.equal(ev.outcome, "board-agreement"); // earliest is the Out read at 11:00
});

check("reconcileBoard: unmapped statuses (Probable/Available) and SILENCE are not evidence", () => {
  assert.equal(reconcileBoard(claim(), [obs({ status: "Probable" })]), null);
  assert.equal(reconcileBoard(claim(), []), null);
  assert.equal(reconcileBoard(claim(), null), null);
});

check("reconcileBoard: identity gating — player, status, in-game watch and pending are all required", () => {
  assert.equal(reconcileBoard(claim({ player: null }), [obs()]), null);
  assert.equal(reconcileBoard(claim({ status: null }), [obs()]), null);
  assert.equal(reconcileBoard(claim({ inGameWatch: true }), [obs()]), null);
  assert.equal(reconcileBoard(claim({ outcome: "corroborated" }), [obs()]), null);
  assert.equal(reconcileBoard(claim({ postedAt: "not-a-date" }), [obs()]), null);
  assert.equal(reconcileBoard(null, [obs()]), null);
});

check("reconcileBoard: player matching is by id when both are known, strict name otherwise, team-respecting", () => {
  assert.equal(reconcileBoard(claim(), [obs({ playerId: "999", player: "Ace Bailey" })]), null, "different id, same name: no");
  const byId = reconcileBoard(claim({ player: "Typo Bailey" }), [obs({ player: "Ace Bailey" })]);
  assert.equal(byId && byId.outcome, "board-agreement", "same id survives a name typo");
  assert.equal(reconcileBoard(claim({ playerId: null }), [obs({ playerId: null, player: "ace baïley" })]).outcome, "board-agreement", "folded name match");
  assert.equal(reconcileBoard(claim(), [obs({ team: "SAS" })]), null, "team mismatch excluded");
});

function snap(over = {}) {
  return { generated: NOW, errors: {}, injuries: { rows: [] }, posts: [], ...over };
}
const espnRow = (over = {}) => ({ player: "Ace Bailey", playerId: "77", team: "UTA", status: "Out", updated: "2026-09-19T10:30Z", teamUrl: "https://www.espn.com/nba/team/injuries/_/name/utah", fp: "f1", ...over });

check("build: a pending identity-verified claim resolves against the current board snapshot; forward score counts it", () => {
  const prior = { claims: { "at://x/1": claim() }, history: [], baseline: {} };
  const d = build(snap({ injuries: { rows: [espnRow()] } }), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.claims["at://x/1"].outcome, "board-agreement");
  assert.equal(d.claims["at://x/1"].evidence.layer, "espn-board");
  const s = d.scores.find(x => x.handle === "rep.bsky.social");
  assert.equal(s.boardAgree, 1);
  assert.equal(s.forwardScore, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.agreementRate, 100);
  assert.equal(s.accuracy, null, "accuracy is never asserted");
});

check("build: history entries are board evidence too (both timestamps must postdate the post)", () => {
  const prior = { claims: { "at://x/1": claim() }, history: [
    { key: "77:UTA", player: "Ace Bailey", playerId: "77", team: "UTA", status: "Out", reason: "Ankle", sourceUpdatedAt: "2026-09-19T10:15Z", observedAt: "2026-09-19T10:20:00Z", url: "https://www.espn.com/nba/team/injuries/_/name/utah", change: "changed listing" },
    { key: "77:UTA", player: "Ace Bailey", playerId: "77", team: "UTA", status: "Out", reason: "Ankle", sourceUpdatedAt: "2026-09-19T10:05Z", observedAt: "2026-09-19T10:10:00Z", url: "https://www.espn.com/nba/team/injuries/_/name/utah", change: "changed listing" }
  ], baseline: {} };
  const d = build(snap(), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.claims["at://x/1"].outcome, "board-agreement");
  assert.equal(d.claims["at://x/1"].evidence.observedAt, "2026-09-19T10:10:00.000Z", "earliest wins");
});

check("build: silence and stale snapshots leave the claim pending with a zero forward score", () => {
  const prior = { claims: { "at://x/1": claim() }, history: [], baseline: {} };
  const stale = snap({ generated: "2026-09-18T00:00:00Z" }); // >20 min old: rows are not board evidence
  const d = build(stale, { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.claims["at://x/1"].outcome, "pending");
  const s = d.scores.find(x => x.handle === "rep.bsky.social");
  assert.equal(s.forwardScore, 0);
  assert.equal(s.resolved, 0);
  assert.equal(s.agreementRate, null);
});

check("build: unverified identity is never auto-adjudicated, even with perfect board evidence", () => {
  const prior = { claims: { "at://x/1": claim({ identityVerifiedAtCollection: false }) }, history: [], baseline: {} };
  const d = build(snap({ injuries: { rows: [espnRow()] } }), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.claims["at://x/1"].outcome, "pending");
});

check("build: a maturing official designation overrides a board outcome and keeps the record", () => {
  const posted = "2026-04-12T18:00:00.000Z"; // within 4 h of the fake official report
  const c = claim({ postedAt: posted, player: "Starter Star", playerId: "9", team: "BOS", status: "Out", outcome: "board-agreement",
    evidence: { outcome: "board-agreement", layer: "espn-board", status: "Out", url: "https://www.espn.com/nba/team/injuries/_/name/bos", observedAt: "2026-04-12T19:00:00.000Z" } });
  const official = { health: "ok", reportAt: "2026-04-12T21:30:00.000Z", rows: [{ player: "Starter Star", teamName: "Boston Celtics", gameDate: "04/12/2026", matchup: "BOS @ MIA", status: "Out", reason: "Injury/Illness - Ankle", url: "https://example.test/pdf" }] };
  const d = build(snap({ generated: "2026-04-12T22:00:00.000Z" }), official, { rosters: {} }, { claims: { "at://x/1": c }, history: [], baseline: {} }, "2026-04-12T22:00:00.000Z");
  const out = d.claims["at://x/1"];
  assert.equal(out.outcome, "corroborated");
  assert.equal(out.evidence.layer, "official-pdf");
  assert.equal(out.evidence.supersedes, "board-agreement");
  assert.equal(out.supersededBoardOutcome, "board-agreement");
  const s = d.scores.find(x => x.handle === "rep.bsky.social");
  assert.equal(s.corroborated, 1);
  assert.equal(s.forwardScore, 3, "official corroboration is 3 pts");
});

check("build: official lane never lets board evidence downgrade a corroboration", () => {
  const c = claim({ outcome: "corroborated", evidence: { layer: "official-pdf", status: "Out" } });
  const d = build(snap({ injuries: { rows: [espnRow({ status: "Day-To-Day" })] } }), { health: "unavailable", rows: [] }, { rosters: {} }, { claims: { "at://x/1": c }, history: [], baseline: {} }, NOW);
  assert.equal(d.claims["at://x/1"].outcome, "corroborated");
  const s = d.scores.find(x => x.handle === "rep.bsky.social");
  assert.equal(s.corroborated, 1);
  assert.equal(s.boardConflicts, 0);
});

check("build: per-reporter forward scores sum agreement only; conflicts review-only, never negative", () => {
  const prior = { claims: {
    "u1": claim({ uri: "u1", outcome: "corroborated" }),
    "u2": claim({ uri: "u2", outcome: "board-agreement" }),
    "u3": claim({ uri: "u3", outcome: "board-conflict-review" }),
    "u4": claim({ uri: "u4", outcome: "conflict-review" }),
    "u5": claim({ uri: "u5", outcome: "pending" })
  }, history: [], baseline: {} };
  const d = build(snap(), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  const s = d.scores.find(x => x.handle === "rep.bsky.social");
  assert.equal(s.observed, 5);
  assert.equal(s.corroborated, 1);
  assert.equal(s.boardAgree, 1);
  assert.equal(s.conflicts, 1);
  assert.equal(s.boardConflicts, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.resolved, 4);
  assert.equal(s.forwardScore, 4, "3 + 1, conflicts add and subtract nothing");
  assert.equal(s.agreementRate, 50);
});

check("build: scores sort by forward score, then volume, and document the rubric in the ledger", () => {
  const other = { ...claim({ uri: "u9", handle: "zzz.bsky.social", name: "Other" }), outcome: "corroborated" };
  const prior = { claims: { "u1": claim({ uri: "u1" }), "u9": other }, history: [], baseline: {} };
  const d = build(snap({ injuries: { rows: [espnRow()] } }), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.scores[0].handle, "zzz.bsky.social", "higher forward score sorts first");
  assert.equal(d.scores[0].forwardScore, 3);
  assert.equal(d.scores[1].handle, "rep.bsky.social");
  assert.equal(d.scores[1].forwardScore, 1);
  assert.match(d.scoringNote, /3 pts.*official.*1 pt.*ESPN/s);
  assert.match(d.scoringNote, /NOT accuracy/);
  assert.match(d.note, /official first/i);
});

check("new-claim creation path keeps identity evidence and the board lane applies to the SAME BUILD cycle", () => {
  // A fresh post collected this run, naming a rostered player, with matching board evidence in the
  // same snapshot: the claim is born, then immediately adjudicated (identity came from the poller).
  const post = { uri: "at://new/1", handle: "rep.bsky.social", name: "Reporter", text: "Ace Bailey is out tonight", url: "https://bsky.app/profile/rep.bsky.social/post/new1",
    createdAt: POST, verified: true, bskyVerified: false, inGameWatch: false };
  const d = build(snap({ injuries: { rows: [espnRow()] }, posts: [post] }), { health: "unavailable", rows: [] },
    { rosters: { UTA: { fetchedAt: NOW, players: [{ player: "Ace Bailey", playerId: "77", team: "UTA" }] } } }, {}, NOW);
  assert.equal(d.claims["at://new/1"].outcome, "board-agreement");
  assert.equal(d.claims["at://new/1"].identityVerifiedAtCollection, true);
});

check("build: board evidence is bounded to the 30-day history working set (aged-out history cannot resolve)", () => {
  // The post is old but the claim is still in the working set (recently observed); the only
  // answering entry is >30 days old, and retire-aged history must not adjudicate anything.
  const prior = { claims: { "at://x/old": claim({ uri: "at://x/old", postedAt: "2026-08-10T10:00:00.000Z", firstObservedAt: NOW }) }, history: [
    { key: "77:UTA", player: "Ace Bailey", playerId: "77", team: "UTA", status: "Out", reason: "Ankle",
      sourceUpdatedAt: "2026-08-11T00:00Z", observedAt: "2026-08-11T00:10:00.000Z", url: "https://www.espn.com/nba/team/injuries/_/name/utah", change: "changed listing" }
  ], baseline: {} };
  const d = build(snap(), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.equal(d.claims["at://x/old"].outcome, "pending");
});

check("existing in-game exit mapping and 30-day pruning are unchanged by the board lane", () => {
  const old = "2026-08-15T00:00:00.000Z";
  const prior = { claims: {
    "keep": claim({ uri: "keep", outcome: "pending" }),
    "drop": claim({ uri: "drop", player: "Old Post", playerId: "1", firstObservedAt: old, postedAt: old })
  }, history: [], baseline: {} };
  const d = build(snap(), { health: "unavailable", rows: [] }, { rosters: {} }, prior, NOW);
  assert.ok(d.claims["keep"]);
  assert.equal(d.claims["drop"], undefined, "older than 30 days is pruned");
});

console.log(checks + " intelligence checks passed");
