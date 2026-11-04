/* HQ > PROSPECTS, 6 NOV RELEASE: EDIT DETAILS, ONE SEND BUTTON (EMAIL AND TEXT), COMPACT ROWS. RUN, NOT WORD-SEARCHED.

   Dean, 4 Nov 2026: "there's no way to add or change a prospect's phone, mobile, contact name or email after it's
   created"; "Resend their account email" and "Resend sign-in link" look the same; then "the SIGN-IN LINK is what they
   need ... by EMAIL and by TEXT at the same time, when we have a mobile". He adds numbers for small venues on Friday
   so the follow-ups run over the weekend: a mobile saved here must reach the call list and the text follow-up with
   nothing else done.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router, and the REAL HQ files:
     1. POST /admin/prospect/update: owner or accounts only; a venue login, staff and nobody get nothing
     2. validation: Australian mobile (04) and landline formats, the setup's email check; a refusal changes nothing
     3. name and phone saved spaced as said, with one audit row of who changed what, from and to
     4. a NEW MOBILE: on the account, the number to ring when there was none, on their login for the text code; the
        call list flags them, the quiet list hands the Mac the mobile, and the text follow-up goes to it, no other step
     5. a mobile that is somebody else's login, or a login that already has one: kept for calls and texts, said why
     6. a NEW EMAIL: login, prospect row and account together; old links retired; the next link goes to the new
        address; refused when it is another login's, or when the login runs another venue
     7. the ONE send button's Worker half: email and text together (two live links ending together), outside
        9am to 8pm or on a Sunday the text is queued for the next allowed time and the hourly trigger sends it once;
        texts off, no queue table (migration 152) and no mobile each say so; a fresh 30 days
     8. the pane: compact rows with a status chip that opens the details, Edit details, one send button
     9. hq.html's one send function: says email and text or email only, asks the Worker for both, shows its line;
        a welcome still booked is sent now instead of a second link

   Run from the repo root:  jsc tools/test-prospect-edit-6nov.js */
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


/* The fake Auth also takes an admin PUT (the login's email or mobile changed), and a PATCH that asks for the rows
   back gets them, as PostgREST does with Prefer: return=representation. */
var PUTS = [];
var outerFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
  if (one && method === 'PUT') {
    var b = JSON.parse(opts.body), hit = AUTH.filter(function (x) { return x.id === one[1]; })[0];
    PUTS.push({ id: one[1], body: b });
    if (!hit) return RS(404, { msg: 'not found' });
    if (PUT_FAIL) { PUT_FAIL = false; return RS(422, { msg: 'email address is invalid' }); }
    if (b.email) hit.email = b.email; if (b.phone) hit.phone = String(b.phone).replace('+', '');
    return RS(200, hit);
  }
  var h = (opts && opts.headers) || {};
  if (method === 'PATCH' && /return=representation/.test(h.Prefer || h.prefer || '')) {
    var m = /\/rest\/v1\/([a-zA-Z_]+)\??(.*)$/.exec(u);
    if (m && !(FAIL[m[1] + ':PATCH'] > 0)) {
      var q = parseQ(m[2]), o2 = JSON.parse(opts.body), hits = tbl(m[1]).filter(function (r) { return match(r, q); });
      hits.forEach(function (r) { for (var k in o2) r[k] = o2[k]; });
      return RS(200, hits);
    }
  }
  return outerFetch(url, opts);
};
var PUT_FAIL = false;
var REAL_NOW = Date.now.bind(Date), CLOCK = null;
Date.now = function () { return CLOCK == null ? REAL_NOW() : CLOCK; };
/* The next Brisbane weekday (dow 0 Sunday .. 6 Saturday) at h:m, after the real now, as UTC ms. */
function bne(dow, h, m) {
  var t = REAL_NOW() + 10 * 3600000, d = new Date(t);
  var base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m || 0) - 10 * 3600000;
  var add = (dow - d.getUTCDay() + 7) % 7 || 7;
  return base + add * DAY;
}
function venueOf(name) { return DB.vp_venues.filter(function (x) { return x.name === name; })[0] || {}; }
function acctOf(name) { var v = venueOf(name); return DB.venueplay_founding.filter(function (f) { return f.id === v.founding_id; })[0] || {}; }
function loginOf(name) { var r = row(name) || {}; return AUTH.filter(function (u) { return u.id === r.auth_user_id; })[0] || {}; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return a.action === action; }); }
function snap() { return JSON.stringify([DB.vp_prospects, DB.venueplay_founding, AUTH, DB.vp_signin_links]); }
async function upd(body, who) { return call('/admin/prospect/update', body, who === null ? {} : AS(who || ADMIN)); }

(async function () {
  section('1. POST /admin/prospect/update: owner or accounts, nobody else');
  world();
  await setUp({ name: 'Small Pub', send_welcome: false });
  var small = venueOf('Small Pub');
  check('the prospect was set up with no phone and no mobile (the Friday case)', small.id && row('Small Pub') && !row('Small Pub').phone && !acctOf('Small Pub').mobile, row('Small Pub'));
  var r0 = await upd({ venue_id: small.id, contact_name: 'Jo' }, null);
  var r1 = await upd({ venue_id: small.id, contact_name: 'Jo' }, STAFF);
  var r2 = await upd({ venue_id: small.id, contact_name: 'Jo' }, U(55));
  check('no sign-in, an HQ staff login and a venue login are all refused, and nothing changed',
    r0.status === 401 && r1.status === 403 && (r2.status === 401 || r2.status === 403) && row('Small Pub').contact_name === 'Sam' && audits('prospect_details_changed').length === 0, [r0.status, r1.status, r2.status]);
  var r3 = await upd({ venue_id: small.id, contact_name: 'Jo Smith' }, ACCTS);
  check('accounts can: the name is saved', r3.status === 200 && row('Small Pub').contact_name === 'Jo Smith' && r3.body.changed.join() === 'contact_name', r3.body);
  var a3 = audits('prospect_details_changed')[0] || {};
  check('...with ONE audit row: who (Accounts), the venue, and the name from and to',
    audits('prospect_details_changed').length === 1 && a3.actor_label === 'Accounts' && a3.target === 'venue:' + small.id &&
    a3.detail.changes.contact_name.from === 'Sam' && a3.detail.changes.contact_name.to === 'Jo Smith', a3);
  var r4 = await upd({ venue_id: U(404), contact_name: 'X' });
  var r5 = await upd({ venue_id: 'nope', contact_name: 'X' });
  check('a venue that is not a prospect is 404, a bad id 400', r4.status === 404 && r5.status === 400, [r4.body, r5.body]);

  section('2. Validation: an Australian mobile, a landline with its area code, a real email; a refusal changes nothing');
  var before = snap(), nAud = DB.vp_admin_audit.length;
  var BADS = [
    [{ mobile: '02 9876 5432' }, /not an Australian mobile/], [{ mobile: '0412 345' }, /not an Australian mobile/], [{ mobile: '+1 415 555 0100' }, /not an Australian mobile/],
    [{ phone: '1300 123 456' }, /does not look like an Australian number/], [{ phone: '12345' }, /does not look like an Australian number/],
    [{ email: 'not-an-email' }, /Enter their email/], [{ email: '' }, /Enter their email/], [{}, /Nothing to change/]
  ];
  var badOut = [];
  for (var i = 0; i < BADS.length; i++) {
    var rb = await upd(Object.assign({ venue_id: small.id }, BADS[i][0]));
    if (!(rb.status === 400 && BADS[i][1].test(rb.body.error || ''))) badOut.push([BADS[i][0], rb.status, rb.body.error]);
  }
  check('a landline or a short number as the mobile, a 1300 or short phone, a bad or empty email, or nothing at all: 400 with the reason', badOut.length === 0, badOut);
  check('...and every one of them changed no record, no login, no link and wrote no audit row', snap() === before && DB.vp_admin_audit.length === nAud);
  var rs = await upd({ venue_id: small.id, phone: '+61 7 5228 9999' });
  check('a landline in any spacing, +61 or not, is saved spaced as it is said', rs.status === 200 && row('Small Pub').phone === '(07) 5228 9999', [rs.body, row('Small Pub').phone]);
  var rsame = await upd({ venue_id: small.id, phone: '07 5228 9999' });
  check('saving the same number again changes nothing and writes no audit row', rsame.status === 200 && rsame.body.changed.length === 0 && audits('prospect_details_changed').length === 2, rsame.body);
  var rclr = await upd({ venue_id: small.id, phone: '' });
  check('an empty phone clears it (audited from and to)', rclr.status === 200 && !row('Small Pub').phone && audits('prospect_details_changed')[2].detail.changes.phone.to === null, row('Small Pub'));

  section('3 and 4. A NEW MOBILE reaches the call list and the text follow-up with nothing else done');
  age('Small Pub', 5 * DAY);
  var l0 = await list();
  var p0 = find(l0, 'Small Pub');
  check('before: 5 days quiet with no number, so NOT on the call list (an email follow-up instead)', p0 && !p0.flag && p0.email_follow_up === true && !p0.tel && !p0.mobile && l0.body.follow_up_count === 0, p0);
  var q0 = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  var qq0 = (q0.body.prospects || []).filter(function (p) { return p.venue_id === small.id; })[0];
  check('...and the Mac\'s quiet list has no mobile for them', qq0 && qq0.mobile === null && qq0.has_phone === false, qq0);
  var rm = await upd({ venue_id: small.id, mobile: '0412345678' });
  check('Edit details saves the mobile: on the account, spaced, and as the number to ring (there was none, as at setup)',
    rm.status === 200 && acctOf('Small Pub').mobile === '0412 345 678' && row('Small Pub').phone === '0412 345 678' && rm.body.changed.sort().join() === 'mobile,phone', [rm.body, acctOf('Small Pub'), row('Small Pub')]);
  check('...and on their login for the text-code sign-in (it had none and the number is nobody else\'s)',
    rm.body.login_mobile_added === true && loginOf('Small Pub').phone === '61412345678' && PUTS.some(function (x) { return x.body.phone === '+61412345678' && x.body.phone_confirm === true; }), [loginOf('Small Pub'), PUTS]);
  var am = audits('prospect_details_changed').slice(-1)[0] || {};
  check('...audited: the mobile from none to the number, and that it went on the login', am.detail && am.detail.changes.mobile.to === '0412 345 678' && am.detail.changes.mobile.from === null && am.detail.login_mobile_added === true, am);
  var l1 = await list(), p1 = find(l1, 'Small Pub');
  check('the very next read: on the call list, flagged Call them, tap to call, the mobile shown, the tab count up by one',
    p1.flag === 'no_sign_in' && p1.follow_up === true && p1.tel === 'tel:0412345678' && p1.mobile === '0412 345 678' && l1.body.follow_up_count === 1, p1);
  var q1 = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  var qq1 = (q1.body.prospects || []).filter(function (p) { return p.venue_id === small.id; })[0];
  check('the Mac\'s next run sees the mobile, so it plans the text follow-up (prospect_nudge.py reads p.mobile)', qq1 && qq1.mobile === '0412 345 678' && qq1.has_phone === true, qq1);
  ENV.PROSPECT_SMS_ON = 'on'; ENV.CLICKSEND_USERNAME = 'rig'; ENV.CLICKSEND_API_KEY = 'rig-key'; SMS.length = 0;
  var ns = await call('/autopilot/prospect/nudge-sms', { venue_id: small.id, text: 'venueplay: Hi Jo, your venueplay is ready: {link} Reply STOP to opt out' }, AP);
  check('...and the text follow-up, once Dean says yes, goes to that mobile with no other step',
    ns.status === 200 && SMS.length === 1 && SMS[0].body.messages[0].to === '+61412345678' && /\/app\/go#t=/.test(SMS[0].body.messages[0].body), [ns.body, SMS]);
  delete ENV.PROSPECT_SMS_ON;

  /* A mobile kept on the account but with a landline to ring: the call list rings the landline, the text goes to the mobile. */
  await setUp({ name: 'Landline Inn', phone: '02 9876 5432', send_welcome: false });
  age('Landline Inn', 4 * DAY);
  var rl = await upd({ venue_id: venueOf('Landline Inn').id, mobile: '0498 765 432' });
  var pl = find(await list(), 'Landline Inn');
  check('a landline already there stays the number to ring; the mobile is kept for texts', rl.status === 200 && row('Landline Inn').phone === '(02) 9876 5432' && pl.mobile === '0498 765 432' && pl.tel === 'tel:0298765432', pl);
  var ql = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  var qql = (ql.body.prospects || []).filter(function (p) { return p.venue_id === venueOf('Landline Inn').id; })[0];
  check('...the Mac is handed the MOBILE for the text, not the landline', qql && qql.mobile === '0498 765 432', qql);
  ENV.PROSPECT_SMS_ON = 'on'; SMS.length = 0;
  var nsl = await call('/autopilot/prospect/nudge-sms', { venue_id: venueOf('Landline Inn').id, text: 'venueplay: Hi Sam, your venueplay is ready: {link} Reply STOP to opt out' }, AP);
  check('...and the text follow-up goes to the mobile (a landline can never take a text)', nsl.status === 200 && SMS.length === 1 && SMS[0].body.messages[0].to === '+61498765432', [nsl.body, SMS]);
  delete ENV.PROSPECT_SMS_ON;

  var rcl = await upd({ venue_id: small.id, phone: '' });
  var pcl = find(await list(), 'Small Pub');
  check('the phone to ring cleared but the mobile kept: still on the call list, ringing the mobile',
    rcl.status === 200 && !row('Small Pub').phone && pcl.flag === 'no_sign_in' && pcl.tel === 'tel:0412345678' && pcl.mobile === '0412 345 678', pcl);

  section('5. A mobile that is somebody else\'s login, or a login that already has one: kept, and HQ is told why');
  AUTH.push({ id: U(77), email: 'other@x.example', phone: '61400111222' });
  await setUp({ name: 'Taken Mobile Tavern', send_welcome: false });
  var rt = await upd({ venue_id: venueOf('Taken Mobile Tavern').id, mobile: '0400 111 222' });
  check('that mobile already signs in for somebody else: saved for calls and texts, NOT put on their login, and said so',
    rt.status === 200 && acctOf('Taken Mobile Tavern').mobile === '0400 111 222' && !loginOf('Taken Mobile Tavern').phone && rt.body.login_mobile_added === false &&
    /already has a venueplay login/.test((rt.body.warnings || []).join()), rt.body);
  var rk = await upd({ venue_id: small.id, mobile: '0433 222 111' });
  check('their login already signs in with a mobile: that stays (theirs), the new one is kept for calls and texts, and said so',
    rk.status === 200 && loginOf('Small Pub').phone === '61412345678' && acctOf('Small Pub').mobile === '0433 222 111' && /ending 678, and that stays/.test((rk.body.warnings || []).join()), rk.body);

  section('6. A NEW EMAIL: their login, the prospect and the account together, and sign-in still works');
  await setUp({ name: 'Typo Hotel', email: 'jo@typo.exmaple', send_welcome: true, send_in_minutes: 0 });
  var ty = venueOf('Typo Hotel'), tyLogin = loginOf('Typo Hotel');
  var liveBefore = DB.vp_signin_links.filter(function (l) { return l.auth_user_id === tyLogin.id && !l.used_at; }).length;
  var re = await upd({ venue_id: ty.id, email: 'Jo@Typo.Example' });
  check('the email is changed on the login, the prospect row and the account record, lowercased',
    re.status === 200 && loginOf('Typo Hotel').email === 'jo@typo.example' && row('Typo Hotel').email === 'jo@typo.example' && acctOf('Typo Hotel').contact_email === 'jo@typo.example' && re.body.login_email_changed === true, [re.body, loginOf('Typo Hotel'), row('Typo Hotel').email, acctOf('Typo Hotel').contact_email]);
  check('...the welcome\'s link that went to the old address stops working (retired), and HQ is told how many',
    liveBefore === 1 && DB.vp_signin_links.filter(function (l) { return l.auth_user_id === tyLogin.id && !l.used_at; }).length === 0 && re.body.links_retired === 1, [liveBefore, re.body]);
  sent.length = 0;
  var sl = await call('/admin/signin-link', { venue_id: ty.id }, AS(ADMIN));
  check('...and the next sign-in link goes to the NEW address, and works (one live link)',
    sl.status === 200 && sl.body.to === 'jo@typo.example' && sent.length === 1 && String(sent[0].to) === 'jo@typo.example' &&
    DB.vp_signin_links.filter(function (l) { return l.auth_user_id === tyLogin.id && !l.used_at; }).length === 1, [sl.body, sent.map(function (e) { return e.to; })]);
  var ae = audits('prospect_details_changed').slice(-1)[0] || {};
  check('...audited from the old address to the new one, with the login changed', ae.detail.changes.email.from === 'jo@typo.exmaple' && ae.detail.changes.email.to === 'jo@typo.example' && ae.detail.login_email_changed === true, ae);
  var before6 = snap();
  var rx = await upd({ venue_id: ty.id, email: 'other@x.example' });
  check('an address that is somebody else\'s login is refused (409), and nothing changed', rx.status === 409 && /already has a venueplay login/.test(rx.body.error) && snap() === before6, rx.body);
  PUT_FAIL = true;
  var rp = await upd({ venue_id: ty.id, email: 'new@typo.example', contact_name: 'Joanne' });
  check('Auth refusing the new email changes NOTHING (not the name either: the login goes first)', rp.status === 502 && snap() === before6 && row('Typo Hotel').contact_name === 'Sam', rp.body);
  DB.vp_venue_staff.push({ venue_id: U(901), auth_user_id: tyLogin.id, role: 'owner' });
  var r2v = await upd({ venue_id: ty.id, email: 'new@typo.example' });
  check('a login that also runs another venue: its email is changed from their own account, not here (409, nothing changed)', r2v.status === 409 && /another venueplay venue/.test(r2v.body.error) && snap() === before6, r2v.body);
  DB.vp_venue_staff = DB.vp_venue_staff.filter(function (s) { return s.venue_id !== U(901); });

  section('7. The one send button\'s Worker half: email and text together, a fresh 30 days');
  ENV.PROSPECT_SMS_ON = 'on'; SMS.length = 0; sent.length = 0;
  CLOCK = bne(3, 12, 0);   // a Wednesday, noon Brisbane
  await setUp({ name: 'Weekend Bowls', send_welcome: false });
  var wb = venueOf('Weekend Bowls');
  await upd({ venue_id: wb.id, mobile: '0455 666 777' });
  var tx = await call('/admin/signin-link', { venue_id: wb.id, text: true }, AS(ADMIN));
  var wbLinks = DB.vp_signin_links.filter(function (l) { return l.venue_id === wb.id && !l.used_at; });
  check('inside 9am to 8pm on a weekday: ONE press sends the email AND the text, now', tx.status === 200 && tx.body.text && tx.body.text.status === 'sent' && sent.length === 1 && SMS.length === 1 && SMS[0].body.messages[0].to === '+61455666777', [tx.body, SMS.length]);
  check('...two live links, the email\'s and the text\'s, ending at the same moment, a fresh 30 days from now',
    wbLinks.length === 2 && wbLinks[0].expires_at === wbLinks[1].expires_at && Math.abs(Date.parse(wbLinks[0].expires_at) - (CLOCK + 30 * DAY)) < 120000 && tx.body.days_left === 30, wbLinks);
  var smsBody = (SMS[0] && SMS[0].body.messages[0]) || {};
  check('...the text is from venueplay, names them and the venue, carries the one-tap link, says until when, and "Reply STOP to opt out", no long dash',
    smsBody.from === 'venueplay' && /^venueplay: Hi Sam, here is your new sign-in link for Weekend Bowls\. /.test(smsBody.body) && /\/app\/go#t=/.test(smsBody.body) &&
    smsBody.body.indexOf('It works until ' + tx.body.expires_words + '.') !== -1 && /Reply STOP to opt out$/.test(smsBody.body) && !/[—–]/.test(smsBody.body) && smsBody.body.length <= 480, smsBody.body);
  check('...HQ is shown one line: "Sent by email and text, link works until <day>."', tx.body.line === 'Sent by email and text, link works until ' + tx.body.expires_words + '.', tx.body.line);
  check('...recorded: signin_link_sent and signin_text_sent (last three digits only)', audits('signin_text_sent').some(function (a) { return a.target === 'venue:' + wb.id && a.detail.to_last3 === '777'; }) && audits('signin_link_sent').length >= 1);

  CLOCK = bne(6, 21, 0);   // a Saturday, 9pm Brisbane: Sunday is out too, so the next allowed time is Monday 9am
  SMS.length = 0; sent.length = 0;
  var tq = await call('/admin/signin-link', { venue_id: wb.id, text: true }, AS(ADMIN));
  var qrow = (DB.vp_signin_texts || []).filter(function (x) { return x.venue_id === wb.id; })[0] || {};
  var mon9 = CLOCK + DAY * 2 - 12 * 3600000;   // Saturday 9pm + 2 days - 12 hours = Monday 9am
  check('Saturday 9pm: the email goes now, the text does NOT, it is queued for Monday 9am (never a Sunday)',
    tq.status === 200 && sent.length === 1 && SMS.length === 0 && tq.body.text.status === 'queued' && qrow.status === 'queued' && Date.parse(qrow.send_at) === mon9 && qrow.to_e164 === '+61455666777', [tq.body, qrow]);
  check('...and HQ is shown when: "Sent by email, link works until <day>. The text is queued for 9:00am Mon ..."',
    /^Sent by email, link works until .+\. The text is queued for 9:00am Mon \d+ [A-Z][a-z]{2} \(texts go 9am to 8pm, not Sundays\)\.$/.test(tq.body.line), tq.body.line);
  check('...no token is kept in the queue (only who, where and when): the text makes its link when it goes', !/t=|token/.test(JSON.stringify(qrow)) && DB.vp_signin_links.filter(function (l) { return l.venue_id === wb.id && !l.used_at; }).length === 1, qrow);
  CLOCK = mon9 - 3600000;
  var sw0 = await vpaSigninTextSweep(ENV, Date.now());
  check('the hourly trigger at 8am Monday sends nothing yet', sw0.sent === 0 && SMS.length === 0 && qrow.status === 'queued', sw0);
  CLOCK = mon9 + 60000;
  var sw1 = await vpaSigninTextSweep(ENV, Date.now());
  var sw2 = await vpaSigninTextSweep(ENV, Date.now());
  check('at 9am Monday it sends the text once (a second tick sends nothing), its link ending with the email\'s',
    sw1.sent === 1 && sw2.sent === 0 && SMS.length === 1 && qrow.status === 'sent' &&
    DB.vp_signin_links.filter(function (l) { return l.venue_id === wb.id && !l.used_at; }).every(function (l) { return l.expires_at === qrow.expires_at; }), [sw1, sw2, qrow]);
  FAIL['vp_signin_texts:POST'] = 1; CLOCK = bne(0, 10, 0);   // Sunday 10am, and no queue table (migration 152 not run)
  var tn = await call('/admin/signin-link', { venue_id: wb.id, text: true }, AS(ADMIN));
  check('before migration 152, outside the hours: the email still goes, nothing is queued, and HQ is told to press again after 9:00am Mon',
    tn.status === 200 && tn.body.text.status === 'not_queued' && /migration 152/.test(tn.body.line) && /after 9:00am Mon/.test(tn.body.line), tn.body);
  FAIL = {}; delete ENV.PROSPECT_SMS_ON; CLOCK = bne(3, 12, 0); SMS.length = 0;
  var to = await call('/admin/signin-link', { venue_id: wb.id, text: true }, AS(ADMIN));
  check('texts switched off (no SMS provider yet): the email goes, no text, and the line says so', to.status === 200 && SMS.length === 0 && to.body.text.status === 'sms_off' && /texts are switched off/.test(to.body.line), to.body);
  ENV.PROSPECT_SMS_ON = 'on';
  await setUp({ name: 'No Mobile Club', send_welcome: false });
  var tm = await call('/admin/signin-link', { venue_id: venueOf('No Mobile Club').id, text: true }, AS(ADMIN));
  check('no mobile: "Sent by email only, link works until <day>. Add a mobile in Edit details to text it too."',
    tm.status === 200 && SMS.length === 0 && tm.body.line === 'Sent by email only, link works until ' + tm.body.expires_words + '. Add a mobile in Edit details to text it too.', tm.body.line);
  var tw = await call('/admin/signin-link', { venue_id: wb.id }, AS(ADMIN));
  check('a caller that does not ask for the text (text not true) gets the email only, as before', tw.status === 200 && SMS.length === 0 && !tw.body.text, tw.body);
  delete ENV.PROSPECT_SMS_ON; delete ENV.CLICKSEND_USERNAME; delete ENV.CLICKSEND_API_KEY; CLOCK = null;
  check('the text hours: Wed noon now; Wed 7am to 9am; Wed 8pm to Thu 9am; Sat 8:30pm and Sun 10am to Mon 9am',
    vpaSmsAllowedAt(bne(3, 12)) === bne(3, 12) && vpaSmsAllowedAt(bne(3, 7)) === bne(3, 9) && vpaSmsAllowedAt(bne(3, 20)) === bne(3, 9) + DAY &&
    vpaSmsAllowedAt(bne(6, 20, 30)) === bne(6, 9) + 2 * DAY && vpaSmsAllowedAt(bne(0, 10)) === bne(0, 9) + DAY);

  section('8. The pane: compact rows, a status chip that opens them, Edit details, one send button');
  var PANE = readFile('venueplay/app/vp-prospects-hq.js');
  var W = { VP: null, fetch: function () { return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve({}); } }); }, setTimeout: function () {}, CustomEvent: function () {} };
  W.document = { readyState: 'complete', getElementById: function () { return null; }, addEventListener: function () {} };
  (new Function('window', PANE))(W);
  var T = W.VPProspects._t;
  var pr = { venue_id: U(1), name: 'Quiet Arms', contact_name: 'Jo', email: 'jo@q.example', phone: null, mobile: null, tel: null, status: 'not_signed_in', days_since_setup: 5,
    created_at: '2026-10-30T00:00:00Z', welcome: { status: 'sent', send_at: '2026-10-30T02:00:00Z' }, sign_in_known: true, flag: null, called: null };
  var h = T.cardHtml(pr);
  check('the chip says where they are and for how long: "Not signed in · 5 days"; a free month "Free month · 12 days left"',
    T.statusLabel(pr) === 'Not signed in · 5 days' && T.statusLabel({ status: 'free_month', days_left: 12 }) === 'Free month · 12 days left' &&
    T.statusLabel({ status: 'free_month', days_left: 1 }) === 'Free month · last day' && T.statusLabel({ status: 'card_added' }) === 'Card added' && T.statusLabel(Object.assign({}, pr, { days_since_setup: 1 })) === 'Not signed in · 1 day', T.statusLabel(pr));
  check('a row starts compact: the name, the chip as a button (not expanded), the details hidden', /<button type="button" class="badge prst prst-none" data-pr-status="not_signed_in" data-pr-toggle="[^"]+" aria-expanded="false"/.test(h) && /<div class="prmore" hidden>/.test(h), h.slice(0, 600));
  check('...everything that was there is still there, inside it: contact, phone, mobile, email, website, set up, welcome, sign-ins, free month, where',
    ['Contact', 'Phone', 'Mobile', 'Email', 'Website', 'Set up', 'Welcome email', 'Last sign-in', 'First sign-in', 'Free month ends', 'Where'].every(function (k) { return h.indexOf('<span class="k">' + k + '</span>') !== -1; }), h);
  var tg = { getAttribute: function (k) { return k === 'data-pr-toggle' ? U(1) : null; }, hasAttribute: function (k) { return k === 'data-pr-toggle'; } }; tg.closest = function () { return tg; };
  T.onClick({ target: tg });
  var hOpen = T.cardHtml(pr);
  check('pressing the chip opens it (aria-expanded true, details shown); pressing again closes it',
    /aria-expanded="true"/.test(hOpen) && /<div class="prmore">/.test(hOpen) && (T.onClick({ target: tg }), /<div class="prmore" hidden>/.test(T.cardHtml(pr))), hOpen.slice(0, 500));
  check('ONE send button, "Send them a new sign-in link", and with no mobile it says "email only, add a mobile to text it too"; no second resend',
    /data-pr-signin="[^"]+">Send them a new sign-in link<span class="prvia">email only, add a mobile to text it too<\/span><\/button>/.test(h) && !/data-pr-welcome|Resend their account email|Resend sign-in link/.test(h + PANE.replace(/\/\*[\s\S]*?\*\//g, '')), h);
  var hm = T.cardHtml(Object.assign({}, pr, { mobile: '0412 345 678', phone: '0412 345 678', tel: 'tel:0412345678' }));
  check('with a mobile: "by email and text", a Call button that rings it, and the mobile under the name', /<span class="prvia">by email and text<\/span>/.test(hm) && /<a class="mini prcall" href="tel:0412345678">Call 0412 345 678<\/a>/.test(hm) && /<span class="prsub">Jo · 0412 345 678<\/span>/.test(hm), hm);
  check('Edit details, Called and View as are in the actions too', /data-pr-edit="[^"]+">Edit details</.test(h) && /data-pr-called=/.test(h) && /data-pr-viewas=/.test(h));
  check('cancelled: no send button (they said no), Edit details still there', !/data-pr-signin/.test(T.cardHtml(Object.assign({}, pr, { status: 'cancelled' }))) && /data-pr-edit=/.test(T.cardHtml(Object.assign({}, pr, { status: 'cancelled' }))));
  T.S.editing = U(1); T.S.expanded[U(1)] = true;
  var he = T.cardHtml(Object.assign({}, pr, { contact_name: 'Jo "the boss" <b>' }));
  check('Edit details opens a form with their name, email, mobile and phone filled in, escaped, and Save / Cancel',
    /id="prEdName" type="text" value="Jo &quot;the boss&quot; &lt;b&gt;"/.test(he) && /id="prEdEmail" type="email" value="jo@q\.example"/.test(he) && /id="prEdMobile" type="tel" value=""/.test(he) &&
    /id="prEdPhone"/.test(he) && /data-pr-edit-save=/.test(he) && /data-pr-edit-close=/.test(he) && he.indexOf('<b>') === -1, he);
  T.S.editing = null; T.S.expanded = {};
  check('no em or en dash anywhere in the pane', !/[—–]/.test(PANE));

  section('9. hq.html\'s ONE send function (the Venues row and the Prospects row both call it)');
  var HQ = readFile('venueplay/app/hq.html');
  var ASK = [], TELL = [], POSTS = [], ANS = true, REPLY = {};
  var fn = new Function('S', 'vpAsk', 'vpTell', 'workerPost', 'window', 'VPProspects', lift(HQ, 'hqSigninLink') + '\nreturn hqSigninLink;')(
    { venues: [{ id: 'V1', name: 'Quiet Arms' }] },
    function (q) { ASK.push(q); return Promise.resolve(ANS); }, function (t) { TELL.push(t); },
    function (path, body) { POSTS.push({ path: path, body: body }); return Promise.resolve(REPLY[path] || {}); },
    {}, { load: function () {}, get: function () { return null; } });
  var btn = { textContent: 'Send them a new sign-in link', disabled: false };
  REPLY['/admin/signin-link'] = { ok: true, to: 'jo@q.example', line: 'Sent by email and text, link works until Fri 4 Dec.' };
  await fn('V1', btn, { venue_id: 'V1', name: 'Quiet Arms', email: 'jo@q.example', mobile: '0412 345 678', welcome: { status: 'sent' } });
  check('with a mobile it asks first, saying it goes by email to them AND by text to the mobile, for a fresh 30 days',
    /It goes by email to jo@q\.example and by text to 0412 345 678\. One tap opens their account, for a fresh 30 days\./.test(ASK[0] || ''), ASK);
  check('...then asks the Worker for both (text: true) and shows the Worker\'s own line', POSTS.length === 1 && POSTS[0].path === '/admin/signin-link' && POSTS[0].body.venue_id === 'V1' && POSTS[0].body.text === true &&
    TELL[0] === 'Sent by email and text, link works until Fri 4 Dec.\n\nThe email went to jo@q.example.' && btn.disabled === false && btn.textContent === 'Send them a new sign-in link', [POSTS, TELL]);
  await fn('V1', btn, { venue_id: 'V1', email: 'jo@q.example', mobile: null, welcome: null });
  check('with no mobile it says "by email only ... (add a mobile in Edit details to text it too)"', /by email only, to jo@q\.example \(add a mobile in Edit details to text it too\)/.test(ASK[1] || ''), ASK[1]);
  ANS = false; POSTS.length = 0;
  await fn('V1', btn, { venue_id: 'V1', email: 'jo@q.example' });
  check('No on the question sends nothing', POSTS.length === 0);
  ANS = true; POSTS.length = 0; TELL.length = 0;
  REPLY['/admin/prospect/welcome-now'] = { ok: true, status: 'sent_now' };
  await fn('V1', btn, { venue_id: 'V1', email: 'jo@q.example', welcome: { id: 'W1', status: 'scheduled', send_at: new Date(Date.now() + 3600000).toISOString(), when: '3:00pm Fri 6 Nov' } });
  check('a welcome still BOOKED: it offers to send that now (it carries their link) instead of a second link that would kill its button',
    /booked for 3:00pm Fri 6 Nov, and it already carries their sign-in link/.test(ASK[ASK.length - 1]) && POSTS.length === 1 && POSTS[0].path === '/admin/prospect/welcome-now' && POSTS[0].body.id === 'W1' && /went now/.test(TELL[0] || ''), [POSTS, ASK[ASK.length - 1]]);
  var venuesRow = lift(HQ, 'renderVenues');
  check('Venues > Details: a prospect has only the one send button; others keep the add-your-card email beside it',
    /canBilling\(\) && !isProspect\(v\) \? '<button class="mini" data-resend=/.test(venuesRow) && />Send them a new sign-in link<\/button>/.test(venuesRow) && !/Resend sign-in link/.test(HQ), venuesRow.length);
  check('no em or en dash in what this changed in hq.html', !/[—–]/.test(lift(HQ, 'hqSigninLink')));

  print('');
  if (bad) throw new Error('prospect edit 6 Nov: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
