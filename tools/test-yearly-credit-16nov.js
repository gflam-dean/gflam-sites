/* THE YEARLY CREDIT, HELD FOR THE PAYER (INBOX 419 DECISION + add-on, Dean 16 Nov 2026; Terms line 122; migration 199).

   RUNS the real billing Worker through tools/rig-billing-worker.js (a fake PostgREST that keeps every row, a fake Stripe that keeps the
   customer balance and honours Idempotency-Key) and a FAKE CLOCK (Date.now is pinned, so "month 4 of the year" is exact):

     value of a cut   = players released x yearly rate x 12 x (months left / 12)       e.g. 10 x $2.85 x 12 x 8/12 = $228.00
     YEARLY           the players go today, nothing is refunded, the value is held as credit for NEXT year's bill, on the PAYER
     MONTHLY          the cut waits for the next bill (pending_players), no credit, no refund
     THE PAYER        a card account that pays for several pubs holds the credit for ALL of them; a hand-invoiced vp_venue_groups
                      group holds it for the GROUP (a cut, or a pub it sells or removes); a pub that pays for itself holds its own;
                      a pub that leaves never takes it, and its new owner starts with none

   Run from the repo root:  jsc tools/test-yearly-credit-16nov.js */
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


/* ---------------- the fake clock: the year starts at T0, the renewal is exactly one year later ---------------- */
var T0 = 1790035200 - 36000,   // Brisbane midnight, so a group renewal DATE lands exactly on the renewal
     YEAR = 365 * 86400, MONTH = YEAR / 12;
var CLOCK = T0 * 1000;
Date.now = function () { return CLOCK; };
function atMonth(m) { CLOCK = (T0 + m * MONTH) * 1000; }            // m months into the paid year
var RENEW = T0 + YEAR;
var ADMIN = '99999999-9999-4999-8999-999999999999';
var _origAnswer = stripeAnswer;
stripeAnswer = function (url, method, body) {
  if (/\/customers\/[^/?]+$/.test(url) && method === 'GET') return [200, { id: 'cus_1', balance: S.balance }];
  return _origAnswer(url, method, body);
};
function ledger() { return DB.vp_billing_credits || []; }
function held(pt, pid) { return ledger().filter(function (r) { return r.payer_type === pt && r.payer_id === pid && r.status === 'held'; }); }
function sum(rows) { return rows.reduce(function (n, r) { return n + r.cents; }, 0); }
function yearlyWorld(venues, acct) {
  worldReset(Object.assign({ plan: 'annual' }, acct || {}), venues);
  DB.vp_billing_credits = []; DB.vp_venue_groups = [];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'accounts', label: 'Tester' }];
  stripeReset({ quantity: 100, price: 'price_S_A', periodStart: T0, periodEnd: RENEW });
}

/* ================================================================================================
   1. The arithmetic, at a fake month 4: 10 players cut from a 100-player yearly pub at $2.85 standard.
   ================================================================================================ */
section('1 the value held: 10 players x $2.85 x 12 x 8/12 = $228.00 (month 4 of 12)');
atMonth(4);
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
var c1 = call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('1) the answer: released today, $228.00 held, no refund', c1.status === 200 && c1.body.applied === 'now' && c1.body.credit_cents === 22800, c1.body);
check('1) the players went today (capacity 90, nothing pending)', venueNamed('Home Pub').max_players === 90 && venueNamed('Home Pub').pending_players === null, venueNamed('Home Pub'));
check('1) Stripe holds $228.00 as a credit on the customer balance (taken off the renewal), no refund line, no charge', S.balance === -22800 && liveItemCents() === 0, [S.balance, S.items]);
check('1) the ledger: one row, payer = the account f1, the pub named, 10 players, 8.0 months left, $228.00, held',
  ledger().length === 1 && ledger()[0].payer_type === 'founding' && ledger()[0].payer_id === 'f1' && ledger()[0].venue_id === V1 && ledger()[0].players_released === 10
  && ledger()[0].months_left === 8 && ledger()[0].cents === 22800 && ledger()[0].status === 'held' && ledger()[0].reason === 'yearly_cut', ledger());
check('1) an audit row says it', DB.vp_admin_audit.filter(function (a) { return a.action === 'credit_held' && a.target === 'founding:f1' && a.detail.cents === 22800; }).length === 1, DB.vp_admin_audit.map(function (a) { return a.action; }));
check('1) the Stripe quantity for the NEXT bill is 90, with no proration', S.sub.quantity === 90 && quantityPosts().every(function (p) { return /proration_behavior=none/.test(p.body); }), S.sub.quantity);
var sm = call('/account/summary', OWNER, {});
check('1) the billing screen: credit tile total $228.00 and the line "Home Pub: 10 players ... $228.00"',
  sm.status === 200 && sm.body.credit_cents === 22800 && sm.body.credit_ledger && sm.body.credit_ledger.length === 1 && sm.body.credit_ledger[0].venue === 'Home Pub'
  && sm.body.credit_ledger[0].players === 10 && sm.body.credit_ledger[0].cents === 22800, sm.body);

section('1b the clock: the same 10 players cut later in the year are worth less, and on renewal day nothing');
[[0, 34200], [6, 17100], [10, 5700], [12, 0]].forEach(function (p) {
  atMonth(p[0]);
  yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
  var r = call('/account/players', OWNER, { venue_id: V1, players: 90 });
  check('1b) month ' + p[0] + ': 10 x $2.85 x 12 x ' + (12 - p[0]) + '/12 = $' + (p[1] / 100).toFixed(2), r.status === 200 && r.body.credit_cents === p[1] && sum(held('founding', 'f1')) === p[1], [r.body, ledger()]);
});
atMonth(4);
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }], {});
stripeReset({ quantity: 100, price: 'price_F_A', periodStart: T0, periodEnd: RENEW });
var cf = call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('1b) a founding yearly rate ($2.30): 10 x $2.30 x 12 x 8/12 = $184.00', cf.body.credit_cents === 18400 && ledger()[0].rate_cents === 230, [cf.body, ledger()]);

section('1c a retried request holds the credit once; putting the players back charges the rest of the year and keeps the credit');
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
call('/account/players', OWNER, { venue_id: V1, players: 90 });
call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('1c) the same cut asked twice: one ledger row, one credit', ledger().length === 1 && S.balance === -22800, [ledger(), S.balance]);
var back = call('/account/players', OWNER, { venue_id: V1, players: 100 });
check('1c) 10 put back at month 4 are charged the rest of the year ($228.00) and the credit for the time in between stays held', back.body.charge_cents === 22800 && liveItemCents() === 22800 && S.balance === -22800 && held('founding', 'f1').length === 1, [back.body, S.balance, ledger()]);

section('1d a yearly venue still holding an old scheduled cut: an increase is measured from what is BILLED (70), not from the 100');
atMonth(4);
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100, pending_players: 70 }]);
var l1 = call('/account/players', OWNER, { venue_id: V1, players: 120 });
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
var l2 = call('/account/players', OWNER, { venue_id: V1, players: 120 });
check('1d) 70 billed to 120 charges 50 players, 100 to 120 charges 20: 50 x $2.85 x 8 months = $1,140.00, 20 x $2.85 x 8 = $456.00', l1.body.charge_cents === 114000 && l2.body.charge_cents === 45600, [l1.body, l2.body]);

section('1e the ledger write is keyed: the same move recorded twice is one row');
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
function hold(k) { var out = null; vpbHoldCredit(ENV, { payerType: 'founding', payerId: 'f1', venueId: V1, venueName: 'Home Pub', players: 10, rateCents: 285, monthsLeft: 8, cents: 22800, idemKey: k }).then(function (x) { out = x || 'none'; }); for (var i = 0; i < 500 && out === null; i++) drainMicrotasks(); return out; }
var h1 = hold('k1'), h2 = hold('k1'), h3 = hold('k2');
check('1e) the same key twice: one row and the same id back; a different key: a second row', ledger().length === 2 && h1 === h2 && h1 !== h3, [h1, h2, h3, ledger().length]);
check('1e) a move that is worth nothing (0 cents) writes nothing', (function () { var out = null; vpbHoldCredit(ENV, { payerType: 'founding', payerId: 'f1', players: 1, cents: 0, idemKey: 'k3' }).then(function (x) { out = x === null ? 'null' : x; }); for (var i = 0; i < 500 && out === null; i++) drainMicrotasks(); return out; })() === 'null' && ledger().length === 2, ledger().length);

section('2 MONTHLY: from the next bill, no credit, no ledger row');
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }], { plan: 'monthly' });
stripeReset({ quantity: 100, price: 'price_S_M', periodStart: T0, periodEnd: T0 + 30 * 86400 });
var m1 = call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('2) scheduled for the next bill, the 100 stay, no credit, no refund, no ledger row', m1.body.applied === 'next_renewal' && m1.body.credit_cents === 0 && venueNamed('Home Pub').max_players === 100
  && venueNamed('Home Pub').pending_players === 90 && S.balance === 0 && ledger().length === 0, [m1.body, venueNamed('Home Pub'), ledger()]);

section('3 PAYER = THE ACCOUNT: one card account, two pubs, a cut at pub A: the credit sits on the account, not on the pub');
yearlyWorld([{ id: V1, name: 'Pub A', postcode: '4000', max_players: 60 }, { id: 'v-b', name: 'Pub B', postcode: '4001', max_players: 40 }]);
DB.vp_venue_staff.push({ id: 's2', auth_user_id: OWNER, venue_id: 'v-b', role: 'owner', permissions: null, display_name: 'Olive Owner' });
var g1 = call('/account/players', OWNER, { venue_id: V1, players: 50 });
check('3) 10 cut at Pub A: $228.00 on the account f1 (payer_type founding), and no row names the pub as the payer', g1.body.credit_cents === 22800 && sum(held('founding', 'f1')) === 22800
  && ledger().every(function (r) { return r.payer_id === 'f1'; }), [g1.body, ledger()]);
var g2 = call('/account/players', OWNER, { venue_id: 'v-b', players: 35 });
check('3) 5 cut at Pub B later in the same month: the account holds both ($228.00 + $114.00 = $342.00), one balance', g2.body.credit_cents === 11400 && sum(held('founding', 'f1')) === 34200 && S.balance === -34200, [g2.body, ledger(), S.balance]);
/* The account sells Pub A: it is switched off for good. The credit stays with the account. */
venueNamed('Pub A').status = 'suspended'; venueNamed('Pub A').suspended_reason = 'cancelled'; venueNamed('Pub A').founding_id = 'f-new';
check('3) Pub A sold to a new owner (a different account): the old account still holds ALL $342.00, nothing moved with the pub', sum(held('founding', 'f1')) === 34200 && sum(held('founding', 'f-new')) === 0, ledger());

section('4 PAYER = THE GROUP (vp_venue_groups, invoiced by hand): a cut, a removed pub, a sold pub');
function groupWorld(term, renewIso) {
  yearlyWorld([{ id: V1, name: 'Group Pub A', postcode: '4000', max_players: 100, founding_id: null, group_id: 'g1' },
               { id: 'v-b', name: 'Group Pub B', postcode: '4001', max_players: 50, founding_id: null, group_id: 'g1' }]);
  DB.vp_venue_groups = [{ id: 'g1', name: 'Big Pub Group', negotiated_rate_cents: 250, billing_term: term, term_renewal: renewIso }];
  stripeReset({ quantity: 150, price: 'price_S_A', periodStart: T0, periodEnd: RENEW });
}
var RENEW_ISO = new Date((RENEW + 36000) * 1000).toISOString().slice(0, 10);   // the Brisbane date the renewal falls on
atMonth(4);
groupWorld('yearly', RENEW_ISO);
var rel = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4a) cut 10 at Group Pub A at month 4: 10 x $2.50 x 12 x 8/12 = $200.00 held on the GROUP', rel.status === 200 && rel.body.credit_cents === 20000 && rel.body.group_credit_cents === 20000, rel);
check('4a) the ledger payer is the group g1, never the pub; the pub is named only as where it came from',
  ledger().length === 1 && ledger()[0].payer_type === 'group' && ledger()[0].payer_id === 'g1' && ledger()[0].venue_id === V1 && ledger()[0].cents === 20000 && ledger()[0].status === 'held', ledger());
check('4a) the pub dropped to 90 today; no Stripe call of any kind (the group is invoiced by hand)', venueNamed('Group Pub A').max_players === 90 && S.posts.length === 0 && S.balance === 0, [venueNamed('Group Pub A'), S.posts]);
var rm = call('/admin/group-release', ADMIN, { venue_id: 'v-b', action: 'removed' });
check('4b) the group removes Group Pub B (50 players) at month 4: 50 x $2.50 x 12 x 8/12 = $1,000.00 on the GROUP', rm.status === 200 && rm.body.credit_cents === 100000 && rm.body.group_credit_cents === 120000
  && sum(held('group', 'g1')) === 120000 && held('founding', 'f1').length === 0, [rm.body, ledger()]);
var gc = call('/admin/group-credits', ADMIN, {});
check('4c) HQ group view: the group holds $1,200.00 in two rows (A cut, B removed)', gc.status === 200 && gc.body.groups.g1 && gc.body.groups.g1.cents === 120000 && gc.body.groups.g1.rows.length === 2, gc.body);
/* The group sells Pub B: it leaves the group and a new owner signs up separately (its own account, its own venue row). */
venueNamed('Group Pub B').group_id = null; venueNamed('Group Pub B').founding_id = 'f-new';
DB.venueplay_founding.push({ id: 'f-new', contact_email: 'new@owner.test', plan: 'annual', status: 'card_on_file', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' });
check('4d) pub sold and a new owner signs up: the new owner holds NO credit; the group keeps all $1,200.00', sum(held('founding', 'f-new')) === 0 && sum(held('group', 'g1')) === 120000, ledger());
var gc2 = call('/admin/group-credits', ADMIN, {});
check('4d) HQ group view after the sale: the group still shows $1,200.00', gc2.body.groups.g1.cents === 120000, gc2.body);
var rm2 = call('/admin/group-release', ADMIN, { venue_id: 'v-b', action: 'removed' });
check('4d) and the sold pub is no longer a group pub, so it cannot earn the group another credit', rm2.status === 409 && sum(held('group', 'g1')) === 120000, rm2);

var ap = call('/admin/group-credits', ADMIN, { apply_group: 'g1', invoice: 'INV-0042' });
check('4f) HQ takes the group\'s credit off its yearly invoice: both rows applied with the invoice number, the group then shows $0.00, an audit row says $1,200.00',
  ap.status === 200 && !ap.body.groups.g1 && held('group', 'g1').length === 0 && ledger().filter(function (r) { return r.status === 'applied' && r.applied_invoice === 'INV-0042'; }).length === 2
  && DB.vp_admin_audit.filter(function (a) { return a.action === 'credit_applied' && a.target === 'group:g1' && a.detail.used_cents === 120000; }).length === 1, [ap.body, ledger()]);
var ap2 = call('/admin/group-credits', OWNER, { apply_group: 'g1' });
check('4f) a login that is not HQ cannot mark a group\'s credit taken', ap2.status === 403, ap2);

section('4e group rules at the edges');
groupWorld('monthly', null);
var gm = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4e) a MONTHLY group: the cut waits for the next bill, no credit, no ledger row', gm.status === 200 && gm.body.credit_cents === 0 && gm.body.applied === 'next_bill' && ledger().length === 0 && venueNamed('Group Pub A').pending_players === 90 && venueNamed('Group Pub A').max_players === 100, [gm.body, venueNamed('Group Pub A')]);
groupWorld('yearly', RENEW_ISO);
var d1 = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
var d2 = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4e) the same cut sent twice: one credit (the second finds the pub already at 90)', d1.status === 200 && d2.status === 400 && ledger().length === 1, [d1.body, d2.body, ledger()]);
groupWorld('yearly', RENEW_ISO);
DB.vp_platform_admins.push({ auth_user_id: 'staff-1', role: 'staff', label: 'Staff' });
var d3s = call('/admin/group-release', 'staff-1', { venue_id: V1, action: 'cut', players: 90 });
check('4e) an HQ login with only the staff role is refused too (owner or accounts only)', d3s.status === 403 && ledger().length === 0 && venueNamed('Group Pub A').max_players === 100, d3s);
var d3 = call('/admin/group-release', OWNER, { venue_id: V1, action: 'cut', players: 90 });
check('4e) only HQ owner or accounts may record it: a venue owner login is refused and nothing is written', d3.status === 403 && ledger().length === 0 && venueNamed('Group Pub A').max_players === 100, d3);
groupWorld('yearly', null);
var d4 = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4e) a yearly group with no renewal date: asked to set it, nothing changed', d4.status === 409 && ledger().length === 0 && venueNamed('Group Pub A').max_players === 100, d4);
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
var d5 = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4e) a pub that pays for itself is not a group pub: refused, it holds its own credit through its billing page', d5.status === 409 && ledger().length === 0, d5);
groupWorld('yearly', RENEW_ISO); atMonth(12);
var d6 = call('/admin/group-release', ADMIN, { venue_id: V1, action: 'cut', players: 90 });
check('4e) on renewal day nothing is left of the year, so nothing is held (and nothing is invented)', d6.status === 200 && d6.body.credit_cents === 0 && ledger().length === 0, [d6.body, ledger()]);

section('5 SELF-PAYING yearly pub: it is its own payer');
atMonth(4);
yearlyWorld([{ id: V1, name: 'Solo Pub', postcode: '4000', max_players: 100 }]);
var s1 = call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('5) a pub that pays for itself holds its own credit: payer = its own account f1, $228.00', s1.body.credit_cents === 22800 && sum(held('founding', 'f1')) === 22800, ledger());

section('6 the renewal invoice takes the credit (Stripe applies the balance; the ledger marks the rows applied)');
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
call('/account/players', OWNER, { venue_id: V1, players: 90 });
function invoicePaid(o) { var out = null; vpbMarkCreditsApplied(ENV, Object.assign({ id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_cycle', starting_balance: -22800, ending_balance: 0 }, o)).then(function (x) { out = x; }); for (var i = 0; i < 500 && out === null; i++) drainMicrotasks(); return out; }
check('6) a non-renewal invoice (a mid-year top-up) does NOT take the yearly credit', invoicePaid({ billing_reason: 'manual' }) === 0 && held('founding', 'f1').length === 1, ledger());
check('6) a renewal that used only part of it ($100.00 of $228.00) leaves the row held for the next bill', invoicePaid({ starting_balance: -22800, ending_balance: -12800 }) === 0 && held('founding', 'f1').length === 1, ledger());
check('6) the renewal that used all $228.00 marks the row applied, with the invoice and the time', invoicePaid({}) === 1 && held('founding', 'f1').length === 0 && ledger()[0].status === 'applied' && ledger()[0].applied_invoice === 'in_1' && !!ledger()[0].applied_at, ledger());
check('6) the same event replayed marks nothing twice, and an audit row says it once', invoicePaid({}) === 0 && DB.vp_admin_audit.filter(function (a) { return a.action === 'credit_applied'; }).length === 1, DB.vp_admin_audit.map(function (a) { return a.action; }));
check('6) the billing screen no longer lists it once applied', call('/account/summary', OWNER, {}).body.credit_ledger.length === 0, 1);

section('7 the ledger can never stop a cut');
yearlyWorld([{ id: V1, name: 'Home Pub', postcode: '4000', max_players: 100 }]);
FAIL['vp_billing_credits:POST'] = 5;
var f1 = call('/account/players', OWNER, { venue_id: V1, players: 90 });
check('7) migration 199 not run (the insert is refused): the cut still goes through and Stripe still holds the credit', f1.status === 200 && f1.body.credit_cents === 22800 && S.balance === -22800 && venueNamed('Home Pub').max_players === 90, [f1, S.balance]);
FAIL['vp_billing_credits:POST'] = 0;

print(''); print(bad ? ('yearly credit: ' + bad + ' of ' + ran + ' failed') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error('yearly credit: ' + bad + ' of ' + ran + ' failed');
