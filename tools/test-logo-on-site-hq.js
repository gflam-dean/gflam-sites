/* Whose logo is on our website is HQ's switch, and every flip is in the audit log: RUN, not read.

   Dean, 20 Oct 2026: "I dont want a venue to be able to put it on our website we should choose".
   Migration 111 makes vp_venues.show_logo_on_site HQ's (default off, a trigger keeps a venue login
   off it); the Trusted by strip reads it (tools/test-trusted-logos.js runs that half). This runs the
   half that SETS it, and the venue's old door.

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpaHandleVenueGaming  an owner or accounts admin switches it on and off; each flip writes
                           venue_logo_on_site_on / _off with who, the venue and from/to; a staff
                           admin, a venue's own owner and a stranger are refused and nothing moves;
                           only a real true or false is taken; a gaming edit or the unlimited
                           nights switch leaves it alone
     vpbLogoSite           the venue's old route answers 410 and writes nothing, whoever asks
     /trusted-logos        a venue HQ switches on with a logo appears; switched off, it goes

   Run from the repo root:  jsc tools/test-logo-on-site-hq.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACCOUNTS = U(2), STAFF = U(3), OWNER = U(4), STRANGER = U(5);
var MINI = '80000000-0000-4000-8000-000000000002';
function as(user, body, url) {
  var txt = JSON.stringify(body || {});
  return { url: url || 'https://api/admin/venue-gaming', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; FAIL = {};
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' },
                           { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFF, label: 'Staff', role: 'staff' }];
  DB.vp_venues = [{ id: MINI, name: 'The Mini Bar', slug: 'the-mini-bar', status: 'active', postcode: '2484', au_state: 'NSW',
                    founding_id: 'f1', max_players: 1, entity_type: 'non_profit', paid_entry_enabled: false, weekly_limit_off: false,
                    show_logo_on_site: false }];
  DB.venueplay_founding = [{ id: 'f1', status: 'comp', stripe_subscription_id: null, contact_email: 'owner@test.local' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: MINI, role: 'owner', permissions: null }];
  DB.vp_venue_screen = [{ venue_id: MINI, slides: [], logo_url: ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/' + MINI + '/' + 'a'.repeat(64) + '.png' }];
  DB.vp_admin_audit = [];
}
function venue() { return DB.vp_venues[0]; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return !action || a.action === action; }); }
function go(user, body) { return vpaHandleVenueGaming(as(user, Object.assign({ venue_id: MINI }, body)), ENV, J); }
async function strip() { var r = await vpbTrustedLogosRoute(ENV, J); return ((r.body && r.body.logos) || []).map(function (l) { return l.name; }); }

(async function () {
  print('HQ switches it on and off, and each flip is recorded');
  world();
  check('before HQ chooses it, The Mini Bar is not on the strip', (await strip()).length === 0);
  var r = await go(DEAN, { show_logo_on_site: true });
  check('an owner admin switches "Show logo on our website" ON', r.status === 200 && venue().show_logo_on_site === true, r);
  var a = audits('venue_logo_on_site_on');
  check('...one audit row: venue_logo_on_site_on, by Dean, for this venue, from off to on',
    a.length === 1 && a[0].actor_label === 'Dean' && a[0].actor_admin === DEAN && a[0].target === 'venue:' + MINI &&
    a[0].detail && a[0].detail.from === false && a[0].detail.to === true && a[0].detail.name === 'The Mini Bar', DB.vp_admin_audit);
  check('...and no gaming row for a change that was not a gaming change', audits('venue_gaming_updated').length === 0, DB.vp_admin_audit);
  check('...and the strip now has The Mini Bar, a 1-player plan on a comp account, because HQ chose it', JSON.stringify(await strip()) === '["The Mini Bar"]');
  r = await go(ACCOUNTS, { show_logo_on_site: false });
  check('an accounts admin switches it OFF', r.status === 200 && venue().show_logo_on_site === false, r);
  a = audits('venue_logo_on_site_off');
  check('...recorded as venue_logo_on_site_off by Accounts, from on to off',
    a.length === 1 && a[0].actor_label === 'Accounts' && a[0].detail.from === true && a[0].detail.to === false, DB.vp_admin_audit);
  check('...and it is off the strip again', (await strip()).length === 0);

  print('nobody else can');
  world();
  r = await go(STAFF, { show_logo_on_site: true });
  check('a staff admin is refused (403) and nothing moves', r.status === 403 && venue().show_logo_on_site === false && audits().length === 0, r);
  r = await go(OWNER, { show_logo_on_site: true });
  check('the venue\'s own owner is refused (403) and nothing moves', r.status === 403 && venue().show_logo_on_site === false, r);
  r = await go(STRANGER, { show_logo_on_site: true });
  check('a stranger is refused and nothing moves', r.status === 403 && venue().show_logo_on_site === false, r);
  r = await go(null, { show_logo_on_site: true });
  check('no login is refused (401)', r.status === 401 && venue().show_logo_on_site === false, r);
  r = await vpbLogoSite(as(OWNER, { venue_id: MINI, show: true }, 'https://api/account/logo-site'), ENV, J);
  check('the venue\'s old "Show our logo" route answers 410 and nothing moves', r.status === 410 && venue().show_logo_on_site === false && audits().length === 0, r);

  print('only a real true or false');
  world();
  r = await go(DEAN, { show_logo_on_site: 'true' });
  check('the string "true" is refused (400)', r.status === 400 && venue().show_logo_on_site === false && audits().length === 0, r);
  r = await go(DEAN, { show_logo_on_site: 1 });
  check('the number 1 is refused (400)', r.status === 400 && venue().show_logo_on_site === false, r);

  print('other HQ edits leave it alone');
  world();
  venue().show_logo_on_site = true;
  r = await go(DEAN, { weekly_limit_off: true });
  check('switching unlimited nights on saves', r.status === 200 && venue().weekly_limit_off === true, r);
  check('...the website switch is still on, with no website audit row', venue().show_logo_on_site === true &&
    audits('venue_logo_on_site_on').length === 0 && audits('venue_logo_on_site_off').length === 0, DB.vp_admin_audit);
  r = await go(DEAN, { entity_type: 'for_profit' });
  check('a gaming edit saves and leaves the website switch on', r.status === 200 && venue().show_logo_on_site === true, venue());
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('logo on site HQ: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
