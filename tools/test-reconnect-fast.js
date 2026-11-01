/* BACK IN SECONDS WHEN THE SIGNAL RETURNS, ON BOTH ROADS (live flight-mode test, 1 Nov 2026).

   Dean's iPhone, bingo, both roads. Flight mode for ~25 s: the room server came back in 4 s, Supabase
   in 10 to 30 s. Flight mode for a minute: the room took FORTY seconds. The page waited out its
   backoff (and, on the room, a dead socket the browser still called open) instead of trying the
   moment the network was back.

   This RUNS the real code on a virtual clock, so a minute of flight mode costs nothing:
     - venueplay/app/vp-room.js, the room client, against a fake socket and a fake fetch, and
     - venueplay/app/vp-channel.js, the Supabase road's helper, against a fake of the realtime
       library's SOCKET (the part a channel rejoins over): its reconnect timer and its heartbeat, with
       the library's own default timings unless the page hands it options, exactly as supabase-js
       2.118 does (reconnectAfterMs [1, 2, 5, 10 s], a 25 s heartbeat whose timeout is one interval).
   Each drop is played several ways: the phone hears "offline" and "online" (Chrome, Android), it hears
   "offline" and then never "online", or it hears NOTHING (iOS does not always say), with the socket either told it closed or left looking
   open with nothing coming down it (what flight mode does to a socket the browser has not noticed).

   Every time is printed. The target is under 3 s from the signal coming back to the page being on
   its road again, after a 25 s and a 60 s drop. On the room with no events at all, 60 s of silence
   is past a phone's 30 s budget and the page goes to Supabase on purpose (room-fallback.test.js),
   so that one case is not played.

   Run from the repo root:  jsc tools/test-reconnect-fast.js
   Measure another copy:    jsc tools/test-reconnect-fast.js -- <vp-room.js> <vp-channel.js>
                            (prints the times and skips the pass marks: the BEFORE numbers)
*/
var ARGS = (typeof arguments !== "undefined" && arguments) ? arguments : [];
var ROOM_FILE = ARGS[0] || "venueplay/app/vp-room.js";
var CHAN_FILE = ARGS[1] || "venueplay/app/vp-channel.js";
var MEASURE_ONLY = ARGS.length > 0;
var bad = 0, ran = 0, TIMES = [];
function pass(n, c, extra) {
  if (MEASURE_ONLY) return;
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
}
var TARGET_MS = 3000;

/* ---- one virtual clock for both ---- */
var NOW = 1e6, timers = [], nextId = 1;
function resetClock() { NOW = 1e6; timers = []; nextId = 1; }
var realDate = Date;
Date = { now: function () { return NOW; } };
function setTimeout_(fn, ms) { var id = nextId++; timers.push({ id: id, at: NOW + Math.max(0, ms || 0), fn: fn }); return id; }
function clearTimeout_(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
globalThis.setTimeout = setTimeout_; globalThis.clearTimeout = clearTimeout_;
function drain() { if (typeof drainMicrotasks === "function") drainMicrotasks(); }
function tick(ms) {
  var end = NOW + ms;
  for (var g = 0; g < 200000; g++) {
    drain();
    timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
    var t = timers[0];
    if (!t || t.at > end) break;
    NOW = Math.max(NOW, t.at); timers.shift();
    try { t.fn(); } catch (e) { print("  [timer threw] " + e); }
    drain();
  }
  NOW = end; drain();
}
/* Step until cond() holds, 50 ms at a time; the virtual time it took, or -1. */
function until(cond, maxMs) {
  var start = NOW;
  while (NOW - start <= maxMs) { if (cond()) return NOW - start; tick(50); }
  return -1;
}
var listeners = {};
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function fire(ev, arg) { (listeners[ev] || []).forEach(function (f) { try { f(arg || {}); } catch (e) { print("  [listener threw] " + e); } }); }
globalThis.navigator = { onLine: true };
globalThis.document = { visibilityState: "visible", addEventListener: on };
globalThis.window = { addEventListener: on, console: { log: function () {} } };

/* ---- the network ---- */
var NET = { up: true };

/* ======================================================================= ROOM */
var sockets = [];
function FakeWS(url) {
  this.url = url; this.readyState = 0; this.sent = []; this.silent = false;
  sockets.push(this);
  var self = this;
  setTimeout_(function () {
    if (!NET.up) { self.readyState = 3; if (self.onclose) self.onclose({ code: 1006 }); return; }
    self.readyState = 1; if (self.onopen) self.onopen();
  }, 120);
}
FakeWS.prototype.send = function (s) {
  if (this.readyState !== 1) throw new Error("not open");
  this.sent.push(s);
  var self = this;
  if (s === "ping") setTimeout_(function () { if (NET.up && !self.silent && self.readyState === 1 && self.onmessage) self.onmessage({ data: "pong" }); }, 40);
};
FakeWS.prototype.close = function () { var self = this; if (self.readyState === 3) return; self.readyState = 3; setTimeout_(function () { if (self.onclose) self.onclose({ code: 1000 }); }, 5); };

function loadRoom() {
  sockets = []; listeners = {};
  globalThis.WebSocket = FakeWS;
  globalThis.sessionStorage = { getItem: function () { return "1"; }, setItem: function () {} };
  globalThis.location = { search: "?roomserver=1" };
  globalThis.fetch = function (url, init) {
    /* A look sent while the line is down HANGS (a dead route, a radio that has not given up yet) rather than
       failing at once: the client's own five second limit is what ends it, and a wake-up must not wait on it. */
    if (!NET.up) return new Promise(function () {});
    if (init && init.method === "POST") return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true }); } });
    return new Promise(function (res) {
      setTimeout_(function () { res({ status: 200, ok: true, json: function () { return Promise.resolve({ total: 3, host: 1, tv: 1, phone: 1, answers: true, handover: true, pong: true }); } }); }, 150);
    });
  };
  eval(readFile(ROOM_FILE));
  globalThis.window.VPRoom.wanted();
  return globalThis.window.VPRoom;
}

/* events: does the phone hear offline/online?  closes: is the socket told it died? */
function playRoom(dropMs, events, closes) {
  resetClock(); NET.up = true; globalThis.navigator.onLine = true;
  var V = loadRoom(), states = [], gone = [];
  var r = V.connect("https://game.test", "vp-ABC234", "phone", function () {},
    { onUnavailable: function (why) { gone.push(why); }, onState: function (s) { states.push(s); } });
  tick(2000);
  if (r.state() !== "open") return { ms: -2, why: "never opened: " + states.join(">") };
  tick(60000);                                     // a while into the night: a pong has been heard
  var before = sockets.filter(function (s) { return s.readyState === 1; })[0];
  NET.up = false;
  if (events) { globalThis.navigator.onLine = false; fire("offline"); }
  if (closes) { before.readyState = 3; if (before.onclose) before.onclose({ code: 1006 }); }
  else before.silent = true;                       // the browser still calls it open; nothing more arrives
  tick(dropMs);
  NET.up = true;
  if (events) globalThis.navigator.onLine = true;
  if (events === true) fire("online");
  var back = until(function () {
    var cur = sockets.filter(function (s) { return s.readyState === 1 && !s.silent; });
    return r.state() === "open" && cur.length >= 1 && cur[cur.length - 1] !== before;
  }, 120000);
  var open = sockets.filter(function (s) { return s.readyState === 1; });
  return { ms: back, gone: gone.slice(), stillOpen: open.length, cid: /[?&]cid=([0-9a-f]+)/.exec(sockets[sockets.length - 1].url) };
}

/* ======================================================================= SUPABASE */
/* The realtime library's socket, as supabase-js 2.118 behaves: phoenix-style reconnect timer (tries,
   reset() on open, scheduleTimeout() on close / heartbeat timeout), a heartbeat every interval whose
   answer must arrive before the next one or the socket is torn down, channels that rejoin when the
   socket opens. Defaults are the library's own: [1, 2, 5, 10 s] and 25 s. */
function LibTimer(cb, calc) { this.cb = cb; this.calc = calc; this.tries = 0; this.t = null; }
LibTimer.prototype.reset = function () { this.tries = 0; clearTimeout_(this.t); this.t = null; };
LibTimer.prototype.scheduleTimeout = function () {
  var self = this; clearTimeout_(this.t);
  this.t = setTimeout_(function () { self.tries += 1; self.t = null; self.cb(); }, this.calc(this.tries + 1));
};
function makeRealtime(opts) {
  opts = (opts && opts.realtime) || {};
  var hbMs = opts.heartbeatIntervalMs || 25000;
  var calc = opts.reconnectAfterMs || function (n) { return [1000, 2000, 5000, 10000][n - 1] || 10000; };
  var rt = { conn: null, channels: [], pendingHeartbeatRef: null, ref: 0, hbT: null, hbTimeoutT: null, opens: 0 };
  rt.socketAdapter = rt;           // the helper reads pendingHeartbeatRef off the adapter, as on the real client
  rt.connectionState = function () { return rt.conn ? rt.conn.state : "closed"; };
  rt.isConnected = function () { return rt.connectionState() === "open"; };
  rt.reconnectTimer = new LibTimer(function () { teardown(); rt.connect(); }, calc);
  function teardown() { if (rt.conn) { rt.conn.dead = true; rt.conn = null; } clearTimeout_(rt.hbT); clearTimeout_(rt.hbTimeoutT); }
  function chanError() { rt.channels.forEach(function (c) { if (c.state === "joined" || c.state === "joining") { c.state = "errored"; c.cb && c.cb("CHANNEL_ERROR"); } }); }
  function onClose() { chanError(); clearTimeout_(rt.hbT); clearTimeout_(rt.hbTimeoutT); rt.pendingHeartbeatRef = null; rt.reconnectTimer.scheduleTimeout(); }
  rt.connect = function () {
    if (rt.conn) return;
    var c = { state: "connecting", dead: false, silent: false };
    rt.conn = c;
    setTimeout_(function () {
      if (c.dead || rt.conn !== c) return;
      if (!NET.up) { c.state = "closed"; onClose(); return; }
      c.state = "open"; rt.opens++; rt.reconnectTimer.reset(); resetHb();
      rt.channels.forEach(function (ch) { if (ch.state === "errored" || ch.state === "joining") join(ch); });
    }, 200);
  };
  function resetHb() { clearTimeout_(rt.hbT); rt.pendingHeartbeatRef = null; rt.hbT = setTimeout_(function () { rt.sendHeartbeat(); }, hbMs); }
  rt.sendHeartbeat = function () {
    if (!rt.isConnected()) return;
    if (rt.pendingHeartbeatRef) { heartbeatTimeout(); return; }
    var c = rt.conn, ref = String(++rt.ref);
    rt.pendingHeartbeatRef = ref;
    setTimeout_(function () { if (NET.up && !c.silent && !c.dead && rt.pendingHeartbeatRef === ref) { rt.pendingHeartbeatRef = null; resetHb(); } }, 60);
    clearTimeout_(rt.hbTimeoutT);
    rt.hbTimeoutT = setTimeout_(function () { heartbeatTimeout(); }, hbMs);
  };
  function heartbeatTimeout() {
    if (!rt.pendingHeartbeatRef) return;
    rt.pendingHeartbeatRef = null;
    chanError();
    teardown(); rt.reconnectTimer.scheduleTimeout();
  }
  function join(ch) {
    ch.state = "joining";
    setTimeout_(function () {
      if (ch.removed || !rt.isConnected() || rt.conn.silent) return;
      ch.state = "joined"; ch.cb && ch.cb("SUBSCRIBED");
    }, 80);
  }
  rt.dropSocket = function (closes) {
    if (!rt.conn) return;
    if (closes) { rt.conn.state = "closed"; var c = rt.conn; onClose(); c.dead = true; }
    else rt.conn.silent = true;
  };
  rt.channel = function (name) {
    var ch = { name: name, state: "new", cb: null, removed: false,
      on: function () { return ch; },
      subscribe: function (cb) { ch.cb = cb; rt.channels.push(ch); if (!rt.conn) rt.connect(); if (rt.isConnected()) join(ch); else ch.state = "joining"; return ch; },
      send: function () {} };
    return ch;
  };
  rt.removeChannel = function (ch) { ch.removed = true; rt.channels = rt.channels.filter(function (c) { return c !== ch; }); if (ch.cb) ch.cb("CLOSED"); return Promise.resolve("ok"); };
  return rt;
}

function loadChannel() {
  listeners = {};
  var win = { console: { log: function () {} }, document: globalThis.document, navigator: globalThis.navigator, addEventListener: on };
  var f = new Function("window", "setTimeout", "clearTimeout", readFile(CHAN_FILE) + "\nreturn window.VPChannel;");
  return f(win, setTimeout_, clearTimeout_);
}

function playSupabase(dropMs, events, closes) {
  resetClock(); NET.up = true; globalThis.navigator.onLine = true;
  var H = loadChannel();
  var opts = H.phoneOptions ? H.phoneOptions() : undefined;      // what the phone pages hand createClient
  var rt = makeRealtime(opts);
  var client = { realtime: rt, channel: rt.channel, removeChannel: rt.removeChannel };
  var status = [];
  var kept = H.keep(client, "vp-ABC234", {});
  kept.on("broadcast", { event: "msg" }, function () {});
  kept.subscribe(function (s) { status.push(s); });
  tick(2000);
  if (status[status.length - 1] !== "SUBSCRIBED") return { ms: -2, why: status.join(">") };
  tick(60000);
  NET.up = false;
  if (events) { globalThis.navigator.onLine = false; fire("offline"); }
  rt.dropSocket(closes);
  tick(dropMs);
  NET.up = true;
  if (events) globalThis.navigator.onLine = true;
  if (events === true) fire("online");
  var mark = status.length;
  var back = until(function () { return status.length > mark && status[status.length - 1] === "SUBSCRIBED" && rt.isConnected() && !rt.conn.silent; }, 120000);
  return { ms: back, opens: rt.opens };
}

function fmt(ms) { return ms < 0 ? "never (" + ms + ")" : (ms / 1000).toFixed(2) + " s"; }
var CASES = [
  ["25 s drop, phone hears offline/online, socket closed", 25000, true, true],
  ["25 s drop, phone hears offline/online, socket left looking open", 25000, true, false],
  ["25 s drop, no events (iOS), socket closed", 25000, false, true],
  ["25 s drop, no events (iOS), socket left looking open", 25000, false, false],
  ["25 s drop, phone hears offline but never online, socket left looking open", 25000, "off", false],
  ["60 s drop, phone hears offline but never online, socket left looking open", 60000, "off", false],
  ["60 s drop, phone hears offline/online, socket closed", 60000, true, true],
  ["60 s drop, phone hears offline/online, socket left looking open", 60000, true, false],
  ["60 s drop, no events (iOS), socket closed", 60000, false, true],
  ["60 s drop, no events (iOS), socket left looking open", 60000, false, false]
];

print("\nTHE ROOM ROAD (" + ROOM_FILE + ")");
CASES.forEach(function (c) {
  if (c[1] > 30000 && !c[2]) { print("  --   " + c[0] + ": not played (past a phone's 30 s budget with no offline event: it goes to Supabase on purpose)"); return; }
  var r = playRoom(c[1], c[2], c[3]);
  TIMES.push(["room", c[0], r.ms]);
  print("  time " + c[0] + ": back in " + fmt(r.ms) + (r.gone.length ? "  (gave the room up: " + r.gone.join(",") + ")" : ""));
  /* A phone that HEARS the signal come back (an online event, or navigator.onLine turning true after an
     offline) is back at once, inside 1.5 s (navigator.onLine is looked at once a second): it looks the moment it knows, whatever look was in flight. */
  var lim = c[2] ? 1500 : TARGET_MS;
  pass("room, " + c[0] + ": back on the room within " + (lim / 1000) + " s of the signal", r.ms >= 0 && r.ms <= lim && !r.gone.length, fmt(r.ms));
});

print("\nTHE SUPABASE ROAD (" + CHAN_FILE + ")");
CASES.forEach(function (c) {
  var r = playSupabase(c[1], c[2], c[3]);
  TIMES.push(["supabase", c[0], r.ms]);
  print("  time " + c[0] + ": back in " + fmt(r.ms));
  /* THE ONE CASE NOTHING CAN SEE: no event, and a socket the browser still calls open. Only a heartbeat can
     find that, so it is bounded by one heartbeat (15 s) rather than the 3 s target. On a real phone it is
     rarer than it looks, because the first heartbeat sent after the signal returns usually meets a reset
     from the far end and the socket closes at once (the case above it). */
  if (!c[2] && !c[3]) pass("supabase, " + c[0] + ": found by the 15 s heartbeat, not left for good", r.ms >= 0 && r.ms <= 15000, fmt(r.ms));
  else pass("supabase, " + c[0] + ": the channel is joined again within " + (TARGET_MS / 1000) + " s of the signal", r.ms >= 0 && r.ms <= TARGET_MS, fmt(r.ms));
});

if (!MEASURE_ONLY) {
  print("\nONE PAGE, ONE SOCKET");
  var rr = playRoom(25000, true, false);
  pass("every room socket the phone opens carries the same random cid (the room closes the older one)",
       sockets.length >= 2 && sockets.every(function (s) { return /[?&]cid=[0-9a-f]{24}\b/.test(s.url); }) &&
       sockets.every(function (s) { return s.url.split("cid=")[1] === sockets[0].url.split("cid=")[1]; }), sockets.map(function (s) { return s.url; }).join(" "));
  pass("and after the drop exactly one socket is open on this side", rr.stillOpen === 1, String(rr.stillOpen));

  print("\nNOTHING FOR NOTHING");
  /* A tab flicked away and back, or a click on the window, says nothing about the network: no new socket,
     no heartbeat, no rebuild. */
  resetClock(); NET.up = true;
  var H2 = loadChannel(), rt2 = makeRealtime(H2.phoneOptions()), st2 = [];
  var k2 = H2.keep({ realtime: rt2, channel: rt2.channel, removeChannel: rt2.removeChannel }, "vp-ABC234", {});
  k2.subscribe(function (s) { st2.push(s); }); tick(2000);
  var opens0 = rt2.opens, hb0 = rt2.ref;
  globalThis.document.visibilityState = "hidden"; fire("visibilitychange"); tick(3000);
  globalThis.document.visibilityState = "visible"; fire("visibilitychange"); fire("focus"); fire("pageshow", { persisted: false }); tick(5000);
  pass("a quick look away and back costs no new socket and no extra heartbeat", rt2.opens === opens0 && rt2.ref === hb0 && st2.length === 1, [rt2.opens, opens0, rt2.ref, hb0, st2.join()].join(" "));
  /* The quicker socket still backs off: a phone with no signal for a long time does not hammer anyone. */
  var waits = [1, 2, 3, 4, 5, 9].map(function (n) { return H2.socketRetryMs(n); });
  pass("the socket retries at about 0.25 and 1 s, then no faster than every 1.7 s (jittered round 2 s)",
       waits[0] < 400 && waits[1] >= 850 && waits.slice(2).every(function (w) { return w >= 1700 && w <= 2300; }), waits.join(","));
  /* The room: a phone whose page is HIDDEN (locked) does not ping, and a late timer is not a dead socket. */
  resetClock(); NET.up = true; globalThis.navigator.onLine = true; globalThis.document.visibilityState = "visible";
  var V3 = loadRoom(), r3 = V3.connect("https://game.test", "vp-ABC234", "phone", function () {}, {});
  tick(60000);
  var s3 = sockets.filter(function (s) { return s.readyState === 1; })[0], pings = s3.sent.filter(function (x) { return x === "ping"; }).length;
  globalThis.document.visibilityState = "hidden"; fire("visibilitychange");
  tick(120000);
  pass("a locked phone does not ping its socket every ten seconds", s3.sent.filter(function (x) { return x === "ping"; }).length === pings, s3.sent.length + " sent");
  globalThis.document.visibilityState = "visible";
  pass("and its socket is still the same one when it is unlocked", s3.readyState === 1 && sockets.length === 1);
}

if (MEASURE_ONLY) {
  print("\nMEASURED ONLY (another copy of the code): no pass marks.");
} else {
  if (bad) throw new Error(bad + " of " + ran + " failed");
  print("\nALL " + ran + " CHECKS PASSED");
}
