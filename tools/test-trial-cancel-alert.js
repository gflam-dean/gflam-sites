/* A FREE MONTH CANCEL TELLS US (INBOX 235, Dean 11 Nov 2026, a live fault).

   Bodalla Pub cancelled its free month on the cancel link at 11:42 on 11 Nov and no CANCELLED VENUE email reached
   dean@ or hello@: only the paid route (POST /account/cancel-venue on a card venue) ever called vpaFireCancelAlert.
   Now the cancel link, Your account's free-month cancel and every undo of one (the link's "Keep my free month
   going", Your account's undo, a card added inside the month) call it too: subject
   "CANCELLED VENUE: <name> (free month)" or "CANCEL UNDONE: <name> (free month)", with the reason when one was given,
   sent to BOTH addresses on VPA_CANCEL_ALERTS and written down as a venue_cancel_alert audit row.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router at Test Bravo on a fake clock.
   Nothing is sent anywhere: Resend and the database are the rig's fakes. The test never prints an address: it
   compares the recipients to VPA_CANCEL_ALERTS and prints counts.

   Run from the repo root:  jsc tools/test-trial-cancel-alert.js */
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


/* The Worker's const is not a global after the rig's eval: read it off the source, the list the Worker sends to. */
var VPA_CANCEL_ALERTS = (0, eval)(/const VPA_CANCEL_ALERTS = (\[[^\]]*\]);/.exec(readFile('venueplay-backend/worker/venueplay-api-FULL.js'))[1]);
function alerts(vid) { return DB.vp_admin_audit.filter(function (a) { return a.action === 'venue_cancel_alert' && a.target === 'venue:' + vid; }); }
function mails(re) { return sent.filter(function (m) { return re.test(m.subject || ''); }); }
function toBoth(ms) { var got = ms.map(function (m) { return (m.to || [])[0]; }).sort().join('|'); return ms.length === VPA_CANCEL_ALERTS.length && got === VPA_CANCEL_ALERTS.slice().sort().join('|'); }
function plainOf(m) { return String((m && m.html) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }

(async function () {
  section('0. The two addresses');
  check('VPA_CANCEL_ALERTS names two distinct addresses (dean@ and hello@ on the venueplay domain)', VPA_CANCEL_ALERTS.length === 2 && VPA_CANCEL_ALERTS[0] !== VPA_CANCEL_ALERTS[1] &&
    VPA_CANCEL_ALERTS.every(function (a) { return /^(dean|hello)@venueplay\.com\.au$/.test(a); }), VPA_CANCEL_ALERTS.length);

  section('1. The cancel link, inside a started month (Test Bravo, day 5, with a reason and a note)');
  var A = await bravo();
  sent.length = 0;
  await link(A, dayN(5), 'POST', '&reason=not_using&reason_detail=' + encodeURIComponent('Too busy with the footy finals'));
  var m1 = mails(/CANCELLED VENUE: Test Bravo \(free month\)/);
  check('two emails, subject "CANCELLED VENUE: Test Bravo (free month)", one to each address', toBoth(m1), m1.length);
  check('the subject keeps the staff style: "venueplay · FYI: CANCELLED VENUE: ..."', m1.length && m1[0].subject === 'venueplay · FYI: CANCELLED VENUE: Test Bravo (free month)', m1[0] && m1[0].subject);
  check('the body: their reason label, their own words, the end date they keep it to, no card', m1.length && /Reason We weren\u2019t using it enough/.test(plainOf(m1[0])) && /Too busy with the footy finals/.test(plainOf(m1[0])) &&
    /6 December/.test(plainOf(m1[0])) && /Free month, no card/.test(plainOf(m1[0])), plainOf(m1[0]).slice(0, 400));
  var a1 = alerts(A.v.id);
  check('a venue_cancel_alert audit row: outcome "sent", both, free_month true, the subject', a1.length === 1 && a1[0].detail.outcome === 'sent' && a1[0].detail.sent === 2 &&
    a1[0].detail.free_month === true && /\(free month\)$/.test(a1[0].detail.subject), a1.map(function (r) { return [r.detail.outcome, r.detail.sent]; }));
  check('no dash and lowercase venueplay in what we wrote', m1.length && !/[—–]/.test(plainOf(m1[0])) && !/VenuePlay/.test(m1[0].subject + plainOf(m1[0])));
  check('CONTROL: the cancel itself still happened (cancelled_at, still on)', !!A.row().cancelled_at && A.v.status === 'active');

  section('2. The link\'s "Keep my free month going" (undo)');
  sent.length = 0;
  await link(A, dayN(7), 'POST', '&action=resume');
  var m2 = mails(/CANCEL UNDONE: Test Bravo \(free month\)/);
  check('two emails, "CANCEL UNDONE: Test Bravo (free month)"', toBoth(m2), m2.length);
  check('it says the same month carries on until 6 December', m2.length && /carries on until 6 December/.test(plainOf(m2[0])), plainOf(m2[0] || {}).slice(0, 300));
  check('a second audit row, undo true', alerts(A.v.id).length === 2 && alerts(A.v.id).filter(function (r) { return r.detail.undo === true; }).length === 1);
  sent.length = 0;
  await link(A, dayN(8), 'POST', '&action=resume');
  check('a stale second "keep going" (nothing to undo) sends nothing', mails(/CANCEL/).length === 0 && alerts(A.v.id).length === 2, sent.length);

  section('3. Cancelled before anyone signed in (the Bodalla case): off at once, and we hear');
  var E = await bravo('OFFER-NOV-2026', false);
  sent.length = 0;
  await link(E, bne(2026, 11, 11, 11, 42), 'POST');
  var m3 = mails(/CANCELLED VENUE: Test Bravo \(free month\)/);
  check('two emails, no reason given: no Reason row, and "switched off now"', toBoth(m3) && !/Reason/.test(plainOf(m3[0])) && /switched off now/.test(plainOf(m3[0])), plainOf(m3[0] || {}).slice(0, 300));
  check('audited, sent', alerts(E.v.id).length === 1 && alerts(E.v.id)[0].detail.outcome === 'sent');
  check('CONTROL: switched off', E.v.status === 'suspended' && E.v.suspended_reason === 'cancelled');
  sent.length = 0;
  await link(E, bne(2026, 11, 11, 12, 0), 'GET');
  check('opening the link again later sends nothing', mails(/CANCEL/).length === 0 && alerts(E.v.id).length === 1);

  section('4. Your account\'s free-month cancel and undo');
  var D = await bravo();
  sent.length = 0;
  await withClock(dayN(5), function () { return call('/account/cancel-venue', { venue_id: D.v.id, reason: 'expensive' }, AS(D.login, D.v.id)); });
  var m4 = mails(/CANCELLED VENUE: Test Bravo \(free month\)/);
  check('two emails, from Your account, with the reason', toBoth(m4) && /Your account/.test(plainOf(m4[0])) && /Reason/.test(plainOf(m4[0])), plainOf(m4[0] || {}).slice(0, 300));
  sent.length = 0;
  await withClock(dayN(8), function () { return call('/account/cancel-venue', { venue_id: D.v.id, undo: true }, AS(D.login, D.v.id)); });
  check('the undo: two "CANCEL UNDONE" emails', toBoth(mails(/CANCEL UNDONE: Test Bravo \(free month\)/)), sent.length);
  sent.length = 0;
  await withClock(dayN(9), function () { return call('/account/cancel-venue', { venue_id: D.v.id }, AS(D.login, D.v.id)); });
  await withClock(dayN(9), function () { return call('/account/cancel-venue', { venue_id: D.v.id }, AS(D.login, D.v.id)); });
  check('a second press on an already cancelled month sends nothing more (one pair only)', mails(/CANCELLED VENUE/).length === 2, mails(/CANCELLED VENUE/).length);

  section('5. A card added inside the month after a cancel (an undo too)');
  var C = await bravo();
  await link(C, dayN(5), 'POST');
  C.founding().stripe_subscription_id = 'sub_c';
  sent.length = 0;
  await withClock(dayN(12), function () { return vpaProspectCardAdded(ENV, C.v.founding_id); });
  check('"CANCEL UNDONE" to both, via the card', toBoth(mails(/CANCEL UNDONE: Test Bravo \(free month\)/)) && /card added/.test(plainOf(mails(/CANCEL UNDONE/)[0])), sent.map(function (m) { return m.subject; }));

  section('6. A mail fault never stops the cancel, and is written down');
  var F = await bravo();
  var realKey = ENV.RESEND_API_KEY; ENV.RESEND_API_KEY = '';
  sent.length = 0;
  var cf = await link(F, dayN(5), 'POST');
  ENV.RESEND_API_KEY = realKey;
  check('no Resend key: the cancel still done, nothing sent, and the audit row says why', cf.state === 'done' && !!F.row().cancelled_at && sent.length === 0 &&
    alerts(F.v.id).length === 1 && /not sent/.test(alerts(F.v.id)[0].detail.outcome), alerts(F.v.id).map(function (r) { return r.detail.outcome; }));

  section('7. The paid route is unchanged');
  sent.length = 0;
  await vpaFireCancelAlert(ENV, { venueId: 'pv', name: 'Paid Pub', undo: false, ends: '30 November', players: 30, monthly: '$90', reason: 'expensive' });
  check('paid cancel: "CANCELLED VENUE: Paid Pub", no "(free month)"', mails(/CANCELLED VENUE: Paid Pub$/).length === 2 && !/free month/i.test(plainOf(sent[0])), sent.map(function (m) { return m.subject; }));
  sent.length = 0;
  await vpaFireCancelAlert(ENV, { venueId: 'pv', name: 'Paid Pub', undo: true });
  check('paid undo: still "UNCANCELLED VENUE: Paid Pub"', mails(/UNCANCELLED VENUE: Paid Pub$/).length === 2, sent.map(function (m) { return m.subject; }));

  print('');
  if (bad) throw new Error('trial cancel alert: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
