/* THE FIRST MESSAGE MUST NOT GO OUT UNSIGNED WHILE THE KEY IS STILL LOADING.

   The Mini Bar, 10 Sep 2026. Console, TV and phone were all correctly in the same
   Cloudflare room. Presence proved it. Nothing appeared on the wall, and the TV's own
   console said why, over and over:

       [VPSign] dropped unsigned message (host_here) (enforce on)
       [VPSign] dropped unsigned message (state)     (enforce on)
       [VPSign] dropped unsigned message (cards)     (enforce on)

   The messages arrived. The TV threw them away, correctly, because they carried no
   signature. sign() falls back to sending unsigned when the private key has not arrived,
   and the console fetches that key asynchronously while it starts up. Supabase Realtime's
   subscribe handshake was slow enough to hide the race for months. The room connects in
   about 20 milliseconds and exposed it immediately, on the one venue running enforcement.

   Dean: "wait after a reset we are back" - which is exactly what a race looks like.

   Run: jsc venueplay/app/sign-race.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var SRC = find('venueplay/app/vp-sign.js');
var EXPECT = 6;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

/* Run the real library against a stub of what a browser gives it. No key is ever
   imported here: what is being tested is the ORDER, not the cryptography. */
var loaded = false, resolveKey = null;
var keyPromise = new Promise(function (r) { resolveKey = r; });
var sent = [];
var window = { crypto: { subtle: {
  importKey: function () { return keyPromise; },
  sign: function () { return Promise.resolve(new ArrayBuffer(8)); },
  verify: function () { return Promise.resolve(true); }
} } };
var self = window;
var TextEncoder = function () { this.encode = function (s) { return { length: s.length }; }; };
var console = { warn: function () {}, log: function () {} };
var fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
var btoa = function (s) { return s; }, atob = function (s) { return s; };
var document = { getElementById: function () { return null; } };

eval(SRC);
var V = window.VPSign || VPSign;

ok('the library exposes signSend', typeof V.signSend === 'function');
ok('and it remembers the key attempt', /keyTried/.test(SRC),
   'without somewhere to wait on, the first send races the key fetch');
ok('signSend waits on that attempt before signing',
   /S\.chain[\s\S]{0,200}S\.keyTried[\s\S]{0,120}VPSign\.sign\(obj\)/.test(SRC),
   'the wait must come BEFORE sign(), or sign() decides there is no key');
ok('sign still falls back to unsigned rather than sending nothing',
   /if \(!S\.privKey \|\| !subtleOk\(\)\) return Promise\.resolve\(payload\);/.test(SRC),
   'a venue with no key at all must keep working exactly as before');
ok('initHost still returns a promise callers can wait on', /initHost: function/.test(SRC) && /_initHost: function/.test(SRC));
ok('the wait cannot deadlock when the key fetch fails',
   /S\.keyTried = p\.catch\(function \(\) \{\}\);/.test(SRC),
   'a rejected key fetch must resolve the wait, not hang every send for ever');

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' RAN'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
