/* SIGNED MESSAGES PLAYED BACK, AND A CONSOLE'S FIRST WORDS BEFORE ITS KEY (14 Oct 2026 audit).

     1. The game screen inside /tv is a fresh page after every hop, so its in-memory nonce set was
        empty and a signed message recorded earlier in the night was accepted again: last game's
        "winner" on the wall mid-game, a recorded to_ads pulling a live game to the ads.
     2. A console sent "volume" before initHost had been called, so signSend had no key attempt to
        wait on and it went out unsigned; an enforcing TV dropped it.

   Runs the REAL venueplay/app/vp-sign.js, several times over: one console page, and receiver pages
   (/tv and the game frames inside it) that share ONE sessionStorage the way frames in a browser tab
   do. tools/rig-fake-webcrypto.js stands in for WebCrypto: only the holder of the venue's private
   key can make a signature that verifies, which is the one property this needs.

   Run from the repo root:  jsc tools/test-signing-15-oct.js
*/
load('tools/rig-fake-webcrypto.js');
var SRC = readFile('venueplay/app/vp-sign.js');
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   -> ' + extra : '')); } }

/* The world: one clock, timers fired by hand, one venue key. */
var W = { now: 1791900000000, timers: [], seed: 0, rnd: 7 };   // rnd: one random stream for every page, so no two nonces collide by accident
function setTimeout_(fn, ms) { var t = { at: W.now + (ms || 0), fn: fn, live: true }; W.timers.push(t); return t; }
function clearTimeout_(t) { if (t) t.live = false; }
function tick(ms) { W.now += ms; var due = W.timers.filter(function (t) { return t.live && t.at <= W.now; }); due.forEach(function (t) { t.live = false; t.fn(); }); }
var KEY = {};
crypto.subtle.generateKey().then(function (kp) {
  return Promise.all([crypto.subtle.exportKey('jwk', kp.publicKey), crypto.subtle.exportKey('jwk', kp.privateKey)]);
}).then(function (j) { KEY.pub = j[0]; KEY.priv = j[1]; });
drainMicrotasks();

function fetchFake(url) {
  if (url.indexOf('/venue/signing/public') >= 0) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ exists: true, enforce: true, kid: 'k1', public_jwk: KEY.pub }); } });
  if (url.indexOf('/host/signing/private') >= 0) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ has_key: true, enforce: true, kid: 'k1', private_jwk: KEY.priv, public_jwk: KEY.pub }); } });
  return Promise.resolve({ ok: false });
}
/* One browser tab's sessionStorage, shared by /tv and every frame inside it. */
function Tab() { var d = {}; return { getItem: function (k) { return (k in d) ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; }, _d: d }; }

/* Load the real file as one page. opts: { path, tab, skew (ms), noStorage }. */
function page(opts) {
  var hide = [];
  var win = {
    crypto: { subtle: crypto.subtle, getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { W.rnd = (Math.imul(W.rnd, 1103515245) + 12345) >>> 0; a[i] = (W.rnd >>> 16) & 255; } return a; } },
    location: { pathname: opts.path || '/tv' },
    addEventListener: function (t, f) { if (t === 'pagehide') hide.push(f); }
  };
  if (opts.noStorage) Object.defineProperty(win, 'sessionStorage', { get: function () { throw new Error('SecurityError'); } });
  else win.sessionStorage = opts.tab;
  var skew = opts.skew || 0;
  var D = { now: function () { return W.now + skew; } };
  (new Function('window', 'fetch', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'TextEncoder', 'btoa', 'atob', 'console', 'document', SRC))(
    win, fetchFake, D, setTimeout_, clearTimeout_, function () { return 1; }, function () {}, TextEncoder, btoa, atob,
    { warn: function () {}, log: function () {}, info: function () {} }, undefined);
  var p = { win: win, V: win.VPSign, got: [], hide: function () { hide.forEach(function (f) { f(); }); } };
  return p;
}
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function drain() { for (var i = 0; i < 8; i++) drainMicrotasks(); }
/* A console page: sends through the real signSend, and keeps what went down the wire. */
function consolePage(skew) {
  var c = page({ path: '/app/musical/host', tab: Tab(), skew: skew });
  c.wire = [];
  c.say = function (obj) { c.V.signSend(obj, function (p) { c.wire.push(copy(p)); }); drain(); return c.wire[c.wire.length - 1]; };
  return c;
}
function hear(r, msg) { r.V.gate(copy(msg), function (m) { r.got.push(m.t + (m.tag ? ':' + m.tag : '')); }); drain(); }
function last(r) { return r.got[r.got.length - 1] || ''; }
function receiver(path, tab, o) { o = o || {}; var r = page({ path: path, tab: tab, noStorage: o.noStorage }); r.V.initReceiver('https://w', 'test-venue'); drain(); return r; }

print('\n== a console signs who it is and in what order ==');
var C = consolePage(0);
C.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
var m1 = C.say({ t: 'state', tag: 'a' }), m2 = C.say({ t: 'state', tag: 'b' });
ok('every message carries a sender id and a counter', typeof m1._sid === 'string' && m1._sid.length > 6 && m1._seq === 1 && m2._seq === 2, JSON.stringify(m1));
ok('the sender id is inside what is signed (changing it breaks the signature)', (function () {
  var t = receiver('/tv', Tab()); var f = copy(m1); f._sid = 'someone-else'; hear(t, f); return t.got.length === 0;
})());
var C2 = consolePage(0); C2.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
ok('two console pages get different sender ids', C2.say({ t: 'state' })._sid !== m1._sid);

print('\n== the audit\'s replay: last game\'s winner and to_ads, played to a fresh game frame ==');
var TAB = Tab();
var tv = receiver('/tv', TAB), f1 = receiver('/app/musical/screen', TAB);
var winOld = C.say({ t: 'winner', tag: 'old', name: 'WWWW' });
var adsOld = C.say({ t: 'to_ads', tag: 'old' });
hear(tv, winOld); hear(f1, winOld); hear(tv, adsOld); hear(f1, adsOld);
ok('live, the winner and to_ads reach the TV and the frame', tv.got.join() === 'winner:old,to_ads:old' && f1.got.join() === 'winner:old,to_ads:old', tv.got.join() + ' / ' + f1.got.join());
tick(5 * 60 * 1000);                          // five minutes on: the next game is running
f1.hide();                                    // the frame is thrown away on the hop (pagehide)
var live1 = C.say({ t: 'song', tag: 'live1' });
hear(tv, live1);
var f2 = receiver('/app/musical/screen', TAB); // a fresh game frame, exactly what /tv embeds after a hop
hear(f2, live1);
ok('the fresh frame hears the live game', last(f2) === 'song:live1', f2.got.join());
hear(f2, winOld);
ok('the recorded winner is refused by the fresh frame', f2.got.indexOf('winner:old') < 0, f2.got.join());
hear(f2, adsOld);
ok('the recorded to_ads is refused by the fresh frame', f2.got.indexOf('to_ads:old') < 0, f2.got.join());
hear(tv, winOld);
ok('and by /tv itself', tv.got.join() === 'winner:old,to_ads:old,song:live1', tv.got.join());
var f3 = receiver('/app/musical/screen', TAB);
hear(f3, winOld);
ok('a frame that has not heard a single live message yet refuses it too (the tab remembered)', f3.got.length === 0, f3.got.join());
tick(1500);                                    // a second passes: /tv writes what it heard (at most once a second)
var raf = receiver('/app/raffle/screen', TAB);   // a frame for another game, which never heard that winner at all
hear(raf, winOld);
ok('so does a frame that never heard the winner: it is behind what the tab has heard from that console', raf.got.length === 0, raf.got.join());

print('\n== nothing real is refused ==');
var live2 = C.say({ t: 'song', tag: 'live2' });
hear(tv, live2); hear(f2, live2);
ok('the SAME live message reaches /tv and the frame inside it, in either order', last(tv) === 'song:live2' && last(f2) === 'song:live2');
var live3 = C.say({ t: 'song', tag: 'live3' });
hear(f2, live3); hear(tv, live3);
ok('frame first, then /tv', last(tv) === 'song:live3' && last(f2) === 'song:live3');
var slow = C.say({ t: 'state', tag: 'slow' });
tick(20 * 1000);
var fast = C.say({ t: 'state', tag: 'fast' });
hear(f2, fast); hear(f2, slow);
ok('a message overtaken by a later one on a slower path (20s) still lands', last(f2) === 'state:slow', f2.got.join());
var SKEW = consolePage(-2 * 60 * 60 * 1000);   // a second console at the venue, its clock two hours behind
SKEW.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
var sk = SKEW.say({ t: 'state', tag: 'skewed' });
hear(tv, sk); hear(f2, sk);
ok('a second console with a clock two hours out is heard alongside the first', last(tv) === 'state:skewed' && last(f2) === 'state:skewed', tv.got.join());
var after = C.say({ t: 'state', tag: 'first-again' });
hear(tv, after);
ok('and the first console is still heard after it', last(tv) === 'state:first-again');
var JUMP = consolePage(0); JUMP.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
var j1 = JUMP.say({ t: 'state', tag: 'j1' }); hear(tv, j1);
// The same console's clock is corrected backwards ten minutes mid-night: its counter still rises.
var realNow = W.now; W.now -= 10 * 60 * 1000;
var j2 = JUMP.say({ t: 'state', tag: 'j2' }); hear(tv, j2);
W.now = realNow;
ok('a console whose clock is corrected backwards ten minutes is still heard', last(tv) === 'state:j2', tv.got.join());

print('\n== a console that has since closed ==');
var OLD = consolePage(0); OLD.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
var TAB2 = Tab(), tv2 = receiver('/tv', TAB2), g1 = receiver('/app/trivia/screen', TAB2);
var oldLast = OLD.say({ t: 'idle', tag: 'closing' });
hear(tv2, oldLast); hear(g1, oldLast);
g1.hide();
tick(3 * 60 * 1000);
var NEW = consolePage(0); NEW.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
var g2 = receiver('/app/trivia/screen', TAB2);
hear(g2, NEW.say({ t: 'question', tag: 'q1' }));
hear(g2, oldLast);
ok('the closed console\'s last idle cannot be played to the next game frame', g2.got.join() === 'question:q1', g2.got.join());

print('\n== it can never cost a screen its game ==');
var nos = receiver('/tv', null, { noStorage: true });
var ns = C.say({ t: 'ball', tag: 'n1' }); hear(nos, ns);
ok('a browser that refuses sessionStorage still hears every live message', last(nos) === 'ball:n1', nos.got.join());
hear(nos, ns);
ok('and still refuses an instant replay in memory', nos.got.join() === 'ball:n1', nos.got.join());
var forged = copy(C.say({ t: 'ball', tag: 'real' })); forged._seq = 999999; forged.tag = 'forged';
var TAB3 = Tab(), tv3 = receiver('/tv', TAB3);
hear(tv3, forged);
var nextReal = C.say({ t: 'ball', tag: 'next' }); hear(tv3, nextReal);
ok('a forged message with a huge counter is dropped and does not poison the table', tv3.got.join() === 'ball:next', tv3.got.join());
var old = C.say({ t: 'ball', tag: 'unsid' }); delete old._sid; delete old._seq;
var tv4 = receiver('/tv', Tab());
ok('(control) without the sender fields the message no longer verifies, so they are really signed', (hear(tv4, old), tv4.got.length === 0));
for (var i = 0; i < 40; i++) { var cp = consolePage(0); cp.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain(); hear(tv3, cp.say({ t: 'state', tag: 's' + i })); }
tick(2000);
var heldS = JSON.parse(TAB3.getItem('vpSign.senders') || '{}'), heldN = JSON.parse(TAB3.getItem('vpSign.n:/tv') || '[]');
ok('what the tab keeps is bounded: at most 24 senders', Object.keys(heldS).length > 0 && Object.keys(heldS).length <= 24, Object.keys(heldS).length + '');
ok('and at most 300 nonces for a page', heldN.length > 0 && heldN.length <= 300, heldN.length + '');
ok('/tv and the frame keep separate nonce lists (they hear the same messages)', TAB.getItem('vpSign.n:/tv') && TAB.getItem('vpSign.n:/app/musical/screen') && TAB.getItem('vpSign.n:/tv') !== TAB.getItem('vpSign.n:/app/musical/screen'));

print('\n== a console\'s first words wait for its key ==');
W.timers = [];
var EARLY = page({ path: '/app/musical/host', tab: Tab() }); EARLY.wire = [];
EARLY.V.signSend({ t: 'volume', level: 2.4 }, function (p) { EARLY.wire.push(copy(p)); }); drain();
ok('a send made before initHost is held, not sent unsigned', EARLY.wire.length === 0, JSON.stringify(EARLY.wire));
tick(800);
EARLY.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();
ok('once initHost has fetched the key it goes, SIGNED', EARLY.wire.length === 1 && !!EARLY.wire[0]._sig, JSON.stringify(EARLY.wire));
var tvE = receiver('/tv', Tab()); hear(tvE, EARLY.wire[0]);
ok('and an enforcing TV hears it', last(tvE) === 'volume', tvE.got.join());
var NEVER = page({ path: '/app/raffle/host', tab: Tab() }); NEVER.wire = [];
NEVER.V.signSend({ t: 'state' }, function (p) { NEVER.wire.push(copy(p)); });
NEVER.V.signSend({ t: 'mode' }, function (p) { NEVER.wire.push(copy(p)); }); drain();
ok('a page that never calls initHost holds its sends for no more than six seconds', NEVER.wire.length === 0);
tick(6100); drain();
ok('then sends them, unsigned and in order, exactly as before', NEVER.wire.map(function (m) { return m.t; }).join() === 'state,mode' && !NEVER.wire[0]._sig, JSON.stringify(NEVER.wire));
NEVER.V.signSend({ t: 'later' }, function (p) { NEVER.wire.push(copy(p)); }); drain();
ok('and after that nothing waits at all', NEVER.wire.length === 3);

if (bad) throw new Error('signing, 15 Oct: ' + bad + ' of ' + ran + ' failed');
print('\nALL ' + ran + ' CHECKS PASSED');
