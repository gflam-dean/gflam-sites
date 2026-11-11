/* THE EMAIL BACKUP FOR PHONE SIGN-IN, THE WORKER HALF (Dean, 5 Nov 2026 items 63 to 67; 9 Nov item 102), RUN.

   POST /auth/email-backup { mobile } is what the sign-in page's "Code not arriving? Get it by email instead"
   calls. It runs on the REAL billing Worker code (tools/rig-billing-worker.js) and holds it to:

     (a) it only ever sends to the email ALREADY SAVED on the login that owns that mobile. An address typed in
         the request (in any field, or in the mobile field itself) is never read and never receives anything;
     (b) ONE answer ({ ok:true }) whatever happens: no login, no email saved, off every venue, banned, ended,
         over a limit, or sent, so a stranger holding a mobile learns nothing; and the same minimum time;
     (c) rate limits: per network (429, about the caller only), per mobile, per login (4 links a day);
     (d) HQ can see it (an audit row) with only the last 3 digits of a mobile, never an address or a token;
     (e) a person with a mobile and no email is asked for their OWN email at first sign-in, optionally,
         saved on their login only (the page half is in tools/test-email-step.js).

   Run from the repo root:  jsc tools/test-email-backup.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
function settle() { for (var i = 0; i < 12; i++) drainMicrotasks(); }
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
var rs = 0x2545F491;
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b.buffer ? b : b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; a[i] = rs & 255; } return a; } };
var LOGS = [];
console.log = console.warn = console.error = function () { LOGS.push(Array.prototype.join.call(arguments, ' ')); };
var GEN = [];
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('/auth/v1/admin/generate_link') !== -1) {
    var g = JSON.parse(opts.body); GEN.push(g);
    var who = tbl('auth').filter(function (x) { return x.email === g.email; })[0];
    return Promise.resolve(who ? { ok: true, status: 200, json: function () { return Promise.resolve({ hashed_token: 'hashed-' + who.id, verification_type: 'magiclink' }); } }
      : { ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  }
  if (u.indexOf('/auth/v1/admin/users') !== -1 && method === 'POST') {   // a new login, email and maybe mobile, as Auth makes one
    var nb = JSON.parse(opts.body), nph = nb.phone ? String(nb.phone).replace('+', '') : '';
    if (tbl('auth').some(function (x) { return (nb.email && x.email === nb.email) || (nph && x.phone === nph); })) return Promise.resolve({ ok: false, status: 422, json: function () { return Promise.resolve({ msg: 'already registered' }); } });
    var nu = { id: newId(), email: nb.email || '', phone: nph, user_metadata: nb.user_metadata || {} }; tbl('auth').push(nu);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(nu); } });
  }
  if (/\/rest\/v1\/vp_signin_links/.test(u) && method === 'PATCH' && /return=representation/.test(((opts && opts.headers) || {}).Prefer || '')) {
    var q = parseQ(u.split('?')[1] || ''), set = JSON.parse(opts.body), got = [];
    tbl('vp_signin_links').forEach(function (r) { if (match(r, q)) { for (var k in set) r[k] = set[k]; got.push({ auth_user_id: r.auth_user_id, venue_id: r.venue_id }); } });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(got); } });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '53000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), AMIT = U(1), PAT = U(2), HOSTY = U(3), V1 = U(101), V2 = U(102), V3 = U(103);
var IPN = 0;
function pub(path, body, ip) { var txt = JSON.stringify(body || {}), addr = ip || ('203.0.113.' + (++IPN % 250));
  return { url: 'https://api' + path, headers: { get: function (k) { return k === 'cf-connecting-ip' ? addr : ''; } }, text: function () { return Promise.resolve(txt); } }; }
function as(user, body) { var h = { Authorization: user ? 'Bearer ' + user : '' }, txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); } }; }
function hrefs(html) { var out = [], re = /href="([^"]+)"/g, m; while ((m = re.exec(html))) out.push(m[1].replace(/&amp;/g, '&')); return out; }
function tokenOf(html) { var h = hrefs(html).filter(function (x) { return x.indexOf('/app/go#t=') !== -1; })[0] || ''; var m = /#t=([A-Za-z0-9_-]+)/.exec(h); return m ? m[1] : ''; }
function world() {
  DB = {}; sent.length = 0; FAIL = {}; GEN = []; LOGS = [];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.auth = [{ id: AMIT, email: 'amit@caz.example', phone: '', user_metadata: { full_name: 'Amit Shah' } },
             { id: PAT, email: 'pat@other.example', phone: '61400111222', user_metadata: {} },
             { id: HOSTY, email: '', phone: '61400333444', user_metadata: {} }];
  DB.vp_venues = [{ id: V1, name: "Caz Reitop's Dirty Secrets", slug: 'caz' }, { id: V2, name: 'The Other Arms', slug: 'other' }, { id: V3, name: 'Hosts Only Hotel', slug: 'hosts' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: AMIT, venue_id: V1, role: 'manager', display_name: 'Manager' },
                       { id: 's2', auth_user_id: PAT, venue_id: V2, role: 'owner', display_name: 'Pat' },
                       { id: 's3', auth_user_id: HOSTY, venue_id: V3, role: 'owner', display_name: 'Hosty' }];
  DB.vp_prospects = [{ venue_id: V1, auth_user_id: AMIT, email: 'amit@caz.example' }];
  DB.vp_signin_links = []; DB.vp_admin_audit = [];
}
async function oldLink(user, venue, usedAgoMs, expired) {
  var t = await vpaMintSigninLink(ENV, user, venue, Date.now());
  var r = DB.vp_signin_links[DB.vp_signin_links.length - 1];
  r.created_at = new Date(Date.now() - 3 * 86400000).toISOString();
  if (usedAgoMs !== undefined) r.used_at = new Date(Date.now() - usedAgoMs).toISOString();
  if (expired) r.expires_at = new Date(Date.now() - 1000).toISOString();
  return t;
}
function liveLinks(user) { var now = Date.now(); return DB.vp_signin_links.filter(function (r) { return r.auth_user_id === user && !r.used_at && Date.parse(r.expires_at) > now; }); }
function U2(nn) { return U(nn); }
var WN = 0, AMIT_PHONE = '', AMIT_PH = '';
(async function () {
  function wd() {
    WN++; AMIT_PHONE = '+614005' + ('00000' + (50000 + WN)).slice(-5) + '0'.slice(0,0); AMIT_PH = AMIT_PHONE.slice(1);   // a new mobile each world, so the per-mobile limit starts fresh
    world();
    DB.auth[0].phone = AMIT_PH;                       // Amit: manager at Caz, email saved, mobile on his login
    DB.auth.push({ id: U(4), email: 'banned@caz.example', phone: '61400777888', banned_until: new Date(Date.now() + 86400000).toISOString(), user_metadata: {} });
    DB.vp_venue_staff.push({ id: 's4', auth_user_id: U(4), venue_id: V1, role: 'host', display_name: 'Banned' });
    DB.auth.push({ id: U(5), email: 'off@caz.example', phone: '61400999000', user_metadata: {} });   // email + mobile, but on no venue
  }
  var delays = [];
  setTimeout = function (cb, ms) { delays.push(ms); cb(); return 0; };
  ENV.VPA_EMAIL_BACKUP_MIN_MS = undefined;
  var SAME = JSON.stringify({ ok: true });
  function post(body, ip) { return vpaEmailBackup(pub('/auth/email-backup', body, ip), ENV, J); }

  section('1. It sends only to the email already saved on that login');
  wd();
  var r = await post({ mobile: '0' + AMIT_PHONE.slice(3), email: 'evil@evil.example', e: 'evil2@evil.example', to: 'evil3@evil.example', address: 'evil4@evil.example' });
  var mail = sent[0] || {};
  check('a known mobile: { ok:true } and ONE email, to the saved address only, never to any address put in the request',
    r.status === 200 && JSON.stringify(r.body) === SAME && sent.length === 1 && mail.to.length === 1 && mail.to[0] === 'amit@caz.example', [r, sent.map(function (m) { return m.to; })]);
  var fresh = tokenOf(mail.html || '');
  check('it is the one-tap sign-in link (a fresh one-use link for his venue), with no code to type and no email-code sign-in anywhere',
    /^[A-Za-z0-9_-]{43}$/.test(fresh) && mail.subject === 'Your venueplay sign-in link' && hrefs(mail.html).every(function (h) { return h.indexOf('signin=email') === -1; }) && liveLinks(AMIT).length === 1);
  check('no email address from the request is anywhere in what was sent or stored', JSON.stringify([sent, DB.vp_signin_links, DB.vp_admin_audit]).toLowerCase().indexOf('evil') === -1);
  var ok = await vpaHandleOneClick(pub('/auth/one-click', { t: fresh }), ENV, J);
  check('and the link signs him in once, like any other', ok.status === 200 && ok.body.ok === true && ok.body.venue_id === V1, ok);

  wd();
  await post({ mobile: 'evil@evil.example' });
  await post({ mobile: 'amit@caz.example' });
  await post({ mobile: ['amit@caz.example'] });
  await post({ email: 'amit@caz.example' });
  await post({ e: 'amit@caz.example', t: 'x' });
  check('an EMAIL ADDRESS in place of a mobile (even one that IS saved on a login) finds nothing: no mail goes out, so an address can never be used to ask for a link', sent.length === 0, sent.length);

  wd();
  await post({ mobile: '0411 000 222', email: 'amit@caz.example', e: 'amit@caz.example', t: 'x' });
  check('a made-up mobile with a SAVED address beside it finds nothing: the address is never a way to find a login', sent.length === 0 && DB.vp_signin_links.length === 0, sent.length);

  section('2. One answer, whatever the truth');
  wd();
  var answers = [];
  answers.push(await post({ mobile: AMIT_PHONE }));                 // sent
  answers.push(await post({ mobile: '0400 111 222' }));             // PAT: a login, but its email is saved and venue fine -> sent too
  sent.length = 0;
  answers.push(await post({ mobile: '0400 333 444' }));             // HOSTY: a login with NO email saved
  answers.push(await post({ mobile: '0400 777 888' }));             // banned login
  answers.push(await post({ mobile: '0400 999 000' }));             // email saved but on no venue
  answers.push(await post({ mobile: '0411 000 000' }));             // no login at all
  answers.push(await post({ mobile: '0733 334 444' }));             // a landline: not a mobile
  answers.push(await post({ mobile: '' }));
  answers.push(await post({}));
  check('no email saved, banned, no venue, no login, a landline, nothing at all: the SAME { ok:true } as a send, and NOTHING sent',
    answers.every(function (a) { return a.status === 200 && JSON.stringify(a.body) === SAME; }) && sent.length === 0, [answers.map(function (a) { return a.status + JSON.stringify(a.body); }), sent.length]);
  check('no link was made for a login with no email, a banned one, or one off every venue', DB.vp_signin_links.filter(function (x) { return [U(3), U(4), U(5)].indexOf(x.auth_user_id) >= 0; }).length === 0);

  wd();
  DB.vp_prospects = [{ venue_id: V1, auth_user_id: AMIT, email: 'amit@caz.example', created_at: new Date(Date.now() - 100 * 86400000).toISOString() }];   // past the 90 days (VPA_LINK_DAYS, 10 Nov 2026)
  var ended = await post({ mobile: AMIT_PHONE });
  check('a prospect whose 90 days are over: still the same answer, no link (and no sales ticket for a stranger to cause)', JSON.stringify(ended.body) === SAME && sent.length === 0 && (DB.vp_help_tickets || []).length === 0, [ended, sent.length]);

  section('3. The same minimum time on every answer');
  wd();
  delays.length = 0;
  await post({ mobile: AMIT_PHONE });
  var dSent = delays.slice(); delays.length = 0;
  await post({ mobile: '0411 000 000' });
  var dNone = delays.slice(); delays.length = 0;
  await post({ mobile: 'nonsense' });
  var dBad = delays.slice(); delays.length = 0;
  check('sent, no login and a malformed mobile all wait out the same floor (about 2.5 s) before answering', [dSent, dNone, dBad].every(function (d) { return d.length >= 1 && d[d.length - 1] > 2000 && d[d.length - 1] <= 2500; }), [dSent, dNone, dBad]);

  section('4. Rate limits');
  wd(); sent.length = 0;
  var LIM = [];
  for (var k = 0; k < 8; k++) LIM.push((await post({ mobile: '0411 000 ' + (100 + k) }, '198.51.100.9')).status);
  var otherNet = await post({ mobile: '0411 000 000' }, '198.51.100.10');
  check('per network: the 7th ask in an hour from one address is 429, another address is not', LIM.slice(0, 6).every(function (s) { return s === 200; }) && LIM[6] === 429 && LIM[7] === 429 && otherNet.status === 200, LIM);
  var a429 = await post({ mobile: AMIT_PHONE }, '198.51.100.9'), b429 = await post({ mobile: '0411 000 000' }, '198.51.100.9');
  check('the 429 is the same for a real mobile and a made-up one, so it says nothing about any number', a429.status === 429 && b429.status === 429 && JSON.stringify(a429.body) === JSON.stringify(b429.body));

  wd(); sent.length = 0;
  var per = [];
  for (var j = 0; j < 6; j++) per.push(await post({ mobile: AMIT_PHONE }));
  check('per mobile: at most 3 links an hour (the rest make nothing), and the answer never changes', sent.length === 3 && per.every(function (x) { return x.status === 200 && JSON.stringify(x.body) === SAME; }), [sent.length]);

  section('5. HQ can see it, with nothing secret in it');
  wd();
  await post({ mobile: AMIT_PHONE });
  await post({ mobile: '0411 000 555' });
  var aud = DB.vp_admin_audit, txt = JSON.stringify(aud);
  check('a sent row for his login and a "no login" row that carries only the last 3 digits', aud.some(function (a) { return a.action === 'signin_email_backup_sent' && a.target === 'auth_user:' + AMIT; }) &&
    aud.some(function (a) { return a.action === 'signin_email_backup_nologin' && a.target === 'mobile:...555'; }), aud);
  check('no email address, no full mobile and no token in any audit row or log line', txt.indexOf('@') === -1 && txt.indexOf('0411') === -1 && txt.indexOf(AMIT_PH) === -1 && txt.indexOf(tokenOf(sent[0].html)) === -1 && LOGS.every(function (l) { return l.indexOf('@') === -1; }), [txt, LOGS]);

  section('6. The code itself');
  var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var i0 = SRC.indexOf('async function vpaEmailBackup('), fnTxt = SRC.slice(i0, SRC.indexOf('\n}\n', i0));
  check('the handler reads only body.mobile: no email, e, to or address field is looked at', /_b\.body && _b\.body\.mobile/.test(fnTxt) && !/body\.(email|e|to|address|addr)\b/.test(fnTxt) && !/body\[/.test(fnTxt), fnTxt.slice(0, 200));
  check('it can only send through vpaSendSigninLink, which reads the address from Auth by login id', /vpaSendSigninLink\(env, u\.id, null, \{ self: true \}\)/.test(fnTxt) && !/vpaSendEmail/.test(fnTxt));
  check('the route is wired in the router', /path === '\/auth\/email-backup' && typeof vpaEmailBackup === 'function'/.test(SRC));

  if (bad) throw new Error('email backup: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
