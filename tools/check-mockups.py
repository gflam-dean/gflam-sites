#!/usr/bin/env python3
"""DO THE SALES MOCKUPS STILL LOOK LIKE THE REAL SCREENS?

    python3 tools/check-mockups.py             ask
    python3 tools/check-mockups.py --accept    "I have looked, they match, start the clock again"

WHY THIS EXISTS. Dean, 12 Sep 2026: "Can you double check that the set up guide and the
look at a night things both have the current look of the screens? Can you do that say
once a month?"

The answer to the first half was worse than a stale screenshot. There are no screenshots.
`see-a-night.html` says it holds "REAL preview mockups, copied verbatim from the live
site", and they are hand built in CSS under `.vps-*` class names. `index.html` holds a
second set. The real venue screen, `tv.html`, uses none of those class names at all.

So there is no link of any kind between what a venue actually sees on the wall and what
a prospect is shown on the sales page. `tv.html` can be redesigned completely and both
pages will happily keep showing last month's product, for ever, with nothing going red.

That is the fault this repo already knows by name: the same answer living in more than
one place. It is only worse here, because the copy is what you SELL with.

WHAT THIS CAN AND CANNOT DO, said plainly.

  CAN: notice that a real screen has changed since somebody last confirmed the mockups
  match. That is the whole product.

  It also counts classes the two mockup sets style differently, but only as a line to
  read, never as a failure. A page is allowed to hide a component or draw it smaller,
  and nothing here can tell that apart from drift.

  CANNOT: tell you whether a mockup LOOKS like the screen. Nothing here renders a
  pixel. This is a tripwire that makes a human look, not a judgement that they match.
  If it is green it means nobody has changed the screen since the last time you looked,
  which is a different and smaller claim.

IT STAYS QUIET. A check that speaks every run is a check people learn to scroll past,
so this says nothing at all unless the screen has changed or a month has gone by.
"""
import argparse, hashlib, io, json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, 'tools', 'mockups-last-checked.json')
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# The real screens. A change to any of these is what makes the mockups suspect.
REAL = [
    'venueplay/tv.html',
    'venueplay/app/trivia/screen.html',
    'venueplay/app/musical/screen.html',
    'venueplay/app/raffle/screen.html',
    'venueplay/app/members/screen.html',
]
# The places that show a screen to somebody who is not a customer yet.
MOCKUPS = ['venueplay/see-a-night.html', 'venueplay/index.html']


def embeds_real_screen(path):
    """Does this page EMBED the real screen rather than draw a picture of it?

    A page that iframes /tv?demo=1 cannot drift, by construction: it is the same file the
    venue runs. Asking somebody to compare it against tv.html every month would be asking
    them to compare a thing with itself, and a check that asks for pointless work is one
    people learn to dismiss, which costs the checks that do matter.

    see-a-night stopped drawing on 12 Sep 2026. index.html still draws, so it is still
    watched. The test is on the CODE rather than a list kept here, so a page that goes back
    to drawing starts being watched again on its own."""
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        return False
    src = io.open(full, encoding='utf-8', errors='replace').read()
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)          # a comment is not an embed
    # NOT a literal "/tv?demo=1". see-a-night builds its src by concatenation so the same page
    # works on Pages (/tv) and off a plain file server (/tv.html), and the first version of this
    # looked for the joined-up string and found nothing. An embed is an iframe pointed at a demo.
    return bool(re.search(r'<iframe', src)) and bool(re.search(r'demo=1', src))
DAYS = 31


def styles_of(path):
    """Only the LOOK. A screen's JavaScript changes constantly and says nothing about
    whether the thing on the wall is a different shape."""
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        return None
    src = io.open(full, encoding='utf-8', errors='replace').read()
    css = ''.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S))
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)      # a comment is not a look
    css = re.sub(r'\s+', ' ', css).strip()
    return css


def fingerprint():
    h, seen = hashlib.sha256(), []
    for rel in REAL:
        css = styles_of(rel)
        if css is None:
            continue
        seen.append(rel)
        h.update(rel.encode())
        h.update(css.encode())
    return (h.hexdigest()[:12] if seen else None), seen


def rules(path):
    """{class: the declarations inside its LAST rule}. Last, because a later rule is
    what actually applies, which is the one a person would see."""
    css = styles_of(path) or ''
    out = {}
    for m in re.finditer(r'(\.vps-[a-z0-9-]+)\s*\{([^}]*)\}', css):
        body = re.sub(r'\s*;\s*', ';', m.group(2)).strip().strip(';')
        body = ';'.join(sorted(x.strip() for x in body.split(';') if x.strip()))
        out[m.group(1)] = body
    return out


def load():
    try:
        return json.load(io.open(STATE, encoding='utf-8'))
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accept', action='store_true',
                    help='record that you have looked and they match')
    ap.add_argument('--force', action='store_true', help='say something even if nothing changed')
    a = ap.parse_args()

    fp, seen = fingerprint()
    if not fp:
        print('%sNO SCREENS FOUND%s at any of: %s' % (RED, OFF, ', '.join(REAL)))
        print('Nothing was checked, so this is a failure and not a clean result.')
        return 2

    st = load()
    today = datetime.date.today().isoformat()

    if a.accept:
        io.open(STATE, 'w', encoding='utf-8').write(json.dumps(
            {'screens_fingerprint': fp, 'checked_on': today, 'screens': seen}, indent=2) + '\n')
        print('Recorded. %d screen file(s), fingerprint %s, on %s.' % (len(seen), fp, today))
        print('Nothing will be said about the mockups again until a screen changes or %d days pass.' % DAYS)
        return 0

    was = st.get('screens_fingerprint')
    when = st.get('checked_on')
    changed = (was is not None and was != fp)
    never = was is None
    old = False
    if when:
        try:
            old = (datetime.date.today() - datetime.date.fromisoformat(when)).days >= DAYS
        except Exception:
            old = True

    # THE TWO SETS DIFFERING IS NOT A FAULT, and the first version of this called it
    # one. Run on 12 Sep 2026 it reported thirteen "disagreements", and the first two
    # looked at were both deliberate: the front page sets .vps-code to display:none
    # because it does not show a join code at all, and .vps-cell picked up a media
    # query override rather than the base rule.
    # A page is allowed to draw the same component smaller, or hide it. Nothing here can
    # tell that apart from drift, so it is COUNTED and never failed on. Calling a
    # deliberate difference a fault is how a check gets ignored, and this one has to
    # survive being read once a month for a year.
    # WHICH PAGES CAN STILL DRIFT. A page that embeds the real screen is the real screen, so
    # it is named as settled and left out of the comparison rather than quietly dropped.
    embeds = [m for m in MOCKUPS if embeds_real_screen(m)]
    draws = [m for m in MOCKUPS if m not in embeds]
    sets = {m: rules(m) for m in draws if styles_of(m) is not None}
    disagree = []
    names = list(sets)
    if len(names) == 2:
        a1, b1 = sets[names[0]], sets[names[1]]
        for cls in sorted(set(a1) & set(b1)):
            if a1[cls] != b1[cls]:
                disagree.append(cls)

    if not (changed or never or old or a.force):
        return 0            # deliberately silent. A count of differences is not news.

    print()
    print('%sTHE SALES MOCKUPS%s' % (YEL, OFF))
    if embeds:
        print('%s  settled, cannot drift: %s%s' % (DIM, ', '.join(embeds), OFF))
        print('%s  these embed the real screen, so there is nothing to compare them against.%s' % (DIM, OFF))
    if draws:
        print('%s  still drawn by hand: %s%s' % (DIM, ', '.join(draws), OFF))
        print('%s  nothing links these to the real screens. That is what this watches.%s' % (DIM, OFF))
    else:
        print('%s  every sales page now shows the real screen. This check has nothing left to do.%s' % (DIM, OFF))
    print()
    if never:
        print('  %s--%s  nobody has ever confirmed these match. Look once, then run --accept.' % (YEL, OFF))
    elif changed:
        print('  %sLOOK%s  a real screen has CHANGED since %s (%s -> %s).' % (RED, OFF, when, was, fp))
        if draws:
            print('        open %s beside a real /tv and compare.' % ', '.join('/' + d.split('/')[-1] for d in draws))
        else:
            print('        nothing draws a screen by hand any more, so run --accept.')
    elif old:
        print('  %s--%s  %s days since anyone looked (last on %s). Screens unchanged since.'
              % (YEL, OFF, DAYS, when))
    else:
        print('  %sok%s    no screen has changed since %s.' % (GRN, OFF, when))

    if disagree:
        print()
        print('  %s--%s    the two sets style %d shared class(es) differently. Some of that is'
              % (DIM, OFF, len(disagree)))
        print('        deliberate (the front page hides the join code entirely). Worth a glance')
        print('        while you are in there, not a fault: %s' % ', '.join(disagree[:5]))
    print()
    print('  when they match again:  python3 tools/check-mockups.py --accept')
    return 1 if changed else 0


if __name__ == '__main__':
    sys.exit(main())
