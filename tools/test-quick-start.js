/* "PLAY A QUICK GAME" (INBOX 412, 14 Nov 2026), RUN NOT WORD-SEARCHED: the three-box start (/quick/begin), the picker (/quick/venues),
   the placeholder login that is never mailed, "I'd like more info" (/quick/more-info), the card gate. Same rig as test-signup-core.js.
   Run from the repo root:  jsc tools/test-quick-start.js */
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

function lastCode() { return TEXTS.length ? TEXTS[TEXTS.length - 1].body.sms.otp : null; }
function listed() {
  DB.vp_licensed_venues = [
    { id: 1, name: 'The Grand Hotel', name_key: 'grand-hotel', postcode: '4217', suburb: 'Surfers Paradise', au_state: 'QLD', source: 'venue master list' },
    { id: 2, name: 'Royal Hotel', name_key: 'royal-hotel', postcode: '4000', suburb: 'Brisbane', au_state: 'QLD', source: 'send list' },
    { id: 3, name: 'Railway Hotel', name_key: 'railway-hotel', postcode: '4350', suburb: 'Toowoomba', au_state: 'QLD', source: 'send list' },
    { id: 4, name: 'Commercial Hotel', name_key: 'commercial-hotel', postcode: '2800', suburb: 'Orange', au_state: 'NSW', source: 'send list' } ];
}
var FIVE = { venue: 'the grand hotel', postcode: '4217', kind: 'pub', name: 'Sam Jones', mobile: '0412 345 678', email: 'sam@grandhotel.example' };
function five(o) { var b = {}; for (var k in FIVE) b[k] = FIVE[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
var IP = 0;
function NET() { return { 'cf-connecting-ip': '10.0.0.' + (++IP) }; }
async function start(o) {
  var r = await call('/start/begin', five(o), NET());
  if (r.status !== 200) return { begin: r };
  var v = await call('/start/verify', { start_id: r.body.start_id, code: lastCode(), kind: five(o).kind }, NET());
  return { begin: r, verify: v, id: r.body.start_id };
}
function count(t) { return (DB[t] || []).length; }
function snapshot() { return { f: count('venueplay_founding'), v: count('vp_venues'), auth: AUTH.length, s: count('vp_venue_staff'), p: count('vp_prospects') }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function qbegin(o) {
  var b = { name: 'Sam', mobile: '0412 345 678', venue: 'The Grand Hotel', postcode: '4217' };
  for (var k in (o || {})) b[k] = o[k];
  return await call('/quick/begin', b, NET());
}
async function qstart(o) {
  var r = await qbegin(o);
  if (r.status !== 200 || !r.body.start_id) return { begin: r };
  var v = await call('/start/verify', { start_id: r.body.start_id, code: lastCode() }, NET());
  return { begin: r, verify: v, id: r.body.start_id };
}
async function main() {
  section('1. Three boxes, no email, no pub-or-club');
  world(); listed();
  var s0 = snapshot();
  var a = await qbegin({ name: '  ' });
  check('a blank first name is refused at the name box', a.status === 400 && a.body.field === 'name', a);
  var b = await qbegin({ mobile: '07 5228 3667' });
  check('a landline is refused at the mobile box', b.status === 400 && b.body.field === 'mobile', b);
  var c = await qbegin({ venue: ' ' });
  check('a blank venue is refused at the venue box', c.status === 400 && c.body.field === 'venue', c);
  var hp = await qbegin({ website: 'http://spam.example' });
  check('the honeypot answers as if it worked, saves nothing, texts nothing', hp.status === 200 && count('vp_signup_starts') === 0 && TEXTS.length === 0, hp);
  ENV.TURNSTILE_SECRET = 'ts-secret';
  var bt = await qbegin({ turnstile: 'robot' });
  check('the bot check says no: refused, nothing saved, nothing texted', bt.status === 403 && bt.body.bot === true && count('vp_signup_starts') === 0 && TEXTS.length === 0, bt);
  delete ENV.TURNSTILE_SECRET;
  check('nothing was made by any refusal', same(snapshot(), s0), snapshot());
  var ok = await qbegin({});
  var row = DB.vp_signup_starts[0] || {};
  check('three boxes and a postcode from the picker start the text code', ok.status === 200 && TEXTS.length === 1 && /^\d{6}$/.test(lastCode()), ok);
  check('the row holds a placeholder login address, never a real one', /@phone\.venueplay\.com\.au$/.test(row.email || '') && row.entity_type === 'for_profit', row);
  check('only the first name is kept (a surname typed is cut)', (await (async function () { world(); listed(); await qbegin({ name: 'Sam Jones' }); return DB.vp_signup_starts[0].contact_name; })()) === 'Sam');

  section('2. The postcode: from the suburb, else asked for, never guessed');
  world(); listed();
  var sub = await qbegin({ postcode: '', suburb: 'Surfers Paradise' });
  check('a suburb on our list finds its one postcode', sub.status === 200 && sub.body.start_id && DB.vp_signup_starts[0].postcode === '4217', sub);
  world(); listed();
  var unk = await qbegin({ postcode: '', suburb: 'Nowhereville' });
  check('a suburb we do not know asks for the postcode and makes nothing', unk.status === 200 && unk.body.need_postcode === true && count('vp_signup_starts') === 0 && TEXTS.length === 0, unk);
  var none = await qbegin({ postcode: '', suburb: '' });
  check('no postcode and no suburb asks for the postcode', none.body.need_postcode === true, none);
  DB.vp_licensed_venues.push({ id: 9, name: 'Other Pub', name_key: 'other-pub', postcode: '4218', suburb: 'Surfers Paradise', au_state: 'QLD', source: 'send list' });
  var two = await qbegin({ postcode: '', suburb: 'Surfers Paradise' });
  check('a suburb with two postcodes is not guessed: the postcode is asked for', two.body.need_postcode === true, two);
  var bad4 = await qbegin({ postcode: '0100', suburb: '' });
  check('a postcode that is not a real Australian one is asked for again', bad4.body.need_postcode === true, bad4);

  section('3. The account: the same card-free prospect, signed in by the code, no email anywhere');
  world(); listed();
  var s = await qstart({});
  check('the code makes the account at once', s.verify && s.verify.status === 200 && s.verify.body.outcome === 'made' && !!s.verify.body.go_url, s.verify);
  var f = DB.venueplay_founding[0] || {}, p = DB.vp_prospects[0] || {}, v = DB.vp_venues[0] || {};
  check('10 players, a pub, the picked postcode', v.max_players === 10 && v.entity_type === 'for_profit' && v.postcode === '4217', v);
  check('the account email is EMPTY (every no-contact-email guard reads it as none)', f.contact_email === '', f);
  check('the prospect row has no email (reminders and nudges skip it)', p.email === null || p.email === undefined, p);
  check('the login has the placeholder address, flagged, with the confirmed mobile', AUTH.length === 1 && /@phone\.venueplay\.com\.au$/.test(AUTH[0].email) && AUTH[0].phone === '61412345678', AUTH);
  check('no welcome email was queued or sent, and no email at all went to a placeholder', count('vp_prospect_welcomes') === 0 && sent.filter(function (m) { return JSON.stringify(m).indexOf('phone.venueplay.com.au') !== -1; }).length === 0, sent);
  check('the account-ready TEXT may go but no ready EMAIL did', sent.filter(function (m) { return /Welcome to venueplay/.test(m.subject || ''); }).length === 0, sent.map(function (m) { return m.subject; }));
  var swp = await vpaProspectReminderSweep(ENV, Date.now() + 40 * 86400000);
  check('the card reminder sweep sends them nothing (no email to send to)', sent.filter(function (m) { return /free month|card/i.test(m.subject || ''); }).length === 0, [swp, sent.map(function (m) { return m.subject; })]);

  section('4. One free month per mobile still holds');
  var again = await qstart({ venue: 'Other Place' });
  check('the same mobile again is held for HQ, not given a second account', again.verify && again.verify.body.outcome === 'held' && count('venueplay_founding') === 1, again.verify);

  section('5. The network and mobile limits');
  world(); listed();
  var lim = [];
  for (var i = 0; i < 10; i++) lim.push((await call('/quick/begin', { name: 'A', mobile: '04' + (10000000 + i * 7919), venue: 'The Grand Hotel', postcode: '4217' }, { 'cf-connecting-ip': '9.9.9.9' })).status);
  check('one network is held to ' + 8 + ' starts an hour', lim.slice(0, 8).every(function (x) { return x === 200; }) && lim[8] === 429, lim);
  world(); listed();
  var mm = [];
  for (var j = 0; j < 4; j++) mm.push((await qbegin({})).status);
  check('one mobile is held to 3 codes an hour', mm[2] === 200 && mm[3] === 429, mm);

  section('6. The picker (our licensed list)');
  world(); listed();
  var g = await call('/quick/venues?q=grand', undefined, NET(), 'GET');
  check('a name finds the venue with its suburb and postcode', g.status === 200 && g.body.matches && g.body.matches[0] && g.body.matches[0].name === 'The Grand Hotel' && g.body.matches[0].postcode === '4217' && g.body.matches[0].suburb === 'Surfers Paradise', g);
  var keys = Object.keys((g.body.matches && g.body.matches[0]) || {}).sort().join(',');
  check('only name, suburb, postcode and state come back (no id, source, key)', keys === 'name,postcode,state,suburb', keys);
  var sh = await call('/quick/venues?q=gr', undefined, NET(), 'GET');
  check('two letters is not enough, and nothing is read', sh.body.matches.length === 0 && !!sh.body.why, sh);
  var the = await call('/quick/venues?q=the', undefined, NET(), 'GET');
  check('"the" alone finds nothing', the.body.matches.length === 0, the);
  for (var q = 0; q < 8; q++) DB.vp_licensed_venues.push({ id: 100 + q, name: 'Grand View ' + q, name_key: 'gv' + q, postcode: '4000', suburb: 'X', au_state: 'QLD', source: 'send list' });
  var many = await call('/quick/venues?q=grand', undefined, NET(), 'GET');
  check('at most five come back and "more", never a count', many.body.matches.length === 5 && many.body.more === true && JSON.stringify(many.body).indexOf('count') === -1, many);
  var lm = 0, last = null;
  for (var z = 0; z < 45; z++) { last = await call('/quick/venues?q=grand', undefined, { 'cf-connecting-ip': '8.8.8.8' }, 'GET'); if (last.status === 429) lm++; }
  check('one network is held to 40 searches a minute', lm >= 4, lm);

  section('7. "I\'d like more info": one sales ticket, nothing sent to them');
  world(); listed();
  var s2 = await qstart({});
  var vid = DB.vp_venues[0].id, owner = DB.vp_venue_staff[0].auth_user_id;
  var t0 = tickets().length, m0 = sent.length, tx0 = TEXTS.length;
  var mi = await call('/quick/more-info', { venue_id: vid, game: 'trivia' }, AS(owner));
  var tk = tickets()[tickets().length - 1] || {};
  check('one SALES ticket, with name, mobile, venue and the game played', mi.status === 200 && tickets().length === t0 + 1 && tk.category === 'sales' && /Sam/.test(tk.message) && /0412 345 678|0412345678|\+61412345678/.test(tk.message + tk.contact_phone) && /Grand Hotel/.test(tk.message) && /Game played: trivia/.test(tk.message), [mi, tk]);
  check('nothing was texted or emailed to the prospect (only the staff alert may go)', TEXTS.length === tx0 && sent.filter(function (m) { return (m.to || []).join(',') && /phone\.venueplay|sam@/.test(JSON.stringify(m.to)); }).length === 0, sent.slice(m0).map(function (m) { return m.to; }));
  var mi2 = await call('/quick/more-info', { venue_id: vid, game: 'trivia' }, AS(owner));
  check('a second tap is the same ticket', mi2.status === 200 && tickets().length === t0 + 1, mi2);
  var anon = await call('/quick/more-info', { venue_id: vid }, {});
  check('not signed in: refused', anon.status === 401, anon);
  var other = account({ name: 'Someone Else' });
  var steal = await call('/quick/more-info', { venue_id: vid }, AS(other.owner));
  check('another venue\'s owner cannot raise it', steal.status === 400 || steal.status === 403, steal);

  section('8. The card gate (one constant) and the email helpers');
  check('a placeholder is not a real email', vpqRealEmail('m412345678.ab12@phone.venueplay.com.au') === null && vpqRealEmail('') === null && vpqRealEmail('a@b.com.au') === 'a@b.com.au');
  check('with the gate off (the default) the card goes straight to Stripe', vpqCardGate('') === null);
  var W = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the gate is one constant (off), and the words say what to do when it is on', /const VPQ_CARD_NEEDS_REAL_EMAIL = false;/.test(W) && /Account details first/.test(W));
  check('the card page asks the gate before it opens Stripe', /vpqCardGate\(f\.contact_email\)/.test(W));
  print('');
  if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
}


var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
