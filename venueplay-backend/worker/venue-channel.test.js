/* THE CODE ON THE WALL AND THE CHANNEL THE ROOM IS ON ARE NOT THE SAME THING,
   AND EVERYTHING HAS TO KNOW BOTH.

   The television, the console and every phone that arrives off a table talker
   meet on a broadcast channel named from a HASH of the venue's slug. No round
   trip, so a bingo night survives this Worker being down. The code a player
   TYPES is the venue's issued join_code (migration 68), which an owner can
   change with one button in the console.

   The two were identical for every venue that existed, because the backfill
   made them so. That is how this went unnoticed: press Change code and

     * the TV keeps polling /venue with the hashed code, which no longer resolves,
       gets exists:false twice, shows "not linked to an account" and FORGETS ITS
       VENUE (a person has to re-pair the screen);
     * every phone that types the new code lands on a channel with nobody on it
       and waits for the host all night;
     * every phone off a table talker keeps playing but can no longer claim an
       identity, so the night is not metered.

   venue-code.test.js is green through all of that, because it asserts "the TV
   uses what it is given" and "the channel stays derived" as two separate facts
   and never asks whether they agree. This suite RUNS the real functions with a
   venue whose issued code is NOT its hash, which is the one case that matters.

   Run: jsc venueplay-backend/worker/venue-channel.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-game.js');
var TV = find('venueplay/tv.html');
var PLAY = find('venueplay/play.html');
var SESS = find('venueplay/app/vp-session.js');
function liftFrom(text, n, label) {
  var i = text.indexOf('async function ' + n + '('); if (i < 0) i = text.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
function lift(n) { return liftFrom(src, n, 'venueplay-game.js'); }
function liftLine(re) {
  var m = re.exec(src); if (!m) throw new Error('cannot find ' + re);
  /* eval() keeps a let/const to its own scope; var is what reaches the functions lifted next. */
  return m[0].replace(/^(let|const) /, 'var ') + '\n';
}

var EXPECT = 27;
var bad = 0, ran = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

/* ---- stubs: the least the lifted code needs ---- */
var enc = encodeURIComponent;
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
function readJson(r) { return Promise.resolve(r.body || {}); }
var PAPER_BINGO_STATES = { has: function () { return false; } };
var console = { log: function () {} };

/* The venues. ONE has an issued code that differs from its hash: that is the
   whole point. Nothing else in the repo tests that case. */
var VENUES = [
  { id: 'v-royal', slug: 'the-royal-hotel-4217', join_code: 'KQ7M2N', status: 'active', name: 'The Royal Hotel', au_state: 'QLD' },
  { id: 'v-joe',   slug: 'the-average-joe',      join_code: null,     status: 'active', name: 'The Average Joe', au_state: 'QLD' },
  { id: 'v-shut',  slug: 'the-shut-inn',          join_code: 'SHUT22', status: 'suspended', name: 'The Shut Inn', au_state: 'QLD' },
];
var scans = 0, order = [];
function param(q, k) { var m = new RegExp('(?:^|&)' + k + '=eq\\.([^&]*)').exec(q); return m ? decodeURIComponent(m[1]) : null; }
function sbGet(env, table, q) {
  order.push(table + '?' + q);
  if (table === 'vp_venues') {
    var jc = param(q, 'join_code'), sl = param(q, 'slug'), id = param(q, 'id');
    var rows = VENUES.filter(function (v) {
      if (jc !== null && v.join_code !== jc) return false;
      if (sl !== null && v.slug !== sl) return false;
      if (id !== null && v.id !== id) return false;
      if (/status=neq\.suspended/.test(q) && v.status === 'suspended') return false;
      return true;
    });
    return Promise.resolve(rows.map(function (v) { return Object.assign({}, v); }));
  }
  if (table === 'vp_venue_settings') return Promise.resolve([{ collect_email: true }]);
  return Promise.resolve([]);   // no sessions, no games: a broadcast bingo night
}
function sbGetAll(env, table, q) { scans++; order.push('SCAN ' + table); return Promise.resolve(VENUES.map(function (v) { return Object.assign({}, v); })); }
function sbPatch() { return Promise.resolve([]); }

eval(lift('fnvVenueCode'));
eval(liftLine(/^let _vcMap = null[^\n]*/m));
eval(liftLine(/^let _vcDupes[^\n]*/m));
eval(liftLine(/^const AMBIGUOUS[^\n]*/m));
eval(lift('refreshVenueCodes'));
eval(lift('venueByCode'));
eval(lift('handleVenueLookup'));
eval(lift('handleJoinInfo'));
eval(lift('handlePlayLive'));

/* The three copies of the hash the pages carry. They must equal the Worker's. */
var tvVenueCode = (function () { eval(liftFrom(TV, 'venueCode', 'tv.html')); return venueCode; })();
var playVenueCode = (function () { eval(liftFrom(PLAY, 'venueCode', 'play.html')); return venueCode; })();
var sessVenueCode = (function () { eval(liftFrom(SESS, 'venueCode', 'vp-session.js')); return venueCode; })();

var ROYAL = VENUES[0];
var HASH = fnvVenueCode(ROYAL.slug);
ok('the fixture is the case that matters: issued code != hashed code', HASH !== ROYAL.join_code, HASH);
ok('the TV, the phone and the console all hash the slug the way the Worker does',
   tvVenueCode(ROYAL.slug) === HASH && playVenueCode(ROYAL.slug) === HASH && sessVenueCode(ROYAL.slug) === HASH,
   [tvVenueCode(ROYAL.slug), playVenueCode(ROYAL.slug), sessVenueCode(ROYAL.slug), HASH].join(' '));

function get(path) { return { url: 'https://x' + path }; }
function post(body) { return { body: body }; }

print('== the venue answers to BOTH its codes ==');
order = []; scans = 0;
venueByCode({}, ROYAL.join_code).then(function (id) {
  ok('the issued code resolves', id === ROYAL.id, id);
  ok('and it is one indexed row, not a scan of the table', scans === 0, order.join(' | '));
  order = []; scans = 0;
  return venueByCode({}, HASH);
}).then(function (id) {
  ok('the code the TV and the table talkers derive ALSO resolves', id === ROYAL.id,
     'got ' + id + ': press Change code and every screen and table talker at this venue stops working');
  ok('it fell through the indexed row first', /join_code=eq\./.test(order[0] || ''), order[0]);
  return venueByCode({}, fnvVenueCode('the-average-joe'));
}).then(function (id) {
  ok('a venue migration 68 has not reached (join_code null) still resolves by its hash', id === 'v-joe', id);

  print('\n== the screen poll: a TV that has not reloaded sends only the hashed code ==');
  return handleVenueLookup(get('/venue?code=' + HASH), {}, json);
}).then(function (r) {
  var d = r._json;
  ok('exists:true', d.exists === true, JSON.stringify(d));
  ok('and names the right venue', d.slug === ROYAL.slug, d.slug);
  ok('and it is not suspended', d.suspended === false);
  return handleVenueLookup(get('/venue?code=' + HASH + '&venue=' + ROYAL.slug + '&v=test'), {}, json);
}).then(function (r) {
  ok('a reloaded TV asks by slug and gets the same answer', r._json.exists === true && r._json.slug === ROYAL.slug);
  ok('tv.html sends its slug on the poll',
     /\/venue\?code="\+encodeURIComponent\(CODE\)\+"&venue="\+encodeURIComponent\(VENUE_SLUG\)/.test(TV));
  return handleVenueLookup(get('/venue?code=ZZZZZZ'), {}, json);
}).then(function (r) {
  ok('a code that is nobody\'s is still refused', r._json.exists === false);

  print('\n== the phone that TYPES the new code is told where the room is ==');
  return handleJoinInfo(post({ code: ROYAL.join_code }), {}, json);
}).then(function (r) {
  var d = r._json;
  ok('/join/info resolves the typed code', d.collect && d.venue_name === ROYAL.name, JSON.stringify(d));
  ok('and sends back the channel, which is the hash the TV is on', d.channel === HASH, d.channel);
  ok('the channel is a code the phone will accept', /^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/.test(d.channel));
  return handleJoinInfo(post({ code: HASH }), {}, json);
}).then(function (r) {
  ok('a phone already on the hashed code is told the same channel, so it never moves', r._json.channel === HASH);

  print('\n== play.html moves the phone, once ==');
  ok('the lookup loop rehomes when the channel differs from the room',
     /if\(r && r\.channel && CODE_RE\.test\(r\.channel\) && r\.channel!==P\.room\)\{ rehome\(r\.channel, code\); \}/.test(PLAY),
     'a phone on the wrong channel waits for a host who is calling balls somewhere else');
  var calls = [];
  var P = { room: ROYAL.join_code }, ch = { unsubscribe: function () { calls.push('unsub'); } }, subscribed = true;
  var store = {}; store['vp-pid-' + ROYAL.join_code] = 'pid-1'; store['vp-name-' + ROYAL.join_code] = 'Sam';
  var loadPid = function (r) { return store['vp-pid-' + r] || ''; }, savePid = function (r, v) { store['vp-pid-' + r] = v; };
  var loadName = function (r) { return store['vp-name-' + r] || ''; }, saveName = function (r, v) { store['vp-name-' + r] = v; };
  var shown = {}; var $ = function (id) { return { set textContent(v) { shown[id] = v; } }; };
  var connect = function (room) { calls.push('connect:' + room); P.room = room; };
  eval(liftFrom(PLAY, 'rehome', 'play.html'));
  rehome(HASH, ROYAL.join_code);
  ok('it leaves the dead channel before joining the live one', calls.join(',') === 'unsub,connect:' + HASH, calls.join(','));
  ok('the phone keeps its identity across the move', store['vp-pid-' + HASH] === 'pid-1' && store['vp-name-' + HASH] === 'Sam',
     'a regular would otherwise become a new player, and a new metered head');
  ok('and still shows the code that is on the wall', shown.joinCode === ROYAL.join_code && shown.roomLabel === ROYAL.join_code, JSON.stringify(shown));

  print('\n== a suspended venue still EXISTS, so its screen keeps its pairing ==');
  return venueByCode({}, fnvVenueCode('the-shut-inn'));
}).then(function (id) {
  ok('by default a suspended venue reads as absent (nothing that costs money runs)', id === null, id);
  return venueByCode({}, 'SHUT22', { includeSuspended: true });
}).then(function (id) {
  ok('a screen may ask to see it anyway', id === 'v-shut', id);
  return handleVenueLookup(get('/venue?code=' + fnvVenueCode('the-shut-inn')), {}, json);
}).then(function (r) {
  ok('/venue says exists:true, suspended:true, not "not linked to an account"',
     r._json.exists === true && r._json.suspended === true, JSON.stringify(r._json));
  return handlePlayLive(get('/play/live?code=SHUT22'), {}, json);
}).then(function (r) {
  ok('/play/live reaches its suspended branch (it was dead code before 8 Sep)',
     r._json.exists === true && r._json.suspended === true && r._json.live === false, JSON.stringify(r._json));

  print('\n== two slugs that hash alike are refused, not guessed ==');
  /* Find a real collision by birthday: 29^6 codes, so ~30k slugs is usually enough. */
  var seen = {}, a = null, b = null;
  for (var i = 0; i < 400000 && !a; i++) {
    var s = 'pub-' + i.toString(36); var h = fnvVenueCode(s);
    if (seen[h]) { a = seen[h]; b = s; } else seen[h] = s;
  }
  ok('found two slugs with one code (fixture for the clash rule)', !!a, 'searched ' + i);
  var saved = VENUES;
  VENUES = saved.concat([{ id: 'v-a', slug: a, join_code: 'AAAAA2', status: 'active' }, { id: 'v-b', slug: b, join_code: 'BBBBB2', status: 'active' }]);
  _vcMap = null;
  return venueByCode({}, fnvVenueCode(a)).then(function (id) {
    ok('the shared hash resolves to NEITHER venue', id === null, 'resolved to ' + id + ': one pub joins the other\'s night');
    VENUES = saved; _vcMap = null;
  });
}).catch(function (e) {
  bad++; print('  FAIL a chain rejected: ' + (e && e.stack || e));
}).then(function () {
  print('');
  if (ran !== EXPECT) { bad++; print('  FAIL ' + ran + ' checks ran, ' + EXPECT + ' expected: a link in the chain was skipped'); }
  if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
});
