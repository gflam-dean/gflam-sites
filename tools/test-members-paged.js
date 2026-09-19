/* A CLUB OVER 1,000 MEMBERS MUST SEE ALL OF THEM.

   venueplay/app/members/host.html read vp_members with no paging. PostgREST stops at
   1000 rows on this project, silently, so a club with 1,400 members showed the host the
   first 1,000: wrong total on screen, and member 1,200 impossible to find. The draw was
   never wrong, because it runs server side, which is what made this invisible.

   This RUNS the shipped loadAllMembers out of host.html under jsc, against a fake
   PostgREST that enforces a server max-rows BELOW the page size asked for. That is the
   arrangement a short-page loop cannot survive and an empty-page loop can.

   Run:  jsc tools/test-members-paged.js
*/
var HTML = readFile('venueplay/app/members/host.html');
if (!HTML || HTML.length < 1000) throw new Error('could not read members/host.html');

var m = /function loadAllMembers\(ids\)\{[\s\S]*?\n  \}/.exec(HTML);
if (!m) throw new Error('loadAllMembers is not in host.html any more');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* A fake that behaves like PostgREST: it honours range, and it enforces its own
   max-rows which sits BELOW the 1000 the code asks for. If the loop ever stops on a
   short page it will return SERVER_MAX rows and no more. */
var SERVER_MAX = 400;
var calls;

function makeClient(total) {
  var all = [];
  for (var i = 1; i <= total; i++) all.push({ id: 'm' + i, member_number: i, roster_id: 'r1' });
  return {
    from: function () {
      var lo = 0, hi = 1e9;
      var q = {
        select: function () { return q; },
        in: function () { return q; },
        order: function () { return q; },
        range: function (a, b) { lo = a; hi = b; return q; },
        then: function (fn) {
          calls++;
          var want = Math.min(hi - lo + 1, SERVER_MAX);
          var rows = all.slice(lo, lo + want);
          return Promise.resolve(fn({ data: rows }));
        }
      };
      return q;
    }
  };
}

function run(total) {
  calls = 0;
  var client = makeClient(total);
  var loadAllMembers;
  eval(m[0]);
  return loadAllMembers(['r1']);
}

print('A club bigger than one page must still see everyone');
print('');

var done = 0;
function expect(total, label) {
  return run(total).then(function (rows) {
    check(label + ': all ' + total + ' come back', rows.length === total, rows.length);
    var nums = rows.map(function (r) { return r.member_number; });
    var ordered = true, dupes = false, seen = {};
    for (var i = 0; i < nums.length; i++) {
      if (i && nums[i] < nums[i - 1]) ordered = false;
      if (seen[nums[i]]) dupes = true;
      seen[nums[i]] = 1;
    }
    check(label + ': in order, no duplicates, none skipped', ordered && !dupes, 
          { ordered: ordered, dupes: dupes });
    done++;
  });
}

expect(1, 'one member')
  .then(function () { return expect(400, 'exactly one server page'); })
  .then(function () { return expect(1000, 'the old silent ceiling'); })
  .then(function () { return expect(1400, 'a club past the ceiling'); })
  .then(function () { return expect(2500, 'a big club'); })
  .then(function () {
    /* The check that proves the loop is not stopping on a short page. Every page here
       is 400 against a requested 1000, so a short-page loop returns 400 and stops. */
    return run(1400).then(function (rows) {
      check('it did NOT stop on the first short page', rows.length === 1400, rows.length);
      check('and it took several trips to do it', calls >= 4, calls);
    });
  })
  .then(function () {
    /* An empty club must not loop for ever. */
    return run(0).then(function (rows) {
      check('an empty members list returns empty, not a hang', rows.length === 0, rows.length);
      check('and costs exactly one call', calls === 1, calls);
    });
  })
  .then(function () {
    print('');
    print(PASS + ' passed, ' + FAIL + ' failed');
    if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
    print('PASS');
  })
  .catch(function (e) { print('ERROR ' + e); throw e; });
