/* THE PROSPECT AUTOPILOT'S ONE DOOR INTO THE BILLING WORKER, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026).

   "Can we also set up something that auto does instantly and sets the customers up". The Mac job
   ~/venue-enrich/prospect-autopilot.py prepares each interested reply and sends nothing until Dean
   says yes; on his yes it calls POST /autopilot/prospect. This runs the REAL billing Worker
   (tools/rig-billing-worker.js) through its REAL router (the default export's fetch) and proves:

     1. the door: off (503) until PROSPECT_AUTOPILOT_KEY is set and long; a wrong, missing or
        near-miss key is 401 and makes nothing; a browser cannot send the key (CORS)
     2. a dry run runs every refusal and makes NOTHING: no venue, no login, no email, no record
     3. on Dean's yes: the SAME setup as HQ (venue, login, slides, terms pending), recorded as the
        autopilot, and the welcome is BOOKED at least 30 minutes out whatever the body asks, so it
        sits in HQ where it can be cancelled or sent now (and HQ's cancel works on it)
     4. the security rules carry over: an email that already signs in is refused, a mobile already
        in use is left off, the same venue twice is refused
     5. HQ's own Set up a prospect is unchanged (no floor on its delay) and gains the same dry run

   Run from the repo root:  jsc tools/test-prospect-autopilot.js */
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
var ADMIN = U(9);
var KEY = 'k3y-' + 'abcdefghijklmnopqrstuvwxyz0123456789';   // 40 characters, assembled so it is no key's shape
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; CANCELS = []; RESEND_IDS = 0; SCREEN_ACTORS = []; STORE = [];
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  ENV.PROSPECT_AUTOPILOT_KEY = KEY;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = []; DB.vp_signin_links = []; DB.vp_prospect_welcomes = [];
}
/* A request as the Worker sees one: method, address, headers by name (any case), a body. */
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
function asAdmin(body) { var t = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + ADMIN : ''; } }, text: function () { return Promise.resolve(t); } }; }
var CENTRE = { name: 'Test Charlie Autopilot Hotel', first_name: 'Rowan', email: 'Manager@TestCharlie.example', mobile: '0400 111 222', postcode: '4000', entity_type: 'for_profit', players: 60,
  website: 'testcharlie.example', slides: [slide(1), slide(2)] };
function with_(o) { var b = {}; for (var k in CENTRE) b[k] = CENTRE[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
function nothingMade() { return DB.vp_venues.length === 0 && DB.venueplay_founding.length === 0 && AUTH.length === 0 && sent.length === 0 &&
  DB.vp_prospect_welcomes.length === 0 && DB.vp_venue_staff.length === 0 && STORE.length === 0 && DB.vp_admin_audit.length === 0; }
var AP = { 'X-Autopilot-Key': KEY };

(async function () {
  section('1. THE DOOR: off until the key is set, and the key is the only way in');
  world(); delete ENV.PROSPECT_AUTOPILOT_KEY;
  var r = await call('/autopilot/prospect', CENTRE, AP);
  check('no PROSPECT_AUTOPILOT_KEY on the Worker: 503 "not switched on", nothing made', r.status === 503 && /not switched on/.test(r.body.error) && nothingMade(), r);
  world(); ENV.PROSPECT_AUTOPILOT_KEY = 'short-key';
  r = await call('/autopilot/prospect', CENTRE, { 'X-Autopilot-Key': 'short-key' });
  check('a key under 32 characters counts as not set: 503, even with that very key sent', r.status === 503 && nothingMade(), r);
  world();
  r = await call('/autopilot/prospect', CENTRE, {});
  check('no key sent: 401, nothing made', r.status === 401 && r.body.error === 'Not allowed.' && nothingMade(), r);
  r = await call('/autopilot/prospect', CENTRE, { 'X-Autopilot-Key': KEY.slice(0, -1) + 'X' });
  check('a key one character off: 401, nothing made', r.status === 401 && nothingMade(), r);
  r = await call('/autopilot/prospect', CENTRE, { 'X-Autopilot-Key': KEY + 'extra' });
  check('the key with more on the end: 401, nothing made', r.status === 401 && nothingMade(), r);
  r = await call('/autopilot/prospect', CENTRE, { 'Authorization': 'Bearer ' + ADMIN });
  check('an HQ login is not the key here: 401 (this door is for the Mac job only)', r.status === 401 && nothingMade(), r);
  r = await call('/autopilot/prospect', CENTRE, AP, 'GET');
  check('a GET is not the route', r.status !== 200 && nothingMade(), r.status);
  r = await call('/autopilot/prospect', null, AP, 'OPTIONS');
  check('a browser cannot send the key: X-Autopilot-Key is not an allowed CORS header', r.status === 204 && !/autopilot/i.test(String(r.headers['Access-Control-Allow-Headers'] || '')) && /Authorization/.test(String(r.headers['Access-Control-Allow-Headers'] || '')), r.headers);
  check('vpaSameSecret: same is same; different, shorter, longer and empty are not',
    vpaSameSecret(KEY, KEY) && !vpaSameSecret(KEY, KEY.slice(0, -1)) && !vpaSameSecret(KEY, KEY + 'a') && !vpaSameSecret('', KEY) && !vpaSameSecret(null, KEY) && !vpaSameSecret(KEY.replace('k', 'K'), KEY));

  section('2. A DRY RUN: every check, and nothing made');
  world();
  r = await call('/autopilot/prospect', with_({ dry_run: true }), AP);
  check('dry run: 200, says so, with what it would make (state from the postcode, both slides, the mobile free)', r.status === 200 && r.body.dry_run === true && r.body.state === 'QLD' && r.body.slides === 2 &&
    r.body.mobile === 'free' && r.body.entity_type === 'for_profit' && r.body.players === 60, r.body);
  check('the welcome it would book is at least 90 minutes out', r.body.welcome_in_minutes === 90, r.body);
  check('and NOTHING was made: no venue, account record, login, staff row, upload, email, welcome record or audit row', nothingMade(), { v: DB.vp_venues.length, a: AUTH.length, s: sent.length });
  r = await call('/autopilot/prospect', with_({ dry_run: true, postcode: '' }), AP);
  check('a dry run still refuses what the real one would (no postcode)', r.status === 400 && /4-digit postcode/.test(r.body.error) && nothingMade(), r.body);
  r = await call('/autopilot/prospect', with_({ dry_run: 'yes' }), AP);
  check('only dry_run: true is a dry run (a string is not, so it cannot be half-read as one)', r.status === 200 && r.body.dry_run === undefined && DB.vp_venues.length === 1, r.body);

  section('3. ON DEAN\'S YES: the same setup as HQ, recorded as the autopilot, the welcome held back for HQ');
  world();
  var t0 = Date.now();
  r = await call('/autopilot/prospect', CENTRE, AP);
  var v = DB.vp_venues[0] || {}, m = sent[0] || {}, row = DB.vp_prospect_welcomes[0] || {};
  check('200: one venue, one account record, one login, the contact its manager', r.status === 200 && r.body.ok && DB.vp_venues.length === 1 && DB.venueplay_founding.length === 1 && AUTH.length === 1 &&
    DB.vp_venue_staff.length === 1 && DB.vp_venue_staff[0].role === 'manager' && DB.vp_venue_staff[0].auth_user_id === AUTH[0].id && DB.vp_venue_staff[0].display_name === 'Rowan', r.body);
  check('the login is NEW, with their email (lower case) and their mobile', AUTH[0].email === 'manager@testcharlie.example' && AUTH[0].phone === '61400111222', AUTH[0]);
  check('the venue is held for the Terms tick exactly as HQ\'s prospects are (terms_required, nothing ticked for them)', v.terms_required === true && v.compliance_accepted_at === null && v.au_state === 'QLD', v);
  check('both slides on their screen, written through the one recorded write, named as the autopilot', r.body.slides === 2 && STORE.length === 2 && SCREEN_ACTORS.length === 1 &&
    SCREEN_ACTORS[0].via === 'autopilot_prospect' && SCREEN_ACTORS[0].route === 'autopilot/prospect' && SCREEN_ACTORS[0].user === null, SCREEN_ACTORS);
  check('the welcome is BOOKED with Resend 90 minutes on, not sent now', sent.length === 1 && typeof m.scheduled_at === 'string' && Math.abs(Date.parse(m.scheduled_at) - t0 - 90 * 60000) < 5000, m.scheduled_at);
  check('and recorded as scheduled in vp_prospect_welcomes, so HQ lists it and can stop it', DB.vp_prospect_welcomes.length === 1 && row.status === 'scheduled' && row.venue_id === v.id && row.created_by === null &&
    /autopilot/i.test(row.created_label), row);
  var aud = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_set_up'; })[0] || {};
  check('the audit row says the autopilot did it, on Dean\'s yes, with no HQ login behind it', aud.actor_admin === null && /autopilot/i.test(aud.actor_label) && /Dean/.test(aud.actor_label) && aud.detail.via === 'autopilot_prospect' && aud.detail.slides === 2, aud);
  var lst = await vpaProspectWelcomes(asAdmin({}), ENV, J);
  check('HQ\'s welcome list shows it, changeable', lst.status === 200 && lst.body.welcomes.length === 1 && lst.body.welcomes[0].can_change === true && lst.body.welcomes[0].venue_name === CENTRE.name, lst.body);
  var cx = await vpaProspectWelcomeCancel(asAdmin({ id: row.id }), ENV, J);
  check('and HQ\'s Cancel works on it: Resend takes it back, the record says cancelled', cx.status === 200 && CANCELS.indexOf('re_1') !== -1 && DB.vp_prospect_welcomes[0].status === 'cancelled', cx.body);

  world(); t0 = Date.now();
  r = await call('/autopilot/prospect', with_({ send_in_minutes: 0 }), AP);
  /* 29 Oct 2026: the floor is 30 minutes (the queue books the welcome 30 minutes after the reply). */
  check('the body asking for 0 minutes (send now) is floored: still booked 30 minutes out', r.status === 200 && sent.length === 1 && typeof sent[0].scheduled_at === 'string' &&
    Math.abs(Date.parse(sent[0].scheduled_at) - t0 - 30 * 60000) < 5000 && r.body.welcome.status === 'scheduled', sent[0] && sent[0].scheduled_at);
  world(); t0 = Date.now();
  r = await call('/autopilot/prospect', with_({ send_in_minutes: 15 }), AP);
  check('15 minutes is floored to 30 too', r.status === 200 && Math.abs(Date.parse(sent[0].scheduled_at) - t0 - 30 * 60000) < 5000, sent[0] && sent[0].scheduled_at);
  world(); t0 = Date.now();
  r = await call('/autopilot/prospect', with_({ send_in_minutes: 300 }), AP);
  check('a longer wait (300 minutes) is kept as asked', r.status === 200 && Math.abs(Date.parse(sent[0].scheduled_at) - t0 - 300 * 60000) < 5000, sent[0] && sent[0].scheduled_at);
  world();
  r = await call('/autopilot/prospect', with_({ send_in_minutes: 5000 }), AP);
  check('out of range is still refused, and nothing made', r.status === 400 && /0 to 1440 minutes/.test(r.body.error) && nothingMade(), r.body);
  world();
  r = await call('/autopilot/prospect', with_({ send_welcome: false }), AP);
  check('send_welcome false: set up, and no email at all', r.status === 200 && sent.length === 0 && DB.vp_prospect_welcomes.length === 0 && r.body.welcome_sent === false, r.body);

  section('4. The security rules carry over');
  world();
  AUTH.push({ id: U(50), email: 'manager@testcharlie.example', phone: '' });
  r = await call('/autopilot/prospect', with_({ dry_run: true }), AP);
  check('an email that already signs in: the dry run refuses it (409), nothing made', r.status === 409 && /already has a VenuePlay login/.test(r.body.error) && DB.vp_venues.length === 0 && sent.length === 0, r.body);
  r = await call('/autopilot/prospect', CENTRE, AP);
  check('and so does the real one: the existing login untouched, no venue, no email', r.status === 409 && AUTH.length === 1 && AUTH[0].phone === '' && DB.vp_venues.length === 0 && sent.length === 0 && DB.vp_venue_staff.length === 0, r.body);
  world();
  AUTH.push({ id: U(51), email: 'someone@else.example', phone: '61400111222' });
  r = await call('/autopilot/prospect', with_({ dry_run: true }), AP);
  check('a mobile already on a login: the dry run says "taken" and makes nothing', r.status === 200 && r.body.mobile === 'taken' && DB.vp_venues.length === 0 && AUTH.length === 1, r.body);
  r = await call('/autopilot/prospect', CENTRE, AP);
  check('the real one sets them up on email only, the other login untouched, and says so', r.status === 200 && AUTH.length === 2 && AUTH[1].phone === '' && AUTH[0].phone === '61400111222' &&
    (r.body.warnings || []).some(function (w) { return /mobile already has a VenuePlay login/.test(w); }), [AUTH, r.body.warnings]);
  r = await call('/autopilot/prospect', with_({ email: 'other@testcharlie.example' }), AP);
  check('the same venue twice (a re-run of an approval): refused, nothing more made', r.status === 409 && /already set up/.test(r.body.error) && DB.vp_venues.length === 1 && AUTH.length === 2, r.body);

  section('5. HQ\'s own Set up a prospect is unchanged, and has the same dry run');
  world(); t0 = Date.now();
  r = await vpaHandleProspect(asAdmin(with_({ send_in_minutes: 0 })), ENV, J);
  check('HQ asking for 0 minutes still sends now (the floor is the autopilot\'s only)', r.status === 200 && sent.length === 1 && sent[0].scheduled_at === undefined && r.body.welcome.status === 'sent', r.body);
  var aud2 = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_set_up'; })[0] || {};
  check('and its audit row is HQ\'s: the admin who did it, via hq', aud2.actor_admin === ADMIN && aud2.actor_label === 'Dean' && aud2.detail.via === 'hq' && (DB.vp_prospect_welcomes[0] || {}).created_by === ADMIN, aud2);
  check('its screen write is recorded as HQ\'s prospect form', SCREEN_ACTORS.length === 1 && SCREEN_ACTORS[0].via === 'hq_prospect' && SCREEN_ACTORS[0].route === 'admin/prospect' && SCREEN_ACTORS[0].user === ADMIN, SCREEN_ACTORS);
  world();
  r = await vpaHandleProspect(asAdmin(with_({ dry_run: true })), ENV, J);
  check('HQ dry run: every check, nothing made', r.status === 200 && r.body.dry_run === true && r.body.welcome_in_minutes === 90 && nothingMade(), r.body);
  world();
  r = await call('/admin/prospect', CENTRE, AP);
  check('the autopilot key does not open HQ\'s route (401, nothing made)', r.status === 401 && nothingMade(), r);

  if (bad) throw new Error('prospect autopilot: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
