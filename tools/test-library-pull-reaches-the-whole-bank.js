/* "Add 20 General Knowledge" ten weeks running. How much of the bank does a venue ever see?

   Runs the REAL handleTriviaFromLibrary and handleTriviaSearch out of the shipped game
   Worker against the rig's fake database. Before the fix both read the first N rows in
   table order and shuffled those, so a venue pulling from one category every week drew from
   the same 100 questions out of thousands, and a question parked for a fact-check was still
   dealt by the library pull (the search already excluded it).

   Run from the repo root:  jsc tools/test-library-pull-reaches-the-whole-bank.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var LIB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', SET = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
function qid(i) { return 'dddddddd-dddd-4ddd-8ddd-' + ('000000000000' + i).slice(-12); }
DB.vp_question_sets = [
  { id: LIB, visibility: 'library', title: 'General Knowledge', owner_venue_id: null },
  { id: SET, visibility: 'private', title: 'Tuesday', owner_venue_id: VENUE, question_count: 0 },
];
DB.vp_questions = [];
for (var i = 0; i < 600; i++) {
  DB.vp_questions.push({ id: qid(i), set_id: LIB, seq: i + 1, question: 'Quiz ' + i, options: ['a', 'b', 'c', 'd'], correct_index: 0,
    category: 'General Knowledge', difficulty: 'medium', image_url: null, parked_at: (i % 50 === 7) ? '2026-09-01T00:00:00Z' : null });
}
function added() { return DB.vp_questions.filter(function (r) { return r.set_id === SET; }); }
function reads(table) { return LOG.filter(function (l) { return l.indexOf('GET ' + table) === 0; }).length; }

(async function () {
  print('ten weeks of "add 20 General Knowledge"');
  var seen = {}, weeks = 0, calls = 0, parkedDealt = 0, everySizeRight = true;
  for (var w = 0; w < 10; w++) {
    BODY = { set_id: SET, category: 'General Knowledge', count: 20 };
    LOG.length = 0;
    var r = await handleTriviaFromLibrary({}, ENV, json);
    calls += LOG.length;
    if (r.status !== 200 || r.body.added !== 20) everySizeRight = false;
    weeks++;
    added().forEach(function (q) { seen[q.question] = 1; if ((+q.question.slice(5)) % 50 === 7) parkedDealt++; });
    DB.vp_questions = DB.vp_questions.filter(function (q) { return q.set_id !== SET; });   // next week starts a fresh set
  }
  var distinct = Object.keys(seen).length, past100 = Object.keys(seen).filter(function (k) { return +k.slice(5) >= 100; }).length;
  show('every week adds exactly the twenty asked for', everySizeRight && weeks === 10);
  show('ten weeks reach well past the first hundred rows of the bank', past100 >= 60, past100 + ' of ' + distinct + ' distinct questions came from beyond row 100');
  show('the weeks are not the same twenty over and over', distinct >= 120, distinct + ' distinct across 200 dealt');
  show('a question parked for a fact-check is never dealt', parkedDealt === 0, parkedDealt + ' parked questions dealt');
  show('one pull costs a count and one window, not a page of the bank', calls / 10 <= 8, (calls / 10) + ' calls per pull');

  print('the keyword search draws from the whole match set too');
  var seen2 = {};
  for (var s = 0; s < 8; s++) {
    BODY = { set_id: SET, query: 'Quiz', count: 20 };
    var r2 = await handleTriviaSearch({}, ENV, json);
    if (r2.status !== 200) { show('search answered', false, JSON.stringify(r2.body)); break; }
    added().forEach(function (q) { seen2[q.question] = 1; });
    DB.vp_questions = DB.vp_questions.filter(function (q) { return q.set_id !== SET; });
  }
  var past120 = Object.keys(seen2).filter(function (k) { return +k.slice(5) >= 120; }).length;
  show('eight searches reach past the first 120 matches', past120 >= 40, past120 + ' beyond row 120');
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('library pull: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');

/* Appended 22 Sep 2026: a picture link is https or it is nothing, on ADD as well as edit. */
(function () {
  var ok1 = sanitizeQuestion({ question: 'Q', options: ['a', 'b', 'c', 'd'], correct_index: 1, image_url: 'https://pics.example/a.jpg' });
  var bad1 = sanitizeQuestion({ question: 'Q', options: ['a', 'b', 'c', 'd'], correct_index: 1, image_url: 'http://pics.example/a.jpg' });
  var bad2 = sanitizeQuestion({ question: 'Q', options: ['a', 'b', 'c', 'd'], correct_index: 1, image_url: 'javascript:alert(1)' });
  show('an https picture link is kept when a question is added', !!ok1 && ok1.image_url === 'https://pics.example/a.jpg');
  show('a plain http picture link is dropped on add, as the edit route always did', !!bad1 && bad1.image_url === null, JSON.stringify(bad1));
  show('a javascript: link never reaches a phone', !!bad2 && bad2.image_url === null, JSON.stringify(bad2));
  if (bad) throw new Error('picture links: failed');
  print('PASS picture links');
})();
