#!/usr/bin/env python3
"""VENUE A TRIES TO REACH VENUE B'S DATA, AS A REAL SIGNED-IN USER. Every attempt must fail.

    python3 tools/tenant-isolation-attack.py

WHY THIS EXISTS, and why the thing it replaces was not enough. check-venue-scoping.py is
a regular expression over three HTML files. It never signs in, never asks the database
anything, and never sends a request. It proves the code has not been deleted. It has been
cited as evidence of venue isolation all week, including by me.

This signs in as a real host, at real venues, and then behaves badly on purpose: it takes
its own valid token and asks for somebody else's venue, somebody else's members, somebody
else's players, somebody else's settings, somebody else's billing. Every single attempt
has to be refused. One that succeeds is the worst class of fault this product can have,
because a venue seeing another venue's member list is a privacy breach, not a bug.

WHAT IT WILL AND WILL NOT TOUCH. The attacker is test-alpha and the victim is test-bravo,
both ours, so a WRITE that is wrongly allowed damages only a test venue. It also attempts
READS against a real venue, because a read that succeeds is the finding and a read that
fails costs nothing. It never attempts a write against a real venue, ever.

Credentials: the test host's password from ~/.gflam-migrate/test-host.pass, read and never
printed. The account is staff at the three test venues and nothing else.
"""
import json, os, sys, urllib.parse, urllib.request, urllib.error
from pathlib import Path

ENV = Path.home() / '.gflam-migrate.env'
PASS_FILE = Path.home() / '.gflam-migrate' / 'test-host.pass'
LIVE = 'https://ijkzgmdtwtgfkedqspxm.supabase.co'
UA = 'VenuePlay-tenant-attack/1.0 (contact: dean.tindale@outlook.com)'
# WITHOUT A USER AGENT CLOUDFLARE ANSWERS 1010 AND EVERY ATTACK 'FAILS' FOR THE WRONG
# REASON. The first run of this file reported the Worker refusing a made-up venue; it
# was Cloudflare refusing Python. A test that passes because it never arrived is worse
# than no test.
GAME = 'https://venueplay-game.dean-tindale.workers.dev'
EMAIL = 'test-host@venueplay.invalid'

bad = 0
def ok(what, refused, detail=''):
    global bad
    print(('  ok   ' if refused else '  LEAK ') + what + (('   ' + str(detail)[:150]) if not refused else ''))
    if not refused: bad += 1

def env():
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    return e

def anon_key():
    import re, io
    src = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               'venueplay', 'play.html'), encoding='utf-8').read()
    return re.search(r'eyJ[A-Za-z0-9_.-]{80,}', src).group(0)

def sign_in(anon):
    if not PASS_FILE.exists():
        print('STOP: %s is missing. Run venueplay-backend/tools/make-test-host.py' % PASS_FILE); sys.exit(1)
    body = json.dumps({'email': EMAIL, 'password': PASS_FILE.read_text().strip()}).encode()
    req = urllib.request.Request(LIVE + '/auth/v1/token?grant_type=password', data=body, method='POST',
                                 headers={'apikey': anon, 'Content-Type': 'application/json', 'User-Agent': UA})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as x:
        print('STOP: the test host could not sign in (%s): %s' % (x.code, x.read().decode()[:200])); sys.exit(1)
    return d['access_token']

def rest(anon, jwt, path, method='GET', body=None):
    req = urllib.request.Request(LIVE + '/rest/v1/' + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 method=method,
                                 headers={'apikey': anon, 'Authorization': 'Bearer ' + jwt,
                                          'Content-Type': 'application/json', 'User-Agent': UA})
    try:
        r = urllib.request.urlopen(req, timeout=25)
        raw = r.read()
        return r.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as x:
        return x.code, x.read().decode()[:120]

def worker(jwt, path, body):
    req = urllib.request.Request(GAME + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json',
                                          'User-Agent': UA})
    try:
        r = urllib.request.urlopen(req, timeout=25); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read() or b'{}')
        except Exception: return x.code, {}

def main():
    e = env(); anon = anon_key(); jwt = sign_in(anon)
    print('signed in as the test host (staff at the three test venues only)\n')

    st, mine = rest(anon, jwt, 'vp_venues?select=id,slug,name&order=slug')
    slugs = [v['slug'] for v in mine] if isinstance(mine, list) else []
    print('== 1. what can this host see at all? ==')
    ok('it sees ONLY its own venues', all(s.startswith('test-') for s in slugs) and len(slugs) > 0,
       'it can see: %s' % slugs)
    print('     (%d venues, all of them test: %s)\n' % (len(slugs), ', '.join(slugs)))

    st, real = rest(anon, jwt, "vp_venues?slug=eq.the-average-joe&select=id,name,join_code")
    ok('it cannot read a REAL venue by slug', not (isinstance(real, list) and real), real)

    mine_ids = {v['id'] for v in mine} if isinstance(mine, list) else set()
    print('\n== 2. other venues\' people ==')
    # THE RIGHT QUESTION IS NOT "does it see nothing", IT IS "does everything it sees
    # #    belong to it". The first version of this asserted a host sees NO staff rows at all
    # and reported a leak: the three rows were its own permissions at its own venues,
    # which the account page has to read to know what it may do. Suspect the test first. */
    # A NOTE ON WHAT THIS SECTION CAN AND CANNOT CATCH. Proved on 10 Sep by blinding the
    # venue filter: 17 checks still said ok. So these rows only bite when the database
    # actually hands over a foreign row. If PostgREST refuses the table outright, this
    # section is measuring the refusal, not the filter. The Worker section below is the
    # one with a control in it, and a control is what makes a green line mean something.
    for table, what in [('vp_members', 'members'), ('vp_players', 'players'),
                        ('vp_venue_staff', 'staff rows'), ('vp_captures', 'opt-in captures'),
                        ('vp_member_draw_results', 'draw results'), ('vp_game_reports', 'night reports')]:
        st, rows = rest(anon, jwt, '%s?select=*&limit=200' % table)
        if not isinstance(rows, list):
            print('  ok   the database refuses %s outright (%s)' % (what, st)); continue
        foreign = [r for r in rows if r.get('venue_id') and r['venue_id'] not in mine_ids]
        ok('every %s row it can see belongs to ITS venues' % what, not foreign,
           '%d of %d rows belong to somebody else' % (len(foreign), len(rows)))
        if rows and not foreign:
            print('       (%d row(s), all its own)' % len(rows))

    print('\n== 3. billing ==')
    for table, what in [('venueplay_founding', 'billing accounts'), ('vp_venue_groups', 'venue groups')]:
        st, rows = rest(anon, jwt, '%s?select=*&limit=5' % table)
        ok('cannot list %s' % what, not (isinstance(rows, list) and rows), '%d rows' % (len(rows) if isinstance(rows, list) else 0))

    print('\n== 4. writing to a venue it does not work at (attacker test-alpha, victim REAL) ==')
    st, rows = rest(anon, jwt, "vp_venues?slug=eq.the-mini-bar&select=id")
    victim = rows[0]['id'] if isinstance(rows, list) and rows else None
    if victim:
        ok('a real venue id was NOT readable, so no write is attempted', False, 'it could read the id')
    else:
        print('  ok   it cannot even find a real venue to attack (no id to write to)')

    print('\n== 5. through the Worker, with a valid token and somebody else\'s venue ==')
    st, mineids = rest(anon, jwt, 'vp_venues?slug=eq.test-alpha&select=id')
    mine_one = mineids[0]['id'] if isinstance(mineids, list) and mineids else None

    # The control. If this does NOT work, every refusal below is meaningless, because a
    # test where everything fails proves nothing at all.
    st, d = worker(jwt, '/session', {'venue_id': mine_one, 'format': 'bingo90'})
    ok('CONTROL: it CAN start a game at its own venue', st == 200, '%s %s' % (st, d))

    st, d = worker(jwt, '/session', {'venue_id': '00000000-0000-0000-0000-000000000000', 'format': 'bingo90'})
    ok('refused a session at a venue it does not work at', st == 403, '%s %s' % (st, d))

    # every host route that names a venue, with a venue it does not work at
    for path, body, what in [
        ('/host/members/import', {'venue_id': '00000000-0000-0000-0000-000000000000',
                                  'members': [{'number': 1, 'name': 'Nobody'}]}, 'add to a members list'),
        ('/host/members/remove', {'venue_id': '00000000-0000-0000-0000-000000000000', 'number': 1}, 'remove a member'),
        ('/host/members/update', {'venue_id': '00000000-0000-0000-0000-000000000000', 'number': 1,
                                  'first_name': 'Nobody'}, 'rename a member'),
        ('/report', {'code': 'ZZZZZZ', 'format': 'bingo', 'players': 1}, 'file a night report'),
    ]:
        st, d = worker(jwt, path, body)
        # REFUSED MEANS "IT DID NOT HAPPEN", NOT "IT RETURNED AN ERROR CODE". /report answers
        # 200 with {ok:false} for a venue code it cannot resolve, having done nothing at all.
        # An earlier version of this asserted st >= 400 and reported a leak that was not one.
        # It is still worth noting that every other host route says 403 with words a person can
        # act on, and this one says nothing: a console posting a stale code is told the night
        # was fine when it was never recorded.
        refused = st >= 400 or (isinstance(d, dict) and d.get('ok') is False)
        ok('refused: %s at another venue' % what, refused, '%s %s' % (st, d))

    print()
    if bad:
        print('%d LEAK(S). Stop and fix before another venue pays for this.' % bad); sys.exit(1)
    print('No leak found. Every cross-venue attempt was refused.')

if __name__ == '__main__':
    main()
