/* AN UNSOLD TICKET IS NEVER DRAWN, HOWEVER MANY BLOCKS THERE ARE.
   Audit, 27 Sep 2026: the game Worker kept only the first 20 unsold blocks (so the 21st stretch could
   be drawn) and counted overlapping blocks twice in "tickets left". Runs the REAL hostStartRaffle
   (via handleHostGame) and handleHostDraw on the rig. The random pick itself is untouched.
   Run: jsc tools/test-raffle-unsold-server.js */
load('tools/rig-game-worker.js');
var S = '77777777-7777-4777-8777-777777777777';
function reset(){
  DB = { vp_sessions: [{ id: S, venue_id: VENUE, status: 'running', join_code: 'ACDEFG', plan_cap_at_start: 0 }],
         vp_venues: [{ id: VENUE, name: 'Test Venue', slug: 'test-venue', status: 'active' }],
         vp_venue_settings: [], vp_games: [], vp_players: [], vp_raffle_games: [], vp_raffle_results: [] };
}
(async function(){
  show('merging: overlapping and touching blocks become one, sorted', JSON.stringify(mergeTicketRanges([[20,25],[1,10],[5,19],[40,40],[41,45]])) === '[[1,25],[40,45]]',
       JSON.stringify(mergeTicketRanges([[20,25],[1,10],[5,19],[40,40],[41,45]])));
  reset();
  var blocks = []; for (var i = 1; i <= 25; i++) blocks.push([i * 10, i * 10 + 5]);
  BODY = { session_id: S, format: 'raffle', range_min: 1, range_max: 300, winners: 1, excluded_ranges: blocks };
  var r = await handleHostGame({}, ENV, json);
  show('a raffle with 25 unsold blocks starts', r.status === 200, JSON.stringify(r.body).slice(0, 160));
  var g = DB.vp_games.filter(function(x){ return x.format === 'raffle'; })[0];
  show('and keeps all 25 (it used to keep 20)', g && g.config.excluded_ranges.length === 25, g && JSON.stringify(g.config.excluded_ranges.slice(-2)));
  var hits = [], ok = 0;
  for (var d = 0; d < 60; d++) {
    BODY = { game_id: g.id };
    var dr = await handleHostDraw({}, ENV, json);
    if (dr.status !== 200) break;
    ok++;
    (dr.body.tickets || dr.body.winners || []).forEach(function(t){ var n = +((t && (t.ticket || t.number)) || t); if (n >= 210 && n <= 255 && n % 10 <= 5) hits.push(n); });
  }
  show('60 draws never land in blocks 21 to 25 (the ones that used to be dropped)', ok > 0 && hits.length === 0, ok + ' draws, landed in unsold: ' + JSON.stringify(hits));
  reset();
  BODY = { session_id: S, format: 'raffle', range_min: 1, range_max: 20, winners: 1, excluded_ranges: [[1,10],[5,19]] };
  r = await handleHostGame({}, ENV, json);
  var g2 = DB.vp_games.filter(function(x){ return x.format === 'raffle'; })[0];
  BODY = { game_id: g2 && g2.id };
  var one = await handleHostDraw({}, ENV, json);
  show('overlapping blocks are not counted twice: the one ticket left (20) can be drawn', one.status === 200 && JSON.stringify(one.body).indexOf('20') >= 0, one.status + ' ' + JSON.stringify(one.body).slice(0, 160));
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' raffle unsold checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
