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
function El(id) { this.id = id; this.value = ''; this.checked = false; this.disabled = false; this.textContent = ''; this.innerHTML = ''; this.kids = []; this.classList = new Cls(); this.className = ''; }
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
var REDRAW_NOTICE_MS = 3000, CLAIM_CELEBRATE_MS = 30000, _celebrateUntil = 0, _suppressIdle = false;

var G = { min: 1, max: 150, drawn: {}, jackOn: false, jackAmt: 0, allowRedraw: true, time: 180,
          prizes: ['Meat Tray'], prizeIdx: 0, round: null, busy: false, results: [], gameId: 'g1',
          drawLength: 4, code: '' };

try { eval(liftVar(/var _errKey="";/, 'the error key')); } catch (e) { print('  (no error key in this page)'); }
eval(lift('hostError')); eval(lift('clearHostError'));
try { eval(lift('clearHostErrorIf')); } catch (e) { print('  (no clearHostErrorIf in this page: ' + e.message + ')'); }
try { eval(liftVar(/var CLAIM_DEFAULT_S=\d+;/, 'CLAIM_DEFAULT_S')); } catch (e) {}
try { eval(lift('skipsProblem')); } catch (e) {}
eval(lift('parseSkips')); eval(lift('readInputs')); eval(lift('validRange'));
eval(lift('drawnCount')); eval(lift('skippedCount')); eval(lift('remainingCount'));
eval(lift('renderRange')); eval(lift('startDraw')); eval(lift('revealServer'));
eval(lift('updateCd')); eval(lift('onClaim')); eval(lift('onRedraw')); eval(lift('money'));

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

reset(); form({ rfSkip: many.join(', '), rfEnd: '500' });
startDraw();
check('more separate blocks than the game server keeps (20) stops the draw', apiCalls.length === 0 && !G.busy, apiCalls);
check('and says how many there are and what the limit is', /25 separate blocks/.test(errorShown()) && /at most 20/.test(errorShown()), errorShown());

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

drainMicrotasks();
print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
