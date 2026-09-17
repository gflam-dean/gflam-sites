/* An opt-in a venue cannot see must at least be an opt-in a venue is TOLD about.

   Broadcast bingo has no session, so a capture arriving without a player token cannot be
   vouched for: anyone who knows a venue exists could post a forged opt-in with a consent
   timestamp, which is a Spam Act problem for the VENUE. Those rows are stored, marked
   during_game false, and left out of v_vp_player_optins. That exclusion is right and it stays.

   What was wrong is that nobody was told. The venue collected details, somebody really
   consented, and the list simply did not contain them, with nothing anywhere saying so. As at
   17 Sep 2026, 9 of 30 captures arrive with no token.

   This RUNS vpaOptinCsv out of the shipped Worker.

   Run:  jsc tools/test-optin-held-back.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var VENUES = [{ id: 'v1', name: 'The Wellshot' }];
var queries;

function arm(opts) {
  queries = [];
  vpaSelect = function (env, table, q) {
    queries.push(table + '?' + q);
    if (table === 'v_vp_player_optins') return Promise.resolve(opts.visible || []);
    if (table === 'vp_captures') {
      if (opts.heldQueryFails) return Promise.reject(new Error('boom'));
      return Promise.resolve(opts.held || []);
    }
    return Promise.resolve([]);
  };
}
function run(opts) {
  arm(opts);
  var out = null;
  vpaOptinCsv({}, VENUES).then(function (r) { out = r; }).catch(function (e) { out = { threw: String(e) }; });
  drainMicrotasks();
  return out;
}
function person(email) {
  return { venue_id: 'v1', first_name: 'Jane', last_name: 'Smith', email: email,
           mobile: null, postcode: null, opted_in_at: '2026-09-17T00:00:00Z' };
}

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('an opt-in a venue cannot see is one a venue is told about');

/* 1. Nothing held: the number is zero, not missing, so the page can rely on it. */
var r1 = run({ visible: [person('a@x.com')] });
check('nothing held: count right', r1.count === 1, r1);
check('nothing held: held_unverified is 0, not undefined', r1.held_unverified === 0, r1.held_unverified);

/* 2. THE FAULT. Rows exist that the venue will never see, and the number says so. */
var r2 = run({ visible: [person('a@x.com')], held: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] });
check('three held back: reported', r2.held_unverified === 3, r2.held_unverified);
check('three held back: they are NOT in the file', (r2.csv.match(/Jane/g) || []).length === 1, r2.csv);

/* 3. The worst case: everything they collected is held, and the file is empty. Silence here
      is a venue concluding the feature does not work. */
var r3 = run({ visible: [], held: [{ id: 'c1' }] });
check('all held, nothing visible: count 0 AND held 1', r3.count === 0 && r3.held_unverified === 1, r3);

/* 4. It asks the right question: opted in, and unverified. Not merely unverified. */
run({ visible: [], held: [] });
var q = queries.filter(function (x) { return x.indexOf('vp_captures') === 0; })[0] || '';
check('asks for opted-in rows only', /marketing_optin=is\.true/.test(q), q);
check('asks for unverified rows only', /during_game=is\.false/.test(q), q);
check('scoped to this account\'s venues', /venue_id=in\.\(v1\)/.test(q), q);

/* 5. A venue's real list must never fail to download because the extra count could not be
      worked out. Best effort, and zero rather than an exception. */
var r5 = run({ visible: [person('a@x.com')], heldQueryFails: true });
check('the held count failing does not break the download', r5 && r5.count === 1 && !r5.threw, r5);
check('and it reports 0 rather than a broken number', r5.held_unverified === 0, r5.held_unverified);

/* 6. Still one person once. The dedup that stops a venue mailing a regular twelve times. */
var r6 = run({ visible: [person('a@x.com'), person('a@x.com'), person('b@x.com')] });
check('the same punter across many nights is listed once', r6.count === 2, r6.count);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('held back: ' + fails + ' failed'); }
