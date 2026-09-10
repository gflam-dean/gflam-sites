#!/usr/bin/env python3
"""What is every venue ACTUALLY charged? Asked of Stripe, not of our database.

    python3 venueplay-backend/tools/check-billing-truth.py

WHY THIS EXISTS. Every other money check in this repo reasons about our own
database and our own code: are the calls keyed, is the guard present, does the
site quote the same number as the Worker. All of them passed on 10 Sep 2026 while
two venues were being billed nothing and a third was shown a price it does not
pay. None of them could see Stripe, so none of them could see the money.

Dean found all three by looking at screens. This exists so nobody has to.

READING A DISCOUNT IS THE HARD PART, and getting it wrong reports the OPPOSITE of
the truth. On this API version a subscription's discount is a list of ids, and
fetching it gives an object whose coupon lives under `source.coupon`, not
`coupon`. Reading `d.coupon` returns nothing, which looks exactly like "this
venue has no discount". That mistake was made twice in one night, in both
directions, before this was written.

SO IT CARRIES A CONTROL. One subscription is known to hold a known coupon. If the
reader cannot see that, it says so and refuses to print a table, rather than
reporting a fleet with no discounts.
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

ENV = Path.home() / '.gflam-migrate.env'
# A case we KNOW the answer to. If this stops being true, fix the control, do not delete it.
CONTROL_EMAIL = 'indykingevents@gmail.com'
CONTROL_COUPON = 'LXCsgwq5'
FOUNDING_UNITS = (2.50, 2.30)


def env():
    e = {}
    for l in ENV.read_text().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); e[k.strip()] = v.strip()
    return e


def api(tok, path):
    req = urllib.request.Request('https://api.stripe.com/v1/' + path,
                                 headers={'Authorization': 'Bearer ' + tok, 'User-Agent': 'vp-billing-truth/1.0'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=45).read())
    except urllib.error.HTTPError as x:
        return {'error': json.loads(x.read() or b'{}').get('error', {})}


def coupons_on(tok, sub):
    """Every coupon id on this subscription, wherever this API version keeps it."""
    out = []
    for d in (sub.get('discounts') or []):
        if isinstance(d, str):
            full = api(tok, 'subscriptions/%s?expand[]=discounts' % sub['id'])
            for dd in (full.get('discounts') or []):
                if isinstance(dd, dict):
                    d = dd; break
        if not isinstance(d, dict):
            continue
        cid = None
        src = d.get('source')
        if isinstance(src, dict):
            cid = src.get('coupon')
            if isinstance(cid, dict): cid = cid.get('id')
        if not cid:
            c = d.get('coupon')
            cid = c.get('id') if isinstance(c, dict) else c
        if cid: out.append(cid)
    return out


def main():
    e = env()
    tok = e.get('STRIPE_READ_KEY') or e.get('STRIPE_SECRET_KEY')
    if not tok:
        print('STOP: no STRIPE_READ_KEY in %s. Without it this cannot see the money.' % ENV); sys.exit(1)

    coupons = {c['id']: c for c in (api(tok, 'coupons?limit=100').get('data') or [])}
    subs = []
    for s0 in (api(tok, 'subscriptions?limit=100&status=all&expand[]=data.customer').get('data') or []):
        if s0.get('status') == 'canceled':
            continue
        s = api(tok, 'subscriptions/%s?expand[]=discounts' % s0['id'])
        if s.get('error'):
            print('could not read %s: %s' % (s0['id'], s['error'].get('message', '')[:80])); sys.exit(1)
        s['customer'] = s0.get('customer')
        subs.append(s)

    ctrl = [s for s in subs if ((s.get('customer') or {}).get('email') == CONTROL_EMAIL)]
    if not ctrl or CONTROL_COUPON not in coupons_on(tok, ctrl[0]):
        print('\n  CONTROL FAILED: %s should show coupon %s and does not.' % (CONTROL_EMAIL, CONTROL_COUPON))
        print('  This reader cannot see discounts on this API version, so every "no discount"')
        print('  below would be a lie. Refusing to print a table. Fix the reader, or the control')
        print('  if that venue genuinely changed.')
        sys.exit(1)

    print('\nWHAT EVERY VENUE IS ACTUALLY CHARGED, ACCORDING TO STRIPE')
    print('  (control passed: the reader can see discounts)\n')
    print('  %-32s %-4s %-9s %-8s %-10s %s' % ('customer', 'qty', 'plan', 'list', 'THEY PAY', 'discount applied'))
    print('  ' + '-' * 112)
    free, notes = [], []
    for s in sorted(subs, key=lambda x: (x.get('customer') or {}).get('email') or 'zz'):
        email = ((s.get('customer') or {}).get('email') or (s.get('customer') or {}).get('id') or '')[:32]
        item = (s.get('items', {}).get('data') or [{}])[0]
        qty = item.get('quantity') or 0
        unit = ((item.get('price') or {}).get('unit_amount') or 0) / 100
        tier = 'founding' if round(unit, 2) in FOUNDING_UNITS else 'standard'
        pct, label = 0, '(none)'
        for cid in coupons_on(tok, s):
            c = coupons.get(cid, {})
            pct = c.get('percent_off') or 0
            label = '%g%% off - %s' % (pct, (c.get('name') or cid))
        pays = qty * unit * (1 - pct / 100)
        if pays == 0 and qty > 0:
            free.append(email)
        print('  %-32s %-4s %-9s $%-7.2f $%-9.2f %s' % (email, qty, tier, unit, pays, label))

    print('')
    if free:
        print('  %d account(s) are paying NOTHING: %s' % (len(free), ', '.join(free)))
        print('  A 100%% coupon sits on the SUBSCRIPTION, which is the whole account. A discount')
        print('  granted to one venue frees every venue billed alongside it.')
    else:
        print('  Every account with players is paying something.')


if __name__ == '__main__':
    main()
