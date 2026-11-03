#!/usr/bin/env python3
"""THE END-OF-GAME SHOW, PLAYED FOR REAL (2 Nov 2026): the bookend to the start-of-game show.

When a game ends the TV plays a ~6 second show in the start show's look: the result (the winner, or the
top three), then THANKS FOR PLAYING and the venue's name, then the wall underneath. /app/vp-endshow.js,
OFF unless ?endshow=1 on the TV's address (a TV hands the switch on to the game screen in its frame).

On the rig in tools/browser-rig/rig.py (the repo's pages, the real game Worker in jsc, headless Chrome):
  1. BINGO, a real-balls night on the real console and the real TV: Winner, Confirm, Finish this game
     plays nothing (the start-of-game show is switched off with ?sting=0 here, so the two never mix); End game plays the show over the ads ("BINGO!", "WE HAVE A WINNER", "One line ·
     Meat tray", THANKS FOR PLAYING, TEST ALPHA), then it goes and the ads are up. A TV without the
     switch shows nothing new. A second game: the next game's first word stops the show at once.
  2. The sales-page bingo demo (tv.html?demo=1): a phone winner is named, "TABLE 4".
  3. MUSICAL BINGO, the real musical console and the real TV: the TV embeds the musical screen, a song
     plays, End game: the screen in the frame plays the close, the TV keeps the frame up until it has
     finished, then the ads. The musical demo: its winner, named.
  4. TRIVIA, the demo: the podium plays the top three teams with their scores, the podium is still up
     after the show (the final scores wait for it).
  5. RAFFLE, the real raffle screen hearing a host's draws on its own channel: two prizes drawn and claimed,
     so the winning tickets as rows with their prizes, once the last claim's celebration is over; a prize
     with more to come plays nothing; Back to ads waits for the show. (The sales-page raffle demo loops
     before its last celebration ends, so it never reaches the end of a raffle.)
  6. The show itself on a real screen, stepped frame by frame: every line inside the screen at
     1920x1080, 1280x720, 1024x768 and a portrait 1080x1920; long names scaled to fit; a name made of
     HTML shown as text; lowercase venueplay inside a venue's name; reduced motion: nothing moves and
     nothing flickers; without the switch nothing plays.
  7. Its logo is the start show's logo: the path data and triangle geometry are the same in both files.

    python3 tools/tv-endshow-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG
import gatelib

ROOT = os.path.dirname(HERE)
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
def text(r, sid, i): return r.ask(sid, '((document.getElementById(%s)||{}).textContent||"").replace(/\\s+/g," ").trim()' % json.dumps(i))
def tap(r, sid, i): r.ask(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i)); time.sleep(0.8)
STATS = '(window.VPEndShow ? VPEndShow.stats() : null)'
SHOWN = '(window.VPEndShow ? VPEndShow.shown() : null)'
FRAME = 'document.getElementById("gameFrame").contentWindow'
DOT = '·'

# Every painted line of the show, measured: [id or class, left, top, right, bottom], only the visible ones
BOXES = r'''(function(){
  var o=[], W=innerWidth, H=innerHeight, root=document.getElementById("vpEndShow"); if(!root) return null;
  var els=root.querySelectorAll(".vpe-t span, .vpe-row, .vpe-main span, .vpe-tail span, #vpeWord, #vpeTg");
  Array.prototype.forEach.call(els, function(e){
    var p=e.closest(".vpe-t, .vpe-row") || e, op=parseFloat(getComputedStyle(p).opacity);
    if(e.id==="vpeWord") op=parseFloat(getComputedStyle(e).opacity);
    if(!(op>0.5)) return;
    var b=e.getBoundingClientRect(); if(!b.width) return;
    o.push([e.id || (p.id||"")+" "+e.className, Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]);
  });
  return { W:W, H:H, boxes:o };
})()'''

def outside(m):
    if not m: return ['no show on screen']
    return [b for b in m['boxes'] if b[1] < -1 or b[2] < -1 or b[3] > m['W'] + 1 or b[4] > m['H'] + 1]


# ======================================================================================
def console(r):
    tid, host = r.open('/app/?sting=0', width=1024, height=1100)
    ok('the console loads, signed in, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    return host

def start_caller_night(r, host, pattern, prize, numbers):
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("callerChk").checked=true;$("callerChk").dispatchEvent(new Event("change"));'
                 '$("patternSel").value=%s;$("patternSel").dispatchEvent(new Event("change"));$("prizeInput").value=%s;true') % (json.dumps(pattern), json.dumps(prize)))
    for _ in range(2):
        tap(r, host, 'startBtn'); time.sleep(0.8)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)
        r.until(host, '/Start/i.test(document.getElementById("startBtn").textContent) || ' + vis('callerGrid'), 10)
    up = r.until(host, vis('callerGrid'), 10)
    for n in numbers:
        r.ask(host, 'document.querySelector(\'#callerGrid [data-n="%d"]\').click(); true' % n); time.sleep(0.35)
    time.sleep(1.2)
    return up

def tv(r, endshow=True, width=1280, height=720):
    _, sid = r.open('/tv?venue=' + r.W.info['slug'] + '&sting=0' + ('&endshow=1' if endshow else ''), width=width, height=height)
    ok('the TV loads on the ads' + ('' if endshow else ' (no switch)'), r.until(sid, vis('adsRoot'), 15) is True)
    time.sleep(1.5)
    return sid


def bingo():
    print('\n1. BINGO: a real-balls night, the real console and the real TV')
    r = RIG.Rig()
    try:
        t1 = tv(r)
        t0 = tv(r, endshow=False, width=1024, height=576)
        ok('the TV has the end-of-game show switched on; the other TV does not', r.ask(t1, '!!(window.VPEndShow && VPEndShow.on)') is True and r.ask(t0, 'window.VPEndShow && VPEndShow.on') is False)
        host = console(r)
        ok('a real-balls night for One line, Meat tray, is up', start_caller_night(r, host, 'one', 'Meat tray', [5, 17, 42, 61, 88]) is True)
        tap(r, host, 'callerWinBtn'); tap(r, host, 'callerConfirmBtn')
        ok('CONTROL: Confirm win celebrates on the TV', r.until(t1, vis('tvWin'), 8) is True)
        ok('the celebration plays no show: the winner card is the room\'s moment', (r.ask(t1, STATS) or {}).get('plays') == 0, r.ask(t1, STATS))
        r.ask(host, '(function(){var b=document.querySelector(\'#cwNextBtns [data-next=""]\'); if(b) setTimeout(function(){ b.click(); }, 0); return !!b;})()'); time.sleep(1.2)
        ok('Finish this game: still no show, the winner stays up', (r.ask(t1, STATS) or {}).get('plays') == 0 and r.ask(t1, vis('tvWin')) is True, r.ask(t1, STATS))
        tap(r, host, 'endGameBtn')
        ok('End game: the TV plays the end-of-game show', r.until(t1, 'window.VPEndShow && VPEndShow.playing()', 6) is True, r.ask(t1, STATS))
        s = r.ask(t1, SHOWN) or {}
        ok('it says BINGO! and WE HAVE A WINNER (a paper book has no name), with the stage and the prize',
           s.get('eye') == 'BINGO!' and s.get('big') == 'WE HAVE A WINNER' and s.get('sub') == 'One line ' + DOT + ' Meat tray', s)
        ok('then THANKS FOR PLAYING and the venue\'s name', s.get('thanks') == 'THANKS FOR PLAYING' and s.get('venue') == 'TEST ALPHA', s)
        ok('the ads are already up underneath it', r.ask(t1, vis('adsRoot')) is True and r.ask(t1, vis('tvWin')) is False)
        time.sleep(1.2); shot(r, t1, 'endshow-1-bingo-result')
        m = r.ask(t1, BOXES)
        ok('every line of the result is on the screen (1280x720)', m and len(m['boxes']) >= 3 and not outside(m), outside(m) or m)
        time.sleep(2.6); shot(r, t1, 'endshow-1-bingo-thanks')
        m = r.ask(t1, BOXES)
        ok('every line of the close is on the screen, the wordmark too', m and any(b[0] == 'vpeWord' for b in m['boxes']) and not outside(m), outside(m) or m)
        ok('the show finishes in full, in about six seconds, and is gone', r.until(t1, 'VPEndShow.stats().last==="done"', 5) is True and r.ask(t1, '!document.getElementById("vpEndShow")') is True, r.ask(t1, STATS))
        ok('and the venue\'s ads are the wall', r.ask(t1, vis('adsRoot')) is True)
        shot(r, t1, 'endshow-1-bingo-after')
        ok('the TV without the switch: no show, straight to the ads as before', r.ask(t0, '!document.getElementById("vpEndShow") && VPEndShow.stats().plays===0') is True and r.ask(t0, vis('adsRoot')) is True)

        print('\n   the next game stops the show at once')
        ok('a second real-balls night is up', start_caller_night(r, host, 'one', 'Bar tab', [3, 9]) is True)
        tap(r, host, 'endGameBtn')
        ok('End game with no winner: the close on its own (no result)', r.until(t1, 'window.VPEndShow && VPEndShow.playing()', 6) is True and
           (r.ask(t1, SHOWN) or {}).get('big') == '' and (r.ask(t1, SHOWN) or {}).get('dur', 0) < 4, r.ask(t1, SHOWN))
        r.ask(host, 'document.getElementById("callerChk").checked=true; true')
        tap(r, host, 'startBtn')
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true')
        ok('the next game\'s first word stops the show at once', r.until(t1, 'VPEndShow.stats().last==="next" && !document.getElementById("vpEndShow")', 6) is True, r.ask(t1, STATS))
        ok('no page errors on the TVs or the console', not (r.ask(t1, 'window.__errs') or []) and not (r.ask(t0, 'window.__errs') or []) and not (r.ask(host, 'window.__errs') or []),
           [r.ask(t1, 'window.__errs'), r.ask(t0, 'window.__errs'), r.ask(host, 'window.__errs')])
    finally:
        r.close()


def demos():
    print('\n2. The sales-page demos, each the real screen playing its own scripted game')
    r = RIG.Rig()
    try:
        _, d = r.open('/tv?demo=1&endshow=1', width=1920, height=1080)
        ok('bingo demo: the game ends and the show plays', r.until(d, 'window.VPEndShow && VPEndShow.playing()', 60) is True, r.ask(d, STATS))
        s = r.ask(d, SHOWN) or {}
        ok('bingo demo: the phone winner by name: WE HAVE A WINNER, TABLE 4, One line · $50 bar tab',
           s.get('eye') == 'WE HAVE A WINNER' and s.get('big') == 'TABLE 4' and s.get('sub') == 'One line ' + DOT + ' $50 bar tab' and s.get('venue') == 'TUGUN BOWLS CLUB', s)
        time.sleep(1.4); shot(r, d, 'endshow-2-bingo-demo')

        print('\n3. MUSICAL BINGO (demo)')
        _, mu = r.open('/app/musical/screen?demo=1&endshow=1', width=1280, height=720)
        ok('musical demo: End game plays the show, the winner named', r.until(mu, 'window.VPEndShow && VPEndShow.playing()', 70) is True and
           (r.ask(mu, SHOWN) or {}).get('kind') == 'musical' and (r.ask(mu, SHOWN) or {}).get('big') not in ('', None), r.ask(mu, SHOWN))
        ok('musical demo: then THANKS FOR PLAYING at the demo venue', (r.ask(mu, SHOWN) or {}).get('venue') == 'TUGUN BOWLS CLUB', r.ask(mu, SHOWN))
        time.sleep(1.4); shot(r, mu, 'endshow-3-musical-demo')

        print('\n4. TRIVIA (demo)')
        _, tr = r.open('/app/trivia/screen?demo=1&endshow=1', width=1280, height=720)
        ok('trivia: the podium plays the show', r.until(tr, 'window.VPEndShow && VPEndShow.playing()', 70) is True, r.ask(tr, STATS))
        s = r.ask(tr, SHOWN) or {}
        ok('trivia: FINAL SCORES, the top three teams, first at the top, each with its place and score',
           s.get('eye') == 'FINAL SCORES' and s.get('rows') == [['1', 'THE QUIZTOPHER NOLANS', '840'], ['2', 'TABLE 6', '790'], ['3', "NAN'S ARMY", '735']], s)
        time.sleep(1.6); shot(r, tr, 'endshow-4-trivia-result')
        m = r.ask(tr, BOXES)
        ok('trivia: the three rows are on the screen', m and len([b for b in m['boxes'] if re.match(r'^vpeRow\d$', b[0])]) == 3 and not outside(m), outside(m) or m)
        ok('trivia: the show finishes', r.until(tr, 'VPEndShow.stats().last==="done"', 8) is True, r.ask(tr, STATS))
        ok('trivia: and the podium is still up after it, not cut short by the final scores', r.ask(tr, vis('tvPodium')) is True and r.ask(tr, vis('tvBoard')) is False)

        ok('no page errors on the demo screens', all(not (r.ask(x, 'window.__errs') or []) for x in (d, mu, tr)),
           [r.ask(x, 'window.__errs') for x in (d, mu, tr)])
    finally:
        r.close()


# The raffle screen on a venue's channel, hearing a host: the fake realtime is a BroadcastChannel per channel name
BC_BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
             'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();')
HOST_SAYS = r'''(function(msgs){
  /* ONLY the raffle's own channel (its code is on the wall): a draw on another game's channel would hop this screen to that game */
  var code=(document.getElementById("hostLineCode")||{}).textContent||"";
  var names=(window.__bcNames||[]).filter(function(n){return n==="fake-rt:vp-"+code;}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    msgs.forEach(function(m){ b.postMessage({event:"msg", payload:m}); }); setTimeout(function(){ try{ b.close(); }catch(e){} }, 500); });
  return Object.keys(seen).length;
})'''
def raffle_screen(r, before='', width=1280, height=720):
    slug = r.W.info['slug']
    _, s = r.open('/app/raffle/screen?venue=' + slug + '&sting=0&endshow=1', width=width, height=height,
                  before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};' % json.dumps(slug) + BC_BEFORE + before)
    r.until(s, 'document.readyState==="complete" && !!window.VPEndShow && (window.__bcNames||[]).some(function(n){return /^fake-rt:vp-/.test(n);})', 20)
    time.sleep(1.5)
    return s
def host_says(r, s, msgs):
    n = r.ask(s, HOST_SAYS + '(%s)' % json.dumps(msgs)); time.sleep(0.6); return n
def two_draws(r, s):
    host_says(r, s, [{'t': 'state', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 200}])
    host_says(r, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'spinSecs': 1}]); time.sleep(1.2)
    host_says(r, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [42], 'time': 0}])
    host_says(r, s, [{'t': 'claimed', 'prizeLabel': 'Meat tray', 'numbers': [42]}])
    host_says(r, s, [{'t': 'idle', 'next': True, 'prizeLabel': '$50 bar tab', 'pad': 3, 'min': 1, 'max': 200}])
    host_says(r, s, [{'t': 'drawing', 'prizeLabel': '$50 bar tab', 'spinSecs': 1}]); time.sleep(1.2)
    host_says(r, s, [{'t': 'winner', 'prizeLabel': '$50 bar tab', 'numbers': [7, 118], 'time': 0}])
    host_says(r, s, [{'t': 'claimed', 'prizeLabel': '$50 bar tab', 'numbers': [7, 118]}])
    host_says(r, s, [{'t': 'idle', 'next': False, 'prizeLabel': '', 'pad': 3, 'min': 1, 'max': 200}])

def raffle():
    print('\n5. RAFFLE: the real raffle screen, hearing a host draw two prizes')
    r = RIG.Rig()
    try:
        s = raffle_screen(r)
        two_draws(r, s)
        ok('CONTROL: the second claim is celebrated on the wall', r.ask(s, vis('tvResult')) is True)
        ok('during the last claim\'s celebration, no show yet (the room is cheering the ticket)', (r.ask(s, STATS) or {}).get('plays') == 0, r.ask(s, STATS))
        ok('once the celebration is over, the last draw done: the show plays', r.until(s, 'VPEndShow.playing()', 40) is True, r.ask(s, STATS))
        sh = r.ask(s, SHOWN) or {}
        ok('RAFFLE DRAWN, both prizes as rows: TICKET 042 Meat tray, TICKETS 007, 118 $50 bar tab',
           sh.get('eye') == 'RAFFLE DRAWN' and sh.get('rows') == [['TICKET 042', 'Meat tray'], ['TICKETS 007, 118', '$50 bar tab']], sh)
        time.sleep(1.4); shot(r, s, 'endshow-5-raffle')
        host_says(r, s, [{'t': 'to_ads'}])
        ok('Back to ads waits for the show', r.ask(s, 'VPEndShow.playing() && /\\/app\\/raffle\\//.test(location.pathname)') is True, r.ask(s, 'location.pathname'))
        ok('then goes to the venue\'s TV page', r.until(s, '/^\\/tv/.test(location.pathname)', 10) is True, r.ask(s, 'location.pathname'))

        s2 = raffle_screen(r)
        host_says(r, s2, [{'t': 'state', 'prizeLabel': 'Meat tray', 'pad': 3}, {'t': 'drawing', 'prizeLabel': 'Meat tray', 'spinSecs': 1}]); time.sleep(1.2)
        host_says(r, s2, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [9], 'time': 0}, {'t': 'claimed', 'prizeLabel': 'Meat tray', 'numbers': [9]}])
        host_says(r, s2, [{'t': 'idle', 'next': True, 'prizeLabel': 'Bar tab'}])
        time.sleep(32)
        ok('a prize drawn with more still to come plays no show', (r.ask(s2, STATS) or {}).get('plays') == 0 and r.ask(s2, vis('tvIdle')) is True, [r.ask(s2, STATS), text(r, s2, 'idleEye')])
        ok('no page errors on the raffle screens', not (r.ask(s2, 'window.__errs') or []), r.ask(s2, 'window.__errs'))
    finally:
        r.close()


def musical_live():
    print('\n3b. MUSICAL BINGO on the real console: the TV keeps the game screen up for its show')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        t1 = tv(r)
        _, h = r.open('/app/musical/host.html?sting=0', width=1024, height=900)
        ok('CONTROL: the musical console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(3)
        r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
        tap(r, h, 'startBtn')
        r.until(h, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15)
        ok('the TV takes the musical screen in its frame, with the switch handed on',
           r.until(t1, '(function(f){return !!f && f.style.display==="block" && /endshow=1/.test(f.getAttribute("src")||"");})(document.getElementById("gameFrame"))', 25) is True,
           r.ask(t1, '(document.getElementById("gameFrame")||{}).src'))
        tap(r, h, 'startBtn')
        ok('CONTROL: the game is running', r.until(h, '!document.getElementById("liveBlock").classList.contains("hidden")', 20) is True)
        time.sleep(1.5)
        tap(r, h, 'playNextBtn')
        ok('CONTROL: a song is played on the TV', r.until(t1, FRAME + '.document.getElementById("tvNow") && !' + FRAME + '.document.getElementById("tvRun").classList.contains("hidden")', 12) is True)
        time.sleep(1.5)
        tap(r, h, 'endGameBtn'); time.sleep(0.9); tap(r, h, 'endGameBtn')
        ok('End game: the screen in the frame plays the show (the close: nobody had won)',
           r.until(t1, FRAME + '.VPEndShow && ' + FRAME + '.VPEndShow.playing()', 6) is True and (r.ask(t1, FRAME + '.VPEndShow.shown()') or {}).get('kind') == 'musical',
           r.ask(t1, '(function(){try{return ' + FRAME + '.VPEndShow.stats();}catch(e){return String(e);}})()'))
        time.sleep(1.0)
        ok('the TV keeps the frame up while it plays (the idle and Back to ads wait for it)',
           r.ask(t1, '(function(f){return f.style.display==="block" && ' + FRAME + '.VPEndShow.playing();})(document.getElementById("gameFrame"))') is True and r.ask(t1, vis('adsRoot')) is False)
        shot(r, t1, 'endshow-3b-musical-live')
        ok('then the ads, once the show is over', r.until(t1, vis('adsRoot') + ' && document.getElementById("gameFrame").style.display==="none"', 10) is True)
        ok('no page errors on the TV or the console', not (r.ask(t1, 'window.__errs') or []) and not (r.ask(h, 'window.__errs') or []), [r.ask(t1, 'window.__errs'), r.ask(h, 'window.__errs')])
    finally:
        r.close()


def the_show():
    print('\n6. The show itself, stepped frame by frame on a real screen')
    r = RIG.Rig()
    try:
        slug = r.W.info['slug']
        hop = 'try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};window.__vpEndShowManual=1;' % json.dumps(slug)
        _, s = r.open('/app/raffle/screen?venue=' + slug + '&endshow=1', before=hop, width=1920, height=1080)
        r.until(s, 'document.readyState==="complete" && !!window.VPEndShow', 15); time.sleep(1)
        LONG = {'kind': 'trivia', 'eye': 'FINAL SCORES', 'venue': 'The Grand Royal Exchange Hotel and Sports Bar Brisbane',
                'rows': [{'lead': '1', 'main': 'The Extraordinarily Long Team Name Of Champions', 'tail': '12840', 'num': True},
                         {'lead': '2', 'main': 'Table 6', 'tail': '790', 'num': True}, {'lead': '2', 'main': 'Nan’s Army', 'tail': '790', 'num': True}]}
        BIG = {'kind': 'bingo', 'eye': 'WE HAVE A WINNER', 'big': 'Bartholomew Fitzgerald-Smythe and Ann', 'sub': 'Full house · $500 meat tray and a bottle of bubbles', 'venue': 'Test Alpha'}
        for (w, h) in ((1920, 1080), (1280, 720), (1024, 768), (1080, 1920)):
            r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=s)
            time.sleep(0.4)
            for name, o in (('top three, long names', LONG), ('one winner, a long name', BIG)):
                r.ask(s, 'VPEndShow.play(%s); true' % json.dumps(o))
                r.ask(s, 'VPEndShow.frame(1.9); true'); ma = r.ask(s, BOXES)
                if w == 1920 and name.startswith('top'): shot(r, s, 'endshow-6-long-rows')
                r.ask(s, 'VPEndShow.frame(4.6); true'); mb = r.ask(s, BOXES)
                if w == 1920 and name.startswith('top'): shot(r, s, 'endshow-6-long-venue')
                ok('%dx%d, %s: every line of the result and the close inside the screen' % (w, h, name),
                   ma and mb and len(ma['boxes']) >= 3 and len(mb['boxes']) >= 3 and not outside(ma) and not outside(mb), outside(ma) + outside(mb))
                r.ask(s, 'VPEndShow.stop("test"); true')
        r.B.call('Emulation.setDeviceMetricsOverride', {'width': 1920, 'height': 1080, 'deviceScaleFactor': 1, 'mobile': False}, session=s)
        time.sleep(0.3)
        r.ask(s, 'VPEndShow.play(%s); VPEndShow.frame(1.9); true' % json.dumps(LONG))
        k = r.ask(s, '[].map.call(document.querySelectorAll(".vpe-row"), function(r){ return +r.getAttribute("data-k"); })') or []
        ok('a long team name is scaled down to fit its row, a short one is not', len(k) == 3 and k[0] < 0.99 and k[1] == 1, k)
        sh = r.ask(s, SHOWN) or {}
        ok('each row keeps the place it was given, a tie included: 1, 2, 2', [x[0] for x in sh.get('rows', [])] == ['1', '2', '2'], sh)
        ok('a long venue name is cut to fit with an ellipsis', (sh.get('venue') or '').endswith('…') and len(sh.get('venue') or '') <= 40, sh.get('venue'))
        r.ask(s, 'VPEndShow.stop("test"); true')
        r.ask(s, 'VPEndShow.play({kind:"bingo", big:"<img src=x onerror=window.__pwn=1>", sub:"<b>x</b>", venue:"<script>x</script>"}); VPEndShow.frame(1.9); true')
        ok('a name made of HTML is shown as text and makes no elements', r.ask(s, 'document.getElementById("vpEndShow").querySelectorAll("img,b,script").length') == 0 and
           (r.ask(s, SHOWN) or {}).get('big', '').startswith('<IMG') and not r.ask(s, '!!window.__pwn'), r.ask(s, SHOWN))
        r.ask(s, 'VPEndShow.stop("test"); true')
        r.ask(s, 'VPEndShow.play({kind:"trivia", big:"x", venue:"The venueplay Test Bar"}); VPEndShow.frame(4.6); true')
        ok('the name is lowercase venueplay, even inside a venue\'s name in capitals', (r.ask(s, SHOWN) or {}).get('venue') == 'THE venueplay TEST BAR', r.ask(s, SHOWN))
        all_text = r.ask(s, 'document.getElementById("vpEndShow").textContent')
        ok('no em dash anywhere in the show', '\u2014' not in (all_text or ''), all_text)
        r.ask(s, 'VPEndShow.stop("test"); true')
        r.ask(s, 'VPEndShow.play({kind:"bingo", big:"Sam"}); true')
        r.ask(s, 'VPEndShow.heard({t:"state"}); VPEndShow.heard({t:"leaderboard"}); true')
        ok('routine traffic (a state, a leaderboard) does not stop the show', r.ask(s, 'VPEndShow.playing()') is True)
        r.ask(s, 'VPEndShow.heard({t:"drawing"}); true')
        ok('the next draw stops it at once', r.ask(s, '!VPEndShow.playing() && VPEndShow.stats().last==="next" && !document.getElementById("vpEndShow")') is True, r.ask(s, STATS))
        ok('Back to ads waits for the show: after() runs only once it is over',
           r.ask(s, '(function(){ VPEndShow.play({kind:"bingo", big:"Sam"}); var ran=0; VPEndShow.after(function(){ ran++; }); var a=ran; VPEndShow.frame(1); var b=ran; VPEndShow.frame(9); return [a,b,ran]; })()') == [0, 0, 1])

        print('\n   reduced motion')
        _, rm = r.open('/__blank', width=1280, height=720)
        r.B.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, session=rm)
        r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': hop}, session=rm)
        r.B.call('Page.navigate', {'url': r.base + '/app/raffle/screen?venue=' + slug + '&endshow=1'}, session=rm)
        r.until(rm, 'document.readyState==="complete" && !!window.VPEndShow', 15); time.sleep(1)
        ok('CONTROL: the page knows the TV asked for reduced motion', r.ask(rm, 'VPEndShow.reduced') is True)
        RM = r'''(function(){
          VPEndShow.play({kind:"trivia", eye:"FINAL SCORES", rows:[{lead:"1",main:"Quiz Wizards",tail:"840",num:true},{lead:"2",main:"Table 6",tail:"790",num:true}], venue:"Test Alpha"});
          var moved=[], dim=0, core=0, seen={}, blinks=0, lastA=null;
          for(var i=0;i<=290;i++){ var t=i*0.02; if(!VPEndShow.frame(t)) break;
            var els=document.querySelectorAll("#vpEndShow .vpe-t, #vpEndShow .vpe-row, #vpEndShow .vpe-sub");
            for(var j=0;j<els.length;j++){ var tr=els[j].style.transform||""; if(/translate\(\s*-?[0-9.]*[1-9]/.test(tr)) moved.push([t, els[j].id, tr]);
              var m=/scale\(([0-9.]+)\)/.exec(tr); if(m){ var k=els[j].id||j; seen[k]=seen[k]||{}; seen[k][m[1]]=1; } }
            if(document.getElementById("vpeBand").getAttribute("fill")==="#5a1438") dim++;
            if(document.getElementById("vpeCore").getAttribute("d")) core++;
            /* a blink: the triangle's light dropping sharply between two frames 20 ms apart (a strike's dim beat); a fade never does */
            var tri=document.getElementById("vpeTri"), ba=(tri.style.opacity==="0") ? 0 : (+document.getElementById("vpeBand").getAttribute("opacity")||0);
            if(lastA!==null && lastA-ba>0.3) blinks++; lastA=ba;
          }
          var scales=0; for(var k in seen){ if(Object.keys(seen[k]).length>1) scales++; }
          VPEndShow.stop("test");
          return { moved:moved.length, scales:scales, dim:dim, core:core, blinks:blinks };
        })()'''
        v = r.ask(rm, RM) or {}
        ok('reduced motion: no line shakes, slides or grows; the words fade', v.get('moved') == 0 and v.get('scales') == 0, v)
        ok('reduced motion: the triangle never flickers (no dim strike, no neon core, its light never blinks)', v.get('dim') == 0 and v.get('core') == 0 and v.get('blinks') == 0, v)

        print('\n   without the switch')
        _, off = r.open('/app/raffle/screen?venue=' + slug, before=hop, width=1280, height=720)
        r.until(off, 'document.readyState==="complete" && !!window.VPEndShow', 15)
        ok('without ?endshow=1 the show is off and play() plays nothing', r.ask(off, 'VPEndShow.on===false && VPEndShow.play({big:"Sam"})===false && !document.getElementById("vpEndShow")') is True)
        ok('no page errors', not (r.ask(s, 'window.__errs') or []) and not (r.ask(rm, 'window.__errs') or []), [r.ask(s, 'window.__errs'), r.ask(rm, 'window.__errs')])
    finally:
        r.close()


def same_logo():
    print('\n7. One logo: the end show draws the start show\'s logo, not a copy that can drift')
    a = io_read('venueplay/app/vp-sting.js'); b = io_read('venueplay/app/vp-endshow.js')
    for name in ('REST', 'ANEON'):
        pa = re.search(r'var %s = "([^"]+)";' % name, a); pb = re.search(r'var %s = "([^"]+)";' % name, b)
        ok('the %s path data is the same in vp-sting.js and vp-endshow.js' % name, bool(pa and pb) and pa.group(1) == pb.group(1))
    for frag in ('var T=1.12, GX=(2*-85+112)/3;', 'var P=[[-85,-118],[112,0],[-85,118]]', 'var RO=15*T, SOLID=RO+RHO+0.5, HT=266*T;', 'var CX=3830, CY=-245, INKW=4676, INKL=-1'):
        ok('the triangle geometry is the same in both: ' + frag, frag in a and frag in b)

def io_read(p):
    import io
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('tv-endshow-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    only = sys.argv[1:]   # a section by name, for working on one; the gate runs them all
    for part in (same_logo, the_show, bingo, demos, raffle, musical_live):
        if not only or part.__name__ in only: part()
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
