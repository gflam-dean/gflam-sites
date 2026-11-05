/* MUSICAL BINGO AND TRIVIA PHONES BACK FROM A DROPOUT, ON THE ROOM SERVER (job list row 60, 4 Nov 2026).

   The bingo half is tools/test-room-dropout.js. Musical bingo and trivia phones meet the console in the
   room once their format is flipped (ROOM_FORMATS_ON), and they hold the same vp-room.js, so a quiet
   drop (the signal gone, the browser saying nothing) hit them the same way: the phone spent its budget
   on its own dead line, went to Supabase alone, and the whole venue was moved off the room after it.
   Unlike bingo, these phones also ask the WORKER where the game is when their channel comes back
   (musical: /player/card, the card and every song played; trivia: /snapshot, the question that is on),
   so this also checks they come back to the live card or question, not "You're in, waiting".

   The REAL musical and trivia consoles, the REAL phones and TV, the REAL vp-room.js and the REAL room
   class (tools/rig-room-formats.js), a virtual clock. Each scene: a phone joins, the game runs, the
   phone's signal goes for 60 s WITHOUT any event and its socket closes (Wi-Fi gone); while it is away
   the game moves on (musical: three more songs; trivia: the next question goes up). Then the signal
   comes back and the phone must, within 5 s:
     - be on its card with every song played while it was away (musical), or on the question that is
       on now with its answer buttons (trivia), never the waiting screen,
     - be back in the room, with the venue never having moved off it, and
     - hear the console's next message there.
   And once each with a page reload in the middle of the game (iOS throwing the tab away).

   A FAILED LOOK IS LOOKED AGAIN. The phone asks the Worker once when its channel comes back; a line
   that is still settling can lose that one request, and the phone then sat on the waiting screen until
   the next song or question. Scene R: the first ask after the drop fails, and the phone still comes
   back to the game by itself.

   Run from the repo root:   jsc tools/test-room-dropout-formats.js
   The BEFORE picture:       jsc tools/test-room-dropout-formats.js -- <another vp-room.js> [<musical play.html> <trivia play.html>]
*/
var ARGS = (typeof arguments !== 'undefined' && arguments) ? arguments : [];
load('tools/rig-room-formats.js');
var BEFORE = ARGS.length > 0;
if (ARGS[0]) JS_FILES['venueplay/app/vp-room.js'] = readFile(ARGS[0]).replace('var DEFAULT_ON = false;', 'var DEFAULT_ON = true;');
if (ARGS[1]) JS_FILES['venueplay/app/musical/play.html'] = readFile(ARGS[1]);
if (ARGS[2]) JS_FILES['venueplay/app/trivia/play.html'] = readFile(ARGS[2]);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* ---- a phone's own network, which can go without saying so ---- */
var DOWN = {};                       // who -> true while that page has no line
/* The half-open socket: nothing passes either way, and nothing says closed. */
var _srvSend = ServerSocket.prototype.send;
ServerSocket.prototype.send = function (s) { if (this.peer && DOWN[this.peer.who]) return; return _srvSend.call(this, s); };
var _wsSend = BrowserWS.prototype.send;
BrowserWS.prototype.send = function (s) { if (DOWN[this.who]) { if (this.readyState !== 1) throw new Error('not open'); return; } return _wsSend.call(this, s); };
/* Supabase is no nearer with no line: a channel cannot join, and nothing goes out, until it is back. */
var _makeSupabase = makeSupabase;
makeSupabase = function (who) {
  var s = _makeSupabase(who), cc = s.createClient;
  s.createClient = function () {
    var cl = cc.apply(this, arguments), och = cl.channel;
    cl.channel = function (n, o) {
      var ch = och.call(cl, n, o), osub = ch.subscribe, osend = ch.send;
      ch.subscribe = function (cb) { (function go() { if (DOWN[who]) { fSetTimeout(go, 1000); return; } osub.call(ch, cb); })(); return ch; };
      ch.send = function (m) { if (DOWN[who]) return Promise.resolve('error'); return osend.call(ch, m); };
      return ch;
    };
    return cl;
  };
  return s;
};
function giveNetwork(page) {
  var f = page.sb.fetch, W = page.sb.WebSocket, who = page.who;
  page.sb.fetch = page.win.fetch = function (u, i) { if (DOWN[who] || page.sb.navigator.onLine === false) return Promise.reject(new TypeError('Load failed')); return f(u, i); };
  page.sb.WebSocket = page.win.WebSocket = function (u) {
    if (DOWN[who]) { var dud = { url: u, readyState: 0, send: function () { throw new Error('not open'); }, close: function () { this.readyState = 3; } };
      fSetTimeout(function () { dud.readyState = 3; if (dud.onclose) dud.onclose({ code: 1006 }); }, 5); return dud; }
    return new W(u);
  };
}
function signalGone(page) { DOWN[page.who] = true; SOCKETS.forEach(function (w) { if (w.who === page.who && w.readyState === 1) dropSocket(w); }); }
function signalBack(page) { DOWN[page.who] = false; }

var BINGO = 'vp-' + CODE_B;
var SID = '33333333-3333-4333-8333-333333333333';
var GID = { musical: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', trivia: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
var SONGS = []; for (var i = 1; i <= 30; i++) SONGS.push({ song_id: 's' + i, title: 'Song ' + i });
var CELLS = SONGS.slice(0, 25).map(function (x, k) { return k === 12 ? 0 : x; });
/* What the Worker knows, which is the truth the phone must come back to. */
var GAME = { played: 3, qseq: 1, failNext: 0 };
function workerAnswers(F) {
  WORKER_REPLY['/join'] = function () { return { token: 'tok-' + F, player_id: 'p1', snapshot: { session_id: SID, status: 'running', game: snapGame(F) } }; };
  WORKER_REPLY['/player/card'] = function () {
    if (GAME.failNext > 0) { GAME.failNext--; return { __fail: true }; }
    return { game_id: GID.musical, cells: CELLS, card_no: 7, pattern: 'line', played_songs: SONGS.slice(0, GAME.played) };
  };
  WORKER_REPLY['/snapshot'] = function () {
    if (GAME.failNext > 0) { GAME.failNext--; return { __fail: true }; }
    return { session_id: SID, status: 'running', game: snapGame(F) };
  };
  WORKER_REPLY['/player/score'] = { total: 0, rank: 0, players_count: 1 };
}
function snapGame(F) {
  if (F === 'musical') return { format: 'musical_bingo', game_id: GID.musical, pattern: 'line', prize: '$20', played_songs: SONGS.slice(0, GAME.played) };
  return { format: 'trivia', game_id: GID.trivia, phase: 'asking', question_count: 10,
           question: { qseq: GAME.qseq, qi: GAME.qseq, text: 'Question number ' + GAME.qseq, options: ['A one', 'B one', 'C one', 'D one'], ends_at: new Date(NOW + 60000).toISOString() } };
}
/* A failed Worker answer: the rig's fetch says the network ate it, for one ask. */
var _workerReply = workerReply;
workerReply = function (path, body, who) {
  var r = WORKER_REPLY[path]; if (typeof r === 'function') r = r(body, who);
  if (r && r.__fail) return Promise.reject(new TypeError('Load failed'));
  var keep = WORKER_REPLY[path]; WORKER_REPLY[path] = r;
  var out = _workerReply(path, body, who); WORKER_REPLY[path] = keep; return out;
};
function view(page, ids) { for (var k = 0; k < ids.length; k++) { var e = page.$(ids[k]); if (e && !e.classList.contains('hidden')) return ids[k]; } return ''; }
var MV = ['vNoRoom', 'vJoin', 'vWait', 'vCard', 'vWon', 'vLost'], TV_ = ['vNoRoom', 'vJoin', 'vWait', 'vQ', 'vRes', 'vFinal', 'vPR'];

async function boot(F) {
  var on = {}; on[F] = true;
  freshWorld({ formats: on }); DOWN = {}; GAME = { played: 3, qseq: 1, failNext: 0 };
  workerAnswers(F);
  var v = {};
  v.tv = bootPage('venueplay/tv.html', { who: 'tv', search: '?venue=' + SLUG });
  v.host = bootPage('venueplay/app/' + F + '/host.html', { who: 'host', host: true, exports: ['G', 'openLobby', 'send', 'gsend', 'bcast'] });
  v.screen = bootPage('venueplay/app/' + F + '/screen.html', { who: 'screen', search: '?venue=' + SLUG, hop: true, embedded: true });
  v.phone = bootPage('venueplay/app/' + F + '/play.html', { who: 'phone', search: '?room=' + CODE_B, exports: ['P', 'send', 'join'] });
  giveNetwork(v.phone);
  await advance(2000);
  if (F === 'trivia') {
    var SET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sel = v.host.$('setSel');
    sel.options = [{ value: SET, text: 'Pub classics', textContent: 'Pub classics', getAttribute: function () { return null; } }]; sel.selectedIndex = 0; sel.value = SET;
    v.host.ex.G.setId = SET;
    WORKER_REPLY['/host/game'] = { game_id: GID.trivia, question_count: 10, round_size: 10 };
  }
  try { v.host.ex.openLobby(); } catch (e) { TIMER_ERRORS.push('openLobby: ' + e); }
  await advance(3000);
  syncHost(F, v);
  v.phone.$('nameIn').value = 'Ann';
  v.phone.ex.join();
  await advance(3000);
  return v;
}
function onGame(F, v) {
  var P = v.phone.ex.P;
  if (F === 'musical') return view(v.phone, MV) === 'vCard' && !!P.cells && P.played.length === GAME.played;
  return view(v.phone, TV_) === 'vQ' && !!P.q && P.q.qseq === GAME.qseq;
}
function sawOf(F, v) {
  var P = v.phone.ex.P;
  return F === 'musical' ? { view: view(v.phone, MV), played: (P.played || []).length, want: GAME.played, road: v.phone.road(), status: v.phone.$('statusText').textContent }
                         : { view: view(v.phone, TV_), qseq: P.q && P.q.qseq, want: GAME.qseq, road: v.phone.road(), status: v.phone.$('statusText').textContent };
}
/* The game moves on while the phone is away: a song (musical) or the next question (trivia). */
function moveOn(F, v) {
  if (F === 'musical') { GAME.played++; syncHost(F, v); v.host.ex.gsend({ t: 'played', played: SONGS.slice(0, GAME.played).map(function (x) { return x.title; }), played_ids: SONGS.slice(0, GAME.played).map(function (x) { return x.song_id; }) }); }
  else { GAME.qseq++; var q = snapGame('trivia').question; v.host.ex.gsend({ t: 'question', qseq: q.qseq, qi: q.qi, qtotal: 10, text: q.text, options: q.options, endsAt: NOW + 60000, game_id: GID.trivia }); }
}
/* The console holds the same game the Worker does: running, with the songs played so far. Its own
   state message (sent to every phone that re-announces itself) must not contradict the Worker. */
function syncHost(F, v) {
  if (F !== 'musical') return;
  var G = v.host.ex.G; G.status = 'running'; G.gameId = GID.musical;
  G.playedOrder = SONGS.slice(0, GAME.played).map(function (x) { return { title: x.title, song_id: x.song_id }; });
}
async function backWithin(F, v, secs) {
  for (var s = 1; s <= secs; s++) { await advance(1000); if (onGame(F, v)) return s; }
  return -1;
}
async function inRoomStill(F) {
  var r = await handleRoomPresence(new Request(API + '/room/presence?room=' + BINGO), ENV, wjson);
  return r.status === 200 && roomSockets('host').length > 0;
}

(async function () {
  var FORMATS = ['musical', 'trivia'];
  for (var fi = 0; fi < FORMATS.length; fi++) {
    var F = FORMATS[fi], v, at, t;
    print('\n######## ' + F.toUpperCase() + ' ########');

    print('Q. ' + F + ': A QUIET 60 s DROP, THE SOCKET CLOSED, NO EVENT');
    v = await boot(F);
    check(F + ': control: the phone joined and is on the game, in the room', onGame(F, v) && roomSockets('phone').indexOf(BINGO) >= 0, sawOf(F, v));
    await advance(20000);
    signalGone(v.phone);
    for (t = 0; t < 60; t += 20) { await advance(10000); moveOn(F, v); await advance(10000); }
    check(F + ': control: while it was away the game moved on without it', !onGame(F, v), sawOf(F, v));
    signalBack(v.phone);
    at = await backWithin(F, v, 5);
    print('       (' + (at < 0 ? 'NOT back within 5 s' : 'back on the game ' + at + ' s after the signal') + ')');
    check(F + ': within 5 s it is on the game as it is NOW, never the waiting screen', at > 0, sawOf(F, v));
    check(F + ': back in the room, not on Supabase alone', roomSockets('phone').indexOf(BINGO) >= 0 && v.phone.road() === 'room', [roomSockets('phone'), v.phone.road()]);
    check(F + ': and one phone\'s signal did not move the venue off the room', await inRoomStill(F) && !handedOver(BINGO));
    moveOn(F, v); await advance(1000);
    check(F + ': and it hears the console\'s next message there', onGame(F, v), sawOf(F, v));

    print('R. ' + F + ': THE FIRST ASK AFTER THE DROP IS LOST TOO');
    v = await boot(F);
    await advance(20000);
    signalGone(v.phone);
    for (t = 0; t < 30; t += 15) { await advance(7000); moveOn(F, v); await advance(8000); }
    GAME.failNext = 1;
    signalBack(v.phone);
    at = await backWithin(F, v, 8);
    print('       (' + (at < 0 ? 'NOT back within 8 s' : 'back on the game ' + at + ' s after the signal') + ')');
    check(F + ': it asks again by itself and is on the game within 8 s, not waiting for the next ' + (F === 'musical' ? 'song' : 'question'), at > 0, sawOf(F, v));

    print('T. ' + F + ': NO LINE AT ALL FOR LONGER THAN A PHONE WAITS: IT GOES TO SUPABASE, AND THE CONSOLE FOLLOWS (F2, 6 Nov 2026)');
    /* The phone's handover has no sign in and only asks. The console, asked, listens on the old road,
       hears this phone announce itself there, and moves the venue itself, signed. */
    v = await boot(F);
    await advance(20000);
    signalGone(v.phone);
    for (t = 0; t < 200; t += 20) { await advance(10000); moveOn(F, v); await advance(10000); }
    check(F + ': control: past its wait the phone gave up on the room (nothing of it there)', roomSockets('phone').length === 0 && !handedOver(BINGO), roomSockets('phone'));
    signalBack(v.phone);
    at = await backWithin(F, v, 8);
    print('       (' + (at < 0 ? 'NOT back within 8 s' : 'back on the game ' + at + ' s after the signal') + ')');
    check(F + ': within 8 s it is on the game as it is now', at > 0, sawOf(F, v));
    check(F + ': the console came across to meet it, by its own signed handover', v.host.road() === 'supabase' && FETCHES.some(function (f) { return /^host POST \/room\/handover/.test(f); }), [v.host.road(), FETCHES.filter(function (f) { return /handover/.test(f); }).slice(0, 6)]);
    moveOn(F, v); await advance(1000);
    check(F + ': and it hears the console\'s next message', onGame(F, v), sawOf(F, v));

    print('S. ' + F + ': THE PAGE IS RELOADED MID-GAME');
    v = await boot(F);
    await advance(10000);
    var store = v.phone.dom.localStorage._s;
    closePage(v.phone); await advance(200);
    moveOn(F, v); await advance(3000);
    var again = bootPage('venueplay/app/' + F + '/play.html', { who: 'phone2', search: '?room=' + CODE_B, exports: ['P', 'send', 'join'], store: store });
    v.phone = again;
    at = await backWithin(F, v, 5);
    check(F + ': a reloaded phone is back on the game as it is now within 5 s', at > 0, sawOf(F, v));
  }
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (BEFORE) { print('(BEFORE picture: not judged)'); return; }
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
