#!/usr/bin/env python3
"""NO "MADE BY AI" LOOK AND NO AI WRITING ON THE PAGES A HOST OR VENUE SEES (INBOX 122, Dean 6 to 10 Nov 2026).

Dean: no pink dash before a heading label, no pill with a dot, no spaced-out capitals, no green or pulsing
dots, a connection light is the plain word, and customer copy has no em dashes, no "no X, no Y, no Z" rhythm
lists and no filler. Reads the shipped files (no Chrome):

  python3 tools/ai-look-cleanup.test.py

  1. no rule anywhere in the checked pages sets UPPERCASE with letter spacing of .05em or more (join codes,
     code boxes, the BINGO button and Dean's approved game labels PRIZE / Wins / SECS / double points /
     "question 3 of 10" are the named exceptions)
  2. no .live-dot, no .vps-dot, no pink dash (a 1px line) drawn before a heading label, no pulsing rings
  3. every connection dot is hidden: the word alone says it; the reconnecting bar has no dot
  4. no em or en dash in a checked page's own text
  5. the home page and the offer page carry none of the old filler lines
Not checked here, left to the branches that own the files: the setup wizard, emails, play.html, tv.html,
the raffle and members hosts and screens, the What's on files.
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VP = os.path.join(ROOT, 'venueplay')
def rd(p): return open(os.path.join(VP, p), encoding='utf-8', errors='replace').read()
passed = failed = 0
def ok(label, good, detail=''):
    global passed, failed
    if good: passed += 1; print('  ok   ' + label)
    else: failed += 1; print('  FAIL ' + label + ('   saw: %s' % (detail,) if detail != '' else ''))


def rules_with(t, word):
    """Every CSS-looking rule (selector, body) whose body mentions `word`, found from the word outwards (fast on big pages)."""
    seen = set()
    for m in re.finditer(re.escape(word), t):
        s = t.rfind('{', 0, m.start()); e = t.find('}', m.start())
        if s < 0 or e < 0 or (s, e) in seen: continue
        if '{' in t[s + 1:m.start()] or '}' in t[s + 1:m.start()]: continue
        seen.add((s, e))
        b = max(t.rfind('}', 0, s), t.rfind('{', 0, s), t.rfind(';', max(0, s - 400), s) if False else -1)
        yield t[b + 1:s], t[s + 1:e]

PAGES = ['index.html', 'nsw.html', 'see-a-night.html', 'help.html', '404.html', 'terms.html', 'privacy.html',
         'live-here-now.html', 'training.html', 'signage.html', 'leave-behind.html', 'leave-behind-pub.html',
         'leave-behind-rsl.html', 'leave-behind-club.html',
         'app/index.html', 'app/billing.html', 'app/hq.html', 'app/settings.html', 'app/report.html',
         'app/marketing.html', 'app/onboard.html', 'app/purchase-raffle/index.html',
         'app/trivia/host.html', 'app/trivia/builder.html', 'app/trivia/play.html', 'app/trivia/screen.html',
         'app/musical/host.html', 'app/musical/play.html', 'app/musical/screen.html',
         'app/vp-phone.css', 'app/vp-tvgame.js', 'app/vp-prospects-hq.js', 'app/vp-venuepick.js',
         'app/vp-permits.js', 'app/vp-help.js', 'app/vp-gaming.js', 'app/topanswers/pr-board.js', 'app/topanswers/pr-phone.js']
EXCEPT = re.compile(r'bingo-btn|codeval|-code|\.code\b|\.ccode|tjc|input|codein|prize|winslabel|rlbl|dblpts|tv-status|pq-count|picked')

print('1. No spaced-out capitals')
bad = []
for p in PAGES:
    t = rd(p)
    for selx, body in rules_with(t, 'letter-spacing'):
        sel = selx.split('*/')[-1].strip()
        ls = re.search(r'letter-spacing:\s*(-?[\d.]+)(em|px|cqw|rem)', body)
        if not ls or not re.search(r'text-transform:\s*uppercase', body): continue
        v = float(ls.group(1)); u = ls.group(2)
        if not ((u == 'em' and v >= 0.05) or (u == 'px' and v >= 1) or (u in ('cqw', 'rem') and v >= 0.1)): continue
        if EXCEPT.search(sel): continue
        bad.append('%s: %s' % (p, sel[:50]))
ok('no rule in %d pages sets UPPERCASE with wide letter spacing (outside the named exceptions)' % len(PAGES), not bad, bad[:6])
IDX = rd('index.html')
ok('home page labels are plain sentence case: .label has no UPPERCASE and no ::before dash',
   re.search(r"\.label\{[^}]*\}", IDX) and 'uppercase' not in re.search(r"\.label\{[^}]*\}", IDX).group(0) and '.label::before' not in IDX)

print('2. No dots, dashes or pulsing rings as decoration')
dots = [p for p in PAGES if re.search(r'\.live-dot|\.vps-dot|class="vps-dot"|vps-pulse|vpConnPulse', rd(p))]
ok('no .live-dot, .vps-dot or pulse keyframes on the checked pages', not dots, dots)
dash = []
for p in PAGES:
    for selx, body in rules_with(rd(p), 'content'):
        sel = selx.split('*/')[-1].strip()
        if re.search(r'(label|eyebrow|kicker|swap-k|step-num)[^,]*::?before', sel) and 'content:""' in body.replace(' ', ''):
            dash.append('%s: %s' % (p, sel[:40]))
ok('no 1px pink line is drawn before a heading label (label, eyebrow, kicker)', not dash, dash)
SEE = rd('see-a-night.html')
ok('the tap rings on see-a-night do not pulse and have no centre dot', '.vp-ring .core { display: none; }' in SEE and 'animation: vp-pulse' not in SEE)
ok('the see-a-night eyebrow is a plain line (no pill, no dot)', '<span class="vp-eyebrow">The real screens</span>' in SEE and 'border-radius: 999px;\n    margin-bottom: 18px' not in SEE)
LB = [rd(f) for f in ('leave-behind.html', 'leave-behind-pub.html', 'leave-behind-rsl.html', 'leave-behind-club.html')]
ok('the leave-behinds have no pink dot before the panel headings', all('class="dot"' not in x for x in LB))

print('3. A connection light is a word, never a dot')
hidden = {'app/index.html': r'\.dot\{display:none\}', 'app/musical/host.html': r'\.dot\{display:none\}',
          'app/trivia/host.html': r'\.dot\{display:none\}', 'app/vp-phone.css': r'\.dot\{display:none\}',
          'app/purchase-raffle/index.html': r'\.dot\{display:none\}',
          'app/musical/screen.html': r'\.sdot\{display:none\}', 'app/trivia/screen.html': r'\.sdot\{display:none\}'}
for p, rx in hidden.items():
    ok('%s hides the status dot' % p, re.search(rx, rd(p)))
CB = rd('app/vp-connbar.js')
ok('the reconnecting bar is words only: no <i> dot, no pulse', 'createElement("i")' not in CB and 'vp-connbar i' not in CB and 'vpConnPulse' not in CB)

print('4. No em or en dash in the pages\' own text')
dd = []
for p in PAGES:
    t = rd(p)
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S); t = re.sub(r'<!--.*?-->', '', t, flags=re.S); t = re.sub(r'(?m)^\s*//.*$', '', t)
    for m in re.finditer(r'—|–|&mdash;|&ndash;|&#8212;|&#8211;|\\u2014|\\u2013', t):
        dd.append('%s: %s' % (p, t[max(0, m.start() - 25):m.end() + 10].replace('\n', ' ')))
ok('no em dash, en dash or their entities in %d checked pages' % len(PAGES), not dd, dd[:4])

print('5. The old filler lines are gone from the home page and the offer page')
OLD = ['No app, no login, no host to hire', 'no run sheet, no rehearsal', 'Dead simple', 'no login, no fuss', 'rock-solid night',
       'no account, no login, nothing they have to hand over', 'and simply require the draw']
for name in ('index.html', 'nsw.html'):
    t = rd(name)
    ok('%s has none of the %d old rhythm / filler lines' % (name, len(OLD)), not [o for o in OLD if o in t], [o for o in OLD if o in t])
ok('the replacement lines are in', all(s in IDX for s in ('No app to download. Run it yourself, or hand it to your trivia host.', 'No tech in the room and no run sheet.', '>How it works<')))
ok('the hero never treats a trivia host as a cost (Dean, 11 Nov 2026, INBOX 205: "no host to hire" is gone)', not re.search(r'host to hire', IDX, re.I), re.findall(r'.{30}host to hire.{10}', IDX)[:2])

print('\n%d of %d checks passed' % (passed, passed + failed))
sys.exit(1 if failed else 0)
