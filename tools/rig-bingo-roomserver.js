/* THE BINGO ROOM ON THE ROOM SERVER, IN A BOX: the REAL room server class and Worker routes
   (venueplay-backend/worker/venueplay-room.js), wired to the REAL console and phone pages of
   tools/rig-bingo-room.js, each page with the REAL vp-room.js (old or new) on a virtual clock.

   Lifted out of tools/test-room-default-bingo.js on 4 Nov 2026 so tools/test-room-dropout.js plays
   the same venue; nothing in it changed except one switch, sb.netDown: a phone whose signal has gone
   WITHOUT the browser saying so (navigator.onLine stays true, no offline event), which is what iOS
   does in flight mode at times and what a Wi-Fi to 4G hand-off always does. Every request fails and
   every new socket fails, exactly as with navigator.onLine false, but nothing announces it.

   load() it after tools/rig-bingo-room.js, from the repo root. */
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
  if (b.dead) return;                                   // half open: the room thinks it sent it
  fSetTimeout(function () { if (b.readyState === 1 && !b.dead && b.onmessage) b.onmessage({ data: s }); }, 1);
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

var ENV, ROOMS, STORES, WORKER_OLD, PAGES = [];
/* EVERY SCENARIO IS ITS OWN NIGHT. The rig keeps each page's objects alive, and every scenario's
   pages meet on the same venue code, so a console left running from scenario D (on Supabase, saying
   host_here every 30 seconds) was heard by scenario J's console as a real peer on the old road and
   the room was handed over. Correct behaviour, wrong night: the pages of a finished scenario are
   switched off, their timers cleared, before the next one starts. */
function endPages() {
  PAGES.forEach(function (sb) {
    sb.setTimeout = sb.setInterval = function () { return 0; };
    sb.fetch = function () { return new Promise(function () {}); };
    sb.WebSocket = function () { return { readyState: 0, send: function () {}, close: function () {} }; };
  });
  PAGES = [];
  TIMERS = [];
}
function freshWorld(opts) {
  opts = opts || {};
  endPages();
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
  if (this.dead) return;                                // half open: the browser thinks it sent it
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
/* VPROOM_FILE, set by a suite before it loads this, plays another copy (tools/test-room-dropout.js -- <file>: the BEFORE numbers). */
var VPROOM = readFile(typeof VPROOM_FILE !== 'undefined' && VPROOM_FILE ? VPROOM_FILE : 'venueplay/app/vp-room.js');
var VPROOM_NEW = VPROOM.replace('var DEFAULT_ON = false;', 'var DEFAULT_ON = true;');
var VPROOM_OLD = VPROOM.replace('var DEFAULT_ON = true;', 'var DEFAULT_ON = false;');
var NEXT_ROOM_SRC = null;          // null: this page has no vp-room.js at all
var SOCKETS = [];
var _baseSandbox = baseSandbox;
baseSandbox = function (dom, who) {
  var sb = _baseSandbox(dom, who);
  PAGES.push(sb);
  /* Each page has its own network: flight mode is one phone's, not the venue's. */
  sb.navigator = { onLine: true };
  sb.fetch = function (u, i) { if (sb.navigator.onLine === false || sb.netDown) return Promise.reject(new TypeError('offline')); return workerFetch(u, i); };
  sb.WebSocket = function (u) {
    if (sb.navigator.onLine === false || sb.netDown) {
      var dud = { url: u, readyState: 0, send: function () { throw new Error('not open'); }, close: function () { this.readyState = 3; } };
      fSetTimeout(function () { dud.readyState = 3; if (dud.onclose) dud.onclose({ code: 1006 }); }, 5);
      return dud;
    }
    var w = new BrowserWS(u); w.who = who; SOCKETS.push(w); return w;
  };
  sb.Date = Date;
  if (NEXT_ROOM_SRC) {
    /* The room client keeps its budgets by Date.now(). It gets the rig's VIRTUAL clock, or forty
       seconds of flight mode would pass in two real ones and no budget could ever run out. */
    var roomClock = { now: function () { return 1700000000000 + NOW; } };
    var proxy = new Proxy(sb, { has: function () { return true; }, get: function (t, k) { if (k === Symbol.unscopables) return undefined; if (k === 'Date') return roomClock; if (k in t) return t[k]; return globalThis[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
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

