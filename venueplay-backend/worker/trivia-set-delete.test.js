/* DELETING A TRIVIA NIGHT THAT HAS BEEN PLAYED (audit, 23 Oct 2026).

   POST /host/trivia/set/delete answered 502 "A database error occurred" for any night a host
   had ever run. vp_trivia_games.question_set_id points at the set and vp_trivia_answers.question_id
   at its questions, neither with a cascade, so Postgres refused both deletes, and the one night
   a host most wanted rid of was the one they could not touch.

   Now a played night is ARCHIVED (status=archived, which the builder's list and the console's
   dropdown both leave out) and its questions and game rows stay, because they are the venue's
   results history. A never-played night is removed outright, as before. A night with a round
   running on it is refused with a 409 and a sentence, like removing a question is.

   This lifts the real handler out of the real Worker and runs it against a database stand-in
   that REFUSES the delete exactly as Postgres does when game rows point at the set, so the old
   code goes red here and the new code cannot pass by skipping the check.

   Run: jsc venueplay-backend/worker/trivia-set-delete.test.js */
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

var EXPECT = 24;
var bad = 0, ran = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}
function json(o, status) { return { _json: o, _status: status || 200 }; }

/* ---- the database stand-in ---- */
var VENUE = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
var SET_NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';     // never played
var SET_OLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';     // played, finished
var SET_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';    // played, a round running now
var SET_LIB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';     // VenuePlay library
var SET_THEIRS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';  // another venue's
var DB, writes, staffAsked;
function base() {
  writes = []; staffAsked = [];
  DB = {
    vp_question_sets: [
      { id: SET_NEW, owner_venue_id: VENUE, visibility: 'private', title: 'Fresh night', question_count: 2, status: 'active' },
      { id: SET_OLD, owner_venue_id: VENUE, visibility: 'private', title: 'Last Tuesday', question_count: 2, status: 'active' },
      { id: SET_LIVE, owner_venue_id: VENUE, visibility: 'private', title: 'Tonight', question_count: 2, status: 'active' },
      { id: SET_LIB, owner_venue_id: null, visibility: 'library', title: 'Movies', question_count: 50, status: 'active' },
      { id: SET_THEIRS, owner_venue_id: OTHER, visibility: 'private', title: 'Their night', question_count: 2, status: 'active' },
    ],
    vp_questions: [
      { id: 'q1', set_id: SET_NEW }, { id: 'q2', set_id: SET_NEW },
      { id: 'q3', set_id: SET_OLD }, { id: 'q4', set_id: SET_OLD },
      { id: 'q5', set_id: SET_LIVE }, { id: 'q6', set_id: SET_LIVE },
    ],
    vp_trivia_games: [
      { game_id: 'g-old', question_set_id: SET_OLD },
      { game_id: 'g-live', question_set_id: SET_LIVE },
    ],
    vp_games: [
      { id: 'g-old', status: 'finished' },
      { id: 'g-live', status: 'running' },
    ],
    vp_trivia_answers: [ { game_id: 'g-old', question_id: 'q3' } ],
  };
}
function parse(q) {
  var m = {};
  String(q).split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) m[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  return m;
}
function rowsFor(table, q) {
  var f = parse(q), rows = DB[table] || [];
  Object.keys(f).forEach(function (k) {
    if (k === 'select' || k === 'limit' || k === 'order') return;
    var v = f[k];
    if (v.indexOf('eq.') === 0) { var val = v.slice(3); rows = rows.filter(function (r) { return String(r[k]) === val; }); }
    else if (v.indexOf('in.(') === 0) { var l = v.slice(4, -1).split(','); rows = rows.filter(function (r) { return l.indexOf(String(r[k])) >= 0; }); }
    else throw new Error('stand-in cannot filter ' + k + '=' + v);
  });
  if (f.limit) rows = rows.slice(0, +f.limit);
  return rows;
}
var enc = encodeURIComponent;
function sbGet(env, table, q) { return Promise.resolve(rowsFor(table, q)); }
function sbPatch(env, table, filter, obj) {
  writes.push('PATCH ' + table + ' ' + filter + ' ' + JSON.stringify(obj));
  rowsFor(table, filter).forEach(function (r) { Object.keys(obj).forEach(function (k) { r[k] = obj[k]; }); });
  return Promise.resolve([]);
}
/* POSTGRES, NOT A YES-MACHINE. A set that a game row points at cannot be deleted, and a question
   an answer points at cannot either: the real database answers 23503 and the Worker turns that
   into its 502. The stand-in does the same, so the old handler fails here for the reason it
   failed in the pub. */
function sbDelete(env, table, filter) {
  writes.push('DELETE ' + table + ' ' + filter);
  var gone = rowsFor(table, filter);
  if (table === 'vp_question_sets' && gone.some(function (s) { return DB.vp_trivia_games.some(function (g) { return g.question_set_id === s.id; }); }))
    return Promise.reject(httpError(502, 'A database error occurred (23503)'));
  if (table === 'vp_questions' && gone.some(function (qq) { return DB.vp_trivia_answers.some(function (a) { return a.question_id === qq.id; }); }))
    return Promise.reject(httpError(502, 'A database error occurred (23503)'));
  DB[table] = DB[table].filter(function (r) { return gone.indexOf(r) < 0; });
  return Promise.resolve();
}
/* Start must turn back at the archived check, before it deals a question or writes a game. These are
   the first things hostStartTrivia reaches past that point; each one failing loudly is the test saying
   "it went on past the check", in words, instead of a ReferenceError. */
function sbGetAll() { return Promise.reject(new Error('Start went on past the archived check (dealt the questions)')); }
function sbInsert() { return Promise.reject(new Error('Start went on past the archived check (wrote a game)')); }
function sbCount() { return Promise.reject(new Error('Start went on past the archived check (counted questions)')); }
function verifyHostJwt() { return Promise.resolve('user-1'); }
function readJson(req) { return Promise.resolve(req._body || {}); }
function requireStaff(env, authUserId, venueId) {
  staffAsked.push(venueId);
  if (venueId !== VENUE) return Promise.reject(httpError(403, 'Not staff at this venue'));
  return Promise.resolve({ venue_id: venueId, role: 'owner' });
}
eval((/const UUID_RE = [^\n]+/.exec(src) || [''])[0].replace(/^const /, 'var '));   // assertUuid reads it
eval(lift('httpError'));
eval(lift('assertUuid'));
eval(lift('triviaSetForVenue'));
eval(lift('handleTriviaSetDelete'));
eval(lift('hostStartTrivia'));
function req(setId) { return { _body: { set_id: setId } }; }
function has(prefix) { return writes.some(function (w) { return w.indexOf(prefix) === 0; }); }

print('== CONTROL: the stand-in refuses what Postgres refuses ==');
base();
sbDelete({}, 'vp_question_sets', 'id=eq.' + SET_OLD).then(function () {
  ok('CONTROL: deleting a played set is refused by the database stand-in', false);
}, function (e) {
  ok('CONTROL: deleting a played set is refused by the database stand-in', e && e.status === 502 && /database error/.test(e.message), e && e.message);
  return sbDelete({}, 'vp_questions', 'set_id=eq.' + SET_OLD);
}).then(function () {
  ok('CONTROL: deleting its answered questions is refused too', false);
}, function (e) {
  ok('CONTROL: deleting its answered questions is refused too', e && e.status === 502, e && e.message);

  print('\n== a night that was never played is removed outright, as before ==');
  base();
  return handleTriviaSetDelete(req(SET_NEW), {}, json);
}).then(function (r) {
  ok('it answers ok', r && r._json && r._json.ok === true && r._status === 200, JSON.stringify(r));
  ok('and says it was not archived', r._json.archived === false);
  ok('its questions are gone', !DB.vp_questions.some(function (q) { return q.set_id === SET_NEW; }));
  ok('and so is the set', !DB.vp_question_sets.some(function (s) { return s.id === SET_NEW; }));
  ok('nothing was archived', !has('PATCH'), writes.join(' | '));
  ok('and the venue\'s staff list was checked first', staffAsked[0] === VENUE);

  print('\n== a night that has been played is archived, not deleted ==');
  base();
  return handleTriviaSetDelete(req(SET_OLD), {}, json);
}).then(function (r) {
  ok('it answers ok, not 502', r && r._json && r._json.ok === true && r._status === 200, JSON.stringify(r));
  ok('and says it was archived', r._json.archived === true);
  ok('with a sentence the host can read', typeof r._json.message === 'string' && /played/.test(r._json.message) && /results/.test(r._json.message), r._json.message);
  var s = DB.vp_question_sets.filter(function (x) { return x.id === SET_OLD; })[0];
  ok('the set is still there, status archived', !!s && s.status === 'archived', JSON.stringify(s));
  ok('its questions are still there (the answers point at them)', DB.vp_questions.filter(function (q) { return q.set_id === SET_OLD; }).length === 2);
  ok('the game row is still there (the results history)', DB.vp_trivia_games.some(function (g) { return g.question_set_id === SET_OLD; }));
  ok('and no DELETE was sent at all', !has('DELETE'), writes.join(' | '));

  print('\n== a night with a round running on it is refused, and nothing is written ==');
  base();
  return handleTriviaSetDelete(req(SET_LIVE), {}, json);
}).then(function (r) {
  ok('409, with a sentence about finishing the round', r && r._status === 409 && /running/.test(String(r._json && r._json.error)), JSON.stringify(r));
  ok('nothing written', writes.length === 0, writes.join(' | '));
  var s = DB.vp_question_sets.filter(function (x) { return x.id === SET_LIVE; })[0];
  ok('the night is still active', s && s.status === 'active');

  print('\n== the locks have not moved ==');
  base();
  return handleTriviaSetDelete(req(SET_THEIRS), {}, json).then(function () { return null; }, function (e) { return e; });
}).then(function (e) {
  ok('another venue\'s night: 403 from the staff check', e && e.status === 403, e && e.message);
  ok('and nothing written', writes.length === 0, writes.join(' | '));
  base();
  return handleTriviaSetDelete(req(SET_LIB), {}, json).then(function () { return null; }, function (e) { return e; });
}).then(function (e) {
  ok('a library set: 403, it is not the venue\'s to delete', e && e.status === 403 && /library/.test(e.message), e && e.message);
  ok('and nothing written', writes.length === 0, writes.join(' | '));

  print('\n== Start refuses an archived night a stale console could still send ==');
  base();
  DB.vp_question_sets.filter(function (x) { return x.id === SET_OLD; })[0].status = 'archived';
  var session = { id: 'sess-1', venue_id: VENUE, status: 'lobby' };
  return hostStartTrivia({}, json, { question_set_id: SET_OLD, question_count: 2 }, session, { role: 'owner' }, 1);
}).then(function (r) {
  ok('Start answers 404 with a sentence, not a game on a deleted night', r && r._status === 404 && /deleted/.test(String(r._json && r._json.error)), JSON.stringify(r));
  ok('and nothing was written', writes.length === 0, writes.join(' | '));
  done();
}).catch(function (e) {
  print('\nTEST ERROR: ' + e + (e && e.stack ? '\n' + e.stack : ''));
  done(e);
});

function done(err) {
  if (ran !== EXPECT) {
    print('\nONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN' + (err ? '' : ' and nothing reported why') + '. The rest were skipped, not passed.');
    throw new Error('incomplete: ' + ran + '/' + EXPECT);
  }
  if (bad || err) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw (err || new Error(bad + ' failed')); }
  print('\nALL ' + EXPECT + ' CHECKS PASSED');
}
