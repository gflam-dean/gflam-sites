#!/usr/bin/env python3
"""THE DRAW MOMENTS IN THE REAL CONSOLES, PLAYED IN CHROME (13 Nov 2026, INBOX 285 option 2 and 299b option 3).

On the rig (tools/browser-rig/rig.py: the REAL game Worker in jsc with a fake database, the shipped consoles and the venue's own /tv in
headless Chrome). Both settings are OFF for every venue until a host switches them on:

  1. MEMBERS CONSOLE, NOTHING SAVED (every venue today): "Winner takes the screen" and "Countdown before the draw" both Off, the countdown
     control above the Draw button is hidden, and opening the console saves nothing for either
  2. SWITCHING ON: the chips turn On, the control appears, and the choice is saved in the venue's game_prefs JSON (draw_winner_big,
     draw_countdown; no column, no migration); switching off hides the control again
  3. SAVED ON: a venue that saved both opens with both On
  4. A COUNTDOWN FROM THE CONSOLE: 1 minute puts "Draw in" on the TV's members wall (the TV is taken by the tap, never by page load);
     Cancel takes it away again and the TV goes back
  5. RAFFLE CONSOLE: the same switch (countdown only), Off by default, saved as draw_countdown, hidden control until On
  6. no page threw anything

    python3 tools/draw-moments-console-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import rig  # noqa: E402
import gatelib  # noqa: E402

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
    global R
    if R: R.close()
    R = rig.Rig(host_pages=(host_page,))
    W = R.W
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': game, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    if prefs is not None:
        W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'game_prefs': prefs}], replace=True)
    return W
def table(W, name):
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')
CHIPS = ('(function(sel){return [].map.call(document.querySelectorAll(sel+" button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent.trim();}).join("|");})')
def chips(sid, sel): return js(sid, CHIPS + '(%s)' % json.dumps(sel))
def hidden(sid, i): return js(sid, 'document.getElementById(%s).classList.contains("hidden")' % json.dumps(i))
def F(expr):
    return ('(function(){var f=document.getElementById("gameFrame"); var d=f && f.style.display!=="none" && f.contentDocument;'
            ' if(!d || !d.body) return ""; return (%s);})()' % expr)
BAND = F('(function(){var b=d.querySelector(".vpdc-band"),t=d.querySelector(".vpdc-txt");return b&&parseFloat(d.defaultView.getComputedStyle(b).opacity)>0.5?t.textContent.replace(/\\s+/g," ").trim():"";})()')
def prefs_of(W, game):
    rows = table(W, 'vp_venue_settings') or []
    for r in rows:
        if r.get('venue_id') == W.info['venue']: return ((r.get('game_prefs') or {}).get(game)) or {}
    return {}
def tv_on(tv, screen):
    got = R.until(tv, '(function(){var f=document.getElementById("gameFrame"); return !!f && f.style.display!=="none" && /%s/.test(f.src)'
                      ' && !!f.contentDocument && f.contentDocument.readyState==="complete" && !!f.contentWindow.VPDrawCount;})()' % screen, 40) is True
    time.sleep(1.5)
    return got

def members(label, prefs, want_wb, want_cd):
    print('\nMEMBERS CONSOLE, %s' % label)
    W = stand_up('members', prefs, '/app/members/host.html')
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 10000}, {})['body']
    did = (made.get('draw') or {}).get('id')
    W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': 'Member %d' % i} for i in range(12)]}, {})
    for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'):
        R.db[t] = table(W, t)
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    htid, host = R.open('/app/members/host.html', width=1000, height=1100)
    ok('%s: the console loads' % label, R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True)
    want = lambda on: ('Off|*On' if on else '*Off|On')
    ok('%s: Winner takes the screen is %s' % (label, 'On' if want_wb else 'Off'), R.until(host, CHIPS + '("#winBigChips")===%s' % json.dumps(want(want_wb)), 15) is True, chips(host, '#winBigChips'))
    ok('%s: Countdown before the draw is %s' % (label, 'On' if want_cd else 'Off'), R.until(host, CHIPS + '("#cdChips")===%s' % json.dumps(want(want_cd)), 15) is True, chips(host, '#cdChips'))
    ok('%s: the countdown control above the Draw button is %s' % (label, 'there' if want_cd else 'hidden'), hidden(host, 'cdCtl') is (not want_cd), hidden(host, 'cdCtl'))
    return W, tv, host

def part_members():
    W, tv, host = members('NOTHING SAVED', None, False, False)
    time.sleep(3)
    p = prefs_of(W, 'members')
    ok('nothing saved: opening the console saves neither setting', 'draw_winner_big' not in p and 'draw_countdown' not in p, p)
    js(host, 'document.querySelector("#cdChips button[data-cdon=on]").click(); true')
    ok('switching the countdown On shows the control', R.until(host, '!document.getElementById("cdCtl").classList.contains("hidden")', 5) is True)
    ok('the chips say On', chips(host, '#cdChips') == 'Off|*On', chips(host, '#cdChips'))
    time.sleep(3.5)
    p = prefs_of(W, 'members')
    ok('it is saved in the venue\'s game_prefs JSON as true (and the other as false)', p.get('draw_countdown') is True and p.get('draw_winner_big') is False, p)
    js(host, 'document.querySelector("#winBigChips button[data-wb=on]").click(); true'); time.sleep(3.5)
    ok('Winner takes the screen On is saved too', prefs_of(W, 'members').get('draw_winner_big') is True, prefs_of(W, 'members'))
    # a countdown from the console (the TV is taken by the tap)
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30)
    ok('before the tap the TV is not on the members screen', not tv_on_quick(tv))
    js(host, 'document.querySelector("#cdMins button[data-cdm=\\"60\\"]").click(); true')
    ok('the TV is taken and shows Draw in on the members wall', R.until(tv, F('(function(){var t=d.querySelector(".vpdc-txt");return !!t && /^Draw in 0:[0-5][0-9]|^Draw in 1:00/.test(t.textContent.replace(/\\s+/g," ").trim());})()') + '===true', 60) is True,
       [js(tv, BAND), js(host, 'document.getElementById("cdState").textContent'), js(host, '(document.getElementById("hostErrText")||{}).textContent||""')])
    ok('the console says it is drawing in and offers Cancel', 'Drawing in' in (js(host, 'document.getElementById("cdState").textContent') or '') and hidden(host, 'cdCancel') is False)
    if SHOTS: time.sleep(0.5); R.shot(tv, os.path.join(SHOTS, 'console-members-count-tv.jpg')); R.shot(host, os.path.join(SHOTS, 'console-members-count-host.jpg'))
    js(host, 'document.getElementById("cdCancel").click(); true')
    ok('Cancel takes the band off the TV', R.until(tv, BAND + '===""', 15) is True, js(tv, BAND))
    ok('and the console offers the minutes again', hidden(host, 'cdCancel') is True and hidden(host, 'cdMins') is False)
    js(host, 'document.querySelector("#cdChips button[data-cdon=off]").click(); true')
    ok('switching it off hides the control again', R.until(host, 'document.getElementById("cdCtl").classList.contains("hidden")', 5) is True)
    ok('no page threw anything', errs(host) in ('[]', None) and errs(tv) in ('[]', None), (errs(host), errs(tv)))
    members('SAVED ON', {'members': {'draw_winner_big': True, 'draw_countdown': True}}, True, True)

def tv_on_quick(tv):
    return js(tv, F('!!d.querySelector(".vpdc")')) is True

def part_raffle():
    print('\nRAFFLE CONSOLE')
    for label, prefs, want in (('NOTHING SAVED', None, False), ('SAVED ON', {'raffle': {'draw_countdown': True}}, True)):
        W = stand_up('raffle', prefs, '/app/raffle/host.html')
        ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        htid, host = R.open('/app/raffle/host.html', width=1000, height=1100)
        ok('%s: the raffle console loads' % label, R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True)
        ok('%s: Countdown before the draw is %s' % (label, 'On' if want else 'Off'), R.until(host, CHIPS + '("#cdChips")===%s' % json.dumps('Off|*On' if want else '*Off|On'), 15) is True, chips(host, '#cdChips'))
        ok('%s: the control is %s' % (label, 'there' if want else 'hidden'), hidden(host, 'cdCtl') is (not want), hidden(host, 'cdCtl'))
        if not want:
            time.sleep(3)
            ok('nothing saved: opening the console saves no countdown setting', 'draw_countdown' not in prefs_of(W, 'raffle'), prefs_of(W, 'raffle'))
            js(host, 'document.querySelector("#cdChips button[data-cdon=on]").click(); true')
            ok('switching On shows the control', R.until(host, '!document.getElementById("cdCtl").classList.contains("hidden")', 5) is True)
            time.sleep(3.5)
            ok('and saves draw_countdown true in the raffle prefs JSON', prefs_of(W, 'raffle').get('draw_countdown') is True, prefs_of(W, 'raffle'))
        ok('%s: no page threw anything' % label, errs(host) in ('[]', None), errs(host))

if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('draw-moments-console-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    try:
        part_members(); part_raffle()
    finally:
        if R: R.close()
    print('\n' + ('FAILED %d of %d' % (bad, ran) if bad else 'ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)
