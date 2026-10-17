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
print("THE LOBBY FITS ABOVE THE NAMES STRIP (17 Oct 2026)");
/* At 1280x720 with a room joined, the strip of names (position:fixed over the screen) sat on
   the bottom 90px of the QR card and on "Wrong party? Use a different code", and the QR itself
   was 420px on every telly because the QR library writes its own size onto the canvas. The
   strip now takes its own room and fitScreen() shrinks whatever is up to the room that is left.
   These RUN the page's own fitScale and fitNow, lifted out of tv.html. */
function lift(name){
  var m = new RegExp("\\n  function " + name + "\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}\\n").exec(TV);
  if (!m) throw new Error(name + " is not in tv.html: a suite that cannot find its code cannot fail");
  return m[0];
}
var FIT = (new Function("$", "getComputedStyle", lift("fitScale") + lift("fitNow") + "\nreturn { fitScale:fitScale, fitNow:fitNow };"));
var stage = {}, F = FIT(function(id){ return stage[id]; }, function(){ return { paddingLeft:"51", paddingRight:"51", paddingTop:"29", paddingBottom:"29" }; });

ok("a picture that fits is left exactly as drawn", F.fitScale(900, 400, 1178, 454) === 1);
ok("it is never scaled UP to fill a big telly", F.fitScale(900, 300, 3600, 1800) === 1);
var s1 = F.fitScale(780, 515, 1178, 454);
ok("a lobby taller than the room left is shrunk until it fits", s1 < 1 && 515 * s1 <= 454 && 515 * (s1 + 0.01) > 454, "scale " + s1);
ok("too wide shrinks too", F.fitScale(2000, 300, 1178, 454) <= 1178 / 2000);
ok("something absurd never shrinks it to nothing", F.fitScale(780, 50000, 1178, 454) === 0.4);
ok("nothing measured (a hidden tab) means nothing is changed", F.fitScale(0, 0, 1178, 454) === 1 && F.fitScale(780, 515, 0, 0) === 1);

/* The measured fault: the screen above a two-row strip is 512 tall at 1280x720 and the lobby
   is 515 tall. A grid item that overflows starts at the top padding and runs out the bottom, so
   scaling about its middle still leaves it under the strip. fitNow scales from the top and moves
   it to the middle of the room there is: run it and check where the lobby ends up. */
function el(top, h, w){
  return { scrollHeight:h, scrollWidth:w, id:"", style:{ transform:"x", transformOrigin:"x" },
           getBoundingClientRect:function(){ return { top:top, bottom:top + h }; } };
}
/* Where the browser paints it: unscaled box [top, top+h], scaled about its origin (the top edge
   for "center top", the middle for anything else, which is the CSS default), then moved by dy. */
function placed(e, h){
  var t = e.style.transform, s = 1, dy = 0, m, top0 = e.getBoundingClientRect().top;
  if ((m = /scale\(([\d.]+)\)/.exec(t))) s = parseFloat(m[1]);
  if ((m = /translateY\((-?\d+)px\)/.exec(t))) dy = parseInt(m[1], 10);
  var oy = e.style.transformOrigin === "center top" ? top0 : top0 + h / 2;
  var top = oy + (top0 - oy) * s + dy;
  return { top:top, bottom:top + h * s, origin:e.style.transformOrigin };
}
var lobby = el(29, 515, 780);
stage.screen = { clientWidth:1280, clientHeight:512, firstElementChild:lobby, getBoundingClientRect:function(){ return { top:0 }; } };
F.fitNow();
var p = placed(lobby, 515);
ok("the shrunk lobby ends above the strip (screen 0 to 512, padding 29)", p.bottom <= 512 - 29 + 1, JSON.stringify(p) + " " + lobby.style.transform);
ok("and starts below the top padding, so it is centred in what is left, not pushed up", p.top >= 29 - 1, JSON.stringify(p));
ok("scaled from its top edge, where an overflowing grid item actually sits", p.origin === "center top");
/* And a browser that DOES centre an overflowing item (it starts above the padding): fitNow has to
   move it down by what it measured, not assume where it sits. */
var lobby2 = el(-1.5, 515, 780);
stage.screen.firstElementChild = lobby2;
F.fitNow();
var p2 = placed(lobby2, 515);
ok("wherever the browser left it, the shrunk lobby lands inside the padding", p2.top >= 29 - 1 && p2.bottom <= 512 - 29 + 1, JSON.stringify(p2) + " " + lobby2.style.transform);
var small = el(120, 300, 780);
stage.screen.firstElementChild = small;
F.fitNow();
ok("a lobby that fits is left with no transform at all", small.style.transform === "" && small.style.transformOrigin === "");
stage.screen.firstElementChild = { id:"gmwrap", style:{ transform:"keep" } };
F.fitNow();
ok("the Great Minds board, which is the whole wall and sizes itself, is never touched", stage.screen.firstElementChild.style.transform === "keep");

ok("fitScreen runs after every picture goes up",
   /function show\(html\)\{[^\n]*\$\("screen"\)\.innerHTML = html; fitScreen\(\); \}/.test(TV));
ok("and after the names strip changes height",
   /function drawWho\(\)\{[\s\S]*?fitScreen\(\);[^\n]*\n  \}/.test(TV));
ok("and when the telly changes size", /addEventListener\("resize", fitScreen/.test(TV));
var whoRule = (/\n  \.who\{([^}]*)\}/.exec(TV) || [])[1] || "";
ok("the names strip takes its own room instead of sitting over the screen",
   whoRule && !/position\s*:\s*fixed/.test(whoRule) && /body\{display:flex;flex-direction:column\}/.test(TV) && /\.screen\{flex:1 1 auto;min-height:0/.test(TV),
   whoRule);
ok("an empty strip is really hidden (display:flex beat the browser's own [hidden] rule)", /\.who\[hidden\]\{display:none\}/.test(TV));
ok("the QR card is sized by the telly, not the 420px the QR library writes onto the canvas",
   /\.qr canvas\{[^}]*width:\d+vh !important;height:\d+vh !important/.test(TV));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
