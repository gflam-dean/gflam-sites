/* MONEY THAT COULD BE TAKEN FOR NOTHING (security review part B, 13 Nov 2026, INBOX 370).

   RUNS the real billing Worker through its own router (tools/rig-billing-worker.js: the real file, a fake
   PostgREST that keeps every row) with a fake Stripe in front of it that behaves the way Stripe does where
   it matters here:
     - a subscription has a status and ONE item whose quantity a POST changes, or refuses (cancelled)
     - an invoice item is a real line that can be deleted, a balance transaction moves the customer balance
     - an Idempotency-Key seen before, with the same parameters, REPLAYS the saved answer and does nothing
       (Stripe keeps keys 24 hours); with different parameters it is refused
   Each case asserts the SAFE outcome, so on the code before the fixes it prints FAIL. Each fix commit says
   which section closes which finding.

     B1  /account/add-venue switched a venue ON with no live subscription behind it
     B2  the same players added twice in a day: the second add replayed the first charge (free)
     B3  the new-pub free month credit could be farmed: no player ceiling, never taken back
     B6  paying ANY invoice lifted a suspension for a failed SUBSCRIPTION payment
     B7  any HQ login could write audit rows the Worker then ACTS on

   Run from the repo root:  jsc tools/test-billing-abuse-13nov.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 500) : '')); } }
function section(t) { print(''); print(t); }
function Response(body, init) { this._b = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
function URL(u) { var m = /^https?:\/\/[^\/]+([^?#]*)(\?[^#]*)?/.exec(u) || []; this.pathname = m[1] || '/'; this.search = m[2] || '';
  this.searchParams = { get: function () { return null; }, has: function () { return false; } }; }
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
/* Nothing here is about the onboarding email; it would only add Resend traffic to read past. */
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

/* ================================================================================================
   B1. /account/add-venue switches a venue on only when a live subscription is behind it.
   ================================================================================================ */
section('B1 add-venue needs a live subscription, and a Stripe refusal leaves the venue as it was');

/* a) The subscription has ENDED (owner cancelled, or a chargeback: both end in customer.subscription.deleted).
      The owner "adds" the same pub again. It used to come straight back on, with Stripe refusing the quantity. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'ended', max_players: 60 }]);
stripeReset({ sub: { id: 'sub_1', status: 'canceled', customer: 'cus_1', price: 'price_S_M', quantity: 60, periodEnd: 1790000000 } });
var r = call('/account/add-venue', OWNER, { name: 'Home Pub', players: 60, postcode: '4000' });
check('a) ended subscription: refused', r.status === 409 && !r.body.ok, r);
check('a) ended subscription: the ended venue stays OFF', venueNamed('Home Pub').status === 'suspended' && venueNamed('Home Pub').suspended_reason === 'ended', venueNamed('Home Pub'));
check('a) ended subscription: the message points at a person (lowercase venueplay, the support line)', /07 5228 3667|support@venueplay\.com\.au/.test(r.body.error || ''), r.body.error);
check('a) ended subscription: nothing charged', liveItemCents() === 0 && S.balance === 0, S);

/* b) A prospect: no card, no subscription. A second pub used to be made active and never billed. */
worldReset({ stripe_subscription_id: null, stripe_customer_id: null, status: 'pending' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 10 }]);
stripeReset({ sub: null });
r = call('/account/add-venue', OWNER, { name: 'Second Pub', players: 300, postcode: '4001' });
check('b) prospect with no card: refused, told to add a card', r.status === 409 && /card/i.test(r.body.error || '') && r.body.add_card === true, r);
check('b) prospect with no card: no second venue made', DB.vp_venues.length === 1, DB.vp_venues.map(function (v) { return v.name; }));

/* c) A prospect whose free month ran out (paused) cannot switch its own pub back on by "adding" it. */
worldReset({ stripe_subscription_id: null, stripe_customer_id: null, status: 'pending' },
           [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'free_month_ended', max_players: 10 }]);
stripeReset({ sub: null });
r = call('/account/add-venue', OWNER, { name: 'Home Pub', players: 10, postcode: '4000' });
check('c) paused prospect: refused and its venue stays off', r.status === 409 && venueNamed('Home Pub').status === 'suspended', [r, venueNamed('Home Pub')]);

/* d) A chargeback is recorded on the account (vpaRecordDispute). The restart route refuses it; so does this one,
      even with a subscription still answering 'active'. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' }, { id: 'v-old', name: 'Old Pub', postcode: '4002', status: 'suspended', suspended_reason: 'cancelled' }]);
DB.vp_admin_audit.push({ id: 1, action: 'payment_disputed', target: 'account:f1', actor_admin: null, actor_label: 'stripe', detail: {}, created_at: '2026-11-01T00:00:00Z' });
stripeReset({});
r = call('/account/add-venue', OWNER, { name: 'Old Pub', players: 30, postcode: '4002' });
check('d) chargeback on the account: refused, the old pub stays off', r.status === 409 && venueNamed('Old Pub').status === 'suspended', [r, venueNamed('Old Pub')]);
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('d) chargeback on the account: no new venue either', r.status === 409 && !venueNamed('Brand New Pub'), r);
check('d) chargeback on the account: Stripe was never asked to change anything', quantityPosts().length === 0, quantityPosts());

/* e) Archived by HQ: a person switched it off on purpose, so it is not the owner's to undo from this form. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' }, { id: 'v-arc', name: 'Archived Pub', postcode: '4004', status: 'suspended', suspended_reason: 'archived' }]);
stripeReset({});
r = call('/account/add-venue', OWNER, { name: 'Archived Pub', players: 30, postcode: '4004' });
check('e) archived by HQ: refused, and it stays off', r.status === 409 && venueNamed('Archived Pub').status === 'suspended', [r, venueNamed('Archived Pub')]);

/* f) Unpaid subscription invoice: refused, pointed at the card. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' }]);
stripeReset({ sub: { id: 'sub_1', status: 'past_due', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('f) unpaid invoice: refused, pointed at the card, nothing made', r.status === 409 && r.body.update_card === true && !venueNamed('Brand New Pub'), r);

/* g) Stripe refuses the quantity change on a LIVE subscription. A cancelled pub coming back goes back to
      exactly what it was; a new pub is never made. Neither is answered as a success. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' },
                { id: 'v-c', name: 'Came Back Pub', postcode: '4005', status: 'suspended', suspended_reason: 'cancelled', cancel_at_period_end: true, max_players: 30, closed_at: '2026-10-20T00:00:00Z' }]);
stripeReset({ refuseQuantity: true });
r = call('/account/add-venue', OWNER, { name: 'Came Back Pub', players: 80, postcode: '4005' });
var cb = venueNamed('Came Back Pub');
check('g) refused quantity, venue coming back: not a success', r.status >= 400 && !r.body.ok, r);
check('g) refused quantity, venue coming back: put back exactly as it was (off, cancelled, 30 players, closed date kept)',
  cb.status === 'suspended' && cb.suspended_reason === 'cancelled' && cb.cancel_at_period_end === true && cb.max_players === 30 && cb.closed_at === '2026-10-20T00:00:00Z', cb);
check('g) refused quantity, venue coming back: nothing charged', liveItemCents() === 0 && S.balance === 0, S.items);
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('g) refused quantity, new venue: not a success and NOT made', r.status === 502 && !venueNamed('Brand New Pub'), [r, DB.vp_venues.length]);
check('g) refused quantity, new venue: the page is told nothing was charged', /nothing was charged/i.test(r.body.error || ''), r.body.error);

/* Controls: the honest paths are unchanged. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' },
                { id: 'v-c', name: 'Came Back Pub', postcode: '4005', status: 'suspended', suspended_reason: 'cancelled', cancel_at_period_end: true, max_players: 30 }]);
stripeReset({ quantity: 20 });
r = call('/account/add-venue', OWNER, { name: 'Came Back Pub', players: 30, postcode: '4005' });
check('control: a cancelled pub on a LIVE subscription still comes back with the same form', r.status === 200 && r.body.readded === true && venueNamed('Came Back Pub').status === 'active', r);
check('control: and it is billed (quantity raised, a month charged, no second free month)', S.sub.quantity === 50 && liveItemCents() === 9000 && S.balance === 0, [S.sub.quantity, liveItemCents(), S.balance]);
stripeReset({ quantity: 20 });
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('control: a new pub on a paying account is added, billed and its month credited (as before)',
  r.status === 200 && r.body.ok === true && venueNamed('Brand New Pub').status === 'active' && S.sub.quantity === 80 && liveItemCents() === 9000 && S.balance === -9000, [r.body, S.sub.quantity, liveItemCents(), S.balance]);
worldReset({ status: 'card_on_file' }, [{ id: V1, name: 'Home Pub', postcode: '4000' }]);
stripeReset({ sub: { id: 'sub_1', status: 'trialing', customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('control: inside the account\'s own free month (trialing) a pub is still added, nothing charged', r.status === 200 && venueNamed('Brand New Pub').status === 'active' && liveItemCents() === 0, r);
worldReset({ status: 'comp', stripe_subscription_id: null, stripe_customer_id: null }, [{ id: V1, name: 'Home Pub', postcode: '4000' }]);
stripeReset({ sub: null });
r = call('/account/add-venue', OWNER, { name: 'Brand New Pub', players: 30, postcode: '4003' });
check('control: a free (comp) account still adds a pub, as on main (nothing on it is charged)', r.status === 200 && !!venueNamed('Brand New Pub'), r);

print('');
if (bad) throw new Error('billing abuse: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
