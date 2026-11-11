/* A HOST ADDS THEIR OWN EMAIL AT FIRST SIGN-IN (Dean, 5 Nov 2026, items 63 to 65), RUN.

   "A manager adding a host gives only the host's NAME and MOBILE. The HOST adds their own email themselves,
   asked at their first sign-in and editable later by them. There shouldn't be anyone without an email."
   "DO IT IN THE APP, NOT BY EMAIL." "One short step, skippable once, asked again next sign-in. Never re-ask
   what we already have."

   The one-field screen in venueplay/app/vp-about-you.js (VPAboutYou.wantsEmail / openEmail) and its wiring in
   venueplay/app/index.html, run in a small fake DOM:
     1. who is asked (a login with a mobile and no email), and who is not
     2. what it does: ONE Auth email change on THEIR login (it emails the address a confirmation link, so a
        mistyped or someone else's address never becomes the place a sign-in link goes), nothing else saved
     3. "Not now" lets them in for this sign-in and asks again at the next; saved once, never re-asked
     4. the console asks for it after name and mobile, before the venue pick; "My email" reopens it any time

   Run from the repo root:  jsc tools/test-email-step.js */
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
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var ABOUT = readFile('venueplay/app/vp-about-you.js'), INDEX = readFile('venueplay/app/index.html');
var W1 = {}; (new Function('window', ABOUT))(W1);
var AY = W1.VPAboutYou;
section('1. Who is asked');
check('vp-about-you.js offers wantsEmail and openEmail', !!(AY && typeof AY.wantsEmail === 'function' && typeof AY.openEmail === 'function'));
function ctxOf(user, over) { return Object.assign({ authed: true, isAdmin: false, scope: 'staff', user: user, role: 'host', venue: { id: 'V1', name: 'The Royal' }, staff: [{ venue_id: 'V1', role: 'host' }] }, over || {}); }
var HOST = { id: 'h1', phone: '61452510904', email: '' };
var s0 = store(), shiftA = store(), shiftB = store(); shiftA.setItem('vpShiftStart', '1000'); shiftB.setItem('vpShiftStart', '2000');
check('a host a manager added (name and mobile only): their own email is asked for at sign-in', AY.wantsEmail(ctxOf(HOST), s0) === true);
check('a login that already has an email is NEVER re-asked', AY.wantsEmail(ctxOf({ id: 'h2', phone: '61452510904', email: 'sam@theroyal.com.au' }), s0) === false);
check('one whose new email is waiting to be confirmed is not asked again either', AY.wantsEmail(ctxOf({ id: 'h3', phone: '61452510904', email: '', new_email: 'sam@theroyal.com.au' }), s0) === false);
check('a login with no mobile yet is asked for the mobile first (the email comes after)', AY.wantsEmail(ctxOf({ id: 'h4', phone: '', email: '' }), s0) === false);
check('an HQ admin (View as included) and nobody-signed-in never are', AY.wantsEmail(ctxOf(HOST, { isAdmin: true, scope: 'admin' }), s0) === false && AY.wantsEmail(ctxOf(HOST, { scope: 'admin' }), s0) === false && AY.wantsEmail({ authed: false }, s0) === false && AY.wantsEmail(null, s0) === false);
var later = store(); later.setItem('vpAboutEmailLater:h1', 'shift:1000');
check('"Not now" holds for this sign-in only: asked again at the next one, even in the same tab', AY.wantsEmail(ctxOf(HOST), later, shiftA) === false && AY.wantsEmail(ctxOf(HOST), later, shiftB) === true);

function screen(opts) {
  opts = opts || {};
  var doc = newDoc(), S = { calls: [], done: [], ss: opts.ss || store() };
  S.user = Object.assign({}, opts.user || HOST);
  S.client = { auth: { updateUser: function (a, o) { S.calls.push({ fn: 'updateUser', args: a, opts: o });
    if (a.email === 'taken@other.example') return Promise.resolve({ data: null, error: { message: 'A user with this email address has already been registered', code: 'email_exists' } });
    if (a.email === 'boom@x.example') return Promise.reject(new Error('offline'));
    return Promise.resolve({ data: { user: {} }, error: null }); } } };
  S.ctx = ctxOf(S.user);
  S.api = AY.openEmail(S.ctx, { doc: doc, storage: S.ss, client: S.client, shift: opts.shift, edit: opts.edit, onDone: function (how) { S.done.push(how); } });
  S.doc = doc; S.$ = function (id) { return doc.getElementById(id); };
  return S;
}
section('2. What it does');
var A = screen();
check('it opens over everything with ONE optional field, "Save my email" and "Not now"', !!A.$('vpAboutEmail') && shown(A.$('vpAeEmail')) && A.$('vpAeSave').textContent === 'Save my email' && A.$('vpAeSkip').textContent === 'Not now' &&
  /optional/.test(A.$('vpAeForm').textContent) && A.$('vpAeEmail').getAttribute('type') === 'email' && A.$('vpAeEmail').getAttribute('autocomplete') === 'email');
check('it says what it is for (the way in when the text code does not arrive) and promises nothing else', /text code ever doesn't arrive/.test(A.$('vpAeSub').textContent) && /only used for that/.test(A.$('vpAeSub').textContent), A.$('vpAeSub').textContent);
A.$('vpAeEmail').value = 'not an email'; A.$('vpAeSave').click(); settle();
check('a non-email is caught before anything is sent', A.calls.length === 0 && /doesn't look like an email/.test(A.$('vpAeMsg').textContent), A.$('vpAeMsg').textContent);
A.$('vpAeEmail').value = ''; A.$('vpAeSave').click(); settle();
check('empty: asked to type it or tap Not now, nothing sent', A.calls.length === 0 && /Not now/.test(A.$('vpAeMsg').textContent));
A.$('vpAeEmail').value = '  Sam@TheRoyal.com.au '; A.$('vpAeSave').click(); A.$('vpAeSave').click(); settle();
check('"Save my email": ONE Auth email change (tapped twice), lower-cased, on THEIR login, and no other call', A.calls.length === 1 && A.calls[0].fn === 'updateUser' && JSON.stringify(A.calls[0].args) === JSON.stringify({ email: 'sam@theroyal.com.au' }), A.calls);
check('Auth is told to land the confirmation back on the console', A.calls[0].opts && A.calls[0].opts.emailRedirectTo === '/app/', A.calls[0].opts);
check('it says a link has gone to that address to confirm, check junk, and one button', /We've sent a link to sam@theroyal\.com\.au/.test(A.$('vpAeSub').textContent) && /Tap it to confirm/.test(A.$('vpAeSub').textContent) && /junk/.test(A.$('vpAeSub').textContent) && !!A.$('vpAeGo') && A.done.length === 0, A.$('vpAeSub').textContent);
check('it is not asked again this sign-in (the new email is pending)', AY.wantsEmail(A.ctx, store()) === false && A.ctx.user.new_email === 'sam@theroyal.com.au');
A.$('vpAeGo').click();
check('"Let\'s go" closes it and the console carries on', A.done.join() === 'saved' && !A.$('vpAboutEmail'));
check('nothing was ever written as HTML, and no em dash or "roster" on it', !anyHtml(A.doc.body) && !/[\u2014\u2013]/.test(ABOUT) && !/roster/i.test(ABOUT.replace(/\/\*[\s\S]*?\*\//g, '')));

var B = screen(); B.$('vpAeEmail').value = 'taken@other.example'; B.$('vpAeSave').click(); settle();
check('an address Auth refuses (say it is on another login): one kind line that does NOT say why', /couldn't save that email/.test(B.$('vpAeMsg').textContent) && !/already|registered|exists|another login/i.test(B.$('vpAeMsg').textContent) && B.done.length === 0 && shown(B.$('vpAeEmail')), B.$('vpAeMsg').textContent);
var B2 = screen(); B2.$('vpAeEmail').value = 'boom@x.example'; B2.$('vpAeSave').click(); settle();
check('offline: "try again in a minute", stays on the form, button usable', /try again in a minute/i.test(B2.$('vpAeMsg').textContent) && B2.$('vpAeSave').disabled === false && B2.done.length === 0, [B2.$('vpAeMsg').textContent, B2.$('vpAeSave').disabled]);

section('3. Not now');
var C = screen({ shift: shiftA }); C.$('vpAeSkip').click(); settle();
check('"Not now" lets them in, saves nothing, and holds for this sign-in only', C.done.join() === 'later' && C.calls.length === 0 && C.ss.getItem('vpAboutEmailLater:h1') === 'shift:1000' && !C.$('vpAboutEmail') &&
  AY.wantsEmail(C.ctx, C.ss, shiftA) === false && AY.wantsEmail(C.ctx, C.ss, shiftB) === true);
var D = screen({ user: { id: 'h9', phone: '61452510904', email: 'old@theroyal.com.au' }, edit: true });
check('"My email" (editing): shows the email they have, titled "Your email", with Close not Not now', D.$('vpAeEmail').value === 'old@theroyal.com.au' && D.$('vpAeTitle').textContent === 'Your email' && D.$('vpAeSkip').textContent === 'Close');
D.$('vpAeEmail').value = 'old@theroyal.com.au'; D.$('vpAeSave').click(); settle();
check('saving the same address changes nothing and says so', D.calls.length === 0 && /already have/.test(D.$('vpAeMsg').textContent));
D.$('vpAeEmail').value = 'new@theroyal.com.au'; D.$('vpAeSave').click(); settle();
check('a changed address goes through the same confirmed email change', D.calls.length === 1 && D.calls[0].args.email === 'new@theroyal.com.au');
var E = screen({ user: { id: 'h9', phone: '61452510904', email: 'old@theroyal.com.au' }, edit: true, shift: shiftA }); E.$('vpAeSkip').click();
check('closing the editor does not mark them as skipped', E.ss.getItem('vpAboutEmailLater:h9') === null && E.done.join() === 'later');

section('4. The console');
function runProceed(ctx, ayWants, emailWants) {
  var R = { order: [] };
  var fn = new Function('__ctx', 'window', 'VPAboutYou', 'VPFirstRun', 'VP', 'go', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'pairToVenue', '$',
    lift(INDEX, 'proceedVenue') + '\nreturn proceedVenue;');
  var AYs = { wants: function () { return ayWants; }, wantsEmail: function () { return emailWants; }, open: function (c, d) { R.order.push('aboutyou'); R.onDone = d.onDone; }, openEmail: function (c, d) { R.order.push('email'); R.onDone2 = d.onDone; } };
  var FR = { wants: function () { return true; }, open: function () { R.order.push('firstrun'); } };
  var VPs = { getClient: function () { return {}; }, holdGate: function () { return false; }, termsGate: function () { return false; } };
  var win = { VPAboutYou: AYs, VPFirstRun: FR, VP: VPs };
  var p = fn(ctx, win, AYs, FR, VPs, function (v) { R.order.push('go ' + v); }, function () {}, function () {}, function () { return false; }, function () { R.order.push('venuepick'); }, function () { R.order.push('pair'); return true; }, function () { return { value: '', focus: function () {} }; });
  p(); R.again = function () { emailWants = false; R.onDone2('saved'); }; return R;
}
var P1 = runProceed({ venue: { slug: 'x' }, staff: [{ venue_id: 'a' }, { venue_id: 'b' }] }, false, true);
check('a host with a mobile and no email: asked for it BEFORE the venue pick, nothing else opens behind it', P1.order.join() === 'email,go vBoot', P1.order);
P1.again();
check('once it is done the console carries on to the venue pick as before', P1.order.slice(2).join() === 'venuepick', P1.order);
var P2 = runProceed({ venue: { slug: 'x' }, staff: [{}] }, true, true);
check('a login with no mobile: name and mobile come first, the email is not asked over the top of them', P2.order.join() === 'aboutyou,go vBoot', P2.order);
var P3 = runProceed({ venue: { slug: 'x' }, staff: [{}] }, false, false);
check('a login with an email goes straight on, untouched', P3.order.indexOf('email') === -1 && P3.order[0] === 'firstrun', P3.order);
check('index.html has a "My email" header button that reopens it in edit mode, shown only to a venue login with a mobile',
  /id="myEmailBtn"[^>]*>My email</.test(INDEX) && /VPAboutYou\.openEmail\(__ctx, \{ client:VP\.getClient\(\), edit:true/.test(INDEX) && /me\.style\.display = \(__ctx && __ctx\.authed && !__ctx\.isAdmin && __ctx\.scope==="staff" && __ctx\.user && __ctx\.user\.phone\)/.test(INDEX));

if (bad) throw new Error('email step: ' + bad + ' of ' + ran + ' failed');
print(''); print('ALL ' + ran + ' CHECKS PASSED');
