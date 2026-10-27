/* WHETHER A VENUE IS BEHIND ON PAYMENT IS THAT VENUE'S BUSINESS.

   The game start route used to read the suspended state off the session's venue and answer
   "Your tab has run a bit long. Settle up on your account page" BEFORE it had established that
   the caller was staff at that venue. sessionId comes from the caller, so any signed-in host at
   any venue could hand in another venue's session id and read the answer: that message meant
   the venue was behind on payment, anything else meant it was not.

   Nobody was going to notice. The kill-switch worked, the message was kind, the tests were
   green, and the only thing wrong was the ORDER of two checks a hundred lines apart. Found
   12 Sep 2026 while reading past it for something else.

   WHAT THIS SUITE ACTUALLY GUARDS, because "we moved a check" is not a thing a test can see:

     1. No route reads a venue's ACCOUNT STATE before it knows who is asking. That is the rule,
        and it is checked by reading the order of the two calls in the route, not by trusting
        a comment that says it was fixed.

     2. The enforcement did not get dropped on the way. A suspended venue's host must still be
        refused, and requireStaff is the thing that now does it on every host route.

     3. The wording still fits the reader. A HOST is told what it is and how to clear it; a
        PLAYER is told to have a word with the staff, because it is not their business and there
        is nothing they can do. Moving the check would have quietly downgraded every host to the
        player message, which is a worse product, so audience is passed explicitly.

   Run: jsc venueplay-backend/worker/suspend-not-before-auth.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

var CANDS = ["venueplay-backend/worker/venueplay-game.js", "venueplay-game.js", "./venueplay-game.js"];
var src = null;
for (var i = 0; i < CANDS.length; i++) {
  try { var t = readFile(CANDS[i]); if (t && t.length > 100000) { src = t; break; } } catch (e) {}
}
if (src === null) { print("FAIL could not read venueplay-game.js"); throw new Error("no source"); }

/* Comments describe intent; code decides. Everything below reads the stripped source, or this
   suite would pass on a Worker whose only fix was a paragraph explaining the fix. */
function strip(t){
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
var code = strip(src);

/* ---- 1. the account state is never read before the caller is known ---- */
print("== no route reads a venue's account state before it knows who is asking ==");

/* The exact shape of the old fault: a select of vp_venues status keyed off a SESSION the caller
   named, sitting above the requireStaff for that session. */
var preAuthProbe = /sessions\[0\][\s\S]{0,200}vp_venues[\s\S]{0,120}select=status/;
ok("the game start route no longer probes vp_venues.status off a caller-supplied session",
   !preAuthProbe.test(code),
   "that answered 'settle up' for any venue id a signed-in host cared to try");

ok("the settle-up wording is not returned from any route directly",
   code.indexOf("return json({ error: 'Your tab has run a bit long") < 0,
   "a route returning it has decided the caller may know, without necessarily having checked");

/* Order, read rather than assumed. In the start route, requireStaff must come before anything
   that could disclose the venue's state. */
var startIdx = code.indexOf("id=eq.' + enc(sessionId) + '&select=*");
ok("the game start route is still findable", startIdx > 0);
if (startIdx > 0) {
  var after = code.slice(startIdx, startIdx + 2500);
  var iStaff = after.indexOf("requireStaff(env, authUserId, session.venue_id");
  var iStatus = after.indexOf("select=status");
  ok("requireStaff runs before anything in that route reads a venue status",
     iStaff >= 0 && (iStatus < 0 || iStaff < iStatus),
     "requireStaff at " + iStaff + ", a status read at " + iStatus);
}

/* ---- 2. the enforcement is still there ---- */
print("");
print("== a suspended venue's host is still refused ==");
ok("the game start route asks for the HOST wording, because its reader is the host",
   /requireStaff\(env, authUserId, session\.venue_id, 'host'\)/.test(code),
   "the one person who can clear a suspension has to be told what it is");
var reqIdx = code.indexOf("async function requireStaff");
var reqBody = reqIdx < 0 ? "" : code.slice(reqIdx, code.indexOf("\n}", reqIdx));
ok("requireStaff is still the gate both paths go through", reqIdx > 0);
var killCalls = (reqBody.match(/assertVenueActive\(/g) || []).length;
ok("BOTH paths through requireStaff check it, the staff one and the HQ admin one",
   killCalls === 2, killCalls + " assertVenueActive call(s) inside requireStaff");
/* audience is FORWARDED, not hardcoded. Hardcoding 'host' inside requireStaff changed the
   bingo ball and members draw too, and those answer in the ROOM's words and have a SQL twin in
   migration 76 that has to match byte for byte. one-trip-draws.test.js caught that immediately,
   which is the whole reason that suite runs both paths over the same scripted database. */
ok("both paths FORWARD the audience rather than hardcoding one",
   (reqBody.match(/assertVenueActive\(env, venueId, audience\)/g) || []).length === 2,
   "hardcoding it here silently rewords every one of the 36 host routes");
ok("and requireStaff takes it as an argument so callers opt in",
   /async function requireStaff\(env, authUserId, venueId, audience\)/.test(code));

ok("assertVenueActive still refuses a venue that is not active",
   /venues\[0\]\.status !== 'active'/.test(code));
ok("and still refuses one whose GROUP is switched off",
   /vp_venue_groups[\s\S]{0,200}status !== 'active'/.test(code),
   "a group-level suspension has to reach every venue under it");

/* ---- 3. the right words reach the right reader ---- */
print("");
print("== the wording still fits whoever is reading it ==");
var avIdx = code.indexOf("async function assertVenueActive");
var avBody = avIdx < 0 ? "" : code.slice(avIdx, avIdx + 1400);
ok("assertVenueActive takes an audience", /assertVenueActive\(env, venueId, audience\)/.test(avBody));
ok("a host is told what it is and how to clear it",
   /audience === 'host'[\s\S]{0,160}Settle up on your account page/.test(avBody),
   "a host who cannot see the reason cannot fix it");
ok("a player is told to have a word with the staff, not shown the account state",
   /Games are paused here tonight\. Have a word with the staff\./.test(avBody),
   "the billing state of the pub is not the punter's business");
ok("host is OPT-IN, so a path that has not checked cannot leak by accident",
   avBody.indexOf("audience === 'host'") >= 0 &&
   avBody.indexOf("audience !== 'player'") < 0,
   "defaulting to the host message would make every unauthenticated caller a reader");

/* The player routes must NOT have been swept up in this. /join has no host login at all. */
print("");
print("== the unauthenticated player routes still use the player wording ==");
var joinIdx = code.indexOf("const venueCheck = assertVenueActive(env, session.venue_id)");
ok("/join still checks the kill-switch", joinIdx > 0,
   "a suspended venue must not keep accruing metered player rows");
ok("and does NOT claim to be a host", joinIdx > 0 &&
   code.slice(joinIdx, joinIdx + 120).indexOf("'host'") < 0,
   "a player would be shown the venue's account state");

var playerCalls = (code.match(/assertVenueActive\(env, session\.venue_id\)/g) || []).length;
ok("every session-keyed player path is still guarded and still speaks to a player",
   playerCalls >= 3, playerCalls + " player-side call(s)");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
