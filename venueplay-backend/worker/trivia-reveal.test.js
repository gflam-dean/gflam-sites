/* A QUESTION IS CLOSED BEFORE IT IS SCORED.

   handleHostReveal used to read the answers, score them, and only then flip the
   phase to revealed. For that whole stretch /player/answer still saw 'asking' and
   kept accepting. An answer that landed in the gap was stored with is_correct null
   and never scored, because nothing comes back for a question once the round
   moves on. The player who tapped as the host pressed Reveal, in time by the
   server's own clock, scored nothing. A double tap on Reveal ran two full
   reveals.

   This RUNS the real handler with a scripted database and checks the order of
   the writes, not the wording of the comments.

   Run: jsc venueplay-backend/worker/trivia-reveal.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-game.js');
function lift(n) {
  var i = src.indexOf('async function ' + n + '('); if (i < 0) i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k) + '\n';
}
function liftLine(re) {
  var m = re.exec(src);
  if (!m) throw new Error('cannot find line ' + re + ' - a test that cannot find its subject cannot fail');
  /* eval() keeps a let/const to its own scope; var is what reaches the functions lifted next. */
  return m[0].replace(/^(let|const) /, 'var ') + '\n';
}
function liftBlock(startRe) {   // a `const X = {` object literal up to its closing `};`
  var m = startRe.exec(src); if (!m) throw new Error('cannot find ' + startRe);
  var i = m.index, k = src.indexOf('};', i);
  return src.slice(i, k + 2).replace(/^const /, 'var ') + '\n';
}
var EXPECT = 19;
var bad = 0, ran = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

/* ---- the least the handler needs ---- */
var enc = encodeURIComponent;
function json(o, status) { if (status) o._status = status; return { _json: o }; }
function readJson(r) { return Promise.resolve(r.body || {}); }
function verifyHostJwt() { return Promise.resolve('host-1'); }
function assertUuid() {}
function getSession() { return Promise.resolve({ id: 's1', venue_id: 'v1', status: 'running' }); }
function requireStaff() { return Promise.resolve({ id: 'staff-1', role: 'host' }); }
function actorRef() { return 'staff-1'; }
var console = { log: function () {}, warn: function () {} };
function sbHeaders() { return {}; }
function dbError(kind, fn, detail) { return new Error('db ' + kind + ' ' + fn + ': ' + detail); }
var ENV73 = { SUPABASE_URL: 'https://db' };
/* Migration 73: the reveal asks vp_host_reveal first. This scripted PostgREST answers however
   the scene says: a jsonb reply (the function is there), 404 (not run yet) or an error word. */
var rpc = { status: 404, body: null, calls: [] };
function fetch(url, opts) {
  rpc.calls.push({ url: url, body: JSON.parse(opts.body) });
  return Promise.resolve({ status: rpc.status, ok: rpc.status === 200,
    json: function () { return Promise.resolve(rpc.body); }, text: function () { return Promise.resolve(''); } });
}
var emitted = [];
function emitEvent(env, session, type, payload) { emitted.push({ type: type, payload: payload }); return Promise.resolve(); }

var log = [];               // every database call, in order
var DB;                     // scripted state
var ENDS = '2026-09-08T10:00:20.000Z';
function base() {
  log = []; emitted = [];
  DB = {
    phase: 'asking',
    answers: [
      { id: 'a1', player_id: 'p1', answer_index: 2, answered_at: '2026-09-08T10:00:05.000Z', is_correct: null, points_awarded: null },
      { id: 'a2', player_id: 'p2', answer_index: 0, answered_at: '2026-09-08T10:00:06.000Z', is_correct: null, points_awarded: null },
      { id: 'a3', player_id: 'p3', answer_index: 2, answered_at: '2026-09-08T10:00:15.000Z', is_correct: null, points_awarded: null },
    ],
    straggler: null,        // an answer that lands AFTER the reveal reads the table
  };
}
function sbGet(env, table, q) {
  log.push('GET ' + table);
  if (table === 'vp_games') return Promise.resolve([{ id: 'g1', session_id: 's1', status: 'running', format: 'trivia', config: {} }]);
  if (table === 'vp_trivia_games') return Promise.resolve([{ question_set_id: 'set1', current_seq: 3, phase: DB.phase, question_ends_at: ENDS }]);
  if (table === 'vp_questions') return Promise.resolve([{ id: 'q3', options: ['a', 'b', 'c', 'd'], correct_index: 2, points: 100, time_limit_s: 20 }]);
  if (table === 'vp_trivia_answers') {
    var rows = DB.answers.map(function (a) { return Object.assign({}, a); });
    if (DB.straggler) { DB.answers.push(DB.straggler); DB.straggler = null; }   // arrives just after this read
    return Promise.resolve(rows);
  }
  if (table === 'v_vp_trivia_leaderboard') return Promise.resolve([]);
  return Promise.resolve([]);
}
function sbPatchReturning(env, table, filter, obj) {
  log.push('CAS ' + table + '?' + filter + ' ' + JSON.stringify(obj));
  if (table === 'vp_trivia_games' && /phase=eq\.asking/.test(filter)) {
    if (DB.phase !== 'asking') return Promise.resolve([]);
    DB.phase = obj.phase; return Promise.resolve([{ game_id: 'g1', phase: obj.phase }]);
  }
  return Promise.resolve([]);
}
function sbPatch(env, table, filter, obj) {
  log.push('PATCH ' + table + '?' + filter + ' ' + JSON.stringify(obj));
  if (table === 'vp_trivia_answers') {
    var m = /id=in\.\(([^)]*)\)/.exec(filter); var ids = m ? m[1].split(',') : [];
    DB.answers.forEach(function (a) { if (ids.indexOf(a.id) >= 0) { a.is_correct = obj.is_correct; a.points_awarded = obj.points_awarded; } });
  }
  if (table === 'vp_trivia_games') DB.phase = obj.phase;
  return Promise.resolve();
}
eval(liftBlock(/^const HOST_TRIVIA_STATUS = \{/m));
eval(liftLine(/^let hostTriviaRpcMissing[^\n]*/m));
eval(lift('hostTriviaRpc'));
eval(lift('handleHostReveal'));
eval(lift('handleHostRevealManyTrips'));
function req() { return { body: { game_id: 'g1' } }; }
function idx(prefix) { for (var i = 0; i < log.length; i++) if (log[i].indexOf(prefix) === 0) return i; return -1; }

print('== the one-trip function is there (migration 73) ==');
base();
rpc.status = 200; rpc.body = { status: 'ok', qseq: 3, correct_index: 2, split: [0, 1, 2, 0], leaderboard: [{ name: 'p1', points: 138 }], already: false };
handleHostReveal(req(), ENV73, json).then(function (r) {
  var d = r._json;
  ok('vp_host_reveal was asked, for this game, as this host',
     rpc.calls.length === 1 && /vp_host_reveal$/.test(rpc.calls[0].url) && rpc.calls[0].body.p_game_id === 'g1' && rpc.calls[0].body.p_auth_user_id === 'host-1',
     JSON.stringify(rpc.calls));
  ok('and its answer is the reply: nothing else was read or written', d.correct_index === 2 && d.split.length === 4 && d.already === false && log.length === 0,
     'log: ' + log.join(' | '));
  base(); rpc.calls = [];
  rpc.body = { status: 'not_staff' };
  return handleHostReveal(req(), ENV73, json);
}).then(function (r) {
  ok('a status word becomes the same refusal the old path gave', r._json._status === 403 && /not staff/.test(r._json.error), JSON.stringify(r._json));
  base(); rpc.calls = [];
  rpc.status = 404; rpc.body = null;    // migration 73 not run on this database
  return handleHostReveal(req(), ENV73, json);
}).then(function (r) {
  ok('when PostgREST says the function is missing, the old path answers', r._json.correct_index === 2 && hostTriviaRpcMissing === true && log.length > 0);
  var before = rpc.calls.length;
  base();
  return handleHostReveal(req(), ENV73, json).then(function () {
    ok('and this isolate stops asking', rpc.calls.length === before);
  });
}).then(function () {
  print('\n== a normal reveal (the many-trip path, exercised in full) ==');
  base();
  return handleHostReveal(req(), {}, json);
}).then(function (r) {
  var d = r._json;
  ok('it reveals', d.correct_index === 2 && d.qseq === 3);
  var flip = idx('CAS vp_trivia_games'), read = idx('GET vp_trivia_answers');
  ok('the phase is flipped with a compare-and-set, not a plain write',
     flip >= 0 && /phase=eq\.asking/.test(log[flip]), log[flip] || 'no CAS at all');
  ok('and it is flipped BEFORE the answers are read', flip >= 0 && read > flip,
     'order: ' + log.join(' | ') + ' - a phone can still answer while the reveal is scoring');
  ok('every answer is scored', DB.answers.every(function (a) { return a.is_correct !== null; }));
  ok('the right ones are right', DB.answers[0].is_correct === true && DB.answers[1].is_correct === false && DB.answers[2].is_correct === true);
  ok('faster keeps more of the bonus', DB.answers[0].points_awarded > DB.answers[2].points_awarded && DB.answers[2].points_awarded >= 100,
     DB.answers[0].points_awarded + ' vs ' + DB.answers[2].points_awarded);
  ok('one broadcast', emitted.length === 1 && emitted[0].type === 'trivia.reveal');
  ok('it says it did the reveal', d.already === false);

  print('\n== the same reveal pressed twice ==');
  base();
  return Promise.all([handleHostReveal(req(), {}, json), handleHostReveal(req(), {}, json)]);
}).then(function (rs) {
  var did = rs.filter(function (r) { return r._json.already === false; }).length;
  ok('exactly one of the two did the reveal', did === 1, did + ' did');
  ok('neither errored, both answered the host', rs.every(function (r) { return r._json.correct_index === 2; }));
  var scoring = log.filter(function (l) { return l.indexOf('PATCH vp_trivia_answers') === 0; });
  ok('the answers were scored once, not twice', scoring.length === 3, scoring.length + ' scoring writes (3 buckets expected: 138, 113, 0)');

  print('\n== the player who tapped as the host pressed Reveal ==');
  base();
  DB.straggler = { id: 'a4', player_id: 'p4', answer_index: 2, answered_at: '2026-09-08T10:00:19.000Z', is_correct: null, points_awarded: null };
  return handleHostReveal(req(), {}, json);
}).then(function () {
  var late = DB.answers[3];
  ok('the straggler is in the table, unscored, after the first reveal', late && late.is_correct === null);
  log = [];
  return handleHostReveal(req(), {}, json);   // the host presses Reveal again, or the console retries
}).then(function (r) {
  var late = DB.answers[3];
  ok('a second call scores what the first left behind, even though the phase was already revealed',
     late.is_correct === true && late.points_awarded >= 100, JSON.stringify(late));
  ok('and does not touch the rows already scored',
     log.filter(function (l) { return l.indexOf('PATCH vp_trivia_answers') === 0; }).length === 1,
     log.filter(function (l) { return l.indexOf('PATCH') === 0; }).join(' | '));
}).catch(function (e) {
  bad++; print('  FAIL a chain rejected: ' + (e && (e.message + ' ' + e.stack) || e));
}).then(function () {
  print('');
  if (ran !== EXPECT) { bad++; print('  FAIL ' + ran + ' checks ran, ' + EXPECT + ' expected'); }
  if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
});
