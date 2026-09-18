/* A FAILED READ MUST NOT PUT A VENUE IN THE DARK.

   vpaAutoArchiveSweep runs unattended at 3:30am and switches venues to
   suspended/archived_cancelling. It decides "have they played since they cancelled?" from
   two reads. Those reads used vpaSelect, which returns [] on ANY non-2xx.

   So one 503 on either read emptied lastPlayed, every cancelling venue read as
   "never played again", and the sweep archived the lot. They were also UNPAGED over a
   90-day window across every venue, so past 1000 rows the same thing happened with no
   error at all: a venue whose sessions fell outside the first page looked quiet.

   The consequence is not a short CSV. It is a pub that turns the telly on and the games
   are gone, on a night they had decided to keep playing.

   This RUNS the shipped Worker's own sweep against a fetch stub.

   Run:  jsc tools/test-archive-sweep-fails-closed.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

var ENV = { SUPABASE_URL: 'https://db.test' };
var DAY = 86400000;
var NOW = Date.parse('2026-09-18T17:00:00Z');

/* One venue, cancelled, well past its grace period, and it PLAYED last week.
   It must never be archived. */
var VENUE = {
  id: 'v1', name: 'The Wellshot', slug: 'wellshot', status: 'active',
  suspended_reason: null, founding_id: 'f1', cancel_at_period_end: true
};
// Their paid period ended 60 days ago, so they are past the 30-day grace.
var PERIOD_END = Math.floor((NOW - 60 * DAY) / 1000);
var PLAYED_RECENTLY = [{ venue_id: 'v1',
                         opened_at: new Date(NOW - 7 * DAY).toISOString(),
                         started_at: new Date(NOW - 7 * DAY).toISOString(),
                         ended_at: null }];

var patched;

/* failWhat: 'sessions' | 'reports' | null
   sessionRows: what vp_sessions returns when it does NOT fail
   serverMax: the row cap, to model an unpaged read truncating */
function arm(opts) {
  opts = opts || {};
  patched = [];
  var SERVER_MAX = opts.serverMax || 1000;
  fetch = function (url, init) {
    var m = (init && init.method) || 'GET';
    if (m === 'PATCH') {
      patched.push(url);
      return Promise.resolve({ ok: true, status: 200,
        text: function () { return Promise.resolve('[]'); },
        json: function () { return Promise.resolve([]); } });
    }
    function fail() {
      return Promise.resolve({ ok: false, status: 503,
        text: function () { return Promise.resolve('upstream timeout'); },
        json: function () { return Promise.resolve([]); } });
    }
    var rows = [];
    if (/vp_venues/.test(url))       rows = [VENUE];
    else if (/vp_sessions/.test(url)) {
      if (opts.failWhat === 'sessions') return fail();
      rows = opts.sessionRows || PLAYED_RECENTLY;
    }
    else if (/vp_game_reports/.test(url)) {
      if (opts.failWhat === 'reports') return fail();
      rows = opts.reportRows || [];
    }
    else if (/venueplay_founding/.test(url)) rows = [{ id: 'f1', stripe_subscription_id: 'sub_1' }];
    else if (/api\.stripe\.com/.test(url)) {
      var sub = { id: 'sub_1', status: 'canceled', current_period_end: PERIOD_END,
                  items: { data: [{ id: 'si_1', quantity: 1,
                                    price: { id: 'price_1' },
                                    current_period_end: PERIOD_END }] } };
      return Promise.resolve({ ok: true, status: 200,
        text: function () { return Promise.resolve(JSON.stringify(sub)); },
        json: function () { return Promise.resolve(sub); } });
    }

    var off = /[?&]offset=(\d+)/.exec(url), lim = /[?&]limit=(\d+)/.exec(url);
    var start = off ? parseInt(off[1], 10) : 0;
    var size = Math.min(lim ? parseInt(lim[1], 10) : rows.length, SERVER_MAX);
    var slice = rows.slice(start, start + size);
    return Promise.resolve({ ok: true, status: 200,
      text: function () { return Promise.resolve(JSON.stringify(slice)); },
      json: function () { return Promise.resolve(slice); } });
  };
}

function settle(p) {
  var out = { done: false };
  p.then(function (v) { out.value = v; out.done = true; },
         function (e) { out.threw = String((e && e.message) || e); out.done = true; });
  drainMicrotasks();
  return out;
}

print('A failed read must not archive a venue');
print('');

/* 1. THE BUG. The sessions read fails. The venue DID play, but we cannot know that.
      It must throw rather than archive. */
arm({ failWhat: 'sessions' });
var r1 = settle(vpaAutoArchiveSweep(ENV, { actorId: null, label: 'test' }, 30, false));
check('a failed vp_sessions read THROWS instead of archiving', !!r1.threw,
      r1.threw || (r1.value && r1.value.archived));
check('and nothing was written to any venue', patched.length === 0, patched.length);

/* 2. Same for the reports read. */
arm({ failWhat: 'reports' });
var r2 = settle(vpaAutoArchiveSweep(ENV, { actorId: null, label: 'test' }, 30, false));
check('a failed vp_game_reports read THROWS instead of archiving', !!r2.threw,
      r2.threw || (r2.value && r2.value.archived));
check('and still nothing was written', patched.length === 0, patched.length);

/* 3. THE QUIET ONE. Both reads succeed, but the server caps rows BELOW the page size, so
      an unpaged read would return only the first slice and the venue's own session would
      fall outside it. Build 1200 other venues' sessions ahead of ours. */
var many = [];
for (var i = 0; i < 1200; i++) {
  many.push({ venue_id: 'other' + i,
              opened_at: new Date(NOW - 30 * DAY).toISOString(),
              started_at: new Date(NOW - 30 * DAY).toISOString(), ended_at: null });
}
many = many.concat(PLAYED_RECENTLY);          // ours is last, past any single page
arm({ sessionRows: many, serverMax: 400 });
var r3 = settle(vpaAutoArchiveSweep(ENV, { actorId: null, label: 'test' }, 30, false));
var why3 = (r3.value && r3.value.skipped && r3.value.skipped[0] && r3.value.skipped[0].why) || '';
check('pages past the row cap and still sees the venue played',
      !r3.threw && /played again/.test(why3),
      r3.threw || JSON.stringify(r3.value));
check('so it was NOT archived', patched.length === 0, patched.length);

/* 4. And the sweep must still do its job when the venue genuinely has not played. */
arm({ sessionRows: [], reportRows: [] });
var r4 = settle(vpaAutoArchiveSweep(ENV, { actorId: null, label: 'test' }, 30, false));
check('a venue that really is quiet IS still archived',
      !r4.threw && r4.value && r4.value.archived && r4.value.archived.length === 1,
      r4.threw || JSON.stringify(r4.value));

print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
