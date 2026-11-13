/* WHO IS THE ACCOUNT OWNER, run through the REAL vpbRequireOwner (security audit 3 Nov 2026).

   H2. "No permissions object" used to mean owner. Every manager row written before vpbAddManager
   wrote a permissions object, and every host the old Add host stored as a manager, could charge
   the card (/account/players), cancel a venue or add managers. The owner is now NAMED: a staff
   row on the account being viewed with is_account_owner = true (migration 146) or role 'owner'.

   M1. The role used by the player opt-in export was worked out from every staff row the login
   holds on EVERY account. A trivia host who owns their own account and is a manager at Pub X
   came back as 'owner' while viewing Pub X and could download Pub X's player list.

   Also run: the gap between the Worker and migration 146. If the database says the column does
   not exist (42703), the old rule stands so no real owner is locked out; any OTHER failure on
   that read still fails closed (503).

   Runs the real billing Worker on tools/rig-billing-worker.js.
   Run from the repo root:  jsc tools/test-account-owner-marker.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var VA = '61000000-0000-4000-8000-00000000000a', VB = '61000000-0000-4000-8000-00000000000b', VX = '61000000-0000-4000-8000-0000000000aa';
var OWNER = U(1), LEGACY = U(2), TRAVELLER = U(3), ROLEOWNER = U(4);
function as(user, venue) { return { headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + user : (k === 'X-VP-Venue' ? (venue || '') : ''); } }, text: function () { return Promise.resolve('{}'); }, json: function () { return Promise.resolve({}); } }; }

var realFetch = globalThis.fetch, MODE = 'normal';
/* The column-missing gap and a plain outage, the way PostgREST answers them. */
globalThis.fetch = function (url, opts) {
  url = String(url);
  if (url.indexOf('/rest/v1/vp_venue_staff') !== -1 && /is_account_owner/.test(decodeURIComponent(url))) {
    if (MODE === 'no-column') return Promise.resolve(resp(400, { code: '42703', message: 'column vp_venue_staff.is_account_owner does not exist' }));
    if (MODE === 'outage') return Promise.resolve(resp(503, 'upstream blip'));
  }
  return realFetch(url, opts);
};

function world() {
  DB = {}; sent.length = 0; FAIL = {}; MODE = 'normal';
  DB.venueplay_founding = [{ id: 'fA', contact_email: 'owner@royalhotel.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_1' },
                           { id: 'fX', contact_email: 'pubx@pubx.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_2' }];
  DB.vp_venues = [{ id: VA, name: 'The Royal Hotel', founding_id: 'fA', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: VB, name: 'The Anchor Hotel', founding_id: 'fA', slug: 'anchor', status: 'active', max_players: 50, created_at: '2026-01-02T00:00:00Z' },
                  { id: VX, name: 'Pub X Hotel', founding_id: 'fX', slug: 'pubx', status: 'active', max_players: 50, created_at: '2026-01-03T00:00:00Z' }];
  DB.vp_platform_admins = [];
  DB.vp_venue_staff = [
    // The real owner, stored the way provisioning stores them: role manager, no permissions, MARKED.
    { id: 's1', auth_user_id: OWNER, venue_id: VA, role: 'manager', permissions: null, is_account_owner: true },
    { id: 's2', auth_user_id: OWNER, venue_id: VB, role: 'manager', permissions: null, is_account_owner: true },
    // A duty manager added before permissions objects existed: same shape, NOT marked.
    { id: 's3', auth_user_id: LEGACY, venue_id: VA, role: 'manager', permissions: null, is_account_owner: false },
    // A trivia host: owner of Pub X (role owner), and an old null-permissions manager at the Royal.
    { id: 's4', auth_user_id: TRAVELLER, venue_id: VX, role: 'owner', permissions: null, is_account_owner: true },
    { id: 's5', auth_user_id: TRAVELLER, venue_id: VA, role: 'manager', permissions: null, is_account_owner: false },
    // role 'owner' with the marker never set still counts (written only by the service role or HQ).
    { id: 's6', auth_user_id: ROLEOWNER, venue_id: VB, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
}

(async function () {
  print('H2: the owner is the one NAMED, never "no permissions object"');
  world();
  var o = await vpbRequireOwner(as(OWNER), ENV);
  check('the marked owner (stored as role manager) is the owner', !o.error && o.owner === true && o.role === 'owner' && vpbIsOwner(o), o);
  check('and passes an owner-only guard', vpbOwnerOnly(o, J) === null);
  o = await vpbRequireOwner(as(LEGACY), ENV);
  check('a legacy null-permissions manager is NOT the owner', !o.error && o.owner === false && o.role === 'manager', o);
  check('and is refused an owner-only guard with a 403', (vpbOwnerOnly(o, J) || {}).status === 403);
  var r = await vpbCancelVenue(as(LEGACY), ENV, J);
  check('the real cancel-venue route refuses them before touching anything', r.status === 403 && DB.vp_venues.every(function (v) { return !v.cancel_at_period_end; }), r);
  r = await vpbSetPlayers(as(LEGACY), ENV, J);
  check('the real players route (moves money) refuses them', r.status === 403, r);
  o = await vpbRequireOwner(as(ROLEOWNER), ENV);
  check('role owner with no marker set is still the owner', !o.error && o.owner === true, o);

  print('M1: the role is worked out on the account being viewed, not every account the login holds');
  world();
  o = await vpbRequireOwner(as(TRAVELLER, VA), ENV);
  check('the trivia host viewing the Royal is a manager there, not the owner', !o.error && o.account.id === 'fA' && o.role === 'manager' && o.owner === false, o);
  var g = await vpbOptinGate(as(TRAVELLER, VA), ENV, J);
  check('so the Royal\'s player list export refuses them', !!g.reply && g.reply.status === 403, g.reply);
  o = await vpbRequireOwner(as(TRAVELLER, VX), ENV);
  check('and on their own account (Pub X) they are still the owner', !o.error && o.account.id === 'fX' && o.role === 'owner' && o.owner === true, o);
  g = await vpbOptinGate(as(TRAVELLER, VA), ENV, J);
  check('the refusal does not depend on call order', !!g.reply && g.reply.status === 403);
  // L6: the real owner stored as role manager is no longer refused their own list at the role step.
  g = await vpbOptinGate(as(OWNER), ENV, J);
  check('the real owner (role manager, marked) is not refused at the "manager access" step',
        !(g.reply && /manager access does not include/.test(JSON.stringify(g.reply.body))), g.reply);

  print('the gap: Worker deployed before migration 146');
  world();
  DB.vp_venue_staff.forEach(function (s) { delete s.is_account_owner; });
  MODE = 'no-column';
  o = await vpbRequireOwner(as(OWNER), ENV);
  check('column missing (42703): the real owner is not locked out', !o.error && o.owner === true, o);
  MODE = 'outage';
  o = await vpbRequireOwner(as(OWNER), ENV);
  check('any OTHER failure on that read fails closed with a 503, never full access', o.error && o.status === 503, o);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('account owner marker: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
