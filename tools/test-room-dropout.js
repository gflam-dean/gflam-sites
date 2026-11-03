/* A PHONE BACK FROM A DROPOUT IS BACK IN THE GAME, NEVER ON "WAITING FOR THE HOST" (job list row 60).

   Dean's live test night, 1 Nov 2026, Test Alpha on the room server (?roomserver=1): his iPhone came
   back from flight mode on "Waiting for the host" and got nothing more until it was reloaded. The fix
   that day (a77e3edb) covered a phone that SAYS it went offline. This plays every way a phone drops,
   on the REAL bingo console and the REAL phone page, each with the REAL vp-room.js, against the REAL
   room server class and Worker routes (tools/rig-bingo-room.js + tools/rig-bingo-roomserver.js), on a
   virtual clock, so a minute of flight mode costs nothing.

   "Quiet" below means the signal goes and the browser says NOTHING (navigator.onLine stays true, no
   offline or online event): iOS at times, and a Wi-Fi to 4G hand-off always. Played before the fix,
   scenes C, D and F fail: C and D leave the phone on Supabase alone, its card frozen and the status
   line on "Waiting for the host" for 35 to 45 s after the signal is back, and then move the WHOLE
   VENUE off the room for six hours; F leaves it saying Connected, deaf, for good.

     A  quiet drop, 25 s, the socket left half open (the iPhone way)
     B  quiet drop, 60 s, half open
     C  quiet drop, 60 s, the socket closed (Wi-Fi gone, no event): the fault, reproduced
     D  quiet drop, 35 s, closed
     E  a Wi-Fi to 4G hand-off: socket closed, 3 s with no line, no event
     F  a quiet drop in the first seconds of a phone's night, before its socket has heard a single pong
     G  the app backgrounded for 90 s (screen locked), the socket dead underneath, no network event
     H  flight mode with the events, 60 s (the 1 Nov fix, still holding)
     I  no line at all for longer than a phone will wait (UNREACHABLE_MS): it goes to Supabase, and
        the venue follows within seconds of the line coming back, not 35 to 45 s
     J  a page reloaded mid-game (iOS throwing a backgrounded tab away): its ticket comes back, marked

   Every scene judges the phone the way a punter would: the card on screen (vCard), every ball called
   while it was away marked as called, the status line saying Connected, the next ball arriving, and
   the venue still in the room (one phone's bad signal never moves everyone).

   Run from the repo root:     jsc tools/test-room-dropout.js
   The BEFORE picture:         jsc tools/test-room-dropout.js -- <some other vp-room.js>
                               (prints every check; the pass mark is for this checkout only)
*/
var ARGS = (typeof arguments !== 'undefined' && arguments) ? arguments : [];
var VPROOM_FILE = ARGS[0] || '';
load('tools/rig-bingo-room.js');
load('tools/rig-bingo-roomserver.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function statusOf(ph) { return ph.$('statusText').textContent; }
function live(ph) { return socketsOf('phone:' + ph.name).filter(function (w) { return !w.dead; }); }
/* The signal goes. quiet: nothing tells the page. close: the socket is told it closed (Wi-Fi gone);
   otherwise it is left half open, the browser calling it open and nothing passing either way. */
function signalGone(ph, how) {
  if (how.events) { ph.sb.navigator.onLine = false; (ph.dom.window._on.offline || []).forEach(function (f) { f(); }); }
  ph.sb.netDown = true;
  socketsOf('phone:' + ph.name).forEach(function (w) { if (how.close) dropSocket(w); else w.dead = true; });
}
function signalBack(ph, how) {
  ph.sb.netDown = false;
  if (how.events) { ph.sb.navigator.onLine = true; (ph.dom.window._on.online || []).forEach(function (f) { f(); }); }
}
async function venueStillInRoom() {
  var r = await handleRoomPresence(new Request('https://game.venueplay.com.au/room/presence?room=vp-' + CODE), ENV, wjson);
  return r.status === 200 && socketsOf('host').length === 1 && road(HOST) === 'room';
}
var HOST = null;
/* One night: a console and a phone in the room, a game on, `played` seconds of balls before the drop. */
async function night(played) {
  freshWorld(); SOCKETS = []; NEXT_ROOM_SRC = VPROOM_NEW;
  HOST = bootHost(); await advance(300);
  var ann = bootPhone('Ann'); await advance(300);
  await startGame(HOST, ann);
  for (var t = 0; t < played; t += 5) { call(HOST); await advance(5000); }
  return ann;
}
/* The drop itself, with the host calling a ball every 3 s through it. Returns the balls it missed. */
async function drop(ann, secs, how) {
  var away = [];
  signalGone(ann, how);
  for (var t = 0; t < secs; t += 3) { away.push(call(HOST)); await advance(3000); }
  check('control: none of the ' + away.length + ' balls called while it was away reached it', away.every(function (n) { return !heardBall(ann, n); }));
  signalBack(ann, how);
  return away;
}
/* How a punter judges it, `within` seconds after the signal is back. */
async function judge(label, ann, away, within) {
  var at = -1;
  for (var s = 1; s <= within; s++) {
    await advance(1000);
    if (at < 0 && viewOf(ann) === 'vCard' && dealt(ann) && away.every(function (n) { return heardBall(ann, n); }) && statusOf(ann) === 'Connected') at = s;
  }
  var missing = away.filter(function (n) { return !heardBall(ann, n); });
  print('       (' + label + ': ' + (at < 0 ? 'NOT back within ' + within + ' s' : 'back on its card, caught up, ' + at + ' s after the signal') + ')');
  check(label + ': within ' + within + ' s it shows its card with every missed ball marked as called, and says Connected',
        at > 0, { view: viewOf(ann), status: statusOf(ann), missing: missing.length + ' of ' + away.length, road: road(ann) });
  check(label + ': never "Waiting for the host" once it is back', statusOf(ann) !== 'Waiting for the host' && viewOf(ann) !== 'vWait', statusOf(ann));
  var next = call(HOST); await advance(500);
  check(label + ': and the next ball reaches it', heardBall(ann, next), road(ann));
  return at;
}

(async function () {
  print('A. QUIET DROP, 25 s, HALF OPEN (the iPhone way, no event)');
  var ann = await night(30);
  var away = await drop(ann, 25, {});
  await judge('A', ann, away, 6);
  check('A: back in the room on a new socket', live(ann).length === 1 && road(ann) === 'room', road(ann));
  check('A: and the venue never moved', await venueStillInRoom());

  print('\nB. QUIET DROP, 60 s, HALF OPEN');
  ann = await night(30);
  away = await drop(ann, 60, {});
  await judge('B', ann, away, 6);
  check('B: back in the room, not on Supabase alone', live(ann).length === 1 && road(ann) === 'room', road(ann));
  check('B: and the venue never moved', await venueStillInRoom());

  print('\nC. QUIET DROP, 60 s, THE SOCKET CLOSED (Wi-Fi gone, no event): the 1 Nov fault');
  ann = await night(30);
  away = await drop(ann, 60, { close: true });
  await judge('C', ann, away, 5);
  check('C: back in the room, not on Supabase alone', live(ann).length === 1 && road(ann) === 'room', road(ann));
  check('C: and one phone\'s signal did not move the venue off the room', await venueStillInRoom());

  print('\nD. QUIET DROP, 35 s, CLOSED');
  ann = await night(30);
  away = await drop(ann, 35, { close: true });
  await judge('D', ann, away, 5);
  check('D: back in the room', road(ann) === 'room' && await venueStillInRoom(), road(ann));

  print('\nE. A WI-FI TO 4G HAND-OFF: closed, 3 s with no line, no event');
  ann = await night(30);
  away = await drop(ann, 3, { close: true });
  await judge('E', ann, away, 5);
  check('E: still in the room', road(ann) === 'room' && await venueStillInRoom(), road(ann));

  print('\nF. A QUIET DROP BEFORE THE PHONE\'S SOCKET HAS HEARD ONE PONG');
  ann = await night(0);
  away = await drop(ann, 25, {});
  await judge('F', ann, away, 15);
  check('F: back in the room', road(ann) === 'room' && live(ann).length === 1 && await venueStillInRoom(), road(ann));

  print('\nG. THE APP BACKGROUNDED FOR 90 s, THE SOCKET DEAD UNDERNEATH, NO NETWORK EVENT');
  ann = await night(30);
  ann.dom.document.visibilityState = 'hidden'; (ann.dom.document._on.visibilitychange || []).forEach(function (f) { f(); });
  away = await drop(ann, 90, {});
  ann.dom.document.visibilityState = 'visible'; (ann.dom.document._on.visibilitychange || []).forEach(function (f) { f(); });
  await judge('G', ann, away, 6);
  check('G: back in the room', road(ann) === 'room' && await venueStillInRoom(), road(ann));

  print('\nH. FLIGHT MODE WITH THE EVENTS, 60 s (the 1 Nov fix still holds)');
  ann = await night(30);
  away = await drop(ann, 60, { events: true });
  await judge('H', ann, away, 4);
  check('H: back in the room', road(ann) === 'room' && await venueStillInRoom(), road(ann));

  print('\nI. NO LINE AT ALL FOR LONGER THAN A PHONE WAITS (UNREACHABLE_MS): it goes, and the venue follows fast');
  ann = await night(30);
  away = await drop(ann, 190, { close: true });   // it gives up about 150 s in; the line is back 40 s later
  check('I: past the wait it went to Supabase (a Worker down for minutes must not strand it in a dead room)', road(ann) === 'supabase', road(ann));
  await judge('I', ann, away, 8);
  check('I: and the console came across to meet it', road(HOST) === 'supabase', road(HOST));

  print('\nJ. THE PAGE IS RELOADED MID-GAME (iOS threw the backgrounded tab away)');
  ann = await night(30);
  var marked = ann.P.called.slice(0, 2);
  ann.P.cards.forEach(function (c) { marked.forEach(function (n) { c.daubs[n] = true; }); });
  var store = ann.dom.localStorage._s;   // the marks are saved as they are made (saveDaubs); written here the way a tap writes them
  store['vp-daubs-' + CODE] = JSON.stringify((function () { var o = {}; ann.P.cards.forEach(function (c) { o[c.cardNo] = c.daubs; }); return o; })());
  var cardNos = ann.P.cards.map(function (c) { return c.cardNo; });
  ann.sb.setTimeout = ann.sb.setInterval = function () { return 0; };
  socketsOf('phone:Ann').forEach(function (w) { w.close(); });
  away = [];
  for (var k = 0; k < 4; k++) { away.push(call(HOST)); await advance(3000); }
  var dom = makeDom('?room=' + CODE, store);
  var sb = baseSandbox(dom, 'phone:Ann');
  ann = runPage(inlineScript('venueplay/play.html'), sb, ['P', 'onMsg', 'pressBingo', 'join', 'route', 'leaveGame', 'onChannelStatus']);
  ann.dom = dom; ann.sb = sb; ann.$ = function (id) { return dom.document.getElementById(id); }; ann.name = 'Ann';
  await judge('J', ann, away, 5);
  check('J: the same ticket, not a new one', JSON.stringify(ann.P.cards.map(function (c) { return c.cardNo; })) === JSON.stringify(cardNos), ann.P.cards.map(function (c) { return c.cardNo; }));
  check('J: with the marks the punter had made', ann.P.cards.length > 0 && marked.every(function (n) { return ann.P.cards.some(function (c) { return c.daubs[n]; }); }), ann.P.cards.map(function (c) { return Object.keys(c.daubs); }));
  check('J: back in the room', road(ann) === 'room' && await venueStillInRoom(), road(ann));

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (VPROOM_FILE) { print('(BEFORE picture, ' + VPROOM_FILE + ': not judged)'); return; }
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
