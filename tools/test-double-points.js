/* DOUBLE POINTS FINAL ROUND, RUN, not read. Dean, 28 Sep 2026: "a double points round on/off that
   saves to the venue so they don't have to change it every week".

   Drives the REAL shipped Worker on the rig: a night started with double points on marks exactly
   its last N questions, the setting is saved to the venue, a correct answer on a doubled question
   scores twice (speed bonus included) and on any other question scores as before, and a paper team
   is scored twice only for the answers it got right in the doubled questions. The one-trip SQL
   (migration 96) makes the same decision from the same config.double_seqs.

   Run: jsc tools/test-double-points.js   (from the repo root) */
load('tools/rig-game-worker.js');

var SESSION = '33333333-3333-4333-8333-333333333333';
var SET = '44444444-4444-4444-8444-444444444444';
function reset(){
  DB = { vp_sessions:[{ id:SESSION, venue_id:VENUE, join_code:'ACDEFG', status:'lobby', plan_cap_at_start:0, paper:null }],
         vp_venues:[{ id:VENUE, name:'Test Venue', status:'active', created_at:'2026-01-01T00:00:00Z' }],
         vp_players:[], vp_games:[], vp_trivia_games:[], vp_trivia_answers:[], vp_questions:[], vp_venue_settings:[],
         vp_asked_questions:[], vp_admin_audit:[], v_vp_trivia_leaderboard:[],
         vp_question_sets:[{ id:SET, title:'Set', owner_venue_id:null, visibility:'library', question_count:6 }] };
  for (var i=1;i<=6;i++) DB.vp_questions.push({ id:'q-'+i, set_id:SET, seq:i, question:'Q'+i, options:['A','B','C','D'], correct_index:i % 4, points:100, time_limit_s:20 });
}
venueInFreeMonth = async function(){ return false; };
checkWeeklyFormatLimit = async function(){ return null; };
stampWeeklyFormat = async function(){};
async function call(fn, body){ BODY = body; try { return await fn({}, ENV, json); } catch(e){ return { status:e.status||500, body:{ error:String(e.message||e) } }; } }
function game(){ return DB.vp_games[DB.vp_games.length-1]; }
function scoreOf(pid, qid){ var a = DB.vp_trivia_answers.filter(function(x){ return x.player_id===pid && x.question_id===qid; })[0]; return a ? a.points_awarded : null; }

(async function(){
  print('\nstarting a night with double points on');
  reset();
  var r = await call(handleHostGame, { session_id:SESSION, format:'trivia', question_set_id:SET, question_count:6,
                                       time_limit_s:20, base_points:100, speed_bonus:false, double_points:true, double_last:2 });
  show('the night starts', r.status === 200, JSON.stringify(r.body).slice(0,160));
  var cfg = game().config, seqs = cfg.question_seqs;
  show('exactly the LAST two questions of the night are doubled', JSON.stringify(cfg.double_seqs) === JSON.stringify(seqs.slice(-2)), JSON.stringify(cfg.double_seqs)+' of '+JSON.stringify(seqs));
  show('by id as well, for paper scoring', cfg.double_ids.length === 2 && cfg.double_ids[1] === 'q-'+seqs[5]);
  show('the console is told which ones', JSON.stringify(r.body.double_seqs) === JSON.stringify(cfg.double_seqs));
  var saved = DB.vp_venue_settings.filter(function(s){ return s.trivia_double_points !== undefined; })[0];
  show('the setting is saved to the venue for next week', saved && saved.trivia_double_points === true && saved.trivia_double_last === 2, JSON.stringify(DB.vp_venue_settings));
  show('and the speed bonus is still saved on its own', DB.vp_venue_settings.some(function(s){ return s.trivia_speed_bonus === false; }));

  reset();
  r = await call(handleHostGame, { session_id:SESSION, format:'trivia', question_set_id:SET, question_count:6, double_points:false, double_last:2 });
  show('control: off means no question is doubled', r.status === 200 && !game().config.double_seqs, JSON.stringify(game().config.double_seqs));
  show('and off is saved too, so next week it stays off', DB.vp_venue_settings.some(function(s){ return s.trivia_double_points === false; }));
  reset();
  r = await call(handleHostGame, { session_id:SESSION, format:'trivia', question_set_id:SET, question_count:6, speed_bonus:true });
  show('an old console that sends nothing changes no saved setting', !DB.vp_venue_settings.some(function(s){ return s.trivia_double_points !== undefined; }));

  print('\nscoring (the Worker\'s reveal; migration 96 is the same rule in SQL)');
  function asking(seq, speed){
    reset();
    var G = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    DB.vp_sessions[0].status = 'running';
    DB.vp_games = [{ id:G, session_id:SESSION, seq:1, format:'trivia', status:'running',
      config:{ question_set_id:SET, base_points:100, time_limit_s:20, speed_bonus:speed, question_seqs:[1,2,3,4,5,6], double_seqs:[5,6] } }];
    DB.vp_trivia_games = [{ game_id:G, question_set_id:SET, current_seq:seq, phase:'asking', question_ends_at:new Date(NOWMS + 10000).toISOString() }];
    DB.vp_trivia_answers = [
      { id:'a1', game_id:G, question_id:'q-'+seq, player_id:'p1', answer_index:seq % 4, answered_at:new Date(NOWMS).toISOString(), is_correct:null, points_awarded:null },
      { id:'a2', game_id:G, question_id:'q-'+seq, player_id:'p2', answer_index:(seq+1) % 4, answered_at:new Date(NOWMS).toISOString(), is_correct:null, points_awarded:null } ];
    return G;
  }
  var G = asking(6, false);
  r = await call(handleHostRevealManyTrips, { game_id:G });
  show('a right answer on a doubled question scores 200', r.status === 200 && scoreOf('p1','q-6') === 200, r.status+' '+scoreOf('p1','q-6'));
  show('a wrong one still scores 0', scoreOf('p2','q-6') === 0);
  show('and the host is told it was a double', r.body.double === true);
  G = asking(3, false);
  r = await call(handleHostRevealManyTrips, { game_id:G });
  show('control: the same answer on question 3 scores 100', scoreOf('p1','q-3') === 100 && r.body.double === false, String(scoreOf('p1','q-3')));
  G = asking(5, true);
  r = await call(handleHostRevealManyTrips, { game_id:G });
  show('the speed bonus is doubled too: halfway through 20s is 125, doubled 250', scoreOf('p1','q-5') === 250, String(scoreOf('p1','q-5')));

  print('\npaper teams');
  reset();
  await call(handlePaperPrint, { session_id:SESSION, kind:'trivia', count:2, round_size:6, questions:6 });
  r = await call(handleHostGame, { session_id:SESSION, format:'trivia', question_set_id:SET, question_count:6, base_points:100, speed_bonus:false, double_points:true, double_last:2 });
  G = r.body.game_id;
  game().status = 'finished';   // the round is over, so the sheets may be scored
  r = await call(handlePaperScore, { game_id:G, round:1, teams:[{ no:1, name:'Oldies', correct:4, double:1 }, { no:2, name:'Quiet', correct:3, double:0 }] });
  show('the sheets are scored', r.status === 200, JSON.stringify(r.body).slice(0,140));
  function paperTotal(no){ var p = DB.vp_players.filter(function(x){ return x.device_id === 'paper-t-'+no; })[0];
    return DB.vp_trivia_answers.filter(function(a){ return p && a.player_id === p.id; }).reduce(function(t,a){ return t + (a.points_awarded||0); }, 0); }
  show('4 right with 1 in the double round: 3 x 100 + 1 x 200 = 500', paperTotal(1) === 500, String(paperTotal(1)));
  show('3 right, none doubled: 300', paperTotal(2) === 300, String(paperTotal(2)));
  r = await call(handlePaperScore, { game_id:G, round:1, teams:[{ no:1, name:'Oldies', correct:6, double:0 }] });
  show('6 right out of 6 must include both doubled ones, whatever was typed: 800', paperTotal(1) === 800, String(paperTotal(1)));
  r = await call(handlePaperScore, { game_id:G, round:1, teams:[{ no:2, name:'Quiet', correct:1, double:5 }] });
  show('more doubled than they got right is capped: 1 right, doubled, 200', paperTotal(2) === 200, String(paperTotal(2)));

  print('\nthe console');
  var H = readFile('venueplay/app/trivia/host.html');
  show('the console sends the setting when the night starts', /double_points:G\.doublePoints, double_last:G\.doubleLast/.test(H));
  show('it pre-fills from the venue\'s saved setting', /s\.trivia_double_points!=null\) G\.doublePoints=/.test(H) && /s\.trivia_double_last!=null\)/.test(H));
  show('every question it sends the TV and phones says whether it is doubled', (H.match(/double:isDouble\(/g) || []).length === 4);
  show('the TV and the phone both show it', /m\.double===true/.test(readFile('venueplay/app/trivia/screen.html')) && /m\.double===true/.test(readFile('venueplay/app/trivia/play.html')));

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' double points checks failed');
})().catch(function(e){ print('CRASH ' + e + ' ' + (e && e.stack)); throw e; });
