/* THE HOST SIGN-IN, ON A LAPTOP.

   Dean typed the SMS code, pressed Enter, and nothing happened. The TV pairing box
   on the same page has submitted on Enter since the start; the two sign-in fields
   never did, and a host at a bar tablet or a laptop expects Enter to mean "go".

   Run: jsc venueplay-backend/app/sign-in.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/app/index.html');
var EXPECT = 4, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

ok('Enter in the mobile field sends the code',
   /\$\("mobileIn"\)\.addEventListener\("keydown", function\(e\)\{ if\(e\.key==="Enter"\)\{ e\.preventDefault\(\); \$\("sendCodeBtn"\)\.click\(\); \} \}\)/.test(H));
ok('Enter in the code field verifies it',
   /\$\("otpIn"\)\.addEventListener\("keydown", function\(e\)\{ if\(e\.key==="Enter"\)\{ e\.preventDefault\(\); \$\("verifyBtn"\)\.click\(\); \} \}\)/.test(H));
ok('the buttons Enter presses are the real ones', /id="sendCodeBtn"/.test(H) && /id="verifyBtn"/.test(H));
ok('and the pairing box still submits on Enter too', /pairIn\.addEventListener\("keydown", function\(e\)\{ if\(e\.key==="Enter"\) tryPair\(\); \}\)/.test(H));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
