/* EVERY STRIPE CALL THAT MOVES MONEY CARRIES AN IDEMPOTENCY KEY.

   WHY THIS IS A SUITE AND NOT A NOTE. Without a key, two requests that race
   both do the work: two tabs on the billing page, an owner and an HQ admin on
   View as, one impatient double click, or a webhook Stripe delivers twice. Each
   creates its own charge, credit or reversal. NOTHING DOWNSTREAM EVER SHOWS IT:
   the subscription quantity converges to the right number either way, so the
   venue's plan looks correct and only the invoice is wrong. It is found by a
   venue reading their bill, which is the worst way to find it.

   Three were already fixed one at a time (the overage charge, the player
   release credit, and this file's own three on 10 Sep 2026). Fixing them one at
   a time is how the fourth gets written. This makes an unkeyed money call
   FAIL THE GATE instead.

   HOW IT CHECKS. It does not grep for the word. It finds every vpbStripePost(
   call in the billing Worker, walks the source balancing brackets, quotes and
   template literals to split the real arguments, works out which Stripe
   endpoint is being posted to, and requires a FOURTH argument on any endpoint
   that moves money. Argument counting is the actual property: passing a key is
   a positional argument, and no text search can tell a 3-argument call from a
   4-argument one that happens to mention the word "key".

   Run: jsc venueplay-backend/worker/stripe-idempotency.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var BILL = find("venueplay-backend/worker/venueplay-api-FULL.js");

/* Endpoints that MOVE MONEY. A balance transaction is a credit or a debit on
   the customer; an invoiceitem is a line that will be charged; a coupon changes
   what every future invoice comes to. Everything else vpbStripePost is used for
   (a billing portal session, cancel_at_period_end, a subscription item's
   quantity) is a SETTING: doing it twice lands in the same place, so a key
   would buy nothing. */
function movesMoney(path) {
  return /balance_transactions/.test(path) || /\binvoiceitems\b/.test(path) || /\bcoupons\b/.test(path);
}

/* Split a call's arguments at the TOP level only. A key is a positional
   argument, so the count is the whole question, and the arguments here contain
   object literals, nested calls, strings with commas in them and regexes. */
function splitArgs(src, open) {
  var depth = 0, args = [], cur = "", q = null, i = open;
  for (; i < src.length; i++) {
    var c = src[i], prev = src[i - 1];
    if (q) {                                  // inside a string: only its own closer ends it
      cur += c;
      if (c === q && prev !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; if (depth === 1 && c === "(") { continue; } cur += c; continue; }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) { args.push(cur); return { args: args, end: i }; }
      cur += c; continue;
    }
    if (c === "," && depth === 1) { args.push(cur); cur = ""; continue; }
    cur += c;
  }
  return null;                                 // unbalanced: caller reports it
}

function lineOf(src, idx) { return src.slice(0, idx).split("\n").length; }

print("\nSTRIPE CALLS THAT MOVE MONEY");
var re = /vpbStripePost\s*\(/g, m, calls = [], unparsed = 0;
while ((m = re.exec(BILL))) {
  var open = m.index + m[0].length - 1;
  var got = splitArgs(BILL, open);
  if (!got) { unparsed++; continue; }
  calls.push({ line: lineOf(BILL, m.index), args: got.args, n: got.args.length });
  re.lastIndex = got.end;
}
pass("every vpbStripePost call could be read", unparsed === 0,
     unparsed ? unparsed + " call(s) could not be parsed, so they were NOT checked" : calls.length + " call(s)");
pass("the billing Worker still makes Stripe calls at all", calls.length >= 10,
     calls.length + " found");   // a rename would otherwise make this suite pass by checking nothing

var money = [], naked = [];
for (var i = 0; i < calls.length; i++) {
  var c = calls[i], path = c.args[1] || "";
  if (!movesMoney(path)) continue;
  money.push(c);
  // A fourth argument that is literally null/undefined is NOT a key.
  var key = (c.args[3] || "").trim();
  if (c.n < 4 || key === "" || key === "null" || key === "undefined") naked.push(c.line);
}
pass("money calls were actually found, so this suite is checking something", money.length >= 5,
     money.length + " call(s) move money");
pass("every money call carries an idempotency key",
     naked.length === 0,
     naked.length ? "UNKEYED at line(s) " + naked.join(", ") + ": two racing requests both charge"
                  : money.length + " keyed");

/* A key must be the SAME for the two requests that race, which means it can
   only be built from the thing being paid for. Date.now(), a random value or a
   crypto id differ between the two attempts, so Stripe sees two different keys
   and does the work twice: a key that cannot collide cannot deduplicate. */
var unstable = [];
for (var j = 0; j < money.length; j++) {
  var k = (money[j].args[3] || "");
  if (/Date\.now|Math\.random|crypto\.randomUUID|randomUUID|performance\.now/.test(k)) unstable.push(money[j].line);
}
pass("no key is built from the clock or a random value", unstable.length === 0,
     unstable.length ? "line(s) " + unstable.join(", ") + " make a NEW key each attempt, which deduplicates nothing" : "");

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("stripe idempotency: " + bad + " failed");
