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

   Run: jsc venueplay-backend/app/bingo-win.test.js
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

/* A LINE WIN MUST SURVIVE THE NEXT BALL.
   It used to be announced with setMsg, the one message line under the tickets, and the very next
   ball (or any state message, and the host sends one every time somebody joins) repainted that
   line with "Mark off your numbers". The winner was left holding a live ticket with no proof for
   the host. The win now has its own pinned box, renderStageWin, which the ball path repaints
   rather than clears. These run the real functions out of play.html against a stub box. */
print("== a line win stays on screen when the next ball lands ==");
var stageSrc = ["idleMsg", "nameList", "renderStageWin"].map(grab);
ok("the stage win banner is still in play.html", stageSrc.every(function (s) { return !!s; }),
   "renderStageWin / idleMsg / nameList");
if (stageSrc.every(function (s) { return !!s; })) {
  var BOX = { innerHTML: "", className: "" };
  function $(id){ return id === "stageWin" ? BOX : null; }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  var PATTERN_NAMES = { one:"One line", two:"Two lines", full:"Full house", corners:"Four corners",
                        top:"Top line", middle:"Middle line", bottom:"Bottom line" };
  eval(stageSrc.join("\n"));

  P.stageWins = []; P.stageNote = ""; P.pattern = "one";
  renderStageWin();
  ok("nothing won yet, so no banner", BOX.className.indexOf("hidden") >= 0);

  P.stageWins = [{ pattern:"one", prize:"$50 bar tab", cardNo:412, shared:false, sharedWith:[] }];
  P.pattern = "full";
  renderStageWin();
  var first = BOX.innerHTML;
  ok("the banner names the line that was won", first.indexOf("You won One line") >= 0, first);
  ok("it tells them to see the host", first.indexOf("See the host") >= 0);
  ok("it names the prize for that line, not the house prize", first.indexOf("$50 bar tab") >= 0);
  ok("it shows the card number to claim on", first.indexOf("#412") >= 0);
  ok("it says what they are playing for now", first.indexOf("Full house") >= 0);
  ok("the banner is visible", BOX.className.indexOf("hidden") < 0, BOX.className);

  // the ball path: setMsg gets the resting line, renderStageWin repaints the banner
  var resting = idleMsg();
  ok("the resting line no longer carries the win", resting.indexOf("You won") < 0, resting);
  ok("the resting line says what is being played for", resting.indexOf("Full house") >= 0, resting);
  renderStageWin();
  ok("the win is still on screen after the next ball", BOX.innerHTML === first);
  ok("and still visible", BOX.className.indexOf("hidden") < 0);

  // a tie, and a second stage won by the same phone
  P.stageWins.push({ pattern:"two", prize:"$100", cardNo:412, shared:true, sharedWith:["Kate","Sam"] });
  renderStageWin();
  ok("a shared line says who it is shared with", BOX.innerHTML.indexOf("Kate and Sam") >= 0, BOX.innerHTML);
  ok("an earlier win tonight is still listed", BOX.innerHTML.indexOf("One line") >= 0);

  // somebody else won the stage
  P.stageWins = []; P.stageNote = "Kate won One line.";
  renderStageWin();
  ok("somebody else's win is shown too", BOX.innerHTML.indexOf("Kate won One line") >= 0, BOX.innerHTML);
  ok("and it is not dressed up as your win", BOX.className.indexOf("others") >= 0, BOX.className);

  // a name with markup in it must not reach the page as markup
  P.stageWins = [{ pattern:"one", prize:"<b>x</b>", cardNo:1, shared:true, sharedWith:["<script>"] }];
  P.stageNote = "";
  renderStageWin();
  ok("a name or prize with tags in it is escaped", BOX.innerHTML.indexOf("<script>") < 0 &&
     BOX.innerHTML.indexOf("<b>x</b>") < 0, BOX.innerHTML);
}

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
