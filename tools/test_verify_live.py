#!/usr/bin/env python3
"""Unit tests for the source-audit tool itself (tools/verify_live.py).

Why a test suite for a verification script: three of its checks were quietly wrong on the last
committed run, and each one produced a confident, specific, WRONG number in data/audit/latest.json
while the job stayed green. A check that cannot fail is worse than no check.

  1. `bluesky-list` requested `?user=<handle>&list=<bare DID>`. `user=` is not a parameter of
     app.bsky.graph.getList and a bare DID is not an AT-URI, so the endpoint answered HTTP 400 on
     every run; the verdict printed OK-PAGE-CHANGED and read like "the list may have moved".
  2. `verifiedFollows` counted `verification.verified`, a field the API does not return, so it was
     0 even though 4 of the 6 accounts nba.com follows carry valid verification objects.
  3. `json_peek(kind='roster')` read `data['team']['roster']['entries']`; ESPN's roster payload
     carries `athletes[]` at the top level, so a 200 would still have reported athletes: 0.
  4. The verdict ladder printed 'OK' for an HTTP 403 whenever 200 was merely tolerated by `expect`
     — espn-scoreboard, espn-roster-mia and espn-teams-mia were all 403 and all printed 'OK'.

Every fixture below is a response shape read back live on 2026-09-17 (see AUDIT.md, session 7).

Run:  python3 -m unittest discover -s tools -p 'test_*.py'
"""
import unittest

import verify_live as V


class VerdictMapping(unittest.TestCase):
    """'OK' must mean the claim was verified, never merely that the status was tolerated."""

    def test_tolerated_403_on_a_json_endpoint_is_env_blocked_and_not_verified(self):
        spec = dict(id='espn-scoreboard', expect=[200, 403], critical=True)
        row = V.classify_verdict(spec, {'status': 403})
        self.assertEqual(row['verdict'], 'ENV-BLOCKED')
        self.assertFalse(row['verified'])
        self.assertIn('NOT verified', row['meaning'])

    def test_200_verifies_the_claim(self):
        row = V.classify_verdict(dict(id='x', expect=[200, 403]), {'status': 200})
        self.assertEqual(row['verdict'], 'OK')
        self.assertTrue(row['verified'])

    def test_200_with_a_missing_probe_is_page_changed_but_still_verified(self):
        row = V.classify_verdict(dict(id='x', expect=[200]), {'status': 200, 'probesMissing': ['status tag word']})
        self.assertEqual(row['verdict'], 'OK-PAGE-CHANGED')
        self.assertTrue(row['verified'])
        self.assertIn('status tag word', row['meaning'])

    def test_documented_404_verifies_a_claim_that_is_about_the_404(self):
        spec = dict(id='nba-season', expect=[404], critical=True, verifiesOn=[404], blockerVerdict=True)
        row = V.classify_verdict(spec, {'status': 404})
        self.assertEqual(row['verdict'], 'DOCUMENTED-BLOCKER')
        self.assertTrue(row['verified'])

    def test_official_page_going_live_is_the_capability_drift_tripwire(self):
        spec = dict(id='nba-season', expect=[404], critical=True, verifiesOn=[404], blockerVerdict=True)
        self.assertEqual(V.classify_verdict(spec, {'status': 200})['verdict'], 'CAPABILITY-DRIFT')

    def test_search_opening_up_is_drift_while_the_403_verifies_the_limitation(self):
        spec = dict(id='bluesky-search', expect=[403, 200], critical=True, verifiesOn=[403], blockerVerdict=True)
        self.assertEqual(V.classify_verdict(spec, {'status': 403})['verdict'], 'DOCUMENTED-BLOCKER')
        self.assertTrue(V.classify_verdict(spec, {'status': 403})['verified'])
        self.assertEqual(V.classify_verdict(spec, {'status': 200})['verdict'], 'CAPABILITY-DRIFT')

    def test_no_route_says_nothing_about_the_source(self):
        row = V.classify_verdict(dict(id='x', expect=[200]), {'status': None})
        self.assertEqual(row['verdict'], 'UNREACHABLE-FROM-RUNNER')
        self.assertFalse(row['verified'])

    def test_a_verdict_already_set_by_critical_links_is_never_overwritten(self):
        row = V.classify_verdict(dict(id='nba-pdf-index', expect=[200, 500]),
                                 {'status': 200, 'verdict': 'CAPABILITY-DRIFT', 'meaning': 'index exposes links'})
        self.assertEqual(row['verdict'], 'CAPABILITY-DRIFT')
        self.assertEqual(row['meaning'], 'index exposes links')

    def test_tolerated_but_non_verifying_status_is_documented_blocker_not_ok(self):
        row = V.classify_verdict(dict(id='x', expect=[200, 404]), {'status': 404})
        self.assertEqual(row['verdict'], 'DOCUMENTED-BLOCKER')
        self.assertFalse(row['verified'])

    def test_unexpected_status_on_a_non_critical_check_is_recorded_not_enforced(self):
        row = V.classify_verdict(dict(id='x', expect=[200]), {'status': 301})
        self.assertTrue(row['verdict'].startswith('DRIFT-RECORDED'))
        self.assertFalse(row['verified'])


class BlueskyShapes(unittest.TestCase):
    """Fixtures are the live 2026-09-17 responses (getFollows nba.com / getList at:// URI form)."""

    def test_verification_object_is_counted_from_the_field_that_exists(self):
        verified = {'verification': {'verifications': [{'issuer': 'did:plc:z72i', 'issuerHandle': 'bsky.app',
                                                       'isValid': True}],
                                     'verifiedStatus': 'valid'}}
        self.assertTrue(V.verified_object(verified))

    def test_account_without_a_verification_object_is_not_counted(self):
        # dallasmavs.bsky.social: followed by the NBA, bio "Mavs.com", no verification key at all.
        self.assertFalse(V.verified_object({'handle': 'dallasmavs.bsky.social', 'description': 'Mavs.com'}))
        self.assertFalse(V.verified_object(None))
        self.assertFalse(V.verified_object({'verification': {'verifications': [], 'verifiedStatus': 'none'}}))

    def test_follows_count_reproduces_the_measured_4_of_6(self):
        follows = {'follows': [
            {'handle': 'trailblazers.bsky.social', 'verification': {'verifiedStatus': 'valid'}},
            {'handle': 'dallasmavs.bsky.social', 'description': 'Mavs.com'},
            {'handle': 'nuggets.bsky.social', 'verification': {'verifiedStatus': 'valid'}},
            {'handle': 'sixersnba.bsky.social', 'verification': {'verifiedStatus': 'valid'}},
            {'handle': 'wnba.com', 'verification': {'verifiedStatus': 'valid'}},
            {'handle': 'bsky.app', 'verification': {'verifications': [], 'verifiedStatus': 'none',
                                                    'trustedVerifierStatus': 'valid'}},
        ]}
        out = V.json_peek(follows, 'follows')
        self.assertEqual(out['follows'], 6)
        self.assertEqual(out['verifiedFollows'], 4)
        self.assertIn('dallasmavs.bsky.social', out['unverifiedHandles'])
        # a trusted verifier (bsky.app itself) is NOT the same thing as a verified account
        self.assertIn('bsky.app', out['unverifiedHandles'])

    def test_list_record_reads_name_and_item_count(self):
        out = V.json_peek({'list': {'name': 'NBA Writers/Broadcasters/Podcasters/Bloggers',
                                    'purpose': 'app.bsky.graph.defs#referencelist',
                                    'listItemCount': 150,
                                    'creator': {'handle': 'howardbeck.bsky.social'}},
                           'items': [{'uri': 'at://x'}, {'uri': 'at://y'}]}, 'list')
        self.assertEqual(out['listName'], 'NBA Writers/Broadcasters/Podcasters/Bloggers')
        self.assertEqual(out['listItemCount'], 150)
        self.assertEqual(out['listCreatorHandle'], 'howardbeck.bsky.social')
        self.assertEqual(out['listItems'], 2)


class EspnShapes(unittest.TestCase):
    def test_roster_athletes_are_read_from_the_top_level(self):
        payload = {'timestamp': '2026-09-17T21:00:13Z', 'status': 'success',
                   'season': {'year': 2027, 'displayName': '2026-27'},
                   'athletes': [
                       {'id': '4066261', 'displayName': 'Bam Adebayo',
                        'position': {'abbreviation': 'C'}, 'experience': {'years': 9},
                        'status': {'abbreviation': 'Active'},
                        'injuries': [{'status': 'Day-To-Day', 'date': '2026-07-28T16:16Z'}],
                        'contracts': [{'salary': 49500000, 'season': {'year': 2027}}]},
                       {'id': '3032977', 'displayName': 'Giannis Antetokounmpo',
                        'position': {'abbreviation': 'F'}, 'experience': {'years': 13},
                        'status': {'abbreviation': 'Active'},
                        'injuries': [{'status': 'Day-To-Day', 'date': '2026-09-02T16:32Z'}]},
                   ]}
        out = V.json_peek(payload, 'roster')
        self.assertEqual(out['athletes'], 2)
        self.assertEqual(out['withInjuryListing'], 2)
        self.assertEqual(out['withContract'], 1)
        self.assertEqual(out['athletesPath'], 'athletes (top level)')

    def test_the_old_path_is_kept_as_a_labelled_fallback_and_reports_zero_honestly(self):
        out = V.json_peek({'team': {'roster': {'entries': [{'displayName': 'A'}]}}}, 'roster')
        self.assertEqual(out['athletes'], 1)
        self.assertIn('fallback', out['athletesPath'])

    def test_empty_payload_is_zero_not_an_exception(self):
        self.assertEqual(V.json_peek({}, 'roster')['athletes'], 0)
        self.assertEqual(V.json_peek({'team': {}}, 'roster')['athletes'], 0)


class CheckTableIntegrity(unittest.TestCase):
    def test_the_list_check_uses_the_at_uri_form_and_never_user(self):
        spec = [c for c in V.CHECKS if c['id'] == 'bluesky-list'][0]
        self.assertIn('list=at%3A%2F%2F', spec['url'])
        self.assertNotIn('user=', spec['url'])
        self.assertNotIn('&list=did:', spec['url'])
        self.assertEqual(spec['expect'], [200])

    def test_the_list_url_comes_from_the_registry_so_the_two_cannot_drift(self):
        uri = V.registry_list_uri()
        self.assertTrue(uri.startswith('at://'))
        self.assertIn('app.bsky.graph.list/', uri)
        self.assertIn(V.urllib.parse.quote(uri, safe=''), [c for c in V.CHECKS if c['id'] == 'bluesky-list'][0]['url'])

    def test_every_check_is_unique_and_carries_a_claim(self):
        ids = [c['id'] for c in V.CHECKS]
        self.assertEqual(len(ids), len(set(ids)))
        for c in V.CHECKS:
            self.assertTrue(len(c.get('claim', '')) > 40, c['id'])
            self.assertTrue(c['url'].startswith('https://'), c['id'])

    def test_verifies_on_statuses_are_always_a_subset_of_the_documented_statuses(self):
        for c in V.CHECKS:
            for s in (c.get('verifiesOn') or [200]):
                self.assertIn(s, c.get('expect', [200]), '%s verifies on an undocumented status %s' % (c['id'], s))

    def test_blocker_checks_only_use_non_200_verifying_statuses(self):
        for c in V.CHECKS:
            if c.get('blockerVerdict'):
                self.assertNotIn(200, c.get('verifiesOn') or [], c['id'])


if __name__ == '__main__':
    unittest.main()
