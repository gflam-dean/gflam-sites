"""LIVENORM: WHAT CLOUDFLARE DID TO A PAGE IS NOT A DIFFERENCE, AND AN EDIT IS.

release-check's "this release is live" and verify-live both decide "is the live page the
file on disk" through tools/livenorm.py. On 27 Sep 2026 partyplay/album.html compared stale
for thirty minutes while the new page was plainly live: its footer link reads "Tell us",
Cloudflare rewrote only the href, and the normaliser replaced the TEXT with EMAIL on the
live side alone. Each shape below is the real rewrite Cloudflare serves.

Run: python3 tools/livenorm.test.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from livenorm import normalise

ran = bad = 0
def check(name, cond):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name)
    if not cond: bad += 1

DECODE = '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>'
BEACON = ("<script defer src='https://static.cloudflareinsights.com/beacon.min.js' "
          "data-cf-beacon='{\"token\": \"abc\"}'></script>")

repo = '<p><a href="mailto:hello@partyplay.com.au">Tell us</a> and we will remove it.</p><script src="/x.js"></script>'
live = ('<p><a href="/cdn-cgi/l/email-protection#29414c4545466959">Tell us</a> and we will remove it.</p>'
        + DECODE + '<script src="/x.js"></script>')
check('a mailto link with words for text matches its rewrite', normalise(repo) == normalise(live))

repo2 = '<p>Email <a href="mailto:hello@venueplay.com.au">hello@venueplay.com.au</a></p>'
live2 = ('<p>Email <a href="/cdn-cgi/l/email-protection#a1c9c4cdcdce"><span class="__cf_email__" '
         'data-cfemail="a1c9c4cdcdce">[email&#160;protected]</span></a></p>' + DECODE)
check('a mailto link showing the address matches its rewrite', normalise(repo2) == normalise(live2))

repo3 = '<p>Write to hello@venueplay.com.au today</p>'
live3 = ('<p>Write to <a href="/cdn-cgi/l/email-protection" class="__cf_email__" '
         'data-cfemail="a1c9">[email&#160;protected]</a> today</p>' + DECODE + BEACON)
check('an address in running text matches, beacon and all', normalise(repo3) == normalise(live3))

check('control: a real edit to the words is still a difference',
      normalise(repo) != normalise(live.replace('Tell us', 'Email us')))
check('control: a real edit to the code is still a difference',
      normalise(repo) != normalise(live.replace('/x.js', '/y.js')))

print('\n%d of %d checks passed' % (ran - bad, ran))
if bad:
    sys.exit(1)
