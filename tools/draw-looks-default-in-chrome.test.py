#!/usr/bin/env python3
"""EVERY VENUE ON THE NEW DRAW LOOKS, PLAYED IN CHROME (Dean, 12 Nov 2026, INBOX 284; FINDINGS R4/R5/D5).

The Mini Bar's "Usual" was the OLD draw (the '' that "As now" saved), so Dean saw the old raffle and members draw on the
TV after the release. On the rig (tools/browser-rig/rig.py: the REAL game Worker in jsc with a fake database, the shipped
consoles and the venue's own /tv in headless Chrome), with the venue's saved settings seeded as the live venues have them:

  1. RAFFLE, NOTHING SAVED: the console's usual look is Ticket roll (no "As now" chip anywhere), "Usual" for this draw;
     a draw puts the TICKET ROLL on the TV (the new stage, a ticket), never the old drawing card
  2. RAFFLE, '' SAVED (the old "As now", The Mini Bar's case): the same, the ticket roll
  3. RAFFLE, 'race' SAVED: the venue's race plate is kept, and the TV draws the race plate
  4. MEMBERS DRAW, '' SAVED: the console's usual look is Flip board, no "As now"; a draw puts the FLIP BOARD on the TV
  5. no page threw anything

Set VP_SHOTS=<folder> to keep screenshots.

    python3 tools/draw-looks-default-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
R = None


def stand_up(game, prefs, host_page):
    """A fresh rig with the venue's saved settings for one game seeded as they are live (None = no settings row)."""
    global R
    if R: R.close()
    R = rig.Rig(host_pages=(host_page,))
    W = R.W
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': game, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    if prefs is not None:
        W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'game_prefs': prefs}], replace=True)
    return W


def table(W, name):
    """The Worker's fake database, read back (worker-stdio.js answers {table})."""
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def shot(sid, name):
    if SHOTS: time.sleep(0.5); R.shot(sid, os.path.join(SHOTS, name))
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')
# The TV is the venue's own /tv; the game screen is in its game frame.
def F(expr):
    return ('(function(){var f=document.getElementById("gameFrame"); var d=f && f.style.display!=="none" && f.contentDocument;'
            ' if(!d || !d.body) return ""; return (%s);})()' % expr)
STAGE = F('(function(){var s=d.querySelector(".vpds-stage"); if(!s) return "none";'
          ' return d.querySelector(".vpds-tk") ? "ticket" : d.querySelector(".vpds-board") ? "flip" : d.querySelector(".vpds-plate") ? "race" : "stage";})()')
CHIPS = ('(function(sel){return [].map.call(document.querySelectorAll(sel+" button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent.trim();}).join("|");})')
def chips(sid, sel): return js(sid, CHIPS + '(%s)' % json.dumps(sel))
ACCEPT = ('var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); true')


def tv_on(tv, screen):
    """wait until the TV's game frame shows this game's screen, loaded, before a draw (a TV that joins late only shows the result)"""
    got = R.until(tv, '(function(){var f=document.getElementById("gameFrame"); return !!f && f.style.display!=="none" && /%s/.test(f.src)'
                      ' && !!f.contentDocument && f.contentDocument.readyState==="complete" && !!f.contentWindow.VPDrawStyle;})()' % screen, 40) is True
    time.sleep(1.5)
    return got


def draw(host):
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(12):
        if js(host, 'document.getElementById("drawBtn").disabled || document.getElementById("winnerCard").classList.contains("show")') is True: break
        js(host, ACCEPT); time.sleep(1)


def raffle(label, prefs, want, want_chip):
    print('\nRAFFLE, %s' % label)
    W = stand_up('raffle', prefs, '/app/raffle/host.html')
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': None, 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
    W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    htid, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    ok('%s: the raffle console loads' % label, R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True,
       js(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    ok('%s: the usual look is %s, and there is no "As now"' % (label, want_chip),
       R.until(host, CHIPS + '("#styleChips")===%s' % json.dumps('*Ticket roll|Race plate' if want == 'ticket' else 'Ticket roll|*Race plate'), 15) is True,
       chips(host, '#styleChips'))
    ok('%s: this draw is on "Usual", and no one-draw "As now"' % label, chips(host, '#onceChips') == '*Usual|Ticket roll|Race plate', chips(host, '#onceChips'))
    ok('%s: the draw time chips show' % label, js(host, '!document.getElementById("timeField").classList.contains("hidden")') is True)
    js(host, 'document.querySelector("#prizePresets button").click(); true')
    R.until(host, '/Meat tray/.test(document.getElementById("prizeList").textContent)', 10)
    # 12 Nov 2026 (INBOX 286, fix/tv-takeover-12nov): opening a console no longer takes the TV; the host puts the draw
    # on it with the TV line's button, as tools/multi-raffle-in-chrome.test.py does
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('%s: the TV has the raffle screen up before the draw' % label, tv_on(tv, 'raffle\\/screen'), js(tv, 'document.getElementById("gameFrame").src'))
    draw(host)
    ok('%s: the TV draws the %s' % (label, {'ticket': 'ticket roll', 'race': 'race plate'}[want]),
       R.until(tv, STAGE + '===%s' % json.dumps(want), 30) is True, js(tv, STAGE) + ' | ' + str(js(host, '(document.getElementById("hostErrText")||{}).textContent||""')))
    ok('%s: the old drawing card is not what the room sees' % label,
       js(tv, F('(function(){var o=d.getElementById("tvStyle"); return !!o && getComputedStyle(o).display!=="none";})()')) is True,
       js(tv, F('d.body.className')))
    shot(tv, 'raffle-%s.jpg' % want)
    ok('%s: no page threw anything' % label, errs(host) in ('[]', None) and errs(tv) in ('[]', None), (errs(host), errs(tv)))


def members(label, prefs):
    print('\nMEMBERS DRAW, %s' % label)
    W = stand_up('members', prefs, '/app/members/host.html')
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 10000}, {})['body']
    did = (made.get('draw') or {}).get('id')
    imp = W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': 'Member %d' % i} for i in range(12)]}, {})['body']
    ok('%s: a draw with 12 members is set up through the real Worker' % label, bool(did) and imp.get('added') == 12, (made, imp))
    for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'):   # the console reads these from the page's own database
        R.db[t] = table(W, t)
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    htid, host = R.open('/app/members/host.html', width=1000, height=1100)
    ok('%s: the members console loads' % label, R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True,
       js(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    ok('%s: the usual look is Flip board, and there is no "As now"' % label, R.until(host, CHIPS + '("#styleChips")==="*Flip board|Race plate"', 15) is True, chips(host, '#styleChips'))
    ok('%s: this draw is on "Usual", and no one-draw "As now"' % label, chips(host, '#onceChips') == '*Usual|Flip board|Race plate', chips(host, '#onceChips'))
    # 12 Nov 2026 (INBOX 286, fix/tv-takeover-12nov): opening a console no longer takes the TV; the host puts the draw
    # on it with the TV line's button, as tools/multi-raffle-in-chrome.test.py does
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('%s: the TV has the members screen up before the draw' % label, tv_on(tv, 'members\\/screen'), js(tv, 'document.getElementById("gameFrame").src'))
    dbg = js(host, 'JSON.stringify(typeof G!=="undefined" ? {m:G.members.length, s:(G.members[0]||{}).status, mr:(G.members[0]||{}).roster_id, d:G.draws.map(function(x){return x.roster_id;})} : "noG")')
    dbg = str(dbg) + ' db:' + json.dumps({t: len(R.db.get(t) or []) for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members')}) + ' ' + json.dumps((R.db.get('vp_member_rosters') or [None])[0])
    draw(host)
    got = R.until(tv, STAGE + '==="flip"', 30) is True
    if not got:
        dbg += ' | TV:' + str(js(tv, '(function(){var f=document.getElementById("gameFrame"); return (f?f.src+" "+f.style.display:"noframe")+" "+document.body.innerText.replace(/\\s+/g," ").slice(0,120);})()'))
        dbg += ' | HOST:' + str(js(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,400)'))
        print('  debug ' + dbg[-900:])
    ok('%s: the TV draws the flip board' % label, got,
       js(tv, STAGE) + ' | ' + str(js(host, '(document.getElementById("hostErrText")||document.getElementById("drawNote")||{}).textContent||""')) + ' | ' + dbg)
    shot(tv, 'members-flip.jpg')
    ok('%s: no page threw anything' % label, errs(host) in ('[]', None) and errs(tv) in ('[]', None), (errs(host), errs(tv)))


try:
    raffle('nothing saved', None, 'ticket', 'Ticket roll')
    raffle('"" saved (the old As now)', {'raffle': {'draw_style': '', 'draw_time': 'short'}}, 'ticket', 'Ticket roll')
    raffle('race plate saved', {'raffle': {'draw_style': 'race'}}, 'race', 'Race plate')
    members('"" saved (the old As now)', {'members': {'draw_style': '', 'draw_time': 'normal'}})
finally:
    if R: R.close()

print('\n' + ('FAILED %d of %d' % (bad, ran) if bad else 'ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
