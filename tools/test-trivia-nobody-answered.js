/* NOBODY ANSWERED, AND EVERY PHONE SAID "1st of 1" (live trivia test, 17 Oct 2026).

   Three players in the room, nobody tapped an answer, and at the reveal every phone read
   "1st of 1". The phone takes the "of N" from /player/score, and the Worker counted the
   leaderboard view, which only holds players who have answered something. With nobody on it,
   each phone counted only itself.

   This RUNS it end to end: the REAL handlePlayerScore out of the shipped game Worker (on the
   rig's fake PostgREST) answers the REAL showResult lifted out of venueplay/app/trivia/play.html,
   and what is asserted is the text the phone paints in its place line.

   Run from the repo root:  jsc tools/test-trivia-nobody-answered.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };      // the rig's digest is all zeros, so every token would be one player
var finished = false;

var PLAY = readFile('venueplay/app/trivia/play.html');
function lift(text, name) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in play.html - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var PHONE_SRC = ['ordinal', 'rankText', 'showResult'].map(function (n) { return lift(PLAY, n); }).join('\n');

var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function pid(i) { return 'dddddddd-dddd-4ddd-8ddd-' + ('000000000000' + i).slice(-12); }
var STAMP = '2026-10-17T09:00:00Z';
function reset() {
  DB.vp_games = [{ id: GAME, session_id: SESSION, format: 'trivia', status: 'running', config: {} }];
  DB.vp_players = [];
  DB.v_vp_trivia_leaderboard = [];
  DB.vp_trivia_answers = [];
  for (var i = 0; i < 3; i++) DB.vp_players.push({ id: pid(i), session_id: SESSION, token_hash: 'h-tok' + i, display_name: 'Team ' + i, kicked: false, played_at: STAMP });
  globalThis.__vpScoreCache = new Map();
}

/* One phone, built from the page's own functions. Every DOM element it touches is made on first ask. */
function makePhone(tok) {
  var els = {};
  function $(id) {
    if (els[id]) return els[id];
    var cls = {};
    return (els[id] = { id: id, textContent: '', innerHTML: '', style: {},
      classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; },
                   toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = 1; else delete cls[c]; } } });
  }
  var P = { token: tok, gameId: GAME, room: 'r', total: 0, rank: 0, playersCount: 0, choice: null, q: { qseq: 1, options: ['A', 'B', 'C', 'D'] } };
  var VIEWS = ['vRes', 'vQ', 'vWait'];
  function show(which) { for (var i = 0; i < VIEWS.length; i++) $(VIEWS[i]).classList.toggle('hidden', VIEWS[i] !== which); }
  function stopCd() {}
  function esc(s) { return String(s == null ? '' : s); }
  var LETTERS = ['A', 'B', 'C', 'D'];
  function setTimeout(f) { f(); return 0; }                              // the phone's stagger, run now
  function rejoinNow() { return Promise.resolve(); }
  function playerGet(path) {
    return handlePlayerScore({ url: 'https://w' + path, headers: { get: function (k) { return k === 'X-Player-Token' ? P.token : ''; } } }, ENV, json)
      .then(function (r) { if (r.status !== 200) { var e = new Error('status ' + r.status); e.status = r.status; throw e; } return r.body; });
  }
  eval(PHONE_SRC);
  return { P: P, $: $, reveal: function (m) { showResult(m); },
           placeLine: function () { var el = $('pResRank'); return el.classList.contains('hidden') ? '(hidden)' : el.textContent; } };
}
async function flush() { for (var i = 0; i < 40; i++) await null; }
function reveal(qseq) { return { t: 'reveal', qseq: qseq, correctIndex: 1, options: ['Melbourne', 'Sydney', 'Brisbane', 'Perth'] }; }

(async function () {
  print('three teams, nobody answers the first question');
  reset();
  var phones = [0, 1, 2].map(function (i) { return makePhone('tok' + i); });
  LOG.length = 0;
  for (var n = 0; n < phones.length; n++) { phones[n].reveal(reveal(1)); await flush(); }   // the phones stagger themselves, so they land one after another
  var lines = phones.map(function (ph) { return ph.placeLine(); });
  show('every phone reads "1st of 3", never "1st of 1"', lines.every(function (t) { return t === '1st of 3'; }), JSON.stringify(lines));
  show('and says "No answer" with a total of 0', phones.every(function (ph) { return ph.$('pResTag').textContent === 'No answer' && String(ph.$('pResTot').textContent) === '0'; }),
       JSON.stringify(phones.map(function (ph) { return [ph.$('pResTag').textContent, ph.$('pResTot').textContent]; })));
  var heads = LOG.filter(function (l) { return l.indexOf('HEAD vp_players') === 0; }).length;
  show('the room is counted ONCE for the reveal, not once per phone', heads === 1, heads + ' counts');

  print('Team 0 scores on question 2; then nobody answers question 3');
  DB.v_vp_trivia_leaderboard.push({ game_id: GAME, player_id: pid(0), points: 130 });
  phones = [0, 1, 2].map(function (i) { var ph = makePhone('tok' + i); ph.P.q = { qseq: 3, options: ['A', 'B', 'C', 'D'] }; return ph; });
  phones.forEach(function (ph) { ph.reveal(reveal(3)); });
  await flush();
  lines = phones.map(function (ph) { return ph.placeLine(); });
  show('a team that did not answer keeps its standing: Team 0 "1st of 3", the others "2nd of 3"',
       lines[0] === '1st of 3' && lines[1] === '2nd of 3' && lines[2] === '2nd of 3', JSON.stringify(lines));
  show('and Team 0 keeps its 130', String(phones[0].$('pResTot').textContent) === '130', String(phones[0].$('pResTot').textContent));

  print('who is in the field');
  reset();
  DB.vp_players.push({ id: pid(7), session_id: SESSION, token_hash: 'h-tok7', display_name: 'Removed', kicked: true, played_at: STAMP });
  DB.vp_players.push({ id: pid(8), session_id: OTHER, token_hash: 'h-tok8', display_name: 'Next door', kicked: false, played_at: STAMP });
  DB.vp_players.push({ id: pid(9), session_id: SESSION, token_hash: 'h-tok9', display_name: 'Only loaded the page', kicked: false, played_at: null });
  var ph = makePhone('tok1'); ph.reveal(reveal(1)); await flush();
  show('a removed team, a phone at another venue and a phone that never held a question are not counted', ph.placeLine() === '1st of 3', ph.placeLine());

  reset();
  DB.vp_players.forEach(function (p) { p.played_at = null; });           // phones that never said they were alive
  [0, 1, 2, 3].forEach(function (i) { DB.v_vp_trivia_leaderboard.push({ game_id: GAME, player_id: pid(i), points: 400 - i * 100 }); });
  ph = makePhone('tok2'); ph.reveal(reveal(4)); await flush();
  show('the room count can only raise the field, never shrink it below the board', ph.placeLine() === '3rd of 4', ph.placeLine());

  reset();
  var _fetch = fetch;
  fetch = async function (u, o) { if (o && o.method === 'HEAD') return { ok: false, status: 500, headers: { get: function () { return null; } }, text: async function () { return ''; } }; return _fetch(u, o); };
  DB.v_vp_trivia_leaderboard.push({ game_id: GAME, player_id: pid(0), points: 130 }, { game_id: GAME, player_id: pid(1), points: 0 });
  ph = makePhone('tok1'); ph.reveal(reveal(2)); await flush();
  fetch = _fetch;
  show('if the count cannot be read the phone still gets its place from the board', ph.placeLine() === '2nd of 2', ph.placeLine());
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('nobody answered: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
