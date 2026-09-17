/* Same-origin evidence layer. Fetch timestamps never replace source publication timestamps. */
"use strict";
const Intelligence = (() => {
  const esc = AlertEngine.escapeHtml;
  let official = {}, ledger = {}, context = {};
  async function get(file) {
    const r = await fetch('data/live/' + file + '.json', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw Error(file + ': HTTP ' + r.status);
    return r.json();
  }
  const link = (url, label) => /^https:\/\//.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
  function render() {
    const officialEl = document.getElementById('officialEvidence');
    if (officialEl) {
      const fresh = official.health === 'ok' && AlertEngine.isFresh(official.checkedAt);
      officialEl.innerHTML = `<div class="callout ${fresh ? 'info' : 'warn'}"><b>${fresh ? 'Official report collected' : 'Official designations unavailable or historical — not a live confirmation'}</b><br>
        Checked: ${esc(official.checkedAt || 'no successful collection')} · Report: ${esc(official.reportAt || 'none discovered')}<br>
        ${link(official.url || NBA_OFFICIAL_REPORT_URL, 'NBA report evidence')} · <a href="data/live/official.json">collector detail ↗</a>
        <ul>${(official.flags || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
      if ((official.rows || []).length) officialEl.innerHTML += `<details><summary>${official.rows.length} sourced designations ${fresh ? '' : '(historical; no alerts)'}</summary><div class="table-wrap"><table><thead><tr><th>Player / team</th><th>Game</th><th>Status</th><th>Reason</th></tr></thead><tbody>${official.rows.map(r => `<tr><td>${esc(r.player)}<br><small>${esc(r.teamName)}</small></td><td>${esc(r.gameDate)} ${esc(r.matchup)}</td><td>${esc(r.status)}</td><td>${esc(r.reason)} ${link(r.url, 'PDF')}</td></tr>`).join('')}</tbody></table></div></details>`;
    }
    const coverage = document.getElementById('coverageSummary');
    if (coverage) {
      const rosters = Object.values(context.rosters || {}).filter(r => AlertEngine.isFresh(r.fetchedAt, 48 * 3600000));
      coverage.innerHTML = `<b>${rosters.length}/30</b> recently collected rosters · <b>${rosters.reduce((n, r) => n + r.players.length, 0)}</b> roster entries · <b>${(context.roles || []).length}</b> current-game role observations.<br>
        Injury-board omissions do not mean a team or player is healthy. A reporter's beat is not the team of every player in their posts. National reports can appear only under All teams until resolved.
        <details><summary>Collection problems (${Object.keys(context.errors || {}).length})</summary><pre>${esc(JSON.stringify(context.errors || {}, null, 2))}</pre></details>`;
    }
    renderHistory();
    const scores = document.getElementById('autoScorecard');
    if (scores) scores.innerHTML = `<p class="muted small">Collected ${esc(ledger.generated || 'not yet')}. Accuracy: <b>not established</b>. These are evidence counts, not reliability ratings or global first-to-report rankings. Pending includes unresolved players, multi-player text and in-game return claims.</p>
      <div class="table-wrap"><table><thead><tr><th>Reporter</th><th>Observed</th><th>Corroborated</th><th>Conflicts to review</th><th>Pending</th></tr></thead><tbody>${(ledger.scores || []).map(s => `<tr><td>${link('https://bsky.app/profile/' + s.handle, s.name || s.handle)}</td><td>${s.observed}</td><td>${s.corroborated}</td><td>${s.conflicts}</td><td>${s.pending}</td></tr>`).join('') || '<tr><td colspan="5">No automated observations published yet.</td></tr>'}</tbody></table></div>
      <details><summary>Recent claim evidence (latest 50)</summary>${Object.values(ledger.claims || {}).sort((a,b) => Date.parse(b.firstObservedAt)-Date.parse(a.firstObservedAt)).slice(0,50).map(c => `<article class="post"><b>${esc(c.name)} · ${esc(c.outcome)}</b><p>${esc(c.text)}</p><small>${esc(c.player || 'Player unresolved')} · posted ${esc(c.postedAt)} · first observed ${esc(c.firstObservedAt)}<br>${link(c.url, 'Original post')} ${c.evidence ? ' · ' + link(c.evidence.url, 'Official comparison') : ''}</small></article>`).join('')}</details>
      <a href="data/live/intelligence.json">Download automated evidence ledger ↗</a>`;
  }
  function renderHistory() {
    const el = document.getElementById('playerHistory');
    if (!el) return;
    const query = (document.getElementById('historySearch')?.value || '').toLowerCase();
    const rows = (ledger.history || []).filter(r => (r.player + ' ' + r.team).toLowerCase().includes(query)).slice(-80).reverse();
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Player / team</th><th>Observed status</th><th>Role / lineup impact</th><th>Evidence time</th></tr></thead><tbody>${rows.map(r => {
      const role = (context.roles || []).find(a => String(a.playerId) === String(r.playerId) && a.team === r.team && AlertEngine.isFresh(a.observedAt));
      return `<tr><td>${esc(r.player)} <small>${esc(r.team)}</small></td><td>${esc(r.status)}<br><small>${esc(r.reason || '')}</small></td><td>${role ? link(role.url, role.role) : 'Unknown — no fresh game evidence'}<br><small>${role?.role.startsWith('Starter') && r.status === 'Out' ? 'High lineup impact (heuristic, not medical severity)' : 'Impact not assessed'}</small></td><td><small>Source: ${esc(r.sourceUpdatedAt || 'unknown')}<br>Observed: ${esc(r.observedAt)}<br>${esc(r.change)} · ${link(r.url, 'ESPN')}</small></td></tr>`;
    }).join('') || '<tr><td colspan="4">No forward history matching this player. This is not evidence of no prior injuries.</td></tr>'}</tbody></table></div>`;
  }
  function officialAlerts(first) {
    if (official.health !== 'ok' || !AlertEngine.isFresh(official.checkedAt)) return;
    let saved; try { saved = JSON.parse(localStorage.getItem('nba-official-baseline') || 'null'); } catch { saved = null; }
    const map = {};
    for (const r of official.rows || []) {
      const key = [r.gameDate, r.matchup, r.teamName, r.player].join('|');
      map[key] = r.status;
      const team = TEAMS.find(t => t.city + ' ' + t.name === r.teamName);
      if (!first && saved && saved[key] !== r.status && /^(Out|Questionable|Doubtful)$/.test(r.status) && /Injury\/Illness/i.test(r.reason)) {
        AlertEngine.fire({ sev: r.status.toLowerCase(), sevLabel: r.status.toUpperCase() + ' (NBA official)', title: r.player + ': ' + r.status,
          detail: r.reason + ' · ' + r.gameDate + ' ' + r.matchup, url: r.url, team: team?.abbr,
          ts: official.reportAt });
      }
      if (typeof Wire !== 'undefined') Wire.push({ key: 'official-' + key, layer: 'official-nba', sev: r.status.toLowerCase(), sevLabel: r.status.toUpperCase(),
        text: r.player + ' — ' + r.reason, ts: official.reportAt, team: team?.abbr, player: r.player, source: 'Official NBA report · ' + r.gameDate, url: r.url });
    }
    localStorage.setItem('nba-official-baseline', JSON.stringify(map));
  }
  async function refresh(first = false) {
    const errors = [];
    await Promise.all([
      get('official').then(d => { official = d; }).catch(e => { official = { health: 'unavailable', flags: [e.message] }; }),
      get('context').then(d => { context = d; }).catch(e => errors.push(e.message)),
      get('intelligence').then(d => { ledger = d; }).catch(e => errors.push(e.message))
    ]);
    if (errors.length) context.errors = { ...context.errors, dashboard: errors.join('; ') };
    officialAlerts(first); render();
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('historySearch')?.addEventListener('input', renderHistory);
    if (document.getElementById('autoScorecard') && !document.getElementById('officialEvidence')) refresh(true);
  });
  function resolveText(text) {
    if (/\b(NFL|WNBA|football|baseball|hockey)\b/i.test(text)) return null;
    const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const players = Object.values(context.rosters || {}).filter(r => AlertEngine.isFresh(r.fetchedAt, 48 * 3600000)).flatMap(r => r.players || [])
      .concat(typeof InjuryBoard !== "undefined" ? InjuryBoard.getRows() : []);
    const hits = players.filter(p => (' ' + fold(text) + ' ').includes(' ' + fold(p.player) + ' '));
    const unique = [...new Map(hits.map(p => [p.playerId || p.player, p])).values()];
    return unique.length === 1 ? unique[0] : null;
  }
  return { refresh, renderHistory, resolveText };
})();
