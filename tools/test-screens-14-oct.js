/* THE TV AND MUSICAL FAULTS FOUND BY PLAYING, 14 OCT 2026. Each is RUN from the shipped file.

     1. after End game the TV bounced back to a dead musical join screen: "volume" counted as a game
     2. a musical (or trivia) "started" on the shared channel read as BINGO and dropped the TV to ads
     3. the TV's "played so far" strip showed the song still hidden behind "Know it?"
     4. Check card turned a typo into card 1 and added a billable player
     5. a slide whose picture will not load painted a near-black wall for its whole turn

   Run: jsc tools/test-screens-14-oct.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 2000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var TV = find('venueplay/tv.html');
var ROUTER = find('venueplay/app/vp-screen-router.js');
var MSCREEN = find('venueplay/app/musical/screen.html');
var MHOST = find('venueplay/app/musical/host.html');
var THOST = find('venueplay/app/trivia/host.html');

print('\n== 1. a volume setting is not a game on air ==');
(function () {
  var m = /var NOT_ON_AIR = \{[\s\S]*?\};/.exec(TV);
  ok('tv.html still has its NOT_ON_AIR list', !!m);
  var NOT_ON_AIR = m ? (new Function(m[0] + ' return NOT_ON_AIR;'))() : {};
  ok('"volume" is on it', NOT_ON_AIR.volume === 1);
  ok('a real game message is not', !NOT_ON_AIR.ball && !NOT_ON_AIR.played && !NOT_ON_AIR.question);
  /* INBOX 426 item 3 (16 Nov 2026): a trivia console opened on a TV that is on the ads sent its saved sound and buzzer switches, which counted as
     a game on air and put SCAN TO PLAY on the wall before the host opened the lobby. A setting is not a game. */
  ok('"sounds" (the trivia console opening) is on it', NOT_ON_AIR.sounds === 1);
  ok('"buzzer" (the trivia console opening, or answering a TV hello) is on it', NOT_ON_AIR.buzzer === 1);
  ok('CONTROL: "started" and "question" still put a game on air', !NOT_ON_AIR.started && !NOT_ON_AIR.question);
})();

print('\n== 2. another game\'s traffic on the shared channel is not bingo ==');
(function () {
  // Run the router's real handle() line by line: lift the two lines that decide.
  var i = ROUTER.indexOf('if (m.t === "mode") { goTo(');
  var j = ROUTER.indexOf('if (game === "bingo" ? BINGO_ON_AIR[m.t] : onAir(m)) goTo(game);', i);
  ok('the router still decides in one place', i > 0 && j > i);
  var body = ROUTER.slice(i, j) + 'if (game === "bingo" ? BINGO_ON_AIR[m.t] : onAir(m)) goTo(game);';
  var went = [];
  var handle = new Function('m', 'game', 'goTo', 'URLS', 'BINGO_ON_AIR', 'onAir', body);
  var BINGO_ON_AIR = { ball: 1, started: 1, claim_pending: 1, winner: 1 };
  function goTo(g) { went.push(g); }
  handle({ t: 'started', fmt: 'musical', game_id: 'g' }, 'bingo', goTo, {}, BINGO_ON_AIR, function () { return true; });
  ok('a musical "started" does not send the TV to bingo', went.length === 0, went.join(','));
  handle({ t: 'winner', fmt: 'trivia' }, 'bingo', goTo, {}, BINGO_ON_AIR, function () { return true; });
  ok('a tagged trivia "winner" does not either', went.length === 0, went.join(','));
  handle({ t: 'started', pattern: 'one_line' }, 'bingo', goTo, {}, BINGO_ON_AIR, function () { return true; });
  ok('bingo\'s own "started" still does', went.join(',') === 'bingo');
  // The consoles tag what they send on the players' channel.
  [['musical', MHOST], ['trivia', THOST]].forEach(function (c) {
    var sent = [];
    var VPSign = null, window = {};
    function rawGsend(o) { sent.push(o); }
    eval(lift(c[1], 'gsend', c[0] + ' host'));
    var orig = { t: 'started', game_id: 'x' };
    gsend(orig);
    ok(c[0] + ' console tags its players-channel traffic', sent[0] && sent[0].fmt === c[0], JSON.stringify(sent[0]));
    ok(c[0] + ' console does not change the object the TV copy is sent from', orig.fmt === undefined);
  });
})();

print('\n== 3. the hidden song is not on the strip until it is revealed ==');
(function () {
  var nodes = [], lbl = { classList: { toggle: function () {} }, textContent: '' };
  var board = { set innerHTML(v) { nodes = []; }, appendChild: function (d) { nodes.push(d.textContent); } };
  var document = { createElement: function () { return { className: '', textContent: '' }; } };
  function $(id) { return id === 'tvBoard' ? board : lbl; }
  var TV_BOARD_MAX = 12;
  var state = { played: ['Song A', 'Song B', 'Mystery'] };
  var _pendingSong = { title: 'Mystery' };
  eval(lift(MSCREEN, 'renderBoard', 'musical/screen.html'));
  renderBoard();
  ok('while hidden, the strip stops at the song before', nodes.join('|') === 'Song A|Song B', nodes.join('|'));
  _pendingSong = null; renderBoard();
  ok('once revealed, it is on the strip', nodes.join('|') === 'Song A|Song B|Mystery', nodes.join('|'));
})();

print('\n== 4. Check card takes a card number and nothing else ==');
(function () {
  var asked = [], result = { textContent: '' }, input = { value: '' };
  function $(id) { return id === 'paperNo' ? input : result; }
  var G = { gameId: 'g', status: 'running', claims: [], pattern: 'one_line' };
  function apiPost(path, body) { asked.push(body.card_no); return { then: function () { return { catch: function () {} }; } }; }
  eval(lift(MHOST, 'checkPaperCard', 'musical/host.html'));
  [['-1<script>', null], ['1x', null], ['12', 12], ['P12', 12], ['#7', 7], [' 3 ', 3]].forEach(function (c) {
    asked = []; input.value = c[0]; checkPaperCard();
    var got = asked.length ? asked[0] : null;
    ok('"' + c[0] + '" ' + (c[1] === null ? 'is refused' : 'checks card ' + c[1]), got === c[1], 'checked ' + got);
  });
})();

print('\n== 5. a slide whose picture fails is dropped from the rotation ==');
(function () {
  var rebuilt = 0, made = [];
  function buildAds() { rebuilt++; }
  function setTimeout() {}
  function Image() { made.push(this); }
  var BAD_IMG = {}, _probed = {}, IMG_RETRY_MS = 600000, IMG_SECOND_TRY_MS = 4000, imgErrors = 0, tvMode = 'ads', started = 0;
  function startAds() { started++; }
  eval(lift(TV, 'probeImg', 'tv.html'));
  probeImg('https://x/missing.png'); probeImg('https://x/missing.png');
  ok('each picture is loaded once', made.length === 1 && made[0].src === 'https://x/missing.png');
  made[0].onerror();
  ok('a failed picture is marked bad and the slides rebuilt', BAD_IMG['https://x/missing.png'] === 1 && rebuilt === 1);
  ok('and the rotation is started again, so a slide is lit, not the floor (live fault, 2 Nov 2026)', started === 1, 'startAds ran ' + started + ' times');
  ok('the slide list leaves a bad picture out', /slideVisible\(s\) && !\(s\.image_url && BAD_IMG\[String\(s\.image_url\)\]\)/.test(TV));
  ok('an image slide asks for its picture to be checked', /probeImg\(u\);\s*return '<div class="adimg"/.test(TV));
})();

print('\n== 5b. a picture that failed once is tried again in four seconds, and every minute while ALL are out (INBOX 292.3) ==');
(function () {
  var rebuilt = 0, made = [], timers = [];
  function buildAds() { rebuilt++; }
  function setTimeout(f, ms) { timers.push({ f: f, ms: ms }); }
  function Image() { made.push(this); }
  var Date = { now: function () { return 1234; } };
  var BAD_IMG = {}, _probed = {}, IMG_RETRY_MS = 600000, tvMode = 'ads', started = 0;
  var ADS = { slides: [{ image_url: 'https://x/a.png' }, { image_url: 'https://x/b.png' }] };
  function startAds() { started++; }
  var window = {};
  eval(lift(TV, 'probeImg', 'tv.html')); eval(lift(TV, 'imgRetry', 'tv.html'));
  eval(lift(TV, 'imgFresh', 'tv.html')); eval(lift(TV, 'allPicturesOut', 'tv.html'));
  var IMG_SECOND_TRY_MS = 4000, IMG_ALL_OUT_RETRY_MS = 60000, imgErrors = 0;
  ok('CONTROL: the numbers in tv.html are four seconds and one minute', /var IMG_SECOND_TRY_MS=4000, IMG_ALL_OUT_RETRY_MS=60000, imgErrors=0;/.test(TV));
  probeImg('https://x/a.png'); made[0].onerror();
  ok('a failed picture leaves the loop at once (never a black slide on the wall)', BAD_IMG['https://x/a.png'] === 1 && rebuilt === 1);
  ok('and is tried again four seconds later, not ten minutes', timers.length === 1 && timers[0].ms === 4000, JSON.stringify(timers.map(function (x) { return x.ms; })));
  timers[0].f();
  ok('the try again is a fresh request', made.length === 2 && made[1].src === 'https://x/a.png?vpr=1234', made[1] && made[1].src);
  made[1].onload();
  ok('and it loads: back in the loop, the slides rebuilt and lit', !BAD_IMG['https://x/a.png'] && rebuilt === 2 && started === 2);
  timers = [];
  probeImg('https://x/b.png'); made[2].onerror(); timers[0].f(); made[3].onerror();
  ok('one picture still out while the other plays: tried again in ten minutes', timers.length === 2 && timers[1].ms === 600000, JSON.stringify(timers.map(function (x) { return x.ms; })));
  BAD_IMG['https://x/a.png'] = 1; timers = [];
  made[3].onerror();
  ok('EVERY picture out (a wall of plain words): tried again every minute', timers.length === 1 && timers[0].ms === 60000, JSON.stringify(timers.map(function (x) { return x.ms; })));
})();

print('\n== 6. an idle bingo lobby gives the wall up to a game actually being played ==');
(function () {
  var i = TV.indexOf('var idleBingo = ');
  ok('the TV decides it in one place', i > 0);
  var body = TV.slice(i, TV.indexOf('onGameMode(game, true);', i) + 'onGameMode(game, true);'.length);
  var calls = [];
  function onGameMode(g, force) { calls.push(g + (force ? '!' : '')); }
  function onAir(m) { return m.t !== 'state' && m.t !== 'host_here'; }
  /* 12 Nov 2026 (INBOX 282.8): a finished bingo win yields like an idle lobby (bingoFinished), a Draw's claim takes a
     win that is up (bingoWinUp), and the host's force goes straight in (enterEmbed). Off here unless a check says. */
  var finished = false;
  function bingoFinished() { return finished; }
  function bingoWinUp() { return false; }
  function enterEmbed(g) { calls.push(g + '=>'); }
  var f0 = new Function('m', 'game', 'tvMode', 'state', 'onAir', 'onGameMode', 'bingoFinished', 'bingoWinUp', 'enterEmbed', body);
  var f = function (m, game, tvMode, state, onAir, onGameMode) { return f0(m, game, tvMode, state, onAir, onGameMode, bingoFinished, bingoWinUp, enterEmbed); };
  f({ t: 'question' }, 'trivia', 'bingo', { phase: 'lobby', called: [] }, onAir, onGameMode);
  ok('a trivia question takes the wall off an empty bingo lobby', calls.join() === 'trivia!', calls.join());
  calls = [];
  f({ t: 'question' }, 'trivia', 'bingo', { phase: 'running', called: [5, 12] }, onAir, onGameMode);
  ok('but never off a bingo game with balls called', calls.length === 0, calls.join());
  f({ t: 'state', active: false }, 'trivia', 'bingo', { phase: 'lobby', called: [] }, onAir, onGameMode);
  ok('and another game merely saying where it stands does not', calls.length === 0, calls.join());
  finished = true; calls = [];
  f({ t: 'drawing' }, 'raffle', 'bingo', { phase: 'win', called: [5, 12] }, onAir, onGameMode);
  ok('a raffle drawing takes the wall off a FINISHED bingo winner (12 Nov 2026, FINDINGS R3/R7)', calls.join() === 'raffle!', calls.join());
})();

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
