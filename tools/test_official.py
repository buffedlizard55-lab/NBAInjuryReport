import datetime as dt
from pathlib import Path
import unittest
from collect_official import discover, parse_report

URL = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-04-12_01_00PM.pdf'
class OfficialParserTests(unittest.TestCase):
    def test_real_official_capture(self):
        text = (Path(__file__).resolve().parent.parent / 'data/audit/sample-report.txt').read_text()
        rows, missing, flags = parse_report(text, URL)
        self.assertEqual(flags, [])
        self.assertEqual(len(rows), 229)
        self.assertEqual(len({r['teamName'] for r in rows}), 30)
        self.assertEqual({r['gameDate'] for r in rows}, {'04/12/2026'})
        self.assertTrue(all(r['url'] == URL and r['reason'] for r in rows))
        by_name = {r['player']: r for r in rows}
        self.assertEqual(by_name['Nickeil Alexander-Walker']['reason'], 'Injury/Illness - Right Great Toe; Sprain')
        self.assertEqual(by_name['Karl-Anthony Towns']['reason'], 'Injury/Illness - Right Elbow; Right Elbow Injury Management')
        self.assertEqual(by_name['Jalen Johnson']['reason'], 'Rest')
        self.assertEqual(by_name['Luka Doncic']['teamName'], 'Los Angeles Lakers')
        self.assertEqual(by_name['LeBron James']['status'], 'Questionable')
        self.assertEqual(by_name['Dyson Daniels']['status'], 'Out')
    def test_no_guessed_pdf_urls(self):
        self.assertEqual(discover('<html>NBA injury report</html>'), [])
        self.assertEqual(discover('<a href="https://evil.example/Injury-Report_2026-04-12_01_00PM.pdf">'), [])
        links = discover('<a href="'+URL+'">latest</a>')
        self.assertEqual(links[0][1], URL)
        self.assertEqual(links[0][0].astimezone(dt.timezone.utc).hour, 17)
    def test_unknown_layout_quarantined(self):
        rows, _, flags = parse_report('Player Status\nSomeone Out', URL)
        self.assertEqual(rows, [])
        self.assertTrue(flags)
    def test_ambiguous_statuses_flagged(self):
        text = 'Game Date Game Time Matchup Team Player Name Current Status Reason\n\n04/12/2026  07:00 (ET)  BOS@NYK  Boston Celtics  Test, One  Out  Knee\n  Test, Two  Questionable  Foot'
        rows, _, flags = parse_report(text, URL)
        self.assertTrue(flags)
        self.assertEqual(rows, [])

if __name__ == '__main__': unittest.main()
