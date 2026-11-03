#!/usr/bin/env python3
"""THE LINK PREVIEW (og:image) LEADS WITH TRIVIA, NEVER BINGO (Dean, 3 Nov 2026).

A Facebook link preview of venueplay.com.au showed the old share card, "BINGO / TRIVIA / MUSICAL BINGO /
RAFFLES / JAG THE JOKER / MORE": bingo first breaks the game order rule (trivia, musical bingo, bingo,
then raffles; Dean, 2 Nov 2026). The card is now built from the v3.2 logo kit by tools/build-share-card.py
(the horizontal on-dark wordmark over the kit's lowercase two-line games line, both placed as files, never
retyped), and the preview words that sit under it put trivia first too.

What a link preview reads is the page's raw HTML (Facebook runs no script), so this fetches each page that
carries a share card from the local site exactly as served, then loads the card itself in headless Chrome:
  every page: og:image and twitter:image name the same card on venueplay.com.au (versioned, so Facebook
             fetches the new one), og:image:width and :height say 1200 x 630, and the picture Chrome loads
             from that path really is 1200 x 630 on the brand's near-black
  the card:  pixel for pixel the card tools/build-share-card.py builds from the logo kit today (so the old
             BINGO-first card, or any hand-made card, is red); the kit must be on this machine
  the words: og:title, og:description, twitter:title/description, the page title and meta description name
             trivia before bingo wherever they name both
Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/share-card-in-chrome.test.py
"""
import hashlib, html.parser, io, os, re, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

PAGES = ['/', '/nsw', '/see-a-night', '/help', '/live-here-now']
CARD_PATH = '/logos/venueplay-share.png'
CARD_URL = re.compile(r'^https://venueplay\.com\.au/logos/venueplay-share\.png\?v=\d{8}$')
KIT = os.environ.get('VP_LOGO_KIT', os.path.expanduser('~/venue-enrich/logo-kit-1nov'))
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond:
        bad += 1


class Head(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta, self.title, self._t = {}, '', False
    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == 'meta':
            k = a.get('property') or a.get('name')
            if k and k not in self.meta:
                self.meta[k] = a.get('content') or ''
        if tag == 'title':
            self._t = True
    def handle_endtag(self, tag):
        if tag == 'title':
            self._t = False
    def handle_data(self, d):
        if self._t:
            self.title += d


def trivia_first(text):
    """True unless the text names bingo (number bingo, not musical bingo) before it names trivia."""
    t = text.lower()
    tri = t.find('trivia')
    m = re.search(r'(?<!musical )\bbingo\b', t)
    if tri < 0 or not m:
        return True
    return tri < m.start()


def kit_card():
    """The card build-share-card.py makes from the kit right now, as PNG bytes, written nowhere."""
    src = io.open(os.path.join(HERE, 'build-share-card.py'), encoding='utf-8').read()
    buf = io.BytesIO()
    src = src.replace("card.convert('RGB').save(OUT, optimize=True)", "card.convert('RGB').save(_BUF, format='PNG', optimize=True)")
    src = src.replace("print('wrote', os.path.normpath(OUT), card.size)", "")
    g = {'__name__': 'bsc', '__file__': os.path.join(HERE, 'build-share-card.py'), '_BUF': buf}
    sys_argv = sys.argv
    try:
        sys.argv = ['build-share-card.py', KIT]
        exec(compile(src, 'build-share-card.py', 'exec'), g)
    finally:
        sys.argv = sys_argv
    return buf.getvalue()


def pixels(png):
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert('RGB')
    return im.size, hashlib.sha256(im.tobytes()).hexdigest()


def main():
    if not gatelib.hold_lock_or_refuse('share-card-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        return 2
    import rig
    r = rig.Rig()
    try:
        cards = set()
        for p in PAGES:
            raw = urllib.request.urlopen(r.base + p, timeout=20).read().decode('utf-8')
            h = Head(); h.feed(raw)
            m = h.meta
            tag = 'the share card on %s' % p
            ok(tag + ': og:image is the versioned venueplay.com.au card', bool(CARD_URL.match(m.get('og:image', ''))), m.get('og:image'))
            ok(tag + ': twitter:image is the same card', m.get('twitter:image') == m.get('og:image'), [m.get('twitter:image'), m.get('og:image')])
            ok(tag + ': og:image:width and :height say 1200 x 630', m.get('og:image:width') == '1200' and m.get('og:image:height') == '630', [m.get('og:image:width'), m.get('og:image:height')])
            ok(tag + ': a large-image preview', m.get('twitter:card') == 'summary_large_image', m.get('twitter:card'))
            cards.add(m.get('og:image', ''))
            words = [('title', h.title)] + [(k, m.get(k, '')) for k in ('description', 'og:title', 'og:description', 'twitter:title', 'twitter:description')]
            wrong = [(k, v) for k, v in words if v and not trivia_first(v)]
            ok(tag + ': the preview words name trivia before bingo', not wrong, wrong)
        ok('every page names one and the same share card', len(cards) == 1, cards)

        # The picture as Chrome loads it from the path the pages name
        tid, sid = r.open('/__blank')
        r.B.call('Page.navigate', {'url': r.base + CARD_PATH}, session=sid)
        dims = r.until(sid, '(function(i){ return i && i.complete && i.naturalWidth ? [i.naturalWidth, i.naturalHeight] : null; })(document.images[0])', 20)
        ok('the share card loads at 1200 x 630', dims == [1200, 630], dims)
        corner = r.ask(sid, '(function(i){ var c=document.createElement("canvas"); c.width=1200; c.height=630; var x=c.getContext("2d"); x.drawImage(i,0,0); var d=x.getImageData(4,4,1,1).data; return [d[0],d[1],d[2]]; })(document.images[0])')
        ok('the share card is on the brand\'s near-black (#0A0A0B)', isinstance(corner, list) and all(abs(a - b) <= 2 for a, b in zip(corner, (10, 10, 11))), corner)
        r.close_tab(tid)

        served = urllib.request.urlopen(r.base + CARD_PATH, timeout=20).read()
        have_kit = os.path.isfile(os.path.join(KIT, 'games-line', 'games-2-lines-lowercase-white.png')) and os.path.isfile(os.path.join(KIT, 'png', 'venueplay-horizontal-on-dark.png'))
        ok('the v3.2 logo kit is on this machine to build the card from (%s)' % KIT, have_kit)
        if have_kit:
            want = pixels(kit_card()); got = pixels(served)
            ok('the share card is the one built from the logo kit (trivia first), pixel for pixel', want == got, [want, got])
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
