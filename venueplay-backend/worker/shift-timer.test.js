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

print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
