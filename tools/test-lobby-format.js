/* WHICH GAME IS THIS CODE FOR, IN A NIGHT THAT RUNS SEVERAL. Audit 25 Sep 2026, found by playing:
   after a trivia round, every phone typing the code in the BINGO lobby was sent to a dead trivia page,
   because /join/info answered from the session's latest game and a lobby writes no game until it
   starts. Migration 89 keeps what the host opened. Runs the REAL handleJoinInfo and handleCreateSession
   from the shipped Worker. Run: jsc tools/test-lobby-format.js */
load('tools/rig-game-worker.js');
var S = '33333333-3333-4333-8333-333333333333';
function reset(lobby){
  DB = { vp_sessions:[{ id:S, venue_id:VENUE, join_code:'ABCDEF', status:'running', lobby_format:lobby, plan_cap_at_start:0 }],
         vp_venues:[{ id:VENUE, name:'Test Venue', slug:'test-venue', au_state:'NSW', status:'active' }],
         vp_venue_settings:[], vp_games:[], vp_players:[] };
}
async function info(code){ BODY = { code: code }; var r = await handleJoinInfo({}, ENV, json); return r.body.format; }
(async function(){
  reset('bingo90');
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'trivia', status:'finished' });
  show('a bingo lobby after a trivia round is BINGO, not the finished trivia', await info('ABCDEF') === 'bingo90', await info('ABCDEF'));
  reset('musical_bingo');
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'bingo90', status:'finished' });
  show('a musical lobby after bingo is MUSICAL', await info('ABCDEF') === 'musical_bingo');
  reset('musical_bingo');
  DB.vp_games.push({ id:'g2', session_id:S, seq:2, format:'trivia', status:'running' });
  show('a game actually running wins over the lobby note', await info('ABCDEF') === 'trivia');
  reset(null);
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'trivia', status:'finished' });
  show('control: no lobby note (migration 89 not run) keeps the old answer, trivia between rounds', await info('ABCDEF') === 'trivia');
  show('the consoles\' words map to the stored ones', lobbyFormat('musical') === 'musical_bingo' && lobbyFormat('bingo') === 'bingo90' && lobbyFormat('trivia') === 'trivia');
  reset('trivia');
  BODY = { venue_id: VENUE, format: 'bingo' };
  var r = await handleCreateSession({}, ENV, json);
  show('opening a bingo lobby on the live night records it', r.body.reused === true && DB.vp_sessions[0].lobby_format === 'bingo90', JSON.stringify(r.body).slice(0,80) + ' ' + DB.vp_sessions[0].lobby_format);
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' lobby format checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
