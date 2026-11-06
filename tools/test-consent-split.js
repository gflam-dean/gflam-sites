/* "YOUR DETAILS": ONE TICK, "Send me offers from {venue}. I'm 18 or over." (Dean, 4 Nov 2026, 6 Nov release).

   The 3 Nov two-tick step (18+ and "Keep me posted") is now one optional tick, built by
   venueplay/app/vp-consent.js for the bingo, musical bingo and trivia phones. This RUNS the shipped
   module against a small DOM, and RUNS each page's own gatherCapture (lifted out of the page):
     - one tick, only where the venue collects the opt-in AND an email or mobile; unticked; exact words
       with the venue's name, "this venue" with none; no 18+ tick anywhere on the step
     - Join is never held: not ticking it changes nothing about playing
     - marketing_optin and consent_version come from the one tick ONLY, and only with an email or mobile

   Run from the repo root:  jsc tools/test-consent-split.js */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); } }

// ---- a small DOM: enough for createElement, appendChild, getElementById, closest, textContent ----
var ALL = [];
function El(tag) {
  this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.className = '';
  this.listeners = {}; this._text = ''; this.type = ''; this.id = ''; this.checked = false; this.required = false;
  ALL.push(this);
}
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.walk = function (f) { f(this); for (var i = 0; i < this.children.length; i++) this.children[i].walk(f); };
El.prototype.querySelector = function (sel) {
  var tag = sel.toUpperCase(), hit = null;
  for (var i = 0; i < this.children.length && !hit; i++) this.children[i].walk(function (e) { if (!hit && e.tagName === tag) hit = e; });
  return hit;
};
El.prototype.closest = function (sel) { var e = this; while (e) { if (e.tagName === sel.toUpperCase()) return e; e = e.parentNode; } return null; };
El.prototype.click = function () { if (this.type === 'checkbox') this.checked = !this.checked; var l = this.listeners.change || []; for (var i = 0; i < l.length; i++) l[i].call(this); };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { if (this._isText) return this._text; var s = this._text; for (var i = 0; i < this.children.length; i++) s += this.children[i].textContent; return s; },
  set: function (v) { this._text = String(v); this.children = []; }
});
var BODY = new El('body');
var document = {
  body: BODY,
  createElement: function (t) { return new El(t); },
  createTextNode: function (s) { var e = new El('#text'); e._isText = true; e._text = String(s); return e; },
  getElementById: function (id) { var hit = null; BODY.walk(function (e) { if (!hit && e.id === id) hit = e; }); return hit; }
};
var window = this;
function $(id) { return document.getElementById(id); }

var SRC = readFile('venueplay/app/vp-consent.js');
function fresh() {   // a new page: a new copy of the module (its "age screen ticked" memory is per page)
  BODY.children = [];
  var joinErr = new El('div'); joinErr.id = 'joinErr'; BODY.appendChild(joinErr);
  var box = new El('div'); box.id = 'joinExtra'; BODY.appendChild(box);
  (0, eval)(SRC);
  return box;
}
function field(box, id, v) { var i = new El('input'); i.id = id; i.value = v; box.appendChild(i); }
function labels(box) { return box.children.filter(function (c) { return c.tagName === 'LABEL'; }); }

var WORDS = "Send me offers from The Test Hotel. I'm 18 or over.";

print('vp-consent.js: one tick');
var box = fresh();
VPConsent.render(box, { first_name: true, email: true, marketing_optin: true }, { venueName: 'The Test Hotel' });
var L = labels(box);
show('a venue collecting email and the opt-in: one label', L.length === 1, L.length);
show('its checkbox is #xOptin, and there is no #x18', L.length === 1 && L[0].querySelector('input').id === 'xOptin' && !$('x18'));
show('the words exact: "' + WORDS + '"', L.length === 1 && L[0].textContent.trim() === WORDS, L.map(function (l) { return l.textContent; }));
show('unticked', L.length === 1 && L[0].querySelector('input').checked === false);
show('a checkbox, the shared .optin style', L.length === 1 && L[0].querySelector('input').type === 'checkbox' && /\boptin\b/.test(L[0].className));
show('consent version is bumped to vpc-2-6nov', VPConsent.VERSION === 'vpc-2-6nov', VPConsent.VERSION);
show('no copy of the words has an em dash', (VPConsent.OPTIN_HEAD + VPConsent.OPTIN_TAIL + VPConsent.NO_NAME).indexOf('—') < 0);
box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true }, { venueName: '' });
show('no venue name: "Send me offers from this venue. I\'m 18 or over."', labels(box).length === 1 && labels(box)[0].textContent.trim() === "Send me offers from this venue. I'm 18 or over.", labels(box).map(function (l) { return l.textContent; }));
box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true });
show('no opts at all: the "this venue" words too', labels(box).length === 1 && /from this venue\./.test(labels(box)[0].textContent));
show('a name ending in a full stop gets one full stop', VPConsent.optinText('Club Inc.') === "Send me offers from Club Inc. I'm 18 or over.", VPConsent.optinText('Club Inc.'));
show('a name with spaces is tidied', VPConsent.optinText('  The   Bowlo ') === "Send me offers from The Bowlo. I'm 18 or over.", VPConsent.optinText('  The   Bowlo '));

box = fresh(); VPConsent.render(box, { first_name: true, mobile: true, marketing_optin: true });
show('mobile alone is a contact method: one tick', labels(box).length === 1);
box = fresh(); VPConsent.render(box, { first_name: true, last_name: true, postcode: true, marketing_optin: true });
show('opt-in collected but no email or mobile box: no tick', labels(box).length === 0);
box = fresh(); VPConsent.render(box, { first_name: true, email: true, mobile: true });
show('no opt-in collected: no tick', labels(box).length === 0);

print('vp-consent.js: playing never depends on the tick');
box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true });
show('unticked: Join allowed (ageOk true, kept for cached pages)', VPConsent.ageOk() === true);
show('unticked: not opted in', VPConsent.optedIn({ email: 'a@b.co' }) === false);
$('xOptin').click();
show('ticked with an email: opted in', VPConsent.optedIn({ email: 'a@b.co' }) === true);
show('ticked with no email or mobile: not opted in', VPConsent.optedIn({}) === false);
box.removeChild(labels(box)[0]); labels(box);
var gone = fresh(); VPConsent.render(gone, { email: true });
show('a step redrawn without the tick: not opted in', VPConsent.optedIn({ email: 'a@b.co' }) === false);

print("each page's own gatherCapture, RUN against the module");
var PAGES = ['venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html'];
var bodies = [];
PAGES.forEach(function (p) {
  var src = readFile(p), a = src.indexOf('  function gatherCapture(nm){'), b = a < 0 ? -1 : src.indexOf('\n  }\n', a);
  if (a < 0 || b < 0) { show(p + ': gatherCapture is where this test lifts it from', false); return; }
  var fn = src.slice(a, b + 4); bodies.push(fn);
  var gather = (0, eval)('(' + fn.trim().replace(/^function gatherCapture/, 'function') + ')');
  function run(withEmail, withMobile, optin) {
    var bx = fresh(); VPConsent.render(bx, { email: true, mobile: true, marketing_optin: true }, { venueName: 'The Test Hotel' });
    field(bx, 'xEmail', withEmail ? 'a@b.co' : ''); field(bx, 'xMobile', withMobile ? '0400000000' : '');
    if (optin) $('xOptin').click();
    return gather('Sam');
  }
  var c = run(true, false, false);
  show(p + ': not ticked, email typed: no marketing_optin, no consent_version', c.marketing_optin === undefined && c.consent_version === undefined && c.email === 'a@b.co', c);
  c = run(true, false, true);
  show(p + ': ticked with an email: marketing_optin true and consent_version vpc-2-6nov', c.marketing_optin === true && c.consent_version === 'vpc-2-6nov', c);
  c = run(false, true, true);
  show(p + ': ticked with a mobile: marketing_optin true', c.marketing_optin === true, c);
  c = run(false, false, true);
  show(p + ': ticked with no email or mobile: nothing recorded', c.marketing_optin === undefined && c.consent_version === undefined, c);
  show(p + ': no age field goes to the Worker', Object.keys(run(true, true, true)).every(function (k) { return !/18|age/i.test(k); }));
  var saved = VPConsent; VPConsent = undefined;
  try { c = gather('Sam'); show(p + ': without vp-consent.js loaded, gatherCapture still runs and records NO opt-in', c.first_name === 'Sam' && c.marketing_optin === undefined, c); }
  catch (e) { show(p + ': without vp-consent.js loaded, gatherCapture still runs and records NO opt-in', false, String(e)); }
  VPConsent = saved;
  var j = src.indexOf('  function join(){'), j2 = j < 0 ? -1 : src.indexOf('\n  }\n', j), jb = j < 0 ? '' : src.slice(j, j2);
  show(p + ': join() holds nobody on an 18+ tick (no ageOk, no AGE_NEEDED)', j > 0 && jb.indexOf('ageOk') < 0 && jb.indexOf('AGE_NEEDED') < 0);
  var li = src.indexOf('function loadJoinInfo(){'), le = li < 0 ? -1 : src.indexOf('\n  }\n', li), lb = li < 0 ? '' : src.slice(li, le);
  show(p + ': loadJoinInfo builds the tick with VPConsent.render, naming the venue, and draws no checkbox of its own', /VPConsent\.render\(box, c, \{ venueName:P\.venueName \}\)/.test(lb) && !/checkbox/.test(lb) && lb.indexOf('P.venueName=') >= 0 && lb.indexOf('P.venueName=') < lb.indexOf('VPConsent.render'), lb.length);
  show(p + ': loads /app/vp-consent.js', /<script src="\/app\/vp-consent\.js"><\/script>/.test(src));
});
show('the three pages\' gatherCapture are the same text', bodies.length === 3 && bodies[0] === bodies[1] && bodies[1] === bodies[2]);

if (bad) throw new Error('consent one tick: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
