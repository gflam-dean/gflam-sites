/* ADDING A HOST OR A MANAGER, IN THE OWNER'S OWN SCREEN.

   Dean: "in the owners view when you add a host the boxes look silly for what venues
   they can run and what they can do". Two loose stacks of ticks, no headings, and
   nothing anywhere that said what you had just ticked, so it was possible to add a
   person who could sign in and do nothing at all.

   The words under each block and the body the page posts are built by pure helpers.
   This test does NOT keep its own copy of them: it reads the real block out of
   venueplay/app/billing.html between the two VP-HOSTS-HELPERS markers and runs that.
   A copy would still pass after the page had changed underneath it.

   Run: jsc venueplay-backend/app/billing-hosts.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/app/billing.html');
var block = H.split('// VP-HOSTS-HELPERS-START')[1];
if (!block) throw new Error('no VP-HOSTS-HELPERS-START marker in billing.html');
block = block.split('// VP-HOSTS-HELPERS-END')[0];
if (!block || block.length < 400) throw new Error('helper block is empty or truncated');
eval(block);

var EXPECT = 19, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

/* --- the words under the venue ticks --- */
var none = vpVenueSummary([], 3, 'run');
ok('nothing ticked says what will happen, not nothing', none.none === true && /no venue to run/.test(none.text));
ok('nothing ticked is flagged so it can be coloured', none.none === true);
var one = vpVenueSummary(['The Mini Bar'], 3, 'run');
ok('one venue ticked reads as one venue', one.none === false && one.text === 'They can run The Mini Bar.');
var two = vpVenueSummary(['The Mini Bar', 'Tugun Bowls'], 3, 'run');
ok('two venues are joined with "and", no comma', two.text === 'They can run The Mini Bar and Tugun Bowls.', two.text);
var three = vpVenueSummary(['A', 'B', 'C'], 5, 'manage');
ok('three of five list out in full', three.text === 'They can manage A, B and C.', three.text);
var all = vpVenueSummary(['A', 'B', 'C'], 3, 'run');
ok('every venue ticked says all of them, not a long list', /all 3 of your venues/.test(all.text), all.text);
ok('a single-venue account never says "all 1 of your venues"',
   vpVenueSummary(['The Mini Bar'], 1, 'run').text === 'They can run The Mini Bar.');

/* --- the words under the four manager toggles --- */
var pnone = vpPermSummary([]);
ok('no permission ticked explains what they still can and cannot do',
   pnone.none === true && /still run and set up/.test(pnone.text) && /adding hosts/.test(pnone.text));
var pone = vpPermSummary(['Advertising']);
ok('one permission says it and says it is the only one',
   pone.none === false && pone.text === 'They can do Advertising, and nothing else on this list.', pone.text);
var pall = vpPermSummary(['Advertising', 'Draws & raffles', 'Players & opt-in export', 'Add hosts']);
ok('all four reads as the whole list, not a shrug', /everything on this list/.test(pall.text) && /Add hosts\.$/.test(pall.text), pall.text);

/* --- the body the page posts --- */
var noName = vpHostAddPayload({ name: '  ', mobile: '0400 000 000', venueIds: ['v1'], totalVenues: 2 });
ok('a blank name is refused before anything is sent', !!noName.error && !noName.payload);
var noMob = vpHostAddPayload({ name: 'Sam', mobile: '', venueIds: ['v1'], totalVenues: 2 });
ok('a blank mobile is refused before anything is sent', !!noMob.error && !noMob.payload);
var noVenue = vpHostAddPayload({ name: 'Sam', mobile: '0400 000 000', venueIds: [], totalVenues: 3 });
ok('no venue ticked is refused, and the words say why', !!noVenue.error && /no games to run/.test(noVenue.error), noVenue.error);
var hp = vpHostAddPayload({ name: '  Sam Jones ', mobile: ' 0400 000 000 ', venueIds: ['v1', 'v2'], totalVenues: 3 });
ok('the host body keeps the four keys the Worker reads',
   !!hp.payload && hp.payload.label === 'Sam Jones' && hp.payload.mobile === '0400 000 000' &&
   hp.payload.venue_ids.length === 2 && hp.payload.all_venues === false,
   JSON.stringify(hp));
var hall = vpHostAddPayload({ name: 'Sam', mobile: '0400', allVenues: true, venueIds: [], totalVenues: 4 });
ok('All venues ticked sends all_venues true even with no ids', !!hall.payload && hall.payload.all_venues === true);

var mNoVenue = vpMgrAddPayload({ name: 'Kim', mobile: '0400', venueIds: [], permKeys: ['advertising'] });
ok('a manager with no venue is refused', !!mNoVenue.error && /nothing for them to manage/.test(mNoVenue.error));
var mp = vpMgrAddPayload({ name: 'Kim', mobile: '0400', venueIds: ['v1'], permKeys: ['advertising', 'add_hosts'] });
ok('the manager body sends all four permission keys, ticked ones true and the rest false',
   !!mp.payload && mp.payload.permissions.advertising === true && mp.payload.permissions.add_hosts === true &&
   mp.payload.permissions.draws_raffles === false && mp.payload.permissions.players_optin === false,
   JSON.stringify(mp.payload && mp.payload.permissions));
var mjunk = vpMgrAddPayload({ name: 'Kim', mobile: '0400', venueIds: ['v1'], permKeys: ['advertising', 'billing'] });
ok('a key the Worker does not know is dropped, not passed through',
   !!mjunk.payload && mjunk.payload.permissions.billing === undefined &&
   Object.keys(mjunk.payload.permissions).length === 4);

/* --- the page really uses these, rather than keeping its own second copy --- */
ok('the page posts what the helpers built, not a hand-built body',
   /api\("\/account\/host-add", built\.payload\)/.test(H) && /api\("\/account\/manager-add", built\.payload\)/.test(H));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
