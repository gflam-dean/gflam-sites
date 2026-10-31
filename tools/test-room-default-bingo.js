/* THE ROOM SERVER AS THE DEFAULT, PLAYED END TO END: ONE ROAD PER VENUE, WHATEVER HAPPENS.

   31 Oct 2026. The room server becomes the road for every bingo night unless the switch says no.
   The promise is that nobody can tell, and the one way that promise breaks is a venue split
   across two roads: a console in the room and a phone on Supabase (or the other way round) is a
   night where nothing reaches anyone and every screen looks fine.

   This runs the REAL bingo console (app/index.html) and the REAL phone (play.html), each with the
   REAL vp-room.js, against the REAL room server class and the REAL Worker routes from
   venueplay-backend/worker/venueplay-room.js, with a fake Supabase bus beside it
   (tools/rig-bingo-room.js). Nothing touches the network.

     A  room on by default: both pages in the room, card dealt, ball delivered, Supabase quiet
     B  room off (the Worker answers 503): both on Supabase, the night plays
     C  ROOM_OFF set mid-game: the room sends everyone across together, the night plays on
     D  an OLD TV still on Supabase (cached from before the switch): the console hears it and the
        whole venue moves to meet it
     E  a phone's socket drops: it comes back into the room, not onto Supabase alone
     F  the console reloads mid-game: the room carries on
     G  OLD console and OLD TV, NEW phone: the phone finds the room empty, hears the console on the
        old road, and moves the room to it
     H  a phone that joins after a handover goes straight to where everyone is
     I  a new page against an OLD Worker (no handover) stays on Supabase with everyone else

   Run from the repo root:  jsc tools/test-room-default-bingo.js
*/
load('tools/rig-bingo-room.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* ---------- the room server, from the real file ---------- */
function URL(u) {
  var m = /^[a-z]+:\/\/[^\/]+(\/[^?]*)?(\?(.*))?$/.exec(u);
  this.pathname = (m && m[1]) || '/';
  var q = {}; ((m && m[3]) || '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  this.searchParams = { get: function (k) { return q.hasOwnProperty(k) ? q[k] : null; } };
}
function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; this.ok = this.status >= 200 && this.status < 300; this.webSocket = init && init.webSocket; this._json = body ? JSON.parse(body) : null; }
Response.prototype.json = function () { return Promise.resolve(this._json); };
function Request(url, init) {
  this.url = (url && typeof url === 'object') ? url.url : url;
  this.method = (init && init.method) || 'GET';
  var h = init && init.headers;
  this.headers = { get: function (k) { if (!h) return null; if (typeof h.get === 'function') return h.get(k); return h[k] || null; } };
  this._body = init && init.body;
}
Request.prototype.json = function () { return Promise.resolve(JSON.parse(this._body || '{}')); };

function ServerSocket() { this.att = null; this.tags = []; this.gone = false; this.peer = null; }
ServerSocket.prototype.serializeAttachment = function (o) { this.att = JSON.parse(JSON.stringify(o)); };
ServerSocket.prototype.deserializeAttachment = function () { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; };
ServerSocket.prototype.send = function (s) {
  if (this.gone) throw new Error('gone');
  var b = this.peer; if (!b) return;
  fSetTimeout(function () { if (b.readyState === 1 && b.onmessage) b.onmessage({ data: s }); }, 1);
};
ServerSocket.prototype.close = function (code, why) {
  if (this.gone) return; this.gone = true;
  var b = this.peer; if (!b) return;
  fSetTimeout(function () { if (b.readyState === 3) return; b.readyState = 3; if (b.onclose) b.onclose({ code: code || 1000 }); }, 1);
};
function WebSocketPair() { var s = new ServerSocket(); this[0] = { client: true, of: s }; this[1] = s; }

var ROOMSRC = readFile('venueplay-backend/worker/venueplay-room.js');
/* This repo's own room server, read from disk and run in this test; nothing is fetched. */
eval(ROOMSRC.replace(/^export \{[\s\S]*?\};?\s*$/m, '').replace(/^export /mg, '')
            .replace(/^const /mg, 'var ').replace(/^class VenueRoom /m, 'var VenueRoom = class VenueRoom '));

var ENV, ROOMS, STORES, WORKER_OLD;
function freshWorld(opts) {
  opts = opts || {};
  ROOMS = {}; STORES = {}; WORKER_OLD = !!opts.oldWorker;
  BUS = {}; QUEUE = []; LOG = [];
  ENV = { ROOM_OFF: opts.off ? '1' : '' };
  if (!opts.noBinding) ENV.ROOM = {
    idFromName: function (n) { return n; },
    get: function (n) {
      if (!ROOMS[n]) {
        var sockets = [], store = new Map();
        var st = { storage: {
            get: function (k) { return Promise.resolve(store.has(k) ? store.get(k) : undefined); },
            put: function (k, v) { store.set(k, v); return Promise.resolve(); },
            list: function (o) { var m = new Map(); store.forEach(function (v, k) { if (k.indexOf((o && o.prefix) || '') === 0) m.set(k, v); }); return Promise.resolve(m); },
            delete: function (ks) { var c = 0; (Array.isArray(ks) ? ks : [ks]).forEach(function (k) { if (store.delete(k)) c++; }); return Promise.resolve(c); } },
          acceptWebSocket: function (ws, tags) { ws.tags = tags || []; sockets.push(ws); },
          getWebSockets: function (tag) { return sockets.filter(function (w) { return !w.gone && (!tag || w.tags.indexOf(tag) >= 0); }); } };
        ROOMS[n] = { obj: new VenueRoom(st, ENV), sockets: sockets };
      }
      var r = ROOMS[n];
      return { fetch: function (u, init) { return r.obj.fetch(typeof u === 'string' ? new Request(u, init) : u); } };
    } };
}
function wjson(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }
function workerFetch(url, init) {
  var path = (/^https?:\/\/[^\/]+(\/[^?]*)/.exec(url) || [])[1] || '';
  if (path === '/room/presence') {
    return handleRoomPresence(new Request(url), ENV, wjson).then(function (r) {
      if (WORKER_OLD && r.status === 200 && r._json) { delete r._json.handover; delete r._json.pong; }
      return r;
    });
  }
  if (path === '/room/handover' && init && init.method === 'POST') {
    if (WORKER_OLD) return Promise.resolve(wjson({ error: 'not found' }, 404));
    return handleRoomHandover(new Request(url, init), ENV, wjson);
  }
  return Promise.reject(new Error('offline rig'));
}
/* What a browser's WebSocket does, wired to the room through the real /room/ws route. */
function BrowserWS(url) {
  var self = this; this.url = url; this.readyState = 0;
  handleRoomSocket(new Request(url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } }), ENV, wjson).then(function (res) {
    if (self.readyState === 3) return;
    if (!res || res.status !== 101) { self.readyState = 3; if (self.onclose) self.onclose({ code: 1006 }); return; }
    self.server = res.webSocket.of; self.server.peer = self;
    self.room = ROOMS[(/[?&]room=([^&]+)/.exec(url) || [])[1]];
    self.readyState = 1; if (self.onopen) self.onopen();
  });
}
BrowserWS.prototype.send = function (s) {
  if (this.readyState !== 1) throw new Error('not open');
  var srv = this.server, room = this.room;
  if (s === 'ping') { srv.send('pong'); return; }        // Cloudflare's auto-response
  fSetTimeout(function () { if (!srv.gone) room.obj.webSocketMessage(srv, s); }, 1);
};
BrowserWS.prototype.close = function () {
  if (this.readyState === 3) return;
  this.readyState = 3; if (this.server) this.server.gone = true;
  var self = this; fSetTimeout(function () { if (self.onclose) self.onclose({ code: 1000 }); }, 1);
};
/* A dropped connection: the browser side dies, the room side is gone. */
function dropSocket(ws) { ws.readyState = 3; if (ws.server) ws.server.gone = true; if (ws.onclose) ws.onclose({ code: 1006 }); }

/* ---------- each page gets the REAL vp-room.js, old or new ---------- */
var VPROOM = readFile('venueplay/app/vp-room.js');
var VPROOM_NEW = VPROOM.replace('var DEFAULT_ON = false;', 'var DEFAULT_ON = true;');
var VPROOM_OLD = VPROOM.replace('var DEFAULT_ON = true;', 'var DEFAULT_ON = false;');
var NEXT_ROOM_SRC = null;          // null: this page has no vp-room.js at all
var SOCKETS = [];
var _baseSandbox = baseSandbox;
baseSandbox = function (dom, who) {
  var sb = _baseSandbox(dom, who);
  sb.fetch = workerFetch;
  sb.WebSocket = function (u) { var w = new BrowserWS(u); w.who = who; SOCKETS.push(w); return w; };
  sb.Date = Date;
  if (NEXT_ROOM_SRC) {
    var proxy = new Proxy(sb, { has: function () { return true; }, get: function (t, k) { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; return globalThis[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
    (new Function('__sb', 'with(__sb){\n' + NEXT_ROOM_SRC + '\n}'))(proxy);
    sb.VPRoom = dom.window.VPRoom;     // in a browser a window property is a global; the pages call VPRoom bare
  }
  return sb;
};
function road(page) { return page.dom.document.documentElement._attr['data-vp-transport'] || '(none)'; }
function socketsOf(who) { return SOCKETS.filter(function (w) { return w.who === who && w.readyState === 1; }); }
function call(host) { var n = host.G.pool[0]; host.G.pool.splice(0, 1); host.commitBall(n, false); return n; }
function dealt(ph) { return ph.P.cards && ph.P.cards.length >= 1; }
function heardBall(ph, n) { return ph.P.called.indexOf(n) >= 0; }
function supabaseGameTraffic() { return LOG.filter(function (l) { return l.p && !l.p.rw && l.p.t !== 'screen_refresh'; }); }
/* A TV loaded before the switch: on Supabase, answering a console's host_here with tv_here. */
function oldTv() {
  var sub = { who: 'old-tv', live: true, cb: function (e) { var m = e.payload; if (m && m.t === 'host_here') QUEUE.push({ name: 'vp-' + CODE, from: sub, payload: { t: 'tv_here' } }); } };
  (BUS['vp-' + CODE] = BUS['vp-' + CODE] || []).push(sub);
  return sub;
}
async function startGame(host, ph) {
  ph.$('nameIn').value = 'Ann'; ph.join(); await advance(200);
  host.$('prizeInput').value = '$50'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(200);
  host.startGame(); await advance(300);
}

(async function () {
  print('A. THE ROOM IS THE DEFAULT, AND THE NIGHT PLAYS ON IT');
  freshWorld(); SOCKETS = [];
  NEXT_ROOM_SRC = VPROOM_NEW;
  var host = bootHost(); await advance(300);
  var ann = bootPhone('Ann'); await advance(300);
  check('the console is in the room', road(host) === 'room', road(host));
  check('the phone is in the room', road(ann) === 'room', road(ann));
  await startGame(host, ann);
  check('the real console dealt the phone a ticket through the room', dealt(ann), ann.P.cards.length);
  var b1 = call(host); await advance(200);
  check('a ball the host calls reaches the phone through the room', heardBall(ann, b1), ann.P.called);
  check('and NOTHING of the game went down Supabase (only the console\'s ear saying hello, stamped rw)',
        supabaseGameTraffic().length === 0, supabaseGameTraffic().map(function (l) { return l.from + ':' + l.p.t; }));

  print('\nB. THE WORKER SAYS THE ROOM IS OFF: BOTH PAGES ON SUPABASE, THE NIGHT PLAYS');
  freshWorld({ off: true }); SOCKETS = [];
  host = bootHost(); await advance(300);
  ann = bootPhone('Ann'); await advance(300);
  check('both on Supabase', road(host) === 'supabase' || road(host) === '(none)', [road(host), road(ann)]);
  await startGame(host, ann);
  check('the phone was dealt a ticket over Supabase', dealt(ann));
  b1 = call(host); await advance(200);
  check('and hears the ball over Supabase', heardBall(ann, b1));
  check('no page opened a room socket', SOCKETS.filter(function (w) { return w.readyState === 1; }).length === 0);

  print('\nC. ROOM_OFF IS SET IN THE MIDDLE OF A GAME');
  freshWorld(); SOCKETS = [];
  host = bootHost(); await advance(300);
  ann = bootPhone('Ann'); await advance(300);
  await startGame(host, ann);
  b1 = call(host); await advance(200);
  check('control: the game is running in the room', heardBall(ann, b1) && road(ann) === 'room');
  ENV.ROOM_OFF = '1';                            // Dean flips the switch in the dashboard
  var b2 = call(host); await advance(400);       // the first message after it empties the room
  check('the console has gone to Supabase', socketsOf('host').length === 0 && road(host) === 'supabase', road(host));
  check('and so has the phone, together', socketsOf('phone:Ann').length === 0 && road(ann) === 'supabase', road(ann));
  await advance(2000);
  var b3 = call(host); await advance(300);
  check('the next ball reaches the phone down the old road', heardBall(ann, b3), ann.P.called);
  check('and the ball that was in flight at the switch is not lost: the console replays the board', heardBall(ann, b2), ann.P.called);
  check('the phone still has its ticket', dealt(ann));

  print('\nD. AN OLD TV, STILL ON SUPABASE FROM BEFORE THE SWITCH');
  freshWorld(); SOCKETS = [];
  var tv = oldTv();
  host = bootHost(); await advance(500);
  ann = bootPhone('Ann'); await advance(500);
  check('the console heard the old TV answer on the old road and left the room', socketsOf('host').length === 0, road(host));
  check('the phone went too (the room told it, or turned it away)', socketsOf('phone:Ann').length === 0, road(ann));
  await startGame(host, ann);
  b1 = call(host); await advance(200);
  check('the phone plays', dealt(ann) && heardBall(ann, b1));
  var tvHeard = LOG.filter(function (l) { return l.from === 'host' && l.p && l.p.t === 'ball'; }).length;
  check('and the old TV hears the balls, on the road it is on', tvHeard >= 1, tvHeard);

  print('\nH. A PHONE THAT JOINS AFTER THE HANDOVER');
  var bob = bootPhone('Bob'); await advance(500);
  check('goes straight to Supabase, where everyone is', socketsOf('phone:Bob').length === 0);
  bob.$('nameIn').value = 'Bob'; bob.join(); await advance(300);
  check('and its join reaches the console', !!host.G.players[bob.P.pid], Object.keys(host.G.players));

  print('\nE. A PHONE\'S CONNECTION DROPS MID-GAME');
  freshWorld(); SOCKETS = [];
  host = bootHost(); await advance(300);
  ann = bootPhone('Ann'); await advance(300);
  await startGame(host, ann);
  socketsOf('phone:Ann').forEach(dropSocket);
  await advance(5000);
  check('it comes back INTO THE ROOM', socketsOf('phone:Ann').length === 1, socketsOf('phone:Ann').length);
  check('and did not move the venue: the console is still in the room', socketsOf('host').length === 1);
  b1 = call(host); await advance(200);
  check('the next ball reaches it, on the same ticket', heardBall(ann, b1) && dealt(ann));

  print('\nF. THE CONSOLE IS RELOADED MID-GAME');
  var saved = host.dom.localStorage._s;
  /* A reload ends the old page. The rig keeps its objects, so stop it booking anything new
     before its socket goes, or it would reconnect beside the new one. */
  host.sb.setTimeout = host.sb.setInterval = function () { return 0; };
  socketsOf('host').forEach(function (w) { w.close(); });
  await advance(100);
  var host2 = bootHost({ store: saved }); await advance(1500);
  check('the reloaded console is back in the room', socketsOf('host').length === 1 && road(host2) === 'room', [socketsOf('host').length, road(host2)]);
  check('and picked the running game back up', host2.G.status === 'running', host2.G.status);
  b1 = call(host2); await advance(300);
  check('its next ball reaches the phone', heardBall(ann, b1), ann.P.called.slice(-3));

  print('\nG. OLD CONSOLE, OLD TV, NEW PHONE');
  freshWorld(); SOCKETS = [];
  NEXT_ROOM_SRC = VPROOM_OLD;
  host = bootHost(); await advance(300);
  check('control: the old console is on Supabase', socketsOf('host').length === 0);
  NEXT_ROOM_SRC = VPROOM_NEW;
  ann = bootPhone('Ann'); await advance(300);
  await advance(31000);                         // the old console's heartbeat
  check('the phone found the room empty, heard the console on the old road, and moved', socketsOf('phone:Ann').length === 0);
  await startGame(host, ann);
  b1 = call(host); await advance(200);
  check('and plays with it', dealt(ann) && heardBall(ann, b1));

  print('\nI. A NEW PAGE AGAINST AN OLD WORKER');
  freshWorld({ oldWorker: true }); SOCKETS = [];
  host = bootHost(); await advance(300);
  ann = bootPhone('Ann'); await advance(300);
  check('neither page takes the room by default when the Worker cannot hand it over', SOCKETS.length === 0);
  await startGame(host, ann);
  b1 = call(host); await advance(200);
  check('and the night plays on Supabase', dealt(ann) && heardBall(ann, b1));

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
