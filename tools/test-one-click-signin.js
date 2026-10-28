/* "OPEN YOUR VENUEPLAY": THE ONE-TIME SIGN-IN LINK, RUN AND NOT WORD-SEARCHED (Dean, 28 Oct 2026).

   "Can we do a link to click that automatically goes to that page so there's no signing in with an
   email to confuse them why they then get a text?"

     1. the REAL billing Worker (tools/rig-billing-worker.js): POST /admin/prospect mints a token from
        crypto.getRandomValues and stores ONLY its hash (with the login, the venue, 14 days, unused);
        the welcome's main button carries it; POST /auth/one-click signs in once, refuses a second
        use, an expired link, an unknown or malformed token and a login taken off the venue with ONE
        identical answer; two uses at the same instant give exactly one sign-in; it is rate-limited
        per network; it logs nothing; without migration 123 the prospect is still set up
     2. the go page (venueplay/app/vp-oneclick.js) in a fake window: the token leaves the address bar
        at once, nothing is sent until a tap, a tap signs in and starts the 4 hour shift, any refusal
        lands on the email sign-in filled in
     3. the sign-in page (index.html, the real functions lifted out): the email option opens first
        when the link asks or this device last used email; a login with no mobile is remembered as
        email after the code is verified
     4. the 4 hour sign-out (vp-session.js) still ends a shift the go page started

   Run from the repo root:  jsc tools/test-one-click-signin.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
function liftAfter(src, marker) {   // the function literal that follows a marker, e.g. an addEventListener("click", function(){...})
  var i = src.indexOf(marker);
  if (i < 0) throw new Error('cannot find ' + marker);
  var f = src.indexOf('function', i), d = 0, k = src.indexOf('{', f);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(f, k);
}
function store() {
  var s = {};
  return { _s: s, getItem: function (k) { return k in s ? s[k] : null; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } };
}

/* ============================== 2. the go page ============================== */
var ONECLICK = readFile('venueplay/app/vp-oneclick.js');
function El(id) { this.id = id; this.textContent = ''; this.value = ''; this.disabled = false; this.handlers = {}; var c = {}; this.classList = { add: function (x) { c[x] = true; }, remove: function (x) { delete c[x]; }, contains: function (x) { return !!c[x]; } }; }
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.click = function () { var me = this; (this.handlers.click || []).forEach(function (f) { f.call(me, { preventDefault: function () {} }); }); };
var TOKEN_A = 'Ab_-0123456789abcdefghijklmnopqrstuvwxyzABC';   // 43 base64url characters
function goPage(hash, answer, verify) {
  var W = { calls: [], verifies: [], replaced: null, history: [] };
  var els = { goBtn: new El('goBtn'), goMsg: new El('goMsg') };
  W.window = {
    document: { getElementById: function (id) { return els[id] || null; } },
    localStorage: store(), sessionStorage: store(),
    location: { hash: hash, replace: function (u) { W.replaced = u; } },
    history: { replaceState: function (a, b, u) { W.history.push(u); W.window.location.hash = ''; } },
    fetch: function (url, opts) { W.calls.push({ url: url, body: JSON.parse(opts.body), method: opts.method });
      var a = answer || { status: 200, body: { ok: true, token_hash: 'pkce_HASH', type: 'magiclink', venue_id: 'V9' } };
      return Promise.resolve({ status: a.status, json: function () { return Promise.resolve(a.body); } }); },
    supabase: { createClient: function () { return { auth: { verifyOtp: function (o) { W.verifies.push(o); return Promise.resolve(verify || { data: { session: { access_token: 'x' }, user: { id: 'u' } }, error: null }); } } }; } }
  };
  (new Function('window', ONECLICK))(W.window);
  W.els = els; W.ls = W.window.localStorage._s; W.ss = W.window.sessionStorage._s;
  W.result = W.window.VPOneClick.start(W.window);
  return W;
}
function settle() { for (var i = 0; i < 8; i++) drainMicrotasks(); }

section('2. The go page: nothing happens until a tap, then one sign-in and the console');
var G1 = goPage('#t=' + TOKEN_A + '&e=amit%40caz.example');
check('the token leaves the address bar before anything else (history.replaceState to /app/go)', G1.history[0] === '/app/go' && G1.window.location.hash === '', G1.history);
check('NOTHING is sent on page load, so a mail scanner opening the link cannot use it', G1.calls.length === 0 && G1.result === 'ready', G1.calls);
G1.els.goBtn.click(); G1.els.goBtn.click(); settle();
check('a tap posts the token, in the body, to the billing Worker\'s /auth/one-click (twice tapped, one request)',
  G1.calls.length === 1 && G1.calls[0].method === 'POST' && /venueplay-api\.dean-tindale\.workers\.dev\/auth\/one-click$/.test(G1.calls[0].url) && G1.calls[0].body.t === TOKEN_A && G1.calls[0].url.indexOf(TOKEN_A) === -1, G1.calls);
check('the hash the Worker returns is exchanged with verifyOtp, as the email code is', G1.verifies.length === 1 && G1.verifies[0].token_hash === 'pkce_HASH' && G1.verifies[0].type === 'magiclink', G1.verifies);
var shiftAt = parseInt(G1.ls.vpShiftStart, 10);
check('a fresh 4 hour shift starts now (vpShiftStart), exactly as a typed code starts one', shiftAt > 0 && Math.abs(Date.now() - shiftAt) < 60000, G1.ls);
check('this device now opens on the email option next time, on their venue', G1.ls.vpSignInWith === 'email' && G1.ls.vpCurrentVenue === 'V9', G1.ls);
check('and the console opens, signed in', G1.replaced === '/app/', G1.replaced);

var G2 = goPage('#t=' + TOKEN_A + '&e=Amit%40Caz.example', { status: 410, body: { ok: false } });
G2.els.goBtn.click(); settle();
check('used or expired (410): to the email sign-in, saying so (gone=1), their address ready to fill in',
  G2.replaced === '/app/?signin=email&gone=1' && G2.ss.vpSignInPrefill === 'amit@caz.example' && G2.ls.vpSignInWith === 'email' && G2.verifies.length === 0 && !G2.ls.vpShiftStart, [G2.replaced, G2.ss]);
var G3 = goPage('#t=' + TOKEN_A, undefined, { data: null, error: { message: 'Token has expired or is invalid' } });
G3.els.goBtn.click(); settle();
check('Auth refuses the exchange: the same friendly page, no shift started, no error code shown', G3.replaced === '/app/?signin=email&gone=1' && !G3.ls.vpShiftStart && G3.els.goMsg.textContent === '', G3.replaced);
var G4 = goPage('');
check('no token at all: straight to the email sign-in, nothing sent', G4.result === 'no-token' && G4.replaced === '/app/?signin=email&gone=1' && G4.calls.length === 0);
var G5 = goPage('#t=short&e=' + encodeURIComponent('x" onmouseover="y'));
check('a malformed token or address is not used (no request, no prefill)', G5.result === 'no-token' && G5.calls.length === 0 && !G5.ss.vpSignInPrefill, G5.ss);
var G6 = goPage('#t=' + TOKEN_A, { status: 429, body: {} });
G6.els.goBtn.click(); settle();
check('rate-limited: told to wait, the button comes back, the link is not given up on', G6.replaced === null && /Wait a few minutes/.test(G6.els.goMsg.textContent) && G6.els.goBtn.disabled === false, G6.els.goMsg.textContent);

/* ============================== 3. the sign-in page ============================== */
section('3. The sign-in page opens on email when it should, and remembers a login with no mobile');
var INDEX = readFile('venueplay/app/index.html');
var keyM = /var SIGNIN_KEY="([^"]+)"/.exec(INDEX);
check('index.html reads the same device key the go page writes', !!keyM && keyM[1] === 'vpSignInWith' && /METHOD_KEY = "vpSignInWith"/.test(ONECLICK), keyM && keyM[1]);
function signInPage(search, ls, prefill) {
  var ids = ['stepMobile', 'stepCode', 'emailAlt', 'stepEmail', 'authSub', 'emailIn'], els = {};
  ids.forEach(function (i) { els[i] = new El(i); });
  els.stepCode.classList.add('hidden'); els.emailAlt.classList.add('hidden'); els.stepEmail.classList.add('hidden');
  els.authSub.textContent = 'Sign in with a text code to your mobile.';
  var LS = ls || store(), SS = store(); if (prefill) SS.setItem('vpSignInPrefill', prefill);
  var fn = (new Function('$', 'localStorage', 'sessionStorage', 'window', 'var SIGNIN_KEY="' + keyM[1] + '";\n' + lift(INDEX, 'openSignInStep') + '\nreturn openSignInStep();'));
  var out = fn(function (id) { return els[id]; }, LS, SS, { location: { search: search } });
  return { out: out, els: els, SS: SS };
}
var S1 = signInPage('?signin=email&gone=1', null, 'amit@caz.example');
check('?signin=email: the email step is open and the text step is not', S1.out === 'email' && !S1.els.stepEmail.classList.contains('hidden') && S1.els.stepMobile.classList.contains('hidden') && S1.els.emailAlt.classList.contains('hidden'));
check('a used or expired link says so in plain words, with their address filled in, read once', S1.els.authSub.textContent === 'That link has been used or has expired. Sign in with your email and we will email you a code.' &&
  S1.els.emailIn.value === 'amit@caz.example' && S1.SS.getItem('vpSignInPrefill') === null, [S1.els.authSub.textContent, S1.els.emailIn.value]);
var LSe = store(); LSe.setItem('vpSignInWith', 'email');
var S2 = signInPage('', LSe);
check('this device last signed in by email: the email option first, plainly worded', S2.out === 'email' && !S2.els.stepEmail.classList.contains('hidden') && S2.els.authSub.textContent === 'Sign in with a code sent to your email.', S2.els.authSub.textContent);
var S3 = signInPage('');
check('nothing known: the text step as before, untouched', S3.out === 'sms' && !S3.els.stepMobile.classList.contains('hidden') && S3.els.stepEmail.classList.contains('hidden') && S3.els.authSub.textContent === 'Sign in with a text code to your mobile.');
var S4 = signInPage('?signin=email', null, 'x" onmouseover="y');
check('a prefill that is not an address is never put in the box', S4.out === 'email' && S4.els.emailIn.value === '', S4.els.emailIn.value);

function verifyRun(user, mode) {
  var LS = store(), routed = 0, btn = new El('verifyBtn'), otp = new El('otpIn'), err = new El('otpErr'); otp.value = '123456';
  var els = { otpIn: otp, otpErr: err, verifyBtn: btn };
  var src = 'var SIGNIN_KEY="' + keyM[1] + '";\n' + lift(INDEX, 'rememberSignIn') + '\nreturn (' + liftAfter(INDEX, '$("verifyBtn").addEventListener("click", ') + ');';
  var handler = (new Function('$', 'localStorage', 'MODE', 'EMAIL', 'E164', 'client', 'routeAfterAuth', src))(
    function (id) { return els[id]; }, LS, mode, 'amit@caz.example', '+61452510904',
    { auth: { verifyOtp: function () { return Promise.resolve({ data: { user: user, session: {} }, error: null }); } } }, function () { routed++; });
  handler.call(btn); settle();
  return { m: LS.getItem('vpSignInWith'), shift: LS.getItem('vpShiftStart'), routed: routed };
}
var V1 = verifyRun({ id: 'u1', email: 'amit@caz.example', phone: '' }, 'email');
var V1b = verifyRun({ id: 'u1', email: 'amit@caz.example', phone: '' }, 'sms');   // whatever MODE says, the login has no mobile
check('a login with NO mobile is remembered as email (shift started, routed on), whatever way the code came', V1.m === 'email' && V1b.m === 'email' && !!V1.shift && V1.routed === 1, [V1, V1b]);
var V2 = verifyRun({ id: 'u2', email: '', phone: '61452510904' }, 'sms');
check('a text code for a login with a mobile: remembered as text', V2.m === 'sms', V2);
var V3 = verifyRun({ id: 'u3', email: 'a@b.example', phone: '61452510904' }, 'email');
check('a login with a mobile that came in by email (texts failing): remembered as email', V3.m === 'email', V3);
var initAt = INDEX.indexOf('// ================= INIT ================='), bootAt = INDEX.indexOf('go("vBoot");', initAt), callAt = INDEX.indexOf('openSignInStep();', initAt);
check('index.html calls openSignInStep() at start-up, before the auth check routes anywhere', initAt > 0 && callAt > initAt && callAt < bootAt, [initAt, callAt, bootAt]);

/* ============================== 4. the 4 hour sign-out ============================== */
section('4. A shift the go page started still ends at 4 hours (compliance: opt-in player data)');
function sessionAfter(startedMsAgo) {
  var LS = store(); LS.setItem('vpShiftStart', String(Date.now() - startedMsAgo));
  var signedOut = 0, win = { location: { pathname: '/app/', search: '', href: '/app/' }, localStorage: LS, sessionStorage: store(),
    supabase: { createClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); }, signOut: function () { signedOut++; return Promise.resolve(); } } }; } } };
  var document = { getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {}, createElement: function () { return new El('x'); }, body: new El('body') };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', 'setInterval', 'clearInterval', 'setTimeout', readFile('venueplay/app/vp-session.js')))
    (win, document, LS, win.sessionStorage, win.location, function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } }); },
     function () { return 1; }, function () {}, function () { return 0; });
  win.VP.enforceShift(); settle();
  return { out: signedOut, href: win.location.href, left: LS.getItem('vpShiftStart') };
}
var over = sessionAfter(4 * 3600 * 1000 + 60000), under = sessionAfter(4 * 3600 * 1000 - 60000);
check('4 hours and a minute after a one-click sign-in: signed out, shift cleared', over.out === 1 && over.left === null, over);
check('a minute short of 4 hours: still signed in', under.out === 0 && under.left !== null, under);

/* ============================== 1. the billing Worker ============================== */
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
/* jsc has no WebCrypto, TextEncoder or getRandomValues. The digest stand-in is a pure function of its
   input (enough to show what is stored is the hash of what is sent and never the token); the random
   stand-in records that 32 bytes were asked of getRandomValues. The Workers runtime supplies both. */
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
var RANDOM_ASKS = [], rs = 0x9e3779b9;
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b.buffer ? b : b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { RANDOM_ASKS.push(a.length); for (var i = 0; i < a.length; i++) { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; a[i] = rs & 255; } return a; } };
if (typeof URL === 'undefined') { URL = function (u) { var q = u.indexOf('?'), sp = {}; if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; }; }
var LOGS = [];
console.log = console.warn = console.error = function () { LOGS.push(Array.prototype.join.call(arguments, ' ')); };

var AUTH = [], GEN = [], MIG123 = true, PATCHES = [];
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('/auth/v1/admin/generate_link') !== -1) {
    var g = JSON.parse(opts.body); GEN.push(g);
    var who = AUTH.filter(function (x) { return x.email === g.email; })[0];
    if (!who) return RS(404, { msg: 'User not found' });
    return RS(200, { id: who.id, email: who.email, action_link: 'https://db/auth/v1/verify?token=SECRET', email_otp: '123456', hashed_token: 'hashed-' + who.id, verification_type: 'magiclink', redirect_to: 'https://www.venueplay.com.au' });
  }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') {
      var b = JSON.parse(opts.body), ph = b.phone ? b.phone.replace('+', '') : '';
      if (AUTH.some(function (x) { return (b.email && x.email === b.email) || (ph && x.phone === ph); })) return RS(422, { msg: 'already registered', error_code: 'email_exists' });
      var nu = { id: newId(), email: b.email || '', phone: ph }; AUTH.push(nu); return RS(200, nu);
    }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  if (u.indexOf('/storage/v1/') !== -1) return RS(200, {});
  if (/\/rest\/v1\/vp_signin_links/.test(u)) {
    if (!MIG123) return RS(404, '{"code":"42P01","message":"relation \\"public.vp_signin_links\\" does not exist"}');
    if (method === 'PATCH') {
      /* ONE STATEMENT, as Postgres runs it: the filter is checked and the row updated with nothing in
         between (the row lock and the re-check of "used_at is null" under it), and the changed rows
         come back because the Worker asked for return=representation. */
      var q = parseQ(u.split('?')[1] || ''), set = JSON.parse(opts.body), got = [];
      PATCHES.push(u);
      tbl('vp_signin_links').forEach(function (r) { if (match(r, q)) { for (var k in set) r[k] = set[k]; got.push({ auth_user_id: r.auth_user_id, venue_id: r.venue_id }); } });
      return RS(200, /return=representation/.test((opts.headers || {}).Prefer || '') ? got : '');
    }
  }
  return rigFetch(url, opts);
};
function U(nn) { return '52000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9);
function as(user, body) { var h = { Authorization: user ? 'Bearer ' + user : '' }, txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); } }; }
var IPN = 0;
function click(t, ip) { var txt = JSON.stringify({ t: t }), addr = ip || ('203.0.113.' + (++IPN % 250));
  return { url: 'https://api/auth/one-click', headers: { get: function (k) { return k === 'cf-connecting-ip' ? addr : ''; } }, text: function () { return Promise.resolve(txt); } }; }
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; GEN = []; PATCHES = []; MIG123 = true; LOGS = []; RANDOM_ASKS = [];
  ENV.FOUNDING_CODES = 'NSW-NOV-2099,QLD-OCT-2099';
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = []; DB.vp_signin_links = [];
}
var CAZ = { name: "Caz Reitop's Dirty Secrets", first_name: 'Amit', email: 'CazReitop@gmail.com', postcode: '3066', entity_type: 'for_profit', players: 60 };
function hrefs(html) { var out = [], re = /href="([^"]+)"/g, m; while ((m = re.exec(html))) out.push(m[1]); return out; }
function visible(html) { return String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
function tokenOf(html) { var h = hrefs(html).filter(function (x) { return x.indexOf('/app/go#t=') !== -1; })[0] || ''; var m = /#t=([A-Za-z0-9_-]+)/.exec(h); return m ? m[1] : ''; }
function freshLink(ttlMs, venueId, userId) {   // a second link for the same login, made the way the Worker makes one
  return vpaMintSigninLink(ENV, userId, venueId).then(function (t) { if (ttlMs !== undefined) { var r = DB.vp_signin_links[DB.vp_signin_links.length - 1]; r.expires_at = new Date(Date.now() + ttlMs).toISOString(); } return t; });
}

(async function () {
  section('1. The billing Worker: the link is minted with the prospect, and only its hash is kept');
  world();
  var r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var v = DB.vp_venues[0] || {}, login = AUTH[0] || {}, row = DB.vp_signin_links[0] || {};
  var html = sent[0] ? sent[0].html : '', token = tokenOf(html);
  check('the prospect is set up and the email sent, with no warning', r.status === 200 && r.body.welcome_sent === true && !r.body.warnings, r.body);
  check('the token is 32 bytes from crypto.getRandomValues, written as 43 base64url characters', RANDOM_ASKS.length === 1 && RANDOM_ASKS[0] === 32 && /^[A-Za-z0-9_-]{43}$/.test(token), [RANDOM_ASKS, token]);
  check('ONE link row: this login, this venue, unused', DB.vp_signin_links.length === 1 && row.auth_user_id === login.id && row.venue_id === v.id && row.used_at === null && row.purpose === 'prospect_welcome', row);
  check('it keeps the SHA-256 of the token (64 hex), and that is the hash of exactly what the email carries', /^[0-9a-f]{64}$/.test(row.token_hash) && row.token_hash === await vpaSigninTokenHash(token), row.token_hash);
  check('the token itself is nowhere in the database (the link rows, the audit row, anything)', token.length === 43 && JSON.stringify(DB).indexOf(token) === -1);
  var life = Date.parse(row.expires_at) - Date.parse(row.created_at);
  check('it lasts 14 days', life === 14 * 86400000, life);
  var L = hrefs(html), txt = visible(html);
  var main = L.filter(function (h) { return h.indexOf('/app/go#') !== -1; });
  check('the email\'s main button "Open your VenuePlay" is the one-click link, with the token and their address in the fragment',
    main.length === 1 && main[0] === 'https://www.venueplay.com.au/app/go#t=' + token + '&e=cazreitop%40gmail.com' &&
    new RegExp('<a href="' + main[0].replace(/[.?*+^$()|[\]\\]/g, '\\$&') + '"[^>]*>Open your VenuePlay</a>').test(html), main);
  check('it says plainly it signs them straight in, once, within 14 days', /This button signs you straight in, with no code to type\. It works once, within 14 days/.test(txt) && /The button above signs you in the first time\. After that, on a phone/.test(txt), txt.slice(0, 900));
  check('every other sign-in link in it opens the EMAIL option (no waiting for a text that never comes)', L.indexOf('https://www.venueplay.com.au/app/?signin=email') !== -1 &&
    /<a href="https:\/\/www\.venueplay\.com\.au\/app\/\?signin=email"[^>]*>Sign in with my email<\/a>/.test(html) && L.indexOf('https://www.venueplay.com.au/app') === -1, L);
  check('nothing left unfilled and no em dash', html.indexOf('{{') === -1 && html.indexOf('<!--IF:') === -1 && !/[—–]/.test(txt));
  var t2 = await freshLink(undefined, v.id, login.id);
  check('a second link for the same login is a different token', t2 !== token && /^[A-Za-z0-9_-]{43}$/.test(t2));

  section('1b. POST /auth/one-click signs in ONCE');
  GEN.length = 0; PATCHES.length = 0;
  var ok = await vpaHandleOneClick(click(token), ENV, J);
  var used = DB.vp_signin_links.filter(function (x) { return x.token_hash === row.token_hash; })[0];
  check('a valid link: ok, with a magic-link hash for THIS login and the venue to open', ok.status === 200 && ok.body.ok === true && ok.body.token_hash === 'hashed-' + login.id && ok.body.type === 'magiclink' && ok.body.venue_id === v.id, ok);
  check('Auth was asked for a magic link (it sends nothing) for the login\'s own email', GEN.length === 1 && GEN[0].type === 'magiclink' && GEN[0].email === 'cazreitop@gmail.com', GEN);
  check('the action link and the 6-digit code Auth also returns never leave the Worker', JSON.stringify(ok.body).indexOf('SECRET') === -1 && JSON.stringify(ok.body).indexOf('123456') === -1, ok.body);
  check('the row is marked used, by ONE update conditional on unused and unexpired', !!used.used_at && PATCHES.length === 1 && /token_hash=eq\.[0-9a-f]{64}&used_at=is\.null&expires_at=gt\./.test(PATCHES[0]), PATCHES);
  var again = await vpaHandleOneClick(click(token), ENV, J);
  check('the same link again: refused (410 {ok:false}), Auth not asked', again.status === 410 && JSON.stringify(again.body) === '{"ok":false}' && GEN.length === 1, again);

  var tx = await freshLink(-1000, v.id, login.id);
  var expired = await vpaHandleOneClick(click(tx), ENV, J);
  var exRow = DB.vp_signin_links[DB.vp_signin_links.length - 1];
  check('an expired link: refused the same way, Auth not asked, the row not marked', expired.status === 410 && JSON.stringify(expired.body) === '{"ok":false}' && GEN.length === 1 && exRow.used_at === null, expired);

  var tr = await freshLink(undefined, v.id, login.id); GEN.length = 0;
  var both = await Promise.all([vpaHandleOneClick(click(tr), ENV, J), vpaHandleOneClick(click(tr), ENV, J)]);
  var wins = both.filter(function (x) { return x.status === 200 && x.body.ok === true; }).length;
  check('two uses at the same instant (a double click, two tabs): exactly one signs in', wins === 1 && both.filter(function (x) { return x.status === 410; }).length === 1 && GEN.length === 1, both.map(function (x) { return x.status; }));

  var unknownT = 'Zz' + token.slice(2);
  var unknown = await vpaHandleOneClick(click(unknownT), ENV, J);
  var junk = await vpaHandleOneClick(click('not-a-token'), ENV, J);
  var empty = await vpaHandleOneClick(click(''), ENV, J);
  check('an unknown token, a malformed one and none at all: the SAME answer as used or expired, nothing revealed',
    [unknown, junk, empty].every(function (x) { return x.status === 410 && JSON.stringify(x.body) === JSON.stringify(again.body) && JSON.stringify(x.body) === JSON.stringify(expired.body); }) && GEN.length === 1, [unknown, junk, empty]);
  check('a malformed token never reaches the database', PATCHES.filter(function (p) { return p.indexOf('not-a-token') !== -1; }).length === 0);

  var tk = await freshLink(undefined, v.id, login.id); GEN.length = 0;
  var keep = DB.vp_venue_staff.slice(); DB.vp_venue_staff = DB.vp_venue_staff.filter(function (s) { return s.auth_user_id !== login.id; });
  var removed = await vpaHandleOneClick(click(tk), ENV, J);
  DB.vp_venue_staff = keep;
  check('a login taken off the venue since the email went: refused the same way, Auth not asked', removed.status === 410 && JSON.stringify(removed.body) === '{"ok":false}' && GEN.length === 0, removed);

  var LIMIT = [];
  for (var i = 0; i < 21; i++) LIMIT.push((await vpaHandleOneClick(click('Q' + token.slice(1), '198.51.100.7'), ENV, J)).status);
  var other = await vpaHandleOneClick(click('Q' + token.slice(1), '198.51.100.8'), ENV, J);
  check('rate-limited per network: the 21st try in 10 minutes from one address is 429, another address is not', LIMIT.slice(0, 20).every(function (s) { return s === 410; }) && LIMIT[20] === 429 && other.status === 410, LIMIT);
  check('nothing was logged, so no token can be in a log', LOGS.length === 0, LOGS);

  section('1c. Without migration 123 the prospect is still set up, and the button opens the email sign-in');
  world(); MIG123 = false;
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var h2 = sent[0] ? sent[0].html : '', L2 = hrefs(h2), t3 = visible(h2);
  check('set up and sent, HQ told why there is no one-click button', r.status === 200 && r.body.welcome_sent === true && (r.body.warnings || []).some(function (w) { return /one-click sign-in button was not made \(run migration 123\)/.test(w); }), r.body);
  check('the main button opens the email sign-in, and the email says nothing about a one-time button',
    /<a href="https:\/\/www\.venueplay\.com\.au\/app\/\?signin=email"[^>]*>Open your VenuePlay<\/a>/.test(h2) && L2.every(function (h) { return h.indexOf('/app/go') === -1; }) && !/signs you straight in/.test(t3) && /Sign in to run games On a phone, tablet or laptop/.test(t3), L2);

  if (bad) throw new Error('one-click sign-in: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
