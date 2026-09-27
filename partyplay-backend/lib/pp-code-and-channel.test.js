/* THE CODE A GUEST TYPES AND THE CHANNEL THEY LISTEN ON ARE THE SAME PARTY.
   AND A CHANNEL WE HUNG UP ON IS NOT NEWS.

   Audit, 27 Sep 2026, two faults:

   1. The Worker files a code through normaliseCode: spaces and dashes out, 5 read as S,
      2 read as Z. So "abs 3km" and "AB53KM" both JOIN party ABS3KM. Every page then built
      its realtime channel from what the guest typed ("pp-ABS 3KM", "pp-AB53KM"), so the
      guest was on the host's list, counted against the fifty, and heard nothing all night.

   2. Unsubscribing a supabase channel reports CLOSED to it straight away. The phone's
      "Not this party?" and the host's "Try again" both unsubscribed while the channel was
      still the current one, so that CLOSED painted "Lost the connection" over the join
      form the guest had just asked for, and put the host's not-connected bar straight
      back up.

   This RUNS pp-config.js, the Worker's own normaliseCode, and the real connect()
   functions out of play.html and run.html against a fake channel that behaves the way
   supabase-js does.

   Run: jsc partyplay-backend/lib/pp-code-and-channel.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){
  if (typeof c !== "boolean") throw new Error("condition must be a boolean for " + n);
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
  var m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}

/* A channel the way supabase-js behaves: unsubscribe() reports CLOSED synchronously. */
var made = [];
function fakeClient() {
  return { channel: function (name) {
    var c = { name: name, handlers: [], status: null, sent: [], gone: false,
      on: function (a, b, cb) { this.handlers.push(cb); return this; },
      subscribe: function (cb) { this.status = cb; return this; },
      unsubscribe: function () { this.gone = true; if (this.status) this.status("CLOSED"); },
      send: function (m) { this.sent.push(m.payload); },
      say: function (p) { this.handlers.forEach(function (h) { h({ payload: p }); }); } };
    made.push(c); return c;
  } };
}
var supabase = { createClient: fakeClient };

print("== 1. the channel is named after the party the Worker joined ==");
eval(find("partyplay/lib/pp-config.js"));
var PPConfig = globalThis.PPConfig;
var SRC = find("partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js");
var normSrc = lift(SRC, "normaliseCode");
pass("normaliseCode came out of the Worker", !!normSrc);
eval(normSrc);
var inputs = ["ABS3KM", "abs 3km", "AB53KM", "ab-s3-km", " a b s 3 k m ", "2ZAP5", "", null];
inputs.forEach(function (x) {
  pass("the page and the Worker agree on " + JSON.stringify(x),
       PPConfig.code(x) === normaliseCode(x), PPConfig.code(x) + " vs " + normaliseCode(x));
});
pass('"abs 3km" and "AB53KM" listen on pp-ABS3KM',
     PPConfig.channel("abs 3km") === "pp-ABS3KM" && PPConfig.channel("AB53KM") === "pp-ABS3KM",
     PPConfig.channel("abs 3km") + " / " + PPConfig.channel("AB53KM"));

var PLAY = find("partyplay/play.html"), RUN = find("partyplay/run.html"), TV = find("partyplay/tv.html");
pass("the phone files the code it saves and connects with through PPConfig.code",
     /save\(\{ code:PPConfig\.code\(code\)/.test(PLAY) && /connect\(PPConfig\.code\(code\), j\.nickname\)/.test(PLAY));
pass("the host console reads its code through PPConfig.code", /var CODE=PPConfig\.code\(q\.get\("code"\)\)/.test(RUN));
pass("the telly reads its code through PPConfig.code", /var CODE = PPConfig\.code\(/.test(TV));
pass("the phone sends the token it last had, so a returning guest keeps their place",
     /api\("\/join", \{ method:"POST", body: JSON\.stringify\(\{ code:code, nickname:nickname, prev: had\.token \|\| had\.prev \|\| "" \}\)/.test(PLAY) &&
     /if\(was\.token\) was\.prev = was\.token; delete was\.token;/.test(PLAY));
var resend = lift(SRC, "handleResendWelcome") || "";
pass("the resend email looks the code up the way /join does", /normaliseCode\(b\.code\)/.test(resend));

print("\n== 2. the phone: a channel it hung up on cannot repaint the screen ==");
var paints = [], msgs = [], Q, B, H, T, W, _ppLive = false, _ppChannel = null, window = {};
var SUPA_URL = "https://x", SUPA_ANON = "k";
function waiting(n, how) { paints.push(how || "getting"); }
function onMsg(p) { msgs.push(p); }
var got = ["hangUp", "connect"].map(function (n) { return lift(PLAY, n); });
pass("hangUp() and connect() came out of play.html", !!(got[0] && got[1]));
eval(got.join("\n"));
connect(PPConfig.code("abs 3km"), "Sam");
var first = made[made.length - 1];
pass("the typed code connects to pp-ABS3KM", first.name === "pp-ABS3KM", first.name);
first.status("SUBSCRIBED");
pass("control: SUBSCRIBED says they are in", paints[paints.length - 1] === "live");
first.status("CLOSED");
pass("control: the CURRENT channel closing still says so", paints[paints.length - 1] === "lost");
first.status("SUBSCRIBED"); paints = [];
hangUp();                                   // what "Not this party?" does
pass("hanging up really unsubscribes", first.gone === true);
pass('"Not this party?" does not paint "Lost the connection"', paints.indexOf("lost") < 0, JSON.stringify(paints));
connect("ZZZZZZ", "Sam"); var second = made[made.length - 1]; paints = [];
first.status("CLOSED"); first.say({ t: "q", from: "old party" });
pass("a late CLOSED from the old party changes nothing", paints.length === 0, JSON.stringify(paints));
pass("and the old party's messages are not played", msgs.length === 0, JSON.stringify(msgs));
second.say({ t: "q" });
pass("control: the new party's messages are", msgs.length === 1);

print("\n== 3. the host: Try again does not bring the bar straight back ==");
var bar = null, retry = null, subscribed = false, sendQueue = [], SEND_QUEUE_MAX = 50, wireBarTimer = null;
var ch = null, players = [], CODE = PPConfig.code("abs 3km");
var document = {
  getElementById: function (id) {
    if (id === "ppWire") return bar;
    if (id === "ppWireGo") return { addEventListener: function (e, f) { retry = f; } };
    return null;
  },
  createElement: function () { return { setAttribute: function () {}, remove: function () { bar = null; } }; },
  body: { firstChild: null, insertBefore: function (el) { bar = el; } }
};
function setTimeout() { return 0; }
function clearTimeout() {}
function paintStrip() {}
var names = ["wireOut", "send", "flushQueue", "wireBar", "armWireWatch", "onChannelStatus", "connect"];
var hsrc = names.map(function (n) { return lift(RUN, n); });
pass("the host's functions came out of run.html", hsrc.every(Boolean));
eval(hsrc.join("\n"));
connect(); var h1 = ch;
pass("the host listens on pp-ABS3KM", h1.name === "pp-ABS3KM", h1.name);
h1.status("SUBSCRIBED");
pass("control: connected, no bar", bar === null);
h1.status("CLOSED");
pass("control: the channel dropping raises the bar", bar !== null && typeof retry === "function");
retry();
var h2 = ch;
pass("Try again made a fresh channel", h2 !== h1 && h1.gone === true);
pass("and the bar is not straight back up from the old channel's CLOSED", bar === null);
h1.status("CHANNEL_ERROR");
pass("a late error from the old channel is ignored", bar === null);
h2.status("SUBSCRIBED");
pass("the new channel connecting leaves it clear", bar === null && subscribed === true);

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " code and channel checks failed");
