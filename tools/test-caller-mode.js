/* CALLER MODE: A BINGO NIGHT CALLED WITH REAL BALLS (17 Oct 2026).

   At Drag Bingo the queens pull real balls out of a bag, and plenty of clubs already run a ball
   machine or a barrel. Dean wants every number they call to pop up on the venue's TVs exactly as
   on a VenuePlay night. So the bingo console has a "Real balls (caller mode)" option: the
   console's own draw is not used, a 1 to 90 grid appears, the operator taps the number just
   called, and a long press (or Undo) takes back the last call. The room plays paper books, so no
   phone is dealt a ticket, and the Worker tells a phone that joins to use its paper book.

   This RUNS it. The REAL console (venueplay/app/index.html), REAL phone pages (play.html) on one
   channel (tools/rig-bingo-room.js), against the REAL game Worker handlers (tools/rig-game-worker.js:
   handleCreateSession, handleBingoDrawStart, handleBingoBall, handleBingoFallback, handleJoinInfo,
   handlePlayLive, handleJoin, handleBingoSeat), on a fake database that refuses a repeated ball
   the way the real unique keys on vp_bingo_draw_balls do.

   A whole caller-mode game: 90 taps, a duplicate tap refused, an undo by long press and one by
   the button, the TV's ball message the same shape as a normal night's, no phone ticket, the
   record written with reason "caller", and a tablet reload in the middle that comes back to the
   same called list. Then a normal night at the same venue, to prove nothing changed with it off.

   Run from the repo root:  jsc tools/test-caller-mode.js */
var CONSOLE_SRC = readFile('venueplay/app/index.html');
load('tools/rig-game-worker.js');
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0, EXPECT = 54;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
/* ---- one clock for both rigs ---- */
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
drain = async function () { for (var r = 0; r < 6; r++) { for (var i = 0; i < 60; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };
/* The real table's keys: a ball is called once per draw, and one ball per ordinal. The rig's fake
   PostgREST has no keys, and a fake that cannot refuse a repeat cannot show that it is refused. */
var _rigFetch = fetch;
fetch = async function (url, opts) {
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_players/.test(String(url))) {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) { if (r.kicked == null) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_bingo_draw_balls/.test(String(url))) {
    var rows = JSON.parse(opts.body); rows = Array.isArray(rows) ? rows : [rows];
    var have = DB.vp_bingo_draw_balls || [];
    var clash = rows.some(function (r) { return have.some(function (x) { return x.draw_id === r.draw_id && (x.number === r.number || x.ordinal === r.ordinal); }); });
    if (clash) return resp(409, { message: 'duplicate key value violates unique constraint' });
  }
  return _rigFetch(url, opts);
};

CODE = fnvVenueCode('test-pub');
DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD', max_players: 100 }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [],
       vp_trivia_answers: [], vp_claims: [], vp_game_reports: [], vp_gaming_declarations: [], vp_bingo_draws: [], vp_bingo_draw_balls: [] };
venueJoinCode = async function () { return CODE; };
var BALLCALLS = 0, FALLBACKS = [];
async function worker(path, body, headers, who) {
  var q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q), h = headers || {};
  var req = { _body: body || {}, url: 'https://game.test' + path, headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } };
  try {
    if (p === '/join') return await handleJoin(req, ENV, json);
    if (p === '/join/info') return await handleJoinInfo(req, ENV, json);
    if (p === '/play/live') return await handlePlayLive(req, ENV, json);
    if (p === '/player/alive') return await handlePlayerAlive(req, ENV, json);
    if (p === '/report') return await handleReport(req, ENV, json);
    if (p === '/session') return await handleCreateSession(req, ENV, json);
    if (p === '/session/close') return await handleSessionClose(req, ENV, json);
    if (p === '/host/bingo/seat') return await handleBingoSeat(req, ENV, json);
    if (p === '/host/bingo/draw') return await handleBingoDrawStart(req, ENV, json);
    if (p === '/host/bingo/ball') { BALLCALLS++; return await handleBingoBall(req, ENV, json); }
    if (p === '/host/bingo/fallback') { FALLBACKS.push(body); return await handleBingoFallback(req, ENV, json); }
    if (p === '/snapshot') return await handleSnapshot(req, ENV, json);
    return { status: 404, body: { error: 'not routed: ' + p } };
  } catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function pageFetch(who) {
  return function (url, opts) {
    var path = String(url).replace(/^https?:\/\/[^\/]+/, ''), o = opts || {};
    var body = o.body ? JSON.parse(o.body) : {};
    return worker(path, body, o.headers, who)
      .then(function (r) { return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } }; });
  };
}
function bootHostC(store, who) {
  var dom = makeDom("", store), sb = baseSandbox(dom, who);
  var ctx = { authed: true, scope: "staff", role: "owner", isAdmin: false, currentVenueId: VENUE, user: { user_metadata: { name: "Dean" } },
              venue: { id: VENUE, slug: "test-pub", name: "Test Pub", status: "active", max_players: 100, created_at: "2026-01-01T00:00:00Z" }, staff: [{ venue_id: VENUE }] };
  var VP = { useClient: function () {}, ready: function () { return Promise.resolve(ctx); }, refresh: function () { return Promise.resolve(ctx); }, suspensionBanner: function () {},
    venueCode: function () { return CODE; }, venueJoinCode: function () { return Promise.resolve(null); },
    getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
    gameApiPost: function (path, body) { return worker(path, body, {}, 'host').then(function (r) { return r.body; }); },
    gameApiCall: function (path, body) { return worker(path, body, {}, 'host').then(function (r) { return { status: r.status, json: r.body }; }); },
    setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
    homeHref: function () { return "index.html"; } };
  sb.VP = VP; dom.window.VP = VP;
  var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
  sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
  sb.fetch = pageFetch('host');
  var ex = runPage(inlineScript("venueplay/app/index.html"), sb, ["G", "startGame", "openLobby", "newGame", "endGame", "onMsg", "commitBall", "nextBall",
    "callerCall", "callerUndo", "callerHold", "renderCallerGrid", "playerCount"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); };
  return ex;
}
function bootPhoneC(name, opts) {
  opts = opts || {};
  var dom = makeDom(opts.search || ("?room=" + CODE), opts.store);
  var sb = baseSandbox(dom, "phone:" + name);
  if (opts.slug) sb.VPVenueURL = dom.window.VPVenueURL = { slug: function () { return opts.slug; } };
  sb.fetch = pageFetch(name);
  var ex = runPage(inlineScript("venueplay/play.html"), sb, ["P", "onMsg", "join", "route"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); }; ex.name = name;
  return ex;
}
var WHO = 'host-normal';   // which console is speaking: each tablet in this file has its own name on the channel
function hostSent(t) { return LOG.filter(function (l) { return l && l.from === WHO && l.p && l.p.t === t; }).map(function (l) { return l.p; }); }
// A tablet that has been put down (or reloaded) hears nothing more.
function retire(who) { Object.keys(BUS).forEach(function (k) { BUS[k].forEach(function (sub) { if (sub.who === who) sub.live = false; }); }); }
function phoneSaid(ph) { return LOG.filter(function (l) { return l && l.from === 'phone:' + ph.name; }).length; }
function notice(ph) { return ph.dom.document.body.children.map(function (n) { return n.innerHTML; }).join(' '); }
function cg(host, n) { return host.$('callerGrid').children[n - 1] || { className: '', textContent: '' }; }   // the grid's own cells, as a browser lays them out
function tap(host, n) {   // a real tap on the grid: the click handler on #callerGrid, with the cell as its target
  var grid = host.$('callerGrid'), cell = grid.children[n - 1];
  (grid._on.click || []).forEach(function (f) { f.call(grid, { target: cell, preventDefault: function () {} }); });
}
function holdOn(host, n) {   // a long press: pointerdown, the hold time passes, pointerup, then the click the browser sends
  var grid = host.$('callerGrid'), cell = grid.children[n - 1];
  (grid._on.pointerdown || []).forEach(function (f) { f.call(grid, { target: cell }); });
  return advance(700).then(function () {
    (grid._on.pointerup || []).forEach(function (f) { f.call(grid, { target: cell }); });
    (grid._on.click || []).forEach(function (f) { f.call(grid, { target: cell, preventDefault: function () {} }); });
  });
}
function liveSession() { return DB.vp_sessions.filter(function (s) { return s.status === 'lobby' || s.status === 'running' || s.status === 'paused'; })[0] || null; }
function ballsOn(drawId) { return (DB.vp_bingo_draw_balls || []).filter(function (r) { return r.draw_id === drawId; }).sort(function (a, b) { return a.ordinal - b.ordinal; }); }

(async function () {
  print('A NORMAL NIGHT FIRST, for the shape of a called ball and as the control');
  var norm = bootHostC(null, 'host-normal'); await advance(50);
  var ann0 = bootPhoneC('Ann0'); await advance(50); ann0.$('nameIn').value = 'Ann'; ann0.join(); await advance(6000);
  norm.$('prizeInput').value = 'Meat tray'; norm.$('patternSel').value = 'one'; norm.$('cardsSel').value = '1'; norm.$('paidSel').value = '';
  norm.openLobby(); await advance(9000);
  var nSess = liveSession();
  check('CONTROL: with the option off the console does not mark the night as real balls', !!nSess && !(nSess.paper && nSess.paper.bingo), nSess && nSess.paper);
  var jiOff = await worker('/join/info', { code: CODE });
  check('CONTROL: and a phone at this Queensland venue is NOT told to use paper', jiOff.body.paper_bingo === false && !jiOff.body.paper_reason, jiOff.body);
  norm.startGame(); await advance(5000);
  check('CONTROL: a normal night deals the phone its ticket', ann0.P.cards.length === 1, ann0.P.cards.length);
  var nDraw = DB.vp_bingo_draws[DB.vp_bingo_draws.length - 1];
  check('CONTROL: a normal night opens a SERVER draw', nDraw && nDraw.mode !== 'local' && !nDraw.fallback_why, nDraw);
  var b0 = BALLCALLS;
  norm.nextBall(); await advance(6000);
  var normalBall = hostSent('ball').slice(-1)[0];
  check('CONTROL: Next number still asks the server for the ball', BALLCALLS === b0 + 1 && !!normalBall, BALLCALLS - b0);
  norm.endGame(); await advance(3000);
  retire('host-normal');

  print('A REAL-BALLS NIGHT: the option on, the lobby open');
  WHO = 'host-caller';
  var host = bootHostC(null, WHO); await advance(50);
  check('the option is on the setup form', CONSOLE_SRC.indexOf('id="callerChk"') >= 0 && /Real balls \(caller mode\)/.test(CONSOLE_SRC));
  host.$('prizeInput').value = '$50 bar tab'; host.$('patternSel').value = 'full'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.$('callerChk').checked = true;
  (host.$('callerChk')._on.change || []).forEach(function (f) { f.call(host.$('callerChk'), {}); });
  check('ticking it takes the phone ticket settings off the form', host.$('ticketsField').style.display === 'none' && host.$('cardsField').style.display === 'none',
        [host.$('ticketsField').style.display, host.$('cardsField').style.display]);
  host.openLobby(); await advance(9000);
  var sess = liveSession();
  check('the night\'s session is marked real balls on the server (vp_sessions.paper.bingo, no new table)', !!sess && sess.paper && sess.paper.bingo && sess.paper.bingo.caller === true, sess && sess.paper);
  check('and the option is locked while the night is open', host.$('callerChk').disabled === true);

  print('the phones are told to use their paper book');
  var ji = await worker('/join/info', { code: CODE });
  check('/join/info says paper, because of tonight\'s real balls, in a state that allows phone tickets', ji.body.paper_bingo === true && ji.body.paper_reason === 'caller', ji.body);
  var pl = await worker('/play/live?code=' + encodeURIComponent(CODE), {});
  check('/play/live says the same, so the two answers cannot disagree', pl.body.paper_bingo === true && pl.body.paper_reason === 'caller', pl.body);
  var bea = bootPhoneC('Bea'); await advance(3000);
  check('a phone opening the link is shown "Tonight you play on paper"', /Tonight you play on paper/.test(notice(bea)), notice(bea).slice(0, 120));
  check('worded for real balls, not the state\'s rules', /real ball draw/.test(notice(bea)) && !/Your state/.test(notice(bea)), notice(bea).slice(0, 400));
  var store = {}; store['vp-name-' + CODE] = 'Cal';
  var cal = bootPhoneC('Cal', { search: '?venue=test-pub', slug: 'test-pub', store: store }); await advance(31000);
  check('a regular off the table talker (the /play/live poll) is told too', /real ball draw/.test(notice(cal)), notice(cal).slice(0, 120));
  await advance(31000);
  check('and still worded for real balls after the next poll', /real ball draw/.test(notice(cal)) && !/Your state/.test(notice(cal)), notice(cal).slice(0, 400));
  var beaSaid = phoneSaid(bea);
  bea.onMsg({ t: 'rollcall' }); await advance(2000);
  check('and a paper phone says nothing on the channel, so nothing deals to it', phoneSaid(bea) === beaSaid);

  print('the game starts: no phone ticket, no draw from the console or the server');
  // A phone that slipped in anyway (an old page, a cached link): it holds a real row in tonight's
  // session, so the console seats it, and it announces itself on the channel.
  DB.vp_players.push({ id: '77777777-7777-4777-8777-000000000001', session_id: sess.id, device_id: 'rogue-device-1', display_name: 'Rogue', kicked: false, created_at: new Date().toISOString() });
  host.onMsg({ t: 'join', pid: 'roguephone01', name: 'Rogue', did: 'rogue-device-1' });
  host.startGame(); await advance(5000);
  host.onMsg({ t: 'join', pid: 'roguephone01', name: 'Rogue', did: 'rogue-device-1' }); await advance(2000);
  var rogue = host.G.players.roguephone01;
  check('CONTROL: that phone IS seated, so only the real-balls rule stands between it and a ticket', !!rogue && rogue.seatSid === sess.id, rogue && rogue.seatSid);
  check('no phone ticket is issued on a real-balls night', !!rogue && !(rogue.cards && rogue.cards.length) && hostSent('cards').length === 0,
        { cards: rogue && rogue.cards, sent: hostSent('cards').length });
  check('the grid replaces Next number', host.$('bingoView').classList.contains('callermode') && host.$('callerGrid').children.length === 90 && cg(host, 1).textContent === 1 && cg(host, 90).textContent === 90,
        host.$('bingoView').className);
  var draw = DB.vp_bingo_draws[DB.vp_bingo_draws.length - 1];
  check('the night\'s record opens as a physical draw: local, reason "caller", from ball one', draw && draw.mode === 'local' && draw.fallback_why === 'caller' && draw.fallback_at === 1 && host.G.drawId === draw.id, draw);
  var balls0 = hostSent('ball').length;
  host.nextBall(); await advance(6000);
  check('the console\'s own draw is not used: Next number calls nothing', hostSent('ball').length === balls0 && host.G.draw.length === 0, hostSent('ball').length - balls0);
  var direct = await worker('/host/bingo/ball', { draw_id: draw.id });
  check('and the server refuses to hand out a ball on a real-balls draw', direct.status === 409, direct);
  var bCaller = BALLCALLS;   // from here on, the console itself must never ask
  function fallbacksFor(id) { return FALLBACKS.filter(function (f) { return f.draw_id === id; }); }

  print('calling the balls off the grid');
  var order = [], i;
  for (i = 90; i >= 1; i -= 7) order.push(i);   // 90, 83, ... 6: a caller does not call in order
  for (i = 1; i <= 90; i++) if (order.indexOf(i) < 0) order.push(i);
  var first = order.slice(0, 10);
  for (i = 0; i < first.length; i++) { tap(host, first[i]); await advance(300); }
  var sentBalls = hostSent('ball').slice(balls0);
  check('ten taps, ten balls on the channel, in the order tapped', sentBalls.length === 10 && sentBalls.map(function (b) { return b.number; }).join() === first.join(), sentBalls.map(function (b) { return b.number; }));
  var cb = sentBalls[sentBalls.length - 1];
  check('the TV gets exactly the message a normal call sends: the same fields', !!normalBall && Object.keys(cb).sort().join() === Object.keys(normalBall).sort().join(),
        { caller: Object.keys(cb).sort(), normal: normalBall && Object.keys(normalBall).sort() });
  check('of the same kinds, with the called list and index the TV draws its board from', cb.t === 'ball' && typeof cb.number === 'number' && Array.isArray(cb.called) && cb.called.join() === first.join() && cb.index === 9, cb);
  check('the grid marks every called number, and the last one as current', first.every(function (n) { return /\bon\b/.test(cg(host, n).className); }) && /\bcur\b/.test(cg(host, first[9]).className) && !/\bon\b/.test(cg(host, order[10]).className),
        cg(host, first[9]).className);
  var dupBefore = hostSent('ball').length;
  tap(host, first[3]); await advance(300);
  check('a number already called cannot be called twice: the tap is refused', hostSent('ball').length === dupBefore && host.G.draw.length === 10, host.G.draw.length);
  check('every tap went on the record with reason "caller", in order', ballsOn(draw.id).length === 10 && ballsOn(draw.id).every(function (r, k) { return r.number === first[k] && r.ordinal === k + 1 && r.source === 'local'; }) && fallbacksFor(draw.id).length === 10 && fallbacksFor(draw.id).every(function (f) { return f.reason === 'caller'; }),
        ballsOn(draw.id).map(function (r) { return r.ordinal + ':' + r.number; }));

  print('a mis-tap, taken back by a long press');
  tap(host, 77); await advance(300);
  var states0 = hostSent('state').length;
  await holdOn(host, 77); await advance(300);
  var st = hostSent('state').slice(states0)[0];
  check('holding the last number takes it back', host.G.draw.length === 10 && !host.G.called[77] && !/\bon\b/.test(cg(host, 77).className), host.G.draw);
  check('and the click the browser sends after a hold does not call it again', host.G.draw.indexOf(77) < 0);
  check('the TV is sent the corrected called list, the message it redraws its board from', !!st && st.active === true && st.called.join() === first.join(), st);
  await advance(3000);
  check('it is said again once the big-number reveal has landed, so the wall cannot keep the withdrawn ball', hostSent('state').slice(states0).length >= 2 && hostSent('state').slice(-1)[0].called.join() === first.join());
  check('the record lets go of the withdrawn ball', ballsOn(draw.id).length === 10 && !ballsOn(draw.id).some(function (r) { return r.number === 77; }), ballsOn(draw.id).map(function (r) { return r.number; }));
  await holdOn(host, first[2]); await advance(300);
  check('holding a number that is not the last call takes nothing back', host.G.draw.length === 10 && host.G.called[first[2]] === true);

  print('a reload of the tablet in the middle of the game');
  for (i = 10; i < 30; i++) { if (order[i] === 77) continue; tap(host, order[i]); await advance(200); }
  var before = host.G.draw.slice();
  var saved = JSON.parse(JSON.stringify(host.dom.localStorage._s));
  retire('host-caller');   // the old tab is gone
  WHO = 'host-reloaded';
  var host2 = bootHostC(saved, WHO); await advance(3000);
  check('a reload comes back in caller mode', host2.G.caller === true && host2.G.status === 'running' && host2.$('bingoView').classList.contains('callermode'));
  check('with the same called list, in the same order', host2.G.draw.join() === before.join(), { was: before.length, now: host2.G.draw.length });
  check('and the grid marks them all again', before.every(function (n) { return /\bon\b/.test(cg(host2, n).className); }));
  tap(host2, before[0]); await advance(300);
  check('a number called before the reload is still refused after it', host2.G.draw.length === before.length);

  print('the rest of the game, to all 90');
  var rest = order.filter(function (n) { return host2.G.draw.indexOf(n) < 0; });
  for (i = 0; i < rest.length; i++) { tap(host2, rest[i]); await advance(150); }
  check('all 90 numbers called, each exactly once', host2.G.draw.length === 90 && host2.G.draw.slice().sort(function (a, b) { return a - b; }).every(function (n, k) { return n === k + 1; }), host2.G.draw.length);
  check('the grid has nothing left to tap', host2.G.pool.length === 0);
  var allBalls = ballsOn(draw.id);
  check('the record holds 90 balls, ordinals 1 to 90, matching the room', allBalls.length === 90 && allBalls.every(function (r, k) { return r.ordinal === k + 1 && r.number === host2.G.draw[k]; }),
        allBalls.length);
  check('the reason "caller" is still sent after the reload', fallbacksFor(draw.id).slice(-rest.length).every(function (f) { return f.reason === 'caller'; }));
  check('the server was never asked for a ball all game', BALLCALLS === bCaller && host2.G.draw.length === 90, BALLCALLS - bCaller);
  var dsBefore = hostSent('ball').length;   // the reloaded tablet's own count
  host2.callerUndo(); await advance(300);
  var lastBack = host2.G.pool[0];
  check('the Undo button takes back the 90th', host2.G.draw.length === 89 && host2.G.pool.length === 1 && ballsOn(draw.id).length === 89, host2.G.draw.length);
  tap(host2, lastBack); await advance(300);
  check('and it can be called again, onto the same place in the record', host2.G.draw.length === 90 && ballsOn(draw.id).length === 90 && ballsOn(draw.id)[89].number === lastBack && hostSent('ball').length === dsBefore + 1);
  host2.endGame(); await advance(3000);
  check('End game closes the night', !liveSession(), liveSession());

  print('the Worker, directly');
  var nd = await worker('/host/bingo/draw', { venue_id: VENUE });
  var ndRow = DB.vp_bingo_draws.filter(function (d) { return d.id === nd.body.draw_id; })[0];
  check('a draw opened without caller is a normal server draw, as before', ndRow && (ndRow.mode == null || ndRow.mode === 'server') && !ndRow.fallback_why, ndRow);
  var fw = await worker('/host/bingo/fallback', { draw_id: nd.body.draw_id, number: 5, ordinal: 1, reason: 'worker unreachable' });
  var wd = await worker('/host/bingo/fallback', { draw_id: nd.body.draw_id, number: 5, ordinal: 1, reason: 'caller', withdraw: true });
  check('a withdraw on a night that is not real balls is refused, and the ball stays on the record', fw.status === 200 && wd.status === 409 && ballsOn(nd.body.draw_id).length === 1, [fw.status, wd.status]);
  var cd = await worker('/host/bingo/draw', { venue_id: VENUE, caller: true });
  await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 10, ordinal: 1, reason: 'caller' });
  await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 2, reason: 'caller' });
  var notLast = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 10, ordinal: 1, reason: 'caller', withdraw: true });
  check('only the LAST call can be withdrawn', notLast.status === 409 && ballsOn(cd.body.draw_id).length === 2, notLast);
  var dupe = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 3, reason: 'caller' });
  check('a repeat of a called number is refused by the record', dupe.status === 409 && ballsOn(cd.body.draw_id).length === 2, dupe.status);

  print('the flag is for the bingo night only');
  var s2 = await worker('/session', { venue_id: VENUE, format: 'bingo', caller: true });
  var row2 = DB.vp_sessions.filter(function (s) { return s.id === s2.body.session_id; })[0];
  check('CONTROL: the flag is on for this session', callerBingoNight(row2));
  row2.lobby_format = 'trivia';
  var tj = await worker('/join/info', { code: CODE });
  check('a trivia lobby on the same session is NOT a paper night', tj.body.paper_bingo === false, tj.body);
  row2.lobby_format = 'bingo90';
  var s3 = await worker('/session', { venue_id: VENUE, format: 'bingo', caller: false });
  check('the next bingo lobby with the option off clears it', s3.body.reused === true && !callerBingoNight(row2) && (await worker('/join/info', { code: CODE })).body.paper_bingo === false, row2.paper);
  await worker('/session', { venue_id: VENUE, format: 'bingo', caller: true });
  var s4 = await worker('/session', { venue_id: VENUE, format: 'bingo' });
  check('an older console that sends no caller field changes nothing (the mark stays as it was)', s4.body.reused === true && callerBingoNight(row2), row2.paper);

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (PASS + FAILN !== EXPECT) { print('FAIL ' + (PASS + FAILN) + ' checks ran, ' + EXPECT + ' expected'); throw new Error('a link in the chain was skipped'); }
  if (FAILN) throw new Error(FAILN + ' caller mode checks failed');
  print('ALL ' + PASS + ' CHECKS PASSED');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
