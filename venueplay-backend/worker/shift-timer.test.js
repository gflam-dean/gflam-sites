/* ONE SHIFT TIMER, SHARED BY EVERY CONSOLE.

   The forced 4 hour sign-out is a COMPLIANCE control, not a convenience: opt-in
   player data sits behind that login. It has to behave identically on all five
   consoles, and until 5 Sep it did not, because /app defined its own endShift and
   enforceShift which SHADOWED the shared ones in vp-session.js.

   Three things only the shared version does:
     - gameIsLive(): leaves a live night OPEN. The local copy called
       closeOpenNight() unconditionally, so a timeout landing mid-bingo closed the
       session and finished every running game.
     - retryPendingCloses(): drains a close lost to a wifi blip. Its own comment
       claims "every one of them calls enforceShift()", and /app was the one that
       did not.
     - an INTERVAL that re-reads the deadline, not a setTimeout frozen at load. The
       frozen one fires against the OLD deadline, signing out the NEXT host after a
       handover, mid-game.

   Run: jsc venueplay-backend/worker/shift-timer.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

var SHARED = find("venueplay/app/vp-session.js");
var CONSOLES = [
  ["bingo",   "venueplay/app/index.html"],
  ["musical", "venueplay/app/musical/host.html"],
  ["trivia",  "venueplay/app/trivia/host.html"],
  ["raffle",  "venueplay/app/raffle/host.html"],
  ["members", "venueplay/app/members/host.html"]
];

print("\nTHE SHARED TIMER STILL HAS THE THREE THINGS THAT MATTER");
pass("it guards a live night", /function gameIsLive/.test(SHARED) &&
     /gameIsLive\(\)\s*\?\s*Promise\.resolve/.test(SHARED),
     "a timeout mid-game must not close the session");
pass("it drains closes lost to bad wifi", /retryPendingCloses\(\)/.test(SHARED));
pass("the deadline is re-read on an interval, not frozen at load",
     /setInterval\(checkShift/.test(SHARED),
     "a frozen timeout signs out the NEXT host after a handover");

print("\nEVERY CONSOLE USES IT, AND NONE SHADOWS IT");
CONSOLES.forEach(function (c) {
  var name = c[0], src = find(c[1]);
  pass(name + " calls VP.enforceShift", /VP\.enforceShift\s*\(/.test(src));
  pass(name + " registers what counts as a live night", /VP\.setGameActive/.test(src),
       "without this the shared guard cannot know a game is running");
  // A local enforceShift would shadow the shared one and silently take over.
  pass(name + " does not define its own enforceShift",
       !/function\s+enforceShift\s*\([^)]*\)\s*\{[\s\S]{0,400}?setTimeout/.test(src),
       "a local copy shadows vp-session.js and loses all three protections");
});

print("\nA DELIBERATE SIGN-OUT STILL CLOSES THE NIGHT");
/* Not the same event as the timeout, and it needs the opposite treatment: the host
   pressed the button and confirmed through a dialog naming the running game, and
   closing is what bills an approved overage. */
var bingo = find("venueplay/app/index.html");
pass("the sign-out button closes the night", /signoutBtn[\s\S]{0,600}?endShift\(\)/.test(bingo));
pass("and it warns first when a game is live", /liveNightElsewhere\(\)/.test(bingo));

/* THE LIMIT ITSELF, DRIVEN WITH A CLOCK. The audit of 20 Sep 2026 changed SHIFT_MAX from
   4 to 400 hours and every gate stayed green: everything above reads structure, nothing
   ran the timer. So lift the real checkShift() and the real constant out of the shipped
   file and run them with a start 3h59m old (must stay signed in) and 4h01m old (must sign
   out), against stubs for the browser. */
(function () {
  var m = /var SHIFT_MAX\s*=\s*([^;]+);/.exec(SHARED);
  var limit = m ? (0, eval)(m[1]) : NaN;
  pass("the shift limit is four hours exactly, not a number somebody raised", limit === 4 * 3600 * 1000, "SHIFT_MAX = " + limit);
  var i = SHARED.indexOf("function checkShift()");
  if (i < 0) { pass("checkShift() is still in vp-session.js", false); return; }
  var depth = 0, j = SHARED.indexOf("{", i);
  for (var k = j; k < SHARED.length; k++) { if (SHARED[k] === "{") depth++; else if (SHARED[k] === "}") { depth--; if (!depth) break; } }
  var fn = SHARED.slice(i, k + 1);
  var store = {}, signedOut = 0, now = 1700000000000;
  var sandbox = "var SHIFT_KEY='vpShiftStart', SHIFT_MAX=" + limit + ", _shiftIv=null;"
    + "var localStorage={getItem:function(k){return store[k]==null?null:store[k];},setItem:function(k,v){store[k]=v;},removeItem:function(k){delete store[k];}};"
    + "var Date={now:function(){return now;}};"
    + "function clearInterval(){} function setTimeout(f){f();}"
    + "function signOut(){signedOut++;} function gameIsLive(){return true;} function closeOpenSessions(){return {then:function(a){a();}};}"
    + fn + "; return checkShift;";
  var ref = { n: 0 };
  var checkShift = new Function("store", "signedOutRef", "now", "return (function(){" + sandbox.replace(/signedOut\+\+/, "signedOutRef.n++") + "})()")(store, ref, now);
  store.vpShiftStart = String(now - (3 * 3600 + 59 * 60) * 1000);
  checkShift();
  pass("3h59m into a shift the host is still signed in", ref.n === 0 && store.vpShiftStart, "signOut calls: " + ref.n);
  store.vpShiftStart = String(now - (4 * 3600 + 60) * 1000);
  checkShift();
  pass("4h01m into a shift the host is signed out", ref.n === 1, "signOut calls: " + ref.n);
  pass("and the shift start is cleared so the next sign-in starts a fresh clock", store.vpShiftStart === undefined, JSON.stringify(store));
  store.vpShiftStart = String(now + 60000);
  checkShift();
  pass("a start in the future is treated as tampered and reset to now, not honoured", store.vpShiftStart === String(now) && ref.n === 1);
})();

print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
