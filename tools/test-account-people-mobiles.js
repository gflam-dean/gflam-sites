/* WHO SEES A HOST'S MOBILE (Dean, 5 Nov 2026, INBOX item 21b).

   "PEOPLE tab: the OWNER sees each host's FULL mobile number (not masked). Hosts see only their own. Check the
   permission rules in the Worker."

   RUNS the real billing Worker's /account/hosts (tools/rig-billing-worker.js, its own router) and checks:
     - the account owner gets every login's full mobile, written as a person writes it (0400 111 222)
     - a restricted manager (a permissions object on their staff row) gets the last three digits only
     - a host is refused outright: the route takes owner and manager staff rows only, so a host never sees
       anyone else's number (their own is on their own login)
     - vpaShowMobile writes 61400111222, +61400111222 and 0400111222 the same way, and never guesses at others

   Run from the repo root:  jsc tools/test-account-people-mobiles.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 400) : '')); } }
function Response(body, init) { this._b = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
function URL(u) { var m = /^https?:\/\/[^\/]+([^?#]*)(\?[^#]*)?/.exec(u) || []; this.pathname = m[1] || '/'; this.search = m[2] || '';
  this.searchParams = { get: function () { return null; }, has: function () { return false; } }; }
load('tools/rig-billing-worker.js');
var OWNER = '11111111-1111-4111-8111-111111111111', MGR = '11111111-1111-4111-8111-111111111112',
    HOST = '11111111-1111-4111-8111-111111111113', V1 = '22222222-2222-4222-8222-222222222222';
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
DB.vp_platform_admins = [];
DB.venueplay_founding = [{ id: 'f1', contact_email: 'o@test.local', plan: 'monthly', status: 'card_on_file' }];
DB.vp_venues = [{ id: V1, name: 'Test One', founding_id: 'f1', status: 'active', max_players: 20, created_at: '2026-09-01T00:00:00Z' }];
DB.vp_venue_staff = [
  { id: 's1', auth_user_id: OWNER, venue_id: V1, role: 'owner', permissions: null, display_name: 'Olive Owner' },
  { id: 's2', auth_user_id: MGR, venue_id: V1, role: 'manager', permissions: { add_hosts: true, advertising: true }, display_name: 'Max Manager' },
  { id: 's3', auth_user_id: HOST, venue_id: V1, role: 'host', permissions: null, display_name: 'Sam Host' }];
DB.auth = [{ id: OWNER, phone: '61400999888' }, { id: MGR, phone: '+61400555666' }, { id: HOST, phone: '61400111222' }];

function call(path, who) {
  var out = null;
  var req = { method: 'POST', url: 'https://api.test' + path,
              headers: { get: function (k) { return String(k).toLowerCase() === 'authorization' ? 'Bearer ' + who : null; } },
              text: function () { return Promise.resolve('{}'); }, json: function () { return Promise.resolve({}); } };
  Promise.resolve().then(function () { return _d.fetch(req, ENV); }).then(function (r) {
    var b = null; try { b = JSON.parse(r._b); } catch (e) { b = r._b; } out = { status: r.status, body: b };
  }, function (e) { out = { status: 500, body: { error: String(e) } }; });
  for (var i = 0; i < 400 && !out; i++) drainMicrotasks();
  return out || { status: 504, body: {} };
}
function byName(r, n) { return ((r.body && r.body.hosts) || []).filter(function (h) { return h.label === n; })[0] || {}; }

var o = call('/account/hosts', OWNER);
check('the owner gets the list', o.status === 200 && (o.body.hosts || []).length === 3, o);
check('the owner sees the host\'s FULL mobile: 0400 111 222', byName(o, 'Sam Host').mobile === '0400 111 222', byName(o, 'Sam Host'));
check('the owner sees the manager\'s full mobile too (+61 form written the same way): 0400 555 666', byName(o, 'Max Manager').mobile === '0400 555 666', byName(o, 'Max Manager'));

var m = call('/account/hosts', MGR);
check('a restricted manager gets the list of their venue', m.status === 200 && (m.body.hosts || []).length === 3, m);
check('a restricted manager sees the last three digits only, never the full number',
      byName(m, 'Sam Host').mobile_last3 === '222' && !('mobile' in byName(m, 'Sam Host')), byName(m, 'Sam Host'));

var h = call('/account/hosts', HOST);
check('a host is refused: they never see anyone else\'s number', h.status === 403 && !(h.body && h.body.hosts), h);

check('vpaShowMobile: 61400111222, +61400111222 and 0400111222 all read 0400 111 222',
      vpaShowMobile('61400111222') === '0400 111 222' && vpaShowMobile('+61400111222') === '0400 111 222' && vpaShowMobile('0400111222') === '0400 111 222',
      [vpaShowMobile('61400111222'), vpaShowMobile('+61400111222'), vpaShowMobile('0400111222')]);
check('vpaShowMobile does not guess at a number that is not an Australian mobile (a landline stays digits)', vpaShowMobile('61752283667') === '61752283667', vpaShowMobile('61752283667'));

if (bad) throw new Error('people mobiles: ' + bad + ' of ' + ran + ' failed');
print(''); print('PASS ' + ran + ' checks');
