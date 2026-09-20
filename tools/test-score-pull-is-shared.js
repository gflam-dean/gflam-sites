/* Forty phones ask for their score after one reveal. How many times is the database asked?

   Runs the REAL handlePlayerScore and the REAL token check out of the shipped game Worker,
   against the rig's fake database, and COUNTS the reads. What is asserted is both halves:
   the room shares one leaderboard read, and nobody is ever shown somebody else's numbers or
   last question's numbers because of it.

   Run from the repo root:  jsc tools/test-score-pull-is-shared.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };      // the rig's digest is all zeros, so every token would be one player
var finished = false;
var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function pid(i) { return 'dddddddd-dddd-4ddd-8ddd-' + ('000000000000' + i).slice(-12); }
DB.vp_games = [{ id: GAME, session_id: SESSION, format: 'trivia' }];
DB.vp_players = []; DB.v_vp_trivia_leaderboard = []; DB.vp_trivia_answers = [];
for (var i = 0; i < 40; i++) {
  DB.vp_players.push({ id: pid(i), session_id: SESSION, token_hash: 'h-tok' + i, display_name: 'P' + i, kicked: false });
  DB.v_vp_trivia_leaderboard.push({ game_id: GAME, player_id: pid(i), points: 1000 - i * 10 });
  DB.vp_trivia_answers.push({ game_id: GAME, player_id: pid(i), answer_index: 1, is_correct: true, points_awarded: 100 + i, answered_at: '2026-09-19T09:29:0' + (i % 10) + 'Z' });
}
DB.vp_players.push({ id: pid(99), session_id: OTHER, token_hash: 'h-stranger', display_name: 'Stranger', kicked: false });

function ask(tok, qs) {
  return handlePlayerScore({ url: 'https://w/player/score?game=' + GAME + (qs || ''), headers: { get: function (k) { return k === 'X-Player-Token' ? tok : ''; } } }, ENV, json);
}
function reads(table) { return LOG.filter(function (l) { return l.indexOf('GET ' + table) === 0; }).length; }

(async function () {
  print('one reveal, forty phones');
  LOG.length = 0;
  var wrong = [];
  for (var i = 0; i < 40; i++) {
    var r = await ask('tok' + i, '&q=7');
    if (r.status !== 200 || r.body.total !== 1000 - i * 10 || r.body.rank !== i + 1 || r.body.players_count !== 40 || r.body.last.points_awarded !== 100 + i) wrong.push([i, r.body]);
  }
  show('every phone gets ITS OWN total, place and points', wrong.length === 0, JSON.stringify(wrong.slice(0, 2)));
  show('the leaderboard is read ONCE for the room, not forty times', reads('v_vp_trivia_leaderboard') === 1, reads('v_vp_trivia_leaderboard') + ' reads');
  show('the game row is read once', reads('vp_games') === 1, reads('vp_games') + ' reads');
  show('each phone is still checked against its own token, every time', reads('vp_players') === 40, reads('vp_players') + ' reads');
  show('under 85 database reads for the room, where it was 160', LOG.length <= 85, LOG.length + ' reads');

  print('the next question is never answered from the last one');
  DB.v_vp_trivia_leaderboard.forEach(function (b) { if (b.player_id === pid(39)) b.points = 5000; });   // last place takes the lead
  NOWMS += 3000;                                                                                        // well inside the time the old board is kept
  var lead = await ask('tok39', '&q=8'), was = await ask('tok0', '&q=8');
  show('question 8 sees the new scores even three seconds later', lead.body.total === 5000 && lead.body.rank === 1 && was.body.rank === 2, JSON.stringify([lead.body, was.body]));
  NOWMS += 20000;
  DB.v_vp_trivia_leaderboard.forEach(function (b) { if (b.player_id === pid(39)) b.points = 6000; });
  var later = await ask('tok39', '&q=8');
  show('and a kept board is let go after a few seconds, so a host correction shows up', later.body.total === 6000, JSON.stringify(later.body));

  print('what must not change');
  LOG.length = 0;
  await ask('tok1', ''); await ask('tok2', '');
  show('a phone page that sends no question number gets a fresh read every time', reads('v_vp_trivia_leaderboard') === 2, reads('v_vp_trivia_leaderboard') + ' reads');
  var stranger = await ask('stranger', '&q=8');
  show('a player from ANOTHER session is refused even though the game is already in memory', stranger.status === 403, 'status ' + stranger.status);
  var refusal = null; try { await ask("not-a-token", "&q=8"); } catch (e) { refusal = e; }
  show('a made-up token is refused', !!refusal && refusal.status === 401, String(refusal && refusal.status));
  LOG.length = 0;
  var skipped = await ask('tok5', '&q=8&last=0');
  show('a phone that did not answer asks for no answer row, and none is read', reads('vp_trivia_answers') === 0 && skipped.body.last.answered === false && typeof skipped.body.total === 'number', JSON.stringify(skipped.body));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('score pull: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
