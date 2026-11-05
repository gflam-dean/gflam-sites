/* THE FIRST-SIGN-IN SETUP GUIDE, RUN AND NOT WORD-SEARCHED (Dean, 5 Nov 2026, INBOX 13).

   "the full setup guide inside the app when a new venue or owner first signs in, step by step: the TV
   (Google TV app + screen code, or a browser at venueplay.com.au/tv + screen code + full screen),
   adding hosts (they get a text), and a first test game."

   venueplay/app/vp-firstrun.js runs here in a small fake page with the REAL vp-session.js (so the screen
   code is the console's own VP.venueCode), against a fake billing Worker:

     1. THE ORDER: the TV, then hosts, then a first test game, then the card; a self sign-up with its
        mobile, the Terms and a card already on gets exactly those three
     2. THE TV: the venue's own screen code (its join_code, or the derived code the console chip falls
        back to), a Google TV way (the venueplay TV app, linked to its Google Play page, then the code)
        and a web browser way (venueplay.com.au/tv, the code, full screen), Google TV first; no slug
        link, no "search by venue name"
     3. THE HOSTS: who is already a host here, name and mobile, a landline or no name refused before
        anything is sent, /account/host-add for THIS venue only (the Worker makes the login and texts
        the sign-in link), the Worker's own refusal shown, never an email, never a text from the page
     4. A FIRST TEST GAME: trivia first and pink, musical bingo second and never called bingo
     5. READABLE AT 375px: nothing in the guide under 15px, no fixed width wider than a 375px phone
        leaves, the borrowed Terms card lifted to 15px on a phone
     6. THE WORDS: lowercase venueplay, no em or en dash, never "roster"
     7. ABOUT YOU AND YOUR VENUE (Dean, INBOX 24): their name while it is still the "<venue> manager"
        placeholder (/account/my-name) and a logo while there is none (/account/logo-upload, this venue),
        each optional and only when empty; a GIF, a logo over 1MB or no name refused on the page, the
        Worker's own refusal shown; the step left out when both are done; never a question the Account
        page does not store

   Run from the repo root:  jsc tools/test-first-run-guide.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- a small DOM ---------------- */
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = ''; this.className = ''; this.children = [];
  this.parentNode = null; this.style = {}; this.attrs = {}; this.textContent = ''; this.handlers = {};
  this.value = ''; this.checked = false; this.disabled = false;
}
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
El.prototype.appendChild = function (k) { if (k.parentNode) k.parentNode.removeChild(k); this.children.push(k); k.parentNode = this; return k; };
El.prototype.insertBefore = function (k, ref) { if (k.parentNode) k.parentNode.removeChild(k); var i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); k.parentNode = this; return k; };
El.prototype.removeChild = function (k) { var i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parentNode = null; return k; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') this.style.cssText = String(v); };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.click = function () { if (this.disabled) return null; var out = null; (this.handlers.click || []).forEach(function (f) { out = f({ preventDefault: function () {} }); }); return out; };
function walk(el, fn) { if (fn(el)) return el; for (var i = 0; i < el.children.length; i++) { var r = walk(el.children[i], fn); if (r) return r; } return null; }
function each(el, fn) { fn(el); el.children.forEach(function (c) { each(c, fn); }); }
/* What a reader sees: an element's own text then its children's, with no space added between inline pieces. */
function raw(el) { var t = el.textContent || ''; el.children.forEach(function (c) { t += (/^(P|DIV|LI|H2|H3|OL|LABEL|BUTTON|INPUT)$/.test(c.tagName) ? ' ' : '') + raw(c); }); return t; }
function seen(el) { return raw(el).replace(/\s+/g, ' ').trim(); }
function inside(el, anc) { for (var p = el; p; p = p.parentNode) if (p === anc) return true; return false; }
function before(a, b, root) { var order = []; each(root, function (e) { order.push(e); }); return order.indexOf(a) >= 0 && order.indexOf(a) < order.indexOf(b); }
async function settle() { for (var i = 0; i < 12; i++) await Promise.resolve(); }

var SESSION = readFile('venueplay/app/vp-session.js'), FIRSTRUN = readFile('venueplay/app/vp-firstrun.js'), INDEX = readFile('venueplay/app/index.html');
var USER, AUTH_CALLS, CALLS, OPENED, STORE, HOSTS, IMG = [], SAVED = [], SESS = {};
function page(phone, over) {
  over = over || {};
  USER = { id: 'u1', email: 'owner@example.com', phone: phone || '' }; AUTH_CALLS = []; CALLS = []; OPENED = []; SAVED = []; SESS = {};
  HOSTS = over.hosts || [];
  var body = new El('body'), hdr = new El('header'); body.appendChild(hdr);
  var document = { body: body, createElement: function (t) { return new El(t); },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); },
    querySelector: function (sel) { return sel === 'header' ? hdr : null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} };
  var client = { auth: {
    getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1', user: { id: 'u1' } } } }); },
    getUser: function () { AUTH_CALLS.push({ fn: 'getUser' }); return Promise.resolve({ data: { user: { id: USER.id, email: USER.email, phone: USER.phone } } }); },
    updateUser: function (a) { AUTH_CALLS.push({ fn: 'updateUser', args: a }); return Promise.resolve({ data: { user: { id: 'u1' } }, error: null }); },
    verifyOtp: function (a) { AUTH_CALLS.push({ fn: 'verifyOtp', args: a }); return Promise.resolve({ data: { user: null }, error: { message: 'no' } }); } },
    from: function () { var b = { select: function () { return b; }, eq: function () { return b; }, maybeSingle: function () { return Promise.resolve({ data: null }); }, then: function (r) { return Promise.resolve({ data: [] }).then(r); } }; return b; } };
  STORE = {};
  var storage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); }, removeItem: function (k) { delete STORE[k]; } };
  /* The billing Worker, as far as the guide uses it. host-add answers as vpbAddHost does: ok with the venues,
     or its own refusal (a marketing login's mobile, 409). */
  var fetch = function (url, opts) {
    var c = { url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : null }; CALLS.push(c);
    var ans = { ok: true };
    if (/\/account\/screen-get$/.test(c.url)) ans = over.screenFail ? { error: 'offline' } : { ok: true, slides: [], logo_url: over.noLogo ? null : 'https://db/storage/v1/object/public/venue-logos/V1/old.png' };
    if (/\/account\/my-name$/.test(c.url)) ans = String(c.body.name || '').trim() ? { ok: true, name: String(c.body.name).trim() } : { error: 'Pop your name in first.' };
    if (/\/account\/logo-upload$/.test(c.url)) ans = /^data:image\/png;base64,TOOSMALL/.test(c.body.data) ? { error: 'That logo is only 40 by 40 pixels, too small to read on a TV. Use one at least 200 pixels wide.' } : { ok: true, url: 'https://db/storage/v1/object/public/venue-logos/V1/new.png' };
    if (/\/account\/card-link$/.test(c.url)) ans = over.card === false ? { ok: true, has_card: false, card_url: 'https://www.venueplay.com.au/add-card?f=F1&t=abc', rate: 3, seats: 60, monthly: 180 } : { ok: true, has_card: true, rate: 3, seats: 60, monthly: 180 };
    if (/\/account\/hosts$/.test(c.url)) ans = over.hostsFail ? { error: 'Could not reach venueplay.' } : { ok: true, hosts: HOSTS, venues: [{ id: 'V1', name: 'The Test Arms' }] };
    if (/\/account\/host-add$/.test(c.url)) ans = c.body.mobile === '+61400000009' ? { error: 'That mobile is already the marketing login at your venue. Use a different mobile for a host, or remove the marketing login first.' } : { ok: true, auth_user_id: 'h-new', venue_ids: c.body.venue_ids };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(ans); } });
  };
  var window = { location: { pathname: '/app/', search: '', origin: 'https://venueplay.com.au', reload: function () {} }, supabase: { createClient: function () { return client; } },
    localStorage: storage, sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, document: document, fetch: fetch };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', SESSION))(window, document, storage, window.sessionStorage, window.location, fetch);
  (new Function('window', FIRSTRUN))(window);
  var deps = { doc: document, storage: storage, fetch: fetch, client: client, VP: window.VP,
    setInterval: function () { return 1; }, clearInterval: function () {}, openUrl: function (u) { OPENED.push(u); },
    imageData: function (file) { IMG.push(file.name); return Promise.resolve(file.dataUrl); },
    saveSettings: function (id, patch) { SAVED.push({ id: id, patch: patch }); return over.saveFail ? Promise.reject(new Error('column setup_answers does not exist')) : Promise.resolve({}); },
    session: { getItem: function (k) { return k in SESS ? SESS[k] : null; }, setItem: function (k, v) { SESS[k] = String(v); } } };
  return { doc: document, body: body, FR: window.VPFirstRun, VP: window.VP, deps: deps };
}
/* A self sign-up two days old: its mobile on the login, the Terms ticked at checkout, a card at Stripe. */
function venue(over) { var v = { id: 'V1', name: 'The Test Arms', slug: 'the-test-arms', status: 'active', terms_required: false, created_at: new Date(Date.now() - 2 * 86400000).toISOString(), compliance_accepted_at: '2026-11-03T01:00:00Z', compliance_accepted_by: 'Sam' }; for (var k in (over || {})) v[k] = over[k]; return v; }
/* Their staff row's name: a real one by default (so the optional About you step is about the logo alone), or the
   "<venue> manager" placeholder the Worker writes at set up. */
var FULL_ANSWERS = { tvs: '1', nights: ['thu'], games: ['trivia'], name_ok: true };   // the wizard's questions already answered: those steps are left out
function ctxFor(role, v, name, answers) { return { role: role, venue: v || venue(), currentVenueId: 'V1', user: { id: 'u1', phone: USER ? USER.phone : '' }, staff: [{ venue_id: 'V1', role: role, display_name: name === undefined ? 'Sam Smith' : name }], settings: { setup_answers: answers === undefined ? FULL_ANSWERS : answers } }; }
function $(P, id) { return P.doc.getElementById(id); }
function T(P, id) { var e = $(P, id); return e ? seen(e) : ''; }
function lis(el) { var out = []; each(el, function (e) { if (e.tagName === 'LI') out.push(seen(e)); }); return out; }
function heading(el) { var h = walk(el, function (e) { return e.tagName === 'H3'; }); return h ? h.textContent : ''; }

(async function () {
  section('1. THE ORDER: the TV, then hosts, then a first test game');
  var P = page('61452510904');
  check('the steps run mobile, Terms, venue, games, TV, hosts, game, About you, card', P.FR.STEPS.join() === 'mobile,terms,venue,games,tv,hosts,game,account,card', P.FR.STEPS);
  var R = P.FR.open(ctxFor('owner'), P.deps); await R.ready; await settle();
  check('a self sign-up with its mobile, the Terms and a card on: exactly the TV, hosts and a first game, in that order', R.steps().join() === 'tv,hosts,game', R.steps());
  check('it opens on the TV, step 1 of 3, three dots', R.step() === 'tv' && T(P, 'vpFrCount') === 'Step 1 of 3' && $(P, 'vpFrDots').children.length === 3, T(P, 'vpFrCount'));
  var PC = page('61452510904', { card: false }); var RC = PC.FR.open(ctxFor('owner'), PC.deps); await RC.ready;
  check('a new venue with no card yet: the card step comes after the first game, last', RC.steps().join() === 'tv,hosts,game,card', RC.steps());

  section('2. THE TV: the screen code, then a Google TV or the TV\'s web browser');
  var code = P.VP.venueCode('the-test-arms');
  check('a venue with no join code of its own shows the derived code, the same one the console chip falls back to', T(P, 'vpFrTvCode') === code && /^[A-Z0-9]{6}$/.test(code), T(P, 'vpFrTvCode'));
  var PJ = page('61452510904'); var RJ = PJ.FR.open(ctxFor('owner', venue({ join_code: 'QX7K2P' })), PJ.deps); await RJ.ready;
  check('a venue with its own join code shows exactly that code (what the TV takes and the console shows)', T(PJ, 'vpFrTvCode') === 'QX7K2P', T(PJ, 'vpFrTvCode'));
  check('the code is read out one character at a time to a screen reader', $(PJ, 'vpFrTvCode').getAttribute('aria-label') === 'Your screen code Q X 7 K 2 P', $(PJ, 'vpFrTvCode').getAttribute('aria-label'));
  check('it says where else the code is: the console, beside Screen code (and the console has that chip)', /beside Screen code/.test(T(P, 'vpFrBody')) && /<i>Screen code<\/i><b id="roomCode">/.test(INDEX));
  var app = $(P, 'vpFrTvApp'), web = $(P, 'vpFrTvWeb');
  check('two ways in, "On a Google TV" first, then "Or in the TV\'s web browser"', !!app && !!web && heading(app) === 'On a Google TV' && heading(web) === "Or in the TV's web browser" && before(app, web, P.body), [heading(app), heading(web)]);
  var A = lis(app);
  check('Google TV: get the venueplay TV app from Google Play, open it, put in the screen code, in that order', A.length === 3 && A[0] === 'On the TV, open Google Play and get the venueplay TV app.' && A[1] === 'Open the app.' && A[2] === 'Put in your screen code.', A);
  var playA = walk(app, function (e) { return e.tagName === 'A'; });
  check('"venueplay TV app" is the link to its Google Play page, in a new tab', playA && playA.textContent === 'venueplay TV app' && playA.getAttribute('href') === 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv' && playA.getAttribute('target') === '_blank' && playA.getAttribute('rel') === 'noopener', playA && playA.attrs);
  var W = lis(web);
  check('web browser: venueplay.com.au/tv, put in the screen code, then go full screen and leave it running', W.length === 3 && /^Go to venueplay\.com\.au\/tv on the TV/.test(W[0]) && W[1] === 'Put in your screen code.' && W[2] === 'Go full screen and leave it running.', W);
  check('and the keep-it-uncovered tip follows', /Keep the venueplay screen full screen, or at least never covered by another window\./.test(T(P, 'vpFrBody')));
  var tvText = T(P, 'vpFrBody');
  check('no slug link anywhere on the step (Dean, 5 Nov: everywhere says venueplay.com.au/tv), no Copy button', tvText.indexOf('the-test-arms') === -1 && !/\/tv\?/.test(tvText) && !$(P, 'vpFrTvUrl') && !$(P, 'vpFrCopy'), tvText);
  check('never "search by venue name", never a .dev address', !/search[^.]*venue name/i.test(tvText) && !/\.dev\b|workers\.dev/.test(tvText));
  check('the slide preview is still there below', !!$(P, 'vpFrPreview') && before(web, $(P, 'vpFrPreview'), P.body));

  section('3. THE HOSTS: name and mobile, the Worker texts them their own sign-in link');
  var PH = page('61452510904', { hosts: [
    { auth_user_id: 'o', label: 'Owner', is_owner: true, role: 'manager', venue_ids: ['V1'] },
    { auth_user_id: 'h1', label: 'Jess Lee', role: 'host', venue_ids: ['V1'], mobile_last3: '123' },
    { auth_user_id: 'h2', label: 'Elsewhere Host', role: 'host', venue_ids: ['V9'], mobile_last3: '456' },
    { auth_user_id: 'm1', label: 'Mia Manager', role: 'manager', venue_ids: ['V1'] }] });
  var RH = PH.FR.open(ctxFor('owner'), PH.deps); await RH.ready; await RH.go('hosts'); await settle();
  check('step 2 of 3, "Add your hosts", and it says each host gets a text with their own sign-in link', T(PH, 'vpFrTitle') === 'Add your hosts' && T(PH, 'vpFrCount') === 'Step 2 of 3' && /we text them their own sign-in link/.test(T(PH, 'vpFrBody')), T(PH, 'vpFrBody'));
  var hl = CALLS.filter(function (c) { return /\/account\/hosts$/.test(c.url); })[0];
  check('it asks the billing Worker who is on, signed in, for this venue', hl && hl.opts.headers.Authorization === 'Bearer TOKEN-1' && hl.opts.headers['X-VP-Venue'] === 'V1', hl && hl.opts.headers);
  var rows = []; each($(PH, 'vpFrHostList'), function (e) { if (e.getAttribute('data-host') === '1') rows.push(seen(e)); });
  check('it lists the hosts already at THIS venue only (not the owner, a manager or another venue\'s host)', rows.length === 1 && /Jess Lee/.test(rows[0]) && /mobile ending 123/.test(rows[0]), rows);
  check('with a host already on, Next reads Next', $(PH, 'vpFrNext').textContent === 'Next', $(PH, 'vpFrNext').textContent);
  var P0 = page('61452510904'); var R0 = P0.FR.open(ctxFor('owner'), P0.deps); await R0.ready; await R0.go('hosts'); await settle();
  check('no hosts yet: it says so, says a venue that hosts itself can skip, and Next reads "Skip for now"', /No hosts yet\. If you host every night yourself, skip this\./.test(T(P0, 'vpFrHostList')) && $(P0, 'vpFrNext').textContent === 'Skip for now' && !$(P0, 'vpFrNext').disabled, T(P0, 'vpFrHostList'));
  var PE = page('61452510904', { hostsFail: true }); var RE = PE.FR.open(ctxFor('owner'), PE.deps); await RE.ready; await RE.go('hosts'); await settle();
  check('the host list will not load: the form still works (no error wall), the step can still be skipped', !!$(PE, 'vpFrHostAdd') && $(PE, 'vpFrNext').textContent === 'Skip for now', T(PE, 'vpFrBody'));
  function adds() { return CALLS.filter(function (c) { return /\/account\/host-add$/.test(c.url); }); }
  $(P0, 'vpFrHostMobile').value = '0412 345 678';
  await $(P0, 'vpFrHostAdd').click();
  check('no name: asked for it, nothing sent', /Type the host's name first/.test(T(P0, 'vpFrHostMsg')) && adds().length === 0, T(P0, 'vpFrHostMsg'));
  $(P0, 'vpFrHostName').value = 'Sam Smith'; $(P0, 'vpFrHostMobile').value = '07 5228 3667';
  await $(P0, 'vpFrHostAdd').click();
  check('a landline: refused (a host signs in by text), nothing sent', /not an Australian mobile/.test(T(P0, 'vpFrHostMsg')) && adds().length === 0, T(P0, 'vpFrHostMsg'));
  $(P0, 'vpFrHostMobile').value = '0412 345 678';
  var p = $(P0, 'vpFrHostAdd').click();
  check('while it is adding, the button cannot be tapped twice', $(P0, 'vpFrHostAdd').disabled === true);
  await p; await settle();
  var ad = adds()[0];
  check('it asks the billing Worker\'s Add a host route for THIS venue only: name, the mobile as +61, never all venues', ad && ad.body.label === 'Sam Smith' && ad.body.mobile === '+61412345678' && JSON.stringify(ad.body.venue_ids) === '["V1"]' && ad.body.all_venues === false && Object.keys(ad.body).sort().join() === 'all_venues,label,mobile,venue_ids', ad && ad.body);
  check('signed in, as this venue', ad && ad.opts.headers.Authorization === 'Bearer TOKEN-1' && ad.opts.headers['X-VP-Venue'] === 'V1');
  check('then says the host has been texted their sign-in link, by name', T(P0, 'vpFrHostMsg') === 'Done. We have texted Sam Smith their sign-in link. Add another, or tap Next.', T(P0, 'vpFrHostMsg'));
  rows = []; each($(P0, 'vpFrHostList'), function (e) { if (e.getAttribute('data-host') === '1') rows.push(seen(e)); });
  check('the new host is in the list with their mobile, the "No hosts yet" line is gone, the boxes are clear for the next', rows.length === 1 && /Sam Smith/.test(rows[0]) && /0412 345 678/.test(rows[0]) && $(P0, 'vpFrHostNone').style.display === 'none' && $(P0, 'vpFrHostName').value === '' && $(P0, 'vpFrHostMobile').value === '', rows);
  check('and Next now reads Next', $(P0, 'vpFrNext').textContent === 'Next');
  $(P0, 'vpFrHostName').value = 'Kim Two'; $(P0, 'vpFrHostMobile').value = '0400 000 009';
  await $(P0, 'vpFrHostAdd').click(); await settle();
  check('the Worker refuses one: its own words are shown, no row added', /already the marketing login at your venue/.test(T(P0, 'vpFrHostMsg')) && rows.length === 1 && $(P0, 'vpFrHostAdd').disabled === false, T(P0, 'vpFrHostMsg'));
  check('the page never texts anyone itself and never touches the owner\'s own login', AUTH_CALLS.every(function (a) { return a.fn !== 'updateUser' && a.fn !== 'verifyOtp'; }), AUTH_CALLS);
  var emailIn = walk($(P0, 'vpFrBody'), function (e) { return e.tagName === 'INPUT' && /email/i.test((e.getAttribute('type') || '') + (e.getAttribute('autocomplete') || '') + e.id); });
  check('a host is never asked for an email (hosts sign in by mobile)', !emailIn && !/e-?mail/i.test(T(P0, 'vpFrBody')));
  check('it says where to change hosts later: Account, then People', /Add or remove hosts any time under Account, then People\./.test(T(P0, 'vpFrBody')));

  section('4. A FIRST TEST GAME: trivia first');
  await R.go('game');
  check('step 3 of 3, a test game before the first real night, joining from their own phone', T(P, 'vpFrCount') === 'Step 3 of 3' && /Run a quick test game now, before your first real night/.test(T(P, 'vpFrBody')) && /join from your own phone using the QR code on the TV/.test(T(P, 'vpFrBody')), T(P, 'vpFrBody'));
  var tri = $(P, 'vpFrTrivia'), mus = $(P, 'vpFrMusical');
  check('trivia comes first and is the pink button; musical bingo second', before(tri, mus, P.body) && /FF1F8E/.test(tri.style.cssText) && !/FF1F8E/.test(mus.style.cssText) && tri.textContent === 'Open trivia', [tri.textContent, mus.textContent]);
  check('musical bingo is always "musical bingo", never "bingo" on its own', !/bingo/i.test(T(P, 'vpFrBody').replace(/musical bingo/gi, 'MB')), T(P, 'vpFrBody'));
  check('it is the last step here and reads Finish', $(P, 'vpFrNext').textContent === 'Finish');
  tri.click();
  check('Open trivia opens the trivia console for their venue', OPENED[0] === '/app/trivia/host.html?venue=the-test-arms', OPENED);

  section('5. READABLE AT 375px: nothing under 15px');
  var PR = page('', { card: false, noLogo: true }); var RR = PR.FR.open({ role: 'owner', venue: venue({ terms_required: true, compliance_accepted_at: null }), currentVenueId: 'V1', user: { id: 'u1', phone: '' }, staff: [{ venue_id: 'V1', role: 'owner', display_name: 'The Test Arms manager' }], settings: { setup_answers: {} } }, PR.deps);
  await RR.ready;
  var small = [], wide = [], seenSteps = [];
  for (var si = 0; si < RR.steps().length; si++) {
    var nm = RR.steps()[si]; await RR.go(nm); await settle(); seenSteps.push(nm);
    each($(PR, 'vpFirstRun'), function (e) {
      if (inside(e, $(PR, 'vpTermsCard') || {})) return;   // vp-session.js's card: lifted by the style below
      var css = e.getAttribute('style') || '', m, re = /font-size:\s*([\d.]+)px/g;
      while ((m = re.exec(css))) if (parseFloat(m[1]) < 15) small.push(nm + ' ' + (e.id || e.tagName) + ' ' + m[1]);
      var f = /(?:^|;)\s*font:\s*[^;]*?([\d.]+)px/.exec(css); if (f && parseFloat(f[1]) < 15) small.push(nm + ' ' + (e.id || e.tagName) + ' font ' + f[1]);
      var w = /(?:^|;)\s*(?:min-)?width:\s*([\d.]+)px/.exec(css); if (w && parseFloat(w[1]) > 343) wide.push(nm + ' ' + (e.id || e.tagName) + ' ' + w[1]);
    });
  }
  check('every step was drawn (mobile, Terms, venue, games, TV, hosts, game, About you, card)', seenSteps.join() === 'mobile,terms,venue,games,tv,hosts,game,account,card', seenSteps);
  check('no text in the guide is set under 15px on any step', small.length === 0, small);
  check('no fixed width wider than a 375px phone leaves (343px inside the 16px margins)', wide.length === 0, wide);
  check('the guide is one column, at most 480px wide, with 16px margins', /max-width:480px/.test($(PR, 'vpFirstRun').children.filter(function (c) { return c.tagName === 'DIV'; })[0].getAttribute('style')) && /padding:0 16px/.test($(PR, 'vpFirstRun').getAttribute('style')));
  var lift = $(PR, 'vpFrLift');
  check('the borrowed Terms card is lifted to 15px inside the guide on a phone (text, labels, buttons)', !!lift && lift.tagName === 'STYLE' && /@media \(max-width:600px\)/.test(lift.textContent) && ['p', 'label', 'span', 'button'].every(function (t) { return lift.textContent.indexOf('#vpFirstRun #vpTermsCard ' + t) >= 0; }) && /font-size:15px!important/.test(lift.textContent), lift && lift.textContent);
  check('the screen code itself is big (30px) and can be read across a bar', /font:800 30px/.test($(P, 'vpFrTvCode') ? $(P, 'vpFrTvCode').getAttribute('style') : '') || /font:800 30px/.test($(PJ, 'vpFrTvCode').getAttribute('style')));

  section('7. ABOUT YOU AND YOUR VENUE: two optional Account page questions, each only while it is empty (Dean, INBOX 24)');
  var PA = page('61452510904', { noLogo: true }); var RA = PA.FR.open(ctxFor('owner', venue(), 'The Test Arms manager'), PA.deps); await RA.ready;
  check('a new venue with the placeholder name and no logo: About you comes after the first game', RA.steps().join() === 'tv,hosts,game,account', RA.steps());
  await RA.go('account'); await settle();
  check('"About you and your venue", both optional, both questions there, and (the last step here) its button reads Finish', T(PA, 'vpFrTitle') === 'About you and your venue' && /Both are optional/.test(T(PA, 'vpFrBody')) && !!$(PA, 'vpFrMyName') && !!$(PA, 'vpFrLogoFile') && $(PA, 'vpFrNext').textContent === 'Finish' && !$(PA, 'vpFrNext').disabled, [T(PA, 'vpFrBody'), $(PA, 'vpFrNext').textContent]);
  check('the logo is picked with a guide-styled "Choose a logo file" button that opens the real file box', T(PA, 'vpFrLogoPick') === 'Choose a logo file' && $(PA, 'vpFrLogoPick').tagName === 'LABEL' && $(PA, 'vpFrLogoPick').getAttribute('for') === 'vpFrLogoFile' && /opacity:0/.test($(PA, 'vpFrLogoFile').getAttribute('style')));
  check('the logo box takes a PNG, WebP or JPEG and says a see-through PNG looks best on the TV', $(PA, 'vpFrLogoFile').getAttribute('accept') === 'image/png,image/webp,image/jpeg' && /shows on your TV between games\. A PNG with a see-through background looks best/.test(T(PA, 'vpFrLogoBox')));
  function sent(re) { return CALLS.filter(function (c) { return re.test(c.url); }); }
  await $(PA, 'vpFrNameSave').click();
  check('no name typed: asked for it, nothing sent', /Type your name first/.test(T(PA, 'vpFrNameMsg')) && sent(/\/account\/my-name$/).length === 0, T(PA, 'vpFrNameMsg'));
  $(PA, 'vpFrMyName').value = '  Alex   Rivera ';
  await $(PA, 'vpFrNameSave').click(); await settle();
  var mn = sent(/\/account\/my-name$/)[0];
  check('"Save my name" goes to /account/my-name (the route the name screen uses), tidied, signed in', mn && mn.body.name === 'Alex Rivera' && Object.keys(mn.body).join() === 'name' && mn.opts.headers.Authorization === 'Bearer TOKEN-1', mn && mn.body);
  check('then says it is saved, and "Skip for now" becomes Finish (the last step for a venue whose card is on)', /Saved\. You are Alex Rivera\./.test(T(PA, 'vpFrNameMsg')) && $(PA, 'vpFrNext').textContent === 'Finish', [T(PA, 'vpFrNameMsg'), $(PA, 'vpFrNext').textContent]);
  var lf = $(PA, 'vpFrLogoFile');
  lf.files = [{ name: 'menu.gif', type: 'image/gif', dataUrl: 'data:image/gif;base64,R0lG' }];
  await (lf.handlers.change[0])();
  check('a GIF is refused before anything is read or sent', /Use a PNG, WebP or JPEG image/.test(T(PA, 'vpFrLogoMsg')) && IMG.length === 0 && sent(/logo-upload$/).length === 0, T(PA, 'vpFrLogoMsg'));
  lf.files = [{ name: 'big.png', type: 'image/png', dataUrl: 'data:image/png;base64,' + new Array(1500000).join('A') }];
  await (lf.handlers.change[0])(); await settle();
  check('a logo over 1MB is refused on the page with the Worker\'s own limit, nothing sent', /too big\. Keep it to 1MB or less/.test(T(PA, 'vpFrLogoMsg')) && sent(/logo-upload$/).length === 0, T(PA, 'vpFrLogoMsg'));
  lf.files = [{ name: 'tiny.png', type: 'image/png', dataUrl: 'data:image/png;base64,TOOSMALLxx' }];
  await (lf.handlers.change[0])(); await settle();
  check('the Worker refuses one (too small for a TV): its own words are shown, no thumbnail', /too small to read on a TV/.test(T(PA, 'vpFrLogoMsg')) && $(PA, 'vpFrLogoThumb').style.display !== 'block', T(PA, 'vpFrLogoMsg'));
  lf.files = [{ name: 'logo.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo' }];
  await (lf.handlers.change[0])(); await settle();
  var lu = sent(/\/account\/logo-upload$/).pop();
  check('a PNG goes to /account/logo-upload for THIS venue, as the data URL the Account page sends', lu && lu.body.venue_id === 'V1' && lu.body.data === 'data:image/png;base64,iVBORw0KGgo' && Object.keys(lu.body).sort().join() === 'data,venue_id' && lu.opts.headers['X-VP-Venue'] === 'V1', lu && lu.body);
  check('then says it is on the TV and shows it', /Saved\. Your logo is on your TV now\./.test(T(PA, 'vpFrLogoMsg')) && $(PA, 'vpFrLogoThumb').getAttribute('src') === 'https://db/storage/v1/object/public/venue-logos/V1/new.png' && $(PA, 'vpFrLogoThumb').style.display === 'block', T(PA, 'vpFrLogoMsg'));
  var PK = page('61452510904', { noLogo: true, card: false }); var RK = PK.FR.open(ctxFor('owner', venue(), 'The Test Arms manager'), PK.deps); await RK.ready; await RK.go('account');
  check('as the last step its button reads Finish (it closes the guide); with the card step after it, "Skip for now"', RK.steps().join() === 'tv,hosts,game,account,card' && $(PK, 'vpFrNext').textContent === 'Skip for now', [RK.steps(), $(PK, 'vpFrNext').textContent]);
  $(PK, 'vpFrMyName').value = 'Jo Park'; await $(PK, 'vpFrNameSave').click(); await settle();
  check('and once a name is saved there, "Skip for now" becomes Next', /Saved\. You are Jo Park\./.test(T(PK, 'vpFrNameMsg')) && $(PK, 'vpFrNext').textContent === 'Next', [T(PK, 'vpFrNameMsg'), $(PK, 'vpFrNext').textContent]);
  var PL = page('61452510904', { noLogo: true }); var RL = PL.FR.open(ctxFor('owner'), PL.deps); await RL.ready; await RL.go('account');
  check('their real name already on (it is not "<venue> manager"): only the logo is asked', !$(PL, 'vpFrMyName') && !!$(PL, 'vpFrLogoFile'), RL.steps());
  var PN = page('61452510904'); var RN = PN.FR.open(ctxFor('owner', venue(), ''), PN.deps); await RN.ready; await RN.go('account');
  check('a logo already on and no name at all: only the name is asked', !!$(PN, 'vpFrMyName') && !$(PN, 'vpFrLogoFile'), RN.steps());
  check('a real name and a logo: no About you step at all (nothing to ask)', R.steps().indexOf('account') === -1 && R.go('account') === null, R.steps());
  var PF2 = page('61452510904', { screenFail: true }); var RF2 = PF2.FR.open(ctxFor('owner'), PF2.deps); await RF2.ready;
  check('the logo read fails: the logo is still offered (optional), the guide still opens on the TV', RF2.steps().indexOf('account') >= 0 && RF2.step() === 'tv', RF2.steps());
  check('it never asks for an address, a game night or anything the Account page does not store', !/suburb|address|game night|which night/i.test(T(PA, 'vpFrBody')));

  section('8. THE WIZARD ASKS FIRST: the venue name, how many TVs, which nights, which games (Dean, INBOX 44a)');
  var PW = page('61452510904'); var RW = PW.FR.open(ctxFor('owner', venue(), undefined, {}), PW.deps); await RW.ready; await settle();
  check('a new venue that has answered nothing: the questions come first, then the TV, hosts and the test game', RW.steps().join() === 'venue,games,tv,hosts,game' && RW.step() === 'venue', RW.steps());
  check('"About your venue", everything optional, so Next reads "Skip for now"', T(PW, 'vpFrTitle') === 'About your venue' && /Every one is optional/.test(T(PW, 'vpFrBody')) && $(PW, 'vpFrNext').textContent === 'Skip for now', T(PW, 'vpFrBody'));
  check('it shows the venue name as saved and asks if it is right', T(PW, 'vpFrVenueName') === 'The Test Arms' && /Is this your venue's name\?/.test(T(PW, 'vpFrNameCheck')) && T(PW, 'vpFrNameYes') === "Yes, that's right" && T(PW, 'vpFrNameNo') === 'Not quite');
  check('nothing is saved until they answer', SAVED.length === 0 && CALLS.filter(function (c) { return /help\/venue\/ticket$/.test(c.url); }).length === 0);
  function lastSaved() { return SAVED[SAVED.length - 1]; }
  $(PW, 'vpFrNameYes').click(); await settle();
  check('"Yes, that\'s right" is kept for THIS venue through the page\'s own saveSettings, only as setup_answers', lastSaved() && lastSaved().id === 'V1' && Object.keys(lastSaved().patch).join() === 'setup_answers' && JSON.stringify(lastSaved().patch.setup_answers) === '{"name_ok":true}', lastSaved());
  check('and Next reads Next', $(PW, 'vpFrNext').textContent === 'Next' && /confirmed/.test(T(PW, 'vpFrNameCheckMsg')));
  check('the TV question: 1, 2, 3 or 4 or more, one choice', T(PW, 'vpFrChips-tvs') === '1 TV 2 TVs 3 TVs 4 or more' && /How many TVs will show venueplay\?/.test(T(PW, 'vpFrTvsBox')));
  $(PW, 'vpFrChip-tvs-2').click(); await settle();
  check('two TVs: saved, and that chip is the one pressed', JSON.stringify(lastSaved().patch.setup_answers) === '{"tvs":"2","name_ok":true}' && $(PW, 'vpFrChip-tvs-2').getAttribute('aria-pressed') === 'true' && $(PW, 'vpFrChip-tvs-1').getAttribute('aria-pressed') === 'false', lastSaved());
  $(PW, 'vpFrChip-tvs-3').click();
  check('a second choice replaces the first (one TV count)', $(PW, 'vpFrChip-tvs-3').getAttribute('aria-pressed') === 'true' && $(PW, 'vpFrChip-tvs-2').getAttribute('aria-pressed') === 'false');
  check('the nights question: Mon to Sun in order, any number, with the "changes week to week" note', T(PW, 'vpFrChips-nights') === 'Mon Tue Wed Thu Fri Sat Sun' && /Leave it blank if it changes week to week/.test(T(PW, 'vpFrNightsBox')));
  $(PW, 'vpFrChip-nights-fri').click(); $(PW, 'vpFrChip-nights-thu').click(); await settle();
  check('Fri then Thu: kept in week order, Thu and Fri', JSON.stringify(lastSaved().patch.setup_answers.nights) === '["thu","fri"]', lastSaved());
  $(PW, 'vpFrChip-nights-fri').click(); await settle();
  check('tapping a night again takes it off', JSON.stringify(lastSaved().patch.setup_answers.nights) === '["thu"]' && $(PW, 'vpFrChip-nights-fri').getAttribute('aria-pressed') === 'false');
  check('the answers are also kept on this device, so nothing is lost without the database column', JSON.parse(STORE['vpFirstRun:V1']).answers.tvs === '3' && JSON.stringify(JSON.parse(STORE['vpFirstRun:V1']).answers.nights) === '["thu"]', STORE['vpFirstRun:V1']);
  $(PW, 'vpFrNameNo').click();
  check('"Not quite" opens a box for the right name', $(PW, 'vpFrNameFix').style.display === 'block');
  await $(PW, 'vpFrNameSend').click();
  check('nothing typed: asked for it, no ticket', /Type what it should say first/.test(T(PW, 'vpFrNameCheckMsg')) && CALLS.filter(function (c) { return /help\/venue\/ticket$/.test(c.url); }).length === 0, T(PW, 'vpFrNameCheckMsg'));
  $(PW, 'vpFrNameNew').value = ' The Test   Arms Hotel ';
  await $(PW, 'vpFrNameSend').click(); await settle();
  var tkt = CALLS.filter(function (c) { return /help\/venue\/ticket$/.test(c.url); })[0];
  check('the right name goes to HQ as a help desk ticket for this venue (no route renames a venue), signed in', tkt && tkt.body.subject === 'Please correct my venue name' && tkt.body.venue_id === 'V1' && /It should say The Test Arms Hotel\./.test(tkt.body.message) && tkt.opts.headers.Authorization === 'Bearer TOKEN-1', tkt && tkt.body);
  check('and it says we will change it', /We will change it to The Test Arms Hotel/.test(T(PW, 'vpFrNameCheckMsg')));
  check('the venue row itself is never written from the page', SAVED.every(function (x) { return Object.keys(x.patch).join() === 'setup_answers'; }));

  await RW.next();
  check('step 2: "Which games do you play?", the five games, trivia first, musical bingo spelled out', T(PW, 'vpFrTitle') === 'Which games do you play?' && T(PW, 'vpFrChips-games') === 'Trivia Musical bingo Bingo Raffles Members draws', T(PW, 'vpFrChips-games'));
  check('optional: Next reads "Skip for now"', $(PW, 'vpFrNext').textContent === 'Skip for now');
  $(PW, 'vpFrChip-games-bingo').click(); $(PW, 'vpFrChip-games-trivia').click(); $(PW, 'vpFrChip-games-raffles').click(); $(PW, 'vpFrChip-games-musical').click(); await settle();
  check('chosen games are saved in the same order as listed (trivia, musical bingo, bingo, raffles) and Next reads Next', JSON.stringify(lastSaved().patch.setup_answers.games) === '["trivia","musical","bingo","raffles"]' && $(PW, 'vpFrNext').textContent === 'Next', lastSaved());
  await RW.next();
  check('with three TVs the TV step says so, and that every TV uses the same screen code', /You said 3 TVs\. Do the steps below on each TV, with the same screen code\./.test(T(PW, 'vpFrManyTvs')), T(PW, 'vpFrBody'));
  await RW.go('game'); await settle();
  var gn = T(PW, 'vpFrGameNotes');
  check('the test game step points at the Account pages for their games and their nights (raffles: Draws; bingo: Game settings; Thu)', /Raffles and members draws are set up under Account, then Draws\./.test(gn) && /For bingo, add your permit details under Account, then Game settings\./.test(gn) && /Your game nights: Thu\. Run this test before the first one\./.test(gn), gn);
  check('musical bingo is never listed with bingo or a permit (it is chosen here, and the notes never mention it)', !/musical/i.test(gn) && gn.split('permit').length === 2, gn);
  check('trivia is still the first, pink button', before($(PW, 'vpFrTrivia'), $(PW, 'vpFrMusical'), PW.body) && /FF1F8E/.test($(PW, 'vpFrTrivia').style.cssText));
  var P1 = page('61452510904'); var R1 = P1.FR.open(ctxFor('owner', venue(), undefined, { tvs: '1', nights: [], games: ['musical'], name_ok: true }), P1.deps); await R1.ready;
  check('answers already given are left out: only the nights are unanswered, so only the venue step stays', R1.steps().join() === 'venue,tv,hosts,game' && R1.steps().indexOf('games') === -1, R1.steps());
  await R1.go('tv'); check('one TV: no several-TVs line', !$(P1, 'vpFrManyTvs'));
  await R1.go('game');
  check('a venue that plays only musical bingo is pointed at no permit, no draws and no game nights', !$(P1, 'vpFrGameNotes'), T(P1, 'vpFrGameNotes'));
  var PS2 = page('61452510904', { saveFail: true }); var RS2 = PS2.FR.open(ctxFor('owner', venue(), undefined, {}), PS2.deps); await RS2.ready;
  $(PS2, 'vpFrChip-tvs-2').click(); await settle();
  check('the database column is not there yet (migration 163 not run): the guide still works, shows no error, keeps the answer on this device', JSON.parse(STORE['vpFirstRun:V1']).answers.tvs === '2' && $(PS2, 'vpFrNext').textContent === 'Next' && !/error|could not|column/i.test(T(PS2, 'vpFrBody')), T(PS2, 'vpFrBody'));
  var dirty = P.FR.cleanAnswers({ tvs: '9', nights: ['thu', 'xx', '<b>'], games: 'trivia', name_ok: 'yes', evil: '<script>' });
  check('only the known keys and values can be kept (a TV count of 9, a night called xx, a string for games, anything extra are dropped)', JSON.stringify(dirty) === '{"nights":["thu"]}', dirty);
  check('the Account page\'s saved answers win, and this device fills the gaps', JSON.stringify(P.FR.answersFor({ settings: { setup_answers: { tvs: '2', games: ['trivia'] } } }, { answers: { tvs: '4', nights: ['sat'] } })) === '{"tvs":"2","games":["trivia"],"nights":["sat"]}');

  section('9. ONE MORE QUESTION ON A LATER SIGN-IN: never more than one, always skippable (Dean, INBOX 46)');
  function later(answers, over) { var Q = page('61452510904', over); var ctx = ctxFor('owner', over && over.venue || venue(), over && over.name, answers); STORE['vpFirstRun:V1'] = JSON.stringify({ step: 'tv', done: true }); return { P: Q, ctx: ctx }; }
  var L = later({}, { noLogo: true });
  var k1 = await L.P.FR.ask(L.ctx, L.P.deps);
  check('a new venue, guide done, nothing answered: ONE question, "Which games do you play?", as a sheet over the console', k1 === 'games' && T(L.P, 'vpAsk') !== '' && /One quick question/.test(T(L.P, 'vpAsk')) && /Which games do you play\?/.test(T(L.P, 'vpAsk')) && $(L.P, 'vpAsk').getAttribute('role') === 'dialog', k1);
  check('with Done and Not now, both at least 44px tall, and no text under 15px', T(L.P, 'vpAskDone') === 'Done' && T(L.P, 'vpAskLater') === 'Not now' && /min-height:44px/.test($(L.P, 'vpAskDone').style.cssText) && /min-height:44px/.test($(L.P, 'vpAskLater').style.cssText) && (function () { var bad = []; each($(L.P, 'vpAsk'), function (e) { var m, re = /font-size:\s*([\d.]+)px/g, css = e.getAttribute('style') || ''; while ((m = re.exec(css))) if (parseFloat(m[1]) < 15) bad.push(m[1]); }); return !bad.length; })());
  var k2 = await L.P.FR.ask(L.ctx, L.P.deps);
  check('asked again in the same sign-in: nothing (never more than one a sign-in)', k2 === '' && walk(L.P.body, function (e) { return e.id === 'vpAsk'; }) !== null && (function () { var n = 0; each(L.P.body, function (e) { if (e.id === 'vpAsk') n++; }); return n === 1; })(), k2);
  $(L.P, 'vpFrChip-games-musical') || 0;
  $(L.P, 'vpFrChip-games-trivia').click(); await settle();
  check('a tap is saved to this venue at once', lastSaved() && JSON.stringify(lastSaved().patch.setup_answers) === '{"games":["trivia"]}', lastSaved());
  $(L.P, 'vpAskDone').click();
  check('Done closes it', !$(L.P, 'vpAsk'));
  SESS = {};
  var L2 = { ctx: ctxFor('owner', venue(), undefined, { games: ['trivia'] }) };
  var k3 = await L.P.FR.ask(L2.ctx, L.P.deps);
  check('the next sign-in asks the NEXT thing: which nights', k3 === 'nights' && /Which nights do you run games\?/.test(T(L.P, 'vpAsk')), k3);
  $(L.P, 'vpAskLater').click(); SESS = {};
  check('"Not now" closes it, sends nothing, and the day after it asks again', !$(L.P, 'vpAsk') && (await L.P.FR.ask(L2.ctx, L.P.deps)) === 'nights');
  $(L.P, 'vpAskLater').click(); SESS = {};
  var k4 = await L.P.FR.ask(L2.ctx, L.P.deps);
  check('skipped twice: never asked again, so the next question (how many TVs) comes instead', k4 === 'tvs' && JSON.parse(STORE['vpAsk:V1']).skips.nights === 2, [k4, STORE['vpAsk:V1']]);
  $(L.P, 'vpAskLater').click(); SESS = {};
  var L3 = await L.P.FR.ask(ctxFor('owner', venue({ logo_url: null }), undefined, { tvs: '1', nights: ['thu'], games: ['trivia'] }), L.P.deps);
  check('with the questions answered or skipped, a venue with no logo is asked for it, and "Add it" opens the guide on that step', L3 === 'logo' && T(L.P, 'vpAskDone') === 'Add it', L3);
  $(L.P, 'vpAskDone').click(); await settle();
  check('the guide opens on About you (its own step does the upload)', !!$(L.P, 'vpFirstRun') && JSON.parse(STORE['vpFirstRun:V1']).step === 'account', STORE['vpFirstRun:V1']);
  function none(why, ctx, setup) { return async function () { var Q = page('61452510904'); if (setup) setup(Q); else STORE['vpFirstRun:V1'] = JSON.stringify({ step: 'tv', done: true }); var r = await Q.FR.ask(ctx, Q.deps); check(why, r === '' && !$(Q, 'vpAsk'), r); }; }
  await none('the guide itself is still due: no question on top of it', ctxFor('owner', venue(), undefined, {}), function () { STORE = {}; })();
  await none('a venue that is not new (60 days old, a live client): never asked', ctxFor('owner', venue({ created_at: new Date(Date.now() - 60 * 86400000).toISOString() }), undefined, {}))();
  await none('a host is never asked', ctxFor('host', venue(), undefined, {}))();
  await none('everything answered, a logo on, a real name: nothing to ask', ctxFor('owner', venue({ logo_url: 'https://db/l.png' }), undefined, FULL_ANSWERS))();
  var wordsAsk = (function () { var out = ''; var Q = page('61452510904'); STORE['vpFirstRun:V1'] = JSON.stringify({ step: 'tv', done: true }); return Q.FR.ask(ctxFor('owner', venue(), undefined, {}), Q.deps).then(function () { return seen(Q.body); }); })();
  var wa = await wordsAsk;
  check('the question reads in lowercase venueplay with no dash', !/VenuePlay/.test(wa) && !/[\u2013\u2014]/.test(wa), wa);

  section('10. THE ACCOUNT PAGE CARD, THE CONSOLE WIRING AND MIGRATION 163');
  var d1 = P.FR.describe({ tvs: '2', nights: ['fri', 'thu'], games: ['raffles', 'trivia', 'bingo'] }), d2 = P.FR.describe({ tvs: '4' }), d3 = P.FR.describe({});
  check('describe(): the answers in words, in the order the guide lists them', d1.tvs === '2 TVs' && d1.nights === 'Thu and Fri' && d1.games === 'Trivia, Bingo and Raffles' && d2.tvs === '4 or more TVs' && d3.tvs === '' && d3.nights === '' && d3.games === '', [d1, d2, d3]);
  var BILL = readFile('venueplay/app/billing.html');
  function liftFn(src, name) { var i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('cannot find ' + name); var dd = 0, k = src.indexOf('{', i); do { if (src[k] === '{') dd++; else if (src[k] === '}') dd--; k++; } while (dd > 0 && k < src.length); return src.slice(i, k); }
  function runAbout(rows, fail) {
    var body = new El('div'), wrap = new El('div'); wrap.style.display = 'none';
    var els = { aboutVenue: body, aboutVenueWrap: wrap }, asked = [];
    var fakeVP = { getClient: function () { var b = { select: function () { return b; }, in: function (c, ids) { asked.push([c, ids]); return fail ? Promise.reject(new Error('x')) : Promise.resolve(rows); } }; return { from: function (t) { asked.push(t); return b; } }; } };
    var doc = { createElement: function (t) { return new El(t); } };
    var fn = (new Function('$', 'VP', 'document', 'window', 'VPFirstRun', 'esc', liftFn(BILL, 'renderAbout') + '\nreturn renderAbout;'))(function (id) { return els[id]; }, fakeVP, doc, { VPFirstRun: P.FR }, P.FR, function (x) { return String(x); });
    fn([{ id: 'V1', name: 'The Test Arms' }, { id: 'V2', name: 'The Other Arms' }]);
    return { body: body, wrap: wrap, asked: asked };
  }
  var ab = runAbout({ data: [{ venue_id: 'V1', setup_answers: { tvs: '2', nights: ['thu', 'fri'], games: ['trivia', 'raffles'] } }], error: null });
  await settle();
  check('the Account page card reads vp_venue_settings.setup_answers for the account\'s venues and shows it', ab.asked[0] === 'vp_venue_settings' && ab.asked[1][0] === 'venue_id' && ab.asked[1][1].join() === 'V1,V2' && ab.wrap.style.display === '', ab.asked);
  var abText = ab.body.children.map(function (r) { return r.innerHTML.replace(/<\/(b|small)>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }).join(' | ');
  check('one row a venue: its answers in words, or "Not filled in yet"', abText === 'The Test Arms 2 TVs \u00b7 Games on Thu and Fri \u00b7 Trivia and Raffles | The Other Arms Not filled in yet', abText);
  var ab2 = runAbout({ data: [], error: { message: 'column setup_answers does not exist' } }); await settle();
  var ab3 = runAbout(null, true); await settle();
  check('before migration 163 (the read fails or errors) the card stays hidden and says nothing', ab2.wrap.style.display === 'none' && ab3.wrap.style.display === 'none' && ab2.body.children.length === 0 && ab3.body.children.length === 0);
  check('billing.html loads vp-firstrun.js after vp-session.js and has the card on the Game settings tab', BILL.indexOf('<script src="vp-firstrun.js"></script>') > BILL.indexOf('<script src="vp-session.js"></script>') && /<div id="aboutVenueWrap"[\s\S]*?About your venue[\s\S]*?<div class="label">Player data/.test(BILL) && /renderAbout\(d\.venues\);/.test(BILL));
  check('the card tells them how to change an answer', /To change an answer, open Setup guide at the top of the console\./.test(BILL));
  check('index.html asks the one later question after the Terms card, never blocking, only when VPFirstRun.ask exists', INDEX.indexOf('VPFirstRun.ask(__ctx') > INDEX.indexOf('VP.termsCard(__ctx);   // section 6') && /VPFirstRun\.ask &&/.test(INDEX) && /onClose:function\(\)\{\}/.test(INDEX.slice(INDEX.indexOf('VPFirstRun.ask(__ctx'), INDEX.indexOf('VPFirstRun.ask(__ctx') + 200)));
  var MIG = readFile('venueplay-backend/supabase/venueplay-163-setup-answers.sql'), MIGS = readFile('venueplay-backend/supabase/MIGRATIONS.md');
  var migCode = MIG.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
  check('migration 163 adds only vp_venue_settings.setup_answers (a jsonb object, 2,000 characters at most), safe to run twice', /ADD COLUMN IF NOT EXISTS setup_answers jsonb NOT NULL DEFAULT '\{\}'::jsonb/.test(migCode) && /jsonb_typeof\(setup_answers\) = 'object' AND length\(setup_answers::text\) <= 2000\)/.test(migCode) && /IF NOT EXISTS \(SELECT 1 FROM pg_constraint/.test(migCode));
  check('and no policy, grant, function or trigger (so RLS-BASELINE.json does not change)', !/create\s+(or replace\s+)?(policy|function|trigger)|\bgrant\b|\brevoke\b|alter\s+policy/i.test(migCode), migCode);
  check('it says NOT RUN and has a rollback; MIGRATIONS.md lists it as 163 with the same words', /NOT RUN/.test(MIG) && /Rollback:/.test(MIG) && /DROP COLUMN IF EXISTS setup_answers/.test(MIG) && /venueplay-163-setup-answers\.sql/.test(MIGS) && /NOT RUN/.test(MIGS.slice(MIGS.indexOf('venueplay-163-setup-answers.sql'))));
  check('the keys the page keeps are exactly the ones the migration documents', /"tvs".*"nights".*"games".*"name_ok"/s.test(MIG.replace(/\n--\s*/g, ' ')) || (MIG.indexOf('"tvs"') > 0 && MIG.indexOf('"nights"') > 0 && MIG.indexOf('"games"') > 0 && MIG.indexOf('"name_ok"') > 0));

  section('6. THE WORDS');
  var words = [P, PJ, PH, P0, PR, PA, PW].map(function (q) { return seen(q.body); }).join(' ') + ' ' + FIRSTRUN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('lowercase venueplay in everything it says (never VenuePlay)', !/VenuePlay|Venueplay|VENUEPLAY/.test(words));
  check('no em dash or en dash, never "roster", never "the ACT"', !/[–—]/.test(words) && !/roster/i.test(words) && !/\bthe ACT\b/.test(words));

  if (bad) throw new Error('first-run guide: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
