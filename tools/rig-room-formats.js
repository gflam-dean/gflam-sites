/* A VENUE IN A BOX, EVERY FORMAT: the REAL pages, the REAL vp-room.js, the REAL room server class.

   Built 1 Nov 2026 to move musical bingo, trivia, the raffle and the members draw onto the room
   server. The faults this feature can have live BETWEEN pages (a console in the room and a TV on
   Supabase looks exactly like a working night), so nothing here is lifted out of a page: each page
   is the whole inline script of the shipped HTML file, run with the shared /app scripts it loads
   (vp-room.js, vp-channel.js, vp-screen-router.js, vp-venueurl.js and the rest), on a fake DOM, a
   fake Supabase that counts connections, and a virtual clock. The room is the real VenueRoom class
   and the real Worker routes from venueplay-backend/worker/venueplay-room.js, reached over a fake
   WebSocket. Nothing touches the network or any git remote; nothing is written anywhere.

   Two things are stood in for, on purpose, and said so:
     - vp-sign.js needs WebCrypto. A gate that drops any message marked forged stands in, so a test
       can still see that the page's own gate is on the room road. Signing itself is proved by
       tools/test-phones-cannot-be-impersonated.js and check-signing.py.
     - vp-session.js signs a host in through Supabase auth. VP is a stand-in that says "signed in,
       this venue", with the REAL venueCode hash.

   load() it from a test, from the repo root:  load('tools/rig-room-formats.js');
*/
var REPO = '';
var JS_FILES = {};
/* THE ROOM AS THE PRODUCT DEFAULT (3 Nov 2026). This suite is about a format moving onto the room by
   default, every page following the Worker's answer with no ?roomserver= in any URL. The shipped
   vp-room.js may still say DEFAULT_ON = false (the room stays opt-in until Dean has watched a night on
   it), so the rig turns it on here, the way test-tv-room-default.js and test-room-default-bingo.js do.
   If the line ever changes shape the rig stops rather than quietly testing the opt-in product. */
function src(p) {
  if (!JS_FILES[p]) {
    var t = readFile(REPO + p);
    if (/venueplay\/app\/vp-room\.js$/.test(p)) {
      t = t.replace('var DEFAULT_ON = false;', 'var DEFAULT_ON = true;');
      if (t.indexOf('var DEFAULT_ON = true;') < 0) throw new Error('rig: cannot find "var DEFAULT_ON = ..." in ' + p);
    }
    JS_FILES[p] = t;
  }
  return JS_FILES[p];
}
function inlineOf(path) {
  var html = src(path), re = /<script>([\s\S]*?)<\/script>/g, m, best = '';
  while ((m = re.exec(html))) { if (m[1].length > best.length) best = m[1]; }
  return best;
}
function scriptsOf(path) {
  var html = src(path), re = /<script src="(\/app\/[^"?]+)"/g, m, out = [];
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* ---------------- a virtual clock ---------------- */
var NOW = 1700000000000, TIMERS = [], TID = 1;
var _RealDate = Date;
function FakeDate(v) { return arguments.length ? new _RealDate(v) : new _RealDate(NOW); }
FakeDate.now = function () { return NOW; }; FakeDate.parse = _RealDate.parse; FakeDate.UTC = _RealDate.UTC; FakeDate.prototype = _RealDate.prototype;
function fSetTimeout(fn, ms) { var id = TID++; TIMERS.push({ id: id, at: NOW + (+ms || 0), fn: fn, every: 0 }); return id; }
function fSetInterval(fn, ms) { var id = TID++; TIMERS.push({ id: id, at: NOW + (+ms || 1), fn: fn, every: (+ms || 1) }); return id; }
function fClear(id) { TIMERS = TIMERS.filter(function (t) { return t.id !== id; }); }
var TIMER_ERRORS = [];
async function drain() { for (var i = 0; i < 30; i++) await Promise.resolve(); }
async function advance(ms) {
  var end = NOW + ms;
  await drain();
  for (var guard = 0; guard < 200000; guard++) {
    TIMERS.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
    var t = TIMERS[0];
    if (!t || t.at > end) break;
    NOW = Math.max(NOW, t.at);
    if (t.every) t.at += t.every; else TIMERS.shift();
    try { t.fn(); } catch (e) { TIMER_ERRORS.push(String(e)); }
    await drain();
  }
  NOW = end; await drain();
}

/* ---------------- Supabase Realtime, with connections counted ----------------
   A connection is a client with at least one channel joined, which is what Supabase bills. The
   library's two rules that matter are kept: a channel subscribes once, and removeChannel tells the
   channel CLOSED inside the call. */
var BUS = {}, SUPA_LOG = [], CLIENTS = [], HEARD = [], FETCHES = [], TABLES = {};
function makeSupabase(who) {
  return { createClient: function () {
    var cl = { who: who, chans: [],
      auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); },
              onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
              signInWithOtp: function () { return Promise.resolve({}); }, verifyOtp: function () { return Promise.resolve({}); } },
      /* Supabase REST, as the consoles read their setup: every query answers the rows in TABLES[table]
         (none by default), whatever it filtered on. Enough for a console to get as far as its channel. */
      from: function (table) {
        var rows = (TABLES[table] || []).slice(), single = false;
        var q = { then: function (ok, bad) { return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null, count: rows.length }).then(ok, bad); } };
        ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'or', 'order', 'limit', 'range', 'not', 'filter', 'match', 'contains',
         'insert', 'update', 'upsert', 'delete'].forEach(function (k) { q[k] = function () { return q; }; });
        q.single = q.maybeSingle = function () { single = true; return q; };
        return q;
      },
      rpc: function () { return Promise.resolve({ data: null, error: { message: 'no rpc in the rig' } }); },
      channel: function (name) {
        var ch = { name: name, who: who, live: false, gone: false, hs: [], st: null };
        ch.on = function (a, f, cb) { ch.hs.push(cb); return ch; };
        ch.subscribe = function (cb) {
          if (ch.st) throw new Error('tried to subscribe multiple times');
          ch.st = cb || function () {};
          fSetTimeout(function () { if (ch.gone) return; ch.live = true; (BUS[name] = BUS[name] || []).push(ch); ch.st('SUBSCRIBED'); }, 5);
          return ch;
        };
        ch.send = function (m) {
          var p = m && m.payload;
          SUPA_LOG.push({ who: who, name: name, p: p });
          if (!ch.live) return Promise.resolve('error');
          var subs = (BUS[name] || []).slice();
          fSetTimeout(function () { subs.forEach(function (s) { if (s !== ch && s.live) { HEARD.push({ who: s.who, road: 'supabase', room: name, s: JSON.stringify(p) }); } if (s !== ch && s.live) s.hs.forEach(function (h) { try { h({ type: 'broadcast', event: 'msg', payload: JSON.parse(JSON.stringify(p)) }); } catch (e) { TIMER_ERRORS.push(who + ' handler: ' + e); } }); }); }, 3);
          return Promise.resolve('ok');
        };
        ch.unsubscribe = function () { ch.gone = true; ch.live = false; BUS[name] = (BUS[name] || []).filter(function (s) { return s !== ch; }); return Promise.resolve('ok'); };
        cl.chans.push(ch);
        return ch;
      },
      removeChannel: function (ch) { if (!ch) return Promise.resolve('ok'); var was = ch.st; try { ch.unsubscribe(); } catch (e) {} if (was && ch.name) { try { was('CLOSED'); } catch (e) {} } return Promise.resolve('ok'); },
      getChannels: function () { return cl.chans.filter(function (c) { return !c.gone; }); }
    };
    CLIENTS.push(cl);
    return cl;
  } };
}
function supaConnections(whoRe) {
  return CLIENTS.filter(function (c) { return (!whoRe || whoRe.test(c.who)) && c.chans.some(function (ch) { return ch.live; }); }).length;
}
function supaChannels(whoRe) {
  var out = [];
  CLIENTS.forEach(function (c) { if (!whoRe || whoRe.test(c.who)) c.chans.forEach(function (ch) { if (ch.live) out.push(c.who + ':' + ch.name); }); });
  return out;
}

/* ---------------- the room server, from the real file ---------------- */
function URL(u, base) {
  if (base && !/^[a-z]+:\/\//.test(u)) u = String(base).replace(/\/[^\/]*$/, '/') + u;
  var m = /^([a-z]+:\/\/[^\/]+)(\/[^?#]*)?(\?([^#]*))?/.exec(u) || [];
  this.href = u; this.origin = m[1] || ''; this.pathname = m[2] || '/'; this.search = m[3] || '';
  var q = {}; (m[4] || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); q[decodeURIComponent(k)] = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1)); });
  this.searchParams = { get: function (k) { return Object.prototype.hasOwnProperty.call(q, k) ? q[k] : null; } };
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
  fSetTimeout(function () { if (b.readyState === 1 && b.onmessage) { HEARD.push({ who: b.who, road: 'room', room: b.roomName, s: s }); b.onmessage({ data: s }); } }, 2);
};
ServerSocket.prototype.close = function (code) {
  if (this.gone) return; this.gone = true;
  var b = this.peer; if (!b) return;
  fSetTimeout(function () { if (b.readyState === 3) return; b.readyState = 3; if (b.onclose) b.onclose({ code: code || 1000 }); }, 2);
};
function WebSocketPair() { var s = new ServerSocket(); this[0] = { client: true, of: s }; this[1] = s; }
/* This repo's own room server, read from disk and run here; nothing is fetched. */
eval(src('venueplay-backend/worker/venueplay-room.js').replace(/^export \{[\s\S]*?\};?\s*$/m, '').replace(/^export /mg, '')
     .replace(/^const /mg, 'var ').replace(/^class VenueRoom /m, 'var VenueRoom = class VenueRoom '));

var ENV, ROOMS, SOCKETS, ROOM_ON, WORKER_POSTS, HANDOVER_DOWN = false;
/* A fresh venue: rooms, Supabase, sockets and clock queues all empty. formats: which formats the
   Worker has on the room (ROOM_FORMATS_ON), e.g. { musical: true }. */
function freshWorld(opts) {
  opts = opts || {};
  HANDOVER_DOWN = false; CUT = {}; ROOMS = {}; SOCKETS = []; BUS = {}; SUPA_LOG = []; CLIENTS = []; HEARD = []; PAGES = []; FETCHES = []; WORKER_POSTS = []; TIMERS = []; TIMER_ERRORS = [];
  ROOM_ON = { musical: false, trivia: false, raffle: false, members: false };
  for (var k in (opts.formats || {})) ROOM_ON[k] = !!opts.formats[k];
  for (var f in ROOM_FORMATS_ON) ROOM_FORMATS_ON[f] = !!ROOM_ON[f];
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
        ROOMS[n] = { obj: new VenueRoom(st, ENV), sockets: sockets, store: store };
      }
      var r = ROOMS[n];
      return { fetch: function (u, init) { return r.obj.fetch(typeof u === 'string' ? new Request(u, init) : u); } };
    } };
}
(function () {
  var g = src('venueplay-backend/worker/venueplay-game.js'), i = g.indexOf('function roomFormatOf(');
  if (i < 0) throw new Error('cannot find roomFormatOf in the game Worker');
  var d = 0, k = g.indexOf('{', i); do { if (g[k] === '{') d++; else if (g[k] === '}') d--; k++; } while (d > 0);
  (0, eval)(g.slice(i, k).replace(/\bconst\b/g, 'var'));      // this repo's own Worker function, from disk
})();
function wjson(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }
function roomIn(name, role) { var r = ROOMS[name]; return r ? r.sockets.filter(function (w) { return !w.gone && (!role || w.tags.indexOf(role) >= 0); }).length : 0; }
function handedOver(name) { var r = ROOMS[name]; return !!(r && r.store.get('ho') > NOW); }

/* What a browser's WebSocket does, wired to the room through the real /room/ws route. */
/* CUT[who]: that page cannot reach the room at all (no socket opens, no presence answers) while the
   rest of the Worker still answers it, the way a proxy that blocks WebSockets behaves. The page then
   gives up on the room by itself, which is the case the F2 ask exists for (6 Nov 2026). */
var CUT = {};
function BrowserWS(url, who) {
  var self = this; this.url = url; this.who = who; this.readyState = 0; this.sent = []; this.roomName = (/[?&]room=([^&]+)/.exec(url) || [])[1];
  SOCKETS.push(this);
  if (CUT[who]) { fSetTimeout(function () { self.readyState = 3; if (self.onclose) self.onclose({ code: 1006 }); }, 5); return; }
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
  this.sent.push(s);
  var srv = this.server, room = this.room;
  if (s === 'ping') { srv.send('pong'); return; }        // Cloudflare's auto-response
  fSetTimeout(function () { if (!srv.gone) room.obj.webSocketMessage(srv, s); }, 2);
};
BrowserWS.prototype.close = function () {
  if (this.readyState === 3) return;
  this.readyState = 3; if (this.server) this.server.gone = true;
  var self = this; fSetTimeout(function () { if (self.onclose) self.onclose({ code: 1000 }); }, 2);
};
function dropSocket(ws) { ws.readyState = 3; if (ws.server) ws.server.gone = true; if (ws.onclose) ws.onclose({ code: 1006 }); }
function socketsOf(whoRe) { return SOCKETS.filter(function (w) { return whoRe.test(w.who) && w.readyState === 1; }); }

/* ---------------- the game Worker, as far as these pages need it ----------------
   /room/* are the REAL routes. The host routes answer what the consoles need to open a game; the
   body of every POST is kept so a test can read what a console told the Worker (road). */
var API = 'https://game.venueplay.com.au';
var SLUG = 'test-pub';
function fnv(slug) { return roomVenueCode(slug); }
var CODE_B = fnv(SLUG);
/* WHO MAY HAND THE ROOM OVER (6 Nov 2026, F2): the game Worker's roomHandoverAuth, as far as this
   rig's pages go. The console is signed in (its VP session's token, "tok"); a TV and a phone send no
   sign in and are only an ask. room-handover-auth.test.js holds the real check to this contract. */
function RIG_AUTH(request) {
  var h = (request && request.headers && request.headers.get('Authorization')) || '';
  return Promise.resolve(h === 'Bearer tok' ? { signed: true, extra: true } : { signed: false });
}
var WORKER_REPLY = {};
function workerFetch(url, init, who) {
  var path = (/^https?:\/\/[^\/]+(\/[^?]*)/.exec(url) || [])[1] || '';
  var method = (init && init.method) || 'GET';
  if (path === '/room/presence') return handleRoomPresence(new Request(url), ENV, wjson).then(asFetch);
  if (path === '/room/handover' && method === 'POST') {
    if (HANDOVER_DOWN) return Promise.reject(new Error('the network ate it'));
    return handleRoomHandover(new Request(url, init), ENV, wjson, RIG_AUTH).then(asFetch);
  }
  var body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
  if (method === 'POST') WORKER_POSTS.push({ who: who, path: path, body: body });
  /* What the game Worker does first on these two routes (handleCreateSession, membersDrawThenRoad):
     the REAL roomOldConsoleCheck, with the REAL roomFormatOf lifted from venueplay-game.js. */
  if (method === 'POST' && (path === '/session' || path === '/host/members/draw')) {
    var fmt = path === '/session' ? roomFormatOf(body.format) : 'members';
    return roomOldConsoleCheck(ENV, body.road, fmt, function () { return Promise.resolve(SLUG); }).then(function () { return workerReply(path, body, who); });
  }
  return workerReply(path, body, who);
}
function workerReply(path, body, who) {
  var r = WORKER_REPLY[path];
  if (typeof r === 'function') r = r(body, who);
  if (r === undefined) r = (path === '/session') ? { session_id: '33333333-3333-4333-8333-333333333333', join_code: CODE_B, tv_pairing_code: 'ABCD' }
                       : (path === '/snapshot' || path === '/venue' || path === '/play/live' || /^\/join\/info/.test(path)) ? null : { ok: true };
  if (r === null) return Promise.resolve(fakeResponse(404, { error: 'not here' }));
  return Promise.resolve(fakeResponse(200, r));
}
function asFetch(r) { return fakeResponse(r.status, r._json); }
function fakeResponse(status, obj) { return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); }, headers: { get: function () { return null; } } }; }
function pageFetch(who) {
  return function (url, init) {
    url = String(url);
    FETCHES.push(who + ' ' + ((init && init.method) || 'GET') + ' ' + url.replace(API, ''));
    if (CUT[who] && url.indexOf(API + '/room/presence') === 0) return Promise.reject(new TypeError('the room is out of reach'));
    if (url.indexOf(API) === 0) return workerFetch(url, init, who);
    if (!/^[a-z]+:/.test(url) && url.charAt(0) !== '/') url = '/' + url.replace(/^(\.\.\/|\.\/)+/, '');   // ../../data/x.json from /app/<game>/
    if (/^\//.test(url) && !/^\/\//.test(url)) {
      var p = url.split('?')[0];
      try { var t = src('venueplay' + p); return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve(JSON.parse(t)); }, text: function () { return Promise.resolve(t); } }); }
      catch (e) { return Promise.resolve(fakeResponse(404, {})); }
    }
    return Promise.reject(new Error('offline rig: ' + url));
  };
}

/* ---------------- a fake DOM, enough for these pages ---------------- */
function makeDom(search, pathname) {
  var made = {};
  function el(id) {
    var raw = '';
    var node = { id: id || '', textContent: '', value: '', disabled: false, checked: false, hidden: false, children: [], _on: {}, _attr: {},
      style: { setProperty: function () {}, removeProperty: function () {}, display: '' }, dataset: {}, offsetWidth: 100, offsetHeight: 50, clientWidth: 100, clientHeight: 50, scrollWidth: 100, scrollHeight: 50,
      appendChild: function (n) { if (n && n.parentNode && n.parentNode.children) { var j = n.parentNode.children.indexOf(n); if (j >= 0) n.parentNode.children.splice(j, 1); } this.children.push(n); if (n) n.parentNode = this; return n; },
      remove: function () { var p = this.parentNode; if (!p) return; var k = p.children.indexOf(this); if (k >= 0) p.children.splice(k, 1); this.parentNode = null; },
      insertBefore: function (n) { this.children.unshift(n); if (n) n.parentNode = this; return n; }, removeChild: function (n) { var k = this.children.indexOf(n); if (k >= 0) this.children.splice(k, 1); else this.children.shift(); return n; }, replaceChildren: function () { this.children = []; },
      addEventListener: function (ev, fn) { (this._on[ev] = this._on[ev] || []).push(fn); }, removeEventListener: function () {},
      setAttribute: function (k, v) { this._attr[k] = String(v); }, getAttribute: function (k) { return this._attr[k] == null ? null : this._attr[k]; },
      removeAttribute: function (k) { delete this._attr[k]; }, hasAttribute: function (k) { return k in this._attr; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; }, getElementsByTagName: function () { return []; },
      closest: function () { return null; }, focus: function () {}, blur: function () {}, select: function () {}, scrollIntoView: function () {},
      getBoundingClientRect: function () { return { top: 0, left: 0, right: 100, bottom: 50, width: 100, height: 50 }; },
      getContext: function () { return null; }, play: function () { return Promise.resolve(); }, pause: function () {}, load: function () {},
      click: function () { (this._on.click || []).forEach(function (f) { f.call(node, { target: node, preventDefault: function () {}, stopPropagation: function () {} }); }); },
      classList: { _s: {}, add: function (c) { this._s[c] = 1; }, remove: function (c) { delete this._s[c]; }, toggle: function (c, on) { if (on === undefined) on = !this._s[c]; if (on) this._s[c] = 1; else delete this._s[c]; return !!on; }, contains: function (c) { return !!this._s[c]; } } };
    Object.defineProperty(node, 'childNodes', { get: function () { return node.children; } });
    Object.defineProperty(node, 'firstChild', { get: function () { return node.children[0] || null; } });
    Object.defineProperty(node, 'lastChild', { get: function () { return node.children[node.children.length - 1] || null; } });
    Object.defineProperty(node, 'innerHTML', { get: function () { return raw; }, set: function (v) { raw = String(v); node.children = []; } });
    Object.defineProperty(node, 'className', { get: function () { return Object.keys(node.classList._s).join(' '); }, set: function (v) { node.classList._s = {}; String(v).split(/\s+/).forEach(function (c) { if (c) node.classList._s[c] = 1; }); } });
    return node;
  }
  var document = { _on: {}, visibilityState: 'visible', hidden: false, readyState: 'complete', documentElement: el('html'), body: el('body'), head: el('head'), fonts: { ready: Promise.resolve() },
    getElementById: function (id) { if (!made[id]) made[id] = el(id); return made[id]; },
    createElement: function (t) { var n = el(); n.tagName = String(t || '').toUpperCase(); return n; }, createTextNode: function (t) { var n = el(); n.textContent = t; return n; },
    createDocumentFragment: function () { return el(); },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, getElementsByTagName: function () { return []; },
    addEventListener: function (ev, fn) { (this._on[ev] = this._on[ev] || []).push(fn); }, removeEventListener: function () {}, exitFullscreen: function () {} };
  var store = {}, sstore = {};
  var ls = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; }, _s: store };
  var ss = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(sstore, k) ? sstore[k] : null; }, setItem: function (k, v) { sstore[k] = String(v); }, removeItem: function (k) { delete sstore[k]; }, _s: sstore };
  var posted = [];
  var window = { _on: {}, posted: posted, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    location: { search: search || '', pathname: pathname || '/', href: 'https://venueplay.com.au' + (pathname || '/') + (search || ''), origin: 'https://venueplay.com.au', host: 'venueplay.com.au', hostname: 'venueplay.com.au', protocol: 'https:',
                replace: function (u) { window._replaced = u; }, assign: function (u) { window._replaced = u; }, reload: function () { window._reloaded = (window._reloaded || 0) + 1; } },
    addEventListener: function (ev, fn) { (this._on[ev] = this._on[ev] || []).push(fn); }, removeEventListener: function () {},
    matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
    getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
    postMessage: function (m) { posted.push(m); }, requestAnimationFrame: function (f) { return fSetTimeout(f, 16); }, cancelAnimationFrame: fClear,
    scrollTo: function () {}, open: function () { return null; }, print: function () {} };
  window.top = window; window.self = window; window.parent = window;
  return { document: document, window: window, localStorage: ls, sessionStorage: ss, made: made,
           $: function (id) { return document.getElementById(id); } };
}

/* A host signed in at this venue. The REAL venueCode hash, so a console's channel names are the
   ones a TV derives. Everything else answers the way a working account does. */
function makeVP(slug) {
  var ctx = { authed: true, scope: 'staff', role: 'owner', isAdmin: false, currentVenueId: '22222222-2222-4222-8222-222222222222',
              venue: { id: '22222222-2222-4222-8222-222222222222', slug: slug, name: 'Test Pub', status: 'active', max_players: 100, au_state: 'QLD', created_at: '2026-01-01T00:00:00Z' },
              staff: [{ venue_id: '22222222-2222-4222-8222-222222222222', role: 'owner' }], user: { user_metadata: { name: 'Dean' } } };
  var none = function () {};
  /* A throw inside the page's own ready() callback would vanish into a rejected promise; say it. */
  function ready() {
    var p = Promise.resolve(ctx);
    return { then: function (cb, eb) { return p.then(function (c) { try { return cb(c); } catch (e) { TIMER_ERRORS.push('VP.ready callback: ' + e + ' ' + ((e && e.stack) || '').split('\n')[0]); throw e; } }, eb); },
             catch: function (eb) { return p.catch(eb); } };
  }
  return { ready: ready, refresh: function () { return Promise.resolve(ctx); }, useClient: none, getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
    venueCode: function (s) { return roomVenueCode(s); }, holdGate: function () { return false; }, termsGate: function () { return false; },
    setGameActive: none, enforceShift: none, noteOpenSession: none, closeOpenSessions: none, closeSession: function () { return Promise.resolve(); },
    confirmTakeover: function () { return Promise.resolve(true); }, gamePrefs: null, advanced: function () { return false; }, hostRefusal: function (s, e) { return e || ('refused ' + s); },
    suspensionBanner: none, signOut: none, listVenues: function () { return Promise.resolve([]); }, homeHref: function () { return 'index.html'; } };
}

/* THE PAGES. opts.old: a page cached from before the room server (no vp-room.js at all, which is
   what every page on the live site before 31 Oct is). opts.flag: ?roomserver=0 or 1. */
var PAGES = [];
function runIn(code, sb, win) {
  var proxy = new Proxy(sb, { has: function () { return true; },
    get: function (t, key) { if (key === Symbol.unscopables) return undefined; if (key in t) return t[key]; if (win && key in win) return win[key]; return globalThis[key]; },
    set: function (t, key, v) { t[key] = v; return true; } });
  (new Function('__sb', 'with(__sb){\n' + code + '\n}'))(proxy);
}
function bootPage(path, opts) {
  opts = opts || {};
  var who = opts.who || path;
  var search = opts.search || '';
  if (opts.flag != null) search += (search ? '&' : '?') + 'roomserver=' + opts.flag;
  var dom = makeDom(search, '/' + path.replace(/^venueplay\//, '').replace(/\.html$/, ''));
  /* opts.store: what this browser already holds in localStorage (a page RELOADED mid-game, 4 Nov 2026). */
  if (opts.store) { for (var sk in opts.store) dom.localStorage.setItem(sk, opts.store[sk]); }
  var w = dom.window;
  var gate = function (p, cb) { if (p && p.forged) return; cb(p); };
  var sb = { document: dom.document, window: w, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, location: w.location, navigator: { onLine: true, userAgent: 'rig', sendBeacon: function () { return true; } },
    supabase: makeSupabase(who), setTimeout: fSetTimeout, setInterval: fSetInterval, clearTimeout: fClear, clearInterval: fClear, Date: FakeDate,
    fetch: pageFetch(who), WebSocket: function (u) { return new BrowserWS(u, who); }, URL: URL,
    console: { log: function () {}, info: function () {}, warn: function () {}, error: function () {} }, confirm: function () { return true; }, alert: function () {}, prompt: function () { return ''; },
    Audio: function () { return { play: function () { return Promise.resolve(); }, pause: function () {}, addEventListener: function () {}, load: function () {}, src: '' }; },
    MutationObserver: undefined, ResizeObserver: undefined, IntersectionObserver: undefined, BroadcastChannel: undefined, AbortController: undefined, Worker: undefined,
    crypto: { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296) >>> 0; return a; }, randomUUID: function () { return '44444444-4444-4444-8444-' + ('00000000000' + (TID++)).slice(-12); } },
    VPSign: { gate: gate, signSend: function (o, s) { s(o); }, initReceiver: function () {}, initHost: function () {} } };
  /* window.supabase IS the page's supabase in a browser (3 Nov 2026). /app/vp-supabase-oldtv.js reads
     window.supabase.createClient to tell a modern engine (returns at once) from an old TV (writes the
     ES2017 build's tag); without this the rig looked like an old TV and the loader called document.write. */
  w.supabase = sb.supabase;
  sb.globalThis = w; sb.self = w;          // in a browser both ARE the window (vp-screen-router.js hangs itself on globalThis)
  ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'WebSocket', 'VPSign', 'crypto', 'navigator', 'Audio', 'Date'].forEach(function (k) { w[k] = sb[k]; });
  if (opts.host) { sb.VP = w.VP = makeVP(opts.slug || SLUG); }
  if (opts.hop) dom.sessionStorage.setItem('vpTvHop', opts.slug || SLUG);
  if (opts.embedded) { w.top = { postMessage: function () {} }; w.parent = { postMessage: function (m) { w.posted.push(m); } }; }
  var skip = { '/app/vp-sign.js': 1, '/app/vp-session.js': 1, '/app/vp-pixel.js': 1, '/app/vp-analytics.js': 1, '/app/vp-help.js': 1, '/app/vp-help-sw.js': 1 };
  if (opts.old) skip['/app/vp-room.js'] = 1;
  var errors = [];
  scriptsOf(path).forEach(function (s) {
    if (skip[s]) return;
    /* THE PAGE'S OWN supabase-js NEVER RUNS HERE (3 Nov 2026). Since the 2 Nov release the pages load a
       vendored copy from /app/vendor/, which the /app/ pattern above picks up; run, it replaces the
       stand-in (makeSupabase) with the real library, which dies on the rig's URL and leaves every
       format's page unbooted. The rig's stand-in is the supabase this suite is about. */
    if (/^\/app\/vendor\/supabase-js-[^\/]*\.js$/.test(s)) return;
    try { runIn(src('venueplay' + s), sb, w); } catch (e) { errors.push(s + ': ' + e); }
  });
  var code = inlineOf(path);
  /* AN OLD PAGE is the page as it was before the room server: no vp-room.js (above), and it never
     said a road to the Worker. Every road the pages say is one expression, road:(...), so it comes
     out whole; the channel lines already fall back to the plain channel without vp-room.js. */
  if (opts.old) {
    var before = code;
    code = code.replace(/, road:\((?:[^()]|\([^()]*\))*\)/g, '').replace(/, road: bingoRoad\(\)/g, '');
    if (code === before && /road:/.test(before)) errors.push('rig: could not take the road out of an old ' + path);
  }
  var k = code.lastIndexOf('})();');
  var names = opts.exports || [];
  var tail = '__export({' + names.map(function (n) { return n + ':(typeof ' + n + "!=='undefined'?" + n + ':undefined)'; }).join(',') + '});';
  code = code.slice(0, k) + tail + code.slice(k);
  var out = {};
  sb.__export = function (o) { for (var n in o) out[n] = o[n]; };
  try { runIn(code, sb, w); } catch (e) { errors.push('inline: ' + e + ' ' + ((e && e.stack) || '').split('\n')[0]); }
  var page = { who: who, path: path, dom: dom, sb: sb, win: w, ex: out, errors: errors, $: dom.$,
               road: function () { return dom.document.documentElement._attr['data-vp-transport'] || '(none)'; } };
  PAGES.push(page);
  return page;
}
/* A page that is closed: its timers stop, its sockets go. */
function closePage(page) {
  page.sb.setTimeout = page.sb.setInterval = function () { return 0; };
  page.win.setTimeout = page.win.setInterval = page.sb.setTimeout;
  SOCKETS.forEach(function (w) { if (w.who === page.who && w.readyState === 1) w.close(); });
  CLIENTS.forEach(function (c) { if (c.who === page.who) c.chans.forEach(function (ch) { ch.unsubscribe(); }); });
  TIMERS = TIMERS.filter(function (t) { return !t.page || t.page !== page.who; });
}
/* What a page has been handed, room or Supabase: [{road, room, m}], filtered. */
function heard(who, pred) {
  return HEARD.filter(function (h) { return h.who === who; }).map(function (h) { var m = null; try { m = JSON.parse(h.s); } catch (e) {} return { road: h.road, room: h.room, m: m }; })
              .filter(function (h) { return h.m && (!pred || pred(h.m)); });
}
function roomSockets(who) { return SOCKETS.filter(function (w) { return w.who === who && w.readyState === 1; }).map(function (w) { return w.roomName; }); }
