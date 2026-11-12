#!/usr/bin/env python3
"""EVERY TV SLIDE FILLS THE SCREEN (Dean, 9 Nov 2026: "Why would I want slides with a black border?").

The venue's slides were drawn at 82% of the wall inside a black border. /app/vp-fit.js shrinks a layer so nothing sits
under a keep-out corner (the venue's logo, top left), and it remembered the last transform in a map keyed by the
layer's id. The TV's slides have no id, so they all shared one entry: a slide shrunk once (while the corner logo was
up) was judged "already right" later and kept its 82% long after the logo had gone. Two fixes, each checked here:
  - tv.html: every slide is fitted to the screen only (data-fit-self). The corner logo, when it shows, sits ON TOP.
  - vp-fit.js: the last transform is kept on the layer itself, so a layer with no id is never judged by another's.

This opens the REAL tv.html against the REAL game Worker (tools/browser-rig/rig.py) with a venue whose screen holds two
16:9 slides, with and without a venue logo, at 1920x1080 and 1280x720, and measures the slide on the wall:
  - the lit slide is not scaled and its picture covers the whole screen, edge to edge
  - with the corner logo forced up over a slide (the overlay case), the slide still fills the screen
  - vp-fit on two id-less layers: one shrunk round a keep-out comes back to full size once the keep-out is gone

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> also saves the frames.

    python3 tools/tv-slides-fill-in-chrome.test.py

TV SAFE AREA RE-PIN (12 Nov 2026, Dean via main INBOX 321.2; tools/TV-SAFE-AREA-DECISION.md): on a TV the venue
logo or name, boards, words, QR and the venueplay mark sit inside a 5% safe box (54px top and bottom, 96px left
and right at 1920x1080, scaling with the window), and sizes are measured against the SAFE BOX (the .tv wall), not
the window. Photo slides and full-screen backgrounds stay full-bleed. This suite's layout pins were re-pinned to
the safe box that day (each one listed in ~/venue-enrich/reports/tv-safe-area-12nov/REPINS.md); every other check
is unchanged.
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
# The lit slide: its transform, its box and its picture's box, against the window.
MEASURE = ('JSON.stringify((function(){var s=' + LIT + ';if(!s)return {};var b=s.getBoundingClientRect(),p=s.querySelector(".adimg"),q=p?p.getBoundingClientRect():null;'
           'return {cls:s.className,tf:getComputedStyle(s).transform,l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),bt:Math.round(b.bottom),'
           'pic:q?[Math.round(q.left),Math.round(q.top),Math.round(q.right),Math.round(q.bottom)]:null,w:innerWidth,h:innerHeight};})())')

def fills(m):
    return (m.get('tf') in ('none', 'matrix(1, 0, 0, 1, 0, 0)') and m.get('l') == 0 and m.get('t') == 0
            and m.get('r') == m.get('w') and m.get('bt') == m.get('h') and m.get('pic') == [0, 0, m.get('w'), m.get('h')])

def run():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        slides = [{'image_url': r.base + '/logos/ad-slides/tugun-tuesday.jpg', 'seconds': 6},
                  {'image_url': r.base + '/logos/ad-slides/tugun-friday.jpg', 'seconds': 6}]
        for logo in (None, r.base + '/logos/venue-tugun-bowls.png'):
            label = 'with a corner logo' if logo else 'no logo'
            r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': logo, 'raffle': None, 'slides': slides}], replace=True)
            for (W, H) in ((1920, 1080), (1280, 720)):
                tid, sid = r.open('/tv?venue=' + slug, width=W, height=H)
                got = r.until(sid, '(function(){var s=' + LIT + ',c=window.__vpAdClock;return !!s && !!s.querySelector(".adimg") && +getComputedStyle(s).opacity>0.99 && (!c || c.slot().left>3000);})()', 70)
                time.sleep(1.8)   # vp-fit's 1.5 s tick
                m = r.json(sid, MEASURE, {})
                ok('%s %dx%d: the slide on the wall is not shrunk; its picture covers the screen edge to edge' % (label, W, H), got is True and fills(m), m)
                if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-slide-%s-%d.jpg' % ('logo' if logo else 'nologo', W)))
                # The next slide too, after the hand-over (the shared entry used to catch the second one).
                first = m.get('cls', '')
                r.until(sid, '(function(){var s=' + LIT + ';return !!s && s.className!==%s && +getComputedStyle(s).opacity>0.99;})()' % repr(first).replace("'", '"'), 20)
                time.sleep(1.8)
                m2 = r.json(sid, MEASURE, {})
                ok('%s %dx%d: the next slide fills the screen as well' % (label, W, H), fills(m2), m2)
                if logo:
                    # The overlay case: the corner logo up over a slide. It sits on top; the slide does not move.
                    r.ask(sid, '(function(){var l=document.getElementById("venueLogo");if(!l)return false;l.style.display="block";l.style.opacity="1";VP_FIT();return true;})()')
                    time.sleep(1.0)
                    m3 = r.json(sid, MEASURE, {})
                    lg = r.json(sid, 'JSON.stringify((function(){var l=document.getElementById("venueLogo"),b=l.getBoundingClientRect();return {w:Math.round(b.width),z:getComputedStyle(l).zIndex};})())', {})
                    ok('%s %dx%d: with the corner logo showing, it sits on top and the slide still fills the screen' % (label, W, H), fills(m3) and lg.get('w', 0) > 20, [m3, lg])
                ok('%s %dx%d: no script errors on the TV' % (label, W, H), r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
                r.close_tab(tid)

        # vp-fit itself: two id-less layers, one under a keep-out. Once the keep-out goes, it is full size again.
        tid, sid = r.open('/tv?venue=' + slug, width=1280, height=720)
        r.until(sid, 'typeof VP_FIT==="function"', 20)
        r.ask(sid, '(function(){var tv=document.querySelector(".tv")||document.body;'
                   'function L(top){var d=document.createElement("div");d.className="layer vpfit-probe";d.style.cssText="position:fixed;inset:0;z-index:1;pointer-events:none";'
                   'var k=document.createElement("div");k.style.cssText="position:absolute;left:0;width:100%;height:120px;top:"+top+"px;background:#222";d.appendChild(k);tv.appendChild(d);return d;}'
                   'window.__pA=L(0);window.__pB=L(560);var z=document.createElement("div");z.id="vpfitProbeAvoid";z.setAttribute("data-fit-avoid","");'
                   'z.style.cssText="position:fixed;left:0;top:0;width:200px;height:90px;z-index:99";document.body.appendChild(z);VP_FIT();return true;})()')
        time.sleep(0.8)
        a1 = r.ask(sid, 'getComputedStyle(window.__pA).transform')
        r.ask(sid, '(function(){document.getElementById("vpfitProbeAvoid").remove();VP_FIT();return true;})()')
        time.sleep(0.8)
        r.ask(sid, 'VP_FIT(); true'); time.sleep(0.8)
        a2 = r.ask(sid, 'getComputedStyle(window.__pA).transform')
        ok('vp-fit: a layer with no id shrunk round a keep-out is full size again once the keep-out has gone (not judged by another layer)',
           # TV SAFE AREA RE-PIN (12 Nov 2026): the probe layer is the whole window, so "full size" is now the fit to the SAFE
           # BOX with no shift: scale 0.9 (or none), never the keep-out's shift or shrink. Was: no transform at all.
           a1 not in ('none', None) and a2 != a1 and a2 in ('none', 'matrix(1, 0, 0, 1, 0, 0)', 'matrix(0.9, 0, 0, 0.9, 0, 0)'), [a1, a2])
        r.close_tab(tid)
    finally:
        r.close()

def main():
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('tv-slides-fill-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    print('\nTV: every slide fills the screen, with and without the venue\'s corner logo')
    run()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
