/* THE GAME WORKER TELLS STRANGERS NOTHING THEY CAN USE (audit of 14 Oct 2026).

   1. /health showed anybody our venue count, how many venues hold a signing key, how many
      enforce it, and how the rate limiter and the room server are set up. The counts now come
      back only to our own tools, which send X-VP-Health-Key = sha256("vp-health:" + service key).
   2. /report looked the venue code up BEFORE asking who was calling, so a caller with no token
      got 200 {ok:false} for a code that is no venue and 401 for one that is: a free test of
      which codes are real. Sign-in is now checked first.

   Runs the REAL shipped venueplay-game.js on the shared rig (fake PostgREST, real handlers).
   Run: jsc tools/test-platform-worker-15-oct.js   (from the repo root) */
load('tools/rig-game-worker.js');

var KEY_OK = 'h:vp-health:x';            // ENV.SUPABASE_SERVICE_KEY is 'x' on the rig
sha256Hex = async function (s) { return 'h:' + s; };   // jsc has no SubtleCrypto digest worth the name
function healthReq(key) {
  return { headers: { get: function (h) { return (h === 'x-vp-health-key' && key) ? key : null; } } };
}
var DETAIL = ['broadcast_signing', 'rateLimiter', 'joinDedupCache', 'room', 'one_trip'];
function hasAny(d) { return DETAIL.filter(function (k) { return d[k] !== undefined; }); }

(async function () {
  DB = { vp_venues: [{ id: VENUE, name: 'Test Venue', slug: 'test-venue', join_code: 'ACDEFG', status: 'active', broadcast_enforce: true }],
         vp_venue_signing_keys: [{ venue_id: VENUE }] };
  var env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'x', IP_HASH_SALT: 's', RL: {} };

  print('== /health to a stranger ==');
  LOG = [];
  var r = await handleHealth(env, json, healthReq(null));
  var d = r.body;
  show('it still answers ok, with the build and what is missing', d.ok === true && 'build' in d && Array.isArray(d.missing), JSON.stringify(d));
  show('it still names itself, for the gate that asks each URL who it is', d.worker === 'venueplay-game');
  show('it still says how many join codes clash, which the gate and the daily audit need', d.venue_code_clashes === 0);
  show('it gives a stranger none of the counts or the set-up', hasAny(d).length === 0, hasAny(d).join(', '));
  show('and does not even count them: no HEAD request reached the database',
       LOG.filter(function (l) { return /^HEAD /.test(l); }).length === 0, LOG.join(' | '));

  LOG = [];
  d = (await handleHealth(env, json, healthReq('h:vp-health:not-the-key'))).body;
  show('a wrong key gets the same as a stranger', hasAny(d).length === 0, hasAny(d).join(', '));
  d = (await handleHealth(env, json, healthReq(KEY_OK + 'x'))).body;
  show('so does the right key with one character more', hasAny(d).length === 0, hasAny(d).join(', '));
  d = (await handleHealth({ SUPABASE_URL: 'u', IP_HASH_SALT: 's', RL: {} }, json, healthReq('h:vp-health:undefined'))).body;
  show('and a Worker with no service key opens to nobody, not to everybody', hasAny(d).length === 0, hasAny(d).join(', '));

  print('\n== /health to our own tools ==');
  LOG = [];
  d = (await handleHealth(env, json, healthReq(KEY_OK))).body;
  show('the right key gets the signing figures', d.broadcast_signing && d.broadcast_signing.venues === 1 &&
       d.broadcast_signing.with_a_key === 1 && d.broadcast_signing.enforcing === 1, JSON.stringify(d.broadcast_signing));
  show('and the rest of the set-up', d.rateLimiter === 'memory' && d.joinDedupCache === true && d.room === false, JSON.stringify(d));

  print('\n== /report: who is asking, before which venue ==');
  var looked = 0, realLookup = venueByCode;
  venueByCode = async function () { looked++; return realLookup.apply(null, arguments); };
  verifyHostJwt = async function () { throw new Error('no token'); };
  BODY = { code: 'ZZZZZZ', format: 'bingo', players: 1 };
  r = await handleReport({ headers: { get: function () { return ''; } } }, env, json);
  show('no token and a made-up code: 401', r.status === 401, r.status + ' ' + JSON.stringify(r.body));
  show('and the code was never looked up', looked === 0, looked + ' lookup(s)');
  BODY = { code: 'ACDEFG', format: 'bingo', players: 1 };
  var r2 = await handleReport({ headers: { get: function () { return ''; } } }, env, json);
  show('no token and a REAL code: the same 401, word for word',
       r2.status === 401 && JSON.stringify(r2.body) === JSON.stringify(r.body), r2.status + ' ' + JSON.stringify(r2.body));

  verifyHostJwt = async function () { return HOST; };
  requireStaff = async function () { throw new Error('not staff'); };
  BODY = { code: 'ZZZZZZ', format: 'bingo', players: 1 };
  var r3 = await handleReport({ headers: { get: function () { return ''; } } }, env, json);
  BODY = { code: 'ACDEFG', format: 'bingo', players: 1 };
  var r4 = await handleReport({ headers: { get: function () { return ''; } } }, env, json);
  show('signed in: no such venue and not your venue are the same 403',
       r3.status === 403 && r4.status === 403 && JSON.stringify(r3.body) === JSON.stringify(r4.body),
       r3.status + ' ' + JSON.stringify(r3.body) + ' vs ' + r4.status + ' ' + JSON.stringify(r4.body));
  requireStaff = async function (e, uid, venueId) { return { id: 's', role: 'owner', venue_id: venueId, auth_user_id: uid }; };
  BODY = { code: 'ACDEFG', format: 'bingo', players: 3, started_at: '2026-09-19T09:10:00Z' };
  var r5 = await handleReport({ headers: { get: function () { return ''; } } }, env, json);
  show('control: the host of the venue still files the report', r5.status === 200 && r5.body.ok === true, JSON.stringify(r5.body));

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' platform worker checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
