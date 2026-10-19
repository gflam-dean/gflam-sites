/* The unlimited nights switch is HQ's, and every flip is in the audit log: RUN, not read.

   Dean, 19 Oct 2026 (Deepwater Hotel). Migration 107 adds vp_venues.weekly_limit_off; the game
   Worker skips the once-a-week trivia and musical bingo rule for a venue with it on
   (tools/test-unlimited-nights.js runs that half). This runs the half that SETS it.

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpaHandleVenueGaming  an owner or accounts admin switches it on and off; each flip writes
                           venue_unlimited_nights_on / _off with who, the venue and from/to;
                           a staff admin, a venue's own owner and a stranger are refused and
                           nothing moves; only a real true or false is taken; before migration
                           107 the answer says so and nothing is written; a gaming edit does not
                           touch the switch or write its audit row

   Run from the repo root:  jsc tools/test-unlimited-nights-hq.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

var NO_COLUMN = false;   // the live database before migration 107
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (NO_COLUMN && /\/rest\/v1\/vp_venues\?/.test(u) &&
      (/weekly_limit_off/.test(u) || (method === 'PATCH' && /weekly_limit_off/.test(String(opts.body || ''))))) {
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({}); },
      text: function () { return Promise.resolve('{"code":"PGRST204","message":"Could not find the \'weekly_limit_off\' column of \'vp_venues\' in the schema cache"}'); } });
  }
  return rigFetch(url, opts);
};

function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACCOUNTS = U(2), STAFF = U(3), OWNER = U(4), STRANGER = U(5);
var DEEP = '80000000-0000-4000-8000-000000000001';
function as(user, body) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/admin/venue-gaming', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; FAIL = {}; NO_COLUMN = false;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' },
                           { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFF, label: 'Staff', role: 'staff' }];
  DB.vp_venues = [{ id: DEEP, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active', postcode: '2371', au_state: 'NSW',
                    entity_type: null, paid_entry_enabled: false, weekly_limit_off: false }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: DEEP, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
}
function venue() { return DB.vp_venues[0]; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return !action || a.action === action; }); }
function go(user, body) { return vpaHandleVenueGaming(as(user, Object.assign({ venue_id: DEEP }, body)), ENV, J); }

(async function () {
  print('HQ switches it on and off, and each flip is recorded');
  world();
  var r = await go(DEAN, { weekly_limit_off: true });
  check('an owner admin switches unlimited nights ON', r.status === 200 && venue().weekly_limit_off === true, r);
  var a = audits('venue_unlimited_nights_on');
  check('...one audit row: venue_unlimited_nights_on, by Dean, for this venue, from off to on',
    a.length === 1 && a[0].actor_label === 'Dean' && a[0].actor_admin === DEAN && a[0].target === 'venue:' + DEEP &&
    a[0].detail && a[0].detail.from === false && a[0].detail.to === true && a[0].detail.name === 'Deepwater Hotel', DB.vp_admin_audit);
  check('...and no gaming row for a change that was not a gaming change', audits('venue_gaming_updated').length === 0, DB.vp_admin_audit);
  r = await go(ACCOUNTS, { weekly_limit_off: false });
  check('an accounts admin switches it OFF', r.status === 200 && venue().weekly_limit_off === false, r);
  a = audits('venue_unlimited_nights_off');
  check('...recorded as venue_unlimited_nights_off by Accounts, from on to off',
    a.length === 1 && a[0].actor_label === 'Accounts' && a[0].detail.from === true && a[0].detail.to === false, DB.vp_admin_audit);

  print('nobody else can');
  world();
  r = await go(STAFF, { weekly_limit_off: true });
  check('a staff admin is refused (403) and nothing moves', r.status === 403 && venue().weekly_limit_off === false && audits().length === 0, r);
  r = await go(OWNER, { weekly_limit_off: true });
  check('the venue\'s own owner is refused (403) and nothing moves', r.status === 403 && venue().weekly_limit_off === false, r);
  r = await go(STRANGER, { weekly_limit_off: true });
  check('a stranger is refused and nothing moves', r.status === 403 && venue().weekly_limit_off === false, r);
  r = await go(null, { weekly_limit_off: true });
  check('no login is refused (401)', r.status === 401 && venue().weekly_limit_off === false, r);

  print('only a real true or false');
  world();
  r = await go(DEAN, { weekly_limit_off: 'true' });
  check('the string "true" is refused (400)', r.status === 400 && venue().weekly_limit_off === false && audits().length === 0, r);
  r = await go(DEAN, { weekly_limit_off: 1 });
  check('the number 1 is refused (400)', r.status === 400 && venue().weekly_limit_off === false, r);

  print('before migration 107 is run');
  world();
  NO_COLUMN = true;
  r = await go(DEAN, { weekly_limit_off: true });
  check('HQ is told to run migration 107 first', r.status === 409 && /migration 107/.test(r.body.error || ''), r);
  check('...and nothing was written, not even an audit row', venue().weekly_limit_off === false && audits().length === 0, DB.vp_admin_audit);
  r = await go(DEAN, { postcode: '2371' });
  check('a postcode edit still works before 107 (the switch is not in its read)', r.status === 200, r);

  print('a gaming edit leaves the switch alone');
  world();
  venue().weekly_limit_off = true;
  r = await go(DEAN, { entity_type: 'for_profit' });
  check('setting pub or club saves', r.status === 200 && venue().entity_type === 'for_profit', r);
  check('...the switch is still on', venue().weekly_limit_off === true, venue());
  check('...and only a gaming audit row was written', audits('venue_gaming_updated').length === 1 &&
    audits('venue_unlimited_nights_on').length === 0 && audits('venue_unlimited_nights_off').length === 0, DB.vp_admin_audit);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('unlimited nights HQ: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
