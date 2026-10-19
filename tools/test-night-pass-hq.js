/* The one-night pass is HQ's to give, and every pass is in the audit log: RUN, not read.

   Dean, 20 Oct 2026. Migration 110 adds vp_venues.night_pass_*; the game Worker lets ONE more trivia
   or musical bingo night start with it and marks it used (tools/test-night-pass.js runs that half).
   This runs the half that GRANTS it.

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpaHandleNightPass  an owner or accounts admin grants a pass for trivia, musical bingo or either,
                         for 24 hours, nothing used; the audit row says who, which venue, which
                         format, until when. A re-grant is a fresh 24 hours and clears a used one.
                         Cancel ends a waiting pass and is recorded; cancelling nothing is refused.
                         A staff admin, the venue's own owner, a stranger and no login are refused
                         and nothing moves. Only the three formats. Before migration 110 the answer
                         says so and nothing is written. The 107 switch is not touched.

   Run from the repo root:  jsc tools/test-night-pass-hq.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

var NO_COLUMNS = false;   // the live database before migration 110
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (NO_COLUMNS && /\/rest\/v1\/vp_venues\?/.test(u) &&
      (/night_pass/.test(u) || (method === 'PATCH' && /night_pass/.test(String(opts.body || ''))))) {
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({}); },
      text: function () { return Promise.resolve('{"code":"42703","message":"column vp_venues.night_pass_format does not exist"}'); } });
  }
  return rigFetch(url, opts);
};

function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACCOUNTS = U(2), STAFF = U(3), OWNER = U(4), STRANGER = U(5);
var DEEP = '80000000-0000-4000-8000-000000000001';
var HOUR = 3600 * 1000;
function as(user, body) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/admin/night-pass', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; FAIL = {}; NO_COLUMNS = false;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' },
                           { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFF, label: 'Staff', role: 'staff' }];
  DB.vp_venues = [{ id: DEEP, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active', weekly_limit_off: false,
                    night_pass_format: null, night_pass_until: null, night_pass_granted_at: null, night_pass_granted_by: null,
                    night_pass_used_at: null, night_pass_used_format: null, night_pass_used_session: null }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: DEEP, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
}
function venue() { return DB.vp_venues[0]; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return !action || a.action === action; }); }
function go(user, body) { return vpaHandleNightPass(as(user, Object.assign({ venue_id: DEEP }, body)), ENV, J); }
function hoursLeft() { return (Date.parse(venue().night_pass_until) - Date.now()) / HOUR; }

(async function () {
  print('HQ grants one more night');
  world();
  var r = await go(DEAN, { action: 'grant', format: 'trivia' });
  check('an owner admin grants a trivia pass', r.status === 200 && venue().night_pass_format === 'trivia', r);
  check('...for 24 hours', Math.abs(hoursLeft() - 24) < 0.05, venue().night_pass_until);
  check('...granted by Dean, now, nothing used', venue().night_pass_granted_by === 'Dean' && Math.abs(Date.parse(venue().night_pass_granted_at) - Date.now()) < 60000 &&
    venue().night_pass_used_at === null, venue());
  var a = audits('venue_night_pass_granted');
  check('...one audit row: venue_night_pass_granted, by Dean, for this venue, trivia, 24 hours',
    a.length === 1 && a[0].actor_label === 'Dean' && a[0].actor_admin === DEAN && a[0].target === 'venue:' + DEEP &&
    a[0].detail.format === 'trivia' && a[0].detail.hours === 24 && a[0].detail.name === 'Deepwater Hotel', DB.vp_admin_audit);
  check('...the answer carries the pass, for HQ to show', r.body.pass && r.body.pass.night_pass_format === 'trivia' && r.body.pass.night_pass_until === venue().night_pass_until, r.body);
  check('...and the 107 switch is untouched', venue().weekly_limit_off === false);
  r = await go(ACCOUNTS, { action: 'grant', format: 'musical_bingo' });
  check('an accounts admin can too (musical bingo)', r.status === 200 && venue().night_pass_format === 'musical_bingo', r);
  r = await go(DEAN, { action: 'grant', format: 'either' });
  check('"either" is a format', r.status === 200 && venue().night_pass_format === 'either', r);

  print('a used pass, then a fresh one');
  venue().night_pass_used_at = new Date(Date.now() - HOUR).toISOString();
  venue().night_pass_used_format = 'trivia';
  venue().night_pass_used_session = '90000000-0000-4000-8000-000000000001';
  r = await go(DEAN, { action: 'cancel' });
  check('a used pass cannot be cancelled (it is history): 409', r.status === 409 && !!venue().night_pass_used_at, r);
  r = await go(DEAN, { action: 'grant', format: 'trivia' });
  check('a new grant is a fresh pass: nothing used', r.status === 200 && venue().night_pass_used_at === null &&
    venue().night_pass_used_format === null && venue().night_pass_used_session === null, venue());

  print('cancel');
  r = await go(DEAN, { action: 'cancel' });
  check('a waiting pass is cancelled: it lapses now', r.status === 200 && Date.parse(venue().night_pass_until) <= Date.now(), r);
  a = audits('venue_night_pass_cancelled');
  check('...recorded as venue_night_pass_cancelled by Dean', a.length === 1 && a[0].actor_label === 'Dean' && a[0].detail.format === 'trivia', DB.vp_admin_audit);
  r = await go(DEAN, { action: 'cancel' });
  check('cancelling when nothing is waiting: 409', r.status === 409, r);

  print('nobody else can');
  world();
  r = await go(STAFF, { action: 'grant', format: 'trivia' });
  check('a staff admin is refused (403) and nothing moves', r.status === 403 && venue().night_pass_until === null && audits().length === 0, r);
  r = await go(OWNER, { action: 'grant', format: 'trivia' });
  check('the venue\'s own owner is refused (403)', r.status === 403 && venue().night_pass_until === null, r);
  r = await go(STRANGER, { action: 'grant', format: 'trivia' });
  check('a stranger is refused', r.status === 403 && venue().night_pass_until === null, r);
  r = await go(null, { action: 'grant', format: 'trivia' });
  check('no login is refused (401)', r.status === 401 && venue().night_pass_until === null, r);

  print('only what it says');
  world();
  r = await go(DEAN, { action: 'grant', format: 'bingo' });
  check('a format that is not trivia, musical_bingo or either is refused (400)', r.status === 400 && venue().night_pass_until === null && audits().length === 0, r);
  r = await go(DEAN, { action: 'grant' });
  check('no format is refused (400)', r.status === 400, r);
  r = await go(DEAN, { action: 'forever', format: 'trivia' });
  check('an action that is not grant or cancel is refused (400)', r.status === 400 && venue().night_pass_until === null, r);
  r = await vpaHandleNightPass(as(DEAN, { action: 'grant', format: 'trivia', venue_id: '80000000-0000-4000-8000-000000000999' }), ENV, J);
  check('a venue that does not exist: 404', r.status === 404, r);

  print('before migration 110 is run');
  world();
  NO_COLUMNS = true;
  r = await go(DEAN, { action: 'grant', format: 'trivia' });
  check('HQ is told to run migration 110 first', r.status === 409 && /migration 110/.test(r.body.error || ''), r);
  check('...and nothing was written, not even an audit row', venue().night_pass_until === null && audits().length === 0, DB.vp_admin_audit);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('night pass HQ: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
