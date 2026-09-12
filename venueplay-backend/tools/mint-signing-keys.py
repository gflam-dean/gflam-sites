#!/usr/bin/env python3
"""Give every venue a broadcast signing key. Minting alone changes NOTHING.

    python3 venueplay-backend/tools/mint-signing-keys.py --list
    python3 venueplay-backend/tools/mint-signing-keys.py

WHY IT MATTERS. A venue's realtime channel name is derived from its PUBLIC slug, and the
anon key is printed in every page. So at a venue that is not enforcing, somebody who
worked that out could send fake balls, a fake winner or a fake reveal to every screen and
phone in the room. Signing closes it: the host signs, the screens verify, forgeries are
dropped before anybody sees them.

On 10 Sep 2026, of 14 active real venues, 10 held a key and ONE enforced.

MINTING IS NOT ENFORCING. A venue with a key and broadcast_enforce still false behaves
exactly as it does today. Enforcement is a separate flag, turned on per venue, and it
should be turned on with a night in hand rather than in the middle of one.

WHY THIS RUNS HERE AND NOT IN THE WORKER. Cloudflare Workers cannot generate an ECDSA
key pair, so keys have always been minted in a browser and handed to the Worker to store.
That works when a host opens the console; it does not help the four venues whose hosts
have not. This mints the same shape of key from a laptop, with the same curve, and writes
the same two columns.
"""
import base64, json, sys, urllib.request, urllib.error
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from vp_live import live   # which database is LIVE; never guess from a variable name

ENV  = Path.home() / '.gflam-migrate.env'
LIVE = None   # set from vp_live at run time; a hardcoded ref is how a tool asks the abandoned copy
L = None      # the resolved live project; set in main(), used by the helpers below

def b64u(n, size):
    return base64.urlsafe_b64encode(n.to_bytes(size, 'big')).decode().rstrip('=')

def mint():
    """A P-256 pair as two JWKs, exactly the shape crypto.subtle.exportKey('jwk') gives."""
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_numbers()
    d = priv.private_numbers().private_value
    public = {'kty': 'EC', 'crv': 'P-256', 'x': b64u(pub.x, 32), 'y': b64u(pub.y, 32),
              'ext': True, 'key_ops': ['verify']}
    private = dict(public); private['d'] = b64u(d, 32); private['key_ops'] = ['sign']
    return public, private

def env():
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    # NOTE-VP-LIVE
    # WHICH DATABASE. Read from vp_live, never OLD_SERVICE_KEY.
    # This tool paired a URL that migrate-sydney.py rewrites with a key that it does not, so
    # after the cut-over it would have sent Singapore's key to Sydney and 401'd on every call.
    # For enforce-signing.py that matters most of all: --off ALL is the documented one-command
    # rollback for broadcast signing, and it would have stopped working at the exact moment it
    # was needed. Fixed 12 Sep 2026, on the morning of the move.
    global LIVE, L
    L = live()
    LIVE = L.rest_url
    print(L.banner())
    if not L.service_key: print('STOP: no service key for the live database'); sys.exit(1)
    return e

def rest(e, method, path, body=None, prefer=None):
    h = {'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key,
         'Content-Type': 'application/json', 'User-Agent': 'VenuePlay-mint-keys/1.0'}
    if prefer: h['Prefer'] = prefer
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
    missing = [v for v in venues if v['id'] not in have]

    if '--list' in sys.argv:
        print('%d active venues, %d hold a key, %d do not:' % (len(venues), len(have & {v['id'] for v in venues}), len(missing)))
        for v in missing: print('   %-26s enforcing: %s' % (v['slug'], v['broadcast_enforce']))
        print('\nMinting changes nothing on its own. Enforcement is a separate flag.')
        return

    for v in missing:
        pub, priv = mint()
        st, msg = rest(e, 'POST', 'vp_venue_signing_keys',
                       {'venue_id': v['id'], 'public_jwk': pub, 'private_jwk': priv})
        print('  %-26s %s' % (v['slug'], 'key minted' if st in (200, 201) else 'FAILED %s %s' % (st, msg)))
    print('\n  Minted. Nothing enforces yet: a venue with a key and enforcement off')
    print('  behaves exactly as it did before.')

if __name__ == '__main__':
    main()
