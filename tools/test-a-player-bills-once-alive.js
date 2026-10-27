/* Forty phones scanned the QR on the table. Twelve typed a name and got a card. Who is billed?

   Dean, 22 Sep 2026: "a player only bills once they've shown life". Broadcast bingo leaves no
   per-player trace on the server, so every joined row was billed and a stranger with the join
   code could inflate a venue's head count from anywhere (audit, 20 Sep 2026). Runs the REAL
   handlePlayerAlive and playerIdsWhoPlayed out of the shipped game Worker on the rig.

   Run from the repo root:  jsc tools/test-a-player-bills-once-alive.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };
var finished = false;
var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function pid(i) { return 'dddddddd-dddd-4ddd-8ddd-' + ('000000000000' + i).slice(-12); }
function world(withCards) {
  DB.vp_games = [{ id: GAME, session_id: SESSION, format: 'bingo', status: 'running' }];
  DB.vp_players = []; DB.vp_cards = []; DB.vp_trivia_answers = [];
  for (var i = 0; i < 40; i++) DB.vp_players.push({ id: pid(i), session_id: SESSION, token_hash: 'h-tok' + i, display_name: i < 12 ? 'P' + i : '', kicked: false, played_at: null });
  if (withCards) for (var c = 0; c < 12; c++) DB.vp_cards.push({ id: 'c' + c, game_id: GAME, player_id: pid(c) });
}
function alive(i) { return handlePlayerAlive({ headers: { get: function (k) { return k === 'X-Player-Token' ? 'tok' + i : ''; } } }, ENV, json); }

(async function () {
  print('broadcast bingo: forty joined, twelve are in the game');
  world(false);
  for (var i = 0; i < 12; i++) await alive(i);
  var played = await playerIdsWhoPlayed(ENV, SESSION);
  show('the twelve who hold a card are the players', !!played && played.size === 12 && played.has(pid(0)) && played.has(pid(11)), played && played.size);
  show('the twenty-eight who only opened the join page are not', !!played && !played.has(pid(12)) && !played.has(pid(39)));
  var again = await alive(3);
  show('a second alive from the same phone changes nothing', again.status === 200 && DB.vp_players[3].played_at, JSON.stringify(again.body));
  var stamped = DB.vp_players.filter(function (p) { return p.played_at; }).length;
  show('exactly twelve rows carry the stamp', stamped === 12, stamped + ' stamped');

  print('phones on the old page: nobody has stamped');
  world(false);
  var none = await playerIdsWhoPlayed(ENV, SESSION);
  show('with no stamp and no card anywhere, the caller falls back to the old count', none === null, String(none));

  print('a format that deals cards still counts them');
  world(true);
  await alive(20);                                             // one extra phone, in the game with no card yet
  var mixed = await playerIdsWhoPlayed(ENV, SESSION);
  show('card holders and the stamped phone: thirteen', !!mixed && mixed.size === 13 && mixed.has(pid(20)), mixed && mixed.size);

  print('and the phones actually say so');
  /* The stamp is only as good as the call. Each phone page must call sayAlive() at the moment
     it holds a card or a question, and sayAlive must post to /player/alive. */
  var pages = [['venueplay/play.html', /function renderCards\(\)\{\s*sayAlive\(\);/],
               ['venueplay/app/trivia/play.html', /else if\(m\.t==="question"\)\{ sayAlive\(\);/],
               ['venueplay/app/musical/play.html', /function renderCard\(\)\{\s*sayAlive\(\);/]];
  pages.forEach(function (pg) {
    var src = readFile(pg[0]);
    show(pg[0].split('/').slice(-2).join('/') + ' says it is in the game the moment it holds a card or question',
         pg[1].test(src) && /playerPost\("\/player\/alive"/.test(src));
  });

  print('a stranger cannot stamp somebody else');
  var bad = null; try { await handlePlayerAlive({ headers: { get: function () { return 'not-a-token'; } } }, ENV, json); } catch (e) { bad = e; }
  show('a made-up token is refused', !!bad && bad.status === 401, String(bad && bad.status));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('alive: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
