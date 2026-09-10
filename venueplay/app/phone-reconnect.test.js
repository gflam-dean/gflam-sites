/* A PHONE THAT LOST ITS CHANNEL MUST STOP TALKING INTO IT.

   The host console had this bug and it was fixed there, with a comment saying
   exactly what it cost: "subscribed was never reset here. It said Reconnecting on
   screen and then kept calling ch.send() into a dead socket." The PHONE was never
   given the same line, and it was worse off, because it did not handle CLOSED at
   all: Supabase reports CHANNEL_ERROR, TIMED_OUT and CLOSED, and the phone listed
   the first two.

   What that costs in a pub: forty people on one flaky access point, and the ones
   whose channel closed keep tapping answers into nothing while their phone says
   Connected. They do not know. The host does not know. The scores are simply
   wrong and nobody can explain why.

   This RUNS the real handler, lifted out of play.html, against a fake channel
   that records what was actually sent. It exists because the handler used to be
   an anonymous callback inside ch.subscribe, which no test in this repo could
   reach; it is a named function now for that reason.

   Run: jsc venueplay/app/phone-reconnect.test.js
*/
var bad = 0, ran = 0;
/* pass(name, condition). The arguments went in the other way round while this suite was
   being written, so every condition was a non-empty STRING, every check was truthy, and
   all 22 passed while testing nothing at all. It throws now rather than let that happen
   again: a boolean where the name goes is always the mistake, never the intent. */
function pass(n, c, extra){
  if (typeof n !== "string") throw new Error("pass(name, condition): the name must be a string, got " + typeof n);
  if (typeof c !== "boolean") throw new Error("pass(name, condition): the condition must be a boolean, got " + typeof c + " for " + n);
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
var PLAY = find("venueplay/play.html");

var srcs = ["onChannelStatus", "send", "flushQueue", "wireOut", "setConn"].map(function (n) {
  return [n, lift(PLAY, n)];
});
var missing = srcs.filter(function (p) { return !p[1]; }).map(function (p) { return p[0]; });
pass("the real functions came out of play.html", missing.length === 0,
     missing.length ? "not found: " + missing.join(", ") + " (renamed? then this suite tests nothing)" : "");
if (missing.length) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }

/* The fake world. `sent` is what actually reached the channel. */
var ch, subscribed, sendQueue, sent, conn, _room, P;
function $(){ return { classList: { add: function(){}, remove: function(){} }, textContent: "" }; }
function reset(joined) {
  sent = []; sendQueue = []; subscribed = false; conn = null; _room = null;
  P = { joined: !!joined, pid: "p1", name: "Sam", numCards: 2 };
  ch = { send: function (m) { sent.push(m); return true; } };
}
/* ONE eval, AT THE TOP LEVEL. Doing it inside a forEach defines each function in the
   callback's scope and nothing can see them afterwards, which reads as "the page is
   missing onChannelStatus" rather than "this harness put it somewhere silly". */
eval(srcs.map(function (p) { return p[1]; }).join("\n"));
// setConn is lifted but touches the DOM; keep the real one and record through $().
setConn = function (state) { conn = state; };

print("\nWHILE THE CHANNEL IS UP");
reset(true);
onChannelStatus("SUBSCRIBED");
pass("a subscribed phone is marked connected", subscribed === true);
pass("a joined phone waits for the host", conn === "waiting", "conn was " + conn);
pass("and it re-announces so the host re-deals its ticket",
     sent.length === 1 && sent[0].payload.t === "join", "sent " + sent.length + " message(s)");

reset(false);
onChannelStatus("SUBSCRIBED");
pass("a phone that has not joined just says it is ready", conn === "ready" && sent.length === 0);

print("\nWHEN THE CHANNEL GOES AWAY");
["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].forEach(function (status) {
  reset(true);
  onChannelStatus("SUBSCRIBED");
  sent = [];
  onChannelStatus(status);
  pass(status + ": the phone stops believing it is connected", subscribed === false,
       "it kept subscribed=true, so send() writes into a dead channel");
  pass(status + ": and it says so on screen", conn === "reconnecting", "conn was " + conn);

  send({ t: "ans", i: 2 });
  pass(status + ": an answer is NOT written into the dead channel", sent.length === 0,
       "it went down the channel anyway, which is where answers disappear");
  pass(status + ": the answer is kept, not thrown away", sendQueue.length === 1,
       "queue holds " + sendQueue.length);
});

print("\nAND IT COMES BACK");
reset(true);
onChannelStatus("SUBSCRIBED");
onChannelStatus("CLOSED");
send({ t: "ans", i: 2 });
send({ t: "ans", i: 4 });
pass("two taps while it was down are both held", sendQueue.length === 2);
sent = [];
onChannelStatus("SUBSCRIBED");
pass("reconnecting marks it connected again", subscribed === true);
pass("and the backlog is flushed, not stranded", sendQueue.length === 0, sendQueue.length + " left in the queue");
pass("both answers reach the channel once it is back",
     sent.filter(function (m) { return m.payload.t === "ans"; }).length === 2,
     "only " + sent.filter(function (m) { return m.payload.t === "ans"; }).length + " arrived");

print("\nWHAT IT MUST IGNORE");
reset(true);
onChannelStatus("SUBSCRIBED");
onChannelStatus("SOMETHING_NEW_SUPABASE_ADDED");
pass("an unknown status does not knock a healthy phone offline", subscribed === true,
     "a status nobody has heard of must not be read as a failure");

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("phone reconnect: " + bad + " failed");
