#!/usr/bin/env python3
"""MUSICAL BINGO "ANY LINE", AS CHROME PAINTS IT (Dean, 11 Nov 2026, INBOX 256).

On The Mini Bar Dean finished the right-hand COLUMN on "One line across" and expected a win; "One line" is rows only.
"Any line" (a full row, column or diagonal) is now a pattern, the default for new venues. The phone calls it "Any line";
the host console and the TV "Any line (across, down or diagonal)". And 256.2: a fully ticked 2nd row looked faint.

This opens the REAL app/musical/play.html and app/musical/screen.html from this checkout, through the stand-in game
Worker and fake Realtime of tools/musical-newlook-in-chrome.test.py (imported), at 375x812, and taps squares as a
player would:
  - Any line: the right-hand column tapped: "I've got a line" goes from faint to BRIGHT on the last tap; the card says
    "Any line"; the claim is sent ("Sent. The host is checking your card")
  - Any line: the 2nd row on a card whose centre is a REAL song (not Free): bright
  - One line across: the right-hand column stays faint (rows only, unchanged for existing venues); the 2nd row on the
    real-song-centre card is bright
  - the TV: "Any line (across, down or diagonal)" for the pattern, and "Any line wins a Meat tray"
Takes /tmp/vp-heavy.lock (VP_WAIT_LOCK seconds to wait).

    python3 tools/any-line-in-chrome.test.py
"""
import importlib.util, http.server, json, os, sys, threading, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'tools'))
_spec = importlib.util.spec_from_file_location('musical_newlook', os.path.join(HERE, 'tools', 'musical-newlook-in-chrome.test.py'))
MN = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MN)
CELLS, ROOM, Page, say = MN.CELLS, MN.ROOM, MN.Page, MN.say

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


PROBE = r"""(function(){
  var b=document.getElementById("bingoBtn"), cs=getComputedStyle(b);
  return JSON.stringify({ faint:b.classList.contains("faint"), disabled:!!b.disabled, text:b.textContent, bg:cs.backgroundColor,
    pat:(document.getElementById("cardPat")||{}).textContent||"", hdr:(document.getElementById("hdrPat")||{}).textContent||"",
    msg:(document.getElementById("cardMsg")||document.getElementById("msg")||{}).textContent||"",
    cells:[].map.call(document.querySelectorAll("#cardGrid .cc"), function(c){ return c.getAttribute("aria-label")||c.textContent; }) });
})()"""
TAP = '(function(){ var c=document.querySelector("#cardGrid .cc[data-i=\\"%d\\"]"); if(c) c.click(); return !!c; })()'
REAL_CENTRE = list(CELLS); REAL_CENTRE[12] = 'Centre Song'
RIGHT_COL, ROW2 = [4, 9, 14, 19, 24], [5, 6, 7, 8, 9]


def phone(B, base, cells, wpat, upat):
    CELLS[:] = cells
    MN.W['pattern'] = wpat
    P = Page(B, base, '/app/musical/play.html?sting=0&room=' + ROOM, 375, 812, True, 'try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}')
    P.until('document.getElementById("vJoin") && !document.getElementById("vJoin").classList.contains("hidden")', 20); time.sleep(0.6)
    P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': upat, 'prize': 'Meat tray', 'played': []}])); time.sleep(0.3)
    P.js('(function(){ document.getElementById("nameIn").value="Sam"; document.getElementById("joinBtn").click(); return 1; })()')
    P.until('!document.getElementById("vWait").classList.contains("hidden")', 15); time.sleep(0.3)
    P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': upat, 'prize': 'Meat tray', 'game_id': 'g1'}]))
    P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15); time.sleep(0.8)
    return P


def play(P, cells, idx):
    """The host plays these squares' songs (so the claim is real), then the player taps all but the last."""
    titles = [cells[i] for i in idx if i != 12]
    P.js(say('vp-' + ROOM, [{'t': 'state', 'active': True, 'pattern': None, 'played': titles, 'played_ids': [MN.sid(t) for t in titles]}]))
    time.sleep(0.4)


def run(B, base):
    keep = list(CELLS)
    try:
        print('\nANY LINE: the right-hand COLUMN (Dean\'s card on The Mini Bar)')
        P = phone(B, base, keep, 'any_line', 'any')
        try:
            x = P.obj(PROBE) or {}
            ok('the card names the pattern "Any line" (the phone\'s short name)', x.get('pat') == 'Any line', x.get('pat'))
            ok('the claim button says "I\'ve got a line", faint before anything is marked', x.get('text') == "I've got a line" and x.get('faint'), [x.get('text'), x.get('faint')])
            play(P, keep, RIGHT_COL)
            for i in RIGHT_COL[:-1]: P.js(TAP % i)
            time.sleep(0.2)
            x = P.obj(PROBE) or {}
            ok('four of the column tapped: still faint', x.get('faint') is True, x)
            P.js(TAP % RIGHT_COL[-1]); time.sleep(0.3)
            x = P.obj(PROBE) or {}
            ok('the fifth tapped: the column is done and "I\'ve got a line" is BRIGHT', x.get('faint') is False and not x.get('disabled'), x)
            ok('bright means the full pink (not the faint 32%)', x.get('bg') not in ('rgba(255, 31, 142, 0.32)',), x.get('bg'))
            P.js('document.getElementById("bingoBtn").click()'); time.sleep(0.8)
            sent = P.js('document.body.innerText.indexOf("Sent. The host is checking your card")>=0 || document.body.innerText.indexOf("YOU WON")>=0 || document.body.innerText.toLowerCase().indexOf("you won")>=0')
            ok('tapped: the claim is SENT (the phone\'s own check agrees with the Worker\'s)', bool(sent), P.js('document.body.innerText.slice(0,400)'))
        finally:
            P.close()

        print('\nANY LINE: the 2nd ROW, on a card whose centre is a real song')
        P = phone(B, base, REAL_CENTRE, 'any_line', 'any')
        try:
            play(P, REAL_CENTRE, ROW2)
            for i in ROW2: P.js(TAP % i)
            time.sleep(0.3)
            x = P.obj(PROBE) or {}
            ok('the 2nd row tapped: BRIGHT', x.get('faint') is False, x)
        finally:
            P.close()

        print('\nONE LINE ACROSS (existing venues): rows only, and the 2nd row bright (256.2)')
        P = phone(B, base, REAL_CENTRE, 'one_line', 'one')
        try:
            x = P.obj(PROBE) or {}
            ok('the card says "One line across"', x.get('pat') == 'One line across', x.get('pat'))
            play(P, REAL_CENTRE, RIGHT_COL + ROW2)
            for i in RIGHT_COL: P.js(TAP % i)
            time.sleep(0.3)
            x = P.obj(PROBE) or {}
            ok('the right-hand column tapped: still FAINT (a column is not a line across)', x.get('faint') is True, x)
            for i in ROW2:
                if i not in RIGHT_COL: P.js(TAP % i)   # square 9 is in both and already marked: a second tap would unmark it
            time.sleep(0.3)
            x = P.obj(PROBE) or {}
            ok('the 2nd row tapped as well: BRIGHT (a fully ticked 2nd row is never faint)', x.get('faint') is False and not x.get('disabled'), x)
        finally:
            P.close()
    finally:
        CELLS[:] = keep
        MN.W['pattern'] = 'one_line'

    print('\nTHE TV: the pattern said in full')
    MN.W['logo'] = '/logos/venue-tugun-bowls.png'; MN.W['name'] = 'Tugun Bowls Club'
    slug = 'tugun-bowls-club'
    chan = 'vp-' + MN.venue_code('musical-' + slug)
    T = Page(B, base, '/app/musical/screen.html?sting=0&venue=' + slug, 1920, 1080, False, 'try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}')
    try:
        T.until('document.getElementById("tvLobby") && window.VPTvGame', 20); time.sleep(1.5)
        T.js(say(chan, [{'t': 'host_here'}, {'t': 'state', 'lobby': True, 'active': False, 'pattern': 'any', 'prize': 'Meat tray', 'played': []}]))
        time.sleep(0.6)
        T.js(say(chan, [{'t': 'started', 'pattern': 'any', 'prize': 'Meat tray', 'played': []}])); time.sleep(0.6)
        T.js(say(chan, [{'t': 'played', 'title': 'Africa', 'artist': 'Toto', 'artworkUrl': '/__fixture/art-336699.svg', 'played': ['Africa'], 'reveal': 'instant', 'replay': True}]))
        time.sleep(1.2)
        pat = T.js('(document.getElementById("tvPattern")||{}).textContent||""')
        wins = T.js('(document.getElementById("tvWins")||{}).textContent||""')
        ok('the TV names it "Any line (across, down or diagonal)"', pat == 'Any line (across, down or diagonal)', pat)
        ok('the TV\'s sentence: "Any line wins a Meat tray"', wins == 'Any line wins a Meat tray', wins)
    finally:
        T.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('any-line-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), MN.Site)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = MN.VL.Browser()
    try:
        run(B, base)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
