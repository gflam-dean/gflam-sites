/* TRIVIA LIBRARY QUESTIONS: SWAP AND REMOVE, NEVER EDIT (Dean, 5 Nov 2026, item 45c).

   A host could edit a library question and its answers. They must not: library questions get a SWAP (another library
   question of the same category and difficulty) and a remove, nothing else, and what a host writes is the venue's own.

   This lifts the REAL handlers out of the real Worker and runs the attacks a venue could make by calling the routes
   directly (no page involved), against a database stand-in that answers like the real one:
     - the shared library rows can never be changed through any of the routes (update, swap, remove, add): 403, and
       the library is byte for byte what it was
     - a venue's COPY of a library question cannot be edited by a direct call (reword it, change its answers): 403
     - if the library cannot be checked, the edit is refused (fails closed), not let through
     - another venue's questions are out of reach
     - a question the host wrote is still theirs to edit
     - swap: same category and difficulty, a different question that is not already in the night, in the same place;
       never for a host's own question, a question already played, a night with a round running, or a library row;
       and the library is never written to
   Run: jsc venueplay-backend/worker/trivia-library-swap.test.js */
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
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }
function json(o, status) { return { _json: o, _status: status || 200 }; }

var VENUE = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
var S_LIB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', S_NIGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', S_THEIRS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', S_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
function qid(n) { return 'bbbbbbbb-bbbb-4bbb-8bbb-' + ('000000000000' + n).slice(-12); }
function Q(n, set, seq, text, cat, diff, ok_) { return { id: qid(n), set_id: set, seq: seq, question: text, options: [text + ' A', text + ' B', text + ' C', text + ' D'], correct_index: ok_ || 0, category: cat, difficulty: diff, image_url: null, parked_at: null }; }
var DB, writes, libraryDown, staffAsked;
var S_FAKE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
function base() {
  writes = []; staffAsked = []; libraryDown = false; noFromLibraryColumn = false;
  DB = {
    vp_question_sets: [
      { id: S_LIB, owner_venue_id: null, visibility: 'library', title: 'Geography', question_count: 7, status: 'active' },
      { id: S_NIGHT, owner_venue_id: VENUE, visibility: 'private', title: 'Friday night', question_count: 5, status: 'active' },
      { id: S_THEIRS, owner_venue_id: OTHER, visibility: 'private', title: 'Their night', question_count: 1, status: 'active' },
      { id: S_LIVE, owner_venue_id: VENUE, visibility: 'private', title: 'On now', question_count: 1, status: 'active' },
    ],
    vp_questions: [
      // listed FIRST so a swap that ignored the category, or the fact-check park, would pick one of these
      Q(7, S_LIB, 7, 'Who directed Jaws', 'Movies', 'easy', 0),
      (function () { var q = Q(8, S_LIB, 8, 'Capital of Chile', 'Geography', 'easy', 2); q.parked_at = '2026-11-01T00:00:00Z'; return q; })(),
      Q(1, S_LIB, 1, 'Capital of France', 'Geography', 'easy', 1), Q(2, S_LIB, 2, 'Capital of Spain', 'Geography', 'easy', 2),
      Q(3, S_LIB, 3, 'Capital of Italy', 'Geography', 'easy', 3), Q(4, S_LIB, 4, 'Longest river in Africa', 'Geography', 'hard', 0),
      Q(5, S_LIB, 5, 'Capital of Peru', 'Geography', 'medium', 1),
      // the venue's night: copies of library questions (same words), plus one the host wrote
      Q(11, S_NIGHT, 1, 'Capital of France', 'Geography', 'easy', 1),      // copy of 1
      Q(12, S_NIGHT, 2, 'Longest river in Africa', 'Geography', 'hard', 0), // copy of 4, already played
      Q(13, S_NIGHT, 3, 'Capital of Spain', 'Geography', 'easy', 2),       // copy of 2
      Q(14, S_NIGHT, 4, 'Our pub was built in which year', 'Local', 'medium', 0),   // the host's own
      Q(15, S_NIGHT, 5, 'Capital of Peru', 'Geography', 'medium', 1),      // copy of 5: no other medium Geography exists
      Q(21, S_THEIRS, 1, 'Their secret question', 'Local', 'easy', 0),
      Q(31, S_LIVE, 1, 'Capital of France', 'Geography', 'easy', 1),
    ],
    vp_question_submissions: [],
    vp_trivia_games: [{ game_id: 'g-live', question_set_id: S_LIVE }],
    vp_games: [{ id: 'g-live', status: 'running' }],
    vp_trivia_answers: [{ game_id: 'g-old', question_id: qid(12) }],
  };
}
function parse(q) { var m = {}; String(q).split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) m[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return m; }
function unq(x) { return x.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
function rowsFor(table, q) {
  if (libraryDown && table === 'vp_questions' && /in\.\(/.test(q) && /question=in/.test(q)) throw new Error('database unreachable');
  var f = parse(q), rows = (DB[table] || []).slice();
  Object.keys(f).forEach(function (k) {
    if (k === 'select' || k === 'limit' || k === 'order' || k === 'offset') return;
    var v = f[k];
    if (v === 'is.null') rows = rows.filter(function (r) { return r[k] == null; });
    else if (v.indexOf('eq.') === 0) { var val = v.slice(3); rows = rows.filter(function (r) { return String(r[k]) === val; }); }
    else if (v.indexOf('in.(') === 0) { var l = v.slice(4, -1).split(/,(?=")|,(?=[0-9a-f]{8}-)/).map(unq); rows = rows.filter(function (r) { return l.indexOf(String(r[k])) >= 0; }); }
    else throw new Error('stand-in cannot filter ' + k + '=' + v);
  });
  return rows;
}
var enc = encodeURIComponent;
function sbGet(env, table, q) { var r = rowsFor(table, q), f = parse(q); if (f.limit) r = r.slice(0, +f.limit); return Promise.resolve(r); }
function sbGetAll(env, table, q) { return Promise.resolve(rowsFor(table, q)); }
function sbCount(env, table, q) { return Promise.resolve(rowsFor(table, q).length); }
function sbPatch(env, table, filter, obj) {
  writes.push({ op: 'PATCH', table: table, filter: filter, obj: obj });
  rowsFor(table, filter).forEach(function (r) { Object.keys(obj).forEach(function (k) { r[k] = obj[k]; }); });
  return Promise.resolve([]);
}
var noFromLibraryColumn = false;   // before migration 169: the database has no such column and refuses the insert
function sbInsert(env, table, rows) { if (noFromLibraryColumn && rows.some(function (r) { return 'from_library' in r; })) return Promise.reject(httpError(502, 'column from_library does not exist')); writes.push({ op: 'INSERT', table: table, n: rows.length, rows: rows.map(function (r) { return JSON.parse(JSON.stringify(r)); }) }); rows.forEach(function (r) { r.id = 'new-' + DB[table].length; DB[table].push(r); }); return Promise.resolve(rows); }
function sbDelete(env, table, filter) { writes.push({ op: 'DELETE', table: table, filter: filter }); var gone = rowsFor(table, filter); DB[table] = DB[table].filter(function (r) { return gone.indexOf(r) < 0; }); return Promise.resolve(); }
function randInt(n) { return 0; }           // deterministic: the first candidate
function verifyHostJwt() { return Promise.resolve('user-1'); }
function readJson(req) { return Promise.resolve(req._body || {}); }
function requireStaff(env, authUserId, venueId) {
  staffAsked.push(venueId);
  if (venueId !== VENUE) return Promise.reject(httpError(403, 'Not staff at this venue'));
  return Promise.resolve({ venue_id: venueId, role: 'owner' });
}
URL = function (u) { this.searchParams = { get: function (k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(u); return m ? decodeURIComponent(m[1]) : null; } }; };
(0, eval)((/const UUID_RE = [^\n]+/.exec(src) || [''])[0].replace(/^const /, 'var '));
['httpError', 'assertUuid', 'insertQuestionRows', 'triviaSetForVenue', 'nextTriviaSeq', 'sanitizeQuestion', 'libraryTextsAmong', 'randomWindow', 'handleTriviaUpdate', 'handleTriviaSwap', 'handleTriviaRemove', 'handleTriviaAdd', 'handleTriviaSetQuestions', 'handleTriviaFromLibrary']
  .forEach(function (n) { (0, eval)(lift(n)); });
function retagSetCount() { return Promise.resolve(); }
function call(h, body, url) { return h({ _body: body, url: url }, {}, json).then(function (r) { return r; }, function (e) { return { _status: e.status, _json: { error: e.message }, _thrown: true }; }); }
function snap(table, id) { return JSON.stringify(DB[table].filter(function (r) { return r.id === id; })[0]); }
function libSnap() { return JSON.stringify(DB.vp_questions.filter(function (r) { return r.set_id === S_LIB; })) + JSON.stringify(DB.vp_question_sets.filter(function (r) { return r.id === S_LIB; })); }
function writesTo(id) { return writes.filter(function (w) { return (w.filter || '').indexOf(id) >= 0; }).length; }
var EDIT = { question_id: null, question: 'Capital of Mars', options: ['x', 'y', 'z', 'w'], correct_index: 2, category: 'Geography', difficulty: 'easy' };
function edit(id, over) { var b = JSON.parse(JSON.stringify(EDIT)); b.question_id = id; Object.keys(over || {}).forEach(function (k) { b[k] = over[k]; }); return b; }

var P = Promise.resolve();
function step(f) { P = P.then(f); var q = { then: function (a, b) { P = P.then(a, b); return q; } }; return q; }   // .then(...) chained on a step runs right after it

step(function () { print('== ATTACK 1: edit the shared library row itself, by a direct call =='); base(); var before = libSnap();
  return call(handleTriviaUpdate, edit(qid(1))).then(function (r) {
    ok('update on a shared library question: 403, "a library set"', r._status === 403 && /library set/.test(r._json.error), JSON.stringify(r));
    ok('the library is byte for byte what it was, and nothing was written', libSnap() === before && writes.length === 0, JSON.stringify(writes));
  }); });
step(function () { base(); var before = libSnap();
  return call(handleTriviaSwap, { question_id: qid(1) }).then(function (r) {
    ok('swap on a shared library row: 403', r._status === 403 && writes.length === 0 && libSnap() === before, JSON.stringify(r));
    return call(handleTriviaRemove, { question_id: qid(1) });
  }).then(function (r) {
    ok('remove on a shared library row: 403, and the row is still there', r._status === 403 && libSnap() === before && !writes.some(function (w) { return w.op === 'DELETE'; }), JSON.stringify(r));
    return call(handleTriviaAdd, { set_id: S_LIB, questions: [{ question: 'Injected', options: ['a', 'b', 'c', 'd'], correct_index: 0 }] });
  }).then(function (r) {
    ok('adding a question INTO the library set: 403, nothing inserted', r._status === 403 && !writes.some(function (w) { return w.op === 'INSERT'; }) && libSnap() === before, JSON.stringify(r));
    return call(handleTriviaFromLibrary, { set_id: S_LIB, count: 3 });
  }).then(function (r) {
    ok('"from the library" into the library set itself: 403', r._status === 403 && libSnap() === before, JSON.stringify(r));
  }); });

step(function () { print('\n== ATTACK 2: edit the venue\'s COPY of a library question (reword it, change its answers) =='); base();
  var before = snap('vp_questions', qid(11));
  return call(handleTriviaUpdate, edit(qid(11))).then(function (r) {
    ok('update on a copy of a library question: 403 with a sentence that says what to do instead', r._status === 403 && /Library questions cannot be edited/.test(r._json.error) && /Swap/.test(r._json.error) && r._json.code === 'library_question', JSON.stringify(r));
    ok('the copy is unchanged and no write was made', snap('vp_questions', qid(11)) === before && writes.length === 0, JSON.stringify(writes));
    return call(handleTriviaUpdate, edit(qid(11), { question: 'Capital of France', correct_index: 3 }));
  }).then(function (r) {
    ok('changing ONLY the answers (same words, different right answer) is refused too', r._status === 403 && snap('vp_questions', qid(11)) === before, JSON.stringify(r));
    return call(handleTriviaUpdate, edit(qid(12)));
  }).then(function (r) {
    ok('so is a copy that has been played', r._status === 403 && writes.length === 0, JSON.stringify(r));
  }); });
step(function () { base(); libraryDown = true; var before = snap('vp_questions', qid(11));
  return call(handleTriviaUpdate, edit(qid(11))).then(function (r) {
    ok('FAILS CLOSED: when the library cannot be checked, the edit is refused (503), not let through', r._status === 503 && snap('vp_questions', qid(11)) === before && writes.length === 0, JSON.stringify(r));
    return call(handleTriviaSwap, { question_id: qid(11) });
  }).then(function (r) {
    ok('and so is a swap', r._status === 503 && writes.length === 0, JSON.stringify(r));
  }); });
step(function () { print('\n== the locks that were already there =='); base(); var before = snap('vp_questions', qid(21));
  return call(handleTriviaUpdate, edit(qid(21))).then(function (r) {
    ok('another venue\'s question: 403 from the staff check, nothing written', r._status === 403 && writes.length === 0 && snap('vp_questions', qid(21)) === before, JSON.stringify(r));
    return call(handleTriviaSwap, { question_id: qid(21) });
  }).then(function (r) {
    ok('swap on another venue\'s question: 403', r._status === 403 && writes.length === 0, JSON.stringify(r));
    return call(handleTriviaUpdate, { question_id: 'not-a-uuid', question: 'x' });
  }).then(function (r) {
    ok('a made-up question id: refused, nothing written', r._status === 400 && writes.length === 0, JSON.stringify(r));
  }); });

step(function () { print('\n== a question the host created is still theirs to edit =='); base();
  return call(handleTriviaUpdate, edit(qid(14), { question: 'Our pub was built in which decade', category: 'Local', difficulty: 'medium' })).then(function (r) {
    var row = DB.vp_questions.filter(function (q) { return q.id === qid(14); })[0];
    ok('editing their own question works (200)', r._status === 200 && r._json.ok === true, JSON.stringify(r));
    ok('the words and answers changed', row.question === 'Our pub was built in which decade' && row.options[0] === 'x' && row.correct_index === 2, JSON.stringify(row));
    ok('and the library was not touched', libSnap() === JSON.stringify(DB.vp_questions.filter(function (r) { return r.set_id === S_LIB; })) + JSON.stringify(DB.vp_question_sets.filter(function (r) { return r.id === S_LIB; })) && writes.every(function (w) { return w.table === 'vp_questions' && w.filter.indexOf(qid(14)) >= 0; }), JSON.stringify(writes));
  }); });
step(function () { print('\n== the screen and the server agree on which questions are the library\'s =='); base();
  return call(handleTriviaSetQuestions, null, 'https://x/host/trivia/set/questions?set=' + S_NIGHT).then(function (r) {
    var by = {}; (r._json.questions || []).forEach(function (q) { by[q.id] = q.own; });
    ok('copies of library questions come back own:false, the host\'s own question own:true', by[qid(11)] === false && by[qid(13)] === false && by[qid(14)] === true, JSON.stringify(by));
  }); });

step(function () { print('\n== SWAP: another library question, same category and difficulty, same place =='); base();
  var libBefore = libSnap(), old = DB.vp_questions.filter(function (q) { return q.id === qid(11); })[0], oldSeq = old.seq;
  return call(handleTriviaSwap, { question_id: qid(11) }).then(function (r) {
    var row = DB.vp_questions.filter(function (q) { return q.id === qid(11); })[0];
    ok('swap answers 200 with the new question', r._status === 200 && r._json.ok === true && r._json.question && r._json.question.id === qid(11), JSON.stringify(r));
    ok('it is Geography, easy, and not the question it replaced: Spain is already in the night, so the only free one is "Capital of Italy"',
       row.question === 'Capital of Italy' && row.category === 'Geography' && row.difficulty === 'easy', JSON.stringify(row));
    ok('same place in the night (same id, same seq), and the answers came with it (the right answer is the library\'s)', row.seq === oldSeq && row.options[row.correct_index] === row.question + ' ' + 'ABCD'[row.correct_index], JSON.stringify(row));
    ok('the new question is not one already in the night twice', DB.vp_questions.filter(function (q) { return q.set_id === S_NIGHT && q.question === row.question; }).length === 1);
    ok('the library was NOT written to: one PATCH, on the venue\'s own row, and the library is byte for byte the same', writes.length === 1 && writes[0].filter.indexOf(qid(11)) >= 0 && libSnap() === libBefore, JSON.stringify(writes));
  }); });
step(function () { base();   // make France the only free easy Geography
  DB.vp_questions = DB.vp_questions.filter(function (q) { return q.id !== qid(3) && q.id !== qid(2); });
  DB.vp_questions = DB.vp_questions.filter(function (q) { return q.id !== qid(13); });
  return call(handleTriviaSwap, { question_id: qid(11) }).then(function (r) {
    ok('when there is no other easy Geography library question outside the night, it says so (404) and changes nothing', r._status === 404 && /no other easy Geography/.test(r._json.error) && writes.length === 0, JSON.stringify(r));
  }); });
step(function () { base();
  return call(handleTriviaSwap, { question_id: qid(15) }).then(function (r) {
    ok('a lone medium Geography question has nothing to swap to: 404, unchanged', r._status === 404 && writes.length === 0, JSON.stringify(r));
    return call(handleTriviaSwap, { question_id: qid(14) });
  }).then(function (r) {
    ok('swap on a question the host created: 409 "Only library questions can be swapped", unchanged', r._status === 409 && /Only library questions/.test(r._json.error) && r._json.code === 'not_library' && writes.length === 0, JSON.stringify(r));
    return call(handleTriviaSwap, { question_id: qid(12) });
  }).then(function (r) {
    ok('swap on a question already played in a past round: 409, kept for the results', r._status === 409 && /already been played/.test(r._json.error) && writes.length === 0, JSON.stringify(r));
    return call(handleTriviaSwap, { question_id: qid(31) });
  }).then(function (r) {
    ok('swap on a night with a round running: 409, finish the round first', r._status === 409 && /running/.test(r._json.error) && writes.length === 0, JSON.stringify(r));
  }); });
step(function () { base();
  DB.vp_questions.filter(function (q) { return q.id === qid(11); })[0].category = null;
  return call(handleTriviaSwap, { question_id: qid(11) }).then(function (r) {
    ok('a library copy with no category on record: 409 with a sentence, nothing guessed', r._status === 409 && /no category/.test(r._json.error) && writes.length === 0, JSON.stringify(r));
  }); });
step(function () { print('\n== removing a library question is still allowed =='); base();
  return call(handleTriviaRemove, { question_id: qid(13) }).then(function (r) {
    ok('remove on a venue copy of a library question: 200, only that row deleted', r._status === 200 && !DB.vp_questions.some(function (q) { return q.id === qid(13); }) && DB.vp_questions.some(function (q) { return q.id === qid(1); }), JSON.stringify(r));
  }); });

step(function () { print('\n== migration 169 and the Worker agree: library copies are marked, and the database refuses a direct edit =='); base();
  var sql = find('venueplay-backend/supabase/venueplay-169-library-questions-read-only.sql'), md = find('venueplay-backend/supabase/MIGRATIONS.md');
  ok('the migration file exists, is numbered 169 and says NOT RUN', /Migration 169/.test(sql) && /NOT RUN/.test(sql) && /venueplay-169-library-questions-read-only\.sql/.test(md) && /NOT RUN/.test(md.slice(md.indexOf('venueplay-169-'))));
  ok('it adds vp_questions.from_library (boolean, not null, default false) and backfills the existing copies by exact words, for venue-owned sets only',
     /add column if not exists from_library boolean not null default false/.test(sql) && /set from_library = true/.test(sql) && /owner_venue_id is not null/.test(sql) && /l\.question = q\.question/.test(sql));
  var pol = /create policy vp_questions_host_write on vp_questions([\s\S]*?);\s*\n\s*\ndrop policy/.exec(sql + '\n\ndrop policy');
  var qp = (/create policy vp_questions_host_write on vp_questions([\s\S]*?)drop policy if exists vp_question_sets_host_write/.exec(sql) || [])[1] || '';
  ok('the venue write rule on questions refuses a from_library row in BOTH the old row (using) and the new row (with check): no direct edit, delete, or marking a copy as its own',
     /using \(\s*from_library = false/.test(qp) && /with check \(\s*from_library = false/.test(qp) && /for all to authenticated/.test(qp));
  var sp = (/create policy vp_question_sets_host_write on vp_question_sets([\s\S]*?);/.exec(sql) || [])[1] || '';
  ok('the venue write rule on sets forces visibility = \'private\': a venue can never put its own set into the library', /with check \([^;]*visibility = 'private'/.test(sp));
  ok('the old rules are dropped first (a policy left behind would still allow the edit), and reads are not touched', /drop policy if exists vp_questions_host_write/.test(sql) && /drop policy if exists vp_question_sets_host_write/.test(sql) && !/host_select/.test(sql.replace(/--[^\n]*/g, '')));
  ok('no grant or revoke is changed (RLS does the refusing)', !/\b(grant|revoke)\b/i.test(sql.replace(/--[^\n]*/g, '')));
  ok('the migration has a read-back and a rollback', /Read back/.test(sql) && /Rollback/.test(sql));
  return call(handleTriviaFromLibrary, { set_id: S_NIGHT, category: 'Geography', count: 2 });
}).then(function (r) {
  var ins = writes.filter(function (w) { return w.op === 'INSERT' && w.table === 'vp_questions'; })[0];
  ok('"From the library" marks every copy from_library: true', r._status === 200 && ins && ins.rows.length > 0 && ins.rows.every(function (x) { return x.from_library === true && x.set_id === S_NIGHT; }), JSON.stringify(r));
  base(); noFromLibraryColumn = true;
  return call(handleTriviaFromLibrary, { set_id: S_NIGHT, category: 'Geography', count: 2 });
}).then(function (r) {
  var ins = writes.filter(function (w) { return w.op === 'INSERT' && w.table === 'vp_questions'; })[0];
  ok('before 169 has run (no such column) it retries without the column and the host still gets their questions', r._status === 200 && ins && ins.rows.every(function (x) { return !('from_library' in x); }), JSON.stringify(r));
}); 
step(function () { print('\n== a question a VENUE writes stays at that venue until we approve it =='); base();
  DB.vp_question_sets.push({ id: S_FAKE, owner_venue_id: OTHER, visibility: 'library', title: 'Geography', question_count: 1, status: 'active' });   // another venue pushed its own set to "library" by writing the database directly
  DB.vp_questions.push(Q(41, S_FAKE, 1, 'Their secret library question', 'Geography', 'easy', 0));
  return call(handleTriviaAdd, { set_id: S_NIGHT, questions: [{ question: 'Which pub is oldest here', options: ['a', 'b', 'c', 'd'], correct_index: 1, category: 'Local', difficulty: 'easy' }] }).then(function (r) {
    var ins = writes.filter(function (w) { return w.op === 'INSERT' && w.table === 'vp_questions'; })[0], sub = DB.vp_question_submissions[0];
    ok('Create your own: the question is written to THIS venue\'s night only, not marked as a library copy', r._status === 200 && ins && ins.rows.length === 1 && ins.rows[0].set_id === S_NIGHT && ins.rows[0].from_library !== true, JSON.stringify(writes));
    ok('and no write at all touches a library set', !writes.some(function (w) { return w.op === 'INSERT' && w.rows && w.rows.some(function (x) { return x.set_id === S_LIB || x.set_id === S_FAKE; }); }));
    ok('it is queued for the Monday review as pending, with this venue named', sub && sub.status === 'pending' && sub.venue_id === VENUE && sub.question === 'Which pub is oldest here', JSON.stringify(DB.vp_question_submissions));
    return call(handleTriviaFromLibrary, { set_id: S_NIGHT, category: 'Geography', count: 50 });
  }).then(function (r) {
    var copied = DB.vp_questions.filter(function (q) { return q.set_id === S_NIGHT; }).map(function (q) { return q.question; });
    ok('"From the library" never serves another venue\'s question, even from a set that venue marked "library" itself (library sets must have no owner)', r._status === 200 && copied.indexOf('Their secret library question') < 0 && copied.indexOf('Which pub is oldest here') >= 0, JSON.stringify(copied));
    return call(handleTriviaSwap, { question_id: qid(11) });
  }).then(function (r) {
    var row = DB.vp_questions.filter(function (q) { return q.id === qid(11); })[0];
    ok('and a swap never brings it in either', row.question !== 'Their secret library question', JSON.stringify(row));
    var lt = null; return libraryTextsAmong({}, ['Their secret library question', 'Capital of France']).then(function (set) {
      ok('a set a venue called "library" does not make its questions count as library questions (only ownerless sets do)', !set.has('Their secret library question') && set.has('Capital of France'), JSON.stringify(Array.from(set)));
    });
  }).then(function () {
    var resolve = src.slice(src.indexOf('async function handleAdminResolve('), src.indexOf('async function handleAdminResolve(') + 900);
    ok('the ONLY way into the library is the approval route, which needs our admin key (the weekly review)', /ADMIN_KEY|adminKeyRefusal\(request, env, b, json\)/.test(resolve) && /status === 'approved'/.test(resolve) && /owner_venue_id=is\.null/.test(resolve), resolve.slice(0, 300));
    ok('every Worker read of "the library" asks for ownerless library sets', (src.match(/visibility=eq\.library/g) || []).length === (src.match(/visibility=eq\.library&owner_venue_id=is\.null/g) || []).length);
  }); });

step(function () { print('\n== Undo after removing a library question puts it back as a library copy, not as the host\'s own =='); base();
  return call(handleTriviaAdd, { set_id: S_NIGHT, questions: [{ question: 'Capital of Spain', options: ['Capital of Spain A', 'b', 'c', 'd'], correct_index: 0, category: 'Geography', difficulty: 'easy' }] }).then(function (r) {
    var ins = writes.filter(function (w) { return w.op === 'INSERT' && w.table === 'vp_questions'; })[0];
    ok('a question whose words are in the library is written marked from_library, and is not queued for review as the host\'s own', r._status === 200 && ins.rows[0].from_library === true && DB.vp_question_submissions.length === 0, JSON.stringify(writes));
  }); });

P.then(function () {
  print('\n' + ran + ' checks, ' + bad + ' failed');
  if (bad) throw new Error('trivia library swap: ' + bad + ' of ' + ran + ' failed');
  print('ALL ' + ran + ' CHECKS PASSED');
}, function (e) { print('TEST ERROR: ' + e + (e && e.stack ? '\n' + e.stack : '')); throw e; });
