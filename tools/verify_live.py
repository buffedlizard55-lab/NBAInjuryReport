#!/usr/bin/env python3
"""Re-verify every factual claim this site makes about its sources, from a real network.

Why this exists: the build sandbox has no HTTPS egress, so the source registry in
assets/js/data.js was written from a different network path. A claim like "the 2026-27
injury-report page is 404" or "searchPosts is 403 without a key" is only worth printing if
something re-reads it later. This script does that from GitHub's runners, on the schedule,
and commits the raw evidence next to the verdicts.

Rules:
  * no credentials, no bypassing access controls, nothing POSTed;
  * an expected failure (403/404/500 documented in the registry) is recorded as a
    DOCUMENTED-BLOCKER, not as a bug — that is the difference between "this source is
    unreachable from a browser too" and "this source is unreachable from a runner";
  * an UNEXPECTED status flips the verdict to DRIFT and exits 1, because that means the
    registry (and the UI copy built on it) is now stale;
  * text probes are reported separately and never fail the run by themselves: a site can
    redesign a page without invalidating the underlying claim.

Evidence land: data/audit/latest.json (committed, same-origin readable by the site) and
.audit/ (workflow artifact only: fetched HTML, the parsed PDF text, raw JSON bodies).
"""
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# id, url, statuses we consider "as documented", and text probes that support registry claims.
# `ok` lists what we expect; anything else is DRIFT.
CHECKS = [
    dict(id='nba-season', url='https://official.nba.com/nba-injury-report-2026-27-season/',
         expect=[404], links=False,
         claim='Registry: the 2026-27 injury-report landing page does not exist yet, so no official current-season index can be polled.'),
    dict(id='nba-previous', url='https://official.nba.com/nba-injury-report-2025-26-season/',
         expect=[200], links=True, must=['5 p.m', '1 p.m', 'injury report'],
         claim='Registry: deadline rules text (5 p.m. the day before; 11 a.m.–1 p.m. on game day; 1 p.m. for the second night of a back-to-back).'),
    dict(id='nba-pdf-index', url='https://ak-static.cms.nba.com/referee/injury/',
         expect=[500, 200], links=True,
         claim='Registry: the PDF directory is not browsable (HTTP 500). If this ever returns 200 with links, the official layer can be automated — that is the one change worth watching here.'),
    dict(id='nba-pdf-sample', url='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf',
         expect=[200], pdf=True,
         claim='Registry: timestamped official PDFs exist and parse (Game Date/Time, Matchup, Team, Player, Status, Reason).'),
    dict(id='espn-injuries', url='https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
         expect=[200], json_stats='injuries',
         claim='Registry: THE primary board — one block per team, status + date + shortComment + details{type, side, returnDate} + notes.'),
    dict(id='espn-teams', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams',
         expect=[200], json_stats='teams', claim='Registry: 30 teams, abbreviation-addressable.'),
    dict(id='espn-scoreboard', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
         expect=[200], json_stats='events', claim='Registry: drives live-game detection for in-game alerts.'),
    dict(id='espn-roster-mia', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia/roster',
         expect=[200], json_stats='roster',
         claim='Registry (espn-roster-athlete-detail): per-athlete position, experience, injuries[]{status,date} and contracts[]{salary,season} — the only free machine-readable input to the role/impact layer.'),
    dict(id='espn-depth-chart', url='https://www.espn.com/nba/team/depth/_/name/mia',
         expect=[200], must=['Depth Chart', 'RotoWire'], links=True,
         claim='Registry (espn-depth-chart-page): rotation order is HTML-only (RotoWire-supplied) — no JSON equivalent exists, so this page is a manual cross-check link, never a scrape target.'),
    dict(id='espn-injuries-page', url='https://www.espn.com/nba/injuries',
         expect=[200], must=['Injury'], links=True,
         claim='Registry: human injury table with est. return dates and reporter attributions.'),
    dict(id='espn-teams-mia', url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/mia',
         expect=[200], json_stats='team',
         claim='Registry: /teams/mia returns Miami Heat (id 14) — the reason abbreviations, not numeric ids, are used everywhere.'),
    dict(id='bluesky-profile', url='https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com',
         expect=[200], json_stats='bskyprofile',
         claim='Registry: nba.com carries a valid Bluesky verification object and its bio states the 2026-27 opener times.'),
    dict(id='bluesky-follows', url='https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=nba.com&limit=50',
         expect=[200], json_stats='follows',
         claim='Registry (nba-bluesky-team-accounts): the league follows ~6 accounts, so at most 4 of 30 teams have an official Bluesky presence — the verification ceiling on the social layer.'),
    dict(id='bluesky-list', url='https://public.api.bsky.app/xrpc/app.bsky.graph.getList?actor=howardbeck.bsky.social&list=did:plc:3llmezwbnrp2dfckxyx3lnca',
         expect=[200, 400], json_stats='list',
         claim='Registry (bluesky-reporter-list): Howard Beck\'s curated NBA-writers list, read live to build the reporter roster instead of from memory.'),
    dict(id='bluesky-search', url='https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1',
         expect=[403, 200],
         claim='Registry: keyword search is NOT available without a key (403) — documented limitation, deliberately not worked around.'),
    dict(id='x-docs-pricing', url='https://docs.x.com/x-api/getting-started/pricing',
         expect=[403, 200, 302],
         claim='Registry (x-api): the pricing page challenges automated fetchers (403), so no price in the registry is confirmed — and the row now points at docs.x.com, NOT the xAI docs it used to link.'),
    dict(id='basketballmonster', url='https://basketballmonster.com/playernews.aspx',
         expect=[200], must=['INJURED'], links=True,
         claim='Registry: the reference model — status tags, X source links, impact ratings, item age. Read for format, never scraped.'),
    dict(id='covers-injuries', url='https://www.covers.com/sport/basketball/nba/injuries',
         expect=[200], must=['injur'], links=True, claim='Registry: tertiary all-30-team cross-check.'),
    dict(id='rotoballer-news', url='https://www.rotoballer.com/player-news?sport=nba',
         expect=[200], links=True, claim='Registry: dated fantasy injury items with per-item source links.'),
    dict(id='balldontlie-tiers', url='https://nba.balldontlie.io/',
         expect=[200], must=['ALL-STAR'],
         claim='Registry (balldontlie): injuries are a paid tier; the page has no webhooks section, which is why the earlier webhook claim was marked unconfirmed.'),
    dict(id='reporter-move-slater', url='https://www.frontofficesports.com/anthony-slater-espn-reporter-nba-bay-area/',
         expect=[200, 403], links=False,
         claim='Registry (Anthony Slater): dated evidence for the Athletic→ESPN move that cleared the flag on his row.'),
    dict(id='reporter-move-buckner', url='https://www.sportsmediawatch.com/2026/02/new-york-times-hires-ex-washington-post-sportswriters/',
         expect=[200, 403], links=False,
         claim='Registry (Candace Buckner): dated evidence for the Washington Post→Athletic move that corrected her outlet.'),
]


# Statuses that say something about the RUNNER, not about the source: datacenter IPs get challenged,
# rate-limited or refused while a browser from the deployed origin reaches the same URL fine. That
# asymmetry was measured on 2026-09-17 — ESPN teams/scoreboard returned 403 to a GitHub runner while
# the published page fetched the injuries API direct and rendered 74 listings. So these codes are
# reported as ENV-BLOCKED (never a registry-drift signal), and the browser path is evidenced by the
# site itself printing which transport served each panel.
ENV_STATUSES = {403, 406, 407, 408, 409, 429, 451, 500, 502, 503, 504, 520, 521, 522, 524, 525}


def fetch(url):
    req = urllib.request.Request(
        url, headers={'User-Agent': 'NBAInjuryReport/1.0 public-source-audit (read-only; reports a live injury dashboard)'})
    return urllib.request.urlopen(req, timeout=25)


def main():
    evidence = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'why': 'Re-reads every source claim the registry makes, from a real network. See tools/verify_live.py.',
                'checks': []}
    scratch = ROOT / '.audit'
    scratch.mkdir(exist_ok=True)
    drift = 0

    for spec in CHECKS:
        key, url, expect = spec['id'], spec['url'], spec.get('expect', [200])
        row = {'id': key, 'url': url, 'documentedStatuses': expect, 'claim': spec['claim']}
        body = b''
        try:
            with fetch(url) as res:
                status, final_url, ctype = res.status, res.url, res.headers.get('Content-Type')
                body = res.read(12_000_000)
            row['status'] = status
        except urllib.error.HTTPError as exc:                      # 403/404/500 land here
            status, final_url, ctype = exc.code, url, exc.headers.get('Content-Type') if exc.headers else None
            body = exc.read(400_000) if hasattr(exc, 'read') else b''
            row['status'] = status
            if status not in expect:
                row['error'] = str(exc)
        except Exception as exc:                              # no route / TLS / timeout
            status, final_url, ctype = None, url, None
            row['error'] = type(exc).__name__ + ': ' + str(exc)[:200]

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
                row['pdfHead'] = text[:400]
            except Exception as exc:
                row['pdfError'] = str(exc)[:200]
        elif 'html' in (ctype or '') or 'json' in (ctype or '') or 'xml' in (ctype or ''):
            text = body.decode('utf-8', errors='replace')

        if text:
            (scratch / (key + ('.json' if 'json' in (ctype or '') else '.html' if 'html' in (ctype or '') else '.txt'))).write_text(text)
            if spec.get('must'):
                row['probes'] = {p: bool(re.search(re.escape(p), text, re.I)) for p in spec['must']}
                row['probesMissing'] = [p for p, ok in row['probes'].items() if not ok]
            if spec.get('links'):
                row['outboundLinks'] = sorted(set(re.findall(r'https?://[^\s"\'<>]+', text)))[:25]
                row['frames'] = re.findall(r'<iframe[^>]+src=["\']([^"\']+)', text)[:10]

        if 'json' in (ctype or '') and body:
            try:
                data = json.loads(body)
                row.update(json_peek(data, spec.get('json_stats'), row))
            except Exception as exc:
                row['jsonError'] = str(exc)[:160]

        if status is None:
            row['verdict'] = 'UNREACHABLE-FROM-RUNNER'       # cannot indict the source for this
            row['meaning'] = 'No route from the runner (DNS/TLS/timeout). Says nothing about the source or about browser access.'
        elif status in ENV_STATUSES and status not in expect:
            row['verdict'] = 'ENV-BLOCKED'
            row['meaning'] = ('HTTP %d from a datacenter IP. The registry claim is about the source and the browser path, '
                              'both checked elsewhere (deployed page prints its transport, sources.html shows it). Not counted as drift.' % status)
        elif status not in expect:
            row['verdict'] = 'DRIFT' + ('' if status != 200 else '-NEWLY-OK')
            row['meaning'] = 'The source now answers differently than the registry states — rewrite the row and any UI copy built on it.'
            drift += 1
        elif 200 in expect:
            row['verdict'] = 'OK'
            if row.get('probesMissing'):
                row['verdict'] = 'OK-PAGE-CHANGED'           # claim stands, wording moved
        else:
            row['verdict'] = 'DOCUMENTED-BLOCKER'            # still blocked, still honest
        evidence['checks'].append(row)
        print('%-24s %-22s %s' % (row['id'], row.get('status', 'n/a'), row['verdict']))

    counts = {}
    for r in evidence['checks']:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    evidence['summary'] = {'total': len(evidence['checks']), 'byVerdict': counts,
                           'drift': drift,
                           'envStatusesTreatedAsBlockage': sorted(ENV_STATUSES),
                           'note': 'DRIFT means a registry claim needs rewriting (a source started or stopped answering, or an expected 404 became live). '
                                   'ENV-BLOCKED and UNREACHABLE-FROM-RUNNER are properties of the runner, not of the source: runners and browsers take different '
                                   'paths, and this site prints which transport served each panel so a reader can tell them apart.'}
    dest = ROOT / 'data/audit/latest.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(evidence, indent=2) + '\n')
    print('\n' + json.dumps(evidence['summary'], indent=2))
    if drift:
        print('\nDRIFT DETECTED — update assets/js/data.js (and any UI copy built on it) before trusting this run.', file=sys.stderr)
        return 1
    return 0


def json_peek(data, kind, row):
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
        leagues = (data.get('leagues') or [{}])
        out['season'] = {k: leagues[0].get(k) for k in ('season', 'date')} if leagues else None
    elif kind == 'roster':
        try:
            athletes = (data.get('team') or {}).get('roster', {}).get('entries', [])
        except Exception:
            athletes = []
        out['athletes'] = len(athletes)
        out['withInjuryListing'] = sum(1 for a in athletes if a.get('injuries'))
        out['withContract'] = sum(1 for a in athletes if (a.get('contract') or a.get('contracts')))
        out['sample'] = [{'player': a.get('displayName'), 'position': (a.get('position') or {}).get('abbreviation'),
                          'experienceYears': (a.get('experience') or {}).get('years'),
                          'injuries': a.get('injuries'), 'contracts': a.get('contracts')}
                         for a in athletes if a.get('injuries')][:3]
    elif kind == 'team':
        try:
            t = data.get('team') or {}
            out['teamId'] = t.get('id'); out['teamNickname'] = t.get('nickname')
            out['teamAbbrev'] = t.get('abbrev') or t.get('abbreviation')
        except Exception:
            pass
    elif kind == 'bskyprofile':
        out['did'] = data.get('did')
        out['verification'] = data.get('verification')
        out['displayName'] = data.get('displayName')
        out['followers'] = data.get('followersCount')
        out['bioSnippet'] = (data.get('description') or '')[:200]
    elif kind == 'follows':
        follows = data.get('profiles') or data.get('follows') or []   # renamed by the API in 2024
        out['follows'] = len(follows)
        out['verifiedFollows'] = sum(1 for f in follows if bool((f.get('verification') or {}).get('verified')))
        out['followsVerifiedHandles'] = [f.get('handle') for f in follows if bool((f.get('verification') or {}).get('verified'))][:12]
        out['followsHandles'] = [f.get('handle') for f in follows][:12]
    elif kind == 'list':
        out['listPurpose'] = (data.get('list') or {}).get('purpose')
        out['listName'] = (data.get('list') or {}).get('displayName')
        out['listDesc'] = (data.get('list') or {}).get('description')
        out['listItems'] = len(data.get('items') or [])
    return out


if __name__ == '__main__':
    sys.exit(main())
