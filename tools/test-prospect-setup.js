/* HQ > SET UP A PROSPECT, END TO END, RUN AND NOT WORD-SEARCHED (Dean, 28 Oct 2026).

   "I want it so easy that they will never want to speak to me... when we set up the account that is
   all that we need to do." One HQ action builds the venue and sends ONE email.

     1. the REAL billing Worker (tools/rig-billing-worker.js): POST /admin/prospect creates the account
        record at the founding price with no card, the venue (state from the postcode, plan cap from the
        usual crowd), an EMAIL login (and the mobile on the same login), the slides on their screen,
        compliance PENDING (terms_required, no tick), and the audit row; it refuses without an email or
        a postcode and for anyone but an owner or accounts HQ admin, and creates nothing when it refuses
     2. the price: the email's card link, followed through the Worker's own /add-card, opens a Stripe
        Checkout on STRIPE_PRICE_MONTHLY for the usual crowd, with the free month starting then
     3. the email, filled for a VIC pub and a QLD club: every link, the exact TV address, the sign-in
        email, no em dash, musical bingo never called bingo or gaming, the right number bingo line
     4. the number bingo line agrees with vp-gaming.js (VPGaming) for every state, club and pub
     5. the console (vp-session.js in a small fake page): a prospect venue is HELD on the Terms card,
        an ordinary venue is not, and accepting it lets the page start again
     6. every console boot stops on VP.termsGate, right after the hold check

   Run from the repo root:  jsc tools/test-prospect-setup.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- the console half first: a small DOM, the real vp-session.js ---------------- */
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = ''; this.className = ''; this.children = [];
  this.parentNode = null; this.style = {}; this.attrs = {}; this.textContent = ''; this.handlers = {};
  this.value = ''; this.checked = false; this.disabled = false;
}
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
El.prototype.appendChild = function (k) { if (k.parentNode) k.parentNode.removeChild(k); this.children.push(k); k.parentNode = this; return k; };
El.prototype.insertBefore = function (k, ref) {
  if (k.parentNode) k.parentNode.removeChild(k);
  var i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k);
  k.parentNode = this; return k;
};
El.prototype.removeChild = function (k) { var i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parentNode = null; return k; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') this.style.cssText = String(v); };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.click = function () { if (this.disabled) return; (this.handlers.click || []).forEach(function (f) { f({ preventDefault: function () {} }); }); };
function walk(el, fn) { if (fn(el)) return el; for (var i = 0; i < el.children.length; i++) { var r = walk(el.children[i], fn); if (r) return r; } return null; }
function allText(el) { var t = el.textContent || ''; el.children.forEach(function (c) { t += ' ' + allText(c); }); return t.replace(/\s+/g, ' ').trim(); }

var SESSION = readFile('venueplay/app/vp-session.js');
var CALLS = [], RELOADS = 0;
function page() {
  var body = new El('body');
  var wrap = new El('div'); wrap.className = 'wrap'; body.appendChild(wrap);
  var view = new El('div'); view.id = 'vMenu'; view.style.display = 'block'; wrap.appendChild(view);
  var other = new El('div'); other.id = 'vSetup'; wrap.appendChild(other);
  var document = {
    body: body,
    createElement: function (t) { return new El(t); },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); },
    querySelector: function (sel) { var c = sel.replace(/^\./, ''); return walk(body, function (e) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }); },
    querySelectorAll: function () { return []; }, addEventListener: function () {}
  };
  var client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1', user: { id: 'u1' } } } }); } },
                 from: function () { var b = { select: function () { return b; }, eq: function () { return b; }, maybeSingle: function () { return Promise.resolve({ data: null }); }, then: function (r) { return Promise.resolve({ data: [] }).then(r); } }; return b; } };
  var store = {};
  var window = { location: { pathname: '/app/', search: '', reload: function () { RELOADS++; } }, supabase: { createClient: function () { return client; } },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = v; }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: function () { return 0; }, clearTimeout: function () {} };
  var fetch = function (url, opts) {
    CALLS.push({ url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, compliance_accepted_at: '2026-10-28T02:00:00.000Z', compliance_accepted_by: 'Amit' }); } });
  };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', SESSION))
    (window, document, window.localStorage, window.sessionStorage, window.location, fetch);
  return { VP: window.VP, document: document, body: body, wrap: wrap, view: view, other: other };
}
function pv(over) { var v = { id: 'V1', name: "Caz Reitop's Dirty Secrets", slug: 'caz', status: 'active', terms_required: true, compliance_accepted_at: null, compliance_accepted_by: null }; for (var k in (over || {})) v[k] = over[k]; return v; }
function ctxFor(role, v, nm) { return { role: role, venue: v || pv(), currentVenueId: 'V1', staff: role === 'admin' ? [] : [{ venue_id: 'V1', role: role, display_name: nm || null }] }; }
function card(P) { return P.document.getElementById('vpTermsCard'); }
function hidden(P) { return P.view.style.display === 'none' && P.other.style.display === 'none'; }

section('5. The console: a prospect venue is held on the Terms card until the owner or a manager ticks it');
var P = page();
check('vp-session.js exports VP.termsGate', typeof P.VP.termsGate === 'function');
var held = P.VP.termsGate(ctxFor('manager', null, 'Amit'));
var t = card(P) ? allText(card(P)) : '';
check('a manager at a prospect venue with no tick: held (true), the card is shown', held === true && !!card(P), held);
check('everything else on the page is hidden: no game picker, no setup', hidden(P), [P.view.style.display, P.other.style.display]);
check('the card sits first in the page content', P.wrap.children[0] === card(P));
check('it says one tick and the games are ready, and that the TV keeps showing the ads',
  /Before your first game/.test(t) && /One tick and your games are ready, Caz Reitop's Dirty Secrets/.test(t) && /Your TV keeps showing your ads/.test(t), t);
check('it never says the games run as normal (they do not, until the tick)', !/run as normal/i.test(t), t);
check('the tick, the name (their own, pre-filled) and Accept are there, unticked',
  !!P.document.getElementById('vpTermsTick') && P.document.getElementById('vpTermsTick').checked === false &&
  P.document.getElementById('vpTermsBy').value === 'Amit' && !!P.document.getElementById('vpTermsGo'));
P.VP.termsGate(ctxFor('manager', null, 'Amit'));
var n = 0; walk(P.body, function (e) { if (e.id === 'vpTermsCard') n++; return false; });
check('called twice, still exactly one card', n === 1, n);

var H = page(); var hh = H.VP.termsGate(ctxFor('host'));
var ht = card(H) ? allText(card(H)) : '';
check('a host is held too, told games start once the owner or a manager ticks, with no tick of their own',
  hh === true && hidden(H) && /Games start here once the owner or a manager ticks one box/.test(ht) && !H.document.getElementById('vpTermsTick'), ht);
var A = page(); var ah = A.VP.termsGate(ctxFor('admin'));
var at = card(A) ? allText(card(A)) : '';
check('HQ View as is held and told only the venue can tick it', ah === true && /has not ticked section 6 yet, so its games cannot start/.test(at) && /HQ View as cannot do it for them/.test(at) && !A.document.getElementById('vpTermsTick'), at);

var O = page();
check('an ordinary venue with no tick is NOT held (the plain card asks and blocks nothing)', O.VP.termsGate(ctxFor('owner', pv({ terms_required: false }))) === false && !hidden(O) && !card(O));
check('a prospect venue that has ticked is not held', O.VP.termsGate(ctxFor('owner', pv({ compliance_accepted_at: '2026-10-28T01:00:00Z' }))) === false && !hidden(O));
var noCol = pv(); delete noCol.terms_required;
check('a venue row without the column (database before migration 122) is not held', O.VP.termsGate(ctxFor('owner', noCol)) === false && !hidden(O));
check('a switched-off prospect venue is left to its hold card', O.VP.termsGate(ctxFor('owner', pv({ status: 'suspended', suspended_reason: 'nonpayment' }))) === false && !card(O));
var R = page(); R.VP.termsGate(ctxFor('owner'));
R.VP.termsGate(ctxFor('owner', pv({ id: 'V2', terms_required: false })));
check('switching from a held venue to an ordinary one puts the page back', !hidden(R) && R.view.style.display === 'block', [R.view.style.display, R.other.style.display]);

var B = page(); var bc = B.VP.termsCard(ctxFor('owner'));
check('Your account (termsCard, never termsGate) shows the same one-tick card and hides nothing, so the card link stays reachable',
  bc === true && /One tick and your games are ready/.test(allText(card(B))) && !hidden(B));

CALLS.length = 0; RELOADS = 0;
var Q = page(), qctx = ctxFor('owner', null, 'Amit');
Q.VP.termsGate(qctx);
Q.document.getElementById('vpTermsTick').checked = true;
Q.document.getElementById('vpTermsGo').click(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
var call = CALLS[0] || { opts: { headers: {} } };
check('Accept records it through the billing Worker, as the plain card does', CALLS.length === 1 && /\/account\/compliance-accept$/.test(call.url) && call.body.venue_id === 'V1' && call.body.accepted === true && call.body.by === 'Amit', call);
var go2 = Q.document.getElementById('vpTermsDone');
check('then the way on is "Start a game"', !!go2 && go2.textContent === 'Start a game', go2 && go2.textContent);
go2.click();
check('which reloads the console, so it boots straight into the games', RELOADS === 1 && !!card(Q), RELOADS);
check('and the page now knows the venue has ticked: termsGate lets it through', Q.VP.termsGate(qctx) === false && !hidden(Q));

section('6. Every console stops its boot on termsGate, right after the hold check');
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var INDEX = readFile('venueplay/app/index.html');
function runProceed(gate) {
  var log = [];
  var fakeVP = { holdGate: function () { log.push('holdGate'); return false; }, termsGate: function () { log.push('termsGate'); return gate; }, termsCard: function () { log.push('termsCard'); return true; } };
  var fn = (new Function('__ctx', 'window', 'VP', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'go', 'pairToVenue', '$',
    'return (' + lift(INDEX, 'proceedVenue') + ');'))({ venue: { id: 'V1', slug: 'caz' }, staff: [{ venue_id: 'V1' }] }, { VP: fakeVP }, fakeVP,
    function () {}, function () {}, function () { return true; }, function () {}, function (v) { log.push('go:' + v); }, function () { log.push('pair'); return true; }, function () { return { value: '', textContent: '', focus: function () {} }; });
  fn(); return log.join(',');
}
check('index.html: a held venue stops after termsGate, with no TV pairing and no game picker', runProceed(true) === 'holdGate,termsGate,go:vBoot', runProceed(true));
check('index.html: any other venue goes on to the plain card and the TV, as before', runProceed(false) === 'holdGate,termsGate,termsCard,pair', runProceed(false));
['trivia/host.html', 'musical/host.html', 'raffle/host.html', 'members/host.html', 'purchase-raffle/index.html'].forEach(function (f) {
  var src = readFile('venueplay/app/' + f).split('\n');
  var hi = -1; for (var i = 0; i < src.length; i++) if (/VP\.holdGate && VP\.holdGate\(ctx\)/.test(src[i])) { hi = i; break; }
  var nextLine = hi >= 0 ? src[hi + 1] : '';
  var out = [];
  function runIt(gate) {
    out = [];
    var VPf = { holdGate: function () { out.push('holdGate'); return false; }, termsGate: function () { out.push('termsGate'); return gate; }, enforceShift: function () { out.push('enforceShift'); } };
    (new Function('VP', 'ctx', '$', 'show', src[hi] + '\n' + nextLine + '\nout.push("booted");'.replace('out', 'arguments[4]')))(VPf, {}, function () { return {}; }, function () {}, out);
    return out.join(',');
  }
  var heldRun = hi >= 0 ? runIt(true) : 'no hold line', freeRun = hi >= 0 ? runIt(false) : '';
  check(f + ': held, the boot stops (nothing after the gate runs)', /termsGate/.test(nextLine) && !/booted/.test(heldRun) && /holdGate,termsGate/.test(heldRun), heldRun);
  check(f + ': not held, the boot carries on', /holdGate,termsGate,booted$/.test(freeRun), freeRun);
});

/* =============================================================================================== */
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
/* jsc has no WebCrypto, TextEncoder, atob or URL. Stand-ins that are pure functions of their input are
   enough for what is claimed here (the link the email carries is the one /add-card accepts); the
   Workers runtime supplies the real ones. */
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } } };
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (typeof atob === 'undefined') { atob = function (s) { s = s.replace(/=+$/, ''); var o = '', bits = 0, acc = 0; for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) throw new Error('bad base64'); acc = ((acc << 6) | v) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); } } return o; }; }
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 3) { var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0; var nn = (a << 16) | (b << 8) | c;
  s += B64[(nn >> 18) & 63] + B64[(nn >> 12) & 63] + (i + 1 < bytes.length ? B64[(nn >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[nn & 63] : '='); } return s; }
if (typeof URL === 'undefined') { URL = function (u) { var q = u.indexOf('?'), sp = {}; if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; }; }
if (typeof Response === 'undefined') { Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }; Response.redirect = function (u, s) { return { redirect: u, status: s }; }; }
var PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 7, 128, 0, 0, 4, 56, 8, 2, 0, 0, 0, 1, 2, 3];
var JPG = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 9, 8, 7, 6];
var GIF = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
function slide(kind, salt) { var b = (kind === 'png' ? PNG : kind === 'jpg' ? JPG : GIF).slice(); b.push(salt || 0); return 'data:image/' + (kind === 'jpg' ? 'jpeg' : kind) + ';base64,' + b64(b); }

var AUTH = [], AUTH_POSTS = [], AUTH_PUTS = [], STORE = [], SCREEN_ACTORS = [], MIG122 = true;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') {
      var b = JSON.parse(opts.body); AUTH_POSTS.push(b);
      var ph = b.phone ? b.phone.replace('+', '') : '';
      if (AUTH.some(function (x) { return (b.email && x.email === b.email) || (ph && x.phone === ph); })) return RS(422, { msg: 'A user with this email address or phone has already been registered', error_code: 'email_exists' });
      var nu = { id: newId(), email: b.email || '', phone: ph, email_confirmed_at: b.email_confirm ? '2026-10-28' : null, phone_confirmed_at: b.phone_confirm ? '2026-10-28' : null };
      AUTH.push(nu); return RS(200, nu);
    }
    if (one && method === 'PUT') { var pb = JSON.parse(opts.body); AUTH_PUTS.push({ id: one[1], body: pb }); var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; if (!hit) return RS(404, {}); hit.email = pb.email; return RS(200, hit); }
    return RS(200, { users: AUTH });
  }
  if (u.indexOf('/storage/v1/') !== -1) {
    if (method === 'POST' && u.indexOf('/object/') !== -1) STORE.push({ url: u, type: opts.headers['Content-Type'], size: opts.body.length });
    return RS(200, {});
  }
  if (/\/rest\/v1\/vp_venues\?select=terms_required/.test(u) && !MIG122) return RS(400, '{"code":"42703","message":"column vp_venues.terms_required does not exist"}');
  if (/\/rest\/v1\/vp_venue_screen$/.test(u) && method === 'POST') SCREEN_ACTORS.push(JSON.parse(opts.headers['X-VP-Actor'] || '{}'));
  return rigFetch(url, opts);
};
function U(nn) { return '52000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), ACCOUNTS = U(8), GFLAMSTAFF = U(7), VENUEOWNER = U(1);
function as(user, body) {
  var h = { Authorization: user ? 'Bearer ' + user : '' }; var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
var CODES_NOV = 'NSW-NOV-2099,QLD-OCT-2099';   // fixed far-future codes: never derived from today's clock
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; AUTH_POSTS = []; AUTH_PUTS = []; STORE = []; SCREEN_ACTORS = []; MIG122 = true;
  ENV.FOUNDING_CODES = CODES_NOV;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: GFLAMSTAFF, label: 'Staffer', role: 'staff' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = [{ id: 's1', auth_user_id: VENUEOWNER, venue_id: 'other', role: 'owner' }];
  DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = [];
}
var CAZ = { name: "Caz Reitop's Dirty Secrets", first_name: 'Amit', email: 'CazReitop@gmail.com ', mobile: '0452 510 904', postcode: '3066',
            entity_type: 'for_profit', players: 60, website: 'cazreitop.com.au', slides: [slide('png', 1), slide('jpg', 2)] };
function with_(o) { var b = {}; for (var k in CAZ) b[k] = CAZ[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
function nothingMade() { return DB.vp_venues.length === 0 && DB.venueplay_founding.length === 0 && AUTH_POSTS.length === 0 && STORE.length === 0 && sent.length === 0 && DB.vp_admin_audit.length === 0; }
function visible(html) { return String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '.').replace(/&#9835;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1'); }
function hrefs(html) { var out = [], re = /href="([^"]+)"/g, m; while ((m = re.exec(html))) out.push(m[1]); return out; }

(async function () {
  section('1. POST /admin/prospect: who may, and what it refuses (creating nothing)');
  world();
  var r = await vpaHandleProspect(as('', CAZ), ENV, J);
  check('signed out: 401, nothing made', r.status === 401 && nothingMade(), r);
  r = await vpaHandleProspect(as(VENUEOWNER, CAZ), ENV, J);
  check('a venue owner (not a Gflam admin): 403, nothing made', r.status === 403 && nothingMade(), r);
  r = await vpaHandleProspect(as(GFLAMSTAFF, CAZ), ENV, J);
  check('a Gflam admin with the staff role: 403 (owner or accounts only, as + Add venue)', r.status === 403 && nothingMade(), r);
  var refusals = [
    ['no email', { email: '' }, /contact's email/], ['an email with no @', { email: 'cazreitop.gmail.com' }, /contact's email/],
    ['no postcode', { postcode: '' }, /4-digit postcode/], ['a 3-digit postcode', { postcode: '306' }, /4-digit postcode/],
    ['no venue name', { name: '  ' }, /venue name/], ['neither club nor pub', { entity_type: 'hotel' }, /club or pub/],
    ['a landline for the mobile', { mobile: '07 5228 3667' }, /not an Australian mobile/], ['a crowd of 0', { players: 0 }, /usual crowd/],
    ['a website that is not one', { website: 'not a site' }, /web address/],
    ['21 slides', { slides: Array.apply(null, Array(21)).map(function (_, i) { return slide('png', i); }) }, /up to 20/],
    ['a GIF slide (PNG or JPEG only)', { slides: [slide('png', 1), slide('gif', 2)] }, /Slide 2 is not a PNG or JPEG/],
    ['a slide labelled PNG that is not one', { slides: ['data:image/png;base64,' + b64([1, 2, 3, 4, 5, 6, 7, 8, 9])] }, /Slide 1 is not a PNG or JPEG/]];
  for (var i = 0; i < refusals.length; i++) {
    world(); r = await vpaHandleProspect(as(ADMIN, with_(refusals[i][1])), ENV, J);
    check('refused for ' + refusals[i][0] + ', saying so, and NOTHING was created', r.status === 400 && refusals[i][2].test(r.body.error) && /Nothing was created/.test(r.body.error) && nothingMade(), r.body);
  }
  world(); MIG122 = false;
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  check('migration 122 not run: refused "Run migration 122 first", nothing made (no venue without its hold)', r.status === 503 && /migration 122/.test(r.body.error) && nothingMade(), r.body);

  section('1b. What one "Set up and send" creates');
  world();
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var f = DB.venueplay_founding[0] || {}, v = DB.vp_venues[0] || {}, st = DB.vp_venue_staff.filter(function (x) { return x.venue_id === v.id; })[0] || {};
  check('ok, with the venue, the account record and the TV address', r.status === 200 && r.body.ok === true && r.body.venue.id === v.id && r.body.founding_id === f.id &&
    r.body.tv_url === 'https://www.venueplay.com.au/tv?' + v.slug, r.body);
  check('ONE account record: paying ("active", as + Add venue), monthly, no card, the usual crowd as its seats, the email lower-cased',
    DB.venueplay_founding.length === 1 && f.status === 'active' && f.plan === 'monthly' && !f.stripe_subscription_id && f.max_seats === 60 &&
    f.contact_email === 'cazreitop@gmail.com' && f.venue_name === CAZ.name && f.postcode === '3066' && f.marketing_opt_in === false, f);
  check('ONE venue, on that record, its state and clock from the postcode (VIC, Melbourne), a pub, plan cap 60',
    DB.vp_venues.length === 1 && v.founding_id === f.id && v.au_state === 'VIC' && v.timezone === 'Australia/Melbourne' && v.postcode === '3066' &&
    v.entity_type === 'for_profit' && v.venue_kind === 'pub' && v.max_players === 60 && v.paid_entry_enabled === false, v);
  check('the slug is made from the name, as every venue\'s is', v.slug === 'caz-reitop-s-dirty-secrets', v.slug);
  check('compliance PENDING: terms_required, and no tick recorded in their name', v.terms_required === true && v.compliance_accepted_at === null && v.compliance_accepted_by === null, v);
  check('its settings row and its screen row', DB.vp_venue_settings.length === 1 && DB.vp_screens.length === 1 && DB.vp_screens[0].venue_id === v.id);
  var a0 = AUTH_POSTS[0] || {};
  check('ONE login carrying the EMAIL (confirmed, so the email code finds it) AND the mobile', AUTH_POSTS.length === 1 && a0.email === 'cazreitop@gmail.com' && a0.email_confirm === true &&
    a0.phone === '+61452510904' && a0.phone_confirm === true, a0);
  check('linked to the venue as its manager, under their first name', st.role === 'manager' && st.auth_user_id === AUTH[0].id && st.display_name === 'Amit', st);
  check('the response says which login was made', r.body.login && r.body.login.email === 'cazreitop@gmail.com' && r.body.login.mobile === '0452 510 904', r.body.login);
  var scr = DB.vp_venue_screen[0] || {};
  check('both slides uploaded to the ad bucket, in THIS venue\'s folder, as PNG and JPEG', STORE.length === 2 && STORE.every(function (s) { return s.url.indexOf('/storage/v1/object/venue-ads/' + v.id + '/') !== -1; }) &&
    STORE[0].type === 'image/png' && STORE[1].type === 'image/jpeg' && /\.png$/.test(STORE[0].url) && /\.jpg$/.test(STORE[1].url), STORE);
  check('and on their screen: two slides, our storage addresses, in order', scr.venue_id === v.id && scr.slug === v.slug && (scr.slides || []).length === 2 &&
    scr.slides[0].image_url === 'https://db/storage/v1/object/public/venue-ads/' + STORE[0].url.split('/venue-ads/')[1] && scr.slides.every(function (s) { return s.seconds === 8; }), scr);
  check('the screen write names HQ prospect setup as who wrote it (the screen history trigger reads this)', SCREEN_ACTORS.length === 1 && SCREEN_ACTORS[0].via === 'hq_prospect' && SCREEN_ACTORS[0].admin === ADMIN, SCREEN_ACTORS);
  var au = DB.vp_admin_audit.filter(function (x) { return x.action === 'prospect_set_up'; });
  var ad = (au[0] || {}).detail || {};
  check('ONE audit row: who set it up, the venue, compliance pending, the slides, the website and that the email went',
    au.length === 1 && au[0].actor_admin === ADMIN && au[0].actor_label === 'Dean' && au[0].target === 'venue:' + v.id && ad.compliance === 'pending' && ad.terms_required === true &&
    ad.slides === 2 && ad.website === 'https://cazreitop.com.au' && ad.welcome_sent === true && ad.email === 'cazreitop@gmail.com' && ad.players === 60, au);
  check('ONE email, to the contact, from the transactional sender, replies to support', sent.length === 1 && sent[0].to[0] === 'cazreitop@gmail.com' &&
    sent[0].from === 'VenuePlay <hello@send.venueplay.com.au>' && sent[0].reply_to === 'support@venueplay.com.au' && /^You're set up: your VenuePlay account for Caz Reitop's Dirty Secrets$/.test(sent[0].subject), sent[0] && sent[0].subject);
  check('nothing warned', r.body.welcome_sent === true && !r.body.warnings, r.body.warnings);
  var VIC_HTML = sent[0] ? sent[0].html : '';

  var again = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  check('a second click (same name, same postcode) is refused, pointing at Resend welcome, and makes nothing more',
    again.status === 409 && /already set up/.test(again.body.error) && DB.vp_venues.length === 1 && DB.venueplay_founding.length === 1 && sent.length === 1 && AUTH_POSTS.length === 1, again.body);

  section('2. The price: the card link in the email opens Checkout on the founding monthly price, for their crowd');
  var cardHref = hrefs(VIC_HTML).filter(function (h) { return h.indexOf('/add-card?') !== -1; })[0] || '';
  check('the email carries the card link for THIS account record', cardHref.indexOf('https://www.venueplay.com.au/add-card?f=' + encodeURIComponent(f.id) + '&t=') === 0, cardHref);
  var redir = await vpaAddCardRedirect({ url: cardHref }, ENV);
  var sc = stripeCalls[0] ? stripeCalls[0].body : '';
  check('/add-card accepts that link and goes to Stripe', redir && redir.status === 302 && stripeCalls.length === 1, redir);
  check('on STRIPE_PRICE_MONTHLY (the founding $2.50 price), quantity 60, with a trial (the free month starts now)',
    /line_items%5B0%5D%5Bprice%5D=price_F_M/.test(sc) && /line_items%5B0%5D%5Bquantity%5D=60/.test(sc) && /subscription_data%5Btrial_end%5D=\d+/.test(sc) && /client_reference_id=/.test(sc), sc.slice(0, 300));

  section('1c. An existing login is never changed and never linked from HQ (security review, 28 Oct 2026)');
  function snap() { return JSON.stringify(AUTH); }
  world();
  AUTH.push({ id: U(50), email: 'cazreitop@gmail.com', phone: '' });
  DB.vp_venue_staff.push({ id: 's50', auth_user_id: U(50), venue_id: 'their-other-venue', role: 'manager' });
  var before = snap();
  r = await vpaHandleProspect(as(ACCOUNTS, with_({ slides: [] })), ENV, J);
  check('an email that already signs in: refused with a reason HQ can act on, and NOTHING created',
    r.status === 409 && /already has a VenuePlay login/.test(r.body.error) && /Nothing was created/.test(r.body.error) &&
    DB.vp_venues.length === 0 && DB.venueplay_founding.length === 0 && sent.length === 0 && AUTH_POSTS.length === 0, r.body);
  check('that login is untouched and gets no new venue', snap() === before && AUTH_PUTS.length === 0 &&
    DB.vp_venue_staff.filter(function (x) { return x.auth_user_id === U(50); }).length === 1, DB.vp_venue_staff);
  world();
  AUTH.push({ id: U(51), email: '', phone: '61452510904' });
  before = snap();
  r = await vpaHandleProspect(as(ACCOUNTS, with_({ slides: [] })), ENV, J);
  var st3 = DB.vp_venue_staff.filter(function (x) { return x.venue_id === (DB.vp_venues[0] || {}).id; })[0] || {};
  var made = AUTH_POSTS[0] || {};
  check('an accounts admin may set one up', r.status === 200, r.body);
  check('a mobile that already signs in (no email on it): that login is NOT given the email, NOT confirmed, NOT linked',
    AUTH_PUTS.length === 0 && JSON.stringify(AUTH.filter(function (x) { return x.id === U(51); })) === JSON.stringify(JSON.parse(before)) && st3.auth_user_id !== U(51), [AUTH_PUTS, st3]);
  check('instead a separate email-only login is made for the prospect, without the mobile',
    AUTH_POSTS.length === 1 && made.email === 'cazreitop@gmail.com' && made.email_confirm === true && !made.phone && !made.phone_confirm && st3.auth_user_id === AUTH[1].id, made);
  check('and HQ is told, in words it can act on', (r.body.warnings || []).indexOf('This mobile already has a VenuePlay login; the prospect was set up with an email login only. Add their mobile after they confirm it is theirs.') !== -1 &&
    r.body.login && r.body.login.email === 'cazreitop@gmail.com' && !r.body.login.mobile, r.body);
  check('and the email says nothing about signing in by mobile', sent.length === 1 && !/by text/.test(visible(sent[0].html)), sent[0] && visible(sent[0].html).slice(0, 100));
  world();
  r = await vpaHandleProspect(as(ADMIN, with_({ send_welcome: false, slides: [] })), ENV, J);
  check('send_welcome:false builds everything and sends nothing', r.status === 200 && DB.vp_venues.length === 1 && sent.length === 0 && r.body.welcome_sent === false, r.body);

  section('3. The email, filled for a VIC pub (Caz Reitop\'s, Collingwood) and a QLD club');
  world();
  r = await vpaHandleProspect(as(ADMIN, { name: 'Tugun Test Bowls Club', email: 'sec@tuguntest.example', postcode: '4224', entity_type: 'non_profit', players: 120 }), ENV, J);
  var QLD_HTML = sent[0] ? sent[0].html : '';
  var qv = DB.vp_venues[0] || {};
  check('the QLD club: no mobile, no first name, a crowd of 120, no slides, paid entry off (QLD is blocked until OLGR approves the number generator)', r.status === 200 && qv.au_state === 'QLD' && qv.max_players === 120 && qv.paid_entry_enabled === false && r.body.slides === 0, qv);
  [['VIC', VIC_HTML, 'caz-reitop-s-dirty-secrets', 'cazreitop@gmail.com'], ['QLD', QLD_HTML, 'tugun-test-bowls-club', 'sec@tuguntest.example']].forEach(function (c) {
    var html = c[1], txt = visible(html), L = hrefs(html);
    check(c[0] + ': the template\'s own notes (merge-field list) never reach the inbox', html.indexOf('Merge fields') === -1 && html.indexOf('vpaTplSections') === -1);
    check(c[0] + ': it is a whole document with nothing left unfilled', /^<!doctype html>/i.test(html) && html.indexOf('{{') === -1 && html.indexOf('<!--IF:') === -1 && html.indexOf('ENDIF') === -1, (html.match(/\{\{[a-z_]+\}\}/g) || []).join(' '));
    check(c[0] + ': the TV address is exactly theirs, as a link and as words', L.indexOf('https://www.venueplay.com.au/tv?' + c[2]) !== -1 && txt.indexOf('www.venueplay.com.au/tv?' + c[2]) !== -1, L);
    check(c[0] + ': sign in at the app address, with THEIR email, a code by email, no password', L.indexOf('https://www.venueplay.com.au/app') !== -1 && txt.indexOf('type ' + c[3] + '. A code arrives by email. No password') !== -1, txt.slice(0, 600));
    check(c[0] + ': the one tick, once, before the games', /tick one box confirming your venue runs its own games under the gaming laws that apply to you\. It is one tap, once/.test(txt));
    check(c[0] + ': trivia in four moves (set, Open lobby, the QR on the TV, Start)', /Trivia\. Pick a question set, tap Open lobby, players scan the QR code on the TV with their phones, then tap Start\./.test(txt));
    check(c[0] + ': musical bingo in four moves (playlist, Open lobby, Deal, Play)', /Musical bingo\. Pick a playlist, tap Open lobby, then Deal, then Play\./.test(txt));
    check(c[0] + ': every link is there (card, help, see a night, terms, privacy, unsubscribe, support email, call line)',
      L.some(function (h) { return /\/add-card\?f=/.test(h); }) && L.indexOf('https://www.venueplay.com.au/help') !== -1 && L.indexOf('https://www.venueplay.com.au/see-a-night') !== -1 &&
      L.indexOf('https://www.venueplay.com.au/terms') !== -1 && L.indexOf('https://www.venueplay.com.au/privacy') !== -1 &&
      L.indexOf('https://www.venueplay.com.au/unsubscribe?e=' + encodeURIComponent(c[3])) !== -1 && L.indexOf('mailto:support@venueplay.com.au') !== -1 && L.indexOf('tel:+61752283667') !== -1, L);
    check(c[0] + ': the price line as Dean set it: $2.50 a player a month while the November offer runs, on the usual crowd, free month from the card, no lock-in',
      /\$2\.50 a player a month, while the November offer runs/.test(txt) && /set on your usual crowd, not counted per person each time you play/.test(txt) &&
      /first month is free, and it starts the day you add your card\. No lock-in\./.test(txt) && /Add your card when you're ready/.test(txt), txt.slice(txt.indexOf('5. Your price'), txt.indexOf('5. Your price') + 400));
    check(c[0] + ': it opens as an invitation to have a play, with no urgency or push (Dean, 28 Oct 2026)',
      /As promised, here's your VenuePlay account for .+?, (with a few quick slides our marketing team made off your website, )?so you can see what your TV looks like and have a play with a game or two\./.test(txt) &&
      !/don't miss|do not miss|hurry|limited time|act now|today only|last chance|before it's gone|spots? left|we have set you up/i.test(txt), txt.slice(0, 300));
    check(c[0] + ': the help line, one line, not a pitch', /If you'd like a hand, reply to this email or tell us a good time and Dean will call you\./.test(txt));
    check(c[0] + ': who we are and how to stop (Spam Act, as every venue email)', /You are getting this because you asked us to set up VenuePlay for/.test(txt) && /Gflam Group Pty Ltd, ABN 35 679 383 049/.test(txt) && /Unsubscribe from product emails/.test(txt));
    check(c[0] + ': no em dash or en dash anywhere in what they read', !/[—–]/.test(txt) && !/&mdash;|&ndash;/.test(html));
    var lone = []; var re = /(\S+)\s+bingo/gi, m; var t2 = txt.replace(/[.,:;()]/g, ' ');
    while ((m = re.exec(t2))) if (!/^(musical|number)$/i.test(m[1])) lone.push(m[1] + ' bingo');
    var bare = (t2.match(/(^|\s)bingo/gi) || []).length - (t2.match(/(musical|number)\s+bingo/gi) || []).length;
    check(c[0] + ': "bingo" only ever as "musical bingo" or "number bingo", never on its own', !lone.length && bare === 0, lone);
    var mus = txt.split(/(?<=[.!?])\s+/).filter(function (s) { return /musical bingo/i.test(s); });
    check(c[0] + ': no sentence about musical bingo calls it gaming or asks for a permit', mus.length >= 1 && mus.every(function (s) { return !/gaming|gambl|permit|licen[cs]e/i.test(s); }), mus);
  });
  var vt = visible(VIC_HTML), qt = visible(QLD_HTML);
  check('VIC: Hi Amit, $150.00 a month for 60, the mobile line, the slides line', /Hi Amit,/.test(vt) && /60 players is \$150\.00 a month/.test(vt) && /Your mobile, 0452 510 904, works too/.test(vt) && /As promised, here's your VenuePlay account for Caz Reitop's Dirty Secrets, with a few quick slides our marketing team made off your website/.test(vt) && /The 2 slides we made for you are already on it/.test(vt), vt.slice(0, 300));
  check('VIC: number bingo on printed tickets, free entry needs no permit, paid is for non-profits', /Number bingo\. In Victoria a phone cannot be used as a ticket, so number bingo is played on printed tickets/.test(vt) && /charging for entry is for non-profits with a permit/.test(vt), vt);
  check('QLD: Hi there, $300.00 a month for 120, no mobile line, the add-your-own-ads line', /Hi there,/.test(qt) && /120 players is \$300\.00 a month/.test(qt) && !/Your mobile/.test(qt) && /add your pictures any time under Your account/.test(qt) && !/already on it/.test(qt) && !/marketing team/.test(qt), qt.slice(0, 300));
  check('QLD: number bingo on phones, with Queensland\'s rules shown before every game, and no paper line', /players join on their phones from the QR on the TV/.test(qt) && /Queensland's rules before every game/.test(qt) && !/printed tickets/.test(qt));
  world(); ENV.FOUNDING_CODES = '';
  await vpaHandleProspect(as(ADMIN, with_({ slides: [] })), ENV, J);
  var std = sent[0] ? visible(sent[0].html) : '';
  check('with no offer running, the email quotes the standard $3.00 and names no offer month', /\$3\.00 a player a month/.test(std) && !/offer runs/.test(std) && /60 players is \$180\.00 a month/.test(std), std.slice(std.indexOf('Your price'), std.indexOf('Your price') + 200));

  section('4. The number bingo line agrees with vp-gaming.js for every state, club and pub');
  var gw = {}; (new Function('window', readFile('venueplay/app/vp-gaming.js')))(gw);
  var G = gw.VPGaming, rows = [];
  ['NSW', 'QLD', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT'].forEach(function (s) {
    ['for_profit', 'non_profit'].forEach(function (e) {
      var w = vpaProspectBingo(s, e);
      var want = G.numberBingoHidden({ au_state: s, entity_type: e }) ? 'off' : (G.states[s].phones.bingo === false ? 'paper' : 'phones');
      var nameOk = w.text.indexOf(G.states[s].name) !== -1;
      if (w.kind !== want || !nameOk || /[—–]/.test(w.text) || /musical/i.test(w.text)) rows.push(s + ' ' + e + ': ' + w.kind + ' vs ' + want + (nameOk ? '' : ' (state name missing)'));
    });
  });
  check('all 16: phones where vp-gaming allows a phone ticket, paper where it does not, off for SA and NT pubs, the state named as vp-gaming names it', rows.length === 0, rows);
  check('SA pub: switched off, with the way to switch it on (a not-for-profit runs it)', /only a not-for-profit organisation may run number bingo, so it is switched off for pubs/.test(vpaProspectBingo('SA', 'for_profit').text));

  if (bad) throw new Error('prospect setup: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
