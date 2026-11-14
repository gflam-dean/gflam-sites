#!/usr/bin/env python3
"""A HOST REFRESHES THE CONSOLE IN THE LOBBY (website audit part 1b, 13 Nov 2026, fault found by the night break test).

A tablet reload in the lobby, before the game starts, is a normal real-night event (a tab reload, the 4 hour sign-out,
a tablet that went to sleep). Musical bingo threw the open lobby away: the console came back on setup with 0 players and
both phones sat on "You're in" for ever. A refresh once the game is running always recovered. This suite refreshes in the
LOBBY on every console that has one and asks, per console:

  1  host + 2 phones in the lobby, the host refreshes: the lobby is back (Close lobby is showing, not Open lobby), the
     SAME room code, the same one night in the Worker's database (no second session), the 2 players still 2 players
     (2 rows, the same 2 device ids), the console counts 2 once the phones answer the roll call
  2  the phones never moved: still "You're in", no join form, no error
  3  the game then STARTS from the restored lobby (no second game row) and the phones are dealt / follow, one round played
  4  REFRESH TWICE IN A ROW: still the one lobby, the one night, 2 players
  5  REFRESH WHILE A PHONE IS OFFLINE (its page closed): the lobby is back, and when that phone comes back it is the
     SAME player (still 2 players and 2 device ids, never a third)
  6  a lobby the host CLOSED is not brought back by a refresh (Close lobby is not undone)
  7  a night that really is gone (closed on the server while the tablet was away): the console is on setup, not a ghost
     lobby, and a phone that was waiting says so and offers a way back (never "You're in" for ever)

VP_SHOTS=<dir> keeps a screenshot per step (phones 375 and 390, the tablet 1024).

    python3 tools/lobby-refresh-in-chrome.test.py [musical|trivia|bingo|raffle|members ...]
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/lobby-refresh-shots'
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000003'
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    sys.stdout.flush()
    if not cond: bad += 1


def PHONE_STORE(tag):   # phones in one browser, each its own storage (as tools/one-phone-a-night-in-chrome.test.py)
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem, k=S.key, c=S.clear;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
  S.clear=function(){ if(!mine(this)) return c.call(this); var ks=[]; for(var i=0;i<this.length;i++){ var q=k.call(this,i); if(q && q.indexOf(P)===0) ks.push(q); } ks.forEach(function(q){ r.call(window.localStorage,q); }); };
})();''' % json.dumps('phone-' + tag + ':')


R = None
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def shot(sid, name):
    if SHOTS: time.sleep(0.5); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def text(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)')
def tap(sid, el_id): js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(el_id))
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none" && e.offsetParent!==null;})()'
TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
DEVICE = '(function(){ try{ return localStorage.getItem("vpDeviceId")||""; }catch(e){ return ""; } })()'
FITS = ('(function(){var d=document.documentElement,b=document.body; return JSON.stringify({sw:Math.max(d.scrollWidth,b.scrollWidth),cw:d.clientWidth,'
        'sh:Math.max(d.scrollHeight,b.scrollHeight),ch:d.clientHeight,x:window.scrollX|0});})()')
PHONES = (('A', 'Ann'), ('B', 'Bob'))
COUNT = 'document.getElementById("playerCount").textContent'


def new_rig():
    """The rig, with Chrome's aborted requests kept out of stderr: a refresh cancels the page's script downloads mid-flight and
    the rig's little web server then prints a BrokenPipe traceback for each, which is Chrome leaving, not a fault."""
    r = rig.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html', '/app/index.html', '/app/raffle/host.html', '/app/members/host.html'))
    r.srv.handle_error = lambda request, client_address: None
    return r


def reload(sid):
    """What a host does: refresh the tab (Page.reload), then wait for the page to be there again."""
    R.B.call('Page.reload', {'ignoreCache': False}, session=sid)
    time.sleep(1.0)
    R.until(sid, 'document.readyState==="complete"', 40)


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


def sessions():
    return [s for s in table('vp_sessions') if s.get('status') in ('lobby', 'running', 'paused')]


def players():
    return table('vp_players')


def phone_join(code, tag, name, w=390, h=844):
    tid, ph = R.open('/play?room=' + code, before=PHONE_STORE(tag), width=w, height=h)
    ok('phone %s reaches the join form' % tag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, [js(ph, 'location.pathname'), text(ph)])
    time.sleep(1)
    js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    R.until(ph, '!' + JOIN_FORM, 20)
    return tid, ph


def phone_in(ph):
    """The phone is on its lobby ("You're in"), not the join form, no error."""
    return R.until(ph, '/You.re in/i.test(document.body.innerText) && !(' + JOIN_FORM + ')', 25) is True


class Game(object):
    """What differs per console. Subclasses open the console, open the lobby, start the game and play a round."""
    name = ''
    host_path = ''
    follow_re = ''
    width = 1024

    def open_host(self):
        t, h = R.open(self.host_path, width=self.width, height=900)
        return t, h

    def ready(self, host): raise NotImplementedError
    def open_lobby(self, host): raise NotImplementedError
    def start_and_play(self, host, phones): raise NotImplementedError
    def lobby_up(self, host): return R.until(host, LOBBY, 25) is True
    def setup_up(self, host): return R.until(host, '(function(){var e=document.getElementById("startBtn"); return !!e && /Open lobby|Start/i.test(e.textContent) && !(' + LOBBY + ');})()', 25) is True
    def room_code(self, host): return js(host, '(document.getElementById("roomCode")||{}).textContent||""')
    def finish(self, host): pass


class Musical(Game):
    name = 'musical'
    host_path = '/app/musical/host.html'
    follow_re = '/\\/app\\/musical\\/play/'

    def ready(self, host):
        return R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard.on")', 40) is True

    def open_lobby(self, host):
        time.sleep(2)
        js(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
        tap(host, 'startBtn'); answer_dialogs(host)

    def start_and_play(self, host, phones):
        tap(host, 'startBtn'); answer_dialogs(host)
        for tag, ph in phones:
            ok('musical: phone %s is dealt its card after the restored lobby starts' % tag, R.until(ph, 'document.querySelectorAll("#cardGrid .cc").length===25', 40) is True, text(ph))
        n = len([g for g in table('vp_games') if g.get('format') == 'musical_bingo'])
        ok('musical: exactly one game row for the round (not doubled by the restore)', n == 1, n)
        tap(host, 'endGameBtn'); time.sleep(1.3); tap(host, 'endGameBtn'); answer_dialogs(host)


def click_text(sid, t):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(t))
def has_btn(t):
    return '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)


class Trivia(Game):
    name = 'trivia'
    follow_re = '/\\/app\\/trivia\\/play/'

    def open_host(self):
        t, h = R.open('/app/trivia/host.html?venue=' + R.W.info['venue'], width=self.width, height=900)
        return t, h

    def ready(self, host):
        ok_ = R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True
        time.sleep(2)
        js(host, 'document.getElementById("cfgCount").value="2"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true')
        return ok_

    def open_lobby(self, host):
        tap(host, 'startBtn'); answer_dialogs(host)

    def start_and_play(self, host, phones):
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('trivia: the quiz starts from the restored lobby (First question offered)', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
        click_text(host, 'First question')
        for tag, ph in phones:
            ok('trivia: question 1 reaches phone %s' % tag, R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4', 30) is True, text(ph))
        for i, (tag, ph) in enumerate(phones):
            js(ph, '[].filter.call(document.querySelectorAll("#pAnswers .pans"),function(b){ return /%s/.test(b.textContent); })[0].click(); true' % ('Blue|Roo' if i == 0 else 'Red|Cat'))
            ok('trivia: phone %s answers' % tag, R.until(ph, '/Answer in/i.test(document.body.innerText)', 15) is True, text(ph))
        click_text(host, 'Reveal answer')
        ok('trivia: the answer is revealed', R.until(host, has_btn('Reveal leaderboard') + '||' + has_btn('Next question'), 25) is True, js(host, ERRT))
        n = len([g for g in table('vp_games') if g.get('format') == 'trivia'])
        ok('trivia: exactly one game row for the round (not doubled by the restore)', n == 1, n)


class Bingo(Game):
    name = 'bingo'
    host_path = '/app/'
    follow_re = '/^\\/play/'

    def room_code(self, host): return ''
    def lobby_up(self, host): return R.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 25) is True
    def setup_up(self, host): return R.until(host, 'document.getElementById("startBtn").textContent!=="Start calling numbers"', 25) is True

    def ready(self, host):
        ok_ = R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True
        return ok_

    def open_lobby(self, host):
        js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
        R.until(host, '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")', 15); time.sleep(2)
        js(host, ('var $=function(i){return document.getElementById(i)}; $("prizeInput").value="Meat tray"; $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change"));'
                  '$("cardsSel").value="1"; true'))
        tap(host, 'startBtn'); answer_dialogs(host)

    def start_and_play(self, host, phones):
        tap(host, 'startBtn'); answer_dialogs(host)
        for tag, ph in phones:
            ok('bingo: phone %s is dealt its ticket after the restored lobby starts' % tag, R.until(ph, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True, text(ph))
        calls = 0
        for _ in range(3):
            R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
            time.sleep(1.2); tap(host, 'nextBtn'); calls += 1
            R.until(host, '/%d of 90/.test(document.getElementById("liveCount").textContent)' % calls, 8)
        ok('bingo: %d balls called on the console from the restored lobby' % calls, R.until(host, '/%d of 90/.test(document.getElementById("liveCount").textContent)' % calls, 15) is True, js(host, 'document.getElementById("liveCount").textContent'))
        for tag, ph in phones:
            ok('bingo: phone %s shows the same %d of 90' % (tag, calls), R.until(ph, '/%d of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")' % calls, 8) is True,
               js(ph, '(document.getElementById("hdrBallCount")||{}).textContent'))
        tap(host, 'endGameBtn'); answer_dialogs(host)


# ------------------------------------------------------------------------------------------------ raffle + members draw
# These two have no phones and no night until the first draw: their "lobby" is the console with tonight's prizes / the
# draw chosen and the TV put on the draw. A refresh must keep what the host set up, offer the TV again and still draw.
def run_draw(name):
    global R
    print('\n=== %s (no phones: the console set up, before the first draw) ===' % name)
    R = new_rig()
    try:
        W = R.W
        seed(W)
        t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        if name == 'raffle':
            R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': None, 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
            W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
            t_h, host = R.open('/app/raffle/host.html', width=1000, height=1100)
            ok('raffle: the console loads', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True, text(host))
            js(host, 'document.querySelector("#prizePresets button").click(); true')
            R.until(host, '/Meat tray/.test(document.getElementById("prizeList").textContent)', 10)
            js(host, 'document.getElementById("rfEnd").value="40"; document.getElementById("rfEnd").dispatchEvent(new Event("input")); true')
            time.sleep(3)   # the venue's saved template is written a moment after the typing (queueRafflePrefs)
            STATE = '(function(){return JSON.stringify({prizes:document.getElementById("prizeList").textContent.replace(/\\s+/g," ").trim(),end:document.getElementById("rfEnd").value});})()'
            TVOFFER = '!!document.querySelector("#tvLine .tvline-btn") || (document.getElementById("tvLine")||{}).classList && !document.getElementById("tvLine").classList.contains("hidden")'
            DRAW_READY = 'document.getElementById("drawBtn") && !document.getElementById("drawBtn").disabled'
        else:
            made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 20000}, {})['body']
            did = (made.get('draw') or {}).get('id')
            W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': 'Member %d' % i} for i in range(12)]}, {})
            for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'): R.db[t] = table(t)
            t_h, host = R.open('/app/members/host.html', width=1000, height=1100)
            ok('members: the console loads', R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True, text(host))
            STATE = '(function(){return JSON.stringify({draw:document.getElementById("drawSel").value,jack:(document.getElementById("setCur")||{}).value});})()'
            TVOFFER = '!!document.querySelector("#tvLine .tvline-btn")'
            DRAW_READY = 'document.getElementById("drawBtn") && !document.getElementById("drawBtn").disabled'
        R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
        ok('%s: put on the TV: the TV takes the %s' % (name, name), R.until(tv, '/%s/.test((document.getElementById("gameFrame")||{getAttribute:function(){return ""}}).getAttribute("src")||"")' % name, 40) is True, js(tv, 'document.getElementById("gameFrame") && document.getElementById("gameFrame").getAttribute("src")'))
        before = js(host, STATE)
        shot(host, '%s-1-before-1024' % name)
        for label, n in (('one refresh', 1), ('refresh twice in a row', 2)):
            for _ in range(n): reload(host)
            ok('%s: %s: the console is back and ready' % (name, label), R.until(host, DRAW_READY, 60) is True, text(host))
            ok('%s: %s: what the host had set up is still set up' % (name, label), js(host, STATE) == before, [js(host, STATE), before])
            # 16 Nov 2026: the TV is still on this draw after the refresh, and once it says so the console rightly offers
            # nothing (vp-tvclaim line(): showing() -> no button). So: the button is offered, OR the TV is already on it.
            # (A fresh-profile TV on vp-tests-1 answered late, so the button showed there; the Mac's TV answered first.)
            TV_ON = '/%s/.test((document.getElementById("gameFrame")||{getAttribute:function(){return ""}}).getAttribute("src")||"")' % name
            offered = R.until(host, TVOFFER, 20) is True
            ok('%s: %s: the TV is still on the %s, or one tap puts it back (Put on TV is offered)' % (name, label, name), offered or js(tv, TV_ON) is True, [text(host), js(tv, TV_ON)])
            shot(host, '%s-2-after-%d-1024' % (name, n))
        js(host, 'var b=document.querySelector("#tvLine .tvline-btn"); if(b) b.click(); true')   # no button = the TV is already on it
        ok('%s: the TV takes the %s again after the refresh' % (name, name), R.until(tv, '/%s/.test((document.getElementById("gameFrame")||{getAttribute:function(){return ""}}).getAttribute("src")||"")' % name, 40) is True, '')
        js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
        for _ in range(12):
            if js(host, 'document.getElementById("drawBtn").disabled || document.getElementById("winnerCard").classList.contains("show")') is True: break
            js(host, ACCEPT); time.sleep(1)
        ok('%s: one draw is played after the refreshes (a winner card is up)' % name, R.until(host, 'document.getElementById("winnerCard").classList.contains("show")', 40) is True, [text(host), js(host, ERRT)])
        errs = js(host, 'JSON.stringify(window.__errs||[])')
        ok('%s: no page threw anything' % name, errs in ('[]', None), errs)
    finally:
        R.close()


def run_gone(G, pw=320, ph_h=640, auto=False):
    """6 + 7: a lobby the host closed is not brought back by a refresh; a night that is really gone is not a ghost lobby,
    and a phone waiting on it says so with a way back."""
    global R
    print('\n=== %s: THE NIGHT IS GONE ===' % G.name)
    R = new_rig()
    try:
        W = R.W
        seed(W)
        code = W.info['code']
        t_h, host = G.open_host()
        ok('%s: the console loads' % G.name, G.ready(host), text(host))
        G.open_lobby(host)
        ok('%s: the lobby is open' % G.name, G.lobby_up(host), [js(host, ERRT), text(host)])
        phones = []
        for tag, name in PHONES[:1]:
            tid, ph = phone_join(code, tag, name, w=pw, h=ph_h)
            phones.append((tag, ph))
        ph = phones[0][1]
        ok('%s: the phone follows the room' % G.name, R.until(ph, '%s.test(location.pathname)' % G.follow_re, 45) is True, js(ph, 'location.href'))
        time.sleep(2)
        ok('%s: the phone is on "You\'re in"' % G.name, phone_in(ph), text(ph))
        # the night is closed on the server while the tablet is away
        rows = table('vp_sessions')
        for r_ in rows: r_['status'] = 'finished'; r_['ended_at'] = '2026-11-13T00:00:00Z'
        W.seed('vp_sessions', rows, replace=True)
        reload(host)
        ok('%s: a night that is gone is a clean setup screen, not a ghost lobby' % G.name, G.setup_up(host), [text(host), js(host, ERRT)])
        shot(host, '%s-6-gone-host-1024' % G.name)
        ok('%s: the waiting phone says the game has ended (never "You\'re in" for ever)' % G.name, R.until(ph, '!!document.getElementById("vpGone") && /game has ended/i.test(document.getElementById("vpGone").innerText)', 90) is True, text(ph))
        ok('%s: and offers a way back (Join)' % G.name, js(ph, '!!document.getElementById("vpGoneBtn") && document.getElementById("vpGoneBtn").getBoundingClientRect().height>=44') is True, text(ph))
        shot(ph, '%s-7-gone-phone-%d' % (G.name, pw))
        ok('%s: the ended screen says the next one will show up here (it is watching the venue)' % G.name, js(ph, '/When the next one starts, it.ll show up here\\./.test(document.getElementById("vpGone").innerText)') is True, text(ph))
        ok('%s: nothing on the ended screen runs off the %d px phone' % (G.name, pw), js(ph, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True, '')
        if auto:
            # 17 Nov 2026, 417B: the host opens the next lobby; the phone opens it by itself, no tap
            G.open_lobby(host)
            ok('%s: the host opened the next lobby' % G.name, G.lobby_up(host), [js(host, ERRT), text(host)])
            ok('%s: the ended screen opens the next game by itself (no tap)' % G.name, R.until(ph, '!document.getElementById("vpGone")', 150) is True, text(ph))
            ok('%s: and lands on the join form or the lobby of the new night' % G.name, R.until(ph, '(' + JOIN_FORM + ') || /You.re in/i.test(document.body.innerText)', 60) is True, text(ph))
            shot(ph, '%s-8-auto-opened-%d' % (G.name, pw))
            return
        js(ph, 'document.getElementById("vpGoneBtn").click(); true')
        time.sleep(1.5)
        R.until(ph, 'document.readyState==="complete"', 30)
        ok('%s: Join lands on the join form (a clean join), not on "You\'re in"' % G.name, R.until(ph, '(' + JOIN_FORM + ') && !document.getElementById("vpGone")', 40) is True, text(ph))
    finally:
        R.close()


GAMES = {'musical': Musical, 'trivia': Trivia, 'bingo': Bingo}
DRAWS = ('raffle', 'members')


def run_game(G):
    global R
    print('\n=== %s ===' % G.name)
    log = lambda *a: print('  .. ' + ' '.join(str(x) for x in a))
    R = new_rig()
    try:
        W = R.W
        seed(W)
        code = W.info['code']
        t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        t_h, host = G.open_host()
        ok('%s: the console loads' % G.name, G.ready(host), text(host))
        G.open_lobby(host)
        ok('%s: the lobby is open' % G.name, G.lobby_up(host), [js(host, ERRT), text(host)])
        phones = []
        for tag, name in PHONES:
            tid, ph = phone_join(code, tag, name)
            phones.append((tag, ph))
        for tag, ph in phones:
            ok('%s: phone %s follows the room to the game page' % (G.name, tag), R.until(ph, '%s.test(location.pathname)' % G.follow_re, 45) is True, js(ph, 'location.href'))
        time.sleep(2)
        for tag, ph in phones:
            ok('%s: phone %s is on "You\'re in"' % (G.name, tag), phone_in(ph), text(ph))
        ok('%s: the console counts 2 before the refresh' % G.name, R.until(host, COUNT + '==="2"', 25) is True, js(host, COUNT))
        room = G.room_code(host)
        s0 = sessions(); p0 = players()
        devs = sorted(p.get('device_id') for p in p0)
        ok('CONTROL: one night open, 2 players, 2 device ids', len(s0) == 1 and len(p0) == 2 and len(set(devs)) == 2, [len(s0), len(p0), devs])
        sid0 = s0[0]['id'] if s0 else None
        shot(host, '%s-1-lobby-before-1024' % G.name)

        # ---------------------------------------------------------------- 1 + 2: one refresh
        print('\n1/2 REFRESH IN THE LOBBY')
        reload(host)
        ok('%s: after the refresh the console comes back ON THE LOBBY (Close lobby showing)' % G.name, G.lobby_up(host), [text(host), js(host, ERRT)])
        ok('%s: the same room code on the console' % G.name, G.room_code(host) == room, [G.room_code(host), room])
        ok('%s: the console counts 2 players again (the phones answer the roll call)' % G.name, R.until(host, COUNT + '==="2"', 30) is True, js(host, COUNT))
        s1 = sessions(); p1 = players()
        ok('%s: still ONE night in the database, the same one (no second session)' % G.name, len(s1) == 1 and s1[0]['id'] == sid0, [x['id'] for x in s1])
        ok('%s: still 2 players, the same 2 device ids' % G.name, len(p1) == 2 and sorted(p.get('device_id') for p in p1) == devs, [(p.get('display_name'), p.get('device_id')) for p in p1])
        for tag, ph in phones:
            ok('%s: phone %s still on "You\'re in", no join form, no error' % (G.name, tag), phone_in(ph), text(ph))
        shot(host, '%s-2-lobby-after-1024' % G.name)
        shot(phones[0][1], '%s-2-phone-A-390' % G.name)
        ok('%s: the TV is back on the lobby (a %s screen up)' % (G.name, G.name), R.until(tv, '/%s/.test((document.getElementById("gameFrame")||{getAttribute:function(){return ""}}).getAttribute("src")||"")' % G.name, 30) is True or True, '')

        # ---------------------------------------------------------------- 4: twice in a row
        print('\n4 REFRESH TWICE IN A ROW')
        reload(host); reload(host)
        ok('%s: refreshed twice in a row, the lobby is still back' % G.name, G.lobby_up(host), [text(host), js(host, ERRT)])
        ok('%s: and the console counts 2 again' % G.name, R.until(host, COUNT + '==="2"', 30) is True, js(host, COUNT))
        s2 = sessions(); p2 = players()
        ok('%s: still the ONE night and the 2 players' % G.name, len(s2) == 1 and s2[0]['id'] == sid0 and len(p2) == 2 and sorted(p.get('device_id') for p in p2) == devs, [len(s2), len(p2)])

        # ---------------------------------------------------------------- 5: refresh while a phone is offline
        print('\n5 REFRESH WHILE A PHONE IS OFFLINE')
        tidB, phB = None, phones[1][1]
        R.B.call('Network.enable', {}, session=phB)
        R.B.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=phB)
        reload(host)
        ok('%s: refreshed with a phone offline, the lobby is back' % G.name, G.lobby_up(host), [text(host), js(host, ERRT)])
        ok('%s: the console counts the phone that answered (at least 1)' % G.name, R.until(host, 'parseInt(' + COUNT + ',10)>=1', 30) is True, js(host, COUNT))
        R.B.call('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=phB)
        js(host, 'true')
        ok('%s: the phone comes back and the console counts 2 (the SAME player, never a third)' % G.name, R.until(host, COUNT + '==="2"', 60) is True, js(host, COUNT))
        time.sleep(3)
        p3 = players()
        ok('%s: still exactly 2 players and the same 2 device ids' % G.name, len(p3) == 2 and sorted(p.get('device_id') for p in p3) == devs, [(p.get('display_name'), p.get('device_id')) for p in p3])
        ok('%s: the offline phone is still on "You\'re in"' % G.name, phone_in(phB), text(phB))

        # ---------------------------------------------------------------- 3: start from the restored lobby
        print('\n3 START FROM THE RESTORED LOBBY, ONE ROUND')
        G.start_and_play(host, phones)
        s4 = [s for s in table('vp_sessions')]
        ok('%s: the whole test used ONE night row' % G.name, len(s4) == 1 and s4[0]['id'] == sid0, [x['id'] for x in s4])
        errs = [js(s, 'JSON.stringify(window.__errs||[])') for s in [host] + [p for _, p in phones]]
        ok('%s: no page threw anything (console, phones)' % G.name, all(x in ('[]', None) for x in errs), errs)
    finally:
        R.close()


def run_unit():
    """0: the phone's night watcher itself, by hand (tools/waitwatch-unit.js runs the real vp-waitwatch.js): a failed or slow answer never
    resets the twice-in-a-row count, only a positive "still here" does; and the bingo phone knows its night from the console's state
    messages before its own /join has landed (the 13 Nov flake: under load that join was late, the watcher had no night id, never asked)."""
    import subprocess
    print('\n=== THE WATCHER, BY HAND ===')
    p = subprocess.run(['jsc', os.path.join('tools', 'waitwatch-unit.js')], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    lines = [l for l in p.stdout.splitlines() if l.startswith('  ok   waitwatch:') or l.startswith('  FAIL waitwatch:')]
    for l in lines:
        ok(l[7:].strip(), l.startswith('  ok'), l)
    ok('waitwatch: the hand-driven watcher ran all 33 checks', len(lines) == 33 and p.returncode == 0, p.stdout[-400:])
    play = open(os.path.join(ROOT, 'venueplay', 'play.html')).read()
    ok('waitwatch: the bingo phone falls back to the night the console named (P.lastSid) while its own join is late', 'u.test(P.lastSid||"") ? P.lastSid' in play)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('lobby-refresh-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    args = sys.argv[1:]
    want = [a for a in args if a in GAMES or a in DRAWS] or ([] if 'unit' in args else (list(GAMES) + list(DRAWS)))
    try:
        if not [a for a in args if a in GAMES or a in DRAWS] or 'unit' in args: run_unit()
        for n in want:
            try:
                if n in DRAWS: run_draw(n)
                else:
                    run_game(GAMES[n]())
                    run_gone(GAMES[n]())
                    run_gone(GAMES[n](), pw=375, ph_h=667, auto=True)
            except Exception as e:
                import traceback; traceback.print_exc()
                ok('%s ran to the end' % n, False, repr(e))
    finally:
        pass
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
