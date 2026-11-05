/* THE SIGN-UP CORE, RUN AND NOT WORD-SEARCHED (Dean, 5 Nov 2026; INBOX 80B, 81, 84, as changed by 97).

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router against the rig's fake
   database, fake Stripe and fake Resend:
     1. the parked work (the same pub across accounts, item 60; the known-person prefill, item 61) is NOT here:
        Add a venue and the card sign-up behave exactly as on main, and /start/join does not exist;
     5 to 12. the no-card start (/start/begin, verify, resend), the licensed list (171), HQ's one-tap approve, one free
        month per mobile and per email, the network limit, and the billing guards (item 84).

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
var TEXTS = [], AUTH = [], JOINS = 0, HITS = {}, AUTH_CAP = 0;
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
    /* Paged as Auth pages it (page from 1, per_page): a fake that answers every page with everyone never ends. */
    var pg = /[?&]page=(\d+)/.exec(u), pp = /[?&]per_page=(\d+)/.exec(u);
    var per = pp ? +pp[1] : 50, from = ((pg ? +pg[1] : 1) - 1) * per;
    /* AUTH_CAP: an Auth whose own maximum page sits below the size asked for, so EVERY page is short. */
    var give = AUTH_CAP ? Math.min(per, AUTH_CAP) : per; from = ((pg ? +pg[1] : 1) - 1) * give;
    return RS(200, { users: AUTH.slice(from, from + give) });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '61000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9001), ACCTS = U(9002), STAFFADMIN = U(9003);
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; TEXTS = []; AUTH = []; AUTH_CAP = 0;
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
  section('1. The parked work is not on this branch (INBOX 97: items 60 and 61 moved to fix/same-pub-later)');
  world();
  account({ name: 'Royal Hotel', postcode: '4000', email: 'gm@royal.example' });
  var mine = account({ name: 'Bat and Ball', postcode: '2000', email: 'sam@batandball.example' });
  var r = await call('/account/add-venue', { name: 'The Royal Hotel', postcode: '4000', players: 10 }, AS(mine.owner));
  check('Add a venue: a pub with the same name on another account is added as on main (no cross-account check here)', r.status === 200 && r.body.ok === true, r);
  check('and no ticket was made', tickets().length === 0, tickets());
  world();
  account({ name: 'Olim\'s Canberra Hotel', postcode: '2612', email: 'events@olims.example' });
  var c1 = await call('/checkout', { email: 'new@person.example', name: 'Pat', mobile: '0400 000 111', compliance_accepted: true,
    venues: [{ name: 'Olims Canberra Hotel', seats: 30, postcode: '2612' }] });
  check('the card sign-up goes on to the card step as on main', c1.status === 200 && stripeCalls.length > 0, c1);
  var jn = await call('/start/join', { start_id: U(1), code: '123456' }, NET());
  check('there is no /start/join (the known-person join is parked)', jn.status === 404 || !jn.body.ok, jn);
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('none of the parked functions is in the Worker', ['vpaSameVenueElsewhere', 'vpaSameVenueTicket', 'vpsStartJoin', 'vpsProvenLogin', 'vpbOwnerFor', 'vpbAddVenueFor', 'known_login_id'].every(function (n) { return src.indexOf(n) === -1; }),
    ['vpaSameVenueElsewhere', 'vpaSameVenueTicket', 'vpsStartJoin', 'vpsProvenLogin', 'vpbOwnerFor', 'vpbAddVenueFor', 'known_login_id'].filter(function (n) { return src.indexOf(n) !== -1; }));

  if (typeof moreSections === 'function') await moreSections();

  print('');
  if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
}

/* ======================= THE NO-CARD START (/start, INBOX 80B, 81, 84, 97) ======================= */
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

  section('9. A KNOWN PERSON RE-TRYING WITH A NEW EMAIL: held for HQ, no second free month, nothing of theirs shown');
  var s3 = snapshot(), tk3 = tickets().length;
  var kn = await start({ venue: 'Royal Hotel', postcode: '4000', email: 'sam.new@another.example' });
  check('their mobile (proven by its code) already signs in: held, with the same words as an unlisted venue', kn.verify.status === 200 && kn.verify.body.outcome === 'held' && kn.verify.body.message === 'Thanks, we\'ll check your venue and get you set up, usually within a business day.', kn.verify.body);
  check('no second account, no second login, no second free month', same(snapshot(), s3), snapshot());
  var knMsg = JSON.stringify(kn.verify.body).toLowerCase();
  check('the answer names nothing of theirs (no login email, no venue, no name)', knMsg.indexOf('grandhotel') === -1 && knMsg.indexOf('grand') === -1 && knMsg.indexOf('jones') === -1 && !kn.verify.body.prefill, knMsg);
  check('word for word the same answer an unlisted venue gets (nothing tells a known person apart)', JSON.stringify(kn.verify.body) === JSON.stringify(fk.verify.body), [kn.verify.body, fk.verify.body]);
  var kt = tickets().slice(tk3)[0] || {};
  check('one HQ ticket saying why: the mobile already signs in', tickets().length === tk3 + 1 && /mobile already signs in/.test(kt.message || '') && /one free month per mobile and per email/.test(kt.message || ''), kt.message);
  check('the sign-up waits as held_known', DB.vp_signup_starts.filter(function (r) { return r.id === kn.id; })[0].outcome === 'held_known');

  section('10. An email we know, typed with another mobile: held, nothing shown, nothing texted to anyone else');
  HITS = {};   // an hour later
  var s4 = snapshot(), textsFrom = TEXTS.length;
  var em = await start({ venue: 'Railway Hotel', postcode: '4350', mobile: '0499 111 222', email: 'sam@grandhotel.example' });
  var emMsg = JSON.stringify(em.verify.body).toLowerCase();
  check('held with the unlisted words', em.verify.body.outcome === 'held' && em.verify.body.message === 'Thanks, we\'ll check your venue and get you set up, usually within a business day.', em.verify.body);
  check('the only text went to the mobile they typed, never to the login\'s own', TEXTS.slice(textsFrom).every(function (t) { return t.body.user.phone === '+61499111222'; }), TEXTS.slice(textsFrom).map(function (t) { return t.body.user.phone; }));
  check('the answer names nothing of that login', emMsg.indexOf('sam') === -1 && emMsg.indexOf('678') === -1 && emMsg.indexOf('grand') === -1, emMsg);
  check('nothing made', same(snapshot(), s4), snapshot());

  section('11. One free month per mobile and per email (sbPriorAccounts), a double tap, and a database that will not answer');
  world(); listed();
  DB.venueplay_founding.push({ id: U(8001), venue_name: 'Old Pub', contact_email: 'old@pub.example', mobile: '0412 999 000', status: 'cancelled', created_at: '2026-01-01T00:00:00.000Z' });
  var pm = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412999000', email: 'brand.new@pub.example' });
  check('a mobile on an account row (typed with spaces on the card sign-up, and cancelled since): held, no free month', pm.verify.body.outcome === 'held' && count('venueplay_founding') === 1, pm.verify.body);
  DB.venueplay_founding.push({ id: U(8002), venue_name: 'Older Pub', contact_email: 'plus@pub.example', mobile: '+61412999111', status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
  var pp = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 111', email: 'another.new@pub.example' });
  check('a mobile kept as +61 on an account: held', pp.verify.body.outcome === 'held' && count('venueplay_founding') === 2, pp.verify.body);
  var pe = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 001', email: 'OLD@pub.example' });
  check('an email already on an account (any case): held, no free month', pe.verify.body.outcome === 'held' && count('venueplay_founding') === 2, pe.verify.body);
  var tw = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 002', email: 'twice@pub.example' });
  var tw2 = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 999 003', email: 'twice@pub.example' });
  check('the first start with a new email and mobile makes the account', tw.verify.body.outcome === 'made', tw.verify.body);
  check('the same email again with another mobile: held, no second free month', tw2.verify.body.outcome === 'held' && count('venueplay_founding') === 3, tw2.verify.body);
  var tw3 = await start({ venue: 'Grand Hotel', postcode: '4217', mobile: '0412 999 002', email: 'third@pub.example' });
  check('the same mobile again with another email: held', tw3.verify.body.outcome === 'held' && count('venueplay_founding') === 3, tw3.verify.body);
  for (var ac = 0; ac < 5; ac++) AUTH.push({ id: U(6100 + ac), email: 'filler' + ac + '@x.example', phone: '6140000000' + ac });
  AUTH.push({ id: U(6200), email: 'deep@x.example', phone: '61412888000' });
  AUTH_CAP = 3;   // Auth hands back 3 a page whatever is asked: the login is on page 2, behind a short page 1
  var deep = await start({ venue: 'Grand Hotel', postcode: '4217', mobile: '0412 888 000', email: 'deep.new@x.example' });
  AUTH_CAP = 0;
  check('a login past a SHORT first page of logins is still found: held, no free month', deep.verify.body.outcome === 'held' && count('venueplay_founding') === 3, deep.verify.body);
  var s5 = snapshot();
  var db1 = await call('/start/begin', five({ mobile: '0412 777 001', email: 'dbl@pub.example' }), NET());
  var dcode = lastCode();
  var p1 = call('/start/verify', { start_id: db1.body.start_id, code: dcode }, NET());
  var p2 = call('/start/verify', { start_id: db1.body.start_id, code: dcode }, NET());
  var both = [await p1, await p2];
  check('a double tap on the code makes ONE account', snapshot().f === s5.f + 1 && both.filter(function (x) { return x.body.outcome === 'made'; }).length === 1, both.map(function (x) { return x.body.outcome; }));
  var tkd = tickets().length;
  var h1 = await call('/start/begin', five({ venue: 'Nowhere Arms', mobile: '0412 777 002', email: 'dblh@pub.example' }), NET());
  var hcode = lastCode();
  var hp1 = call('/start/verify', { start_id: h1.body.start_id, code: hcode }, NET());
  var hp2 = call('/start/verify', { start_id: h1.body.start_id, code: hcode }, NET());
  await hp1; await hp2;
  check('a double tap on a held sign-up files ONE ticket', tickets().length === tkd + 1, tickets().length - tkd);
  var s6 = snapshot();
  FAIL['auth:GET'] = 1;
  var fa = await start({ venue: 'Grand Hotel', mobile: '0412 777 003', email: 'fa@pub.example' });
  check('the login list will not answer: nothing made, try again (fails closed)', fa.verify.status === 503 && same(snapshot(), s6), fa.verify);
  FAIL['venueplay_founding:GET'] = 1;
  var fb = await start({ venue: 'Grand Hotel', mobile: '0412 777 004', email: 'fb@pub.example' });
  check('the account list will not answer: nothing made (sbPriorAccounts strict)', fb.verify.status === 503 && same(snapshot(), s6), fb.verify);
  FAIL['vp_licensed_venues:GET'] = 1;
  var fc = await start({ venue: 'Grand Hotel', mobile: '0412 777 005', email: 'fc@pub.example' });
  check('the licensed list will not answer: held for HQ, never made', fc.verify.body.outcome === 'held' && same(snapshot(), s6), fc.verify.body);

  section('11b. The network limit and the email box');
  world(); listed();
  var ipb = { 'cf-connecting-ip': '10.9.9.9' }, lim = [];
  for (var li = 0; li < 9; li++) lim.push((await call('/start/begin', five({ mobile: '0412 600 0' + (10 + li), email: 'n' + li + '@lim.example' }), ipb)).status);
  check('eight code requests an hour from one network, then refused', lim.slice(0, 8).every(function (x) { return x === 200; }) && lim[8] === 429, lim);
  var bad1 = await call('/start/begin', five({ email: 'a,b@x.example' }), NET());
  check('an email with a comma is refused (it is read back inside a database filter)', bad1.status === 400 && bad1.body.field === 'email', bad1);

  section('12. The billing guards (item 84): no sign-up path ever bills');
  world(); listed();
  await start({ venue: 'The Grand Hotel' });
  await start({ venue: 'Royal Hotel', postcode: '4000', email: 'sam.second@x.example' });
  var un = await start({ venue: 'Nowhere Inn', mobile: '0412 222 333', email: 'n@w.example' });
  await call('/admin/signup-start/decide', { start_id: un.id, decision: 'approve' }, AS(ADMIN));
  check('three paths ran: made, held for a known mobile, held then approved by HQ', count('venueplay_founding') === 2, count('venueplay_founding'));
  check('no game session was made by any sign-up path', count('vp_sessions') === 0, count('vp_sessions'));
  check('Stripe was never called: no customer, no subscription, no invoice item', stripeCalls.length === 0, stripeCalls);
  check('every account has no Stripe ids', DB.venueplay_founding.every(function (f) { return !f.stripe_customer_id && !f.stripe_subscription_id; }), DB.venueplay_founding);
  check('every venue is at the 10 players it starts with, nothing pending, nothing extra', DB.vp_venues.every(function (x) { return x.max_players === 10 && !x.pending_players; }), DB.vp_venues.map(function (x) { return x.max_players; }));
  check('every account is at 10 seats', DB.venueplay_founding.every(function (f) { return f.max_seats === 10; }), DB.venueplay_founding.map(function (f) { return f.max_seats; }));
  check('no busy-night or player-count audit row (no uplift)', !DB.vp_admin_audit.some(function (r) { return /players|overage|uplift|busy|extra/.test(r.action || ''); }), DB.vp_admin_audit.map(function (r) { return r.action; }));
  check('the free month has not started on any of them (it starts at the first sign-in)', DB.vp_prospects.every(function (p) { return !p.first_signin_at && !p.free_month_started_at; }) && DB.venueplay_founding.every(function (f) { return !f.trial_ends_at && !f.free_until; }), DB.vp_prospects);
  /* A constant for the next job (item 82's demo). The Worker's constants live inside its own scope, so it is read
     as the line that declares it, the one place that number is set. */
  var cap = /\nconst VP_DEMO_JOINER_CAP = (\d+);/.exec(readFile('venueplay-backend/worker/venueplay-api-FULL.js'));
  check('the demo joiner cap is 10, one constant, for the try-it-now job', !!cap && cap[1] === '10', cap && cap[1]);
}

var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
