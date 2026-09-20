/* A captured Stripe event must stop working. This RUNS verifyStripeSig out of the shipped file.

   jsc has no crypto.subtle, so the HMAC is stood in for by a keyed digest that has the one
   property this test needs: change the secret, the timestamp or the body and the answer
   changes. It is NOT testing SHA-256. It is testing what the function does with a signature:
   that the timestamp is inside the signed text, that an old one is refused, and that a wrong
   one is refused. The audit of 20 Sep 2026 deleted the tolerance line and the gate stayed green.

   Run from the repo root:  jsc tools/test-stripe-signature-expires.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
function TextEncoder() {}
TextEncoder.prototype.encode = function (s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
function digest(keyBytes, dataBytes) {
  var out = new Uint8Array(32), h = 2166136261;
  for (var r = 0; r < 32; r++) {
    for (var i = 0; i < keyBytes.length; i++) { h ^= keyBytes[i] + r; h = Math.imul(h, 16777619) >>> 0; }
    for (var j = 0; j < dataBytes.length; j++) { h ^= dataBytes[j]; h = Math.imul(h, 16777619) >>> 0; }
    out[r] = h & 255;
  }
  return out;
}
crypto = { subtle: {
  importKey: function (fmt, keyBytes) { return Promise.resolve({ k: keyBytes }); },
  sign: function (alg, key, data) { return Promise.resolve(digest(key.k, data).buffer); } } };
(0, eval)(src);

var NOW = 1790000000; Date.now = function () { return NOW * 1000; };
var SECRET = 'whsec_test', BODY = '{"id":"evt_1","type":"invoice.paid"}';
function sign(secret, t, body) {
  var e = new TextEncoder(), d = digest(e.encode(secret), e.encode(t + '.' + body)), hex = '';
  for (var i = 0; i < d.length; i++) hex += ('0' + d[i].toString(16)).slice(-2);
  return 't=' + t + ',v1=' + hex;
}
function verify(body, header, secret) { var out = 'pending'; verifyStripeSig(body, header, secret).then(function (r) { out = r; }, function (e) { out = 'THREW ' + e; }); drainMicrotasks(); return out; }

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + '   saw: ' + JSON.stringify(saw)); fails++; } }

print('a Stripe signature');
check('CONTROL: a fresh, correctly signed event is accepted', verify(BODY, sign(SECRET, NOW, BODY), SECRET) === true, verify(BODY, sign(SECRET, NOW, BODY), SECRET));
check('four minutes old is still fine', verify(BODY, sign(SECRET, NOW - 240, BODY), SECRET) === true);
check('SIX minutes old is refused, though the signature is perfectly valid', verify(BODY, sign(SECRET, NOW - 360, BODY), SECRET) === false, verify(BODY, sign(SECRET, NOW - 360, BODY), SECRET));
check('a week old is refused: a captured invoice.paid cannot switch a venue back on for ever', verify(BODY, sign(SECRET, NOW - 7 * 86400, BODY), SECRET) === false);
check('dated six minutes into the future is refused too', verify(BODY, sign(SECRET, NOW + 360, BODY), SECRET) === false);
var old = sign(SECRET, NOW - 7 * 86400, BODY);
check('an old signature with a fresh timestamp pasted on is refused, because the time is inside what was signed',
  verify(BODY, old.replace(/t=\d+/, 't=' + NOW), SECRET) === false);
check('the right signature over a different body is refused', verify(BODY.replace('evt_1', 'evt_2'), sign(SECRET, NOW, BODY), SECRET) === false);
check('signed with the wrong secret is refused', verify(BODY, sign('whsec_other', NOW, BODY), SECRET) === false);
check('no header, no secret, or a header with no timestamp: refused',
  verify(BODY, '', SECRET) === false && verify(BODY, sign(SECRET, NOW, BODY), '') === false && verify(BODY, 'v1=abc', SECRET) === false);
check('a timestamp that is not a number is refused', verify(BODY, sign(SECRET, 'soon', BODY), SECRET) === false);

if (fails) throw new Error('stripe signature: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
