#!/usr/bin/env python3
"""IS THE WWW REDIRECT ACTUALLY RIGHT? Driven with the answers a broken edge rule would give.

WHY THIS FILE EXISTS. one_address_check asks the live site, which is the right thing to do,
because the redirect rule lives in a Cloudflare dashboard and nothing in this repo would notice
it being deleted. But a live probe can only ever see the answer the site gives today, so when
the rule is working, deleting an assertion changes nothing and the check stays green. Two of
three mutations proved exactly that on 12 Sep 2026: the query-string rule and the
status-code rule could not be made to fire.

A branch that cannot be made to fire is a branch nobody has checked. So the decision is a pure
function now and this hands it the answers a broken rule would give.

Run: python3 tools/redirect-verdict.test.py
"""
import importlib.util, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('rc', os.path.join(ROOT, 'tools', 'release-check.py'))
rc = importlib.util.module_from_spec(spec)
sys.argv = ['release-check.py', '--no-run']          # importing must not run the gate
try:
    spec.loader.exec_module(rc)
except SystemExit:
    pass

bad = 0
ran = 0


def check(name, cond, detail=''):
    global bad, ran
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + (('   ' + str(detail)) if detail else ''))
    if not cond:
        bad += 1


v = rc.redirect_verdict
APEX = 'https://venueplay.com.au'

# The answer the live rule gives today.
check('a 301 to the apex keeping the query is accepted',
      v('/tv?the-mini-bar', 'the-mini-bar', 301, APEX + '/tv?the-mini-bar') is None)
check('308 is accepted too', v('/', None, 308, APEX + '/') is None)
check('302 is accepted', v('/', None, 302, APEX + '/') is None)

# THE THREE WAYS IT GOES WRONG. None of these can be produced by the live site, which is why
# they were unprovable before.
# ASSERT THE REASON, not merely that something was wrong. Widening the accepted status codes
# to include 200 left this green, because a 200 carries no Location and the NEXT rule caught it
# instead. Still caught, but the status-code rule itself was unproven, which is the whole thing
# this file exists to stop.
check('a 200 is refused BY THE STATUS RULE, naming the status',
      'not a redirect' in (v('/', None, 200, APEX + '/') or ''),
      v('/', None, 200, APEX + '/'))
check('a 404 is too', 'not a redirect' in (v('/', None, 404, '') or ''))
check('and a 500', 'not a redirect' in (v('/', None, 500, '') or ''))
check('a redirect to some other site is caught',
      v('/', None, 301, 'https://example.invalid/') is not None,
      v('/', None, 301, 'https://example.invalid/'))
check('a redirect that DROPS the venue slug is caught, which would send every TV to the pairing screen',
      v('/tv?the-mini-bar', 'the-mini-bar', 301, APEX + '/tv') is not None,
      v('/tv?the-mini-bar', 'the-mini-bar', 301, APEX + '/tv'))
check('a redirect to a lookalike host is caught',
      v('/', None, 301, 'https://venueplay.com.au.evil.example/') is not None,
      v('/', None, 301, 'https://venueplay.com.au.evil.example/'))
check('redirecting back to www would be a loop and is caught',
      v('/', None, 301, 'https://www.venueplay.com.au/') is not None)

# And it must not invent a problem where there is none.
check('no query requirement means a plain path is fine',
      v('/app/', None, 301, APEX + '/app/') is None)
check('the query may carry more than the slug',
      v('/tv?the-mini-bar&x=1', 'the-mini-bar', 301, APEX + '/tv?the-mini-bar&x=1') is None)

print('')
print(('%d OF %d FAILED' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
