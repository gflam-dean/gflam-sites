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
var USER, AUTH_CALLS, CALLS, OPENED, STORE, HOSTS;
function page(phone, over) {
  over = over || {};
  USER = { id: 'u1', email: 'owner@example.com', phone: phone || '' }; AUTH_CALLS = []; CALLS = []; OPENED = [];
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
    if (/\/account\/screen-get$/.test(c.url)) ans = { ok: true, slides: [] };
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
    setInterval: function () { return 1; }, clearInterval: function () {}, openUrl: function (u) { OPENED.push(u); } };
  return { doc: document, body: body, FR: window.VPFirstRun, VP: window.VP, deps: deps };
}
/* A self sign-up two days old: its mobile on the login, the Terms ticked at checkout, a card at Stripe. */
function venue(over) { var v = { id: 'V1', name: 'The Test Arms', slug: 'the-test-arms', status: 'active', terms_required: false, created_at: new Date(Date.now() - 2 * 86400000).toISOString(), compliance_accepted_at: '2026-11-03T01:00:00Z', compliance_accepted_by: 'Sam' }; for (var k in (over || {})) v[k] = over[k]; return v; }
function ctxFor(role, v) { return { role: role, venue: v || venue(), currentVenueId: 'V1', user: { id: 'u1', phone: USER ? USER.phone : '' }, staff: [{ venue_id: 'V1', role: role }] }; }
function $(P, id) { return P.doc.getElementById(id); }
function T(P, id) { var e = $(P, id); return e ? seen(e) : ''; }
function lis(el) { var out = []; each(el, function (e) { if (e.tagName === 'LI') out.push(seen(e)); }); return out; }
function heading(el) { var h = walk(el, function (e) { return e.tagName === 'H3'; }); return h ? h.textContent : ''; }

(async function () {
  section('1. THE ORDER: the TV, then hosts, then a first test game');
  var P = page('61452510904');
  check('the steps run mobile, Terms, TV, hosts, game, card', P.FR.STEPS.join() === 'mobile,terms,tv,hosts,game,card', P.FR.STEPS);
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
  var PR = page('', { card: false }); var RR = PR.FR.open({ role: 'owner', venue: venue({ terms_required: true, compliance_accepted_at: null }), currentVenueId: 'V1', user: { id: 'u1', phone: '' }, staff: [{ venue_id: 'V1', role: 'owner' }] }, PR.deps);
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
  check('every step was drawn (mobile, Terms, TV, hosts, game, card)', seenSteps.join() === 'mobile,terms,tv,hosts,game,card', seenSteps);
  check('no text in the guide is set under 15px on any step', small.length === 0, small);
  check('no fixed width wider than a 375px phone leaves (343px inside the 16px margins)', wide.length === 0, wide);
  check('the guide is one column, at most 480px wide, with 16px margins', /max-width:480px/.test($(PR, 'vpFirstRun').children.filter(function (c) { return c.tagName === 'DIV'; })[0].getAttribute('style')) && /padding:0 16px/.test($(PR, 'vpFirstRun').getAttribute('style')));
  var lift = $(PR, 'vpFrLift');
  check('the borrowed Terms card is lifted to 15px inside the guide on a phone (text, labels, buttons)', !!lift && lift.tagName === 'STYLE' && /@media \(max-width:600px\)/.test(lift.textContent) && ['p', 'label', 'span', 'button'].every(function (t) { return lift.textContent.indexOf('#vpFirstRun #vpTermsCard ' + t) >= 0; }) && /font-size:15px!important/.test(lift.textContent), lift && lift.textContent);
  check('the screen code itself is big (30px) and can be read across a bar', /font:800 30px/.test($(P, 'vpFrTvCode') ? $(P, 'vpFrTvCode').getAttribute('style') : '') || /font:800 30px/.test($(PJ, 'vpFrTvCode').getAttribute('style')));

  section('6. THE WORDS');
  var words = [P, PJ, PH, P0, PR].map(function (q) { return seen(q.body); }).join(' ') + ' ' + FIRSTRUN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('lowercase venueplay in everything it says (never VenuePlay)', !/VenuePlay|Venueplay|VENUEPLAY/.test(words));
  check('no em dash or en dash, never "roster", never "the ACT"', !/[–—]/.test(words) && !/roster/i.test(words) && !/\bthe ACT\b/.test(words));

  if (bad) throw new Error('first-run guide: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
