#!/usr/bin/env python3
"""Discover reports from NBA's season page, never guess a timestamped PDF URL.
Uses pdftotext -layout; unknown layouts fail closed. Raw evidence is hashed and linked.
Run with Python 3.11+ and poppler-utils. All network errors become visible health flags.
"""
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(os.environ.get('NBA_WATCH_OUT', Path(__file__).resolve().parent.parent))
PDF_RE = re.compile(r'https://ak-static\.cms\.nba\.com/referee/injury/Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf')
HEADERS = ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason']
STATUSES = {'Out', 'Doubtful', 'Questionable', 'Probable', 'Available'}

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NBAInjuryReport/1.0 (+public injury report monitor)'})
    with urllib.request.urlopen(req, timeout=25) as res:
        if res.url.split('/')[2] not in {'official.nba.com', 'ak-static.cms.nba.com'}:
            raise ValueError('Unexpected redirect host')
        body = res.read(12_000_001)
        if len(body) > 12_000_000: raise ValueError('Response too large')
        return body

def discover(text):
    out = []
    for m in PDF_RE.finditer(html.unescape(text).replace('\\/', '/')):
        stamp = dt.datetime.strptime(' '.join(m.groups()), '%Y-%m-%d %I %M %p').replace(tzinfo=ZoneInfo('America/New_York'))
        out.append((stamp, m.group(0)))
    return sorted(set(out), reverse=True)

def parse_report(text, url):
    """Blank-separated player blocks survive pdftotext's per-page column shifts.
    Reasons can precede a centered player name or continue across a page break.
    Reject any ambiguous block rather than attach another player's diagnosis.
    """
    rows, flags, missing = [], [], []
    context = {'gameDate': '', 'gameTimeET': '', 'matchup': '', 'teamName': ''}
    if not all(h in text for h in HEADERS):
        return [], [], ['Report header not recognized']
    cleaned = []
    for line in text.replace('\f', '\n').splitlines():
        if 'Injury Report:' in line or 'Current Status' in line or re.search(r'Page \d+ of \d+', line): continue
        cleaned.append(line)
    status_re = re.compile(r'(?<=\s)(Out|Doubtful|Questionable|Probable|Available)(?=\s|$)')
    for blocknum, block in enumerate(re.split(r'\n\s*\n', '\n'.join(cleaned)), 1):
        if not block.strip(): continue
        lines = block.splitlines()
        matches = [(i, m) for i, line in enumerate(lines) for m in status_re.finditer(line)]
        if not matches:
            if 'NOT YET SUBMITTED' in block:
                missing.append({'context': dict(context), 'raw': block.strip()})
            elif rows and not re.search(r'Injury/Illness|@|,', block):
                rows[-1]['reason'] += ' ' + ' '.join(block.split())
            else: flags.append(f'Block {blocknum}: unrecognized block {block.strip()}')
            continue
        if len(matches) != 1:
            flags.append(f'Block {blocknum}: ambiguous multiple status rows'); continue
        i, match = matches[0]
        cells = re.split(r'\s{2,}', lines[i][:match.start()].strip())
        if not cells or ',' not in cells[-1]:
            flags.append(f'Block {blocknum}: player name not recognized'); continue
        player = cells.pop()
        for cell in cells:
            if re.fullmatch(r'\d{2}/\d{2}/\d{4}', cell): context['gameDate'] = cell
            elif re.fullmatch(r'\d{2}:\d{2}.*', cell): context['gameTimeET'] = cell
            elif re.fullmatch(r'[A-Z]{2,4}@[A-Z]{2,4}', cell):
                context['matchup'], context['teamName'] = cell, ''
            else: context['teamName'] = cell
        if not all(context[k] for k in ('gameDate', 'matchup', 'teamName')):
            flags.append(f'Block {blocknum}: missing game/team context'); continue
        # All non-player lines in the same block belong to its wrapped reason.
        reason = ' '.join(lines[:i] + [lines[i][match.end():]] + lines[i+1:])
        reason = ' '.join(reason.split())
        last, first = player.split(',', 1)
        rows.append(dict(context, player=first.strip() + ' ' + last.strip(), playerAsReported=player,
                         status=match.group(1), reason=reason, url=url, block=blocknum, sourceTier='official-nba'))
    if not rows and not missing: flags.append('No recognized rows')
    for row in rows:
        if not row['reason']: flags.append('Missing reason: ' + row['player'])
    keys = [(r['gameDate'], r['matchup'], r['teamName'], r['player']) for r in rows]
    if len(keys) != len(set(keys)): flags.append('Duplicate player/game rows')
    return rows, missing, flags

def main():
    now = dt.datetime.now(dt.timezone.utc)
    dest = ROOT / 'data/live/official.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    try: previous = json.loads(dest.read_text())
    except (OSError, ValueError): previous = {}
    result = {'checkedAt': now.isoformat(), 'sourceTier': 'official-nba', 'rows': [], 'flags': [], 'attempts': [], 'health': 'unavailable'}
    start = now.year if now.month >= 7 else now.year - 1
    found = []
    for year in [start, start - 1]:
        page = f'https://official.nba.com/nba-injury-report-{year}-{str(year+1)[-2:]}-season/'
        try:
            body = get(page)
            links = discover(body.decode('utf-8', errors='replace'))
            result['attempts'].append({'url': page, 'ok': True, 'linkedReports': len(links)})
            found.extend((stamp, url, page) for stamp, url in links)
            if links: break
        except Exception as exc: result['attempts'].append({'url': page, 'ok': False, 'error': str(exc)})
    try:
        if not found: raise ValueError('No timestamped PDF links discovered on the official season pages; no guessed URLs requested')
        stamp, url, page = max(found)
        if stamp > now + dt.timedelta(minutes=1): raise ValueError('Future report timestamp; quarantined')
        result.update(reportAt=stamp.isoformat(), url=url, landingUrl=page)
        pdf = get(url)
        if not pdf.startswith(b'%PDF'): raise ValueError('Not a PDF response')
        result['sha256'] = hashlib.sha256(pdf).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'report.pdf', Path(tmp) / 'report.txt'
            source.write_bytes(pdf)
            subprocess.run(['pdftotext', '-layout', str(source), str(output)], check=True, timeout=30)
            text = output.read_text()
        rows, missing, flags = parse_report(text, url)
        result.update(rows=rows, notSubmitted=missing, flags=flags)
        result['health'] = 'parse-error' if flags else 'stale' if now - stamp > dt.timedelta(hours=24) else 'ok'
        if result['health'] == 'stale': result['flags'].append('Latest linked report is over 24 hours old; historical only, not alertable')
        if result['health'] == 'parse-error': result['rows'] = []
    except Exception as exc:
        result['flags'].append(str(exc))
        # Last-good evidence retains its original timestamp; never masquerades as a fresh fetch.
        for key in ['rows', 'reportAt', 'url', 'sha256', 'landingUrl', 'notSubmitted']:
            if key in previous: result[key] = previous[key]
        result['lastGoodRetained'] = bool(result['rows'])
    dest.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'rows'}, indent=2))

if __name__ == '__main__': main()
