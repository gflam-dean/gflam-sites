#!/usr/bin/env python3
"""THE START-OF-GAME SHOW, PLAYED FOR REAL: console presses start, the TV puts on the show, then ball one
(Dean, 1 Nov 2026: "it will take 3 seconds right? I don't care about the balls, make the show look good").

The TV's show is /app/vp-sting.js, switched on by ?sting=1 on the TV's address and the console's. On the rig
in tools/browser-rig/rig.py (the repo's pages, the real game Worker in jsc, headless Chrome):
  1. The real console opens a bingo lobby and starts the game; the real TV plays the show once, in full.
     The console's first Next number is held for the length of the show ("Starting the show..."), so a
     tap mid-show calls nothing. The show finishes, the corner mark is the new logo, and the first ball
     then lands on the TV straight after, with no second show.
  2. A TV that joins the game once it is running hears "state", not "started": it never plays the show.
  3. A console WITHOUT the switch (so no hold) and a TV with it: a ball that arrives mid-show stops the
     show at once and the number is shown. The room's number always wins over the show.
  4. Without ?sting=1 on the TV nothing changes: no show, the old corner mark.
  5. The player's phone (play.html?sting=1, joined as Sam) plays its own short show on the same start:
     "LET'S PLAY, SAM!" over "BINGO", done before the first ball, and the ticket is there for ball one.
     Names on the real phone page: none (plain words), a long one (cut with an ellipsis, fits the screen),
     a team name, and one made of HTML (shown as text, never made into elements). A draw says GOOD LUCK.
  6. The other games' real screens and phones, in their own demo scripts: trivia and musical bingo play
     the show on "started" and give way to the first question or song. The raffle and members draw
     screens play "IT'S RAFFLE TIME" / "MEMBERS DRAW TIME" once, before the first draw, and give way to it.

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
    tid, host = r.open('/app/' + ('?sting=1' if sting else ''), width=1024, height=1100)
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
    tid, sid = r.open('/tv?venue=' + r.W.info['slug'] + ('&sting=1' if sting else ''), width=1280, height=720)
    r.until(sid, '!!document.getElementById("adsRoot")', 15); time.sleep(1.5)
    return tid, sid

def balls_on_tv(r, sid): return text(r, sid, 'tvBallCount')

def phone(r, name):
    _, ph = r.open('/play?room=' + r.W.info['code'] + '&sting=1', width=390, height=844)
    r.phone_ready(ph)
    r.ask(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    ok('the phone joins as ' + name, r.until(ph, '!document.getElementById("vWait").classList.contains("hidden")', 25) is True,
       r.ask(ph, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
    return ph


def full_show():
    print('\n1. Start a bingo game: the TV plays the show in full, the first ball waits for it, then lands')
    r = RIG.Rig()
    try:
        _, t1 = tv(r)
        ok('the TV has the show switched on', r.ask(t1, '!!(window.VPSting && VPSting.on)') is True)
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
        print('\n4. A TV without the switch')
        _, t3 = tv(r, sting=False)
        time.sleep(2)
        ok('no show, and the corner still has the old mark', r.ask(t3, 'window.VPSting && VPSting.on') is False and
           r.ask(t3, '!document.querySelector("#tvCorner .vp-newmark") && !!document.querySelector("#tvCorner .vn")') is True)
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
    print('\n3. A console without the switch: a ball arrives mid-show and the show stops for it')
    r = RIG.Rig()
    try:
        _, t1 = tv(r)
        _, host = console(r, sting=False)
        ok('the console opens the lobby', open_lobby(r, host) is True, text(r, host, 'startBtn'))
        time.sleep(1.5)
        click(r, host, 'startBtn')
        ok('the TV starts the show', r.until(t1, 'window.VPSting && VPSting.playing()', 6) is True, r.ask(t1, STATS))
        ok('this console does not hold Next (no switch)', not r.ask(host, '/Starting the show/.test(document.getElementById("nextBtn").textContent)'), text(r, host, 'nextBtn'))
        click(r, host, 'nextBtn')
        ok('the ball stops the show at once', r.until(t1, 'VPSting.stats().last==="ball"', 6) is True and r.ask(t1, '!document.getElementById("vpSting")') is True, r.ask(t1, STATS))
        ok('and the number is on the TV', r.until(t1, '/1 of 90/.test((document.getElementById("tvBallCount")||{}).textContent||"")', 8) is True, balls_on_tv(r, t1))
    finally:
        r.close()


def other_games():
    print('\n6. The other games: their real screens and phones, in their own demo scripts')
    r = RIG.Rig()
    try:
        for path, words, first in (('/app/trivia/screen?demo=1&sting=1', 'TRIVIA', 'question'), ('/app/musical/screen?demo=1&sting=1', 'MUSICAL BINGO', 'song')):
            _, s1 = r.open(path, width=1280, height=720)
            ok(words + ' TV: "started" plays the show', r.until(s1, 'window.VPSting && VPSting.stats().plays===1', 15) is True, r.ask(s1, STATS))
            ok(words + ' TV: the first ' + first + ' makes it give way, and it does not play again',
               r.until(s1, 'VPSting.stats().last==="content"', 8) is True and r.ask(s1, '!document.getElementById("vpSting") && VPSting.stats().plays===1') is True, r.ask(s1, STATS))
        for path, words in (('/app/trivia/play?demo=1&sting=1', ['LET\u2019S PLAY, DRE!', 'TRIVIA']), ('/app/musical/play?demo=1&sting=1', ['LET\u2019S PLAY, SAM!', 'MUSICAL BINGO'])):
            _, p1 = r.open(path, width=390, height=844)
            ok(words[1] + ' phone: the show with the player\'s name', r.until(p1, 'window.VPSting && VPSting.playing()', 15) is True and r.ask(p1, 'VPSting.shown()') == words, r.ask(p1, 'VPSting.shown()'))
            ok(words[1] + ' phone: gives way to the first question or song', r.until(p1, '!VPSting.playing() && VPSting.stats().plays===1', 8) is True, r.ask(p1, STATS))
        for path, line in (('/app/raffle/screen?venue=' + r.W.info['slug'] + '&sting=1', 'IT\u2019S RAFFLE TIME'), ('/app/members/screen?venue=' + r.W.info['slug'] + '&sting=1', 'MEMBERS DRAW TIME')):
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


if __name__ == '__main__':
    full_show()
    ball_mid_show()
    other_games()
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
