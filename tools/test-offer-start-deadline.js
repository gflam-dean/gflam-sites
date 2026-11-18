/* RE-PINNED to Dean's words (Dean via main INBOX 331, 12 Nov 2026): no "free" in any venue email. "Your first month is on us.
   It starts the first time you sign in", "your first month", and the welcome's slides line ends "...so you can have a play and
   see how the slides work in between your games. You can keep them on or swap them out." (INBOX 339, 12 Nov) Every changed pin is listed in ~/venue-enrich/reports/email-words-12nov/REPINS.md. */
/* THE OFFER NEEDS THE FREE MONTH STARTED BY ITS DATE (Dean, 7 Nov 2026, for the Thu 12 Nov release; branch
   fix/offer-start-deadline-12nov). To get the $2.50 offer rate a prospect must SIGN IN FOR THE FIRST TIME by their offer's
   date (30 November for OFFER-NOV-2026, 31 December for OFFER-DEC-2026). Being set up by then is not enough. A first
   sign-in after it still gets the free month, at the standard $3.00. The 5-day silent keep after a pause is unchanged.

   Runs the REAL billing Worker through its REAL router and hourly sweep (tools/rig-billing-worker.js), on a FIXED clock
   (Date.now is set, never read from the real one):
     1. the rule: both sides of each date, to the millisecond, Brisbane end of day
     2. November, end to end: setup writes no rate; first sign-in on time $2.50, one millisecond late $3.00; Checkout
     3. December and the 10 Nov rollover: which offer a prospect is on (campaign code, HQ's default, a resend)
     4. idempotent: a second sign-in, a racing stale copy, the sweep finding a sign-in in Auth
     5. a card before any sign-in, and a row the old setup left at $2.50
     6. the 5-day keep: an on-time starter keeps $2.50, a late starter has nothing to keep
     7. prospects already signed in before this ships are never changed
     8. HQ > Prospects and the autopilot's quiet list: the rate they will get, or got
     9. the words: welcome, sign-in email, reminders; never "grace", never "lock it in"

   Run from the repo root:  jsc tools/test-offer-start-deadline.js */
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
var REM = function () { return sent.filter(function (m) { return /first month|How is venueplay going/.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }


var CODES = 'OFFER-OCT-2026,OFFER-NOV-2026,OFFER-DEC-2026,OFFER-JAN-2027';
function bms(y, mo, d, h, mi, s, ms) { return Date.UTC(y, mo - 1, d, h - 10, mi || 0, s || 0, ms || 0); }   // Brisbane wall clock, to the ms
var NOV_LAST = bms(2026, 11, 30, 23, 59, 59, 999), DEC_FIRST = bms(2026, 12, 1, 0, 0, 0, 0);
var DEC_LAST = bms(2026, 12, 31, 23, 59, 59, 999), JAN_FIRST = bms(2027, 1, 1, 0, 0, 0, 0);
function withClock(ms, fn) { var real = Date.now; Date.now = function () { return ms; }; return Promise.resolve().then(fn).then(function (r) { Date.now = real; return r; }, function (e) { Date.now = real; throw e; }); }
async function setupAt(ms, o) { return withClock(ms, function () { return prospect(o || {}); }); }
async function signInAt(P, ms) { return withClock(ms, function () { return call('/account/prospect-start', { venue_id: P.v.id }, AS(P.login, P.v.id)); }); }
async function quote(P, ms) { return withClock(ms, async function () { return (await call('/account/card-link', { venue_id: P.v.id }, AS(P.login, P.v.id))).body; }); }
async function hq(ms, P) { return withClock(ms, async function () { var r = await call('/admin/prospects', {}, { Authorization: 'Bearer ' + ADMIN });
  var all = ((r.body && r.body.prospects) || []).concat((r.body && r.body.card_added) || []); return all.filter(function (p) { return p.venue_id === P.v.id; })[0] || {}; }); }
async function checkoutAt(P, ms) {
  return withClock(ms, async function () {
    stripeCalls.length = 0;
    var tok = await vpaCardToken(ENV, P.v.founding_id);
    await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + P.v.founding_id + '&t=' + tok, method: 'GET', headers: { get: function () { return null; } } }, ENV);
    var body = (stripeCalls[0] || {}).body || '';
    return { offer: /line_items%5B0%5D%5Bprice%5D=price_F_M/.test(body), standard: /line_items%5B0%5D%5Bprice%5D=price_S_M/.test(body),
      trial: (/subscription_data%5Btrial_end%5D=(\d+)/.exec(body) || [])[1] || null };
  });
}
function fresh() { world(); ENV.FOUNDING_CODES = CODES; }
var NOV5 = bms(2026, 11, 5, 10, 0), NOV9 = bms(2026, 11, 9, 10, 0), NOV11 = bms(2026, 11, 11, 10, 0), NOV12 = bms(2026, 11, 12, 10, 0);

(async function () {
  section('1. The rule: the last day of the offer\'s month, to 11:59:59.999pm Brisbane, inclusive');
  check('OFFER-NOV-2026 ends 30 Nov 23:59:59.999 Brisbane (2026-11-30T13:59:59.999Z)', new Date(vpaOfferStartDeadlineMs('OFFER-NOV-2026')).toISOString() === '2026-11-30T13:59:59.999Z', new Date(vpaOfferStartDeadlineMs('OFFER-NOV-2026')).toISOString());
  check('OFFER-DEC-2026 ends 31 Dec 23:59:59.999 Brisbane, OFFER-JAN-2027 31 Jan 2027', new Date(vpaOfferStartDeadlineMs('OFFER-DEC-2026')).toISOString() === '2026-12-31T13:59:59.999Z' &&
    new Date(vpaOfferStartDeadlineMs('OFFER-JAN-2027')).toISOString() === '2027-01-31T13:59:59.999Z');
  check('November: a first sign-in at 30 Nov 23:59:59.999 is $2.50; at 1 Dec 00:00:00.000 it is $3.00', vpaOfferRateAt(ENV, 'OFFER-NOV-2026', NOV_LAST) === 2.5 && vpaOfferRateAt(ENV, 'OFFER-NOV-2026', DEC_FIRST) === 3);
  check('December: 31 Dec 23:59:59.999 is $2.50; 1 Jan 00:00:00.000 is $3.00', vpaOfferRateAt(ENV, 'OFFER-DEC-2026', DEC_LAST) === 2.5 && vpaOfferRateAt(ENV, 'OFFER-DEC-2026', JAN_FIRST) === 3);
  check('the offer\'s own day in words: 30 November, 31 December; nothing for no code', vpaOfferDayWords('OFFER-NOV-2026') === '30 November' && vpaOfferDayWords('OFFER-DEC-2026') === '31 December' && vpaOfferDayWords(null) === '');
  check('Dean\'s sentence, with the day', vpaOfferSigninWords('OFFER-DEC-2026') === 'Your first month is on us. It starts the first time you sign in. Sign in by 31 December to keep $2.50 a player.', vpaOfferSigninWords('OFFER-DEC-2026'));

  section('2. November, end to end: setup writes no rate; the first sign-in decides it');
  fresh();
  var A = await setupAt(NOV5, { name: 'On Time Hotel', offer_code: 'OFFER-NOV-2026' });
  check('set up on 5 Nov: no rate written yet, the offer is kept on the audit row', A.row().offer_rate == null && !A.row().first_signin_at &&
    DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_set_up' && a.detail.offer_code === 'OFFER-NOV-2026' && a.target === 'venue:' + A.v.id; }), A.row());
  var B = await setupAt(NOV5, { name: 'One Ms Late Hotel', offer_code: 'OFFER-NOV-2026' });
  var sa = await signInAt(A, NOV_LAST);
  check('first sign-in 30 Nov 23:59:59.999 Brisbane: $2.50 written with the start, and the answer says $2.50', A.row().offer_rate === 2.5 && A.row().first_signin_at === new Date(NOV_LAST).toISOString() && sa.body.rate === 2.5, [A.row().offer_rate, sa.body]);
  var sb = await signInAt(B, DEC_FIRST);
  check('first sign-in 1 Dec 00:00:00.000 Brisbane: the free month still starts, at $3.00', B.row().offer_rate === 3 && B.row().first_signin_at === new Date(DEC_FIRST).toISOString() &&
    B.row().free_month_ends_at === new Date(vpaFreeMonthEnd(DEC_FIRST)).toISOString() && sb.body.rate === 3, [B.row(), sb.body]);
  check('each start is audited with the offer, the rate and the day', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_month_started' && a.target === 'venue:' + B.v.id && a.detail.offer_rate === 3 && a.detail.signin_by === '30 November'; }));
  var qa = await quote(A, bms(2026, 12, 10, 12, 0)), qb = await quote(B, bms(2026, 12, 10, 12, 0));
  check('the card-link on 10 Dec: the on-time starter $2.50, the late starter $3.00', qa.rate === 2.5 && qb.rate === 3, [qa.rate, qb.rate]);
  var ca = await checkoutAt(A, bms(2026, 12, 10, 12, 0)), cb = await checkoutAt(B, bms(2026, 12, 10, 12, 0));
  check('Checkout: the offer price for the on-time starter, the standard price for the late one, both with the free month as a trial',
    ca.offer && cb.standard && !!ca.trial && Math.abs(Number(cb.trial) - Math.floor(Date.parse(B.row().free_month_ends_at) / 1000)) <= 1, [ca, cb]);

  section('3. December, and the 10 Nov rollover: which offer a prospect is on');
  fresh();
  var N9 = await setupAt(NOV9, { name: 'November Campaign Hotel', offer_code: 'OFFER-NOV-2026' });
  var D11 = await setupAt(NOV11, { name: 'December Campaign Hotel', offer_code: 'OFFER-DEC-2026' });
  var H11 = await setupAt(NOV11, { name: 'HQ Form Hotel' });
  check('9 Nov, a reply to the November campaign: signs in by 30 November', (await hq(NOV12, N9)).offer_signin_by === '30 November');
  check('11 Nov, a reply to the December campaign (the switch on 10 Nov): signs in by 31 December', (await hq(NOV12, D11)).offer_signin_by === '31 December');
  check('11 Nov, HQ\'s form with no code: this month\'s offer, 30 November (unchanged)', (await hq(NOV12, H11)).offer_signin_by === '30 November');
  await signInAt(D11, DEC_LAST);
  check('the December prospect signing in 31 Dec 23:59:59.999: $2.50', D11.row().offer_rate === 2.5, D11.row().offer_rate);
  var D2 = await setupAt(NOV11, { name: 'December Late Hotel', offer_code: 'OFFER-DEC-2026' });
  await signInAt(D2, JAN_FIRST);
  check('a December prospect signing in 1 Jan 00:00:00.000: $3.00', D2.row().offer_rate === 3, D2.row().offer_rate);
  var N2 = await setupAt(NOV9, { name: 'November After Rollover Hotel', offer_code: 'OFFER-NOV-2026' });
  await signInAt(N2, bms(2026, 12, 2, 9, 0));
  check('the November prospect signing in on 2 Dec (December\'s offer is running for others): $3.00, their own date decides', N2.row().offer_rate === 3, N2.row().offer_rate);
  var R = await setupAt(bms(2026, 10, 20, 10, 0), { name: 'Resent Hotel', offer_code: 'OFFER-OCT-2026' });
  DB.vp_prospect_welcomes.push({ id: newId(), venue_id: R.v.id, send_at: new Date(NOV12).toISOString(), status: 'sent', detail: { offerCode: 'OFFER-NOV-2026' } });
  DB.vp_prospect_welcomes.push({ id: newId(), venue_id: R.v.id, send_at: new Date(NOV12 + 1000).toISOString(), status: 'cancelled', detail: { offerCode: 'OFFER-JAN-2027' } });
  check('set up on the October offer, then sent a welcome naming November: the newest promise counts (30 November); a cancelled welcome never does',
    (await vpaProspectOfferCode(ENV, R.v.id)) === 'OFFER-NOV-2026', await vpaProspectOfferCode(ENV, R.v.id));
  await signInAt(R, bms(2026, 11, 29, 20, 0));
  check('so their sign-in on 29 Nov is $2.50', R.row().offer_rate === 2.5, R.row().offer_rate);

  section('4. Idempotent: a second sign-in, a racing copy, and the sweep');
  fresh();
  var I = await setupAt(NOV5, { name: 'Twice Hotel', offer_code: 'OFFER-NOV-2026' });
  await signInAt(I, bms(2026, 11, 20, 9, 0));
  var firstI = I.row().first_signin_at;
  await signInAt(I, bms(2026, 12, 5, 9, 0));
  check('a second sign-in after the date changes nothing: still $2.50, the same start', I.row().offer_rate === 2.5 && I.row().first_signin_at === firstI, I.row());
  var stale = {}; for (var k in I.row()) stale[k] = I.row()[k]; stale.first_signin_at = null; stale.offer_rate = null;
  await vpaProspectStartMonth(ENV, stale, bms(2026, 12, 6, 9, 0));
  check('a stale copy racing it (read before the first write): the database keeps $2.50 and the start, and the copy is given them', I.row().offer_rate === 2.5 && I.row().first_signin_at === firstI && stale.offer_rate === 2.5 && stale.first_signin_at === firstI, [I.row().offer_rate, stale.offer_rate]);
  check('one start audited, not two', DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_month_started' && a.target === 'venue:' + I.v.id; }).length === 1);
  var W = await setupAt(NOV5, { name: 'Auth Saw It Hotel', offer_code: 'OFFER-NOV-2026' });
  AUTH.forEach(function (u) { if (u.id === W.login) u.last_sign_in_at = new Date(bms(2026, 11, 29, 18, 0)).toISOString(); });
  check('HQ before the sweep: a sign-in Auth knows of is shown as being recorded, at $2.50', /\$2\.50 a player, signed in by 30 November \(being recorded\)/.test((await hq(bms(2026, 12, 1, 8, 0), W)).rate_words || ''), (await hq(bms(2026, 12, 1, 8, 0), W)).rate_words);
  await withClock(bms(2026, 12, 2, 9, 0), function () { return vpaProspectReminderSweep(ENV, bms(2026, 12, 2, 9, 0)); });
  check('the sweep finding a 29 Nov sign-in on 2 Dec starts the month from 29 Nov, at $2.50', W.row().first_signin_at === new Date(bms(2026, 11, 29, 18, 0)).toISOString() && W.row().offer_rate === 2.5, W.row());

  section('5. A card before any sign-in, and rows the old setup left at $2.50');
  fresh();
  var C = await setupAt(NOV5, { name: 'Card First Hotel', offer_code: 'OFFER-NOV-2026' });
  var c1 = await checkoutAt(C, bms(2026, 11, 30, 12, 0)), c2 = await checkoutAt(C, DEC_FIRST);
  check('a card before any sign-in is priced at that moment: 30 Nov the offer, 1 Dec 00:00 the standard price', c1.offer && c2.standard, [c1, c2]);
  var O = await setupAt(bms(2026, 10, 20, 10, 0), { name: 'Old Setup Hotel', offer_code: 'OFFER-OCT-2026' });
  O.row().offer_rate = 2.5;   // what the setup wrote before this change
  var oc = await checkoutAt(O, NOV12);
  check('an old row with $2.50 written at setup but no sign-in: ignored, its 31 October date has passed, so the standard price', oc.standard && !oc.offer, oc);
  check('HQ shows it as $3.00 and no decided rate', (await hq(NOV12, O)).offer_rate == null && /^\$3\.00, the 31 October offer date has passed$/.test((await hq(NOV12, O)).rate_words), (await hq(NOV12, O)).rate_words);
  await signInAt(O, NOV12);
  check('its first sign-in on 12 Nov overwrites the old $2.50 with $3.00', O.row().offer_rate === 3, O.row().offer_rate);

  section('6. The 5-day keep after a pause: an on-time starter keeps $2.50, a late starter has nothing to keep');
  fresh();
  var G1 = await setupAt(NOV5, { name: 'Keeps It Hotel', offer_code: 'OFFER-NOV-2026' });
  var G2 = await setupAt(NOV5, { name: 'Nothing To Keep Hotel', offer_code: 'OFFER-NOV-2026' });
  await signInAt(G1, NOV_LAST); await signInAt(G2, DEC_FIRST);
  var pauseAt = bms(2027, 1, 1, 9, 0);
  await withClock(pauseAt, function () { return vpaProspectReminderSweep(ENV, pauseAt); });
  check('both paused after their month', !!G1.row().paused_at && !!G2.row().paused_at, [G1.row().paused_at, G2.row().paused_at]);
  var g1 = await checkoutAt(G1, bms(2027, 1, 2, 12, 0)), g2 = await checkoutAt(G2, bms(2027, 1, 2, 12, 0));
  check('a card two days into the pause: the on-time starter still pays the offer price, the late starter the standard price', g1.offer && g2.standard && !g1.trial && !g2.trial, [g1, g2]);
  var k2 = await quote(G2, bms(2027, 1, 2, 12, 0));
  check('the late starter\'s card-link says $3.00 and names no offer kept', k2.rate === 3 && !k2.offer_grace && !k2.offer_kept_until, k2);
  fresh();
  var L = await setupAt(NOV5, { name: 'Late In Month Hotel', offer_code: 'OFFER-NOV-2026' });
  await signInAt(L, bms(2026, 12, 3, 9, 0));
  var lq = await quote(L, bms(2026, 12, 10, 9, 0));
  check('a late starter mid-month while December\'s offer is open to others: still $3.00 (never "whatever is open today")', lq.rate === 3 && vpaLiveCodes(ENV, bms(2026, 12, 10, 9, 0)).length > 0, lq);

  section('7. Prospects already signed in before this ships are never changed');
  fresh();
  var E = await setupAt(bms(2026, 10, 20, 10, 0), { name: 'Signed In Before Hotel', offer_code: 'OFFER-OCT-2026' });
  E.row().first_signin_at = new Date(bms(2026, 10, 25, 10, 0)).toISOString(); E.row().free_month_ends_at = new Date(vpaFreeMonthEnd(bms(2026, 10, 25, 10, 0))).toISOString(); E.row().offer_rate = 2.5;
  await signInAt(E, NOV12);
  check('signed in on 25 Oct at $2.50: a sign-in after this ships changes nothing, the card-link still quotes $2.50', E.row().offer_rate === 2.5 && E.row().first_signin_at === new Date(bms(2026, 10, 25, 10, 0)).toISOString() && (await quote(E, NOV12)).rate === 2.5, E.row());
  var E2 = await setupAt(bms(2026, 10, 20, 10, 0), { name: 'Signed In No Rate Hotel', offer_code: 'OFFER-OCT-2026' });
  E2.row().first_signin_at = new Date(bms(2026, 10, 25, 10, 0)).toISOString(); E2.row().free_month_ends_at = new Date(vpaFreeMonthEnd(bms(2026, 10, 25, 10, 0))).toISOString(); E2.row().offer_rate = null;
  check('signed in with no rate recorded (a late migration): the old rule, whatever is open today, as before', (await quote(E2, NOV12)).rate === 2.5 && E2.row().offer_rate == null);

  section('8. HQ > Prospects and the quiet list: the rate they will get, or got');
  fresh();
  var Q = await setupAt(NOV5, { name: 'Quiet Hotel', offer_code: 'OFFER-NOV-2026' });
  var h1 = await hq(NOV12, Q);
  check('not signed in yet, 12 Nov: "Gets $2.50 if they sign in by 30 November, else $3.00"', h1.rate_words === 'Gets $2.50 if they sign in by 30 November, else $3.00' && h1.offer_rate == null, h1.rate_words);
  check('at 30 Nov 23:59:59.999 still the same words; at 1 Dec 00:00 "$3.00, the 30 November offer date has passed"',
    (await hq(NOV_LAST, Q)).rate_words === 'Gets $2.50 if they sign in by 30 November, else $3.00' && (await hq(DEC_FIRST, Q)).rate_words === '$3.00, the 30 November offer date has passed', (await hq(DEC_FIRST, Q)).rate_words);
  var qr = await withClock(NOV12, function () { return call('/autopilot/prospects/quiet', undefined, AP, 'GET'); });
  var qp = ((qr.body && qr.body.prospects) || []).filter(function (p) { return p.venue_id === Q.v.id; })[0] || {};
  check('the quiet list hands the Mac the day and the sentence for its follow-up', qp.offer_signin_by === '30 November' && qp.offer_open === true &&
    qp.offer_words === 'Your first month is on us. It starts the first time you sign in. Sign in by 30 November to keep $2.50 a player.', qp);
  var qr2 = await withClock(DEC_FIRST, function () { return call('/autopilot/prospects/quiet', undefined, AP, 'GET'); });
  var qp2 = ((qr2.body && qr2.body.prospects) || []).filter(function (p) { return p.venue_id === Q.v.id; })[0] || {};
  check('once the day has passed: offer_open false and no sentence', qp2.offer_open === false && qp2.offer_words === '', qp2);
  var Q1 = await setupAt(NOV5, { name: 'Got It Hotel', offer_code: 'OFFER-NOV-2026' }), Q2 = await setupAt(NOV5, { name: 'Missed It Hotel', offer_code: 'OFFER-NOV-2026' });
  await signInAt(Q1, bms(2026, 11, 29, 10, 0)); await signInAt(Q2, bms(2026, 12, 2, 10, 0));
  check('signed in: the rate they got, "$2.50 a player, first sign-in by 30 November" / "$3.00 a player, first sign-in after 30 November"',
    (await hq(bms(2026, 12, 3, 9, 0), Q1)).rate_words === '$2.50 a player, first sign-in by 30 November' && (await hq(bms(2026, 12, 3, 9, 0), Q2)).rate_words === '$3.00 a player, first sign-in after 30 November',
    [(await hq(bms(2026, 12, 3, 9, 0), Q1)).rate_words, (await hq(bms(2026, 12, 3, 9, 0), Q2)).rate_words]);
  var PANE = readFile('venueplay/app/vp-prospects-hq.js');
  var rateText = (new Function(lift(PANE, 'rateText') + '\nreturn rateText;'))();
  check('the HQ card shows the Worker\'s words in its Price row, and says so when an older Worker sends none',
    rateText(h1) === 'Gets $2.50 if they sign in by 30 November, else $3.00' && rateText({}) === 'Not known yet' && /data-pr-rate="1">' \+ prEsc\(rateText\(p\)\)/.test(PANE));

  section('9. The words: the welcome, the sign-in email, the reminders');
  fresh();
  var vis = function (h) { return String(h || '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' '); };
  var wn = await withClock(NOV5, function () { return vpaRenderProspectWelcome(ENV, { email: 's@x.example', firstName: 'Sam', venueName: 'Words Hotel', signinToken: 'T0K3N', slides: 0, seats: 10, offerCode: 'OFFER-NOV-2026' }); });
  check('the welcome on the November offer: "Your first month is on us. It starts the first time you sign in. Sign in by 30 November to keep $2.50 a player."',
    vis(wn).indexOf("Your first month is on us. It starts the first time you sign in. Sign in by 30 November to keep $2.50 a player a month, for as long as you're with us. No lock-in.") !== -1 && !/lock in the|lock it in|need to start by/i.test(vis(wn)), vis(wn).slice(0, 900));
  var wd = await withClock(NOV11, function () { return vpaRenderProspectWelcome(ENV, { email: 's@x.example', venueName: 'Words Hotel', signinToken: 'T0K3N', slides: 0, seats: 10, offerCode: 'OFFER-DEC-2026' }); });
  check('the welcome on the December offer (after the 10 Nov switch): Sign in by 31 December', vis(wd).indexOf('Sign in by 31 December to keep $2.50 a player a month') !== -1 && vis(wd).indexOf('30 November') === -1);
  var wl = await withClock(DEC_FIRST, function () { return vpaRenderProspectWelcome(ENV, { email: 's@x.example', venueName: 'Words Hotel', signinToken: 'T0K3N', slides: 0, seats: 10, offerCode: 'OFFER-NOV-2026' }); });
  check('a welcome on the November offer sent on 1 Dec: the standard $3.00 line, no sign-in-by date', /Your first month is on us\. It starts the first time you sign in\. Then it's \$3\.00 a player a month\. No lock-in\./.test(vis(wl)) && !/Sign in by/.test(vis(wl)), vis(wl).slice(0, 600));
  var tplWas = TPL['welcome-prospect.html'];
  TPL['welcome-prospect.html'] = tplWas.replace(/<!--IF:founding-->[\s\S]*?<!--ENDIF:founding-->/, "<!--IF:founding-->\n<p>To keep the {{player_rate}} deal, it stays at {{player_rate}} for as long as you're with us.{{offer_deadline}} Your first month is on us.</p>\n<!--ENDIF:founding-->");
  var wo = await withClock(NOV5, function () { return vpaRenderProspectWelcome(ENV, { email: 's@x.example', venueName: 'Words Hotel', signinToken: 'T0K3N', slides: 0, seats: 10, offerCode: 'OFFER-NOV-2026' }); });
  TPL['welcome-prospect.html'] = tplWas;
  check('while Pages still serves the OLD template (the Worker deploys first), its token still gets the old whole sentence, never "us.30 November"',
    /with us\. You just need to start by 30 November\. Your first month/.test(vis(wo)) && !/us\.30 November/.test(vis(wo)), vis(wo).slice(0, 400));
  var S = await setupAt(NOV5, { name: 'Signin Words Hotel', offer_code: 'OFFER-NOV-2026', send_welcome: false });
  var su = AUTH.filter(function (u) { return u.id === S.login; })[0]; if (su && !su.email) su.email = S.row().email;
  var mark = sent.length;
  await withClock(bms(2026, 11, 20, 10, 0), function () { return vpaSendSigninLink(ENV, S.login, S.v.id, { hq: true }); });
  var se = sent.slice(mark).map(function (m) { return vis(m.html); }).join(' ');
  check('the sign-in link email before the date: the same sentence', se.indexOf('Your first month is on us. It starts the first time you sign in. Sign in by 30 November to keep $2.50 a player.') !== -1, se.slice(0, 600));
  mark = sent.length;
  await withClock(bms(2026, 12, 2, 10, 0), function () { return vpaSendSigninLink(ENV, S.login, S.v.id, { hq: true }); });
  var se2 = sent.slice(mark).map(function (m) { return vis(m.html); }).join(' ');
  check('after the date: the link email goes without it', se2.length > 50 && se2.indexOf('Sign in by') === -1, se2.slice(0, 300));
  var r1 = await vpaRenderProspectReminder(ENV, { kind: 'early', email: 'a@b.example', venueName: 'X', endsWords: 'Wed', daysLeft: 20, offerRate: 2.5, cardUrl: 'c', cancelUrl: 'd' });
  var r2 = await vpaRenderProspectReminder(ENV, { kind: 'early', email: 'a@b.example', venueName: 'X', endsWords: 'Wed', daysLeft: 20, offerRate: 3, cardUrl: 'c', cancelUrl: 'd' });
  check('reminders: an on-time starter "You started your first month in time for $2.50 a player"; a late starter no offer at all',
    vis(r1.html).indexOf('You started your first month in time for $2.50 a player.') !== -1 && !/\$2\.50|offer/.test(vis(r2.html)), [vis(r1.html).slice(0, 300), vis(r2.html).slice(0, 300)]);
  var W1 = readFile('venueplay/emails/welcome-prospect.html'), R1 = readFile('venueplay/emails/prospect-reminder.html'), API = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var spoken = ['vpaRenderProspectWelcome', 'vpaRenderProspectReminder', 'vpaOfferSigninWords', 'vpaProspectRateInfo', 'vpaProspectSigninOfferWords'].map(function (n) { return lift(API, n); }).join('\n');
  check('grep: the two templates and the Worker functions that write these words never say "grace" or "lock it in"/"lock in the", and have no long dash',
    !/grace/i.test(W1 + R1 + spoken) && !/lock it in|lock in the/i.test(W1 + R1 + spoken) && !/[—–]/.test(W1 + R1 + spoken), (W1 + R1 + spoken).match(/.{40}(grace|lock it in|lock in the).{40}/i));

  section('10. Across the 10 Nov offer switch (Dean, 7 Nov 2026): each message, a November and a December prospect, 9 Nov late and 10 Nov early');
  fresh();
  var LATE9 = bms(2026, 11, 9, 23, 59, 0, 0), EARLY10 = bms(2026, 11, 10, 0, 1, 0, 0);
  var PN = await setupAt(LATE9, { name: 'Switch Night Nov Hotel', offer_code: 'OFFER-NOV-2026', send_welcome: false });
  var PD = await setupAt(EARLY10, { name: 'Switch Morning Dec Hotel', offer_code: 'OFFER-DEC-2026', send_welcome: false });
  var rw = function (ms, code) { return withClock(ms, function () { return vpaRenderProspectWelcome(ENV, { email: 's@x.example', venueName: 'Switch Hotel', signinToken: 'T0K3N', slides: 0, seats: 10, offerCode: code }); }); };
  var wN9 = vis(await rw(LATE9, 'OFFER-NOV-2026')), wD10 = vis(await rw(EARLY10, 'OFFER-DEC-2026')), wN10 = vis(await rw(EARLY10, 'OFFER-NOV-2026'));
  check('welcome: November prospect (9 Nov 11:59pm, and still on 10 Nov) reads 30 November; December prospect (10 Nov 12:01am) reads 31 December',
    wN9.indexOf('Sign in by 30 November to keep $2.50 a player a month') !== -1 && wN10.indexOf('Sign in by 30 November to keep $2.50 a player a month') !== -1 &&
    wD10.indexOf('Sign in by 31 December to keep $2.50 a player a month') !== -1 && wD10.indexOf('30 November') === -1, [wN9.slice(0, 200), wD10.slice(0, 200)]);
  var wN1 = vis(await rw(DEC_FIRST, 'OFFER-NOV-2026')), wD1 = vis(await rw(DEC_FIRST, 'OFFER-DEC-2026')), wDJ = vis(await rw(JAN_FIRST, 'OFFER-DEC-2026'));
  check('welcome after the date: November on 1 Dec and December on 1 Jan get the standard $3.00 line; December on 1 Dec still 31 December',
    /Then it's \$3\.00 a player a month/.test(wN1) && !/Sign in by/.test(wN1) && /Then it's \$3\.00 a player a month/.test(wDJ) && !/Sign in by/.test(wDJ) && wD1.indexOf('Sign in by 31 December') !== -1);
  [PN, PD].forEach(function (P) { var u = AUTH.filter(function (x) { return x.id === P.login; })[0]; if (u && !u.email) u.email = P.row().email; });
  var link = async function (P, ms) { var m0 = sent.length; await withClock(ms, function () { return vpaSendSigninLink(ENV, P.login, P.v.id, { hq: true }); }); return sent.slice(m0).map(function (m) { return vis(m.html); }).join(' '); };
  var lN = await link(PN, EARLY10), lD = await link(PD, EARLY10);
  check('sign-in link email on 10 Nov: November prospect 30 November, December prospect 31 December',
    lN.indexOf('Sign in by 30 November to keep $2.50 a player.') !== -1 && lD.indexOf('Sign in by 31 December to keep $2.50 a player.') !== -1, [lN.slice(0, 300), lD.slice(0, 300)]);
  var lN2 = await link(PN, bms(2026, 12, 2, 9, 0)), lD2 = await link(PD, bms(2026, 12, 2, 9, 0));
  check('sign-in link email on 2 Dec: none for the November prospect (date passed), still 31 December for the December one',
    lN2.length > 50 && lN2.indexOf('Sign in by') === -1 && lD2.indexOf('Sign in by 31 December') !== -1);
  var quiet = async function (ms, P) { var r = await withClock(ms, function () { return call('/autopilot/prospects/quiet', undefined, AP, 'GET'); });
    return ((r.body && r.body.prospects) || []).filter(function (x) { return x.venue_id === P.v.id; })[0] || {}; };
  var qN = await quiet(EARLY10, PN), qD = await quiet(EARLY10, PD);
  check('the Mac\'s nudge fields on 10 Nov: November offer_signin_by 30 November, December 31 December, each with its own sentence',
    qN.offer_signin_by === '30 November' && qN.offer_open === true && /Sign in by 30 November to keep \$2\.50 a player\.$/.test(qN.offer_words) &&
    qD.offer_signin_by === '31 December' && qD.offer_open === true && /Sign in by 31 December to keep \$2\.50 a player\.$/.test(qD.offer_words), [qN, qD]);
  var qN2 = await quiet(DEC_FIRST, PN), qD2 = await quiet(JAN_FIRST, PD);
  check('after each date the Mac gets no sentence (offer_open false): it uses the standard line',
    qN2.offer_open === false && qN2.offer_words === '' && qD2.offer_open === false && qD2.offer_words === '', [qN2.offer_open, qD2.offer_open]);

  if (badCount()) throw new Error('offer start deadline: ' + badCount() + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
