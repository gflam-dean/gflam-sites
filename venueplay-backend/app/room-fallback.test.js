/* THE FALLBACK NOBODY CAN TELL ABOUT.

   The room server is the road every game message takes. The promise made about it
   is that if it goes away, the night carries on down the old road and the pub
   never knows. That promise had a hole: the client re-probed for ever on a 1 to
   30 second backoff, so a room that died mid-question left the page saying
   "Reconnecting" indefinitely with the host's balls piling up in a queue, and
   nothing ever decided to go back to Supabase.

   This runs the REAL vp-room.js against a fake WebSocket, a fake fetch and a
   VIRTUAL CLOCK, so six seconds of pub time costs nothing and the budgets are
   tested as budgets rather than as constants that happen to be written down.

   Run: jsc venueplay-backend/app/room-fallback.test.js
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
var SRC = find("venueplay/app/vp-room.js");

/* ---- the fake world ---------------------------------------------------- */
var NOW, timers, nextId, sockets, fetchPlan, unavailReasons, states, delivered, store;

function installClock() {
  NOW = 1000; timers = []; nextId = 1;
  globalThis.Date = { now: function () { return NOW; } };
  globalThis.setTimeout = function (fn, ms) { var id = nextId++; timers.push({ id: id, at: NOW + (ms || 0), fn: fn }); return id; };
  globalThis.clearTimeout = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
}
// Run every timer due by NOW+ms, in order, letting promises settle between each.
function tick(ms) {
  var end = NOW + ms;
  for (var guard = 0; guard < 10000; guard++) {
    /* SETTLE PROMISES BEFORE LOOKING FOR TIMERS. The probe is a fetch, and the socket is
       not created until its .then runs, so a tick that went straight to the timer list
       found nothing to do and the client looked stuck at "connecting". That was this
       harness, not the client: two checks went red while the rest of the suite proved the
       same client was working perfectly. */
    drainMicrotasks();
    timers.sort(function (a, b) { return a.at - b.at; });
    var next = timers.length ? timers[0] : null;
    if (!next || next.at > end) break;
    NOW = next.at; timers.shift();
    try { next.fn(); } catch (e) {}
    drainMicrotasks();
  }
  NOW = end; drainMicrotasks();
}

function FakeWS(url) {
  this.url = url; this.readyState = 0; this.sent = [];
  sockets.push(this);
  var self = this;
  // A browser opens a socket asynchronously; so does this.
  setTimeout(function () {
    if (FakeWS.hangNext) return;          // neither opens nor fails: it just never answers
    if (self.plannedFail) { self.die(); } else { self.readyState = 1; if (self.onopen) self.onopen(); }
  }, 10);
}
FakeWS.prototype.send = function (s) { if (this.readyState !== 1) throw new Error("not open"); this.sent.push(s); };
FakeWS.prototype.close = function () { this.readyState = 3; };
FakeWS.prototype.die = function () { this.readyState = 3; if (this.onclose) this.onclose(); };

function setup(plan) {
  installClock();
  FakeWS.hangNext = false;
  sockets = []; unavailReasons = []; states = []; delivered = []; store = {};
  fetchPlan = plan;                       // function(url) -> {status} or "throw"
  globalThis.sessionStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
  globalThis.location = { search: "" };
  globalThis.WebSocket = FakeWS;
  globalThis.fetch = function (url) {
    var r = fetchPlan(url);
    if (r === "throw") return Promise.reject(new Error("network"));
    return Promise.resolve({ status: r.status });
  };
  globalThis.window = {};
  eval(SRC);
  return globalThis.window.VPRoom;
}
function connect(VPRoom) {
  return VPRoom.connect("https://api.test", "vp-ABC123", "tv",
    function (p) { delivered.push(p); },
    { onUnavailable: function (why) { unavailReasons.push(why || "?"); },
      onState: function (s) { states.push(s); } });
}

print("\nA HEALTHY ROOM IS LEFT ALONE");
var VPRoom = setup(function () { return { status: 200 }; });
var r = connect(VPRoom);
tick(100);
pass("it opens", r.state() === "open", "states: " + states.join(" -> "));
pass("and it does NOT hand the page to Supabase", unavailReasons.length === 0);
tick(60000);
pass("still open a minute later, with no handover", r.state() === "open" && unavailReasons.length === 0);

print("\nTHE WORKER SAYS THE ROOM IS OFF (ROOM_OFF=1, or no binding)");
VPRoom = setup(function () { return { status: 503 }; });
r = connect(VPRoom);
tick(50);
pass("it goes straight to Supabase", unavailReasons.length === 1 && unavailReasons[0] === "not enabled");
pass("and opens no socket at all", sockets.length === 0);

print("\nIT CANNOT REACH CLOUDFLARE AT ALL (cold: nothing is in flight)");
VPRoom = setup(function () { return "throw"; });
r = connect(VPRoom);
tick(2000);
pass("it does not give up too early: Supabase is not called at 2.0s", unavailReasons.length === 0,
     "a slow first connect is not a broken one");
tick(600);
pass("but it HAS given up by 2.6s, so a screen is never held up", unavailReasons.length === 1,
     unavailReasons.join(",") + " (budget is 2.5s, and a backoff must never sleep past it)");

print("\nTHE ROOM DIES MID-QUESTION (warm: a game is on)");
VPRoom = setup(function () { return { status: 200 }; });
r = connect(VPRoom);
tick(100);
pass("it was open first", r.state() === "open");
var host = sockets[0];
fetchPlan = function () { return "throw"; };      // Cloudflare has gone
host.die();
drainMicrotasks();
tick(4000);
pass("it keeps trying for a few seconds rather than abandoning a live game", unavailReasons.length === 0,
     "4s in, still trying");
tick(2200);
pass("but by 6.2s it has handed the night to Supabase", unavailReasons.length === 1 && unavailReasons[0] === "lost",
     "budget is 6s once it has been open, and a doubling backoff must not overshoot it");

print("\nGIVING UP IS FINAL, OR EVERY BALL IS CALLED TWICE");
var socketsAtHandover = sockets.length;
fetchPlan = function () { return { status: 200 }; };   // Cloudflare comes back
tick(120000);
pass("it never reconnects after handing over", sockets.length === socketsAtHandover,
     "a room that came back would deliver every message down BOTH roads");
pass("and it only ever tells the page once", unavailReasons.length === 1);

print("\nA MESSAGE STILL ARRIVES THE ORDINARY WAY");
VPRoom = setup(function () { return { status: 200 }; });
r = connect(VPRoom); tick(100);
sockets[0].onmessage({ data: JSON.stringify({ t: "ball", n: 42 }) });
pass("a game message reaches the page", delivered.length === 1 && delivered[0].n === 42);
sockets[0].onmessage({ data: "not json" });
pass("junk reaches nobody, and does not break the socket", delivered.length === 1);

print("\nA SOCKET THAT HANGS (a captive portal, or wifi dropping mid handshake)");
VPRoom = setup(function () { return { status: 200 }; });
FakeWS.hangNext = true;
r = connect(VPRoom);
tick(500);
pass("it is still waiting on the handshake, as a browser would be", r.state() === "connecting",
     "state: " + r.state());
tick(5000);
pass("but silence is treated as failure, and the page goes to Supabase",
     unavailReasons.length === 1,
     "it used to sit on \"connecting\" for ever, because every budget is armed by onclose "
     + "or onerror and a hang fires neither");
FakeWS.hangNext = false;

print("\nWHICH ROAD, DECIDED IN ONE PLACE");
VPRoom = setup(function () { return { status: 200 }; });
pass("with no flag it follows the default", VPRoom.wanted() === VPRoom.defaultOn(),
     "DEFAULT_ON is currently " + VPRoom.defaultOn());
globalThis.location.search = "?roomserver=1";
pass("?roomserver=1 turns it on", VPRoom.wanted() === true);
globalThis.location.search = "";
pass("and it STICKS, because opening a console bounces through hq.html and loses the query",
     VPRoom.wanted() === true);
globalThis.location.search = "?roomserver=0";
pass("?roomserver=0 turns it off again", VPRoom.wanted() === false);
globalThis.location.search = "";
pass("and that sticks too", VPRoom.wanted() === false);
globalThis.sessionStorage = { getItem: function () { throw new Error("blocked"); }, setItem: function () { throw new Error("blocked"); } };
pass("a browser with storage blocked does not throw, it just goes the old way", VPRoom.wanted() === false);

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("room fallback: " + bad + " failed");
