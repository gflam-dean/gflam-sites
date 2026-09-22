/* /venues/like is how a new screen finds its own pub. It is also, unlimited, a way to walk the
   customer list one common word at a time (the-royal, the-grand, the-railway). Runs the REAL
   handleVenueLike on the rig and asks 40 times from one network.

   Run from the repo root:  jsc tools/test-venue-search-is-limited.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };      // the rig's digest is all zeros, so every network would be one network
var finished = false;
DB.vp_venues = [];
for (var i = 0; i < 30; i++) DB.vp_venues.push({ id: 'v' + i, slug: 'the-royal-' + i, name: 'The Royal Hotel ' + i, postcode: String(2000 + i), state: 'NSW', status: 'active' });
function ask(ip) { return handleVenueLike({ url: 'https://w/venues/like?slug=the-royal', headers: { get: function (k) { return k === 'cf-connecting-ip' ? ip : ''; } } }, ENV, json); }
(async function () {
  var okCount = 0, limited = 0, firstLimitedAt = 0;
  for (var n = 1; n <= 40; n++) {
    var r = await ask('203.0.113.9');
    if (r.status === 200 && r.body.matches.length === 30) okCount++;
    else if (r.status === 429) { limited++; if (!firstLimitedAt) firstLimitedAt = n; }
  }
  show('a screen setting itself up gets its answers', okCount >= 20, okCount + ' answered');
  show('the thirty-first ask in a minute from one network is refused', limited > 0 && firstLimitedAt === 31, 'first refusal at ask ' + firstLimitedAt);
  show('and it stays refused for the rest of the minute', okCount + limited === 40 && limited === 10, limited + ' refused');
  var other = await ask('198.51.100.7');
  show('another network is not caught by it', other.status === 200 && other.body.matches.length === 30, 'status ' + other.status);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('venue search: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
