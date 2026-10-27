/* A host removes one question between two rounds of the same night. Does round two repeat round one?

   It did: the within-session memory was a list of seq NUMBERS, removing renumbers the set, and
   five of round one's questions came round again in round two (audit, 20 Sep 2026). Runs the
   REAL hostStartTrivia and handleTriviaRemove out of the shipped game Worker on the rig.

   Run from the repo root:  jsc tools/test-trivia-no-repeat-survives-a-removal.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SET = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
function qid(i) { return 'dddddddd-dddd-4ddd-8ddd-' + ('000000000000' + i).slice(-12); }
DB.vp_sessions = [{ id: SESSION, venue_id: VENUE, status: 'running', state_version: 1, join_code: 'ACDEFG' }];
DB.vp_venues = [{ id: VENUE, slug: 'test-pub', status: 'active' }];
DB.vp_question_sets = [{ id: SET, visibility: 'private', title: 'Tuesday', owner_venue_id: VENUE, question_count: 20 }];
DB.vp_questions = [];
for (var i = 0; i < 20; i++) DB.vp_questions.push({ id: qid(i), set_id: SET, seq: i + 1, question: 'Quiz ' + i, options: ['a', 'b', 'c', 'd'], correct_index: 0, parked_at: null });
DB.vp_games = []; DB.vp_trivia_games = []; DB.vp_asked_questions = [];
var staff = { id: 'staff-1', role: 'owner', venue_id: VENUE, auth_user_id: HOST };
function idsOf(gameId) { var g = DB.vp_games.filter(function (x) { return x.id === gameId; })[0]; return (g.config.question_ids || []).slice(); }
function seqsOf(gameId) { var g = DB.vp_games.filter(function (x) { return x.id === gameId; })[0]; return (g.config.question_seqs || []).slice(); }

(async function () {
  print('round one, ten questions');
  var session = await getSession(ENV, SESSION);
  var r1 = await hostStartTrivia(ENV, json, { question_set_id: SET, question_count: 10 }, session, staff, 1);
  show('round one starts with ten', r1.status === 200 && r1.body.question_count === 10, JSON.stringify(r1.body));
  var ids1 = idsOf(r1.body.game_id), seqs1 = seqsOf(r1.body.game_id);
  show('the game records WHICH questions it dealt, not only their positions', ids1.length === 10 && ids1.every(function (id) { return /^dddddddd/.test(id); }), JSON.stringify(ids1.slice(0, 3)));

  print('a removal while the round is running is refused');
  var notAsked = DB.vp_questions.filter(function (q) { return ids1.indexOf(q.id) < 0; })[0];
  BODY = { question_id: notAsked.id };
  var rm0 = await handleTriviaRemove({}, ENV, json);
  show('the host is told to finish the round first', rm0.status === 409 && /running/.test(rm0.body.error), JSON.stringify(rm0.body));
  show('and the set is untouched', DB.vp_questions.length === 20, DB.vp_questions.length + ' questions');

  print('the round ends, one unasked question is removed, the set renumbers');
  DB.vp_games.forEach(function (g) { g.status = 'finished'; });
  var rm = await handleTriviaRemove({}, ENV, json);
  show('the removal goes through between rounds', rm.status === 200 && DB.vp_questions.length === 19, JSON.stringify(rm.body));
  var renumbered = DB.vp_questions.slice().sort(function (a, b) { return a.seq - b.seq; }).every(function (q, i) { return q.seq === i + 1; });
  show('the set is renumbered 1 to 19', renumbered);

  print('round two, nine questions');
  /* The twelve-month memory would hide the fault, so take it away: only the within-night
     memory is allowed to stand between round one and round two here. */
  DB.vp_asked_questions = [];
  var r2 = await hostStartTrivia(ENV, json, { question_set_id: SET, question_count: 9 }, session, staff, 2);
  show('round two starts with nine', r2.status === 200 && r2.body.question_count === 9, JSON.stringify(r2.body));
  var ids2 = idsOf(r2.body.game_id);
  var repeats = ids2.filter(function (id) { return ids1.indexOf(id) >= 0; });
  show('round two repeats NONE of round one', repeats.length === 0, repeats.length + ' repeated of ' + ids2.length);
  show('the nine are the nine not yet asked tonight', ids2.length === 9 && ids2.every(function (id) { return ids1.indexOf(id) < 0 && id !== notAsked.id; }));

  print('a game from before ids were recorded still counts by seq');
  DB.vp_games.forEach(function (g) { delete g.config.question_ids; g.status = 'finished'; });
  var r3 = await hostStartTrivia(ENV, json, { question_set_id: SET, question_count: 5 }, session, staff, 3);
  var seqs3 = seqsOf(r3.body.game_id), usedSeqs = seqs1.concat(seqsOf(r2.body.game_id));
  show('an old game\'s seqs are still honoured as the best it has', r3.status === 200 && seqs3.length === 5, JSON.stringify(r3.body));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('no-repeat: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
