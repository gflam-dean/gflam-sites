#!/usr/bin/env python3
"""THE START-OF-GAME SHOW, PLAYED FOR REAL: console presses start, the TV puts on the show, then ball one
(Dean, 1 Nov 2026: "it will take 3 seconds right? I don't care about the balls, make the show look good").

The TV's show is /app/vp-sting.js. Since the 2 Nov 2026 release it is ON by default on every TV, console,
game screen and phone (Dean: "yes let's play ready for tomorrow"); ?sting=0 on an address switches it off for
that one screen, and a TV hands its ?sting=0 on to the game screen in its frame. So every page below is opened
PLAIN (no switch in its address) unless it is testing the off switch. On the rig in tools/browser-rig/rig.py
(the repo's pages, the real game Worker in jsc, headless Chrome):
  1. A plain console opens a bingo lobby and starts the game; a plain /tv plays the show once, in full.
     The console's first Next number is held for the length of the show ("Starting the show..."), so a
     tap mid-show calls nothing. The show finishes, the corner mark is the new logo, and the first ball
     then lands on the TV straight after, with no second show.
  2. A TV that joins the game once it is running hears "state", not "started": it never plays the show.
  3. A console with ?sting=0 (so no hold) and a plain TV: a ball that arrives mid-show stops the
     show at once and the number is shown. The room's number always wins over the show.
  4. A TV with ?sting=0: no show, the old corner mark, and the game screen it hops into gets &sting=0 and
     stays off too. A plain TV hands no switch on, and its game screen has the show on.
  5. A plain player's phone (/play, joined as Sam) plays its own short show on the same start:
     "LET'S PLAY, SAM!" over "BINGO", done before the first ball, and the ticket is there for ball one.
     Names on the real phone page: none (plain words), a long one (cut with an ellipsis, fits the screen),
     a team name, and one made of HTML (shown as text, never made into elements). A draw says GOOD LUCK.
  6. The other games' real screens and phones, in their own demo scripts: trivia and musical bingo play
     the show on "started"; their sales-page demos (and the bingo TV's) let it play in full, then the first
     question, song or ball comes in. The raffle and members draw
     screens play "IT'S RAFFLE TIME" / "MEMBERS DRAW TIME" once, before the first draw, and give way to it.
     A trivia screen and a trivia phone with ?sting=0 never play it.
  7. The phone show ends in the page's own header logo (bingo, trivia, musical bingo; 320, 375, 390, 430
     wide and sideways): the wordmark lands on it within 2px, then hands over to it; cut short, the
     header logo is given back; under prefers-reduced-motion it is the simple fade.

    python3 tools/tv-sting-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def text(r, sid, i): return r.ask(sid, '((document.getElementById(%s)||{}).textContent||"").replace(/\\s+/g," ").trim()' % json.dumps(i))
def click(r, sid, i): r.ask(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i))
STATS = '(window.VPSting ? VPSting.stats() : null)'

def console(r, sting=True):
    tid, host = r.open('/app/' + ('' if sting else '?sting=0'), width=1024, height=1100)
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

def tv(r, sting=True):
    tid, sid = r.open('/tv?venue=' + r.W.info['slug'] + ('' if sting else '&sting=0'), width=1280, height=720)
    r.until(sid, '!!document.getElementById("adsRoot")', 15); time.sleep(1.5)
    return tid, sid

def balls_on_tv(r, sid): return text(r, sid, 'tvBallCount')

def phone(r, name):
    _, ph = r.open('/play?room=' + r.W.info['code'], width=390, height=844)   # plain: no switch in the address
    r.phone_ready(ph)
    ok('a plain phone (/play, no switch in its address) has the show on by default', r.ask(ph, '!!(window.VPSting && VPSting.on)') is True)
    r.ask(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    ok('the phone joins as ' + name, r.until(ph, '!document.getElementById("vWait").classList.contains("hidden")', 25) is True,
       r.ask(ph, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
    return ph


def full_show():
    print('\n1. Start a bingo game: the TV plays the show in full, the first ball waits for it, then lands')
    r = RIG.Rig()
    try:
        _, t1 = tv(r)
        ok('a plain /tv (no switch in its address) has the show on by default', r.ask(t1, '!!(window.VPSting && VPSting.on) && !/sting/.test(location.search)') is True,
           r.ask(t1, 'location.search'))
        _, host = console(r)
        ok('the console opens the lobby', open_lobby(r, host) is True, text(r, host, 'startBtn'))
        ph = phone(r, 'Sam')
        time.sleep(1.5)
        ok('no show for the lobby', (r.ask(t1, STATS) or {}).get('plays') == 0, r.ask(t1, STATS))
        click(r, host, 'startBtn')
        ok('Start: the TV starts the show', r.until(t1, 'window.VPSting && VPSting.playing()', 6) is True, r.ask(t1, STATS))
        ok('and the phone starts its own, with the player\'s name: LET\'S PLAY, SAM! over BINGO',
           r.until(ph, 'window.VPSting && VPSting.playing()', 6) is True and r.ask(ph, 'VPSting.shown()') == ['LET\u2019S PLAY, SAM!', 'BINGO'], r.ask(ph, 'VPSting.shown()'))
        shot(r, ph, 'sting-5-phone-mid-show')
        ok('the TV never shows a player\'s name', 'SAM' not in (r.ask(t1, '(document.getElementById("vpSting")||{}).innerText||""') or '').upper())
        shot(r, t1, 'sting-1-tv-mid-show')
        ok('the console holds the first number for the show: "Starting the show..."',
           r.until(host, '/^Starting the show\\.\\.\\. [1-4]$/.test(document.getElementById("nextBtn").textContent)', 4) is True, text(r, host, 'nextBtn'))
        shot(r, host, 'sting-1-console-holding')
        click(r, host, 'nextBtn'); time.sleep(0.8)
        ok('a tap on Next mid-show calls no ball', r.ask(host, '/0 of 90/.test(document.getElementById("liveCount").textContent)') is True and
           (r.ask(t1, STATS) or {}).get('playing') is True, [text(r, host, 'liveCount'), r.ask(t1, STATS)])
        ok('the phone\'s show is done, in full, before the first ball can be called',
           r.until(ph, 'VPSting.stats().last==="done"', 4) is True and r.ask(ph, '!document.getElementById("vpSting")') is True and
           r.ask(host, '/Starting the show/.test(document.getElementById("nextBtn").textContent)') is True, [r.ask(ph, STATS), text(r, host, 'nextBtn')])
        ok('the show plays to the end, not cut short', r.until(t1, 'VPSting.stats().last==="done"', 8) is True and
           (r.ask(t1, STATS) or {}).get('cutShort') == 0, r.ask(t1, STATS))
        ok('the show is gone from the screen', r.ask(t1, '!document.getElementById("vpSting")') is True)
        ok('the corner mark is the new logo now, the old one hidden',
           r.ask(t1, '(function(c){var n=c&&c.querySelector(".vp-newmark"),o=c&&c.querySelector(".vn");return !!n&&n.getBoundingClientRect().width>100&&(!o||getComputedStyle(o).display==="none");})(document.getElementById("tvCorner"))') is True)
        ok('after the show the console is ready: Next number is live',
           r.until(host, '!/Starting the show/.test(document.getElementById("nextBtn").textContent) && !document.getElementById("nextBtn").disabled', 3) is True, text(r, host, 'nextBtn'))
        click(r, host, 'nextBtn')
        ok('the first ball lands on the TV straight after the show', r.until(t1, '/1 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 8) is True, balls_on_tv(r, t1))
        shot(r, t1, 'sting-1-tv-first-ball')
        ok('the phone shows the ticket for ball one', r.until(ph, '!document.getElementById("vCard").classList.contains("hidden")', 10) is True and
           r.ask(ph, '!document.getElementById("vpSting")') is True, r.ask(ph, 'document.body.innerText.slice(0,120)'))
        ok('and the show did not play again', (r.ask(t1, STATS) or {}).get('plays') == 1, r.ask(t1, STATS))
        time.sleep(5.5)
        click(r, host, 'nextBtn')
        ok('the game goes on: ball two, no show', r.until(t1, '/2 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 10) is True and
           (r.ask(t1, STATS) or {}).get('plays') == 1, [balls_on_tv(r, t1), r.ask(t1, STATS)])

        print('\n2. A TV that joins mid-game')
        _, t2 = tv(r)
        r.until(t2, '/2 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 15)
        time.sleep(2)
        ok('it shows the running game, and never plays the show', (r.ask(t2, STATS) or {}).get('plays') == 0 and r.ask(t2, '!document.getElementById("vpSting")') is True,
           [balls_on_tv(r, t2), r.ask(t2, STATS)])
        print('\n4. A TV with ?sting=0')
        _, t3 = tv(r, sting=False)
        time.sleep(2)
        ok('no show, and the corner still has the old mark', r.ask(t3, 'window.VPSting && VPSting.on') is False and
           r.ask(t3, '!document.querySelector("#tvCorner .vp-newmark") && !!document.querySelector("#tvCorner .vn")') is True)
        # the hop the TV makes when a host puts another game on air (tv.html enterEmbed), asked for the way
        # an embedded screen asks for it; then the game screen's own VPSting is read from inside the frame
        FRAME = '(function(f){var w=f&&f.contentWindow;return {src:f&&f.getAttribute("src"),on:!!(w&&w.VPSting)?w.VPSting.on:null};})(document.getElementById("gameFrame"))'
        for sid, label, want_on in ((t3, 'a TV with ?sting=0', False), (t2, 'a plain TV', True)):
            r.ask(sid, 'window.postMessage({vp:"show-game", game:"trivia"}, location.origin); true')
            r.until(sid, '(function(f){var w=f&&f.contentWindow;return !!(w&&w.VPSting);})(document.getElementById("gameFrame"))', 15)
            v = r.ask(sid, FRAME) or {}
            src = v.get('src') or ''
            ok(label + ': its trivia game screen ' + ('has the show on, and no switch is handed on' if want_on else 'is handed &sting=0 and has the show off'),
               '/app/trivia/screen' in src and v.get('on') is want_on and (('sting' not in src) if want_on else ('&sting=0' in src)), v)
        print('\n5. Names on the real phone page')
        def say(words_js):
            r.ask(ph, 'VPSting.start({layout:"phone", words:%s}); true' % words_js)
            v = r.ask(ph, '(function(){var a=document.getElementById("vppL1"),s=document.getElementById("vpSting");'
                          'var b=a.getBoundingClientRect();return {shown:VPSting.shown(), els:s.querySelectorAll("img,b,script,i").length, fits:b.left>=-1&&b.right<=innerWidth+1};})()') or {}
            time.sleep(0.5); v['fits'] = r.ask(ph, '(function(a){var b=a.getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1;})(document.getElementById("vppL1"))')
            r.ask(ph, 'VPSting.stop("test"); true')
            return v
        v = say('VPSting.phoneWords("BINGO", "")')
        ok('no name: the plain LET\'S PLAY over BINGO', v.get('shown') == ['LET\u2019S PLAY', 'BINGO'], v)
        v = say('VPSting.phoneWords("BINGO", "Bartholomew Fitzgerald-Smythe")')
        ok('a long name is cut with an ellipsis and still fits the screen', (v.get('shown') or [''])[0] == 'LET\u2019S PLAY, BARTHOLOMEW FIT\u2026!' and v.get('fits') is True, v)
        v = say('VPSting.phoneWords("TRIVIA", "Quiz Wizards")')
        ok('a team name: LET\'S PLAY, QUIZ WIZARDS! over TRIVIA', v.get('shown') == ['LET\u2019S PLAY, QUIZ WIZARDS!', 'TRIVIA'], v)
        v = say('VPSting.phoneWords("BINGO", "<img src=x onerror=alert(1)>")')
        ok('a name made of HTML is shown as text and makes no elements', (v.get('shown') or [''])[0].startswith('LET\u2019S PLAY, <IMG') and v.get('els') == 0, v)
        v = say('VPSting.phoneWords("RAFFLE", "Sam", true)')
        ok('a draw says GOOD LUCK, SAM! over RAFFLE', v.get('shown') == ['GOOD LUCK, SAM!', 'RAFFLE'], v)
        ok('no page errors on the TVs or the console', not (r.ask(t1, 'window.__errs') or []) and not (r.ask(host, 'window.__errs') or []),
           [r.ask(t1, 'window.__errs'), r.ask(host, 'window.__errs')])
    finally:
        r.close()


def ball_mid_show():
    print('\n3. A console with ?sting=0: a ball arrives mid-show on a plain TV and the show stops for it')
    r = RIG.Rig()
    try:
        _, t1 = tv(r)
        _, host = console(r, sting=False)
        ok('the console opens the lobby', open_lobby(r, host) is True, text(r, host, 'startBtn'))
        time.sleep(1.5)
        click(r, host, 'startBtn')
        ok('the TV starts the show', r.until(t1, 'window.VPSting && VPSting.playing()', 6) is True, r.ask(t1, STATS))
        ok('this console does not hold Next (?sting=0)', not r.ask(host, '/Starting the show/.test(document.getElementById("nextBtn").textContent)'), text(r, host, 'nextBtn'))
        click(r, host, 'nextBtn')
        ok('the ball stops the show at once', r.until(t1, 'VPSting.stats().last==="ball"', 6) is True and r.ask(t1, '!document.getElementById("vpSting")') is True, r.ask(t1, STATS))
        ok('and the number is on the TV', r.until(t1, '/1 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 8) is True, balls_on_tv(r, t1))
    finally:
        r.close()


def other_games():
    print('\n6. The other games: their real screens and phones, in their own demo scripts')
    r = RIG.Rig()
    try:
        # the bingo TV's own sales-page demo (/tv?demo=1): its first ball waits for the show (2 Nov 2026)
        _, b1 = r.open('/tv?demo=1', width=1280, height=720)
        ok('bingo demo TV: "started" plays the show', r.until(b1, 'window.VPSting && VPSting.stats().plays===1', 15) is True, r.ask(b1, STATS))
        ok('bingo demo TV: the show plays in full, never cut short by the first ball',
           r.until(b1, 'VPSting.stats().last==="done"', 8) is True and r.ask(b1, 'VPSting.stats().cutShort===0') is True, r.ask(b1, STATS))
        ok('bingo demo TV: then the first ball lands, and the show does not play again',
           r.until(b1, '/1 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 8) is True and r.ask(b1, 'VPSting.stats().plays===1') is True,
           [balls_on_tv(r, b1), r.ask(b1, STATS)])
        ARRIVED = {'question': '/Olympics/.test((document.getElementById("tvQText")||{}).textContent||"")',
                   'song': '((document.getElementById("tvBoard")||{}).children||[]).length>0'}
        for path, words, first in (('/app/trivia/screen?demo=1', 'TRIVIA', 'question'), ('/app/musical/screen?demo=1', 'MUSICAL BINGO', 'song')):
            _, s1 = r.open(path, width=1280, height=720)
            ok(words + ' TV: "started" plays the show', r.until(s1, 'window.VPSting && VPSting.stats().plays===1', 15) is True, r.ask(s1, STATS))
            # the sales-page demo waits for the show (2 Nov 2026): it plays to the end, then the first content comes
            ok(words + ' demo TV: the show plays in full, never cut short, and is gone before the first ' + first,
               r.until(s1, 'VPSting.stats().last==="done"', 8) is True and r.ask(s1, '!document.getElementById("vpSting") && VPSting.stats().plays===1 && VPSting.stats().cutShort===0') is True, r.ask(s1, STATS))
            ok(words + ' demo TV: the first ' + first + ' then comes in, and the show does not play again',
               r.until(s1, ARRIVED[first], 8) is True and r.ask(s1, 'VPSting.stats().plays===1') is True, r.ask(s1, STATS))
            # the demo no longer sends content mid-show, so the give-way is asked for directly, on this real page:
            # a new "started", then the first %s while the show is still up (a quick host, a phone that lags)
            FIRSTS = {'question': '{question:1, ta_board:1}', 'song': '{played:1}'}
            r.ask(s1, 'VPSting.forGame({t:"started"}, {l1:"LET\u2019S PLAY", l2:"X"}, %s); true' % FIRSTS[first])
            ok(words + ' TV: a new "started" plays the show again', r.ask(s1, 'VPSting.playing() && VPSting.stats().plays===2') is True, r.ask(s1, STATS))
            r.ask(s1, 'VPSting.forGame({t:%s}, {}, %s); true' % (json.dumps('question' if first == 'question' else 'played'), FIRSTS[first]))
            ok(words + ' TV: the first ' + first + ' arriving mid-show makes it give way at once',
               r.ask(s1, '!VPSting.playing() && VPSting.stats().last==="content" && !document.getElementById("vpSting")') is True, r.ask(s1, STATS))
        for path, words in (('/app/trivia/play?demo=1', ['LET\u2019S PLAY, DRE!', 'TRIVIA']), ('/app/musical/play?demo=1', ['LET\u2019S PLAY, SAM!', 'MUSICAL BINGO'])):
            _, p1 = r.open(path, width=390, height=844)
            ok(words[1] + ' phone: the show with the player\'s name', r.until(p1, 'window.VPSting && VPSting.playing()', 15) is True and r.ask(p1, 'VPSting.shown()') == words, r.ask(p1, 'VPSting.shown()'))
            ok(words[1] + ' phone: done before the first question or song', r.until(p1, '!VPSting.playing() && VPSting.stats().plays===1', 8) is True, r.ask(p1, STATS))
        # the off switch on a game screen and a phone: the same demo scripts, which do send "started"
        for path, what in (('/app/trivia/screen?demo=1&sting=0', 'trivia TV'), ('/app/trivia/play?demo=1&sting=0', 'trivia phone')):
            _, o1 = r.open(path, width=1280 if 'screen' in path else 390, height=720 if 'screen' in path else 844)
            r.until(o1, 'document.readyState==="complete" && !!window.VPSting', 15); time.sleep(6)
            ok(what + ' with ?sting=0: the demo starts its game and the show never plays',
               r.ask(o1, 'VPSting.on===false && VPSting.stats().plays===0 && !document.getElementById("vpSting")') is True, r.ask(o1, STATS))
        for path, line in (('/app/raffle/screen?venue=' + r.W.info['slug'], 'IT\u2019S RAFFLE TIME'), ('/app/members/screen?venue=' + r.W.info['slug'], 'MEMBERS DRAW TIME')):
            # a game screen opened on its own bounces to /tv; /tv leaves this marker when it hops a TV into the game
            _, d1 = r.open(path, before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){}' % json.dumps(r.W.info['slug']), width=1280, height=720)
            r.until(d1, 'document.readyState==="complete" && !!window.VPSting', 15); time.sleep(1)
            r.ask(d1, 'VPSting.forDraw({t:"state"}, {line:%s}); true' % json.dumps(line.replace('IT’S', '<i>IT’S</i>').replace('TIME', '<i>TIME</i>')))
            ok(line + ': the first word from the host plays it, on the screen\'s own corner',
               r.ask(d1, 'VPSting.playing() && (document.getElementById("vpsL3s")||{}).textContent') == line, r.ask(d1, STATS))
            r.ask(d1, 'VPSting.forDraw({t:"drawing"}, {}); true')
            ok(line + ': the first draw makes it give way', r.ask(d1, '!VPSting.playing() && VPSting.stats().last==="content" && !document.getElementById("vpSting")') is True, r.ask(d1, STATS))
            r.ask(d1, 'VPSting.forDraw({t:"state"}, {line:"x"}); true')
            ok(line + ': and it never plays again on that screen', r.ask(d1, '!VPSting.playing() && VPSting.stats().plays===1') is True, r.ask(d1, STATS))
    finally:
        r.close()


LAND_SIZES = ((320, 568), (375, 667), (390, 844), (430, 932), (844, 390))
LAND_PAGES = (('/play?demo=1', 'bingo'), ('/app/trivia/play?demo=1', 'trivia'), ('/app/musical/play?demo=1', 'musical bingo'))
# ours: the show's wordmark group; theirs: the header's own wordmark path (the white letters, triangle apart)
LAND = r"""(function(){
  var g=document.getElementById("vppWg"), h=document.querySelector('.brand svg[data-vp-mark="wordmark"]');
  if(!g||!h) return {missing:[!!g,!!h]};
  var a=g.getBoundingClientRect(), b=h.querySelector("path").getBoundingClientRect();
  var d=Math.max(Math.abs(a.left-b.left),Math.abs(a.top-b.top),Math.abs(a.right-b.right),Math.abs(a.bottom-b.bottom));
  return {d:Math.round(d*100)/100, ours:[a.left,a.top,a.width,a.height].map(Math.round), head:[b.left,b.top,b.width,b.height].map(Math.round),
          hidden:getComputedStyle(h).visibility==="hidden"};
})()"""
HEAD_SHOWN = '(function(h){return !!h && getComputedStyle(h).visibility!=="hidden";})(document.querySelector(\'.brand svg[data-vp-mark="wordmark"]\'))'

def phone_show_ready(r, sid):
    """The page's own show if its demo starts one, else started by hand; the clock is the test's (manual)."""
    r.until(sid, 'document.readyState==="complete" && !!window.VPSting', 15); time.sleep(1.5)
    if not r.ask(sid, 'VPSting.playing()'):
        r.ask(sid, 'VPSting.start({layout:"phone", words:VPSting.phoneWords("BINGO","Sam")}); true')
    return r.ask(sid, 'VPSting.playing()') is True

def phone_landing():
    print('\n7. The phone show lands in the page\'s own header logo (Dean, 2 Nov 2026), at every size')
    r = RIG.Rig()
    try:
        for path, what in LAND_PAGES:
            for w, h in LAND_SIZES:
                tag = '%s phone at %dx%d' % (what, w, h)
                tid, sid = r.open(path, before='window.__vpStingManual=true;', width=w, height=h)
                try:
                    if not phone_show_ready(r, sid):
                        ok(tag + ': the show starts', False, r.ask(sid, STATS)); continue
                    r.ask(sid, 'VPSting.frame(1.0); VPSting.frame(2.0); true')
                    mid = r.ask(sid, LAND) or {}
                    r.ask(sid, 'VPSting.frame(2.52); true')
                    v = r.ask(sid, LAND) or {}
                    ok(tag + ': the wordmark lands on the header logo, within 2px, while the real one waits hidden',
                       isinstance(v.get('d'), (int, float)) and v['d'] <= 2 and v.get('hidden') is True and (mid.get('d') or 0) > 10, [v, mid])
                    if w == 390 and h == 844:
                        r.ask(sid, 'VPSting.frame(2.6); true')
                        ok(tag + ': then hands over: the header logo is back, exactly under ours', r.ask(sid, HEAD_SHOWN) is True and (r.ask(sid, LAND) or {}).get('d', 99) <= 2,
                           r.ask(sid, LAND))
                        r.ask(sid, 'VPSting.frame(9); true')
                        ok(tag + ': and the show is gone, played to the end, the header logo showing',
                           r.ask(sid, '!document.getElementById("vpSting") && VPSting.stats().last==="done"') is True and r.ask(sid, HEAD_SHOWN) is True, r.ask(sid, STATS))
                        # cut short mid-flight (a ball, a question, a song): the header logo is never left hidden
                        r.ask(sid, 'VPSting.start({layout:"phone", words:VPSting.phoneWords("BINGO","Sam")}); VPSting.frame(1.0); VPSting.frame(2.2); true')
                        hid = r.ask(sid, '!(%s)' % HEAD_SHOWN)
                        r.ask(sid, 'VPSting.stop("content"); true')
                        ok(tag + ': cut short mid-flight, the show goes at once and the header logo is given back',
                           hid is True and r.ask(sid, '!document.getElementById("vpSting") && !VPSting.playing()') is True and r.ask(sid, HEAD_SHOWN) is True, [hid, r.ask(sid, STATS)])
                finally:
                    r.close_tab(tid)
        # prefers-reduced-motion: the simple fade, no flight, and the header logo is never hidden
        tid, sid = r.open('/app/trivia/play?demo=1', before='window.__vpStingManual=true;', width=390, height=844)
        r.B.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, session=sid)
        r.B.call('Page.reload', {}, session=sid)
        time.sleep(1)
        if phone_show_ready(r, sid):
            r.ask(sid, 'VPSting.frame(1.0); VPSting.frame(2.0); VPSting.frame(2.2); true')   # its fade ends at 2.3 s
            v = r.ask(sid, LAND) or {}
            ok('reduced motion: no flight, the header logo is not hidden, and the show is a fade',
               r.ask(sid, 'matchMedia("(prefers-reduced-motion: reduce)").matches') is True and v.get('hidden') is False and (v.get('d') or 0) > 10, v)
        else:
            ok('reduced motion: the show starts', False, r.ask(sid, STATS))
        r.close_tab(tid)
    finally:
        r.close()


if __name__ == '__main__':
    full_show()
    ball_mid_show()
    other_games()
    phone_landing()
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
