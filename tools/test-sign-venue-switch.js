/* A KEY ANSWER FOR A VENUE THE HOST HAS LEFT IS NOT USED.
   Review, 28 Sep 2026: a host who switched venue seconds after loading could get venue A's signing
   key back AFTER the switch to B, and sign B's broadcasts with A's key for up to five minutes, which
   B's screens would drop under enforcement. RUNS the real vp-sign.js: A's answer is held back, B's
   arrives first, then A's lands, and the key a signed message carries is read back.
   Run: jsc tools/test-sign-venue-switch.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   ' + extra : '')); if (!c) bad++; }
var SRC = readFile('venueplay/app/vp-sign.js');
var window = { crypto: { subtle: {
  importKey: function () { return Promise.resolve({ fake: true }); },
  sign: function () { return Promise.resolve(new ArrayBuffer(8)); },
  verify: function () { return Promise.resolve(true); },
  generateKey: function () { return Promise.reject(new Error('not in this test')); }
} } };
var self = window;
var TextEncoder = function () { this.encode = function (s) { return { length: s.length }; }; };
var console = { warn: function () {}, log: function () {} };
var btoa = function (s) { return s; }, atob = function (s) { return s; };
var document = { getElementById: function () { return null; } };
var held = {};
var fetch = function (url, o) {
  var slug = JSON.parse(o.body).slug;
  var answer = { has_key: true, private_jwk: { k: slug }, public_jwk: { k: slug }, kid: 'kid-' + slug, enforce: true };
  var res = { ok: true, json: function () { return Promise.resolve(answer); } };
  if (slug === 'venue-a') return new Promise(function (r) { held.a = function () { r(res); }; });
  return Promise.resolve(res);
};
function setInterval(){ return 1; }
eval(SRC);
var V = window.VPSign || VPSign;
function flush(n){ var p = Promise.resolve(); for (var i = 0; i < (n || 30); i++) p = p.then(function(){}); return p; }
var tok = function(){ return 'tok'; };
V.initHost('https://w', 'venue-a', tok);
flush().then(function () {
  V.initHost('https://w', 'venue-b', tok);
  return flush();
}).then(function () {
  return V.sign({ t: 'ball', n: 7 });
}).then(function (m1) {
  ok('after switching to B, messages carry B\'s key', m1 && m1._kid === 'kid-venue-b', JSON.stringify(m1));
  held.a();                     // venue A's slow answer lands now
  return flush();
}).then(function () {
  return V.sign({ t: 'ball', n: 8 });
}).then(function (m2) {
  ok('venue A\'s late answer does NOT replace B\'s key', m2 && m2._kid === 'kid-venue-b', JSON.stringify(m2));
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' failed');
}).catch(function (e) { print('CRASH ' + e + ' ' + (e && e.stack)); throw e; });
