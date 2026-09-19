#!/usr/bin/env node
"use strict";
// Automatic forward observation ledger. Agreement is not accuracy; no absence-based verdicts.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = process.env.NBA_WATCH_OUT || path.join(__dirname, '..');
const read = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p))); } catch { return {}; } };
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function identify(text, players) {
  const t = ' ' + fold(text) + ' ';
  const hits = players.filter(p => t.includes(' ' + fold(p.player) + ' '));
  const unique = [...new Map(hits.map(p => [p.playerId || fold(p.player), p])).values()];
  return unique.length === 1 ? unique[0] : null;
}
function claimStatus(text) {
  // Deliberately narrow: quotes, alternatives, denials, future games and multi-player text are not auto-adjudicated.
  if (/\b(not|never|if|could|might|tomorrow|yesterday|previously|last|return)\b|[?"“”]/i.test(text)) return null;
  if (/\b(ruled out|is out|will miss tonight|out tonight)\b/i.test(text)) return 'Out';
  if (/\bquestionable\b/i.test(text)) return 'Questionable';
  if (/\bdoubtful\b/i.test(text)) return 'Doubtful';
  return null;
}
function reconcile(claim, official) {
  if (!claim.player || !claim.status || claim.inGameWatch || official.health !== 'ok') return null;
  const delta = Date.parse(official.reportAt) - Date.parse(claim.postedAt);
  if (!(delta >= 0 && delta <= 4 * 3600000)) return null;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date(claim.postedAt));
  const matches = (official.rows || []).filter(r => fold(r.player) === fold(claim.player) && r.gameDate === day);
  if (matches.length !== 1) return null;
  const row = matches[0];
  return { outcome: row.status === claim.status ? 'corroborated' : 'conflict-review',
    status: row.status, url: row.url, reportAt: official.reportAt, gameDate: row.gameDate,
    note: 'Later official designation, not proof of predictive accuracy. Status can legitimately change.' };
}
/* ============================================================================
 * SECOND RECONCILIATION LANE — the ESPN structured injury board.
 * The official NBA PDF is published on game days only (and was 404 for the whole
 * 2026-27 audit window), so a ledger that only reconciles against it can never
 * resolve anything between seasons. The board lane compares a resolved one-player
 * claim (Out / Questionable / Doubtful) with the FIRST ESPN board observation for
 * that player that provably postdates the post:
 *   - our own sighting time must be after the post (we only saw it afterwards), AND
 *   - ESPN's own status stamp, when present, must also be after the post
 *     (guards a stale stamp: e.g. a listing stamped 2026-02-09 first observed
 *     2026-09-17 must not "resolve" a post from September — verified on the
 *     committed 2026-09-19 history ledger),
 *   - within 72 hours of the post (a listing older than that no longer speaks to it).
 * Exact same-status agreement => 'board-agreement'; a different mappable status =>
 * 'board-conflict-review'. Unmappable statuses (Probable etc.) and SILENCE are not
 * evidence either way — the claim stays pending. Agreement with ESPN is NOT official
 * confirmation and NOT accuracy: the official-PDF lane stays higher authority and
 * overrides a board outcome the moment it matures.
 * ========================================================================== */
const BOARD_WINDOW_MS = 3 * 86400000;
function boardStatus(status) {
  const s = String(status || '').toLowerCase();
  // ESPN's out-vocabulary observed on the board: "Out", "Out For Season", "Out Indefinitely".
  if (/^out\b/.test(s) || s.includes('indefinitely')) return 'Out';
  if (s.includes('doubtful')) return 'Doubtful';
  if (s.includes('day-to-day') || s.includes('questionable')) return 'Questionable';
  return null; // probable/available/anything else never answers an Out/Questionable/Doubtful claim
}
function reconcileBoard(claim, observations) {
  if (!claim || !claim.player || !claim.status || claim.inGameWatch || claim.outcome !== 'pending') return null;
  const postedAt = Date.parse(claim.postedAt);
  if (!Number.isFinite(postedAt)) return null;
  const matches = [];
  for (const o of observations || []) {
    if (claim.playerId && o.playerId ? String(o.playerId) !== String(claim.playerId) : fold(o.player) !== fold(claim.player)) continue;
    if (claim.team && o.team && claim.team !== o.team) continue;
    const st = boardStatus(o.status);
    if (!st) continue;
    const seen = Date.parse(o.observedAt);
    const stamped = o.sourceAt ? Date.parse(o.sourceAt) : null;
    /* Two postdate guards, both required:
     *  - we only SAW the listing after the post (a sighting that precedes the post while its stamp
     *    moved later is a stamp-bump ambiguity: the text we captured may predate the new stamp), and
     *  - ESPN's own status stamp, when present, must also be after the post (the Furphy guard: a
     *    stale stamp must not "resolve" a fresh report). */
    if (!Number.isFinite(seen) || seen < postedAt) continue;
    if (stamped != null && Number.isFinite(stamped) && stamped < postedAt) continue;
    /* The 72-hour window judges the EVIDENCE time (ESPN's stamp, else our sighting), not our
     * sighting alone — a poller gap cannot erase evidence that was genuinely public in time. */
    const evidenceAt = stamped != null && Number.isFinite(stamped) ? stamped : seen;
    if (evidenceAt < postedAt || evidenceAt - postedAt > BOARD_WINDOW_MS) continue;
    matches.push({ st, seen, evidenceAt, url: o.url, sourceAt: o.sourceAt || null });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => a.evidenceAt - b.evidenceAt || a.seen - b.seen);
  const first = matches[0];
  return { outcome: first.st === claim.status ? 'board-agreement' : 'board-conflict-review',
    layer: 'espn-board', status: first.st, url: first.url,
    observedAt: new Date(first.seen).toISOString(), sourceAt: first.sourceAt,
    note: 'ESPN structured-board comparison (secondary layer, not official confirmation). Status can legitimately change; a disagreement is for review, not a wrong-report penalty.' };
}
function build(snapshot, official, context, prior = {}, now = new Date().toISOString()) {
  const fresh = Date.parse(now) - Date.parse(snapshot.generated);
  const valid = Number.isFinite(fresh) && fresh >= -60000 && fresh < 20 * 60000;
  const rows = valid && !snapshot.errors?.injuries ? snapshot.injuries?.rows || [] : [];
  const rosterPlayers = Object.values(context.rosters || {}).filter(r => Date.parse(now) - Date.parse(r.fetchedAt) < 48 * 3600000).flatMap(r => r.players || []);
  const players = rosterPlayers.concat(rows);
  const claims = { ...(prior.claims || {}) };
  if (valid && !snapshot.errors?.social) for (const post of snapshot.posts || []) {
    if (!post.uri || claims[post.uri]) continue;
    const player = identify(post.text, players);
    claims[post.uri] = { uri: post.uri, handle: post.handle, name: post.name, text: post.text, url: post.url,
      textSha256: crypto.createHash('sha256').update(post.text).digest('hex'),
      postedAt: post.createdAt, firstObservedAt: now, player: player?.player || null,
      playerId: player?.playerId || null, team: player?.team || null,
      status: claimStatus(post.text), inGameWatch: post.inGameWatch === true,
      // identity evidence established when the poller collected the post (reporter list/bio evidence
      // counts); bskyVerified is the stronger Bluesky-object subset, kept separate for scoring
      identityVerifiedAtCollection: post.verified === true, bskyVerified: post.bskyVerified === true, outcome: 'pending',
      note: player ? 'Awaiting game-scoped official evidence; no score from silence.' : 'Player unresolved or multiple players; not auto-scored.' };
  }
  /* Board-lane observation universe: the current snapshot's listings (sighted at the snapshot's own
   * generation time) plus every history entry (a listing change we sighted earlier). Both carry the
   * two timestamps reconcileBoard requires. Bounded to the same 30-day working set as the history. */
  const boardObs = [];
  if (valid && !snapshot.errors?.injuries) for (const row of rows) {
    boardObs.push({ player: row.player, playerId: row.playerId, team: row.team, status: row.status,
      sourceAt: row.updated || null, observedAt: snapshot.generated, url: row.teamUrl || null });
  }
  for (const h of (prior.history || []).filter(h => Number.isFinite(Date.parse(h.observedAt)) && Date.parse(now) - Date.parse(h.observedAt) < 30 * 86400000)) {
    boardObs.push({ player: h.player, playerId: h.playerId, team: h.team, status: h.status,
      sourceAt: h.sourceUpdatedAt || null, observedAt: h.observedAt || null, url: h.url || null });
  }
  for (const claim of Object.values(claims)) {
    if (!claim.identityVerifiedAtCollection) continue; // unverified-identity posts are never auto-adjudicated
    if (claim.outcome === 'pending') {
      const evidence = reconcile(claim, official);
      if (evidence) { claim.evidence = { ...evidence, layer: 'official-pdf' }; claim.outcome = evidence.outcome; }
    }
    if (claim.outcome === 'pending') {
      const evidence = reconcileBoard(claim, boardObs);
      if (evidence) { claim.evidence = evidence; claim.outcome = evidence.outcome; }
    } else if (claim.outcome === 'board-agreement' || claim.outcome === 'board-conflict-review') {
      /* Authority order: a maturing official designation overrides the board layer, never the other
       * way round. The superseded board read is kept on the record, not erased. */
      const evidence = reconcile(claim, official);
      if (evidence) { claim.supersededBoardOutcome = claim.outcome; claim.evidence = { ...evidence, layer: 'official-pdf', supersedes: claim.outcome }; claim.outcome = evidence.outcome; }
    }
  }
  // Bounded public working set; per-run raw history is separately retained for 30 days.
  for (const [key, value] of Object.entries(claims)) if (Date.parse(now) - Date.parse(value.firstObservedAt) > 30 * 86400000) delete claims[key];
  const history = (prior.history || []).filter(h => Date.parse(now) - Date.parse(h.observedAt) < 30 * 86400000);
  const baseline = { ...(prior.baseline || {}) };
  for (const row of rows) {
    const key = String(row.playerId || row.player) + ':' + row.team;
    if (baseline[key] === row.fp) continue;
    history.push({ key, player: row.player, playerId: row.playerId, team: row.team, status: row.status,
      reason: row.bodyPart, sourceUpdatedAt: row.updated, observedAt: now, url: row.teamUrl,
      change: baseline[key] ? 'changed listing' : 'first observed (not injury onset)' });
    baseline[key] = row.fp;
  }
  const scores = {};
  for (const c of Object.values(claims)) {
    const s = scores[c.handle] ||= { handle: c.handle, name: c.name, observed: 0, corroborated: 0, conflicts: 0, boardAgree: 0, boardConflicts: 0, pending: 0, resolved: 0, forwardScore: 0, agreementRate: null, accuracy: null };
    s.observed++;
    if (c.outcome === 'corroborated') s.corroborated++;
    else if (c.outcome === 'conflict-review') s.conflicts++;
    else if (c.outcome === 'board-agreement') s.boardAgree++;
    else if (c.outcome === 'board-conflict-review') s.boardConflicts++;
    else s.pending++;
    const resolved = s.corroborated + s.conflicts + s.boardAgree + s.boardConflicts;
    /* Forward score — agreement counting, not an accuracy rating: official corroboration 3 pts,
     * ESPN-board agreement 1 pt. Conflicts are shown for review and NEVER subtracted, because a
     * later status change is not proof the reporter was wrong. `accuracy` stays null on purpose. */
    s.resolved = resolved;
    s.forwardScore = s.corroborated * 3 + s.boardAgree;
    s.agreementRate = resolved ? Math.round(100 * (s.corroborated + s.boardAgree) / resolved) : null;
  }
  /* In-game exit signals per player, for the lineup-impact layer. A post is REPORTED evidence,
   * never a league designation, and only an exactly resolved player is attached. */
  const exits = {};
  for (const c of Object.values(claims)) {
    if (!c.inGameWatch || !c.player) continue;
    const key = String(c.playerId || c.player);
    const at = Date.parse(c.postedAt || c.firstObservedAt || 0) || 0;
    if (!exits[key] || at > (exits[key].at || 0)) exits[key] = { player: c.player, playerId: c.playerId || null, team: c.team || null, name: c.name, handle: c.handle, postedAt: c.postedAt, url: c.url, text: String(c.text || '').slice(0, 240), at, status: 'reported-unconfirmed' };
  }
  return { generated: now, inputGenerated: snapshot.generated, inputFresh: valid, claims, scores: Object.values(scores).sort((a, b) => b.forwardScore - a.forwardScore || b.observed - a.observed || String(a.handle).localeCompare(String(b.handle))), baseline, history: history.slice(-10000), exits,
    exitNote: 'exits maps a player to the most recent monitored-post in-game exit signal. Unconfirmed by design: a social post is not an official designation.',
    scoringNote: 'Forward score = 3 pts per official-NBA-report corroboration + 1 pt per ESPN-board agreement in the same status bucket (Out; Questionable — ESPN "Day-To-Day" counts here; Doubtful), over posts collected from 2026-09-17 onward. Conflicts are flagged for review, never subtracted. Pending includes unresolved players, multi-player text, in-game claims and reports no later evidence answered. Agreement is NOT accuracy; this is not a historical scorecard or a global first-to-report ranking.',
    note: 'Automatic evidence ledger. Two reconciliation lanes, official first: the NBA game-day PDF (highest authority) then the ESPN structured board (secondary, not official). No historical accuracy or global first-to-report score is asserted. Conflicts require review, not a wrong-report penalty.' };
}
if (require.main === module) {
  const data = build(read('data/live/latest.json'), read('data/live/official.json'), read('data/live/context.json'), read('data/live/intelligence.json'));
  fs.mkdirSync(path.join(ROOT, 'data/live'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data/live/intelligence.json'), JSON.stringify(data, null, 2) + '\n');
  console.log('intelligence:', Object.keys(data.claims).length, 'observations;', data.history.length, 'history entries');
}
module.exports = { identify, claimStatus, reconcile, reconcileBoard, boardStatus, BOARD_WINDOW_MS, build };
