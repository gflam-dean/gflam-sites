#!/usr/bin/env python3
"""THE HOMEPAGE "VENUES ALREADY RUNNING venueplay" HEADING USES THE LOGO FILE (Dean, 11 Nov 2026, INBOX 231.1).

Dean: the "venueplay" in that heading must be the logo kit's wordmark file, never typed text (brand rule:
never typed text for the logo), the heading and strip dropped down a little, and no "Trusted by" eyebrow
over it. The venues in the strip stay as they are.

Opens the REAL venueplay/index.html and venueplay/nsw.html in headless Chrome (tools/browser-rig/admin_site.py,
its own profile, removed on close) with the real fonts, paints the strip through the page's own
VPTrusted.render (eight made-up venues, so no network), and at 375, 390, 768, 1024 and 1440:
  - the heading's "venueplay" is an <img> of /logos/venueplay-primary.svg that loaded, alt "venueplay",
    and the heading has no typed "venueplay" (its words are exactly "Venues already running")
  - no "Trusted by" label in the section
  - the wordmark's baseline (829 of the file's 1136 units down) sits on the heading's baseline (2px),
    and its height is 1.0 to 1.2 times the heading's font size
  - the line the wordmark is on is centred on the page (3px); nothing scrolls sideways
  - the heading starts at least 20px (phone) / 30px (wider) further down than the section's padding alone
  - the strip still paints its eight logos at 64px high

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait). Touches no git and no remote.

    python3 tools/home-trusted-heading-in-chrome.test.py [--shots DIR] [--rows FILE.json]
    (--rows: a {"logos": [...]} answer to paint instead of the made-up venues, for pictures)
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
ap.add_argument('--rows')
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


ROWS = [{'name': 'Venue %d' % i, 'logo_url': 'https://venueplay.invalid/logo-%d.png' % i} for i in range(8)]
if A.rows:
    ROWS = json.load(open(A.rows)).get('logos', [])

PAINT = r'''(function(rows){
  var s=document.getElementById('trusted'), t=document.getElementById('trustedTrack');
  return window.VPTrusted ? VPTrusted.render(rows, s, t) : -1;
})(%s)''' % json.dumps(ROWS)

MEASURE = r'''(function(){
  function R(el){ if(!el) return null; var r=el.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; }
  var sec=document.getElementById('trusted'), h=sec&&sec.querySelector('h2'), img=h&&h.querySelector('img');
  var out={vw:innerWidth, sw:document.documentElement.scrollWidth, fonts:document.fonts?document.fonts.status:''};
  if(!h) return JSON.stringify(out);
  out.words=h.textContent.replace(/\s+/g,' ').trim();
  out.labels=sec.querySelectorAll('.label').length;
  out.trustedText=/trusted by/i.test(sec.textContent);
  out.fs=parseFloat(getComputedStyle(h).fontSize);
  if(img){ out.img={src:img.getAttribute('src'), alt:img.getAttribute('alt'), done:img.complete&&img.naturalWidth>0, box:R(img)}; }
  // the heading's baseline on the wordmark's line: a zero-size inline-block just after it sits on it
  if(img){ var z=document.createElement('span'); z.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
    img.parentNode.insertBefore(z,img.nextSibling); out.base=z.getBoundingClientRect().top; z.remove(); }
  // the visual line the wordmark is on: every text rect sharing its middle, plus the image
  if(img){ var ib=img.getBoundingClientRect(), mid=(ib.top+ib.bottom)/2, l=ib.left, r=ib.right;
    var rg=document.createRange(); rg.selectNodeContents(h);
    [].forEach.call(rg.getClientRects(), function(q){ if(q.width && q.top<mid && q.bottom>mid){ l=Math.min(l,q.left); r=Math.max(r,q.right);} });
    out.line={l:l,r:r}; }
  var head=sec.querySelector('.sec-head'); out.head=R(head); out.sec=R(sec);
  out.padTop=parseFloat(getComputedStyle(sec).paddingTop); out.headMt=parseFloat(getComputedStyle(head).marginTop);
  out.logos=[].map.call(document.querySelectorAll('#trustedTrack .trustedlogo'), function(e){return Math.round(e.getBoundingClientRect().height);});
  return JSON.stringify(out);
})()'''

sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib  # noqa: E402
_end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
while True:
    _st, _pid, _text = gatelib.lock_state()
    if _st in ('free', 'mine') and gatelib.hold_lock_or_refuse('home-trusted-heading-in-chrome', wait_s=0):
        break
    if time.time() > _end:
        print('  heavy lock held by pid %s ("%s"); gave up waiting' % (_pid, _text[:80]))
        sys.exit(2)
    time.sleep(0.5)

S = admin_site.Site(fonts=True)
try:
    for page in ('/index.html', '/nsw.html'):
        widths = ((375, 812, True), (390, 844, True), (768, 1024, False), (1024, 768, False), (1440, 900, False))
        if page != '/index.html':
            widths = ((375, 812, True), (1440, 900, False))
        for w, hgt, phone in widths:
            tid, sid = S.open(page, w, hgt, mobile=phone)
            S.until(sid, 'document.readyState==="complete" && !!window.VPTrusted', 20)
            S.js(sid, 'document.fonts ? document.fonts.ready.then(function(){return 1;}) : 1', wait=True, secs=20)
            shown = S.js(sid, PAINT)
            S.until(sid, '(function(){var i=document.querySelector("#trusted h2 img");return !!(i&&i.complete);})()', 10)
            time.sleep(0.6)
            S.js(sid, 'document.getElementById("trusted").scrollIntoView({block:"start"});scrollBy(0,-40);true')
            time.sleep(0.4)
            M = S.json(sid, MEASURE, default={}) or {}
            tag = '%s %d px' % (page.strip('/'), w)
            img = M.get('img') or {}
            box = img.get('box') or {}
            ok('%s: the strip is painted (%s logos) and the page does not scroll sideways' % (tag, len(ROWS)),
               shown == len(ROWS) and M.get('sw', 9999) <= M.get('vw', 0), [shown, M.get('sw'), M.get('vw')])
            ok('%s: the heading\'s "venueplay" is the logo file /logos/venueplay-primary.svg, loaded, alt "venueplay"' % tag,
               img.get('src') == '/logos/venueplay-primary.svg' and img.get('alt') == 'venueplay' and img.get('done'), img)
            ok('%s: no typed "venueplay" in the heading (its words are "Venues already running") and no "Trusted by" label' % tag,
               M.get('words') == 'Venues already running' and M.get('labels') == 0 and not M.get('trustedText'),
               [M.get('words'), M.get('labels'), M.get('trustedText')])
            fs = M.get('fs') or 0
            if box and 'base' in M:
                logo_base = box['t'] + box['h'] * 829.0 / 1136.0
                ok('%s: the wordmark sits on the heading\'s baseline (within 2px) at 1.0 to 1.2 times its font size' % tag,
                   abs(logo_base - M['base']) <= 2 and fs and 1.0 <= box['h'] / fs <= 1.2,
                   [round(logo_base, 1), M.get('base'), round(box['h'] / fs, 3) if fs else fs])
            else:
                ok('%s: the wordmark sits on the heading\'s baseline' % tag, False, M)
            ln = M.get('line') or {}
            ok('%s: the wordmark\'s line is centred on the page (within 3px)' % tag,
               ln and abs((ln['l'] + ln['r']) / 2.0 - M['vw'] / 2.0) <= 3, [ln, M.get('vw')])
            gap = ((M.get('head') or {}).get('t', 0) - (M.get('sec') or {}).get('t', 0)) - (M.get('padTop') or 0)
            ok('%s: the heading sits lower than the section padding alone (at least %dpx more)' % (tag, 20 if phone else 30),
               gap >= (20 if phone else 30) and M.get('headMt', 0) >= (20 if phone else 30), [gap, M.get('headMt')])
            ok('%s: the strip\'s logos are unchanged, 64px high' % tag,
               len(M.get('logos') or []) >= len(ROWS) and all(x == 64 for x in M['logos']), M.get('logos'))
            if A.shots:
                os.makedirs(A.shots, exist_ok=True)
                # the strip's logos load lazily: bring the section on screen (no smooth scroll) and wait for them
                S.js(sid, 'document.documentElement.style.scrollBehavior="auto";'
                          'scrollTo(0,document.getElementById("trusted").getBoundingClientRect().top+scrollY-120);true')
                S.until(sid, '[].every.call(document.querySelectorAll("#trustedTrack img"),function(i){return i.complete&&i.naturalWidth>0;})', 30)
                time.sleep(0.5)
                # the section and what is just above it, in page coordinates (the page may scroll itself)
                c = S.json(sid, '(function(){var r=document.getElementById("trusted").getBoundingClientRect();'
                                'return {y:r.top+scrollY, h:r.height, w:innerWidth};})()', default={}) or {}
                import base64
                shot = S.B.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True,
                                'clip': {'x': 0, 'y': max(0, c.get('y', 0) - 120), 'width': c.get('w', w),
                                         'height': c.get('h', 600) + 200, 'scale': 1}}, session=sid)
                with open(os.path.join(A.shots, 'trusted-%s-%d.png' % (page.strip('/').replace('.html', ''), w)), 'wb') as f:
                    f.write(base64.b64decode(shot['data']))
            S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 49
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
