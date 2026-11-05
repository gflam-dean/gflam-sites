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
var TEXTS = [], AUTH = [], JOINS = 0, HITS = {};
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('sms-hook.example') !== -1) { TEXTS.push({ headers: (opts && opts.headers) || {}, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } }); }
  /* The durable rate limit (vp_help_hit, the help desk's counter): counted here, per world, as the database counts it. */
  if (u.indexOf('/rest/v1/rpc/vp_help_hit') !== -1) { var hb = JSON.parse(opts.body); HITS[hb.p_key] = (HITS[hb.p_key] || 0) + 1; var allowed = HITS[hb.p_key] <= hb.p_limit;
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(allowed); } }); }
  if (u.indexOf('challenges.cloudflare.com') !== -1) { var ok = JSON.parse(opts.body).response === 'human'; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ success: ok }); } }); }
  /* PostgREST answers a PATCH with Prefer: return=representation with the rows it changed. The rig answers no body, so
     the one-request-wins claim on a sign-up is modelled here, the way the real database does it. */
  if (method === 'PATCH' && /\/rest\/v1\/vp_signup_starts\?/.test(u) && /return=representation/.test(JSON.stringify((opts && opts.headers) || {}))) {
    var qs = u.split('?')[1].split('&'), want = {}; qs.forEach(function (p) { var i = p.indexOf('='); var k = p.slice(0, i), v = decodeURIComponent(p.slice(i + 1)); if (/^eq\./.test(v)) want[k] = v.slice(3); });
    var ch = JSON.parse(opts.body), hit2 = (DB.vp_signup_starts || []).filter(function (r) { for (var k in want) if (String(r[k]) !== want[k]) return false; return true; });
    hit2.forEach(function (r) { for (var k in ch) r[k] = ch[k]; });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(hit2.map(function (r) { return { id: r.id }; })); } });
  }
  /* The database gives every new venue its join code (migration 91's trigger); the fake does the same. */
  if (method === 'POST' && /\/rest\/v1\/vp_venues$/.test(u)) { var vb = JSON.parse(opts.body); if (vb && !Array.isArray(vb) && !vb.join_code) { vb.join_code = 'TV' + ('0000' + (++JOINS)).slice(-4); opts = Object.assign({}, opts, { body: JSON.stringify(vb) }); } }
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
function rateLimitReset() { HITS = {}; }
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

/* ======================= THE NO-CARD START (/start, INBOX 80B, 81, 61, 84) ======================= */
function lastCode() { return TEXTS.length ? TEXTS[TEXTS.length - 1].body.sms.otp : null; }
function listed() {
  DB.vp_licensed_venues = [
    { id: 1, name: 'The Grand Hotel', name_key: 'grand-hotel', postcode: '4217', suburb: 'Surfers Paradise', au_state: 'QLD', source: 'venue master list' },
    { id: 2, name: 'Royal Hotel', name_key: 'royal-hotel', postcode: '4000', suburb: 'Brisbane', au_state: 'QLD', source: 'send list' },
    { id: 3, name: 'Railway Hotel', name_key: 'railway-hotel', postcode: '4350', suburb: 'Toowoomba', au_state: 'QLD', source: 'send list' },
    { id: 4, name: 'Commercial Hotel', name_key: 'commercial-hotel', postcode: '2800', suburb: 'Orange', au_state: 'NSW', source: 'send list' } ];
}
var FIVE = { venue: 'the grand hotel', postcode: '4217', name: 'Sam Jones', mobile: '0412 345 678', email: 'sam@grandhotel.example' };
function five(o) { var b = {}; for (var k in FIVE) b[k] = FIVE[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
var IP = 0;
function NET() { return { 'cf-connecting-ip': '10.0.0.' + (++IP) }; }
async function start(o) {
  var r = await call('/start/begin', five(o), NET());
  if (r.status !== 200) return { begin: r };
  var v = await call('/start/verify', { start_id: r.body.start_id, code: lastCode() }, NET());
  return { begin: r, verify: v, id: r.body.start_id };
}
function count(t) { return (DB[t] || []).length; }
function snapshot() { return { f: count('venueplay_founding'), v: count('vp_venues'), auth: AUTH.length, s: count('vp_venue_staff'), p: count('vp_prospects') }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function moreSections() {
  section('5. The five boxes and the text code: nothing is made before the code passes');
  world(); listed();
  var s0 = snapshot();
  var e1 = await call('/start/begin', five({ postcode: '' }), NET());
  check('no postcode: refused, pointing at the postcode box', e1.status === 400 && e1.body.field === 'postcode', e1);
  var e2 = await call('/start/begin', five({ mobile: '07 5228 3667' }), NET());
  check('a landline is not a mobile (a code could never reach it)', e2.status === 400 && e2.body.field === 'mobile', e2);
  var hp = await call('/start/begin', five({ website: 'http://spam.example' }), NET());
  check('the honeypot answers as if it worked, and nothing is saved or texted', hp.status === 200 && count('vp_signup_starts') === 0 && TEXTS.length === 0, hp);
  ENV.TURNSTILE_SECRET = 'ts-secret';
  var bt = await call('/start/begin', five({ turnstile: 'robot' }), NET());
  check('the bot check says no: refused, nothing saved, nothing texted', bt.status === 403 && bt.body.bot === true && count('vp_signup_starts') === 0 && TEXTS.length === 0, bt);
  var ok1 = await call('/start/begin', five({ turnstile: 'human' }), NET());
  delete ENV.TURNSTILE_SECRET;
  check('a person passes the bot check and gets a code', ok1.status === 200 && TEXTS.length === 1, ok1);
  var row = DB.vp_signup_starts[0] || {};
  var code = lastCode();
  check('the code is six digits, texted to their mobile through the SMS hook', /^\d{6}$/.test(code) && TEXTS[0].body.user.phone === '+61412345678', TEXTS[0] && TEXTS[0].body);
  check('the text is signed the way the hook checks (webhook-id, timestamp, v1 signature)', !!TEXTS[0].headers['webhook-id'] && !!TEXTS[0].headers['webhook-timestamp'] && /^v1,/.test(TEXTS[0].headers['webhook-signature'] || ''), TEXTS[0].headers);
  check('only the code\'s hash is kept, never the code', !!row.code_hash && JSON.stringify(row).indexOf(code) === -1, row);
  check('before the code: no account, no venue, no login, no staff row, no prospect row', same(snapshot(), s0), snapshot());
  var w = await call('/start/verify', { start_id: ok1.body.start_id, code: code === '000000' ? '111111' : '000000' }, NET());
  check('a wrong code is refused and counted', w.status === 400 && DB.vp_signup_starts[0].attempts === 1, w);
  for (var i = 0; i < 4; i++) await call('/start/verify', { start_id: ok1.body.start_id, code: code === '000000' ? '111111' : '000000' }, NET());
  var w5 = await call('/start/verify', { start_id: ok1.body.start_id, code: code }, NET());
  check('after five wrong codes even the right one is refused: the start is spent', w5.status === 410, w5);
  check('and still nothing was made', same(snapshot(), s0), snapshot());
  delete ENV.SEND_SMS_HOOK_URL;
  var off = await call('/start/begin', five({ email: 'x@y.example' }), NET());
  ENV.SEND_SMS_HOOK_URL = 'https://sms-hook.example/';
  check('with no way to send a code, the start says it is not switched on and saves nothing', off.status === 503 && count('vp_signup_starts') === 1, off);

  section('6. A REAL VENUE on our licensed list: the account straight away (item 81, the same prospect account)');
  world(); listed();
  var s1 = snapshot();
  var a = await start({ venue: 'GRAND HOTEL', players: 50 });
  check('the code passes and the account is made', a.verify.status === 200 && a.verify.body.outcome === 'made', a.verify);
  var v = DB.vp_venues.filter(function (x) { return x.name === 'GRAND HOTEL'; })[0] || {};
  var f = DB.venueplay_founding.filter(function (x) { return x.id === v.founding_id; })[0] || {};
  check('one account, one venue, one login: the prospect setup\'s own rows', snapshot().f === s1.f + 1 && snapshot().v === s1.v + 1 && AUTH.length === s1.auth + 1, snapshot());
  check('10 players, whatever the page sent (50 here)', v.max_players === 10 && f.max_seats === 10, [v.max_players, f.max_seats]);
  check('no card: no Stripe customer, no subscription, Stripe never called', !f.stripe_subscription_id && !f.stripe_customer_id && stripeCalls.length === 0, stripeCalls);
  check('a pub until they say otherwise (asked when they first turn on bingo, raffles or members draws)', v.entity_type === 'for_profit' && v.paid_entry_enabled === false, v.entity_type);
  check('the state comes from the postcode', v.au_state === 'QLD', v.au_state);
  var p = DB.vp_prospects.filter(function (x) { return x.venue_id === v.id; })[0] || {};
  check('HQ > Prospects lists it as a self sign-up', p.source === 'self', p.source);
  check('the free month has NOT started here: it starts at their first sign-in', !p.first_signin_at && !p.free_month_started_at, p);
  check('their mobile is their login, so they sign in by text code', AUTH.some(function (u) { return u.phone === '61412345678' && u.email === 'sam@grandhotel.example'; }), AUTH);
  check('the done screen gets the TV code and a one-tap way in', /^TV\d{4}$/.test(a.verify.body.tv_code || '') && /\/app\/go#t=/.test(a.verify.body.go_url || ''), a.verify.body);
  check('the sign-up is recorded as made, with the list row it matched', DB.vp_signup_starts[0].outcome === 'made' && /Grand Hotel, 4217/.test(DB.vp_signup_starts[0].licensed_match || ''), DB.vp_signup_starts[0]);
  var again = await call('/start/verify', { start_id: a.id, code: TEXTS[0].body.sms.otp }, NET());
  check('the same code again makes nothing more', again.body.outcome === 'done_before' && snapshot().f === s1.f + 1, again.body);

  section('7. A FAKE NAME, and THE RIGHT NAME AT THE WRONG POSTCODE: no account, no free month, HQ checks (item 81)');
  var s2 = snapshot();
  var fk = await start({ venue: 'Totally Made Up Tavern', mobile: '0412 000 001', email: 'fake@made.example' });
  check('a fake name: Dean\'s words', fk.verify.status === 200 && fk.verify.body.message === 'Thanks, we\'ll check your venue and get you set up, usually within a business day.', fk.verify.body);
  check('a fake name: nothing made', same(snapshot(), s2), snapshot());
  var tkt = tickets().filter(function (t) { return /Sign-up to check: Totally Made Up Tavern/.test(t.subject || ''); })[0] || {};
  check('an HQ ticket with what they typed (venue, postcode, name, email, mobile)', /Totally Made Up Tavern/.test(tkt.message || '') && /4217/.test(tkt.message) && /fake@made\.example/.test(tkt.message) && /\+61412000001/.test(tkt.message), tkt.message);
  var wp = await start({ venue: 'The Grand Hotel', postcode: '2000', mobile: '0412 000 002', email: 'wrongpc@made.example' });
  check('the right name at the wrong postcode is held the same way', wp.verify.body.message === 'Thanks, we\'ll check your venue and get you set up, usually within a business day.' && same(snapshot(), s2), wp.verify.body);
  check('both are waiting in HQ', DB.vp_signup_starts.filter(function (r) { return r.outcome === 'held_unlisted'; }).length === 2);

  section('8. HQ approves in one tap: the normal account and welcome follow');
  var held = await call('/admin/signup-starts', {}, AS(ADMIN));
  check('HQ lists the held sign-ups', held.status === 200 && held.body.held.length === 2, held.body);
  var no = await call('/admin/signup-start/decide', { start_id: fk.id, decision: 'approve' }, AS(STAFFADMIN));
  check('a staff admin cannot approve (owner or accounts only)', no.status === 403 && snapshot().f === s2.f, no);
  var sentBefore = sent.length;
  var yes = await call('/admin/signup-start/decide', { start_id: fk.id, decision: 'approve' }, AS(ACCTS));
  check('approve makes the account', yes.status === 200 && yes.body.outcome === 'approved' && snapshot().f === s2.f + 1, yes);
  check('and sends the welcome', sent.length > sentBefore && yes.body.welcome_sent === true, sent.slice(sentBefore).map(function (m) { return m.subject; }));
  check('still no card and no Stripe call', stripeCalls.length === 0, stripeCalls);
  var twice = await call('/admin/signup-start/decide', { start_id: fk.id, decision: 'approve' }, AS(ADMIN));
  check('a second tap makes nothing more', twice.status === 409 && snapshot().f === s2.f + 1, twice);
  var ref = await call('/admin/signup-start/decide', { start_id: wp.id, decision: 'refuse' }, AS(ADMIN));
  check('refuse makes nothing', ref.status === 200 && snapshot().f === s2.f + 1, ref);

  section('9. A KNOWN PERSON RE-TRYING WITH A NEW EMAIL: their mobile, proven, joins their account (item 61)');
  var s3 = snapshot();
  var kn = await start({ venue: 'Royal Hotel', postcode: '4000', email: 'sam.new@another.example' });
  check('the code proves the mobile, and they are recognised', kn.verify.status === 200 && kn.verify.body.outcome === 'known', kn.verify.body);
  check('their details are pre-filled only now: their name and their login\'s email', kn.verify.body.prefill && kn.verify.body.prefill.email === 'sam@grandhotel.example' && /Sam/.test(kn.verify.body.prefill.name || ''), kn.verify.body.prefill);
  check('no second account, no second login, no second free month', snapshot().f === s3.f && AUTH.length === s3.auth, snapshot());
  var j = await call('/start/join', { start_id: kn.id, code: lastCode() }, NET());
  var nv = DB.vp_venues.filter(function (x) { return x.name === 'Royal Hotel' && x.postcode === '4000'; })[0] || {};
  var grand = DB.vp_venues.filter(function (x) { return x.name === 'GRAND HOTEL'; })[0] || {};
  check('their yes adds Royal Hotel to THEIR account: one bill', j.status === 200 && j.body.outcome === 'joined' && nv.founding_id === grand.founding_id, j);
  check('still one account, and no new login', snapshot().f === s3.f && AUTH.length === s3.auth, snapshot());
  var j2 = await call('/start/join', { start_id: kn.id, code: lastCode() }, NET());
  check('joining twice adds nothing more', j2.status === 409 && DB.vp_venues.filter(function (x) { return x.name === 'Royal Hotel'; }).length === 1, j2);
  var yours = await start({ venue: 'The Grand Hotel', email: 'third@another.example' });
  check('the same person signing up the pub they already have is told it is theirs, nothing made', yours.verify.body.outcome === 'yours' && snapshot().f === s3.f, yours.verify.body);

  section('10. An email we know, typed with another mobile: nothing about that login is shown (item 61)');
  HITS = {};   // an hour later: the per-mobile limit (3 an hour) was spent on that mobile in section 9
  var s4 = snapshot(), textsFrom = TEXTS.length;
  var em = await start({ venue: 'Railway Hotel', postcode: '4350', mobile: '0499 111 222', email: 'sam@grandhotel.example' });
  var msg = JSON.stringify(em.verify.body);
  check('they are asked to prove it with a code to the mobile already on that login', em.verify.body.outcome === 'prove' && em.verify.body.sent === true && TEXTS[TEXTS.length - 1].body.user.phone === '+61412345678', em.verify.body);
  var lmsg = msg.toLowerCase();
  check('and the answer names nothing of theirs: no name, no email, no venue, no digits of that mobile', lmsg.indexOf('sam') === -1 && lmsg.indexOf('jones') === -1 && lmsg.indexOf('grand') === -1 && lmsg.indexOf('678') === -1 && lmsg.indexOf('345') === -1, msg);
  var pv = await call('/start/verify', { start_id: em.id, code: lastCode() }, NET());
  check('the code from THAT mobile proves it, and then the details are pre-filled', pv.body.outcome === 'known' && pv.body.prefill && pv.body.prefill.email === 'sam@grandhotel.example', pv.body);
  check('nothing made yet', same(snapshot(), s4), snapshot());
  for (var q = 0; q < 5; q++) await start({ venue: 'Railway Hotel', postcode: '4350', mobile: '0499 111 4' + q + '0', email: 'sam@grandhotel.example' });
  var toVictim = TEXTS.slice(textsFrom).filter(function (t) { return t.body.user.phone === '+61412345678'; }).length;
  check('typing someone\'s email over and over never texts their mobile more than 3 times an hour', toVictim <= 3, toVictim);
  /* THE ATTACK (review, 5 Nov 2026): with that mobile's texts spent, a stranger types the known email with THEIR OWN
     mobile, passes their own code, then sends their own code again (verify, then join). Nothing of the login may come
     back and nothing may be attached. */
  // The email's own limit (3 starts an hour) is spent by the loop above; the attacker waits it out. The MOBILE's stays spent.
  Object.keys(HITS).forEach(function (k) { if (k.indexOf('start:e:') === 0) delete HITS[k]; });
  var fBefore = count('venueplay_founding'), vBefore = count('vp_venues');
  var atk = await start({ venue: 'Attack Arms', postcode: '4350', mobile: '0499 555 000', email: 'sam@grandhotel.example' });
  var atkCode = TEXTS.filter(function (t) { return t.body.user.phone === '+61499555000'; }).slice(-1)[0];
  atkCode = atkCode && atkCode.body.sms.otp;
  var atk2 = await call('/start/verify', { start_id: atk.id, code: atkCode }, NET());
  var atk3 = await call('/start/join', { start_id: atk.id, code: atkCode }, NET());
  var all = (JSON.stringify(atk.verify.body) + JSON.stringify(atk2.body) + JSON.stringify(atk3.body)).toLowerCase();
  check('ATTACK: the stranger\'s own code, sent again, never reveals the login (no pre-fill, no email, no name)', !atk2.body.prefill && all.indexOf('sam@') === -1 && all.indexOf('jones') === -1 && atk2.body.outcome !== 'known', [atk.verify.body, atk2.body]);
  check('ATTACK: and joining with it attaches nothing to that account', atk3.status !== 200 && count('venueplay_founding') === fBefore && count('vp_venues') === vBefore, atk3);
  var atkRow = DB.vp_signup_starts.filter(function (r) { return r.id === atk.id; })[0] || {};
  check('ATTACK: the row never says that login was proven', !(atkRow.known_login_id && atkRow.verified_at && atkRow.code_to !== 'known' && atkRow.outcome === 'pending'), atkRow);
  world(); listed();
  AUTH.push({ id: U(7777), email: 'nophone@venue.example', phone: '' });
  DB.vp_venue_staff.push({ venue_id: U(7778), auth_user_id: U(7777), role: 'manager' });
  DB.vp_venues.push({ id: U(7778), name: 'Somewhere Else', slug: 'somewhere-else', postcode: '2600', founding_id: U(7779) });
  var ce = await start({ venue: 'Railway Hotel', postcode: '4350', mobile: '0499 111 333', email: 'nophone@venue.example' });
  var cmsg = JSON.stringify(ce.verify.body);
  check('a known email with no mobile on its login: the existing one-tap sign-in email goes to it', ce.verify.body.outcome === 'check_email' && sent.some(function (m) { return (m.to || []).indexOf('nophone@venue.example') !== -1; }), [ce.verify.body, sent.map(function (m) { return m.to; })]);
  check('and the page names nothing of that login', cmsg.indexOf('Somewhere') === -1, cmsg);
  check('nothing made', count('venueplay_founding') === 0, count('venueplay_founding'));

  section('11. One free month per mobile, per email and per venue');
  world(); listed();
  DB.venueplay_founding.push({ id: U(8001), venue_name: 'Old Pub', contact_email: 'old@pub.example', mobile: '+61412999000', status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
  var pm = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 000', email: 'brand.new@pub.example' });
  check('a mobile already on an account (not a login): held for HQ, no free month', pm.verify.body.outcome === 'held' && count('venueplay_founding') === 1, pm.verify.body);
  var pe = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 001', email: 'old@pub.example' });
  check('an email already on an account: held for HQ, no free month', pe.verify.body.outcome === 'held' && count('venueplay_founding') === 1, pe.verify.body);
  var other = account({ name: 'Railway Hotel', postcode: '4350', email: 'gm@railway.example' });
  var pv2 = await start({ venue: 'The Railway Hotel', postcode: '4350', mobile: '0412 999 002', email: 'someone@else.example' });
  check('a venue on another account: Dean\'s item 60 words, a ticket, nothing made', pv2.verify.body.message === 'This venue is already set up with venueplay. We\'ve lodged a ticket on your behalf and we\'ll be in touch soon.' && count('venueplay_founding') === 2, pv2.verify.body);

  section('12. The billing guards (item 84): no sign-up path ever bills');
  world(); listed();
  await start({ venue: 'The Grand Hotel' });
  var kj = await start({ venue: 'Royal Hotel', postcode: '4000', email: 'sam.second@x.example' });
  await call('/start/join', { start_id: kj.id, code: lastCode() }, NET());
  await start({ venue: 'Nowhere Inn', mobile: '0412 222 333', email: 'n@w.example' });
  check('no game session was made by any sign-up path', count('vp_sessions') === 0, count('vp_sessions'));
  check('Stripe was never called (a prospect account has no subscription for Add a venue to change)', stripeCalls.length === 0, stripeCalls);
  check('every venue is at the 10 players it starts with, nothing pending, nothing extra', DB.vp_venues.every(function (x) { return x.max_players === 10 && !x.pending_players; }), DB.vp_venues.map(function (x) { return x.max_players; }));
  check('no busy-night or player-count audit row (no uplift)', !DB.vp_admin_audit.some(function (r) { return /players|overage|uplift|busy/.test(r.action || ''); }), DB.vp_admin_audit.map(function (r) { return r.action; }));
  /* A constant for the next job (item 82's demo). The Worker's constants live inside its own scope, so it is read
     as the line that declares it, the one place that number is set. */
  var cap = /\nconst VP_DEMO_JOINER_CAP = (\d+);/.exec(readFile('venueplay-backend/worker/venueplay-api-FULL.js'));
  check('the demo joiner cap is 10, one constant, for the try-it-now job', !!cap && cap[1] === '10', cap && cap[1]);
}

var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
