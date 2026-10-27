/* WHO WINS THE MEAT TRAY, tested against the Worker itself.

   The raffle and the members draw pick real people for real prizes in front of a
   room, and in Queensland they fall under the Charitable and Non-Profit Gaming
   Act. rng-evidence.test.js proves the generator is unbiased; nothing proved the
   code that USES it. A perfect RNG behind a selection loop that quietly skips a
   ticket, redraws one already drawn, or refuses to draw at all is still a wrong
   winner.

   The real loop is lifted out of venueplay-game.js rather than restated here, for
   the reason musical-draw.test.js gives: a copy keeps passing while the Worker
   changes underneath it.

   Run: jsc venueplay-backend/worker/draw-fairness.test.js
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

/* The real scaler, and the real raffle loop. */
var rs = /function randInt\(max\)[\s\S]*?\n\}/.exec(src);
ok("randInt is still in the Worker", !!rs);
var ls = /const picks = \[\];[\s\S]*?\n  \}/.exec(src);
ok("the raffle draw loop is still in the Worker", !!ls);
var ms = /const winner = members\[randInt\(members\.length\)\];/.exec(src);
ok("the members draw still picks with randInt", !!ms);
if (!rs || !ls) throw new Error("missing source");

/* jsc has no Web Crypto, so the real randInt is given a stand-in. splitmix32,
   the SAME one rng-evidence.test.js uses, and for the reason recorded there: a
   textbook LCG has poor low bits and `x % max` reads exactly those, so the
   harness fails and looks like the scaler failing. This mixes every bit. */
var seed = 987654321 >>> 0;
function lcg(){
  seed = (seed + 0x9E3779B9) >>> 0;
  var z = seed;
  z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735A2D97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}
globalThis.crypto = { getRandomValues: function (b) { for (var i=0;i<b.length;i++) b[i]=lcg(); return b; } };

eval(rs[0]);
var LOOP = ls[0];

function raffle(opts){
  var min = opts.min, max = opts.max, winners = opts.winners;
  var drawn = opts.drawn || {}, excl = opts.excl || [];
  var span = max - min + 1;
  function inExcluded(n){ for (var i=0;i<excl.length;i++) if (n>=excl[i][0] && n<=excl[i][1]) return true; return false; }
  var picks, chosen, guard, guardMax;
  eval(LOOP.replace(/^\s*const picks = \[\];/, "picks = [];")
           .replace(/const chosen = \{\};/, "chosen = {};")
           .replace(/let guard = 0;/, "guard = 0;")
           .replace(/const guardMax = /, "guardMax = "));
  return picks;
}

print("== a ticket outside the sold range can never win ==");
var out = 0;
for (var t = 0; t < 300; t++) {
  var p = raffle({min:50, max:59, winners:3});
  for (var i = 0; i < p.length; i++) if (p[i] < 50 || p[i] > 59) out++;
}
ok("300 draws over tickets 50-59 never left the range", out === 0, out + " strays");

print("== every ticket in the range is reachable ==");
var seen = {};
for (var t = 0; t < 4000; t++) { var p = raffle({min:1, max:10, winners:1}); seen[p[0]] = true; }
var reach = 0; for (var n = 1; n <= 10; n++) if (seen[n]) reach++;
ok("all ten tickets came up over 4000 draws", reach === 10, "only " + reach + " ever won");

print("== no duplicates inside one draw ==");
var dupes = 0;
for (var t = 0; t < 400; t++) {
  var p = raffle({min:1, max:20, winners:5}), s = {};
  for (var i = 0; i < p.length; i++) { if (s[p[i]]) dupes++; s[p[i]] = true; }
}
ok("400 five-winner draws produced no duplicate ticket", dupes === 0, dupes + " duplicates");

print("== a ticket already drawn is never drawn again ==");
var already = {3:true, 4:true, 5:true, 6:true, 7:true, 8:true};
var redrawn = 0;
for (var t = 0; t < 400; t++) {
  var p = raffle({min:1, max:10, winners:2, drawn:already});
  for (var i = 0; i < p.length; i++) if (already[p[i]]) redrawn++;
}
ok("tickets 3-8 already drawn never came up again", redrawn === 0, redrawn + " redraws");

print("== an unsold range is never drawn ==");
var hitExcluded = 0;
for (var t = 0; t < 400; t++) {
  var p = raffle({min:1, max:20, winners:3, excl:[[5,15]]});
  for (var i = 0; i < p.length; i++) if (p[i] >= 5 && p[i] <= 15) hitExcluded++;
}
ok("tickets 5-15 marked unsold never won", hitExcluded === 0, hitExcluded + " hits");

print("== the draw still completes when almost every ticket is gone ==");
var gone = {}; for (var n = 1; n <= 98; n++) gone[n] = true;   // only 99 and 100 left
var short = 0;
for (var t = 0; t < 200; t++) {
  var p = raffle({min:1, max:100, winners:2, drawn:gone});
  if (p.length < 2) short++;
}
ok("200 draws for the last two tickets of 100 all completed", short === 0,
   short + " gave up before finding them - the host sees 'could not draw enough unique tickets'");

print("== the draw is even, not just legal ==");
var counts = {};
for (var t = 0; t < 12000; t++) { var p = raffle({min:1, max:6, winners:1}); counts[p[0]] = (counts[p[0]]||0)+1; }
var exp = 12000/6, chi = 0;
for (var n = 1; n <= 6; n++) chi += Math.pow((counts[n]||0) - exp, 2) / exp;
ok("12000 single-ticket draws over six tickets sit flat", chi < 20, "chi-square " + chi.toFixed(1) + ", expected about 5");

print("== the members draw reaches every member ==");
function pick(list){ return list[randInt(list.length)]; }
var members = ["a","b","c","d","e","f","g"], got = {};
for (var t = 0; t < 5000; t++) got[pick(members)] = true;
ok("all seven members were drawn at least once", Object.keys(got).length === 7,
   "only " + Object.keys(got).length + " reachable");
var mc = {};
for (var t = 0; t < 14000; t++) { var w = pick(members); mc[w] = (mc[w]||0)+1; }
var mexp = 14000/7, mchi = 0;
for (var i = 0; i < members.length; i++) mchi += Math.pow((mc[members[i]]||0) - mexp, 2) / mexp;
ok("14000 member draws sit flat across the roster", mchi < 22, "chi-square " + mchi.toFixed(1) + ", expected about 6");
ok("a roster of one always draws that member", pick(["only"]) === "only");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
