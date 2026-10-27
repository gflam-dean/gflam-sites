/* THE TELLY SAYS SO WHEN IT HAS REALLY LOST THE PARTY, AND ONLY THEN.

   Audit, 30 Sep 2026: a PartyPlay TV that lost its channel kept whatever it last drew, for ever,
   and looked exactly like one waiting for the host. RUNS the real tv.html script with a fake
   Supabase channel and a held clock: a wobble says nothing, twenty seconds gone shows a small
   note, and the party coming back takes it away.

   Run: jsc partyplay-backend/lib/pp-tv-reconnect.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
var src = find("partyplay/tv.html");
var body = src.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

var els = {}, appended = [], timers = [], statusCb = null;
function el(id){ return els[id] || null; }
var document = {
  getElementById: function (id) { if (id === "screen" || id === "who") return els[id] || (els[id] = { innerHTML: "", hidden: true, style: {} }); return el(id); },
  createElement: function () { var n = { style: {}, setAttribute: function () {}, remove: function () { delete els[n.id]; } }; return n; },
  body: { appendChild: function (n) { els[n.id] = n; appended.push(n.id); } },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
var channel = { on: function () { return channel; }, subscribe: function (cb) { statusCb = cb; return channel; }, send: function () {} };
var supabase = { createClient: function () { return { channel: function () { return channel; } }; } };
var PPConfig = { API: "https://x", SUPA_URL: "https://y", SUPA_ANON: "z", channel: function (c) { return "pp-" + c; }, code: function (c) { return String(c || "").toUpperCase(); } };
var location = { origin: "https://partyplay.com.au", search: "?code=ABC123" };
var localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
function URLSearchParams(){ this.get = function (k) { return k === "code" ? "ABC123" : null; }; }
function fetch(){ return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ status: "paid" }); } }); }
function setTimeout(f, ms){ timers.push({ f: f, ms: ms }); return timers.length; }
function clearTimeout(id){ if (id && timers[id - 1]) timers[id - 1].f = function () {}; }
var navigator = {};
var QRCode = null;
(new Function("document", "supabase", "PPConfig", "location", "localStorage", "URLSearchParams", "fetch", "setTimeout", "clearTimeout", "navigator", "QRCode", "window", body))
  (document, supabase, PPConfig, location, localStorage, URLSearchParams, fetch, setTimeout, clearTimeout, navigator, QRCode, {});

pass("the telly subscribed to the party", typeof statusCb === "function");
statusCb("SUBSCRIBED");
statusCb("CHANNEL_ERROR");
pass("a wobble says nothing straight away", !el("lostNote"));
var wait = timers.filter(function (t) { return t.ms === 20000; }).pop();
pass("a twenty second timer is armed when it drops", !!wait);
statusCb("SUBSCRIBED");
if (wait) wait.f();
pass("back within twenty seconds: still nothing on the wall", !el("lostNote"));
statusCb("TIMED_OUT");
var wait2 = timers.filter(function (t) { return t.ms === 20000; }).pop();
if (wait2) wait2.f();
pass("gone for twenty seconds: a small note says it is reconnecting", !!el("lostNote") && /Reconnecting to the party/.test(el("lostNote").textContent));
statusCb("SUBSCRIBED");
pass("and the note goes the moment the party is back", !el("lostNote"));

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " tv reconnect checks failed");
