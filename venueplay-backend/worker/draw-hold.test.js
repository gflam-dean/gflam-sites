/* A SECOND DRAW MUST NOT LAND WHILE THE ROOM IS STILL WATCHING THE FIRST.

   Five draw buttons, one rule each, set by Dean on 8 Sep 2026:

     bingo ball        5 seconds, on the page (bingo has no game Worker)
     musical song     20 seconds with a clip playing, 1.2 without, on the page
     raffle            the spin the host chose plus 2 seconds, on the SERVER
     members draw      the draw's spin plus 2 seconds, on the SERVER

   The page-side hold is one shared script, /app/vp-hold.js, and this runs the
   real thing against a fake clock and a fake document. The server-side hold is
   one shared function, drawHoldMs, lifted from the real Worker, and the two
   handlers are checked for actually calling it, because a helper nobody calls
   is a comment. Run: jsc venueplay-backend/worker/draw-hold.test.js */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var W = find('venueplay-backend/worker/venueplay-game.js');
var HOLD = find('venueplay/app/vp-hold.js');
var BINGO = find('venueplay/app/index.html');
var MUSICAL = find('venueplay/app/musical/host.html');
var RAFFLE = find('venueplay/app/raffle/host.html');
var MIG = find('venueplay-backend/supabase/venueplay-69-members-draw-hold.sql');

var EXPECT = 31, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(n) {
  var i = W.indexOf('async function ' + n + '('); if (i < 0) i = W.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n);
  var d = 0, k = W.indexOf('{', i);
  do { if (W[k] === '{') d++; else if (W[k] === '}') d--; k++; } while (d > 0 && k < W.length);
  return W.slice(i, k) + '\n';
}
function body(n) { return lift(n); }

print('== the server rule: spin plus two, clamped to what the console offers ==');
eval(lift('drawHoldMs'));
ok('a 4 second spin holds for 6', drawHoldMs(4, 4, 3, 8) === 6000);
ok('an 8 second spin holds for 10', drawHoldMs(8, 4, 3, 8) === 10000);
ok('rubbish falls back to the default, not to zero', drawHoldMs('soon', 4, 3, 8) === 6000);
ok('nothing sent falls back to the default', drawHoldMs(undefined, 4, 3, 8) === 6000);
ok('a console cannot shrink it below the shortest spin', drawHoldMs(0, 4, 3, 8) === 5000);
ok('or grow it past the longest', drawHoldMs(600, 4, 3, 8) === 10000);
ok('a negative is treated as rubbish', drawHoldMs(-5, 4, 3, 8) === 6000);

print('\n== the raffle actually uses it ==');
var raffle = body('handleHostDraw');
ok('the raffle guard is sized by drawHoldMs', /drawHoldMs\(b\.spin_seconds, 4, 3, 8\)/.test(raffle),
   'a flat 3 seconds was shorter than every spin but the shortest');
ok('and compares the last draw time against it', /since < holdMs/.test(raffle));
ok('and tells the host how long', /You can draw again in ' \+ Math\.ceil\(\(holdMs - since\) \/ 1000\)/.test(raffle));
ok('a redraw is still not gated', /if \(!isRedraw && prior\.length && prior\[0\]\.drawn_at\)/.test(raffle));
ok('the raffle console sends its spin', /spin_seconds:G\.drawLength/.test(RAFFLE));
ok('the console offers 3 to 8 seconds, which is what the Worker clamps to', /var opts=\[3,4,5,6,8\]/.test(RAFFLE));

print('\n== the members draw finally has one ==');
var members = body('handleMembersDraw');
ok('sized by the draw\'s own spin', /drawHoldMs\(draw\.draw_length_seconds, 4, 2, 30\)/.test(members));
ok('reads last_drawn_at in its own try, so a missing column skips the guard rather than the draw',
   /try \{[\s\S]*?select=last_drawn_at[\s\S]*?\} catch \(e\) \{ lastAt = null; \}/.test(members));
ok('the guard runs BEFORE a winner is picked', members.indexOf('since < holdMs') < members.indexOf('randInt(members.length)'));
ok('the stamp is written before the winner is returned', members.indexOf('last_drawn_at: new Date().toISOString()') < members.indexOf('return json({\n    draw_id: drawId'));
ok('and falls back to the date-only stamp if the column is missing',
   /catch \(e\) \{\n\s*await sbPatch\(env, 'vp_member_draws', 'id=eq\.' \+ enc\(drawId\), \{ last_drawn_date: today \}\);/.test(members));
ok('migration 69 adds the column', /alter table vp_member_draws\s+add column if not exists last_drawn_at timestamptz/.test(MIG));

print('\n== the page-side hold, run for real ==');
var now = 1000000, timers = {}, nextId = 1, doc = {};
var window = {};
function setInterval(fn, ms) { var id = nextId++; timers[id] = fn; return id; }
function clearInterval(id) { delete timers[id]; }
var document = { getElementById: function (id) { return doc[id] || null; } };
var Date = { now: function () { return now; } };
function tickAll() { for (var id in timers) timers[id](); }
eval(HOLD);
var VP_HOLD = window.VP_HOLD;
var btn = { id: 'nextBtn', disabled: false, textContent: 'Next number' }; doc.nextBtn = btn;
var restored = 0;
VP_HOLD.hold(btn, 5, function (left) { return 'Next number in ' + left + 's'; }, function () { restored++; });
ok('held straight away', VP_HOLD.busy(btn) === true);
ok('the button is disabled and counting', btn.disabled === true && btn.textContent === 'Next number in 5s');
now += 2000; tickAll();
ok('two seconds in it still holds and says 3', VP_HOLD.busy(btn) === true && btn.textContent === 'Next number in 3s');
btn.disabled = false;   // something redrew the console and re-enabled the button
tickAll();
ok('a redraw of the console cannot lift the hold', VP_HOLD.busy(btn) === true && btn.disabled === true);
now += 3000; tickAll();
ok('at five seconds it lets go', VP_HOLD.busy(btn) === false && btn.disabled === false);
ok('and hands the label back to the page exactly once', restored === 1);
ok('the timer is gone', Object.keys(timers).length === 0);
VP_HOLD.hold(btn, 20, null, null); VP_HOLD.release(btn);
ok('release clears a hold', VP_HOLD.busy(btn) === false);

print('\n== the consoles use the shared hold with the numbers Dean set ==');
ok('bingo holds 5 seconds', /var BALL_HOLD_SECONDS=5;/.test(BINGO) && /VP_HOLD\.hold\(\$\("nextBtn"\), BALL_HOLD_SECONDS/.test(BINGO));
ok('bingo checks the hold before drawing', /if\(VP_HOLD\.busy\(\$\("nextBtn"\)\)\) return;/.test(BINGO));
ok('musical holds 20 with a clip and 1.2 without',
   /var SONG_HOLD_SECONDS=20, NO_CLIP_HOLD_SECONDS=1\.2;/.test(MUSICAL) && /s\.previewUrl \? SONG_HOLD_SECONDS : NO_CLIP_HOLD_SECONDS/.test(MUSICAL));
ok('both pages load the one copy', /<script src="\/app\/vp-hold\.js"><\/script>/.test(BINGO) && /<script src="\/app\/vp-hold\.js"><\/script>/.test(MUSICAL));

print('');
if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
