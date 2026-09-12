/* "YOU ARE IN" HAS TO BE TRUE WHEN IT IS PRINTED.

   partyplay/play.html painted "You are in. Watch the big screen." and only THEN called
   connect(). connect() could fail three silent ways:

     if(!SUPA_ANON) return;                 a missing key, no message
     try { ... } catch(e) {}                anything at all, swallowed
     if(s === "SUBSCRIBED") ...             CHANNEL_ERROR, TIMED_OUT and CLOSED ignored

   The REST join had already succeeded, so the guest WAS on the host's list and DID count
   against the fifty player cap. They sat on "You are in" while the party went on without
   them, with nothing on screen to suggest a problem and nothing to press. At a party the
   phone gets shown to the host, who sees the same words, so neither of them can work out
   what is wrong.

   This is not a check that a message exists. It is a check that the OPTIMISTIC message is
   only reachable once the room can hear them, and that every other way out of connect()
   leaves the guest something true to read. Found 12 Sep 2026 by reading the join path.

   Run: jsc partyplay-backend/lib/pp-guest-connection.test.js
*/
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var SRC = readFile(ppFile("../partyplay/play.html"));

var bad = 0, pass = 0;
function ok(n, c, extra) {
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

/* Comments describe intent; code decides. The note explaining this fix quotes the old
   silent lines verbatim, so a scan of the raw source would match its own explanation.
   That has caught me three times in one day. */
function strip(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
var code = strip(SRC);

function fn(name) {
  var i = code.indexOf("function " + name + "(");
  if (i < 0) return "";
  var d = 0, started = false;
  for (var j = i; j < code.length; j++) {
    if (code[j] === "{") { d++; started = true; }
    else if (code[j] === "}") { d--; if (started && d === 0) return code.slice(i, j + 1); }
  }
  return "";
}
var CONNECT = fn("connect"), WAITING = fn("waiting");
ok("play.html still has connect() and waiting()", !!CONNECT && !!WAITING);

print("== the guest is only told they are in once the room can hear them ==");
ok('"You are in" lives inside the SUBSCRIBED branch',
   /SUBSCRIBED[\s\S]{0,400}waiting\([^)]*"live"\)/.test(CONNECT),
   "printed anywhere else it is a guess about a connection nobody has checked");
ok("and waiting() only prints it when asked for that state",
   /state === "live"[\s\S]{0,160}You are in/.test(WAITING),
   "the default has to be the honest one");
ok("the default state is NOT the optimistic one",
   !/\belse\s*\{[\s\S]{0,120}You are in/.test(WAITING),
   "a page that falls through to 'You are in' is the fault coming back");
ok("the honest default says something is still happening",
   /Getting you in/.test(WAITING));

print("== every way out of connect() leaves the guest something true ==");
ok("a missing key says so instead of returning quietly",
   /if\(!SUPA_ANON\)\{\s*waiting\([^)]*"lost"\)/.test(CONNECT),
   "this used to be a bare return, and the guest kept reading 'You are in'");
ok("the catch says so instead of swallowing it",
   /catch\(e\)\{\s*waiting\([^)]*"lost"\)/.test(CONNECT),
   "catch(e){} with nothing in it is how a party goes on without somebody");
ok("a dropped or refused channel is handled, not just SUBSCRIBED",
   /CHANNEL_ERROR/.test(CONNECT) && /TIMED_OUT/.test(CONNECT) && /CLOSED/.test(CONNECT),
   "three statuses that all mean the phone is deaf");
ok("and it tells them, with something to press",
   /Lost the connection/.test(WAITING) && /ppRetry/.test(WAITING),
   "a guest who can see it is broken can at least try again");
ok("the retry actually reconnects rather than only redrawing",
   /ppRetry[\s\S]{0,320}connect\(/.test(WAITING));

print("== but it does not throw away a game in progress ==");
/* Mid-question, this phone holds the only copy of what the guest is answering. Replacing
   that with a connection notice for a blip that usually recovers costs them the round. */
ok("a connection notice only replaces the WAITING screen, never a live game",
   (CONNECT.match(/if\(!Q && !B && !H && !T && !W\)/g) || []).length >= 2,
   "guarded on both the live and the lost path");

print("== the join no longer asserts it up front ==");
ok("the join path calls waiting() with no state, so it reads 'Getting you in'",
   /waiting\(j\.nickname\)\s*;/.test(code),
   "passing 'live' there would be claiming a connection that has not been made");
ok("and connect() is still called after the guest is on the list",
   code.indexOf("waiting(j.nickname)") < code.indexOf("connect(code.toUpperCase()"),
   "the order matters: the REST join is what puts them on the host's screen");
ok("a returning guest gets the same honest screen",
   /waiting\(saved\.nickname\);\s*showCamera\(\);\s*connect\(saved\.code/.test(code),
   "resuming is the same problem: their phone may come back deaf");

print("== the three states are told apart on screen, not just in the code ==");
ok("a waiting dot and a bad dot exist and are not the same as the good one",
   /\.dot-wait\{/.test(SRC) && /\.dot-bad\{/.test(SRC),
   "all three were drawn with the green dot that means everything is fine");
ok("the bad one is not green",
   /\.dot-bad\{background:var\(--pink\)\}/.test(SRC));

print("== a console that opens late, or is reloaded, finds the room ==");
/* `players` in run.html was built ONLY from hello broadcasts arriving while that console was
   open, and nothing ever asked. A host who reloaded part way through a party saw "0 playing"
   in a full room. Not cosmetic: paintCharades disables its own start button at zero and reads
   "Waiting for someone to join", so charades could not be started at all, and nextActor picks
   the actor from the same empty list. Found 12 Sep 2026 by running a party. */
var RUN = readFile(ppFile("../partyplay/run.html"));
var runCode = strip(RUN);
ok("the console asks the room who is there when it connects",
   /status==="SUBSCRIBED"[\s\S]{0,700}send\(\{t:"rollcall"\}\)/.test(runCode),
   "without asking, it only ever learns about phones that join AFTER it");
ok("and it asks on every connect, not once at page load",
   runCode.indexOf('send({t:"rollcall"})') > runCode.indexOf('function onChannelStatus'),
   "a reconnect has to re-ask, because the list is rebuilt from nothing");
ok("the phone answers a rollcall", /m\.t === "rollcall"/.test(code));
ok("and answers with the SAME hello the console already understands",
   /rollcall[\s\S]{0,260}_ppSend\(\{ t:"hello", name:/.test(code),
   "a new message shape would need handling at the other end too");
ok("a phone that has not joined yet stays quiet",
   /rollcall[\s\S]{0,200}if\(_s\.nickname/.test(code),
   "answering with an empty name would put a blank guest on the host's list");
ok("charades is still gated on knowing somebody is there",
   /players\.length\?''\:' disabled'|players\.length\?/.test(runCode.replace(/\s/g,'')) ||
   /Waiting for someone to join/.test(RUN),
   "the gate is right, it was the empty list that was wrong");

print("== the television's caption must not wipe a game off a phone ==");
/* THE ONE BUG BEHIND NINE BROKEN GAMES. run.html sends the game payload and then, on the
   next line, a {t:"big"} for the wall. Both go down the one channel, so the phone drew its
   answer buttons and this handler replaced the whole of #app between 1 and 17 milliseconds
   later. 26 of those sends exist in run.html.

   Trivia, how well, who here: "Tap if it is you" on the wall, nothing to tap on the phone.
   Heads or tails: unplayable. Charades: the actor never gets the word. Who am I: the
   guesser's phone parks on the ANSWER. Two truths: nobody can vote. And every ending is
   replaced a millisecond after it renders.

   Found 12 Sep 2026 by three people playing the ten games, not by reading anything. */
var BIG = (function () {
  var i = code.indexOf('m.t === "big"');
  return i < 0 ? "" : code.slice(i, i + 1200);
})();
ok("the phone still has a big handler at all", !!BIG);
ok("a bingo BALL still gets through, because that really is for the phone",
   /B && !isNaN\(n\)[\s\S]{0,200}paintBingo\(\); return;/.test(BIG),
   "the ball arrives as a big whose text is just a number, and it must keep working");
ok("but a caption is DROPPED while this phone is holding a game",
   /if\(B \|\| Q \|\| H \|\| T \|\| W \|\| V \|\| PH\) return;/.test(BIG),
   "this single line is what makes nine of the ten games playable");
ok("and every one of the seven game states is named in that guard",
   ["B","Q","H","T","W","V","PH"].every(function (v) {
     return new RegExp("\\b" + v + "\\b").test((BIG.match(/if\([^)]*\) return;/)||[""])[0]);
   }),
   "a state left out is one more game the wall can wipe");
ok("the guard sits BEFORE the line that replaces the screen",
   BIG.indexOf("|| PH) return;") < BIG.indexOf('$("app").innerHTML'),
   "after it, it protects nothing");
ok("a phone with nothing of its own STILL shows the wall's words",
   BIG.indexOf('$("app").innerHTML') > 0,
   "between games the caption is the only thing a guest has to look at");

print("== between games a connected phone does not claim to be connecting ==");
var LOBBY = (function () {
  var i = code.indexOf('m.t === "lobby"');
  return i < 0 ? "" : code.slice(i, i + 420);
})();
ok("the lobby handler clears every game state", /B = null[\s\S]{0,120}PH = null/.test(LOBBY));
ok("and tells the guest they are still in, when they are",
   /waiting\(s\.nickname\|\|"", _ppLive \? "live" : undefined\)/.test(LOBBY),
   'it passed no state, so it fell through to "Getting you in..." on a healthy phone');

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
