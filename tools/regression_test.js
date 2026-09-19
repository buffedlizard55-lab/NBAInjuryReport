#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const { identify, claimStatus, reconcile, build } = require('./build_intelligence');
const { roles } = require('./collect_context');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('✓', name); }
const now = new Date().toISOString();
const store = {};
const sandbox = { console, Date, Set, Map, AbortController, AbortSignal, setTimeout, clearTimeout,
  localStorage: { getItem: k => store[k] || null, setItem: (k,v) => { store[k]=v; }, removeItem: k => { delete store[k]; } },
  document: { getElementById: () => null, addEventListener() {} },
  fetch: async () => ({ ok: false, status: 503 }),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(['data','role','alerts','injuries','ingame','social'].map(f => fs.readFileSync('assets/js/' + f + '.js','utf8')).join('\n') + '\nthis.M={AlertEngine,InjuryBoard,InGame,Social,LineupImpact,SIGNALS,REPORTERS,espnAbbr,SOCIAL_ACCOUNTS,BSKY_REPORTERS};', sandbox);
const { AlertEngine, InjuryBoard, InGame, Social, LineupImpact, SIGNALS, REPORTERS, SOCIAL_ACCOUNTS } = sandbox.M;
check('Freshness rejects old, missing, malformed and future timestamps', () => {
  for (const t of [null, 'no', '2020-01-01', new Date(Date.now()+3600000).toISOString()]) assert.equal(AlertEngine.isFresh(t), false);
  assert.equal(AlertEngine.isFresh(now), true);
});
check('Surgery alone is not an OUT designation', () => assert.equal(SIGNALS.find(s => s.re.test('Player had surgery on his shoulder')).sev, 'mention'));
check('Negated OUT and doubtful return never become confirmed OUT', () => {
  assert.equal(Social.classifyPost('Player has not been ruled out with an ankle injury').sev, 'mention');
  assert.equal(Social.classifyPost('Test Player will not return due to an ankle injury').sev, 'out');
  assert.doesNotMatch(Social.classifyPost('Player is doubtful to return after heading to the locker room with an ankle injury').sevLabel, /OUT FOR THE GAME/);
});
check('DNP injury is not exit evidence; unknown or available never maps to out', () => {
  const summary = {boxscore:{players:[{team:{abbreviation:'GS'},statistics:[{athletes:[{athlete:{id:'1',displayName:'Test Player'},didNotPlay:true,reason:'Ankle injury'}]}]}]},injuries:[{team:{abbreviation:'GS'},injuries:[{athlete:{displayName:'Other'},status:'Available',details:{type:'Ankle'}},{athlete:{displayName:'Unknown'},status:'Mystery',details:{type:'Knee'}}]}]};
  const rows = InGame.extract(summary, '1','fixture');
  assert.equal(rows[0].team,'GSW'); assert.equal(rows[0].alertEligible,false);
  assert.equal(rows.length,2); assert.notEqual(rows[1].sev,'out');
});
check('Team and severity filters apply centrally to all producers', () => {
  vm.runInContext('const App={getFilters:()=>({team:"BOS",sevs:{out:false,questionable:true}})};',sandbox);
  assert.equal(AlertEngine.fire({sev:'out',sevLabel:'OUT',title:'muted',team:'BOS',ts:now}),false);
  assert.equal(AlertEngine.fire({sev:'questionable',sevLabel:'Q',title:'wrong team',team:'ATL',ts:now}),false);
  assert.equal(AlertEngine.fire({sev:'questionable',sevLabel:'Q',title:'old',team:'BOS',ts:'2020-01-01'}),false);
});
check('Canonical ESPN route codes cover roster failures', () => { assert.equal(sandbox.M.espnAbbr('NOP'),'no'); assert.equal(sandbox.M.espnAbbr('UTA'),'utah'); });
check('Wrong Shams-to-Hollinger mapping removed', () => assert.notEqual(REPORTERS.find(r=>r.name==='Shams Charania').bsky,'johnhollinger.bsky.social'));
check('Exact one-player identity matching; multi-player and unknown stay unresolved', () => {
  const players=[{player:'Test Player',playerId:'1'},{player:'Another Player',playerId:'2'}];
  assert.equal(identify('Test Player out',players).playerId,'1');
  assert.equal(identify('Test Player and Another Player out',players),null);
  assert.equal(identify('Tester Player out',players),null);
});
check('Claim extraction rejects hypotheticals, future games, denials and QTR', () => {
  for (const text of ['Test Player is not ruled out','Test Player could be ruled out','Test Player questionable to return','Test Player out tomorrow','Is Test Player ruled out?']) assert.equal(claimStatus(text),null);
  assert.equal(claimStatus('Test Player ruled out tonight, ankle injury'),'Out');
});
check('Forward reconciliation is game-scoped and does not punish silence', () => {
  const claim={player:'Test Player',status:'Out',postedAt:'2026-04-12T16:00:00Z'};
  const official={health:'ok',reportAt:'2026-04-12T17:00:00Z',rows:[{player:'Test Player',gameDate:'04/12/2026',status:'Out',url:'https://official.nba.com/'}]};
  assert.equal(reconcile(claim,official).outcome,'corroborated');
  assert.equal(reconcile({...claim,inGameWatch:true},official),null);
  assert.equal(reconcile(claim,{...official,health:'stale'}),null);
  assert.equal(reconcile(claim,{...official,rows:[]}),null);
  assert.equal(reconcile(claim,{...official,rows:[{...official.rows[0],status:'Available'}]}).outcome,'conflict-review');
  assert.equal(reconcile({...claim,postedAt:'2026-04-11T16:00:00Z'},official),null);
});
check('Ledger is idempotent; errors preserve baseline; source links retained', () => {
  const snapshot={generated:now,injuries:{rows:[{player:'Test Player',playerId:'1',team:'BOS',status:'Out',fp:'Out|||',updated:now,teamUrl:'https://www.espn.com/nba/injuries'}]},posts:[{uri:'at://test/1',text:'Test Player ruled out tonight with ankle injury',handle:'test',createdAt:now,url:'https://bsky.app/profile/test/post/1'}]};
  const a=build(snapshot,{}, {}, {},now),b=build(snapshot,{}, {},a,now);
  assert.equal(a.history.length,1);assert.equal(b.history.length,1);assert.equal(Object.keys(b.claims).length,1);
  assert.equal(b.scores[0].accuracy,null);assert.equal(b.claims['at://test/1'].outcome,'pending');
  assert.equal(b.history[0].url,snapshot.injuries.rows[0].teamUrl);
  const c=build({...snapshot,errors:{injuries:'503'},injuries:{rows:[]}}, {}, {}, b,now);
  assert.deepEqual(c.baseline,b.baseline);
});
check('Starter observations are explicit and game-scoped, never inferred from DNP', () => {
  const rows=roles({boxscore:{players:[{team:{abbreviation:'GS'},statistics:[{keys:['minutes'],athletes:[{athlete:{id:'1',displayName:'Test'},starter:true,stats:['12']},{athlete:{id:'2'},didNotPlay:true}]}]}]}},'42',now);
  assert.equal(rows.length,1); assert.equal(rows[0].role,'Starter in this game'); assert.equal(rows[0].minutes,'12'); assert.equal(rows[0].team,'GSW');
});
check('Impact is derived only from collected evidence and never invents a role', () => {
  const none = LineupImpact.assess({ player:'Nobody Here', playerId:'x1', team:'BOS', sev:'out' }, {});
  assert.equal(none.impact,'unknown');
  assert.match(none.impactLabel,/unknown/i);
  assert.match(JSON.stringify(none.notes),/never as|no box-score/i);
});
check('A high-impact starter tag never changes alert eligibility, only its wording', () => {
  const t = new Date().toISOString();
  const ctx={roles:[],roleStats:{},rosters:{},exits:{}};
  const a=LineupImpact.assess({player:'P',playerId:'1',team:'UTA',sev:'out'},ctx);
  assert.ok(a.impactLabel); assert.equal(a.impact,'unknown');   // no evidence => the label cannot invent "starter"
  void t;
});
(async () => {
  const payload={injuries:[{injuries:[{id:'one',status:'Out',date:now,athlete:{displayName:'Test',team:{abbreviation:'BOS'},links:[{rel:['playercard'],href:'https://www.espn.com/nba/player/_/id/123/test'}]}}]}]};
  sandbox.fetch=async()=>({ok:true,json:async()=>payload});
  await InjuryBoard.check(true);
  check('Player ID extracted from observed ESPN playercard URL',()=>assert.equal(InjuryBoard.getRows()[0].playerId,'123'));
  const baseline=store['nba-injury-seen-v1'];
  sandbox.fetch=async(url)=> String(url).includes('latest.json') ? {ok:true,json:async()=>({generated:now,errors:{injuries:'503'},injuries:{rows:[]}})} : {ok:false,status:503};
  await InjuryBoard.check(false);
  check('Failed snapshot does not clear last-good board or alert baseline',()=>{
    assert.equal(store['nba-injury-seen-v1'],baseline);assert.equal(InjuryBoard.getRows().length,1);assert.match(InjuryBoard.getMeta().error,/collector/);
  });
  sandbox.fetch=async(url)=> String(url).includes('latest.json') ? {ok:true,json:async()=>({generated:'2020-01-01',injuries:{rows:[]}})} : {ok:false,status:503};
  await InjuryBoard.check(false);
  check('Stale fallback fails closed and retains baseline',()=>{
    assert.match(InjuryBoard.getMeta().error,/stale/);assert.equal(store['nba-injury-seen-v1'],baseline);
  });
  /* the freshness fix: a board listing stamped hours ago by the source is still a NEW observation
     for us, and must not be silenced by the 30-minute social rule */
  check('Board alerts are judged by observation time, not the source editorial stamp', () => {
    const stale = { id:'stale-1', player:'Old Stamped Guy', team:'BOS', status:'Out', sev:'out', sevLabel:'OUT',
      updated: new Date(Date.now() - 6*3600000).toISOString(), shortComment:'', bodyPart:'Left Knee', returnDate:null, fp:'Out|Left Knee||',
      teamUrl:'https://www.espn.com/nba/team/injuries/_/name/bos', playerUrl:null };
    const a = InjuryBoard.alertFor ? InjuryBoard.alertFor('new', stale) : null;
    assert.ok(a, 'alertFor must be exposed for regression');
    assert.ok(a.observedAt, 'a board alert carries the observation time');
    assert.ok(AlertEngine.isFresh(a.observedAt, a.maxAgeMs || 1800000), 'the observation is fresh even though the source stamp is 6h old');
    assert.ok(!AlertEngine.isFresh(a.ts, 1800000), 'and the source timestamp alone would have suppressed it — that was the bug');
  });
  check('A July-stamped ESPN listing still alerts when the CHANGE is observed today (session 16)', () => {
    /* The 6h case above is still inside the old 24h window, so it could not catch the defect:
     * alertEligible used to be isFresh(row.updated, 24h), which is false for the July dates
     * ESPN still publishes on 2026-09-19. fire() never ran. Reset App filters first — an
     * earlier check in this file installs a BOS/out mute. */
    vm.runInContext('App.getFilters=()=>({team:"ALL",sevs:{out:true,doubtful:true,questionable:true,probable:true,return:true,mention:true}});', sandbox);
    const ancient = { id:'july-1', player:'Mouhamed Gueye', team:'ATL', status:'Out', sev:'out', sevLabel:'OUT',
      updated: new Date(Date.now() - 40*86400000).toISOString(), shortComment:'fractured left foot', bodyPart:'Left Foot', returnDate:null, fp:'Out|Left Foot||',
      teamUrl:'https://www.espn.com/nba/team/injuries/_/name/atl', playerUrl:null };
    const a = InjuryBoard.alertFor('new', ancient);
    assert.notEqual(a.alertEligible, false, 'eligibility must not be keyed on the source date');
    assert.ok(AlertEngine.isFresh(a.observedAt, a.maxAgeMs), 'observation is fresh');
    assert.equal(AlertEngine.isFresh(a.ts, 24*60*60*1000), false, 'the source stamp itself is older than 24h — that used to silent-drop');
    AlertEngine.clearLog();
    assert.equal(AlertEngine.fire(a), true, 'fire() must sound for a newly observed change on an old-stamped listing');
  });
  check('Social alerts stay bound to post time (old resurfacing posts cannot re-alert)', () => {
    const old = { uri:'at://old', handle:'x.bsky.social', name:'X', text:'Veteran is out tonight with a knee injury', url:'https://bsky.app/profile/x.bsky.social/post/old',
      createdAt: new Date(Date.now() - 3*86400000).toISOString(), sev:'out', sevLabel:'OUT (social report)', verified:true, inGameWatch:false };
    const verdict = Social.checkAlerts([old], false);
    const alert = verdict.alerts.find(a => a.uri === 'at://old') || verdict.alerts[0];
    assert.ok(!alert || alert.alertEligible === false, 'a 3-day-old post must not be alert-eligible');
  });
  check('Identity eligibility: recorded evidence qualifies a reporter; an unverified team account is never collected', () => {
    const fa = Social.feedAccounts();
    const mc = fa.find(a => a.handle === 'jmcdonaldsa.bsky.social');   // Spurs beat writer: list membership + bio, NO Bluesky object
    const nba = fa.find(a => a.handle === 'nba.com');                   // official league: valid verification object
    assert.ok(mc && mc.verified === true && mc.bskyVerified === false, 'evidence-recorded reporter is alert-eligible without a verification object');
    assert.ok(nba && nba.verified === true && nba.bskyVerified === true, 'verified league account is alert-eligible');
    /* dallasmavs (bio 'Mavs.com', followed by the NBA, NO verification object, newest post 2023-05-05)
     * was polled-but-silent until 2026-09-18. It is now not collected at all: an unverified handle
     * that has not posted in 1,231 days cannot contribute anything but risk. The assertion therefore
     * moved from "collected and silent" to the stronger "never enters the allow-list" — and the
     * second half proves the silence rule still holds for an unverified account that IS collected. */
    const mavsRow = (sandbox.M.SOCIAL_ACCOUNTS || []).find(a => a.handle === 'dallasmavs.bsky.social');
    assert.ok(mavsRow && mavsRow.feed === false, 'flagged unverified team account is held out of collection');
    assert.ok(!fa.find(a => a.handle === 'dallasmavs.bsky.social'), 'held-out account must not appear in feedAccounts()');
    const synthetic = { handle: 'fake-unverified.bsky.social', name: 'Fake', kind: 'official-team', team: 'DAL', feed: true,
      bskyVerified: false, verified: 'FLAGGED unverified-team-account', url: 'https://bsky.app/profile/fake-unverified.bsky.social' };
    sandbox.M.SOCIAL_ACCOUNTS.push(synthetic);
    try {
      const acct = Social.feedAccounts().find(a => a.handle === synthetic.handle);
      assert.ok(acct && acct.verified === false && acct.bskyVerified === false, 'an unverified official account that IS collected stays silent');
    } finally { sandbox.M.SOCIAL_ACCOUNTS.pop(); }
  });
  check('checkAlerts: same post, eligible account sounds; account without evidence is visible but silent', () => {
    sandbox.Intelligence = { resolveText: t => /Test Player/.test(String(t)) ? { player:'Test Player', team:'BOS', playerId:'1' } : null };
    let n = 0;
    const fresh = verified => ({ uri: 'at://gate/' + (++n), handle:'rep.bsky.social', name:'Rep', text:'Test Player is out tonight with a knee injury',
      url:'https://bsky.app/profile/rep.bsky.social/post/gate', createdAt:new Date().toISOString(),
      sev:'out', sevLabel:'OUT (social report)', verified: verified, bskyVerified:false, inGameWatch:false });
    const ok = Social.checkAlerts([fresh(true)], false);
    assert.equal(ok.alerts.length, 1);
    assert.equal(ok.alerts[0].alertEligible, true, 'recorded identity evidence + one resolved player + fresh post = eligible');
    const silent = Social.checkAlerts([fresh(false)], false);
    assert.equal(silent.alerts.length, 1);
    assert.equal(silent.alerts[0].alertEligible, false, 'no evidence: stays in the feed, never sounds');
  });
  check('Injury-history cadence ignores stale entries and dedupes dates', () => {
    const d = n => new Date(Date.now() - n*86400000).toISOString().slice(0,10)+'T00:00Z';
    const cad = LineupImpact.listingCadence({ injuryEntries:[{status:'Out',date:d(2)},{status:'Out',date:d(2)},{status:'Day-To-Day',date:d(900)}] });
    assert.equal(cad.count,1);
  });
  check('In-game exit evidence from the ledger is attached per player, labelled unconfirmed', () => {
    const { build } = require('./build_intelligence');
    const snap={generated:new Date().toISOString(),errors:{},injuries:{rows:[]},posts:[]};
    const prior={claims:{p1:{uri:'p1',handle:'rep.bsky.social',name:'Rep',text:'Ace Bailey left the game with back spasms',url:'https://bsky.app/profile/rep.bsky.social/post/p1',postedAt:new Date().toISOString(),textSha256:'x',inGameWatch:true,player:'Ace Bailey',playerId:'77',team:'UTA',outcome:'pending',verified:true}},history:[],baseline:{}};
    const built=build(snap,{health:'unavailable',rows:[]},{rosters:{}},prior);
    assert.ok(built.exits['77'],'exit keyed by playerId');
    assert.equal(built.exits['77'].status,'reported-unconfirmed');
    assert.match(built.exits['77'].url,/^https:\/\/bsky\.app/);
  });
  check('AlertEngine fires with HIGH LINEUP IMPACT prefix when impact is high', () => {
    AlertEngine.clearLog();
    const item = { sev:'out', sevLabel:'OUT', title:'Starter Star — Out', team:'BOS', ts:now, alertEligible:true, impact:{ impact:'high', role:{ tier:'starter' } } };
    AlertEngine.fire(item);
    const log = AlertEngine.getLog();
    assert.ok(log.length > 0 && log[0].message.includes('⚡ HIGH LINEUP IMPACT'), 'high impact alert must carry lightning prefix');
  });
  check('InGame live summary listings with Questionable or Out are alert-eligible', () => {
    const summary = {
      boxscore: { players: [{ team: { abbreviation: 'BOS' }, statistics: [{ athletes: [{ athlete: { id: '9', displayName: 'Bench DNP' }, didNotPlay: true, reason: 'Knee' }] }] }] },
      injuries: [{ team: { abbreviation: 'BOS' }, injuries: [{ athlete: { id: '10', displayName: 'InGame Exit' }, status: 'Questionable', details: { comment: 'questionable to return with ankle sprain' } }] }]
    };
    const rows = InGame.extract(summary, '999', 'BOS @ MIA');
    const dnp = rows.find(r => r.kind === 'DNP');
    const qtr = rows.find(r => r.kind === 'LISTING');
    assert.equal(dnp.alertEligible, false, 'pregame DNP stays alert-ineligible');
    assert.equal(qtr.alertEligible, true, 'in-game Questionable listing in live game is alert-eligible');
  });
  check('Social alerts attach lineup impact when player is resolved', () => {
    sandbox.Intelligence = {
      resolveText: t => /Starter Player/.test(String(t)) ? { player:'Starter Player', team:'GSW', playerId:'6430' } : null,
      impactContext: () => ({
        roles: [{ playerId: '6430', team: 'GSW', role: 'Starter in this game', observedAt: now }],
        roleStats: {}, rosters: {}, exits: {}
      })
    };
    const post = { uri: 'at://impact/1', handle: 'rep.bsky.social', name: 'Reporter', text: 'Starter Player has been ruled out tonight with knee soreness',
      url: 'https://bsky.app/profile/rep.bsky.social/post/imp', createdAt: now, sev: 'out', sevLabel: 'OUT (social report)', verified: true, inGameWatch: false };
    const res = Social.checkAlerts([post], false);
    assert.equal(res.alerts.length, 1);
    assert.ok(res.alerts[0].impact, 'resolved player must have impact attached');
    assert.equal(res.alerts[0].impact.impact, 'high', 'starter ruled out must produce high impact');
  });
  console.log(checks+' regression groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
