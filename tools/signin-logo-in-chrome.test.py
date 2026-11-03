#!/usr/bin/env python3
"""THE SIGN-IN PAGE'S LOGO AND SPACING SINCE THE NEW WORDMARK (Dean, 3 Nov 2026).

The F4 wordmark went into the sign-in card's old "mark + word" slot as a 25.5px glyph inside a text line:
the line box added about 5px above it, its descenders crowded SIGN IN, and the old pink drop-shadow rule
still sat on it. Dean was shown the fix live (injected CSS) and took it: the logo a 34px block with no
glow, the card ~9vh down, logo to heading 30px, heading to sub 10px, sub to card 28px.

This opens the REAL pages in headless Chrome (tools/browser-rig/rig.py), signed out, and measures what is
painted, at phone widths (320, 375, 390, 430) and a laptop (1280):
  /app/        the sign-in screen (#vSignIn)
  /app/go      the one-off link page (#goReady), the other page with .authlogo
For each: the wordmark is 34px tall, drawn as a block (not in a line box), no filter on it or its parents,
the logo-to-heading, heading-to-sub and sub-to-card gaps, nothing wider than the screen, no script errors.
On /app/ the card's top margin is 9vh.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/signin-logo-in-chrome.test.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
TOL = 1.0
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond:
        bad += 1


MEASURE = r'''(function(view){
  var v=document.getElementById(view); if(!v) return {err:"no "+view};
  var w=v.querySelector(".authwrap")||v.closest(".authwrap"), lg=v.querySelector(".authlogo")||(w&&w.querySelector(".authlogo")), svg=lg&&lg.querySelector("svg.vp-wm"),
      big=v.querySelector(".authbig"), sub=v.querySelector(".authsub"), card=v.querySelector(".authcard");
  if(!w||!lg||!svg||!big||!sub||!card) return {err:"missing piece"};
  function R(e){ var q=e.getBoundingClientRect(); return {t:q.top,b:q.bottom,h:q.height,w:q.width}; }
  var filt=[]; for(var e=svg; e && e!==document.body; e=e.parentElement){ var f=getComputedStyle(e).filter; if(f && f!=="none") filt.push(e.tagName+"."+e.className+": "+f); }
  return {svg:R(svg), logo:R(lg), big:R(big), sub:R(sub), card:R(card), display:getComputedStyle(svg).display,
          filt:filt, mt:parseFloat(getComputedStyle(w).marginTop), vh:innerHeight, vw:innerWidth,
          sideways:document.documentElement.scrollWidth>innerWidth+1, errs:(window.__errs||[]).length};
})(%s)'''


def check(r, path, views, width, height, wrap_vh=None):
    tag = '%s at %dx%d' % (path, width, height)
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 2 if width < 600 else 1, 'mobile': width < 600}, session=sid)
    r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.__FAKE_TEST={signedIn:false};'}, session=sid)
    r.B.call('Page.navigate', {'url': r.base + path}, session=sid)
    view = r.until(sid, '(function(ids){ if(document.fonts.status!=="loaded") return ""; for(var i=0;i<ids.length;i++){ var e=document.getElementById(ids[i]);'
                        ' if(e && !e.hidden && !e.classList.contains("hidden") && e.getBoundingClientRect().height>0) return ids[i]; } return ""; })(%s)' % json.dumps(views), 25)
    ok(tag + ': the page shows its sign-in card, signed out', bool(view) and view != 'HUNG', view)
    if not view or view == 'HUNG':
        r.close_tab(tid)
        return
    m = r.ask(sid, MEASURE % json.dumps(view)) or {}
    if m.get('err'):
        ok(tag + ': the card has its logo, heading, line and card', False, m['err'])
        r.close_tab(tid)
        return
    ok(tag + ': the sign-in wordmark is 34px tall', abs(m['svg']['h'] - 34) <= TOL, m['svg'])
    ok(tag + ': the sign-in wordmark is a block, not a glyph in a text line', m['display'] == 'block' and abs(m['logo']['h'] - m['svg']['h']) <= TOL, [m['display'], m['logo'], m['svg']])
    ok(tag + ': the sign-in wordmark has no pink glow', not m['filt'], m['filt'])
    ok(tag + ': logo to heading is 30px', abs((m['big']['t'] - m['svg']['b']) - 30) <= TOL, m['big']['t'] - m['svg']['b'])
    ok(tag + ': heading to sub line is 10px', abs((m['sub']['t'] - m['big']['b']) - 10) <= TOL, m['sub']['t'] - m['big']['b'])
    ok(tag + ': sub line to card is 28px', abs((m['card']['t'] - m['sub']['b']) - 28) <= TOL, m['card']['t'] - m['sub']['b'])
    if wrap_vh is not None:
        ok(tag + ': the sign-in card sits 9vh down', abs(m['mt'] - m['vh'] * wrap_vh / 100.0) <= TOL, [m['mt'], m['vh']])
    ok(tag + ': nothing wider than the screen', not m['sideways'])
    ok(tag + ': no script errors', m['errs'] == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    if SHOTS:
        r.shot(sid, os.path.join(SHOTS, 'signin-%s-%d.jpg' % (path.strip('/').replace('/', '-') or 'app', width)))
    r.close_tab(tid)


def main():
    if not gatelib.hold_lock_or_refuse('signin-logo-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        return 2
    import rig
    r = rig.Rig()
    try:
        for w, h in ((320, 640), (375, 812), (390, 844), (430, 932), (1280, 800)):
            check(r, '/app/', ['vSignIn'], w, h, wrap_vh=9)
            check(r, '/app/go', ['goReady', 'goGone'], w, h)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
