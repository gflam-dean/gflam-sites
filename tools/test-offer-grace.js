/* A PROSPECT'S FREE MONTH, ITS CARD REMINDERS AND THE PAUSE, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026; migration 127).

   Dean's decisions: the free month starts at the FIRST SIGN-IN; with no card there are three reminders, day 3,
   day 23 and the day before it ends (day 29) (Dean, 30 Oct 2026; it was seven: 3, 10, 17, 24, 28, 29, 30), 8am to
   5pm Monday to Friday Brisbane; a card or a
   cancel stops them; with no card at the end the account PAUSES (games off, the TV keeps its ads) and the offer
   price it was set up on goes, so a card added after that is at the price of the day.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router and its REAL hourly sweep,
   walked an hour at a time across a whole month, and the console's real holdWords:
     1. the reminder calendar: weekends moved (day 3 and day 23 on to Monday, day 29 back to Friday)
     2. /account/prospect-start: starts the month once, for the venue's owner or manager only, never View as
     3. a month with no card: every reminder once, on its day, inside the hours, the right words; then the pause
     4. the offer: held through the month after the offer closes; gone after the pause and its 5-day grace (card link
      and Checkout; the grace itself, day by day, is tools/test-offer-grace.js)
     5. a card stops everything; a card after the pause switches the venue back on
     6. cancel: the link asks first (a mail scanner cancels nobody), then switches off and stops the reminders
     7. a missed week sends one reminder, not a pile; a sign-in the guide never reported is found in Auth
     8. the pause screen says what happened, in the console's own holdWords

   Run from the repo root:  jsc tools/test-prospect-free-month.js */
/* THE 5-DAY OFFER GRACE, WALKED DAY BY DAY (Dean, 5 Nov 2026, builds INBOX 24; branch fix/offer-grace-10nov).

   The rule: the free month ends with no card, the account pauses (as before), and they have 5 DAYS after that date
   to add a card and still keep their offer price ($2.50). After that the offer is gone and the standard rate applies.

   THE BOUNDARY (decided here, written in NOTES.md): the free month's last day is "day 0" (it ends 11:59:59pm Brisbane).
   Day 1 is the first paused day, day 5 the last offer day, and the offer holds to 11:59:59.999pm Brisbane on day 5.
   00:00:00 on day 6 is the standard rate. Brisbane time, the same end-of-day rule as the free month and the offer codes.

   Runs the REAL billing Worker through its REAL router and hourly sweep (tools/rig-billing-worker.js), a whole free
   month from the first sign-in and then the grace days, with a FIXED clock (Date.now is set, never read):
     1. every day of the month and the grace: status, the price the card-link quotes, the price Checkout charges
     2. the boundary, to the millisecond: day 5 23:59:59.999 offer, day 6 00:00:00.000 standard
     3. a card on day 0, day 1, day 5 and day 6: price, trial, switch-on
     4. a late sweep never moves the deadline; a standard-rate prospect never gains an offer
     5. idempotent: a card twice, a webhook plus the sweep, a second Checkout: one switch-on, no second subscription
     6. the existing flows: cancel during the grace stays cancelled, a card in the month stops the pause

   Run from the repo root:  jsc tools/test-offer-grace.js */
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
  ENV.FOUNDING_CODES = '';   // the offer they were set up on has long closed: only THEIR offer_rate can hold the price
  return P;
}

(async function () {
  section('1. Pure rules: the grace end, to the millisecond');
  var P0 = { first_signin_at: new Date(BNE_FIRST).toISOString(), free_month_ends_at: new Date(MONTH_END).toISOString(), offer_rate: 2.5 };
  check('the free month ends 11:59:59pm Wed 2 Dec Brisbane (day 0)', new Date(MONTH_END).toISOString() === '2026-12-02T13:59:59.000Z', new Date(MONTH_END).toISOString());
  check('the grace ends 11:59:59pm Mon 7 Dec Brisbane (day 5), five whole days later', new Date(vpaOfferGraceEnd(P0)).toISOString() === '2026-12-07T13:59:59.000Z', new Date(vpaOfferGraceEnd(P0)).toISOString());
  check('the grace is counted from the free month\'s end, never from paused_at (a late pause moves nothing)',
    vpaOfferGraceEnd(Object.assign({ paused_at: new Date(at(5, 9)).toISOString() }, P0)) === vpaOfferGraceEnd(P0));
  var pe = { env: ENV };
  check('day 5, 23:59:59.999: still the offer', vpaProspectPrice(ENV, P0, at(7, 23, 59, 59, 999)).rate === 2.5 && vpaProspectPrice(ENV, P0, at(7, 23, 59, 59, 999)).grace === true);
  check('day 6, 00:00:00.000: the standard rate, no offer', vpaProspectPrice(ENV, P0, at(8, 0, 0, 0, 0)).rate === 3 && vpaProspectPrice(ENV, P0, at(8, 0, 0, 0, 0)).founding === false);
  check('the month\'s last instant (day 0, 23:59:59.000) is still the month, not the grace', vpaProspectMonthOver(P0, MONTH_END) === false && vpaProspectMonthOver(P0, MONTH_END + 1) === true);
  check('a prospect set up at the standard rate has no offer to keep, in the month or the grace', vpaProspectPrice(ENV, Object.assign({}, P0, { offer_rate: null }), at(4, 9)).rate === 3 || vpaProspectPrice(ENV, Object.assign({}, P0, { offer_rate: null }), at(4, 9)).founding === false);

  section('2. A whole month, then the grace, one day at a time (sweep each hour, card-link and Checkout each day)');
  var W = await newProspect('Walk The Grace Hotel');
  var seen = [];
  var cursor = BNE_FIRST;
  var lastDay = '';
  for (var d = 0; d < 41; d++) {
    var dayStart = bne(2026, 11, 2, 0, 0) + d * 86400000, label = vpaBneDay(dayStart);
    for (var h = 0; h < 24; h += 3) {
      var t = dayStart + h * 3600000 + 5 * 60000;
      if (t < BNE_FIRST) continue;
      await withClock(t, function () { return vpaProspectReminderSweep(ENV, t); });
    }
    var noon = dayStart + 12 * 3600000;
    var q = await quote(W, noon), co = await checkoutAt(W, noon);
    seen.push({ day: label, status: W.v.status, rate: q.rate, paused: !!q.paused, grace: !!q.offer_grace, offerPrice: co.offer, stdPrice: co.standard, trial: !!co.trial });
  }
  function dayRow(date) { return seen.filter(function (x) { return x.day === date; })[0]; }
  var inMonth = seen.filter(function (x) { return x.day >= '2026-11-02' && x.day <= '2026-12-02'; });
  check('all 31 days of the free month (2 Nov to 2 Dec): active, the $2.50 offer, Checkout on the offer price WITH a trial to the month\'s end',
    inMonth.length === 31 && inMonth.every(function (x) { return x.status === 'active' && x.rate === 2.5 && !x.paused && x.offerPrice && x.trial; }), inMonth.filter(function (x) { return !(x.status === 'active' && x.rate === 2.5 && x.offerPrice && x.trial); }));
  var graceDays = ['2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07'].map(dayRow);
  check('grace days 1 to 5 (3 to 7 Dec): PAUSED (suspended), yet the card is still quoted $2.50 and Checkout is on the OFFER price, with no second free month',
    graceDays.every(function (x) { return x && x.status === 'suspended' && x.paused && x.rate === 2.5 && x.grace && x.offerPrice && !x.stdPrice && !x.trial; }), graceDays);
  var after = ['2026-12-08', '2026-12-09', '2026-12-10', '2026-12-12'].map(dayRow);
  check('day 6 and later (8 Dec on): still paused, the offer is gone: quoted $3.00 and Checkout on the STANDARD price, no trial',
    after.every(function (x) { return x && x.status === 'suspended' && x.rate === 3 && !x.grace && x.stdPrice && !x.offerPrice && !x.trial; }), after);
  check('the pause landed on 3 Dec (day 1) and recorded when the offer is kept to (Mon 7 Dec 11:59:59pm Brisbane)',
    DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_paused' && a.target === 'venue:' + W.v.id && a.detail && a.detail.offer_kept_until === '2026-12-07T13:59:59.000Z'; }), DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_paused'; }));
  var kept = await quote(W, at(5, 12));
  check('the card-link names the date the offer is kept to, for the console', kept.offer_grace === true && kept.offer_kept_until === '2026-12-07T13:59:59.000Z' && kept.offer_kept_words === 'Mon 7 December', kept);
  var hq = await list(); var hqrow = ((hq.body && hq.body.prospects) || []).filter(function (p) { return p.name === 'Walk The Grace Hotel'; })[0];
  check('HQ > Prospects shows a paused prospect and when the offer is kept to', !!hqrow && hqrow.status === 'paused' && hqrow.offer_kept_until === '2026-12-07T13:59:59.000Z', hqrow);

  section('3. The boundary, to the millisecond, through Checkout');
  var B = await newProspect('Boundary Hotel');
  await withClock(at(3, 0, 5), function () { return vpaProspectReminderSweep(ENV, at(3, 0, 5)); });
  check('paused by the sweep just after midnight of day 1', B.v.status === 'suspended' && !!B.row().paused_at);
  var b1 = await checkoutAt(B, at(7, 23, 59, 58, 0)), b2 = await checkoutAt(B, at(7, 23, 59, 59, 999)), b3 = await checkoutAt(B, at(8, 0, 0, 0, 0)), b4 = await checkoutAt(B, at(8, 0, 0, 1, 0));
  check('Mon 7 Dec 11:59:58pm and 11:59:59.999pm Brisbane: the offer price', b1.offer && b2.offer && !b1.standard && !b2.standard, [b1.offer, b2.offer]);
  check('Tue 8 Dec 12:00:00.000am and 12:00:01am Brisbane: the standard price', b3.standard && b4.standard && !b3.offer && !b4.offer, [b3.standard, b4.standard]);
  check('a card page opened in the grace is made to close when the grace does (Stripe\'s own 30 minute floor at the very edge)',
    !!b1.expires && Number(b1.expires) <= Math.floor(at(7, 23, 59, 58) / 1000) + 31 * 60 && Number(b1.expires) >= Math.floor(at(8, 0, 0) / 1000), b1.expires);
  var mid = await checkoutAt(B, at(5, 12));
  check('opened mid-grace (Sat 5 Dec noon): closes within 23 hours (Stripe\'s own cap), never later than the grace end', Number(mid.expires) <= Math.floor(at(8, 0, 0) / 1000) && Number(mid.expires) === Math.floor(at(5, 12) / 1000) + 23 * 3600, [mid.expires, Math.floor(at(8, 0, 0) / 1000)]);
  check('a standard-price page has no grace marker and no forced expiry', !/offer_grace/.test(b3.body) && !b3.expires, b3.body.slice(0, 300));

  section('4. A card added on day 0, day 1, day 5 and day 6: price, trial, switch-on');
  async function cardOn(P, ms) {   // the card lands (the webhook sets the subscription, then switches the venue on)
    P.founding().stripe_subscription_id = 'sub_' + ms;
    return withClock(ms, function () { return vpaProspectCardAdded(ENV, P.v.founding_id); });
  }
  var D0 = await newProspect('Day Zero Hotel');
  await withClock(at(2, 12), function () { return vpaProspectReminderSweep(ENV, at(2, 12)); });
  var d0c = await checkoutAt(D0, at(2, 12));
  var d0r = await cardOn(D0, at(2, 12));
  check('card on day 0 (Wed 2 Dec noon, still the free month): the offer, a trial to the month\'s end (Stripe\'s 3 day minimum on the last day: existing behaviour), and it was never paused',
    d0c.offer && d0c.trial && Number(d0c.trial) === Math.max(Math.floor(MONTH_END / 1000), Math.floor(at(2, 12) / 1000) + 3 * 86400) && D0.v.status === 'active' && !D0.row().paused_at && d0r === false, [d0c.trial, D0.v.status]);
  var D1 = await newProspect('Day One Hotel');
  await withClock(at(3, 9), function () { return vpaProspectReminderSweep(ENV, at(3, 9)); });
  var d1c = await checkoutAt(D1, at(3, 9));
  check('paused first, day 1 (Thu 3 Dec 9am)', D1.v.status === 'suspended' && D1.v.suspended_reason === 'free_month_ended');
  var d1r = await cardOn(D1, at(3, 9, 30));
  check('card on day 1: the offer price, NO second free month, and the venue switches straight back on, audited',
    d1c.offer && !d1c.trial && d1r === true && D1.v.status === 'active' && D1.v.suspended_reason === null && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_unpaused' && a.target === 'venue:' + D1.v.id; }), [d1c.trial, D1.v.status]);
  var D5 = await newProspect('Day Five Hotel');
  await withClock(at(5, 9), function () { return vpaProspectReminderSweep(ENV, at(5, 9)); });
  var d5c = await checkoutAt(D5, at(7, 23, 59, 59, 999));
  var d5r = await cardOn(D5, at(7, 23, 59, 59, 999));
  check('card on day 5 at 11:59:59.999pm: the offer price, no trial, switched back on', d5c.offer && !d5c.trial && d5r === true && D5.v.status === 'active', [d5c.offer, d5c.trial, D5.v.status]);
  var D6 = await newProspect('Day Six Hotel');
  await withClock(at(5, 9), function () { return vpaProspectReminderSweep(ENV, at(5, 9)); });
  var d6c = await checkoutAt(D6, at(8, 0, 0, 0, 0));
  var d6r = await cardOn(D6, at(8, 0, 0, 0, 0));
  check('card on day 6 at 12:00:00am: the STANDARD price, no trial, switched back on (a late card still comes back on)', d6c.standard && !d6c.trial && d6r === true && D6.v.status === 'active', [d6c.standard, d6c.trial, D6.v.status]);

  var U = await newProspect('Unswept Hotel');   // the month is over but the hourly sweep has not run yet: still no trial, still the offer
  var u1 = await checkoutAt(U, at(3, 0, 0, 0, 0));
  check('the first second after the month, before any sweep has paused them: the offer price and NO trial (the month is used)', U.v.status === 'active' && u1.offer && !u1.trial, [U.v.status, u1.offer, u1.trial]);

  section('5. A late sweep never moves the deadline, and a standard-rate prospect never gains an offer');
  var L = await newProspect('Late Sweep Hotel');
  await withClock(at(6, 10), function () { return vpaProspectReminderSweep(ENV, at(6, 10)); });   // the sweep was down until day 4
  check('paused late, on day 4', L.v.status === 'suspended' && L.row().paused_at === new Date(at(6, 10)).toISOString());
  var l1 = await checkoutAt(L, at(7, 23, 59, 59, 999)), l2 = await checkoutAt(L, at(8, 0, 0, 0, 0));
  check('the offer still ends at the end of day 5 (the late pause moved nothing): offer at 7 Dec 11:59:59pm, standard at 8 Dec midnight', l1.offer && l2.standard, [l1.offer, l2.standard]);
  var S = await newProspect('Standard Rate Hotel');
  S.row().offer_rate = null;
  var s1 = await checkoutAt(S, at(1, 12)), s2 = await checkoutAt(S, at(4, 12));
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099';   // even with an offer open today
  var s3 = await checkoutAt(S, at(4, 12)); ENV.FOUNDING_CODES = '';
  check('a prospect set up at $3.00 gets no offer in the month or the grace', !s1.offer && !s2.offer && s1.standard && s2.standard, [s1.offer, s1.standard, s2.offer, s2.standard]);
  check('in the grace, with an offer open today elsewhere: still the standard price (the offer is gone, not "whatever is open")', s3.standard && !s3.offer, [s3.standard, s3.offer]);

  section('6. Idempotent, and no double charge');
  var I = await newProspect('Twice Hotel');
  await withClock(at(5, 9), function () { return vpaProspectReminderSweep(ENV, at(5, 9)); });
  await cardOn(I, at(5, 10));
  var auditsBefore = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_unpaused' && a.target === 'venue:' + I.v.id; }).length;
  var again1 = await withClock(at(5, 10, 1), function () { return vpaProspectCardAdded(ENV, I.v.founding_id); });
  var again2 = await withClock(at(5, 11), function () { return vpaProspectReminderSweep(ENV, at(5, 11)); });
  var again3 = await withClock(at(6, 11), function () { return vpaProspectReminderSweep(ENV, at(6, 11)); });
  var auditsAfter = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_unpaused' && a.target === 'venue:' + I.v.id; }).length;
  check('the card webhook twice and two later sweeps: ONE switch-on and ONE audit row, the venue still active', auditsBefore === 1 && auditsAfter === 1 && again1 === false && I.v.status === 'active', [auditsBefore, auditsAfter, again1, I.v.status]);
  check('a carded venue is never paused again by a later sweep', I.v.status === 'active' && again2 && again2.paused.length === 0 && again3.paused.length === 0);
  stripeCalls.length = 0;
  var second = await checkoutAt(I, at(5, 12));
  check('a second add-card click after the card is on: no Checkout session is made (no second subscription, no double charge), it goes to billing',
    second.calls === 0 && second.res && /billing/.test(second.res.redirect || ''), [second.calls, second.res]);
  var q2 = await quote(I, at(5, 12));
  check('and the card-link says a card is on file', q2.has_card === true && !q2.card_url, q2);

  section('7. The existing flows are not broken');
  var Cn = await newProspect('Cancelled In Grace Hotel');
  await withClock(at(4, 9), function () { return vpaProspectReminderSweep(ENV, at(4, 9)); });
  var link = await vpaProspectCancelLink(ENV, Cn.v.founding_id), cq = link.split('?')[1];
  var cr = await vpaProspectCancel({ method: 'POST', url: 'https://api.venueplay.com.au/prospect/cancel', headers: { get: function () { return null; } }, text: function () { return Promise.resolve(cq); } }, ENV);
  check('a prospect who cancels during the grace is cancelled (suspended: cancelled stays honest) and the sweep does not touch them again',
    !!Cn.row().cancelled_at && /All done/.test(cr.body), cr.body && cr.body.slice(0, 100));
  var cnBefore = JSON.stringify([Cn.v.status, Cn.v.suspended_reason]);
  await withClock(at(5, 9), function () { return vpaProspectReminderSweep(ENV, at(5, 9)); });
  check('a cancelled prospect is not unpaused or re-paused by a later sweep', JSON.stringify([Cn.v.status, Cn.v.suspended_reason]) === cnBefore, [Cn.v.status, Cn.v.suspended_reason]);
  var E = await newProspect('Card In Month Hotel');
  E.founding().stripe_subscription_id = 'sub_in_month';
  await walk(BNE_FIRST, at(10, 12), 6 * 3600000);
  check('a card in the month: never paused, even ten days past its end', E.v.status === 'active' && !E.row().paused_at);
  var R = await newProspect('Reminders Unchanged Hotel');
  var got = await walk(BNE_FIRST, MONTH_END, 3600000);
  check('the settled reminders are untouched: day 3, 23 and 29 only, nothing new for the grace',
    got.map(function (g) { return day(g.at); }).join(' ') === '2026-11-05 2026-11-25 2026-12-01', got.map(function (g) { return day(g.at); }));
  /* 8. THE EMAILS SAY THE GRACE ONLY WHEN DEAN SWITCHES IT ON (6 Nov 2026, OFFER_GRACE_EMAILS on the billing Worker). */
  var html = function (g) { return String((g && g.msg && g.msg.html) || ''); };
  var last = got.filter(function (g) { return /ends/.test(g.msg.subject || ''); })[0];
  check('switch OFF (the default): the day-29 reminder keeps today\'s words (the offer ends with the pause), no 5 days',
    !!last && /offer you were set up on ends with the pause/.test(html(last)) && !/5 more days/.test(html(last)), last && html(last).slice(0, 200));
  ENV.OFFER_GRACE_EMAILS = 'on';
  var G = await newProspect('Grace Words Hotel');
  var gotG = await walk(BNE_FIRST, MONTH_END, 3600000);
  var keptWords = vpaBneDateWords(vpaOfferGraceEnd(G.row()));
  var lastG = gotG.filter(function (g) { return /ends/.test(g.msg.subject || ''); })[0];
  check('switch ON: every reminder says they keep the $2.50 for 5 more days after the free month, to the grace\'s own last day, then the standard rate',
    gotG.length === 3 && gotG.every(function (g) { return html(g).indexOf('You keep the $2.50 a player offer for 5 more days after your free month, so add your card by ' + keptWords + ' to keep it. After that, it&#39;s our standard $3.00 a player.') !== -1; }) &&
    gotG.every(function (g) { return !/ends with the pause/.test(html(g)); }), [keptWords, gotG.length, lastG && html(lastG).slice(0, 200)]);
  var q = await quote(G, at(4, 12));
  check('the date in the email is the one the card-link quotes in the grace (one answer, one place)', q.offer_kept_words === keptWords, [q.offer_kept_words, keptWords]);
  check('switch ON, no date known (no month started): the reminder falls back to today\'s words, never a blank date',
    /ends with the pause/.test((await vpaRenderProspectReminder(ENV, { kind: 'last', email: 'a@b.example', venueName: 'X', endsWords: 'Wed', daysLeft: 2, offerRate: 2.5, cardUrl: 'c', cancelUrl: 'd', graceWords: '' })).html));
  var std = await vpaRenderProspectReminder(ENV, { kind: 'last', email: 'a@b.example', venueName: 'X', endsWords: 'Wed', daysLeft: 2, offerRate: 3, cardUrl: 'c', cancelUrl: 'd', graceWords: 'Mon 7 December' });
  check('switch ON, set up at the standard rate: no offer and no 5 days mentioned', !/5 more days|offer/.test(std.html.replace(/<!--[\s\S]*?-->/g, '')), std.html.slice(0, 100));
  var fcWas = ENV.FOUNDING_CODES; ENV.FOUNDING_CODES = 'OFFER-NOV-2099';   // a welcome sent while the offer is open
  var wOn = await vpaRenderProspectWelcome(ENV, { email: 'sam@testcharlie.example', firstName: 'Sam', venueName: 'Grace Welcome Hotel', signinToken: 'T0K3N', slides: 0, seats: 10 });
  ENV.OFFER_GRACE_EMAILS = '';
  var wOff = await vpaRenderProspectWelcome(ENV, { email: 'sam@testcharlie.example', firstName: 'Sam', venueName: 'Grace Welcome Hotel', signinToken: 'T0K3N', slides: 0, seats: 10 });
  var wStd = await vpaRenderProspectWelcome((ENV.OFFER_GRACE_EMAILS = 'on', ENV.FOUNDING_CODES = '', ENV), { email: 'sam@testcharlie.example', firstName: 'Sam', venueName: 'Grace Welcome Hotel', signinToken: 'T0K3N', slides: 0, seats: 10 });
  ENV.OFFER_GRACE_EMAILS = ''; ENV.FOUNDING_CODES = fcWas;
  var wh = function (w) { return String((w && w.html) || w || ''); };
  check('the welcome, switch ON: pauses, then "You keep $2.50 a player for 5 more days after your free month"; never "the offer price goes with it"',
    /your account simply pauses\. You keep \$2\.50 a player for 5 more days after your free month, so you can still add your card then\./.test(wh(wOn)) && !/goes with it/.test(wh(wOn)), wh(wOn).slice(0, 200));
  check('the welcome at the standard rate (no offer open): pauses, and no offer or 5 days is mentioned', /your account simply pauses\. If/.test(wh(wStd)) && !/5 more days|goes with it/.test(wh(wStd)), (wh(wStd).match(/simply pauses.{0,80}/) || [''])[0]);
  check('the welcome, switch OFF: today\'s words, unchanged', /your account simply pauses and the offer price goes with it\. If/.test(wh(wOff)) && !/5 more days/.test(wh(wOff)));

  var TERMS = readFile('venueplay/terms.html'), t2 = TERMS.slice(TERMS.indexOf('<h2>2. Offer pricing</h2>'), TERMS.indexOf('<h2>3. Pricing and billing</h2>'));
  check('the Terms (section 2) say it: pauses with no card, 5 days after the free month ends to keep the offer price, to 11:59pm Brisbane, then standard, no em dash, lowercase venueplay',
    /your account pauses/.test(t2) && /you have 5 days after your free month ends to add a card and keep that offer price/.test(t2) && /11:59pm Brisbane time on the fifth day/.test(t2) && /standard rate/.test(t2) && !/[\u2014\u2013]/.test(t2) && !/VenuePlay/.test(t2), t2.slice(0, 300));
  var NSW = readFile('venueplay/nsw.html');
  check('the offer page\'s billing FAQ says the 5 days (and the home page FAQ mentions no offer)', /you have 5 days after your free month ends to add a card and keep this rate/.test(NSW) && !/5 days after your free month/.test(readFile('venueplay/index.html')));
  var Z = await newProspect('Pause Screen Hotel');
  var SES = readFile('venueplay/app/vp-session.js');
  check('the console\'s pause screen is the one wording (it does not still say the offer ended with the free month)',
    !/The offer price you were set up on ended with your free month/.test(SES) && /5 days/.test(SES.slice(SES.indexOf("r === 'free_month_ended'"), SES.indexOf("r === 'free_month_ended'") + 1500)));

  if (badCount()) throw new Error('offer grace: ' + badCount() + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
