#!/usr/bin/env python3
"""THE BINGO HOST CONSOLE FITS ONE PHONE SCREEN DURING A GAME (Dean, live, 15 Nov 2026).

Dean: "my one rule is to make everything easier". During a game the "Allow early BINGO calls" row was the first
thing on the console and the claim queue sat far down, below the stats, the last ball, the prize line and Next
number, so on a phone a claim was below the fold.

This opens a REAL night on the browser rig (a signed-in host on /app/, a real phone on /play, the real game
Worker in jsc), with early calls allowed, at a phone-sized console, and at 375x667 and 390x844 checks, after a
couple of balls and again with the phone's BINGO call in the queue:

  - the page is not scrolled and has no sideways scroll
  - Next number (#nextBtn) and the last ball (#lastBallVal) are wholly inside the screen
  - the claim queue heading and its first box (the empty note, or the claim's name line) are inside it
  - the early-calls switch is behind one closed "Settings" control (#hostSettings), and that control sits BELOW
    the claim queue, never above it (put the row back on top and this goes red)

and that the switch still works from there: opened, it is on screen, ticked (as set before the game), and a tap
turns early calls off for the setup box too (the same G.allowEarly), and back on.

Layout only: no draw, claim or win logic is touched by the change this suite watches.

PNG screenshots of each state at each size go to $VP_SHOTS when it is set.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/bingo-console-fits-phone-in-chrome.test.py
"""
import base64, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SIZES = ((375, 667), (390, 844))


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def click(r, sid, i): r.ask(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i))


HOST_N = '(function(){var m=/(\\d+)/.exec((document.getElementById("liveCount")||{}).textContent||"");return m?+m[1]:0;})()'
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+JSON.stringify(window.__errs)'

MEASURE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0 && b.height>0)) return null; return {top:Math.round(b.top), bottom:Math.round(b.bottom)}; }
  function V(e){ return (e && e.checkVisibility && !e.checkVisibility()) ? null : R(e); }
  var q=document.getElementById("claimQueue"), first=q && q.firstElementChild;
  if(first && first.classList.contains("tiebar")) first=first.nextElementSibling;
  var top=first && (first.querySelector(".top")||first);
  var hs=document.getElementById("hostSettings"), sum=hs && hs.querySelector("summary");
  return JSON.stringify({ h:innerHeight, w:innerWidth, sy:Math.round(scrollY||0), sw:document.documentElement.scrollWidth,
    next:R(document.getElementById("nextBtn")), ball:R(document.getElementById("lastBallVal")),
    head:R(document.getElementById("claimLbl")), first:R(top), firstText: first ? first.textContent.replace(/\s+/g," ").trim().slice(0,80) : null,
    queue:R(q), settings:R(hs), summary:R(sum), summaryText: sum ? sum.textContent.replace(/\s+/g," ").trim() : null, open: hs ? !!hs.open : null,
    early:V(document.getElementById("allowEarlyLiveRow")) });
})()'''


def size(r, sid, w, h):
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    time.sleep(0.6)
    r.ask(sid, 'window.scrollTo(0,0); true')
    time.sleep(0.3)


def png(r, sid, name):
    if not SHOTS: return
    try:
        d = r.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        with open(os.path.join(SHOTS, name), 'wb') as f: f.write(base64.b64decode(d['data']))
    except Exception as e:
        print('  (screenshot %s not saved: %s)' % (name, e))


def fits(r, sid, state, first_has):
    for (w, h) in SIZES:
        size(r, sid, w, h)
        m = r.json(sid, MEASURE)
        tag = '%s at %dx%d' % (state, w, h)
        png(r, sid, 'bingo-host-%s-%dx%d.png' % (state, w, h))
        n, b, hd, f, s = m.get('next'), m.get('ball'), m.get('head'), m.get('first'), m.get('settings')
        ok(tag + ': the page is not scrolled and nothing runs off the side', m['sy'] == 0 and m['sw'] <= m['w'], m)
        ok(tag + ': Next number and the last ball are wholly on screen',
           bool(n) and bool(b) and n['top'] >= 0 and b['top'] >= 0 and n['bottom'] <= m['h'] and b['bottom'] <= m['h'], m)
        ok(tag + ': the claim queue heading and its first line (%s) are on screen' % first_has,
           bool(hd) and bool(f) and hd['top'] >= 0 and f['bottom'] <= m['h'] and first_has in (m.get('firstText') or ''), m)
        ok(tag + ': early calls are behind one closed "Settings" control', m['open'] is False and bool(m['summary'])
           and (m['summaryText'] or '').startswith('Settings') and m['early'] is None, m)
        ok(tag + ': and that control sits below the claim queue, never above Next number',
           bool(s) and bool(m.get('queue')) and bool(n) and s['top'] >= m['queue']['bottom'] and s['top'] > n['bottom'], m)


def call_one(r, host):
    """Next number, as the host taps it: a tap while the last ball is still settling is let go, so tap again every 2 s."""
    before = r.ask(host, HOST_N) or 0
    for _ in range(8):
        click(r, host, 'nextBtn')
        if r.until(host, HOST_N + '>%d' % before, 2) is True: break
    return r.ask(host, HOST_N) or 0


def play():
    print('\nTHE BINGO HOST CONSOLE ON A PHONE (a real night, early calls allowed)')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    r = RIG.Rig()
    try:
        tid, host = r.open('/app/?sting=0', width=390, height=844)
        ok('CONTROL: the console loads, signed in, on the games menu',
           r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True)
        r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
        time.sleep(1.5)
        r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                     '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";'
                     '$("allowEarlyChk").checked=true;$("allowEarlyChk").dispatchEvent(new Event("change"));true'))
        opened = False
        for _ in range(2):
            click(r, host, 'startBtn'); time.sleep(1.2)
            if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
                r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)
            if r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 8) is True:
                opened = True; break
        ok('CONTROL: the lobby opens', opened, r.ask(host, ERRT))
        ptid, ph = r.open('/play?room=' + r.W.info['code'] + '&sting=0', width=390, height=844)
        r.phone_ready(ph)
        r.ask(ph, 'document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
        ok('CONTROL: the phone joins', r.until(ph, '!document.getElementById("vWait").classList.contains("hidden")', 25) is True,
           r.ask(ph, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        time.sleep(1)
        for _ in range(3):
            click(r, host, 'startBtn')
            if r.until(host, '!document.getElementById("liveBlock").classList.contains("hidden")', 15) is True: break
        ok('CONTROL: the game is on and the phone holds its ticket',
           r.until(ph, '!document.getElementById("vCard").classList.contains("hidden")', 60) is True, r.ask(host, ERRT))
        call_one(r, host); call_one(r, host)
        ok('CONTROL: two balls are called', (r.ask(host, HOST_N) or 0) >= 2, r.ask(host, HOST_N))
        time.sleep(1)
        fits(r, host, 'calling', 'No claims yet')

        # THE SWITCH STILL WORKS FROM THERE
        size(r, host, 390, 844)
        r.ask(host, '(function(){ var s=document.querySelector("#hostSettings summary"); if(s) s.click(); return true; })()'); time.sleep(0.5)
        r.ask(host, '(function(){ var e=document.getElementById("hostSettings"); if(e) e.scrollIntoView({block:"start"}); return true; })()'); time.sleep(0.4)
        s = r.json(host, '(function(){ var e=document.getElementById("allowEarlyLive"), b=e.getBoundingClientRect(), hs=document.getElementById("hostSettings");'
                         'return JSON.stringify({open:!!hs && hs.open, on:b.height>0 && b.top>=0 && b.bottom<=innerHeight && !!e.checkVisibility(), ticked:e.checked}); })()')
        ok('opened, the Settings show "Allow early BINGO calls" on screen, ticked as set before the game',
           s.get('open') is True and s.get('on') is True and s.get('ticked') is True, s)
        png(r, host, 'bingo-host-settings-open-390x844.png')
        r.ask(host, 'document.getElementById("allowEarlyLive").click(); true'); time.sleep(0.4)
        off = r.ask(host, 'document.getElementById("allowEarlyChk").checked')
        r.ask(host, 'document.getElementById("allowEarlyLive").click(); true'); time.sleep(0.4)
        on = r.ask(host, 'document.getElementById("allowEarlyChk").checked')
        ok('a tap there turns early calls off for the whole game (the setup box follows), and a second tap back on', off is False and on is True, [off, on])
        r.ask(host, 'var hs=document.getElementById("hostSettings"); if(hs) hs.open=false; window.scrollTo(0,0); true'); time.sleep(0.4)

        # A CLAIM IN THE QUEUE: the phone calls BINGO early (allowed), so it lands with the host
        r.ask(ph, 'document.getElementById("bingoBtn").click(); true')
        ok('CONTROL: the phone\'s BINGO call reaches the claim queue',
           r.until(host, 'document.querySelectorAll("#claimQueue .claimcard").length>=1', 25) is True,
           r.ask(host, 'document.getElementById("claimQueue").innerText.slice(0,200)'))
        time.sleep(1.2)
        fits(r, host, 'claim', 'Ann')
        ok('no script errors on the console', r.ask(host, 'window.__errs.length') == 0, r.ask(host, 'JSON.stringify(window.__errs)'))
        r.close_tab(ptid); r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('bingo-console-fits-phone-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    try:
        play()
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
