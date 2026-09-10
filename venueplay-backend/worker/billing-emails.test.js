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
eval(lift(BILL,"vpaLookupDecline"));
pass("insufficient funds is said as insufficient funds", /not enough funds/.test(vpaDeclineReason("insufficient_funds", "Your card has insufficient funds.").line));
pass("an expired card is said as expired", /expired/.test(vpaDeclineReason("expired_card", "").line));
pass("a bank that gave no reason is not blamed on an expired card", /without giving a reason/.test(vpaDeclineReason("do_not_honor", "Your card was declined.").line));
var ours = vpaDeclineReason(null, "There is no `default_payment_method` set on this Customer or Invoice.");
pass("a missing card on OUR invoice is owned as ours, not the venue's card", ours.ours === true && /our side/.test(ours.line), ours.line);
pass("the venue's card is never blamed for the bank's real answer", vpaDeclineReason("insufficient_funds","").ours === false);
pass("an unknown code falls back to the honest generic line", /Nine times out of ten/.test(vpaDeclineReason("something_new", "").line));
pass("the email headline changes when the fault is ours", /why\.ours \? 'A payment did not go through\.' : 'Your card did not go through\.'/.test(BILL));
/* vpaLookupDecline against a fake Stripe, both invoice shapes. */
var asked = [];
function vpbStripeGet(env, path) { asked.push(path); return Promise.resolve({ id: "pi_1", last_payment_error: { decline_code: "insufficient_funds", code: "card_declined", message: "Your card has insufficient funds." } }); }
var got1 = null, got2 = null, got3 = null;
vpaLookupDecline({}, { payment_intent: "pi_1" }).then(function (r) { got1 = r; });
vpaLookupDecline({}, { payments: { data: [{ payment: { payment_intent: "pi_1" } }] } }).then(function (r) { got2 = r; });
vpaLookupDecline({}, {}).then(function (r) { got3 = r; });
Promise.resolve().then(function(){}).then(function(){}).then(function(){}).then(function () {
  pass("old invoice shape: the PaymentIntent is fetched and the decline code read", !!got1 && got1.code === "insufficient_funds", JSON.stringify(got1));
  pass("new invoice shape (payments list): same answer", !!got2 && got2.code === "insufficient_funds", JSON.stringify(got2));
  pass("an invoice with no payment behind it asks Stripe nothing and returns null", got3 === null && asked.length === 2, asked.length + " asked");
  return extrasChecks().then(finish, function (e) { pass("extras checks did not crash", false, String(e && e.message || e)); finish(); });
});

/* EXTRAS THAT THE CARD WOULD NOT PAY FOR. Dean, 11 Sep 2026: try once, tell them, and a small
   amount rides the next subscription invoice; over 10% of the monthly bill stays open to be
   chased now. Runs the real vpaMoveExtrasToMonthly against a fake Stripe and a fake database. */
eval(lift(BILL,"vpaIsExtrasInvoice"));
eval(lift(BILL,"vpaMonthlyBillCents"));
eval(lift(BILL,"vpaMoveExtrasToMonthly"));
eval(lift(BILL,"vpaPaymentFailedNextStep"));
eval(lift(BILL,"vpaFmtDate"));
eval(lift(BILL,"vpaFirePaymentFailedEmail"));
var share = /const VPA_EXTRAS_MOVE_MAX_SHARE = ([0-9.]+);/.exec(BILL);
var VPA_EXTRAS_MOVE_MAX_SHARE = share ? Number(share[1]) : NaN;
pass("the 10% line is one named number", VPA_EXTRAS_MOVE_MAX_SHARE === 0.10, String(VPA_EXTRAS_MOVE_MAX_SHARE));

pass("an invoice we raised by hand is an extras invoice", vpaIsExtrasInvoice({ billing_reason: "manual" }) === true);
pass("a renewal is not", vpaIsExtrasInvoice({ billing_reason: "subscription_cycle" }) === false);
pass("the first subscription invoice is not", vpaIsExtrasInvoice({ billing_reason: "subscription_create" }) === false);
pass("no billing_reason at all reads as extras (never as the subscription)", vpaIsExtrasInvoice({}) === true);

var monthlySub = { status: "active", current_period_end: 1790812800, items: { data: [
  { quantity: 1, price: { unit_amount: 5000, recurring: { interval: "month", interval_count: 1 } } } ] } };
var annualSub = { status: "active", current_period_end: 1790812800, items: { data: [
  { quantity: 1, price: { unit_amount: 60000, recurring: { interval: "year", interval_count: 1 } } } ] } };
var twoLineSub = { status: "active", items: { data: [
  { quantity: 1, price: { unit_amount: 1000, recurring: { interval: "month" } } },
  { quantity: 4, price: { unit_amount: 250, recurring: { interval: "month" } } } ] } };
pass("a $50 monthly plan is $50 a month", vpaMonthlyBillCents(monthlySub) === 5000);
pass("a $600 annual plan is $50 a month", vpaMonthlyBillCents(annualSub) === 5000);
pass("plan plus 4 players adds up", vpaMonthlyBillCents(twoLineSub) === 2000, String(vpaMonthlyBillCents(twoLineSub)));

var stripe = { posts: [], gets: [], deletes: [], sub: monthlySub, freshStatus: "open", voidAnswer: null, itemAnswer: null, acct: { id: "acct-1", stripe_subscription_id: "sub_JESS" } };
var audits = [];
vpbStripeGet = function (env, path) {
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
    pass("$2.00 against a $50 plan MOVES onto the monthly bill", r.moved === true, JSON.stringify(r));
    var item = stripe.posts[0], voided = stripe.posts[1];
    pass("the line is re-added as a pending item on the SUBSCRIPTION, same words, same money", !!item && item.path === "invoiceitems"
      && item.body.customer === "cus_JESS" && item.body.subscription === "sub_JESS" && item.body.quantity === 1
      && item.body.unit_amount_decimal === "200" && item.body.description === "The Jolly Jess - Extra Player - 11/09/2026"
      && !("unit_amount" in item.body), JSON.stringify(item));
    pass("the re-added item is keyed on the failed invoice, so a repeat cannot double it", !!item && item.idem === "roll_in_JESS1_0");
    pass("THEN the failed invoice is voided, keyed too", !!voided && voided.path === "invoices/in_JESS1/void" && voided.idem === "void_in_JESS1" && stripe.posts.length === 2);
    pass("the venue is told the date it will come out", r.next === "1 October 2026", String(r.next));
    var a = audits.filter(function (x) { return x.row.action === "extras_moved_to_monthly"; })[0];
    pass("HQ can see it happened", !!a && a.row.detail.invoice === "in_JESS1" && a.row.detail.amount_cents === 200 && a.row.detail.monthly_cents === 5000, JSON.stringify(a));
    pass("nothing was deleted on the happy path", stripe.deletes.length === 0);

    reset({ sub: { status: "active", current_period_end: 1790812800, items: { data: [{ quantity: 1, price: { unit_amount: 1000, recurring: { interval: "month" } } }] } } });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("$2.00 against a $10 plan is over 10% and STAYS OPEN to be chased now", r.moved === false && /over 10%/.test(r.why), JSON.stringify(r));
    pass("nothing was created or voided when it stays open", stripe.posts.length === 0 && stripe.deletes.length === 0, stripe.posts.length + " posts");
    reset({ sub: annualSub });
    return vpaMoveExtrasToMonthly({}, jessExtras);
  }).then(function (r) {
    pass("an annual venue is judged on the monthly equivalent, $2 of $50 moves", r.moved === true, JSON.stringify(r));
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
    var openHtml = vpaPaymentFailedNextStep({ moved: false, why: "over 10%" }, "https://pay.example/x", "https://venueplay.com.au/app/billing.html");
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
    return vpaFirePaymentFailedEmail(envR, extrasInv, { moved: true, next: "1 October 2026" }).then(function () {
      var h = sent[0] && sent[0].body.html;
      pass("REAL email, extras moved: names the $2.00 line, says next subscription payment on 1 October 2026, no button", !!h && /\$2\.00 for The Jolly Jess - Extra Player - 11\/09\/2026/.test(h) && /next subscription payment on 1 October 2026/.test(h) && !/Pay now/.test(h) && !/pause/.test(h), h ? h.slice(0, 400) : "no email");
      return vpaFirePaymentFailedEmail(envR, extrasInv, { moved: false, why: "over 10%" });
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
    /* The webhook wiring: extras leave BEFORE the strike count, so they can never pause a venue. */
    var handler = BILL.slice(BILL.indexOf("event.type === 'invoice.payment_failed'"), BILL.indexOf("event.type === 'customer.subscription.updated'"));
    var atExtras = handler.indexOf("vpaIsExtrasInvoice(inv)"), atStrike = handler.indexOf("vpaFailuresBeforeSuspend(plan)"), atReturn = handler.indexOf("return new Response('ok'");
    pass("the payment_failed handler sends extras to the mover and RETURNS before counting strikes", atExtras > -1 && atReturn > atExtras && atStrike > atReturn, [atExtras, atReturn, atStrike].join(","));
    pass("the mover's answer reaches the email", /vpaFirePaymentFailedEmail\(env, inv, moved\)/.test(handler));
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

/* The summary is called from the END of the async decline chain above, so it is the last line
   printed, which is the line release-check reads. */
function finish(){ print(""); print(bad?(bad+" OF "+ran+" FAILED"):("ALL "+ran+" CHECKS PASSED")); }
