/* HQ > PROSPECTS, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026; migration 125).

   "Can we please put the prospects into HQ as a tab somewhere? ... if they haven't signed up they're not
   gonna sign up on the active list are they? And maybe we should have something that is like a follow-up
   ... if they haven't accessed it within ... three days it flags the venue ... so then we can actually give
   the person a call ... if it does have a phone number. We need to add that at the point of setup also."

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router and the REAL HQ files:
     1. the phone at setup: HQ's and the autopilot's, a mobile or a landline, spaced as said; a bad one
        refused with nothing made; none falls back to the mobile; neither is fine. A crowd of 10 by default.
     2. POST /admin/prospects: owner or accounts only; a venue's login and a staff admin get nothing
     3. the flags: no sign-in 3 days after setup is "Call them" (not at 2 days 23 hours), they asked for a
        call is "Call requested" and comes first; a sign-in clears it; a sign-in that cannot be read is
        never "never"; Called with a note stops it, Undo brings it back, each audited
     4. a prospect who signs up (a card, comp, invoiced, grouped) leaves the list by itself; archived too
     5. without migration 125: setup still works and says so; the list says "Run migration 125"
     6. the HQ pane (venueplay/app/vp-prospects-hq.js): tap to call, "No phone, email them", the website,
        the source, the flags, escaped names; and hq.html's own Venues filter leaves prospects out

   Run from the repo root:  jsc tools/test-prospects-tab.js */
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

(async function () {
  section('1. A phone at setup, and a crowd of 10 unless somebody says otherwise');
  world();
  var r = await setUp({ name: 'Landline Hotel', phone: '02 9876 5432', website: 'landline.example', send_welcome: false });
  var p = row('Landline Hotel') || {}, v = DB.vp_venues[0] || {}, f = DB.venueplay_founding[0] || {};
  check('HQ sets one up with a landline: a prospect row, the number spaced as it is said, source HQ, its website, the contact\'s name and email',
    r.status === 200 && p.phone === '(02) 9876 5432' && p.source === 'hq' && p.website === 'https://landline.example' && p.contact_name === 'Sam' && p.email === 'sam@testcharlie.example' && p.call_requested === false && p.founding_id === f.id, [r.body, p]);
  check('the reply and the audit row carry the phone too (the audit row is where it survives without migration 125)',
    r.body.phone === '(02) 9876 5432' && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_set_up' && a.detail.phone === '(02) 9876 5432'; }), r.body);
  check('no crowd given: the plan is set on 10 players, never a guessed 60 (Dean, 29 Oct 2026: a bigger number overcharges them)',
    v.max_players === 10 && f.max_seats === 10, [v.max_players, f.max_seats]);
  r = await setUp({ name: 'Plus61 Tavern', phone: '+61 7 5228 3667', send_welcome: false });
  check('+61 and any spacing: (07) 5228 3667', r.status === 200 && (row('Plus61 Tavern') || {}).phone === '(07) 5228 3667', row('Plus61 Tavern'));
  r = await setUp({ name: 'Mobile Only Inn', mobile: '0432071622', send_welcome: false });
  check('no phone typed but a mobile: the mobile is the number to ring, spaced 0432 071 622', r.status === 200 && (row('Mobile Only Inn') || {}).phone === '0432 071 622', row('Mobile Only Inn'));
  r = await setUp({ name: 'Nothing Given Arms', send_welcome: false });
  check('no phone and no mobile is fine: set up, phone left empty', r.status === 200 && (row('Nothing Given Arms') || {}).phone === null, row('Nothing Given Arms'));
  var before = JSON.stringify([DB.vp_venues.length, DB.venueplay_founding.length, DB.vp_prospects.length, AUTH.length]);
  var badOnes = ['12345', '1300 123 456', '0912 345 678', 'call me maybe', '02 9876 543'];
  var refused = [];
  for (var i = 0; i < badOnes.length; i++) refused.push(await setUp({ name: 'Bad Phone ' + i, phone: badOnes[i] }));
  check('a phone that is not an Australian mobile or landline (too short, a 1300 line, 09, words): refused, NOTHING made',
    refused.every(function (x) { return x.status === 400 && /does not look like an Australian number/.test(x.body.error) && /Nothing was created/.test(x.body.error); }) &&
    JSON.stringify([DB.vp_venues.length, DB.venueplay_founding.length, DB.vp_prospects.length, AUTH.length]) === before, refused.map(function (x) { return x.status + ' ' + x.body.error; }));
  r = await call('/admin/prospect', with_({ name: 'Dry Phone Hotel', phone: '0298765432', dry_run: true }), AS(ADMIN));
  check('a dry run says which phone it would keep, and makes nothing', r.status === 200 && r.body.dry_run === true && r.body.phone === '(02) 9876 5432' && !row('Dry Phone Hotel'), r.body);
  r = await setUp({ name: 'Autopilot Crows Nest', email: 'sam@lmc.example', phone: '0432 071 622', call_requested: true, website: 'https://lmc.example/' }, true);
  p = row('Autopilot Crows Nest') || {};
  check('the autopilot sets one up with their number and their call request: source autopilot, call_requested, website kept',
    r.status === 200 && p.source === 'autopilot' && p.phone === '0432 071 622' && p.call_requested === true && p.website === 'https://lmc.example/', p);
  r = await setUp({ name: 'Mobile Login Hotel', email: 'ml@ml.example', mobile: '0400 222 333' });
  var ml = DB.vp_venues.filter(function (x) { return x.name === 'Mobile Login Hotel'; })[0] || {};
  check('a prospect whose login has their mobile gets the text-code welcome and NO one-click sign-in link at all',
    r.status === 200 && r.body.login && r.body.login.mobile && DB.vp_signin_links.filter(function (x) { return x.venue_id === ml.id; }).length === 0 &&
    sent.some(function (m) { return /\/app\/\?signin=sms#m=0400222333/.test(m.html) && m.html.indexOf('/app/go#') === -1; }), [r.body.login, DB.vp_signin_links.length]);

  section('1b. A prospect who already runs another VenuePlay venue on the same login');
  var OLD = { id: U(700), email: 'owner@twovenues.example', phone: '61400999888' }; AUTH.push(OLD);
  var OLDV = { id: U(701), name: 'Their First Venue', slug: 'their-first-venue', founding_id: U(702), postcode: '4000', au_state: 'QLD' };
  DB.vp_venues.push(OLDV); DB.venueplay_founding.push({ id: U(702), status: 'card_on_file', stripe_subscription_id: 'sub_old' });
  DB.vp_venue_staff.push({ venue_id: OLDV.id, auth_user_id: OLD.id, role: 'owner' });
  var authBefore = AUTH.length, sentBefore = sent.length;
  r = await setUp({ name: 'Their Second Venue', email: 'Owner@TwoVenues.example', mobile: '0400 999 888' });
  var sv = DB.vp_venues.filter(function (x) { return x.name === 'Their Second Venue'; })[0] || {};
  var svStaff = DB.vp_venue_staff.filter(function (x) { return x.venue_id === sv.id; });
  check('the email AND the mobile are both on one existing login: that login is reused (no new login), as the new venue\'s manager',
    r.status === 200 && AUTH.length === authBefore && svStaff.length === 1 && svStaff[0].auth_user_id === OLD.id && svStaff[0].role === 'manager' && r.body.login && r.body.login.existing === true, [r.body, svStaff]);
  check('so "Choose another venue" lists both: the login has a staff row at each', DB.vp_venue_staff.filter(function (x) { return x.auth_user_id === OLD.id; }).map(function (x) { return x.venue_id; }).sort().join() === [OLDV.id, sv.id].sort().join());
  check('the two venues stay separate accounts: a NEW account record for the new venue, the old one untouched', sv.founding_id && sv.founding_id !== OLDV.founding_id &&
    DB.venueplay_founding.filter(function (f) { return f.id === U(702); })[0].stripe_subscription_id === 'sub_old' && !DB.venueplay_founding.filter(function (f) { return f.id === sv.founding_id; })[0].stripe_subscription_id, sv);
  var svMail = sent.slice(sentBefore).filter(function (m) { return m.to && m.to[0] === 'owner@twovenues.example'; })[0] || {};
  check('their welcome: sign in with the mobile they already use (text code), and Choose another venue switches between them; no one-click link',
    /\/app\/\?signin=sms#m=0400999888/.test(svMail.html || '') && /You already sign in to VenuePlay with this mobile, so Their Second Venue is on the same login\. Once you're in, tap Choose another venue to switch between your venues\. Each venue keeps its own account and billing\./.test(svMail.text || '') &&
    (svMail.html || '').indexOf('/app/go#') === -1, svMail.text);
  check('audited as a reused login', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_set_up' && a.target === 'venue:' + sv.id && a.detail.login_reused === true; }));
  r = await setUp({ name: 'Email Only Match', email: 'owner@twovenues.example', mobile: '0400 111 000', send_welcome: false });
  check('the email matches but the mobile does not: refused as before, nothing made', r.status === 409 && /already has a VenuePlay login/.test(r.body.error) && !DB.vp_venues.some(function (x) { return x.name === 'Email Only Match'; }), r.body);
  authBefore = AUTH.length;
  r = await setUp({ name: 'Mobile Only Match', email: 'someone.new@else.example', mobile: '0400 999 888', send_welcome: false });
  var mm = DB.vp_venues.filter(function (x) { return x.name === 'Mobile Only Match'; })[0] || {};
  check('the mobile matches but the email does not: a NEW email-only login, the existing one never given this venue', r.status === 200 && AUTH.length === authBefore + 1 &&
    !DB.vp_venue_staff.some(function (x) { return x.venue_id === mm.id && x.auth_user_id === OLD.id; }) && (r.body.warnings || []).some(function (w) { return /mobile already has a VenuePlay login/.test(w); }), r.body);
  DB.vp_venues = DB.vp_venues.filter(function (x) { return x.id !== OLDV.id; });

  section('2. POST /admin/prospects is HQ\'s: owner and accounts only');
  var lr = await list(ADMIN), la = await list(ACCTS), ls = await list(STAFF), lv = await list(U(77)), ln = await call('/admin/prospects', {}, {});
  check('the owner and an accounts admin get the list', lr.status === 200 && lr.body.ok === true && la.status === 200 && (la.body.prospects || []).length === lr.body.prospects.length, [lr.status, la.status]);
  check('a staff admin, a venue\'s own login and nobody signed in get nothing', ls.status === 403 && lv.status === 403 && ln.status === 401 && !ls.body.prospects && !lv.body.prospects && !ln.body.prospects, [ls.status, lv.status, ln.status]);
  check('the threshold comes from the Worker\'s one constant, 3 days', lr.body.follow_up_days === 3 && /const VPA_PROSPECT_FOLLOWUP_DAYS = 3;/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')), lr.body.follow_up_days);
  var lp = find(lr, 'Landline Hotel') || {};
  check('each row: name, contact, email, the phone and a tel: link to tap, set up, source, website, welcome, last sign-in',
    lp.contact_name === 'Sam' && lp.email === 'sam@testcharlie.example' && lp.phone === '(02) 9876 5432' && lp.tel === 'tel:0298765432' && lp.source === 'hq' &&
    lp.website === 'https://landline.example' && !!lp.created_at && lp.days_since_setup === 0 && lp.last_sign_in_at === null && lp.sign_in_known === true && 'welcome' in lp, lp);
  check('no phone: phone and tel are empty, so HQ says to email them', (find(lr, 'Nothing Given Arms') || {}).phone === null && (find(lr, 'Nothing Given Arms') || {}).tel === null);

  section('3. The follow-up flags');
  check('set up today, nobody signed in: not flagged yet', lp.flag === null && lp.follow_up === false, lp);
  age('Landline Hotel', 3 * DAY - 3600000);
  check('2 days 23 hours: still not flagged', (find(await list(), 'Landline Hotel') || {}).flag === null);
  age('Landline Hotel', 3 * DAY + 60000);
  var l3 = await list(), f3 = find(l3, 'Landline Hotel') || {};
  check('3 days with no sign-in: flagged "no_sign_in" (Call them), counted on the tab', f3.flag === 'no_sign_in' && f3.follow_up === true && f3.days_since_setup === 3 && l3.body.follow_up_count >= 2, [f3, l3.body.follow_up_count]);
  var cr = find(l3, 'Autopilot Crows Nest') || {};
  check('they asked for a call: flagged "call_requested" from the first minute, with their number', cr.flag === 'call_requested' && cr.phone === '0432 071 622', cr);
  check('call requested comes first, then the 3-day ones', l3.body.prospects[0].flag === 'call_requested' && l3.body.prospects[1].flag === 'no_sign_in', l3.body.prospects.map(function (x) { return x.flag; }));
  age('Autopilot Crows Nest', 5 * DAY);
  check('asked for a call AND 5 days with no sign-in: the one flag shown is Call requested', (find(await list(), 'Autopilot Crows Nest') || {}).flag === 'call_requested');
  var lh = DB.vp_venues.filter(function (x) { return x.name === 'Landline Hotel'; })[0];
  var lhStaff = DB.vp_venue_staff.filter(function (x) { return x.venue_id === lh.id; })[0];
  var lhUser = AUTH.filter(function (u) { return u.id === lhStaff.auth_user_id; })[0];
  lhUser.last_sign_in_at = new Date(Date.now() - DAY).toISOString();
  var fs = find(await list(), 'Landline Hotel') || {};
  check('somebody at the venue has signed in: the flag goes, the time is shown', fs.flag === null && fs.last_sign_in_at === lhUser.last_sign_in_at, fs);
  delete lhUser.last_sign_in_at;
  var another = { id: U(600), email: 'host@x.example', phone: '', last_sign_in_at: new Date().toISOString() }; AUTH.push(another);
  DB.vp_venue_staff.push({ venue_id: lh.id, auth_user_id: another.id, role: 'host' });
  check('a host they added signing in counts too', (find(await list(), 'Landline Hotel') || {}).flag === null);
  DB.vp_venue_staff = DB.vp_venue_staff.filter(function (x) { return x.auth_user_id !== another.id; });
  AUTH = AUTH.filter(function (u) { return u.id !== lhUser.id; });
  var fu = find(await list(), 'Landline Hotel') || {};
  check('Auth cannot answer for their login: "could not check", never "never", and not flagged on a guess', fu.sign_in_known === false && fu.last_sign_in_at === null && fu.flag === null, fu);
  AUTH.push(lhUser);

  section('3b. Called, with a note, stops the flag; Undo brings it back');
  r = await call('/admin/prospect/called', { venue_id: lh.id, note: 'Spoke to Sam, trying it Friday' }, AS(ACCTS));
  var after = find(await list(), 'Landline Hotel') || {};
  check('marked Called: saved with the note and who, the flag is gone, the count drops', r.status === 200 && after.flag === null && after.called && after.called.note === 'Spoke to Sam, trying it Friday' && after.called.by === 'Accounts', [r.body, after]);
  check('audited as prospect_called, with the note', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_called' && a.target === 'venue:' + lh.id && a.detail.note === 'Spoke to Sam, trying it Friday'; }));
  var crv = DB.vp_venues.filter(function (x) { return x.name === 'Autopilot Crows Nest'; })[0];
  await call('/admin/prospect/called', { venue_id: crv.id }, AS(ADMIN));
  check('Called with no note stops a Call requested too', (find(await list(), 'Autopilot Crows Nest') || {}).flag === null);
  r = await call('/admin/prospect/called', { venue_id: lh.id, undo: true }, AS(ADMIN));
  check('Undo: the mark is gone and the 3-day flag is back, audited', r.status === 200 && (find(await list(), 'Landline Hotel') || {}).flag === 'no_sign_in' && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_call_undone'; }));
  var long = await call('/admin/prospect/called', { venue_id: lh.id, note: new Array(502).join('x') }, AS(ADMIN));
  var nope = await call('/admin/prospect/called', { venue_id: U(4040) }, AS(ADMIN));
  var staffTry = await call('/admin/prospect/called', { venue_id: lh.id }, AS(STAFF));
  check('a note over 500 characters, a venue that is not a prospect, and a staff admin are refused, nothing changed',
    long.status === 400 && nope.status === 404 && staffTry.status === 403 && (find(await list(), 'Landline Hotel') || {}).flag === 'no_sign_in', [long.status, nope.status, staffTry.status]);

  section('4. Signing up takes them off the list, by itself');
  var n0 = (await list()).body.prospects.length;
  var lf = DB.venueplay_founding.filter(function (x) { return x.id === lh.founding_id; })[0];
  lf.stripe_subscription_id = 'sub_test_1'; lf.status = 'card_on_file';
  var l4 = await list();
  check('they added their card: off the Prospects list, counted as signed up', !find(l4, 'Landline Hotel') && l4.body.prospects.length === n0 - 1 && l4.body.signed_up === 1, l4.body.signed_up);
  var pl = DB.vp_venues.filter(function (x) { return x.name === 'Plus61 Tavern'; })[0];
  var plf = DB.venueplay_founding.filter(function (x) { return x.id === pl.founding_id; })[0];
  plf.status = 'comp';
  var mo = DB.vp_venues.filter(function (x) { return x.name === 'Mobile Only Inn'; })[0];
  DB.venueplay_founding.filter(function (x) { return x.id === mo.founding_id; })[0].bill_by_invoice = true;
  var ng = DB.vp_venues.filter(function (x) { return x.name === 'Nothing Given Arms'; })[0]; ng.group_id = U(900);
  var l5 = await list();
  check('made comp, billed by invoice, or put in an operator group: each one has signed up and leaves the list', !find(l5, 'Plus61 Tavern') && !find(l5, 'Mobile Only Inn') && !find(l5, 'Nothing Given Arms') && l5.body.signed_up === 4, l5.body.signed_up);
  crv.suspended_reason = 'archived';
  check('archived: not somebody to ring, off the list (and not counted as signed up)', !find(await list(), 'Autopilot Crows Nest') && (await list()).body.signed_up === 4);

  section('5. Without migration 125');
  world();
  var real = globalThis.fetch;
  globalThis.fetch = function (url, opts) { if (/\/rest\/v1\/vp_prospects(\?|$)/.test(String(url))) return RS(404, { message: 'relation "vp_prospects" does not exist' }); return real(url, opts); };
  r = await setUp({ name: 'Before 125 Hotel', phone: '0298765432', send_welcome: false });
  check('Set up a prospect still builds the venue, and HQ is told the tab needs migration 125 (their phone is on the audit row)',
    r.status === 200 && DB.vp_venues.length === 1 && (r.body.warnings || []).some(function (w) { return /migration 125/.test(w) && /\(02\) 9876 5432/.test(w); }), r.body);
  var l6 = await list();
  check('the list says "Run migration 125", not an empty list that looks like nobody', l6.status === 503 && /Run migration 125/.test(l6.body.error) && l6.body.need_migration === 125, l6);
  globalThis.fetch = real;

  section('6. The HQ screens: the Prospects pane and the Venues list');
  var PANE = readFile('venueplay/app/vp-prospects-hq.js');
  var W = { VP: null, fetch: function () { return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve({}); } }); }, setTimeout: function () {}, CustomEvent: function () {} };
  W.document = { readyState: 'complete', getElementById: function () { return null; }, addEventListener: function () {} };
  (new Function('window', PANE))(W);
  var T = W.VPProspects._t;
  var row1 = { venue_id: U(1), name: 'Sam\'s <b>Bar</b> & Grill', contact_name: 'Sam', email: 'sam@x.example', phone: '0432 071 622', tel: 'tel:0432071622', website: 'https://www.lmc.example/home',
    source: 'autopilot', created_at: '2026-10-26T06:35:00Z', days_since_setup: 3, welcome: { status: 'sent', send_at: '2026-10-26T08:05:00Z' }, last_sign_in_at: null, sign_in_known: true, flag: 'call_requested', called: null, postcode: '2065', state: 'NSW' };
  var row2 = { venue_id: U(2), name: 'Quiet Arms', contact_name: '', email: 'q@q.example', phone: null, tel: null, website: null, source: 'hq', created_at: '2026-10-25T00:00:00Z', days_since_setup: 4,
    welcome: null, last_sign_in_at: null, sign_in_known: true, flag: 'no_sign_in', called: null };
  var row3 = { venue_id: U(3), name: 'Signed In Inn', email: 'i@i.example', phone: '(02) 9876 5432', tel: 'tel:0298765432', source: 'hq', created_at: '2026-10-28T00:00:00Z', days_since_setup: 1,
    welcome: { status: 'scheduled', send_at: '2026-10-29T09:00:00Z' }, last_sign_in_at: '2026-10-28T23:12:00Z', sign_in_known: false, flag: null, called: { at: '2026-10-29T01:00:00Z', by: 'Dean', note: 'Rang, <keen>' } };
  var h1 = T.cardHtml(row1), h2 = T.cardHtml(row2), h3 = T.cardHtml(row3);
  check('the phone is a tap-to-call link', /<a class="prtel" href="tel:0432071622">0432 071 622<\/a>/.test(h1), h1);
  check('no phone: "No phone, email them", and the email is a mail link', /No phone, email them/.test(h2) && /href="mailto:q@q\.example"/.test(h2) && !/tel:/.test(h2), h2);
  check('the flags read "Call requested" and "Call them", and an unflagged row has none', /Call requested/.test(h1) && /Call them/.test(h2) && !/Call requested|Call them/.test(h3));
  check('their website is linked by its name; none says None', /<a href="https:\/\/www\.lmc\.example\/home" target="_blank" rel="noopener">lmc\.example<\/a>/.test(h1) && /Website<\/span>None/.test(h2), h1);
  check('set up date, days ago and the source: Instantly autopilot or HQ', /Mon 26 Oct \(3 days ago\), by Instantly autopilot/.test(h1) && /, by HQ/.test(h2), h1);
  check('the welcome email: sent, booked or not recorded; last sign-in never or when', /Sent Mon 26 Oct, 6:05pm/.test(h1) && /Not recorded/.test(h2) && /Goes at Thu 29 Oct, 7:00pm/.test(h3) && /Last sign-in<\/span>Never/.test(h1) && /Fri 30 Oct|Thu 29 Oct, 9:12am/.test(h3), [h1, h3]);
  check('a called row shows who and the note, with Undo, and no Called button', /Called Thu 29 Oct, 11:00am by Dean: <span class="prnote">Rang, &lt;keen&gt;<\/span>/.test(h3) && /data-pr-undo/.test(h3) && !/data-pr-called/.test(h3), h3);
  check('names and notes are escaped, never markup', h1.indexOf('<b>Bar</b>') === -1 && h1.indexOf('Sam&#39;s &lt;b&gt;Bar&lt;/b&gt; &amp; Grill') !== -1);
  check('a website that is not http(s) is never made a link', !/href="javascript/.test(T.cardHtml(Object.assign({}, row1, { website: 'javascript:alert(1)' }))));
  var lh1 = T.listHtml({ prospects: [row1, row2], follow_up_count: 2, follow_up_days: 3, signed_up: 1 });
  check('the pane head: the count, how many to call, and the 3 days from the Worker', /Prospects <span class="mono">2<\/span> <span class="prsum">2 to call<\/span>/.test(lh1) && /has not signed in 3 days after setup/.test(lh1) && /1 earlier prospect has signed up/.test(lh1), lh1.slice(0, 600));
  check('a list the Worker could not give says why', /Run migration 125/.test(T.listHtml({ error: 'Run migration 125 first (vp_prospects): HQ cannot list prospects without it.' })));
  check('no em or en dash in anything the pane says', !/[—–]/.test(PANE));

  var HQ = readFile('venueplay/app/hq.html');
  var S = { vSearch: '', vFilter: 'all', showLeft: false, live: {} };
  var PROSPECTS = { P1: true };
  var VPP = { isProspect: function (id) { return !!PROSPECTS[id]; } };
  var mk = new Function('S', 'window', 'hasLeft', 'isArchived', 'isCancelling', 'isTest', 'hideAsTest', 'needsState',
    lift(HQ, 'isProspect') + '\n' + lift(HQ, 'venuePasses') + '\nreturn venuePasses;');
  var no = function () { return false; };
  var passes = mk(S, { VPProspects: VPP }, no, no, no, no, no, function (v) { return !v.au_state; });
  var pv = { id: 'P1', name: 'Prospect Pub', slug: 'prospect-pub', au_state: 'NSW' }, cv = { id: 'C1', name: 'Customer Club', slug: 'customer-club', au_state: 'QLD' };
  check('HQ\'s own Venues filter leaves a prospect out of the active list and keeps a customer', passes(pv) === false && passes(cv) === true);
  S.vSearch = 'prospect';
  check('a search still finds a prospect (where did it go is one search away)', passes(pv) === true);
  S.vSearch = ''; delete PROSPECTS.P1;
  check('the moment the Worker stops listing them (they signed up), they are back on the active list', passes(pv) === true);
  var stats = lift(HQ, 'renderStats');
  check('the headline Venues count leaves prospects out too', /!hasLeft\(v\) && !hideAsTest\(v\) && !isProspect\(v\)/.test(stats), stats.slice(0, 300));

  if (bad) throw new Error('prospects tab: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
