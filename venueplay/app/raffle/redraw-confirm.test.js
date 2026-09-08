/* "NOT HERE, REDRAW" MUST TAKE TWO TAPS.

   One tap marked the ticket no_show, took it out of the pool for good and drew
   somebody else, with nothing to appeal to. This runs the real arming code with a
   fake clock and a fake button, and checks the second tap is the only thing that
   ever reaches onRedraw.

   Run: jsc venueplay/app/raffle/redraw-confirm.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel, '../../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/app/raffle/host.html');
var EXPECT = 10, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(name) {
  var i = H.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = H.indexOf('{', i);
  do { if (H[k] === '{') d++; else if (H[k] === '}') d--; k++; } while (d > 0 && k < H.length);
  return H.slice(i, k) + '\n';
}

/* the real code, with fakes for the page */
var timers = [], redraws = 0;
function setTimeout(fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }
function clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; }
function fireTimers() { var t = timers.slice(); timers = []; t.forEach(function (x) { if (x.fn) x.fn(); }); }
var btn = { textContent: 'Not here · redraw', cls: {}, classList: { add: function (c) { btn.cls[c] = 1; }, remove: function (c) { delete btn.cls[c]; } } };
function $(id) { return id === 'redrawBtn' ? btn : null; }
function pad(n) { return String(n); }
function onRedraw() { redraws++; }
var G = { round: { numbers: [87], resolved: false }, busy: false };
var m = /var REDRAW_ARM_MS=(\d+), _redrawArm=null;/.exec(H);
ok('the arm window is declared', !!m);
eval(m[0]);
eval(lift('redrawLabelIdle')); eval(lift('disarmRedraw')); eval(lift('tapRedraw'));

ok('the button is wired to the two-tap handler, not straight to onRedraw',
   /\$\("redrawBtn"\)\.addEventListener\("click", tapRedraw\)/.test(H) && !/addEventListener\("click", function\(\)\{ onRedraw\(false\); \}\)/.test(H));

tapRedraw();
ok('one tap does NOT redraw', redraws === 0);
ok('it names the ticket it is about to void', btn.textContent === 'Tap again to void ticket 87' && btn.cls.armed === 1, btn.textContent);
ok('and the arm lasts ' + (REDRAW_ARM_MS / 1000) + ' seconds, not for ever', timers.length === 1 && timers[0].ms === REDRAW_ARM_MS);

fireTimers();
ok('left alone, it disarms and the label comes back', !btn.cls.armed && btn.textContent === 'Not here · redraw' && redraws === 0);

tapRedraw(); tapRedraw();
ok('two taps inside the window redraw exactly once', redraws === 1);
ok('and the button is plain again afterwards', !btn.cls.armed && btn.textContent === 'Not here · redraw');

ok('claiming the ticket disarms a half-tapped redraw', /G\.round\.resolved=true; clearTimers\(\); disarmRedraw\(\);/.test(H),
   'otherwise the arm outlives the round and the next winner\'s first tap is a second tap');

/* Live on 8 Sep 2026 the Draw button read "Drawing…" for the whole claim window, which on a phone
   looks like a hang. While a winner is up it should say what it is waiting on. */
ok('while a winner is up, the Draw button says what it is waiting on, not Drawing…',
   /if\(allowRedraw\)\{\s*show\("wcResolve",true\);\s*drawBtnWaiting\(nums\);/.test(H) &&
   /function drawBtnWaiting\(nums\)\{[^\n]*"Waiting on ticket "\+nums\.map\(pad\)/.test(H));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
