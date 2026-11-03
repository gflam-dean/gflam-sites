#!/usr/bin/env python3
"""THE VENUE'S LOGO AND THE VENUEPLAY MARK SIT ON ONE LINE (Dean, 2 Nov 2026).

"When a venue has a square or tall logo, drop the venueplay mark down so the two logos are vertically
centred on each other." The venue's logo (#venueLogo, top left) is sized by its shape in
/app/vp-venuelogo.js, so a square crest is 134px tall on a 1920 TV while the venueplay mark (#tvCorner,
top right) is 34px tall at the top of the screen: the crest's middle sat about 35px below the mark's.
tv.html's alignCorner() now measures both as drawn and moves the corner down by the difference, for a
logo that is not wide. The start-of-game show (/app/vp-sting.js) measures the corner as it plays, so it
must land on the mark where it now is, not where it used to be.

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real
game Worker in jsc, supabase-js stood in) and checks:
  REAL    a real console opens a bingo lobby, at 1920x1080. A /tv with NO logo: the corner is exactly
          where it always was (no transform). A /tv whose venue has a SQUARE logo (Tugun's crest, from
          the venue's own screen record): the two middles within 2px, the mark moved down, its right
          edge where it was. Then Start: the show's wordmark, on its last frame, lands on the moved mark
          (within 2px), and the new mark it leaves there is still centred on the logo.
  DEMO    the sales-page demo TV (/tv?demo=1, Tugun's crest), at 1920x1080 and 1280x720: the show lands
          on the moved mark and the logos stay centred after it. Then the logo is swapped on the live
          page, the real load-and-size path: a WIDE 4:1 wordmark puts the corner back exactly where a
          venue with no logo has it; a TALL 1:3 logo centres the two again; the square crest again.
  GAMES   the trivia and musical bingo screens (what tv.html shows in its frame during those games), in
          their own demos with Tugun's crest, at 1920x1080 and 1280x720: the show plays on "started", and once
          it is over their own wordmark is centred on their own logo; a wide logo puts it back, the square one
          again. (The demo's first question at 4.2 s cuts the show, so it is caught and ended first.)
  KNOWN   below 1920 wide the show's stage is not scaled (vp-sting fit() writes el.stage, the element is
          el.vpsStage; noted in hotfix aaa3e6d5, not this branch), so the 1280 landing is judged only once it is. The shared
          code is VPVenueLogo.alignMark in /app/vp-venuelogo.js; raffle and members draw call it the same way.

  LIVE    the real trivia demo on its own clock (no hand on the show): the painted wordmark's middle within 3px
          of Tugun's crest's middle with the show off (the default), and with ?sting=1 once the show has ended
          (the mark is re-measured on "vp-sting-done", the picture's load and a resize).

The pages that play the start show are opened with &sting=1, so this holds whether the show is on or off
by default (it is off by default from hotfix/sting-off-2nov).

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/tv-logo-centre-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
TOL = 2.0
TOL_LIVE = 3.0   # the real trivia demo on its own clock: a few px
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def take_lock(tool='tv-logo-centre-in-chrome'):
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine') and gatelib.hold_lock_or_refuse(tool, wait_s=0):
            return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(0.5)

# What is drawn: the venue logo's box, the venueplay mark that is showing (the first svg in the corner
# with a size: the old mark, or the new logo the show leaves), the corner's own move, and the screen.
MEASURE = r'''(function(){
  function R(e){ if(!e) return null; var q=e.getBoundingClientRect(); return q.height ? {t:q.top,b:q.bottom,l:q.left,r:q.right,h:q.height,cy:q.top+q.height/2} : null; }
  var c=document.getElementById("tvCorner")||document.querySelector(".tv-corner"), lg=document.getElementById("venueLogo"), mk=null;
  if(c){ var s=c.querySelectorAll("svg"); for(var i=0;i<s.length && !mk;i++) mk=R(s[i]); }
  return { logo:(lg && lg.complete && lg.naturalWidth) ? R(lg) : null, nat:lg ? [lg.naturalWidth, lg.naturalHeight] : null, mark:mk,
           drop:c ? (c.getAttribute("data-drop")||"") : null, tf:c ? c.style.transform : null, cornerOn:!!c && getComputedStyle(c).display!=="none",
           newmark:!!(c && c.querySelector(".vp-newmark")), W:innerWidth, H:innerHeight };
})()'''
# The show's last frame, by hand (__vpStingManual): the wordmark's box once it has flown to the corner
# (3.5 s: its move ends at 3.10 s), then the end, which leaves the new mark in the corner.
LANDING = r'''(function(){
  if(!window.VPSting || !VPSting.playing()) return null;
  VPSting.frame(3.5);
  var g=document.getElementById("vpsWg"), q=g && g.getBoundingClientRect();
  var land = q ? {t:q.top,b:q.bottom,l:q.left,r:q.right,h:q.height,cy:q.top+q.height/2} : null;
  VPSting.frame(9);
  return land;
})()'''
# A logo of any shape, made in the page and swapped onto the live #venueLogo: the real load path.
SWAP = r'''(function(w,h){ var c=document.createElement("canvas"); c.width=w; c.height=h; var x=c.getContext("2d");
  x.fillStyle="#f5c518"; x.fillRect(0,0,w,h); document.getElementById("venueLogo").src=c.toDataURL("image/png"); return true; })(%d,%d)'''

def centred(r, sid, tag, want_drop=True):
    """The checks for a logo that is not wide: the two middles within TOL, the mark moved down."""
    m = r.ask(sid, MEASURE) or {}
    lg, mk = m.get('logo'), m.get('mark')
    ok(tag + ': the logo and the venueplay mark are both on screen', bool(lg) and bool(mk) and m.get('cornerOn'), m)
    if lg and mk:
        print('  %s: logo %.0fx%.0f middle %.1f, mark middle %.1f, corner moved %s' % (tag, lg['r'] - lg['l'], lg['h'], lg['cy'], mk['cy'], m.get('drop') or 0))
        ok(tag + ': their vertical middles within %dpx' % TOL, abs(lg['cy'] - mk['cy']) <= TOL, [lg, mk])
        if want_drop:
            ok(tag + ': the mark was moved DOWN to get there', float(m.get('drop') or 0) > 5 and 'translateY' in (m.get('tf') or ''), m)
    return m

def first_tv(r, path, before=None, w=1920, h=1080):
    tid, sid = r.open(path, before=before, width=w, height=h)
    r.until(sid, '!!document.getElementById("adsRoot")', 15)
    # the first-load intro (3 Nov 2026) brings the venue's logo in at 2.3 s: measure the corner after it
    r.until(sid, '(function(v){return !v||v==="done";})(document.documentElement.getAttribute("data-tvi"))', 8)
    return tid, sid

def lobby_up(r, sid):
    return r.until(sid, '(function(c){return !!c && getComputedStyle(c).display!=="none" && !!c.querySelector("svg") && c.querySelector("svg").getBoundingClientRect().height>0;})(document.getElementById("tvCorner"))', 20)

def real():
    import rig as RIG
    print('\nREAL: a real console, a bingo lobby, 1920x1080')
    r = RIG.Rig()
    try:
        slug, vid = r.W.info['slug'], r.W.info['venue']
        def screen(logo):
            r.W.seed('vp_venue_screen', [{'venue_id': vid, 'slug': slug, 'logo_url': logo, 'raffle': None,
                                          'slides': [{'head': 'Trivia every Wednesday', 'sub': 'From 7pm', 'accent': 'blue'}]}], replace=True)
        screen(None)
        t0, tv0 = first_tv(r, '/tv?venue=' + slug)
        hid, host = r.open('/app/', width=1024, height=1100)
        ok('the console loads, signed in, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
        r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
        time.sleep(1.5)
        r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                     '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
        opened = False
        for _ in range(2):
            r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1.2)
            if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
                r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)
            if r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 8) is True:
                opened = True; break
        ok('the console opens the lobby', opened, r.ask(host, 'document.getElementById("startBtn").textContent'))

        ok('NO LOGO: the TV is in the lobby, the mark on screen', lobby_up(r, tv0) is True, r.ask(tv0, MEASURE))
        time.sleep(1.5)
        none = r.ask(tv0, MEASURE) or {}
        ok('NO LOGO: no logo is drawn', none.get('logo') is None, none)
        ok('NO LOGO: the corner is where it always was: not moved at all', not none.get('drop') and not none.get('tf'), none)
        shot(r, tv0, 'tv-logo-centre-none-1920')
        r.close_tab(t0)

        screen(r.base + '/logos/venue-tugun-bowls.png')
        t1, tv1 = first_tv(r, '/tv?venue=' + slug + '&sting=1', before='window.__vpStingManual=true;')
        ok('SQUARE: the TV joins the lobby', lobby_up(r, tv1) is True, r.ask(tv1, MEASURE))
        r.until(tv1, '!!document.getElementById("tvCorner").getAttribute("data-drop")', 10)
        time.sleep(1.0)
        sq = centred(r, tv1, 'SQUARE (real venue record)')
        mk0 = (none.get('mark') or {})
        if sq.get('mark') and mk0:
            ok('SQUARE: only moved down: the mark\'s right edge and size are where they were', abs(sq['mark']['r'] - mk0['r']) <= 0.5 and abs(sq['mark']['h'] - mk0['h']) <= 0.5, [sq['mark'], mk0])
        shot(r, tv1, 'tv-logo-centre-square-1920')
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        ok('Start: the TV starts the show', r.until(tv1, 'window.VPSting && VPSting.playing()', 8) is True, r.ask(tv1, '(window.VPSting?VPSting.stats():null)'))
        VL = '(function(e){return e?getComputedStyle(e).opacity:"none";})(document.getElementById("venueLogo"))'
        ok('SQUARE: the venue\'s top-left logo fades out with the rest for the show (3 Nov 2026)', r.until(tv1, VL + '==="0"', 3) is True, r.ask(tv1, VL))
        land = r.ask(tv1, LANDING)
        mk = sq.get('mark') or {}
        ok('SQUARE: the show\'s wordmark lands on the moved mark (top, bottom and right within %dpx)' % TOL,
           bool(land) and bool(mk) and abs(land['t'] - mk['t']) <= TOL and abs(land['b'] - mk['b']) <= TOL and abs(land['r'] - mk['r']) <= TOL, [land, mk])
        after = r.ask(tv1, MEASURE) or {}
        ok('SQUARE: the show is done and its new mark is in the corner', r.ask(tv1, '!document.getElementById("vpSting")') is True and after.get('newmark'), after)
        ok('SQUARE: and the venue\'s logo fades back in on the game screen', r.until(tv1, VL + '==="1"', 3) is True, r.ask(tv1, VL))
        centred(r, tv1, 'SQUARE after the show')
        shot(r, tv1, 'tv-logo-centre-square-after-show-1920')
        ok('no script errors on the TV', r.ask(tv1, 'window.__errs.length') == 0, r.ask(tv1, 'JSON.stringify(window.__errs)'))
        return none
    finally:
        r.close()

def games():
    """The game screens tv.html shows in its frame during a game: their own logo and their own corner."""
    import rig as RIG
    r = RIG.Rig()
    CORNER = '(document.querySelector(".tv-corner")||{getAttribute:function(){return null;}})'
    try:
        for path, tag in (('/app/trivia/screen?demo=1&sting=1', 'TRIVIA'), ('/app/musical/screen?demo=1&sting=1', 'MUSICAL BINGO')):
            for (w, h) in ((1920, 1080), (1280, 720)):
                print('\n%s: the game screen\'s own demo, Tugun\'s square crest, %dx%d' % (tag, w, h))
                tid, sid = r.open(path, before='window.__vpStingManual=true;', width=w, height=h)
                # The demo sends "started" at once and its first question at 4.2 s, which makes the show give
                # way: so the show is caught first, and driven to its end by hand, before anything is waited on.
                # Whether the crest had loaded before the show hid the mark is down to timing; either way the
                # two logos must be centred once it is over (the re-measure on "vp-sting-done").
                ok('%s %d: "started" plays the show' % (tag, w), r.until(sid, 'window.VPSting && VPSting.stats().plays>=1', 12) is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
                r.ask(sid, LANDING)
                ok('%s %d: the show is over' % (tag, w), r.until(sid, '!VPSting.playing() && !document.getElementById("vpSting")', 8) is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
                ok('%s %d: the logo is up and the corner moved' % (tag, w), r.until(sid, '!!%s.getAttribute("data-drop")' % CORNER, 15) is True, r.ask(sid, MEASURE))
                time.sleep(0.8)
                centred(r, sid, '%s %d SQUARE after the show' % (tag, w))
                shot(r, sid, 'tv-logo-centre-%s-square-%d' % (tag.split()[0].lower(), w))
                r.ask(sid, SWAP % (1200, 300))
                r.until(sid, '(function(l){return l.naturalWidth===1200;})(document.getElementById("venueLogo"))', 8); time.sleep(0.8)
                wd = r.ask(sid, MEASURE) or {}
                ok('%s %d WIDE 4:1: the corner goes back to where it always was (not moved)' % (tag, w), bool(wd.get('logo')) and not wd.get('drop') and not wd.get('tf'), wd)
                r.ask(sid, 'document.getElementById("venueLogo").src="/logos/venue-tugun-bowls.png"; true')
                r.until(sid, '(function(l){return l.naturalWidth===480;})(document.getElementById("venueLogo"))', 8); time.sleep(0.8)
                centred(r, sid, '%s %d SQUARE again' % (tag, w))
                ok('%s %d: no script errors on the screen' % (tag, w), r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
                r.close_tab(tid)
    finally:
        r.close()

def demo(none_mark):
    import rig as RIG
    r = RIG.Rig()
    try:
        for (w, h) in ((1920, 1080), (1280, 720)):
            print('\nDEMO: the sales-page demo TV, Tugun\'s square crest, %dx%d' % (w, h))
            tid, sid = first_tv(r, '/tv?demo=1&sting=1', before='window.__vpStingManual=true;', w=w, h=h)
            ok('%d: the logo is up and the corner moved before the show' % w, r.until(sid, '!!document.getElementById("tvCorner").getAttribute("data-drop")', 10) is True, r.ask(sid, MEASURE))
            pre = r.ask(sid, MEASURE) or {}
            ok('%d: "started" plays the show' % w, r.until(sid, 'window.VPSting && VPSting.playing()', 10) is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
            # KNOWN, NOT THIS BRANCH (aaa3e6d5): vp-sting.js fit() writes el.stage but the element is el.vpsStage,
            # so below 1920 wide the show's stage is never scaled and its wordmark lands in 1920 pixels. The
            # landing is judged only where the stage is drawn to scale; the day fit() is fixed it is judged at 1280 too.
            scaled = w == 1920 or bool(r.ask(sid, '(function(e){return !!e && /scale/.test(e.style.transform);})(document.getElementById("vpsStage"))'))
            land = r.ask(sid, LANDING)
            mk = pre.get('mark') or {}
            if not scaled:
                print('  KNOWN %d: the show\'s stage is not scaled below 1920 (vp-sting fit(), aaa3e6d5): landing not judged' % w)
            else:
                ok('%d: the show\'s wordmark lands on the moved mark (top, bottom and right within %dpx)' % (w, TOL),
                   bool(land) and bool(mk) and abs(land['t'] - mk['t']) <= TOL and abs(land['b'] - mk['b']) <= TOL and abs(land['r'] - mk['r']) <= TOL, [land, mk])
                if land and pre.get('logo'):
                    ok('%d: and its middle is on the logo\'s middle (within %dpx)' % (w, TOL), abs(land['cy'] - pre['logo']['cy']) <= TOL, [land, pre['logo']])
            time.sleep(0.5)
            centred(r, sid, '%d SQUARE after the show' % w)
            shot(r, sid, 'tv-logo-centre-demo-square-%d' % w)

            r.ask(sid, SWAP % (1200, 300))
            r.until(sid, '(function(l){return l.naturalWidth===1200;})(document.getElementById("venueLogo"))', 8); time.sleep(0.8)
            wd = r.ask(sid, MEASURE) or {}
            ok('%d WIDE 4:1: the logo is drawn wide' % w, bool(wd.get('logo')) and (wd['logo']['r'] - wd['logo']['l']) > 3 * wd['logo']['h'], wd)
            ok('%d WIDE 4:1: the corner goes back to where it always was (not moved)' % w, not wd.get('drop') and not wd.get('tf'), wd)
            if w == 1920 and none_mark and wd.get('mark'):
                ok('1920 WIDE 4:1: the mark is exactly where a venue with no logo has it', abs(wd['mark']['t'] - none_mark['t']) <= 0.5 and abs(wd['mark']['r'] - none_mark['r']) <= 0.5, [wd['mark'], none_mark])
            shot(r, sid, 'tv-logo-centre-demo-wide-%d' % w)

            r.ask(sid, SWAP % (300, 900))
            r.until(sid, '(function(l){return l.naturalWidth===300;})(document.getElementById("venueLogo"))', 8); time.sleep(0.8)
            centred(r, sid, '%d TALL 1:3' % w)
            shot(r, sid, 'tv-logo-centre-demo-tall-%d' % w)

            r.ask(sid, 'document.getElementById("venueLogo").src="/logos/venue-tugun-bowls.png"; true')
            r.until(sid, '(function(l){return l.naturalWidth===480;})(document.getElementById("venueLogo"))', 8); time.sleep(0.8)
            centred(r, sid, '%d SQUARE again' % w)
            ok('%d: no script errors on the TV' % w, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()

def trivia_live():
    """THE TRIVIA DEMO, PLAYED FOR REAL (2 Nov 2026). The checks above drive the show by hand, so the logo
    is always measured BEFORE the show hides the mark. On the real sales-page trivia demo the show could
    hide the mark while the crest was still loading: alignMark measured nothing, and nothing asked again
    when the show ended, so the wordmark sat ~90px above Tugun's crest. Here the page runs on its own
    clock (no __vpStingManual): the show off (the default), then ?sting=1 once the show has finished on its
    own. Measured as painted: the corner's showing wordmark against the venue logo, middles within TOL_LIVE."""
    import rig as RIG
    r = RIG.Rig()
    try:
        for path, tag, shotname in (('/app/trivia/screen?demo=1', 'TRIVIA DEMO show off', 'trivia-demo-tugun-show-off-1920'),
                                    ('/app/trivia/screen?demo=1&sting=1', 'TRIVIA DEMO after the show', 'trivia-demo-tugun-after-show-1920')):
            print('\n%s: the real trivia demo on its own clock, Tugun\'s crest, 1920x1080' % tag)
            tid, sid = r.open(path, width=1920, height=1080)
            ok(tag + ': Tugun\'s crest has loaded', r.until(sid, '(function(l){return !!l && l.complete && l.naturalWidth===480;})(document.getElementById("venueLogo"))', 15) is True, r.ask(sid, MEASURE))
            if 'sting=1' in path:
                ok(tag + ': the show played on its own and finished', r.until(sid, 'window.VPSting && VPSting.stats().plays>=1 && !VPSting.playing()', 20) is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
                ok(tag + ': its new mark is in the corner', r.ask(sid, '!!document.querySelector(".tv-corner .vp-newmark")') is True, r.ask(sid, MEASURE))
            else:
                ok(tag + ': no show played', r.ask(sid, '!window.VPSting || VPSting.stats().plays===0') is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
            r.until(sid, '!!document.querySelector(".tv-corner").getAttribute("data-drop")', 6)
            time.sleep(1.0)
            m = r.ask(sid, MEASURE) or {}
            lg, mk = m.get('logo'), m.get('mark')
            ok(tag + ': the crest and the painted wordmark are both on screen', bool(lg) and bool(mk) and m.get('cornerOn'), m)
            if lg and mk:
                print('  %s: crest middle %.1f, wordmark middle %.1f (off by %.1f), corner moved %s' % (tag, lg['cy'], mk['cy'], mk['cy'] - lg['cy'], m.get('drop') or 0))
                ok(tag + ': the wordmark\'s painted middle is on the crest\'s middle (within %dpx)' % TOL_LIVE, abs(lg['cy'] - mk['cy']) <= TOL_LIVE, [lg, mk])
            shot(r, sid, shotname)
            ok(tag + ': no script errors on the screen', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()

def main():
    if not take_lock():
        return 2
    trivia_live()
    none = real()
    demo((none or {}).get('mark'))
    games()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
