#!/usr/bin/env node
'use strict';
// Real Chromium, fixture transports: validates DOM, controls, audio unlock and mobile overflow.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const assert = require('assert/strict'), fs = require('fs');
(async () => {
  const server = spawn('python3', ['-m','http.server','8765','--bind','0.0.0.0'], {stdio:'ignore'});
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const AC = window.AudioContext;
      window.__audio = [];
      window.AudioContext = class extends AC { constructor(...args) { super(...args); window.__audio.push(this); } };
    });
    const now = new Date().toISOString();
    const snapshot = JSON.parse(fs.readFileSync('data/live/latest.json','utf8'));
    await page.route('**/*', async route => {
      const url = route.request().url();
      const reply = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      if (url.includes('/data/live/latest.json')) return reply({...snapshot,generated:now});
      if (url.includes('/data/live/official.json')) return reply({checkedAt:now,health:'unavailable',flags:['Fixture: no live official report'],rows:[]});
      if (url.includes('/data/live/context.json')) return reply({checkedAt:now,schema:2,
        // Evidence the collector would have accumulated: one starter with 5 games of box-score starts,
        // two dated injury listings on the roster feed, and a current-season contract.
        rosters:{GSW:{fetchedAt:now,url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/gs/roster',
          players:[{playerId:'6430',player:'Jimmy Butler III',team:'GSW',position:'F',experienceYears:14,rosterStatus:'Active',
            salaryCurrent:54129014,salarySeason:2027,playerUrl:'https://www.espn.com/nba/player/_/id/6430/jimmy-butler-iii',
            rosterUrl:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/gs/roster',
            injuryEntries:[{status:'Out',date:now.slice(0,10)},{status:'Day-To-Day',date:'2026-06-02T00:00Z'}]}]}},
        roles:[],roleEventIds:['fixture-game'],
        roleStats:{'6430':{player:'Jimmy Butler III',team:'GSW',games:6,starts:6,minutesTotal:204,minutesGames:6,sampleUrls:['https://www.espn.com/nba/game/_/gameId/401800001'],updatedAt:now,keys:['401800001']}},
        errors:{}});
      if (url.includes('/data/live/intelligence.json')) return reply({generated:now,history:[],scores:[],claims:{}});
      if (url.startsWith('http://127.0.0.1:8765')) return route.continue();
      if (url.includes('/nba/injuries')) return route.fulfill({status:503,body:'fixture direct unavailable'});
      if (url.includes('/scoreboard')) return reply({events:[]});
      if (url.includes('/nba/news')) return reply({articles:[]});
      if (url.includes('public.api.bsky.app')) return reply({feed:[]});
      return route.abort(); // external embeds deliberately not part of the fixture test
    });
    await page.goto('http://127.0.0.1:8765/index.html');
    await page.waitForFunction(() => document.getElementById('lastUpdated').textContent.includes('attempt'));
    await page.locator('#testSound').click();
    await page.waitForFunction(() => window.__audio.some(a => a.state === 'running'));
    await page.locator('#soundToggle').uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem('nba-alerts-sound-on')), 'off');
    await page.locator('#teamFilter').selectOption('BOS');
    await page.locator('#historySearch').fill('fixture');
    assert.match(await page.locator('#playerHistory').innerText(), /No forward history/);
    await page.locator('#testFeeds').click();
    await page.waitForFunction(() => document.getElementById('feedDiagnostics').textContent.includes('snapshot'));
    assert.equal(await page.locator('#testFeeds').innerText(), '🔎 Test feeds');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'mobile horizontal overflow');
    fs.mkdirSync('.audit',{recursive:true});
    await page.screenshot({path:'.audit/dashboard-mobile.png',fullPage:true});
    // ---- lineup-impact layer, on the real fixture evidence ----
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#teamFilter').selectOption('ALL');
    await page.waitForFunction(() => document.getElementById('injuryBoard').innerText.includes('Butler'), null, { timeout: 5000 });
    const boardText = await page.locator('#injuryBoard').innerText();
    assert.match(boardText, /Butler/, 'fixture board should contain the player');
    assert.match(boardText, /HIGH IMPACT/, 'a starter (6/6 games) going OUT must render a HIGH lineup-impact tag');
    assert.match(await page.locator('#impactLegend').innerText(), /not.*medical|never a medical/i, 'the legend must state what impact is NOT');
    const butlerTag = page.locator('#injuryBoard .tag.impact-high').first();
    assert.ok(await butlerTag.count() > 0, 'impact tag must carry a class so colour never carries meaning alone');
    assert.match(await butlerTag.getAttribute('title'), /box score|minutes|started/i, 'the tag tooltip must state its evidence');
    assert.match(boardText, /Injury-listing cadence/i, 'the dated roster-listing history must be shown, not just claimed');
    assert.match(boardText, /depth chart/i, 'every affected row links the human depth chart for cross-checking');
    // rows with no collected evidence must be labelled unknown rather than guessed
    const unknown = await page.locator('#injuryBoard .tag.impact-unknown').count();
    assert.ok(unknown > 0, 'players without collected box scores must render IMPACT UNKNOWN, got ' + unknown);
    assert.ok(!(await page.locator('#injuryBoard').innerText()).match(/medical severity: *(high|moderate|low|severe)/i), 'no medical severity may be asserted anywhere');
    fs.mkdirSync('.audit',{recursive:true});
    await page.screenshot({path:'.audit/dashboard-impact.png',fullPage:true});

    await page.goto('http://127.0.0.1:8765/reporters.html');
    await page.waitForFunction(() => document.getElementById('autoScorecard').textContent.includes('not established'));
    const dirText = await page.locator('#reporterTable').innerText();
    assert.match(dirText, /Brad Rowland|John Schuhmann/, 'citation-verified rows must render');
    assert.match(await page.locator('#reporterPills').innerText(), /X handles verified/, 'pills must be computed, not the static fallback');
    assert.match(await page.locator('body').innerText(), /cited on the injury feed/, 'the citation status must be visible in the directory');
    await page.goto('http://127.0.0.1:8765/sources.html');
    await page.waitForFunction(() => !document.getElementById('auditBox').textContent.includes('Loading'));
    const auditText = await page.locator('#auditBox').innerText();
    assert.match(auditText, /checks|DRIFT|no drift|no committed audit/i, 'the re-audit panel must render or say why it cannot: ' + auditText.slice(0, 80));
    assert.match(await page.locator('#srcPills').innerText(), /sources on file/, 'source pills are computed from the registry');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Chromium: dashboard + directory + sources page, fixture fallback, lineup-impact tags, sound unlock/mute, filters, diagnostics, mobile layout passed');
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e=>{console.error('::error::'+String(e.stack || e).replace(/\n/g,'%0A'));process.exitCode=1;});
