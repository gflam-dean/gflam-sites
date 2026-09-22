/* The venue key is rotated. Does the screen pick up the new one without a reload, and does the
   console mint it?

   Before 22 Sep 2026 a receiver fetched the public key once and stopped, so after a rotation
   every TV held the old key until its next reload and dropped every message from the new
   console. Runs the REAL vp-sign.js against a fake browser: keys are named by kid and a
   signature "verifies" when the message's kid is the key the screen holds.

   Run from the repo root:  jsc tools/test-screen-key-rotates.js
*/
var SRC = readFile('venueplay/app/vp-sign.js');
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   -> ' + extra : '')); } }

/* The world: one server-side key row per venue, a clock, timers we fire by hand. */
var W = { row: { kid: 'k1' }, now: 1700000000000, timers: [], fetches: [], mints: 0, staff: true };
var window = { crypto: { subtle: {
  importKey: function (fmt, jwk) { return Promise.resolve({ kid: jwk.kid }); },
  sign: function () { return Promise.resolve(new ArrayBuffer(8)); },
  verify: function (alg, key, sig, data) { return Promise.resolve(String(data.kid) === String(key.kid)); },
  generateKey: function () { W.mints++; var kid = 'k' + (W.mints + 1); return Promise.resolve({ publicKey: { kid: kid }, privateKey: { kid: kid } }); },
  exportKey: function (fmt, k) { return Promise.resolve({ kid: k.kid }); }
} } };
var self = window;
// canon() strips the _kid envelope before signing, so the fake signature reads the kid from a
// plain field the test puts in every message body.
var TextEncoder = function () { this.encode = function (s) { var m = /"k":"([^"]+)"/.exec(s); return { length: s.length, kid: m ? m[1] : '' }; }; };
var console = { warn: function () {}, log: function () {}, info: function () {} };
var Date = { now: function () { return W.now; } };
var setInterval = function (fn, ms) { W.timers.push({ fn: fn, ms: ms }); return W.timers.length; };
var clearInterval = function () {};
var btoa = function (s) { return s; }, atob = function (s) { return s; };
var document = { getElementById: function () { return null; } };
var fetch = function (url, opts) {
  W.fetches.push(url);
  if (url.indexOf('/venue/signing/public') >= 0) {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(W.row ? { exists: true, enforce: true, kid: W.row.kid, public_jwk: { kid: W.row.kid } } : { exists: false, enforce: true }); } });
  }
  if (url.indexOf('/host/signing/private') >= 0) {
    if (!W.staff) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(W.row ? { has_key: true, enforce: true, kid: W.row.kid, private_jwk: { kid: W.row.kid }, public_jwk: { kid: W.row.kid } } : { has_key: false, enforce: true }); } });
  }
  if (url.indexOf('/host/signing/mint') >= 0) {
    var b = JSON.parse(opts.body); W.row = { kid: b.public_jwk.kid };
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ has_key: true, enforce: true, kid: W.row.kid, private_jwk: b.private_jwk, public_jwk: b.public_jwk }); } });
  }
  return Promise.resolve({ ok: false });
};
function tick(ms) { W.now += ms; W.timers.forEach(function (t) { if (ms >= t.ms) t.fn(); }); }
function canonOf(payload) { return JSON.stringify(payload); }

eval(SRC);
var V = window.VPSign || VPSign;
var delivered = [];
var seq = 0;
function arrive(kid, t) { V.gate({ t: t || 'ball', k: kid, _sig: 'sig', _kid: kid, _ts: W.now, _n: 'n' + (++seq) }, function (p) { delivered.push(p._kid); }); }

(async function () {
  print('a screen under enforcement');
  await V.initReceiver('https://w', 'royal');
  ok('holds the venue key k1 and is enforcing', V.enforcing() && V.keyReady());
  ok('and has armed a five-minute refresh', W.timers.some(function (t) { return t.ms === 300000; }), JSON.stringify(W.timers.map(function (t) { return t.ms; })));
  arrive('k1'); await drainAll();
  ok('a message signed with k1 is delivered', delivered.join() === 'k1', delivered.join());

  print('the key is rotated: the row is deleted, a new console mints k2');
  W.row = null;
  var before = W.fetches.length;
  arrive('k2'); await drainAll();
  ok('an unknown kid makes the screen ask for the key again before judging', W.fetches.length > before, W.fetches.length - before + ' fetches');
  ok('and, with no new key minted yet, the k2 message is dropped on the old key', delivered.join() === 'k1', delivered.join());
  W.row = { kid: 'k2' };
  W.now += 20000;
  arrive('k2'); await drainAll();
  ok('once the new key exists, the next k2 message refetches and is delivered', delivered.join() === 'k1,k2', delivered.join());
  arrive('k1'); await drainAll();
  ok('the removed host, still signing with k1, is now dropped', delivered.join() === 'k1,k2', delivered.join());

  print('the five-minute refresh alone also converges');
  W.row = { kid: 'k3' }; W.now += 400000;
  tick(300000); await drainAll();
  arrive('k3'); await drainAll();
  ok('after the refresh, k3 is trusted with no message having asked for it', delivered.join() === 'k1,k2,k3', delivered.join());

  print('the console\'s half');
  W.row = { kid: 'k3' }; W.mints = 2;
  await V.initHost('https://w', 'royal', function () { return 'tok'; });
  ok('a console adopts the venue key and arms its own refresh', W.timers.some(function (t) { return t.ms === 300000; }) && V.keyReady());
  W.row = null;                                   // the owner removed somebody: the row is gone
  tick(300000); await drainAll();
  ok('on its refresh it finds no key and mints a new one', W.mints === 3 && W.row && W.row.kid === 'k4', JSON.stringify([W.mints, W.row]));
  W.staff = false; W.row = { kid: 'k9' };
  var f0 = W.fetches.length;
  tick(300000); await drainAll();
  ok('a login that has been removed is refused the new key and mints nothing', W.mints === 3 && W.row.kid === 'k9', JSON.stringify([W.mints, W.row]));
})().then(function () { finished = true; }, function (e) { print('  FAIL threw: ' + e + '\n' + e.stack); bad++; });
var finished = false;
async function drainAll() { for (var i = 0; i < 40; i++) { await Promise.resolve(); } }
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('key rotation: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
