/* A SESSION NOBODY IS RUNNING IS NOT LIVE, AND A PHONE ON A DEAD NIGHT IS TOLD. Dean's live play at Test
   Alpha, 6 Nov 2026 (findings B, F, G, I): a host left musical without End game and the venue's one live
   session kept answering "musical" to /play for the whole evening; a phone that joined a musical lobby
   never got a card because its night had been closed and re-opened under it.

   Runs the REAL handleJoinInfo, playLiveLookup, handleCreateSession and handlePlayerCard out of the shipped
   Worker, on the shared fake PostgREST (tools/rig-game-worker.js, whose clock stands at 2026-09-19 09:30Z).
   Run: jsc tools/test-session-lifecycle.js */
load('tools/rig-game-worker.js');
var S = '33333333-3333-4333-8333-333333333333', P1 = '44444444-4444-4444-8444-444444444444';
var NOW = new Date().toISOString();                       // the rig's frozen clock
function ago(h){ return new Date(Date.now() - h * 3600 * 1000).toISOString(); }
function reset(lobby, openedHoursAgo, status){
  DB = { vp_sessions:[{ id:S, venue_id:VENUE, join_code:'ACDEFG', status:status || 'lobby', lobby_format:lobby, plan_cap_at_start:0,
                        opened_at:ago(openedHoursAgo), created_at:ago(openedHoursAgo) }],
         vp_venues:[{ id:VENUE, name:'Test Venue', slug:'test-venue', au_state:'NSW', status:'active', join_code:'ACDEFG' }],
         vp_venue_settings:[], vp_games:[], vp_players:[] };
}
async function info(code){ BODY = { code: code, fresh: 1 }; var r = await handleJoinInfo({}, ENV, json); return r.body; }
async function live(code){ var r = await playLiveLookup(ENV, code); return r.body; }
(async function(){
  /* ---- B and F: a walked-away trivia or musical lobby is not on ---- */
  reset('musical_bingo', 5);
  var a = await info('ACDEFG');
  show('a musical lobby opened 5 hours ago with no game is not live for /join/info (no "Up first: Musical bingo")', a.format !== 'musical_bingo' && a.room_code === '', JSON.stringify([a.format, a.room_code]));
  var b = await live('ACDEFG');
  show('and not live for /play/live', b.live === false, JSON.stringify(b));
  reset('trivia', 5);
  show('a trivia lobby the same age is gone too', (await live('ACDEFG')).live === false);

  reset('musical_bingo', 1);
  show('control: the same lobby opened 1 hour ago is live', (await live('ACDEFG')).live === true && (await info('ACDEFG')).format === 'musical_bingo');
  reset('musical_bingo', 5);
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'musical_bingo', status:'running' });
  show('control: a game still RUNNING keeps an old session live', (await live('ACDEFG')).live === true);
  reset('musical_bingo', 5);
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'musical_bingo', status:'finished', started_at:ago(4.5), ended_at:ago(1) });
  show('control: a game that ended an hour ago keeps the night live (the clock is the LAST game, not the lobby)', (await live('ACDEFG')).live === true);
  reset('bingo90', 6);
  show('control: a bingo night is never judged by this (broadcast bingo can run hours with no game row)', (await live('ACDEFG')).live === true);
  reset(null, 6);
  show('control: nor a session with no lobby note at all', (await live('ACDEFG')).live === true);
  reset('musical_bingo', 5, 'running');
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'musical_bingo', status:'finished', started_at:ago(4.9), ended_at:ago(4.4) });
  show('a "running" session whose last game ended 4 hours ago is gone', (await live('ACDEFG')).live === false);

  /* ---- B: the next lobby closes it and opens a fresh one ---- */
  reset('musical_bingo', 5);
  DB.vp_players.push({ id:P1, session_id:S, device_id:'d1', display_name:'Dean' });
  BODY = { venue_id: VENUE, format: 'trivia' };
  var r = await handleCreateSession({}, ENV, json);
  var old = DB.vp_sessions.filter(function(x){ return x.id === S; })[0];
  show('opening a lobby over an abandoned one closes the old night', old.status === 'finished' && !!old.ended_at, old.status);
  show('and opens a NEW session on the same venue code, not the old id', r.body.session_id !== S && r.body.reused !== true && r.body.join_code === 'ACDEFG', JSON.stringify(r.body));
  var fresh = DB.vp_sessions.filter(function(x){ return x.id === r.body.session_id; })[0];
  show('the new one is a trivia lobby', !!fresh && fresh.status === 'lobby' && fresh.lobby_format === 'trivia', fresh && fresh.lobby_format);
  show('only one live session at the venue afterwards', DB.vp_sessions.filter(function(x){ return x.status === 'lobby' || x.status === 'running' || x.status === 'paused'; }).length === 1);

  reset('musical_bingo', 1);
  BODY = { venue_id: VENUE, format: 'bingo' };
  r = await handleCreateSession({}, ENV, json);
  show('control: a young lobby is reused, and told it is bingo now (Dean\'s finding F, server half)', r.body.reused === true && r.body.session_id === S && DB.vp_sessions[0].lobby_format === 'bingo90', JSON.stringify(r.body).slice(0, 90));
  var after = await info('ACDEFG');
  show('and the code then answers bingo, not musical', after.format === 'bingo90' && after.room_code === '', after.format);
  reset('musical_bingo', 1);
  DB.vp_games.push({ id:'g1', session_id:S, seq:1, format:'musical_bingo', status:'running' });
  BODY = { venue_id: VENUE, format: 'bingo' };
  await handleCreateSession({}, ENV, json);
  show('a bingo lobby over a musical game still running ends that game (finding F)', DB.vp_games[0].status === 'finished');
  after = await info('ACDEFG');
  show('so the code answers bingo even though a musical game had been running', after.format === 'bingo90', after.format);

  /* ---- G: a phone whose night has ended is told to re-join, not to wait for ever ---- */
  async function card(){
    var res = null;
    verifyPlayerToken = async function(){ return { id:P1, session_id:S, kicked:false }; };
    res = await handlePlayerCard({ url:'https://x/player/card', headers:{ get:function(){ return ''; } } }, ENV, json);
    return res.body;
  }
  reset('musical_bingo', 1, 'finished'); DB.vp_sessions[0].ended_at = ago(0.5);
  var c = await card();
  show('a phone on a FINISHED night with no game gets stale:true (rejoin)', c.game === null && c.stale === true, JSON.stringify(c));
  reset('musical_bingo', 1, 'lobby');
  c = await card();
  show('a phone on a live lobby with no game yet just waits (no stale flag)', c.game === null && c.stale !== true, JSON.stringify(c));

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' session lifecycle checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
