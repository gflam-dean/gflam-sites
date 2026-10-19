/* VP-DRAW-1.1: THE REVIEW OF VP-DRAW-1.0 (19 Oct 2026), EACH FINDING RUN AS AN ATTACK OR A REAL OUTAGE.

   3  the server's record of a failed ball: written only after a REAL failure, only for a host who is staff
      at the venue, only for exactly the next place, never on the 4 second hold. A forged ordinal of 90
      unlocks nothing.
   4  a SLOW server, not a dead one: the console gives up on a ball after four seconds and calls it from
      the tablet; the server's ball lands later in the same place. The room's ball must stand and the
      server's be kept as VOID with its reason, so a claim is judged on the balls the room heard. The same
      for a deal: the tablet's tickets stand, the server's unseen ones are voided, in either order.
   5  vp_bingo_draws.finished_at is written by Finish game, End game, a new game and the session closing,
      never set by hand here, and a finished draw takes nothing more.

   The REAL console and phones (tools/rig-bingo-room.js) and the REAL Worker (tools/rig-game-worker.js)
   over a fake database. Run from the repo root:  jsc tools/test-vp-draw-11.js */
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
// The real Worker awaits many times per request. Give every tick enough turns that a request finishes at the
// virtual moment it was made, not at the next timer (a ball stamped late reads as the Worker's 4 second hold).
drain = async function () { for (var r = 0; r < 12; r++) { for (var i = 0; i < 400; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };

/* ---- the database: the rig's PostgREST, plus table defaults and vp_bingo_next_ball ---- */
var _rigFetch = fetch, FAILDEAL = false, FAILBALL = false;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/rpc\/vp_bingo_next_ball/.test(u)) {
    if (FAILBALL) return resp(500, { message: 'database unavailable' });
    var p = JSON.parse(opts.body).p_draw, d = DB.vp_bingo_draws.filter(function (x) { return x.id === p; })[0];
    if (!d || d.draw_index >= d.draw_order.length) return resp(200, []);
    d.draw_index++;
    var n = d.draw_order[d.draw_index - 1];
    DB.vp_bingo_draw_balls.push({ draw_id: p, ordinal: d.draw_index, number: n, source: 'server', drawn_at: new Date().toISOString(), withdrawn_at: null });
    return resp(200, [{ number: n, new_index: d.draw_index }]);
  }
  if (FAILDEAL && m === 'POST' && /\/rest\/v1\/vp_bingo_tickets/.test(u)) return resp(500, { message: 'database unavailable' });
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
    if (p === '/host/bingo/finish') return await handleBingoFinish(req, ENV, json);
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
        // SLOW means slow, not lost: the Worker still does the work at `slow` ms, even after the console gave up on the answer.
        if (slow < DEAD) fSetTimeout(function () { worker(path, body, {}, 'host').then(function (r) { if (!done) { done = true; res({ status: r.status, json: r.body }); } }); }, slow);
      });
    },
    setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
    homeHref: function () { return "index.html"; } };
  sb.VP = VP; dom.window.VP = VP;
  var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
  sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
  sb.fetch = pageFetch('host-page');
  var toasts = [];
  var ex = runPage(consoleScript(), sb, ["G", "startGame", "openLobby", "newGame", "endGame", "onMsg", "nextBall",
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
/* drain() first: the rig only runs pending promise work after the next TIMER, by which time its clock
   has jumped, so a tap's request would otherwise reach the Worker seconds late in virtual time. */
async function callBalls(host, n) { for (var i = 0; i < n; i++) { host.nextBall(); await drain(); await advance(6000); } }
// Put these numbers at the front of the server's own order for the game, so the test knows what comes out.
function frontOfDraw(numbers) {
  var d = lastDraw(), rest = d.draw_order.slice(d.draw_index).filter(function (x) { return numbers.indexOf(x) < 0; });
  d.draw_order = d.draw_order.slice(0, d.draw_index).concat(numbers.filter(function (x) { return d.draw_order.slice(0, d.draw_index).indexOf(x) < 0; }), rest);
}


function ballsOn(id, all) { return DB.vp_bingo_draw_balls.filter(function (b) { return b.draw_id === id && (all || !b.withdrawn_at); }).sort(function (a, b) { return a.ordinal - b.ordinal; }); }
function drawRow(id) { return DB.vp_bingo_draws.filter(function (d) { return d.id === id; })[0]; }
async function W(path, body) { return worker(path, body || {}, {}, 'direct'); }
function ballAt(id, n) { return { draw_id: id, ordinal: n, number: 0 }; }

(async function () {
  print('3. the record of a failed ball cannot be forged');
  var D = (await W('/host/bingo/draw', { venue_id: VENUE })).body.draw_id;
  var r = await W('/host/bingo/ball', { draw_id: D, ordinal: 1 });
  check('CONTROL: a ball served normally leaves no outage record', r.status === 200 && drawRow(D).ball_asked_ordinal == null, [r.status, drawRow(D).ball_asked_ordinal]);
  await advance(6000);   // past the 4 second hold, so the next request really reaches the draw
  FAILBALL = true;
  r = await W('/host/bingo/ball', { draw_id: D, ordinal: 90 });
  check('ATTACK: a failing ball asked for at place 90 records nothing (only the next place counts)', r.status >= 500 && drawRow(D).ball_asked_ordinal == null, [r.status, drawRow(D).ball_asked_ordinal]);
  var f = await W('/host/bingo/fallback', { draw_id: D, number: 50, ordinal: 90, reason: 'forged' });
  var f2 = await W('/host/bingo/fallback', { draw_id: D, number: 50, ordinal: 2, reason: 'forged' });
  check('and unlocks nothing: neither place 90 nor the next place takes a tablet ball', f.status === 409 && f2.status === 409 && drawRow(D).mode === 'server' && ballsOn(D).length === 1, [f.status, f2.status, drawRow(D).mode]);
  var realStaff = requireStaff;
  requireStaff = async function () { var e = new Error('Not authorised'); e.status = 403; throw e; };
  r = await W('/host/bingo/ball', { draw_id: D, ordinal: 2 });
  requireStaff = realStaff;
  check('ATTACK: a failing ball asked for by someone who is not staff at the venue records nothing', drawRow(D).ball_asked_ordinal == null, drawRow(D).ball_asked_ordinal);
  FAILBALL = false;
  r = await W('/host/bingo/ball', { draw_id: D, ordinal: 2 });   // ball 2 is served...
  var r3 = await W('/host/bingo/ball', { draw_id: D, ordinal: 3 });   // ...and ball 3 asked for at once: the hold
  check('ATTACK: a ball asked for during the 4 second hold is answered "wait", and that is not an outage', r.status === 200 && r3.status === 429 && drawRow(D).ball_asked_ordinal == null, [r.status, r3.status, drawRow(D).ball_asked_ordinal]);
  f = await W('/host/bingo/fallback', { draw_id: D, number: 50, ordinal: 3, reason: 'hold' });
  check('so the tablet cannot take place 3 on the back of it', f.status === 409 && drawRow(D).mode === 'server', f.status);
  await advance(6000); FAILBALL = true;
  r = await W('/host/bingo/ball', { draw_id: D, ordinal: 3 });
  FAILBALL = false;
  check('CONTROL: a staff host whose ball for the next place FAILED is on the record, for exactly that place', drawRow(D).ball_asked_ordinal === 3, drawRow(D).ball_asked_ordinal);
  f = await W('/host/bingo/fallback', { draw_id: D, number: 50, ordinal: 4, reason: 'not this one' });
  check('a different place is still refused (the match is exact, not "at or below")', f.status === 409, f.status);
  var used = ballsOn(D).map(function (b) { return b.number; }), pick = 1; while (used.indexOf(pick) >= 0) pick++;
  f = await W('/host/bingo/fallback', { draw_id: D, number: pick, ordinal: 3, reason: 'ball failed' });
  check('CONTROL: the place it failed is taken from the tablet and the draw goes to the tablet', f.status === 200 && drawRow(D).mode === 'local' && ballsOn(D).length === 3, f.status);

  print('\n4. a slow server, asked directly');
  var S = (await W('/host/bingo/draw', { venue_id: VENUE })).body.draw_id;
  r = await W('/host/bingo/ball', { draw_id: S, ordinal: 1 });
  var serverBall = r.body.number, tabletBall = serverBall === 7 ? 8 : 7;
  f = await W('/host/bingo/fallback', { draw_id: S, number: tabletBall, ordinal: 1, reason: 'ball failed: timed out' });
  var all = ballsOn(S, true);
  check('the server ball the room never saw is VOID with its reason, the room\'s ball stands in its place, and the draw is the tablet\'s',
        f.status === 200 && ballsOn(S).length === 1 && ballsOn(S)[0].number === tabletBall && ballsOn(S)[0].source === 'local' &&
        all.some(function (b) { return b.number === serverBall && b.source === 'server' && b.withdrawn_at && /never seen by the room/.test(b.void_reason || ''); }) && drawRow(S).mode === 'local', all);
  var S2 = (await W('/host/bingo/draw', { venue_id: VENUE })).body.draw_id;
  r = await W('/host/bingo/ball', { draw_id: S2, ordinal: 1 });
  NOW += 31000;
  f = await W('/host/bingo/fallback', { draw_id: S2, number: r.body.number === 7 ? 8 : 7, ordinal: 1, reason: 'too late' });
  check('ATTACK: a ball the room has had half a minute to see is never undone', f.status === 409 && ballsOn(S2).length === 1 && ballsOn(S2)[0].source === 'server', f.status);
  print('   ...and a slow deal, both ways round');
  var T = (await W('/host/bingo/draw', { venue_id: VENUE, session_id: null })).body.draw_id;
  var dr = await W('/host/bingo/deal', { draw_id: T, hands: [{ pid: 'k1_slowann', did: 'device-slow-1', want: 1 }] });
  var tab = [{ cells: generateStrip()[0], card_no: 555, dealt_at: new Date(Date.now() - 2000).toISOString() }];
  dr = await W('/host/bingo/deal', { draw_id: T, hands: [{ pid: 'k1_slowann', did: 'device-slow-1', tablet: tab }] });
  var tk = ticketsOf(T, 'k1_slowann'), allT = ticketsOf(T, 'k1_slowann', true);
  check('server deal first, the tablet\'s later: the tablet ticket stands, the unseen server ticket is VOID with its reason',
        tk.length === 1 && tk[0].source === 'tablet' && allT.some(function (t) { return t.source === 'server' && t.voided_at && /never reached the phone/.test(t.void_reason || ''); }), allT);
  var T2 = (await W('/host/bingo/draw', { venue_id: VENUE })).body.draw_id;
  await W('/host/bingo/deal', { draw_id: T2, hands: [{ pid: 'k1_slowbob', did: 'device-slow-2', tablet: tab }] });
  await W('/host/bingo/deal', { draw_id: T2, hands: [{ pid: 'k1_slowbob', did: 'device-slow-2', want: 1 }] });
  tk = ticketsOf(T2, 'k1_slowbob');
  check('the tablet\'s first, the server\'s deal later: the server deals nothing over the ticket the phone holds', tk.length === 1 && tk[0].source === 'tablet', tk.map(function (t) { return t.source; }));
  DB.vp_bingo_draw_balls.push({ draw_id: T2, ordinal: 1, number: 5, source: 'server', withdrawn_at: null, drawn_at: new Date().toISOString() });
  dr = await W('/host/bingo/deal', { draw_id: T2, hands: [{ pid: 'k1_slowcat', did: 'device-slow-3', tablet: tab }] });
  check('ATTACK: once a ball is on the record, no tablet ticket is taken', dr.body.refused.indexOf('k1_slowcat') >= 0 && ticketsOf(T2, 'k1_slowcat', true).length === 0, dr.body);

  print('\n4. a slow server, with the real console and phone');
  var host = bootHost3(); await advance(50);
  var ann = bootPhone3('Ann'), bob = bootPhone3('Bob'); await advance(50);
  ann.$('nameIn').value = 'Ann'; ann.join(); bob.$('nameIn').value = 'Bob'; bob.join(); await advance(6000);
  host.$('prizeInput').value = 'Meat tray'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(9000);
  host.startGame(); await advance(3000);
  var G1 = lastDraw().id;
  var row = nums(ann.P.cards[0].cells[0]);
  frontOfDraw(row.slice(0, 4).concat([row[4] === 90 ? 89 : 90]));   // the server's 5th ball is NOT Ann's last number
  await callBalls(host, 4);
  SLOW['/host/bingo/ball'] = 6000;   // slow, not dead: the server answers after the console has given up
  var k = host.G.draw.length + 1;
  host.nextBall(); await drain(); await advance(5000);
  var tabletN = host.G.draw[host.G.draw.length - 1];
  check('the console gave up after four seconds and called ball 5 from the tablet', host.G.draw.length === 5 && host.G.drawMode === 'local', [host.G.draw, host.G.drawMode]);
  await advance(2000); SLOW = {};
  check('CONTROL: the server answered late and its own ball 5 landed on the record', ballsOn(G1, true).filter(function (b) { return b.ordinal === k && b.source === 'server'; }).length === 1);
  await advance(10000);
  var at5 = ballsOn(G1).filter(function (b) { return b.ordinal === k; })[0];
  check('then the tablet\'s ball 5, asked again, takes its place on the record and the server\'s is VOID with its reason',
        !!at5 && at5.source === 'local' && at5.number === tabletN && ballsOn(G1, true).some(function (b) { return b.ordinal === k && b.source === 'server' && b.withdrawn_at && /never seen/.test(b.void_reason || ''); }),
        ballsOn(G1, true).map(function (b) { return [b.ordinal, b.number, b.source, !!b.withdrawn_at]; }));
  // Make the room's ball 5 Ann's last number if it was not (the tablet drew at random): call on until her row is out.
  for (var guard = 0; guard < 85 && !row.every(function (n) { return host.G.called[n]; }); guard++) { host.nextBall(); await drain(); await advance(6000); }
  await advance(12000);
  ann.pressBingo(); await drain(); await advance(1500);
  var cl = lastClaim(ann.P.pid);
  check('a win on the balls the room heard is judged a win by the server, from its own record', !!cl && cl.verdict === 'win' && cl.decided_on === 'server', cl);
  host.hostConfirm(0); await advance(1000);
  check('and the host\'s Confirm is on the record (not refused with 409)', lastClaim(ann.P.pid).status === 'confirmed', lastClaim(ann.P.pid));

  print('\n5. a game that is over is over on the record');
  host.finishGame(); await advance(1000);
  check('Finish game finishes the draw on the server (nothing set by hand)', !!drawRow(G1).finished_at, drawRow(G1));
  f = await W('/host/bingo/fallback', { draw_id: G1, number: 33, ordinal: host.G.draw.length + 1, reason: 'after' });
  dr = await W('/host/bingo/deal', { draw_id: G1, hands: [{ pid: bob.P.pid, did: bob.dom.localStorage.getItem('vpDeviceId'), want: 3 }] });
  check('and a finished draw takes no ball and deals no ticket', f.status === 409 && dr.status === 409, [f.status, dr.status]);
  host.newGame(); await advance(4000);
  var G2 = lastDraw().id;
  host.endGame(); await advance(3000);
  check('End game finishes the next game\'s draw too', G2 !== G1 && !!drawRow(G2).finished_at, drawRow(G2));
  var sid = openSession().body.session_id;
  var other = (await W('/host/bingo/draw', { venue_id: VENUE, session_id: sid })).body.draw_id;
  var newer = (await W('/host/bingo/draw', { venue_id: VENUE, session_id: sid })).body.draw_id;
  check('a new game finishes any earlier draw at the venue left open', !!drawRow(other).finished_at && !drawRow(newer).finished_at);
  await W('/session/close', { session_id: sid });
  check('and closing the session finishes its draws', !!drawRow(newer).finished_at, drawRow(newer));

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' VP-DRAW-1.1 checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
