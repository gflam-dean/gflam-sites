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
    /Our emails come from <strong>hello@send\.venueplay\.com\.au<\/strong>, so keep an eye out for them/.test(String(wl.html || '')) && /hello@send\.venueplay\.com\.au/.test(String(wl.from || '')), [wl.from, String(wl.html || '').slice(0, 200)]);
  check('the link ends with their 30 days, and says when', r.body.signin.days_left >= 29 && !!r.body.signin.expires_words, r.body.signin);
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
  check('their 30 days were NOT restarted (no link_from)', !DB.vp_prospects[0].link_from, DB.vp_prospects[0]);
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
  check('the text carries a one-tap sign-in link and Dean\'s words, with the opt-out as Mobile Message\'s own link', /^Welcome to venueplay! Your account for Test Charlie Yes Hotel is ready\. Tap to sign in: $/.test((sms.message || '').split('venueplay.com.au/s/')[0]) && /\/s\/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8} /.test(sms.message || '') && /\{optout\}$/.test(sms.message || '') && (sms.message || '').indexOf('{link}') === -1, sms.message);
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

  section('5. HQ shows it');
  var src = readFile('venueplay/app/vp-prospects-hq.js');
  /* The line itself must be shown whenever the Worker sent words (a bare mention of p.delivery.words elsewhere
     in the card, e.g. inside prEsc, is not enough: that stayed green with the line switched off, 6 Nov). */
  check('HQ > Prospects has a Delivery line from the Worker\'s words', /\(p\.delivery && p\.delivery\.words \? '<div><span class="k">Delivery<\/span>/.test(src) && /prEsc\(p\.delivery\.words\)/.test(src));

  if (bad) throw new Error('signin in thread: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
