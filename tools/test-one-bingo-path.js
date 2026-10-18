/* ONE BINGO DRAW, ONE TICKET MAKER, ONE CLAIM PATH (Dean, 19 Oct 2026: "remove whatever doesn't need
   to be there or could jeopardise OLGR licensing").

   The live game Worker used to carry a second 90-ball bingo that nothing called: /host/game with
   format bingo90 (its own shuffle into vp_bingo_games and its own one-ticket deal into vp_cards),
   /host/ball to draw from it, and 90-ball branches of /player/card, /player/claim and
   /host/claim/resolve that judged against it. It also carried Jag the Joker, a random draw game
   switched off behind JAG_ON and never put to OLGR. A technical assessor reading the Worker would
   rightly ask what each of those is. They are gone; Jag is kept whole on branch jag-joker-parked.

   This RUNS the real Worker (tools/rig-game-worker.js) through its own front door (fetch), so a
   route that is gone answers exactly what an unknown path answers, and runs the removed handlers'
   replacements against a fake database to show they write nothing. Musical bingo, which still uses
   /player/card, /player/claim and /host/claim/resolve, is proved by its own suites.

   Run from the repo root:  jsc tools/test-one-bingo-path.js */
load('tools/rig-game-worker.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 300) : '')); }
}
var SRC_W = readFile('venueplay-backend/worker/venueplay-game.js');
var SRC_C = readFile('venueplay/app/index.html');
function exists(p) { try { readFile(p); return true; } catch (e) { return false; } }

var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', CLAIM = 'cccccccc-cccc-4ccc-8ccc-000000000001';
function freshDb() {
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', au_state: 'QLD' }], vp_venue_groups: [], vp_venue_settings: [],
         vp_sessions: [{ id: SESSION, venue_id: VENUE, status: 'running', join_code: 'ABCDEF', state_version: 1 }],
         vp_players: [{ id: 'p-1', session_id: SESSION, kicked: false, device_id: 'phoneAAAAAA', display_name: 'Ann' }],
         vp_games: [{ id: GAME, session_id: SESSION, seq: 1, format: 'bingo90', status: 'running', config: {} }],
         vp_bingo_games: [{ game_id: GAME, draw_order: [1, 2, 3, 4, 5], draw_index: 5, pattern: 'one_line' }],
         vp_cards: [{ id: 'card-1', game_id: GAME, player_id: 'p-1', card_no: 1, cells: [1, 2, 3, 4, 5, 0, 0, 0, 0].concat(new Array(18).fill(0)) }],
         vp_claims: [{ id: CLAIM, game_id: GAME, player_id: 'p-1', card_id: 'card-1', status: 'pending', auto_verdict: 'valid' }],
         vp_events: [], vp_bingo_draws: [], vp_bingo_draw_balls: [] };
}
function writes() { return LOG.filter(function (l) { return /^(POST|PATCH|DELETE) /.test(l) && !/rpc\//.test(l); }); }
var ON = Object.assign({}, ENV, { JAG_ON: '1' });
async function front(method, path, body, env) {
  BODY = body || {};
  var req = { method: method, url: 'https://game.test' + path, headers: { get: function (k) { return k === 'Authorization' ? 'Bearer tok' : ''; } } };
  var r = await __worker.fetch(req, env || ENV);
  return { status: r.status, body: JSON.parse(r._b || 'null') };
}
// A player token for the player routes: the rig has no signing, so the token check is stood in for.
verifyPlayerToken = async function () { return { id: 'p-1', session_id: SESSION, display_name: 'Ann' }; };

(async function () {
  print('the routes that are gone answer exactly what an unknown path answers');
  freshDb(); LOG = [];
  var unknown = await front('POST', '/no/such/route', {});
  check('CONTROL: an unknown path is a 404 "not found"', unknown.status === 404 && unknown.body.error === 'not found', unknown);
  var ball = await front('POST', '/host/ball', { game_id: GAME });
  check('/host/ball is gone: 404 "not found", nothing drawn', ball.status === 404 && ball.body.error === 'not found' && DB.vp_bingo_games[0].draw_index === 5, ball);
  var live = await front('POST', '/host/bingo/ball', { draw_id: '99999999-9999-4999-8999-000000000999' });
  check('CONTROL: the one live ball route is still there (it answers about the draw, not "not found")', live.body && live.body.error !== 'not found', live);
  var jag = [['GET', '/jag/board?venue=test-pub'], ['GET', '/host/jag?venue_id=' + VENUE], ['POST', '/host/jag/start'], ['POST', '/host/jag/turn'], ['POST', '/host/jag/jackpot'], ['POST', '/host/jag/close']];
  var jagSaw = [];
  for (var i = 0; i < jag.length; i++) { var r = await front(jag[i][0], jag[i][1], { venue_id: VENUE, jag_id: GAME, card: 1, winner_name: 'x', jackpot_cents: 100, deck_size: 10 }, ON); jagSaw.push(r.status + ' ' + (r.body && r.body.error)); }
  check('Jag the Joker is gone: all six routes are "not found", even with JAG_ON=1', jagSaw.every(function (x) { return x === '404 not found'; }), jagSaw);
  check('and nothing anywhere in the Worker mentions its handlers or tables', !/handleJag|jagOn|vp_jag_|JAG_ON/.test(SRC_W));

  print('the old 90-ball game on /host/game');
  freshDb(); LOG = [];
  var g = await front('POST', '/host/game', { session_id: SESSION, format: 'bingo90', pattern: 'one_line' });
  check('/host/game refuses bingo90, and writes no game, no draw order and no ticket', g.status === 400 && /Unsupported/.test(g.body.error) && DB.vp_games.length === 1 && DB.vp_cards.length === 1 &&
        !writes().some(function (w) { return /vp_games|vp_bingo_games|vp_cards|vp_events/.test(w); }), { r: g, writes: writes() });
  var g2 = await front('POST', '/host/game', { session_id: SESSION, pattern: 'one_line' });
  check('with no format it no longer defaults to bingo: refused too', g2.status === 400 && /Unsupported/.test(g2.body.error), g2);

  print('the 90-ball branches of the player routes');
  freshDb(); LOG = [];
  var claim = await front('POST', '/player/claim', { game_id: GAME });
  check('/player/claim on a 90-ball game is refused, and writes no claim', claim.status === 404 && claim.body.error === 'Not a musical game' && DB.vp_claims.length === 1 && !writes().length, { r: claim, writes: writes() });
  var card = await front('GET', '/player/card', {});
  check('/player/card with only a 90-ball game running hands out nothing and deals nothing', card.status === 200 && card.body.game === null && DB.vp_cards.length === 1 && !writes().length, { r: card, writes: writes() });
  var card2 = await front('GET', '/player/card?game=' + GAME, {});
  check('/player/card asked for the 90-ball game by id: nothing either', card2.status === 200 && card2.body.game === null && !writes().length, card2);
  var res = await front('POST', '/host/claim/resolve', { claim_id: CLAIM, decision: 'confirm' });
  check('/host/claim/resolve on a 90-ball claim is refused, and the claim and the game are left alone',
        res.status === 404 && DB.vp_claims[0].status === 'pending' && DB.vp_games[0].status === 'running' && !writes().length, { r: res, writes: writes() });

  print('one ball generator and one ticket maker, in the files');
  check('the Worker never touches vp_bingo_games or vp_draw_next_ball any more', !/['"]vp_bingo_games['"]|vp_draw_next_ball['"]/.test(SRC_W));
  check('the Worker shuffles 1 to 90 in one place, called once (the draw at /host/bingo/draw)',
        (SRC_W.match(/function shuffle1to90\(/g) || []).length === 1 && (SRC_W.match(/shuffle1to90\(/g) || []).length - 1 === 1 && /draw_order: shuffle1to90\(\)/.test(SRC_W));
  check('the Worker makes tickets in one place (generateStrip): the single-ticket maker is gone', !/function generateTicket\(/.test(SRC_W) && /function generateStrip\(/.test(SRC_W));
  var SRC_D = readFile('venueplay/app/vp-draw.js');
  check('the tablet has one ticket maker for an outage (makeStrip, in /app/vp-draw.js), none in the console page itself',
        !/function makeCard\(|function pickColCounts\(|function assignRows\(|function pickNumbers\(|function makeStrip\(/.test(SRC_C + SRC_D.replace(/function makeStrip\(/, '')) &&
        (SRC_D.match(/function makeStrip\(/g) || []).length === 1 && /VPDraw\.makeStrip\(\)/.test(SRC_C));
  check('the console has no Jag tile and no route to a Jag page', !/jagTile|\/app\/jag\/|data-game="jag"/.test(SRC_C));
  check('the Jag pages are gone from the site', !exists('venueplay/app/jag/host.html') && !exists('venueplay/app/jag/screen.html') && !exists('venueplay/jag-check.html'));
  check('no screen still watches a Jag channel', !/"jag"/.test(readFile('venueplay/tv.html')) && !/jag/.test(readFile('venueplay/app/vp-screen-router.js')));

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' one-bingo-path checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
