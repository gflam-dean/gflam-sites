/* THE FOUR BLOCKERS AN OLGR-STYLE AUDIT FOUND IN a16446c, EACH RUN AS AN ATTACK (19 Oct 2026).

   B1  a host records a made-up tablet ticket after the balls are out and has a claim judged on it
   B2  a host switches a healthy server draw to "called on the tablet" and posts any numbers, skips a
       place, posts on a finished draw, or calls a server night "real balls"
   B3  a host confirms a claim the server said is not a win
   B4  the server says NO (signed out 401, paused 403, finished 409) and the tablet carries on anyway

   The Worker half runs the real handlers (tools/rig-game-worker.js) over a fake database. The console
   half runs the real bingo console (tools/rig-bingo-room.js) with the server's answers scripted. Every
   attack must now FAIL, and every control (the legitimate path) must still work.

   Run from the repo root:  jsc tools/test-olgr-audit-19-oct.js */
load('tools/rig-game-worker.js');
var _wDB;
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 300) : '')); }
}
globalThis.crypto.getRandomValues = function (b) { for (var i = 0; i < b.length; i++) b[i] = (b instanceof Uint32Array) ? Math.floor(Math.random() * 4294967296) : Math.floor(Math.random() * 256); return b; };
readJson = async function (req) { return (req && req._body) || {}; };
// One clock for both rigs: the room's virtual time on the Worker's fixed day (the deal budget is measured in it).
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
var _rf = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/(vp_bingo_draws|vp_bingo_tickets|vp_bingo_claims|vp_bingo_draw_balls)(\?|$)/.test(u)) {
    var b = JSON.parse(opts.body), t = /\/rest\/v1\/(\w+)/.exec(u)[1];
    (Array.isArray(b) ? b : [b]).forEach(function (r) {
      if (t === 'vp_bingo_draws') { if (r.mode == null) r.mode = 'server'; if (r.finished_at === undefined) r.finished_at = null; }
      if (t === 'vp_bingo_tickets') { if (r.voided_at === undefined) r.voided_at = null; }
      if (t === 'vp_bingo_claims') { if (r.status == null) r.status = 'pending'; }
      if (t === 'vp_bingo_draw_balls') { if (r.withdrawn_at === undefined) r.withdrawn_at = null; }
    });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  return _rf(url, opts);
};
var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', VIC = '44444444-4444-4444-8444-444444444444';
function freshDb() {
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', au_state: 'QLD' },
                     { id: VIC, name: 'Vic Pub', slug: 'vic-pub', status: 'active', au_state: 'VIC' }],
         vp_venue_groups: [], vp_sessions: [{ id: SESSION, venue_id: VENUE, status: 'running', join_code: 'ABCDEF' }],
         vp_players: [{ id: 'p1', session_id: SESSION, kicked: false, device_id: 'device-ann-1' }, { id: 'p2', session_id: SESSION, kicked: false, device_id: 'device-bob-1' }],
         vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [] };
}
async function W(path, body) {
  var h = { '/host/bingo/draw': handleBingoDrawStart, '/host/bingo/ball': handleBingoBall, '/host/bingo/fallback': handleBingoFallback,
            '/host/bingo/deal': handleBingoDeal, '/host/bingo/claim': handleBingoClaim, '/host/bingo/claim/resolve': handleBingoClaimResolve }[path];
  try { return await h({ _body: body || {}, headers: { get: function () { return ''; } } }, ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function draw(id) { return DB.vp_bingo_draws.filter(function (d) { return d.id === id; })[0]; }
function balls(id) { return DB.vp_bingo_draw_balls.filter(function (b) { return b.draw_id === id && !b.withdrawn_at; }); }
function tickets(id, pid) { return DB.vp_bingo_tickets.filter(function (t) { return t.draw_id === id && (!pid || t.pid === pid); }); }
function strip() { return generateStrip(); }
function nums(c) { return c.filter(function (v) { return v; }); }
var ANN = 'k1_annphone', BOB = 'k1_bobphone';

(async function () {
  print('B1: a made-up tablet ticket');
  freshDb();
  var d1 = (await W('/host/bingo/draw', { venue_id: VENUE, session_id: SESSION })).body.draw_id;
  var fake = strip()[0], tab = [{ cells: fake, card_no: 777, dealt_at: new Date(Date.now() - 1000).toISOString() }];
  var r = await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: ANN, did: 'device-ann-1', tablet: tab }] });
  check('ATTACK: tablet tickets on a draw whose deal never failed on the server are refused', r.status === 200 && r.body.refused.indexOf(ANN) >= 0 && tickets(d1).length === 0, r.body);
  draw(d1).deal_failed_at = new Date().toISOString();   // the server's own record of a failed deal (what the deal handler writes)
  DB.vp_bingo_draw_balls.push({ draw_id: d1, ordinal: 1, number: 5, source: 'server', withdrawn_at: null });
  r = await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: ANN, did: 'device-ann-1', tablet: tab }] });
  check('ATTACK: after a recorded failure, but with a ball already on the record: refused', r.body.refused.indexOf(ANN) >= 0 && tickets(d1).length === 0, r.body);
  DB.vp_bingo_draw_balls = [];
  r = await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: 'k1_stranger', did: 'nobody-device', tablet: tab }] });
  check('ATTACK: a tablet ticket for a phone that is not in the session: refused (the seat rule holds for tablet tickets)', r.body.refused.indexOf('k1_stranger') >= 0 && tickets(d1).length === 0, r.body);
  await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: BOB, did: 'device-bob-1', want: 1 }] });
  r = await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: BOB, did: 'device-bob-1', tablet: tab }] });
  check('ATTACK: a tablet ticket for a phone that already holds a server ticket: refused', r.body.refused.indexOf(BOB) >= 0 && tickets(d1, BOB).every(function (t) { return t.source === 'server'; }), r.body);
  r = await W('/host/bingo/deal', { draw_id: d1, hands: [{ pid: ANN, did: 'device-ann-1', tablet: tab }] });
  var at = tickets(d1, ANN)[0];
  check('CONTROL: after a recorded failure, before any ball, for a seated phone: recorded, with balls at deal 0 and the tablet\'s time',
        r.status === 200 && !!at && at.source === 'tablet' && at.balls_at_deal === 0 && at.tablet_dealt_at === tab[0].dealt_at, at);
  var dv = (await W('/host/bingo/draw', { venue_id: VIC })).body.draw_id;
  draw(dv).deal_failed_at = new Date().toISOString();
  r = await W('/host/bingo/deal', { draw_id: dv, hands: [{ pid: ANN, did: 'device-ann-1', tablet: tab }] });
  check('ATTACK: a tablet ticket in a paper-bingo state (Victoria): refused like any phone ticket', r.body.refused.indexOf(ANN) >= 0 && tickets(dv).length === 0, r.body);
  // A tablet ticket that somehow sits on the record with balls already out is never used for a claim.
  var late = strip()[1], row0 = late.slice(0, 9).filter(function (v) { return v; });
  DB.vp_bingo_tickets.push({ id: 'late-1', draw_id: d1, pid: 'k1_late', device_id: 'x', book: 9, page: 0, cells: late, card_no: 888, source: 'tablet', dealt_at: new Date().toISOString(), voided_at: null, balls_at_deal: 3 });
  row0.forEach(function (n, i) { DB.vp_bingo_draw_balls.push({ draw_id: d1, ordinal: i + 1, number: n, source: 'server', withdrawn_at: null }); });
  r = await W('/host/bingo/claim', { draw_id: d1, ref: 'ref-late-1', pid: 'k1_late', card_no: 888, pattern: 'top', balls: 5 });
  check('ATTACK: a tablet ticket recorded after balls were out is ignored by the claim verdict, though its top row is all called',
        r.status === 200 && r.body.verdict === 'no_ticket', r.body);

  print('\nB2: forcing a server draw onto the tablet');
  freshDb();
  var d2 = (await W('/host/bingo/draw', { venue_id: VENUE })).body.draw_id;
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 7, ordinal: 1, reason: 'worker unreachable' });
  check('ATTACK: "the server is down" on a healthy draw: refused, the draw stays the server\'s, nothing posted', r.status === 409 && draw(d2).mode === 'server' && balls(d2).length === 0, r);
  r = await W('/host/bingo/claim', { draw_id: d2, ref: 'ref-force-1', pid: ANN, card_no: 1, pattern: 'one', balls: 5, called: [1, 2, 3, 4, 5], tablet_draw: true, tablet_why: 'trust me' });
  check('ATTACK: the same through a claim (tablet_draw:true): the draw stays the server\'s and no ball is added', r.status === 200 && draw(d2).mode === 'server' && balls(d2).length === 0 && r.body.record_short === true, r.body);
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 7, ordinal: 1, reason: 'caller' });
  check('ATTACK: calling a server night "real balls" to post a number: refused', r.status === 409 && balls(d2).length === 0, r);
  r = await W('/host/bingo/ball', { draw_id: d2, ordinal: 1 });
  check('CONTROL: asking the server for ball 1 writes that it was asked', draw(d2).ball_asked_ordinal === 1, draw(d2));
  // Ball 1 was served. Now ball 2 is asked for and the server fails to fill it.
  DB.vp_bingo_draw_balls.push({ draw_id: d2, ordinal: 1, number: 11, source: 'server', withdrawn_at: null });
  draw(d2).ball_asked_ordinal = 2;
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 7, ordinal: 3, reason: 'worker unreachable' });
  check('ATTACK: a ball that skips a place: refused, nothing switched', r.status === 409 && draw(d2).mode === 'server' && balls(d2).length === 1, r);
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 7, ordinal: 2, reason: 'worker unreachable' });
  check('CONTROL: the place the server was asked for and failed to fill: taken from the tablet, the draw switched', r.status === 200 && draw(d2).mode === 'local' && balls(d2).length === 2, r);
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 9, ordinal: 2, reason: 'worker unreachable' });
  check('ATTACK: a second ball into a place already taken: refused', r.status === 409 && balls(d2).length === 2, r);
  draw(d2).finished_at = new Date().toISOString();
  r = await W('/host/bingo/fallback', { draw_id: d2, number: 9, ordinal: 3, reason: 'worker unreachable' });
  check('ATTACK: a ball on a finished draw: refused', r.status === 409 && balls(d2).length === 2, r);
  var dc = (await W('/host/bingo/draw', { venue_id: VENUE, caller: true })).body.draw_id;
  r = await W('/host/bingo/fallback', { draw_id: dc, number: 9, ordinal: 1, reason: 'worker unreachable' });
  check('ATTACK: a "server down" ball on a real-balls draw: refused', r.status === 409, r);
  r = await W('/host/bingo/fallback', { draw_id: dc, number: 9, ordinal: 1, reason: 'caller' });
  check('CONTROL: a caller ball on a draw opened for real balls is taken', r.status === 200 && balls(dc).length === 1, r);

  print('\nB3: confirming what the server says is not a win');
  freshDb();
  var d3 = (await W('/host/bingo/draw', { venue_id: VENUE, session_id: SESSION })).body.draw_id;
  var deal = await W('/host/bingo/deal', { draw_id: d3, hands: [{ pid: ANN, did: 'device-ann-1', want: 1 }] });
  var t3 = deal.body.hands[ANN][0];
  var c1 = await W('/host/bingo/claim', { draw_id: d3, ref: 'ref-nowin-1', pid: ANN, card_no: t3.card_no, pattern: 'one', balls: 0 });
  var res = await W('/host/bingo/claim/resolve', { claim_id: c1.body.claim_id, decision: 'confirmed' });
  var row = DB.vp_bingo_claims.filter(function (c) { return c.id === c1.body.claim_id; })[0];
  check('ATTACK: confirming a claim the server judged not a win: refused, the claim stays pending', c1.body.verdict === 'not_yet' && res.status === 409 && row.status === 'pending', [c1.body.verdict, res, row.status]);
  var c2 = await W('/host/bingo/claim', { draw_id: d3, ref: 'ref-nowin-2', pid: ANN, card_no: t3.card_no, pattern: 'one', balls: 0, decided_on: 'tablet', tablet_verdict: 'win', decision: 'confirmed' });
  var row2 = DB.vp_bingo_claims.filter(function (c) { return c.ref === 'ref-nowin-2'; })[0];
  check('ATTACK: the same through the record path, claiming the tablet said win with no outage on the draw: refused, kept pending', c2.status === 409 && !!row2 && row2.status === 'pending', [c2.status, row2]);
  nums(t3.cells[0]).forEach(function (n, i) { DB.vp_bingo_draw_balls.push({ draw_id: d3, ordinal: i + 1, number: n, source: 'server', withdrawn_at: null }); });
  var c3 = await W('/host/bingo/claim', { draw_id: d3, ref: 'ref-win-1', pid: ANN, card_no: t3.card_no, pattern: 'one', balls: 5 });
  res = await W('/host/bingo/claim/resolve', { claim_id: c3.body.claim_id, decision: 'confirmed' });
  check('CONTROL: a claim the server judged a win is confirmed', c3.body.verdict === 'win' && res.status === 200 && res.body.status === 'confirmed', res);
  draw(d3).mode = 'local'; draw(d3).fallback_why = 'ball failed: timed out';   // the outage the server recorded (as handleBingoFallback writes)
  var c4 = await W('/host/bingo/claim', { draw_id: d3, ref: 'ref-tab-1', pid: ANN, card_no: t3.card_no, pattern: 'two', balls: 5, decided_on: 'tablet', tablet_verdict: 'win', decision: 'confirmed' });
  check('CONTROL: decided on the tablet during an outage the server recorded on the draw: the confirm is recorded', c4.status === 200 && c4.body.status === 'confirmed', c4);

  var rec = await bingoRecordRows(ENV, VENUE);
  var tRows = rec.filter(function (x) { return x.game === 'bingo ticket'; }), cRows = rec.filter(function (x) { return x.game === 'bingo claim'; });
  check('the venue\'s draw record (/host/draws/export) now lists every ticket (source, deal time, balls at deal) and every claim (verdict, decision, who)',
        tRows.length >= 1 && /dealt with 0 balls on the record/.test(tRows[0].outcome) && tRows[0].source === 'server' &&
        cRows.some(function (x) { return /server verdict win/.test(x.outcome) && /decision confirmed at .* by /.test(x.outcome); }) &&
        cRows.some(function (x) { return /server verdict not_yet/.test(x.outcome) && /decision pending/.test(x.outcome); }),
        { t: tRows.slice(0, 1), c: cRows.map(function (x) { return x.outcome; }) });

  print('\nB3 and B4 on the console');
  function host(answers) {
    var h = bootHost({ call: function (path, body) { var a = answers(path, body); return a; }, cap: 100 });
    return h;
  }
  function room(h) {
    h.onMsg({ t: 'join', pid: 'p1', name: 'Ann', did: 'device-ann-1' }); h.onMsg({ t: 'join', pid: 'p2', name: 'Bob', did: 'device-bob-1' });
    h.$('prizeInput').value = 'Tab'; h.$('patternSel').value = 'one'; h.$('cardsSel').value = '1'; h.$('paidSel').value = '';
  }
  var ok200 = { draw: function () { return { status: 200, json: { draw_id: '99999999-9999-4999-8999-0000000000aa', fallback_off_states: [] } }; } };
  var seen;
  async function scene(code, where) {
    seen = [];
    var h = host(function (path, body) {
      seen.push(path);
      if (path === where) return { status: code, json: { error: code === 403 ? 'Games are paused here tonight. Have a word with the staff.' : (code === 409 ? 'This game is finished' : 'Not signed in') } };
      if (path === '/host/bingo/draw') return ok200.draw();
      if (path === '/host/bingo/deal') return { status: 200, json: { ok: true, hands: {}, refused: [] } };
      if (path === '/host/bingo/seat') return { status: 200, json: { ok: true, seated: [], fallback_off_states: [] } };
      return { status: 200, json: {} };
    });
    await advance(50); room(h); h.startGame(); await advance(3000);
    h.nextBall(); await advance(6000);
    return h;
  }
  var h401 = await scene(401, '/host/bingo/draw');
  check('ATTACK: signed out (401) when the game opens: the game stops, says sign in again, no ball and no ticket from the tablet',
        !!h401.G.halt && h401.G.halt.status === 401 && /Sign in again/.test(h401.$('coach').innerHTML) && h401.G.draw.length === 0 &&
        Object.keys(h401.G.players).every(function (p) { return !(h401.G.players[p].cards || []).length; }), { halt: h401.G.halt, draw: h401.G.draw, coach: h401.$('coach').innerHTML });
  var h403 = await scene(403, '/host/bingo/ball');
  check('ATTACK: games paused (403) on a ball: no ball is drawn on the tablet, and the server\'s words are on screen',
        !!h403.G.halt && h403.G.halt.status === 403 && h403.G.draw.length === 0 && h403.G.drawMode === 'server' && /paused/.test(h403.$('coach').innerHTML), { halt: h403.G.halt, draw: h403.G.draw });
  var h409 = await scene(409, '/host/bingo/deal');
  check('ATTACK: the game finished on the server (409) when dealing: the tablet deals nothing',
        !!h409.G.halt && h409.G.halt.status === 409 && h409.G.dealMode !== 'tablet' && Object.keys(h409.G.players).every(function (p) { return !(h409.G.players[p].cards || []).length; }), h409.G.halt);
  var hDown = host(function (path) {
    if (path === '/host/bingo/seat') return { status: 200, json: { ok: true, seated: [], fallback_off_states: [] } };
    return Promise.reject(new Error('timed out'));
  });
  await advance(50); room(hDown); hDown.startGame(); await advance(10000);
  hDown.nextBall(); await advance(6000);
  check('CONTROL: a server that does not answer at all: the tablet deals and calls, as Dean decided',
        !hDown.G.halt && hDown.G.dealMode === 'tablet' && hDown.G.draw.length === 1 && Object.keys(hDown.G.players).every(function (p) { return hDown.G.players[p].cards.length === 1; }), { halt: hDown.G.halt, mode: hDown.G.dealMode, draw: hDown.G.draw });
  // An early-call venue: a claim the server says is not a win stays on the queue to be waved off, and cannot be confirmed.
  var card = [[1, 0, 22, 0, 44, 0, 66, 0, 81], [0, 16, 28, 36, 0, 57, 0, 73, 0], [7, 0, 0, 37, 47, 56, 0, 77, 82]];
  var hE = host(function (path) {
    if (path === '/host/bingo/claim') return { status: 200, json: { claim_id: 'cccccccc-cccc-4ccc-8ccc-000000000001', verdict: 'not_yet', card_no: 101, cells: card, swapped: false, winning_cells: [], balls: 1, status: 'pending' } };
    if (path === '/host/bingo/draw') return ok200.draw();
    if (path === '/host/bingo/deal') return { status: 200, json: { ok: true, hands: { p1: [{ card_no: 101, cells: card, source: 'server' }] }, refused: [] } };
    if (path === '/host/bingo/ball') return { status: 200, json: { number: 2, index: 1 } };
    return { status: 200, json: { ok: true, seated: [], fallback_off_states: [] } };
  });
  await advance(50); room(hE); hE.G.allowEarly = true; hE.startGame(); await advance(3000);
  hE.nextBall(); await advance(6000);
  hE.onMsg({ t: 'claim', pid: 'p1', name: 'Ann', cardNo: 101 }); await advance(500);
  var confirmed = hE.hostConfirm(0);
  var btn = /<button class="btn win" data-act="confirm"[^>]*>/.exec(hE.$('claimQueue').innerHTML);
  check('ATTACK: an early call the server says is not a win: on the queue to wave off, Confirm greyed out, and Confirm refuses',
        hE.G.claims.length === 1 && hE.G.claims[0].valid === false && confirmed === false && hE.G.lastWins.length === 0 && !!btn && / disabled/.test(btn[0]),
        { claims: hE.G.claims.length, valid: hE.G.claims[0] && hE.G.claims[0].valid, confirmed: confirmed, btn: btn && btn[0] });

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' audit checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
