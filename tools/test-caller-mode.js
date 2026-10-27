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
   WINNER button (reworked 21 Oct 2026, after Dean played it): no question, the pattern being played
   is named and the TV shows BINGO? while the host checks the book; Confirm win celebrates it on every
   TV with the prize; then the host CHOOSES keep playing for the next pattern or finish, and the
   pattern never moves by itself. Not a win records nothing.

   Run from the repo root:  jsc tools/test-caller-mode.js */
var CONSOLE_SRC = readFile('venueplay/app/index.html');
load('tools/rig-game-worker.js');
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0, EXPECT = 117;
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
   PostgREST has no keys, and a fake that cannot refuse a repeat cannot show that it is refused.
   Since migration 103 both keys hold for the balls that STAND (withdrawn_at is null): a withdrawn
   row stays beside the next ball in its place, and its number can be called again. PRE103 is the
   database before 103 is run: no withdrawn_at column (PostgREST refuses a filter or a write on it,
   400 naming the column, as the real one does), and the old whole-table keys. */
var PRE103 = false;
var RACE = false;   // the next mark lands after another Undo already marked the ball: PostgREST answers no rows
function standing(r) { return PRE103 || r.withdrawn_at == null; }
var _rigFetch = fetch;
fetch = async function (url, opts) {
  if (RACE && /\/rest\/v1\/vp_bingo_draw_balls/.test(String(url)) && String((opts && opts.method) || '').toUpperCase() === 'PATCH') { RACE = false; return resp(200, []); }
  if (PRE103 && /\/rest\/v1\/vp_bingo_draw_balls/.test(String(url))) {
    var m0 = String((opts && opts.method) || 'GET').toUpperCase();
    if (/withdrawn_at/.test(String(url))) return resp(400, { code: '42703', message: 'column vp_bingo_draw_balls.withdrawn_at does not exist' });
    if (m0 === 'PATCH' && /withdrawn_at/.test(String(opts.body))) return resp(400, { code: 'PGRST204', message: "Could not find the 'withdrawn_at' column of 'vp_bingo_draw_balls' in the schema cache" });
  }
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_players/.test(String(url))) {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) { if (r.kicked == null) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_bingo_draw_balls/.test(String(url))) {
    var rows = JSON.parse(opts.body); rows = Array.isArray(rows) ? rows : [rows];
    var have = DB.vp_bingo_draw_balls || [];
    var clash = rows.some(function (r) { return have.some(function (x) { return x.draw_id === r.draw_id && standing(x) && (x.number === r.number || x.ordinal === r.ordinal); }); });
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
    // The server deals and judges bingo since 19 Oct 2026, and a 4xx stops a game, so the rig answers these for real.
    if (p === '/host/bingo/deal') return await handleBingoDeal(req, ENV, json);
    if (p === '/host/bingo/claim') return await handleBingoClaim(req, ENV, json);
    if (p === '/host/bingo/claim/resolve') return await handleBingoClaimResolve(req, ENV, json);
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
  var ex = runPage(consoleScript(), sb, ["G", "startGame", "openLobby", "newGame", "endGame", "onMsg", "commitBall", "nextBall",
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
// The paper notice is the page's own #vPaper view since 20 Oct 2026 (it was a cover appended to the body): read it while it is SHOWN.
function notice(ph) { var v = ph.$('vPaper'); var shown = v && v.classList && !v.classList.contains('hidden') ? (v.innerHTML || '') : '';
  return shown + ' ' + ph.dom.document.body.children.map(function (n) { return n.innerHTML; }).join(' '); }
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
// The balls that STAND on the record (what the room plays to), and every row including the withdrawn.
function ballsOn(drawId) { return (DB.vp_bingo_draw_balls || []).filter(function (r) { return r.draw_id === drawId && r.withdrawn_at == null; }).sort(function (a, b) { return a.ordinal - b.ordinal; }); }
function rowsOn(drawId) { return (DB.vp_bingo_draw_balls || []).filter(function (r) { return r.draw_id === drawId; }); }
function withdrawnOn(drawId) { return rowsOn(drawId).filter(function (r) { return r.withdrawn_at != null; }); }
var SHUFFLES = 0, _shuffle = shuffle1to90;
shuffle1to90 = function () { SHUFFLES++; return _shuffle(); };

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
  check('CONTROL: and the server shuffles and stores its order of all 90, with its seed', SHUFFLES === 1 && Array.isArray(nDraw.draw_order) && nDraw.draw_order.length === 90 &&
        nDraw.draw_order.slice().sort(function (a, b) { return a - b; }).every(function (n, k) { return n === k + 1; }) && /^[0-9a-f]{32}$/.test(String(nDraw.draw_seed)),
        { shuffles: SHUFFLES, len: nDraw && nDraw.draw_order && nDraw.draw_order.length, seed: nDraw && nDraw.draw_seed });
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
  check('and no shuffle is made or stored on a real-balls night: an empty order, no seed', SHUFFLES === 1 && Array.isArray(draw.draw_order) && draw.draw_order.length === 0 && draw.draw_index === 0 && !/^[0-9a-f]{32}$/.test(String(draw.draw_seed)),
        { shuffles: SHUFFLES, order: draw && draw.draw_order, seed: draw && draw.draw_seed });
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
  check('the withdrawn ball no longer stands on the record', ballsOn(draw.id).length === 10 && !ballsOn(draw.id).some(function (r) { return r.number === 77; }), ballsOn(draw.id).map(function (r) { return r.number; }));
  var w77 = withdrawnOn(draw.id);
  check('but its row is KEPT, marked withdrawn with the time, where it was called (11th, by the tablet)', rowsOn(draw.id).length === 11 && w77.length === 1 && w77[0].number === 77 && w77[0].ordinal === 11 && w77[0].source === 'local' && !isNaN(Date.parse(w77[0].withdrawn_at)),
        rowsOn(draw.id).map(function (r) { return r.ordinal + ':' + r.number + (r.withdrawn_at ? ':W' : ''); }));
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
  check('the reload ignores the withdrawn 77: not in the called list, open on the grid, while its row is still on the record', host2.G.draw.indexOf(77) < 0 && host2.G.pool.indexOf(77) >= 0 && !/\bon\b/.test(cg(host2, 77).className) && withdrawnOn(draw.id).length === 1,
        { draw: host2.G.draw.indexOf(77), pool: host2.G.pool.indexOf(77) });
  var tvR = bootTV(); await advance(50);
  host2.onMsg({ t: 'tv_here', hello: true }); await advance(500);
  feedTV(tvR);
  check('a TV that comes up after the reload is given the board without the withdrawn 77', shown(tvR, 'tvRun') && !/\blit\b/.test(tvR.$('tvb-77').className) && /\blit\b/.test(tvR.$('tvb-' + before[0]).className),
        { wall: onWall(tvR), c77: tvR.$('tvb-77').className });

  print('the rest of the game, to all 90');
  var rest = order.filter(function (n) { return host2.G.draw.indexOf(n) < 0; });
  for (i = 0; i < rest.length; i++) { tap(host2, rest[i]); await advance(150); }
  check('all 90 numbers called, each exactly once', host2.G.draw.length === 90 && host2.G.draw.slice().sort(function (a, b) { return a - b; }).every(function (n, k) { return n === k + 1; }), host2.G.draw.length);
  check('the grid has nothing left to tap', host2.G.pool.length === 0);
  var allBalls = ballsOn(draw.id);
  check('the record holds 90 balls, ordinals 1 to 90, matching the room', allBalls.length === 90 && allBalls.every(function (r, k) { return r.ordinal === k + 1 && r.number === host2.G.draw[k]; }),
        allBalls.length);
  var r77 = rowsOn(draw.id).filter(function (r) { return r.number === 77; });
  check('the withdrawn 77 was called again later: it stands once, and its withdrawn row is still there beside it', r77.length === 2 && r77.filter(function (r) { return r.withdrawn_at == null; }).length === 1 && r77.filter(function (r) { return r.withdrawn_at != null && r.ordinal === 11; }).length === 1 &&
        r77.filter(function (r) { return r.withdrawn_at == null; })[0].number === host2.G.draw[r77.filter(function (r) { return r.withdrawn_at == null; })[0].ordinal - 1],
        r77.map(function (r) { return r.ordinal + (r.withdrawn_at ? ':W' : ''); }));
  check('the reason "caller" is still sent after the reload', fallbacksFor(draw.id).slice(-rest.length).every(function (f) { return f.reason === 'caller'; }));
  check('the server was never asked for a ball all game', BALLCALLS === bCaller && host2.G.draw.length === 90, BALLCALLS - bCaller);
  var dsBefore = hostSent('ball').length;   // the reloaded tablet's own count
  host2.callerUndo(); await advance(300);
  var lastBack = host2.G.pool[0];
  check('the Undo button takes back the 90th', host2.G.draw.length === 89 && host2.G.pool.length === 1 && ballsOn(draw.id).length === 89, host2.G.draw.length);
  tap(host2, lastBack); await advance(300);
  check('and it can be called again, onto the same place in the record', host2.G.draw.length === 90 && ballsOn(draw.id).length === 90 && ballsOn(draw.id)[89].number === lastBack && hostSent('ball').length === dsBefore + 1);
  check('the night\'s record reads in full: 90 standing, and both withdrawals kept and marked', rowsOn(draw.id).length === 92 && withdrawnOn(draw.id).length === 2 &&
        withdrawnOn(draw.id).some(function (r) { return r.number === lastBack && r.ordinal === 90; }), withdrawnOn(draw.id).map(function (r) { return r.ordinal + ':' + r.number; }));
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
  check('and the console drops the player count and its "scan the QR" panel: nobody joins on a phone', hw.$('playersPanel').style.display === 'none' && !/id="setupStats"/.test(CONSOLE_SRC) && !/join code/.test(hw.$('coach').innerHTML.replace(/No join code/, '')),
        [hw.$('playersPanel').style.display, /id="setupStats"/.test(CONSOLE_SRC), hw.$('coach').innerHTML]);
  hw.openLobby(); await advance(9000); hw.startGame(); await advance(3000);
  [5, 17, 42, 66, 89].forEach(function (n) { tap(hw, n); });
  await advance(3000); feedTV(tv);
  function click(id) { var b = hw.$(id); (b._on.click || []).forEach(function (f) { f.call(b, { target: b, preventDefault: function () {} }); }); }
  function nextBtns() { return hw.$('cwNextBtns').children; }
  function nextList() { return nextBtns().map(function (b) { return b.getAttribute('data-next'); }).join(); }
  function pickNext(h, pat) { var box = h.$('cwNextBtns'), b = box.children.filter(function (x) { return x.getAttribute('data-next') === pat; })[0]; (box._on.click || []).forEach(function (f) { f.call(box, { target: b || box }); }); return !!b; }
  function hid(h, id) { return h.$(id).classList.contains('hidden'); }
  /* ARE YOU SURE (Dean, 25 Oct 2026): New game on a game that has not reached a full house says so first. */
  var _focus = []; hw.$('ngCancel').focus = function () { _focus.push('ngCancel'); };
  click('newGameBtn');
  check('New game before anyone has won: "not reached a full house yet. No one has won yet.", "Yes, start a new game", Cancel focused',
        !hw.$('ngModal').classList.contains('hidden') && hw.$('ngWarn').style.display === '' && hw.$('ngWarn').textContent === 'This game has not reached a full house yet. No one has won yet.' &&
        hw.$('ngGo').textContent === 'Yes, start a new game' && _focus.join() === 'ngCancel', [hw.$('ngWarn').style.display, hw.$('ngWarn').textContent, hw.$('ngGo').textContent, _focus]);
  hw.$('ngCancel').onclick();   // the modal's buttons are wired with onclick
  check('Cancel: nothing changed, the same game is still on', hw.$('ngModal').classList.contains('hidden') && hw.G.draw.length === 5 && hw.G.status === 'running', [hw.G.draw.length, hw.G.status]);
  var wins0 = hostSent('winner').length, cl0 = hostSent('claim_pending').length, c00 = CELEB.fanfare;
  click('callerWinBtn'); await advance(300);
  check('WINNER asks nothing: the pattern chosen at the start is named, "Winner! One line"', !!hw.G.callerWin && hw.G.callerWin.step === 'check' && hw.G.callerWin.pattern === 'one' &&
        hw.$('callerWinHead').textContent === 'Winner!' && hw.$('callerWinSays').textContent === 'One line' && !/id="cwModal"|>What have they won/.test(CONSOLE_SRC),
        [hw.$('callerWinHead').textContent, hw.$('callerWinSays').textContent, hw.G.callerWin]);
  check('with one instruction: check the book for one whole row, then tap Confirm win', /Check their book/.test(hw.$('callerWinHow').textContent) && /one whole row/.test(hw.$('callerWinHow').textContent) && /Confirm win/.test(hw.$('callerWinHow').textContent) &&
        !hid(hw, 'cwCheck') && hid(hw, 'cwNext') && />Confirm win<\/button>/.test(CONSOLE_SRC) && />Not a win, keep playing<\/button>/.test(CONSOLE_SRC), [hw.$('callerWinHow').textContent, hid(hw, 'cwCheck'), hid(hw, 'cwNext')]);
  check('nothing is celebrated yet: no winner message and no fanfare before the book is checked', hostSent('winner').length === wins0 && CELEB.fanfare === c00 && hw.G.prizesWon.length === 0);
  var cmsg = hostSent('claim_pending').slice(-1)[0];
  feedTV(tv);
  check('every TV: BINGO? One line, "The host is checking the book"', hostSent('claim_pending').length === cl0 + 1 && cmsg.caller === true && shown(tv, 'tvClaim') && !shown(tv, 'tvWin') &&
        tv.$('claimName').textContent === 'One line' && /host is checking the book/.test(tv.$('claimSub').textContent),
        { wall: onWall(tv), name: tv.$('claimName').textContent, sub: tv.$('claimSub').textContent });
  check('and the console coach says the same', /BINGO for <b>One line<\/b>/.test(hw.$('coach').innerHTML) && /Confirm win/.test(hw.$('coach').innerHTML), hw.$('coach').innerHTML);
  var d0 = hw.G.draw.length; tap(hw, 33);
  check('a number tapped while the book is checked is refused', hw.G.draw.length === d0);
  var c0 = { burst: CELEB.burst, fanfare: CELEB.fanfare };
  click('callerConfirmBtn'); await advance(500);
  var wmsg = hostSent('winner').slice(-1)[0];
  check('Confirm win sends the winner message every screen already knows, marked real balls, with the prize', !!wmsg && wmsg.caller === true && wmsg.pattern === 'one' && wmsg.prize === '$50 bar tab' && wmsg.cont === false, wmsg);
  check('and the line win goes on the night\'s record, once', hw.G.prizesWon.length === 1 && hw.G.prizesWon[0].pattern === 'one' && hw.G.prizesWon[0].prize === '$50 bar tab', hw.G.prizesWon);
  check('and no browser dialog was used anywhere in it', confirms === 0, confirms);
  feedTV(tv);
  check('the TV: a full-screen BINGO! with the pattern and the prize', shown(tv, 'tvWin') && !shown(tv, 'tvRun') && tv.$('winName').textContent === 'One line' && tv.$('winPrizeVal').textContent === '$50 bar tab',
        { wall: onWall(tv), name: tv.$('winName').textContent, prize: tv.$('winPrizeVal').textContent });
  check('telling the room "See the host to collect your prize", not to show a phone', tv.$('winSubPaper').style.display === '' && tv.$('winSubPhone').style.display === 'none' && /See the host to collect your prize/.test(readFile('venueplay/tv.html')),
        [tv.$('winSubPaper').style.display, tv.$('winSubPhone').style.display]);
  check('with the celebration (vp-celebrate.js: confetti and the fanfare)', CELEB.burst > c0.burst && CELEB.fanfare > c0.fanfare, [CELEB.burst - c0.burst, CELEB.fanfare - c0.fanfare]);
  check('THE PATTERN DOES NOT MOVE BY ITSELF: still One line on the console and the TV', hw.G.pattern === 'one' && hw.$('patternSel').value === 'one' && tv.$('tvPattern').textContent === 'One line' && hw.G.won === false,
        { pattern: hw.G.pattern, tv: tv.$('tvPattern').textContent });
  check('the console asks the host what next: keep playing for Two lines, for Full house, or finish this game', hw.$('callerWinHead').textContent === 'Win confirmed' && hid(hw, 'cwCheck') && !hid(hw, 'cwNext') && nextList() === 'two,full,' &&
        /Keep playing for Two lines/.test(nextBtns()[0].innerHTML) && /Keep playing for Full house/.test(nextBtns()[1].innerHTML) && /Finish this game/.test(nextBtns()[2].innerHTML) && /What happens next/.test(hw.$('callerWinHow').textContent),
        nextList());
  check('with the prize already filled in for whatever comes next', hw.$('cwNextPrize').value === '$50 bar tab', hw.$('cwNextPrize').value);
  tap(hw, 33);
  check('a number tapped while the host is choosing is refused', hw.G.draw.length === d0);
  await advance(20000); feedTV(tv);
  check('the winner stays on the TV until the host chooses (it does not time out)', shown(tv, 'tvWin') && hw.G.pattern === 'one', onWall(tv));
  var hello0 = hostSent('winner').length;
  hw.onMsg({ t: 'tv_here', hello: true }); await advance(500);
  var b0 = CELEB.fanfare; feedTV(tv);
  check('a TV that reloads mid-win is shown the win again, and the others do not fanfare twice', hostSent('winner').length === hello0 + 1 && shown(tv, 'tvWin') && CELEB.fanfare === b0, [hostSent('winner').length - hello0, CELEB.fanfare - b0]);
  var saved2 = JSON.parse(JSON.stringify(hw.dom.localStorage._s));
  hw.$('cwNextPrize').value = 'Meat tray';
  pickNext(hw, 'two'); await advance(500); feedTV(tv);
  check('Keep playing for Two lines: one tap, and every TV is back on the board', shown(tv, 'tvRun') && !shown(tv, 'tvWin') && !shown(tv, 'tvJoinCorner') && !hw.G.callerWin && !hw.$('callerBlock').classList.contains('winning'), onWall(tv));
  check('naming the next pattern and its prize, because the host chose them', hw.G.pattern === 'two' && hw.G.prize === 'Meat tray' && tv.$('tvPattern').textContent === 'Two lines' && tv.$('tvPrize').textContent === 'Meat tray' && hw.G.prizesWon.length === 1,
        { pattern: hw.G.pattern, tv: tv.$('tvPattern').textContent, prize: tv.$('tvPrize').textContent });
  tap(hw, 33); await advance(300);
  check('and the grid calls numbers again', hw.G.draw.length === d0 + 1);
  click('callerWinBtn'); await advance(300); feedTV(tv);
  check('the next WINNER is checked for Two lines', hw.$('callerWinSays').textContent === 'Two lines' && /two whole rows/.test(hw.$('callerWinHow').textContent) && tv.$('claimName').textContent === 'Two lines', hw.$('callerWinSays').textContent);
  click('callerNotWinBtn'); await advance(500); feedTV(tv);
  check('Not a win: the TV goes back to the board, nothing is recorded, still Two lines', shown(tv, 'tvRun') && hw.G.prizesWon.length === 1 && hw.G.pattern === 'two' && !hw.G.callerWin && hostSent('winner').length === hello0 + 1, { won: hw.G.prizesWon.length, pattern: hw.G.pattern });
  click('callerWinBtn'); click('callerConfirmBtn'); await advance(500); feedTV(tv);
  check('two lines confirmed: the only way on is Full house, or finish', hw.G.prizesWon.length === 2 && nextList() === 'full,' && hw.G.pattern === 'two' && shown(tv, 'tvWin') && tv.$('winName').textContent === 'Two lines', nextList());
  pickNext(hw, 'full'); await advance(500); feedTV(tv);
  check('Keep playing for Full house', hw.G.pattern === 'full' && tv.$('tvPattern').textContent === 'Full house' && shown(tv, 'tvRun'), hw.G.pattern);
  click('callerWinBtn'); click('callerConfirmBtn'); await advance(500); feedTV(tv);
  check('a full house on the TV', shown(tv, 'tvWin') && tv.$('winName').textContent === 'Full house' && tv.$('winPrizeVal').textContent === 'Meat tray', tv.$('winName').textContent);
  var d1 = hw.G.draw.length; tap(hw, 34);
  check('a confirmed full house ends the game: nothing to choose, the grid and WINNER wait for New game', hw.G.won === true && hw.G.prizesWon.length === 3 && !hw.G.callerWin && hw.G.draw.length === d1 && hw.$('callerWinBtn').disabled === true && /That game is done/.test(hw.$('coach').innerHTML),
        { won: hw.G.won, prizes: hw.G.prizesWon.length });
  check('New game after a full house: no warning, it asks to start the next game, not to deal tickets', (function () { click('newGameBtn'); return !hw.$('ngModal').classList.contains('hidden') && hw.$('ngGo').textContent === 'Start next game' && !/tickets/i.test(hw.$('ngNote').textContent) && hw.$('ngWarn').style.display === 'none'; })(),
        [hw.$('ngGo').textContent, hw.$('ngNote').textContent, hw.$('ngWarn').style.display]);
  hw.$('ngModal').classList.add('hidden');
  print('a reload of the console while the host is choosing what next');
  retire(WHO);
  var hw2 = bootHostC(saved2, 'host-win'); await advance(3000);
  var nb2 = hw2.$('cwNextBtns').children.map(function (b) { return b.getAttribute('data-next'); }).join();
  check('comes back to the confirmed win and the same choice', !!hw2.G.callerWin && hw2.G.callerWin.step === 'won' && hw2.G.callerWin.pattern === 'one' && hw2.$('callerBlock').classList.contains('winning') && nb2 === 'two,full,', [hw2.G.callerWin, nb2]);
  var rs0 = hostSent('resume').length, st0 = hostSent('state').length;
  var fin = pickNext(hw2, ''); await advance(500);
  check('Finish this game: the game is done, still One line, and the winner stays on the TV', fin && hw2.G.won === true && !hw2.G.callerWin && hw2.G.pattern === 'one' && hostSent('resume').length === rs0 && hostSent('state').length === st0, { won: hw2.G.won, pattern: hw2.G.pattern });
  (hw2.$('newGameBtn')._on.click || []).forEach(function (f) { f.call(hw2.$('newGameBtn'), {}); });
  check('New game after finishing on One line: "It finished on One line.", and the button asks "Yes, start a new game"',
        hw2.$('ngWarn').style.display === '' && hw2.$('ngWarn').textContent === 'This game has not reached a full house yet. It finished on One line.' && hw2.$('ngGo').textContent === 'Yes, start a new game',
        [hw2.$('ngWarn').textContent, hw2.$('ngGo').textContent]);
  hw2.$('ngModal').classList.add('hidden');
  hw2.endGame(); await advance(3000);
  var lastRep = (DB.vp_game_reports || []).slice(-1)[0] || {};
  check('End game: the confirmed line is on the night\'s report, once, and the night closes', hw2.G.status === 'setup' && !liveSession() && Array.isArray(lastRep.prizes) && lastRep.prizes.filter(function (z) { return z.pattern === 'one' && z.prize === '$50 bar tab' && z.winner_name === 'Paper book'; }).length === 1,
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
  // The server must itself have failed to serve ball 1 before it takes one from the tablet (migration 105):
  // it was asked for place 1 (what bingoRecordAsk writes) and the place is empty.
  ndRow.ball_asked_ordinal = 1;
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
  var cdRow = DB.vp_bingo_draws.filter(function (d) { return d.id === cd.body.draw_id; })[0];
  var sh0 = SHUFFLES;
  check('a caller:true draw opened directly stores no shuffle, and keeps the record that it is local, reason caller', cdRow && cdRow.draw_order.length === 0 && cdRow.mode === 'local' && cdRow.fallback_why === 'caller' && cdRow.fallback_at === 1 && SHUFFLES === sh0, cdRow);
  var w20 = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 2, reason: 'caller', withdraw: true });
  check('the Worker withdraws the last call by MARKING it: the row stays, withdrawn_at set', w20.status === 200 && w20.body.kept === true && rowsOn(cd.body.draw_id).length === 2 && withdrawnOn(cd.body.draw_id).length === 1 && withdrawnOn(cd.body.draw_id)[0].number === 20, [w20.status, w20.body, rowsOn(cd.body.draw_id)]);
  var w20b = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 2, reason: 'caller', withdraw: true });
  check('a second Undo of the same ball is refused, and nothing more is marked', w20b.status === 409 && withdrawnOn(cd.body.draw_id).length === 1, w20b.status);
  var w10 = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 10, ordinal: 1, reason: 'caller', withdraw: true });
  check('the "last call" the Worker checks ignores the withdrawn row: 10 is now the last standing ball and can be taken back', w10.status === 200 && withdrawnOn(cd.body.draw_id).length === 2, [w10.status, w10.body]);
  var re20 = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 1, reason: 'caller' });
  check('a withdrawn number can be called again, into the place it left', re20.status === 200 && ballsOn(cd.body.draw_id).length === 1 && ballsOn(cd.body.draw_id)[0].number === 20 && ballsOn(cd.body.draw_id)[0].ordinal === 1 && rowsOn(cd.body.draw_id).length === 3, [re20.status, rowsOn(cd.body.draw_id)]);
  var re20b = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 2, reason: 'caller' });
  check('and once it stands again it is refused a second time', re20b.status === 409 && ballsOn(cd.body.draw_id).length === 1, re20b.status);
  RACE = true;
  var wr = await worker('/host/bingo/fallback', { draw_id: cd.body.draw_id, number: 20, ordinal: 1, reason: 'caller', withdraw: true });
  check('an Undo that marks nothing (another got there first) is refused, not reported as kept', wr.status === 409 && RACE === false, [wr.status, wr.body]);
  var srv = DB.vp_bingo_draw_balls.filter(function (r) { return r.draw_id === nd.body.draw_id; })[0];
  check('CONTROL: the normal night\'s ball was never marked', !!srv && srv.withdrawn_at == null && rowsOn(nd.body.draw_id).length === 1, srv);

  print('before migration 103 is run (no withdrawn_at column): the old behaviour, so either order is safe');
  PRE103 = true;
  var pd = await worker('/host/bingo/draw', { venue_id: VENUE, caller: true });
  await worker('/host/bingo/fallback', { draw_id: pd.body.draw_id, number: 31, ordinal: 1, reason: 'caller' });
  await worker('/host/bingo/fallback', { draw_id: pd.body.draw_id, number: 32, ordinal: 2, reason: 'caller' });
  var pw = await worker('/host/bingo/fallback', { draw_id: pd.body.draw_id, number: 32, ordinal: 2, reason: 'caller', withdraw: true });
  check('the Undo still works: the ball comes off as it always did, and the reply says it was not kept', pw.status === 200 && pw.body.kept === false && rowsOn(pd.body.draw_id).length === 1 && rowsOn(pd.body.draw_id)[0].number === 31, [pw.status, pw.body, rowsOn(pd.body.draw_id)]);
  var pr = await worker('/host/bingo/fallback', { draw_id: pd.body.draw_id, number: 32, ordinal: 2, reason: 'caller' });
  check('and the number can be called again into the same place', pr.status === 200 && ballsOn(pd.body.draw_id).length === 2, pr.status);
  var pn = await worker('/host/bingo/fallback', { draw_id: pd.body.draw_id, number: 31, ordinal: 1, reason: 'caller', withdraw: true });
  check('the last-call rule still holds there too', pn.status === 409, pn.status);
  PRE103 = false;

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
