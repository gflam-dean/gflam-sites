/* A FAILED PAGE MUST NOT LOOK LIKE THE END OF THE LIST.

   vpaSelectAll used to be built on vpaSelect, which returns [] on any non-2xx. A paging loop
   reads [] as "no more pages", so a single transient Supabase error halfway through an opt-in
   export handed the venue a SHORT copy of its own customer list and said nothing. Before this
   fix the export returned 1 person out of 1500 and reported success.

   This RUNS vpaSelectAll and vpaOptinCsv out of the shipped Worker, against a fetch stub that
   honours limit and offset the way PostgREST does, and that can be told to fail one page.

   Run:  jsc tools/test-optin-fails-closed.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var ENV = { SUPABASE_URL: 'https://db.test' };
var VENUES = [{ id: 'v1', name: 'The Wellshot' }];

function person(i) {
  return { venue_id: 'v1', first_name: 'P' + i, last_name: 'Smith', email: 'p' + i + '@x.com',
           mobile: null, postcode: null, opted_in_at: '2026-09-17T00:00:00Z' };
}

/* PostgREST caps at 1000 on this project even when asked for more, so the stub does too:
   every page comes back SHORT, which is precisely why the loop must stop only on an empty one. */
var SERVER_MAX = 1000;
var calls;

function armFetch(rows, failPage) {
  calls = 0;
  fetch = function (url) {
    var page = calls++;
    var off = /[?&]offset=(\d+)/.exec(url), lim = /[?&]limit=(\d+)/.exec(url);
    var start = off ? parseInt(off[1], 10) : 0;
    var size = Math.min(lim ? parseInt(lim[1], 10) : rows.length, SERVER_MAX);
    if (failPage !== undefined && page === failPage) {
      return Promise.resolve({ ok: false, status: 503,
        text: function () { return Promise.resolve('upstream timeout'); },
        json: function () { return Promise.resolve([]); } });
    }
    var slice = rows.slice(start, start + size);
    return Promise.resolve({ ok: true, status: 200,
      text: function () { return Promise.resolve(''); },
      json: function () { return Promise.resolve(slice); } });
  };
}

function settle(p) {
  var out = { done: false };
  p.then(function (r) { out.done = true; out.value = r; },
         function (e) { out.done = true; out.threw = String(e); });
  drainMicrotasks();
  return out;
}

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('a failed page is not the end of the list');

/* 1. The happy path still pages all the way through a list longer than the server's cap. */
var many = []; for (var i = 0; i < 2500; i++) many.push(person(i));
armFetch(many);
var r1 = settle(vpaSelectAll(ENV, 'v_vp_player_optins', 'venue_id=eq.v1'));
check('pages past the 1000-row server cap and returns every row',
      !r1.threw && r1.value && r1.value.length === 2500, r1.threw || (r1.value || []).length);

/* 2. Every page is SHORT (1000 asked, 1000 max, last one 500) and it must not stop early.
      A short-page break would have returned 1000 and called it the whole list. */
check('does not mistake a short page for the last page',
      !r1.threw && r1.value.length > SERVER_MAX, (r1.value || []).length);

/* 3. THE BUG. One page fails mid-list. It must throw, not return a short list. */
armFetch(many, 1);
var r3 = settle(vpaSelectAll(ENV, 'v_vp_player_optins', 'venue_id=eq.v1'));
check('a non-2xx page THROWS instead of reading as no-more-pages', !!r3.threw, r3.value ? r3.value.length : r3.threw);
check('and the error names the table, the status and where it stopped',
      !!r3.threw && /v_vp_player_optins/.test(r3.threw) && /503/.test(r3.threw) && /offset/.test(r3.threw), r3.threw);

/* 4. The very first page failing must throw too, not return an empty list that reads as
      "this venue has no opt-ins". An empty file is at least noticeable; a wrong one is not. */
armFetch(many, 0);
var r4 = settle(vpaSelectAll(ENV, 'v_vp_player_optins', 'venue_id=eq.v1'));
check('the first page failing throws rather than looking like an empty venue', !!r4.threw, r4.value);

/* 5. The export as a whole refuses rather than handing over a short customer list. */
armFetch(many, 1);
var r5 = settle(vpaOptinCsv(ENV, VENUES));
check('the opt-in export refuses rather than producing a short CSV',
      !!r5.threw || (r5.value && r5.value.count === 2500),
      r5.threw || (r5.value && r5.value.count));

/* 6. The export orders by more than opted_in_at, or offset paging can skip a row when
      timestamps tie. */
var sawUrl = '';
armFetch(many);
fetch = (function (inner) {
  return function (url) { if (!sawUrl) sawUrl = String(url); return inner(url); };
})(fetch);
settle(vpaOptinCsv(ENV, VENUES));
check('the export asks for a total order, not just opted_in_at',
      /order=opted_in_at\.desc%2Cemail\.asc|order=opted_in_at\.desc,email\.asc/.test(sawUrl), sawUrl.slice(0, 260));

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('optin fails closed: ' + fails + ' failed'); }
