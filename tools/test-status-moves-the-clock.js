/* THE 90-DAY CLOCK MUST MOVE WITH THE VENUE'S STATUS, IN BOTH DIRECTIONS.

   Audit, 20 Sep 2026. vpaHandleVenueStatus patched status and reason only:
     - archiving from HQ never stamped closed_at, so the retention sweep could never see
       the venue and its players were kept for ever (the privacy page promises 90 days)
     - REACTIVATING never cleared it, so an un-archived venue kept an old closed date, and
       one failed card months later put a live customer's players in front of the 3am
       purge. That delete has no undo.

   This RUNS the shipped handler out of the billing Worker and asserts what it WROTE.

   Run:  jsc tools/test-status-moves-the-clock.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }

var patches, PRIOR;
function arm(prior) {
  PRIOR = prior; patches = [];
  vpaRequireAdmin = function () { return Promise.resolve({ id: 'admin-1', email: 'hq@x' }); };
  vpaSelect = function (env, table, q) {
    if (table === 'vp_venues') return Promise.resolve([PRIOR]);
    return Promise.resolve([]);
  };
  vpaPatch = function (env, table, q, body) { patches.push({ table: table, body: body }); return Promise.resolve({}); };
  vpaInsert = function () { return Promise.resolve({}); };
  vpaAudit = function () { return Promise.resolve({}); };
  // Anything that would reach Stripe or email answers harmlessly: this suite is about the row.
  fetch = function () { return Promise.resolve({ ok: true, status: 200,
    json: function () { return Promise.resolve({ data: [] }); },
    text: function () { return Promise.resolve('{}'); } }); };
}
function send(status) {
  var body = { venue_id: 'v1', status: status };
  var req = { json: function () { return Promise.resolve(body); },
              text: function () { return Promise.resolve(JSON.stringify(body)); },
              headers: { get: function () { return 'Bearer t'; } } };
  var out = null;
  vpaHandleVenueStatus(req, { SUPABASE_URL: 'https://db', STRIPE_SECRET_KEY: 'k' },
    function (o, st) { return { body: o, status: st || 200 }; })
    .then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drain();
  var venuePatch = patches.filter(function (p) { return p.table === 'vp_venues'; })[0];
  return { out: out, patch: venuePatch && venuePatch.body };
}

print('The retention clock follows the status');
print('');

arm({ id: 'v1', name: 'The Anchor', status: 'active', suspended_reason: null, closed_at: null });
var r = send('archived');
check('archiving writes the venue row at all', !!r.patch, r.out);
check('archiving STARTS the clock', !!(r.patch && r.patch.closed_at), r.patch);

arm({ id: 'v1', name: 'The Anchor', status: 'suspended', suspended_reason: 'cancelled',
      closed_at: '2026-07-01T00:00:00.000Z' });
r = send('archived');
check('archiving a venue whose clock is already running does NOT restart it',
      !!r.patch && !('closed_at' in r.patch), r.patch);

arm({ id: 'v1', name: 'The Anchor', status: 'suspended', suspended_reason: 'archived',
      closed_at: '2026-06-01T00:00:00.000Z' });
r = send('active');
check('reactivating CLEARS the clock (the no-undo hazard)',
      !!r.patch && ('closed_at' in r.patch) && r.patch.closed_at === null, r.patch);
check('and the venue really is set active', !!r.patch && r.patch.status === 'active', r.patch);

arm({ id: 'v1', name: 'The Anchor', status: 'active', suspended_reason: null, closed_at: null });
r = send('suspended');
check('a plain manual suspension does NOT start the clock: it is short and reversible',
      !!r.patch && !r.patch.closed_at, r.patch);

print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
