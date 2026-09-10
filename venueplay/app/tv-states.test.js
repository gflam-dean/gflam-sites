/* THE VENUE TV NEVER ENDS UP BLACK, AND NEVER STICKS ON A HOLD SCREEN.

   Both of these have happened in a real pub. tv.html carries the protections
   that came out of those nights - enterAds() forces a rebuild so the ads always
   come back rather than leaving a black wall, and enterHolding() arms a timeout
   so a room is never left staring at "Coming up" for ever. Nothing tested that
   either protection is still there.

   This is the screen on the wall for the whole night, in front of everybody, and
   it was the largest untested file in the product at 123 KB.

   The real functions are lifted out of the page and run against a stubbed DOM,
   rather than restated here: a copy keeps passing while the page changes.

   Run: jsc venueplay/app/tv-states.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay/tv.html", "../tv.html", "tv.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 10000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find tv.html"); throw new Error("no source"); }

function grab(name){
  var i = html.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
var fnAds = grab("enterAds"), fnHold = grab("enterHolding"), fnFrozen = grab("gameLooksFrozen");
ok("enterAds is still in tv.html", !!fnAds);
ok("enterHolding is still in tv.html", !!fnHold);
ok("gameLooksFrozen is still in tv.html", !!fnFrozen);
if (!fnAds || !fnHold || !fnFrozen) throw new Error("missing functions");

/* A DOM small enough to run these and nothing more. */
var els = {};
function el(){ return { style:{}, classList:{ add:function(){}, remove:function(){}, contains:function(){ return false; } },
                        textContent:"", innerHTML:"", getAttribute:function(){ return null; } }; }
function $(id){ if(!els[id]) els[id]=el(); return els[id]; }

var tvMode = "", adBuilt = true, ballInFlight = true, hostConnected = false;
var reloadWhenIdle = false, holdT = null, timers = [];
var HOLD_MAX_MS = 240000, FROZEN_GAME_MS = 90000;
var lastHostAt = 0, lastBingoAt = 0, idleFlag = false;
function idle(){ return idleFlag; }
function stopCelebrate(){} function cancelHolding(){ holdT = null; }
function cancelEmbedWatch(){} function hideGameFrame(){} function hideBingoLayers(){}
function hidePairPanel(){} function showPairPanel(){} function stopAds(){}
function showBingoLayer(){} function gameLabel(m){ return String(m||""); }
/* The mode switches tell the venue logo which state the wall is in (it comes off the
   ads and goes back for everything else). Stubbed here; tv-logo.test.js is the suite
   that checks what it actually does. */
function applyVenueLogo(){}
/* A mode switch now stops any ball still in the air, so it cannot paint over wherever
   the wall goes next (#ballReveal sits at z-index 15, above the ads). Counted here so a
   switch that forgets to call it is visible; what stopReveal actually DOES to the screen
   is covered by tv-screen.test.js, which runs the real one. */
var revealsStopped = 0;
function stopReveal(){ revealsStopped++; }
var adsStarted = 0;
function startAds(){ adsStarted++; }
function setTimeout_(fn, ms){ timers.push({fn:fn, ms:ms}); return timers.length; }
var setTimeout = setTimeout_;
eval(fnAds); eval(fnHold); eval(fnFrozen);

print("== a ball in the air does not follow the wall to the next state ==");
revealsStopped = 0; enterAds();
ok("going to the ads stops a reveal", revealsStopped === 1,
   "a bingo ball left mid-flight paints over the venue's advertising");
revealsStopped = 0; enterHolding("bingo");
ok("going to the holding card stops a reveal", revealsStopped === 1);

print("== the wall never goes black ==");
adBuilt = true; adsStarted = 0;
enterAds();
ok("entering ads forces the slides to be rebuilt", adBuilt === false,
   "adBuilt stayed true: the ads would not come back after a game and the wall goes black");
ok("entering ads actually starts them", adsStarted === 1);
ok("entering ads sets the mode to ads", tvMode === "ads");
ok("a ball in flight is cleared on the way in", revealsStopped >= 1,
   "clearing the flag now lives inside stopReveal(), so the switch must call it");

print("== a hold screen always has a way back ==");
timers = []; holdT = null;
enterHolding("bingo");
ok("holding sets the mode to holding", tvMode === "holding");
ok("holding arms a timeout so the room is never stuck", timers.length === 1,
   "no timer: a hold screen with no host would stay up all night");
ok("that timeout is minutes, not hours", timers.length === 1 && timers[0].ms <= 10*60*1000,
   timers.length ? timers[0].ms + "ms" : "none");
/* Guarded. Removing the timeout used to make this file throw a TypeError
   instead of reporting a failure, and the gate reads the last line to decide
   whether a suite passed - so a crash and a pass look closer than they should. */
if (timers.length) {
  tvMode = "holding"; adBuilt = true; adsStarted = 0;
  timers[0].fn();
  ok("when it fires from holding it falls back to the ads", tvMode === "ads" && adsStarted === 1);
  timers = []; holdT = null; enterHolding("trivia"); tvMode = "bingo";
  if (timers.length) {
    timers[0].fn();
    ok("but it does NOT interrupt a game that started meanwhile", tvMode === "bingo",
       "a round starting inside the hold window must not be thrown back to ads");
  } else {
    ok("but it does NOT interrupt a game that started meanwhile", false, "no timeout was armed");
  }
} else {
  ok("when it fires from holding it falls back to the ads", false, "no timeout was armed");
  ok("but it does NOT interrupt a game that started meanwhile", false, "no timeout was armed");
}

print("== an idle screen is not a frozen game ==");
idleFlag = true; lastHostAt = 0; lastBingoAt = 0;
ok("a screen with no game running is never 'frozen'", gameLooksFrozen() === false,
   "otherwise an idle wall would keep trying to rescue a game that is not on");
idleFlag = false; lastHostAt = Date.now(); lastBingoAt = Date.now();
ok("a game that just spoke is not frozen", gameLooksFrozen() === false);
idleFlag = false; lastHostAt = Date.now() - 10*60*1000; lastBingoAt = 0;
ok("a game silent for ten minutes IS frozen", gameLooksFrozen() === true);

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
