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


try:
    one_prize_game()
    three_prize_game()
    not_a_win()
except Exception as e:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
