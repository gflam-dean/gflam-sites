/* Sam owns two pubs that were signed up separately: two accounts, one login.

   The audit of 20 Sep 2026 found the Account page handed Sam the account with the lowest
   founding id on every call, silently, and the other one could not be reached. Runs the
   REAL vpbRequireOwner and vpbAccountSummary on tools/rig-billing-worker.js.

   Run from the repo root:  jsc tools/test-two-accounts-one-login.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
vpbSubItem = async function () { return null; };
function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var SAM = U(1), PAT = U(2), ADMIN = U(9);
var ROYAL = V(1), ANCHOR = V(2), NEWER = V(3), STRANGER = V(4);
function as(user, extra) { var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve('{}'); }, json: function () { return Promise.resolve({}); } }; }
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.venueplay_founding = [{ id: 'f3', contact_email: 'sam@royal.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_3' },
                           { id: 'f41', contact_email: 'sam@newer.com.au', plan: 'annual', status: 'card_on_file', stripe_subscription_id: 'sub_41' },
                           { id: 'f50', contact_email: 'pat@stranger.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_50' }];
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal Hotel', founding_id: 'f3', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: ANCHOR, name: 'The Anchor Hotel', founding_id: 'f3', slug: 'anchor', status: 'active', max_players: 50, created_at: '2026-01-02T00:00:00Z' },
                  { id: NEWER, name: 'The Newer Tavern', founding_id: 'f41', slug: 'newer', status: 'active', max_players: 60, created_at: '2026-06-01T00:00:00Z' },
                  { id: STRANGER, name: 'Somebody Else Hotel', founding_id: 'f50', slug: 'else', status: 'active', max_players: 50, created_at: '2026-01-03T00:00:00Z' }];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: SAM, venue_id: ROYAL, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: SAM, venue_id: ANCHOR, role: 'owner', permissions: null },
                       { id: 's3', auth_user_id: SAM, venue_id: NEWER, role: 'owner', permissions: null },
                       { id: 's4', auth_user_id: PAT, venue_id: STRANGER, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
}
function names(o) { return (o.venues || []).map(function (v) { return v.name; }).sort().join(', '); }

(async function () {
  print('no venue named: the old order stands, and the other account is listed');
  world();
  var o = await vpbRequireOwner(as(SAM), ENV);
  check('Sam lands on the older account', !o.error && o.account.id === 'f3', o);
  check('and sees only that account\'s venues', names(o) === 'The Anchor Hotel, The Royal Hotel', names(o));
  check('the newer account is listed so the page can offer it', o.otherAccounts.length === 1 && o.otherAccounts[0].founding_id === 'f41' && o.otherAccounts[0].venue_id === NEWER && o.otherAccounts[0].venues[0] === 'The Newer Tavern', o.otherAccounts);

  print('naming a venue he holds on the other account');
  var o2 = await vpbRequireOwner(as(SAM, { 'X-VP-Venue': NEWER }), ENV);
  check('Sam gets the newer account', !o2.error && o2.account.id === 'f41' && o2.account.plan === 'annual', o2.account);
  check('with only that account\'s venue', names(o2) === 'The Newer Tavern', names(o2));
  check('and the older account listed in turn', o2.otherAccounts.length === 1 && o2.otherAccounts[0].founding_id === 'f3' && o2.otherAccounts[0].venues.length === 2, o2.otherAccounts);
  check('he is still the owner there, not an admin', o2.role === 'owner' && o2.actingAsAdmin === false, o2);

  print('naming a venue he does NOT hold changes nothing');
  var o3 = await vpbRequireOwner(as(SAM, { 'X-VP-Venue': STRANGER }), ENV);
  check('a stranger\'s venue in the header is ignored', !o3.error && o3.account.id === 'f3', o3.account);
  check('and nothing of theirs is shown', names(o3) === 'The Anchor Hotel, The Royal Hotel', names(o3));
  var o4 = await vpbRequireOwner(as(PAT, { 'X-VP-Venue': NEWER }), ENV);
  check('Pat naming Sam\'s venue still gets Pat\'s own account', !o4.error && o4.account.id === 'f50' && names(o4) === 'Somebody Else Hotel', o4);

  print('the summary the page reads');
  var r = await vpbAccountSummary(as(SAM), ENV, J);
  check('/account/summary lists the other account by one of its venues', r.status === 200 && r.body.other_accounts.length === 1 && r.body.other_accounts[0].venue_id === NEWER && r.body.other_accounts[0].venues[0] === 'The Newer Tavern', r.body.other_accounts);
  var r2 = await vpbAccountSummary(as(SAM, { 'X-VP-Venue': NEWER }), ENV, J);
  check('named, the summary is the other account\'s', r2.status === 200 && r2.body.plan === 'annual' && r2.body.venues.length === 1 && r2.body.venues[0].name === 'The Newer Tavern', r2.body);
  var r3 = await vpbAccountSummary(as(PAT), ENV, J);
  check('a one-account login is told of no other accounts', r3.status === 200 && r3.body.other_accounts.length === 0, r3.body.other_accounts);

  print('HQ View as is unchanged');
  var o5 = await vpbRequireOwner(as(ADMIN, { 'X-VP-Venue': NEWER }), ENV);
  check('an admin naming a venue acts on it as an admin', !o5.error && o5.account.id === 'f41' && o5.actingAsAdmin === true, o5);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('two accounts: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
