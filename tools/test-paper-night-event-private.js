/* ON A PAPER NIGHT THE PUBLIC REVEAL EVENT CARRIES NEITHER THE ANSWER NOR THE BOARD.
   Migration 94 removed correct_index; the leaderboard still went out after every question, and a
   team's total moving is the answer by another name (review, 28 Sep 2026; migration 97). Runs the
   REAL handleHostRevealManyTrips on the rig and reads the event it emitted.
   Run: jsc tools/test-paper-night-event-private.js */
load('tools/rig-game-worker.js');
var S='88888888-8888-4888-8888-888888888888', G='99999999-9999-4999-8999-999999999999', SET='44444444-4444-4444-8444-444444444444';
function world(defer){
  DB = { vp_sessions:[{ id:S, venue_id:VENUE, status:'running', state_version:1, join_code:'ACDEFG' }],
         vp_venues:[{ id:VENUE, slug:'test-venue', status:'active' }],
         vp_games:[{ id:G, session_id:S, seq:1, format:'trivia', status:'running',
                     config: defer ? { question_set_id:SET, base_points:100, time_limit_s:20, defer_reveal:true, round_size:6, question_seqs:[1] }
                                   : { question_set_id:SET, base_points:100, time_limit_s:20, question_seqs:[1] } }],
         vp_trivia_games:[{ game_id:G, question_set_id:SET, current_seq:1, phase:'asking', question_ends_at:new Date(NOWMS+5000).toISOString() }],
         vp_questions:[{ id:'q-1', set_id:SET, seq:1, question:'Q', options:['a','b','c','d'], correct_index:2, points:100, time_limit_s:20 }],
         vp_players:[{ id:'p1', session_id:S, display_name:'Ann', kicked:false }],
         vp_trivia_answers:[{ id:'a1', game_id:G, question_id:'q-1', player_id:'p1', answer_index:2, answered_at:new Date(NOWMS).toISOString(), is_correct:null, points_awarded:null }],
         v_vp_trivia_leaderboard:[{ game_id:G, player_id:'p1', display_name:'Ann', points:100 }] };
}
function ev(){ return (DB.__events||[]).filter(function(e){ return e.type==='trivia.reveal'; }).pop(); }
(async function(){
  world(true); BODY={ game_id:G };
  var r = await handleHostRevealManyTrips({}, ENV, json);
  var e = ev();
  show('paper night: the reveal goes through', r.status===200, JSON.stringify(r.body).slice(0,120));
  show('the public event says deferred', !!e && e.payload.deferred===true, JSON.stringify(e && e.payload));
  show('and carries NO correct answer', e && e.payload.correct_index===undefined);
  show('and NO leaderboard (a total moving is the answer by another name)', e && e.payload.leaderboard===undefined, JSON.stringify(e && e.payload));
  show('the host\'s own reply still has the answer and the board', r.body.correct_index===2 && Array.isArray(r.body.leaderboard) && r.body.leaderboard.length===1);
  world(false); BODY={ game_id:G };
  r = await handleHostRevealManyTrips({}, ENV, json); e = ev();
  show('control: an ordinary night broadcasts the answer and the board', e && e.payload.correct_index===2 && Array.isArray(e.payload.leaderboard));
  var sql = readFile('venueplay-backend/supabase/venueplay-97-paper-night-board-private.sql');
  show('migration 97 makes the same rule in SQL', /'options', v_options, 'deferred', true/.test(sql) && !/v_board, 'deferred', true/.test(sql));
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' paper event checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
