/* A host is removed. Does the venue's screen key go with them?

   Every host at a venue signs with the venue's one private key, handed to their browser, and
   revoking the login left that key working for ever (audit, 20 Sep 2026). Runs the REAL
   vpbRemoveHost, vpbSetStaffVenues and vpbResecureScreens on tools/rig-billing-worker.js.

   Run from the repo root:  jsc tools/test-removed-host-loses-the-key.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), HOST = U(3), HOST2 = U(4), MANAGER = U(2);
function as(user, body) { return { headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + user : ''; } }, text: function () { return Promise.resolve(JSON.stringify(body || {})); }, json: function () { return Promise.resolve(body || {}); } }; }
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_1' }];
  DB.vp_venues = [{ id: 'vA', name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: 'vB', name: 'The Anchor Hotel', founding_id: 'f1', slug: 'anchor', status: 'active', max_players: 50, created_at: '2026-01-02T00:00:00Z' }];
  DB.vp_platform_admins = [];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: 'vA', role: 'owner', permissions: null }, { id: 's2', auth_user_id: OWNER, venue_id: 'vB', role: 'owner', permissions: null },
                       { id: 's3', auth_user_id: HOST, venue_id: 'vA', role: 'host', permissions: null }, { id: 's4', auth_user_id: HOST, venue_id: 'vB', role: 'host', permissions: null },
                       { id: 's5', auth_user_id: HOST2, venue_id: 'vA', role: 'host', permissions: null },
                       { id: 's6', auth_user_id: MANAGER, venue_id: 'vA', role: 'manager', permissions: { add_hosts: false } }];
  DB.vp_venue_signing_keys = [{ venue_id: 'vA', kid: 'kA1', public_jwk: {}, private_jwk: {} }, { venue_id: 'vB', kid: 'kB1', public_jwk: {}, private_jwk: {} }];
  DB.vp_admin_audit = [];
}
function keys() { return DB.vp_venue_signing_keys.map(function (k) { return k.venue_id + ':' + k.kid; }).sort().join(','); }

(async function () {
  print('removing a host from one venue');
  world();
  var r = await vpbRemoveHost(as(OWNER, { auth_user_id: HOST, venue_ids: ['vA'] }), ENV, J);
  check('the removal goes through', r.status === 200 && r.body.screens_resecured === 1, r.body);
  check('that venue\'s key is gone and the other venue\'s stays', keys() === 'vB:kB1', keys());
  check('the login is gone from that venue only', DB.vp_venue_staff.filter(function (s) { return s.auth_user_id === HOST; }).map(function (s) { return s.venue_id; }).join() === 'vB');

  print('removing a host from every venue');
  world();
  r = await vpbRemoveHost(as(OWNER, { auth_user_id: HOST, all_venues: true }), ENV, J);
  check('both keys are gone', r.status === 200 && keys() === '', keys());

  print('taking one venue away with set-venues');
  world();
  r = await vpbSetStaffVenues(as(OWNER, { auth_user_id: HOST, venue_ids: ['vB'] }), ENV, J);
  check('the venue they lost is rotated, the one they keep is not', r.status === 200 && keys() === 'vB:kB1', JSON.stringify([r.body, keys()]));

  print('re-secure my screens');
  world();
  r = await vpbResecureScreens(as(OWNER, {}), ENV, J);
  check('the owner rotates every venue on the account', r.status === 200 && r.body.venues === 2 && keys() === '', JSON.stringify([r.body, keys()]));
  check('and it is written to the audit trail', DB.vp_admin_audit.some(function (a) { return a.action === 'screens_resecured'; }), DB.vp_admin_audit);
  world();
  r = await vpbResecureScreens(as(MANAGER, {}), ENV, J);
  check('a manager without the hosts right is refused', r.status === 403 && keys() === 'vA:kA1,vB:kB1', JSON.stringify([r.status, keys()]));
  r = await vpbResecureScreens(as(HOST, {}), ENV, J);
  check('a host is refused', r.status === 403 && keys() === 'vA:kA1,vB:kB1', JSON.stringify([r.status, keys()]));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('removed host: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
