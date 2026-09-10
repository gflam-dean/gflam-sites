#!/usr/bin/env python3
"""RUN A REAL BIG NIGHT AT A REAL VENUE AND WATCH THE MONEY. Live Worker, live database, live Stripe.

    python3 venueplay-backend/tools/live-overage-test.py --venue the-jolly-jess --extra 1 --go
    python3 venueplay-backend/tools/live-overage-test.py --venue the-mini-bar   --extra 2 --go

Without --go it prints what it would do and stops.

WHY THIS EXISTS. Dean, 11 Sep 2026, after a morning of billing faults that every test suite
had passed: "FML its money man! We need to check it properly or we end up in the same
situation or billing people that is incorrect." Then: "test it all please, use Jess and add a
second player. I will refund if and when it charges."

Nothing here is mocked. It signs in as the TEST HOST (test-host@venueplay.invalid, see
make-test-host.py), gives that account a TEMPORARY HQ admin row so it can act at the named
venue the way View-as does, and then does exactly what a host and a room of phones do:

    POST /session              open the night           (freezes plan_cap_at_start)
    POST /join        x N      cap + extra phones join  (mints vp_players)
    POST /host/game            start bingo90            (expects 402 overage_approval_required)
    POST /host/overage/ack     the host taps OK
    POST /host/game            start again              (mints a vp_cards row per player: they PLAYED)
    POST /host/game/end        end the round
    POST /session/close        close the night          -> chargeNightOverage -> Stripe

Then it reads Stripe with the READ-ONLY key and the database with the service key and
compares AFTER against BEFORE. It prints every difference and says PASS or FAIL against
what the code promises:

    active subscription  -> one new invoice item "<Venue> - Extra Player - DD/MM/YYYY",
                            quantity = extra, unit $2.00, on its OWN invoice, paid;
                            overage_streak advanced by one night
    trialing / free month -> NOTHING new in Stripe, streak untouched

The admin row is removed in a finally block and its removal is verified, so a crash cannot
leave the test host with HQ rights. Every row it writes is named in the output so it can be
found in the audit trail: the session is titled "LIVE OVERAGE TEST" and the phones are
"Test phone 1..N".

IT CHARGES A REAL CARD when the venue is active. That is the point. Dean refunds it.
"""
import argparse, json, secrets, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
from vp_live import live, read_env

GAME = 'https://venueplay-game.dean-tindale.workers.dev'
TEST_HOST_EMAIL = 'test-host@venueplay.invalid'
PASS_FILE = Path.home() / '.gflam-migrate' / 'test-host.pass'
ADMIN_LABEL = 'VenuePlay test host (TEMPORARY, live-overage-test.py)'
BRISBANE_OFFSET_H = 10

E = read_env()
L = live()
STRIPE = E.get('STRIPE_READ_KEY') or sys.exit('STOP: STRIPE_READ_KEY is not in ~/.gflam-migrate.env')

def http(url, method='GET', body=None, headers=None, timeout=40):
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    # Cloudflare answers a bare Python User-Agent with error 1010 before the Worker ever sees it.
    h = {'Content-Type': 'application/json', 'User-Agent': 'venueplay-live-overage-test/1.0'}; h.update(headers or {})
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            t = resp.read().decode(); return resp.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as x:
        t = x.read().decode(errors='replace')
        try: return x.code, json.loads(t)
        except Exception: return x.code, {'raw': t[:300]}

def db(path, method='GET', body=None, prefer=None):
    h = {'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key}
    if prefer: h['Prefer'] = prefer
    st, d = http(L.rest_url + '/rest/v1/' + path, method, body, h)
    if st >= 300: raise RuntimeError('database %s %s -> %s %s' % (method, path.split('?')[0], st, str(d)[:300]))
    return d

def stripe(path, **q):
    url = 'https://api.stripe.com/v1/' + path + ('?' + urllib.parse.urlencode(q) if q else '')
    st, d = http(url, headers={'Authorization': 'Bearer ' + STRIPE})
    if st >= 300: raise RuntimeError('stripe %s -> %s %s' % (path, st, str(d)[:300]))
    return d

def money(c): return '$%.2f' % ((c or 0) / 100)

def stripe_state(cus):
    subs = stripe('subscriptions', customer=cus, status='all', limit=5).get('data', [])
    sub = subs[0] if subs else {}
    return {
        'sub_status': sub.get('status'),
        'sub_qty': (sub.get('items', {}).get('data') or [{}])[0].get('quantity'),
        'balance': stripe('customers/' + cus).get('balance'),
        'pending_items': {i['id']: i for i in stripe('invoiceitems', customer=cus, pending='true', limit=50).get('data', [])},
        'invoices': {i['id']: i for i in stripe('invoices', customer=cus, limit=20).get('data', [])},
    }

def db_state(venue_id):
    v = db('vp_venues?id=eq.%s&select=max_players,pending_players,overage_streak,overage_streak_peaks,overage_streak_day,status' % venue_id)[0]
    audit = db('vp_admin_audit?target=eq.%s&select=id,action,detail,created_at&order=created_at.desc&limit=10' % venue_id)
    return {'venue': v, 'audit_ids': {a['id'] for a in audit}, 'audit': audit}

def brisbane_date_today():
    t = time.gmtime(time.time() + BRISBANE_OFFSET_H * 3600)
    return '%02d/%02d/%04d' % (t.tm_mday, t.tm_mon, t.tm_year)

class Grant:
    """Temporary HQ admin row for the test host. Removed in __exit__, removal verified."""
    def __init__(self, uid): self.uid = uid
    def __enter__(self):
        existing = db('vp_platform_admins?auth_user_id=eq.%s&select=auth_user_id' % self.uid)
        if existing: raise RuntimeError('the test host ALREADY has an admin row; refusing to continue until that is understood')
        db('vp_platform_admins', 'POST', {'auth_user_id': self.uid, 'role': 'accounts', 'label': ADMIN_LABEL}, 'return=minimal')
        print('  granted   temporary HQ admin row (role accounts) to the test host')
        return self
    def __exit__(self, *a):
        db('vp_platform_admins?auth_user_id=eq.%s' % self.uid, 'DELETE', prefer='return=minimal')
        left = db('vp_platform_admins?auth_user_id=eq.%s&select=auth_user_id' % self.uid)
        if left: print('  !!!!!!!!  THE ADMIN ROW IS STILL THERE. Remove it by hand: vp_platform_admins auth_user_id=' + self.uid)
        else: print('  removed   the temporary admin row (verified gone)')

def sign_in():
    if not PASS_FILE.exists(): sys.exit('STOP: %s is missing; run make-test-host.py' % PASS_FILE)
    st, d = http(L.rest_url + '/auth/v1/token?grant_type=password', 'POST',
                 {'email': TEST_HOST_EMAIL, 'password': PASS_FILE.read_text().strip()},
                 {'apikey': L.service_key})
    if st != 200: sys.exit('STOP: test host sign-in failed (%s): %s' % (st, d))
    return d['access_token'], d['user']['id']

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--venue', required=True, help='venue slug')
    ap.add_argument('--extra', type=int, required=True, help='players OVER the cap to bring')
    ap.add_argument('--go', action='store_true')
    a = ap.parse_args()
    print(L.banner())
    if L.which != 'old': print('  NOTE: VP_LIVE is not old; make sure the game Worker at %s points at this database' % GAME)

    vs = db('vp_venues?slug=eq.%s&select=id,name,founding_id,max_players,status,timezone' % urllib.parse.quote(a.venue))
    if not vs: sys.exit('STOP: no venue with slug ' + a.venue)
    venue = vs[0]
    acct = db('venueplay_founding?id=eq.%s&select=id,venue_name,plan,stripe_customer_id,stripe_subscription_id,bill_by_invoice' % venue['founding_id'])[0]
    cus = acct['stripe_customer_id']
    cap = int(venue['max_players'] or 0)
    n = cap + a.extra
    live_now = db('vp_sessions?venue_id=eq.%s&status=in.(lobby,running,paused)&select=id' % venue['id'])
    print('  venue     %s (%s) cap %d, status %s' % (venue['name'], venue['id'], cap, venue['status']))
    print('  account   %s plan %s customer %s' % (acct['venue_name'], acct['plan'], cus))
    print('  plan      open a night, %d phones join (%d over the cap of %d), host approves, one bingo90 round, close' % (n, a.extra, cap))
    if live_now: sys.exit('STOP: this venue has a live session already (%s); a real night may be on. Not touching it.' % live_now[0]['id'])
    if not cap: sys.exit('STOP: this venue has no player cap, so nothing could ever be over it')
    if not a.go: print('\n  dry run. Add --go to do it.'); return

    before_s = stripe_state(cus); before_d = db_state(venue['id'])
    print('\nBEFORE  sub %s qty %s, balance %s, %d pending items, %d invoices, streak %s' % (
        before_s['sub_status'], before_s['sub_qty'], money(before_s['balance']), len(before_s['pending_items']),
        len(before_s['invoices']), before_d['venue']['overage_streak']))
    expect_charge = (before_s['sub_status'] == 'active')

    jwt, uid = sign_in()
    H = {'Authorization': 'Bearer ' + jwt}
    steps = []
    def step(what, st, d, want=None):
        okk = (st == want) if want is not None else st < 300
        steps.append(okk)
        print('  %s %-22s HTTP %s %s' % ('ok  ' if okk else 'FAIL', what, st, json.dumps(d)[:160]))
        return d

    with Grant(uid):
        s = step('open session', *http(GAME + '/session', 'POST', {'venue_id': venue['id'], 'format': 'bingo90'}, H))
        sid, code = s.get('session_id'), s.get('join_code')
        if not sid: sys.exit('STOP: could not open a session')
        if s.get('plan_cap') != cap: print('  FAIL plan_cap frozen at %s, venue cap is %d' % (s.get('plan_cap'), cap)); steps.append(False)
        db('vp_sessions?id=eq.%s' % sid, 'PATCH', {'title': 'LIVE OVERAGE TEST'}, 'return=minimal')
        tokens = []
        for i in range(1, n + 1):
            d = step('phone %d joins' % i, *http(GAME + '/join', 'POST',
                     {'code': code, 'name': 'Test phone %d' % i, 'pid': 'livetest-' + secrets.token_hex(8)},
                     {'User-Agent': 'venueplay-live-overage-test/1.0 phone %d' % i}))
            if d.get('token') or d.get('player_token'): tokens.append(d.get('token') or d.get('player_token'))
        d = step('start (expect 402)', *http(GAME + '/host/game', 'POST', {'session_id': sid, 'format': 'bingo90', 'pattern': 'one_line'}, H), want=402)
        if d.get('extra') != a.extra: print('  FAIL the consent screen says %s extra, we brought %d' % (d.get('extra'), a.extra)); steps.append(False)
        print('         consent screen: %s players, cap %s, extra %s, free_month %s' % (d.get('players'), d.get('plan_cap'), d.get('extra'), d.get('free_month')))
        step('host taps OK', *http(GAME + '/host/overage/ack', 'POST', {'session_id': sid}, H))
        g = step('start bingo90', *http(GAME + '/host/game', 'POST', {'session_id': sid, 'format': 'bingo90', 'pattern': 'one_line'}, H))
        gid = g.get('game_id')
        cards = db('vp_cards?game_id=eq.%s&select=player_id' % gid) if gid else []
        played = len({c['player_id'] for c in cards})
        print('         %d players hold a card (played)' % played)
        if played != n: print('  FAIL %d joined, %d have cards' % (n, played)); steps.append(False)
        if gid: step('end the round', *http(GAME + '/host/game/end', 'POST', {'game_id': gid}, H))
        closed_at = time.time()
        step('close the night', *http(GAME + '/session/close', 'POST', {'session_id': sid}, H))

    print('\n  waiting 8s for Stripe and the webhook...'); time.sleep(8)
    after_s = stripe_state(cus); after_d = db_state(venue['id'])
    sess = db('vp_sessions?id=eq.%s&select=status,ended_at,overage_approved,overage_approved_count,plan_cap_at_start' % sid)[0]
    print('\nAFTER   session %s, approved %s (count %s), cap at start %s' % (sess['status'], sess['overage_approved'], sess['overage_approved_count'], sess['plan_cap_at_start']))
    new_items = {k: v for k, v in after_s['pending_items'].items() if k not in before_s['pending_items']}
    new_invs = {k: v for k, v in after_s['invoices'].items() if k not in before_s['invoices']}
    new_audit = [x for x in after_d['audit'] if x['id'] not in before_d['audit_ids']]
    for i in new_items.values(): print('  new pending item  %s qty=%s unit=%s "%s"' % (i['id'], i.get('quantity'), money(i.get('unit_amount')), i.get('description')))
    for inv in new_invs.values():
        print('  new invoice       %s %s total=%s paid=%s method=%s' % (inv.get('number') or inv['id'], inv['status'], money(inv.get('total')), inv.get('paid'), inv.get('collection_method')))
        for ln in inv['lines']['data']: print('      line  qty=%s amount=%s "%s"' % (ln.get('quantity'), money(ln.get('amount')), ln.get('description')))
    for x in new_audit: print('  new audit row     %s %s' % (x['action'], json.dumps(x.get('detail'))[:200]))
    print('  streak            %s -> %s (peaks %s, day %s)' % (before_d['venue']['overage_streak'], after_d['venue']['overage_streak'], after_d['venue']['overage_streak_peaks'], after_d['venue']['overage_streak_day']))
    print('  balance           %s -> %s' % (money(before_s['balance']), money(after_s['balance'])))
    if after_s['sub_qty'] != before_s['sub_qty']: print('  FAIL subscription quantity moved %s -> %s (overage must not change the plan)' % (before_s['sub_qty'], after_s['sub_qty'])); steps.append(False)

    want_desc = '%s - Extra Player - %s' % (venue['name'], brisbane_date_today())
    verdict = []
    if expect_charge:
        lines = [ln for inv in new_invs.values() for ln in inv['lines']['data']]
        mine = [ln for ln in lines if ln.get('description') == want_desc]
        verdict.append(('exactly one new invoice', len(new_invs) == 1))
        verdict.append(('its line reads "%s"' % want_desc, len(mine) == 1))
        verdict.append(('quantity %d x $2.00 = %s' % (a.extra, money(a.extra * 200)), bool(mine) and mine[0].get('quantity') == a.extra and mine[0].get('amount') == a.extra * 200))
        verdict.append(('nothing else rode that invoice', len(lines) == len(mine)))
        inv = list(new_invs.values())[0] if new_invs else {}
        want_paid = not acct.get('bill_by_invoice')
        verdict.append(('invoice %s' % ('paid now (card)' if want_paid else 'issued (bill by invoice)'), bool(inv) and (inv.get('paid') is True if want_paid else inv.get('status') == 'open')))
        verdict.append(('no item left pending', not new_items))
        # The streak counts NIGHTS (2am Brisbane rollover), not sessions, so three games in one
        # evening cannot move a plan up. A second run on the same night must leave it alone.
        import datetime as _dt
        tonight = (_dt.datetime.utcnow() + _dt.timedelta(hours=8)).strftime('%Y-%m-%d')
        if before_d['venue']['overage_streak_day'] == tonight and (before_d['venue']['overage_streak'] or 0) > 0:
            verdict.append(('streak unchanged at %d (already counted tonight, %s)' % (before_d['venue']['overage_streak'], tonight),
                            after_d['venue']['overage_streak'] == before_d['venue']['overage_streak']))
        else:
            verdict.append(('streak advanced to %d' % ((before_d['venue']['overage_streak'] or 0) + 1), after_d['venue']['overage_streak'] == (before_d['venue']['overage_streak'] or 0) + 1))
        verdict.append(('no failure audit row', not any(x['action'] in ('overage_charge_failed', 'overage_left_pending_until_renewal') for x in new_audit)))
        ev = db('vp_stripe_events?select=event_id,event_type,claimed_at,completed_at&order=claimed_at.desc&limit=8')
        import calendar
        recent = [e for e in ev if e.get('event_type') == 'invoice.paid'
                  and calendar.timegm(time.strptime(e['claimed_at'][:19], '%Y-%m-%dT%H:%M:%S')) > closed_at - 60]
        for e in recent: print('  webhook           %s %s finished=%s' % (e['event_type'], e['event_id'], bool(e.get('completed_at'))))
        verdict.append(('invoice.paid webhook arrived and finished (receipt email path)', bool(recent) and all(e.get('completed_at') for e in recent)))
    else:
        verdict.append(('subscription is %s: no new invoice item' % before_s['sub_status'], not new_items))
        verdict.append(('no new invoice', not new_invs))
        verdict.append(('streak untouched', after_d['venue']['overage_streak'] == before_d['venue']['overage_streak']))
        verdict.append(('balance untouched', after_s['balance'] == before_s['balance']))
    verdict.append(('every step answered as expected', all(steps)))
    verdict.append(('session closed', sess['status'] == 'finished'))

    print('\nVERDICT for %s, %d over a cap of %d, subscription %s:' % (venue['name'], a.extra, cap, before_s['sub_status']))
    bad = 0
    for what, okk in verdict:
        print('  %s %s' % ('PASS' if okk else 'FAIL', what)); bad += (not okk)
    print('\n%s' % ('ALL GOOD' if not bad else '%d FAILED' % bad))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
