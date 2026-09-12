#!/usr/bin/env python3
"""Prove broadcast signing is real, by using it, not by reading the code.

    python3 venueplay-backend/tools/check-signing.py

WHAT IT PROVES, and why each one matters:

  1. EVERY ACTIVE VENUE HOLDS A KEY. A venue enforcing with no key would drop every
     message on its own wall.
  2. EVERY KEY IS A SHAPE A BROWSER WILL IMPORT. crypto.subtle.importKey refuses a
     P-256 JWK whose x, y or d is not 32 bytes, or which uses the padded alphabet.
     A key that fails here looks perfect in the database and cannot sign anything.
  3. A REAL HOST CAN FETCH ITS OWN PRIVATE KEY. This is the one that kills a night:
     a console that cannot get its key sends UNSIGNED, and an enforcing screen bins
     it. The room looks connected and nothing happens.
  4. THAT HOST CANNOT FETCH ANYBODY ELSE'S. If it could, signing would be theatre,
     because the whole point is that only this venue can speak for this venue.
  5. NO LOGIN GETS NOTHING.

Checks 3 to 5 need the test host account (venueplay-backend/tools/make-test-host.py)
and its password file. Without it they are reported as NOT RUN, never as passed: a
check that quietly skips is worse than no check. See docs/CHECK-STANDARD.md.

Every request sends a User-Agent. Cloudflare answers a request without one with error
1010, which arrives as a refusal and once made an attack test report a clean pass.
"""
import base64, json, os, sys, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vp_live import live

SUPA = 'https://ijkzgmdtwtgfkedqspxm.supabase.co'
GAME = 'https://venueplay-game.dean-tindale.workers.dev'
UA   = 'VenuePlay-check-signing/1.0'
ENV  = Path.home() / '.gflam-migrate.env'
PASS = Path.home() / '.gflam-migrate' / 'test-host.pass'
HOST_EMAIL = 'test-host@venueplay.invalid'
OWN, OTHERS = 'test-alpha', ['the-mini-bar', 'tugun-bowls']

fails, notrun = [], []

def env():
    e = {}
    for l in ENV.read_text().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); e[k.strip()] = v.strip()
    return e

def req(url, body=None, hdrs=None, method=None):
    h = {'User-Agent': UA}
    if body is not None: h['Content-Type'] = 'application/json'
    h.update(hdrs or {})
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                               headers=h, method=method or ('POST' if body is not None else 'GET'))
    try:
        x = urllib.request.urlopen(r, timeout=30); raw = x.read()
        return x.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as x:
        raw = x.read().decode()[:200]
        try: return x.code, json.loads(raw)
        except Exception: return x.code, raw
    except Exception as x:
        return 0, str(x)

def say(ok, line):
    print(('  ok   ' if ok else '  FAIL ') + line)
    if not ok: fails.append(line)

def skip(line):
    print('  --   NOT RUN: ' + line); notrun.append(line)

def main():
    # The rewrite step of the move repoints the hardcoded URL at Sydney but cannot know
    # that OLD_SERVICE_KEY is still SINGAPORE's key. That pairing is a 401 against every
    # check here: loud, but for a reason nobody would guess. Both come from one place now.
    # global, because LIVE is read by the module-level default above.
    L = live()
    global LIVE
    LIVE = L.rest_url or LIVE
    key = L.service_key
    if not key: print('STOP: no live service key configured'); sys.exit(1)
    print(L.banner())
    h = {'apikey': key, 'Authorization': 'Bearer ' + key}

    print('\nKEYS')
    st, venues = req(SUPA + '/rest/v1/vp_venues?status=eq.active&select=id,slug,broadcast_enforce&order=slug', hdrs=h)
    st, keys = req(SUPA + '/rest/v1/vp_venue_signing_keys?select=venue_id,public_jwk,private_jwk', hdrs=h)
    if not isinstance(venues, list) or not isinstance(keys, list):
        print('  FAIL could not read the venues or the keys'); sys.exit(1)
    byv = {k['venue_id']: k for k in keys}
    missing = [v['slug'] for v in venues if v['id'] not in byv]
    say(not missing, '%d of %d active venues hold a signing key%s'
        % (len(venues) - len(missing), len(venues), '' if not missing else '; MISSING: ' + ', '.join(missing)))

    bad = []
    for v in venues:
        k = byv.get(v['id'])
        if not k: continue
        pub, priv = k.get('public_jwk') or {}, k.get('private_jwk') or {}
        for name, jwk, fields in (('public', pub, ('x', 'y')), ('private', priv, ('x', 'y', 'd'))):
            if jwk.get('kty') != 'EC' or jwk.get('crv') != 'P-256':
                bad.append('%s %s is not an EC P-256 key' % (v['slug'], name)); continue
            for f in fields:
                s = jwk.get(f) or ''
                # 32 bytes, URL-safe alphabet, unpadded: the only thing importKey takes.
                if len(s) != 43 or any(c in s for c in '+/='):
                    bad.append('%s %s.%s is %d chars%s, a browser will refuse it'
                               % (v['slug'], name, f, len(s), ' and uses the padded alphabet' if any(c in s for c in '+/=') else ''))
                    continue
                try:
                    if len(base64.urlsafe_b64decode(s + '==')) != 32: bad.append('%s %s.%s is not 32 bytes' % (v['slug'], name, f))
                except Exception:
                    bad.append('%s %s.%s is not valid base64url' % (v['slug'], name, f))
    say(not bad, 'every key is a shape crypto.subtle.importKey accepts' if not bad else 'BAD KEYS: ' + '; '.join(bad[:4]))

    on = [v['slug'] for v in venues if v.get('broadcast_enforce')]
    print('  --   %d of %d venues are enforcing: %s' % (len(on), len(venues), ', '.join(on) if len(on) < 6 else '%d venues' % len(on)))
    naked = [v['slug'] for v in venues if v.get('broadcast_enforce') and v['id'] not in byv]
    say(not naked, 'no venue is enforcing without a key' if not naked else 'ENFORCING WITH NO KEY, its wall drops everything: ' + ', '.join(naked))

    print('\nTHE ROUTE A HOST ACTUALLY USES')
    # Find the site by walking UP from this file rather than counting directories. A copy
    # of this script run from anywhere else counted wrong, found no key, and reported NOT
    # RUN, which is honest but useless. If the site IS here and the key is not, that is a
    # FAILURE: a check that cannot find what it checks has not passed.
    import re
    anon, app = None, None
    for d in [Path(__file__).resolve()] + list(Path(__file__).resolve().parents):
        if (d / 'venueplay' / 'app').is_dir(): app = d / 'venueplay' / 'app'; break
    for f in (app.rglob('*.js') if app else []):
        m = re.search(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}', f.read_text(errors='ignore'))
        if m: anon = m.group(0); break
    if app and not anon:
        say(False, 'found the site at %s but no public anon key in it, so the host route was never exercised' % app)
    elif not PASS.exists() or not anon:
        skip('no test host password at %s, so nothing signed in' % PASS if not PASS.exists()
             else 'could not find the site next to this script, so the host route was never exercised')
    else:
        st, d = req(SUPA + '/auth/v1/token?grant_type=password',
                    {'email': HOST_EMAIL, 'password': PASS.read_text().strip()}, {'apikey': anon})
        if st != 200:
            skip('the test host could not sign in (http %s), so the route was never exercised' % st)
        else:
            tok = {'Authorization': 'Bearer ' + d['access_token']}
            st, d = req(GAME + '/host/signing/private', {'slug': OWN}, tok)
            say(st == 200 and isinstance(d, dict) and d.get('has_key') and d.get('private_jwk'),
                'a host fetches its OWN key, so its console can sign (http %s)' % st)
            for other in OTHERS:
                st, _ = req(GAME + '/host/signing/private', {'slug': other}, tok)
                say(st == 403, "that host is refused %s's key (http %s)" % (other, st))
            st, _ = req(GAME + '/host/signing/private', {'slug': OWN}, {})
            say(st in (401, 403), 'with no login at all the key route refuses (http %s)' % st)

    print('')
    if fails: print('%d CHECK%s FAILED' % (len(fails), '' if len(fails) == 1 else 'S')); sys.exit(1)
    if notrun: print('passed, but %d check(s) DID NOT RUN, so this is not a clean bill' % len(notrun)); sys.exit(2)
    print('signing is on and it is real: every venue keyed, every key importable, the route proved both ways')

if __name__ == '__main__':
    main()
