#!/usr/bin/env python3
"""Is every active venue's TV refusing unsigned messages? Asks the LIVE database.

    python3 tools/check-signing-enforced.py

25 Sep 2026: broadcast signing had been switched on for the 17 venues that existed on 10 Sep, and
every venue made after that ran without it, because vp_venues.broadcast_enforce defaulted to false.
Nothing looked for it. Migration 92 made the default true; this is what notices if a venue is ever
made, restored or edited back to false. Exit 1 names the venues; exit 2 means it could not ask.
Secrets are read by vp_live and never printed.
"""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'venueplay-backend', 'tools'))
try:
    import vp_live
    L = vp_live.live()
    req = urllib.request.Request((L.rest_url.rstrip('/') if L.rest_url.rstrip('/').endswith('/rest/v1') else L.rest_url.rstrip('/') + '/rest/v1') + '/vp_venues?status=eq.active&select=slug,broadcast_enforce&order=slug',
                                 headers={'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key,
                                          'User-Agent': 'curl/8.7.1'})
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not isinstance(rows, list) or not rows:
        raise ValueError('no venues came back')
except Exception as e:
    print('COULD NOT ASK the live database: %s' % str(e)[:120])
    sys.exit(2)
off = [r['slug'] for r in rows if r.get('broadcast_enforce') is not True]
if off:
    print('NOT ENFORCING (%d of %d active venues): %s' % (len(off), len(rows), ', '.join(off)))
    print('fix: python3 venueplay-backend/tools/enforce-signing.py --on <slug>')
    sys.exit(1)
print('ok   all %d active venues enforce broadcast signing' % len(rows))
