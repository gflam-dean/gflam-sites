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


/* THE MINI BAR, 23 Oct 2026: a TV in a Chrome window nobody can see. Measured live in a hidden
   tab: the socket died at 4 min 20 s, supabase-js 2.118 would not reconnect a hidden page, and the
   2 s rebuild ran 91 s later. Rules 6, 7 and 8 of vp-channel.js, each against the real helper. */
print('\nrule 7: the window is seen again while a rebuild is waiting on its (throttled) timer');
var ev = {};
function fakeWin(vis) {
  var w = { console: { log: function () {} }, document: { visibilityState: vis || 'visible', addEventListener: function (n, f) { ev['doc:' + n] = f; } },
            addEventListener: function (n, f) { ev['win:' + n] = f; } };
  return w;
}
var win7 = fakeWin('visible'), helper7 = RIG.loadHelper(win7), w7 = RIG.makeClient(), got7 = [];
var k7 = helper7.keep(w7.client, 'vp-HIDDEN', {});
k7.on('broadcast', { event: 'msg' }, function () {});
k7.subscribe(function (s) { got7.push(s); });
RIG.advance(100);
check('CONTROL: joined, and the helper listens for the window coming back', got7.join() === 'SUBSCRIBED' && !!ev['doc:visibilitychange'] && !!ev['win:pageshow'] && !!ev['win:online'] && !!ev['win:focus'], Object.keys(ev));
w7.up = false;
w7.drop(w7.live('HIDDEN')[0], 'CHANNEL_ERROR');
check('the socket dies: the page hears the drop and a 2 s rebuild is booked', got7[got7.length - 1] === 'CHANNEL_ERROR' && k7.retrying() === true);
var joins0 = w7.joins;
win7.document.visibilityState = 'hidden'; ev['doc:visibilitychange']();
check('a change to HIDDEN pokes nothing (the library will not reconnect a hidden page, and neither should we hammer it)', w7.joins === joins0 && k7.retrying() === true);
RIG.advance(100);
w7.up = true;
win7.document.visibilityState = 'visible'; ev['doc:visibilitychange']();
check('THE WINDOW IS SEEN AGAIN: the rebuild runs NOW, not when the timer gets round to it', w7.joins === joins0 + 1 && k7.retrying() === false, [w7.joins - joins0, k7.retrying()]);
RIG.advance(50);
check('and the wall is subscribed again within one join (40 ms), with one live channel', got7[got7.length - 1] === 'SUBSCRIBED' && w7.live('HIDDEN').length === 1 && w7.joined('HIDDEN').length === 1, got7);
RIG.advance(5000);
check('the old 2 s timer did not fire a second rebuild on top (one channel, no flap)', w7.joins === joins0 + 1 && w7.live('HIDDEN').length === 1, w7.joins - joins0);
var joins1 = w7.joins;
ev['win:focus'](); ev['win:online'](); ev['win:pageshow']();
check('a connected channel is left alone by focus, online and pageshow', w7.joins === joins1 && w7.live('HIDDEN').length === 1);
k7.unsubscribe();
w7.drop(w7.live('HIDDEN')[0], 'CHANNEL_ERROR');
ev['win:focus']();
check('a channel that was hung up is never poked back to life', w7.joins === joins1 && w7.live('HIDDEN').length === 0);

print('\nrule 6: the heartbeat runs in a worker, only where a worker can be made');
function winWith(worker) {
  var w = fakeWin('visible'); w.Blob = function () {}; w.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
  if (worker) w.Worker = worker;
  return w;
}
var made = 0;
var o6 = RIG.loadHelper(winWith(function () { made++; this.terminate = function () {}; })).clientOptions();
check('a browser with Worker, Blob and URL.createObjectURL gets the worker heartbeat, every 15 s', JSON.stringify(o6) === JSON.stringify({ realtime: { worker: true, heartbeatIntervalMs: 15000 } }) && made === 1, o6);
check('a browser with no Worker gets the plain client (createClient would THROW if asked for a worker it cannot make)', JSON.stringify(RIG.loadHelper(fakeWin()).clientOptions()) === '{}');
check('a browser whose blob worker is refused (a CSP, a kiosk) gets the plain client too', JSON.stringify(RIG.loadHelper(winWith(function () { throw new Error('SecurityError'); })).clientOptions()) === '{}');
['venueplay/tv.html', 'venueplay/app/trivia/screen.html', 'venueplay/app/musical/screen.html', 'venueplay/app/raffle/screen.html', 'venueplay/app/members/screen.html'].forEach(function (f) {
  var src = readFile(f);
  check(f + ' hands clientOptions() to createClient, guarded, and loads the script that makes it',
        src.indexOf('supabase.createClient(SUPA_URL, SUPA_ANON, (window.VPChannel && VPChannel.clientOptions) ? VPChannel.clientOptions() : undefined)') > 0 && RIG.loadsScript(src, 'vp-channel.js'));
});

print('\nrule 8: supabase-js 2.11x hands back the channel it has not finished leaving');
function stickyClient() {
  var list = [], made = [];
  var c = { made: made,
    channel: function (name, opts) {
      var ex = list.filter(function (x) { return x.name === name; })[0];
      if (ex) return ex;                                   // the library's find-by-topic
      var ch = { name: name, state: 'closed', cb: null, subs: 0, ons: 0,
        on: function () { ch.ons++; return ch; },
        subscribe: function (cb) {
          if (ch.state !== 'closed') return ch;            // 2.118: a silent no-op, no status ever
          ch.cb = cb; ch.subs++; ch.state = 'joining';
          RIG.setTimeout(function () { if (ch.state === 'joining') { ch.state = 'joined'; cb('SUBSCRIBED'); } }, 40);
          return ch;
        },
        send: function () {},
        unsubscribe: function () {
          ch.state = 'leaving';
          RIG.setTimeout(function () { ch.state = 'closed'; list = list.filter(function (x) { return x !== ch; }); if (ch.cb) ch.cb('CLOSED'); }, 100);   // the server acks the leave
          return Promise.resolve('ok');
        } };
      list.push(ch); made.push(ch); return ch;
    },
    removeChannel: function (ch) { return ch.unsubscribe(); },
    getChannels: function () { return list; } };
  return c;
}
var c8 = stickyClient(), got8 = [], k8 = RIG.loadHelper(fakeWin()).keep(c8, 'vp-STICKY', {});
k8.on('broadcast', { event: 'msg' }, function () {});
k8.subscribe(function (s) { got8.push(s); });
RIG.advance(100);
check('CONTROL: joined on the first channel', got8.join() === 'SUBSCRIBED' && c8.made.length === 1);
c8.made[0].cb('CHANNEL_ERROR');                            // a transient error: the library still holds the channel
check('the drop books the 2 s rebuild', k8.retrying() === true);
RIG.advance(2000);
check('the rebuild asked the library and got its OWN old channel back (still leaving): it did not take it', k8.current() === null && c8.made.length === 1 && c8.made[0].subs === 1 && k8.retrying() === true, [c8.made.length, c8.made[0].subs]);
RIG.advance(300);
check('the leave lands, the next ask gets a FRESH channel, and it joins', c8.made.length === 2 && c8.made[1].subs === 1 && k8.current() === c8.made[1] && got8[got8.length - 1] === 'SUBSCRIBED', got8);
check('the old channel was never subscribed twice and its listeners were not doubled onto it', c8.made[0].subs === 1 && c8.made[0].ons === 1);

RIG.done('channel recovery, tv');
