/* HQ MUST SEE EVERY VENUE, AND A HOST MUST STILL COST ONE CALL.

   listVenues() is the venue list behind HQ and behind the venue picker on every
   console. It was unpaged, and PostgREST stops at 1000 rows on this project in
   silence. That is the same fault sbGetAll's header describes: the venue-code map
   read one page, every venue past it resolved to nothing, and their screens said
   "not linked to an account".

   The fix must NOT cost a second round trip on every console boot. This project's
   wall is about fifty REST calls a second and what counts is calls, not rows. So the
   suite asserts BOTH: every venue comes back, and a normal account still costs one
   call.

   Run:  jsc tools/test-venue-list-paged.js
*/
var SRC = readFile('venueplay/app/vp-session.js');
if (!SRC || SRC.length < 1000) throw new Error('could not read vp-session.js');

var start = SRC.indexOf('  function listVenues() {');
if (start === -1) throw new Error('listVenues is not in vp-session.js any more');
var end = SRC.indexOf('\n  }', start);
var BODY = SRC.slice(start, end + 4);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* A fake PostgREST that enforces its own max-rows BELOW what is asked for, which is
   the arrangement a short-page loop cannot survive. */
var SERVER_MAX = 1000, calls;

function makeClient(total) {
  var all = [];
  for (var i = 0; i < total; i++) all.push({ id: 'v' + i, created_at: 'x' });
  return { from: function () {
    var lo = 0, hi = 1e9, wantCount = false;
    var q = {
      /* Second argument is { count: 'exact' }, exactly as supabase-js takes it. The
         count is the TRUE total and is NOT capped by max-rows, which is the whole
         reason this works where guessing the ceiling could not. */
      select: function (cols, opts) { wantCount = !!(opts && opts.count); return q; },
      order: function () { return q; },
      range: function (a, b) { lo = a; hi = b; return q; },
      then: function (fn) {
        calls++;
        /* THE SERVER'S OWN MAX-ROWS SITS AT OR BELOW WHAT WE ASK FOR. That is the
           arrangement the first version of listVenues could not survive: it asked for
           1001 to spot the ceiling and could only ever be handed 1000. */
        var want = Math.min(hi - lo + 1, SERVER_MAX);
        return Promise.resolve(fn({ data: all.slice(lo, lo + want),
                                    count: wantCount ? all.length : null }));
      }
    };
    return q;
  } };
}

function run(total) {
  calls = 0;
  var _c = makeClient(total);
  function getClient() { return _c; }
  var listVenues;
  eval('listVenues = ' + BODY.replace(/^\s*function listVenues\(\)/, 'function ()'));
  return listVenues();
}

print('Every venue comes back, and a host still costs one call');
print('');

run(1).then(function (r) {
  check('one venue comes back', r.length === 1, r.length);
  check('and costs exactly ONE call, not two', calls === 1, calls);
  return run(17);
}).then(function (r) {
  check('seventeen venues, the real number today', r.length === 17, r.length);
  check('still one call', calls === 1, calls);
  return run(999);
}).then(function (r) {
  check('999, just under the ceiling', r.length === 999, r.length);
  check('still one call', calls === 1, calls);
  return run(1000);
}).then(function (r) {
  check('exactly 1000, the ceiling itself', r.length === 1000, r.length);
  return run(1001);
}).then(function (r) {
  check('1001: the one past the ceiling is NOT lost', r.length === 1001, r.length);
  check('and it took more than one call to get it', calls > 1, calls);
  return run(4321);
}).then(function (r) {
  check('4321 venues all come back', r.length === 4321, r.length);
  var ids = {}, dupes = false;
  r.forEach(function (v) { if (ids[v.id]) dupes = true; ids[v.id] = 1; });
  check('with no duplicates and none skipped', !dupes && Object.keys(ids).length === 4321,
        { dupes: dupes, unique: Object.keys(ids).length });
  return run(0);
}).then(function (r) {
  check('an empty account returns empty, not a hang', r.length === 0, r.length);
  check('and costs one call', calls === 1, calls);

  /* THE CASE THAT BROKE THE FIRST VERSION, in its harshest form: the server's own
     max-rows sits WELL BELOW the page size we ask for, so EVERY page comes back
     short. Anything that reads "short" as "finished" truncates here and says nothing.
     This is the arrangement sbGetAll's header warns about, and the reason the ceiling
     is asked for rather than guessed. */
  SERVER_MAX = 400;
  return run(1000);
}).then(function (r) {
  check('a server capping BELOW our page size still returns all 1000', r.length === 1000, r.length);
  var ids = {};
  r.forEach(function (v) { ids[v.id] = 1; });
  check('with every venue distinct', Object.keys(ids).length === 1000, Object.keys(ids).length);
  SERVER_MAX = 1000;
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
}).catch(function (e) { print('ERROR ' + e); throw e; });
