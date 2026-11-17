/* HQ "RESEND SIGN-IN LINK" FOR A QUICK SIGN-UP GOES BY TEXT, RUN AND NOT WORD-SEARCHED (18 Nov 2026; rehearsal v6 'Gap').

   A quick sign-up's login carries a placeholder address on phone.venueplay.com.au (VPQ_PLACEHOLDER_DOMAIN). It is never
   a mailbox, so HQ's Resend sign-in link used to try to mail it, the outbox guard refused, and HQ was shown a did-not-send
   error with the placeholder in it. Hosts sign in by PHONE: now the link goes by TEXT to the self sign-up's code-checked
   mobile. Runs the REAL billing Worker (tools/rig-billing-worker.js) through the real POST /admin/signin-link against the
   rig's fake database, a fake Mobile Message and the rig's fake Resend. Nothing real is ever texted or emailed. Proves:
     1. placeholder login + code-checked self sign-up mobile: ONE text, no Resend call, texted:true, the last 3 digits only
     2. placeholder login + no code-checked mobile (not a self sign-up, or no mobile on the account record): nothing sent,
        no link made or retired, and HQ's message never shows the placeholder address
     3. a real email: the email path exactly as before (one email to that address, no text unless asked)
     4. an opted-out mobile (recorded, or the provider says blocked): never texted, the last 3 digits only
     5. outside texting hours (a Sunday): nothing sent, HQ told when to press again
     6. any other caller (the sign-in page's "Send me a new link") with a placeholder: no email, no link made
     7. the HQ page shows "Texted the sign-in link to the mobile ending ...NNN" (its own function, run)

   Run from the repo root:  jsc tools/test-hq-resend-signin-text.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
if (typeof btoa === 'undefined') { btoa = function (s) { var B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = ''; for (var i = 0; i < s.length; i += 3) { var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2); var n = (a << 16) | ((b || 0) << 8) | (c || 0); o += B[(n >> 18) & 63] + B[(n >> 12) & 63] + (isNaN(b) ? '=' : B[(n >> 6) & 63]) + (isNaN(c) ? '=' : B[n & 63]); } return o; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
var rs = 0x2545F491;
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b.buffer ? b : b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; a[i] = rs & 255; } return a; } };

/* The clock: 11am Brisbane on a Tuesday (inside texting hours), or a Sunday for section 5. */
var REAL_NOW = Date.now, NOW = 0;
Date.now = function () { return NOW; };
function bneAt(dayOfWeek, hour) {
  var day = vpaBneDay(REAL_NOW.call(Date));
  for (var i = 0; i < 7 && vpaWeekday(day) !== dayOfWeek; i++) day = vpaAddDays(day, 1);
  return vpaBneDayStartMs(day) + hour * 3600000;
}

/* Everything that leaves the Worker, OUTSIDE the outbox guard: every Resend call (even one the guard would refuse) and
   every text to the fake Mobile Message. */
var MM = [], RESEND = [];
var _prevFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('api.resend.com') !== -1) RESEND.push(JSON.parse(opts.body));
  if (u.indexOf('api.mobilemessage.com.au/v1/messages') !== -1) {
    var m = JSON.parse(opts.body).messages[0]; MM.push(m);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [{ status: m.to === '+61499999999' ? 'blocked' : 'success', message_id: 'mm_' + MM.length }] }); } });
  }
  if (u.indexOf('rest.clicksend.com') !== -1) { MM.push({ clicksend: true }); return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } }); }
  return _prevFetch(url, opts);
};
function U(nn) { return '54000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), QUICK = U(1), REAL = U(2), HQMADE = U(3);
var VQ = U(101), VR = U(102), VH = U(103), FQ = U(201), FR = U(202), FH = U(203);
var PH = 'q-7f3a9c@phone.venueplay.com.au', PH2 = 'q-0b1d2e@phone.venueplay.com.au';
function as(user, body) { var h = { Authorization: user ? 'Bearer ' + user : '' }, txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); } }; }
function world(o) {
  o = o || {};
  DB = {}; sent.length = 0; FAIL = {}; MM = []; RESEND = [];
  NOW = bneAt(2, 11);
  ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass'; delete ENV.CLICKSEND_USERNAME; delete ENV.CLICKSEND_API_KEY;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.auth = [{ id: QUICK, email: PH, phone: '', user_metadata: { full_name: 'Sam Jones', placeholder_email: true } },
             { id: REAL, email: 'gm@realpub.example', phone: '', user_metadata: { full_name: 'Robin' } },
             { id: HQMADE, email: PH2, phone: '', user_metadata: {} }];
  DB.vp_venues = [{ id: VQ, name: 'The Grand Hotel', slug: 'grand', founding_id: FQ }, { id: VR, name: 'Real Pub', slug: 'real', founding_id: FR },
                  { id: VH, name: 'Lead Data Arms', slug: 'lead', founding_id: FH }];
  DB.venueplay_founding = [{ id: FQ, venue_name: 'The Grand Hotel', contact_email: '', mobile: ('mobile' in o) ? o.mobile : '0412 345 678' },
                           { id: FR, venue_name: 'Real Pub', contact_email: 'gm@realpub.example', mobile: '0412 000 111' },
                           { id: FH, venue_name: 'Lead Data Arms', contact_email: '', mobile: '0412 000 222' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: QUICK, venue_id: VQ, role: 'owner', display_name: 'Sam' },
                       { id: 's2', auth_user_id: REAL, venue_id: VR, role: 'owner', display_name: 'Robin' },
                       { id: 's3', auth_user_id: HQMADE, venue_id: VH, role: 'owner', display_name: 'Lead' }];
  DB.vp_prospects = [{ venue_id: VQ, auth_user_id: QUICK, source: ('source' in o) ? o.source : 'self', email: null, phone: '0412345678', contact_name: 'Sam Jones' },
                     { venue_id: VH, auth_user_id: HQMADE, source: 'hq', email: null, phone: '0412000222', contact_name: 'Lead' }];
  DB.vp_signin_links = []; DB.vp_admin_audit = [];
}
function hq(venueId, extra) { var b = { venue_id: venueId }; for (var k in (extra || {})) b[k] = extra[k]; return vpaAdminSigninLink(as(ADMIN, b), ENV, J); }
function noFull(x) { var s = JSON.stringify(x); return s.indexOf('412345678') === -1 && s.indexOf('0412 345 678') === -1; }
function noPlaceholder(x) { return JSON.stringify(x).toLowerCase().indexOf('phone.venueplay.com.au') === -1; }
function links(user) { return DB.vp_signin_links.filter(function (r) { return r.auth_user_id === user; }); }

(async function () {
  section('1. A quick sign-up (placeholder login) with a code-checked mobile: the link goes by TEXT');
  world();
  var r = await hq(VQ, { text: true });
  var t = MM[0] || {};
  check('200, texted: true (the same flag as Approve), and the last 3 digits only', r.status === 200 && r.body.ok === true && r.body.texted === true && r.body.mobile_last3 === '678', r);
  check('ONE text, to the mobile on the account record (the one that passed the sign-up code), from the venueplay sender', MM.length === 1 && t.to === '+61412345678' && t.sender === 'venueplay', MM);
  check('NO Resend call at all: the placeholder is never handed to the mail provider, not even to be refused by the guard', RESEND.length === 0 && sent.length === 0, RESEND);
  check('HQ is told "Texted the sign-in link to the mobile ending ...678"', /^Texted the sign-in link to the mobile ending \.\.\.678(, link works until [^.]+)?\.$/.test(r.body.line || ''), r.body.line);
  check('the answer never holds the full mobile or the placeholder address', noFull(r.body) && noPlaceholder(r.body) && !('to' in r.body && r.body.to), r.body);
  check('the text carries a one-use sign-in link with no address in it, and never says it was emailed', /\/app\/go#t=[A-Za-z0-9_-]+/.test(t.message || '') && !/[#&]e=/.test(t.message || '') && !/emailed/i.test(t.message || '') && noPlaceholder(t.message), t.message);
  check('the text names venueplay and keeps the opt-out (the provider\'s own link), no em dash', /venueplay sign-in link/.test(t.message || '') && /\{optout\}/.test(t.message || '') && !/[—–]/.test(t.message || ''), t.message);
  check('one live link for the login (made for this text)', links(QUICK).filter(function (x) { return !x.used_at; }).length === 1, links(QUICK));
  var au = DB.vp_admin_audit.filter(function (a) { return a.action === 'signin_link_sent'; });
  check('the audit row: texted, the last 3 digits, never the number or the placeholder', au.length === 1 && au[0].detail.texted === true && au[0].detail.to_last3 === '678' && noFull(au) && noPlaceholder(au), au);
  check('never a second text from the old "and by text" step (text: true asked, ONE text went)', MM.length === 1, MM.length);

  section('2. No code-checked mobile: nothing sent, and HQ never sees the placeholder');
  var NOMOB = 'No email on file and no verified mobile: ask the venue to sign in with their mobile';
  world({ mobile: null });
  var n1 = await hq(VQ, { text: true });
  check('a self sign-up with no mobile on its account record: 400, the plain message', n1.status === 400 && n1.body.error === NOMOB, n1);
  check('nothing texted, nothing emailed, no link made or retired', MM.length === 0 && RESEND.length === 0 && DB.vp_signin_links.length === 0, [MM, RESEND, DB.vp_signin_links]);
  check('the message and the audit never show the placeholder address', noPlaceholder(n1.body) && noPlaceholder(DB.vp_admin_audit), [n1.body, DB.vp_admin_audit]);
  world();
  DB.vp_signin_links.push({ id: 'old1', auth_user_id: HQMADE, venue_id: VH, token_hash: 'h-old', used_at: null, created_at: new Date(NOW - 3 * 86400000).toISOString(), expires_at: new Date(NOW + 30 * 86400000).toISOString() });
  var n2 = await hq(VH, { text: true });
  check('NOT a self sign-up (HQ set it up, a phone from lead data): never texted, the same plain message', n2.status === 400 && n2.body.error === NOMOB && MM.length === 0 && RESEND.length === 0, [n2, MM]);
  check('and their older link still works (refused BEFORE any link is retired)', DB.vp_signin_links.length === 1 && !DB.vp_signin_links[0].used_at, DB.vp_signin_links);
  var others = [];
  for (var src of ['hq', 'offer', 'autopilot', undefined, '']) {
    world({ source: src });
    var n3 = await hq(VQ, { text: true });
    others.push({ src: String(src), status: n3.status, mm: MM.length, err: n3.body.error, full: !noFull([n3.body, DB.vp_admin_audit]) });
  }
  check('the same placeholder login and a verified-looking mobile on the account, but the row is NOT source self (hq, offer, autopilot, missing, empty): never texted, the plain message, never the number',
    others.every(function (o) { return o.status === 400 && o.mm === 0 && o.err === NOMOB && !o.full; }), others);

  section('3. A real email: the email path exactly as before');
  world();
  var e1 = await hq(VR);
  check('200, to the real address, ONE email, no text', e1.status === 200 && e1.body.to === 'gm@realpub.example' && !e1.body.texted && sent.length === 1 && sent[0].to[0] === 'gm@realpub.example' && MM.length === 0, [e1, sent.length, MM]);
  check('its subject and button are the sign-in link email\'s', sent[0].subject === 'Your venueplay sign-in link' && /\/app\/go#t=/.test(sent[0].html || ''), sent[0] && sent[0].subject);
  check('the email\'s link still carries their address (e=), as before', /#t=[A-Za-z0-9_-]+&amp;e=gm%40realpub\.example|#t=[A-Za-z0-9_-]+&e=gm%40realpub\.example/.test(sent[0].html || ''), (sent[0].html || '').slice(0, 200));

  section('4. An opted-out mobile is never texted');
  world();
  DB.vp_admin_audit.push({ id: 'oo', action: 'sms_opted_out', target: 'sms:+61412345678', detail: {} });
  var o1 = await hq(VQ, { text: true });
  check('recorded opt-out: 409, no text, no email, no link made', o1.status === 409 && MM.length === 0 && RESEND.length === 0 && DB.vp_signin_links.length === 0, [o1, MM]);
  check('HQ is told the mobile ending ...678 opted out, never the number or the placeholder', /mobile ending \.\.\.678 has opted out/.test(o1.body.error || '') && noFull(o1.body) && noPlaceholder(o1.body), o1.body);
  world({ mobile: '0499 999 999' });
  var o2 = await hq(VQ, { text: true });
  check('the provider says blocked: not sent, recorded as opted out, the link it made retired', o2.status === 409 && /ending \.\.\.999 has opted out/.test(o2.body.error || '') &&
    DB.vp_admin_audit.some(function (a) { return a.action === 'sms_opted_out' && a.target === 'sms:+61499999999'; }) && links(QUICK).every(function (x) { return !!x.used_at; }), [o2, DB.vp_signin_links]);

  section('5. Outside texting hours: nothing sent, HQ told when');
  world(); NOW = bneAt(0, 11);
  var h1 = await hq(VQ, { text: true });
  check('a Sunday: 409, no text, no link made, "Press again after" the next allowed time', h1.status === 409 && MM.length === 0 && DB.vp_signin_links.length === 0 && /texts go 9am to 8pm, not Sundays\. Press again after 9:00am Mon/.test(h1.body.error || ''), h1);
  world(); delete ENV.MOBILEMESSAGE_USERNAME; delete ENV.MOBILEMESSAGE_PASSWORD;
  var h2 = await hq(VQ, { text: true });
  check('no text provider: 503, nothing sent, no link made', h2.status === 503 && MM.length === 0 && RESEND.length === 0 && DB.vp_signin_links.length === 0, h2);

  section('6. Any other caller with a placeholder login: no email, no link');
  world();
  var s1 = await vpaSendSigninLink(ENV, QUICK, VQ, { self: true });
  check('the sign-in page\'s "Send me a new link": no_email, nothing sent, no link made', s1.ok === false && s1.reason === 'no_email' && RESEND.length === 0 && MM.length === 0 && DB.vp_signin_links.length === 0, s1);
  var s2 = await vpaSendSigninLink(ENV, QUICK, VQ, { hqCap: true, nudge: 'Hi {days}', subject: 'x' });
  check('an automatic follow-up: no_email, nothing sent', s2.ok === false && s2.reason === 'no_email' && RESEND.length === 0 && MM.length === 0, s2);
  check('the sign-in text\'s words: "We\'ve emailed it too" only when an email went', /We've emailed it too/.test(vpaSigninTextBody('Sam', 'X', 'https://v/s/abc', NOW + 86400000 * 5)) &&
    !/emailed/.test(vpaSigninTextBody('Sam', 'X', 'https://v/s/abc', NOW + 86400000 * 5, true)));

  section('7. The HQ page says it was texted, last 3 digits only');
  var HQ = readFile('venueplay/app/hq.html');
  var fn = /function hqTextedWords\(r\)\{[\s\S]*?\n  \}/.exec(HQ);
  check('hq.html has its own hqTextedWords', !!fn);
  var hqTextedWords = fn ? (0, eval)('(' + fn[0] + ')') : function () { return ''; };
  check('"Texted the sign-in link to the mobile ending ...678, link works until Fri 4 Dec."', hqTextedWords({ mobile_last3: '678', expires_words: 'Fri 4 Dec' }) === 'Texted the sign-in link to the mobile ending ...678, link works until Fri 4 Dec.', hqTextedWords({ mobile_last3: '678', expires_words: 'Fri 4 Dec' }));
  check('handed a whole number by mistake, it still shows the last 3 digits only', hqTextedWords({ mobile_last3: '+61412345678' }) === 'Texted the sign-in link to the mobile ending ...678.', hqTextedWords({ mobile_last3: '+61412345678' }));
  var both = HQ.split('if(r.texted){ vpTell(').length - 1;
  check('both HQ buttons (Resend sign-in link, Start a fresh 90 days) show it before the "The email went to" line', both === 2 &&
    HQ.indexOf('if(r.texted){ vpTell(hqTextedWords(r));') < HQ.indexOf('"\\n\\nThe email went to "+r.to'), both);

  if (bad) throw new Error('hq resend signin text: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
