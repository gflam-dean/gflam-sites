/* THE PLAN UPGRADE, RUN FOR REAL. Nobody had ever executed this function.

   Dean, 11 Sep 2026: "Run it until the upgrade works."

   It could not be run, and that turned out to be the finding. Two facts, both checked
   that night against production and against the suites:

     * vp_admin_audit holds ZERO plan_uplift_after_three_big_nights rows. The uplift has
       never fired at a real venue.
     * overage-charge.test.js FAKES it. Line 76 of that file replaces upliftPlan with a
       stub that counts calls, and then asserts "the plan was moved up" by counting the
       stub. The real function - the one that raises max_players, moves the Stripe
       subscription quantity, charges annual venues pro rata and rolls the cap back when
       Stripe says no - was never executed by anything.

   That is the same fault as the morning of 11 Sep, written down in
   overage-charge.test.js itself: "every suite in the repo was green, because the sweep
   suite fakes chargeNightOverage and nothing ran the real one." It had simply moved one
   function along.

   This suite lifts the REAL upliftPlan out of the shipped Worker and runs it against a
   fake Stripe and a fake database that record every call. The claims are about what is
   sent and what is written: the quantity Stripe is told, the cap in the database, the
   rollback when the charge fails, and the pro rata an annual venue is charged.

   THE ROLLBACK IS THE ONE THAT MATTERS. If Stripe refuses the quantity change and the
   cap is not put back, the venue keeps a bigger plan we never billed for, for ever.

   Run: jsc venueplay-backend/worker/plan-uplift.test.js
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
var GAME = find("venueplay-backend/worker/venueplay-game.js");

function lift(src, name) {
  var i = src.indexOf("async function " + name + "(");
  if (i < 0) throw new Error("no function " + name);
  var depth = 0, started = false, j = i;
  for (; j < src.length; j++) {
    var c = src[j];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* jsc has print, not console. The Worker logs on the rollback path, and without this
   the ROLLBACK check - the one that matters most - dies before it can be judged. */
var console = { log: function () {}, warn: function () {}, error: function () {} };

/* ---- the fakes. Every one records what it was asked to do. ---- */
var patches, posts, gets, inserts, world;
function reset(w) {
  world = w || {};
  patches = []; posts = []; gets = []; inserts = [];
}
function enc(s) { return encodeURIComponent(String(s)); }
function sbPatch(env, table, where, body) { patches.push({ table: table, where: where, body: body }); return Promise.resolve({}); }
function sbInsert(env, table, row) { inserts.push({ table: table, row: row }); return Promise.resolve({}); }
function stripeGet(env, path) {
  gets.push(path);
  if (world.subError) return Promise.resolve({ error: { message: "no such subscription" } });
  return Promise.resolve({
    id: "sub_1", status: "active",
    current_period_end: world.periodEnd || null,
    items: { data: [{ id: "si_1", quantity: world.qty || 1,
                      current_period_end: world.itemPeriodEnd || null,
                      price: { recurring: { interval: world.interval || "month" } } }] },
  });
}
function stripePost(env, path, body, idem) {
  posts.push({ path: path, body: body, idem: idem });
  if (world.failQuantity && /^subscription_items\//.test(path)) return Promise.resolve({ error: { message: "card_declined" } });
  if (world.failItem && path === "invoiceitems") return Promise.resolve({ error: { message: "no such customer" } });
  if (path === "invoiceitems") return Promise.resolve({ id: "ii_new" });
  if (/\/void$/.test(path)) return Promise.resolve({ status: "void" });
  return Promise.resolve({ id: "ok_" + posts.length });
}
function stripeDelete() { return Promise.resolve({}); }
function accountBilledTotal(env, foundingId) { return Promise.resolve(world.billedTotal || 0); }
function openInvoice(env, acct, idem, desc) {
  posts.push({ path: "openInvoice", body: { desc: desc }, idem: idem });
  if (world.noInvoice) return Promise.resolve({ ok: false });
  return Promise.resolve({ ok: true, invoice: { id: "in_uplift" } });
}
function settleInvoice(env, inv, idem, cents) {
  posts.push({ path: "settleInvoice", body: { cents: cents }, idem: idem });
  return Promise.resolve(world.settle || { ok: true, invoice: "in_uplift", status: "paid" });
}
function upliftRate(tier, annual) { return tier === "founding" ? 2.5 : 3; }

var fnSrc = lift(GAME, "upliftPlan");
pass("the real upliftPlan was found in the shipped Worker", fnSrc.length > 400, fnSrc.length + " chars");
pass("and it is NOT the stub overage-charge.test.js uses",
     /sbPatch\(env, 'vp_venues'/.test(fnSrc) && /subscription_items\//.test(fnSrc),
     "a stub would not touch the database or Stripe");
eval(fnSrc);

var venue = function (o) {
  o = o || {};
  return { id: "v1", max_players: o.max === undefined ? 1 : o.max, founding_id: "f1",
           pending_players: o.pending === undefined ? null : o.pending };
};
var acct = { stripe_subscription_id: "sub_1" };

/* 1. THE ORDINARY CASE: three big nights, monthly venue, plan goes 1 -> 3. */
reset({ billedTotal: 3, interval: "month" });
upliftPlan({}, venue({ max: 1 }), acct, 3, [2, 3, 3], "founding").then(function (r) {
  pass("it returns the new maximum", r === 3, String(r));
  var caps = patches.filter(function (p) { return p.body.max_players !== undefined; });
  pass("the venue's cap is raised in the database", caps.length === 1 && caps[0].body.max_players === 3,
       JSON.stringify(caps.map(function (c) { return c.body; })));
  var q = posts.filter(function (p) { return /^subscription_items\//.test(p.path); });
  pass("Stripe is told the new quantity", q.length === 1 && q[0].body.quantity === 3,
       q.length ? JSON.stringify(q[0].body) : "nothing was sent");
  pass("with no proration on a monthly plan", q.length === 1 && q[0].body.proration_behavior === "none");
  pass("a monthly venue is NOT charged pro rata now",
       posts.filter(function (p) { return p.path === "openInvoice"; }).length === 0,
       "monthly renews within the month; the bigger plan starts then");
  var a = inserts.filter(function (i) { return i.row.action === "plan_uplift_after_three_big_nights"; });
  pass("an audit row records the upgrade", a.length === 1);
  pass("naming what it went from, to, and the three nights",
       a.length === 1 && a[0].row.detail.from === 1 && a[0].row.detail.to === 3 &&
       String(a[0].row.detail.nights) === "2,3,3" && a[0].row.detail.effective === "next_invoice",
       a.length ? JSON.stringify(a[0].row.detail) : "");

  /* 2. STRIPE SAYS NO. The cap MUST go back, or they hold a plan we never billed for. */
  reset({ billedTotal: 3, interval: "month", failQuantity: true });
  return upliftPlan({}, venue({ max: 1 }), acct, 3, [2, 3, 3], "founding");
}).then(function (r) {
  pass("a refused quantity change returns null", r === null, String(r));
  var caps = patches.filter(function (p) { return p.body.max_players !== undefined; });
  pass("the cap is put BACK to what it was", caps.length === 2 && caps[1].body.max_players === 1,
       JSON.stringify(caps.map(function (c) { return c.body.max_players; })));
  pass("and no upgrade is recorded, because none happened",
       inserts.filter(function (i) { return i.row.action === "plan_uplift_after_three_big_nights"; }).length === 0);

  /* 3. STRIPE UNREACHABLE. Same promise: never leave them on a plan we cannot bill. */
  reset({ subError: true });
  return upliftPlan({}, venue({ max: 1 }), acct, 3, [2, 3, 3], "founding");
}).then(function (r) {
  var caps = patches.filter(function (p) { return p.body.max_players !== undefined; });
  pass("an unreachable Stripe also rolls the cap back", r === null && caps.length === 2 && caps[1].body.max_players === 1,
       JSON.stringify(caps.map(function (c) { return c.body.max_players; })));

  /* 4. A SCHEDULED REDUCTION IS THE VENUE'S OWN CHOICE. Leave it alone. */
  reset({ billedTotal: 3 });
  return upliftPlan({}, venue({ max: 1, pending: 1 }), acct, 3, [2, 3, 3], "founding");
}).then(function (r) {
  pass("a venue with a reduction already scheduled is left alone", r === null, String(r));
  pass("nothing was written and nothing was sent", patches.length === 0 && posts.length === 0,
       patches.length + " patch(es), " + posts.length + " post(s)");

  /* 5. NOT ACTUALLY BIGGER. Must be a no-op, not a free lap of the streak. */
  reset({ billedTotal: 3 });
  return upliftPlan({}, venue({ max: 5 }), acct, 3, [2, 3, 3], "founding");
}).then(function (r) {
  pass("an uplift to a SMALLER number does nothing", r === null && patches.length === 0 && posts.length === 0,
       String(r));

  /* 6. ANNUAL. The capacity is theirs today and the renewal can be eleven months away,
        so the added players are charged pro rata now. */
  var year = Math.floor(Date.now() / 1000) + Math.floor(365 * 24 * 3600 / 2);   // half a year left
  reset({ billedTotal: 3, interval: "year", periodEnd: year });
  return upliftPlan({}, venue({ max: 1 }), acct, 3, [2, 3, 3], "founding");
}).then(function (r) {
  pass("an annual venue is upgraded too", r === 3, String(r));
  var inv = posts.filter(function (p) { return p.path === "openInvoice"; });
  var itm = posts.filter(function (p) { return p.path === "invoiceitems"; });
  pass("and IS charged pro rata now, on its own invoice", inv.length === 1 && itm.length === 1,
       inv.length + " invoice(s), " + itm.length + " item(s)");
  // The real item carries a flat `amount` in cents, not unit_amount_decimal x quantity.
  // Reading the field the code does not send is how the FIRST version of this check got
  // $NaN and called it a failure, which is the same mistake as invoice.paid one level down.
  var cents = itm.length ? itm[0].body.amount : 0;
  // 2 added players x $2.50 x 12 months x half a year left = $30.00
  pass("the pro rata is the half year it is buying, not a whole year",
       cents > 2700 && cents < 3300, "$" + (cents / 100).toFixed(2) + " for half of 2 x $2.50/mo");
  pass("and it is charged in AUD against the venue's own customer",
       itm.length === 1 && itm[0].body.currency === "aud" && /three big nights/.test(itm[0].body.description || ""),
       itm.length ? String(itm[0].body.description).slice(0, 70) : "");
  var a = inserts.filter(function (i) { return i.row.action === "plan_uplift_after_three_big_nights"; });
  pass("the audit row says it was charged now, not next invoice",
       a.length === 1 && a[0].row.detail.effective === "pro_rata_now",
       a.length ? JSON.stringify(a[0].row.detail.effective) : "");

  if (ran !== 21) { print("\nONLY " + ran + " OF 21 RAN"); throw new Error("incomplete"); }
  if (bad) { print("\n" + bad + " OF " + ran + " FAILED"); throw new Error(bad + " failed"); }
  print("\nALL " + ran + " CHECKS PASSED");
}).catch(function (e) {
  print("\nTHREW: " + (e && e.message || e));
  throw e;
});
