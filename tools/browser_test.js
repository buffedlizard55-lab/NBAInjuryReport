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
      if (url.includes('/data/live/context.json')) return reply({checkedAt:now,rosters:{},roles:[],errors:{}});
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
    await page.goto('http://127.0.0.1:8765/reporters.html');
    await page.waitForFunction(() => document.getElementById('autoScorecard').textContent.includes('not established'));
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Chromium: dashboard + directory, fixture fallback, sound unlock/mute, filters, diagnostics, mobile layout passed');
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e=>{console.error('::error::'+String(e.stack || e).replace(/\n/g,'%0A'));process.exitCode=1;});
