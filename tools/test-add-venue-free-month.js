/* Does a venue added to a PAYING account actually get its first month free?

   This RUNS vpbAddVenue. It does not read it. Every helper that touches the network is
   replaced with a recorder, but vpbAdjustPlayerBilling, vpbRateStrict, vpbIsFoundingPrice
   and vpbYearFractionLeft are the real ones out of the deployed file, because the whole
   question is whether the credit matches what those actually charged.

   Run:  jsc tools/test-add-venue-free-month.js
   The gate runs it too. Break the credit line in venueplay-api-FULL.js and this must go red.
*/
var SRC = 'venueplay-backend/worker/venueplay-api-FULL.js';
var src = readFile(SRC)
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
/* jsc HAS NO console. Without this shim every failure path in the Worker throws a
   ReferenceError instead of logging, which made "charge refused: no credit handed out" pass
   for the wrong reason: nothing was credited because the function had already blown up.
   A test that passes for the wrong reason is worse than one that fails. */
var LOGS = [];
console = { log: function (m) { LOGS.push(String(m)); } };
(0, eval)(src);

var MONTHLY = 'price_founding_monthly', ANNUAL = 'price_founding_annual';
var ENV = { STRIPE_PRICE_MONTHLY: MONTHLY, STRIPE_PRICE_ANNUAL: ANNUAL, STRIPE_SECRET_KEY: 'x', SUPABASE_URL: 'https://example.invalid' };

var calls, patched, provisioned;

/* Everything below here is a stand-in for the network. vpbAddVenue is NOT stubbed. */
function arm(opts) {
  calls = []; patched = []; provisioned = [];
  /* Venues already on the account with the SAME NAME. vpbAddVenue reads these to work out
     whether this is a different pub that happens to share a name, a live one being added twice,
     or one coming back from a cancellation. */
  vpaSelect = function (env, table, q) {
    if (table === 'vp_venues' && /name=eq/.test(q)) return Promise.resolve(opts.sameName || []);
    return Promise.resolve([]);
  };
  var status = opts.status || 'active';
  var priceId = ('priceId' in opts) ? opts.priceId : MONTHLY;

  vpbRequireOwner = function () {
    return Promise.resolve({
      account: { id: 'acct_1', plan: opts.plan || 'monthly', stripe_subscription_id: 'sub_1', is_group: true },
      venues: [{ id: 'v_existing' }], perms: null, adminActor: null, authUserId: 'user_1',
    });
  };
  vpaProvisionOneVenue = function (env, o) { provisioned.push(o); return Promise.resolve({ created: true, venue: { id: opts.newId || 'v_new', slug: 'new-venue' } }); };
  vpbAccountTotal = function () { return Promise.resolve(90); };
  vpbSubItem = function () {
    return Promise.resolve({
      itemId: 'si_1', priceId: priceId, quantity: 40,
      periodEnd: opts.periodEnd || (Math.floor(Date.now() / 1000) + (opts.plan === 'annual' ? 300 * 86400 : 20 * 86400)),
      anchor: opts.anchor || null,   // the billing anchor, whose day of the month says where the next cycle ends
      sub: { id: 'sub_1', customer: 'cus_1', status: status },
    });
  };
  vpbStripePost = function (env, path, params, idem) {
    calls.push({ path: path, params: params, idem: idem });
    if (opts.refuseCharge && /invoiceitems/.test(path)) return Promise.resolve({ error: { message: 'card declined' } });
    if (opts.refuseCredit && /balance_transactions/.test(path)) return Promise.resolve({ error: { message: 'no' } });
    return Promise.resolve({ id: 'obj_' + calls.length });
  };
  vpaPatch = function (env, table, q, body) { patched.push({ table: table, q: q, body: body }); return Promise.resolve({}); };
  vpaInsert = function () { return Promise.resolve({}); };
  vpbFireVenueOnboarding = function () { return Promise.resolve(true); };
}

function run(opts) {
  arm(opts);
  /* BOTH json() and text(), because a real Request has both and the Worker reads the
     body through vpaBody(), which uses text() so it can tell an EMPTY body from a
     malformed one. A stub that models half the interface breaks on a change that
     production would not have noticed. Derived from one object so they cannot drift. */
  var _body = { name: 'The New Pub', players: opts.players,
                postcode: ('postcode' in opts) ? opts.postcode : '4220' };
  var req = { json: function () { return Promise.resolve(_body); },
              text: function () { return Promise.resolve(JSON.stringify(_body)); } };
  var out = null;
  vpbAddVenue(req, opts.env || ENV, function (body) { return { body: body }; }).then(function (r) { out = r; });
  drainMicrotasks();
  return out && out.body;
}

function credits() { return calls.filter(function (c) { return /balance_transactions/.test(c.path); }); }
function charges() { return calls.filter(function (c) { return /invoiceitems/.test(c.path); }); }

var fails = 0;
function check(name, ok, saw) {
  if (ok) { print('  ok   ' + name); }
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('add-venue free month');

/* 1. The case Dean asked about: a paying monthly group adds a venue. */
var r1 = run({ players: 50, plan: 'monthly' });
check('monthly paying: one month charged', charges().length === 1 && charges()[0].params.quantity === 50, charges()[0] && charges()[0].params);
check('monthly paying: one month credited back', credits().length === 1 && credits()[0].params.amount === -12500, credits()[0] && credits()[0].params);
check('monthly paying: net cost today is nothing',
  (charges()[0].params.quantity * Number(charges()[0].params.unit_amount_decimal)) + credits()[0].params.amount === 0);
check('monthly paying: reported to the page', r1.free_month_cents === 12500, r1.free_month_cents);
check('monthly paying: keyed on the venue id so a double click credits once', credits()[0].idem === 'vfree:v_new', credits()[0].idem);
check('monthly paying: the venue row records it', patched.length === 1 && patched[0].body.free_month_cents === 12500, patched);
check('monthly paying: the credit names the venue', /The New Pub/.test(credits()[0].params.description), credits()[0].params.description);

/* 2. Inside their OWN free month nothing was charged, so there is nothing to hand back.
      Crediting here would be giving away a month they never paid for. */
var r2 = run({ players: 50, plan: 'monthly', status: 'trialing' });
check('still in the free month: nothing charged', charges().length === 0);
check('still in the free month: NOTHING credited', credits().length === 0, credits());
check('still in the free month: the page is not told about a discount', r2.free_month_cents === 0, r2.free_month_cents);

/* 3. Annual: charged pro rata to renewal, and one month of that comes off. */
var r3 = run({ players: 40, plan: 'annual' });
check('annual: charged pro rata', charges().length === 1 && charges()[0].params.amount > 0, charges()[0] && charges()[0].params);
check('annual: one month credited at the annual rate', credits().length === 1 && credits()[0].params.amount === -9200, credits()[0] && credits()[0].params);
check('annual: the credit is smaller than the charge', Math.abs(credits()[0].params.amount) < charges()[0].params.amount);

/* 4. Stripe refused the charge. Crediting a failed charge is minting free money. */
LOGS = [];
run({ players: 50, plan: 'monthly', refuseCharge: true });
check('charge refused: no credit handed out', credits().length === 0, credits());
check('charge refused: the refusal was logged, not swallowed',
  LOGS.some(function (l) { return /monthly add FAILED/.test(l); }), LOGS);

/* 5. Unknown price, so we cannot tell founding from standard. The charge path already refuses
      to guess a rate; the credit must refuse too rather than pick one. */
run({ players: 50, plan: 'monthly', priceId: null });
check('rate unknown: nothing charged and nothing credited', charges().length === 0 && credits().length === 0, calls);

/* 6. The credit itself failing must not be silent, and must not report a discount that is not there. */
LOGS = [];
var r6 = run({ players: 50, plan: 'monthly', refuseCredit: true });
check('credit refused: said so loudly, because charged-and-not-credited is the one bad outcome',
  LOGS.some(function (l) { return /FREE MONTH CREDIT FAILED/.test(l); }), LOGS);
check('credit refused: the page is not told they got one', r6.free_month_cents === 0, r6.free_month_cents);
check('credit refused: the venue row is not marked as credited', patched.length === 0, patched);

/* ---------------------------------------------------------------------------
   SAME NAME, AND COMING BACK AFTER A CANCELLATION.
   Dean, 17 Sep 2026: "then they arent cancelling a venue and readding it right."
   --------------------------------------------------------------------------- */
print('same name, and coming back');

function venue(over) {
  var v = { id: 'v_old', name: 'The New Pub', slug: 'the-new-pub', status: 'active',
            suspended_reason: null, cancel_at_period_end: false, postcode: '4220', max_players: 30 };
  for (var k in over) v[k] = over[k];
  return v;
}

/* A genuinely different pub that happens to share a name. A hundred Royal Hotels exist and
   seven percent of venue names are shared, so this is the ordinary case, not the exotic one. */
var rA = run({ players: 50, plan: 'monthly', postcode: '4225', sameName: [venue({ postcode: '4220' })] });
check('same name, different postcode: added, not refused', rA && rA.ok === true, rA);
check('same name, different postcode: provisioned as a NEW venue', provisioned.length === 1 && provisioned[0].forceNew === true, provisioned);
check('same name, different postcode: gets its own free month', rA.free_month_cents === 12500, rA.free_month_cents);

/* The same live venue added twice. Still refused, because a second copy would split its
   players and its bill, but the message now says what to do about it. */
var rB = run({ players: 50, plan: 'monthly', postcode: '4220', sameName: [venue({})] });
check('same name, same postcode, live: refused', !!rB.error, rB);
check('same name, same postcode, live: nothing charged', charges().length === 0 && credits().length === 0, calls);
check('same name, same postcode, live: the message says what to do', /different pub|own postcode/i.test(rB.error || ''), rB.error);

/* THE ONE THAT WAS BROKEN. A cancelled venue used to be told "use a different name", for ever. */
var rC = run({ players: 50, plan: 'monthly', postcode: '4220',
               sameName: [venue({ status: 'suspended', suspended_reason: 'cancelled' })] });
check('cancelled venue: comes back on', rC && rC.ok === true && rC.readded === true, rC);
check('cancelled venue: the same row, not a second one', provisioned.length === 0, provisioned);
check('cancelled venue: switched back on and un-cancelled',
  patched.length >= 1 && patched[0].body.status === 'active' && patched[0].body.cancel_at_period_end === false
  && patched[0].body.suspended_reason === null, patched[0] && patched[0].body);
check('cancelled venue: billed again from now', charges().length === 1, charges());
check('cancelled venue: NO second free month, or the month is farmable',
  credits().length === 0 && rC.free_month_cents === 0, [credits(), rC.free_month_cents]);

/* Cancelled but still inside the paid period: the row is active with the flag set. Same answer. */
var rD = run({ players: 50, plan: 'monthly', postcode: '4220',
               sameName: [venue({ cancel_at_period_end: true })] });
check('cancelling this period: comes back on', rD && rD.readded === true, rD);
check('cancelling this period: no second free month', rD.free_month_cents === 0, rD.free_month_cents);
/* ALREADY PAID FOR THIS PERIOD (audit 25 Sep 2026). A venue only flagged to cancel is still active and
   its players were billed to the renewal date. Brought back at the same size: nothing to charge. */
var rD2 = run({ players: 50, plan: 'monthly', postcode: '4220',
                sameName: [venue({ cancel_at_period_end: true, max_players: 50 })] });
check('cancelling this period, same size back: charged NOTHING, it is already paid for', rD2 && rD2.readded === true && charges().length === 0, charges());
/* Brought back BIGGER: only the players above what was paid. 30 paid, 50 asked: 20 charged. */
var rD3 = run({ players: 50, plan: 'monthly', postcode: '4220',
                sameName: [venue({ cancel_at_period_end: true, max_players: 30 })] });
var q3 = charges().map(function (c) { return JSON.stringify(c.params); }).join(' ');
check('cancelling this period, back bigger: charged for the 20 extra only', charges().length === 1 && /20/.test(q3) && !/\b50\b/.test(q3), q3);
/* Control: a venue switched OFF was not paid for this period, so it pays for all of them. */
var rD4 = run({ players: 50, plan: 'monthly', postcode: '4220',
                sameName: [venue({ status: 'suspended', suspended_reason: 'cancelled', max_players: 50 })] });
check('switched off and back: still charged for all 50', charges().length === 1, charges());

/* NOT reversible from here. Only money turns a non-payment suspension back on, and only a
   person turns a manual one back on. Otherwise this route is the "nudge the player count"
   loophole the subscription.updated handler exists to stop. */
var rE = run({ players: 50, plan: 'monthly', postcode: '4220',
               sameName: [venue({ status: 'suspended', suspended_reason: 'nonpayment' })] });
check('suspended for non-payment: refused, and not switched back on', !!rE.error && patched.length === 0, [rE, patched]);
check('suspended for non-payment: told it is the payment, not the name', /payment/i.test(rE.error || ''), rE.error);
check('suspended for non-payment: nothing charged', charges().length === 0, charges());

var rF = run({ players: 50, plan: 'monthly', postcode: '4220',
               sameName: [venue({ status: 'suspended', suspended_reason: 'manual' })] });
check('switched off by us: refused, and points at a human', !!rF.error && /hello@venueplay/.test(rF.error || ''), rF.error);

/* A venue on the account with no postcode recorded cannot be told apart from this one, so it
   counts as the same venue. Conservative on purpose: a second copy of a LIVE venue is worse
   than an add they can retry with a postcode. */
var rG = run({ players: 50, plan: 'monthly', postcode: '4225', sameName: [venue({ postcode: null })] });
check('existing venue has no postcode: treated as the same venue, not duplicated', !!rG.error, rG);

/* Nothing with that name at all: the ordinary add, untouched. */
var rH = run({ players: 50, plan: 'monthly', postcode: '4220', sameName: [] });
check('no clash: added as a new venue with no forceNew', rH.ok === true && provisioned[0].forceNew === false, provisioned);

print(fails ? ('FAILED ' + fails) : 'PASS');
/* ---------------------------------------------------------------------------
   TWO ROYAL HOTELS ON ONE DAY. The setup charge's Stripe idempotency key used to be the name,
   the player count and the renewal date, so the second one's charge was replayed from the
   first one's and never existed, while its free month was credited anyway. The renewal date is
   pinned here on purpose: Date.now() ticking between the two runs would make the old key
   differ by accident and this would pass against the broken code.
   --------------------------------------------------------------------------- */
print('two venues with one name, added the same day');
var PE = 1790000000;
run({ players: 100, plan: 'monthly', postcode: '4220', newId: 'v_royal_a', periodEnd: PE });
var keyA = charges()[0] && charges()[0].idem;
run({ players: 100, plan: 'monthly', postcode: '2000', newId: 'v_royal_b', periodEnd: PE,
      sameName: [venue({ id: 'v_royal_a', postcode: '4220' })] });
var keyB = charges()[0] && charges()[0].idem;
check('each venue\'s setup charge has a key', !!keyA && !!keyB, [keyA, keyB]);
check('and they are DIFFERENT keys, or Stripe replays the first charge for the second venue', keyA !== keyB, [keyA, keyB]);
run({ players: 100, plan: 'monthly', postcode: '4220', newId: 'v_royal_a', periodEnd: PE });
check('the same venue retried keeps its own key, so a double click charges once', charges()[0].idem === keyA, [charges()[0].idem, keyA]);

/* ---------------------------------------------------------------------------
   DEAN'S RULE 3 FOR A NEW PUB ON A GROUP (3 Nov 2026), BEHIND VPB_BILLING_RULES_3NOV, OFF.
   "The first month is free, then it joins the group's ONE billing cycle, with the stub between the
   end of its free month and the next group bill pro rated." TODAY (switch off) the pub is charged a
   month and credited a month, so it is free until the next bill date and a full month from then:
   that is the gap the switch closes.

   DEAN, 4 NOV 2026, "YES TO PRO RATA": the stub is BY DAYS OF THE MONTH BEING BILLED. "3 weeks and 2
   days is 23 days which is x% of the month being billed." So 23 days of a 31-day cycle is 23/31, of a
   30-day cycle 23/30, and the money is rounded to the cent once, at the end. The page and the invoice
   line show the same days and percentage: "23 of 31 days (74%)".

   THE CLOCK IS PINNED (never a fixture from the current clock): each case names the day the pub is
   added and the group's renewal, in Brisbane, and the free month runs to the same date next month.
   --------------------------------------------------------------------------- */
print('rule 3: a new pub on a group, behind VPB_BILLING_RULES_3NOV');
var ON = { STRIPE_PRICE_MONTHLY: MONTHLY, STRIPE_PRICE_ANNUAL: ANNUAL, STRIPE_SECRET_KEY: 'x', SUPABASE_URL: 'https://example.invalid', VPB_BILLING_RULES_3NOV: '1' };
var DAYS = 86400;
/* A Brisbane local time as a unix second (UTC+10, no daylight saving). */
function bris(y, m, d, h) { return Date.UTC(y, m - 1, d, h || 0) / 1000 - 36000; }
var _realNow = Date.now;
function at(unixS) { Date.now = function () { return unixS * 1000; }; }
function unpin() { Date.now = _realNow; }
/* Control: with the switch off, today's path, and the page is told which rule it was. */
var c0 = run({ players: 30, plan: 'monthly', priceId: 'price_standard' });
check('switch off: charged a month and credited a month, as today', charges().length === 1 && credits().length === 1 && credits()[0].params.amount === -9000, [charges(), credits()]);
check('switch off: the page is told the rule was "month"', c0.free_rule === 'month' && c0.free_until === null, c0);

/* DEAN'S WORKED EXAMPLE: $2.50 x 10 players, 23 of 31 days. The group renews on the 7th (anchor 7 Oct 9am).
   The pub is added 15 Nov; its free month runs to 15 Dec. The next bill covers 7 Dec to 7 Jan, 31 days:
   8 of them are free, the pub pays 23 of 31 (74%). The bill carries the full $25.00 through the quantity,
   so 10 x $2.50 x 8/31 = $6.45 comes off, and the pub pays $18.55. */
at(bris(2026, 11, 15, 10));
var c1 = run({ players: 10, plan: 'monthly', priceId: MONTHLY, periodEnd: bris(2026, 12, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('23 of 31: NOTHING charged for the rest of this cycle', charges().length === 0, charges());
check('23 of 31: ONE credit for the 8 free days of a 31-day cycle: 10 x $2.50 x 8/31 = $6.45',
  credits().length === 1 && credits()[0].params.amount === -645, credits()[0] && credits()[0].params);
check('23 of 31: rounded to the cent ONCE at the end ($6.45), not per player (10 x 65c = $6.50)', credits()[0].params.amount !== -650 && credits()[0].params.amount === -645, credits()[0].params.amount);
check('23 of 31: so the next group bill charges the pub $25.00 less $6.45 = $18.55, which is 23/31 of $25.00 to the cent',
  2500 + credits()[0].params.amount === 1855 && Math.round(2500 * 23 / 31) === 1855);
check('23 of 31: the page is told the stub in days: cycle 31, stub 23, "23 of 31 days (74%)"',
  c1.cycle_days === 31 && c1.stub_days === 23 && c1.stub_words === '23 of 31 days (74%)' && c1.free_days_credited === 8, c1);
check('23 of 31: the free month runs to the same date next month: 15 December 2026', c1.free_until === '15 December 2026', c1.free_until);
check('23 of 31: the invoice line carries the SAME days and percentage as the page',
  credits()[0].params.description === 'The New Pub - first month free to 15/12/2026: 8 of 31 days (26%) of your next bill taken off, so you pay 23 of 31 days (74%)', credits()[0].params.description);
check('23 of 31: the page is told the rule and the money', c1.free_rule === 'prorata' && c1.free_month_cents === 645, c1);
check('23 of 31: still keyed on the venue id, so a double click credits once', credits()[0].idem === 'vfree:v_new', credits()[0].idem);
check('23 of 31: the venue row records the free month and the credit', patched.some(function (p) { return p.body.free_month_cents === 645 && !!p.body.free_month_at; }), patched);
check('23 of 31: the subscription quantity still rises for the renewal (one bill for the group)', calls.some(function (c) { return /subscription_items/.test(c.path) && c.params.proration_behavior === 'none'; }), calls);
check('a NEW PUB is never offered the one-hour undo (Dean, 4 Nov 2026)', c1.undo_hour === false, c1.undo_hour);

/* 23 OF 30: Dean's 3 Nov example at $3 and 30 players. Added 14 Oct, a week after the 7 Oct bill; free to
   14 Nov; the next bill covers 7 Nov to 7 Dec, 30 days: 7 free, 23 paid (77%), $21.00 off, $69.00 paid. */
at(bris(2026, 10, 14, 10));
var c2 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 11, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('23 of 30: 30 x $3 x 7/30 = $21.00 off, so the bill charges $69.00 for the 23 days', credits().length === 1 && credits()[0].params.amount === -2100 && 9000 - 2100 === 6900, credits()[0] && credits()[0].params);
check('23 of 30: "23 of 30 days (77%)", free to 14 November 2026', c2.stub_words === '23 of 30 days (77%)' && c2.cycle_days === 30 && c2.free_until === '14 November 2026' && c2.free_days_credited === 7, c2);
check('23 of 30: the line says 7 of 30 days (23%) off and 23 of 30 days (77%) paid', /7 of 30 days \(23%\) of your next bill taken off, so you pay 23 of 30 days \(77%\)$/.test(credits()[0].params.description), credits()[0].params.description);

/* 28 OF 28: added ON the bill date, 7 Jan 2027. Free to 7 Feb, which is exactly the next bill; that bill
   covers 7 Feb to 7 Mar 2027, 28 days, and the pub pays all 28 (100%). Nothing to credit. */
at(bris(2027, 1, 7, 12));
var c3 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2027, 2, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('28 of 28: joined on the bill date: nothing charged, nothing credited, the next bill is the whole 28-day month', charges().length === 0 && credits().length === 0 && c3.free_rule === 'prorata' && c3.free_days_credited === 0, [calls, c3]);
check('28 of 28: the page says "28 of 28 days (100%)"', c3.stub_words === '28 of 28 days (100%)' && c3.cycle_days === 28 && c3.stub_days === 28, c3);
check('28 of 28: the free month is still recorded on the venue row (it keeps the undo away), with nothing credited', patched.some(function (p) { return !!p.body.free_month_at && p.body.free_month_cents === 0; }), patched);
/* 15 OF 28: added 20 Jan 2027, free to 20 Feb: 13 of the 28 days are free, 15 paid (54%). 9000 x 13/28 = 4178.57 -> $41.79. */
at(bris(2027, 1, 20, 12));
var c4 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2027, 2, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('15 of 28: 30 x $3 x 13/28 = $41.79 off (one rounding), "15 of 28 days (54%)"', credits()[0] && credits()[0].params.amount === -4179 && c4.stub_words === '15 of 28 days (54%)', [credits(), c4]);

/* A CYCLE THAT CROSSES A MONTH END, anchored on the 31st. Stripe keeps the anchor day: 31 Dec runs to
   31 Jan, then to 28 Feb (28 days), then to 31 Mar. Added 10 Jan 2027, free to 10 Feb: 10 of 28 free,
   18 paid (64%). 9000 x 10/28 = 3214.29 -> $32.14. */
at(bris(2027, 1, 10, 12));
var c5 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2027, 1, 31, 9), anchor: bris(2026, 12, 31, 9), env: ON });
check('anchor 31, 31 Jan to 28 Feb: a 28-day cycle, 10 free, "18 of 28 days (64%)", $32.14 off', credits()[0] && credits()[0].params.amount === -3214 && c5.cycle_days === 28 && c5.stub_words === '18 of 28 days (64%)', [credits(), c5]);
/* ...and the renewal clamped to a short month: anchor 31, renewal 30 Nov, so the NEXT cycle is 30 Nov to
   31 Dec, 31 days, not 30 Dec. Added 20 Nov, free to 20 Dec: 20 free, 11 paid (35%). 9000 x 20/31 = 5806.45 -> $58.06. */
at(bris(2026, 11, 20, 12));
var c6 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 11, 30, 9), anchor: bris(2026, 10, 31, 9), env: ON });
check('anchor 31, renewal 30 Nov: the next cycle runs to 31 Dec (31 days, the anchor day), "11 of 31 days (35%)", $58.06 off', credits()[0] && credits()[0].params.amount === -5806 && c6.cycle_days === 31 && c6.stub_words === '11 of 31 days (35%)', [credits(), c6]);
/* The free month itself crossing a month end: added 31 Oct, free to 30 Nov (there is no 31 Nov). Renewal 7 Nov,
   next cycle 7 Nov to 7 Dec (30 days): 23 free, 7 paid (23%). 9000 x 23/30 = $69.00 off. */
at(bris(2026, 10, 31, 12));
var c7 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 11, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('added 31 Oct: free to 30 November 2026, 23 of 30 days off ($69.00), "7 of 30 days (23%)" paid', credits()[0] && credits()[0].params.amount === -6900 && c7.free_until === '30 November 2026' && c7.stub_words === '7 of 30 days (23%)', [credits(), c7]);
/* Joined the day before the bill: 29 of the 30 free days fall in the next cycle. Added 6 Nov, free to 6 Dec;
   next cycle 7 Nov to 7 Dec, 30 days: 29 free, 1 paid (3%). 9000 x 29/30 = $87.00 off. */
at(bris(2026, 11, 6, 12));
var c8 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 11, 7, 9), anchor: bris(2026, 10, 7, 9), env: ON });
check('joined the day before the bill: 29 of 30 days credited ($87.00), so that bill charges "1 of 30 days (3%)"', credits().length === 1 && credits()[0].params.amount === -8700 && c8.free_days_credited === 29 && c8.stub_words === '1 of 30 days (3%)', [credits(), c8]);

/* The arithmetic helpers on their own: the clamp and the single rounding. */
check('vpbMonthOnS: 31 Jan one month on is 28 Feb (no 31 Feb)', vpbMonthOnS(bris(2027, 1, 31, 9)) === bris(2027, 2, 28, 0), vpbMonthOnS(bris(2027, 1, 31, 9)));
check('vpbMonthOnS: 28 Feb with a 31st anchor lands on 31 Mar, the way Stripe does', vpbMonthOnS(bris(2027, 2, 28, 9), bris(2026, 12, 31, 9)) === bris(2027, 3, 31, 0), vpbMonthOnS(bris(2027, 2, 28, 9), bris(2026, 12, 31, 9)));
check('vpbCycleDays: 7 Nov to 7 Dec is 30, 7 Dec to 7 Jan is 31, 7 Feb to 7 Mar 2027 is 28',
  vpbCycleDays(bris(2026, 11, 7, 9), bris(2026, 12, 7, 9)) === 30 && vpbCycleDays(bris(2026, 12, 7, 9), bris(2027, 1, 7, 9)) === 31 && vpbCycleDays(bris(2027, 2, 7, 9), bris(2027, 3, 7, 9)) === 28);
check('vpbProrataCents rounds once: 10 x $2.50 x 8/31 = 645, and 0 for no days', vpbProrataCents(2.5, 10, 8, 31) === 645 && vpbProrataCents(2.5, 10, 0, 31) === 0 && vpbProrataCents(3, 30, 23, 31) === 6677);
check('vpbDaysWords: "23 of 31 days (74%)"', vpbDaysWords(23, 31) === '23 of 31 days (74%)' && vpbDaysWords(28, 28) === '28 of 28 days (100%)', vpbDaysWords(23, 31));

/* The cases that keep today's path with the switch on. */
at(bris(2026, 11, 15, 10));
run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 12, 7, 9), env: ON, status: 'trialing' });
check('switch on, inside the account\'s own free month: nothing charged and nothing credited', charges().length === 0 && credits().length === 0, calls);
var c9 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 12, 7, 9), env: ON, postcode: '4220',
               sameName: [venue({ status: 'suspended', suspended_reason: 'cancelled' })] });
check('switch on, a pub coming back: charged as today and NO free month, so it is not farmable', charges().length === 1 && credits().length === 0 && c9.free_rule === null, [calls, c9]);
run({ players: 30, plan: 'annual', priceId: ANNUAL, env: ON });
check('switch on, a yearly plan: unchanged (pro rata to renewal, one month credited)', charges().length === 1 && credits().length === 1 && credits()[0].params.amount === -6900, [charges(), credits()]);
run({ players: 30, plan: 'monthly', priceId: null, periodEnd: bris(2026, 12, 7, 9), env: ON });
check('switch on, rate unknown: nothing credited rather than a guessed rate', credits().length === 0 && charges().length === 0, calls);
LOGS = [];
var c10 = run({ players: 30, plan: 'monthly', priceId: 'price_standard', periodEnd: bris(2026, 12, 7, 9), env: ON, refuseCredit: true });
check('switch on, credit refused: logged loudly and the page is not told they got one', LOGS.some(function (l) { return /FREE MONTH CREDIT FAILED/.test(l); }) && c10.free_month_cents === 0, [LOGS, c10]);
check('switch on, credit refused: the venue row still records the free month, with nothing credited', patched.some(function (p) { return !!p.body.free_month_at && p.body.free_month_cents === 0; }), patched);
unpin();
print(fails ? ('FAILED ' + fails) : 'PASS');

if (fails) { throw new Error('add-venue free month: ' + fails + ' failed'); }
