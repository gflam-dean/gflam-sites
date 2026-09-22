/* A host adds ten seconds to a question. Does the player who answered at second ten
   suddenly score as if they answered at second zero?

   They did: the speed bonus is measured back from the deadline, and the deadline had moved
   (audit, 20 Sep 2026: 125 became 150). Runs the REAL handleHostAddTime and
   handleHostRevealManyTrips out of the shipped game Worker on the rig.

   Run from the repo root:  jsc tools/test-added-time-keeps-the-bonus-honest.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SET = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
var Q1 = 'dddddddd-dddd-4ddd-8ddd-000000000001', P = { early: 'eeeeeeee-eeee-4eee-8eee-000000000001', late: 'eeeeeeee-eeee-4eee-8eee-000000000002', after: 'eeeeeeee-eeee-4eee-8eee-000000000003' };
function iso(ms) { return new Date(ms).toISOString(); }
function world() {
  var asked = NOWMS;                                            // the question opened now, 20 seconds long
  DB.vp_sessions = [{ id: SESSION, venue_id: VENUE, status: 'running', state_version: 1, join_code: 'ACDEFG' }];
  DB.vp_venues = [{ id: VENUE, slug: 'test-pub', status: 'active' }];
  DB.vp_games = [{ id: GAME, session_id: SESSION, seq: 1, format: 'trivia', status: 'running', config: { question_set_id: SET, base_points: 100, time_limit_s: 20, speed_bonus: true, question_seqs: [1] } }];
  DB.vp_trivia_games = [{ game_id: GAME, question_set_id: SET, current_seq: 1, phase: 'asking', question_ends_at: iso(asked + 20000), speed_bonus: true }];
  DB.vp_questions = [{ id: Q1, set_id: SET, seq: 1, question: 'Q', options: ['a', 'b', 'c', 'd'], correct_index: 2, points: 100, time_limit_s: 20 }];
  DB.vp_players = [P.early, P.late, P.after].map(function (id) { return { id: id, session_id: SESSION, display_name: id.slice(-1), kicked: false }; });
  DB.vp_trivia_answers = [
    { id: 'a1', game_id: GAME, question_id: Q1, player_id: P.early, answer_index: 2, answered_at: iso(asked + 10000), is_correct: null, points_awarded: null },   // second ten of twenty
    { id: 'a2', game_id: GAME, question_id: Q1, player_id: P.late,  answer_index: 2, answered_at: iso(asked + 19000), is_correct: null, points_awarded: null },   // second nineteen
  ];
  DB.v_vp_trivia_leaderboard = [];
  return asked;
}
function pts(pid) { return DB.vp_trivia_answers.filter(function (a) { return a.player_id === pid; })[0].points_awarded; }

(async function () {
  print('no time added: the bonus is what the scheme says');
  var asked = world();
  NOWMS = asked + 21000;
  BODY = { game_id: GAME };
  var r0 = await handleHostRevealManyTrips({}, ENV, json);
  show('an answer at second ten of twenty scores 125', r0.status === 200 && pts(P.early) === 125, 'status ' + r0.status + ', ' + pts(P.early));
  show('an answer at second nineteen scores about 103', pts(P.late) === 103, String(pts(P.late)));

  print('ten seconds added while the question is open');
  asked = world();
  NOWMS = asked + 15000;
  BODY = { game_id: GAME, seconds: 10 };
  var add = await handleHostAddTime({}, ENV, json);
  show('the time is added and the deadline moves', add.status === 200 && Date.parse(DB.vp_trivia_games[0].question_ends_at) === asked + 30000, JSON.stringify(add.body));
  DB.vp_trivia_answers.push({ id: 'a3', game_id: GAME, question_id: Q1, player_id: P.after, answer_index: 2, answered_at: iso(asked + 25000), is_correct: null, points_awarded: null });   // answered in the added time
  NOWMS = asked + 31000;
  BODY = { game_id: GAME };
  var r1 = await handleHostRevealManyTrips({}, ENV, json);
  show('the reveal still goes through', r1.status === 200, JSON.stringify(r1.body));
  show('the answer at second ten STILL scores 125, not 150', pts(P.early) === 125, String(pts(P.early)));
  show('the answer at second nineteen still scores about 103', pts(P.late) === 103, String(pts(P.late)));
  show('an answer inside the added time counts, with no speed bonus', pts(P.after) === 100, String(pts(P.after)));

  print('adding twice adds up');
  asked = world();
  NOWMS = asked + 12000; BODY = { game_id: GAME, seconds: 10 }; await handleHostAddTime({}, ENV, json);
  NOWMS = asked + 14000; BODY = { game_id: GAME, seconds: 5 };  await handleHostAddTime({}, ENV, json);
  NOWMS = asked + 36000; BODY = { game_id: GAME };
  var r2 = await handleHostRevealManyTrips({}, ENV, json);
  show('fifteen seconds added in two goes, the second-ten answer is still 125', r2.status === 200 && pts(P.early) === 125, String(pts(P.early)));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('added time: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
