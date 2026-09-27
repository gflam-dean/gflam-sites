/* AN "OK" COVERS THE ROOM THE HOST WAS SHOWN, OR THE SAME QUESTION COMES BACK FOR EVER.
   Found by the live play-test, 27 Sep 2026. The start check counts every joined phone; tapping OK
   recorded only the phones that had already PLAYED. Plan 40, 30 played round 1, 15 more joined for
   round 2: the host is shown 45, OK records 30, the ceiling is 30 + 10 = 40, and 45 > 40 asks again.
   In a free month the consoles approve with no dialog, so that was an endless loop and no game.
   Runs the REAL handleOverageAck and overageCeiling on the rig.  Run: jsc tools/test-overage-ack-covers-room.js */
load('tools/rig-game-worker.js');
var S = '44444444-4444-4444-8444-444444444444';
(async function(){
  var players = [], cards = [];
  for (var i = 1; i <= 45; i++) {
    var id = 'p-' + i; players.push({ id: id, session_id: S, device_id: 'dev-' + i, kicked: false, display_name: 'P' + i });
    if (i <= 30) cards.push({ id: 'c-' + i, game_id: 'g1', player_id: id, card_no: i });
  }
  DB = { vp_sessions: [{ id: S, venue_id: VENUE, status: 'running', plan_cap_at_start: 40, overage_approved: false, join_code: 'ABCDEF' }],
         vp_venues: [{ id: VENUE, name: 'Test Venue', slug: 'test-venue', status: 'active' }],
         vp_players: players, vp_games: [{ id: 'g1', session_id: S, seq: 1, format: 'musical_bingo', status: 'finished' }],
         vp_cards: cards, vp_trivia_answers: [], vp_claims: [] };
  var sess = function(){ return DB.vp_sessions[0]; };
  show('control: before OK, 45 in the room is over the plan of 40 with no approval', !sess().overage_approved && countPlayers(DB.vp_players) === 45);
  BODY = { session_id: S };
  var r = await handleOverageAck({}, ENV, json);
  show('the host is shown 45 and OK records 45, the number they agreed to', r.status === 200 && sess().overage_approved_count === 45, JSON.stringify(r.body));
  var ceil = overageCeiling(sess(), 40);
  show('so the same 45 players do not trigger the question again (ceiling ' + ceil + ')', ceil >= 45, String(ceil));
  show('and stragglers still get the margin before asking again', ceil >= 45 + 10, String(ceil));
  show('the CHARGE still counts only players who played (30), never the approval', countPlayersWhoPlayed(DB.vp_players, await playerIdsWhoPlayed(ENV, S)) === 30);
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' overage ack checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
