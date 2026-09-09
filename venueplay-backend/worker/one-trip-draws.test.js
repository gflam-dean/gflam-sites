/* CALLING A BALL, AND DRAWING A MEMBER, IN ONE DATABASE TRIP: THE FAST PATH MUST
   ANSWER EXACTLY WHAT THE SLOW ONE DID.

   Measured from Dean's machine on 10 Sep 2026, three samples each: a Cloudflare-only
   call (room presence) answers in 0.09 s, a single Supabase read through the same
   Worker takes 0.84 s, because the live database is in Singapore and the Worker runs
   at an Australian edge. Calling a ball made six of those reads one after another, so
   the host waited two to three seconds while the room got the ball in a tenth of a
   second. Migration 76 collapses both host routes to one call each.

   The danger in that is not slowness, it is a check quietly going missing on the new
   path. So this suite runs BOTH paths over the SAME scripted database and demands the
   same reply, byte for byte, for every scene that matters: a normal ball, a ball on a
   finished game, a ball called by someone who is not staff at that venue, the last
   ball in the pool and the one after it, the double-tap hold, a paused venue, and the
   whole members draw including the pending winner migration 74 added.

   The fast path is answered by a JS model of the SQL in migration 76, translated from
   that file line by line; the SQL text itself is then read for the clauses that carry
   the meaning, because a model can only ever be a model. The slow path runs the real
   lifted Worker code, requireStaff and all, against the same fake database.

   Run: jsc venueplay-backend/worker/one-trip-draws.test.js */

function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var W = find('venueplay-backend/worker/venueplay-game.js');
var SQL = find('venueplay-backend/supabase/venueplay-76-one-trip-host-draws.sql');

var EXPECT = 81, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(n) {
  var i = W.indexOf('async function ' + n + '('); if (i < 0) i = W.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = W.indexOf('{', i);
  do { if (W[k] === '{') d++; else if (W[k] === '}') d--; k++; } while (d > 0 && k < W.length);
  return W.slice(i, k) + '\n';
}

/* =====================================================================
   A fake Worker world and a fake database
   ===================================================================== */
var enc = encodeURIComponent;
var NOW = new Date('2026-09-10T09:30:00.000Z').getTime();   // a fixed clock, so every timestamp is comparable
var DB = {}, TRIPS = [], RPC_CALLS = [];
var HOST = '11111111-1111-4111-8111-111111111111';
var VENUE = '22222222-2222-4222-8222-222222222222';
var OTHER = '33333333-3333-4333-8333-333333333333';
var DRAWID = '44444444-4444-4444-8444-444444444444';
var MDRAW = '55555555-5555-4555-8555-555555555555';
var ROSTER = '66666666-6666-4666-8666-666666666666';

/* The whole suite runs at one moment. new Date() as well as Date.now(), because the slow
   path stamps last_drawn_at with the constructor and the fast path stamps it from the
   database clock: left real, the two would differ for a reason that is not the code. */
var _Date = Date;
function FakeDate(v) { return arguments.length ? new _Date(v) : new _Date(NOW); }
FakeDate.now = function () { return NOW; };
FakeDate.prototype = _Date.prototype;
Date = FakeDate;
function json(o, status) { return { status: status || 200, body: o }; }
function assertUuid(v, what) { if (!/^[0-9a-f-]{36}$/.test(String(v))) throw httpError(400, 'Bad ' + what); }
var BODY = {};
async function readJson() { return BODY; }
async function verifyHostJwt() { return HOST; }
function sbHeaders() { return {}; }
function dbError(kind, fn, detail) { return new Error('db ' + kind + ' ' + fn + ': ' + detail); }
var console = { log: function () {}, warn: function () {} };
/* One constant value out of the CSPRNG, so the two paths cannot disagree about the
   winner for a reason that has nothing to do with the code under test. randInt takes
   7 % n; the function takes the first supplied value under the rejection limit, which
   is also 7, and 7 % n. Fairness itself is rng-evidence.test.js's job. */
globalThis.crypto = { getRandomValues: function (b) { for (var i = 0; i < b.length; i++) b[i] = 7; return b; } };

function rows(table, query) {
  var out = (DB[table] || []).slice();
  query.split('&').forEach(function (part) {
    var i = part.indexOf('=');
    var k = part.slice(0, i), v = part.slice(i + 1);
    if (k === 'select' || k === 'limit' || k === 'order') return;
    if (v.indexOf('eq.') === 0) {
      var val = decodeURIComponent(v.slice(3));
      out = out.filter(function (r) { return String(r[k]) === val; });
    } else if (v.indexOf('in.(') === 0) {
      var list = v.slice(4, -1).split(',').map(function (s) { return decodeURIComponent(s); });
      out = out.filter(function (r) { return list.indexOf(String(r[k])) >= 0; });
    } else {
      throw new Error('the fake database cannot answer "' + part + '" - a test that cannot ask cannot fail');
    }
  });
  var ord = /(?:^|&)order=([a-z_]+)\.(asc|desc)/.exec(query);
  if (ord) out.sort(function (a, b) {
    var x = a[ord[1]], y = b[ord[1]];
    if (x === y) return 0;
    return (x > y ? 1 : -1) * (ord[2] === 'desc' ? -1 : 1);
  });
  var lim = /(?:^|&)limit=(\d+)/.exec(query);
  if (lim) out = out.slice(0, +lim[1]);
  return out;
}
async function sbGet(env, table, query) { TRIPS.push('GET ' + table); return rows(table, query); }
async function sbPatch(env, table, query, obj) {
  TRIPS.push('PATCH ' + table);
  rows(table, query).forEach(function (r) { Object.keys(obj).forEach(function (k) { r[k] = obj[k]; }); });
}
async function sbInsert(env, table, obj, ret) {
  TRIPS.push('INSERT ' + table);
  DB[table] = DB[table] || [];
  if (table === 'vp_bingo_draw_balls' &&
      DB[table].some(function (r) { return r.draw_id === obj.draw_id && (r.number === obj.number || r.ordinal === obj.ordinal); })) {
    var e = new Error('duplicate'); e.status = 409; throw e;
  }
  if (table === 'vp_member_draw_results' && !obj.drawn_at) obj.drawn_at = new Date(NOW).toISOString();
  if (!obj.id) obj.id = table + '-' + DB[table].length;
  DB[table].push(obj);
  return ret ? [obj] : null;
}
// Migration 70's function, the same fake bingo-server-draw.test.js uses.
async function sbRpc(env, fn, args) {
  TRIPS.push('RPC ' + fn);
  if (fn !== 'vp_bingo_next_ball') throw new Error('unknown rpc ' + fn);
  return nextBall(args.p_draw);
}
function nextBall(drawId) {
  var d = (DB.vp_bingo_draws || []).filter(function (r) { return r.id === drawId; })[0];
  if (!d || d.draw_index >= d.draw_order.length) return [];
  d.draw_index++;
  var num = d.draw_order[d.draw_index - 1];
  DB.vp_bingo_draw_balls = DB.vp_bingo_draw_balls || [];
  DB.vp_bingo_draw_balls.push({ draw_id: d.id, ordinal: d.draw_index, number: num, source: 'server',
                                drawn_at: new Date(NOW).toISOString() });
  return [{ number: num, new_index: d.draw_index }];
}

/* =====================================================================
   The fast path: a model of migration 76, translated from the SQL
   ===================================================================== */
var RPC_PRESENT = true;      // false = PostgREST answers 404, which is "migration not run"

// vp_host_staff, from migration 73.
function vpHostStaff(auth, venueId) {
  var staff = (DB.vp_venue_staff || []).filter(function (r) { return r.auth_user_id === auth && r.venue_id === venueId; })[0];
  if (!staff) {
    var admin = (DB.vp_platform_admins || []).filter(function (r) {
      return r.auth_user_id === auth && (r.role === 'owner' || r.role === 'accounts');
    })[0];
    if (!admin) return { status: 'not_staff' };
  }
  var venue = (DB.vp_venues || []).filter(function (r) { return r.id === venueId; })[0];
  if (!venue) return { status: 'venue_missing' };
  if (venue.status !== 'active') return { status: 'venue_paused' };
  if (venue.group_id) {
    var g = (DB.vp_venue_groups || []).filter(function (r) { return r.id === venue.group_id; })[0];
    if (g && g.status !== 'active') return { status: 'venue_paused' };
  }
  return { status: 'ok' };
}

// vp_bingo_ball
function vpBingoBall(a) {
  var d = (DB.vp_bingo_draws || []).filter(function (r) { return r.id === a.p_draw_id; })[0];
  if (!d) return { status: 'no_draw' };
  var who = vpHostStaff(a.p_auth_user_id, d.venue_id);
  if (who.status !== 'ok') return { status: who.status };
  if (d.finished_at) return { status: 'finished' };
  if (d.mode === 'local') return { status: 'local_mode' };
  if (d.draw_index > 0 && a.p_hold_ms > 0) {
    var last = (DB.vp_bingo_draw_balls || []).filter(function (r) { return r.draw_id === a.p_draw_id; })
      .sort(function (x, y) { return y.ordinal - x.ordinal; })[0];
    if (last && last.drawn_at) {
      var since = NOW - new Date(last.drawn_at).getTime();
      if (since >= 0 && since < a.p_hold_ms) {
        return { status: 'hold', wait_seconds: Math.ceil((a.p_hold_ms - since) / 1000) };
      }
    }
  }
  var b = nextBall(a.p_draw_id);
  if (!b.length || b[0].number == null) return { status: 'all_drawn' };
  return { status: 'ok', number: b[0].number, index: b[0].new_index };
}

// vp_member_name
function vpMemberName(first, last, mode) {
  var f = String(first == null ? '' : first).trim();
  var l = String(last == null ? '' : last).trim();
  if (l === '' && /\s/.test(f)) {
    var parts = f.split(/\s+/);
    l = parts[parts.length - 1];
    f = parts.slice(0, parts.length - 1).join(' ');
  }
  if (mode === 'full') return (f + ' ' + l).trim();
  if (mode === 'abbrev_first') return ((f !== '' ? f[0] + ' ' : '') + l).trim();
  return (f + ' ' + (l !== '' ? l[0] : '')).trim();
}

// vp_members_draw
function vpMembersDraw(a) {
  var d = (DB.vp_member_draws || []).filter(function (r) { return r.id === a.p_draw_id; })[0];
  if (!d) return { status: 'no_draw' };
  var who = vpHostStaff(a.p_auth_user_id, d.venue_id);
  if (who.status !== 'ok') return { status: who.status };

  var spin = d.draw_length_seconds == null ? a.p_hold_default : d.draw_length_seconds;
  if (spin < 0) spin = a.p_hold_default;
  spin = Math.max(a.p_hold_lo, Math.min(a.p_hold_hi, spin));
  var hold = (spin + 2) * 1000;
  if (d.last_drawn_at) {
    var since = NOW - new Date(d.last_drawn_at).getTime();
    if (since >= 0 && since < hold) return { status: 'hold', wait_seconds: Math.ceil((hold - since) / 1000) };
  }

  var pending = (DB.vp_member_draw_results || [])
    .filter(function (r) { return r.draw_id === a.p_draw_id && r.outcome === 'drawn'; })
    .sort(function (x, y) { return x.drawn_at < y.drawn_at ? 1 : -1; })[0];
  if (pending && pending.drawn_at && (NOW - new Date(pending.drawn_at).getTime()) < 30 * 60 * 1000) {
    return {
      status: 'pending', draw_name: d.name,
      member_id: pending.member_id, member_number: pending.member_number,
      winner_name: pending.winner_name,
      jackpot_cents: pending.amount_cents != null ? pending.amount_cents
                    : (d.current_jackpot_cents != null ? d.current_jackpot_cents : 0),
      time_to_claim_seconds: d.time_to_claim_seconds,
      draw_length_seconds: d.draw_length_seconds,
    };
  }

  var rosterIds = d.roster_id ? [d.roster_id]
    : (DB.vp_member_rosters || []).filter(function (r) { return r.venue_id === d.venue_id; }).map(function (r) { return r.id; });
  var pool = (DB.vp_members || []).filter(function (m) {
    return m.status === 'valid' && rosterIds.indexOf(m.roster_id) >= 0;
  }).sort(function (x, y) { return x.id < y.id ? -1 : 1; });
  if (!pool.length) return { status: 'no_members' };

  var limit = Math.floor(4294967296 / pool.length) * pool.length;
  var pick = -1;
  for (var i = 0; i < (a.p_rand || []).length; i++) {
    var x = a.p_rand[i];
    if (x != null && x >= 0 && x < limit) { pick = x % pool.length; break; }
  }
  if (pick < 0) return { status: 'retry' };
  var win = pool[pick];

  var s = (DB.vp_venue_settings || []).filter(function (r) { return r.venue_id === d.venue_id; })[0];
  var mode = (s && s.name_display) ? s.name_display : 'abbrev_last';
  var name = vpMemberName(win.first_name, win.last_name, mode);
  var amount = d.current_jackpot_cents != null ? d.current_jackpot_cents : 0;

  d.last_drawn_date = new Date(NOW).toISOString().slice(0, 10);
  d.last_drawn_at = new Date(NOW).toISOString();
  DB.vp_member_draw_results = DB.vp_member_draw_results || [];
  DB.vp_member_draw_results.push({
    id: 'sql-' + DB.vp_member_draw_results.length, draw_id: a.p_draw_id, outcome: 'drawn',
    amount_cents: amount, member_id: win.id, member_number: win.member_number,
    winner_name: name, drawn_at: new Date(NOW).toISOString(),
  });

  return {
    status: 'ok', draw_name: d.name, member_id: win.id, member_number: win.member_number,
    first_name: win.first_name, last_name: win.last_name, winner_name: name, name_display: mode,
    jackpot_cents: amount, time_to_claim_seconds: d.time_to_claim_seconds,
    draw_length_seconds: d.draw_length_seconds, valid_count: pool.length,
  };
}

// The scripted PostgREST the Worker talks to.
function fetch(url, opts) {
  var fn = String(url).split('/rpc/')[1];
  var args = JSON.parse(opts.body);
  RPC_CALLS.push({ fn: fn, args: args });
  if (!RPC_PRESENT) {
    return Promise.resolve({ status: 404, ok: false,
      json: function () { return Promise.resolve(null); }, text: function () { return Promise.resolve(''); } });
  }
  TRIPS.push('RPC ' + fn);
  var body = fn === 'vp_bingo_ball' ? vpBingoBall(args)
           : fn === 'vp_members_draw' ? vpMembersDraw(args)
           : null;
  if (!body) throw new Error('the fake database does not know ' + fn);
  return Promise.resolve({ status: 200, ok: true,
    json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(''); } });
}

/* =====================================================================
   The real Worker code
   ===================================================================== */
function httpError(status, message) { var e = new Error(message); e.status = status; return e; }
eval(lift('randInt'));
eval(lift('drawHoldMs'));
eval(lift('formatMemberName'));
eval(lift('validMembers'));
eval(lift('venueNameDisplay'));
eval(lift('assertVenueActive'));
eval(lift('requireStaff'));
eval('var HOST_DRAW_STATUS = ' + /const HOST_DRAW_STATUS = (\{[\s\S]*?\n\});/.exec(W)[1] + ';');
eval('var hostDrawRpcMissing = false;');
eval(lift('hostDrawRpc'));
eval(lift('handleBingoBall'));
eval(lift('handleBingoBallManyTrips'));
eval(lift('handleMembersDraw'));
eval(lift('handleMembersDrawManyTrips'));
eval('var BINGO_SERVER_HOLD_MS = ' + /const BINGO_SERVER_HOLD_MS = (\d+)/.exec(W)[1] + ';');
var ENV = { SUPABASE_URL: 'https://db' };

/* The router's own catch, so a thrown httpError becomes the reply the console sees.
   Without this the slow path would "fail" where the real Worker answers 403. */
async function route(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.status) return json({ error: String(e.message) }, e.status);
    return json({ error: 'Something went wrong' }, 500);
  }
}

/* =====================================================================
   The scripted database, rebuilt fresh for every scene
   ===================================================================== */
function order90() { var a = []; for (var i = 90; i >= 1; i--) a.push(i); return a; }   // fixed, not shuffled: this suite is not about the shuffle
function base(opts) {
  opts = opts || {};
  TRIPS = []; RPC_CALLS = [];
  DB = {
    vp_venue_staff: [{ id: 'staff-1', auth_user_id: HOST, venue_id: VENUE, role: 'host', permissions: null }],
    vp_platform_admins: [],
    vp_venues: [{ id: VENUE, status: opts.venueStatus || 'active', group_id: opts.grouped ? 'group-1' : null },
                { id: OTHER, status: 'active', group_id: null }],
    vp_venue_groups: [{ id: 'group-1', status: 'active' }],
    vp_bingo_draws: [{ id: DRAWID, venue_id: opts.ballVenue || VENUE, draw_index: opts.drawIndex || 0,
                       draw_order: order90(), mode: opts.mode || 'server', finished_at: opts.finishedAt || null }],
    vp_bingo_draw_balls: [],
    vp_member_draws: [{ id: MDRAW, venue_id: opts.drawVenue || VENUE, roster_id: ROSTER, name: 'Members draw',
                        current_jackpot_cents: 125000, starting_amount_cents: 50000, increment_cents: 10000,
                        draw_length_seconds: 6, time_to_claim_seconds: 180,
                        last_drawn_at: opts.lastDrawnAt || null, last_drawn_date: null }],
    // copied, never shared: the first run writes rows, and the second must start where
    // the first did. Sharing the array once made a stale row look like a fresh winner.
    vp_member_draw_results: (opts.results || []).map(function (r) { return JSON.parse(JSON.stringify(r)); }),
    vp_member_rosters: [{ id: ROSTER, venue_id: VENUE }],
    vp_members: opts.noMembers ? [] : [
      { id: 'm-01', roster_id: ROSTER, member_number: '101', first_name: 'Ada',   last_name: 'Lovelace', status: 'valid' },
      { id: 'm-02', roster_id: ROSTER, member_number: '102', first_name: 'Bruce', last_name: 'Ng',       status: 'valid' },
      { id: 'm-03', roster_id: ROSTER, member_number: '103', first_name: 'Cath',  last_name: 'Oh',       status: 'valid' },
      { id: 'm-04', roster_id: ROSTER, member_number: '104', first_name: 'Dan',   last_name: 'Pope',     status: 'valid' },
      { id: 'm-05', roster_id: ROSTER, member_number: '105', first_name: 'Eve',   last_name: 'Quinn',    status: 'valid' },
      { id: 'm-06', roster_id: ROSTER, member_number: '106', first_name: 'Finn',  last_name: 'Rose',     status: 'valid' },
      { id: 'm-07', roster_id: ROSTER, member_number: '107', first_name: 'Gus',   last_name: 'Stone',    status: 'valid' },
      { id: 'm-08', roster_id: ROSTER, member_number: '108', first_name: 'Hal',   last_name: 'Tan',      status: 'lapsed' },
    ],
    vp_venue_settings: [{ venue_id: VENUE, name_display: opts.nameDisplay || 'abbrev_last' }],
  };
  // balls already called, for the scenes that need a part-played game
  for (var i = 1; i <= (opts.drawIndex || 0); i++) {
    DB.vp_bingo_draw_balls.push({ draw_id: DRAWID, ordinal: i, number: DB.vp_bingo_draws[0].draw_order[i - 1],
                                  source: 'server', drawn_at: new Date(NOW - (opts.ballAgeMs == null ? 60000 : opts.ballAgeMs)).toISOString() });
  }
}
function snapshot() {
  return JSON.stringify({
    draw_index: DB.vp_bingo_draws[0].draw_index,
    balls: (DB.vp_bingo_draw_balls || []).map(function (b) { return b.ordinal + ':' + b.number + ':' + b.source; }),
    stamp: [DB.vp_member_draws[0].last_drawn_date, DB.vp_member_draws[0].last_drawn_at],
    results: (DB.vp_member_draw_results || []).map(function (r) {
      return [r.draw_id, r.outcome, r.amount_cents, r.member_id, r.member_number, r.winner_name].join('|');
    }),
  });
}

/* Run one scene down BOTH paths, from the same starting state, and demand the same
   reply and the same marks left on the database. Returns the trip counts. */
async function both(name, opts, body, note) {
  BODY = body;
  base(opts); RPC_PRESENT = true; hostDrawRpcMissing = false;
  var fast = await route(function () { return opts.members ? handleMembersDraw({}, ENV, json) : handleBingoBall({}, ENV, json); });
  var fastTrips = TRIPS.slice(), fastDb = snapshot();

  base(opts); RPC_PRESENT = false; hostDrawRpcMissing = false;
  var slow = await route(function () { return opts.members ? handleMembersDraw({}, ENV, json) : handleBingoBall({}, ENV, json); });
  var slowTrips = TRIPS.slice(), slowDb = snapshot();

  var same = JSON.stringify(fast) === JSON.stringify(slow);
  ok(name + ': the same reply either way', same,
     '\n      one trip: ' + JSON.stringify(fast) + '\n      many:     ' + JSON.stringify(slow));
  ok(name + ': the same marks left on the database', fastDb === slowDb,
     '\n      one trip: ' + fastDb + '\n      many:     ' + slowDb);
  if (note !== false) {
    print('       trips: 1 (' + fastTrips.filter(function (t) { return t.indexOf('RPC') === 0; }).length +
          ' call) against ' + slowTrips.length + '   [' + slowTrips.join(', ') + ']');
  }
  return { fast: fast, slow: slow, fastTrips: fastTrips, slowTrips: slowTrips };
}

/* =====================================================================
   The scenes
   ===================================================================== */
(async function () {
  print('== a normal ball ==');
  var r = await both('a normal ball', {}, { draw_id: DRAWID });
  ok('the host gets a number and its index', r.fast.status === 200 && r.fast.body.number === 90 && r.fast.body.index === 1,
     JSON.stringify(r.fast));
  ok('it costs ONE call now, and cost four before', r.fastTrips.length === 1 && r.slowTrips.length === 4,
     'one trip: ' + r.fastTrips.join(', ') + ' | many: ' + r.slowTrips.join(', '));
  ok('and the ball is on the record either way', DB.vp_bingo_draw_balls.length === 1 && DB.vp_bingo_draw_balls[0].source === 'server');

  /* The shape a real venue is in mid game: part way through, and owned by a group, which
     is one more read again. This is the six the host was waiting on. */
  print('\n== mid game, at a venue that belongs to a group ==');
  r = await both('a ball mid game at a group venue', { drawIndex: 30, grouped: true }, { draw_id: DRAWID });
  ok('the ball comes out', r.fast.status === 200 && r.fast.body.index === 31, JSON.stringify(r.fast));
  ok('and this is the six trips the host was waiting on, now one', r.fastTrips.length === 1 && r.slowTrips.length === 6,
     'one trip: ' + r.fastTrips.join(', ') + ' | many: ' + r.slowTrips.join(', '));

  print('\n== the game has finished ==');
  r = await both('a finished game', { finishedAt: '2026-09-10T09:00:00.000Z' }, { draw_id: DRAWID });
  ok('refused with 409, in the same words', r.fast.status === 409 && r.fast.body.error === 'This game is finished', JSON.stringify(r.fast));
  ok('and no ball was drawn', DB.vp_bingo_draws[0].draw_index === 0 && DB.vp_bingo_draw_balls.length === 0);

  print('\n== a venue the host does not work at ==');
  r = await both('someone else\'s venue', { ballVenue: OTHER }, { draw_id: DRAWID });
  ok('refused with 403', r.fast.status === 403, JSON.stringify(r.fast));
  ok('and told plainly why', /not staff at this venue/.test(r.fast.body.error || ''));
  ok('the authorisation check is done INSIDE the one-trip function, not skipped',
     /v_who := public\.vp_host_staff\(p_auth_user_id, v_draw\.venue_id\);/.test(SQL) &&
     (SQL.match(/vp_host_staff\(p_auth_user_id/g) || []).length === 2,
     'both functions must call it, against the DRAW\'s venue');
  ok('and no ball was drawn for them', DB.vp_bingo_draws[0].draw_index === 0);

  print('\n== the last ball in the pool, and the one after it ==');
  r = await both('the 90th ball', { drawIndex: 89 }, { draw_id: DRAWID });
  ok('the last ball comes out with index 90', r.fast.status === 200 && r.fast.body.index === 90, JSON.stringify(r.fast));
  ok('and it is the last number of the stored order', r.fast.body.number === 1);
  r = await both('the 91st request', { drawIndex: 90 }, { draw_id: DRAWID });
  ok('refused with 409, in the same words', r.fast.status === 409 && r.fast.body.error === 'All 90 balls have been drawn', JSON.stringify(r.fast));

  print('\n== the double-tap hold ==');
  r = await both('a second tap inside the hold', { drawIndex: 1, ballAgeMs: 1000 }, { draw_id: DRAWID });
  ok('refused with 429', r.fast.status === 429, JSON.stringify(r.fast));
  ok('and told how long to wait, in words, the same either way', /call again in 3 seconds/.test(r.fast.body.error || ''), r.fast.body.error);
  ok('nothing was drawn', DB.vp_bingo_draws[0].draw_index === 1);

  print('\n== the tablet has taken over, and a paused venue ==');
  r = await both('local mode', { mode: 'local' }, { draw_id: DRAWID });
  ok('refused with 409, the tablet is calling', r.fast.status === 409 && /called from the tablet/.test(r.fast.body.error || ''), JSON.stringify(r.fast));
  r = await both('a paused venue', { venueStatus: 'paused' }, { draw_id: DRAWID });
  ok('refused with 403, in the room\'s words', r.fast.status === 403 && /Games are paused here tonight/.test(r.fast.body.error || ''), JSON.stringify(r.fast));

  print('\n== a draw that does not exist ==');
  r = await both('no such draw', { ballVenue: VENUE }, { draw_id: '99999999-9999-4999-8999-999999999999' });
  ok('404, Draw not found', r.fast.status === 404 && r.fast.body.error === 'Draw not found', JSON.stringify(r.fast));

  print('\n== the members draw ==');
  r = await both('a normal members draw', { members: true }, { draw_id: MDRAW });
  ok('a member is named, with the venue\'s name format', r.fast.status === 200 && r.fast.body.winner_name === 'Ada L',
     JSON.stringify(r.fast.body));
  ok('the lapsed member was never in the pool', r.fast.body.valid_count === 7);
  ok('it costs ONE call now, and cost nine before', r.fastTrips.length === 1 && r.slowTrips.length === 9,
     'one trip: ' + r.fastTrips.join(', ') + ' | many: ' + r.slowTrips.join(', '));
  ok('the unresolved record is written either way (migration 74)',
     DB.vp_member_draw_results.length === 1 && DB.vp_member_draw_results[0].outcome === 'drawn' &&
     DB.vp_member_draw_results[0].amount_cents === 125000);
  ok('and the stamp is written, so a second tap is held', !!DB.vp_member_draws[0].last_drawn_at && !!DB.vp_member_draws[0].last_drawn_date);

  print('\n== the winner of a draw that was lost on bad wifi ==');
  var earlier = { id: 'r-1', draw_id: MDRAW, outcome: 'drawn', amount_cents: 125000, member_id: 'm-04',
                  member_number: '104', winner_name: 'Dan P', drawn_at: new Date(NOW - 5 * 60000).toISOString() };
  r = await both('the pending winner', { members: true, results: [earlier] }, { draw_id: MDRAW });
  ok('the SAME member comes back, not a second one', r.fast.status === 200 && r.fast.body.member_id === 'm-04' &&
     r.fast.body.winner_name === 'Dan P' && r.fast.body.pending === true, JSON.stringify(r.fast.body));
  ok('and no second record was written', DB.vp_member_draw_results.length === 1);
  var stale = { id: 'r-1', draw_id: MDRAW, outcome: 'drawn', amount_cents: 125000, member_id: 'm-04',
                member_number: '104', winner_name: 'Dan P', drawn_at: new Date(NOW - 45 * 60000).toISOString() };
  r = await both('an hour-old unresolved row', { members: true, results: [stale] }, { draw_id: MDRAW });
  ok('is too old to hand back: a fresh member is drawn', r.fast.status === 200 && !r.fast.body.pending && r.fast.body.member_id === 'm-01',
     JSON.stringify(r.fast.body));

  print('\n== the members draw refuses the same things ==');
  r = await both('a draw at another venue', { members: true, drawVenue: OTHER }, { draw_id: MDRAW });
  ok('403, not staff there', r.fast.status === 403 && /not staff at this venue/.test(r.fast.body.error || ''), JSON.stringify(r.fast));
  r = await both('an empty members list', { members: true, noMembers: true }, { draw_id: MDRAW });
  ok('409, nobody to draw from', r.fast.status === 409 && r.fast.body.error === 'No valid members to draw from', JSON.stringify(r.fast));
  r = await both('a second draw while the wheel is still spinning', { members: true, lastDrawnAt: new Date(NOW - 1000).toISOString() }, { draw_id: MDRAW });
  ok('429, and the same wait in seconds', r.fast.status === 429 && /draw again in 7 seconds/.test(r.fast.body.error || ''), r.fast.body.error);
  r = await both('a draw that does not exist', { members: true }, { draw_id: '99999999-9999-4999-8999-999999999999' });
  ok('404, Draw not found', r.fast.status === 404 && r.fast.body.error === 'Draw not found', JSON.stringify(r.fast));

  print('\n== the name the room sees ==');
  base({ members: true, nameDisplay: 'full' }); RPC_PRESENT = true; hostDrawRpcMissing = false;
  BODY = { draw_id: MDRAW };
  var full = await route(function () { return handleMembersDraw({}, ENV, json); });
  ok('the venue\'s "full name" setting is honoured on the one-trip path', full.body.winner_name === 'Ada Lovelace', JSON.stringify(full.body));
  base({ members: true, nameDisplay: 'abbrev_first' }); RPC_PRESENT = true; hostDrawRpcMissing = false;
  var af = await route(function () { return handleMembersDraw({}, ENV, json); });
  ok('and "J Smith" too', af.body.winner_name === 'A Lovelace', JSON.stringify(af.body));
  /* The SQL keeps its own copy of the name rule, because it writes the record itself. This
     is the one place the two paths could drift, so the port is checked case by case against
     the Worker's formatMemberName, including the split it does for a name imported whole. */
  var cases = [
    ['Ada', 'Lovelace', 'abbrev_last'], ['Ada', 'Lovelace', 'abbrev_first'], ['Ada', 'Lovelace', 'full'],
    ['John Smith', '', 'abbrev_last'], ['John Smith', '', 'abbrev_first'], ['John Smith', '', 'full'],
    ['Mary Jane Watson', null, 'abbrev_last'], ['  Ada  ', ' Lovelace ', 'abbrev_last'],
    ['Ada', '', 'abbrev_last'], ['', 'Lovelace', 'abbrev_first'], ['', '', 'full'],
    [null, null, 'abbrev_last'], ['Ada', 'Lovelace', 'something-else'],
  ];
  var drift = cases.filter(function (c) { return formatMemberName(c[0], c[1], c[2]) !== vpMemberName(c[0], c[1], c[2]); });
  ok('the SQL name rule and the Worker\'s agree on every case', drift.length === 0,
     JSON.stringify(drift.map(function (c) { return c.join('/') + ' -> ' + formatMemberName(c[0], c[1], c[2]) + ' vs ' + vpMemberName(c[0], c[1], c[2]); })));

  print('\n== the paste order cannot break a night ==');
  base({}); RPC_PRESENT = false; hostDrawRpcMissing = false; BODY = { draw_id: DRAWID };
  var a1 = await route(function () { return handleBingoBall({}, ENV, json); });
  var asked = RPC_CALLS.length;
  NOW += 10000;
  var a2 = await route(function () { return handleBingoBall({}, ENV, json); });
  NOW -= 10000;
  ok('a Worker in front of its migration still calls the night', a1.status === 200 && a2.status === 200);
  ok('and stops asking for the function after the first 404', asked === 1 && RPC_CALLS.length === 1, 'asked ' + RPC_CALLS.length + ' times');

  print('\n== the migration itself ==');
  ok('service role only, on both functions',
     /revoke all on function public\.vp_bingo_ball\(uuid, uuid, int\) from public, anon, authenticated;/.test(SQL) &&
     /grant execute on function public\.vp_bingo_ball\(uuid, uuid, int\) to service_role;/.test(SQL) &&
     /revoke all on function public\.vp_members_draw\(uuid, uuid, bigint\[\], int, int, int\) from public, anon, authenticated;/.test(SQL) &&
     /grant execute on function public\.vp_members_draw\(uuid, uuid, bigint\[\], int, int, int\) to service_role;/.test(SQL));
  ok('both are security definer, and pinned to the public search path',
     (SQL.match(/security definer/g) || []).length === 2 && (SQL.match(/set search_path = public/g) || []).length === 3);
  ok('it is safe to run twice', (SQL.match(/create or replace function/g) || []).length === 3 &&
     SQL.indexOf('create table') < 0 && SQL.indexOf('drop function') < 0);
  ok('it refuses to install without migration 73, rather than failing at the first ball',
     /to_regprocedure\('public\.vp_host_staff\(uuid,uuid\)'\) is null/.test(SQL) && /raise exception/.test(SQL));
  ok('the ball order has NOT moved: the same vp_bingo_next_ball still picks it',
     /public\.vp_bingo_next_ball\(p_draw_id\)/.test(SQL) && SQL.indexOf('random()') < 0 && SQL.indexOf('order by random') < 0,
     'OLGR RNG v1.5: the pick stays where it was audited');
  ok('the members pick still uses the values the WORKER minted, under the same rejection rule',
     /v_limit := \(4294967296::bigint \/ v_count\) \* v_count;/.test(SQL) &&
     /v_x < v_limit/.test(SQL) && /v_x % v_count/.test(SQL));
  ok('and the Worker mints them with crypto.getRandomValues, not Math.random',
     /crypto\.getRandomValues\(buf\)/.test(lift('handleMembersDraw')) && lift('handleMembersDraw').indexOf('Math.random') < 0);
  ok('the one-trip path is only reached when PostgREST does not answer 404',
     /if \(res\.status === 404\) \{[\s\S]{0,200}hostDrawRpcMissing = true;/.test(lift('hostDrawRpc')));
  ok('an unexpected status word is an error, never a silent success',
     /if \(!reply\) throw dbError\('rpc', fn, 'unexpected status ' \+ status\);/.test(lift('hostDrawRpc')));
  ok('/health reports whether the two functions landed',
     /'vp_bingo_ball', 'vp_members_draw'/.test(W));

  print('');
  if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
  if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + EXPECT + ' CHECKS PASSED');
})();
