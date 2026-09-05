/* WHAT A GROUP OWES THAT NOTHING HAS ASKED FOR.
 *
 * venueCanBeCharged returns false for a venue with no founding_id - a grouped venue -
 * and its own comment says "invoiced by hand". That is a deliberate decision and also
 * a leak: the host is never shown the overage consent screen, nothing is charged, and
 * nothing anywhere told anyone the night happened. Invoicing by hand needs somebody to
 * know what to invoice.
 *
 *   jsc venueplay-backend/worker/group-billing.test.js
 */
function findFile(rel){
  var tries=[rel,"../"+rel,"../../"+rel];
  for(var i=0;i<tries.length;i++){ try{ var t=readFile(tries[i]); if(t&&t.length>1000) return tries[i]; }catch(e){} }
  throw new Error("cannot find "+rel);
}
var W  = readFile(findFile("venueplay-backend/worker/venueplay-game.js"));
var HQ = readFile(findFile("venueplay/app/hq.html"));

var pass=0, fail=0, failed=[];
function ok(l,g,d){ if(g){pass++;print("  PASS  "+l+(d?"  ("+d+")":""));} else {fail++;failed.push(l);print("  FAIL  "+l+(d?"  ("+d+")":""));} }

ok("found the real Worker", W.indexOf("handleGroupOverage")>0);

/* THE LEAK IS REAL, AND STILL DELIBERATE. This test would be worthless if somebody
   later "fixed" venueCanBeCharged to charge grouped venues without deciding to. */
ok("a grouped venue is still not auto-charged",
   /if \(!foundingId\) return false;/.test(W),
   "a group is invoiced by hand; that decision stands");

// The report itself.
ok("the report route exists", /path === '\/admin\/group-overage'/.test(W));
ok("it is HQ-admin gated", /handleGroupOverage[\s\S]{0,400}requireScreenAdmin/.test(W));
ok("it only looks at GROUPED venues",
   /group_id=not\.is\.null&founding_id=is\.null/.test(W),
   "a venue with its own account is already charged; counting it here double-counts");
ok("it charges nothing", !/handleGroupOverage[\s\S]{0,3000}stripePost/.test(W),
   "a report that quietly bills is the worst possible version of this");
ok("it prices at the same $2 a head the metered path uses", /over \* 200/.test(W));
ok("the look-back is bounded", /months > 24\) months = 24/.test(W));

// The arithmetic, on real numbers.
function owed(cap, peak){ return (!cap || peak <= cap) ? 0 : (peak - cap) * 200; }
var cases=[
  ["under plan",            80, 60,   0],
  ["exactly on plan",       80, 80,   0],
  ["one over",              80, 81,  200],
  ["twenty over",           80, 100, 4000],
  ["no plan set at all",     0, 100,   0],
];
for(var i=0;i<cases.length;i++){
  var c=cases[i];
  ok("owed: "+c[0], owed(c[1],c[2])===c[3], "$"+(owed(c[1],c[2])/100).toFixed(2)+", want $"+(c[3]/100).toFixed(2));
}
ok("a venue with no plan is not billed for every head",
   owed(0,500)===0, "cap 0 means unknown, not zero allowance");

// HQ end.
ok("HQ has the panel", /id="goRun"/.test(HQ));
ok("and a CSV, because this ends up in an invoice", /group-nights-to-invoice\.csv/.test(HQ));
ok("the panel says nothing has been charged", /Nothing here has been charged/.test(HQ));
ok("gameWorkerGet exists for it", /function gameWorkerGet/.test(HQ));
ok("a missing route reads as missing, not as no results",
   /does not have "\+path\+" yet/.test(HQ),
   "'no group nights' and 'route not deployed' must not look alike");

/* INVOICE BILLING, the other half: a group that will not pay by card. */
ok("collectNow can issue an invoice instead of charging", /collection_method = 'send_invoice'/.test(W) || /send_invoice/.test(W));
ok("terms are required by Stripe and defaulted rather than omitted",
   /days_until_due = Math\.max\(1, Math\.min\(120, parseInt\(acct\.invoice_terms_days/.test(W),
   "Stripe rejects send_invoice without days_until_due");
ok("a PO reference goes on the invoice", /custom_fields\[0\]\[name\]/.test(W),
   "many groups will not pay one without it");
ok("an account without the flag is still charged automatically",
   /body\.collection_method = 'charge_automatically'/.test(W));
ok("the account select carries the invoice columns",
   /select=id,stripe_customer_id,stripe_subscription_id,bill_by_invoice/.test(W),
   "or the flag reads undefined and every group is card-charged anyway");

print("");
if (fail) { print(fail+" OF "+(pass+fail)+" CHECKS FAILED: "+failed.join(", ")); throw new Error(fail+" failed"); }
print("ALL "+pass+" CHECKS PASSED");
