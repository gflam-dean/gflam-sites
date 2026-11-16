/* THE REAL GAME WORKER, ANSWERING ON A PIPE (tools/test-console-in-chrome.py).

   Loads the real venueplay-game.js through tools/rig-game-worker.js (only the network and the database
   are fakes), then reads one request per line on stdin, as JSON {method, path, body}, sends it through the
   Worker's own fetch handler, exactly as Cloudflare would, and prints one JSON line {status, body}. The
   test's local web server forwards every call the real pages make to the game Worker here, so the console
   and the phone in Chrome talk to the real Worker code.

   Run by the test, from the repo root:  jsc tools/browser-rig/worker-stdio.js */
load('tools/rig-game-worker.js');
/* THE WORKER'S CLOCK RUNS, AS IT DOES ON CLOUDFLARE (31 Oct 2026). rig-game-worker.js stands the clock
   still at NOWMS, which is right for a jsc suite that steps time itself and wrong for a page in Chrome
   that waits in real seconds. The game Worker now keeps the lobby poll's answer for 4 s in memory
   (handleJoinInfo); on a clock that never moves, that copy never ran out, so a phone that could only
   follow the room by polling (in its own browser, where no console message reaches it) was told the
   first answer for ever and never followed the room to musical bingo (console-in-chrome, release gate,
   31 Oct 2026). So the clock starts on the rig's fixed day and moves with real time; a scene that needs
   a given day still sets it with {now}, and the clock runs on from there. */
var _wallAt = _D.now(), _rigAt = NOWMS;
function rigClock() { return _rigAt + (_D.now() - _wallAt); }
Date = function (v) { return arguments.length ? new _D(v) : new _D(rigClock()); };
Date.now = rigClock; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
globalThis.crypto.getRandomValues = function (b) { for (var i = 0; i < b.length; i++) b[i] = (b instanceof Uint32Array) ? Math.floor(Math.random() * 4294967296) : Math.floor(Math.random() * 256); return b; };
sha256Hex = async function (s) { return 'h-' + s; };
/* A handler may hand the regulated handler a request it has already read (handleBingoDrawStartForVenue,
   the SA/NT rule in front of VP-DRAW, 22 Oct 2026): that one carries its body behind json(), as on
   Cloudflare. Without this the rig read it as {} and the draw failed with "Missing venue_id". */
readJson = async function (req) {
  if (req && req._body) return req._body;
  if (req && typeof req.json === 'function') { try { var j = await req.json(); if (j && typeof j === 'object') return j; } catch (e) {} }
  return {};
};
verifyPlayerToken = async function (req) {
  var t = req.headers.get('X-Player-Token') || '';
  /* A token /join really handed out is known by its hash, as on Cloudflare (sha256Hex above is 'h-'+s).
     Without that every real phone's /player/alive and /player/score was a 401, and the phone dropped its
     token and re-joined over and over (stale-phone-and-end-once-in-chrome, 3 Nov 2026). */
  var p = DB.vp_players.filter(function (r) { return r.token === t || ('tok-' + r.id) === t || (!!t && r.token_hash === 'h-' + t); })[0];
  if (!p) { var e = new Error('Invalid player token'); e.status = 401; throw e; }
  return p;
};
/* THE WINNER CHECK PIN IS AN HMAC (5 Nov 2026, fix/winner-check-8nov). rig-game-worker.js has no HMAC and
   its TextEncoder gives empty bytes, which every other scene relies on staying exactly as it is. So the
   encoder keeps its empty answer and only carries the text beside it (_s), and HMAC-SHA256 signs that text
   with the harness's SHA (checked against Python in winner-pin.test.js). The secret is the rig's own;
   winner-pin-in-chrome.test.py works out the expected PIN from it in Python. */
load('partyplay-backend/worker/_test-sha256.js');
ENV.SUPABASE_JWT_SECRET = 'rig-winner-pin-secret';
TextEncoder.prototype.encode = function (s) { var u = new Uint8Array(0); u._s = String(s); return u; };
globalThis.crypto.subtle.importKey = async function (fmt, k, alg) { return { _k: k._s, alg: alg }; };
globalThis.crypto.subtle.sign = async function (alg, key, msg) { return new Uint8Array(SHA.hmac(key._k, msg._s)).buffer; };
var SLUG = 'test-alpha', CODE = fnvVenueCode(SLUG);
DB = { vp_venues: [{ id: VENUE, name: 'Test Alpha', slug: SLUG, status: 'active', join_code: CODE, au_state: 'QLD', max_players: 100, created_at: '2026-01-01T00:00:00Z' }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_claims: [],
       vp_game_reports: [], vp_gaming_declarations: [], vp_events: [], vp_captures: [],
       vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [] };
function rigUuid() {
  var h = '0123456789abcdef', s = '';
  for (var i = 0; i < 32; i++) s += h[i === 12 ? 4 : (i === 16 ? (8 + Math.floor(Math.random() * 4)) : Math.floor(Math.random() * 16))];
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
}
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
  /* vp_set_game_prefs (migration 121): MERGES one game's keys into vp_venue_settings.game_prefs, as the live
     function does, so a console or the setup wizard (tools/game-setup-in-chrome.test.py, 6 Nov 2026) saves for real. */
  if (m === 'POST' && /\/rest\/v1\/rpc\/vp_set_game_prefs/.test(u)) {
    var gp = JSON.parse(opts.body), row = DB.vp_venue_settings.filter(function (x) { return x.venue_id === gp.p_venue_id; })[0];
    if (!row) { row = { venue_id: gp.p_venue_id }; DB.vp_venue_settings.push(row); }
    row.game_prefs = row.game_prefs || {};
    row.game_prefs[gp.p_game] = Object.assign({}, row.game_prefs[gp.p_game] || {}, gp.p_prefs);
    return resp(200, row.game_prefs);
  }
  if (m === 'POST' && /\/rest\/v1\/(\w+)/.test(u)) {
    var t = /\/rest\/v1\/(\w+)/.exec(u)[1], b = JSON.parse(opts.body);
    /* THE UNIQUE INDEX ON PLAYER ROWS, ENFORCED IN TEST MODE (migration 192, 13 Nov 2026): vp_players_session_device_uniq,
       one row per (session_id, device_id) where device_id is not null and kicked = false. A second insert is what
       PostgREST answers 409 (23505) to; the Worker's sbInsert turns that into its own 409 and handleJoin takes the phone back onto the
       row that won. On by default, as the live database will be; RIG_PLAYER_INDEX=false (the {rigIndex:false} message) is the
       database BEFORE the index, so the same join can be run both ways. RIG_RACE = {device_id, row} is the other join winning:
       a row put in the instant before this insert, which the single-threaded rig could otherwise never interleave. */
    if (t === 'vp_players' && !Array.isArray(b)) {
      if (globalThis.RIG_RACE && b.device_id && globalThis.RIG_RACE.device_id === b.device_id) {
        var rr = Object.assign({ session_id: b.session_id, device_id: b.device_id, kicked: false, id: rigUuid(), display_name: 'Winner', token_hash: 'h-winner', joined_at: '2026-11-13T07:00:00Z' }, globalThis.RIG_RACE.row || {});
        rr.token = 'tok-' + rr.id; DB.vp_players.push(rr); globalThis.RIG_RACE = null;
      }
      if (globalThis.RIG_PLAYER_INDEX !== false && b.device_id && b.kicked !== true && DB.vp_players.some(function (x) { return x.session_id === b.session_id && x.device_id === b.device_id && x.kicked !== true; }))
        return resp(409, { code: '23505', message: 'duplicate key value violates unique constraint "vp_players_session_device_uniq"' });
    }
    (Array.isArray(b) ? b : [b]).forEach(function (r) {
      /* A PLAYER ROW'S ID IS A UUID, AS POSTGRES MINTS IT (13 Nov 2026). It was 'pl-<n>', and handleJoin only takes a
         phone back onto its own row when that row's id is a UUID (UUID_RE), so here, and only here, every re-join by the
         same phone in the same session wrote a NEW row: one-phone-a-night-in-chrome went red under load whenever the musical
         page re-joined twice (the stale /player/card answer landing after its first re-join), while the live Worker
         reuses the row. reports/one-phone-race-13nov; proven by tools/rig-rejoin-one-row.test.py. */
      if (t === 'vp_players') { if (r.kicked == null) r.kicked = false; if (!r.id) r.id = rigUuid(); r.token = 'tok-' + r.id; }
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
  if (rq.rigIndex !== undefined) { globalThis.RIG_PLAYER_INDEX = !!rq.rigIndex; print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
  if (rq.race !== undefined) { globalThis.RIG_RACE = rq.race; print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
  if (rq.table) { print(JSON.stringify({ status: 200, body: DB[rq.table] || [] })); continue; }
  /* The Worker's clock, for a scene that has to happen on a given day (the purchase raffle's dates). */
  if (rq.now) { NOWMS = +rq.now; _rigAt = NOWMS; _wallAt = _D.now(); print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
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
