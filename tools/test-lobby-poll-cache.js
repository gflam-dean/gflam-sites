/* THE LOBBY POLL IS CHEAP, AND STILL TRUE (31 Oct 2026).

   The live ramp of 30 Oct 2026 bent the database gateway at about 43 calls a second, about fifteen
   venues on a busy night, and the biggest single load was phones waiting in a lobby asking
   /join/info every eight seconds at four database calls a time. The game Worker now keeps that
   answer in memory for a few seconds per code and hands it to every phone in the room.

   This RUNS the shipped code, never a copy and never a text search of it:
     part one    the REAL handleJoinInfo out of venueplay-game.js (tools/rig-game-worker.js), on a
                 fake PostgREST that counts every database call, including a SECOND isolate built
                 from the same source, because a real night is answered by more than one
     part two    the REAL venueplay/app/vp-follow.js (the trivia and musical phones' watcher)
     part three  the REAL bingo console (app/index.html) and REAL phone pages (play.html) on one
                 channel (tools/rig-bingo-room.js), wired to the real Worker handlers: a host
                 opens a lobby, a room of phones waits, and the host switches the night to trivia

   What it proves:
     - phones asking inside the window cost NO database call at all
     - a game starting, ending or switching reaches every polling phone within one poll
       (eight seconds) plus the window, and a phone that was TOLD (a console's message, a page that
       has just loaded after a hop) is answered from the database at once
     - a phone never sees an answer older than one it has already had, across two isolates, so the
       room cannot bounce between two games
     - a kicked player and a paused (suspended) venue are refused at once: the copy is not on that road
     - failures and "no such code" are never kept
     - the copy answers exactly what the database would, for every state's paper and age rules,
       and musical bingo is never treated as bingo

   Run from the repo root:  jsc tools/test-lobby-poll-cache.js */
load('tools/rig-game-worker.js');
var _wShow = show;                 // the Worker rig's counters: this suite keeps its own
load('tools/rig-bingo-room.js');
var PASS = 0, FAILN = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAILN++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
/* One clock for every part: the room rig's virtual time on the Worker rig's fixed day. Part one
   moves NOWMS itself; part three lets the room rig's timers move NOW. */
Date = function (v) { return arguments.length ? new _D(v) : new _D(NOWMS + NOW); };
Date.now = function () { return NOWMS + NOW; }; Date.parse = _D.parse; Date.UTC = _D.UTC; Date.prototype = _D.prototype;
drain = async function () { for (var r = 0; r < 6; r++) { for (var i = 0; i < 60; i++) await Promise.resolve(); pump(); } };
sha256Hex = async function (s) { return 'h-' + s; };          // distinct hashes, so tokens are told apart
readJson = async function (req) { return (req && req._body) || {}; };

/* EVERY DATABASE CALL IS COUNTED, and a table can be switched off to play a database fault. */
var DBN = 0, DOWN_TABLE = null, _rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (u.indexOf('/rest/v1/') >= 0) DBN++;
  if (DOWN_TABLE && u.indexOf('/rest/v1/' + DOWN_TABLE) >= 0) return { ok: false, status: 503, json: async function () { return {}; }, text: async function () { return 'down'; }, headers: { get: function () { return null; } } };
  // The real table defaults kicked to false; the fake one has no defaults.
  if (opts && String(opts.method).toUpperCase() === 'POST' && /\/rest\/v1\/vp_players/.test(u)) {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) { if (r.kicked == null) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  /* PostgREST sends new JSON on every call. The rig hands back its own row objects, so a row edited
     in place would also edit whatever the Worker kept, and a stale copy would look fresh. Clone. */
  var res = await _rigFetch(url, opts), _j = res.json;
  res.json = async function () { var v = await _j.call(res); return v == null ? v : JSON.parse(JSON.stringify(v)); };
  return res;
};

/* A SECOND ISOLATE: the same shipped source, its own memory. Cloudflare answers one room from
   several, and the copy is per isolate, so anything true of one must be true across two. */
var ISO_B = (new Function(SRC + '\n;readJson = async function (req) { return (req && req._body) || {}; };\n' +
  'return { handleJoinInfo: handleJoinInfo };'))();
var ISO_A = { handleJoinInfo: handleJoinInfo };

function req(body, headers) { var h = headers || {}; return { _body: body, url: 'https://w/x', headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } }; }
async function call(fn, body, headers) {
  try { return await fn(req(body, headers), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
/* One phone's /join/info, and what it cost the database. */
async function ask(code, opts) {
  opts = opts || {};
  var body = { code: code }; if (opts.fresh) body.fresh = 1;
  var n0 = DBN;
  var r = await call((opts.iso || ISO_A).handleJoinInfo, body);
  return { status: r.status, body: r.body, cost: DBN - n0 };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var VCODE = fnvVenueCode('test-pub');
var S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
/* A NEW NIGHT: the clock jumps a minute, so nothing either isolate kept from the last scenario is
   still in date. The phones' codes are the venue's own, as on every TV's QR since migration 68. */
function world(state, fmt, extra) {
  NOWMS += 60000;
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: VCODE, au_state: state || 'QLD', permits: null }],
         vp_venue_groups: [], vp_venue_settings: [{ venue_id: VENUE, collect_first_name: true, collect_email: false }],
         vp_sessions: [Object.assign({ id: S1, venue_id: VENUE, status: 'lobby', join_code: VCODE, lobby_format: fmt === undefined ? 'bingo90' : fmt,
                        plan_cap_at_start: 100, overage_approved: false, created_at: new Date().toISOString(), state_version: 1 }, extra || {})],
         vp_players: [], vp_games: [], vp_cards: [], vp_trivia_answers: [], vp_claims: [], vp_game_reports: [], vp_gaming_declarations: [] };
}
function startTrivia() { DB.vp_games.push({ id: 'g-triv', session_id: S1, seq: 1, format: 'trivia', status: 'running' }); }

(async function () {
  /* ================================ PART ONE: the Worker ================================ */
  print('part one: the real handleJoinInfo, counting database calls');
  world('QLD', 'bingo90');
  var first = await ask(VCODE);
  check('the first phone in the lobby reads the database (the lookup is real)', first.cost >= 3 && first.body.channel === VCODE, first.cost + ' calls');
  var room = [], roomCost = 0;
  for (var i = 0; i < 39; i++) { var a = await ask(VCODE); room.push(a); roomCost += a.cost; }
  check('THIRTY-NINE more phones asking in the same moment cost NO database call', roomCost === 0, roomCost + ' calls');
  check('and every one of them is told exactly what the first was', room.every(function (x) { return same(x.body, first.body); }));
  var inWindow = 0;
  for (var t = 0; t < 4; t++) { NOWMS += 950; inWindow += (await ask(VCODE)).cost; }
  check('phones asking across the next 3.8 seconds still cost nothing', inWindow === 0, inWindow + ' calls');
  NOWMS += 8000 - 3800;
  var later = await ask(VCODE);
  check('one routine poll later (8 s, the shortest gap any page polls at) the database is read again', later.cost > 0, later.cost + ' calls');
  check('and that read is only the live part: the venue row and its settings come from the 30 s copy', later.cost === 2, later.cost + ' calls');
  var fr = await ask(VCODE, { fresh: true });
  check('fresh:1 is answered from the database even with a copy in date, the venue row and settings included', fr.cost === first.cost && fr.cost >= 4 && same(fr.body, first.body), fr.cost + ' calls');

  print('a game starting reaches the phones');
  world('QLD', 'bingo90');
  var pre = await ask(VCODE);
  NOWMS += 500; startTrivia();
  var stale = await ask(VCODE);
  var pushed = await ask(VCODE, { fresh: true });
  check('a phone a console has just told (fresh:1) is sent to trivia at once', pushed.body.format === 'trivia', pushed.body.format);
  var after = await ask(VCODE);
  check('and its read refreshes the copy: the rest of the room asking now is told trivia too, at no cost', after.body.format === 'trivia' && after.cost === 0, after);
  check('CONTROL: before that, a routine poll inside the window could still say the bingo lobby', pre.body.format === 'bingo90' && stale.body.format === 'bingo90', stale.body.format);
  world('QLD', 'bingo90');
  await ask(VCODE); NOWMS += 300; startTrivia();
  NOWMS += 8000;
  var next = await ask(VCODE);
  check('a phone nobody told is sent to trivia by its next routine poll', next.body.format === 'trivia', next.body.format);

  print('a game ending reaches the phones');
  world('QLD', 'trivia'); startTrivia();
  var on = await ask(VCODE);
  NOWMS += 1000;
  DB.vp_games[0].status = 'finished'; DB.vp_sessions[0].lobby_format = 'bingo90';   // the host ends trivia and opens a bingo lobby
  NOWMS += 8000;
  var off = await ask(VCODE);
  check('the trivia round ends and a bingo lobby opens: the next routine poll says bingo', on.body.format === 'trivia' && off.body.format === 'bingo90', [on.body.format, off.body.format]);
  DB.vp_sessions[0].status = 'finished';                                               // the host closes the night
  NOWMS += 8000;
  var closed = await ask(VCODE);
  check('the night is closed: the next routine poll says nothing is on', closed.body.format === '' && closed.body.paper_bingo === false, closed.body);

  print('a room of forty phones over three minutes, the host switching to trivia at one minute');
  async function night(isos, fresh) {
    world('QLD', 'bingo90');
    var T0 = NOWMS, SWITCH = T0 + 60000, END = T0 + 180000, phones = [], cost = 0, asks = 0;
    for (var p = 0; p < 40; p++) phones.push({ next: T0 + p * 200, seen: [], hopAt: 0, iso: isos[p % isos.length] });
    var switched = false;
    for (;;) {
      var ph = null; phones.forEach(function (x) { if (!ph || x.next < ph.next) ph = x; });
      if (ph.next > END) break;
      NOWMS = ph.next;
      if (!switched && NOWMS >= SWITCH) { startTrivia(); switched = true; }
      var r = await ask(VCODE, { iso: ph.iso, fresh: fresh });
      cost += r.cost; asks++;
      ph.seen.push(r.body.format);
      if (r.body.format === 'trivia' && !ph.hopAt) ph.hopAt = NOWMS;
      ph.next += 8000;
    }
    var latest = 0, back = false;
    phones.forEach(function (x) { latest = Math.max(latest, x.hopAt - SWITCH); var k = x.seen.indexOf('trivia'); if (k >= 0 && x.seen.slice(k).some(function (f) { return f !== 'trivia'; })) back = true; });
    return { cost: cost, asks: asks, latest: latest, back: back, all: phones.every(function (x) { return x.hopAt > 0; }) };
  }
  var OLD = await night([ISO_A], true);       // every phone asking the database, which is what the poll cost before
  var NEW = await night([ISO_A], false);
  var TWO = await night([ISO_A, ISO_B], false);
  print('       ' + OLD.asks + ' polls each run. database calls: before ' + OLD.cost + ', after ' + NEW.cost + ' on one isolate, ' + TWO.cost + ' on two');
  check('the same room asks the database at least ten times less', NEW.cost * 10 <= OLD.cost && TWO.cost * 5 <= OLD.cost, { before: OLD.cost, after: NEW.cost, twoIsolates: TWO.cost });
  check('every phone was moved to trivia within one poll plus the window (12 s), on one isolate and on two',
        NEW.all && TWO.all && NEW.latest <= 12000 && TWO.latest <= 12000, { one: NEW.latest, two: TWO.latest });
  check('and no phone was ever told bingo again after trivia: the room cannot bounce', !NEW.back && !TWO.back);

  print('the copy says exactly what the database says, in every state, and musical bingo is not bingo');
  var mismatch = [], musicalPaper = [];
  var cases = [['bingo90', null], ['musical_bingo', null], ['trivia', null], ['bingo90', { paper: { bingo: true } }]];
  var states = ['QLD', 'NSW', 'VIC', 'SA', 'TAS', 'ACT', 'WA', 'NT'];
  for (var s = 0; s < states.length; s++) for (var c = 0; c < cases.length; c++) {
    world(states[s], cases[c][0], cases[c][1]);
    if (cases[c][0] === 'musical_bingo') DB.vp_games.push({ id: 'g-mus', session_id: S1, seq: 1, format: 'musical_bingo', status: 'running' });
    var db = await ask(VCODE, { fresh: true });
    NOWMS += 1000;
    var kept = await ask(VCODE);
    var keptB = await ask(VCODE, { iso: ISO_B });
    if (kept.cost !== 0 || !same(kept.body, db.body) || !same(keptB.body, db.body)) mismatch.push(states[s] + ' ' + cases[c][0]);
    if (cases[c][0] === 'musical_bingo' && (db.body.paper_bingo || kept.body.paper_bingo)) musicalPaper.push(states[s]);
  }
  check('32 nights (8 states, bingo / musical / trivia / caller mode): the kept answer equals the database answer', mismatch.length === 0, mismatch);
  check('musical bingo keeps its phone tickets in every state, kept or not', musicalPaper.length === 0, musicalPaper);
  world('SA', 'bingo90');
  var sa = await ask(VCODE); NOWMS += 1000; var sa2 = await ask(VCODE);
  check('CONTROL: an SA bingo lobby is on paper, and so is its kept answer', sa.body.paper_bingo === true && sa2.body.paper_bingo === true && sa2.cost === 0);

  print('a slow lookup cannot put an old answer back over a newer one');
  world('QLD', 'bingo90');
  var release = null, held1 = false, _f2 = fetch;
  fetch = function (url, opts) {   // the FIRST settings read waits until released; every other call is normal
    if (!held1 && String(url).indexOf('/rest/v1/vp_venue_settings') >= 0) { held1 = true; return new Promise(function (res) { release = function () { res(_f2(url, opts)); }; }); }
    return _f2(url, opts);
  };
  var slow = ask(VCODE);                       // a routine miss: reads the bingo lobby, then waits on settings
  for (var k0 = 0; k0 < 200; k0++) await Promise.resolve();
  NOWMS += 100; startTrivia();
  var quick = await ask(VCODE, { fresh: true });   // a pushed phone: reads trivia and keeps it
  release(); var slowR = await slow; fetch = _f2;
  var nowSays = await ask(VCODE);
  check('the slow one answers what it read (bingo), the pushed one trivia, and the room is then told trivia',
        slowR.body.format === 'bingo90' && quick.body.format === 'trivia' && nowSays.body.format === 'trivia' && nowSays.cost === 0,
        [slowR.body.format, quick.body.format, nowSays.body.format, nowSays.cost]);

  print('nothing is kept that should not be');
  world('QLD', 'bingo90');
  DOWN_TABLE = 'vp_sessions';
  var down = await ask(VCODE);
  DOWN_TABLE = null;
  var back = await ask(VCODE);
  check('a database fault is not kept: the next phone, a moment later, reads the database and is answered', down.status >= 500 && back.cost > 0 && back.body.channel === VCODE, [down.status, back.cost]);
  world('QLD', 'bingo90');
  DOWN_TABLE = 'vp_venues?id=eq';
  var noVenue = await ask(VCODE);
  DOWN_TABLE = null;
  var withVenue = await ask(VCODE);
  check('an answer built without the venue row (it fails open) is not kept either', noVenue.body.venue_name === '' && withVenue.cost > 0 && withVenue.body.venue_name === 'Test Pub', [noVenue.body.venue_name, withVenue.cost]);
  var u1 = await ask('ZZZZZZ'), u2 = await ask('ZZZZZZ');
  check('"no such code" is not kept: asked twice, read twice', u1.body.exists === false && u2.cost > 0, [u1.body.exists, u2.cost]);

  print('a kick and a pause are not on this road');
  world('QLD', 'trivia');
  var j = await call(handleJoin, { code: VCODE, pid: 'phone-kick-1', name: 'Kim' });
  var tok = j.body && j.body.token;
  await ask(VCODE);
  DB.vp_players.forEach(function (p) { if (p.device_id === 'phone-kick-1') p.kicked = true; });
  var alive = await call(handlePlayerAlive, {}, { 'X-Player-Token': tok });
  check('a kicked player is refused on their very next call, with the lobby answer kept', !!tok && alive.status === 403 && /removed/.test(alive.body.error || ''), [!!tok, alive.status, alive.body.error]);
  world('QLD', 'trivia');
  await ask(VCODE);
  DB.vp_venues[0].status = 'suspended';
  var jn = await call(handleJoin, { code: VCODE, pid: 'phone-pause-1', name: 'Pat' });
  check('a venue paused for billing refuses the next join at once, with the lobby answer kept', jn.status === 403 || jn.status === 404 || (jn.body && jn.body.error && !jn.body.token), [jn.status, jn.body && jn.body.error]);
  /* /join/info has never read the venue's status on a session's own code (the join and every other
     road that costs money do, above), so the copy may not change that answer either way: one routine
     poll later it says exactly what the database says. */
  NOWMS += 8000;
  var held = await ask(VCODE), heldDb = await ask(VCODE, { fresh: true });
  check('and its next routine poll says exactly what the database says, nothing kept past the window', held.cost > 0 && same(held.body, heldDb.body), [held.cost, held.body.format, heldDb.body.format]);

  print('the venue\'s own settings follow within half a minute');
  world('QLD', 'bingo90');
  var s0 = await ask(VCODE);
  DB.vp_venue_settings[0].collect_email = true;
  NOWMS += 34000;
  var s1 = await ask(VCODE);
  check('the owner turns on email: routine polls ask for it within 30 s plus the window', s0.body.collect.email === false && s1.body.collect.email === true, [s0.body.collect.email, s1.body.collect.email]);
  /* fresh:1 SKIPS THE 30 s COPY TOO (Dean, 31 Oct 2026): the join screen, a page just loaded and a
     console's message always act on the venue as it is now, not as it was up to half a minute ago. */
  world('QLD', 'bingo90');
  var v0 = await ask(VCODE);
  DB.vp_venue_settings[0].collect_email = true; DB.vp_venues[0].name = 'The Renamed Pub'; DB.vp_venues[0].au_state = 'SA';
  NOWMS += 5000;                                          // past the 4 s answer copy, well inside the 30 s venue copy
  var vRoutine = await ask(VCODE);
  var vFresh = await ask(VCODE, { fresh: true });
  var vAfter = await ask(VCODE);
  check('CONTROL: a routine poll inside the 30 s copy still has the venue as it was', vRoutine.body.collect.email === false && vRoutine.body.venue_name === 'Test Pub' && vRoutine.body.paper_bingo === false, vRoutine.body);
  check('the very next fresh:1 lookup sees the new settings, name, state and paper rule (SA bingo is on paper)',
        vFresh.body.collect.email === true && vFresh.body.venue_name === 'The Renamed Pub' && vFresh.body.paper_bingo === true && vFresh.body.paper_reason === 'state', vFresh.body);
  check('and it refreshes both copies: the room\'s next routine poll sees the same, at no cost', same(vAfter.body, vFresh.body) && vAfter.cost === 0, [vAfter.cost, vAfter.body.venue_name]);

  /* ======================= PART TWO: the trivia and musical watcher ======================= */
  print('\npart two: the real vp-follow.js, against the real Worker');
  var FOLLOW = readFile('venueplay/app/vp-follow.js');
  function follower(iso, room, mine) {
    var g = { went: null, timers: [], asks: [] };
    g.location = { replace: function (u) { g.went = u; } };
    g.fetch = function (url, o) {
      var body = JSON.parse(o.body); g.asks.push(body);
      return call(iso.handleJoinInfo, body).then(function (r) { return { ok: r.status === 200, json: function () { return Promise.resolve(r.body); } }; });
    };
    g.setTimeout = function (fn, ms) { g.timers.push({ at: NOWMS + ms, fn: fn }); return g.timers.length; };
    g.clearTimeout = function () {};
    g.encodeURIComponent = encodeURIComponent;
    (new Function('globalThis', 'window', 'location', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout', FOLLOW))
      (g, g, g.location, g.fetch, g.setTimeout, g.setTimeout, g.clearTimeout);
    g.VPFollow.start({ api: 'https://game.test', room: room, format: mine });
    return g;
  }
  async function runFollow(g, untilMs) {
    for (;;) {
      g.timers.sort(function (a, b) { return a.at - b.at; });
      var t = g.timers[0]; if (!t || t.at > untilMs || g.went) break;
      g.timers.shift(); NOWMS = t.at; t.fn();
      for (var k = 0; k < 400; k++) await Promise.resolve();
    }
  }
  /* THE BOUNCE. A phone in isolate B's room asked just before the host switched to trivia, so B
     holds "bingo" for a few seconds. Another isolate moved this phone to the trivia page; that
     page's watcher asks 2.5 s after loading, and the worst case is that B answers it. */
  world('QLD', 'bingo90');
  await ask(VCODE, { iso: ISO_B });                   // B keeps the bingo lobby
  NOWMS += 200; startTrivia();
  NOWMS += 300;
  var tp = follower(ISO_B, VCODE, 'trivia');
  await runFollow(tp, NOWMS + 2600);
  check('the trivia page\'s first look asks the database (fresh:1)', tp.asks.length === 1 && tp.asks[0].fresh === 1, tp.asks);
  check('so a phone just moved to trivia is NOT sent back to bingo by the other isolate\'s copy', tp.went === null, tp.went);
  await runFollow(tp, NOWMS + 20000);
  check('its later looks are routine (answered from the copy) and it stays in trivia', tp.asks.length >= 3 && tp.asks.slice(1).every(function (b) { return !b.fresh; }) && tp.went === null, { asks: tp.asks.length, went: tp.went });
  /* The night moves on: trivia ends and a bingo lobby opens. The watcher is polling routinely. */
  var ENDT = NOWMS + 1000;
  NOWMS = ENDT; DB.vp_games[0].status = 'finished'; DB.vp_sessions[0].lobby_format = 'bingo90';
  await runFollow(tp, ENDT + 60000);
  var hopT = NOWMS - ENDT;
  check('when trivia ends and bingo opens, the trivia phone is moved to bingo within one poll plus the window', tp.went === '/play?room=' + VCODE && hopT <= 8000 + 4000, { went: tp.went, afterMs: hopT });

  /* ===================== PART THREE: a host, a room of phones, the real pages ===================== */
  print('\npart three: the real bingo console and twelve real phones in a lobby, on the real Worker');
  CODE = VCODE;
  NOWMS += 60000; NOW = 0;
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: VCODE, au_state: 'QLD' }],
         vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [],
         vp_trivia_answers: [], vp_claims: [], vp_game_reports: [], vp_gaming_declarations: [] };
  var SESS = [], INFO = { asks: 0, cost: 0, fresh: 0 }, FORCE_FRESH = false, ASKS_BY = {};
  function openSession() {
    DB.vp_sessions.forEach(function (s) { if (s.status !== 'finished') s.status = 'finished'; });
    var id = 'cccccccc-cccc-4ccc-8ccc-' + ('000000000000' + (SESS.length + 1)).slice(-12);
    DB.vp_sessions.push({ id: id, venue_id: VENUE, status: 'lobby', join_code: VCODE, lobby_format: 'bingo90', plan_cap_at_start: 100,
                          overage_approved: false, created_at: new Date().toISOString(), state_version: 1 });
    SESS.push(id);
    return { status: 200, body: { session_id: id, join_code: VCODE, plan_cap: 100 } };
  }
  async function worker(path, body, who) {
    var q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q);
    var rq = req(body || {}); rq.url = 'https://game.test' + path;
    try {
      if (p === '/join/info') {
        if (who) (ASKS_BY[who] = ASKS_BY[who] || []).push(body.fresh ? 'fresh' : 'routine');
        if (FORCE_FRESH) body.fresh = 1;
        INFO.asks++; if (body.fresh) INFO.fresh++;
        var n0 = DBN, r = await handleJoinInfo(rq, ENV, json); INFO.cost += DBN - n0; return r;
      }
      if (p === '/join') return await handleJoin(rq, ENV, json);
      if (p === '/play/live') return await handlePlayLive(rq, ENV, json);
      if (p === '/player/alive') return await handlePlayerAlive(rq, ENV, json);
      if (p === '/session') return openSession();
      if (p === '/host/bingo/seat') return await handleBingoSeat(rq, ENV, json);
      if (p === '/snapshot') return await handleSnapshot(rq, ENV, json);
      return { status: 404, body: { error: 'not routed: ' + p } };
    } catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
  }
  function pageFetch(who) {
    return function (url, opts) {
      var path = String(url).replace(/^https?:\/\/[^\/]+/, ''), o = opts || {};
      var body = o.body ? JSON.parse(o.body) : {};
      return worker(path, body, who).then(function (r) { return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } }; });
    };
  }
  function bootHost3() {
    var dom = makeDom(''), sb = baseSandbox(dom, 'host');
    var ctx = { authed: true, scope: 'staff', role: 'owner', isAdmin: false, currentVenueId: VENUE, user: { user_metadata: { name: 'Dean' } },
                venue: { id: VENUE, slug: 'test-pub', name: 'Test Pub', status: 'active', max_players: 100, created_at: '2026-01-01T00:00:00Z' }, staff: [{ venue_id: VENUE }] };
    var VP = { useClient: function () {}, ready: function () { return Promise.resolve(ctx); }, refresh: function () { return Promise.resolve(ctx); }, suspensionBanner: function () {},
      venueCode: function () { return VCODE; }, venueJoinCode: function () { return Promise.resolve(null); },
      getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } }; },
      gameApiPost: function (path, body) { return worker(path, body).then(function (r) { return r.body; }); },
      gameApiCall: function (path, body) { return worker(path, body).then(function (r) { return { status: r.status, json: r.body }; }); },
      setGameActive: function () {}, enforceShift: function () {}, noteOpenSession: function () {}, closeOpenSessions: function () {}, listVenues: function () { return Promise.resolve([]); }, signOut: function () {},
      homeHref: function () { return 'index.html'; } };
    sb.VP = VP; dom.window.VP = VP;
    var HOLD = { busy: function () { return false; }, hold: function () {}, release: function () {} };
    sb.VP_HOLD = HOLD; dom.window.VP_HOLD = HOLD;
    sb.fetch = pageFetch();
    var ex = runPage(consoleScript(), sb, ['G', 'openLobby', 'startGame', 'onMsg']);
    ex.dom = dom; ex.sb = sb; ex.$ = function (id) { return dom.document.getElementById(id); };
    return ex;
  }
  function bootPhone3(name) {
    var dom = makeDom('?room=' + VCODE), sb = baseSandbox(dom, 'phone:' + name);
    sb.fetch = pageFetch(name);
    var ex = runPage(inlineScript('venueplay/play.html'), sb, ['P', 'onMsg', 'join', 'route']);
    ex.dom = dom; ex.name = name;
    return ex;
  }
  function triviaConsoleSays() { QUEUE.push({ name: 'vp-' + VCODE, from: null, payload: { t: 'mode', mode: 'trivia', title: 'Quiz night' } }); pump(); }
  async function hostOpensTrivia() {
    var r = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia' });
    return r.body && r.body.reused === true;
  }
  var host = bootHost3(); await advance(50);
  host.$('prizeInput').value = 'Meat tray'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(3000);
  check('the host opened a bingo lobby with the real console', SESS.length === 1 && DB.vp_sessions[0].status === 'lobby', SESS);
  var phones = [];
  for (var q = 0; q < 12; q++) { phones.push(bootPhone3('P' + q)); await advance(650); }
  await advance(10000);
  check('twelve real phone pages are in the lobby and asking /join/info', INFO.asks >= 12, INFO.asks);
  var shapes = phones.map(function (ph) { var a = ASKS_BY[ph.name] || []; return a.length >= 3 && a[0] === 'fresh' && a[1] === 'fresh' && a.slice(2).every(function (x) { return x === 'routine'; }); });
  check('each phone asks the database on loading (the join screen and its first lookup), and the copy after that',
        shapes.every(Boolean), phones.map(function (ph) { return (ASKS_BY[ph.name] || []).slice(0, 4).join(','); }));
  INFO = { asks: 0, cost: 0, fresh: 0 };
  await advance(120000);
  var NEWC = INFO;
  INFO = { asks: 0, cost: 0, fresh: 0 }; FORCE_FRESH = true;
  await advance(120000);
  var OLDC = INFO; FORCE_FRESH = false;
  print('       two minutes of twelve phones waiting: ' + NEWC.asks + ' polls, ' + NEWC.cost + ' database calls (' + OLDC.cost + ' when every poll reads the database, as before)');
  /* The live part is two calls, read at most once per four second window whatever the size of the
     room: 30 windows in two minutes is 60, plus a re-read of the venue row and settings every 30 s. */
  check('two minutes of a waiting lobby cost at most one live read per four seconds, however many phones', NEWC.asks >= 150 && NEWC.cost <= 2 * 30 + 2 * 4 && NEWC.cost * 5 <= OLDC.cost, { now: NEWC, before: OLDC });
  check('and the phones were polling routinely, not asking fresh', NEWC.fresh === 0, NEWC.fresh);
  var nobodyHopped = phones.every(function (ph) { return !ph.dom.window._replaced; });
  await advance(300);                                   // a phone has polled within the last 650 ms: the copy is warm
  var opened = await hostOpensTrivia(); triviaConsoleSays();
  await advance(1000);
  var moved = phones.filter(function (ph) { return ph.dom.window._replaced === '/app/trivia/play?room=' + VCODE; }).length;
  check('the host switches the night to trivia: every phone on the bingo page is moved within a second', opened && nobodyHopped && moved === 12, { opened: opened, moved: moved, sample: phones[0].dom.window._replaced });

  print('\npart three, again: the trivia console\'s message never reaches the phones');
  NOWMS += 60000;
  DB.vp_sessions.forEach(function (s) { s.status = 'finished'; });
  host.openLobby(); await advance(3000);
  var phones2 = [];
  for (var q2 = 0; q2 < 12; q2++) { phones2.push(bootPhone3('Q' + q2)); await advance(650); }
  await advance(30000);
  var t0 = NOW; await hostOpensTrivia();
  var latest = -1;
  for (var w = 0; w < 140; w++) {
    await advance(100);
    var all = phones2.every(function (ph) { return ph.dom.window._replaced === '/app/trivia/play?room=' + VCODE; });
    if (all) { latest = NOW - t0; break; }
  }
  check('with no message at all, every phone is still moved to trivia within one poll plus the window', latest >= 0 && latest <= 12000, latest + ' ms');

  print('\npart three, last: a phone moved back to bingo is not bounced to trivia by the copy');
  NOWMS += 60000;
  DB.vp_sessions.forEach(function (s) { s.status = 'finished'; });
  DB.vp_sessions.push({ id: S2, venue_id: VENUE, status: 'running', join_code: VCODE, lobby_format: 'trivia', plan_cap_at_start: 100, overage_approved: false, created_at: new Date().toISOString(), state_version: 1 });
  DB.vp_games.push({ id: 'g-triv-2', session_id: S2, seq: 1, format: 'trivia', status: 'running' });
  var warm = await ask(VCODE);                          // a trivia phone's routine look: the copy says trivia
  DB.vp_games.forEach(function (g) { if (g.id === 'g-triv-2') g.status = 'finished'; });
  DB.vp_sessions.forEach(function (s) { if (s.id === S2) s.lobby_format = 'bingo90'; });   // trivia over, bingo lobby open
  var back1 = bootPhone3('Returner');                    // vp-follow has just sent this phone to /play
  await advance(1500);
  check('a phone arriving on the bingo page a moment after trivia ended stays on bingo', warm.body.format === 'trivia' && !back1.dom.window._replaced, back1.dom.window._replaced);

  print('\n' + PASS + ' of ' + (PASS + FAILN) + ' checks passed');
  if (FAILN) throw new Error(FAILN + ' lobby poll cache checks failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
