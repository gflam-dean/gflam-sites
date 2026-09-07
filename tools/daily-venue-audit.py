#!/usr/bin/env python3
"""Walk a venue's whole night the way a venue would, against the LIVE system, daily.

WHY THIS EXISTS. On 8 Sep 2026 an owner pressed "Change code", the console showed
them their new code, and the door still answered to the old one. The release gate
was green and every unit test passed, because every test and the backfill agreed
that a venue's code equals the hash of its slug - which was true until somebody
changed one. Nothing that reads code can catch that. Only something that asks the
running system "the code you are SHOWING this venue: does it actually let anyone
in?" can, and that is one question, asked live, read-only, in under a second.

WHAT IT WILL NOT DO. It never writes. It opens no sessions, joins no games, bills
nothing. Every request below is a GET that a TV on a wall makes anyway, so running
it every morning costs a venue nothing and cannot take a night down.

  python3 daily-venue-audit.py                       the venues in VENUES below
  python3 daily-venue-audit.py --slug the-average-joe --slug some-other-pub
  python3 daily-venue-audit.py --prove               break each check, expect red
"""
import argparse, json, sys, time, urllib.request, urllib.error

GAME = 'https://venueplay-game.dean-tindale.workers.dev'
SITE = 'https://venueplay.com.au'
VENUES = ['the-average-joe']

BAD = []
def fail(what, detail):
    BAD.append((what, detail)); print('  FAIL  %-52s %s' % (what, detail))
def ok(what, note=''):
    print('  ok    %-52s %s' % (what, note))

def get(url, timeout=15):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'venueplay-daily-audit'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), (time.time() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), (time.time() - t0) * 1000
    except Exception as e:
        return 0, str(e), (time.time() - t0) * 1000

def jget(url):
    s, body, ms = get(url)
    try: return s, json.loads(body), ms
    except Exception: return s, None, ms


def audit_platform():
    print('\nTHE PLATFORM ITSELF')
    s, h, ms = jget(GAME + '/health')
    if s != 200 or not h:
        return fail('the game Worker answers at all', 'HTTP %s - every venue is down' % s)
    ok('the game Worker is up', '%s, %.0fms' % (h.get('build', '?'), ms))
    if not h.get('ok'): fail('the Worker reports itself healthy', 'ok=false, missing=%s' % h.get('missing'))
    else: ok('it has every binding it needs')

    n = h.get('venue_code_clashes')
    if n is None:
        fail('clashing venue codes are being counted', 'health does not report it any more')
    elif n:
        fail('no two venues share a code', '%d clash(es) - BOTH venues are refused, '
             'and any table talker printed with that code is dead' % n)
    else:
        ok('no two venues share a code')

    b = h.get('broadcast_signing') or {}
    if b.get('venues') and b.get('with_a_key') is not None:
        ok('broadcast signing keys', '%s of %s venues hold one, %s enforcing'
           % (b['with_a_key'], b['venues'], b.get('enforcing')))
    return h


def audit_venue(slug):
    print('\n%s' % slug.upper())

    # 1. The screen a TV on the wall asks for.
    s, scr, ms = jget(GAME + '/screen?venue=' + slug)
    if s != 200 or not scr:
        return fail('the TV can load this venue', 'HTTP %s' % s)
    if not scr.get('exists'):
        return fail('the TV finds this venue', 'exists=false - the screen shows "not linked to an account"')
    ok('the TV loads the venue', '%s, %.0fms' % (scr.get('name') or '?', ms))

    # 2. The code the venue is SHOWN.
    code = (scr.get('join_code') or '').strip()
    if not code:
        return fail('the venue has a code to show', 'join_code is empty - nobody can join by code')
    if not all(c in 'ACDEFGHJKMNPQRSTUVWXYZ2345679' for c in code) or len(code) != 6:
        return fail('the code can actually be typed', '"%s" contains a character that is not in the '
                    'alphabet, or is the wrong length' % code)
    ok('the venue is shown a code', code)

    # 3. THE ONE THAT MATTERS. Does that code open that venue's door?
    s, v, ms = jget(GAME + '/venue?code=' + code)
    if s != 200 or not v or not v.get('exists'):
        return fail('the code the venue is SHOWN lets people in',
                    '%s is displayed on their console and refused at the door (HTTP %s). '
                    'This is exactly the 8 Sep fault.' % (code, s))
    if (v.get('slug') or '') != slug:
        return fail('the code opens the RIGHT venue',
                    '%s is shown to %s but opens %s - players and opt-ins land at the wrong pub'
                    % (code, slug, v.get('slug')))
    ok('that code opens this venue and no other', '%.0fms' % ms)

    # 4. Same code, second ask. The 8 Sep fault looked intermittent because each
    #    Cloudflare isolate cached separately: one go failed, the next worked.
    misses = 0
    for _ in range(6):
        s2, v2, _ = jget(GAME + '/venue?code=' + code)
        if s2 != 200 or not v2 or not v2.get('exists') or v2.get('slug') != slug:
            misses += 1
    if misses:
        fail('the code works EVERY time, not most times',
             '%d of 6 tries failed - a venue would call this "it worked the second time"' % misses)
    else:
        ok('it works on every try, not just the first', '6 of 6')

    # 5. The pages a venue actually opens.
    for path, needle, what in (('/tv?slug=' + slug, 'CODE_ALPHABET', 'the TV page'),
                               ('/app/', 'venueplay', 'the console')):
        s, body, ms = get(SITE + path)
        if s != 200: fail('%s loads' % what, 'HTTP %s' % s)
        elif needle not in body:
            fail('%s is the real page' % what,
                 'served 200 but without %s - a missing page answers with the homepage' % needle)
        else: ok('%s loads' % what, '%.0fms' % ms)


def prove():
    """A check that cannot go red is decoration. Break each one and require a FAIL."""
    print('PROVING THE CHECKS (each is deliberately broken; each must go red)\n')
    global GAME, SITE
    cases = [
        ('the Worker is unreachable',      lambda: ('http://127.0.0.1:9', SITE)),
        ('the site is unreachable',        lambda: (GAME, 'http://127.0.0.1:9')),
    ]
    good_game, good_site = GAME, SITE
    passed = 0
    for name, mut in cases:
        GAME, SITE = mut()
        del BAD[:]
        try:
            audit_platform(); audit_venue(VENUES[0])
        except Exception:
            pass
        red = len(BAD) > 0
        print('  %-36s %s' % (name, 'went red, good' if red else 'STAYED GREEN - BLIND CHECK'))
        passed += 1 if red else 0
        GAME, SITE = good_game, good_site
    return 0 if passed == len(cases) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slug', action='append')
    ap.add_argument('--prove', action='store_true')
    a = ap.parse_args()
    if a.prove: return prove()
    print('VenuePlay daily venue audit - read-only, %s' % time.strftime('%Y-%m-%d %H:%M'))
    audit_platform()
    for slug in (a.slug or VENUES):
        audit_venue(slug)
    print()
    if BAD:
        print('%d PROBLEM(S) A VENUE WOULD HIT:' % len(BAD))
        for w, d in BAD: print('  - %s: %s' % (w, d))
        return 1
    print('No problem a venue would hit.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
