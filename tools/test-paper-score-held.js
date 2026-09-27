/* ON A PAPER NIGHT A PHONE LEARNS NOTHING IT COULD PASS ON UNTIL THE ROUND IS OVER.
   Replay play-test, 27 Sep 2026: /player/score told a phone right/wrong and its running total after
   every question of a defer_reveal round, so it could tell a paper table before they handed in.
   Runs the REAL handlePlayerScore on the rig.  Run: jsc tools/test-paper-score-held.js */
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };
var S = '88888888-8888-4888-8888-888888888888', G = '99999999-9999-4999-8999-999999999999', P = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
function setup(defer, seq, phase, status){
  globalThis.__vpScoreCache = new Map();
  DB = { vp_games: [{ id: G, session_id: S, format: 'trivia', status: status || 'running',
                      config: defer ? { defer_reveal: true, round_size: 6, question_seqs: [11,12,13,14,15,16] } : { question_seqs: [11,12,13,14,15,16] } }],
         vp_trivia_games: [{ game_id: G, current_seq: seq, phase: phase }],
         vp_players: [{ id: P, session_id: S, token_hash: 'h-tok', display_name: 'Phone', kicked: false }],
         v_vp_trivia_leaderboard: [{ game_id: G, player_id: P, points: 250 }],
         vp_trivia_answers: [{ game_id: G, player_id: P, answer_index: 1, is_correct: true, points_awarded: 150, answered_at: '2026-09-19T09:29:00Z' }] };
}
function ask(){ return handlePlayerScore({ url: 'https://w/player/score?game=' + G, headers: { get: function(k){ return k === 'X-Player-Token' ? 'tok' : ''; } } }, ENV, json); }
(async function(){
  setup(true, 13, 'revealed');
  var r = await ask();
  show('paper night, question 3 of a round of 6 revealed: no total, rank or right/wrong', r.body.deferred === true && r.body.total === null && r.body.last.is_correct === null, JSON.stringify(r.body));
  setup(true, 16, 'asking');
  r = await ask();
  show('the round\'s last question still being asked: still held', r.body.deferred === true);
  setup(true, 16, 'revealed');
  r = await ask();
  show('once the last question of the round is revealed, the phone gets its score', r.body.total === 250 && r.body.last.is_correct === true && !r.body.deferred, JSON.stringify(r.body));
  setup(true, 13, 'revealed', 'finished');
  r = await ask();
  show('a finished paper game gives the score', r.body.total === 250);
  setup(false, 13, 'revealed');
  r = await ask();
  show('control: a normal night answers after every question, as before', r.body.total === 250 && r.body.last.is_correct === true && !r.body.deferred);
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' paper score checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
