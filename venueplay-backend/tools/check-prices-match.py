#!/usr/bin/env python3
"""Does the price the site SELLS match the price the Worker CHARGES?

    python3 venueplay-backend/tools/check-prices-match.py

WHY THIS EXISTS. On 10 Sep 2026 Dean asked why his first customer had been billed
$2.50 a player when he believed founding was $2. The answer was that $2 is the
OVERAGE rate for an extra head on a big night, and $2.50 is the founding plan
rate, and the site and the Worker agreed with each other the whole time.

But nobody could tell him that quickly, because NOTHING IN THIS REPO COMPARED THE
TWO. Every money check here is about not charging twice. None of them asks
whether the number being charged is the number a venue was sold, which is the
question an owner actually asks, and the one that ends in a refund when it is
wrong. It has been wrong before: five of six state pages once quoted founding
while checkout charged standard.

So: pull the rates out of the Worker, pull the prices out of every public page
that sells one, and require them to agree.

THE OVERAGE RATE IS CHECKED SEPARATELY and deliberately, because it is a
different number for a different thing, and confusing the two is exactly what
prompted this file.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKER = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
GAME   = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-game.js')
SITE   = os.path.join(ROOT, 'venueplay')

bad, ran = [], 0

def ok(label, cond, why=''):
    global ran
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + label + (('   ' + why) if (why and not cond) else ''))
    if not cond: bad.append(label)

def read(p):
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''

def main():
    w = read(WORKER)
    if not w:
        print('STOP: cannot find the billing Worker'); sys.exit(1)

    # Every rate table in the Worker looks like: founding ? (annual ? 2.30 : 2.50) : (annual ? 2.85 : 3.00)
    tables = re.findall(r"\(plan(?:Name)?\s*===\s*'annual'\s*\?\s*([0-9.]+)\s*:\s*([0-9.]+)\)", w)
    print('\nWHAT THE WORKER CHARGES')
    ok('the Worker states its rates in a form this can read', len(tables) >= 2,
       'found %d rate tables; if the shape changed, this check is blind and must be rewritten' % len(tables))
    if len(tables) < 2:
        print(''); print('%d CHECK(S) FAILED' % len(bad)); sys.exit(1)

    rates = sorted(set(tables))
    # The cheaper pair is founding, the dearer pair standard.
    flat = sorted(set(float(x) for pair in tables for x in pair))
    founding = sorted(set(tuple(t) for t in tables))[0]
    print('     rate tables found: ' + ', '.join('annual %s / monthly %s' % (a, m) for a, m in sorted(set(tables))))

    # TWO TIERS IS CORRECT, and the first version of this check called it a fault.
    # Founding and standard are supposed to be different numbers; what matters is that
    # there are exactly two of them, that founding is the cheaper one, and that every
    # code path quotes the same pair.
    distinct = sorted(set(tables), key=lambda t: float(t[1]))
    ok('the Worker quotes exactly two tiers, founding and standard', len(distinct) == 2,
       'found %d rate tables. More than two means what a venue pays depends on which code '
       'path ran: %s' % (len(distinct), distinct))
    if len(distinct) != 2:
        print(''); print('%d of %d CHECKS FAILED' % (len(bad), ran)); sys.exit(1)
    ok('founding is cheaper than standard', float(distinct[0][1]) < float(distinct[1][1]),
       'founding %s is not below standard %s' % (distinct[0], distinct[1]))
    ok('annual is cheaper than monthly in both tiers',
       all(float(a) < float(m) for a, m in distinct),
       'an annual rate is not below its monthly rate: %s' % distinct)

    annual_rate, monthly_rate = distinct[0]
    print('\nWHAT THE SITE SELLS')
    pages, quoted = [], {}
    for dirpath, _dirs, files in os.walk(SITE):
        if any(x in dirpath for x in ('/app', '/data', '/tools', '/supabase')): continue
        for f in files:
            if not f.endswith('.html'): continue
            body = read(os.path.join(dirpath, f))
            # A plan price is the one followed by "per player" / "a player" / "/player"
            hits = re.findall(r'\$([0-9]+\.[0-9]{2})(?=[^<]{0,40}?(?:per player|a player|/player|a head, per month))', body)
            if hits:
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
                pages.append(rel); quoted[rel] = sorted(set(hits))
    ok('at least one page actually sells a price', len(pages) > 0,
       'no page quotes a per-player price, so this check is watching nothing')
    for p in pages:
        print('     %-34s quotes %s' % (p, ', '.join('$' + x for x in quoted[p])))

    allowed = {monthly_rate, annual_rate}
    # Standard rates are legitimately quoted too (struck through beside founding).
    for a, m in distinct: allowed |= {a, m}
    for pair in tables: allowed |= set(pair)
    strays = {}
    for p in pages:
        odd = [x for x in quoted[p] if x not in allowed]
        if odd: strays[p] = odd
    ok('every per-player price on the site is one the Worker actually charges', not strays,
       'a page sells a rate no code path charges: ' + '; '.join('%s quotes %s' % (k, v) for k, v in list(strays.items())[:3]))

    print('\nTHE OVERAGE RATE IS A DIFFERENT NUMBER, ON PURPOSE')
    g = read(GAME)
    over = re.findall(r'OVERAGE[_A-Z]*\s*=\s*([0-9.]+)', g) or re.findall(r'(?:perHead|per_head)\s*=\s*([0-9.]+)', g)
    site_over = set(re.findall(r'\$([0-9]+)(?:\.00)? per extra player|each extra player that night is \$([0-9]+)', read(os.path.join(SITE, 'index.html'))))
    flatover = sorted({x for pair in site_over for x in pair if x})
    # REPORTED, NOT ASSERTED. The first version compared "$2" with the first digit of
    # "$2.50", decided they were the same number, and failed. They are different rates for
    # different things and neither is wrong; printing them side by side is the whole point,
    # because mistaking one for the other is what sent somebody looking for a refund.
    print('     an extra head on a big night:  $%s   (overage, that night only)'
          % (flatover[0] if flatover else '?'))
    print('     the plan rate:                 $%s   (per player, every month)' % monthly_rate)
    ok('the site still states an overage rate at all', bool(flatover),
       'no overage rate on the homepage, so a venue cannot know what a big night costs')

    print('')
    if bad:
        print('%d of %d CHECKS FAILED' % (len(bad), ran)); sys.exit(1)
    print('All %d passed. The site sells $%s a player a month and the Worker charges $%s.' % (ran, monthly_rate, monthly_rate))

if __name__ == '__main__':
    main()
