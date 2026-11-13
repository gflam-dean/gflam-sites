/* SECURITY REVIEW 13 NOV 2026, PART B: B4 AND B5, run through the REAL billing Worker (tools/rig-billing-worker.js).

   B4  (the 3 Nov audit's M1, still open on main until fix/security-fixes-13nov). vpbRequireOwner worked out the role
       from every staff row the login held on ANY account, so somebody who owns one account (anyone can sign up) and
       holds an old full-access manager row at Pub X named Pub X in X-VP-Venue and downloaded Pub X's player list
       through the opt-in export gate. The owner is now the one NAMED on the account being viewed.
   B5  POST /account/manager-add (vpbAddManager) rewrote whatever staff row the typed mobile already had into a
       restricted manager, so a legacy full-access login could turn the real owner into a manager with no billing and
       no player list. Now: only the named owner manages managers (H2), and a full-access login, the owner or the
       caller's own mobile is never rewritten; a host or a new mobile still works exactly as before.

   The PoCs these came from: ~/venue-enrich/reports/security-13nov/poc-b/b4-*.js and b5-*.js (red on main 6d80d79d).
   Run from the repo root:  jsc tools/test-security-b4-b5-13nov.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400))); } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var SMS = [];
vpaSendStaffWelcomeSms = async function (env, mobile) { SMS.push(mobile); return true; };
/* Auth's user list, PAGED the way Auth pages it (the rig answers every page with every user). */
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  var pg = /\/auth\/v1\/admin\/users\?per_page=(\d+)&page=(\d+)/.exec(u);
  if (pg) { var per = +pg[1], page = +pg[2]; return Promise.resolve(resp(200, { users: tbl('auth').slice((page - 1) * per, page * per) })); }
  return rigFetch(url, opts);
};
function U(n) { return '61300000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '61300000-0000-4000-8000-' + ('00000000000' + n).slice(-11) + 'f'; }
function rq(who, venue, body) {
  var h = { authorization: who ? 'Bearer ' + who : '', 'x-vp-venue': venue || '' };
  return { url: 'https://api.venueplay.com.au/x', method: 'POST', headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
           json: function () { return Promise.resolve(body || {}); }, text: function () { return Promise.resolve(JSON.stringify(body || {})); } };
}
function staffRow(who, vid) { return tbl('vp_venue_staff').filter(function (r) { return r.auth_user_id === who && r.venue_id === vid; })[0]; }

(async function () {
  /* ---------------- B4 ---------------- */
  print('B4: owning a DIFFERENT account never makes you the owner here (the opt-in export)');
  var PUBX = V(1), MINE = V(2), TRAVEL = U(9), XOWNER = U(10);
  function worldB4(travelPerms) {
    DB = {}; FAIL = {};
    DB.venueplay_founding = [{ id: 'FX', plan: 'monthly', contact_email: 'gm@pubx.example', status: 'card_on_file', optin_release_approved: true },
                             { id: 'FY', plan: 'monthly', contact_email: 'me@trivia.example', status: 'card_on_file', optin_release_approved: true }];
    DB.vp_venues = [{ id: PUBX, name: 'Pub X Hotel', founding_id: 'FX', status: 'active', slug: 'pubx', created_at: '2026-01-01T00:00:00Z' },
                    { id: MINE, name: 'My Own Trivia Co', founding_id: 'FY', status: 'active', slug: 'mine', created_at: '2026-01-02T00:00:00Z' }];
    DB.vp_platform_admins = [];
    DB.vp_venue_staff = [{ id: 'b1', auth_user_id: TRAVEL, venue_id: MINE, role: 'owner', permissions: null, is_account_owner: true },
                         { id: 'b2', auth_user_id: TRAVEL, venue_id: PUBX, role: 'manager', permissions: travelPerms, is_account_owner: false },
                         { id: 'b3', auth_user_id: XOWNER, venue_id: PUBX, role: 'manager', permissions: null, is_account_owner: true }];
  }
  worldB4(null);
  var o = await vpbRequireOwner(rq(TRAVEL, PUBX), ENV);
  check('viewing Pub X, the travelling host is a manager there, not the owner', !o.error && o.account && o.account.id === 'FX' && o.role === 'manager' && o.owner === false, { acct: o.account && o.account.id, role: o.role, owner: o.owner, err: o.error });
  var g = await vpbOptinGate(rq(TRAVEL, PUBX), ENV, J);
  check('a legacy manager at Pub X who owns a DIFFERENT account is refused Pub X\'s player list', !!(g && g.reply && g.reply.status === 403), g && (g.reply || 'allowed'));
  var gMine = await vpbOptinGate(rq(TRAVEL, MINE), ENV, J);
  check('the same login still owns its own account (nothing taken from the real owner)', !!(gMine && !(gMine.reply && gMine.reply.status === 403)), gMine && gMine.reply);
  var gX = await vpbOptinGate(rq(XOWNER, PUBX), ENV, J);
  check('Pub X\'s named owner (stored as manager, is_account_owner) is let through', !!(gX && !(gX.reply && gX.reply.status === 403)), gX && gX.reply);
  worldB4({ players_optin: true, advertising: true });
  var gT = await vpbOptinGate(rq(TRAVEL, PUBX), ENV, J);
  check('control: once Pub X\'s owner ticks "Players and opt-in export" for them, they may export', !!(gT && !(gT.reply && gT.reply.status === 403)), gT && gT.reply);

  /* ---------------- B5 ---------------- */
  print('B5: Add a manager never rewrites a full-access login');
  var VID = V(3), OWNER = U(1), DUTY = U(2), HOSTU = U(3);
  function worldB5() {
    DB = {}; FAIL = {}; SMS = [];
    DB.venueplay_founding = [{ id: 'F1', plan: 'monthly', contact_email: 'owner@pub.example', status: 'card_on_file' }];
    DB.vp_venues = [{ id: VID, name: 'The Pub', founding_id: 'F1', status: 'active', slug: 'the-pub', created_at: '2026-01-01T00:00:00Z' }];
    DB.vp_platform_admins = [];
    DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: VID, role: 'manager', permissions: null, is_account_owner: true },
                         { id: 's2', auth_user_id: DUTY, venue_id: VID, role: 'manager', permissions: null, is_account_owner: false },
                         { id: 's3', auth_user_id: HOSTU, venue_id: VID, role: 'host', permissions: null, is_account_owner: false }];
    DB.auth = [{ id: OWNER, phone: '61400000001' }, { id: DUTY, phone: '61400000002' }, { id: HOSTU, phone: '61400000003' }];
  }
  var LIMITED = { players_optin: false, advertising: false, draws_raffles: false, add_hosts: false };
  worldB5();
  var r = await vpbAddManager(rq(DUTY, '', { label: 'Boss', mobile: '0400 000 001', all_venues: true, permissions: LIMITED }), ENV, J);
  check('a legacy full-access manager (not the named owner) cannot use Add a manager at all', r.status === 403, r);
  check('the real owner\'s full-access row is NOT rewritten to a restricted manager', staffRow(OWNER, VID).permissions === null && staffRow(OWNER, VID).is_account_owner === true, staffRow(OWNER, VID));
  r = await vpbAddManager(rq(OWNER, '', { label: 'Duty', mobile: '0400 000 002', all_venues: true, permissions: LIMITED }), ENV, J);
  check('manager-add refuses a mobile that already has full access here', r.status === 409, r);
  check('and the full-access row is unchanged, no welcome text sent', staffRow(DUTY, VID).permissions === null && staffRow(DUTY, VID).role === 'manager' && SMS.length === 0, { row: staffRow(DUTY, VID), sms: SMS });
  r = await vpbAddManager(rq(OWNER, '', { label: 'Me', mobile: '0400 000 001', all_venues: true, permissions: LIMITED }), ENV, J);
  check('the owner cannot add their own mobile as a restricted manager', r.status === 409 && staffRow(OWNER, VID).permissions === null, r);
  DB.vp_platform_admins = [{ auth_user_id: U(20), label: 'Dean', role: 'owner' }];
  DB.auth.push({ id: U(20), phone: '61400000020' });
  r = await vpbAddManager(rq(U(20), VID, { label: 'Dean', mobile: '0400 000 020', all_venues: true, permissions: LIMITED }), ENV, J);
  check('HQ View as cannot add its own login as a manager of the venue it is viewing', r.status === 409 && !staffRow(U(20), VID), { r: r, row: staffRow(U(20), VID) });
  r = await vpbAddManager(rq(OWNER, '', { label: 'Sam', mobile: '0400 000 003', all_venues: true, permissions: { advertising: true } }), ENV, J);
  check('a host\'s mobile still becomes a manager (the normal promotion)', r.status === 200 && staffRow(HOSTU, VID).role === 'manager' && staffRow(HOSTU, VID).permissions && staffRow(HOSTU, VID).permissions.players_optin === false, { r: r, row: staffRow(HOSTU, VID) });
  r = await vpbAddManager(rq(OWNER, '', { label: 'New', mobile: '0400 000 009', all_venues: true }), ENV, J);
  var newRow = tbl('vp_venue_staff').filter(function (x) { return x.display_name === 'New'; })[0];
  check('a new mobile is added as a manager, as before', r.status === 200 && newRow && newRow.role === 'manager' && SMS.length === 2, { r: r, sms: SMS });
  worldB5();
  /* The staff read for the typed mobile fails: never write on a guess. vpbRequireOwner's own reads come first, so fail
     only reads naming the duty manager's login. */
  var f2 = globalThis.fetch;
  globalThis.fetch = function (url, opts) { var u = String(url);
    if (u.indexOf('/rest/v1/vp_venue_staff?') !== -1 && u.indexOf('auth_user_id=eq.' + DUTY) !== -1 && (!opts || !opts.method || opts.method === 'GET')) return Promise.resolve(resp(503, 'upstream blip'));
    return f2(url, opts); };
  DB.vp_venue_staff[1].permissions = { advertising: true };   // a restricted manager: would normally be re-ticked
  r = await vpbAddManager(rq(OWNER, '', { label: 'Duty', mobile: '0400 000 002', all_venues: true, permissions: LIMITED }), ENV, J);
  globalThis.fetch = f2;
  check('a failed read of the typed mobile\'s rows refuses and writes nothing', r.status === 503 && staffRow(DUTY, VID).permissions.advertising === true && !('players_optin' in staffRow(DUTY, VID).permissions), { r: r, row: staffRow(DUTY, VID) });
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); fails++; });
for (var i = 0; i < 50; i++) drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('B4/B5: ' + fails + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
