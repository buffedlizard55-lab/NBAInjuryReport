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
  for (const claim of Object.values(claims)) {
    if (claim.outcome === 'pending' && claim.identityVerifiedAtCollection) {
      const evidence = reconcile(claim, official);
      if (evidence) { claim.evidence = evidence; claim.outcome = evidence.outcome; }
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
    const s = scores[c.handle] ||= { handle: c.handle, name: c.name, observed: 0, corroborated: 0, conflicts: 0, pending: 0, accuracy: null };
    s.observed++; s[c.outcome === 'corroborated' ? 'corroborated' : c.outcome === 'conflict-review' ? 'conflicts' : 'pending']++;
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
  return { generated: now, inputGenerated: snapshot.generated, inputFresh: valid, claims, scores: Object.values(scores), baseline, history: history.slice(-10000), exits,
    exitNote: 'exits maps a player to the most recent monitored-post in-game exit signal. Unconfirmed by design: a social post is not an official designation.',
    note: 'Automatic evidence ledger. No historical accuracy or global first-to-report score is asserted. Conflicts require review, not a wrong-report penalty.' };
}
if (require.main === module) {
  const data = build(read('data/live/latest.json'), read('data/live/official.json'), read('data/live/context.json'), read('data/live/intelligence.json'));
  fs.mkdirSync(path.join(ROOT, 'data/live'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data/live/intelligence.json'), JSON.stringify(data, null, 2) + '\n');
  console.log('intelligence:', Object.keys(data.claims).length, 'observations;', data.history.length, 'history entries');
}
module.exports = { identify, claimStatus, reconcile, build };
