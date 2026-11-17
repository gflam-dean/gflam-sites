#!/usr/bin/env python3
"""THE PERSONAL TV-SLIDE PAGE, venueplay.com.au/look/<code>, IN A REAL BROWSER (build job 7; Tue 24 Nov 2026 release).

venueplay-backend/app/look-page.test.js runs the page's logic in jsc. This opens the REAL venueplay/look.html in headless
Chrome (tools/browser-rig/admin_site.py, its own profile, removed on close; the billing Worker is the rig's, never the
live one) at 375 x 812 and 390 x 844 (phones) and 1440 x 900 (a laptop), and checks what a prospect SEES:

  slides   a venue with good photos: "Your TV, your slides", their name, the first slide showing whole, Back / Next
           move it, the offer card, and a Play a quick game button that opens /quick
  demo     a venue whose website photos were poor: the real screen's demo (/tv?demo=1&ads=1), never their slides
  missing  a code with no page: "This link isn't working" and Play a quick game
and on every one: nothing scrolls sideways, no text under 15px (Dean's floor for this page), no script error, and no
link to the old /see-a-night page.

The test's own look-data folder (venueplay/look-data/<test code>/) is written for the run and removed after it; its
slides are plain pictures made here (no image library needed). --shots DIR saves one PNG per page and width.
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait). Touches no git and no remote.

    python3 tools/look-page-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, shutil, struct, sys, time, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import admin_site  # noqa: E402
import gatelib     # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


def slide_png(n):
    """A 1920 x 1080 picture: a dark ground, a pink band and a block that moves with n (served as NN.jpg; Chrome
    reads the picture by its bytes)."""
    w, h = 1920, 1080
    rows = []
    for y in range(h):
        band = 380 <= y < 700
        r = bytearray()
        for x in range(0, w, 64):
            if band and 200 + n * 300 <= x < 700 + n * 300:
                px = b'\xff\xff\xff'
            elif band:
                px = b'\xff\x1f\x8e'
            else:
                px = bytes((10 + n * 8, 10, 11 + x * 30 // w))
            r += px * 64
        rows.append(b'\x00' + bytes(r))
    raw = zlib.compress(b''.join(rows), 6)

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')


GOOD = 'LookTestGood0123456789ab'      # 24 URL-safe characters: the shape look-publish.py makes
POOR = 'LookTestPoor0123456789ab'
GONE = 'LookTestGone0123456789ab'      # no folder: the link is not working
DATA = os.path.join(ROOT, 'venueplay', 'look-data')
made = []
for code, manifest in (
        (GOOD, {'v': 1, 'venue': 'The Test Charlie Hotel', 'mode': 'slides', 'offer': 'dec',
                'slides': [{'file': '%02d.jpg' % i, 'head': 'Slide %d' % i, 'photo': True} for i in (1, 2, 3)]}),
        (POOR, {'v': 1, 'venue': 'Poor Photos Arms', 'mode': 'slides', 'offer': 'dec',
                'slides': [{'file': '%02d.jpg' % i, 'head': 'Slide %d' % i, 'photo': i == 1} for i in (1, 2, 3)]})):
    d = os.path.join(DATA, code)
    os.makedirs(d, exist_ok=True)
    made.append(d)
    json.dump(manifest, open(os.path.join(d, 'look.json'), 'w'))
    for i in (1, 2, 3):
        open(os.path.join(d, '%02d.jpg' % i), 'wb').write(slide_png(i))

SEEN = r'''(function(){
  var vis=function(id){var e=document.getElementById(id);return !!e && !e.hidden && e.getBoundingClientRect().height>0;};
  var small=[];
  document.querySelectorAll('body *').forEach(function(e){
    if(e.closest('[hidden]')||e.closest('#lkDemoBox')) return;
    var t=''; e.childNodes.forEach(function(n){ if(n.nodeType===3) t+=n.textContent; });
    if(!t.trim()) return;
    var r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    var fs=parseFloat(getComputedStyle(e).fontSize); if(fs<15) small.push(e.tagName+' '+fs+'px "'+t.trim().slice(0,30)+'"');
  });
  var on=document.querySelector('#lkShow img.on');
  var quick=[].slice.call(document.querySelectorAll('a')).filter(function(a){return !a.closest('[hidden]') && a.getAttribute('href')==='/quick?from=look' && a.getBoundingClientRect().height>0;});
  var h1=[].slice.call(document.querySelectorAll('h1')).filter(function(h){return !h.closest('[hidden]');}).map(function(h){return h.textContent;});
  var f=document.querySelector('#lkDemoBox iframe');
  return JSON.stringify({h1:h1, vw:innerWidth, sw:document.documentElement.scrollWidth, small:small,
    slides:vis('lkSlides'), demo:vis('lkDemo'), missing:vis('lkMissing'), offer:vis('lkOffer'), standard:vis('lkStandard'),
    venue:(document.querySelector('.lkVenue')||{}).textContent||'', title:document.title,
    img:on?{src:on.getAttribute('src'),nw:on.naturalWidth,nh:on.naturalHeight,w:on.getBoundingClientRect().width,r:on.getBoundingClientRect().right}:null,
    count:(document.getElementById('lkCount')||{}).textContent||'',
    quick:quick.map(function(a){var r=a.getBoundingClientRect();return {t:a.textContent.trim(),h:r.height,r:r.right};}),
    iframe:f?f.getAttribute('src'):null, old:document.documentElement.innerHTML.indexOf('href="/see-a-night')>=0,
    errs:(window.__errs||[])});
})()'''

_end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
while True:
    _st, _pid, _text = gatelib.lock_state()
    if _st in ('free', 'mine') and gatelib.hold_lock_or_refuse('look-page-in-chrome', wait_s=0):
        break
    if time.time() > _end:
        print('  heavy lock held by pid %s ("%s"); gave up waiting' % (_pid, _text[:80]))
        sys.exit(2)
    time.sleep(0.5)

S = admin_site.Site(fonts=True)
S.W.env(FOUNDING_CODES='OFFER-DEC-2026')   # the rig's billing Worker says the December code is open, as live will in December
try:
    for w, hgt, phone in ((375, 812, True), (390, 844, True), (1440, 900, False)):
        for case, code in (('slides', GOOD), ('demo', POOR), ('missing', GONE)):
            tid, sid = S.open('/look.html?c=' + code, w, hgt, mobile=phone)
            S.until(sid, 'document.readyState==="complete" && document.getElementById("lkLoading").hidden===true', 20)
            S.js(sid, 'document.fonts ? document.fonts.ready.then(function(){return 1;}) : 1', wait=True, secs=20)
            if case == 'slides':
                S.until(sid, '(function(){var i=document.querySelector("#lkShow img.on");return !!i && i.complete && i.naturalWidth>0;})()', 20)
            time.sleep(0.6)
            M = S.json(sid, SEEN, default={}) or {}
            tag = '%s at %d px' % (case, w)
            ok('%s: nothing scrolls sideways, no text under 15px, no script error, no link to /see-a-night' % tag,
               M.get('sw', 9e9) <= M.get('vw', 0) and not M.get('small') and not M.get('errs') and not M.get('old'),
               [M.get('sw'), M.get('vw'), (M.get('small') or [])[:4], M.get('errs'), M.get('old')])
            q = M.get('quick') or []
            ok('%s: a Play a quick game button to /quick?from=look, inside the page and big enough to tap' % tag,
               any(b['t'] == 'Play a quick game' and b['h'] >= 44 and b['r'] <= M.get('vw', 0) for b in q), q)
            if case == 'slides':
                img = M.get('img') or {}
                ok('%s: "Your TV, your slides" for The Test Charlie Hotel, the first slide showing whole, "1 of 3"' % tag,
                   M.get('h1') == ['Your TV, your slides'] and M.get('venue') == 'The Test Charlie Hotel' and M.get('slides') and not M.get('demo')
                   and img.get('nw') == 1920 and img.get('nh') == 1080 and img.get('r', 9e9) <= M.get('vw', 0) and M.get('count') == '1 of 3'
                   and M.get('title') == 'The Test Charlie Hotel on venueplay', [M.get('h1'), M.get('venue'), img, M.get('count'), M.get('title')])
                ok('%s: the offer card shows (the December row is still open), not the standard one' % tag, M.get('offer') and not M.get('standard'),
                   [M.get('offer'), M.get('standard')])
            elif case == 'demo':
                ok('%s: poor photos: the real screen\'s demo (/tv?demo=1&ads=1), never their slides' % tag,
                   M.get('demo') and not M.get('slides') and M.get('iframe') == '/tv.html?demo=1&ads=1' and M.get('venue') == 'Poor Photos Arms',
                   [M.get('demo'), M.get('slides'), M.get('iframe'), M.get('venue')])
            else:
                ok('%s: "This link isn\'t working", nothing else' % tag, M.get('missing') and not M.get('slides') and not M.get('demo')
                   and M.get('h1') == ["This link isn't working"], [M.get('h1'), M.get('missing')])
            if A.shots:
                os.makedirs(A.shots, exist_ok=True)
                S.shot(sid, os.path.join(A.shots, 'look-%s-%d.png' % (case, w)), full=True)
            if case == 'slides' and w == 390:
                S.js(sid, 'document.getElementById("lkNext").click();true')
                time.sleep(0.5)
                n = S.json(sid, 'JSON.stringify({c:document.getElementById("lkCount").textContent,s:document.querySelector("#lkShow img.on").getAttribute("src")})', default={}) or {}
                ok('slides at 390 px: Next shows slide 2 of 3', n.get('c') == '2 of 3' and n.get('s', '').endswith('/02.jpg'), n)
                S.js(sid, 'document.getElementById("lkNight").click();true')
                S.until(sid, 'location.pathname==="/quick"', 15)
                where = S.js(sid, 'location.pathname+location.search')
                ok('slides at 390 px: tapping Play a quick game opens /quick?from=look', where == '/quick?from=look', where)
            S.close_tab(tid)
finally:
    S.close()
    for d in made:
        shutil.rmtree(d, ignore_errors=True)
    try:
        os.rmdir(DATA)
    except OSError:
        pass

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 32
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
