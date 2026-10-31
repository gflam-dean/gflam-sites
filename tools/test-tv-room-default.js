/* THE TV ON THE ROOM SERVER, RUN FROM THE SHIPPED tv.html.

   31 Oct 2026, the room becomes the default. Three things the TV got wrong on the room, all
   silent, all found by reading what connectRealtime() does when it takes the room:
     1. It never made a Supabase client, so the unified router (which waits for one) never
        started: a TV on the room never followed a trivia, musical, raffle or members night.
     2. tvSend() spoke only Supabase, so the TV said tv_here to a console in the room ONCE and
        never again.
     3. The Worker's own words in a room ({type:"reload"}, HQ's commands) were read by nothing.
   And the new rule: a TV in the room keeps one ear on the old road, and hearing a console there
   hands the room over and moves to it, on the same client, without a second connection.

   Runs connectRealtime() and tvSend() lifted out of venueplay/tv.html, with the REAL vp-room.js,
   against a fake Supabase, a fake fetch and a fake WebSocket on a virtual clock.

   Run: jsc tools/test-tv-room-default.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 2000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(text, name) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in tv.html - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var TV = find('venueplay/tv.html');
var ROOMJS = find('venueplay/app/vp-room.js').replace('var DEFAULT_ON = false;', 'var DEFAULT_ON = true;');
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

/* ---- a virtual clock ---- */
var NOW = 1000, timers = [], tid = 1;
var Date = { now: function () { return NOW; } };
function setTimeout(fn, ms) { var id = tid++; timers.push({ id: id, at: NOW + (ms || 0), fn: fn }); return id; }
function clearTimeout(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
function tick(ms) {
  var end = NOW + ms;
  for (var g = 0; g < 5000; g++) {
    drainMicrotasks();
    timers.sort(function (a, b) { return a.at - b.at; });
    var t = timers[0];
    if (!t || t.at > end) break;
    NOW = Math.max(NOW, t.at); timers.shift();
    try { t.fn(); } catch (e) { print('  [timer threw] ' + e); }
    drainMicrotasks();
  }
  NOW = end; drainMicrotasks();
}

/* ---- the world the TV talks to ---- */
var clients = [], posts = [], socks = [], presence = { total: 0, answers: true, handover: true, pong: true };
function makeClient() {
  var c = { chans: [], removed: [],
    channel: function (name) {
      var ch = { name: name, sent: [], h: null, st: null, gone: false,
        on: function (a, b, fn) { this.h = fn; return this; },
        subscribe: function (fn) { this.st = fn; var me = this; setTimeout(function () { if (!me.gone) fn('SUBSCRIBED'); }, 5); return this; },
        send: function (m) { this.sent.push(m.payload); },
        unsubscribe: function () { this.gone = true; } };
      c.chans.push(ch); return ch;
    },
    removeChannel: function (ch) { setTimeout(function () { ch.gone = true; }, 50); return Promise.resolve('ok'); },
    getChannels: function () { return c.chans.filter(function (x) { return !x.gone; }); } };
  clients.push(c); return c;
}
var supabase = { createClient: function () { return makeClient(); } };
function fetch(url, init) {
  if (init && init.method === 'POST') { posts.push(url); return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true }); } }); }
  return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve(presence); } });
}
function WebSocket(url) {
  var s = this; this.url = url; this.readyState = 0; this.sent = []; socks.push(this);
  setTimeout(function () { s.readyState = 1; if (s.onopen) s.onopen(); }, 10);
}
WebSocket.prototype.send = function (x) { this.sent.push(x); };
WebSocket.prototype.close = function () { this.readyState = 3; };
var attrs = {}, listeners = {};
var document = { visibilityState: 'visible', documentElement: { setAttribute: function (k, v) { attrs[k] = v; } },
                 addEventListener: function (e, f) { (listeners[e] = listeners[e] || []).push(f); },
                 querySelector: function () { return null; } };
var window = { addEventListener: function () {} };
var location = { search: '', reload: function () {} };
var sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
var console = { log: function () {}, info: function () {} };
/* This repo's own room client, read from disk; nothing is fetched. */
eval(ROOMJS);
var VPRoom = window.VPRoom;

/* ---- what connectRealtime() reads from the page around it ---- */
var VP_GAME_API = 'https://game.venueplay.com.au', CODE = 'ACDEFG', SUPA_URL = 'https://x.supabase.co', SUPA_ANON = 'anon';
var _rtTries = 0, client = null, ch = null, tvSubscribed = false;
var _useRoom = false, _roomTried = false, _room = null, _roomClient = false, _ear = null, _roomVenue = false;
var VENUE_SLUG = 'test-alpha';
var got = [], deaf = {}, statusShown = [], asked = 0;
function vpGate(p, cb) { if (p && p.forged) return; cb(p); }
function onMsg(m) { got.push(m); }
function noteDeaf(n, d) { deaf[n] = d; }
function tvStatus(c) { statusShown.push(!!c); }
window.__vpTvAsk = function () { asked++; };
eval(lift(TV, 'tvVenueGroup'));
eval(lift(TV, 'tvSend'));
eval(lift(TV, 'connectRealtime'));

ok('control: the page decides the room by asking vp-room.js, which says yes by default here', VPRoom.wanted() === true);
_useRoom = VPRoom.wanted();

print('\n== the TV takes the room ==');
connectRealtime();
tick(100);
ok('it opened a room socket for vp-' + CODE, socks.length === 1 && /room=vp-ACDEFG&role=tv/.test(socks[0].url), socks.length && socks[0].url);
ok('it made ONE Supabase client, for the router and the ear', clients.length === 1 && client === clients[0], clients.length);
ok('the router can start: client is there', !!client);
ok('the screen counts as connected and records its road', tvSubscribed === true && attrs['data-vp-transport'] === 'room');
var hellos = socks[0].sent.filter(function (s) { return /"t":"tv_here"/.test(s); }).length;
ok('the TV said hello into the room', hellos === 1, hellos);
tvSend({ t: 'tv_here' });
ok('and tvSend, the one kept identical in five pages, now speaks into the room too', socks[0].sent.filter(function (s) { return /"t":"tv_here"/.test(s); }).length === 2);
var ear = clients[0].chans.filter(function (c) { return c.name === 'vp-' + CODE; });
ok('it keeps one ear on the old road: a channel on vp-' + CODE + ', on the same client', ear.length === 1 && !ear[0].gone);

print('\n== messages in the room ==');
socks[0].onmessage({ data: JSON.stringify({ t: 'ball', n: 12 }) });
ok('a ball reaches the TV through the signature gate', got.length === 1 && got[0].n === 12);
socks[0].onmessage({ data: JSON.stringify({ t: 'ball', n: 13, forged: true }) });
ok('a forged one is stopped there, as on Supabase', got.length === 1);
socks[0].onmessage({ data: JSON.stringify({ type: 'reload', at: 'x' }) });
ok('HQ\'s reload, published into the room, makes the TV ask the Worker now', asked === 1 && got.length === 1, 'asked ' + asked);

print('\n== a console on the old road ==');
ear[0].h({ payload: { t: 'host_here', fmt: 'musical' } });
ear[0].h({ payload: { t: 'host_here', rw: 1 } });
tick(50);
ok('another game\'s console and another page\'s ear are not mistaken for it', socks[0].readyState === 1 && posts.length === 0);
ear[0].h({ payload: { t: 'host_here' } });
tick(10);
ok('a bingo console there: the TV hands the room over', posts.length === 1 && /\/room\/handover\?room=vp-ACDEFG/.test(posts[0]), posts.join(','));
tick(500);
var main = clients[0].chans.filter(function (c) { return c.name === 'vp-' + CODE && !c.gone; });
ok('and moves to Supabase on the SAME client, after the ear has let go of the name', clients.length === 1 && main.length === 1 && main[0] !== ear[0],
   'clients ' + clients.length + ', live channels on the name ' + main.length);
ok('it records the new road', attrs['data-vp-transport'] === 'supabase');
ok('tvSend now speaks Supabase', main[0].sent.some(function (m) { return m.t === 'tv_here'; }));

print('\n== the room closes the TV with 4503 (ROOM_OFF, or another page handed it over) ==');
clients = []; socks = []; posts = []; got = []; attrs = {};
client = null; ch = null; tvSubscribed = false; _useRoom = true; _roomTried = false; _room = null; _roomClient = false; _ear = null;
eval(ROOMJS); VPRoom = window.VPRoom;      // a reloaded page: a fresh vp-room.js, so a fresh venue group
connectRealtime(); tick(100);
ok('control: in the room', socks.length === 1 && attrs['data-vp-transport'] === 'room');
socks[0].readyState = 3; socks[0].onclose({ code: 4503 });
tick(500);
/* 1 Nov 2026: it no longer tells nobody. The room that sent it across may have been handed over by
   a phone that knows no venue, so the TV passes the word to the venue's other rooms, SOFTLY (an
   existing mark is not pushed later). It never hands a room over hard on the room's own say so. */
ok('it goes to Supabase at once; the only word it sends is the soft pass-on to the venue\'s rooms',
   attrs['data-vp-transport'] === 'supabase' && socks.length === 1 && posts.length === 1 && /&venue=test-alpha&soft=1$/.test(posts[0]), posts.join(','));

print('\n== 1 Nov 2026: a Worker that hands the whole venue over, and hears old consoles itself ==');
clients = []; socks = []; posts = []; got = []; attrs = {};
client = null; ch = null; tvSubscribed = false; _useRoom = true; _roomTried = false; _room = null; _roomClient = false; _ear = null; _roomVenue = false;
eval(ROOMJS); VPRoom = window.VPRoom;
presence = { total: 0, answers: true, handover: true, pong: true, venue: true, formats: { musical: true, trivia: false, raffle: false, members: false } };
connectRealtime(); tick(100);
ok('control: in the room', socks.length === 1 && attrs['data-vp-transport'] === 'room');
var anyChan = clients.length ? clients[0].chans.filter(function (c) { return !c.gone; }).length : 0;
ok('NO ear on the old road: the TV holds no Supabase channel at all while the venue is on the room', anyChan === 0, anyChan + ' channel(s)');
socks[0].readyState = 3; socks[0].onclose({ code: 4503 });
tick(500);
var bingoNow = clients[0].chans.filter(function (c) { return c.name === 'vp-' + CODE && !c.gone; });
ok('and when the room sends it across it goes to Supabase on bingo\'s channel, one channel', attrs['data-vp-transport'] === 'supabase' && bingoNow.length === 1, bingoNow.length);
ok('it passes the word on to the venue\'s other rooms, softly, naming the venue',
   posts.some(function (u) { return /\/room\/handover\?room=vp-ACDEFG&venue=test-alpha&soft=1/.test(u); }), posts.join(','));

print('');
print(bad ? (bad + ' OF ' + ran + ' CHECKS FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error('tv room default: ' + bad + ' failed');
