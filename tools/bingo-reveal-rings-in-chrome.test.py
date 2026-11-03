#!/usr/bin/env python3
"""NO BARE PINK RING OVER THE BINGO BOARD (live fault, 3 Nov 2026).

"A large pink circle outline overlaps the left of the number board" (Dean, from a capture of the bingo
wall, ~/venue-enrich/reports/new-look-games-3nov/current/5-bingo-called.png). It is the first of the three
light rings of the big-ball reveal in tv.html (.brrings). Each call, the first ring started at 0 s at 90%
strength, while the room was still undimmed (.brdim fades in over .25 s) and the ball was still rolling in
from the right at opacity 0. So for the opening frames of every call a bare ring sat over the board on its
own, and a slow TV holds those frames for longer. The fix starts the rings once the dim is up and the
ball has arrived.

This opens the REAL tv.html in its own ?demo=1 night (a scripted bingo round, no venue, no Worker) in
headless Chrome, at 1280x720, 1920x1080 and 3840x2160, and catches the first ball's reveal as it starts.
Every animation and transition on the page is then stepped by hand (document.getAnimations(), paused,
currentTime set) through the reveal's 1.3 s hold in 20 ms steps, so what is measured is the browser's own
computed frame at that moment, whatever the machine's speed. At every step where any ring is visible
(opacity over .05), it must be inside a dimmed room (.brdim at .9 or more) with the reveal ball showing
(opacity .5 or more), so a ring is never seen over the bare board. Then the reveal is let run, and once it
heads home (1.3 s) no ring is painted anywhere.

The rings still run (they are part of the reveal Dean asked for on 28 Sep): at least one step has a ring
showing, so "no ring ever" cannot pass this check.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/bingo-reveal-rings-in-chrome.test.py
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


# Installed before the page's own scripts. When #ballReveal first gains "live" (revealBall() has just
# started a reveal), the step-through runs synchronously, inside the observer, before the page's own
# 1.3 s timer can move on. With ?freeze=<ms> in window.__VP_FREEZE it instead leaves every animation
# paused at that moment, for a screenshot.
HOOK = r'''(function(){
  window.__rings = null;
  function sample(){
    var el=document.getElementById("ballReveal"), dim=el.querySelector(".brdim"), ball=document.getElementById("brBall"),
        rings=[].slice.call(el.querySelectorAll(".brrings i")), board=document.querySelector("#tvBoard, .board, #board");
    getComputedStyle(ball).opacity; rings.forEach(function(r){ getComputedStyle(r).opacity; }); getComputedStyle(dim).opacity;
    var anims=document.getAnimations(); anims.forEach(function(a){ a.pause(); });
    function at(t){ anims.forEach(function(a){ a.currentTime=t; }); }
    var steps=[];
    for(var t=0;t<=1280;t+=20){
      at(t);
      var rs=rings.map(function(r){ var s=getComputedStyle(r), q=r.getBoundingClientRect(); return {o:+s.opacity, l:q.left, r:q.right, t:q.top, b:q.bottom}; });
      steps.push({t:t, dim:+getComputedStyle(dim).opacity, ball:+getComputedStyle(ball).opacity, rings:rs});
    }
    var fz=window.__VP_FREEZE;
    if(fz!=null){ at(fz); }
    else { at(0); anims.forEach(function(a){ a.play(); }); }
    var bq=board&&board.getBoundingClientRect();
    window.__rings={steps:steps, anims:anims.length, board:bq?{l:bq.left,r:bq.right,t:bq.top,b:bq.bottom}:null, vw:innerWidth, vh:innerHeight};
  }
  function watch(){
    var el=document.getElementById("ballReveal"); if(!el){ return setTimeout(watch, 20); }
    var mo=new MutationObserver(function(){ if(el.classList.contains("live") && !window.__rings){ mo.disconnect(); try{ sample(); }catch(e){ window.__rings={err:String(e&&e.message||e)}; } } });
    mo.observe(el, {attributes:true, attributeFilter:["class"]});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();'''

SHOWN = 0.05


def scene(r, w, h, freeze=None):
    tag = 'the bingo wall at %dx%d' % (w, h)
    tid, sid = r.open('/__blank')
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
    src = ('window.__VP_FREEZE=%d;' % freeze if freeze is not None else '') + HOOK
    r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': src}, session=sid)
    r.B.call('Page.navigate', {'url': r.base + '/tv?demo=1'}, session=sid)
    got = r.until(sid, 'window.__rings', 40)
    return tag, tid, sid, got


def judge(r, w, h):
    tag, tid, sid, got = scene(r, w, h)
    ok(tag + ': the demo calls a ball and its reveal is caught as it starts', isinstance(got, dict) and 'steps' in got, got)
    if not isinstance(got, dict) or 'steps' not in got:
        r.close_tab(tid)
        return
    ok(tag + ': the reveal\'s animations are on the page to step through', got['anims'] >= 4, got['anims'])
    bare = [s for s in got['steps'] if any(x['o'] > SHOWN for x in s['rings']) and (s['dim'] < 0.9 or s['ball'] < 0.5)]
    first = bare[0] if bare else None
    ok(tag + ': a reveal ring is never shown over the undimmed board without the ball',
       not bare, first and {'t_ms': first['t'], 'dim': round(first['dim'], 2), 'ball': round(first['ball'], 2),
                            'ring_opacity': [round(x['o'], 2) for x in first['rings']], 'board': got['board']})
    ok(tag + ': the reveal rings still pulse out behind the ball', any(any(x['o'] > SHOWN for x in s['rings']) for s in got['steps']))
    # let it run: at 1.3 s the room comes back up and the ball glides home (the demo calls the next ball
    # 2.1 s after this one, as long as the whole reveal takes, so the layer itself is rarely hidden there)
    landed = r.until(sid, '(function(e){return !!e && !e.classList.contains("live");})(document.getElementById("ballReveal"))', 8)
    left = r.ask(sid, '(function(){ return [].slice.call(document.querySelectorAll("#ballReveal .brrings i")).filter(function(i){ var q=i.getBoundingClientRect(); return q.width>0 && +getComputedStyle(i).opacity>0.05; }).length; })()')
    ok(tag + ': once the ball heads home no reveal ring is painted', landed is True and left == 0, [landed, left])
    ok(tag + ': no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)


def main():
    if not gatelib.hold_lock_or_refuse('bingo-reveal-rings-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        return 2
    import rig
    r = rig.Rig()
    try:
        for w, h in ((1280, 720), (1920, 1080), (3840, 2160)):
            judge(r, w, h)
        if SHOTS:
            # the opening frame of a call, frozen 60 ms in (where the bare ring was), and 700 ms in
            for ms in (60, 700):
                tag, tid, sid, got = scene(r, 1920, 1080, freeze=ms)
                time.sleep(0.3)
                r.shot(sid, os.path.join(SHOTS, 'bingo-reveal-%dms-1920.jpg' % ms))
                r.close_tab(tid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
