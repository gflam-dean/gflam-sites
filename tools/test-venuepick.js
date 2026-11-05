/* ONE VENUE, AND ONE VENUE DROP-DOWN, ON EVERY SCREEN (Dean, 3 Nov 2026), RUN.

   "Signed in and chose The Mini Bar, but Your account opened on Gflam Group." / "Editing a raffle at The Mini Bar,
   then members shows Gflam Group." This runs the real venueplay/app/vp-venuepick.js with a fake localStorage and a
   fake DOM: what current() answers, what set() writes (and what it must NOT write), what choose() opens on, and that
   the drop-down mount() draws can refuse a change (unsaved work) and goes back when it does. Then it checks every
   screen Dean named loads the one file and none of them still draws a venue drop-down of its own.

   Run from the repo root:  jsc tools/test-venuepick.js */
var SRC = readFile('venueplay/app/vp-venuepick.js');
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); } }

function El(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this._value = ''; this.textContent = ''; this.id = ''; this.className = ''; }
El.prototype.appendChild = function (c) { this.children.push(c); if (this.tagName === 'SELECT' && !this._value) this._value = c.value; return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.addEventListener = function (e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); };
El.prototype.fire = function (e) { var self = this; (this.listeners[e] || []).forEach(function (f) { f.call(self, {}); }); };
Object.defineProperty(El.prototype, 'innerHTML', { set: function () { this.children = []; }, get: function () { return ''; } });
Object.defineProperty(El.prototype, 'value', { get: function () { return this._value; }, set: function (v) { this._value = String(v); } });

function world(store) {
  store = store || {};
  var events = [];
  var head = new El('head');
  var win = {
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    document: { createElement: function (t) { return new El(t); }, getElementById: function () { return null; }, head: head },
    CustomEvent: function (name, o) { this.type = name; this.detail = o && o.detail; },
    dispatchEvent: function (e) { events.push(e); }
  };
  (new Function('window', SRC))(win);
  return { V: win.VPVenuePick, store: store, events: events, win: win };
}
var MINI = 'v-mini', GROUP = 'v-group';
var VENUES = [{ id: GROUP, name: 'Gflam Group' }, { id: MINI, name: 'The Mini Bar' }];

print('what every screen opens on');
var w = world({ vpCurrentVenue: MINI });
ok('the console\'s venue is the current one', w.V.current() === MINI);
ok('choose() opens a list on it, not on the first', w.V.choose(VENUES).id === MINI);
w = world({ vpImpersonate: JSON.stringify({ id: GROUP, name: 'Gflam Group' }), vpCurrentVenue: MINI });
ok('CONTROL (the fault): viewing from HQ, the View as venue is what is current', w.V.current() === GROUP);
w.V.set(MINI, 'The Mini Bar');
ok('Dean picks The Mini Bar: View as now names The Mini Bar too, so Your account opens on it',
   w.V.current() === MINI && JSON.parse(w.store.vpImpersonate).id === MINI && JSON.parse(w.store.vpImpersonate).name === 'The Mini Bar', w.store);
ok('...and the console\'s keys say the same (vpCurrentVenue and vpVenuePick)', w.store.vpCurrentVenue === MINI && JSON.parse(w.store.vpVenuePick).id === MINI, w.store);
ok('...and every open screen is told (vp-venue)', w.events.length === 1 && w.events[0].type === 'vp-venue' && w.events[0].detail.id === MINI, w.events);
w = world({ vpCurrentVenue: GROUP });
w.V.set(MINI, 'The Mini Bar');
ok('a venue login (no HQ): set() never invents a View as flag', !('vpImpersonate' in w.store) && w.V.current() === MINI, w.store);
w = world({});
ok('nothing chosen yet: no current venue, and a list opens on its first', w.V.current() === null && w.V.choose(VENUES).id === GROUP);
w = world({ vpCurrentVenue: 'v-other-account' });
ok('a current venue that is not on this list: the first, never a venue that is not there', w.V.choose(VENUES).id === GROUP);
var blocked = world({});
blocked.win.localStorage.getItem = function () { throw new Error('blocked'); };
blocked.win.localStorage.setItem = function () { throw new Error('blocked'); };
ok('a blocked store never stops the page', (function () { try { blocked.V.set(MINI); return blocked.V.current() === null; } catch (e) { return false; } })());

print('the one drop-down');
w = world({ vpCurrentVenue: MINI });
var box = new El('div');
var asked = [];
var answer = true;
var m = w.V.mount(box, { venues: VENUES, label: 'Venue', onChange: function (id) { asked.push(id); return answer; } });
var sel = m && m.select;
ok('it draws a labelled drop-down, opening on the current venue', !!sel && sel.value === MINI && box.hidden === false, sel && sel.value);
sel.value = GROUP; sel.fire('change');
ok('a change asks the page, then becomes the current venue everywhere', asked.join() === GROUP && w.V.current() === GROUP, [asked, w.store]);
answer = false;
sel.value = MINI; sel.fire('change');
ok('the page says no (unsaved work): the drop-down goes back and nothing changes', sel.value === GROUP && w.V.current() === GROUP, [sel.value, w.store.vpCurrentVenue]);
answer = { then: function (y) { y(true); } };
sel.value = MINI; sel.fire('change');
ok('a promised yes (after the page asked on screen) is a yes', w.V.current() === MINI && sel.value === MINI);
var one = new El('div');
var m1 = w.V.mount(one, { venues: [VENUES[1]] });
ok('one venue: no drop-down at all, there is nothing to choose', one.hidden === true && one.children.length === 0 && m1.value() === MINI);

print('every screen uses it');
var PAGES = ['venueplay/app/billing.html', 'venueplay/app/settings.html', 'venueplay/app/report.html', 'venueplay/app/index.html'];
PAGES.forEach(function (f) {
  var h = readFile(f);
  ok(f.split('/').pop() + ' loads /app/vp-venuepick.js', h.indexOf('<script src="/app/vp-venuepick.js"></script>') >= 0);
});
var REPORT = readFile('venueplay/app/report.html');
ok('the monthly report has no venue drop-down of its own any more', REPORT.indexOf('id="venuePick"') < 0 && /VPVenuePick\.mount\(\$\("venueWrap"\)/.test(REPORT));
var SET = readFile('venueplay/app/settings.html');
ok('Game settings draws the same one', /VPVenuePick\.mount\(\$\("setPick"\)/.test(SET));
var BILL = readFile('venueplay/app/billing.html');
ok('Your account draws the same one, once, above the tabs', (BILL.match(/VPVenuePick\.mount\(/g) || []).length === 1 && BILL.indexOf('id="acctPick"') < BILL.indexOf('class="tabs"'));
ok('...and the panels\' own pickers are never shown', /\.screenpick\{display:none!important\}/.test(BILL));
var CON = readFile('venueplay/app/index.html');
ok('the console writes the pick through it', /VPVenuePick\.set\(v\.id, v\.name\)/.test(CON));
ok('no em or en dash in the file', !/[\u2014\u2013]/.test(SRC));

if (bad) { print(bad + ' OF ' + ran + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
