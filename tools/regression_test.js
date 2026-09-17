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
vm.runInContext(['data','alerts','injuries','ingame','social'].map(f => fs.readFileSync('assets/js/' + f + '.js','utf8')).join('\n') + '\nthis.M={AlertEngine,InjuryBoard,InGame,Social,SIGNALS,REPORTERS};', sandbox);
const { AlertEngine, InjuryBoard, InGame, Social, SIGNALS, REPORTERS } = sandbox.M;
check('Freshness rejects old, missing, malformed and future timestamps', () => {
  for (const t of [null, 'no', '2020-01-01', new Date(Date.now()+3600000).toISOString()]) assert.equal(AlertEngine.isFresh(t), false);
  assert.equal(AlertEngine.isFresh(now), true);
});
check('Surgery alone is not an OUT designation', () => assert.equal(SIGNALS.find(s => s.re.test('Player had surgery on his shoulder')).sev, 'mention'));
check('Negated OUT and doubtful return never become confirmed OUT', () => {
  assert.equal(Social.classifyPost('Player has not been ruled out with an ankle injury').sev, 'mention');
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
  console.log(checks+' regression groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
