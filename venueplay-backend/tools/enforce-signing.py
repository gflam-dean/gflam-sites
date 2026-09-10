#!/usr/bin/env python3
"""Turn broadcast signature enforcement on, or off, per venue or for everybody.

    python3 venueplay-backend/tools/enforce-signing.py --list
    python3 venueplay-backend/tools/enforce-signing.py --on  the-jolly-jess
    python3 venueplay-backend/tools/enforce-signing.py --on  ALL
    python3 venueplay-backend/tools/enforce-signing.py --off ALL      <- the rollback

WHAT ENFORCEMENT DOES. A venue's realtime channel is named from its PUBLIC slug and the
anon key is printed in every page, so without this, anyone who worked that out could send
fake balls, a fake winner or a fake reveal to every screen and phone in the room. With it
on, a screen drops anything not signed by the venue's own key.

WHY IT IS SAFE TO TURN ON NOW, and it was not always:
  * every active venue now holds a key (mint-signing-keys.py, 10 Sep 2026)
  * the keys minted from a laptop are field-for-field identical to the ones browsers
    minted: crv, ext, key_ops, kty, x, y and d, P-256, ext true
  * the private key lives server side and a host fetches it with their own login, so a
    host on a new tablet still signs rather than being locked out
  * vp-sign.js rule 2: a screen that is enforcing but holds NO public key yet DELIVERS
    rather than blanking, so a failed key fetch cannot take a wall down
  * the race where a console's opening burst went out BEFORE its key loaded was found and
    fixed on 10 Sep. That was the one fault that would have made this look broken
  * The Mini Bar has enforced all day, on real games, which is evidence rather than theory

THE ROLLBACK IS ONE COMMAND and takes effect on the next message: --off ALL.
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

ENV  = Path.home() / '.gflam-migrate.env'
LIVE = 'https://gpoolavkghnxedzrmtmc.supabase.co'

def env():
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    if not e.get('OLD_SERVICE_KEY'): print('STOP: OLD_SERVICE_KEY missing'); sys.exit(1)
    return e

def rest(e, method, path, body=None):
    h = {'apikey': e['OLD_SERVICE_KEY'], 'Authorization': 'Bearer ' + e['OLD_SERVICE_KEY'],
         'Content-Type': 'application/json', 'User-Agent': 'VenuePlay-enforce/1.0'}
    req = urllib.request.Request(LIVE + '/rest/v1/' + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); raw = r.read()
        return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as x:
        return x.code, x.read().decode()[:200]

def main():
    e = env()
    st, venues = rest(e, 'GET', 'vp_venues?status=eq.active&select=id,slug,broadcast_enforce&order=slug')
    st, keys = rest(e, 'GET', 'vp_venue_signing_keys?select=venue_id')
    have = {k['venue_id'] for k in (keys or [])}

    if '--list' in sys.argv or len(sys.argv) < 3:
        print('%-26s %-8s %s' % ('venue', 'has key', 'enforcing'))
        for v in venues:
            print('%-26s %-8s %s' % (v['slug'], 'yes' if v['id'] in have else 'NO', v['broadcast_enforce']))
        return

    want = '--on' in sys.argv
    target = sys.argv[-1]
    picked = venues if target == 'ALL' else [v for v in venues if v['slug'] == target]
    if not picked: print('STOP: no active venue called %s' % target); sys.exit(1)

    for v in picked:
        if want and v['id'] not in have:
            print('  %-26s SKIPPED: no key. Enforcing without one would drop every message.' % v['slug'])
            continue
        if bool(v['broadcast_enforce']) == want:
            print('  %-26s already %s' % (v['slug'], 'on' if want else 'off')); continue
        st, msg = rest(e, 'PATCH', 'vp_venues?id=eq.' + v['id'], {'broadcast_enforce': want})
        print('  %-26s %s' % (v['slug'], ('enforcing' if want else 'enforcement off') if st in (200, 204) else 'FAILED %s %s' % (st, msg)))
    print('\n  Takes effect on the next message. Rollback: --off ALL')

if __name__ == '__main__':
    main()
