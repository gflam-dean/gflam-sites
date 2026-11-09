/* THE RAFFLE CONSOLE TELLS THE HOST THE TRUTH, AND NEVER DRAWS AN UNSOLD TICKET.

   Five faults from the 27 Sep 2026 audit of venueplay/app/raffle/host.html. Every check here
   RUNS the shipped functions, lifted out of the page by name, against a fake page. None of it
   reads the source for a word.

   1. Error bars that stay up after they stop being true: "Time is up on ticket N" after the
      ticket was claimed or redrawn, "Enter a valid ticket range" after the range was fixed, and
      the "Picked up where you left off" NOTICE shown in the red error bar.
   3. The unsold tickets box dropping what it could not read ("240 - 320 and 400", "#512",
      semicolons, new lines) and silently keeping only the first 20 blocks. Every dropped
      ticket could be drawn in front of the room.
   4. Silent substitutions: 0 seconds to claim ("Put 0 for no time limit") started a countdown
      that said "Time is up" one second later, and a $500.50 jackpot became $500.
   6. The channel callback: a replaced channel reporting CLOSED, or the page being left, marked
      the console disconnected, and a channel closed while the tablet slept never came back.

   Run:  jsc tools/test-raffle-console.js
         jsc tools/test-raffle-console.js -- /path/to/other/host.html   (to prove it goes red)
*/
var PAGE = (typeof arguments !== 'undefined' && arguments.length) ? arguments[0] : 'venueplay/app/raffle/host.html';
var H = readFile(PAGE);
if (!H || H.length < 5000) throw new Error('could not read ' + PAGE);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function lift(name) {
  var i = H.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + PAGE + ': a test that cannot find its subject cannot fail');
  var d = 0, k = H.indexOf('{', i);
  do { if (H[k] === '{') d++; else if (H[k] === '}') d--; k++; } while (d > 0 && k < H.length);
  return H.slice(i, k) + '\n';
}
function liftVar(re, what) { var m = re.exec(H); if (!m) throw new Error('cannot find ' + what + ' in ' + PAGE); return m[0] + '\n'; }
function section(t) { print(''); print(t); }

/* ---------------- a fake page ---------------- */
function Cls() { this.s = {}; }
Cls.prototype.add = function (c) { this.s[c] = 1; };
Cls.prototype.remove = function (c) { delete this.s[c]; };
Cls.prototype.contains = function (c) { return !!this.s[c]; };
Cls.prototype.toggle = function (c, on) { if (on === undefined) on = !this.s[c]; if (on) this.s[c] = 1; else delete this.s[c]; };
function El(id) { this.id = id; this.value = ''; this.checked = false; this.disabled = false; this.textContent = ''; this.innerHTML = ''; this.kids = []; this.classList = new Cls(); this.className = ''; this.style = {}; }
El.prototype.appendChild = function (k) { this.kids.push(k); this.textContent += (k.textContent || ''); };
var els = {};
function $(id) { if (!els[id]) els[id] = new El(id); return els[id]; }
var document = { createElement: function () { return new El(''); } };
var window = { scrollTo: function () {} };
var timers = [], intervals = [];
function setTimeout(fn, ms) { timers.push(fn); return timers.length; }
function clearTimeout() {}
function setInterval(fn, ms) { intervals.push(fn); return intervals.length; }
function clearInterval(id) { if (intervals[id - 1]) intervals[id - 1] = null; }
function tick(n) { for (var j = 0; j < n; j++) intervals.forEach(function (f) { if (f) f(); }); }
function errorShown() { return $('hostErrBar').classList.contains('show') ? $('hostErrText').textContent : ''; }

var sent = [];
function send(o) { sent.push(o); }
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function pad(n) { return String(n); }
function padWidth() { return 3; }
function prizeLabel() { return 'Meat Tray'; }
function stopSpin() {}
function clearTimers() { intervals = []; }
function disarmRedraw() {}
function logResults() {}
function advancePrize() {}
function drawBtnNext() {}
function drawBtnIdle() {}
function drawBtnBusy() {}
function drawBtnWaiting() {}
function sendDrawing() {}
function sendIdle() {}
function startLocalSpin() {}
function scheduleIdleBroadcast() {}
function finalizeSimple() {}
function esc(s) { return String(s); }
function secsToClock(s) { return String(s); }
var apiCalls = [];
function apiPost(path, body) { apiCalls.push(path); return new Promise(function () {}); }
function ensureRaffleGame() { apiCalls.push('ensure'); return new Promise(function () {}); }
function drawBody() { return {}; }
function drawingPrize() { return 'Meat Tray'; }
function addPrize() {}
function stopCountdown() { intervals = []; }
// the new look's card (9 Nov 2026): the step, the summary lines and the words are the page's own concern here
function syncStep() {} function renderAdvSum() {} function renderSkipLine() {}
function lower(p) { return String(p); } var _redrawArm = null;
var REDRAW_NOTICE_MS = 3000, CLAIM_CELEBRATE_MS = 30000, _celebrateUntil = 0, _suppressIdle = false;

var G = { min: 1, max: 150, drawn: {}, jackOn: false, jackAmt: 0, allowRedraw: true, time: 180,
          prizes: ['Meat Tray'], prizeIdx: 0, round: null, busy: false, results: [], gameId: 'g1',
          drawLength: 4, code: '' };

try { eval(liftVar(/var _errKey="";/, 'the error key')); } catch (e) { print('  (no error key in this page)'); }
eval(lift('hostError')); eval(lift('clearHostError'));
eval(lift('liquorBlocked'));   // SA/NT (22 Oct 2026): a liquor prize is refused where the state says so
try { eval(lift('clearHostErrorIf')); } catch (e) { print('  (no clearHostErrorIf in this page: ' + e.message + ')'); }
try { eval(liftVar(/var CLAIM_DEFAULT_S=\d+;/, 'CLAIM_DEFAULT_S')); } catch (e) {}
try { eval(lift('skipsProblem')); } catch (e) {}
eval(lift('parseSkips')); eval(lift('readInputs')); eval(lift('validRange'));
eval(lift('drawnCount')); eval(lift('skippedCount')); eval(lift('remainingCount'));
// the cash jackpot warning (15 Oct 2026): renderRange and startDraw call renderJackWarn
eval(lift('jackpotWarning')); eval(lift('stateLimit')); eval(lift('renderJackWarn'));
eval(lift('renderRange')); eval(lift('startDraw')); eval(lift('revealServer'));
eval(lift('updateCd')); eval(lift('ticketWords')); eval(lift('redrawLabelIdle'));
eval(lift('pickOrder')); eval(lift('prizeNext')); eval(lift('announcing')); eval(lift('sendAnnounce')); var ANNOUNCE_MS = 4000;   // Dean's two choices (9 Nov 2026)
eval(lift('onClaim')); eval(lift('onRedraw')); eval(lift('money'));

function form(o) {
  $('rfPrize').value = ''; $('rfStart').value = '1'; $('rfEnd').value = '150'; $('rfTime').value = '180';
  $('rfJackOn').checked = false; $('rfJackAmt').value = '500'; $('rfAllowRedraw').checked = true; $('rfSkip').value = '';
  for (var k in (o || {})) { if (k === 'rfJackOn' || k === 'rfAllowRedraw') $(k).checked = o[k]; else $(k).value = o[k]; }
}
function reset() { clearHostError(); G.round = null; G.busy = false; G.drawn = {}; intervals = []; sent = []; apiCalls = []; }

/* ================= 1. an error comes down when it stops being true ================= */
section('1. Error bars clear themselves when their condition ends, and only then');

reset(); form();
revealServer({ seq: 1, tickets: [87], allow_redraw: true, time_to_present: 30 });
tick(31);
check('the claim clock runs out and says so', /Time is up on ticket 87/.test(errorShown()), errorShown());
onClaim();
check('Claim takes "Time is up on ticket 87" down', errorShown() === '', errorShown());

reset(); form();
revealServer({ seq: 2, tickets: [88], allow_redraw: true, time_to_present: 30 });
tick(31);
G.busy = false;
onRedraw(false);
check('a redraw takes "Time is up" down too', errorShown() === '', errorShown());

reset(); form();
hostError('The game server did not answer. Check the venue wifi and try again.');
revealServer({ seq: 3, tickets: [89], allow_redraw: true, time_to_present: 30 });
onClaim();
check('but Claim does NOT take down an unrelated error', /did not answer/.test(errorShown()), errorShown());

reset(); form({ rfStart: '200', rfEnd: '100' });
startDraw();
check('a backwards range refuses the draw with a message', /valid ticket range/.test(errorShown()), errorShown());
form({ rfStart: '1', rfEnd: '150' });
renderRange();
check('fixing the range takes "Enter a valid ticket range" down', errorShown() === '', errorShown());

reset(); form();
hostError('Could not record the claim. Try again.');
renderRange();
check('typing in the form does NOT take down an unrelated error', /Could not record/.test(errorShown()), errorShown());

/* The "Picked up where you left off" notice: the restore path hands revealServer time 0 and
   recovered:true, and the notice belongs on the card, not in the red bar. */
reset(); form();
var restoreSrc = lift('restoreRaffle');
check('the restore path does not put "Picked up where you left off" in the error bar',
      !/hostError\(\s*"Picked up/.test(restoreSrc), (/hostError\(\s*"Picked up[^)]*\)/.exec(restoreSrc) || [''])[0]);
revealServer({ seq: 4, tickets: [90], allow_redraw: true, time_to_present: 0, recovered: true });
tick(5);
check('a recovered round says so on the winner card', /Picked up where you left off/.test($('wcCd').textContent), $('wcCd').textContent);
check('and a recovered round does not throw "Time is up" into the bar a second later', errorShown() === '', errorShown());

/* ================= 3. the unsold box reads what hosts type, and says what it cannot ================= */
section('3. The unsold tickets box never drops a ticket in silence');

function skips(txt, min, max) { $('rfSkip').value = txt; G.min = min || 1; G.max = max || 1000; return parseSkips(); }
function has(sk, a, b) { for (var i = 0; i < sk.length; i++) if (sk[i][0] <= a && sk[i][1] >= b) return true; return false; }

var sk = skips('240 - 320 and 400');
check('"240 - 320 and 400" takes out 240 to 320 AND 400', has(sk, 240, 320) && has(sk, 400, 400), sk);
sk = skips('#512');
check('"#512" takes out 512', has(sk, 512, 512), sk);
sk = skips('240-320; 512; 600-610');
check('semicolons separate blocks', has(sk, 240, 320) && has(sk, 512, 512) && has(sk, 600, 610), sk);
sk = skips('240-320\n512\n600 to 610');
check('new lines separate blocks', has(sk, 240, 320) && has(sk, 512, 512) && has(sk, 600, 610), sk);
sk = skips('320-240');
check('a block typed backwards still counts', has(sk, 240, 320), sk);

var many = []; for (var i = 0; i < 25; i++) many.push(10 + i * 10);
sk = skips(many.join(', '));
var all25 = true; for (i = 0; i < 25; i++) if (!has(sk, many[i], many[i])) all25 = false;
check('25 single unsold tickets: none is cut off by a 20-block cap', all25, sk.length + ' blocks kept');

var touching = []; for (i = 1; i <= 30; i++) touching.push(String(100 + i));
sk = skips(touching.join(', '));
check('30 tickets in a row are one block, not 30 (merging loses nothing)', sk.length === 1 && has(sk, 101, 130), sk);

/* The draw itself. An unreadable entry or more blocks than the Worker keeps must stop the draw
   with the problem named, before anything is sent to the game server. */
reset(); form({ rfSkip: '240-320, tickets fifty' , rfEnd: '500' });
startDraw();
check('an unreadable entry stops the draw', apiCalls.length === 0 && !G.busy, apiCalls);
check('and names what it could not read', /Could not read: tickets fifty/.test(errorShown()), errorShown());
form({ rfSkip: '240-320', rfEnd: '500' });
renderRange();
check('fixing the box takes that message down', errorShown() === '', errorShown());

/* The game server keeps 200 blocks since 27 Sep 2026 (it was 20, and 25 blocks used to be refused). */
reset(); form({ rfSkip: many.join(', '), rfEnd: '500' });
startDraw();
check('25 separate unsold blocks now draw (under the server\'s 200)', apiCalls.length > 0, apiCalls);
var lots = []; for (i = 0; i < 205; i++) lots.push(10 + i * 10);
reset(); form({ rfSkip: lots.join(', '), rfEnd: '3000' });
startDraw();
check('more separate blocks than the game server keeps (200) stops the draw', apiCalls.length === 0 && !G.busy, apiCalls);
check('and says how many there are and what the limit is', /205 separate blocks/.test(errorShown()) && /at most 200/.test(errorShown()), errorShown());

reset(); form({ rfSkip: '240 - 320 and #400', rfEnd: '500' });
startDraw();
check('a readable box draws as normal', apiCalls.length === 1 && G.busy === true && errorShown() === '', { calls: apiCalls, err: errorShown() });

reset(); form({ rfSkip: 'tickets fifty', rfEnd: '500' });
renderRange();
check('the range line shows the unreadable entry while the host types, before any Draw',
      /Could not read: tickets fifty/.test($('rangeLine').textContent), $('rangeLine').textContent);

/* ================= 4. the form means what it says ================= */
section('4. Time to claim and the jackpot mean exactly what the form says');

form({ rfTime: '' }); readInputs();
check('an empty Time to claim is the 180 the box shows', G.time === 180, G.time);
form({ rfTime: '0' }); readInputs();
check('0 is kept as 0 (no time limit), not replaced', G.time === 0, G.time);
form({ rfTime: '15' }); readInputs();
check('15 is 30, what the Worker stores', G.time === 30, G.time);
form({ rfTime: '240' }); readInputs();
check('240 is 240', G.time === 240, G.time);
reset(); form({ rfTime: '-5' });
startDraw();
check('a negative claim time is refused by name, not turned into 180', apiCalls.length === 0 && /Time to claim/.test(errorShown()), { calls: apiCalls, err: errorShown() });

reset(); form({ rfTime: '0' });
revealServer({ seq: 5, tickets: [91], allow_redraw: true, time_to_present: 0 });
tick(10);
check('0 seconds: no "Time is up" ten seconds after the draw', errorShown() === '', errorShown());
check('0 seconds: the card says there is no time limit', /No time limit/.test($('wcCd').textContent), $('wcCd').textContent);
check('0 seconds: the wall is told 0, which it treats as no countdown', sent.length && sent[0].t === 'winner' && sent[0].time === 0, sent[0]);

form({ rfJackOn: true, rfJackAmt: '500.50' }); readInputs();
check('a $500.50 jackpot keeps its 50 cents', G.jackAmt === 500.5 && Math.round(G.jackAmt * 100) === 50050, G.jackAmt);
check('and reads $500.50 on the wall', money(G.jackAmt) === '$500.50', money(G.jackAmt));
form({ rfJackOn: true, rfJackAmt: '1500' }); readInputs();
check('a whole-dollar jackpot still reads $1,500', money(G.jackAmt) === '$1,500', money(G.jackAmt));
reset(); form({ rfJackOn: true, rfJackAmt: '500.555' });
startDraw();
check('a jackpot with fractions of a cent is refused by name, not rounded', apiCalls.length === 0 && /dollars and cents/.test(errorShown()), { calls: apiCalls, err: errorShown() });

/* ================= 6. the channel: its own, and not while leaving ================= */
section('6. Only this page\'s own channel can say the TV link is down');

/* A fake supabase realtime client that does what supabase-js does: removeChannel makes that
   channel report CLOSED from inside the call. */
var chans = [];
var client = {
  channel: function (name) {
    var c = { name: name, cb: null, on: function () { return c; }, subscribe: function (cb) { c.cb = cb; return c; }, send: function () {} };
    chans.push(c); return c;
  },
  removeChannel: function (c) { if (c.cb) c.cb('CLOSED'); }
};
var ch = null, subscribed = false, sendQueue = [];
function flushQueue() {}
function onPair() {}
function reassertToTv() {}
function renderPresets() {} function renderPrizeList() {} function renderResults() {}
var hasOpen = H.indexOf('function openChannel(') >= 0;
if (hasOpen) eval(lift('openChannel'));
try { eval(liftVar(/var _leaving=false, _closed=false;/, 'the leaving flag')); } catch (e) { print('  (no leaving flag in this page)'); }
eval(lift('connect'));
eval(lift('reassertOnReturn'));
var _lastReassert = 0;
var pagehideSrc = /window\.addEventListener\("pagehide", function\(\)\{[\s\S]*?\n  \}\);/.exec(H);
check('the pagehide handler is there to lift', !!pagehideSrc);
var pagehide = eval('(' + pagehideSrc[0].replace(/^window\.addEventListener\("pagehide", /, '').replace(/\);$/, '') + ')');
function rawSend() {}

connect('ABCDEF');
chans[chans.length - 1].cb('SUBSCRIBED');
$('statusText').textContent = 'Connected';
check('a subscribed channel is marked up', subscribed === true);

/* the channel being replaced */
if (hasOpen) {
  openChannel('ABCDEF');
  check('replacing the channel does not report the link as down', $('statusText').textContent !== 'Reconnecting', $('statusText').textContent);
  chans[chans.length - 1].cb('SUBSCRIBED');
  chans[chans.length - 2].cb('CLOSED');   // a late word from the channel that was replaced
  check('a late CLOSED from the replaced channel does not unmark the new one', subscribed === true, subscribed);
} else {
  check('a replaced channel is let go of before it is removed (openChannel)', false, 'no openChannel in this page');
  check('a late CLOSED from the replaced channel does not unmark the new one', false, 'no openChannel in this page');
}

/* the page being left, then coming back from the back/forward cache */
$('statusText').textContent = 'Connected';
G.round = null;
pagehide();
chans[chans.length - 1].cb('CLOSED');     // the browser shuts the socket as the page goes
check('the socket closing as the page is left is not shown as "Reconnecting"', $('statusText').textContent !== 'Reconnecting', $('statusText').textContent);
check('but sends queue while it is closed, rather than going into a dead socket', subscribed === false, subscribed);
var before = chans.length;
reassertOnReturn();
check('coming back opens a fresh channel, because a CLOSED one never rejoins by itself', chans.length === before + 1, chans.length - before);
chans[chans.length - 1].cb('CHANNEL_ERROR');
check('a real drop on a live page still says Reconnecting', $('statusText').textContent === 'Reconnecting', $('statusText').textContent);

/* ================= 7. End game closes the night ================= */
section('7. End game ends the raffle AND closes the session (live play test, 24 Oct 2026)');
/* "End game" only put the ads back: the session stayed running, HQ showed the venue live and the
   next game asked about a takeover. The real endGameToAds, closeNight and newRaffleNow run here. */
var closed = [], asks = [], askAnswer = true;
var VP = { closeSession: function (id) { closed.push(id); return Promise.resolve(1); } };
window.VP = VP;
function vpAsk(q) { asks.push(q); return Promise.resolve(askAnswer); }
function clearRaffle() {}
apiPost = function (path, body) { apiCalls.push(path + (body && body.game_id ? ':' + body.game_id : '')); return Promise.resolve({}); };
try { eval(lift('newRaffleNow')); eval(lift('closeNight')); eval(lift('endGameToAds')); }
catch (e) { check('End game has a handler this test can run (endGameToAds)', false, e.message); }
if (typeof endGameToAds === 'function') {
  reset(); form(); sent = []; closed = []; asks = [];
  G.sessionId = 'sess-1'; G.gameId = 'game-1'; G.drawn = { 12: 1 }; G.prizes = ['Meat Tray'];
  endGameToAds(); drainMicrotasks();
  check('a raffle with draws asks before it is ended', asks.length === 1 && /End this raffle\?/.test(asks[0]), asks);
  check('the TV is sent back to the ads', sent.some(function (m) { return m.t === 'to_ads'; }), sent);
  check('the raffle game is ended on the server', apiCalls.indexOf('/host/game/end:game-1') >= 0, apiCalls);
  check('and the session is CLOSED, so HQ no longer shows the venue live', closed.length === 1 && closed[0] === 'sess-1', closed);
  check('the console lets go of the session and the game, so the next draw starts fresh', G.sessionId === '' && G.gameId === '', { s: G.sessionId, g: G.gameId });
  reset(); form(); sent = []; closed = []; asks = []; askAnswer = false; apiCalls = [];
  G.sessionId = 'sess-2'; G.gameId = 'game-2'; G.drawn = { 5: 1 };
  endGameToAds(); drainMicrotasks();
  check('CONTROL: Cancel on that question changes nothing', closed.length === 0 && G.sessionId === 'sess-2' && G.gameId === 'game-2' && apiCalls.length === 0 && sent.length === 0, { closed: closed, calls: apiCalls });
  askAnswer = true; reset(); form(); sent = []; closed = []; asks = [];
  G.sessionId = 'sess-3'; G.gameId = ''; G.drawn = {};
  endGameToAds(); drainMicrotasks();
  check('a session opened with nothing drawn is closed without a question', asks.length === 0 && closed.length === 1 && closed[0] === 'sess-3', { asks: asks, closed: closed });
  reset(); form(); closed = []; G.sessionId = 'sess-4'; G.gameId = 'game-4'; G.busy = true;
  endGameToAds(); drainMicrotasks();
  check('mid-draw, End game waits for the draw and says so', closed.length === 0 && G.sessionId === 'sess-4' && /Let this draw finish/.test(errorShown()), errorShown());
  G.busy = false;
}

/* ================= 8. Last week's unsold tickets are not carried over ================= */
section('8. A new raffle starts with an EMPTY unsold box, whatever the last raffle saved (28 Oct 2026)');
/* The saved raffle template carries last raffle's excluded_ranges. Pre-filled into this week's box, a
   ticket sold this week inside last week's gap could never be drawn. Since 28 Oct 2026 the template is
   read by raffleOldPrefs (the fallback while game_prefs is empty) and put on the page by applyRafflePrefs:
   both real functions run here, as VP.gamePrefs runs them. */
try { eval(lift('raffleOldPrefs')); eval(lift('applyRafflePrefs')); eval(lift('mergeSavedPrizes')); } catch (e) { check('the pre-fill has functions this test can run', false, e.message); }
if (typeof raffleOldPrefs === 'function' && typeof applyRafflePrefs === 'function') {
  reset(); form(); $('rfSkip').value = ''; G.recovered = false;
  var renderRange = function () {};
  VP = { loadSettings: function () { return Promise.resolve({ raffle_template: { range_min: 1, range_max: 400, time_to_present: 120,
         excluded_ranges: [[150, 200], [312, 312]] } }); } };
  window.VP = VP;
  var _old = null; raffleOldPrefs().then(function (p) { _old = p; applyRafflePrefs(p); }); drainMicrotasks();
  check('last raffle\'s unsold tickets are NOT put into this raffle\'s box', $('rfSkip').value === '' && _old && !('excluded_ranges' in _old), $('rfSkip').value + ' ' + JSON.stringify(_old));
  check('CONTROL: the rest of the template still fills in (range and time to claim)', String($('rfEnd').value) === '400' && String($('rfTime').value) === '120',
        { end: $('rfEnd').value, time: $('rfTime').value });
}

/* ================= 9. Not here waits for the claim clock (Dean, 6 Nov 2026) ================= */
section('9. "Not here, draw again" is locked while the claim clock runs, and opens at zero');
/* A host who taps Not here with 2:41 left voids a ticket whose holder is still walking up. The members draw
   already waited; the raffle now does too. Run on the page's own revealServer, updateCd and tapRedraw. */
eval(lift('tapRedraw'));
var REDRAW_ARM_MS = 4000, redrew = 0;
var onRedrawReal = onRedraw; onRedraw = function () { redrew++; };
reset(); form(); readInputs();
revealServer({ seq: 9, tickets: [20], allow_redraw: true, time_to_present: 180 });
check('a fresh winner with 3 minutes to claim: Not here is locked', G.round && G.round.locked === true, G.round && G.round.locked);
tapRedraw(); tapRedraw();
check('tapping it (twice, as the arm needs) while locked voids nothing', redrew === 0 && G.round && !G.round.resolved, redrew);
check('the button counts down beside its words', /^Not here, draw again \(in /.test(redrawLabelIdle()), redrawLabelIdle());
tick(181);
check('at zero it opens', G.round && G.round.locked === false, G.round && G.round.locked);
tapRedraw(); tapRedraw();
check('CONTROL: once open, two taps draw again as before', redrew === 1, redrew);
reset(); form(); readInputs();
revealServer({ seq: 10, tickets: [21], allow_redraw: true, time_to_present: 0, recovered: true });
check('a round picked up after a reload (no clock) is open from the start: the host decides', G.round && G.round.locked === false, G.round && G.round.locked);
onRedraw = onRedrawReal;

/* ================= 10. Two choices, off unless switched on (Dean, 9 Nov 2026) ================= */
section('10. "Let me choose which prize to draw next" and "Show each prize on the TV before its draw"');
if (typeof saveRaffle !== 'function') { var saveRaffle = function () {}; }
var raffleName = function () { return ''; };
reset(); form(); readInputs();
G.prizes = ['Meat tray', 'Seafood platter', 'Fruit box']; G.prizeIdx = 0;
$('rfPickOrder').checked = false; prizeNext(2);
check('off (every venue that has not switched it on): the prizes stay in the order on the list', G.prizes.join('|') === 'Meat tray|Seafood platter|Fruit box', G.prizes);
$('rfPickOrder').checked = true; prizeNext(2);
check('on: "Draw this next" moves that prize to the front of what is left', G.prizes.join('|') === 'Fruit box|Meat tray|Seafood platter', G.prizes);
G.prizeIdx = 1; prizeNext(0);
check('a prize already drawn is never moved back', G.prizes.join('|') === 'Fruit box|Meat tray|Seafood platter', G.prizes);
G.prizeIdx = 0; $('rfPickOrder').checked = false;
var drew = []; var sendDrawingReal = sendDrawing; sendDrawing = function () { drew.push(sent.length); };
var ensureReal = ensureRaffleGame; ensureRaffleGame = function () { return new Promise(function () {}); };
reset(); form(); readInputs(); G.prizes = ['Meat tray']; G.prizeIdx = 0; timers = [];
$('rfAnnounce').checked = false; startDraw();
check('off: the spin starts at once and nothing is shown first, as always', drew.length === 1 && !sent.some(function (m) { return m.t === 'idle'; }), { drew: drew, sent: sent });
reset(); form(); readInputs(); G.prizes = ['Meat tray']; G.prizeIdx = 0; timers = []; drew = [];
$('rfAnnounce').checked = true; startDraw();
var card = sent.filter(function (m) { return m.t === 'idle'; })[0];
check('on: the TV is shown the prize first ("Next prize", the card it already knows)', !!card && card.next === true && drew.length === 0, sent);
timers.forEach(function (t) { t(); });
check('and the spin starts after it', drew.length === 1, drew);
sendDrawing = sendDrawingReal; ensureRaffleGame = ensureReal; $('rfAnnounce').checked = false; G.busy = false;

/* ================= 11. The draw order and where tickets are sold (Dean, 9 Nov 2026) ================= */
section('11. Twenty prizes put in order before the draw; "Get your tickets from the bar"');
eval(lift('moveP'));
reset(); form(); readInputs();
G.prizes = []; for (var pi = 1; pi <= 20; pi++) G.prizes.push('Prize ' + pi); G.prizeIdx = 0;
moveP(19, -1); moveP(18, -1);
check('a prize moves up one place at a time (20 prizes)', G.prizes[17] === 'Prize 20' && G.prizes[18] === 'Prize 18' && G.prizes[19] === 'Prize 19', G.prizes.slice(16));
moveP(0, 1);
check('and down', G.prizes[0] === 'Prize 2' && G.prizes[1] === 'Prize 1', G.prizes.slice(0, 3));
moveP(0, -1); moveP(19, 1);
check('nothing moves past the top or the bottom', G.prizes[0] === 'Prize 2' && G.prizes[19] === 'Prize 19' && G.prizes.length === 20, [G.prizes[0], G.prizes[19]]);
G.prizeIdx = 2; moveP(2, -1); moveP(1, 1);
check('a prize already drawn never moves, and nothing moves into its place', G.prizes[0] === 'Prize 2' && G.prizes[1] === 'Prize 1' && G.prizes[2] === 'Prize 3', G.prizes.slice(0, 3));
G.prizeIdx = 0;
eval(lift('sendIdle'));
var celebrating = function () { return false; };
sent = []; G.ticketsFrom = ''; sendIdle();
check('nothing chosen: the TV is told nothing about where tickets are sold (the card every venue has today)', sent.length === 1 && !('from' in sent[0]), sent);
sent = []; G.ticketsFrom = 'bar'; sendIdle();
check('"The bar" chosen: the TV is sent the key, not words', sent.length === 1 && sent[0].from === 'bar', sent);
G.ticketsFrom = '';
var SCR = readFile('venueplay/app/raffle/screen.html');
var tf = /var TICKETS_FROM=\{[^}]*\};/.exec(SCR), line = /    if\(m\.t==="idle"\)\{ S\.ticketsFrom=[^\n]*?; \}/.exec(SCR);   // the statement, without its comment
check('the TV has its own words for each key, and the line that reads them', !!tf && !!line);
if (tf && line) {
  var tvSays = new Function('m', 'var S={};' + tf[0] + '\n' + line[0] + '\nreturn S.ticketsFrom;');
  check('the TV says "from the host", "at the front of the room", "at the entrance", "from the bar", "from our ticket sellers"', tvSays({ t: 'idle', from: 'bar' }) === 'from the bar' && tvSays({ t: 'idle', from: 'host' }) === 'from the host' &&
        tvSays({ t: 'idle', from: 'front' }) === 'at the front of the room' && tvSays({ t: 'idle', from: 'entrance' }) === 'at the entrance' && tvSays({ t: 'idle', from: 'sellers' }) === 'from our ticket sellers');
  var HOSTP = readFile('venueplay/app/raffle/host.html'), keys = (HOSTP.match(/data-from="([a-z]+)"/g) || []).map(function (x) { return x.slice(11, -1); });
  check('every choice on the console has the TV\'s own words (Dean, 9 Nov 2026: five places)', keys.join(',') === 'host,front,entrance,bar,sellers' && keys.every(function (k) { return !!tvSays({ t: 'idle', from: k }); }), keys);
  check('anything else, or nothing, says nothing (never the message\'s own text on the wall)', tvSays({ t: 'idle', from: '<b>free beer</b>' }) === '' && tvSays({ t: 'idle' }) === '' && tvSays({ t: 'idle', from: 'toString' }) === '', tvSays({ t: 'idle', from: '<b>x</b>' }));
}

drainMicrotasks();
print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
