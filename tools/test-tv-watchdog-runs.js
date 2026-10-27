/* The TV watchdog, RUN, not word-searched.

   check-tv-watchdog.py is ten substring tests over tv.html and the audit of 20 Sep 2026 replaced
   the black-screen reload with `strikes = 0;` and every gate stayed green. This lifts the real
   watchdog IIFE out of the shipped tv.html and drives it with a fake clock, a fake wall and a
   fake sessionStorage, and asserts what it DOES.

   Run from the repo root:  jsc tools/test-tv-watchdog-runs.js
*/
var SRC = readFile('venueplay/tv.html');
var bad = 0, ran = 0;
function show(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }

var i = SRC.indexOf('(function watchdog(){');
show('the watchdog is still in tv.html', i >= 0);
var depth = 0, j = SRC.indexOf('{', i), k;
for (k = j; k < SRC.length; k++) { if (SRC[k] === '{') depth++; else if (SRC[k] === '}') { depth--; if (!depth) break; } }
var IIFE = SRC.slice(i, k + 1) + ')();';

/* One world per scenario. Everything the watchdog touches is here and nothing else. */
function world(o) {
  o = o || {};
  var w = { now: 1700000000000, reloads: [], rebuilds: 0, ticks: [], store: {}, online: true,
            tvMode: o.tvMode || 'ads', deafSince: 0, lastHost: 0, lastBingo: 0, alive: o.alive !== false };
  var host = { querySelector: function (sel) { if (!w.alive) return null; return sel === '.ad' || sel === '.ad.show' ? {} : null; } };
  var sandbox = {
    Date: { now: function () { return w.now; } },
    setInterval: function (fn) { w.ticks.push(fn); return 1; },
    sessionStorage: { getItem: function (k) { return w.store[k] == null ? null : w.store[k]; }, setItem: function (k, v) { w.store[k] = String(v); } },
    navigator: { get onLine() { return w.online; } },
    location: { reload: function () { w.reloads.push(w.store.vpTvReloadWhy || ''); } },
    document: { getElementById: function (id) { return id === 'tvAds' ? host : null; }, addEventListener: function () {}, hidden: false },
    window: { addEventListener: function () {} }, console: { info: function () {} },
    buildAds: function () { w.rebuilds++; }, startAds: function () {}, adBuilt: true,
    fetch: function () { return new Promise(function () {}); },   // the deploy watcher inside the same closure never hears back; not under test here
    setTimeout: function () { return 0; },
  };
  var names = Object.keys(sandbox);
  /* The four page globals the watchdog reads are plain vars in the page; here they are
     re-read from the world before every tick through a closure the same Function owns. */
  var body = 'var tvMode = __w.tvMode, gameChannelsDeafSince = 0, lastHostAt = 0, lastBingoAt = 0;\n'
    + IIFE + '\n'
    + 'return function(){ tvMode = __w.tvMode; gameChannelsDeafSince = __w.deafSince; lastHostAt = __w.lastHost; lastBingoAt = __w.lastBingo; };';
  var sync = new Function(names.concat(['__w']).join(','), body).apply({}, names.map(function (n) { return sandbox[n]; }).concat([w]));
  w.tick = function (ms) { w.now += (ms == null ? 20000 : ms); sync(); w.ticks.forEach(function (f) { f(); }); };
  return w;
}

print('a black wall: one rebuild, then one reload');
var a = world({ alive: false });
a.tick(); show('first bad sample: nothing yet', a.rebuilds === 0 && a.reloads.length === 0);
a.tick(); show('second: the slides are rebuilt in place', a.rebuilds === 1 && a.reloads.length === 0);
a.tick(); show('third: the repair did not take, so the page reloads', a.reloads.length === 1 && a.reloads[0] === 'black-screen', JSON.stringify(a.reloads));

print('offline: never a reload');
var b = world({ alive: false }); b.online = false;
b.tick(); b.tick(); b.tick(); b.tick();
show('a dead wall with no network is left showing its stale slides, not a browser error', b.reloads.length === 0, b.reloads.length + ' reloads');

print('a reload inside three minutes of the last is refused');
var c = world({ alive: false }); c.store.vpTvReloadAt = String(c.now);
c.tick(); c.tick(); c.tick(); c.tick(30000); c.tick(30000);       // two minutes since the last reload, five bad samples
show('no reload while the last one is under MIN_GAP old', c.reloads.length === 0, c.reloads.length + ' reloads');
c.tick(70000);                                                       // past three minutes
show('and one once the gap has passed', c.reloads.length === 1, c.reloads.length + ' reloads');

print('a game on the wall is left alone');
var d = world({ tvMode: 'bingo', alive: false }); d.lastHost = d.now;
for (var t = 0; t < 6; t++) { d.lastHost = d.now; d.tick(); }
show('six checks during a live game: no rebuild, no reload', d.rebuilds === 0 && d.reloads.length === 0);

print('a game that has been silent ten minutes is a frozen board');
var e = world({ tvMode: 'bingo' }); e.lastHost = e.now - 11 * 60000;
e.tick(); e.tick();
show('two strikes on a frozen game: reload, not a slide rebuild', e.reloads.length === 1 && e.reloads[0] === 'frozen-game' && e.rebuilds === 0, JSON.stringify(e.reloads));

print('deaf channels');
var f = world({ tvMode: 'trivia' }); f.lastHost = f.now; f.deafSince = f.now - 5 * 60000;
f.tick();
show('channels deaf for over four minutes reload the screen even mid game', f.reloads.length === 1 && f.reloads[0] === 'channels-deaf', JSON.stringify(f.reloads));

print('four hours idle');
var g = world(); g.tick(4 * 3600000 + 30000);
show('an idle screen four hours old reloads to pick up new code', g.reloads.length === 1 && g.reloads[0] === 'max-age', JSON.stringify(g.reloads));
var h = world({ tvMode: 'bingo' }); h.lastHost = h.now; h.tick(4 * 3600000 + 30000);
show('but never while a game is on', h.reloads.length === 0);

if (bad) throw new Error('tv watchdog: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
