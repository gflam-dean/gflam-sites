/* WHEN MOBILE MESSAGE IS DOWN, THE SIGN-IN TEXT GOES BY CLICKSEND.

   21 Oct 2026: Mobile Message, the only SMS provider, stopped sending. The phone code is the
   only way into a host console, so no host at any venue could sign in. The hook now tries
   ClickSend when Mobile Message errors or times out, and only when ClickSend's two secrets
   are set. Without them it must behave exactly as before.

   This runs the REAL Worker (the whole file, its fetch handler included) against a fake
   network: nothing here reaches either provider.

   Run: jsc venueplay-backend/worker/sms-hook-failover.test.js */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var t = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} }
  throw new Error("cannot open " + rel);
}

/* ---- what jsc lacks, faked just enough ---- */
var LOGS = [];
console = {
  log:   function () { LOGS.push(Array.prototype.join.call(arguments, " ")); },
  warn:  function () { LOGS.push(Array.prototype.join.call(arguments, " ")); },
  error: function () { LOGS.push(Array.prototype.join.call(arguments, " ")); }
};
/* Timers: record every delay asked for. Fire them only when a test says the network hangs,
   so a timeout can be driven without waiting ten real seconds. */
var DELAYS = [], FIRE_TIMERS = false;
setTimeout = function (fn, ms) { DELAYS.push(ms); if (FIRE_TIMERS) Promise.resolve().then(fn); return DELAYS.length; };
clearTimeout = function () {};
AbortController = function () {
  var self = this; this._fns = [];
  this.signal = { aborted: false, addEventListener: function (n, f) { self._fns.push(f); } };
  this.abort = function () { self.signal.aborted = true; self._fns.forEach(function (f) { f(); }); };
};
function Resp(status, body) {
  return { ok: status >= 200 && status < 300, status: status,
           text: function () { return Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)); } };
}
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; };
URL = function (u) { this.pathname = String(u).replace(/^https?:\/\/[^\/]+/, "").split("?")[0] || "/"; };

/* The fake network. Each provider gets a behaviour: a Resp, "throw", or "hang". */
var CALLS = [], NET = {};
fetch = function (url, init) {
  CALLS.push({ url: url, init: init, body: init && init.body ? JSON.parse(init.body) : null });
  var which = /mobilemessage/.test(url) ? "mm" : (/clicksend/.test(url) ? "cs" : "other");
  var b = NET[which];
  if (b === "throw") return Promise.reject(new TypeError("network down"));
  if (b === "hang") return new Promise(function (res, rej) {
    init.signal.addEventListener("abort", function () { var e = new Error("aborted"); e.name = "AbortError"; rej(e); });
  });
  return Promise.resolve(b || Resp(500, "no behaviour set"));
};

/* ---- load the real Worker ---- */
var SRC = find("venueplay-backend/worker/venueplay-sms-hook.js");
var WORKER = null;
(0, eval)(SRC.replace(/^export default /m, "WORKER = "));
pass("the real Worker loaded, fetch handler and all", !!(WORKER && typeof WORKER.fetch === "function"));

var PHONE = "+61497605423", OTP = "482913";
var BODY = JSON.stringify({ user: { phone: PHONE }, sms: { otp: OTP } });
function hookRequest() {
  var h = { "webhook-id": "msg_abc123" };
  return { method: "POST", url: "https://venueplay-sms.example/", headers: { get: function (k) { return h[k.toLowerCase()] || null; } },
           text: function () { return Promise.resolve(BODY); } };
}
/* ALLOW_UNSIGNED skips the signature so this suite tests delivery alone; sms-hook-secrets
   covers the signature. */
var MM = { ALLOW_UNSIGNED: "true", MOBILEMESSAGE_USERNAME: "mmuser", MOBILEMESSAGE_PASSWORD: "mmpass" };
var BOTH = { ALLOW_UNSIGNED: "true", MOBILEMESSAGE_USERNAME: "mmuser", MOBILEMESSAGE_PASSWORD: "mmpass",
             CLICKSEND_USERNAME: "csuser", CLICKSEND_API_KEY: "cskey-123" };
var MM_OK = Resp(200, { status: "complete", results: [{ status: "success", message_id: "m1", to: PHONE }] });
var CS_OK = Resp(200, { http_code: 200, response_code: "SUCCESS", data: { messages: [{ status: "SUCCESS", to: PHONE }] } });

async function run(env, mm, cs, hang) {
  CALLS = []; LOGS = []; DELAYS = []; NET = { mm: mm, cs: cs }; FIRE_TIMERS = !!hang;
  var r = await WORKER.fetch(hookRequest(), env);
  return r;
}
function noSecretsInLogs() {
  var all = LOGS.join("\n");
  return all.indexOf("97605423") < 0 && all.indexOf(OTP) < 0 && all.indexOf("cskey") < 0 && all.indexOf("mmpass") < 0;
}
function hosts() { return CALLS.map(function (c) { return /clicksend/.test(c.url) ? "clicksend" : (/mobilemessage/.test(c.url) ? "mobilemessage" : c.url); }).join(","); }

(async function () {
  var r;

  /* ---- 1. NOTHING CHANGES WITHOUT THE BACKUP ---- */
  r = await run(MM, MM_OK);
  pass("Mobile Message working: 200 and one call", r.status === 200 && CALLS.length === 1, hosts());
  pass("and the log names the provider that sent", /via mobilemessage/.test(LOGS.join(" ")), LOGS.join(" | "));
  pass("Mobile Message still gets its full ten seconds when there is no backup", DELAYS.indexOf(10000) >= 0, "delays " + DELAYS);

  r = await run(MM, Resp(500, "upstream down"), CS_OK);
  pass("no ClickSend secrets: Mobile Message fails, the hook returns an error", r.status === 500);
  pass("and ClickSend is never called", CALLS.length === 1 && hosts() === "mobilemessage", hosts());
  var errBody = JSON.parse(r.body || "{}");
  pass("the error is in the shape Supabase surfaces to the sign-in screen",
       !!(errBody.error && errBody.error.http_code === 500 && errBody.error.message), r.body);

  r = await run({ ALLOW_UNSIGNED: "true", MOBILEMESSAGE_USERNAME: "mmuser", MOBILEMESSAGE_PASSWORD: "mmpass", CLICKSEND_USERNAME: "csuser" },
                Resp(500, "x"), CS_OK);
  pass("half a ClickSend setup (username, no key) is treated as none", r.status === 500 && CALLS.length === 1, hosts());

  /* ---- 2. FIRST FAILS, SECOND SUCCEEDS ---- */
  r = await run(BOTH, "throw", CS_OK);
  pass("Mobile Message unreachable, ClickSend set: the text goes by ClickSend", r.status === 200 && hosts() === "mobilemessage,clicksend", hosts());
  var cs = CALLS[1];
  pass("ClickSend is called at the right address", cs && cs.url === "https://rest.clicksend.com/v3/sms/send", cs && cs.url);
  pass("with Basic auth of username and API key",
       cs && cs.init.headers.Authorization === "Basic " + btoa("csuser:cskey-123"), cs && cs.init.headers.Authorization);
  var m = cs && cs.body && cs.body.messages && cs.body.messages[0];
  pass("to the host's number, carrying the code", !!m && m.to === PHONE && m.body.indexOf(OTP) >= 0, JSON.stringify(m));
  pass("with no sender set unless CLICKSEND_FROM is (an unregistered one is refused)", !!m && !("from" in m));
  pass("the log says ClickSend sent and Mobile Message failed",
       /via clicksend/.test(LOGS.join(" ")) && /mobilemessage failed/.test(LOGS.join(" ")), LOGS.join(" | "));
  pass("and no number, code or key is in any log line", noSecretsInLogs(), LOGS.join(" | "));

  r = await run(BOTH, MM_OK, CS_OK);
  pass("Mobile Message working with a backup set: ClickSend is not touched", r.status === 200 && hosts() === "mobilemessage", hosts());

  r = await run(BOTH, Resp(200, { status: "complete", results: [{ status: "failed", to: PHONE }] }), CS_OK);
  pass("a 200 from Mobile Message whose result is not success counts as a failure", r.status === 200 && hosts() === "mobilemessage,clicksend", hosts());
  pass("and Mobile Message's reply, which echoes the number, is not logged", noSecretsInLogs(), LOGS.join(" | "));

  /* ---- 3. A HUNG PROVIDER ---- */
  r = await run(BOTH, "hang", CS_OK, true);
  pass("Mobile Message hangs: it is cut off and ClickSend sends", r.status === 200 && hosts() === "mobilemessage,clicksend", hosts());
  pass("and with a backup the first wait is short enough to leave it time", DELAYS[0] === 2500 && DELAYS[0] + DELAYS[1] < 5000, "delays " + DELAYS);
  pass("the log says it timed out", /timed out/.test(LOGS.join(" ")), LOGS.join(" | "));

  /* ---- 4. BOTH FAIL ---- */
  r = await run(BOTH, Resp(503, "busy"), Resp(401, { http_code: 401, response_code: "UNAUTHORIZED", data: null }));
  pass("both providers fail: the hook returns an error, not a 200", r.status === 500);
  pass("after trying both", hosts() === "mobilemessage,clicksend", hosts());
  pass("and the log records both failures", /mobilemessage failed/.test(LOGS.join(" ")) && /clicksend failed/.test(LOGS.join(" ")), LOGS.join(" | "));
  pass("still with no number or code in the log", noSecretsInLogs(), LOGS.join(" | "));

  r = await run(BOTH, "throw", Resp(200, { http_code: 200, response_code: "SUCCESS", data: { messages: [{ status: "INVALID_RECIPIENT" }] } }));
  pass("ClickSend's 200 with a refused message is a failure too", r.status === 500, "status " + r.status);

  r = await run(BOTH, "hang", "hang", true);
  pass("both hang: the hook still answers, with an error", r.status === 500 && hosts() === "mobilemessage,clicksend", hosts());

  /* ---- 5. A REGISTERED SENDER ---- */
  var withFrom = JSON.parse(JSON.stringify(BOTH)); withFrom.CLICKSEND_FROM = "VenuePlay";
  r = await run(withFrom, "throw", CS_OK);
  pass("CLICKSEND_FROM, when set, is the sender", r.status === 200 && CALLS[1].body.messages[0].from === "VenuePlay");

  /* ---- 6. /health ---- */
  CALLS = [];
  r = await WORKER.fetch({ method: "GET", url: "https://venueplay-sms.example/health", headers: { get: function () { return null; } } }, BOTH);
  var h = JSON.parse(r.body || "{}");
  pass("/health answers with the build", r.status === 200 && h.ok === true && typeof h.build === "string" && h.build.length > 5, r.body);
  pass("and says which providers are switched on", !!(h.providers && h.providers.mobilemessage === true && h.providers.clicksend === true), r.body);
  r = await WORKER.fetch({ method: "GET", url: "https://venueplay-sms.example/health", headers: { get: function () { return null; } } }, MM);
  h = JSON.parse(r.body || "{}");
  pass("and that ClickSend is off when its secrets are not set", !!(h.providers && h.providers.clicksend === false), r.body);
  pass("/health never shows a secret", String(r.body).indexOf("mmpass") < 0 && String(r.body).indexOf("mmuser") < 0);
  pass("and sends no text", CALLS.length === 0);

  print("");
  print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
})();
