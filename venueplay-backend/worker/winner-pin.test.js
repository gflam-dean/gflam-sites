/* THE WINNER CHECK PIN, tested against the Worker itself (Dean, 4 Nov 2026).

   A 4-digit PIN per round, the same for every player in it, new every round. The winner's phone shows
   it with their card or ticket number and the host console shows "Round PIN 4821". NEVER on a TV.

   What this holds the code to:
     1. The PIN rules: always 4 digits, the same prize gives the same PIN, another round or ANOTHER PRIZE
        in the same round another one (Dean, 5 Nov 2026: a game that carries on to the next prize gets a
        new PIN), made with HMAC-SHA256 under the Worker's secret (checked against Python's hmac), and no
        secret, a bad round or an unknown prize is refused rather than guessed.
     2. Who gets it: the host route only for staff at the round's venue; the player route only for a
        player in the round's session whom the Worker's own record shows WON it (bingo: a confirmed
        claim from this phone on this draw FOR THIS PRIZE; musical: a valid claim on this game; trivia:
        1st place only, once the last question is revealed). The phone's PIN and the console's PIN are the same.
     3. It is NOT in the TV payload: the two routes never emit an event, publish to the room or
        broadcast; the shared page helper never sends; no console or phone puts it in a message; and
        no TV page loads the helper or names the route.

   The functions are lifted out of venueplay-game.js verbatim, never restated here, so a change to the
   Worker is what this tests. jsc has no WebCrypto, so the HMAC is the harness's own SHA-256
   (partyplay-backend/worker/_test-sha256.js), checked against Python before anything relies on it.

   Run: jsc venueplay-backend/worker/winner-pin.test.js
*/
var pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; print('  ok   ' + n); } else { fail++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

function findFile(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 200) return tries[i]; } catch (e) {} }
  throw new Error('cannot find ' + rel);
}
function read(rel) { return readFile(findFile(rel)); }
var src = read('venueplay-backend/worker/venueplay-game.js');
if (src.indexOf('handlePlayerWinnerPin') < 0) throw new Error('venueplay-game.js has no winner PIN');
load(findFile('partyplay-backend/worker/_test-sha256.js'));

/* A top-level function (async or not) by name, braces balanced, strings and comments skipped. */
function lift(name) {
  var m = new RegExp('(^|\\n)((async )?function ' + name + '\\s*\\()').exec(src);
  if (!m) throw new Error('no function ' + name);
  var i = src.indexOf('{', m.index + m[0].length), depth = 0, j, q = null;
  for (j = i; j < src.length; j++) {
    var c = src[j], d = src[j + 1];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && d === '/') { j = src.indexOf('\n', j); continue; }
    if (c === '/' && d === '*') { j = src.indexOf('*/', j + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}
function body(name) { return lift(name); }

// ---- the Worker's runtime, the little of it these functions touch ----
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
globalThis.crypto = { subtle: {
  importKey: function (fmt, k, alg, ex, uses) { return Promise.resolve({ _k: k._s, alg: alg, uses: uses }); },
  sign: function (alg, key, msg) { SIGNED.push({ alg: alg, key: key, msg: msg._s }); return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); }
} };
var SIGNED = [];
eval(lift('httpError'));
eval(lift('assertUuid'));
eval(lift('enc'));
eval(lift('winPinDigits'));
eval(lift('winPinStage'));
var WIN_PIN_STAGES = ['one', 'two', 'three', 'full', 'top', 'middle', 'bottom', 'corners', 'custom', 'final'];
eval(lift('winnerPin'));
eval(lift('winPinRoundOf'));
eval(lift('winPinMusicCellsAre'));
eval(lift('winPinPlayerWon'));
eval(lift('handleHostWinnerPin'));
eval(lift('handlePlayerWinnerPin'));
var BINGO_DRAW_COLS = 'id,venue_id,session_id';
eval(lift('bingoDrawForStaff'));

// ---- a fake database and fake auth ----
var VENUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER_VENUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
var SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', OTHER_SESSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
var GAME = '11111111-1111-4111-8111-111111111111', DRAW = '22222222-2222-4222-8222-222222222222';
var GAME2 = '33333333-3333-4333-8333-333333333333';
var HOST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', STRANGER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
var PLAYER = '44444444-4444-4444-8444-444444444444', PLAYER2 = '55555555-5555-4555-8555-555555555555';
var DB, AUTH_USER, PLAYER_ROW, BODY, EMITTED;
function reset() {
  DB = {
    vp_games: [{ id: GAME, session_id: SESSION, status: 'running', format: 'musical_bingo', config: {} }],
    vp_bingo_draws: [{ id: DRAW, venue_id: VENUE, session_id: SESSION, created_at: '2026-11-08T09:00:00Z' }],
    vp_players: [{ id: PLAYER, device_id: 'dev-one' }, { id: PLAYER2, device_id: 'dev-two' }],
    vp_bingo_claims: [], vp_claims: [], vp_trivia_games: [], v_vp_trivia_leaderboard: []
  };
  AUTH_USER = HOST; PLAYER_ROW = { id: PLAYER, session_id: SESSION, display_name: 'Quiz Wizards', kicked: false };
  BODY = {}; EMITTED = []; SIGNED = [];
}
function q(query) {
  var out = {}; String(query).split('&').forEach(function (p) { var k = p.split('='); out[k[0]] = decodeURIComponent(k.slice(1).join('=')); });
  return out;
}
function match(row, f) {
  for (var k in f) {
    if (k === 'select' || k === 'order' || k === 'limit') continue;
    var v = f[k], col = row[k];
    if (v.indexOf('eq.') === 0) { if (String(col) !== v.slice(3)) return false; }
    else if (v.indexOf('in.(') === 0) { if (v.slice(4, -1).split(',').indexOf(String(col)) < 0) return false; }
  }
  return true;
}
function sbGet(env, table, query) {
  var f = q(query), rows = (DB[table] || []).filter(function (r) { return match(r, f); });
  if (f.order === 'points.desc') rows = rows.slice().sort(function (a, b) { return b.points - a.points; });
  if (f.order === 'created_at.desc') rows = rows.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  if (f.limit) rows = rows.slice(0, +f.limit);
  return Promise.resolve(rows);
}
function verifyHostJwt() { return Promise.resolve(AUTH_USER); }
function verifyPlayerToken() { return Promise.resolve(PLAYER_ROW); }
function readJson() { return Promise.resolve(BODY); }
function getSession(env, id) { return Promise.resolve({ id: id, venue_id: id === SESSION ? VENUE : OTHER_VENUE }); }
function requireStaff(env, user, venueId) {
  if (user === HOST && venueId === VENUE) return Promise.resolve({ id: 'staff1', role: 'host' });
  return Promise.reject(httpError(403, 'Not authorised: you are not staff at this venue'));
}
function emitEvent() { EMITTED.push(arguments); return Promise.resolve(1); }
function roomPublish() { EMITTED.push(arguments); return Promise.resolve(); }
function json(obj, status) { return { status: status || 200, body: obj }; }
var ENV = { SUPABASE_JWT_SECRET: 'test-jwt-secret-for-pin' };

function call(fn, b) { BODY = b; return fn({}, ENV, json).then(function (r) { return r; }, function (e) { return { status: e.status || 500, body: { error: e.message } }; }); }

var steps = [];
function step(f) { steps.push(f); }

// ---------------------------------------------------------------- 1. the PIN rules
step(function () {
  reset();
  ok('the HMAC harness agrees with Python (RFC 4231 case 2)',
     SHA.hex(SHA.hmac('Jefe', 'what do ya want for nothing?')) === '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  ok('digits: four zeros pad a zero', winPinDigits([0, 0, 0, 0]) === '0000');
  ok('digits: a small number is padded to four', winPinDigits([0, 0, 0, 7]) === '0007', winPinDigits([0, 0, 0, 7]));
  ok('digits: the top bit is read unsigned (4294967295 -> 7295)', winPinDigits([255, 255, 255, 255]) === '7295', winPinDigits([255, 255, 255, 255]));
  ok('digits: 10,000 wraps to 0000', winPinDigits([0, 0, 0x27, 0x10]) === '0000');
  return winnerPin(ENV, 'game', GAME, 'one').then(function (p) {
    ok('a game PIN matches Python hmac-sha256 (8333)', p === '8333', p);
    ok('it was signed with HMAC SHA-256 under the Worker secret', SIGNED.length === 1 && SIGNED[0].key._k === ENV.SUPABASE_JWT_SECRET &&
       SIGNED[0].key.alg.name === 'HMAC' && SIGNED[0].key.alg.hash === 'SHA-256');
    ok('the message names the kind, the round and the prize', SIGNED[0].msg === 'vp-winner-pin|game|' + GAME + '|one', SIGNED[0].msg);
    return winnerPin(ENV, 'bingo', DRAW, 'one');
  }).then(function (p) {
    ok('a bingo PIN matches Python hmac-sha256 (5129)', p === '5129', p);
    return Promise.all([winnerPin(ENV, 'game', GAME, 'one'), winnerPin(ENV, 'game', GAME, 'one'), winnerPin(ENV, 'game', GAME, 'two'),
                        winnerPin(ENV, 'bingo', DRAW, 'full'), winnerPin(ENV, 'bingo', DRAW, 'c:abc'), winnerPin(ENV, 'bingo', DRAW, 'custom')]);
  }).then(function (a) {
    ok('the same prize always gives the same PIN', a[0] === a[1] && a[0] === '8333');
    ok('the NEXT prize in the same game gets a new PIN (one line 8333, two lines 3126)', a[2] === '3126' && a[2] !== a[0], a[2]);
    ok('bingo: the house after the line is a new PIN (5129 then 8443)', a[3] === '8443', a[3]);
    ok('a console custom pattern (c:...) is the claim record\'s "custom" (1292)', a[4] === '1292' && a[5] === '1292', a[4] + ' ' + a[5]);
    var ids = [], i;
    for (i = 0; i < 300; i++) ids.push('11111111-1111-4111-8111-' + ('000000000000' + i).slice(-12));
    return Promise.all(ids.map(function (id) { return winnerPin(ENV, 'game', id, 'one'); }));
  }).then(function (pins) {
    var seen = {}, distinct = 0, allFour = true, prevSame = 0;
    pins.forEach(function (p, i) { if (!seen[p]) { seen[p] = 1; distinct++; } if (!/^[0-9]{4}$/.test(p)) allFour = false; if (i && pins[i - 1] === p) prevSame++; });
    ok('every PIN is exactly 4 digits', allFour);
    ok('300 rounds give (nearly) 300 different PINs', distinct >= 290, distinct + ' distinct');
    ok('the next round never repeats the last one here', prevSame === 0, prevSame + ' repeats');
    return winnerPin({ SUPABASE_JWT_SECRET: 'another-secret' }, 'game', GAME, 'one');
  }).then(function (p) {
    ok('another secret gives another PIN (nobody without it can work one out)', p !== '8333', p);
    return winnerPin(ENV, 'game', GAME, 'raffle').then(function () { return 'made'; }, function (e) { return e.status; });
  }).then(function (s) {
    ok('a prize it does not know is refused, never folded into another', s === 400, String(s));
    return winnerPin(ENV, 'game', GAME).then(function () { return 'made'; }, function (e) { return e.status; });
  }).then(function (s) {
    ok('no prize named is refused', s === 400, String(s));
    return winnerPin({}, 'game', GAME, 'one').then(function () { return 'made'; }, function (e) { return e.status; });
  }).then(function (s) {
    ok('no secret: refused (503), never a guessable fallback', s === 503, String(s));
    return winnerPin(ENV, 'raffle', GAME, 'one').then(function () { return 'made'; }, function (e) { return e.status; });
  }).then(function (s) {
    ok('a kind of round it does not know is refused', s === 400, String(s));
    return winnerPin(ENV, 'game', 'not-a-uuid', 'one').then(function () { return 'made'; }, function (e) { return e.status; });
  }).then(function (s) {
    ok('a round id that is not a UUID is refused', s === 400, String(s));
  });
});

// ---------------------------------------------------------------- 2. who gets it
step(function () {
  reset();
  return call(handleHostWinnerPin, { game_id: GAME, stage: 'one' }).then(function (r) {
    ok('host route: staff at the venue get the game PIN for this prize', r.status === 200 && r.body.pin === '8333', JSON.stringify(r));
    return call(handleHostWinnerPin, { game_id: GAME, stage: 'two' });
  }).then(function (r) {
    ok('host route: the next prize shows its own PIN', r.status === 200 && r.body.pin === '3126', JSON.stringify(r));
    AUTH_USER = STRANGER;
    return call(handleHostWinnerPin, { game_id: GAME, stage: 'one' });
  }).then(function (r) {
    ok('host route: somebody who is not staff there is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    AUTH_USER = HOST;
    return call(handleHostWinnerPin, { draw_id: DRAW, stage: 'one' });
  }).then(function (r) {
    ok('host route: staff get the bingo draw PIN', r.status === 200 && r.body.pin === '5129', JSON.stringify(r));
    DB.vp_bingo_draws[0].venue_id = OTHER_VENUE;
    return call(handleHostWinnerPin, { draw_id: DRAW, stage: 'one' });
  }).then(function (r) {
    ok('host route: a draw at another venue is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    return call(handleHostWinnerPin, { stage: 'one' });
  }).then(function (r) {
    ok('host route: no round named is a 400', r.status === 400, JSON.stringify(r));
  });
});

step(function () {   // musical
  reset();
  return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'one' }).then(function (r) {
    ok('musical: a player with no claim is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_claims.push({ game_id: GAME, player_id: PLAYER, auto_verdict: 'invalid', status: 'rejected' });
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'one' });
  }).then(function (r) {
    ok('musical: a claim that did not check out is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_claims.push({ game_id: GAME, player_id: PLAYER2, auto_verdict: 'valid', status: 'confirmed' });
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'one' });
  }).then(function (r) {
    ok('musical: somebody ELSE winning does not give me the PIN', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_claims.push({ game_id: GAME, player_id: PLAYER, auto_verdict: 'valid', status: 'confirmed', winning_cells: [10, 11, 12, 13, 14] });
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'one' });
  }).then(function (r) {
    ok('musical: the winner gets the PIN, and it is the console\'s PIN', r.status === 200 && r.body.pin === '8333', JSON.stringify(r));
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'two' });
  }).then(function (r) {
    ok('musical: a line winner naming "two lines" is refused (the server\'s cells are one row)', r.status === 403 && !r.body.pin, JSON.stringify(r));
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'full' });
  }).then(function (r) {
    ok('musical: and naming "full house" is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_claims.push({ game_id: GAME, player_id: PLAYER, auto_verdict: 'valid', status: 'confirmed', winning_cells: [0, 1, 2, 3, 4, 20, 21, 22, 23, 24] });
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'two' });
  }).then(function (r) {
    ok('musical: winning two lines as well opens the two-lines PIN (3126)', r.status === 200 && r.body.pin === '3126', JSON.stringify(r));
    var shapes = [['one', [5, 6, 7, 8, 9], true], ['one', [4, 5, 6, 7, 8], false], ['one', [0, 4, 20, 24], false], ['two', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], true],
                  ['two', [0, 1, 2, 3, 4, 5, 6, 7, 8, 10], false], ['corners', [24, 0, 20, 4], true], ['corners', [0, 4, 20], false],
                  ['full', [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24], true], ['full', [10, 11, 12, 13, 14], false], ['one', null, false], ['one', [5, 5, 6, 7, 8], false]];
    var wrong = shapes.filter(function (t) { return winPinMusicCellsAre(t[0], t[1]) !== t[2]; });
    ok('musical: each prize is exactly its own shape of verified cells (11 cases)', wrong.length === 0, JSON.stringify(wrong));
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'final' });
  }).then(function (r) {
    ok('musical: trivia\'s "final" prize is never a musical PIN', r.status === 403 && !r.body.pin, JSON.stringify(r));
    PLAYER_ROW = { id: PLAYER, session_id: OTHER_SESSION };
    return call(handlePlayerWinnerPin, { game_id: GAME, stage: 'one' });
  }).then(function (r) {
    ok('a player from another session is refused before anything else', r.status === 403 && /not in this game/.test(r.body.error || ''), JSON.stringify(r));
  });
});

step(function () {   // trivia
  reset();
  DB.vp_games = [{ id: GAME2, session_id: SESSION, status: 'running', format: 'trivia', config: { question_count: 10 } }];
  DB.vp_trivia_games = [{ game_id: GAME2, current_seq: 7, phase: 'revealed' }];
  DB.v_vp_trivia_leaderboard = [
    { game_id: GAME2, player_id: 'p1', points: 900 }, { game_id: GAME2, player_id: PLAYER, points: 800 },
    { game_id: GAME2, player_id: 'p3', points: 700 }, { game_id: GAME2, player_id: 'p4', points: 600 },
    { game_id: GAME2, player_id: PLAYER2, points: 500 }];
  var pinFor;
  return winnerPin(ENV, 'game', GAME2, 'final').then(function (p) {
    pinFor = p;
    ok('trivia: the final prize PIN matches Python (0742)', p === '0742', p);
    DB.v_vp_trivia_leaderboard[0].points = 700;   // our team (800) leads
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: 1st place before the last question is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_trivia_games[0].current_seq = 10;
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: 1st place after the last reveal gets the PIN', r.status === 200 && r.body.pin === pinFor, JSON.stringify(r));
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'one' });
  }).then(function (r) {
    ok('trivia: asking for any prize but "final" is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.v_vp_trivia_leaderboard[0].points = 900;   // now 2nd
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: 2nd place gets NO PIN (Dean, 5 Nov 2026: 1st only)', r.status === 403 && !r.body.pin, JSON.stringify(r));
    PLAYER_ROW = { id: PLAYER2, session_id: SESSION };
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: 5th place is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    PLAYER_ROW = { id: PLAYER, session_id: SESSION, display_name: 'Quiz Wizards', kicked: false };
    DB.v_vp_trivia_leaderboard[1].points = 900;   // a tie for 1st
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: a tie for 1st shares the place and both get it', r.status === 200 && r.body.pin === pinFor, JSON.stringify(r));
    DB.v_vp_trivia_leaderboard.forEach(function (x) { x.points = 0; });   // nobody scored all night
    return call(handlePlayerWinnerPin, { game_id: GAME2, stage: 'final' });
  }).then(function (r) {
    ok('trivia: 0 points is no win, so no PIN (live play, 15 Nov 2026)', r.status === 403 && !r.body.pin, JSON.stringify(r));
  });
});

step(function () {   // bingo
  reset();
  return call(handlePlayerWinnerPin, { bingo: true, stage: 'one' }).then(function (r) {
    ok('bingo: no confirmed claim from this phone, refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_bingo_claims.push({ draw_id: DRAW, device_id: 'dev-one', pattern: 'one', status: 'pending' });
    DB.vp_bingo_claims.push({ draw_id: DRAW, device_id: 'dev-two', pattern: 'one', status: 'confirmed' });
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'one' });
  }).then(function (r) {
    ok('bingo: my claim still with the host, or somebody else\'s win, is refused', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_bingo_claims[0].status = 'confirmed';
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'one' });
  }).then(function (r) {
    ok('bingo: a confirmed win gets the draw PIN, the same as the console', r.status === 200 && r.body.pin === '5129', JSON.stringify(r));
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'full' });
  }).then(function (r) {
    ok('bingo: the line\'s winner does not get the house\'s PIN', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_bingo_claims.push({ draw_id: DRAW, device_id: 'dev-one', pattern: 'full', status: 'confirmed' });
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'full' });
  }).then(function (r) {
    ok('bingo: winning the house too gets the house\'s own PIN (8443)', r.status === 200 && r.body.pin === '8443', JSON.stringify(r));
    DB.vp_bingo_draws.push({ id: '66666666-6666-4666-8666-666666666666', venue_id: VENUE, session_id: SESSION, created_at: '2026-11-08T09:30:00Z' });
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'one' });
  }).then(function (r) {
    ok('bingo: once the next game opens, last game\'s win does not get the new PIN', r.status === 403 && !r.body.pin, JSON.stringify(r));
    DB.vp_bingo_draws = [{ id: DRAW, venue_id: VENUE, session_id: OTHER_SESSION, created_at: '2026-11-08T09:00:00Z' }];
    return call(handlePlayerWinnerPin, { bingo: true, stage: 'one' });
  }).then(function (r) {
    ok('bingo: a draw in another session is never found', r.status === 404 && !r.body.pin, JSON.stringify(r));
    return call(handlePlayerWinnerPin, { draw_id: DRAW, stage: 'one' });
  }).then(function (r) {
    ok('bingo: a phone cannot name a draw id itself', r.status === 400 && !r.body.pin, JSON.stringify(r));
    ok('no route ever emitted an event or published to the room', EMITTED.length === 0, EMITTED.length + ' sends');
  });
});

// ---------------------------------------------------------------- 3. NOT in the TV payload
step(function () {
  var SENDS = /\b(emitEvent|roomPublish|broadcast|sbRpc)\s*\(/;
  ['winPinStage', 'winnerPin', 'winPinRoundOf', 'winPinPlayerWon', 'handleHostWinnerPin', 'handlePlayerWinnerPin'].forEach(function (n) {
    ok('Worker ' + n + ' never sends anything to a screen', !SENDS.test(body(n)));
  });
  // Only the two PIN routes call winnerPin: no event, snapshot or TV route can carry it.
  var callers = (src.match(/[^\n]*\bwinnerPin\(env[^\n]*/g) || []).filter(function (l) { return !/^async function winnerPin/.test(l); });
  ok('winnerPin is called by the two routes only', callers.length === 2 && callers.every(function (l) { return /return json\(\{ pin: await winnerPin\(env, round\.kind, round\.id, round\.stage\)/.test(l); }), callers.join(' | '));

  var helper = read('venueplay/app/vp-winpin.js');
  var code = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('vp-winpin.js never sends: no send, broadcast, postMessage or channel', !/\.send\s*\(|\bsend\s*\(|broadcast|postMessage|\.channel\s*\(|VPRoom|VPChannel/.test(code));
  ok('vp-winpin.js only calls the two PIN routes', (code.match(/"\/(player|host)\/[a-z-]+"/g) || []).join(',') === '"/player/winner-pin","/host/winner-pin"',
     (code.match(/"\/(player|host)\/[a-z-]+"/g) || []).join(','));

  // Consoles and phones: no line that sends a message names the PIN.
  var pages = ['venueplay/app/index.html', 'venueplay/app/musical/host.html', 'venueplay/app/trivia/host.html',
               'venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html'];
  var SENDLINE = /\b(send|bcast|wallSend|wireOut|tvSend|to)\s*\(\s*\{/;
  var PINWORD = /\bpin\b|\.pin\b|roundPin|winpin|VPWinPin|winner-pin/i;
  pages.forEach(function (p) {
    var s = read(p), bad = s.split('\n').filter(function (l) { return SENDLINE.test(l) && PINWORD.test(l); });
    ok(p + ' loads vp-winpin.js', s.indexOf('<script src="/app/vp-winpin.js"></script>') >= 0);
    ok(p + ' never puts the PIN in a message', bad.length === 0, bad.join(' | ').slice(0, 200));
  });
  // Dean, 5 Nov 2026: trivia's phone asks for the PIN at 1st place only, and every PIN asked names its prize.
  function fnIn(text, name) {
    var i = text.indexOf('function ' + name + '('); if (i < 0) return '';
    var d = 0, k = text.indexOf('{', i);
    for (; k < text.length; k++) { if (text[k] === '{') d++; else if (text[k] === '}') { d--; if (!d) break; } }
    return text.slice(i, k + 1);
  }
  var tp = fnIn(read('venueplay/app/trivia/play.html'), 'paintPin');
  ok('trivia phone: only 1st place asks for the PIN; 2nd and 3rd are painted empty', /if\(r!==1 \|\|/.test(tp) && /VPWinPin\.paint\(el, "", ""\); return;/.test(tp), tp.slice(0, 160));
  ok('trivia phone: it asks for the "final" prize', /stage:"final"/.test(tp));
  ok('bingo phone: it asks for the prize it won (stage), and only with one', /function askPin\(stage\)/.test(read('venueplay/play.html')) &&
     /!stage \|\|/.test(fnIn(read('venueplay/play.html'), 'askPin')) && /stage:String\(stage\)/.test(fnIn(read('venueplay/play.html'), 'askPin')));
  ok('bingo phone: a final win remembers its pattern, so a reload asks for the same prize', /P\.wonPattern=m\.pattern/.test(read('venueplay/play.html')) && /pattern:P\.wonPattern/.test(read('venueplay/play.html')));
  ok('musical phone: it asks for the pattern it won', /stage:st/.test(fnIn(read('venueplay/app/musical/play.html'), 'askPin')) && /st=P\.pattern/.test(fnIn(read('venueplay/app/musical/play.html'), 'askPin')));
  [['venueplay/app/index.html', /st=G\.pattern/], ['venueplay/app/musical/host.html', /st=G\.pattern/], ['venueplay/app/trivia/host.html', /st="final"/]].forEach(function (c) {
    var f = fnIn(read(c[0]), 'showRoundPin');
    ok(c[0] + ' shows the PIN for the prize being played now, and a new one when it changes', c[1].test(f) && /stage:st/.test(f) && /key=/.test(f) && /data-for", key/.test(f), f.slice(0, 160));
  });
  // The message objects themselves: the winner messages the consoles send carry no pin field.
  ['venueplay/app/index.html', 'venueplay/app/musical/host.html', 'venueplay/app/trivia/host.html'].forEach(function (p) {
    var s = read(p), msgs = s.match(/\{\s*t\s*:\s*"(winner|podium|claim_pending|leaderboard)"[^}]*\}/g) || [];
    ok(p + ' winner/podium messages carry no pin (' + msgs.length + ' seen)', msgs.length > 0 && msgs.every(function (m) { return !/\bpin\b/i.test(m); }));
  });
  // No TV page loads the helper or names the route.
  var tvs = ['venueplay/tv.html', 'venueplay/app/musical/screen.html', 'venueplay/app/trivia/screen.html',
             'venueplay/app/raffle/screen.html', 'venueplay/app/members/screen.html',
             'venueplay/app/vp-endshow.js', 'venueplay/app/vp-screen-router.js',
             // the shared TV pieces that landed after 5 Nov (the new look, the finale, the TV app)
             'venueplay/app/vp-tvgame.js', 'venueplay/app/vp-trivia-finale.js', 'venueplay/app/vp-tvclaim.js',
             'venueplay/app/vp-tvapp.js', 'venueplay/app/vp-tvhold.js'];
  tvs.forEach(function (p) {
    var s = read(p);
    ok(p + ' (a TV) never loads the PIN or asks for it', !/vp-winpin|VPWinPin|winner-pin|Round PIN/.test(s));
  });
});

var chain = Promise.resolve();
steps.forEach(function (s) { chain = chain.then(s).catch(function (e) { ok('step threw', false, String(e && e.stack || e)); }); });
chain.then(function () {
  print((fail ? 'FAILED: ' : '') + pass + ' of ' + (pass + fail) + ' checks passed');
});
