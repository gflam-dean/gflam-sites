/* The 90-day deletion promise, actually kept.

   privacy.html says in writing: "When a venue's account is closed, its player list is deleted
   within 90 days." Nothing did it. It could not have been written either, because nothing
   recorded WHEN a venue closed.

   The failure mode here is deleting the wrong venue's customers, and there is no undo, so most
   of this file is about what the sweep must REFUSE to touch.

   This RUNS sweepRetention out of the shipped Worker.

   Run:  jsc tools/test-retention-sweep.js
*/
var src = readFile('venueplay-backend/worker/venueplay-game.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var gets, patches;
function arm(opts) {
  gets = []; patches = [];
  sbGet = function (env, table, q) {
    gets.push(table + '?' + q);
    if (table === 'vp_venues') return Promise.resolve(opts.venues || []);
    if (table === 'vp_sessions') return Promise.resolve(opts.sessions || []);
    return Promise.resolve([]);
  };
  sbPatch = function (env, table, q, body) {
    patches.push({ table: table, q: q, body: body });
    if (opts.patchFails) return Promise.reject(new Error('boom'));
    return Promise.resolve({});
  };
}
function run(opts) {
  arm(opts);
  var out = null;
  sweepRetention({}).then(function (r) { out = r; }).catch(function (e) { out = { threw: String(e) }; });
  drainMicrotasks();
  return out;
}
var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('the 90-day promise, kept');

/* 1. Nothing due: nothing touched. The ordinary night, and it must be silent. */
var r0 = run({ venues: [] });
check('no venue is due: nothing patched at all', patches.length === 0 && r0.venues === 0, [r0, patches]);

/* 2. WHAT IT ASKS FOR is the whole safety story. Get this query wrong and it empties a
      paying customer's list. */
run({ venues: [] });
var q = gets[0] || '';
check('asks only for venues closed BEFORE the cutoff', /closed_at=lt\./.test(q), q);
check('asks only for SUSPENDED venues', /status=eq\.suspended/.test(q), q);
check('skips venues already purged', /player_data_purged_at=is\.null/.test(q), q);
var days = /const RETENTION_DAYS = (\d+);/.exec(src);
check('the promise in privacy.html is 90 days and so is the code', days && days[1] === '90', days && days[1]);

/* 3. A due venue: the people go, the metering stays. */
var r1 = run({ venues: [{ id: 'v1', name: 'The Old Pub', closed_at: '2026-01-01T00:00:00Z' }],
               sessions: [{ id: 's1' }, { id: 's2' }] });
var pp = patches.filter(function (p) { return p.table === 'vp_players'; });
check('a due venue: its players are cleared', pp.length === 1, patches);
check('cleared BY SESSION, so it cannot reach another venue', /session_id=in\.\(s1,s2\)/.test(pp[0].q), pp[0].q);
['first_name','last_name','email','mobile','postcode','marketing_optin','marketing_optin_at'].forEach(function (f) {
  check('the person goes: ' + f + ' is nulled', pp[0].body[f] === null, pp[0].body);
});
check('the row itself is NOT deleted, because it is what they were billed on',
  Object.keys(pp[0].body).indexOf('id') === -1 && Object.keys(pp[0].body).indexOf('session_id') === -1, pp[0].body);
check('broadcast bingo captures are cleared too, by venue',
  patches.some(function (p) { return p.table === 'vp_captures' && /venue_id=eq\.v1/.test(p.q); }), patches);

/* 4. The record that we did it, in its own column, and closed_at left alone. */
var stamp = patches.filter(function (p) { return p.table === 'vp_venues'; })[0];
check('it is stamped so it does not run again every night', stamp && !!stamp.body.player_data_purged_at, stamp);
check('and closed_at is NOT cleared, or we lose when they closed',
  stamp && !('closed_at' in stamp.body), stamp && stamp.body);
check('the count comes back', r1.venues === 1 && r1.captures === 1, r1);

/* 5. A venue with no sessions still gets its captures cleared. Broadcast bingo has no session
      at all, so skipping on "no sessions" would leave exactly the bingo data behind. */
var r2 = run({ venues: [{ id: 'v9', name: 'Bingo Only', closed_at: '2026-01-01T00:00:00Z' }], sessions: [] });
check('no sessions: still clears the captures',
  patches.some(function (p) { return p.table === 'vp_captures'; }), patches);
check('no sessions: and does not patch players with an empty list',
  !patches.some(function (p) { return p.table === 'vp_players'; }), patches);

/* 6. A thousand sessions must not become one enormous URL, and half a purge is worse than none. */
var many = []; for (var i = 0; i < 120; i++) many.push({ id: 's' + i });
var r3 = run({ venues: [{ id: 'v1', name: 'Busy', closed_at: '2026-01-01T00:00:00Z' }], sessions: many });
var pcount = patches.filter(function (p) { return p.table === 'vp_players'; }).length;
check('120 sessions are done in batches, not one giant request', pcount === 3, pcount);
check('and every one of them is accounted for', r3.players === 120, r3.players);

/* 7. It stops rather than carrying on half-done. */
var r4 = run({ venues: [{ id: 'v1', name: 'X', closed_at: '2026-01-01T00:00:00Z' }], sessions: [{ id: 's1' }], patchFails: true });
check('a failed write stops the sweep and reports it', !!r4.error && !r4.threw, r4);
check('and does NOT claim it purged anything', r4.venues === undefined, r4);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('retention: ' + fails + ' failed'); }
