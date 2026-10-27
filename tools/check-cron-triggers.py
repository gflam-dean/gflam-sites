#!/usr/bin/env python3
"""A Worker that exports `scheduled` and has no Cron Trigger is dead code that looks alive.

WHY THIS EXISTS. The 30 day album sweep sat in the PartyPlay Worker, written, correct and
exported, from the day it was made until 16 September 2026, and it never ran once, because
nobody had added a Cron Trigger in the Cloudflare dashboard. Nothing in this repo could see
that. The code was there, the tests passed, the gate was green.

There are three of these hanging off the game Worker's scheduled handler now, and one of
them is the 90 day deletion of a closed venue's player list that venueplay.com.au/privacy
promises. If somebody removes a trigger in the dashboard, or a new Worker ships with a
scheduled export and nobody wires it up, the promise quietly stops being kept and the only
symptom is data that should have gone still being there.

So this asks BOTH ends and requires them to agree:

    the repo   which Worker files export `async scheduled(`
    Cloudflare which Workers actually have a Cron Trigger

Read only. It changes nothing and prints no token.

    exit 0   every Worker that exports scheduled has a trigger
    exit 1   one does not, or the API could not be asked

Run: python3 tools/check-cron-triggers.py
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.expanduser('~/.gflam-migrate.env')

# The file that is actually deployed into each slot. Deliberately the DEPLOY file for
# PartyPlay, not the SOURCE: the source is never uploaded, so its exports prove nothing
# about what is running.
DEPLOYED = {
    'venueplay-backend/worker/venueplay-game.js':      'venueplay-game',
    'venueplay-backend/worker/venueplay-api-FULL.js':  'venueplay-api',
    'partyplay-backend/worker/DEPLOY-partyplay-api.js': 'partyplay-api',
    'venueplay-backend/worker/venueplay-sms-hook.js':  'venueplay-sms',
}

GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'


def env():
    if not os.path.isfile(ENV):
        print('STOP: no %s on this machine, so Cloudflare was never asked.' % ENV)
        sys.exit(1)
    out = {}
    for line in open(ENV):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def cf(tok, acct, path):
    req = urllib.request.Request(
        'https://api.cloudflare.com/client/v4/accounts/%s%s' % (acct, path),
        headers={'Authorization': 'Bearer ' + tok, 'User-Agent': 'curl/8.7.1'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    except urllib.error.HTTPError as e:
        return {'success': False, 'errors': [{'message': 'HTTP %s' % e.code}]}
    except Exception as e:
        return {'success': False, 'errors': [{'message': str(e)[:70]}]}


def main():
    e = env()
    tok, acct = e.get('CF_API_TOKEN', ''), e.get('CF_ACCOUNT_ID', '')
    if not tok or not re.fullmatch(r'[0-9a-f]{32}', acct or ''):
        print('STOP: CF_API_TOKEN and CF_ACCOUNT_ID must both be in %s' % ENV)
        return 1

    # WHICH WORKERS CLAIM TO HAVE A SCHEDULED JOB. Comments stripped first: the note
    # explaining this fault quotes "async scheduled(" and would otherwise nominate a
    # Worker that has no such export.
    wants = []
    for rel, slot in sorted(DEPLOYED.items()):
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            continue
        src = open(p, encoding='utf-8', errors='ignore').read()
        src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
        src = re.sub(r'(^|[^:])//[^\n]*', r'\1', src)
        if re.search(r'async\s+scheduled\s*\(', src):
            wants.append((rel, slot))

    if not wants:
        print('%sNo Worker in this repo exports a scheduled handler.%s' % (YEL, OFF))
        print('That is either true or this checker has stopped being able to see one.')
        return 1

    bad = 0
    print('\n%sEvery scheduled job needs a Cron Trigger to call it%s' % (YEL, OFF))
    print('%s  asked Cloudflare, %d Worker(s) in this repo export one%s\n'
          % (DIM, len(wants), OFF))
    for rel, slot in wants:
        d = cf(tok, acct, '/workers/scripts/%s/schedules' % slot)
        if not d.get('success'):
            msg = (d.get('errors') or [{}])[0].get('message', 'unknown')
            print('  %sCOULD NOT ASK%s %-16s %s' % (RED, OFF, slot, msg))
            bad += 1
            continue
        crons = [s.get('cron') for s in ((d.get('result') or {}).get('schedules') or [])]
        if crons:
            print('  %sok%s            %-16s %s' % (GRN, OFF, slot, ', '.join(crons)))
        else:
            print('  %sNO TRIGGER%s    %-16s exports scheduled and nothing calls it'
                  % (RED, OFF, slot))
            print('                  %s' % rel)
            bad += 1

    print('')
    if bad:
        print('%s%d Worker(s) have a scheduled job nobody runs.%s' % (RED, bad, OFF))
        print('Cloudflare dashboard -> Workers -> the Worker -> Settings -> Triggers')
        print('-> Cron Triggers -> Add Cron Trigger. The game Worker is hourly and')
        print('decides 3am for itself, so "0 * * * *" is the right shape.')
        return 1
    print('%sEvery scheduled job has something that calls it.%s' % (GRN, OFF))
    return 0


if __name__ == '__main__':
    sys.exit(main())
