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

   Added the same day, for Drag Bingo on 24 Oct 2026 (run by a lights operator, maybe on a phone):
   the REAL tv.html runs here too (its whole inline script, on a fake DOM), fed every message the
   console sends. On a real-balls night it must never show the join code, the QR or "scan to
   play", only the game's title and the board, while a normal night keeps all of them. And the
   WINNER button: the console asks which stage was won (in the page, no browser dialog), every TV
   shows BINGO with the stage and the prize the host set up and "Show your book to the host",
   with the celebration, until one tap on Back to the game closes it.

   Run from the repo root:  jsc tools/test-caller-mode.js */
var CONSOLE_SRC = readFile('venueplay/app/index.html');
load('tools/rig-game-worker.js');
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0, EXPECT = 87;
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
/* THE REAL VENUE TV: tv.html's whole inline script on the rig's fake DOM, given only what a DOM
   that cannot lay anything out lacks. It hears nothing on its own (its realtime client is deaf);
   feedTV hands it, in order, every message the console speaking now has put on the channel. */
var CELEB = { burst: 0, fanfare: 0 };
function bootTV() {
  var dom = makeDom('?venue=test-pub'), d = dom.document, gi = d.getElementById, ce = d.createElement, noop = function () {};
  function more(n) {
    if (!n || n._more) return n; n._more = 1;
    Object.defineProperty(n, 'childNodes', { get: function () { return n.children; } });
    Object.defineProperty(n, 'firstChild', { get: function () { return n.children[0] || null; } });
    n.appendChild = function (c) { var op = c.parentNode; if (op && op.children) { var k = op.children.indexOf(c); if (k >= 0) op.children.splice(k, 1); } n.children.push(c); c.parentNode = n; return c; };
    n.getBoundingClientRect = function () { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; };
    n.offsetWidth = 0; n.offsetHeight = 0; n.clientWidth = 1920; n.clientHeight = 1080;
    n.removeAttribute = function (k) { delete n._attr[k]; }; n.hasAttribute = function (k) { return n._attr[k] != null; };
    n.getContext = function () { return null; }; n.dataset = {}; n.contentWindow = null;
    return n;
  }
  d.getElementById = function (id) { return more(gi.call(d, id)); };
  d.createElement = function (t) { return more(ce.call(d, t)); };
  more(d.body); more(d.documentElement); d.head = more(ce.call(d, 'head')); d.fonts = { ready: Promise.resolve() };
  var sb = baseSandbox(dom, 'tv');
  var deaf = { on: function () { return deaf; }, subscribe: function () { return deaf; }, send: noop, unsubscribe: noop };
  sb.supabase = { createClient: function () { return { channel: function () { return deaf; }, removeChannel: noop }; } };
  sb.VPQR = { draw: function (el, url) { el._qr = url; } };
  sb.VPCelebrate = dom.window.VPCelebrate = { burst: function () { CELEB.burst++; }, fanfare: function () { CELEB.fanfare++; } };
  sb.Image = function () { return {}; };
  sb.getComputedStyle = function () { return { getPropertyValue: function () { return ''; } }; };
  sb.requestAnimationFrame = function (f) { return fSetTimeout(f, 16); };
  sb.MutationObserver = sb.ResizeObserver = function () { return { observe: noop, disconnect: noop }; };
  dom.window.innerWidth = 1920; dom.window.innerHeight = 1080;
  dom.window.location.pathname = '/tv'; dom.window.location.origin = 'https://venueplay.com.au'; dom.window.location.reload = noop;
  var ex = runPage(inlineScript('venueplay/tv.html'), sb, ['onMsg', 'state']);
  ex.dom = dom; ex.$ = function (id) { return dom.document.getElementById(id); }; ex.at = LOG.length;
  return ex;
}
function feedTV(tv, upTo) {   // every message the console speaking now (WHO) has sent since the TV last listened
  var end = upTo == null ? LOG.length : upTo;
  for (; tv.at < end; tv.at++) { var l = LOG[tv.at]; if (l && l.from === WHO && l.p) tv.onMsg(JSON.parse(JSON.stringify(l.p))); }
}
function shown(tv, id) { return !tv.$(id).classList.contains('hidden'); }
function onWall(tv) { return ['tvLobby', 'tvRun', 'tvClaim', 'tvWin', 'tvHold'].filter(function (id) { return shown(tv, id); }).concat(shown(tv, 'tvJoinCorner') ? ['tvJoinCorner'] : []); }
function ballsOn(drawId) { return (DB.vp_bingo_draw_balls || []).filter(function (r) { return r.draw_id === drawId; }).sort(function (a, b) { return a.ordinal - b.ordinal; }); }

(async function () {
  print('A NORMAL NIGHT FIRST, for the shape of a called ball and as the control');
  var norm = bootHostC(null, 'host-normal'); await advance(50);
  var ann0 = bootPhoneC('Ann0'); await advance(50); ann0.$('nameIn').value = 'Ann'; ann0.join(); await advance(6000);
  norm.$('prizeInput').value = 'Meat tray'; norm.$('patternSel').value = 'one'; norm.$('cardsSel').value = '1'; norm.$('paidSel').value = '';
  var tv = bootTV(); await advance(50);
  norm.openLobby(); await advance(9000);
  feedTV(tv);
  check('CONTROL: on a normal night the TV puts up the join screen, with the QR drawn and the code', shown(tv, 'tvLobby') && !shown(tv, 'tvRun') && /play/.test(String(tv.$('qrBig')._qr)) && tv.$('lobbyCode').textContent.length === 6,
        { wall: onWall(tv), qr: tv.$('qrBig')._qr, code: tv.$('lobbyCode').textContent });
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
  feedTV(tv);
  check('CONTROL: and once numbers are called the "Join now" corner (QR and code) rides beside the board, with no real-balls title', shown(tv, 'tvRun') && shown(tv, 'tvJoinCorner') && tv.$('tvRunTitle').style.display === 'none' && tv.state.caller === false,
        { wall: onWall(tv), title: tv.$('tvRunTitle').style.display });
  check('CONTROL: Next number still asks the server for the ball', BALLCALLS === b0 + 1 && !!normalBall, BALLCALLS - b0);
  norm.endGame(); await advance(3000);
  feedTV(tv);
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
  var lobbyFrom = LOG.length;
  tv.$('qrBig')._qr = null; tv.$('qrMini')._qr = null; tv.at = LOG.length;
  host.openLobby(); await advance(9000);
  var firstMode = LOG.slice(lobbyFrom).filter(function (l) { return l.from === WHO && l.p.t === 'mode'; })[0];
  var tv2 = bootTV(); await advance(50);
  if (firstMode) tv2.onMsg(JSON.parse(JSON.stringify(firstMode.p)));
  check('the very first thing a TV hears (the mode) already says real balls, so the join screen never flashes up', !!firstMode && firstMode.p.caller === true && !shown(tv2, 'tvLobby') && shown(tv2, 'tvRun') && !shown(tv2, 'tvJoinCorner'),
        { mode: firstMode && firstMode.p, wall: onWall(tv2) });
  feedTV(tv);
  check('on a real-balls night the TV shows the game\'s title and the board instead of the join screen', !shown(tv, 'tvLobby') && shown(tv, 'tvRun') && tv.$('tvRunTitle').style.display === '',
        { wall: onWall(tv), title: tv.$('tvRunTitle').style.display });
  check('no join code, no QR, no "Join now" corner and no "scan to play" anywhere on the wall', !shown(tv, 'tvLobby') && !shown(tv, 'tvJoinCorner') && tv.$('qrBig')._qr == null && tv.$('qrMini')._qr == null,
        { wall: onWall(tv), qr: [tv.$('qrBig')._qr, tv.$('qrMini')._qr] });
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
  feedTV(tv);
  check('while the numbers are called the TV has the board and its title, and still no join corner', shown(tv, 'tvRun') && !shown(tv, 'tvJoinCorner') && tv.$('tvRunTitle').style.display === '' && /\blit\b/.test(tv.$('tvb-' + first[0]).className),
        { wall: onWall(tv), cell: tv.$('tvb-' + first[0]).className });
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

  feedTV(tv);
  check('End game: the TV goes back to the ads and forgets it was a real-balls night', !onWall(tv).length && tv.state.caller === false, { wall: onWall(tv), caller: tv.state.caller });

  print('WINNER: a paper book shouts BINGO');
  WHO = 'host-win'; tv.at = LOG.length;
  var hw = bootHostC(null, WHO); await advance(50);
  var confirms = 0; hw.sb.confirm = function () { confirms++; return true; }; hw.sb.alert = function () { confirms++; };
  hw.$('prizeInput').value = '$50 bar tab'; hw.$('patternSel').value = 'one'; hw.$('cardsSel').value = '1'; hw.$('paidSel').value = '';
  hw.$('callerChk').checked = true; (hw.$('callerChk')._on.change || []).forEach(function (f) { f.call(hw.$('callerChk'), {}); });
  check('the setup button says what it does on a real-balls night', /Put bingo on the TV/.test(hw.$('startBtn').textContent) && !/scan/i.test(hw.$('startNote').textContent), [hw.$('startBtn').textContent, hw.$('startNote').textContent]);
  check('and the console drops the player count and its "scan the QR" panel: nobody joins on a phone', hw.$('playersPanel').style.display === 'none' && hw.$('setupStats').style.display === 'none' && !/join code/.test(hw.$('coach').innerHTML.replace(/No join code/, '')),
        [hw.$('playersPanel').style.display, hw.$('setupStats').style.display, hw.$('coach').innerHTML]);
  hw.openLobby(); await advance(9000); hw.startGame(); await advance(3000);
  [5, 17, 42, 66, 89].forEach(function (n) { tap(hw, n); });
  await advance(3000); feedTV(tv);
  function click(id) { var b = hw.$(id); (b._on.click || []).forEach(function (f) { f.call(b, { target: b, preventDefault: function () {} }); }); }
  function stageBtns() { return hw.$('cwStages').children; }
  function pickStage(pat) { var box = hw.$('cwStages'), b = stageBtns().filter(function (x) { return x.getAttribute('data-pat') === pat; })[0]; (box._on.click || []).forEach(function (f) { f.call(box, { target: b || box }); }); }
  var wins0 = hostSent('winner').length;
  click('callerWinBtn');
  check('WINNER asks, in the page, what was won: this pattern\'s stages in order', !hw.$('cwModal').classList.contains('hidden') && stageBtns().map(function (b) { return b.getAttribute('data-pat'); }).join() === 'one,two,full' && hostSent('winner').length === wins0,
        stageBtns().map(function (b) { return b.getAttribute('data-pat'); }));
  check('with the prize the host set up at the start already filled in', hw.$('cwPrize').value === '$50 bar tab', hw.$('cwPrize').value);
  click('cwCancel');
  check('Cancel puts nothing on the TV', hw.$('cwModal').classList.contains('hidden') && hostSent('winner').length === wins0 && !hw.G.callerWin);
  click('callerWinBtn'); pickStage('one'); await advance(500);
  var wmsg = hostSent('winner').slice(-1)[0];
  check('one tap on One line sends the winner message every screen already knows, marked real balls, with the prize', !!wmsg && wmsg.caller === true && wmsg.pattern === 'one' && wmsg.prize === '$50 bar tab' && wmsg.cont === false && hw.$('cwModal').classList.contains('hidden'), wmsg);
  check('and no browser dialog was used anywhere in it', confirms === 0, confirms);
  var c0 = { burst: CELEB.burst, fanfare: CELEB.fanfare };
  feedTV(tv);
  check('the TV: a full-screen BINGO! with the stage and the prize', shown(tv, 'tvWin') && !shown(tv, 'tvRun') && tv.$('winName').textContent === 'One line' && tv.$('winPrizeVal').textContent === '$50 bar tab',
        { wall: onWall(tv), name: tv.$('winName').textContent, prize: tv.$('winPrizeVal').textContent });
  check('telling the room "Show your book to the host", not to show a phone', tv.$('winSubPaper').style.display === '' && tv.$('winSubPhone').style.display === 'none' && /Show your book to the host/.test(readFile('venueplay/tv.html')),
        [tv.$('winSubPaper').style.display, tv.$('winSubPhone').style.display]);
  check('with the celebration (vp-celebrate.js: confetti and the fanfare)', CELEB.burst > c0.burst && CELEB.fanfare > c0.fanfare, [CELEB.burst - c0.burst, CELEB.fanfare - c0.fanfare]);
  check('the console shows what the TV says, with Back to the game', hw.$('callerBlock').classList.contains('winning') && hw.$('callerWinSays').textContent === 'BINGO! One line: $50 bar tab', hw.$('callerWinSays').textContent);
  var d0 = hw.G.draw.length; tap(hw, 33);
  check('a number tapped while the win is up is refused, so nothing hides the splash by accident', hw.G.draw.length === d0);
  await advance(20000); feedTV(tv);
  check('the splash stays up until the host closes it (it does not time out)', shown(tv, 'tvWin'), onWall(tv));
  var hello0 = hostSent('winner').length;
  hw.onMsg({ t: 'tv_here', hello: true }); await advance(500);
  var b0 = CELEB.fanfare; feedTV(tv);
  check('a TV that reloads mid-win is shown the win again, and the others do not fanfare twice', hostSent('winner').length === hello0 + 1 && shown(tv, 'tvWin') && CELEB.fanfare === b0, [hostSent('winner').length - hello0, CELEB.fanfare - b0]);
  var saved2 = JSON.parse(JSON.stringify(hw.dom.localStorage._s));
  click('callerBackBtn'); await advance(500); feedTV(tv);
  check('Back to the game: one tap, and every TV is back on the board', shown(tv, 'tvRun') && !shown(tv, 'tvWin') && !shown(tv, 'tvJoinCorner') && !hw.G.callerWin && !hw.$('callerBlock').classList.contains('winning'), onWall(tv));
  check('the line win is on the night\'s record and the room plays on for Two lines, for the same prize', hw.G.prizesWon.length === 1 && hw.G.prizesWon[0].pattern === 'one' && hw.G.prizesWon[0].prize === '$50 bar tab' && hw.G.pattern === 'two' && tv.$('tvPattern').textContent === 'Two lines',
        { won: hw.G.prizesWon, pattern: hw.G.pattern, tv: tv.$('tvPattern').textContent });
  tap(hw, 33); await advance(300);
  check('and the grid calls numbers again', hw.G.draw.length === d0 + 1);
  click('callerWinBtn');
  check('the next WINNER starts from Two lines', stageBtns().map(function (b) { return b.getAttribute('data-pat'); }).join() === 'two,full');
  pickStage('two'); await advance(500); feedTV(tv);
  click('callerNotWinBtn'); await advance(500); feedTV(tv);
  check('Not a win after all: the TV goes back to the board and nothing is recorded', shown(tv, 'tvRun') && hw.G.prizesWon.length === 1 && hw.G.pattern === 'two' && !hw.G.callerWin, { won: hw.G.prizesWon.length, pattern: hw.G.pattern });
  click('callerWinBtn'); pickStage('full'); await advance(500); feedTV(tv);
  check('a full house on the TV', shown(tv, 'tvWin') && tv.$('winName').textContent === 'Full house' && tv.$('winPrizeVal').textContent === '$50 bar tab', tv.$('winName').textContent);
  click('callerBackBtn'); await advance(500); feedTV(tv);
  var d1 = hw.G.draw.length; tap(hw, 34);
  check('closed, the full house ends the game: the grid and WINNER wait for New game', hw.G.won === true && hw.G.prizesWon.length === 2 && hw.G.draw.length === d1 && hw.$('callerWinBtn').disabled === true && shown(tv, 'tvRun'),
        { won: hw.G.won, prizes: hw.G.prizesWon.length });
  check('New game asks to start the next game, not to deal tickets', (function () { click('newGameBtn'); return !hw.$('ngModal').classList.contains('hidden') && hw.$('ngGo').textContent === 'Start next game' && !/tickets/i.test(hw.$('ngNote').textContent); })(),
        [hw.$('ngGo').textContent, hw.$('ngNote').textContent]);
  hw.$('ngModal').classList.add('hidden');
  print('a reload of the console with the win on the TV');
  retire(WHO);
  var hw2 = bootHostC(saved2, 'host-win'); await advance(3000);
  check('comes back to the win, with Back to the game', !!hw2.G.callerWin && hw2.G.callerWin.pattern === 'one' && hw2.$('callerBlock').classList.contains('winning'), hw2.G.callerWin);
  hw2.endGame(); await advance(3000);
  var lastRep = (DB.vp_game_reports || []).slice(-1)[0] || {};
  check('End game with a win still up counts it on the night\'s report, and closes the night', hw2.G.status === 'setup' && !liveSession() && Array.isArray(lastRep.prizes) && lastRep.prizes.some(function (z) { return z.pattern === 'one' && z.prize === '$50 bar tab' && z.winner_name === 'Paper book'; }),
        { status: hw2.G.status, open: !!liveSession(), prizes: lastRep.prizes });
  retire('host-win');
  print('the normal winner card is untouched');
  tv.onMsg({ t: 'started', pattern: 'one', prize: 'Meat tray', caller: false });
  tv.onMsg({ t: 'winner', pid: 'p1', name: 'Ann', cardNo: 12, pattern: 'one', prize: 'Meat tray', winners: [{ pid: 'p1', name: 'Ann', cardNo: 12 }], shared: false, cont: false });
  check('CONTROL: a phone win still names the winner, the card, and "show your phone to the host"', shown(tv, 'tvWin') && tv.$('winName').textContent === 'Ann' && tv.$('winCard').textContent === '#12' && tv.$('winSubPhone').style.display === '' && tv.$('winSubPaper').style.display === 'none',
        { name: tv.$('winName').textContent, card: tv.$('winCard').textContent });

  print('a phone (375px wide): the arithmetic of the shipped CSS');
  /* Nothing in jsc lays a page out, so this reads the numbers the phone rule sets and does the
     sum a browser would: the page gutter, the panel border and padding, the grid's bleed into the
     padding, nine gaps. The pixels themselves were measured in headless Chrome at 375px. */
  var mq = (CONSOLE_SRC.match(/@media \(max-width:420px\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  function px(re) { var m = re.exec(mq); return m ? m.slice(1).map(Number) : null; }
  var wrapP = px(/\.wrap:has\(#bingoView\.callermode:not\(\.hidden\)\)\{padding:(\d+)px (\d+)px\}/), panP = px(/#bingoView\.callermode \.panel\{padding:(\d+)px (\d+)px\}/),
      gridG = px(/\.callergrid\{gap:(\d+)px;margin:0 -(\d+)px\}/), minH = px(/\.cg\{min-height:(\d+)px/);
  var border = 1, cell = (wrapP && panP && gridG) ? (375 - 2 * wrapP[1] - 2 * border - 2 * panP[1] + 2 * gridG[1] - 9 * gridG[0]) / 10 : 0;
  check('at 375px each of the 90 numbers is at least 34px wide and tall, ten across, with no sideways scroll', cell >= 34 && minH && minH[0] >= 34 && gridG[1] <= panP[1], { cell: cell, minH: minH, wrap: wrapP, panel: panP, grid: gridG });

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
