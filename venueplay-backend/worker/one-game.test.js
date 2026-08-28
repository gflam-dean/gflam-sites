/* Does "start a game" end the RIGHT games?

   This is the dangerous half of the fix. Ending too little leaves the bug that
   sent a bingo room into an eleven-song musical set. Ending too much kills a
   host's own game when they reload the console or start round two, which is
   worse than the bug it replaces.

   Runs endOtherRunningGames against stubbed storage, so it exercises the real
   function out of the Worker rather than a copy of it.
*/
var src = readFile('/Users/dean.tindale/gflam-sites-current/venueplay-backend/worker/venueplay-game.js')
            .replace(/^export default/m, 'var _default =');

var PASS = 0, FAIL = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { PASS++; } else { FAIL++; print('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
}

function run(games, starting) {
  var ended = [];
  var scope = {
    enc: encodeURIComponent,
    console: { log: function () {} },
    sbGet: function (env, table) {
      if (table === 'vp_sessions') return Promise.resolve([{ id: 'S1' }]);
      if (table === 'vp_games') return Promise.resolve(games.map(function (f, i) {
        return { id: 'G' + i, format: f };
      }));
      return Promise.resolve([]);
    },
    sbPatch: function (env, table, q) {
      var i = parseInt(String(q).replace(/\D/g, ''), 10);
      ended.push(games[i]);
      return Promise.resolve({});
    },
  };
  var body = src.match(/async function endOtherRunningGames[\s\S]*?\n\}\n/)[0];
  var f = new Function('enc', 'console', 'sbGet', 'sbPatch',
                       body + '; return endOtherRunningGames;')(
            scope.enc, scope.console, scope.sbGet, scope.sbPatch);
  var out = null;
  f({}, 'V1', starting).then(function () { out = ended; });
  drainMicrotasks();
  return ended;
}

// THE REPORTED FAULT: musical still running, host starts bingo.
check('bingo ends a running musical set', run(['musical'], 'bingo'), ['musical']);
check('bingo ends musical_bingo too',     run(['musical_bingo'], 'bingo'), ['musical_bingo']);
check('bingo ends a running trivia round', run(['trivia'], 'bingo'), ['trivia']);

// THE THING THAT MUST NOT HAPPEN: a host reloading kills their own game.
check('musical does NOT end its own set',  run(['musical'], 'musical'), []);
check('musical_bingo vs musical is the same game', run(['musical_bingo'], 'musical'), []);
check('musical vs musical_bingo is the same game', run(['musical'], 'musical_bingo'), []);
check('trivia does NOT end its own round', run(['trivia'], 'trivia'), []);
check('bingo does NOT end its own game',   run(['bingo'], 'bingo'), []);
check('bingo90 vs bingo is the same game', run(['bingo90'], 'bingo'), []);

// Mixed and empty states.
check('ends every other format at once', run(['musical','trivia','raffle'], 'bingo').sort(),
      ['musical','raffle','trivia']);
check('keeps its own, ends the rest', run(['musical','trivia'], 'trivia'), ['musical']);
check('nothing running, nothing ended', run([], 'bingo'), []);
check('a blank format ends nothing', run(['musical'], ''), []);

print(FAIL === 0 ? ('ALL ' + PASS + ' CHECKS PASSED') : (FAIL + ' FAILED of ' + (PASS + FAIL)));
