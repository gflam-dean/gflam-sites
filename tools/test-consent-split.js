/* "YOUR DETAILS": 18+ AND "KEEP ME POSTED" ARE TWO TICKS, AND THE ANSWER LIVES IN ONE PLACE (3 Nov 2026).

   The bingo, musical bingo and trivia phones bundled "I am 18 or over" with marketing consent in one
   tick. Marketing consent must be optional and unbundled (Spam Act 2003, APP 7). The ticks are now
   built by venueplay/app/vp-consent.js, shared by all three phones.

   This RUNS the shipped vp-consent.js against a small DOM, and RUNS each page's own gatherCapture
   (lifted out of the shipped page) against it:
     - the step offers two ticks only where the venue collects the opt-in AND an email or mobile
     - both unticked, separate labels, the 18+ one first, the words exact, nothing bundled
     - Join is allowed only with the 18+ tick (where shown); ticking the age screen takes it down
       and an age screen ticked earlier tonight means it is never drawn
     - marketing_optin comes from the opt-in tick ONLY, and only with an email or mobile
     - the three pages' gatherCapture are the same text, and each page's join() asks ageOk() before
       it gathers anything

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

var AGE = "I'm 18 or over", OPT = "Keep me posted on what's on at the venue";

print('vp-consent.js: where the step shows two ticks');
var box = fresh();
VPConsent.render(box, { first_name: true, email: true, marketing_optin: true }, { age18: false });
var L = labels(box);
show('a venue collecting email and the opt-in: two labels', L.length === 2, L.length);
show('the 18+ tick first, then the opt-in, each its own checkbox', L.length === 2 && L[0].querySelector('input').id === 'x18' && L[1].querySelector('input').id === 'xOptin', L.map(function (l) { return l.querySelector('input') && l.querySelector('input').id; }));
show('the words exact: "' + AGE + '" and "' + OPT + '"', L.length === 2 && L[0].textContent.trim() === AGE && L[1].textContent.trim() === OPT, L.map(function (l) { return l.textContent; }));
show('neither label says both 18 and posted (nothing bundled)', L.every(function (l) { return !(/18/.test(l.textContent) && /posted/i.test(l.textContent)); }));
show('both unticked', L.every(function (l) { return l.querySelector('input').checked === false; }));
show('both checkboxes, the shared .optin style', L.length === 2 && L.every(function (l) { return l.querySelector('input').type === 'checkbox' && /\boptin\b/.test(l.className); }));
show('no copy of the words has an em dash', (AGE + OPT + VPConsent.AGE_NEEDED).indexOf('—') < 0);

box = fresh(); VPConsent.render(box, { first_name: true, mobile: true, marketing_optin: true });
show('mobile alone is a contact method: two ticks', labels(box).length === 2);
box = fresh(); VPConsent.render(box, { first_name: true, last_name: true, postcode: true, marketing_optin: true });
show('opt-in collected but no email or mobile box: neither tick', labels(box).length === 0);
box = fresh(); VPConsent.render(box, { first_name: true, email: true, mobile: true });
show('no opt-in collected: neither tick', labels(box).length === 0);
show('and with no tick shown, Join is allowed', VPConsent.ageOk() === true);

print('vp-consent.js: 18+ is needed only with the opt-in (4 Nov 2026), and never asked twice');
var NEWS = "To get venue news, tick I'm 18 or over.";
show('the refusal reads "' + NEWS + '"', VPConsent.AGE_NEEDED === NEWS, VPConsent.AGE_NEEDED);
function grid(age, opt) {   // a fresh step with the ticks set, then: may they join, and are they opted in?
  var bx = fresh(); VPConsent.render(bx, { email: true, marketing_optin: true });
  if (age) $('x18').click(); if (opt) $('xOptin').click();
  return { join: VPConsent.ageOk(), optin: VPConsent.optedIn({ email: 'a@b.co' }) };
}
var g = grid(true, true);
show('opt-in and 18+ ticked: joins, opted in', g.join === true && g.optin === true, g);
g = grid(false, true);
show('opt-in ticked, 18+ empty: Join refused', g.join === false, g);
g = grid(false, false);
show('neither ticked: joins, not opted in (as joining worked before)', g.join === true && g.optin === false, g);
g = grid(true, false);
show('18+ only: joins, not opted in (the 18+ tick is not consent)', g.join === true && g.optin === false, g);

box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true });
$('xOptin').click();
$('joinErr').textContent = VPConsent.AGE_NEEDED;
$('x18').click();
show('opt-in then 18+ ticked: the refusal comes off the screen', VPConsent.ageOk() === true && $('joinErr').textContent === '', $('joinErr').textContent);
$('x18').click();
show('unticking 18+ with the opt-in still ticked refuses again', VPConsent.ageOk() === false);
$('joinErr').textContent = VPConsent.AGE_NEEDED;
$('xOptin').click();
show('unticking the opt-in instead lets them join, and takes the refusal down', VPConsent.ageOk() === true && $('joinErr').textContent === '', $('joinErr').textContent);

box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true }, { age18: true });
show('an age screen ticked earlier tonight: the 18+ tick is never drawn', !$('x18') && labels(box).length === 1 && labels(box)[0].textContent.trim() === OPT);
show('and Join is allowed without it', VPConsent.ageOk() === true);

box = fresh(); VPConsent.render(box, { email: true, marketing_optin: true }, { age18: false });
VPConsent.age18Done();
show('the age screen ticked while the step is up: the 18+ tick comes down, the opt-in stays', !$('x18') && !!$('xOptin') && labels(box).length === 1);
show('and Join is allowed', VPConsent.ageOk() === true);
show('and the opt-in is still unticked (the age screen does not tick it)', $('xOptin').checked === false);

print("each page's own gatherCapture, RUN against the module");
var PAGES = ['venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html'];
var bodies = [];
PAGES.forEach(function (p) {
  var src = readFile(p), a = src.indexOf('  function gatherCapture(nm){'), b = a < 0 ? -1 : src.indexOf('\n  }\n', a);
  if (a < 0 || b < 0) { show(p + ': gatherCapture is where this test lifts it from', false); return; }
  var fn = src.slice(a, b + 4); bodies.push(fn);
  var gather = (0, eval)('(' + fn.trim().replace(/^function gatherCapture/, 'function') + ')');
  function run(withEmail, withMobile, optin, age) {
    var bx = fresh(); VPConsent.render(bx, { email: true, mobile: true, marketing_optin: true });
    field(bx, 'xEmail', withEmail ? 'a@b.co' : ''); field(bx, 'xMobile', withMobile ? '0400000000' : '');
    if (optin) $('xOptin').click(); if (age) $('x18').click();
    return gather('Sam');
  }
  var c = run(true, false, false, true);
  show(p + ': 18+ ticked, opt-in empty, email typed: no marketing_optin', c.marketing_optin === undefined && c.email === 'a@b.co', c);
  c = run(true, false, true, true);
  show(p + ': opt-in ticked with an email: marketing_optin true', c.marketing_optin === true, c);
  c = run(false, true, true, false);
  show(p + ': opt-in ticked with a mobile: marketing_optin true (the 18+ tick is the join gate, not part of consent)', c.marketing_optin === true, c);
  c = run(false, false, true, true);
  show(p + ': opt-in ticked with no email or mobile: no marketing_optin', c.marketing_optin === undefined, c);
  c = run(true, true, false, true);
  show(p + ': nothing about 18+ goes to the Worker (no new field)', Object.keys(c).every(function (k) { return !/18|age/i.test(k); }), Object.keys(c));
  // vp-consent.js not loaded (a blip on pub wifi): no tick was drawn, so the page must still gather, with NO opt-in
  var saved = VPConsent; VPConsent = undefined;
  try { c = gather('Sam'); show(p + ': without vp-consent.js loaded, gatherCapture still runs and records NO opt-in', c.first_name === 'Sam' && c.marketing_optin === undefined, c); }
  catch (e) { show(p + ': without vp-consent.js loaded, gatherCapture still runs and records NO opt-in', false, String(e)); }
  VPConsent = saved;
  var j = src.indexOf('  function join(){'), j2 = j < 0 ? -1 : src.indexOf('\n  }\n', j), jb = j < 0 ? '' : src.slice(j, j2);
  var g = jb.indexOf('VPConsent.ageOk()'), h = jb.indexOf('gatherCapture(');
  show(p + ': join() asks VPConsent.ageOk() before it gathers or sends anything', g > 0 && h > g, { ageOk: g, gather: h });
  var li = src.indexOf('function loadJoinInfo(){'), le = li < 0 ? -1 : src.indexOf('\n  }\n', li), lb = li < 0 ? '' : src.slice(li, le);
  show(p + ': loadJoinInfo builds the ticks with VPConsent.render and draws no checkbox of its own', /VPConsent\.render\(box, c,/.test(lb) && !/checkbox/.test(lb), lb.length);
  show(p + ': loads /app/vp-consent.js', /<script src="\/app\/vp-consent\.js"><\/script>/.test(src));
});
show('the three pages\' gatherCapture are the same text', bodies.length === 3 && bodies[0] === bodies[1] && bodies[1] === bodies[2]);

if (bad) throw new Error('consent split: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
