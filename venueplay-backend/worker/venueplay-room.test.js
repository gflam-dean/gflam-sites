/* THE ROOM RELAYS TO EVERYONE BUT THE SENDER, AND NOTHING ELSE.

   Runs the real VenueRoom class from venueplay-room.js against a scripted Durable
   Object state and scripted sockets. Checks: a message from one screen reaches every
   other screen and not itself (Supabase broadcast {self:false}, which the pages rely
   on); presence counts by role; junk, oversize and flood messages go nowhere; the
   Worker's /publish reaches everyone; the Worker-side helpers are no-ops without the
   binding. And, since phase 2, that the room HOLDS a trivia answer without scoring it:
   on disk, one per player, stamped with the moment it arrived, handed to the Worker at
   Reveal, still there after the room is evicted, and refused once the question is closed.

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
var EXPECT = 66;
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
function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; this.ok = this.status >= 200 && this.status < 300; this.webSocket = init && init.webSocket; this._json = body ? JSON.parse(body) : null; }
Response.prototype.json = function () { return Promise.resolve(this._json); };
function Request(url, init) { this.url = url; this.method = (init && init.method) || 'GET'; this.headers = { get: function (k) { return (init && init.headers && init.headers[k]) || null; } }; this._body = init && init.body; }
Request.prototype.json = function () { return Promise.resolve(JSON.parse(this._body)); };

var NOW = 1000000;
var Date = { now: function () { return NOW; } };
/* jsc's shell has setTimeout but no clearTimeout. Workers and browsers have both, and the
   reveal's "do not wait on the room" timer clears the one it set. Without this the timer
   call throws in here only, and the check that proves the room is optional goes red for a
   reason that has nothing to do with the room. */
if (typeof clearTimeout !== 'function') { var clearTimeout = function () {}; }

var sockets = [];    // every server-side socket the room accepted, in order
function FakeSocket(label) { this.label = label; this.got = []; this.closed = null; this.att = null; }
FakeSocket.prototype.send = function (s) { if (this.dead) throw new Error('dead'); this.got.push(JSON.parse(s)); };
FakeSocket.prototype.close = function (c, r) { this.closed = [c, r]; };
FakeSocket.prototype.serializeAttachment = function (o) { this.att = JSON.parse(JSON.stringify(o)); };
FakeSocket.prototype.deserializeAttachment = function () { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; };
var pairN = 0;
function WebSocketPair() { var s = new FakeSocket('s' + (++pairN)); this[0] = { client: true, of: s }; this[1] = s; }

/* DURABLE OBJECT STORAGE, faked the way Cloudflare's behaves: it is on DISK, so it is the
   one thing that survives the room being evicted or hibernated. The eviction check below
   throws the room object away and builds a new one over this same store, which is exactly
   what Cloudflare does when nobody has spoken for a while. */
var STORE = new Map();
var storage = {
  get: function (k) { return Promise.resolve(STORE.has(k) ? JSON.parse(JSON.stringify(STORE.get(k))) : undefined); },
  put: function (k, v) { STORE.set(k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); },
  list: function (o) {
    var pre = (o && o.prefix) || '';
    var m = new Map();
    Array.from(STORE.keys()).sort().forEach(function (k) { if (k.indexOf(pre) === 0) m.set(k, JSON.parse(JSON.stringify(STORE.get(k)))); });
    return Promise.resolve(m);
  },
  delete: function (keys) {
    var n = 0;
    (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (STORE.delete(k)) n += 1; });
    return Promise.resolve(n);
  },
};

var state = {
  tags: [],
  storage: storage,
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
  /* The phone reads this to decide whether the Worker it is talking to is new enough to hold
     its answers. The site deploys itself from a push and the Worker does not, so for a while
     the new page talks to the old Worker, whose room can only pass a message on. */
  ok('presence says whether this room can hold answers at all', pr.answers === true, JSON.stringify(pr));
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
  return answersInTheRoom();
}).catch(function (e) {
  bad++; print('  FAIL a chain rejected: ' + (e && (e.message + ' ' + e.stack) || e));
}).then(function () {
  print('');
  if (ran !== EXPECT) { bad++; print('  FAIL ' + ran + ' checks ran, ' + EXPECT + ' expected'); }
  if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
});

/* PHASE 2: THE ANSWERS LIVE IN THE ROOM UNTIL THE HOST REVEALS.
   Thirty phones answering every twenty-five seconds is thirty database writes a question,
   and that is what took fifteen trivia rooms past what the database will serve. So the room
   holds them and hands them over once. The whole risk of that is a lost answer, so most of
   what follows is about not losing one: it is written to DISK, it survives the room being
   evicted, the first answer is the one that counts, and nothing is deleted until the Worker
   says the row is actually in the database.
   The room still scores NOTHING. What comes out is the option tapped and the moment it
   arrived. Whether that was in time, whether it was right and what it is worth are all
   still the database's, on exactly the path they were on before. */
async function answersInTheRoom() {
  var G  = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  var G2 = '11111111-2222-3333-4444-555555555555';
  var H1 = new Array(65).join('1');
  var H2 = new Array(65).join('2');
  var H3 = new Array(65).join('3');
  var H4 = new Array(65).join('4');
  function say(ws, obj) { return room.webSocketMessage(ws, JSON.stringify(obj)); }
  function last(ws) { return ws.got.length ? ws.got[ws.got.length - 1] : null; }
  function post(r, path, body) { return r.fetch(new Request('https://room' + path, { method: 'POST', body: JSON.stringify(body) })); }

  print('\n== a phone answers a trivia question ==');
  var a1 = (await join('phone')).webSocket.of;
  var a2 = (await join('phone')).webSocket.of;
  var tvBefore = tv.got.length, otherBefore = a2.got.length;
  await say(a1, { t: 'ans', g: G, q: 1, i: 2, h: H1, id: 'm1' });
  ok('the phone is told its answer is in', last(a1) && last(a1).t === 'ans_ok' && last(a1).id === 'm1' && last(a1).q === 1, JSON.stringify(last(a1)));
  ok('and it went to DISK, not to a variable that dies with the room', STORE.has('a|' + G + '|1|' + H1));
  ok('no other phone and no screen hears what it picked',
     a2.got.length === otherBefore && tv.got.length === tvBefore, 'an answer is not a broadcast');
  var stored = STORE.get('a|' + G + '|1|' + H1);
  ok('the room stamps it with the moment it arrived, and stores nothing else',
     stored && stored.at === NOW && stored.i === 2 && Object.keys(stored).sort().join(',') === 'at,i', JSON.stringify(stored));

  await say(a1, { t: 'ans', g: G, q: 1, i: 3, h: H1, id: 'm2' });
  ok('the same phone answering again is told its first answer stands', last(a1).t === 'ans_dup', JSON.stringify(last(a1)));
  ok('and the first answer is the one still held', STORE.get('a|' + G + '|1|' + H1).i === 2);

  await say(a1, { t: 'ans', g: G, q: 1, i: 0, h: H2 });
  ok('one socket may not answer as somebody else', last(a1).t === 'ans_no' && !STORE.has('a|' + G + '|1|' + H2));

  NOW += 500;
  await say(a2, { t: 'ans', g: G, q: 1, i: 0, h: H2, id: 'm3' });
  ok('a second phone is held under its own name', last(a2).t === 'ans_ok' && STORE.get('a|' + G + '|1|' + H2).i === 0);

  print('\n== a phone that is a second late hears so, as it always has ==');
  var a5 = (await join('phone')).webSocket.of;
  await say(a5, { t: 'ans', g: G, q: 1, i: 1, h: H4, e: NOW - 1 });
  ok('an answer past the deadline the phone was given is refused, not held',
     last(a5).t === 'ans_late' && !STORE.has('a|' + G + '|1|' + H4),
     'the punter must not be told "Answer in!" and then score nothing');
  await say(a5, { t: 'ans', g: G, q: 1, i: 1, h: H4, e: NOW + 5000 });
  ok('and one still inside it is held', last(a5).t === 'ans_ok' && STORE.has('a|' + G + '|1|' + H4));
  await post(room, '/answers/ack', { game_id: G, qseq: 1, hashes: [H4] });   // tidy: this one is not part of the handover below

  print('\n== junk answers are refused, and the phone is told so ==');
  var a3 = (await join('phone')).webSocket.of;
  await say(a3, { t: 'ans', g: 'not-a-game', q: 1, i: 1, h: H3 });
  ok('a made-up game id is refused', last(a3).t === 'ans_no');
  await say(a3, { t: 'ans', g: G, q: 1, i: 1, h: 'zz' });
  ok('a token hash that is not a hash is refused', last(a3).t === 'ans_no');
  await say(a3, { t: 'ans', g: G, q: 1, i: 99, h: H3 });
  ok('an option nobody could have tapped is refused', last(a3).t === 'ans_no');
  await say(a3, { t: 'ans', g: G, q: 0, i: 1, h: H3 });
  ok('a question number of zero is refused', last(a3).t === 'ans_no');
  ok('and not one of them reached storage', !STORE.has('a|' + G + '|1|' + H3));

  print('\n== nothing carrying a credential is ever relayed ==');
  tvBefore = tv.got.length;
  await say(a3, { t: 'join', tok: 'a-token-shaped-thing' });
  ok('a message with a token in it reaches nobody', tv.got.length === tvBefore,
     'one page sending a raw token would hand it to every phone in the pub');

  print('\n== the host reveals, and the Worker takes what the room holds ==');
  var d = (await post(room, '/answers', { game_id: G, qseq: 1 }))._json;
  ok('every answer for that question is handed over, oldest first',
     d.ok === true && d.answers.length === 2 && d.answers[0].h === H1 && d.answers[1].h === H2, JSON.stringify(d));
  ok('each carries the option tapped and the time it arrived, and nothing else',
     d.answers[0].i === 2 && d.answers[0].at === NOW - 500 && Object.keys(d.answers[0]).sort().join(',') === 'at,h,i',
     JSON.stringify(d.answers[0]));
  ok('the room scored none of it: no correctness, no points anywhere in the handover',
     JSON.stringify(d).indexOf('correct') < 0 && JSON.stringify(d).indexOf('points') < 0);
  ok('and nothing is deleted until the Worker says the rows are in the database',
     STORE.has('a|' + G + '|1|' + H1) && STORE.has('a|' + G + '|1|' + H2));

  NOW += 100;
  await say(a3, { t: 'ans', g: G, q: 1, i: 1, h: H3 });
  ok('a phone answering after the host revealed is refused, not quietly held',
     last(a3).t === 'ans_late' && !STORE.has('a|' + G + '|1|' + H3));
  await say(a1, { t: 'ans', g: G, q: 2, i: 1, h: H1 });
  ok('and the next question is open again', last(a1).t === 'ans_ok' && STORE.has('a|' + G + '|2|' + H1));

  var a4 = (await join('phone')).webSocket.of;
  await say(a4, { t: 'ans', g: G2, q: 1, i: 3, h: H3 });
  var d2 = (await post(room, '/answers', { game_id: G, qseq: 2 }))._json;
  ok('another game running in the same room is not swept up with it',
     d2.answers.length === 1 && d2.answers[0].h === H1 && STORE.has('a|' + G2 + '|1|' + H3), JSON.stringify(d2));

  print('\n== the rows are in the database, so the room lets them go ==');
  var d3 = (await post(room, '/answers/ack', { game_id: G, qseq: 1, hashes: [H1] }))._json;
  ok('only what the Worker actually wrote is deleted',
     d3.deleted === 1 && !STORE.has('a|' + G + '|1|' + H1) && STORE.has('a|' + G + '|1|' + H2),
     'a write that failed must leave the answers where they are');
  await post(room, '/answers', { game_id: G, qseq: 3 });
  ok('an answer the Worker never managed to write is still there for the next tap on Reveal',
     STORE.has('a|' + G + '|1|' + H2), 'a failed write must not be a lost prize');

  /* A TRIVIA NIGHT IS SERVED IN A RANDOM ORDER. vp_host_question walks config.question_seqs
     by POSITION, so current_seq is the seq of the question just served, not a counter, and
     the next question very often has a LOWER number than the one before it. A tidier
     "everything up to here is closed" mark was written first and would have refused every
     answer to every question after the first high-numbered one, on every randomised night,
     with nothing on any screen to say so. */
  print('\n== a night served out of order ==');
  await post(room, '/answers', { game_id: G2, qseq: 900 });
  await say(a4, { t: 'ans', g: G2, q: 7, i: 1, h: H3 });
  ok('a question with a LOWER number, served after a higher one, still takes answers',
     last(a4).t === 'ans_ok' && STORE.has('a|' + G2 + '|7|' + H3), JSON.stringify(last(a4)));
  await say(a4, { t: 'ans', g: G2, q: 900, i: 1, h: H3 });
  ok('and the one that was closed is still closed', last(a4).t === 'ans_late');

  print('\n== hours later ==');
  NOW += 7 * 60 * 60 * 1000;
  await post(room, '/answers', { game_id: G, qseq: 6 });
  ok('an answer nothing could score for six hours is swept, and so is its closing mark',
     !STORE.has('a|' + G + '|1|' + H2) && !STORE.has('c|' + G + '|1'));

  print('\n== the room is evicted mid question ==');
  await say(a2, { t: 'ans', g: G, q: 4, i: 1, h: H2 });
  var fresh = new VenueRoom(state, {});     // a brand new object over the same disk: memory is gone
  ok('the new room starts with nothing in memory', fresh.counts.size === 0);
  var d4 = (await post(fresh, '/answers', { game_id: G, qseq: 4 }))._json;
  ok('the answer survives the eviction and is still handed to the Worker',
     d4.answers.length === 1 && d4.answers[0].h === H2 && d4.answers[0].i === 1, JSON.stringify(d4));
  await say(a1, { t: 'ans', g: G, q: 5, i: 1, h: H1 });
  var fresh2 = new VenueRoom(state, {});
  await fresh2.webSocketMessage(a1, JSON.stringify({ t: 'ans', g: G, q: 5, i: 3, h: H1 }));
  ok('and after an eviction a phone still cannot change the answer it already gave',
     last(a1).t === 'ans_dup' && STORE.get('a|' + G + '|5|' + H1).i === 1, JSON.stringify(last(a1)));

  print('\n== the Worker side of the answers room ==');
  ok('the answers room is named after the GAME, so a reveal needs no lookup to find it',
     roomAnswerName(G) === 'vpa-' + G && ROOM_NAME_RE.test(roomAnswerName(G)));
  var none = await Promise.all([roomAnswersTake({}, G, 1), roomAnswersAck({}, G, 1, [H1])]);
  ok('with no room binding the Worker takes nothing and nothing throws', none[0] === null && none[1] === 0);
  var ns = { idFromName: function (n) { return 'id:' + n; },
             get: function () { return { fetch: function () { return Promise.resolve(roomJson({ ok: true, answers: [{ h: H1, i: 1, at: 5 }] })); } }; } };
  ok('the global off switch stops the Worker asking a room for answers at all',
     (await roomAnswersTake({ ROOM: ns, ROOM_OFF: '1' }, G, 1)) === null);
  var got = await roomAnswersTake({ ROOM: ns }, G, 1);
  ok('with the binding on, it returns exactly what the room handed over',
     got && got.length === 1 && got[0].h === H1, JSON.stringify(got));
  var deaf = { ROOM: { idFromName: function (n) { return n; },
                       get: function () { return { fetch: function () { return new Promise(function () {}); } }; } } };
  ok('a room that never answers does not hold the host\'s reveal up',
     (await roomAnswersTake(deaf, G, 1)) === null,
     'the reveal goes ahead with what the database has, which is what a venue with no room does');
}
