/* ACCOUNT READY AFTER A SELF SIGN-UP, RUN AND NOT WORD-SEARCHED (Dean, 6 Nov 2026; customer journey problem 3).

   "Self sign-up: send BOTH the text and the email. Text wording must be clean and welcoming ... Email: Welcome to
   venueplay with one sign-in button." Runs the REAL billing Worker (tools/rig-billing-worker.js) through the real
   /start/begin and /start/verify against the rig's fake database, a fake Mobile Message and the rig's fake Resend.
   Nothing real is ever texted or emailed. Proves:
     1. a venue made straight away gets ONE text from the venueplay sender, in Dean's words, to the mobile that passed
        the code, and ONE "Welcome to venueplay" email with one sign-in button, the sender address and the TV code
     2. an unlisted (flagged) venue gets the same, once; a held sign-up (mobile or email already known) gets nothing
     3. never twice: the same code again, a second verify, an audit that will not answer
     4. a failed text or email never stops the done screen; no provider, an opted-out number: no text, the email still goes
     5. the venue's own typing cannot put a link in a text from our sender

   Run from the repo root:  jsc tools/test-account-ready.js */
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

/* The text provider (Mobile Message), faked: what our "venueplay" sender would have sent. */
var MM = [], MM_FAIL = false, AUDIT_DOWN = false;
var _prevFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('api.mobilemessage.com.au/v1/messages') !== -1) {
    var m = JSON.parse(opts.body).messages[0]; if (!MM_FAIL) MM.push(m);
    return Promise.resolve({ ok: !MM_FAIL, status: MM_FAIL ? 500 : 200, json: function () { return Promise.resolve(MM_FAIL ? {} : { results: [{ status: m.to === '+61499999999' ? 'blocked' : 'success', message_id: 'mm_' + MM.length }] }); } });
  }
  if (AUDIT_DOWN && method === 'GET' && u.indexOf('/rest/v1/vp_admin_audit?') !== -1 && u.indexOf('signup_ready_sent') !== -1) return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); } });
  return _prevFetch(url, opts);
};
function readyWorld() { world(); listed(); MM = []; MM_FAIL = false; AUDIT_DOWN = false; ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass'; ENV.RESEND_API_KEY = ENV.RESEND_API_KEY || 're_test_full'; }
function welcomes() { return sent.filter(function (m) { return m.subject === 'Welcome to venueplay'; }); }
function readyRows(vid) { return DB.vp_admin_audit.filter(function (a) { return a.action === 'signup_ready_sent' && (!vid || a.target === 'venue:' + vid); }); }
var DEAN_TEXT = /^Welcome to venueplay! Your account for (.+) is ready\. Sign in any time at venueplay\.com\.au\/app, we'll text a code to this mobile\.( We've emailed your login too, check junk\.)?$/;

async function main() {
  section('1. A venue made straight away: ONE text and ONE email');
  readyWorld();
  var a = await start({ venue: 'The Grand Hotel' });
  var v = DB.vp_venues.filter(function (x) { return x.name === 'The Grand Hotel'; })[0] || {};
  check('the account is made and the done screen is told both went', a.verify.status === 200 && a.verify.body.outcome === 'made' && a.verify.body.ready && a.verify.body.ready.texted === true && a.verify.body.ready.emailed === true, a.verify.body);
  var t = MM[0] || {};
  check('ONE text, to the mobile that passed the code, from the venueplay sender (the same sender as the code)', MM.length === 1 && t.to === '+61412345678' && t.sender === 'venueplay', MM);
  check('in Dean\'s words, word for word, with their venue, and (the email having gone first) that the login was emailed too, check junk',
    DEAN_TEXT.test(t.message || '') && DEAN_TEXT.exec(t.message)[1] === 'The Grand Hotel' && /We've emailed your login too, check junk\.$/.test(t.message), t.message);
  check('two SMS parts at most (306 characters), even with the longest venue name', (t.message || '').length <= 306 && vpsReadyText(new Array(90).join('W'), true).length <= 306, [(t.message || '').length, vpsReadyText(new Array(90).join('W'), true).length]);
  check('the text carries no link and no em dash', !/https?:|\/app\/go|#t=/.test(t.message || '') && !/[\u2014\u2013]/.test(t.message || ''), t.message);
  var w = welcomes();
  var h = String((w[0] || {}).html || '');
  check('ONE "Welcome to venueplay" email, to the email they typed, from hello@send.venueplay.com.au, replies to hello@', w.length === 1 && w[0].to[0] === 'sam@grandhotel.example' && /hello@send\.venueplay\.com\.au/.test(w[0].from) && w[0].reply_to === 'hello@venueplay.com.au', w);
  check('the email heading is "Welcome to venueplay", it greets them by first name and names the venue', /<h1[^>]*>Welcome to venueplay<\/h1>/.test(h) && /Hi Sam,/.test(h) && /account for The Grand Hotel is ready/.test(h), h.slice(0, 300));
  var buttons = h.match(/<a href="[^"]*" style="display:inline-block;background:#FF1F8E/g) || [];
  check('ONE sign-in button: the text-code sign-in with their mobile filled in, never a token in an email', buttons.length === 1 && h.indexOf('href="' + (ENV.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '') + '/app/?signin=sms#m=0412345678"') !== -1 && !/#t=/.test(h), buttons);
  check('it says which address our emails come from, so they look out for the next one', /Our emails come from <strong>hello@send\.venueplay\.com\.au<\/strong>/.test(h));
  check('the easy way back in: venueplay.com.au/go/{their screen code}, which sends a link to what is on the account', h.indexOf('Go to <strong>venueplay.com.au/go/' + v.join_code + '</strong> any time') !== -1, v.join_code);
  check('what to do first: sign in, the TV with their own screen code, a first night', /What to do first/.test(h) && h.indexOf('type your screen code: <strong>' + v.join_code + '</strong>') !== -1 && /musical bingo/.test(h), v.join_code);
  check('every merge field filled, no em dash, lowercase venueplay in the words', !/{{/.test(h) && !/[\u2014\u2013]/.test(h) && !/VenuePlay/.test(h.replace(/<[^>]+>/g, '')));
  check('a plain-text part goes with it', !!(w[0] || {}).text && /Welcome to venueplay/.test(w[0].text));
  var rr = readyRows(v.id);
  check('one audit row for the venue: texted and emailed, the last 3 digits only, never the mobile or a link', rr.length === 1 && rr[0].detail.texted === true && rr[0].detail.emailed === true && rr[0].detail.to_last3 === '678' &&
    JSON.stringify(rr[0]).indexOf('0412345678') === -1 && JSON.stringify(rr[0]).indexOf('412345678') === -1, rr);
  check('nothing billed: no Stripe call', stripeCalls.length === 0, stripeCalls);

  section('2. Never twice');
  var again = await call('/start/verify', { start_id: a.id, code: TEXTS[0].body.sms.otp }, NET());
  check('the same code again: done before, no second text, no second email', again.body.outcome === 'done_before' && MM.length === 1 && welcomes().length === 1, again.body);
  var r2 = await vpsAccountReady(ENV, DB.vp_signup_starts[0], v.id, { venue: v.name, tv_code: v.join_code });
  check('a second call for the same venue (a retry, a double tap that got past the claim): nothing sent', r2.texted === false && r2.emailed === false && MM.length === 1 && welcomes().length === 1 && readyRows(v.id).length === 1, r2);
  AUDIT_DOWN = true;
  var b = await start({ venue: 'Royal Hotel', postcode: '4000', mobile: '0412 000 101', email: 'gm@royal.example' });
  AUDIT_DOWN = false;
  check('the audit will not answer: the account is still made, but nothing is sent (it can not prove it is the first time)', b.verify.body.outcome === 'made' && b.verify.body.ready.texted === false && b.verify.body.ready.emailed === false && MM.length === 1, b.verify.body);

  section('3. Flagged and held sign-ups');
  readyWorld();
  var f = await start({ venue: 'Totally Made Up Tavern', mobile: '0412 000 001', email: 'fake@made.example' });
  check('an unlisted venue (made, flagged for HQ): the same text and email, once', f.verify.body.outcome === 'made' && MM.length === 1 && welcomes().length === 1 && DEAN_TEXT.exec(MM[0].message)[1] === 'Totally Made Up Tavern', [f.verify.body, MM]);
  account({ name: 'Old Pub', email: 'known@person.example' });
  var hd = await start({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 000 002', email: 'known@person.example' });
  check('a held sign-up (the email is already on venueplay): no account, no ready text, no ready email', hd.verify.body.outcome !== 'made' && MM.length === 1 && welcomes().length === 1, hd.verify.body);

  section('4. A failure never stops the done screen');
  readyWorld(); MM_FAIL = true;
  var mf = await start({ venue: 'The Grand Hotel' });
  check('the text provider is down: the account and done screen as normal, the email still goes, texted false', mf.verify.body.outcome === 'made' && !!mf.verify.body.tv_code && mf.verify.body.ready.texted === false && mf.verify.body.ready.emailed === true && welcomes().length === 1, mf.verify.body);
  readyWorld(); delete ENV.MOBILEMESSAGE_USERNAME; delete ENV.MOBILEMESSAGE_PASSWORD; delete ENV.CLICKSEND_USERNAME;
  var np = await start({ venue: 'The Grand Hotel' });
  check('no text provider on the Worker: no text tried, the email still goes', np.verify.body.outcome === 'made' && MM.length === 0 && np.verify.body.ready.texted === false && welcomes().length === 1, np.verify.body);
  readyWorld();
  DB.vp_admin_audit.push({ action: 'sms_opted_out', target: 'sms:+61412345678', created_at: '2026-11-01T00:00:00.000Z' });
  var oo = await start({ venue: 'The Grand Hotel' });
  check('a mobile that opted out of our texts: no text, the email still goes', oo.verify.body.outcome === 'made' && MM.length === 0 && welcomes().length === 1, [oo.verify.body, MM]);
  readyWorld(); var rk = ENV.RESEND_API_KEY; delete ENV.RESEND_API_KEY;
  var ne = await start({ venue: 'The Grand Hotel' });
  ENV.RESEND_API_KEY = rk;
  check('no email key: the text still goes, emailed false, and it does NOT say it was emailed', ne.verify.body.outcome === 'made' && MM.length === 1 && ne.verify.body.ready.emailed === false && !/emailed/.test(MM[0].message), [ne.verify.body, MM[0] && MM[0].message]);

  section('5. Their typing cannot put a link in our text');
  check('a venue "name" with a link in it reaches the text without the link', DEAN_TEXT.exec(vpsReadyText('Visit www.evil.example/pay now'))[1].indexOf('.') === -1 && vpsReadyText('Visit http://x.example').indexOf('://') === -1, vpsReadyText('Visit www.evil.example/pay now'));
  check('an apostrophe and an ampersand survive (O\'Malley\'s Bar & Grill)', DEAN_TEXT.exec(vpsReadyText("O'Malley's Bar & Grill"))[1] === "O'Malley's Bar & Grill");
  check('a long name is cut at 50 characters; a name of only symbols reads "your venue"', DEAN_TEXT.exec(vpsReadyText(new Array(80).join('A')))[1].length === 50 && DEAN_TEXT.exec(vpsReadyText('<<>>'))[1] === 'your venue');
  var esc = await vpsRenderReady(ENV, { venueName: '<b>Hack</b> Hotel', contactName: '<i>Sam</i>', mobileWords: '0412 345 678', tvCode: 'TV0001', email: 'a@b.example' });
  check('the email escapes what they typed (venue and name)', esc.html.indexOf('<b>Hack</b>') === -1 && esc.html.indexOf('&lt;b&gt;Hack') !== -1 && esc.html.indexOf('<i>Sam</i>') === -1);

  print('');
  if (bad) { print(bad + ' of ' + ran + ' checks FAILED'); throw new Error('account ready: ' + bad + ' failed'); } else print('ALL ' + ran + ' CHECKS PASSED');
}

var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
