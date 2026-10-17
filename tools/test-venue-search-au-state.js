/* A SCREEN FINDING ITS PUB MUST READ au_state, NOT THE OLD state COLUMN (17 Oct 2026).

   The Mini Bar has vp_venues.state empty and au_state NSW. au_state is the column signup and the
   Account page write and every gaming rule reads; state is an old one nothing writes. /venues/like
   read state, so the Mini Bar's tile on a new screen printed no state, and a search narrowed to
   NSW could not find it at all.

   Runs the REAL handleVenueLike out of the shipped game Worker on the rig's fake PostgREST.

   Run from the repo root:  jsc tools/test-venue-search-au-state.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };
var finished = false;
DB.vp_venues = [
  { id: 'v2', slug: 'the-mini-bar-4217', name: 'The Mini Bar', postcode: '4217', state: '', au_state: 'QLD', status: 'active' },
  { id: 'v1', slug: 'the-mini-bar', name: 'The Mini Bar', postcode: '2000', state: '', au_state: 'NSW', status: 'active' },
  { id: 'v3', slug: 'the-mini-bar-2600', name: 'The Mini Bar', postcode: '2600', state: 'NSW', au_state: 'ACT', status: 'active' },
];
var n = 0;
function ask(qs) { n++; return handleVenueLike({ url: 'https://w/venues/like?slug=the-mini-bar' + (qs || ''), headers: { get: function (k) { return k === 'cf-connecting-ip' ? '203.0.113.' + n : ''; } } }, ENV, json); }
(async function () {
  var r = await ask('');
  var by = {}; (r.body.matches || []).forEach(function (m) { by[m.slug] = m; });
  show('all three Mini Bars come back', r.status === 200 && r.body.matches.length === 3, JSON.stringify(r.body));
  show('the Mini Bar with state empty and au_state NSW is shown as NSW', by['the-mini-bar'] && by['the-mini-bar'].state === 'NSW', JSON.stringify(by['the-mini-bar']));
  show('a stale state column never overrides au_state', by['the-mini-bar-2600'] && by['the-mini-bar-2600'].state === 'ACT', JSON.stringify(by['the-mini-bar-2600']));
  var nsw = await ask('&state=NSW');
  show('a search narrowed to NSW finds the NSW Mini Bar and only that one',
       nsw.status === 200 && nsw.body.matches.length === 1 && nsw.body.matches[0].slug === 'the-mini-bar', JSON.stringify(nsw.body));
  var sorted = await ask('');
  show('the list is ordered by au_state (ACT, NSW, QLD)', sorted.body.matches.map(function (m) { return m.slug; }).join() === 'the-mini-bar-2600,the-mini-bar,the-mini-bar-4217', JSON.stringify(sorted.body.matches.map(function (m) { return m.slug; })));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('venue search au_state: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
