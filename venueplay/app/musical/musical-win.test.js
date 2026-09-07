/* WHEN A MUSICAL BINGO CARD IS A WIN, tested against play.html itself.

   Musical bingo is a 5x5 card of songs with a free centre. The player taps when
   they hear the track; the phone decides whether that completes the pattern
   before the host is ever asked. Same stake as 90-ball: told you have not won
   when you have, or a prize paid on a card that has not.

   musical-draw.test.js covers which songs get drawn and live-fixes.test.js
   guards the five faults a real night found. Neither touches the win itself.

   isCovered has a fallback that matters and is easy to break: a host whose page
   loaded before song ids shipped broadcasts titles alone, and refusing to fall
   back would leave every card in the room blank for the rest of that night.

   Run: jsc venueplay/app/musical/musical-win.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay/app/musical/play.html", "../musical/play.html", "play.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 5000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find musical/play.html"); throw new Error("no source"); }
function grab(name){
  var i = html.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, s = false;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; s = true; }
    else if (html[j] === "}") { d--; if (s && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
var srcs = ["isCovered", "playedSet", "checkPattern"].map(grab);
ok("the win logic is still in musical/play.html", srcs.every(function(x){ return !!x; }));
if (!srcs.every(function(x){ return !!x; })) throw new Error("missing functions");

var P = { pattern:"one", cells:true, played:[], playedIds:[] };
function cellId(i){ return P.ids ? P.ids[i] : null; }
function cellTitle(i){ return P.titles[i]; }
eval(srcs.join("\n"));

/* 25 songs, centre is free. */
P.titles = []; for (var i = 0; i < 25; i++) P.titles.push("Song " + i);
function playTitles(idxs){ P.played = []; P.playedIds = []; for (var i=0;i<idxs.length;i++) P.played.push(P.titles[idxs[i]]); }
function row(r){ var o=[]; for (var c=0;c<5;c++) o.push(r*5+c); return o; }
function join(){ var o=[]; for (var i=0;i<arguments.length;i++) o=o.concat(arguments[i]); return o; }

print("== the centre square is free ==");
P.pattern = "one"; playTitles(row(2).filter(function(i){ return i !== 12; }));
ok("the middle row completes without the centre song ever playing", checkPattern() === true,
   "the free square must count as covered");

print("== a line is only a line when every song on it has played ==");
P.pattern = "one"; playTitles(row(0));
ok("a full top row is one line", checkPattern() === true);
playTitles(row(0).slice(0, 4));
ok("four of five is not a line", checkPattern() === false, "one song short must not win");

print("== two lines and full house ==");
P.pattern = "two"; playTitles(join(row(0), row(4)));
ok("two completed rows is two lines", checkPattern() === true);
playTitles(row(0));
ok("ONE row is not two lines", checkPattern() === false, "paying a two-line prize on one line");
P.pattern = "full"; playTitles(join(row(0),row(1),row(2),row(3),row(4)));
ok("all twenty-five is a full house", checkPattern() === true);
playTitles(join(row(0),row(1),row(2),row(3)));
ok("four rows is not a full house", checkPattern() === false);

print("== corners ==");
P.pattern = "corners"; playTitles([0,4,20,24]);
ok("the four corners win", checkPattern() === true);
playTitles([0,4,20]);
ok("three corners do not", checkPattern() === false);
playTitles(row(0));
ok("a full top row alone is not corners", checkPattern() === false);

print("== songs that are not on the card never help ==");
P.pattern = "one"; P.played = ["Not On This Card","Nor This One"]; P.playedIds = [];
ok("unrelated songs win nothing", checkPattern() === false);

print("== ids are used when sent, and titles still work when they are not ==");
P.ids = []; for (var i = 0; i < 25; i++) P.ids.push("id" + i);
P.pattern = "one";
P.played = []; P.playedIds = row(0).map(function(i){ return "id" + i; });
ok("a row played by id is a win", checkPattern() === true);
P.played = row(0).map(function(i){ return P.titles[i]; }); P.playedIds = ["id99"];
ok("once ids are in play, a title alone does not win", checkPattern() === false,
   "with ids being sent, matching on title would let a re-released track double-mark");
P.played = row(0).map(function(i){ return P.titles[i]; }); P.playedIds = [];
ok("an older host sending titles only still wins", checkPattern() === true,
   "this fallback is what stops every card in the room going blank for the night");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
