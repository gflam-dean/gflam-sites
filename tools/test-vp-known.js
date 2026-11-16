/* A KNOWN PHONE ON THE JOIN SCREEN (INBOX 416, Sunday 22 Nov 2026): venueplay/app/vp-known.js, with the shipped
   vp-details.js and vp-consent.js, RUN against a small DOM. The Worker half is tools/test-known-phone.js.
     - the key: kept only when it is a real key, newest first, eight at most, forgotten by "Not me", sent at send time
     - a known phone: "Welcome back, Alan", the name box filled and hidden (bingo, musical), only the missing boxes,
       no one tick again; trivia keeps the team name and leaves the first name to the Worker
     - "Not me": the key goes, the full form comes back (every box, every consent box)
     - never a value we hold on the screen: the phone is never given one, and nothing here prints one
     - the three boxes (Moshtix style): pre-ticked, the Worker's names, the exact words, each answer its own; the venue's
       box is the venue's tick
     - the join line's words; no em dashes; a slow or failed ask is the full form
     - the first-name box for trivia, the required-mobile flag

   Run from the repo root:  jsc tools/test-vp-known.js */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); } }

function El(tag) {
  this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.className = '';
  this.listeners = {}; this._text = ''; this.type = ''; this.id = ''; this.checked = false; this.value = ''; this.attrs = {}; this.style = { display: '' };
}
El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
El.prototype.insertBefore = function (c, ref) { if (c.parentNode) c.parentNode.removeChild(c); var i = this.children.indexOf(ref); c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; };
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); };
El.prototype.getAttribute = function (k) { return (k in this.attrs) ? this.attrs[k] : null; };
El.prototype.walk = function (f) { f(this); for (var i = 0; i < this.children.length; i++) this.children[i].walk(f); };
El.prototype.querySelector = function (sel) { var tag = sel.toUpperCase(), hit = null; for (var i = 0; i < this.children.length && !hit; i++) this.children[i].walk(function (e) { if (!hit && e.tagName === tag) hit = e; }); return hit; };
El.prototype.closest = function (sel) { var e = this; while (e) { if (sel.charAt(0) === '.' ? (' ' + e.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0 : e.tagName === sel.toUpperCase()) return e; e = e.parentNode; } return null; };
El.prototype.click = function () { if (this.type === 'checkbox') this.checked = !this.checked; var l = (this.listeners.click || []).concat(this.listeners.change || []); for (var i = 0; i < l.length; i++) l[i].call(this); };
El.prototype.focus = function () {};
Object.defineProperty(El.prototype, 'isConnected', { get: function () { var e = this; while (e.parentNode) e = e.parentNode; return e === BODY; } });
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { if (this._isText) return this._text; var s = this._text; for (var i = 0; i < this.children.length; i++) s += this.children[i].textContent; return s; },
  set: function (v) { this._text = String(v); this.children = []; }
});
/* innerHTML: only what vp-details.js writes, <div class="field"><input ...></div>, parsed into real elements */
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (h) {
    this._html = String(h); this.children = []; this._text = '';
    var re = /<input([^>]*)>/g, m;
    while ((m = re.exec(h))) {
      var f = new El('div'); f.className = 'field';
      var i = new El('input'), ar = /([a-z-]+)="([^"]*)"/g, a;
      while ((a = ar.exec(m[1]))) { i.setAttribute(a[1], a[2]); if (a[1] === 'type') i.type = a[2]; }
      f.appendChild(i); this.appendChild(f);
    }
  }
});
var BODY = new El('body');
var document = {
  body: BODY,
  createElement: function (t) { return new El(t); },
  createTextNode: function (s) { var e = new El('#text'); e._isText = true; e._text = String(s); return e; },
  getElementById: function (id) { var hit = null; BODY.walk(function (e) { if (!hit && e.id === id) hit = e; }); return hit; }
};
var window = this;
var LSD = {};
var localStorage = { getItem: function (k) { return (k in LSD) ? LSD[k] : null; }, setItem: function (k, v) { LSD[k] = String(v); }, removeItem: function (k) { delete LSD[k]; } };
window.localStorage = localStorage;
var TIMERS = [];
function setTimeout(f) { TIMERS.push(f); return TIMERS.length; }
window.setTimeout = setTimeout;
function runTimers() { var t = TIMERS; TIMERS = []; t.forEach(function (f) { f(); }); }
var FETCH = null;
function fetch(u, o) { return FETCH(u, o); }
window.fetch = fetch;

(0, eval)(readFile('venueplay/app/vp-details.js'));
(0, eval)(readFile('venueplay/app/vp-consent.js'));
(0, eval)(readFile('venueplay/app/vp-known.js'));

function k(c) { var s = ''; for (var i = 0; i < 64; i++) s += c; return s; }
function page() {
  BODY.children = [];
  var head = new El('div'); head.id = 'joinHead'; head.textContent = 'Your name'; BODY.appendChild(head);
  var nameIn = new El('input'); nameIn.id = 'nameIn'; BODY.appendChild(nameIn);
  var box = new El('div'); box.id = 'joinExtra'; BODY.appendChild(box);
  return { head: head, nameIn: nameIn, box: box };
}
function ids(box) { var out = []; box.walk(function (e) { if (e.tagName === 'INPUT' && e.id) out.push(e.id); }); return out; }
function labels(box) { var out = []; box.walk(function (e) { if (e.tagName === 'LABEL') out.push(e); }); return out; }
var ALL = { first_name: true, last_name: false, postcode: false, email: true, mobile: true, mobile_required: false, marketing_optin: true };
var THREE = { mode: 'three', version: 'vpc-4-22nov', parties: [{ party: 'venueplay', name: 'venueplay' }, { party: 'venue', name: 'The Royal' }, { party: 'host', name: 'Quiz Masters Co' }] };

(async function () {
  print('1. THE KEY');
  LSD = {};
  show('no keys at first', VPKnown.keys().length === 0);
  show('a reply with no key keeps nothing', VPKnown.keep({ token: 'x' }) === false && VPKnown.keys().length === 0);
  show('junk is never kept (not 64 hex)', VPKnown.keep({ known_key: 'abc' }) === false && VPKnown.keep({ known_key: k('Z') }) === false && VPKnown.keys().length === 0);
  VPKnown.keep({ known_key: k('a') }); VPKnown.keep({ known_key: k('b') });
  show('a real key is kept, newest first', VPKnown.keys().join() === [k('b'), k('a')].join(), VPKnown.keys());
  VPKnown.keep({ known_key: k('a') });
  show('the same key twice is one key, moved to the front', VPKnown.keys().length === 2 && VPKnown.keys()[0] === k('a'));
  'cdefghij'.split('').forEach(function (c) { if (/[0-9a-f]/.test(c)) VPKnown.keep({ known_key: k(c) }); });
  for (var n = 0; n < 6; n++) VPKnown.keep({ known_key: k(String(n)) });
  show('eight at most', VPKnown.keys().length === 8, VPKnown.keys().length);
  var b = VPKnown.addTo({ code: 'X' });
  show('the keys go on a join body, read at send time', b.known_keys && b.known_keys.length === 8 && b.known_keys[0] === k('5'));
  var before = VPKnown.keys().slice(); VPKnown.forget(1);
  show('forget(ix) drops exactly that key', VPKnown.keys().length === 7 && VPKnown.keys().indexOf(before[1]) < 0 && VPKnown.keys()[0] === before[0]);
  LSD = {}; b = VPKnown.addTo({ code: 'X' });
  show('no keys: the body has no known_keys at all', !('known_keys' in b));
  LSD = { vpKnownKeys: 'not json' };
  show('a spoiled store reads as no keys, no error', VPKnown.keys().length === 0);

  print('2. A NEW PHONE: THE FULL FORM');
  LSD = {};
  var P = page();
  var h = VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'single' }, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn, head: P.head, venueName: 'The Royal' });
  show('bingo/musical: email and mobile boxes, no first-name box (the name box is the first name)', ids(P.box).join() === 'xEmail,xMobile,xOptin', ids(P.box));
  show('the name box is on screen and the heading is the page\'s own', P.nameIn.style.display === '' && P.head.textContent === 'Your name');
  show('the one tick, unticked, as today', labels(P.box).length === 1 && document.getElementById('xOptin').checked === false);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: null, kind: 'team', nameIn: P.nameIn, venueName: 'The Royal' });
  show('trivia: its own first-name box first (the name box is a TEAM name)', ids(P.box)[0] === 'xFirst' && ids(P.box).indexOf('xMobile') > 0, ids(P.box));

  print('3. A KNOWN PHONE: "WELCOME BACK", ONLY WHAT IS MISSING');
  LSD = {}; VPKnown.keep({ known_key: k('a') });
  P = page();
  var INFO = { known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'single' }, organiser: 'The Royal' };
  var after = null;
  h = VPKnown.paint({ box: P.box, collect: ALL, info: INFO, kind: 'person', nameIn: P.nameIn, head: P.head, headWords: 'Your name', venueName: 'The Royal', after: function (hh, info) { after = [hh, info]; } });
  show('the heading says "Welcome back, Alan"', P.head.textContent === 'Welcome back, Alan', P.head.textContent);
  show('the name box is filled with the first name and out of the way', P.nameIn.value === 'Alan' && P.nameIn.style.display === 'none');
  show('nothing is missing: no boxes at all, and no tick again', ids(P.box).length === 0 && h === '', ids(P.box));
  show('a "Not me" link', !!document.getElementById('vpKnownNotMe') && document.getElementById('vpKnownNotMe').textContent === 'Not me');
  show('the page\'s after() is called with the boxes and the answer', after && after[0] === '' && after[1] === INFO);
  var shown = ''; BODY.walk(function (e) { if (e._text) shown += e._text + ' '; });
  show('the screen shows no detail but the first name (no number, no @)', !/\d{3}|@/.test(shown), shown);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Alan', need: ['email'], ix: 0 }, consent: { mode: 'single' } }, kind: 'person', nameIn: P.nameIn, head: P.head });
  show('the venue added email since: ONLY the email box', ids(P.box).join() === 'xEmail', ids(P.box));
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: INFO, kind: 'team', nameIn: P.nameIn, venueName: 'The Royal' });
  show('trivia: the team name box stays, no first-name or mobile box', P.nameIn.style.display === '' && ids(P.box).length === 0, ids(P.box));
  var greet = document.getElementById('vpKnownHi');
  show('...and the hello is a line of its own: "Welcome back, Alan. Not me"', greet && greet.textContent === 'Welcome back, Alan. Not me', greet && greet.textContent);
  var cap = VPKnown.capture({ first_name: 'Quiz Kids' });
  show('a known trivia phone sends no team name as a first name (the Worker fills the real one)', !('first_name' in cap), cap);

  print('4. "NOT ME"');
  LSD = {}; VPKnown.keep({ known_key: k('b') }); VPKnown.keep({ known_key: k('a') });
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'three', version: 'vpc-4-22nov', parties: [], all: THREE.parties }, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn, head: P.head, headWords: 'Your name', venueName: 'The Royal' });
  show('known, every box answered: no consent boxes drawn', labels(P.box).length === 0);
  document.getElementById('vpKnownNotMe').click();
  show('the key at that place is forgotten, the other kept', VPKnown.keys().join() === k('b'), VPKnown.keys());
  show('the name box is back, empty; the heading is the page\'s own', P.nameIn.style.display === '' && P.nameIn.value === '' && P.head.textContent === 'Your name', [P.nameIn.style.display, P.nameIn.value, P.head.textContent]);
  show('the full form: email and mobile', ids(P.box).indexOf('xEmail') >= 0 && ids(P.box).indexOf('xMobile') >= 0, ids(P.box));
  show('every consent box this game has, ticked', labels(P.box).length === 3 && labels(P.box).every(function (l) { return l.querySelector('input').checked === true; }));
  show('no hello left', !document.getElementById('vpKnownHi'));

  print('5. THE THREE BOXES (MOSHTIX STYLE)');
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: THREE, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn, head: P.head, venueName: 'The Royal' });
  var L = labels(P.box);
  show('three boxes: venueplay, the venue, the host, by the Worker\'s names', L.map(function (l) { return l.textContent.trim(); }).join('|') === 'venueplay|The Royal|Quiz Masters Co', L.map(function (l) { return l.textContent; }));
  show('all PRE-TICKED', L.every(function (l) { return l.querySelector('input').checked === true; }));
  show('no one tick beside them', !document.getElementById('xOptin'));
  var all = ''; P.box.walk(function (e) { if (e._text) all += e._text + '\n'; });
  show('the heading words exact', all.indexOf('Yes! Send me news and offers by SMS and email from:') >= 0, all);
  show('the line under exact', all.indexOf('Each one uses your details under its own privacy policy. Unsubscribe any time.') >= 0);
  show('no em dash anywhere in the words', (VPConsent.THREE_HEAD + VPConsent.THREE_NOTE + VPKnown.line('X')).indexOf('—') < 0);
  document.getElementById('xC_host').click();
  var A = VPConsent.answers();
  show('each answer its own: the host unticked, the others still yes', A.venueplay === true && A.venue === true && A.host === false, A);
  cap = VPKnown.capture({ first_name: 'Sam', mobile: '0412345678' });
  show('the answers go on the join body as consent', cap.consent && cap.consent.host === false && cap.consent.venue === true, cap);
  show('the venue box is the venue\'s tick (with a contact method)', VPConsent.optedIn({ mobile: '0412345678' }) === true && VPConsent.optedIn({}) === false);
  document.getElementById('xC_venue').click();
  show('the venue box unticked: not opted in', VPConsent.optedIn({ mobile: '0412345678' }) === false);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'three', parties: [{ party: 'evil', name: 'X' }, { party: 'venue', name: '' }] } }, kind: 'person', nameIn: P.nameIn });
  show('a party the page does not know is never drawn; a venue with no name is "this venue"', labels(P.box).length === 1 && labels(P.box)[0].textContent.trim() === 'this venue', labels(P.box).map(function (l) { return l.textContent; }));
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'single' } }, kind: 'person', nameIn: P.nameIn });
  show('single mode: no answers object (the one tick, as today)', VPConsent.answers() === null && !('consent' in VPKnown.capture({})));

  print('6. THE JOIN LINE, THE ASK, THE BOXES');
  show('the join line: "Your details go to The Royal to run tonight\'s game and contact winners."', VPKnown.line('The Royal') === "Your details go to The Royal to run tonight's game and contact winners. ", VPKnown.line('The Royal'));
  show('no name: "the venue you are playing at"', VPKnown.line('') === "Your details go to the venue you are playing at to run tonight's game and contact winners. ");
  var asked = null;
  FETCH = function (u, o) { asked = { u: u, b: JSON.parse(o.body) }; return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'single' } }); } }); };
  LSD = {}; VPKnown.keep({ known_key: k('c') });
  var r = await VPKnown.withInfo(Promise.resolve({ collect: ALL }), 'https://game.example', 'ABC123');
  show('withInfo asks /join/known with the code and the keys, and puts the answer on as known_info', asked && asked.u === 'https://game.example/join/known' && asked.b.code === 'ABC123' && asked.b.keys[0] === k('c') && r.known_info && r.known_info.known.hello === 'Alan', asked);
  FETCH = function () { return Promise.reject(new Error('offline')); };
  r = await VPKnown.withInfo(Promise.resolve({ collect: ALL }), 'https://game.example', 'ABC123');
  show('a failed ask is the full form (known_info null), the join info still comes', r.known_info === null && r.collect === ALL);
  FETCH = function () { return new Promise(function () {}); };
  var pr = VPKnown.withInfo(Promise.resolve({ collect: ALL }), 'https://game.example', 'ABC123');
  runTimers();
  r = await pr;
  show('a slow ask never holds the join screen (null after ' + VPKnown.ASK_MS + ' ms)', r.known_info === null);
  FETCH = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ error: 'Too many' }); } }); };
  r = await VPKnown.withInfo(Promise.resolve({}), 'https://game.example', 'ABC123');
  show('an error answer is the full form', r.known_info === null);
  P = page();
  P.box.innerHTML = VPDetails.html({ first_name: true, mobile: true, mobile_required: true }, {});
  show('a required mobile box is marked data-required', document.getElementById('xMobile').getAttribute('data-required') === '1');
  show('...and empty, it is refused with its own words', VPDetails.mobileError() === VPDetails.MOBILE_NEEDED && VPDetails.MOBILE_NEEDED.indexOf('—') < 0);
  P.box.innerHTML = VPDetails.html({ first_name: true, mobile: true, mobile_required: false }, {});
  show('not required: empty is fine, a wrong one is still refused', VPDetails.mobileError() === '' && (document.getElementById('xMobile').value = '12', VPDetails.mobileError() === VPDetails.MOBILE_WRONG));
  show('no first-name box unless asked for (firstBox)', VPDetails.html({ first_name: true }, {}) === '' && /id="xFirst"/.test(VPDetails.html({ first_name: true }, { firstBox: true })));

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('vp-known: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
