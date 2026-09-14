/* THE PARTY HOST'S CHANNEL. If it drops, the party stops and nobody is told.

   PartyPlay's host page sent like this:

       function send(o){ if(ch){ try{ ch.send(...); }catch(e){} } }

   It checked that the channel OBJECT existed, never that it was connected, and it
   swallowed the error. And it subscribed with NO CALLBACK AT ALL, so the page had
   no idea whether it was connected and nothing could ever tell it. A dropped
   channel meant every ball, every word and every question after that vanished in
   silence while the host kept tapping.

   VenuePlay's bingo console had exactly this fault and the note left there says
   what it cost: "the one format that could lose a whole house with nothing to
   replay from." PartyPlay is the same shape: the broadcast IS the game.

   This RUNS the real functions out of run.html against a fake channel and asserts
   what actually reached it.

   Run: jsc partyplay-backend/lib/pp-host-channel.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){
  if (typeof n !== "string") throw new Error("pass(name, condition): name must be a string");
  if (typeof c !== "boolean") throw new Error("pass(name, condition): condition must be a boolean, got " + typeof c + " for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var RUN = find("partyplay/run.html");

/* onChannelStatus now raises and clears the host's not-connected banner, so the banner
   functions have to come across too or the eval below throws on an undefined name. They
   touch the DOM, which jsc has none of, so document is stubbed just enough for them:
   this suite is about the QUEUE, not the markup, and pp-guest-connection.test.js is
   where the banner's own wording and behaviour are checked. */
var names = ["wireOut", "send", "flushQueue", "wireBar", "armWireWatch", "onChannelStatus"];
var srcs = names.map(function (n) { return lift(RUN, n); });
var missing = names.filter(function (n, i) { return !srcs[i]; });
pass("the real functions came out of run.html", missing.length === 0,
     missing.length ? "not found: " + missing.join(", ") : "");
if (missing.length) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }

var capM = /SEND_QUEUE_MAX\s*=\s*(\d+)/.exec(RUN);
pass("the queue has a cap", !!capM, "an unbounded queue is a memory leak on a long outage");
var SEND_QUEUE_MAX = capM ? +capM[1] : 50;

var ch, subscribed, sendQueue, sent, wireBarTimer, connect;
/* Smallest document that lets wireBar run. It records what the host would have been
   shown, so a later check could assert on it without a browser. */
var shownBanner = null;
var document = {
  /* null for "ppWire" so wireBar builds one; a live stub for the retry button it then
     wires up, which is looked up straight after insertBefore. */
  getElementById: function (id) {
    if (id === "ppWireGo") return { addEventListener: function () {} };
    return null;
  },
  createElement: function () {
    return { id: "", innerHTML: "", setAttribute: function () {},
             remove: function () { shownBanner = null; },
             addEventListener: function () {} };
  },
  body: { firstChild: null, insertBefore: function (el) { shownBanner = el; } }
};
function setTimeout() { return 0; }
function clearTimeout() {}
function reset() { sent = []; sendQueue = []; subscribed = false; shownBanner = null;
                   ch = { send: function (m) { sent.push(m.payload); return true; } }; }
eval(srcs.join("\n"));

/* THE ROLL CALL IS PART OF SUBSCRIBING NOW, so it lands in `sent` before anything a game
   sends. That is deliberate: the console asks the room who is already there, because its
   player list is rebuilt from nothing on every connect and a host who RELOADED part way
   through a party used to see "0 playing" in a full house, with the charades start button
   disabled. Counted separately here rather than ignored, so it cannot quietly disappear. */
function games() { return sent.filter(function (m) { return m.t !== "rollcall"; }); }
function rollcalls() { return sent.filter(function (m) { return m.t === "rollcall"; }); }

print("\nWHILE THE PARTY IS CONNECTED");
reset(); onChannelStatus("SUBSCRIBED");
pass("subscribing asks the room who is already here", rollcalls().length === 1,
     "without it the console only ever learns about phones that join AFTER it");
send({ t: "ball", n: 7 });
pass("a ball reaches the room", games().length === 1 && games()[0].n === 7);
pass("and nothing is left waiting", sendQueue.length === 0);

print("\nWHEN THE HOST'S CHANNEL DROPS");
["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].forEach(function (st) {
  reset(); onChannelStatus("SUBSCRIBED"); sent = [];
  onChannelStatus(st);
  send({ t: "ball", n: 12 });
  pass(st + ": the ball is NOT written into a dead channel", sent.length === 0,
       "it went down the channel anyway, which is where a round disappears");
  pass(st + ": the ball is held, not lost", sendQueue.length === 1);
});

print("\nWHEN IT COMES BACK");
reset(); onChannelStatus("SUBSCRIBED"); onChannelStatus("CLOSED");
send({ t: "ball", n: 1 }); send({ t: "word", w: "elephant" }); send({ t: "ball", n: 2 });
pass("three messages are held while it is down", sendQueue.length === 3);
sent = [];
onChannelStatus("SUBSCRIBED");
pass("all three arrive when it reconnects", games().length === 3, "only " + games().length + " arrived");
pass("and the room is asked again, because the player list was rebuilt from nothing",
     rollcalls().length === 1,
     "a reconnect that does not re-ask leaves the host with an empty room");
pass("and IN ORDER, because a ball called after a word must not arrive before it",
     games()[0].n === 1 && games()[1].w === "elephant" && games()[2].n === 2,
     games().map(function (m) { return m.t; }).join(","));
pass("the queue is empty afterwards", sendQueue.length === 0);

print("\nA LONG OUTAGE MUST NOT EAT THE TABLET");
reset(); onChannelStatus("SUBSCRIBED"); onChannelStatus("CLOSED");
for (var i = 0; i < SEND_QUEUE_MAX + 25; i++) send({ t: "ball", n: i });
pass("the queue stops at its cap", sendQueue.length === SEND_QUEUE_MAX,
     "held " + sendQueue.length + ", cap is " + SEND_QUEUE_MAX);
pass("and it keeps the NEWEST, because a party needs the ball on screen now",
     sendQueue[sendQueue.length - 1].n === SEND_QUEUE_MAX + 24,
     "last held is " + sendQueue[sendQueue.length - 1].n);

print("\nWHAT IT MUST IGNORE");
reset(); onChannelStatus("SUBSCRIBED");
onChannelStatus("SOMETHING_SUPABASE_ADDED_LATER");
pass("an unknown status does not knock a healthy party offline", subscribed === true);

print("");
/* ================================================================
   YOU CANNOT WIN HEADS OR TAILS WITHOUT EVER PLAYING IT.

   Not picking keeps you in, deliberately: knocking out the guest who went to the
   bar is how you lose a player for the night. But on 15 Sep 2026, running a real
   party, the winner was a guest who never picked once. They took the prize and
   the points on the night's board off everyone who actually played.

   So: staying in without picking is fine, winning without ever picking is not.
   ================================================================ */
print("\nHEADS OR TAILS: THE WINNER HAS TO HAVE PLAYED");
var HB = RUN;
pass("the console remembers who has ever picked",
     /everPicked\s*:\s*\{\s*\}/.test(HB) && /G\.everPicked\[\s*m\.name\s*\]\s*=\s*true/.test(HB),
     "without it there is no way to tell a quiet player from an absent one");
pass("a sole survivor who never picked is not crowned",
     /if\s*\(\s*w\s*&&\s*!\s*G\.everPicked\[\s*w\s*\]\s*\)\s*w\s*=\s*null/.test(HB),
     "they were declared the winner and given CORRECT_POINTS on the night board");
pass("and not picking still keeps you IN",
     /G\.picks\[n\]\s*&&\s*G\.picks\[n\]\s*!==\s*side/.test(HB),
     "the elimination test must stay conditional on having picked, or the fix breaks the intent");
pass("the room is told nobody was playing rather than shown a blank",
     /Nobody was still playing/.test(HB));

print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("pp host channel: " + bad + " failed");
