#!/usr/bin/env python3
"""A PHONE BACK FROM A DROPOUT IS BACK IN THE GAME, ON BOTH ROADS, PLAYED IN CHROME (job list row 60, 4 Nov 2026).

Dean's live test night, 1 Nov 2026, Test Alpha: his iPhone came back from a dropout on "Waiting for the host"
and got nothing more until reloaded. This plays the drop in a real browser, with the network taken away the
two ways a phone loses it:

  OFFLINE   DevTools offline emulation (Network.emulateNetworkConditions offline=true): every request fails,
            navigator.onLine is false, the page hears "offline" and later "online". Flight mode on Android,
            and on iOS when it says so.
  QUIET     the line goes and NOTHING says so: navigator.onLine stays true, no event, every request fails
            or hangs, and the room socket either goes half open (nothing passes, nothing says closed) or is
            told it closed (Wi-Fi gone). iOS at times, and a Wi-Fi to 4G hand-off always.
  AWAY      the app backgrounded (the page hidden), the line quiet and the socket dead underneath, then the
            page seen again.

Each on both roads:
  SUPABASE  the product default (vp-room.js DEFAULT_ON false): realtime is tools/browser-rig/fake-supabase.js,
            which loses its channel when the line goes (at once when the page says offline, after a missed
            heartbeat when it does not) and joins again when it is back, as supabase-js does.
  ROOM      ?roomserver=1 on every page: the REAL room server class and Worker routes
            (venueplay-backend/worker/venueplay-room.js) run in a window of their own in this Chrome, and each
            page's WebSocket and /room/* requests are carried to it over BroadcastChannel by a stand-in that
            honours the page's network exactly as above. Nothing else about the pages is changed.

Games: BINGO with the REAL console (app/index.html, signed in) and the REAL phone (play.html), the real game
Worker in jsc behind them (tools/browser-rig/rig.py); TRIVIA with the REAL phone (app/trivia/play.html) and
the real Worker's /snapshot, the console's question said into the room or the channel by this script.
(Musical bingo is played the same way, page for page, in tools/test-room-dropout-formats.js.)

What a punter sees is what is judged: within a few seconds of the signal coming back the phone is on its
card with every ball called while it was away (bingo), or on the question that is up NOW (trivia); never
"Waiting for the host"; the status says Connected; the next ball reaches it; and on the room the venue is
still in the room (one phone's bad signal never moves everyone). Before the fix, ROOM QUIET (socket closed,
40 s) leaves the bingo phone on Supabase alone, frozen, on "Waiting for the host", and the trivia phone on
Supabase alone, deaf to the next question: tools/prove-checks.py turns the fix back off and watches it go red.

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait for it) and never clears anybody else's.
Screenshots to $VP_SHOTS when set.

    VP_WAIT_LOCK=1800 python3 tools/room-dropout-in-chrome.test.py
"""
import json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

ROOT = os.path.dirname(HERE)
SHOTS = os.environ.get('VP_SHOTS', '')
ONLY = sys.argv[1:]          # scene names to run (e.g. room-quiet), for working on one; the gate runs them all
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def take_lock(tool='room-dropout-in-chrome'):
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine'):
            if gatelib.hold_lock_or_refuse(tool, wait_s=0):
                return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80]))
            return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(0.5)


# ---------------------------------------------------------------- the room server, in a window of its own
def room_source():
    """venueplay-room.js as a script: the same four changes the jsc rigs make (tools/rig-room-formats.js)."""
    s = open(os.path.join(ROOT, 'venueplay-backend/worker/venueplay-room.js'), encoding='utf-8').read()
    s = re.sub(r'^export \{[\s\S]*?\};?\s*$', '', s, flags=re.M)
    s = re.sub(r'^export ', '', s, flags=re.M)
    s = re.sub(r'^const ', 'var ', s, flags=re.M)
    s = re.sub(r'^class VenueRoom ', 'var VenueRoom = class VenueRoom ', s, count=1, flags=re.M)
    return s

ROOM_HOST = r'''(function(SRC){
  if (window.__ROOMHOST) return true;
  /* The Workers runtime's own Request, Response and WebSocketPair, as far as the room uses them. A browser's
     Response refuses status 101, so these are local to the room and nothing else on this page sees them. */
  function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; this.ok = this.status >= 200 && this.status < 300; this.webSocket = init && init.webSocket; this._json = body ? JSON.parse(body) : null; }
  Response.prototype.json = function () { return Promise.resolve(this._json); };
  function Request(url, init) {
    this.url = (url && typeof url === 'object') ? url.url : url;
    this.method = (init && init.method) || 'GET';
    var h = init && init.headers;
    this.headers = { get: function (k) { if (!h) return null; if (typeof h.get === 'function') return h.get(k); return h[k] || null; } };
    this._body = init && (init._body !== undefined ? init._body : init.body);
  }
  Request.prototype.json = function () { return Promise.resolve(JSON.parse(this._body || '{}')); };
  var bc = new BroadcastChannel('rig-room-net');
  function ServerSocket() { this.sid = null; this.att = null; this.tags = []; this.gone = false; this.local = null; }
  ServerSocket.prototype.serializeAttachment = function (o) { this.att = JSON.parse(JSON.stringify(o)); };
  ServerSocket.prototype.deserializeAttachment = function () { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; };
  ServerSocket.prototype.send = function (s) { if (this.gone) throw new Error('gone'); if (this.sid) bc.postMessage({ op: 'msg', sid: this.sid, data: s }); else if (this.local) this.local(s); };
  ServerSocket.prototype.close = function (code) { if (this.gone) return; this.gone = true; if (this.sid) bc.postMessage({ op: 'closed', sid: this.sid, code: code || 1000 }); };
  function WebSocketPair() { var s = new ServerSocket(); this[0] = { client: true, of: s }; this[1] = s; }
  eval(SRC);
  var ROOMS = {}, ENV = { ROOM_OFF: '' };
  ENV.ROOM = { idFromName: function (n) { return n; }, get: function (n) {
    if (!ROOMS[n]) {
      var sockets = [], store = new Map();
      var st = { storage: {
          get: function (k) { return Promise.resolve(store.has(k) ? store.get(k) : undefined); },
          put: function (k, v) { store.set(k, v); return Promise.resolve(); },
          list: function (o) { var m = new Map(); store.forEach(function (v, k) { if (k.indexOf((o && o.prefix) || '') === 0) m.set(k, v); }); return Promise.resolve(m); },
          delete: function (ks) { var c = 0; (Array.isArray(ks) ? ks : [ks]).forEach(function (k) { if (store.delete(k)) c++; }); return Promise.resolve(c); } },
        acceptWebSocket: function (ws, tags) { ws.tags = tags || []; sockets.push(ws); },
        getWebSockets: function (tag) { return sockets.filter(function (w) { return !w.gone && (!tag || w.tags.indexOf(tag) >= 0); }); } };
      ROOMS[n] = { obj: new VenueRoom(st, ENV), sockets: sockets, store: store };
    }
    var r = ROOMS[n];
    return { fetch: function (u, init) { return r.obj.fetch(typeof u === 'string' ? new Request(u, init) : u); } };
  } };
  function wjson(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }
  var BY = {};
  bc.onmessage = function (e) {
    var m = e.data || {};
    if (m.op === 'open') {
      handleRoomSocket(new Request(m.url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } }), ENV, wjson).then(function (res) {
        if (!res || res.status !== 101) { bc.postMessage({ op: 'refused', sid: m.sid, status: res && res.status }); return; }
        var srv = res.webSocket.of; srv.sid = m.sid;
        var name = new URL(m.url.replace(/^ws/, 'http')).searchParams.get('room');
        BY[m.sid] = { srv: srv, room: ROOMS[name] };
        bc.postMessage({ op: 'opened', sid: m.sid });
      });
    } else if (m.op === 'send') {
      var b = BY[m.sid]; if (!b || b.srv.gone) return;
      if (m.data === 'ping') { bc.postMessage({ op: 'msg', sid: m.sid, data: 'pong' }); return; }   // Cloudflare's auto-response
      b.room.obj.webSocketMessage(b.srv, m.data);
    } else if (m.op === 'close') {
      var c = BY[m.sid]; if (c) c.srv.gone = true;
    } else if (m.op === 'http') {
      var h = /\/room\/presence/.test(m.url) ? handleRoomPresence(new Request(m.url), ENV, wjson)
                                            : handleRoomHandover(new Request(m.url, { method: 'POST' }), ENV, wjson);
      h.then(function (r) { bc.postMessage({ op: 'http', rid: m.rid, status: r.status, body: r._json }); });
    }
  };
  var hosts = {};
  window.__ROOMHOST = {
    /* A console's message into a room, from a host socket of the room's own (the trivia console here). */
    say: function (name, obj) {
      var go = function () { ROOMS[name].obj.webSocketMessage(hosts[name], JSON.stringify(obj)); };
      if (hosts[name]) { go(); return true; }
      handleRoomSocket(new Request('https://game.venueplay.com.au/room/ws?room=' + name + '&role=host', { headers: { Upgrade: 'websocket' } }), ENV, wjson).then(function (res) {
        var srv = res.webSocket.of; srv.local = function () {}; hosts[name] = srv; go();
      });
      return true;
    },
    count: function (name, role) { var r = ROOMS[name]; return r ? r.sockets.filter(function (w) { return !w.gone && (!role || w.tags.indexOf(role) >= 0); }).length : 0; },
    handedOver: function (name) { var r = ROOMS[name]; return !!(r && r.store.get('ho') > Date.now()); }
  };
  return true;
})'''

# Every game page: its WebSocket and /room/* requests go to the room window, and both honour the page's line.
PAGE_NET = r'''(function(){
  window.__FAKE_LINE_WATCH = true;                 // tools/browser-rig/fake-supabase.js: lose the channel with the line
  /* A SOCKET THAT LIVED THROUGH NO LINE IS DEAD FOR GOOD, as one is after flight mode: still "open" to the
     page, nothing ever passing again (a77e3edb, the iPhone way). Only a socket the page opens afterwards works. */
  var _nd = false;
  Object.defineProperty(window, '__netDown', { configurable: true, get: function () { return _nd; },
    set: function (v) { _nd = !!v; if (_nd) zombify(); } });
  window.addEventListener('offline', function () { zombify(); });
  function zombify() { for (var k in socks) if (socks[k].readyState <= 1) socks[k].zombie = true; }
  function down() { return navigator.onLine === false || !!window.__netDown; }
  window.__lineDown = down;
  var bc = new BroadcastChannel('rig-room-net');
  var me = Math.random().toString(36).slice(2), n = 0, socks = {}, http = {}, rid = 0;
  function abs(u) { return new URL(String(u), location.href).href; }
  function FakeWS(url) {
    var self = this; this.url = url; this.readyState = 0; this.sid = me + '-' + (++n); socks[this.sid] = this;
    if (down()) { if (navigator.onLine === false) setTimeout(function () { self._die(1006); }, 30); return; }   // quiet: it hangs
    bc.postMessage({ op: 'open', sid: this.sid, url: abs(url) });
  }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  FakeWS.prototype.addEventListener = function () {};
  FakeWS.prototype.send = function (s) { if (this.readyState !== 1) throw new Error('InvalidStateError'); if (down() || this.zombie) return; bc.postMessage({ op: 'send', sid: this.sid, data: s }); };
  FakeWS.prototype.close = function () { if (this.readyState === 3) return; this.readyState = 3; bc.postMessage({ op: 'close', sid: this.sid }); var s = this; setTimeout(function () { if (s.onclose) s.onclose({ code: 1000 }); }, 5); };
  FakeWS.prototype._die = function (code) { if (this.readyState === 3) return; this.readyState = 3; bc.postMessage({ op: 'close', sid: this.sid }); if (this.onclose) this.onclose({ code: code || 1006 }); };
  bc.onmessage = function (e) {
    var m = e.data || {};
    if (m.op === 'http') { var h = http[m.rid]; if (h) { delete http[m.rid]; if (!down()) h(m); } return; }
    var s = socks[m.sid]; if (!s || s.zombie) return;
    if (m.op === 'opened') { if (down() || s.readyState !== 0) return; s.readyState = 1; if (s.onopen) s.onopen({}); }
    else if (m.op === 'refused') { s._die(1006); }
    else if (m.op === 'msg') { if (down() || s.readyState !== 1) return; if (s.onmessage) s.onmessage({ data: m.data }); }
    else if (m.op === 'closed') { if (down() || s.readyState === 3) return; s.readyState = 3; if (s.onclose) s.onclose({ code: m.code }); }
  };
  window.__killSockets = function () { for (var k in socks) socks[k]._die(1006); return true; };
  window.__openSockets = function () { var c = 0; for (var k in socks) if (socks[k].readyState === 1) c++; return c; };
  window.WebSocket = FakeWS;
  var realFetch = window.fetch.bind(window);
  window.fetch = function (u, init) {
    var url = String((u && u.url) || u);
    if (window.__netDown) return new Promise(function (res, rej) { setTimeout(function () { rej(new TypeError('Load failed')); }, /\/room\//.test(url) ? 60000 : 3000); });
    if (/\/__worker\/room\/(presence|handover)/.test(url)) {
      if (navigator.onLine === false) return Promise.reject(new TypeError('Failed to fetch'));
      return new Promise(function (res) {
        var id = me + '-h' + (++rid);
        http[id] = function (m) { res({ status: m.status, ok: m.status >= 200 && m.status < 300, json: function () { return Promise.resolve(m.body); }, text: function () { return Promise.resolve(JSON.stringify(m.body)); } }); };
        bc.postMessage({ op: 'http', rid: id, url: abs(url) });
      });
    }
    return realFetch(u, init);
  };
})();'''


# ---------------------------------------------------------------- the line
def offline(r, sid, on):
    r.B.call('Network.enable', {}, session=sid)
    r.B.call('Network.emulateNetworkConditions', {'offline': bool(on), 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=sid)

def quiet(r, sid, on, close=False):
    r.ask(sid, 'window.__netDown=%s; %s true' % ('true' if on else 'false', 'window.__killSockets();' if (on and close) else ''))

def hidden(r, sid, on):
    """The app in the background, as the page sees it: visibilityState hidden and the event, then visible again."""
    r.ask(sid, ('Object.defineProperty(document,"visibilityState",{configurable:true,get:function(){return %s;}});'
                'Object.defineProperty(document,"hidden",{configurable:true,get:function(){return %s;}});'
                'document.dispatchEvent(new Event("visibilitychange")); true') % (('"hidden"', 'true') if on else ('"visible"', 'false')))


def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

VIEWS_BINGO = '(function(){var v=["vNoRoom","vJoin","vWait","vCard","vWon","vLost","vPaper"];for(var i=0;i<v.length;i++){var e=document.getElementById(v[i]);if(e&&!e.classList.contains("hidden"))return v[i];}return "";})()'
VIEWS_TRIVIA = '(function(){var v=["vNoRoom","vJoin","vWait","vQ","vRes","vFinal","vPR"];for(var i=0;i<v.length;i++){var e=document.getElementById(v[i]);if(e&&!e.classList.contains("hidden"))return v[i];}return "";})()'
STATUS = '((document.getElementById("statusText")||{}).textContent||"")'
ROAD = '(document.documentElement.getAttribute("data-vp-transport")||"")'
PHONE_CALLED = '(function(){var e=document.querySelector("#lastCalled .lcsub");var m=e&&/(\\d+) of 90/.exec(e.textContent);return m?+m[1]:0;})()'
HOST_CALLED = '(function(){var m=/(\\d+) of 90/.exec(document.getElementById("liveCount").textContent);return m?+m[1]:0;})()'
ONETAB_SETTLED = '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")'


def setup(room):
    """A rig, the room window, and the stand-in on every page opened after it."""
    import rig as RIG
    r = RIG.Rig()
    tid, rh = r.open('/__blank')
    ok('CONTROL: the room server runs in its own window', r.ask(rh, ROOM_HOST + '(%s)' % json.dumps(room_source()), 20) is True, r.ask(rh, 'typeof window.__ROOMHOST'))
    return r, rh

def open_page(r, path, **kw):
    return r.open(path, before=PAGE_NET, **kw)


# ---------------------------------------------------------------- bingo: the real console and the real phone
def bingo_night(r, room):
    flag = '&roomserver=1' if room else ''
    code = r.W.info['code']
    ptid, ph = open_page(r, '/play?room=' + code + flag, width=390, height=844)
    ok('CONTROL: the phone is ready for a name', r.phone_ready(ph) is True, r.ask(ph, VIEWS_BINGO))
    r.ask(ph, 'document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
    htid, host = open_page(r, '/app/' + ('?roomserver=1' if room else ''), width=1024, height=768)
    r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40)
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20); r.until(host, ONETAB_SETTLED, 10)
    r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                 '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
    r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 25)
    time.sleep(4)                   # the lobby takes a tap only once it has settled (tools/console-in-chrome.test.py does the same)
    for _ in range(3):
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        if r.until(host, '!document.getElementById("liveBlock").classList.contains("hidden")', 15) is True: break
    dealt = r.until(ph, VIEWS_BINGO + '==="vCard"', 60)
    ok('CONTROL: the game is on and the phone holds its ticket', dealt is True, [r.ask(ph, VIEWS_BINGO), r.ask(ph, STATUS)])
    for _ in range(3): call(r, host)
    road = 'room' if room else 'supabase'
    ok('CONTROL: both pages are on the %s road' % road, r.until(ph, ROAD + '===%s' % json.dumps(road), 15) is True and r.ask(host, ROAD) == road, [r.ask(ph, ROAD), r.ask(host, ROAD)])
    ok('CONTROL: the phone has every ball so far', r.until(ph, PHONE_CALLED + '===' + str(r.ask(host, HOST_CALLED)), 10) is True, [r.ask(ph, PHONE_CALLED), r.ask(host, HOST_CALLED)])
    return ph, host, ptid, htid

def call(r, host):
    """Next number, as the host taps it: a tap that lands while the last ball is still settling (VP_HOLD) is
    let go by the console, so the host taps again, every 2 s, until the number is up."""
    before = r.ask(host, HOST_CALLED) or 0
    for _ in range(8):
        r.ask(host, 'setTimeout(function(){ document.getElementById("nextBtn").click(); }, 0); true')
        if r.until(host, HOST_CALLED + '>' + str(before), 2) is True: return

def bingo_back(r, ph, host, label, within, room):
    """After the signal is back: the card, every ball, Connected, within `within` s; the next ball; the road."""
    want = r.ask(host, HOST_CALLED)
    t0 = time.time()
    got = r.until(ph, '%s==="vCard" && %s===%d && %s==="Connected"' % (VIEWS_BINGO, PHONE_CALLED, want, STATUS), within)
    took = time.time() - t0
    print('       (%s: %s)' % (label, ('back on its card with all %d balls, %.1f s after the signal' % (want, took)) if got is True else 'NOT back within %d s' % within))
    ok('%s: within %d s the phone is on its card with every ball called while it was away, and says Connected' % (label, within), got is True,
       {'view': r.ask(ph, VIEWS_BINGO), 'status': r.ask(ph, STATUS), 'phone': r.ask(ph, PHONE_CALLED), 'host': want, 'road': r.ask(ph, ROAD)})
    ok('%s: and it is not on "Waiting for the host"' % label, r.ask(ph, STATUS) != 'Waiting for the host' and r.ask(ph, VIEWS_BINGO) != 'vWait', r.ask(ph, STATUS))
    call(r, host)
    n = r.ask(host, HOST_CALLED)
    ok('%s: the next ball reaches it' % label, r.until(ph, PHONE_CALLED + '===' + str(n), 8) is True, [r.ask(ph, PHONE_CALLED), n])
    if room:
        ok('%s: it is back in the room, and the console never left it' % label, r.ask(ph, ROAD) == 'room' and r.ask(host, ROAD) == 'room', [r.ask(ph, ROAD), r.ask(host, ROAD)])

def bingo_scene(name, room, how, secs, within):
    if ONLY and name not in ONLY: return
    print('\nBINGO, %s ROAD: %s' % ('ROOM' if room else 'SUPABASE', name))
    r, rh = setup(room)
    try:
        ph, host, ptid, htid = bingo_night(r, room)
        if how == 'offline': offline(r, ph, True)
        elif how == 'quiet-close': quiet(r, ph, True, close=True)
        elif how == 'quiet': quiet(r, ph, True)
        elif how == 'away': hidden(r, ph, True); quiet(r, ph, True)
        t_end = time.time() + secs
        n0 = r.ask(host, HOST_CALLED)
        while True:                 # at least one ball while it is away: a short drop lasts until that ball has landed
            call(r, host)
            if time.time() >= t_end: break
            time.sleep(max(0, min(3, t_end - time.time())))
        missed = (r.ask(host, HOST_CALLED) or 0) - (n0 or 0)
        ok('%s CONTROL: the %d balls called while it was away did not reach it' % (name, missed), r.ask(ph, PHONE_CALLED) < r.ask(host, HOST_CALLED),
           [r.ask(ph, PHONE_CALLED), r.ask(host, HOST_CALLED)])
        shot(r, ph, 'room-dropout-%s-away' % name)
        if how == 'offline': offline(r, ph, False)
        elif how in ('quiet', 'quiet-close'): quiet(r, ph, False)
        elif how == 'away': quiet(r, ph, False); hidden(r, ph, False)
        bingo_back(r, ph, host, name, within, room)
        shot(r, ph, 'room-dropout-%s-back' % name)
        if room:
            code = r.W.info['code']
            ok('%s: one phone\'s signal did not move the venue off the room' % name, r.ask(rh, '!window.__ROOMHOST.handedOver("vp-%s")' % code) is True)
        ok('%s: no script errors on the phone or the console' % name, r.ask(ph, 'window.__errs.length') == 0 and r.ask(host, 'window.__errs.length') == 0,
           [r.ask(ph, 'JSON.stringify(window.__errs)'), r.ask(host, 'JSON.stringify(window.__errs)')])
    finally:
        r.close()


# ---------------------------------------------------------------- trivia: the real phone, the real Worker's snapshot
SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1'
G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
QS = [('Which colour is the sky?', ['Red', 'Green', 'Blue', 'Gold']), ('How many legs on a spider?', ['Six', 'Eight', 'Ten', 'Four']),
      ('Capital of Australia?', ['Sydney', 'Canberra', 'Perth', 'Hobart'])]

def trivia_question(r, seq):
    ends = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() + 3600 * 24 * 400))
    r.W.seed('vp_trivia_games', [{'game_id': G1, 'question_set_id': SET, 'current_seq': seq, 'phase': 'asking', 'question_ends_at': ends}], replace=True)

def trivia_say(r, rh, con, room, msg):
    code = r.W.info['code']
    if room:
        r.ask(rh, 'window.__ROOMHOST.say(%s,%s)' % (json.dumps('vp-' + code), json.dumps(msg)))
    else:
        r.ask(con, '(function(c,p){var b=new BroadcastChannel("fake-rt:vp-"+c);b.postMessage({event:"msg",payload:p});setTimeout(function(){b.close();},500);return true;})(%s,%s)' % (json.dumps(code), json.dumps(msg)))

def ask_q(r, rh, con, room, seq):
    trivia_question(r, seq)
    text, opts = QS[seq - 1]
    trivia_say(r, rh, con, room, {'t': 'question', 'fmt': 'trivia', 'game_id': G1, 'session_id': S1, 'qseq': seq, 'qi': seq, 'qtotal': 3,
                                  'text': text, 'options': opts, 'endsAt': int(time.time() * 1000) + 600000, 'secs': 600})

ON_Q = lambda seq: '%s==="vQ" && (document.getElementById("pqText")||{}).textContent===%s && document.querySelectorAll("#pAnswers .pans").length===4' % (VIEWS_TRIVIA, json.dumps(QS[seq - 1][0]))

def trivia_scene(name, room, how, secs, within):
    if ONLY and name not in ONLY: return
    print('\nTRIVIA, %s ROAD: %s' % ('ROOM' if room else 'SUPABASE', name))
    r, rh = setup(room)
    try:
        code = r.W.info['code']
        r.W.seed('vp_questions', [{'id': 'q-%d' % (i + 1), 'set_id': SET, 'seq': i + 1, 'question': QS[i][0], 'text': QS[i][0], 'options': QS[i][1], 'correct_index': 1} for i in range(3)])
        r.W.seed('vp_sessions', [{'id': S1, 'venue_id': r.W.info['venue'], 'status': 'running', 'join_code': code, 'lobby_format': 'trivia', 'created_at': '2026-11-04T09:00:00Z'}])
        r.W.seed('vp_games', [{'id': G1, 'session_id': S1, 'seq': 1, 'format': 'trivia', 'status': 'running', 'config': {'question_seqs': [1, 2, 3]}}])
        trivia_question(r, 1)
        ptid, ph = open_page(r, '/app/trivia/play.html?room=' + code + ('&roomserver=1' if room else ''), width=390, height=844)
        ctid, con = r.open('/__blank')
        ok('CONTROL: the trivia phone is ready for a team name', r.phone_ready(ph) is True, r.ask(ph, VIEWS_TRIVIA))
        r.ask(ph, 'document.getElementById("nameIn").value="Quiz Kids"; document.getElementById("joinBtn").click(); true')
        ok('CONTROL: it joins and is on question 1', r.until(ph, ON_Q(1), 25) is True, [r.ask(ph, VIEWS_TRIVIA), r.ask(ph, '(document.getElementById("pqText")||{}).textContent')])
        road = 'room' if room else 'supabase'
        ok('CONTROL: it is on the %s road' % road, r.until(ph, ROAD + '===%s' % json.dumps(road), 15) is True, r.ask(ph, ROAD))
        if room:
            r.until(rh, 'window.__ROOMHOST.count("vp-%s","phone")>0' % code, 10)
        time.sleep(12)             # a socket that has heard a pong or two, as a real one would have
        if how == 'offline': offline(r, ph, True)
        elif how == 'quiet-close': quiet(r, ph, True, close=True)
        time.sleep(secs / 2.0)
        ask_q(r, rh, con, room, 2)
        time.sleep(secs / 2.0)
        ok('%s CONTROL: question 2 went up while it was away and did not reach it' % name, r.ask(ph, ON_Q(2)) is not True, r.ask(ph, '(document.getElementById("pqText")||{}).textContent'))
        if how == 'offline': offline(r, ph, False)
        else: quiet(r, ph, False)
        t0 = time.time()
        got = r.until(ph, ON_Q(2), within)
        print('       (%s: %s)' % (name, ('on question 2, %.1f s after the signal' % (time.time() - t0)) if got is True else 'NOT on question 2 within %d s' % within))
        ok('%s: within %d s the phone is on the question that is up NOW, with its answer buttons' % (name, within), got is True,
           {'view': r.ask(ph, VIEWS_TRIVIA), 'q': r.ask(ph, '(document.getElementById("pqText")||{}).textContent'), 'road': r.ask(ph, ROAD), 'status': r.ask(ph, STATUS)})
        shot(r, ph, 'room-dropout-%s-back' % name)
        ask_q(r, rh, con, room, 3)
        ok('%s: and the console\'s next question reaches it' % name, r.until(ph, ON_Q(3), 10) is True, [r.ask(ph, '(document.getElementById("pqText")||{}).textContent'), r.ask(ph, ROAD)])
        if room:
            ok('%s: back in the room, and the venue never moved' % name, r.ask(ph, ROAD) == 'room' and r.ask(rh, '!window.__ROOMHOST.handedOver("vp-%s")' % code) is True, r.ask(ph, ROAD))
        ok('%s: no script errors on the phone' % name, r.ask(ph, 'window.__errs.length') == 0, r.ask(ph, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


if __name__ == '__main__':
    if not take_lock():
        sys.exit(2)
    scenes = [
        lambda: bingo_scene('room-quiet', True, 'quiet-close', 40, 8),        # the 1 Nov fault: red before the fix
        lambda: trivia_scene('trivia-room-quiet', True, 'quiet-close', 40, 8),
        lambda: bingo_scene('room-offline', True, 'offline', 25, 8),
        lambda: bingo_scene('room-wifi-switch', True, 'quiet-close', 3, 8),
        lambda: bingo_scene('room-away', True, 'away', 30, 10),
        lambda: bingo_scene('supabase-offline', False, 'offline', 25, 12),
        lambda: bingo_scene('supabase-quiet', False, 'quiet', 40, 12),
        lambda: trivia_scene('trivia-supabase-offline', False, 'offline', 25, 12),
    ]
    for s in scenes:
        try:
            s()
        except Exception:
            import traceback; traceback.print_exc(); bad += 1
    print('\n%d of %d checks passed' % (ran - bad, ran))
    sys.exit(1 if bad else 0)
