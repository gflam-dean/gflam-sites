/* TRIVIA, THE FIXES FROM DEAN'S LIVE PLAY AT TEST ALPHA (Fri 6 Nov 2026, 04:00 to 04:30).

   This RUNS the real functions lifted out of venueplay/app/trivia/host.html and play.html:
     - AUTO REVEAL: autoRevealWait() is never earlier than the clock closing plus the host's delay, is off when
       switched off, and never fires for a question that is not open ("That didn't even give me time to answer").
     - THE WINNERS ARE THREE TAPS: finishNow() sends the podium (step 1, first place covered) and NOTHING else;
       announceFirst() sends step 2; showFinalBoard() sends the leaderboard; the leaderboard cannot come before the
       podium, and a step cannot be skipped.
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


print('THE WINNERS: podium first, first place on the host\'s tap, leaderboard last');
var SRC = ['finishOutcome', 'finishNow', 'endMsg', 'announceFirst', 'showFinalBoard'].map(function (n) { return liftFrom(HOST, n); }).join('\n');
function makeHost(board, all) {
  var G = { board: board, status: 'reveal', endStep: 0, noPlayersNote: false, winnersAll: all === true };
  var sent = [], errors = [];
  function playerCount() { return 3; } function bcast(m) { sent.push(m); } function renderConsole() {} function hostError(m) { errors.push(m); }
  var NOBODY_MSG = 'x';
  eval(SRC);
  return { G: G, sent: sent, finishNow: finishNow, announceFirst: announceFirst, showFinalBoard: showFinalBoard, endMsg: endMsg };
}
var B = [{ name: 'A', points: 900 }, { name: 'B', points: 700 }, { name: 'C', points: 500 }, { name: 'D', points: 100 }];
var h = makeHost(B);
h.finishNow(true);
ok('the end of the quiz sends ONE message: the podium, step 1', h.sent.length === 1 && h.sent[0].t === 'podium' && h.sent[0].step === 1, JSON.stringify(h.sent.map(function (m) { return m.t + ':' + m.step; })));
ok('no leaderboard is sent with it', !h.sent.some(function (m) { return m.t === 'leaderboard'; }));
h.showFinalBoard();
ok('the leaderboard cannot be shown before first place is announced', h.sent.length === 1 && h.G.endStep === 1);
h.announceFirst();
ok('Announce first place sends the podium again at step 2', h.sent.length === 2 && h.sent[1].t === 'podium' && h.sent[1].step === 2, JSON.stringify(h.sent[1]));
h.announceFirst();
ok('and only once', h.sent.length === 2);
h.showFinalBoard();
ok('then Show the leaderboard sends the final scores', h.sent.length === 3 && h.sent[2].t === 'leaderboard' && /^final/i.test(h.sent[2].title) && h.sent[2].rows.length === 4, JSON.stringify(h.sent[2]));
ok('the order on the wire is podium, podium, leaderboard', h.sent.map(function (m) { return m.t; }).join(',') === 'podium,podium,leaderboard');
var ha = makeHost(B, true);
ha.finishNow(true);
ok('"All at once" (Advanced settings): the podium goes up at step 2, all three places and the sound together', ha.sent.length === 1 && ha.sent[0].t === 'podium' && ha.sent[0].step === 2, JSON.stringify(ha.sent));
ha.announceFirst();
ok('there is no first place left to announce', ha.sent.length === 1);
ha.showFinalBoard();
ok('and the next tap is the leaderboard', ha.sent.length === 2 && ha.sent[1].t === 'leaderboard');
ok('staged is the default, and the setting is in Advanced settings', /winnersAll:false/.test(HOST) && HOST.indexOf('id="cfgWinners"') > HOST.indexOf('id="triviaAdv"') && HOST.indexOf('id="cfgWinners"') < HOST.indexOf('</details>', HOST.indexOf('id="triviaAdv"')));

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
ok('step 1 on a first-place phone: no celebration, no confetti, no rating prompt', p1.counts.celebrate === 0 && p1.counts.confetti === 0 && p1.counts.ask === 0, JSON.stringify(p1.counts));
ok('and it does not say YOU WON yet', p1.$('finalBig').textContent !== 'YOU WON!' && p1.$('finalRank').textContent === '', p1.$('finalBig').textContent);
ok('it still shows the score', p1.$('finalScore').textContent === '790 points');
var p2 = makePhone(1);
p2.showFinal();
ok('step 2 on a first-place phone: the celebration fires, once', p2.counts.celebrate === 1 && p2.$('finalBig').textContent === 'YOU WON!', JSON.stringify(p2.counts));
var p3 = makePhone(5);
p3.showFinal(true, 'The host has ended this game.');
ok('End game: the quiet final-score screen with the points, never "You\'re in"', p3.$('finalScore').textContent === '790 points' && p3.$('finalBig').textContent === "That's a wrap" && p3.counts.celebrate === 0);
ok('the podium message on the phone is gated on its step', /if\(m\.step===1\)\{ if\(!P\.celebrated\) showFinal\(true,/.test(PLAY) && /else \{ P\.celebrated=true; showFinal\(\); \}/.test(PLAY));
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

print('THE +10 SECONDS BUTTON IS GONE (Dean, 6 Nov 2026)');
ok('no "+10 seconds" button on the console', HOST.indexOf('+10 seconds') < 0 && HOST.indexOf('addTimeBtn') < 0);
ok('no addTime() function and no call to the add-time route from the console', HOST.indexOf('function addTime(') < 0 && HOST.indexOf('/host/question/add-time') < 0);

print('THE TV: no Join now card on the winners or the leaderboard');
ok('one line switch, off', /var JOIN_ON_RESULTS=false;/.test(SCREEN));
ok('show() hides the card on the board and the podium unless it is on', /\(!JOIN_ON_RESULTS && \(which==="tvBoard" \|\| which==="tvPodium"\)\)/.test(SCREEN));
ok('the podium covers first place and stays silent at step 1', /cols\.classList\.toggle\("covered", step===1\);\s*\n\s*if\(step===1\)\{[\s\S]*?return; \}\s*\n\s*if\(!already\) celebrate\(9000\);/.test(SCREEN));
ok('the TV no longer holds the leaderboard behind the podium on a timer', SCREEN.indexOf('_hold') < 0);

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
