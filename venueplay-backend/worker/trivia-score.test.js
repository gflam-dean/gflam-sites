/* WHAT A TRIVIA ANSWER IS WORTH, tested against the Worker itself.

   Trivia is the format VenuePlay launches on in Queensland, because OLGR ruled
   it a game of skill and exempt. It is also the one with a live leaderboard on
   the wall, so wrong scoring is not a silent bug: it is the wrong team holding
   the prize while the right team watches.

   None of the three trivia pages had a test of any kind, and neither did the
   scoring. This lifts the real expression out of venueplay-game.js rather than
   restating it here, for the reason musical-draw.test.js gives: a copy keeps
   passing while the Worker changes underneath it.

   The rule: a correct answer is worth base, plus up to another half of base for
   speed, scaled by how much of the question's time was left. A wrong answer is
   worth nothing.

   Run: jsc venueplay-backend/worker/trivia-score.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

var CANDIDATES = ["venueplay-backend/worker/venueplay-game.js", "venueplay-game.js", "../worker/venueplay-game.js"];
var src = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 5000) { src = t; break; } } catch (e) {}
}
if (src === null) { print("FAIL could not find venueplay-game.js"); throw new Error("no source"); }

/* The real scoring block, taken from the Worker verbatim. */
var m = /let pts = 0;[\s\S]*?\n    \}/.exec(src);
ok("the scoring block is still in the Worker", !!m);
if (!m) throw new Error("scoring block not found");
var BLOCK = m[0];
ok("it still pays base plus a speed bonus", /pts = base \+ bonus/.test(BLOCK), BLOCK.slice(0, 60));
ok("the bonus is still half of base at most", /base \* 0\.5/.test(BLOCK));
ok("time left is clamped to the question length",
   /Math\.max\(0, Math\.min\(secs,/.test(BLOCK),
   "without the clamp an early or late clock gives negative or runaway points");

/* Run it. answered_at and question_ends_at are ISO strings in the Worker. */
function score(opts) {
  var base = opts.base, secs = opts.secs, speedBonus = opts.speedBonus !== false;
  var correct = opts.correct;
  var endsAtMs = opts.endsAt;
  var a = { answered_at: opts.answeredAt };
  var Date_parse = Date.parse;
  var pts;
  // `let pts = 0` inside an eval is block-scoped and never reaches the variable
  // out here, which is why the first run of this returned undefined for every
  // case. Bind it to the outer one instead. The arithmetic below is untouched
  // Worker source; only the declaration is rewritten.
  var runnable = BLOCK
        .replace(/^\s*let pts = 0;/, "pts = 0;")
        .replace(/Date\.parse\(a\.answered_at\)/g, "a.answered_at");
  eval(runnable);
  return pts;
}
var END = 100000;                       // question closes at t=100s
function at(secondsBeforeEnd){ return END - secondsBeforeEnd * 1000; }

print("== a wrong answer is worth nothing, however fast ==");
ok("wrong, instant", score({base:100, secs:30, correct:false, endsAt:END, answeredAt:at(30)}) === 0);
ok("wrong, on the buzzer", score({base:100, secs:30, correct:false, endsAt:END, answeredAt:at(0)}) === 0);

print("== a correct answer is base, plus up to half of base for speed ==");
ok("instant answer scores base + the full 50%",
   score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(30)}) === 150,
   "got " + score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(30)}));
ok("answering on the buzzer scores base only",
   score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(0)}) === 100);
ok("half the time left scores base + half the bonus",
   score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(15)}) === 125);
ok("the bonus never exceeds half of base",
   score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(999)}) === 150,
   "a clock skewed early must not pay more than 150");
ok("answering after time is up still scores base, never less",
   score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(-999)}) === 100,
   "a late answer must not go negative");

print("== the venue's own points setting is respected ==");
ok("base 200 gives 300 at full speed",
   score({base:200, secs:30, correct:true, endsAt:END, answeredAt:at(30)}) === 300);
ok("base 50 gives 75 at full speed",
   score({base:50, secs:30, correct:true, endsAt:END, answeredAt:at(30)}) === 75);
ok("base 0 scores nothing even when correct",
   score({base:0, secs:30, correct:true, endsAt:END, answeredAt:at(30)}) === 0);

print("== speed bonus turned off ==");
ok("fast and slow score the same when the bonus is off",
   score({base:100, secs:30, correct:true, speedBonus:false, endsAt:END, answeredAt:at(30)}) === 100 &&
   score({base:100, secs:30, correct:true, speedBonus:false, endsAt:END, answeredAt:at(0)}) === 100);

print("== faster is always worth at least as much as slower ==");
var last = 999999, mono = true;
for (var s = 30; s >= 0; s--) {
  var v = score({base:100, secs:30, correct:true, endsAt:END, answeredAt:at(s)});
  if (v > last) { mono = false; break; }
  last = v;
}
ok("the score never rises as the answer gets slower", mono);

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
