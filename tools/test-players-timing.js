/* WHEN IS AN ADDED PLAYER CHARGED (Dean's billing rule 2, 3 Nov 2026).

   Dean thought extra players were charged straight away, and the page's words read like three weeks
   free. The truth is in vpbSetPlayers and vpbAdjustPlayerBilling, so this RUNS them (every network
   helper is a recorder; the money arithmetic and vpbRules are the real ones out of the deployed file):

     adding     the full rate for ONE MONTH per player on the NEXT bill, not pro rata, whatever day it
                is; the players are ready tonight; inside the account's free month nothing extra
     lowering   waits for the next cycle (pending_players), credits nothing, so add 30 for one night
                and drop them: the 30 still cost a month
     the rule   has no switch, because the code already does it; the only switch in vpbRules is the new
                pub's free month (tools/test-add-venue-free-month.js), OFF until Dean says yes

   Run:  jsc tools/test-players-timing.js
*/
var SRC = 'venueplay-backend/worker/venueplay-api-FULL.js';
var src = readFile(SRC)
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var LOGS = [];
console = { log: function (m) { LOGS.push(String(m)); } };
(0, eval)(src);

var MONTHLY = 'price_founding_monthly', ANNUAL = 'price_founding_annual';
function envWith(extra) {
  var e = { STRIPE_PRICE_MONTHLY: MONTHLY, STRIPE_PRICE_ANNUAL: ANNUAL, STRIPE_SECRET_KEY: 'x', SUPABASE_URL: 'https://example.invalid' };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var DAY = 86400;
var calls, patched, audits, VENUE;

function arm(opts) {
  calls = []; patched = []; audits = [];
  VENUE = { id: 'v1', name: 'Deepwater Hotel', max_players: opts.current == null ? 80 : opts.current,
            pending_players: ('pending' in opts) ? opts.pending : null };
  var now = Math.floor(Date.now() / 1000);
  vpbRequireOwner = function () {
    return Promise.resolve({
      account: { id: 'acct_1', plan: opts.plan || 'monthly', stripe_subscription_id: 'sub_1' },
      venues: [VENUE], perms: null, adminActor: null, authUserId: 'user_1',
    });
  };
  vpbAccountTotal = function () { return Promise.resolve(opts.total || 140); };
  vpbSubItem = function () {
    return Promise.resolve({
      itemId: 'si_1', priceId: ('priceId' in opts) ? opts.priceId : MONTHLY, quantity: 140,
      periodEnd: now + 3 * DAY,                                   // only 3 days of the cycle left: still a full month
      sub: { id: 'sub_1', customer: 'cus_1', status: opts.status || 'active' },
    });
  };
  vpbStripePost = function (env, path, params, idem) {
    calls.push({ path: path, params: params, idem: idem });
    return Promise.resolve({ id: 'obj_' + calls.length });
  };
  vpaPatch = function (env, table, q, body) { patched.push({ table: table, q: q, body: body }); return Promise.resolve({}); };
  vpaInsert = function (env, table, row) { audits.push(row); return Promise.resolve({}); };
  /* Rule 4 reads the last increase's audit row and whether a game has STARTED since. */
  deletes = [];
  vpaSelect = function (env, table, q) {
    if (table === 'vp_admin_audit') return Promise.resolve(opts.lastUp ? [opts.lastUp] : []);
    if (table === 'vp_sessions') return Promise.resolve(opts.played ? [{ id: 's1' }] : []);
    return Promise.resolve([]);
  };
  vpbStripeDelete = function (env, path) {
    deletes.push(path);
    return Promise.resolve(opts.refuseDelete ? { error: { message: 'already invoiced' } } : { id: path.split('/')[1], deleted: true });
  };
}
var deletes = [];
function minutesAgo(m) { return new Date(Date.now() - m * 60000).toISOString(); }
function lastUp(minutes, from, to) { return { created_at: minutesAgo(minutes), detail: { from: from, to: to, billing: { kind: 'charge', cents: (to - from) * 250, item: 'ii_1' } } }; }

function run(opts, body, env) {
  arm(opts);
  var req = { json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } };
  var out = null;
  vpbSetPlayers(req, env || envWith(), function (b, status) { return { body: b, status: status || 200 }; }).then(function (r) { out = r; });
  drainMicrotasks();
  return out && out.body;
}
function charges() { return calls.filter(function (c) { return /invoiceitems/.test(c.path); }); }
function credits() { return calls.filter(function (c) { return /balance_transactions/.test(c.path); }); }
function quantities() { return calls.filter(function (c) { return /subscription_items/.test(c.path); }); }

var fails = 0;
function check(name, good, saw) {
  if (good) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('the switch');
check('the new pub free month rule is OFF with nothing set', vpbRules(envWith()).new_pub_free_month === false, vpbRules(envWith()));
check('and OFF with no env at all', vpbRules(null).new_pub_free_month === false && vpbRules(undefined).new_pub_free_month === false);
check('VPB_BILLING_RULES_3NOV=1 turns it on', vpbRules(envWith({ VPB_BILLING_RULES_3NOV: '1' })).new_pub_free_month === true);
check('"true", "yes" or "0" do not turn it on: only the string 1',
  !vpbRules(envWith({ VPB_BILLING_RULES_3NOV: 'true' })).new_pub_free_month && !vpbRules(envWith({ VPB_BILLING_RULES_3NOV: 'yes' })).new_pub_free_month
  && !vpbRules(envWith({ VPB_BILLING_RULES_3NOV: '0' })).new_pub_free_month);
check('vpbRules holds exactly the two rules behind the one switch (3: new pub free month, 4: the one-hour undo)', Object.keys(vpbRules(envWith())).sort().join(',') === 'new_pub_free_month,undo_hour', Object.keys(vpbRules(envWith())));

print('adding a player: the full month on the next bill, ready tonight (rule 2)');
var r1 = run({}, { venue_id: 'v1', players: 81 });
check('add 1 player with 3 days of the cycle left: ONE FULL MONTH ($2.50) goes on the next invoice, not pro rata',
  charges().length === 1 && charges()[0].params.quantity === 1 && charges()[0].params.unit_amount_decimal === '250', charges()[0] && charges()[0].params);
check('add 1 player: the capacity is live tonight (max_players 81)', patched.some(function (p) { return p.body.max_players === 81; }), patched);
check('add 1 player: the page is told applied now and the $2.50', r1 && r1.applied === 'now' && r1.charge_cents === 250, r1);
check('add 1 player: the invoice line names the venue and the date', /Deepwater Hotel - Extra Player - \d\d\/\d\d\/\d{4}$/.test(charges()[0].params.description), charges()[0].params.description);
check('add 1 player: nothing is credited', credits().length === 0);
check('add 1 player: the Stripe quantity rises now with NO proration, so the renewal carries them from then', quantities().length === 1 && quantities()[0].params.proration_behavior === 'none', quantities());
var r1p = run({}, { venue_id: 'v1', players: 81, preview: true });
check('the quote (preview) names $2.50, changes nothing and posts nothing', r1p && r1p.preview === true && r1p.charge_cents === 250 && patched.length === 0 && calls.length === 0, [r1p, patched, calls]);
var r1t = run({}, { venue_id: 'v1', players: 81, timing: 'next' });
check('there is no "from next month": an unknown timing is simply an add, charged the month', r1t && r1t.applied === 'now' && charges().length === 1, [r1t, charges()]);
var r30 = run({}, { venue_id: 'v1', players: 110 });
check('add 30 players: 30 x $2.50 = $75.00 on the next invoice', charges().length === 1 && charges()[0].params.quantity === 30 && r30.charge_cents === 7500, [charges()[0] && charges()[0].params, r30]);
var rTrial = run({ status: 'trialing' }, { venue_id: 'v1', players: 81 });
check('inside the account\'s free month: the player is added and nothing extra is charged', rTrial && rTrial.applied === 'now' && charges().length === 0 && rTrial.charge_cents === 0, [rTrial, charges()]);
var rNoRate = run({ priceId: null }, { venue_id: 'v1', players: 81 });
check('unknown price: the capacity is granted and the charge is refused rather than guessed, and the page is told', rNoRate && rNoRate.applied === 'now' && rNoRate.charge_failed === true && charges().length === 0, [rNoRate, charges()]);

print('lowering the number: from the next cycle, nothing back (rule 2)');
var rDown = run({ current: 110 }, { venue_id: 'v1', players: 80 });
check('drop 110 to 80: the reduction waits for the renewal (pending 80) and the 110 stay until then',
  rDown && rDown.applied === 'next_renewal' && rDown.pending === 80 && patched[0].body.pending_players === 80 && patched[0].body.max_players === undefined, [rDown, patched]);
check('drop 110 to 80: NO refund and NO credit, so 30 added for one night still cost a month', charges().length === 0 && credits().length === 0 && rDown.credit_cents === 0, [calls, rDown]);
check('drop 110 to 80: the Stripe quantity is lowered now so the NEXT invoice is right', quantities().length === 1 && quantities()[0].params.proration_behavior === 'none', quantities());
var rBack = run({ current: 110, pending: 80 }, { venue_id: 'v1', players: 110 });
check('changing your mind before the bill: the reduction is cancelled and no money moves', rBack && rBack.applied === 'cancelled_reduction' && patched[0].body.pending_players === null && charges().length === 0 && credits().length === 0, [rBack, patched, calls]);
var rBasis = run({ current: 110, pending: 80 }, { venue_id: 'v1', players: 120 });
check('a reduction pending, then up to 120: only the 10 genuinely new players are charged', charges().length === 1 && charges()[0].params.quantity === 10, charges()[0] && charges()[0].params);

print('a yearly plan is its own rule and is untouched');
var rA = run({ plan: 'annual', priceId: ANNUAL }, { venue_id: 'v1', players: 81 });
check('yearly: adding is pro rata to the renewal, one amount, and the line says so', charges().length === 1 && typeof charges()[0].params.amount === 'number' && /pro rata to renewal/.test(charges()[0].params.description), charges()[0] && charges()[0].params);
var rAd = run({ plan: 'annual', priceId: ANNUAL, current: 110 }, { venue_id: 'v1', players: 80 });
check('yearly: lowering releases the players today and banks the unused value as credit', rAd && rAd.applied === 'now' && credits().length === 1 && credits()[0].params.amount < 0 && patched[0].body.max_players === 80, [rAd, credits(), patched]);

print('rule 4: the one-hour undo, behind VPB_BILLING_RULES_3NOV');
var ON = envWith({ VPB_BILLING_RULES_3NOV: '1' });
check('the switch turns the undo on with the new pub rule: one switch, both rules', vpbRules(ON).undo_hour === true && vpbRules(envWith()).undo_hour === false, [vpbRules(ON), vpbRules(envWith())]);
var u0 = run({}, { venue_id: 'v1', players: 110 }, ON);
check('switch on: adding says the undo is open ("within an hour, as long as no game has started")', u0 && u0.undo_hour === true, u0);
var u0off = run({}, { venue_id: 'v1', players: 110 });
check('switch off: adding does not promise an undo', u0off && u0off.undo_hour === false, u0off);
check('the invoice item id is kept with the add, so the undo can delete that exact line', charges().length === 1 && audits.some(function (a) { return a.action === 'players_increased' && a.detail.billing && a.detail.billing.item === 'obj_2'; }), audits);
/* 59 minutes after adding 30, no game started: free. */
var u1 = run({ current: 110, lastUp: lastUp(59, 80, 110) }, { venue_id: 'v1', players: 80 }, ON);
check('undo at 59 min, no game: the invoice line is deleted, so nothing goes on the next bill', deletes.length === 1 && deletes[0] === 'invoiceitems/ii_1', deletes);
check('undo at 59 min: the page is told it was undone and the $75.00 that will not be billed', u1 && u1.applied === 'undone' && u1.undone_cents === 7500, u1);
check('undo at 59 min: the capacity goes back NOW (max_players 80), nothing pending', patched.length === 1 && patched[0].body.max_players === 80 && patched[0].body.pending_players === null, patched);
check('undo at 59 min: the Stripe quantity goes back now, no credit and no second charge', quantities().length === 1 && credits().length === 0 && charges().length === 0, calls);
check('undo at 59 min: HQ history gets a players_increase_undone row with the minutes and the money', audits.some(function (a) { return a.action === 'players_increase_undone' && a.detail.minutes_after === 59 && a.detail.undone_cents === 7500 && a.detail.invoice_item === 'ii_1'; }), audits);
/* 61 minutes: too late, the month stands and the decrease waits for the next cycle. */
var u2 = run({ current: 110, lastUp: lastUp(61, 80, 110) }, { venue_id: 'v1', players: 80 }, ON);
check('undo at 61 min: NOT undone, the charge stands', deletes.length === 0 && u2 && u2.applied === 'next_renewal' && u2.pending === 80, [deletes, u2]);
check('undo at 61 min: an ordinary reduction, nothing refunded', patched[0].body.pending_players === 80 && patched[0].body.max_players === undefined && credits().length === 0, [patched, calls]);
/* 10 minutes, but a game has started since: the players were used, the charge stands. */
var u3 = run({ current: 110, lastUp: lastUp(10, 80, 110), played: true }, { venue_id: 'v1', players: 80 }, ON);
check('undo at 10 min after a game started: NOT undone, the charge stands, reduction from the next cycle', deletes.length === 0 && u3 && u3.applied === 'next_renewal' && patched[0].body.pending_players === 80, [deletes, u3, patched]);
/* The switch off: no undo at all, even at 10 minutes with no game. */
var u4 = run({ current: 110, lastUp: lastUp(10, 80, 110) }, { venue_id: 'v1', players: 80 });
check('switch off at 10 min, no game: no undo, the ordinary reduction', deletes.length === 0 && u4 && u4.applied === 'next_renewal', [deletes, u4]);
/* Only back to (or below) the number before the add counts as an undo. */
var u5 = run({ current: 110, lastUp: lastUp(10, 80, 110) }, { venue_id: 'v1', players: 90 }, ON);
check('dropping only part of the way back (110 to 90) is a reduction, not an undo', deletes.length === 0 && u5 && u5.applied === 'next_renewal' && u5.pending === 90, [deletes, u5]);
var u5b = run({ current: 110, lastUp: lastUp(10, 80, 110) }, { venue_id: 'v1', players: 70 }, ON);
check('dropping below the number before the add (110 to 70) is undone to 70', deletes.length === 1 && u5b && u5b.applied === 'undone' && patched[0].body.max_players === 70, [deletes, u5b, patched]);
/* Stripe will not delete the line (the bill has already run): the increase stands, and the page is told. */
var u6 = run({ current: 110, lastUp: lastUp(10, 80, 110), refuseDelete: true }, { venue_id: 'v1', players: 80 }, ON);
check('Stripe refuses the delete: the ordinary reduction, and the page is told the undo did not happen', deletes.length === 1 && u6 && u6.applied === 'next_renewal' && u6.undo_failed === true, [deletes, u6]);
/* No increase on record, or one with no invoice line (inside the free month): nothing to undo. */
var u7 = run({ current: 110 }, { venue_id: 'v1', players: 80 }, ON);
check('no add on record: an ordinary reduction', deletes.length === 0 && u7 && u7.applied === 'next_renewal', [deletes, u7]);
var u8 = run({ current: 110, lastUp: { created_at: minutesAgo(5), detail: { from: 80, to: 110, billing: null } } }, { venue_id: 'v1', players: 80 }, ON);
check('an add that charged nothing (free month) has no line to delete: an ordinary reduction', deletes.length === 0 && u8 && u8.applied === 'next_renewal', [deletes, u8]);
/* A yearly plan never undoes: its reduction releases and credits today, which is already fair. */
var u9 = run({ plan: 'annual', priceId: ANNUAL, current: 110, lastUp: lastUp(10, 80, 110) }, { venue_id: 'v1', players: 80 }, ON);
check('yearly plan: no undo, the yearly release-and-credit path as before', deletes.length === 0 && u9 && u9.applied === 'now' && credits().length === 1, [deletes, u9, calls]);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('players timing: ' + fails + ' failed'); }
