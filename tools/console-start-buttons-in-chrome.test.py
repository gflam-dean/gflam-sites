#!/usr/bin/env python3
"""THE START BUTTON IS ON THE SCREEN ON EVERY SET-UP AND LOBBY CONSOLE (Dean, 12 and 15 Nov 2026; INBOX 426 items 1 and 4).

Dean on live: "you have to scroll down to do anything. My one rule is to make everything easier." The Tuesday 17 Nov
real-night play found the button that starts the night under the settings on every console, so a host on a phone opened a
game and saw only settings: trivia Open lobby / Start round at 1,121 to 1,191 px on an 844 px screen, musical bingo at
1,811 px (under the whole playlist), raffle Draw the winner at 922 px, bingo Open lobby / Start calling numbers just under
a 667 px screen.

This opens each REAL host console on the browser rig (trivia, musical bingo, bingo, raffle; signed in, the real game Worker
in jsc), and at 375x667, 390x844 and a 1366x768 laptop, on the SET-UP screen and again once the LOBBY is open, checks:

  - the primary button (Open lobby, Start round, Start game, Start calling numbers, Draw the winner) is wholly inside the
    screen with the page not scrolled (its bottom edge is above the bottom of the window)
  - Close lobby (the other half of the lobby) is not pushed off the screen either, where the console has one
  - nothing runs off the side
  - the settings are still there to change: scrolling down (the page is not clipped) reaches the last setting on the console

and for trivia with nobody joined (INBOX 426 item 4): after Reveal leaderboard the pink button no longer says Reveal
leaderboard and does nothing; the host is offered End round on screen, and it works.

PNG screenshots of each state at each size go to $VP_SHOTS when it is set.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/console-start-buttons-in-chrome.test.py [trivia|musical|bingo|raffle|members ...]
"""
import base64, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SET = '5e75e75e-0000-4000-8000-000000000003'
SIZES = ((375, 667, True), (390, 844, True), (1366, 768, False))
R = None


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1


def js(sid, expr): return R.ask(sid, expr)


def tap(sid, el_id): js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(el_id))


TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'


def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break


# Where the primary button, Close lobby and the last setting are, in the host's window.
MEASURE = r'''(function(id, cancelId){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0 && b.height>0)) return null; return {top:Math.round(b.top), bottom:Math.round(b.bottom), left:Math.round(b.left), right:Math.round(b.right)}; }
  var b=document.getElementById(id), c=cancelId ? document.getElementById(cancelId) : null;
  var de=document.documentElement;
  return JSON.stringify({ h:window.innerHeight, w:window.innerWidth, sy:Math.round(window.scrollY||0), sw:de.scrollWidth, sh:Math.max(de.scrollHeight, document.body.scrollHeight),
    btn:R(b), text:b ? b.textContent.trim() : null, cancel:R(c), cancelText:c ? c.textContent.trim() : null });
})'''


def size(sid, w, h, mobile):
    R.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    js(sid, 'window.scrollTo(0,0); true')
    time.sleep(0.6)


def png(sid, name):
    if not SHOTS: return
    try:
        d = R.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        with open(os.path.join(SHOTS, name), 'wb') as f: f.write(base64.b64decode(d['data']))
    except Exception as e:
        print('  (screenshot %s not saved: %s)' % (name, e))


# The last visible piece of content on the page (not the bar, not a fixed header), and whether anything is painted over it.
LASTLEAF = r'''(function(){ var best=null, bb=-1; var all=document.querySelectorAll("body *");
  for(var i=0;i<all.length;i++){ var x=all[i]; if(x.closest(".vp-actionbar,.songscroll") || x.children.length) continue; var s=getComputedStyle(x), r=x.getBoundingClientRect();
    if(s.display==="none" || s.visibility==="hidden" || !(r.width>0 && r.height>0) || s.position==="fixed" || x.closest("header,.hidden,script,style")) continue;
    if(x.closest("details:not([open])") && !x.closest("summary")) continue;
    if(r.bottom>bb){ bb=r.bottom; best=x; } }
  if(!best) return JSON.stringify({none:1});
  var r=best.getBoundingClientRect();
  var top=document.elementFromPoint(Math.min(innerWidth-2, r.left+Math.min(10, r.width/2)), Math.min(innerHeight-1, Math.max(0, r.top+r.height/2)));
  return JSON.stringify({el:best.tagName+(best.id?"#"+best.id:""), h:innerHeight, top:Math.round(r.top), bottom:Math.round(r.bottom), covered: !(top && (top===best || best.contains(top))), barOver: !!(top && top.closest(".vp-actionbar")), by: top ? top.tagName+(top.id?"#"+top.id:"")+"."+String(top.className).slice(0,40)+" in "+(top.closest("[id]")||{}).id : null, txt: best.textContent.slice(0,40), sy:Math.round(scrollY)}); })()'''


def fits(sid, game, state, btn_id, want_re, cancel_id=None, want_cancel=False):
    """The one-screen checks for this console in this state, at all three sizes."""
    import re
    for (w, h, mobile) in SIZES:
        size(sid, w, h, mobile)
        m = R.json(sid, MEASURE + '(%s,%s)' % (json.dumps(btn_id), json.dumps(cancel_id)))
        tag = '%s %s at %dx%d' % (game, state, w, h)
        png(sid, '%s-%s-%dx%d.png' % (game, state, w, h))
        b = m.get('btn')
        ok(tag + ': nothing runs off the side', m['sw'] <= m['w'], m)
        ok(tag + ': the button "%s" reads as expected' % (m.get('text') or ''), bool(re.search(want_re, m.get('text') or '')), m)
        ok(tag + ': the button is wholly on screen with the page not scrolled (bottom %s of %d)' % (b and b['bottom'], m['h']),
           bool(b) and b['top'] >= 0 and b['bottom'] <= m['h'] and m['sy'] == 0, m)
        if want_cancel:
            c = m.get('cancel')
            ok(tag + ': Close lobby is still there to tap (below the button, one scroll away at most)', bool(c) and c['top'] >= b['bottom'] - 1, m)
        # the bar hides nothing: scrolled to the end, the last line of the set-up is on screen and is not under the bar
        js(sid, 'window.scrollTo(0, 99999); true'); time.sleep(0.3)
        e = R.json(sid, LASTLEAF)
        ok(tag + ': scrolled to the end, the last line of the console is on screen and the bar does not sit over it',
           'none' not in e and e['top'] >= 0 and e['bottom'] <= e['h'] and not e['covered'], e)
        js(sid, 'window.scrollTo(0,0); true')


def on_screen(sid, game, state, ids):
    """Each id in ids is wholly on screen, page not scrolled, at all three sizes (the End game / Draw fix: the primary action of
    the running console rides the action bar, and the button the host presses most still shows above it)."""
    for (w, h, mobile) in SIZES:
        size(sid, w, h, mobile)
        for (bid, want_re) in ids:
            import re
            m = R.json(sid, MEASURE + '(%s,%s)' % (json.dumps(bid), json.dumps(None)))
            b = m.get('btn')
            tag = '%s %s at %dx%d' % (game, state, w, h)
            if bid == ids[0][0]: png(sid, '%s-%s-%dx%d.png' % (game, state, w, h))
            ok(tag + ': %s reads "%s"' % (bid, m.get('text') or ''), bool(re.search(want_re, m.get('text') or '')), m)
            ok(tag + ': %s is wholly on screen with the page not scrolled (bottom %s of %d)' % (bid, b and b['bottom'], m['h']),
               bool(b) and b['top'] >= 0 and b['bottom'] <= m['h'] and m['sy'] == 0 and b['left'] >= 0 and b['right'] <= m['w'], m)
        ok(tag + ': nothing runs off the side', m['sw'] <= m['w'], m)
        js(sid, 'window.scrollTo(0, 99999); true'); time.sleep(0.3)
        e = R.json(sid, LASTLEAF)
        ok(tag + ': scrolled to the end, the last line is on screen and the bar does not sit over it', 'none' not in e and e['top'] >= 0 and e['bottom'] <= e['h'] and not e['barOver'], e)
        js(sid, 'window.scrollTo(0,0); true')
    size(sid, 390, 844, True)


# The last piece of content on each console's set-up, used to prove the page still reaches the end.
END_OF_PAGE = {'trivia': '#setupBlock > p.note', 'musical': '#startNote', 'bingo': '#downloadRecordBtn', 'raffle': '.folds > :last-child'}


def new_rig(pages):
    import rig
    r = rig.Rig(host_pages=pages)
    r.srv.handle_error = lambda request, client_address: None
    return r


def seed(W):
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [
        {'id': 'q-1', 'set_id': SET, 'seq': 1, 'question': 'Which colour?', 'text': 'Which colour?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2},
        {'id': 'q-2', 'set_id': SET, 'seq': 2, 'question': 'Which animal?', 'text': 'Which animal?', 'options': ['Cat', 'Dog', 'Emu', 'Roo'], 'correct_index': 3}])
    for fmt in ('bingo', 'trivia', 'musical', 'members', 'raffle'):
        W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': fmt, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)


def lobby_open(sid):
    return R.until(sid, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none" && e.offsetParent!==null;})()', 25) is True


def run_trivia():
    global R
    print('\nTRIVIA')
    R = new_rig(('/app/trivia/host.html',))
    try:
        W = R.W; seed(W)
        t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        t2, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=390, height=844)
        ok('trivia: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, js(host, ERRT))
        time.sleep(2)
        js(host, 'document.getElementById("cfgCount").value="2"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true')
        fits(host, 'trivia', 'setup', 'startBtn', r'^Open lobby$', 'cancelLobbyBtn', False)
        size(host, 390, 844, True)
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('trivia: the lobby opens', lobby_open(host), js(host, ERRT))
        fits(host, 'trivia', 'lobby', 'startBtn', r'^Start round$', 'cancelLobbyBtn', True)

        # INBOX 426 item 4: nobody joined, Reveal leaderboard
        size(host, 390, 844, True)
        tap(host, 'startBtn'); time.sleep(1)
        for _ in range(3):
            if js(host, ASKGO): time.sleep(1)
        BTNS = 'JSON.stringify([].map.call(document.querySelectorAll("#runBody button"),function(x){return x.textContent.trim()+"@"+Math.round(x.getBoundingClientRect().top);}))'
        BTN = lambda t: '!![].filter.call(document.querySelectorAll("#runBody button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)
        CLICK = lambda t: js(host, '(function(){ var b=[].filter.call(document.querySelectorAll("#runBody button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(t))
        def REVEAL():   # with auto reveal on, the first tap during the clock only arms it ("Tap again to reveal now")
            for _ in range(2):
                js(host, '(function(){ var b=document.getElementById("revealBtn"); if(b) b.click(); return !!b; })()'); time.sleep(0.8)
        ok('trivia: the round starts', R.until(host, BTN('First question'), 30) is True, js(host, ERRT))
        CLICK('First question')
        ok('trivia: question 1 is up', R.until(host, BTN('Reveal answer'), 30) is True, js(host, ERRT))
        REVEAL()
        ok('trivia: question 1 revealed', R.until(host, BTN('Next question'), 25) is True, js(host, BTNS))
        CLICK('Next question')
        ok('trivia: question 2 is up', R.until(host, BTN('Reveal answer'), 30) is True, js(host, ERRT))
        REVEAL()
        ok('trivia: after the last question the console offers Reveal leaderboard', R.until(host, BTN('Reveal leaderboard'), 25) is True, js(host, BTNS))
        for (w, h, mobile) in SIZES:
            size(host, w, h, mobile)
            m = R.json(host, MEASURE + '(%s,%s)' % (json.dumps('x'), json.dumps(None)))
            r = R.json(host, '(function(){ var b=[].filter.call(document.querySelectorAll("#runBody button"),function(x){ return x.textContent.trim()==="Reveal leaderboard" && x.getBoundingClientRect().height>0; })[0];'
                             'var q=b ? b.getBoundingClientRect() : null; return JSON.stringify({top:q && Math.round(q.top), bottom:q && Math.round(q.bottom)}); })()')
            png(host, 'trivia-reveal-leaderboard-%dx%d.png' % (w, h))
            ok('trivia Reveal leaderboard at %dx%d: wholly on screen with the page not scrolled (bottom %s of %d)' % (w, h, r.get('bottom'), m['h']),
               r.get('bottom') is not None and r['top'] >= 0 and r['bottom'] <= m['h'] and m['sy'] == 0, [r, m])
        size(host, 390, 844, True)
        CLICK('Reveal leaderboard')
        time.sleep(2.5)
        txt = js(host, 'document.body.innerText.replace(/\\s+/g," ")')
        ok('trivia with nobody joined: the console says so', 'Nobody has joined this game yet' in (txt or ''), (txt or '')[:300])
        after = R.json(host, '(function(){ return JSON.stringify([].filter.call(document.querySelectorAll("#runBody button"),function(x){ return x.getBoundingClientRect().height>0; }).map(function(x){ var r=x.getBoundingClientRect(); return [x.textContent.trim(), x.className, Math.round(r.top), Math.round(r.bottom)]; })); })()')
        names = [a[0] for a in after]
        png(host, 'trivia-nobody-after-reveal-390x844.png')
        ok('trivia with nobody joined: the pink button is no longer "Reveal leaderboard" (it did nothing)', 'Reveal leaderboard' not in names, after)
        ok('trivia with nobody joined: the host is offered Start a new round, wholly on screen', any(a[0] == 'Start a new round' and a[2] >= 0 and a[3] <= 844 for a in after), after)
        CLICK('Start a new round')
        ok('trivia with nobody joined: Start a new round works (the console is back on set-up, Open lobby offered)',
           R.until(host, '(function(b){ return !!b && b.getBoundingClientRect().height>0 && b.textContent.trim()==="Open lobby"; })(document.getElementById("startBtn"))', 20) is True, js(host, ERRT))
        ok('trivia: no script errors on the console', js(host, 'window.__errs.length') == 0, js(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


def run_musical():
    global R
    print('\nMUSICAL BINGO')
    R = new_rig(('/app/musical/host.html',))
    try:
        W = R.W; seed(W)
        t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        t2, host = R.open('/app/musical/host.html', width=390, height=844)
        ok('musical: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard.on")', 60) is True, js(host, ERRT))
        time.sleep(2)
        fits(host, 'musical', 'setup', 'startBtn', r'^Open lobby$', 'cancelLobbyBtn', False)
        size(host, 390, 844, True)
        js(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('musical: the lobby opens', lobby_open(host), js(host, ERRT))
        fits(host, 'musical', 'lobby', 'startBtn', r'^Start game$', 'cancelLobbyBtn', True)
        size(host, 390, 844, True)
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('musical: a game is running', R.until(host, '!document.getElementById("liveBlock").classList.contains("hidden")', 25) is True, js(host, ERRT))
        R.until(host, '(function(b){ return !!b && !b.disabled; })(document.getElementById("playNextBtn"))', 20)
        tap(host, 'playNextBtn'); time.sleep(1.5)
        ok('musical: a song is played', R.until(host, 'document.querySelectorAll("#playedStrip .pn").length>=1', 20) is True, js(host, ERRT))
        js(host, 'document.getElementById("hostErrX") && document.getElementById("hostErrX").click(); true')
        on_screen(host, 'musical', 'running', [('endGameBtn', r'^End game$'), ('playNextBtn', r'song|Play')])
        ok('musical: no script errors on the console', js(host, 'window.__errs.length') == 0, js(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


def run_bingo():
    global R
    print('\nBINGO')
    R = new_rig(('/app/index.html',))
    try:
        W = R.W; seed(W)
        t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        t2, host = R.open('/app/', width=390, height=844)
        ok('bingo: the console loads', R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 60) is True, js(host, ERRT))
        js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
        R.until(host, '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")', 15); time.sleep(2)
        js(host, ('var $=function(i){return document.getElementById(i)}; $("prizeInput").value="Meat tray"; $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change")); $("cardsSel").value="1"; true'))
        fits(host, 'bingo', 'setup', 'startBtn', r'^Open lobby$', 'cancelLobbyBtn', False)
        size(host, 390, 844, True)
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('bingo: the lobby opens', lobby_open(host), js(host, ERRT))
        fits(host, 'bingo', 'lobby', 'startBtn', r'^Start calling numbers$', 'cancelLobbyBtn', True)
        size(host, 390, 844, True)
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('bingo: Next number is offered', R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 30) is True, js(host, ERRT))
        time.sleep(1.2); tap(host, 'nextBtn')
        ok('bingo: a ball is called', R.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 15) is True, js(host, ERRT))
        on_screen(host, 'bingo', 'calling', [('endGameBtn', r'^End game'), ('nextBtn', r'^Next number')])
        ok('bingo: no script errors on the console', js(host, 'window.__errs.length') == 0, js(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


def run_raffle():
    global R
    print('\nRAFFLE')
    R = new_rig(('/app/raffle/host.html',))
    try:
        W = R.W; seed(W)
        t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': None, 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
        W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
        t2, host = R.open('/app/raffle/host.html', width=390, height=844)
        ok('raffle: the console loads', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True, js(host, ERRT))
        js(host, 'document.querySelector("#prizePresets button").click(); true')
        R.until(host, '/Meat tray/.test(document.getElementById("prizeList").textContent)', 10)
        time.sleep(2)
        fits(host, 'raffle', 'setup', 'drawBtn', r'^Draw the winner$', None, False)
        ok('raffle: no script errors on the console', js(host, 'window.__errs.length') == 0, js(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


def run_members():
    global R
    print('\nMEMBERS DRAW')
    R = new_rig(('/app/members/host.html',))
    try:
        W = R.W; seed(W)
        t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 20000}, {})['body']
        did = (made.get('draw') or {}).get('id')
        names = ['Smith, Ann', 'Jones, Bob', 'Brown, Cath', 'Nguyen, Dan', 'Lee, Eve', 'Taylor, Finn']
        W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': nm} for i, nm in enumerate(names)]}, {})
        def table(name):
            with W.lock:
                W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
                return json.loads(W.p.stdout.readline())['body']
        for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'): R.db[t] = table(t)
        t2, host = R.open('/app/members/host.html', width=390, height=844)
        ok('members: the console loads', R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True, js(host, ERRT))
        time.sleep(2)
        on_screen(host, 'members', 'setup', [('drawBtn', r'^Draw$')])
        ok('members: no script errors on the console', js(host, 'window.__errs.length') == 0, js(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


RUNS = {'trivia': run_trivia, 'musical': run_musical, 'bingo': run_bingo, 'raffle': run_raffle, 'members': run_members}


def source_checks():
    """INBOX 426 item 5, bingo: the claim card puts Confirm winner / Play on ABOVE the ticket picture, so it is on the screen of a
    375x667 phone (it was 771 px down, under the picture). A claim needs a phone with a real line to reach the console, which the
    Tuesday real-night play covers; this reads the console's own claim template, in the function that builds it."""
    src = open(os.path.join(ROOT, 'venueplay', 'app', 'index.html'), encoding='utf-8').read()
    a = src.index('G.claims.forEach(function(c,ci){\n      var valid=c.valid!==false;')
    b = src.index('q.innerHTML=html;', a)
    blk = src[a:b]
    i, j = blk.find('data-act="confirm"'), blk.find('id="claimCard-')
    ok('bingo claim card: Confirm winner comes before the ticket picture in the card', 0 <= i < j, [i, j])
    k = blk.find('data-act="reject"')
    ok('bingo claim card: and so does Play on / Not this one', 0 <= k < j, [k, j])
    for page in ('trivia/host.html', 'musical/host.html', 'raffle/host.html', 'index.html', 'members/host.html'):
        h = open(os.path.join(ROOT, 'venueplay', 'app', page), encoding='utf-8').read()
        ok('%s links the shared action bar stylesheet' % page, '/app/vp-actionbar.css' in h and 'class="vp-actionbar"' in h, page)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('console-start-buttons-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    source_checks()
    which = [a for a in sys.argv[1:] if a in RUNS] or list(RUNS)
    for k in which: RUNS[k]()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
