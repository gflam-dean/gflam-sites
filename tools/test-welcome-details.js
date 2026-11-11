/* THE EMAILED ACCOUNT LINK WORKS UNTIL THEIR NAME AND MOBILE ARE IN, RUN AND NOT WORD-SEARCHED (Dean, 11 Nov 2026,
   INBOX 241/242/243/248). "The emailed account link keeps working UNTIL the person signs in AND puts in their details
   (name + mobile). Once both are saved, that link stops and it's the normal sign-in from then on (text code to their
   mobile). A click that doesn't finish the details doesn't burn the link (still within its 90 days)."
   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router with a fake Resend, a fake Mobile
   Message, a fake Auth and a FAKE CLOCK, as a NEW prospect on a Test Bravo-style venue:
     1. welcome link > click (not burned) > "carry on" (not burned) > name + mobile saved (details done, on the login and
        the account holder record, links retired) > link again = 410, the normal sign-in > a new link is one use
     2. after 90 days the link is the normal sign-in page
     3. a mobile already on the login: the short link stays open after a text-code sign-in until the name is confirmed
     4. existing logins and accounts are not touched
     5. the welcome screen (venueplay/app/vp-about-you.js in a small DOM): a new prospect login with its mobile already on
        is asked its NAME only (pre-filled), the mobile shown; an existing login with a mobile is not asked
   The same screens in Chrome at 375 and 1440: tools/welcome-name-in-chrome.test.py. Run from the repo root:  jsc tools/test-welcome-details.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
var __rnd = 11;
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

var VPA_ALPHA_T = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var SMS = [], AUTH = [], CANCELS = [], RESEND_IDS = 0, STORE = [], RESEND_EVENTS = {}, RESEND_GETS = 0;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (/api\.resend\.com\/emails\/[^/]+\/cancel$/.test(u)) { CANCELS.push(u.split('/emails/')[1].split('/')[0]); return RS(200, { object: 'email', id: 'x' }); }
  var g = /api\.resend\.com\/emails\/([^/?]+)$/.exec(u);
  if (g && method === 'GET') { RESEND_GETS++; var ev = RESEND_EVENTS[g[1]]; return ev === 'DOWN' ? RS(500, {}) : RS(200, { id: g[1], last_event: ev || 'sent' }); }
  if (u.indexOf('api.resend.com/emails') !== -1 && method === 'POST') { sent.push(JSON.parse(opts.body)); RESEND_IDS++; return RS(200, { id: 're_' + RESEND_IDS }); }
  if (u.indexOf('api.mobilemessage.com.au/v1/messages') !== -1) { SMS.push(JSON.parse(opts.body).messages[0]); return RS(200, { results: [{ status: 'success', message_id: 'mm_' + SMS.length }] }); }
  if (u.indexOf('/storage/v1/') !== -1) return RS(200, {});
  /* ONE STATEMENT, as Postgres runs it: the conditional "mark used" hands back the rows it changed (return=representation). */
  if (/\/rest\/v1\/vp_signin_links/.test(u) && method === 'PATCH' && /return=representation/.test(((opts && opts.headers) || {}).Prefer || '')) {
    var lq = parseQ(u.split('?')[1] || ''), lset = JSON.parse(opts.body), lgot = [];
    tbl('vp_signin_links').forEach(function (row) { if (match(row, lq)) { for (var lk in lset) row[lk] = lset[lk]; lgot.push({ auth_user_id: row.auth_user_id, venue_id: row.venue_id }); } });
    return RS(200, lgot);
  }
  if (u.indexOf('/auth/v1/admin/generate_link') !== -1) {
    var gq = JSON.parse(opts.body), gw = AUTH.filter(function (x) { return x.email === gq.email; })[0];
    return gw ? RS(200, { hashed_token: 'hashed-' + gw.id, verification_type: 'magiclink' }) : RS(404, {});
  }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '', user_metadata: b.user_metadata || {} }; AUTH.push(nu); return RS(200, nu); }
    if (one && method === 'PUT') { var hp = AUTH.filter(function (x) { return x.id === one[1]; })[0]; if (!hp) return RS(404, {}); var pb = JSON.parse(opts.body);
      if (pb.phone) hp.phone = String(pb.phone).replace('+', ''); if (pb.user_metadata) hp.user_metadata = pb.user_metadata; return RS(200, hp); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, JSON.parse(JSON.stringify(hit))) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '53000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9);
var KEY = 'k3y-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; CANCELS = []; RESEND_IDS = 0; STORE = []; RESEND_EVENTS = {}; RESEND_GETS = 0;
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099'; ENV.PROSPECT_AUTOPILOT_KEY = KEY; ENV.RESEND_API_KEY = ENV.RESEND_API_KEY || 're_test_full';
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
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
var SITE = (ENV.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
var AP = { 'X-Autopilot-Key': KEY }, HQ = { Authorization: 'Bearer ' + ADMIN };
var N = 0;
function body(o) { N++; var b = { name: 'Test Charlie Thread Hotel ' + N, first_name: 'Sam', email: 'sam' + N + '@testcharlie.example', postcode: '2065', entity_type: 'for_profit' };
  for (var k in (o || {})) b[k] = o[k]; return b; }
function liveLinks(vid) { return DB.vp_signin_links.filter(function (l) { return l.venue_id === vid && !l.used_at; }); }
function prospects(res) { return (res.body && res.body.prospects) || []; }
function named(res, name) { return prospects(res).filter(function (p) { return p.name === name; })[0]; }

/* A FAKE CLOCK: Date.now() and new Date() run SHIFT ms ahead of the real time, so "after 90 days" is run, not assumed. */
var RealDate = Date, SHIFT = 0;
function FakeDate() { var a = Array.prototype.slice.call(arguments); if (!a.length) return new RealDate(RealDate.now() + SHIFT);
  return new (Function.prototype.bind.apply(RealDate, [null].concat(a)))(); }
FakeDate.now = function () { return RealDate.now() + SHIFT; }; FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
Date = FakeDate;
var DAY = 86400000;
var IPN = 0; function NET() { return { 'cf-connecting-ip': '203.0.113.' + (++IPN % 250) }; }
function who(id) { return AUTH.filter(function (x) { return x.id === id; })[0]; }
function tokenOf(html) { var m = /\/app\/go#t=([A-Za-z0-9_-]{43})/.exec(String(html || '')); return m ? m[1] : ''; }
function codeOf(html) { var m = /\/s\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12})/.exec(String(html || '')); return m ? m[1] : ''; }
var me = function (uid) { return { Authorization: 'Bearer ' + uid }; };
/* Signing in by text code is Supabase Auth's (the sign-in page's verifyOtp): here it is what Auth records, a sign-in. */
function textCodeSignIn(u) { u.last_sign_in_at = new Date().toISOString(); }
var WSRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');

/* ---------------- a small DOM: enough for a screen built with createElement and textContent ---------------- */
function Node(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.id = ''; this._text = '';
  this.value = ''; this.disabled = false; this.handlers = {}; this.style = { cssText: '', display: '' }; this.innerHTMLSet = false; }
Object.defineProperty(Node.prototype, 'textContent', { get: function () { return this.children.length ? this.children.map(function (c) { return c.textContent; }).join(' ') : this._text; },
  set: function (v) { this.children = []; this._text = String(v); } });
Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(Node.prototype, 'innerHTML', { set: function () { this.innerHTMLSet = true; }, get: function () { return ''; } });
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') { this.style = { cssText: String(v), display: /display:\s*none/.test(v) ? 'none' : '' }; } if (k === 'id') this.id = String(v); };
Node.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
Node.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
Node.prototype.insertBefore = function (c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; var i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; };
Node.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
Node.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
Node.prototype.focus = function () { DOC.focused = this; };
Node.prototype.fire = function (ev, extra) { var me = this, out = []; (this.handlers[ev] || []).forEach(function (f) { out.push(f.call(me, Object.assign({ preventDefault: function () {}, key: '' }, extra || {}))); }); return out[0]; };
Node.prototype.click = function () { if (this.disabled) return; return this.fire('click'); };
var DOC = null;
function newDoc() {
  var d = { body: new Node('body'), focused: null };
  d.createElement = function (t) { return new Node(t); };
  d.getElementById = function (id) { function walk(n) { if (n.id === id) return n; for (var i = 0; i < n.children.length; i++) { var f = walk(n.children[i]); if (f) return f; } return null; } return walk(d.body); };
  DOC = d; return d;
}
function shown(n) { for (var x = n; x; x = x.parentNode) { if (x.style && x.style.display === 'none') return false; } return !!(n && attached(n)); }
function attached(n) { for (var x = n; x; x = x.parentNode) { if (x.tagName === 'BODY') return true; } return false; }
function anyHtml(n) { if (n.innerHTMLSet) return true; for (var i = 0; i < n.children.length; i++) if (anyHtml(n.children[i])) return true; return false; }


function settle() { for (var i = 0; i < 8; i++) drainMicrotasks(); }
function lstore() { var o = {}; return { getItem: function (k) { return k in o ? o[k] : null; }, setItem: function (k, v) { o[k] = String(v); }, removeItem: function (k) { delete o[k]; } }; }
var AYW = {}; (new Function('window', readFile('venueplay/app/vp-about-you.js')))(AYW);
var AY = AYW.VPAboutYou;
function ayCtx(user) { return { authed: true, isAdmin: false, scope: 'staff', user: user, role: 'owner', venue: { id: 'V1', name: 'Test Bravo' }, staff: [{ venue_id: 'V1', role: 'owner', display_name: 'Sam' }] }; }
function ayOpen(user, answer) {
  var doc = newDoc(), S = { fetches: [], done: [], calls: [] };
  S.ctx = ayCtx(user);
  S.client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-S' } } }); },
    updateUser: function (a) { S.calls.push('updateUser'); return Promise.resolve({ data: {}, error: null }); },
    refreshSession: function () { S.calls.push('refreshSession'); return Promise.resolve({ data: {} }); } } };
  S.api = AY.open(S.ctx, { doc: doc, storage: lstore(), client: S.client, onDone: function (h) { S.done.push(h); },
    fetch: function (url, o) { S.fetches.push({ url: url, body: JSON.parse(o.body) }); return Promise.resolve({ json: function () { return Promise.resolve(answer || { ok: true, details_done: true }); } }); } });
  S.$ = function (id) { return doc.getElementById(id); };
  return S;
}

(async function () {
  section('1. A NEW prospect, no mobile, the long one-tap link (before migration 175): the link works until name + mobile are in');
  world(); SHIFT = 0;
  var r = await call('/autopilot/prospect', body({ name: 'Test Bravo Welcome Hotel', first_name: 'Paul', email: 'paul@testbravo.example' }), AP);
  var vid = r.body && r.body.venue && r.body.venue.id;
  var pr = DB.vp_prospects.filter(function (x) { return x.venue_id === vid; })[0] || {};
  var paul = who(pr.auth_user_id) || {};
  var staff = DB.vp_venue_staff.filter(function (s) { return s.venue_id === vid; });
  var fRow = DB.venueplay_founding.filter(function (f) { return f.id === pr.founding_id; })[0] || {};
  var t = tokenOf(sent[0] && sent[0].html);
  check('set up: ONE login, the account email\'s, marked details due (vp_details_due), no mobile', r.status === 200 && !!paul.id && paul.email === 'paul@testbravo.example' && !paul.phone &&
    paul.user_metadata && paul.user_metadata.vp_details_due === true && !paul.user_metadata.vp_details_at, [r.status, paul]);
  check('the account email\'s login is the venue\'s ACCOUNT HOLDER: its staff row is role owner (was manager), named Paul (Dean, 11 Nov 2026, INBOX 242)',
    staff.length === 1 && staff[0].auth_user_id === paul.id && staff[0].role === 'owner' && staff[0].display_name === 'Paul', staff);
  check('the welcome email carries the one-tap link (no fake Resend call missed, no SMS sent)', /^[A-Za-z0-9_-]{43}$/.test(t) && sent.length === 1 && SMS.length === 0, [t, sent.length, SMS.length]);
  var c1 = await call('/auth/one-click', { t: t }, NET());
  var c2 = await call('/auth/one-click', { t: t }, NET());
  check('a click signs them in (a magic-link hash for THIS login, their venue)', c1.status === 200 && c1.body.ok === true && c1.body.token_hash === 'hashed-' + paul.id && c1.body.venue_id === vid, c1);
  check('A CLICK THAT DOES NOT FINISH THE DETAILS DOES NOT BURN THE LINK: still unused, and a second click signs in again', liveLinks(vid).length === 1 && c2.status === 200 && c2.body.ok === true, [liveLinks(vid), c2]);
  check('each tap is still recorded for HQ and the follow-ups (signin_link_used), no token in it', DB.vp_admin_audit.filter(function (a) { return a.action === 'signin_link_used' && a.target === 'venue:' + vid; }).length === 2 &&
    JSON.stringify(DB.vp_admin_audit).indexOf(t) === -1);
  /* "Code not arriving? Carry on for now": the name saved, no mobile on the login. */
  var carry = await call('/account/my-name', { name: 'Paul Hayes' }, me(paul.id));
  check('"Carry on for now" (name, no mobile): the name is saved to the staff row, the details are NOT done, the link still works',
    carry.status === 200 && carry.body.ok === true && carry.body.details_done === false && staff[0].display_name === 'Paul Hayes' && liveLinks(vid).length === 1 && !who(paul.id).user_metadata.vp_details_at, carry.body);
  check('...and the account record is not touched yet', !fRow.contact_name && !fRow.mobile, fRow);
  var c3 = await call('/auth/one-click', { t: t }, NET());
  check('...so the emailed link still signs them in', c3.status === 200 && c3.body.ok === true, c3);
  /* The welcome screen: name + mobile, the text code to the mobile (Auth's phone change puts it on the login). */
  SHIFT = 2 * DAY;
  who(paul.id).phone = '61400123454';
  var done = await call('/account/my-name', { name: 'Paul Hayes' }, me(paul.id));
  var paulNow = who(paul.id);
  check('NAME + MOBILE SAVED: details done, on the login (full_name, vp_details_at)', done.status === 200 && done.body.details_done === true &&
    paulNow.user_metadata.full_name === 'Paul Hayes' && !!paulNow.user_metadata.vp_details_at && paulNow.user_metadata.vp_details_due === true, [done.body, paulNow.user_metadata]);
  check('...AND on the account holder record: venueplay_founding contact_name "Paul Hayes", mobile 0400123454 (the account email\'s own login)',
    fRow.contact_name === 'Paul Hayes' && fRow.mobile === '0400123454', fRow);
  check('...recorded in the audit with the last 3 digits only', DB.vp_admin_audit.some(function (a) { return a.action === 'account_holder_details' && a.target === 'founding:' + fRow.id && a.detail && a.detail.mobile_last3 === '454' && JSON.stringify(a).indexOf('0400123454') === -1; }));
  check('THE LINK STOPS: every unused sign-in link for that login is retired', liveLinks(vid).length === 0 && DB.vp_signin_links.filter(function (l) { return l.auth_user_id === paul.id; }).every(function (l) { return !!l.used_at; }));
  var c4 = await call('/auth/one-click', { t: t }, NET());
  check('THE LINK AGAIN = the normal sign-in page (410 {ok:false}: the go page shows "Let\'s get you back in", Sign in with my mobile)', c4.status === 410 && JSON.stringify(c4.body) === '{"ok":false}', c4);
  var again = await call('/account/my-name', { name: 'Paul Hayes' }, me(paul.id));
  fRow.contact_name = 'Changed by HQ';
  var again2 = await call('/account/my-name', { name: 'Paul H' }, me(paul.id));
  check('saving the name again later never copies onto the account record a second time (first time only)', again.body.details_done === true && again2.body.details_done === true && fRow.contact_name === 'Changed by HQ', fRow);
  /* From now on: the normal sign-in. A fresh self-serve link ("Send me a new link") is one use, as it always was. */
  sent.length = 0;
  var rs = await call('/auth/one-click/resend', { t: t }, NET());
  var t2 = tokenOf(sent[0] && sent[0].html); print("DBG " + JSON.stringify(DB.vp_signin_links.map(function(l){return [l.used_at, l.created_at, l.expires_at, l.auth_user_id===paul.id];})));
  var u1 = await call('/auth/one-click', { t: t2 }, NET()), u2 = await call('/auth/one-click', { t: t2 }, NET());
  check('after the details, a NEW link (Send me a new link) signs in ONCE, as before', rs.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(t2) && u1.status === 200 && u2.status === 410, [rs.body, u1.status, u2.status]);

  section('2. Link after 90 days = the normal sign-in page (fake clock)');
  world(); SHIFT = 0;
  var r2 = await call('/autopilot/prospect', body({ name: 'Test Bravo Ninety Hotel', first_name: 'Jo' }), AP);
  var v2 = r2.body.venue.id, t90 = tokenOf(sent[0] && sent[0].html);
  SHIFT = 89 * DAY;
  var d89 = await call('/auth/one-click', { t: t90 }, NET());
  SHIFT = 91 * DAY;
  var d91 = await call('/auth/one-click', { t: t90 }, NET());
  SHIFT = 0;
  check('day 89, details still not in: the link still signs in', d89.status === 200 && d89.body.ok === true, d89);
  check('day 91: 410 {ok:false}, the same answer as a used link: the go page offers the normal sign-in (text code to the mobile)', d91.status === 410 && JSON.stringify(d91.body) === '{"ok":false}', d91);

  section('3. Mobile ALREADY on the login (from the setup): only the name is asked, and the short link (migration 175) stays open until it is');
  world(); SHIFT = 0; MIG175 = true;
  var r3 = await call('/autopilot/prospect', body({ name: 'Test Bravo Mobile Hotel', first_name: 'Sam', email: 'sam@testbravo.example', mobile: '0400 777 454' }), AP);
  var v3 = r3.body.venue.id, p3 = DB.vp_prospects.filter(function (x) { return x.venue_id === v3; })[0], sam = who(p3.auth_user_id);
  check('set up with their mobile on the login, details due, account holder (owner)', !!sam && sam.phone === '61400777454' && sam.user_metadata.vp_details_due === true &&
    DB.vp_venue_staff.filter(function (s) { return s.venue_id === v3; })[0].role === 'owner', sam);
  var one = await vpaProspectOneLink(ENV, v3, sam.id, {});
  var code = one && one.token;
  var o1 = await call('/short/open', { code: code }, NET());
  check('the short link opens the NORMAL text-code sign-in with their mobile filled in', o1.body.go === '/app/?signin=sms#m=0400777454' && o1.body.state === 'unclaimed', o1.body);
  textCodeSignIn(sam); p3.first_signin_at = new Date().toISOString();
  var o2 = await call('/short/open', { code: code }, NET());
  check('SIGNED IN BY TEXT CODE but the name not confirmed yet: the link still opens the sign-in with their mobile (not burned)', o2.body.go === '/app/?signin=sms#m=0400777454' && o2.body.state === 'unclaimed', o2.body);
  var n3 = await call('/account/my-name', { name: 'Sam Lee' }, me(sam.id));
  var f3 = DB.venueplay_founding.filter(function (f) { return f.id === p3.founding_id; })[0];
  check('the name confirmed (mobile already on): details done, account record gets the name and that mobile', n3.body.details_done === true && who(sam.id).user_metadata.vp_details_at && f3.contact_name === 'Sam Lee' && f3.mobile === '0400777454', [n3.body, f3]);
  var o3 = await call('/short/open', { code: code }, NET());
  check('now CLAIMED: the short link opens the plain normal sign-in, nothing filled in', o3.body.go === '/app/' && o3.body.state === 'claimed', o3.body);
  MIG175 = false;

  section('4. EXISTING logins and accounts are not changed');
  world(); SHIFT = 0;
  var OLDF = 'f-old', OLDV = 'v-old', OLDU = '53000000-0000-4000-8000-000000000077';
  AUTH.push({ id: OLDU, email: 'old@pub.example', phone: '61400999454', user_metadata: { full_name: 'Old Owner' } });
  DB.venueplay_founding.push({ id: OLDF, contact_email: 'old@pub.example', contact_name: null, mobile: null });
  DB.vp_venues.push({ id: OLDV, name: 'Old Pub', founding_id: OLDF });
  DB.vp_venue_staff.push({ venue_id: OLDV, auth_user_id: OLDU, role: 'manager', display_name: 'Old' });
  var nOld = await call('/account/my-name', { name: 'Old Owner' }, me(OLDU));
  check('an existing login (made before today, no vp_details_due) saving its name: its account record and role are left exactly as they were',
    nOld.status === 200 && DB.venueplay_founding[0].contact_name === null && DB.venueplay_founding[0].mobile === null && DB.vp_venue_staff[0].role === 'manager', DB.venueplay_founding[0]);
  DB.vp_signin_links.push({ token_hash: 'x', auth_user_id: OLDU, venue_id: OLDV, used_at: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * DAY).toISOString() });
  check('the welcome screen code reads only the new flag: vpaDetailsPending is false for a login with a mobile and no flag, true with no mobile', vpaDetailsPending(who(OLDU)) === false &&
    vpaDetailsPending({ phone: '', user_metadata: {} }) === true && vpaDetailsPending({ phone: '61400', user_metadata: { vp_details_due: true } }) === true &&
    vpaDetailsPending({ phone: '61400', user_metadata: { vp_details_due: true, vp_details_at: 'x' } }) === false);

  section('5. The welcome screen: a new prospect login with its mobile already on is asked its NAME only');
  var due = { id: 'u9', email: 'sam@x.example', phone: '61400777454', user_metadata: { vp_details_due: true } };
  check('a NEW prospect login (vp_details_due) WITH a mobile sees the welcome screen', AY.wants(ayCtx(due), lstore()) === true);
  check('an existing login with a mobile (no flag) does not; nor one whose details are done', AY.wants(ayCtx({ id: 'u8', phone: '61400777454', user_metadata: {} }), lstore()) === false &&
    AY.wants(ayCtx({ id: 'u7', phone: '61400777454', user_metadata: { vp_details_due: true, vp_details_at: '2026-11-11T00:00:00Z' } }), lstore()) === false);
  var W5 = ayOpen(due);
  check('name only: the name pre-filled "Sam", NO mobile box, "You\'ll sign in with 0400 777 454", one button "That\'s me"',
    W5.$('vpAyName').value === 'Sam' && !shown(W5.$('vpAyMobile')) && shown(W5.$('vpAyMobileNote')) && /You'll sign in with 0400 777 454/.test(W5.$('vpAyMobileNote').textContent) &&
    W5.$('vpAyName1').textContent === "That's me" && /Just check your name/.test(W5.$('vpAySub').textContent), [W5.$('vpAyName').value, W5.$('vpAyMobileNote') && W5.$('vpAyMobileNote').textContent]);
  W5.$('vpAyName').value = ''; W5.$('vpAyName1').click(); settle();
  check('no name: asked for it, nothing sent', /Pop your name in first/.test(W5.$('vpAyMsg').textContent) && W5.fetches.length === 0);
  W5.$('vpAyName').value = 'Sam Lee'; W5.$('vpAyName1').click(); settle();
  check('"That\'s me": the name to /account/my-name (no text code: the mobile is already theirs), a fresh session, "All set, Sam"',
    W5.fetches.length === 1 && /\/account\/my-name$/.test(W5.fetches[0].url) && W5.fetches[0].body.name === 'Sam Lee' && W5.calls.join() === 'refreshSession' &&
    W5.$('vpAyTitle').textContent === 'All set, Sam' && /0400 777 454/.test(W5.$('vpAySub').textContent), [W5.fetches, W5.calls, W5.$('vpAyTitle').textContent]);
  check('...and it is not asked again in this sign-in', AY.wants(W5.ctx, lstore()) === false);
  var W6 = ayOpen(due, { error: 'That did not save. Try again.' });
  W6.$('vpAyName1').click(); settle();
  check('the Worker refusing: says so, stays on the screen', /didn't save/.test(W6.$('vpAyMsg').textContent) && W6.done.length === 0 && !W6.$('vpAyGo'), W6.$('vpAyMsg').textContent);
  var W7 = ayOpen({ id: 'u6', email: 'p@x.example', phone: '', user_metadata: { vp_details_due: true } });
  check('no mobile on the login: the name AND the mobile, as before (Text me a code)', shown(W7.$('vpAyMobile')) && W7.$('vpAySend').textContent === 'Text me a code' && !W7.$('vpAyMobileNote'));
  var AYSRC = readFile('venueplay/app/vp-about-you.js');
  check('no em or en dash in the welcome screen', !/[—–]/.test(AYSRC));

  var BIL = readFile('venueplay/app/billing.html'), rwm = /var roleWord = (h\.is_owner \?[^;]+);/.exec(BIL);
  var roleWord = rwm ? new Function('h', 'return ' + rwm[1] + ';') : function () { return ''; };
  check('the People tab names the owner row "Account holder" (Paul, Account holder), managers and hosts as before',
    roleWord({ is_owner: true, role: 'owner' }) === 'Account holder' && roleWord({ is_owner: false, role: 'manager' }) === 'Manager' && roleWord({ is_owner: false, role: 'host' }) === 'Host', rwm && rwm[1]);

  section('6. Words and the code');
  check('no em or en dash in the new Worker lines', !/[—–]/.test(WSRC.slice(WSRC.indexOf('async function vpbDetailsDone'), WSRC.indexOf('async function vpbDetailsDone') + 3000)));

  print('');
  if (bad) throw new Error('welcome details: ' + bad + ' of ' + ran + ' failed');
  print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.stack || e)); throw e; });
