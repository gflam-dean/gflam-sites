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

/* ================================================================================================
   B2. Adding the same players twice in a day charges twice. A retry of ONE request still charges once.
   ================================================================================================ */
section('B2 the same move made twice in a day is two charges; a retried request is still one');
var ON = Object.assign({}, ENV, { VPB_BILLING_RULES_3NOV: '1' });
function auditRows(action) { return DB.vp_admin_audit.filter(function (a) { return a.action === action; }); }

/* a) Monthly, the one-hour undo on: add 80, undo it, add the same 80 again. The second add used to send the
      first add's key, Stripe replayed the deleted item, nothing was charged and the page said $240. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
stripeReset({ quantity: 20 });
var p1 = call('/account/players', OWNER, { venue_id: V1, players: 100 }, ON);
check('a) monthly: the first add charges 80 x $3.00 = $240.00 (sanity)', p1.status === 200 && p1.body.charge_cents === 24000 && liveItemCents() === 24000, [p1.body, S.items]);
var p2 = call('/account/players', OWNER, { venue_id: V1, players: 20 }, ON);
check('a) monthly: the undo inside the hour deletes that line (sanity)', p2.body.applied === 'undone' && liveItemCents() === 0, [p2.body, S.items]);
var p3 = call('/account/players', OWNER, { venue_id: V1, players: 100 }, ON);
check('a) monthly: the SECOND add of the same 80 is a real, live charge', venueNamed('Home Pub').max_players === 100 && liveItemCents() === 24000, [venueNamed('Home Pub').max_players, S.items]);
check('a) monthly: the page is told $240.00 and $240.00 is what is on the bill', p3.body.charge_cents === liveItemCents(), [p3.body.charge_cents, liveItemCents()]);
var addKeys = S.posts.filter(function (p) { return /invoiceitems$/.test(p.url); }).map(function (p) { return p.key; });
check('a) monthly: the two adds used DIFFERENT keys', addKeys.length === 2 && addKeys[0] !== addKeys[1], addKeys);

/* b) Yearly plan, no switch needed: add 80, release them, add 80 again the same day. */
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
stripeReset({ quantity: 20, price: 'price_S_A', periodEnd: Math.floor(Date.now() / 1000) + 200 * 86400 });
var a1 = call('/account/players', OWNER, { venue_id: V1, players: 100 });
var firstCharge = liveItemCents();
var a2 = call('/account/players', OWNER, { venue_id: V1, players: 20 });
var a3 = call('/account/players', OWNER, { venue_id: V1, players: 100 });
check('b) yearly: add, release, add again: the second add makes its OWN charge', a1.status === 200 && a3.status === 200 && firstCharge > 0 && liveItemCents() === 2 * firstCharge, [firstCharge, S.items]);
check('b) yearly: the release still banked its credit (unchanged rule)', a2.status === 200 && S.balance < 0, [a2.body, S.balance]);
check('b) yearly: and the page was told what was really charged', a3.body.charge_cents === firstCharge, a3.body);

/* c) The same REQUEST twice (two tabs, a double click, a resent POST, both read the account before either
      wrote): the second must reuse the first's key so Stripe charges once. Modelled by putting the venue and
      the audit trail back exactly as the second request would have read them, then sending it again. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
stripeReset({ quantity: 20 });
call('/account/players', OWNER, { venue_id: V1, players: 100 }, ON);
var k1 = S.posts.filter(function (p) { return /invoiceitems$/.test(p.url); })[0];
venueNamed('Home Pub').max_players = 20;
DB.vp_admin_audit = DB.vp_admin_audit.filter(function (a) { return a.action !== 'players_increased'; });
call('/account/players', OWNER, { venue_id: V1, players: 100 }, ON);
var k2 = S.posts.filter(function (p) { return /invoiceitems$/.test(p.url); })[1];
check('c) a racing duplicate of ONE request sends the SAME key', !!k1 && !!k2 && k1.key === k2.key, [k1 && k1.key, k2 && k2.key]);
check('c) so Stripe charges it once', Object.keys(S.items).length === 1 && liveItemCents() === 24000, S.items);

/* e) The smallest move, add 1 / release 1 / add 1, on both plans (the second add is a real charge). */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
stripeReset({ quantity: 20 });
call('/account/players', OWNER, { venue_id: V1, players: 21 }, ON);
call('/account/players', OWNER, { venue_id: V1, players: 20 }, ON);
var e3 = call('/account/players', OWNER, { venue_id: V1, players: 21 }, ON);
check('e) monthly (switch on): add 1, undo, add 1 again: the second add is a live $3.00 charge', venueNamed('Home Pub').max_players === 21 && liveItemCents() === 300 && e3.body.charge_cents === 300, [S.items, e3.body]);
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
stripeReset({ quantity: 20, price: 'price_S_A', periodEnd: Math.floor(Date.now() / 1000) + 200 * 86400 });
call('/account/players', OWNER, { venue_id: V1, players: 21 });
var one = liveItemCents();
call('/account/players', OWNER, { venue_id: V1, players: 20 });
call('/account/players', OWNER, { venue_id: V1, players: 21 });
check('e) yearly: add 1, release 1, add 1 again: the second add makes its own charge', one > 0 && liveItemCents() === 2 * one && Object.keys(S.items).length === 2, [one, S.items]);

/* d) Yearly release made twice in a day (release 80, add them back, release 80 again): the second release
      banks its own credit too, rather than replaying the first and losing the venue its money. */
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
stripeReset({ quantity: 100, price: 'price_S_A', periodEnd: Math.floor(Date.now() / 1000) + 200 * 86400 });
call('/account/players', OWNER, { venue_id: V1, players: 20 });
var c1 = S.balance;
call('/account/players', OWNER, { venue_id: V1, players: 100 });
call('/account/players', OWNER, { venue_id: V1, players: 20 });
var credits = S.posts.filter(function (p) { return /balance_transactions$/.test(p.url); });
check('d) yearly: two releases of the same 80 in one day bank two credits, with two keys', credits.length === 2 && credits[0].key !== credits[1].key && S.balance === 2 * c1, [credits.map(function (p) { return p.key; }), S.balance, c1]);

/* ================================================================================================
   B3. The new-pub free month cannot be farmed: a ceiling on one add, the yearly credit never more than was
   charged, and the credit squared when the players it was given for are dropped before it is used.
   ================================================================================================ */
section('B3 the new-pub free month is for the players kept through it');
var DAY = 86400, NOW = Math.floor(Date.now() / 1000);
function given() { return -S.balance - liveItemCents(); }   // what the account has been handed, net, in cents (credit minus charges)
function bigPub() { return venueNamed('Big Barn'); }
function monthlyWorld(players) {
  worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
  stripeReset({ quantity: 40, periodStart: NOW - 28 * DAY, periodEnd: NOW + 2 * DAY, anchor: NOW - 28 * DAY });
  var r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: players, postcode: '4999' }, ON);
  return r;
}

/* a) The ceiling. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
stripeReset({ quantity: 40 });
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 20000, postcode: '4999' }, ON);
check('a) 20,000 players on one add is refused, nothing made or charged', r.status === 400 && !bigPub() && S.balance === 0 && quantityPosts().length === 0, r);
check('a) and the message says the ceiling and who to call', /2,000/.test(r.body.error || '') && /07 5228 3667/.test(r.body.error || ''), r.body.error);
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 2000, postcode: '4999' }, ON);
check('a) 2,000 (the ceiling HQ sets venues up with) is still added', r.status === 200 && !!bigPub(), r);

/* b) Monthly, pro rata rule on: add 2,000, take the credit, drop to 1 before the bill. The credit kept is
      the free part for the 1 player still billed, never the 2,000's. */
r = monthlyWorld(2000);
var c0 = r.body.free_month_cents;
check('b) monthly: the add credits the 2,000-player free part (sanity: the rule as written)', r.status === 200 && r.body.free_rule === 'prorata' && c0 > 0 && S.balance === -c0, [r.body, S.balance]);
var d = call('/account/players', OWNER, { venue_id: bigPub().id, players: 1 }, ON);
check('b) monthly: dropping to 1 takes the unearned 1,999 players\' share back off', d.status === 200 && -S.balance === Math.round(c0 / 2000), [S.balance, c0]);
check('b) monthly: what is left is no more than the 1 player\'s month the next bill charges ($3.00)', given() <= 300, given());
/* ...and raising it back gives the credit back: an honest change of mind costs nothing. */
call('/account/players', OWNER, { venue_id: bigPub().id, players: 2000 }, ON);
check('b) monthly: putting the 2,000 back puts the whole credit back', S.balance === -c0, [S.balance, c0]);

/* ...and the same drop made a SECOND time the same day takes the credit back again (its own Stripe key: drop,
   raise, drop is the same before/after pair twice, and Stripe would replay the first). */
call('/account/players', OWNER, { venue_id: bigPub().id, players: 1 }, ON);
var tk = S.posts.filter(function (p) { return /balance_transactions$/.test(p.url) && /^vfmt:/.test(p.key || ''); }).map(function (p) { return p.key; });
check('b) monthly: drop, raise back, drop again: the second drop is taken back too, with three different keys',
  -S.balance === Math.round(c0 / 2000) && tk.length === 3 && tk[0] !== tk[2], [S.balance, c0, tk]);

/* c) Monthly, cancel the pub before the bill: its credit goes with it; un-cancel puts it back. */
r = monthlyWorld(2000);
c0 = r.body.free_month_cents;
var cx = call('/account/cancel-venue', OWNER, { venue_id: bigPub().id, reason: 'other' }, ON);
check('c) monthly: a pub cancelled inside its unused free month leaves no credit behind', cx.status === 200 && S.balance === 0, [cx, S.balance]);
call('/account/cancel-venue', OWNER, { venue_id: bigPub().id, undo: true }, ON);
check('c) monthly: changing their mind puts the credit back', S.balance === -c0, [S.balance, c0]);

/* d) Honest controls. Add 10, raise to 20 (charged a month for the 10 extra), drop back to 10: the free month
      for the 10 it was given for stands. */
r = monthlyWorld(10);
c0 = r.body.free_month_cents;
call('/account/players', OWNER, { venue_id: bigPub().id, players: 20 }, ON);
call('/account/players', OWNER, { venue_id: bigPub().id, players: 10 }, ON);
check('d) control: add 10, raise to 20, back to 10: the 10-player free month is untouched', S.balance === -c0 && DB.vp_admin_audit.filter(function (a) { return a.action === 'free_month_trued_up'; }).length === 0, [S.balance, c0]);
/* After the renewal that used the credit, a reduction is an ordinary reduction. */
r = monthlyWorld(100);
/* The bill that carried the credit has run: the cycle now starts AFTER the add. Only the start moves, so every
   other figure the true-up works from is the add's own and the one thing that says "used" is the date. */
S.sub.periodStart = NOW + 3600;
var before = S.balance;
call('/account/players', OWNER, { venue_id: bigPub().id, players: 1 }, ON);
check('d) control: after the bill that used it, dropping players takes nothing back', S.balance === before, [S.balance, before]);
/* Switch off (today's live rule): the month charged and the month credited sit on the same next bill. */
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
stripeReset({ quantity: 40, periodStart: NOW - 28 * DAY, periodEnd: NOW + 2 * DAY });
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 2000, postcode: '4999' });
call('/account/players', OWNER, { venue_id: bigPub().id, players: 1 });
check('d) control, switch off: the month charged and credited cancel out, nothing extra is taken', r.body.free_rule === 'month' && given() === 0 && S.balance === -600000, [r.body.free_rule, given(), S.balance]);

/* Raising a pub ABOVE its number after a drop (the increase path, charged as any increase) gives the credit back too. */
r = monthlyWorld(100);
c0 = r.body.free_month_cents;
call('/account/players', OWNER, { venue_id: bigPub().id, players: 10 }, ON);
var mid = S.balance;
call('/account/players', OWNER, { venue_id: bigPub().id, players: 150 }, ON);
check('d) control: add 100, drop to 10, raise to 150: the 100-player free month is whole again', mid > -c0 && S.balance === -c0, [mid, S.balance, c0]);

/* e) Yearly, a few days before renewal: the charge is a few days pro rata, the credit used to be a whole month. */
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
stripeReset({ quantity: 40, price: 'price_S_A', periodStart: NOW - 362 * DAY, periodEnd: NOW + 3 * DAY });
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 2000, postcode: '4999' });
var charged = liveItemCents();
check('e) yearly: the free month credit is never more than was charged for the pub', r.status === 200 && charged > 0 && r.body.free_month_cents === charged && S.balance === -charged, [r.body.free_month_cents, charged, S.balance]);
d = call('/account/players', OWNER, { venue_id: bigPub().id, players: 1 });
check('e) yearly: dropping to 1 inside the free month leaves the account no better off than a cent of rounding', d.status === 200 && given() <= 1, [given(), charged, S.balance]);
/* Control: a yearly pub whose free month is OVER releases players the ordinary way (the release credit only). */
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
stripeReset({ quantity: 40, price: 'price_S_A', periodStart: NOW - 100 * DAY, periodEnd: NOW + 265 * DAY });
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 30, postcode: '4999' });
bigPub().free_month_at = new Date((NOW - 40 * DAY) * 1000).toISOString();   // added 40 days ago
before = S.balance;
call('/account/players', OWNER, { venue_id: bigPub().id, players: 10 });
var rel = S.posts.filter(function (p) { return /balance_transactions$/.test(p.url); }).slice(-1)[0];
check('e) control: yearly, free month over: dropping players takes nothing of the free month back (only the release credit moves)',
  S.balance < before && DB.vp_admin_audit.filter(function (a) { return a.action === 'free_month_trued_up'; }).length === 0 && /released/.test(sform(rel.body).description || ''), [before, S.balance, rel && sform(rel.body).description]);
/* Control: a yearly pub that keeps its players keeps a month free when there is more than a month to run. */
worldReset({ plan: 'annual' }, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 40 }]);
stripeReset({ quantity: 40, price: 'price_S_A', periodStart: NOW - 65 * DAY, periodEnd: NOW + 300 * DAY });
r = call('/account/add-venue', OWNER, { name: 'Big Barn', players: 30, postcode: '4999' });
check('e) control: yearly with 300 days to run, the pub still gets a whole month (30 x the yearly rate) as before', r.status === 200 && r.body.free_month_cents > 0 && r.body.free_month_cents < liveItemCents() && S.balance === -r.body.free_month_cents, [r.body, liveItemCents()]);

/* ================================================================================================
   B6. A venue off for an unpaid SUBSCRIPTION comes back on only when that is paid.
   ================================================================================================ */
section('B6 only the subscription being paid lifts a non-payment suspension');
var _applyPending = vpbApplyPendingOnInvoice, _invEmail = vpaFireInvoiceEmail;
vpbApplyPendingOnInvoice = function () { return Promise.resolve(); };   // the renewal's own work, not the question here
vpaFireInvoiceEmail = function () { return Promise.resolve(); };
function webhook(evt) {
  var out = null;
  vpaHandleStripeEvent(ENV, evt).then(function () { out = { ok: true }; }, function (e) { out = { threw: String(e && e.message || e) }; });
  for (var i = 0; i < 2000 && !out; i++) drainMicrotasks();
  return out || { threw: 'never finished' };
}
function offWorld(subStatus) {
  worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', status: 'suspended', suspended_reason: 'nonpayment' }]);
  stripeReset({ sub: subStatus === null ? null : { id: 'sub_1', status: subStatus, customer: 'cus_1', price: 'price_S_M', quantity: 20, periodEnd: 1790000000 } });
}
function paid(reason, sub) { return { id: 'evt_' + (++S.n), type: 'invoice.paid', data: { object: { id: 'in_' + S.n, customer: 'cus_1', billing_reason: reason, subscription: sub || null, amount_paid: 3500 } } }; }

offWorld('past_due');
var w = webhook(paid('manual', null));
check('a) a paid $35 extras invoice does NOT switch a venue off for an unpaid subscription back on', w.ok && venueNamed('Home Pub').status === 'suspended' && venueNamed('Home Pub').suspended_reason === 'nonpayment', [w, venueNamed('Home Pub')]);
offWorld('active');
w = webhook(paid('subscription_cycle', 'sub_1'));
check('b) the subscription invoice paid and the subscription active again: back on (as before)', w.ok && venueNamed('Home Pub').status === 'active' && venueNamed('Home Pub').suspended_reason === null, [w, venueNamed('Home Pub')]);
offWorld('past_due');
w = webhook(paid('subscription_cycle', 'sub_1'));
check('c) one subscription invoice paid but another still unpaid (still past_due): stays off', w.ok && venueNamed('Home Pub').status === 'suspended', [w, venueNamed('Home Pub')]);
offWorld(null);
w = webhook(paid('subscription_cycle', 'sub_1'));
check('d) the subscription cannot be read: the webhook fails so Stripe sends it again, and nothing is switched on', !!w.threw && venueNamed('Home Pub').status === 'suspended', [w, venueNamed('Home Pub')]);
worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000' }]);
stripeReset({ sub: null });
w = webhook(paid('manual', null));
check('e) control: an ordinary invoice.paid with nothing off makes no extra Stripe read', w.ok && S.posts.filter(function (p) { return /subscriptions\//.test(p.url); }).length === 0, S.posts);
vpbApplyPendingOnInvoice = _applyPending; vpaFireInvoiceEmail = _invEmail;

/* ================================================================================================
   B7. An HQ login can record only HQ's own marks; the Worker acts only on rows it could have written.
   ================================================================================================ */
section('B7 /admin/audit takes HQ marks only; rows the Worker acts on must be the Worker\'s');
var STAFF = '33333333-3333-4333-8333-333333333331', HQOWN = '33333333-3333-4333-8333-333333333332';
function hqWorld() {
  worldReset({}, [{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 20 }]);
  DB.vp_platform_admins = [{ auth_user_id: STAFF, role: 'staff', label: 'Help desk' }, { auth_user_id: HQOWN, role: 'owner', label: 'Dean' }];
  stripeReset({ quantity: 100 });
}
hqWorld();
var h1 = call('/admin/audit', STAFF, { action: 'players_increased', target: 'venue:' + V1, detail: { from: 999, billing: { kind: 'charge', item: 'ii_9', cents: 1 } } });
check('a) a help desk login cannot write a players_increased row', h1.status === 400 && DB.vp_admin_audit.length === 0, [h1, DB.vp_admin_audit]);
var h2 = call('/admin/audit', STAFF, { action: 'payment_disputed', target: 'account:f1' });
var h3 = call('/admin/audit', HQOWN, { action: 'permit_register_checked', target: 'venue:' + V1, detail: { kind: 'raffle' } });
check('a) nor a chargeback marker, nor (even as HQ owner) a permit check record', h2.status === 400 && h3.status === 400 && DB.vp_admin_audit.length === 0, [h2, h3]);
var h4 = call('/admin/audit', STAFF, { action: 'view_as', target: 'venue:' + V1, detail: { name: 'Home Pub' } });
var h5 = call('/admin/audit', STAFF, { action: 'venue_quiet_contacted', target: 'venue:' + V1 });
check('a) control: HQ\'s own marks (view as, contacted) are still written', h4.status === 200 && h5.status === 200 && DB.vp_admin_audit.length === 2, [h4, h5]);

/* b) A players_increased row already in the table that no owner or View-as could have written (a help desk
      login, before this fix) is never acted on: the next reduction does not delete the line it names. */
hqWorld();
venueNamed('Home Pub').max_players = 100;
S.items.ii_9 = { id: 'ii_9', cents: 500, deleted: false, description: 'someone else\'s big night' };
DB.vp_admin_audit.push({ id: 'x1', action: 'players_increased', target: 'venue:' + V1, actor_admin: STAFF, actor_label: 'Help desk',
  detail: { from: 999, to: 100, billing: { kind: 'charge', item: 'ii_9', cents: 500 } }, created_at: new Date().toISOString() });
var u1 = call('/account/players', OWNER, { venue_id: V1, players: 50 }, ON);
check('b) a forged players_increased row: the reduction is ordinary and the line it names is NOT deleted', u1.status === 200 && u1.body.applied !== 'undone' && S.items.ii_9.deleted === false, [u1.body, S.items.ii_9]);
/* Control: the same row written by HQ View as (an owner admin) is honoured, as before. */
hqWorld();
venueNamed('Home Pub').max_players = 100;
S.items.ii_9 = { id: 'ii_9', cents: 24000, deleted: false, description: 'Home Pub - Extra Player' };
DB.vp_admin_audit.push({ id: 'x2', action: 'players_increased', target: 'venue:' + V1, actor_admin: HQOWN, actor_label: 'Dean',
  detail: { from: 20, to: 100, billing: { kind: 'charge', item: 'ii_9', cents: 24000 } }, created_at: new Date().toISOString() });
var u2 = call('/account/players', OWNER, { venue_id: V1, players: 20 }, ON);
check('b) control: an increase made through HQ View as (owner admin) can still be undone inside the hour', u2.body.applied === 'undone' && S.items.ii_9.deleted === true, [u2.body, S.items.ii_9]);

/* c) The VIC permit check record counts only when an owner or accounts admin recorded it. */
hqWorld();
DB.vp_admin_audit.push({ id: 'p1', action: 'permit_register_checked', target: 'venue:' + V1, actor_admin: STAFF, actor_label: 'Help desk',
  detail: { kind: 'raffle', number: 'R1', holder: 'venue', npo_name: '' }, created_at: '2026-11-10T00:00:00Z' });
var permits = { raffle: { number: 'R1', holder: 'venue' } };
var rc1 = null; vpaRegisterChecks(ENV, V1, permits).then(function (x) { rc1 = x; }); for (var i = 0; i < 200 && !rc1; i++) drainMicrotasks();
check('c) a permit check row a help desk login wrote is not a permit check', rc1 && !rc1.raffle, rc1);
DB.vp_admin_audit.push({ id: 'p2', action: 'permit_register_checked', target: 'venue:' + V1, actor_admin: HQOWN, actor_label: 'Dean',
  detail: { kind: 'raffle', number: 'R1', holder: 'venue', npo_name: '' }, created_at: '2026-11-09T00:00:00Z' });
var rc2 = null; vpaRegisterChecks(ENV, V1, permits).then(function (x) { rc2 = x; }); for (i = 0; i < 200 && !rc2; i++) drainMicrotasks();
check('c) control: the one an owner admin recorded is', rc2 && rc2.raffle && rc2.raffle.by === 'Dean' && rc2.raffle.current === true, rc2);

print('');
if (bad) throw new Error('billing abuse: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
