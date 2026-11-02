/* EVERY FORMAT ON THE ROOM SERVER, PLAYED BETWEEN THE REAL PAGES: ONE ROAD PER VENUE.

   1 Nov 2026. Musical bingo, trivia, the raffle and the members draw move onto the room server,
   one flip each (ROOM_FORMATS_ON in venueplay-room.js), with the TV's router following them. The
   one way this goes wrong without anybody seeing it is a venue split across two roads: a console
   in the room and a TV on Supabase looks exactly like a working night. So every scene here runs
   the WHOLE shipped inline script of each page (tv.html, the format's console, its screen as the
   TV embeds it, its phone) with the REAL vp-room.js and the REAL room server class, through
   tools/rig-room-formats.js. Nothing touches the network.

   For each of musical, trivia, raffle and members:
     A  the format on: console, screen, phone and the TV's router in the room; NO Supabase
        connection held by any of them (the console's one-minute ear aside); the TV follows the game
     B  the format off (the Worker says so): every page of it on Supabase exactly as before, and
        the console tells the Worker road "off"
     C  ROOM_OFF set before the night: every page on Supabase, the night plays
     D  ROOM_OFF set mid-game: the whole venue (bingo's room as well) goes across together, the
        console replays where things stand, and the next message reaches everyone
     E  an OLD TV, cached from before the room server: the console's ear hears it and the venue
        moves to meet it
     F  an OLD console: the Worker hears it open a game (no road) and moves the venue to meet it
     G  a phone's socket drops: it comes back INTO the room; the venue does not move (musical, trivia)
     H  the console reloads: back in the room, the TV and screen never left it
     I  a phone that joins late: straight into the room, hears the next message (musical, trivia)
   And once for the night:
     J  bingo, then musical, then trivia on one TV link, every hop through the room
     K  every format on: the TV holds no Supabase connection at all

   Run from the repo root:  jsc tools/test-room-formats.js
*/
load('tools/rig-room-formats.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

var ROOM = { musical: 'vp-' + fnv('musical-' + SLUG), trivia: 'vp-' + fnv('trivia-' + SLUG), raffle: 'vp-' + fnv('raffle-' + SLUG), members: 'vp-' + fnv('members-' + SLUG) };
var BINGO = 'vp-' + CODE_B;
var HAS_PHONE = { musical: true, trivia: true, raffle: false, members: false };
var N = 0;
function tag() { return 'r' + (++N); }

function boot(F, o) {
  o = o || {};
  var v = {};
  v.tv = bootPage('venueplay/tv.html', { who: 'tv', search: '?venue=' + SLUG, old: o.oldTv });
  v.host = bootPage('venueplay/app/' + F + '/host.html', { who: 'host', host: true, old: o.oldHost, exports: ['G', 'openLobby', 'send', 'gsend', 'bcast', 'sendState'] });
  v.screen = bootPage('venueplay/app/' + F + '/screen.html', { who: 'screen', search: '?venue=' + SLUG, hop: true, embedded: true, old: o.oldTv });
  if (HAS_PHONE[F] && !o.noPhone) v.phone = bootPage('venueplay/app/' + F + '/play.html', { who: 'phone', search: '?room=' + CODE_B, exports: ['P', 'send'] });
  return v;
}
/* The console puts the game on: a lobby for musical and trivia (POST /session, the players'
   channel opens), and nothing more for raffle and members, which announce themselves on connect. */
async function openGame(F, v) {
  if (F === 'trivia') {
    var SET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sel = v.host.$('setSel');
    sel.options = [{ value: SET, text: 'Pub classics', textContent: 'Pub classics', getAttribute: function () { return null; } }]; sel.selectedIndex = 0; sel.value = SET;
    v.host.ex.G.setId = SET;
    WORKER_REPLY['/host/game'] = { game_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', question_count: 3, round_size: 3 };
  }
  if (F === 'musical' || F === 'trivia') { try { v.host.ex.openLobby(); } catch (e) { TIMER_ERRORS.push('openLobby: ' + e); } }
  await advance(3000);
}
/* The console says something, down every channel it has. A message no page acts on, so a test
   can count where it went without changing the game. */
function say(F, v, t) {
  var m = { t: 'rig', n: t };
  if (v.host.ex.bcast) v.host.ex.bcast(m); else v.host.ex.send(m);
}
function got(who, t, road) { return heard(who, function (m) { return m.t === 'rig' && m.n === t; }).filter(function (h) { return !road || h.road === road; }).length > 0; }
function frame(v) { return String(v.tv.$('gameFrame').src || ''); }
function liveChannels(who) { return supaChannels(new RegExp('^' + who + '$')); }
function errorsOf(v) { var e = []; for (var k in v) e = e.concat(v[k].errors.map(function (x) { return k + ': ' + x; })); return e.concat(TIMER_ERRORS); }

(async function () {
  var FORMATS = ['musical', 'trivia', 'raffle', 'members'];
  for (var fi = 0; fi < FORMATS.length; fi++) {
    var F = FORMATS[fi], on = {}; on[F] = true;
    var R = ROOM[F], v, t1, t2, t3;
    print('\n######## ' + F.toUpperCase() + ' ########');

    print('A. ' + F + ' ON THE ROOM');
    freshWorld({ formats: on }); v = boot(F); await advance(2000); await openGame(F, v);
    check(F + ': every page booted with no error', errorsOf(v).length === 0, errorsOf(v));
    check(F + ': the console is in the format\'s room', roomSockets('host').indexOf(R) >= 0, roomSockets('host'));
    check(F + ': so is the screen the TV embeds', roomSockets('screen').indexOf(R) >= 0, roomSockets('screen'));
    check(F + ': and the TV\'s router, beside bingo\'s room', roomSockets('tv').indexOf(R) >= 0 && roomSockets('tv').indexOf(BINGO) >= 0, roomSockets('tv'));
    if (v.phone) check(F + ': the phone is in the players\' room (the venue\'s own code)', roomSockets('phone').indexOf(BINGO) >= 0, roomSockets('phone'));
    if (F === 'musical' || F === 'trivia') check(F + ': the console opened its lobby saying road "room"', WORKER_POSTS.some(function (p) { return p.who === 'host' && p.path === '/session' && p.body.road === 'room'; }), WORKER_POSTS.map(function (p) { return p.path + ':' + p.body.road; }));
    check(F + ': the TV follows the game on to its screen', frame(v).indexOf('/app/' + F + '/screen') >= 0, frame(v));
    t1 = tag(); say(F, v, t1); await advance(500);
    check(F + ': what the console says reaches the screen through the room', got('screen', t1, 'room'), heard('screen').length);
    check(F + ': and the TV\'s router', got('tv', t1, 'room'));
    if (v.phone) {
      check(F + ': and the phone, on the players\' channel, through the room', got('phone', t1, 'room'));
      var pt = tag(); v.phone.ex.send({ t: 'rig', n: pt }); await advance(500);
      check(F + ': a phone\'s message reaches the console through the room', got('host', pt, 'room'));
    }
    check(F + ': none of it went down Supabase', !SUPA_LOG.some(function (l) { return l.p && l.p.t === 'rig'; }), SUPA_LOG.length);
    check(F + ': the phone holds NO Supabase connection', liveChannels('phone').length === 0, liveChannels('phone'));
    check(F + ': the screen\'s router holds Supabase only for the formats still off, never this one or bingo',
          liveChannels('screen').length === 3 && liveChannels('screen').every(function (c) { return c.indexOf(R) < 0 && c.indexOf(BINGO) < 0; }), liveChannels('screen'));
    check(F + ': the TV holds Supabase only for the formats still off, never this one', liveChannels('tv').every(function (c) { return c.indexOf(R) < 0; }) && liveChannels('tv').length === 3, liveChannels('tv'));
    await advance(61000);
    check(F + ': the console\'s ear on the old road is let go after a minute: no Supabase connection', liveChannels('host').length === 0, liveChannels('host'));
    check(F + ': and it is all still in the room a minute on', roomSockets('host').indexOf(R) >= 0 && roomSockets('screen').indexOf(R) >= 0 && v.host.road() === 'room');

    if (v.phone) {
      print('G. ' + F + ': THE PHONE\'S CONNECTION DROPS');
      socketsOf(/^phone$/).forEach(dropSocket);
      await advance(4000);
      check(F + ': it comes back INTO the room', roomSockets('phone').indexOf(BINGO) >= 0, roomSockets('phone'));
      check(F + ': the venue did not move: the console and the screen are still in the room', roomSockets('host').indexOf(R) >= 0 && !handedOver(R) && !handedOver(BINGO));
      t2 = tag(); say(F, v, t2); await advance(500);
      check(F + ': and it hears the next message there', got('phone', t2, 'room'));

      print('I. ' + F + ': A PHONE THAT JOINS LATE');
      var late = bootPage('venueplay/app/' + F + '/play.html', { who: 'late', search: '?room=' + CODE_B, exports: ['P', 'send'] });
      await advance(2000);
      check(F + ': straight into the room', roomSockets('late').indexOf(BINGO) >= 0 && liveChannels('late').length === 0, [roomSockets('late'), liveChannels('late')]);
      t3 = tag(); say(F, v, t3); await advance(500);
      check(F + ': and hears the next message there', got('late', t3, 'room'));
    }

    print('H. ' + F + ': THE CONSOLE IS RELOADED');
    closePage(v.host); await advance(200);
    v.host = bootPage('venueplay/app/' + F + '/host.html', { who: 'host2', host: true, exports: ['G', 'openLobby', 'send', 'gsend', 'bcast'] });
    await advance(2000); await openGame(F, v);
    check(F + ': the reloaded console is back in the room', roomSockets('host2').indexOf(R) >= 0, roomSockets('host2'));
    check(F + ': the TV and the screen never left it', roomSockets('tv').indexOf(R) >= 0 && roomSockets('screen').indexOf(R) >= 0 && !handedOver(R));
    t2 = tag(); say(F, v, t2); await advance(500);
    check(F + ': its next message reaches the screen through the room', got('screen', t2, 'room'));

    print('D. ' + F + ': ROOM_OFF IS SET IN THE MIDDLE OF IT');
    ENV.ROOM_OFF = '1';
    t2 = tag(); say(F, v, t2); await advance(3000);
    var still = SOCKETS.filter(function (w) { return w.readyState === 1; }).map(function (w) { return w.who + '@' + w.roomName; });
    check(F + ': the whole venue left the room together, bingo\'s room as well', still.length === 0, still);
    check(F + ': the console, screen and TV are on Supabase', v.host.road() === 'supabase' && v.screen.road() === 'supabase' && v.tv.road() === 'supabase', [v.host.road(), v.screen.road(), v.tv.road()]);
    var replay = heard('screen', function (m) { return m.t === 'host_here' || m.t === 'state' || m.t === 'mode'; }).filter(function (h) { return h.road === 'supabase'; });
    check(F + ': the console said where things stand again, on the new road', replay.length > 0);
    t3 = tag(); say(F, v, t3); await advance(500);
    check(F + ': the next message reaches the screen down the old road', got('screen', t3, 'supabase'));
    check(F + ': and the TV\'s router', got('tv', t3, 'supabase'));
    if (v.phone) check(F + ': and the phone', got('phone', t3, 'supabase'));

    print('B. ' + F + ' OFF (THE WORKER SAYS SO)');
    freshWorld({}); v = boot(F); await advance(2000); await openGame(F, v);
    check(F + ': no page of it opened a socket for its own rooms', roomSockets('host').length === 0 && roomSockets('screen').indexOf(R) < 0 && roomSockets('tv').indexOf(R) < 0, [roomSockets('host'), roomSockets('screen'), roomSockets('tv')]);
    check(F + ': the TV is still on the room for bingo', roomSockets('tv').indexOf(BINGO) >= 0);
    if (F === 'musical' || F === 'trivia') check(F + ': the console told the Worker road "off" when it opened the game', WORKER_POSTS.some(function (p) { return p.path === '/session' && p.body.road === 'off'; }), WORKER_POSTS.map(function (p) { return p.path + ':' + p.body.road; }));
    check(F + ': and the Worker, with ' + F + ' off, left the venue where it is', !handedOver(BINGO));
    check(F + ': the TV follows the game on Supabase', frame(v).indexOf('/app/' + F + '/screen') >= 0, frame(v));
    t1 = tag(); say(F, v, t1); await advance(500);
    check(F + ': the screen hears it on Supabase', got('screen', t1, 'supabase'));
    if (v.phone) check(F + ': and the phone', got('phone', t1, 'supabase'));

    print('C. ROOM_OFF SET BEFORE THE NIGHT');
    freshWorld({ formats: on, off: true }); v = boot(F); await advance(2000); await openGame(F, v);
    check(F + ': nobody is in a room', SOCKETS.filter(function (w) { return w.readyState === 1; }).length === 0);
    check(F + ': the TV follows the game', frame(v).indexOf('/app/' + F + '/screen') >= 0, frame(v));
    t1 = tag(); say(F, v, t1); await advance(500);
    check(F + ': and the night plays on Supabase', got('screen', t1, 'supabase') && (!v.phone || got('phone', t1, 'supabase')));

    print('E. AN OLD TV, CACHED FROM BEFORE THE ROOM SERVER');
    freshWorld({ formats: on }); v = boot(F, { oldTv: true }); await advance(2000); await openGame(F, v);
    check(F + ': control: the old TV and its screen are on Supabase', roomSockets('tv').length === 0 && roomSockets('screen').length === 0);
    check(F + ': the console heard it on the old road and the venue moved to meet it', roomSockets('host').length === 0 && v.host.road() === 'supabase' && handedOver(R), [roomSockets('host'), v.host.road()]);
    if (v.phone) check(F + ': the phone went too', roomSockets('phone').length === 0, roomSockets('phone'));
    check(F + ': the old TV follows the game', frame(v).indexOf('/app/' + F + '/screen') >= 0, frame(v));
    t1 = tag(); say(F, v, t1); await advance(500);
    check(F + ': and its screen hears the console', got('screen', t1, 'supabase'));

    print('F. AN OLD CONSOLE, CACHED FROM BEFORE THE ROOM SERVER');
    freshWorld({ formats: on }); v = boot(F, { oldHost: true }); await advance(2000); await openGame(F, v);
    if (F === 'members') {
      /* The members draw opens no session: what the old console says to the Worker is its draw. */
      await workerFetch(API + '/host/members/draw', { method: 'POST', body: JSON.stringify({ draw_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }) }, 'host');
      await advance(3000);
    }
    if (F === 'raffle') {
      /* The raffle console opens its session at its first draw, with exactly this body. */
      await workerFetch(API + '/session', { method: 'POST', body: JSON.stringify({ venue_id: '22222222-2222-4222-8222-222222222222', format: 'raffle' }) }, 'host');
      await advance(3000);
    }
    check(F + ': control: the old console is on Supabase, and said no road', roomSockets('host').length === 0 && WORKER_POSTS.filter(function (p) { return p.who === 'host' && (p.path === '/session' || p.path === '/host/members/draw'); }).every(function (p) { return p.body.road === undefined; }));
    check(F + ': the Worker moved the whole venue to meet it: every room marked', [BINGO, ROOM.musical, ROOM.trivia, ROOM.raffle, ROOM.members].every(handedOver));
    check(F + ': the TV and screen left the room', roomSockets('tv').length === 0 && roomSockets('screen').length === 0, [roomSockets('tv'), roomSockets('screen')]);
    if (v.phone) check(F + ': and the phone', roomSockets('phone').length === 0);
    await advance(2000);
    check(F + ': the TV follows the game', frame(v).indexOf('/app/' + F + '/screen') >= 0, frame(v));
    t1 = tag(); say(F, v, t1); await advance(500);
    check(F + ': and the screen hears the old console', got('screen', t1, 'supabase'));
    if (v.phone) check(F + ': and the phone', got('phone', t1, 'supabase'));
  }

  print('\n######## THE NIGHT ########');
  print('J. BINGO, THEN MUSICAL, THEN TRIVIA, ON ONE TV LINK');
  freshWorld({ formats: { musical: true, trivia: true } });
  var tv = bootPage('venueplay/tv.html', { who: 'tv', search: '?venue=' + SLUG });
  await advance(2000);
  var bingo = new BrowserWS('wss://game.venueplay.com.au/room/ws?room=' + BINGO + '&role=host', 'bingo-console');
  await advance(100);
  bingo.send(JSON.stringify({ t: 'mode', mode: 'bingo' })); bingo.send(JSON.stringify({ t: 'started' })); bingo.send(JSON.stringify({ t: 'ball', n: 7 }));
  await advance(500);
  check('the bingo ball reached the TV through bingo\'s room', heard('tv', function (m) { return m.t === 'ball' && m.n === 7; }).some(function (h) { return h.road === 'room'; }));
  bingo.send(JSON.stringify({ t: 'idle' })); bingo.close();
  await advance(3 * 60 * 1000);                    // the bingo round is over
  var mh = bootPage('venueplay/app/musical/host.html', { who: 'mhost', host: true, exports: ['G', 'openLobby', 'bcast'] });
  await advance(2000); try { mh.ex.openLobby(); } catch (e) {} await advance(3000);
  check('the musical lobby takes the wall, through the room', frame({ tv: tv }).indexOf('/app/musical/screen') >= 0 && roomSockets('mhost').indexOf(ROOM.musical) >= 0, frame({ tv: tv }));
  var ms = bootPage('venueplay/app/musical/screen.html', { who: 'mscreen', search: '?venue=' + SLUG, hop: true, embedded: true });
  await advance(2000);
  check('the musical screen in the frame is in the room, and watches trivia\'s room too', roomSockets('mscreen').indexOf(ROOM.musical) >= 0 && roomSockets('mscreen').indexOf(ROOM.trivia) >= 0, roomSockets('mscreen'));
  mh.ex.bcast({ t: 'idle' }); closePage(mh);
  await advance(95000);                            // the musical game is over (a screen never walks out on a live one)
  var th = bootPage('venueplay/app/trivia/host.html', { who: 'thost', host: true, exports: ['G', 'openLobby'] });
  await advance(2000); await openGame('trivia', { host: th });
  check('the trivia console is in trivia\'s room', roomSockets('thost').indexOf(ROOM.trivia) >= 0, roomSockets('thost'));
  var asked = ms.win.posted.filter(function (m) { return m && m.vp === 'show-game'; });
  check('the musical screen heard trivia go on air, in the room, and asked the TV for it', asked.some(function (m) { return m.game === 'trivia'; }), asked);
  (tv.win._on.message || []).forEach(function (fn) { asked.forEach(function (m) { fn({ origin: 'https://venueplay.com.au', data: m }); }); });   // what the browser does with postMessage
  check('the TV goes to trivia on the same link', frame({ tv: tv }).indexOf('/app/trivia/screen') >= 0, frame({ tv: tv }));
  check('nothing of the night went down Supabase', !SUPA_LOG.some(function (l) { return l.p && /^(mode|ball|started|state)$/.test(l.p.t) && !l.p.rw; }), SUPA_LOG.filter(function (l) { return l.p && !l.p.rw; }).map(function (l) { return l.who + ':' + l.p.t; }).slice(0, 8));
  check('and the venue never moved', !handedOver(BINGO) && !handedOver(ROOM.musical) && !handedOver(ROOM.trivia));

  print('\nL. ONE OF THE TV\'S ROOMS IS HANDED OVER AND THE WORD CANNOT REACH THE WORKER');
  freshWorld({ formats: { musical: true } });
  var tvL = bootPage('venueplay/tv.html', { who: 'tv', search: '?venue=' + SLUG });
  await advance(3000);
  check('control: the TV is in bingo\'s room and musical\'s', roomSockets('tv').indexOf(BINGO) >= 0 && roomSockets('tv').indexOf(ROOM.musical) >= 0, roomSockets('tv'));
  HANDOVER_DOWN = true;                            // nothing this screen posts to /room/handover arrives
  await ROOMS[BINGO].obj.handover(true);           // a phone that knew no venue handed bingo's room over
  await advance(3000);
  check('the TV took its musical room to Supabase with bingo\'s, on its own say so: one road on this screen', roomSockets('tv').length === 0 && liveChannels('tv').some(function (c) { return c.indexOf(ROOM.musical) >= 0; }) && liveChannels('tv').some(function (c) { return c.indexOf(BINGO) >= 0; }), [roomSockets('tv'), liveChannels('tv')]);
  check('even though musical\'s room was never told', !handedOver(ROOM.musical));

  print('\nK. EVERY FORMAT ON THE ROOM');
  freshWorld({ formats: { musical: true, trivia: true, raffle: true, members: true } });
  var tvAll = bootPage('venueplay/tv.html', { who: 'tv', search: '?venue=' + SLUG });
  await advance(5000);
  check('the TV is in all five of the venue\'s rooms', [BINGO, ROOM.trivia, ROOM.musical, ROOM.raffle, ROOM.members].every(function (n) { return roomSockets('tv').indexOf(n) >= 0; }), roomSockets('tv'));
  check('and holds NO Supabase connection at all', supaConnections(/^tv$/) === 0, liveChannels('tv'));
  await advance(60 * 60 * 1000);
  check('an hour on, still none, still in all five (the heartbeat keeps them)', supaConnections(/^tv$/) === 0 && roomSockets('tv').length === 5, [liveChannels('tv'), roomSockets('tv')]);
  check('nothing threw on any page all night', TIMER_ERRORS.length === 0 && tvAll.errors.length === 0, TIMER_ERRORS.concat(tvAll.errors).slice(0, 5));

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
