/* THE BINGO BALL ORDER LIVES ON THE SERVER, AND THE NIGHT NEVER WAITS FOR IT.

   Until 8 Sep 2026 the bingo console picked every ball on the host's tablet. Fair,
   but not provable: nothing recorded a pick until the same tablet wrote the end-of
   game report. OLGR's RNG standard (v1.5) wants the generator's state kept out of
   reach (4.2.2), so the whole order of 1..90 is now shuffled inside the Worker,
   stored in vp_bingo_draws, and handed out one ball at a time. Migration 70.

   Two things have to be true at once, and this suite holds both:

     1. The order is never sent to a client, a ball is never handed out twice, a
        second console cannot draw over the first, and every ball is written down.
     2. If the Worker cannot be reached, the console draws the rest of the game
        itself and the room notices nothing but a toast. "Foolproof and legal",
        in Dean's words, in that order.

   The Worker handlers are lifted out of the real file and RUN against a fake
   database, so a rename or a dropped guard fails here rather than in a pub. The
   console side is a large inline script with a DOM under it, so it is read for
   the exact shapes that matter.  Run: jsc venueplay-backend/worker/bingo-server-draw.test.js */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var W = find('venueplay-backend/worker/venueplay-game.js');
var CONSOLE = find('venueplay/app/index.html');
var SESS = find('venueplay/app/vp-session.js');
var MIG = find('venueplay-backend/supabase/venueplay-70-bingo-server-draw.sql');

var EXPECT = 47, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function lift(n) {
  var i = W.indexOf('async function ' + n + '('); if (i < 0) i = W.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = W.indexOf('{', i);
  do { if (W[k] === '{') d++; else if (W[k] === '}') d--; k++; } while (d > 0 && k < W.length);
  return W.slice(i, k) + '\n';
}

/* ---- a fake Worker world, just enough for the three handlers ---- */
var enc = encodeURIComponent;
var DB = {}, LOG = [], NOW = 1000000, STAFF_CALLS = [];
function json(o, status) { return { status: status || 200, body: o }; }
async function verifyHostJwt() { return 'user-1'; }
async function requireStaff(env, uid, venueId) { STAFF_CALLS.push(venueId); if (venueId === 'v-someone-else') throw new Error('not staff'); }
async function assertVenueActive() {}
function assertUuid(v, what) { if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error('bad ' + what); }
function randomTokenHex() { return 'seed-abc'; }
var BODY = {};
async function readJson() { return BODY; }
var _Date = Date;
Date.now = function () { return NOW; };
function parseFilter(q) { var m = /(\w+)=eq\.([^&]+)/.exec(q); return m ? { k: m[1], v: decodeURIComponent(m[2]) } : null; }
async function sbGet(env, table, q) {
  LOG.push(['get', table, q]);
  var rows = (DB[table] || []).slice();
  var f = parseFilter(q); if (f) rows = rows.filter(function (r) { return String(r[f.k]) === f.v; });
  if (/order=ordinal\.desc/.test(q)) rows.sort(function (a, b) { return b.ordinal - a.ordinal; });
  var lim = /limit=(\d+)/.exec(q); if (lim) rows = rows.slice(0, +lim[1]);
  return rows;
}
async function sbInsert(env, table, obj, ret) {
  LOG.push(['insert', table, obj]);
  DB[table] = DB[table] || [];
  if (table === 'vp_bingo_draw_balls') {
    if (DB[table].some(function (r) { return r.draw_id === obj.draw_id && (r.number === obj.number || r.ordinal === obj.ordinal); })) {
      var e = new Error('duplicate'); e.status = 409; throw e;
    }
    obj.drawn_at = new Date(NOW).toISOString();
  }
  if (!obj.id) obj.id = '00000000-0000-4000-8000-00000000000' + DB[table].length;
  DB[table].push(obj);
  return ret ? [obj] : null;
}
async function sbPatch(env, table, q, obj) {
  LOG.push(['patch', table, q, obj]);
  var f = parseFilter(q);
  (DB[table] || []).forEach(function (r) { if (String(r[f.k]) === f.v) Object.keys(obj).forEach(function (k) { r[k] = obj[k]; }); });
}
/* The real RPC is SQL (migration 70). This fake does exactly what that SQL does so
   the handler around it is tested for real; the SQL itself is read below. */
async function sbRpc(env, fn, args) {
  LOG.push(['rpc', fn, args]);
  if (fn !== 'vp_bingo_next_ball') throw new Error('unknown rpc ' + fn);
  var d = (DB.vp_bingo_draws || []).filter(function (r) { return r.id === args.p_draw; })[0];
  if (!d || d.draw_index >= d.draw_order.length) return [];
  d.draw_index++;
  var num = d.draw_order[d.draw_index - 1];
  await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: d.id, ordinal: d.draw_index, number: num, source: 'server' });
  return [{ number: num, new_index: d.draw_index }];
}
/* jsc has no Web Crypto. The real shuffle is given a mixed stand-in so it can run; its
   fairness is rng-evidence.test.js's job, not this one's. */
var seed = 987654321 >>> 0;
function mix(){ seed = (seed + 0x9E3779B9) >>> 0; var z = seed; z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD) >>> 0; z = Math.imul(z ^ (z >>> 15), 0x735A2D97) >>> 0; return (z ^ (z >>> 15)) >>> 0; }
globalThis.crypto = { getRandomValues: function (b) { for (var i = 0; i < b.length; i++) b[i] = mix(); return b; } };
eval(lift('shuffle1to90'));
eval(lift('randInt'));
eval(lift('handleBingoDrawStart'));
eval(lift('handleBingoBall'));
eval(lift('handleBingoFallback'));
var HOLD = /const BINGO_SERVER_HOLD_MS = (\d+)/.exec(W);
ok('the server hold exists and is shorter than the 5s the console holds for', !!HOLD && +HOLD[1] > 0 && +HOLD[1] < 5000,
   'longer than the console hold and every honest fifth-second tap is refused');
eval('var BINGO_SERVER_HOLD_MS = ' + (HOLD ? HOLD[1] : 4000) + ';');

var VENUE = '876b2667-8eec-43ff-b100-58fe3daa8462';
var DRAW;
(async function () {
  print('== opening a draw ==');
  BODY = { venue_id: VENUE };
  var r = await handleBingoDrawStart({}, {}, json);
  ok('a draw is opened and its id returned', r.status === 200 && !!r.body.draw_id);
  DRAW = r.body.draw_id;
  var row = DB.vp_bingo_draws[0];
  ok('the whole order of 1..90 is stored, shuffled', row.draw_order.length === 90 &&
     row.draw_order.slice().sort(function (a, b) { return a - b; }).join() === Array.from({ length: 90 }, function (_, i) { return i + 1; }).join());
  ok('the order is NOT in the reply', JSON.stringify(r.body).indexOf('draw_order') < 0 && !Array.isArray(r.body.draw_order),
     'this is the whole point: the future balls never leave the server');
  ok('staff at THAT venue was required', STAFF_CALLS[0] === VENUE);
  ok('it starts at ball zero in server mode', row.draw_index === 0 && (row.mode === undefined || row.mode === 'server'));

  print('\n== calling balls ==');
  STAFF_CALLS = [];
  BODY = { draw_id: DRAW };
  var b1 = await handleBingoBall({}, {}, json);
  ok('the first ball comes back with its index', b1.status === 200 && b1.body.number >= 1 && b1.body.number <= 90 && b1.body.index === 1);
  ok('it is the first number of the stored order', b1.body.number === row.draw_order[0]);
  ok('staff was checked against the DRAW\'s venue, not a venue the caller named', STAFF_CALLS[0] === VENUE);
  ok('the ball is on the record with the time', DB.vp_bingo_draw_balls.length === 1 && DB.vp_bingo_draw_balls[0].source === 'server' && !!DB.vp_bingo_draw_balls[0].drawn_at);

  var b2 = await handleBingoBall({}, {}, json);
  ok('a second request inside the hold is refused with 429', b2.status === 429, 'got ' + b2.status);
  ok('and told how long to wait, in words', /call again in \d+ second/.test(b2.body.error || ''));
  ok('and nothing was drawn', DB.vp_bingo_draws[0].draw_index === 1 && DB.vp_bingo_draw_balls.length === 1);

  NOW += BINGO_SERVER_HOLD_MS + 1;
  var b3 = await handleBingoBall({}, {}, json);
  ok('after the hold the next ball comes', b3.status === 200 && b3.body.index === 2 && b3.body.number === row.draw_order[1]);
  ok('a ball is never handed out twice', b3.body.number !== b1.body.number);

  print('\n== every ball, to the end ==');
  var seen = {}; seen[b1.body.number] = 1; seen[b3.body.number] = 1; var dup = false, last;
  for (var i = 3; i <= 90; i++) {
    NOW += BINGO_SERVER_HOLD_MS + 1;
    last = await handleBingoBall({}, {}, json);
    if (last.status !== 200) break;
    if (seen[last.body.number]) dup = true; seen[last.body.number] = 1;
  }
  ok('all 90 balls came out, none twice', Object.keys(seen).length === 90 && !dup && last.status === 200);
  NOW += BINGO_SERVER_HOLD_MS + 1;
  var b91 = await handleBingoBall({}, {}, json);
  ok('the 91st request is refused with 409, not an error', b91.status === 409 && /All 90/.test(b91.body.error));
  ok('the record holds exactly 90 balls', DB.vp_bingo_draw_balls.length === 90);

  print('\n== somebody else\'s draw ==');
  DB.vp_bingo_draws.push({ id: '11111111-1111-4111-8111-111111111111', venue_id: 'v-someone-else', draw_index: 0, draw_order: shuffle1to90(), mode: 'server' });
  BODY = { draw_id: '11111111-1111-4111-8111-111111111111' };
  var refused = false; try { await handleBingoBall({}, {}, json); } catch (e) { refused = true; }
  ok('a host at another venue cannot call its balls', refused);
  BODY = { draw_id: '22222222-2222-4222-8222-222222222222' };
  var nf = await handleBingoBall({}, {}, json);
  ok('a draw that does not exist is a 404', nf.status === 404);
  BODY = { draw_id: 'not-a-uuid' };
  var bad1 = false; try { await handleBingoBall({}, {}, json); } catch (e) { bad1 = true; }
  ok('rubbish never reaches the database', bad1);

  print('\n== the tablet takes over ==');
  BODY = { venue_id: VENUE };
  var d2 = (await handleBingoDrawStart({}, {}, json)).body.draw_id;
  BODY = { draw_id: d2 }; NOW += 60000;
  var s1 = await handleBingoBall({}, {}, json);
  ok('a fresh draw hands out its first ball', s1.status === 200 && s1.body.index === 1);
  // The console lost the Worker and called 17 itself as ball 2.
  var seventeen = s1.body.number === 17 ? 18 : 17;
  BODY = { draw_id: d2, number: seventeen, ordinal: 2, reason: 'ball failed: timeout' };
  var f1 = await handleBingoFallback({}, {}, json);
  var d2row = DB.vp_bingo_draws.filter(function (r) { return r.id === d2; })[0];
  ok('the fallback is accepted', f1.status === 200 && f1.body.ok === true);
  ok('the draw flips to local, and remembers at which ball and why', d2row.mode === 'local' && d2row.fallback_at === 2 && /timeout/.test(d2row.fallback_why));
  ok('the tablet ball is on the record, marked as the tablet\'s',
     DB.vp_bingo_draw_balls.some(function (r) { return r.draw_id === d2 && r.ordinal === 2 && r.number === seventeen && r.source === 'local'; }));
  BODY = { draw_id: d2 }; NOW += 60000;
  var s2 = await handleBingoBall({}, {}, json);
  ok('once the tablet has taken over the server refuses to hand out more (409)', s2.status === 409,
     'a server ball now could repeat a number the room has already daubed');
  BODY = { draw_id: d2, number: s1.body.number, ordinal: 3, reason: 'x' };
  var clash = false; try { await handleBingoFallback({}, {}, json); } catch (e) { clash = true; }
  ok('a tablet ball that repeats a number already out is refused, not recorded', clash);
  BODY = { draw_id: d2, number: 95, ordinal: 4 };
  var f3 = await handleBingoFallback({}, {}, json);
  ok('a number outside 1..90 is a 400', f3.status === 400);

  print('\n== the routes ==');
  ok('/host/bingo/draw is routed', /path === '\/host\/bingo\/draw'\)\s+return await handleBingoDrawStart/.test(W));
  ok('/host/bingo/ball is routed', /path === '\/host\/bingo\/ball'\)\s+return await handleBingoBall/.test(W));
  ok('/host/bingo/fallback is routed', /path === '\/host\/bingo\/fallback'\)\s+return await handleBingoFallback/.test(W));

  print('\n== migration 70 ==');
  ok('the draw is advanced and the ball written in ONE function, under a row lock',
     /create or replace function public\.vp_bingo_next_ball/.test(MIG) && /for update;/.test(MIG) &&
     /insert into public\.vp_bingo_draw_balls/.test(MIG));
  ok('a ball can only be on a draw once', /unique \(draw_id, number\)/.test(MIG));
  ok('a position can only be filled once', /primary key \(draw_id, ordinal\)/.test(MIG));
  ok('the order is unreadable with the public keys',
     /revoke all on public\.vp_bingo_draws from public, anon, authenticated/.test(MIG) &&
     /alter table public\.vp_bingo_draws enable row level security/.test(MIG));
  ok('only the service role may draw', /grant execute on function public\.vp_bingo_next_ball\(uuid\) to service_role;/.test(MIG) && !/grant[^;]*vp_bingo_next_ball[^;]*\b(anon|authenticated|public)\b/.test(MIG) &&
     /revoke all on function public\.vp_bingo_next_ball\(uuid\) from public, anon, authenticated/.test(MIG));

  print('\n== the console asks the server first, and does not wait for it forever ==');
  ok('a game start opens a server draw', /function startGame\(\)[\s\S]{0,1500}openServerDraw\(\);/.test(CONSOLE) &&
     /function newGame\(\)[\s\S]{0,1500}openServerDraw\(\);/.test(CONSOLE));
  ok('nextBall asks serverBall() before it touches the pool', /serverBall\(\)\.then\(function\(res\)\{/.test(CONSOLE));
  var DRAW_MS = /var DRAW_CALL_MS=(\d+);/.exec(CONSOLE);
  ok('each request gives up inside a few seconds', !!DRAW_MS && +DRAW_MS[1] <= 5000 && +DRAW_MS[1] >= 2000,
     'a room must never sit through a long timeout');
  ok('no answer means the tablet calls the rest of the game', /goLocalDraw\("ball failed: "/.test(CONSOLE) && /if\(n==null\) n=drawFromPool\(\);/.test(CONSOLE));
  ok('a 429 means wait, not fall back', /if\(r && r\.status===429\) return \{ wait:/.test(CONSOLE) && /if\(res\.wait\)\{ showToast\(res\.wait\); syncNextBtn\(\); return; \}/.test(CONSOLE));
  ok('the host is told once, in plain words', /Calling from this tablet for the rest of this game/.test(CONSOLE));
  ok('a tablet ball is reported to the server', /function commitBall\(n, fromServer\)\{[\s\S]{0,200}if\(!fromServer\) reportLocalBall\(n, G\.idx\+1\);/.test(CONSOLE));
  ok('a second tap while a request is out does nothing', /if\(G\.calling\) return;\s+G\.calling=true;/.test(CONSOLE));
  ok('a reply for a game that has since ended is dropped', /if\(_gen!==G\.gen \|\| G\.status!=="running"\)\{ syncNextBtn\(\); return; \}/.test(CONSOLE));
  ok('the draw handle survives a reload', /drawId:G\.drawId\|\|null, drawMode:G\.drawMode/.test(CONSOLE) && /G\.drawId=s\.drawId\|\|null;/.test(CONSOLE));
  ok('vp-session has a call that reports the status instead of swallowing it',
     /function gameApiCall\(path, body, timeoutMs\)/.test(SESS) && /return \{ status: res\.status, json: j \};/.test(SESS) && /gameApiCall: gameApiCall,/.test(SESS));

  done();
})().catch(function (e) { print('\nTEST ERROR: ' + e + (e && e.stack ? '\n' + e.stack : '')); done(e); });

function done(err) {
  if (ran !== EXPECT) {
    print('\nONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN. The rest were skipped, not passed.');
    throw new Error('incomplete: ' + ran + '/' + EXPECT);
  }
  if (bad || err) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw (err || new Error(bad + ' failed')); }
  print('\nALL ' + EXPECT + ' CHECKS PASSED');
}
