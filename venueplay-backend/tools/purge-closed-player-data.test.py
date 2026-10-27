#!/usr/bin/env python3
"""Proves the 90-day purge by building a closed venue, purging it, and checking.

A dry run against the live data returned zero for weeks because nothing is old enough
yet, and a scan that returns zero proves nothing. So this makes a venue that IS old
enough, with personal data on it that IS reachable only through the joins, runs the real
tool, and then checks what survived.

Everything it creates is named PURGETEST- and deleted at the end, pass or fail.
"""
import datetime, json, os, re, subprocess, sys, uuid

ENV = {}
for _l in open(os.path.expanduser('~/.gflam-migrate.env')):
    if '=' in _l and not _l.startswith('#'):
        _k, _v = _l.split('=', 1)
        ENV[_k] = _v.strip()
URL = ENV['NEW_SUPABASE_URL']
H = ['-H', 'apikey: ' + ENV['NEW_SERVICE_KEY'], '-H', 'Authorization: Bearer ' + ENV['NEW_SERVICE_KEY']]
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'purge-closed-player-data.py')

bad = [0]


def ok(name, cond, extra=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('   ' + str(extra) if extra else ''))
    if not cond:
        bad[0] += 1


def sb(method, path, body=None, prefer='return=representation'):
    cmd = ['curl', '-sS', '-X', method, URL + '/rest/v1/' + path] + H + ['-H', 'Prefer: ' + prefer]
    if body is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else []
    except Exception:
        return {'_raw': r.stdout[:300]}


made = {'venues': [], 'sessions': [], 'players': [], 'captures': [], 'audit': [], 'accounts': []}


def cleanup():
    for p in made['players']:
        sb('DELETE', 'vp_players?id=eq.' + p, prefer='return=minimal')
    for c in made['captures']:
        sb('DELETE', 'vp_captures?id=eq.' + c, prefer='return=minimal')
    for s in made['sessions']:
        sb('DELETE', 'vp_sessions?id=eq.' + s, prefer='return=minimal')
    for a in made['audit']:
        sb('DELETE', 'vp_admin_audit?id=eq.' + a, prefer='return=minimal')
    for v in made['venues']:
        sb('DELETE', 'vp_venues?id=eq.' + v, prefer='return=minimal')
    for a in made['accounts']:
        sb('DELETE', 'venueplay_founding?id=eq.' + a, prefer='return=minimal')


def make_account():
    """vp_venues has a check constraint, vp_venues_one_billing_parent: a venue must hang
    off exactly one of founding_id or group_id. A throwaway account is created rather than
    borrowing a real one, because a real one's venue count feeds the Stripe quantity."""
    a = sb('POST', 'venueplay_founding', {
        'venue_name': 'PURGETEST ACCOUNT', 'contact_email': 'purgetest@example.invalid',
        'postcode': '4000', 'max_seats': 1, 'plan': 'monthly', 'status': 'purgetest'})
    if not isinstance(a, list) or not a:
        print('could not create the test account: %s' % a); cleanup(); sys.exit(1)
    made['accounts'].append(a[0]['id'])
    return a[0]['id']


def make_venue(name, reason, days_ago, with_audit=True, acct=None):
    tag = 'PURGETEST-' + name
    v = sb('POST', 'vp_venues', {
        'name': tag, 'slug': 'purgetest-' + name.lower() + '-' + uuid.uuid4().hex[:6],
        'status': 'suspended', 'suspended_reason': reason, 'timezone': 'Australia/Brisbane',
        'founding_id': acct})
    if not isinstance(v, list) or not v:
        print('could not create a venue: %s' % v)
        cleanup(); sys.exit(1)
    vid = v[0]['id']
    made['venues'].append(vid)
    if with_audit:
        when = (datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(days=days_ago)).isoformat()
        a = sb('POST', 'vp_admin_audit', {
            'actor_admin': None, 'actor_label': 'PURGETEST', 'action': 'venue_archived',
            'target': 'venue:' + vid, 'detail': {'purgetest': True}, 'created_at': when})
        if isinstance(a, list) and a:
            made['audit'].append(a[0]['id'])
    return vid


def give_data(vid):
    """Give the venue a capture, which is the only personal table reachable without a session.

    WHAT THIS TEST DOES NOT COVER, and why. vp_players hangs off vp_sessions, and a
    synthetic session cannot be inserted: vp_sessions_join_code_check refuses every shape
    tried on 16 Sep, including the exact payload the game Worker sends, which succeeds
    against a real venue and fails against a new one. The rule is not in any migration in
    this repo and an hour of probing did not settle it.

    So the player path is proved a different way: a dry run against the LIVE data, which
    finds three identifiable players at the closed venue "Test" through the session join,
    and twenty members at "Riverside Bowls Club" through the roster join. That proves the
    joins reach real rows. What stays unproven here is the PATCH that nulls the fields,
    and that gap is real rather than papered over.
    """
    c = sb('POST', 'vp_captures', {
        'venue_id': vid, 'email': 'purgetest@example.invalid', 'first_name': 'Purge',
        'last_name': 'Test', 'mobile': '0400000000', 'postcode': '4000'})
    if isinstance(c, list) and c:
        made['captures'].append(c[0]['id'])
        return c[0]['id']
    print('could not create a capture: %s' % c)
    cleanup(); sys.exit(1)


def run(*args):
    r = subprocess.run([sys.executable, TOOL] + list(args), capture_output=True, text=True)
    return r.stdout + r.stderr


try:
    print('building three closed venues and one that must survive...')
    acct = make_account()
    old_v = make_venue('old', 'archived', 200, acct=acct)          # long closed, must be purged
    new_v = make_venue('recent', 'archived', 5, acct=acct)         # closed but young, must NOT be
    pay_v = make_venue('nonpayment', 'nonpayment', 200, acct=acct) # recoverable, must NOT be
    nod_v = make_venue('noaudit', 'archived', 200, with_audit=False, acct=acct)  # no date, skipped
    for v in (old_v, new_v, pay_v, nod_v):
        give_data(v)

    out = run('--days', '90')
    ok('the long-closed venue is listed as due', 'PURGETEST-old' in out and 'DUE' in out)
    ok('a venue closed 5 days ago is NOT due', re.search(r'DUE\s+PURGETEST-recent', out) is None)
    ok('a NON-PAYMENT suspension is never treated as closed',
       'PURGETEST-nonpayment' not in out,
       'they can pay and come back, and their list must still be there')
    ok('a venue with no audit row is skipped, not guessed at',
       'SKIPPED' in out and 'PURGETEST-noaudit' in out)
    ok('the dry run changes nothing', 'Nothing has changed' in out)
    before = sb('GET', 'vp_captures?id=eq.%s&select=email' % made['captures'][0])
    ok('and it really did change nothing', bool(before) and before[0].get('email') is not None,
       'capture still has its email')

    print('\napplying...')
    out = run('--days', '90', '--apply')
    ok('it reports the purge', 'PURGED' in out, out.strip().splitlines()[-1] if out.strip() else '')

    c = sb('GET', 'vp_captures?id=eq.%s&select=id' % made['captures'][0])
    ok('the opt-in capture is deleted outright', not c, c)

    # the ones that must have survived
    for label, cid in (('closed only 5 days ago', made['captures'][1]),
                       ('suspended for non-payment', made['captures'][2]),
                       ('no audit row to date it', made['captures'][3])):
        row = sb('GET', 'vp_captures?id=eq.%s&select=email' % cid)
        ok('untouched: a venue ' + label, bool(row) and row[0].get('email') is not None,
           'still there' if row else 'DELETED, which is data loss')

    a = sb('GET', "vp_admin_audit?action=eq.player_data_purged&target=eq.venue:%s&select=detail" % old_v)
    ok('the purge is recorded in the audit', bool(a), a[0]['detail'] if a else 'no row')
    if a:
        made['audit'].append(sb('GET', "vp_admin_audit?action=eq.player_data_purged&target=eq.venue:%s&select=id" % old_v)[0]['id'])
finally:
    print('\ncleaning up everything this test created...')
    cleanup()
    left = sb('GET', 'vp_venues?name=like.PURGETEST*&select=id,name')
    la = sb('GET', 'venueplay_founding?venue_name=like.PURGETEST*&select=id')
    ok('no test venue or account left behind', not left and not la, (left, la))

print(('  %d FAILED' % bad[0]) if bad[0] else '  ALL CHECKS PASSED')
sys.exit(1 if bad[0] else 0)
