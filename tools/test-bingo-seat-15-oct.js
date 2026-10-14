/* ONE PERSON IS ONE PLAYER, IN EVERY GAME OF THE NIGHT, AND ONLY PEOPLE WHO ARE REALLY THERE.

   The 14 Oct 2026 audit, by playing: from the second game of a night a phone that stayed on the
   page never joined the new server session (the join code is the venue's code now, the same for
   every session, and the phone only re-joined when the code changed). Six people played game
   three and the meter counted one. The other way round, anybody with the public code could POST
   /join with made-up pids and be billed with no phone, and anybody on the channel could sign a
   join from anywhere and be dealt tickets without ever being counted.

   This plays a night of THREE games with the REAL bingo console (app/index.html) and FOUR REAL
   phone pages (play.html) on one channel (tools/rig-bingo-room.js), against the REAL game Worker
   handlers (tools/rig-game-worker.js: handleJoin, handlePlayLive, handleJoinInfo, handleReport,
   handleBingoSeat, handleOverageAck, handleSessionClose, and playerIdsWhoPlayed, which is what
   chargeNightOverage bills from). Plus a stranger on the channel with no server identity, ten
   ghost joins with no phone, a phone whose /join is slow, and the Worker going down.
   Then the smaller things the same audit found on the same screens.

   Run from the repo root:  jsc tools/test-bingo-seat-15-oct.js */
load('tools/rig-game-worker.js');
var _wShow = show;                 // the Worker rig's counters: this suite keeps its own
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
/* ---- one clock for both rigs: the room's virtual time, on the Worker's fixed day ---- */
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
// The real Worker runs many awaits per request; give every tick room to finish them.
drain = async function () { for (var r = 0; r < 6; r++) { for (var i = 0; i < 60; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };
// The real table defaults kicked to false; the fake one has no defaults.
var _rigFetch = fetch;
fetch = async function (url, opts) {
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_players/.test(String(url))) {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) { if (r.kicked == null) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  return _rigFetch(url, opts);
};

/* ---- the Worker, routed to its real handlers ---- */
/* The room meets on the channel hashed from the venue's slug, and the Worker tells a phone on any
   other channel to move there, so the rig's made-up code is replaced by the real hash. */
CODE = fnvVenueCode('test-pub');
var SA_SLUG = 'sa-pub', SA_CODE = fnvVenueCode(SA_SLUG), SA_VENUE = '33333333-3333-4333-8333-333333333333';
DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD' },
                   { id: SA_VENUE, name: 'SA Pub', slug: SA_SLUG, status: 'active', join_code: SA_CODE, au_state: 'SA' }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [],
       vp_trivia_answers: [], vp_claims: [], vp_game_reports: [], vp_gaming_declarations: [] };
var SESS = [], JOINS = [], SEATCALLS = 0, DOWN = false;
function openSession() {
  DB.vp_sessions.forEach(function (s) { if (s.status !== 'finished') s.status = 'finished'; });
  var id = 'aaaaaaaa-aaaa-4aaa-8aaa-' + ('000000000000' + (SESS.length + 1)).slice(-12);
  DB.vp_sessions.push({ id: id, venue_id: VENUE, status: 'lobby', join_code: CODE, lobby_format: 'bingo90', plan_cap_at_start: 2,
                        overage_approved: false, created_at: new Date().toISOString(), state_version: 1 });
  SESS.push(id);
  return { status: 200, body: { session_id: id, join_code: CODE, plan_cap: 2 } };
}
function liveSid() { var s = DB.vp_sessions.filter(function (x) { return x.status !== 'finished'; })[0]; return s ? s.id : null; }
async function worker(path, body, headers, who) {
  var q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q), h = headers || {};
  var req = { _body: body || {}, url: 'https://game.test' + path, headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } };
  try {
    if (p === '/join') { JOINS.push({ who: who, sid: liveSid(), pid: body.pid }); return await handleJoin(req, ENV, json); }
    if (p === '/join/info') return await handleJoinInfo(req, ENV, json);
    if (p === '/play/live') return await handlePlayLive(req, ENV, json);
    if (p === '/player/alive') return await handlePlayerAlive(req, ENV, json);
    if (p === '/report') return await handleReport(req, ENV, json);
    if (p === '/session') return openSession();
    if (p === '/session/close') return await handleSessionClose(req, ENV, json);
    if (p === '/host/bingo/seat') { SEATCALLS++; return await handleBingoSeat(req, ENV, json); }
    if (p === '/host/overage/ack') return await handleOverageAck(req, ENV, json);
    if (p === '/snapshot') return await handleSnapshot(req, ENV, json);
    return { status: 404, body: { error: 'not routed: ' + p } };
  } catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function pageFetch(who, gate) {
  return function (url, opts) {
    var path = String(url).replace(/^https?:\/\/[^\/]+/, ''), o = opts || {};
    var body = o.body ? JSON.parse(o.body) : {};
    return (gate ? gate(path, body) : Promise.resolve()).then(function () { return worker(path, body, o.headers, who); })
      .then(function (r) { return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } }; });
  };
}

/* ---- the console and the phones: the rig's boot, with the Worker wired in ---- */
function bootHost2(cap) {
  var dom = makeDom(""), sb = baseSandbox(dom, "host");
  var ctx = { authed: true, scope: "staff", role: "owner", isAdmin: false, currentVenueId: "v1", user: { user_metadata: { name: "Dean" } },
              venue: { id: "v1", slug: "test-pub", name: "Test Pub", status: "active", max_players: cap, created_at: "2026-01-01T00:00:00Z" }, staff: [{ venue_id: "v1" }] };
  var VP = { useClient: function () {}, ready: function () { return Promise.resolve(ctx); }, refresh: function () { return Promise.resolve(ctx); }, suspensionBanner: function () {},
    venueCode: function () { return CODE; }, venueJoinCode: function () { return Promise.resolve(null); },
    getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
    gameApiPost: function (path, body) { return worker(path, body, {}, 'host').then(function (r) { return r.body; }); },
    gameApiCall: function (path, body) { if (DOWN) return Promise.reject(new Error('worker down')); return worker(path, body, {}, 'host').then(function (r) { return { status: r.status, json: r.body }; }); },
    setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
    homeHref: function () { return "index.html"; } };
  sb.VP = VP; dom.window.VP = VP;
  var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
  sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
  sb.fetch = pageFetch('host');
  var ex = runPage(inlineScript("venueplay/app/index.html"), sb, ["G", "startGame", "openLobby", "newGame", "endGame", "onMsg", "commitBall",
    "hostConfirm", "keepPlaying", "finishGame", "playerCount", "shownName", "isSeated", "renderPlayers"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); };
  return ex;
}
function bootPhone2(name, opts) {
  opts = opts || {};
  var dom = makeDom(opts.search || ("?room=" + CODE), opts.store);
  var sb = baseSandbox(dom, "phone:" + name);
  if (opts.slug) sb.VPVenueURL = dom.window.VPVenueURL = { slug: function () { return opts.slug; } };
  sb.fetch = opts.fetch || pageFetch(name, opts.gate);
  var ex = runPage(inlineScript("venueplay/play.html"), sb, ["P", "onMsg", "pressBingo", "join", "route"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); }; ex.name = name;
  return ex;
}
function rowsIn(sid) { return DB.vp_players.filter(function (p) { return p.session_id === sid && !p.kicked; }); }
async function billed(sid) { return countPlayersWhoPlayed(rowsIn(sid), await playerIdsWhoPlayed(ENV, sid)); }
// Stamped as dealt by the console: what makes a bingo row a billed player (a session with no stamps
// at all falls back to counting every row, so the count alone could pass for the wrong reason).
function stampedIn(sid) { return rowsIn(sid).filter(function (p) { return !!p.played_at; }).length; }
function didOf(ph) { return ph.dom.localStorage.getItem('vpDeviceId'); }
function joinsFor(ph, sid) { return JOINS.filter(function (j) { return j.who === ph.name && j.sid === sid; }).length; }
function callRow(host, cells) {
  cells.filter(function (v) { return v; }).forEach(function (n) {
    var k = host.G.pool.indexOf(n); if (k >= 0) { host.G.pool.splice(k, 1); host.commitBall(n, false); }
  });
}
/* The console's check-in is a second road to the same place (it asks an unseated phone to join).
   Switched off for game two, so the phone's OWN rule is what is tested: a new session id on the
   state message means join again, whatever the join code says. */
var DROP_CHECKIN = false, _pump = pump;
pump = function () { if (DROP_CHECKIN) QUEUE = QUEUE.filter(function (q) { return !(q.payload && q.payload.t === 'checkin'); }); _pump(); };
function hostSays(t, pid) { return LOG.filter(function (l) { return l && l.from === 'host' && l.p && l.p.t === t && (!pid || l.p.pid === pid); }).length; }

(async function () {
  var host = bootHost2(2); await advance(50);
  var slowJoin = false;
  var ann = bootPhone2('Ann'), bob = bootPhone2('Bob'), mar1 = bootPhone2('Margaret A');
  var mar2 = bootPhone2('Margaret B', { gate: function (path) { return (slowJoin && path === '/join') ? new Promise(function (res) { fSetTimeout(res, 20000); }) : Promise.resolve(); } });
  // A stranger, anywhere: the same page on the same channel, but nothing it asks the Worker ever lands.
  var stranger = bootPhone2('Stranger', { fetch: function () { return Promise.reject(new Error('off-site, no server identity')); } });
  await advance(50);
  [[ann, 'Ann'], [bob, 'Bob'], [mar1, 'Margaret'], [mar2, 'Margaret'], [stranger, 'Dazza']].forEach(function (x) { x[0].$('nameIn').value = x[1]; x[0].join(); });
  await advance(6000);
  var phones = [ann, bob, mar1, mar2];

  print('GAME ONE: four phones, a stranger on the channel, ten ghosts on /join');
  host.$('prizeInput').value = 'Meat tray'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(9000);
  var S1 = SESS[0];
  for (var g = 0; g < 10; g++) await worker('/join', { code: CODE, pid: 'ghostpid' + g + 'xx', name: 'Ghost' }, {}, 'script');
  await advance(2000);
  check('every phone holds a row in the night\'s session, one each', phones.every(function (ph) { return rowsIn(S1).filter(function (r) { return r.device_id === didOf(ph); }).length === 1; }),
        phones.map(function (ph) { return rowsIn(S1).filter(function (r) { return r.device_id === didOf(ph); }).length; }));
  check('the console counts the four phones, not the stranger', host.playerCount() === 4, host.playerCount());
  check('and lists the stranger only as "checking in", never by name', host.$('playerList').innerHTML.indexOf('Dazza') < 0 && /\+1 checking in/.test(host.$('playerList').innerHTML),
        host.$('playerList').innerHTML);
  check('two phones both called Margaret are told apart on the console', /Margaret<\/span>/.test(host.$('playerList').innerHTML) && host.$('playerList').innerHTML.indexOf('Margaret (2)') >= 0,
        host.$('playerList').innerHTML);
  // The plan is 2, so Start asks for consent, and names who it is counting.
  host.startGame(); await advance(500);
  var ovg = host.$('ovgBody').innerHTML;
  check('the consent screen names the four people it is counting', /Counted tonight:/.test(ovg) && ['Ann', 'Bob', 'Margaret', 'Margaret (2)'].every(function (n) { return ovg.indexOf(n) >= 0; }), ovg.slice(-260));
  check('and not the stranger, and says what to do about somebody unknown', ovg.indexOf('Dazza') < 0 && /Someone you do not know\?/.test(ovg));
  host.$('ovgGo').onclick(); await advance(5000);
  check('the OK records the four the host was shown, not the 14 rows on the server', DB.vp_sessions.filter(function (s) { return s.id === S1; })[0].overage_approved_count === 4,
        DB.vp_sessions.filter(function (s) { return s.id === S1; })[0].overage_approved_count);
  check('each of the four phones was dealt a ticket', phones.every(function (ph) { return ph.P.cards.length === 1; }), phones.map(function (ph) { return ph.P.cards.length; }));
  check('the stranger was dealt NOTHING, and was asked to check in', stranger.P.cards.length === 0 && hostSays('checkin', stranger.P.pid) >= 1, hostSays('checkin', stranger.P.pid));
  var b1 = await billed(S1);
  check('GAME ONE: exactly the four phones are stamped as dealt', stampedIn(S1) === 4, stampedIn(S1));
  check('GAME ONE bills 4: the four phones, no ghost, no stranger', b1 === 4, b1 + ' billed of ' + rowsIn(S1).length + ' rows');
  check('the coach line gives way once the numbers start', /Tickets are out/.test(host.$('coach').innerHTML), host.$('coach').innerHTML);
  callRow(host, [host.G.pool[0]]); await advance(6000);
  check('... and after the first ball it no longer says "Tickets are out"', !/Tickets are out/.test(host.$('coach').innerHTML) && /1 of 90/.test(host.$('coach').innerHTML), host.$('coach').innerHTML);
  // A stranger shouting BINGO over and over: one refusal every two seconds, not one a shout.
  var before = hostSays('resume', stranger.P.pid);
  for (var c = 0; c < 10; c++) host.onMsg({ t: 'claim', pid: stranger.P.pid, name: 'Dazza', cardNo: 101 });
  await advance(100);
  check('ten refused claims inside a second make the console sign and send ONE refusal', hostSays('resume', stranger.P.pid) - before === 1, hostSays('resume', stranger.P.pid) - before);
  var calls0 = SEATCALLS; await advance(120000);
  check('the stranger costs the server a question a minute or so, not one every few seconds', SEATCALLS - calls0 <= 8, (SEATCALLS - calls0) + ' seat calls in two minutes');
  // End with no winner.
  host.endGame(); await advance(3000);
  check('a phone left after a game ended with no winner is told the game is over, not "you\'re in, waiting"',
        phones.every(function (ph) { return viewOf(ph) === 'vLost' && /That game is over/.test(ph.$('lostSub').innerHTML); }), phones.map(viewOf));
  check('and last game\'s "of 90" badge is gone from its header', phones.every(function (ph) { return ph.$('hdrBall').classList.contains('hidden'); }));

  print('GAME TWO: the same four phones never leave the page');
  DROP_CHECKIN = true;
  host.openLobby(); await advance(9000);
  DROP_CHECKIN = false;
  var S2 = SESS[1];
  check('CONTROL: a new lobby really is a new session', !!S2 && S2 !== S1);
  check('a new lobby puts the phones back on "you\'re in"', phones.every(function (ph) { return viewOf(ph) === 'vWait'; }), phones.map(viewOf));
  check('every phone joined the new session, once, on its own (no check-in reached it)', phones.every(function (ph) { return rowsIn(S2).filter(function (r) { return r.device_id === didOf(ph); }).length === 1 && joinsFor(ph, S2) === 1; }),
        phones.map(function (ph) { return joinsFor(ph, S2); }));
  host.startGame(); await advance(500); if (!host.$('ovgModal').classList.contains('hidden')) host.$('ovgGo').onclick();
  await advance(5000);
  var b2 = await billed(S2);
  check('GAME TWO: exactly the four phones are stamped as dealt', stampedIn(S2) === 4, stampedIn(S2));
  check('GAME TWO bills 4 (the fault: it billed only phones that arrived new)', b2 === 4, b2 + ' billed');
  // Ann wins a line, two lines and the house, on the same phone.
  var card = ann.P.cards[0].cells;
  callRow(host, card[0]); await advance(6000); ann.pressBingo(); await advance(200);
  host.hostConfirm(0); await advance(50); host.$('nextPatternSel').value = 'two'; host.$('nextPrizeIn').value = '$20'; host.keepPlaying(); await advance(200);
  callRow(host, card[1]); await advance(6000); ann.pressBingo(); await advance(200);
  host.hostConfirm(0); await advance(50); host.$('nextPatternSel').value = 'full'; host.$('nextPrizeIn').value = '$100'; host.keepPlaying(); await advance(200);
  callRow(host, card[2]); await advance(6000); ann.pressBingo(); await advance(200);
  host.hostConfirm(0); await advance(50); host.finishGame(); await advance(200);
  var also = ann.$('wonAlso');
  check('her YOU WON screen names all three prizes, not just the house',
        viewOf(ann) === 'vWon' && !also.classList.contains('hidden') && /One line/.test(also.innerHTML) && /Two lines/.test(also.innerHTML) && /\$100/.test(ann.$('wonPrize').textContent),
        { view: viewOf(ann), also: also.innerHTML, prize: ann.$('wonPrize').textContent });
  host.endGame(); await advance(3000);

  print('GAME THREE: Margaret B\'s phone is slow to reach the server');
  slowJoin = true;
  host.openLobby(); await advance(9000);
  var S3 = SESS[2];
  host.startGame(); await advance(500); if (!host.$('ovgModal').classList.contains('hidden')) host.$('ovgGo').onclick();
  await advance(3000);
  check('her phone is not dealt before the server knows it', mar2.P.cards.length === 0 && ann.P.cards.length === 1, [mar2.P.cards.length, ann.P.cards.length]);
  await advance(30000);
  check('her join lands and she is dealt in, mid-game, without a reload', mar2.P.cards.length === 1, mar2.P.cards.length);
  var b3 = await billed(S3);
  check('GAME THREE: exactly the four phones are stamped as dealt', stampedIn(S3) === 4, stampedIn(S3));
  check('GAME THREE bills 4: the audit saw this game counted as 1', b3 === 4, b3 + ' billed');
  check('across three games, each phone is exactly one row in each session',
        [S1, S2, S3].every(function (sid) { return phones.every(function (ph) { return rowsIn(sid).filter(function (r) { return r.device_id === didOf(ph); }).length === 1; }); }));
  check('and the stranger was never dealt a ticket all night', stranger.P.cards.length === 0, stranger.P.cards.length);
  host.endGame(); await advance(3000);

  print('GAME FOUR: the Worker goes down');
  DOWN = true; slowJoin = false;
  host.openLobby(); await advance(9000);
  host.startGame(); await advance(500); if (!host.$('ovgModal').classList.contains('hidden')) host.$('ovgGo').onclick();
  await advance(5000);
  check('bingo still deals with no answer from the server: every phone has a ticket', phones.every(function (ph) { return ph.P.cards.length === 1; }), phones.map(function (ph) { return ph.P.cards.length; }));
  DOWN = false; host.endGame(); await advance(3000);

  print('a regular back at a South Australian venue, off the table talker');
  var store = {}; store['vp-name-' + SA_CODE] = 'Pat';
  var pat = bootPhone2('Pat', { search: '?venue=' + SA_SLUG, slug: SA_SLUG, store: store });
  await advance(3000);
  var notice = pat.dom.document.body.children.map(function (n) { return n.innerHTML; }).join(' ');
  check('is shown the paper notice, though she joined before and never sees the name box', /play on paper/.test(notice), notice.slice(0, 80));
  var sentBefore = LOG.filter(function (l) { return l && l.from === 'phone:Pat'; }).length;
  pat.onMsg({ t: 'rollcall' }); await advance(2000);
  check('and her phone says nothing on the channel after it, so no console deals to it', LOG.filter(function (l) { return l && l.from === 'phone:Pat'; }).length === sentBefore);

  print('a code nobody holds');
  var typo = bootPhone2('Typo', { search: '?room=ZZZZZZ' });
  await advance(3000);
  check('is sent back to the code box, saying there is no such game', viewOf(typo) === 'vNoRoom' && /no game with the code ZZZZZZ/.test(typo.$('roomErr').textContent),
        { view: viewOf(typo), err: typo.$('roomErr').textContent });
  var good = bootPhone2('Good');
  await advance(3000);
  check('CONTROL: the venue\'s real code is not', viewOf(good) === 'vJoin', viewOf(good));

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' bingo seat checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
