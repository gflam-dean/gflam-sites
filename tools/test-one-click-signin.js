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
        stays on the go page saying the link is spent, with "Send me a new link" (29 Oct 2026: never
        an email form), and a new-link request says the same thing whatever happens
     3. the sign-in page (index.html, the real functions lifted out): ALWAYS the mobile and a text
        code first (Dean, 29 Oct 2026: "it's got to be phone number"); no link or device memory opens
        the email step, and the old device key is cleared
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
var GO_HTML = readFile('venueplay/app/go.html');
function El(id) { this.id = id; this.textContent = ''; this.value = ''; this.disabled = false; this.hidden = false; this.className = ''; this.handlers = {}; var c = {}; this.classList = { add: function (x) { c[x] = true; }, remove: function (x) { delete c[x]; }, contains: function (x) { return !!c[x]; } }; }
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.click = function () { var me = this; (this.handlers.click || []).forEach(function (f) { f.call(me, { preventDefault: function () {} }); }); };
var TOKEN_A = 'Ab_-0123456789abcdefghijklmnopqrstuvwxyzABC';   // 43 base64url characters
function goPage(hash, answer, verify) {
  var W = { calls: [], verifies: [], replaced: null, history: [], order: [] };
  var els = {};
  ['goBtn', 'goMsg', 'goReady', 'goGone', 'goneTitle', 'goneSub', 'resendBtn', 'resendMsg', 'mobileLink', 'goneNote'].forEach(function (i) { els[i] = new El(i); });
  els.goGone.hidden = true;
  /* What the page's own markup says before any script runs (go.html), so a check reads the shipped words. */
  ['goneTitle', 'goneSub', 'resendBtn', 'mobileLink', 'goneNote'].forEach(function (i) {
    var m = new RegExp('id="' + i + '"[^>]*>([^<]*)<').exec(GO_HTML); els[i].textContent = m ? m[1] : ''; });
  W.window = {
    document: { getElementById: function (id) { return els[id] || null; } },
    localStorage: (function () { var l = store(); l.setItem('vpSignInWith', 'email'); return l; })(), sessionStorage: store(),
    location: { hash: hash, replace: function (u) { W.replaced = u; W.order.push('go ' + u); } },
    history: { replaceState: function (a, b, u) { W.history.push(u); W.window.location.hash = ''; } },
    fetch: function (url, opts) { W.calls.push({ url: url, body: JSON.parse(opts.body), method: opts.method });
      if (/\/auth\/one-click\/resend$/.test(url)) { var ra = W.resendAnswer || { status: 200, body: { ok: true } };
        if (ra === 'offline') return Promise.reject(new TypeError('offline'));
        return Promise.resolve({ status: ra.status, json: function () { return Promise.resolve(ra.body); } }); }
      var a = answer || { status: 200, body: { ok: true, token_hash: 'pkce_HASH', type: 'magiclink', venue_id: 'V9' } };
      return Promise.resolve({ status: a.status, json: function () { return Promise.resolve(a.body); } }); },
    supabase: { createClient: function () { return { auth: {
      signOut: function (o) { W.order.push('signout ' + (o && o.scope)); return Promise.resolve({ error: null }); },
      verifyOtp: function (o) { W.verifies.push(o); W.order.push('verify'); return Promise.resolve(verify || { data: { session: { access_token: 'x' }, user: { id: 'u' } }, error: null }); } } }; } }
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
  G1.calls.length === 1 && G1.calls[0].method === 'POST' && /api\.venueplay\.com\.au\/auth\/one-click$/.test(G1.calls[0].url) && G1.calls[0].body.t === TOKEN_A && G1.calls[0].url.indexOf(TOKEN_A) === -1, G1.calls);
check('the hash the Worker returns is exchanged with verifyOtp, as the email code is', G1.verifies.length === 1 && G1.verifies[0].token_hash === 'pkce_HASH' && G1.verifies[0].type === 'magiclink', G1.verifies);
var shiftAt = parseInt(G1.ls.vpShiftStart, 10);
check('a fresh 4 hour shift starts now (vpShiftStart), exactly as a typed code starts one', shiftAt > 0 && Math.abs(Date.now() - shiftAt) < 60000, G1.ls);
check('nothing records "email" as this device\'s way in any more (the old key is cleared); their venue is the one to open', !('vpSignInWith' in G1.ls) && G1.ls.vpCurrentVenue === 'V9', G1.ls);
check('and the console opens, signed in (its first screen then asks their name and mobile)', G1.replaced === '/app/', G1.replaced);
/* A VENUE IS NEVER SENT TO HQ (Dean, 29 Oct 2026): the browser that opens a venue's link may hold an HQ
   admin's session, and /app/ sends an admin straight on to HQ. It is dropped, on this device only, first. */
check('whatever session this device already had (an HQ admin\'s) is signed out locally BEFORE the venue\'s sign-in is exchanged',
  JSON.stringify(G1.order) === JSON.stringify(['signout local', 'verify', 'go /app/']), G1.order);

/* A SPENT LINK IS NEVER A DEAD END, AND NEVER AN EMAIL FORM (Dean, 29 Oct 2026). */
function gone(W) { return W.els.goGone.hidden === false && W.els.goReady.hidden === true; }
var G2 = goPage('#t=' + TOKEN_A + '&e=Amit%40Caz.example', { status: 410, body: { ok: false } });
G2.els.goBtn.click(); settle();
check('used or expired (410): stays on this page and says the link has been used or has expired, with "Send me a new link"; no shift, no redirect, no email form',
  gone(G2) && G2.replaced === null && /already been used or has expired/.test(G2.els.goneSub.textContent) && G2.els.resendBtn.hidden === false &&
  G2.els.resendBtn.textContent === 'Send me a new link' && G2.verifies.length === 0 && !G2.ls.vpShiftStart && !('vpSignInWith' in G2.ls), [G2.replaced, G2.els.goneSub.textContent]);
check('and "Sign in with my mobile instead" is there, to the mobile sign-in', G2.els.mobileLink.hidden === false && /mobile/.test(G2.els.mobileLink.textContent));
/* PHONE FIRST ON THE SPENT-LINK PAGE (Dean, 3 Nov 2026: hosts sign in by a text code to their mobile; the
   copy offered email and "we will send you a new link"). The pink button is the mobile sign-in and comes
   first; the resend is the quiet second button; no default line offers email. */
var GONE_HTML = GO_HTML.slice(GO_HTML.indexOf('<div id="goGone"'), GO_HTML.indexOf('<script', GO_HTML.indexOf('<div id="goGone"')));
var firstPink = /<(?:a|button)\b[^>]*class="btn pink[^"]*"[^>]*id="([^"]+)"/.exec(GONE_HTML);
check('phone first: the spent-link page\'s pink button is "Sign in with my mobile", ahead of the resend, which is the quiet second button',
  !!firstPink && firstPink[1] === 'mobileLink' && GONE_HTML.indexOf('id="mobileLink"') < GONE_HTML.indexOf('id="resendBtn"') &&
  /class="btn ghost[^"]*"[^>]*id="resendBtn"/.test(GONE_HTML), [firstPink && firstPink[1]]);
check('phone first: it says "Sign in with a text code to your mobile." and no line offers email or "we will send you a new link"',
  /Sign in with a text code to your mobile\.$/.test(G2.els.goneSub.textContent) && !/email/i.test(G2.els.goneSub.textContent) &&
  !/send you a new link/i.test(G2.els.goneNote.textContent) && !/email you/i.test(GONE_HTML), [G2.els.goneSub.textContent, G2.els.goneNote.textContent]);
check('a used link drops the session already on this device before it shows that (an HQ one never reaches HQ from here)', JSON.stringify(G2.order) === JSON.stringify(['signout local']), G2.order);
G2.els.resendBtn.click(); G2.els.resendBtn.click(); settle();
var rq = G2.calls.filter(function (c) { return /\/auth\/one-click\/resend$/.test(c.url); });
check('Send me a new link: ONE request (twice tapped) to the billing Worker with the old token and the address it went to', rq.length === 1 && rq[0].method === 'POST' &&
  /api\.venueplay\.com\.au\/auth\/one-click\/resend$/.test(rq[0].url) && rq[0].body.t === TOKEN_A && rq[0].body.e === 'amit@caz.example', rq);
var sentMsg = G2.els.resendMsg.textContent;
check('it says a new link is on its way IF that address has a login (never whether it has), and the button goes', /If amit@caz\.example is on a venueplay login, a new link is on its way/.test(sentMsg) && G2.els.resendBtn.hidden === true, sentMsg);
var G2b = goPage('#t=' + TOKEN_A + '&e=amit%40caz.example', { status: 410, body: { ok: false } }); G2b.resendAnswer = { status: 200, body: { ok: false, anything: 'else' } };
G2b.els.goBtn.click(); settle(); G2b.els.resendBtn.click(); settle();
check('whatever the Worker\'s 200 says, the page says exactly the same words', G2b.els.resendMsg.textContent === sentMsg, G2b.els.resendMsg.textContent);
var G2c = goPage('#t=' + TOKEN_A, { status: 410, body: { ok: false } }); G2c.resendAnswer = { status: 429, body: { ok: false, busy: true } };
G2c.els.goBtn.click(); settle(); G2c.els.resendBtn.click(); settle();
check('too many tries from this network: told to wait, the button comes back', /Wait a few minutes/.test(G2c.els.resendMsg.textContent) && G2c.els.resendBtn.disabled === false && G2c.els.resendBtn.hidden === false, G2c.els.resendMsg.textContent);
var G2d = goPage('#t=' + TOKEN_A, { status: 410, body: { ok: false } }); G2d.resendAnswer = 'offline';
G2d.els.goBtn.click(); settle(); G2d.els.resendBtn.click(); settle();
check('no connection: says so, and the button comes back', /could not reach venueplay/.test(G2d.els.resendMsg.textContent) && G2d.els.resendBtn.disabled === false, G2d.els.resendMsg.textContent);
var G3 = goPage('#t=' + TOKEN_A, undefined, { data: null, error: { message: 'Token has expired or is invalid' } });
G3.els.goBtn.click(); settle();
check('Auth refuses the exchange: the same friendly page, no shift started, no error code shown', gone(G3) && G3.replaced === null && !G3.ls.vpShiftStart && G3.els.goMsg.textContent === '', G3.replaced);
var G4 = goPage('#e=amit%40caz.example'); settle();
check('no token, their address only (the welcome when migration 123 is missing): "Send me a sign-in link", nothing sent until a tap', G4.result === 'no-token' && gone(G4) && G4.calls.length === 0 &&
  G4.els.resendBtn.textContent === 'Send me a sign-in link' && G4.els.goneTitle.textContent === "Let's get you in", [G4.els.goneTitle.textContent, G4.els.resendBtn.textContent]);
check('no token, their address only: still the text code to the mobile first, never "we will email you a link"',
  G4.els.goneSub.textContent === 'Sign in with a text code to your mobile.' && !/send you a new link/i.test(G4.els.goneNote.textContent), [G4.els.goneSub.textContent, G4.els.goneNote.textContent]);
check('and the session already on this device is dropped first', JSON.stringify(G4.order) === JSON.stringify(['signout local']), G4.order);
var G5 = goPage('#t=short&e=' + encodeURIComponent('x" onmouseover="y')); settle();
check('a malformed token or address is not used: nothing sent, no new-link button (nothing to send it to), the mobile sign-in offered', G5.result === 'no-token' && G5.calls.length === 0 &&
  G5.els.resendBtn.hidden === true && G5.els.mobileLink.textContent === 'Sign in with my mobile' && /support@venueplay\.com\.au/.test(G5.els.goneNote.textContent), G5.els);
check('...and its note never promises to email a new link', !/send you a new link/i.test(G5.els.goneNote.textContent), G5.els.goneNote.textContent);
var G6 = goPage('#t=' + TOKEN_A, { status: 429, body: {} });
G6.els.goBtn.click(); settle();
check('rate-limited: told to wait, the button comes back, the link is not given up on', G6.replaced === null && !gone(G6) && /Wait a few minutes/.test(G6.els.goMsg.textContent) && G6.els.goBtn.disabled === false, G6.els.goMsg.textContent);

/* ============================== 3. the sign-in page ============================== */
section('3. The sign-in page: ALWAYS the mobile and a text code first (Dean, 29 Oct 2026)');
var INDEX = readFile('venueplay/app/index.html');
/* The wrong-number guard's own words and helpers (Dean, 12 Nov 2026), lifted as shipped so every harness that runs Send code runs it. */
var WRONG_NUMBER_SRC = (function () {
  var i = INDEX.indexOf('var WRONG_NUMBER_LINES='); if (i < 0) return '';
  var j = INDEX.indexOf('};', i) + 2;
  return 'var WRONG_NUMBER_LINES=' + INDEX.slice(i + 'var WRONG_NUMBER_LINES='.length, j) + '\n' + ['wrongNumberLine', 'hideWrongNumber', 'prefillWords', 'setPrefill'].map(function (n) { return lift(INDEX, n); }).join('\n') + '\n';
})();
var SHORT_ATTACH_SRC = (function () {   // the /short/attach answers (Dean, 12 Nov 2026): their words and the verdict, as shipped
  var i = INDEX.indexOf('var SHORT_ATTACH_WORDS='); if (i < 0) return 'var SHORT_ATTACH_WORDS={};\n';
  return INDEX.slice(i, INDEX.indexOf('};', i) + 2) + '\n' + lift(INDEX, 'shortAttachVerdict') + '\n' + lift(INDEX, 'noSuchLogin') + '\n';
})();
function signInPage(search, ls, prefill) {
  var ids = ['stepMobile', 'stepCode', 'emailAlt', 'emailAltMsg', 'authSub', 'emailIn', 'mobileIn', 'notMine', 'wrongNum'], els = {};
  ids.forEach(function (i) { els[i] = new El(i); });
  els.stepCode.classList.add('hidden'); els.emailAlt.classList.add('hidden'); els.emailAltMsg.classList.add('hidden');
  els.authSub.textContent = 'Sign in with a text code to your mobile.';
  var LS = ls || store(), SS = store(); if (prefill) SS.setItem('vpSignInPrefill', prefill);
  var fn = (new Function('$', 'localStorage', 'sessionStorage', 'window', 'var SUB_TEXT="Sign in with a text code to your mobile.", PREFILL_E164="";\n' + lift(INDEX, 'toE164') + '\n' + WRONG_NUMBER_SRC + lift(INDEX, 'openSignInStep') + '\nreturn openSignInStep();'));
  var hist = [], hash = arguments[3] || '';
  var out = fn(function (id) { return els[id]; }, LS, SS, { location: { search: search, hash: hash, pathname: '/app/' },
    history: { replaceState: function (a, b, u) { hist.push(u); } } });
  return { out: out, els: els, SS: SS, LS: LS, hist: hist };
}
function onMobile(P) { return P.out === 'sms' && !P.els.stepMobile.classList.contains('hidden') && P.els.emailAltMsg.classList.contains('hidden') && P.els.emailAlt.classList.contains('hidden') && P.els.authSub.textContent === 'Sign in with a text code to your mobile.'; }
var S1 = signInPage('?signin=email&gone=1', null, 'amit@caz.example');
check('an old ?signin=email link (every link in the welcome used to carry it): the MOBILE step, never the email box, and nothing put in it', onMobile(S1) && S1.els.emailIn.value === '' && S1.SS.getItem('vpSignInPrefill') === null, [S1.out, S1.els.authSub.textContent]);
var LSe = store(); LSe.setItem('vpSignInWith', 'email');
var S2 = signInPage('', LSe);
check('a device that last signed in by email (Dean\'s own browser): the MOBILE step, and the old key is cleared so it can never come back', onMobile(S2) && LSe.getItem('vpSignInWith') === null, [S2.out, LSe._s]);
var S3 = signInPage('');
check('nothing known: the mobile step', onMobile(S3));
/* THE PROSPECT WELCOME FOR A MOBILE LOGIN (Dean, 29 Oct 2026): ?signin=sms#m=04........ */
var S5 = signInPage('?signin=sms', null, null, '#m=0452510904');
check('?signin=sms from the welcome: the mobile step, their mobile filled in, the number out of the address bar',
  onMobile(S5) && S5.els.mobileIn.value === '0452 510 904' && S5.hist[0] === '/app/?signin=sms', [S5.out, S5.els.mobileIn.value, S5.hist]);
var S6 = signInPage('?signin=sms', null, null, '#m=07522836' + '67');
check('a number in the link that is not a mobile is never put in the box', onMobile(S6) && S6.els.mobileIn.value === '', S6.els.mobileIn.value);
check('the email backup is still there, but only behind "Code not arriving? Get it by email instead", with no email box', /<div id="emailAlt" class="hidden vp-c"[^>]*><span class="skiplink" id="emailAltBtn">Code not arriving\? Get it by email instead<\/span><\/div>/.test(INDEX) &&
  /<p id="emailAltMsg" class="note vp-c hidden"/.test(INDEX) && !/id="stepEmail"/.test(INDEX) && !/id="emailIn"/.test(INDEX));
/* A VENUE'S LINK NEVER LANDS IN HQ (Dean, 29 Oct 2026: the go page "links back to HQ"). The console's own
   router, run: an HQ session already in the browser, on a link that carries ?signin=, is dropped and the
   venue's sign-in shown; without ?signin= an admin still goes to HQ as before. */
function routeAdmin(search) {
  var R = { href: null, views: [], signouts: [], opened: 0 };
  var win = { location: { search: search, get href() { return R.href; }, set href(u) { R.href = u; } } };
  var fn = new Function('window', 'client', 'go', 'openSignInStep', 'impFlag', 'clearImp', 'praffleTile', 'showImpBanner', '__ctx',
    lift(INDEX, 'applyRoute') + '\nreturn applyRoute;');
  var applyRoute = fn(win, { auth: { signOut: function (o) { R.signouts.push(o && o.scope); return Promise.resolve({}); } } },
    function (v) { R.views.push(v); }, function () { R.opened++; }, function () { return null; }, function () {}, function () {}, function () {}, null);
  applyRoute({ authed: true, isAdmin: true });
  settle();
  return R;
}
var RA = routeAdmin('?signin=sms'), RC = routeAdmin('');
check('an HQ session opening a venue\'s link (?signin=): NOT sent to HQ; signed out on this device and shown the venue sign-in',
  RA.href === null && JSON.stringify(RA.signouts) === '["local"]' && RA.views.indexOf('vSignIn') !== -1 && RA.opened === 1, [RA]);
check('an HQ admin opening the console normally still goes to HQ', RC.href === 'hq.html' && RC.signouts.length === 0, RC);

function verifyRun(user, mode) {
  var LS = store(), routed = 0, btn = new El('verifyBtn'), otp = new El('otpIn'), err = new El('otpErr'); otp.value = '123456';
  var els = { otpIn: otp, otpErr: err, verifyBtn: btn };
  var src = 'return (' + liftAfter(INDEX, '$("verifyBtn").addEventListener("click", ') + ');';
  var handler = (new Function('$', 'localStorage', 'MODE', 'EMAIL', 'E164', 'client', 'routeAfterAuth', src))(
    function (id) { return els[id]; }, LS, mode, 'amit@caz.example', '+61452510904',
    { auth: { verifyOtp: function () { return Promise.resolve({ data: { user: user, session: {} }, error: null }); } } }, function () { routed++; });
  handler.call(btn); settle();
  return { m: LS.getItem('vpSignInWith'), shift: LS.getItem('vpShiftStart'), routed: routed };
}
var V1 = verifyRun({ id: 'u1', email: 'amit@caz.example', phone: '' }, 'email');
var V2 = verifyRun({ id: 'u2', email: '', phone: '61452510904' }, 'sms');
check('a verified code (either way) starts the 4 hour shift and routes on, and remembers NO "email" way in', !!V1.shift && V1.routed === 1 && V1.m === null && !!V2.shift && V2.m === null, [V1, V2]);
var initAt = INDEX.indexOf('// ================= INIT ================='), bootAt = INDEX.indexOf('go("vBoot");', initAt), callAt = INDEX.indexOf('openSignInStep();', initAt);
check('index.html calls openSignInStep() at start-up, before the auth check routes anywhere', initAt > 0 && callAt > initAt && callAt < bootAt, [initAt, callAt, bootAt]);


/* ============================== 3w. a different number in our pre-filled box ============================== */
section('3w. Our link filled in their mobile: a DIFFERENT number sends no code (Dean, 12 Nov 2026, the stray login)');
/* The whole sign-in step as shipped, in one scope: openSignInStep reads #m=, then the REAL Send code, "Not your
   number?", "Use that one" and the box's input listener. A changed number used to go straight to signInWithOtp,
   which makes a new login for it and lands on "This login is not linked to a venue yet". */
function flowRun(hash, ssInit) {
  var R = { otps: [], posts: [] }, els = {};
  ['stepMobile', 'stepCode', 'emailAlt', 'emailAltMsg', 'stepEmail', 'authSub', 'emailIn', 'mobileIn', 'mobileErr', 'sentTo', 'otpIn', 'notMine', 'notMineBtn', 'wrongNum', 'sendCodeBtn'].forEach(function (id) {
    els[id] = new El(id); els[id].focus = function () {}; });
  ['stepCode', 'emailAlt', 'emailAltMsg', 'stepEmail', 'notMine', 'wrongNum'].forEach(function (id) { els[id].classList.add('hidden'); });
  els.sendCodeBtn.textContent = 'Send code';
  var SS = store(); Object.keys(ssInit || {}).forEach(function (k) { SS.setItem(k, ssInit[k]); });
  var client = { auth: { signInWithOtp: function (o) { R.otps.push(o); return Promise.resolve({ error: null }); } } };
  var fetch = function (u, o) { R.posts.push({ u: u, b: JSON.parse(o.body) }); return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true }); } }); };
  var win = { location: { search: '?signin=sms', hash: hash, pathname: '/app/' }, history: { replaceState: function () {} } };
  function wire(id, ev, marker) { if (INDEX.indexOf(marker) >= 0) return 'els.' + id + '.addEventListener("' + ev + '", ' + liftAfter(INDEX, marker) + ');\n'; return ''; }
  var src = 'var E164="", MODE="sms", PREFILL_E164="", SUB_TEXT="Sign in with a text code to your mobile.";\n' +
    'function otpSendError(){ return "ours"; } function showEmailAlt(){}\n' +
    lift(INDEX, 'toE164') + '\n' + WRONG_NUMBER_SRC + SHORT_ATTACH_SRC + lift(INDEX, 'openSignInStep') + '\nopenSignInStep();\n' +
    wire('sendCodeBtn', 'click', '$("sendCodeBtn").addEventListener("click", ') +
    wire('notMineBtn', 'click', '$("notMineBtn").addEventListener("click", ') +
    wire('wrongNum', 'click', '$("wrongNum").addEventListener("click", ') +
    wire('mobileIn', 'input', '$("mobileIn").addEventListener("input", ');
  (new Function('$', 'els', 'client', 'sessionStorage', 'localStorage', 'fetch', 'window', src))(function (id) { return els[id]; }, els, client, SS, store(), fetch, win);
  R.els = els; R.SS = SS;
  R.send = function (typed) { if (typed !== undefined) els.mobileIn.value = typed; els.sendCodeBtn.click(); settle(); return R; };
  R.type = function (v) { els.mobileIn.value = v; (els.mobileIn.handlers.input || []).forEach(function (f) { f.call(els.mobileIn); }); return R; };
  R.line = function () { return els.wrongNum.classList.contains('hidden') ? '' : String(els.wrongNum.innerHTML || '').replace(/<[^>]+>/g, ''); };
  R.shown = function (id) { return !els[id].classList.contains('hidden'); };
  return R;
}
var CHANGED_LINE = "That's not the number we have for your venue. Use that one, or call us on 07 5228 3667 (press 2) to change it.";
var W0 = flowRun('#m=0452510904').send();
check('our number, untouched: the code goes to it as always (+61452510904), on to the code step, no wrong-number line',
  W0.otps.length === 1 && W0.otps[0].phone === '+61452510904' && !W0.els.stepCode.classList.contains('hidden') && W0.line() === '', [W0.otps, W0.line()]);
var W1 = flowRun('#m=0452510904').send('0433 999 888');
check('a DIFFERENT number typed over ours: NO code (signInWithOtp never called), no call to us, still on the mobile step',
  W1.otps.length === 0 && W1.posts.length === 0 && W1.els.stepCode.classList.contains('hidden') && W1.els.sendCodeBtn.disabled === false, W1.otps);
check('...and one line says so, word for word: "' + CHANGED_LINE + '"', W1.line() === CHANGED_LINE && W1.els.mobileErr.textContent === '', [W1.line(), W1.els.mobileErr.textContent]);
check('...the phone in it is the support line as a tel: link, never a person\'s mobile', /<a href="tel:\+61752283667">07 5228 3667<\/a>/.test(W1.els.wrongNum.innerHTML) && !/\b04\d{2}\s?\d{3}\s?\d{3}\b/.test(W1.els.wrongNum.innerHTML), W1.els.wrongNum.innerHTML);
W1.send('0433 999 888');
check('...asked again, still no code', W1.otps.length === 0, W1.otps);
var fm = ['+61 452 510 904', '0452-510-904', '61452510904', ' 0452510904 ', '(04) 5251 0904'].map(function (f) { var w = flowRun('#m=0452510904').send(f); return [f, w.otps.length, w.otps[0] && w.otps[0].phone, w.line()]; });
check('our number in another format (+61 452.., dashes, 614.., spaces, brackets) is the same number: sent to +61452510904, no line',
  fm.every(function (x) { return x[1] === 1 && x[2] === '+61452510904' && x[3] === ''; }), fm);
var W2 = flowRun('#m=0452510904').send('0433 999 888'); W2.type('0452 510 904');
check('changed, then typed back to ours: the line clears as they type', W2.line() === '', W2.line());
W2.send();
check('...and Send code then sends to our number', W2.otps.length === 1 && W2.otps[0].phone === '+61452510904', W2.otps);
var W3 = flowRun('#m=0452510904').send('0433 999 888');
(W3.els.wrongNum.handlers.click || []).forEach(function (f) { f.call(W3.els.wrongNum, { target: { id: 'useOursBtn' } }); });
check('"Use that one" puts our number back in the box and clears the line', W3.els.mobileIn.value === '0452 510 904' && W3.line() === '', [W3.els.mobileIn.value, W3.line()]);
W3.send();
check('...and it sends to our number', W3.otps.length === 1 && W3.otps[0].phone === '+61452510904', W3.otps);
var W4 = flowRun('#m=0452510904');
check('"Not your number?" is under the box when our link filled it in', W4.shown('notMine') && /<div class="hidden vp-c" id="notMine"><span class="skiplink" id="notMineBtn"[^>]*>Not your number\?<\/span><\/div>/.test(INDEX) &&
  INDEX.indexOf('id="notMine"') > INDEX.indexOf('id="mobileIn"') && INDEX.indexOf('id="notMine"') < INDEX.indexOf('id="sendCodeBtn"'), W4.shown('notMine'));
W4.els.notMineBtn.click(); settle();
check('...tapping it shows the help line (the number we have, and the phone to change it) and sends nothing',
  W4.line() === "That's the number we have for your venue. If it's not yours, call us on 07 5228 3667 (press 2) to change it." && W4.otps.length === 0, W4.line());
W4.send('0433 999 888');
check('...and it is not a way round: a different number after it still sends no code', W4.otps.length === 0 && W4.line() === CHANGED_LINE, [W4.otps, W4.line()]);
var W5 = flowRun('').send('0433 999 888');
check('NOTHING filled in (a host, a new venue): any number sends as always, no "Not your number?", no line',
  W5.otps.length === 1 && W5.otps[0].phone === '+61433999888' && !W5.shown('notMine') && W5.line() === '' && W5.SS.getItem('vpPrefillMobile') === null, [W5.otps, W5.shown('notMine')]);
var W6 = flowRun('#m=07522836' + '67').send('0433 999 888');
check('a number in the link that is not a mobile fills nothing and guards nothing', W6.otps.length === 1 && !W6.shown('notMine'), W6.otps);
var W7 = flowRun('', { vpPrefillMobile: '0452510904' });
check('a reload in the same tab (the address has lost #m=): our number is back in the box with "Not your number?"', W7.els.mobileIn.value === '0452 510 904' && W7.shown('notMine'), W7.els.mobileIn.value);
W7.send('0433 999 888');
check('...and a different number is still refused', W7.otps.length === 0 && W7.line() === CHANGED_LINE, W7.otps);
(function () {
  var LS = store(), SS = store(); SS.setItem('vpPrefillMobile', '0452510904'); SS.setItem('vpShortExistingOnly', 'used');
  var btn = new El('verifyBtn'), otp = new El('otpIn'); otp.value = '123456'; var els = { otpIn: otp, otpErr: new El('otpErr'), verifyBtn: btn };
  var h = (new Function('$', 'localStorage', 'sessionStorage', 'MODE', 'EMAIL', 'E164', 'client', 'routeAfterAuth', 'return (' + liftAfter(INDEX, '$("verifyBtn").addEventListener("click", ') + ');'))(
    function (id) { return els[id]; }, LS, SS, 'sms', '', '+61452510904', { auth: { verifyOtp: function () { return Promise.resolve({ data: { user: { id: 'u' }, session: {} }, error: null }); } } }, function () {});
  h.call(btn); settle();
  check('signed in with the code: our link\'s number is forgotten, so a later sign-in on this tab is a normal one', SS.getItem('vpPrefillMobile') === null && !!LS.getItem('vpShiftStart'), SS._s);
  check('...and so is a refused short link\'s "existing logins only" (vpShortExistingOnly)', SS.getItem('vpShortExistingOnly') === null && !!LS.getItem('vpShiftStart'), SS._s);
})();
var WL = (function () { var i = INDEX.indexOf('var WRONG_NUMBER_LINES='); return i < 0 ? '' : INDEX.slice(i, INDEX.indexOf('};', i)); })();
check('the new words have no em or en dash ("Not your number?", both lines)', WL.length > 0 && !/[–—]|&mdash;|&ndash;/.test(WL + 'Not your number?') &&
  !/[–—]/.test(INDEX.slice(INDEX.indexOf('id="notMine"'), INDEX.indexOf('id="mobileErr"'))), WL.slice(0, 80));
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
MIG175 = false;   // the database before migration 175 (NOT RUN): every send mints its own link, as live today. The one-link world: test-signin-in-thread.js section 7.
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
  var due = Date.parse(sent[0] && sent[0].scheduled_at);
  check('it lasts 90 DAYS FROM SETUP (Dean, 4 Nov 2026; 90 since 10 Nov, INBOX 154), the moment every link resent to them ends at: not 14 days from when the email goes', Math.abs(life - 90 * 86400000) < 5000 &&
    Date.parse(row.expires_at) > due + 14 * 86400000, [life, row.expires_at, sent[0] && sent[0].scheduled_at]);
  /* BEFORE MIGRATION 151 the table refuses a life over 15 days. Then the same link is made with 14 days, the
     welcome still goes, and HQ is told the number the link REALLY has (never a number that is not the real expiry). */
  world();
  var strict = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (/\/rest\/v1\/vp_signin_links(\?|$)/.test(String(url)) && opts && opts.method === 'POST') {
      var b = JSON.parse(opts.body);
      if (Date.parse(b.expires_at) - Date.parse(b.created_at) > 15 * 86400000) return Promise.resolve({ ok: false, status: 400, text: function () { return Promise.resolve('new row for relation "vp_signin_links" violates check constraint "vp_signin_links_life"'); }, json: function () { return Promise.resolve({}); } });
    }
    return strict(url, opts);
  };
  var r151 = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var row151 = DB.vp_signin_links[DB.vp_signin_links.length - 1] || {};
  check('before migration 151: the welcome still goes, with a 14 day link (from when it goes), and HQ is told to run 151', r151.status === 200 && r151.body.welcome_sent === true && DB.vp_signin_links.length === 1 &&
    Math.abs(Date.parse(row151.expires_at) - Date.parse(row151.created_at) - (14 * 86400000 + 90 * 60000)) < 5000 && (r151.body.warnings || []).some(function (w) { return /15 days, not 90/.test(w) && /migrations 151 and 185/.test(w); }), [r151.body.warnings, row151]);
  globalThis.fetch = strict;
  world();
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  v = DB.vp_venues[0] || {}; login = AUTH[0] || {}; row = DB.vp_signin_links[0] || {}; html = sent[0] ? sent[0].html : ''; token = tokenOf(html);
  var L = hrefs(html), txt = visible(html);
  var main = L.filter(function (h) { return h.indexOf('/app/go#') !== -1; });
  check('the email\'s main button "Open your venueplay" is the one-click link, with the token and their address in the fragment',
    main.length === 1 && main[0] === 'https://www.venueplay.com.au/app/go#t=' + token + '&e=cazreitop%40gmail.com' &&
    new RegExp('<a href="' + main[0].replace(/[.?*+^$()|[\]\\]/g, '\\$&') + '"[^>]*>Open your venueplay</a>').test(html), main);
  /* Version 3 (Dean, 29 Oct 2026): no "this link works once, next time sign in with your email" story. */
  check('it says the button opens their account, with no "works once, next time your email" story', /The button below opens your account for you\. No password, and no app to download\./.test(txt) &&
    !/works once|straight in, once|Next time|After that/i.test(txt), txt.slice(0, 900));
  check('it is the ONLY sign-in link in the email (version 2: one button)', L.filter(function (h) { return h.indexOf('/app') !== -1; }).length === 1, L);
  check('nothing left unfilled and no em dash', html.indexOf('{{') === -1 && html.indexOf('<!--IF:') === -1 && !/[—–]/.test(txt));
  var t2 = await freshLink(undefined, v.id, login.id);
  check('a second link for the same login is a different token', t2 !== token && /^[A-Za-z0-9_-]{43}$/.test(t2));

  section('1b. POST /auth/one-click signs in ONCE (a login whose details are in: a mobile on it)');
  /* Since Dean, 11 Nov 2026 (INBOX 248) a link keeps working until its login has a mobile and (a new prospect) its name
     saved; that is tools/test-welcome-details.js. Here the login has its mobile, so it is the one-use link it always was. */
  login.phone = '61452510904';
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

  section('1s. THE SHORT LINK IN A TEXT (Dean, 6 Nov 2026): venueplay.com.au/s/AB2CD7KMNPQR, our own, never a login key');
  var SHORT_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;
  /* The Worker's constants live inside its own scope, so they are read from the lines that declare them. */
  var WSRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var VPA_SHORT_PER_IP = +(/\nconst VPA_SHORT_PER_IP = (\d+);/.exec(WSRC) || [0, 0])[1];
  var VPA_SHORT_ALPHA = (/\nconst VPA_SHORT_ALPHA = '([A-Z0-9]+)';/.exec(WSRC) || [0, ''])[1];
  var codes = {}; for (var ci = 0; ci < 300; ci++) codes[vpaShortSigninCode()] = 1;
  var ck = Object.keys(codes);
  check('a short code is 12 letters and digits with no look-alikes (no I, L, O, 0 or 1), at least 59 bits (31^12), and 300 in a row are all different',
    Math.log(Math.pow(VPA_SHORT_ALPHA.length, 12)) / Math.LN2 >= 59 && VPA_SHORT_ALPHA.length === 31 && ck.length === 300 && ck.every(function (c) { return SHORT_RE.test(c); }) && !ck.some(function (c) { return /[ILO01]/.test(c); }), ck.slice(0, 3));
  /* The prospect's row as migration 175 makes it (this suite's world is the database before 175). */
  var pRow = DB.vp_prospects.filter(function (x) { return x.venue_id === v.id; })[0];
  pRow.signin_code_enc = null; pRow.signin_code_hash = null; MIG175 = true;
  var nLinks0 = DB.vp_signin_links.length;
  var one1 = await vpaProspectOneLink(ENV, v.id, login.id, {});
  var code1 = one1 && one1.token;
  check('the short link is never a login key: making it adds NO sign-in token at all, and no row anywhere holds the letters or their plain hash',
    SHORT_RE.test(code1 || '') && one1.short === true && DB.vp_signin_links.length === nLinks0 && JSON.stringify(DB).indexOf(code1) === -1 &&
    JSON.stringify(DB).indexOf(await vpaSigninTokenHash(code1)) === -1 && !!pRow.signin_code_hash, [code1, DB.vp_signin_links.length, nLinks0]);
  var surl = vpaShortSigninUrl('https://www.venueplay.com.au', code1);
  check('the link is our own domain, /s/ and the letters: no venue name, no email, no third party', surl === 'venueplay.com.au/s/' + code1, surl);
  GEN.length = 0;
  var sOk = await vpaHandleOneClick(click(code1.toLowerCase()), ENV, J);
  var sOk2 = await vpaHandleOneClick(click(code1), ENV, J);
  check('SECURITY: the letters at the one-tap sign-in are refused the same way as a spent link, every time, and Auth is never asked', sOk.status === 410 && sOk2.status === 410 && JSON.stringify(sOk.body) === '{"ok":false}' && GEN.length === 0, [sOk, sOk2]);
  sent.length = 0;
  DB.vp_signin_links.forEach(function (l) { l.created_at = new Date(Date.now() - 2 * 86400000).toISOString(); });   // the day's cap on links for one login is not what this checks
  var rsS = await vpaHandleOneClickResend({ url: 'https://api/auth/one-click/resend', headers: { get: function (k) { return k === 'cf-connecting-ip' ? '203.0.113.240' : ''; } }, text: function () { return Promise.resolve(JSON.stringify({ t: code1 })); } }, ENV, J);
  var selfMail = String((sent[0] || {}).html || '');
  check('"Send me a new link" with the letters: emails the login\'s OWN address a long one-tap link of its own, never the short one',
    rsS.body.ok === true && sent.length === 1 && String(sent[0].to).indexOf('cazreitop@gmail.com') !== -1 && /\/app\/go#t=[A-Za-z0-9_-]{43}/.test(selfMail) && selfMail.indexOf('/s/') === -1, [rsS.body, sent.map(function (m) { return m.to; })]);
  MIG175 = false;

  var SH = readFile('venueplay/s.html'); var sJs = /<script>([\s\S]*?)<\/script>/.exec(SH)[1];
  function sPage(path, answer) {
    var P = { to: null, posts: [], store: {} };
    var location = { pathname: path, replace: function (u) { P.to = u; } };
    var sessionStorage = { setItem: function (k, v) { P.store[k] = v; }, removeItem: function (k) { delete P.store[k]; }, getItem: function (k) { return P.store[k] || null; } };
    var fetch = function (u, o) { P.posts.push({ u: u, b: JSON.parse(o.body) });
      return answer === 'down' ? Promise.reject(new TypeError('offline')) : Promise.resolve({ json: function () { return Promise.resolve(answer || { go: '/app/' }); } }); };
    var setTimeout = function () {};
    (new Function('location', 'sessionStorage', 'fetch', 'setTimeout', sJs))(location, sessionStorage, fetch, setTimeout); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
    return P;
  }
  var pk = sPage('/s/ab2cd7kmnpqr', { go: '/app/?signin=sms#m=0412345678' });
  check('the /s/ page asks the Worker with the letters only (capitals), and goes where it says: the normal sign-in, mobile filled in',
    pk.posts.length === 1 && /\/short\/open$/.test(pk.posts[0].u) && JSON.stringify(pk.posts[0].b) === '{"code":"AB2CD7KMNPQR"}' && pk.to === '/app/?signin=sms#m=0412345678' && !pk.store.vpShortAttach, pk);
  var pn = sPage('/s/AB2CD7KMNPQR/', { go: '/app/?signin=sms', attach: true });
  check('no mobile held: the empty sign-in, with the letters left for it (so the number they type goes on THIS account)', pn.to === '/app/?signin=sms' && pn.store.vpShortAttach === 'AB2CD7KMNPQR', pn);
  var pe = sPage('/s/AB2CD7KMNPQR', { go: 'https://evil.example/' });
  var pd = sPage('/s/AB2CD7KMNPQR', 'down');
  check('it only ever goes into /app/ (any other answer, or no answer, is the plain sign-in)', pe.to === '/app/' && pd.to === '/app/', [pe.to, pd.to]);
  check('anything that is not 12 letters (look-alikes, wrong length, more path) goes to the normal sign-in without asking',
    sPage('/s/AB12CD7KMNPQ').to === '/app/' && sPage('/s/ABC').to === '/app/' && sPage('/s/AB2CD7KMNPQR/x').to === '/app/' && sPage('/s/').to === '/app/' && sPage('/s/ABC').posts.length === 0);
  check('_redirects serves /s/* from that page, and it sends no referrer', /^\/s\/\*\s+\/s\s+200$/m.test(readFile('venueplay/_redirects')) && /name="referrer" content="no-referrer"/.test(SH));
  /* The sign-in page's Send code (app/index.html), run as shipped: with the letters left by /s/ (no mobile held) it puts
     the typed number on that account's login (POST /short/attach) BEFORE the code is sent; without them, as always. */
  function sendCodeRun(store, attachAnswer, typed, otpAnswer) {
    var R = { posts: [], otps: [], err: '', store: store };
    var els = {}; ['mobileIn', 'mobileErr', 'sentTo', 'stepMobile', 'stepCode', 'otpIn', 'emailAlt'].forEach(function (id) { els[id] = new El(id); els[id].focus = function () {}; });
    els.mobileIn.value = typed || '0433 444 555';
    els.stepCode.classList.add('hidden');   // the page opens on the mobile step
    var $ = function (id) { return els[id]; };
    var client = { auth: { signInWithOtp: function (o) { R.otps.push(o); return Promise.resolve(otpAnswer && o.options && o.options.shouldCreateUser === false ? otpAnswer : { error: null }); } } };
    var sessionStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
    var fetch = function (u, o) { R.posts.push({ u: u, b: JSON.parse(o.body) }); var a = attachAnswer || { status: 200, body: { ok: true } };
      if (a === 'down') return Promise.reject(new TypeError('Failed to fetch'));   // the Worker unreachable
      return Promise.resolve({ status: a.status, json: function () { return a.body === 'not json' ? Promise.reject(new SyntaxError('bad json')) : Promise.resolve(a.body); } }); };
    var h = liftAfter(INDEX, '$("sendCodeBtn").addEventListener("click", ');
    els.wrongNum = new El('wrongNum'); els.wrongNum.classList.add('hidden');
    var fn = (new Function('$', 'client', 'sessionStorage', 'fetch', 'toE164', 'otpSendError', 'showEmailAlt',
      'var E164 = "", MODE = "sms", PREFILL_E164 = "";\n' + WRONG_NUMBER_SRC + SHORT_ATTACH_SRC + 'return ' + h + ';'))($, client, sessionStorage, fetch, (new Function(lift(INDEX, 'toE164') + '\nreturn toE164;'))(), function () { return 'ours'; }, function () {});
    fn.call({ disabled: false, textContent: 'Send code' });
    for (var i = 0; i < 10; i++) drainMicrotasks();
    R.err = els.mobileErr.textContent; R.stepCode = !els.stepCode.classList.contains('hidden');
    return R;
  }
  var sc1 = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' });
  check('NO MOBILE HELD, the sign-in page: the typed number goes on that account first (/short/attach with the letters), THEN the normal text code; the letters are forgotten',
    sc1.posts.length === 1 && /\/short\/attach$/.test(sc1.posts[0].u) && sc1.posts[0].b.code === 'AB2CD7KMNPQR' && sc1.posts[0].b.mobile === '+61433444555' &&
    sc1.otps.length === 1 && sc1.otps[0].phone === '+61433444555' && !('vpShortAttach' in sc1.store), sc1);
  var sc2 = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, { status: 409, body: { error: 'That mobile already has a venueplay login. Sign in with it, or use a different mobile.', taken: true } });
  check('...a mobile that is another login: they are told, and NO code is sent', sc2.otps.length === 0 && /already has a venueplay login/.test(sc2.err), sc2);
  /* Every OTHER attach answer stops too (Dean, 12 Nov 2026). It used to fall through to signInWithOtp({phone}), which
     makes a brand new login for a number that has none: the stray login on "This login is not linked to a venue yet". */
  var BUSY = 'Something went wrong. Wait a minute and try again.';
  var USED = 'This link has already been used. Sign in with the number we have for your venue, or call us on 07 5228 3667 (press 2).';
  var HASM = 'We already have a mobile for your venue. Sign in with that number, or call us on 07 5228 3667 (press 2) to change it.';
  var scB = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, { status: 429, body: { error: 'Too many tries. Wait a minute.', busy: true } });
  check('...429 busy: NO code (signInWithOtp never called), still on the mobile step, and "' + BUSY + '"; the letters are kept for the next try',
    scB.posts.length === 1 && scB.otps.length === 0 && !scB.stepCode && scB.err === BUSY && scB.store.vpShortAttach === 'AB2CD7KMNPQR', scB);
  var scD = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, 'down');
  check('...the Worker unreachable (fetch rejects): NO code, the same wait-a-minute line, letters kept',
    scD.posts.length === 1 && scD.otps.length === 0 && !scD.stepCode && scD.err === BUSY && scD.store.vpShortAttach === 'AB2CD7KMNPQR', scD);
  var odd = [{ status: 500, body: { error: 'x' } }, { status: 502, body: 'not json' }, { status: 200, body: {} }, { status: 404, body: { error: 'Not found' } }].map(function (a) { var r = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, a); return [a.status, r.otps.length, r.err]; });
  check('...any other answer (500, 502 with no JSON, a 200 without ok, 404): NO code, the wait-a-minute line', odd.every(function (x) { return x[1] === 0 && x[2] === BUSY; }), odd);
  var scU = ['claimed', 'ended'].map(function (st) { var r = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, { status: 409, body: { ok: false, state: st } }); return r; });
  check('...409 the link is claimed or ended: NO code, "' + USED + '", and the letters are forgotten',
    scU.every(function (r) { return r.otps.length === 0 && !r.stepCode && r.err === USED && !('vpShortAttach' in r.store) && r.store.vpShortExistingOnly === 'used'; }), scU.map(function (r) { return [r.otps.length, r.err, r.store]; }));
  var scH = sendCodeRun({ vpShortAttach: 'AB2CD7KMNPQR' }, { status: 409, body: { ok: false, has_mobile: true } });
  check('...409 has_mobile (we already hold one): NO code, "' + HASM + '", letters forgotten',
    scH.otps.length === 0 && !scH.stepCode && scH.err === HASM && !('vpShortAttach' in scH.store) && scH.store.vpShortExistingOnly === 'has_mobile', scH);
  check('...the phone in all three lines is the support line, never a mobile, and none has an em or en dash',
    SHORT_ATTACH_SRC.indexOf(BUSY) > 0 && SHORT_ATTACH_SRC.indexOf(USED) > 0 && SHORT_ATTACH_SRC.indexOf(HASM) > 0 && !/\b04\d{2}\s?\d{3}\s?\d{3}\b/.test(SHORT_ATTACH_SRC) && !/[\u2013\u2014]|&mdash;|&ndash;/.test(SHORT_ATTACH_SRC), SHORT_ATTACH_SRC.slice(0, 120));
  var scN = sendCodeRun({ vpShortExistingOnly: 'has_mobile' }, null, '0452 510 904');
  check('...after that 409, Send code again (the number we hold): no call to us, a code that can only reach a login that EXISTS (shouldCreateUser:false)',
    scN.posts.length === 0 && scN.otps.length === 1 && scN.otps[0].phone === '+61452510904' && !!scN.otps[0].options && scN.otps[0].options.shouldCreateUser === false && scN.stepCode, scN.otps);
  var scX = sendCodeRun({ vpShortExistingOnly: 'used' }, null, '0433 999 888', { error: { message: 'Signups not allowed for otp', code: 'otp_disabled', status: 422 } });
  check('...and a number with no login is refused there (no new login), on the mobile step, with the same line',
    scX.otps.length === 1 && !!scX.otps[0].options && scX.otps[0].options.shouldCreateUser === false && !scX.stepCode && scX.err === USED, [scX.otps, scX.err]);
  var sc3 = sendCodeRun({});
  check('...and without the letters the page is exactly as before: no call to us, the normal code', sc3.posts.length === 0 && sc3.otps.length === 1 && sc3.otps[0].phone === '+61433444555' && !sc3.otps[0].options, sc3);
  var GW = {}; (new Function('window', ONECLICK))(GW);
  check('the go page takes only the long one-tap token: the short letters are not a token there', GW.VPOneClick.parse('#t=ab2cd7kmnpqr').t === '' && GW.VPOneClick.parse('#t=' + TOKEN_A).t === TOKEN_A);

  section('1c. Without migration 123 the prospect is still set up, and the button opens the page that emails them a link (never the email sign-in)');
  world(); MIG123 = false;
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var h2 = sent[0] ? sent[0].html : '', L2 = hrefs(h2), t3 = visible(h2);
  check('set up and sent, HQ told why there is no one-click button', r.status === 200 && r.body.welcome_sent === true && (r.body.warnings || []).some(function (w) { return /one-click sign-in button was not made \(run migration 123\)/.test(w); }), r.body);
  check('the main button opens /app/go with their address (it offers "Send me a sign-in link"), with no token and no ?signin=email anywhere',
    /<a href="https:\/\/www\.venueplay\.com\.au\/app\/go#e=cazreitop%40gmail\.com"[^>]*>Open your venueplay<\/a>/.test(h2) && L2.every(function (h) { return h.indexOf('#t=') === -1 && h.indexOf('signin=email') === -1; }) &&
    /Tap the button below and we'll email cazreitop@gmail\.com a link that opens your account\./.test(t3) && !/email you a code/.test(t3), L2);

  if (bad) throw new Error('one-click sign-in: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
