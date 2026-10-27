/* A MONTH'S OFFER CODE ENDS WITH ITS MONTH, BY ITSELF. Dean, 25 Sep 2026: "anyone emailed now, that
   code is done, dusted and gone". Runs the REAL vpaCodeInDate / vpaLiveCodes / vpaFoundingOpenNow
   lifted out of the shipped billing Worker, at fixed instants either side of midnight Brisbane.
   Run: jsc venueplay-backend/worker/founding-month-expiry.test.js */
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
function lift(re, what){ var m = SRC.match(re); if(!m) throw new Error('cannot find ' + what + ' in the billing Worker'); return m[0]; }
eval(lift(/const VPA_CODE_MONTHS = \{[^}]*\};/, 'VPA_CODE_MONTHS').replace('const ', 'var '));
eval(lift(/function vpaCodeInDate\(code, nowMs\) \{[\s\S]*?\n\}/, 'vpaCodeInDate'));
eval(lift(/function vpaLiveCodes\(env, nowMs\) \{[\s\S]*?\n\}/, 'vpaLiveCodes'));
var bad = 0, ran = 0;
function ok(c, n){ ran++; print((c ? '  ok   ' : '  FAIL ') + n); if(!c) bad++; }
// Brisbane is UTC+10: 23:59 on 31 Oct in Brisbane is 13:59 UTC on 31 Oct; midnight is 14:00 UTC.
var lastMinute = Date.UTC(2026, 9, 31, 13, 59, 0), midnight = Date.UTC(2026, 9, 31, 14, 0, 0), sept = Date.UTC(2026, 8, 25, 0, 0, 0);
ok(vpaCodeInDate('NSW-OCT-2026', sept), 'the October code works in September');
ok(vpaCodeInDate('NSW-OCT-2026', lastMinute), 'and at 11:59pm on 31 October, Brisbane');
ok(!vpaCodeInDate('NSW-OCT-2026', midnight), 'and is gone at midnight Brisbane, 1 November');
ok(!vpaCodeInDate('offer-oct-2026', midnight), 'whatever case it is written in');
ok(vpaCodeInDate('OFFER-NOV-2026', midnight), 'November\'s code is live on 1 November');
ok(!vpaCodeInDate('OFFER-NOV-2026', Date.UTC(2026, 10, 30, 14, 0, 0)), 'and ends at midnight on 30 November');
ok(!vpaCodeInDate('OFFER-DEC-2026', Date.UTC(2026, 11, 31, 14, 0, 0)), 'December rolls into the new year correctly');
ok(vpaCodeInDate('SPECIAL', midnight), 'a code with no month in it keeps the old rule: live while listed');
var env = { FOUNDING_CODES: ' NSW-OCT-2026, OFFER-NOV-2026 ,VIC-OCT-2026' };
ok(vpaLiveCodes(env, sept).join() === 'NSW-OCT-2026,OFFER-NOV-2026,VIC-OCT-2026', 'in September every listed code is live');
ok(vpaLiveCodes(env, midnight).join() === 'OFFER-NOV-2026', 'on 1 November only November\'s is, though October\'s is still listed');
ok(vpaLiveCodes({ FOUNDING_CODES: '' }, sept).length === 0, 'nothing listed is nothing live');
ok(/const activeCodes = vpaLiveCodes\(env\);/.test(SRC), 'checkout prices off the live codes, not the raw list');
ok(/const live = vpaLiveCodes\(env\);/.test(SRC), 'the page\'s open/ended check reads the same live codes');
print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error('founding month expiry');
