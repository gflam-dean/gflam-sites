/* WHEN A HOST CANNOT SIGN IN, WHOSE FAULT DOES THE SCREEN SAY IT IS?

   Dean, locked out during the Sydney move on 12 Sep 2026: "it came up with We could not send
   a code, check the number or try again. if its our fault should it not be different wording?"

   It should have, and a branch existed to do it. That branch searched the human-readable
   message for "sms" or "phone". What Supabase actually returns when our SMS provider is
   misconfigured is:

       422   sms_send_failed
       "Error sending confirmation OTP to provider: Authentication Error - invalid username"

   There is no "sms" in that sentence. sms_send_failed is a separate field the check never
   read. So the branch could not fire, and a host holding a perfectly good number was told to
   check their number while OUR provider was down. That sends somebody to fix a thing that is
   not broken and hides an outage from us at the same time.

   This runs the real otpSendError against the real errors, including the exact one that
   locked Dean out.

   Run: jsc venueplay-backend/app/signin-blame.test.js */
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
function fnbody(src, name) {
  var m = new RegExp("\\n\\s*function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var APP = find("venueplay/app/index.html");
var body = fnbody(APP, "otpSendError");
pass("the sign-in still decides who to blame in one place", !!body);

// The only DOM it touches is the error line.
var shown = "";
function $(id) { return { set textContent(v) { shown = v; }, get textContent() { return shown; } }; }
eval(body);

function say(err) { shown = ""; otpSendError(err); return shown; }
/* CAREFUL. The "on us" message deliberately contains the words "not your number", so a naive
   search for "your number" matches BOTH answers and the check goes red about the code being
   wrong when it is the detector that is. Found immediately, by the check failing on a fix that
   was correct. Match the instruction each message gives, which is the thing that differs. */
function blamesThem(t) { return /did not look right|check it and try again/i.test(t); }
function blamesUs(t) { return /on us|did not go out|we will get you in/i.test(t); }

/* THE EXACT ERROR THAT LOCKED DEAN OUT. Verbatim from Sydney, 12 Sep 2026. */
var REAL = { status: 422, code: "sms_send_failed",
             message: "Error sending confirmation OTP to provider: Authentication Error - invalid username More information: https://www.twilio.com/docs/errors/20003" };
var t = say(REAL);
pass("the real Sydney failure is owned, not blamed on the host", blamesUs(t) && !blamesThem(t), t);
pass("and it does not tell them to check a number that was fine", !/check the number/i.test(t));
pass("it gives them a way to reach a person", /0497 605 423|hello@venueplay/.test(t), t);

/* The same failure with the code field missing, which is how an older client surfaces it. */
pass("owned even when only the message survives",
     blamesUs(say({ message: REAL.message })), say({ message: REAL.message }));
/* And with only the code, which is how a newer one does. */
pass("owned even when only the code survives",
     blamesUs(say({ code: "sms_send_failed" })));

/* Other failures that are ours. */
["provider_disabled", "unexpected_failure", "hook_timeout"].forEach(function (c) {
  pass("'" + c + "' is ours", blamesUs(say({ code: c })));
});
pass("phone sign-in switched off is ours",
     blamesUs(say({ message: "Unsupported phone provider" })));
pass("a 500 is ours", blamesUs(say({ status: 500, message: "internal error" })));

/* THE ONE CASE THAT IS GENUINELY THEIRS. If this cannot fire, the fix has gone too far the
   other way and a typo'd number gets an apology instead of a correction. */
var typo = say({ status: 400, code: "validation_failed", message: "Invalid phone number format" });
pass("a genuinely invalid number DOES tell them to check it", blamesThem(typo) && !blamesUs(typo), typo);
pass("and an unparseable number too",
     blamesThem(say({ message: "Unable to validate phone number" })));

/* THE DEFAULT WHEN NOTHING IS KNOWN. An unknown failure is ours until proven otherwise: we
   can read our own logs, the host in a noisy pub cannot. */
pass("an unknown failure defaults to ours", blamesUs(say({})), say({}));
pass("so does a network error with no shape at all", blamesUs(say(null)));

/* IT MUST STILL BE ABLE TO SAY BOTH THINGS. A function that answers "ours" to everything
   would pass most of the above and be useless. */
pass("the two answers are actually different sentences",
     say(REAL) !== typo && say(REAL).length > 0 && typo.length > 0);

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
