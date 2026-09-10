/* THE ROOM RELAYS TO EVERYONE BUT THE SENDER, AND NOTHING ELSE.

   Runs the real VenueRoom class from venueplay-room.js against a scripted Durable
   Object state and scripted sockets. Checks: a message from one screen reaches every
   other screen and not itself (Supabase broadcast {self:false}, which the pages rely
   on); presence counts by role; junk, oversize and flood messages go nowhere; the
   Worker's /publish reaches everyone; the Worker-side helpers are no-ops without the
   binding.

   WRITTEN OVERNIGHT 9 SEP 2026 AND NOT YET RUN. Run it, then break relay() on purpose
   and watch it go red, before trusting the green.

   Run: jsc venueplay-backend/worker/venueplay-room.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-room.js');
var EXPECT = 29;
var bad = 0, ran = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

/* ---- the least the class needs: URL, Response, Request, WebSocketPair, a state ---- */
function URL(u) {
  var m = /^[a-z]+:\/\/[^\/]+(\/[^?]*)?(\?(.*))?$/.exec(u);
  this.pathname = (m && m[1]) || '/';
  var q = {}; ((m && m[3]) || '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  this.searchParams = { get: function (k) { return q.hasOwnProperty(k) ? q[k] : null; } };
}
function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; this.webSocket = init && init.webSocket; this._json = body ? JSON.parse(body) : null; }
Response.prototype.json = function () { return Promise.resolve(this._json); };
function Request(url, init) { this.url = url; this.method = (init && init.method) || 'GET'; this.headers = { get: function (k) { return (init && init.headers && init.headers[k]) || null; } }; this._body = init && init.body; }
Request.prototype.json = function () { return Promise.resolve(JSON.parse(this._body)); };

var NOW = 1000000;
var Date = { now: function () { return NOW; } };

var sockets = [];    // every server-side socket the room accepted, in order
function FakeSocket(label) { this.label = label; this.got = []; this.closed = null; this.att = null; }
FakeSocket.prototype.send = function (s) { if (this.dead) throw new Error('dead'); this.got.push(JSON.parse(s)); };
FakeSocket.prototype.close = function (c, r) { this.closed = [c, r]; };
FakeSocket.prototype.serializeAttachment = function (o) { this.att = JSON.parse(JSON.stringify(o)); };
FakeSocket.prototype.deserializeAttachment = function () { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; };
var pairN = 0;
function WebSocketPair() { var s = new FakeSocket('s' + (++pairN)); this[0] = { client: true, of: s }; this[1] = s; }

var state = {
  tags: [],
  acceptWebSocket: function (ws, tags) { ws.tags = tags || []; sockets.push(ws); },
  getWebSockets: function (tag) { return sockets.filter(function (w) { return !w.gone && (!tag || w.tags.indexOf(tag) >= 0); }); },
};

/* eval() keeps let/const/class to its own scope; var is what reaches this file. */
eval(src.replace(/^export \{[\s\S]*?\};?\s*$/m, '')
        .replace(/^export /mg, '')
        .replace(/^const /mg, 'var ')
        .replace(/^class VenueRoom /m, 'var VenueRoom = class VenueRoom '));

var room = new VenueRoom(state, {});
function join(role) {
  var req = new Request('https://room/ws?role=' + role, { headers: { Upgrade: 'websocket' } });
  return room.fetch(req);
}

print('== screens join ==');
var tv, host, p1, p2;
join('tv').then(function (r) { tv = r.webSocket.of; ok('the TV is accepted with a 101', r.status === 101 && tv);
  return join('host'); }).then(function (r) { host = r.webSocket.of;
  return join('phone'); }).then(function (r) { p1 = r.webSocket.of;
  return join('phone'); }).then(function (r) { p2 = r.webSocket.of;
  ok('four sockets in the room, tagged by role', sockets.length === 4 && tv.tags[0] === 'tv' && host.tags[0] === 'host' && p1.tags[0] === 'phone');
  ok('each remembers its role in the attachment (hibernation-safe)', host.att && host.att.role === 'host');
  var pr = room.presence();
  ok('presence counts by role', pr.total === 4 && pr.tv === 1 && pr.host === 1 && pr.phone === 2 && pr.hq === 0, JSON.stringify(pr));
  return join('dj'); }).then(function (r) {
  ok('an unknown role is refused', r.status === 400);
  return room.fetch(new Request('https://room/ws?role=tv', {}));
}).then(function (r) {
  ok('a plain GET on /ws (no Upgrade) is refused, not crashed', r.status === 426);

  print('\n== the host speaks ==');
  room.webSocketMessage(host, JSON.stringify({ type: 'ball', n: 42, _sig: 'x' }));
  ok('the TV heard it', tv.got.length === 1 && tv.got[0].type === 'ball' && tv.got[0].n === 42);
  ok('both phones heard it', p1.got.length === 1 && p2.got.length === 1);
  ok('the host did NOT hear its own message (self:false, as on Supabase)', host.got.length === 0);
  ok('the message arrived untouched, signature included', tv.got[0]._sig === 'x');

  /* AND THE SHAPE THE PRODUCT ACTUALLY SPEAKS, which is not the one above.
     Every console, TV and phone in VenuePlay sends {t:"ball"}. The room demanded
     obj.type and silently dropped everything else, so on 10 Sep 2026 the host tablet
     and two TVs all joined the room, presence counted three, and not one ball reached
     the wall. This suite passed the whole time, because {type:...} is the only message
     shape in the codebase that uses that key and it is one this test invented.
     A test that only ever sends what the code expects cannot find this. */
  print('\n== a real game message, which uses t, not type ==');
  var tBefore = tv.got.length, hBefore = host.got.length;
  room.webSocketMessage(host, JSON.stringify({ t: 'ball', n: 7 }));
  ok('a ball in the product\'s own shape reaches the TV',
     tv.got.length === tBefore + 1 && tv.got[tv.got.length - 1].t === 'ball' && tv.got[tv.got.length - 1].n === 7,
     'the room dropped {t:...} and every game message uses it');
  ok('both phones heard that one too', p1.got.length === 2 && p2.got.length === 2);
  ok('and the host still does not hear its own', host.got.length === hBefore);

  /* A HOST ANSWERING A WHOLE ROOM IS NOT A FLOOD.
     The cap was one number, 20 a second, written for a phone hammering the room. A bingo
     console answers every phone's rollcall with that phone's own cards, so a 40 player
     room is 40 messages out of the host socket in a moment. Measured on staging on
     10 Sep 2026 with the single cap: the host sent 40 and the TV heard 20, silently.
     Half a room with no card and no screen able to say why. */
  print('\n== a host answering forty phones at once ==');
  var beforeBurst = tv.got.length;
  for (var q = 0; q < 40; q++) room.webSocketMessage(host, JSON.stringify({ t: 'cards', pid: 'p' + q }));
  ok('all forty card messages reach the TV', tv.got.length === beforeBurst + 40,
     'heard ' + (tv.got.length - beforeBurst) + ' of 40: a rollcall in a busy room is not a flood');
  var beforePhone = tv.got.length;
  for (var z = 0; z < 40; z++) room.webSocketMessage(p1, JSON.stringify({ t: 'join', n: z }));
  ok('a PHONE sending forty is still capped', (tv.got.length - beforePhone) <= 20,
     'a phone is the one thing an outsider can point at us');

  print('\n== junk goes nowhere ==');
  var before = tv.got.length;
  room.webSocketMessage(p1, 'not json');
  room.webSocketMessage(p1, JSON.stringify({ no: 'type' }));
  room.webSocketMessage(p1, JSON.stringify([1, 2, 3]));
  room.webSocketMessage(p1, new ArrayBuffer(8));
  ok('not-JSON, no type, an array and binary are all dropped', tv.got.length === before);
  var big = JSON.stringify({ type: 'x', pad: new Array(17 * 1024).join('a') });
  room.webSocketMessage(p1, big);
  ok('an oversize message is dropped', tv.got.length === before);

  print('\n== a flood ==');
  before = tv.got.length;
  for (var i = 0; i < 30; i++) room.webSocketMessage(p2, JSON.stringify({ type: 'spam', i: i }));
  ok('a phone sending 30 in one second gets exactly 20 through', tv.got.length === before + ROOM_MAX_PER_SEC, (tv.got.length - before) + ' got through');
  ok('and is not disconnected for it', p2.closed === null);
  NOW += 1000; before = tv.got.length;
  room.webSocketMessage(p2, JSON.stringify({ type: 'spam', i: 99 }));
  ok('the next second it speaks again', tv.got.length === before + 1);

  print('\n== a dead socket ==');
  p1.dead = true; before = tv.got.length;
  var n = room.relay(JSON.stringify({ type: 'go' }), null);
  ok('a socket that throws on send is skipped, the others still hear it', n === 3 && tv.got.length === before + 1, n + ' delivered');
  p1.dead = false;

  print('\n== the Worker drops a message in ==');
  before = tv.got.length;
  return room.fetch(new Request('https://room/publish', { method: 'POST', body: JSON.stringify({ payload: { type: 'reload', why: 'hq' } }) }));
}).then(function (r) {
  ok('/publish reaches every screen and says how many', r._json.ok === true && r._json.delivered === 4 && tv.got[tv.got.length - 1].type === 'reload', JSON.stringify(r._json));
  return room.fetch(new Request('https://room/publish', { method: 'POST', body: JSON.stringify({ payload: 'reload' }) }));
}).then(function (r) {
  ok('a payload without a type is refused', r.status === 400);

  print('\n== the Worker side without the binding ==');
  var replies = [];
  function json(o, s) { replies.push([o, s]); return { o: o, s: s }; }
  return Promise.all([
    handleRoomSocket(new Request('https://w/room/ws?room=vp-3A7TES&role=tv', { headers: { Upgrade: 'websocket' } }), {}, json),
    handleRoomPresence(new Request('https://w/room/presence?room=vp-3A7TES'), {}, json),
    roomPublish({}, 'vp-3A7TES', { type: 'reload' }),
  ]);
}).then(function (rs) {
  ok('socket and presence answer 503 "not enabled", publish answers 0, nothing throws',
     rs[0].s === 503 && rs[1].s === 503 && rs[2] === 0);

  /* THE GLOBAL OFF SWITCH. One variable in the Cloudflare dashboard puts every venue in
     the country back on Supabase within seconds, no deploy and nothing for a venue to do.
     It answers the SAME 503 a Worker with no binding answers, so it rides the fallback
     every page has been exercising all along instead of a second escape route that has
     never carried a night. */
  ok('roomOff reads the switch and nothing else', roomOff({ ROOM_OFF: '1' }) === true
     && roomOff({ ROOM_OFF: 'true' }) === true && roomOff({ ROOM_OFF: 'on' }) === true
     && roomOff({ ROOM_OFF: '0' }) === false && roomOff({ ROOM_OFF: '' }) === false
     && roomOff({}) === false);
  var offRs = [];
  function jsonOff(o, st) { offRs.push(st); return { o: o, s: st }; }
  var liveNs = { idFromName: function (n) { return 'id:' + n; }, get: function () { return { fetch: function () { return Promise.resolve(new Response(JSON.stringify({ ok: true, delivered: 3 }))); } }; } };
  var offEnv = { ROOM: liveNs, ROOM_OFF: '1' };
  return Promise.all([
    handleRoomSocket(new Request('https://w/room/ws?room=vp-3A7TES&role=tv', { headers: { Upgrade: 'websocket' } }), offEnv, jsonOff),
    handleRoomPresence(new Request('https://w/room/presence?room=vp-3A7TES'), offEnv, jsonOff),
    roomPublish(offEnv, 'vp-3A7TES', { type: 'reload' }),
  ]).then(function (off) {
    ok('the switch closes the socket route even with a binding present', off[0].s === 503);
    ok('and presence, with the same answer a missing binding gives', off[1].s === 503);
    ok('and the Worker stops publishing into rooms', off[2] === 0,
       'a reload pushed into a room nobody is listening to is a reload that did not happen');
  });
}).then(function () {
  var replies2 = [];
  function json2(o, s) { replies2.push(s); return { s: s }; }
  var fakeNs = { idFromName: function (n) { return 'id:' + n; }, get: function () { return { fetch: function () { return Promise.resolve(new Response(JSON.stringify({ ok: true, delivered: 2 }))); } }; } };
  return Promise.all([
    handleRoomSocket(new Request('https://w/room/ws?room=bad%20name&role=tv', { headers: { Upgrade: 'websocket' } }), { ROOM: fakeNs }, json2),
    roomPublish({ ROOM: fakeNs }, 'vp-3A7TES', { type: 'reload' }),
  ]);
}).then(function (rs) {
  ok('with the binding: a bad room name is refused, a publish reports what the room said', rs[0].s === 400 && rs[1] === 2);
}).catch(function (e) {
  bad++; print('  FAIL a chain rejected: ' + (e && (e.message + ' ' + e.stack) || e));
}).then(function () {
  print('');
  if (ran !== EXPECT) { bad++; print('  FAIL ' + ran + ' checks ran, ' + EXPECT + ' expected'); }
  if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
});
