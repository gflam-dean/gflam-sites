/* ONBOARDING MAIL COMES FROM THE SAME PERSON (INBOX 430, Dean 17 Nov 2026: "the emails to onboard them they should get
   from the same people. Then Harry would disappear.").

   Runs the REAL billing Worker (tools/rig-billing-worker.js: real router, fake PostgREST and Resend) for three prospects
   set up through the real HQ route: one who met Harry, one who met Kayla, one with no recorded name; then one who has
   become a venue. For EACH mail (the welcome, the day-3 nudge, the "expires in 3 days" nudge, the sign-in link, the
   card reminder, the cancelled-month note) it asserts what the mail server is handed:
     - From exactly "<Name> at venueplay <hello@send.venueplay.com.au>" and the sign-off line is that same name
     - plain "venueplay <hello@send.venueplay.com.au>" and "the venueplay team" with no name when there is none
     - the word Dean appears nowhere, and no em or en dash
   and the SWITCH-OVER: the moment a card is added (a Stripe subscription), comp, invoicing or a group, the name is
   gone from every mail that can still go, and the card reminders stop altogether.

   Run from the repo root:  jsc tools/test-onboarding-same-person.js */
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
var REM = function () { return sent.filter(function (m) { return /first month|How is venueplay going/.test(m.subject || '') && !/^venueplay \u00b7 /.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }


var NAMES = {};
function visible(h) { return String(h).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
function allOf(m) { return (m.subject || '') + '\n' + (m.html || '') + '\n' + (m.text || '') + '\n' + (m.from || ''); }
var PLAIN = 'venueplay <hello@send.venueplay.com.au>';
function fromOf(n) { return n + ' at venueplay <hello@send.venueplay.com.au>'; }
/* the sign-off as a person reads it, "Cheers, Harry the venueplay team", in the html and in the text part */
function signedBy(m, n) {
  var v = visible(m.html);
  var want = n ? 'Cheers, ' + n + ' the venueplay team' : 'Cheers, the venueplay team';
  var t = String(m.text || '').replace(/\s+/g, ' ');
  return v.indexOf(want) !== -1 && t.indexOf(want) !== -1;
}
function clean(m) { return !/\bDean\b/.test(allOf(m)) && !/[\u2014\u2013]/.test(allOf(m)); }
async function mk(label, sender, first) {
  var n = ++NTH;
  var b = { name: 'Onboard ' + label + ' Hotel', first_name: first || 'Sam', email: 'sam' + n + '@onboard' + n + '.example', postcode: '4000', entity_type: 'for_profit' };
  if (sender) { b.sender_name = sender[0]; b.sender_email = sender[1]; }
  sent.length = 0;
  var r = await call('/admin/prospect', b, AS(ADMIN));
  if (r.status !== 200) throw new Error('setup failed ' + JSON.stringify(r.body));
  var v = DB.vp_venues.filter(function (x) { return x.id === r.body.venue.id; })[0];
  if (!v.status) v.status = 'active'; if (!('suspended_reason' in v)) v.suspended_reason = null;
  var pr = DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0];
  ['first_signin_at', 'free_month_ends_at', 'card_choice', 'card_choice_at', 'paused_at', 'cancelled_at'].forEach(function (k) { if (!(k in pr)) pr[k] = null; });
  if (!('offer_rate' in pr)) pr.offer_rate = null; if (!('reminders_sent' in pr)) pr.reminders_sent = [];
  var st = DB.vp_venue_staff.filter(function (x) { return x.venue_id === v.id; })[0];
  var welcome = sent.filter(function (m) { return /Your venueplay account for/.test(m.subject || ''); })[0];
  return { v: v, email: b.email, login: st.auth_user_id, welcome: welcome, row: pr,
    founding: function () { return DB.venueplay_founding.filter(function (f) { return f.id === v.founding_id; })[0]; } };
}
var DAY3 = 'Hey Sam,\n\nWe noticed you haven\'t logged in yet. Here\'s your sign-in link again. This link expires in {days} days.\n\nCheers,\n';
async function nudge(P, text, subj) { sent.length = 0; var r = await vpaSendSigninLink(ENV, P.login, P.v.id, { hqCap: true, nudge: text, subject: subj }); return { r: r, m: sent[sent.length - 1] || {} }; }
async function link(P) { sent.length = 0; var r = await vpaSendSigninLink(ENV, P.login, P.v.id, { hqCap: true }); return { r: r, m: sent[sent.length - 1] || {} }; }
async function reminder(P, t) {
  var first = bne(2026, 11, 2, 10, 0);
  P.row.first_signin_at = new Date(first).toISOString(); P.row.free_month_ends_at = new Date(vpaFreeMonthEnd(first)).toISOString(); P.row.reminders_sent = []; P.row.paused_at = null; P.row.cancelled_at = null;
  P.v.status = 'active'; sent.length = 0;
  await vpaProspectReminderSweep(ENV, t || bne(2026, 11, 5, 9, 30));
  return sent.filter(function (m) { return m.to && m.to[0] === P.email && /first month|How is venueplay going/.test(m.subject || ''); })[0] || null;
}
async function endNote(P) {
  var first = bne(2026, 11, 2, 10, 0);
  P.row.first_signin_at = new Date(first).toISOString(); P.row.free_month_ends_at = new Date(vpaFreeMonthEnd(first)).toISOString(); P.row.cancelled_at = new Date(bne(2026, 11, 10, 10, 0)).toISOString(); P.row.paused_at = null;
  P.v.status = 'active'; sent.length = 0; ENV.TRIAL_END_NOTE = 'on';
  var lockIdx = DB.vp_admin_audit.length;
  DB.vp_admin_audit = DB.vp_admin_audit.filter(function (a) { return a.action !== 'trial_end_note_claimed'; });
  await vpaTrialEndNoteSweep(ENV, bne(2026, 11, 27, 9, 30));
  ENV.TRIAL_END_NOTE = '';
  return sent.filter(function (m) { return m.to && m.to[0] === P.email; })[0] || null;
}

(async function () {
  world(); ENV.CARD_LINK_SECRET = 'card-link-secret-for-tests-only-0123456789'; ENV.VP_UNSUB_SECRET = 'unsub-secret-for-tests';
  var H = await mk('Harry', ['Harry Finch', 'harry@venueplay.online']);
  var K = await mk('Kayla', ['kayla', 'kayla@getvenueplay.com.au']);
  var N = await mk('Nobody', null);
  var D = await mk('Fourth', ['Dean Tindale', 'dean@venueplay.online']);

  section('1. The welcome');
  check('Harry: From exactly "Harry at venueplay <hello@send.venueplay.com.au>", signed Harry', H.welcome && H.welcome.from === fromOf('Harry') && signedBy(H.welcome, 'Harry'), H.welcome && H.welcome.from);
  check('Kayla (typed in lowercase): From "Kayla at venueplay ...", signed Kayla', K.welcome && K.welcome.from === fromOf('Kayla') && signedBy(K.welcome, 'Kayla'), K.welcome && K.welcome.from);
  check('no name on record: plain "venueplay", signed "the venueplay team", no name', N.welcome && N.welcome.from === PLAIN && signedBy(N.welcome, ''), N.welcome && N.welcome.from);
  check('a prospect from one of Dean\'s boxes: plain "venueplay", never Dean', D.welcome && D.welcome.from === PLAIN && signedBy(D.welcome, ''), D.welcome && D.welcome.from);
  check('no Dean and no dash in any welcome', [H, K, N, D].every(function (p) { return clean(p.welcome); }));

  section('2. The day-3 nudge (words from the Mac script, signed with whatever it typed)');
  var hn = await nudge(H, DAY3 + 'Dean', 'Your venueplay sign-in link again');
  check('Harry: sent From "Harry at venueplay <...>", the old "Dean" sign-off is replaced by Harry', hn.r.ok && hn.m.from === fromOf('Harry') && signedBy(hn.m, 'Harry'), [hn.r, hn.m.from]);
  check('Harry: no Dean anywhere, no dash, the one-click header is still on', clean(hn.m) && /\/stop\/[0-9a-f]{48}>/.test((hn.m.headers || {})['List-Unsubscribe'] || ''), hn.m.headers);
  var kn = await nudge(K, DAY3 + '{sender}', 'Your venueplay sign-in link again');
  check('Kayla: the Mac script\'s {sender} line becomes Kayla; From "Kayla at venueplay"', kn.r.ok && kn.m.from === fromOf('Kayla') && signedBy(kn.m, 'Kayla') && !/\{sender\}/.test(allOf(kn.m)), [kn.m.from, visible(kn.m.html).slice(-400)]);
  var nn = await nudge(N, DAY3 + 'Dean', 'Your venueplay sign-in link again');
  check('no name: plain From, "Cheers, the venueplay team", the typed Dean line is gone', nn.r.ok && nn.m.from === PLAIN && signedBy(nn.m, '') && clean(nn.m), [nn.m.from, visible(nn.m.html).slice(-300)]);
  var dn = await nudge(D, DAY3 + 'Dean', 'Your venueplay sign-in link again');
  check('one of Dean\'s boxes: plain From, signed the team, never Dean', dn.r.ok && dn.m.from === PLAIN && signedBy(dn.m, '') && clean(dn.m), [dn.m.from, visible(dn.m.html).slice(-300)]);

  section('3. The "expires in 3 days" nudge');
  var EXP = 'Hey Sam,\n\nYour sign-in link for Onboard Hotel expires in {days} days. The button below signs you straight in.\n\nCheers,\n';
  var he = await nudge(H, EXP + '{sender}', 'Your venueplay sign-in link expires in {days} days');
  check('Harry: From Harry, signed Harry, {days} filled', he.r.ok && he.m.from === fromOf('Harry') && signedBy(he.m, 'Harry') && !/\{days\}/.test(allOf(he.m)) && clean(he.m), [he.m.from, he.m.subject]);
  var ke = await nudge(K, EXP + 'Dean', 'Your venueplay sign-in link expires in {days} days');
  check('Kayla: From Kayla, signed Kayla', ke.r.ok && ke.m.from === fromOf('Kayla') && signedBy(ke.m, 'Kayla') && clean(ke.m), [ke.m.from]);
  var ne = await nudge(N, EXP + '{sender}', 'Your venueplay sign-in link expires in {days} days');
  check('no name: plain From, signed the team', ne.r.ok && ne.m.from === PLAIN && signedBy(ne.m, '') && clean(ne.m), [ne.m.from]);

  section('4. The sign-in link email');
  var hl = await link(H), kl = await link(K), nl = await link(N);
  check('Harry: From Harry, signed Harry, no Dean, no List-Unsubscribe (it is the account, not marketing)', hl.r.ok && hl.m.from === fromOf('Harry') && signedBy(hl.m, 'Harry') && clean(hl.m) && !hl.m.headers, [hl.r, hl.m.from]);
  check('Kayla: From Kayla, signed Kayla', kl.r.ok && kl.m.from === fromOf('Kayla') && signedBy(kl.m, 'Kayla') && clean(kl.m), kl.m.from);
  check('no name: plain, signed the team', nl.r.ok && nl.m.from === PLAIN && signedBy(nl.m, '') && clean(nl.m), nl.m.from);

  section('5. The card reminders');
  var hr = await reminder(H), kr = await reminder(K), nr = await reminder(N);
  check('Harry: the day-3 reminder is From Harry, signed Harry, with its one-click header', hr && hr.from === fromOf('Harry') && signedBy(hr, 'Harry') && clean(hr) && /\/stop\/[0-9a-f]{48}>/.test((hr.headers || {})['List-Unsubscribe'] || ''), hr && hr.from);
  check('Kayla: From Kayla, signed Kayla', kr && kr.from === fromOf('Kayla') && signedBy(kr, 'Kayla') && clean(kr), kr && kr.from);
  check('no name: plain, signed the team', nr && nr.from === PLAIN && signedBy(nr, '') && clean(nr), nr && nr.from);
  var hr2 = await reminder(H, bne(2026, 11, 25, 9, 30));
  check('Harry: the later "ends" reminder (day 23) is Harry too', hr2 && hr2.from === fromOf('Harry') && signedBy(hr2, 'Harry') && clean(hr2), hr2 && [hr2.from, hr2.subject]);
  var hr3 = await reminder(H, bne(2026, 12, 2, 9, 30));
  check('Harry: and the last-day reminder', hr3 && hr3.from === fromOf('Harry') && signedBy(hr3, 'Harry') && clean(hr3), hr3 && [hr3.from, hr3.subject]);

  section('6. The note after a cancelled month');
  var he2 = await endNote(H), ne2 = await endNote(N);
  check('Harry: From Harry, signed Harry, no Dean', he2 && he2.from === fromOf('Harry') && signedBy(he2, 'Harry') && clean(he2), he2 && he2.from);
  check('no name: plain, signed the team', ne2 && ne2.from === PLAIN && signedBy(ne2, '') && clean(ne2), ne2 && ne2.from);

  section('7. The switch-over: a card added, and the name is gone');
  var before = await link(H);
  check('before the card: Harry still sends as Harry (control)', before.m.from === fromOf('Harry'), before.m.from);
  H.founding().stripe_subscription_id = 'sub_test_harry'; H.founding().status = 'card_on_file';
  var after = await link(H);
  check('the moment a Stripe subscription exists: the sign-in link is From plain "venueplay", signed the team', after.r.ok && after.m.from === PLAIN && signedBy(after.m, '') && clean(after.m), [after.r, after.m.from]);
  var an = await nudge(H, DAY3 + 'Dean', 'Your venueplay sign-in link again');
  check('a nudge that still goes after the card: plain From, no Harry, no Dean', !(an.m.from || '').match(/Harry/) && (an.r.ok ? an.m.from === PLAIN && signedBy(an.m, '') && clean(an.m) : true), [an.r, an.m.from]);
  var ar = await reminder(H);
  check('the card reminders stop altogether', ar === null, ar && ar.from);
  var vo = await vpaProspectVoice(ENV, H.v.id);
  check('vpaProspectVoice for the converted venue: plain, no name', vo.from === PLAIN && vo.name === null, vo);
  H.founding().stripe_subscription_id = null; H.founding().status = 'pending';
  check('and a card removed in the fake database would bring the name back (the rule reads the live state, not a flag)', (await vpaProspectVoice(ENV, H.v.id)).name === 'Harry');
  K.founding().status = 'comp';
  check('comp is a venue too: Kayla\'s name is gone', (await vpaProspectVoice(ENV, K.v.id)).from === PLAIN);
  K.founding().status = 'pending'; K.founding().bill_by_invoice = true;
  check('invoiced is a venue too', (await vpaProspectVoice(ENV, K.v.id)).from === PLAIN);
  K.founding().bill_by_invoice = false; K.v.group_id = '99999999-9999-4999-8999-999999999999';
  check('joined to a group is a venue too', (await vpaProspectVoice(ENV, K.v.id)).from === PLAIN);
  K.v.group_id = null;

  section('8. The fallbacks, never Dean, never blank');
  check('a venue with no prospect row at all (a self sign-up): plain', (await vpaProspectVoice(ENV, '00000000-0000-4000-8000-00000000dead')).from === PLAIN);
  var saved = DB.vp_admin_audit; DB.vp_admin_audit = [];
  var vw = await vpaProspectVoice(ENV, K.v.id);
  check('no setup audit row: the newest welcome record\'s sender is used', vw.from === fromOf('Kayla') && vw.name === 'Kayla', vw);
  DB.vp_admin_audit = saved;
  FAIL['vp_venues:GET'] = 999;
  var vf = await vpaProspectVoice(ENV, K.v.id);
  FAIL = {};
  check('a read that fails: plain "venueplay", not an error and not a name', vf.from === PLAIN && vf.name === null, vf);
  var s1 = vpaNudgeSignoff('Hi,\n\nwords here for the day.\n\nCheers,\nDean', 'Harry');
  var s2 = vpaNudgeSignoff('Hi,\n\nwords here for the day.\n\nCheers,\nDean', null);
  var s3 = vpaNudgeSignoff('Hi,\n\nwords here for the day.\n\nCheers,\nthe venueplay team', 'Harry');
  check('the sign-off helper: Dean line replaced by the name, or by the team; an already-team line is left alone', /Cheers,\nHarry\nthe venueplay team$/.test(s1) && /Cheers,\nthe venueplay team$/.test(s2) && !/Harry/.test(s3) && !/Dean/.test(s1 + s2 + s3), [s1, s2, s3]);

  section('9. The nudge endpoint refuses words that name Dean');
  var Q = await mk('Quiet', ['Harry Finch', 'harry@venueplay.online']);
  var rq = await call('/autopilot/prospect/nudge', { venue_id: Q.v.id, text: 'Hey Sam,\n\nDean here, your sign-in link is below for you.\n\nCheers,\nHarry', subject: 'Your venueplay is ready' }, AP);
  check('words that mention Dean elsewhere than the sign-off: 400, nothing sent', rq.status === 400 && /Dean/.test(JSON.stringify(rq.body)) && sent.filter(function (m) { return m.to && m.to[0] === Q.email && !/Your venueplay account for/.test(m.subject || ''); }).length === 0, [rq.status, rq.body]);

  if (badCount()) throw new Error('onboarding from the same person: ' + badCount() + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
