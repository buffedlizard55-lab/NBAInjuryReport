#!/usr/bin/env python3
"""Reproducible HTTP evidence; no credentials, no bypass of access controls."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
URLS = {
    'nba-season': 'https://official.nba.com/nba-injury-report-2026-27-season/',
    'nba-previous': 'https://official.nba.com/nba-injury-report-2025-26-season/',
    'nba-pdf-sample': 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf',
    'espn-injuries': 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
    'espn-teams': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams',
    'espn-scoreboard': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    'bluesky-profile': 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nba.com',
    'bluesky-search': 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=NBA%20injury&limit=1',
    'basketballmonster': 'https://basketballmonster.com/playernews.aspx',
}

def main():
    evidence = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'checks': []}
    scratch = ROOT / '.audit'
    scratch.mkdir(exist_ok=True)
    for key, url in URLS.items():
        row = {'id': key, 'url': url}
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'NBAInjuryReport/1.0 public-source-audit'})
            with urllib.request.urlopen(req, timeout=25) as res:
                body = res.read(12_000_000)
                row.update(status=res.status, finalUrl=res.url, contentType=res.headers.get('Content-Type'), sha256=hashlib.sha256(body).hexdigest())
            if key.startswith('nba-') and key != 'nba-pdf-sample':
                text = body.decode('utf-8', errors='replace')
                (scratch / (key + '.html')).write_text(text)
                row['reportLinks'] = sorted(set(re.findall(r'https?[^\s\"<>]+(?:\.pdf|\.html)', text)))[:20]
                row['frames'] = re.findall(r'<iframe[^>]+src=[\"\']([^\"\']+)', text)
            elif key == 'nba-pdf-sample':
                (scratch / 'sample.pdf').write_bytes(body)
                subprocess.run(['pdftotext', '-layout', str(scratch / 'sample.pdf'), str(scratch / 'sample.txt')], check=True)
            elif 'json' in (row.get('contentType') or ''):
                data = json.loads(body)
                row['keys'] = list(data) if isinstance(data, dict) else []
                if key == 'espn-injuries':
                    row['teamBlocks'] = len(data.get('injuries', []))
                    row['rows'] = sum(len(b.get('injuries', [])) for b in data.get('injuries', []))
                    row['season'] = data.get('season')
                if key == 'espn-scoreboard': row['events'] = len(data.get('events', []))
                if key == 'espn-teams': row['teams'] = len(data['sports'][0]['leagues'][0]['teams'])
                if key == 'bluesky-profile':
                    row['did'] = data.get('did')
                    row['verification'] = data.get('verification')
        except Exception as exc:
            row['error'] = str(exc)
            if hasattr(exc, 'code'): row['status'] = exc.code
        evidence['checks'].append(row)
    dest = ROOT / 'data/audit/latest.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))

if __name__ == '__main__': main()
