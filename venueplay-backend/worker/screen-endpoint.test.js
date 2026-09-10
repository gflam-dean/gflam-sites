/* THE ENDPOINT EVERY TV ON EVERY WALL ASKS, EVERY THIRTY SECONDS.

   It is the most-called thing in the product, so its cost multiplies by every
   venue that will ever exist, and it is also the one whose failure a room full
   of people watches happen. Both of those make it worth a test that runs the
   real function rather than reading it.

   On 8 Sep 2026 it was measured at about 700ms, roughly 435ms of that being
   three database round trips taken one after another. Only two of them depend on
   each other. The draws board is keyed on the slug we already have, so it now
   starts immediately and is awaited at the end.

   Starting a promise early is exactly how a nicety turns into a black screen: if
   it rejects while nothing is awaiting it, that is an unhandled rejection. So the
   cases below care less about the speed than about what happens when the board
   fails, which is the thing that must not change. */
/* The gate runs suites with cwd set to the repo ROOT and a person runs them from
   this directory, so the path has to work from both. The ROOT-relative form is
   tried FIRST on purpose: jsc writes "Could not open file" to stderr on a miss,
   the gate reads the LAST line of stdout+stderr as the verdict, and a stderr line
   arriving after a passing line turns a green suite red. Same shape as the other
   suites here, deliberately. */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-game.js');
function lift(n) {
  var i = src.indexOf('async function ' + n + '('); if (i < 0) i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k) + '\n';
}

/* A CHECK THAT NEVER RAN LOOKS EXACTLY LIKE A CHECK THAT PASSED.

   These are chained promises. If one link rejects, every check after it simply
   never happens, and a run that printed fifteen green lines and no red one is
   indistinguishable from a clean pass unless something is counting. That has
   already cost us once: money.test.js quietly dropped four checks and printed no
   summary at all. So the count is declared up front and verified at the end. */
var EXPECT = 19;
var bad = 0, ran = 0, order = [], BEHAVE = {};
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}
var enc = encodeURIComponent;
/* jsc has no URL. A minimal stand-in is fine here because handleScreen only ever
   reads one query parameter from it; anything richer would be testing my stub. */
function URL(u) {
  var q = u.indexOf('?') >= 0 ? u.slice(u.indexOf('?') + 1) : '';
  var map = {};
  q.split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i);
    map[decodeURIComponent(k)] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
  });
  this.searchParams = { get: function (k) { return (k in map) ? map[k] : null; } };
}
function json(o) { return { _json: o }; }
function sbGet(env, table, q) {
  order.push(table);
  var fn = BEHAVE[table];
  if (typeof fn === 'function') return fn(q);
  return Promise.resolve(fn || []);
}
eval(lift('handleScreen'));

function req(slug) { return { url: 'https://x/screen?venue=' + slug }; }
function base() {
  order = [];
  BEHAVE = {
    vp_venue_screen: [{ slides: [{ image_url: 'a' }], raffle: null, logo_url: 'L', venue_id: 'v1' }],
    vp_venues: [{ name: 'The Average Joe', join_code: '3A7TES' }],
    v_vp_screen_draws: [{ name: 'Members', current_jackpot_cents: 5000, draw_day: 'thu' },
                        { name: 'no night set', current_jackpot_cents: 1, draw_day: null }],
  };
}

print('== a normal screen ==');
base();
handleScreen(req('the-average-joe'), {}, json).then(function (r) {
  var d = r._json;
  ok('the venue exists', d.exists === true);
  ok('its name is on the screen', d.name === 'The Average Joe');
  ok('its code is on the screen', d.join_code === '3A7TES');
  ok('the logo and slides survive', d.logo_url === 'L' && d.slides.length === 1);
  ok('a draw with a night set is advertised', d.draws.length === 1 && d.draws[0].name === 'Members');
  ok('a draw with no night set is not', !d.draws.some(function (x) { return x.draw_day === null; }));

  print('\n== the draws board is IN FLIGHT before the config comes back ==');
  ok('the draws query is issued first, not third',
     order[0] === 'v_vp_screen_draws',
     'issued: ' + order.join(' then ') + ' - if it is last it is still waiting its turn');

  print('\n== and when the board fails, the screen still lights up ==');
  base();
  BEHAVE.v_vp_screen_draws = function () { return Promise.reject(new Error('draws view is down')); };
  return handleScreen(req('the-average-joe'), {}, json);
}).then(function (r) {
  var d = r._json;
  ok('the screen still renders', d.exists === true && d.name === 'The Average Joe');
  ok('the board is simply empty', Array.isArray(d.draws) && d.draws.length === 0);
  ok('the venue code is still shown', d.join_code === '3A7TES');

  /* THE CASE THAT COST A VENUE ITS TELEVISION.

     This used to empty vp_venue_screen ONLY, leave a venue row sitting there, and
     assert exists === false. That is not an unknown venue: it is a REAL one that
     nobody has set a screen up for, and answering false for it is what put Tugun
     Bowls Club into an endless setup loop. The TV reads exists:false as "no such
     venue", shows the setup card, counts down 45 seconds, redirects to the same
     link and starts again. It never showed a night in its life.

     So both cases are tested now, and they are different cases. */
  print('\n== a REAL venue that has never set up a screen ==');
  base(); BEHAVE.vp_venue_screen = [];
  return handleScreen(req('tugun-bowls'), {}, json);
}).then(function (r) {
  ok('a real venue with no screen row still exists', r._json.exists === true,
     'answering false here sends its TV round the setup loop for ever');
  ok('and it is handed no slides, rather than an error', r._json.slides.length === 0);
  ok('its name still reaches the wall', r._json.name === 'The Average Joe');
  ok('and its join code with it', r._json.join_code === '3A7TES');

  print('\n== a slug that is nobody at all ==');
  base(); BEHAVE.vp_venue_screen = []; BEHAVE.vp_venues = [];
  return handleScreen(req('no-such-pub-anywhere'), {}, json);
}).then(function (r) {
  ok('a venue that really does not exist says so', r._json.exists === false);
  order = [];
  return handleScreen(req('../etc/passwd'), {}, json);
}).then(function (r) {
  ok('a slug that is not a slug is refused', r._json.exists === false);
  ok('and it never reached the database', order.length === 0);

  print('\n== the venue row fails, which used to be the black screen ==');
  base();
  BEHAVE.vp_venues = function () { return Promise.reject(new Error('venues unreachable')); };
  return handleScreen(req('the-average-joe'), {}, json);
}).then(function (r) {
  ok('the screen still answers rather than erroring out', !!r && !!r._json);
  ok('slides still play with no name', r._json.exists === true && r._json.slides.length === 1);
  done();
}).catch(function (e) {
  print('\nTEST ERROR: ' + e + (e && e.stack ? '\n' + e.stack : ''));
  done(e);
});

function done(err) {
  if (ran !== EXPECT) {
    print('\nONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN' +
          (err ? '' : ' and nothing reported why') +
          '. The rest were skipped, not passed.');
    throw new Error('incomplete: ' + ran + '/' + EXPECT);
  }
  if (bad || err) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw (err || new Error(bad + ' failed')); }
  print('\nALL ' + EXPECT + ' CHECKS PASSED');
}
