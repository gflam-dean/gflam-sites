/* A FAILED CARD THAT STRIPE HAS GIVEN UP ON (job "Account after leaving, pause or failed card", Thu 19 Nov 2026;
   Dean, INBOX 33 and 54.4: a failed-card account gets the same reduced view as a venue that has left, and player data
   goes at 90 days, as our privacy policy says).

   Before this, a venue switched off for non-payment while Stripe was still retrying ('nonpayment') stayed
   'nonpayment' for ever once Stripe ended the subscription: no 90-day clock (sweepRetention never selects it), Your
   account said "Update your card below" with no subscription left to pay into, and a restart was refused with the
   same words. Now customer.subscription.deleted turns it into 'ended' with closed_at, the same as a venue that was
   still on when Stripe ended it.

   RUNS the real billing Worker (tools/rig-billing-worker.js) through its own webhook handler and router with a fake
   Stripe (the same one as tools/test-billing-abuse-13nov.js), and the real sweepRetention out of venueplay-game.js
   for the 90 days.

   Run from the repo root:  jsc tools/test-failed-card-left.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 500) : '')); } }
function section(t) { print(''); print(t); }
function Response(body, init) { this._b = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
function URL(u) { var m = /^https?:\/\/[^\/]+([^?#]*)(\?[^#]*)?/.exec(u) || []; this.pathname = m[1] || '/'; this.search = m[2] || '';
  this.searchParams = { get: function () { return null; }, has: function () { return false; } }; }
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
vpbFireVenueOnboarding = function () { return Promise.resolve(false); };

/* ---------------- the fake Stripe ---------------- */
var S;   // the Stripe world, reset per case
function stripeReset(o) {
  o = o || {};
  S = { sub: o.sub === undefined ? { id: 'sub_1', status: 'active', customer: 'cus_1', price: o.price || 'price_S_M', quantity: o.quantity || 20,
                                     periodEnd: o.periodEnd || (Math.floor(Date.now() / 1000) + 20 * 86400), periodStart: o.periodStart || null, anchor: o.anchor || null } : o.sub,
        refuseQuantity: !!o.refuseQuantity, items: {}, n: 0, balance: 0, idem: {}, posts: [] };
}
function sres(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
  json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
function sform(body) { var o = {}; String(body || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('=');
  o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }); return o; }
function stripeAnswer(url, method, body) {
  var f = sform(body);
  if (/\/subscriptions\/[^/?]+/.test(url) && method === 'GET') {
    if (!S.sub) return [404, { error: { message: 'No such subscription' } }];
    return [200, { id: S.sub.id, status: S.sub.status, customer: S.sub.customer, current_period_end: S.sub.periodEnd,
      current_period_start: S.sub.periodStart, billing_cycle_anchor: S.sub.anchor,
      items: { data: [{ id: 'si_1', price: { id: S.sub.price }, quantity: S.sub.quantity }] } }];
  }
  if (/\/subscription_items\/si_1$/.test(url) && method === 'POST') {
    if (S.refuseQuantity || !S.sub || S.sub.status === 'canceled') return [400, { error: { message: 'You cannot update a subscription item on a canceled subscription.' } }];
    S.sub.quantity = +f.quantity; return [200, { id: 'si_1', quantity: +f.quantity }];
  }
  if (/\/invoiceitems$/.test(url) && method === 'POST') {
    var id = 'ii_' + (++S.n), cents = f.amount ? +f.amount : (+f.quantity * +f.unit_amount_decimal);
    S.items[id] = { id: id, cents: cents, deleted: false, description: f.description || '' };
    return [200, { id: id, object: 'invoiceitem' }];
  }
  if (/\/invoiceitems\/[^/]+$/.test(url) && method === 'DELETE') {
    var did = url.split('/').pop();
    if (S.items[did] && !S.items[did].deleted) { S.items[did].deleted = true; return [200, { id: did, deleted: true }]; }
    return [404, { error: { message: 'No such invoiceitem' } }];
  }
  if (/balance_transactions$/.test(url) && method === 'POST') { S.balance += +f.amount; return [200, { id: 'cbtxn_' + (++S.n), amount: +f.amount }]; }
  return [200, { id: 'x_' + (++S.n) }];
}
var _rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  url = String(url); opts = opts || {};
  if (url.indexOf('api.stripe.com') === -1) return _rigFetch(url, opts);
  var method = opts.method || 'GET', h = opts.headers || {}, key = null;
  for (var k in h) if (k.toLowerCase() === 'idempotency-key') key = h[k];
  S.posts.push({ url: url, method: method, body: String(opts.body || ''), key: key });
  if (key && S.idem[key]) {
    if (S.idem[key].body !== String(opts.body || '')) return sres(400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters' } });
    return sres(S.idem[key].status, S.idem[key].res);
  }
  var a = stripeAnswer(url, method, opts.body);
  if (key) S.idem[key] = { body: String(opts.body || ''), status: a[0], res: a[1] };
  return sres(a[0], a[1]);
};
function liveItemCents() { var n = 0; for (var k in S.items) if (!S.items[k].deleted) n += S.items[k].cents; return n; }
function quantityPosts() { return S.posts.filter(function (p) { return /subscription_items/.test(p.url) && p.method === 'POST'; }); }

/* ---------------- the database and the router ---------------- */
var OWNER = '11111111-1111-4111-8111-111111111111';
var V1 = '22222222-2222-4222-8222-222222222221';
function worldReset(acct, venues) {
  for (var t in DB) delete DB[t];
  DB.vp_platform_admins = [];
  DB.venueplay_founding = [Object.assign({ id: 'f1', contact_email: 'o@test.local', plan: 'monthly', status: 'card_on_file',
    stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', is_group: true }, acct || {})];
  DB.vp_venues = (venues || [{ id: V1, name: 'Home Pub', postcode: '4000' }]).map(function (v) {
    return Object.assign({ founding_id: 'f1', group_id: null, status: 'active', suspended_reason: null, max_players: 20, pending_players: null,
      cancel_at_period_end: false, slug: String(v.name || 'v').toLowerCase().replace(/\W+/g, '-'), created_at: '2026-09-01T00:00:00Z' }, v);
  });
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: V1, role: 'owner', permissions: null, display_name: 'Olive Owner' }];
  DB.vp_admin_audit = [];
  DB.auth = [{ id: OWNER, phone: '61400999888' }];
}
function call(path, who, body, env) {
  var out = null, txt = JSON.stringify(body || {});
  var req = { method: 'POST', url: 'https://api.test' + path,
              headers: { get: function (k) { return String(k).toLowerCase() === 'authorization' ? 'Bearer ' + who : null; } },
              text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
  Promise.resolve().then(function () { return _d.fetch(req, env || ENV); }).then(function (r) {
    var b = null; try { b = JSON.parse(r._b); } catch (e) { b = r._b; } out = { status: r.status, body: b || {} };
  }, function (e) { out = { status: 500, body: { error: 'THREW ' + String(e) } }; });
  for (var i = 0; i < 2000 && !out; i++) drainMicrotasks();
  return out || { status: 504, body: {} };
}
function venueNamed(n) { return DB.vp_venues.filter(function (v) { return v.name === n; })[0]; }

var V2 = '22222222-2222-4222-8222-222222222222', V3 = '22222222-2222-4222-8222-222222222223', V4 = '22222222-2222-4222-8222-222222222224';
function webhook(evt) {
  var out = null;
  vpaHandleStripeEvent(ENV, evt).then(function () { out = { ok: true }; }, function (e) { out = { threw: String(e && e.message || e) }; });
  for (var i = 0; i < 2000 && !out; i++) drainMicrotasks();
  return out || { threw: 'never finished' };
}
var EV = 0;
function deleted() { return { id: 'evt_del_' + (++EV), type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } }; }
function paid() { return { id: 'evt_paid_' + (++EV), type: 'invoice.paid', data: { object: { id: 'in_' + EV, customer: 'cus_1', billing_reason: 'subscription_cycle', subscription: 'sub_1', amount_paid: 5000 } } }; }
function auditRows(a) { return (DB.vp_admin_audit || []).filter(function (r) { return r.action === a; }); }
function near(iso, ms) { var t = Date.parse(iso || ''); return isFinite(t) && Math.abs(t - ms) < 60000; }

section('a) Stripe gives up on a failed card: the venue that was off for non-payment has left');
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment', closed_at: null }]);
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
var t0 = Date.now();
var w = webhook(deleted());
var v = venueNamed('Home Pub');
check('the webhook finishes (Stripe is answered)', w.ok === true, w);
check('the venue stays off and is now ended, not waiting on a card', v.status === 'suspended' && v.suspended_reason === 'ended', v);
check('its 90-day clock starts now (closed_at)', near(v.closed_at, t0), v.closed_at);
var au = auditRows('venue_subscription_ended');
check('HQ has a record: one venue ended after a failed card', au.length === 1 && au[0].detail && au[0].detail.ended_after_failed_card === 1 && au[0].detail.switched_off_now === 0, au);

section('b) Your account shows the left view with the date the player details go');
var s = call('/account/summary', OWNER, {});
var st = s.body && s.body.standing;
check('/account/summary answers', s.status === 200, s);
check('standing: off, no games, like a subscription that has ended (Billing, Draws, Marketing only)', st && st.state === 'cancelled' && st.games === false, st);
check('kept_until is 90 days after it ended', st && near(st.kept_until, Date.parse(v.closed_at) + 90 * 86400000), [st && st.kept_until, v.closed_at]);
check('the page is no longer told the card is past due ("Update your card below" leads nowhere)', s.body && s.body.past_due !== true, s.body && s.body.past_due);

section('c) an old invoice paid later does not switch an ended venue back on (only non-payment is undone by money)');
stripeReset({ sub: { id: 'sub_1', status: 'active', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
w = webhook(paid());
v = venueNamed('Home Pub');
check('it stays ended, its clock untouched', w.ok && v.status === 'suspended' && v.suspended_reason === 'ended' && !!v.closed_at, [w, v]);

section('d) the same webhook twice changes nothing more (Stripe redelivers)');
var before = JSON.stringify(venueNamed('Home Pub'));
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
webhook(deleted());
check('the venue is exactly as it was, its clock not restarted', JSON.stringify(venueNamed('Home Pub')) === before, [before, venueNamed('Home Pub')]);

section('e) every other venue on the account is treated as before');
worldReset({}, [
  { id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment' },
  { id: V2, name: 'Hand Off', postcode: '4000', status: 'suspended', suspended_reason: 'manual' },
  { id: V3, name: 'Still On', postcode: '4000' },
  { id: V4, name: 'Last Night', postcode: '4000', cancel_at_period_end: true }]);
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
webhook(deleted());
check('the failed-card venue: ended, clock on', venueNamed('Home Pub').suspended_reason === 'ended' && !!venueNamed('Home Pub').closed_at, venueNamed('Home Pub'));
check('a venue we switched off by hand keeps its reason and gets no clock', venueNamed('Hand Off').suspended_reason === 'manual' && !venueNamed('Hand Off').closed_at, venueNamed('Hand Off'));
check('a venue still on is switched off now and ended, clock on (as before)', venueNamed('Still On').status === 'suspended' && venueNamed('Still On').suspended_reason === 'ended' && !!venueNamed('Still On').closed_at, venueNamed('Still On'));
check('a venue the owner cancelled keeps its last night (as before)', venueNamed('Last Night').status === 'active' && venueNamed('Last Night').suspended_reason === 'ending', venueNamed('Last Night'));
au = auditRows('venue_subscription_ended');
check('one record names all three', au.length === 1 && au[0].detail.ended_after_failed_card === 1 && au[0].detail.switched_off_now === 1 && au[0].detail.keeping_last_night === 1, au);

section('f) control: while Stripe is still retrying, a failed card is only waiting on the card');
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment' }]);
stripeReset({ sub: { id: 'sub_1', status: 'past_due', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
s = call('/account/summary', OWNER, {});
st = s.body && s.body.standing;
check('no clock, the page is told it is past due, so it says "Update your card below"', venueNamed('Home Pub').suspended_reason === 'nonpayment' && st && st.games === false && st.kept_until === null && s.body.past_due === true, [st, s.body && s.body.past_due]);
S.sub.status = 'active';   // the card works on Stripe's retry, so the subscription is active again
w = webhook(paid());
check('and paying it switches the games straight back on (as before)', venueNamed('Home Pub').status === 'active' && venueNamed('Home Pub').suspended_reason === null, venueNamed('Home Pub'));

section('g) the nightly retention sweep (venueplay-game.js) takes it at 90 days, never before');
var gsrc = readFile('venueplay-backend/worker/venueplay-game.js')
  .replace(/^export default/m, 'var _dGame =').replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '');
var G = (new Function('console', gsrc + '\n;return { sweep: sweepRetention, stub: function (o) { sbGet = o.get; sbGetAll = o.get; sbCount = o.count; sbPatch = o.patch; } };'))({ log: function () {}, error: function () {}, warn: function () {} });
function sweepPicks(row, nowMs) {
  var asked = null, realNow = Date.now;
  G.stub({ get: function (env, table, q) { if (table === 'vp_venues' && asked === null) asked = q; return Promise.resolve([]); },
           count: function () { return Promise.resolve(0); }, patch: function () { return Promise.resolve({}); } });
  Date.now = function () { return nowMs; };
  var done = false; G.sweep({}).then(function () { done = true; }, function () { done = true; });
  for (var i = 0; i < 200 && !done; i++) drainMicrotasks();
  Date.now = realNow;
  var cut = /closed_at=lt\.([^&]+)/.exec(asked || ''), st2 = /status=eq\.([^&]+)/.exec(asked || ''), rs = /suspended_reason=in\.\(([^)]*)\)/.exec(asked || '');
  if (!cut || !st2 || !rs) return 'query not understood: ' + asked;
  return Date.parse(row.closed_at) < Date.parse(decodeURIComponent(cut[1])) && row.status === st2[1] && rs[1].split(',').indexOf(row.suspended_reason) !== -1 && !row.player_data_purged_at;
}
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment' }]);
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
webhook(deleted());
v = venueNamed('Home Pub');
var closed = Date.parse(v.closed_at);
check('the day before the 90 days are up: not taken', sweepPicks(v, closed + 89 * 86400000) === false, sweepPicks(v, closed + 89 * 86400000));
check('a day after: taken, as the privacy policy says', sweepPicks(v, closed + 91 * 86400000) === true, sweepPicks(v, closed + 91 * 86400000));
var stillNonpay = { status: 'suspended', suspended_reason: 'nonpayment', closed_at: v.closed_at };
check('control: a venue still off for non-payment is never taken, however old its date', sweepPicks(stillNonpay, closed + 400 * 86400000) === false);

section('h) coming back: no more "update your card" dead end (the restart itself stays behind VPB_SELF_RESTART)');
var RON = Object.assign({}, ENV, { VPB_SELF_RESTART: '1' });
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment' }]);
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
var q0 = call('/account/restart-quote', OWNER, { venue_id: V1 }, RON);
check('before (the old state): the quote says "Update your card below" though there is no subscription to update', q0.body && q0.body.can_restart === false && q0.body.update_card === true, q0.body);
webhook(deleted());
var q1 = call('/account/restart-quote', OWNER, { venue_id: V1 }, RON);
check('after: the account is offered the same restart as any ended subscription, within its 90 days', q1.body && q1.body.can_restart === true && q1.body.update_card !== true && near(q1.body.restart_until, Date.parse(venueNamed('Home Pub').closed_at) + 90 * 86400000), q1.body);
var q2 = call('/account/restart-quote', OWNER, { venue_id: V1 });
check('and with the switch off (as live today) nothing can be restarted from the page', q2.body && q2.body.can_restart !== true, q2.body);

print('');
if (bad) throw new Error('failed card left: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
