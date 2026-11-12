#!/usr/bin/env python3
"""THE DRAW MOMENTS ON THE REAL TV SCREENS, PLAYED IN CHROME (13 Nov 2026, INBOX 285 option 2 and 299b option 3).

Both are OFF for every venue until a host switches them on, so this suite plays each screen BOTH ways. On the rig
(tools/browser-rig/rig.py, headless Chrome) the real members and raffle screens hear a host on their own channel:

  1. WINNER TAKES THE SCREEN (members, flip board, wx:1): no numbers-drawn strip, no money in the stage ("Playing for $..."), the number
     board shrinks to the top and the name flips in on giant tiles as First Last (from "Hollis,Kate"), one row for a short name, two for a
     long one; every tile and the claim line inside the safe box at 1280x720 and 1920x1080; the claim clock is in the countdown band,
     not the stage; the collected card has the name and no amount
  2. THE SAME WITHOUT wx: the strip, the old name flap, the stage's own clock, no tiles (nothing changed for a venue that has not switched it on)
  3. COUNTDOWN (t:count): members = the blank flip board under the band "Draw in 0:40" and a draining bar; the final ten dims the screen
     and shows one huge number with "Get to the screen"; raffle = the band over Get your tickets, "Last tickets, now"; the draw cancels it;
     count_off returns; a screen that never hears a count makes no overlay at all
  4. SILENT: no audio is made; no page errors

    python3 tools/tv-draw-moments-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
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
STAGE_TEXT = '(function(){var h=document.getElementById("tvStyleHost");return h?h.textContent.replace(/\\s+/g," ").trim():"";})()'
AUDIO = '(window.__audioMade||0)'
BC_BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
             'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();'
             'window.__audioMade=0;window.__audioWho=[];var A=window.Audio;if(A){window.Audio=function(){window.__audioMade++;window.__audioWho.push(String(new Error().stack).slice(0,300));return new A();};}'
             'var AC=window.AudioContext||window.webkitAudioContext;if(AC){var W2=function(){window.__audioMade++;window.__audioWho.push(String(new Error().stack).slice(0,300));return new AC();};W2.prototype=AC.prototype;window.AudioContext=W2;}')
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

# the letters on the name tiles (the shown flap's letter of each module), row by row
NAME_TILES = '''(function(){var rows=document.querySelectorAll("#tvStyleHost .vpds-world > .vpds-row"),o=[];
  Array.prototype.forEach.call(rows,function(r){var t="";Array.prototype.forEach.call(r.querySelectorAll(".vpds-m"),function(m){var c=m.querySelector(".vpds-hb .vpds-ch");t+=c?c.textContent:"";});o.push(t);});return o;})()'''
# every painted box of the stage + the band sits inside the TV window (the .tv box is the 5% safe box)
BOXES = '''(function(){var tv=document.getElementById("tv").getBoundingClientRect(),bad=[];
  var q=["#tvStyleHost .vpds-world > .vpds-row .vpds-m","#tvStyleHost .vpds-claim","#tvStyleHost .vpds-board",".vpdc-band",".vpdc-big",".vpdc-line"];
  q.forEach(function(sel){Array.prototype.forEach.call(document.querySelectorAll(sel),function(e){var b=e.getBoundingClientRect(),o=parseFloat(getComputedStyle(e).opacity);
    if(!b.width||!(o>0.5)) return; if(b.left<tv.left-1||b.right>tv.right+1||b.top<tv.top-1||b.bottom>tv.bottom+1) bad.push([sel,Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]);});});
  return bad;})()'''
ABOVE_BAND = '''(function(){var b=document.querySelector(".vpdc-band");if(!b||parseFloat(getComputedStyle(b).opacity)<0.5)return "noband";var top=b.getBoundingClientRect().top,bad=[];
  ["#tvStyleHost .vpds-claim","#tvStyleHost .vpds-prize","#tvStyleHost .vpds-world > .vpds-row .vpds-m"].forEach(function(sel){Array.prototype.forEach.call(document.querySelectorAll(sel),function(e){
    var r=e.getBoundingClientRect(),o=parseFloat(getComputedStyle(e).opacity);if(!r.width||!(o>0.5)||!(e.textContent||"").trim())return;if(r.bottom>top+1)bad.push([sel,Math.round(r.bottom),Math.round(top)]);});});return bad;})()'''
BOARD_BOTTOM = '(function(){var b=document.querySelector("#tvStyleHost .vpds-board");return b?b.getBoundingClientRect().bottom:-1;})()'
FIRST_TILE_TOP = '(function(){var m=document.querySelector("#tvStyleHost .vpds-world > .vpds-row .vpds-m");return m?m.getBoundingClientRect().top:-1;})()'
BAND = '(function(){var b=document.querySelector(".vpdc-band"),t=document.querySelector(".vpdc-txt");return b&&parseFloat(getComputedStyle(b).opacity)>0.5?t.textContent.replace(/\\s+/g," ").trim():"";})()'
BIG = '(function(){var b=document.querySelector(".vpdc-big");return b&&parseFloat(getComputedStyle(b).opacity)>0.5?b.textContent:"";})()'
LINE = '(function(){var b=document.querySelector(".vpdc-line");return b&&parseFloat(getComputedStyle(b).opacity)>0.5?b.textContent:"";})()'
FILL = '(function(){var f=document.querySelector(".vpdc-fill");var m=/scaleX\\(([0-9.]+)\\)/.exec(f?f.style.transform:"");return m?parseFloat(m[1]):-1;})()'

def draw_members(r, s, name, wx, secs=3, claim=45, cd=None):
    cd = wx if cd is None else cd
    msgs = {'t': 'drawing', 'drawName': 'Friday members draw', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': secs + 1.2, 'style': 'flip', 'drawSecs': secs}
    if wx: msgs.update(wx=1)
    if cd: msgs.update(cd=1)
    says(r, s, [msgs, {'t': 'pick', 'number': 418, 'name': name}])
    time.sleep(secs + 1.2 + 1.0)
    w = {'t': 'winner', 'number': 418, 'name': name, 'claimSecs': claim}
    if wx: w.update(wx=1)
    if cd: w.update(cd=1)
    says(r, s, [w])

def big_winner(width, height, name, rows, letters):
    print('\n1. WINNER TAKES THE SCREEN (%dx%d, %s)' % (width, height, name))
    r = RIG.Rig()
    try:
        s = screen(r, '/app/members/screen', width, height)
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}])
        draw_members(r, s, name, True)
        time.sleep(0.8)
        txt = r.ask(s, STAGE_TEXT) or ''
        ok('no numbers-drawn strip, and no money anywhere in the stage', r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-drawn").length') == 0 and '$' not in txt and 'Playing for' not in txt, txt)
        ok('the number board is still the number (3 flaps) and the name is not on it', r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-board .vpds-m").length') == 3)
        time.sleep(4.2)
        tiles = r.ask(s, NAME_TILES)
        ok('the name flips in on giant tiles as First Last, in %d row(s): %s' % (rows, letters), tiles == letters, tiles)
        ok('the board is small at the top and the tiles start below it (no overlap)', r.ask(s, BOARD_BOTTOM) < r.ask(s, FIRST_TILE_TOP), [r.ask(s, BOARD_BOTTOM), r.ask(s, FIRST_TILE_TOP)])
        ok('the claim line is under the tiles, and the stage has no clock of its own', 'Bring your member card to the host.' in (r.ask(s, STAGE_TEXT) or '') and 'Claim within' not in (r.ask(s, STAGE_TEXT) or ''), r.ask(s, STAGE_TEXT))
        ok('the claim clock is in the countdown band', (r.ask(s, BAND) or '').startswith('Claim within 0:'), r.ask(s, BAND))
        ok('every tile, the board, the claim line and the band sit inside the safe box', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        ok('nothing sits under the band: tiles and claim line end above it', r.ask(s, ABOVE_BAND) == [], r.ask(s, ABOVE_BAND))
        yel = r.ask(s, '(function(){var c=document.querySelector("#tvStyleHost .vpds-world > .vpds-row .vpds-ch");return getComputedStyle(c).color;})()')
        ok('the name is yellow once complete', yel == 'rgb(255, 217, 61)', yel)
        shot(r, s, 'moments-winner-%dx%d-%d' % (width, height, rows))
        aud = [r.ask(s, AUDIO), r.ask(s, 'window.__errs'), r.ask(s, 'window.__audioWho')]   # before the old collected card's own fanfare
        says(r, s, [{'t': 'claimed', 'name': name, 'amountCents': 145000, 'nextResetCents': 20000, 'wx': 1, 'cd': 1}])
        ok('collected: the name is the headline and no amount is on the screen', r.until(s, vis('tvResult'), 4) is True and 'First' != '' and r.ask(s, '/\\$/.test(document.getElementById("tvResult").innerText)') is False and
           r.ask(s, 'document.getElementById("resWinName").textContent') == r.ask(s, 'VPDrawStyle.niceName(%s)' % json.dumps(name)), r.ask(s, 'document.getElementById("tvResult").innerText'))
        ok('the claim band is gone once collected', (r.ask(s, BAND) or '') == '')
        ok('SILENT through the draw and the winner moment, and no page errors', aud[0] == 0 and not (aud[1] or []), aud)
    finally:
        r.close()

def clock_only():
    print('\n1b. COUNTDOWN ON, WINNER SCREEN OFF (flip board as it is, claim clock in the band)')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/members/screen', 1280, 720)
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}])
        draw_members(r, s, 'J. Hollis', False, cd=True)
        time.sleep(3.5)
        ok('the old name flap is as before, the numbers-drawn strip steps aside for the band, the stage has no clock, the band has it', r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-drawn").length') == 0 and 'J. Hollis' in (r.ask(s, STAGE_TEXT) or '') and (r.ask(s, BAND) or '').startswith('Claim within 0:') and 'Claim within' not in (r.ask(s, STAGE_TEXT) or ''), [r.ask(s, BAND), r.ask(s, STAGE_TEXT)])
        ok('the prize line and the claim line end above the band', r.ask(s, ABOVE_BAND) == [], r.ask(s, ABOVE_BAND))
        ok('inside the safe box', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        shot(r, s, 'moments-claim-members-clockonly')
    finally:
        r.close()

def off_as_before():
    print('\n2. SWITCHED OFF: the draw is exactly what it was')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/members/screen')
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}])
        draw_members(r, s, 'Hollis,Kate', False)
        time.sleep(3.5)
        txt = r.ask(s, STAGE_TEXT) or ''
        ok('the numbers-drawn strip is there, the old stage clock is there, the stage names the jackpot', r.ask(s, 'document.querySelectorAll("#tvStyleHost .vpds-drawn").length') == 1 and 'Claim within 0:' in txt and 'Playing for' in txt, txt)
        ok('no name tiles, and the name is as the list has it (the old flap)', r.ask(s, NAME_TILES) == [] and 'Hollis,Kate' not in '' , r.ask(s, NAME_TILES))
        ok('no countdown overlay was ever made', r.ask(s, 'document.querySelectorAll(".vpdc").length') == 0)
        says(r, s, [{'t': 'claimed', 'name': 'Hollis,Kate', 'amountCents': 145000, 'nextResetCents': 20000}])
        ok('collected: the amount still counts up as it always did', r.until(s, vis('tvResult'), 4) is True and r.ask(s, vis('resWon')) is True, r.ask(s, 'document.getElementById("tvResult").innerText'))
    finally:
        r.close()

def countdown_members():
    print('\n3a. COUNTDOWN on the members wall')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/members/screen', 1920, 1080)
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}])
        ok('before any count there is no overlay', r.ask(s, 'document.querySelectorAll(".vpdc").length') == 0)
        says(r, s, [{'t': 'count', 'secs': 30, 'total': 60, 'look': 'flip', 'minNumber': 1, 'maxNumber': 900, 'wx': 1}])
        ok('the blank flip board is up under the band', r.until(s, vis('tvStyle') + ' && document.querySelectorAll("#tvStyleHost .vpds-board").length===1', 5) is True)
        b = r.ask(s, BAND)
        ok('the band says Draw in 0:2x or 0:30', b in ('Draw in 0:30', 'Draw in 0:29', 'Draw in 0:28'), b)
        f = r.ask(s, FILL)
        ok('the bar is draining: about half full', 0.4 < f < 0.55, f)
        blank = r.ask(s, '(function(){var c=document.querySelectorAll("#tvStyleHost .vpds-board .vpds-hb .vpds-ch");var t="";Array.prototype.forEach.call(c,function(e){t+=e.textContent.trim();});return t;})()')
        ok('the board is blank (no number the server has not drawn)', blank == '', blank)
        ok('the band is inside the safe box at 1920x1080', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        shot(r, s, 'moments-count-members-band')
        time.sleep(2)
        says(r, s, [{'t': 'state', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'playing': False}, {'t': 'idle', 'drawName': 'Friday members draw', 'jackpotCents': 145000, 'draws': []}])
        ok('a routine state or idle does not drop the countdown', r.ask(s, BAND).startswith('Draw in 0:') and r.ask(s, vis('tvStyle')) is True, r.ask(s, BAND))
        says(r, s, [{'t': 'count', 'secs': 9, 'total': 60, 'look': 'flip', 'wx': 1}])
        ok('the final ten: the screen dims, ONE huge number, Get to the screen, and the band steps aside', r.until(s, '/^(9|8)$/.test(' + BIG + ')', 3) is True and r.ask(s, LINE) == 'Get to the screen' and r.ask(s, BAND) == '', [r.ask(s, BIG), r.ask(s, LINE), r.ask(s, BAND)])
        ok('the final ten sits inside the safe box', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        shot(r, s, 'moments-count-members-final')
        time.sleep(2.2)
        ok('it counts down one number at a time', r.ask(s, 'parseInt(' + BIG + ',10)') in (6, 7), r.ask(s, BIG))
        says(r, s, [{'t': 'drawing', 'drawName': 'Friday members draw', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': 4.2, 'style': 'flip', 'drawSecs': 3}])
        ok('the draw takes the countdown away', r.until(s, BAND + '==="" && ' + BIG + '===""', 3) is True)
        ok('SILENT (the sound slots are empty), and no page errors', r.ask(s, AUDIO) == 0 and not (r.ask(s, 'window.__errs') or []), [r.ask(s, AUDIO), r.ask(s, 'window.__errs'), r.ask(s, 'window.__audioWho')])
        s2 = screen(r, '/app/members/screen')
        says(r, s2, [{'t': 'count', 'secs': 50, 'total': 60, 'look': 'flip'}])
        r.until(s2, vis('tvStyle'), 4)
        says(r, s2, [{'t': 'count_off'}])
        ok('cancelling takes the band away and the wall goes back to its board', r.until(s2, BAND + '==="" && !' + vis('tvStyle') + ' && !document.getElementById("tvIdle").classList.contains("hidden")', 4) is True, [r.ask(s2, BAND), r.ask(s2, vis('tvStyle')), r.ask(s2, 'document.getElementById("tvIdle").className')])
    finally:
        r.close()

def countdown_raffle():
    print('\n3b. COUNTDOWN on the raffle wall, and the claim clock in the band')
    r = RIG.Rig()
    try:
        s = screen(r, '/app/raffle/screen')
        says(r, s, [{'t': 'state', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150}])
        ok('before any count there is no overlay', r.ask(s, 'document.querySelectorAll(".vpdc").length') == 0)
        says(r, s, [{'t': 'count', 'secs': 12, 'total': 300}])
        ok('the band is over Get your tickets', (r.ask(s, BAND) or '').startswith('Draw in 0:1'), r.ask(s, BAND))
        ok('the bar is nearly empty of a 5 minute countdown', r.ask(s, FILL) < 0.06, r.ask(s, FILL))
        time.sleep(3)
        ok('the final ten says Last tickets, now, with one big number', r.ask(s, LINE) == 'Last tickets, now' and r.ask(s, 'parseInt(' + BIG + ',10)') in (8, 9), [r.ask(s, LINE), r.ask(s, BIG)])
        ok('inside the safe box', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        shot(r, s, 'moments-count-raffle-final')
        says(r, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'ticket', 'drawSecs': 6, 'cd': 1}, {'t': 'pick', 'numbers': [47], 'pad': 3, 'min': 1, 'max': 150}])
        time.sleep(8.8)
        says(r, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [47], 'pad': 3, 'allowRedraw': True, 'time': 90, 'cd': 1}])
        time.sleep(3.2)
        ok('the claim clock is in the band, big, with a yellow bar nearly full', (r.ask(s, BAND) or '').startswith('Claim within 1:') and r.ask(s, FILL) > 0.9, [r.ask(s, BAND), r.ask(s, FILL)])
        sc = r.ask(s, '(function(){var c=document.querySelector("#tvStyleHost .vpds-claim"),k=document.querySelector("#tvStyleHost .vpds-clock");return [c?c.textContent:"",k?parseFloat(getComputedStyle(k).opacity):-1];})()')
        ok('the stage keeps the ticket and its one winner line, and its own clock is hidden', sc and sc[0] == 'Bring ticket 047 to the host.' and sc[1] == 0, sc)
        ok('inside the safe box', r.ask(s, BOXES) == [], r.ask(s, BOXES))
        ok('the ticket, prize and claim line all end above the band', r.ask(s, ABOVE_BAND) == [] and r.ask(s, 'document.querySelector("#tvStyleHost .vpds-claim").getBoundingClientRect().bottom') < r.ask(s, 'document.querySelector(".vpdc-band").getBoundingClientRect().top'), r.ask(s, ABOVE_BAND))
        shot(r, s, 'moments-claim-raffle')
        aud = [r.ask(s, AUDIO), r.ask(s, 'window.__errs'), r.ask(s, 'window.__audioWho')]
        says(r, s, [{'t': 'claimed', 'prizeLabel': 'Meat tray', 'numbers': [47]}])
        ok('a claim takes the band away', r.until(s, BAND + '===""', 4) is True)
        s2 = screen(r, '/app/raffle/screen')
        says(r, s2, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'ticket', 'drawSecs': 6}, {'t': 'pick', 'numbers': [47]}])
        time.sleep(8.8)
        says(r, s2, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [47], 'pad': 3, 'allowRedraw': True, 'time': 60}])
        time.sleep(3.2)
        ok('SWITCHED OFF: no cd on the messages = the stage\'s own claim clock, and no overlay', 'Claim within 0:' in (r.ask(s2, STAGE_TEXT) or '') and r.ask(s2, 'document.querySelectorAll(".vpdc").length') == 0, r.ask(s2, STAGE_TEXT))
        ok('SILENT through the countdown, the draw and the claim clock, and no page errors', aud[0] == 0 and not (aud[1] or []), aud)
    finally:
        r.close()

if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('tv-draw-moments-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    only = sys.argv[1:]
    def part(n, f, *a):
        if not only or n in only: f(*a)
    part('winner', big_winner, 1280, 720, 'Hollis,Kate', 1, ['KATEHOLLIS'])
    part('winner2', big_winner, 1920, 1080, 'Whitfield,Alexandra', 2, ['ALEXANDRA', 'WHITFIELD'])
    part('clock', clock_only)
    part('off', off_as_before)
    part('members', countdown_members)
    part('raffle', countdown_raffle)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
