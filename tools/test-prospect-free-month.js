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
     4. the offer: held through the month after the offer closes; gone after the pause (card link and Checkout)
     5. a card stops everything; a card after the pause switches the venue back on
     6. cancel: the link asks first (a mail scanner cancels nobody), then switches off and stops the reminders
     7. a missed week sends one reminder, not a pile; a sign-in the guide never reported is found in Auth
     8. the pause screen says what happened, in the console's own holdWords

   Run from the repo root:  jsc tools/test-prospect-free-month.js */
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
var REM = function () { return sent.filter(function (m) { return /free month|How is VenuePlay going/.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }

(async function () {
  section('1. The reminder calendar, from the first sign-in');
  var plan = vpaReminderPlan(bne(2026, 11, 2, 10, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Mon 2 Nov: three reminders and no more: 3 Thu 5 Nov, 23 Wed 25 Nov, 29 Tue 1 Dec (the day before it ends)',
    plan === '3@2026-11-05 23@2026-11-25 29@2026-12-01', plan);
  check('the free month ends 11:59:59pm Brisbane on Wed 2 Dec', new Date(vpaFreeMonthEnd(bne(2026, 11, 2, 10, 0))).toISOString() === '2026-12-02T13:59:59.000Z', new Date(vpaFreeMonthEnd(bne(2026, 11, 2, 10, 0))).toISOString());
  plan = vpaReminderPlan(bne(2026, 11, 5, 21, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Thu 5 Nov: day 3 is a Sunday, so Monday 9 Nov; day 23 is a Saturday, so Monday 30 Nov; day 29 is Friday 4 Dec',
    plan === '3@2026-11-09 23@2026-11-30 29@2026-12-04', plan);
  plan = vpaReminderPlan(bne(2026, 11, 6, 9, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Fri 6 Nov: day 29 is a Saturday, so it goes the Friday before (4 Dec), ahead of the pause',
    plan === '3@2026-11-09 23@2026-11-30 29@2026-12-04', plan);

  section('2. The month starts at the first sign-in, once, and only for the venue');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var A = await prospect({});
  check('set up while the offer is open: the offer it was set up on is kept ($2.50), and no month has started', A.row().offer_rate === 2.5 && !A.row().first_signin_at, A.row());
  var va = await call('/account/prospect-start', { venue_id: A.v.id }, AS(ADMIN, A.v.id));
  check('HQ View as never starts anybody\'s month', va.status === 200 && va.body.view_as === true && !A.row().first_signin_at, va.body);
  var t0 = Date.now();
  var st = await call('/account/prospect-start', { venue_id: A.v.id }, AS(A.login, A.v.id));
  var first = A.row().first_signin_at;
  check('their own sign-in starts it now, and says when it ends', st.status === 200 && st.body.prospect === true && Math.abs(Date.parse(first) - t0) < 5000 &&
    A.row().free_month_ends_at === new Date(vpaFreeMonthEnd(Date.parse(first))).toISOString() && typeof st.body.ends_words === 'string', st.body);
  await call('/account/prospect-start', { venue_id: A.v.id }, AS(A.login, A.v.id));
  check('a second sign-in changes nothing', A.row().first_signin_at === first);
  /* Two devices signing in at once: both read the row before either wrote. The second write must not move
     the start the first one set (the database only takes it while first_signin_at is still empty). */
  var stale = {}; for (var sk in A.row()) stale[sk] = A.row()[sk]; stale.first_signin_at = null;
  await vpaProspectStartMonth(ENV, stale, Date.parse(first) + 3 * 86400000);
  check('two sign-ins at once: the later one never moves the start the first one set', A.row().first_signin_at === first &&
    A.row().free_month_ends_at === new Date(vpaFreeMonthEnd(Date.parse(first))).toISOString(), A.row());
  var B = await prospect({});
  var other = await call('/account/prospect-start', { venue_id: B.v.id }, AS(A.login, A.v.id));
  check('another venue\'s month cannot be started from this login', other.status === 400 && !B.row().first_signin_at, other);
  var ch = await call('/account/card-choice', { venue_id: A.v.id, choice: 'later' }, AS(A.login, A.v.id));
  check('Later is recorded', ch.status === 200 && A.row().card_choice === 'later' && !!A.row().card_choice_at, A.row());

  section('3. A whole month with no card, an hour at a time');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var C = await prospect({ name: 'Walk The Month Hotel' });
  var start = bne(2026, 11, 2, 10, 0);
  C.row().first_signin_at = new Date(start).toISOString(); C.row().free_month_ends_at = new Date(vpaFreeMonthEnd(start)).toISOString();
  ENV.FOUNDING_CODES = '';   // the November offer closes during their month
  var got = await walk(start, bne(2026, 12, 2, 16, 0));
  var days = got.map(function (g) { return day(g.at); }).join(' ');
  check('three reminders, one on each planned day: 5 Nov, 25 Nov, 1 Dec (none on 12, 19, 26, 30 Nov or 2 Dec)', days === '2026-11-05 2026-11-25 2026-12-01', days);
  check('every one went 8am to 5pm Brisbane, Monday to Friday', got.every(function (g) { return vpaInSendWindow(g.at); }), got.map(function (g) { return new Date(g.at + 36e6).toISOString(); }));
  check('each to their email, from and replying to hello@ (never Dean), signed by the VenuePlay team, with a text part', got.every(function (g) { return g.msg.to[0] === C.row().email && g.msg.from === 'VenuePlay <hello@send.venueplay.com.au>' && g.msg.reply_to === 'hello@venueplay.com.au' && /Cheers, The VenuePlay team venueplay\.com\.au/.test(g.msg.text.replace(/\s+/g, ' ')) && !/Dean/.test(g.msg.text) && typeof g.msg.text === 'string' && g.msg.text.length > 200; }));
  var early = got[0].msg, mid23 = got[1] && got[1].msg, last = got[2] && got[2].msg;
  check('day 3: friendly, the end date, the card not charged until then, Add my card and Cancel', /Your free month at Walk The Month Hotel runs until Wed 2 December\. Whenever suits, you can add your card, and it won't be charged until your free month ends\./.test(early.text) &&
    /Add my card \(https:\/\/www\.venueplay\.com\.au\/add-card\?f=/.test(early.text) && /Cancel, it's not for us \(https:\/\/www\.venueplay\.com\.au\/prospect\/cancel\/\?f=/.test(early.text) && !/workers\.dev/.test(early.html + early.text), early.text.slice(0, 900));
  check('day 23: the same friendly note, with the end date', !!mid23 && /How's it going\?/.test(mid23.text) && /runs until Wed 2 December/.test(mid23.text), mid23 && mid23.text.slice(0, 500));
  check('day 29, the day before it ends: "2 days left of your free month", ends on Wed 2 December', !!last && /2 days left of your free month/.test(last.text) && /ends on Wed 2 December/.test(last.text), last && last.text.slice(0, 500));
  check('and exactly what happens with no card: paused, games off, the TV keeps the ads, nothing lost, the $2.50 offer goes, our price on the day after that',
    !!last && /Your account pauses: your games switch off and your TV keeps showing your ads\. Nothing is lost, and adding a card switches it all back on\. The \$2\.50 a player offer you were set up on ends with the pause, so a card added after that is at our price on the day\./.test(last.text), last && last.text.slice(0, 1200));
  check('no em dash, no "about" on a price, no urgency words', got.every(function (g) { return !/[—–]/.test(g.msg.text) && !/about \$/.test(g.msg.text) && !/hurry|act now|last chance|don't miss/i.test(g.msg.text); }));
  check('all three are recorded, so a restart sends none of them again', JSON.stringify(C.row().reminders_sent) === '[3,23,29]', C.row().reminders_sent);
  var mid = REM().length; await walk(bne(2026, 11, 26, 9, 0), bne(2026, 11, 26, 16, 0));
  check('running the same day again sends nothing', REM().length === mid);
  var lr = await call('/account/card-link', { venue_id: C.v.id }, AS(C.login, C.v.id));
  check('before the pause, with the November offer closed: their card is still added at the $2.50 they were set up on', lr.status === 200 && lr.body.rate === 2.5 && !lr.body.paused, lr.body);
  check('still on: no pause on Wed 2 Dec at noon', C.v.status === 'active' && !C.row().paused_at);
  await walk(bne(2026, 12, 2, 23, 0), bne(2026, 12, 3, 1, 0));
  check('after 11:59:59pm on day 30 with no card: PAUSED (suspended, free_month_ended), recorded and audited', C.v.status === 'suspended' && C.v.suspended_reason === 'free_month_ended' && !!C.row().paused_at &&
    DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_paused' && a.target === 'venue:' + C.v.id; }), [C.v.status, C.v.suspended_reason]);
  var lr2 = await call('/account/card-link', { venue_id: C.v.id }, AS(C.login, C.v.id));
  check('after the pause the offer has gone: their card is added at $3.00', lr2.body.rate === 3 && lr2.body.paused === true, lr2.body);
  stripeCalls.length = 0;
  var tok = await vpaCardToken(ENV, C.v.founding_id);
  await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + C.v.founding_id + '&t=' + tok, method: 'GET', headers: { get: function () { return null; } } }, ENV);
  var co = (stripeCalls[0] || {}).body || '';
  check('Checkout after the pause: the standard price, and no free month left (no trial)', /line_items%5B0%5D%5Bprice%5D=price_S_M/.test(co) && !/trial_end/.test(co), co.slice(0, 400));
  var n = REM().length; await walk(bne(2026, 12, 3, 8, 0), bne(2026, 12, 10, 16, 0));
  check('nothing more is sent once it is paused', REM().length === n);
  await vpaProspectCardAdded(ENV, C.v.founding_id);
  check('a card after the pause switches it straight back on, audited', C.v.status === 'active' && C.v.suspended_reason === null && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_unpaused'; }), [C.v.status, C.v.suspended_reason]);

  section('4. During the month, Checkout keeps the offer and charges nothing until the month ends');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var D = await prospect({});
  var ds = Date.now() - 5 * 86400000;
  D.row().first_signin_at = new Date(ds).toISOString(); D.row().free_month_ends_at = new Date(vpaFreeMonthEnd(ds)).toISOString();
  ENV.FOUNDING_CODES = '';
  stripeCalls.length = 0;
  var tk = await vpaCardToken(ENV, D.v.founding_id);
  await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + D.v.founding_id + '&t=' + tk, method: 'GET', headers: { get: function () { return null; } } }, ENV);
  var cb = (stripeCalls[0] || {}).body || '';
  var trial = /subscription_data%5Btrial_end%5D=(\d+)/.exec(cb);
  check('the offer price it was set up on, though the offer has closed', /line_items%5B0%5D%5Bprice%5D=price_F_M/.test(cb), cb.slice(0, 300));
  check('first charged when their free month ends (day 30 from the first sign-in), not 30 days from today', trial && Math.abs(parseInt(trial[1], 10) - Math.floor(Date.parse(D.row().free_month_ends_at) / 1000)) <= 1, trial && trial[1]);

  section('5. A card stops the reminders and the pause');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var E = await prospect({});
  var es = bne(2026, 11, 2, 10, 0);
  E.row().first_signin_at = new Date(es).toISOString(); E.row().free_month_ends_at = new Date(vpaFreeMonthEnd(es)).toISOString();
  await walk(es, bne(2026, 11, 13, 12, 0));
  check('one reminder by 13 Nov (day 3)', REM().length === 1, REM().length);
  E.founding().stripe_subscription_id = 'sub_on_day_11';
  await walk(bne(2026, 11, 13, 13, 0), bne(2026, 12, 4, 12, 0));
  check('the card went on: no more reminders (no day 23, no day 29), and no pause at the end', REM().length === 1 && E.v.status === 'active' && !E.row().paused_at, [REM().length, E.v.status]);

  section('6. Cancel, it\'s not for us');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var F = await prospect({});
  var fs = bne(2026, 11, 2, 10, 0);
  F.row().first_signin_at = new Date(fs).toISOString(); F.row().free_month_ends_at = new Date(vpaFreeMonthEnd(fs)).toISOString();
  var link = await vpaProspectCancelLink(ENV, F.v.founding_id);
  var q = link.split('?')[1];
  function creq(method, qs, bodyTxt) { return { method: method, url: 'https://api.venueplay.com.au/prospect/cancel' + (qs ? '?' + qs : ''), headers: { get: function () { return null; } }, text: function () { return Promise.resolve(bodyTxt || ''); } }; }
  var g = await vpaProspectCancel(creq('GET', q), ENV);
  check('opening the link only ASKS (a mail scanner opening it cancels nothing)', /Cancel VenuePlay for/.test(g.body) && /Yes, cancel it/.test(g.body) && !F.row().cancelled_at && F.v.status === 'active', g.body.slice(0, 200));
  var bad = await vpaProspectCancel(creq('POST', '', 'f=' + F.v.founding_id + '&t=' + new Array(33).join('0')), ENV);
  check('a wrong token cancels nothing', /has not worked/.test(bad.body) && !F.row().cancelled_at);
  var ok = await vpaProspectCancel(creq('POST', '', q), ENV);
  check('the button: cancelled, switched off, audited, and the page says nothing was charged', /All done/.test(ok.body) && /Nothing was ever charged/.test(ok.body) && !!F.row().cancelled_at &&
    F.v.status === 'suspended' && F.v.suspended_reason === 'cancelled' && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_cancelled'; }), [F.v.status, F.v.suspended_reason]);
  await walk(fs, bne(2026, 12, 4, 12, 0), 6 * 3600000);
  check('a cancelled prospect gets no reminders and is never paused', REM().length === 0 && !F.row().paused_at, REM().length);
  check('the cancel link is our own page on venueplay.com.au (never workers.dev: Ozemail bounced it, 31 Oct 2026), signed per account', /^https:\/\/www\.venueplay\.com\.au\/prospect\/cancel\/\?f=[^&]+&t=[0-9a-f]{32}$/.test(link) && link !== await vpaProspectCancelLink(ENV, U(4242)), link);

  /* THE venueplay.com.au PAGE ASKS THE WORKER IN JSON (31 Oct 2026), through the real router, from our origin.
     The same rules: a GET only asks, the POST needs the signed token, and the answer carries CORS for our site. */
  var F2 = await prospect({ name: 'Lakeside Test Tavern' });
  var q2 = (await vpaProspectCancelLink(ENV, F2.v.founding_id)).split('?')[1];
  function rreq(method, qs, bodyTxt) { var h = { origin: 'https://venueplay.com.au', 'content-type': 'application/x-www-form-urlencoded' };
    return { method: method, url: 'https://api.venueplay.com.au/prospect/cancel' + (qs ? '?' + qs : ''), headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } }, text: function () { return Promise.resolve(bodyTxt || ''); } }; }
  async function rcall(method, qs, bodyTxt) { var r = await _d.fetch(rreq(method, qs, bodyTxt), ENV); var b = null; try { b = JSON.parse(r.body); } catch (e) {} return { status: r.status, body: b, raw: r.body, headers: r.headers || {} }; }
  var ja = await rcall('GET', q2 + '&reply=json');
  check('the page\'s GET (reply=json) only ASKS: the Worker page\'s own question and words, the button kept, nothing written',
    ja.status === 200 && ja.body && ja.body.state === 'ask' && ja.body.title === 'Cancel VenuePlay for Lakeside Test Tavern?' &&
    ja.body.text === 'No problem at all, and thanks for having a look. There is no card on your account, so nothing has been charged and nothing will be. We will switch the account off and stop the reminders.' &&
    !F2.row().cancelled_at && F2.v.status === 'active', ja.raw);
  check('the answer is readable by venueplay.com.au (CORS reflects our origin)', ja.headers['Access-Control-Allow-Origin'] === 'https://venueplay.com.au', ja.headers);
  var jb = await rcall('POST', '', 'f=' + encodeURIComponent(F2.v.founding_id) + '&t=' + new Array(33).join('0') + '&reply=json');
  check('the page\'s POST with a wrong token cancels nothing and says the link has not worked', jb.body && jb.body.state === 'bad' && /has not worked/.test(jb.body.title) && !F2.row().cancelled_at && F2.v.status === 'active', jb.raw);
  var jn = await rcall('POST', '', 'f=' + encodeURIComponent(F2.v.founding_id) + '&reply=json');
  check('the page\'s POST with no token at all cancels nothing', jn.body && jn.body.state === 'bad' && !F2.row().cancelled_at, jn.raw);
  var jc = await rcall('POST', '', q2 + '&reply=json');
  check('the page\'s button (POST, reply=json, signed): cancelled, switched off, audited, "All done", CORS for our site',
    jc.body && jc.body.state === 'done' && jc.body.title === 'All done' && /Nothing was ever charged/.test(jc.body.text) && !!F2.row().cancelled_at &&
    F2.v.status === 'suspended' && F2.v.suspended_reason === 'cancelled' && jc.headers['Access-Control-Allow-Origin'] === 'https://venueplay.com.au', jc.raw);
  var jd = await rcall('GET', q2 + '&reply=json');
  check('opening it again says it is done, with no button', jd.body && jd.body.state === 'done', jd.raw);

  section('7. A missed week sends one reminder, not a pile; a sign-in the guide never reported is found in Auth');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var G = await prospect({});
  var gs = bne(2026, 11, 2, 10, 0);
  var user = AUTH.filter(function (u) { return u.id === G.login; })[0];
  user.last_sign_in_at = new Date(gs).toISOString();
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 2, 11, 0));
  check('the sweep finds their first sign-in in Auth and starts the month from it', G.row().first_signin_at === new Date(gs).toISOString(), G.row().first_signin_at);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 12, 9, 0));
  check('the Worker missed days 3 to 9: on day 10 the day-3 note goes, once, and is recorded',
    REM().length === 1 && JSON.stringify(G.row().reminders_sent) === '[3]', [REM().length, G.row().reminders_sent]);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 19, 10, 0));
  check('nothing on day 17 any more (the old schedule sent one)', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 21, 10, 0));
  check('a Saturday sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 7, 30));
  check('before 8am sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 17, 0));
  check('5pm sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 8, 0));
  check('8am Wednesday 25 Nov sends day 23', REM().length === 2 && G.row().reminders_sent.indexOf(23) !== -1);

  /* A missed stretch that runs past day 23 into day 29 sends the NEWEST reminder: the "2 days left" one,
     never the day-23 note it replaces. */
  var H = await prospect({});
  var hs = bne(2026, 11, 2, 10, 0);
  H.row().first_signin_at = new Date(hs).toISOString(); H.row().free_month_ends_at = new Date(vpaFreeMonthEnd(hs)).toISOString();
  H.row().reminders_sent = [3];
  var hb = sent.length; await vpaProspectReminderSweep(ENV, bne(2026, 12, 1, 9, 0));
  var hm = sent.slice(hb).filter(function (m) { return m.to && m.to[0] === H.row().email; });
  check('missed day 23 and reached day 29: ONE email, the "2 days left" one, and day 23 is marked so it never goes late',
    hm.length === 1 && /2 days left of your free month/.test(hm[0].text || '') && JSON.stringify(H.row().reminders_sent) === '[3,23,29]', [hm.length, hm[0] && hm[0].subject, H.row().reminders_sent]);

  section('8. The pause screen says what happened (the console\'s own holdWords)');
  var SES = readFile('venueplay/app/vp-session.js');
  function liftFn(src, name) { var i = src.indexOf('function ' + name + '('); var d = 0, k = src.indexOf('{', i); do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0); return src.slice(i, k); }
  var holdWords = new Function('isArchived', liftFn(SES, 'holdWords') + '\nreturn holdWords;')(function () { return false; });
  var hw = holdWords({ status: 'suspended', suspended_reason: 'free_month_ended' }, 'owner');
  check('the owner is told: the free month ended, games paused, the TV keeps its ads, nothing lost, a card switches it back on, the offer price went, nothing to do if it is not for them',
    hw && hw.reason === 'free_month_ended' && /Your free month has ended, so your games are paused/.test(hw.title) && /Your TV keeps showing your ads and nothing has been lost\./.test(hw.text) &&
    /The offer price you were set up on ended with your free month/.test(hw.text) && hw.link && hw.link.href === '#vp-card' && hw.link.label === 'Add your card', hw);
  var hh = holdWords({ status: 'suspended', suspended_reason: 'free_month_ended' }, 'host');
  check('a host is told to ask the owner or a manager, with no card button', hh && !hh.link && /Ask the venue owner or a manager to add a card/.test(hh.text), hh);
  check('the console fetches the venue\'s own card link for that button (never a link written into the page)', /w\.link\.href === '#vp-card'/.test(SES) && /\/account\/card-link/.test(liftFn(SES, 'holdGate')));

  if (badCount()) throw new Error('prospect free month: ' + badCount() + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
