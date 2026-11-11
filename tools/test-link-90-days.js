/* EVERY ONE-TAP SIGN-IN LINK LASTS 90 DAYS, RUN ON A FAKE CLOCK (Dean, 10 Nov 2026, INBOX 154).

   "Make the sign-in link last 90 days because that's when we delete the data", so everything lines up on one number.
   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router with Date replaced by a clock the
   suite sets, and proves:
     1. ONE constant: VPA_LINK_DAYS is 90, the ordinary and the prospect link are that constant, it equals player-data
        deletion (VPB_RETENTION_DAYS, the game Worker's RETENTION_DAYS) and HQ's fallback; /admin/prospects says it
     2. a prospect's welcome link issued on day 0 opens on day 89 (and on day 31, the old end), is refused on day 91,
        and "Send me a new link" then says ended; the quiet list counts 90 (day 61: 29 left)
     3. the short link: day 89 the text-code sign-in, day 91 the PLAIN sign-in page, never an error
     4. a link that is not a prospect's: 90 days from when its email goes, a day booked ahead fits the 92 day check
     5. before migration 185 the link is 30 days (14 before 151) and says so; after it the full 90
     6. HQ's "Start a fresh 90 days" after the 90 days gives 90 days from the press
     7. migration 185's own UPDATE, read from the file and applied to old rows: unused links get 90 days from their issue
        date (even ones already expired), used or retired ones and ones over 90 days old do not, and the extended link opens

   Run from the repo root:  jsc tools/test-link-90-days.js */
var ran = 0, bad = 0;
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
MIG175 = false;   // the database before migration 175 (NOT RUN): every send mints its own link, as live today. The one-link world: test-signin-in-thread.js section 7.
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

var AUTH = [], CANCELS = [], RESEND_IDS = 0, SCREEN_ACTORS = [], STORE = [], SMS = [], SMS_STATUS = 200;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('rest.clicksend.com/v3/sms/send') !== -1) { SMS.push({ auth: (opts.headers || {}).Authorization, body: JSON.parse(opts.body) });
    return RS(SMS_STATUS, { data: { messages: [{ status: SMS_STATUS === 200 ? 'SUCCESS' : 'FAILED', message_id: 'cs_' + SMS.length }] } }); }
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


/* THE FAKE CLOCK. Every Date.now() and new Date() in the Worker reads CLOCK, so "day 89" and "day 91" are exact. */
var RealDate = Date, T0 = RealDate.parse('2026-11-16T00:00:00Z'), CLOCK = T0;
function FakeDate(a, b, c, d, e, f, g) {
  if (!(this instanceof FakeDate)) return new RealDate(CLOCK).toString();
  if (arguments.length === 0) return new RealDate(CLOCK);
  if (arguments.length === 1) return new RealDate(a);
  return new RealDate(a, b || 0, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
}
FakeDate.now = function () { return CLOCK; }; FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
Date = FakeDate;
function onDay(n) { CLOCK = T0 + n * DAY + 3600000; }   // an hour into day n
/* The tap: Auth's generate_link answers, and the ONE conditional claim (unused, not expired) as PostgREST does it. */
var preTap = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('/auth/v1/admin/generate_link') !== -1) return RS(200, { properties: { hashed_token: 'h' + CLOCK, verification_type: 'magiclink' } });
  if (/\/rest\/v1\/vp_signin_links\?/.test(u) && opts && opts.method === 'PATCH' && /return=representation/.test((opts.headers || {}).Prefer || '')) {
    var qh = /token_hash=eq\.([0-9a-f]{64})/.exec(u), hit = DB.vp_signin_links.filter(function (l) { return qh && l.token_hash === qh[1] && !l.used_at && Date.parse(l.expires_at) > Date.now(); });
    hit.forEach(function (l) { l.used_at = JSON.parse(opts.body).used_at; });
    return RS(200, hit.map(function (l) { return { auth_user_id: l.auth_user_id, venue_id: l.venue_id }; }));
  }
  return preTap(url, opts);
};
var CAP = null;   // the table's life check, as the database has it: 92 days after migration 185, 31 after 151, 15 after 123
var capped = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  if (CAP && /\/rest\/v1\/vp_signin_links(\?|$)/.test(String(url)) && opts && opts.method === 'POST') {
    var b = JSON.parse(opts.body);
    if (Date.parse(b.expires_at) - Date.parse(b.created_at) > CAP * DAY) return Promise.resolve({ ok: false, status: 400, text: function () { return Promise.resolve('new row for relation "vp_signin_links" violates check constraint "vp_signin_links_life"'); }, json: function () { return Promise.resolve({}); } });
  }
  return capped(url, opts);
};
var tokOf = function (html) { var m = /#t=([A-Za-z0-9_-]{43})/.exec(String(html || '')); return m ? m[1] : ''; };
var WSRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var GSRC = readFile('venueplay-backend/worker/venueplay-game.js');
var MIG = readFile('venueplay-backend/supabase/venueplay-185-signin-link-90-days.sql');
/* The rig evaluates the Worker as a script, so its top-level consts stay inside it: read the numbers from the source, and
   prove them by behaviour below (what a link is really given). */
function constOf(src, name) { var m = new RegExp('\\nconst ' + name + ' = (\\d+);').exec(src); return m ? Number(m[1]) : null; }
var VPA_LINK_DAYS = constOf(WSRC, 'VPA_LINK_DAYS'), VPB_RETENTION_DAYS = constOf(WSRC, 'VPB_RETENTION_DAYS');

(async function () {
  section('1. ONE number, 90, for every one-tap link, the same as player-data deletion (Dean, 10 Nov 2026, INBOX 154)');
  check('the Worker\'s VPA_LINK_DAYS is 90, and the ordinary link and the prospect\'s link are that same constant (not their own numbers)',
    VPA_LINK_DAYS === 90 && /\nconst VPA_SIGNIN_LINK_DAYS = VPA_LINK_DAYS;/.test(WSRC) && /\nconst VPA_PROSPECT_LINK_DAYS = VPA_LINK_DAYS;/.test(WSRC) &&
    vpaProspectLinkEndMs('2026-11-16T00:00:00Z') - T0 === 90 * DAY, VPA_LINK_DAYS);
  var gRet = /const RETENTION_DAYS = (\d+);/.exec(GSRC);
  check('...the same 90 days as player-data deletion: the billing Worker\'s VPB_RETENTION_DAYS and the game Worker\'s RETENTION_DAYS', VPB_RETENTION_DAYS === VPA_LINK_DAYS && gRet && Number(gRet[1]) === VPA_LINK_DAYS, [VPB_RETENTION_DAYS, gRet && gRet[1]]);
  var hqJs = readFile('venueplay/app/vp-prospects-hq.js'), hqHtml = readFile('venueplay/app/hq.html');
  var hqN = /var LINK_DAYS = (\d+);/.exec(hqJs), hqF = /function hqLinkDays\(\)\{[^}]*: (\d+); \}/.exec(hqHtml);
  check('HQ\'s own fallback numbers (before the list arrives) equal the Worker\'s, and no HQ line types "fresh 30" or "fresh 60" days',
    hqN && Number(hqN[1]) === VPA_LINK_DAYS && hqF && Number(hqF[1]) === VPA_LINK_DAYS && !/fresh (14|30|60) days/i.test(hqJs) && !/fresh (14|30|60) days/i.test(hqHtml), [hqN && hqN[1], hqF && hqF[1]]);
  world(); CLOCK = T0;
  var pl = await call('/admin/prospects', {}, AS(ADMIN));
  check('/admin/prospects answers link_days 90, the number HQ writes every "Start a fresh N days" from', pl.status === 200 && pl.body.link_days === VPA_LINK_DAYS, pl.body.link_days);

  section('2. A prospect\'s welcome link, issued on day 0: works on day 89, gone on day 91 (fake clock)');
  async function welcomed(name) {
    var r = await setUp({ name: name, send_welcome: true });
    var v = DB.vp_venues.filter(function (x) { return x.name === name; })[0] || {};
    return { r: r, v: v, tok: tokOf((sent[sent.length - 1] || {}).html), link: DB.vp_signin_links.filter(function (l) { return l.venue_id === v.id; })[0] || {} };
  }
  world(); CLOCK = T0;
  var a = await welcomed('Ninety Arms');
  check('day 0: the welcome\'s link ends 90 days after it was issued, to the minute', a.r.status === 200 && !!a.tok && Math.abs(Date.parse(a.link.expires_at) - T0 - 90 * DAY) < 60000 && !a.r.body.warnings, [a.link.created_at, a.link.expires_at, a.r.body.warnings]);
  onDay(89);
  var t89 = await call('/auth/one-click', { t: a.tok });
  check('day 89: one tap still opens it', t89.status === 200, [t89.status, t89.body]);
  world(); CLOCK = T0;
  var b = await welcomed('Ninety One Arms');
  onDay(91);
  var t91 = await call('/auth/one-click', { t: b.tok });
  check('day 91: the same tap is refused (410), the one answer every dead link gets', t91.status === 410, [t91.status, t91.body]);
  var q91 = await call('/auth/one-click/resend', { t: b.tok });
  check('...and "Send me a new link" on day 91 says the link has ended, sends nothing to them (no link hands itself out after the 90 days)', q91.status === 200 && q91.body.ended === true, q91.body);
  onDay(30);
  world(); CLOCK = T0;
  var c = await welcomed('Day Thirty Arms');
  onDay(31);
  var t31 = await call('/auth/one-click', { t: c.tok });
  check('day 31 (the old 30 day end): it still works', t31.status === 200, [t31.status, t31.body]);
  world(); CLOCK = T0;
  var d = await welcomed('Day Sixty Arms');
  onDay(61);
  var q61 = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  var j61 = ((q61.body || {}).prospects || []).filter(function (x) { return x.venue_id === d.v.id; })[0] || {};
  check('day 61 (the old 60 day end): the quiet list still has them, 29 days left of 90, and the link_days it says is 90', q61.body.link_days === 90 && j61.link_days_left === 29 && Math.abs(Date.parse(j61.link_expires_at) - T0 - 90 * DAY) < 60000, [q61.body.link_days, j61.link_days_left]);

  section('3. An expired short link opens the NORMAL sign-in page (Dean: "they should just go to a login page")');
  MIG175 = true; world(); CLOCK = T0;
  var CODE_IN = function (t) { var m = /\/s\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12})(?![A-Za-z0-9])/.exec(String(t || '')); return m ? m[1] : ''; };
  var NETS = 0, NET = function () { return { 'cf-connecting-ip': '198.18.1.' + (++NETS % 250) }; };
  var s1 = await call('/autopilot/prospect', { name: 'Short Ninety Hotel', first_name: 'Sam', email: 'short90@testcharlie.example', postcode: '2065', entity_type: 'for_profit', return_signin_link: true }, AP);
  var code = CODE_IN(s1.body.signin && s1.body.signin.url);
  check('its short link ends 90 days after setup', !!code && Math.abs(Date.parse(s1.body.signin.expires_at) - T0 - 90 * DAY) < 120000, s1.body.signin);
  onDay(89);
  var o89 = await call('/short/open', { code: code }, NET());
  check('day 89: it opens the text-code sign-in with their mobile ready', /^\/app\/\?signin=sms/.test(o89.body.go || ''), o89.body);
  onDay(91);
  var o91 = await call('/short/open', { code: code }, NET());
  check('day 91: it opens the plain sign-in page (/app/), never an error page', o91.status === 200 && o91.body.go === '/app/' && o91.body.state === 'ended', [o91.status, o91.body]);
  MIG175 = false;

  section('4. A link that is not a prospect\'s (an HQ-onboarded venue, a staff login) lasts 90 days from when its email goes');
  world(); CLOCK = T0;
  var who = newId(), vid = newId();
  var m0 = await vpaMintSigninLinkFor(ENV, who, vid, T0, null);
  var r0 = DB.vp_signin_links[DB.vp_signin_links.length - 1] || {};
  check('made now: 90 days, not 14, and not shortened', Math.abs(m0.expiresAt - T0 - 90 * DAY) < 1000 && m0.shortened === false && Date.parse(r0.expires_at) === m0.expiresAt, [m0, r0.expires_at]);
  var m1 = await vpaMintSigninLinkFor(ENV, who, vid, T0 + DAY, null);
  check('booked a day ahead: its 90 days start when it goes, and still fit migration 185\'s 92 day check', m1.expiresAt === T0 + 91 * DAY && m1.expiresAt - T0 <= 92 * DAY, m1);
  var big = await vpaMintSigninLinkFor(ENV, who, vid, T0, T0 + 400 * DAY);
  check('asked for more than 90 days: held to 91 at most (the clamp), so it never breaks the database check', big.expiresAt <= T0 + 91 * DAY && big.expiresAt > T0 + 90 * DAY, big);

  section('5. Before migration 185 runs: a shorter link, and it says the days it REALLY has');
  CAP = 31; world(); CLOCK = T0;
  var p151 = await vpaMintSigninLinkFor(ENV, who, vid, T0, null);
  check('151\'s 31 day cap: a 30 day link, marked shortened', p151.shortened === true && p151.expiresAt === T0 + 30 * DAY, p151);
  var s185 = await setUp({ name: 'Before Arms', send_welcome: true });
  check('...and a prospect set up then is told its link lasts about 30 days (the real count from when its email goes), not 90, and to run migration 185', s185.status === 200 && (s185.body.warnings || []).some(function (w) { return /lasts 3[01] days, not 90/.test(w) && /run migration 185 /.test(w); }), s185.body.warnings);
  CAP = 15; world(); CLOCK = T0;
  var p123 = await vpaMintSigninLinkFor(ENV, who, vid, T0, null);
  check('123\'s 15 day cap (before 151): a 14 day link, marked shortened', p123.shortened === true && p123.expiresAt === T0 + 14 * DAY, p123);
  CAP = 92; world(); CLOCK = T0;
  var p185 = await vpaMintSigninLinkFor(ENV, who, vid, T0 + DAY, null);
  check('after 185 (92 days): the full 90, booked a day ahead included, not shortened', p185.shortened === false && p185.expiresAt === T0 + 91 * DAY, p185);
  CAP = null;

  section('6. HQ\'s "Start a fresh 90 days" after the 90 days: a new link for 90 days from the press');
  world(); CLOCK = T0;
  var e = await welcomed('Fresh Ninety Arms');
  onDay(91);
  var hq0 = await call('/admin/signin-link', { venue_id: e.v.id }, AS(ADMIN));
  check('day 91: HQ\'s normal resend is refused and names "Start a fresh 90 days"', hq0.status === 409 && /Start a fresh 90 days/.test(hq0.body.error || ''), hq0.body);
  var hqF = await call('/admin/signin-link', { venue_id: e.v.id, fresh: true }, AS(ADMIN));
  check('"Start a fresh 90 days": 90 days left, ending 90 days from the press', hqF.status === 200 && hqF.body.restarted === true && hqF.body.days_left === 90 && Math.abs(Date.parse(hqF.body.expires_at) - CLOCK - 90 * DAY) < 60000, hqF.body);

  section('7. Links already issued and unused are given 90 days from their issue date (migration 185, NOT RUN)');
  /* The migration's own UPDATE, read from the file and applied row by row here: SET expires_at = created_at + N days
     WHERE each condition. Only the shapes the file uses are understood; anything else stops the suite. */
  var up = /update vp_signin_links\s+set expires_at = created_at \+ interval '(\d+) days'\s+where ([\s\S]*?);/i.exec(MIG);
  if (!up) throw new Error('migration 185 has no UPDATE of vp_signin_links the suite can read');
  var N = Number(up[1]), conds = up[2].split(/\s+and\s+/i).map(function (s) { return s.trim(); });
  function holds(rw, cnd, now) {
    var iv = function (s) { var m = /^created_at \+ interval '(\d+) days'$/.exec(s); return m ? Date.parse(rw.created_at) + Number(m[1]) * DAY : null; };
    if (cnd === 'used_at is null') return !rw.used_at;
    var m = /^(.+?)\s*(<|>|<=|>=)\s*(.+)$/.exec(cnd);
    if (!m) throw new Error('migration 185: cannot read the condition ' + cnd);
    var val = function (s) { s = s.trim(); if (s === 'now()') return now; if (s === 'expires_at') return Date.parse(rw.expires_at); if (s === 'created_at') return Date.parse(rw.created_at); var x = iv(s); if (x === null) throw new Error('migration 185: cannot read ' + s); return x; };
    var L = val(m[1]), R = val(m[3]);
    return m[2] === '<' ? L < R : m[2] === '>' ? L > R : m[2] === '<=' ? L <= R : L >= R;
  }
  function migrate(now) { DB.vp_signin_links.forEach(function (rw) { if (conds.every(function (cn) { return holds(rw, cn, now); })) rw.expires_at = new RealDate(Date.parse(rw.created_at) + N * DAY).toISOString(); }); }
  var capM = /check \(expires_at > created_at and expires_at <= created_at \+ interval '(\d+) days'\)/.exec(MIG);
  check('the migration sets 90 days from issue and lifts the table\'s cap to 92 (90, a day booked ahead, one spare)', N === VPA_LINK_DAYS && capM && Number(capM[1]) === 92, [N, capM && capM[1]]);
  world(); CLOCK = T0;
  var olds = {};
  async function oldLink(key, issuedDay, lifeDays, used) {
    CLOCK = T0 + issuedDay * DAY;
    var nm = 'Old ' + key + ' Arms';
    var w = await welcomed(nm);
    w.link.expires_at = new RealDate(CLOCK + lifeDays * DAY).toISOString();   // as the old Worker made it (30 or 60 days)
    if (used) w.link.used_at = new RealDate(CLOCK + DAY).toISOString();
    olds[key] = w;
  }
  await oldLink('Unused30', -40, 30, false);     // issued 40 days ago with 30 days: expired 10 days ago, never used
  await oldLink('Unused60', -10, 60, false);     // issued 10 days ago with 60 days, still live
  await oldLink('Used', -20, 30, true);          // used (or retired by a newer link: the Worker retires by setting used_at)
  await oldLink('Ancient', -100, 30, false);     // issued 100 days ago: its 90 days are over too
  CLOCK = T0;
  migrate(CLOCK);
  var exp = function (k) { return Date.parse(olds[k].link.expires_at) - Date.parse(olds[k].link.created_at); };
  check('an unused link issued 40 days ago with 30 days (already expired): now 90 days from its issue date', exp('Unused30') === 90 * DAY, olds.Unused30.link);
  check('an unused 60 day link issued 10 days ago: now 90 days from its issue date', exp('Unused60') === 90 * DAY, olds.Unused60.link);
  check('a used or retired link is NOT brought back', exp('Used') === 30 * DAY && !!olds.Used.link.used_at, olds.Used.link);
  check('a link issued 100 days ago stays ended (its 90 days have passed)', exp('Ancient') === 30 * DAY, olds.Ancient.link);
  onDay(49);   // day 89 for the one issued 40 days ago
  var tOld = await call('/auth/one-click', { t: olds.Unused30.tok });
  check('...and the extended link really opens: one tap on its day 89', tOld.status === 200, [tOld.status, tOld.body]);
  onDay(51);   // its day 91
  var tOld2 = await call('/auth/one-click', { t: olds.Unused60.tok });
  check('...the other extended link (issued day -10) still opens on its day 61', tOld2.status === 200, [tOld2.status, tOld2.body]);
  var tUsed = await call('/auth/one-click', { t: olds.Used.tok });
  check('...and the used one stays dead (410)', tUsed.status === 410, tUsed.status);

  /* The 4 hour host sign-out is NOT this link and does not move (compliance): tools/test-one-click-signin.js runs enforceShift. */

  if (bad) throw new Error('link 90 days: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
