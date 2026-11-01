/* WHAT A JOIN COSTS THE DATABASE, AND WHAT IT MAY NEVER STOP CHECKING (31 Oct 2026).

   The 12 Sep 2026 plan for 1,000+ venues: once the lobby poll is cached and the room server is on,
   the wall is the JOIN. Every phone arriving in a room makes a run of Worker requests before it is
   seated in a game, and each request makes several calls through the Supabase gateway, which bent
   at about 43 calls a second on the 30 Oct live ramp.

   This RUNS the shipped code, never a copy and never a text search of it:
     part one    the REAL phone pages (venueplay/play.html, app/trivia/play.html, app/musical/play.html,
                 with the real vp-sign.js and vp-follow.js they load), booted from each road a punter
                 really takes: the TV's QR (/play?room=CODE) and a table talker or a trivia/musical
                 screen's QR (/play?venue=slug), for bingo, trivia and musical bingo. Every request a
                 page sends goes to the REAL handler in venueplay-backend/worker/venueplay-game.js
                 (tools/rig-game-worker.js) on a fake PostgREST that counts every database call. For
                 bingo the REAL console (app/index.html) is in the room and seats the phone, so
                 "seated" means what it means on a night: tickets dealt.
     part two    the REAL handlers again, one request at a time: who still sees the truth, on time
                 (a host console and a TV ask fresh), and every check the join makes still bites
                 (kicked, paused venue, paused group, plan, paper rule by state, age tick, the
                 collection gate on what a venue keeps), and musical bingo is never bingo.

   BEFORE is today's main plus the lobby fix (fix/lobby-poll-31oct 0a4a715f), measured by this same
   suite on that build: the figures are written below and the suite prints both.

   Run from the repo root:  jsc tools/test-join-cost.js */
load('tools/rig-game-worker.js');
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
drain = async function () { for (var r = 0; r < 6; r++) { for (var i = 0; i < 60; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };
readJson = async function (req) { return (req && req._body) || {}; };

/* EVERY DATABASE CALL IS COUNTED. The rig's emitEvent stands in for the real one, which is ONE
   call (the vp_emit_event function), so it is counted as one here. */
var DBN = 0, DOWN_TABLE = null, _rigFetch = fetch, CALLS = [];
fetch = async function (url, opts) {
  var u = String(url);
  if (u.indexOf('/rest/v1/') >= 0) { DBN++; CALLS.push(((opts && opts.method) || 'GET') + ' ' + u.slice(u.indexOf('/rest/v1/') + 9).split('?')[0]); }
  if (DOWN_TABLE && u.indexOf('/rest/v1/' + DOWN_TABLE) >= 0) return { ok: false, status: 503, json: async function () { return {}; }, text: async function () { return 'down'; }, headers: { get: function () { return null; } } };
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_players/.test(u)) {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) { if (r.kicked == null) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  var res = await _rigFetch(url, opts), _j = res.json;
  res.json = async function () { var v = await _j.call(res); return v == null ? v : JSON.parse(JSON.stringify(v)); };
  return res;
};
var _rigEmit = emitEvent;
emitEvent = async function (env, session, type, payload, actor) { DBN++; CALLS.push('RPC vp_emit_event'); return _rigEmit(env, session, type, payload, actor); };

/* MIGRATION 132, AS THE DATABASE WOULD ANSWER IT. vp_join_context only reads; this answers the same
   six things from the same fake tables by the same rules as the SQL in
   venueplay-backend/supabase/venueplay-132-one-trip-join-context.sql (an open session for the code,
   its venue and group, the six collect switches, the phone's earliest NOT KICKED row, the running
   games newest first). RPC_ON says whether this database has the function; off, it is a 404 as on a
   database where 132 has not been run. */
var RPC_ON = false, RPC_CALLS = 0;
function fakeJoinContext(a) {
  var s = (DB.vp_sessions || []).filter(function (x) { return x.join_code === a.p_code && ['lobby', 'running', 'paused'].indexOf(x.status) >= 0; })[0];
  if (!s) return { session: null };
  var v = (DB.vp_venues || []).filter(function (x) { return x.id === s.venue_id; })[0] || null;
  var g = v && v.group_id ? ((DB.vp_venue_groups || []).filter(function (x) { return x.id === v.group_id; })[0] || null) : null;
  var st = (DB.vp_venue_settings || []).filter(function (x) { return x.venue_id === s.venue_id; })[0] || null;
  var nz = function (x) { return x === undefined ? null : x; };
  var mine = a.p_device ? (DB.vp_players || []).filter(function (p) { return p.session_id === s.id && p.device_id === a.p_device && p.kicked === false; })
    .sort(function (x, y) { return x.joined_at < y.joined_at ? -1 : x.joined_at > y.joined_at ? 1 : 0; }) : [];
  var run = (DB.vp_games || []).filter(function (x) { return x.session_id === s.id && x.status === 'running'; })
    .sort(function (x, y) { return y.seq - x.seq; }).map(function (x) { return { id: x.id, seq: x.seq, format: x.format, config: nz(x.config), status: x.status }; });
  return { session: JSON.parse(JSON.stringify(s)),
           venue: v ? { status: v.status, group_id: nz(v.group_id), slug: v.slug } : null,
           group: g ? { status: g.status } : null,
           settings: st ? { collect_first_name: nz(st.collect_first_name), collect_last_name: nz(st.collect_last_name), collect_postcode: nz(st.collect_postcode),
                            collect_email: nz(st.collect_email), collect_mobile: nz(st.collect_mobile), collect_marketing_optin: nz(st.collect_marketing_optin) } : null,
           prior_id: mine.length ? mine[0].id : null, running: run };
}
var _countedFetch = fetch;
fetch = async function (url, opts) {
  if (String(url).indexOf('/rest/v1/rpc/vp_join_context') >= 0 && RPC_ON) {
    DBN++; RPC_CALLS++; CALLS.push('RPC vp_join_context');
    var body = fakeJoinContext(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async function () { return JSON.parse(JSON.stringify(body)); }, text: async function () { return JSON.stringify(body); }, headers: { get: function () { return null; } } };
  }
  return _countedFetch(url, opts);
};
/* A SECOND ISOLATE, the same shipped source, in a database that HAS migration 132. The first one has
   already been told 404 (below) and joins the old way for the rest of its life, as a live isolate does. */
var ISO_RPC = (new Function(SRC + '\n;readJson = async function (req) { return (req && req._body) || {}; };' +
  '\nsha256Hex = async function (s) { return "h-" + s; };' +
  '\nemitEvent = async function (env, session, type, payload) { return __emit(type, payload); };' +
  '\nreturn { handleJoin: handleJoin, handlePlayLive: handlePlayLive, handleJoinInfo: handleJoinInfo };'))();
function __emit(type, payload) { DBN++; CALLS.push('RPC vp_emit_event'); (DB.__events = DB.__events || []).push({ type: type, payload: payload }); return 1; }

function req(body, headers, url) { var h = headers || {}; return { _body: body, url: url || 'https://w/x', headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } }; }

var SLUG = 'test-pub', VCODE = fnvVenueCode(SLUG);
var S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
function world(state, fmt, opts) {
  opts = opts || {};
  /* A new night: every page from the last one is closed (its timers and channels gone), so nothing it
     would still ask is charged to, or warms a copy for, the next. */
  TIMERS = []; for (var bn in BUS) BUS[bn].forEach(function (sub) { sub.live = false; }); BUS = {}; QUEUE = [];
  NOWMS += 600000; NOW = 0;
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: SLUG, status: 'active', join_code: VCODE, au_state: state || 'QLD', permits: null, broadcast_enforce: false, group_id: opts.group ? 'gggggggg-gggg-4ggg-8ggg-gggggggggggg' : null }],
         vp_venue_groups: opts.group ? [{ id: 'gggggggg-gggg-4ggg-8ggg-gggggggggggg', status: 'active' }] : [],
         vp_venue_settings: [{ venue_id: VENUE, collect_first_name: true, collect_email: !!opts.email }],
         vp_venue_signing_keys: [{ venue_id: VENUE, public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } }],
         vp_sessions: [{ id: S1, venue_id: VENUE, status: 'lobby', join_code: VCODE, lobby_format: fmt, plan_cap_at_start: 100,
                         overage_approved: false, created_at: new Date().toISOString(), state_version: 1, paper: null, title: null }],
         vp_players: [], vp_games: [], vp_cards: [], vp_trivia_answers: [], vp_claims: [], vp_game_reports: [], vp_gaming_declarations: [],
         vp_music_games: [], vp_playlist_songs: [], vp_music_plays: [], vp_trivia_games: [], vp_questions: [], vp_captures: [], vp_player_captures: [] };
  if (fmt === 'musical_bingo') {
    DB.vp_games.push({ id: 'g-mus', session_id: S1, seq: 1, format: 'musical_bingo', status: 'running', config: { title: 'Songs' } });
    DB.vp_music_games.push({ game_id: 'g-mus', playlist_id: 'pl-1', pattern: 'line', reveal_mode: 'title' });
    for (var i = 0; i < 30; i++) DB.vp_playlist_songs.push({ id: 'song-' + i, playlist_id: 'pl-1', title: 'Song ' + i, artist: 'A', seq: i });
    DB.vp_sessions[0].status = 'running';
  }
  if (fmt === 'trivia') DB.vp_sessions[0].lobby_format = 'trivia';
}

/* ============================ the Worker, as the pages see it ============================ */
var COST = {}, REQS = {}, _lane = Promise.resolve();
/* ONE REQUEST AT A TIME, so each database call is charged to the request that made it. A page sends
   several at once, and counting the calls made while one was in flight would charge it for the others. */
function worker(path, body, who, headers, method) {
  var run = _lane.then(function () { return workerNow(path, body, who, headers, method); });
  _lane = run.catch(function () {});
  return run;
}
async function workerNow(path, body, who, headers, method) {
  var q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q);
  var rq = req(body || {}, headers, 'https://game.test' + path);
  var n0 = DBN, out;
  try {
    if (p === '/join/info') out = await handleJoinInfo(rq, ENV, json);
    else if (p === '/join') out = await (RPC_ON ? ISO_RPC.handleJoin : handleJoin)(rq, ENV, json);
    else if (p === '/play/live') out = await handlePlayLive(rq, ENV, json);
    else if (p === '/player/alive') out = await handlePlayerAlive(rq, ENV, json);
    else if (p === '/player/card') out = await handlePlayerCard(rq, ENV, json);
    else if (p === '/capture') out = await handleCapture(rq, ENV, json);
    else if (p === '/snapshot') out = await handleSnapshot(rq, ENV, json);
    else if (p === '/venue/signing/public') out = await handleSigningPublic(rq, ENV, json);
    else if (p === '/host/bingo/seat') out = await handleBingoSeat(rq, ENV, json);
    else if (p === '/session') out = { status: 200, body: { session_id: S1, join_code: VCODE, plan_cap: 100 } };
    else if (p === '/room/presence') out = { status: 503, body: { error: 'room server off' } };
    else out = { status: 404, body: { error: 'not routed: ' + p } };
  } catch (e) { out = { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
  if (who) { COST[who] = (COST[who] || 0) + (DBN - n0); (REQS[who] = REQS[who] || []).push(p + ' ' + (DBN - n0)); }
  return out;
}
function pageFetch(who) {
  return function (url, opts) {
    var path = String(url).replace(/^https?:\/\/[^\/]+/, ''), o = opts || {};
    var body = o.body ? JSON.parse(o.body) : {};
    var h = {}; if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
    return worker(path, body, who, h, o.method).then(function (r) {
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } };
    });
  };
}
/* The browser's WebCrypto, as far as vp-sign.js needs it to fetch and hold the venue's key. */
var phoneCrypto = { getRandomValues: fakeCrypto.getRandomValues,
  subtle: { importKey: function () { return Promise.resolve({}); }, verify: function () { return Promise.resolve(true); } } };
var SIGN = readFile('venueplay/app/vp-sign.js'), FOLLOW = readFile('venueplay/app/vp-follow.js'), VURL = readFile('venueplay/app/vp-venueurl.js');
function bootPage(path, search, who, store) {
  var dom = makeDom(search, store), sb = baseSandbox(dom, who);
  dom.window.crypto = phoneCrypto; sb.crypto = phoneCrypto; sb.globalThis = dom.window;
  sb.fetch = pageFetch(who);
  /* The shared scripts put their globals on window, as in a browser, where window IS the global. */
  ['VPSign', 'VPFollow', 'VPVenueURL'].forEach(function (n) { Object.defineProperty(sb, n, { get: function () { return dom.window[n]; }, set: function (v) { dom.window[n] = v; }, configurable: true }); });
  var pre = SIGN + '\n' + (path === 'venueplay/play.html' ? VURL + '\n' : FOLLOW + '\n');
  var ex = runPage(pre + inlineScript(path), sb, ['P', 'join', 'onMsg']);
  ex.dom = dom; ex.store = dom.localStorage._s; ex.$ = function (id) { return dom.document.getElementById(id); };
  return ex;
}
function bootConsole() {
  var dom = makeDom(''), sb = baseSandbox(dom, 'host');
  var ctx = { authed: true, scope: 'staff', role: 'owner', isAdmin: false, currentVenueId: VENUE, user: { user_metadata: { name: 'Dean' } },
              venue: { id: VENUE, slug: SLUG, name: 'Test Pub', status: 'active', max_players: 100, created_at: '2026-01-01T00:00:00Z' }, staff: [{ venue_id: VENUE }] };
  var VP = { useClient: function () {}, ready: function () { return Promise.resolve(ctx); }, refresh: function () { return Promise.resolve(ctx); }, suspensionBanner: function () {},
    venueCode: function () { return VCODE; }, venueJoinCode: function () { return Promise.resolve(null); },
    getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
    gameApiPost: function (path, body) { return worker(path, body, 'console').then(function (r) { return r.body; }); },
    gameApiCall: function (path, body) { return worker(path, body, 'console').then(function (r) { return { status: r.status, json: r.body }; }); },
    setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
    homeHref: function () { return 'index.html'; } };
  sb.VP = VP; dom.window.VP = VP;
  var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
  sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
  sb.fetch = pageFetch('console');
  var ex = runPage(consoleScript(), sb, ['G', 'openLobby', 'onMsg']);
  ex.$ = function (id) { return dom.document.getElementById(id); };
  return ex;
}

/* PUNTERS, FROM THE QR TO A SEAT. Boots the page the code or link opens for each of n phones in the
   same moment (a room that has just been told "scan the code"), follows any hop to the trivia or
   musical page with that phone's own storage, types a name, taps Join, and runs the night until the
   phone holds what it plays with: a seat in the console's bingo session, a trivia team, a musical
   card. What each phone's requests cost the database is read at the moment it is seated, so the
   lobby polls that follow are not charged to the join. */
var HOSTG = null;
function seatedNow(fmt, page) {
  if (!page || !page.P) return false;
  if (fmt === 'bingo90') { var hp = HOSTG && HOSTG.players[page.P.pid]; return !!(hp && hp.seatSid === S1); }
  if (fmt === 'trivia') return !!(page.P.token && page.P.joined);
  return !!(page.P.token && page.P.cells && page.P.cells.length);
}
async function punters(road, fmt, n, tag) {
  var search = road === 'qr' ? '?room=' + VCODE : '?venue=' + SLUG, ph = [];
  for (var i = 0; i < n; i++) {
    var who = 'ph-' + tag + '-' + i; COST[who] = 0; REQS[who] = [];
    ph.push({ who: who, page: bootPage('venueplay/play.html', search, who), hops: 0, at: null });
  }
  await advance(3000);
  for (var round = 0; round < 3; round++) {
    var moved = false;
    ph.forEach(function (x) {
      var to = x.page.dom.window._replaced;
      if (!to || x.hops > 2) return;
      x.hops++; moved = true;
      var file = to.indexOf('/app/trivia/play') === 0 ? 'venueplay/app/trivia/play.html'
               : to.indexOf('/app/musical/play') === 0 ? 'venueplay/app/musical/play.html' : 'venueplay/play.html';
      x.page = bootPage(file, to.slice(to.indexOf('?')), x.who, x.page.store);
    });
    if (!moved) break;
    await advance(3000);
  }
  ph.forEach(function (x, k) { x.page.$('nameIn').value = 'Pat' + tag + k; x.page.join(); });
  for (var t = 0; t < 120 && ph.some(function (x) { return !x.at; }); t++) {
    await advance(250);
    ph.forEach(function (x) { if (!x.at && seatedNow(fmt, x.page)) x.at = { cost: COST[x.who], reqs: REQS[x.who].slice() }; });
  }
  /* A join can finish after the seat: the name landing on the row, the details vouched for. Those
     are the join's too, so ten more seconds of them are counted. The lobby's own polls are not. */
  var mark = ph.map(function (x) { return REQS[x.who].length; });
  await advance(10000);
  ph.forEach(function (x, k) {
    if (!x.at) return;
    REQS[x.who].slice(mark[k]).forEach(function (r) {
      var sp = r.lastIndexOf(' '), path = r.slice(0, sp);
      if (path === '/join/info' || path === '/play/live') return;
      x.at.cost += +r.slice(sp + 1); x.at.reqs.push(r);
    });
  });
  return ph;
}
async function openRoom(fmt) {
  if (fmt !== 'bingo90') { HOSTG = null; return; }
  var host = bootConsole(); await advance(50);
  host.$('prizeInput').value = 'Meat tray'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(3000);
  HOSTG = host.G;
}

/* BEFORE: fix/lobby-poll-31oct 0a4a715f (main plus the lobby fix), measured by THIS suite run on that
   build's pages and Worker: the first phone into a room, from the QR to a seat. */
var BEFORE = { 'qr bingo90': 43, 'qr trivia': 42, 'qr musical_bingo': 61, 'venue bingo90': 43, 'venue trivia': 42, 'venue musical_bingo': 61 };
var BEFORE_ROOM = { 'qr bingo90': 43, 'qr trivia': 42, 'qr musical_bingo': 58.5, 'venue bingo90': 43, 'venue trivia': 42, 'venue musical_bingo': 58.5 };
/* What this build costs, per road (the run is deterministic: every night starts clean). A rise past these
   is a database call somebody added to the join. */
var CEIL_OLD = { 'qr bingo90': 28, 'qr trivia': 23, 'qr musical_bingo': 39, 'venue bingo90': 28, 'venue trivia': 23, 'venue musical_bingo': 39 };
var CEIL_132 = { 'qr bingo90': 20, 'qr trivia': 19, 'qr musical_bingo': 35, 'venue bingo90': 20, 'venue trivia': 19, 'venue musical_bingo': 35 };

(async function () {
  /* The isolate the pages talk to has asked for vp_join_context once and been told 404, as a live
     isolate is on a database where migration 132 has not been run. */
  world('QLD', 'bingo90');
  var n0 = DBN; await handleJoin(req({ code: VCODE, pid: 'warmup-phone-1', name: 'W' }), ENV, json);
  var probe = DBN - n0; n0 = DBN; await handleJoin(req({ code: VCODE, pid: 'warmup-phone-2', name: 'W' }), ENV, json);
  check('without migration 132 the Worker asks for vp_join_context once, then joins the old way and stops asking', probe === DBN - n0 + 1, [probe, DBN - n0]);

  print('\npart one: punters from the QR to a seat, on the real pages and the real Worker');
  var ROADS = [['qr', 'the TV\'s QR (/play?room=CODE)'], ['venue', 'a table talker or a trivia/musical screen\'s QR (/play?venue=slug)']];
  var FMTS = [['bingo90', 'bingo'], ['trivia', 'trivia'], ['musical_bingo', 'musical bingo']];
  var TABLE = [];
  for (var r = 0; r < ROADS.length; r++) for (var f = 0; f < FMTS.length; f++) {
    var road = ROADS[r][0], fmt = FMTS[f][0], key = road + ' ' + fmt, row = { key: key };
    for (var m = 0; m < 2; m++) {
      RPC_ON = m === 1;
      world('QLD', fmt); await openRoom(fmt);
      var one = (await punters(road, fmt, 1, 'a' + r + f + m))[0];
      world('QLD', fmt); await openRoom(fmt);
      var room = await punters(road, fmt, 10, 'r' + r + f + m);
      var allIn = room.every(function (x) { return !!x.at; });
      var avg = allIn ? room.reduce(function (t, x) { return t + x.at.cost; }, 0) / room.length : -1;
      row[m ? 'rpc' : 'old'] = one.at ? one.at.cost : -1; row[m ? 'rpcRoom' : 'oldRoom'] = avg;
      if (one.at) print('       ' + key + (m ? ' (132 run)' : '') + ': ' + one.at.cost + '  [' + one.at.reqs.join(', ') + ']');
      check(ROADS[r][1] + ', ' + FMTS[f][1] + (m ? ', migration 132 run' : '') + ': the first phone and all ten in a room are seated', !!one.at && allIn,
            one.at ? room.filter(function (x) { return !x.at; }).length + ' of 10 not seated' : (one.at === null ? 'not seated' : ''));
    }
    TABLE.push(row);
    check(ROADS[r][1] + ', ' + FMTS[f][1] + ': no dearer than this build allows, before and after migration 132',
          row.old >= 0 && row.old <= CEIL_OLD[key] && row.rpc >= 0 && row.rpc <= CEIL_132[key] && row.rpc < row.old,
          { now: row.old, with132: row.rpc, allowed: [CEIL_OLD[key], CEIL_132[key]] });
  }
  RPC_ON = false;
  print('\n       database calls per phone, from the QR to a seat');
  print('       road and game                     before   now  with 132   a room of ten: before / now / with 132');
  TABLE.forEach(function (x) {
    function pad(v, w) { v = String(v); while (v.length < w) v = ' ' + v; return v; }
    var name = x.key.replace('qr ', 'TV QR, ').replace('venue ', 'table talker, ').replace('bingo90', 'bingo').replace('musical_bingo', 'musical');
    while (name.length < 32) name += ' ';
    print('       ' + name + pad(BEFORE[x.key], 8) + pad(x.old, 6) + pad(x.rpc, 10) + '   ' + BEFORE_ROOM[x.key].toFixed(1) + ' / ' + x.oldRoom.toFixed(1) + ' / ' + x.rpcRoom.toFixed(1));
  });
  check('every road is at least a third cheaper than before, and at least 40% cheaper with migration 132', TABLE.every(function (x) { return x.old * 3 <= BEFORE[x.key] * 2 && x.rpc * 5 <= BEFORE[x.key] * 3; }),
        TABLE.map(function (x) { return x.key + ' ' + BEFORE[x.key] + '>' + x.old + '>' + x.rpc; }));

  await partTwo();
  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' join cost checks failed');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); throw e; });

/* ================================ PART TWO ================================ */
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
async function pl(code, opts) {
  opts = opts || {};
  var n0 = DBN, r;
  try { r = await (opts.iso || { handlePlayLive: handlePlayLive }).handlePlayLive(req({}, {}, 'https://game.test/play/live?code=' + code + (opts.fresh ? '&fresh=1' : '')), ENV, json); }
  catch (e) { r = { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
  return { status: r.status, body: r.body, cost: DBN - n0 };
}
async function joinAs(rpc, body) {
  RPC_ON = rpc;
  var n0 = DBN, r;
  try { r = await (rpc ? ISO_RPC.handleJoin : handleJoin)(req(body), ENV, json); }
  catch (e) { r = { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
  RPC_ON = false;
  return { status: r.status, body: r.body, cost: DBN - n0 };
}
var ISO_B = (new Function(SRC + '\n;readJson = async function (req) { return (req && req._body) || {}; };\nreturn { handlePlayLive: handlePlayLive };'))();
function startGame(fmt) { DB.vp_games.push({ id: 'g-' + fmt + '-' + DB.vp_games.length, session_id: S1, seq: DB.vp_games.length + 1, format: fmt, status: 'running', config: {} }); }
/* What a join wrote and answered, without what is random by design (ids, tokens) or the clock. */
function joinShape(r) {
  var b = r.body || {};
  var snap = b.snapshot ? JSON.parse(JSON.stringify(b.snapshot)) : null;
  return { status: r.status, error: b.error || null, token: !!b.token, snapshot: snap };
}
function playersShape() {
  return (DB.vp_players || []).map(function (p) {
    var o = {}; Object.keys(p).sort().forEach(function (k) { if (['id', 'token_hash', 'joined_at', 'last_seen_at'].indexOf(k) < 0) o[k] = p[k]; }); return o;
  });
}
async function bothWays(setup, steps) {
  var out = [];
  for (var m = 0; m < 2; m++) {
    var T = NOWMS; setup(); var res = [];
    for (var i = 0; i < steps.length; i++) res.push(joinShape(await joinAs(m === 1, steps[i])));
    out.push({ replies: res, rows: playersShape(), events: (DB.__events || []).map(function (e) { return e.type + ':' + JSON.stringify(e.payload); }) });
    NOWMS = T;   // the second run sees the same clock as the first
  }
  return out;
}

async function partTwo() {
  print('\npart two (a): /play/live from Worker memory, and who still sees the truth');
  world('QLD', 'bingo90');
  var first = await pl(VCODE);
  check('the first ask reads the database, and the venue and its row are ONE read now (3 calls, was 4)', first.cost === 3 && first.body.live === true, first);
  var roomCost = 0, allSame = true;
  for (var i = 0; i < 39; i++) { var a = await pl(VCODE); roomCost += a.cost; if (!same(a.body, first.body)) allSame = false; }
  check('thirty-nine more phones asking in the same moment cost NO database call, and are told the same', roomCost === 0 && allSame, roomCost);
  NOWMS += 3900; var still = await pl(VCODE);
  NOWMS += 200; var again = await pl(VCODE);
  check('the copy lasts four seconds: inside it nothing is read, past it the database is read again', still.cost === 0 && again.cost === 3, [still.cost, again.cost]);
  var fr = await pl(VCODE, { fresh: true });
  check('fresh=1 reads the database even with a copy in date', fr.cost === 3 && same(fr.body, first.body), fr.cost);

  world('QLD', 'bingo90'); DB.vp_sessions[0].status = 'finished';
  var quiet = await pl(VCODE);
  DB.vp_sessions[0].status = 'lobby'; DB.vp_sessions[0].lobby_format = 'trivia';     // another tablet opens a trivia lobby
  NOWMS += 500;
  var stale = await pl(VCODE), told = await pl(VCODE, { fresh: true }), after = await pl(VCODE);
  check('CONTROL: half a second after a lobby opens, a routine ask can still be told nothing is on', quiet.body.live === false && stale.body.live === false);
  check('a fresh ask is told the trivia lobby at once, and refreshes the copy for the rest of the room', told.body.live === true && told.body.format === 'trivia' && after.body.format === 'trivia' && after.cost === 0, [told.body, after.cost]);
  world('QLD', 'bingo90'); await pl(VCODE); NOWMS += 100; DB.vp_sessions[0].status = 'finished'; NOWMS += 4000;
  var closed = await pl(VCODE);
  check('a night that closes reaches the next routine ask within the four seconds', closed.body.live === false, closed.body);

  world('QLD', 'bingo90');
  var held = false, release = null, _f = fetch;
  /* The session read is answered as the database stood when it was asked, and handed back late. */
  fetch = function (url, opts) { if (!held && String(url).indexOf('/rest/v1/vp_sessions') >= 0) { held = true; var asked = _f(url, opts); return new Promise(function (res) { release = function () { res(asked); }; }); } return _f(url, opts); };
  var slow = pl(VCODE);
  for (var k = 0; k < 200; k++) await Promise.resolve();
  NOWMS += 100; DB.vp_sessions[0].status = 'finished';               // the host closes the night meanwhile
  var quick = await pl(VCODE, { fresh: true });
  release(); var slowR = await slow; fetch = _f;
  var room = await pl(VCODE);
  check('a slow read cannot put an older answer back over a newer one', held && slowR.body.live === true && quick.body.live === false && room.body.live === false && room.cost === 0, [slowR.body.live, quick.body.live, room.body.live, room.cost]);

  world('QLD', 'bingo90'); DOWN_TABLE = 'vp_sessions';
  var down = await pl(VCODE); DOWN_TABLE = null; var up = await pl(VCODE);
  var u1 = await pl('ZZZZZZ'), u2 = await pl('ZZZZZZ');
  check('a database fault is never kept, and neither is "no such venue"', down.status >= 500 && up.cost > 0 && up.body.live === true && u1.body.exists === false && u2.cost > 0, [down.status, up.cost, u2.cost]);

  world('QLD', 'bingo90'); await pl(VCODE);
  DB.vp_venues[0].status = 'suspended';
  var j1 = await joinAs(false, { code: VCODE, pid: 'phone-paused-1', name: 'P' }), j2 = await joinAs(true, { code: VCODE, pid: 'phone-paused-2', name: 'P' });
  NOWMS += 4100; var paused = await pl(VCODE);
  check('a venue paused for billing: the next join is refused at once, both ways, in the player\'s words', j1.status === 403 && j2.status === 403 && /paused here tonight/.test(j1.body.error) && j1.body.error === j2.body.error, [j1, j2]);
  check('and the wall\'s answer says paused within the four seconds', paused.body.suspended === true && paused.body.live === false, paused.body);

  var mism = [], musicalPaper = [], ages = {};
  var states = ['QLD', 'NSW', 'VIC', 'SA', 'TAS', 'ACT', 'WA', 'NT'], fmts = ['bingo90', 'musical_bingo', 'trivia', 'caller'];
  for (var si = 0; si < states.length; si++) for (var fi = 0; fi < fmts.length; fi++) {
    world(states[si], fmts[fi] === 'caller' ? 'bingo90' : fmts[fi]);
    if (fmts[fi] === 'caller') DB.vp_sessions[0].paper = { bingo: { caller: true } };
    if (fmts[fi] === 'trivia') startGame('trivia');
    var dbA = await pl(VCODE, { fresh: true }); NOWMS += 1000;
    var keptA = await pl(VCODE), keptB = await pl(VCODE, { iso: ISO_B });
    var keptB2 = await pl(VCODE, { iso: ISO_B });
    if (keptA.cost !== 0 || !same(keptA.body, dbA.body) || !same(keptB.body, dbA.body) || keptB2.cost !== 0) mism.push(states[si] + ' ' + fmts[fi]);
    if (fmts[fi] === 'musical_bingo' && (dbA.body.paper_bingo || dbA.body.age_gate)) musicalPaper.push(states[si]);
    ages[states[si] + ' ' + fmts[fi]] = [dbA.body.paper_bingo, dbA.body.age_gate];
  }
  check('32 nights (8 states, bingo / musical / trivia / caller mode): the kept answer equals the database answer, on two isolates', mism.length === 0, mism);
  check('musical bingo is never on paper and never age-gated, in any state, kept or not', musicalPaper.length === 0, musicalPaper);
  check('CONTROL: SA, VIC and TAS bingo is on paper, caller mode is on paper everywhere, VIC bingo asks the age tick',
        ages['SA bingo90'][0] === true && ages['TAS bingo90'][0] === true && ages['VIC bingo90'][0] === true && ages['QLD caller'][0] === true && ages['VIC bingo90'][1] === true && ages['QLD bingo90'][0] === false, ages);

  world('QLD', 'bingo90'); DB.vp_venues[0].join_code = 'CDEFGH';    // the owner pressed Change code
  var byNew = await pl('CDEFGH', { fresh: true }), byOld = await pl(VCODE, { fresh: true });
  check('after Change code: the new code is one read, and a table talker\'s code (the slug\'s hash) still finds the venue', byNew.body.live === true && byNew.cost === 3 && byOld.body.live === true && byOld.body.name === 'Test Pub', [byNew.cost, byOld.body]);

  /* THE CALLERS THAT MUST SEE THE TRUTH. */
  world('QLD', 'bingo90'); DB.vp_sessions[0].status = 'finished';
  await pl(fnvVenueCode(SLUG));                                       // a phone's routine ask: nothing open, kept
  DB.vp_sessions[0].status = 'lobby';                                  // another tablet opens a lobby
  NOWMS += 1000;
  var asked = [], fetched = [];
  var win = { supabase: { createClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); }, onAuthStateChange: function () {} }, from: function () { return { select: function () { return this; }, eq: function () { return this; }, maybeSingle: function () { return Promise.resolve({ data: null }); } }; } }; } },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    location: { href: '', pathname: '/app/index.html', search: '' },
    document: { addEventListener: function () {}, readyState: 'complete', createElement: function () { return { style: {}, appendChild: function () {} }; },
                body: { appendChild: function () {}, insertBefore: function () {} }, head: { appendChild: function () {} },
                getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } },
    addEventListener: function () {}, navigator: { userAgent: 'jsc' },
    vpAsk: function (text) { asked.push(text); return Promise.resolve(false); } };
  win.window = win; win.top = win; win.self = win;
  var vfetch = function (url, o) { fetched.push(String(url)); return pageFetch('console2')(url, o); };
  var CVP = (new Function('window', 'localStorage', 'sessionStorage', 'document', 'location', 'setTimeout', 'fetch', 'navigator',
    readFile('venueplay/app/vp-session.js') + '\nreturn window.VP;'))(win, win.localStorage, win.sessionStorage, win.document, win.location, fSetTimeout, vfetch, win.navigator);
  var verdict = null; CVP.confirmTakeover(SLUG).then(function (v) { verdict = v; });
  await advance(500);
  check('a host console about to open a lobby asks the database: a lobby another tablet opened a second ago is seen, and the host is asked',
        asked.length === 1 && /already open at this venue/.test(asked[0]) && verdict === false && fetched.some(function (u) { return /\/play\/live\?code=[A-Z0-9]{6}&fresh=1$/.test(u); }), { asked: asked, fetched: fetched });

  async function screenStays(file, phaseMsg) {
    world('QLD', file.indexOf('musical') >= 0 ? 'musical_bingo' : 'trivia');
    var tvAsks = [];
    var dom = makeDom('?venue=' + SLUG), sb = baseSandbox(dom, 'tv');
    /* Drawing, fitting and the ad router are not what this is about: any call answers a do-nothing. */
    var stub = new Proxy({}, { get: function () { return function () { return stub; }; } });
    ['VPQR', 'VPVenueLogo', 'VPFit', 'VPScreenRouter', 'VPCelebrate'].forEach(function (n) { sb[n] = stub; dom.window[n] = stub; });
    sb.globalThis = dom.window;
    sb.sessionStorage = dom.sessionStorage = { getItem: function (k) { return k === 'vpTvHop' ? '1' : null; }, setItem: function () {}, removeItem: function () {} };
    Object.defineProperty(sb, 'VPVenueURL', { get: function () { return dom.window.VPVenueURL; } });
    sb.fetch = function (url, o) { var u = String(url); if (u.indexOf('/play/live') >= 0) tvAsks.push(u.replace(/^https?:\/\/[^\/]+/, '')); return u.indexOf('/play/live') >= 0 ? pageFetch('tv')(url, o) : Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } }); };
    var ex = runPage(readFile('venueplay/app/vp-venueurl.js') + '\n' + inlineScript(file), sb, ['state', 'onMsg']);
    await advance(1000);
    ex.onMsg(phaseMsg);
    /* The host goes quiet (an iPad locked for the hour before the quiz). Just before the screen asks,
       the night is closed and reopened, and a phone's routine ask has the closed night in the copy. */
    await advance(5 * 60 * 1000 - 40000);
    DB.vp_sessions[0].status = 'finished'; await pl(fnvVenueCode(SLUG)); DB.vp_sessions[0].status = file.indexOf('musical') >= 0 ? 'running' : 'lobby';
    await advance(90000);
    return { asks: tvAsks, left: dom.window.location.href || dom.window._replaced || '' };
  }
  var tvT = await screenStays('venueplay/app/trivia/screen.html', { t: 'started', title: 'Quiz' });
  check('the trivia TV, its host silent for five minutes, asks the database and keeps its lobby up: the copy\'s "closed" never reaches it',
        tvT.asks.length >= 1 && tvT.asks.every(function (u) { return /&fresh=1$/.test(u); }) && !/\/tv\?venue=/.test(tvT.left), tvT);
  var tvM = await screenStays('venueplay/app/musical/screen.html', { t: 'started', title: 'Songs' });
  check('the musical TV, a game running and its host silent, asks the database and keeps the game on the wall',
        tvM.asks.length >= 1 && tvM.asks.every(function (u) { return /&fresh=1$/.test(u); }) && !/\/tv\?venue=/.test(tvM.left), tvM);

  print('\npart two (b): the one-trip join (migration 132) and the old reads answer the same, and every check still bites');
  function base(fmt, opts) { return function () { world((opts && opts.state) || 'QLD', fmt, opts); NOWMS = 1790000000000; if (opts && opts.setup) opts.setup(); }; }
  var cases = [
    ['a new phone, then the same phone again (one player, its name updated)', base('bingo90'), [{ code: VCODE, pid: 'phone-same-1', name: 'Ann' }, { code: VCODE, pid: 'phone-same-1', name: 'Annie' }]],
    ['two phones on one network, and a phone with no device id', base('bingo90'), [{ code: VCODE, pid: 'phone-two-1', name: 'A' }, { code: VCODE, pid: 'phone-two-2', name: 'B' }, { code: VCODE, name: 'C' }]],
    ['a kicked phone joining again gets a new row; the kicked row stays kicked', base('trivia', { setup: function () { DB.vp_players.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', session_id: S1, device_id: 'phone-kick-1', kicked: true, display_name: 'Kim', joined_at: '2026-10-31T09:00:00.000Z' }); } }), [{ code: VCODE, pid: 'phone-kick-1', name: 'Kim' }]],
    ['a "paper-" device id is never handed the paper player\'s row', base('musical_bingo', { setup: function () { DB.vp_players.push({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', session_id: S1, device_id: 'paper-m-1', kicked: false, joined_at: '2026-10-31T09:00:00.000Z' }); } }), [{ code: VCODE, pid: 'paper-m-1', name: 'Sneaky' }]],
    ['a venue that collects email keeps it; one that does not, does not; a tick with no way to contact is not kept', base('trivia', { email: true }), [{ code: VCODE, pid: 'phone-mail-1', name: 'E', email: 'e@x.au', mobile: '0400', marketing_optin: true }]],
    ['a venue that collects nothing past a first name keeps nothing else', base('trivia'), [{ code: VCODE, pid: 'phone-mail-2', name: 'E', email: 'e@x.au', postcode: '4000', marketing_optin: true }]],
    ['a venue paused for billing refuses, in the player\'s words', base('bingo90', { setup: function () { DB.vp_venues[0].status = 'suspended'; } }), [{ code: VCODE, pid: 'phone-sus-1', name: 'S' }]],
    ['a venue whose group is paused refuses the same way', base('bingo90', { group: true, setup: function () { DB.vp_venue_groups[0].status = 'suspended'; } }), [{ code: VCODE, pid: 'phone-grp-1', name: 'G' }]],
    ['a group that is active lets the phone in', base('bingo90', { group: true }), [{ code: VCODE, pid: 'phone-grp-2', name: 'G' }]],
    ['no open session: "No active game with that code"', base('bingo90', { setup: function () { DB.vp_sessions[0].status = 'finished'; } }), [{ code: VCODE, pid: 'phone-none-1', name: 'N' }]],
    ['over the plan\'s players: nobody is turned away, and the snapshot says over the cap (billed as overage)', base('bingo90', { setup: function () { DB.vp_sessions[0].plan_cap_at_start = 2; } }), [{ code: VCODE, pid: 'phone-cap-1', name: '1' }, { code: VCODE, pid: 'phone-cap-2', name: '2' }, { code: VCODE, pid: 'phone-cap-3', name: '3' }]],
    ['a trivia night with a question up: the snapshot carries it, never its answer', base('trivia', { setup: function () { startGame('trivia'); var g = DB.vp_games[DB.vp_games.length - 1]; DB.vp_trivia_games.push({ game_id: g.id, question_set_id: 'set-1', current_seq: 3, phase: 'asking', question_ends_at: null }); DB.vp_questions.push({ set_id: 'set-1', seq: 3, question: 'Q?', options: ['a', 'b'], correct_index: 1 }); } }), [{ code: VCODE, pid: 'phone-triv-1', name: 'T' }]],
    ['a musical game running: the snapshot carries the songs played', base('musical_bingo', { setup: function () { DB.vp_music_plays.push({ game_id: 'g-mus', song_id: 'song-3', seq: 1, played_at: '2026-10-31T09:10:00.000Z' }); } }), [{ code: VCODE, pid: 'phone-mus-1', name: 'M' }]],
  ];
  var diff = [];
  for (var c = 0; c < cases.length; c++) {
    var both = await bothWays(cases[c][1], cases[c][2]);
    var eq = same(both[0], both[1]);
    if (!eq) diff.push(cases[c][0]);
    var w = both[1];
    var okc = eq;
    if (c === 0) okc = eq && w.rows.length === 1 && w.rows[0].display_name === 'Annie' && w.replies.every(function (x) { return x.token; }) && w.events.length === 1;
    if (c === 1) okc = eq && w.rows.length === 3;
    if (c === 2) okc = eq && w.rows.length === 2 && w.rows[0].kicked === true && w.rows[1].kicked === false;
    if (c === 3) okc = eq && w.rows.length === 2 && !w.rows[1].device_id;
    if (c === 4) okc = eq && w.rows[0].email === 'e@x.au' && !w.rows[0].mobile;
    if (c === 5) okc = eq && !w.rows[0].email && !w.rows[0].postcode && !w.rows[0].marketing_optin;
    if (c === 6 || c === 7) okc = eq && w.replies[0].status === 403 && w.replies[0].error === 'Games are paused here tonight. Have a word with the staff.' && w.rows.length === 0;
    if (c === 8) okc = eq && w.replies[0].status === 200 && w.rows.length === 1;
    if (c === 9) okc = eq && w.replies[0].status === 404 && w.replies[0].error === 'No active game with that code';
    if (c === 10) okc = eq && w.replies[2].status === 200 && w.replies[2].snapshot.over_cap === true && w.replies[1].snapshot.over_cap === false;
    if (c === 11) okc = eq && w.replies[0].snapshot.game.question.text === 'Q?' && w.replies[0].snapshot.game.question.correct_index === undefined;
    if (c === 12) okc = eq && w.replies[0].snapshot.game.played_songs.length === 1;
    check(cases[c][0] + ': both ways alike', okc, eq ? w : both);
  }
  check('all ' + cases.length + ' cases: the one-trip join and the old reads give the same replies, the same rows and the same TV events', diff.length === 0, diff);

  /* What a join costs, request by request. */
  var counts = {};
  for (var m2 = 0; m2 < 2; m2++) {
    base('bingo90')();
    var nw = await joinAs(m2 === 1, { code: VCODE, pid: 'phone-cost-1', name: 'A' });
    var rj = await joinAs(m2 === 1, { code: VCODE, pid: 'phone-cost-1', name: 'A2' });
    counts[m2 ? 'one_trip' : 'old'] = [nw.cost, rj.cost];
  }
  print('       POST /join, bingo lobby: new phone / same phone again = before 11 / 9, now ' + counts.old.join(' / ') + ', with migration 132 ' + counts.one_trip.join(' / '));
  check('a new phone\'s join is 8 database calls (was 11), a re-join 7 (was 9): no read made twice in one request', counts.old[0] === 8 && counts.old[1] === 7, counts.old);
  check('with migration 132 a new phone\'s join is 4 calls and a re-join 3', counts.one_trip[0] === 4 && counts.one_trip[1] === 3, counts.one_trip);

  world('QLD', 'bingo90');
  var sg = async function (q) { var n0 = DBN, r = await handleSigningPublic(req({}, {}, 'https://game.test/venue/signing/public?' + q), ENV, json); return { body: r.body, cost: DBN - n0 }; };
  var k1 = await sg('code=' + VCODE);
  DB.vp_venues[0].status = 'suspended'; var k2 = await sg('code=' + VCODE); DB.vp_venues[0].status = 'active';
  /* The venue map behind a code that is not the issued one is rebuilt each minute, as before. */
  NOWMS += 61000; DB.vp_venues[0].join_code = 'CDEFGH'; var k3 = await sg('code=' + VCODE), k4 = await sg('code=CDEFGH');
  check('a phone\'s venue key by code is 2 calls (was 3); a paused venue has none; after Change code both codes still find it',
        k1.cost === 2 && k1.body.exists === true && k2.body.exists === false && k3.body.exists === true && k4.body.exists === true && k4.cost === 2, [k1, k2.body, k3.body, k4.cost]);
}
