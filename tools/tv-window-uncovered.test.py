#!/usr/bin/env python3
"""THE TV WINDOW IS KEPT UNCOVERED AND FULL SCREEN, AND EVERY SETUP GUIDE SAYS SO (27 Oct 2026).

The Mini Bar, 23 Oct 2026: the TV said RECONNECTING and the balls lagged. Not the network, not the
members board: the TV page was in a Chrome window covered by the console. A covered or background
tab is throttled, the realtime heartbeat stops, the socket closes, and the page cannot rebuild
until the window is uncovered. The code fix (vp-channel.js, heartbeat in a Worker) softens it; the
cure is how the screen is set up, so the advice has to be in every place a venue reads about
setting up the TV:

  - the venue Help FAQ "Setting up the TV": venueplay/data/help-faq.json is what /help, the console
    Help panel and the account page fall back on, and migration 120 writes the same words into
    vp_help_faq, which is what they read live. This runs the migration through the same SQL reader
    the gate uses and requires its new answer to be the JSON's, word for word, and its guard to be
    the answer 106 seeded (so it applies on the live database, instead of silently doing nothing)
  - the four emails a new venue gets (welcome, welcome-group, welcome-hq, venue-onboarding): the
    "Set up your screen" step carries the one line
  - the training walkthrough's first caption
  - and /help draws the venue FAQ at all (the audience mount and the widget in page mode), so the
    words have a page to land on

Any of those losing the words is red. Run from the repo root:  python3 tools/tv-window-uncovered.test.py
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


# The words every guide must carry, in plain English a publican reads once.
MUST = ['uncovered', 'full screen', 'kiosk', 'RECONNECTING', 'behind another window']
EM_DASH = re.compile(r'\w\s*[—–]\s*\w')

# ---------------------------------------------------------------- the FAQ the help page draws
faq = json.loads(read('venueplay/data/help-faq.json'))
tv = [it for it in faq['venue']['items'] if it['q'] == 'Setting up the TV']
check('the venue FAQ has one "Setting up the TV" answer', len(tv) == 1, [it['q'] for it in faq['venue']['items']])
answer = tv[0]['a'] if tv else ''
missing = [w for w in MUST if w not in answer]
check('it tells venues to keep the TV page uncovered and full screen, names kiosk for a stick, and says what RECONNECTING means', not missing, missing)
check('it says a covered window is the cause before it says reload (uncover first, then reload)',
      answer.find('covering the window') != -1 and answer.find('covering the window') < answer.rfind('reload'), answer[-200:])
check('the answer has no long dash and never says roster', not EM_DASH.search(answer) and 'roster' not in answer.lower())

# ---------------------------------------------------------------- the migration that writes it live
spec = importlib.util.spec_from_file_location('cmp', os.path.join(ROOT, 'tools', 'check-migrations-parse.py'))
cmp_ = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cmp_)
MIG = 'venueplay-backend/supabase/venueplay-120-help-faq-tv-window.sql'
check('migration 120 exists', os.path.isfile(os.path.join(ROOT, MIG)))
stmts, fault = cmp_.scan(read(MIG)) if os.path.isfile(os.path.join(ROOT, MIG)) else ([], 'missing')
check('migration 120 reads cleanly through the gate\'s SQL reader', fault is None, fault)


def quoted(stmt, after):
    m = re.search(after + r"\s*'((?:[^']|'')*)'", stmt, re.I | re.S)
    return m.group(1).replace("''", "'") if m else None


ups = [b for _, b in (stmts or []) if re.match(r'update\s+public\.vp_help_faq\b', b, re.I)]
check('it is one update of vp_help_faq', len(ups) == 1, len(ups))
up = ups[0] if ups else ''
new_answer, rid, guard = quoted(up, r'set\s+answer\s*='), quoted(up, r'where\s+id\s*='), quoted(up, r'and\s+answer\s*=')
check('it names the "Setting up the TV" row migration 106 seeded', rid == '67840db0-6bea-52b6-81aa-249e2cf977f8', rid)
check('the words it writes are the JSON\'s, word for word, line breaks included', new_answer == answer and bool(answer),
      [new_answer[:80] if new_answer else None, answer[:80]])
seed = read('venueplay-backend/supabase/venueplay-106-help-desk.sql')
m106 = re.search(r"'67840db0-6bea-52b6-81aa-249e2cf977f8', 'venueplay', 'venue', 20, 'Setting up the TV', '((?:[^']|'')*)'", seed)
seeded = m106.group(1).replace("''", "'") if m106 else None
check('its guard is the answer 106 seeded, so it changes the live row instead of silently matching nothing', guard is not None and guard == seeded,
      [guard[:80] if guard else None, seeded[:80] if seeded else None])

# ---------------------------------------------------------------- /help draws the venue FAQ
h = re.sub(r'<!--.*?-->', ' ', read('venueplay/help.html'), flags=re.S)
check('/help mounts the venue help and loads the widget in page mode (so the FAQ above is what a venue sees there)',
      'data-vph-audience="venue"' in h and re.search(r'<script src="/app/vp-help\.js" data-mode="page"', h) is not None)
w = read('venueplay/app/vp-help.js')
check('the widget falls back on /data/help-faq.json when the Worker cannot be reached', '/data/help-faq.json' in w)

# ---------------------------------------------------------------- the emails a new venue gets
LINE = 'Keep that browser window full screen with nothing over it: a TV page hidden behind another window slows down and shows RECONNECTING.'
for t in ('welcome', 'welcome-group', 'welcome-hq', 'venue-onboarding'):
    s = re.sub(r'<!--.*?-->', ' ', read('venueplay/emails/%s.html' % t), flags=re.S)
    cell = re.search(r'<strong>Set up (?:your|the|each) screen\.</strong>(.*?)</td>', s, re.S)
    check('email %s: the "Set up your screen" step says full screen with nothing over it, and what RECONNECTING means' % t,
          bool(cell) and LINE in cell.group(1) and not EM_DASH.search(cell.group(1)), cell and cell.group(1)[-160:])

# ---------------------------------------------------------------- the training walkthrough
tr = read('venueplay/training.html')
cap = re.search(r'cap:"The venue TV is opened once at your venue\'s own link[^"]*"', tr)
check('the training walkthrough\'s first caption says the TV is kept full screen with nothing over it',
      bool(cap) and 'full screen with nothing over it' in cap.group(0), cap and cap.group(0)[-120:])

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
