/* /health IS PUBLIC AND MUST STAY CHEAP.

   Anyone can call it, the gate and the daily audit call it constantly, and until
   8 Sep it read every venue and every signing key into the Worker to count them:
   two full scans per call, growing with every venue signed, 2.7 seconds at
   nineteen venues. This RUNS the real handler against a scripted database and
   counts what it reads.

   Run: jsc venueplay-backend/worker/health.test.js
*/
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
var EXPECT = 11, bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var BUILD = 'test';
var _vcDupes = [];
var scans = 0, counts = [], fetches = [];
function refreshVenueCodes() { scans++; return Promise.resolve(); }
function sbGetAll(env, table) { scans++; return Promise.resolve([]); }
function sbHeaders() { return { apikey: 'k' }; }
function dbError(op, table, detail) { return new Error(op + ' ' + table + ' ' + detail); }
var RANGES = { vp_venues: '0-0/19', vp_venue_signing_keys: '0-0/10' };
function fetch(url, init) {
  fetches.push({ url: url, method: (init && init.method) || 'GET', prefer: init && init.headers && init.headers.Prefer });
  var table = /rest\/v1\/([a-z_]+)\?/.exec(url)[1];
  var range = /broadcast_enforce=is\.true/.test(url) ? '0-0/1' : RANGES[table];
  if (range === undefined) return Promise.resolve({ ok: false, headers: { get: function () { return null; } } });
  return Promise.resolve({ ok: true, headers: { get: function (h) { return h === 'content-range' ? range : null; } } });
}
function json(o, status) { return { _json: o, status: status || 200 }; }
eval(lift('sbCount'));
eval(lift('handleHealth'));

var ENV = { SUPABASE_URL: 'https://db', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: 's', IP_HASH_SALT: 'x', RL: {} };

print('== the count helper reads what PostgREST sends ==');
sbCount(ENV, 'vp_venues', 'select=id').then(function (n) {
  ok('"0-0/19" means 19', n === 19, n);
  ok('it asks with HEAD and count=exact, and reads no rows',
     fetches[0].method === 'HEAD' && fetches[0].prefer === 'count=exact' && /limit=1/.test(fetches[0].url), JSON.stringify(fetches[0]));
  RANGES.vp_empty = '*/0';
  return sbCount(ENV, 'vp_empty', 'select=id');
}).then(function (n) {
  ok('"*/0", an empty table, means 0', n === 0, n);
  RANGES.vp_odd = 'nonsense';
  return sbCount(ENV, 'vp_odd', 'select=id').then(function () { return 'no throw'; }, function (e) { return 'threw'; });
}).then(function (r) {
  ok('a header it cannot read is an error, not a zero', r === 'threw', r);

  print('\n== the health route ==');
  scans = 0; fetches = [];
  return handleHealth(ENV, json);
}).then(function (r) {
  var d = r._json;
  ok('it answers ok', d.ok === true && r.status === 200, JSON.stringify(d));
  ok('the signing figures are there', d.broadcast_signing && d.broadcast_signing.venues === 19 &&
     d.broadcast_signing.with_a_key === 10 && d.broadcast_signing.enforcing === 1, JSON.stringify(d.broadcast_signing));
  ok('NO table was read into the Worker for them', scans === 1,
     scans + ' scan(s): only the cached clash sweep may scan, and that is one - the signing count read the tables');
  ok('three counts, in flight together', fetches.length === 3 && fetches.every(function (f) { return f.method === 'HEAD'; }),
     fetches.map(function (f) { return f.method + ' ' + f.url; }).join(' | '));

  print('\n== what it says when things are wrong ==');
  return handleHealth({ RL: {} }, json);
}).then(function (r) {
  ok('a missing binding is a 503 with the names', r.status === 503 && r._json.missing.length === 4, JSON.stringify(r._json.missing));
  RANGES = {};
  return handleHealth(ENV, json);
}).then(function (r) {
  ok('a count that fails does not take the route down', r._json.ok === true && r._json.broadcast_signing && r._json.broadcast_signing.error,
     JSON.stringify(r._json.broadcast_signing));
  ok('and says so, rather than reporting zero venues protected', !('venues' in (r._json.broadcast_signing || {})));
}).catch(function (e) {
  bad++; print('  FAIL a chain rejected: ' + (e && (e.message + ' ' + e.stack) || e));
}).then(function () {
  print('');
  if (ran !== EXPECT) { bad++; print('  FAIL ' + ran + ' checks ran, ' + EXPECT + ' expected'); }
  if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
});
