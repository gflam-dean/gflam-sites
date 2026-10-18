/* THE SERVER DEALS THE BINGO TICKETS AND DECIDES THE BINGO (Dean, 19 Oct 2026: "Lets go the server").

   Until 19 Oct 2026 the console on the host's tablet made every phone ticket and checked every
   BINGO against its own copy. Now the game Worker deals each phone's tickets into its own table
   (/host/bingo/deal, migration 104), the console only carries them to the phones, and a BINGO is
   decided by the Worker from its own ticket and its own record of the balls (/host/bingo/claim).
   The night must still survive the Worker going quiet: a slow answer is waited for, a dead one
   hands that game's deal (or that claim's check) to the tablet, labelled, and the record is filled
   in when the Worker is back.

   This RUNS it, end to end: the REAL bingo console (app/index.html) and REAL phone pages
   (play.html) on one channel (tools/rig-bingo-room.js), against the REAL game Worker handlers
   (tools/rig-game-worker.js: /host/bingo/draw, ball, fallback, seat, deal, claim, claim/resolve,
   /join and friends) over a fake database. Only the network and the database are fakes; the one
   database function it stands in for is vp_bingo_next_ball (migration 70), which the rig's
   PostgREST cannot run.

   Run from the repo root:  jsc tools/test-bingo-server-tickets.js */
load('tools/rig-game-worker.js');
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 400) : '')); }
}
/* A random source that mixes every bit (the rig's LCG has weak low bits, and randInt reads them). */
globalThis.crypto.getRandomValues = function (b) { for (var i = 0; i < b.length; i++) b[i] = (b instanceof Uint32Array) ? Math.floor(Math.random() * 4294967296) : Math.floor(Math.random() * 256); return b; };

/* ---- one clock for both rigs ---- */
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
drain = async function () { for (var r = 0; r < 8; r++) { for (var i = 0; i < 80; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };

/* ---- the database: the rig's PostgREST, plus table defaults and vp_bingo_next_ball ---- */
var _rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/rpc\/vp_bingo_next_ball/.test(u)) {
    var p = JSON.parse(opts.body).p_draw, d = DB.vp_bingo_draws.filter(function (x) { return x.id === p; })[0];
    if (!d || d.draw_index >= d.draw_order.length) return resp(200, []);
    d.draw_index++;
    var n = d.draw_order[d.draw_index - 1];
    DB.vp_bingo_draw_balls.push({ draw_id: p, ordinal: d.draw_index, number: n, source: 'server', drawn_at: new Date().toISOString(), withdrawn_at: null });
    return resp(200, [{ number: n, new_index: d.draw_index }]);
  }
  if (m === 'POST' && /\/rest\/v1\/(vp_players|vp_bingo_draws|vp_bingo_tickets|vp_bingo_claims|vp_bingo_draw_balls)(\?|$)/.test(u)) {
    var b = JSON.parse(opts.body), t = /\/rest\/v1\/(\w+)/.exec(u)[1];
    (Array.isArray(b) ? b : [b]).forEach(function (r) {
      if (t === 'vp_players' && r.kicked == null) r.kicked = false;
      if (t === 'vp_bingo_draws') { if (r.mode == null) r.mode = 'server'; if (r.finished_at === undefined) r.finished_at = null; if (r.created_at == null) r.created_at = new Date().toISOString(); }
      if (t === 'vp_bingo_tickets') { if (r.voided_at === undefined) r.voided_at = null; if (r.dealt_at === undefined) r.dealt_at = null; if (r.card_no === undefined) r.card_no = null; }
      if (t === 'vp_bingo_claims') { if (r.status == null) r.status = 'pending'; if (r.claimed_at == null) r.claimed_at = new Date().toISOString(); }
      if (t === 'vp_bingo_draw_balls') { if (r.withdrawn_at === undefined) r.withdrawn_at = null; if (r.drawn_at == null) r.drawn_at = new Date().toISOString(); }
    });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  return _rigFetch(url, opts);
};

CODE = fnvVenueCode('test-pub');
DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD' }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_claims: [],
       vp_game_reports: [], vp_gaming_declarations: [], vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [] };
var SESS = [];
function openSession() {
  DB.vp_sessions.forEach(function (s) { if (s.status !== 'finished') s.status = 'finished'; });
  var id = 'aaaaaaaa-aaaa-4aaa-8aaa-' + ('000000000000' + (SESS.length + 1)).slice(-12);
  DB.vp_sessions.push({ id: id, venue_id: VENUE, status: 'lobby', join_code: CODE, lobby_format: 'bingo90', plan_cap_at_start: 100,
                        overage_approved: false, created_at: new Date().toISOString(), state_version: 1 });
  SESS.push(id);
  return { status: 200, body: { session_id: id, join_code: CODE, plan_cap: 100 } };
}
var CALLS = [];
async function worker(path, body, headers, who) {
  var q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q), h = headers || {};
  var req = { _body: body || {}, url: 'https://game.test' + path, headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } };
  if (who === 'host') CALLS.push(p);
  try {
    if (p === '/join') return await handleJoin(req, ENV, json);
    if (p === '/join/info') return await handleJoinInfo(req, ENV, json);
    if (p === '/play/live') return await handlePlayLive(req, ENV, json);
    if (p === '/player/alive') return await handlePlayerAlive(req, ENV, json);
    if (p === '/report') return await handleReport(req, ENV, json);
    if (p === '/session') return openSession();
    if (p === '/session/close') return await handleSessionClose(req, ENV, json);
    if (p === '/snapshot') return await handleSnapshot(req, ENV, json);
    if (p === '/host/overage/ack') return await handleOverageAck(req, ENV, json);
    if (p === '/host/bingo/seat') return await handleBingoSeat(req, ENV, json);
    if (p === '/host/bingo/draw') return await handleBingoDrawStart(req, ENV, json);
    if (p === '/host/bingo/ball') return await handleBingoBall(req, ENV, json);
    if (p === '/host/bingo/fallback') return await handleBingoFallback(req, ENV, json);
    if (p === '/host/bingo/deal') return await handleBingoDeal(req, ENV, json);
    if (p === '/host/bingo/claim') return await handleBingoClaim(req, ENV, json);
    if (p === '/host/bingo/claim/resolve') return await handleBingoClaimResolve(req, ENV, json);
    return { status: 404, body: { error: 'not routed: ' + p } };
  } catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
/* A SLOW route answers after that many ms. Past the caller's own timeout it is an outage: the
   console's request is aborted, as vp-session.js gameApiCall aborts it, and the Worker never sees it. */
var SLOW = {}, DEAD = 1e9;
function pageFetch(who) {
  return function (url, opts) {
    var path = String(url).replace(/^https?:\/\/[^\/]+/, ''), o = opts || {};
    var body = o.body ? JSON.parse(o.body) : {};
    return worker(path, body, o.headers, who).then(function (r) { return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } }; });
  };
}
function bootHost3() {
  var dom = makeDom(""), sb = baseSandbox(dom, "host");
  var ctx = { authed: true, scope: "staff", role: "owner", isAdmin: false, currentVenueId: VENUE, user: { user_metadata: { name: "Dean" } },
              venue: { id: VENUE, slug: "test-pub", name: "Test Pub", status: "active", max_players: 100, created_at: "2026-01-01T00:00:00Z" }, staff: [{ venue_id: VENUE }] };
  var VP = { useClient: function () {}, ready: function () { return Promise.resolve(ctx); }, refresh: function () { return Promise.resolve(ctx); }, suspensionBanner: function () {},
    venueCode: function () { return CODE; }, venueJoinCode: function () { return Promise.resolve(null); },
    getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
    gameApiPost: function (path, body) { if ((SLOW[path] || 0) >= DEAD) return Promise.resolve(null); return worker(path, body, {}, 'host').then(function (r) { return r.body; }); },
    gameApiCall: function (path, body, timeoutMs) {
      var ms = timeoutMs || 4000, slow = SLOW[path] || 0, done = false;
      return new Promise(function (res, rej) {
        fSetTimeout(function () { if (!done) { done = true; rej(new Error('timed out')); } }, ms);
        if (slow < DEAD) fSetTimeout(function () { if (done) return; worker(path, body, {}, 'host').then(function (r) { if (!done) { done = true; res({ status: r.status, json: r.body }); } }); }, slow);
      });
    },
    setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
    homeHref: function () { return "index.html"; } };
  sb.VP = VP; dom.window.VP = VP;
  var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
  sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
  sb.fetch = pageFetch('host-page');
  var toasts = [];
  var ex = runPage(inlineScript("venueplay/app/index.html"), sb, ["G", "startGame", "openLobby", "newGame", "endGame", "onMsg", "nextBall",
    "hostConfirm", "hostReject", "keepPlaying", "finishGame", "dealSoon", "checkPattern", "renderClaimQueue", "showToast"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); };
  return ex;
}
function bootPhone3(name) {
  var dom = makeDom("?room=" + CODE), sb = baseSandbox(dom, "phone:" + name);
  sb.fetch = pageFetch(name);
  var ex = runPage(inlineScript("venueplay/play.html"), sb, ["P", "onMsg", "pressBingo", "join", "route"]);
  ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); }; ex.name = name;
  return ex;
}

/* ---- reading the record ---- */
function lastDraw() { return DB.vp_bingo_draws[DB.vp_bingo_draws.length - 1]; }
function ticketsOf(drawId, pid, all) { return DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === drawId && t.pid === pid && (all || (t.dealt_at && !t.voided_at)); })
  .sort(function (a, b) { return (a.book - b.book) || (a.page - b.page); }); }
function rows3(c) { return [c.slice(0, 9), c.slice(9, 18), c.slice(18, 27)]; }
function nums(cells) { var o = []; (Array.isArray(cells[0]) ? [].concat(cells[0], cells[1], cells[2]) : cells).forEach(function (v) { if (v) o.push(v); }); return o; }
function claimsFor(pid) { return DB.vp_bingo_claims.filter(function (c) { return c.pid === pid; }); }
function lastClaim(pid) { var l = claimsFor(pid); return l[l.length - 1] || null; }
function phoneMatchesRecord(ph, drawId) {
  var rec = ticketsOf(drawId, ph.P.pid);
  return rec.length === ph.P.cards.length && rec.length > 0 && rec.every(function (t, i) {
    return ph.P.cards[i].cardNo === t.card_no && JSON.stringify(ph.P.cards[i].cells) === JSON.stringify(rows3(t.cells)); });
}
/* An independent judge of a ticket and a strip, written here from the rules of housie, not lifted
   from the code under test. */
function COLR(c) { return c === 0 ? [1, 9] : (c === 8 ? [80, 90] : [c * 10, c * 10 + 9]); }
function goodTicket(cells) {
  if (!Array.isArray(cells) || cells.length !== 27) return false;
  for (var r = 0; r < 3; r++) { var n = 0; for (var c = 0; c < 9; c++) if (cells[r * 9 + c]) n++; if (n !== 5) return false; }
  for (var c2 = 0; c2 < 9; c2++) { var last = 0, k = 0, rg = COLR(c2);
    for (var r2 = 0; r2 < 3; r2++) { var v = cells[r2 * 9 + c2]; if (!v) continue; if (v < rg[0] || v > rg[1] || v <= last) return false; last = v; k++; }
    if (k < 1) return false; }
  return true;
}
function coversOnce(list) { var seen = {}, n = 0; for (var i = 0; i < list.length; i++) { var a = nums(list[i]); for (var j = 0; j < a.length; j++) { if (seen[a[j]]) return false; seen[a[j]] = 1; n++; } } return n === 90; }
function hostSaid(t, test) { return LOG.filter(function (l) { return l && l.from === 'host' && l.p && l.p.t === t && (!test || test(l.p)); }); }
function queueHtml(host) { return host.$('claimQueue').innerHTML; }
function confirmDisabled(host) { var m = /<button class="btn win" data-act="confirm"[^>]*>/.exec(queueHtml(host)); return !!m && / disabled/.test(m[0]); }
async function callBalls(host, n) { for (var i = 0; i < n; i++) { host.nextBall(); await advance(6000); } }
// Put these numbers at the front of the server's own order for the game, so the test knows what comes out.
function frontOfDraw(numbers) {
  var d = lastDraw(), rest = d.draw_order.slice(d.draw_index).filter(function (x) { return numbers.indexOf(x) < 0; });
  d.draw_order = d.draw_order.slice(0, d.draw_index).concat(numbers.filter(function (x) { return d.draw_order.slice(0, d.draw_index).indexOf(x) < 0; }), rest);
}

(async function () {
  print('the server deals and judges: the generator and the rule');
  (function () {
    var bad = 0;
    for (var i = 0; i < 300; i++) { var s = generateStrip(); if (!(s.length === 6 && s.every(goodTicket) && coversOnce(s))) bad++; }
    check('300 strips from the server: every ticket a valid housie ticket, every strip 1 to 90 exactly once', bad === 0, bad + ' bad');
    // The console's own checkPattern, lifted from the shipped page, against the server's rule, on the same tickets.
    var html = readFile('venueplay/app/index.html');
    function grab(n) { var i0 = html.indexOf('function ' + n + '('), d = 0, st = false; for (var j = i0; j < html.length; j++) { if (html[j] === '{') { d++; st = true; } else if (html[j] === '}') { d--; if (st && !d) return html.slice(i0, j + 1); } } }
    var G = { called: {}, pattern: 'one' };
    var f = new Function('G', ['isCalled', 'rowComplete', 'completeRows', 'cornerNums', 'checkPattern'].map(grab).join('\n') + '\nreturn checkPattern;');
    var consoleCheck = f(G), disagree = [], wins = 0;
    ['one', 'two', 'full', 'top', 'middle', 'bottom', 'corners'].forEach(function (pat) {
      for (var k = 0; k < 400; k++) {
        var t = generateStrip()[k % 6], set = new Set(), take = 10 + Math.floor(Math.random() * 70);
        G.called = {}; G.pattern = pat;
        var pool = []; for (var n = 1; n <= 90; n++) pool.push(n);
        // half the time, make sure the ticket's own rows are in the called set, so wins are common
        if (k % 2) nums(t).forEach(function (v) { if (Math.random() < 0.85) { set.add(v); G.called[v] = true; } });
        for (var z = 0; z < take; z++) { var v2 = pool[Math.floor(Math.random() * pool.length)]; set.add(v2); G.called[v2] = true; }
        var s1 = bingoTicketWins(t, set, pat).win, s2 = !!consoleCheck(rows3(t));
        if (s1) wins++;
        if (s1 !== s2 && disagree.length < 3) disagree.push({ pat: pat, t: t, server: s1, console: s2 });
      }
    });
    check('the server and the console agree on all seven patterns over 2,800 tickets (and wins are not rare: ' + wins + ')', !disagree.length && wins > 400, disagree);
  })();

  var host = bootHost3(); await advance(50);
  var ann = bootPhone3('Ann'), bob = bootPhone3('Bob'), cat = bootPhone3('Cat');
  var stranger = bootPhone3('Stranger'); stranger.sb.fetch = function () { return Promise.reject(new Error('off-site')); };
  await advance(50);
  [[ann, 'Ann'], [bob, 'Bob'], [cat, 'Cat'], [stranger, 'Dazza']].forEach(function (x) { x[0].$('nameIn').value = x[1]; x[0].join(); });
  await advance(6000);
  var phones = [ann, bob, cat];

  print('GAME ONE: three tickets each, dealt by the server');
  host.$('prizeInput').value = 'Meat tray'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '3'; host.$('paidSel').value = '';
  host.openLobby(); await advance(9000);
  host.startGame(); await advance(3000);
  var D1 = lastDraw().id;
  check('the server opened a draw and dealt every phone three tickets on it',
        phones.every(function (ph) { return ticketsOf(D1, ph.P.pid).length === 3 && ticketsOf(D1, ph.P.pid).every(function (t) { return t.source === 'server'; }); }),
        phones.map(function (ph) { return ticketsOf(D1, ph.P.pid).length; }));
  check('each phone shows exactly the server\'s tickets: the same numbers, the same cells', phones.every(function (ph) { return phoneMatchesRecord(ph, D1); }),
        phones.map(function (ph) { return [ph.P.cards.length, ph.P.cards[0] && ph.P.cards[0].cardNo]; }));
  check('the tablet made none of them: nothing on the record is the tablet\'s, and the console\'s copies say server',
        DB.vp_bingo_tickets.filter(function (t) { return t.source === 'tablet'; }).length === 0 &&
        phones.every(function (ph) { return host.G.players[ph.P.pid].cards.every(function (c) { return c.src === 'server'; }); }));
  check('a hand is three pages of one strip, and that strip holds 1 to 90 exactly once',
        phones.every(function (ph) { var all = ticketsOf(D1, ph.P.pid, true); return all.length === 6 && all.every(function (t) { return t.book === 0; }) && coversOnce(all.map(function (t) { return t.cells; })); }));
  var nos = DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === D1 && t.card_no != null; }).map(function (t) { return t.card_no; });
  check('every ticket number in the game is different, so "ticket 437" names one ticket', nos.length === 9 && nos.every(function (n, i) { return nos.indexOf(n) === i; }), nos);
  var undealt = DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === D1 && !t.dealt_at; });
  var sentCells = hostSaid('cards').map(function (l) { return JSON.stringify(l.p.cards.map(function (c) { return c.cells; })); }).join('|');
  check('the pages nobody was dealt never left the server', undealt.length === 9 && undealt.every(function (t) { return sentCells.indexOf(JSON.stringify(rows3(t.cells))) < 0; }), undealt.length);
  check('the stranger with no server identity was dealt nothing, by the server or the tablet',
        stranger.P.cards.length === 0 && DB.vp_bingo_tickets.filter(function (t) { return t.pid === stranger.P.pid; }).length === 0);

  // The server's order is shuffled; put Ann's first ticket's top row at the front of it.
  var annTop = nums(ann.P.cards[0].cells[0]), annMid = nums(ann.P.cards[0].cells[1]);
  frontOfDraw(annTop.concat(annMid));
  await callBalls(host, 5);
  check('the five balls came from the server\'s order, on its record as server balls',
        JSON.stringify(host.G.draw) === JSON.stringify(annTop) && DB.vp_bingo_draw_balls.filter(function (b) { return b.draw_id === D1 && b.source === 'server'; }).length === 5,
        host.G.draw);

  print('a rigged ticket: the tablet\'s copy and the phone both edited to show a line that is not on the server\'s ticket');
  var catCard = [annTop.slice(0, 5).concat([0, 0, 0, 0]), [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]];
  host.G.players[cat.P.pid].cards[0].card = catCard; cat.P.cards[0].cells = catCard;
  SLOW['/host/bingo/claim'] = 1500;
  cat.pressBingo(); await advance(600);
  check('the claim shows at once, says the server is checking, and Confirm is greyed out', /Cat/.test(queueHtml(host)) && /Checking with the server/.test(queueHtml(host)) && confirmDisabled(host),
        queueHtml(host).slice(0, 200));
  var drawn = host.G.draw.length; host.nextBall(); await advance(100);
  check('and no ball can be called past it', host.G.draw.length === drawn);
  await advance(2000);
  check('the SERVER\'s verdict overrules the tablet: not a win, off the queue', !/Cat/.test(queueHtml(host)) && host.G.claims.length === 0, queueHtml(host).slice(0, 200));
  check('her phone is released, told not yet', cat.P.claimPending === false && /not yet/i.test(cat.$('pMsg').innerHTML), cat.$('pMsg').innerHTML);
  check('and the false claim is on the record: not a win, rejected', !!lastClaim(cat.P.pid) && lastClaim(cat.P.pid).verdict === 'not_yet' && lastClaim(cat.P.pid).status === 'rejected', lastClaim(cat.P.pid));
  SLOW = {};

  print('a phone that lies about the numbers called');
  var bobRows = nums(bob.P.cards[0].cells[0]);
  bob.P.called = bob.P.called.concat(bobRows);
  var pendingBefore = hostSaid('claim_pending').length;
  bob.pressBingo(); await advance(2500);
  check('the server says not yet, and the room never sees it: no claim card, nothing on the TV', host.G.claims.length === 0 && hostSaid('claim_pending').length === pendingBefore && bob.P.claimPending === false,
        { claims: host.G.claims.length, pending: hostSaid('claim_pending').length - pendingBefore, phone: bob.P.claimPending });
  check('and it is on the record as not a win, on the five balls actually out', !!lastClaim(bob.P.pid) && lastClaim(bob.P.pid).verdict === 'not_yet' && lastClaim(bob.P.pid).balls === 5, lastClaim(bob.P.pid));

  print('a real win');
  await advance(2500);
  ann.pressBingo(); await advance(800);
  var annClaim = lastClaim(ann.P.pid);
  check('Ann\'s BINGO is decided by the server: a win, on its ticket, on five balls', !!annClaim && annClaim.verdict === 'win' && annClaim.balls === 5 && annClaim.card_no === ann.P.cards[0].cardNo && annClaim.decided_on === 'server', annClaim);
  check('the host is told the server checked it, and Confirm is live', /checked by the server/.test(queueHtml(host)) && !confirmDisabled(host), queueHtml(host).slice(0, 300));
  host.hostConfirm(0); await advance(500);
  check('the host\'s Confirm goes on the record', lastClaim(ann.P.pid).status === 'confirmed' && !!lastClaim(ann.P.pid).resolved_at, lastClaim(ann.P.pid));
  host.$('nextPatternSel').value = 'two'; host.$('nextPrizeIn').value = '$50'; host.keepPlaying(); await advance(300);

  print('the server goes quiet while Ann claims two lines');
  await callBalls(host, 5);
  SLOW['/host/bingo/claim'] = DEAD; SLOW['/host/bingo/claim/resolve'] = DEAD;
  ann.pressBingo(); await advance(1000);
  check('for the first seconds the host is told it is being checked, and cannot confirm', /Checking with the server/.test(queueHtml(host)) && confirmDisabled(host));
  await advance(3500);
  check('after four seconds the TABLET\'s check stands in, says so, and Confirm comes back', /Valid on this tablet/.test(queueHtml(host)) && /server did not answer/.test(queueHtml(host)) && !confirmDisabled(host),
        queueHtml(host).slice(0, 400));
  var before = claimsFor(ann.P.pid).length;
  host.hostConfirm(0); await advance(500);
  check('the host confirms; with the server down nothing is on its record yet', claimsFor(ann.P.pid).length === before && (host.G.claimLog || []).length === 1, (host.G.claimLog || []).length);
  SLOW = {};
  await advance(20000);
  var late = lastClaim(ann.P.pid);
  check('when it is back, the claim goes on the record: decided on the tablet, the server\'s own check agrees, confirmed',
        claimsFor(ann.P.pid).length === before + 1 && late.decided_on === 'tablet' && late.tablet_verdict === 'win' && late.verdict === 'win' && late.status === 'confirmed' && late.pattern === 'two',
        late);
  host.finishGame(); await advance(300);
  host.endGame(); await advance(3000);

  print('GAME TWO: a paid night, tickets bought one at a time');
  host.$('paidSel').value = 'ticket'; host.$('paidSel')._on.change && host.$('paidSel')._on.change.forEach(function (f) { f(); });
  host.openLobby(); await advance(9000);
  host.startGame(); await advance(3000);
  var D2 = lastDraw().id;
  check('nobody has paid yet, so nobody is dealt', phones.every(function (ph) { return ph.P.cards.length === 0; }) && DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === D2; }).length === 0);
  var heldNos = [];
  for (var k = 1; k <= 6; k++) {
    host.G.players[ann.P.pid].paid = k; host.dealSoon(0); await advance(1500);
    heldNos.push(ann.P.cards.map(function (c) { return c.cardNo; }).join(','));
  }
  check('each purchase keeps the tickets already held: nothing she was marking is re-dealt',
        heldNos.every(function (s, i) { return i === 0 || s.indexOf(heldNos[i - 1]) === 0; }) && ann.P.cards.length === 6, heldNos);
  check('six tickets bought one at a time are ONE strip from the server: 1 to 90 exactly once', coversOnce(ann.P.cards.map(function (c) { return c.cells; })) && phoneMatchesRecord(ann, D2));
  host.G.players[ann.P.pid].paid = 4; host.dealSoon(0); await advance(1500);
  var voided = ticketsOf(D2, ann.P.pid, true).filter(function (t) { return t.voided_at; });
  check('a sale taken back voids the newest two on the server, and the rows stay', ann.P.cards.length === 4 && voided.length === 2 && phoneMatchesRecord(ann, D2),
        { phone: ann.P.cards.length, voided: voided.length });
  SLOW['/host/bingo/deal'] = 2000;
  host.G.players[bob.P.pid].paid = 1; host.dealSoon(0); await advance(1000);
  check('a slow server: the ticket is not there yet, and the tablet has not made one', bob.P.cards.length === 0);
  await advance(2500);
  check('a moment later the server deals it', bob.P.cards.length === 1 && phoneMatchesRecord(bob, D2), bob.P.cards.length);
  SLOW = {};
  host.endGame(); await advance(3000);

  print('GAME THREE: the server cannot deal at all');
  host.$('paidSel').value = ''; host.$('paidSel')._on.change && host.$('paidSel')._on.change.forEach(function (f) { f(); });
  host.$('cardsSel').value = '1';
  host.openLobby(); await advance(9000);
  SLOW['/host/bingo/deal'] = DEAD;
  host.startGame(); await advance(500);
  check('a new game takes last game\'s tickets off the phone, which says its tickets are on the way',
        ann.P.cards.length === 0 && /on the way/.test(ann.$('waitNote').innerHTML), ann.$('waitNote').innerHTML);
  await advance(2500);
  host.nextBall(); await advance(100);
  check('for a few seconds the server is asked again, and Start calling waits, saying why', host.G.draw.length === 0 && host.$('nextBtn').textContent === 'Dealing tickets...' && phones.every(function (ph) { return ph.P.cards.length === 0; }),
        { balls: host.G.draw.length, btn: host.$('nextBtn').textContent });
  await advance(7000);
  check('then the tablet deals every phone, and the console is usable again', phones.every(function (ph) { return ph.P.cards.length === 1; }) && host.G.dealMode === 'tablet' && host.$('nextBtn').textContent === 'Start calling',
        { cards: phones.map(function (ph) { return ph.P.cards.length; }), mode: host.G.dealMode, btn: host.$('nextBtn').textContent });
  var D3 = lastDraw().id;
  SLOW = {};
  await advance(20000);
  check('when the server answers again, the tablet\'s tickets go on its record, marked as the tablet\'s',
        phones.every(function (ph) { var r = ticketsOf(D3, ph.P.pid); return r.length === 1 && r[0].source === 'tablet' && r[0].card_no === ph.P.cards[0].cardNo && JSON.stringify(rows3(r[0].cells)) === JSON.stringify(ph.P.cards[0].cells); }),
        phones.map(function (ph) { return ticketsOf(D3, ph.P.pid).length; }));
  frontOfDraw(nums(ann.P.cards[0].cells[0]));
  await callBalls(host, 5);
  ann.pressBingo(); await advance(800);
  check('a claim on a recorded tablet ticket is still decided by the server', !!lastClaim(ann.P.pid) && lastClaim(ann.P.pid).verdict === 'win' && lastClaim(ann.P.pid).decided_on === 'server' && /checked by the server/.test(queueHtml(host)),
        lastClaim(ann.P.pid));
  host.hostConfirm(0); await advance(300); host.finishGame(); await advance(300);
  host.endGame(); await advance(3000);

  print('GAME FOUR: real balls, the room plays paper books');
  host.$('callerChk').checked = true;
  var dealCalls = CALLS.filter(function (p) { return p === '/host/bingo/deal'; }).length;
  host.openLobby(); await advance(9000); host.startGame(); await advance(5000);
  check('the server is never asked to deal, and the console holds no ticket for anybody', CALLS.filter(function (p) { return p === '/host/bingo/deal'; }).length === dealCalls &&
        Object.keys(host.G.players).every(function (pid) { return !(host.G.players[pid].cards || []).length; }));
  host.endGame(); await advance(3000);
  host.$('callerChk').checked = false;

  print('the Worker\'s own rules, asked directly');
  var D5 = (await worker('/host/bingo/draw', { venue_id: VENUE, session_id: SESS[SESS.length - 1] }, {}, 'direct')).body.draw_id;
  var annDid = ann.dom.localStorage.getItem('vpDeviceId');
  DB.vp_players.filter(function (p) { return p.device_id === annDid; }).forEach(function (p) { p.session_id = SESS[SESS.length - 1]; p.kicked = false; });
  var r1 = await worker('/host/bingo/deal', { draw_id: D5, hands: [{ pid: ann.P.pid, did: annDid, want: 2 }, { pid: 'k1_nobodyhere', did: 'nobody-device', want: 2 }] }, {}, 'direct');
  var r2 = await worker('/host/bingo/deal', { draw_id: D5, hands: [{ pid: ann.P.pid, did: annDid, want: 2 }] }, {}, 'direct');
  check('a phone that is not in the session is refused tickets by the server', r1.status === 200 && r1.body.refused.indexOf('k1_nobodyhere') >= 0 && !r1.body.hands.k1_nobodyhere, r1.body.refused);
  check('the same deal asked twice deals nothing new and answers the same hand', r2.status === 200 && JSON.stringify(r2.body.hands[ann.P.pid]) === JSON.stringify(r1.body.hands[ann.P.pid]) &&
        DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === D5; }).length === 6, DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === D5; }).length);
  var t0 = r1.body.hands[ann.P.pid][0], row0 = nums(t0.cells[0]);
  var c1 = await worker('/host/bingo/claim', { draw_id: D5, ref: 'ref-direct-1', pid: ann.P.pid, card_no: t0.card_no, pattern: 'top', balls: 5, called: row0 }, {}, 'direct');
  check('on a draw the server is calling, the tablet cannot add numbers to make a claim win', c1.status === 200 && c1.body.verdict === 'not_yet' && !!c1.body.note &&
        DB.vp_bingo_draw_balls.filter(function (b) { return b.draw_id === D5; }).length === 0, c1.body);
  var c2 = await worker('/host/bingo/claim', { draw_id: D5, ref: 'ref-direct-1', pid: ann.P.pid, card_no: t0.card_no, pattern: 'top', balls: 5, called: row0 }, {}, 'direct');
  check('the same claim sent twice is one claim on the record', c2.body.claim_id === c1.body.claim_id && DB.vp_bingo_claims.filter(function (c) { return c.ref === 'ref-direct-1'; }).length === 1);
  var c3 = await worker('/host/bingo/claim', { draw_id: D5, ref: 'ref-direct-2', pid: ann.P.pid, card_no: t0.card_no, pattern: 'top', balls: 5, called: row0, tablet_draw: true, tablet_why: 'test' }, {}, 'direct');
  var balls5 = DB.vp_bingo_draw_balls.filter(function (b) { return b.draw_id === D5; });
  check('on a draw the tablet has taken over, its unreported balls go on the record in order, and the claim is judged on them',
        c3.body.verdict === 'win' && balls5.length === 5 && balls5.every(function (b, i) { return b.source === 'local' && b.number === row0[i] && b.ordinal === i + 1; }) &&
        DB.vp_bingo_draws.filter(function (d) { return d.id === D5; })[0].mode === 'local', c3.body);
  var c4 = await worker('/host/bingo/claim', { draw_id: D5, ref: 'ref-direct-3', pid: ann.P.pid, card_no: 99999, pattern: 'top', balls: 5 }, {}, 'direct');
  check('a claim on a number they do not hold is checked on the ticket of theirs that wins, and says so', c4.body.verdict === 'win' && c4.body.swapped === true && c4.body.card_no === t0.card_no, c4.body);

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' server ticket checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
