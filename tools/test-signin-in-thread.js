/* THE SIGN-IN LINK IN THEIR OWN THREAD, AND WHERE THE ACCOUNT EMAIL GOT TO, RUN AND NOT WORD-SEARCHED (Dean, 5 Nov 2026).

   "I don't want to have to call these people. I don't want to lose a lead because my email went to junk."
   "I need to be able to make sure our emails are making it somewhere."
   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router and proves:
     1. POST /autopilot/prospect with return_signin_link hands back the reply's link: an email login gets its OWN
        one-use token (apart from the welcome's, both live), a mobile login the text-code sign-in with no token;
        without return_signin_link, or from HQ's route, there is none (unchanged)
     2. POST /autopilot/prospect/signin-link: the key only; a quiet prospect gets a fresh link, older unused links
        retired, NOTHING emailed; signed in, cancelled or not a prospect: refused, nothing made
     3. HQ > Prospects and the quiet list carry delivery in plain words: delivered, bounced at their domain,
        cancelled, link opened, signed in; Resend not answering is "could not say", never "delivered"
     4. GET /autopilot/decisions says the features, so a Mac only uses them on a Worker that has them

   Run from the repo root:  jsc tools/test-signin-in-thread.js */
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
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one && method === 'PUT') { var hp = AUTH.filter(function (x) { return x.id === one[1]; })[0]; if (!hp) return RS(404, {}); var pb = JSON.parse(opts.body); if (pb.phone) hp.phone = String(pb.phone).replace('+', ''); return RS(200, hp); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
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

(async function () {
  section('1. The setup hands back the reply\'s link when the autopilot asks');
  world();
  var r = await call('/autopilot/prospect', body({ return_signin_link: true }), AP);
  var vid = r.body.venue && r.body.venue.id;
  check('an email login: a one-tap link to /app/go with a token and their address, kind "link"', r.status === 200 && r.body.signin && r.body.signin.kind === 'link' &&
    r.body.signin.url.indexOf(SITE + '/app/go#t=') === 0 && /#t=[A-Za-z0-9_-]{43}&e=sam1%40testcharlie\.example$/.test(r.body.signin.url), r.body.signin);
  check('its OWN token: two live links for the venue (the welcome\'s and the reply\'s), so either one works', liveLinks(vid).length === 2, DB.vp_signin_links);
  check('the welcome still goes as the backup, booked as before', sent.length === 1 && r.body.welcome && r.body.welcome.status === 'scheduled', r.body.welcome);
  var wl = sent[0] || {};
  check('the account email says which address our emails come from, and comes from it (Dean, 6 Nov 2026: "so they look out for it")',
    /Our emails come from <strong>hello@send\.venueplay\.com\.au<\/strong>\. If one lands in junk, mark it as not junk\./.test(String(wl.html || '')) && /hello@send\.venueplay\.com\.au/.test(String(wl.from || '')), [wl.from, String(wl.html || '').slice(0, 200)]);
  check('the link ends with their 90 days, and says when', r.body.signin.days_left >= 89 && !!r.body.signin.expires_words, r.body.signin);
  check('the token is never written to the audit', JSON.stringify(DB.vp_admin_audit).indexOf(r.body.signin.url.split('#t=')[1].split('&')[0]) === -1);
  world(); N = 10;
  r = await call('/autopilot/prospect', body({ return_signin_link: true, mobile: '0400 111 333' }), AP);
  check('a mobile login: the text-code sign-in with their number, no token', r.status === 200 && r.body.signin && r.body.signin.kind === 'sms' &&
    r.body.signin.url === SITE + '/app/?signin=sms#m=0400111333' && r.body.signin.mobile_ends === '333' && DB.vp_signin_links.length === 0, r.body.signin);
  world();
  r = await call('/autopilot/prospect', body({}), AP);
  check('CONTROL: without return_signin_link there is no link and one token (the welcome\'s), as before', r.status === 200 && !r.body.signin && DB.vp_signin_links.length === 1, r.body);
  r = await call('/admin/prospect', body({ return_signin_link: true }), HQ);
  check('CONTROL: HQ\'s own route never hands a link back, even if asked', r.status === 200 && !r.body.signin, r.body);
  r = await call('/autopilot/prospect', body({ return_signin_link: true, dry_run: true }), AP);
  check('a dry run makes no link', r.status === 200 && r.body.dry_run === true && !r.body.signin, r.body);

  section('2. POST /autopilot/prospect/signin-link: a fresh link for the thread, nothing emailed');
  world();
  r = await call('/autopilot/prospect', body({}), AP); vid = r.body.venue.id;
  var before = sent.length;
  var x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, {});
  check('no key: 401, nothing made', x.status === 401 && DB.vp_signin_links.length === 1, x);
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, HQ);
  check('an HQ login is not the key: 401', x.status === 401, x);
  x = await call('/autopilot/prospect/signin-link', { venue_id: 'nope' }, AP);
  check('a bad venue id: 400', x.status === 400, x);
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, AP);
  check('a quiet prospect: 200, a one-tap link, kind "link", to their address', x.status === 200 && x.body.ok && x.body.kind === 'link' && /\/app\/go#t=[A-Za-z0-9_-]{43}&e=/.test(x.body.url) && /^sam\d+@testcharlie\.example$/.test(x.body.to), x.body);
  check('NOTHING was emailed', sent.length === before, sent.slice(before));
  check('only the newest works: the welcome\'s unused link was retired, one live link left', liveLinks(vid).length === 1, DB.vp_signin_links);
  check('their 90 days were NOT restarted (no link_from)', !DB.vp_prospects[0].link_from, DB.vp_prospects[0]);
  check('recorded as prospect_thread_link_made, with no token in it', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_thread_link_made'; }) &&
    JSON.stringify(DB.vp_admin_audit).indexOf(x.body.url.split('#t=')[1].split('&')[0]) === -1);
  check('tapped is false until they tap', x.body.tapped === false, x.body);
  DB.vp_admin_audit.push({ id: newId(), action: 'signin_link_used', target: 'venue:' + vid, created_at: new Date().toISOString(), detail: {} });
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, AP);
  check('a tap that never became a sign-in: still a link, and says tapped', x.status === 200 && x.body.tapped === true, x.body);
  var st = DB.vp_venue_staff.filter(function (s) { return s.venue_id === vid; })[0];
  AUTH.filter(function (u) { return u.id === st.auth_user_id; })[0].last_sign_in_at = new Date().toISOString();
  var nLinks = DB.vp_signin_links.length;
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, AP);
  check('signed in: refused (409, signed_in), no link made', x.status === 409 && x.body.signed_in === true && DB.vp_signin_links.length === nLinks, x.body);
  world(); N = 20;
  r = await call('/autopilot/prospect', body({}), AP); vid = r.body.venue.id;
  DB.vp_prospects[0].cancelled_at = new Date().toISOString();
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, AP);
  check('cancelled: refused, no link made', x.status === 409 && x.body.refused && liveLinks(vid).length === 1, x.body);
  x = await call('/autopilot/prospect/signin-link', { venue_id: U(777) }, AP);
  check('not a prospect at all: refused', x.status === 409 && /not a prospect/.test(x.body.error), x.body);
  world(); N = 30;
  r = await call('/autopilot/prospect', body({ mobile: '0400 111 444' }), AP); vid = r.body.venue.id;
  x = await call('/autopilot/prospect/signin-link', { venue_id: vid }, AP);
  check('a mobile login: the text-code sign-in, no token minted', x.status === 200 && x.body.kind === 'sms' && x.body.url === SITE + '/app/?signin=sms#m=0400111444' && DB.vp_signin_links.length === 0, x.body);

  section('3. Where the account email got to, in plain words');
  world(); N = 40;
  var names = [];
  for (var i = 0; i < 6; i++) { r = await call('/admin/prospect', body({ send_in_minutes: 0 }), HQ); names.push(r.body.venue.name); }
  var W = DB.vp_prospect_welcomes;
  function wOf(nm) { var v = DB.vp_venues.filter(function (q) { return q.name === nm; })[0]; return W.filter(function (w) { return w.venue_id === v.id; })[0]; }
  RESEND_EVENTS[wOf(names[0]).resend_id] = 'delivered';
  RESEND_EVENTS[wOf(names[1]).resend_id] = 'bounced';
  wOf(names[2]).status = 'cancelled';
  RESEND_EVENTS[wOf(names[3]).resend_id] = 'DOWN';
  RESEND_EVENTS[wOf(names[4]).resend_id] = 'delivered';
  var v4 = DB.vp_venues.filter(function (q) { return q.name === names[4]; })[0];
  DB.vp_admin_audit.push({ id: newId(), action: 'signin_link_used', target: 'venue:' + v4.id, created_at: new Date(Date.now() + 1000).toISOString(), detail: {} });   // a second after setup, as a real tap is
  var v5 = DB.vp_venues.filter(function (q) { return q.name === names[5]; })[0];
  DB.vp_admin_audit.push({ id: newId(), action: 'email_bounced', target: 'venue:' + v5.id, created_at: new Date().toISOString(), detail: { address: 'sam' + 46 + '@testcharlie.example', reason: '550 mailbox unavailable' } });
  var L = await call('/admin/prospects', {}, HQ);
  check('delivered, never tapped: "Delivered, link not opened yet"', (named(L, names[0]).delivery || {}).words === 'Delivered, link not opened yet', named(L, names[0]).delivery);
  check('bounced at Resend: "Bounced at" their domain', (named(L, names[1]).delivery || {}).welcome === 'bounced' && /^Bounced at testcharlie\.example/.test(named(L, names[1]).delivery.words), named(L, names[1]).delivery);
  check('cancelled in HQ: "Cancelled, never sent", and Resend not even asked for it', (named(L, names[2]).delivery || {}).words === 'Cancelled, never sent', named(L, names[2]).delivery);
  check('Resend not answering: "could not say", NEVER "delivered"', (named(L, names[3]).delivery || {}).welcome === 'unknown' && /could not say/.test(named(L, names[3]).delivery.words), named(L, names[3]).delivery);
  check('a tap on their link: "Link opened <day>, not signed in yet"', /^Link opened \w{3} \d+ \w+, not signed in yet$/.test((named(L, names[4]).delivery || {}).words || ''), named(L, names[4]).delivery);
  check('a bounce the webhook recorded: bounced, with its reason', (named(L, names[5]).delivery || {}).welcome === 'bounced' && /550 mailbox unavailable/.test(named(L, names[5]).delivery.words), named(L, names[5]).delivery);
  var st0 = DB.vp_venue_staff.filter(function (s) { return s.venue_id === DB.vp_venues.filter(function (q) { return q.name === names[0]; })[0].id; })[0];
  AUTH.filter(function (u) { return u.id === st0.auth_user_id; })[0].last_sign_in_at = new Date().toISOString();
  L = await call('/admin/prospects', {}, HQ);
  check('signed in wins over everything: "Signed in <day>"', /^Signed in /.test((named(L, names[0]).delivery || {}).words || ''), named(L, names[0]).delivery);
  var Q = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  var q1 = prospects(Q).filter(function (p) { return p.name === names[1]; })[0] || {};
  check('the autopilot\'s quiet list carries the same delivery (so the Mac can catch a bounce)', Q.status === 200 && q1.delivery && q1.delivery.welcome === 'bounced', q1);
  var gets = RESEND_GETS;
  await vpaProspectsData(ENV);
  check('a send-time check (no delivery asked) never calls Resend', RESEND_GETS === gets, RESEND_GETS - gets);

  section('4. The features, so the Mac knows');
  var D = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('GET /autopilot/decisions lists signin_in_reply, thread_link and delivery', D.status === 200 && ['needs_you', 'signin_in_reply', 'thread_link', 'delivery'].every(function (f) { return (D.body.features || []).indexOf(f) !== -1; }), D.body.features);

  section('5a. A \'yes\' reply also gets a text with the sign-in link (Dean, 6 Nov 2026)');
  /* Dean's words for the text, the exact string the Mac sends (venue filled in by the Mac, {link} by the Worker). */
  var YES_TEXT = 'Welcome to venueplay! Your account for Test Charlie Yes Hotel is ready. Tap to sign in: {link} Reply STOP to opt out';
  world(); SMS = [];
  ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass';
  ENV.PROSPECT_SMS_ON = '';
  r = await call('/autopilot/prospect', body({ name: 'Test Charlie Yes Hotel', return_signin_link: true, mobile: '0400 222 444' }), AP);
  var yvid = r.body.venue && r.body.venue.id;
  var ys = await call('/autopilot/prospect/nudge-sms', { venue_id: yvid, text: YES_TEXT, purpose: 'yes_reply' }, AP);
  check('texts switched off (PROSPECT_SMS_ON not "on"): 503, nothing texted, nothing minted for it', ys.status === 503 && ys.body.sms_off === true && SMS.length === 0, [ys, SMS]);
  ENV.PROSPECT_SMS_ON = 'on';
  var linksBefore = liveLinks(yvid).length;
  ys = await call('/autopilot/prospect/nudge-sms', { venue_id: yvid, text: YES_TEXT, purpose: 'yes_reply' }, AP);
  var sms = SMS[0] || {};
  check('switched on: ONE text to their own mobile, from the venueplay sender', ys.status === 200 && SMS.length === 1 && sms.to === '+61400222444' && sms.sender === 'venueplay', [ys, SMS]);
  check('the text carries a one-tap sign-in link (the long one before migration 175) and Dean\'s words, with the opt-out as OUR OWN stop link (23 Nov 2026: "venueplay" cannot take a reply)', /^Welcome to venueplay! Your account for Test Charlie Yes Hotel is ready\. Tap to sign in: $/.test((sms.message || '').split(SITE + '/app/go#t=')[0]) && /\/app\/go#t=[A-Za-z0-9_-]{43}&e=/.test(sms.message || '') && /Opt out: api\.venueplay\.com\.au\/stop\/[0-9a-f]{48}$/.test(sms.message || '') && (sms.message || '').indexOf('{link}') === -1, sms.message);
  check('its own fresh link: the welcome\'s and the reply\'s still work too', liveLinks(yvid).length === linksBefore + 1, DB.vp_signin_links);
  var ya = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_nudge_sms_sent' && a.target === 'venue:' + yvid; });
  check('audited as the yes reply\'s text (not a nudge), last 3 digits only, never the link', ya.length === 1 && ya[0].detail && ya[0].detail.purpose === 'yes_reply' && ys.body.purpose === 'yes_reply' &&
    JSON.stringify(ya[0]).indexOf('/app/go') === -1 && JSON.stringify(ya[0]).indexOf('0400222444') === -1, ya);
  var nd = await call('/autopilot/prospect/nudge-sms', { venue_id: yvid, text: YES_TEXT }, AP);
  var na = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_nudge_sms_sent' && a.target === 'venue:' + yvid; });
  check('CONTROL: without purpose it is a nudge, as before', nd.status === 200 && na.length === 2 && na[1].detail && na[1].detail.purpose === 'nudge', na);
  SMS = [];
  var bad1 = await call('/autopilot/prospect/nudge-sms', { venue_id: yvid, text: 'Welcome to venueplay! Your account is ready. Tap to sign in: {link}', purpose: 'yes_reply' }, AP);
  check('a yes text with no opt-out is refused, nothing texted', bad1.status === 400 && SMS.length === 0, bad1);
  var bad2 = await call('/autopilot/prospect/nudge-sms', { venue_id: yvid, text: YES_TEXT, purpose: 'yes_reply' }, {});
  check('the key only: no autopilot key, nothing texted', bad2.status === 401 || bad2.status === 403 ? SMS.length === 0 : false, bad2);
  ENV.PROSPECT_SMS_ON = ''; ENV.MOBILEMESSAGE_USERNAME = ''; ENV.MOBILEMESSAGE_PASSWORD = '';

  section('7. ONE LINK PER PROSPECT (Dean, 6 Nov 2026; migration 175): the same link everywhere, never a login key, only HQ\'s "Start a fresh 90 days" renews');
  MIG175 = true; world(); SMS = [];
  ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass'; ENV.PROSPECT_SMS_ON = 'on';
  var CODE_IN = function (t) { var m = /\/s\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12})(?![A-Za-z0-9])/.exec(String(t || '')); return m ? m[1] : ''; };
  var NETS = 0; var NET7 = function () { return { 'cf-connecting-ip': '198.18.0.' + (++NETS % 250) }; };
  var o1 = await call('/autopilot/prospect', body({ name: 'One Link Hotel', return_signin_link: true }), AP);   // an email login, as a 'yes' reply makes
  var ov = o1.body.venue && o1.body.venue.id;
  var opr = DB.vp_prospects.filter(function (x) { return x.venue_id === ov; })[0] || {};
  DB.venueplay_founding.forEach(function (f) { if (f.id === opr.founding_id) f.mobile = '0400 555 666'; });   // their mobile, as Edit details adds it
  var welcome1 = String((sent[0] || {}).html || '');
  var cWelcome = CODE_IN(welcome1), cReply = CODE_IN(o1.body.signin && o1.body.signin.url);
  var winEnd = Date.parse(opr.created_at) + 90 * 86400000;
  check('the welcome email and the reply in their thread carry the SAME short link, and no sign-in token is made for it',
    !!cWelcome && cWelcome === cReply && DB.vp_signin_links.filter(function (l) { return l.venue_id === ov && !l.used_at; }).length === 0 && Math.abs(Date.parse(o1.body.signin.expires_at) - winEnd) < 120000, [cWelcome, cReply, DB.vp_signin_links.length]);
  check('the welcome says the button texts a code ("we\'ll text a code to your mobile to sign you in")', /Tap the button below and we&#39;ll text a code to your mobile to sign you in\./.test(welcome1) && !/The button below opens your account for you/.test(welcome1));
  check('kept sealed on the prospect (migration 175): no working key in the database, and it opens back to the same letters',
    /^v1\.[A-Za-z0-9_-]{16}\.[0-9a-f]{24}$/.test(opr.signin_code_enc || '') && opr.signin_code_enc.indexOf(cWelcome) === -1 && (await vpaOpenCode(ENV, opr.signin_code_enc)) === cWelcome, opr.signin_code_enc);
  var oText = await call('/autopilot/prospect/nudge-sms', { venue_id: ov, text: 'Welcome to venueplay! Your account for One Link Hotel is ready: {link} We\'ve emailed it too, check junk. Reply STOP to opt out', purpose: 'yes_reply' }, AP);
  var oNudge = await call('/autopilot/prospect/nudge', { venue_id: ov, text: 'Hi Sam,\n\nJust checking you got your venueplay account. Here is your link again.\n\nCheers,\nKayla' }, AP);
  var oHq = await call('/admin/signin-link', { venue_id: ov, text: true }, HQ);
  var texts = SMS.map(function (m) { return m.message; });
  var mails = sent.slice(1).map(function (m) { return String(m.html || ''); });
  check('the yes text, the follow-up email and HQ\'s Resend (email and text): every one the same short link, the texts without https://www. (one SMS part)',
    oText.status === 200 && oNudge.status === 200 && oHq.status === 200 && texts.length >= 1 && mails.length >= 2 &&
    texts.concat(mails).every(function (t) { return CODE_IN(t) === cWelcome; }) && texts.every(function (t) { return /(^|\s)venueplay\.com\.au\/s\/[A-Z0-9]{12}(\/[a-z0-9]{2})? /.test(t); }), [oText.status, oNudge.status, oHq.status, texts, mails.map(CODE_IN)]);
  /* WHICH MESSAGE (Dean, 16 Nov 2026: "can we track which link they clicked?"): two letters after the same link. */
  var TAG_IN = function (t) { var m = /\/s\/[A-Z0-9]{12}\/([a-z0-9]{2})(?![A-Za-z0-9])/.exec(String(t || '')); return m ? m[1] : ''; };
  check('TAGS: the welcome email\'s link ends /es (account email, sign-up), the sign-up text /ts, the hello@ follow-up /e3 (day 3 unless the Mac says otherwise), HQ\'s own Resend has none',
    TAG_IN(welcome1) === 'es' && TAG_IN(texts[0]) === 'ts' && TAG_IN(mails[0]) === 'e3' && mails.slice(1).every(function (t) { return TAG_IN(t) === ''; }), [TAG_IN(welcome1), texts.map(TAG_IN), mails.map(TAG_IN)]);

  var pr2 = DB.vp_prospects.filter(function (x) { return x.venue_id === ov; })[0] || {};
  check('...and not one of them renewed the 90 days: the same end, link_from never set, HQ told not restarted',
    Math.abs(Date.parse(oHq.body.expires_at) - winEnd) < 120000 && !pr2.link_from && oHq.body.restarted === false, [oHq.body, pr2.link_from]);

  /* OPENING IT (Dean: the normal sign-in screen, mobile filled in; nothing else to build). */
  var login1 = AUTH.filter(function (u) { return u.id === opr.auth_user_id; })[0] || {};
  var opens0 = DB.vp_admin_audit.filter(function (a) { return a.action === 'signin_link_used' && a.target === 'venue:' + ov; }).length;
  var op1 = await call('/short/open', { code: cWelcome.toLowerCase() }, NET7());
  check('UNCLAIMED, mobile known: the normal sign-in with their mobile filled in, and the mobile we hold is put on their login so the code reaches it',
    op1.status === 200 && op1.body.go === '/app/?signin=sms#m=0400555666' && !op1.body.attach && String(login1.phone || '').replace(/\D/g, '') === '61400555666', [op1.body, login1.phone]);
  check('...the open is recorded for HQ\'s history (signin_link_used), and the answer carries no token or link that signs anyone in',
    DB.vp_admin_audit.filter(function (a) { return a.action === 'signin_link_used' && a.target === 'venue:' + ov; }).length === opens0 + 1 && !/go#t=|token/.test(JSON.stringify(op1.body)), op1.body);
  var oAfterOpen = await call('/autopilot/prospect/nudge-sms', { venue_id: ov, text: 'Hi Sam, your venueplay link: {link} Reply STOP to opt out' }, AP);
  check('...and the follow-ups stop: they have opened it', oAfterOpen.status !== 200, oAfterOpen.body);
  var wrong = await call('/short/open', { code: cWelcome.slice(0, 11) + (cWelcome[11] === 'A' ? 'B' : 'A') }, NET7());
  var junk = await call('/short/open', { code: '<script>' }, NET7());
  check('WRONG letters (one changed) or junk: the plain sign-in, nothing filled in, nothing recorded', wrong.body.go === '/app/' && junk.body.go === '/app/' && !wrong.body.attach &&
    DB.vp_admin_audit.filter(function (a) { return a.action === 'signin_link_used' && a.target === 'venue:' + ov; }).length === opens0 + 1, [wrong.body, junk.body]);
  var at1 = await call('/short/attach', { code: cWelcome, mobile: '0499 000 111' }, NET7());
  check('a mobile can NOT be swapped in through the link when we already hold one', at1.status === 409 && at1.body.has_mobile === true && String(login1.phone).replace(/\D/g, '') === '61400555666', at1.body);
  var pr1 = DB.vp_prospects.filter(function (x) { return x.venue_id === ov; })[0];
  pr1.first_signin_at = new Date().toISOString();   // they signed in (the free month starts at the first sign-in)
  var opC = await call('/short/open', { code: cWelcome }, NET7());
  var atC = await call('/short/attach', { code: cWelcome, mobile: '0499 000 111' }, NET7());
  check('CLAIMED (somebody has signed in): the link just opens the normal sign-in, nothing filled in; no number can be added through it',
    opC.body.go === '/app/' && opC.body.state === 'claimed' && atC.status === 409 && String(login1.phone).replace(/\D/g, '') === '61400555666', [opC.body, atC.body]);

  /* THE TAG WHEN THE LINK IS OPENED, AND THE SIGN-IN AFTER IT (16 Nov 2026). The journey store, migration 196; no personal data. */
  world(); SMS = [];
  ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass'; ENV.PROSPECT_SMS_ON = 'on';
  DB.vp_journey_events = [];
  var t1 = await call('/autopilot/prospect', body({ name: 'Tagged Link Hotel', return_signin_link: true }), AP);
  var tv = t1.body.venue.id, tpr = DB.vp_prospects.filter(function (x) { return x.venue_id === tv; })[0];
  var tCode = CODE_IN(t1.body.signin.url);
  DB.venueplay_founding.forEach(function (f) { if (f.id === tpr.founding_id) f.mobile = '0400 555 777'; });   // their own mobile, for the text
  check('the link in the setup\'s reply (their thread) ends /rs: thread, sign-up', TAG_IN(t1.body.signin.url) === 'rs', t1.body.signin.url);
  var tx = await call('/autopilot/prospect/nudge-sms', { venue_id: tv, step: 'day27', text: 'venueplay: Hi Sam, your venueplay trial expires in 3 days: {link} Reply STOP to opt out' }, AP);
  var th = await call('/autopilot/prospect/signin-link', { venue_id: tv, step: 'day3' }, AP);
  check('the day-27 text\'s link ends /t7; the thread link the Mac asks for on day 3 ends /r3', tx.status === 200 && TAG_IN(SMS[SMS.length - 1].message) === 't7' && TAG_IN(th.body.url) === 'r3',
    [tx.status, SMS.map(function (m) { return m.message; }), th.body]);
  var smsBefore = SMS.length, mailBefore = sent.length;
  var rx1 = await call('/autopilot/prospect/nudge-sms', { venue_id: tv, step: 'expiry', text: 'venueplay: Hi Sam, your venueplay trial expires in 3 days: {link} Reply STOP to opt out' }, AP);
  var rx2 = await call('/autopilot/prospect/nudge', { venue_id: tv, step: 'expiry', text: 'Hey Sam,\n\nThis is a long enough nudge for the route to look at it.\n\nCheers,\nthe team' }, AP);
  var rx3 = await call('/autopilot/prospect/signin-link', { venue_id: tv, step: 'expiry' }, AP);
  check('the retired step "expiry" is refused (400, retired_step) by the nudge, the nudge text and the sign-in link routes, and nothing is sent or made', rx1.status === 400 && rx2.status === 400 && rx3.status === 400 && rx1.body.retired_step === true && rx2.body.retired_step === true && rx3.body.retired_step === true && SMS.length === smsBefore && sent.length === mailBefore, [rx1.status, rx2.status, rx3.status]);
  var d27ph = await call('/autopilot/prospect/nudge-sms', { venue_id: tv, step: 'day27', text: 'venueplay: Hi Sam, your venueplay trial expires in {days} days: {link} Reply STOP to opt out' }, AP);
  var fnph = await call('/autopilot/prospect/nudge', { venue_id: tv, step: 'final', text: 'Hey Sam,\n\nYour link ends {expires} so here it is.\n\nCheers,\nthe team' }, AP);
  check('a day27 text or a final email that carries {days} / {expires} is refused: the Worker adds no link-days sentence to them', d27ph.status === 400 && fnph.status === 400 && SMS.length === smsBefore && sent.length === mailBefore, [d27ph.status, fnph.status]);
  var t3r = await call('/autopilot/prospect/nudge-sms', { venue_id: tv, step: 'day3', text: 'venueplay: Hi Sam, here is your sign-in link again: {link} Reply STOP to opt out' }, AP);
  check('the day-3 text\'s link ends /t3 (it was untagged before)', t3r.status === 200 && TAG_IN(SMS[SMS.length - 1].message) === 't3', [t3r.status, SMS[SMS.length - 1]]);
  var openScan = await call('/short/open', { code: tCode, via: 't7' }, Object.assign(NET7(), { 'user-agent': 'Mozilla/5.0 (compatible; Microsoft Office/16.0; SafeLinks)' }));
  var evs = function (ev) { return DB.vp_journey_events.filter(function (e) { return e.venue_id === tv && (!ev || e.event === ev); }); };
  check('a mail scanner opening /s/<letters>/t7 is kept as a scanner, never as a person', evs('scanner_hit').length === 1 && evs('scanner_hit')[0].scanner === true && evs('signin_link_opened').length === 0, DB.vp_journey_events);
  var openTx = await call('/short/open', { code: tCode, via: 't7' }, Object.assign(NET7(), { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }));
  var ev1 = evs('signin_link_opened');
  check('a person opening it: "signin_link_opened" with channel text and step day27, the venue, a 24-letter session id, and the open goes where it always did',
    openTx.status === 200 && /^\/app\//.test(openTx.body.go) && ev1.length === 1 && ev1[0].props.channel === 'text' && ev1[0].props.step === 'day27' && /^[a-f0-9]{24}$/.test(ev1[0].sid) && ev1[0].scanner === false, [openTx.body, ev1]);
  check('...no personal data in the event: no code, no mobile, no email, no name, no address', !/@|04\d{8}|614\d{8}|Tagged Link|198\.18/.test(JSON.stringify(ev1[0])) && JSON.stringify(ev1[0]).indexOf(tCode) === -1, ev1[0]);
  check('...and HQ\'s history keeps the tag on the open', DB.vp_admin_audit.some(function (a) { return a.action === 'signin_link_used' && a.target === 'venue:' + tv && a.detail && a.detail.tag === 't7'; }));
  var nBad = DB.vp_journey_events.length;
  var openBad = await call('/short/open', { code: tCode, via: 'zz' }, NET7());
  var openJunk = await call('/short/open', { code: tCode, via: '<b>x</b>' }, NET7());
  check('a tag not in the table, or junk: the link opens exactly as before and nothing is kept', /^\/app\//.test(openBad.body.go) && /^\/app\//.test(openJunk.body.go) && DB.vp_journey_events.length === nBad, DB.vp_journey_events.slice(nBad));
  await vpaProspectStartMonth(ENV, tpr, Date.now());
  var ev2 = evs('signin_link_signed_in');
  check('their first sign-in after it: "signin_link_signed_in", text / day27, the same session', ev2.length === 1 && ev2[0].props.channel === 'text' && ev2[0].props.step === 'day27' && ev2[0].sid === ev1[0].sid, ev2);
  await vpaProspectStartMonth(ENV, tpr, Date.now());
  check('...once (a second sign-in starts nothing and keeps nothing)', evs('signin_link_signed_in').length === 1);
  var jv = await call('/admin/journey-venue', { venue_id: tv }, HQ);
  var said = ((jv.body && jv.body.journey) || []).map(function (i) { return i.what; });
  check('HQ > Journey for the venue says it in words: "Opened the sign-in link from the text sent three days before their trial ends", then "Signed in from the text sent three days before their trial ends"',
    said.indexOf('Opened the sign-in link from the text sent three days before their trial ends') >= 0 && said.indexOf('Signed in from the text sent three days before their trial ends') > said.indexOf('Opened the sign-in link from the text sent three days before their trial ends'), [jv.status, said]);
  check('every tag reads in words (the new day-3 / day-27 / final ones, and the old ones so a link already sent still reads)', [['es', 'account_email', 'signup'], ['e3', 'account_email', 'day3'], ['ex', 'account_email', 'expiry'], ['rs', 'thread', 'signup'], ['r3', 'thread', 'day3'], ['rx', 'thread', 'expiry'], ['ts', 'text', 'signup'], ['tx', 'text', 'expiry'],
    ['e7', 'account_email', 'day27'], ['ef', 'account_email', 'final'], ['rf', 'thread', 'final'], ['t3', 'text', 'day3'], ['t7', 'text', 'day27']].every(function (t) { return vpaLinkTag(t[1], t[2]) === t[0] && !/undefined|a message/.test(vpjSayLink({ event: 'signin_link_opened', props: { channel: t[1], step: t[2] } })); })
    && vpaLinkTag('text', 'final') === '');
  check('the steps a reminder can be are signup, day3, day27 and final: "expiry" is no longer one (it falls back to what the caller names)', vpaLinkStep('expiry', 'day3') === 'day3' && vpaLinkStep('signup', 'x') === 'signup' && vpaLinkStep('day3', 'x') === 'day3' && vpaLinkStep('day27', 'x') === 'day27' && vpaLinkStep('final', 'x') === 'final' && vpaRetiredStep('expiry') === true && vpaRetiredStep('day27') === false);
  check('only a /s/<12 letters> address takes a tag; a long link or the text-code sign-in stays as it was', vpaTagUrl('venueplay.com.au/s/ABCDEFGHJKMN', 'tx') === 'venueplay.com.au/s/ABCDEFGHJKMN/tx' &&
    vpaTagUrl('https://venueplay.com.au/app/go#t=abc', 'tx') === 'https://venueplay.com.au/app/go#t=abc' && vpaTagUrl('https://venueplay.com.au/app/?signin=sms#m=0400555666', 'es') === 'https://venueplay.com.au/app/?signin=sms#m=0400555666'
    && vpaTagUrl('venueplay.com.au/s/ABCDEFGHJKMN', 'zz') === 'venueplay.com.au/s/ABCDEFGHJKMN');
  var SH = readFile('venueplay/s.html');
  check('the /s/ page reads the two letters after the link and sends them as via (and only two letters)', /\(\?:\\\/\(\[a-z0-9\]\{2\}\)\)\?/.test(SH) && /via \? \{ code: code, via: via \} : \{ code: code \}/.test(SH), SH.slice(0, 200));
  ENV.PROSPECT_SMS_ON = ''; ENV.MOBILEMESSAGE_USERNAME = ''; ENV.MOBILEMESSAGE_PASSWORD = '';

  /* NO MOBILE: the same screen, empty. The number they type is NEVER put on the login (security review 13 Nov 2026, A5):
     the login's own saved email gets a one-tap sign-in link, and they add their mobile after signing in. */
  world(); SMS = [];
  var n1 = await call('/autopilot/prospect', body({ name: 'No Mobile Hotel', return_signin_link: true }), AP);
  var nv = n1.body.venue.id, npr = DB.vp_prospects.filter(function (x) { return x.venue_id === nv; })[0];
  var nCode = CODE_IN(n1.body.signin.url), nLogin = AUTH.filter(function (u) { return u.id === npr.auth_user_id; })[0];
  var opN = await call('/short/open', { code: nCode }, NET7());
  check('UNCLAIMED, no mobile: the same sign-in screen with the mobile empty, told to keep the letters for it', opN.body.go === '/app/?signin=sms' && opN.body.attach === true && !nLogin.phone, opN.body);
  var atBad = await call('/short/attach', { code: nCode, mobile: '07 5228 3667' }, NET7());
  check('...a landline is refused, nothing put on the login', atBad.status === 400 && atBad.body.field === 'mobile' && !nLogin.phone, atBad.body);
  AUTH.push({ id: 'other-login', email: 'someone@else.example', phone: '61411222333' });
  var sentBefore = sent.length;
  var atOk = await call('/short/attach', { code: nCode, mobile: '0433 444 555' }, NET7());
  var mail = sent.slice(sentBefore);
  check('...the link\'s holder can NOT put a mobile on the login: nothing is written to it (A5)', atOk.status === 200 && atOk.body.emailed === true && atOk.body.ok === false && !nLogin.phone, [atOk.body, nLogin.phone]);
  check('...instead the login\'s OWN saved email gets one sign-in link, and never the typed mobile', mail.length === 1 && [].concat(mail[0].to).join() === String(nLogin.email) &&
    JSON.stringify(mail[0]).indexOf('0433') === -1 && JSON.stringify(mail[0]).indexOf('433444555') === -1, mail.map(function (m) { return m.to; }));
  var atTaken = await call('/short/attach', { code: nCode, mobile: '0411 222 333' }, NET7());
  check('...a mobile that is another venueplay login: the same answer, and still nothing written to either login', atTaken.status === 200 && atTaken.body.emailed === true && !nLogin.phone &&
    AUTH.filter(function (u) { return u.id === 'other-login'; })[0].phone === '61411222333', atTaken.body);
  /* The one place the link still puts a mobile on a login: /short/open, with the mobile WE hold for the account
     (Edit details). Never one that is already another login's. */
  npr.phone = '0411 222 333';   // the mobile HQ holds for this prospect is, by mistake, another login's
  var opT = await call('/short/open', { code: nCode }, NET7());
  check('...the mobile we hold for the account is never put on its login when it is another login\'s (no two logins on one number)',
    !nLogin.phone && !/#m=0411222333/.test(String(opT.body.go || '')), [opT.body, nLogin.phone]);
  npr.phone = null;
  check('...and each try is in HQ\'s audit, with the last three digits typed only', DB.vp_admin_audit.filter(function (a) { return /^short_link_email/.test(a.action) && a.target === 'venue:' + nv; }).every(function (a) { return a.detail && /^\d{3}$/.test(a.detail.typed_last3); }) &&
    DB.vp_admin_audit.filter(function (a) { return /^short_link_email/.test(a.action) && a.target === 'venue:' + nv; }).length === 2, DB.vp_admin_audit.slice(-2));

  /* EXPIRED, HQ BEFORE A CLAIM, A FRESH 90 DAYS */
  world(); SMS = [];
  var e1 = await call('/autopilot/prospect', body({ name: 'Ended Link Hotel', return_signin_link: true }), AP);
  var ev7 = e1.body.venue.id, epr = DB.vp_prospects.filter(function (x) { return x.venue_id === ev7; })[0], eCode = CODE_IN(e1.body.signin.url);
  var eHq = await call('/admin/signin-link', { venue_id: ev7 }, HQ);
  check('HQ\'s Resend before a claim: the same letters, the same end', eHq.status === 200 && CODE_IN(sent[sent.length - 1].html) === eCode && eHq.body.restarted === false, eHq.body);
  epr.created_at = new Date(Date.now() - 91 * 86400000).toISOString();
  var opE = await call('/short/open', { code: eCode }, NET7());
  var eHq2 = await call('/admin/signin-link', { venue_id: ev7 }, HQ);
  check('EXPIRED (their 90 days ended): the plain sign-in, and HQ\'s normal Resend is refused naming "Start a fresh 90 days"', opE.body.go === '/app/' && opE.body.state === 'ended' && eHq2.status === 409 && /Start a fresh 90 days/.test(eHq2.body.error || ''), [opE.body, eHq2.body]);
  var eFresh = await call('/admin/signin-link', { venue_id: ev7, fresh: true }, HQ);
  var cFresh = CODE_IN(sent[sent.length - 1].html);
  var opF = await call('/short/open', { code: cFresh }, NET7()), opOld = await call('/short/open', { code: eCode }, NET7());
  check('HQ "Start a fresh 90 days": NEW letters for a new 90 days that open the sign-in again; the old letters are dead, link_from moved',
    eFresh.status === 200 && eFresh.body.restarted === true && !!cFresh && cFresh !== eCode && /^\/app\/\?signin=sms/.test(opF.body.go) && opOld.body.go === '/app/' && opOld.body.state === 'none' && !!epr.link_from &&
    DB.vp_admin_audit.some(function (a) { return a.action === 'signin_link_sent' && a.detail && a.detail.fresh_30_days === true; }), [eFresh.body, opF.body, opOld.body]);

  /* GUESSING */
  var lim = []; for (var li = 0; li < 16; li++) lim.push((await call('/short/open', { code: 'ZZZZZZZZZZZ' + VPA_ALPHA_T[li % 31] }, { 'cf-connecting-ip': '198.19.9.9' })).status);
  check('GUESSED letters: 15 opens an hour from one network, then 429 (still sent to the plain sign-in)', lim.slice(0, 15).every(function (x) { return x === 200; }) && lim[15] === 429, lim);
  var burst = (DB.vp_help_tickets || []).filter(function (t) { return /Short sign-in links: a burst of wrong tries/.test(t.subject || t.title || ''); });
  var gl = []; for (var gi = 0; gi < 700; gi++) gl.push((await call('/short/open', { code: 'YYYYYYYYYYY' + VPA_ALPHA_T[gi % 31] }, { 'cf-connecting-ip': '198.20.' + (gi >> 6) + '.' + (gi & 63) })).status);
  burst = (DB.vp_help_tickets || []).filter(function (t) { return /Short sign-in links: a burst of wrong tries/.test(t.subject || t.title || ''); });
  check('...600 an hour from everywhere together, then 429; a burst of misses files ONE urgent HQ ticket (no venue, address or letters in it)',
    gl.indexOf(429) > 0 && gl.indexOf(429) <= 600 && burst.length === 1 && burst[0].priority === 'urgent' && !/YYYYYYYYYYY|@/.test(JSON.stringify(burst[0])), [gl.indexOf(429), burst.length]);
  world();
  var c5 = await call('/autopilot/prospect', body({ name: 'Two At Once Hotel' }), AP);
  var v5 = c5.body.venue.id, r5 = DB.vp_prospects.filter(function (x) { return x.venue_id === v5; })[0];
  r5.signin_code_enc = null; r5.signin_code_hash = null;
  var both5 = await Promise.all([vpaProspectOneLink(ENV, v5, r5.auth_user_id, {}), vpaProspectOneLink(ENV, v5, r5.auth_user_id, {})]);
  check('two sends at the same moment hand out the one set of letters that was kept', both5[0].token === both5[1].token && (await vpaOpenCode(ENV, r5.signin_code_enc)) === both5[0].token, both5.map(function (b) { return b && b.token; }));
  check('a sealed value from another secret, or junk, never opens', (await vpaOpenCode(Object.assign({}, ENV, { SIGNIN_LINK_SECRET: 'another-secret' }), epr.signin_code_enc)) === null && (await vpaOpenCode(ENV, 'v1.junk')) === null);
  MIG175 = false; ENV.PROSPECT_SMS_ON = ''; ENV.MOBILEMESSAGE_USERNAME = ''; ENV.MOBILEMESSAGE_PASSWORD = '';

  section('8. THE EASY WAY BACK IN BY THE VENUE CODE (Dean, 6 Nov 2026): /go/{code} is never a login key on its own');
  MIG175 = true; world();
  var g1 = await call('/autopilot/prospect', body({ name: 'Go Code Hotel' }), AP);
  var gv = DB.vp_venues.filter(function (x) { return x.id === g1.body.venue.id; })[0]; gv.join_code = 'GOC0DE';
  var gEmail = (DB.vp_prospects.filter(function (x) { return x.venue_id === gv.id; })[0] || {}).email;
  var NETG = function (n) { return { 'cf-connecting-ip': '192.0.2.' + n }; };
  var lk = await call('/venue-signin/lookup', { code: 'goc0de' }, NETG(1));
  var lk0 = await call('/venue-signin/lookup', { code: 'ZZZZZZ' }, NETG(1));
  var lkj = await call('/venue-signin/lookup', { code: '<script>' }, NETG(1));
  check('lookup: the venue\'s name for its code (any case), nothing else; an unknown or junk code is a plain 404',
    lk.status === 200 && lk.body.venue === 'Go Code Hotel' && Object.keys(lk.body).sort().join(',') === 'ok,venue' && lk0.status === 404 && lkj.status === 404, [lk.body, lk0.status, lkj.status]);
  var before8 = sent.length;
  var sd = await call('/venue-signin/send', { code: 'GOC0DE', email: 'attacker@evil.example' }, NETG(2));
  var gm = sent.slice(before8);
  check('send: ONE email, to the address ON THE ACCOUNT (never one the caller typed), with a long one-tap link of its own (never the short link)',
    sd.status === 200 && sd.body.ok === true && gm.length === 1 && String(gm[0].to).indexOf(gEmail) !== -1 && String(gm[0].to).indexOf('evil') === -1 && /\/app\/go#t=[A-Za-z0-9_-]{43}/.test(gm[0].html || '') && !/\/s\/[A-Z0-9]{12}/.test(gm[0].html || ''), [sd.body, gm.map(function (m) { return m.to; })]);
  check('SECURITY: the public code alone never yields a working login: the answer carries no link or token, and nothing about the account', !/go#t=|\/s\/|token|@/.test(JSON.stringify(sd.body)), sd.body);
  check('...and the answer says nothing about the account (no email, no mobile, no venue id)', JSON.stringify(sd.body) === '{"ok":true}', sd.body);
  var sd0 = await call('/venue-signin/send', { code: 'ZZZZZZ' }, NETG(3));
  check('an unknown code answers exactly the same, and nothing is sent', JSON.stringify(sd0.body) === '{"ok":true}' && sent.length === before8 + 1, sd0.body);
  await call('/venue-signin/send', { code: 'GOC0DE' }, NETG(4)); await call('/venue-signin/send', { code: 'GOC0DE' }, NETG(5));
  DB.vp_signin_links.forEach(function (l) { l.created_at = new Date(Date.now() - 2 * 86400000).toISOString(); });   // only the venue's own hourly limit may stop the 4th
  var n4 = sent.length; var sd4 = await call('/venue-signin/send', { code: 'GOC0DE' }, NETG(6));
  check('three sends an hour per venue: the 4th (from anywhere) answers the same and sends nothing', JSON.stringify(sd4.body) === '{"ok":true}' && sent.length === n4 && n4 === before8 + 3, [sent.length, n4, before8]);
  var lim = []; for (var gi = 0; gi < 7; gi++) lim.push((await call('/venue-signin/send', { code: 'ZZZZZ' + gi }, NETG(9))).status);
  check('six sends an hour per network, then 429', lim.slice(0, 6).every(function (x) { return x === 200; }) && lim[6] === 429, lim);
  var GP = readFile('venueplay/go-venue.html'), gjs = /<script>([\s\S]*?)<\/script>/.exec(GP)[1];
  var GPOST = [], GE = {}; ['goTitle', 'goSub', 'goSend', 'goMsg'].forEach(function (id) { GE[id] = { id: id, textContent: '', hidden: false, disabled: false, h: {}, addEventListener: function (e, f) { this.h[e] = f; } }; });
  var GW = { location: { pathname: '/go/goc0de', href: 'https://venueplay.com.au/go/goc0de', search: '', hash: '' }, document: { getElementById: function (id) { return GE[id]; } },
    fetch: function (u, o) { GPOST.push({ u: u, b: JSON.parse(o.body) }); return Promise.resolve({ status: 200, json: function () { return Promise.resolve(/lookup$/.test(u) ? { ok: true, venue: 'Go Code Hotel' } : { ok: true }); } }); } };
  (new Function('window', gjs.replace('(window);', '(window);')))(GW); drainMicrotasks();
  GE.goSend.h.click(); drainMicrotasks(); drainMicrotasks();
  check('the /go/ page: "Sign in to {venue}", it sends only the code (upper case), and says a link is on its way to whatever is on the account, nothing more',
    GE.goTitle.textContent === 'Sign in to Go Code Hotel' && GPOST.length === 2 && GPOST.every(function (x) { return JSON.stringify(x.b) === '{"code":"GOC0DE"}'; }) && /\/venue-signin\/send$/.test(GPOST[1].u) &&
    /If this venue's account has an email or mobile, a sign-in link is on its way there now\./.test(GE.goMsg.textContent) && !/@/.test(GE.goMsg.textContent), [GE.goTitle.textContent, GPOST, GE.goMsg.textContent]);
  check('_redirects serves /go/* from that page, with no referrer sent', /^\/go\/\*\s+\/go-venue\s+200$/m.test(readFile('venueplay/_redirects')) && /name="referrer" content="no-referrer"/.test(GP));
  MIG175 = false;

  section('5. HQ shows it');
  var src = readFile('venueplay/app/vp-prospects-hq.js');
  /* The line itself must be shown whenever the Worker sent words (a bare mention of p.delivery.words elsewhere
     in the card, e.g. inside prEsc, is not enough: that stayed green with the line switched off, 6 Nov). */
  check('HQ > Prospects has a Delivery line from the Worker\'s words', /\(p\.delivery && p\.delivery\.words \? '<div><span class="k">Delivery<\/span>/.test(src) && /prEsc\(p\.delivery\.words\)/.test(src));

  section('6. Every email gets a chip, and a resend DRAFT waits for Dean (Jobs row 226, 16 Nov 2026)');
  world(); N = 60;
  var DAYMS = 86400000, vn = [];
  for (var k6 = 0; k6 < 5; k6++) { r = await call('/admin/prospect', body({ send_in_minutes: 0 }), HQ); vn.push(r.body.venue); }
  function wRow(v) { return DB.vp_prospect_welcomes.filter(function (w) { return w.venue_id === v.id; })[0]; }
  function agoIso(d) { return new Date(Date.now() - d * DAYMS).toISOString(); }
  function pOf(L2, v) { return prospects(L2).filter(function (p) { return p.venue_id === v.id; })[0] || {}; }
  var bounced = vn[0], quiet = vn[1], fresh = vn[2], tapped = vn[3], follow = vn[4];
  RESEND_EVENTS[wRow(bounced).resend_id] = 'bounced';
  [quiet, tapped, follow].forEach(function (v) { RESEND_EVENTS[wRow(v).resend_id] = 'delivered'; });
  RESEND_EVENTS[wRow(fresh).resend_id] = 'delivered';
  [bounced, quiet, tapped, follow].forEach(function (v) { wRow(v).send_at = agoIso(4); });
  DB.vp_prospects.forEach(function (pr) { if (pr.venue_id === tapped.id) pr.created_at = agoIso(6); });   // set up 6 days ago, tapped 3 days ago
  DB.vp_admin_audit.push({ id: newId(), action: 'signin_link_used', target: 'venue:' + tapped.id, created_at: agoIso(3), detail: {} });
  var sentBefore = sent.length;
  var L6 = await call('/admin/prospects', {}, HQ);
  check('every prospect with a welcome has a welcome chip in plain words', pOf(L6, bounced).emails && pOf(L6, bounced).emails[0].kind === 'welcome' && /^Bounced at testcharlie\.example/.test(pOf(L6, bounced).emails[0].words) && pOf(L6, quiet).emails[0].words === 'Delivered, link not opened', [pOf(L6, bounced).emails, pOf(L6, quiet).emails]);
  var db0 = pOf(L6, bounced).resend_draft || {};
  check('a bounced welcome has a resend DRAFT FOR DEAN, with words ready, and its address marked not usable', db0.reason === 'bounced' && db0.label === 'DRAFT FOR DEAN' && db0.address_ok === false && /Cheers,\nDean$/.test(db0.text || ''), db0);
  var dq = pOf(L6, quiet).resend_draft || {};
  check('a welcome delivered 4 days ago and never opened has a "never_opened" draft, address fine', dq.reason === 'never_opened' && dq.address_ok === true && /haven't logged in yet/.test(dq.text), dq);
  check('NO draft when it was delivered today, or the link was opened', !pOf(L6, fresh).resend_draft && !pOf(L6, tapped).resend_draft, [pOf(L6, fresh).resend_draft, pOf(L6, tapped).resend_draft]);
  check('drafts have no long dash and venueplay is lowercase', !/[\u2014\u2013]/.test(dq.text + db0.text) && !/VenuePlay/.test(dq.text + db0.text));
  check('listing the drafts sent NOTHING (a draft never sends by itself)', sent.length === sentBefore, sent.slice(sentBefore));
  var rd = function (v, o, h) { return call('/admin/prospect/resend-draft', Object.assign({ venue_id: v.id }, o), h === undefined ? HQ : h); };
  var x6 = await rd(quiet, { decision: 'yes' }, {});
  check('no HQ login: refused, nothing sent', x6.status === 401 && sent.length === sentBefore, x6);
  x6 = await rd(quiet, { decision: 'yes' }, AP);
  check('the autopilot key is not an HQ login: refused, nothing sent', (x6.status === 401 || x6.status === 403) && sent.length === sentBefore, x6);
  x6 = await rd(bounced, { decision: 'yes' });
  check('Yes on a bounced address is refused (change the address first), nothing sent', x6.status === 409 && /Edit details/.test(x6.body.error || '') && sent.length === sentBefore, x6);
  x6 = await rd(fresh, { decision: 'yes' });
  check('Yes where there is no draft is refused, nothing sent', x6.status === 409 && sent.length === sentBefore, x6);
  x6 = await rd(quiet, { decision: 'yes', text: 'Hey there, this has a long dash \u2014 in it, so it must not go out.' });
  check('words with a long dash are refused, nothing sent', x6.status === 400 && sent.length === sentBefore, x6);
  x6 = await rd(quiet, { decision: 'yes', text: 'Hey Sam, edited by Dean. Your link is below and expires in {days} days.\n\nCheers,\nDean' });
  var em = sent[sent.length - 1] || {};
  check('Yes with Edit: the edited words go to their login address with a sign-in button', x6.status === 200 && sent.length === sentBefore + 1 && /^sam\d+@testcharlie\.example$/.test(String(em.to)) && /edited by Dean/.test(String(em.html || '')) && /app\/go#t=/.test(String(em.html || '')), [x6, em.to]);
  check('...with the days filled in, not {days}', !/\{days\}/.test(String(em.html || '')) && /expires in 9\d days/.test(String(em.html || '')));
  check('...and audited as prospect_resend_draft_sent, flagged edited', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_resend_draft_sent' && a.target === 'venue:' + quiet.id && a.detail && a.detail.edited === true; }));
  L6 = await call('/admin/prospects', {}, HQ);
  check('afterwards: the draft is gone and a chip says it went, "Sent, no bounce reported" (never "Delivered")', !pOf(L6, quiet).resend_draft && pOf(L6, quiet).emails[0].kind === 'prospect_resend_draft_sent' && pOf(L6, quiet).emails[0].words === 'Sent, no bounce reported', pOf(L6, quiet).emails);
  DB.vp_admin_audit.push({ id: newId(), action: 'email_bounced', target: 'venue:' + quiet.id, created_at: new Date(Date.now() + 2000).toISOString(), detail: { address: pOf(L6, quiet).email, reason: '550 gone' } });
  L6 = await call('/admin/prospects', {}, HQ);
  check('a bounce after the resend turns its chip red (bounced) and a new draft asks for a new address', pOf(L6, quiet).emails[0].state === 'bounced' && (pOf(L6, quiet).resend_draft || {}).reason === 'bounced' && pOf(L6, quiet).resend_draft.address_ok === false, [pOf(L6, quiet).emails[0], pOf(L6, quiet).resend_draft]);
  x6 = await rd(follow, { decision: 'no' });
  L6 = await call('/admin/prospects', {}, HQ);
  check('No hides the draft and is audited; nothing sent', x6.status === 200 && !pOf(L6, follow).resend_draft && DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_resend_draft_dismissed' && a.target === 'venue:' + follow.id; }) && sent.length === sentBefore + 1, x6);
  /* a follow-up Dean approved earlier: its chip follows the bounce record and the tap */
  DB.vp_admin_audit.push({ id: newId(), action: 'prospect_nudge_sent', target: 'venue:' + tapped.id, created_at: agoIso(1), detail: { to: pOf(L6, tapped).email } });
  L6 = await call('/admin/prospects', {}, HQ);
  check('a prospect with only a welcome has exactly one chip (the follow-up chips come from what was actually sent)', pOf(L6, follow).emails.length === 1 && pOf(L6, follow).emails[0].kind === 'welcome', pOf(L6, follow).emails);
  var tp = pOf(L6, tapped).emails.filter(function (e) { return e.kind === 'prospect_nudge_sent'; })[0] || {};
  check('a follow-up sent after the only tap is "Sent, no bounce reported", not opened', tp.state === 'sent' && tp.words === 'Sent, no bounce reported' && tp.label === 'Follow-up email', tp);
  DB.vp_admin_audit.push({ id: newId(), action: 'signin_link_used', target: 'venue:' + tapped.id, created_at: new Date().toISOString(), detail: {} });
  L6 = await call('/admin/prospects', {}, HQ);
  check('...and "Link opened, not signed in yet" once they tap after it', (pOf(L6, tapped).emails.filter(function (e) { return e.kind === 'prospect_nudge_sent'; })[0] || {}).state === 'opened');
  var stq = DB.vp_venue_staff.filter(function (s) { return s.venue_id === quiet.id; })[0];
  AUTH.filter(function (u) { return u.id === stq.auth_user_id; })[0].last_sign_in_at = new Date(Date.now() + 5000).toISOString();
  L6 = await call('/admin/prospects', {}, HQ);
  check('signed in: no draft, and every chip says Signed in', !pOf(L6, quiet).resend_draft && pOf(L6, quiet).emails.every(function (e) { return e.state === 'signed_in'; }), pOf(L6, quiet).emails);
  x6 = await rd(quiet, { decision: 'yes' });
  check('Yes after they signed in is refused, nothing sent', x6.status === 409 && sent.length === sentBefore + 1, x6);

  section('7. The HQ pane draws the chips and the draft with Yes / Edit / No');
  var PANE7 = readFile('venueplay/app/vp-prospects-hq.js');
  var W7 = { VP: null, fetch: function () { return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve({}); } }); }, setTimeout: function () {}, CustomEvent: function () {} };
  W7.document = { readyState: 'complete', getElementById: function () { return null; }, addEventListener: function () {} };
  (new Function('window', PANE7))(W7);
  var T7 = W7.VPProspects._t;
  var card = T7.cardHtml({ venue_id: U(70), name: 'Chip <i>Hotel</i>', email: 'a@b.example', status: 'not_signed_in', created_at: '2026-11-10T00:00:00Z', days_since_setup: 6, sign_in_known: true,
    emails: [{ kind: 'prospect_nudge_sent', label: 'Follow-up email', at: '2026-11-14T01:00:00Z', state: 'bounced', words: 'Bounced at b.example' }, { kind: 'welcome', label: 'Welcome email', at: '2026-11-10T01:00:00Z', state: 'delivered', words: 'Delivered, link not opened' }],
    resend_draft: { reason: 'bounced', label: 'DRAFT FOR DEAN', to: 'a@b.example', address_ok: false, text: 'Hey there,\n\nline <b>two</b>', why: 'The email to a@b.example bounced.' } });
  check('a chip per email, red for a bounce, the label and the Worker\'s words', /data-pr-mail="bounced"[^>]*><b>Follow-up email<\/b>[^<]*Bounced at b\.example/.test(card) && /data-pr-mail="delivered"[^>]*><b>Welcome email<\/b>[^<]*Delivered, link not opened/.test(card) && /prmail bad/.test(card), card);
  check('the draft is labelled DRAFT FOR DEAN, escaped, with Yes / Edit / No and a "Draft waiting" badge', /DRAFT FOR DEAN/.test(card) && /data-pr-draft-yes=/.test(card) && /data-pr-draft-edit=/.test(card) && /data-pr-draft-no=/.test(card) && /Draft waiting/.test(card) && card.indexOf('<b>two</b>') === -1 && card.indexOf('Chip &lt;i&gt;Hotel') !== -1, card);
  check('a bounced address cannot be sent to: Yes is disabled in the pane', /data-pr-draft-yes="[^"]*" disabled/.test(card), card);
  var card2 = T7.cardHtml({ venue_id: U(71), name: 'Plain Pub', email: 'p@p.example', status: 'not_signed_in', created_at: '2026-11-10T00:00:00Z', days_since_setup: 6, sign_in_known: true });
  check('no emails and no draft: no chips, no draft, no badge (old Worker or nothing sent)', !/prmails|prdraft|Draft waiting/.test(card2), card2);

  if (bad) throw new Error('signin in thread: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
