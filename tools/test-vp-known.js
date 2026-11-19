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
El.prototype.replaceChild = function (n, o) { var i = this.children.indexOf(o); if (n.parentNode) n.parentNode.removeChild(n); i = this.children.indexOf(o); n.parentNode = this; this.children[i] = n; o.parentNode = null; return o; };
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
  var head = new El('div'); head.id = 'joinHead'; head.textContent = 'Join the game'; BODY.appendChild(head);
  var nameIn = new El('input'); nameIn.id = 'nameIn'; BODY.appendChild(nameIn);
  var box = new El('div'); box.id = 'joinExtra'; BODY.appendChild(box);
  return { head: head, nameIn: nameIn, box: box };
}
function shownText() { var t = ''; BODY.walk(function (e) { if (e._text) t += e._text + ' '; }); return t; }
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
  show('the name box is on screen and the heading is the page\'s own', P.nameIn.style.display === '' && P.head.textContent === 'Join the game');
  show('the one tick, unticked, as today', labels(P.box).length === 1 && document.getElementById('xOptin').checked === false);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: null, kind: 'team', nameIn: P.nameIn, venueName: 'The Royal' });
  show('trivia: its own first-name box first (the name box is a TEAM name)', ids(P.box)[0] === 'xFirst' && ids(P.box).indexOf('xMobile') > 0, ids(P.box));

  print('3. A KNOWN PHONE: "WELCOME BACK", ONLY WHAT IS MISSING');
  LSD = {}; VPKnown.keep({ known_key: k('a') });
  P = page();
  var INFO = { known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'single' }, organiser: 'The Royal' };
  var after = null;
  h = VPKnown.paint({ box: P.box, collect: ALL, info: INFO, kind: 'person', nameIn: P.nameIn, head: P.head, headWords: 'Join the game', venueName: 'The Royal', after: function (hh, info) { after = [hh, info]; } });
  var hi = document.getElementById('vpKnownHi');
  show('no name anywhere on the screen, only a small "Not my details" link (Dean 16 Nov, final)', hi && hi.textContent === 'Not my details' && !/alan|welcome|playing as/i.test(shownText()), shownText());
  show('the page heading is left as it is', P.head.textContent === 'Join the game', P.head.textContent);
  show('the name box is filled with the first name and out of the way', P.nameIn.value === 'Alan' && P.nameIn.style.display === 'none');
  show('nothing is missing: no boxes at all, and no tick again', ids(P.box).length === 0 && h === '', ids(P.box));
  show('the link is a button that says "Not my details"', !!document.getElementById('vpKnownNotMe') && document.getElementById('vpKnownNotMe').textContent === 'Not my details');
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
  show('...and trivia the same: "Not my details", no name', greet && greet.textContent === 'Not my details', greet && greet.textContent);
  var cap = VPKnown.capture({ first_name: 'Quiz Kids' });
  show('a known trivia phone sends no team name as a first name (the Worker fills the real one)', !('first_name' in cap), cap);

  print('4. "NOT ME"');
  LSD = {}; VPKnown.keep({ known_key: k('b') }); VPKnown.keep({ known_key: k('a') });
  P = page();
  var CUR = { mode: 'three', version: 'vpc-4-22nov', parties: [{ party: 'venueplay', name: 'venueplay', current: true }, { party: 'venue', name: 'The Royal', current: false }, { party: 'host', name: 'Quiz Masters Co' }] };
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Alan', need: [], ix: 0 }, consent: CUR, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn, head: P.head, headWords: 'Join the game', venueName: 'The Royal' });
  var cur = labels(P.box).map(function (l) { return l.querySelector('input').checked; });
  show('known: every box shows THAT sender\'s current answer; a new sender (the host) is a fresh, ticked box', cur.join() === 'true,false,true', cur);
  document.getElementById('vpKnownNotMe').click();
  show('the key at that place is forgotten, the other kept', VPKnown.keys().join() === k('b'), VPKnown.keys());
  show('the name box is back, empty; the heading is the page\'s own', P.nameIn.style.display === '' && P.nameIn.value === '' && P.head.textContent === 'Join the game', [P.nameIn.style.display, P.nameIn.value, P.head.textContent]);
  show('the full form: email and mobile', ids(P.box).indexOf('xEmail') >= 0 && ids(P.box).indexOf('xMobile') >= 0, ids(P.box));
  show('every consent box fresh and ticked (the normal empty form)', labels(P.box).length === 3 && labels(P.box).every(function (l) { return l.querySelector('input').checked === true; }));
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
  show('no em dash anywhere in the words', (VPConsent.THREE_HEAD + VPConsent.THREE_NOTE).indexOf('—') < 0);
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

  print('4b. ONE NUMBER PER PLAYER: "PLAYING AS", NEVER A SECOND NUMBER (Dean 17 Nov)');
  var M = '04•• ••• 246';
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Grace', need: [], confirm: [{ field: 'mobile', masked: M }], mobile_masked: M, change_number: false, ix: 0 }, consent: { mode: 'single' }, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn, venueName: 'The Royal' });
  var pa = document.getElementById('vpPlayingAs');
  show('one line: "Playing as Grace, 04.. ... 246"', pa && pa.textContent === 'Playing as Grace, ' + M, pa && pa.textContent);
  show('...no one-tap row, no "Different number", no mobile box: a second number is never typed into a join', !document.getElementById('vpkUse_mobile') && !document.getElementById('vpkUseNo_mobile') && ids(P.box).indexOf('xMobile') < 0 && shownText().indexOf('Different number') < 0, ids(P.box));
  show('...switch off: no "Not my number", only "Not me"', !document.getElementById('vpKnownNotNum') && document.getElementById('vpKnownNotMe').textContent === 'Not me');
  show('...and the venue\'s own tick is offered (unticked, as today)', !!document.getElementById('xOptin') && document.getElementById('xOptin').checked === false);
  cap = VPKnown.capture({ first_name: 'Grace' });
  show('the number on the line is the one used; without the venue\'s tick it is not a yes (the Worker passes it only with the tick)', cap.use_fields && cap.use_fields.join() === 'mobile' && !cap.marketing_optin, cap);
  document.getElementById('xOptin').click();
  cap = VPKnown.capture({ first_name: 'Grace' });
  show('...with the venue\'s tick: the number and the venue\'s yes go together', cap.use_fields.join() === 'mobile' && cap.marketing_optin === true, cap);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Grace', need: [], confirm: [], mobile_masked: M, ix: 0 }, consent: { mode: 'single' } }, kind: 'person', nameIn: P.nameIn, venueName: 'The Royal' });
  show('a venue that already has the number: the same line, nothing asked to be passed (the Worker fills it)', document.getElementById('vpPlayingAs').textContent === 'Playing as Grace, ' + M && !('use_fields' in VPKnown.capture({})));
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Grace', need: [], confirm: [{ field: 'mobile', masked: M }], ix: 0 }, consent: { mode: 'single' } }, kind: 'person', nameIn: P.nameIn, venueName: 'The Royal' });
  show('an older Worker (no mobile_masked): the line still shows from the one-tap row\'s mask, never a "Different number"', document.getElementById('vpPlayingAs') && document.getElementById('vpPlayingAs').textContent === 'Playing as Grace, ' + M && !document.getElementById('vpkUseNo_mobile'));

  print('4c. NOT MY NUMBER: A CODE TO THE NEW NUMBER');
  LSD = {}; VPKnown.keep({ known_key: k('d') });
  FETCH = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ known: null, consent: { mode: 'single' } }); } }); };
  await VPKnown.withInfo(Promise.resolve({}), 'https://game.example', 'ROYAL1');
  var KN = { hello: 'Sarah', need: [], confirm: [], mobile_masked: '04•• ••• 123', change_number: true, ix: 0 };
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: KN, consent: { mode: 'single' } }, kind: 'person', nameIn: P.nameIn, venueName: 'The Royal' });
  show('switch on: "Playing as Sarah, 04.. ... 123" with "Not my number" and "Not me"', document.getElementById('vpPlayingAs').textContent === 'Playing as Sarah, 04•• ••• 123' && document.getElementById('vpKnownNotNum').textContent === 'Not my number' && document.getElementById('vpKnownNotMe').textContent === 'Not me');
  var SENT = [], REPLY = null;
  FETCH = function (u, o) { SENT.push({ u: u, b: JSON.parse(o.body) }); var r = REPLY(u); return Promise.resolve({ ok: r[0] === 200, status: r[0], json: function () { return Promise.resolve(r[1]); } }); };
  document.getElementById('vpKnownNotNum').click();
  show('Not my number: the line becomes a small form in place, asking the new mobile', document.getElementById('vpNumSay').textContent === 'Your new mobile' && document.getElementById('vpNumIn').getAttribute('type') === 'tel' && document.getElementById('vpNumGo').textContent === 'Text me a code');
  document.getElementById('vpNumIn').value = '12';
  document.getElementById('vpNumGo').click();
  show('a number that is not a mobile is caught on the phone; nothing sent', document.getElementById('vpNumErr').textContent === 'Please check the mobile number.' && SENT.length === 0);
  REPLY = function () { return [200, { ok: true, change_id: 'c-1', to: '04•• ••• 456', resend_in: 30 }]; };
  document.getElementById('vpNumIn').value = '0412 000 456';
  document.getElementById('vpNumGo').click();
  for (var tk = 0; tk < 20; tk++) await Promise.resolve();
  show('Text me a code: /join/number/start with the keys and the new number', SENT.length === 1 && SENT[0].u === 'https://game.example/join/number/start' && SENT[0].b.mobile === '0412000456' && SENT[0].b.keys[0] === k('d') && SENT[0].b.code === 'ROYAL1', SENT);
  show('...then "Sent to 04.. ... 456." and a box for the code (one-time-code, six numbers)', document.getElementById('vpNumSay').textContent === 'Sent to 04•• ••• 456' && document.getElementById('vpNumIn').getAttribute('autocomplete') === 'one-time-code' && document.getElementById('vpNumIn').getAttribute('maxlength') === '6' && document.getElementById('vpNumGo').textContent === 'Confirm');
  document.getElementById('vpNumAgain').click();
  show('Resend straight away: the phone says wait, nothing sent', /^Please wait \d+ seconds/.test(document.getElementById('vpNumErr').textContent) && SENT.length === 1, document.getElementById('vpNumErr').textContent);
  REPLY = function () { return [400, { error: 'That code is not right. 4 tries left.', tries_left: 4 }]; };
  document.getElementById('vpNumIn').value = '111111';
  document.getElementById('vpNumGo').click();
  for (var tk = 0; tk < 20; tk++) await Promise.resolve();
  show('a wrong code: the Worker\'s words shown, still on the code step', SENT[1].u === 'https://game.example/join/number/verify' && SENT[1].b.change_id === 'c-1' && SENT[1].b.sms_code === '111111' && document.getElementById('vpNumErr').textContent === 'That code is not right. 4 tries left.' && document.getElementById('vpNumGo').textContent === 'Confirm');
  REPLY = function () { return [200, { ok: true, masked: '04•• ••• 456' }]; };
  document.getElementById('vpNumIn').value = '222222';
  document.getElementById('vpNumGo').click();
  for (var tk = 0; tk < 20; tk++) await Promise.resolve();
  show('the right code: the line is back with the NEW number, and says it changed', document.getElementById('vpPlayingAs').textContent === 'Playing as Sarah, 04•• ••• 456. Done.' && !document.getElementById('vpNumIn'), document.getElementById('vpPlayingAs').textContent);
  document.getElementById('vpKnownNotNum').click();
  document.getElementById('vpNumCancel').click();
  show('Cancel: the line comes back as it was', document.getElementById('vpPlayingAs') && !document.getElementById('vpNumIn'));
  show('the screen never shows a whole number', !/\d{4}/.test(shownText()), shownText());

  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Grace', need: [], confirm: [{ field: 'email', masked: 'g\u2022\u2022\u2022@gmail.com' }, { field: 'evil', masked: 'x' }, { field: 'mobile', masked: '' }], ix: 0 }, consent: { mode: 'single' }, organiser: 'The Royal' }, kind: 'person', nameIn: P.nameIn });
  show('email the same way ("Email for The Royal: g...@gmail.com", Different email); an unknown field or an empty mask is never drawn', document.getElementById('vpkUse_email') && document.getElementById('vpkUse_email').textContent.indexOf('Email for The Royal: g\u2022\u2022\u2022@gmail.com') === 0 && document.getElementById('vpkUseNo_email').textContent === 'Different email' && !document.getElementById('vpkUse_evil') && !document.getElementById('vpkUse_mobile'));
  show('the email row: no tap, nothing asked to be passed', !('use_fields' in VPKnown.capture({})));
  document.getElementById('vpkUseYes_email').click();
  show('Use this on the email: one tap, the join asks for the held email to be used', document.getElementById('vpkUseYes_email').getAttribute('aria-pressed') === 'true' && (VPKnown.capture({}).use_fields || []).join() === 'email', VPKnown.capture({}));
  document.getElementById('vpkUseNo_email').click();
  show('Different email: the row becomes the normal empty email box', !document.getElementById('vpkUse_email') && ids(P.box).indexOf('xEmail') >= 0);

  print('5b. THE FIRST-GAME NOTICE');
  /* M2 (19 Nov 2026, INBOX 677): ONE box ships, so the offers sentence (box) is drawn ONLY when the offers tick is on the
     screen: never for a known phone (no tick again), a venue with the offers tick off, or the three boxes (their own note). */
  var NOTE = { version: 'vpn-1-19nov', before: 'By playing you agree to ', link: "venueplay's terms and privacy policy", after: '. If you give a first name and mobile, venueplay keeps them so you are not asked again.', box: ' Tick the offers box and this venue can send you offers.', href: '/privacy' };
  var NOTE_BASE = "By playing you agree to venueplay's terms and privacy policy. If you give a first name and mobile, venueplay keeps them so you are not asked again.";
  var NOTE_BOX = NOTE_BASE + " Tick the offers box and this venue can send you offers.";
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'single' }, notice: NOTE }, kind: 'person', nameIn: P.nameIn });
  var np = document.getElementById('vpJoinNotice');
  show('a new phone, the offers tick on screen: the notice reads, word for word: "' + NOTE_BOX + '"', np && np.textContent === NOTE_BOX && !!document.getElementById('xOptin'), np && np.textContent);
  show('...with "venueplay\'s terms and privacy policy" as the link, to the privacy page', np && np.querySelector('a').textContent === "venueplay's terms and privacy policy" && np.querySelector('a').href === '/privacy');
  show('...a quiet link: the line\'s own colour and weight, no underline (Dean 16 Nov)', np && /color:inherit/.test(np.querySelector('a').getAttribute('style')) && /font-weight:inherit/.test(np.querySelector('a').getAttribute('style')) && /text-decoration:none/.test(np.querySelector('a').getAttribute('style')));
  cap = VPKnown.capture({ first_name: 'Sam' });
  show('the join says which notice it showed', cap.notice_version === 'vpn-1-19nov', cap);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'single' }, notice: NOTE }, kind: 'person', nameIn: P.nameIn });
  np = document.getElementById('vpJoinNotice');
  show('a known phone shown the new notice (no offers tick again): no sentence about a box that is not there', np && np.textContent === NOTE_BASE && !document.getElementById('xOptin'), np && np.textContent);
  P = page();
  VPKnown.paint({ box: P.box, collect: { first_name: true, last_name: false, postcode: false, email: false, mobile: true, mobile_required: false, marketing_optin: false }, info: { known: null, consent: { mode: 'single' }, notice: NOTE }, kind: 'person', nameIn: P.nameIn });
  np = document.getElementById('vpJoinNotice');
  show('a venue with the offers tick off: no sentence about a box that is not there', np && np.textContent === NOTE_BASE && !document.getElementById('xOptin'), np && np.textContent);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'three', version: 'vpc-4-22nov', parties: [{ party: 'venueplay', name: 'venueplay' }, { party: 'venue', name: 'The Royal' }] }, notice: NOTE }, kind: 'person', nameIn: P.nameIn });
  np = document.getElementById('vpJoinNotice');
  show('the three boxes (their own note): no one-box sentence', np && np.textContent === NOTE_BASE && !document.getElementById('xOptin'), np && np.textContent);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'single' }, notice: { version: 'vpn-3-16nov', before: 'By playing you agree to ', link: "venueplay's terms and privacy policy", after: '. Old words.', href: '/privacy' } }, kind: 'person', nameIn: P.nameIn });
  np = document.getElementById('vpJoinNotice');
  show('a notice with no box part (an older Worker): drawn as sent, nothing added', np && np.textContent === "By playing you agree to venueplay's terms and privacy policy. Old words.", np && np.textContent);
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: { hello: 'Alan', need: [], ix: 0 }, consent: { mode: 'single' }, notice: null }, kind: 'person', nameIn: P.nameIn });
  show('no notice from the Worker (seen already): none drawn, none claimed', !document.getElementById('vpJoinNotice') && !('notice_version' in VPKnown.capture({})));
  P = page();
  VPKnown.paint({ box: P.box, collect: ALL, info: { known: null, consent: { mode: 'single' }, notice: { version: 'x', text: 'T', link: 'L', href: 'javascript:alert(1)' } }, kind: 'person', nameIn: P.nameIn });
  show('a link that is not a page on this site is never used (privacy page instead)', document.getElementById('vpJoinNotice').querySelector('a').href === '/privacy');

  print('6. THE JOIN LINE, THE ASK, THE BOXES');
  show('no join line telling the player the venue gets their details (Dean 16 Nov: only a ticked box shares them)', typeof VPKnown.line === 'undefined');
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

  /* 5c. A SHORT PHONE (M2 phone check, INBOX 727 and 740, 19 Nov 2026). STATIC: the CSS text of /app/vp-phone.css is read
     here, not painted (the paint was measured in headless Chrome on the real pages: builds/m2-phone-fix2-19nov.md). With the
     offers tick on, the notice is 4 to 5 lines and the join screen ran past a 375x667 and a 320x568 phone. The two blocks that
     close it up must exist, be scoped to the join screen only, beat the notice's inline style, never hide a word or the tick,
     and (main's rule, INBOX 740) keep every tap target at least 44px tall and every word at least 14px. */
  var CSS = readFile('venueplay/app/vp-phone.css').replace(/\/\*[\s\S]*?\*\//g, '');
  function mediaBlock(q) {
    var at = CSS.indexOf('@media (' + q + '){'), i, depth = 0;
    if (at < 0) return null;
    var open = CSS.indexOf('{', at);
    for (i = open; i < CSS.length; i++) { if (CSS[i] === '{') depth++; else if (CSS[i] === '}' && --depth === 0) break; }
    return CSS.slice(open + 1, i);
  }
  function rulesOf(block) { var out = [], m, re = /([^{}]+)\{([^{}]*)\}/g; while ((m = re.exec(block || ''))) out.push({ sel: m[1].trim(), body: m[2] }); return out; }
  function ruleFor(rules, sel) { for (var i = 0; i < rules.length; i++) if (rules[i].sel.split(',').map(function (s) { return s.trim(); }).indexOf(sel) >= 0) return rules[i].body; return ''; }
  function px(body, prop) { var m = new RegExp('(?:^|;)\\s*' + prop + ':\\s*([0-9.]+)px').exec(body || ''); return m ? parseFloat(m[1]) : NaN; }
  var B7 = mediaBlock('max-height:700px') || '', B6 = mediaBlock('max-height:660px') || '';
  var M7 = rulesOf(B7), M6 = rulesOf(B6);
  show('5c a short phone (under 700px tall): a join-screen block in vp-phone.css', M7.length >= 5, M7.length);
  show('5c ...and a smaller one (under 660px tall: a 320x568 or 360x640 phone)', M6.length >= 5, M6.length);
  var allSel = M7.concat(M6).map(function (r) { return r.sel; }).join(',').split(',').map(function (s) { return s.trim(); });
  var JOIN_ONLY = /^body #vJoin\b|^body:has\(#vJoin:not\(\.hidden\)\) \.ptop\b/;
  show('5c every rule in both blocks is the join screen only (body #vJoin ..., or the header while #vJoin shows): no other screen moves', allSel.length > 0 && allSel.every(function (s) { return JOIN_ONLY.test(s); }), allSel.filter(function (s) { return !JOIN_ONLY.test(s); }));
  var nb7 = ruleFor(M7, 'body #vJoin .vp-joinnote'), nb6 = ruleFor(M6, 'body #vJoin .vp-joinnote');
  show('5c the notice is 14px under 700px, with !important (it beats the 13px inline style vp-known.js writes)', /font-size:14px!important/.test(nb7) && /line-height:1\.3!important/.test(nb7), nb7);
  show('5c ...and under 660px it stays 14px (no smaller font-size), only the lines close up (1.25)', !/font-size/.test(nb6) && /line-height:1\.25!important/.test(nb6), nb6);
  var in7 = ruleFor(M7, 'body #vJoin input[type=tel]'), in6 = ruleFor(M6, 'body #vJoin input[type=tel]');
  show('5c every text box is at least 44px tall in both blocks (min-height), the mobile box included', px(in7, 'min-height') >= 44 && px(in6, 'min-height') >= 44 && ruleFor(M7, 'body #vJoin input[type=text]') === in7 && ruleFor(M6, 'body #vJoin input[type=email]') === in6, [in7, in6]);
  var op7 = ruleFor(M7, 'body #vJoin .optin'), op6 = ruleFor(M6, 'body #vJoin .optin');
  show('5c the offers tick\'s row is at least 44px tall (the whole label is the tap), and the 660 block does not shrink it', px(op7, 'min-height') >= 44 && (isNaN(px(op6, 'min-height')) || px(op6, 'min-height') >= 44) && !/(^|;)\s*(max-)?height:/.test(op6), [op7, op6]);
  var j7 = ruleFor(M7, 'body #vJoin .vp-cta'), j6 = ruleFor(M6, 'body #vJoin .vp-cta');
  show('5c Join is at least 44px tall in both blocks, bingo and musical (.vp-cta) and trivia (.btn)', px(j7, 'min-height') >= 44 && px(j6, 'min-height') >= 44 && ruleFor(M7, 'body #vJoin .btn') === j7 && ruleFor(M6, 'body #vJoin .btn') === j6, [j7, j6]);
  var hl = ruleFor(M7, 'body #vJoin:not(.hidden) ~ .pfoot .vph-link');
  show('5c Help at our logo\'s foot is a 44px tap target with 14px words while the join screen shows', px(hl, 'min-height') >= 44 && px(hl, 'min-width') >= 44 && px(hl, 'font-size') >= 14, hl);
  show('5c the space comes from the header: the venue\'s name or logo 44px (from 56), only while the join screen shows', px(ruleFor(M7, 'body:has(#vJoin:not(.hidden)) .ptop .brand .word'), 'min-height') === 44 && px(ruleFor(M7, 'body:has(#vJoin:not(.hidden)) .ptop .vlogo'), 'max-height') === 44);
  show('5c the trivia heading is one line under 660px (its <br> goes) and smaller in both (30px, 26px)', /display:none/.test(ruleFor(M6, 'body #vJoin .pbig br')) && px(ruleFor(M7, 'body #vJoin .pbig'), 'font-size') === 30 && px(ruleFor(M6, 'body #vJoin .pbig'), 'font-size') === 26, [ruleFor(M6, 'body #vJoin .pbig br'), ruleFor(M6, 'body #vJoin .pbig')]);
  show('5c ...and the trivia heading keeps a space before its <br>, so the one line reads "JOIN THE TRIVIA", never "THETRIVIA"', /<div class="pbig">Join the <br>trivia<\/div>/.test(readFile('venueplay/app/trivia/play.html')));
  show('5c the bingo and musical heading is smaller in both (36px, 30px)', px(ruleFor(M7, 'body #vJoin .vp-h'), 'font-size') === 36 && px(ruleFor(M6, 'body #vJoin .vp-h'), 'font-size') === 30, [ruleFor(M7, 'body #vJoin .vp-h'), ruleFor(M6, 'body #vJoin .vp-h')]);
  var hides = M7.concat(M6).filter(function (r) { return /display:\s*none|visibility:\s*hidden|(^|;)\s*height:\s*0|opacity:\s*0/.test(r.body) && r.sel !== 'body #vJoin .pbig br'; });
  show('5c nothing is hidden on a short phone: not the notice, the tick, the error line, Join, the line under it or our logo (only the heading\'s line break)', hides.length === 0, hides);
  var small = (B7 + B6).match(/font-size:\s*([0-9.]+)px/g) || [];
  show('5c no text under 14px in either block (main\'s rule, INBOX 740)', small.length > 0 && small.every(function (s) { return parseFloat(s.replace(/[^0-9.]/g, '')) >= 14; }), small);
  var mins = (B7 + B6).match(/min-height:\s*([0-9.]+)px/g) || [];
  show('5c no tap target set under 44px: every min-height on a box, the tick row, Join or Help is 44px or more', M7.concat(M6).filter(function (r) { return /input\[|\.optin\b(?! input)|\.vp-cta|\.btn|\.vph-link/.test(r.sel) && !/\.optin input/.test(r.sel); }).every(function (r) { var v = px(r.body, 'min-height'); return isNaN(v) || v >= 44; }), mins);
  show('5c the notice the blocks style is the one vp-known.js draws (class vp-joinnote)', /np\.className = "vp-joinnote"/.test(readFile('venueplay/app/vp-known.js')));
  show('5c all three player phones load /app/vp-phone.css', ['venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html'].every(function (f) { return /<link rel="stylesheet" href="\/app\/vp-phone\.css(\?[^"]*)?">/.test(readFile(f)); }));

  /* 5d. THE LIGHT SCREEN ON THE JOIN STEP (M2 phone review, 19 Nov 2026). STATIC: dark words on the pale background for the
     offers tick label, the notice, the room code and our foot logo (measured 1.1 to 2.5:1 before; builds/m2-phone-fix2-19nov.md
     has the ratios measured in headless Chrome). Every rule must need body.light, so the dark screen cannot change. */
  var CSSL = CSS.slice(CSS.indexOf('body.light #vJoin .optin{'));
  var LR = rulesOf(CSS.indexOf('body.light #vJoin .optin{') >= 0 ? CSSL : '');
  function lightRule(sel) { return ruleFor(LR, sel); }
  show('5d light screen: the offers tick label is the page\'s dark text colour', /color:var\(--text,#191420\)/.test(lightRule('body.light #vJoin .optin')), lightRule('body.light #vJoin .optin'));
  show('5d light screen: the join notice is the page\'s muted colour, !important (vp-known.js writes #9A9AA4 inline)', /color:var\(--muted,#5c5666\)!important/.test(lightRule('body.light #vJoin .vp-joinnote')), lightRule('body.light #vJoin .vp-joinnote'));
  show('5d light screen: the room code is dark (bingo) and dark gold (trivia, beats the inline gold)', /color:var\(--text,#191420\)/.test(lightRule('body.light #vJoin .vp-sub .mono')) && /color:#8a6100!important/.test(lightRule('body.light #vJoin .psub #joinCode')));
  show('5d light screen: our foot logo is dark', /color:#191420/.test(lightRule('body.light .pfoot svg')), lightRule('body.light .pfoot svg'));
  show('5d light screen: the error line on the join step is dark amber #7a4f00 (the pages\' #F5A524 measured 1.48 to 1.80:1), trivia .cerr and bingo/musical .vp-err', /color:#7a4f00/.test(lightRule('body.light #vJoin .cerr')) && lightRule('body.light #vJoin .cerr') === lightRule('body.light #vJoin .vp-err'), lightRule('body.light #vJoin .cerr'));
  show('5d light screen: Help at our logo\'s foot is the page\'s muted colour while the join step shows (vp-help.js #9A9AA4 measured 2.02 to 2.45:1)', /color:var\(--muted,#5c5666\)/.test(lightRule('body.light #vJoin:not(.hidden) ~ .pfoot .vph-link')), lightRule('body.light #vJoin:not(.hidden) ~ .pfoot .vph-link'));
  var lsel = LR.map(function (r) { return r.sel; }).join(',').split(',').map(function (x) { return x.trim(); });
  var outside = lsel.filter(function (x) { return !/^body\.light #vJoin\b/.test(x); });
  show('5d the ONE light rule outside the join step is our foot logo (on purpose: every bingo and musical light screen, in game too; review SHOULD 6); anything else must be #vJoin', outside.length === 1 && outside[0] === 'body.light .pfoot svg', outside);
  show('5d every light-screen rule needs body.light (the dark screen is untouched)', lsel.length >= 6 && lsel.every(function (x) { return /^body\.light /.test(x); }), lsel.filter(function (x) { return !/^body\.light /.test(x); }));

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('vp-known: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
