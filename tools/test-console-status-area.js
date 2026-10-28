/* THE BARS A CONSOLE SHOWS SIT IN ONE COLUMN, AND A SWITCHED-OFF VENUE GETS ONE CARD.

   Dean, 28 Oct 2026: HQ View as "The Jolly Jess" (suspended for nonpayment) -> Trivia showed the red
   signing bar, the gold View-as bar and the orange unpaid bar painted over each other, the unpaid bar
   offered "another round of bingo" on the trivia page, the red bar told HQ to sign in with a host login
   it does not have, and underneath sat the whole quiz setup as if a game could run.

   This RUNS the real code: venueplay/app/vp-session.js and vp-sign.js loaded into a small fake page,
   the View-as bar builders lifted out of index.html, billing.html and marketing.html, and the boot
   callback of every game console (trivia, musical, raffle, members, purchase raffle) plus index.html's
   proceedVenue, called with a suspended venue. Nothing here reads the source for a word.

   Run: jsc tools/test-console-status-area.js */
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + saw : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- a small DOM: enough tree for order, parents and ids ---------------- */
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = ''; this.className = ''; this.children = [];
  this.parentNode = null; this.style = {}; this.attrs = {}; this.textContent = ''; this._html = ''; this._htmlKids = [];
  this.handlers = {}; this.href = '';
}
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (h) {
    this._html = String(h); this._htmlKids = [];
    var re = /<(\w+)([^>]*)>/g, m;
    while ((m = re.exec(this._html))) {
      var idm = /\bid="([^"]+)"/.exec(m[2]); if (!idm) continue;
      var k = new El(m[1]); k.id = idm[1]; k.parentNode = this;
      var hr = /\bhref="([^"]+)"/.exec(m[2]); if (hr) k.href = hr[1];
      var rest = this._html.slice(re.lastIndex); k.textContent = rest.slice(0, rest.indexOf('<'));
      this._htmlKids.push(k);
    }
  }
});
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
El.prototype.click = function () { (this.handlers.click || []).forEach(function (f) { f({ preventDefault: function () {} }); }); };
El.prototype.focus = function () {};
El.prototype.classList = null;
function walk(el, fn) { if (fn(el)) return el; var all = el.children.concat(el._htmlKids); for (var i = 0; i < all.length; i++) { var r = walk(all[i], fn); if (r) return r; } return null; }
function text(el) { return (el.textContent || '') + ' ' + (el._html || '').replace(/<[^>]+>/g, ' '); }
function cssOf(el) { return String(el.style.cssText || '') + ';position:' + (el.style.position || ''); }

function makePage() {
  var body = new El('body'), head = new El('head');
  var header = new El('header'); header.id = 'pageHeader'; body.appendChild(header);
  var wrap = new El('div'); wrap.className = 'wrap'; body.appendChild(wrap);
  ['signinView', 'connectView', 'consoleView'].forEach(function (id) { var v = new El('div'); v.id = id; wrap.appendChild(v); });
  var document = {
    body: body, head: head, documentElement: body,
    createElement: function (t) { return new El(t); },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); },
    querySelector: function (sel) { var c = sel.replace(/^\./, ''); return walk(body, function (e) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }); },
    querySelectorAll: function () { return []; }, addEventListener: function () {}
  };
  return { document: document, body: body, wrap: wrap, header: header };
}

/* ---------------- load the real shared scripts into a page ---------------- */
var SESSION = readFile('venueplay/app/vp-session.js');
var SIGN = readFile('venueplay/app/vp-sign.js');
var VENUES = {
  JJ: { id: 'JJ', slug: 'the-jolly-jess', name: 'The Jolly Jess', status: 'suspended', suspended_reason: 'nonpayment' }
};
function q(rows) {
  var b = { _rows: rows, select: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
    eq: function (k, v) { b._rows = b._rows.filter(function (r) { return String(r[k]) === String(v); }); return b; },
    'in': function (k, vs) { b._rows = b._rows.filter(function (r) { return vs.indexOf(r[k]) >= 0; }); return Promise.resolve({ data: b._rows }); },
    maybeSingle: function () { return Promise.resolve({ data: b._rows[0] || null }); },
    then: function (res, rej) { return Promise.resolve({ data: b._rows }).then(res, rej); } };
  return b;
}
function boot(who) {
  var P = makePage();
  var store = { vpCurrentVenue: 'JJ' }, sess = { vpVenueExplicit: 'JJ' };
  var db = { vp_platform_admins: who.admin ? [{ auth_user_id: 'u1', role: 'owner', label: 'HQ' }] : [],
             vp_venue_staff: (who.staff || []).map(function (id) { return { auth_user_id: 'u1', venue_id: id, role: who.role || 'owner' }; }),
             vp_venues: [VENUES.JJ], vp_venue_settings: [] };
  var client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'u1' } } } }); } },
                 from: function (t) { return q((db[t] || []).slice()); } };
  var window = { location: { pathname: '/app/trivia/host.html', search: '' }, supabase: { createClient: function () { return client; } },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = v; }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function (k) { return k in sess ? sess[k] : null; }, setItem: function (k, v) { sess[k] = v; }, removeItem: function (k) { delete sess[k]; } },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, fetch: function () { return Promise.reject(new Error('no')); },
    crypto: { subtle: { importKey: function () { return Promise.resolve({}); }, sign: function () { return Promise.resolve(new ArrayBuffer(8)); },
      verify: function () { return Promise.resolve(true); }, generateKey: function () { return Promise.reject(new Error('not here')); } } } };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', SESSION))
    (window, P.document, window.localStorage, window.sessionStorage, window.location);
  // vp-sign: the venue enforces signing and the Worker hands this login no key.
  var fetch = function (url) {
    var d = /signing\/public/.test(url) ? { exists: true, public_jwk: { k: 1 }, enforce: true } : null;
    return Promise.resolve({ ok: !!d, json: function () { return Promise.resolve(d); } });
  };
  (new Function('window', 'document', 'fetch', 'setInterval', 'TextEncoder', 'console', 'btoa', 'atob', SIGN))
    (window, P.document, fetch, function () { return 1; }, function () { this.encode = function (s) { return { length: s.length }; }; },
     { warn: function () {}, log: function () {} }, function (s) { return s; }, function (s) { return s; });
  var ctx = null;
  window.VP.ready().then(function (c) { ctx = c; });
  drainMicrotasks();
  P.window = window; P.VP = window.VP; P.ctx = ctx; P.store = store;
  return P;
}
function statusIds(P) {
  var box = P.document.getElementById('vpStatus');
  return box ? box.children.map(function (c) { return c.id; }) : [];
}

/* lift a named function out of a page, brace-matched */
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
function liftAfter(src, marker) {
  var i = src.indexOf(marker);
  if (i < 0) throw new Error('cannot find ' + marker);
  var s = src.indexOf('function', i), d = 0, k = src.indexOf('{', s);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(s, k);
}

/* Run a lifted function with every free name it uses answered: the ones given, or a recording spy. */
function runLifted(fnText, over, log) {
  function spy(path) {
    var f = function () { log.push(path); return spy(path + '()'); };
    return new Proxy(f, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) return function () { return ''; };
        if (typeof k === 'symbol') return undefined;
        if (k === 'length') return 0;
        return spy(path + '.' + String(k));
      },
      set: function () { return true; }
    });
  }
  var scope = new Proxy({}, {
    has: function (t, k) { if (typeof k === 'symbol') return false; if (k in over) return true; return !(k in globalThis); },
    get: function (t, k) { if (k === Symbol.unscopables) return undefined; return (k in over) ? over[k] : spy(String(k)); },
    set: function (t, k, v) { over[k] = v; return true; }
  });
  return (new Function('__scope', 'with(__scope){ return (' + fnText + '); }'))(scope);
}
function vpFor(P, log) {
  return new Proxy(P.VP, { get: function (t, k) {
    if (k === 'holdGate') return function (c, o) { var r = t.holdGate(c, o); log.push('VP.holdGate=' + r); return r; };
    if (k in t && /^(statusBar|suspensionBanner|holdWords|getContext)$/.test(String(k))) return t[k];
    return function () { log.push('VP.' + String(k)); return { then: function () { return { catch: function () {} }; } }; };
  } });
}

/* =============================================================================================== */
section('1. One status area: the bars stack in a fixed order and none sits over another or the header');
var P = boot({ admin: true });
ok('HQ View as of The Jolly Jess resolves as an admin at that venue', P.ctx && P.ctx.role === 'admin' && P.ctx.currentVenueId === 'JJ', P.ctx && P.ctx.role);
// Painted in the WORST order: View-as first, then the signing bar, then the unpaid bar.
var INDEX = readFile('venueplay/app/index.html');
var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
runLifted(lift(INDEX, 'showImpBanner'), { document: P.document, window: P.window, VP: P.VP, esc: esc, localStorage: P.window.localStorage }, [])('The Jolly Jess');
P.window.VPSign.initHost('https://w', 'the-jolly-jess', function () { return 'tok'; });
drainMicrotasks();
P.VP.suspensionBanner(P.ctx);
var ids = statusIds(P);
ok('unpaid first, then the signing key, then View as', ids.join(',') === 'vpSuspendBar,vpCantSign,vpImpBar', ids.join(','));
ok('the status area is the first thing on the page, above the header, not on top of it',
   P.body.children[0] && P.body.children[0].id === 'vpStatus' && P.body.children[1] === P.header,
   P.body.children.map(function (c) { return c.id || c.tagName; }).join(','));
var box = P.document.getElementById('vpStatus');
var stuck = [box].concat(box.children).filter(function (e) { return /position:\s*(sticky|fixed)/.test(e.style.cssText || '') || /^(sticky|fixed)$/.test(e.style.position || ''); });
ok('nothing in the status area is sticky or fixed, so nothing is painted over anything', stuck.length === 0, stuck.map(function (e) { return e.id; }).join(','));
ok('exactly one of each bar on the page', ['vpSuspendBar', 'vpCantSign', 'vpImpBar'].every(function (id) {
  var n = 0; walk(P.body, function (e) { if (e.id === id) n++; return false; }); return n === 1; }));
P.window.VPSign._cantSignBar(false);
ok('taking the signing bar away leaves the other two in order', statusIds(P).join(',') === 'vpSuspendBar,vpImpBar', statusIds(P).join(','));
P.window.VPSign._cantSignBar(true);
ok('putting it back puts it back between them', statusIds(P).join(',') === 'vpSuspendBar,vpCantSign,vpImpBar', statusIds(P).join(','));
var sticky = new El('div'); sticky.id = 'vpLinkTest'; sticky.style.position = 'sticky'; sticky.style.top = '0';
P.VP.statusBar('link', sticky);
ok('a bar handed in sticky is made to sit in the column, not float over it', sticky.style.position === 'static' && sticky.style.top === 'auto', sticky.style.position);
P.VP.statusBar('link', null);
var red = P.document.getElementById('vpCantSign');
ok('the signing bar text is centred, like the unpaid bar', /text-align:\s*center/.test(red.style.cssText || ''), red.style.cssText);

section('2. The signing bar says what is true for HQ, and for a host');
var hqText = text(red);
ok('HQ is told it is viewing as HQ and cannot run a game here',
   /You are viewing as HQ\. HQ can look around but cannot run a game here, because the TV and phones only accept this venue's own hosts\./.test(hqText), hqText);
ok('HQ is not told to sign in with a host login it does not have', !/sign (out|back in)|host login/i.test(hqText), hqText);
var H = boot({ staff: ['JJ'], role: 'host' });
H.window.VPSign._cantSignBar(true);
var hostText = text(H.document.getElementById('vpCantSign'));
ok('a host is told the TV and phones will ignore the console and to sign back in', /TV and phones will ignore this console/.test(hostText) && /Sign out and sign back in/.test(hostText), hostText);
ok('a host is not told about HQ View as', !/HQ/.test(hostText), hostText);

section('3. The unpaid bar names no game');
var bar = text(P.document.getElementById('vpSuspendBar'));
ok('it pours "another round", not another round of bingo, trivia or anything', /pour you another round\./.test(bar) && !/round of/i.test(bar) && !/bingo|trivia|musical|raffle|members draw/i.test(bar), bar);
var link = /href="([^"]+)"/.exec(P.document.getElementById('vpSuspendBar').innerHTML);
ok('its Update your card link works from a console one folder down', link && link[1] === '/app/billing.html#pastDue', link && link[1]);

section('4. billing.html and marketing.html put their View-as bar in the same column');
[['billing.html', function (src) { return lift(src, 'impBillingBanner'); }, 'Billing for'],
 ['marketing.html', function (src) { return lift(src, 'viewingAsBanner'); }, 'Marketing numbers for']].forEach(function (pg) {
  var B = boot({ admin: true });
  B.window.localStorage.setItem('vpImpersonate', JSON.stringify({ id: 'JJ', name: 'The Jolly Jess' }));
  B.VP.suspensionBanner(B.ctx);
  runLifted(pg[1](readFile('venueplay/app/' + pg[0])), { document: B.document, window: B.window, VP: B.VP, esc: esc, localStorage: B.window.localStorage }, [])();
  ok(pg[0] + ': the unpaid bar then the View-as bar, one column', statusIds(B).join(',') === 'vpSuspendBar,vpImpBar' && new RegExp(pg[2]).test(text(B.document.getElementById('vpImpBar'))), statusIds(B).join(','));
});

section('5. A switched-off venue gets ONE card, in words that fit the reason');
function card(reason, role) {
  var C = boot({ staff: ['JJ'], role: role });
  var ctx = { venue: { id: 'JJ', status: 'suspended', suspended_reason: reason }, role: role, currentVenueId: 'JJ' };
  C.VP.suspensionBanner(ctx);   // the page had already painted the unpaid bar
  var held = C.VP.holdGate(ctx);
  var c = C.document.getElementById('vpHoldCard');
  return { held: held, card: c, C: C, words: c ? text(c) : '', pay: C.document.getElementById('vpHoldPay') };
}
var np = card('nonpayment', 'owner');
ok('nonpayment: the gate holds the console', np.held === true);
ok('nonpayment: "This venue is switched off until the card is updated"', /This venue is switched off until the card is updated/.test(np.words), np.words);
ok('nonpayment, owner: an Update your card link to billing', np.pay && np.pay.href === '/app/billing.html#pastDue' && /Update your card/.test(np.pay.textContent), np.pay && np.pay.href);
var nh = card('nonpayment', 'host');
ok('nonpayment, a host: no card link they cannot use, and told to ask the owner', !nh.pay && /Ask the venue owner/.test(nh.words), nh.words);
var en = card('ended', 'owner'), ar = card('archived', 'owner');
ok('ended: "This venue\'s subscription has ended"', /This venue's subscription has ended/.test(en.words) && !en.pay, en.words);
ok('archived: the same', /This venue's subscription has ended/.test(ar.words), ar.words);
ok('no card says "suspended"', [np, nh, en, ar].every(function (x) { return !/suspended/i.test(x.words); }));
ok('the card is the only thing showing in the page body', np.C.wrap.children.every(function (k) { return k === np.card || k.style.display === 'none'; }),
   np.C.wrap.children.map(function (k) { return k.id + ':' + k.style.display; }).join(','));
ok('and the card replaces the unpaid bar rather than repeating it', !np.C.document.getElementById('vpSuspendBar'));
ok('the card has no start control', !walk(np.card, function (e) { return /start|lobby|open/i.test(e.id) || /Start|Open lobby/.test(e.textContent || ''); }));
var live = np.C.VP.holdGate({ venue: { id: 'X', status: 'active' }, role: 'owner' });
ok('an active venue: the gate answers false and the page comes back as it was',
   live === false && !np.C.document.getElementById('vpHoldCard') && np.C.wrap.children.every(function (k) { return k.style.display === ''; }));

section('6. Every game console stops at the card: no key, no TV, no setup');
var SUSP = { authed: true, currentVenueId: 'JJ', role: 'admin', isAdmin: true, staff: [],
             venue: { id: 'JJ', slug: 'the-jolly-jess', name: 'The Jolly Jess', status: 'suspended', suspended_reason: 'nonpayment' } };
var FORBID = /initHost|connect|claim|restore|loadQuestionSets|loadAll|loadSavedPrizes|^load\(|loadSettings|weeklyPreCheck|listVenues|showPaidField|VP_PICKUP/;
['trivia/host.html', 'musical/host.html', 'raffle/host.html', 'members/host.html', 'purchase-raffle/index.html'].forEach(function (pg) {
  var C = boot({ admin: true }), log = [];
  var src = readFile('venueplay/app/' + pg);
  var fn = runLifted(liftAfter(src, 'VP.ready().then('), {
    document: C.document, window: C.window, VP: vpFor(C, log), VPSign: { initHost: function () { log.push('VPSign.initHost'); } },
    $: function (id) { return C.document.getElementById(id) || new El('div'); },
    show: function (id, on) { log.push('show:' + id + ':' + on); }
  }, log);
  fn(SUSP);
  var c = C.document.getElementById('vpHoldCard');
  var badCalls = log.filter(function (l) { return FORBID.test(l); });
  ok(pg + ': the one card shows', !!c && /switched off until the card is updated/.test(text(c)), log.join(' '));
  ok(pg + ': nothing after it runs (no signing key, no TV, no setup load)', badCalls.length === 0, badCalls.join(' '));
  ok(pg + ': no Start control or setup on show, only the card', !!c && C.wrap.children.every(function (k) { return k === c || k.style.display === 'none'; }) &&
     !/staff/i.test(text(c)));
  ok(pg + ': the 4 hour sign-out still applies', log.some(function (l) { return /enforceShift/.test(l); }), log.join(' '));
});
(function () {
  var C = boot({ admin: true }), log = [];
  var ctx = { authed: true, currentVenueId: 'JJ', role: 'owner', staff: [{ venue_id: 'JJ' }, { venue_id: 'OTHER' }],
              venue: { id: 'JJ', slug: 'the-jolly-jess', status: 'suspended', suspended_reason: 'nonpayment' } };
  var picked = 0;
  var fn = runLifted(lift(INDEX, 'proceedVenue'), {
    document: C.document, window: C.window, VP: vpFor(C, log), __ctx: ctx,
    venuePickFresh: function () { return true; }, showVenuePick: function () { picked++; },
    pairToVenue: function () { log.push('pairToVenue'); return true; }, go: function (v) { log.push('go:' + v); },
    $: function (id) { return C.document.getElementById(id) || new El('div'); }
  }, log);
  fn();
  var c = C.document.getElementById('vpHoldCard');
  ok('index.html (bingo): the one card, and no TV pairing', !!c && log.indexOf('pairToVenue') < 0, log.join(' '));
  var other = C.document.getElementById('vpHoldOther');
  ok('index.html: a host with two venues can choose another from the card', !!other && /Choose another venue/.test(other.textContent));
  if (other) other.click();
  ok('index.html: choosing another venue takes the card away and opens the picker', picked === 1 && !C.document.getElementById('vpHoldCard'));
})();

section('7. A host pressing Start at a switched-off venue is never told to "have a word with the staff"');
var ROOM = 'Games are paused here tonight. Have a word with the staff.';
[['trivia/host.html', 'apiPost'], ['musical/host.html', 'apiPost'], ['raffle/host.html', 'apiPost'],
 ['members/host.html', 'apiPost'], ['purchase-raffle/index.html', 'api']].forEach(function (pg) {
  var C = boot({ staff: ['JJ'], role: 'owner' });
  // The page loaded while the venue was still on; the Worker switched it off since.
  C.document.getElementById('vpHoldCard') && C.VP.holdGate(null);
  var src = readFile('venueplay/app/' + pg[0]);
  var res = { ok: false, status: 403, json: function () { return Promise.resolve({ error: ROOM }); } };
  var over = { document: C.document, window: C.window, VP: C.VP, VP_GAME_API: 'https://w', AbortController: undefined,
    getToken: function () { return Promise.resolve('tok'); }, fetch: function () { return Promise.resolve(res); },
    setTimeout: function () { return 0; }, clearTimeout: function () {} };
  if (/readApi/.test(lift(src, pg[1]))) over.readApi = runLifted(lift(src, 'readApi'), over, []);
  var said = null;
  runLifted(lift(src, pg[1]), over, [])('/session', { venue_id: 'JJ', format: 'musical' }).then(null, function (e) { said = String(e && e.message); });
  drainMicrotasks();
  ok(pg[0] + ': the host is told in a host\'s words, never "staff"', said && !/staff/i.test(said) && /switched off/.test(said), said);
  var c = C.document.getElementById('vpHoldCard');
  ok(pg[0] + ': and the page swaps to the switched-off card, with Start gone', !!c && /switched off until the card is updated/.test(text(c)) &&
     C.wrap.children.every(function (k) { return k === c || k.style.display === 'none'; }), c ? text(c) : 'no card');
});
(function () {
  var C = boot({ staff: ['JJ'], role: 'owner' });
  ok('any other refusal passes through unchanged', C.VP.hostRefusal(403, 'Only a manager can do that') === 'Only a manager can do that' &&
     C.VP.hostRefusal(500, ROOM) === ROOM && !C.document.getElementById('vpHoldCard'));
})();

print('');
print(ran - bad + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' failed');
