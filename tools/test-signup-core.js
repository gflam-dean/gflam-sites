/* THE SIGN-UP CORE, RUN AND NOT WORD-SEARCHED (Dean, 5 Nov 2026; INBOX 60, 61, 80B, 81, 84).

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router against the rig's fake
   database, fake Stripe and fake Resend:
     1. the same pub in ANOTHER account (item 60) at Add a venue: no venue, no free month, no Stripe call; a help
        desk ticket naming both accounts and the person, and an HQ alert. A new name, or the right name at the wrong
        postcode, is added as before. A database that cannot be read refuses, never creates.
     2. the same at the card sign-up (/checkout): nothing saved, Stripe never asked.
   (Sections for the no-card start, the licensed list and the billing guards follow below.)

   Run from the repo root:  jsc tools/test-signup-core.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
var __rnd = 11;

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
if (typeof btoa === 'undefined') { btoa = function (s) { var B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = ''; for (var i = 0; i < s.length; i += 3) { var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2); var n = (a << 16) | ((b || 0) << 8) | (c || 0); o += B[(n >> 18) & 63] + B[(n >> 12) & 63] + (isNaN(b) ? '=' : B[(n >> 6) & 63]) + (isNaN(c) ? '=' : B[n & 63]); } return o; }; }

/* What left the Worker, besides the database: texts (the SMS hook), Stripe and Resend (the rig records those two). */
var TEXTS = [], AUTH = [];
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('sms-hook.example') !== -1) { TEXTS.push({ headers: (opts && opts.headers) || {}, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } }); }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    var RS = function (st, b) { return Promise.resolve({ ok: st < 300, status: st, json: function () { return Promise.resolve(b); }, text: function () { return Promise.resolve(JSON.stringify(b)); } }); };
    if (FAIL['auth:GET'] > 0 && method === 'GET') { FAIL['auth:GET']--; return RS(503, {}); }
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? String(b.phone).replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '61000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9001), ACCTS = U(9002), STAFFADMIN = U(9003);
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; TEXTS = []; AUTH = [];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFFADMIN, label: 'Helper', role: 'staff' }];
  ['vp_venues', 'venueplay_founding', 'vp_venue_staff', 'vp_admin_audit', 'vp_venue_settings', 'vp_screens', 'vp_venue_screen', 'vp_signin_links',
   'vp_prospect_welcomes', 'vp_prospects', 'vp_help_tickets', 'vp_sessions', 'vp_signup_starts', 'vp_licensed_venues'].forEach(function (t) { DB[t] = []; });
  ENV.SEND_SMS_HOOK_URL = 'https://sms-hook.example/'; ENV.SEND_SMS_HOOK_SECRET = 'dGVzdC1zZWNyZXQtb25seQ==';
  rateLimitReset();
}
/* The in-memory rate limits (helpLimit falls back to them when the rig's rpc answers 0) belong to one world. */
function rateLimitReset() { try { rlMem.clear(); } catch (e) { /* not reachable from here: each world uses its own keys */ } }
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
var AS = function (who, venue) { var h = { Authorization: 'Bearer ' + who }; if (venue) h['X-VP-Venue'] = venue; return h; };
var N = 100;
/* An account with one venue and its owner login. */
function account(o) {
  o = o || {}; var n = ++N;
  var fid = U(n), vid = U(n + 500), owner = U(n + 1000);
  DB.venueplay_founding.push({ id: fid, venue_name: o.name || 'Venue ' + n, contact_email: o.email || ('owner' + n + '@venue.example'), contact_name: o.contact || 'Owner',
    mobile: o.mobile || null, status: o.status || 'active', plan: 'monthly', stripe_subscription_id: o.sub || null, created_at: '2026-10-01T00:00:00.000Z' });
  DB.vp_venues.push({ id: vid, name: o.name || 'Venue ' + n, slug: 'venue-' + n, postcode: ('postcode' in o) ? o.postcode : '4000', founding_id: fid, group_id: null,
    status: o.venueStatus || 'active', suspended_reason: o.reason || null, max_players: 10, created_at: '2026-10-01T00:00:00.000Z' });
  DB.vp_venue_staff.push({ venue_id: vid, auth_user_id: owner, role: 'owner' });
  if (o.login !== false) AUTH.push({ id: owner, email: o.email || ('owner' + n + '@venue.example'), phone: o.phone || '' });
  return { fid: fid, vid: vid, owner: owner };
}
function tickets() { return DB.vp_help_tickets || []; }
function alerts() { return sent.filter(function (m) { return /Same venue, another account/.test(m.subject || ''); }); }

async function main() {
  section('1. Add a venue: the same pub in another account (INBOX 60)');
  world();
  var theirs = account({ name: 'Royal Hotel', postcode: '4000', venueStatus: 'suspended', reason: 'cancelled', email: 'gm@royal.example' });
  var mine = account({ name: 'Bat and Ball', postcode: '2000', email: 'sam@batandball.example' });
  var venuesBefore = DB.vp_venues.length;
  var r = await call('/account/add-venue', { name: 'The Royal Hotel', postcode: '4000', players: 10 }, AS(mine.owner));
  check('the same name and postcode on someone else\'s (cancelled) account is refused', r.status === 409 && r.body.same_venue === true, r);
  check('they read Dean\'s words, word for word', r.body.error === 'This venue is already set up with venueplay. We\'ve lodged a ticket on your behalf and we\'ll be in touch soon.', r.body.error);
  check('no venue was made', DB.vp_venues.length === venuesBefore, DB.vp_venues.length);
  check('Stripe was never asked (no quantity, no charge, no free month credit)', stripeCalls.length === 0, stripeCalls);
  var tk = tickets()[0] || {};
  check('one help desk ticket, filed under accounts', tickets().length === 1 && tk.category === 'accounts', tickets());
  check('the ticket names BOTH accounts', tk.message && tk.message.indexOf(theirs.fid) !== -1 && tk.message.indexOf(mine.fid) !== -1, tk.message);
  check('the ticket names the person\'s email and the existing account\'s contact', tk.contact_email === 'sam@batandball.example' && /gm@royal\.example/.test(tk.message), tk);
  check('the ticket is on the existing venue', tk.venue_id === theirs.vid, tk.venue_id);
  check('HQ is alerted (the staff email)', alerts().length === 1, sent.map(function (m) { return m.subject; }));
  var r2 = await call('/account/add-venue', { name: 'ROYAL HOTEL.', postcode: '4000', players: 10 }, AS(mine.owner));
  check('pressing again is refused the same way, with no second ticket that day', r2.status === 409 && tickets().length === 1, tickets().length);

  section('2. Add a venue: a different venue is added as before');
  var r3 = await call('/account/add-venue', { name: 'Royal Hotel', postcode: '2026', players: 10 }, AS(mine.owner));
  check('THE RIGHT NAME AT THE WRONG POSTCODE is another pub, and is added', r3.status === 200 && r3.body.ok === true, r3);
  var r4 = await call('/account/add-venue', { name: 'Totally New Tavern', postcode: '4000', players: 10 }, AS(mine.owner));
  check('a new name (a manager who moved pubs) is added as before', r4.status === 200 && r4.body.ok === true, r4);
  check('neither made a ticket', tickets().length === 1, tickets().length);

  section('3. Add a venue: no postcode on the old venue, and a database that will not answer');
  world();
  account({ name: 'Railway Hotel', postcode: null, email: 'old@railway.example' });
  var mine2 = account({ name: 'Commercial Hotel', postcode: '3000' });
  var r5 = await call('/account/add-venue', { name: 'Railway Hotel', postcode: '3550', players: 10 }, AS(mine2.owner));
  check('an old venue with no postcode cannot be told apart, so it counts as the same venue (refused, ticketed)', r5.status === 409 && tickets().length === 1, r5);
  check('and the ticket says to check it is really the same pub', /no postcode, so check/.test((tickets()[0] || {}).message || ''), (tickets()[0] || {}).message);
  var before = DB.vp_venues.length;
  /* Only the cross-account read fails (the owner's own venues still load), so the refusal is the check's own. */
  var realAll = vpaSelectAll;
  vpaSelectAll = function (env, table, q) { if (table === 'vp_venues' && /postcode=/.test(q)) return Promise.reject(new Error('read vp_venues page 0: 503')); return realAll(env, table, q); };
  var r6 = await call('/account/add-venue', { name: 'Brand New Arms', postcode: '3000', players: 10 }, AS(mine2.owner));
  vpaSelectAll = realAll;
  check('a database that cannot be read refuses (fails closed, 503), adds nothing and charges nothing', r6.status === 503 && /could not check/.test(r6.body.error || '') && DB.vp_venues.length === before && stripeCalls.length === 0, r6);

  section('4. The card sign-up (/checkout): the same pub in another account');
  world();
  var held = account({ name: 'Olim\'s Canberra Hotel', postcode: '2612', email: 'events@olims.example' });
  var fBefore = DB.venueplay_founding.length;
  var c1 = await call('/checkout', { email: 'new@person.example', name: 'Pat', mobile: '0400 000 111', compliance_accepted: true,
    venues: [{ name: 'Olims Canberra Hotel', seats: 30, postcode: '2612' }] });
  check('refused with Dean\'s words', c1.status === 409 && c1.body.error === 'This venue is already set up with venueplay. We\'ve lodged a ticket on your behalf and we\'ll be in touch soon.', c1);
  check('no account row was saved', DB.venueplay_founding.length === fBefore, DB.venueplay_founding.length);
  check('Stripe was never asked, so no free month started', stripeCalls.length === 0, stripeCalls);
  check('a ticket with the person\'s name, email and mobile', tickets().length === 1 && tickets()[0].contact_name === 'Pat' && tickets()[0].contact_phone === '0400 000 111' && tickets()[0].contact_email === 'new@person.example', tickets()[0]);
  check('the ticket names the existing account', /events@olims\.example/.test(tickets()[0].message) && tickets()[0].message.indexOf(held.fid) !== -1, tickets()[0].message);
  var c2 = await call('/checkout', { email: 'new2@person.example', name: 'Pat', mobile: '0400 000 112', compliance_accepted: true,
    venues: [{ name: 'A Different Pub', seats: 30, postcode: '2612' }] });
  check('a different venue goes on to the card step as before', c2.status === 200 && stripeCalls.length > 0, c2);

  if (typeof moreSections === 'function') await moreSections();

  print('');
  if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
}
var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
