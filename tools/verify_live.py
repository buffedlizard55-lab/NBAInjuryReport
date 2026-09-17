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
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Statuses that describe the RUNNER rather than the source. Measured on 2026-09-17: ESPN returned
# 403 to a GitHub runner for /teams and /scoreboard while the deployed browser page fetched the
# injuries API on the same family of hosts and rendered 74 listings. Both facts are true at once.
# Measured, not assumed (audit run at 05:08Z on the same runner minute as the Node collector):
#   site.web.api.espn.com/.../injuries              200, 74 rows      (python urllib)
#   site.api.espn.com/.../teams|scoreboard|roster   403  to python urllib
#   …the same site.api URLs                       200 from node's fetch, same runner, minutes later
#   www.espn.com human pages                        202 with 0 bytes  (challenge interstitial)
# So this is CLIENT FINGERPRINTING, not an IP block, and not a host-wide ban: the source is reachable,
# just not by this script's deliberately plain user agent. We do not spoof browser headers to get around
# that — the point of this job is honest evidence, and the collector's own output is the counter-evidence.
ENV_STATUSES = {403, 406, 407, 408, 409, 425, 429, 451, 500, 502, 503, 504, 202, 520, 521, 522, 524, 525, 530}


FALLBACK_LIST_URI = 'at://did:plc:rkpzrwxex34r36ypejhew7ml/app.bsky.graph.list/3llmezwbnrp2d'


def registry_list_uri():
    """Read the Bluesky list AT-URI out of the registry so this check cannot drift from the URL the
    site publishes.

    `app.bsky.graph.getList` takes `list=<AT-URI>`. The previous revision of this file requested
    `?user=howardbeck.bsky.social&list=did:plc:3llmezwbnrp2dfckxyx3lnca` — `user=` is not a
    parameter of that XRPC and a bare DID is not an AT-URI, so the endpoint answered HTTP 400 on
    every run while the registry kept quoting "150 members" from a different read. Verified live
    2026-09-17: the AT-URI form returns 200 with listItemCount 150."""
    try:
        m = re.search(r'uri:\s*"(at://[^"]+app\.bsky\.graph\.list/[^"]+)"',
                      (ROOT / 'assets/js/data.js').read_text())
        if m:
            return m.group(1)
    except Exception:
        pass
    return FALLBACK_LIST_URI


def verified_object(actor):
    """True when a Bluesky actor carries a valid verification object.

    The previous revision counted `verification.verified` — a field that does not exist in the
    response — so `verifiedFollows` was 0 on every run, including runs where 4 of the 6 accounts
    the NBA follows carried valid objects. Live shape re-read 2026-09-17 (getFollows nba.com):
    verification:{verifications:[{issuer, issuerHandle, isValid, ...}], verifiedStatus:'valid'}."""
    v = (actor or {}).get('verification') or {}
    if v.get('verifiedStatus') == 'valid':
        return True
    return any(x.get('isValid') is True for x in (v.get('verifications') or []))


def classify_verdict(spec, row):
    """Decide one row's verdict. Split out so the mapping is unit-testable
    (tools/test_verify_live.py) instead of only observable through a live network run.

    `verifiesOn` (default [200]) names the statuses that would actually VERIFY the claim in
    spec['claim']. It exists because the previous mapping printed 'OK' whenever 200 was merely
    *tolerated* by `expect`: espn-scoreboard, espn-roster-mia and espn-teams-mia all came back 403
    on the last committed run and all printed 'OK' — three checks reported as verified that had
    read nothing. 'OK' now means the claim was verified; a tolerated refusal is ENV-BLOCKED with
    verified=false."""
    if row.get('verdict'):
        return row                                    # criticalLinks already decided this row
    status = row.get('status')
    verifies = spec.get('verifiesOn') or [200]
    expect = spec.get('expect', [200])
    row['verified'] = status in verifies
    if status is None:
        row['verdict'] = 'UNREACHABLE-FROM-RUNNER'
        row['meaning'] = 'No route from the runner (DNS/TLS/timeout). Says nothing about the source, and nothing about browser access.'
    elif status in verifies:
        if spec.get('blockerVerdict'):
            row['verdict'] = 'DOCUMENTED-BLOCKER'
            row['meaning'] = ('Still exactly as the registry documents it (HTTP %s). This claim IS about the refusal, '
                              'so the response verifies it — nothing is broken and no capability changed.' % status)
        else:
            row['verdict'] = 'OK-PAGE-CHANGED' if row.get('probesMissing') else 'OK'
            if row.get('probesMissing'):
                row['meaning'] = 'Reachable as documented, but the wording this check looks for moved: %s' % ", ".join(row['probesMissing'])
    elif status in ENV_STATUSES:
        row['verdict'] = 'ENV-BLOCKED'
        row['meaning'] = ('HTTP %s to this script\'s plain client, so the claim under test was NOT verified by this run. '
                          'The same URL can succeed from Node on the same runner and from a browser on the deployed origin '
                          '(measured 2026-09-17: ESPN refused this client while the Node collector read the same hosts in the '
                          'same minute) - client fingerprinting, not a source outage and not a capability change.' % status)
    elif spec.get('critical'):
        row['verdict'] = 'CAPABILITY-DRIFT'
        row['meaning'] = ('HTTP %s is not one of the statuses that verify this claim, and this check is marked critical: '
                          'what the product may claim has changed. Rewrite the registry row and the UI copy built on it.' % status)
    elif status not in expect:
        row['verdict'] = 'DRIFT-RECORDED' + ('-NEWLY-OK' if status == 200 else '')
        row['meaning'] = ('The source answers differently than the registry states. Recorded only; not a capability change.')
    else:
        row['verdict'] = 'DOCUMENTED-BLOCKER'
        row['meaning'] = ('HTTP %s is tolerated by the registry but does not verify the claim under test. '
                          'Still blocked/unavailable as documented; not counted as drift.' % status)
    return row


def decompress(body, encoding):
    """Servers gzip for us even when we do not ask; probing compressed bytes finds no words.
    Returns (text_bytes, note). A decompression failure is reported, never swallowed."""
    if not body:
        return body, None
    try:
        if body[:2] == b'\x1f\x8b':
            return gzip.decompress(body), 'gzip'
        if 'deflate' in (encoding or ''):
            import zlib
            try:
                return zlib.decompress(body), 'deflate'
            except Exception:
                return zlib.decompress(body, -15), 'raw-deflate'
    except Exception as exc:
        return b'', 'decompression failed: %s' % type(exc).__name__
    return body, None

CHECKS = [
    dict(id='nba-season', url='https://official.nba.com/nba-injury-report-2026-27-season/',
         expect=[404], links=True, critical=True, verifiesOn=[404], blockerVerdict=True,
         claim='Registry: the 2026-27 injury-report landing page does not exist yet, so no official current-season index can be polled. If this ever returns 200 with report links, the official layer becomes automatable — that single change is why this check fails the job.'),
    dict(id='nba-previous', url='https://official.nba.com/nba-injury-report-2025-26-season/',
         expect=[200], links=True,
         mustRe={'deadline 5pm-ish': r'5\s*:?\s*(00)?\s*p\.?\s*m', 'continual updates': r'continual', 'injury report wording': r'injury\s+report'},
         claim='Registry: deadline rules text (5 p.m. the day before; 11 a.m.–1 p.m. on game day; 1 p.m. for the second night of a back-to-back). Probes are tolerant of markup because the page is CMS-rendered.'),
    dict(id='nba-pdf-index', url='https://ak-static.cms.nba.com/referee/injury/',
         expect=[500, 503, 200, 403, 404], links=True, criticalLinks=True, verifiesOn=[500, 503], blockerVerdict=True,
         claim='Registry: the PDF directory is not browsable (HTTP 500 observed directly, HTTP 503 on the 2026-09-17 committed '
               'runner run - a 278-byte error page either way, no links), so the newest report cannot be enumerated. A 200 with '
               'links is a capability change and fails this job.'),
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
    dict(id='bluesky-list',
         url='https://public.api.bsky.app/xrpc/app.bsky.graph.getList?list='
             + urllib.parse.quote(registry_list_uri(), safe='') + '&limit=5',
         expect=[200], json_stats='list',
         mustRe={'members returned': r'"items"', 'list name present': r'NBA\s+Writers'},
         claim='Registry (bluesky-reporter-list): Howard Beck\'s curated NBA-writers list (150 members), used to build the reporter '
               'roster from real data instead of memory. CORRECTED 2026-09-17 (session 7): this check used to request '
               '`?user=<handle>&list=<bare DID>`, which is not how app.bsky.graph.getList works — `user=` is not a parameter and a bare '
               'DID is not an AT-URI — so the endpoint answered HTTP 400 on every run and the check never verified the list it claimed to '
               'check. The correct form is `list=<AT-URI>` (the same at:// URI the registry publishes, read from data.js at run time so the '
               'two cannot drift). Verified live the same day: HTTP 200, list.name "NBA Writers/Broadcasters/Podcasters/Bloggers", '
               'listItemCount 150, purpose referencelist, creator howardbeck.bsky.social with a valid verification object.'),
    dict(id='bluesky-search', url='https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1',
         expect=[403, 200], critical=True, verifiesOn=[403], blockerVerdict=True,
         claim='Registry: keyword search is not available without a key (403 observed) — a documented limitation, deliberately not worked around. A 200 here would mean broader free coverage becomes possible.'),
    dict(id='x-docs-pricing', url='https://docs.x.com/x-api/getting-started/pricing',
         expect=[403, 200, 301, 302, 307],
         mustRe={'pricing content present': r'\$|tier|month'},
         claim='Registry (x-api): reachability depends on the path, not on the page — this build sandbox is challenged (403) while the repo\'s own runner audit fetched it with HTTP 200 (~780 KB) on 2026-09-17. A readable page is not a licensed feed, so no price from it is quoted in the registry; and the row now points at docs.x.com, not the xAI documentation it used to link.'),
    dict(id='basketballmonster', url='https://basketballmonster.com/playernews.aspx',
         expect=[200, 403], mustRe={'player-news page': r'player\s*news|PlayerNews', 'source attribution': r'source',
                                    'status tag word in raw HTML': r'INJURED'},
         links=True,
         claim='Registry: the reference model — status tags, X source links, impact ratings, item age. A probe for the literal tag word FAILED on an earlier run of this check and a conclusion was written from it; that run was reading gzipped bytes as text, so the conclusion was retracted and the probe is restored here to settle it properly. Either answer is useful: if the raw HTML does carry the tags, the format is still not scraped, because the licence and stability questions are unresolved; if it does not, the page is client-rendered and parsing raw HTML would silently produce empty rows.'),
    dict(id='covers-injuries', url='https://www.covers.com/sport/basketball/nba/injuries',
         expect=[200, 403], mustRe={'injury table': r'injur', 'teams named': r'\bteams?\b|Atlantic|Central|Pacific'}, links=True,
         claim='Registry: tertiary all-30-team cross-check with source attribution. An earlier run found no probe text at all because the body was still gzipped — the audit tool now decompresses before probing.'),
    dict(id='rotoballer-news', url='https://www.rotoballer.com/player-news?sport=nba',
         expect=[200, 403], links=True, claim='Registry: dated fantasy injury items with per-item source links.'),
    dict(id='balldontlie-tiers', url='https://nba.balldontlie.io/',
         expect=[200, 403], mustRe={'paid tier named ALL-STAR': r'ALL[-\s]?STAR', 'injury endpoint mentioned': r'injur'},
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
        # ESPN's roster payload carries athletes[] AT THE TOP LEVEL. Re-read live 2026-09-17
        # (response timestamp 2026-09-17T21:00:13Z): {"timestamp":...,"season":{...},"athletes":[{id,
        # displayName, position.abbreviation, experience.years, status.abbreviation,
        # injuries:[{status,date}], contracts:[{salary,season{year}}]}, ...]}. The previous revision
        # read data['team']['roster']['entries'] — a path that does not exist in this payload — so a
        # 200 would still have been reported as athletes: 0. Same class of bug as the gzipped probe
        # and the getList parameter: a check that cannot fail. The old path is kept only as a
        # labelled fallback so a future shape change is reported, not silently zero.
        athletes = data.get('athletes')
        out['athletesPath'] = 'athletes (top level)'
        if not isinstance(athletes, list):
            try:
                athletes = ((data.get('team') or {}).get('roster') or {}).get('entries') or []
            except Exception:
                athletes = []
            out['athletesPath'] = 'team.roster.entries (fallback — not the shape observed live 2026-09-17)'
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
        out['verifiedFollows'] = sum(1 for f in follows if verified_object(f))
        out['unverifiedHandles'] = [f.get('handle') for f in follows if not verified_object(f)][:12]
        out['followsHandles'] = [f.get('handle') for f in follows][:12]
    elif kind == 'list':
        lst = data.get('list') or {}
        # The record's own field is `name`; `displayName` does not exist on app.bsky.graph.defs#listView,
        # so listName was null on every run even when the list came back complete.
        out['listName'] = lst.get('name') or lst.get('displayName')
        out['listPurpose'] = lst.get('purpose')
        out['listDesc'] = lst.get('description')
        out['listItemCount'] = lst.get('listItemCount')
        out['listCreatorHandle'] = (lst.get('creator') or {}).get('handle')
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
            cenc = res.headers.get('Content-Encoding')
            body = res.read(12_000_000)
            body, row['encoding'] = decompress(body, cenc)
    except urllib.error.HTTPError as exc:                     # 403 / 404 / 500 land here
        status, final_url = exc.code, url
        ctype = exc.headers.get('Content-Type') if exc.headers else None
        try:
            body = exc.read(400_000)
            body, row['encoding'] = decompress(body, exc.headers.get('Content-Encoding') if exc.headers else None)
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
        if spec.get('must') or spec.get('mustRe'):
            # Literal strings break on markup and casing; regexes are written to survive a redesign
            # while still proving the specific claim (see the per-check notes below).
            pats = {p: re.escape(p) for p in (spec.get('must') or [])}
            pats.update(spec.get('mustRe') or {})
            row['probes'] = {p: bool(re.search(pat, text, re.I | re.S)) for p, pat in pats.items()}
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

    return classify_verdict(spec, row)


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
               'claim': spec['claim'], 'critical': bool(spec.get('critical')),
               'verifiesOn': spec.get('verifiesOn') or [200], 'verified': False}
        try:
            probe(spec, row, scratch)
        except Exception as exc:
            # A bug in THIS tool is never evidence about a source, and must not cost us the run.
            row['verdict'] = 'TOOL-ERROR'
            row['meaning'] = type(exc).__name__ + ': ' + str(exc)[:200]
        evidence['checks'].append(row)
        print('%-22s %-10s %-22s %-9s %s' % (row['id'], row.get('status') or 'n/a', row['verdict'],
                                              'verified' if row.get('verified') else 'NOT-verified',
                                              row.get('finalUrl', '')))

    counts = {}
    for r in evidence['checks']:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    drift = sum(1 for r in evidence['checks'] if r['verdict'].startswith('CAPABILITY-DRIFT'))
    tool_errors = sum(1 for r in evidence['checks'] if r['verdict'] == 'TOOL-ERROR')
    verified = sum(1 for r in evidence['checks'] if r.get('verified'))
    evidence['summary'] = {
        'total': len(evidence['checks']), 'byVerdict': counts,
        'verifiedByThisRun': verified, 'notVerifiedByThisRun': len(evidence['checks']) - verified,
        'capabilityDrift': drift, 'toolErrors': tool_errors,
        'note': 'CAPABILITY-DRIFT (exit 1) means a source now answers in a way that changes what this product may claim — typically the official '
                'report page becoming live or the PDF index becoming browsable. DRIFT-RECORDED, ENV-BLOCKED and UNREACHABLE-FROM-RUNNER are written '
                'here for the reader instead of failing the job: runners and browsers take different paths, and third-party pages redesign on their '
                'own schedule. The site always prints which transport served each panel, so a reader can tell the two apart. '
                'verifiedByThisRun counts ONLY the checks whose observed status can verify the claim in their `claim` text - a tolerated '
                '403 on a JSON endpoint is ENV-BLOCKED with verified=false, never an OK, because an audit that reports a check it could '
                'not run is worse than no audit.'}

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
