#!/usr/bin/env python3
"""WHO HAS THE TV: A FINISHED BINGO LETS GO, A DRAW CONSOLE TAKES IT ONLY ON AN ACTION, AND SAYS WHEN IT HAS NOT
(live play on The Mini Bar with the Kogan TV app, 12 Nov 2026; INBOX 282.8, 282.8b and 286; FINDINGS R3, R6, R7,
R8, B6, D7).

What Dean saw:
  R3/R7  the raffle ran its whole draw on the console three times and never showed on the TV. Bingo had just been
         finished with Finish game: its console kept sending mode:"bingo" to every TV hello (the Kogan app starting
         up) and every time its tab came back into view, so the finished winner won the wall back, and the raffle
         console had spent its one claim when its page opened.
  D7/286 opening the members console only to change a setting put the members draw on the TV, and it stayed.
  R6     after End game, a fresh TV start put the raffle's "Get your tickets" back up.
  8b     his phone still showed the bingo winner twenty minutes and four draws later.

Played here in real headless Chrome windows (tools/browser-rig/rig.py: the repo's pages, the REAL game Worker in jsc,
realtime carried between windows): a TV, the bingo console, the raffle console, the members console and a phone.

    python3 tools/tv-takeover-12nov-in-chrome.test.py          VP_SHOTS=<folder> keeps screenshots
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: time.sleep(0.4); r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)

# What the TV has on the wall, read off the page: "ads", "bingo:<layer>", "embed:<game>" or "hold".
WALL = ('(function(){var f=document.getElementById("gameFrame");'
        ' if(f && f.style.display!=="none"){ var m=/\\/app\\/(\\w+)\\/screen/.exec(f.getAttribute("src")||""); return "embed:"+(m?m[1]:"?"); }'
        ' var L=["tvWin","tvRun","tvLobby","tvClaim","tvHold"]; for(var i=0;i<L.length;i++){ if(%s(L[i])) return L[i]==="tvHold"?"hold":"bingo:"+L[i]; }'
        ' if(%s("adsRoot")) return "ads"; return "?"; })()') % (VISIBLE, VISIBLE)
def wall(r, tv): return r.ask(tv, WALL)
def wall_is(r, tv, want, secs):
    return r.until(tv, WALL + '===%s' % json.dumps(want), secs) is True
FRAME_TEXT = '(function(){var f=document.getElementById("gameFrame"); try{ return f.contentDocument.body.innerText.replace(/\\s+/g," "); }catch(e){ return ""; }})()'
def frame_text(r, tv):
    return (r.ask(tv, FRAME_TEXT) or '')[:200]

# Everything said on the console's realtime channels, seen from inside the console page.
SPY = (r'''(function(){ window.__out=[]; var B=window.BroadcastChannel; if(!B) return;
  var P=B.prototype.postMessage; B.prototype.postMessage=function(d){ try{ if(d && d.payload) window.__out.push(d.payload); }catch(e){} return P.apply(this, arguments); };
})();''')
MODES = 'JSON.stringify((window.__out||[]).filter(function(m){ return m && m.t==="mode"; }).map(function(m){ return m.mode+(m.claim?"+claim":"")+(m.force?"+force":""); }))'
# The Date.now of a page can be moved forward (window.__shift ms) so a ten minute wait passes in a moment.
SHIFT = '(function(){var n=Date.now;window.__shift=0;Date.now=function(){return n()+window.__shift;};})();'
# Long timers on a page run forty times fast (as tools/tv-and-phone-in-chrome.test.py does for the phone).
FAST = r'''(function(){ var st=window.setTimeout, si=window.setInterval;
  function f(ms){ return (typeof ms==="number" && ms>=20000) ? ms/40 : ms; }
  window.setTimeout=function(fn,ms){ var a=[].slice.call(arguments); a[1]=f(ms); return st.apply(window,a); };
  window.setInterval=function(fn,ms){ var a=[].slice.call(arguments); a[1]=f(ms); return si.apply(window,a); };
  window.__bc=[]; var BC=window.BroadcastChannel;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0) window.__bc.push(n); return new BC(n); };
  window.__BC=BC;
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return true; };
})();'''


def bingo_console(r):
    tid, host = r.open('/app/', before=SPY, width=1100, height=900)
    r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    return tid, host

def tap_start(r, host):
    r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(1.5)
    if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
        r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)

def caller_night(r, host, numbers):
    """A real-balls night: Open lobby, Start, tap the numbers on the grid."""
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                 '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";'
                 '$("callerChk").checked=true;$("callerChk").dispatchEvent(new Event("change"));true'))
    tap_start(r, host)
    r.until(host, '/Start/i.test(document.getElementById("startBtn").textContent)', 10)
    tap_start(r, host)
    up = r.until(host, vis('callerGrid'), 10)
    for n in numbers:
        r.ask(host, 'document.querySelector(\'#callerGrid [data-n="%d"]\').click(); true' % n); time.sleep(0.4)
    return up is True

def bingo_win_and_finish(r, host):
    r.ask(host, 'document.getElementById("callerWinBtn").click(); true'); time.sleep(0.8)
    r.ask(host, 'document.getElementById("callerConfirmBtn").click(); true'); time.sleep(0.8)
    fin = r.until(host, '!!document.querySelector(\'#cwNextBtns [data-next=""]\')', 8)
    r.ask(host, 'document.querySelector(\'#cwNextBtns [data-next=""]\').click(); true'); time.sleep(0.8)
    return fin is True

def come_back_to(r, sid):
    """The tab comes back into view (a host switching tabs, a tablet waking): the page's own visibility handler runs."""
    r.ask(sid, 'document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pageshow")); true')

def accept_rules_until(r, host, cond, secs):
    """The rig's venue is in Queensland: the night's rules are asked before the first draw. Tick through them."""
    t = time.time() + secs
    while time.time() < t:
        if r.ask(host, cond) is True: return True
        r.ask(host, 'var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && /I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); true')
        time.sleep(0.7)
    return r.ask(host, cond) is True

def raffle_console(r):
    r.W.ask('POST', '/host/gaming/declare', {'venue_id': r.W.info['venue'], 'format': 'raffle', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    tid, host = r.open('/app/raffle/host.html', before=SPY, width=1000, height=1100)
    up = r.until(host, '!document.getElementById("consoleView").classList.contains("hidden") && document.getElementById("statusText").getAttribute("data-conn")!=="signed-in"', 60)
    time.sleep(2)
    return tid, host, up is True

def raffle_draw(r, host, prize):
    r.ask(host, 'document.getElementById("rfPrize").value=%s; true' % json.dumps(prize))
    r.ask(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')

def tv_line(r, host): return r.ask(host, '(function(){var b=document.getElementById("tvLine"); return (b && !b.classList.contains("hidden")) ? b.innerText.replace(/\\s+/g," ") : "";})()')


# ======================================================================================
def finished_bingo_lets_the_raffle_on():
    print('\nR3/R7: bingo ends with Finish game, the raffle draws: the RAFFLE is on the TV, and the finished bingo never takes it back')
    r = RIG.Rig(host_pages=('/app/raffle/host.html',))
    try:
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1280, height=720)
        ok('the TV loads on the ads', wall_is(r, tv, 'ads', 20), wall(r, tv))
        time.sleep(1.5)
        rtid, raffle, up = raffle_console(r)
        ok('the raffle console opens early in the night (as Dean had it), signed in', up)
        time.sleep(5)
        ok('286: OPENING the raffle console leaves the TV on the ads', wall(r, tv) == 'ads', wall(r, tv))
        ok('286: and the console claimed nothing as it connected', r.ask(raffle, MODES) == '[]', r.ask(raffle, MODES))
        ok('its quiet "Put the raffle on the TV" is there instead', 'Put the raffle on the TV' in (tv_line(r, raffle) or ''), tv_line(r, raffle))
        come_back_to(r, raffle); time.sleep(3)
        ok('286: coming back to the raffle tab takes nothing either', wall(r, tv) == 'ads' and r.ask(raffle, MODES) == '[]', [wall(r, tv), r.ask(raffle, MODES)])

        btid, host = bingo_console(r)
        ok('CONTROL: a real-balls bingo game runs on the TV', caller_night(r, host, [5, 17, 42]) and wall_is(r, tv, 'bingo:tvRun', 12), wall(r, tv))
        ok('Winner, Confirm, then FINISH GAME (not End game): the winner is on the TV', bingo_win_and_finish(r, host) and wall_is(r, tv, 'bingo:tvWin', 10), wall(r, tv))
        shot(r, tv, 'r3-1-bingo-finished')
        r.ask(host, 'window.__out=[]; true')
        come_back_to(r, host); time.sleep(2)
        ok('the finished bingo console does not re-claim the TV when its tab comes back', r.ask(host, MODES) == '[]', r.ask(host, MODES))

        raffle_draw(r, raffle, 'Meat tray')
        drawn = accept_rules_until(r, raffle, 'document.getElementById("winnerCard").classList.contains("show")', 45)
        ok('CONTROL: the raffle draw runs on the console (ticket drawn, winner card up)', drawn, r.ask(raffle, '((document.getElementById("hostErrText")||{}).textContent||"")'))
        ok('DRAW claimed the TV for the raffle (one claim, not a force)', '"raffle+claim"' in (r.ask(raffle, MODES) or '') and 'force' not in (r.ask(raffle, MODES) or ''), r.ask(raffle, MODES))
        ok('R3: THE TV SHOWS THE RAFFLE, not the finished bingo winner', wall_is(r, tv, 'embed:raffle', 20), wall(r, tv))
        ok('and the raffle screen shows the draw for the meat tray', r.until(tv, '/meat tray/i.test(' + FRAME_TEXT + ')', 20) is True, frame_text(r, tv))
        shot(r, tv, 'r3-2-raffle-on-tv')
        ok('the raffle console says nothing about the TV: it is showing the draw', r.until(raffle, '!(function(){var b=document.getElementById("tvLine"); return b && !b.classList.contains("hidden") && /not showing/.test(b.innerText);})()', 10) is True, tv_line(r, raffle))

        come_back_to(r, host); time.sleep(4)
        ok('R3: the bingo tab coming back into view does NOT put the finished winner back over the raffle', wall(r, tv) == 'embed:raffle', wall(r, tv))
        r.ask(tv, 'location.reload(); true'); time.sleep(1)
        ok('R7: a fresh TV start (the Kogan app relaunched) comes back to the RAFFLE that is on, not the finished bingo', wall_is(r, tv, 'embed:raffle', 30), wall(r, tv))
        time.sleep(4)
        ok('and stays on it', wall(r, tv) == 'embed:raffle', wall(r, tv))

        r.until(raffle, '!document.getElementById("claimBtn").disabled && document.getElementById("claimBtn").offsetParent!==null', 20)
        r.ask(raffle, 'document.getElementById("claimBtn").click(); true'); time.sleep(2)
        r.ask(raffle, 'document.getElementById("toAdsBtn").click(); true')
        if r.until(raffle, '!!document.getElementById("vpAsk")', 6) is True:
            r.ask(raffle, 'document.getElementById("vpAskGo").click(); true')
        ok('End game on the raffle: the TV goes back to the ads', wall_is(r, tv, 'ads', 30), wall(r, tv))
        r.ask(raffle, 'window.__out=[]; true')
        r.ask(tv, 'location.reload(); true'); time.sleep(1)
        ok('the TV restarts on the ads', wall_is(r, tv, 'ads', 20), wall(r, tv))
        time.sleep(6)
        ok('R6: after End game a fresh TV start stays on the ads (no "Get your tickets" back up)', wall(r, tv) == 'ads' and r.ask(raffle, MODES) == '[]', [wall(r, tv), r.ask(raffle, MODES)])
        shot(r, tv, 'r3-3-ads-after-end')
        for name, sid in (('TV', tv), ('raffle console', raffle), ('bingo console', host)):
            ok('no script errors on the ' + name, r.ask(sid, '(window.__errs||[]).length') == 0, r.ask(sid, 'JSON.stringify(window.__errs||[])'))
    finally:
        r.close()


# ======================================================================================
def live_bingo_kept_and_host_told():
    print('\nA bingo being PLAYED keeps the wall from a raffle Draw; the raffle console says so, and its button takes it')
    r = RIG.Rig(host_pages=('/app/raffle/host.html',))
    try:
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1280, height=720)
        wall_is(r, tv, 'ads', 20); time.sleep(1.5)
        rtid, raffle, up = raffle_console(r)
        btid, host = bingo_console(r)
        ok('CONTROL: a real-balls bingo game is being called on the TV', caller_night(r, host, [3, 9, 27, 44]) and wall_is(r, tv, 'bingo:tvRun', 12), wall(r, tv))
        raffle_draw(r, raffle, 'Bottle of VB')
        drawn = accept_rules_until(r, raffle, 'document.getElementById("winnerCard").classList.contains("show")', 45)
        ok('CONTROL: the raffle still draws (it never stalls on the TV)', drawn)
        ok('the live bingo game is NOT pulled off the wall by somebody else\'s Draw', wall(r, tv) == 'bingo:tvRun', wall(r, tv))
        line = r.until(raffle, '(function(){var b=document.getElementById("tvLine"); return !!b && !b.classList.contains("hidden") && /not showing/.test(b.innerText);})()', 15)
        txt = tv_line(r, raffle)
        ok('THE HOST IS TOLD: "The TV is not showing this draw."', line is True and 'The TV is not showing this draw.' in txt, txt)
        ok('and why: "Bingo is still on it."', 'Bingo is still on it.' in (txt or ''), txt)
        ok('with the button to take it: "Put the draw on the TV"', 'Put the draw on the TV' in (txt or ''), txt)
        ok('in plain words: no em dash', '—' not in (txt or ''), txt)
        shot(r, raffle, 'live-1-raffle-console-told')
        r.ask(raffle, 'document.querySelector("#tvLine .tvline-btn").click(); true')
        ok('the host taps it: the raffle is on the TV', wall_is(r, tv, 'embed:raffle', 20), wall(r, tv))
        ok('that tap was a force (the host chose it after being told)', 'raffle+claim+force' in (r.ask(raffle, MODES) or ''), r.ask(raffle, MODES))
        ok('and the line goes once the TV says it is showing the draw', r.until(raffle, '(function(){var b=document.getElementById("tvLine"); return !b || b.classList.contains("hidden");})()', 45) is True, tv_line(r, raffle))
        shot(r, tv, 'live-2-raffle-forced')
        for name, sid in (('TV', tv), ('raffle console', raffle)):
            ok('no script errors on the ' + name, r.ask(sid, '(window.__errs||[]).length') == 0, r.ask(sid, 'JSON.stringify(window.__errs||[])'))
    finally:
        r.close()


# ======================================================================================
def members_console_settings_only():
    print('\nD7/286: opening the members console to change a setting leaves the TV alone; its button puts the board up; a closed console lets go')
    r = RIG.Rig(host_pages=('/app/members/host.html',))
    try:
        v = r.W.info['venue']
        r.db['vp_member_rosters'] = [{'id': 'ros-1', 'venue_id': v, 'name': 'Members'}]
        r.db['vp_members'] = [{'id': 'm1', 'roster_id': 'ros-1', 'member_number': 121, 'first_name': 'Willow', 'last_name': 'Mitchell', 'status': 'valid'}]
        r.db['vp_member_draws'] = [{'id': 'd1', 'venue_id': v, 'name': 'Members Draw', 'roster_id': 'ros-1', 'current_jackpot_cents': 20000,
                                    'draw_day': 'Friday', 'draw_time': '7:30pm', 'created_at': '2026-10-01T00:00:00Z', 'time_to_claim_seconds': 120}]
        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1280, height=720)
        ok('the TV loads on the ads', wall_is(r, tv, 'ads', 20), wall(r, tv))
        time.sleep(1.5)
        # the console's long timers (its 30 second heartbeat) run forty times fast, so a closed console is noticed in seconds
        mtid, mem = r.open('/app/members/host.html', before=SPY + 'window.__FAKE_LINE_WATCH=true; window.__down=false; window.__lineDown=function(){return window.__down===true;};', width=1000, height=1000)
        ok('the members console opens, signed in', r.until(mem, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True,
           r.ask(mem, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        time.sleep(6)
        ok('D7: OPENING the members console leaves the TV on the ads', wall(r, tv) == 'ads', wall(r, tv))
        ok('D7: and it claimed nothing as it connected', r.ask(mem, MODES) == '[]', r.ask(mem, MODES))
        r.ask(mem, 'document.querySelector(\'#styleChips button[data-style="flip"]\') && document.querySelector(\'#styleChips button[data-style="flip"]\').click(); true')
        come_back_to(r, mem); time.sleep(3)
        ok('D7: changing a setting and coming back to the tab takes nothing either', wall(r, tv) == 'ads' and r.ask(mem, MODES) == '[]', [wall(r, tv), r.ask(mem, MODES)])
        r.ask(tv, 'location.reload(); true'); time.sleep(1)
        wall_is(r, tv, 'ads', 20); time.sleep(6)
        ok('D7: a TV restarting while the console is open stays on the ads (its hello is not an invitation)', wall(r, tv) == 'ads' and r.ask(mem, MODES) == '[]', [wall(r, tv), r.ask(mem, MODES)])
        txt = tv_line(r, mem)
        ok('the console offers "Put the draws board on the TV" instead', 'Put the draws board on the TV' in (txt or ''), txt)
        ok('and no warning while nothing was asked of the TV', 'not showing' not in (txt or ''), txt)
        shot(r, mem, 'd7-1-members-console-quiet')
        r.ask(mem, 'document.querySelector("#tvLine .tvline-btn").click(); true')
        ok('the host taps it: the members board is on the TV', wall_is(r, tv, 'embed:members', 20), wall(r, tv))
        ok('an ordinary claim, not a force', '"members+claim"' in (r.ask(mem, MODES) or ''), r.ask(mem, MODES))
        ok('the quiet button goes once the board is up', r.until(mem, '(function(){var b=document.getElementById("tvLine"); return !b || b.classList.contains("hidden");})()', 45) is True, tv_line(r, mem))
        shot(r, tv, 'd7-2-board-on-tv')
        # A laptop lid closing: the console goes silent without a goodbye (its pagehide never runs).
        r.ask(mem, 'window.__down=true; try{ window.dispatchEvent(new Event("offline")); }catch(e){} true')
        ok('286: a console that goes silent (lid closed, no goodbye) hands the TV back to the ads by itself', wall_is(r, tv, 'ads', 100), wall(r, tv))
        r.ask(mem, 'window.__down=false; try{ window.dispatchEvent(new Event("online")); }catch(e){} true'); time.sleep(4)
        r.ask(mem, 'document.querySelector("#tvLine .tvline-btn") && document.querySelector("#tvLine .tvline-btn").click(); true')
        r.until(mem, '(function(){var b=document.getElementById("tvLine"); return !b || b.classList.contains("hidden") || /not showing/.test(b.innerText);})()', 10)
        ok('CONTROL: the board can be put back up', wall_is(r, tv, 'embed:members', 30), wall(r, tv))
        r.close_tab(mtid)
        ok('286: CLOSING the console hands the TV back to the ads', wall_is(r, tv, 'ads', 100), wall(r, tv))
        ok('no script errors on the TV', r.ask(tv, '(window.__errs||[]).length') == 0, r.ask(tv, 'JSON.stringify(window.__errs||[])'))
    finally:
        r.close()


# ======================================================================================
def finished_win_leaves():
    print('\n8b: a finished bingo winner leaves the phone and the TV after a while, and when another game takes the TV')
    r = RIG.Rig()
    try:
        ptid, phone = r.open('/play?room=' + r.W.info['code'], before=FAST + SHIFT, width=390, height=844)
        r.phone_ready(phone)
        r.ask(phone, 'window.__pid=null; window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new window.__BC(n); c.onmessage=function(e){ var m=e.data&&e.data.payload; if(m&&m.t==="join"&&m.pid) window.__pid=m.pid; }; } }); true')
        r.ask(phone, 'document.getElementById("nameIn").value="Dean"; document.getElementById("joinBtn").click(); true')
        ok('CONTROL: the phone joins', r.until(phone, vis('vWait'), 15) is True)
        time.sleep(1.5)
        pid = r.until(phone, 'window.__pid || localStorage.getItem("vp-pid-" + %s)' % json.dumps(r.W.info['code']), 8)
        say = lambda m: r.ask(phone, 'window.__say(%s)' % json.dumps(m))
        say({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': [1, 2, 3], 'active': True, 'session_id': 'sess-1', 'join_code': r.W.info['code']}); time.sleep(0.5)
        say({'t': 'winner', 'pid': 'someone-else', 'name': 'Sam', 'cardNo': 690, 'pattern': 'one', 'prize': 'Meat tray', 'winners': [{'pid': 'someone-else', 'name': 'Sam', 'cardNo': 690}], 'cont': False})
        ok('CONTROL: Sam won; the phone shows who won', r.until(phone, vis('vLost'), 8) is True)
        r.ask(phone, 'window.__shift=5*60*1000; true'); time.sleep(3)
        ok('five minutes on, still up (time to read it)', r.ask(phone, vis('vLost')) is True)
        r.ask(phone, 'window.__shift=11*60*1000; true')
        ok('8b: ten minutes after the game finished, the phone has left the bingo result', r.until(phone, '!(%s) && !(%s)' % (vis('vLost'), vis('vWon')), 12) is True,
           r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        ok('and is back to waiting for the host, still signed in as Dean', r.until(phone, vis('vWait'), 6) is True, r.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        shot(r, phone, '8b-1-phone-back-to-waiting')
        r.ask(phone, 'window.__shift=0; true')
        me = {'pid': pid, 'name': 'Dean', 'cardNo': 7}
        say({'t': 'started', 'pattern': 'one', 'prize': 'Bar tab'}); time.sleep(0.5)
        say({'t': 'winner', 'pid': pid, 'name': 'Dean', 'cardNo': 7, 'pattern': 'one', 'prize': 'Bar tab', 'winners': [me], 'cont': False})
        ok('CONTROL: the next game, Dean wins: YOU WON', r.until(phone, vis('vWon'), 8) is True)
        r.ask(phone, 'location.reload(); true'); time.sleep(1)
        ok('CONTROL: a reloaded phone still shows the win (saved for the walk to the host)', r.until(phone, vis('vWon'), 25) is True)
        r.ask(phone, 'window.__shift=11*60*1000; true')
        ok('8b: and the winner\'s screen leaves too once its ten minutes are up, reload or not', r.until(phone, '!(%s)' % vis('vWon'), 12) is True)
        ok('no script errors on the phone', r.ask(phone, '(window.__errs||[]).length') == 0, r.ask(phone, 'JSON.stringify(window.__errs||[])'))

        ttid, tv = r.open('/tv?venue=' + r.W.info['slug'], before=FAST + SHIFT, width=1280, height=720)
        wall_is(r, tv, 'ads', 20); time.sleep(1.5)
        tsay = lambda m: r.ask(tv, 'window.__say(%s)' % json.dumps(m))
        tsay({'t': 'mode', 'mode': 'bingo', 'caller': False}); time.sleep(0.3)
        tsay({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': [4, 8, 15], 'active': True, 'caller': False}); time.sleep(0.3)
        tsay({'t': 'winner', 'pid': 'p1', 'name': 'Sam', 'cardNo': 696, 'pattern': 'one', 'prize': 'Meat tray', 'winners': [{'pid': 'p1', 'name': 'Sam', 'cardNo': 696}], 'cont': False})
        ok('CONTROL: the TV shows the bingo winner', wall_is(r, tv, 'bingo:tvWin', 8), wall(r, tv))
        r.ask(tv, 'window.__shift=5*60*1000; true'); time.sleep(4)
        ok('five minutes on, the winner is still up', wall(r, tv) == 'bingo:tvWin', wall(r, tv))
        # The bingo console is still open (as Dean's was): its 30 second heartbeat keeps arriving, so the TV's
        # frozen-game reload never fires; only the finished win's own clock can take it down.
        r.ask(tv, 'window.__shift=11*60*1000; window.__beat=setInterval(function(){ window.__say({t:"host_here"}); }, 500); true')
        ok('8b: ten minutes after the finished win, the TV goes back to the ads by itself, console still open', wall_is(r, tv, 'ads', 10), wall(r, tv))
        r.ask(tv, 'clearInterval(window.__beat); true')
        r.ask(tv, 'window.__shift=0; true')
        tsay({'t': 'mode', 'mode': 'bingo', 'caller': False}); time.sleep(1.5)
        ok('and a later mode:"bingo" does not paint the old winner back', wall(r, tv) != 'bingo:tvWin', wall(r, tv))
        ok('no script errors on the TV', r.ask(tv, '(window.__errs||[]).length') == 0, r.ask(tv, 'JSON.stringify(window.__errs||[])'))
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('tv-takeover-12nov-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    global bad
    only = sys.argv[1:]
    for f in (finished_bingo_lets_the_raffle_on, live_bingo_kept_and_host_told, members_console_settings_only, finished_win_leaves):
        if only and f.__name__ not in only: continue
        try:
            f()
        except Exception:
            import traceback; traceback.print_exc(); bad += 1
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d of %d checks passed' % (ran - bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
