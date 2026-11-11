/* THE ACCOUNT AFTER A VENUE LEAVES (Dean, 5 Nov 2026, INBOX item 33).

   When a venue has left (closed, cancelled and past its end date, or a prospect paused for want of a card) and
   signs in, it can no longer run games. It can still see Billing (invoices, its card, how to come back), its
   members list and opt-ins, and Draws read only. Everything else is hidden, and the page opens on Billing.

   This RUNS the real code, it does not word-search it:
     1. the real billing Worker (tools/rig-billing-worker.js) answers /account/summary through its own router for
        an account in each state, and its "standing" is checked: active, cancelled before the end date (still
        active), paused prospect, cancelled and ended, closed, and a failed card
     2. the 90-day date it sends is 90 days after the EARLIEST venue's closed_at (that venue goes first), and none
        is sent when no clock is running
     3. the page's own standingTabs (lifted from venueplay/app/billing.html) turns each standing into the tabs
        shown: all seven while active, Billing, Draws and Marketing after leaving
   The rest (what is hidden inside each tab, opening on Billing) is looked at in a real Chrome by the demo audit.

   Run from the repo root:  jsc tools/test-account-standing.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 400) : '')); } }

function Response(body, init) { this._b = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
function URL(u) { var m = /^https?:\/\/[^\/]+([^?#]*)(\?[^#]*)?/.exec(u) || []; this.pathname = m[1] || '/'; this.search = m[2] || '';
  this.searchParams = { get: function () { return null; }, has: function () { return false; } }; }
load('tools/rig-billing-worker.js');
var UID = '11111111-1111-4111-8111-111111111111';
var V1 = '22222222-2222-4222-8222-222222222222', V2 = '22222222-2222-4222-8222-222222222223';
vpaVerifyJWT = async function (t) { return t === 'tok' ? { sub: UID, email: 'owner@test.local' } : null; };

function seed(venues) {
  DB.vp_platform_admins = [];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@test.local', plan: 'monthly', status: 'card_on_file', created_at: '2026-09-01T00:00:00Z' }];
  DB.vp_venues = venues.map(function (v, i) {
    return Object.assign({ id: i ? V2 : V1, name: i ? 'Test Two' : 'Test One', founding_id: 'f1', max_players: 20, created_at: '2026-09-0' + (i + 1) + 'T00:00:00Z',
                           status: 'active', suspended_reason: null, cancel_at_period_end: false, closed_at: null }, v);
  });
  DB.vp_venue_staff = DB.vp_venues.map(function (v, i) { return { id: 's' + i, auth_user_id: UID, venue_id: v.id, role: 'owner', permissions: null }; });
}
function summary() {
  var out = null, txt = '{}';
  var req = { method: 'POST', url: 'https://api.test/account/summary',
              headers: { get: function (k) { return String(k).toLowerCase() === 'authorization' ? 'Bearer tok' : null; } },
              text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve({}); } };
  Promise.resolve().then(function () { return _d.fetch(req, ENV); }).then(function (r) {
    var b = null; try { b = JSON.parse(r._b); } catch (e) { b = r._b; } out = { status: r.status, body: b };
  }, function (e) { out = { status: 500, body: { error: String(e) } }; });
  for (var i = 0; i < 400 && !out; i++) drainMicrotasks();
  return out || { status: 504, body: {} };
}

/* The page's own function, lifted by name from its last script. */
var HTML = readFile('venueplay/app/billing.html');
var SCRIPT = (function () { var all = HTML.split('<script>'), last = all[all.length - 1]; return last.slice(0, last.indexOf('</script>')); })();
function lift(name) { var at = SCRIPT.indexOf('\n  function ' + name + '('); if (at < 0) return null; var end = SCRIPT.indexOf('\n  }\n', at + 1); return SCRIPT.slice(at + 1, end + 4); }
var leftTabsDecl = (SCRIPT.match(/\n  var LEFT_TABS = \[[^\]]*\];/) || [''])[0];
var standingTabs = new Function(leftTabsDecl + '\n' + lift('standingTabs') + '\nreturn standingTabs;')();
var ALL = ['billing', 'people', 'nights', 'screen', 'draws', 'marketing', 'settings'];
function tabsFor(st) { var t = standingTabs(st); return (t || ALL).join(','); }

var CASES = [
  { name: 'active', venues: [{}], state: 'active', tabs: ALL.join(',') },
  { name: 'cancelled before the end date (still inside the paid period)', venues: [{ cancel_at_period_end: true, suspended_reason: 'ending' }], state: 'active', tabs: ALL.join(',') },
  { name: 'paused prospect (free month ran out, no card)', venues: [{ status: 'suspended', suspended_reason: 'free_month_ended', closed_at: '2026-11-03T14:00:00.000Z' }], state: 'paused_prospect', tabs: 'billing,draws,marketing' },
  { name: 'cancelled and ended', venues: [{ status: 'suspended', suspended_reason: 'cancelled', closed_at: '2026-11-01T00:00:00.000Z' }], state: 'cancelled', tabs: 'billing,draws,marketing' },
  { name: 'ended at the subscription end (ended)', venues: [{ status: 'suspended', suspended_reason: 'ended', closed_at: '2026-11-01T00:00:00.000Z' }], state: 'cancelled', tabs: 'billing,draws,marketing' },
  { name: 'closed by us (archived)', venues: [{ status: 'suspended', suspended_reason: 'archived', closed_at: '2026-10-20T00:00:00.000Z' }], state: 'closed', tabs: 'billing,draws,marketing' },
  { name: 'a failed card (no 90-day clock)', venues: [{ status: 'suspended', suspended_reason: 'nonpayment' }], state: 'paused', tabs: 'billing,draws,marketing' },
  { name: 'two venues, one still on: the account is active', venues: [{}, { status: 'suspended', suspended_reason: 'cancelled', closed_at: '2026-11-01T00:00:00.000Z' }], state: 'active', tabs: ALL.join(',') },
];
print('1 and 3. each state: the Worker\'s standing and the tabs the page shows');
CASES.forEach(function (c) {
  seed(c.venues);
  var r = summary(), st = r.body && r.body.standing;
  check(c.name + ': /account/summary says ' + c.state + ' (games ' + (c.state === 'active' ? 'on' : 'off') + ')',
        r.status === 200 && st && st.state === c.state && st.games === (c.state === 'active'), [r.status, st]);
  check(c.name + ': the page shows ' + c.tabs, st && tabsFor(st) === c.tabs, st && tabsFor(st));
});

print('');
print('2. the 90-day date');
seed([{ status: 'suspended', suspended_reason: 'cancelled', closed_at: '2026-11-01T00:00:00.000Z' }]);
var k1 = summary().body.standing;
check('cancelled 1 Nov 2026: player details kept until 30 Jan 2027 (90 days)', k1 && k1.kept_until === '2027-01-30T00:00:00.000Z', k1);
seed([{ status: 'suspended', suspended_reason: 'cancelled', closed_at: '2026-11-01T00:00:00.000Z' },
      { status: 'suspended', suspended_reason: 'archived', closed_at: '2026-10-02T00:00:00.000Z' }]);
var k2 = summary().body.standing;
check('two venues closed on different days: the EARLIER one sets the date (31 Dec 2026), and the account reads closed', k2 && k2.kept_until === '2026-12-31T00:00:00.000Z' && k2.state === 'closed', k2);
seed([{ status: 'suspended', suspended_reason: 'nonpayment' }]);
var k3 = summary().body.standing;
check('a failed card starts no clock: no date is promised', k3 && k3.kept_until === null, k3);
seed([{}]);
var k4 = summary().body.standing;
check('an active account has no date', k4 && k4.kept_until === null && k4.games === true, k4);

if (bad) throw new Error('account standing: ' + bad + ' of ' + ran + ' failed');
print(''); print('ALL ' + ran + ' CHECKS PASSED');
