/* THE QUESTION COUNT A HOST SEES MUST BE THE COUNT THEY CAN ACTUALLY PLAY.

   retagSetCount fetched every row of a set just to read .length, and counted PARKED
   questions. The draw filters parked_at=is.null, so a parked question can never come
   up. On 19 Sep 2026 "General Knowledge" advertised 1,169 questions when 1,158 were
   playable: one set of thirty, wrong by exactly the 11 parked rows in the table.

   This RUNS the shipped retagSetCount and sbCount out of the Worker against a fake
   PostgREST, and asserts what it WROTE.

   Run:  jsc tools/test-set-count.js
*/
var W = readFile('venueplay-backend/worker/venueplay-game.js');
if (!W || W.length < 1000) throw new Error('could not read venueplay-game.js');

function lift(name) {
  /* Cut the function out by name: from its declaration to the first line that is a
     lone closing brace at column 0. Written with indexOf rather than a built regex,
     because escaping a regex through a shell heredoc is its own small disaster. */
  var start = W.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error(name + ' is not in the Worker any more');
  var end = W.indexOf('\n}', start);
  if (end === -1) throw new Error('could not find the end of ' + name);
  return W.slice(start, end + 2);
}

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

var ENV = { SUPABASE_URL: 'https://db', SUPABASE_SERVICE_KEY: 'k' };
var asked = [], patched = [], RANGE = '0-0/0', HEAD_OK = true;

function sbHeaders() { return {}; }
function dbError(op, table, why) { return new Error(op + ' ' + table + ' ' + why); }
function enc(x) { return encodeURIComponent(String(x)); }
function sbPatch(env, table, q, body) { patched.push({ table: table, q: q, body: body }); return Promise.resolve({}); }
/* If retagSetCount ever goes back to fetching rows, this blows up rather than
   quietly passing: a count must not read rows. */
function sbGetAll() { throw new Error('retagSetCount fetched rows instead of counting'); }

function fetch(url, opts) {
  asked.push({ url: url, method: opts && opts.method, prefer: opts && opts.headers && opts.headers.Prefer });
  return Promise.resolve({
    ok: HEAD_OK,
    headers: { get: function (h) { return h.toLowerCase() === 'content-range' ? RANGE : null; } }
  });
}

eval(lift('sbCount'));
eval(lift('retagSetCount'));

print('The advertised count must be the playable count');
print('');

RANGE = '0-0/1158';
retagSetCount(ENV, 'set-1').then(function () {
  check('it writes the number PostgREST counted', patched.length === 1 &&
        patched[0].body.question_count === 1158, patched[0] && patched[0].body);
  check('it EXCLUDES parked questions', /parked_at=is\.null/.test(asked[0].url), asked[0].url);
  check('it asks with HEAD and count=exact, reading no rows',
        asked[0].method === 'HEAD' && asked[0].prefer === 'count=exact', asked[0]);
  check('it asks about the right set', /set_id=eq\.set-1/.test(asked[0].url), asked[0].url);
  check('and it patches the right row', /id=eq\.set-1/.test(patched[0].q), patched[0].q);

  asked = []; patched = []; RANGE = '*/0';
  return retagSetCount(ENV, 'empty-set');
}).then(function () {
  check('an empty set writes 0, not nothing',
        patched.length === 1 && patched[0].body.question_count === 0, patched[0] && patched[0].body);

  /* A count bigger than one page must not truncate. Fetching rows could; counting cannot. */
  asked = []; patched = []; RANGE = '0-0/37665';
  return retagSetCount(ENV, 'huge');
}).then(function () {
  check('a set past the 1,000-row ceiling is not truncated',
        patched[0].body.question_count === 37665, patched[0].body);

  /* FAIL CLOSED: an unreadable header must not become a zero written over a real count. */
  asked = []; patched = []; RANGE = 'nonsense';
  return retagSetCount(ENV, 'broken').then(
    function () { return 'no throw'; }, function () { return 'threw'; });
}).then(function (r) {
  check('a header it cannot read throws, and writes NOTHING', r === 'threw' && !patched.length,
        { r: r, patched: patched.length });

  asked = []; patched = []; RANGE = '0-0/5'; HEAD_OK = false;
  return retagSetCount(ENV, 'down').then(
    function () { return 'no throw'; }, function () { return 'threw'; });
}).then(function (r) {
  check('a failed request throws, and writes NOTHING', r === 'threw' && !patched.length,
        { r: r, patched: patched.length });
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
}).catch(function (e) { print('ERROR ' + e); throw e; });
