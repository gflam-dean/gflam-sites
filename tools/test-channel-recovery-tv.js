/* THE VENUE TV: ITS BINGO CHANNEL COMES BACK, AND EVERY CHANNEL'S DEAFNESS COUNTS.

   Audit, 27 Sep 2026, three faults on the screen that runs unattended for weeks:
     1. The MAIN channel (bingo, vp-<code>) said Reconnecting after a CLOSED and never tried
        again, and the watchdog did not count it, so nothing ever repaired it.
     2. The four game channels shared ONE "deaf since" time, and any one of them coming back
        set it to 0. A channel dead all night beside one that blipped now and then never
        reached four minutes, and the watchdog never reloaded.
     3. The flip side of that shared time: one dead channel with nothing resetting it
        reloaded the screen in the middle of a game that was being heard perfectly well.

   This assembles the REAL pieces of venueplay/tv.html, lifted by their own text: noteDeaf(),
   tvStatus(), tvSend(), connectRealtime(), the game-channel reconnect block and the whole
   watchdog IIFE, and runs them together with the REAL /app/vp-channel.js on a virtual clock
   against a fake realtime client (tools/rig-channel.js). Then it asserts what the TV DOES.

   Run from the repo root:  jsc tools/test-channel-recovery-tv.js
*/
load('tools/rig-channel.js');
var check = RIG.check;
var HTML = readFile('venueplay/tv.html');
var helper = RIG.loadHelper({ console: { log: function () {} } });

check('tv.html loads /app/vp-channel.js in a real script tag', RIG.loadsScript(HTML, 'vp-channel.js'));

function piece(name) { var s = RIG.lift(HTML, name); if (!s) print('  (tv.html has no ' + name + ')'); return s; }
var NOTEDEAF = piece('noteDeaf');
check('noteDeaf() is in tv.html: every channel keeps its own clock', !!NOTEDEAF);
var TVSTATUS = piece('tvStatus'), TVSEND = piece('tvSend'), CONNECT = piece('connectRealtime');
var a = HTML.indexOf('var tries = 0, retryT = null;');
var b = HTML.indexOf('\n      join();\n', a);
var BLOCK = HTML.slice(a, b + '\n      join();\n'.length);
var w0 = HTML.indexOf('(function watchdog(){');
var WATCHDOG = HTML.slice(w0, RIG.braceEnd(HTML, HTML.indexOf('{', w0)) + 1) + ')();';
if (!TVSTATUS || !TVSEND || !CONNECT || a < 0 || b < 0 || w0 < 0) throw new Error('cannot assemble the TV from tv.html');

/* One TV per scenario. */
function tv(opts) {
  opts = opts || {};
  var world = RIG.makeClient(), dom = RIG.makeDom();
  var store = {}, reloads = [];
  var sessionStorage = { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
  var win = { VPChannel: helper, addEventListener: function () {} };
  var ads = { querySelector: function (sel) { return sel === '.ad' || sel === '.ad.show' ? {} : null; } };
  var document = { getElementById: function (id) { return id === 'tvAds' ? ads : dom.el(id); }, querySelector: function (s) { return dom.el(s); },
                   documentElement: dom.el('html'), addEventListener: function () {}, visibilityState: 'visible' };
  var sandbox = {
    supabase: { createClient: function () { return world.client; } }, SUPA_URL: 'u', SUPA_ANON: 'k', CODE: 'ACDEFG', VP_GAME_API: 'x',
    vpGate: function (p, cb) { cb(p); }, onMsg: function () {}, $: dom.$, document: document, window: win, VPChannel: helper,
    sessionStorage: sessionStorage, navigator: { onLine: true },
    location: { reload: function () { reloads.push({ why: store.vpTvReloadWhy || '', at: RIG.now() }); }, origin: '', pathname: '/tv' },
    console: { log: function () {}, info: function () {}, warn: function () {} },
    buildAds: function () {}, startAds: function () {}, fetch: function () { return new Promise(function () {}); },
    setTimeout: RIG.setTimeout, clearTimeout: RIG.clearTimeout, setInterval: RIG.setInterval
  };
  var names = Object.keys(sandbox);
  var body =
    'var tvMode = "ads", lastHostAt = Date.now(), lastBingoAt = 0, adBuilt = true;\n' +
    'var gameChannelsDeafSince = 0, anyChannelDeafSince = 0, channelDeafSince = {};\n' +
    (NOTEDEAF || 'function noteDeaf(){}') + '\n' +
    'var client = null, ch = null, tvSubscribed = false, _rtTries = 0, _useRoom = false, _roomTried = false, _room = null;\n' +
    TVSEND + '\n' + TVSTATUS + '\n' + CONNECT + '\n' +
    'connectRealtime();\n' +
    'var VENUE_SLUG = "the-pub"; function venueCode(s){ return "C-" + s; }\n' +
    '["trivia","musical","raffle","members"].forEach(function(game){\n' +
    '  var c = client.channel("vp-" + venueCode(game + "-" + VENUE_SLUG), { config:{ broadcast:{ self:false } } });\n' +
    '  function onGameMsg(e){ lastHostAt = Date.now(); }\n' +
    '  c.on("broadcast", { event:"msg" }, onGameMsg);\n' + BLOCK + '});\n' +
    WATCHDOG + '\n' +
    'return { mode: function(v){ tvMode = v; }, host: function(){ lastHostAt = Date.now(); lastBingoAt = Date.now(); },\n' +
    '         sub: function(){ return tvSubscribed; }, any: function(){ return anyChannelDeafSince; }, all: function(){ return gameChannelsDeafSince; } };';
  var page = new Function(names.join(','), body).apply(null, names.map(function (n) { return sandbox[n]; }));
  if (opts.mode) page.mode(opts.mode);
  return { world: world, page: page, reloads: reloads, store: store, status: function () { return dom.el('statusText').textContent; } };
}
function whys(t) { return t.reloads.map(function (r) { return r.why; }); }
var MAIN = 'vp-ACDEFG';
function mainLive(w) { return w.live().filter(function (c) { return c.name === MAIN; }); }

print('\nthe bingo channel is closed by the server');
var t1 = tv(), w1 = t1.world;
RIG.advance(500);
check('CONTROL: the bingo channel and four game channels join', w1.joined().length === 5 && t1.page.sub() === true, w1.joined().length);
w1.drop(mainLive(w1)[0], 'CLOSED');
check('it says Reconnecting and stops announcing into the dead channel', t1.page.sub() === false && t1.status() === 'Reconnecting', t1.status());
check('and the watchdog can see the bingo channel is deaf', t1.page.any() > 0, t1.page.any());
RIG.advance(5000);
var m1 = mainLive(w1);
check('THE BINGO CHANNEL IS JOINED AGAIN. It used to stay on Reconnecting all night', m1.length === 1 && m1[0].state === 'joined' && t1.page.sub() === true, m1.length);
check('and it said tv_here to the host on the new one', m1.length === 1 && m1[0].sent.some(function (m) { return m.payload && m.payload.t === 'tv_here'; }));
check('and it is no longer counted as deaf', t1.page.any() === 0 && t1.page.all() === 0, [t1.page.any(), t1.page.all()]);
RIG.advance(30 * 60 * 1000);
check('no reload, no flap, while everything hears', t1.reloads.length === 0 && mainLive(w1).length === 1, whys(t1));

print('\nthe bingo channel stays dead, with the ads up');
var t2 = tv(), w2 = t2.world;
RIG.advance(500);
w2.dead = function (n) { return n === MAIN; };
w2.drop(mainLive(w2)[0], 'CLOSED');
RIG.advance(6 * 60 * 1000);
check('THE WATCHDOG COUNTS IT: the idle screen reloads', whys(t2).indexOf('channel-deaf') >= 0, whys(t2));

print('\none game channel dead all night, another blipping, with the ads up');
var t3 = tv(), w3 = t3.world;
RIG.advance(500);
w3.dead = function (n) { return n.indexOf('trivia') >= 0; };
w3.drop(w3.joined('trivia')[0], 'CLOSED');
for (var i = 0; i < 4; i++) { RIG.advance(170 * 1000); w3.dropAll('CLOSED', 'musical'); }
RIG.advance(60 * 1000);
check('A DEAD CHANNEL IS NOT HIDDEN BY ANOTHER ONE HEALING: the idle screen reloads', whys(t3).indexOf('channel-deaf') >= 0, whys(t3));
var first = t3.reloads.length ? t3.reloads[0].at : 0;
RIG.advance(20 * 60 * 1000);
check('but not again inside half an hour, for the same reason', t3.reloads.filter(function (r) { return r.why === 'channel-deaf'; }).length === 1, whys(t3));
RIG.advance(12 * 60 * 1000);
check('and again after that, because it is still deaf', t3.reloads.filter(function (r) { return r.why === 'channel-deaf'; }).length === 2 && t3.reloads[1].at - first >= 30 * 60 * 1000, whys(t3));

print('\none game channel dead in the middle of a game');
var t4 = tv({ mode: 'embed' }), w4 = t4.world;
RIG.advance(500);
w4.dead = function (n) { return n.indexOf('raffle') >= 0; };
w4.drop(w4.joined('raffle')[0], 'CLOSED');
for (var j = 0; j < 45; j++) { t4.page.host(); RIG.advance(20 * 1000); }
check('A GAME THAT IS BEING HEARD IS NEVER RELOADED for one deaf channel (15 minutes)', t4.reloads.length === 0, whys(t4));
check('and the channel is still being retried', w4.joins > 20, w4.joins);

print('\nevery channel deaf in the middle of a game');
var t5 = tv({ mode: 'bingo' }), w5 = t5.world;
RIG.advance(500);
t5.page.host();
w5.up = false;
w5.dropAll('CLOSED');
RIG.advance(5 * 60 * 1000);
check('a screen that hears nothing at all is reloaded, even mid game, as it always was', whys(t5).indexOf('channels-deaf') >= 0, whys(t5));

RIG.done('channel recovery, tv');
