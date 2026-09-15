/* THE TELLY IS THE THIRD SCREEN AND THE ONLY ONE THE WHOLE ROOM LOOKS AT.

   A party has three surfaces: the host's tablet, everybody's phone, and the television.
   Every automated check we had read one of the first two. On 15 Sep 2026 the TV was
   opened for the first time and the subtitle under each question was sitting hard
   against the left padding while the question above it spanned the full width.

   The cause is a CSS one that looks correct at a glance: .msg is inside a wrapper with
   text-align:center, so the TEXT was centred. But .msg also has max-width:24ch, and a
   capped block does not centre itself. The box was 343px wide starting at x=77 on a
   1920 screen. Play-testers had reported "off-centre subtitles" and it was never traced.

   Run: jsc partyplay-backend/lib/pp-tv-layout.test.js
*/
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var TV = find("partyplay/tv.html");
var pass = 0, bad = 0;
function ok(n, c, why) {
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (why ? "   " + why : "")); }
}

print("EVERY CAPPED BLOCK ON THE TELLY CENTRES ITSELF");

/* Pull each rule that caps its width and check it also centres. text-align on an
   ancestor does not do this, which is exactly why the fault survived a read-through. */
var caps = [];
var re = /\.([a-z][a-z0-9-]*)\s*\{([^}]*max-width[^}]*)\}/gi, m;
while ((m = re.exec(TV)) !== null) caps.push({ sel: m[1], body: m[2] });

ok("the telly has at least one width-capped block to check", caps.length > 0);
caps.forEach(function (c) {
  var centred = /margin-inline\s*:\s*auto/.test(c.body) ||
                /margin\s*:[^;]*auto/.test(c.body) ||
                /justify-self\s*:\s*center/.test(c.body);
  ok("." + c.sel + " centres its own box", centred,
     "max-width without margin-inline:auto leaves the box at the start edge, however the text inside is aligned");
});

ok("the question subtitle specifically is centred",
   /\.msg\{[^}]*max-width[^}]*margin-inline:auto|\.msg\{[^}]*margin-inline:auto[^}]*max-width/.test(TV),
   "this is the one the room reads under every question");


print("");
print("A LONG QUESTION SHRINKS INSTEAD OF RUNNING OFF THE SCREEN");
/* 14vh sizes off the screen's HEIGHT, which is the right unit, but takes no account of
   how many LINES the text wraps to. Measured 15 Sep 2026 on 1920x902: a 186 character
   question rendered at 126px and ran 92px off the bottom, silently, because .screen is
   a grid that simply overflows.

   Not hypothetical. Of the 6,306 questions in the packs, 312 are over 100 characters,
   17 are over 150, and the longest is 171. venueplay/app/trivia/screen.html has carried
   q-med/q-long/q-epic for the same reason since it was written. */
["b-med", "b-long", "b-epic"].forEach(function (c) {
  ok("the telly has a ." + c + " size", new RegExp("\\.big\\." + c + "\\s*\\{[^}]*font-size").test(TV),
     "one clamp cannot serve a two character bingo ball and a 171 character question");
});
ok("and each step is smaller than the one before",
   (function () {
     var v = ["b-med", "b-long", "b-epic"].map(function (c) {
       var m = new RegExp("\\.big\\." + c + "\\s*\\{[^}]*?(\\d+(?:\\.\\d+)?)vh").exec(TV);
       return m ? parseFloat(m[1]) : null;
     });
     return v[0] && v[1] && v[2] && v[0] > v[1] && v[1] > v[2];
   })(),
   "a longer question must get a SMALLER font, not just a different one");
ok("the size is chosen from the text length, not guessed",
   /_t\.length\s*>\s*150[\s\S]{0,120}b-epic/.test(TV) &&
   /_t\.length\s*>\s*100[\s\S]{0,120}b-long/.test(TV),
   "the class has to be applied where the text is written or the CSS is dead");
ok("a short caption still gets the full size",
   /_cls\s*=\s*"big"/.test(TV),
   "a bingo ball must stay enormous; that is the whole point of the telly");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
