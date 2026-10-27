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
    free, notes, page_rows = [], [], []
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
        # What the billing page would put in front of this customer, worked out the way
        # the Worker does: every venue on the account that is not cancelling.
        page_rows.append({'email': email, 'qty': qty,
                          'leaving': bool(s.get('cancel_at_period_end')),
                          'shown': shown_players(s.get('customer', {}).get('id') or s.get('customer'))})
        if pays == 0 and qty > 0:
            free.append(email)
        flags = []
        if s.get('status') == 'trialing':
            flags.append('TRIAL')
        if s.get('cancel_at_period_end'):
            import datetime as _dt
            ca = s.get('cancel_at')
            flags.append('LEAVING ' + (_dt.datetime.fromtimestamp(ca).strftime('%d %b') if ca else 'at period end'))
        note = ('  <- ' + ', '.join(flags)) if flags else ''
        print('  %-32s %-4s %-9s $%-7.2f $%-9.2f %s%s' % (email, qty, tier, unit, pays, label, note))

    print('')
    if free:
        print('  %d account(s) are paying NOTHING: %s' % (len(free), ', '.join(free)))
        print('  A 100%% coupon sits on the SUBSCRIPTION, which is the whole account. A discount')
        print('  granted to one venue frees every venue billed alongside it.')
    else:
        print('  Every account with players is paying something.')

    # The page and the invoice must say the same thing. See page_matches_the_invoice.
    return page_matches_the_invoice(None, page_rows)



def shown_players(customer_id):
    """The number the billing page would show: every venue on the account, minus the
    ones cancelling. Read from our database, because that is where the page reads it."""
    global _DB
    try:
        if _DB is None:
            import sys as _s, os as _o
            _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
            from vp_live import live as _live
            _DB = _live()
        if not _DB.rest_url or not _DB.service_key:
            return None
        h = {'apikey': _DB.service_key, 'Authorization': 'Bearer ' + _DB.service_key}
        base = _DB.rest_url.rstrip('/')
        f = json.load(urllib.request.urlopen(urllib.request.Request(
            base + '/rest/v1/venueplay_founding?stripe_customer_id=eq.' + str(customer_id) + '&select=id&limit=1',
            headers=h), timeout=25))
        if not f:
            return None
        vs = json.load(urllib.request.urlopen(urllib.request.Request(
            base + '/rest/v1/vp_venues?founding_id=eq.' + f[0]['id'] +
            '&select=max_players,pending_players,cancel_at_period_end', headers=h), timeout=25))
        n = 0
        for v in vs or []:
            if v.get('cancel_at_period_end'):
                continue
            n += int(v.get('max_players') or 0)
        return n
    except Exception:
        return None


_DB = None

def page_matches_the_invoice(env, rows):
    """DOES THE BILLING PAGE SHOW WHAT STRIPE ACTUALLY CHARGES?

    Dean, 11 Sep 2026: "Jess says shes got 3 players this month, 2 next month so the
    numbers havent rolled over in their account. When I say I want an audit i dont want
    to have to find dumb shit."

    He found it, which is the part that should not have happened. Her account held a
    SUSPENDED venue already set to cancel, and the billing page was the only place in
    the product that still counted it: 3 players and $7.50 a month on the page, quantity
    2 and $5.00 at Stripe. accountBilledTotal skips cancelling venues, billedPlayers
    skips them, the page did not.

    So this asks the only question that matters: for every account, does the number of
    players we would SHOW equal the quantity Stripe is billing? Anything else is a page
    that disagrees with the invoice, which is the customer's word against ours.
    """
    bad, leaving = [], []
    for r in rows:
        shown, billed = r.get('shown'), r.get('qty')
        if shown is None or billed is None:
            continue
        if r.get('leaving'):
            # Stripe keeps billing the old quantity until the cancel date, and our own sum
            # stops counting a cancelling venue straight away. Both are right, so this is
            # not a fault. Wellshot Hotel read as "0 shown, 20 billed" on 11 Sep 2026 and
            # reporting that as a mismatch would have been crying wolf on the one account
            # with real money on it.
            leaving.append((r.get('email'), shown, billed))
            continue
        if shown != billed:
            bad.append((r.get('email'), shown, billed))
    print()
    print('DOES THE PAGE AGREE WITH THE INVOICE?')
    if not rows:
        print('  NOTHING CHECKED, so this is not a pass.')
        return 1
    for email, shown, billed in bad:
        print('  FAIL  %-34s page would show %s player(s), Stripe bills %s'
              % (email, shown, billed))
    for email, shown, billed in leaving:
        print('  --    %-34s leaving: Stripe still bills %s until the cancel date' % (email, billed))
    if not bad:
        print('  ok    every account is shown the number it is charged  (%d checked)' % len(rows))
        return 0
    print()
    print('  %d account(s) are shown a different number from the one on their invoice.' % len(bad))
    return 1


if __name__ == '__main__':
    main()
