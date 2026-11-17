/* HQ VENUE CONTACT MOBILES: OWNER AND ACCOUNTS ONLY, SERVED BY THE WORKER (review of HQ menu step 1, 18 Nov 2026).

   A cancelled venue's card in HQ shows its contact's own phone (Dean, 29 Oct 2026). Step 1 first read those numbers in the
   browser, as one query every HQ login made, so a staff login held every venue contact's mobile in memory and in its
   network log even though nothing drew it. Now POST /admin/venue-contacts serves them, and only to owner and accounts.

   Runs the REAL billing Worker on tools/rig-billing-worker.js (only the token check is stood in for: a token IS the user):
     - owner and accounts get every account's contact name and mobile, keyed by the account id, past 1000 rows
     - a staff HQ login, a venue's own owner, a stranger and no login at all get a refusal and no numbers
     - nothing but id, name and phone leaves: no email, no Stripe id, no card
     - a database fault is an error, never a short or empty list that would read as "none on file"
     - the dispatcher has the route

   Run from the repo root:  jsc tools/test-hq-venue-contacts.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return 'd0000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACC = U(2), STAFF = U(3), VENUE_OWNER = U(4), STRANGER = U(5);
function req(user) { var h = user ? { Authorization: 'Bearer ' + user } : {};
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve('{}'); }, json: function () { return Promise.resolve({}); } }; }
async function call(user) { try { return await vpaHandleVenueContacts(req(user), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }
function world(extra) {
  DB = {}; FAIL = {}; sent.length = 0;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACC, label: 'Sam', role: 'accounts' }, { auth_user_id: STAFF, label: 'Pat', role: 'staff' }];
  DB.vp_venue_staff = [{ auth_user_id: VENUE_OWNER, venue_id: 'v1', role: 'owner' }];
  DB.venueplay_founding = [
    { id: 'f1', venue_name: 'Tugun Bowls Club', contact_name: 'Terry Tugun', mobile: '0412 345 678', contact_email: 'tugun@example.com', stripe_customer_id: 'cus_T', stripe_subscription_id: 'sub_T' },
    { id: 'f2', venue_name: 'The Royal Arms', contact_name: null, mobile: null, contact_email: 'royal@example.com', stripe_customer_id: 'cus_R' }
  ];
  for (var i = 0; i < (extra || 0); i++) DB.venueplay_founding.push({ id: 'g' + ('0000' + i).slice(-5), contact_name: 'Bulk ' + i, mobile: '04' + ('00000000' + i).slice(-8), contact_email: 'b' + i + '@example.com' });
}

(async function () {
  print('owner and accounts get the numbers');
  world();
  var r = await call(DEAN);
  check('owner: 200 with every account keyed by id', r.status === 200 && r.body.ok === true && r.body.contacts && Object.keys(r.body.contacts).sort().join() === 'f1,f2', r);
  check('owner: the contact\'s own name and mobile', r.body.contacts && r.body.contacts.f1 && r.body.contacts.f1.name === 'Terry Tugun' && r.body.contacts.f1.phone === '0412 345 678', r.body.contacts);
  check('an account with no name or number comes back as empty strings (the card then says none on file)', r.body.contacts && r.body.contacts.f2 && r.body.contacts.f2.name === '' && r.body.contacts.f2.phone === '', r.body.contacts);
  var keys = {}; Object.keys(r.body.contacts || {}).forEach(function (k) { Object.keys(r.body.contacts[k]).forEach(function (x) { keys[x] = true; }); });
  check('nothing but name and phone leaves: no email, no Stripe id', Object.keys(keys).sort().join() === 'name,phone' && JSON.stringify(r.body).indexOf('@example.com') < 0 && JSON.stringify(r.body).indexOf('cus_') < 0, r.body);
  var a = await call(ACC);
  check('accounts: 200 with the same numbers', a.status === 200 && a.body.contacts && a.body.contacts.f1 && a.body.contacts.f1.phone === '0412 345 678', a);

  print('every other login is refused and sent no number');
  var s = await call(STAFF);
  check('a staff HQ login is refused (403)', s.status === 403 && /staff/.test(s.body.error || ''), s);
  check('...and its answer holds no contact and no number', !s.body.contacts && JSON.stringify(s.body).indexOf('0412') < 0, s.body);
  var v = await call(VENUE_OWNER);
  check('a venue\'s own owner login (not HQ) is refused (403) with no numbers', v.status === 403 && !v.body.contacts, v);
  var x = await call(STRANGER);
  check('a signed-in stranger is refused (403) with no numbers', x.status === 403 && !x.body.contacts, x);
  var n = await call(null);
  check('no login at all is refused (401) with no numbers', n.status === 401 && !n.body.contacts, n);

  print('a long list and a database fault');
  world(1500);
  var big = await call(DEAN);
  check('past 1000 accounts every one comes back (the read pages)', big.status === 200 && Object.keys(big.body.contacts || {}).length === 1502, big.body && Object.keys(big.body.contacts || {}).length);
  world();
  FAIL['venueplay_founding:GET'] = 1;
  var f = await call(DEAN);
  check('a database fault is an error (502), never an empty list that reads as "none on file"', f.status === 502 && !f.body.contacts && /try again/i.test(f.body.error || ''), f);

  print('the route is reachable');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the dispatcher sends POST /admin/venue-contacts to the handler', src.indexOf("if (request.method === 'POST' && path === '/admin/venue-contacts'  && typeof vpaHandleVenueContacts === 'function')  return await vpaHandleVenueContacts(request, env, json);") !== -1);
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
