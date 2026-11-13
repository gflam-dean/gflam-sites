/* THREE SMALL HOLES FROM THE SECURITY AUDIT OF 3 NOV 2026, run through the REAL game Worker.

   L1  Musical bingo claim resolve checked "still pending", then wrote with no condition. Two
       near-simultaneous taps (confirm on one console, reject on the other) both passed, both
       wrote and both broadcast music.claim_result. Forced here: both requests are held at the
       write until both have read the claim.
   L2  GET /feedback/tally needs no sign-in, and handed out the poor count and a positive
       percentage for any session. Dean's rule: venues see favourable COUNTS only. (Fixed again on
       main by ea0c2837 as { loved, good }; this suite follows that shape since 13 Nov.)
   L3  The trivia submission admin key was compared with !== and could be guessed for ever.

   Run from the repo root:  jsc tools/test-security-lows-3nov.js
*/
load('tools/rig-game-worker.js');
var finished = false;
requireStaff = async function (env, uid, venueId) { return { id: 'staff-1', role: 'manager', venue_id: venueId, auth_user_id: uid, permissions: null }; };
var SID = '47000000-0000-4000-8000-000000000001', GID = '47000000-0000-4000-8000-000000000002', CID = '47000000-0000-4000-8000-000000000003';
var PID = '47000000-0000-4000-8000-000000000004', CARD = '47000000-0000-4000-8000-000000000005';
function req(url, ip) { return { url: url || 'https://w/x', headers: { get: function (k) { return /cf-connecting-ip/i.test(k) ? (ip || '') : ''; } } }; }
async function call(fn, body, r) {
  BODY = body || {};
  try { return await fn(r || req(), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
var realFetch = fetch, gate = null, arrived = 0, WAITING = 2, release = null;
function armGate(n) { WAITING = n; arrived = 0; gate = new Promise(function (res) { release = res; }); }
fetch = async function (url, opts) {
  var u = String(url), m = ((opts && opts.method) || 'GET').toUpperCase();
  if (gate && m === 'PATCH' && /\/rest\/v1\/vp_claims\?/.test(u)) { arrived++; if (arrived >= WAITING) release(); await gate; }
  return realFetch(url, opts);
};

(async function () {
  print('L1: confirm and reject at the same moment resolve the claim ONCE');
  DB = { vp_sessions: [{ id: SID, venue_id: VENUE, status: 'live' }],
         vp_games: [{ id: GID, session_id: SID, format: 'musical_bingo', status: 'running' }],
         vp_claims: [{ id: CID, game_id: GID, player_id: PID, card_id: CARD, status: 'pending', winning_cells: [1, 2, 3] }],
         vp_players: [{ id: PID, display_name: 'Sam' }], vp_cards: [{ id: CARD, card_no: 12 }] };
  armGate(2);
  var both = await Promise.all([call(handleClaimResolve, { claim_id: CID, decision: 'confirm' }),
                                call(handleClaimResolve, { claim_id: CID, decision: 'reject' })]);
  gate = null;
  var won = both.filter(function (r) { return r.status === 200; }), lost = both.filter(function (r) { return r.status === 409; });
  show('one tap resolves it, the other is told it is already resolved', won.length === 1 && lost.length === 1, JSON.stringify(both.map(function (r) { return r.status; })));
  var events = (DB.__events || []).filter(function (e) { return e.type === 'music.claim_result'; });
  show('exactly one music.claim_result goes to the TV', events.length === 1, String(events.length));
  show('the claim ends as the winning tap said, not the last write', events.length === 1 && DB.vp_claims[0].status === events[0].payload.status && won[0].body.status === DB.vp_claims[0].status, DB.vp_claims[0].status);
  var again = await call(handleClaimResolve, { claim_id: CID, decision: 'confirm' });
  show('a later tap changes nothing', again.status === 409 && (DB.__events || []).filter(function (e) { return e.type === 'music.claim_result'; }).length === 1);

  print('L2: the public tally carries favourable counts only');
  DB = { vp_game_feedback: [] };
  [3, 3, 2, 1, 1, 1].forEach(function (r, i) { DB.vp_game_feedback.push({ id: 'f' + i, session_id: SID, source: 'player', rating: r }); });
  DB.vp_game_feedback.push({ id: 'fh', session_id: SID, source: 'host', rating: 1 });
  var t = await call(handleFeedbackTally, {}, req('https://w/feedback/tally?session=' + SID));
  /* Tuesday's shape (ea0c2837, 13 Nov merge): { loved, good } only. The host page's own rendering is tested by
     tools/test-feedback-form.js (vp-loved.js); here only that the page reads it through VPLoved and nothing else. */
  show('Loved it and Good, as true counts', t.status === 200 && t.body.loved === 2 && t.body.good === 1, JSON.stringify(t.body));
  show('no poor count, no percentage, no total that gives the poor count away',
       t.status === 200 && Object.keys(t.body).sort().join() === 'good,loved', JSON.stringify(t.body));
  var page = readFile('venueplay/app/musical/host.html');
  var at = page.indexOf('function readVerdict(');
  var body = at > 0 ? page.slice(at, page.indexOf('\n    }', at)) : '';
  show('the musical host page reads the tally only through VPLoved (favourable counts)', /VPLoved\.show\(/.test(body) && !/feedback\/tally/.test(body), body.slice(0, 200));

  print('L3: the admin key is compared in constant time and cannot be guessed for ever');
  ENV.ADMIN_KEY = 'k-' + 'correct-horse-battery-staple';
  DB = { vp_question_submissions: [{ id: 's1', status: 'pending', created_at: '2026-10-01T00:00:00Z', question: 'Q?' }] };
  show('vpaSameSecret: equal is equal', vpaSameSecret('abc', 'abc') === true);
  show('vpaSameSecret: a prefix, a different length and empty are not', vpaSameSecret('ab', 'abc') === false && vpaSameSecret('abd', 'abc') === false && vpaSameSecret('', 'abc') === false && vpaSameSecret(undefined, 'abc') === false);
  var ok = await call(handleAdminSubmissions, { key: ENV.ADMIN_KEY }, req(null, '203.0.113.9'));
  show('the right key works', ok.status === 200 && ok.body.pending.length === 1, JSON.stringify(ok.body));
  var codes = [];
  for (var k = 0; k < 10; k++) codes.push((await call(handleAdminSubmissions, { key: 'guess' + k }, req(null, '198.51.100.7'))).status);
  show('ten wrong keys are refused', codes.every(function (c) { return c === 401; }), codes.join());
  var locked = await call(handleAdminSubmissions, { key: ENV.ADMIN_KEY }, req(null, '198.51.100.7'));
  show('then that network is told to wait, even with the right key', locked.status === 429, JSON.stringify(locked));
  var res = await call(handleAdminResolve, { key: 'guess-again', id: 's1', status: 'approved' }, req(null, '198.51.100.7'));
  show('the resolve route shares the limit', res.status === 429 && DB.vp_question_submissions[0].status === 'pending');
  ok = await call(handleAdminSubmissions, { key: ENV.ADMIN_KEY }, req(null, '203.0.113.9'));
  show('another network with the right key is not affected', ok.status === 200);
  delete ENV.ADMIN_KEY;
  var off = await call(handleAdminSubmissions, { key: '' }, req(null, '203.0.113.10'));
  show('no ADMIN_KEY set: the routes are shut, an empty key does not match an empty secret', off.status === 401);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('security lows: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
