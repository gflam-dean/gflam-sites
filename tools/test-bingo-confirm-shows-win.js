/* CONFIRM WINNER PUTS THE WIN ON EVERY SCREEN AT ONCE (Dean, live, 6 Nov 2026).

   Dean saw it live: the host taps Confirm winner in the bingo console, and the TV stays on
   "BINGO? Checking the card" and the winner's phone on "the host is checking your ticket" until
   the host ALSO taps Keep playing or Finish game. The confirmed win sat in the console, unsent.

   Now Confirm winner sends the win there and then (BINGO! and the name on the TV, YOU WON on the
   winner's phone, who won on everyone else's), and the host chooses Keep playing or Finish game
   after, as before. Nothing celebrates twice, the prize is recorded once, and Keep playing takes
   every phone back to its ticket for the next prize.

   This runs the REAL console and the REAL phone page against each other (tools/rig-bingo-room.js).
   The TV's side is run in Chrome by tools/tv-and-phone-in-chrome.test.py.

   Run from the repo root:  jsc tools/test-bingo-confirm-shows-win.js
*/
load('tools/rig-bingo-room.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function callRow(host, cells) {
  cells.filter(function (v) { return v; }).forEach(function (n) {
    var k = host.G.pool.indexOf(n); if (k >= 0) { host.G.pool.splice(k, 1); host.commitBall(n, false); }
  });
}
/* The host's own tap: the claim queue's click handler on the real console, with a Confirm winner button
   (data-act="confirm", data-i) as its target, the way the browser delivers it. */
function tapConfirm(host, i) {
  var btn = { getAttribute: function (k) { return k === 'data-act' ? 'confirm' : (k === 'data-i' ? String(i) : null); } };
  host.$('claimQueue')._on.click.forEach(function (f) { f({ target: { closest: function () { return btn; } } }); });
  return true;
}
function winners() { return LOG.filter(function (l) { return l.from === 'host' && l.p && l.p.t === 'winner'; }).map(function (l) { return l.p; }); }

(async function () {
  print('Confirm winner shows the win straight away');
  print('');
  var host = bootHost(); await advance(50);
  var ann = bootPhone('Ann'), bob = bootPhone('Bob'); await advance(50);
  ann.$('nameIn').value = 'Ann'; ann.join(); bob.$('nameIn').value = 'Bob'; bob.join(); await advance(50);
  host.$('prizeInput').value = '$50 bar tab'; host.$('patternSel').value = 'one';
  host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(50);
  host.startGame(); await advance(50);
  check('the rig is real: both phones were dealt a ticket by the real console', ann.P.cards.length === 1 && bob.P.cards.length === 1);

  // ONE LINE, then Keep playing.
  callRow(host, ann.P.cards[0].cells[0]); await advance(50);
  ann.pressBingo(); await advance(50);
  check('her claim reaches the host and is valid; her phone waits on the host', host.G.claims.length === 1 && host.G.claims[0].valid && ann.P.claimPending === true, host.G.claims);
  var w0 = winners().length;
  var shown = tapConfirm(host, 0); await advance(50);   // the host taps Confirm winner
  var ws = winners().slice(w0);
  check('tapping Confirm winner sends the win AT ONCE, before Keep playing or Finish game', shown === true && ws.length === 1, ws);
  var m = ws[0] || {};
  check('it names her and her card, the pattern and this prize, and holds (cont false) with a wid', m.name === 'Ann' && m.winners && m.winners.length === 1 && m.pattern === 'one' && m.prize === '$50 bar tab' && m.cont === false && m.held === true && !!m.wid, m);
  check('her phone is on YOU WON straight away, no longer "the host is checking"', viewOf(ann) === 'vWon' && ann.P.won === true && ann.P.claimPending === false, { view: viewOf(ann), won: ann.P.won });
  check('Bob\'s phone says who won', viewOf(bob) === 'vLost' && /Ann/.test(bob.P.lostBy || ''), { view: viewOf(bob), lostBy: bob.P.lostBy });
  check('the console still asks Keep playing or Finish game', host.G.lastWins.length === 1 && /data-act="keepplaying"/.test(host.$('claimQueue').innerHTML) && /data-act="finish"/.test(host.$('claimQueue').innerHTML), host.$('claimQueue').innerHTML.slice(0, 200));
  check('no prize recorded yet (it is recorded once, at the choice)', host.G.prizesWon.length === 0, host.G.prizesWon);

  host.$('nextPatternSel').value = 'two'; host.$('nextPrizeIn').value = '$100';
  var w1 = winners().length;
  host.keepPlaying(); await advance(50);
  var kp = winners().slice(w1)[0] || {};
  check('Keep playing sends the same win once more, marked shown, with the next pattern and prize', kp.wid === m.wid && kp.shown === true && kp.cont === true && kp.next === 'two' && kp.nextPrize === '$100', kp);
  check('her phone goes back to her ticket, the line kept as won, playing for two lines', viewOf(ann) === 'vCard' && ann.P.won === false && ann.P.stageWins.length === 1 && ann.P.pattern === 'two', { view: viewOf(ann), won: ann.P.won, stageWins: ann.P.stageWins.length, pattern: ann.P.pattern });
  check('Bob\'s phone goes back to his ticket too', viewOf(bob) === 'vCard' && bob.P.ended === false, { view: viewOf(bob), ended: bob.P.ended });
  check('the prize is recorded once', host.G.prizesWon.length === 1 && host.G.prizesWon[0].winner_name === 'Ann', host.G.prizesWon);
  check('and the next number can be called (nothing left waiting)', host.G.lastWins.length === 0 && host.G.claims.length === 0);

  // TWO LINES for Bob, then Finish game.
  callRow(host, bob.P.cards[0].cells[0]); callRow(host, bob.P.cards[0].cells[1]); await advance(50);
  bob.pressBingo(); await advance(50);
  var bobClaim = host.G.claims.filter(function (c) { return c.name === 'Bob'; })[0];
  check('Bob claims two lines', !!bobClaim && bobClaim.valid, host.G.claims);
  var w2 = winners().length;
  host.confirmWinner(host.G.claims.indexOf(bobClaim)); await advance(50);
  var b = winners().slice(w2)[0] || {};
  check('Confirm winner: Bob\'s win goes out at once, a new wid', b.name === 'Bob' && b.held === true && b.wid && b.wid !== m.wid, b);
  check('Bob is on YOU WON, and Ann\'s phone says Bob won', viewOf(bob) === 'vWon' && viewOf(ann) === 'vLost', [viewOf(bob), viewOf(ann)]);
  var w3 = winners().length;
  host.finishGame(); await advance(50);
  var f = winners().slice(w3)[0] || {};
  check('Finish game sends it once more, shown and still cont false, so the win stays up', f.wid === b.wid && f.shown === true && f.cont === false, f);
  check('Bob keeps YOU WON, the game is done, two prizes recorded', viewOf(bob) === 'vWon' && host.G.won === true && host.G.prizesWon.length === 2, { view: viewOf(bob), won: host.G.won, prizes: host.G.prizesWon.length });

  // A TIE: two claims on the same ball, confirmed one by one; the second goes out with both names.
  print('');
  print('A tie, confirmed one by one');
  var host2 = bootHost(); await advance(50);
  var cy = bootPhone('Cy'), di = bootPhone('Di'); await advance(50);
  [cy, di].forEach(function (p) { p.$('nameIn').value = p.name; p.join(); }); await advance(50);
  host2.$('prizeInput').value = 'Meat tray'; host2.$('patternSel').value = 'full'; host2.$('cardsSel').value = '1'; host2.$('paidSel').value = '';
  host2.openLobby(); await advance(50); host2.startGame(); await advance(50);
  var all = {}; [cy, di].forEach(function (p) { p.P.cards[0].cells.forEach(function (row) { row.forEach(function (n) { if (n) all[n] = 1; }); }); });
  callRow(host2, Object.keys(all).map(Number)); await advance(50);
  cy.pressBingo(); di.pressBingo(); await advance(80);
  check('two full houses called on the same ball', host2.G.claims.length >= 2, host2.G.claims.map(function (c) { return c.name; }));
  var t0 = winners().length;
  host2.confirmWinner(host2.G.claims.map(function (c) { return c.name; }).indexOf('Cy')); await advance(50);
  host2.confirmWinner(host2.G.claims.map(function (c) { return c.name; }).indexOf('Di')); await advance(50);
  var tw = winners().slice(t0);
  check('each Confirm sends the win; the second carries both names, shared, the same wid', tw.length === 2 && tw[1].shared === true && tw[1].winners.length === 2 && tw[1].wid === tw[0].wid, tw);
  check('both phones are on YOU WON', viewOf(cy) === 'vWon' && viewOf(di) === 'vWon', [viewOf(cy), viewOf(di)]);
  host2.finishGame(); await advance(50);
  check('Finish: one record each, shared', host2.G.prizesWon.length === 2 && host2.G.prizesWon.every(function (p) { return p.shared; }), host2.G.prizesWon);

  print('');
  print(FAIL ? (FAIL + ' FAILED, ' + (PASS + FAIL) + ' run') : ('ALL ' + PASS + ' CHECKS PASSED'));
})();
