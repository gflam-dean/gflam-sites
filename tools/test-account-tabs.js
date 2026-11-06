/* THE ACCOUNT PAGE'S TABS (Dean, 5 Nov 2026, INBOX item 20).

   "Up the top it says we've still got host, next payment and everything on this page": the owner's intro
   under "Your account" ("Your plan, venues, hosts and next payment. ...") sat above the tabs, so it showed
   on People, Nights, Screen, Draws, Marketing and Game settings too. It now shows on the Billing tab only.
   A manager's intro (what they can set up here) is about the whole page and stays on every tab.

   This RUNS showTab, lifted out of venueplay/app/billing.html, against a fake DOM built from the page's
   OWN tab buttons and panels (read from its markup), and checks:
     - each tab lights its own button and shows its own panel, and only that one
     - the billing intro (#lede carrying "billonly") is shown on Billing and hidden on every other tab
     - an intro without "billonly" (a manager's) is never hidden
     - the venue drop-down above the tabs (#acctPick) is never touched by a tab change
   The layout half (no sideways scroll, 48px tabs, 15px text) is measured in a real Chrome by
   tools/account-tabs-in-chrome.test.py.

   Run:  jsc tools/test-account-tabs.js
         jsc tools/test-account-tabs.js -- path/to/another/billing.html   (prove it red)
*/
var PAGE = (typeof arguments !== 'undefined' && arguments[0]) || 'venueplay/app/billing.html';
var HTML = readFile(PAGE);
if (!HTML || HTML.length < 10000) throw new Error('could not read ' + PAGE);
var SCRIPT = (function () {
  var all = HTML.split('<script>');
  var last = all[all.length - 1];
  return last.slice(0, last.indexOf('</script>'));
})();

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* Lift a top-level function of the page script by name (two spaces of indent, ends at "\n  }\n"). */
function lift(name) {
  var at = SCRIPT.indexOf('\n  function ' + name + '(');
  if (at < 0) return null;
  var start = at + 1, end = SCRIPT.indexOf('\n  }\n', start);
  return SCRIPT.slice(start, end + 4);
}

/* The page's own tab buttons and panels, from its markup. */
var TABS = [], m, rx = /<button[^>]*data-tab="([a-z]+)"[^>]*>([^<]*)<\/button>/g;
var tabRow = HTML.slice(HTML.indexOf('<div class="tabs" role="tablist">'), HTML.indexOf('</div>', HTML.indexOf('<div class="tabs" role="tablist">')));
while ((m = rx.exec(tabRow))) TABS.push({ id: m[1], label: m[2] });
var PANELS = [], prx = /<div class="tabpanel[^"]*" id="(tp-[a-z]+)"/g;
while ((m = prx.exec(HTML))) PANELS.push(m[1]);
var ledeTag = (HTML.match(/<p [^>]*id="lede"[^>]*>/) || [''])[0];

check('the page has its seven tabs, in order', TABS.map(function (t) { return t.id; }).join(',') === 'billing,people,nights,screen,draws,marketing,settings', TABS);
check('every tab has its own panel (tp-<tab>)', TABS.every(function (t) { return PANELS.indexOf('tp-' + t.id) >= 0; }) && PANELS.length === TABS.length, PANELS);
check('the owner\'s billing intro is marked billing-only in the markup', /class="[^"]*\bbillonly\b/.test(ledeTag), ledeTag);

/* A fake DOM: elements with a classList, attributes and hidden. */
function El(id, attrs) {
  var cls = {};
  var e = {
    id: id, hidden: false, attrs: attrs || {},
    getAttribute: function (k) { return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; },
    classList: {
      add: function (c) { cls[c] = true; }, remove: function (c) { delete cls[c]; },
      contains: function (c) { return !!cls[c]; },
      toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = true; else delete cls[c]; return on; }
    }
  };
  return e;
}
var DOM;
function build(ledeClass) {
  DOM = { buttons: [], panels: [], byId: {} };
  TABS.forEach(function (t, i) { var b = El(null, { 'data-tab': t.id }); if (!i) b.classList.add('on'); DOM.buttons.push(b); });
  PANELS.forEach(function (p, i) { var e = El(p); if (!i) e.classList.add('on'); DOM.panels.push(e); DOM.byId[p] = e; });
  if (ledeClass !== null) { var l = El('lede'); if (ledeClass) l.classList.add(ledeClass); DOM.byId.lede = l; }
  DOM.byId.acctPick = El('acctPick'); DOM.byId.acctPick.hidden = false;
}
var document = {
  querySelectorAll: function (sel) {
    if (sel === '.tabs button') return DOM.buttons;
    if (sel === '.tabpanel') return DOM.panels;
    throw new Error('unexpected selector ' + sel);
  },
  getElementById: function (id) { return DOM.byId[id] || null; }
};
var $ = function (id) { return document.getElementById(id); };

var src = lift('showTab');
check('billing.html has a showTab function to lift', !!src, src);
if (src) {
  eval(src);   // the page's own showTab, lifted from billing.html in this checkout (as test-billing-panels.js does)
  function state() {
    return {
      on: DOM.buttons.filter(function (b) { return b.classList.contains('on'); }).map(function (b) { return b.getAttribute('data-tab'); }),
      shown: DOM.panels.filter(function (p) { return p.classList.contains('on'); }).map(function (p) { return p.id; }),
      ledeHidden: DOM.byId.lede ? DOM.byId.lede.hidden : null,
      pickHidden: DOM.byId.acctPick.hidden
    };
  }

  build('billonly');
  TABS.forEach(function (t) {
    showTab(t.id);
    var s = state();
    check(t.label + ': its button is the one lit, and its panel the one shown', s.on.join() === t.id && s.shown.join() === 'tp-' + t.id, s);
    check(t.label + ': the billing intro is ' + (t.id === 'billing' ? 'shown' : 'hidden'), s.ledeHidden === (t.id !== 'billing'), s);
    check(t.label + ': the venue drop-down above the tabs is left as it was', s.pickHidden === false, s);
  });
  showTab('people'); showTab('billing');
  check('back to Billing from another tab: the intro comes back', state().ledeHidden === false, state());

  build('');   // a manager: gateSections takes "billonly" off their intro
  ['people', 'screen', 'draws', 'marketing', 'billing'].forEach(function (id) {
    showTab(id);
    check('a manager\'s intro (no billonly) stays on the ' + id + ' tab', state().ledeHidden === false, state());
  });

  build(null);  // no intro on the page at all
  var threw = null;
  try { showTab('draws'); } catch (e) { threw = String(e); }
  check('with no intro on the page, switching tabs still works', threw === null && state().shown.join() === 'tp-draws', threw);
}

/* The manager path in gateSections takes "billonly" off and un-hides the intro BEFORE writing it. */
var gs = SCRIPT.slice(SCRIPT.indexOf('var lede=$("lede");'), SCRIPT.indexOf('var lede=$("lede");') + 400);
build('billonly'); DOM.byId.lede.hidden = true;
var lede = DOM.byId.lede, p = { advertising: true }, unhide = (gs.match(/lede\.classList\.remove\("billonly"\);[^\n]*/) || [''])[0];
try { eval(unhide.replace(/\/\/.*$/, '')); } catch (e) { unhide = 'threw ' + e; }
check('a manager\'s intro is taken off billing-only and shown, so it reads on every tab', !lede.classList.contains('billonly') && lede.hidden === false && !!unhide, unhide);

print('');
print(FAIL ? (FAIL + ' FAILED, ' + PASS + ' passed') : ('ALL ' + PASS + ' CHECKS PASSED'));
if (FAIL) throw new Error(FAIL + ' failed');
