/* WHEN THE TEXT DOES NOT ARRIVE, THE HOST CAN GET A SIGN-IN LINK BY EMAIL (rebuilt 15 Nov 2026).

   21 Oct 2026: Mobile Message, the only SMS provider, went down. Dean's items 63 to 67 and 102 (5 and 9 Nov) then
   fixed how the way around it must behave, and this test holds the PAGE to it:

     (a) there is NO box to type an address into, and the page never asks Auth to email a code to anything
         typed: the only thing it ever sends is the MOBILE it already holds, to the Worker's
         POST /auth/email-backup, which sends a link only to the email saved on that login;
     (b) whatever the Worker answers, the page says the SAME words (item 67), so it never reveals whether an
         email is saved for a number; no masked address, no support phone on that screen;
     the text-code path (verify as sms, 4 hour shift, resend) is untouched.

   This runs the REAL sign-in script from index.html against a fake page, a fake Supabase client and a fake
   fetch, and presses the buttons. The Worker half is tools/test-email-backup.js.

   Run: jsc venueplay-backend/app/signin-email-fallback.test.js */
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
var APP = find("venueplay/app/index.html");
var A = APP.indexOf("// ================= SIGN IN (real Supabase phone OTP)");
var B = APP.indexOf("  // demo bypass shortcuts removed", A);
pass("the sign-in script is still one block in index.html", A > 0 && B > A);
var SIGNIN = APP.slice(A, B);

/* ---- the markup: every id the script reaches for must be on the page ---- */
["stepMobile", "stepCode", "emailAlt", "emailAltBtn", "emailAltMsg"].forEach(function (id) {
  pass("the page has #" + id, APP.indexOf('id="' + id + '"') > 0);
});
var mark = /<div id="emailAlt"[^>]*>[\s\S]*?<\/div>/.exec(APP);
pass("the offer reads exactly as Dean asked", !!mark && mark[0].indexOf("Code not arriving? Get it by email instead") > 0);
pass("and it starts hidden, so nobody is pushed off the text code", !!mark && /class="hidden/.test(mark[0]));
var SIGNIN_CARD = APP.slice(APP.indexOf('id="vSignIn"'), APP.indexOf('id="vAdmin"'));
pass("there is NO email box on the sign-in screen: nothing an address could be typed into",
     !/type="email"/.test(SIGNIN_CARD) && !/id="emailIn"/.test(SIGNIN_CARD) && !/id="stepEmail"/.test(SIGNIN_CARD) && !/autocomplete="email"/.test(SIGNIN_CARD));
/* A PHONE code with shouldCreateUser:false (a short link for an existing login only, 12 Nov) is not an email code. */
pass("the page never asks Auth for an email code or an email verify at all",
     !/signInWithOtp\(\s*\{\s*email/.test(SIGNIN) && !/type:\s*"email"/.test(SIGNIN) && !/email\s*:[^}]*options\s*:\s*\{\s*shouldCreateUser/.test(SIGNIN) && !/emailOtp|EMAIL=/.test(SIGNIN));
pass("no masked address and no support phone on that screen", !/\u2022|j•••|07 5228/.test(SIGNIN_CARD));

/* ---- a fake page ---- */
var EL = {};
function el(id) {
  if (EL[id]) return EL[id];
  var cls = {}, h = {};
  if (/^(stepCode|emailAlt|emailAltMsg)$/.test(id)) cls.hidden = true;   // as the markup ships
  var e = {
    id: id, value: "", textContent: "", disabled: false, focused: 0,
    classList: { add: function (c) { cls[c] = true; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; } },
    addEventListener: function (t, f) { (h[t] = h[t] || []).push(f); },
    focus: function () { e.focused++; },
    click: function () { (h.click || []).forEach(function (f) { f.call(e, {}); }); },
    key: function (k) { (h.keydown || []).forEach(function (f) { f.call(e, { key: k, preventDefault: function () {} }); }); }
  };
  return (EL[id] = e);
}
function $(id) { return el(id); }
function shown(id) { return !el(id).classList.contains("hidden"); }

var STORE = {};
var localStorage = { setItem: function (k, v) { STORE[k] = String(v); }, getItem: function (k) { return k in STORE ? STORE[k] : null; }, removeItem: function (k) { delete STORE[k]; } };
var location = { origin: "https://venueplay.com.au" };
var ROUTED = 0;
function routeAfterAuth() { ROUTED++; }

/* ---- a fake Supabase client: record every call, answer what the test says ---- */
var OTP_CALLS = [], VERIFY_CALLS = [], NEXT_OTP = null, NEXT_VERIFY = null;
var FETCHES = [], NEXT_FETCH = null;
function fetch(url, opts) {
  FETCHES.push({ url: url, opts: opts });
  var r = NEXT_FETCH;
  if (r === "throw") return Promise.reject(new Error("offline"));
  r = r || { status: 200, body: { ok: true } };
  return Promise.resolve({ status: r.status, json: function () { return Promise.resolve(r.body); } });
}
var client = { auth: {
  signInWithOtp: function (a) { OTP_CALLS.push(a); var r = NEXT_OTP; return Promise.resolve(r || {}); },
  verifyOtp: function (a) { VERIFY_CALLS.push(a); var r = NEXT_VERIFY; return Promise.resolve(r || { data: { session: {} } }); }
} };

async function settle() { for (var i = 0; i < 10; i++) await Promise.resolve(); }
function reset() {
  EL = {}; STORE = {}; ROUTED = 0; OTP_CALLS = []; VERIFY_CALLS = []; NEXT_OTP = null; NEXT_VERIFY = null; FETCHES = []; NEXT_FETCH = null;
  eval(SIGNIN);   // a fresh page: listeners bound to fresh elements, MODE back to sms
}
var SMS_DOWN = { error: { status: 422, code: "sms_send_failed", message: "Error sending confirmation OTP to provider: Failed to send SMS" } };

(async function () {
  /* ---- 1. THE TEXT FAILS: SAY SO, AND OFFER EMAIL ---- */
  reset();
  el("mobileIn").value = "0497 605 423"; NEXT_OTP = SMS_DOWN;
  el("sendCodeBtn").click(); await settle();
  pass("a failed text says so in plain words",
       el("mobileErr").textContent.indexOf("We could not send a text right now. Use the email option below.") === 0, el("mobileErr").textContent);
  pass("and the email option appears", shown("emailAlt"));
  pass("and the host stays on the number step, not a code box for a text that never went", shown("stepMobile") && !shown("stepCode"));

  reset();
  el("mobileIn").value = "0497 605 423";
  NEXT_OTP = { error: { status: 500, message: "Unexpected status code returned from hook: 500" } };
  el("sendCodeBtn").click(); await settle();
  pass("the hook's own 500 reads the same way", /could not send a text/.test(el("mobileErr").textContent) && shown("emailAlt"), el("mobileErr").textContent);

  reset();
  el("mobileIn").value = "0497 605 423";
  NEXT_OTP = { error: { status: 400, code: "validation_failed", message: "Invalid phone number format" } };
  el("sendCodeBtn").click(); await settle();
  pass("a mistyped number is told to check it, and is not pushed to email", /did not look right/.test(el("mobileErr").textContent) && !shown("emailAlt"));

  /* ---- 2. THE TEXT IS ACCEPTED BUT MAY NEVER ARRIVE ---- */
  reset();
  el("mobileIn").value = "0497 605 423";
  el("sendCodeBtn").click(); await settle();
  pass("a text that went out moves to the code box", shown("stepCode") && !shown("stepMobile"));
  pass("and the email option is offered there too", shown("emailAlt"));
  pass("the phone code went to the right number", OTP_CALLS.length === 1 && OTP_CALLS[0].phone === "+61497605423", JSON.stringify(OTP_CALLS));

  /* ---- 3. THE EMAIL BACKUP SENDS THE MOBILE, NEVER AN ADDRESS ---- */
  var SAID = "If there's an email saved on your profile, we've sent a sign-in link to it. It can take a minute, so check your junk folder too. No email saved? Ask your manager to send you a new sign-in.";
  el("emailAltBtn").click(); await settle();
  var f = FETCHES[0] || {}, fb = {}; try { fb = JSON.parse(f.opts.body); } catch (e) {}
  pass("it calls the Worker's email-backup route", FETCHES.length === 1 && f.url === "https://api.venueplay.com.au/auth/email-backup" && f.opts.method === "POST", JSON.stringify(FETCHES));
  pass("and the body is the mobile and NOTHING else (no address field exists to send)", JSON.stringify(fb) === JSON.stringify({ mobile: "+61497605423" }), f.opts && f.opts.body);
  pass("no email code was asked of Auth, and nothing but the one text was ever sent through it", OTP_CALLS.length === 1 && OTP_CALLS.every(function (c) { return c.phone && !c.email; }), JSON.stringify(OTP_CALLS));
  pass("it shows Dean's item 67 words exactly", el("emailAltMsg").textContent === SAID && shown("emailAltMsg"), el("emailAltMsg").textContent);
  pass("and stays on the code box, where the text code can still be typed", shown("stepCode") && !shown("stepMobile"));

  /* ---- 4. THE WORDS NEVER DEPEND ON WHETHER AN EMAIL EXISTS ---- */
  var variants = [
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true, sent: true, to: "s•••@theroyal.com.au" } },
    { status: 200, body: { ok: true, has_email: false } },
    { status: 200, body: { ok: true, sent: false } },
    { status: 200, body: { ok: true, no_email: true, ended: true } }
  ], words = [];
  for (var i = 0; i < variants.length; i++) {
    reset(); el("mobileIn").value = "0497 605 423"; el("sendCodeBtn").click(); await settle();
    NEXT_FETCH = variants[i]; el("emailAltBtn").click(); await settle(); words.push(el("emailAltMsg").textContent);
  }
  pass("whatever extra fields the Worker adds, the page says exactly the same thing", words.every(function (w) { return w === SAID; }), JSON.stringify(words));
  pass("the words reveal no address, no masked hint and no phone number", !/@|\u2022|07 5228|\d{4} ?\d{3}/.test(SAID));
  pass("and carry no em dash", !/[\u2014\u2013]/.test(SAID));

  /* ---- 5. TOO MANY, OR OFFLINE: neutral, and about the caller only ---- */
  reset(); el("mobileIn").value = "0497 605 423"; el("sendCodeBtn").click(); await settle();
  NEXT_FETCH = { status: 429, body: { ok: false, busy: true } }; el("emailAltBtn").click(); await settle();
  pass("too many tries says wait, and says nothing about any account", /Too many tries/.test(el("emailAltMsg").textContent) && el("emailAltMsg").textContent.indexOf("email saved") < 0, el("emailAltMsg").textContent);
  pass("and the link stays so they can try again later", shown("emailAlt") || el("emailAltBtn").textContent.indexOf("Code not arriving") === 0);
  reset(); el("mobileIn").value = "0497 605 423"; el("sendCodeBtn").click(); await settle();
  NEXT_FETCH = "throw"; el("emailAltBtn").click(); await settle();
  pass("offline: a plain 'try again', never the saved-email words", /try again in a minute/i.test(el("emailAltMsg").textContent) && el("emailAltMsg").textContent !== SAID, el("emailAltMsg").textContent);

  /* ---- 6. THE TEXT FAILED: THE BACKUP IS OFFERED FROM THE NUMBER STEP TOO ---- */
  reset();
  el("mobileIn").value = "0497 605 423"; NEXT_OTP = SMS_DOWN;
  el("sendCodeBtn").click(); await settle();
  el("emailAltBtn").click(); await settle();
  var f6 = FETCHES[0] || {};
  pass("with texts down, the same route gets the same mobile", FETCHES.length === 1 && /email-backup$/.test(f6.url) && f6.opts.body === JSON.stringify({ mobile: "+61497605423" }), JSON.stringify(FETCHES));
  pass("and the same words", el("emailAltMsg").textContent === SAID);

  /* ---- 7. THE TEXT PATH IS UNCHANGED ---- */
  reset();
  el("mobileIn").value = "0497 605 423";
  el("sendCodeBtn").click(); await settle();
  el("otpIn").value = "12345"; el("verifyBtn").click(); await settle();
  pass("a short code asks for the code from the PHONE", /from your phone/.test(el("otpErr").textContent) && VERIFY_CALLS.length === 0, el("otpErr").textContent);
  NEXT_VERIFY = { error: { message: "Token has expired or is invalid" } };
  el("otpIn").value = "654321"; el("verifyBtn").click(); await settle();
  pass("a wrong code does not sign in", ROUTED === 0 && !("vpShiftStart" in STORE) && /did not match/.test(el("otpErr").textContent));
  NEXT_VERIFY = null; var before = Date.now();
  el("otpIn").value = "111222"; el("verifyBtn").click(); await settle();
  var sv = VERIFY_CALLS[VERIFY_CALLS.length - 1] || {};
  pass("a text code verifies as type sms against the phone", sv.type === "sms" && sv.phone === "+61497605423" && !sv.email, JSON.stringify(sv));
  pass("and starts the 4 hour shift and routes the same way", ROUTED === 1 && +STORE.vpShiftStart >= before);

  /* ---- 8. RESEND BY TEXT FAILING ---- */
  reset();
  el("mobileIn").value = "0497 605 423";
  el("sendCodeBtn").click(); await settle();
  NEXT_OTP = SMS_DOWN;
  el("resendBtn").click(); await settle();
  pass("a failed resend says the text failed and points at the email option, not 'give it a moment'",
       /could not send a text right now/.test(el("otpErr").textContent) && shown("emailAlt"), el("otpErr").textContent);
  pass("Resend always sends a TEXT to the same number", OTP_CALLS.every(function (c) { return c.phone === "+61497605423" && !c.email; }), JSON.stringify(OTP_CALLS));

  print("");
  print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
})();
