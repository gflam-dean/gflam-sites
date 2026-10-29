/* SIGN IN WITH THE MOBILE, AND A ONE-OFF LINK THAT ASKS NAME AND MOBILE FIRST (Dean, 29 Oct 2026), RUN.

   "When you go to venueplay.com.au/app it says email address for your VenuePlay login... we don't actually
   get the email addresses of the host so it's got to be phone number... when they sign up on boarding they
   get a link that is a one off link that gets them to ask the first question name and phone number...
   Automatic sign in they click it once that's it otherwise we can resend it or maybe they could resend it."

     1. the name-and-mobile screen (venueplay/app/vp-about-you.js) in a small fake DOM: who sees it, the
        name prefilled, the mobile put on the login ONLY through Auth's verified phone change in the
        sign-in format (+614...), the name on the login and through /account/my-name, a mobile already on
        another login, "Code not arriving? Carry on for now" for this sign-in only, every word textContent
     2. the console wiring (index.html proceedVenue, run): that screen comes before the venue pick and the
        prospect's setup guide; the guide starts at the Terms once a mobile is on
     3. the REAL billing Worker (tools/rig-billing-worker.js):
          POST /auth/one-click/resend   a spent link asks for a new one: it goes to the LOGIN'S OWN email,
                                         older unused links are retired, the new one signs in once; ONE
                                         answer whatever happens; per network and per login limits
          POST /admin/signin-link       HQ's "Resend sign-in link": owner or accounts only, the prospect's
                                         own login, says who it went to, its own limit, audited
          POST /account/my-name         a login names ITSELF on its own staff rows, nobody else's
        and no welcome, link or email carries ?signin=email any more

   Run from the repo root:  jsc tools/test-phone-signin.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
function settle() { for (var i = 0; i < 12; i++) drainMicrotasks(); }
function store() {
  var s = {};
  return { _s: s, getItem: function (k) { return k in s ? s[k] : null; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } };
}
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}

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

/* ============================== 1. the name-and-mobile screen ============================== */
var ABOUT = readFile('venueplay/app/vp-about-you.js');
var W1 = {}; (new Function('window', ABOUT))(W1);
var AY = W1.VPAboutYou;
section('1. The first screen after the one-off link: their name and mobile');
check('vp-about-you.js loads and offers open and wants', !!(AY && typeof AY.open === 'function' && typeof AY.wants === 'function'));
var USER = { id: 'u1', email: 'amit@caz.example', phone: '', user_metadata: {} };
function ctxOf(over) { return Object.assign({ authed: true, isAdmin: false, scope: 'staff', user: USER, role: 'manager',
  venue: { id: 'V1', name: "Caz Reitop's Dirty Secrets" }, staff: [{ venue_id: 'V1', role: 'manager', display_name: 'Amit' }] }, over || {}); }
check('a venue login with NO mobile on it sees it', AY.wants(ctxOf(), store()) === true);
check('a login that already has a mobile does not', AY.wants(ctxOf({ user: { id: 'u2', phone: '61452510904' } }), store()) === false);
check('an HQ admin (View as included) never does', AY.wants(ctxOf({ isAdmin: true, scope: 'admin' }), store()) === false && AY.wants(ctxOf({ scope: 'admin' }), store()) === false);
check('nobody signed in does not', AY.wants({ authed: false }, store()) === false && AY.wants(null, store()) === false);
var laterStore = store(), shiftA = store(), shiftB = store(); laterStore.setItem('vpAboutYouLater:u1', 'shift:1000'); shiftA.setItem('vpShiftStart', '1000'); shiftB.setItem('vpShiftStart', '2000');
check('a login that tapped "Carry on for now" is not asked again this sign-in', AY.wants(ctxOf(), laterStore, shiftA) === false);
check('but is asked again at the next sign-in, even in the same tab', AY.wants(ctxOf(), laterStore, shiftB) === true);
check('the mobile is written as every sign-in number is (+614XXXXXXXX), anything else refused', AY.mobileE164('0452 510 904') === '+61452510904' && AY.mobileE164('+61 452 510 904') === '+61452510904' &&
  AY.mobileE164('07 5228 3667') === '' && AY.mobileE164('12345') === '');
/* The same answer as the sign-in page's toE164 for every 04 number: run both. */
var toE164 = (new Function(lift(readFile('venueplay/app/index.html'), 'toE164') + '\nreturn toE164;'))();
check('and for a mobile it is exactly what the SMS sign-in sends (index.html toE164, run)', ['0452510904', '0452 510 904', '+61452510904', '61452510904'].every(function (x) { return toE164(x) === AY.mobileE164(x); }));

function screen(opts) {
  opts = opts || {};
  var doc = newDoc(), S = { calls: [], fetches: [], done: [], ss: opts.ss || store() };
  var u = opts.user || { id: 'u1', email: 'amit@caz.example', phone: '', user_metadata: opts.meta || {} };
  S.client = { auth: {
    getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1' } } }); },
    updateUser: function (a) { S.calls.push({ fn: 'updateUser', args: a });
      if (a.phone === '+61400000009') return Promise.resolve({ data: null, error: { message: 'Phone number already registered by another user', code: 'phone_exists' } });
      S.pending = a.phone; return Promise.resolve({ data: { user: { id: 'u1', phone: '' } }, error: null }); },
    verifyOtp: function (a) { S.calls.push({ fn: 'verifyOtp', args: a });
      if (a.type === 'phone_change' && a.phone === S.pending && a.token === '123456') return Promise.resolve({ data: { user: { id: 'u1', phone: S.pending.replace('+', '') } }, error: null });
      return Promise.resolve({ data: { user: null }, error: { message: 'Token has expired or is invalid' } }); } } };
  S.ctx = ctxOf(Object.assign({ user: u }, opts.ctx || {}));
  S.api = AY.open(S.ctx, { doc: doc, storage: S.ss, client: S.client, onDone: function (how) { S.done.push(how); },
    shift: opts.shift, fetch: function (url, o) { S.fetches.push({ url: url, headers: o.headers, body: JSON.parse(o.body) }); return Promise.resolve({ json: function () { return Promise.resolve({ ok: true }); } }); } });
  S.doc = doc; S.$ = function (id) { return doc.getElementById(id); };
  return S;
}
var A = screen();
check('it opens over everything, asking just two things: "Your name" and "Your mobile", and one button "Text me a code"',
  !!A.$('vpAboutYou') && shown(A.$('vpAyName')) && shown(A.$('vpAyMobile')) && A.$('vpAySend').textContent === 'Text me a code' && !shown(A.$('vpAyCode')) &&
  /Your name/.test(A.$('vpAyForm').textContent) && /Your mobile/.test(A.$('vpAyForm').textContent), A.$('vpAyForm') && A.$('vpAyForm').textContent);
check('the name is filled in from what HQ was told (their staff name), never "Manager"', A.$('vpAyName').value === 'Amit' &&
  screen({ ctx: { staff: [{ venue_id: 'V1', role: 'manager', display_name: 'Manager' }] } }).$('vpAyName').value === '' &&
  screen({ meta: { full_name: 'Amit Shah' } }).$('vpAyName').value === 'Amit Shah');
check('it says why the code: it only goes on the login once they type it', /only goes on your login once you type that code in/.test(A.$('vpAyForm').textContent));
A.$('vpAyName').value = ''; A.$('vpAyMobile').value = '0452 510 904'; A.$('vpAySend').click(); settle();
check('no name: asked for it, nothing sent', /Pop your name in first/.test(A.$('vpAyMsg').textContent) && A.calls.length === 0, A.$('vpAyMsg').textContent);
A.$('vpAyName').value = 'Amit  <b>Shah</b> '; A.$('vpAyMobile').value = '07 5228 3667'; A.$('vpAySend').click(); settle();
check('a landline: refused in plain words before any text is sent', /should start 04/.test(A.$('vpAyMsg').textContent) && A.calls.length === 0, A.$('vpAyMsg').textContent);
A.$('vpAyMobile').value = '0452 510 904'; A.$('vpAySend').click(); A.$('vpAySend').click(); settle();
var up = A.calls.filter(function (c) { return c.fn === 'updateUser'; });
check('"Text me a code": ONE phone change asked of Auth (twice tapped), the number as +61452510904, the name riding with it onto the login', up.length === 1 &&
  up[0].args.phone === '+61452510904' && up[0].args.data && up[0].args.data.full_name === 'Amit bShah/b', up);
check('nothing is written to the login before the code: the only Auth call so far is the pending change', A.calls.length === 1 && A.ctx.user.phone === '', A.calls);
check('the code box replaces the form, saying where it went', !shown(A.$('vpAyForm')) && shown(A.$('vpAyCode')) && /We sent it to 0452 510 904/.test(A.$('vpAySentTo').textContent), A.$('vpAySentTo').textContent);
check('and "Code not arriving? Carry on for now" is there for the night texts stop', shown(A.$('vpAyLater')) && A.$('vpAyLater').textContent === 'Code not arriving? Carry on for now');
A.$('vpAyCode').value = '999999'; A.$('vpAyVerify').click(); settle();
check('a wrong code: "That code didn\'t match", not saved, still on the code box', /didn't match/.test(A.$('vpAyMsg').textContent) && A.done.length === 0 && A.fetches.length === 0, A.$('vpAyMsg').textContent);
A.$('vpAyCode').value = '123456'; A.$('vpAyVerify').click(); settle();
var vo = A.calls.filter(function (c) { return c.fn === 'verifyOtp'; }).pop();
check('the right code is verified as a PHONE CHANGE for that same number (Auth puts it on the login only now)', vo && vo.args.type === 'phone_change' && vo.args.phone === '+61452510904' && vo.args.token === '123456', vo);
check('then their name goes to /account/my-name on the billing Worker, signed in as them', A.fetches.length === 1 && /venueplay-api\.dean-tindale\.workers\.dev\/account\/my-name$/.test(A.fetches[0].url) &&
  A.fetches[0].headers.Authorization === 'Bearer TOKEN-1' && A.fetches[0].body.name === 'Amit bShah/b', A.fetches);
check('"All set": from now on they sign in with that mobile by text code, one button on', /^All set, Amit$/.test(A.$('vpAyTitle').textContent) &&
  /From now on, sign in with 0452 510 904 and we'll text you a code/.test(A.$('vpAySub').textContent) && !!A.$('vpAyGo') && A.done.length === 0, [A.$('vpAyTitle').textContent, A.$('vpAySub').textContent]);
A.$('vpAyGo').click();
check('"Let\'s go": the screen goes and the console carries on', A.done.join() === 'done' && !A.$('vpAboutYou'), A.done);
check('the login now carries the mobile, so the screen is not asked for again', AY.wants(A.ctx, store()) === false);
check('nothing on the screen was ever written as HTML', !anyHtml(A.doc.body));

var B = screen();
B.$('vpAyName').value = 'Amit'; B.$('vpAyMobile').value = '0400 000 009'; B.$('vpAySend').click(); settle();
check('a mobile already on another login: says so, with the 07 support line (never a personal mobile), and stays on the form', /already signs in to VenuePlay on another login/.test(B.$('vpAyMsg').textContent) &&
  /07 5228 3667/.test(B.$('vpAyMsg').textContent) && shown(B.$('vpAyMobile')) && B.done.length === 0, B.$('vpAyMsg').textContent);
var C = screen({ shift: shiftA });
C.$('vpAyName').value = 'Amit Shah'; C.$('vpAyMobile').value = '0452510904'; C.$('vpAySend').click(); settle();
C.$('vpAyLater').click(); settle();
check('"Carry on for now": their name is still saved, they are let in, and it holds for this sign-in only (sessionStorage, by shift)', C.fetches.length === 1 && C.fetches[0].body.name === 'Amit Shah' &&
  C.done.join() === 'later' && C.ss.getItem('vpAboutYouLater:u1') === 'shift:1000' && AY.wants(C.ctx, C.ss, shiftA) === false && AY.wants(C.ctx, C.ss, shiftB) === true &&
  C.calls.filter(function (c) { return c.fn === 'verifyOtp'; }).length === 0, [C.done, C.ss._s]);
var D = screen();
D.$('vpAyName').value = 'Amit'; D.$('vpAyMobile').value = '0452510904'; D.$('vpAySend').click(); settle(); D.$('vpAyAgain').click();
check('"Change the number" goes back to the form', shown(D.$('vpAyMobile')) && !shown(D.$('vpAyCode')));
check('no em dash or "roster" anywhere a person reads on it', !/[\u2014\u2013]/.test(ABOUT) && !/roster/i.test(ABOUT.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ============================== 2. the console wiring ============================== */
section('2. The console asks for it first, before the venue pick and the setup guide');
var INDEX = readFile('venueplay/app/index.html');
function runProceed(ctx, ayWants) {
  var R = { order: [] };
  var fn = new Function('__ctx', 'window', 'VPAboutYou', 'VPFirstRun', 'VP', 'go', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'pairToVenue', '$',
    lift(INDEX, 'proceedVenue') + '\nreturn proceedVenue;');
  var AYs = { wants: function () { return ayWants; }, open: function (c, d) { R.order.push('aboutyou'); R.onDone = d.onDone; } };
  var FR = { wants: function () { return true; }, open: function () { R.order.push('firstrun'); } };
  var VPs = { getClient: function () { return {}; }, holdGate: function () { return false; }, termsGate: function () { return false; } };
  var win = { VPAboutYou: AYs, VPFirstRun: FR, VP: VPs };
  var p = fn(ctx, win, AYs, FR, VPs, function (v) { R.order.push('go ' + v); }, function () {}, function () {}, function () { return false; }, function () { R.order.push('venuepick'); },
    function () { R.order.push('pair'); return true; }, function () { return { value: '', focus: function () {} }; });
  p();
  R.again = function () { ayWants = false; R.onDone('done'); };
  return R;
}
var P1 = runProceed({ venue: { slug: 'x' }, staff: [{}, {}] }, true);
check('a login with no mobile: the name-and-mobile screen first, before the venue pick (and nothing else opens behind it)', P1.order.join() === 'aboutyou,go vBoot', P1.order);
P1.again();
check('once it is done the console carries on to the venue pick as before', P1.order.slice(2).join() === 'venuepick', P1.order);
var P2 = runProceed({ venue: { slug: 'x' }, staff: [{}] }, true);
P2.again();
check('a one-venue prospect: name and mobile, then the setup guide', P2.order.join() === 'aboutyou,go vBoot,firstrun,go vBoot', P2.order);
var P3 = runProceed({ venue: { slug: 'x' }, staff: [{}] }, false);
check('a login that already has its mobile goes straight on, untouched', P3.order.indexOf('aboutyou') === -1 && P3.order[0] === 'firstrun', P3.order);
check('index.html loads vp-about-you.js', /<script src="vp-about-you\.js"><\/script>/.test(INDEX));

var FIRSTRUN = readFile('venueplay/app/vp-firstrun.js');
var W2 = {}; (new Function('window', FIRSTRUN))(W2);
function guide(user) {
  var doc = newDoc(), st = store();
  var api = W2.VPFirstRun.open({ role: 'manager', venue: { id: 'V1', name: 'Caz', slug: 'caz', terms_required: true }, user: user, staff: [] },
    { doc: doc, storage: st, client: { auth: { getUser: function () { return Promise.resolve({ data: { user: user } }); }, getSession: function () { return Promise.resolve({ data: { session: null } }); } } },
      VP: {}, setInterval: function () { return 1; }, clearInterval: function () {}, fetch: function () { return Promise.resolve({ json: function () { return Promise.resolve({}); } }); } });
  settle();
  return api;
}
check('the setup guide starts at the Terms when their mobile is already on (no step that is already done)', guide({ id: 'u1', phone: '61452510904' }).step() === 'terms');
check('and still at Add your mobile for a login that carried on without one', guide({ id: 'u1', phone: '' }).step() === 'mobile');

/* ============================== 3. the billing Worker ============================== */
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

(async function () {
  section('3a. A spent link asks for a new one (POST /auth/one-click/resend)');
  world();
  var spent = await oldLink(AMIT, V1, 3600000);
  var r = await vpaHandleOneClickResend(pub('/auth/one-click/resend', { t: spent, e: 'someone-else@evil.example' }), ENV, J);
  var mail = sent[0] || {}, html = mail.html || '', fresh = tokenOf(html);
  check('a used link: { ok:true }, and ONE email, to the LOGIN\'S OWN address (never the address the caller put beside it)', r.status === 200 && JSON.stringify(r.body) === '{"ok":true}' &&
    sent.length === 1 && mail.to && mail.to.length === 1 && mail.to[0] === 'amit@caz.example', [r, sent.map(function (m) { return m.to; })]);
  check('the email is a short "Your sign-in link" with one button, a fresh one-off link for their venue, and no email-code sign-in anywhere',
    mail.subject === 'Your VenuePlay sign-in link' && /Open your VenuePlay<\/a>/.test(html) && /^[A-Za-z0-9_-]{43}$/.test(fresh) && fresh !== spent &&
    hrefs(html).every(function (h) { return h.indexOf('signin=email') === -1; }) && /Hi Amit,/.test(html) && /for Caz Reitop/.test(html) && /pop in your mobile/i.test(html) && !/[\u2014\u2013]/.test(html), html.slice(0, 300));
  var row = DB.vp_signin_links[DB.vp_signin_links.length - 1];
  check('only its hash is kept, for this login and the venue the old link was for, 14 days, unused', row.token_hash === await vpaSigninTokenHash(fresh) && row.auth_user_id === AMIT && row.venue_id === V1 &&
    row.used_at === null && Math.abs(Date.parse(row.expires_at) - Date.now() - 14 * 86400000) < 60000 && JSON.stringify(DB).indexOf(fresh) === -1, row);
  var ok = await vpaHandleOneClick(pub('/auth/one-click', { t: fresh }), ENV, J);
  var twice = await vpaHandleOneClick(pub('/auth/one-click', { t: fresh }), ENV, J);
  check('the new link signs in once, like the first', ok.status === 200 && ok.body.ok === true && ok.body.venue_id === V1 && twice.status === 410, [ok, twice]);
  check('an audit row records it, with no token in it', DB.vp_admin_audit.some(function (a) { return a.action === 'signin_link_resent' && a.target === 'auth_user:' + AMIT; }) && JSON.stringify(DB.vp_admin_audit).indexOf(fresh) === -1);

  world();
  var exp = await oldLink(AMIT, V1, undefined, true);
  var unused = await oldLink(AMIT, V1);   // a second link still live (say an earlier resend)
  r = await vpaHandleOneClickResend(pub('/auth/one-click/resend', { t: exp }), ENV, J);
  var fresh2 = tokenOf((sent[0] || {}).html || '');
  check('an expired link: a new one goes too', r.status === 200 && sent.length === 1 && !!fresh2, sent.length);
  check('and every older unused link is retired, so only the newest one works', liveLinks(AMIT).length === 1 && liveLinks(AMIT)[0].token_hash === await vpaSigninTokenHash(fresh2) &&
    (await vpaHandleOneClick(pub('/auth/one-click', { t: unused }), ENV, J)).status === 410, liveLinks(AMIT).length);

  world();
  r = await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'AMIT@caz.example' }), ENV, J);
  check('no token (the welcome when migration 123 was missing), their address only: a link goes to that login', r.status === 200 && sent.length === 1 && sent[0].to[0] === 'amit@caz.example' && !!tokenOf(sent[0].html), sent.length);

  world();
  var SAME = JSON.stringify({ ok: true });
  var answers = [];
  answers.push(await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'nobody@nowhere.example' }), ENV, J));
  answers.push(await vpaHandleOneClickResend(pub('/auth/one-click/resend', { t: 'Zz' + 'A'.repeat(41) }), ENV, J));
  answers.push(await vpaHandleOneClickResend(pub('/auth/one-click/resend', { t: 'not-a-token', e: 'x" onmouseover="y' }), ENV, J));
  answers.push(await vpaHandleOneClickResend(pub('/auth/one-click/resend', {}), ENV, J));
  DB.vp_venue_staff = DB.vp_venue_staff.filter(function (s) { return s.auth_user_id !== PAT; });
  answers.push(await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'pat@other.example' }), ENV, J));   // a login taken off every venue
  var noVenue = await vpaSendSigninLink(ENV, PAT, V2, {}).then(function (x) { return x; }, function (e) { return { threw: String(e && e.message || e) }; });
  check('a login taken off every venue is refused by name (no_venue), before any link is made', noVenue.ok === false && noVenue.reason === 'no_venue' &&
    DB.vp_signin_links.filter(function (x) { return x.auth_user_id === PAT; }).length === 0, noVenue);
  check('an unknown address, an unknown or malformed token, nothing at all, a login with no venue: the SAME { ok:true }, and nothing is sent',
    answers.every(function (a) { return a.status === 200 && JSON.stringify(a.body) === SAME; }) && sent.length === 0, [answers, sent.length]);

  world();
  for (var i = 0; i < 6; i++) await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'amit@caz.example' }), ENV, J);
  check('per login: at most 4 links in a day (the 5th and 6th ask make nothing), and the answer never changes', sent.length === 4 && DB.vp_signin_links.length === 4, [sent.length, DB.vp_signin_links.length]);
  var capped = await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'amit@caz.example' }), ENV, J);
  check('over the limit still answers { ok:true }', capped.status === 200 && JSON.stringify(capped.body) === SAME);

  world();
  var LIM = [];
  for (var k = 0; k < 7; k++) LIM.push((await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'nobody@nowhere.example' }, '198.51.100.9'), ENV, J)).status);
  var otherNet = await vpaHandleOneClickResend(pub('/auth/one-click/resend', { e: 'nobody@nowhere.example' }, '198.51.100.10'), ENV, J);
  check('per network: the 7th ask in an hour from one address is 429, another address is not', LIM.slice(0, 6).every(function (s) { return s === 200; }) && LIM[6] === 429 && otherNet.status === 200, LIM);
  check('nothing was logged, so no token or address can be in a log', LOGS.length === 0, LOGS);

  world();
  sent.length = 0;
  var failSend = globalThis.fetch;
  globalThis.fetch = function (u, o) { if (String(u).indexOf('api.resend.com') !== -1) return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } }); return failSend(u, o); };
  var badSend = await vpaSendSigninLink(ENV, AMIT, V1, {});
  globalThis.fetch = failSend;
  check('an email that did not send leaves no working link behind', badSend.ok === false && badSend.reason === 'email_failed' && liveLinks(AMIT).length === 0, [badSend, liveLinks(AMIT).length]);

  section('3b. HQ\'s "Resend sign-in link" (POST /admin/signin-link)');
  world();
  var staffTry = await vpaAdminSigninLink(as(AMIT, { venue_id: V1 }), ENV, J);
  check('a venue login cannot use it (owner or accounts HQ only), nothing sent', staffTry.status === 403 && sent.length === 0, staffTry);
  var hq = await vpaAdminSigninLink(as(ADMIN, { venue_id: V1 }), ENV, J);
  check('HQ on a prospect: it goes to the prospect\'s own login, and HQ is told where', hq.status === 200 && hq.body.ok === true && hq.body.to === 'amit@caz.example' && hq.body.has_mobile === false &&
    sent.length === 1 && sent[0].to[0] === 'amit@caz.example' && !!tokenOf(sent[0].html), hq);
  check('audited as Dean, naming the venue and the address', DB.vp_admin_audit.some(function (a) { return a.action === 'signin_link_sent' && a.target === 'venue:' + V1 && a.actor_label === 'Dean' && a.detail.to === 'amit@caz.example'; }));
  var hq2 = await vpaAdminSigninLink(as(ADMIN, { venue_id: V2 }), ENV, J);
  check('an ordinary venue: its owner\'s login, and HQ is told they also sign in by mobile', hq2.status === 200 && hq2.body.to === 'pat@other.example' && hq2.body.has_mobile === true, hq2);
  var hq3 = await vpaAdminSigninLink(as(ADMIN, { venue_id: V3 }), ENV, J);
  check('a venue whose logins have no email: plain words, nothing sent', hq3.status === 400 && /has an email on their login/.test(hq3.body.error) && sent.length === 2, hq3);
  for (var n = 0; n < 9; n++) await vpaAdminSigninLink(as(ADMIN, { venue_id: V1 }), ENV, J);
  var hqCap = await vpaAdminSigninLink(as(ADMIN, { venue_id: V1 }), ENV, J);
  check('HQ has its own limit (10 a day per login) and says how many have gone', hqCap.status === 429 && /10 sign-in links have gone to amit@caz\.example/.test(hqCap.body.error), hqCap.body);
  check('a venue that is not there: 404', (await vpaAdminSigninLink(as(ADMIN, { venue_id: U(999) }), ENV, J)).status === 404);

  section('3c. A login names itself (POST /account/my-name)');
  world();
  var nm = await vpbMyName(as(AMIT, { name: '  Amit   <i>Shah</i> ' }), ENV, J);
  check('their own staff rows get their name, tidied (no tags, one space)', nm.status === 200 && nm.body.name === 'Amit iShah/i' &&
    DB.vp_venue_staff.filter(function (s) { return s.auth_user_id === AMIT; }).every(function (s) { return s.display_name === 'Amit iShah/i'; }), [nm, DB.vp_venue_staff]);
  check('nobody else\'s row changes', DB.vp_venue_staff.filter(function (s) { return s.auth_user_id !== AMIT; }).map(function (s) { return s.display_name; }).join() === 'Pat,Hosty');
  check('signed out: 401, nothing changed', (await vpbMyName(as('', { name: 'X' }), ENV, J)).status === 401);
  check('an empty name: asked for it', (await vpbMyName(as(AMIT, { name: '   ' }), ENV, J)).status === 400);
  check('a login with no venue (an HQ admin): 403, nothing changed', (await vpbMyName(as(ADMIN, { name: 'Dean' }), ENV, J)).status === 403 && !DB.vp_venue_staff.some(function (s) { return s.display_name === 'Dean'; }));
  var long = await vpbMyName(as(AMIT, { name: 'A'.repeat(200) }), ENV, J);
  check('kept to 60 characters', long.status === 200 && long.body.name.length === 60);

  section('3d. The prospect welcome: signed by whoever the venue wrote to, sent from and replied to at hello@');
  ENV.PROSPECT_AUTOPILOT_KEY = 'k'.repeat(40);
  function auto(body) { var txt = JSON.stringify(body), h = { 'X-Autopilot-Key': ENV.PROSPECT_AUTOPILOT_KEY };
    return { url: 'https://api/autopilot/prospect', method: 'POST', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); } }; }
  function visibleText(h) { return String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
  function signoffOf(h) { var m = /Cheers,[\s\S]*?<\/p>/.exec(String(h || '')); return m ? visibleText(m[0]).trim() : ''; }
  var BASE = { name: 'The Harbour Tavern', first_name: 'Sam', email: 'sam@harbour.example', postcode: '4217', entity_type: 'for_profit' };
  function prospectWorld() { world(); DB.vp_venues = []; DB.vp_venue_staff = []; DB.vp_prospects = []; DB.venueplay_founding = []; DB.vp_prospect_welcomes = []; DB.auth = []; }
  prospectWorld();
  var pr = await vpaAutopilotProspect(auto(Object.assign({ sender_name: 'Harry', sender_email: 'Harry@VenuePlay.online' }, BASE)), ENV, J);
  var wm = sent[0] || {}, wtxt = visibleText(wm.html);
  check('the autopilot with sender_name and sender_email: set up, ONE welcome', pr.status === 200 && pr.body.ok === true && sent.length === 1, pr.body);
  check('it is FROM VenuePlay hello@ and replies go to hello@venueplay.com.au, never Harry\'s cold mailbox', wm.from === 'VenuePlay <hello@send.venueplay.com.au>' && wm.reply_to === 'hello@venueplay.com.au' &&
    JSON.stringify(wm).indexOf('harry@venueplay.online') === -1, [wm.from, wm.reply_to]);
  check('signed "Cheers, Harry", then VenuePlay, then venueplay.com.au', signoffOf(wm.html) === 'Cheers, Harry VenuePlay venueplay.com.au', signoffOf(wm.html));
  check('no Dean, no Gflam Group line and no phone in the sign-off, and no em dash anywhere', !/Dean|Gflam|\d{4} ?\d{3}/.test(signoffOf(wm.html)) && !/[\u2014\u2013]/.test(wtxt), signoffOf(wm.html));
  check('the only phone number anywhere in it is 07 5228 3667', (wtxt.match(/\b0\d[\d ]{7,11}\d\b/g) || []).every(function (n) { return n.replace(/ /g, '') === '0752283667'; }), wtxt.match(/\b0\d[\d ]{7,11}\d\b/g));
  var aud = DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_set_up'; })[0] || {};
  var wrow = DB.vp_prospect_welcomes[0] || {};
  check('HQ keeps who it was from (the audit row), and the booked welcome remembers it so Send now signs it the same',
    aud.detail && aud.detail.sender_name === 'Harry' && aud.detail.sender_email === 'harry@venueplay.online' && wrow.detail && wrow.detail.senderName === 'Harry', [aud.detail, wrow.detail]);
  prospectWorld();
  await vpaAutopilotProspect(auto(BASE), ENV, J);
  check('no sender given: the team sign-off ("Cheers, The VenuePlay team", venueplay.com.au), still from and to hello@', signoffOf((sent[0] || {}).html) === 'Cheers, The VenuePlay team venueplay.com.au' &&
    (sent[0] || {}).reply_to === 'hello@venueplay.com.au', signoffOf((sent[0] || {}).html));
  var BAD = [
    [{ sender_name: 'Harry' }, 'a name with no address'],
    [{ sender_email: 'harry@venueplay.online' }, 'an address with no name'],
    [{ sender_name: 'Harry the Great Prospect Wrangler of the Coast', sender_email: 'harry@venueplay.online' }, 'a name over 40 characters'],
    [{ sender_name: 'Harry <b>', sender_email: 'harry@venueplay.online' }, 'a name with markup'],
    [{ sender_name: 'Harry 0400 000 000', sender_email: 'harry@venueplay.online' }, 'a name carrying a phone number'],
    [{ sender_name: 'Harry', sender_email: 'harry@gmail.com' }, 'an address not on our domains'],
    [{ sender_name: 'Harry', sender_email: 'harry@venueplay.online.evil.example' }, 'a lookalike domain'],
    [{ sender_name: 'Harry', sender_email: 'harry@sub.venueplay.com.au' }, 'a subdomain we do not send from'],
  ];
  var badOut = [];
  for (var bi = 0; bi < BAD.length; bi++) {
    prospectWorld();
    var br = await vpaAutopilotProspect(auto(Object.assign({}, BAD[bi][0], BASE)), ENV, J);
    badOut.push([BAD[bi][1], br.status, DB.vp_venues.length, sent.length]);
  }
  check('a bad sender refuses the setup with nothing made and nothing sent (one only, too long, markup, a phone, not our domain, a lookalike, a subdomain)',
    badOut.every(function (x) { return x[1] === 400 && x[2] === 0 && x[3] === 0; }), badOut);
  check('our domains, exactly: venueplay.com.au and the cold mailboxes', !vpaProspectSender('Dean', 'dean@venueplay.com.au').error && !vpaProspectSender('Rhys', 'rhys@getvenueplay.com.au').error &&
    !vpaProspectSender("Kayla O'Neil", 'kayla@venueplay.online').error && !!vpaProspectSender('X', 'x@partyplay.com.au').error);
  var OLD_TPL = TPL['welcome-prospect.html'];
  TPL['welcome-prospect.html'] = OLD_TPL.replace('>{{signoff}}</p>', '>Cheers,<br>Dean<br>VenuePlay</p>');
  var oldHtml = await vpaRenderProspectWelcome(ENV, { email: 'a@b.example', venueName: 'X', senderName: 'Harry', senderEmail: 'harry@venueplay.online', slides: 0, seats: 10 });
  TPL['welcome-prospect.html'] = OLD_TPL;
  check('a new Worker with the page still on the old template (Worker first, Pages minutes later): the old fixed sign-off is replaced too', signoffOf(oldHtml) === 'Cheers, Harry VenuePlay venueplay.com.au', signoffOf(oldHtml));
  world();
  await vpaSendSigninLink(ENV, AMIT, V1, {});
  check('the sign-in link email also replies to hello@ and is signed by the team, not Dean', (sent[0] || {}).reply_to === 'hello@venueplay.com.au' && /Cheers, The VenuePlay team venueplay\.com\.au/.test(visibleText((sent[0] || {}).html)) &&
    !/Dean/.test(visibleText((sent[0] || {}).html)), (sent[0] || {}).reply_to);

  section('3e. Nothing anywhere opens the email-code sign-in first');
  check('no page, script, email or Worker carries ?signin=email any more', ['venueplay/app/index.html', 'venueplay/app/go.html', 'venueplay/app/vp-oneclick.js', 'venueplay/emails/welcome-prospect.html',
    'venueplay-backend/worker/venueplay-api-FULL.js'].every(function (f) { return readFile(f).indexOf('signin=email') === -1; }));
  check('the welcome\'s fallback button (no token) is the go page with their address, never the email sign-in', vpaOneClickUrl('https://x', null, 'a@b.example') === 'https://x/app/go#e=a%40b.example' &&
    vpaOneClickUrl('https://x', null, '') === 'https://x/app/go');

  if (bad) throw new Error('phone sign-in: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
