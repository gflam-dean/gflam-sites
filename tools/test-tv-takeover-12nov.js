/* A DRAW CONSOLE TAKES THE TV ONLY ON AN ACTION, AND TELLS THE HOST WHEN THE TV IS NOT SHOWING IT.

   Live play on The Mini Bar, 12 Nov 2026 (INBOX 282.8 and 286; FINDINGS R3, R6, R7, R8, D7). Runs the real
   /app/vp-tvclaim.js (the one copy both draw consoles load) and the real /app/vp-screen-router.js (the
   router every game screen on the TV runs) on a virtual clock. The pages that wire them (raffle and members
   consoles, tv.html, the bingo console, the phone) are played end to end in
   tools/tv-takeover-12nov-in-chrome.test.py.

   Run:  jsc tools/test-tv-takeover-12nov.js
*/
var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

var NOW = 1e12, timers = [];
Date.now = function () { return NOW; };
var setTimeout = function (fn, ms) { timers.push({ at: NOW + (ms || 0), fn: fn }); return timers.length; };
var clearTimeout = function () {};
function advance(ms) {
  var end = NOW + ms;
  for (;;) {
    timers.sort(function (a, b) { return a.at - b.at; });
    if (!timers.length || timers[0].at > end) break;
    var t = timers.shift(); NOW = t.at; t.fn();
  }
  NOW = end;
}

(new Function('setTimeout', readFile('venueplay/app/vp-tvclaim.js'))).call(globalThis, setTimeout);
var C = globalThis.VPTvClaim;
check('vp-tvclaim.js loaded', !!(C && C.make));

var sent = [], liveRound = false;
function console_(game) {
  sent = [];
  return C.make({ game: game || 'raffle', send: function (m) { sent.push(m); }, now: function () { return NOW; },
                  setTimeout: setTimeout, live: function () { return liveRound; }, noun: 'this draw', button: 'Put the draw on the TV' });
}
function modes() { return sent.filter(function (m) { return m.t === 'mode'; }); }

print('');
print('Opening a console takes nothing');
var t = console_('raffle');
check('a console nobody has drawn from is not on air', t.onAir() === false);
t.heard({ t: 'tv_here', hello: true, showing: 'trivia' });
check('a TV saying hello (mid-quiz) does not make it claim anything', modes().length === 0, sent);
check('and it says nothing on the console: there is nothing to fix', t.line() === null, t.line());
advance(60000);
check('a minute later, still nothing sent and nothing said', modes().length === 0 && t.line() === null, { sent: sent, line: t.line() });

print('');
print('Draw takes the TV and waits for it');
var ran = [];
t.heard({ t: 'tv_here', showing: 'bingo' });
t.whenShowing(function (up) { ran.push(up); });
var m1 = modes()[0] || {};
check('Draw sends ONE claim for the raffle', modes().length === 1 && m1.mode === 'raffle' && m1.claim === 1, sent);
check('a plain claim, not a force: a game genuinely being played keeps the wall', !m1.force, m1);
check('the console is on air from the tap', t.onAir() === true);
check('the draw waits for the raffle screen to be up', ran.length === 0, ran);
check('and the host is not told anything while the TV is given its moment', t.line() === null, t.line());
advance(1500);
t.heard({ t: 'tv_here', hello: true, showing: 'raffle' });
check('the raffle screen says it is up: the draw starts, once, knowing it is up', ran.length === 1 && ran[0] === true, ran);
advance(10000);
check('and the wait running out later does not start it a second time', ran.length === 1, ran);
check('nothing to tell the host while the TV shows the draw', t.line() === null, t.line());

print('');
print('The TV is not showing this draw: the host is told why, and can fix it');
t = console_('raffle'); ran = [];
t.heard({ t: 'tv_here', showing: 'bingo' });
t.whenShowing(function (up) { ran.push(up); });
advance(C.WAIT_MS + 10);
check('the TV never came over: the draw still goes ahead after a few seconds', ran.length === 1 && ran[0] === false, ran);
check('the wait is a few seconds, not a stall', C.WAIT_MS <= 8000, C.WAIT_MS);
var l = t.line() || {};
check('the console says the TV is not showing this draw', /^The TV is not showing this draw\./.test(l.text || ''), l);
check('and why: bingo is still on it', /Bingo is still on it\./.test(l.text || ''), l);
check('with a button to take it', l.button === 'Put the draw on the TV', l);
check('the line has no em dash in it', !/—/.test(l.text || ''), l.text);
sent = [];
t.claim(true);
check('the button forces it: the TV obeys whatever is on', modes().length === 1 && modes()[0].force === 1 && modes()[0].claim === 1 && modes()[0].mode === 'raffle', sent);
t.heard({ t: 'tv_here', showing: 'raffle' });
check('once the raffle is up the line goes', t.line() === null, t.line());
advance(C.FRESH_MS + 1000);
check('a "showing" nobody has repeated for a while is not trusted (the heartbeat asks every 30 s)', t.showing() === false);
t.heard({ t: 'tv_here', showing: 'ads' });
l = t.line() || {};
check('the TV went back to the ads: the host is told that, in those words', /It is still showing your ads\./.test(l.text || ''), l);

print('');
print('No TV at all');
t = console_('raffle'); ran = [];
t.whenShowing(function (up) { ran.push(up); });
advance(C.WAIT_MS + 10);
l = t.line() || {};
check('no TV has answered: the host is told to check it is on', /No TV has answered\./.test(l.text || ''), l);
t.whenShowing(function (up) { ran.push(up); });
check('the next draw does not wait again for a TV that is not there', ran.length === 2 && ran[1] === false, ran);
check('but it still claims, so a TV switched on now comes over', modes().length === 2, sent);

print('');
print('Leaving hands it back');
t.release();
check('End game / Finish: the console is a settings page again', t.onAir() === false && t.line() === null, { air: t.onAir(), line: t.line() });
liveRound = true;
check('a live round counts as on air (a reload mid-claim puts the winner back on the wall)', t.onAir() === true);
liveRound = false;

print('');
print('The members draw names itself');
t = console_('members');
t.whenShowing(function () {});
check('its claim is for the members screen', modes()[0] && modes()[0].mode === 'members', sent);
t.heard({ t: 'tv_here', showing: 'members' });
check('and the members screen saying it is up is what counts', t.showing() === true);

print('');
print('The quiet "Put the raffle on the TV" (the draw\'s Open lobby)');
sent = [];
t = C.make({ game: 'raffle', send: function (m) { sent.push(m); }, now: function () { return NOW; }, setTimeout: setTimeout,
             idleButton: 'Put the raffle on the TV' });
l = t.line() || {};
check('a console not on air offers the button, with no warning words', l.idle === true && l.text === '' && l.button === 'Put the raffle on the TV', l);
check('and offering it sends nothing', sent.length === 0, sent);
t.heard({ t: 'tv_here', showing: 'raffle' });
check('no button when the raffle is already on the wall', t.line() === null, t.line());

/* ---- the router on every game screen: a force is obeyed over a live game, a claim is not ---- */
var channels = [];
function makeClient() {
  return { channel: function (name) {
      var ch = { name: name, handlers: [], on: function (a, b, fn) { ch.handlers.push(fn); return ch; },
                 subscribe: function (cb) { cb('SUBSCRIBED'); return ch; }, unsubscribe: function () {} };
      channels.push(ch); return ch; },
    removeChannel: function () {} };
}
var navigatedTo = null;
var window = { location: { origin: 'https://venueplay.com.au' }, top: null, self: null };
window.top = window; window.self = window;
Object.defineProperty(window.location, 'href', { set: function (u) { navigatedTo = u; }, get: function () { return ''; } });
(new Function('window', 'setTimeout', 'clearTimeout', 'console', 'Date', readFile('venueplay/app/vp-screen-router.js')))
  .call(window, window, setTimeout, clearTimeout, { log: function () {} }, Date);
var R = globalThis.VPScreenRouter;
function liveTrivia() {
  channels.length = 0; navigatedTo = null;
  var r = R.start({ client: makeClient(), self: 'trivia', slug: 'the-pub', venueCode: function (s) { return 'C-' + s; }, busy: function () { return true; } });
  r.seen({ t: 'question' });   // a quiz mid-question
  return channels.filter(function (c) { return /raffle/.test(c.name); })[0];
}
print('');
print('A quiz being played keeps the wall, unless the host forces it');
var rc = liveTrivia();
rc.handlers.forEach(function (h) { h({ payload: { t: 'mode', mode: 'raffle', claim: 1 } }); });
check('a raffle Draw does not pull a live quiz off the wall', navigatedTo === null, navigatedTo);
rc.handlers.forEach(function (h) { h({ payload: { t: 'mode', mode: 'raffle', claim: 1, force: 1 } }); });
check('the host\'s own "Put the draw on the TV" does', !!navigatedTo && /\/app\/raffle\/screen\?venue=the-pub/.test(navigatedTo), navigatedTo);

/* ---- "First up: the meat Tray" (FINDINGS R1): the raffle console's own lower(), lifted out of the page and run ---- */
print('');
print('The prize reads as the venue typed it');
var HOST = readFile('venueplay/app/raffle/host.html');
var LM = /\n  function lower\(p\)\{[^\n]*\}\n/.exec(HOST);
check('the raffle console has its lower()', !!LM);
var lower = LM ? (new Function(LM[0] + '; return lower;'))() : function (x) { return x; };
check('"Meat Tray" (typed with two capitals) stays "Meat Tray", never "meat Tray"', lower('Meat Tray') === 'Meat Tray', lower('Meat Tray'));
check('"Bottle of VB" keeps its VB and its B', lower('Bottle of VB') === 'Bottle of VB', lower('Bottle of VB'));
check('a plain "Meat tray" reads "meat tray" mid-sentence, as before', lower('Meat tray') === 'meat tray', lower('Meat tray'));
check('"VB slab" is left alone', lower('VB slab') === 'VB slab', lower('VB slab'));

print('');
var total = PASS + FAIL;
if (FAIL) { print(PASS + ' of ' + total + ' checks passed'); throw new Error(FAIL + ' check(s) failed'); }
print('ALL ' + PASS + ' CHECKS PASSED');
