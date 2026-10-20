/* WHEN THE TEXT DOES NOT ARRIVE, THE HOST CAN GET THE CODE BY EMAIL.

   21 Oct 2026: Mobile Message, the only SMS provider, went down, and a phone code was the only
   way into a host console. So the sign-in screen now offers "Code not arriving? Get it by email
   instead" once a text has been asked for, and says plainly when the text failed.

   The email code signs in the SAME login (shouldCreateUser:false), so the venue staff check is
   the one phone sign-in already uses, and a correct code starts the same 4 hour shift and takes
   the same route. Supabase's own auth audit log records both kinds of sign-in.

   This runs the REAL sign-in script from index.html against a fake page and a fake Supabase
   client, and presses the buttons.

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
["stepMobile", "stepCode", "emailAlt", "emailAltBtn", "stepEmail", "emailIn", "emailErr", "sendEmailBtn", "backToTextBtn"].forEach(function (id) {
  pass("the page has #" + id, APP.indexOf('id="' + id + '"') > 0);
});
var mark = /<div id="emailAlt"[^>]*>[\s\S]*?<\/div>/.exec(APP);
pass("the offer reads exactly as Dean asked", !!mark && mark[0].indexOf("Code not arriving? Get it by email instead") > 0);
pass("and it starts hidden, so nobody is pushed off the text code", !!mark && /class="hidden/.test(mark[0]));

/* ---- a fake page ---- */
var EL = {};
function el(id) {
  if (EL[id]) return EL[id];
  var cls = {}, h = {};
  if (/^(stepCode|emailAlt|stepEmail)$/.test(id)) cls.hidden = true;   // as the markup ships
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
var client = { auth: {
  signInWithOtp: function (a) { OTP_CALLS.push(a); var r = NEXT_OTP; return Promise.resolve(r || {}); },
  verifyOtp: function (a) { VERIFY_CALLS.push(a); var r = NEXT_VERIFY; return Promise.resolve(r || { data: { session: {} } }); }
} };

async function settle() { for (var i = 0; i < 10; i++) await Promise.resolve(); }
function reset() {
  EL = {}; STORE = {}; ROUTED = 0; OTP_CALLS = []; VERIFY_CALLS = []; NEXT_OTP = null; NEXT_VERIFY = null;
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

  /* ---- 3. SWITCH TO EMAIL ---- */
  el("emailAltBtn").click(); await settle();
  pass("the email step opens", shown("stepEmail") && !shown("stepCode") && !shown("stepMobile") && !shown("emailAlt"));
  el("emailIn").value = "not-an-email";
  el("sendEmailBtn").click(); await settle();
  pass("a non-email is caught before anything is sent", OTP_CALLS.length === 1 && /email address/.test(el("emailErr").textContent));

  el("emailIn").value = "  Sam@TheRoyal.com.au ";
  el("sendEmailBtn").click(); await settle();
  var ea = OTP_CALLS[1] || {};
  pass("the email code is asked for by email, for that address", ea.email === "sam@theroyal.com.au" && !ea.phone, JSON.stringify(ea));
  pass("and it can NEVER create a new login, which would have no venue", !!(ea.options && ea.options.shouldCreateUser === false), JSON.stringify(ea));
  pass("a link in the email lands back on the console", !!(ea.options && ea.options.emailRedirectTo === "https://venueplay.com.au/app/"));
  pass("the code box opens, naming where the code went", shown("stepCode") && !shown("stepEmail") && el("sentTo").textContent === "sam@theroyal.com.au");

  /* ---- 4. VERIFY BY EMAIL: SAME SHIFT, SAME ROUTE ---- */
  el("otpIn").value = "12345";
  el("verifyBtn").click(); await settle();
  pass("a short code asks for the code from the EMAIL", /from your email/.test(el("otpErr").textContent) && VERIFY_CALLS.length === 0, el("otpErr").textContent);

  NEXT_VERIFY = { error: { message: "Token has expired or is invalid" } };
  el("otpIn").value = "654321";
  el("verifyBtn").click(); await settle();
  pass("a wrong email code does not sign in", ROUTED === 0 && !("vpShiftStart" in STORE) && /did not match/.test(el("otpErr").textContent));
  pass("and it was checked as an email code", VERIFY_CALLS[0] && VERIFY_CALLS[0].type === "email" && VERIFY_CALLS[0].email === "sam@theroyal.com.au" && !VERIFY_CALLS[0].phone, JSON.stringify(VERIFY_CALLS[0]));

  NEXT_VERIFY = null;
  var before = Date.now();
  el("otpIn").value = "654321";
  el("verifyBtn").click(); await settle();
  var v = VERIFY_CALLS[1] || {};
  pass("the right email code verifies as type email", v.type === "email" && v.token === "654321" && v.email === "sam@theroyal.com.au", JSON.stringify(v));
  pass("it starts a fresh 4 hour shift, exactly as a text code does", +STORE.vpShiftStart >= before && +STORE.vpShiftStart <= Date.now(), STORE.vpShiftStart);
  pass("and goes through the same staff check and routing", ROUTED === 1);

  /* ---- 5. RESEND BY EMAIL ---- */
  el("resendBtn").click(); await settle();
  var last = OTP_CALLS[OTP_CALLS.length - 1];
  pass("Resend on the email code box sends another EMAIL, not a text", !!last && last.email === "sam@theroyal.com.au" && !last.phone && last.options.shouldCreateUser === false, JSON.stringify(last));

  /* ---- 6. EMAIL NOT ON ANY LOGIN ---- */
  reset();
  el("mobileIn").value = "0497 605 423"; NEXT_OTP = SMS_DOWN;
  el("sendCodeBtn").click(); await settle();
  el("emailAltBtn").click(); await settle();
  NEXT_OTP = { error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" } };
  el("emailIn").value = "nobody@example.com";
  el("sendEmailBtn").click(); await settle();
  pass("an email that is on no login is told so, with a way to reach us",
       /not on a VenuePlay login/.test(el("emailErr").textContent) && /hello@venueplay\.com\.au/.test(el("emailErr").textContent), el("emailErr").textContent);
  pass("and stays on the email step", shown("stepEmail") && !shown("stepCode"));
  NEXT_OTP = { error: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" } };
  el("sendEmailBtn").click(); await settle();
  pass("too many emails says wait, not that the email is wrong", /Wait a minute/.test(el("emailErr").textContent), el("emailErr").textContent);
  NEXT_OTP = { error: { status: 500, message: "Error sending magic link email" } };
  el("sendEmailBtn").click(); await settle();
  pass("an email send failure is owned, with the support address", /could not send the email/.test(el("emailErr").textContent) && /hello@venueplay/.test(el("emailErr").textContent), el("emailErr").textContent);

  /* ---- 7. BACK TO TEXT, AND THE TEXT PATH IS UNCHANGED ---- */
  el("backToTextBtn").click(); await settle();
  pass("Use a text code instead goes back to the number", shown("stepMobile") && !shown("stepEmail"));
  NEXT_OTP = null;
  el("mobileIn").value = "0497 605 423";
  el("sendCodeBtn").click(); await settle();
  el("otpIn").value = "111222"; before = Date.now();
  el("verifyBtn").click(); await settle();
  var sv = VERIFY_CALLS[VERIFY_CALLS.length - 1] || {};
  pass("a text code still verifies as type sms against the phone", sv.type === "sms" && sv.phone === "+61497605423" && !sv.email, JSON.stringify(sv));
  pass("and starts the shift and routes the same way", ROUTED === 1 && +STORE.vpShiftStart >= before);

  /* ---- 8. RESEND BY TEXT FAILING ---- */
  reset();
  el("mobileIn").value = "0497 605 423";
  el("sendCodeBtn").click(); await settle();
  NEXT_OTP = SMS_DOWN;
  el("resendBtn").click(); await settle();
  pass("a failed resend says the text failed and points at email, not 'give it a moment'",
       /could not send a text right now/.test(el("otpErr").textContent) && shown("emailAlt"), el("otpErr").textContent);
  pass("Enter in the email box sends the email", (function () {
    el("emailAltBtn").click(); el("emailIn").value = "a@b.com.au"; var n = OTP_CALLS.length; el("emailIn").key("Enter"); return OTP_CALLS.length === n + 1;
  })());

  print("");
  print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
})();
