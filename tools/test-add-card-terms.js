/* AN EMAILED "ADD MY CARD" LINK NEVER SAVES A CARD BEFORE THE TERMS (18 Nov 2026, fix/add-card-terms).

   The gap: /add-card?f=..&t=.. (the free month reminders, the free-month-end note, HQ's welcome, a paused prospect's
   restart; every one made by vpaCardLink) went straight to Stripe Checkout, so a prospect who never ticked section 6 of
   the Terms could save a card and be charged when the month ended, with no Terms on record.

     1. THE WORKER: /add-card makes NO Checkout while any venue on the account has no compliance_accepted_at; it sends
        the venue to /app/?card=terms instead. A venue read that fails, or finds no venue, opens nothing. Once the tick is
        on record (the console's /account/compliance-accept), the same link goes to Stripe. Paying accounts still go to
        billing, comp still pays nothing. /account/card-link answers "terms_first" before the tick (as one-tap-card).
     2. THE CONSOLE: /app/?card=terms puts up the console's own Terms card (VP.termsBeforeCard, the same card and record),
        "Accept and add your card", then asks the card link again and follows it. A paused (switched off) prospect too.
     3. THE WIRING: index.html calls VP.termsFromCardLink on both the held and the normal boot.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) and the REAL vp-session.js and vp-firstrun.js in a small
   fake page. Nothing is sent anywhere.

   Run from the repo root:  jsc tools/test-add-card-terms.js */
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
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; this.abort = function () {}; }; }
if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; clearTimeout = function () {}; }

var AUTH = [];
var rigFetch = globalThis.fetch;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('api.resend.com') !== -1) return RS(200, { id: 're_1' });
  if (u.indexOf('/storage/v1/') !== -1) return RS(200, {});
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '55000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), STRANGER = U(6), W0;
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = [];
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099';
  ENV.CARD_LINK_SECRET = 'card-link-secret-for-tests-only-0123456789';
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = [];
  DB.vp_signin_links = []; DB.vp_prospect_welcomes = []; DB.vp_prospects = []; DB.vp_screens = []; DB.vp_venue_screen = [];
  /* 1,200 other venues first, each with its account record (all ticked), owner and prospect row: past the fake's 1,000-row page. */
  for (var i = 0; i < 1200; i++) {
    var vid = U(100000 + i), fid = U(200000 + i);
    DB.vp_venues.push({ id: vid, name: 'Other Venue ' + i, slug: 'other-' + i, status: 'active', founding_id: fid, max_players: 40, created_at: '2026-11-01T00:00:00Z', compliance_accepted_at: '2026-11-01T00:00:00Z', compliance_accepted_by: 'Someone' });
    DB.venueplay_founding.push({ id: fid, max_seats: 40, stripe_subscription_id: i % 2 ? 'sub_' + i : null, venue_name: 'Other Venue ' + i });
    DB.vp_venue_staff.push({ venue_id: vid, auth_user_id: U(300000 + i), role: 'owner' });
    DB.vp_prospects.push({ id: U(400000 + i), venue_id: vid, free_month_ends_at: '2026-12-01T00:00:00Z', paused_at: null, offer_rate: null, reminders_sent: [] });
  }
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
var AS = function (who, venue) { var h = { Authorization: 'Bearer ' + who }; if (venue) h['X-VP-Venue'] = venue; return h; };
var NTH = 0;
async function prospect() {
  var r = await call('/admin/prospect', { name: 'Card Link Hotel ' + (++NTH), first_name: 'Sam', email: 'sam' + NTH + '@cardlink.example', postcode: '4000', entity_type: 'for_profit', send_welcome: false }, AS(ADMIN));
  if (r.status !== 200) throw new Error('setup failed ' + JSON.stringify(r.body));
  var v = DB.vp_venues.filter(function (x) { return x.id === r.body.venue.id; })[0];
  if (!v.status) v.status = 'active';
  var st = DB.vp_venue_staff.filter(function (x) { return x.venue_id === v.id; })[0];
  var pr = DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0];
  ['first_signin_at', 'free_month_ends_at', 'card_choice', 'card_choice_at', 'paused_at', 'cancelled_at'].forEach(function (k) { if (!(k in pr)) pr[k] = null; });
  if (!('offer_rate' in pr)) pr.offer_rate = null; if (!('reminders_sent' in pr)) pr.reminders_sent = [];
  return { v: v, login: st.auth_user_id, row: function () { return DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0]; },
    founding: function () { return DB.venueplay_founding.filter(function (f) { return f.id === v.founding_id; })[0]; } };
}

/* ---------------- a small DOM (as tools/test-first-run-guide.js) ---------------- */
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = ''; this.className = ''; this.children = [];
  this.parentNode = null; this.style = {}; this.attrs = {}; this.textContent = ''; this.handlers = {};
  this.value = ''; this.checked = false; this.disabled = false;
}
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
El.prototype.appendChild = function (k) { if (k.parentNode) k.parentNode.removeChild(k); this.children.push(k); k.parentNode = this; return k; };
El.prototype.insertBefore = function (k, ref) { if (k.parentNode) k.parentNode.removeChild(k); var i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); k.parentNode = this; return k; };
El.prototype.removeChild = function (k) { var i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parentNode = null; return k; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') this.style.cssText = String(v); if (k === 'style') { var m = /display:\s*([a-z-]+)/.exec(String(v)); if (m) this.style.display = m[1]; } };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.click = function () { if (this.disabled) return null; var out = null; (this.handlers.click || []).forEach(function (f) { out = f({ preventDefault: function () {} }); }); return out; };
function walk(el, fn) { if (fn(el)) return el; for (var i = 0; i < el.children.length; i++) { var r = walk(el.children[i], fn); if (r) return r; } return null; }
async function settle() { for (var i = 0; i < 40; i++) await Promise.resolve(); }

var SESSION = readFile('venueplay/app/vp-session.js'), TVPAIRED = readFile('venueplay/app/vp-tvpaired.js'), FIRSTRUN = readFile('venueplay/app/vp-firstrun.js'),
    INDEX = readFile('venueplay/app/index.html');
/* The page's fetches go to the real Worker: the bearer token is the login id (vpaVerifyJWT above). */
var PAGE_CALLS = [], PAGE_FAIL = false;
function pageFetch(url, opts) {
  var u = String(url), body = opts && opts.body ? JSON.parse(opts.body) : {}, hd = (opts && opts.headers) || {};
  PAGE_CALLS.push({ url: u, body: body, headers: hd });
  if (PAGE_FAIL) return Promise.reject(new Error('offline'));
  var path = u.replace(/^https:\/\/api\.venueplay\.com\.au/, '');
  return call(path, body, hd).then(function (r) { return { ok: r.status === 200, status: r.status, json: function () { return Promise.resolve(r.body); } }; });
}
function page(login, opts) {
  opts = opts || {};
  var body = new El('body'), hdr = new El('header'); body.appendChild(hdr);
  var btn = new El('a'); btn.id = 'cardBtn'; btn.className = 'hact hcard'; btn.style.display = 'none'; btn.textContent = 'Add your card'; hdr.appendChild(btn);
  var document = { body: body, createElement: function (t) { return new El(t); },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); },
    querySelector: function (sel) { return sel === 'header' ? hdr : null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} };
  var client = { auth: {
    getSession: function () { return Promise.resolve({ data: { session: login ? { access_token: login, user: { id: login } } : null } }); },
    getUser: function () { return Promise.resolve({ data: { user: { id: login, email: 'sam@onetap.example', phone: '61452510904' } } }); } },
    from: function () { var b = { select: function () { return b; }, eq: function () { return b; }, maybeSingle: function () { return Promise.resolve({ data: null }); }, then: function (r) { return Promise.resolve({ data: [] }).then(r); } }; return b; } };
  var STORE = {}, SESS = {};
  var storage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); }, removeItem: function (k) { delete STORE[k]; } };
  var sess = { getItem: function (k) { return k in SESS ? SESS[k] : null; }, setItem: function (k, v) { SESS[k] = String(v); }, removeItem: function (k) { delete SESS[k]; } };
  var window = { location: { pathname: '/app/', search: opts.search || '', origin: 'https://venueplay.com.au', reload: function () {} }, supabase: { createClient: function () { return client; } },
    localStorage: storage, sessionStorage: sess, setTimeout: function () { return 0; }, clearTimeout: function () {}, document: document, fetch: pageFetch };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', SESSION))(window, document, storage, sess, window.location, pageFetch);
  (new Function('window', TVPAIRED))(window);
  (new Function('window', FIRSTRUN))(window);
  var TOASTS = [];
  return { doc: document, body: body, btn: btn, win: window, FR: window.VPFirstRun, VP: window.VP, sess: sess, TOASTS: TOASTS,
    deps: { doc: document, storage: storage, session: sess, fetch: pageFetch, client: client, VP: window.VP, toast: function (m) { TOASTS.push(m); },
      setInterval: function () { return 1; }, clearInterval: function () {}, openUrl: function () {}, saveSettings: function () { return Promise.resolve({}); } } };
}
function ctxOf(P, role, v) { return { role: role, venue: v, currentVenueId: v.id, user: { id: P.login, phone: '61452510904' }, staff: [{ venue_id: v.id, role: role, display_name: 'Sam Smith' }],
  settings: { setup_answers: { tvs: '1', nights: ['thu'], games: ['trivia'], name_ok: true } } }; }
function shown(P) { return P.btn.style.display !== 'none'; }
var DAY = 86400000;
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
async function addCard(P) {
  stripeCalls.length = 0;
  var link = await vpaCardLink(ENV, P.v.founding_id);
  var q = link.split('?')[1];
  var res = await vpaAddCardRedirect({ url: 'https://api.example/add-card?' + q, method: 'GET', headers: { get: function () { return null; } } }, ENV);
  return { res: res, link: link, stripe: stripeCalls.length };
}
async function tick(P) { return call('/account/compliance-accept', { venue_id: P.v.id, accepted: true, by: 'Sam Smith' }, AS(P.login, P.v.id)); }

(async function () {
  section('1. The Worker: no Checkout from an emailed card link until the Terms tick is on record');
  world();
  var A = await prospect();
  await call('/account/prospect-start', { venue_id: A.v.id }, AS(A.login, A.v.id));
  check('the prospect is set up the way HQ sets one up: Terms required, no tick on record', A.v.terms_required === true && !A.v.compliance_accepted_at, [A.v.terms_required, A.v.compliance_accepted_at]);
  var a0 = await addCard(A);
  check('the emailed link (vpaCardLink, the one every reminder, note and welcome carries) is a real /add-card link', /^https:\/\/[^\s]+\/add-card\?f=[^&]+&t=[0-9a-f]+$/.test(a0.link), a0.link);
  check('before the tick: no Checkout session is made (nothing to Stripe)', a0.stripe === 0, a0.stripe);
  check('before the tick: it goes to the console Terms card, /app/?card=terms', a0.res && a0.res.status === 302 && /\/app\/\?card=terms$/.test(a0.res.redirect || ''), a0.res);
  check('and no card or subscription is on the account record', !A.founding().stripe_subscription_id, A.founding().stripe_subscription_id);
  var c0 = await call('/account/card-link', { venue_id: A.v.id }, AS(A.login, A.v.id));
  check('the console card link answers "terms_first" too (409, no link)', c0.status === 409 && c0.body.code === 'terms_first' && !c0.body.card_url, [c0.status, c0.body]);
  var tk = await tick(A);
  check('the tick through the console record (/account/compliance-accept): the time and the name on the venue', tk.status === 200 && !!A.v.compliance_accepted_at && A.v.compliance_accepted_by === 'Sam Smith', [tk.status, tk.body]);
  var a1 = await addCard(A);
  check('after the tick: the SAME emailed link goes to Stripe, one Checkout session', a1.stripe === 1 && a1.res && a1.res.status === 302 && !/card=terms/.test(a1.res.redirect || ''), [a1.stripe, a1.res]);
  var c1 = await call('/account/card-link', { venue_id: A.v.id }, AS(A.login, A.v.id));
  check('and the console card link is handed out', c1.status === 200 && /\/add-card\?f=/.test(c1.body.card_url || ''), [c1.status, c1.body]);

  section('2. The Worker: fails closed, and keeps every other answer it gave');
  var B = await prospect();
  var realFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) { if (/\/rest\/v1\/vp_venues\?founding_id=eq\./.test(String(url))) return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('down'); } }); return realFetch(url, opts); };
  var b0 = await addCard(B);
  globalThis.fetch = realFetch;
  check('the venues cannot be read: no Checkout, a page that says nothing was charged', b0.stripe === 0 && b0.res && b0.res.status === 200 && /Nothing has been charged/.test(b0.res.body || ''), [b0.stripe, b0.res && b0.res.status]);
  await tick(B);
  var BF = B.v.founding_id, BW = { v: { founding_id: BF } };   // the link is made for the account record, not the venue
  B.v.founding_id = U(999);   // the account's only venue moved off it
  var b1 = await addCard(BW);
  check('an account with no venue on it: no Checkout, a page that says nothing was charged', b1.stripe === 0 && b1.res && b1.res.status === 200 && /Nothing has been charged/.test(b1.res.body || ''), [b1.stripe, b1.res]);
  B.v.founding_id = BF;
  /* Two venues on one account, one ticked: still no card. */
  var C = await prospect(); await tick(C);
  DB.vp_venues.push({ id: U(777), name: 'Card Link Hotel Upstairs', slug: 'cl-up', status: 'active', founding_id: C.v.founding_id, max_players: 20, compliance_accepted_at: null });
  var cc = await addCard(C);
  check('two venues on one account, one without its tick: no Checkout, on to the Terms card', cc.stripe === 0 && cc.res.status === 302 && /card=terms$/.test(cc.res.redirect), [cc.stripe, cc.res]);
  DB.vp_venues.filter(function (v) { return v.id === U(777); })[0].compliance_accepted_at = '2026-11-18T00:00:00Z';
  var cd = await addCard(C);
  check('both ticked: Checkout', cd.stripe === 1, cd.stripe);
  /* A paying account still goes to billing; a bad signature is still refused, before any venue is read. */
  var D = await prospect(); D.founding().stripe_subscription_id = 'sub_live_1';
  var dd = await addCard(D);
  check('already paying (no tick on record): billing, as before, never a second Checkout', dd.stripe === 0 && dd.res.status === 302 && /\/app\/billing\.html$/.test(dd.res.redirect), dd.res);
  stripeCalls.length = 0;
  var bad1 = await vpaAddCardRedirect({ url: 'https://api.example/add-card?f=' + A.v.founding_id + '&t=00000000000000000000000000000000', method: 'GET', headers: { get: function () { return null; } } }, ENV);
  check('a wrong signature: refused, no Checkout', stripeCalls.length === 0 && /not valid/.test(bad1.body || ''), bad1.body);
  /* An older venue ticked in the console long ago (not a prospect): one link, straight to Stripe. */
  var E = await prospect(); await tick(E); DB.vp_prospects = DB.vp_prospects.filter(function (p) { return p.venue_id !== E.v.id; });
  var ee = await addCard(E);
  check('a ticked venue that is not a prospect: straight to Stripe, no extra step', ee.stripe === 1, ee.stripe);

  section('3. The console: /app/?card=terms puts up the Terms card, then goes on to the card');
  world();
  var F = await prospect(); await call('/account/prospect-start', { venue_id: F.v.id }, AS(F.login, F.v.id));
  var FV = {}; for (var k in F.v) FV[k] = F.v[k];
  var PF = page(F.login, { search: '?card=terms' }); var GONE = [];
  var up = PF.VP.termsFromCardLink(ctxOf(PF, 'owner', FV), { openUrl: function (u) { GONE.push(u); } }); await settle();
  var go = PF.doc.getElementById('vpTermsGo'), tk3 = PF.doc.getElementById('vpTermsTick'), by = PF.doc.getElementById('vpTermsBy');
  check('the Terms card is up, its button "Accept and add your card", the name filled in', up === true && !!go && go.textContent === 'Accept and add your card' && by && by.value === 'Sam Smith', [up, go && go.textContent]);
  await go.click(); await settle();
  check('Accept without the tick: refused, nothing recorded, no card link followed', !F.v.compliance_accepted_at && GONE.length === 0, [F.v.compliance_accepted_at, GONE]);
  tk3.checked = true; await go.click(); for (var s9 = 0; s9 < 6; s9++) await settle();
  var aud = DB.vp_admin_audit.filter(function (a) { return a.action === 'compliance_accepted' && a.target === 'venue:' + F.v.id; });
  check('the tick is recorded on the venue with the name, plus one audit row with the Terms date and words', !!F.v.compliance_accepted_at && F.v.compliance_accepted_by === 'Sam Smith' && aud.length === 1 && !!aud[0].detail.terms_effective && !!aud[0].detail.tick, [F.v.compliance_accepted_at, aud.length]);
  check('then straight on to the venue\'s own card link (Add my card, tick, Accept: 3 taps from the email)', GONE.length === 1 && /\/add-card\?f=/.test(GONE[0]) && GONE[0].indexOf(encodeURIComponent(F.v.founding_id)) > 0, GONE);
  stripeCalls.length = 0;
  var follow = await vpaAddCardRedirect({ url: 'https://api.example' + GONE[0].replace(/^https:\/\/[^/]+/, ''), method: 'GET', headers: { get: function () { return null; } } }, ENV);
  check('and that link now opens Stripe', stripeCalls.length === 1 && follow.status === 302, [stripeCalls.length, follow]);
  var PN = page(F.login, { search: '' });
  var G = await prospect(); var GV = {}; for (var gk in G.v) GV[gk] = G.v[gk];
  check('no ?card=terms in the address: nothing put up', PN.VP.termsFromCardLink(ctxOf(PN, 'owner', GV), { openUrl: function () {} }) === false && !PN.doc.getElementById('vpTermsCard'));
  var PH = page(G.login, { search: '?card=terms' });
  check('a host (not owner or manager): no card, a host cannot accept', PH.VP.termsFromCardLink(ctxOf(PH, 'host', GV), { openUrl: function () {} }) === false);
  var PS = page(G.login, { search: '?card=terms&x=1' }); var SV = {}; for (var sk in G.v) SV[sk] = G.v[sk]; SV.status = 'suspended';
  check('a paused (switched off) prospect with no tick still gets the Terms card, since the card is how it comes back', PS.VP.termsFromCardLink(ctxOf(PS, 'owner', SV), { openUrl: function () {} }) === true && !!PS.doc.getElementById('vpTermsGo'));
  var PT = page(F.login, { search: '?card=terms' }); var TV = {}; for (var tk4 in F.v) TV[tk4] = F.v[tk4];
  check('a venue that has ticked: nothing put up (the card link itself goes to Stripe)', PT.VP.termsFromCardLink(ctxOf(PT, 'owner', TV), { openUrl: function () {} }) === false && !PT.doc.getElementById('vpTermsCard'));

  section('3b. A group: one rule for both paths, never a dead end (review SHOULD 1)');
  world();
  var H = await prospect(); await call('/account/prospect-start', { venue_id: H.v.id }, AS(H.login, H.v.id)); await tick(H);
  var HB = U(778);
  DB.vp_venues.push({ id: HB, name: 'Group Hotel Upstairs', slug: 'grp-up', status: 'active', founding_id: H.v.founding_id, max_players: 20, created_at: '2026-11-18T00:00:00Z', compliance_accepted_at: null });
  DB.vp_venue_staff.push({ venue_id: HB, auth_user_id: H.login, role: 'owner' });
  var MGR = U(5); DB.vp_venue_staff.push({ venue_id: H.v.id, auth_user_id: MGR, role: 'manager' });
  var h0 = await call('/account/card-link', { venue_id: H.v.id }, AS(H.login, H.v.id));
  check('venue A ticked, B on the same account not: the console card link refuses too (the same rule as /add-card), no link', h0.status === 409 && h0.body.code === 'terms_first' && !h0.body.card_url, [h0.status, h0.body]);
  check('and it names the venue still to tick, so the console can put up THAT card', h0.body.venue_id === HB && h0.body.venue_name === 'Group Hotel Upstairs' && /Group Hotel Upstairs/.test(h0.body.error || ''), h0.body);
  var hm = await call('/account/card-link', { venue_id: H.v.id }, AS(MGR, H.v.id));
  check('a manager of A only: told in words that B needs its own tick, never handed B\'s id', hm.status === 409 && hm.body.code === 'terms_first' && !hm.body.venue_id && /Group Hotel Upstairs/.test(hm.body.error || ''), [hm.status, hm.body]);
  var ha = await addCard(H);
  check('the emailed link for the same account: no Checkout, on to /app/?card=terms', ha.stripe === 0 && /card=terms$/.test(ha.res.redirect || ''), [ha.stripe, ha.res]);
  var HV = {}; for (var hk in H.v) HV[hk] = H.v[hk];
  var PG = page(H.login, { search: '?card=terms' }); var GONE2 = [];
  var upG = PG.VP.termsFromCardLink(ctxOf(PG, 'owner', HV), { openUrl: function (u) { GONE2.push(u); } }); for (var s1 = 0; s1 < 6; s1++) await settle();
  var cardG = PG.doc.getElementById('vpTermsCard'), goG = PG.doc.getElementById('vpTermsGo');
  check('the console opens on A (ticked): B\'s Terms card goes up, not a page with nothing on it', upG === false && !!cardG && cardG.getAttribute('data-venue') === HB && !!goG && goG.textContent === 'Accept and add your card', [upG, cardG && cardG.getAttribute('data-venue')]);
  PG.doc.getElementById('vpTermsTick').checked = true; PG.doc.getElementById('vpTermsBy').value = 'Sam Smith';
  await goG.click(); for (var s2 = 0; s2 < 8; s2++) await settle();
  var HBrow = DB.vp_venues.filter(function (x) { return x.id === HB; })[0];
  check('B\'s tick is recorded on B (one record per venue), A\'s record untouched', !!HBrow.compliance_accepted_at && HBrow.compliance_accepted_by === 'Sam Smith' && H.v.compliance_accepted_by === 'Sam Smith', [HBrow.compliance_accepted_at, HBrow.compliance_accepted_by]);
  check('then straight on to the account\'s card link', GONE2.length === 1 && /\/add-card\?f=/.test(GONE2[0]), GONE2);
  var hz = await addCard(H);
  check('and the emailed link now opens Stripe', hz.stripe === 1, hz.stripe);
  var SESSW = readFile('venueplay/app/vp-session.js'), FRW = readFile('venueplay/app/vp-firstrun.js');
  check('the paused card and the setup guide take the same answer (termsForCardAnswer), not the venue in view alone', /termsForCardAnswer\(ctx, j, holdOn\)/.test(SESSW) && /VP\.termsForCardAnswer\(ctx, d,/.test(FRW));
  check('both Worker paths ask the one shared rule (vpaCardTermsMissing)', (W0 = readFile('venueplay-backend/worker/venueplay-api-FULL.js')).indexOf('await vpaCardTermsMissing(env, fid)') > 0 && /async function vpaCardTermsOnRecord\(env, foundingId\) \{\n  const missing = await vpaCardTermsMissing\(env, foundingId\);/.test(W0));

  section('4. The wiring and the words');
  check('index.html runs it on the held boot (termsGate) and the normal boot', /VP\.termsGate\(__ctx\)\)\{ if\(VP\.termsFromCardLink\) VP\.termsFromCardLink\(__ctx\);/.test(INDEX) && /if\(window\.VP && VP\.termsFromCardLink\) VP\.termsFromCardLink\(__ctx\);/.test(INDEX));
  var W = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var gate = W.indexOf('vpaCardTermsOnRecord(env, foundingId)'), stripe = W.indexOf("fetch('https://api.stripe.com/v1/checkout/sessions'", W.indexOf('async function vpaAddCardRedirect('));
  check('in the Worker the Terms check comes before the Checkout session is made', gate > 0 && stripe > gate, [gate, stripe]);
  check('no em dashes in the new words', !/\u2014/.test(W.slice(W.indexOf('async function vpaCardTermsMissing'), W.indexOf('async function vpaAddCardRedirect'))) && !/\u2014/.test(lift(readFile('venueplay/app/vp-session.js'), 'termsFromCardLink')) && !/\u2014/.test(lift(readFile('venueplay/app/vp-session.js'), 'termsForCardAnswer')));

  section('5. One card-link read (duplicate helpers audit 18 Nov 2026, Part 2 G)');
  /* Every console script asks /account/card-link through VP.cardLink and follows only what VP.cardLinkOk passes. */
  var cardSrcs = ['venueplay/app/vp-session.js', 'venueplay/app/vp-firstrun.js'].map(function (p) { return [p, readFile(p)]; });
  var asks = cardSrcs.map(function (x) { return [x[0], (x[1].match(/["']\/account\/card-link["']/g) || []).length]; });
  check('the console asks /account/card-link in one place only (VP.cardLink in vp-session.js)', asks[0][1] === 1 && asks.slice(1).every(function (x) { return x[1] === 0; }), asks);
  var P5 = page(H.login), O5 = P5.VP;
  check('one "is it a card link" test, strict: https only, nothing that breaks out of an href', O5.cardLinkOk({ card_url: 'https://www.venueplay.com.au/add-card?f=F1&t=abc' }) === true
    && !O5.cardLinkOk({ card_url: 'http://www.venueplay.com.au/add-card' }) && !O5.cardLinkOk({ card_url: 'https://x/"><b>' }) && !O5.cardLinkOk({ card_url: 'javascript:alert(1)' }) && !O5.cardLinkOk(null));
  var cl5 = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tk' } } }); } } }, noSess = { auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } } };
  var n5 = 0, off5 = await O5.cardLink('V5', { client: cl5, fetch: function () { n5++; return Promise.reject(new Error('offline')); } });
  var bad5 = await O5.cardLink('V5', { client: cl5, fetch: function () { n5++; return Promise.resolve({ json: function () { return Promise.reject(new Error('not json')); } }); } });
  var none5 = await O5.cardLink('V5', { client: noSess, needSignIn: true, fetch: function () { n5++; return Promise.resolve({ json: function () { return Promise.resolve({ ok: true }); } }); } });
  check('the read never throws: offline and a broken answer come back as words the page can show; no sign-in asks nothing when told',
    off5 && /Could not reach venueplay/.test(off5.error) && bad5 && /Something went wrong at our end/.test(bad5.error) && none5 === null && n5 === 2, [off5, bad5, none5, n5]);

  print(''); print(bad ? (bad + ' OF ' + ran + ' CHECKS FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { bad++; print('  FAIL threw: ' + e + ' ' + (e && e.stack)); print(bad + ' OF ' + ran + ' CHECKS FAILED'); });
drainMicrotasks();
