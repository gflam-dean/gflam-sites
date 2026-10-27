/* "LOCK OLD DEVICES OUT OF YOUR TVS" IS FOR HQ ONLY (20 Oct 2026, Dean).

   The account page had a "Re-secure my screens" card for every owner and every manager who
   can manage hosts. Nobody at a venue could say what it did, and they do not need it:
   removing a host already throws the venue's TV key away, and a host is signed out by
   itself after 4 hours. Dean: keep it for HQ only. So the card starts hidden and is shown
   only while a VenuePlay HQ admin is viewing the account ("View as", the vpImpersonate
   flag the page already sends to the Worker as X-VP-Venue). The Worker route is unchanged.

   This RUNS loadHosts() and hqViewing() lifted out of the real venueplay/app/billing.html
   with a fake Worker answer and a fake localStorage, and reads the card's starting state and
   its words from the page itself.

   Run: jsc venueplay-backend/app/billing-resecure-hq.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var HTML = find('venueplay/app/billing.html');
var SCRIPT = (function () { var all = HTML.split('<script>'); var last = all[all.length - 1]; return last.slice(0, last.indexOf('</script>')); })();
function lift(name) {
  var at = SCRIPT.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error('billing.html has no function ' + name);
  var start = at + 1, eol = SCRIPT.indexOf('\n', start), first = SCRIPT.slice(start, eol);
  var open = (first.match(/\{/g) || []).length, close = (first.match(/\}/g) || []).length;
  if (open && open === close) return first;
  return SCRIPT.slice(start, SCRIPT.indexOf('\n  }\n', start) + 4);
}
var CODE = lift('hqViewing') + '\n' + lift('loadHosts') + '\nreturn { loadHosts: loadHosts };';

var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); } }

/* The card as the page starts it, read from the markup. */
var cardTag = (HTML.match(/<div[^>]*id="resecureCard"[^>]*>/) || [''])[0];
var cardStartsHidden = /display\s*:\s*none/.test(cardTag);

function visit(who) {
  var store = who.store;
  var localStorage = who.storeThrows
    ? { getItem: function () { throw new Error('blocked'); } }
    : { getItem: function (k) { return store && store[k] != null ? store[k] : null; } };
  var card = { style: { display: cardStartsHidden ? 'none' : '' } };
  var $ = function (id) { return id === 'resecureCard' ? card : null; };
  var answer = { venues: [{ id: 'v1' }], hosts: [], is_owner: who.isOwner, can_manage_hosts: who.canManage };
  var api = function () { return { then: function (f) { f(answer); return this; } }; };
  var noop = function () {};
  var f = new Function('$', 'api', 'localStorage', 'showMsg', 'renderHosts', 'buildHostVenuePicker', 'loadMarketers',
    'var acctVenues = [], hostsIsOwner = false, hostsCanManage = false;\n' + CODE);
  f($, api, localStorage, noop, noop, noop, noop).loadHosts();
  return card.style.display !== 'none';
}
var HQ = { vpImpersonate: JSON.stringify({ id: 'v1', name: 'The Mini Bar' }) };

print('== who sees the card ==');
ok('the card starts hidden in the page, so a venue never sees it flash up', cardStartsHidden, cardTag);
ok('a venue owner does NOT see it', visit({ isOwner: true, canManage: true }) === false);
ok('a manager allowed to manage hosts does NOT see it', visit({ isOwner: false, canManage: true }) === false);
ok('an owner with a venue picked (not HQ) does NOT see it',
   visit({ isOwner: true, canManage: true, store: { vpVenuePick: JSON.stringify({ id: 'v1' }) } }) === false);
ok('an HQ admin viewing the account DOES see it', visit({ isOwner: true, canManage: true, store: HQ }) === true);
ok('HQ viewing a login the Worker says cannot manage hosts does not see it', visit({ isOwner: false, canManage: false, store: HQ }) === false);
ok('a broken View-as flag is not HQ', visit({ isOwner: true, canManage: true, store: { vpImpersonate: '{nope' } }) === false);
ok('a blocked localStorage hides it rather than breaking the page', visit({ isOwner: true, canManage: true, storeThrows: true }) === false);

print('== the words, in plain English ==');
var card = HTML.slice(HTML.indexOf('id="resecureCard"'), HTML.indexOf('id="resecureBtn"') + 200);
ok('the title says what it does, and that it is HQ only', /Lock old devices out of your TVs \(HQ only\)/.test(card));
ok('the button says what it does', />Lock out old devices</.test(card));
ok('the page no longer says "re-secure" anywhere a person reads it', !/re-secur/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/resecure|screens-resecure/gi, '')));
ok('the question is the plain one, asked on the page',
   SCRIPT.indexOf('vpAsk("Lock old devices out of your TVs?\\n\\nOnly devices signed in right now will be able to control your screens.') >= 0);
ok('the done message says what changed', SCRIPT.indexOf('"Done. Old devices can no longer control your TVs at "') >= 0);
ok('removing a host says what happened to their devices',
   SCRIPT.indexOf('" has been removed. Their login no longer works, and devices they used can no longer control your TVs. Your screens reconnect by themselves within a few minutes."') >= 0);
ok('no em dash in any of it', !/—/.test(card));

if (bad) { print(bad + ' OF ' + ran + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
