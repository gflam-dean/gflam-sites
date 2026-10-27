/* THE END OF A BINGO GAME IS THE END OF ITS GAME ROW.
   Live play-test, 27 Sep 2026: the console's end report patched only vp_game_reports, so the bingo90
   row the start report had created stayed "running": /play/live and /join/info kept saying bingo, and
   a musical phone picked that row and got "Not a bingo game". Runs the REAL handleReport on the rig.
   Run: jsc tools/test-bingo-end-report.js */
load('tools/rig-game-worker.js');
var S = '55555555-5555-4555-8555-555555555555', R = '66666666-6666-4666-8666-666666666666';
(async function(){
  DB = { vp_venues: [{ id: VENUE, name: 'Test Venue', slug: 'test-venue', join_code: 'ACDEFG', status: 'active' }],
         vp_sessions: [{ id: S, venue_id: VENUE, status: 'running', created_at: '2026-09-19T09:00:00Z' }],
         vp_games: [{ id: 'g-b', session_id: S, seq: 1, format: 'bingo90', status: 'running' },
                    { id: 'g-t', session_id: S, seq: 0, format: 'trivia', status: 'finished' }],
         vp_game_reports: [{ id: R, venue_id: VENUE, format: 'bingo', started_at: '2026-09-19T09:10:00Z' }] };
  var game = function(id){ return DB.vp_games.filter(function(g){ return g.id === id; })[0]; };
  BODY = { code: 'ACDEFG', report_id: R, format: 'bingo', players: 12, started_at: '2026-09-19T09:10:00Z' };
  await handleReport({ headers: { get: function(){ return ''; } } }, ENV, json);
  show('control: a report with no end leaves the game running', game('g-b').status === 'running');
  BODY = { code: 'ACDEFG', report_id: R, format: 'bingo', players: 12, started_at: '2026-09-19T09:10:00Z', ended_at: '2026-09-19T09:40:00Z' };
  var r = await handleReport({ headers: { get: function(){ return ''; } } }, ENV, json);
  show('the end report is accepted', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  show('and the bingo game row is finished with it', game('g-b').status === 'finished' && !!game('g-b').ended_at, JSON.stringify(game('g-b')));
  show('nothing else on the night is touched', game('g-t').status === 'finished' && DB.vp_sessions[0].status === 'running');
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' end report checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
