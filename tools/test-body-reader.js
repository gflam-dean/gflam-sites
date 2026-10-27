/* A BAD REQUEST BODY MUST SAY SO, NOT RETURN 500.

   Sixteen handlers in the billing Worker did a bare `await request.json()`, which
   rejects on a malformed body. Nothing crashed, because the fetch handler has a
   top-level catch, but the caller got "Something went wrong" with a 500. That reads
   as our fault and says nothing useful, and it is almost always OUR front end sending
   the bad body, so a 500 is the least helpful way to find out.

   This RUNS vpaBody out of the shipped Worker against real Request objects.

   Run:  jsc tools/test-body-reader.js
*/
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
if (!SRC || SRC.length < 1000) throw new Error('could not read venueplay-api-FULL.js');

var m = /async function vpaBody\(request, json\) \{[\s\S]*?\n\}/.exec(SRC);
if (!m) throw new Error('vpaBody is not in the Worker any more');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* A stand-in for the Worker's json() helper: records what status it was asked for.

   NOTE there is deliberately no Response class here. vpaBody must NOT depend on
   `instanceof Response`: Cloudflare has Response as an ambient global and jsc does not,
   so the first version of this threw a ReferenceError inside every money test that
   drives these handlers. If this test ever needs a Response to exist, the Worker has
   gone back to that mistake. */
var lastStatus = null, lastBody = null;
function json(obj, status) {
  lastStatus = status; lastBody = obj;
  return { _isJsonResponse: true, status: status, body: obj };
}

function req(text, throwIt) {
  return { text: function () {
    return throwIt ? Promise.reject(new Error('stream broke')) : Promise.resolve(text);
  } };
}

eval(m[0]);

function run(label, body, expect, throwIt) {
  lastStatus = null;
  return vpaBody(req(body, throwIt), json).then(function (out) {
    if (expect === 400) {
      check(label + ' -> refused, not passed through',
            !!out && out.ok === false && !!out.res, out);
      check(label + ' -> a clean 400, not a 500', lastStatus === 400, lastStatus);
      check(label + ' -> and says what was wrong',
            !!(lastBody && lastBody.error && lastBody.error.length > 10), lastBody);
    } else {
      check(label + ' -> accepted', !!out && out.ok === true, out);
      if (expect !== null) {
        check(label + ' -> the value came through',
              JSON.stringify(out.body) === JSON.stringify(expect), out.body);
      }
    }
  });
}

print('A malformed body must produce a 400 that explains itself');
print('');

run('a normal object', '{"a":1}', { a: 1 })
  .then(function () { return run('an empty string (a bare POST)', '', {}); })
  .then(function () { return run('whitespace only', '   \n ', {}); })
  .then(function () { return run('truncated json', '{"a":', 400); })
  .then(function () { return run('not json at all', 'hello', 400); })
  .then(function () { return run('a bare string', '"hello"', 400); })
  .then(function () { return run('a bare number', '42', 400); })
  /* null.foo is a CRASH, not a 400, so null must be refused rather than passed on. */
  .then(function () { return run('literal null', 'null', 400); })
  /* An array has no named properties either: b.email would be undefined for ever. */
  .then(function () { return run('an array', '[1,2,3]', 400); })
  .then(function () { return run('a body that cannot be read at all', '', 400, true); })
  /* THE GAME WORKER TOO (14 Oct 2026). Its readJson only caught unparseable text, so a body
     of `null` reached /join, /session and nine more as null and every one answered 500. Run
     its real readJson and httpError against the same shapes. */
  .then(function () {
    print('');
    print('The game Worker refuses the same shapes');
    var G = readFile('venueplay-backend/worker/venueplay-game.js');
    var rj = /async function readJson\(request\) \{[\s\S]*?\n\}/.exec(G);
    var he = /function httpError\(status, message\) \{[\s\S]*?\n\}/.exec(G);
    if (!rj || !he) { check('the game Worker still has readJson and httpError', false); return; }
    var readJson = (new Function(he[0] + rj[0] + '; return readJson;'))();
    function g(label, text, ok) {
      return readJson({ json: function () { return Promise.resolve().then(function () { return JSON.parse(text); }); } })
        .then(function (b) { check('game: ' + label + (ok ? ' -> accepted' : ' -> refused'), ok && b && typeof b === 'object', b); },
              function (e) { check('game: ' + label + (ok ? ' -> accepted' : ' -> a 400, not a 500'), !ok && e && e.status === 400, e && e.status); });
    }
    return g('a normal object', '{"code":"ABC"}', true)
      .then(function () { return g('literal null', 'null', false); })
      .then(function () { return g('a bare number', '42', false); })
      .then(function () { return g('a bare string', '"x"', false); })
      .then(function () { return g('an array', '[1]', false); })
      .then(function () { return g('truncated json', '{"a":', false); });
  })
  .then(function () {
    print('');
    print(PASS + ' passed, ' + FAIL + ' failed');
    if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
    print('PASS');
  })
  .catch(function (e) { print('ERROR ' + e); throw e; });
