/* THE BINGO TV'S WIN AND CLAIM WORDS IN NORMAL CASE (INBOX 287.2, 12 Nov 2026).

   Dean's photo of the Kogan TV app: "B I N G O  O N  5 7" and "W I N S" in spaced mono capitals over the
   winner's name, the look the house rules ban (feedback_no_ai_look, MUST FIX). The same on the claim
   screen's "Bingo claimed". Now plain words in the wall's own type. Reads tv.html's own rules, the way
   tools/test-musical-tv-10nov.js holds the musical bingo screen to it.

   Run from the repo root:  jsc tools/test-tv-win-words-12nov.js
*/
var TV = readFile('venueplay/tv.html');
var CSS = TV.slice(0, TV.indexOf('</style>'));
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   -> ' + extra : '')); } }
function rule(sel) { var i = CSS.indexOf(sel + '{'); return i < 0 ? '' : CSS.slice(i, CSS.indexOf('}', i) + 1); }
function plain(r) { return !!r && !/text-transform:uppercase/.test(r) && !/letter-spacing:\.[1-9]/.test(r) && !/JetBrains/.test(r); }

print('\n== the win screen ==');
ok('"Bingo on 57" is plain words: no capitals forced, no letter spacing, not mono', plain(rule('  #tvWin .wineye')), rule('  #tvWin .wineye'));
ok('"Wins" / "Share" / "Prize" too', plain(rule('  #tvWin .winslabel')), rule('  #tvWin .winslabel'));
ok('and they are written that way in the page: "Bingo on " + the number, "Wins"', /\$\("winEye"\)\.textContent = onNo \? "Bingo on "\+onNo : "Bingo";/.test(TV) && /\$\("winsLabel"\)\.textContent = ws\.length>1 \? "Share" : "Wins";/.test(TV));
ok('"Bingo on 57" is big enough to read from the bar (at least 40px at 1920)', (parseFloat((rule('  #tvWin .wineye').match(/font-size:([\d.]+)cqw/) || [0, 0])[1]) * 19.2) >= 40, rule('  #tvWin .wineye'));

print('\n== the claim screen ==');
ok('"Bingo claimed" is plain words too', plain(rule('  #tvClaim .eyebrow')), rule('  #tvClaim .eyebrow'));

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
