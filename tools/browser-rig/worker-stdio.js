/* THE REAL GAME WORKER, ANSWERING ON A PIPE (tools/test-console-in-chrome.py).

   Loads the real venueplay-game.js through tools/rig-game-worker.js (only the network and the database
   are fakes), then reads one request per line on stdin, as JSON {method, path, body}, sends it through the
   Worker's own fetch handler, exactly as Cloudflare would, and prints one JSON line {status, body}. The
   test's local web server forwards every call the real pages make to the game Worker here, so the console
   and the phone in Chrome talk to the real Worker code.

   Run by the test, from the repo root:  jsc tools/browser-rig/worker-stdio.js */
load('tools/rig-game-worker.js');
globalThis.crypto.getRandomValues = function (b) { for (var i = 0; i < b.length; i++) b[i] = (b instanceof Uint32Array) ? Math.floor(Math.random() * 4294967296) : Math.floor(Math.random() * 256); return b; };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };
verifyPlayerToken = async function (req) {
  var t = req.headers.get('X-Player-Token') || '';
  var p = DB.vp_players.filter(function (r) { return r.token === t || ('tok-' + r.id) === t; })[0];
  if (!p) { var e = new Error('Invalid player token'); e.status = 401; throw e; }
  return p;
};
var SLUG = 'test-alpha', CODE = fnvVenueCode(SLUG);
DB = { vp_venues: [{ id: VENUE, name: 'Test Alpha', slug: SLUG, status: 'active', join_code: CODE, au_state: 'QLD', max_players: 100, created_at: '2026-01-01T00:00:00Z' }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_claims: [],
       vp_game_reports: [], vp_gaming_declarations: [], vp_events: [], vp_captures: [],
       vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [] };
var _rf = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/rpc\/vp_bingo_next_ball/.test(u)) {
    var p = JSON.parse(opts.body).p_draw, d = DB.vp_bingo_draws.filter(function (x) { return x.id === p; })[0];
    if (!d || d.draw_index >= d.draw_order.length) return resp(200, []);
    d.draw_index++;
    DB.vp_bingo_draw_balls.push({ draw_id: p, ordinal: d.draw_index, number: d.draw_order[d.draw_index - 1], source: 'server', drawn_at: new Date().toISOString(), withdrawn_at: null });
    return resp(200, [{ number: d.draw_order[d.draw_index - 1], new_index: d.draw_index }]);
  }
  if (m === 'POST' && /\/rest\/v1\/(\w+)/.test(u)) {
    var t = /\/rest\/v1\/(\w+)/.exec(u)[1], b = JSON.parse(opts.body);
    (Array.isArray(b) ? b : [b]).forEach(function (r) {
      if (t === 'vp_players') { if (r.kicked == null) r.kicked = false; if (!r.id) r.id = 'pl-' + Math.floor(Math.random() * 1e9); r.token = 'tok-' + r.id; }
      if (t === 'vp_sessions') { if (r.status == null) r.status = 'lobby'; if (r.created_at == null) r.created_at = new Date().toISOString(); }
      if (t === 'vp_bingo_draws') { if (r.mode == null) r.mode = 'server'; if (r.finished_at === undefined) r.finished_at = null; }
      if (t === 'vp_bingo_tickets') { if (r.voided_at === undefined) r.voided_at = null; }
      if (t === 'vp_bingo_claims') { if (r.status == null) r.status = 'pending'; }
      if (t === 'vp_bingo_draw_balls') { if (r.withdrawn_at === undefined) r.withdrawn_at = null; }
      if (t === 'vp_gaming_declarations') { if (r.declared_at == null) r.declared_at = new Date().toISOString(); }
    });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  return _rf(url, opts);
};
print(JSON.stringify({ ready: true, code: CODE, venue: VENUE, slug: SLUG }));
for (;;) {
  var line = readline();
  if (!line) break;   // jsc's readline gives "" at the end of input: the test never sends a blank line
  var rq = JSON.parse(line), out = null;
  /* The test's own hands on the fake database (tools/pickup-in-chrome.test.py, 20 Oct 2026): put rows
     in before a scene, read a table back after one. Never a Worker route: the pages cannot reach it. */
  if (rq.seed) { DB[rq.seed] = (rq.replace ? [] : (DB[rq.seed] || [])).concat(rq.rows || []); print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
  if (rq.table) { print(JSON.stringify({ status: 200, body: DB[rq.table] || [] })); continue; }
  /* The Worker's clock, for a scene that has to happen on a given day (the purchase raffle's dates). */
  if (rq.now) { NOWMS = +rq.now; print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
  var h = rq.headers || {};
  var req = { method: rq.method || 'GET', url: 'https://game.test' + rq.path, _body: rq.body || {},
              headers: { get: function (k) { for (var x in h) { if (x.toLowerCase() === String(k).toLowerCase()) return h[x]; } return null; } } };
  Promise.resolve().then(function () { return __worker.fetch(req, ENV); }).then(function (r) {
    var body = null; try { body = JSON.parse(r._b); } catch (e) { body = r._b; }
    out = { status: r.status, body: body };
  }, function (e) { out = { status: 500, body: { error: String(e && e.message || e) } }; });
  for (var i = 0; i < 200 && !out; i++) drainMicrotasks();
  print(JSON.stringify(out || { status: 504, body: { error: 'the worker rig did not answer' } }));
}
