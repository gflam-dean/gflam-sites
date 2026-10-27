/* THE PURCHASE RAFFLE'S BILLING HALF, RUN, NOT READ (migration 115, 22 Oct 2026).

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpaHandleVenueGaming      HQ (owner or accounts admin) switches the purchase raffle on and off
                               for one venue; every flip is audited with from and to; a staff admin,
                               the venue's own owner and a stranger are refused and nothing moves;
                               only a real true or false; before migration 115 it says so
     vpbPurchaseRaffleExport   only entrants who ticked marketing themselves, never the others;
                               the SAME gate as the player opt-in export (owner yes, a manager only
                               with players_optin ticked, HQ View as yes, an unapproved account no);
                               only the caller's own venue; paged past 1,000; audited

   Run from the repo root:  jsc tools/test-purchase-raffle-hq.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

var NO_COLUMN = false;
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (NO_COLUMN && /\/rest\/v1\/vp_venues\?/.test(u) &&
      (/purchase_raffle_on/.test(u) || (method === 'PATCH' && /purchase_raffle_on/.test(String(opts.body || ''))))) {
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({}); },
      text: function () { return Promise.resolve('{"code":"PGRST204","message":"Could not find the \'purchase_raffle_on\' column of \'vp_venues\' in the schema cache"}'); } });
  }
  return rigFetch(url, opts);
};

function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACCOUNTS = U(2), STAFF = U(3), OWNER = U(4), STRANGER = U(5), MANAGER = U(6), TICKED = U(7), RIVAL = U(8);
var DEEP = '80000000-0000-4000-8000-000000000001', OTHERV = '80000000-0000-4000-8000-000000000002';
var ACCT = '90000000-0000-4000-8000-000000000001', ACCT2 = '90000000-0000-4000-8000-000000000002';
var RAF = 'a0000000-0000-4000-8000-000000000001';
function as(user, body, headers) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { if (k === 'Authorization') return user ? 'Bearer ' + user : ''; return (headers || {})[k] || ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; FAIL = {}; NO_COLUMN = false;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFF, label: 'Staff', role: 'staff' }];
  DB.vp_venues = [{ id: DEEP, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active', postcode: '2371', au_state: 'NSW', founding_id: ACCT,
                    entity_type: null, paid_entry_enabled: false, purchase_raffle_on: false, created_at: '2026-10-01' },
                  { id: OTHERV, name: 'Rival Events', slug: 'rival', status: 'active', founding_id: ACCT2, purchase_raffle_on: false, created_at: '2026-10-01' }];
  DB.venueplay_founding = [{ id: ACCT, contact_email: 'owner@deepwaterhotel.com.au', optin_release_approved: false, status: 'active' },
                           { id: ACCT2, contact_email: 'x@gmail.com', optin_release_approved: false, status: 'active' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: DEEP, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: MANAGER, venue_id: DEEP, role: 'manager', permissions: null },
                       { id: 's3', auth_user_id: TICKED, venue_id: DEEP, role: 'manager', permissions: { players_optin: true } },
                       { id: 's4', auth_user_id: RIVAL, venue_id: OTHERV, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
  DB.vp_purchase_raffles = [{ id: RAF, venue_id: DEEP, name: 'Summer Purchase Raffle' }];
  DB.vp_purchase_raffle_entrants = [
    { id: 'p1', raffle_id: RAF, venue_id: DEEP, first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: '+61499000111', marketing_opt_in: true, opted_in_at: '2026-10-23T03:00:00Z' },
    { id: 'p2', raffle_id: RAF, venue_id: DEEP, first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com', phone: '+61412345678', marketing_opt_in: false, opted_in_at: null },
    { id: 'p3', raffle_id: RAF, venue_id: DEEP, first_name: '=HYPERLINK("x")', last_name: 'Z', email: 'z@example.com', phone: '+61400000003', marketing_opt_in: true, opted_in_at: '2026-10-23T04:00:00Z' },
    { id: 'p4', raffle_id: 'other', venue_id: OTHERV, first_name: 'Theirs', last_name: 'T', email: 't@example.com', phone: '+61400000004', marketing_opt_in: true, opted_in_at: '2026-10-23T04:00:00Z' }];
}
function venue() { return DB.vp_venues[0]; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return !action || a.action === action; }); }
function go(user, body) { return vpaHandleVenueGaming(as(user, Object.assign({ venue_id: DEEP }, body)), ENV, J); }
function exp(user, venueId, headers) { return vpbPurchaseRaffleExport(as(user, { venue_id: venueId || DEEP }, headers), ENV, J); }

(async function () {
  print('HQ switches it on and off, and each flip is recorded');
  world();
  var r = await go(DEAN, { purchase_raffle_on: true });
  check('an owner admin switches the purchase raffle ON', r.status === 200 && venue().purchase_raffle_on === true, r);
  var a = audits('venue_purchase_raffle_on');
  check('...one audit row, by Dean, for this venue, from off to on', a.length === 1 && a[0].actor_label === 'Dean' && a[0].target === 'venue:' + DEEP &&
    a[0].detail.from === false && a[0].detail.to === true && a[0].detail.name === 'Deepwater Hotel', DB.vp_admin_audit);
  check('...and no gaming row for a change that was not a gaming change', audits('venue_gaming_updated').length === 0, DB.vp_admin_audit);
  check('...and the other venue is untouched', DB.vp_venues[1].purchase_raffle_on === false);
  r = await go(ACCOUNTS, { purchase_raffle_on: false });
  check('an accounts admin switches it OFF, recorded from on to off', r.status === 200 && venue().purchase_raffle_on === false &&
    audits('venue_purchase_raffle_off').length === 1 && audits('venue_purchase_raffle_off')[0].detail.from === true, r);
  world();
  r = await go(STAFF, { purchase_raffle_on: true });
  check('a staff admin is refused and nothing moves', r.status === 403 && venue().purchase_raffle_on === false && audits().length === 0, r);
  r = await go(OWNER, { purchase_raffle_on: true });
  check('the venue\'s own owner is refused and nothing moves', r.status === 403 && venue().purchase_raffle_on === false, r);
  r = await go(STRANGER, { purchase_raffle_on: true });
  check('a stranger is refused', r.status === 403 && venue().purchase_raffle_on === false, r);
  r = await go(DEAN, { purchase_raffle_on: 'true' });
  check('a string is not a switch', r.status === 400 && venue().purchase_raffle_on === false, r);
  NO_COLUMN = true;
  r = await go(DEAN, { purchase_raffle_on: true });
  check('before migration 115: says run 115 first, nothing written', r.status === 409 && /migration 115/.test(r.body.error) && audits().length === 0, r);

  print('the export: opted-in entrants only, the same gate as the player opt-ins');
  world();
  r = await exp(OWNER);
  check('the owner gets the file', r.status === 200 && r.body.count === 2, r);
  var csv = (r.body && r.body.csv) || '';
  check('only people who ticked it themselves', csv.indexOf('Ann') >= 0 && csv.indexOf('Bob') < 0 && csv.indexOf('bob@example.com') < 0, csv);
  check('the mobile reads like a mobile', csv.indexOf('0499000111') >= 0, csv);
  check('a name that is a formula is made text', csv.indexOf("'=HYPERLINK") >= 0, csv);
  check('another venue\'s entrant is never in it', csv.indexOf('Theirs') < 0, csv);
  check('the export is audited', audits('purchase_raffle_optins_exported').length === 1 && audits('purchase_raffle_optins_exported')[0].detail.rows === 2, DB.vp_admin_audit);
  r = await exp(MANAGER);
  check('a manager who was never ticked for player details is refused', r.status === 403 && /player details/.test(r.body.error), r);
  r = await exp(TICKED);
  check('a manager ticked for player details gets it', r.status === 200 && r.body.count === 2, r);
  r = await exp(DEAN, DEEP, { 'X-VP-Venue': DEEP });
  check('HQ using View as gets it', r.status === 200 && r.body.count === 2, r);
  var before = audits('purchase_raffle_optins_exported').length;
  r = await exp(OWNER, OTHERV);
  check('an owner naming another account\'s venue is refused, nothing exported', r.status === 403 && audits('purchase_raffle_optins_exported').length === before, r);
  r = await exp(RIVAL, OTHERV);
  check('an account that is not approved (free mailbox, no venue word) is held for review', r.status === 403 && r.body.pending === true, r);
  r = await exp(STRANGER);
  check('a stranger is refused', r.status === 403, r);
  world();
  for (var i = 0; i < 1500; i++) DB.vp_purchase_raffle_entrants.push({ id: 'q' + i, raffle_id: RAF, venue_id: DEEP, first_name: 'P' + i, last_name: 'L', email: 'p' + i + '@x.au', phone: '+614' + ('0000000' + i).slice(-8), marketing_opt_in: true, opted_in_at: '2026-11-01T00:00:00Z' });
  r = await exp(OWNER);
  check('paged: 1,502 opted-in people, all 1,502 in the file', r.status === 200 && r.body.count === 1502, r.body && r.body.count);
  FAIL['vp_purchase_raffle_entrants:GET'] = 1;
  r = await exp(OWNER);
  check('a failed read refuses rather than handing over a short list', r.status === 503, r);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('purchase raffle HQ: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
