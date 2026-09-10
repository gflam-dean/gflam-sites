#!/usr/bin/env python3
"""Create three TEST VENUES on live, so testing never goes near a real pub.

    python3 venueplay-backend/tools/make-test-venues.py --list     show what it would do
    python3 venueplay-backend/tools/make-test-venues.py            do it
    python3 venueplay-backend/tools/make-test-venues.py --remove   take them away again

WHY. Every live test so far has either touched The Mini Bar or risked The Average Joe,
which is a real pub with real customers in it. Three venues that are OURS mean a test can
run a draw twice, kill a connection mid question, or deliberately break a screen, without
ever being near a room with people in it.

They are real rows in the real database, because a fake database proves nothing. What
keeps them harmless:
  slug starts test-        so anything can find and exclude them
  hide_from_trusted true   they never appear in the trusted-by marquee
  status active            they behave exactly like a venue, which is the point
  only the test host is staff at them, and it is staff at nothing else

Deliberately different from each other, because three identical venues test one venue
three times:
  test-alpha    one host, no logo, plain
  test-bravo    a manager as well as a host, a logo, in a group
  test-charlie  no logo, tiny plan, for the over-plan and suspension paths

Run it twice and it updates rather than duplicating.
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

ENV  = Path.home() / '.gflam-migrate.env'
LIVE = 'https://gpoolavkghnxedzrmtmc.supabase.co'
HOST_EMAIL = 'test-host@venueplay.invalid'

VENUES = [
    {'slug': 'test-alpha',   'name': 'Test Alpha',   'state': 'QLD', 'postcode': '4220',
     'note': 'one host, no logo, the plain case'},
    {'slug': 'test-bravo',   'name': 'Test Bravo',   'state': 'QLD', 'postcode': '4218',
     'note': 'a manager as well as a host, has a logo'},
    {'slug': 'test-charlie', 'name': 'Test Charlie', 'state': 'NSW', 'postcode': '2026',
     'note': 'small plan, for the over-plan and suspension paths'},
]

def die(m): print('STOP: ' + m); sys.exit(1)

def env():
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    if not e.get('OLD_SERVICE_KEY'): die('OLD_SERVICE_KEY is not in the env file')
    return e

def rest(e, method, path, body=None, prefer=None):
    h = {'apikey': e['OLD_SERVICE_KEY'], 'Authorization': 'Bearer ' + e['OLD_SERVICE_KEY'],
         'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(LIVE + '/rest/v1/' + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30)
        raw = r.read()
        return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read() or b'{}')
        except Exception: return x.code, {}

def auth_user_id(e):
    req = urllib.request.Request(LIVE + '/auth/v1/admin/users?per_page=200',
        headers={'apikey': e['OLD_SERVICE_KEY'], 'Authorization': 'Bearer ' + e['OLD_SERVICE_KEY']})
    d = json.load(urllib.request.urlopen(req, timeout=30))
    u = next((x for x in (d.get('users') or []) if (x.get('email') or '').lower() == HOST_EMAIL), None)
    if not u: die('the test host does not exist yet. Run make-test-host.py first.')
    return u['id']

def main():
    show = '--list' in sys.argv
    remove = '--remove' in sys.argv
    e = env()
    uid = auth_user_id(e)

    if show:
        print('would create, on LIVE, hidden from the marquee:')
        for v in VENUES: print('   %-14s %-14s %s' % (v['slug'], v['name'], v['note']))
        print('\n   staff: only %s' % HOST_EMAIL)
        return

    if remove:
        for v in VENUES:
            st, _ = rest(e, 'DELETE', 'vp_venues?slug=eq.' + v['slug'])
            print('  removed %-14s (%s)' % (v['slug'], st))
        return

    for v in VENUES:
        st, rows = rest(e, 'GET', 'vp_venues?slug=eq.%s&select=id,founding_id' % v['slug'])
        if rows:
            vid = rows[0]['id']; print('  %-14s already there' % v['slug'])
        else:
            # a venue insists on a billing account, so it gets its own rather than
            # borrowing a real one
            st, f = rest(e, 'POST', 'venueplay_founding',
                         {'venue_name': v['name'], 'contact_name': 'VenuePlay testing',
                          'contact_email': HOST_EMAIL, 'max_seats': 1, 'marketing_opt_in': False},
                         prefer='return=representation')
            if st not in (200, 201) or not f: die('could not make a billing row for %s: %s' % (v['slug'], f))
            fid = (f[0] if isinstance(f, list) else f)['id']
            st, r = rest(e, 'POST', 'vp_venues',
                         {'slug': v['slug'], 'name': v['name'], 'state': v['state'],
                          'postcode': v['postcode'], 'status': 'active', 'founding_id': fid,
                          'hide_from_trusted': True, 'timezone': 'Australia/Brisbane',
                          'included_players': 40 if v['slug'] != 'test-charlie' else 5},
                         prefer='return=representation')
            if st not in (200, 201) or not r: die('could not create %s: %s' % (v['slug'], r))
            vid = (r[0] if isinstance(r, list) else r)['id']
            print('  %-14s created' % v['slug'])

        st, s = rest(e, 'GET', 'vp_venue_staff?venue_id=eq.%s&auth_user_id=eq.%s&select=id' % (vid, uid))
        if not s:
            st, _ = rest(e, 'POST', 'vp_venue_staff',
                         {'venue_id': vid, 'auth_user_id': uid, 'role': 'owner',
                          'display_name': 'Test host'})
            print('                 test host added as owner (%s)' % st)

    print('\n  three test venues, hidden from the marquee, staffed only by the test host.')
    print('  next: their advertising, a members draw, a raffle, a trivia night and a playlist.')

if __name__ == '__main__':
    main()
