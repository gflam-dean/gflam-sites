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
  vpaProvisionOneVenue = function (env, o) { provisioned.push(o); return Promise.resolve({ created: true, venue: { id: 'v_new', slug: 'new-venue' } }); };
  vpbAccountTotal = function () { return Promise.resolve(90); };
  vpbSubItem = function () {
    return Promise.resolve({
      itemId: 'si_1', priceId: priceId, quantity: 40,
      periodEnd: Math.floor(Date.now() / 1000) + (opts.plan === 'annual' ? 300 * 86400 : 20 * 86400),
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
  vpbAddVenue(req, ENV, function (body) { return { body: body }; }).then(function (r) { out = r; });
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
if (fails) { throw new Error('add-venue free month: ' + fails + ' failed'); }
