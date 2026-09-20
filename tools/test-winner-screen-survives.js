/* THE WINNER'S SCREEN MUST STILL BE THERE WHEN SHE REACHES THE HOST.

   Audit, 20 Sep 2026, rated critical and reproduced twice. A player wins, her phone says
   "You won! Show this to the host", and within thirty seconds it is gone: back on her
   ordinary ticket with the BINGO button live again. No error anywhere.

   Why: the host answers EVERY join with a cards message; a phone re-joins on every 30 second
   host heartbeat and on every reconnect (a screen locking and unlocking); and the phone read
   ANY cards message as "fresh deal, new round" and cleared the win. A line win in a
   progressive game went the same way.

   This runs the REAL console and the REAL phone page against each other (tools/rig-bingo-room.js).

   Run from the repo root:  jsc tools/test-winner-screen-survives.js
*/
load('tools/rig-bingo-room.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function saved(ph, key) { return !!ph.dom.localStorage.getItem(key + CODE); }
function callRow(host, cells) {
  cells.filter(function (v) { return v; }).forEach(function (n) {
    var k = host.G.pool.indexOf(n); if (k >= 0) { host.G.pool.splice(k, 1); host.commitBall(n, false); }
  });
}

(async function () {
  print('A win survives the walk to the host');
  print('');
  var host = bootHost(); await advance(50);
  var ann = bootPhone('Ann'), bob = bootPhone('Bob'); await advance(50);
  ann.$('nameIn').value = 'Ann'; ann.join(); bob.$('nameIn').value = 'Bob'; bob.join(); await advance(50);
  host.$('prizeInput').value = '$50 bar tab'; host.$('patternSel').value = 'one';
  host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(50);
  host.startGame(); await advance(50);
  check('the rig is real: both phones were dealt a ticket by the real console',
        ann.P.cards.length === 1 && bob.P.cards.length === 1, [ann.P.cards.length, bob.P.cards.length]);

  // A LINE WIN in a progressive game, then the game plays on.
  callRow(host, ann.P.cards[0].cells[0]); await advance(50);
  ann.pressBingo(); await advance(50);
  check('her claim reaches the host and is valid', host.G.claims.length === 1 && host.G.claims[0].valid, host.G.claims);
  host.hostConfirm(0); await advance(10);
  host.$('nextPatternSel').value = 'two'; host.$('nextPrizeIn').value = '$100';
  host.keepPlaying(); await advance(50);
  check('the line win is on her phone', ann.P.stageWins.length === 1, ann.P.stageWins.length);
  var hb0 = LOG.filter(function (l) { return l.from === 'host' && l.p.t === 'host_here'; }).length;
  await advance(31000);
  var hb1 = LOG.filter(function (l) { return l.from === 'host' && l.p.t === 'host_here'; }).length;
  check('a heartbeat really did happen in those 31 seconds (or this proves nothing)', hb1 > hb0, hb1 - hb0);
  check('the line win SURVIVES the heartbeat', ann.P.stageWins.length === 1 && saved(ann, 'vp-stagewin-'),
        { stageWins: ann.P.stageWins.length, saved: saved(ann, 'vp-stagewin-') });

  // THE FINAL WIN.
  callRow(host, ann.P.cards[0].cells[1]); await advance(50);
  ann.pressBingo(); await advance(50);
  host.hostConfirm(0); await advance(10); host.finishGame(); await advance(50);
  check('she is on the win screen', viewOf(ann) === 'vWon' && ann.P.won === true, viewOf(ann));
  await advance(31000);
  check('31 seconds later, host untouched, she is STILL on the win screen',
        viewOf(ann) === 'vWon' && ann.P.won === true && saved(ann, 'vp-win-'),
        { view: viewOf(ann), won: ann.P.won, saved: saved(ann, 'vp-win-') });
  /* The button. With P.won wiped, pressBingo's guard let a SECOND claim through on a game
     that was already over. Press it and count what reaches the host. */
  var claimsBefore = LOG.filter(function (l) { return l.p && l.p.t === 'claim'; }).length;
  ann.pressBingo(); await advance(100);
  var claimsAfter = LOG.filter(function (l) { return l.p && l.p.t === 'claim'; }).length;
  check('pressing BINGO again on a won game sends NOTHING to the host', claimsAfter === claimsBefore,
        { before: claimsBefore, after: claimsAfter });
  check('the player who lost is still told so', viewOf(bob) === 'vLost', viewOf(bob));

  // A NEW ROUND MUST STILL CLEAR IT. The fix must not strand her on "You won" next game.
  host.startGame(); await advance(200);
  check('a genuinely NEW round still clears the old win (new card numbers are a real deal)',
        ann.P.won === false && viewOf(ann) !== 'vWon', { view: viewOf(ann), won: ann.P.won });

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
