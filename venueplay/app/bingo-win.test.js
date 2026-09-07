/* WHEN IS IT A WIN? Tested against play.html itself.

   This is the sharpest edge in the product. A player taps BINGO in front of a
   room; the page decides whether that is a win before the host ever sees it. Get
   it wrong one way and somebody who has won is told they have not, out loud. Get
   it wrong the other way and the host is asked to check a ticket that has not
   won, and pays a prize that was not earned.

   play.html is 92 KB and had NO test of any kind. That is the file a punter's
   phone runs.

   The real cardMeetsPattern, rowDone and cornerNums are lifted out of the page
   rather than copied here, for the reason musical-draw.test.js gives: a copy
   keeps passing while the page changes underneath it.

   Run: jsc venueplay/app/bingo-win.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

var CANDIDATES = ["venueplay/play.html", "../play.html", "play.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 5000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find play.html"); throw new Error("no source"); }

function grab(name) {
  var i = html.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
var src = ["rowDone", "cornerNums", "cardMeetsPattern"].map(grab);
ok("the win logic is still in play.html", src.every(function (s) { return !!s; }),
   "cardMeetsPattern / rowDone / cornerNums");
if (!src.every(function (s) { return !!s; })) throw new Error("missing functions");

var P = { pattern: "one" };
eval(src.join("\n"));

/* A real 3x9 housie ticket: 15 numbers, 5 to a row, blanks are 0. */
var CARD = [
  [ 4, 0,23, 0,45, 0,67, 0,88],
  [ 0,12,26,34, 0,58, 0,71, 0],
  [ 9, 0, 0,38,49,54, 0,79,90]
];
function called(list){ var s = {}; for (var i = 0; i < list.length; i++) s[list[i]] = true; return s; }
function rowNums(r){ var o = []; for (var c = 0; c < 9; c++) if (CARD[r][c]) o.push(CARD[r][c]); return o; }
var TOP = rowNums(0), MID = rowNums(1), BOT = rowNums(2);
function join(){ var o = []; for (var i = 0; i < arguments.length; i++) o = o.concat(arguments[i]); return o; }

print("== a row is only done when every number on it is called ==");
P.pattern = "top";
ok("top row with all five called is a win", cardMeetsPattern(CARD, called(TOP)));
ok("top row with four of five is NOT a win",
   !cardMeetsPattern(CARD, called(TOP.slice(0, 4))), "one number short must not win");
ok("a full middle row does not win 'top'", !cardMeetsPattern(CARD, called(MID)));
P.pattern = "middle";
ok("middle row wins on middle", cardMeetsPattern(CARD, called(MID)));
ok("middle row one short does not win", !cardMeetsPattern(CARD, called(MID.slice(0, 4))));
P.pattern = "bottom";
ok("bottom row wins on bottom", cardMeetsPattern(CARD, called(BOT)));
ok("bottom row one short does not win", !cardMeetsPattern(CARD, called(BOT.slice(0, 4))));

print("== one line, two lines, full house ==");
P.pattern = "one";
ok("any single completed row is one line", cardMeetsPattern(CARD, called(MID)));
ok("nothing called is not one line", !cardMeetsPattern(CARD, called([])));
P.pattern = "two";
ok("two completed rows is two lines", cardMeetsPattern(CARD, called(join(TOP, BOT))));
ok("ONE completed row is not two lines",
   !cardMeetsPattern(CARD, called(TOP)), "this is the expensive one: paying a two-line prize on one line");
P.pattern = "full";
ok("all three rows is a full house", cardMeetsPattern(CARD, called(join(TOP, MID, BOT))));
ok("two rows is not a full house", !cardMeetsPattern(CARD, called(join(TOP, MID))));
ok("full house one number short is not a full house",
   !cardMeetsPattern(CARD, called(join(TOP, MID, BOT).slice(0, 14))));

print("== corners ==");
P.pattern = "corners";
var CN = cornerNums(CARD);
ok("corners are the first and last number of the top and bottom rows",
   CN.length === 4 && CN[0] === 4 && CN[1] === 88 && CN[2] === 9 && CN[3] === 90,
   "got " + CN.join(","));
ok("all four corners called is a win", cardMeetsPattern(CARD, called(CN)));
ok("three corners is not a win", !cardMeetsPattern(CARD, called(CN.slice(0, 3))));
ok("a full top row alone is not corners", !cardMeetsPattern(CARD, called(TOP)));

print("== numbers that are not on the ticket must not help ==");
P.pattern = "top";
ok("calling every OTHER number never wins",
   !cardMeetsPattern(CARD, called([1,2,3,5,6,7,8,10,11,13,14,15,16,17,18,19,20,21,22])));
ok("the whole barrel does win", cardMeetsPattern(CARD, (function(){
  var s = {}; for (var n = 1; n <= 90; n++) s[n] = true; return s; })()));

print("== an unknown pattern must refuse, not guess ==");
P.pattern = "whatever-the-host-typed";
ok("an unrecognised pattern is never a win", !cardMeetsPattern(CARD, called(join(TOP, MID, BOT))));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
