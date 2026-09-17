#!/usr/bin/env python3
"""Re-verify every factual claim this site makes about its sources, from a real network.

Why this exists: the build sandbox has no HTTPS egress, so the source registry in
assets/js/data.js was written from a different network path. A claim like "the 2026-27
injury-report page is 404" or "searchPosts is 403 without a key" is only worth printing if
something re-reads it later. This script does that from GitHub's runners and commits the raw
evidence next to the verdicts, so a reader can check the check.

Rules:
  * no credentials, no bypassing access controls, nothing POSTed;
  * a status we already documented (403/404/500) is a DOCUMENTED-BLOCKER, not a bug;
  * a status that only a datacenter IP would see (challenge/refusal/limit) is ENV-BLOCKED and is
    never blamed on the source — runners and browsers take different paths, and the deployed page
    prints which transport served each panel;
  * an UNEXPECTED status fails the job only when it changes what the product may claim
    (official report page becoming live, the PDF index becoming browsable, a feed dying).
    Everything else is DRIFT-RECORDED: written into the evidence, shown on the sources page,
    not enforced — a gate that cries wolf at every third-party redesign gets ignored, which is
    worse than no gate at all;
  * a bug in this tool must never destroy the evidence: every check is wrapped, and the file is
    written and committed even when the job ends red.
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Statuses that describe the RUNNER rather than the source. Measured on 2026-09-17: ESPN returned
# 403 to a GitHub runner for /teams and /scoreboard while the deployed browser page fetched the
# injuries API on the same family of hosts and rendered 74 listings. Both facts are true at once.
ENV_STATUSES = {403, 406, 407, 408, 409, 425, 429, 451, 500, 502, 503, 504, 520, 521, 522, 524, 525, 530}

CHECKS = [
    dict(id='nba-season', url='https://official.nba.com/nba-injury-report-2026-27-season/',
         expect=[404], links=True, critical=True,
         claim='Registry: the 2026-27 injury-report landing page does not exist yet, so no official current-season index can be polled. If this ever returns 200 with report links, the official layer becomes automatable — that single change is why this check fails the job.'),
    dict(id='nba-previous', url='https://official.nba.com/nba-injury-report-2025-26-season/',
         expect=[200], links=True, must=['5 p.m', '1 p.m', 'injury report'],
         claim='Registry: deadline rules text (5 p.m. the day before; 11 a.m.–1 p.m. on game day; 1 p.m. for the second night of a back-to-back).'),
    dict(id='nba-pdf-index', url='https://ak-static.cms.nba.com/referee/injury/',
         expect=[500, 200, 403, 404], links=True, criticalLinks=True,
         claim='Registry: the PDF directory is not browsable (HTTP 500), so the newest report cannot be enumerated. A 200 with links is a capability change.'),
    dict(id='nba-pdf-sample', url='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf',
         expect=[200], pdf=True, critical=True,
         claim='Registry: timestamped official PDFs exist and parse (Game Date/Time, Matchup, Team, Player, Status, Reason). The regression fixture for the parser is generated from this response.'),
    dict(id='espn-injuries', url='https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
         expect=[200, 403], json_stats='injuries', critical=True,
         claim='Registry: THE primary board — one block per team with status + date + shortComment + details{type, side, returnDate} + notes. 403 here would mean the board must rely on the CI snapshot or stop.'),
    dict(id='espn-teams', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams',
         expect=[200], json_stats='teams',
         claim='Registry: 30 teams, addressable by abbreviation. Runner saw 403 in an earlier audit — recorded, not enforced.'),
    dict(id='espn-scoreboard', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
         expect=[200, 403], json_stats='events', critical=True,
         claim='Registry: drives live-game detection for in-game alerts. A hard failure here must never be read as "no games today".'),
    dict(id='espn-roster-mia', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia/roster',
         expect=[200, 403], json_stats='roster',
         claim='Registry (espn-roster-athlete-detail): per-athlete position, experience, injuries[]{status,date} and contracts[]{salary,season} — the only free machine-readable input to the lineup-impact layer.'),
    dict(id='espn-depth-chart', url='https://www.espn.com/nba/team/depth/_/name/mia',
         expect=[200], must=['Depth Chart', 'RotoWire'], links=True,
         claim='Registry (espn-depth-chart-page): rotation order is HTML-only (RotoWire-supplied); no JSON equivalent exists, so this page is a manual cross-check link and never a scrape target.'),
    dict(id='espn-injuries-page', url='https://www.espn.com/nba/injuries',
         expect=[200], must=['Injury'], links=True,
         claim='Registry: human injury table with estimated return dates and reporter attributions.'),
    dict(id='espn-teams-mia', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia',
         expect=[200, 403], json_stats='team',
         claim='Registry: /teams/mia returns Miami Heat — the reason abbreviations, not numeric ids, are used everywhere.'),
    dict(id='bluesky-profile', url='https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com',
         expect=[200], json_stats='bskyprofile',
         claim='Registry: nba.com carries a valid Bluesky verification object and its bio states the 2026-27 opener times.'),
    dict(id='bluesky-follows', url='https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=nba.com&limit=50',
         expect=[200], json_stats='follows',
         claim='Registry: the league follows ~6 accounts, so at most 4 of 30 teams have an official Bluesky presence — the verification ceiling on the social layer.'),
    dict(id='bluesky-list', url='https://public.api.bsky.app/xrpc/app.bsky.graph.getList?actor=howardbeck.bsky.social&list=did:plc:3llmezwbnrp2dfckxyx3lnca',
         expect=[200, 400], json_stats='list',
         claim='Registry (bluesky-reporter-list): Howard Beck\'s curated NBA-writers list, used to build the reporter roster from real data instead of memory.'),
    dict(id='bluesky-search', url='https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1',
         expect=[403, 200], critical=True,
         claim='Registry: keyword search is not available without a key (403 observed) — a documented limitation, deliberately not worked around. A 200 here would mean broader free coverage becomes possible.'),
    dict(id='x-docs-pricing', url='https://docs.x.com/x-api/getting-started/pricing',
         expect=[403, 200, 301, 302, 307],
         claim='Registry (x-api): the pricing page challenges automated fetchers, so no price in the registry is confirmed — and the row now points at docs.x.com, not the xAI documentation it used to link.'),
    dict(id='basketballmonster', url='https://basketballmonster.com/playernews.aspx',
         expect=[200], must=['INJURED'], links=True,
         claim='Registry: the reference model — status tags, X source links, impact ratings, item age. Read for format; never scraped into the pipeline.'),
    dict(id='covers-injuries', url='https://www.covers.com/sport/basketball/nba/injuries',
         expect=[200, 403], must=['injur'], links=True, claim='Registry: tertiary all-30-team cross-check with source attribution.'),
    dict(id='rotoballer-news', url='https://www.rotoballer.com/player-news?sport=nba',
         expect=[200, 403], links=True, claim='Registry: dated fantasy injury items with per-item source links.'),
    dict(id='balldontlie-tiers', url='https://nba.balldontlie.io/',
         expect=[200, 403], must=['ALL-STAR'],
         claim='Registry (balldontlie): injuries are a paid tier and the page has no webhooks section — which is why the earlier webhook claim was marked unconfirmed.'),
    dict(id='reporter-move-slater', url='https://www.frontofficesports.com/anthony-slater-espn-reporter-nba-bay-area/',
         expect=[200, 403, 404], links=False,
         claim='Registry (Anthony Slater): dated evidence for the Athletic→ESPN move that cleared the flag on his row. A 404 means the evidence link rotted, not that the move is wrong — so it is recorded, not enforced.'),
    dict(id='reporter-move-buckner', url='https://www.sportsmediawatch.com/2026/02/new-york-times-hires-ex-washington-post-sportswriters/',
         expect=[200, 403, 404], links=False,
         claim='Registry (Candace Buckner): dated evidence for the Washington Post→Athletic move that corrected her outlet.'),
]


def fetch(url):
    req = urllib.request.Request(
        url, headers={'User-Agent': 'NBAInjuryReport/1.0 public-source-audit (read-only; reports a live injury dashboard)'})
    return urllib.request.urlopen(req, timeout=25)


def json_peek(data, kind):
    out = {}
    if not isinstance(data, dict):
        return out
    if kind == 'injuries':
        blocks = data.get('injuries', [])
        out['teamBlocks'] = len(blocks)
        out['rows'] = sum(len(b.get('injuries', [])) for b in blocks)
        out['season'] = data.get('season')
    elif kind == 'teams':
        try:
            out['teams'] = len(data['sports'][0]['leagues'][0]['teams'])
        except Exception:
            pass
    elif kind == 'events':
        out['events'] = len(data.get('events', []))
        leagues = data.get('leagues') or [{}]
        out['leagueSeason'] = {k: leagues[0].get(k) for k in ('season', 'date')} if leagues else None
    elif kind == 'roster':
        athletes = []
        try:
            athletes = (data.get('team') or {}).get('roster', {}).get('entries', [])
        except Exception:
            athletes = []
        out['athletes'] = len(athletes)
        out['withInjuryListing'] = sum(1 for a in athletes if a.get('injuries'))
        out['withContract'] = sum(1 for a in athletes if a.get('contracts') or a.get('contract'))
        out['sample'] = [{'player': a.get('displayName'), 'position': (a.get('position') or {}).get('abbreviation'),
                          'experienceYears': (a.get('experience') or {}).get('years'),
                          'injuries': a.get('injuries'), 'contracts': a.get('contracts')}
                         for a in athletes if a.get('injuries')][:3]
    elif kind == 'team':
        t = data.get('team') or {}
        out['teamId'] = t.get('id')
        out['teamNickname'] = t.get('nickname')
        out['teamAbbrev'] = t.get('abbrev') or t.get('abbreviation')
    elif kind == 'bskyprofile':
        out['did'] = data.get('did')
        out['verification'] = data.get('verification')
        out['displayName'] = data.get('displayName')
        out['followers'] = data.get('followersCount')
        out['bioSnippet'] = (data.get('description') or '')[:200]
    elif kind == 'follows':
        follows = data.get('profiles') or data.get('follows') or []   # the API renamed this field in 2024
        out['follows'] = len(follows)
        out['verifiedFollows'] = sum(1 for f in follows if bool((f.get('verification') or {}).get('verified')))
        out['followsHandles'] = [f.get('handle') for f in follows][:12]
    elif kind == 'list':
        out['listName'] = (data.get('list') or {}).get('displayName')
        out['listPurpose'] = (data.get('list') or {}).get('purpose')
        out['listDesc'] = (data.get('list') or {}).get('description')
        out['listItems'] = len(data.get('items') or [])
    return out


def probe(spec, row, scratch):
    """Fetch one URL and record what the response actually supported. Mutates and returns `row`."""
    key, url, expect = spec['id'], spec['url'], spec.get('expect', [200])
    body = b''
    status = final_url = ctype = None
    try:
        with fetch(url) as res:
            status, final_url, ctype = res.status, res.url, res.headers.get('Content-Type')
            body = res.read(12_000_000)
    except urllib.error.HTTPError as exc:                     # 403 / 404 / 500 land here
        status, final_url = exc.code, url
        ctype = exc.headers.get('Content-Type') if exc.headers else None
        try:
            body = exc.read(400_000)
        except Exception:
            body = b''
        if status not in expect:
            row['error'] = str(exc)[:200]
    except Exception as exc:                                  # no route / TLS / timeout
        row['error'] = type(exc).__name__ + ': ' + str(exc)[:200]

    row['status'] = status
    row['finalUrl'] = final_url
    row['contentType'] = ctype
    row['bytes'] = len(body)
    if body:
        row['sha256'] = hashlib.sha256(body).hexdigest()

    text = ''
    if spec.get('pdf') and body[:4] == b'%PDF':
        (scratch / (key + '.pdf')).write_bytes(body)
        try:
            subprocess.run(['pdftotext', '-layout', str(scratch / (key + '.pdf')), str(scratch / (key + '.txt'))], check=True)
            text = (scratch / (key + '.txt')).read_text(errors='replace')
            row['pdfLines'] = len([l for l in text.split('\n') if l.strip()])
            row['pdfHead'] = text[:300]
        except Exception as exc:
            row['pdfError'] = str(exc)[:200]
    elif text_kind(ctype) and body:
        text = body.decode('utf-8', errors='replace')

    if text:
        (scratch / (key + '.' + text_kind(ctype))).write_text(text)
        if spec.get('must'):
            row['probes'] = {p: bool(re.search(re.escape(p), text, re.I)) for p in spec['must']}
            row['probesMissing'] = [p for p, ok in row['probes'].items() if not ok]
        if spec.get('links'):
            row['outboundLinks'] = sorted(set(re.findall(r'https?://[^\s"\'<>]+', text)))[:25]
            row['frames'] = re.findall(r'<iframe[^>]+src=["\']([^"\']+)', text)[:10]

    if 'json' in (ctype or '') and body:
        try:
            row.update(json_peek(json.loads(body), spec.get('json_stats')))
        except Exception as exc:
            row['jsonError'] = str(exc)[:160]

    if spec.get('criticalLinks') and row.get('outboundLinks'):
        # The thing the registry says is impossible is now observable: a browsable official directory.
        row['verdict'] = 'CAPABILITY-DRIFT'
        row['meaning'] = ('The official injury-PDF directory is exposing %d link(s) — the official layer can be automated, '
                          'so every claim that it cannot must be rewritten. Links captured in outboundLinks.' % len(row['outboundLinks']))
        return row

    if status is None:
        row['verdict'] = 'UNREACHABLE-FROM-RUNNER'
        row['meaning'] = 'No route from the runner (DNS/TLS/timeout). Says nothing about the source, and nothing about browser access.'
    elif status in ENV_STATUSES and status not in expect:
        row['verdict'] = 'ENV-BLOCKED'
        row['meaning'] = ('HTTP %d from a datacenter IP. The claim under test is about the source and the browser path, '
                          'which are evidenced elsewhere (the deployed page prints its own transport). Not counted as drift.' % status)
    elif status not in expect:
        row['verdict'] = ('CAPABILITY-DRIFT' if spec.get('critical') else 'DRIFT-RECORDED') + ('' if status != 200 else '-NEWLY-OK')
        row['meaning'] = ('The source answers differently than the registry states. '
                          + ('This changes what the product may claim — rewrite the registry row and the UI copy built on it.'
                             if spec.get('critical') else 'Recorded only; not a capability change.'))
    elif 200 in expect:
        row['verdict'] = 'OK-PAGE-CHANGED' if row.get('probesMissing') else 'OK'
        if row.get('probesMissing'):
            row['meaning'] = 'Reachable as documented, but the wording this check looks for moved: %s' % ", ".join(row['probesMissing'])
    else:
        row['verdict'] = 'DOCUMENTED-BLOCKER'
        row['meaning'] = 'Still blocked exactly as the registry says it is. This is the expected state, not a failure.'
    return row


def text_kind(ctype):
    ctype = ctype or ''
    if 'json' in ctype:
        return 'json'
    if 'html' in ctype:
        return 'html'
    if 'xml' in ctype or 'text' in ctype or 'pdf' in ctype:
        return 'txt'
    return ''


def main():
    evidence = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'why': 'Re-reads every source claim the registry makes, from a real network. See tools/verify_live.py.',
                'checks': []}
    scratch = ROOT / '.audit'
    scratch.mkdir(exist_ok=True)

    for spec in CHECKS:
        row = {'id': spec['id'], 'url': spec['url'], 'documentedStatuses': spec.get('expect', [200]),
               'claim': spec['claim'], 'critical': bool(spec.get('critical'))}
        try:
            probe(spec, row, scratch)
        except Exception as exc:
            # A bug in THIS tool is never evidence about a source, and must not cost us the run.
            row['verdict'] = 'TOOL-ERROR'
            row['meaning'] = type(exc).__name__ + ': ' + str(exc)[:200]
        evidence['checks'].append(row)
        print('%-22s %-10s %-22s %s' % (row['id'], row.get('status') or 'n/a', row['verdict'], row.get('finalUrl', '')))

    counts = {}
    for r in evidence['checks']:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    drift = sum(1 for r in evidence['checks'] if r['verdict'].startswith('CAPABILITY-DRIFT'))
    tool_errors = sum(1 for r in evidence['checks'] if r['verdict'] == 'TOOL-ERROR')
    evidence['summary'] = {
        'total': len(evidence['checks']), 'byVerdict': counts,
        'capabilityDrift': drift, 'toolErrors': tool_errors,
        'note': 'CAPABILITY-DRIFT (exit 1) means a source now answers in a way that changes what this product may claim — typically the official '
                'report page becoming live or the PDF index becoming browsable. DRIFT-RECORDED, ENV-BLOCKED and UNREACHABLE-FROM-RUNNER are written '
                'here for the reader instead of failing the job: runners and browsers take different paths, and third-party pages redesign on their '
                'own schedule. The site always prints which transport served each panel, so a reader can tell the two apart.'}

    dest = ROOT / 'data/audit/latest.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(evidence, indent=2) + '\n')
    print('\n' + json.dumps(evidence['summary'], indent=2))

    step = os.environ.get('GITHUB_STEP_SUMMARY')
    if step:
        with open(step, 'a', encoding='utf-8') as fh:
            fh.write('### Source re-audit `%s`\n\n| check | status | verdict |\n|---|---|---|\n' % evidence['checkedAt'])
            for r in evidence['checks']:
                fh.write('| `%s` | %s | %s |\n' % (r['id'], r.get('status') or 'n/a', r['verdict']))
            fh.write('\n```\n' + json.dumps(evidence['summary'], indent=2) + '\n```\n')

    if drift:
        print('\nCAPABILITY DRIFT — update assets/js/data.js and the UI copy built on it before trusting this run.',
              file=sys.stderr)
        return 1
    if tool_errors:
        print('\n%d check(s) hit a tool error; the verdicts are recorded in data/audit/latest.json.' % tool_errors, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
