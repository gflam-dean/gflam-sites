#!/usr/bin/env python3
"""A WINNER ON A REAL-BALLS NIGHT, PLAYED IN A REAL BROWSER (Dean's play test, 21 Oct 2026).

Dean ran "Real balls (caller mode)" and chose One line at the start. After he tapped Winner the
console asked "What have they won?" with a list of prizes, as if he had not already said, and gave no
instruction; the TV celebrated BINGO! before anyone had looked at the book; and straight after the
win the console moved the game on to Two lines by itself. Now: Winner names the pattern being played
and says what to check, with one big Confirm win; the TV says BINGO? while the host checks; Confirm
celebrates on the TV; and the game WAITS on the winner until the host chooses Keep playing for the
next pattern, or Finish this game. The pattern changes only when the host taps one.

Three games, each run through the real console (app/index.html) and the real TV (tv.html) on the
rig in tools/browser-rig/rig.py (the repo's pages, the real game Worker in jsc, headless Chrome):
  1. One line, confirmed, then Finish this game (the host wanted one prize).
  2. One line, then Keep playing for Two lines, then Keep playing for Full house, which ends it.
  3. Not a win, on a phone-width console.
  4. The venue's own pattern (24 Oct 2026): "Custom pattern..." opens the editor, "Any 5 numbers" is
     saved, comes back after a reload, is played and won with its name on the TV, and is deleted.
  5. New game tapped by mistake (24 Oct 2026): Back to the last game puts the board, pattern and prize
     back on the TV, on the same draw, and the next number carries on the old game.

    python3 tools/caller-winner-in-chrome.test.py       screenshots go to $VP_SHOTS if set
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

VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)
def text(r, sid, i): return r.ask(sid, '((document.getElementById(%s)||{}).textContent||"").replace(/\\s+/g," ").trim()' % json.dumps(i))
def wall(r, tv): return r.ask(tv, '(function(){var o=[];["tvRun","tvClaim","tvWin","tvLobby","adsRoot"].forEach(function(i){var e=document.getElementById(i);if(e&&!e.classList.contains("hidden")&&getComputedStyle(e).display!=="none")o.push(i);});return o.join();})()')
def tap(r, sid, i): r.ask(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i)); time.sleep(0.8)
def choose(r, host, nxt):
    """Tap one of the what-next buttons: a pattern to keep playing for, or '' to finish."""
    return r.ask(host, '(function(){var b=document.querySelector(\'#cwNextBtns [data-next=%s]\'); if(!b) return false; setTimeout(function(){ b.click(); }, 0); return true;})()' % json.dumps(nxt))
def choices(r, host): return r.ask(host, '[].map.call(document.querySelectorAll("#cwNextBtns [data-next]"), function(b){ return b.textContent.replace(/\\s+/g," ").trim(); })')
# What the console has saved: the record a reload of the tablet comes back to, so it is the state that counts.
SAVED = ('(function(){for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);'
         'if(k.indexOf("vpHostGame-")===0){try{return JSON.parse(localStorage.getItem(k));}catch(e){}}}return {};})()')
def g(r, host, expr): return r.ask(host, '(function(G){ return JSON.stringify(%s); })(%s)' % (expr, SAVED))
JARGON = ('stage', 'caller', 'paper book', 'pattern:', 'undefined', 'null')

def console(r, width=1024, height=1100):
    tid, host = r.open('/app/', width=width, height=height)
    ok('the console loads, signed in, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    return host

def reload_console(r, host):
    r.ask(host, 'location.reload(); true'); time.sleep(2)
    ok('the console reloads, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)

def start_caller_night(r, host, pattern, prize, numbers):
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("callerChk").checked=true;$("callerChk").dispatchEvent(new Event("change"));'
                 '$("patternSel").value=%s;$("patternSel").dispatchEvent(new Event("change"));$("prizeInput").value=%s;true') % (json.dumps(pattern), json.dumps(prize)))
    for _ in range(2):
        tap(r, host, 'startBtn'); time.sleep(0.8)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)
        r.until(host, '/Start/i.test(document.getElementById("startBtn").textContent) || ' + vis('callerGrid'), 10)
    up = r.until(host, vis('callerGrid'), 10)
    call(r, host, numbers)
    return up

def call(r, host, numbers):
    for n in numbers:
        r.ask(host, 'document.querySelector(\'#callerGrid [data-n="%d"]\').click(); true' % n); time.sleep(0.35)
    time.sleep(1.2)

def tv_screen(r):
    _, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1280, height=720)
    ok('the TV loads on the ads', r.until(tv, vis('adsRoot'), 15) is True)
    time.sleep(1.5)
    return tv

def table(r, name):
    """The Worker's fake database, read back (worker-stdio.js answers {table}). Never a Worker route."""
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': name}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    return (json.loads(line) if line else {}).get('body') or []

BUILTIN_OPTS = '["one","two","full","corners","top","middle","bottom"]'
def opts(r, host, sel): return r.ask(host, '[].map.call(document.querySelectorAll("#%s option"), function(o){ return [o.value, o.textContent]; })' % sel) or []

def no_jargon(r, tv, where):
    t = (r.ask(tv, 'document.body.innerText') or '').lower()
    hit = [j for j in JARGON if j in t]
    ok('the TV says nothing a room would not understand (%s)' % where, not hit, hit)


# ======================================================================================
def one_prize_game():
    print('\nGAME 1: One line chosen at the start. Winner, check, confirm, then the host finishes the game')
    r = RIG.Rig()
    try:
        tv = tv_screen(r)
        host = console(r)
        ok('a real-balls night for One line, Meat tray, starts and the grid is up', start_caller_night(r, host, 'one', 'Meat tray', [5, 17, 42, 61, 88]) is True)
        ok('CONTROL: the TV shows the board for One line and the Meat tray', r.until(tv, vis('tvRun'), 10) is True and text(r, tv, 'tvPattern') == 'One line' and text(r, tv, 'tvPrize') == 'Meat tray',
           [wall(r, tv), text(r, tv, 'tvPattern'), text(r, tv, 'tvPrize')])
        shot(r, host, '1-console-playing-one-line'); shot(r, tv, '1-tv-playing-one-line')

        tap(r, host, 'callerWinBtn')
        ok('WINNER asks no question: no "What have they won?" sheet anywhere', r.ask(host, '!document.getElementById("cwModal") && !/What have they won/.test(document.body.innerText)') is True)
        ok('the console names the pattern chosen at the start: "Winner!" "One line"', r.ask(host, vis('callerWinBar')) is True and text(r, host, 'callerWinHead') == 'Winner!' and text(r, host, 'callerWinSays') == 'One line',
           [text(r, host, 'callerWinHead'), text(r, host, 'callerWinSays')])
        how = text(r, host, 'callerWinHow')
        ok('with one plain instruction: check their book for one whole row, then tap Confirm win', 'Check their book' in how and 'one whole row' in how and 'Confirm win' in how, how)
        box = r.ask(host, '(function(){var a=document.getElementById("callerConfirmBtn").getBoundingClientRect(),b=document.getElementById("callerNotWinBtn").getBoundingClientRect();return {ah:a.height,bh:b.height,at:document.getElementById("callerConfirmBtn").innerText,bt:document.getElementById("callerNotWinBtn").innerText};})()') or {}
        ok('one big Confirm win, and a smaller Not a win under it', r.ask(host, vis('callerConfirmBtn')) is True and box.get('ah', 0) >= 56 and box.get('bh', 99) < box.get('ah', 0) and
           box.get('at', '').lower() == 'confirm win' and 'not a win' in box.get('bt', '').lower(), box)
        ok('and none of the what-next choices yet', r.ask(host, vis('cwNext')) is False)
        ok('the TV: BINGO? with the pattern, while the host checks the book (no celebration yet)', r.until(tv, vis('tvClaim'), 8) is True and r.ask(tv, vis('tvWin')) is False and
           text(r, tv, 'claimName') == 'One line' and 'host is checking the book' in text(r, tv, 'claimSub'), [wall(r, tv), text(r, tv, 'claimName'), text(r, tv, 'claimSub')])
        no_jargon(r, tv, 'while the book is checked')
        shot(r, host, '2-console-winner-check-the-book'); shot(r, tv, '2-tv-bingo-checking-the-book')

        tap(r, host, 'callerConfirmBtn')
        ok('Confirm win: the TV celebrates BINGO! One line, Meat tray', r.until(tv, vis('tvWin'), 8) is True and text(r, tv, 'winName').lower() == 'one line' and text(r, tv, 'winPrizeVal') == 'Meat tray',
           [wall(r, tv), text(r, tv, 'winName'), text(r, tv, 'winPrizeVal')])
        ok('telling the room "See the host to collect your prize"', r.ask(tv, vis('winSubPaper')) is True and text(r, tv, 'winSubPaper') == 'See the host to collect your prize', text(r, tv, 'winSubPaper'))
        no_jargon(r, tv, 'on the winner')
        ok('the console: "Win confirmed", and asks what happens next', text(r, host, 'callerWinHead') == 'Win confirmed' and 'What happens next' in text(r, host, 'callerWinHow') and r.ask(host, vis('cwCheck')) is False, text(r, host, 'callerWinBar'))
        ch = choices(r, host) or []
        ok('three plain choices, one tap each: Keep playing for Two lines, Keep playing for Full house, Finish this game',
           len(ch) == 3 and ch[0].startswith('Keep playing for Two lines') and ch[1].startswith('Keep playing for Full house') and ch[2].startswith('Finish this game'), ch)
        ok('THE GAME HAS NOT MOVED ON BY ITSELF: still One line on the console', g(r, host, '[G.pattern, document.getElementById("patternSel").value, (G.prizesWon||[]).length]') == '["one","one",1]',
           g(r, host, '[G.pattern, document.getElementById("patternSel").value, (G.prizesWon||[]).length]'))
        shot(r, host, '3-console-win-confirmed-what-next'); shot(r, tv, '3-tv-winner-one-line')
        time.sleep(9)
        ok('and nine seconds on, the winner is still up and nothing has changed', r.ask(tv, vis('tvWin')) is True and g(r, host, 'G.pattern') == '"one"' and r.ask(host, vis('cwNext')) is True, [wall(r, tv), g(r, host, 'G.pattern')])

        ok('Finish this game is one tap', choose(r, host, '') is True); time.sleep(1)
        ok('the game is done, still One line, the line on the record once', g(r, host, '[G.won, G.pattern, (G.prizesWon||[]).length, !!G.callerWin]') == '[true,"one",1,false]', g(r, host, '[G.won, G.pattern, (G.prizesWon||[]).length, !!G.callerWin]'))
        ok('the coach says what to do: New game or End game', 'That game is done' in text(r, host, 'coach') and 'New game' in text(r, host, 'coach'), text(r, host, 'coach'))
        ok('the winner stays on the TV', r.ask(tv, vis('tvWin')) is True, wall(r, tv))
        shot(r, host, '4-console-game-finished'); shot(r, tv, '4-tv-after-finish')
        tap(r, host, 'newGameBtn')
        ok('ARE YOU SURE: New game after finishing on One line warns it never reached a full house, and Cancel has the focus',
           r.ask(host, vis('ngModal')) is True and r.ask(host, vis('ngWarn')) is True and text(r, host, 'ngWarn') == 'This game has not reached a full house yet. It finished on One line.' and
           text(r, host, 'ngGo') == 'Yes, start a new game' and r.ask(host, 'document.activeElement && document.activeElement.id') == 'ngCancel',
           [text(r, host, 'ngWarn'), text(r, host, 'ngGo'), r.ask(host, 'document.activeElement && document.activeElement.id')])
        shot(r, host, '4b-console-new-game-are-you-sure')
        tap(r, host, 'ngCancel')
        ok('Cancel: the box goes and the finished game is still there', r.ask(host, vis('ngModal')) is False and g(r, host, '[G.won, G.pattern]') == '[true,"one"]', g(r, host, '[G.won, G.pattern]'))
        ok('no script errors on the console or the TV', r.ask(host, 'window.__errs.length') == 0 and r.ask(tv, 'window.__errs.length') == 0, [r.ask(host, 'JSON.stringify(window.__errs)'), r.ask(tv, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


def three_prize_game():
    print('\nGAME 2: One line, then the host keeps playing for Two lines, then for Full house')
    r = RIG.Rig()
    try:
        tv = tv_screen(r)
        host = console(r)
        ok('a real-balls night for One line starts', start_caller_night(r, host, 'one', 'Meat tray', [3, 14, 25, 36, 47]) is True)
        tap(r, host, 'callerWinBtn'); tap(r, host, 'callerConfirmBtn')
        r.until(tv, vis('tvWin'), 8)
        r.ask(host, 'document.getElementById("cwNextPrize").value="$50 bar tab"; true')
        ok('Keep playing for Two lines is one tap', choose(r, host, 'two') is True); time.sleep(1.2)
        ok('the TV goes back to the board, naming Two lines and the prize the host set for it', r.until(tv, vis('tvRun'), 8) is True and text(r, tv, 'tvPattern') == 'Two lines' and text(r, tv, 'tvPrize') == '$50 bar tab',
           [wall(r, tv), text(r, tv, 'tvPattern'), text(r, tv, 'tvPrize')])
        ok('the console plays on for Two lines, the grid live again', g(r, host, '[G.pattern, !!G.callerWin, G.won]') == '["two",false,false]' and r.ask(host, vis('callerWinBar')) is False, g(r, host, '[G.pattern, !!G.callerWin, G.won]'))
        ok('and the confetti stops with the winner, so the room reads the numbers clearly', r.ask(tv, '!document.getElementById("winBurst").classList.contains("show")') is True)
        ok('no piece of confetti still falling over the board for Two lines', r.ask(tv, 'document.querySelectorAll("#tv .confetti").length') == 0, r.ask(tv, 'document.querySelectorAll("#tv .confetti").length'))
        shot(r, host, '5-console-playing-two-lines'); shot(r, tv, '5-tv-board-two-lines')
        call(r, host, [58, 69])
        tap(r, host, 'callerWinBtn')
        ok('the next Winner is checked for Two lines', text(r, host, 'callerWinSays') == 'Two lines' and 'two whole rows' in text(r, host, 'callerWinHow') and r.until(tv, vis('tvClaim'), 8) is True and text(r, tv, 'claimName') == 'Two lines',
           [text(r, host, 'callerWinSays'), text(r, tv, 'claimName')])
        tap(r, host, 'callerConfirmBtn')
        ch = choices(r, host) or []
        ok('after two lines: Keep playing for Full house, or Finish this game', len(ch) == 2 and ch[0].startswith('Keep playing for Full house') and ch[1].startswith('Finish this game'), ch)
        ok('the TV celebrates Two lines, $50 bar tab', r.until(tv, vis('tvWin'), 8) is True and text(r, tv, 'winName').lower() == 'two lines' and text(r, tv, 'winPrizeVal') == '$50 bar tab', [text(r, tv, 'winName'), text(r, tv, 'winPrizeVal')])
        shot(r, host, '6-console-two-lines-what-next'); shot(r, tv, '6-tv-winner-two-lines')
        ok('Keep playing for Full house', choose(r, host, 'full') is True); time.sleep(1.2)
        ok('the TV goes back to the board for Full house', r.until(tv, vis('tvRun'), 8) is True and text(r, tv, 'tvPattern') == 'Full house', [wall(r, tv), text(r, tv, 'tvPattern')])
        call(r, host, [71, 82])
        tap(r, host, 'callerWinBtn')
        ok('the Winner check asks for every number on one ticket', text(r, host, 'callerWinSays') == 'Full house' and 'every number on one ticket' in text(r, host, 'callerWinHow'), text(r, host, 'callerWinHow'))
        tap(r, host, 'callerConfirmBtn')
        ok('a confirmed full house ends the game: nothing left to choose', g(r, host, '[G.won, (G.prizesWon||[]).length, !!G.callerWin]') == '[true,3,false]' and r.ask(host, vis('callerWinBar')) is False and 'That game is done' in text(r, host, 'coach'),
           [g(r, host, '[G.won, (G.prizesWon||[]).length, !!G.callerWin]'), text(r, host, 'coach')])
        ok('and the TV celebrates the full house', r.until(tv, vis('tvWin'), 8) is True and text(r, tv, 'winName').lower() == 'full house', text(r, tv, 'winName'))
        no_jargon(r, tv, 'on the full house')
        shot(r, host, '7-console-full-house-done'); shot(r, tv, '7-tv-winner-full-house')
        tap(r, host, 'newGameBtn')
        ok('after a full house, New game has no warning and asks exactly as before: Start next game', r.ask(host, vis('ngModal')) is True and r.ask(host, vis('ngWarn')) is False and text(r, host, 'ngGo') == 'Start next game',
           [r.ask(host, vis('ngWarn')), text(r, host, 'ngGo')])
        tap(r, host, 'ngCancel')
        ok('no script errors on the console or the TV', r.ask(host, 'window.__errs.length') == 0 and r.ask(tv, 'window.__errs.length') == 0, [r.ask(host, 'JSON.stringify(window.__errs)'), r.ask(tv, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


def not_a_win():
    print('\nGAME 3: Not a win, on a console the width of a phone')
    r = RIG.Rig()
    try:
        tv = tv_screen(r)
        host = console(r, width=390, height=844)
        ok('a real-balls night for One line starts on a phone', start_caller_night(r, host, 'one', 'Meat tray', [7, 18, 29]) is True)
        tap(r, host, 'callerWinBtn')
        r.ask(host, 'document.getElementById("callerWinBar").scrollIntoView({block:"start"}); true'); time.sleep(0.4)
        # Under a loaded gate (the ledger runs six suites at once) the bar can still be laying out after 0.4s:
        # wait for Confirm win to be on screen before measuring, rather than measuring a half-drawn page.
        r.until(host, vis('callerConfirmBtn') + ' && document.getElementById("callerConfirmBtn").getBoundingClientRect().height>0', 10)
        fits = r.ask(host, '(function(){var b=document.getElementById("callerWinBar").getBoundingClientRect(),c=document.getElementById("callerConfirmBtn").getBoundingClientRect();return {w:document.documentElement.scrollWidth,vw:innerWidth,r:b.right,cr:c.right,ch:c.height};})()') or {}
        ok('at phone width the check fits: no sideways scroll, Confirm win full width of the bar', fits.get('w', 999) <= fits.get('vw', 0) and fits.get('cr', 999) <= fits.get('vw', 0) and fits.get('ch', 0) >= 56, fits)
        shot(r, host, '8-phone-console-winner-check')
        ok('CONTROL: the TV is on BINGO? while the book is checked', r.until(tv, vis('tvClaim'), 8) is True, wall(r, tv))
        tap(r, host, 'callerNotWinBtn')
        ok('Not a win: the TV goes straight back to the board, still One line', r.until(tv, vis('tvRun'), 8) is True and r.ask(tv, vis('tvClaim')) is False and text(r, tv, 'tvPattern') == 'One line',
           [wall(r, tv), text(r, tv, 'tvPattern')])
        ok('nothing recorded, nothing changed, and the grid calls again', g(r, host, '[(G.prizesWon||[]).length, G.pattern, !!G.callerWin, G.won]') == '[0,"one",false,false]', g(r, host, '[(G.prizesWon||[]).length, G.pattern, !!G.callerWin, G.won]'))
        n0 = g(r, host, 'G.draw.length'); call(r, host, [40])
        ok('a number tapped after Not a win is called', g(r, host, 'G.draw.length') == str(int(n0 or 0) + 1), [n0, g(r, host, 'G.draw.length')])
        shot(r, host, '9-phone-console-after-not-a-win'); shot(r, tv, '9-tv-after-not-a-win')
        tap(r, host, 'callerWinBtn')
        ok('the next Winner is not covered by the "Nothing was recorded" note from the last one', r.ask(host, '!document.getElementById("greetToast").classList.contains("show")') is True, text(r, host, 'greetToast'))
        tap(r, host, 'callerConfirmBtn')
        r.until(host, vis('cwNext'), 10)
        r.ask(host, 'document.getElementById("callerWinBar").scrollIntoView({block:"start"}); true'); time.sleep(0.4)
        fit2 = r.ask(host, '(function(){var o=[];[].forEach.call(document.querySelectorAll("#cwNextBtns [data-next]"),function(b){var q=b.getBoundingClientRect();o.push(q.right<=innerWidth && q.height>=52);});return {ok:o, w:document.documentElement.scrollWidth, vw:innerWidth};})()') or {}
        ok('the what-next choices fit a phone too: each a full thumb high, no sideways scroll', fit2.get('ok') == [True, True, True] and fit2.get('w', 999) <= fit2.get('vw', 0), fit2)
        shot(r, host, '10-phone-console-what-next')
        ok('no script errors on the console or the TV', r.ask(host, 'window.__errs.length') == 0 and r.ask(tv, 'window.__errs.length') == 0, [r.ask(host, 'JSON.stringify(window.__errs)'), r.ask(tv, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


def custom_pattern_game():
    print('\nGAME 4: the venue\'s own pattern, "Any 5 numbers": made, saved, played, won, deleted')
    r = RIG.Rig()
    try:
        tv = tv_screen(r)
        host = console(r)
        r.until(host, 'document.querySelector(\'#patternSel option[value="__newpat"]\')!==null', 15)
        o = opts(r, host, 'patternSel')
        ok('BUILT-INS UNCHANGED: the seven patterns first, in order, with their own names',
           [x[0] for x in o[:7]] == json.loads(BUILTIN_OPTS) and o[0][1] == 'One line (any row)' and o[6][1] == 'Bottom line', o)
        ok('"Custom pattern..." is in the list', any(x[0] == '__newpat' and x[1] == 'Custom pattern...' for x in o), o)
        r.ask(host, 'var s=document.getElementById("patternSel"); s.value="__newpat"; s.dispatchEvent(new Event("change")); true'); time.sleep(0.6)
        ok('choosing it opens the editor, and the list stays on One line underneath', r.ask(host, vis('cpModal')) is True and r.ask(host, 'document.getElementById("patternSel").value') == 'one',
           r.ask(host, 'document.getElementById("patternSel").value'))
        r.ask(host, 'document.getElementById("cpShape").click(); [0,8,20,26,13].forEach(function(i){ document.querySelector(\'#cpGrid [data-cell="\'+i+\'"]\').click(); }); document.getElementById("cpName").value="Corners and centre"; true'); time.sleep(0.4)
        ok('the shape grid is 3 rows of 9 and the squares tapped light up', r.ask(host, 'document.querySelectorAll("#cpGrid button").length') == 27 and r.ask(host, 'document.querySelectorAll("#cpGrid button.on").length') == 5)
        shot(r, host, '11-console-pattern-editor-shape')
        r.ask(host, 'document.getElementById("cpName").value=""; document.getElementById("cpAny").click(); document.getElementById("cpN").value="5"; true')
        tap(r, host, 'cpSave')
        ok('no name: it does not save, and says why', r.ask(host, vis('cpModal')) is True and 'name' in text(r, host, 'cpErr').lower(), text(r, host, 'cpErr'))
        r.ask(host, 'document.getElementById("cpName").value="Any 5 numbers"; true')
        shot(r, host, '12-console-pattern-editor-any-5')
        tap(r, host, 'cpSave'); time.sleep(1)
        o = opts(r, host, 'patternSel')
        ok('Save: the editor closes, "Any 5 numbers" is in the list after the seven, and chosen', r.ask(host, vis('cpModal')) is False and any(x[1] == 'Any 5 numbers' for x in o[7:]) and
           r.ask(host, '/^c:/.test(document.getElementById("patternSel").value)') is True, [o, r.ask(host, 'document.getElementById("patternSel").value')])
        saved = table(r, 'vp_bingo_patterns')
        ok('saved on the server for this venue: any 5', len(saved) == 1 and saved[0].get('name') == 'Any 5 numbers' and saved[0].get('rule') == {'type': 'any', 'n': 5}, saved)
        ok('Edit is offered beside a saved pattern', r.ask(host, vis('patEditRow')) is True)

        reload_console(r, host)
        r.until(host, 'document.querySelector(\'#patternSel option[data-custom]:not([value="__newpat"])\')!==null', 15)
        ok('A RELOAD: the saved pattern is in the list again', any(x[1] == 'Any 5 numbers' for x in opts(r, host, 'patternSel')), opts(r, host, 'patternSel'))
        r.ask(host, 'var s=document.getElementById("patternSel"); [].some.call(s.options, function(o){ if(o.textContent==="Any 5 numbers"){ s.value=o.value; return true; } }); s.dispatchEvent(new Event("change")); true')

        key = r.ask(host, 'document.getElementById("patternSel").value')
        ok('a real-balls night for Any 5 numbers starts', start_caller_night(r, host, key, 'Bottle of bubbles', [4, 15, 33, 52, 77]) is True)
        ok('the TV board names it: Any 5 numbers', r.until(tv, vis('tvRun'), 10) is True and text(r, tv, 'tvPattern') == 'Any 5 numbers', [wall(r, tv), text(r, tv, 'tvPattern')])
        tap(r, host, 'callerWinBtn')
        ok('Winner names it and says what to check: any 5 numbers on one ticket', text(r, host, 'callerWinSays') == 'Any 5 numbers' and 'any 5 numbers on one ticket' in text(r, host, 'callerWinHow'),
           [text(r, host, 'callerWinSays'), text(r, host, 'callerWinHow')])
        ok('the TV: BINGO? Any 5 numbers, while the book is checked', r.until(tv, vis('tvClaim'), 8) is True and text(r, tv, 'claimName') == 'Any 5 numbers', text(r, tv, 'claimName'))
        tap(r, host, 'callerConfirmBtn')
        ok('Confirm: the TV celebrates BINGO! ANY 5 NUMBERS and the prize', r.until(tv, vis('tvWin'), 8) is True and text(r, tv, 'winName').lower() == 'any 5 numbers' and text(r, tv, 'winPrizeVal') == 'Bottle of bubbles',
           [wall(r, tv), text(r, tv, 'winName'), text(r, tv, 'winPrizeVal')])
        no_jargon(r, tv, 'on a custom winner')
        shot(r, tv, '13-tv-winner-any-5-numbers'); shot(r, host, '13-console-any-5-what-next')
        ch = choices(r, host) or []
        ok('after it: Keep playing for Full house, or Finish this game', len(ch) == 2 and ch[0].startswith('Keep playing for Full house') and ch[1].startswith('Finish this game'), ch)
        ok('the win is on the record under its name', g(r, host, '(G.prizesWon||[]).map(function(w){ return w.pattern.slice(0,2); })') == '["c:"]', g(r, host, 'G.prizesWon'))
        choose(r, host, ''); time.sleep(1)
        tap(r, host, 'endGameBtn'); time.sleep(1.5)
        r.ask(host, 'var d=document.getElementById("nightDone"); if(d) d.click(); true'); time.sleep(1)
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 10)
        r.ask(host, 'var s=document.getElementById("patternSel"); s.value=%s; s.dispatchEvent(new Event("change")); true' % json.dumps(key)); time.sleep(0.4)
        tap(r, host, 'patEditBtn')
        ok('Edit opens it with its name and rule', r.ask(host, vis('cpModal')) is True and r.ask(host, 'document.getElementById("cpName").value') == 'Any 5 numbers' and
           r.ask(host, 'document.getElementById("cpAny").checked && document.getElementById("cpN").value') == '5')
        tap(r, host, 'cpDelete')
        ok('Delete asks once more before it goes', 'Tap again' in text(r, host, 'cpDelete') and len([x for x in table(r, 'vp_bingo_patterns') if not x.get('deleted_at')]) == 1, text(r, host, 'cpDelete'))
        tap(r, host, 'cpDelete'); time.sleep(1)
        ok('deleted: off the list, the list back on One line, and off the venue\'s saved list', not any(x[1] == 'Any 5 numbers' for x in opts(r, host, 'patternSel')) and
           r.ask(host, 'document.getElementById("patternSel").value') == 'one' and len([x for x in table(r, 'vp_bingo_patterns') if not x.get('deleted_at')]) == 0, opts(r, host, 'patternSel'))
        errs_before = r.ask(host, 'JSON.stringify(window.__errs)')
        reload_console(r, host)
        r.until(host, 'document.querySelector(\'#patternSel option[value="__newpat"]\')!==null', 15)
        ok('and after a reload it stays gone', not any(x[1] == 'Any 5 numbers' for x in opts(r, host, 'patternSel')), opts(r, host, 'patternSel'))
        ok('no script errors on the console (before and after the reload) or the TV', errs_before == '[]' and r.ask(host, 'window.__errs.length') == 0 and r.ask(tv, 'window.__errs.length') == 0,
           [r.ask(host, 'JSON.stringify(window.__errs)'), r.ask(tv, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


def new_game_by_mistake():
    print('\nGAME 5: New game tapped by mistake, then Back to the last game')
    r = RIG.Rig()
    try:
        tv = tv_screen(r)
        host = console(r)
        ok('a real-balls night for One line, Meat tray, three numbers called', start_caller_night(r, host, 'one', 'Meat tray', [5, 17, 42]) is True)
        r.until(host, '!!JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf("vpHostGame-")===0;})[0])||"{}").drawId', 10)
        d0 = g(r, host, 'G.drawId'); draws0 = len(table(r, 'vp_bingo_draws')); reps0 = table(r, 'vp_game_reports')
        ok('CONTROL: the TV board shows 3 called, One line, Meat tray', r.until(tv, vis('tvRun'), 8) is True and text(r, tv, 'tvBallCount') == '3 of 90 called' and text(r, tv, 'tvPattern') == 'One line',
           [text(r, tv, 'tvBallCount'), text(r, tv, 'tvPattern')])
        tap(r, host, 'newGameBtn')
        ok('a game still being played warns first: "It is still on One line."', text(r, host, 'ngWarn') == 'This game has not reached a full house yet. It is still on One line.', text(r, host, 'ngWarn'))
        r.ask(host, 'document.getElementById("ngPattern").value="two"; document.getElementById("ngPrize").value="Jug of beer"; true')
        tap(r, host, 'ngGo'); time.sleep(1.2)
        ok('the new game is up: TV board cleared for Two lines, Jug of beer', r.until(tv, 'document.getElementById("tvPattern").textContent==="Two lines"', 8) is True and text(r, tv, 'tvPrize') == 'Jug of beer' and
           text(r, tv, 'tvBallCount') == '0 of 90 called', [text(r, tv, 'tvPattern'), text(r, tv, 'tvPrize'), text(r, tv, 'tvBallCount')])
        ok('the console offers Back to the last game', r.ask(host, vis('undoNewGameBtn')) is True and text(r, host, 'undoNewGameBtn') == 'Back to the last game')
        ok('nothing irreversible yet: no new draw on the server, the last game\'s report not closed', len(table(r, 'vp_bingo_draws')) == draws0 and
           all(not x.get('ended_at') for x in table(r, 'vp_game_reports')) and len(table(r, 'vp_game_reports')) == len(reps0), [len(table(r, 'vp_bingo_draws')), table(r, 'vp_game_reports')])
        shot(r, host, '14-console-back-to-last-game'); shot(r, tv, '14-tv-new-game-by-mistake')
        tap(r, host, 'undoNewGameBtn'); time.sleep(1.2)
        ok('Back: the TV shows the old board again, 3 called, One line, Meat tray', r.until(tv, 'document.getElementById("tvPattern").textContent==="One line"', 8) is True and
           text(r, tv, 'tvPrize') == 'Meat tray' and text(r, tv, 'tvBallCount') == '3 of 90 called', [text(r, tv, 'tvPattern'), text(r, tv, 'tvPrize'), text(r, tv, 'tvBallCount')])
        ok('the console is the old game: same numbers in order, pattern, prize, the same server draw', g(r, host, '[G.draw, G.pattern, G.prize, G.drawId===%s, G.won]' % json.dumps(json.loads(d0))) == '[[5,17,42],"one","Meat tray",true,false]',
           g(r, host, '[G.draw, G.pattern, G.prize, G.drawId, G.won]'))
        ok('the button is gone, and the grid shows the three numbers called', r.ask(host, vis('undoNewGameBox')) is False and r.ask(host, 'document.querySelectorAll("#callerGrid .cg.on").length') == 3)
        shot(r, host, '15-console-last-game-back'); shot(r, tv, '15-tv-last-game-back')
        call(r, host, [61])
        balls = [b for b in table(r, 'vp_bingo_draw_balls') if b.get('draw_id') == json.loads(d0) and not b.get('withdrawn_at')]
        ok('the next number carries on the old game: 4 called on the TV, on the same draw record', text(r, tv, 'tvBallCount') == '4 of 90 called' and g(r, host, 'G.draw') == '[5,17,42,61]' and
           len(table(r, 'vp_bingo_draws')) == draws0 and [b.get('number') for b in sorted(balls, key=lambda b: b.get('ordinal'))][-1:] == [61], [text(r, tv, 'tvBallCount'), g(r, host, 'G.draw'), len(balls)])
        ok('and the report: still one open row for the game, not two', len(table(r, 'vp_game_reports')) == len(reps0) and all(not x.get('ended_at') for x in table(r, 'vp_game_reports')), table(r, 'vp_game_reports'))
        tap(r, host, 'newGameBtn')
        r.ask(host, 'document.getElementById("ngPattern").value="full"; document.getElementById("ngPrize").value="Meat tray"; true')
        tap(r, host, 'ngGo'); time.sleep(1)
        call(r, host, [9])
        time.sleep(1.5)
        ok('a REAL new game: its first number ends the undo, opens a new draw and closes the last game\'s report', r.ask(host, vis('undoNewGameBox')) is False and len(table(r, 'vp_bingo_draws')) == draws0 + 1 and
           g(r, host, 'G.draw') == '[9]' and any(x.get('ended_at') for x in table(r, 'vp_game_reports')), [len(table(r, 'vp_bingo_draws')), g(r, host, 'G.draw'), table(r, 'vp_game_reports')])
        ok('no script errors on the console or the TV', r.ask(host, 'window.__errs.length') == 0 and r.ask(tv, 'window.__errs.length') == 0, [r.ask(host, 'JSON.stringify(window.__errs)'), r.ask(tv, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


try:
    one_prize_game()
    three_prize_game()
    not_a_win()
    custom_pattern_game()
    new_game_by_mistake()
except Exception as e:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
