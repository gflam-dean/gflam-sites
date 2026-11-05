/* TRIVIA, THE FIXES FROM DEAN'S LIVE PLAY AT TEST ALPHA (Fri 6 Nov 2026, 04:00 to 04:30).

   This RUNS the real functions lifted out of venueplay/app/trivia/host.html and play.html:
     - AUTO REVEAL: autoRevealWait() is never earlier than the clock closing plus the host's delay, is off when
       switched off, and never fires for a question that is not open ("That didn't even give me time to answer").
     - THE WINNERS, ONE TAP A PLACE: finishNow() puts up third place only, nextPlace() second, then the winner (the only
       message the TV and phones celebrate); "All at once" goes straight to the winner; the leaderboard 60 s after the
       winner or on "Show the leaderboard", then the ads 2 minutes later; never before the winner.
     - THE PHONE IS QUIET until first place is announced: showFinal(true) never celebrates, showFinal() for a
       first-place team does; an idle (End game) paints the quiet final screen, not "You're in / Good luck".
     - the +10 seconds button is gone from the console, with the function behind it.
     - the TV's Join now card is off the winners and the leaderboard behind a one-line switch.

   Run from the repo root:  jsc tools/test-trivia-live-fixes-6nov.js
*/
var HOST = readFile('venueplay/app/trivia/host.html');
var PLAY = readFile('venueplay/app/trivia/play.html');
var SCREEN = readFile('venueplay/app/trivia/screen.html');
function liftFrom(text, name) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || !extra ? '' : '   saw: ' + extra)); if (!c) bad++; }

print('AUTO REVEAL (never before the clock closes)');
var wait = eval(liftFrom(HOST, 'autoRevealWait') + ';autoRevealWait');
var NOW = 1000000;
ok('20 s left on the clock, 10 s delay: 30 s from now, not 10', wait(true, 'question', NOW + 20000, NOW, 10) === 30000, wait(true, 'question', NOW + 20000, NOW, 10));
ok('a clock that closed long ago still waits the full delay', wait(true, 'question', NOW - 50000, NOW, 10) === 10000, wait(true, 'question', NOW - 50000, NOW, 10));
ok('never less than the delay, whatever the clock', [0, 5000, 30000, -9000].every(function (d) { return wait(true, 'question', NOW + d, NOW, 10) >= 10000; }));
ok('never earlier than the close', [1000, 12345, 30000].every(function (d) { return wait(true, 'question', NOW + d, NOW, 10) >= d; }));
ok('switched off: never', wait(false, 'question', NOW + 5000, NOW, 10) === -1);
ok('not on a question (reveal, ready, ended, setup): never', ['reveal', 'ready', 'ended', 'setup'].every(function (s) { return wait(true, s, NOW + 5000, NOW, 10) === -1; }));
ok('no deadline known: never', wait(true, 'question', 0, NOW, 10) === -1);
ok('a silly delay is held to 3 to 60 seconds', wait(true, 'question', NOW, NOW, 0) === 10000 && wait(true, 'question', NOW, NOW, 1) === 3000 && wait(true, 'question', NOW, NOW, 999) === 60000,
   [wait(true, 'question', NOW, NOW, 0), wait(true, 'question', NOW, NOW, 1), wait(true, 'question', NOW, NOW, 999)]);
ok('it is ON by default, 10 seconds', /autoReveal:true, autoSecs:10/.test(HOST));
ok('the timer fires reveal() only once the clock has closed or every team is in (a guard in the callback itself)', /if\(remainingSecs\(\)>0 && !allAnswered\(\)\)\{ scheduleAutoReveal\(\); return; \}/.test(HOST));
print('EVERY TEAM IN: the auto reveal may go early, still after the delay (Dean, 6 Nov 2026 10:00)');
ok('all in 5 s from now with 20 s on the clock: 15 s from now (all in + 10), not 30', wait(true, 'question', NOW + 20000, NOW, 10, NOW + 5000) === 15000, wait(true, 'question', NOW + 20000, NOW, 10, NOW + 5000));
ok('all in just now: exactly the delay', wait(true, 'question', NOW + 20000, NOW, 10, NOW) === 10000);
ok('all in AFTER the close changes nothing: the close counts', wait(true, 'question', NOW + 2000, NOW, 10, NOW + 9000) === 12000, wait(true, 'question', NOW + 2000, NOW, 10, NOW + 9000));
ok('updateLive starts the early wait the moment the last team answers, once', /if\(G\.status==="question" && p>0 && a>=p && !G\.allInAt\)\{ G\.allInAt=Date\.now\(\); if\(G\.autoReveal\) scheduleAutoReveal\(\); \}/.test(HOST));
ok('a new question starts with nobody in', (HOST.match(/G\.allInAt=0;/g) || []).length >= 2);

print('THE HOST\'S REVEAL NEEDS TWO TAPS WHILE THE CLOCK RUNS');
function makeTap(rem, all) {
  var revealed = 0, timers = [];
  function remainingSecs() { return rem; } function allAnswered() { return all; } function reveal() { revealed++; }
  function setTimeout(f, ms) { timers.push({ f: f, ms: ms }); return timers.length; } function clearTimeout() {}
  var attrs = {}, btn = { textContent: 'Reveal answer', getAttribute: function (k) { return attrs[k] || null; }, setAttribute: function (k, v) { attrs[k] = v; }, removeAttribute: function (k) { delete attrs[k]; } };
  var REVEAL_ARM_MS = 4000;
  eval(liftFrom(HOST, 'revealTap'));
  return { tap: function () { revealTap(btn); }, btn: btn, n: function () { return revealed; }, timers: timers };
}
var t1 = makeTap(12, false); t1.tap();
ok('time running: the first tap does not reveal, it asks "Tap again to reveal now"', t1.n() === 0 && t1.btn.textContent === 'Tap again to reveal now', t1.btn.textContent);
t1.tap();
ok('and the second tap reveals', t1.n() === 1);
var t2 = makeTap(12, false); t2.tap(); t2.timers[0].f(); t2.tap();
ok('after 4 seconds unanswered the button goes back, and a lone tap asks again', t2.n() === 0 && t2.btn.textContent === 'Tap again to reveal now' && t2.timers[0].ms === 4000);
var t3 = makeTap(0, false); t3.tap();
ok('the clock has closed: one tap reveals, as before', t3.n() === 1);
var t4 = makeTap(9, true); t4.tap();
ok('every team is in: one tap reveals', t4.n() === 1);
ok('the Reveal button goes through the two-tap guard', /rv\.addEventListener\("click", function\(\)\{ revealTap\(rv\); \}\)/.test(HOST));


print('THE WINNERS (Dean, 6 Nov 11:30): one tap each for third, second, the winner; or all at once; then the leaderboard');
var SRC = ['finishOutcome', 'finishNow', 'podiumRanks', 'endMsg', 'nextPlace', 'clearEndTimers', 'armBoardTimer', 'boardNoteText', 'showFinalBoard'].map(function (n) { return liftFrom(HOST, n); }).join('\n');
var BOARD_AFTER = +((HOST.match(/var BOARD_AFTER_MS=(\d+), BOARD_STAYS_MS=(\d+);/) || [])[1]), BOARD_STAYS = +((HOST.match(/var BOARD_AFTER_MS=(\d+), BOARD_STAYS_MS=(\d+);/) || [])[2]);
function makeHost(board, all) {
  var G = { board: board, status: 'reveal', noPlayersNote: false, winnersAll: all === true, endRanks: [], endReveal: 0, endBoard: false };
  var sent = [], errors = [], timers = [];
  function playerCount() { return 3; } function bcast(m) { sent.push(m); } function renderConsole() {} function hostError(m) { errors.push(m); }
  function setTimeout(f, ms) { timers.push({ f: f, ms: ms, on: true }); return timers.length; } function clearTimeout(id) { if (id && timers[id - 1]) timers[id - 1].on = false; }
  function setInterval() { return 0; } function clearInterval() {} function $() { return null; }
  var NOBODY_MSG = 'x', BOARD_AFTER_MS = BOARD_AFTER, BOARD_STAYS_MS = BOARD_STAYS;
  eval(SRC);
  return { G: G, sent: sent, timers: timers, finishNow: finishNow, nextPlace: nextPlace, showFinalBoard: showFinalBoard, podiumRanks: podiumRanks,
           live: function () { return timers.filter(function (t) { return t.on; }); } };
}
function wire(h) { return h.sent.map(function (m) { return m.t + (m.reveal ? ':' + m.reveal : ''); }).join(','); }
var B = [{ name: 'A', points: 900 }, { name: 'B', points: 700 }, { name: 'C', points: 500 }, { name: 'D', points: 100 }];
var h = makeHost(B);
h.finishNow(true);
ok('the end of the quiz puts up the podium showing THIRD place only, and nothing else', wire(h) === 'podium:3', wire(h));
h.showFinalBoard();
ok('the leaderboard cannot come before the winner', wire(h) === 'podium:3');
h.nextPlace();
ok('tap 2 shows SECOND', wire(h) === 'podium:3,podium:2', wire(h));
ok('no leaderboard timer yet', h.live().length === 0);
h.nextPlace();
ok('tap 3 shows the WINNER (reveal 1: the TV fanfare and the phones celebrate on this one only)', wire(h) === 'podium:3,podium:2,podium:1', wire(h));
h.nextPlace();
ok('and there is no fourth tap', wire(h) === 'podium:3,podium:2,podium:1');
var lt = h.live();
ok('the leaderboard comes up by itself 60 seconds after the winner', BOARD_AFTER === 60000 && lt.length === 1 && lt[0].ms === 60000, lt.map(function (t) { return t.ms; }));
lt[0].on = false; lt[0].f();
ok('it does: the final scores', wire(h) === 'podium:3,podium:2,podium:1,leaderboard', wire(h));
var at = h.live();
ok('they stay 2 minutes, then the TV goes back to the ads', BOARD_STAYS === 120000 && at.length === 1 && at[0].ms === 120000, at.map(function (t) { return t.ms; }));
at[0].f();
ok('to_ads is sent at the end of the 2 minutes', h.sent[h.sent.length - 1].t === 'to_ads');
var hs = makeHost(B); hs.finishNow(true); hs.nextPlace(); hs.nextPlace(); hs.showFinalBoard();
ok('"Show the leaderboard" before the 60 seconds brings it up at once, and the 60 second timer is cancelled', wire(hs) === 'podium:3,podium:2,podium:1,leaderboard' && hs.live().length === 1 && hs.live()[0].ms === 120000, wire(hs));
hs.live()[0].f(); hs.timers.forEach(function (t) { if (t.ms === 60000) t.f(); });
ok('and a late 60 second timer never sends the leaderboard twice', hs.sent.filter(function (m) { return m.t === 'leaderboard'; }).length === 1);
var ha = makeHost(B, true);
ha.finishNow(true);
ok('"All at once": all three places together, with the sound (reveal 1)', wire(ha) === 'podium:1', wire(ha));
ok('and the 60 second leaderboard timer starts at once', ha.live().length === 1 && ha.live()[0].ms === 60000);
ok('two teams: second, then the winner', makeHost().podiumRanks([{ points: 9 }, { points: 5 }]).join() === '2,1');
ok('a tie for first: third, then the two winners together', makeHost().podiumRanks([{ points: 9 }, { points: 9 }, { points: 5 }]).join() === '3,1');
ok('one team: just the winner', makeHost().podiumRanks([{ points: 9 }]).join() === '1');
ok('"One at a time" is the default, and the setting is in Advanced settings', /winnersAll:false/.test(HOST) && HOST.indexOf('id="cfgWinners"') > HOST.indexOf('id="triviaAdv"') && HOST.indexOf('id="cfgWinners"') < HOST.indexOf('</details>', HOST.indexOf('id="triviaAdv"')) && />One at a time</.test(HOST) && />All at once</.test(HOST));

print('THE PHONE');
function makePhone(rank) {
  var els = {}, counts = { celebrate: 0, confetti: 0, ask: 0 };
  function $(id) { return els[id] || (els[id] = { id: id, textContent: '', innerHTML: '', classList: { add: function () {}, remove: function () {} } }); }
  var P = { total: 790, rank: rank, gameId: '', ended: false, joined: true };
  function show() {} function playerGet() { return Promise.resolve({}); }
  function celebrate() { counts.celebrate++; } function confettiBurst() { counts.confetti++; } function askHowItWent() { counts.ask++; }
  var document = { querySelector: function (s) { return $('note'); } };
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  eval(['decorateFinal', 'showFinal', 'quietFinal'].map(function (n) { return liftFrom(PLAY, n); }).join('\n'));
  return { P: P, $: $, counts: counts, showFinal: showFinal };
}
var p1 = makePhone(1);
p1.showFinal(true, 'The winners are going up on the big screen.');
ok('third or second on the TV, first-place phone: no celebration, no confetti, no rating prompt', p1.counts.celebrate === 0 && p1.counts.confetti === 0 && p1.counts.ask === 0, JSON.stringify(p1.counts));
ok('and it does not say YOU WON yet', p1.$('finalBig').textContent !== 'YOU WON!' && p1.$('finalRank').textContent === '', p1.$('finalBig').textContent);
ok('it still shows the score', p1.$('finalScore').textContent === '790 points');
var p2 = makePhone(1);
p2.showFinal();
ok('the winner revealed, first-place phone: the celebration fires, once', p2.counts.celebrate === 1 && p2.$('finalBig').textContent === 'YOU WON!', JSON.stringify(p2.counts));
var p3 = makePhone(5);
p3.showFinal(true, 'The host has ended this game.');
ok('End game: the quiet final-score screen with the points, never "You\'re in"', p3.$('finalScore').textContent === '790 points' && p3.$('finalBig').textContent === "That's a wrap" && p3.counts.celebrate === 0);
ok('the podium message on the phone is gated on what is revealed', /if\(m\.reveal>1\)\{ if\(!P\.celebrated\) showFinal\(true,/.test(PLAY) && /else \{ P\.celebrated=true; showFinal\(\); \}/.test(PLAY));
var idle = PLAY.slice(PLAY.indexOf('else if(m.t==="idle"){'), PLAY.indexOf('else if(m.t==="idle"){') + 700);
ok('idle (End game) never routes to the "You\'re in" screen for a player who has a score', idle.indexOf('if(P.total>0 || P.ended) showFinal(true, "The host has ended this game.");') > 0 && !/showWait\("Thanks for playing\. Sit tight/.test(idle), idle.slice(0, 300));


print('A STALE NIGHT IS "NO GAME ON RIGHT NOW", NEVER "NEXT QUESTION COMING UP" (Dean, live, 6 Nov 2026, room 4NJPNQ)');
function makeNoGamePhone() {
  var els = {}, timers = [], painted = [];
  function $(id) { return els[id] || (els[id] = { id: id, textContent: '', classList: { add: function () {}, remove: function () {}, toggle: function () {} } }); }
  var P = { name: 'Pint Sized', joined: true, q: null, ended: false, total: 131, rank: 2, playersCount: 3, hostAt: 0, noGameT: null };
  function show() {} function stopCd() {} function rankText() { return ''; }
  function setTimeout(f, ms) { timers.push({ f: f, ms: ms }); return timers.length; } function clearTimeout() {}
  var Date = { now: function () { return 1000; } };
  eval(['showWait', 'showNoGame', 'armNoGame'].map(function (n) { return liftFrom(PLAY, n); }).join('\n') + ';var NO_GAME_MSG=' + JSON.stringify((PLAY.match(/var NO_GAME_MSG="([^"]+)"/) || [])[1]) + ';var NO_HOST_MS=75000;');
  return { P: P, $: $, timers: timers, showNoGame: showNoGame, armNoGame: armNoGame };
}
var ng = makeNoGamePhone();
ng.showNoGame();
ok('the no-game screen says so plainly', ng.$('waitHead').textContent === 'No game on right now' && /Ask the host, or scan the code when the next game starts/.test(ng.$('waitMsg').textContent), ng.$('waitHead').textContent + ' / ' + ng.$('waitMsg').textContent);
ok('with no score, no place and no "next question coming up"', ng.P.total === 0 && ng.P.rank === 0 && !/next question/i.test(ng.$('waitMsg').textContent));
var ng2 = makeNoGamePhone();
ng2.armNoGame();
ok('a returning phone waits 75 s for any host, then says there is no game', ng2.timers.length === 1 && ng2.timers[0].ms === 75000);
ng2.timers[0].f();
ok('and it does, when no host was heard', ng2.$('waitHead').textContent === 'No game on right now');
var ng3 = makeNoGamePhone();
ng3.armNoGame(); ng3.P.hostAt = 2000; ng3.timers[0].f();
ok('but not when a host was heard on the channel (a live game or lobby)', ng3.$('waitHead').textContent !== 'No game on right now');
ok('a night the Worker says is not live, whose re-join fails, lands on the no-game screen', /if\(!P\.token\)\{ showNoGame\(\); return; \}/.test(PLAY));
ok('the returning phone is never told "Next question coming up" or "You\'re back in"', PLAY.indexOf('"You\'re back in. Next question coming up on the big screen."') < 0);
ok('any host message clears the no-game timer', /if\(HOST_WORDS\[m\.t\]\)\{ P\.hostAt=Date\.now\(\);/.test(PLAY));


print('THE WAIT AND END SCREENS FOLLOW THE LATEST MOCK-UPS (newlook-musical-5nov/final/13-phone-youre-in.png), not the old look');
var wait = PLAY.slice(PLAY.indexOf('id="vWait"'), PLAY.indexOf('id="vQ"'));
ok('the waiting screen is the shared new-look lobby: ring tick, YOU\'RE IN in the display font, name, "Up first" chip, the lobby line',
   /class="vp-in"/.test(wait) && /class="vp-tick"/.test(wait) && /class="vp-h" id="waitHead"/.test(wait) && /class="vp-name" id="waitName"/.test(wait) && /Up first/.test(wait) && /class="vp-wait" id="waitMsg">The game will start here when the host is ready\./.test(wait), wait.slice(0, 200));
ok('no emoji tick and no "Good luck" on it', wait.indexOf('&#9989;') < 0 && !/Good luck/.test(wait));
ok('the venue\'s ad has its one slot above our logo, and its script is loaded', PLAY.indexOf('<div id="vpAd" hidden></div>') > 0 && PLAY.indexOf('<script src="/app/vp-phonead.js">') > 0);
ok('the ad shows on the waits and the end of the night only, and the venue\'s slides are asked for', /VPPhoneAd\.show\(which==="vWait" \|\| which==="vFinal"\)/.test(PLAY) && /\{ code:P\.room, ad:1 \}/.test(PLAY) && /VPPhoneAd\.set\(/.test(PLAY));
ok('a heading for any other moment (no game, welcome back, game ended) hides the tick and the chip', /\$\("waitTiles"\)\.classList\.toggle\("hidden", !!head\)/.test(PLAY) && /\$\("waitIcon"\)\.classList\.toggle\("hidden", !!head\)/.test(PLAY));


print('THE TV IS NEVER STUCK ON THE LAST ANSWER (INBOX 50/77: "TV reveals by itself in 1:30 if you don\'t tap")');
var aft = eval(liftFrom(HOST, 'autoFinishText') + ';autoFinishText');
ok('the console line counts down from 1:30', aft(90000) === "The TV reveals the winners by itself in 1:30 if you don't tap." && aft(9000) === "The TV reveals the winners by itself in 0:09 if you don't tap.", aft(90000));
(function () {
  var timers = [], finished = 0, G = { status: 'reveal', busy: false };
  function setTimeout(f, ms) { timers.push({ f: f, ms: ms }); return 1; } function setInterval() { return 2; } function clearTimeout() {} function clearInterval() {}
  function finish() { finished++; } function $() { return null; } var AUTO_FINISH_MS = +((HOST.match(/var AUTO_FINISH_MS=(\d+);/) || [])[1]);
  eval(['clearAutoFinish', 'armAutoFinish', 'autoFinishText'].map(function (n) { return liftFrom(HOST, n); }).join('\n'));
  armAutoFinish();
  ok('after the last reveal a 90 second timer is set', timers.length === 1 && timers[0].ms === 90000);
  timers[0].f();
  ok('and with no tap it puts the winners up itself', finished === 1);
  var G2 = G; G.status = 'ended'; timers = []; finished = 0; armAutoFinish(); timers[0].f();
  ok('but not once the host has already tapped', finished === 0);
})();
ok('the last reveal arms it, and the host\'s tap and End round clear it', /if\(isLast\)\{ armAutoFinish\(\); renderConsole\(\); \}/.test(HOST) && /function finish\(\)\{\n    clearAutoFinish\(\);/.test(HOST) && /clearTick\(\); clearAuto\(\); clearAutoFinish\(\);/.test(HOST));

print('THE +10 SECONDS BUTTON IS GONE (Dean, 6 Nov 2026)');
ok('no "+10 seconds" button on the console', HOST.indexOf('+10 seconds') < 0 && HOST.indexOf('addTimeBtn') < 0);
ok('no addTime() function and no call to the add-time route from the console', HOST.indexOf('function addTime(') < 0 && HOST.indexOf('/host/question/add-time') < 0);

print('THE TV: no Join now card on the winners or the leaderboard');
ok('one line switch, off', /var JOIN_ON_RESULTS=false;/.test(SCREEN));
ok('show() hides the card on the board and the podium unless it is on', /\(!JOIN_ON_RESULTS && \(which==="tvBoard" \|\| which==="tvPodium"\)\)/.test(SCREEN));
ok('the TV covers each place not yet revealed, and stays silent until the winner', /var col=el\("div","pcol "\+CLS\[o\.rank\]\+\(o\.rank<reveal \? " covered" : ""\)\);/.test(SCREEN) && /if\(reveal>1\)\{ if\(celebrateTimer\)[\s\S]*?return; \}\s*\n\s*if\(!already\) celebrate\(9000\);/.test(SCREEN));
ok('the TV no longer holds the leaderboard behind the podium on a timer', SCREEN.indexOf('_hold') < 0);

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
