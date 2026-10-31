/* SECTION 6 OF THE TERMS, ACCEPTED ONCE, FROM THE CONSOLE (legal compliance matrix gap 1, 28 Oct 2026).

   Anisimoff Legal 9380, 1 Oct 2026, point 3: "prudent to ensure Customers actively tick a check box".
   Onboarding has recorded that tick since 15 Oct 2026; on 28 Oct 26 of 27 venues had no record and
   nothing ever asked them. The console now asks once (VP.termsCard in venueplay/app/vp-session.js) and
   the billing Worker records it (/account/compliance-accept) in the same two columns, the same way.

   RUNS the real code, nothing is word-searched:
     1. vp-session.js in a small fake page: who sees which card, the tick and the name are required,
        what Accept sends and where, what the page shows after, and that the card hides nothing
     2. index.html's proceedVenue and billing.html's boot, lifted and run, call it
     3. the REAL billing Worker on tools/rig-billing-worker.js: owner and manager accept, a host, a
        stranger's venue and HQ View as are refused, a second acceptance never overwrites the first,
        the audit row carries the sentence ticked
     4. the sentence and the date are one sentence and one date: console, Worker and terms.html

   Run from the repo root:  jsc tools/test-terms-acceptance-card.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- a small DOM: a tree with ids, attributes, text and click handlers ---------------- */
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
var CALLS = [];
var ANSWER = null;   // what the fake billing Worker says next
function page() {
  var body = new El('body');
  var wrap = new El('div'); wrap.className = 'wrap'; body.appendChild(wrap);
  var view = new El('div'); view.id = 'vMenu'; wrap.appendChild(view);
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
  var window = { location: { pathname: '/app/', search: '' }, supabase: { createClient: function () { return client; } },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = v; }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: function () { return 0; }, clearTimeout: function () {} };
  var fetch = function (url, opts) {
    CALLS.push({ url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : null });
    var a = ANSWER || { ok: true, compliance_accepted_at: '2026-10-28T02:00:00.000Z', compliance_accepted_by: 'Jane Smith' };
    if (a === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: !a.error, status: a.error ? 400 : 200, json: function () { return Promise.resolve(a); } });
  };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', SESSION))
    (window, document, window.localStorage, window.sessionStorage, window.location, fetch);
  return { VP: window.VP, document: document, body: body, wrap: wrap, view: view };
}
function venue(over) { var v = { id: 'V1', name: 'Tugun Bowls Club', slug: 'tugun', status: 'active', compliance_accepted_at: null, compliance_accepted_by: null }; for (var k in (over || {})) v[k] = over[k]; return v; }
function ctxFor(role, v, staffName) { return { role: role, venue: v || venue(), currentVenueId: 'V1', staff: role === 'admin' ? [] : [{ venue_id: 'V1', role: role, display_name: staffName || null }] }; }
function card(P) { return P.document.getElementById('vpTermsCard'); }

/* =============================================================================================== */
section('1. Who is asked: an owner or a manager of a venue with no record, once');
var P = page();
check('the console exports the card', typeof P.VP.termsCard === 'function');
var shown = P.VP.termsCard(ctxFor('owner', null, 'Jane Smith'));
var c = card(P), t = c ? allText(c) : '';
check('an owner at a venue with no recorded tick is shown the card', shown === true && !!c, shown);
check('it names the venue and asks for the updated Terms', /Please accept the updated Terms for Tugun Bowls Club/.test(t), t);
check('it says games run as normal, because the tick gates no game', /your games run as normal/i.test(t), t);
check('it links to the Terms', !!walk(c, function (e) { return e.tagName === 'A' && e.getAttribute('href') === '/terms'; }));
var tick = P.document.getElementById('vpTermsTick'), by = P.document.getElementById('vpTermsBy'), go = P.document.getElementById('vpTermsGo');
check('there is a tick box, a name field and an Accept button', !!tick && tick.getAttribute('type') === 'checkbox' && !!by && !!go && go.textContent === 'Accept');
check('the tick names section 6, the date and the venue, then the onboarding sentence word for word',
  /I accept section 6 of the Terms \(effective 28 October 2026\) for Tugun Bowls Club\. We are responsible for complying with the gaming laws that apply to our venue, including any permit, licence or authority, age limits and attendance rules\. VenuePlay supplies the software only\./.test(t), t);
check('the name starts as the staff member\'s own name where we have one', by.value === 'Jane Smith', by.value);
check('the tick starts unticked: an acceptance is an act, never a default', tick.checked === false);
check('the card sits at the top of the page content, above the game picker', P.wrap.children[0] === c && P.wrap.children[1] === P.view);
check('it hides nothing: the game picker is still displayed', P.view.style.display !== 'none' && !P.view.getAttribute('data-vp-held'));
check('controls are a thumb\'s width (44px) like the shared hold card', /min-height:44px/.test(go.style.cssText) && /min-height:44px/.test(by.style.cssText), go.style.cssText);
check('on-brand: Manrope, the VenuePlay pink, a rounded card', /Manrope/.test(c.style.cssText) && /#FF1F8E/.test(go.style.cssText) && /border-radius:16px/.test(c.style.cssText));
check('it fits a phone: no fixed width wider than the screen', /width:calc\(100% - 32px\)/.test(c.style.cssText) && /max-width:560px/.test(c.style.cssText));
P.VP.termsCard(ctxFor('owner', null, 'Jane Smith'));
var n = 0; walk(P.body, function (e) { if (e.id === 'vpTermsCard') n++; return false; });
check('called again, there is still exactly one card', n === 1, n);

var M = page(); M.VP.termsCard(ctxFor('manager'));
check('a manager is asked too, with the same tick', !!M.document.getElementById('vpTermsTick'));
check('a manager with no name on file starts with an empty name, never somebody else\'s', M.document.getElementById('vpTermsBy').value === '');

var H = page(); H.VP.termsCard(ctxFor('host'));
var ht = card(H) ? allText(card(H)) : '';
check('a host is told the venue owner needs to accept the updated Terms', /Your venue owner needs to accept the updated Terms/.test(ht), ht);
check('a host is told their games run as normal', /Your games run as normal/.test(ht), ht);
check('a host gets no tick and no Accept button', !H.document.getElementById('vpTermsTick') && !H.document.getElementById('vpTermsGo'));

var A = page(); A.VP.termsCard(ctxFor('admin'));
var at = card(A) ? allText(card(A)) : '';
check('HQ View as is told the venue has not accepted, and that it cannot accept for them', /has not accepted section 6/.test(at) && /HQ View as cannot accept it for them/.test(at), at);
check('HQ View as gets no tick and no Accept button', !A.document.getElementById('vpTermsTick') && !A.document.getElementById('vpTermsGo'));

var D = page();
check('a venue with a recorded tick is never asked', D.VP.termsCard(ctxFor('owner', venue({ compliance_accepted_at: '2026-10-19T01:00:00Z', compliance_accepted_by: 'Deepwater' }))) === false && !card(D));
var noCol = venue(); delete noCol.compliance_accepted_at;
check('a venue row without the column (database before migration 100) is never asked', D.VP.termsCard(ctxFor('owner', noCol)) === false && !card(D));
check('a switched-off venue shows its hold card, not this one', D.VP.termsCard(ctxFor('owner', venue({ status: 'suspended', suspended_reason: 'nonpayment' }))) === false && !card(D));
D.VP.termsCard(ctxFor('owner'));
check('switching to a venue with no record shows it', !!card(D));
D.VP.termsCard(ctxFor('owner', venue({ id: 'V2', compliance_accepted_at: '2026-10-19T01:00:00Z' })));
check('switching to a venue that has accepted takes it away again', !card(D));

section('2. Accept asks for the tick and a name, then records it through the billing Worker');
CALLS.length = 0; ANSWER = null;
var Q = page(), qctx = ctxFor('owner', null, 'Jane Smith');
Q.VP.termsCard(qctx);
var qgo = Q.document.getElementById('vpTermsGo'), qtick = Q.document.getElementById('vpTermsTick'), qby = Q.document.getElementById('vpTermsBy'), qmsg = Q.document.getElementById('vpTermsMsg');
qgo.click(); drainMicrotasks();
check('Accept with the box unticked sends nothing and says to tick it', CALLS.length === 0 && /Tick the box/.test(qmsg.textContent), qmsg.textContent);
qtick.checked = true; qby.value = '   '; qgo.click(); drainMicrotasks();
check('ticked with no name sends nothing and asks for the name', CALLS.length === 0 && /Enter your name/.test(qmsg.textContent), qmsg.textContent);
qby.value = '  Jane Smith  '; ANSWER = { error: 'Pick one of your venues.' }; qgo.click(); drainMicrotasks(); drainMicrotasks();
check('a refusal is shown in the card and the button comes back', /Pick one of your venues\./.test(qmsg.textContent) && qgo.disabled === false && !!card(Q), qmsg.textContent);
ANSWER = 'offline'; CALLS.length = 0; qgo.click(); drainMicrotasks(); drainMicrotasks();
check('no network says so in words and the button comes back', /Could not reach VenuePlay/.test(qmsg.textContent) && qgo.disabled === false, qmsg.textContent);
ANSWER = null; CALLS.length = 0; qgo.click(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
var call = CALLS[0] || { opts: { headers: {} } };
check('it posts to the billing Worker\'s /account/compliance-accept', CALLS.length === 1 && call.url === 'https://api.venueplay.com.au/account/compliance-accept', call.url);
check('signed in as the person ticking, naming the venue', call.opts.headers.Authorization === 'Bearer TOKEN-1' && call.opts.headers['X-VP-Venue'] === 'V1', call.opts.headers);
check('the body is the venue, accepted:true and the trimmed name', call.body && call.body.venue_id === 'V1' && call.body.accepted === true && call.body.by === 'Jane Smith', call.body);
var qt = card(Q) ? allText(card(Q)) : '';
check('the card then says it is recorded, for whom and by whom', /Accepted/.test(qt) && /recorded as accepted for Tugun Bowls Club by Jane Smith/.test(qt), qt);
check('the page now knows the venue has accepted, so it is not asked again this visit', !!qctx.venue.compliance_accepted_at && Q.VP.termsCard(qctx) === false);
var Q2 = page(), q2ctx = ctxFor('owner', null, 'Jane'); Q2.VP.termsCard(q2ctx);
Q2.document.getElementById('vpTermsTick').checked = true; Q2.document.getElementById('vpTermsGo').click(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
var done = Q2.document.getElementById('vpTermsDone');
check('Done takes the card away', !!done && (done.click(), !card(Q2)));

section('3. The console calls it where an owner or a manager lands');
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var INDEX = readFile('venueplay/app/index.html');
var log = [];
var fakeVP = { holdGate: function () { log.push('holdGate'); return false; }, termsCard: function (c) { log.push('termsCard:' + (c && c.venue && c.venue.id)); return true; } };
var proceedVenue = (new Function('__ctx', 'window', 'VP', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'go', 'pairToVenue', '$',
  'return (' + lift(INDEX, 'proceedVenue') + ');'))({ venue: { id: 'V1', slug: 'tugun' }, staff: [{ venue_id: 'V1' }] }, { VP: fakeVP }, fakeVP,
  function () {}, function () {}, function () { return true; }, function () {}, function () { log.push('go'); }, function () { log.push('pair'); return true; }, function () { return { value: '', textContent: '', focus: function () {} }; });
proceedVenue();
check('index.html proceedVenue asks after the hold check and before pairing the TV', log.join(',') === 'holdGate,termsCard:V1,pair', log.join(','));
var BILL = readFile('venueplay/app/billing.html');
var bootAt = BILL.indexOf("VP.requireAuth({ roles:['owner','manager'] }).then(function(ctx){");
var bootTxt = bootAt >= 0 ? BILL.slice(bootAt, BILL.indexOf('\n', BILL.indexOf('VP.termsCard', bootAt))) : '';
log = [];
try {
  (new Function('VP', bootTxt.replace("VP.requireAuth({ roles:['owner','manager'] }).then(function(ctx){", 'var ctx = { venue: { id: "V9" } };') + '\n'))(
    { suspensionBanner: function () { log.push('suspensionBanner'); }, termsCard: function (c) { log.push('termsCard:' + c.venue.id); } });
} catch (e) { log.push('threw ' + e); }
check('Your account (billing.html) asks too, after the unpaid bar', log.join(',') === 'suspensionBanner,termsCard:V9', log.join(','));

/* =============================================================================================== */
load('tools/rig-billing-worker.js');
/* The Worker's own constants, read off its source: a const in the rig's eval is not visible out here. */
var API_SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var VPA_COMPLIANCE_TICK = (/const VPA_COMPLIANCE_TICK = '([^']+)';/.exec(API_SRC) || [])[1];
var VPA_TERMS_EFFECTIVE = (/const VPA_TERMS_EFFECTIVE = '([^']+)';/.exec(API_SRC) || [])[1];
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return '51000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '61000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(9), OWNER = U(1), MANAGER = U(2), HOST = U(4), STRANGER = U(5);
var TUGUN = V(1), ELSE = V(2);
function as(user, body, extra) {
  var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'tugun@example.com', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f2', contact_email: 'else@example.com', plan: 'monthly', status: 'card_on_file' }];
  DB.vp_venues = [{ id: TUGUN, name: 'Tugun Bowls Club', founding_id: 'f1', slug: 'tugun', status: 'active', created_at: '2026-01-01T00:00:00Z', au_state: 'QLD', compliance_accepted_at: null, compliance_accepted_by: null },
                  { id: ELSE, name: 'Somebody Else Hotel', founding_id: 'f2', slug: 'else', status: 'active', created_at: '2026-01-02T00:00:00Z', au_state: 'NSW', compliance_accepted_at: null, compliance_accepted_by: null }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: TUGUN, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: MANAGER, venue_id: TUGUN, role: 'manager', permissions: { advertising: true, draws_raffles: false, players_optin: false, add_hosts: false } },
                       { id: 's4', auth_user_id: HOST, venue_id: TUGUN, role: 'host', permissions: null },
                       { id: 's5', auth_user_id: STRANGER, venue_id: ELSE, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
}
function row(id) { return DB.vp_venues.filter(function (v) { return v.id === id; })[0] || {}; }
function accepts() { return DB.vp_admin_audit.filter(function (a) { return a.action === 'compliance_accepted'; }); }
var ACC = { venue_id: TUGUN, accepted: true, by: 'Jane Smith' };
function body(o) { var b = {}; for (var k in ACC) b[k] = ACC[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }

(async function () {
  section('4. The billing Worker records it the way onboarding does, once, for the venue\'s own owner or manager');
  world();
  var r = await vpbAcceptCompliance(as(HOST, body()), ENV, J);
  check('a host is refused before anything is written', r.status === 403 && !row(TUGUN).compliance_accepted_at && accepts().length === 0, r);
  r = await vpbAcceptCompliance(as(STRANGER, body()), ENV, J);
  check('an owner of another venue cannot accept for this one', r.status === 400 && /Pick one of your venues/.test(r.body.error) && !row(TUGUN).compliance_accepted_at, r);
  r = await vpbAcceptCompliance(as(ADMIN, body(), { 'X-VP-Venue': TUGUN }), ENV, J);
  check('HQ View as is refused: the venue accepts its own Terms', r.status === 403 && /HQ View as cannot accept/.test(r.body.error) && !row(TUGUN).compliance_accepted_at, r);
  r = await vpbAcceptCompliance(as(OWNER, body({ accepted: 'yes' })), ENV, J);
  check('accepted must be exactly true, not a truthy string', r.status === 400 && !row(TUGUN).compliance_accepted_at, r);
  r = await vpbAcceptCompliance(as(OWNER, body({ by: '   ' })), ENV, J);
  check('ticked with nobody named is refused', r.status === 400 && /name/.test(r.body.error) && !row(TUGUN).compliance_accepted_at, r);
  r = await vpbAcceptCompliance(as(OWNER, body({ by: '  Jane Smith  ' })), ENV, J);
  var t0 = row(TUGUN);
  check('the owner accepts: ok, with the time and the name', r.status === 200 && r.body.ok === true && r.body.compliance_accepted_by === 'Jane Smith' && !r.body.already, r.body);
  check('compliance_accepted_at is a timestamp from now, not a flag', /^\d{4}-\d{2}-\d{2}T/.test(String(t0.compliance_accepted_at)) && Math.abs(Date.parse(t0.compliance_accepted_at) - Date.now()) < 60000, t0.compliance_accepted_at);
  check('compliance_accepted_by is the name typed, trimmed, as onboarding records it', t0.compliance_accepted_by === 'Jane Smith', t0.compliance_accepted_by);
  var au = accepts()[0] || { detail: {} };
  check('one audit row, naming who, their role, the Terms date and the sentence ticked',
    accepts().length === 1 && au.target === 'venue:' + TUGUN && au.detail.compliance_accepted_by === 'Jane Smith' && au.detail.role === 'owner' &&
    au.detail.terms_effective === '28 October 2026' && au.detail.tick === VPA_COMPLIANCE_TICK, au);
  check('the other venue is untouched', !row(ELSE).compliance_accepted_at);
  var first = t0.compliance_accepted_at;
  r = await vpbAcceptCompliance(as(MANAGER, body({ by: 'Manager Mike' })), ENV, J);
  check('a second acceptance is answered "already" and keeps the first record', r.status === 200 && r.body.already === true && row(TUGUN).compliance_accepted_by === 'Jane Smith' && row(TUGUN).compliance_accepted_at === first && accepts().length === 1, r.body);

  world();
  r = await vpbAcceptCompliance(as(MANAGER, body({ by: 'Manager Mike' })), ENV, J);
  check('a manager can accept, with or without the draws right', r.status === 200 && row(TUGUN).compliance_accepted_by === 'Manager Mike' && (accepts()[0] || { detail: {} }).detail.role === 'manager', r.body);
  world();
  r = await vpbAcceptCompliance(as(OWNER, body({ by: 'x'.repeat(300) })), ENV, J);
  check('a very long name is kept to 120 characters, the onboarding rule', r.status === 200 && row(TUGUN).compliance_accepted_by.length === 120, row(TUGUN).compliance_accepted_by && row(TUGUN).compliance_accepted_by.length);
  world();
  /* Somebody else accepted between our read and our write: the conditional write lands nowhere,
     and the read back shows theirs. Theirs stands and no second audit row is written. */
  var rigF = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if ((opts && opts.method) === 'PATCH' && /vp_venues\?/.test(String(url))) { row(TUGUN).compliance_accepted_at = '2026-10-28T00:00:01.000Z'; row(TUGUN).compliance_accepted_by = 'The Other Manager'; }
    return rigF(url, opts);
  };
  r = await vpbAcceptCompliance(as(OWNER, body()), ENV, J);
  globalThis.fetch = rigF;
  check('two people ticking at once: the first record stands, the second is told "already"', r.status === 200 && r.body.already === true && row(TUGUN).compliance_accepted_by === 'The Other Manager' && accepts().length === 0, r.body);
  world();
  r = await vpbAcceptCompliance(as(OWNER, body()), ENV, J);
  var ok1 = r.status === 200;
  var route = /path === '\/account\/compliance-accept'\s*&& typeof vpbAcceptCompliance === 'function'\) return await vpbAcceptCompliance\(request, env, json\)/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js'));
  check('the route is wired in the Worker\'s router as a POST', ok1 && route);

  section('5. One sentence, one date: the console, the Worker and the Terms page');
  var S = readFile('venueplay/app/vp-session.js');
  var ct = /var TERMS_TICK = "([^"]+)";/.exec(S), ce = /var TERMS_EFFECTIVE = "([^"]+)";/.exec(S);
  check('the console ticks the Worker\'s VPA_COMPLIANCE_TICK, word for word', ct && ct[1] === VPA_COMPLIANCE_TICK, ct && ct[1]);
  var eff = /Effective date: ([0-9]+ [A-Za-z]+ [0-9]{4})/.exec(readFile('venueplay/terms.html'));
  check('the console\'s date, the Worker\'s record and terms.html all say the same effective date',
    ce && eff && ce[1] === eff[1] && VPA_TERMS_EFFECTIVE === eff[1], [ce && ce[1], VPA_TERMS_EFFECTIVE, eff && eff[1]]);

  if (bad) throw new Error('terms acceptance card: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
