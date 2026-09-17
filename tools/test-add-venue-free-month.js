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

var calls, patched;

/* Everything below here is a stand-in for the network. vpbAddVenue is NOT stubbed. */
function arm(opts) {
  calls = []; patched = [];
  var status = opts.status || 'active';
  var priceId = ('priceId' in opts) ? opts.priceId : MONTHLY;

  vpbRequireOwner = function () {
    return Promise.resolve({
      account: { id: 'acct_1', plan: opts.plan || 'monthly', stripe_subscription_id: 'sub_1', is_group: true },
      venues: [{ id: 'v_existing' }], perms: null, adminActor: null, authUserId: 'user_1',
    });
  };
  vpaProvisionOneVenue = function () { return Promise.resolve({ created: true, venue: { id: 'v_new', slug: 'new-venue' } }); };
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
  var req = { json: function () { return Promise.resolve({ name: 'The New Pub', players: opts.players, postcode: '4220' }); } };
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

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('add-venue free month: ' + fails + ' failed'); }
