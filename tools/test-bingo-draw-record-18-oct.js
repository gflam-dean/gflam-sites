/* BINGO IN THE DRAW RECORD (18 Oct 2026). GET /host/draws/export handed a venue every members
   draw and raffle result and not one bingo ball, while the Queensland OLGR RNG submission points
   at that file as the bingo draw record. Now every ball of every bingo game at the venue is a row:
   when, which game (draw id), its place in the call, the number, and where the pick was made
   (server draw, tablet fallback with the reason, or a real ball caller). A ball a caller took back
   (migration 103's withdrawn_at) is its own row, marked WITHDRAWN. 103 may not be run yet, so the
   export must answer with and without the column.

   Runs the REAL handleDrawsExport out of the shipped venueplay-game.js on the rig
   (tools/rig-game-worker.js), against a fake PostgREST that pages at 1,000 like the real one, and
   the REAL click handler and helper of the bingo console (venueplay/app/index.html and
   /app/vp-drawrecord.js) with stubs.

   Run from the repo root:  jsc tools/test-bingo-draw-record-18-oct.js */
load('tools/rig-game-worker.js');
var finished = false;
var OTHER = '33333333-3333-4333-8333-333333333333';
var D_SERVER = 'd0000000-0000-4000-8000-000000000001', D_FALL = 'd0000000-0000-4000-8000-000000000002',
    D_CALLER = 'd0000000-0000-4000-8000-000000000003', D_OTHER = 'd0000000-0000-4000-8000-000000000004';
var MDRAW = '55555555-5555-4555-8555-555555555555';
function at(min, sec) { return new Date(Date.UTC(2026, 9, 10, 9, min, sec || 0)).toISOString(); }
function req(url) { return { url: url, headers: { get: function () { return ''; } } }; }
Response = function (body, init) { this._b = body; this.status = (init && init.status) || 200; this.ok = this.status < 300; this.headers = (init && init.headers) || {}; };
var EXPORT = 'https://w/host/draws/export?venue_id=' + VENUE + '&format=csv';
async function exportCsv(url) {
  try { return await handleDrawsExport(req(url || EXPORT), ENV, json, {}); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function dataLines(r) { return String(r._b || '').split('\r\n').filter(function (l) { return l !== ''; }).slice(2); }
function bingoLines(r) { return dataLines(r).filter(function (l) { return l.split(',')[1] === 'bingo'; }); }

// A server draw, a draw whose wifi dropped at ball 4, a caller-mode night with one Undo, and a
// draw at ANOTHER venue that must never reach this one's file. The fake answers every column
// (it ignores select), so the order and the seed sit in the rows to be leaked if anything asked.
function world(withColumn) {
  DB = { vp_venues: [{ id: VENUE, status: 'active' }, { id: OTHER, status: 'active' }],
         vp_member_draws: [{ id: MDRAW, venue_id: VENUE, name: 'Friday Badge Draw' }],
         vp_member_draw_results: [{ id: 'r1', draw_id: MDRAW, drawn_at: at(1, 30), member_number: 104, winner_name: 'Member N4', amount_cents: 50000, outcome: 'claimed' }],
         vp_sessions: [], vp_games: [], vp_raffle_results: [],
         vp_bingo_draws: [
           { id: D_SERVER, venue_id: VENUE, draw_seed: 'SEED-SECRET-1', draw_order: [7, 12, 33], draw_index: 3, mode: 'server', fallback_at: null, fallback_why: null, created_at: at(0) },
           { id: D_FALL, venue_id: VENUE, draw_seed: 'SEED-SECRET-2', draw_order: [1, 2, 3], draw_index: 3, mode: 'local', fallback_at: 4, fallback_why: 'worker unreachable, "timeout", 4s', created_at: at(10) },
           { id: D_CALLER, venue_id: VENUE, draw_seed: 'none: real balls', draw_order: [], draw_index: 0, mode: 'local', fallback_at: 1, fallback_why: 'caller', created_at: at(20) },
           { id: D_OTHER, venue_id: OTHER, draw_seed: 'SEED-SECRET-4', draw_order: [9], draw_index: 1, mode: 'server', fallback_at: null, fallback_why: null, created_at: at(5) }],
         vp_bingo_draw_balls: [
           { draw_id: D_SERVER, ordinal: 1, number: 7, source: 'server', drawn_at: at(1) },
           { draw_id: D_SERVER, ordinal: 2, number: 12, source: 'server', drawn_at: at(2) },
           { draw_id: D_SERVER, ordinal: 3, number: 33, source: 'server', drawn_at: at(3) },
           { draw_id: D_FALL, ordinal: 1, number: 50, source: 'server', drawn_at: at(11) },
           { draw_id: D_FALL, ordinal: 2, number: 51, source: 'server', drawn_at: at(12) },
           { draw_id: D_FALL, ordinal: 3, number: 52, source: 'server', drawn_at: at(13) },
           { draw_id: D_FALL, ordinal: 4, number: 60, source: 'local', drawn_at: at(14) },
           { draw_id: D_FALL, ordinal: 5, number: 61, source: 'local', drawn_at: at(15) },
           { draw_id: D_CALLER, ordinal: 1, number: 22, source: 'local', drawn_at: at(21) },
           { draw_id: D_CALLER, ordinal: 2, number: 88, source: 'local', drawn_at: at(22), withdrawn_at: at(22, 20) },   // a mis-tap, taken back
           { draw_id: D_CALLER, ordinal: 2, number: 83, source: 'local', drawn_at: at(22, 30) },                       // the ball that was called
           { draw_id: D_OTHER, ordinal: 1, number: 9, source: 'server', drawn_at: at(6) }] };
  if (!withColumn) DB.vp_bingo_draw_balls.forEach(function (b) { delete b.withdrawn_at; });
  else DB.vp_bingo_draw_balls.forEach(function (b) { if (!('withdrawn_at' in b)) b.withdrawn_at = null; });
}
// Before migration 103: PostgREST refuses any read that names the column, the way it really does.
var realFetch = fetch, noColumn = false;
fetch = async function (u, o) {
  var s = String(u);
  if (noColumn && /\/rest\/v1\/vp_bingo_draw_balls\?/.test(s) && /withdrawn_at/.test(s)) {
    LOG.push('REFUSED ' + s);
    var t = '{"code":"42703","details":null,"hint":null,"message":"column vp_bingo_draw_balls.withdrawn_at does not exist"}';
    return { ok: false, status: 400, json: async function () { return JSON.parse(t); }, text: async function () { return t; } };
  }
  return realFetch(u, o);
};

(async function () {
  print('migration 103 run: every ball, its source in words, the withdrawn ball as its own row');
  world(true); LOG = [];
  var r = await exportCsv();
  var b = bingoLines(r);
  show('CONTROL: staff get a 200 CSV', r.status === 200 && /^text\/csv/.test(r.headers['Content-Type'] || ''), r.status + ' ' + JSON.stringify(r.body || ''));
  show('every ball at this venue is a row: 3 server + 5 fallback + 3 caller (one withdrawn) = 11', b.length === 11, b.length + ' rows: ' + JSON.stringify(b));
  var srv = b.filter(function (l) { return l.indexOf(D_SERVER) >= 0; });
  show('a server ball: when, bingo, the number, called, the draw id, its place in the call, "server draw"', srv[0] === at(1) + ',bingo,Bingo,7,,,called,' + D_SERVER + ',1,server draw', srv[0]);
  var fall = b.filter(function (l) { return l.indexOf(D_FALL) >= 0; });
  show('a draw that fell back keeps its server balls as server draws', fall.length === 5 && /,server draw$/.test(fall[0]) && /,server draw$/.test(fall[2]), JSON.stringify(fall));
  show('and the tablet balls say tablet fallback with the console\'s reason (quoted, its quotes doubled)', fall[3] === at(14) + ',bingo,Bingo,60,,,called,' + D_FALL + ',4,"tablet fallback: worker unreachable, ""timeout"", 4s"', fall[3]);
  var cal = b.filter(function (l) { return l.indexOf(D_CALLER) >= 0; });
  show('a caller-mode ball says real ball caller, on a draw named for real balls', cal[0] === at(21) + ',bingo,"Bingo, real balls",22,,,called,' + D_CALLER + ',1,real ball caller', cal[0]);
  show('the withdrawn ball is its own row, marked WITHDRAWN with when it was taken back', cal.length === 3 && cal[1].indexOf(at(22) + ',bingo,"Bingo, real balls",88,,,"WITHDRAWN at ' + at(22, 20) + ': called in error and taken back, not part of the game",' + D_CALLER + ',2,real ball caller') === 0, cal[1]);
  show('and the ball called in its place follows it, at the same place in the call, as called', cal[2] === at(22, 30) + ',bingo,"Bingo, real balls",83,,,called,' + D_CALLER + ',2,real ball caller', cal[2]);
  show('only the withdrawn row says WITHDRAWN', b.filter(function (l) { return /WITHDRAWN/.test(l); }).length === 1, JSON.stringify(b.filter(function (l) { return /WITHDRAWN/.test(l); })));
  var all = dataLines(r);
  show('bingo sits in time order with the other draws: the 09:01:30 members result between balls 1 and 2 of the first game', all.length === 12 && all[0].indexOf(at(1) + ',bingo') === 0 && all[1].indexOf(at(1, 30) + ',members draw') === 0 && all[2].indexOf(at(2) + ',bingo') === 0, JSON.stringify(all.slice(0, 3)));
  show('ANOTHER venue\'s bingo draw never reaches this venue\'s file', String(r._b).indexOf(D_OTHER) < 0 && !/,bingo,Bingo,9,/.test(String(r._b)), String(r._b).indexOf(D_OTHER));
  var drawsRead = LOG.filter(function (l) { return /^GET vp_bingo_draws\?/.test(l); });
  show('the draws are read for this venue only, and never for the order or the seed', drawsRead.length >= 1 && drawsRead.every(function (l) { return l.indexOf('venue_id=eq.' + VENUE) >= 0 && /select=/.test(l) && !/draw_order|draw_seed|select=\*/.test(l); }), JSON.stringify(drawsRead));
  show('nothing in the file is the order\'s seed', String(r._b).indexOf('SEED-SECRET') < 0);
  var ballsRead = LOG.filter(function (l) { return /^GET vp_bingo_draw_balls\?draw_id=in\./.test(l); });
  show('the balls are read with the withdrawn column, paged and ordered', ballsRead.length >= 1 && ballsRead.every(function (l) { return /withdrawn_at/.test(l) && /&order=/.test(l) && /&limit=\d+&offset=\d+/.test(l); }), JSON.stringify(ballsRead));

  print('migration 103 NOT run: the column is not there and the export still answers');
  world(false); LOG = []; noColumn = true;
  r = await exportCsv();
  noColumn = false;
  b = bingoLines(r);
  show('a 200, with every ball still on it (the pre-103 Undo deleted its row, so nothing is missing)', r.status === 200 && b.length === 11, r.status + ' ' + b.length + ' ' + JSON.stringify(r.body || ''));
  show('no row says WITHDRAWN, every one says called', b.every(function (l) { return /,called,/.test(l) && !/WITHDRAWN/.test(l); }), JSON.stringify(b));
  show('it asked for the column once, was refused, and read the balls without it', LOG.filter(function (l) { return /^REFUSED /.test(l); }).length === 1 &&
    LOG.filter(function (l) { return /^GET vp_bingo_draw_balls\?draw_id=in\./.test(l); }).every(function (l) { return !/withdrawn_at/.test(l); }) &&
    LOG.filter(function (l) { return /^GET vp_bingo_draw_balls\?draw_id=in\./.test(l); }).length >= 1, JSON.stringify(LOG.filter(function (l) { return /vp_bingo_draw_balls/.test(l); })));
  var keepFetch = fetch;
  fetch = async function (u, o) {
    if (/\/rest\/v1\/vp_bingo_draw_balls\?/.test(String(u))) { var t = '{"code":"57014","message":"canceling statement due to statement timeout"}'; return { ok: false, status: 500, json: async function () { return JSON.parse(t); }, text: async function () { return t; } }; }
    return keepFetch(u, o);
  };
  world(true);
  r = await exportCsv();
  fetch = keepFetch;
  show('any OTHER database failure is an error, never read as "not run yet" and never a short file', r.status === 502 && !r._b, r.status + ' ' + JSON.stringify(r.body || ''));

  print('a club with 1,350 balls on record: past PostgREST\'s 1,000 a page');
  world(true);
  DB.vp_bingo_draws = []; DB.vp_bingo_draw_balls = []; DB.vp_member_draw_results = [];
  for (var g = 0; g < 15; g++) {
    var id = 'e0000000-0000-4000-8000-' + ('000000000000' + g).slice(-12);
    DB.vp_bingo_draws.push({ id: id, venue_id: VENUE, draw_seed: 'x', draw_order: [], draw_index: 90, mode: 'server', fallback_at: null, fallback_why: null, created_at: new Date(Date.UTC(2026, 0, 1 + g)).toISOString() });
    for (var n = 1; n <= 90; n++) DB.vp_bingo_draw_balls.push({ draw_id: id, ordinal: n, number: n, source: 'server', withdrawn_at: null, drawn_at: new Date(Date.UTC(2026, 0, 1 + g, 9, 0, n)).toISOString() });
  }
  r = await exportCsv();
  b = bingoLines(r);
  var seen = {};
  b.forEach(function (l) { var c = l.split(','); seen[c[7] + '#' + c[8]] = 1; });
  show('1,350 balls come out as 1,350 rows, each one once', r.status === 200 && b.length === 1350 && Object.keys(seen).length === 1350, b.length + ' rows, ' + Object.keys(seen).length + ' distinct');
  show('oldest first, the first game\'s ball 1 to the last game\'s ball 90', b[0].indexOf('2026-01-01T09:00:01') === 0 && b[1349].indexOf('2026-01-15T09:01:30') === 0, b[0] + ' | ' + b[1349]);

  print('guarded: a host at another venue gets nothing');
  world(true);
  var keepStaff = requireStaff;
  requireStaff = async function (env, uid, venueId) {
    if (venueId !== OTHER) { var e = new Error('Not authorised: you are not staff at this venue'); e.status = 403; throw e; }
    return { id: 'staff-9', role: 'host', venue_id: venueId, auth_user_id: uid };
  };
  r = await exportCsv();
  show('a host who is staff only at another venue is refused 403 and gets no file', r.status === 403 && !r._b, JSON.stringify(r));
  r = await exportCsv('https://w/host/draws/export?venue_id=' + OTHER + '&format=csv');
  requireStaff = keepStaff;
  b = bingoLines(r);
  show('CONTROL: at their own venue they get only their own venue\'s ball', r.status === 200 && b.length === 1 && b[0].indexOf(D_OTHER) >= 0 && String(r._b).indexOf(D_SERVER) < 0, JSON.stringify(b));

  print('the bingo console: the button, the shared helper, and the venue it asks for');
  var PAGE = readFile('venueplay/app/index.html');
  var tag = PAGE.indexOf('<script src="/app/vp-drawrecord.js"></script>'), inline = PAGE.indexOf('<script>\n(function(){');
  show('the console loads /app/vp-drawrecord.js before its own script', tag > 0 && inline > tag, tag + ' < ' + inline);
  var setup = PAGE.slice(PAGE.indexOf('<div id="setupBlock">'), PAGE.indexOf('<div id="liveBlock"'));
  show('the button and its message sit on the between-games panel', setup.indexOf('id="downloadRecordBtn"') > 0 && setup.indexOf('>Download draw record</button>') > 0 && setup.indexOf('id="downloadRecordMsg"') > 0);
  var body = PAGE.slice(inline + '<script>\n'.length, PAGE.indexOf('</script>', inline));
  var compiled = true;
  try { new Function(body); } catch (e) { compiled = String(e); }
  show('the console\'s script still compiles', compiled === true, compiled);
  var a = body.indexOf('  $("downloadRecordBtn").addEventListener("click", function(){'), z = body.indexOf('\n  });\n', a);
  var handlerSrc = a >= 0 && z > a ? body.slice(a, z + 6) : '';
  var listeners = {}, els = {};
  function $(id) { if (!els[id]) els[id] = { id: id, textContent: '', disabled: false, addEventListener: function (ev, f) { listeners[id + ':' + ev] = f; } }; return els[id]; }
  var DR = {}, fetched = [], clicked = [];
  new Function('window', readFile('venueplay/app/vp-drawrecord.js'))(DR);
  DR.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} }; DR.setTimeout = function () {};
  DR.document = { createElement: function () { return { click: function () { clicked.push(this.download); } }; }, body: { appendChild: function () {}, removeChild: function () {} } };
  DR.fetch = function (u, o) { fetched.push([u, o]); return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve({}); } }); };
  var ran1 = true;
  try {
    new Function('$', 'window', 'VPDrawRecord', '__ctx', 'VP_GAME_API', 'vpHostToken', handlerSrc)($, DR, DR.VPDrawRecord, { venue: { id: VENUE } }, 'https://game', function () { return Promise.resolve('tok-b'); });
  } catch (e) { ran1 = String(e); }
  show('the click handler is there and wires the button', ran1 === true && typeof listeners['downloadRecordBtn:click'] === 'function', ran1 + ' ' + handlerSrc.length);
  if (typeof listeners['downloadRecordBtn:click'] === 'function') listeners['downloadRecordBtn:click']();
  drainMicrotasks();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  show('a tap asks the Worker for THIS venue\'s record with the host\'s token, and saves it', fetched.length === 1 && fetched[0][0] === 'https://game/host/draws/export?venue_id=' + VENUE + '&format=csv' && fetched[0][1].headers.Authorization === 'Bearer tok-b' && clicked.length === 1 && /7 years/.test($('downloadRecordMsg').textContent), JSON.stringify(fetched) + ' ' + clicked + ' ' + $('downloadRecordMsg').textContent);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('bingo draw record 18 Oct: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
