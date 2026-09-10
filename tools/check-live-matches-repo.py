#!/usr/bin/env python3
"""Is the code RUNNING at Cloudflare the code in this repo? Byte for byte.

    python3 tools/check-live-matches-repo.py

WHY THIS IS DIFFERENT FROM THE BUILD STAMP. release-check.py asks each Worker its
own /health and compares the build string. That catches a paste that never landed
and a file sent to the wrong slot, and it is worth having. It cannot catch a
Worker edited in the Cloudflare dashboard, because whoever edited it did not
change the stamp, and for most of this product's life the Workers WERE edited in
the dashboard. A stamp is a claim the code makes about itself. This downloads the
actual script and compares it.

It matters for money. On 10 Sep 2026 a venue's first invoice was queried and the
only honest answer to "is the fix live" was "the stamp says so". The stamp is
written by the same file it describes.

THE MULTIPART ENVELOPE. Cloudflare hands the script back inside a multipart body.
Comparing the raw response reports every Worker as DIFFERENT by exactly the
length of the boundary, which reads like drift and is not. The envelope is
stripped before comparing, and the first run of this check got that wrong.
"""
import sys, urllib.request, urllib.error
from pathlib import Path

ENV = Path.home() / '.gflam-migrate.env'
ROOT = Path(__file__).resolve().parents[1]
PAIRS = [
    ('venueplay-api',  'venueplay-backend/worker/venueplay-api-FULL.js',   'the billing Worker: checkout, invoices, webhooks'),
    ('venueplay-game', 'venueplay-backend/worker/venueplay-game.js',       'the game Worker: nights, overage, screens'),
    ('partyplay-api',  'partyplay-backend/worker/DEPLOY-partyplay-api.js', 'PartyPlay'),
]

def env():
    e = {}
    for l in ENV.read_text().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); e[k.strip()] = v.strip()
    return e

def live_script(tok, acct, name):
    url = 'https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s' % (acct, name)
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok, 'User-Agent': 'vp-live-match/1.0'})
    raw = urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'replace')
    if raw.lstrip().startswith('--'):
        b = raw.lstrip().split('\n', 1)[0].strip()
        for p in raw.split(b):
            if 'Content-Disposition' in p or 'Content-Type' in p:
                body = p.split('\r\n\r\n', 1)[-1] if '\r\n\r\n' in p else p.split('\n\n', 1)[-1]
                if len(body) > 1000:
                    return body.rstrip('-\r\n')
    return raw

def main():
    e = env()
    tok, acct = e.get('CF_API_TOKEN'), e.get('CF_ACCOUNT_ID')
    if not tok or not acct:
        print('STOP: CF_API_TOKEN and CF_ACCOUNT_ID must be in %s' % ENV); sys.exit(1)

    print('\nIS THE CODE AT CLOUDFLARE THE CODE IN THIS REPO?\n')
    bad = 0
    for name, rel, what in PAIRS:
        f = ROOT / rel
        if not f.exists():
            print('  FAIL %-16s the repo file is missing: %s' % (name, rel)); bad += 1; continue
        try:
            L = live_script(tok, acct, name).strip()
        except urllib.error.HTTPError as x:
            print('  FAIL %-16s could not download (HTTP %s)' % (name, x.code)); bad += 1; continue
        except Exception as x:
            print('  FAIL %-16s could not download: %s' % (name, str(x)[:60])); bad += 1; continue
        R = f.read_text().strip()
        if L == R:
            print('  ok   %-16s identical, %s bytes   %s' % (name, '{:,}'.format(len(L)), what))
            continue
        bad += 1
        ll, rl = L.split('\n'), R.split('\n')
        where = 'live %d lines, repo %d' % (len(ll), len(rl))
        for i in range(min(len(ll), len(rl))):
            if ll[i] != rl[i]:
                where = 'first difference at line %d' % (i + 1); break
        print('  FAIL %-16s DIFFERS from %s (%s)' % (name, rel, where))
        print('       live is %s bytes, the repo is %s bytes' % ('{:,}'.format(len(L)), '{:,}'.format(len(R))))
        print('       Somebody edited this Worker somewhere other than this repo, or a deploy')
        print('       did not land. The build stamp cannot tell you either way.')

    print('')
    if bad:
        print('%d Worker(s) are not running the code in this repo.' % bad); sys.exit(1)
    print('All %d Workers are running exactly what is committed.' % len(PAIRS))

if __name__ == '__main__':
    main()
