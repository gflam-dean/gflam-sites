/* ONE ROAD PER VENUE: THE ROOM HANDS A WHOLE VENUE OVER, AND REMEMBERS IT.

   31 Oct 2026, making the room server the default. A page that goes back to Supabase on
   its own is a page talking to nobody, so leaving is the ROOM's decision: when any page
   hands it over, every socket in it is told (in words, then by close code 4503) and the
   room turns away anyone who asks for six hours, so a phone that joins late lands on the
   same road as everyone else. The global switch ROOM_OFF reaches rooms that are already
   open the same way. And the heartbeat ("ping" / "pong") is answered.

   Runs the REAL VenueRoom class and the real Worker-side routes from venueplay-room.js
   against a scripted Durable Object state, the same rig venueplay-room.test.js uses.

   Run: jsc venueplay-backend/worker/venueplay-room-handover.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-room.js');
var bad = 0, ran = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

function URL(u) {
  var m = /^[a-z]+:\/\/[^\/]+(\/[^?]*)?(\?(.*))?$/.exec(u);
  this.pathname = (m && m[1]) || '/';
  var q = {}; ((m && m[3]) || '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  this.searchParams = { get: function (k) { return q.hasOwnProperty(k) ? q[k] : null; } };
}
function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; this.ok = this.status >= 200 && this.status < 300; this.webSocket = init && init.webSocket; this._json = body ? JSON.parse(body) : null; }
Response.prototype.json = function () { return Promise.resolve(this._json); };
function Request(url, init) {
  if (url && typeof url === 'object') { init = init || {}; url = url.url; }
  this.url = url; this.method = (init && init.method) || 'GET';
  this.headers = { get: function (k) { return (init && init.headers && init.headers[k]) || null; } }; this._body = init && init.body;
}
Request.prototype.json = function () { return Promise.resolve(JSON.parse(this._body)); };

var NOW = 5000000;
var Date = { now: function () { return NOW; } };
if (typeof clearTimeout !== 'function') { var clearTimeout = function () {}; }

var sockets = [];
function FakeSocket(label) { this.label = label; this.got = []; this.raw = []; this.closed = null; this.att = null; }
FakeSocket.prototype.send = function (s) { if (this.closed) throw new Error('closed'); this.raw.push(s); try { this.got.push(JSON.parse(s)); } catch (e) {} };
FakeSocket.prototype.close = function (c, r) { this.closed = [c, r]; this.gone = true; };
FakeSocket.prototype.serializeAttachment = function (o) { this.att = JSON.parse(JSON.stringify(o)); };
FakeSocket.prototype.deserializeAttachment = function () { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; };
var pairN = 0;
function WebSocketPair() { var s = new FakeSocket('s' + (++pairN)); this[0] = { client: true, of: s }; this[1] = s; }

var STORE = new Map();
var storage = {
  get: function (k) { return Promise.resolve(STORE.has(k) ? JSON.parse(JSON.stringify(STORE.get(k))) : undefined); },
  put: function (k, v) { STORE.set(k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); },
  list: function (o) { var pre = (o && o.prefix) || ''; var m = new Map(); Array.from(STORE.keys()).sort().forEach(function (k) { if (k.indexOf(pre) === 0) m.set(k, STORE.get(k)); }); return Promise.resolve(m); },
  delete: function (keys) { var n = 0; (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (STORE.delete(k)) n += 1; }); return Promise.resolve(n); },
};
var state = {
  storage: storage,
  acceptWebSocket: function (ws, tags) { ws.tags = tags || []; sockets.push(ws); },
  getWebSockets: function (tag) { return sockets.filter(function (w) { return !w.gone && (!tag || w.tags.indexOf(tag) >= 0); }); },
};

/* The class and routes from the real file; eval keeps let/const/class to its own scope, var reaches here.
   The source is this repo's own Durable Object, read from disk, never anything fetched. */
eval(src.replace(/^export \{[\s\S]*?\};?\s*$/m, '')
        .replace(/^export /mg, '')
        .replace(/^const /mg, 'var ')
        .replace(/^class VenueRoom /m, 'var VenueRoom = class VenueRoom '));

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }
function join(room, role) { return room.fetch(new Request('https://room/ws?role=' + role + '&room=vp-ABC123', { headers: { Upgrade: 'websocket' } })); }

(async function () {
  var room = new VenueRoom(state, {});

  print('== a room says it can hand a venue over ==');
  var pr = (await room.fetch(new Request('https://room/presence')))._json;
  ok('presence says handover: true and pong: true, which is how a page knows it may take the room by default',
     pr.handover === true && pr.pong === true, JSON.stringify(pr));

  print('== the heartbeat ==');
  var tv = (await join(room, 'tv')).webSocket.of, host = (await join(room, 'host')).webSocket.of;
  var p1 = (await join(room, 'phone')).webSocket.of, p2 = (await join(room, 'phone')).webSocket.of;
  await room.webSocketMessage(p1, 'ping');
  ok('a ping is answered pong, to that socket alone', p1.raw[p1.raw.length - 1] === 'pong' && tv.raw.length === 0 && p2.raw.length === 0);

  print('== nobody but the room may say hand over ==');
  await room.webSocketMessage(p1, JSON.stringify({ t: 'room_handover' }));
  ok('a phone saying room_handover is relayed to nobody', tv.got.length === 0 && host.got.length === 0 && p2.got.length === 0);
  ok('and the room is still open', !tv.closed && !host.closed);

  print('== a page hands the room over ==');
  var r = await room.fetch(new Request('https://room/handover', { method: 'POST' }));
  ok('the handover answers ok and counts four sockets closed', r.status === 200 && r._json.closed === 4, JSON.stringify(r._json));
  ok('every socket heard room_handover in words', [tv, host, p1, p2].every(function (s) { return s.got.some(function (m) { return m.t === 'room_handover'; }); }));
  ok('and was closed with 4503, the code that means "go to Supabase, do not retry"', [tv, host, p1, p2].every(function (s) { return s.closed && s.closed[0] === 4503; }));
  var pr2 = await room.fetch(new Request('https://room/presence'));
  ok('a page asking afterwards is told 503, room handed over', pr2.status === 503 && pr2._json.handed_over === true, JSON.stringify(pr2._json));
  var late = await join(room, 'phone');
  ok('and a phone that joins late is turned away the same way, so it goes where everyone is', late.status === 503 && !late.webSocket);

  print('== the mark is on disk ==');
  var fresh = new VenueRoom(state, {});
  ok('a room evicted and woken again still turns people away', (await fresh.fetch(new Request('https://room/presence'))).status === 503);
  NOW += ROOM_HANDOVER_MS - 60000;
  ok('still handed over just inside six hours', (await fresh.fetch(new Request('https://room/presence'))).status === 503);
  NOW += 120000;
  var back = await fresh.fetch(new Request('https://room/presence'));
  ok('and open again after six hours: the next night is on the room', back.status === 200 && back._json.handover === true);
  await fresh.fetch(new Request('https://room/handover', { method: 'POST' }));
  NOW += 5 * 60 * 60 * 1000;
  await fresh.fetch(new Request('https://room/handover', { method: 'POST' }));
  NOW += 2 * 60 * 60 * 1000;
  ok('a console asking again during a long night extends the mark', (await fresh.fetch(new Request('https://room/presence'))).status === 503);
  NOW += 5 * 60 * 60 * 1000;

  print('== ROOM_OFF reaches a room that is already open ==');
  sockets.length = 0; STORE.clear();
  var env = { ROOM_OFF: '' };
  var r2 = new VenueRoom(state, env);
  var a = (await join(r2, 'host')).webSocket.of, b = (await join(r2, 'tv')).webSocket.of, c = (await join(r2, 'phone')).webSocket.of;
  await r2.webSocketMessage(a, JSON.stringify({ t: 'ball', n: 1 }));
  ok('control: with the switch off the ball reaches the TV', b.got.some(function (m) { return m.t === 'ball'; }));
  env.ROOM_OFF = '1';
  await r2.webSocketMessage(a, JSON.stringify({ t: 'ball', n: 2 }));
  ok('the next message after the switch sends everyone across: closed 4503, all three',
     [a, b, c].every(function (s) { return s.closed && s.closed[0] === 4503; }));
  ok('and that ball is not relayed into a room that is being emptied', !b.got.some(function (m) { return m.t === 'ball' && m.n === 2; }));
  env.ROOM_OFF = '';
  ok('and the room stays handed over when the switch is turned off again, so a late phone does not land in an empty room',
     (await r2.fetch(new Request('https://room/presence'))).status === 503);

  print('== the Worker route ==');
  var none = await handleRoomHandover(new Request('https://w/room/handover?room=vp-ABC123', { method: 'POST' }), {}, json);
  ok('no binding: 503, which the page takes as an answer', none.status === 503);
  var seen = [];
  var ns = { idFromName: function (n) { return 'id:' + n; },
             get: function (id) { return { fetch: function (u) { seen.push(id + ' ' + u); return Promise.resolve(json({ ok: true, closed: 2 })); } }; } };
  var badName = await handleRoomHandover(new Request('https://w/room/handover?room=vpa-11111111-1111-4111-8111-111111111111', { method: 'POST' }), { ROOM: ns }, json);
  ok('an answers room (vpa-) is never handed over', badName.status === 400 && seen.length === 0);
  var offToo = await handleRoomHandover(new Request('https://w/room/handover?room=vp-ABC123', { method: 'POST' }), { ROOM: ns, ROOM_OFF: '1' }, json);
  ok('with ROOM_OFF on it still reaches the room, so the mark is set while the switch is on',
     offToo.status === 200 && seen.length === 1 && /id:vp-ABC123 https:\/\/room\/handover/.test(seen[0]), seen.join(','));
  var ns503 = { idFromName: function (n) { return n; }, get: function () { return { fetch: function () { return Promise.resolve(json({ error: 'room handed over', handed_over: true }, 503)); } }; } };
  var pres = await handleRoomPresence(new Request('https://w/room/presence?room=vp-ABC123'), { ROOM: ns503 }, json);
  ok('the Worker passes a handed-over room\'s 503 on, instead of answering it 200', pres.status === 503 && pres._json.handed_over === true);

  print('\n== 1 Nov 2026: a venue is five rooms, and goes as one ==');
  /* The same hash four ways: the TV's venueCode, vp-session.js's VP.venueCode, the game Worker's
     fnvVenueCode and the room's own. A room name built one way and handed over another is a venue
     that never moves. */
  function liftFn(text, name) {
    var i = text.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('cannot find ' + name);
    var d = 0, k = text.indexOf('{', i);
    do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
    return text.slice(i, k);
  }
  var tvCode = new Function(liftFn(find('venueplay/tv.html'), 'venueCode') + '; return venueCode;')();
  var wCode = new Function(liftFn(find('venueplay-backend/worker/venueplay-game.js'), 'fnvVenueCode') + '; return fnvVenueCode;')();
  var sess = find('venueplay/app/vp-session.js');
  var sx = /venueCode\s*[:=]\s*function\s*\(([^)]*)\)\s*\{/.exec(sess);
  var sCode = null;
  if (sx) { var si = sx.index + sx[0].length - 1, sd = 0, sk = si; do { if (sess[sk] === '{') sd++; else if (sess[sk] === '}') sd--; sk++; } while (sd > 0); sCode = new Function(sx[1], sess.slice(si + 1, sk - 1)); }
  else { try { sCode = new Function(liftFn(sess, 'venueCode') + '; return venueCode;')(); } catch (e) { sCode = null; } }
  var slugs = ['test-alpha', 'the-mini-bar', 'tugun-bowls', 'musical-test-alpha', 'trivia-hello-hotel', 'raffle-gen-hotel', 'members-x', 'a', 'gen-hotel-4210'];
  var agree = slugs.every(function (sl) { var c = roomVenueCode(sl); return c === tvCode(sl) && c === wCode(sl) && (!sCode || c === sCode(sl)); });
  ok('the room\'s venue code is the same hash as the TV\'s, vp-session.js\'s and the game Worker\'s', agree && !!sCode, sCode ? '' : 'could not lift VP.venueCode');
  var five = roomVenueRooms('test-alpha');
  ok('a venue is five rooms: bingo, then trivia, musical, raffle and members screen channels',
     five.length === 5 && five[0] === 'vp-' + tvCode('test-alpha') && five[2] === 'vp-' + tvCode('musical-test-alpha') && five[4] === 'vp-' + tvCode('members-test-alpha'), five.join(','));
  ok('a slug that is not a slug names no rooms', roomVenueRooms('../x').length === 0 && roomVenueRooms('').length === 0);

  var calls = [];
  var nsV = { idFromName: function (n) { return n; },
              get: function (id) { return { fetch: function (u) { calls.push(id + ' ' + u); return Promise.resolve(json({ ok: true, closed: 1 })); } }; } };
  var rv = await handleRoomHandover(new Request('https://w/room/handover?room=' + five[2] + '&venue=test-alpha', { method: 'POST' }), { ROOM: nsV }, json);
  ok('a handover naming the venue reaches all five rooms', rv.status === 200 && rv._json.rooms === 5 && calls.length === 5 &&
     five.every(function (n) { return calls.some(function (c) { return c.indexOf(n + ' https://room/handover') === 0; }); }), calls.join(' | '));
  ok('and counts the sockets it closed across them', rv._json.closed === 5, JSON.stringify(rv._json));
  calls = [];
  await handleRoomHandover(new Request('https://w/room/handover?room=vp-ZZZZZZ&venue=test-alpha&soft=1', { method: 'POST' }), { ROOM: nsV }, json);
  ok('a players\' room on a join code of its own goes with them, and soft is passed to each room',
     calls.length === 6 && calls[0].indexOf('vp-ZZZZZZ ') === 0 && calls.every(function (c) { return /\?soft=1$/.test(c); }), calls.join(' | '));
  calls = [];
  var rb = await handleRoomHandover(new Request('https://w/room/handover?room=vp-ABC123&venue=..%2Fetc', { method: 'POST' }), { ROOM: nsV }, json);
  ok('a venue that is not a slug is refused and reaches nothing', rb.status === 400 && calls.length === 0);

  print('\n== soft: the word passed on does not push a mark later ==');
  sockets.length = 0; STORE.clear();
  var r3 = new VenueRoom(state, {});
  var s1 = (await join(r3, 'tv')).webSocket.of;
  var pv = (await r3.fetch(new Request('https://room/presence')))._json;
  ok('presence says venue: true, which is how a page of another format knows it may take the room by default', pv.venue === true, JSON.stringify(pv));
  await r3.fetch(new Request('https://room/handover?soft=1', { method: 'POST' }));
  ok('a soft handover of an open room still empties it, 4503', s1.closed && s1.closed[0] === 4503);
  var until1 = STORE.get('ho');
  ok('and marks it, because it was not marked', until1 > NOW);
  NOW += 60 * 60 * 1000;
  await r3.fetch(new Request('https://room/handover?soft=1', { method: 'POST' }));
  ok('a second soft handover an hour later leaves the mark where it was', STORE.get('ho') === until1, STORE.get('ho') - until1);
  await r3.fetch(new Request('https://room/handover', { method: 'POST' }));
  ok('a hard one (a console still on Supabase saying so again) extends it', STORE.get('ho') > until1);

  print('\n== a console from before the switch opens a game ==');
  /* Whatever the shipped flips say, these scenes start with every format off and switch on what
     they need: the flip commits change ROOM_FORMATS_ON, and a suite must not change with them. */
  var shippedFlips = {}; for (var sf in ROOM_FORMATS_ON) { shippedFlips[sf] = ROOM_FORMATS_ON[sf]; ROOM_FORMATS_ON[sf] = false; }
  calls = [];
  var looked = 0;
  function slugOf() { looked++; return Promise.resolve('test-alpha'); }
  var n0 = await roomOldConsoleCheck({ ROOM: nsV }, 'room', 'musical', slugOf);
  var n1 = await roomOldConsoleCheck({ ROOM: nsV }, 'off', 'musical', slugOf);
  ok('a console on the room, or on a format not on the room yet, costs nothing: no lookup, no room touched', n0 === 0 && n1 === 0 && looked === 0 && calls.length === 0);
  await roomOldConsoleCheck({ ROOM: nsV }, undefined, 'musical', slugOf);
  ok('one that says nothing is from before the switch: the whole venue is handed over, hard', looked === 1 && calls.length === 5 && calls.every(function (c) { return !/soft/.test(c); }), calls.join(' | '));
  calls = [];
  await roomOldConsoleCheck({ ROOM: nsV }, 'supabase', 'musical', slugOf);
  ok('one that already left the room passes the word on softly', calls.length === 5 && calls.every(function (c) { return /soft=1/.test(c); }));
  calls = [];
  var nb = await roomOldConsoleCheck({}, undefined, 'musical', slugOf);
  ok('no binding: nothing at all', nb === 0 && calls.length === 0 && looked === 2);
  print('\n== which formats are on the room is the Worker\'s answer ==');
  ok('presence carries formats, one line per format', ['musical', 'trivia', 'raffle', 'members'].every(function (k) { return typeof pv.formats[k] === 'boolean'; }), JSON.stringify(pv.formats));
  ok('roomFormatsKey is the formats that are on, sorted and comma joined (the TV compares it)',
     roomFormatsKey() === Object.keys(ROOM_FORMATS_ON).filter(function (k) { return ROOM_FORMATS_ON[k]; }).sort().join(','), roomFormatsKey());
  var keep = {}; for (var kk in ROOM_FORMATS_ON) keep[kk] = ROOM_FORMATS_ON[kk];
  ROOM_FORMATS_ON.musical = true; ROOM_FORMATS_ON.trivia = true;
  ok('two formats on reads "musical,trivia", in that order whatever order they were switched on', roomFormatsKey() === 'musical,trivia', roomFormatsKey());
  calls = []; looked = 0;
  await roomOldConsoleCheck({ ROOM: nsV }, 'off', 'musical', slugOf);
  ok('a console that was told musical was off, opening musical once it is on, decided before the flip: the venue moves to meet it',
     looked === 1 && calls.length === 5 && calls.every(function (c) { return !/soft/.test(c); }), calls.join(' | '));
  calls = []; looked = 0;
  await roomOldConsoleCheck({ ROOM: nsV }, 'off', 'raffle', slugOf);
  ok('the same word for a format that is still off is still true: nothing', looked === 0 && calls.length === 0);
  for (var kk2 in keep) ROOM_FORMATS_ON[kk2] = keep[kk2];
  for (var sf2 in shippedFlips) ROOM_FORMATS_ON[sf2] = shippedFlips[sf2];
  var thrown = await roomOldConsoleCheck({ ROOM: nsV }, undefined, 'musical', function () { return Promise.reject(new Error('db down')); });
  ok('a database that fails the lookup never fails the console\'s request', thrown === 0);

  print('');
  print(bad ? (bad + ' OF ' + ran + ' CHECKS FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('room handover: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
