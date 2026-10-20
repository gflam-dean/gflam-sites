#!/usr/bin/env python3
"""THE TV AND THE PHONE AFTER A GAME, IN A REAL BROWSER (live play audit, 20 Oct 2026).

Two faults the live play audit found by playing a night through, which every suite in the gate had
missed because none of them ran a SECOND game on the same screen and phone:

  1. The TV kept "BINGO! <last winner> WINS <prize>" up over the next lobby, instead of the QR.
     A real-balls night: Open lobby, Start, call numbers, Winner!, End game (the TV goes to the ads),
     then Open lobby for the next game. The console said the TV was showing the join code.
  2. A phone on "Tonight you play on paper" (a real-balls night) never moved on to the next game.
     The typed-code lookup gave up after 225 tries (thirty minutes, shorter than a night), and every
     mode message started a second chain of it on the same counter.

Plus the small things found the same night: the winner's phone kept YOU WON through the next lobby,
a line winner's phone forgot the line when somebody else won two lines, the "No sound" toast on the
musical TV covered the JOIN NOW QR, the Go fullscreen chip sat on the ads all night, and the paper
notice covered the whole page (no header, no venue, no Help).

Same rig as tools/console-in-chrome.test.py (tools/browser-rig/rig.py): the repo's own pages, the
REAL game Worker in jsc, supabase-js replaced by a stand-in that carries realtime between tabs, and
headless Chrome. The phone's long timers (4 s and over) run forty times fast, so half an hour of a
night passes in under a minute; nothing else about the page is changed.

    python3 tools/tv-and-phone-in-chrome.test.py            screenshots go to $VP_SHOTS if set
"""
import io, json, os, sys, time
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

# The phone's clock: long timers forty times fast. Records every realtime channel name, and every
# Worker call, so the test can talk on the phone's channel and count what it asks.
FAST = r'''(function(){
  var st=window.setTimeout, si=window.setInterval;
  function f(ms){ return (typeof ms==="number" && ms>=4000) ? ms/__F__ : ms; }
  window.setTimeout=function(fn,ms){ var a=[].slice.call(arguments); a[1]=f(ms); return st.apply(window,a); };
  window.setInterval=function(fn,ms){ var a=[].slice.call(arguments); a[1]=f(ms); return si.apply(window,a); };
  window.__bc=[]; var BC=window.BroadcastChannel;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0) window.__bc.push(n); return new BC(n); };
  window.__BC=BC; window.__calls=[];
  var rf=window.fetch; window.fetch=function(u){ try{ window.__calls.push({u:String(u), t:Date.now()}); }catch(e){} return rf.apply(window, arguments); };
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return true; };
})();'''
def fast(k=40): return FAST.replace('__F__', str(k))

def join(r, phone, name):
    """Type a name and tap Join ONCE, as a punter does. The test waited for the page first (r.phone_ready:
    the scripts have run and Join says Join, and the Worker has been asked about the room), so a second
    tap is never needed; this used to tap up to three times, which hid the very fault it was retrying."""
    r.ask(phone, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    return r.until(phone, vis('vWait'), 15) is True

def console(r):
    tid, host = r.open('/app/')
    ok('the console loads, signed in, on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    return tid, host

def set_setup(r, host, caller):
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                 '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";'
                 '$("callerChk").checked=%s;$("callerChk").dispatchEvent(new Event("change"));true') % ('true' if caller else 'false'))

def tap_start(r, host):
    r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(1.5)
    if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
        r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)

def caller_night(r, host, numbers):
    """A real-balls night: Open lobby, Start, tap the numbers on the grid."""
    set_setup(r, host, True)
    tap_start(r, host)
    r.until(host, '/Start/i.test(document.getElementById("startBtn").textContent)', 10)
    tap_start(r, host)
    up = r.until(host, vis('callerGrid'), 10)
    for n in numbers:
        r.ask(host, 'document.querySelector(\'#callerGrid [data-n="%d"]\').click(); true' % n); time.sleep(0.4)
    return up

def end_game(r, host):
    r.ask(host, 'setTimeout(function(){ document.getElementById("endGameBtn").click(); }, 0); true')
    time.sleep(2.5)


# ======================================================================================
def tv_old_winner():
    print('\nFAULT 1: a real-balls winner, End game, then Open lobby: the TV must show the QR, not last game\'s winner')
    r = RIG.Rig()
    try:
        # The TV's clock can be moved forward (window.__shift ms), so the chip's thirty second hold passes in a moment.
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], before='(function(){var n=Date.now;window.__shift=0;Date.now=function(){return n()+window.__shift;};})();')
        ok('the TV loads on the ads', r.until(tv, vis('adsRoot'), 15) is True)
        time.sleep(2)
        ok('CONTROL: the Go fullscreen chip is there for whoever sets the TV up', r.until(tv, vis('tvFsBtn'), 3) is True)
        ctid, host = console(r)
        ok('a real-balls night starts and the grid is up', caller_night(r, host, [5, 17, 42]) is True)
        r.ask(host, 'document.getElementById("callerWinBtn").click(); true'); time.sleep(0.8)
        r.ask(host, 'var b=document.querySelector("#cwStages [data-pat]"); b && b.click(); !!b')
        ok('CONTROL: the TV celebrates the winner during the game', r.until(tv, vis('tvWin'), 10) is True,
           r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        shot(r, tv, 'tv-1-winner-during-game')
        end_game(r, host)
        ok('End game: the TV goes to the ads', r.until(tv, vis('adsRoot'), 10) is True)
        time.sleep(1.5)   # the TV is a window of its own (rig.open), so its timers run as a venue TV's do
        # Somebody touches the remote: the chip is back for its thirty second hold, measured from now.
        r.ask(tv, 'document.dispatchEvent(new Event("keydown")); window.__shift=25000; document.dispatchEvent(new Event("fullscreenchange")); true'); time.sleep(0.5)
        ok('a key brings the Go fullscreen chip back, and it is still there 25 seconds on', r.ask(tv, vis('tvFsBtn')) is True)
        r.ask(tv, 'window.__shift=31000; document.dispatchEvent(new Event("fullscreenchange")); true'); time.sleep(0.5)
        ok('and the Go fullscreen chip is not on the venue\'s ads any more (thirty seconds untouched)', r.ask(tv, vis('tvFsBtn')) is False)
        r.ask(tv, 'window.__shift=0; true')   # the clock back, so nothing after this runs half a minute late
        shot(r, tv, 'tv-1b-ads-no-fullscreen-chip')
        # from here on, record whether the old winner card is EVER painted, even for a moment
        r.ask(tv, 'window.__winSeen=0; setInterval(function(){ if(%s) window.__winSeen++; }, 20); true' % vis('tvWin'))
        set_setup(r, host, False)
        tap_start(r, host)
        ok('the next lobby is open on the console', r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 10) is True,
           r.ask(host, 'document.getElementById("startBtn").textContent'))
        time.sleep(3)
        shot(r, tv, 'tv-2-next-lobby')
        ok('THE TV SHOWS THE JOIN SCREEN (the QR) for the new lobby', r.until(tv, vis('tvLobby'), 8) is True,
           r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        ok('and not "BINGO! ... WINS" from the game before', r.ask(tv, vis('tvWin')) is False)
        time.sleep(6)
        ok('still the QR a few seconds later (the lobby is not swallowed by a refresh)', r.ask(tv, vis('tvLobby')) is True and r.ask(tv, vis('tvWin')) is False)
        ok('and last game\'s winner never flashed up in between (the ads forgot it)', r.ask(tv, 'window.__winSeen') == 0, r.ask(tv, 'window.__winSeen'))
        ok('no script errors on the TV', r.ask(tv, 'window.__errs.length') == 0, r.ask(tv, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


# ======================================================================================
def tv_missed_idle():
    print('\nFAULT 1, the other road: a TV that missed End game (a wifi blip) and hears the next lobby straight after a win')
    r = RIG.Rig()
    try:
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], before=fast(1))
        r.until(tv, vis('adsRoot'), 15); time.sleep(1.5)
        say = lambda m: r.ask(tv, 'window.__say(%s)' % json.dumps(m))
        say({'t': 'mode', 'mode': 'bingo', 'caller': False}); time.sleep(0.3)
        say({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': [4, 8, 15], 'active': True, 'caller': False}); time.sleep(0.3)
        say({'t': 'winner', 'pid': 'p1', 'name': 'Sam', 'cardNo': 696, 'pattern': 'one', 'prize': 'Meat tray', 'winners': [{'pid': 'p1', 'name': 'Sam', 'cardNo': 696}], 'cont': False})
        ok('CONTROL: the TV shows the winner', r.until(tv, vis('tvWin'), 6) is True, r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        say({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': [4, 8, 15], 'active': True, 'caller': False}); time.sleep(1)
        ok('a routine refresh mid-celebration does NOT wipe the winner (a phone waking up resends state)', r.ask(tv, vis('tvWin')) is True)
        say({'t': 'mode', 'mode': 'bingo', 'caller': False}); time.sleep(0.2)
        say({'t': 'state', 'pattern': 'one', 'prize': 'Bar tab', 'called': [], 'active': False, 'caller': False, 'join_code': r.W.info['code']})
        ok('the next lobby (nothing running, no ball called) puts the QR up, not the old winner', r.until(tv, vis('tvLobby'), 6) is True and r.ask(tv, vis('tvWin')) is False,
           r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
    finally:
        r.close()


# ======================================================================================
def phone_paper(entry):
    print('\nFAULT 3: a phone on "Tonight you play on paper" (%s) follows the room after a long real-balls night' % entry)
    r = RIG.Rig()
    try:
        path = '/play?room=' + r.W.info['code'] if entry == 'typed code' else '/play?venue=' + r.W.info['slug']
        ptid, phone = r.open(path, before=fast(), width=390, height=844)
        ok('the phone page loads, its scripts have run and the Worker has been asked about the room', r.phone_ready(phone) is True,
           r.ask(phone, 'document.readyState + " | " + document.getElementById("joinBtn").textContent'))
        ok('CONTROL: the phone joins', join(r, phone, 'Bea'))
        ctid, host = console(r)
        caller_night(r, host, [3, 33])
        ok('a real-balls night: the phone is told to play on paper', r.until(phone, vis('vPaper'), 15) is True,
           r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        shot(r, phone, 'phone-1-paper-%s' % entry.replace(' ', '-'))
        hdr = r.ask(phone, '(function(){var h=document.querySelector(".ptop"),b=h.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)&&h.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2));})()')
        ok('the paper notice sits in the normal page: the VenuePlay header is on screen, not covered', hdr is True)
        ok('and the Help link is there and can be tapped', r.ask(phone, '(function(){var l=document.getElementById("vphLink");if(!l)return false;l.scrollIntoView();var b=l.getBoundingClientRect();return b.width>0&&document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)===l;})()') is True)
        ok('in bigger type (the heading at least 34px)', (r.ask(phone, 'parseFloat(getComputedStyle(document.querySelector("#vPaper .pbig")||document.body).fontSize)') or 0) >= 34)
        ok('the header does not claim to be reconnecting', r.ask(phone, 'document.getElementById("statusText").textContent') != 'Reconnecting',
           r.ask(phone, 'document.getElementById("statusText").textContent'))
        # the night goes on: 60 real seconds is forty minutes of the phone's own timers
        time.sleep(60)
        ok('forty phone-minutes later, still on paper (the night is still on)', r.ask(phone, vis('vPaper')) is True)
        n0 = len(r.ask(phone, 'window.__calls.filter(function(c){return /join\\/info|play\\/live/.test(c.u)}).map(function(c){return c.t})') or [])
        time.sleep(6)
        n1 = len(r.ask(phone, 'window.__calls.filter(function(c){return /join\\/info|play\\/live/.test(c.u)}).map(function(c){return c.t})') or [])
        ok('the phone is STILL asking where the room is (it used to give up after thirty minutes)', n1 - n0 >= 2, '%d asks in 6 s' % (n1 - n0))
        ok('and no faster than the slow poll allows (6 real s = 4 phone min; at most ~10 asks, not a runaway)', n1 - n0 <= 14, '%d asks in 6 s' % (n1 - n0))
        end_game(r, host)
        ok('End game: the paper notice comes down and the phone is back waiting', r.until(phone, vis('vWait'), 10) is True and r.ask(phone, vis('vPaper')) is False,
           r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        shot(r, phone, 'phone-2-after-end-%s' % entry.replace(' ', '-'))
        res = r.W.ask('POST', '/session', {'venue_id': r.W.info['venue'], 'format': 'musical_bingo'}, {})
        ok('CONTROL: a musical bingo lobby is now open at the venue', res.get('status') == 200 and r.W.ask('GET', '/play/live?code=' + r.W.info['code'])['body'].get('format') == 'musical_bingo', res)
        ok('THE PHONE FOLLOWS THE ROOM TO MUSICAL BINGO', r.until(phone, '/\\/app\\/musical\\/play/.test(location.pathname)', 15) is True,
           r.ask(phone, 'location.pathname + " | " + document.body.innerText.replace(/\\s+/g," ").slice(0,150)'))
    finally:
        r.close()


# ======================================================================================
def phone_one_chain():
    print('\nThe typed-code lookup is ONE chain, however many mode messages arrive')
    r = RIG.Rig()
    try:
        ptid, phone = r.open('/play?room=' + r.W.info['code'], before=fast(8), width=390, height=844)
        r.phone_ready(phone)
        ok('CONTROL: the phone joins', join(r, phone, 'Cal'))
        time.sleep(2)
        count = 'window.__calls.filter(function(c){return /join\\/info/.test(c.u)}).length'
        a0 = r.ask(phone, count); time.sleep(4); a1 = r.ask(phone, count)
        for i in range(12):
            r.ask(phone, 'window.__say({t:"mode", mode:"bingo"})'); time.sleep(0.3)
        time.sleep(1)
        b0 = r.ask(phone, count); time.sleep(4); b1 = r.ask(phone, count)
        base, after = a1 - a0, b1 - b0
        ok('CONTROL: the lookup is running (%d asks in 4 s)' % base, base >= 2, base)
        ok('twelve mode messages later it asks at the same rate, not twelve times as often (%d vs %d)' % (after, base), after <= base * 2 + 2, (base, after))
    finally:
        r.close()


# ======================================================================================
def phone_after_win():
    print('\nThe winner\'s phone, and a line winner\'s phone, after the game')
    r = RIG.Rig()
    try:
        ptid, phone = r.open('/play?room=' + r.W.info['code'], before=fast(), width=390, height=844)
        r.phone_ready(phone)
        r.ask(phone, 'window.__pid=null; window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new window.__BC(n); c.onmessage=function(e){ var m=e.data&&e.data.payload; if(m&&m.t==="join"&&m.pid) window.__pid=m.pid; }; } }); true')
        ok('CONTROL: the phone joins', join(r, phone, 'Dee'))
        time.sleep(2)
        pid = r.until(phone, 'window.__pid || localStorage.getItem("vp-pid-" + %s)' % json.dumps(r.W.info['code']), 8)
        ok('CONTROL: the phone announced itself on the channel', isinstance(pid, str) and len(pid) > 3, pid)
        say = lambda m: r.ask(phone, 'window.__say(%s)' % json.dumps(m))
        me = {'pid': pid, 'name': 'Dee', 'cardNo': 7}
        say({'t': 'state', 'pattern': 'full', 'prize': 'Meat tray', 'called': [1, 2, 3], 'active': True, 'session_id': 'sess-1', 'join_code': r.W.info['code']}); time.sleep(0.5)
        say({'t': 'winner', 'pid': pid, 'name': 'Dee', 'cardNo': 7, 'pattern': 'full', 'prize': 'Meat tray', 'winners': [me], 'cont': False})
        ok('CONTROL: the phone shows YOU WON', r.until(phone, vis('vWon'), 6) is True)
        say({'t': 'idle'}); time.sleep(0.3)
        say({'t': 'state', 'pattern': 'full', 'prize': 'Meat tray', 'called': [], 'active': False, 'session_id': None, 'join_code': None}); time.sleep(1)
        ok('End game: the winner keeps YOU WON to show at the bar', r.ask(phone, vis('vWon')) is True)
        say({'t': 'mode', 'mode': 'bingo'}); time.sleep(0.2)
        say({'t': 'state', 'pattern': 'one', 'prize': 'Bar tab', 'called': [], 'active': False, 'session_id': None, 'join_code': None}); time.sleep(0.3)
        say({'t': 'state', 'pattern': 'one', 'prize': 'Bar tab', 'called': [], 'active': False, 'session_id': 'sess-2', 'join_code': r.W.info['code']})
        ok('THE NEXT LOBBY OPENS: YOU WON gives way to the waiting screen', r.until(phone, vis('vWait'), 6) is True and r.ask(phone, vis('vWon')) is False,
           r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        shot(r, phone, 'phone-3-next-lobby-after-win')
        # a line, then somebody else's two lines
        say({'t': 'started', 'pattern': 'one', 'prize': 'Bar tab'}); time.sleep(0.3)
        say({'t': 'winner', 'pid': pid, 'name': 'Dee', 'cardNo': 12, 'pattern': 'one', 'prize': 'Bar tab', 'winners': [{'pid': pid, 'name': 'Dee', 'cardNo': 12}], 'cont': True, 'next': 'two', 'nextPrize': 'Meat tray'}); time.sleep(0.6)
        say({'t': 'winner', 'pid': 'someone-else', 'name': 'Sam', 'cardNo': 690, 'pattern': 'two', 'prize': 'Meat tray', 'winners': [{'pid': 'someone-else', 'name': 'Sam', 'cardNo': 690}], 'cont': False})
        ok('CONTROL: somebody else won two lines: Nice game', r.until(phone, vis('vLost'), 6) is True)
        txt = r.ask(phone, 'document.getElementById("lostSub").innerText')
        shot(r, phone, 'phone-4-line-winner-nice-game')
        ok('the line this phone won is still there: "You won One line ... see the host"', isinstance(txt, str) and 'You won One line' in txt and 'see the host' in txt, txt)
        ok('and who won the two lines', isinstance(txt, str) and 'Sam won' in txt, txt)
    finally:
        r.close()


# ======================================================================================
def join_loading():
    print('\nSlow pub wifi: Join says "Loading..." and does nothing until the page\'s scripts are ready, then says Join')
    # The local site sits on the last script above play.html's own for eight seconds, as a slow
    # connection does: the Join button (in the markup above it) is on the page, its listener is not.
    r = RIG.Rig(hold={'/app/vp-venueurl.js': 8})
    try:
        ptid, phone = r.open('/play?room=' + r.W.info['code'], width=390, height=844)
        ok('CONTROL: the Join button is on the page while the scripts are still arriving',
           r.until(phone, 'document.readyState==="loading" && !!document.getElementById("joinBtn")', 6) is True,
           r.ask(phone, 'document.readyState'))
        b = r.ask(phone, '(function(b){return {d:b.disabled, t:b.textContent.trim()};})(document.getElementById("joinBtn"))') or {}
        ok('until then it is disabled and reads "Loading..." (a tap is refused where the punter can see it)',
           b.get('d') is True and b.get('t') == 'Loading...', b)
        r.ask(phone, 'document.getElementById("joinBtn").click(); true')
        ok('CONTROL: still loading after that early tap (the hold is what this scene tests)', r.ask(phone, 'document.readyState') == 'loading')
        ok('the page is ready by itself once the scripts arrive: enabled, and it says Join', r.phone_ready(phone, 60) is True,
           r.ask(phone, 'document.readyState + " | " + document.getElementById("joinBtn").textContent + " | disabled " + document.getElementById("joinBtn").disabled'))
        ok('and one tap then puts the punter in', join(r, phone, 'Eve'),
           r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        ok('no script errors on the phone', r.ask(phone, 'window.__errs.length') == 0, r.ask(phone, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


# ======================================================================================
def musical_toast():
    print('\nThe musical TV\'s "No sound on this screen" toast: top centre, off the JOIN NOW QR, gone in eight seconds')
    src = io.open(os.path.join(RIG.ROOT, 'venueplay/app/musical/screen.html'), encoding='utf-8').read()
    a = src.find('  var _audioWarned=false;'); b = src.find('  function audioOk(){', a)
    ok('CONTROL: audioBlocked() is where this test lifts it from', a > 0 and b > a)
    if a < 0 or b < 0: return
    code = src[a:b]
    r = RIG.Rig()
    try:
        tid, sid = r.open('/__blank', width=1280, height=720)
        r.until(sid, 'document.readyState==="complete"')
        # the JOIN NOW panel sits bottom left on the musical screen (audit design-01)
        r.ask(sid, 'var q=document.createElement("div");q.id="qr";q.style.cssText="position:fixed;left:24px;bottom:24px;width:260px;height:120px;background:#fff";document.body.appendChild(q);'
                   'window.tvSend=function(){}; (0,eval)(%s + "\\nwindow.__ab=audioBlocked;"); window.__ab(); true' % json.dumps(code))
        rect = r.ask(sid, '(function(){var w=document.getElementById("audioWarn"),q=document.getElementById("qr");if(!w)return null;var a=w.getBoundingClientRect(),b=q.getBoundingClientRect();'
                          'return {top:a.top,mid:a.left+a.width/2,overlap:!(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom)};})()')
        ok('the toast is up', rect is not None)
        shot(r, sid, 'tv-3-no-sound-toast')
        ok('at the top centre of the screen', rect and rect['top'] < 80 and abs(rect['mid'] - 640) < 20, rect)
        ok('and not over the JOIN NOW QR', rect and not rect['overlap'], rect)
        time.sleep(8.6)
        ok('gone after eight seconds', r.ask(sid, '!document.getElementById("audioWarn")') is True)
    finally:
        r.close()


try:
    tv_old_winner()
    tv_missed_idle()
    phone_paper('typed code')
    phone_paper('table talker')
    phone_one_chain()
    phone_after_win()
    join_loading()
    musical_toast()
except Exception as e:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
