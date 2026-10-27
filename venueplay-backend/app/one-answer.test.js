/* THE COPIES MUST GIVE THE SAME ANSWER, not merely look alike.

   The gate already holds esc(), cryptoInt() and tvSend() identical by TEXT. That rule has a
   hole either side of it:

     - Rename a copy and it leaves the rule entirely. venueCode is fnvVenueCode in the game
       Worker; cryptoInt is pick in partyplay/run.html. Neither was being compared with
       anything.
     - Rewrite a copy in a different style and the rule goes red over whitespace and variable
       names while the behaviour is fine, which is how a check gets switched off.

   Both are answered by running them. Lift every copy, feed them the same inputs, and require
   the same output. A renamed copy is caught because the search is by shape, not name; a
   restyled one passes because it gives the right answer, which is the only thing that was
   ever being claimed.

   Measured 12 Sep 2026: venueCode, fnvVenueCode and vp-session's venueCode are three different
   texts and all three return 4P4NJS for tugun-bowls. Latent drift, not a live fault, which is
   exactly the state a check should lock in before somebody edits one of them.

   Run: jsc venueplay-backend/app/one-answer.test.js */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var t = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 200) return s; } catch (e) {} }
  return null;
}
function fnbody(src, name) {
  var m = new RegExp("\\n\\s*function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
// Lift a function under a throwaway name so several copies can live at once.
var _n = 0;
function lift(src, name) {
  var b = fnbody(src, name);
  if (!b) return null;
  var alias = "_f" + (++_n);
  var out = b.replace(new RegExp("function\\s+" + name), "function " + alias);
  try { (0, eval)(out); return (0, eval)(alias); } catch (e) { return null; }
}

/* ---------- 1. THE VENUE CODE. Nine copies decide whether a phone and a TV meet. ---------- */
var VENUE_CODE_FILES = [
  ["venueplay/tv.html", "venueCode"],
  ["venueplay/play.html", "venueCode"],
  ["venueplay/signage.html", "venueCode"],
  ["venueplay/app/members/screen.html", "venueCode"],
  ["venueplay/app/musical/screen.html", "venueCode"],
  ["venueplay/app/raffle/screen.html", "venueCode"],
  ["venueplay/app/trivia/screen.html", "venueCode"],
  ["venueplay/app/vp-session.js", "venueCode"],
  ["venueplay-backend/worker/venueplay-game.js", "fnvVenueCode"]
];
// Real slugs, including a postcode-suffixed one, because that is the shape new venues get.
var SLUGS = ["tugun-bowls", "wellshot-hotel", "the-jolly-jess", "praze-the-roof-sports-bar",
             "the-mini-bar", "connie-is-a-cuntry-club", "the-grand-hotel-4210", "a", ""];

var impls = [], missing = [];
VENUE_CODE_FILES.forEach(function (p) {
  var src = find(p[0]);
  if (!src) { missing.push(p[0] + " (file not found)"); return; }
  var f = lift(src, p[1]);
  if (!f) { missing.push(p[0] + ":" + p[1]); return; }
  impls.push({ where: p[0].split("/").pop() + ":" + p[1], f: f });
});
pass("every copy of the venue code was found and could be run", missing.length === 0,
     missing.join(", ") + " could not be lifted; a copy this cannot see is a copy it cannot check");
pass("there are as many copies as this repo thinks", impls.length >= 8, impls.length + " found");

var disagree = [];
SLUGS.forEach(function (s) {
  var first = null;
  impls.forEach(function (i) {
    var v;
    try { v = i.f(s); } catch (e) { v = "threw: " + (e && e.message); }
    if (first === null) first = v;
    else if (v !== first) disagree.push(i.where + '("' + s + '") = ' + v + ", not " + first);
  });
});
pass("every copy turns a slug into the SAME code", disagree.length === 0, disagree.slice(0, 3).join(" | "));
pass("and it is a real code, not an empty string",
     impls.length > 0 && /^[A-Z0-9]{6}$/.test(impls[0].f("tugun-bowls")), impls.length ? impls[0].f("tugun-bowls") : "");
/* THE SCAN MUST BE ABLE TO SEE A DIFFERENCE. Nine copies agreeing proves nothing if the
   comparison is broken, which is the fault this whole suite exists to catch elsewhere. */
(function () {
  var broken = function (s) { return String(s).toUpperCase().slice(0, 6) || "XXXXXX"; };
  var caught = false;
  SLUGS.forEach(function (s) {
    if (impls.length && broken(s) !== impls[0].f(s)) caught = true;
  });
  pass("the comparison can tell two answers apart", caught,
       "a deliberately wrong implementation is detected, so agreement above means something");
})();

/* ---------- 2. THE DRAW. cryptoInt is the RNG behind every winner. ---------- */
var DRAW_FILES = [
  ["venueplay/tv.html", "cryptoInt"],
  ["venueplay/app/index.html", "cryptoInt"],
  ["venueplay/app/members/screen.html", "cryptoInt"],
  ["venueplay/app/raffle/screen.html", "cryptoInt"],
  ["partyplay/run.html", "pick"]
];
/* Its answer is random by design, so "same output" is the wrong question. What every copy must
   agree on is the CONTRACT: in range, never the ceiling, never negative, and it must actually
   move. A biased draw is a licence matter, which is why this is here and not left to chance. */
/* jsc has no crypto.getRandomValues, and these functions are built on it on purpose: this
   repo's rule is that a draw comes from a CSPRNG, never Math.random. Give it a real source of
   bytes rather than weakening the function, and make the stub UNIFORM, because a lopsided stub
   would fake the very bias this suite is looking for. */
if (typeof crypto === "undefined") {
  crypto = { getRandomValues: function (a) {
    for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296) >>> 0;
    return a;
  } };
}

var drawImpls = [], drawMissing = [];
DRAW_FILES.forEach(function (p) {
  var src = find(p[0]);
  if (!src) { drawMissing.push(p[0]); return; }
  var f = lift(src, p[1]);
  if (!f) { drawMissing.push(p[0] + ":" + p[1]); return; }
  drawImpls.push({ where: p[0].split("/").pop() + ":" + p[1], f: f });
});
pass("every draw function was found, including the renamed one", drawMissing.length === 0,
     drawMissing.join(", ") + "  (partyplay/run.html calls it pick, so the name-based rule never saw it)");

var outOfRange = [], stuck = [];
drawImpls.forEach(function (i) {
  var seen = {}, n = 0;
  for (var k = 0; k < 600; k++) {
    var v;
    try { v = i.f(10); } catch (e) { outOfRange.push(i.where + " threw"); return; }
    if (!(v >= 0 && v < 10 && v === Math.floor(v))) { outOfRange.push(i.where + " gave " + v); return; }
    if (!seen[v]) { seen[v] = 1; n++; }
  }
  if (n < 8) stuck.push(i.where + " only ever returned " + n + " of 10 values");
});
pass("every draw stays inside its range and never returns the ceiling", outOfRange.length === 0,
     outOfRange.slice(0, 2).join(", "));
pass("and none of them is stuck on a few numbers", stuck.length === 0, stuck.slice(0, 2).join(", "));

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
