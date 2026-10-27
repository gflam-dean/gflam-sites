/* When Stripe refuses "Keep this venue", is the venue row really left as it was?

   This RUNS vpbCancelVenue out of the deployed file against a venue row held in memory.
   vpaPatch really changes that row, so what is asserted is the row afterwards and not the
   calls that were made: a rollback that writes the wrong fields makes the right number of calls.

   Run:  jsc tools/test-undo-cancel-rolls-back.js
*/
var SRC = 'venueplay-backend/worker/venueplay-api-FULL.js';
var src = readFile(SRC)
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var ENV = { SUPABASE_URL: 'https://example.invalid' };
var row, audits;

function arm(start, stripeSays) {
  row = {}; for (var k in start) row[k] = start[k];
  audits = [];
  vpbRequireOwner = function () {
    var v = {}; for (var k in row) if (k !== 'closed_at') v[k] = row[k];   // the owner lookup does not select closed_at
    return Promise.resolve({ account: { id: 'acct_1', plan: 'monthly', stripe_subscription_id: 'sub_1' },
                             venues: [v], perms: null, adminActor: null, authUserId: 'user_1' });
  };
  vpbOwnerOnly = function () { return null; };
  vpaSelect = function (env, table, q) {
    if (table === 'vp_venues') return Promise.resolve([{ closed_at: row.closed_at }]);
    return Promise.resolve([]);
  };
  vpaPatch = function (env, table, q, body) { if (table === 'vp_venues') for (var k in body) row[k] = body[k]; return Promise.resolve({}); };
  vpaSyncAccountQuantity = function () {
    return Promise.resolve(stripeSays === 'no' ? { syncFailed: 'No such subscription' }
                                               : { periodEnd: 1790000000, monthly: 12500 });
  };
  vpaInsert = function (env, table, body) { audits.push(body); return Promise.resolve({}); };
  vpaFireCancelAlert = function () { return Promise.resolve(); };
  vpaFireCancelConfirm = function () { return Promise.resolve(); };
}

function press(undo) {
  var body = { venue_id: 'v1', undo: undo };
  var req = { json: function () { return Promise.resolve(body); },
              text: function () { return Promise.resolve(JSON.stringify(body)); } };
  var out = null;
  vpbCancelVenue(req, ENV, function (b, status) { return { body: b, status: status || 200 }; })
    .then(function (r) { out = r; }, function (e) { out = { body: { error: 'THREW ' + e }, status: 0 }; });
  drainMicrotasks();
  return out;
}

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

var ENDED = { id: 'v1', name: 'The Royal Hotel', slug: 'the-royal', status: 'suspended', suspended_reason: 'ended',
              cancel_at_period_end: true, closed_at: '2026-09-01T00:00:00Z', max_players: 100, postcode: '4220' };

print('keep this venue, and Stripe says no');
arm(ENDED, 'no');
var r = press(true);
check('the owner is told it did not work', r && r.status === 502, r);
check('the venue is STILL switched off', row.status === 'suspended', row.status);
check('for the same reason as before', row.suspended_reason === 'ended', row.suspended_reason);
check('still flagged as leaving', row.cancel_at_period_end === true, row.cancel_at_period_end);
check('and its 90-day clock is put back, not left cleared', row.closed_at === '2026-09-01T00:00:00Z', row.closed_at);
check('nothing written to the audit trail for a change that did not happen', audits.length === 0, audits);
var r2 = press(true);
check('a second press gets the same honest answer', r2 && r2.status === 502 && row.status === 'suspended', [r2 && r2.status, row.status]);

print('keep this venue, and Stripe says yes');
arm(ENDED, 'yes');
var r3 = press(true);
check('it comes back on', r3 && r3.body && r3.body.ok === true && row.status === 'active' && row.suspended_reason === null, [r3, row]);
check('no longer leaving', row.cancel_at_period_end === false, row.cancel_at_period_end);
check('and the 90-day clock is stopped', row.closed_at === null, row.closed_at);

print('cancelling, and Stripe says no');
arm({ id: 'v1', name: 'The Royal Hotel', slug: 'the-royal', status: 'active', suspended_reason: null,
      cancel_at_period_end: false, closed_at: null, max_players: 100, postcode: '4220' }, 'no');
var r4 = press(false);
check('told it did not work', r4 && r4.status === 502, r4);
check('not left flagged as leaving', row.cancel_at_period_end === false && row.status === 'active', row);

print('an undo never turns on a venue that was switched off for not paying');
arm({ id: 'v1', name: 'The Royal Hotel', slug: 'the-royal', status: 'suspended', suspended_reason: 'nonpayment',
      cancel_at_period_end: true, closed_at: null, max_players: 100, postcode: '4220' }, 'yes');
press(true);
check('still suspended for non-payment', row.status === 'suspended' && row.suspended_reason === 'nonpayment', row);

if (fails) { throw new Error('undo cancel: ' + fails + ' failed'); }
print('PASS');
