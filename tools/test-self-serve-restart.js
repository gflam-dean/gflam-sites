/* THE SELF-SERVE RESTART, WALKED DAY BY DAY (Dean, 5 Nov 2026, builds INBOX item 54 answer 3; branch fix/self-serve-restart-10nov).

   Dean: a venue that cancelled, and a paused prospect, can come back within its 90 days in one tap from the Account
   page or the leaving email: add or confirm the card and you're back, with the members list, slides and draws
   intact. After 90 days the account is held. Change no charge logic beyond restarting the subscription correctly,
   pro rata per group-billing-one-cycle-prorata.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router, with a FIXED clock and a fake
   Stripe that keeps state (customers, subscriptions, invoice items, Checkout pages) and replays an Idempotency-Key
   the way Stripe does, so a double tap is tested against the thing that actually stops it:
     1. the pure rules: the 90-day deadline, and Dean's old-rate exception for a cancelled venue (more than 6 months
        with us, back within 2 months of leaving: the old rate; otherwise the standard rate), to the millisecond
     2. a cancelled one-venue account, its subscription ended, a card on file: restart on day 0, day 3, day 10,
        the last old-rate instant, the first standard instant, day 89, and refused on day 91; a short-tenure venue;
        the new subscription's price, quantity, card, no trial, error_if_incomplete, the switch-on, the clock cleared
     3. a double tap (together and one after the other): one subscription, one charge
     4. a failing card: nothing charged, nothing switched on, a Checkout page for another card; that page paid
        (the webhook) switches it on once, and never runs provisioning or a welcome
     5. a group venue on a live subscription: the stub pro rata by days of the cycle, on the next bill, once
     6. a paused prospect: its own card link, the offer grace price, day 89 and day 91 (and the card link and the
        /add-card page refuse after 90 days too); a cancelled prospect's card brings it back
     7. tamper-proof: another account's venue, HQ View as, a restricted manager, the switch off, the rate limit,
        a failed card account, a closed account, purged player details; a CHARGEBACK (never restarted, a neutral line,
        HQ told once); a special DISCOUNT and a FREE account (restart at the standard rate, nothing said on the page,
        support@ and HQ told); the old "Keep this venue" undo goes through the restart (the stub)
     8. the members list, the slides and the draws are byte-for-byte the same after every restart
     9. the page: restartView (lifted from billing.html) turns each quote into the button and the words; the
        come-back link in the console shell

   Dean's answers, builds INBOX 55 and 57 (5 Nov 2026), are what sections 1, 2 and 7 hold the code to.

   Run from the repo root:  jsc tools/test-self-serve-restart.js */
var ran = 0, bad = 0; function badCount() { return bad; }
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
var __rnd = 7;

/* jsc has no URL or Response; the router needs a pathname and keeps the response's headers. */
URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {}; var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
Response.redirect = function (u, s) { return { redirect: u, status: s }; };

load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; } };
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (typeof atob === 'undefined') { atob = function (s) { s = s.replace(/=+$/, ''); var o = '', bits = 0, acc = 0; for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) throw new Error('bad base64'); acc = ((acc << 6) | v) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); } } return o; }; }
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 3) { var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0; var nn = (a << 16) | (b << 8) | c;
  s += B64[(nn >> 18) & 63] + B64[(nn >> 12) & 63] + (i + 1 < bytes.length ? B64[(nn >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[nn & 63] : '='); } return s; }
var PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 7, 128, 0, 0, 4, 56, 8, 2, 0, 0, 0, 1, 2, 3];
function slide(salt) { var b = PNG.slice(); b.push(salt); return 'data:image/png;base64,' + b64(b); }

var AUTH = [], CANCELS = [], RESEND_IDS = 0, SCREEN_ACTORS = [], STORE = [];
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (/api\.resend\.com\/emails\/[^/]+\/cancel$/.test(u)) { CANCELS.push(u.split('/emails/')[1].split('/')[0]); return RS(200, { object: 'email', id: 'x' }); }
  if (u.indexOf('api.resend.com/emails') !== -1 && method === 'POST') { sent.push(JSON.parse(opts.body)); RESEND_IDS++; return RS(200, { id: 're_' + RESEND_IDS }); }
  if (u.indexOf('/storage/v1/') !== -1) { if (method === 'POST' && u.indexOf('/object/venue-ads/') !== -1) STORE.push(u); return RS(200, {}); }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  if (/\/rest\/v1\/vp_venue_screen(\?|$)/.test(u) && method === 'POST') { var hh = (opts && opts.headers) || {}; SCREEN_ACTORS.push(JSON.parse(hh['X-VP-Actor'] || '{}')); }
  return rigFetch(url, opts);
};
function U(nn) { return '53000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), ACCTS = U(8), STAFF = U(7);
var KEY = 'k3y-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; CANCELS = []; RESEND_IDS = 0; SCREEN_ACTORS = []; STORE = [];
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  ENV.PROSPECT_AUTOPILOT_KEY = KEY;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFF, label: 'Helper', role: 'staff' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = [];
  DB.vp_signin_links = []; DB.vp_prospect_welcomes = []; DB.vp_prospects = [];
}
function req(path, body, headers, method) {
  var h = {}; for (var k in (headers || {})) h[k.toLowerCase()] = headers[k];
  var txt = body === undefined ? '' : JSON.stringify(body);
  return { method: method || 'POST', url: 'https://venueplay-api.example' + path,
    headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
async function call(path, body, headers, method) {
  var res = await _d.fetch(req(path, body, headers, method), ENV);
  var parsed = null; try { parsed = res.body ? JSON.parse(res.body) : null; } catch (e) { parsed = res.body; }
  return { status: res.status, body: parsed || {}, headers: res.headers || {} };
}
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; this.abort = function () {}; }; }
if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; clearTimeout = function () {}; }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var AS = function (who) { return { Authorization: 'Bearer ' + who }; };
var AP = { 'X-Autopilot-Key': KEY };
var BASE = { name: 'Test Charlie Prospect Hotel', first_name: 'Sam', email: 'sam@testcharlie.example', postcode: '2065', entity_type: 'for_profit' };
var NTH = 0;   // every setup a new email: one that already signs in is refused, rightly
function with_(o) { var b = {}; for (var k in BASE) b[k] = BASE[k]; if (NTH++) b.email = 'sam' + NTH + '@testcharlie.example'; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
function row(name) { var v = DB.vp_venues.filter(function (x) { return x.name === name; })[0]; return v && DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0]; }
var DAY = 86400000;
function age(name, ms) { var r = row(name); r.created_at = new Date(Date.now() - ms).toISOString(); }
async function list(who) { return call('/admin/prospects', {}, AS(who || ADMIN)); }
function find(res, name) { return ((res.body && res.body.prospects) || []).filter(function (p) { return p.name === name; })[0]; }
async function setUp(o, viaAutopilot) { return viaAutopilot ? call('/autopilot/prospect', with_(o), AP) : call('/admin/prospect', with_(o), AS(ADMIN)); }


if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; this.abort = function () {}; }; }
if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; clearTimeout = function () {}; }
ENV.CARD_LINK_SECRET = 'card-link-secret-for-tests-only-0123456789';
var AS = function (who, venue) { var h = { Authorization: 'Bearer ' + who }; if (venue) h['X-VP-Venue'] = venue; return h; };
var NTH = 0;
function base(o) { var b = { name: 'Free Month Hotel ' + (++NTH), first_name: 'Sam', email: 'sam' + NTH + '@freemonth.example', postcode: '4000', entity_type: 'for_profit', send_welcome: false };
  for (var k in (o || {})) b[k] = o[k]; return b; }
async function prospect(o) {
  var r = await call('/admin/prospect', base(o), AS(ADMIN));
  if (r.status !== 200) throw new Error('setup failed ' + JSON.stringify(r.body));
  var v = DB.vp_venues.filter(function (x) { return x.id === r.body.venue.id; })[0];
  var st = DB.vp_venue_staff.filter(function (x) { return x.venue_id === v.id; })[0];
  /* What the real database fills in that the fake one does not: a venue's status defaults to active, and
     migration 127's columns exist (null, and [] for reminders_sent) on every prospect row. */
  if (!v.status) v.status = 'active'; if (!('suspended_reason' in v)) v.suspended_reason = null;
  var pr = DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0];
  ['first_signin_at', 'free_month_ends_at', 'card_choice', 'card_choice_at', 'paused_at', 'cancelled_at'].forEach(function (k) { if (!(k in pr)) pr[k] = null; });
  if (!('offer_rate' in pr)) pr.offer_rate = null; if (!('reminders_sent' in pr)) pr.reminders_sent = [];
  return { v: v, login: st.auth_user_id, row: function () { return DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0]; },
    founding: function () { return DB.venueplay_founding.filter(function (f) { return f.id === v.founding_id; })[0]; } };
}
function bne(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 10, mi || 0); }   // a Brisbane wall-clock time as epoch ms
function day(ms) { return vpaBneDay(ms); }
var REM = function () { return sent.filter(function (m) { return /free month|How is venueplay going/.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }


var BNE_FIRST = bne(2026, 11, 2, 10, 0);                         // first sign-in Mon 2 Nov 2026
var MONTH_END = vpaFreeMonthEnd(BNE_FIRST);                       // Wed 2 Dec 23:59:59 Brisbane (day 0)
function at(d, h, mi, s, ms) { return bne(2026, 12, d, h, mi || 0) + (s || 0) * 1000 + (ms || 0); }
function withClock(ms, fn) { var real = Date.now; Date.now = function () { return ms; }; return Promise.resolve().then(fn).then(function (r) { Date.now = real; return r; }, function (e) { Date.now = real; throw e; }); }
async function quote(P, ms) { return withClock(ms, async function () { return (await call('/account/card-link', { venue_id: P.v.id }, AS(P.login, P.v.id))).body; }); }
async function checkoutAt(P, ms) {
  return withClock(ms, async function () {
    stripeCalls.length = 0;
    var tok = await vpaCardToken(ENV, P.v.founding_id);
    var res = await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + P.v.founding_id + '&t=' + tok, method: 'GET', headers: { get: function () { return null; } } }, ENV);
    var body = (stripeCalls[0] || {}).body || '';
    return { body: body, calls: stripeCalls.length, res: res,
      offer: /line_items%5B0%5D%5Bprice%5D=price_F_M/.test(body), standard: /line_items%5B0%5D%5Bprice%5D=price_S_M/.test(body),
      trial: (/subscription_data%5Btrial_end%5D=(\d+)/.exec(body) || [])[1] || null, expires: (/expires_at=(\d+)/.exec(body) || [])[1] || null };
  });
}
async function newProspect(name, offerOpen) {
  world(); ENV.FOUNDING_CODES = offerOpen === false ? '' : 'OFFER-NOV-2099';
  var P = await prospect({ name: name });
  P.row().first_signin_at = new Date(BNE_FIRST).toISOString(); P.row().free_month_ends_at = new Date(MONTH_END).toISOString();
  /* Since fix/offer-start-deadline-12nov (Dean, 7 Nov 2026) setup writes no offer_rate: the FIRST sign-in decides it from
     their offer code. This fixture sets first_signin_at by hand, so it writes the rate that sign-in would have written. */
  if (offerOpen !== false && !(Number(P.row().offer_rate) > 0)) P.row().offer_rate = 2.5;   // VPA_OFFER_RATE
  ENV.FOUNDING_CODES = '';   // the offer they were set up on has long closed: only THEIR offer_rate can hold the price
  return P;
}

/* ---- A FAKE STRIPE THAT KEEPS STATE, and replays a key the way Stripe does (the same answer, errors included). ---- */
var ST;
function stripeReset() { ST = { subs: {}, customers: {}, items: [], sessions: [], created: [], posts: [], idem: {}, decline: null, inflight: false, n: 0 }; }
stripeReset();
function sform(body) { var o = {}; String(body || '').split('&').filter(Boolean).forEach(function (kv) { var i = kv.indexOf('='); o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function stripeAnswer(method, path, f) {
  var p = path.split('?')[0], m;
  if (method === 'GET' && (m = /^subscriptions\/([^/]+)$/.exec(p))) return ST.subs[m[1]] ? [200, ST.subs[m[1]]] : [404, { error: { type: 'invalid_request_error', message: 'No such subscription' } }];
  if (method === 'GET' && (m = /^customers\/([^/]+)$/.exec(p))) return ST.customers[m[1]] ? [200, ST.customers[m[1]]] : [404, { error: { type: 'invalid_request_error', message: 'No such customer' } }];
  if (method === 'POST' && p === 'subscriptions') {
    if (ST.decline) return [402, { error: { type: 'card_error', code: 'card_declined', decline_code: ST.decline, message: 'Your card was declined.' } }];
    var id = 'sub_new_' + (++ST.n);
    var sub = { id: id, status: 'active', customer: f.customer, default_payment_method: f.default_payment_method, metadata: {},
      items: { data: [{ id: 'si_' + id, price: { id: f['items[0][price]'], unit_amount: f['items[0][price]'] === 'price_F_M' ? 250 : 300 }, quantity: Number(f['items[0][quantity]']) }] },
      current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 31 * 86400 };
    for (var k in f) { var mm = /^metadata\[(.+)\]$/.exec(k); if (mm) sub.metadata[mm[1]] = f[k]; }
    ST.subs[id] = sub; ST.created.push({ sub: sub, form: f }); return [200, sub];
  }
  if (method === 'POST' && (m = /^subscriptions\/([^/]+)$/.exec(p))) { var s = ST.subs[m[1]]; if (!s) return [404, { error: { message: 'No such subscription' } }]; if ('cancel_at_period_end' in f) s.cancel_at_period_end = f.cancel_at_period_end === 'true'; return [200, s]; }
  if (method === 'POST' && (m = /^subscription_items\/([^/]+)$/.exec(p))) { var hit = null; for (var sid in ST.subs) ST.subs[sid].items.data.forEach(function (it) { if (it.id === m[1]) hit = it; }); if (!hit) return [404, { error: { message: 'No such item' } }]; hit.quantity = Number(f.quantity); return [200, hit]; }
  if (method === 'POST' && p === 'invoiceitems') { var ii = { id: 'ii_' + (++ST.n), amount: Number(f.amount), customer: f.customer, description: f.description, deleted: false }; ST.items.push(ii); return [200, ii]; }
  if (method === 'DELETE' && (m = /^invoiceitems\/([^/]+)$/.exec(p))) { ST.items.forEach(function (x) { if (x.id === m[1]) x.deleted = true; }); return [200, { id: m[1], deleted: true }]; }
  if (method === 'DELETE' && (m = /^subscriptions\/([^/]+)$/.exec(p))) { if (ST.subs[m[1]]) ST.subs[m[1]].status = 'canceled'; return [200, ST.subs[m[1]] || {}]; }
  if (method === 'POST' && p === 'checkout/sessions') { var cs = { id: 'cs_' + (++ST.n), url: 'https://checkout.stripe.com/c/pay/cs_' + ST.n, form: f }; ST.sessions.push(cs); return [200, cs]; }
  if (method === 'POST' && /balance_transactions$/.test(p)) return [200, { id: 'cbtxn_' + (++ST.n) }];
  return [200, { id: 'x_' + (++ST.n) }];
}
var preStripe = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('api.stripe.com/v1/') === -1) return preStripe(url, opts);
  var method = (opts && opts.method) || 'GET', path = u.split('api.stripe.com/v1/')[1], body = String((opts && opts.body) || '');
  var key = opts && opts.headers && opts.headers['Idempotency-Key'];
  stripeCalls.push({ url: u, body: body, method: method, key: key || null });
  if (method !== 'GET') ST.posts.push({ path: path.split('?')[0], method: method, key: key || null, form: sform(body) });
  if (key && ST.inflight) return RS(409, { error: { type: 'idempotency_error', message: 'There is currently another in-progress request using this Idempotent Key.' } });
  if (key && ST.idem[key]) { ST.idem[key].replays++; return RS(ST.idem[key].status, ST.idem[key].body); }
  var a = stripeAnswer(method, path, sform(body));
  if (key) ST.idem[key] = { status: a[0], body: a[1], replays: 0 };
  return RS(a[0], a[1]);
};
function writes() { return ST.posts.filter(function (p) { return p.method !== 'GET'; }); }

/* ---- A LEFT PAYING ACCOUNT, built straight into the fake database. ---- */
var OWN = 200;
var LEFT0 = bne(2026, 12, 2, 15, 0);   // the venue left at 3pm Wed 2 Dec 2026 Brisbane (day 0)
function at2(y, mo, d, h, mi, s, ms) { return bne(y, mo, d, h, mi || 0) + (s || 0) * 1000 + (ms || 0); }
function paidLeft(o) {
  o = o || {};
  world(); stripeReset(); ENV.VPB_SELF_RESTART = o.off ? '' : '1';
  var owner = U(++OWN), fid = U(++OWN), vid = U(++OWN);
  var live = !!o.live;
  DB.venueplay_founding.push({ id: fid, plan: o.plan || 'monthly', is_group: !!o.others, payment_reminders: true, status: o.comp ? 'comp' : 'card_on_file',
    stripe_customer_id: 'cus_' + fid.slice(-4), stripe_subscription_id: 'sub_old_' + fid.slice(-4), contact_email: 'owner' + OWN + '@restart.example', max_seats: 20 });
  var venue = { id: vid, name: o.name || 'Come Back Hotel', founding_id: fid, group_id: null, max_players: o.players || 20, pending_players: null,
    status: 'suspended', suspended_reason: o.reason || 'cancelled', slug: 'come-back-' + OWN, cancel_at_period_end: o.reason === 'ended' ? false : true,
    timezone: 'Australia/Brisbane', created_at: o.joined || '2026-03-01T00:00:00.000Z', postcode: '4000', closed_at: o.noClock ? null : new Date(o.leftMs || LEFT0).toISOString(),
    player_data_purged_at: o.purged ? new Date(LEFT0 + 5 * DAY).toISOString() : null };
  DB.vp_venues.push(venue);
  DB.vp_venue_staff.push({ auth_user_id: owner, venue_id: vid, role: 'owner', permissions: null });
  var others = [];
  (o.others || []).forEach(function (ov, i) {
    var x = { id: U(++OWN), name: ov.name || ('Other Pub ' + i), founding_id: fid, group_id: null, max_players: ov.players || 10, pending_players: null,
      status: ov.status || 'active', suspended_reason: ov.reason || null, slug: 'other-' + OWN, cancel_at_period_end: !!ov.cancelling, timezone: 'Australia/Brisbane',
      created_at: '2026-06-01T00:00:00.000Z', postcode: '4000', closed_at: ov.status === 'suspended' ? new Date(LEFT0).toISOString() : null, player_data_purged_at: null };
    DB.vp_venues.push(x); DB.vp_venue_staff.push({ auth_user_id: owner, venue_id: x.id, role: 'owner', permissions: null }); others.push(x);
  });
  var cus = 'cus_' + fid.slice(-4), oldSub = 'sub_old_' + fid.slice(-4);
  var startS = o.periodStartS || Math.floor(at2(2026, 11, 23, 0) / 1000), endS = o.periodEndS || Math.floor(at2(2026, 12, 23, 0) / 1000);
  var activeQty = others.filter(function (x) { return x.status === 'active'; }).reduce(function (n, x) { return n + x.max_players; }, 0);
  ST.subs[oldSub] = { id: oldSub, status: live ? (o.subStatus || 'active') : 'canceled', customer: cus,
    default_payment_method: o.card === false ? null : { id: 'pm_old', card: { brand: 'visa', last4: '1111' } },
    items: { data: [{ id: 'si_old', price: { id: o.price || 'price_F_M', unit_amount: 250 }, quantity: live ? activeQty : venue.max_players }] },
    discounts: o.discount ? [{ coupon: { id: 'c1', percent_off: 33.3 } }] : [], current_period_start: startS, current_period_end: endS };
  ST.customers[cus] = { id: cus, balance: 0, invoice_settings: { default_payment_method: o.card === false ? null : { id: 'pm_card_1', card: { brand: 'visa', last4: '4242' } } } };
  /* What a restart must never touch: the members list, the slides and the draws. */
  DB.vp_member_rosters = [{ id: 'ros_' + vid, venue_id: vid, name: 'Members' }];
  DB.vp_members = [{ id: 'm1_' + vid, roster_id: 'ros_' + vid, number: 101, first_name: 'Pat', last_name: 'Lee', note: 'life member' }];
  DB.vp_member_draws = [{ id: 'dr_' + vid, venue_id: vid, name: 'Thursday members draw', current_jackpot_cents: 125000, last_drawn_at: '2026-11-26T09:00:00.000Z' }];
  DB.vp_member_draw_results = [{ id: 'res_' + vid, draw_id: 'dr_' + vid, winner_name: 'Pat Lee', won: false }];
  DB.vp_venue_screen = [{ venue_id: vid, slides: [{ image_url: 'https://db/storage/v1/object/public/venue-ads/a.png', seconds: 7 }], members_blurb: 'Draw at 7pm' }];
  return { owner: owner, fid: fid, vid: vid, v: venue, others: others, cus: cus, oldSub: oldSub,
    f: function () { return DB.venueplay_founding.filter(function (x) { return x.id === fid; })[0]; } };
}
function keptSnap() { return JSON.stringify([DB.vp_member_rosters, DB.vp_members, DB.vp_member_draws, DB.vp_member_draw_results, DB.vp_venue_screen]); }
async function quoteAt(A, ms, who, venue) { return withClock(ms, async function () { return call('/account/restart-quote', { venue_id: venue || A.vid }, AS(who || A.owner, A.vid)); }); }
async function restartAt(A, ms, who, venue, headers) { return withClock(ms, async function () { return call('/account/restart', { venue_id: venue || A.vid }, headers || AS(who || A.owner, A.vid)); }); }
function newSubs() { return ST.created.length; }

(async function () {
  section('1. The pure rules: 90 days to the millisecond, the old-rate exception for a cancelled venue');
  check('the deadline is closed_at + 90 days exactly (the instant the retention sweep may purge)',
    vpbRestartDeadlineMs(LEFT0) === LEFT0 + 90 * DAY && new Date(vpbRestartDeadlineMs(LEFT0)).toISOString() === '2027-03-02T05:00:00.000Z', new Date(vpbRestartDeadlineMs(LEFT0)).toISOString());
  var J9 = Date.parse('2026-03-01T00:00:00.000Z');
  check('with us 9 months, left 2 Dec: the old rate is kept to the same instant 2 months on (3pm Tue 2 Feb 2027 Brisbane)', new Date(vpbOldRateUntilMs(J9, LEFT0)).toISOString() === '2027-02-02T05:00:00.000Z', new Date(vpbOldRateUntilMs(J9, LEFT0)).toISOString());
  check('with us EXACTLY 6 months to the instant: not "more than 6 months", no old rate', isNaN(vpbOldRateUntilMs(vpbAddMonthsMs(LEFT0, -6), LEFT0)) && !isNaN(vpbOldRateUntilMs(vpbAddMonthsMs(LEFT0, -6) - 1, LEFT0)));
  check('with us 4 months: no old rate', isNaN(vpbOldRateUntilMs(Date.parse('2026-08-01T00:00:00.000Z'), LEFT0)));
  check('calendar months land on the last day of a short month (31 Aug + 6 months is 28 Feb)', new Date(vpbAddMonthsMs(Date.parse('2026-08-31T02:00:00.000Z'), 6)).toISOString() === '2027-02-28T02:00:00.000Z', new Date(vpbAddMonthsMs(Date.parse('2026-08-31T02:00:00.000Z'), 6)).toISOString());
  check('no clock, no deadline: NaN, never "for ever"', isNaN(vpbRestartDeadlineMs(vpbRestartClockMs({ closed_at: null }, null))));
  check('a prospect with no closed_at (migration 160 not run) counts from its pause', vpbRestartClockMs({ closed_at: null }, { paused_at: '2026-12-03T00:00:00.000Z' }) === Date.parse('2026-12-03T00:00:00.000Z'));

  section('2. A cancelled one-venue account, subscription ended, card on file: day by day');
  /* With us since 1 Mar 2026, on the $2.50 offer. BACK WITHIN 90 DAYS (Dean, 10 Nov 2026, INBOX 142: "they keep their
     existing plan if they re-sign within the next 90 days"): its previous rate, every day of the 90, to the last ms.
     (Before 10 Nov this walk switched to $3 at 2 months; the 90-day promise replaced that inside the window.) */
  var days = [
    ['day 0 (the afternoon it left)', at2(2026, 12, 2, 17, 0), 'price_F_M', true],
    ['day 3', at2(2026, 12, 5, 11, 0), 'price_F_M', true],
    ['day 6 (no 5-day cut-off for a cancelled venue)', at2(2026, 12, 8, 9, 0), 'price_F_M', true],
    ['day 60, 2 months less 1 ms', at2(2027, 2, 2, 15, 0) - 1, 'price_F_M', true],
    ['day 62, 2 months to the instant: still its previous rate (the 90-day promise)', at2(2027, 2, 2, 15, 0), 'price_F_M', true],
    ['day 89', at2(2027, 3, 1, 15, 0), 'price_F_M', true],
    ['the last millisecond of day 90', LEFT0 + 90 * DAY - 1, 'price_F_M', true],
  ];
  for (var di = 0; di < days.length; di++) {
    var dd = days[di];
    var A = paidLeft({ name: 'Day Walk Hotel ' + di });
    var before = keptSnap();
    var q = await quoteAt(A, dd[1]);
    check(dd[0] + ': the quote says it can restart, on the card ending 4242, ' + (dd[3] ? '$2.50 (its old rate)' : '$3.00 (standard)') + ', charged today, with no keep-by date said',
      q.status === 200 && q.body.can_restart === true && q.body.kind === 'new_sub' && q.body.mode === 'confirm' && q.body.card && q.body.card.last4 === '4242' &&
      q.body.rate === (dd[3] ? 2.5 : 3) && q.body.offer === dd[3] && q.body.today_cents === 20 * (dd[3] ? 250 : 300) && !('offer_kept_until' in q.body) && !('offer_kept_words' in q.body)
      && q.body.kept_previous === true, q.body);
    check(dd[0] + ': the quote wrote nothing anywhere', writes().length === 0 && A.v.status === 'suspended', writes());
    var r = await restartAt(A, dd[1]);
    var c = ST.created[0] || { form: {} };
    check(dd[0] + ': ONE new subscription, ' + dd[2] + ' x 20, on the saved card, no trial, error_if_incomplete, keyed',
      r.status === 200 && r.body.restarted === true && newSubs() === 1 && c.form['items[0][price]'] === dd[2] && c.form['items[0][quantity]'] === '20' &&
      c.form.default_payment_method === 'pm_card_1' && c.form.payment_behavior === 'error_if_incomplete' && !('trial_end' in c.form) && !('trial_period_days' in c.form) &&
      c.form.customer === A.cus && /^restart:/.test(ST.posts.filter(function (p) { return p.path === 'subscriptions'; })[0].key || ''), [r.status, r.body, c.form]);
    check(dd[0] + ': back on, the 90-day clock cleared, not flagged to cancel, the account on the new subscription',
      A.v.status === 'active' && A.v.suspended_reason === null && A.v.closed_at === null && A.v.cancel_at_period_end === false && A.f().stripe_subscription_id === c.sub.id, [A.v, A.f().stripe_subscription_id]);
    check(dd[0] + ': the members list, slides and draws are exactly as they were', keptSnap() === before);
    check(dd[0] + ': one audit row says who restarted it, how, and at what price', DB.vp_admin_audit.filter(function (x) { return x.action === 'venue_restarted' && x.target === 'venue:' + A.vid && x.detail.price === dd[2] && x.detail.actor_user === A.owner; }).length === 1);
  }
  var A91 = paidLeft({ name: 'Day Ninety One Hotel' });
  var q91 = await quoteAt(A91, at2(2027, 3, 3, 15, 0));
  var r91 = await restartAt(A91, at2(2027, 3, 3, 15, 0));
  check('day 91: the quote says held, with the clear words', q91.body.can_restart === false && q91.body.held === true && /more than 90 days/.test(q91.body.error) && /07 5228 3667/.test(q91.body.error), q91.body);
  check('day 91: the restart is refused (410, held), Stripe is never asked to charge, the venue stays off with its clock',
    r91.status === 410 && r91.body.held === true && writes().length === 0 && A91.v.status === 'suspended' && !!A91.v.closed_at, [r91.status, r91.body, writes()]);
  var A90 = paidLeft({ name: 'Day Ninety Exactly Hotel' });
  var r90 = await restartAt(A90, LEFT0 + 90 * DAY);
  check('at closed_at + 90 days exactly: refused (the sweep may already have run)', r90.status === 410 && newSubs() === 0, r90.body);
  var AP2 = paidLeft({ name: 'Purged Hotel', purged: true });
  var rp = await restartAt(AP2, at2(2026, 12, 20, 10, 0));
  check('player details already purged (inside the 90 days by date): refused as held', rp.status === 410 && rp.body.held === true && newSubs() === 0, rp.body);
  var SH = paidLeft({ name: 'Short Stay Hotel', joined: '2026-08-01T00:00:00.000Z' });
  var sh = await restartAt(SH, at2(2026, 12, 3, 10, 0));
  check('with us only 4 months, on the offer, back the next day: its previous rate all the same (the 90-day promise has no tenure rule)', sh.status === 200 && ST.created[0].form['items[0][price]'] === 'price_F_M' && sh.body.kept_previous === true, ST.created[0] && ST.created[0].form);
  var AS1 = paidLeft({ name: 'Standard Before Hotel', price: 'price_S_M' });
  var rs1 = await restartAt(AS1, at2(2026, 12, 3, 10, 0));
  check('a long-tenure venue that was on the standard rate goes back on the standard rate (its old rate), never the offer', rs1.status === 200 && ST.created[0].form['items[0][price]'] === 'price_S_M', ST.created[0] && ST.created[0].form);
  var AE = paidLeft({ name: 'Ended Hotel', reason: 'ended' });
  var re = await restartAt(AE, at2(2026, 12, 4, 10, 0));
  check('a venue switched off as "ended" restarts the same way', re.status === 200 && AE.v.status === 'active' && newSubs() === 1, re.body);
  var AA = paidLeft({ name: 'Annual Hotel', plan: 'annual' });
  var ra = await restartAt(AA, at2(2026, 12, 4, 10, 0));
  check('an annual account restarts on the annual offer price, a year charged today', ra.status === 200 && ST.created[0].form['items[0][price]'] === 'price_F_A' && ra.body.charged === '$' + (2.3 * 12 * 20).toFixed(2), [ra.body, ST.created[0] && ST.created[0].form]);
  var AG = paidLeft({ name: 'Group Left Hotel', others: [{ name: 'Still Off Pub', status: 'suspended', reason: 'ended' }] });
  await restartAt(AG, at2(2026, 12, 4, 10, 0));
  check('a whole group that ended, one venue restarted: only that venue comes on, the other is flagged out of the new bill',
    AG.v.status === 'active' && AG.others[0].status === 'suspended' && AG.others[0].cancel_at_period_end === true && ST.created[0].form['items[0][quantity]'] === '20', [AG.others[0], ST.created[0] && ST.created[0].form]);
  check('and the renewal reconcile then counts only the venue that came back', (await vpbAccountTotal(ENV, AG.fid)) === 20);

  section('3. A double tap never double-charges');
  var D = paidLeft({ name: 'Double Tap Hotel' });
  var both = await withClock(at2(2026, 12, 4, 10, 0), function () {
    return Promise.all([call('/account/restart', { venue_id: D.vid }, AS(D.owner, D.vid)), call('/account/restart', { venue_id: D.vid }, AS(D.owner, D.vid))]); });
  var subPosts = ST.posts.filter(function (p) { return p.path === 'subscriptions' && p.method === 'POST'; });
  check('two taps at once: both answered ok, ONE subscription made (the second was Stripe replaying the same key)',
    both[0].status === 200 && both[1].status === 200 && newSubs() === 1 && subPosts.length <= 2 && subPosts.every(function (p) { return p.key === subPosts[0].key; }), [both[0].body, both[1].body, subPosts.length]);
  var third = await restartAt(D, at2(2026, 12, 4, 10, 1));
  check('a third tap a minute later: already back on, Stripe not asked at all', third.status === 200 && third.body.already === true && ST.posts.length === subPosts.length, third.body);
  var D2 = paidLeft({ name: 'In Flight Hotel' }); ST.inflight = true;
  var fl = await restartAt(D2, at2(2026, 12, 4, 10, 0)); ST.inflight = false;
  check('a tap while Stripe is still working on the first (409 in progress): "already on its way", nothing switched on', fl.status === 409 && D2.v.status === 'suspended' && newSubs() === 0, fl.body);

  section('4. A restart with a failing card');
  var F = paidLeft({ name: 'Declined Card Hotel' }); ST.decline = 'insufficient_funds';
  var before4 = keptSnap();
  var rf = await restartAt(F, at2(2026, 12, 4, 10, 0));
  var cs = ST.sessions[0] || { form: {} };
  check('declined: 402, the bank\'s own reason, nothing charged, a Stripe page for another card', rf.status === 402 && rf.body.card_failed === true && /not enough funds/.test(rf.body.error) && /nothing has been charged/i.test(rf.body.error) &&
    /^https:\/\/checkout\.stripe\.com\//.test(rf.body.card_url || '') && newSubs() === 0, rf.body);
  check('declined: still off, still on its 90-day clock, the account still on its old subscription', F.v.status === 'suspended' && !!F.v.closed_at && F.f().stripe_subscription_id === F.oldSub);
  check('the card page is the same subscription: their customer, the offer price (day 2), 20 players, no trial, marked vp_restart with the venue',
    cs.form.mode === 'subscription' && cs.form.customer === F.cus && cs.form['line_items[0][price]'] === 'price_F_M' && cs.form['line_items[0][quantity]'] === '20' &&
    !('subscription_data[trial_end]' in cs.form) && cs.form['metadata[vp_restart]'] === '1' && cs.form['metadata[venue_id]'] === F.vid && cs.form.client_reference_id === F.fid, cs.form);
  check('the card page closes within Stripe\'s 24 hours (and never after the old rate or the 90 days end)', Number(cs.form.expires_at) === Math.floor(at2(2026, 12, 4, 10, 0) / 1000) + 23 * 3600, cs.form.expires_at);
  check('a refused card is written down for HQ', DB.vp_admin_audit.some(function (x) { return x.action === 'venue_restart_card_refused' && x.detail.decline === 'insufficient_funds'; }));
  var venuesBefore = DB.vp_venues.length, sentBefore = sent.length;
  var ev = { id: 'evt_restart_1', type: 'checkout.session.completed', data: { object: { id: cs.id, client_reference_id: F.fid, customer: F.cus, subscription: 'sub_paid_page',
    metadata: { vp_restart: '1', venue_id: F.vid, row_id: F.fid } } } };
  await withClock(at2(2026, 12, 4, 10, 5), function () { return vpaHandleStripeEvent(ENV, ev); });
  check('the page paid (webhook): back on, the clock cleared, the account on the new subscription', F.v.status === 'active' && F.v.closed_at === null && F.f().stripe_subscription_id === 'sub_paid_page', [F.v, F.f()]);
  check('and NOTHING was provisioned or welcomed: no new venue, no email', DB.vp_venues.length === venuesBefore && sent.length === sentBefore, [DB.vp_venues.length, sent.length - sentBefore]);
  var aud1 = DB.vp_admin_audit.filter(function (x) { return x.action === 'venue_restarted' && x.target === 'venue:' + F.vid; }).length;
  await withClock(at2(2026, 12, 4, 10, 6), function () { return vpaHandleStripeEvent(ENV, ev); });
  check('the same webhook again (a Stripe redelivery): nothing changes, no second audit row', F.v.status === 'active' && F.f().stripe_subscription_id === 'sub_paid_page' &&
    DB.vp_admin_audit.filter(function (x) { return x.action === 'venue_restarted' && x.target === 'venue:' + F.vid; }).length === aud1);
  check('the members list, slides and draws survived the decline and the page', keptSnap() === before4);
  ST.subs.sub_paid_page = { id: 'sub_paid_page', status: 'active', customer: F.cus, items: { data: [] } };
  var ev2 = { id: 'evt_restart_2', type: 'checkout.session.completed', data: { object: { id: 'cs_second', client_reference_id: F.fid, customer: F.cus, subscription: 'sub_second_page',
    metadata: { vp_restart: '1', venue_id: F.vid, row_id: F.fid } } } };
  await withClock(at2(2026, 12, 4, 11, 0), function () { return vpaHandleStripeEvent(ENV, ev2); });
  check('a SECOND card page paid while already back on: the first subscription is kept, the second recorded and Dean told (never silently billed twice)',
    F.f().stripe_subscription_id === 'sub_paid_page' && DB.vp_admin_audit.some(function (x) { return x.action === 'venue_restart_duplicate' && x.detail.duplicate === 'sub_second_page'; }) &&
    sent.some(function (m) { return /second restart/.test(m.subject || '') && (m.to || []).join(',').indexOf('hello@venueplay.com.au') !== -1; }));
  var FE = paidLeft({ name: 'Edge Of Old Rate Hotel' });
  ST.customers[FE.cus].invoice_settings.default_payment_method = null; ST.subs[FE.oldSub].default_payment_method = null;
  var fe = await restartAt(FE, at2(2027, 2, 2, 12, 0));
  check('a card page opened on day 62 (past the old 2-month cut-off): its previous rate, and the page closes within Stripe\'s 24 hours, never after the 90 days',
    fe.body.mode === 'card' && Number(ST.sessions[0].form.expires_at) === Math.floor(at2(2027, 2, 2, 12, 0) / 1000) + 23 * 3600 && ST.sessions[0].form['line_items[0][price]'] === 'price_F_M', ST.sessions[0] && ST.sessions[0].form);
  var FD = paidLeft({ name: 'Last Day Card Hotel' });
  ST.customers[FD.cus].invoice_settings.default_payment_method = null; ST.subs[FD.oldSub].default_payment_method = null;
  await restartAt(FD, LEFT0 + 90 * DAY - 3 * 3600000);
  check('a card page opened 3 hours before the 90 days end closes when they do (Stripe\'s 31-minute floor aside), so the previous rate cannot be paid later',
    Number(ST.sessions[0].form.expires_at) === Math.floor((LEFT0 + 90 * DAY) / 1000) && ST.sessions[0].form['line_items[0][price]'] === 'price_F_M', ST.sessions[0] && ST.sessions[0].form);
  var FN = paidLeft({ name: 'No Card Hotel', card: false });
  var qn = await quoteAt(FN, at2(2026, 12, 4, 10, 0));
  var rn = await restartAt(FN, at2(2026, 12, 4, 10, 0));
  var rn2 = await restartAt(FN, at2(2026, 12, 4, 10, 2));
  check('no saved card: the quote asks for one, the tap opens the card page, a second tap opens the SAME page (keyed), nothing charged',
    qn.body.mode === 'card' && rn.status === 200 && rn.body.mode === 'card' && rn.body.card_url === rn2.body.card_url && ST.sessions.length === 1 && newSubs() === 0, [qn.body, rn.body, rn2.body]);

  section('5. A group venue back on a live subscription: pro rata, one cycle, one bill');
  var G = paidLeft({ name: 'Group Comeback Hotel', live: true, players: 10, others: [{ name: 'Busy Pub', players: 30 }],
    periodStartS: Math.floor(at2(2026, 11, 23, 0) / 1000), periodEndS: Math.floor(at2(2026, 12, 23, 0) / 1000) });
  var gq = await quoteAt(G, at2(2026, 12, 4, 10, 0));
  var cyc = vpbCycleDays(Math.floor(at2(2026, 11, 23, 0) / 1000), Math.floor(at2(2026, 12, 23, 0) / 1000));
  var left5 = vpbBrisDays(Math.floor(at2(2026, 12, 23, 0) / 1000)) - vpbBrisDays(Math.floor(at2(2026, 12, 4, 10, 0) / 1000));
  var want5 = vpbProrataCents(2.5, 10, left5, cyc);
  check('the quote: 19 of 30 days left in the cycle, 10 x $2.50 x 19/30 = $' + (want5 / 100).toFixed(2) + ' on the next bill (Wed 23 Dec), nothing today',
    gq.body.kind === 'group' && cyc === 30 && left5 === 19 && gq.body.stub_cents === want5 && want5 === 1583 && gq.body.today_cents === 0 && /19 of 30 days/.test(gq.body.stub_words) && /23 Dec/.test(gq.body.next_bill_words), gq.body);
  var gr = await restartAt(G, at2(2026, 12, 4, 10, 0));
  var gi = ST.items.filter(function (x) { return !x.deleted; });
  check('restarted: ONE stub line on the account\'s next bill, keyed on the venue, naming the venue and the days', gr.status === 200 && gi.length === 1 && gi[0].amount === 1583 && /Group Comeback Hotel - back on from 04\/12\/2026: 10 players, 19 of 30 days/.test(gi[0].description) &&
    ST.posts.filter(function (p) { return p.path === 'invoiceitems'; })[0].key === 'restart:' + G.vid + ':' + LEFT0, [gr.body, gi]);
  check('the venue is on and the ONE subscription now bills 40 players, no proration, no new subscription', G.v.status === 'active' && G.v.cancel_at_period_end === false && ST.subs[G.oldSub].items.data[0].quantity === 40 && newSubs() === 0 &&
    ST.posts.some(function (p) { return /^subscription_items\//.test(p.path) && p.form.proration_behavior === 'none'; }), ST.subs[G.oldSub].items.data[0]);
  var gr2 = await restartAt(G, at2(2026, 12, 4, 10, 1));
  check('a second tap: already on, no second stub line', gr2.body.already === true && ST.items.filter(function (x) { return !x.deleted; }).length === 1);
  var G2 = paidLeft({ name: 'Group Double Hotel', live: true, players: 10, others: [{ name: 'Busy Pub', players: 30 }] });
  await withClock(at2(2026, 12, 4, 10, 0), function () { return Promise.all([call('/account/restart', { venue_id: G2.vid }, AS(G2.owner, G2.vid)), call('/account/restart', { venue_id: G2.vid }, AS(G2.owner, G2.vid))]); });
  var lines2 = {}; ST.items.forEach(function (x) { lines2[x.id] = 1; });
  check('two taps at once on a group venue: one stub line (the key replays it)', Object.keys(lines2).length === 1, ST.items);
  var GT = paidLeft({ name: 'Group Trial Hotel', live: true, subStatus: 'trialing', players: 10, others: [{ name: 'New Pub', players: 30 }] });
  var gt = await restartAt(GT, at2(2026, 12, 4, 10, 0));
  check('an account still in its own free month (trialing): back on, no stub line', gt.status === 200 && GT.v.status === 'active' && ST.items.length === 0, gt.body);
  var GA = paidLeft({ name: 'Group Annual Hotel', live: true, plan: 'annual', players: 10, others: [{ name: 'Busy Pub', players: 30 }],
    periodStartS: Math.floor(at2(2026, 7, 1, 0) / 1000), periodEndS: Math.floor(at2(2027, 7, 1, 0) / 1000) });
  ST.subs[GA.oldSub].items.data[0].price.id = 'price_F_A';
  var gaq = await quoteAt(GA, at2(2026, 12, 4, 10, 0));
  var cycA = vpbCycleDays(Math.floor(at2(2026, 7, 1, 0) / 1000), Math.floor(at2(2027, 7, 1, 0) / 1000)), leftA = vpbBrisDays(Math.floor(at2(2027, 7, 1, 0) / 1000)) - vpbBrisDays(Math.floor(at2(2026, 12, 4, 10, 0) / 1000));
  check('an annual group: the stub is the year\'s rate by days of the year left (' + leftA + ' of ' + cycA + ')', gaq.body.stub_cents === vpbProrataCents(2.3 * 12, 10, leftA, cycA), gaq.body);
  var GF = paidLeft({ name: 'Group Sync Fail Hotel', live: true, players: 10, others: [{ name: 'Busy Pub', players: 30 }] });
  var realAns = stripeAnswer; stripeAnswer = function (m, p, f) { if (/^subscription_items\//.test(p.split('?')[0])) return [400, { error: { message: 'refused' } }]; return realAns(m, p, f); };
  var gf = await restartAt(GF, at2(2026, 12, 4, 10, 0)); stripeAnswer = realAns;
  check('Stripe refuses the quantity: nothing has changed (venue back off with its clock, the stub line taken off again)', gf.status === 502 && GF.v.status === 'suspended' && !!GF.v.closed_at && ST.items.every(function (x) { return x.deleted; }), [gf.body, GF.v.status, ST.items]);
  var GP = paidLeft({ name: 'Group Past Due Hotel', live: true, subStatus: 'past_due', others: [{ name: 'Busy Pub', players: 30 }] });
  var gp = await restartAt(GP, at2(2026, 12, 4, 10, 0));
  check('an account with an unpaid invoice: refused, "update your card", nothing written', gp.status === 409 && gp.body.update_card === true && writes().length === 0, gp.body);

  section('6. A paused prospect, and a cancelled one');
  async function pausedProspect(name) {
    var P = await newProspect(name); ENV.VPB_SELF_RESTART = '1';
    await withClock(at(3, 1), function () { return vpaProspectReminderSweep(ENV, at(3, 1)); });
    return P;
  }
  var PP = await pausedProspect('Paused Comeback Hotel');
  check('set up: the free month ran out with no card, so it is paused with its clock running', PP.v.status === 'suspended' && PP.v.suspended_reason === 'free_month_ended' && !!PP.v.closed_at && !!PP.row().paused_at);
  var pdays = [['day 1 of the grace', at(3, 10), true], ['day 5, 23:59:59', at(7, 23, 59, 59), true], ['day 6', at(8, 9), false], ['day 89', LEFT0 + 0 + (Date.parse(PP.v.closed_at) - LEFT0) + 89 * DAY, false]];
  for (var pi = 0; pi < pdays.length; pi++) {
    var pq = await withClock(pdays[pi][1], function () { return call('/account/restart-quote', { venue_id: PP.v.id }, AS(PP.login, PP.v.id)); });
    check('paused prospect, ' + pdays[pi][0] + ': the quote is their card link at ' + (pdays[pi][2] ? '$2.50 (the offer grace)' : '$3.00'),
      pq.body.can_restart === true && pq.body.kind === 'prospect' && pq.body.mode === 'card' && pq.body.rate === (pdays[pi][2] ? 2.5 : 3), pq.body);
  }
  stripeCalls.length = 0; ST.posts.length = 0;
  var pr = await withClock(at(4, 10), function () { return call('/account/restart', { venue_id: PP.v.id }, AS(PP.login, PP.v.id)); });
  var pr2 = await withClock(at(4, 10), function () { return call('/account/restart', { venue_id: PP.v.id }, AS(PP.login, PP.v.id)); });
  check('the tap answers their own signed /add-card link (twice: the same link, and Stripe not called)', pr.status === 200 && /\/add-card\?f=/.test(pr.body.card_url || '') && pr.body.card_url === pr2.body.card_url && ST.posts.length === 0, pr.body);
  var pco = await checkoutAt(PP, at(4, 10));
  check('that link\'s Checkout: the offer price inside the grace, no trial (the month is used)', pco.offer && !pco.trial, pco.body.slice(0, 300));
  PP.founding().stripe_subscription_id = 'sub_prospect_1';
  var before6 = keptSnap();
  await withClock(at(4, 10, 5), function () { return vpaProspectCardAdded(ENV, PP.v.founding_id); });
  await withClock(at(4, 10, 6), function () { return vpaProspectCardAdded(ENV, PP.v.founding_id); });
  check('the card lands: back on, clock cleared, once', PP.v.status === 'active' && PP.v.closed_at === null && DB.vp_admin_audit.filter(function (x) { return x.action === 'prospect_unpaused' && x.target === 'venue:' + PP.v.id; }).length === 1);
  check('and its data is untouched', keptSnap() === before6);
  var P91 = await pausedProspect('Paused Too Long Hotel');
  var t91 = Date.parse(P91.v.closed_at) + 91 * DAY;
  var p91q = await withClock(t91, function () { return call('/account/restart-quote', { venue_id: P91.v.id }, AS(P91.login, P91.v.id)); });
  var p91r = await withClock(t91, function () { return call('/account/restart', { venue_id: P91.v.id }, AS(P91.login, P91.v.id)); });
  var p91l = await withClock(t91, function () { return call('/account/card-link', { venue_id: P91.v.id }, AS(P91.login, P91.v.id)); });
  stripeCalls.length = 0;
  var p91c = await checkoutAt(P91, t91);
  check('paused prospect, day 91: the quote and the tap say held', p91q.body.held === true && p91r.status === 410 && /more than 90 days/.test(p91r.body.error), [p91q.body, p91r.body]);
  check('paused prospect, day 91: the card link refuses too (410), and the old emailed /add-card link shows "on hold" and never opens Checkout',
    p91l.status === 410 && p91l.body.held === true && p91c.calls === 0 && /on hold/.test(String((p91c.res && p91c.res.body) || '')), [p91l.status, p91c.calls]);
  ENV.VPB_SELF_RESTART = '';
  var poff = await withClock(t91, function () { return call('/account/card-link', { venue_id: P91.v.id }, AS(P91.login, P91.v.id)); });
  check('with the switch OFF, the card link behaves exactly as before (no 90-day refusal)', poff.status === 200 && !!poff.body.card_url, poff.body);
  ENV.VPB_SELF_RESTART = '1';
  var P89 = await pausedProspect('Paused Day 89 Hotel');
  var p89l = await withClock(Date.parse(P89.v.closed_at) + 89 * DAY, function () { return call('/account/card-link', { venue_id: P89.v.id }, AS(P89.login, P89.v.id)); });
  check('paused prospect, day 89: the card link still works', p89l.status === 200 && !!p89l.body.card_url, p89l.body);
  var PC = await newProspect('Cancelled Prospect Hotel'); ENV.VPB_SELF_RESTART = '1';
  var tok = await vpaProspectCancelToken(ENV, PC.v.founding_id);
  await withClock(at(1, 10), function () { return vpaProspectCancel({ method: 'POST', url: 'https://api.example/prospect/cancel', headers: { get: function () { return null; } },
    text: function () { return Promise.resolve('f=' + PC.v.founding_id + '&t=' + tok); } }, ENV, null); });
  check('set up: a prospect who cancelled in their month is off as "cancelled", clock running', PC.v.status === 'suspended' && PC.v.suspended_reason === 'cancelled' && !!PC.v.closed_at);
  var pcq = await withClock(at(1, 12), function () { return call('/account/restart-quote', { venue_id: PC.v.id }, AS(PC.login, PC.v.id)); });
  check('a cancelled prospect: the quote is their card link', pcq.body.kind === 'prospect' && pcq.body.mode === 'card', pcq.body);
  var pcc = await checkoutAt(PC, at(1, 12));
  check('its Checkout keeps their offer and a trial, on the card page\'s existing rule (the month\'s end, or Stripe\'s 3-day floor)', pcc.offer && Number(pcc.trial) === Math.max(Math.floor(MONTH_END / 1000), Math.floor(at(1, 12) / 1000) + 3 * 86400), [pcc.trial, Math.floor(MONTH_END / 1000)]);
  PC.founding().stripe_subscription_id = 'sub_pc';
  await withClock(at(1, 12, 5), function () { return vpaProspectCardAdded(ENV, PC.v.founding_id); });
  check('the card lands: a cancelled prospect is back on too, once', PC.v.status === 'active' && PC.v.closed_at === null && DB.vp_admin_audit.filter(function (x) { return x.action === 'prospect_restarted'; }).length === 1);

  section('7. Tamper-proof and refused cases');
  var T = paidLeft({ name: 'Target Hotel' });
  var stranger = U(++OWN), sv = U(++OWN), sf = U(++OWN);
  DB.venueplay_founding.push({ id: sf, plan: 'monthly', stripe_customer_id: 'cus_s', stripe_subscription_id: 'sub_s', status: 'card_on_file' });
  DB.vp_venues.push({ id: sv, name: 'Stranger Pub', founding_id: sf, status: 'active', max_players: 5 });
  DB.vp_venue_staff.push({ auth_user_id: stranger, venue_id: sv, role: 'owner', permissions: null });
  var tx = await restartAt(T, at2(2026, 12, 4, 10, 0), stranger, T.vid, AS(stranger, T.vid));
  check('another account\'s owner naming this venue: refused, nothing written', tx.status === 400 && T.v.status === 'suspended' && writes().length === 0, tx.body);
  var hq = await restartAt(T, at2(2026, 12, 4, 10, 0), null, T.vid, AS(ADMIN, T.vid));
  check('HQ View as: refused (it is the venue\'s card)', hq.status === 403 && T.v.status === 'suspended' && writes().length === 0, hq.body);
  var mgr = U(++OWN); DB.vp_venue_staff.push({ auth_user_id: mgr, venue_id: T.vid, role: 'manager', permissions: { billing: false } });
  var mr = await restartAt(T, at2(2026, 12, 4, 10, 0), mgr);
  check('a restricted manager: refused (money on the owner\'s card)', mr.status === 403 && writes().length === 0, mr.body);
  var nos = await withClock(at2(2026, 12, 4, 10, 0), function () { return call('/account/restart', { venue_id: T.vid }, {}); });
  check('signed out: refused', nos.status === 401);
  var TO = paidLeft({ name: 'Switch Off Hotel', off: true });
  var to1 = await quoteAt(TO, at2(2026, 12, 4, 10, 0)), to2 = await restartAt(TO, at2(2026, 12, 4, 10, 0));
  check('VPB_SELF_RESTART off: the quote says not available, the tap is refused, Stripe never called', to1.body.available === false && to2.status === 403 && stripeCalls.filter(function (c) { return c.url.indexOf('api.stripe.com') !== -1; }).length === 0, [to1.body, to2.status]);
  var RL = paidLeft({ name: 'Rate Limit Hotel', reason: 'archived' });
  var codes = [];
  for (var ri = 0; ri < 7; ri++) codes.push((await restartAt(RL, at2(2026, 12, 6, 10, 0))).status);
  check('rate limited: six tries an hour per login, the seventh is 429', codes.slice(0, 6).every(function (s) { return s === 409; }) && codes[6] === 429, codes);
  var RC = paidLeft({ name: 'Closed By Us Hotel', reason: 'archived' });
  var rc = await restartAt(RC, at2(2026, 12, 4, 10, 0));
  check('closed by us (archived): refused, "switched back on by us"', rc.status === 409 && /switched off by us/.test(rc.body.error) && writes().length === 0, rc.body);
  var RN = paidLeft({ name: 'Failed Card Hotel', reason: 'nonpayment' });
  var rnp = await restartAt(RN, at2(2026, 12, 4, 10, 0));
  check('off for a failed card: refused with "update your card" (the existing failed-payment steps)', rnp.status === 409 && rnp.body.update_card === true, rnp.body);
  var RD = paidLeft({ name: 'Disputed Hotel' }); DB.vp_admin_audit.push({ id: 'd1', action: 'payment_disputed', target: 'account:' + RD.fid, detail: {} });
  var rdq = await quoteAt(RD, at2(2026, 12, 4, 10, 0));
  var rd = await restartAt(RD, at2(2026, 12, 4, 10, 1));
  var rdTickets = (DB.vp_help_tickets || []).filter(function (t) { return t.venue_id === RD.vid; });
  check('a CHARGEBACK: no button, the one neutral line (email support@), no "call us", nothing in Stripe, NOT switched on',
    rdq.body.can_restart === false && rd.status === 409 && rd.body.error === 'To restart this account, email support@venueplay.com.au and we will take it from there.' && rdq.body.error === rd.body.error &&
    writes().length === 0 && RD.v.status === 'suspended' && !('dispute' in rd.body) && !('venue' in rd.body), [rdq.body, rd.body]);
  check('a chargeback: HQ is told who it is ONCE (one help desk ticket naming the venue, emails to support@ and Dean), however many times they try',
    rdTickets.length === 1 && /Chargeback account asked to restart: Disputed Hotel/.test(rdTickets[0].subject) && rdTickets[0].category === 'accounts' &&
    sent.filter(function (m) { return /Disputed Hotel/.test(m.subject || ''); }).map(function (m) { return (m.to || []).join(','); }).sort().join(' ') === 'dean@venueplay.com.au support@venueplay.com.au', [rdTickets, sent.map(function (m) { return [m.to, m.subject]; })]);
  var RX = paidLeft({ name: 'Discount Hotel', discount: true });
  var rxq = await quoteAt(RX, at2(2026, 12, 4, 10, 0));
  var rx = await restartAt(RX, at2(2026, 12, 4, 10, 0));
  var rxT = (DB.vp_help_tickets || []).filter(function (t) { return t.venue_id === RX.vid; });
  check('a special DISCOUNT (33.3%): restarts self-serve at the standard rate ($3), with no special message on the page',
    rx.status === 200 && rx.body.restarted === true && ST.created[0].form['items[0][price]'] === 'price_S_M' && rxq.body.rate === 3 && !/discount|deal|let us know/i.test((JSON.stringify(rxq.body) + JSON.stringify(rx.body)).split('Discount Hotel').join('')), [rxq.body, rx.body]);
  check('and the system tells support@ and HQ: "Discount Hotel has re-signed up; they previously had a 33.3% special discount"',
    rxT.length === 1 && /Discount Hotel has re-signed up/.test(rxT[0].subject) && /they previously had a 33\.3% special discount/.test(rxT[0].message) &&
    sent.filter(function (m) { return /Discount Hotel has re-signed up/.test(m.subject || ''); }).length === 2, [rxT, sent.length]);
  var RM = paidLeft({ name: 'Comp Hotel', comp: true });
  var rm = await restartAt(RM, at2(2026, 12, 4, 10, 0));
  var rmT = (DB.vp_help_tickets || []).filter(function (t) { return t.venue_id === RM.vid; });
  check('a FREE (comp) account with a saved card: restarts at the standard rate, support@ told "they previously had a free account"',
    rm.status === 200 && ST.created[0].form['items[0][price]'] === 'price_S_M' && rmT.length === 1 && /they previously had a free account/.test(rmT[0].message), [rm.body, rmT]);
  var RF = paidLeft({ name: 'Comp No Stripe Hotel', comp: true });
  RF.f().stripe_customer_id = null; RF.f().stripe_subscription_id = null;
  var rfq = await quoteAt(RF, at2(2026, 12, 4, 10, 0));
  var rf2 = await restartAt(RF, at2(2026, 12, 4, 10, 0));
  var csf = ST.sessions[0] || { form: {} };
  check('a free account that never had Stripe: the card page, at the standard rate, by their email, marked with the deal for the webhook',
    rfq.body.mode === 'card' && rfq.body.rate === 3 && rf2.body.mode === 'card' && csf.form['line_items[0][price]'] === 'price_S_M' && !csf.form.customer &&
    csf.form.customer_email === RF.f().contact_email && csf.form['metadata[vp_restart_deal]'] === 'a free account', [rfq.body, csf.form]);
  await withClock(at2(2026, 12, 4, 10, 10), function () { return vpaHandleStripeEvent(ENV, { id: 'evt_comp', type: 'checkout.session.completed', data: { object: { id: csf.id, client_reference_id: RF.fid,
    customer: 'cus_new_comp', subscription: 'sub_comp_paid', metadata: { vp_restart: '1', venue_id: RF.vid, row_id: RF.fid, vp_restart_deal: 'a free account' } } } }); });
  check('paid: back on, the account now has its Stripe customer and subscription and is no longer comp, and support@ is told once',
    RF.v.status === 'active' && RF.f().stripe_customer_id === 'cus_new_comp' && RF.f().stripe_subscription_id === 'sub_comp_paid' && RF.f().status === 'card_on_file' &&
    (DB.vp_help_tickets || []).filter(function (t) { return t.venue_id === RF.vid; }).length === 1, [RF.f(), RF.v.status]);
  var UG = paidLeft({ name: 'Old Undo Hotel', live: true, players: 10, others: [{ name: 'Busy Pub', players: 30 }] });
  var ug = await withClock(at2(2026, 12, 4, 10, 0), function () { return call('/account/cancel-venue', { venue_id: UG.vid, undo: true }, AS(UG.owner, UG.vid)); });
  check('the old "Keep this venue" undo of a group pub already switched off now goes through the restart: back on, with the pro rata stub on the next bill',
    ug.status === 200 && ug.body.restarted === true && UG.v.status === 'active' && ST.items.filter(function (x) { return !x.deleted; }).length === 1 && ST.items[0].amount === 1583, [ug.body, ST.items]);
  var UO = paidLeft({ name: 'Old Undo Off Hotel', off: true, live: true, players: 10, others: [{ name: 'Busy Pub', players: 30 }] });
  var uo = await withClock(at2(2026, 12, 4, 10, 0), function () { return call('/account/cancel-venue', { venue_id: UO.vid, undo: true }, AS(UO.owner, UO.vid)); });
  check('with the switch OFF, that undo is exactly as before (on, no stub line)', uo.status === 200 && UO.v.status === 'active' && ST.items.length === 0, [uo.body, ST.items]);
  var RK = paidLeft({ name: 'No Clock Hotel', noClock: true });
  var rk = await restartAt(RK, at2(2026, 12, 4, 10, 0));
  check('no record of when it left: refused (never assumed to be inside the 90 days)', rk.status === 409 && newSubs() === 0, rk.body);
  var ON = paidLeft({ name: 'Already On Hotel' }); ON.v.status = 'active'; ON.v.suspended_reason = null;
  var onr = await restartAt(ON, at2(2026, 12, 4, 10, 0));
  check('a venue that is on: "already", nothing called', onr.body.already === true && writes().length === 0, onr.body);
  var SM = paidLeft({ name: 'Summary Hotel' });
  var sm = await withClock(at2(2026, 12, 4, 10, 0), function () { return call('/account/summary', {}, AS(SM.owner, SM.vid)); });
  check('/account/summary says the restart is on and which venue has left', sm.body.restart === true && sm.body.venues && sm.body.venues[0].left === true && sm.body.standing.state === 'cancelled', [sm.body.restart, sm.body.venues, sm.body.standing]);

  section('8. The page: the button and its words come from the quote');
  var HTML = readFile('venueplay/app/billing.html');
  var restartView = (0, eval)('(' + lift(HTML, 'restartView') + ')');
  var v1 = restartView({ available: false });
  check('switch off: no button (the card keeps "call us")', v1 === null);
  var vq = (await quoteAt(paidLeft({ name: 'Words Hotel' }), at2(2026, 12, 4, 10, 0))).body;
  var v2 = restartView(vq);
  check('a card on file: "Come back: $50.00 today on Visa ending 4242", with the price and the last day to come back, and no keep-by date for the rate',
    v2.label === 'Come back: $50.00 today on Visa ending 4242' && /20 players at \$2\.50 a player/.test(v2.note) && !/kept|offer/.test(v2.note) && /until Tue 2 Mar/.test(v2.note), v2);
  var v3 = restartView((await quoteAt(paidLeft({ name: 'Words Card Hotel', card: false, joined: '2026-09-01T00:00:00.000Z' }), at2(2026, 12, 9, 10, 0))).body);
  check('no card: "Add a card and come back", at their previous rate even for a short stay, and it says so', v3.label === 'Add a card and come back' && /\$2\.50 a player/.test(v3.note) && /Same plan and price as before\./.test(v3.note) && !/offer/.test(v3.note), v3);
  var v4 = restartView(gq.body);
  check('a group venue: "Bring Group Comeback Hotel back", the stub, its days and the bill date', v4.label === 'Bring Group Comeback Hotel back' && /\$15\.83 for the rest of this cycle \(19 of 30 days/.test(v4.note) && /23 Dec/.test(v4.note), v4);
  var v5 = restartView(q91.body);
  check('day 91: no button, the held words', !v5.label && v5.held === true && /more than 90 days/.test(v5.note), v5);
  var PW = await pausedProspect('Words Prospect Hotel');
  var v6 = restartView((await withClock(at(3, 10), function () { return call('/account/restart-quote', { venue_id: PW.v.id }, AS(PW.login, PW.v.id)); })).body);
  check('a paused prospect: "Add your card and come back", at the offer price kept in the grace', v6 && v6.label === 'Add your card and come back' && /\$2\.50 a player, \$25\.00 a month\./.test(v6.note), v6);
  check('no em dash and lowercase venueplay in every word the button can say', [v2, v3, v4, v5, v6].every(function (x) { return !/[—–]/.test((x.label || '') + x.note) && !/VenuePlay/.test((x.label || '') + x.note); }));
  var SHELL = readFile('venueplay/app/index.html');
  var cbAt = SHELL.indexOf('window.__vpWantComeBack &&');
  check('the leaving email\'s link /app/?come-back=1 sends a signed-in owner or manager to Your account (and ?venue= rides along)',
    /__vpWantComeBack = \/\[\?&\]come-back=1/.test(SHELL) && cbAt > 0 && /billing\.html\?come-back=1/.test(SHELL.slice(cbAt, cbAt + 400)) && /&venue=/.test(SHELL.slice(cbAt, cbAt + 400)));

  if (badCount()) throw new Error('self-serve restart: ' + badCount() + ' of ' + ran + ' failed');
  section('9. Back within 90 days: the previous plan, rate and players (Dean, 10 Nov 2026, INBOX 142)');
  var K1 = paidLeft({ name: 'Standard Seventy Hotel', price: 'price_S_M', joined: '2026-10-01T00:00:00.000Z', players: 35 });
  var k1 = await restartAt(K1, at2(2027, 2, 10, 10, 0));
  check('a standard-rate venue back on day 70: its own standard price, its own 35 players, never the offer',
    k1.status === 200 && ST.created[0].form['items[0][price]'] === 'price_S_M' && ST.created[0].form['items[0][quantity]'] === '35' && k1.body.kept_previous === true, [k1.body, ST.created[0] && ST.created[0].form]);
  var K2 = paidLeft({ name: 'Annual Seventy Hotel', plan: 'annual', price: 'price_F_A' });
  var k2 = await restartAt(K2, at2(2027, 2, 10, 10, 0));
  check('an annual account back on day 70: annual again, its annual offer price', k2.status === 200 && ST.created[0].form['items[0][price]'] === 'price_F_A' && k2.body.kept_previous === true, ST.created[0] && ST.created[0].form);
  var K3 = paidLeft({ name: 'Legacy Price Hotel', price: 'price_retired_2025' });
  var k3 = await restartAt(K3, at2(2026, 12, 10, 10, 0));
  check('a previous price that is no longer one of ours is never charged again: the 5 Nov rules decide (standard here)',
    k3.status === 200 && ST.created[0].form['items[0][price]'] === 'price_S_M' && k3.body.kept_previous === false, [k3.body, ST.created[0] && ST.created[0].form]);
  var K4 = paidLeft({ name: 'Forever Discount Hotel' });
  ST.subs[K4.oldSub].discounts = [{ coupon: { id: 'c_forever', percent_off: 20, duration: 'forever', valid: true } }];
  var k4q = await quoteAt(K4, at2(2027, 1, 20, 10, 0));
  var k4 = await restartAt(K4, at2(2027, 1, 20, 10, 0));
  var k4T = (DB.vp_help_tickets || []).filter(function (t) { return t.venue_id === K4.vid; });
  check('an ongoing ("forever") discount comes back with them: the same price, the same coupon, no "special discount" alert',
    k4.status === 200 && ST.created[0].form['items[0][price]'] === 'price_F_M' && ST.created[0].form['discounts[0][coupon]'] === 'c_forever' && k4T.length === 0
    && /:c_forever$/.test(ST.posts.filter(function (p) { return p.path === 'subscriptions'; })[0].key || ''), [k4.body, ST.created[0] && ST.created[0].form, k4T]);
  check('and the page names no figure Stripe will work out: "Come back on Visa ending 4242", less your discount, same plan and price',
    k4q.body.today === null && k4q.body.discount_kept === true && restartView(k4q.body).label === 'Come back on Visa ending 4242'
    && /less your discount/.test(restartView(k4q.body).note) && /Same plan and price as before, with your discount\./.test(restartView(k4q.body).note), [k4q.body, restartView(k4q.body)]);
  var K5 = paidLeft({ name: 'Forever No Card Hotel', card: false });
  ST.subs[K5.oldSub].discounts = [{ coupon: { id: 'c_forever', percent_off: 20, duration: 'forever', valid: true } }];
  await restartAt(K5, at2(2027, 1, 20, 10, 0));
  check('no card: the card page carries the same coupon (and no promotion-code box, which Stripe will not take with it)',
    ST.sessions[0] && ST.sessions[0].form['discounts[0][coupon]'] === 'c_forever' && !('allow_promotion_codes' in ST.sessions[0].form) && ST.sessions[0].form['line_items[0][price]'] === 'price_F_M', ST.sessions[0] && ST.sessions[0].form);
  var K6 = paidLeft({ name: 'Repeating Discount Hotel' });
  ST.subs[K6.oldSub].discounts = [{ coupon: { id: 'c_rep', percent_off: 50, duration: 'repeating', valid: true } }];
  await restartAt(K6, at2(2026, 12, 10, 10, 0));
  check('a discount that was running out (repeating) is not kept: the standard rate and HQ told, as on 5 Nov',
    ST.created[0] && ST.created[0].form['items[0][price]'] === 'price_S_M' && !('discounts[0][coupon]' in ST.created[0].form)
    && (DB.vp_help_tickets || []).some(function (t) { return t.venue_id === K6.vid && /re-signed up/.test(t.subject || t.title || ''); }), ST.created[0] && ST.created[0].form);
  var K7 = paidLeft({ name: 'Day Ninety One Again Hotel' });
  var k7 = await restartAt(K7, LEFT0 + 91 * DAY);
  check('after the 90 days: still held, never restarted at any price', k7.status === 410 && newSubs() === 0, k7.body);
  var K8 = paidLeft({ name: 'Disputed Seventy Hotel' });
  DB.vp_admin_audit.push({ action: 'payment_disputed', target: 'account:' + K8.fid, detail: {} });
  var k8 = await restartAt(K8, at2(2027, 1, 10, 10, 0));
  check('a chargeback inside the 90 days: no restart (unchanged)', k8.status === 409 && newSubs() === 0 && K8.v.status === 'suspended', k8.body);
  var K9 = paidLeft({ name: 'HQ Reactivate Hotel' });
  var k9 = await withClock(at2(2027, 2, 15, 10, 0), function () { return call('/account/cancel-venue', { venue_id: K9.vid, undo: true }, AS(K9.owner, K9.vid)); });
  check('HQ\'s Reactivate (the owner\'s "Keep this venue" on day 75) goes through the same plan: the previous rate',
    k9.status === 200 && K9.v.status === 'active' && ST.created[0] && ST.created[0].form['items[0][price]'] === 'price_F_M', [k9.body, ST.created[0] && ST.created[0].form]);
  /* A free-month venue that pressed Cancel keeps the rate it was set up on for 90 days from the press. */
  var CX = Date.parse('2026-11-12T00:00:00.000Z'), PR = { offer_rate: 2.5, cancelled_at: new Date(CX).toISOString(), paused_at: null,
    first_signin_at: '2026-11-01T00:00:00.000Z', free_month_ends_at: '2026-12-01T13:59:59.000Z' };
  ENV.VPB_SELF_RESTART = '1';
  var pp1 = vpaProspectPrice(ENV, PR, CX + 60 * DAY), pp2 = vpaProspectPrice(ENV, PR, CX + 90 * DAY);
  check('a cancelled free-month venue back on day 60: the $2.50 it was set up on, long after its month and any grace',
    pp1.founding === true && pp1.rate === 2.5 && pp1.kept === true, pp1);
  check('and at 90 days to the instant: the standard rule again', pp2.rate === 3 && !pp2.kept, pp2);
  var PZ = { offer_rate: 2.5, cancelled_at: null, paused_at: '2026-12-01T14:00:00.000Z', first_signin_at: '2026-11-01T00:00:00.000Z', free_month_ends_at: '2026-12-01T13:59:59.000Z' };
  check('a PAUSED prospect (never pressed Cancel) is not covered: past its grace, the standard rate', vpaProspectPrice(ENV, PZ, Date.parse('2027-01-10T00:00:00.000Z')).rate === 3);
  ENV.VPB_SELF_RESTART = '';
  check('with the restart switched off, a cancelled prospect is priced exactly as before', !vpaProspectPrice(ENV, PR, CX + 60 * DAY).kept && vpaProspectPrice(ENV, PR, CX + 60 * DAY).rate === 3);

  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
