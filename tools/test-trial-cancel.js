/* THE TRIAL CANCEL RULES, RUN ON A FAKE CLOCK (Dean, 11 Nov 2026, INBOX 191).

   1. A venue that cancels DURING its free month keeps full access until the free month's end date, then switches
      off. Reminders stop at once.
   2. The cancel page says: "No problem at all, and thanks for having a look. There's no card on your account, so
      nothing has been charged and nothing will be. You can keep using venueplay until <date>, then we'll switch it
      off and stop the reminders." The account page says the same.
   3. NO SECOND FREE MONTH, ever: back after the end date = a paid plan, card needed; back BEFORE it = the same month.
   4. The offer rate holds only inside that offer's period; after it, the standard rate.
   5. The 90-day "keep your current plan" line is for paid venues only.
   6. Cancel before anyone signed in: off at once; back later = its free month then.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router, its REAL hourly sweep and
   the REAL card link Checkout, at Test Bravo, with Date.now fixed for every step. Nothing is sent anywhere:
   Resend, Stripe and the database are the rig's fakes.

   Run from the repo root:  jsc tools/test-trial-cancel.js */
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
/* Reminders to the VENUE only: our own staff alerts ("venueplay · FYI: CANCELLED VENUE: <name> (free month)", INBOX 235) are not reminders. */
var REM = function () { return sent.filter(function (m) { return /free month|How is venueplay going/.test(m.subject || '') && !/^venueplay \u00b7 /.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }

/* ---- the fake clock and the Test Bravo free month ---- */
function withClock(ms, fn) { var real = Date.now; Date.now = function () { return ms; }; return Promise.resolve().then(fn).then(function (r) { Date.now = real; return r; }, function (e) { Date.now = real; throw e; }); }
var SETUP = bne(2026, 11, 2, 9, 0);                    // set up Mon 2 Nov 2026
var FIRST = bne(2026, 11, 6, 10, 0);                   // first sign-in Fri 6 Nov 2026, day 0
var END = vpaFreeMonthEnd(FIRST);                      // Sun 6 Dec 2026 11:59:59pm Brisbane
function dayN(n, h) { return FIRST + n * DAY + ((h || 10) - 10) * 3600000; }
var DEAN = 'No problem at all, and thanks for having a look. There’s no card on your account, so nothing has been charged and nothing will be. You can keep using venueplay until 6 December, then we’ll switch it off and stop the reminders.';
async function bravo(code, signedIn) {
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2026,OFFER-DEC-2026'; ENV.VPB_SELF_RESTART = '1';
  var P = await withClock(SETUP, function () { return prospect({ name: 'Test Bravo' }); });
  var su = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_set_up' && a.target === 'venue:' + P.v.id; })[0];
  if (su) { su.detail = su.detail || {}; su.detail.offer_code = code || 'OFFER-NOV-2026'; }
  if (signedIn !== false) await withClock(FIRST, function () { return call('/account/prospect-start', { venue_id: P.v.id }, AS(P.login, P.v.id)); });
  return P;
}
function rreq(method, qs, bodyTxt) { var h = { origin: 'https://venueplay.com.au', 'content-type': 'application/x-www-form-urlencoded' };
  return { method: method, url: 'https://api.venueplay.com.au/prospect/cancel' + (qs ? '?' + qs : ''), headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } }, text: function () { return Promise.resolve(bodyTxt || ''); } }; }
async function link(P, ms, method, extra) {
  var q = (await vpaProspectCancelLink(ENV, P.v.founding_id)).split('?')[1];
  return withClock(ms, async function () {
    var r = await _d.fetch(method === 'POST' ? rreq('POST', '', q + '&reply=json' + (extra || '')) : rreq('GET', q + '&reply=json'), ENV);
    var b = null; try { b = JSON.parse(r.body); } catch (e) {} return b || {};
  });
}
async function checkoutAt(P, ms) {
  return withClock(ms, async function () {
    stripeCalls.length = 0;
    var tok = await vpaCardToken(ENV, P.v.founding_id);
    var res = await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + P.v.founding_id + '&t=' + tok, method: 'GET', headers: { get: function () { return null; } } }, ENV);
    var b = (stripeCalls[0] || {}).body || '';
    return { calls: stripeCalls.length, offer: /line_items%5B0%5D%5Bprice%5D=price_F_M/.test(b), standard: /line_items%5B0%5D%5Bprice%5D=price_S_M/.test(b),
      trial: (/subscription_data%5Btrial_end%5D=(\d+)/.exec(b) || [])[1] || null };
  });
}
function audits(action, vid) { return DB.vp_admin_audit.filter(function (a) { return a.action === action && (!vid || a.target === 'venue:' + vid); }); }
async function hq(P, ms) { var r = await withClock(ms, function () { return call('/admin/prospects', {}, AS(ADMIN)); }); return ((r.body && r.body.prospects) || []).filter(function (p) { return p.venue_id === P.v.id; })[0] || {}; }

(async function () {
  section('1. The free month and its end date');
  var A = await bravo();
  check('CONTROL: Test Bravo\'s first sign-in Fri 6 Nov starts its month, ending 11:59:59pm Brisbane Sun 6 Dec', A.row().first_signin_at === new Date(FIRST).toISOString() &&
    A.row().free_month_ends_at === new Date(END).toISOString() && Number(A.row().offer_rate) === 2.5, A.row());
  check('Dean\'s plain date: "6 December", "20 November"', vpaPlainDateWords(END) === '6 December' && vpaPlainDateWords(bne(2026, 11, 20, 23, 59)) === '20 November');

  section('2. Cancel on day 5: the page says Dean\'s words with the date; access kept; reminders stop');
  var g = await link(A, dayN(5), 'GET');
  check('the cancel page asks with Dean\'s words, word for word, with the end date', g.state === 'ask' && g.text === DEAN, g.text);
  check('no dash and lowercase venueplay in it', !/[—–-]/.test(g.text) && !/VenuePlay/.test(g.text));
  check('opening it changes nothing', !A.row().cancelled_at && A.v.status === 'active');
  var c = await link(A, dayN(5), 'POST', '&reason=not_using');
  check('the button: cancelled (cancelled_at day 5), the venue still ON, no 90-day clock yet', c.state === 'done' && A.row().cancelled_at === new Date(dayN(5)).toISOString() &&
    A.v.status === 'active' && !A.v.closed_at, [c, A.v.status]);
  check('the done words say until 6 December and offer "Keep my free month going"', /keep using it until 6 December/.test(c.text) && /nothing was ever charged/.test(c.text) &&
    c.resume && c.resume.label === 'Keep my free month going', c);
  check('the cancel is audited with their reason and the date it stays on to', audits('prospect_cancelled', A.v.id).length === 1 &&
    audits('prospect_cancelled', A.v.id)[0].detail.reason === 'not_using' && audits('prospect_cancelled', A.v.id)[0].detail.keeps_until === new Date(END).toISOString());
  var d6 = await walk(dayN(6, 9), dayN(6, 17));
  check('day 6: STILL WORKS (venue active, not suspended), and the sweep leaves it alone', A.v.status === 'active' && !A.v.suspended_reason && !A.row().paused_at, A.v);
  var h6 = await hq(A, dayN(6));
  check('HQ: Cancelled, on until the end date', h6.status === 'cancelled' && h6.on_until === new Date(END).toISOString(), h6);
  var rest = await walk(dayN(6, 18), END - 60000, 3 * 3600000);
  check('reminders stop at once: none from the cancel to the end date (day 23 and the last day are skipped)', REM().length === 0 && d6.length === 0 && rest.length === 0, REM().map(function (m) { return m.subject; }));
  check('still on one minute before the end', A.v.status === 'active');

  section('3. Switched off after the end date');
  await vpaProspectReminderSweep(ENV, END + 3600000);
  check('the first sweep after the end: off as "cancelled", the 90-day clock from then, audited once', A.v.status === 'suspended' && A.v.suspended_reason === 'cancelled' &&
    A.v.closed_at === new Date(END + 3600000).toISOString() && audits('prospect_switched_off', A.v.id).length === 1, A.v);
  await vpaProspectReminderSweep(ENV, END + 2 * 3600000);
  check('a second sweep changes nothing (no second audit, the clock not moved)', audits('prospect_switched_off', A.v.id).length === 1 && A.v.closed_at === new Date(END + 3600000).toISOString());
  check('it was never "paused" (that is a month that ran out with no cancel)', !A.row().paused_at);
  var hEnd = await hq(A, END + 3 * 3600000);
  check('HQ after the end: Cancelled, no "on until"', hEnd.status === 'cancelled' && !hEnd.on_until, hEnd);
  var gEnd = await link(A, END + 3 * 3600000, 'GET');
  check('the cancel link after the end: done, no date and no "keep my free month"', gEnd.state === 'done' && !/until/.test(gEnd.text) && !gEnd.resume, gEnd);

  section('4. No second free month: re-sign-in after the end date asks for a card');
  var re = await withClock(END + 2 * DAY, function () { return call('/account/prospect-start', { venue_id: A.v.id }, AS(A.login, A.v.id)); });
  check('signing in again after the end starts nothing: the same first sign-in and end date', A.row().first_signin_at === new Date(FIRST).toISOString() &&
    A.row().free_month_ends_at === new Date(END).toISOString(), [re.body, A.row().first_signin_at]);
  var q4 = await withClock(END + 2 * DAY, function () { return call('/account/restart-quote', { venue_id: A.v.id }, AS(A.login, A.v.id)); });
  check('coming back from Your account: "add your card" (kind prospect, mode card), never a fresh month', q4.body.kind === 'prospect' && q4.body.mode === 'card', q4.body);
  var co4 = await checkoutAt(A, END + 2 * DAY);
  check('the card page charges from day one: NO trial at all', co4.calls === 1 && co4.trial === null, co4);
  check('and at the standard rate: their November offer\'s period ended 30 November (INBOX 191.4)', co4.standard && !co4.offer, co4);
  A.founding().stripe_subscription_id = 'sub_bravo';
  await withClock(END + 2 * DAY + 60000, function () { return vpaProspectCardAdded(ENV, A.v.founding_id); });
  check('the card lands: back on, the clock stopped', A.v.status === 'active' && A.v.closed_at === null, A.v);

  section('5. The offer holds only inside its own period');
  var O = await bravo('OFFER-DEC-2026');
  await link(O, dayN(5), 'POST');
  await vpaProspectReminderSweep(ENV, END + 3600000);
  check('CONTROL: off after the end date', O.v.status === 'suspended' && O.v.suspended_reason === 'cancelled');
  var co5 = await checkoutAt(O, bne(2026, 12, 10, 10, 0));
  check('back 10 Dec, inside its December offer\'s period: the offer rate, still no trial', co5.offer && !co5.standard && co5.trial === null, co5);
  var co6 = await checkoutAt(O, bne(2027, 1, 2, 10, 0));
  check('back 2 Jan, after that period: the standard rate', co6.standard && !co6.offer && co6.trial === null, co6);
  var PR = { offer_rate: 2.5, first_signin_at: new Date(FIRST).toISOString(), free_month_ends_at: new Date(END).toISOString(), cancelled_at: new Date(dayN(5)).toISOString(), paused_at: null };
  var codeEnd = vpaOfferStartDeadlineMs('OFFER-NOV-2026');
  check('the price rule itself: inside the month, the offer (the month carries on)', vpaProspectPrice(ENV, PR, dayN(20), undefined, codeEnd).rate === 2.5);
  check('after the month and its offer\'s period: the standard rate, and no 5-day grace for a cancel', vpaProspectPrice(ENV, PR, END + DAY, undefined, codeEnd).rate === 3 &&
    !vpaProspectPrice(ENV, PR, END + DAY, undefined, codeEnd).grace);
  check('no dated code recorded: the offer\'s period is the calendar month the free month started in', vpaProspectOfferPeriodEnd(PR, NaN) === bne(2026, 12, 1, 0, 0) - 1);
  ENV.VPB_SELF_RESTART = '';
  check('it is the rule, not a switch: the same with the self-serve restart off', vpaProspectPrice(ENV, PR, END + DAY, undefined, codeEnd).rate === 3);
  ENV.VPB_SELF_RESTART = '1';

  section('6. Back BEFORE the end date: the same free month carries on');
  var B = await bravo();
  await link(B, dayN(5), 'POST');
  var r6 = await link(B, dayN(10), 'POST', '&action=resume');
  check('"Keep my free month going" on day 10: the cancel undone, the venue on, the SAME end date', r6.state === 'resumed' && /carries on until 6 December/.test(r6.text) &&
    !B.row().cancelled_at && B.v.status === 'active' && B.row().free_month_ends_at === new Date(END).toISOString() && B.row().first_signin_at === new Date(FIRST).toISOString(), [r6, B.row()]);
  check('audited as undone', audits('prospect_cancel_undone', B.v.id).length === 1);
  var w6 = await walk(dayN(10), END + 3600000, 3600000);
  check('the reminders carry on (the newest one due goes) and the month ends on its old date with the usual pause, never a new month',
    REM().length >= 1 && !!B.row().paused_at && B.v.suspended_reason === 'free_month_ended' && B.row().free_month_ends_at === new Date(END).toISOString(), [REM().length, B.v]);
  var r6b = await link(B, END + 2 * 3600000, 'POST', '&action=resume');
  check('a stale "Keep my free month going" never cancels anything', r6b.state === 'resumed' && !B.row().cancelled_at && audits('prospect_cancelled', B.v.id).length === 1, r6b);
  var C = await bravo();
  await link(C, dayN(5), 'POST');
  var coC = await checkoutAt(C, dayN(12));
  check('a card added inside the month after a cancel: its trial ends with THAT month, not 30 days on', coC.calls === 1 && Number(coC.trial) === Math.floor(END / 1000), [coC.trial, Math.floor(END / 1000)]);
  C.founding().stripe_subscription_id = 'sub_c';
  await withClock(dayN(12) + 60000, function () { return vpaProspectCardAdded(ENV, C.v.founding_id); });
  check('and when it lands, the cancel is undone: still on, the same month', !C.row().cancelled_at && C.v.status === 'active' && audits('prospect_cancel_undone', C.v.id).length === 1);
  await vpaProspectReminderSweep(ENV, END + 3600000);
  check('with a card, the end date never switches it off', C.v.status === 'active' && audits('prospect_switched_off', C.v.id).length === 0);
  var G = await bravo();
  await link(G, dayN(5), 'POST');
  G.founding().stripe_subscription_id = 'sub_g';
  await withClock(END + 30 * 60000, function () { return vpaProspectCardAdded(ENV, G.v.founding_id); });
  check('CONTROL: a card that lands just after the end date, before the sweep, cannot carry the month on (it is over)', !!G.row().cancelled_at && G.v.status === 'active');
  await vpaProspectReminderSweep(ENV, END + 3600000);
  check('and the sweep still leaves it on: a card on file is theirs to keep', G.v.status === 'active' && audits('prospect_switched_off', G.v.id).length === 0, G.v);

  section('7. The account page: the same rules, the same words');
  var D = await bravo();
  var s0 = await withClock(dayN(5), function () { return call('/account/summary', {}, AS(D.login, D.v.id)); });
  var sv = (s0.body.venues || []).filter(function (v) { return v.id === D.v.id; })[0] || {};
  check('Your account knows it is a free month: the cancel dialog\'s words are Dean\'s, with the date', sv.trial && sv.trial.cancel_text === DEAN && !sv.trial.cancelled, sv);
  var x = await withClock(dayN(5), function () { return call('/account/cancel-venue', { venue_id: D.v.id, reason: 'expensive' }, AS(D.login, D.v.id)); });
  check('cancel from Your account: cancelled, still on, never "set to cancel at the period end"', x.status === 200 && x.body.trial === true && x.body.ends === '6 December' &&
    !!D.row().cancelled_at && D.v.status === 'active' && !D.v.cancel_at_period_end, [x.body, D.v.cancel_at_period_end]);
  check('its words: until 6 December', /keep using it until 6 December/.test(x.body.text || ''), x.body);
  check('recorded with its reason, the same way as the cancel link', audits('prospect_cancelled', D.v.id).length === 1 && audits('prospect_cancelled', D.v.id)[0].detail.reason === 'expensive');
  var s1 = await withClock(dayN(6), function () { return call('/account/summary', {}, AS(D.login, D.v.id)); });
  var sv1 = (s1.body.venues || []).filter(function (v) { return v.id === D.v.id; })[0] || {};
  check('day 6: the venue row says cancelled, on until 6 December', sv1.trial && sv1.trial.cancelled === true && sv1.trial.ends_words === '6 December' && !sv1.left, sv1);
  var un = await withClock(dayN(8), function () { return call('/account/cancel-venue', { venue_id: D.v.id, undo: true }, AS(D.login, D.v.id)); });
  check('"Keep my free month going" from Your account on day 8: the same month carries on', un.status === 200 && !D.row().cancelled_at && /carries on until 6 December/.test(un.body.text || ''), un.body);
  await withClock(dayN(9), function () { return call('/account/cancel-venue', { venue_id: D.v.id }, AS(D.login, D.v.id)); });
  await vpaProspectReminderSweep(ENV, END + 3600000);
  var un2 = await withClock(END + DAY, function () { return call('/account/cancel-venue', { venue_id: D.v.id, undo: true }, AS(D.login, D.v.id)); });
  check('after the end date the undo refuses: coming back is a paid plan', un2.status === 409 && /paid plan/.test(un2.body.error || '') && D.v.status === 'suspended', un2.body);
  var BILL = readFile('venueplay/app/billing.html');
  check('billing.html: the 90-day line only for a PAID venue (INBOX 191.5); a free month gets the Worker\'s words', /\(v\.trial \? '' : '<p class="cxback">Change your mind within 90 days/.test(BILL) &&
    /v\.trial && v\.trial\.cancel_text \? esc\(v\.trial\.cancel_text\)/.test(BILL));
  var PAGE = readFile('venueplay/prospect/cancel/index.html').replace(/<!--[\s\S]*?-->/g, '');
  check('the free-month cancel page has no 90-day line', !/90 days/.test(PAGE));

  section('8. Cancelled before anyone signed in: off at once; back later = its free month then');
  var E = await bravo('OFFER-NOV-2026', false);
  var ge = await link(E, bne(2026, 11, 4, 10, 0), 'GET');
  check('the page: Dean\'s words with no date (there is no month to keep)', ge.text === 'No problem at all, and thanks for having a look. There’s no card on your account, so nothing has been charged and nothing will be. We’ll switch it off and stop the reminders.', ge.text);
  var ce = await link(E, bne(2026, 11, 4, 10, 0), 'POST');
  check('the button: switched off straight away, the clock from now, no keep-going button', E.v.status === 'suspended' && E.v.suspended_reason === 'cancelled' &&
    E.v.closed_at === new Date(bne(2026, 11, 4, 10, 0)).toISOString() && !ce.resume, [E.v, ce]);
  await withClock(bne(2026, 11, 20, 10, 0), function () { return call('/account/prospect-start', { venue_id: E.v.id }, AS(E.login, E.v.id)); });
  check('signing in to look on 20 Nov does not use up the free month', !E.row().first_signin_at && !E.row().free_month_ends_at, E.row());
  var qe = await withClock(bne(2026, 11, 20, 10, 0), function () { return call('/account/restart-quote', { venue_id: E.v.id }, AS(E.login, E.v.id)); });
  check('coming back: "Start your free month", no card', qe.body.kind === 'prospect_fresh' && qe.body.mode === 'confirm', qe.body);
  var BV = (0, eval)('(' + lift(BILL, 'restartView') + ')');
  var bv = BV(qe.body);
  check('the button\'s words: "Start your free month", no card needed, no dash', bv && bv.label === 'Start your free month' && /no card needed/.test(bv.note) && !/[—–]/.test(bv.note), bv);
  var re8 = await withClock(bne(2026, 11, 20, 10, 0), function () { return call('/account/restart', { venue_id: E.v.id }, AS(E.login, E.v.id)); });
  var E_END = vpaFreeMonthEnd(bne(2026, 11, 20, 10, 0));
  check('back on with its free month starting now (ends 20 December), the cancel cleared', re8.status === 200 && re8.body.kind === 'prospect_fresh' && E.v.status === 'active' &&
    !E.row().cancelled_at && E.row().first_signin_at === new Date(bne(2026, 11, 20, 10, 0)).toISOString() && E.row().free_month_ends_at === new Date(E_END).toISOString() &&
    re8.body.ends_words === '20 December', [re8.body, E.row()]);

  print('');
  if (bad) throw new Error('trial cancel: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
