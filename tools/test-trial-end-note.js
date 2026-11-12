/* RE-PINNED to Dean's words (Dean via main INBOX 331, 12 Nov 2026): no "free" in any venue email. "Your first month is on us.
   It starts the first time you sign in", "your first month", and the welcome's slides line ends "You can keep them on or
   swap them out. I just wanted you to see how the slides work in between your games." (INBOX 336, 12 Nov) Every changed pin is listed in ~/venue-enrich/reports/email-words-12nov/REPINS.md. */
/* ONE FRIENDLY EMAIL FOR A FREE MONTH CANCELLED PART WAY, ON A FAKE CLOCK (Dean, 11 Nov 2026, INBOX 239.1, 258.1).

   The Friday before a cancelled free month ends: one email "Your first month ends <date>" (subject shortened 12 Nov), a Keep it going
   button (the card link), inside Dean's send window at the venue, never before the cancel, once per venue, and
   nothing after it. All their other emails stop at the cancel. Behind TRIAL_END_NOTE (off by default).

   BODALLA PUB'S EXACT CASE, as a Test Bravo copy (never the live account): NSW, cancelled 11 Nov 01:42Z, switched
   back on by hand (status active, cancelled_at kept), free month to 10 Dec. Walked hour by hour to 12 Dec: one email
   on Fri 4 Dec at 9am Sydney time, and switched off after 10 Dec.

   Runs the REAL billing Worker (tools/rig-billing-worker.js), its REAL hourly sweep, with Date.now fixed. Nothing
   is sent anywhere: Resend and the database are the rig's fakes.

   Run from the repo root:  jsc tools/test-trial-end-note.js */
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

var OUTBOUND = [], AUTH = [], CANCELS = [], RESEND_IDS = 0, SCREEN_ACTORS = [], STORE = [];
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
  /* Anything leaving for the outside world that is not our own database (INBOX 301: nothing may be sent). */
  if (method !== 'GET' && !/\/rest\/v1\/|\/storage\/v1\/|\/auth\/v1\//.test(u)) OUTBOUND.push(u);
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
var REM = function () { return sent.filter(function (m) { return /first month|How is venueplay going/.test(m.subject || '') && !/^venueplay \u00b7 /.test(m.subject || ''); }); };
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


var NOTE = function () { return sent.filter(function (m) { return /^Your first month ends \d/.test(m.subject || ''); }); };
function noteAudits(vid) { return DB.vp_admin_audit.filter(function (a) { return a.action === 'trial_end_note' && a.target === 'trial-end-note:' + vid; }); }
async function sweepWalk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var b = sent.length; await withClock(t, function () { return vpaProspectReminderSweep(ENV, t); }); for (var i = b; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }
/* Bodalla's row as main left it (INBOX 239): first sign-in 9 Nov 23:25 Brisbane, the cancel link 11 Nov 01:42Z (under
   the OLD code, which switched it off), switched back ON by hand 06:38: status active, cancelled_at kept, month to 10 Dec. */
var B_FIRST = bne(2026, 11, 9, 23, 25), B_CX = Date.parse('2026-11-11T01:42:00Z'), B_END = Date.parse('2026-12-10T13:59:59Z');
async function bodalla(signedIn) {
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2026'; ENV.VPB_SELF_RESTART = '1'; DB.vp_unsubscribes = [];
  var P = await withClock(bne(2026, 11, 9, 22, 54), function () { return prospect({ name: 'Test Bravo', first_name: 'Paul', postcode: '2545' }); });
  var r = P.row();
  r.first_signin_at = signedIn === false ? null : new Date(B_FIRST).toISOString();
  r.free_month_ends_at = new Date(B_END).toISOString(); r.offer_rate = 2.5;
  r.cancelled_at = new Date(B_CX).toISOString();
  P.v.status = 'active'; P.v.suspended_reason = null; P.v.closed_at = null; P.v.au_state = 'NSW';
  return P;
}
var SYD_FRI_9AM = Date.parse('2026-12-03T22:00:00Z');   // Fri 4 Dec 9:00am in Sydney (daylight saving, UTC+11)

(async function () {
  section('1. Bodalla\'s exact case, switch ON: one email on the Friday before, then switched off after 10 Dec');
  var A = await bodalla();
  ENV.TRIAL_END_NOTE = 'on';
  sent.length = 0;
  var w = await sweepWalk(Date.parse('2026-11-11T02:00:00Z'), Date.parse('2026-12-12T02:00:00Z'));
  var notes = w.filter(function (x) { return /^Your first month ends \d/.test(x.msg.subject || ''); });
  check('exactly ONE email in the whole walk, 11 Nov to 12 Dec', notes.length === 1, notes.map(function (x) { return [new Date(x.at).toISOString(), x.msg.subject]; }));
  check('its subject: "Your first month ends 10 December" (Dean 12 Nov: shorter; 32 characters, one line in iPhone Mail and in Gmail)', notes.length && notes[0].msg.subject === 'Your first month ends 10 December', notes[0] && notes[0].msg.subject);
  check('the longest month still fits one iPhone Mail line (35 characters): "Your first month ends 30 September"', vpaTrialEndSubject('30 September').length <= 35, vpaTrialEndSubject('30 September').length);
  check('sent Friday 4 December at 9am at the venue (NSW, Sydney time), the first hour of the window', notes.length && notes[0].at === SYD_FRI_9AM, notes[0] && new Date(notes[0].at).toISOString());
  check('to the account email, from hello@ (the same sender as the reminders)', notes.length && notes[0].msg.to[0] === A.row().email && /hello@send\.venueplay\.com\.au/.test(notes[0].msg.from), notes[0] && [notes[0].msg.to, notes[0].msg.from]);
  check('nothing else at all went to the venue after the cancel (no card reminder, no other email)', w.filter(function (x) { return !/^venueplay · /.test(x.msg.subject || ''); }).length === 1, w.map(function (x) { return x.msg.subject; }));
  check('one trial_end_note row (the once-ever lock) and one trial_end_note_sent', noteAudits(A.v.id).length === 1 && audits('trial_end_note_sent', A.v.id).length === 1);
  check('switched off after 10 Dec: suspended as cancelled, the 90-day clock from the first sweep after the end, audited once', A.v.status === 'suspended' && A.v.suspended_reason === 'cancelled' &&
    A.v.closed_at === '2026-12-10T14:00:00.000Z' && audits('prospect_switched_off', A.v.id).length === 1, [A.v.status, A.v.suspended_reason, A.v.closed_at]);
  check('cancelled_at was kept as it was', A.row().cancelled_at === new Date(B_CX).toISOString());
  var m = notes.length ? notes[0].msg : {}, txt = String(m.html || '').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');
  check('the words: "Hi Paul", Bodalla\'s venue name, the date, nothing charged', /Hi Paul,/.test(txt) && /first month of venueplay at Test Bravo runs until Thursday 10 December/.test(txt) && /Nothing has been charged\./.test(txt) && !/nothing will be/.test(txt), txt.slice(0, 600));
  check('the card line says what happens and when (Dean 12 Nov): keep going = add a card, nothing charged until the free month ends on its date; never "Nothing to pay"',
    /To keep your games running after that, add a card before then\. Nothing is charged until your first month ends on Thursday 10 December/.test(txt) && !/Nothing to pay/.test(String(m.html)), txt.slice(0, 900));
  check('one pink "Keep it going" button, to the card link for THIS account', (String(m.html).match(/>Keep it going<\/a>/g) || []).length === 1 && String(m.html).indexOf('/add-card?f=' + encodeURIComponent(A.v.founding_id) + '&amp;t=') !== -1, String(m.html).slice(0, 200));
  check('the footer lines the other venueplay emails carry: 07 5228 3667 and press 2, Terms, Privacy, Unsubscribe from product emails', /call 07 5228 3667 and press 2/.test(txt) && /Terms · Privacy Unsubscribe from product emails/.test(txt) && /href="tel:\+61752283667"/.test(m.html), txt.slice(-400));
  check('lowercase venueplay, no dashes, no workers.dev link', !/VenuePlay|VENUEPLAY/.test(m.subject + txt) && !/[—–]/.test(m.subject + txt) && !/workers\.dev/.test(m.html));
  check('a plain-text part goes with it', typeof m.text === 'string' && /Keep it going/.test(m.text) && m.text.length > 200);

  section('2. The same with no first sign-in recorded (the month set by hand): still one email, still switched off');
  var A2 = await bodalla(false);
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  await sweepWalk(Date.parse('2026-12-03T20:00:00Z'), Date.parse('2026-12-10T16:00:00Z'));
  check('one email, and off after the end', NOTE().length === 1 && A2.v.status === 'suspended' && A2.v.suspended_reason === 'cancelled', [NOTE().length, A2.v.status]);

  section('3. Switch OFF (the default): nothing sent, nothing written, the switch-off unchanged');
  var C = await bodalla();
  delete ENV.TRIAL_END_NOTE; sent.length = 0;
  var r3 = await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  await sweepWalk(Date.parse('2026-12-03T20:00:00Z'), Date.parse('2026-12-10T16:00:00Z'));
  check('off: the sweep says so and sends nothing, writes no lock row', r3.off === true && NOTE().length === 0 && noteAudits(C.v.id).length === 0, [r3, NOTE().length]);
  check('and the end-date switch-off still happens', C.v.status === 'suspended' && C.v.suspended_reason === 'cancelled');
  ENV.TRIAL_END_NOTE = 'yes';
  check('only the exact word "on" switches it on', (await vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM)).off === true);

  section('4. Exactly once, whatever the sweep does');
  var D = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  await withClock(SYD_FRI_9AM, function () { return vpaProspectReminderSweep(ENV, SYD_FRI_9AM); });
  await withClock(SYD_FRI_9AM, function () { return vpaProspectReminderSweep(ENV, SYD_FRI_9AM); });
  await withClock(SYD_FRI_9AM + 3600000, function () { return vpaProspectReminderSweep(ENV, SYD_FRI_9AM + 3600000); });
  check('the same hour twice, then the next hour: one email', NOTE().length === 1, NOTE().length);
  var E = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  DB.vp_admin_audit.push({ actor_admin: null, actor_label: 'x', action: 'trial_end_note', target: 'trial-end-note:' + E.v.id, detail: {} });
  await withClock(SYD_FRI_9AM, function () { return vpaProspectReminderSweep(ENV, SYD_FRI_9AM); });
  check('a lock row already there (sent, or tried, before): nothing more, ever', NOTE().length === 0);

  section('5. The send window, and never before the cancel');
  var F = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  await withClock(SYD_FRI_9AM - 3600000, function () { return vpaProspectReminderSweep(ENV, SYD_FRI_9AM - 3600000); });
  check('8am on the Friday at the venue: held', NOTE().length === 0);
  await withClock(Date.parse('2026-12-04T01:30:00Z'), function () { return vpaProspectReminderSweep(ENV, Date.parse('2026-12-04T01:30:00Z')); });
  check('12:30pm Friday (the lunch gap): held', NOTE().length === 0);
  var mon = Date.parse('2026-12-06T23:00:00Z');   // Mon 7 Dec 10am Sydney
  await withClock(Date.parse('2026-12-05T00:00:00Z'), function () { return vpaProspectReminderSweep(ENV, Date.parse('2026-12-05T00:00:00Z')); });
  check('a Saturday: held', NOTE().length === 0);
  await withClock(mon, function () { return vpaProspectReminderSweep(ENV, mon); });
  check('missed on the Friday (the sweep did not run in a window): it goes in the next window, Monday 10am, before the end', NOTE().length === 1);
  var G = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  G.row().cancelled_at = '2026-12-04T03:00:00Z';   // cancelled ON the Friday (2pm Brisbane)
  await sweepWalk(Date.parse('2026-12-03T20:00:00Z'), Date.parse('2026-12-10T16:00:00Z'));
  check('cancelled ON or after that Friday: told the date on the cancel screen, no email', NOTE().length === 0 && G.v.status === 'suspended', NOTE().length);
  var H = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  await withClock(B_END + 3600000, function () { return vpaTrialEndNoteSweep(ENV, B_END + 3600000); });
  check('after the month has ended: never', NOTE().length === 0);

  section('6. Who never gets it');
  var I = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  I.founding().stripe_subscription_id = 'sub_i';
  await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  check('a card on file: nothing', NOTE().length === 0);
  var J = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  DB.vp_unsubscribes = [{ email: J.row().email }];
  await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  check('unsubscribed: nothing', NOTE().length === 0);
  var K = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  K.row().no_contact = true;
  await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  check('Do not contact: nothing', NOTE().length === 0);
  var N = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  N.v.status = 'suspended'; N.v.suspended_reason = 'cancelled';
  await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  check('a venue already switched off (the old cancel, never switched back on): nothing', NOTE().length === 0);
  var L = await bodalla();
  ENV.TRIAL_END_NOTE = 'on'; sent.length = 0;
  L.row().cancelled_at = null;
  await withClock(SYD_FRI_9AM, function () { return vpaTrialEndNoteSweep(ENV, SYD_FRI_9AM); });
  check('CONTROL: not cancelled (still in its free month): this email never (the card reminders cover it)', NOTE().length === 0);

  section('7. Which Friday');
  check('end on Thursday 10 Dec: Friday 4 Dec', vpaTrialEndNoteDay(B_END) === '2026-12-04');
  check('end on Saturday 12 Dec: Friday 11 Dec (the day before)', vpaTrialEndNoteDay(bne(2026, 12, 12, 23, 59)) === '2026-12-11');
  check('end on a Friday (11 Dec): the Friday a week before (4 Dec)', vpaTrialEndNoteDay(bne(2026, 12, 11, 23, 59)) === '2026-12-04');
  check('a Queensland venue goes at 9am Brisbane on that Friday', vpaTrialEndNoteDueAt({ free_month_ends_at: new Date(B_END).toISOString(), cancelled_at: new Date(B_CX).toISOString() }, 'QLD') === bne(2026, 12, 4, 9, 0));

  section('8. All their other emails stop at the cancel');
  var M = await bodalla();
  ENV.TRIAL_END_NOTE = ''; sent.length = 0;
  DB.vp_venue_settings.push({ venue_id: M.v.id, setup_answers: { members_reminder: { how: 'email', day: 'mon', time: '10:00', since: '2026-11-10' } } });
  var mr = await withClock(Date.parse('2026-11-15T23:00:00Z'), function () { return vpaMembersReminderSweep(ENV, Date.parse('2026-11-15T23:00:00Z')); });
  check('the weekly members list reminder they asked for: not sent once they have cancelled', mr.sent.length === 0 && sent.length === 0 && audits('members_reminder_sent', M.v.id).length === 0, mr);
  M.row().cancelled_at = null;
  var mr2 = await withClock(Date.parse('2026-11-15T23:00:00Z'), function () { return vpaMembersReminderSweep(ENV, Date.parse('2026-11-15T23:00:00Z')); });
  check('CONTROL: not cancelled, the same reminder goes', mr2.sent.length === 1, mr2);
  var W = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the monthly report skips a cancelled free month ("cancelled their free month")', /else if \(cxIds\.has\(v\.id\)\) why = 'cancelled their free month';/.test(W));

  section('9. Tonight (INBOX 301): Bodalla with the switch OFF, every hourly sweep 12 Nov to 11 Dec sends NOTHING');
  for (var shape = 0; shape < 2; shape++) {
    var Z = await bodalla(shape === 0 ? false : undefined), zw = shape === 0 ? 'month set by hand' : 'first sign-in';
    delete ENV.TRIAL_END_NOTE; sent.length = 0; OUTBOUND.length = 0;
    await sweepWalk(Date.parse('2026-11-12T00:00:00Z'), Date.parse('2026-12-11T00:00:00Z'));
    check(zw + ': not one email and not one text or other outside call, from the reminder sweep, the friendly email or the switch-off',
      sent.length === 0 && OUTBOUND.length === 0, [sent.map(function (m) { return m.subject; }), OUTBOUND]);
    check(zw + ': still on to 10 Dec, switched off once after it, audited once', Z.v.status === 'suspended' && Z.v.suspended_reason === 'cancelled' &&
      audits('prospect_switched_off', Z.v.id).length === 1 && noteAudits(Z.v.id).length === 0, [Z.v.status, audits('prospect_switched_off', Z.v.id).length]);
  }
  var Y = await bodalla(false);
  check('HQ reads Bodalla (month set by hand) as cancelled and on until 10 Dec', (await hq(Y, Date.parse('2026-11-12T02:00:00Z'))).on_until === new Date(B_END).toISOString(),
    await hq(Y, Date.parse('2026-11-12T02:00:00Z')));

  print('');
  if (bad) throw new Error('trial end note: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
