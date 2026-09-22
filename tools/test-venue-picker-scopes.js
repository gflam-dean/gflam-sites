/* The venue picker on the host console, RUN: staff of the Royal see the Royal and nothing else.

   check-venue-scoping.py proved this by the string ids[v.id] being present, and the audit of
   20 Sep 2026 changed the filter to `ids[v.id] || true` (every venue on the platform) with the
   gate green. This lifts the real showVenuePick out of venueplay/app/index.html and runs it
   with a fake venue list, for a staff member and for an HQ admin viewing as a venue.

   Run from the repo root:  jsc tools/test-venue-picker-scopes.js
*/
var SRC = readFile('venueplay/app/index.html');
var bad = 0, ran = 0;
function show(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
function lift(name) {
  var i = SRC.indexOf('function ' + name + '('); if (i < 0) return null;
  var depth = 0, j = SRC.indexOf('{', i), k;
  for (k = j; k < SRC.length; k++) { if (SRC[k] === '{') depth++; else if (SRC[k] === '}') { depth--; if (!depth) break; } }
  return SRC.slice(i, k + 1);
}
var fn = lift('showVenuePick');
show('showVenuePick is still in the console', !!fn);

var VENUES = [
  { id: 'vA', name: 'The Royal Hotel', slug: 'royal', founding_id: 'f1', status: 'active' },
  { id: 'vB', name: 'The Anchor Hotel', slug: 'anchor', founding_id: 'f1', status: 'active' },
  { id: 'vZ', name: 'Somebody Else Hotel', slug: 'else', founding_id: 'f2', status: 'active' },
  { id: 'vG', name: 'Group Pub', slug: 'group', founding_id: 'f3', group_id: 'g9', status: 'active' },
];
function run(ctx) {
  var out = { buttons: [], paired: [], view: '', picked: [] };
  var box = { innerHTML: '', appendChild: function (b) { out.buttons.push(b.textContent); } };
  var env = {
    go: function (v) { out.view = v; },
    $: function (id) { return id === 'venuePickList' ? box : { value: '', textContent: '', focus: function () {} }; },
    VP: { listVenues: function () { return Promise.resolve(VENUES); }, setCurrentVenue: function () { return Promise.resolve(ctx); } },
    __ctx: ctx,
    isArchivedVenue: function (v) { return v.status === 'suspended'; },
    markVenuePick: function (id) { out.picked.push(id); },
    pairToVenue: function (slug) { out.paired.push(slug); return true; },
    pairedCode: function () { return ''; },
    updateAccountLink: function () {},
    document: { createElement: function () { return { className: '', textContent: '', addEventListener: function () {} }; } },
  };
  var names = Object.keys(env);
  var f = new Function(names.join(','), fn + '; return showVenuePick;').apply(null, names.map(function (n) { return env[n]; }));
  f();
  return out;
}
function settle(fn2) { var out = fn2(); drainMicrotasks(); return out; }

print('a staff member');
var one = settle(function () { return run({ isAdmin: false, staff: [{ venue_id: 'vA' }], currentVenueId: 'vA' }); });
show('staff of one venue go straight into it', one.paired.length === 1 && one.paired[0] === 'royal' && one.buttons.length === 0, JSON.stringify(one));
var two = settle(function () { return run({ isAdmin: false, staff: [{ venue_id: 'vA' }, { venue_id: 'vB' }], currentVenueId: 'vA' }); });
show('staff of two venues are offered exactly those two', two.buttons.sort().join('|') === 'The Anchor Hotel|The Royal Hotel', JSON.stringify(two.buttons));
show('and never a venue they have no row for', two.buttons.indexOf('Somebody Else Hotel') < 0 && two.buttons.indexOf('Group Pub') < 0);
var none = settle(function () { return run({ isAdmin: false, staff: [], currentVenueId: null, venue: null }); });
show('no staff rows: no venue is offered at all', none.buttons.length === 0 && none.paired.length === 0, JSON.stringify(none));

print('an HQ admin viewing as a venue');
var adm = settle(function () { return run({ isAdmin: true, staff: [], currentVenueId: 'vA' }); });
show('sees the venues on THAT account only', adm.buttons.sort().join('|') === 'The Anchor Hotel|The Royal Hotel', JSON.stringify(adm.buttons));
show('not the whole database', adm.buttons.indexOf('Somebody Else Hotel') < 0 && adm.buttons.indexOf('Group Pub') < 0);
var admG = settle(function () { return run({ isAdmin: true, staff: [], currentVenueId: 'vG' }); });
show('viewing a lone group venue goes straight into it', admG.paired.length === 1 && admG.paired[0] === 'group', JSON.stringify(admG));

print('an archived venue is not a place to run a game');
VENUES[1].status = 'suspended';
var arch = settle(function () { return run({ isAdmin: false, staff: [{ venue_id: 'vA' }, { venue_id: 'vB' }], currentVenueId: 'vA' }); });
show('the closed venue drops out and the other is entered directly', arch.paired.length === 1 && arch.paired[0] === 'royal', JSON.stringify(arch));
VENUES[1].status = 'active';

if (bad) throw new Error('venue picker: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
