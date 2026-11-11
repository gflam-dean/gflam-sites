/* ONE PHONE, ONE PLAYER AND ONE NAME A NIGHT, ON THE CONSOLE AND THE PHONE.

   Live play on The Mini Bar, 12 Nov 2026. Two phones played trivia and then followed the host to
   musical bingo. The musical console said Players (4), "Claude Test, Dean, Claude Test, Dean", and
   "2 over the 2 your plan includes. The extra will be charged". Each phone was also asked for
   "Your details" again on the second game, although it had joined trivia minutes before.

   Why: a phone still on the trivia page answered the musical console's hello with a TRIVIA join
   (fmt "trivia", its trivia pid, no device id) before it hopped across, then joined again from the
   musical page, so the console seated it twice. And each phone page keeps its name and token under
   its own keys (vp-tname-, vp-mname-), so the musical page had no name and showed the form.

   This RUNS the real code, lifted out of the shipped pages: the musical console's rosterJoin and
   rosterKey, the trivia phone's announce, and both phones' connect() with their real storage
   helpers over a fake localStorage.

   Run: jsc venueplay-backend/app/one-phone-one-name.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string") throw new Error("pass(name, condition): the name must be a string");
  if (typeof c !== "boolean") throw new Error("pass(name, condition): the condition must be a boolean for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
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
function liftVar(src, name) {   // a one-line `var NAME=[...];`
  var m = new RegExp("var " + name + "=\\[[^\\n]*\\];").exec(src);
  return m ? m[0] : null;
}
/* Each page's code runs in its own function scope, so the two pages' same-named helpers never meet. */
function pageScope(src, names, extraVars, prelude) {
  var parts = [], missing = [];
  names.forEach(function (n) { var f = lift(src, n); if (f) parts.push(f); else missing.push(n); });
  (extraVars || []).forEach(function (n) { var v = liftVar(src, n); if (v) parts.push(v); });
  var code = prelude + "\n" + parts.join("\n") +
    "\nreturn { " + names.filter(function (n) { return missing.indexOf(n) === -1; }).map(function (n) { return n + ": " + n; }).join(", ") +
    (names.filter(function (n) { return missing.indexOf(n) === -1; }).length ? ", " : "") + "env: env };";
  return { missing: missing, make: new Function("env", code) };
}

/* ---- a fake browser store ---- */
function store(init) {
  var d = {}; for (var k in (init || {})) d[k] = String(init[k]);
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
           setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; }, _d: d };
}
var ROOM = "QK7MZP";

/* ======================= the musical console's roster ======================= */
var HOST = find("venueplay/app/musical/host.html");
var hostPage = pageScope(HOST, ["rosterKey", "rosterJoin", "playerCount"], [],
  "var G = env.G;");
pass("the musical console seats joins through one named function, rosterJoin", hostPage.missing.indexOf("rosterJoin") === -1, hostPage.missing.join(", "));
function console_() {
  var G = { players: {}, order: [] };
  var api = hostPage.make({ G: G });
  return { G: G, join: function (m) { return api.rosterJoin ? api.rosterJoin(m) : false; }, count: function () { return G.order.length; },
           names: function () { return G.order.map(function (k) { return G.players[k].name; }).join(", "); } };
}

print("\nthe Mini Bar's night: two phones come over from trivia to musical bingo");
(function () {
  var c = console_();
  // the trivia pages answer the musical console's hello before they hop (fmt trivia, trivia pids, no device id)
  c.join({ t: "join", pid: "tpidCLAUDE01", name: "Claude Test", fmt: "trivia" });
  c.join({ t: "join", pid: "tpidDEAN0001", name: "Dean", fmt: "trivia" });
  // then their musical pages join (musical pids, the browser's one device id)
  c.join({ t: "join", pid: "mpidCLAUDE01", name: "Claude Test", did: "devCLAUDE000001" });
  c.join({ t: "join", pid: "mpidDEAN0001", name: "Dean", did: "devDEAN0000001" });
  pass("Players reads 2, not 4", c.count() === 2, c.count() + ": " + c.names());
  pass("each name once", c.names() === "Claude Test, Dean", c.names());
  // the same trivia join WITH a device id (the trivia phone now sends one) is still not a musical player
  c.join({ t: "join", pid: "tpidCLAUDE01", name: "Claude Test", fmt: "trivia", did: "devCLAUDE000001" });
  pass("a trivia join, even with its device id, never adds a musical player", c.count() === 2, c.names());
})();

print("\na phone that reconnects (re-announces on every rejoin)");
(function () {
  var c = console_();
  for (var i = 0; i < 3; i++) c.join({ t: "join", pid: "mpidSAM00001", name: "Sam", did: "devSAM00000001" });
  pass("one phone joining three times is one player", c.count() === 1, c.names());
  c.join({ t: "join", pid: "mpidSAM00002", name: "Sam", did: "devSAM00000001" });   // a new pid after its storage was cleared, same browser
  pass("a new pid on the same browser is still one player", c.count() === 1, c.names());
})();

print("\ntwo phones, and a second phone for the same person");
(function () {
  var c = console_();
  c.join({ t: "join", pid: "mpidJO000001", name: "Jo", did: "devJO000000001" });
  c.join({ t: "join", pid: "mpidKIM00001", name: "Kim", did: "devKIM00000001" });
  pass("two phones are two players", c.count() === 2, c.names());
  c.join({ t: "join", pid: "mpidJO000002", name: "Jo", did: "devJOTABLET001" });
  pass("Jo's second phone is a third player (it cannot be told apart)", c.count() === 3, c.names());
})();

print("\nthe bingo page from the game before (no fmt, same device id) is still one chip");
(function () {
  var c = console_();
  c.join({ t: "join", pid: "bingoKeyFp01", name: "Margaret", did: "devMARG0000001" });
  c.join({ t: "join", pid: "mpidMARG0001", name: "Margaret", did: "devMARG0000001" });
  pass("one chip for one browser", c.count() === 1, c.names());
})();

/* ======================= the trivia phone's join announcement ======================= */
var TPLAY = find("venueplay/app/trivia/play.html");
print("\nthe trivia phone says which browser it is");
(function () {
  var sent = [];
  var tp = pageScope(TPLAY, ["announce"], [], "var P = env.P, send = env.send, deviceId = env.deviceId;");
  var api = tp.make({ P: { pid: "tpid01", name: "Quiz Kids" }, send: function (m) { sent.push(m); }, deviceId: function () { return "devQUIZ0000001"; } });
  api.announce();
  pass("its join carries fmt trivia (the consoles' filter)", sent.length === 1 && sent[0].fmt === "trivia", JSON.stringify(sent[0]));
  pass("and the browser's device id", sent.length === 1 && sent[0].did === "devQUIZ0000001", JSON.stringify(sent[0]));
})();

/* ======================= the phones' second game of the night ======================= */
var STORE_FNS = ["loadPid", "savePid", "loadName", "saveName", "loadToken", "shareToken", "saveToken", "loadSess", "saveSess", "siblingIdentity", "connect"];
var MPLAY = find("venueplay/app/musical/play.html");

function musicalPhone(init) {
  var ls = store(init), calls = { form: 0, stale: 0 };
  var P = { room: "", pid: "", name: "", joined: false, token: "", sessionId: "" };
  var el = function () { return { textContent: "", parentNode: { classList: { remove: function () {} } }, classList: { add: function () {}, remove: function () {} } }; };
  var mp = pageScope(MPLAY, STORE_FNS, ["SIBLING_KEYS"],
    "var localStorage = env.ls, sessionStorage = store(), P = env.P, OWN_TOKEN_KEY = 'vp-mtoken-';\n" +
    "var $ = function () { return env.el(); }, randId = function () { return 'pid' + Math.random().toString(36).slice(2, 10); };\n" +
    "var checkStaleJoin = function () { env.calls.stale++; }, openChannel = function () {}, route = function () {};\n" +
    "var loadJoinInfo = function () { env.calls.form++; }; var window = {};");
  var api = mp.make({ ls: ls, P: P, el: el, calls: calls });
  return { api: api, P: P, ls: ls, calls: calls, missing: mp.missing };
}
print("\nmusical bingo after trivia, on the same phone and the same room");
(function () {
  var ph = musicalPhone({ "vp-tname-QK7MZP": "Claude Test", "vp-ttoken-QK7MZP": "tok-trivia-1", "vp-tsess-QK7MZP": "sess-1", "vpDeviceId": "devCLAUDE000001" });
  pass("the musical phone's connect() came out of the page", typeof ph.api.connect === "function", ph.missing.join(", "));
  ph.api.connect(ROOM);
  pass("it is in straight away: no \"Your details\" form a second time", ph.P.joined === true && ph.calls.form === 0, "joined=" + ph.P.joined + " form shown " + ph.calls.form + "x");
  pass("under the name it played trivia with", ph.P.name === "Claude Test", ph.P.name);
  pass("with the same Worker row's token (one player, not a new join)", ph.P.token === "tok-trivia-1", ph.P.token);
  pass("and it checks that night is still live (a stale one re-joins under the same device id)", ph.calls.stale === 1, ph.calls.stale + "x");
  pass("the name is kept for this page too (a reload does not ask)", ph.ls.getItem("vp-mname-" + ROOM) === "Claude Test", ph.ls.getItem("vp-mname-" + ROOM));
  pass("the trivia page's own token is left the same (shareToken keeps every copy equal)", ph.ls.getItem("vp-ttoken-" + ROOM) === "tok-trivia-1");
})();
print("\nmusical bingo with only a NAME from trivia (it never finished joining)");
(function () {
  var ph = musicalPhone({ "vp-tname-QK7MZP": "Claude Test" });
  ph.api.connect(ROOM);
  pass("a name with no token is not a join: the join screen shows", ph.P.joined === false && ph.calls.form === 1, "joined=" + ph.P.joined);
})();
print("\nmusical bingo on a phone that has played nothing here");
(function () {
  var ph = musicalPhone({ "vp-tname-OTHER1": "Elsewhere", "vp-ttoken-OTHER1": "tok-x" });
  ph.api.connect(ROOM);
  pass("another venue's room is never borrowed: the join screen shows", ph.P.joined === false && ph.calls.form === 1, "joined=" + ph.P.joined);
})();
print("\nmusical bingo where the phone already has its own musical name");
(function () {
  var ph = musicalPhone({ "vp-mname-QK7MZP": "Sam", "vp-mtoken-QK7MZP": "tok-m", "vp-tname-QK7MZP": "Quiz Kids", "vp-ttoken-QK7MZP": "tok-t" });
  ph.api.connect(ROOM);
  pass("its own musical name wins", ph.P.joined === true && ph.P.name === "Sam" && ph.P.token === "tok-m", ph.P.name + " " + ph.P.token);
})();

function triviaPhone(init) {
  var ls = store(init), calls = { form: 0, wait: 0 };
  var P = { room: "", pid: "", name: "", joined: false, token: "", sessionId: "" };
  var el = function () { return { textContent: "", parentNode: { classList: { remove: function () {} } }, classList: { add: function () {}, remove: function () {} } }; };
  var tp = pageScope(TPLAY, STORE_FNS, ["SIBLING_KEYS"],
    "var localStorage = env.ls, sessionStorage = store(), P = env.P, OWN_TOKEN_KEY = 'vp-ttoken-';\n" +
    "var $ = function () { return env.el(); }, randId = function () { return 'pid' + Math.random().toString(36).slice(2, 10); };\n" +
    "var prKeyFor = function () {}, ch = null, subscribed = false, window = {}, onMsg = function () {}, onChannelStatus = function () {};\n" +
    "var client = { channel: function () { return { on: function () { return this; }, subscribe: function () {} }; } };\n" +
    "var showWait = function () { env.calls.wait++; }, armNoGame = function () {}, loadJoinInfo = function () {};\n" +
    "var show = function (id) { if (id === 'vJoin') env.calls.form++; };");
  var api = tp.make({ ls: ls, P: P, el: el, calls: calls });
  return { api: api, P: P, ls: ls, calls: calls, missing: tp.missing };
}
print("\ntrivia after musical bingo, on the same phone and the same room");
(function () {
  var ph = triviaPhone({ "vp-mname-QK7MZP": "Dean", "vp-mtoken-QK7MZP": "tok-m-1", "vp-msess-QK7MZP": "sess-2" });
  pass("the trivia phone's connect() came out of the page", typeof ph.api.connect === "function", ph.missing.join(", "));
  ph.api.connect(ROOM);
  pass("it is in straight away: no join form a second time", ph.P.joined === true && ph.calls.form === 0 && ph.calls.wait === 1, "joined=" + ph.P.joined + " form " + ph.calls.form);
  pass("under the same name and the same row's token", ph.P.name === "Dean" && ph.P.token === "tok-m-1", ph.P.name + " " + ph.P.token);
  pass("the session it came from is kept, so a NEW night is noticed and re-joined (nightChanged)", ph.P.sessionId === "sess-2", ph.P.sessionId);
})();
print("\ntrivia on a phone that has played nothing here");
(function () {
  var ph = triviaPhone({});
  ph.api.connect(ROOM);
  pass("the join screen shows, as always", ph.P.joined === false && ph.calls.form === 1, "joined=" + ph.P.joined);
})();

print("");
print(bad ? bad + " OF " + ran + " CHECKS FAILED" : "ALL " + ran + " CHECKS PASSED");
