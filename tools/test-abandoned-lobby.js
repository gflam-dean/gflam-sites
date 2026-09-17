/* An abandoned bingo lobby goes back to the venue's ads. A live game does not.

   The ordinary end of a night is a host closing the tab, not pressing End. The t:"to_ads" sent
   on pagehide has to go unsigned, and vp-sign.js drops unsigned to_ads on purpose because a
   forged one would let any patron kill a live game. So at an enforcing venue that message never
   arrives, and the wall sat on a join code for a game nobody was running until the 90 minute
   host-silence timeout.

   This lifts the real watchdog and the real heartbeat out of the shipped pages and runs them.

   Run:  jsc tools/test-abandoned-lobby.js
*/
var TV = readFile('venueplay/tv.html');
var CONSOLE = readFile('venueplay/app/index.html');
var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('an abandoned lobby goes back to ads; a live game does not');

/* 1. EVERY console says it is still there, including bingo. That is what makes silence mean
      something. Before today, four of five did. */
var beats = [
  ['bingo',   CONSOLE, /setInterval\(function\(\)\{\s*if\(G\.status==="running" \|\| G\.status==="lobby"\) send\(\{ t:"host_here" \}\);/],
  ['trivia',  readFile('venueplay/app/trivia/host.html'),  /bcast\(\{ t:"host_here" \}\)/],
  ['musical', readFile('venueplay/app/musical/host.html'), /t:"host_here"/],
  ['raffle',  readFile('venueplay/app/raffle/host.html'),  /t:"host_here"/],
  ['members', readFile('venueplay/app/members/host.html'), /t:"host_here"/],
];
beats.forEach(function (b) { check(b[0] + ' console beats host_here', b[2].test(b[1])); });
check('every console uses the same thirty seconds',
  /BINGO_HEARTBEAT_MS = 30000/.test(CONSOLE), 'bingo interval');

/* 2. The TV counts that beat as proof of life, or none of the above matters. */
check('the TV treats host_here as proof of life', /HOST_TYPES=\{host_here:1/.test(TV));

/* 3. THE DECISION ITSELF, lifted out and run. Not a source read: the real line. */
var decide = /var idleLobby = [^\n]*\n\s*var window_ms = [^\n]*/.exec(TV);
check('the watchdog decision was found', !!decide, decide && decide[0]);
if (decide) {
  var f = new Function('tvMode', 'state', 'LOBBY_SILENCE_MS', 'HOST_SILENCE_MS',
                       decide[0] + ' return { idleLobby: idleLobby, window_ms: window_ms };');
  var SHORT = 6 * 60 * 1000, LONG = 90 * 60 * 1000;
  var lobby   = f('bingo', { phase: 'lobby' },   SHORT, LONG);
  var running = f('bingo', { phase: 'running' }, SHORT, LONG);
  var claim   = f('bingo', { phase: 'claim' },   SHORT, LONG);
  var win     = f('bingo', { phase: 'win' },     SHORT, LONG);
  var embed   = f('embed', { phase: 'lobby' },   SHORT, LONG);
  var holding = f('holding', { phase: 'lobby' }, SHORT, LONG);
  check('an abandoned bingo LOBBY uses the short window', lobby.idleLobby === true && lobby.window_ms === SHORT, lobby);
  check('a bingo game being PLAYED keeps the long one', running.window_ms === LONG, running);
  check('a claim being judged keeps the long one', claim.window_ms === LONG, claim);
  check('a winner on screen keeps the long one', win.window_ms === LONG, win);
  check('an EMBEDDED format keeps the long one, whatever our own phase says', embed.window_ms === LONG, embed);
  check('holding keeps the long one', holding.window_ms === LONG, holding);
  check('no state object at all does not throw and keeps the long one',
    f('bingo', null, SHORT, LONG).window_ms === LONG);
}

/* 4. Six minutes is twelve missed beats. Anything under about three would be a wifi blip. */
var m = /var LOBBY_SILENCE_MS=(\d+)\*60\*1000/.exec(TV);
check('the short window is set in minutes and is at least 5', m && +m[1] >= 5, m && m[1]);
check('and is well under the long one', m && (+m[1] * 60000) < 90 * 60 * 1000, m && m[1]);

/* 5. The long window is untouched. A live game losing the wall is far worse than a dead code. */
check('a running game still gets its ninety minutes', /HOST_SILENCE_MS=90\*60\*1000/.test(TV));

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('abandoned lobby: ' + fails + ' failed'); }
