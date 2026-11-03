/* "LOCK OLD DEVICES OUT OF YOUR TVS" IS GONE FROM THE ACCOUNT PAGE, FOR EVERYONE (Dean, 3 Nov 2026).

   20 Oct 2026: the card was made HQ only (shown while VenuePlay HQ was viewing the account). 3 Nov 2026, Dean's
   notes, item 7: "Remove 'lock out all devices / your TVs'. It was already decided this can't be offered from the
   back end." So the card, its button and its question are gone from venueplay/app/billing.html, HQ included.
   The SERVER IS UNCHANGED: the billing Worker's /account/screens-resecure route is still there (removing a host
   still rotates the venue's TV key, and every login signs out by itself after 4 hours).

   This RUNS loadHosts() lifted out of the real page with a fake Worker answer and a fake localStorage, once as a
   venue and once as HQ viewing the account, and checks nothing it does can show a lock-out card; then reads the
   page for the card's words, and the Worker for the route.

   Run: jsc venueplay-backend/app/billing-resecure-hq.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var HTML = find('venueplay/app/billing.html');
var WORKER = find('venueplay-backend/worker/venueplay-api-FULL.js');
var SCRIPT = (function () { var all = HTML.split('<script>'); var last = all[all.length - 1]; return last.slice(0, last.indexOf('</script>')); })();
function lift(name) {
  var at = SCRIPT.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error('billing.html has no function ' + name);
  var start = at + 1, eol = SCRIPT.indexOf('\n', start), first = SCRIPT.slice(start, eol);
  var open = (first.match(/\{/g) || []).length, close = (first.match(/\}/g) || []).length;
  if (open && open === close) return first;
  return SCRIPT.slice(start, SCRIPT.indexOf('\n  }\n', start) + 4);
}
var CODE = lift('loadHosts') + '\nreturn { loadHosts: loadHosts };';
var READ = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); } }

/* Every element loadHosts asks for, recorded. A card it could show would be asked for by id. */
function visit(who) {
  var asked = [], shown = [];
  var store = who.store || {};
  var localStorage = { getItem: function (k) { return store[k] != null ? store[k] : null; } };
  var $ = function (id) { asked.push(id); var el = { style: {} }; Object.defineProperty(el.style, 'display', { set: function (v) { if (v === '') shown.push(id); } }); return el; };
  var answer = { venues: [{ id: 'v1', name: 'The Mini Bar' }], hosts: [], is_owner: who.isOwner, can_manage_hosts: who.canManage };
  var api = function () { return { then: function (f) { f(answer); return this; } }; };
  var hosts = [];
  var f = new Function('$', 'api', 'localStorage', 'showMsg', 'renderHosts', 'buildHostVenuePicker', 'loadMarketers',
    'var acctVenues = [], hostsIsOwner = false, hostsCanManage = false, lastHosts = null;\n' + CODE);
  f($, api, localStorage, function () {}, function (h) { hosts.push(h); }, function () {}, function () {}).loadHosts();
  return { asked: asked, shown: shown, rendered: hosts.length };
}
var HQ = { vpImpersonate: JSON.stringify({ id: 'v1', name: 'The Mini Bar' }) };

print('== nobody sees a lock-out card, HQ included ==');
var hq = visit({ isOwner: true, canManage: true, store: HQ });
ok('CONTROL: loadHosts really ran and drew the hosts list (as HQ viewing the account)', hq.rendered === 1, hq);
ok('as HQ viewing the account, it never looks for or shows a lock-out card', hq.asked.indexOf('resecureCard') < 0 && hq.shown.indexOf('resecureCard') < 0, hq);
var owner = visit({ isOwner: true, canManage: true });
ok('as the venue owner, the same', owner.rendered === 1 && owner.asked.indexOf('resecureCard') < 0, owner);
ok('the card is not in the page at all', HTML.indexOf('id="resecureCard"') < 0 && HTML.indexOf('id="resecureBtn"') < 0);
ok('no "Lock old devices" or "lock out" words anywhere a person reads on the page', !/lock (old )?devices|lock out|lock-out/i.test(READ),
   (READ.match(/.{0,40}(lock (old )?devices|lock out|lock-out).{0,40}/i) || [])[0]);
ok('the page never calls the lock-out route', SCRIPT.indexOf('/account/screens-resecure') < 0);

print('== the server is unchanged ==');
ok('the billing Worker still has /account/screens-resecure (server behaviour not changed from the page)', WORKER.indexOf("'/account/screens-resecure'") >= 0);
/* 2 Nov 2026, Dean's job list: no lock-out-of-devices wording on the venue side. */
ok('removing a host says it plainly, with no talk of devices being locked out',
   SCRIPT.indexOf('" has been removed. Their login no longer works. Your TV screens reconnect by themselves within a few minutes."') >= 0);
ok('no em dash in the page', !/\u2014/.test(READ));

if (bad) { print(bad + ' OF ' + ran + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
