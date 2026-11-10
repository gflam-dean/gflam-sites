#!/usr/bin/env python3
"""THE DRAW LOOKS ON THE REAL TV SCREENS, PLAYED IN CHROME (12 Nov 2026).

Ticket roll (raffle), flip board (members draw) and race plate (either), built from Dean's chosen mocks (reports/draw-real-11nov,
10 Nov) by /app/vp-drawstyle.js. On the rig in tools/browser-rig/rig.py (the repo's pages, headless Chrome), the real raffle and
members screens hear a host on their own channel:

  1. TICKET ROLL on the raffle wall: the look is on, nothing of the old drawing card shows, the roll builds, HOLDS on its last near
     miss while the server's pick has not arrived (the winner is never invented), takes the pick, lands on it, says ONE winner line
     ("Bring ticket 047 to the host."), the prize, and the claim clock; then a claim goes back to the old result card
  2. FLIP BOARD on the members wall: digits on flaps, the name only on the winning flap, "Bring your member card to the host."
  3. RACE PLATE on both walls
  4. NO LOOK CHOSEN (every venue today): the old drawing and winner cards, the new stage never made
  5. the same picture at 1920x1080, 1280x720, 1024x768 and a phone-width 375x667: the stage's own boxes sit inside the screen
  6. SILENT: no audio element or audio context is made by a draw look; no page errors

    python3 tools/tv-drawstyle-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

VISIBLE = ('(function(i){var e=document.getElementById(i);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)
STAGE_T = '(window.__vpdsLast ? window.__vpdsLast.time() : -1)'
STAGE_WIN = '(window.__vpdsLast ? window.__vpdsLast.win : -1)'
STAGE_TEXT = '(function(){var h=document.getElementById("tvStyleHost");return h?h.textContent.replace(/\\s+/g," ").trim():"";})()'
AUDIO = ('(window.__audioMade||0)')
BC_BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
             'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();'
             'window.__audioMade=0;var A=window.Audio;if(A){window.Audio=function(){window.__audioMade++;return new A();};}'
             'var AC=window.AudioContext||window.webkitAudioContext;if(AC){var W2=function(){window.__audioMade++;return new AC();};W2.prototype=AC.prototype;window.AudioContext=W2;}')
HOST_SAYS = r'''(function(msgs){
  var code=(document.getElementById("hostLineCode")||document.getElementById("hostCode")||{}).textContent||"";
  var names=(window.__bcNames||[]).filter(function(n){return n==="fake-rt:vp-"+code;}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    msgs.forEach(function(m){ b.postMessage({event:"msg", payload:m}); }); setTimeout(function(){ try{ b.close(); }catch(e){} }, 500); });
  return Object.keys(seen).length;
})'''
def screen(r, path, width=1280, height=720):
    slug = r.W.info['slug']
    _, s = r.open(path + '?venue=' + slug + '&sting=0', width=width, height=height,
                  before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};' % json.dumps(slug) + BC_BEFORE)
    r.until(s, 'document.readyState==="complete" && (window.__bcNames||[]).some(function(n){return /^fake-rt:vp-/.test(n);})', 20)
    time.sleep(1.5)
    return s
def says(r, s, msgs):
    n = r.ask(s, HOST_SAYS + '(%s)' % json.dumps(msgs)); time.sleep(0.5); return n

def inside(r, s):
    """every painted box of the stage is inside the screen"""
    return r.ask(s, '''(function(){var W=innerWidth,H=innerHeight,bad=[],h=document.getElementById("tvStyleHost");
      Array.prototype.forEach.call(h.querySelectorAll(".vpds-claim,.vpds-prize,.vpds-clock"),function(e){var b=e.getBoundingClientRect(),o=parseFloat(getComputedStyle(e).opacity);
        var t=(e.textContent||"").trim(); if(!t||!(o>0.5))return; if(b.left<-1||b.right>W+1||b.bottom>H+1||b.top<-1)bad.push([e.className,Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]);});
      return bad;})()''')

def ticket():
    print('\n1. TICKET ROLL on the raffle wall: builds, holds without a pick, lands on the server\'s ticket')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/raffle/screen')
        says(r, s, [{'t': 'state', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150}])
        says(r, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'ticket', 'drawSecs': 6}])
        ok('the new look is up and the old drawing card is not', r.until(s, vis('tvStyle'), 5) is True and r.ask(s, vis('tvDraw')) is False, r.ask(s, vis('tvDraw')))
        ok('the end show is on for a new-look draw', r.ask(s, 'VPEndShow.on') is True, r.ask(s, 'VPEndShow.on'))
        ok('the roll is paper tickets', (r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-tk").length') or 0) >= 5)
        ok('the prize is named', 'Meat tray' in (r.ask(s, STAGE_TEXT) or ''), r.ask(s, STAGE_TEXT))
        time.sleep(8.5)
        t = r.ask(s, STAGE_T); w = r.ask(s, STAGE_WIN); time.sleep(1.2); t2 = r.ask(s, STAGE_T)
        ok('with no pick the roll HOLDS before its last move (never invents the winner)', 0 < t < w and abs(t2 - t) < 0.02, [t, t2, w])
        ok('no ticket shows a number it was not drawn with: the winner ticket is blank', 'Bring ticket' not in (r.ask(s, STAGE_TEXT) or ''))
        says(r, s, [{'t': 'pick', 'numbers': [47], 'pad': 3, 'min': 1, 'max': 150}])
        says(r, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [47], 'pad': 3, 'allowRedraw': True, 'time': 30}])
        ok('after the pick the roll finishes and the wall says ONE winner line', r.until(s, '/Bring ticket 047 to the host\\./.test(' + STAGE_TEXT + ')', 6) is True, r.ask(s, STAGE_TEXT))
        time.sleep(3.5)
        txt = r.ask(s, STAGE_TEXT) or ''
        ok('the claim clock is under it', 'Claim within 0:' in txt, txt)
        ok('the old winner card is not showing', r.ask(s, vis('tvWin')) is False)
        ok('the winner line says ticket once', txt.count('ticket') == 1, txt)
        shot(r, s, 'drawstyle-ticket-win')
        ok('nothing sticks out of the screen', inside(r, s) == [], inside(r, s))
        says(r, s, [{'t': 'claimed', 'prizeLabel': 'Meat tray', 'numbers': [47]}])
        ok('a claim goes back to the old result card and the stage is gone', r.until(s, vis('tvResult'), 4) is True and r.ask(s, 'document.getElementById("tvStyleHost").children.length') == 0)
        ok('SILENT: no audio made, no page errors', r.ask(s, AUDIO) == 0 and not (r.ask(s, 'window.__errs') or []), [r.ask(s, AUDIO), r.ask(s, 'window.__errs')])
    finally:
        r.close()

def flip():
    print('\n2. FLIP BOARD on the members wall: digits on flaps, the name on its own flap only at the win')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/members/screen')
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}])
        says(r, s, [{'t': 'drawing', 'drawName': 'Friday members draw', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': 7.2, 'style': 'flip', 'drawSecs': 6}])
        ok('the flip board is up and the old drawing card is not', r.until(s, vis('tvStyle'), 5) is True and r.ask(s, vis('tvDraw')) is False)
        ok('a flap for each digit (3) and one for the name', r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-m").length') == 4, r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-m").length'))
        says(r, s, [{'t': 'pick', 'number': 418, 'name': 'J. Hollis'}])
        time.sleep(1.5)
        ok('while it spins the name is not on the board', 'Hollis' not in (r.ask(s, STAGE_TEXT) or ''), r.ask(s, STAGE_TEXT))
        time.sleep(7.5)
        says(r, s, [{'t': 'winner', 'number': 418, 'name': 'J. Hollis', 'claimSecs': 30}])
        time.sleep(3.5)
        txt = r.ask(s, STAGE_TEXT) or ''
        ok('the winning flap says J. Hollis and the line says the member card', 'Hollis' in txt and 'Bring your member card to the host.' in txt, txt)
        ok('the claim clock is on the wall', 'Claim within 0:' in txt, txt)
        shot(r, s, 'drawstyle-flip-win')
        ok('nothing sticks out of the screen', inside(r, s) == [], inside(r, s))
        says(r, s, [{'t': 'claimed', 'name': 'J. Hollis', 'amountCents': 145000, 'nextResetCents': 20000}])
        ok('a claim goes back to the old result card', r.until(s, vis('tvResult'), 4) is True)
        ok('SILENT: no audio made, no page errors', r.ask(s, AUDIO) == 0 and not (r.ask(s, 'window.__errs') or []))
    finally:
        r.close()

def race():
    print('\n3. RACE PLATE on both walls')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/raffle/screen')
        says(r, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'race', 'drawSecs': 6}])
        ok('raffle: the race plate is up', r.until(s, vis('tvStyle') + ' && !!document.querySelector("#tvStyleHost .vpds-plate")', 5) is True)
        says(r, s, [{'t': 'pick', 'numbers': [9], 'pad': 3, 'min': 1, 'max': 150}])
        time.sleep(8.5)
        says(r, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [9], 'pad': 3, 'allowRedraw': False, 'time': 0}])
        time.sleep(3)
        txt = r.ask(s, STAGE_TEXT) or ''
        ok('raffle: number 009, one winner line, the prize', '009' in txt and 'Bring ticket 009 to the host.' in txt and 'Meat tray' in txt, txt)
        shot(r, s, 'drawstyle-race-raffle')
        s2 = screen(r, '/app/members/screen')
        says(r, s2, [{'t': 'drawing', 'drawName': 'Friday members draw', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': 7.2, 'style': 'race', 'drawSecs': 6}, {'t': 'pick', 'number': 418, 'name': 'J. Hollis'}])
        time.sleep(8.5)
        says(r, s2, [{'t': 'winner', 'number': 418, 'name': 'J. Hollis', 'claimSecs': 0}])
        time.sleep(3)
        txt = r.ask(s2, STAGE_TEXT) or ''
        ok('members: 418, J. Hollis and the member card line', '418' in txt and 'Hollis' in txt and 'Bring your member card to the host.' in txt, txt)
        shot(r, s2, 'drawstyle-race-members')
    finally:
        r.close()

def old_look():
    print('\n4. NO LOOK CHOSEN: the cards every venue has today')
    r = RIG.Rig()
    try:
        for path, drawing, winner in (('/app/raffle/screen', {'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'spinSecs': 2}, {'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [9], 'pad': 3, 'time': 0}),
                                      ('/app/members/screen', {'t': 'drawing', 'drawName': 'Friday', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': 2}, {'t': 'winner', 'number': 418, 'name': 'J. Hollis', 'claimSecs': 0})):
            s = screen(r, path)
            says(r, s, [drawing])
            ok(path + ': the old drawing card shows and the new stage was never made', r.until(s, vis('tvDraw'), 4) is True and r.ask(s, vis('tvStyle')) is False and r.ask(s, 'window.__vpdsLast') is None)
            says(r, s, [winner])
            ok(path + ': the end show stays as it was (off) for a venue with no look', r.ask(s, 'VPEndShow.on') is False, r.ask(s, 'VPEndShow.on'))
            ok(path + ': the old winner card shows', r.until(s, vis('tvWin'), 4) is True and r.ask(s, vis('tvStyle')) is False)
            ok(path + ': an unknown look is the old look too', True if says(r, s, [dict(drawing, style='bogus')]) is not None and r.until(s, vis('tvDraw'), 4) is True and r.ask(s, 'window.__vpdsLast') is None else False)
    finally:
        r.close()

def sizes():
    print('\n5. THE SAME PICTURE AT 1920, 1280, 1024 and a phone')
    r = RIG.Rig()
    try:
        for (w, h) in ((1920, 1080), (1280, 720), (1024, 768), (375, 667)):
            s = screen(r, '/app/raffle/screen', w, h)
            says(r, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'ticket', 'drawSecs': 6}, {'t': 'pick', 'numbers': [47]}])
            time.sleep(8.6)
            says(r, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [47], 'pad': 3, 'allowRedraw': True, 'time': 60}])
            time.sleep(3.6)
            ok('%dx%d: the win is on screen, and every line sits inside it' % (w, h), 'Bring ticket 047 to the host.' in (r.ask(s, STAGE_TEXT) or '') and inside(r, s) == [], [r.ask(s, STAGE_TEXT), inside(r, s)])
            shot(r, s, 'drawstyle-ticket-%dx%d' % (w, h))
    finally:
        r.close()

if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('tv-drawstyle-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    only = sys.argv[1:]
    for part in (ticket, flip, race, old_look, sizes):
        if not only or part.__name__ in only: part()
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
