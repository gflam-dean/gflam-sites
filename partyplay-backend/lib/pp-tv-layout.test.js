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
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
