/* PUNTERS RECKON: the referee scores guesses fairly and never lets an answer out early.
   Runs the real pr-game.js with the real matcher and boards. Run: jsc tools/test-pr-game.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
var window = { crypto: { getRandomValues: function(a){ a[0] = 7; return a; } } };
['ta-match.js', 'ta-boards.js', 'pr-game.js'].forEach(function(f){ (new Function('window', readFile('venueplay/app/topanswers/' + f)))(window); });
var clock = 1000000;
var board = window.TABoards.filter(function(b){ return b.id === 'pubfood'; })[0];
var g = new window.PRGame.Game({ now: function(){ return clock; }, pick: function(){ return 0; }, boards: [board, window.TABoards[0]] });
var pub = g.nextBoard(45);
ok('the public board message has the question and a count', pub.q === board.q && pub.n === board.answers.length && pub.round === 1);
ok('and NOT one answer (every phone hears it)', !/Parmi|Schnitzel|parma/i.test(JSON.stringify(pub)));
var r = g.guess('p1', 'Sam', 'chicken parma');
ok('a right guess scores that answer\'s points', r.result.hit === true && r.result.a === 'Parmi' && r.result.pts === 38 && r.result.total === 38);
ok('and flips it on the TV with who found it', r.reveal && r.reveal.i === 0 && r.reveal.a === 'Parmi' && r.reveal.by === 'Sam');
r = g.guess('p2', 'Jo', 'parmy');
ok('a second player finding it scores too', r.result.hit === true && r.result.pts === 38);
ok('but it does not flip again', r.reveal === null);
r = g.guess('p1', 'Sam', 'parmi');
ok('the same player naming it again: no points and no guess used', r.result.why === 'already' && r.result.left === 2);
r = g.guess('p1', 'Sam', 'lasagne');
ok('a wrong guess uses a guess and scores nothing', r.result.hit === false && r.result.left === 1);
g.guess('p1', 'Sam', 'steak');
r = g.guess('p1', 'Sam', 'burger');
ok('three guesses a board, then no more', r.result.why === 'no_guesses' && g.scores.p1.pts === 38 + 12);
clock += 46000;
r = g.guess('p2', 'Jo', 'schnitzel');
ok('a guess after the clock is refused', r.result.why === 'time' && g.scores.p2.pts === 38);
var end = g.endBoard();
ok('end of board: every answer nobody found is sent, and only those', end.showall.rest.length === board.answers.length - 2 && !end.showall.rest.some(function(x){ return x.a === 'Parmi' || x.a === 'Steak'; }));
ok('the leaderboard, best first', end.leaderboard.rows[0].name === 'Sam' && end.leaderboard.rows[0].points === 50 && end.leaderboard.rows[1].points === 38);
var pub2 = g.nextBoard();
ok('the next board is one not played tonight', pub2.q !== board.q && pub2.round === 2);
r = g.guess('p2', 'Jo', 'beer');
ok('scores carry across boards', g.scores.p2.pts === 38 + 34, JSON.stringify(g.scores.p2));
var saved = g.save(), g2 = new window.PRGame.Game({ now: function(){ return clock; }, boards: [board] }); g2.load(saved);
ok('a console reload keeps the scores and the round', g2.scores.p2.pts === 72 && g2.round === 2);
/* Reloaded MID-BOARD: the same board comes back, with what was found and each phone's guesses left. */
var g3 = new window.PRGame.Game({ now: function(){ return clock; } }); g3.load(g.save());
ok('a reload mid-board brings back the board in play', !!g3.board && g3.board.q === pub2.q && g3.endsAt === g.endsAt);
ok('and each phone\'s guesses left', g3.guesses.p2 && g3.guesses.p2.left === 2);
var back = g3.replay();
ok('the replay is the board (no answers) and only what was FOUND', back[0].t === 'ta_board' && !('answers' in back[0]) &&
   back.length === 1 + Object.keys(g.found).length && back.slice(1).every(function(m){ return m.t === 'ta_reveal' && g.found[m.i] !== undefined; }));
r = g3.guess('p2', 'Jo', 'beer');
ok('an answer found before the reload stays found', r.result.why === 'already');
g3.endBoard(); var g4 = new window.PRGame.Game(); g4.load(g3.save());
ok('between boards there is nothing to replay', g4.board === null && g4.replay() === null);
ok('the name lives in one place', window.PRGame.NAME === 'Punters Reckon');
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' punters reckon checks failed');
