#!/usr/bin/env python3
"""Print exactly what Stripe holds for one customer, so a billing test has a before and an after.

    python3 venueplay-backend/tools/stripe-snapshot.py cus_XXXX [cus_YYYY ...]

Read-only key (STRIPE_READ_KEY in ~/.gflam-migrate.env). Shows the subscription (status,
quantity, price, discount), the customer balance, every PENDING invoice item (the ones that
ride the next invoice), and the last five invoices with their lines. Nothing is written.
"""
import json, sys, urllib.request, urllib.error, urllib.parse
from pathlib import Path

def env():
    e = {}
    for line in (Path.home() / '.gflam-migrate.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    return e

KEY = env().get('STRIPE_READ_KEY') or sys.exit('STOP: STRIPE_READ_KEY is not in ~/.gflam-migrate.env')

def get(path, **q):
    url = 'https://api.stripe.com/v1/' + path + ('?' + urllib.parse.urlencode(q, doseq=True) if q else '')
    r = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + KEY})
    try: return json.loads(urllib.request.urlopen(r, timeout=30).read())
    except urllib.error.HTTPError as x: return {'error': x.read().decode()[:300]}

def money(c): return '$%.2f' % (c / 100)

def snapshot(cus):
    c = get('customers/' + cus)
    print('=' * 70); print(cus, (c.get('name') or ''), (c.get('email') or ''), ' balance', money(c.get('balance') or 0))
    for s in get('subscriptions', customer=cus, status='all', limit=10).get('data', []):
        it = s['items']['data'][0] if s['items']['data'] else {}
        pr = it.get('price') or {}
        disc = ''
        for d in (s.get('discounts') or []):
            did = d if isinstance(d, str) else d.get('id')
            dd = get('discounts/' + did) if did else {}
            cp = (dd.get('source') or {}).get('coupon') or dd.get('coupon') or {}
            if isinstance(cp, str): cp = get('coupons/' + cp)
            disc += ' discount=%s(%s%% off%s)' % (cp.get('name') or cp.get('id'), cp.get('percent_off'), (' until ' + str(dd.get('end'))) if dd.get('end') else '')
        print('  sub %s %s qty=%s price=%s %s/%s%s trial_end=%s period_end=%s' % (
            s['id'], s['status'], it.get('quantity'), pr.get('id'), money(pr.get('unit_amount') or 0),
            (pr.get('recurring') or {}).get('interval'), disc, s.get('trial_end'), s.get('current_period_end')))
    pend = get('invoiceitems', customer=cus, pending='true', limit=50).get('data', [])
    print('  pending invoice items: %d' % len(pend))
    for i in pend:
        print('    %s qty=%s unit=%s amount=%s  "%s"  sub=%s' % (i['id'], i.get('quantity'), money(i.get('unit_amount') or 0), money(i.get('amount') or 0), i.get('description'), i.get('subscription')))
    for inv in get('invoices', customer=cus, limit=5).get('data', []):
        print('  invoice %s %s total=%s paid=%s created=%s' % (inv.get('number') or inv['id'], inv['status'], money(inv.get('total') or 0), inv.get('paid'), inv.get('created')))
        for ln in inv.get('lines', {}).get('data', []):
            print('      %s x %s = %s  "%s"' % (ln.get('quantity'), money((ln.get('price') or {}).get('unit_amount') or (ln.get('unit_amount_excluding_tax') and 0) or 0) if ln.get('price') else '-', money(ln.get('amount') or 0), ln.get('description')))

if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    for cus in sys.argv[1:]: snapshot(cus)
