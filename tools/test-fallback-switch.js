/* THE TABLET FALLBACK SWITCH, TURNED OFF FOR QUEENSLAND (19 Oct 2026).

   Dean keeps the tablet fallbacks (ball, ticket deal, claim check). If OLGR asks, Queensland goes off
   with one line in each half of the regulated module VP-DRAW (the gate refuses the two differing):
     venueplay-backend/worker/vp-draw.js   const TABLET_FALLBACK_OFF_STATES = new Set(['QLD']);
     venueplay/app/vp-draw.js              var TABLET_FALLBACK_OFF_STATES = ['QLD'];
   (then raise the version and run tools/regulated.py --update, as for any regulated change).
   This suite MAKES that change in memory, loads the real Worker and the real console with it,
   and shows the switch is real: the server refuses all three fallbacks for a QLD venue, the console
   learns the list and waits for the server instead of standing in, even with no server at all, and a
   venue in another state is untouched. If the line moves or changes shape, the first check goes red.

   Run from the repo root:  jsc tools/test-fallback-switch.js */
var LINE = "const TABLET_FALLBACK_OFF_STATES = new Set([]);";
var PATCHED = "const TABLET_FALLBACK_OFF_STATES = new Set(['QLD']);";
var CLINE = "  var TABLET_FALLBACK_OFF_STATES = [];", CPATCHED = "  var TABLET_FALLBACK_OFF_STATES = ['QLD'];";
var _readFile = readFile, LINE_COUNT = -1, CLINE_COUNT = -1;
readFile = function (p) {
  var t = _readFile(p);
  if (/venueplay-game\.js$/.test(p)) { LINE_COUNT = t.split(LINE).length - 1; t = t.replace(LINE, PATCHED); }
  if (/app\/vp-draw\.js$/.test(p)) { CLINE_COUNT = t.split(CLINE).length - 1; t = t.replace(CLINE, CPATCHED); }
  return t;
};
load('tools/rig-game-worker.js');   // readFile stays patched: the rig reads /app/vp-draw.js each time it boots a console
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 300) : '')); }
}
readJson = async function (req) { return (req && req._body) || {}; };
globalThis.crypto.getRandomValues = function (b) { for (var i = 0; i < b.length; i++) b[i] = (b instanceof Uint32Array) ? Math.floor(Math.random() * 4294967296) : Math.floor(Math.random() * 256); return b; };
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
var _rf = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/(vp_bingo_draws|vp_bingo_claims)(\?|$)/.test(u)) {
    var b = JSON.parse(opts.body);
    (Array.isArray(b) ? b : [b]).forEach(function (r) { if (/draws/.test(u) && r.mode == null) r.mode = 'server'; if (/claims/.test(u) && r.status == null) r.status = 'pending'; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  return _rf(url, opts);
};
var NSW = '55555555-5555-4555-8555-555555555555', SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
DB = { vp_venues: [{ id: VENUE, slug: 'qld-pub', status: 'active', au_state: 'QLD' }, { id: NSW, slug: 'nsw-pub', status: 'active', au_state: 'NSW' }],
       vp_venue_groups: [], vp_sessions: [{ id: SESSION, venue_id: VENUE, status: 'running' }],
       vp_players: [{ id: 'p1', session_id: SESSION, kicked: false, device_id: 'device-ann-1' }],
       vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [] };
async function W(path, body) {
  var h = { '/host/bingo/draw': handleBingoDrawStart, '/host/bingo/fallback': handleBingoFallback, '/host/bingo/deal': handleBingoDeal,
            '/host/bingo/claim': handleBingoClaim, '/host/bingo/seat': handleBingoSeat }[path];
  try { return await h({ _body: body || {}, headers: { get: function () { return ''; } } }, ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function draw(id) { return DB.vp_bingo_draws.filter(function (d) { return d.id === id; })[0]; }

(async function () {
  check('the switch is ONE line in the Worker module\'s copy in the game Worker', LINE_COUNT === 1, LINE_COUNT);
  var _cm = readFile('venueplay/app/vp-draw.js');
  check('and ONE line in the console module, where this suite expects it', CLINE_COUNT === 1, CLINE_COUNT);

  print('the server, with Queensland switched off');
  var dq = await W('/host/bingo/draw', { venue_id: VENUE, session_id: SESSION });
  check('a draw at a QLD venue tells the console: no tablet fallback here, and the list', dq.body.tablet_fallback === false && JSON.stringify(dq.body.fallback_off_states) === '["QLD"]', dq.body);
  var sq = await W('/host/bingo/seat', { session_id: SESSION, dids: [] });
  check('so does every seat answer, which a console gets all through the lobby', JSON.stringify(sq.body.fallback_off_states) === '["QLD"]', sq.body);
  var Q = dq.body.draw_id;
  draw(Q).ball_asked_ordinal = 1;   // the server's own record that it failed ball 1
  var r = await W('/host/bingo/fallback', { draw_id: Q, number: 7, ordinal: 1, reason: 'worker unreachable' });
  check('a tablet ball at a QLD venue is refused, even after a failure the server recorded', r.status === 403 && draw(Q).mode === 'server', r);
  draw(Q).deal_failed_at = new Date().toISOString();
  r = await W('/host/bingo/deal', { draw_id: Q, hands: [{ pid: 'k1_ann', did: 'device-ann-1', tablet: [{ cells: generateStrip()[0], card_no: 5 }] }] });
  check('tablet tickets at a QLD venue are refused, even after a deal failure the server recorded', r.status === 200 && r.body.refused.indexOf('k1_ann') >= 0 && DB.vp_bingo_tickets.length === 0, r.body);
  r = await W('/host/bingo/claim', { draw_id: Q, ref: 'ref-qld-1', pid: 'k1_ann', card_no: 5, pattern: 'one', balls: 0, decided_on: 'tablet', tablet_verdict: 'win', decision: 'confirmed' });
  check('a win confirmed on the tablet\'s check at a QLD venue is not recorded as confirmed', r.status === 409 && DB.vp_bingo_claims[0].status === 'pending', r);
  var dn = await W('/host/bingo/draw', { venue_id: NSW });
  draw(dn.body.draw_id).ball_asked_ordinal = 1;
  r = await W('/host/bingo/fallback', { draw_id: dn.body.draw_id, number: 7, ordinal: 1, reason: 'worker unreachable' });
  check('CONTROL: an NSW venue keeps its fallback', dn.body.tablet_fallback === true && r.status === 200, [dn.body, r.status]);

  print('\nthe console at a QLD venue');
  var calls = 0, down = false;
  function answer(path) {
    calls++;
    if (down) return Promise.reject(new Error('timed out'));
    if (path === '/host/bingo/draw') return { status: 200, json: { draw_id: '99999999-9999-4999-8999-0000000000bb', tablet_fallback: false, fallback_off_states: ['QLD'] } };
    if (path === '/host/bingo/seat') return { status: 200, json: { ok: true, seated: [], fallback_off_states: ['QLD'] } };
    if (path === '/host/bingo/deal') return Promise.reject(new Error('timed out'));
    return Promise.reject(new Error('timed out'));
  }
  async function boot(state, store) {
    var h = bootHost({ call: answer, cap: 100, store: store });
    var ctx = await h.sb.VP.ready(); ctx.venue.au_state = state;
    await advance(50);
    h.onMsg({ t: 'join', pid: 'p1', name: 'Ann', did: 'device-ann-1' });
    h.$('prizeInput').value = 'Tab'; h.$('patternSel').value = 'one'; h.$('cardsSel').value = '1'; h.$('paidSel').value = '';
    return h;
  }
  var hq = await boot('QLD');
  hq.startGame(); await advance(15000);
  check('the server cannot deal: the tablet does NOT deal, and the room waits (no ticket, Start calling still waiting)',
        hq.G.dealMode !== 'tablet' && !(hq.G.players.p1.cards || []).length && hq.$('nextBtn').textContent === 'Dealing tickets...', { mode: hq.G.dealMode, btn: hq.$('nextBtn').textContent });
  hq.G.dealSince = 0;   // let a ball be asked for, to show the ball half of the switch
  hq.nextBall(); await advance(6000);
  check('the server cannot call a ball: the tablet does NOT call one, and says why', hq.G.draw.length === 0 && hq.G.drawMode === 'server' && /does not let the tablet/.test(hq.$('greetToast').textContent),
        { draw: hq.G.draw, mode: hq.G.drawMode, toast: hq.$('greetToast').textContent });
  var lst = hq.dom.window.VPDraw.TABLET_FALLBACK_OFF_STATES, pushed = false;
  try { lst.push('NSW'); pushed = true; } catch (e) {}
  check('the console\'s list is the module constant, and nothing on the page can change it', JSON.stringify(lst) === '["QLD"]' && !pushed && Object.isFrozen(hq.dom.window.VPDraw), lst);
  // No server at all tonight, from the moment the page opened.
  down = true;
  var hq2 = await boot('QLD');
  hq2.startGame(); await advance(15000);
  hq2.nextBall(); await advance(6000);
  check('with NO server at all, from the start, the tablet still does not stand in', hq2.G.dealMode !== 'tablet' && hq2.G.draw.length === 0, { mode: hq2.G.dealMode, draw: hq2.G.draw });
  var card = [[1, 0, 22, 0, 44, 0, 66, 0, 81], [0, 16, 28, 36, 0, 57, 0, 73, 0], [7, 0, 0, 37, 47, 56, 0, 77, 82]];
  hq2.G.players.p1.cards = [{ card: card, cardNo: 101, src: 'server', rec: true }];
  hq2.G.drawId = '99999999-9999-4999-8999-0000000000cc';
  [1, 22, 44, 66, 81].forEach(function (n) { hq2.commitBall(n, true); });
  hq2.onMsg({ t: 'claim', pid: 'p1', name: 'Ann', cardNo: 101 }); await advance(6000);
  var btn = /<button class="btn win" data-act="confirm"[^>]*>/.exec(hq2.$('claimQueue').innerHTML);
  check('a BINGO the server cannot check is NOT decided on the tablet: it waits for the server, Confirm greyed out and refused',
        hq2.G.claims.length === 1 && hq2.G.claims[0].by === 'waiting' && !!btn && / disabled/.test(btn[0]) && hq2.hostConfirm(0) === false && /Waiting for the server/.test(hq2.$('claimQueue').innerHTML),
        { by: hq2.G.claims[0] && hq2.G.claims[0].by, btn: btn && btn[0] });
  var hn = await boot('NSW');
  hn.startGame(); await advance(15000);
  check('CONTROL: an NSW tablet with the same list stands in as before', hn.G.dealMode === 'tablet' && hn.G.players.p1.cards.length === 1, hn.G.dealMode);

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' fallback switch checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
