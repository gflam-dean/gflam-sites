#!/usr/bin/env python3
"""CAN EVERY ACTIVE VENUE BE TOLD ITS OWN STATE'S GAMING RULES?

    python3 venueplay-backend/tools/check-gaming-state.py

WHY THIS EXISTS. Before bingo, musical bingo, a raffle or a members draw runs,
vp-gaming.js puts a card in front of the host with their own state's rules on it.
Which state that is comes from ONE column, vp_venues.au_state, and the Worker
derives that column from the venue's postcode when the venue is provisioned.

If the postcode is missing, au_state is null, and the card says:

    "We do not know which state this venue is in yet."

followed by the generic advice. It is not an error. Nothing goes red, nothing is
logged, the night runs perfectly well, and the host reads a compliance card that
cannot name the regulator they answer to. On a product where the whole reason
that card exists is QLD's OLGR, that is the one sentence it must never have to say.

Found on 11 Sep 2026 by running a real raffle on a test venue and reading the card.
Every test venue was missing au_state, and so was tugun-bowls, which is ACTIVE.

WHAT IT ASKS. vp_venues, with the service key, because RLS quite correctly hides
other people's venues from the public key: the anon key reads this table and gets
zero rows, so a version of this check built on the public key would have found
nothing wrong, for ever, at every venue.

It reports, and fails, on ACTIVE venues only. A suspended venue is not running a
night tonight. Trivia is exempt from all of this (it is a game of skill) but the
same venue runs the other four formats, so the column still has to be right.
"""
import json, os, re, sys, urllib.error, urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vp_live import live          # never guess which project is live from a variable name

GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# The states vp-gaming.js holds confirmed rules for. A venue mapped to something
# outside this list gets the "we have not confirmed" card, which is a softer
# failure than "we do not know", but it is still not their own rules.
KNOWN = {'QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'}


def get(base, key, path):
    r = urllib.request.Request(base + path, headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        return json.load(urllib.request.urlopen(r, timeout=30))
    except urllib.error.HTTPError as e:
        print('%sCOULD NOT ASK THE DATABASE%s  HTTP %s %s' % (RED, OFF, e.code, e.read().decode()[:200]))
        sys.exit(2)


def main():
    L = live()
    print(L.banner())          # which project was asked, out loud, every run
    base, key = L.rest_url.rstrip('/'), L.service_key
    if not base or not key:
        print('%sno REST url or service key for the live project%s' % (RED, OFF))
        return 2
    rows = get(base, key, '/rest/v1/vp_venues?select=slug,name,status,postcode,au_state&limit=2000')
    if not isinstance(rows, list):
        print('%sthe database did not answer with a list, so nothing was checked%s' % (RED, OFF))
        sys.exit(2)

    # A COUNT THAT CANNOT BE ZERO BY ACCIDENT. If the select breaks, or RLS is
    # applied, this reads zero venues and every venue below "passes". Rule 3 of
    # release-check: a silent no-op must not pass for a pass.
    if not rows:
        print('%sZERO VENUES CAME BACK%s. Either the query is wrong or the key is not a service key.' % (RED, OFF))
        print('Nothing was checked, so this is a failure and not a clean result.')
        sys.exit(2)

    active = [v for v in rows if (v.get('status') or '') == 'active']
    print()
    print('WHICH STATE\'S GAMING RULES CAN WE SHOW EACH VENUE?')
    print('%s  %d venue(s) read, %d of them active%s' % (DIM, len(rows), len(active), OFF))
    print()

    nostate, unknown = [], []
    for v in active:
        st = (v.get('au_state') or '').strip().upper()
        if not st:
            nostate.append(v)
        elif st not in KNOWN:
            unknown.append(v)

    for v in nostate:
        why = 'no postcode either' if not v.get('postcode') else ('postcode %s, but au_state was never derived' % v['postcode'])
        print('  %sFAIL%s %-26s %s' % (RED, OFF, v.get('slug') or '?', why))
    for v in unknown:
        print('  %sFAIL%s %-26s au_state is %r, which vp-gaming.js holds no rules for'
              % (RED, OFF, v.get('slug') or '?', v.get('au_state')))
    if not nostate and not unknown:
        print('  %sok%s   every active venue maps to a state we hold rules for   %s(%d checked)%s'
              % (GRN, OFF, DIM, len(active), OFF))

    # Said out loud whatever the result, because it is the reason the failures above exist.
    idle = [v for v in rows if (v.get('status') or '') != 'active' and not (v.get('au_state') or '').strip()]
    if idle:
        print()
        print('%s  %d venue(s) that are NOT active also have no state. Not a failure: they are'
              % (DIM, len(idle)))
        print('  not running a night. They will be, if they come back: %s%s' % (', '.join(v.get('slug') or '?' for v in idle[:6]), OFF))

    bad = len(nostate) + len(unknown)
    print()
    if bad:
        print('%s%d ACTIVE VENUE(S) WOULD BE TOLD "we do not know which state this venue is in yet"%s'
              % (RED, bad, OFF))
        print('Fix: put the venue\'s postcode on its account page. The Worker derives au_state from it')
        print('(vpaStateFromPostcode), and the gaming card then names their own regulator.')
        sys.exit(1)
    print('%sEvery active venue can be shown its own state\'s rules.%s' % (GRN, OFF))
    return 0


if __name__ == '__main__':
    sys.exit(main())
