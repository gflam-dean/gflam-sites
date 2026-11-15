#!/usr/bin/env python3
"""A SLIDE THAT SAYS "SCAN TO JOIN" CARRIES THE REAL JOIN QR ON THE WALL (Dean, 12 Nov 2026, INBOX 335.2).

Before 12 Nov the TV showed a QR only on a game's own screens and the set-up card: a venue slide saying "scan to join"
had nothing to scan. A slide saved with qr:true now carries the venue's join QR (/play?venue=<slug>, the printed signs'
address) bottom right, inside the 5% safe box (tools/TV-SAFE-AREA-DECISION.md), while the photo itself stays full-bleed.

This opens the REAL tv.html against the REAL game Worker (tools/browser-rig/rig.py) with a venue whose screen holds two
16:9 slides, the first with qr:true, at 1920x1080 and 1280x720, and on the lit slide measures:
  - the QR slide: the QR box is shown, its square is drawn (dark and light modules), it encodes the venue's address,
    and the whole box sits inside the safe box (5vw left/right, 5vh top/bottom) in the bottom-right quarter
  - the photo under it still covers the window edge to edge (full-bleed kept)
  - the next slide (no qr): no QR anywhere on it
  - no script errors

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> also saves the frames.

    python3 tools/tv-slide-qr-in-chrome.test.py
"""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

LIT = '(function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.style.zIndex==="2";});return a[0]||document.querySelector("#tvAds .ad.show");})()'
MEASURE = ('JSON.stringify((function(){var s=' + LIT + ';if(!s)return {};var q=s.querySelector(".slideqr"),p=s.querySelector(".adimg"),pb=p?p.getBoundingClientRect():null;'
           'var o={w:innerWidth,h:innerHeight,op:+getComputedStyle(s).opacity,pic:pb?[Math.round(pb.left),Math.round(pb.top),Math.round(pb.right),Math.round(pb.bottom)]:null,'
           'img:p?p.style.backgroundImage:"",anyqr:!!s.querySelector(".slideqr")};'
           'if(q){var b=q.getBoundingClientRect(),c=q.querySelector("canvas"),cs=getComputedStyle(q);o.box=[b.left,b.top,b.right,b.bottom];o.vis=cs.display!=="none"&&cs.visibility!=="hidden";'
           'o.words=(q.innerText||"").replace(/\\s+/g," ").trim();o.url=c?c.getAttribute("data-qr-url"):null;'
           'if(c&&c.width){var x=c.getContext("2d").getImageData(0,0,c.width,c.height).data,dk=0,lt=0;for(var i=0;i<x.length;i+=16){var v=x[i]+x[i+1]+x[i+2];if(x[i+3]>200&&v<150)dk++;else if(v>600)lt++;}o.dark=dk;o.light=lt;o.cw=c.width;}'
           'var cb=c?c.getBoundingClientRect():null;o.cbox=cb?[cb.width,cb.height]:null;}'
           'return o;})())')

# When the QR slide never lights, say why: the picture loads the TV counted as failed, and every slide in the rotation.
WHY = ('JSON.stringify({imgErrors:window.__vpTvImgErrors||0, ads:[].map.call(document.querySelectorAll("#tvAds .ad"),function(a){'
       'var p=a.querySelector(".adimg");return (p?p.style.backgroundImage:"").split("/").pop().slice(0,32)+(a.querySelector(".slideqr")?" +qr":"");})})')

def lit_then_measure(r, sid, lit, photo, settle, secs):
    """Wait for the slide to be lit, let it settle, measure it. A SLIDE THAT HAS MOVED ON IS NOT A FAIL (16 Nov 2026): on a
    loaded test server the wait could first see the slide at the end of its 6 s turn, and `settle` seconds later the
    measure read the NEXT slide (tugun-friday, no QR): red twice, green on every rerun. So when the lit slide is no longer
    the photo waited for, its next turn is waited for, inside the same deadline. A slide that IS that photo is judged as
    it is, so a QR missing from the QR slide is still red at once."""
    end = time.time() + secs
    while True:
        got = r.until(sid, lit, max(1, end - time.time()))
        time.sleep(settle)
        m = r.json(sid, MEASURE, {})
        if got is not True or photo in (m.get('img') or '') or time.time() > end:
            return m, got
        print('  ..   the lit slide moved on before it was measured (%s); waiting for its next turn' % (m.get('img') or '')[-40:])


def inside_safe(m):
    b = m.get('box') or [0, 0, 0, 0]
    sx, sy = 0.05 * m['w'], 0.05 * m['h']
    return b[0] >= sx - 0.5 and b[1] >= sy - 0.5 and b[2] <= m['w'] - sx + 0.5 and b[3] <= m['h'] - sy + 0.5

def run():
    import rig as RIG
    r = RIG.Rig(real_qr=True)   # the real QR library, so the square is really drawn (the rig's stand-in draws nothing)
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        A = r.base + '/logos/ad-slides/tugun-tuesday.jpg'
        slides = [{'image_url': A, 'seconds': 6, 'qr': True},
                  {'image_url': r.base + '/logos/ad-slides/tugun-friday.jpg', 'seconds': 6}]
        r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': None, 'raffle': None, 'slides': slides}], replace=True)
        for (W, H) in ((1920, 1080), (1280, 720)):
            tag = '%dx%d' % (W, H)
            tid, sid = r.open('/tv?venue=' + slug, width=W, height=H)
            m, got = lit_then_measure(r, sid, '(function(){var s=' + LIT + ';return !!s && !!s.querySelector(".slideqr") && +getComputedStyle(s).opacity>0.99;})()', 'tugun-tuesday', 1.0, 70)
            if got is not True: m['why'] = r.json(sid, WHY, {})
            ok('%s: the "scan to join" slide comes up with its QR box shown' % tag, got is True and m.get('vis') is True and m.get('op', 0) > 0.99, m)
            ok('%s: the QR is drawn at 240 (dark and light modules on its canvas, not a blank square)' % tag, m.get('cw') == 240 and (m.get('dark') or 0) > 200 and (m.get('light') or 0) > 200, {k: m.get(k) for k in ('dark', 'light', 'cw', 'cbox')})
            ok('%s: it encodes the venue\'s own join address, /play?venue=%s' % (tag, slug), (m.get('url') or '').endswith('/play?venue=' + slug), m.get('url'))
            ok('%s: it says what to do: SCAN TO JOIN' % tag, (m.get('words') or '').upper() == 'SCAN TO JOIN', m.get('words'))
            ok('%s: the whole QR box sits inside the 5%% safe box' % tag, inside_safe(m), [m.get('box'), m.get('w'), m.get('h')])
            b = m.get('box') or [0, 0, 0, 0]
            ok('%s: in the bottom-right corner, within 6%% of the safe box\'s corner' % tag,
               b[0] > m['w'] / 2 and b[1] > m['h'] / 2 and (m['w'] - 0.05 * m['w']) - b[2] <= 0.06 * m['w'] and (m['h'] - 0.05 * m['h']) - b[3] <= 0.06 * m['w'], [b, m['w'], m['h']])
            cb = m.get('cbox') or [0, 0]
            ok('%s: big enough to scan from a table (the square at least 56px and 6%% of the screen height)' % tag, cb[0] >= 56 and cb[1] >= 0.06 * H, cb)
            ok('%s: the photo under it is still full-bleed (window edge to edge)' % tag, m.get('pic') == [0, 0, W, H], m.get('pic'))
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-slide-qr-%d.jpg' % W))
            # the next slide carries no qr: no QR on it
            m2, _ = lit_then_measure(r, sid, '(function(){var s=' + LIT + ';return !!s && !s.querySelector(".slideqr") && +getComputedStyle(s).opacity>0.99;})()', 'tugun-friday', 0.6, 20)
            ok('%s: the next slide (no qr) has no QR on it' % tag, m2.get('anyqr') is False and 'tugun-friday' in (m2.get('img') or ''), m2)
            GONE = '[].filter.call(document.querySelectorAll(".slideqr"),function(q){var a=q.closest(".ad");return a&&+getComputedStyle(a).opacity>0.05;}).length'
            r.until(sid, '(%s)===0' % GONE, 5)   # the 0.8 s cross-fade
            vis = r.ask(sid, GONE)
            ok('%s: and the QR slide\'s box has gone with its slide (nothing left on the wall)' % tag, vis == 0, vis)
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-slide-noqr-%d.jpg' % W))
            ok('%s: no script errors on the TV' % tag, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()

def main():
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('tv-slide-qr-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    print('\nTV: a slide saved with qr:true carries the venue\'s join QR, inside the safe box')
    run()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
