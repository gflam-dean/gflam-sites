/* THE TV COUNTS A TRIVIA QUESTION ON THE HOST'S CLOCK (INBOX 287.0, 12 Nov 2026: "TV time different to phone").

   A trivia question's deadline (endsAt) is on the host console's clock and the TV counted down to it on its
   own clock, so a TV whose clock is off ran its ring ahead of or behind the phones by exactly that much.
   vp-sign.js now learns the host's clock from every VERIFIED signed message (_ts) and hands it out as
   VPSign.hostNow(); app/trivia/screen.html counts on that.

   Runs the REAL venueplay/app/vp-sign.js with the same harness as tools/test-signing-15-oct.js (pages with
   their own skewed clocks, tools/rig-fake-webcrypto.js for WebCrypto).

   Run from the repo root:  jsc tools/test-host-clock-12nov.js
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


var C = consolePage(0);
C.V.initHost('https://w', 'test-venue', function () { return 'tok'; }); drain();

print('\n== a TV whose clock is 40 s slow ==');
var tv = page({ path: '/tv', tab: Tab(), skew: -40000 }); tv.V.initReceiver('https://w', 'test-venue'); drain();
ok('before it hears anything, hostNow is its own clock (nothing changes on a quiet screen)', tv.V.hostNow() === W.now - 40000, tv.V.hostNow() - W.now);
hear(tv, C.say({ t: 'question', tag: 'q1' }));
ok('CONTROL: the TV took the signed question', last(tv) === 'question:q1', tv.got.join());
ok('after one signed message it reads the host\'s clock (within 50 ms)', Math.abs(tv.V.hostNow() - W.now) <= 50, tv.V.hostNow() - W.now);
var q = C.say({ t: 'question', tag: 'q2', endsAt: W.now + 20000, secs: 20 });
hear(tv, q);
ok('a 20 s question reads 20 s left on the TV, not 60', Math.round((q.endsAt - tv.V.hostNow()) / 1000) === 20, (q.endsAt - tv.V.hostNow()) / 1000);
tick(7000);
ok('seven seconds later it reads 13 s left, as the phone does', Math.round((q.endsAt - tv.V.hostNow()) / 1000) === 13, (q.endsAt - tv.V.hostNow()) / 1000);

print('\n== a slow arrival does not pull the clock back ==');
var slow = C.say({ t: 'state', tag: 'slow' });
tick(3000); hear(tv, slow);                  // reached the TV three seconds after it was signed
ok('the largest recent reading wins, so a late message changes nothing', Math.abs(tv.V.hostNow() - W.now) <= 50, tv.V.hostNow() - W.now);

print('\n== nobody can move a screen\'s clock ==');
var tv2 = page({ path: '/tv', tab: Tab(), skew: 0 }); tv2.V.initReceiver('https://w', 'test-venue'); drain();
hear(tv2, { t: 'state', tag: 'unsigned', _ts: W.now + 3600000 });
ok('an unsigned message with a clock an hour ahead moves nothing', tv2.V.hostNow() === W.now, tv2.V.hostNow() - W.now);
var forged = C.say({ t: 'state', tag: 'f' }); forged._ts = W.now + 3600000;
hear(tv2, forged);
ok('a signed message with its clock changed fails its signature and moves nothing', tv2.V.hostNow() === W.now && last(tv2) !== 'state:f', [tv2.V.hostNow() - W.now, tv2.got.join()]);

print('\n== a TV whose clock is right is left exactly alone ==');
var tv3 = page({ path: '/tv', tab: Tab(), skew: 900 }); tv3.V.initReceiver('https://w', 'test-venue'); drain();
hear(tv3, C.say({ t: 'state', tag: 'near' }));
ok('under a second and a half apart is the network, not the clock: hostNow stays its own clock', tv3.V.hostNow() === W.now + 900 && tv3.V.hostOffset() === 0, tv3.V.hostOffset());

print('\n== a key fetch that never answers does not hold the line (the Kogan, five calls behind) ==');
var HANG = false, realFetch = fetchFake;
fetchFake = function (url) { if (HANG && url.indexOf('/venue/signing/public') >= 0) return new Promise(function () {}); return realFetch(url); };
var tv4 = page({ path: '/tv', tab: Tab(), skew: 0 }); tv4.V.initReceiver('https://w', 'test-venue'); drain();
hear(tv4, C.say({ t: 'ball', tag: '1' }));
ok('CONTROL: the TV takes a ball', last(tv4) === 'ball:1', tv4.got.join());
HANG = true; tick(16000);
var b2 = C.say({ t: 'ball', tag: '2' }); b2._kid = 'k-new';     // a key id the TV does not hold: it asks for the key first
var b3 = C.say({ t: 'ball', tag: '3' });
hear(tv4, b2); hear(tv4, b3);
ok('CONTROL: while the key fetch hangs, the ball waits for it', tv4.got.join() === 'ball:1', tv4.got.join());
tick(1900); drain();
ok('CONTROL: still waiting at 1.9 s', tv4.got.join() === 'ball:1', tv4.got.join());
tick(200); drain();
ok('after two seconds the line stops waiting: both balls reach the wall, in order', tv4.got.join() === 'ball:1,ball:2,ball:3', tv4.got.join());
fetchFake = realFetch;

print('\n== the trivia screen counts on it ==');
var TS = readFile('venueplay/app/trivia/screen.html');
ok('the ring counts to the deadline on hostNow()', /var remMs=curQ\.endsAt-hostNow\(\);/.test(TS));
ok('a question\'s length and whether it is live are judged on hostNow() too',
   /Math\.round\(\(m\.endsAt-hostNow\(\)\)\/1000\)/.test(TS) && /\(\(Number\(m\.endsAt\)\|\|0\)-hostNow\(\)>1500\)/.test(TS) && /Math\.round\(\(ends-hostNow\(\)\)\/1000\)/.test(TS));
ok('hostNow() is VPSign.hostNow, falling back to Date.now()', /function hostNow\(\)\{ try\{ if\(window\.VPSign && VPSign\.hostNow\) return VPSign\.hostNow\(\); \}catch\(e\)\{\} return Date\.now\(\); \}/.test(TS));

if (bad) throw new Error('host clock, 12 Nov: ' + bad + ' of ' + ran + ' failed');
print('\nALL ' + ran + ' CHECKS PASSED');
