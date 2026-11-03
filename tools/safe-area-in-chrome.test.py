#!/usr/bin/env python3
"""NOTHING ON A PLAYER'S PHONE SITS UNDER THE ISLAND, THE NOTCH OR THE HOME BAR (Dean, 3 Nov 2026).

"It sits under the island." The player pages ask for viewport-fit=cover, which lets the page draw under
the iPhone's island, its rounded corners and its home bar, and then promises to keep its own words out of
them with env(safe-area-inset-*). Only the musical bingo button kept that promise, at the bottom. Saved to
the home screen or turned sideways, the header, the menu button and the called ball sat under the island.

This opens the REAL pages in headless Chrome (tools/browser-rig/rig.py) with REAL safe-area insets, set by
Chrome's own Emulation.setSafeAreaInsetsOverride, so env() answers the page exactly as an iPhone's Safari
would (a probe on each page reads them back first, so a Chrome that ignores the override fails here rather
than passing blind):
  portrait  430x932, island 59 top, home bar 34 bottom (an iPhone Pro Max saved to the home screen)
  landscape 932x430, 59 left and right, home bar 21 bottom (the same phone on its side)
The pages: /play (bingo, and the room), /app/musical/play, /app/trivia/play, the purchase raffle seller
(/app/purchase-raffle/) and /live-here-now. On each, every painted piece of text, button, input, picture
and logo must sit inside the safe area: none above the top inset or past a side inset at the top of the
page, and none below the bottom inset once the page is scrolled to its end. The called-ball chip in the
bingo header is shown for the measure (it appears once a ball is called), the menu is opened (it must drop below its button), and on the musical phone the
"Songs played" sheet is opened: its Close button must sit above the home bar. With no island (no inset override, and
insets set to 0) every header, menu, called ball, sheet and page padding sits exactly where it did before.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/safe-area-in-chrome.test.py
"""
import json, os, sys, time
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
    if not cond:
        bad += 1


PAGES = [
    ('/play', 'the bingo phone'),
    ('/app/musical/play', 'the musical bingo phone'),
    ('/app/trivia/play', 'the trivia phone'),
    ('/app/purchase-raffle/', 'the purchase raffle seller'),
    ('/live-here-now', 'the 60-second trivia'),
]
SHAPES = [
    ('portrait', 430, 932, {'top': 59, 'bottom': 34, 'left': 0, 'right': 0}),
    ('landscape', 932, 430, {'top': 0, 'bottom': 21, 'left': 59, 'right': 59}),
]

PROBE = r'''(function(){ var d=document.createElement("div");
  d.style.cssText="position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(d); var s=getComputedStyle(d), r={top:parseFloat(s.paddingTop),right:parseFloat(s.paddingRight),bottom:parseFloat(s.paddingBottom),left:parseFloat(s.paddingLeft)};
  d.remove(); return r; })()'''

# Every painted leaf: text, a button, an input, a picture, a logo. Not inside anything hidden, not the
# page's own full-screen overlays (none are open here), and big enough to see.
PIECES = r'''(function(){
  var hb=document.getElementById("hdrBall"); if(hb){ hb.classList.remove("hidden"); var n=document.getElementById("hdrBallNum"); if(n&&!n.textContent) n.textContent="88"; }
  var out=[], all=document.body.querySelectorAll("*");
  for(var i=0;i<all.length;i++){ var e=all[i], tag=e.tagName;
    if(/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|BR|OPTION)$/.test(tag)) continue;
    if(e.closest("svg") && tag!=="svg" && tag!=="SVG") continue;
    var leaf=/^(BUTTON|INPUT|SELECT|TEXTAREA|IMG|svg|SVG|CANVAS)$/.test(tag);
    if(!leaf){ for(var c=e.firstChild;c;c=c.nextSibling){ if(c.nodeType===3 && c.nodeValue.trim()){ leaf=true; break; } } }
    if(!leaf) continue;
    var s=getComputedStyle(e); if(s.visibility==="hidden" || +s.opacity===0) continue;
    var q=e.getBoundingClientRect(); if(q.width<2 || q.height<2) continue;
    var hid=false; for(var p=e;p&&p!==document.body;p=p.parentElement){ var ps=getComputedStyle(p); if(ps.display==="none"||ps.visibility==="hidden"||(+ps.opacity===0)){ hid=true; break; } if(ps.position==="fixed" && p!==e && q.width>=innerWidth-1 && q.height>=innerHeight-1){ hid=true; break; } }
    if(hid) continue;
    var name=tag.toLowerCase()+(e.id?"#"+e.id:"")+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\s+/).join("."):"");
    var pin=false; for(var p2=e;p2&&p2!==document.body;p2=p2.parentElement){ var pp=getComputedStyle(p2).position; if(pp==="sticky"||pp==="fixed"){ pin=true; break; } }
    out.push({n:name, t:q.top, b:q.bottom, l:q.left, r:q.right, pin:pin});
  }
  return out; })()'''


def page(r, path, what, shape, w, h, ins):
    tag = '%s (%s) %s %dx%d' % (what, path, shape, w, h)
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    try:
        r.B.call('Emulation.setSafeAreaInsetsOverride', {'insets': ins}, session=sid)
    except Exception as e:
        print('  (setSafeAreaInsetsOverride said: %s)' % e)
    r.B.call('Page.navigate', {'url': r.base + path}, session=sid)
    ready = r.until(sid, 'document.readyState==="complete" && document.fonts.status==="loaded" && !!document.body && document.body.getBoundingClientRect().height>0', 25)
    time.sleep(1.2)   # the page's own first paint: the join view, the venue line, the sign-in check
    got = r.ask(sid, PROBE) or {}
    ok(tag + ': the phone\'s insets reach the page (env() reads them)', ready is True and all(abs((got.get(k) or 0) - ins[k]) < 0.5 for k in ins), [ready, got])
    top = r.ask(sid, PIECES) or []
    ok(tag + ': the page painted something to measure', len(top) >= 3, len(top))
    under = [p for p in top if p['t'] < ins['top'] - 0.5 and p['b'] > 0]
    ok(tag + ': nothing sits under the island or the top edge', not under, under[:4])
    side = [p for p in top if (p['l'] < ins['left'] - 0.5 and p['r'] > 0) or (p['r'] > w - ins['right'] + 0.5 and p['l'] < w)]
    ok(tag + ': nothing sits under the rounded corners or the notch at the sides', not side, side[:4])
    if SHOTS:
        r.shot(sid, os.path.join(SHOTS, 'safe-%s-%s.jpg' % ((path.strip('/').replace('/', '-') or 'home'), shape)))
    # to the very end, whichever box scrolls (on the phones it is the body: html clips sideways, so the
    # body's own overflow is not handed to the window)
    r.ask(sid, '(function(){ [document.scrollingElement, document.documentElement, document.body].forEach(function(e){ if(e) e.scrollTop=e.scrollHeight; }); return 1; })()')
    time.sleep(0.4)
    end = r.ask(sid, PIECES) or []
    low = [p for p in end if p['b'] > h - ins['bottom'] + 0.5 and p['t'] < h]
    ok(tag + ': scrolled to the end, nothing sits under the home bar', not low, low[:4])
    stuck = [p for p in end if p['pin'] and p['t'] < ins['top'] - 0.5 and p['b'] > 0]
    ok(tag + ': scrolled, the header that stays on screen keeps out from under the island', not stuck, stuck[:4])
    mp = r.ask(sid, '(function(p,b){ if(!p||!b) return null; p.classList.remove("hidden"); var q=p.getBoundingClientRect(), k=b.getBoundingClientRect(), sh=p.querySelector(".vp-sheet"), last=sh?sh.lastElementChild:null;'
                    ' var o={top:q.top, btn:k.bottom, sheet:!!sh, sheetTop:sh?sh.getBoundingClientRect().top:0, low:last?last.getBoundingClientRect().bottom:0}; p.classList.add("hidden"); return o; })(document.getElementById("menuPanel"), document.getElementById("menuBtn"))')
    if mp is not None and mp.get('sheet'):
        # THE MUSICAL PHONE'S MENU IS ONE SHEET FROM THE BOTTOM (the new look, Dean 3 Nov 2026; /app/vp-phone.css): its top
        # clear of the island, its last row clear of the home bar.
        ok(tag + ': the menu sheet starts clear of the island and its last row clears the home bar', mp['sheetTop'] >= ins['top'] - 0.5 and mp['low'] <= h - ins['bottom'] + 0.5, mp)
    elif mp is not None:
        ok(tag + ': the menu opens below its button, not over it or under the island', mp['top'] >= mp['btn'] - 0.5 and mp['top'] >= ins['top'], mp)
    if path == '/app/musical/play':
        # the catch-up list ("Songs played"), a sheet up from the bottom: its Close button above the home bar
        sh = r.ask(sid, '(function(s){ if(!s) return null; s.classList.remove("hidden"); var b=document.getElementById("sheetDone"); var q=b&&b.getBoundingClientRect(); return q?{t:q.top,b:q.bottom}:null; })(document.getElementById("playedSheet"))')
        ok(tag + ': the songs-played sheet keeps its Close button above the home bar', bool(sh) and sh['b'] <= h - ins['bottom'] + 0.5, sh)
        if SHOTS:
            r.shot(sid, os.path.join(SHOTS, 'safe-musical-sheet-%s.jpg' % shape))
    ok(tag + ': no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)


def no_insets(r, path, what, zero):
    """A phone with no island or notch (Dean, 3 Nov 2026: "we only need to save a spot for the header if the
    phone has an island"): every inset 0, so the header and page sit exactly where they did before the fix.
    Run twice: with no override at all (a desktop or Android browser) and with the insets set to 0."""
    how = 'insets set to 0' if zero else 'no insets at all'
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    if zero:
        r.B.call('Emulation.setSafeAreaInsetsOverride', {'insets': {'top': 0, 'bottom': 0, 'left': 0, 'right': 0}}, session=sid)
    r.B.call('Page.navigate', {'url': r.base + path}, session=sid)
    r.until(sid, 'document.readyState==="complete"', 25)
    got = r.ask(sid, '''(function(){ function px(sel, prop){ var e=document.querySelector(sel); return e ? parseFloat(getComputedStyle(e)[prop]) : null; }
      return {ptop:px(".ptop","paddingTop"), menubtn:px(".ptop .menubtn","top"), menupanel:px(".ptop .menupanel","top"), hdrball:px(".ptop .hdrball","top"),
              sheet:px(".sheet","paddingBottom"), header:px("header","paddingTop"), bar:px("header .bar","paddingLeft"), barR:px("header .bar","paddingRight"), wrap:px(".wrap","paddingBottom")}; })()''') or {}
    # what each page had before the fix; a page without the piece answers null and is not judged on it
    before = {'ptop': 16, 'menubtn': 12, 'menupanel': 56, 'hdrball': 10, 'sheet': 22}
    if path == '/app/purchase-raffle/':
        before = {'header': 0, 'bar': 22, 'barR': 22, 'wrap': 60}
    moved = {k: [got.get(k), v] for k, v in before.items() if got.get(k) is not None and abs(got[k] - v) > 0.5}
    present = [k for k in before if got.get(k) is not None]
    ok('%s, a phone with no island (%s): the header and page sit exactly where they did before' % (what, how), present and not moved, moved or got)
    r.close_tab(tid)


def main():
    if not gatelib.hold_lock_or_refuse('safe-area-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        return 2
    import rig
    r = rig.Rig()
    try:
        for path, what in PAGES:
            for shape, w, h, ins in SHAPES:
                page(r, path, what, shape, w, h, ins)
        for path, what in PAGES[:4]:
            for zero in (False, True):
                no_insets(r, path, what, zero)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
