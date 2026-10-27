#!/usr/bin/env python3
"""DO THE THREE PLACES THAT HOLD A PLAYER COUNT AGREE WITH EACH OTHER?

    python3 venueplay-backend/tools/check-seats-agree.py

WRITTEN 12 SEP 2026, OVERNIGHT, AND NOT YET RUN. Read it before you trust it.

WHY. On 11 Sep the plan uplift moved The Jolly Jess from 1 player to 2. It wrote the
new number to vp_venues.max_players and to Stripe, and left venueplay_founding.max_seats
on 1. Three places hold a version of "how many players is this account for", and after
an uplift only two of them moved:

    vp_venues.max_players         2     raised by upliftPlan
    Stripe subscription quantity  2     raised by upliftPlan
    venueplay_founding.max_seats  1     never touched

I did not fix that overnight, on purpose. Fixing it means knowing every place max_seats
is read, and a column that might gate how many venues an account may open is not
something to guess at and ship unrun. The same night had already produced one email that
threw on every send because somebody wrote a variable name that did not exist.

So this measures it instead. If Jess is the only account out of step it is one row to
correct by hand. If half the fleet is out of step then max_seats is either dead or
actively wrong, and that is a different job with a different answer.

WHAT IT COMPARES, per account:
    seats    venueplay_founding.max_seats
    venues   the sum of vp_venues.max_players, skipping venues set to cancel
    stripe   the subscription item's quantity

It is READ ONLY. It reads the database with the service key and Stripe with the
read-only key, and writes nothing anywhere.

IT DOES NOT FAIL ON A DISAGREEMENT, because as of writing nobody knows which of the
three is meant to be authoritative. It prints the table and counts. Decide what the rule
is first, then turn the rule into a failure.
"""
import json, os, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vp_live import live

ENV = Path.home() / '.gflam-migrate.env'


def stripe_key():
    if not ENV.exists():
        print('no %s on this machine, so Stripe was never asked.' % ENV)
        sys.exit(2)
    m = re.search(r'STRIPE_READ_KEY\s*=\s*(\S+)', ENV.read_text())
    if not m:
        print('no STRIPE_READ_KEY in %s' % ENV)
        sys.exit(2)
    return m.group(1).strip().strip('"\'')


def main():
    L = live()
    print(L.banner())
    if not L.rest_url or not L.service_key:
        print('no REST url or service key for the live project')
        return 2
    key = stripe_key()
    h = {'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key}

    def db(path):
        return json.load(urllib.request.urlopen(
            urllib.request.Request(L.rest_url.rstrip('/') + path, headers=h), timeout=30))

    def stripe(path):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(
                'https://api.stripe.com/v1/' + path,
                headers={'Authorization': 'Bearer ' + key}), timeout=30))
        except urllib.error.HTTPError:
            return None

    accts = db('/rest/v1/venueplay_founding?select=id,contact_email,max_seats,'
               'stripe_subscription_id,status&order=contact_email')
    if not accts:
        print('ZERO ACCOUNTS came back. Either the query is wrong or the key is not a service key.')
        print('Nothing was checked, so this is a failure and not a clean result.')
        return 2

    print()
    print('DOES EVERY PLACE THAT HOLDS A PLAYER COUNT AGREE?')
    print('  %-34s %-7s %-7s %-7s %s' % ('account', 'seats', 'venues', 'stripe', ''))
    print('  ' + '-' * 78)

    same = diff = 0
    for a in accts:
        vs = db('/rest/v1/vp_venues?founding_id=eq.%s&select=max_players,cancel_at_period_end' % a['id'])
        venues = sum(int(v.get('max_players') or 0) for v in (vs or [])
                     if not v.get('cancel_at_period_end'))
        qty = None
        if a.get('stripe_subscription_id'):
            s = stripe('subscriptions/' + a['stripe_subscription_id'])
            if s and not s.get('error'):
                items = (s.get('items') or {}).get('data') or []
                if items:
                    qty = items[0].get('quantity')
        seats = a.get('max_seats')
        vals = [x for x in (seats, venues, qty) if x is not None]
        agree = len(set(vals)) <= 1
        if agree:
            same += 1
        else:
            diff += 1
        print('  %-34s %-7s %-7s %-7s %s'
              % ((a.get('contact_email') or a['id'])[:34], seats, venues,
                 '-' if qty is None else qty, '' if agree else '<- out of step'))

    print()
    print('  %d account(s) agree, %d out of step' % (same, diff))
    print()
    if diff:
        print('  WHAT TO DO WITH THAT. If it is one or two accounts, correct the rows and move on.')
        print('  If it is most of them, max_seats is not being maintained by anything and the')
        print('  question is whether it should exist at all. Either way the rule has to be decided')
        print('  BEFORE this becomes a check that fails, or it will just be noise somebody learns')
        print('  to ignore.')
    else:
        print('  All three agree everywhere. If that holds for a week, make this fail on a')
        print('  disagreement and put it in the gate.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
