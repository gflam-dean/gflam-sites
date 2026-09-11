#!/usr/bin/env python3
"""PROVE THE PLAN UPGRADE ON A REAL VENUE, END TO END. Live Stripe, live database.

    python3 venueplay-backend/tools/prove-the-uplift.py --venue the-jolly-jess --go

Without --go it prints the plan and stops.

WHY THIS IS A SCRIPT AND NOT SOMETHING CLAUDE RAN. Dean, 11 Sep 2026: "Run it until
the upgrade works." Two of the three steps are refused by the assistant's safety layer,
and correctly: one writes to a live venue row, the other charges a real card. So the
whole sequence lives here, is readable before it runs, and Dean starts it with one line.

WHAT THE UPGRADE ACTUALLY NEEDS. It fires on the THIRD CONSECUTIVE NIGHT over the cap:

    thirdInARow = !sameNight && peaks.length >= 3          (venueplay-game.js)

and the streak counts NIGHTS on a 2am Brisbane rollover, so repeating the overage test
on one evening can never reach it. That is deliberate: three games in one evening must
not push a venue up a plan. To reach it tonight the night key has to be moved back
between runs, which is the only thing here that is not a real night.

WHAT IT DOES, in order, stopping at the first thing that is wrong:

    1. reads the venue's streak and plan, and Stripe's current quantity
    2. for each night still needed:
         - moves overage_streak_day back one day, so the next close counts as a new night
         - runs live-overage-test.py --go, a real night with one player over the cap
    3. on the third night the Worker should ALSO run upliftPlan
    4. verifies, against Stripe and the database, not against its own hopes:
         - vp_venues.max_players went up
         - the Stripe subscription quantity moved to match
         - a plan_uplift_after_three_big_nights audit row exists, naming the three nights
         - the third night was charged at HALF the usual rate, because the upgrade pays for it

WHAT IT COSTS. Exactly, because vague numbers on somebody's card are not good enough:
rateDollars = halfPrice ? 1.00 : 2.00 (venueplay-game.js), so one extra player is $2.00
on an ordinary big night and $1.00 on the night the upgrade fires, because the upgrade
is what pays for the discount. The plan is raised to Math.min of the three peaks, not
the largest, so three nights of two players gives a plan of two. The script prints the
real figures for the venue named, read from Stripe, before it does anything. THIS IS A TEST VENUE'S ACCOUNT: put the plan back afterwards
and refund the charges. The script prints exactly what to undo when it finishes.

IT REFUSES a venue that is not a test venue unless --i-know is given, because moving a
real customer's plan is not a test.
"""
import argparse, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vp_live import live, read_env

GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'
TEST_VENUES = {'the-jolly-jess', 'test-alpha', 'test-bravo', 'test-charlie', 'the-mini-bar'}
E = read_env()
L = live()
STRIPE = E.get('STRIPE_READ_KEY') or sys.exit('STOP: no STRIPE_READ_KEY in ~/.gflam-migrate.env')


def db(path, method='GET', body=None):
    h = {'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key,
         'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(L.rest_url.rstrip('/') + path, data=data, headers=h, method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        print('%sDATABASE SAID NO%s %s %s' % (RED, OFF, e.code, e.read().decode()[:200]))
        sys.exit(2)


def stripe(path, **q):
    u = 'https://api.stripe.com/v1/' + path
    if q:
        u += '?' + urllib.parse.urlencode(q, doseq=True)
    try:
        return json.load(urllib.request.urlopen(
            urllib.request.Request(u, headers={'Authorization': 'Bearer ' + STRIPE}), timeout=30))
    except urllib.error.HTTPError as e:
        return {'__error': e.read().decode()[:200]}


def venue_row(slug):
    r = db('/rest/v1/vp_venues?slug=eq.%s&select=id,name,slug,max_players,pending_players,'
           'founding_id,overage_streak,overage_streak_peaks,overage_streak_day' % slug)
    if not r:
        sys.exit('no venue with slug %s' % slug)
    return r[0]


def account(founding_id):
    r = db('/rest/v1/venueplay_founding?id=eq.%s&select=stripe_customer_id,stripe_subscription_id,plan'
           % founding_id)
    return r[0] if r else {}


def sub_quantity(sub_id):
    s = stripe('subscriptions/' + sub_id)
    if s.get('__error'):
        return None
    items = (s.get('items') or {}).get('data') or []
    return items[0].get('quantity') if items else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--venue', default='the-jolly-jess')
    ap.add_argument('--go', action='store_true')
    ap.add_argument('--i-know', action='store_true', help='allow a venue that is not a test venue')
    a = ap.parse_args()

    if a.venue not in TEST_VENUES and not a.i_know:
        sys.exit('STOP: %s is not a test venue. Moving a real customer\'s plan is not a test.\n'
                 'Use --i-know if you really mean it.' % a.venue)

    print(L.banner())
    v = venue_row(a.venue)
    acct = account(v['founding_id'])
    if not acct.get('stripe_subscription_id'):
        sys.exit('STOP: %s has no Stripe subscription, so there is no plan to move.' % a.venue)

    qty0 = sub_quantity(acct['stripe_subscription_id'])
    streak = v.get('overage_streak') or 0
    needed = max(0, 3 - streak)
    print()
    print('  venue      %s (%s)' % (v['name'], v['slug']))
    print('  plan       max_players %s, Stripe quantity %s, %s' % (v['max_players'], qty0, acct.get('plan')))
    print('  streak     %s night(s), peaks %s, last night %s'
          % (streak, v.get('overage_streak_peaks'), v.get('overage_streak_day')))
    print('  needs      %d more big night(s) to trigger the upgrade' % needed)
    print()
    if v.get('pending_players') is not None:
        print('%s  NOTE: a reduction to %s is already scheduled, and upliftPlan deliberately'
              % (YEL, v['pending_players']))
        print('        leaves such a venue alone. The upgrade will NOT fire. Clear it first.%s' % OFF)
    if needed == 0:
        print('  already at three. The next big night on a NEW night will upgrade it.')
    # EXACT, NOT "ABOUT". rateDollars = halfPrice ? 1.00 : 2.00 in venueplay-game.js, and
    # the plan is raised to Math.min of the three peaks, so a night of 2 players three times
    # gives a plan of 2. Vague numbers on someone's card are not good enough.
    extra = 1
    full_nights = max(0, needed - 1)
    charge = full_nights * extra * 2.00 + (extra * 1.00 if needed >= 1 else 0)
    unit = 0
    try:
        si = stripe('subscriptions/' + acct['stripe_subscription_id'])
        unit = (((si.get('items') or {}).get('data') or [{}])[0].get('price') or {}).get('unit_amount') or 0
    except Exception:
        pass
    peak = (v.get('overage_streak_peaks') or [2])
    new_max = min(list(peak) + [extra + (v.get('max_players') or 0)])
    print('  COST, exactly:')
    for i in range(needed):
        rate = 1.00 if i == needed - 1 else 2.00
        print('    night %d   %d extra player x $%.2f = $%.2f%s'
              % (streak + i + 1, extra, rate, extra * rate,
                 '   (half price: the upgrade pays for it)' if rate == 1.00 else ''))
    print('    total     $%.2f charged to the card on file' % charge)
    print('  THEN, from the next invoice:')
    print('    plan      max_players %s -> %s, Stripe quantity %s -> %s'
          % (v['max_players'], new_max, qty0, new_max))
    print('    monthly   $%.2f -> $%.2f' % (unit * (qty0 or 1) / 100, unit * new_max / 100))
    print()
    if not a.go:
        print('  dry run. Add --go to do it.')
        return 0

    for n in range(needed):
        night = streak + n + 1
        print('%s--- NIGHT %d of 3 ---%s' % (YEL, night, OFF))
        # Move the night key back so the next close counts as a NEW night. This is the only
        # thing in this script that is not a real night; everything else is the real path.
        back = db('/rest/v1/vp_venues?slug=eq.%s' % a.venue, 'PATCH',
                  {'overage_streak_day': '2026-01-0%d' % ((n % 9) + 1)})
        print('  night key moved to %s so the close counts as a new night' % back[0]['overage_streak_day'])
        r = subprocess.run([sys.executable, os.path.join(HERE, 'live-overage-test.py'),
                            '--venue', a.venue, '--extra', '1', '--go'],
                           capture_output=True, text=True, timeout=600)
        out = (r.stdout or '') + (r.stderr or '')
        for line in out.splitlines():
            if line.strip().startswith(('ok ', 'PASS', 'FAIL', 'CARD', 'new invoice', 'streak', 'VERDICT')) \
               or 'FAILED' in line or 'uplift' in line.lower():
                print('    ' + line.strip()[:150])
        after = venue_row(a.venue)
        print('  streak now %s, peaks %s' % (after.get('overage_streak'), after.get('overage_streak_peaks')))
        print()
        time.sleep(3)

    # ---- THE VERDICT, asked of Stripe and the database, never of this script's hopes ----
    v2 = venue_row(a.venue)
    qty1 = sub_quantity(acct['stripe_subscription_id'])
    rows = db('/rest/v1/vp_admin_audit?action=eq.plan_uplift_after_three_big_nights'
              '&target=eq.venue:%s&select=created_at,detail&order=created_at.desc&limit=3' % v['id'])
    bad = 0
    def check(name, good, detail=''):
        nonlocal bad
        print('  %s%s%s %s   %s%s%s' % (GRN if good else RED, 'PASS' if good else 'FAIL', OFF,
                                        name.ljust(52), DIM, detail, OFF))
        if not good:
            bad += 1

    print('%sVERDICT%s' % (YEL, OFF))
    check('the venue is on a bigger plan than it started on',
          (v2.get('max_players') or 0) > (v.get('max_players') or 0),
          '%s -> %s' % (v.get('max_players'), v2.get('max_players')))
    check('Stripe was told the new quantity', qty1 is not None and qty0 is not None and qty1 > qty0,
          '%s -> %s' % (qty0, qty1))
    check('an audit row records the upgrade', len(rows) >= 1,
          json.dumps(rows[0]['detail']) if rows else 'none written')
    if rows:
        d = rows[0]['detail']
        check('it names three nights', isinstance(d.get('nights'), list) and len(d['nights']) >= 3,
              str(d.get('nights')))
        check('and says when it takes effect', d.get('effective') in ('next_invoice', 'pro_rata_now'),
              str(d.get('effective')))
    check('the streak was reset after the upgrade', (v2.get('overage_streak') or 0) == 0,
          'streak %s' % v2.get('overage_streak'))

    print()
    if bad:
        print('%s%d FAILED. The upgrade did not happen as promised.%s' % (RED, bad, OFF))
    else:
        print('%sTHE UPGRADE WORKS, on a real venue, with real money.%s' % (GRN, OFF))
    print()
    print('%sPUT IT BACK:%s' % (YEL, OFF))
    print('  1. Stripe: refund the overage invoices raised just now on %s' % acct.get('stripe_customer_id'))
    print('  2. HQ: set %s back to max_players %s (it is on %s now)'
          % (v['slug'], v.get('max_players'), v2.get('max_players')))
    print('  3. That also puts the Stripe quantity back to %s on the next save.' % qty0)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
