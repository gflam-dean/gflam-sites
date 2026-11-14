#!/usr/bin/env python3
"""PAPER CARDS V2 IN THE MUSICAL CONSOLE: THE PLAYLIST LOCK AND THE SCAN BUTTON, AS CHROME PAINTS THEM (13 Nov 2026; INBOX 335).

The REAL app/musical/host.html on tools/browser-rig/rig.py (the real game Worker in jsc behind a pipe, signed in), at a tablet (1024x768)
and a phone (390x844):

  1  print 4 paper cards: the console hands the print window 4 cards that each carry a signed code and the printed date, with the
     playlist named; the lock bar appears ("Paper cards printed from X. Every musical game tonight plays X.") and the other playlists
     are greyed
  2  tap another playlist: a loud red warning ("You have 4 paper cards on the tables... can't win") with Keep this playlist and
     Switch and print new cards; Keep leaves the picked playlist alone
  3  Switch and print new cards: the print question opens, 3 cards print from the new playlist, the lock bar names the new one, and the
     old set is binned (a card from it scanned later is told to bin it)
  4  a game is started: tapping another playlist is now BLOCKED, in words, with no warning to swap
  5  Scan a paper card is on the console, opens the scanner screen (no camera in the test: it says so and offers the typed number); a code read
     by any other route is checked by the Worker: a tonight card with no songs played is "Not yet", a made-up code "isn't a venueplay card",
     a binned card "Bin them"
  6  every screen fits at both sizes, nothing sideways

VP_SHOTS=<dir> writes the frames.   python3 tools/paper-lock-in-chrome.test.py
"""
import json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    if not cond:
        bad += 1


MODAL_UP = '!document.getElementById("paperModal").classList.contains("hidden")'
LOCK_UP = '!document.getElementById("lockModal").classList.contains("hidden")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
STUB = ('VPPrint.open=function(){return {closed:false};}; window.__prints=[]; '
        'VPPrint.musical=function(w,cards,o){window.__prints.push({cards:cards,o:o}); return true;}; '
        'VPPrint.prepLogo=function(){return Promise.resolve(null);}; true')
FIT = r'''(function(){ var d=document.documentElement; function r(id){var e=document.getElementById(id); if(!e) return null; var b=e.getBoundingClientRect(); return {top:Math.round(b.top),w:Math.round(b.width),l:Math.round(b.left),h:Math.round(b.height),vis:b.width>0&&b.height>0&&getComputedStyle(e).display!=="none"};}
  return JSON.stringify({ sx:d.scrollWidth, vw:innerWidth, bar:r("paperLockBar"), lock:r("lockModal"), box:(function(){var m=document.querySelector("#lockModal .vp-modal-box"); if(!m) return null; var b=m.getBoundingClientRect(); return {l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top),b:Math.round(b.bottom),vw:innerWidth,vh:innerHeight};})(),
    scan:r("paperScanBtn"), barText:(document.getElementById("paperLockBar")||{}).textContent||"", locked:Array.prototype.filter.call(document.querySelectorAll("#plGrid .plcard"),function(c){return c.classList.contains("pplock");}).length,
    cardsN:document.querySelectorAll("#plGrid .plcard").length, on:(document.querySelector("#plGrid .plcard.on .nm")||{}).textContent||"" }); })()'''
OVER = r'''(function(){ var e=document.querySelector(".ppc"); if(!e) return null; var p=e.querySelector("#ppcPanel"); return JSON.stringify({ hidden:e.classList.contains("hidden"), text:e.innerText.replace(/\s+/g," "), fits:p.scrollHeight<=p.clientHeight+1, sx:document.documentElement.scrollWidth, vw:innerWidth }); })()'''


def scene(w, h, tag):
    print('\nTHE CONSOLE, %dx%d' % (w, h))
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        tid, s = r.open('/app/musical/host.html', width=w, height=h)
        ok('CONTROL: the console loads, signed in', r.until(s, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!window.VPPrint && !!window.VPPaperCheck', 40) is True)
        time.sleep(2)
        r.ask(s, STUB)
        r.ask(s, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(s, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: the lobby is open', r.until(s, LOBBY, 20) is True)
        ok('nothing printed yet: no lock bar, no playlist greyed', r.json(s, FIT, {}).get('bar', {}).get('vis') is False and r.json(s, FIT, {}).get('locked') == 0, r.json(s, FIT, {}))
        names = r.json(s, 'JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#plGrid .plcard .nm"),function(e){return e.textContent;}))', [])
        ok('CONTROL: there are playlists to choose from', len(names) >= 3, names)
        first = r.ask(s, '(document.querySelector("#plGrid .plcard.on .nm")||{}).textContent')
        # 1. print 4
        r.ask(s, 'document.getElementById("paperPrintBtn").click(); true')
        ok('CONTROL: Print paper cards asks how many', r.until(s, MODAL_UP, 8) is True)
        r.ask(s, 'document.getElementById("paperCount").value="4"; document.getElementById("paperGo").click(); true')
        got = r.until(s, 'window.__prints && window.__prints.length===1', 25)
        ok('1: the print window is handed the cards', got is True, r.ask(s, '(document.getElementById("hostErrText")||{}).textContent'))
        pr = r.json(s, 'JSON.stringify(window.__prints[0]||{})', {})
        cards = pr.get('cards') or []
        ok('1: 4 cards, each with a signed code at venueplay.com.au/c/ and 25 squares', len(cards) == 4 and all(re.match(r'^HTTPS://VENUEPLAY\.COM\.AU/C/[0-9A-Z]{21}$', c.get('code', '')) and len(c.get('titles', [])) == 25 for c in cards), [c.get('code') for c in cards])
        ok('1: the playlist is named and the printed date is sent', (pr.get('o') or {}).get('playlist') == first and re.match(r'^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$', (pr.get('o') or {}).get('printedLabel', '')), pr.get('o'))
        ok('1: no title that goes to the printer has a bracket in it', all(not re.search(r'[()\[\]]', t) for c in cards for t in c.get('titles', [])))
        r.until(s, '!document.getElementById("paperLockBar").classList.contains("hidden")', 10)
        f = r.json(s, FIT, {})
        ok('1: the lock bar says the cards are from this playlist and every musical game tonight plays it', ('Paper cards printed from ' + first) in f.get('barText', '') and ('Every musical game tonight plays ' + first) in f.get('barText', ''), f.get('barText'))
        ok('1: the lock bar is painted on the screen, in the picker', (f.get('bar') or {}).get('vis') is True and (f.get('bar') or {}).get('h', 0) > 20, f.get('bar'))
        ok('1: every other playlist is greyed', f.get('locked') == f.get('cardsN') - 1 and f.get('on') == first, f)
        r.ask(s, 'document.getElementById("paperLockBar").scrollIntoView({block:"center"}); true'); time.sleep(0.4)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'lock-bar-%s.jpg' % tag))
        # 2. pick another
        other = next(n for n in names if n != first)
        r.ask(s, 'Array.prototype.filter.call(document.querySelectorAll("#plGrid .plcard"),function(c){return c.querySelector(".nm").textContent===%s;})[0].click(); true' % json.dumps(other))
        ok('2: picking another playlist opens the red warning', r.until(s, LOCK_UP, 6) is True)
        body = r.ask(s, 'document.getElementById("lockBody").textContent') or ''
        ok('2: it says 4 paper cards, both playlists, and that they cannot win', '4 paper cards' in body and first in body and other in body and "can't win" in body, body)
        fm = r.json(s, FIT, {}).get('box') or {}
        ok('2: the warning fits the screen (not clipped, not sideways)', fm.get('l', -1) >= 0 and fm.get('r', 9999) <= fm.get('vw', 0) and fm.get('b', 9999) <= fm.get('vh', 0), fm)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'lock-warning-%s.jpg' % tag))
        r.ask(s, 'document.getElementById("lockKeep").click(); true'); time.sleep(0.3)
        ok('2: Keep this playlist closes it and leaves the printed playlist on', r.ask(s, LOCK_UP) is False and r.json(s, FIT, {}).get('on') == first)
        # 3. switch
        r.ask(s, 'Array.prototype.filter.call(document.querySelectorAll("#plGrid .plcard"),function(c){return c.querySelector(".nm").textContent===%s;})[0].click(); true' % json.dumps(other))
        r.until(s, LOCK_UP, 6)
        r.ask(s, 'document.getElementById("lockSwitch").click(); true')
        ok('3: Switch and print new cards opens the print question', r.until(s, MODAL_UP, 6) is True)
        r.ask(s, 'document.getElementById("paperCount").value="3"; document.getElementById("paperGo").click(); true')
        ok('3: 3 new cards print from the new playlist', r.until(s, 'window.__prints.length===2', 25) is True)
        pr2 = r.json(s, 'JSON.stringify(window.__prints[1]||{})', {})
        ok('3: the new cards name the new playlist and are a different set', (pr2.get('o') or {}).get('playlist') == other and len(pr2.get('cards') or []) == 3 and (pr2['cards'][0]['code'][:34] != cards[0]['code'][:34]), [(pr2.get('o') or {}).get('playlist'), (pr2.get('cards') or [{}])[0].get('code')])
        time.sleep(0.8)
        f = r.json(s, FIT, {})
        ok('3: the lock bar now names the new playlist', ('Paper cards printed from ' + other) in f.get('barText', ''), f.get('barText'))
        # 4. start a game off the new cards, then try to switch
        r.ask(s, 'document.getElementById("startBtn").click(); true')
        ok('4: the game starts', r.until(s, RUNNING, 30) is True, r.ask(s, '(document.getElementById("hostErrText")||{}).textContent'))
        time.sleep(1.5)
        # 5a. scan: the button and the screen (no camera in a test Chrome)
        r.ask(s, 'document.getElementById("paperScanBtn").scrollIntoView({block:"center"}); true'); time.sleep(0.4)
        ok('5: the Scan a paper card button is on the live console, big enough to tap', (r.json(s, FIT, {}).get('scan') or {}).get('vis') is True and (r.json(s, FIT, {}).get('scan') or {}).get('h', 0) >= 44, r.json(s, FIT, {}).get('scan'))
        sl = r.json(s, '(function(){var b=document.getElementById("paperScanBtn"),l=document.getElementById("paperScanLine");var br=b.getBoundingClientRect(),lr=l?l.getBoundingClientRect():null;return JSON.stringify({b:b.textContent.trim(),l:l?l.textContent.trim():"",below:!!lr&&lr.top>=br.bottom-0.5&&Math.abs(lr.left-br.left)<2,vis:!!lr&&lr.width>0,over:!!lr&&lr.right>innerWidth+0.5});})()', {})
        ok('5: the button says what it does: "Scan a paper card", with the line "This checks if the card is a winner." under it, inside the screen (INBOX 392 item 4)',
           sl.get('b') == 'Scan a paper card' and sl.get('l') == 'This checks if the card is a winner.' and sl.get('below') and sl.get('vis') and not sl.get('over'), sl)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'scan-button-%s.jpg' % tag))
        r.ask(s, 'document.getElementById("paperScanBtn").click(); true'); time.sleep(1.5)
        o = r.json(s, OVER, {})
        ok('5: Scan a paper card opens the scanner screen, and with no camera says so and offers the typed number', o.get('hidden') is False and ('Camera' in o.get('text', '') or 'camera' in o.get('text', '')) and 'Type its number' in o.get('text', ''), o)
        r.ask(s, 'VPPaperCheck.close(); true')
        # 5b. scans through the Worker: tonight, binned, made up
        new1 = pr2['cards'][0]['code']; old1 = cards[0]['code']
        for code, want, label in ((new1, 'Not yet', 'a tonight card with no songs played'), (old1, 'Bin them', 'a card from the binned set'), ('HTTPS://VENUEPLAY.COM.AU/C/1ABCDEF01PC4FZZZZZZZZ', "This isn't a venueplay card", 'a made-up code')):
            r.ask(s, 'VPPaperCheck.check(%s); true' % json.dumps(code))
            r.until(s, '(function(){var e=document.querySelector(".ppc .badge"); return !!e && e.textContent.indexOf("Checking")<0;})()', 12)
            o = r.json(s, OVER, {})
            ok('5: %s says "%s"' % (label, want), want in o.get('text', ''), o.get('text'))
            ok('5: ...on one screen, nothing sideways', o.get('fits') is True and o.get('sx', 9999) <= o.get('vw', 0), o)
            if SHOTS and want == 'Bin them': r.shot(s, os.path.join(SHOTS, 'scan-bin-%s.jpg' % tag))
            r.ask(s, 'VPPaperCheck.close(); true')
        # 4. switch blocked
        r.ask(s, 'window.scrollTo(0,0); true')
        ok('4: with a game running the console is on its live screen (the picker is not shown), so no swap is offered', r.ask(s, RUNNING) is True)
        ok('no script errors on the console', r.ask(s, 'window.__errs.length') == 0, r.ask(s, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('paper-lock-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    for (w, h, tag) in ((1024, 768, 'tablet'), (390, 844, 'phone')):
        try:
            scene(w, h, tag)
        except Exception as e:
            ok('the scene ran to the end', False, repr(e))
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
