#!/usr/bin/env python3
"""A BINGO! TAP IS NEVER SILENT, ON EITHER BINGO PHONE (live play, Test Alpha, 3 Nov 2026).

"Tapping BINGO! with nothing marked, or the pattern not complete, gives no feedback at all and sends no
claim." Not sending is right: the phone only claims when the songs (musical) or numbers (bingo) for the
pattern have really been played, and the Worker or the host is the judge. Saying nothing was the fault:
  musical bingo  the button is sticky (always on screen) but its answer went to the line UNDER the card,
                 off screen at phone height, and a tap before the card had connected returned silently
  number bingo   answered already (its line sits just above its button); a tap with no tickets yet, or
                 no game on, returned silently and now says so (not reachable from the demo, so unproven here)

This opens the REAL phones' own ?demo=1 nights in headless Chrome (tools/browser-rig/rig.py), at 390x690
(a phone in a browser, the height the BINGO-button check in ux-fixes uses), and taps the real button:

  musical  with the demo's clock held after the card is dealt (its later timers parked, so no song plays):
           A  nothing marked: the note ON the button says "Mark the songs you hear first", on screen,
              scrolled to the top and to the bottom, and nothing covers it
           B  a song marked that has not played: the note says so (outlined in orange)
           no claim went to the Worker for either, the note goes by itself after a few seconds, and the
           line under the card says the same thing
  bingo    D  tickets dealt, no ball yet (clock held): "Not yet, keep playing", in the line beside the
              button, on screen with it (the phone counts the game as on once tickets are dealt)
           E  the demo's own night, after a ball or two: "Not yet, keep playing", on screen with the button

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/bingo-tap-feedback-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
W, H = 390, 690
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond:
        bad += 1


# Run before the page: every fetch is written down (a claim would be one), and while window.__hold is on,
# any timer of a second or more is parked (the demo's songs, balls and its scripted claim), so the test
# decides what the card looks like. Timers set after the hold is lifted run as normal.
HOLD = r'''(function(){
  window.__fetches=[]; var F=window.fetch; window.fetch=function(u){ try{ window.__fetches.push(String(u&&u.url||u)); }catch(e){} return F.apply(this, arguments); };
  window.__hold=true; var T=window.setTimeout;
  window.setTimeout=function(fn, ms){ if(window.__hold && +ms>=1000) return T(function(){}, 2147483000); return T.apply(window, arguments); };
})();'''

SEEN = r'''(function(id){ var e=document.getElementById(id); if(!e) return {there:false};
  var s=getComputedStyle(e), q=e.getBoundingClientRect(), x=q.left+q.width/2, y=q.top+q.height/2, hit=document.elementFromPoint(x, y);
  return {there:true, shown:s.display!=="none" && !e.classList.contains("hidden") && q.height>0, text:e.textContent.trim(),
          top:q.top, bottom:q.bottom, h:innerHeight, hit:!!hit && (hit===e || e.contains(hit))}; })(%s)'''


def seen(r, sid, ident):
    return r.ask(sid, SEEN % json.dumps(ident)) or {}


def on_screen(v):
    return v.get('shown') and v.get('top', -1) >= 0 and v.get('bottom', 9e9) <= v.get('h', 0) and v.get('hit')


def scroll(r, sid, where):
    r.ask(sid, '(function(){ [document.scrollingElement, document.body].forEach(function(e){ if(e) e.scrollTop=%s; }); return 1; })()' % ('0' if where == 'top' else 'e.scrollHeight'))
    time.sleep(0.3)


def tap(r, sid):
    r.ask(sid, 'document.getElementById("bingoBtn").click(); 1')
    time.sleep(0.4)


def musical(r):
    print('\nmusical bingo phone')
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': W, 'height': H, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': HOLD}, session=sid)
    r.B.call('Page.navigate', {'url': r.base + '/app/musical/play?demo=1'}, session=sid)
    dealt = r.until(sid, 'document.querySelectorAll("#cardGrid .cc").length===25 && !document.getElementById("vCard").classList.contains("hidden")', 40)
    ok('CONTROL: the musical demo card is dealt and showing', dealt is True, dealt)
    r.ask(sid, 'window.__hold=false; 1')   # the note's own timer must run
    marked = r.ask(sid, 'document.querySelectorAll("#cardGrid .cc.on, #cardGrid .cc.daub, #cardGrid .cc.marked").length')
    for where in ('top', 'bottom'):
        scroll(r, sid, where)
        tap(r, sid)
        v = seen(r, sid, 'bingoNote')
        ok('A, scrolled to the %s, nothing marked: BINGO! answers on the button itself ("Mark the songs you hear first")' % where,
           on_screen(v) and 'Mark the songs you hear first' in v.get('text', ''), [v, marked])
    msg = seen(r, sid, 'pMsg')
    ok('A: the line under the card says the same', 'Mark the songs you hear first' in msg.get('text', ''), msg.get('text'))
    if SHOTS:
        scroll(r, sid, 'top'); tap(r, sid)
        r.shot(sid, os.path.join(SHOTS, 'bingo-tap-musical-nothing-marked.jpg'))
    gone = r.until(sid, '(function(e){ return !!e && e.classList.contains("hidden"); })(document.getElementById("bingoNote"))', 10)
    ok('A: the note goes by itself after a few seconds', gone is True, gone)
    # B: mark a song that has not played (the demo's clock is held: nothing has)
    r.ask(sid, '(function(){ var c=document.querySelectorAll("#cardGrid .cc:not(.free)")[0]; c.click(); return 1; })()')
    time.sleep(0.3)
    scroll(r, sid, 'top')
    tap(r, sid)
    v = seen(r, sid, 'bingoNote')
    ok('B: a song marked that has not played: the note on the button says so', on_screen(v) and 'not played yet' in v.get('text', ''), v)
    if SHOTS:
        r.shot(sid, os.path.join(SHOTS, 'bingo-tap-musical-early-mark.jpg'))
    claims = [u for u in (r.ask(sid, 'window.__fetches') or []) if '/player/claim' in u]
    ok('no claim was sent for a card that is not a line', not claims, claims)
    ok('no script errors on the musical phone', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)


def number(r):
    print('\nnumber bingo phone')
    # D: tickets dealt, the clock held before the first ball
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': W, 'height': H, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': HOLD}, session=sid)
    r.B.call('Page.navigate', {'url': r.base + '/play?demo=1'}, session=sid)
    dealt = r.until(sid, '!!document.getElementById("vCard") && !document.getElementById("vCard").classList.contains("hidden") && !!document.querySelector("#cardStack *")', 40)
    ok('CONTROL: the bingo demo tickets are dealt and showing', dealt is True, dealt)
    r.ask(sid, '(function(){ var b=document.getElementById("bingoBtn"); b.scrollIntoView({block:"end"}); return 1; })()'); time.sleep(0.3)
    tap(r, sid)
    v = seen(r, sid, 'pMsg'); b = seen(r, sid, 'bingoBtn')
    ok('D: tickets dealt, before the first ball: BINGO! answers ("Not yet, keep playing"), beside the button, both on screen',
       'Not yet, keep playing' in v.get('text', '') and on_screen(v) and on_screen(b), [v, b])
    ok('no script errors on the bingo phone (held)', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)
    # E: the demo's own night, once a ball has been called
    tid, sid = r.open('/play?demo=1', width=W, height=H)
    rolled = r.until(sid, '/\\d/.test((document.getElementById("lastCalled")||{}).textContent||"")', 40)
    ok('CONTROL: the bingo demo has called a ball', rolled is True, rolled)
    r.ask(sid, '(function(){ var b=document.getElementById("bingoBtn"); b.scrollIntoView({block:"end"}); return 1; })()'); time.sleep(0.3)
    tap(r, sid)
    v = seen(r, sid, 'pMsg'); b = seen(r, sid, 'bingoBtn')
    ok('E: a pattern not complete: BINGO! says "Not yet, keep playing", beside the button, both on screen',
       'Not yet, keep playing' in v.get('text', '') and on_screen(v) and on_screen(b), [v, b])
    if SHOTS:
        r.shot(sid, os.path.join(SHOTS, 'bingo-tap-number-not-yet.jpg'))
    r.close_tab(tid)


def main():
    if not gatelib.hold_lock_or_refuse('bingo-tap-feedback-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        return 2
    import rig
    r = rig.Rig()
    try:
        musical(r)
        number(r)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
