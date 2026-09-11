/* THE MEMBERS DRAW MUST ALWAYS BE RUNNABLE, AND THE TV MUST NOT BE SENT HOME EARLY.

   Two faults this pins down, both found in the 9 Sep review:

   1. The Worker stamps last_drawn_date at DRAW time, before anybody has claimed. So a draw
      whose reply was lost on bad wifi came back as "Drawn tonight" with the button DISABLED,
      and the confirm written for exactly that case ("draw again anyway?") could never fire,
      because a disabled button does not raise a click. The night was over, with no winner.
      The button must stay tappable; the confirm is the lock, not the disabled attribute.

   2. The console told the TV to go idle 9 seconds after a claim while the screen was running a
      60 second celebration, and 7 seconds after a rollover while the screen held for 30. The
      two files must agree on the numbers, and the screen must keep an early idle rather than
      obey it or drop it.

   Run: jsc venueplay-backend/app/members/draw-again.test.js   (the gate runs it from the repo root) */

function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel, '../../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/app/members/host.html');
var S = find('venueplay/app/members/screen.html');

var EXPECT = 15, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k) + '\n';
}

/* ---- fakes for the page ---- */
var timers = [];
function setTimeout(fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }
function clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; }
var els = {};
function el(id) { return { id: id, disabled: false, textContent: '', cls: {}, classList: {
  add: function (c) { this.cls = this.cls || {}; }, remove: function () {}, toggle: function () {} } }; }
function $(id) { if (!els[id]) els[id] = el(id); return els[id]; }
var alerts = [], confirms = [], confirmAnswer = true, sent = [];
function alert(m) { alerts.push(m); }
function confirm(m) { confirms.push(m); return confirmAnswer; }
function send(m) { sent.push(m); }
function sendState() {}
function sendIdle() {}
function clearTimers() {}
function hideWinnerCard() {}
function hostError() {}
function revealWinner() {}
function apiPost() { return new Promise(function () {}); }
var subscribed = true;

var TODAY = new Date().toISOString().slice(0, 10);
var G = {
  busy: false, round: null, canManage: false, currentDrawId: 'd1',
  draws: [{ id: 'd1', name: 'Friday Members Draw', last_drawn_date: null, draw_length_seconds: 4, roster_id: 'r1' }],
  members: [
    { member_number: 1204, status: 'valid', roster_id: 'r1' },
    { member_number: 1310, status: 'valid', roster_id: 'r1' },
    { member_number: 9999, status: 'removed', roster_id: 'r1' }
  ]
};
eval(lift(H, 'curDraw'));
eval(lift(H, 'drawMembers'));
eval(lift(H, 'activeMembers'));
eval(lift(H, 'alreadyDrawnTonight'));
eval(lift(H, 'drawBtnIdle'));
eval(lift(H, 'startDraw'));

/* ---- 1. the button is never dead ---- */
drawBtnIdle();
ok('a fresh draw shows a plain Draw button', $('drawBtn').disabled === false && $('drawBtn').textContent === 'Draw',
   $('drawBtn').textContent);

G.draws[0].last_drawn_date = TODAY;
drawBtnIdle();
ok('once drawn tonight the button is STILL tappable', $('drawBtn').disabled === false,
   'a disabled button can never reach the confirm, which is the whole bug');
ok('and it says so, so nobody draws twice by accident', /Drawn tonight/.test($('drawBtn').textContent),
   $('drawBtn').textContent);
ok('the source no longer disables it anywhere in drawBtnIdle', !/b\.disabled\s*=\s*true/.test(lift(H, 'drawBtnIdle')));

/* ---- 2. the confirm is the lock ---- */
confirmAnswer = false; confirms = []; sent = [];
startDraw();
ok('drawing again asks first', confirms.length === 1 && /already been drawn tonight/.test(confirms[0]));
ok('and saying no draws nothing', sent.length === 0 && G.busy === false);

confirmAnswer = true; confirms = []; sent = [];
startDraw();
ok('saying yes runs the draw', G.busy === true);
ok('and the TV is told to spin', sent.length > 0 && sent[0].t === 'drawing');

/* ---- 3. the spin uses numbers this club actually has ---- */
var drawing = sent[0];
ok('the spin range is the venue\'s own member numbers', drawing.minNumber === 1204 && drawing.maxNumber === 1310,
   drawing.minNumber + ' to ' + drawing.maxNumber);
ok('a removed member is not in the spin range', drawing.maxNumber !== 9999);

G.busy = false; G.draws[0].last_drawn_date = null; confirms = []; sent = [];
startDraw();
ok('the first draw of the night asks nothing at all', confirms.length === 0 && G.busy === true);

/* ---- 4. host and screen agree on how long a result stays up ---- */
function num(src, name) { var m = new RegExp(name + '\\s*=\\s*(\\d+)').exec(src); return m ? parseInt(m[1], 10) : -1; }
var hClaim = num(H, 'CLAIM_HOLD_MS'), sClaim = num(S, 'CLAIM_HOLD_MS');
var hRoll = num(H, 'ROLLOVER_HOLD_MS'), sRoll = num(S, 'ROLLOVER_HOLD_MS');
ok('the console and the TV agree on the claim celebration', hClaim > 0 && hClaim === sClaim, hClaim + ' vs ' + sClaim);
ok('and on the rollover hold, which is the line that stops arguments at the bar',
   hRoll >= 30000 && hRoll === sRoll, hRoll + ' vs ' + sRoll);
ok('no hard-coded 9000 or 7000 idle is left in the console',
   !/scheduleIdle\(\s*(9000|7000)\s*\)/.test(H));
ok('an idle that lands mid-celebration is KEPT, not obeyed and not lost',
   /state\.pendingIdle\s*=\s*m/.test(S) && /if\(state\.pendingIdle\)/.test(S));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
