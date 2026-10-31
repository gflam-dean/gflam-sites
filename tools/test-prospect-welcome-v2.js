/* THE PROSPECT FLOW, VERSION 2, RUN AND NOT WORD-SEARCHED (Dean, 28 Oct 2026).

   "an email that goes to the customer... on a delay, so they don't get it straight away... just a link:
   hey, I've set you up an account. Click here to access it, and then it actually asks them to add their
   mobile number and then to confirm the T&Cs and then it walks through everything."

     1. THE FIRST RUN (venueplay/app/vp-firstrun.js, in a small fake page with the REAL vp-session.js for
        the Terms card): who gets it, the five steps in order with their progress dots, the mobile goes on
        the login ONLY after the texted code is verified (Auth's phone_change), the Terms step waits for
        the tick, the exact TV address with Copy and the slide preview, the game buttons open that
        console for their venue, the card link and price, "Please call me", progress kept per venue,
        Close and reopen; and index.html opens it before anything else for a prospect venue
     2. THE DELAYED EMAIL on the REAL billing Worker (tools/rig-billing-worker.js): booked with Resend
        for HQ's delay (90 by default, 0 sends now, out of range refused before anything is made), its
        sign-in link's 14 days starting when it goes, HQ's list, Cancel (Resend cancels, the link is
        retired) and Send now (the booked one cancelled, a new one at once with a NEW link), both refused
        once the minute has passed, by a staff admin, or when Resend says no; before migration 124 it is
        still booked and HQ is told it cannot change it
     3. "PLEASE CALL ME": the exact request the first run makes, through the real /help/venue/ticket

   Run from the repo root:  jsc tools/test-prospect-welcome-v2.js */
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
function allText(el) { var t = el.textContent || ''; el.children.forEach(function (c) { t += ' ' + allText(c); }); return t.replace(/\s+/g, ' ').trim(); }
function inDoc(el, body) { for (var p = el; p; p = p.parentNode) if (p === body) return true; return false; }

var SESSION = readFile('venueplay/app/vp-session.js'), FIRSTRUN = readFile('venueplay/app/vp-firstrun.js');
var USER, AUTH_CALLS, CALLS, OPENED, CLIP, TIMERS, STORE;
function page(phone) {
  USER = { id: 'u1', email: 'cazreitop@gmail.com', phone: phone || '' }; AUTH_CALLS = []; CALLS = []; OPENED = []; CLIP = []; TIMERS = [];
  var body = new El('body'), wrap = new El('div'); wrap.className = 'wrap'; body.appendChild(wrap);
  var hdr = new El('header'); hdr.className = 'header'; body.insertBefore ? body.insertBefore(hdr, wrap) : body.appendChild(hdr);   // the console's sticky header (Help, Setup guide, Account, Sign out)
  var document = { body: body, createElement: function (t) { return new El(t); },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); },
    querySelector: function (sel) { var c = sel.replace(/^\./, ''); return walk(body, function (e) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }); },
    querySelectorAll: function () { return []; }, addEventListener: function () {} };
  /* Supabase Auth as it behaves: updateUser({phone}) texts a code and leaves the login's phone as it was
     (the new number is only PENDING); verifyOtp(type phone_change) with the right code is what puts it on. */
  var pendingPhone = '';
  var client = { auth: {
    getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1', user: { id: 'u1' } } } }); },
    getUser: function () { AUTH_CALLS.push({ fn: 'getUser' }); return Promise.resolve({ data: { user: { id: USER.id, email: USER.email, phone: USER.phone } } }); },
    updateUser: function (a) { AUTH_CALLS.push({ fn: 'updateUser', args: a }); if (a.phone === '+61400000009') return Promise.resolve({ error: { message: 'Phone number already registered by another user' } }); pendingPhone = a.phone; return Promise.resolve({ data: { user: { id: 'u1', phone: USER.phone } }, error: null }); },
    verifyOtp: function (a) { AUTH_CALLS.push({ fn: 'verifyOtp', args: a });
      if (a.type === 'phone_change' && a.phone === pendingPhone && a.token === '123456') { USER.phone = pendingPhone.replace('+', ''); return Promise.resolve({ data: { user: { id: 'u1', phone: USER.phone } }, error: null }); }
      return Promise.resolve({ data: { user: null }, error: { message: 'Token has expired or is invalid' } }); } },
    from: function () { var b = { select: function () { return b; }, eq: function () { return b; }, maybeSingle: function () { return Promise.resolve({ data: null }); }, then: function (r) { return Promise.resolve({ data: [] }).then(r); } }; return b; } };
  STORE = {};
  var storage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); }, removeItem: function (k) { delete STORE[k]; } };
  var fetch = function (url, opts) {
    var c = { url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : null }; CALLS.push(c);
    var ans = { ok: true };
    if (/\/account\/screen-get$/.test(c.url)) ans = { ok: true, slides: [{ image_url: 'https://db/storage/v1/object/public/venue-ads/V1/a.png', seconds: 8 }, { image_url: 'https://db/storage/v1/object/public/venue-ads/V1/b.jpg', seconds: 8 }] };
    if (/\/account\/card-link$/.test(c.url)) ans = { ok: true, has_card: false, card_url: 'https://www.venueplay.com.au/add-card?f=F1&t=abc', rate: 2.5, seats: 60, monthly: 150, ends_words: 'Thu 26 Nov' };
    if (/\/help\/venue\/ticket$/.test(c.url)) ans = { ok: true, ticket_no: 1007 };
    if (/\/account\/compliance-accept$/.test(c.url)) ans = { ok: true, compliance_accepted_at: '2026-10-28T02:00:00.000Z', compliance_accepted_by: 'Amit' };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(ans); } });
  };
  var window = { location: { pathname: '/app/', search: '', origin: 'https://www.venueplay.com.au', reload: function () {} }, supabase: { createClient: function () { return client; } },
    localStorage: storage, sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, document: document, fetch: fetch };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'fetch', SESSION))(window, document, storage, window.sessionStorage, window.location, fetch);
  (new Function('window', FIRSTRUN))(window);
  var deps = { doc: document, storage: storage, fetch: fetch, client: client, VP: window.VP, origin: 'https://www.venueplay.com.au',
    setInterval: function (fn, ms) { TIMERS.push({ fn: fn, ms: ms, on: true }); return TIMERS.length; }, clearInterval: function (n) { if (TIMERS[n - 1]) TIMERS[n - 1].on = false; },
    openUrl: function (u) { OPENED.push(u); }, clipboard: { writeText: function (t) { CLIP.push(t); return Promise.resolve(); } } };
  return { win: window, doc: document, body: body, FR: window.VPFirstRun, VP: window.VP, deps: deps };
}
function tick() { TIMERS.forEach(function (t) { if (t.on) t.fn(); }); }
function pv(over) { var v = { id: 'V1', name: "Caz Reitop's Dirty Secrets", slug: 'caz-reitop-s-dirty-secrets', status: 'active', terms_required: true, compliance_accepted_at: null, compliance_accepted_by: null }; for (var k in (over || {})) v[k] = over[k]; return v; }
function ctxFor(role, v) { return { role: role, venue: v || pv(), currentVenueId: 'V1', staff: [{ venue_id: 'V1', role: role, display_name: 'Amit' }] }; }
function hiddenEl(e) { return !!e && (e.style.display === 'none' || (!e.style.display && /display:none/.test(e.style.cssText || ''))); }
function $(P, id) { return P.doc.getElementById(id); }
function T(P, id) { var e = $(P, id); return e ? allText(e) : ''; }
var __rnd = 11;

(async function () {
  section('1. THE FIRST RUN: who gets it');
  var P = page();
  check('vp-firstrun.js exports VPFirstRun with the five steps in order', P.FR && P.FR.STEPS.join() === 'mobile,terms,tv,game,card', P.FR && P.FR.STEPS);
  check('a prospect venue (terms_required), its manager: it opens', P.FR.wants(ctxFor('manager'), P.deps.storage) === true);
  check('its owner too', P.FR.wants(ctxFor('owner'), P.deps.storage) === true);
  check('a host: no (the tick and the card are not theirs)', P.FR.wants(ctxFor('host'), P.deps.storage) === false);
  check('HQ View as: no', P.FR.wants(ctxFor('admin'), P.deps.storage) === false);
  check('an ordinary venue (not set up as a prospect): no', P.FR.wants(ctxFor('manager', pv({ terms_required: false })), P.deps.storage) === false);
  check('a switched-off venue: no (its hold card comes first)', P.FR.wants(ctxFor('manager', pv({ status: 'suspended' })), P.deps.storage) === false);

  section('1a. Step 1 of 5: Add your mobile, attached ONLY after the texted code is verified');
  var ctx = ctxFor('manager');
  var R = P.FR.open(ctx, P.deps); await R.ready;
  check('one guide on the page, a dialog, step 1 of 5, five dots with the first lit', !!$(P, 'vpFirstRun') && $(P, 'vpFirstRun').getAttribute('role') === 'dialog' && T(P, 'vpFrCount') === 'Step 1 of 5' &&
    $(P, 'vpFrDots').children.length === 5 && /FF1F8E/.test($(P, 'vpFrDots').children[0].style.cssText) && !/FF1F8E/.test($(P, 'vpFrDots').children[1].style.cssText), T(P, 'vpFrCount'));
  check('it says why: sign in by text, and texts if something needs them', T(P, 'vpFrTitle') === 'Add your mobile' && /sign in with a text code/.test(T(P, 'vpFrBody')) && /text you if something at Caz Reitop's Dirty Secrets needs you/.test(T(P, 'vpFrBody')), T(P, 'vpFrBody'));
  check('it can be skipped (Next reads "Skip for now"), and Back is hidden on step 1', $(P, 'vpFrNext').textContent === 'Skip for now' && !$(P, 'vpFrNext').disabled && $(P, 'vpFrBack').style.visibility === 'hidden');
  $(P, 'vpFrMobile').value = '07 5228 3667';
  await $(P, 'vpFrSend').click();
  check('a landline is refused before any text is sent', /not an Australian mobile/.test(T(P, 'vpFrMsg')) && AUTH_CALLS.filter(function (a) { return a.fn === 'updateUser'; }).length === 0, T(P, 'vpFrMsg'));
  $(P, 'vpFrMobile').value = '0400 000 009';
  await $(P, 'vpFrSend').click();
  check('a mobile already on another login: told so, nothing attached', /already on another VenuePlay login/.test(T(P, 'vpFrMsg')) && USER.phone === '', T(P, 'vpFrMsg'));
  $(P, 'vpFrMobile').value = '0452 510 904';
  await $(P, 'vpFrSend').click();
  var up = AUTH_CALLS.filter(function (a) { return a.fn === 'updateUser'; }).pop();
  check('"Text me a code" asks Auth to text +61452510904 (its phone change: the number stays pending)', up && up.args.phone === '+61452510904' && Object.keys(up.args).join() === 'phone' && /Code sent to 0452 510 904/.test(T(P, 'vpFrMsg')), up);
  check('and the login still has NO mobile: an unverified number is never attached', USER.phone === '' && $(P, 'vpFrNext').textContent === 'Skip for now');
  check('nothing about the mobile went to any VenuePlay server route', CALLS.every(function (c) { return JSON.stringify(c.body || {}).indexOf('452510904') === -1 && JSON.stringify(c.body || {}).indexOf('0452') === -1; }), CALLS.map(function (c) { return c.url; }));
  $(P, 'vpFrCode').value = '999999';
  await $(P, 'vpFrVerify').click();
  var vo = AUTH_CALLS.filter(function (a) { return a.fn === 'verifyOtp'; }).pop();
  check('a wrong code: refused, still no mobile on the login, the step not done', /did not match/.test(T(P, 'vpFrMsg')) && USER.phone === '' && STORE['vpFirstRun:V1'].indexOf('"mobile":"done"') === -1, T(P, 'vpFrMsg'));
  $(P, 'vpFrCode').value = '123456';
  await $(P, 'vpFrVerify').click();
  vo = AUTH_CALLS.filter(function (a) { return a.fn === 'verifyOtp'; }).pop();
  check('the right code is verified as a PHONE CHANGE for that same number', vo && vo.args.type === 'phone_change' && vo.args.phone === '+61452510904' && vo.args.token === '123456', vo);
  check('only then is it on the login, and the step says so; Next now reads Next', USER.phone === '61452510904' && /Done\. 0452 510 904 is on your login/.test(T(P, 'vpFrBody')) && $(P, 'vpFrNext').textContent === 'Next', [USER.phone, T(P, 'vpFrBody')]);

  section('1b. Step 2 of 5: the Terms tick (the existing blocking card), Next waits for it');
  await R.next();
  check('step 2 of 5, two dots lit, Back shown', T(P, 'vpFrCount') === 'Step 2 of 5' && /FF1F8E/.test($(P, 'vpFrDots').children[1].style.cssText) && $(P, 'vpFrBack').style.visibility === 'visible');
  var card = $(P, 'vpTermsCard');
  check('the Terms card is INSIDE the guide (not left on the page behind it), with the tick, their name and Accept', card && walk($(P, 'vpFrBody'), function (e) { return e === card; }) && !!$(P, 'vpTermsTick') && $(P, 'vpTermsBy').value === 'Amit' && !!$(P, 'vpTermsGo'), card && card.parentNode && card.parentNode.id);
  check('Next is held until they tick', $(P, 'vpFrNext').disabled === true);
  R.next();
  check('pressing it anyway does nothing', R.step() === 'terms');
  $(P, 'vpTermsTick').checked = true; $(P, 'vpTermsGo').click();
  drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
  tick();
  var acc = CALLS.filter(function (c) { return /\/account\/compliance-accept$/.test(c.url); })[0];
  check('Accept records it through the billing Worker in their name, as the console card always has', acc && acc.body.accepted === true && acc.body.venue_id === 'V1' && acc.body.by === 'Amit', acc);
  check('then Next opens, and the card\'s own "Start a game" (a page reload) is hidden: the guide carries on', $(P, 'vpFrNext').disabled === false && (!$(P, 'vpTermsDone') || $(P, 'vpTermsDone').style.display === 'none'));

  section('1c. Step 3 of 5: their TV, exact address, Copy, and a live preview of their slides');
  await R.next();
  check('step 3: "Your TV", their exact TV address', T(P, 'vpFrTitle') === 'Your TV' && T(P, 'vpFrTvUrl') === 'www.venueplay.com.au/tv?caz-reitop-s-dirty-secrets', T(P, 'vpFrTvUrl'));
  check('it says to open it on the TV\'s browser and leave it running', /Open this address in your TV's web browser/.test(T(P, 'vpFrBody')) && /leave it running/.test(T(P, 'vpFrBody')));
  // Dean, 31 Oct 2026: the VenuePlay TV app, for a TV with Google Play, in every setup guide.
  var playP = $(P, 'vpFrPlay'), playA = playP && walk(playP, function (e) { return e.tagName === 'A'; });
  check('it names the VenuePlay TV app for a TV with Google Play, then the TV\'s web browser otherwise (one line)',
        T(P, 'vpFrPlay') === "Got a TV with Google Play? Download the VenuePlay TV app and put in your screen code. Otherwise open venueplay.com.au/tv in the TV's web browser." && !!playP && inDoc(playP, P.body), T(P, 'vpFrPlay'));
  check('and "VenuePlay TV app" links to the app\'s Google Play page, opened on its own',
        !!playA && playA.textContent === 'VenuePlay TV app' && playA.getAttribute('href') === 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv' && playA.getAttribute('target') === '_blank',
        playA && [playA.textContent, playA.getAttribute('href')]);
  await $(P, 'vpFrCopy').click();
  check('Copy puts the whole address on the clipboard and says Copied', CLIP.length === 1 && CLIP[0] === 'https://www.venueplay.com.au/tv?caz-reitop-s-dirty-secrets' && $(P, 'vpFrCopy').textContent === 'Copied', CLIP);
  var sg = CALLS.filter(function (c) { return /\/account\/screen-get$/.test(c.url); })[0];
  check('the preview reads THEIR screen (screen-get for this venue, signed in)', sg && sg.body.venue_id === 'V1' && sg.opts.headers.Authorization === 'Bearer TOKEN-1', sg);
  check('it shows their first slide in a 16:9 frame, and says how many', $(P, 'vpFrSlide').getAttribute('src') === 'https://db/storage/v1/object/public/venue-ads/V1/a.png' && $(P, 'vpFrSlide').style.display === 'block' && /padding-top:56\.25%/.test($(P, 'vpFrPreview').style.cssText) && /Your 2 slides/.test(T(P, 'vpFrCaption')), T(P, 'vpFrCaption'));
  tick();
  check('and moves to the next one, as the TV does', $(P, 'vpFrSlide').getAttribute('src') === 'https://db/storage/v1/object/public/venue-ads/V1/b.jpg');

  section('1d. Step 4 of 5: run your first game');
  await R.next();
  check('step 4: trivia in three taps, said in words', T(P, 'vpFrTitle') === 'Run your first game' && /Trivia takes three taps: pick a question set, tap Open lobby, then Start/.test(T(P, 'vpFrBody')), T(P, 'vpFrBody'));
  check('leaving step 3 stopped its slideshow', TIMERS.filter(function (t) { return t.on; }).length === 0);
  check('musical bingo is offered as musical bingo, never as bingo or gaming', /Or try musical bingo/.test(T(P, 'vpFrMusical')) && !/gaming|permit/i.test(T(P, 'vpFrBody')));
  $(P, 'vpFrTrivia').click();
  check('Open trivia opens the trivia console for THEIR venue', OPENED.length === 1 && OPENED[0] === '/app/trivia/host.html?venue=caz-reitop-s-dirty-secrets', OPENED);
  check('and the guide remembers to come back on the last step', JSON.parse(STORE['vpFirstRun:V1']).step === 'card', STORE['vpFirstRun:V1']);
  await R.go('game'); $(P, 'vpFrMusical').click();
  check('Or try musical bingo opens that console for their venue', OPENED[1] === '/app/musical/host.html?venue=caz-reitop-s-dirty-secrets', OPENED);

  section('1e. Step 5 of 5: your card when you\'re ready, and "Dean will call"');
  await R.go('card');
  var cl = CALLS.filter(function (c) { return /\/account\/card-link$/.test(c.url); })[0];
  check('step 5 asks the billing Worker for THIS venue\'s card link', T(P, 'vpFrTitle') === "Add your card when you're ready" && cl && cl.body.venue_id === 'V1', cl);
  /* Phase 2 (Dean, 29 Oct 2026; migration 127): the free month started at their first sign-in, and ends on a day the Worker gives. */
  check('the price line: $2.50 a player a month on the usual crowd, 60 is $150.00, the free month runs until its day and the card is not charged before then, no lock-in', T(P, 'vpFrPrice') === "It's $2.50 a player a month on your usual crowd: 60 players is $150.00 a month. Your free month runs until Thu 26 Nov, and your card won't be charged before then. No lock-in.", T(P, 'vpFrPrice'));
  check('two equal choices side by side: "Add your card now" (the card link, in the SAME tab, so Stripe\'s back arrow returns to this signed-in console) and "Later"', $(P, 'vpFrCard').getAttribute('href') === 'https://www.venueplay.com.au/add-card?f=F1&t=abc' && $(P, 'vpFrCard').getAttribute('target') === null &&
    $(P, 'vpFrChoices').style.display === 'flex' && T(P, 'vpFrCard') === 'Add your card now' && T(P, 'vpFrLater') === 'Later' && /flex:1 1 150px/.test($(P, 'vpFrCard').style.cssText) && /flex:1 1 150px/.test($(P, 'vpFrLater').style.cssText));
  check('the guide started their free month when it opened (/account/prospect-start, this venue)', CALLS.some(function (c) { return /\/account\/prospect-start$/.test(c.url) && c.body.venue_id === 'V1'; }));
  $(P, 'vpFrLater').click(); for (var fl = 0; fl < 6; fl++) await Promise.resolve();
  check('Later: says plainly a reminder email comes before the free month ends, and records the choice', T(P, 'vpFrCardMsg') === "No problem. We'll send you a reminder email to add your card before your free month ends." &&
    CALLS.some(function (c) { return /\/account\/card-choice$/.test(c.url) && c.body.choice === 'later' && c.body.venue_id === 'V1'; }), T(P, 'vpFrCardMsg'));
  $(P, 'vpFrCard').click(); for (var fl2 = 0; fl2 < 6; fl2++) await Promise.resolve();
  check('Add your card now records the choice too', CALLS.some(function (c) { return /\/account\/card-choice$/.test(c.url) && c.body.choice === 'now'; }));
  check('the last button reads Finish', $(P, 'vpFrNext').textContent === 'Finish');
  check('"Need a hand? Tap here and Dean will call" is there, with nothing to type (their mobile is on the login)', /Need a hand\?/.test(T(P, 'vpFrBody')) && $(P, 'vpFrCall').textContent === 'Tap here and Dean will call' && $(P, 'vpFrCallWrap').style.cssText.indexOf('display:none') !== -1);
  await $(P, 'vpFrCall').click();
  var tk = CALLS.filter(function (c) { return /\/help\/venue\/ticket$/.test(c.url); })[0];
  check('one tap makes a help desk ticket "Please call me" with their mobile, for this venue, signed in', tk && tk.body.subject === 'Please call me' && tk.body.venue_id === 'V1' && /Please call me on 0452 510 904/.test(tk.body.message) && tk.opts.headers.Authorization === 'Bearer TOKEN-1', tk && tk.body);
  check('and says Dean will call, with the ticket number', /Thanks\. Dean will call you on 0452 510 904 \(ticket 1007\)\./.test(T(P, 'vpFrCallMsg')), T(P, 'vpFrCallMsg'));
  var CALL_ME_BODY = tk && tk.body;
  await R.next();
  check('Finish closes the guide and marks it done for this venue', !$(P, 'vpFirstRun') && JSON.parse(STORE['vpFirstRun:V1']).done === true && P.FR.wants(ctx, P.deps.storage) === false, STORE['vpFirstRun:V1']);

  section('1f. Progress per venue, Close, and reopen');
  var P2 = page('61452510904'); var c2 = ctxFor('manager', pv({ compliance_accepted_at: '2026-10-28T02:00:00Z', compliance_accepted_by: 'Amit' }));
  var R2 = P2.FR.open(c2, P2.deps); await R2.ready;
  var HDR = walk(P2.body, function (e) { return e.tagName === 'HEADER'; });
  check('open, it covers the page completely: an opaque backdrop, and the page\'s sticky header (Help / Setup guide / Account / Sign out) stood down', HDR && HDR.style.visibility === 'hidden' &&
    /background:#0A0A0B/.test($(P2, 'vpFirstRun').getAttribute('style')), [HDR && HDR.style.visibility, $(P2, 'vpFirstRun').getAttribute('style')]);
  /* STEPS ALREADY DONE ARE LEFT OUT (Dean, 30 Oct 2026; UX audit 2.3): a login with its mobile is never asked for it
     again, and a venue that has ticked the Terms is not shown the tick. */
  check('a login that already has its mobile, at a venue that has ticked: no mobile step, no Terms step; it opens on Your TV, step 1 of 3',
    R2.steps().join() === 'tv,game,card' && R2.step() === 'tv' && T(P2, 'vpFrTitle') === 'Your TV' && T(P2, 'vpFrCount') === 'Step 1 of 3' && $(P2, 'vpFrDots').children.length === 3 && !$(P2, 'vpFrMobile') && !$(P2, 'vpTermsCard'), [R2.steps(), T(P2, 'vpFrCount')]);
  check('so Back is hidden on its first step', $(P2, 'vpFrBack').style.visibility === 'hidden');
  $(P2, 'vpFrClose').click();
  check('closed, the header is back exactly as it was', HDR.style.visibility === '' && HDR.getAttribute('data-vpfr') === null, HDR.style.visibility);
  check('Close takes it away, keeps the step, and does not open it again on its own', !$(P2, 'vpFirstRun') && JSON.parse(STORE['vpFirstRun:V1']).step === 'tv' && JSON.parse(STORE['vpFirstRun:V1']).dismissed === true && P2.FR.wants(c2, P2.deps.storage) === false, STORE['vpFirstRun:V1']);
  var R3 = P2.FR.open(c2, P2.deps); await R3.ready;
  check('reopened (Setup guide), it resumes on that step', R3.step() === 'tv' && T(P2, 'vpFrCount') === 'Step 1 of 3', T(P2, 'vpFrCount'));
  var other = ctxFor('manager', pv({ id: 'V2' }));
  check('progress is per venue: another prospect venue on this device starts at step 1', P2.FR.wants(other, P2.deps.storage) === true);
  var P3 = page(); P3.FR.open(ctxFor('manager'), P3.deps); P3.FR.open(ctxFor('manager'), P3.deps);
  var n = 0; walk(P3.body, function (e) { if (e.id === 'vpFirstRun') n++; return false; });
  check('opened twice, still one guide', n === 1, n);
  var P4 = page(); P4.deps.fetch = function (url, opts) { CALLS.push({ url: String(url), body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, has_card: true, rate: 2.5, seats: 60, monthly: 150 }); } }); };
  var R4 = P4.FR.open(ctxFor('manager'), P4.deps); await R4.ready;
  check('a venue whose card is on (every self sign-up that added one at Stripe): no card step at all', R4.steps().indexOf('card') === -1 && R4.go('card') === null && R4.steps().join() === 'mobile,terms,tv,game', R4.steps());
  await R4.go('game');
  check('and its last step, Run your first game, reads Finish', $(P4, 'vpFrNext').textContent === 'Finish', $(P4, 'vpFrNext').textContent);
  await R4.go('tv');
  check('no slides yet: the TV step says how to add them, no broken image', hiddenEl($(P4, 'vpFrSlide')) && !$(P4, 'vpFrSlide').getAttribute('src') && /No slides yet\. Add your own ads any time under Account/.test(T(P4, 'vpFrCaption')));
  var P5 = page(); var R5 = P5.FR.open(ctxFor('manager'), P5.deps); await R5.go('card');
  await $(P5, 'vpFrCall').click();
  check('"Dean will call" with no mobile on the login asks for one first, and sends nothing yet', $(P5, 'vpFrCallWrap').style.display === 'block' && CALLS.filter(function (c) { return /help\/venue\/ticket/.test(c.url); }).length === 0 && /Pop your mobile in/.test(T(P5, 'vpFrCallMsg')));
  $(P5, 'vpFrCallMobile').value = '0412 345 678'; await $(P5, 'vpFrCall').click();
  var tk5 = CALLS.filter(function (c) { return /help\/venue\/ticket/.test(c.url); })[0];
  check('then sends the ticket with the number they gave (for the call only: it does not go on the login)', tk5 && /Please call me on 0412 345 678/.test(tk5.body.message) && AUTH_CALLS.every(function (a) { return a.fn !== 'updateUser'; }), tk5 && tk5.body);
  var allCopy = [P, P2, P4, P5].map(function (p) { return allText(p.body); }).join(' ') + ' ' + FIRSTRUN.replace(/\/\*[\s\S]*?\*\//g, '');
  check('no em dash, never "roster", never "the ACT" in anything the guide says', !/[\u2013\u2014]/.test(allCopy) && !/roster/i.test(allCopy) && !/\bthe ACT\b/.test(allCopy));

  section('1g. index.html opens the guide first for a prospect, and the header can reopen it');
  var INDEX = readFile('venueplay/app/index.html');
  function lift(src, name) { var i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('cannot find ' + name); var d = 0, k = src.indexOf('{', i); do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length); return src.slice(i, k); }
  function runProceed(want) {
    var log = [], opened = [];
    var fakeVP = { getClient: function () { return 'CLIENT'; }, holdGate: function () { log.push('holdGate'); return false; }, termsGate: function () { log.push('termsGate'); return false; }, termsCard: function () { log.push('termsCard'); } };
    var FRf = { wants: function () { log.push('wants'); return want; }, open: function (c, d) { log.push('open'); opened.push(d); } };
    var fn = (new Function('__ctx', 'window', 'VP', 'VPFirstRun', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'go', 'pairToVenue', '$',
      'return (' + lift(INDEX, 'proceedVenue') + ');'))({ venue: { id: 'V1', slug: 'caz' }, staff: [{ venue_id: 'V1' }] }, { VP: fakeVP, VPFirstRun: FRf }, fakeVP, FRf,
      function () {}, function () {}, function () { return true; }, function () {}, function (v) { log.push('go:' + v); }, function () { log.push('pair'); return true; }, function () { return { value: '', textContent: '', focus: function () {} }; });
    fn(); return { log: log.join(','), opened: opened, fn: fn };
  }
  var a1 = runProceed(true), a2 = runProceed(false);
  check('a prospect: the guide opens after the hold check and BEFORE the Terms gate, with nothing paired behind it', a1.log === 'holdGate,wants,open,go:vBoot', a1.log);
  check('closing it carries on into the console (onClose is proceedVenue), with the venue\'s own client', a1.opened[0] && a1.opened[0].client === 'CLIENT' && typeof a1.opened[0].onClose === 'function' && /proceedVenue/.test(String(INDEX.match(/VPFirstRun\.open\(__ctx, \{ client:VP\.getClient\(\), VP:VP, onClose:proceedVenue \}\)/))), a1.opened[0]);
  check('anyone else goes on exactly as before', a2.log === 'holdGate,wants,termsGate,termsCard,pair', a2.log);
  check('index.html loads vp-firstrun.js after vp-session.js', INDEX.indexOf('<script src="vp-firstrun.js"></script>') > INDEX.indexOf('<script src="vp-session.js"></script>') && INDEX.indexOf('<script src="vp-session.js"></script>') > 0);
  var ual = lift(INDEX, 'updateAccountLink');
  var btn = { style: { display: 'none' } };
  (new Function('__ctx', 'window', 'VPFirstRun', '$', 'applyNumberBingo', 'document', ual + '\nupdateAccountLink();'))({ role: 'manager', venue: pv() }, { VPFirstRun: { isProspect: function () { return true; } } }, { isProspect: function () { return true; } },
    function (id) { return id === 'firstRunBtn' ? btn : null; }, function () {}, {});
  check('the header shows "Setup guide" for a prospect\'s owner or manager', btn.style.display === '' && /id="firstRunBtn" class="hact"[^>]*>Setup guide</.test(INDEX), btn.style.display);
  var btn2 = { style: { display: '' } };
  (new Function('__ctx', 'window', 'VPFirstRun', '$', 'applyNumberBingo', 'document', ual + '\nupdateAccountLink();'))({ role: 'host', venue: pv() }, { VPFirstRun: { isProspect: function () { return false; } } }, { isProspect: function () { return false; } },
    function (id) { return id === 'firstRunBtn' ? btn2 : null; }, function () {}, {});
  check('and hides it for anyone else', btn2.style.display === 'none');

  section('1h. EVERY NEW VENUE gets the guide, not only a prospect, until its first game (Dean, 30 Oct 2026; UX audit 2.1)');
  var NOW = Date.parse('2026-10-30T02:00:00Z');
  function selfV(over) { return pv(Object.assign({ terms_required: false, created_at: '2026-10-28T01:00:00Z', compliance_accepted_at: '2026-10-28T01:00:00Z', compliance_accepted_by: 'Amit' }, over || {})); }
  var PS = page();
  check('a self sign-up two days old, its owner: offered, and it wants to open', PS.FR.offered(ctxFor('owner', selfV()), NOW) === true && PS.FR.wants(ctxFor('owner', selfV()), PS.deps.storage, NOW) === true);
  check('a venue 60 days old that is not a prospect: never (Tugun and every venue already running are left alone)', PS.FR.wants(ctxFor('owner', selfV({ created_at: '2026-08-31T00:00:00Z' })), PS.deps.storage, NOW) === false);
  check('a venue with no created_at: never', PS.FR.wants(ctxFor('owner', selfV({ created_at: null })), PS.deps.storage, NOW) === false);
  check('a host at a new venue: no', PS.FR.wants(ctxFor('host', selfV()), PS.deps.storage, NOW) === false);
  function sessClient(rows, fail) { return { from: function (t) { var q = { t: t, f: {} }; var b = { select: function () { return b; }, eq: function (k, v) { q.f[k] = v; return b; }, limit: function (n) { q.limit = n; CK.push(q);
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ data: rows.filter(function (r) { return r.venue_id === q.f.venue_id; }).slice(0, n), error: null }); } }; return b; } }; }
  var CK = [];
  var nv = selfV({ id: 'VN1', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
  var ok1 = await PS.FR.check(ctxFor('owner', nv), sessClient([{ venue_id: 'OTHER' }]), PS.deps.storage);
  check('check(): no session yet at this venue, so it opens (asked vp_sessions for THIS venue, one row)', ok1 === true && CK[0] && CK[0].t === 'vp_sessions' && CK[0].f.venue_id === 'VN1' && CK[0].limit === 1, CK);
  var nv2 = selfV({ id: 'VN2', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
  var ok2 = await PS.FR.check(ctxFor('owner', nv2), sessClient([{ venue_id: 'VN2' }]), PS.deps.storage);
  check('a venue that has had its first game: does not open, and is marked done on this device so it is never asked again',
    ok2 === false && JSON.parse(STORE['vpFirstRun:VN2']).done === true && PS.FR.wants(ctxFor('owner', nv2), PS.deps.storage) === false, STORE['vpFirstRun:VN2']);
  var nv3 = selfV({ id: 'VN3', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), last_trivia_at: '2026-10-29T09:00:00Z' });
  var n0 = CK.length, ok3 = await PS.FR.check(ctxFor('owner', nv3), sessClient([]), PS.deps.storage);
  check('a venue whose row says it ran trivia: does not open, without asking', ok3 === false && CK.length === n0);
  var nv4 = selfV({ id: 'VN4', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
  var ok4 = await PS.FR.check(ctxFor('owner', nv4), sessClient([], true), PS.deps.storage);
  check('the read fails: it does not open, and the console carries on (it does not ask again on this page)', ok4 === false && PS.FR.wants(ctxFor('owner', nv4), PS.deps.storage) === false);
  check('a prospect is opened without asking (its card step is the point)', (await PS.FR.check(ctxFor('manager', pv({ id: 'VP9' })), sessClient([], true), PS.deps.storage)) === true);

  var PSU = page('61452510904');
  PSU.deps.fetch = function (url, opts) { var c = { url: String(url), body: JSON.parse(opts.body) }; CALLS.push(c);
    var ans = /card-link$/.test(c.url) ? { ok: true, has_card: true, rate: 3, seats: 60, monthly: 180 } : /screen-get$/.test(c.url) ? { ok: true, slides: [] } : { ok: true };
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(ans); } }); };
  var RSU = PSU.FR.open(ctxFor('owner', selfV()), PSU.deps); await RSU.ready;
  check('a self sign-up with its mobile, the Terms ticked at checkout and a card at Stripe: just Your TV and a first game, step 1 of 2',
    RSU.steps().join() === 'tv,game' && T(PSU, 'vpFrTitle') === 'Your TV' && T(PSU, 'vpFrCount') === 'Step 1 of 2', [RSU.steps(), T(PSU, 'vpFrCount')]);
  check('it never starts a prospect free month for a venue that is not one', !CALLS.some(function (c) { return /prospect-start$/.test(c.url); }));
  await RSU.next();
  check('Run your first game is the last step and reads Finish', T(PSU, 'vpFrTitle') === 'Run your first game' && $(PSU, 'vpFrNext').textContent === 'Finish');
  await RSU.next();
  check('Finish closes it as done', !$(PSU, 'vpFirstRun') && JSON.parse(STORE['vpFirstRun:V1']).done === true);

  section('1i. The card step always offers Now and Later, Later works without the link, and Retry (UX audit 2.5)');
  var PF = page(); var linkTries = 0;
  PF.deps.fetch = function (url, opts) { var c = { url: String(url), body: JSON.parse(opts.body) }; CALLS.push(c);
    var ans = { ok: true };
    if (/card-link$/.test(c.url)) { linkTries++; ans = linkTries <= 1 ? { error: 'The card link could not be made just now. Try again in a minute.' } : { ok: true, has_card: false, card_url: 'https://www.venueplay.com.au/add-card?f=F1&t=xyz', rate: 2.5, seats: 60, monthly: 150, ends_words: 'Thu 26 Nov' }; }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(ans); } }); };
  var RF = PF.FR.open(ctxFor('manager'), PF.deps); await RF.ready; await RF.go('card');
  check('the link will not load: both buttons are still there, Add your card now dimmed with no link', $(PF, 'vpFrChoices').style.display === 'flex' && T(PF, 'vpFrCard') === 'Add your card now' && T(PF, 'vpFrLater') === 'Later' &&
    !$(PF, 'vpFrCard').getAttribute('href') && $(PF, 'vpFrCard').getAttribute('aria-disabled') === 'true', $(PF, 'vpFrChoices').style.display);
  check('it says so, and offers Retry', /could not be made just now/.test(T(PF, 'vpFrCardMsg')) && /Tap Retry, or choose Later/.test(T(PF, 'vpFrCardMsg')) && $(PF, 'vpFrRetry').style.display === 'inline-block', T(PF, 'vpFrCardMsg'));
  $(PF, 'vpFrLater').click(); for (var lf = 0; lf < 6; lf++) await Promise.resolve();
  check('Later works without the link: the reminder line, and the choice recorded', T(PF, 'vpFrCardMsg') === "No problem. We'll send you a reminder email to add your card before your free month ends." &&
    CALLS.some(function (c) { return /card-choice$/.test(c.url) && c.body.choice === 'later'; }));
  await $(PF, 'vpFrRetry').click(); for (var rf = 0; rf < 6; rf++) await Promise.resolve();
  check('Retry asks again and, once it answers, the link is in and the button is live', linkTries === 2 && $(PF, 'vpFrCard').getAttribute('href') === 'https://www.venueplay.com.au/add-card?f=F1&t=xyz' &&
    $(PF, 'vpFrCard').getAttribute('aria-disabled') === 'false' && $(PF, 'vpFrRetry').style.display === 'none' && /\$2\.50 a player a month/.test(T(PF, 'vpFrPrice')), [linkTries, $(PF, 'vpFrCard').getAttribute('href')]);

  section('1j. "Open your setup guide" in a welcome email (?guide=1) opens a closed guide again');
  var PG = page(); var gctx = ctxFor('owner', selfV({ created_at: new Date(Date.now() - 86400000).toISOString() }));
  STORE['vpFirstRun:V1'] = JSON.stringify({ step: 'tv', dismissed: true });
  check('closed earlier on this device: it does not open by itself', PG.FR.wants(gctx, PG.deps.storage) === false);
  check('?guide=1 reopens it, on the step it was on', PG.FR.reopen(gctx, PG.deps.storage) === true && PG.FR.wants(gctx, PG.deps.storage) === true && JSON.parse(STORE['vpFirstRun:V1']).step === 'tv');
  STORE['vpFirstRun:V1'] = JSON.stringify({ step: 'card', done: true, dismissed: true });   // finished, and closed at some point too
  check('a finished guide stays finished', PG.FR.reopen(gctx, PG.deps.storage) === false && PG.FR.wants(gctx, PG.deps.storage) === false);
  var IDX = readFile('venueplay/app/index.html');
  check('the console reads ?guide=1 once at load and reopens before it decides', /window\.__vpWantGuide = \/\[\?&\]guide=1\(&\|\$\)\/\.test/.test(IDX) && IDX.indexOf('VPFirstRun.reopen(__ctx)') > 0 && IDX.indexOf('VPFirstRun.reopen(__ctx)') < IDX.indexOf('VPFirstRun.check(__ctx'));
  ['welcome.html', 'welcome-hq.html'].forEach(function (f) {
    var h = readFile('venueplay/emails/' + f);
    check(f + ': its button is "Open your setup guide", to the console with ?guide=1', /<a href="\{\{host_console_url\}\}\/\?guide=1"[^>]*>Open your setup guide<\/a>/.test(h));
  });
  check('welcome-group.html: the same', /<a href="https:\/\/venueplay\.com\.au\/app\/\?guide=1"[^>]*>Open your setup guide<\/a>/.test(readFile('venueplay/emails/welcome-group.html')));
  var WP = readFile('venueplay/emails/welcome-prospect.html');
  check('the prospect welcome\'s button signs them in to the console (/app/go or ?signin=sms), where the guide opens first', /<a href="\{\{signin_url\}\}"/.test(WP) && /vpaOneClickUrl\(site, o\.signinToken, email\)/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')) &&
    /w\.location\.replace\("\/app\/"\)/.test(readFile('venueplay/app/vp-oneclick.js')));

  /* ============================================================================================= */
  section('2. THE DELAYED EMAIL, on the real billing Worker');
  load('tools/rig-billing-worker.js');
  vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; } };   // the one-click sign-in link (migration 123)
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (typeof atob === 'undefined') { atob = function (s) { s = s.replace(/=+$/, ''); var o = '', bits = 0, acc = 0; for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) throw new Error('bad base64'); acc = ((acc << 6) | v) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); } } return o; }; }
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 3) { var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0; var nn = (a << 16) | (b << 8) | c;
  s += B64[(nn >> 18) & 63] + B64[(nn >> 12) & 63] + (i + 1 < bytes.length ? B64[(nn >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[nn & 63] : '='); } return s; }
if (typeof URL === 'undefined') { URL = function (u) { var q = u.indexOf('?'), sp = {}; if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; }; }
if (typeof Response === 'undefined') { Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }; Response.redirect = function (u, s) { return { redirect: u, status: s }; }; }
  var AUTH = [], CANCELS = [], RESEND_IDS = 0, CANCEL_OK = true, MIG124 = true, TICKET_NO = 1001;
  function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
  var rigFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    var u = String(url), method = (opts && opts.method) || 'GET';
    if (/api\.resend\.com\/emails\/[^/]+\/cancel$/.test(u)) { CANCELS.push(u.split('/emails/')[1].split('/')[0]); return RS(CANCEL_OK ? 200 : 422, CANCEL_OK ? { object: 'email', id: 'x' } : { message: 'cannot cancel' }); }
    if (u.indexOf('api.resend.com/emails') !== -1 && method === 'POST') { sent.push(JSON.parse(opts.body)); RESEND_IDS++; return RS(200, { id: 're_' + RESEND_IDS }); }
    if (u.indexOf('/auth/v1/admin/users') !== -1) {
      var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
      if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
      if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
      return RS(200, { users: AUTH });
    }
    if (/\/rest\/v1\/vp_help_tickets/.test(u) && method === 'POST') { var tb = JSON.parse(opts.body); tb.ticket_no = TICKET_NO++; opts = Object.assign({}, opts, { body: JSON.stringify(tb) }); }
    if (/\/rest\/v1\/vp_prospect_welcomes/.test(u) && !MIG124) return RS(404, '{"code":"42P01","message":"relation \\"public.vp_prospect_welcomes\\" does not exist"}');
    return rigFetch(url, opts);
  };
  function U(nn) { return '53000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
  var ADMIN = U(9), STAFFADMIN = U(7);
  function as(user, body) { var h = { Authorization: user ? 'Bearer ' + user : '' }; var txt = JSON.stringify(body || {});
    return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } }; }
  function world() {
    DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; CANCELS = []; CANCEL_OK = true; MIG124 = true; RESEND_IDS = 0; TICKET_NO = 1001;
    ENV.FOUNDING_CODES = 'NSW-NOV-2099,QLD-OCT-2099';
    DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: STAFFADMIN, label: 'Staffer', role: 'staff' }];
    DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = []; DB.vp_signin_links = []; DB.vp_prospect_welcomes = [];
  }
  /* No mobile: the delayed welcome's one-click link is what this section is about (a mobile login signs in by
     text code and carries no link at all; tools/test-prospect-setup.js holds that). */
  var CAZ = { name: "Caz Reitop's Dirty Secrets", first_name: 'Amit', email: 'CazReitop@gmail.com', postcode: '3066', entity_type: 'for_profit', players: 60 };
  function with_(o) { var b = {}; for (var k in CAZ) b[k] = CAZ[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
  function tokenOf(m) { var x = /\/app\/go#t=([A-Za-z0-9_-]{43})/.exec((m && m.html) || ''); return x ? x[1] : ''; }
  function linkFor(tok) { return vpaSigninTokenHash(tok).then(function (h) { return DB.vp_signin_links.filter(function (l) { return l.token_hash === h; })[0] || null; }); }
  function nothingMade() { return DB.vp_venues.length === 0 && DB.venueplay_founding.length === 0 && AUTH.length === 0 && sent.length === 0 && DB.vp_prospect_welcomes.length === 0; }

  world();
  var t0 = Date.now();
  var r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var m = sent[0] || {}, row = DB.vp_prospect_welcomes[0] || {}, v = DB.vp_venues[0] || {};
  check('set up with no delay given: the email is BOOKED with Resend 90 minutes on (scheduled_at), not sent at once', r.status === 200 && sent.length === 1 && typeof m.scheduled_at === 'string' && Math.abs(Date.parse(m.scheduled_at) - t0 - 90 * 60000) < 5000, m.scheduled_at);
  check('HQ is told when it goes', r.body.welcome && r.body.welcome.status === 'scheduled' && r.body.welcome.send_at === m.scheduled_at && r.body.welcome.id === row.id, r.body.welcome);
  check('ONE record of it (migration 124): the venue, the address, Resend\'s id, when, scheduled, who set it up', DB.vp_prospect_welcomes.length === 1 && row.venue_id === v.id && row.email === 'cazreitop@gmail.com' && row.resend_id === 're_1' &&
    row.send_at === m.scheduled_at && row.status === 'scheduled' && row.created_by === ADMIN, row);
  var tok = tokenOf(m), link = await linkFor(tok);
  check('the record keeps only the HASH of the sign-in link the email carries, never the link', !!link && row.signin_token_hash === link.token_hash && JSON.stringify(DB.vp_prospect_welcomes).indexOf(tok) === -1, row.signin_token_hash);
  check('that link\'s 14 days start when the email GOES, not when HQ pressed the button', link && Date.parse(link.expires_at) === Date.parse(m.scheduled_at) + 14 * 86400000, link && [link.created_at, link.expires_at]);
  check('the record holds what the email was made from, so Send now can make it again', row.detail && row.detail.venueName === CAZ.name && row.detail.firstName === 'Amit' && row.detail.authUserId === AUTH[0].id && row.detail.seats === 60, row.detail);
  check('the audit row says when it goes', (DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_set_up'; })[0] || {}).detail.welcome_send_at === m.scheduled_at);
  check('it carries a text part as well as the HTML', typeof m.text === 'string' && m.text.length > 100 && m.text === helpPlainFromHtml(m.html));

  world(); t0 = Date.now();
  r = await vpaHandleProspect(as(ADMIN, with_({ send_in_minutes: 15 })), ENV, J);
  check('"Send their email in 15 minutes": booked 15 minutes on', r.status === 200 && Math.abs(Date.parse(sent[0].scheduled_at) - t0 - 15 * 60000) < 5000, sent[0] && sent[0].scheduled_at);
  world(); t0 = Date.now();
  r = await vpaHandleProspect(as(ADMIN, with_({ send_in_minutes: 0 })), ENV, J);
  var l0 = await linkFor(tokenOf(sent[0]));
  check('0 minutes: sent now (no scheduled_at), recorded as sent, its link\'s 14 days from now', r.status === 200 && sent.length === 1 && sent[0].scheduled_at === undefined && r.body.welcome.status === 'sent' &&
    DB.vp_prospect_welcomes[0].status === 'sent' && l0 && Math.abs(Date.parse(l0.expires_at) - t0 - 14 * 86400000) < 5000, [sent[0] && sent[0].scheduled_at, r.body.welcome]);
  world();
  r = await vpaHandleProspect(as(ADMIN, with_({ send_in_minutes: 1440 })), ENV, J);
  var l1 = await linkFor(tokenOf(sent[0]));
  check('1440 minutes (a day, the most): booked, and its link still fits migration 123\'s 15-day check', r.status === 200 && l1 && Date.parse(l1.expires_at) - Date.parse(l1.created_at) <= 15 * 86400000, l1);
  var badOnes = [[1441, 'over a day'], [-5, 'negative'], ['soon', 'not a number'], [2.5, 'not whole minutes']];
  for (var bi = 0; bi < badOnes.length; bi++) {
    world(); r = await vpaHandleProspect(as(ADMIN, with_({ send_in_minutes: badOnes[bi][0] })), ENV, J);
    check('a delay ' + badOnes[bi][1] + ' is refused, saying so, and NOTHING is created', r.status === 400 && /0 to 1440 minutes/.test(r.body.error) && /Nothing was created/.test(r.body.error) && nothingMade(), r.body);
  }

  section('2a. HQ sees it, and can cancel it before it goes');
  world();
  await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  var W = DB.vp_prospect_welcomes[0], firstTok = tokenOf(sent[0]);
  var lst = await vpaProspectWelcomes(as(ADMIN, {}), ENV, J);
  var it = (lst.body.welcomes || [])[0] || {};
  check('HQ\'s list shows it: the venue, the address, when (Brisbane time), still changeable', lst.status === 200 && it.id === W.id && it.venue_name === CAZ.name && it.email === 'cazreitop@gmail.com' && it.status === 'scheduled' && it.can_change === true &&
    it.when === vpaBrisbaneTime(Date.parse(W.send_at)) && /^\d{1,2}:\d\d[ap]m [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(it.when), it);
  check('a staff admin cannot read the list, cancel or send now (owner or accounts, as Set up a prospect)', (await vpaProspectWelcomes(as(STAFFADMIN, {}), ENV, J)).status === 403 &&
    (await vpaProspectWelcomeCancel(as(STAFFADMIN, { id: W.id }), ENV, J)).status === 403 && (await vpaProspectWelcomeNow(as(STAFFADMIN, { id: W.id }), ENV, J)).status === 403 && CANCELS.length === 0 && W.status === 'scheduled');
  CANCEL_OK = false;
  var cx0 = await vpaProspectWelcomeCancel(as(ADMIN, { id: W.id }), ENV, J);
  check('Resend will not cancel it: HQ is told it may still go, and nothing is marked', cx0.status === 502 && /may still go/.test(cx0.body.error) && W.status === 'scheduled', cx0.body);
  CANCEL_OK = true;
  var cx = await vpaProspectWelcomeCancel(as(ADMIN, { id: W.id }), ENV, J);
  var lk = await linkFor(firstTok);
  check('Cancel: Resend is asked to cancel THAT email, and the record says cancelled, by whom', cx.status === 200 && CANCELS[CANCELS.length - 1] === 're_1' && W.status === 'cancelled' && W.changed_by === ADMIN && W.changed_label === 'Dean', [cx.body, W.status]);
  check('its sign-in link is retired, so the button in a cancelled email can never sign anyone in', lk && !!lk.used_at, lk);
  check('nothing else was sent', sent.length === 1);
  check('the audit row says it was cancelled', DB.vp_admin_audit.some(function (a) { return a.action === 'prospect_welcome_cancelled'; }));
  var cx2 = await vpaProspectWelcomeCancel(as(ADMIN, { id: W.id }), ENV, J);
  check('cancelling it again: refused, already cancelled', cx2.status === 409 && /already cancelled/.test(cx2.body.error), cx2.body);
  check('and the list now says cancelled, with no buttons', ((await vpaProspectWelcomes(as(ADMIN, {}), ENV, J)).body.welcomes[0] || {}).can_change === false);

  section('2b. Send now: the booked one is taken back and a new one goes at once, with a NEW link');
  world();
  await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  W = DB.vp_prospect_welcomes[0]; firstTok = tokenOf(sent[0]);
  t0 = Date.now();
  var sn = await vpaProspectWelcomeNow(as(ADMIN, { id: W.id }), ENV, J);
  var m2 = sent[1] || {}, newTok = tokenOf(m2), newLink = await linkFor(newTok), oldLink = await linkFor(firstTok);
  check('Resend cancels the booked one FIRST, then the new one goes with no scheduled_at', sn.status === 200 && CANCELS.join() === 're_1' && sent.length === 2 && m2.scheduled_at === undefined && m2.to[0] === 'cazreitop@gmail.com' && m2.subject === sent[0].subject, [sn.body, CANCELS, m2.scheduled_at]);
  check('the same email, made again (same words, same venue), with a different sign-in link', newTok && newTok !== firstTok && m2.html.replace(newTok, 'T') === sent[0].html.replace(firstTok, 'T'), [newTok, firstTok]);
  check('the new link\'s 14 days start now; the old one is retired', newLink && Math.abs(Date.parse(newLink.expires_at) - t0 - 14 * 86400000) < 5000 && !newLink.used_at && oldLink && !!oldLink.used_at, [newLink, oldLink]);
  check('the record says sent now, when, Resend\'s new id and the new link\'s hash', W.status === 'sent_now' && Math.abs(Date.parse(W.send_at) - t0) < 5000 && W.resend_id === 're_2' && W.signin_token_hash === newLink.token_hash, W);
  var sn2 = await vpaProspectWelcomeNow(as(ADMIN, { id: W.id }), ENV, J);
  check('Send now again: refused, nothing more sent', sn2.status === 409 && sent.length === 2, sn2.body);
  world();
  await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  W = DB.vp_prospect_welcomes[0]; CANCEL_OK = false;
  var sn3 = await vpaProspectWelcomeNow(as(ADMIN, { id: W.id }), ENV, J);
  check('Resend will not take the booked one back: nothing is sent twice, the record stays scheduled', sn3.status === 502 && sent.length === 1 && W.status === 'scheduled', sn3.body);

  section('2c. Once its minute has passed, there is nothing to cancel');
  world(); CANCEL_OK = true;
  await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  W = DB.vp_prospect_welcomes[0];
  W.send_at = new Date(Date.now() - 60000).toISOString();
  var late = await vpaProspectWelcomeCancel(as(ADMIN, { id: W.id }), ENV, J), late2 = await vpaProspectWelcomeNow(as(ADMIN, { id: W.id }), ENV, J);
  check('Cancel and Send now are both refused: it has already gone, at that time', late.status === 409 && /already gone/.test(late.body.error) && late2.status === 409 && CANCELS.length === 0 && sent.length === 1, [late.body, late2.body]);
  check('and HQ\'s list shows it as sent, with no buttons', ((await vpaProspectWelcomes(as(ADMIN, {}), ENV, J)).body.welcomes[0] || {}).status === 'sent');
  check('a made-up id: refused', (await vpaProspectWelcomeCancel(as(ADMIN, { id: 'nope' }), ENV, J)).status === 400 && (await vpaProspectWelcomeCancel(as(ADMIN, { id: U(999) }), ENV, J)).status === 404);

  section('2d. Before migration 124 is run');
  world(); MIG124 = false;
  r = await vpaHandleProspect(as(ADMIN, CAZ), ENV, J);
  check('the prospect is still set up and the email still BOOKED for later', r.status === 200 && sent.length === 1 && typeof sent[0].scheduled_at === 'string' && r.body.welcome.status === 'scheduled', r.body);
  check('and HQ is told it cannot cancel it or send it early until migration 124 is run', (r.body.warnings || []).some(function (w) { return /cannot cancel it or send it early until migration 124 is run/.test(w); }), r.body.warnings);

  section('3. "Please call me": the exact request the first run sends, through the real /help/venue/ticket');
  world();
  DB.vp_venues = [{ id: U(101), name: CAZ.name, founding_id: 'F1', slug: 'caz', status: 'active' }];
  DB.venueplay_founding = [{ id: 'F1', contact_email: 'cazreitop@gmail.com' }];
  DB.vp_venue_staff = [{ auth_user_id: U(1), venue_id: U(101), role: 'manager', display_name: 'Amit' }];
  DB.auth = [{ id: U(1), email: 'cazreitop@gmail.com', phone: '61452510904' }]; AUTH = DB.auth;
  DB.vp_help_tickets = []; DB.vp_help_ticket_notes = []; DB.vp_sessions = [];
  var body = Object.assign({}, CALL_ME_BODY, { venue_id: U(101) });
  var hr = await helpVenueTicket(as(U(1), body), ENV, J);
  var tkt = DB.vp_help_tickets[0] || {};
  check('a ticket "Please call me", venue support, for that venue, with their mobile in it and on the ticket', hr.status === 200 && tkt.subject === 'Please call me' && tkt.category === 'venue_support' && tkt.venue_id === U(101) &&
    /Please call me on 0452 510 904/.test(tkt.message) && tkt.contact_phone === '+61452510904' && tkt.contact_email === 'cazreitop@gmail.com', tkt);
  check('staff are alerted, and the venue gets its number back', hr.body.ticket_no && sent.some(function (x) { return /^\[VenuePlay\] Venue support \[#\d+\]/.test(x.subject); }), sent.map(function (x) { return x.subject; }));

  if (bad) throw new Error('prospect welcome v2: ' + bad + ' of ' + ran + ' failed');
  print(''); print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
