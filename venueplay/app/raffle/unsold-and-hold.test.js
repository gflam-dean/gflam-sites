/* THREE RAFFLE FAULTS FROM THE 9 SEP REVIEW, PINNED DOWN.

   1. Unsold tickets typed after the first draw were ignored. The box had no input listener, the
      count never subtracted them, and the game fingerprint did not cover them, so the console
      looked as though it had taken 40 to 60 out of the barrel while the server had not. Those
      numbers could still come up on the wall.

   2. The console sent the TV back to idle 9 seconds after a claim while the screen was running a
      30 second celebration, so the winning ticket vanished 21 seconds early.

   3. A tablet reload rebuilt the drawn tickets but not tonight's prize list, so the host retyped
      six prizes with the room waiting.

   Run: jsc venueplay/app/raffle/unsold-and-hold.test.js   (the gate runs it from the repo root) */

function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel, '../../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/app/raffle/host.html');
var S = find('venueplay/app/raffle/screen.html');

var EXPECT = 16, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k) + '\n';
}

/* ---- fakes for the page ---- */
var boxes = { rfSkip: { value: '' } };
function $(id) { return boxes[id] || null; }
var G = { min: 1, max: 150, drawn: {}, jackOn: false, jackAmt: 0, allowRedraw: true, time: 180,
          prizes: [], prizeIdx: 0 };
var rendered = 0;
function renderPrizeList() { rendered++; }
function readInputs() {}

eval(lift(H, 'parseSkips'));
eval(lift(H, 'validRange'));
eval(lift(H, 'drawnCount'));
eval(lift(H, 'skippedCount'));
eval(lift(H, 'remainingCount'));
eval(lift(H, 'raffleSig'));
eval(lift(H, 'restorePrizes'));

/* ---- 1. unsold tickets come out of the count ---- */
ok('nothing typed means nothing skipped', skippedCount() === 0 && remainingCount() === 150);

boxes.rfSkip.value = '40-60';
ok('a block of unsold tickets is taken out', skippedCount() === 21 && remainingCount() === 129,
   skippedCount() + ' skipped, ' + remainingCount() + ' left');

boxes.rfSkip.value = '40-60, 50-70, 5';
ok('overlapping blocks are not counted twice', skippedCount() === 32, String(skippedCount()));

boxes.rfSkip.value = '140-400';
ok('a block running past the last ticket is clipped to the range', skippedCount() === 11, String(skippedCount()));

boxes.rfSkip.value = '40-60';
G.drawn[45] = true; G.drawn[46] = true;
ok('a ticket already drawn is not skipped as well as drawn', skippedCount() === 19 && drawnCount() === 2,
   skippedCount() + ' skipped');
ok('and the tickets left never goes negative or double counts', remainingCount() === 129, String(remainingCount()));
G.drawn = {};

boxes.rfSkip.value = '';
G.min = 5; G.max = 1;
ok('an impossible range leaves the count at zero rather than a negative', remainingCount() === 0);
G.min = 1; G.max = 150;

/* ---- 2. the unsold box is wired up and part of the game fingerprint ---- */
boxes.rfSkip.value = '';
var sigNone = raffleSig();
boxes.rfSkip.value = '40-60';
ok('editing the unsold tickets changes the raffle fingerprint', raffleSig() !== sigNone,
   'otherwise the console silently keeps the old game and those numbers can still be drawn');
ok('typing in the unsold box updates the count on screen',
   /"rfSkip"/.test(H) && /\["rfPrize","rfStart","rfEnd","rfTime","rfJackAmt","rfSkip"\]/.test(H));
ok('changing it warns that a fresh raffle starts',
   /changed the raffle settings[\s\S]{0,400}Start a fresh raffle\?/.test(H));

/* ---- 3. the console and the wall agree on the celebration ---- */
function num(src, name) { var m = new RegExp(name + '\\s*=\\s*(\\d+)').exec(src); return m ? parseInt(m[1], 10) : -1; }
var hCel = num(H, 'CLAIM_CELEBRATE_MS'), sCel = num(S, 'CLAIM_CELEBRATE_MS');
ok('the console and the TV agree on how long a claim celebrates', hCel > 0 && hCel === sCel, hCel + ' vs ' + sCel);
ok('no hard-coded 9 second idle is left after a claim', !/sendIdle\(\);\s*\},\s*9000\)/.test(H) && !/,\s*9000\)/.test(H));
ok('an idle that lands mid-celebration is KEPT, not obeyed and not lost',
   /S\.pendingIdle\s*=\s*m/.test(S) && /if\(S\.pendingIdle\)/.test(S));

/* ---- 4. tonight's prize list survives a reload ---- */
ok('the prize list is written to the saved record', /prizes:G\.prizes\.slice\(\)/.test(H) && /prizeIdx:G\.prizeIdx/.test(H));
G.prizes = []; G.prizeIdx = 0;
restorePrizes({ prizes: ['Meat Tray', 'Bar Tab', 'Fuel Voucher'], prizeIdx: 1 });
ok('and it comes back in the same order, at the same point in the night',
   G.prizes.join('|') === 'Meat Tray|Bar Tab|Fuel Voucher' && G.prizeIdx === 1 && rendered > 0,
   G.prizes.join('|') + ' idx ' + G.prizeIdx);

/* ---- 5. a raffle winner claims from the host, never the bar ---- */
ok('both winner lines send the room to the host',
   /Bring your winning ticket to the host/.test(S) && !/winning ticket to claim/.test(S));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
