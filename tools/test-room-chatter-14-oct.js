/* CHATTER AND HOLDS, FOUND BY PLAYING, 14 OCT 2026.

   Bingo: one forged TV hello made 36 broadcasts and every idle minute 74, growing with the square
   of the room, because the 30s heartbeat doubled as the roll call. Measured after the fix: 3 and 4.
   PartyPlay: the first guest's vote wiped every other phone's vote screen, and the telly's caption
   wiped the prize-draw and heads-or-tails results off the phones that won them.
   Each is RUN from the shipped file where it can be.

   Run: jsc tools/test-room-chatter-14-oct.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 2000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var BINGO = find('venueplay/play.html');
var CONSOLE = find('venueplay/app/index.html');
var TV = find('venueplay/tv.html');
var PPLAY = find('partyplay/play.html');
var PRUN = find('partyplay/run.html');

print('\n== bingo: the heartbeat is not a roll call ==');
ok('phones re-join on rollcall only, never on host_here', /if\(m\.t==="rollcall"\)\{\s*\n/.test(BINGO) && !/m\.t==="rollcall" \|\| m\.t==="host_here"/.test(BINGO));
(function () {
  var sent = [], now = 100000;
  var Date = { now: function () { return now; } };
  var G = { status: 'running', claims: [] };
  function $() { return { classList: { add: function () {} }, textContent: '', innerHTML: '' }; }
  function send(m) { sent.push(m.t); }
  function sendState() { sent.push('state'); }
  function sendClaimPending() {}
  var _lastHelloReplay = 0;
  eval(lift(CONSOLE, 'tvHere', 'app/index.html'));
  for (var i = 0; i < 5; i++) { tvHere({ hello: true }); now += 200; }
  ok('five TV hellos in a second get one answer, not five', sent.join(',') === 'host_here,mode,state', sent.join(','));
  now += 3000; tvHere({ hello: true });
  ok('a hello three seconds later is answered again', sent.length === 6, sent.join(','));
})();
(function () {
  var i = TV.indexOf('if(HOST_TYPES[m.t]){ markHostConnected();');
  ok('the TV still answers host traffic in one place', i > 0);
  var line = TV.slice(i, TV.indexOf('\n', i));
  var said = 0, now = 100000;
  var Date = { now: function () { return now; } };
  var lastTvHereAt = 0, HOST_TYPES = { host_here: 1, state: 1, ball: 1 };
  function markHostConnected() {} function noteHostAlive() {} function tvSend() { said++; }
  var f = new Function('m', 'Date', 'HOST_TYPES', 'markHostConnected', 'noteHostAlive', 'tvSend', 'box',
    'var lastTvHereAt = box.v; ' + line + ' box.v = lastTvHereAt;');
  var box = { v: 0 };
  for (var k = 0; k < 10; k++) { f({ t: 'state' }, Date, HOST_TYPES, markHostConnected, noteHostAlive, tvSend, box); now += 500; }
  ok('ten host messages in five seconds: the TV says "here" once', said === 1, 'said ' + said);
  f({ t: 'host_here' }, Date, HOST_TYPES, markHostConnected, noteHostAlive, tvSend, box);
  ok('a console arriving (host_here) is answered at once', said === 2, 'said ' + said);
})();
ok('a console still in setup calls no roll call on connect',
   (CONSOLE.match(/if\(gameOpenHere\(\)\) send\(\{ t:"rollcall" \}\)/g) || []).length === 2 && !/\n\s*send\(\{ t:"rollcall" \}\);/.test(CONSOLE));
ok('and sends no state when a phone joins it', /if\(gameOpenHere\(\)\) sendState\(\);/.test(CONSOLE));

print('\n== partyplay: a guest\'s vote is not the host\'s prompt ==');
ok('guests send truthpick', /_ppSend\(\{ t:"truthpick", name:sv\.nickname/.test(PPLAY) && !/_ppSend\(\{ t:"truthvote"/.test(PPLAY));
ok('a truthvote with no lines is never a prompt on a phone', /if\(m\.t === "truthvote" && Array\.isArray\(m\.lines\) && m\.lines\.length\)\{/.test(PPLAY));
ok('the host counts truthpick (and an old phone\'s line-less truthvote)', /\(m\.t==="truthpick" \|\| \(m\.t==="truthvote" && !m\.lines\)\)/.test(PRUN));

print('\n== partyplay: a result on a phone is held against the telly\'s caption ==');
(function () {
  var i = PPLAY.indexOf('  function onMsg(m){');
  ok('onMsg is where it was', i > 0);
  /* 15 Oct: the hold is now the caption's TEXT, so it holds that one caption and lets the next game's
     opening caption through (partyplay-backend/lib/pp-realtime-auth.test.js runs it). */
  ok('a draw holds the screen', /if\(m\.t === "draw"\)\{[\s\S]{0,200}DRW = String\(m\.winner \|\| ""\);/.test(PPLAY));
  ok('a heads-or-tails ending holds it too', /if\(m\.over\)\{\s*H=null; DRW = m\.winner \? String\(m\.winner\) : "All out";/.test(PPLAY));
  ok('the caption guard honours the hold', /if\(B \|\| Q \|\| H \|\| T \|\| W \|\| V \|\| PH \|\| CH \|\| GW \|\| GM \|\| DRW\) return;/.test(PPLAY) &&
     /if\(DRW !== null && String\(m\.text == null \? "" : m\.text\) !== DRW\) DRW = null;/.test(PPLAY));
  ok('anything else from the host lets go of it', /if\(!DRW_QUIET\[m\.t\]\) DRW = null;/.test(PPLAY));
  ok('the host tells the phones the coin game is over, and who won', /headsMsg\.over = true; headsMsg\.winner = w \|\| null;/.test(PRUN));
})();

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
