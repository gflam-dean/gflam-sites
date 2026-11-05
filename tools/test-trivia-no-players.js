/* TRIVIA WITH NOBODY JOINED (live fault, Fri 6 Nov 2026, The Mini Bar).

   Dean ran trivia with no phones joined and tapped Reveal leaderboard. The console said "Scores
   could not be loaded ... Check your connection", which was wrong: the connection was fine and
   there were simply no players. This RUNS the real finish(), finishNow(), finishOutcome() and
   reveal() lifted out of venueplay/app/trivia/host.html, with the server and the channel faked, and
   asserts what the host sees and what the TV is sent:
     - nobody joined, server answered with an empty board: the plain "Nobody has joined" line, a
       "nobody" message for the TV, no error bar, no podium;
     - phones present but the fetch failed: the real "could not be loaded" error, and no "nobody";
     - the between-question auto leaderboard with nobody joined: the same calm message, not an
       empty board; with players it is still the ordinary leaderboard.

   Run from the repo root:  jsc tools/test-trivia-no-players.js
*/
var HOST = readFile('venueplay/app/trivia/host.html');
function lift(name) {
  var i = HOST.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in host.html - a test that cannot find its subject cannot fail');
  var d = 0, k = HOST.indexOf('{', i);
  do { if (HOST[k] === '{') d++; else if (HOST[k] === '}') d--; k++; } while (d > 0 && k < HOST.length);
  return HOST.slice(i, k) + '\n';
}
var NOBODY_LINE = (HOST.match(/var NOBODY_MSG="([^"]+)"/) || [])[1];
var SRC = ['finishOutcome', 'finish', 'finishNow', 'reveal'].map(lift).join('\n');

var ran = 0, bad = 0;
function show(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }

/* One console: the page's own functions over a fake game state, server and channel. */
function makeConsole(o) {
  var G = { board: o.board || [], gameId: 'g1', status: 'reveal', noPlayersNote: false, qtotal: 10, split: [], defer: false,
            current: { qseq: o.qseq || 10, qi: o.qseq || 10, options: ['a', 'b', 'c', 'd'] } };
  var sent = [], errors = [], timers = [], renders = 0;
  var players = o.players | 0;
  function playerCount() { return players; }
  function clearTick() {}
  function clearErrForAction() {}
  function saveTrivia() {}
  function isDouble() { return false; }
  function renderConsole() { renders++; }
  function hostError(m) { errors.push(m); }
  function bcast(m) { sent.push(m); }
  function setTimeout(f, ms) { timers.push(f); return timers.length; }
  function apiPost(path) {
    if (o.fetchFails) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve({ leaderboard: o.fetchBoard || [], correct_index: 1, qseq: G.current.qseq, split: [] });
  }
  eval(SRC);
  return { G: G, sent: sent, errors: errors, timers: timers, finish: finish, reveal: reveal, renders: function () { return renders; },
           types: function () { return sent.map(function (m) { return m.t; }).join(','); }, setPlayers: function (n) { players = n; } };
}
async function flush() { for (var i = 0; i < 40; i++) await null; }

(async function () {
  print('the host decision');
  var C = makeConsole({});
  var fo = (function () { return eval(lift('finishOutcome') + ';finishOutcome'); })();
  show('a board with rows is the podium', fo(3, 4, true) === 'podium');
  show('an empty board, nobody joined, the server answered: nobody', fo(0, 0, true) === 'nobody');
  show('an empty board, nobody joined, but the fetch failed: the real error', fo(0, 0, false) === 'error');
  show('an empty board, players present, fetch failed: the real error', fo(0, 5, false) === 'error');
  show('an empty board, players present, server answered empty: not "nobody"', fo(0, 5, true) === 'error');

  print('Reveal leaderboard with nobody joined (the Mini Bar fault)');
  C = makeConsole({ players: 0, board: [], fetchBoard: [] });
  C.finish(); await flush();
  show('the host gets the plain line, word for word',
       NOBODY_LINE === 'Nobody has joined this game yet, so there are no scores to show. Players join with the code on the TV.', NOBODY_LINE);
  show('and the console is told to show it', C.G.noPlayersNote === true);
  show('no error bar at all', C.errors.length === 0, JSON.stringify(C.errors));
  show('the TV is sent "nobody", not a podium or a board', C.types() === 'nobody', C.types());
  show('the night is not ended, so the button stays for a late joiner', C.G.status === 'reveal', C.G.status);
  show('the console repainted', C.renders() >= 1);

  print('no game id, so nothing proves the board is really empty');
  C = makeConsole({ players: 0, board: [], gameId: '' }); C.G.gameId = '';
  C.finish(); await flush();
  show('no game id and no fetch: nothing proves the board is really empty, so it is the real error, not "nobody"',
       C.errors.length === 1 && /could not be loaded/.test(C.errors[0]) && C.types() === '', C.errors.join('|') + ' / ' + C.types());

  print('a real fetch failure with players present');
  C = makeConsole({ players: 4, board: [], fetchFails: true });
  C.finish(); await flush();
  show('the real "could not be loaded" message', C.errors.length === 1 && /^Scores could not be loaded, so the podium was not put on the screen\./.test(C.errors[0]), C.errors.join('|'));
  show('nothing calm goes to the TV and no podium either', C.types() === '', C.types());
  show('no "nobody joined" line', C.G.noPlayersNote === false);
  show('the night is not ended', C.G.status === 'reveal');

  print('players present, scores come back on the retry');
  C = makeConsole({ players: 4, board: [], fetchBoard: [{ name: 'A', points: 300 }, { name: 'B', points: 200 }, { name: 'C', points: 100 }] });
  C.finish(); await flush();
  show('the podium and the final scores go out', C.types() === 'podium,leaderboard', C.types());
  show('the night ends and there is no error', C.G.status === 'ended' && C.errors.length === 0);

  print('the host taps again after someone joins');
  C = makeConsole({ players: 0, board: [], fetchBoard: [] });
  C.finish(); await flush();
  C.setPlayers(2);
  show('the first tap left the calm line up', C.G.noPlayersNote === true);
  C.finish(); await flush();
  show('the next tap clears the line, and with phones in but no scores it is the real error, not "nobody"',
       C.G.noPlayersNote === false && C.errors.length === 1 && /could not be loaded/.test(C.errors[0]), C.errors.join('|'));

  print('the between-question auto leaderboard');
  C = makeConsole({ players: 0, qseq: 3, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  show('reveal went to the TV first', C.types() === 'reveal', C.types());
  C.timers.forEach(function (f) { f(); });
  show('with nobody joined the 5 second follow-up is the calm state, not an empty board', C.types() === 'reveal,nobody', C.types());

  C = makeConsole({ players: 3, qseq: 3, fetchBoard: [{ name: 'A', points: 100 }] });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.forEach(function (f) { f(); });
  show('with players it is the ordinary leaderboard, unchanged', C.types() === 'reveal,leaderboard' && C.sent[1].title === 'Leaderboard' && C.sent[1].rows.length === 1, C.types());
  C = makeConsole({ players: 3, qseq: 3, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.forEach(function (f) { f(); });
  show('players present but nobody has scored yet: still the ordinary leaderboard path', C.types() === 'reveal,leaderboard', C.types());
  C = makeConsole({ players: 0, qseq: 10, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  show('after the last question nothing is scheduled: the host reveals by hand', C.timers.length === 0, C.timers.length + ' timers');

  print('the TV listens for it');
  var SCREEN = readFile('venueplay/app/trivia/screen.html');
  show('"nobody" is a host message the TV recognises', /HOST_TYPES=\{[^}]*\bnobody:1/.test(SCREEN));
  show('the TV paints "Thanks for playing" for it', /m\.t==="nobody"[\s\S]{0,400}Thanks for playing/.test(SCREEN));
  show('and it never paints an error word on the wall for it', !/m\.t==="nobody"[\s\S]{0,700}(could not|error|failed)/i.test(SCREEN));
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (bad) throw new Error('no players: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
