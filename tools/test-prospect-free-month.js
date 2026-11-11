/* A PROSPECT'S FREE MONTH, ITS CARD REMINDERS AND THE PAUSE, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026; migration 127).

   Dean's decisions: the free month starts at the FIRST SIGN-IN; with no card there are three reminders, day 3,
   day 23 and the day before it ends (day 29) (Dean, 30 Oct 2026; it was seven: 3, 10, 17, 24, 28, 29, 30), Dean's send
   window (7 Nov 2026): Monday to Friday, 9am to 12 noon and 2pm to 5pm in the venue's own local time (it was 8am to
   5pm Monday to Friday Brisbane); a card or a
   cancel stops them; with no card at the end the account PAUSES (games off, the TV keeps its ads) and the offer
   price it was set up on goes, so a card added after that is at the price of the day.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router and its REAL hourly sweep,
   walked an hour at a time across a whole month, and the console's real holdWords:
     1. the reminder calendar: weekends moved (day 3 on to Monday, day 23 and day 30 back to Friday)
     2. /account/prospect-start: starts the month once, for the venue's owner or manager only, never View as
     3. a month with no card: every reminder once, on its day, inside the hours, the right words; then the pause
     4. the offer: held through the month after the offer closes; gone after the pause and its 5-day grace (card link
      and Checkout; the grace itself, day by day, is tools/test-offer-grace.js)
     5. a card stops everything; a card after the pause switches the venue back on
     6. cancel: the link asks first (a mail scanner cancels nobody), then switches off and stops the reminders
     7. a missed week sends one reminder, not a pile; a sign-in the guide never reported is found in Auth
     8. the pause screen says what happened, in the console's own holdWords
     9. THE SEND WINDOW (Dean, 7 Nov 2026, live fault): vpaSendAllowedAt, per state and across daylight saving; outside
        it a due reminder waits (never marked sent) and goes once in the next window; the pause is on time and sends
        nothing at night; the paused-venue card check sends nothing

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
var REM = function () { return sent.filter(function (m) { return /free month|How is venueplay going/.test(m.subject || ''); }); };
async function walk(fromMs, toMs, stepMs) { var out = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var before = sent.length; await vpaProspectReminderSweep(ENV, t); for (var i = before; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }

(async function () {
  section('1. The reminder calendar, from the first sign-in');
  var plan = vpaReminderPlan(bne(2026, 11, 2, 10, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Mon 2 Nov: three reminders and no more: 3 Thu 5 Nov, 23 Wed 25 Nov (a week before the end), 30 Wed 2 Dec (the last day)',
    plan === '3@2026-11-05 23@2026-11-25 30@2026-12-02', plan);
  check('the free month ends 11:59:59pm Brisbane on Wed 2 Dec', new Date(vpaFreeMonthEnd(bne(2026, 11, 2, 10, 0))).toISOString() === '2026-12-02T13:59:59.000Z', new Date(vpaFreeMonthEnd(bne(2026, 11, 2, 10, 0))).toISOString());
  plan = vpaReminderPlan(bne(2026, 11, 5, 21, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Thu 5 Nov: day 3 is a Sunday, so Monday 9 Nov; day 23 is a Saturday, so the Friday before (27 Nov); day 30 is a Saturday, so Friday 4 Dec',
    plan === '3@2026-11-09 23@2026-11-27 30@2026-12-04', plan);
  plan = vpaReminderPlan(bne(2026, 11, 6, 9, 0)).map(function (r) { return r.day + '@' + r.date; }).join(' ');
  check('first sign-in Fri 6 Nov: day 23 and day 30 are Sundays, so each goes the Friday before (27 Nov, 4 Dec), ahead of the pause',
    plan === '3@2026-11-09 23@2026-11-27 30@2026-12-04', plan);

  section('2. The month starts at the first sign-in, once, and only for the venue');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var A = await prospect({});
  check('set up while the offer is open: no rate is decided yet (it is decided at the first sign-in, Dean 7 Nov 2026), and no month has started', A.row().offer_rate == null && !A.row().first_signin_at, A.row());
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
  C.row().first_signin_at = new Date(start).toISOString(); C.row().free_month_ends_at = new Date(vpaFreeMonthEnd(start)).toISOString(); C.row().offer_rate = ENV.FOUNDING_CODES ? 2.5 : null;   /* a first sign-in while the offer is open (7 Nov 2026: decided at the sign-in) */
  ENV.FOUNDING_CODES = '';   // the November offer closes during their month
  var got = await walk(start, bne(2026, 12, 2, 16, 0));
  var days = got.map(function (g) { return day(g.at); }).join(' ');
  check('three reminders, one on each planned day: 5 Nov, 25 Nov, 2 Dec, the last day itself (none on 12, 19, 26, 30 Nov or 1 Dec; Dean, 5 Nov 2026 ~7pm)', days === '2026-11-05 2026-11-25 2026-12-02', days);
  check('every one went inside the send window: Monday to Friday, 9 to 12 or 2 to 5, Brisbane (a Queensland venue)', got.every(function (g) { var d = new Date(g.at + 36e6), h = d.getUTCHours(); return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 17)); }), got.map(function (g) { return new Date(g.at + 36e6).toISOString(); }));
  check('each to their email, from and replying to hello@ (never Dean), signed by the venueplay team, with a text part', got.every(function (g) { return g.msg.to[0] === C.row().email && g.msg.from === 'venueplay <hello@send.venueplay.com.au>' && g.msg.reply_to === 'hello@venueplay.com.au' && /Cheers, the venueplay team venueplay\.com\.au/.test(g.msg.text.replace(/\s+/g, ' ')) && !/Dean/.test(g.msg.text) && typeof g.msg.text === 'string' && g.msg.text.length > 200; }));
  var early = got[0].msg, mid23 = got[1] && got[1].msg, last = got[2] && got[2].msg;
  check('day 3: friendly, the end date, the card not charged until then, Add my card and Cancel', /Your free month at Walk The Month Hotel runs until Wed 2 December\. Whenever suits, you can add your card, and it won't be charged until your free month ends\./.test(early.text) &&
    /Add my card \(https:\/\/www\.venueplay\.com\.au\/add-card\?f=/.test(early.text) && /Cancel, it's not for us \(https:\/\/www\.venueplay\.com\.au\/prospect\/cancel\/\?f=/.test(early.text) && !/workers\.dev/.test(early.html + early.text), early.text.slice(0, 900));
  /* One week out (Dean, 5 Nov 2026 rounds 5 to 7): "One week left", the end date, their free month in numbers (here,
     none: it never ran a game, so the gentle first-night version with the sign-in button), "Would you like to keep it
     going? Add your card." and plainly what a pause does. Nothing about when we charge; no 5-day grace yet. */
  var wk = mid23 && mid23.text.replace(/\s+/g, ' ');
  check('day 23, a week before the end: "One week left of your free month", ends on Wed 2 December, the first-night line and its sign-in button, then "Would you like to keep it going? Add your card."',
    !!wk && /One week left of your free month/.test(wk) && /ends on Wed 2 December\./.test(wk) && /You haven't had your first night yet, and there's still time\./.test(wk) && /Open your venueplay \(https:\/\/www\.venueplay\.com\.au\/app\)/.test(wk) &&
    /Would you like to keep it going\? Add your card\./.test(wk) && /If there's no card by then Your account pauses: your games switch off and your TV keeps showing your ads\. Nothing is lost, and adding a card switches it all back on\. You started your free month in time for \$2\.50 a player\./.test(wk) && !/5 days|We keep your paused account/.test(wk), wk && wk.slice(0, 1200));
  var ld = last && last.text.replace(/\s+/g, ' ');
  check('the last day: "Today is the last day of your free month", "We\'d be sad to see you go.", it pauses tonight and the $2.50 offer ends, and what they keep for 90 days, then Add my card',
    !!ld && /Today is the last day of your free month/.test(ld) && /We'd be sad to see you go\./.test(ld) && /If there's no card by tonight Your account pauses tonight: your games switch off and your TV keeps showing your ads\. Nothing is lost, and adding a card switches it all back on\. You started your free month in time for \$2\.50 a player\./.test(ld) &&
    /Here's what you still have for the next 90 days: .*Your members list .*Your ad slides .*Your raffle and members draw history .*Your billing page, ready for your card .*Add my card/.test(ld) && /^Last day of your free month at Walk The Month Hotel$/.test(last.subject), ld && ld.slice(0, 1400));
  check('no em dash, no "about" on a price, no urgency words', got.every(function (g) { return !/[—–]/.test(g.msg.text) && !/about \$/.test(g.msg.text) && !/hurry|act now|last chance|don't miss/i.test(g.msg.text); }));
  check('all three are recorded, so a restart sends none of them again', JSON.stringify(C.row().reminders_sent) === '[3,23,30]', C.row().reminders_sent);
  var mid = REM().length; await walk(bne(2026, 11, 26, 9, 0), bne(2026, 11, 26, 16, 0));
  check('running the same day again sends nothing', REM().length === mid);
  var realNow0 = Date.now; Date.now = function () { return bne(2026, 12, 2, 12, 0); };   // a fixed clock: the price reads it
  var lr = await call('/account/card-link', { venue_id: C.v.id }, AS(C.login, C.v.id));
  Date.now = realNow0;
  check('before the pause, with the November offer closed: their card is still added at the $2.50 they were set up on', lr.status === 200 && lr.body.rate === 2.5 && !lr.body.paused, lr.body);
  check('still on: no pause on Wed 2 Dec at noon', C.v.status === 'active' && !C.row().paused_at);
  await walk(bne(2026, 12, 2, 23, 0), bne(2026, 12, 3, 1, 0));
  check('after 11:59:59pm on day 30 with no card: PAUSED (suspended, free_month_ended), recorded and audited', C.v.status === 'suspended' && C.v.suspended_reason === 'free_month_ended' && !!C.row().paused_at &&
    DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_paused' && a.target === 'venue:' + C.v.id; }), [C.v.status, C.v.suspended_reason]);
  /* THE 90-DAY CLOCK (Dean, 5 Nov 2026, INBOX item 33): a paused prospect has left, so the pause stamps closed_at
     and the nightly retention sweep clears its player details 90 days later, like every other way of leaving. */
  check('the pause starts the 90-day clock: closed_at is the moment of the pause', !!C.v.closed_at && C.v.closed_at === C.row().paused_at, [C.v.closed_at, C.row().paused_at]);
  /* THE 5-DAY OFFER GRACE (10 Nov 2026): the offer now holds to 11:59pm Brisbane on Mon 7 Dec, so "gone" is asked
     on day 6, Tue 8 Dec, at a FIXED clock (never the real one: the card-add reads Date.now). tools/test-offer-grace.js
     walks every day of it. */
  var realNow = Date.now; Date.now = function () { return bne(2026, 12, 8, 9, 0); };
  var lr2 = await call('/account/card-link', { venue_id: C.v.id }, AS(C.login, C.v.id));
  check('after the pause and its 5-day grace the offer has gone: their card is added at $3.00', lr2.body.rate === 3 && lr2.body.paused === true && !lr2.body.offer_grace, lr2.body);
  stripeCalls.length = 0;
  var tok = await vpaCardToken(ENV, C.v.founding_id);
  await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + C.v.founding_id + '&t=' + tok, method: 'GET', headers: { get: function () { return null; } } }, ENV);
  Date.now = realNow;
  var co = (stripeCalls[0] || {}).body || '';
  check('Checkout after the pause and its grace: the standard price, and no free month left (no trial)', /line_items%5B0%5D%5Bprice%5D=price_S_M/.test(co) && !/trial_end/.test(co), co.slice(0, 400));
  var n = REM().length; await walk(bne(2026, 12, 3, 8, 0), bne(2026, 12, 10, 16, 0));
  check('nothing more is sent once it is paused', REM().length === n);
  await vpaProspectCardAdded(ENV, C.v.founding_id);
  check('a card after the pause stops the 90-day clock (closed_at cleared), the same as every other way back on', C.v.closed_at === null, C.v.closed_at);
  check('a card after the pause switches it straight back on, audited', C.v.status === 'active' && C.v.suspended_reason === null && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_unpaused'; }), [C.v.status, C.v.suspended_reason]);

  section('3b. A last day on a weekend is told on the Friday, first thing, and says "ends this Sunday" (Dean, 9 Nov 2026)');
  check('the words: a Sunday end told on the Friday reads "this Sunday, 13 December"', vpaEndsWhen(vpaFreeMonthEnd(bne(2026, 11, 13, 10, 0)), '2026-12-11') === 'this Sunday, 13 December', vpaEndsWhen(vpaFreeMonthEnd(bne(2026, 11, 13, 10, 0)), '2026-12-11'));
  check('a Saturday end told on the Friday reads "this Saturday, 12 December"', vpaEndsWhen(vpaFreeMonthEnd(bne(2026, 11, 12, 10, 0)), '2026-12-11') === 'this Saturday, 12 December');
  check('a weekday end keeps its date ("on Wed 2 December"): no "this" for a Wednesday', vpaEndsWhen(vpaFreeMonthEnd(bne(2026, 11, 2, 10, 0)), '2026-12-01') === '');
  check('a Sunday end a week away is not "this Sunday"', vpaEndsWhen(vpaFreeMonthEnd(bne(2026, 11, 13, 10, 0)), '2026-12-04') === '');
  var wk = [['Sunday', bne(2026, 11, 13, 10, 0), 'this Sunday, 13 December', '3 days left'], ['Saturday', bne(2026, 11, 12, 10, 0), 'this Saturday, 12 December', '2 days left']];
  for (var wi = 0; wi < wk.length; wi++) {
    world();
    var W = await prospect({ name: 'Weekend End Hotel ' + wi });
    var ws = wk[wi][1];
    W.row().first_signin_at = new Date(ws).toISOString(); W.row().free_month_ends_at = new Date(vpaFreeMonthEnd(ws)).toISOString();
    W.row().reminders_sent = [3, 23];   // day 3 and day 23 have gone; only the last one is left
    var wg = await walk(bne(2026, 12, 10, 0, 0), bne(2026, 12, 13, 23, 0));
    var wl = wg[wg.length - 1];
    check('a free month ending on a ' + wk[wi][0] + ': the last reminder goes on Friday 11 Dec at 9am Brisbane, the first hour of the window, and nothing goes that weekend',
      wg.length === 1 && day(wl.at) === '2026-12-11' && wl.at === bne(2026, 12, 11, 9, 0), wg.map(function (g) { return new Date(g.at + 36e6).toISOString(); }));
    check('its subject says it ends ' + wk[wi][2] + ' (Dean: "saying it ends that day of the weekend")', !!wl && wl.msg.subject === 'Your free month at Weekend End Hotel ' + wi + ' ends ' + wk[wi][2], wl && wl.msg.subject);
    check('and so does the email: "ends ' + wk[wi][2] + '", "' + wk[wi][3] + ' of your free month", never "ends tonight"', !!wl && wl.msg.text.indexOf('Weekend End Hotel ' + wi + ' ends ' + wk[wi][2] + '. If you') !== -1 && wl.msg.text.indexOf(wk[wi][3] + ' of your free month') !== -1 && !/ends tonight|ends on this/.test(wl.msg.text), wl && wl.msg.text.slice(0, 600));
  }

  section('4. During the month, Checkout keeps the offer and charges nothing until the month ends');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var D = await prospect({});
  var ds = Date.now() - 5 * 86400000;
  D.row().first_signin_at = new Date(ds).toISOString(); D.row().free_month_ends_at = new Date(vpaFreeMonthEnd(ds)).toISOString(); D.row().offer_rate = ENV.FOUNDING_CODES ? 2.5 : null;   /* a first sign-in while the offer is open (7 Nov 2026: decided at the sign-in) */
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
  E.row().first_signin_at = new Date(es).toISOString(); E.row().free_month_ends_at = new Date(vpaFreeMonthEnd(es)).toISOString(); E.row().offer_rate = ENV.FOUNDING_CODES ? 2.5 : null;   /* a first sign-in while the offer is open (7 Nov 2026: decided at the sign-in) */
  await walk(es, bne(2026, 11, 13, 12, 0));
  check('one reminder by 13 Nov (day 3)', REM().length === 1, REM().length);
  E.founding().stripe_subscription_id = 'sub_on_day_11';
  await walk(bne(2026, 11, 13, 13, 0), bne(2026, 12, 4, 12, 0));
  check('the card went on: no more reminders (no day 23, no last day), and no pause at the end', REM().length === 1 && E.v.status === 'active' && !E.row().paused_at, [REM().length, E.v.status]);

  /* THEIR UNSUBSCRIBE IS KEPT (9 Nov 2026 audit): every reminder carries "Unsubscribe from product emails" and the
     page promises "we will not contact you again", but the sweep never read vp_unsubscribes. */
  section('5b. An unsubscribe stops the reminders; an unreadable list holds them, never sends blind');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var U9 = await prospect({});
  var us = bne(2026, 11, 2, 10, 0);
  U9.row().first_signin_at = new Date(us).toISOString(); U9.row().free_month_ends_at = new Date(vpaFreeMonthEnd(us)).toISOString();
  tbl('vp_unsubscribes').push({ email: String(U9.row().email).toUpperCase() });
  await walk(us, bne(2026, 11, 30, 16, 0));
  check('they clicked unsubscribe: no day 3, no day 23 (whatever case the address is in)', REM().length === 0 && (U9.row().reminders_sent || []).length === 0, [REM().length, U9.row().reminders_sent]);
  check('...but the free month still runs and the pause still comes at its time (the account is not touched)', !U9.row().paused_at && U9.v.status === 'active');
  DB.vp_unsubscribes = [];
  var unsubDown = globalThis.fetch;
  globalThis.fetch = function (u, o) { if (/\/rest\/v1\/vp_unsubscribes/.test(String(u))) return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve(null); }, text: function () { return Promise.resolve(''); } }); return unsubDown(u, o); };
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 30, 10, 0));
  globalThis.fetch = unsubDown;
  check('the unsubscribe list cannot be read: nothing goes, and nothing is marked sent', REM().length === 0 && (U9.row().reminders_sent || []).length === 0, REM().length);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 30, 11, 0));
  check('the list readable again and they never unsubscribed: the due reminder goes on the next sweep', REM().length === 1, REM().length);

  section('6. Cancel, it\'s not for us');
  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var F = await prospect({});
  var fs = bne(2026, 11, 2, 10, 0);
  F.row().first_signin_at = new Date(fs).toISOString(); F.row().free_month_ends_at = new Date(vpaFreeMonthEnd(fs)).toISOString(); F.row().offer_rate = ENV.FOUNDING_CODES ? 2.5 : null;   /* a first sign-in while the offer is open (7 Nov 2026: decided at the sign-in) */
  var link = await vpaProspectCancelLink(ENV, F.v.founding_id);
  var q = link.split('?')[1];
  function creq(method, qs, bodyTxt) { return { method: method, url: 'https://api.venueplay.com.au/prospect/cancel' + (qs ? '?' + qs : ''), headers: { get: function () { return null; } }, text: function () { return Promise.resolve(bodyTxt || ''); } }; }
  var g = await vpaProspectCancel(creq('GET', q), ENV);
  check('opening the link only ASKS (a mail scanner opening it cancels nothing)', /Cancel venueplay for/.test(g.body) && /Yes, cancel it/.test(g.body) && !F.row().cancelled_at && F.v.status === 'active', g.body.slice(0, 200));
  var bad = await vpaProspectCancel(creq('POST', '', 'f=' + F.v.founding_id + '&t=' + new Array(33).join('0')), ENV);
  check('a wrong token cancels nothing', /has not worked/.test(bad.body) && !F.row().cancelled_at);
  /* A FIXED clock, day 5 of the month (never the real one: the cancel reads Date.now). Since 11 Nov 2026 (Dean, INBOX 191)
     a cancel inside the free month keeps it on to the end date; tools/test-trial-cancel.js walks every rule. */
  var realNowF = Date.now; Date.now = function () { return bne(2026, 11, 7, 10, 0); };
  var ok = await vpaProspectCancel(creq('POST', '', q), ENV);
  Date.now = realNowF;
  check('the button: cancelled and audited, still on to the end date, and the page says nothing was charged', /All done/.test(ok.body) && /nothing was ever charged/.test(ok.body) && /keep using it until 2 December/.test(ok.body) && !!F.row().cancelled_at &&
    F.v.status === 'active' && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_cancelled'; }), [F.v.status, ok.body.slice(0, 600)]);
  await walk(fs, bne(2026, 12, 4, 12, 0), 6 * 3600000);
  check('a cancelled prospect gets no reminders and is never paused', REM().length === 0 && !F.row().paused_at, REM().length);
  check('after the end date the sweep switches it off as "cancelled", and the 90-day clock starts then, like a paid venue at its period end',
    F.v.status === 'suspended' && F.v.suspended_reason === 'cancelled' && !!F.v.closed_at && Date.parse(F.v.closed_at) > Date.parse(F.row().free_month_ends_at), [F.v.status, F.v.closed_at]);
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
    ja.status === 200 && ja.body && ja.body.state === 'ask' && ja.body.title === 'Cancel venueplay for Lakeside Test Tavern?' &&
    ja.body.text === 'No problem at all, and thanks for having a look. There\u2019s no card on your account, so nothing has been charged and nothing will be. We\u2019ll switch it off and stop the reminders.' &&
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
  check('Saturday 21 Nov, before day 23\'s date, sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 8, 30));
  check('before 9am sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 17, 0));
  check('5pm sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 12, 30));
  check('12:30pm (lunch) sends nothing', REM().length === 1);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 25, 9, 0));
  check('9am Wednesday 25 Nov sends day 23', REM().length === 2 && G.row().reminders_sent.indexOf(23) !== -1);

  /* A missed stretch that runs past day 23 into the last day sends the NEWEST reminder: the last-day one, never the
     day-23 note it replaces. */
  var H = await prospect({});
  var hs = bne(2026, 11, 2, 10, 0);
  H.row().first_signin_at = new Date(hs).toISOString(); H.row().free_month_ends_at = new Date(vpaFreeMonthEnd(hs)).toISOString(); H.row().offer_rate = ENV.FOUNDING_CODES ? 2.5 : null;   /* a first sign-in while the offer is open (7 Nov 2026: decided at the sign-in) */
  H.row().reminders_sent = [3];
  var hb = sent.length; await vpaProspectReminderSweep(ENV, bne(2026, 12, 2, 9, 0));
  var hm = sent.slice(hb).filter(function (m) { return m.to && m.to[0] === H.row().email; });
  check('missed day 23 and reached the last day: ONE email, the last-day one, and day 23 is marked so it never goes late',
    hm.length === 1 && /Today is the last day of your free month/.test(hm[0].text || '') && JSON.stringify(H.row().reminders_sent) === '[3,23,30]', [hm.length, hm[0] && hm[0].subject, H.row().reminders_sent]);
  /* A last day on a weekend goes the Friday before, and then it must not say "today". */
  var K = await prospect({});
  var ks = bne(2026, 11, 5, 21, 0);   // day 30 is Saturday 5 Dec, so it goes Friday 4 Dec
  K.row().first_signin_at = new Date(ks).toISOString(); K.row().free_month_ends_at = new Date(vpaFreeMonthEnd(ks)).toISOString();
  K.row().reminders_sent = [3, 23];
  var kb = sent.length; await vpaProspectReminderSweep(ENV, bne(2026, 12, 4, 9, 0));
  var km = sent.slice(kb).filter(function (m) { return m.to && m.to[0] === K.row().email; });
  check('a last day that falls on a Saturday goes Friday as a "days left" one, never "Today is the last day"',
    km.length === 1 && !/Today is the last day/.test(km[0].text || '') && /2 days left of your free month/.test(km[0].text || '') && JSON.stringify(K.row().reminders_sent) === '[3,23,30]', [km.length, km[0] && km[0].subject, K.row().reminders_sent]);

  section('8. The pause screen says what happened (the console\'s own holdWords)');
  var SES = readFile('venueplay/app/vp-session.js');
  function liftFn(src, name) { var i = src.indexOf('function ' + name + '('); var d = 0, k = src.indexOf('{', i); do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0); return src.slice(i, k); }
  var holdWords = new Function('isArchived', liftFn(SES, 'holdWords') + '\nreturn holdWords;')(function () { return false; });
  var hw = holdWords({ status: 'suspended', suspended_reason: 'free_month_ended' }, 'owner');
  check('the owner is told: the free month ended, games paused, the TV keeps its ads, nothing lost, a card switches it back on, nothing to do if it is not for them, and the 5-day leeway is NOT announced (INBOX 55c)',
    hw && hw.reason === 'free_month_ended' && /Your free month has ended, so your games are paused/.test(hw.title) && /Your TV keeps showing your ads and nothing has been lost\./.test(hw.text) &&
    !/5 days|offer ends|standard price/.test(hw.text) && /If it is not for you, there is nothing you need to do\./.test(hw.text) && hw.link && hw.link.href === '#vp-card' && hw.link.label === 'Add your card', hw);
  var hh = holdWords({ status: 'suspended', suspended_reason: 'free_month_ended' }, 'host');
  check('a host is told to ask the owner or a manager, with no card button', hh && !hh.link && /Ask the venue owner or a manager to add a card/.test(hh.text), hh);
  check('the console fetches the venue\'s own card link for that button (never a link written into the page)', /w\.link\.href === '#vp-card'/.test(SES) && /\/account\/card-link/.test(liftFn(SES, 'holdGate')));

  section('9. The send window: Monday to Friday, 9 to 12 and 2 to 5, the venue\'s own time; a due reminder waits, once; the pause is on time (Dean, 7 Nov 2026)');
  /* Every prospect here signs in first at 10am Brisbane Mon 2 Nov, so day 3 is Thu 5 Nov and the month ends 11:59:59pm Wed 2 Dec. */
  async function started(o) { var P = await prospect(o || {}); var s0 = bne(2026, 11, 2, 10, 0);
    P.row().first_signin_at = new Date(s0).toISOString(); P.row().free_month_ends_at = new Date(vpaFreeMonthEnd(s0)).toISOString(); return P; }
  function to(P) { return sent.filter(function (m) { return m.to && m.to[0] === P.row().email; }); }
  function audits(P, act) { return DB.vp_admin_audit.filter(function (a) { return a.action === act && a.target === 'venue:' + P.v.id; }).length; }
  async function firstSweepAt(ms, o) { world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099'; var P = await started(o); await vpaProspectReminderSweep(ENV, ms); return to(P).length; }

  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var I = await started();
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 5, 0, 30));
  check('day 3 is due from midnight Thu 5 Nov, but at 12:30am NOTHING is sent, and it is not marked sent',
    to(I).length === 0 && JSON.stringify(I.row().reminders_sent) === '[]' && audits(I, 'prospect_reminder_sent') === 0, [to(I).length, I.row().reminders_sent]);
  await walk(bne(2026, 11, 5, 1, 30), bne(2026, 11, 5, 8, 30));
  check('nor at 1:30am to 8:30am (every hourly sweep before 9am)', to(I).length === 0 && JSON.stringify(I.row().reminders_sent) === '[]', to(I).length);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 5, 9, 0));
  check('9am Thu 5 Nov: the day-3 note goes, and is recorded', to(I).length === 1 && /How is venueplay going/.test(to(I)[0].subject) && JSON.stringify(I.row().reminders_sent) === '[3]', [to(I).length, I.row().reminders_sent]);
  await walk(bne(2026, 11, 5, 9, 0), bne(2026, 11, 9, 16, 0));
  check('never twice: the same 9am sweep again, every hour after it, the weekend and the Monday after send nothing more',
    to(I).length === 1 && audits(I, 'prospect_reminder_sent') === 1 && JSON.stringify(I.row().reminders_sent) === '[3]', to(I).length);

  var e = [await firstSweepAt(bne(2026, 11, 5, 11, 59)), await firstSweepAt(bne(2026, 11, 5, 12, 0)), await firstSweepAt(bne(2026, 11, 5, 13, 59)),
    await firstSweepAt(bne(2026, 11, 5, 14, 0)), await firstSweepAt(bne(2026, 11, 5, 16, 59)), await firstSweepAt(bne(2026, 11, 5, 17, 0)), await firstSweepAt(bne(2026, 11, 5, 8, 59))];
  check('the edges, as the first sweep of the day: 11:59am sends, 12 noon does not, 1:59pm does not, 2pm sends, 4:59pm sends, 5pm does not, 8:59am does not',
    e.join(',') === '1,0,0,1,1,0,0', e.join(','));

  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var K = await started();
  await walk(bne(2026, 11, 5, 17, 0), bne(2026, 11, 6, 8, 0));
  check('first seen at 5pm Thursday: it waits through the evening and the night', to(K).length === 0 && JSON.stringify(K.row().reminders_sent) === '[]', to(K).length);
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 6, 9, 0));
  check('and goes at 9am Friday, once', to(K).length === 1 && JSON.stringify(K.row().reminders_sent) === '[3]', to(K).length);

  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var L = await started();
  await walk(bne(2026, 11, 6, 21, 0), bne(2026, 11, 9, 8, 0));
  check('due since yesterday (Thu 5 Nov), first seen at 9pm Friday: nothing all weekend, nor 8am Monday', to(L).length === 0 && JSON.stringify(L.row().reminders_sent) === '[]', to(L).length);
  await walk(bne(2026, 11, 9, 9, 0), bne(2026, 11, 9, 12, 0));
  check('it goes at 9am Monday, once', to(L).length === 1 && JSON.stringify(L.row().reminders_sent) === '[3]', to(L).length);

  /* The venue's own clock. 5 Nov 2026 is in daylight saving: Sydney is Brisbane + 1, Perth is Brisbane - 2. */
  var nsw = [await firstSweepAt(bne(2026, 11, 5, 7, 59), { postcode: '2000' }), await firstSweepAt(bne(2026, 11, 5, 8, 0), { postcode: '2000' })];
  var wa = [await firstSweepAt(bne(2026, 11, 5, 10, 59), { postcode: '6000' }), await firstSweepAt(bne(2026, 11, 5, 11, 0), { postcode: '6000' })];
  var qld = [await firstSweepAt(bne(2026, 11, 5, 8, 0), { postcode: '4000' }), await firstSweepAt(bne(2026, 11, 5, 11, 0), { postcode: '4000' })];
  check('a Sydney venue gets it at 9am Sydney (8am Brisbane in daylight saving), a Perth venue at 9am Perth (11am Brisbane), a Brisbane venue at 9am Brisbane',
    nsw.join(',') === '0,1' && wa.join(',') === '0,1' && qld.join(',') === '0,1', [nsw, wa, qld]);

  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var P = await started();
  P.row().reminders_sent = [3, 23, 29];
  await walk(bne(2026, 12, 2, 21, 0), bne(2026, 12, 2, 23, 0));
  check('still on at 11pm Wed 2 Dec, the last hour of the free month', P.v.status === 'active' && !P.row().paused_at);
  var pb = sent.length;
  await vpaProspectReminderSweep(ENV, bne(2026, 12, 3, 0, 0));
  check('the PAUSE is on time: the first sweep after 11:59:59pm (midnight Brisbane) pauses the venue, outside the window',
    P.v.status === 'suspended' && P.v.suspended_reason === 'free_month_ended' && P.row().paused_at === new Date(bne(2026, 12, 3, 0, 0)).toISOString(), [P.v.status, P.row().paused_at]);
  check('and sends no email at midnight', sent.length === pb, sent.slice(pb).map(function (m) { return m.subject; }));
  await walk(bne(2026, 12, 3, 1, 0), bne(2026, 12, 4, 23, 0));
  check('nothing at all overnight or the next days: the pause has no email of its own, and no reminder goes after it', sent.length === pb && audits(P, 'prospect_paused') === 1, sent.slice(pb).map(function (m) { return m.subject; }));

  world(); ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  var Q = await started();
  Q.row().reminders_sent = [3, 23];   // day 29 missed (no sweep ran on 1 Dec), and the month runs out overnight
  var qb = sent.length;
  await vpaProspectReminderSweep(ENV, bne(2026, 12, 3, 0, 30));
  check('a missed day-29 note never goes at night as the month ends: 12:30am pauses, and sends nothing', Q.v.status === 'suspended' && sent.length === qb, sent.slice(qb).map(function (m) { return m.subject; }));
  Q.founding().stripe_subscription_id = 'sub_added_at_night';
  await vpaProspectReminderSweep(ENV, bne(2026, 12, 3, 1, 30));
  check('the paused-venue card check: a card added at night switches the venue back on at once (their own action), and sends no email at 1:30am',
    Q.v.status === 'active' && Q.v.suspended_reason === null && audits(Q, 'prospect_unpaused') === 1 && sent.length === qb, [Q.v.status, sent.length - qb]);
  await walk(bne(2026, 12, 3, 2, 30), bne(2026, 12, 3, 12, 30));
  check('and none at 9am either, nor a second switch-on', sent.length === qb && audits(Q, 'prospect_unpaused') === 1, sent.length - qb);

  /* THE HELPER ITSELF, vpaSendAllowedAt(state, ms): the next moment a message may go, ms itself inside a window. */
  function at(st, ms) { return vpaSendAllowedAt(st, ms); }
  function utc(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h, mi || 0); }
  check('inside a window it is now: 9am, 11:59am, 2pm, 4:59pm Thursday Brisbane',
    [bne(2026, 11, 5, 9, 0), bne(2026, 11, 5, 11, 59), bne(2026, 11, 5, 14, 0), bne(2026, 11, 5, 16, 59)].every(function (t) { return at('QLD', t) === t; }));
  check('12 noon waits to 2pm, 1:59pm to 2pm, 5pm to 9am the next day, 12:30am to 9am',
    at('QLD', bne(2026, 11, 5, 12, 0)) === bne(2026, 11, 5, 14, 0) && at('QLD', bne(2026, 11, 5, 13, 59)) === bne(2026, 11, 5, 14, 0) &&
    at('QLD', bne(2026, 11, 5, 17, 0)) === bne(2026, 11, 6, 9, 0) && at('QLD', bne(2026, 11, 5, 0, 30)) === bne(2026, 11, 5, 9, 0));
  check('Friday 5pm rolls to Monday 9am; Saturday and Sunday noon too',
    at('QLD', bne(2026, 11, 6, 17, 0)) === bne(2026, 11, 9, 9, 0) && at('QLD', bne(2026, 11, 7, 12, 0)) === bne(2026, 11, 9, 9, 0) && at('QLD', bne(2026, 11, 8, 12, 0)) === bne(2026, 11, 9, 9, 0),
    new Date(at('QLD', bne(2026, 11, 6, 17, 0))).toISOString());
  /* Daylight saving starts Sun 4 Oct 2026 and ends Sun 4 Apr 2027. Brisbane and Perth never change. */
  check('before daylight saving (Thu 1 Oct 2026): 9am Sydney is 9am Brisbane (23:00 UTC), 9am Perth is 01:00 UTC, 9am Adelaide is 23:30 UTC',
    at('NSW', utc(2026, 9, 30, 20)) === utc(2026, 9, 30, 23) && at('QLD', utc(2026, 9, 30, 20)) === utc(2026, 9, 30, 23) &&
    at('WA', utc(2026, 9, 30, 20)) === utc(2026, 10, 1, 1) && at('SA', utc(2026, 9, 30, 20)) === utc(2026, 9, 30, 23, 30));
  check('in daylight saving (Mon 5 Oct 2026): 9am Sydney, Melbourne, Hobart and Canberra is 22:00 UTC, Adelaide 22:30 UTC; Brisbane still 23:00, Perth 01:00, Darwin 23:30',
    ['NSW', 'VIC', 'TAS', 'ACT'].every(function (s) { return at(s, utc(2026, 10, 4, 20)) === utc(2026, 10, 4, 22); }) && at('SA', utc(2026, 10, 4, 20)) === utc(2026, 10, 4, 22, 30) &&
    at('QLD', utc(2026, 10, 4, 20)) === utc(2026, 10, 4, 23) && at('WA', utc(2026, 10, 4, 20)) === utc(2026, 10, 5, 1) && at('NT', utc(2026, 10, 4, 20)) === utc(2026, 10, 4, 23, 30),
    new Date(at('NSW', utc(2026, 10, 4, 20))).toISOString());
  check('daylight saving ends (Fri 2 Apr 2027 9am Sydney is 22:00 UTC; Mon 5 Apr 2027 it is 23:00 UTC again, with Brisbane)',
    at('NSW', utc(2027, 4, 1, 20)) === utc(2027, 4, 1, 22) && at('NSW', utc(2027, 4, 4, 20)) === utc(2027, 4, 4, 23) && at('QLD', utc(2027, 4, 4, 20)) === utc(2027, 4, 4, 23));
  check('a state we do not know (or none) keeps Brisbane\'s clock', at(null, bne(2026, 11, 5, 8, 0)) === bne(2026, 11, 5, 9, 0) && at('XX', bne(2026, 11, 5, 8, 0)) === bne(2026, 11, 5, 9, 0));
  check('the venue\'s state comes from au_state, else its postcode', vpaSendState({ au_state: 'wa' }) === 'WA' && vpaSendState({ postcode: '2000' }) === 'NSW' && vpaSendState({}) === null);

  if (badCount()) throw new Error('prospect free month: ' + badCount() + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
