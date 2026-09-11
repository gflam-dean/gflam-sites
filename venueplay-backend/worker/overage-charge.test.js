/* THE OVERAGE CHARGE, RUN TO THE STRIPE CALL.

   On 11 Sep 2026 a real night was opened at The Jolly Jess with one player over the cap,
   the host approved it, a round was played and the night closed. Stripe never heard a
   word: no item, no invoice, no audit row, streak still 0. applyOverageCharge read
   `session.opened_at` and has no `session`; the ReferenceError was swallowed by the
   "billing never blocks close" catch in both callers. A trialing venue tested a minute
   earlier PASSED, because it returned before reaching the line. Every suite in the repo
   was green, because the sweep suite fakes chargeNightOverage and nothing ran the real one.

   So this suite lifts chargeNightOverage, applyOverageCharge and everything they call out
   of the shipped Worker and runs them against a fake Supabase and a fake Stripe that
   record every request. The claims are about HTTP: what was POSTed to Stripe, with what
   body and what idempotency key, and what was patched on the venue afterwards. A thrown
   error anywhere in the path is a failed check, never a quiet night.

   Run: jsc venueplay-backend/worker/overage-charge.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var NAMES = ["chargeNightOverage", "applyOverageCharge", "playerIdsWhoPlayed", "countPlayersWhoPlayed",
             "countPlayers", "overageCeiling", "brisbaneNightKey", "venueInFreeMonth", "openInvoice", "settleInvoice",
             "stripeGet", "stripePost", "recordOverageCrash", "subscriptionPaymentMethod"];
var missing = NAMES.filter(function (n) { return !lift(GAME, n); });
pass("every function in the charge path came out of the shipped Worker", missing.length === 0, missing.join(", "));
if (missing.length) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }
var consts = /const OVERAGE_ACK_MARGIN = (\d+);[\s\S]*?const OVERAGE_ABSOLUTE_MAX = (\d+);/.exec(GAME);
pass("the approval margin constants came out too", !!consts);

/* jsc has no URLSearchParams; the Worker builds every Stripe body with one. */
function URLSearchParams() { this._p = []; }
URLSearchParams.prototype.set = function (k, v) { this._p = this._p.filter(function (kv) { return kv[0] !== k; }); this._p.push([k, String(v)]); };
URLSearchParams.prototype.toString = function () { return this._p.map(function (kv) { return encodeURIComponent(kv[0]) + "=" + encodeURIComponent(kv[1]); }).join("&"); };

/* ---- the fake world ------------------------------------------------------------- */
var logged = [];
var console = { log: function (m) { logged.push(String(m)); } };
var world, posts, patches, inserts, gets;
function enc(x) { return encodeURIComponent(x); }
function reset(w) {
  world = w; posts = []; patches = []; inserts = []; gets = []; logged = [];
}
function sbGet(env, table, query) {
  gets.push(table + "?" + query);
  var rows = world.tables[table] || [];
  var m = /(?:^|&)(id|session_id|game_id)=eq\.([^&]+)/.exec(query);
  if (m) rows = rows.filter(function (r) { return String(r[m[1]]) === decodeURIComponent(m[2]); });
  var inn = /(?:^|&)game_id=in\.\(([^)]*)\)/.exec(query);
  if (inn) { var ids = inn[1].split(","); rows = rows.filter(function (r) { return ids.indexOf(String(r.game_id)) !== -1; }); }
  return Promise.resolve(rows.map(function (r) { return Object.assign({}, r); }));
}
function sbGetAll(env, table, query) { return sbGet(env, table, query); }
function sbPatch(env, table, query, body) { patches.push({ table: table, query: query, body: body }); return Promise.resolve([]); }
function sbInsert(env, table, obj) { inserts.push({ table: table, row: obj }); return Promise.resolve([]); }
function upliftPlan(env, venue, acct, newMax) { world.uplifts = (world.uplifts || 0) + 1; return Promise.resolve(world.upliftResult === undefined ? newMax : world.upliftResult); }
function fetch(url, opts) {
  var path = url.replace("https://api.stripe.com/v1/", "");
  var method = (opts && opts.method) || "GET";
  var headers = (opts && opts.headers) || {};
  var body = {};
  if (opts && opts.body) opts.body.split("&").forEach(function (kv) { var p = kv.split("="); body[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
  var reply;
  if (method === "GET" && /^subscriptions\//.test(path)) reply = world.sub;
  else if (method === "GET" && /^customers\//.test(path)) reply = world.customer || { id: "cus_JESS", invoice_settings: { default_payment_method: null }, default_source: null };
  else if (method === "POST" && path === "invoiceitems") {
    posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] });
    /* Stripe refuses a parameter it does not know, and the whole item with it. This is the
       documented list for POST /v1/invoiceitems (docs.stripe.com/api/invoiceitems/create, read
       11 Sep 2026). `unit_amount` is NOT on it, and that is exactly what the first live overage
       night sent. */
    var known = ["amount", "currency", "customer", "customer_account", "description", "discountable", "discounts", "invoice",
                 "metadata", "period", "price_data", "pricing", "quantity", "quantity_decimal", "subscription",
                 "tax_behavior", "tax_code", "tax_rates", "unit_amount_decimal"];
    var unknown = Object.keys(body).filter(function (k) { return known.indexOf(k.replace(/\[.*$/, "")) === -1; });
    if (unknown.length) reply = { error: { message: "Received unknown parameter: " + unknown[0] } };
    else if (body.invoice !== undefined && body.invoice !== "in_test") reply = { error: { message: "No such invoice: " + body.invoice } };
    else if (body.invoice !== undefined && body.subscription !== undefined) reply = { error: { message: "You may not specify both invoice and subscription" } };
    else if (body.unit_amount_decimal !== undefined && body.quantity === undefined && body.quantity_decimal === undefined) reply = { error: { message: "unit_amount_decimal needs a quantity" } };
    else reply = world.itemReply || { id: "ii_test", object: "invoiceitem" };
  }
  else if (method === "POST" && path === "invoices") { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.invoiceReply || { id: "in_test", amount_due: 200, status: "draft" }; }
  else if (method === "POST" && /^invoices\/in_test\/finalize$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.finalizeReply || { id: "in_test", status: "open" }; }
  else if (method === "POST" && /^invoices\/in_test\/pay$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.payReply || { id: "in_test", status: "paid" }; }
  else if (method === "POST" && /^invoices\/in_test\/send$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.sendReply || { id: "in_test", status: "open" }; }
  else if (method === "POST" && /^invoices\/in_test\/void$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = { id: "in_test", status: "void" }; }
  else reply = { error: { message: "unexpected call " + method + " " + path } };
  return Promise.resolve({ ok: !reply.error, status: reply.error ? 400 : 200, json: function () { return Promise.resolve(reply); } });
}

["session", "venue", "sub", "acct", "o", "founding", "peak", "cap"].forEach(function (n) {
  pass("nothing in this suite is called `" + n + "` (it would mask a scope bug in the Worker)", typeof this[n] === "undefined");
}, this);

/* Bring the real code in. eval at top level so the functions land in this scope. */
eval("var OVERAGE_ACK_MARGIN = " + consts[1] + "; var OVERAGE_ABSOLUTE_MAX = " + consts[2] + ";\n" +
     NAMES.map(function (n) { return lift(GAME, n); }).join("\n"));

var ENV = { STRIPE_SECRET_KEY: "sk_test_fake", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k" };
var VENUE = "85af218f-cc7f-45c3-a0ab-4213ab332943", FOUNDING = "16699b83-2217-4dcd-8d9d-e33d2feaa681";
var SESSION = "00e5daab-e52b-41b2-b596-6720f566db70", GAMEID = "3ab65c93-7516-4b93-8f69-d1691229f1c9";
var OLD = new Date(Date.now() - 45 * 86400000).toISOString();   // venue created 45 days ago: out of the free month

function night(o) {
  o = o || {};
  var players = [], cards = [];
  for (var i = 0; i < (o.players || 2); i++) {
    players.push({ id: "p" + i, session_id: SESSION, device_id: "dev" + i, kicked: false });
    if (!o.nobodyPlayed) cards.push({ game_id: GAMEID, player_id: "p" + i });
  }
  return {
    sub: o.sub || { id: "sub_1", status: "active", customer: "cus_JESS", metadata: { tier: "founding" }, items: { data: [{ id: "si_1", quantity: 1 }] },
                    default_payment_method: o.subCard === undefined ? "pm_JESS_CARD" : o.subCard },
    customer: o.customer,
    tables: {
      vp_venues: [{ id: VENUE, name: "The Jolly Jess", founding_id: FOUNDING, max_players: 1, pending_players: null,
                    overage_streak: o.streak || 0, overage_streak_peaks: o.peaks || [], overage_streak_day: o.streakDay || null,
                    created_at: o.createdAt || OLD }],
      venueplay_founding: [{ id: FOUNDING, stripe_customer_id: "cus_JESS", stripe_subscription_id: "sub_1",
                             bill_by_invoice: !!o.byInvoice, invoice_terms_days: o.terms || null, invoice_reference: o.ref || null }],
      vp_players: players,
      vp_games: o.noGames ? [] : [{ id: GAMEID, session_id: SESSION }],
      vp_cards: cards,
      vp_trivia_answers: [],
    },
    upliftResult: o.upliftResult,
  };
}
/* Named mkSession, not session, ON PURPOSE. A helper called `session` sat in this scope and the
   Worker's `session.opened_at` (the live bug) resolved to a property of the helper instead of
   throwing, and the suite passed with the bug reinstated. Nothing in this file may be called
   session, venue, sub, acct or o. */
function mkSession(o) {
  o = o || {};
  return { id: SESSION, venue_id: VENUE, plan_cap_at_start: o.cap === undefined ? 1 : o.cap, status: "finished",
           opened_at: o.openedAt || "2026-09-10T20:20:39.455+00:00",   // 06:20 Brisbane on 11 Sep, so the bill says 11/09/2026
           overage_approved: o.approved === undefined ? true : o.approved,
           overage_approved_count: o.approvedCount === undefined ? 2 : o.approvedCount };
}
/* Run the REAL entry point the way both callers do, but a throw is a red check here,
   not a swallowed one. */
function run(sess, label) {
  var threw = null;
  return chargeNightOverage(ENV, sess).catch(function (e) { threw = e; }).then(function () {
    pass(label + ": the charge path did not throw", threw === null, threw ? String(threw && (threw.stack || threw.message) || threw).slice(0, 160) : "");
  });
}
function item() { return posts.filter(function (p) { return p.path === "invoiceitems"; }); }
function invoice() { return posts.filter(function (p) { return p.path === "invoices"; }); }
function step(name) { return posts.filter(function (p) { return p.path === "invoices/in_test/" + name; }); }
function order() { return posts.map(function (p) { return p.path.replace("invoices/in_test/", ""); }); }
function afterInvoice() { var i = posts.map(function (p) { return p.path; }).indexOf("invoices"); return posts.slice(i + 1).map(function (p) { return p.path.replace("invoices/in_test/", ""); }); }
function venuePatch() { return patches.filter(function (p) { return p.table === "vp_venues"; }); }

var steps = [];
function scenario(name, fn) { steps.push(function () { print("\n" + name); return fn(); }); }

/* 1. THE NIGHT THAT FAILED LIVE. */
scenario("an active founding venue, one over a cap of one, host approved", function () {
  reset(night({ players: 2 }));
  return run(mkSession(), "active").then(function () {
    var it = item();
    pass("exactly one invoice item was POSTed to Stripe", it.length === 1, it.length + " posted");
    if (!it.length) return;
    var b = it[0].body;
    pass("for the right customer", b.customer === "cus_JESS", b.customer);
    pass("quantity 1", b.quantity === "1", "quantity=" + b.quantity);
    pass("unit $2.00 as unit_amount_decimal (the parameter Stripe documents)", b.unit_amount_decimal === "200", "unit_amount_decimal=" + b.unit_amount_decimal);
    pass("no top-level unit_amount (Stripe refuses it; it did, live, on 11 Sep 2026)", b.unit_amount === undefined, "unit_amount=" + b.unit_amount);
    pass("no lump `amount` field", b.amount === undefined, "amount=" + b.amount);
    pass("described as \"The Jolly Jess - Extra Player - 11/09/2026\"", b.description === "The Jolly Jess - Extra Player - 11/09/2026", JSON.stringify(b.description));
    pass("not attached to the subscription (it must get its own invoice)", b.subscription === undefined, "subscription=" + b.subscription);
    /* Live, 11 Sep 2026: the second Jess night raised $4.00 because 'include' swept the $2.00 the
       webhook had just moved onto her monthly bill. The line now goes ON an invoice opened empty. */
    pass("the line is put ON the night's invoice by id", b.invoice === "in_test", "invoice=" + b.invoice);
    pass("keyed on the session so a double close cannot double charge", it[0].idem === "overage_" + SESSION, it[0].idem);
    var inv = invoice();
    pass("an invoice was opened to collect it now", inv.length === 1, inv.length + " raised");
    pass("the invoice is opened BEFORE the line exists, then the line, then finalise, then pay, and nothing else",
         JSON.stringify(order()) === JSON.stringify(["invoices", "invoiceitems", "finalize", "pay"]), JSON.stringify(order()));
    if (inv.length) {
      pass("the invoice EXCLUDES anything else waiting on the customer", inv[0].body.pending_invoice_items_behavior === "exclude", inv[0].body.pending_invoice_items_behavior);
      pass("and is not left to Stripe's clock while still empty", inv[0].body.auto_advance === "false", "auto_advance=" + inv[0].body.auto_advance);
      pass("and charges the card", inv[0].body.collection_method === "charge_automatically", inv[0].body.collection_method);
      /* Checkout puts the card on the subscription; the customer's own default is empty; a
         standalone invoice looks only at the customer. Live night three was refused for this. */
      pass("the subscription's card is named on the invoice (the customer has no default)", inv[0].body.default_payment_method === "pm_JESS_CARD", "default_payment_method=" + inv[0].body.default_payment_method);
      pass("keyed too", inv[0].idem === "inv_overage_" + SESSION, inv[0].idem);
      /* Stripe leaves a new invoice as a DRAFT and gets to it about an hour later. The first
         live night that got this far sat as a $2.00 draft with nothing taken. */
      pass("the invoice is finalised and PAID on the night, in that order, and nothing else",
           JSON.stringify(afterInvoice()) === JSON.stringify(["invoiceitems", "finalize", "pay"]), JSON.stringify(afterInvoice()));
      pass("both steps keyed on the session", !!(step("finalize")[0] && step("finalize")[0].idem === "fin_overage_" + SESSION &&
           step("pay")[0] && step("pay")[0].idem === "pay_overage_" + SESSION));
      pass("and it said PAID in the log", logged.some(function (l) { return /PAID: invoice in_test 2\.00 AUD, 1 x 2\.00/.test(l); }), logged.join(" | "));
    }
    var vp = venuePatch();
    pass("the streak advanced to 1 with tonight's peak", vp.length === 1 && vp[0].body.overage_streak === 1 && String(vp[0].body.overage_streak_peaks) === "2",
         vp.length ? JSON.stringify(vp[0].body) : "no venue patch");
    pass("streak day is the Brisbane night", vp.length === 1 && vp[0].body.overage_streak_day === brisbaneNightKey(Date.now()));
    /* A SUCCESSFUL CHARGE MUST LEAVE A ROW WE CAN QUERY. This used to assert the exact
       opposite - that nothing was written - and that is why vp_admin_audit held six
       overage_invoice_unpaid rows and not one paid row on 11 Sep 2026. The only record of
       the first overage ever collected was in Stripe. */
    var okRow = inserts.filter(function (i) { return i.row.action === "overage_charged"; });
    pass("a successful charge writes an overage_charged row", okRow.length === 1,
         JSON.stringify(inserts.map(function (i) { return i.row.action; })));
    pass("naming the invoice, the money and how many were over",
         okRow.length === 1 && okRow[0].row.detail.invoice === "in_test" &&
         okRow[0].row.detail.amount_cents === 200 && okRow[0].row.detail.players_over === 1,
         okRow.length ? JSON.stringify(okRow[0].row.detail) : "");
    pass("and nothing failed", inserts.filter(function (i) { return /unpaid|failed|crashed|pending/.test(i.row.action); }).length === 0,
         JSON.stringify(inserts.map(function (i) { return i.row.action; })));
  });
});

/* 2. QUANTITY FOLLOWS THE CROWD. */
scenario("three over the cap", function () {
  reset(night({ players: 4 }));
  return run(mkSession({ approvedCount: 4 }), "3 over").then(function () {
    var b = item()[0] && item()[0].body;
    pass("quantity 3 x $2.00", !!b && b.quantity === "3" && b.unit_amount_decimal === "200", JSON.stringify(b));
  });
});

/* 3. THE FREE MONTH, BOTH DEFINITIONS. */
scenario("subscription still trialing", function () {
  reset(night({ sub: { id: "sub_1", status: "trialing", customer: "cus_MB", metadata: { tier: "founding" }, items: { data: [{ quantity: 1 }] } } }));
  return run(mkSession(), "trialing").then(function () {
    pass("nothing POSTed to Stripe", posts.length === 0, posts.length + " posts");
    pass("streak untouched", venuePatch().length === 0);
    pass("it said why", logged.some(function (l) { return /trialing/.test(l); }));
  });
});
scenario("venue created 10 days ago", function () {
  reset(night({ createdAt: new Date(Date.now() - 10 * 86400000).toISOString() }));
  return run(mkSession(), "free month").then(function () {
    pass("nothing POSTed to Stripe", posts.length === 0);
    pass("streak untouched", venuePatch().length === 0);
  });
});

/* 4. NO APPROVAL, NO CHARGE. */
scenario("host never tapped OK", function () {
  reset(night());
  return run(mkSession({ approved: false }), "unapproved").then(function () {
    pass("nothing POSTed to Stripe", posts.length === 0);
    pass("no streak", venuePatch().length === 0);
  });
});

/* 5. INSIDE THE CAP RESETS A RUN. */
scenario("a quiet night after two big ones", function () {
  reset(night({ players: 1, streak: 2, peaks: [2, 3], streakDay: "2026-09-09" }));
  return run(mkSession({ cap: 1, approvedCount: 1 }), "quiet").then(function () {
    pass("nothing POSTed", posts.length === 0);
    var vp = venuePatch();
    pass("streak reset to 0", vp.length === 1 && vp[0].body.overage_streak === 0, vp.length ? JSON.stringify(vp[0].body) : "no patch");
  });
});

/* 6. THIRD BIG NIGHT: $1 AND THE PLAN MOVES UP. */
scenario("third consecutive big night", function () {
  reset(night({ players: 3, streak: 2, peaks: [3, 2], streakDay: "2026-09-09" }));
  return run(mkSession({ approvedCount: 3 }), "third").then(function () {
    var b = item()[0] && item()[0].body;
    pass("the plan was moved up", world.uplifts === 1, world.uplifts + " uplifts");
    pass("charged 2 x $1.00", !!b && b.quantity === "2" && b.unit_amount_decimal === "100", JSON.stringify(b));
    pass("the line says so", !!b && /plan moved up/.test(b.description), b && b.description);
    var vp = venuePatch();
    pass("streak reset after the uplift", vp.length === 1 && vp[0].body.overage_streak === 0, vp.length ? JSON.stringify(vp[0].body) : "");
  });
});
scenario("third big night but the uplift did not happen", function () {
  reset(night({ players: 3, streak: 2, peaks: [3, 2], streakDay: "2026-09-09", upliftResult: null }));
  return run(mkSession({ approvedCount: 3 }), "third, no uplift").then(function () {
    var b = item()[0] && item()[0].body;
    pass("charged the full $2.00, not the discount", !!b && b.unit_amount_decimal === "200", JSON.stringify(b));
    var vp = venuePatch();
    pass("streak kept, not reset", vp.length === 1 && vp[0].body.overage_streak === 3, vp.length ? JSON.stringify(vp[0].body) : "");
  });
});

/* 7. STRIPE SAYS NO: AUDIT ROW, STREAK UNTOUCHED. */
scenario("Stripe refuses the invoice item", function () {
  var w = night(); w.itemReply = { error: { message: "card declined" } }; reset(w);
  return run(mkSession(), "declined").then(function () {
    var a = inserts.filter(function (i) { return i.row.action === "overage_charge_failed"; });
    pass("an overage_charge_failed audit row was written", a.length === 1);
    pass("naming the venue and the money", a.length === 1 && a[0].row.target === VENUE && a[0].row.detail.amount_cents === 200, a.length ? JSON.stringify(a[0].row.detail) : "");
    pass("the empty invoice that was opened for it is voided, keyed", step("void").length === 1 && step("void")[0].idem === "void_overage_" + SESSION, JSON.stringify(order()));
    pass("and never finalised or paid", step("finalize").length === 0 && step("pay").length === 0);
    pass("streak untouched", venuePatch().length === 0);
  });
});
scenario("the invoice cannot be opened", function () {
  var w = night(); w.invoiceReply = { error: { message: "no payment method" } }; reset(w);
  return run(mkSession(), "no invoice").then(function () {
    var a = inserts.filter(function (i) { return i.row.action === "overage_left_pending_until_renewal"; });
    pass("an overage_left_pending_until_renewal audit row was written", a.length === 1);
    var b = item()[0] && item()[0].body;
    pass("the line was still created, tied to the SUBSCRIPTION so it rides the renewal and nothing else",
         !!b && b.subscription === "sub_1" && b.invoice === undefined, JSON.stringify(b));
    pass("the streak still advanced (the night was real and the item exists)", venuePatch().length === 1 && venuePatch()[0].body.overage_streak === 1);
  });
});

scenario("the card is on the customer, not the subscription", function () {
  reset(night({ subCard: null, customer: { id: "cus_JESS", invoice_settings: { default_payment_method: "pm_CUSTOMER_CARD" } } }));
  return run(mkSession(), "customer card").then(function () {
    var inv = invoice()[0] && invoice()[0].body;
    pass("the customer's default is used instead", !!inv && inv.default_payment_method === "pm_CUSTOMER_CARD", inv && inv.default_payment_method);
    pass("and paid", step("pay").length === 1);
  });
});
scenario("no card anywhere", function () {
  var w = night({ subCard: null }); w.payReply = { error: { message: "There is no `default_payment_method` set on this Customer or Invoice." } }; reset(w);
  return run(mkSession(), "no card").then(function () {
    var inv = invoice()[0] && invoice()[0].body;
    pass("no card is guessed onto the invoice", !!inv && inv.default_payment_method === undefined, inv && inv.default_payment_method);
    pass("the invoice is still raised and recorded unpaid, with Stripe's reason", inserts.filter(function (i) { return i.row.action === "overage_invoice_unpaid" && /default_payment_method/.test(i.row.detail.reason); }).length === 1);
  });
});
scenario("the card declines when the invoice is paid", function () {
  var w = night(); w.payReply = { error: { message: "Your card was declined." } }; reset(w);
  return run(mkSession(), "declined card").then(function () {
    var a = inserts.filter(function (i) { return i.row.action === "overage_invoice_unpaid"; });
    pass("an overage_invoice_unpaid audit row names the invoice and the reason", a.length === 1 && a[0].row.detail.invoice === "in_test" && /declined/.test(a[0].row.detail.reason),
         a.length ? JSON.stringify(a[0].row.detail) : "no row");
    pass("the streak still advanced: the money is owed and on the books", venuePatch().length === 1 && venuePatch()[0].body.overage_streak === 1);
    pass("not reported as a failed charge", inserts.filter(function (i) { return /failed|pending/.test(i.row.action); }).length === 0);
  });
});
scenario("the invoice is raised but cannot be finalised", function () {
  var w = night(); w.finalizeReply = { error: { message: "This invoice is already finalized." } }; reset(w);
  return run(mkSession(), "finalize fails").then(function () {
    pass("no pay attempt on an invoice that did not finalise", step("pay").length === 0);
    pass("recorded as unpaid so somebody looks", inserts.filter(function (i) { return i.row.action === "overage_invoice_unpaid" && i.row.detail.status === "draft"; }).length === 1);
    pass("the streak still advanced", venuePatch().length === 1 && venuePatch()[0].body.overage_streak === 1);
  });
});

/* 8. GROUPS THAT PAY BY INVOICE. */
scenario("an account that pays by invoice, 30 day terms, PO reference", function () {
  reset(night({ byInvoice: true, terms: 30, ref: "PO-4471" }));
  return run(mkSession(), "by invoice").then(function () {
    var inv = invoice()[0] && invoice()[0].body;
    pass("invoice is sent, not charged", !!inv && inv.collection_method === "send_invoice", inv && inv.collection_method);
    pass("30 days to pay", !!inv && inv.days_until_due === "30", inv && inv.days_until_due);
    pass("the PO reference is on it", !!inv && inv["custom_fields[0][value]"] === "PO-4471");
    pass("finalised and SENT, never charged to a card", JSON.stringify(order()) === JSON.stringify(["invoices", "invoiceitems", "finalize", "send"]), JSON.stringify(order()));
    pass("an open invoice with terms is not reported as an unpaid card", inserts.filter(function (i) { return i.row.action === "overage_invoice_unpaid"; }).length === 0);
  });
});

/* 9. WHO GETS COUNTED. */
scenario("five phones opened the page, two played", function () {
  var w = night({ players: 5 }); w.tables.vp_cards = [{ game_id: GAMEID, player_id: "p0" }, { game_id: GAMEID, player_id: "p1" }]; reset(w);
  return run(mkSession({ approvedCount: 5 }), "played").then(function () {
    var b = item()[0] && item()[0].body;
    pass("billed 1 over (2 played, cap 1), not 4", !!b && b.quantity === "1", JSON.stringify(b));
  });
});
scenario("broadcast bingo: no game rows at all", function () {
  reset(night({ players: 3, noGames: true }));
  return run(mkSession({ approvedCount: 3 }), "broadcast").then(function () {
    var b = item()[0] && item()[0].body;
    pass("everyone who joined counts: 2 over", !!b && b.quantity === "2", JSON.stringify(b));
  });
});
scenario("the host approved 2 extra and 30 turned up", function () {
  reset(night({ players: 31 }));
  return run(mkSession({ approvedCount: 3 }), "ceiling").then(function () {
    var b = item()[0] && item()[0].body;
    var ceiling = overageCeiling(mkSession({ approvedCount: 3 }), 1);
    pass("billed no more than the approved ceiling (" + (ceiling - 1) + " over)", !!b && Number(b.quantity) === ceiling - 1, JSON.stringify(b));
  });
});

/* 10. THE BILL IS DATED FROM THE NIGHT, NOT THE SWEEP. */
scenario("a Saturday night closed by the 3am Sunday sweep", function () {
  reset(night());
  // 21:00 Brisbane Saturday 12 Sep = 11:00Z on the 12th. The sweep runs 3am Sunday.
  return run(mkSession({ openedAt: "2026-09-12T11:00:00.000Z" }), "sweep date").then(function () {
    var b = item()[0] && item()[0].body;
    pass("the line says 12/09/2026, the night they played", !!b && /12\/09\/2026$/.test(b.description), b && b.description);
  });
});
scenario("a night with no opening time on the row", function () {
  reset(night());
  return run(mkSession({ openedAt: "" }), "no opened_at").then(function () {
    var b = item()[0] && item()[0].body;
    pass("still billed, dated today", !!b && /\d\d\/\d\d\/\d{4}$/.test(b.description), b && b.description);
  });
});

/* 11. THE SILENCE IS GONE. */
scenario("recordOverageCrash writes the row both callers now rely on", function () {
  reset(night());
  return recordOverageCrash(ENV, mkSession(), new ReferenceError("session is not defined"), "host_close").then(function () {
    var a = inserts.filter(function (i) { return i.row.action === "overage_charge_crashed"; });
    pass("an overage_charge_crashed audit row was written", a.length === 1);
    pass("naming the venue, the session and the error", a.length === 1 && a[0].row.target === VENUE && /overage_/.test(a[0].row.detail.source) && /session is not defined/.test(a[0].row.detail.error),
         a.length ? JSON.stringify(a[0].row.detail).slice(0, 200) : "");
    pass("both callers use it", (GAME.match(/recordOverageCrash\(env, session, e2?, '(sweep|host_close)'\)/g) || []).length === 2);
  });
});

/* ---- drive it -------------------------------------------------------------------- */
/* The summary is the LAST link in the chain, so it is the last line printed, which is the
   line release-check reads. A chain that hangs prints no summary and the gate goes red. */
steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  print("");
  print(bad ? bad + " OF " + ran + " CHECKS FAILED" : "ALL " + ran + " CHECKS PASSED");
}, function (e) {
  print("  HARNESS FAILURE: " + (e && (e.stack || e.message) || e));
  print("");
  print((bad + 1) + " OF " + (ran + 1) + " CHECKS FAILED");
});
