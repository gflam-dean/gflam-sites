#!/usr/bin/env python3
"""THE TV AND THE PHONE SHOW THE SAME BALL, IN A REAL BROWSER (INBOX 287.0 / 295.2b, 12 Nov 2026).

The live fault: at 8:50 on 12 Nov Dean's phone showed ball 58, "32 of 90 called"; The Mini Bar's Kogan TV
app at the same moment showed ball 24, "27 of 90 called". The TV was five calls behind the phones and the
room was marking numbers the wall had not shown yet. Dean: the TV must always jump to the latest state,
never queue animations behind it.

What this plays, on the browser rig (tools/browser-rig/rig.py: the repo's own pages, the real game Worker,
realtime carried between windows):
  1. A TV at 1920x1080, a bingo console and a phone. Thirty numbers called FAST (the console's 5 second hold
     released after every call, so a ball lands every ~0.7 s, three times faster than the 2.1 s reveal).
     After every call, and at the end: the TV's called count and resting ball equal the phone's within 2 s.
     The TV never shows a ball the phone has not had, and never sits more than one call behind for 2 s.
  2. The same on an OLD TV ENGINE: ?oldtv=68 (vp-oldtv.js rewrites every style as on Chromium 68 to 94, the
     Kogan's Tizen 7 is Chromium 94) with the TV's CPU slowed six times (Emulation.setCPUThrottlingRate),
     as near as a Mac can come to a budget TV.
  3. A DEAF TV: the TV's realtime is cut for eight calls (it hears nothing, as a TV whose socket dropped),
     then put back WITHOUT any new call. The TV must catch up on its own within a few seconds (it asks the
     console for the state when a running game goes quiet), not wait for the next ball.
  (Trivia "TV time different to phone", a TV whose clock is off, is tools/test-host-clock-12nov.js.)

    python3 tools/tv-in-step-in-chrome.test.py          screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
CALLS = int(os.environ.get('VP_INSTEP_CALLS', '30'))
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    sys.stdout.flush()
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def click(r, sid, i): r.ask(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i))

# The TV's view: the called count it shows and the number on its resting ball.
# The number the room is looking at: the big ball while one is in the air (#ballReveal), else the resting ball.
TV_SEES = ('(function(){var c=document.getElementById("tvBallCount"),b=document.getElementById("cbNum"),'
           'rv=document.getElementById("ballReveal"),fl=document.getElementById("brBall");'
           'var up=rv&&!rv.classList.contains("hidden")&&fl;'
           'var m=/(\\d+)/.exec(c?c.textContent:"");return {n:m?+m[1]:0,ball:(up?fl:b)?(up?fl:b).textContent.trim():""};})()')
PHONE_SEES = ('(function(){var c=document.getElementById("hdrBallCount"),b=document.getElementById("hdrBallNum");'
              'var m=/(\\d+)/.exec(c?c.textContent:"");return {n:m?+m[1]:0,ball:b?b.textContent.trim():""};})()')
HOST_N = '(function(){var m=/(\\d+)/.exec((document.getElementById("liveCount")||{}).textContent||"");return m?+m[1]:0;})()'
LAST_BALL = '((document.getElementById("lastBallVal")||{}).textContent||"").trim()'
CONSOLE_PREV = '[].map.call(document.querySelectorAll("#livePrev > *"),function(e){return e.textContent.trim();}).join(",")'

# Cut and restore this window's realtime: the rig's stand-in carries realtime on BroadcastChannels named
# fake-rt:<topic>, so a deaf TV is one whose BroadcastChannel messages are dropped on arrival.
DEAF = r'''(function(){
  var BC=window.BroadcastChannel; window.__deaf=false;
  window.BroadcastChannel=function(n){ var c=new BC(n), h=null;
    Object.defineProperty(c,"onmessage",{configurable:true,get:function(){return h;},set:function(f){ h=f; c.addEventListener("message",function(e){ if(!window.__deaf && h) h.call(c,e); }); }});
    var ael=c.addEventListener.bind(c);
    c.addEventListener=function(t,f,o){ if(t!=="message") return ael(t,f,o); return ael(t,function(e){ if(!window.__deaf) f.call(c,e); },o); };
    return c; };
  window.BroadcastChannel.prototype=BC.prototype;
})();'''


def console(r):
    tid, host = r.open('/app/?sting=0', width=1024, height=1100)
    ok('the console loads, signed in, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                 '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
    return tid, host

def open_lobby(r, host):
    for _ in range(2):
        click(r, host, 'startBtn'); time.sleep(1.2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)
        if r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 8) is True:
            return True
    return False

def phone(r, name):
    _, ph = r.open('/play?room=' + r.W.info['code'] + '&sting=0', width=390, height=844)
    r.phone_ready(ph)
    r.ask(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    ok('the phone joins as ' + name, r.until(ph, '!document.getElementById("vWait").classList.contains("hidden")', 25) is True,
       r.ask(ph, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
    return ph

def call_one(r, host):
    """One call, then the console's 5 s hold released, as a host tapping as fast as the button allows."""
    before = r.ask(host, HOST_N) or 0
    click(r, host, 'nextBtn')
    r.until(host, HOST_N + '>%d' % before, 4)   # the server may ask the console to wait (a ball every few seconds at most)
    r.ask(host, 'try{var b=document.getElementById("nextBtn");VP_HOLD.release(b);b.disabled=false;}catch(e){} true')
    return r.ask(host, HOST_N) or 0

def in_step(r, tv, ph, host, secs=2.0):
    """The TV and the phone both show the console's count and last ball within `secs`. Returns [ok, saw]."""
    want_n = r.ask(host, HOST_N); want_b = r.ask(host, LAST_BALL)
    t = time.time() + secs
    while True:
        a = r.ask(tv, TV_SEES) or {}; p = r.ask(ph, PHONE_SEES) or {}
        good = a.get('n') == want_n and a.get('ball') == want_b and p.get('n') == want_n
        if good or time.time() > t:
            return good, {'console': [want_n, want_b], 'tv': a, 'phone': p, 'waited': round(secs - max(0, t - time.time()), 2)}
        time.sleep(0.1)

def night(label, tv_query='', throttle=0, deaf_test=False):
    print('\n%s' % label)
    r = RIG.Rig()
    try:
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'] + '&sting=0' + tv_query, before=DEAF, width=1920, height=1080)
        ok('the TV loads on the ads', r.until(tv, '!!document.getElementById("adsRoot")', 20) is True)
        time.sleep(1.5)
        if throttle:
            r.B.call('Emulation.setCPUThrottlingRate', {'rate': throttle}, session=tv)
        if 'oldtv' in tv_query:
            ok('CONTROL: the TV runs the old-engine rewrite (vp-oldtv.js active)', r.ask(tv, '!!(window.VPOldTV && VPOldTV.active)') is True)
        _, host = console(r)
        ok('the console opens the lobby', open_lobby(r, host) is True)
        ph = phone(r, 'Sam')
        time.sleep(1)
        click(r, host, 'startBtn')
        ok('the TV is on the bingo board', r.until(tv, '!document.getElementById("tvRun").classList.contains("hidden") || !document.getElementById("tvLobby").classList.contains("hidden")', 15) is True)
        time.sleep(1)
        worst = 0; behind_at = []; tries = 0
        while (r.ask(host, HOST_N) or 0) < CALLS and tries < CALLS * 3:
            tries += 1
            n = call_one(r, host)
            good, saw = in_step(r, tv, ph, host, 2.0)
            if not good: behind_at.append(saw)
            worst = max(worst, saw['waited'])
            time.sleep(0.15)
        ok('%d fast calls: after EVERY call the TV and the phone show the console\'s count and ball within 2 s' % CALLS,
           not behind_at, behind_at[:3])
        ok('CONTROL: the console called %d numbers' % CALLS, r.ask(host, HOST_N) == CALLS, r.ask(host, HOST_N))
        good, saw = in_step(r, tv, ph, host, 2.0)
        ok('after the last call the TV, the phone and the console agree (count %s, ball %s)' % (saw['console'][0], saw['console'][1]), good, saw)
        tv_prev = r.ask(tv, '[].map.call(document.querySelectorAll("#tvPrev .prevball"),function(e){return e.textContent.trim();}).join(",")')
        ph_prev = r.ask(ph, '[].map.call(document.querySelectorAll(".lcchips > *"),function(e){return e.textContent.trim();}).join(",")')
        ok('and the TV\'s strip is the five before the ball, newest first, as the phone\'s', bool(tv_prev) and tv_prev == ph_prev, [tv_prev, ph_prev])
        shot(r, tv, 'instep-tv-%s' % ('old' if throttle else 'new'))
        if deaf_test:
            print('   a TV that goes deaf for eight calls, then hears again with no new call')
            r.ask(tv, 'window.__deaf=true; true')
            for i in range(8): call_one(r, host); time.sleep(0.3)
            ok('CONTROL: the deaf TV fell behind', (r.ask(tv, TV_SEES) or {}).get('n', 0) < r.ask(host, HOST_N), [r.ask(tv, TV_SEES), r.ask(host, HOST_N)])
            r.ask(tv, 'window.__deaf=false; true')
            want = r.ask(host, HOST_N)
            caught = r.until(tv, TV_SEES + '.n===%d' % want, 20)
            ok('the TV catches up by itself, with no new call, inside 20 s of hearing again', caught is True, [r.ask(tv, TV_SEES), want])
    finally:
        r.close()


if __name__ == '__main__':
    night('1. A NEW TV ENGINE: 30 fast calls, the TV keeps step with the phone', deaf_test=True)
    night('2. AN OLD TV ENGINE (Chromium 68 to 94 rewrite, CPU six times slower): 30 fast calls', tv_query='&oldtv=68', throttle=6)
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
