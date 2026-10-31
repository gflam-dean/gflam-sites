#!/usr/bin/env python3
"""EVERY SETUP GUIDE NAMES THE VENUEPLAY TV APP (Dean, 31 Oct 2026).

"we need to add in all of our set up instructions. If you have a TV with a Google play store you
can download our app... It's called VenuePlay TV." The Android TV / Google TV app is live on Google
Play (au.com.venueplay.tv) and pairs by the six-character screen code. So every place that tells a
venue how to set up its TV carries one line, word for word:

    Got a TV with Google Play? Download the VenuePlay TV app and put in your screen code.
    Otherwise open venueplay.com.au/tv in the TV's web browser.

  - the four emails a new venue gets (welcome, welcome-group, welcome-hq, venue-onboarding): in the
    "Set up your screen" step, with "VenuePlay TV app" linked to the app's Google Play page, and the
    step's existing words (any TV works, the RECONNECTING line) still there
  - the venue Help FAQ "Setting up the TV" (venueplay/data/help-faq.json, what /help and the console
    Help panel fall back on), as its first line, with every word migration 120 wrote after it
  - migration 131, which writes those same words live: one update of that row, the JSON's words
    exactly, guarded on the words 120 wrote, so it lands on the live row instead of matching nothing
  - the setup guide's TV step (vp-firstrun.js) is RUN, not read, in tools/test-prospect-welcome-v2.js

Run from the repo root:  python3 tools/tv-app-setup-line.test.py
"""
import importlib.util, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   saw: ' + json.dumps(saw, default=str)[:300]))
    if not ok:
        fails += 1


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace') as f:
        return f.read()


LINE = ("Got a TV with Google Play? Download the VenuePlay TV app and put in your screen code. "
        "Otherwise open venueplay.com.au/tv in the TV's web browser.")
PLAY = 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv'
EM_DASH = re.compile(r'[—–]')


def text(html):
    """What a reader sees: no comments, no tags, entities for the apostrophe undone, one space."""
    t = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    t = re.sub(r'<[^>]+>', '', t)
    t = t.replace('&#39;', "'").replace('&rsquo;', "'").replace('&amp;', '&').replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', t).strip()


# ---------------------------------------------------------------- the four emails
for t in ('welcome', 'welcome-group', 'welcome-hq', 'venue-onboarding'):
    s = re.sub(r'<!--.*?-->', ' ', read('venueplay/emails/%s.html' % t), flags=re.S)
    cell = re.search(r'<strong>Set up (?:your|the|each) screen\.</strong>(.*?)</td>', s, re.S)
    body = cell.group(1) if cell else ''
    words = text(body)
    check('email %s: the "Set up your screen" step carries the app line, word for word' % t,
          LINE in words, words[:260])
    link = re.search(r'<a\s[^>]*href="([^"]+)"[^>]*>\s*VenuePlay TV app\s*</a>', body)
    check('email %s: "VenuePlay TV app" links to the app\'s Google Play page' % t,
          bool(link) and link.group(1) == PLAY, link and link.group(1))
    check('email %s: the step keeps its own words (any TV works, and the RECONNECTING line), no long dash' % t,
          words.startswith('Any TV works') and 'RECONNECTING' in words and not EM_DASH.search(words), words[:120])

# ---------------------------------------------------------------- the Help FAQ
faq = json.loads(read('venueplay/data/help-faq.json'))
tv = [it for it in faq['venue']['items'] if it['q'] == 'Setting up the TV']
answer = tv[0]['a'] if len(tv) == 1 else ''
check('the venue Help answer "Setting up the TV" opens with the app line, on a line of its own',
      answer.startswith(LINE + '\n'), answer[:200])
check('and it never says roster and has no long dash', bool(answer) and 'roster' not in answer.lower() and not EM_DASH.search(answer))

# ---------------------------------------------------------------- migration 131 writes it live
spec = importlib.util.spec_from_file_location('cmp', os.path.join(ROOT, 'tools', 'check-migrations-parse.py'))
cmp_ = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cmp_)


def quoted(stmt, after):
    m = re.search(after + r"\s*'((?:[^']|'')*)'", stmt, re.I | re.S)
    return m.group(1).replace("''", "'") if m else None


def faq_update(rel):
    if not os.path.isfile(os.path.join(ROOT, rel)):
        return None, 'missing'
    st, fault = cmp_.scan(read(rel))
    ups = [b for _, b in (st or []) if re.match(r'update\s+public\.vp_help_faq\b', b, re.I)]
    return (ups[0] if len(ups) == 1 else None), (fault or (None if len(ups) == 1 else '%d updates' % len(ups)))


M131 = 'venueplay-backend/supabase/venueplay-131-help-faq-tv-app.sql'
M120 = 'venueplay-backend/supabase/venueplay-120-help-faq-tv-window.sql'
up131, f131 = faq_update(M131)
up120, f120 = faq_update(M120)
check('migration 131 exists, reads cleanly through the gate\'s SQL reader, and is one update of vp_help_faq', up131 is not None and f131 is None, f131)
new131 = quoted(up131 or '', r'set\s+answer\s*=')
rid131 = quoted(up131 or '', r'where\s+id\s*=')
guard131 = quoted(up131 or '', r'and\s+answer\s*=')
check('it names the "Setting up the TV" row', rid131 == '67840db0-6bea-52b6-81aa-249e2cf977f8', rid131)
check('the words it writes are the JSON\'s, word for word, line breaks included', bool(answer) and new131 == answer,
      [new131 and new131[:80], answer[:80]])
new120 = quoted(up120 or '', r'set\s+answer\s*=')
check('its guard is the words migration 120 wrote, so it changes the live row instead of silently matching nothing',
      bool(new120) and guard131 == new120, [guard131 and guard131[:80], new120 and new120[:80]])
check('and it only puts the line in front: every word 120 wrote is still there after it',
      bool(new120) and bool(new131) and new131 == LINE + '\n' + new120)

# ---------------------------------------------------------------- the how-it-works pages and the marketing
# Dean, 31 Oct 2026: "We also need to add Google play store app thing into all of our how do we play it?
# Guides and our marketing too." The short form, wherever a page tells a venue how the game gets on its TV.
SHORT = 'Got a TV with Google Play? Get the VenuePlay TV app, then put in your screen code.'


def linked(html):
    m = re.search(r'<a\s[^>]*href="([^"]+)"[^>]*>\s*VenuePlay TV app\s*</a>', html)
    return m.group(1) if m else None


for page in ('index', 'nsw'):
    s = re.sub(r'<!--.*?-->', ' ', read('venueplay/%s.html' % page), flags=re.S)
    tick = re.search(r'<strong>Plays on any screen</strong><span>(.*?)</span></div></li>', s, re.S)
    tw = text(tick.group(1)) if tick else ''
    check('%s.html "Plays on any screen" names the VenuePlay TV app, linked to its Google Play page' % page,
          SHORT in tw and linked(tick.group(1)) == PLAY, [tw[:200], tick and linked(tick.group(1))])
    faq_a = re.search(r'<summary>What do I need to run it\?<span class="pm"></span></summary><div class="a">(.*?)</div></details>', s, re.S)
    fw = text(faq_a.group(1)) if faq_a else ''
    check('%s.html FAQ "What do I need to run it?" names the VenuePlay TV app, linked, and keeps its own words' % page,
          SHORT in fw and linked(faq_a.group(1)) == PLAY and fw.startswith('A screen, an internet connection') and 'Players bring their own phones' in fw,
          fw[:240])

for lb in ('leave-behind', 'leave-behind-club', 'leave-behind-pub', 'leave-behind-rsl'):
    s = re.sub(r'<!--.*?-->', ' ', read('venueplay/%s.html' % lb), flags=re.S)
    li = re.search(r"<div>It <strong>plays on the screen you've already got</strong>(.*?)</div></li>", s, re.S)
    lw = text(li.group(1)) if li else ''
    check('printed handout %s: "plays on the screen you\'ve already got" goes on to name the VenuePlay TV app' % lb,
          lw.endswith(SHORT) and 'all included.' in lw, lw[-160:])

tr = read('venueplay/training.html')
cap = re.search(r'cap:"The venue TV is opened once at your venue\'s own link[^"]*"', tr)
check('the training walkthrough\'s TV caption names the VenuePlay TV app',
      bool(cap) and SHORT in cap.group(0), cap and cap.group(0)[:200])

bh = re.sub(r'<!--.*?-->', ' ', read('venueplay/app/billing.html'), flags=re.S)
note = re.search(r'<p class="note"[^>]*>Upload your own promo images to play on the venue TV(.*?)</p>', bh, re.S)
nw = text(note.group(1)) if note else ''
check('the Account page\'s TV note (where the TV link is) names the VenuePlay TV app, linked to its Google Play page',
      SHORT in nw and bool(note) and linked(note.group(1)) == PLAY, [nw[-200:], note and linked(note.group(1))])

ll = read('venueplay/llms.txt')
check('llms.txt (what AI search reads about VenuePlay) names the VenuePlay TV app and its Google Play page',
      re.search(r'^- Got a TV with Google Play\? Get the VenuePlay TV app \(' + re.escape(PLAY) + r'\), then put in your screen code\.$', ll, re.M) is not None)

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
