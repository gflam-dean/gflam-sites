/* A stranger in the trivia answers room sends {t:"ans_ok", id:"a3"}. Does another phone hear it?

   It did: the room relayed everything that was not an answer, and the phone matched
   acknowledgements on guessable ids (audit, 20 Sep 2026). Runs the REAL VenueRoom class out of
   the shipped game Worker on the rig, with the Durable Object runtime stood in.

   Run from the repo root:  jsc tools/test-answers-room-relays-nothing.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var VenueRoom = globalThis.__VenueRoom;

/* The runtime: sockets that remember what they were sent, storage that is a map. */
function fakeSocket() { var att = null; return { sent: [], send: function (s) { this.sent.push(JSON.parse(s)); }, serializeAttachment: function (a) { att = a; }, deserializeAttachment: function () { return att; } }; }
function fakeState() { var socks = [], store = new Map(); return {
  acceptWebSocket: function (ws) { socks.push(ws); }, getWebSockets: function () { return socks.slice(); },
  storage: { get: async function (k) { return store.get(k); }, put: async function (k, v) { store.set(k, v); }, list: async function (o) { var m = new Map(); store.forEach(function (v, k) { if (k.indexOf(o.prefix) === 0) m.set(k, v); }); return m; } } }; }
var pairServer = null;
globalThis.WebSocketPair = function () { var s = fakeSocket(); pairServer = s; return { 0: {}, 1: s }; };
function Headers(h) { this.h = h || {}; } Headers.prototype.get = function (k) { return this.h[k] || null; };
function Req(url, headers) { this.url = url; this.headers = new Headers(headers); }
Response = function (body, init) { this.status = (init && init.status) || 200; this.webSocket = init && init.webSocket; };
async function join(room, name, role) { var url = 'https://room/ws?role=' + role + '&room=' + encodeURIComponent(name); var r = await room.fetch(new Req(url, { Upgrade: 'websocket' })); if (r.status !== 101) throw new Error('connect ' + r.status); return pairServer; }

(async function () {
  print('the answers room');
  var ans = new VenueRoom(fakeState(), {});
  var phoneA = await join(ans, 'vpa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'phone');
  var stranger = await join(ans, 'vpa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'phone');
  await ans.webSocketMessage(stranger, JSON.stringify({ t: 'ans_ok', id: 'a1', q: 1 }));
  await ans.webSocketMessage(stranger, JSON.stringify({ t: 'ans_no', id: 'a2', q: 1 }));
  await ans.webSocketMessage(stranger, JSON.stringify({ t: 'ball', n: 42 }));
  show('nothing a stranger sends into the answers room reaches another phone', phoneA.sent.length === 0, JSON.stringify(phoneA.sent));
  var H = 'a'.repeat(64);
  await ans.webSocketMessage(phoneA, JSON.stringify({ t: 'ans', g: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', q: 1, i: 2, h: H, id: 'a1-x9' }));
  show('a real answer is acknowledged to the phone that sent it', phoneA.sent.length === 1 && phoneA.sent[0].t === 'ans_ok' && phoneA.sent[0].id === 'a1-x9', JSON.stringify(phoneA.sent));
  show('and the other socket hears nothing of it', stranger.sent.length === 0, JSON.stringify(stranger.sent));

  print('a game room still relays, as it must');
  var game = new VenueRoom(fakeState(), {});
  var tv = await join(game, 'vp-test-pub', 'tv');
  var host = await join(game, 'vp-test-pub', 'host');
  await game.webSocketMessage(host, JSON.stringify({ t: 'ball', n: 42 }));
  show('a ball from the host reaches the telly', tv.sent.length === 1 && tv.sent[0].n === 42, JSON.stringify(tv.sent));
  show('and is not echoed back to the host', host.sent.length === 0);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('answers room: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
