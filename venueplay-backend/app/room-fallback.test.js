/* THE FALLBACK NOBODY CAN TELL ABOUT.

   The room server is the road every game message takes. The promise made about it
   is that if it goes away, the night carries on down the old road and the pub
   never knows. That promise had a hole: the client re-probed for ever on a 1 to
   30 second backoff, so a room that died mid-question left the page saying
   "Reconnecting" indefinitely with the host's balls piling up in a queue, and
   nothing ever decided to go back to Supabase.

   31 Oct 2026, the room becomes the DEFAULT, and a second promise is added: ONE ROAD
   PER VENUE. A page that leaves the room on its own hands the room over, so everybody
   else follows; a page told "handed over" (by word or by close code 4503) goes at once
   and tells nobody; a frozen window is not a failed room; a dead socket is found by the
   heartbeat; a new page meeting an old Worker stays on Supabase; and what was queued
   when the room went is handed back to the page, not thrown away.

   This runs the REAL vp-room.js against a fake WebSocket, a fake fetch and a
   VIRTUAL CLOCK, so minutes of pub time cost nothing and the budgets are
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
var postAuth = [];
var NOW, timers, nextId, sockets, fetchPlan, unavailReasons, pendings, states, delivered, store, posts, listeners, serverPongs;

function installClock() {
  NOW = 1000; timers = []; nextId = 1;
  globalThis.Date = { now: function () { return NOW; } };
  globalThis.setTimeout = function (fn, ms) { var id = nextId++; timers.push({ id: id, at: NOW + (ms || 0), fn: fn }); return id; };
  globalThis.clearTimeout = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
}
// Run every timer due by NOW+ms, in order, letting promises settle between each.
function tick(ms) {
  var end = NOW + ms;
  for (var guard = 0; guard < 20000; guard++) {
    /* SETTLE PROMISES BEFORE LOOKING FOR TIMERS. The probe is a fetch, and the socket is
       not created until its .then runs. */
    drainMicrotasks();
    timers.sort(function (a, b) { return a.at - b.at; });
    var next = timers.length ? timers[0] : null;
    if (!next || next.at > end) break;
    NOW = Math.max(NOW, next.at); timers.shift();
    try { next.fn(); } catch (e) { print("  [timer threw] " + e); }
    drainMicrotasks();
  }
  NOW = end; drainMicrotasks();
}
/* A FROZEN PAGE: the clock moves, no timer runs. That is a covered Chrome window or a locked
   phone. When it thaws, every overdue timer runs at once, late. */
function freeze(ms) { NOW += ms; }

function FakeWS(url) {
  this.url = url; this.readyState = 0; this.sent = [];
  sockets.push(this);
  var self = this;
  setTimeout(function () {
    if (FakeWS.hangNext) return;          // neither opens nor fails: it just never answers
    if (FakeWS.failNext) { self.die(1006); return; }
    self.readyState = 1; if (self.onopen) self.onopen();
  }, 10);
}
FakeWS.prototype.send = function (s) {
  if (this.readyState !== 1) throw new Error("not open");
  this.sent.push(s);
  var self = this;
  if (s === "ping" && serverPongs) setTimeout(function () { if (self.readyState === 1 && self.onmessage) self.onmessage({ data: "pong" }); }, 30);
};
FakeWS.prototype.close = function () { this.readyState = 3; var self = this; setTimeout(function () { if (self.onclose) self.onclose({ code: 1000 }); }, 5); };
FakeWS.prototype.die = function (code) { this.readyState = 3; if (this.onclose) this.onclose({ code: code || 1006 }); };
function openSockets() { return sockets.filter(function (s) { return s.readyState === 1; }); }

var PRESENCE_NEW = { total: 0, answers: true, handover: true, pong: true };
var PRESENCE_OLD = { total: 0, answers: true };
function ok200(body) { return { status: 200, body: body || PRESENCE_NEW }; }

function setup(plan, opts) {
  opts = opts || {};
  installClock();
  FakeWS.hangNext = false; FakeWS.failNext = false;
  postAuth = [];
  sockets = []; unavailReasons = []; pendings = []; states = []; delivered = []; store = {}; posts = []; listeners = {};
  serverPongs = true;
  fetchPlan = plan;                       // function(url) -> {status, body} or "throw"
  globalThis.sessionStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
  globalThis.location = { search: opts.search || "" };
  globalThis.WebSocket = FakeWS;
  globalThis.fetch = function (url, init) {
    if (init && init.method === "POST") {
      posts.push(url);
      postAuth.push((init.headers && init.headers.Authorization) || "");
      var pr = opts.postPlan ? opts.postPlan(url) : { status: 200, body: { ok: true } };
      if (pr === "throw") return Promise.reject(new Error("network"));
      return Promise.resolve({ status: pr.status, json: function () { return Promise.resolve(pr.body); } });
    }
    var r = fetchPlan(url);
    if (r === "throw") return Promise.reject(new Error("network"));
    if (r === "hang") return new Promise(function () {});
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300,
      json: function () { return r.html ? Promise.reject(new Error("not json")) : Promise.resolve(r.body); } });
  };
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  globalThis.document = { visibilityState: "visible", addEventListener: on };
  globalThis.window = { addEventListener: on };
  var src = SRC;
  if (opts.defaultOn) src = src.replace("var DEFAULT_ON = false;", "var DEFAULT_ON = true;");
  eval(src);
  var V = globalThis.window.VPRoom;
  V.wanted();                             // every page asks first; it records how it decided
  return V;
}
function fire(ev) { (listeners[ev] || []).forEach(function (f) { try { f(); } catch (e) {} }); }
function connect(V, role, name) {
  return V.connect("https://api.test", name || "vp-ABC123", role || "tv",
    function (p) { delivered.push(p); },
    { onUnavailable: function (why, pending) { unavailReasons.push(why || "?"); pendings.push(pending || []); },
      onState: function (s) { states.push(s); } });
}
function handovers() { return posts.filter(function (u) { return /\/room\/handover\?room=/.test(u); }).length; }

/* ======================================================================== */
print("\nA HEALTHY ROOM IS LEFT ALONE");
var V = setup(function () { return ok200(); });
var r = connect(V);
tick(100);
pass("it opens", r.state() === "open", "states: " + states.join(" -> "));
pass("and it does NOT hand the page to Supabase", unavailReasons.length === 0);
tick(5 * 60000);
pass("still open five minutes later, through the heartbeats, with no handover",
     r.state() === "open" && unavailReasons.length === 0 && sockets.length === 1 && handovers() === 0,
     "sockets " + sockets.length + ", pings " + sockets[0].sent.filter(function (s) { return s === "ping"; }).length);
pass("the heartbeat really did run (or that line proves nothing)",
     sockets[0].sent.filter(function (s) { return s === "ping"; }).length >= 10);

print("\nTHE WORKER SAYS THE ROOM IS OFF (ROOM_OFF=1, or no binding)");
V = setup(function () { return { status: 503, body: { error: "room server not enabled" } }; });
r = connect(V, "tv");
tick(50);
pass("it goes straight to Supabase", unavailReasons.length === 1 && unavailReasons[0] === "not enabled");
pass("and opens no socket at all", sockets.length === 0);
pass("a TV told \"off\" has nothing to tell the room", handovers() === 0);
V = setup(function () { return { status: 503, body: { error: "room server not enabled" } }; });
connect(V, "host"); tick(50);
pass("a CONSOLE told \"off\" marks its venue's room, so clearing the switch mid-night does not split it",
     unavailReasons[0] === "not enabled" && handovers() === 1);

print("\nTHE ROOM HAS BEEN HANDED OVER ALREADY (a late phone, a reload)");
V = setup(function () { return { status: 503, body: { error: "room handed over", handed_over: true } }; });
r = connect(V, "phone"); tick(50);
pass("a late phone goes to Supabase, where everyone else already is", unavailReasons[0] === "handed over" && sockets.length === 0);
pass("and does not ask for a handover that already happened", handovers() === 0);

print("\nIT CANNOT REACH CLOUDFLARE AT ALL (cold: nothing is in flight)");
V = setup(function () { return "throw"; });
r = connect(V, "tv");
tick(7000);
pass("it does not give up too early: Supabase is not called at 7s", unavailReasons.length === 0,
     "a slow first connect on pub wifi is not a broken one, and leaving now would move the venue");
tick(1600);
pass("but it HAS given up by 8.6s", unavailReasons.length === 1 && unavailReasons[0] === "no answer",
     unavailReasons.join(",") + " (budget is 8s, and a backoff must never sleep past it)");
pass("and it HANDS THE ROOM OVER, so the console and phones in it come to Supabase too", handovers() >= 1);

print("\nA PRESENCE CHECK THAT NEVER ANSWERS (a dead route, a stuck proxy)");
V = setup(function () { return "hang"; });
r = connect(V, "tv");
tick(12000);
pass("a hung probe is a failed probe, and the budget still decides", unavailReasons.length === 1,
     "states: " + states.slice(-3).join(" -> "));

var slowOff = [];
V = setup(function () { return "slow503"; });
globalThis.fetch = (function (orig) { return function (url, init) {
  if (!(init && init.method === "POST") && fetchPlan(url) === "slow503") {
    return new Promise(function (res) { setTimeout(function () { res({ status: 503, json: function () { return Promise.resolve({ error: "room server not enabled" }); } }); }, 6000); });
  }
  return orig(url, init); }; })(globalThis.fetch);
r = connect(V, "phone"); tick(6100);
pass("an \"off\" that arrives after the look timed out is still believed, at once, not after the whole budget",
     unavailReasons.length === 1 && unavailReasons[0] === "not enabled" && NOW < 1000 + 8000, unavailReasons.join(",") + " at " + (NOW - 1000) + "ms");

print("\nTHE ROOM DIES MID-QUESTION (warm: a game is on)");
V = setup(function () { return ok200(); });
r = connect(V, "host");
tick(100);
pass("it was open first", r.state() === "open");
fetchPlan = function () { return "throw"; };      // Cloudflare has gone
sockets[0].die(1006);
r.send({ t: "ball", n: 7 }); r.send({ t: "ball", n: 8 }); r.send({ t: "ball", n: 9 });
tick(4000);
pass("it keeps trying for a few seconds rather than abandoning a live game", unavailReasons.length === 0,
     "4s in, still trying");
tick(2200);
pass("but by 6.2s it has handed the night to Supabase", unavailReasons.length === 1 && unavailReasons[0] === "lost",
     "budget is 6s once it has been open, and a doubling backoff must not overshoot it");
pass("the three balls called while it was down are handed back to the page, in order",
     pendings[0].length === 3 && pendings[0][0].n === 7 && pendings[0][2].n === 9, JSON.stringify(pendings[0]));
pass("and the room is told, so the TV and phones still in it follow", handovers() >= 1);

print("\nGIVING UP IS FINAL, OR EVERY BALL IS CALLED TWICE");
var socketsAtHandover = sockets.length;
fetchPlan = function () { return ok200(); };   // Cloudflare comes back
tick(120000);
pass("it never reconnects after handing over", sockets.length === socketsAtHandover,
     "a room that came back would deliver every message down BOTH roads");
pass("and it only ever tells the page once", unavailReasons.length === 1);

print("\nTHE TELL IS RETRIED UNTIL THE WORKER HEARS IT");
V = setup(function () { return "throw"; }, { postPlan: function () { return "throw"; } });
r = connect(V, "tv"); tick(9000);
var tries1 = handovers();
tick(10 * 60000);
pass("a page that cannot reach us keeps asking for a while (it is the one on the bad network)", handovers() > tries1 && handovers() <= 6,
     handovers() + " tries");

print("\nA PHONE LOSES SIGNAL FOR TEN SECONDS (walking to the bar)");
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(100);
fetchPlan = function () { return "throw"; };
sockets[0].die(1006);
tick(10000);
fetchPlan = function () { return ok200(); };
tick(6000);
pass("it comes back INTO THE ROOM, rather than moving the whole venue to Supabase",
     r.state() === "open" && unavailReasons.length === 0 && handovers() === 0,
     "state " + r.state() + ", reasons " + unavailReasons.join(","));

/* 4 Nov 2026: a look that gets NO answer is the phone's own line and is not spent from the budget (job
   list row 60), so the budget above is now proven by a room that ANSWERS, badly, for ten seconds. */
print("\nA PHONE WHOSE ROOM ANSWERS BADLY FOR TEN SECONDS (a Worker hiccup mid-game)");
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(100);
fetchPlan = function () { return { status: 500, body: { error: "room unwell" } }; };
sockets[0].die(1006);
tick(10000);
fetchPlan = function () { return ok200(); };
tick(6000);
pass("it rides out ten seconds of a room that answers badly and comes back INTO THE ROOM",
     r.state() === "open" && unavailReasons.length === 0 && handovers() === 0,
     "state " + r.state() + ", reasons " + unavailReasons.join(","));
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(100);
fetchPlan = function () { return { status: 500, body: { error: "room unwell" } }; };
sockets[0].die(1006);
tick(40000);
pass("but a room that answers badly for longer than the phone's budget is given up, and the room told",
     unavailReasons.length === 1 && unavailReasons[0] === "lost" && handovers() >= 1, unavailReasons.join(",") + " / " + handovers());
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(100);
fetchPlan = function () { return "throw"; };
sockets[0].die(1006);
tick(100000);
pass("a phone that gets NO answer at all for 100 s (its own line) keeps its room", unavailReasons.length === 0 && handovers() === 0, unavailReasons.join(","));
tick(60000);
pass("and past two minutes of no answer it goes to Supabase all the same (the Worker itself may be down)", unavailReasons.length === 1, unavailReasons.join(","));

print("\nROOM_OFF IS SET MID-GAME: THE ROOM SENDS EVERYONE ACROSS");
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(100);
r.send({ t: "claim", n: 1 });
sockets[0].die(4503);
tick(50);
pass("close code 4503 sends the page to Supabase AT ONCE, with no retries", unavailReasons[0] === "handed over" && sockets.length === 1);
pass("and it tells nobody: the room already knows", handovers() === 0);
V = setup(function () { return ok200(); });
r = connect(V, "tv"); tick(100);
sockets[0].onmessage({ data: JSON.stringify({ t: "room_handover" }) });
tick(50);
pass("the room saying so in words does the same, for a close code that got lost", unavailReasons[0] === "handed over" && delivered.length === 0);

print("\nA COVERED TV WINDOW (Chrome freezes its timers) IS NOT A FAILED ROOM");
V = setup(function () { return ok200(); });
r = connect(V, "tv"); tick(100);
fetchPlan = function () { return "throw"; };
sockets[0].die(1006);                 // the venue router blinks while the window is covered
freeze(90000);                        // ninety seconds frozen
tick(1500);                           // it thaws; the first look fails, the network is still coming up
fetchPlan = function () { return ok200(); };
tick(3000);
pass("after the thaw it reconnects to the room, instead of spending the frozen minute as failure",
     r.state() === "open" && unavailReasons.length === 0 && handovers() === 0,
     "state " + r.state() + ", reasons " + unavailReasons.join(","));
V = setup(function () { return "throw"; });
r = connect(V, "tv"); tick(100);
freeze(200000);
document.visibilityState = "visible";
fetchPlan = function () { return ok200(); };
fire("visibilitychange");
tick(200);
pass("and the window coming into view looks at once, with a fresh budget", r.state() === "open" && unavailReasons.length === 0,
     "state " + r.state());

print("\nA SOCKET THAT IS OPEN BUT DEAD (a router cut it between games)");
V = setup(function () { return ok200(); });
r = connect(V, "tv"); tick(30000);
pass("the room has answered a ping", sockets[0].sent.indexOf("ping") >= 0);
serverPongs = false;                 // half open: nothing comes back, nothing says closed
tick(3 * 25000 + 1000);
pass("two pings with no answer and it hangs up and reconnects", sockets.length === 2 && r.state() === "open",
     sockets.length + " sockets, state " + r.state());
pass("without leaving the room for Supabase", unavailReasons.length === 0);
/* An OLDER Worker never answered a ping, and its presence never said pong: true either (4 Nov 2026: a
   Worker that says pong: true is judged from the first heartbeat, so the fixture says what an old one says). */
V = setup(function () { return ok200({ total: 0, answers: true, handover: true }); });
serverPongs = false;                 // an OLDER Worker: it has never answered a ping
r = connect(V, "tv"); tick(10 * 60000);
pass("a Worker that never answers pings is not hung up on every minute", sockets.length === 1 && r.state() === "open");

print("\nBACK IN VIEW AFTER HALF A MINUTE: IS THE SOCKET STILL THERE?");
V = setup(function () { return ok200(); });
r = connect(V, "phone"); tick(30000);                // a pong has been heard
document.visibilityState = "hidden"; fire("visibilitychange");
serverPongs = false;                                 // it died while the phone was in a pocket
tick(31000);
document.visibilityState = "visible"; fire("visibilitychange");
tick(4500);
pass("a socket that does not answer a ping within four seconds of the phone coming back is replaced",
     sockets.length === 2 && r.state() === "open", sockets.length + " sockets");

print("\nFLIGHT MODE: NO NETWORK IS NOT A BROKEN ROOM");
V = setup(function () { return ok200(); });
globalThis.navigator = { onLine: true };
r = connect(V, "tv"); tick(100);
globalThis.navigator.onLine = false;
fetchPlan = function () { return "throw"; };
sockets[0].die(1006);
tick(60000);
pass("a full minute with no network and even a TV has not given the room up", unavailReasons.length === 0 && handovers() === 0,
     unavailReasons.join(","));
globalThis.navigator.onLine = true;
fetchPlan = function () { return ok200(); };
fire("online"); tick(200);
pass("and the moment the network is back it is in the room again", r.state() === "open");
V = setup(function () { return ok200(); });
globalThis.navigator = { onLine: true };
r = connect(V, "phone"); tick(100);
var firstSock = sockets[0];
globalThis.navigator.onLine = false; firstSock.readyState = 1;   // the browser still calls it open
globalThis.navigator.onLine = true; fire("online"); tick(200);
pass("a socket that lived through no network is replaced the moment it comes back", sockets.length === 2 && sockets[1].readyState === 1 && firstSock.readyState === 3);
V = setup(function () { return "throw"; }, { postPlan: function () { return "throw"; } });
globalThis.navigator = { onLine: true };
r = connect(V, "tv"); tick(9000);
var before = handovers();
fire("online"); tick(10);
pass("a handover that could not be told is told the moment the network is back, not at the next retry", handovers() === before + 1, before + " -> " + handovers());
delete globalThis.navigator;

print("\nA SOCKET THAT HANGS (a captive portal, or wifi dropping mid handshake)");
V = setup(function () { return ok200(); });
FakeWS.hangNext = true;
r = connect(V, "tv");
tick(500);
pass("it is still waiting on the handshake, as a browser would be", r.state() === "connecting", "state: " + r.state());
tick(12000);
pass("but silence is treated as failure, and the page goes to Supabase", unavailReasons.length === 1,
     "it used to sit on \"connecting\" for ever, because every budget is armed by onclose or onerror and a hang fires neither");
FakeWS.hangNext = false;
V = setup(function () { return { status: 200, html: true }; });
r = connect(V, "phone"); tick(500);
pass("a captive portal's own 200 page is not taken for the room", sockets.length === 0 && r.state() !== "open");
tick(9000);
pass("and the portal is a failed look, so the budget still ends it on Supabase rather than stuck",
     unavailReasons.length === 1 && unavailReasons[0] === "no answer", unavailReasons.join(","));

print("\nMIXED VERSIONS: THE ROOM BY DEFAULT ONLY WHERE THE WORKER CAN HAND IT OVER");
V = setup(function () { return ok200(PRESENCE_OLD); }, { defaultOn: true });
pass("with DEFAULT_ON and no flag, the page wants the room", V.wanted() === true && V.byDefault() === true);
r = connect(V, "tv"); tick(100);
pass("an OLD Worker (no handover) keeps a new page on Supabase, where an old console is",
     unavailReasons[0] === "worker too old" && sockets.length === 0 && handovers() === 0);
V = setup(function () { return ok200(PRESENCE_NEW); }, { defaultOn: true });
r = connect(V, "tv"); tick(100);
pass("the new Worker: into the room", r.state() === "open");
V = setup(function () { return ok200(PRESENCE_OLD); }, { search: "?roomserver=1" });
r = connect(V, "tv"); tick(100);
pass("?roomserver=1 is a person choosing the room, and it still works against the old Worker", r.state() === "open");

print("\nAN ANSWERS ROOM IS NOT A VENUE: IT MOVES NOBODY");
V = setup(function () { return "throw"; });
r = connect(V, "phone", "vpa-11111111-1111-4111-8111-111111111111");
tick(2000);
pass("not given up at 2.0s", unavailReasons.length === 0);
tick(700);
pass("given up by 2.7s: the HTTP road is right there", unavailReasons.length === 1);
pass("and an answers room is never handed over", handovers() === 0);

print("\nWHICH ROAD, DECIDED IN ONE PLACE");
V = setup(function () { return ok200(); });
pass("with no flag it follows the default", V.wanted() === V.defaultOn(), "DEFAULT_ON is currently " + V.defaultOn());
globalThis.location.search = "?roomserver=1";
pass("?roomserver=1 turns it on", V.wanted() === true && V.byDefault() === false);
globalThis.location.search = "";
pass("and it STICKS, because opening a console bounces through hq.html and loses the query", V.wanted() === true);
globalThis.location.search = "?roomserver=0";
pass("?roomserver=0 turns it off again", V.wanted() === false);
globalThis.location.search = "";
pass("and that sticks too", V.wanted() === false);
globalThis.sessionStorage = { getItem: function () { throw new Error("blocked"); }, setItem: function () { throw new Error("blocked"); } };
pass("a browser with storage blocked does not throw, and follows the default", V.wanted() === V.defaultOn());

print("\nWHO IS ON THE OLD ROAD");
V = setup(function () { return ok200(); });
var P = V.oldRoadPeer;
pass("a bingo TV saying tv_here on Supabase is a peer", P({ t: "tv_here" }) === true);
pass("a bingo console saying host_here on Supabase is a peer", P({ t: "host_here", _sig: "x" }) === true);
pass("a page in the room saying host_here there (rw) is NOT", P({ t: "host_here", rw: 1 }) === false);
pass("a musical or trivia console on the same channel name is NOT", P({ t: "host_here", fmt: "musical" }) === false && P({ t: "state", fmt: "trivia" }) === false);
pass("a bingo phone's signed join is a peer", P({ t: "join", pid: "k1_abc", pk: "x", sig: "y" }) === true);
pass("a musical or trivia phone's unsigned join is NOT", P({ t: "join", pid: "abc" }) === false);
pass("Venue settings' screen_refresh is NOT", P({ t: "screen_refresh" }) === false);

print("\nTHE EAR: LISTENS ON THE OLD ROAD, HEARS A PEER ONCE, LETS GO PROPERLY");
V = setup(function () { return ok200(); });
var chans = [], heardPeers = [];
var fakeClient = {
  channel: function (name) {
    var c = { name: name, sent: [], h: null, s: null, gone: false,
      on: function (a, b, fn) { this.h = fn; return this; },
      subscribe: function (fn) { this.s = fn; var me = this; setTimeout(function () { fn("SUBSCRIBED"); }, 5); return this; },
      send: function (m) { this.sent.push(m); } };
    chans.push(c); return c;
  },
  removeChannel: function (c) { setTimeout(function () { c.gone = true; }, 400); return Promise.resolve("ok"); },
  getChannels: function () { return chans.filter(function (c) { return !c.gone; }); }
};
var ear = V.watch(fakeClient, "vp-ABC123", {
  gate: function (p, cb) { if (p && p.forged) return; cb(p); },
  onPeer: function (m) { heardPeers.push(m.t); },
  hello: function (say) { say({ t: "host_here", rw: 1 }); }
});
tick(50);
pass("it says the console's hello on the old road, stamped rw", chans[0].sent.length === 1 && chans[0].sent[0].payload.rw === 1);
chans[0].h({ payload: { t: "host_here", rw: 1 } });
chans[0].h({ payload: { t: "host_here", forged: true } });
chans[0].h({ payload: { t: "host_here", fmt: "trivia" } });
pass("another page's ear, a forged message and another game's console are all ignored", heardPeers.length === 0);
chans[0].h({ payload: { t: "tv_here" } });
chans[0].h({ payload: { t: "tv_here" } });
pass("an old TV answering is heard, once", heardPeers.length === 1 && ear.heard() === true);
var released = false;
ear.release().then(function () { released = true; });
tick(200);
pass("letting go waits while the library still holds the channel", released === false);
tick(500);
pass("and is done once it has really gone, so the page's own channel can take the name", released === true);

print("\nA HANDOVER IS SIGNED WHEN THE PAGE IS (6 Nov 2026, security review B1, finding F2)");
/* The Worker hands a venue over only for a console signed in as staff there. The real caller is the
   console: it has a Supabase session (VP.getClient, the one every apiPost sends), and it must still
   be able to move its venue. A TV or a phone has none, sends none, and is only an ask. */
function signedIn(tok) {
  globalThis.window.VP = { getClient: function () { return { auth: { getSession: function () {
    return Promise.resolve({ data: { session: tok ? { access_token: tok } : null } }); } } }; } };
}
V = setup(function () { return { status: 503, body: { error: "room server not enabled" } }; });
signedIn("jwt-console");
connect(V, "host"); tick(50);
pass("the real caller, a signed in console, sends its sign in with the handover",
     handovers() === 1 && postAuth[0] === "Bearer jwt-console", JSON.stringify(postAuth));
V = setup(function () { return "throw"; });
signedIn(null);
connect(V, "tv"); tick(9000);
pass("a TV with no session sends no Authorization at all", handovers() >= 1 && postAuth.every(function (a) { return a === ""; }), JSON.stringify(postAuth));
V = setup(function () { return "throw"; });
connect(V, "tv"); tick(9000);
pass("and a page without VP at all still posts, unsigned, as before", handovers() >= 1 && postAuth[0] === "");
V = setup(function () { return "throw"; }, { postPlan: function () { return { status: 401, body: { error: "sign in first", asked: 1 } }; } });
connect(V, "tv"); tick(9000);
var n401 = handovers();
tick(10 * 60000);
pass("a 401 is an answer, not a failure: the TV does not keep asking", n401 === 1 && handovers() === 1, n401 + " then " + handovers());

print("\nAN ASK REACHES THE CONSOLE, AND NOBODY ELSE ACTS ON IT");
var asks = 0;
V = setup(function () { return ok200(); });
var hostR = V.connect("https://api.test", "vp-ABC123", "host", function (p) { delivered.push(p); },
  { onAsk: function () { asks++; }, onUnavailable: function (why) { unavailReasons.push(why); } });
tick(100);
sockets[0].onmessage({ data: JSON.stringify({ t: "room_ask" }) });
pass("a console is told (onAsk) and the ask is not handed to the page as a game message", asks === 1 && delivered.length === 0);
pass("and the console stays in the room: an ask moves nothing by itself", hostR.state() === "open" && unavailReasons.length === 0);
var phoneAsks = 0;
V = setup(function () { return ok200(); });
var phR = V.connect("https://api.test", "vp-ABC123", "phone", function (p) { delivered.push(p); }, { onAsk: function () { phoneAsks++; } });
tick(100);
sockets[0].onmessage({ data: JSON.stringify({ t: "room_ask" }) });
pass("a phone that somehow hears room_ask does nothing with it", phoneAsks === 0 && delivered.length === 0 && phR.state() === "open");

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("room fallback: " + bad + " failed");
