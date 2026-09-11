/* The two billing emails, rendered from the real functions, against Jess's real invoice. */
var bad=0, ran=0;
function pass(n,c,x){ if(typeof n!=="string")throw new Error("name first");
  if(typeof c!=="boolean")throw new Error("condition must be a boolean: "+n);
  ran++; print((c?"  ok   ":"  FAIL ")+n+(x?"   "+x:"")); if(!c)bad++; }
function find(rel){ var t=[rel,"../"+rel]; for(var i=0;i<t.length;i++){ try{var s=readFile(t[i]); if(s&&s.length>500) return s;}catch(e){} } throw new Error("cannot find "+rel); }
function lift(src,name){ var m=new RegExp("(?:async\\s+)?function\\s+"+name+"\\s*\\(").exec(src); if(!m)return null;
  var i=src.indexOf("{",m.index),d=0; for(var j=i;j<src.length;j++){ if(src[j]==="{")d++; else if(src[j]==="}"){d--; if(!d) return src.slice(m.index,j+1);} } return null; }
var BILL=find("venueplay-backend/worker/venueplay-api-FULL.js");
var GAME=find("venueplay-backend/worker/venueplay-game.js");
var abn=/const VP_ABN = '([^']+)'/.exec(BILL);
pass("the ABN is defined once in the Worker", !!abn, abn?abn[1]:"not found");
var VP_ABN = abn?abn[1]:"";
eval(lift(BILL,"vpaEsc"));
eval(lift(BILL,"vpaInvoiceLinesHtml"));
eval(lift(BILL,"vpaTaxSummaryHtml"));
/* The receipt and the helpers it calls. These must be lifted at TOP LEVEL: an eval inside a
   function does not leak its declarations. Twice: first inside receiptChecks, then inside a
   forEach callback, which is also a function. Plain statements at top level, like the ones
   above. The failures both times read "not sent: Can't find variable: ...", which was the new
   instrumentation correctly reporting a fault in the suite that was testing it. */
eval(lift(BILL,"vpaOverageFromInvoice"));
eval(lift(BILL,"vpaUpliftNoticeHtml"));
eval(lift(BILL,"vpaUpliftWarningHtml"));
eval(lift(BILL,"vpaFireInvoiceEmail"));
eval(lift(BILL,"vpaFirePlanUpliftEmail"));
var VPA_CANCEL_ALERTS = (function(){ var m=/VPA_CANCEL_ALERTS = (\[[^\]]*\])/.exec(BILL); return m?JSON.parse(m[1].replace(/'/g,'"')):[]; })();
eval(lift(BILL,"vpaFireCancelAlert"));
eval(lift(BILL,"vpaSendEmail"));

// Jess's actual invoice, as Stripe returned it.
var jess = { amount_paid: 1000, number: "9FGBRAJG-0008", lines: { data: [
  { description: "Not jess: 1 extra player, full month", amount: 250 },
  { description: "Not jess: 1 extra player, full month", amount: 250 },
  { description: "The Jolly Jess: 1 extra player, full month", amount: 250 },
  { description: "1 Player × Founding Membership (Monthly) (at $2.50 / month)", amount: 250 }
]}};

var lines = vpaInvoiceLinesHtml(jess);
pass("every line on her bill is listed", (lines.match(/full month/g)||[]).length === 3,
     "found " + ((lines.match(/full month/g)||[]).length) + " of the 3 extra-player lines");
pass("the subscription line is there too", lines.indexOf("Founding Membership") !== -1);
pass("each venue is named, which is what a group account needs", lines.indexOf("Not jess") !== -1 && lines.indexOf("The Jolly Jess") !== -1);
/* Count the AMOUNT CELLS, not the string. The subscription line's own description
   contains "(at $2.50 / month)", so a naive search finds five and the check failed on
   its own sloppiness rather than on anything wrong with the email. */
var cells = (lines.match(/>\$2\.50<\/td>/g)||[]).length;
pass("the amounts add up to what she paid", cells === 4,
     "found " + cells + " amount cells at $2.50; four of them make the $10.00");

var tax = vpaTaxSummaryHtml(jess);
pass("GST is shown", tax.indexOf("GST") !== -1);
pass("GST is the INCLUSIVE component, $0.91 of $10", tax.indexOf("$0.91") !== -1,
     "prices include GST, so it is total/11, not 10% added on top");
pass("the ex-GST subtotal is $9.09", tax.indexOf("$9.09") !== -1);
pass("the total paid is $10.00", tax.indexOf("$10.00") !== -1);
pass("it calls itself a tax invoice", tax.toLowerCase().indexOf("tax invoice") !== -1);
pass("the ABN is on it", tax.indexOf(VP_ABN) !== -1);

pass("a $0 trial invoice gets no tax block at all",
     vpaTaxSummaryHtml({ amount_paid: 0, lines:{data:[]} }) === "");
pass("an invoice with no lines does not render an empty table",
     vpaInvoiceLinesHtml({ lines: { data: [] } }) === "");


print("\nTRANSPARENCY ABOUT THE AUTOMATIC UPGRADE");
eval(lift(BILL,"vpaUpliftNoticeHtml"));

var upgraded = { amount_paid: 900, lines: { data: [
  { description: "The Jolly Jess - Extra Player - 04/10/2026 (3rd big night, plan moved up)", amount: 300 },
  { description: "1 Player \u00d7 Founding Membership (Monthly)", amount: 250 }
]}};
var notice = vpaUpliftNoticeHtml(upgraded);
pass("an invoice that upgraded the plan says so", notice.indexOf("plan has moved up") !== -1);
pass("it explains WHY that night was half price", notice.toLowerCase().indexOf("half price") !== -1);
pass("it says the rate per player has not changed", notice.indexOf("rate per player has not changed") !== -1);
pass("and that it starts from the next invoice", notice.indexOf("next invoice") !== -1);

var ordinary = { amount_paid: 600, lines: { data: [
  { description: "The Jolly Jess - Extra Player - 2026-09-27", amount: 600 }
]}};
pass("an ordinary big night does NOT claim the plan moved", vpaUpliftNoticeHtml(ordinary) === "",
     "a venue told its plan changed when it did not is worse than saying nothing");
pass("a plain subscription invoice says nothing about upgrades",
     vpaUpliftNoticeHtml({ lines: { data: [{ description: "1 Player x Founding Membership", amount: 250 }] } }) === "");

print("\nTHE DECLINED-CARD EMAIL SAYS WHAT THE BANK SAID");
/* 11 Sep 2026: a venue read "Nine times out of ten it is an expired card" twice. The bank had said
   insufficient funds once, and once the fault was ours (no card on the invoice). */
eval(lift(BILL,"vpaDeclineReason"));
eval(lift(BILL,"vpaPaymentIntentOf"));
eval(lift(BILL,"vpaLookupDecline"));
pass("insufficient funds is said as insufficient funds", /not enough funds/.test(vpaDeclineReason("insufficient_funds", "Your card has insufficient funds.").line));
pass("an expired card is said as expired", /expired/.test(vpaDeclineReason("expired_card", "").line));
pass("a bank that gave no reason is not blamed on an expired card", /without giving a reason/.test(vpaDeclineReason("do_not_honor", "Your card was declined.").line));
var ours = vpaDeclineReason(null, "There is no `default_payment_method` set on this Customer or Invoice.");
pass("a missing card on OUR invoice is owned as ours, not the venue's card", ours.ours === true && /our side/.test(ours.line), ours.line);
pass("the venue's card is never blamed for the bank's real answer", vpaDeclineReason("insufficient_funds","").ours === false);
/* Dean, 11 Sep 2026: "it cant be wrong". The old fallback ("Nine times out of ten it is an expired
   card") was a guess a paying venue read twice when the bank had said something else. */
var unknown = vpaDeclineReason("something_new", "").line;
pass("an unknown code says the bank did not say why, and claims nothing", /did not say why/.test(unknown) && !/expired/.test(unknown), unknown);
pass("no code at all says the same", /did not say why/.test(vpaDeclineReason(null, null).line));
pass("the guessing line is gone from the Worker", !/Nine times out of ten it is an expired card\.'\)/.test(BILL));
pass("the email headline changes when the fault is ours", /why\.ours \? 'A payment did not go through\.' : 'Your card did not go through\.'/.test(BILL));
/* vpaLookupDecline against a fake Stripe, both invoice shapes. */
var asked = [];
var PI_ANSWER = { id: "pi_1", last_payment_error: { decline_code: "insufficient_funds", code: "card_declined", message: "Your card has insufficient funds." } };
/* What the third live Jess run found: the void cancelled the intent and Stripe cleared its error.
   The charge still says what the bank said. */
var PI_CANCELLED = { id: "pi_void", status: "canceled", cancellation_reason: "void_invoice", last_payment_error: null,
  latest_charge: { id: "ch_1", status: "failed", failure_code: "payment_method_provider_decline", outcome: { reason: "partner_insufficient_funds", type: "issuer_declined" },
                   failure_message: "The customer has insufficient funds with the payment provider." } };
/* The shape the live webhook payload had on 11 Sep 2026: an invoice with an id and NO payment on it.
   Stripe answers the expand with the payments list; the bare id alone is not enough. */
var stripeInvoices = { "in_live": { id: "in_live", payments: { data: [{ payment: { payment_intent: "pi_1" } }] } },
                       "in_nopay": { id: "in_nopay", payments: { data: [] } } };
/* Named, because the extras checks below install their own vpbStripeGet at load time, before any
   of these promises run; that fake hands decline lookups back here. */
function declineStripeGet(env, path) {
  asked.push(path);
  if (/^payment_intents\/pi_void/.test(path)) return Promise.resolve(PI_CANCELLED);
  if (/^payment_intents\//.test(path)) return Promise.resolve(PI_ANSWER);
  var m = /^invoices\/(in_[a-z]+)\?expand\[\]=payments$/.exec(path);
  if (m) return Promise.resolve(stripeInvoices[m[1]] || { error: { message: "no such invoice" } });
  if (/^invoice_payments\?invoice=/.test(path)) return Promise.resolve({ data: [] });
  return Promise.resolve({ error: { message: "unexpected " + path } });
}
var vpbStripeGet = declineStripeGet;
var got1 = null, got2 = null, got3 = null, got4 = null, got5 = null;
vpaLookupDecline({}, { payment_intent: "pi_1" }).then(function (r) { got1 = r; });
vpaLookupDecline({}, { payments: { data: [{ payment: { payment_intent: "pi_1" } }] } }).then(function (r) { got2 = r; });
vpaLookupDecline({}, {}).then(function (r) { got3 = r; });
var askedBefore4;
Promise.resolve().then(function(){}).then(function(){}).then(function(){}).then(function () {
  pass("old invoice shape: the PaymentIntent is fetched and the decline code read", !!got1 && got1.code === "insufficient_funds", JSON.stringify(got1));
  pass("new invoice shape (payments list): same answer", !!got2 && got2.code === "insufficient_funds", JSON.stringify(got2));
  pass("an invoice with no id and no payment asks Stripe nothing and returns null", got3 === null && asked.length === 2, asked.length + " asked");
  askedBefore4 = asked.length;
  return vpaLookupDecline({}, { id: "in_live", customer: "cus_JESS" });
}).then(function (r) {
  got4 = r;
  var mine = asked.slice(askedBefore4);
  pass("THE LIVE SHAPE (id, no payment on the payload): the invoice is fetched with its payments and the bank's code comes back",
       !!got4 && got4.code === "insufficient_funds", JSON.stringify(got4));
  pass("by asking for the invoice with payments expanded, then the PaymentIntent",
       JSON.stringify(mine) === JSON.stringify(["invoices/in_live?expand[]=payments", "payment_intents/pi_1?expand[]=latest_charge"]), JSON.stringify(mine));
  askedBefore4 = asked.length;
  return vpaLookupDecline({}, { id: "in_nopay" });
}).then(function (r) {
  got5 = r;
  pass("an invoice Stripe says has no payments at all returns null (the email then says the bank did not say why)", got5 === null, JSON.stringify(got5));
  pass("after also trying the invoice_payments list", asked.slice(askedBefore4).some(function (p) { return /^invoice_payments\?invoice=in_nopay/.test(p); }), JSON.stringify(asked.slice(askedBefore4)));
  return vpaLookupDecline({}, { payment_intent: "pi_void" });
}).then(function (r) {
  pass("AFTER THE VOID (intent cancelled, its error cleared): the bank's answer is read off the charge instead",
       !!r && r.code === "partner_insufficient_funds" && /insufficient funds/.test(r.message), JSON.stringify(r));
  pass("and that answer reads as insufficient funds in the email", /not enough funds/.test(vpaDeclineReason(r && r.code, r && r.message).line));
  pass("the handler reads the bank's answer BEFORE the mover voids the invoice, and hands it to the email",
       /const decline = await vpaLookupDecline\(env, inv\);\s*const moved = await vpaMoveExtrasToMonthly\(env, inv\);\s*if \(!moved\.already\) await vpaFirePaymentFailedEmail\(env, inv, moved, decline\);/.test(BILL));
  // The receipt checks run AFTER these, and only the last thing in the chain calls
  // finish(). Run in parallel they raced it: finish() printed the old total of 82 and
  // the nine receipt checks never appeared at all. A suite that silently drops checks
  // is the same fault as one that fakes them.
  return extrasChecks()
    .then(receiptChecks, function (e) { pass("extras checks did not crash", false, String(e && e.message || e)); return receiptChecks(); })
    .then(upliftEmailChecks, function (e) { pass("receipt checks did not crash", false, String(e && e.message || e)); return upliftEmailChecks(); })
    .then(cancelAlertChecks, function (e) { pass("uplift email checks did not crash", false, String(e && e.message || e)); return cancelAlertChecks(); })
    .then(finish, function (e) { pass("cancel alert checks did not crash", false, String(e && e.message || e)); finish(); });
});

/* EXTRAS THAT THE CARD WOULD NOT PAY FOR. Dean, 11 Sep 2026: try once, tell them, and a small
   amount (up to $30) rides the next subscription invoice; over $30 stays open to be
   chased now. Runs the real vpaMoveExtrasToMonthly against a fake Stripe and a fake database. */
eval(lift(BILL,"vpaIsExtrasInvoice"));
eval(lift(BILL,"vpaMoveExtrasToMonthly"));
eval(lift(BILL,"vpaPaymentFailedNextStep"));
eval(lift(BILL,"vpaFmtDate"));
eval(lift(BILL,"vpaFirePaymentFailedEmail"));
var limit = /const VPA_EXTRAS_MOVE_MAX_CENTS = ([0-9]+);/.exec(BILL);
var VPA_EXTRAS_MOVE_MAX_CENTS = limit ? Number(limit[1]) : NaN;
pass("the line is $30, one named number (Dean, 11 Sep 2026)", VPA_EXTRAS_MOVE_MAX_CENTS === 3000, String(VPA_EXTRAS_MOVE_MAX_CENTS));

pass("an invoice we raised by hand is an extras invoice", vpaIsExtrasInvoice({ billing_reason: "manual" }) === true);
pass("a renewal is not", vpaIsExtrasInvoice({ billing_reason: "subscription_cycle" }) === false);
pass("the first subscription invoice is not", vpaIsExtrasInvoice({ billing_reason: "subscription_create" }) === false);
pass("no billing_reason at all reads as extras (never as the subscription)", vpaIsExtrasInvoice({}) === true);

var monthlySub = { status: "active", current_period_end: 1790812800, items: { data: [
  { quantity: 1, price: { unit_amount: 5000, recurring: { interval: "month", interval_count: 1 } } } ] } };
var annualSub = { status: "active", current_period_end: 1790812800, items: { data: [
  { quantity: 1, price: { unit_amount: 60000, recurring: { interval: "year", interval_count: 1 } } } ] } };

var stripe = { posts: [], gets: [], deletes: [], sub: monthlySub, freshStatus: "open", voidAnswer: null, itemAnswer: null, acct: { id: "acct-1", stripe_subscription_id: "sub_JESS" } };
var audits = [];
vpbStripeGet = function (env, path) {
  if (/^payment_intents\/|expand\[\]=payments|^invoice_payments\?/.test(path)) return declineStripeGet(env, path);
  stripe.gets.push(path);
  if (/^invoices\//.test(path)) return Promise.resolve({ id: path.split("/")[1], status: stripe.freshStatus });
  if (/^subscriptions\//.test(path)) return Promise.resolve(stripe.sub);
  return Promise.resolve({ error: { message: "unexpected GET " + path } });
};
function vpbStripePost(env, path, body, idem) {
  stripe.posts.push({ path: path, body: body, idem: idem });
  if (path === "invoiceitems") return Promise.resolve(stripe.itemAnswer || { id: "ii_" + stripe.posts.length });
  if (/\/void$/.test(path)) return Promise.resolve(stripe.voidAnswer || { id: path.split("/")[1], status: "void" });
  return Promise.resolve({ error: { message: "unexpected POST " + path } });
}
function vpbStripeDelete(env, path) { stripe.deletes.push(path); return Promise.resolve({ deleted: true }); }
function vpaSelect(env, table, q) { return Promise.resolve(table === "venueplay_founding" && stripe.acct ? [stripe.acct] : []); }
function vpaInsert(env, table, row) { audits.push({ table: table, row: row }); return Promise.resolve(); }
function reset(over) { stripe.posts = []; stripe.gets = []; stripe.deletes = []; audits = []; stripe.freshStatus = "open"; stripe.voidAnswer = null; stripe.itemAnswer = null; stripe.sub = monthlySub; stripe.acct = { id: "acct-1", stripe_subscription_id: "sub_JESS" }; for (var k in (over||{})) stripe[k] = over[k]; }
var jessExtras = { id: "in_JESS1", customer: "cus_JESS", currency: "aud", amount_due: 200, billing_reason: "manual", status: "open",
  lines: { data: [{ amount: 200, quantity: 1, description: "The Jolly Jess - Extra Player - 11/09/2026" }] } };

function extrasChecks() {
  reset();
  return vpaMoveExtrasToMonthly({}, jessExtras).then(function (r) {
    pass("$2.00 of extras MOVES onto the monthly bill", r.moved === true, JSON.stringify(r));
    var item = stripe.posts[0], voided = stripe.posts[1];
    pass("the line is re-added as a pending item on the SUBSCRIPTION, same words, same money", !!item && item.path === "invoiceitems"
      && item.body.customer === "cus_JESS" && item.body.subscription === "sub_JESS" && item.body.quantity === 1
      && item.body.unit_amount_decimal === "200" && item.body.description === "The Jolly Jess - Extra Player - 11/09/2026"
      && !("unit_amount" in item.body), JSON.stringify(item));
    pass("the re-added item is keyed on the failed invoice, so a repeat cannot double it", !!item && item.idem === "roll_in_JESS1_0");
    pass("THEN the failed invoice is voided, keyed too", !!voided && voided.path === "invoices/in_JESS1/void" && voided.idem === "void_in_JESS1" && stripe.posts.length === 2);
    pass("the venue is told the date it will come out", r.next === "1 October 2026", String(r.next));
    var a = audits.filter(function (x) { return x.row.action === "extras_moved_to_monthly"; })[0];
    pass("HQ can see it happened", !!a && a.row.detail.invoice === "in_JESS1" && a.row.detail.amount_cents === 200 && a.row.detail.limit_cents === 3000, JSON.stringify(a));
    pass("nothing was deleted on the happy path", stripe.deletes.length === 0);

    reset();
    return vpaMoveExtrasToMonthly({}, Object.assign({}, jessExtras, { amount_due: 3200, lines: { data: [{ amount: 3200, quantity: 16, description: "Big Night - Extra Player - 12/09/2026" }] } }));
  }).then(function (r) {
    pass("$32.00 of extras is over the $30 line and STAYS OPEN to be chased now", r.moved === false && /over the \$30 line/.test(r.why), JSON.stringify(r));
    pass("nothing was created or voided when it stays open", stripe.posts.length === 0 && stripe.deletes.length === 0, stripe.posts.length + " posts");
    reset();
    return vpaMoveExtrasToMonthly({}, Object.assign({}, jessExtras, { amount_due: 3000, lines: { data: [{ amount: 3000, quantity: 15, description: "Big Night - Extra Player - 12/09/2026" }] } }));
  }).then(function (r) {
    pass("$30.00 exactly still moves, 15 players at $2.00 each", r.moved === true && stripe.posts[0].body.quantity === 15 && stripe.posts[0].body.unit_amount_decimal === "200", JSON.stringify(r) + JSON.stringify(stripe.posts[0]));
    reset({ sub: annualSub });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("an annual venue's extras move the same way", r.moved === true, JSON.stringify(r));
    // Stripe's 2025 API shape: the renewal date lives on the item, not the subscription. This is
    // what live Stripe returned for Jess on 11 Sep 2026 and the email went out with no date.
    reset({ sub: { status: "active", items: { data: [{ quantity: 1, current_period_end: 1790812800, price: { unit_amount: 1000, recurring: { interval: "month" } } }] } } });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("the renewal date is read off the subscription ITEM when Stripe puts it there (live shape)", r.moved === true && r.next === "1 October 2026", JSON.stringify(r));
    reset({ freshStatus: "void" });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("the same event delivered twice does nothing the second time (Stripe's live status wins over the copy in the event)", r.moved === false && r.already === true && stripe.posts.length === 0, JSON.stringify(r));
    reset({ voidAnswer: { error: { message: "You cannot void this invoice." } } });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("if the void fails the re-added items come straight back off, so they never owe it twice", r.moved === false && stripe.deletes.length === 1 && /invoiceitems\/ii_/.test(stripe.deletes[0]), JSON.stringify(r) + " " + JSON.stringify(stripe.deletes));
    reset({ itemAnswer: { error: { message: "Received unknown parameter: nope" } } });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("if Stripe refuses the item nothing is voided", r.moved === false && !stripe.posts.some(function (p) { return /void$/.test(p.path); }), JSON.stringify(r));
    reset({ acct: { id: "acct-1", stripe_subscription_id: null } });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("a customer with no subscription keeps the open invoice", r.moved === false && stripe.posts.length === 0, JSON.stringify(r));
    reset();
    return vpaMoveExtrasToMonthly({}, { id: "in_X", customer: "cus_JESS", amount_due: 0, billing_reason: "manual" });
  }).then(function (r) {
    pass("nothing owed, nothing done, and Stripe is not even asked", r.moved === false && stripe.gets.length === 0);

    /* The email's middle paragraph, all three cases. */
    var movedHtml = vpaPaymentFailedNextStep({ moved: true, next: "1 October 2026" }, "https://pay.example/x", "https://venueplay.com.au/app/billing.html");
    pass("moved: says it will come out on the next subscription payment, with the date", /next subscription payment on 1 October 2026/.test(movedHtml) && /Nothing to do/.test(movedHtml));
    pass("moved: NO pay-now button (that invoice is void, its link is dead)", !/Pay now/.test(movedHtml) && !/pay\.example/.test(movedHtml));
    pass("moved: never threatens to pause games", !/pause/.test(movedHtml));
    var openHtml = vpaPaymentFailedNextStep({ moved: false, why: "over the $30 line" }, "https://pay.example/x", "https://venueplay.com.au/app/billing.html");
    pass("stayed open: pay-now button, we will try again, and no talk of games pausing", /Pay now/.test(openHtml) && /try the card again/.test(openHtml) && !/pause/.test(openHtml));
    var subHtml = vpaPaymentFailedNextStep(undefined, "https://pay.example/x", "https://venueplay.com.au/app/billing.html");
    pass("subscription: the pause warning and the button stay exactly as they were", /games will pause/.test(subHtml) && /Pay now/.test(subHtml));

    /* The whole email, built by the real function against a fake Resend. */
    var sent = [];
    fetch = function (url, opts) { sent.push({ url: url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
    var envR = { RESEND_API_KEY: "re_fake", SITE_URL: "https://venueplay.com.au" };
    var extrasInv = { id: "in_JESS1", customer_email: "jess@example.com", amount_due: 200, billing_reason: "manual", hosted_invoice_url: "https://pay.example/x",
      lines: { data: [{ description: "The Jolly Jess - Extra Player - 11/09/2026", amount: 200 }] } };
    var subInv = { id: "in_SUB", customer_email: "jess@example.com", amount_due: 1000, billing_reason: "subscription_cycle", hosted_invoice_url: "https://pay.example/y",
      lines: { data: [{ description: "1 x Founding Membership", amount: 1000 }] } };
    audits = [];
    return vpaFirePaymentFailedEmail(envR, extrasInv, { moved: true, next: "1 October 2026" }).then(function () {
      var h = sent[0] && sent[0].body.html;
      var rec = audits.filter(function (x) { return x.row.action === "payment_failed_email"; })[0];
      pass("every placeholder that went into the email is written down (amount, what, reason, outcome, date, sent)", !!rec
        && rec.row.detail.to === "jess@example.com" && rec.row.detail.amount === "$2.00" && rec.row.detail.what === "The Jolly Jess - Extra Player - 11/09/2026"
        && typeof rec.row.detail.reason_line === "string" && rec.row.detail.outcome === "moved to next invoice" && rec.row.detail.next === "1 October 2026" && rec.row.detail.sent === true, JSON.stringify(rec));
      pass("REAL email, extras moved: names the $2.00 line, says next subscription payment on 1 October 2026, no button", !!h && /\$2\.00 for The Jolly Jess - Extra Player - 11\/09\/2026/.test(h) && /next subscription payment on 1 October 2026/.test(h) && !/Pay now/.test(h) && !/pause/.test(h), h ? h.slice(0, 400) : "no email");
      return vpaFirePaymentFailedEmail(envR, extrasInv, { moved: false, why: "over the $30 line" });
    }).then(function () {
      var h = sent[1] && sent[1].body.html;
      pass("REAL email, extras kept open: pay-now to Stripe's page, no pause threat", !!h && /Pay now/.test(h) && /pay\.example\/x/.test(h) && !/pause/.test(h));
      return vpaFirePaymentFailedEmail(envR, subInv);
    }).then(function () {
      var h = sent[2] && sent[2].body.html;
      pass("REAL email, subscription: for your VenuePlay subscription, the pause warning, the button", !!h && /for your VenuePlay subscription/.test(h) && /games will pause/.test(h) && /Pay now/.test(h));
    }).then(webhookWiring);
  });
}
function webhookWiring() {
    /* The webhook wiring: extras go to the mover and the strike count is the ELSE branch, so they
       can never pause a venue. And nothing returns early: the first version did, and both live
       extras events on 11 Sep 2026 were left with completed_at null, a second email waiting to
       happen on Stripe's retry. */
    var handler = BILL.slice(BILL.indexOf("event.type === 'invoice.payment_failed'"), BILL.indexOf("event.type === 'customer.subscription.updated'"));
    var atExtras = handler.indexOf("vpaIsExtrasInvoice(inv)"), atStrike = handler.indexOf("vpaFailuresBeforeSuspend(plan)");
    var extrasBranch = /if \(vpaIsExtrasInvoice\(inv\)\) \{[\s\S]*?\} else \{/.exec(handler);
    pass("the payment_failed handler sends extras to the mover and counts strikes only in the ELSE branch", atExtras > -1 && atStrike > atExtras && !!extrasBranch, [atExtras, atStrike, !!extrasBranch].join(","));
    pass("the extras branch does not return out of the handler (the event must reach vpaFinishStripeEvent)", !!extrasBranch && !/return /.test(extrasBranch[0]), extrasBranch && extrasBranch[0]);
    pass("no return anywhere in the payment_failed handler", !/return /.test(handler));
    pass("the mover's answer reaches the email", /vpaFirePaymentFailedEmail\(env, inv, moved, decline\)/.test(handler));
}

print("\nTHE NEW INVOICE LINE FORMAT");
pass("the big night line is quantity x unit price, not one lump",
     /quantity: overage,/.test(GAME) && /unit_amount_decimal: String\(Math\.round\(rateDollars \* 100\)\)/.test(GAME),
     "so the invoice shows 3 x $2.00 rather than a single figure");
pass("and it names the venue and the night",
     /description: \(venue\.name \|\| 'Venue'\) \+ ' - Extra Player - ' \+ when/.test(GAME));
pass("the plan-change line does the same in the billing Worker",
     /quantity: n, unit_amount_decimal: String\(Math\.round\(rate \* 100\)\)/.test(BILL));
pass("neither Worker sends a top-level unit_amount (Stripe has none on an invoice item and refused the first live charge)",
     !/unit_amount: /.test(GAME.replace(/\/\*[\s\S]*?\*\//g, "")) && !/unit_amount: /.test(BILL.replace(/\/\*[\s\S]*?\*\//g, "")));


print("\nTHE DATE ON THE LINE IS THE NIGHT THEY PLAYED, IN AUSTRALIAN ORDER");
eval(lift(GAME,"brisbaneNightKey"));
function au(ms){ return brisbaneNightKey(ms).split('-').reverse().join('/'); }

var sat9pm   = Date.parse('2026-09-12T11:00:00Z');   // Sat 12 Sep, 9pm Brisbane
var sweep3am = Date.parse('2026-09-12T17:00:00Z');   // Sun 13 Sep, 3am Brisbane
var sat1am   = Date.parse('2026-09-12T15:30:00Z');   // Sun 13 Sep 1:30am Brisbane, still Saturday night

pass("a date reads day/month/year", /^\d{2}\/\d{2}\/\d{4}$/.test(au(sat9pm)), au(sat9pm));
pass("a Saturday night is dated Saturday", au(sat9pm) === "12/09/2026");
pass("a 1:30am finish is still that Saturday night", au(sat1am) === "12/09/2026",
     "the 2am rollover, so a late finish is not billed as the next day");
pass("and it is NOT dated from when the sweep ran", au(sat9pm) !== au(sweep3am),
     "the 3am sweep would have labelled Saturday's game " + au(sweep3am));
/* There used to be a regex here demanding `Date.parse(session.opened_at || session.started_at`
   in the game Worker. That text WAS the live bug: it sat inside applyOverageCharge, which has no
   `session`, and threw on every active venue. The regex was green the whole time. The date now
   comes from o.openedAt and overage-charge.test.js RUNS the charge for a Saturday night swept
   on Sunday and reads the date off the Stripe request. Behaviour there, not text here. */
pass("the billing Worker also uses Brisbane, not UTC",
     /Date\.now\(\) \+ 36000000/.test(BILL));

/* ---- THE RECEIPT, RUN. Dean, 11 Sep 2026, after three real charges collected:
   "so the reciept was never sent to jess we just charged it? I thought you said
   everything worked". The honest answer was that nobody could tell, because the
   receipt path sent the mail and wrote nothing down, while the FAILURE path wrote a
   row with the recipient, the amount and Resend's id. Three payments took money and
   left no evidence a receipt existed either way.

   So now every exit is recorded, and this runs the real function to prove it: a
   send, a refusal, a missing key, a missing address. "It returned early" and "it
   sent" must never look the same from the outside. */
/* THE PLAN-CHANGE EMAIL, RUN. Dean asked for this in the morning and it did not exist
   by the evening, by which time a venue's plan had moved from 1 player to 2 and nothing
   told her. Untested email code is exactly what put the receipt in the state it was in
   tonight, so this runs the real function rather than asserting it exists. */
/* THE CANCELLATION ALERT, RUN. Wellshot Hotel cancelled eight hours after signing up
   and nobody knew for twenty-four days. This is the email that would have said so. */
function cancelAlertChecks() {
  var sent = [], rows = [];
  vpaInsert = function (env, t, row) { rows.push(row); return Promise.resolve(); };
  fetch = function (url, opts) { sent.push({ url: url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: "re_c" }); } }); };
  var ENV = { RESEND_API_KEY: "k", SITE_URL: "https://venueplay.com.au" };
  var VENUE = { venueId: "v9", name: "Wellshot Hotel", slug: "wellshot-hotel",
                ends: "18 September 2026", players: 20, monthly: "$40.02" };

  pass("both addresses are on the list", VPA_CANCEL_ALERTS.length === 2 &&
       VPA_CANCEL_ALERTS.indexOf("dean@venueplay.com.au") >= 0 &&
       VPA_CANCEL_ALERTS.indexOf("hello@venueplay.com.au") >= 0,
       VPA_CANCEL_ALERTS.join(", "));

  return vpaFireCancelAlert(ENV, VENUE).then(function () {
    pass("a cancellation emails both of them", sent.length === 2,
         sent.length + " sent");
    if (sent.length) {
      var h = sent[0].body.html || "";
      pass("the subject names the venue", /Wellshot Hotel has cancelled/.test(sent[0].body.subject), sent[0].body.subject);
      pass("it says when they stop", h.indexOf("18 September 2026") >= 0, "so you know how long you have to call");
      pass("and what it is worth", h.indexOf("$40.02") >= 0 && h.indexOf("20") >= 0);
      pass("with the ABN in the footer", h.indexOf("35 679 383 049") >= 0);
    }
    var r = rows.filter(function (x) { return x.action === "venue_cancel_alert"; });
    pass("the alert is recorded", r.length === 1 && r[0].detail.outcome === "sent" && r[0].detail.sent === 2,
         r.length ? JSON.stringify(r[0].detail) : "nothing written");

    sent = []; rows = [];
    return vpaFireCancelAlert(ENV, Object.assign({}, VENUE, { undo: true }));
  }).then(function () {
    pass("un-cancelling is good news and also worth knowing", sent.length === 2 &&
         /UN-cancelled/.test(sent[0].body.subject), sent.length ? sent[0].body.subject : "");

    sent = []; rows = [];
    return vpaFireCancelAlert({ SITE_URL: "x" }, VENUE);
  }).then(function () {
    var r = rows.filter(function (x) { return x.action === "venue_cancel_alert"; });
    pass("no Resend key is recorded, not swallowed",
         sent.length === 0 && r.length === 1 && /no Resend key/.test(r[0].detail.outcome),
         r.length ? r[0].detail.outcome : "nothing written");
  });
}

function upliftEmailChecks() {
  var sent = [], rows = [];
  var venues = [{ id: "v1", name: "The Jolly Jess" }];
  var upliftRow = { id: "aud1", target: "venue:v1", created_at: new Date().toISOString(),
                    detail: { from: 1, to: 2, nights: [2,2,2], effective: "next_invoice" } };
  var world = { already: [] };
  vpaSelect = function (env, table, q) {
    if (table === "venueplay_founding") return Promise.resolve([{ id: "f1", contact_email: world.email === null ? null : (world.email || "jess@example.com") }]);
    if (table === "vp_venues") return Promise.resolve(venues);
    if (/plan_uplift_after_three_big_nights/.test(q)) return Promise.resolve(world.noUplift ? [] : [upliftRow]);
    if (/plan_uplift_email/.test(q)) return Promise.resolve(world.already);
    return Promise.resolve([]);
  };
  vpaInsert = function (env, t, row) { rows.push(row); return Promise.resolve(); };
  fetch = function (url, opts) { sent.push({ url: url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: "re_u" }); } }); };
  var ENV = { RESEND_API_KEY: "k", SITE_URL: "https://venueplay.com.au" };

  return vpaFirePlanUpliftEmail(ENV, "cus_1").then(function () {
    pass("a plan uplift sends its own email", sent.length === 1, sent.length + " sent");
    if (sent.length) {
      var h = sent[0].body.html || "";
      pass("the subject says the plan moved", /plan has moved up/i.test(sent[0].body.subject), sent[0].body.subject);
      pass("it names the old and new limit", h.indexOf(">1<") >= 0 && h.indexOf(">2<") >= 0);
      pass("and says when it starts", /next invoice/i.test(h), "so nobody thinks they are charged today");
      pass("and that tonight was charged at half rate", /half the usual rate/i.test(h));
    }
    var r = rows.filter(function (x) { return x.action === "plan_uplift_email"; });
    pass("the send is recorded against the uplift row", r.length === 1 && r[0].detail.uplift_row === "aud1" && r[0].detail.sent === true,
         r.length ? JSON.stringify(r[0].detail) : "nothing written");

    // Stripe redelivers, and setPlayers raises the same event. Neither may email twice.
    world.already = [{ id: "x", detail: { uplift_row: "aud1" } }];
    sent = []; rows = [];
    return vpaFirePlanUpliftEmail(ENV, "cus_1");
  }).then(function () {
    pass("a second delivery of the same event says nothing", sent.length === 0 && rows.length === 0,
         sent.length + " sent, " + rows.length + " written");
    world.already = []; world.noUplift = true; sent = []; rows = [];
    return vpaFirePlanUpliftEmail(ENV, "cus_1");
  }).then(function () {
    pass("an ordinary quantity change is silent", sent.length === 0 && rows.length === 0,
         "setPlayers and addVenue raise the same event");
    world.noUplift = false; world.email = null; sent = []; rows = [];
    return vpaFirePlanUpliftEmail(ENV, "cus_1");
  }).then(function () {
    var r = rows.filter(function (x) { return x.action === "plan_uplift_email"; });
    pass("no contact email is recorded, not swallowed",
         sent.length === 0 && r.length === 1 && /no contact email/.test(r[0].detail.outcome),
         r.length ? r[0].detail.outcome : "nothing written");
  });
}

function receiptChecks() {
  var sent = [];                       // the decline block's `sent` is scoped to itself
  var paid = { id: "in_1", number: "9FGBRAJG-0018", customer: "cus_1",
               customer_email: "jess@example.com", amount_paid: 100,
               lines: { data: [{ description: "Extra Player", amount: 100, quantity: 1 }] } };

  function run(env, inv, reply) {
    audits.length = 0; sent.length = 0;
    fetch = function (url, opts) {
      sent.push({ url: url, body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve(reply || { ok: true, json: function () { return Promise.resolve({ id: "re_1" }); } });
    };
    return vpaFireInvoiceEmail(env, inv);
  }
  var ENV = { RESEND_API_KEY: "re_key", SITE_URL: "https://venueplay.com.au" };

  // RETURNED, not just started. Without this the caller got undefined, finish() ran
  // immediately and printed the old total while these nine checks were still pending.
  return run(ENV, paid).then(function () {
    var r = audits.filter(function (a) { return a.row.action === "invoice_receipt_email"; });
    pass("a paid invoice sends a receipt", sent.length === 1 && /api\.resend\.com/.test(sent[0].url));
    pass("and it is RECORDED, so nobody has to ask the customer", r.length === 1,
         JSON.stringify(audits.map(function (a) { return a.row.action; })));
    pass("naming who, how much, and Resend's id",
         r.length === 1 && r[0].row.detail.to === "jess@example.com" &&
         r[0].row.detail.sent === true && r[0].row.detail.resend_id === "re_1" &&
         r[0].row.detail.outcome === "sent",
         r.length ? JSON.stringify(r[0].row.detail) : "");
    pass("and the invoice it is a receipt FOR",
         r.length === 1 && r[0].row.detail.invoice === "in_1" && r[0].row.detail.number === "9FGBRAJG-0018");

    // Resend refuses it. The money was still taken, so this must be loud in the data.
    return run(ENV, paid, { ok: false, status: 422, json: function () { return Promise.resolve({}); } });
  }).then(function () {
    var r = audits.filter(function (a) { return a.row.action === "invoice_receipt_email"; });
    pass("a refused receipt is recorded as NOT sent",
         r.length === 1 && r[0].row.detail.sent === false && /refused/.test(r[0].row.detail.outcome),
         r.length ? JSON.stringify(r[0].row.detail) : "");

    // The quiet exits. These are the ones that used to be indistinguishable from success.
    return run({ SITE_URL: "x" }, paid);
  }).then(function () {
    var r = audits.filter(function (a) { return a.row.action === "invoice_receipt_email"; });
    pass("no Resend key says so instead of returning in silence",
         r.length === 1 && /no Resend key/.test(r[0].row.detail.outcome) && sent.length === 0,
         r.length ? r[0].row.detail.outcome : "nothing was written");
    return run(ENV, { id: "in_2", customer: "cus_1", amount_paid: 200, customer_email: null,
                      lines: { data: [] } });
  }).then(function () {
    var r = audits.filter(function (a) { return a.row.action === "invoice_receipt_email"; });
    pass("a customer with no email address says so too",
         r.length === 1 && /no email address/.test(r[0].row.detail.outcome) && sent.length === 0,
         r.length ? r[0].row.detail.outcome : "nothing was written");
    return run(ENV, { id: "in_3", customer: "cus_1", customer_email: "a@b.c", amount_paid: 0,
                      lines: { data: [] } });
  }).then(function () {
    pass("a $0 trial invoice sends nothing and writes nothing",
         sent.length === 0 && audits.length === 0,
         "a receipt for nothing would be noise, not evidence");
  });
}

/* The summary is called from the END of the async decline chain above, so it is the last line
   printed, which is the line release-check reads. */
function finish(){ print(""); print(bad?(bad+" OF "+ran+" FAILED"):("ALL "+ran+" CHECKS PASSED")); }
