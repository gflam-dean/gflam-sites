/* A signup whose provisioning had to be resumed: is the customer ever welcomed?

   Runs the REAL handleCheckout and vpaProvisionFromCheckout on tools/rig-billing-worker.js. One
   database write is made to fail once, which is all it takes: the first run creates the venue and
   throws, Stripe retries, the retry finishes the account. The welcome email used to be tied to
   the run that created the venue row, so on this path it was never sent, and neither was our own
   new-signup alert.

   Run from the repo root:  jsc tools/test-welcome-is-sent-once.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
function reset() { DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; }
function toCustomer(addr) { return sent.filter(function (m) { return (m.to || [])[0] === addr; }); }
async function signup(email, venues) {
  await handleCheckout(REQ({ name: 'Bob', email: email, mobile: '0412 345 678', postcode: '2000', plan: 'monthly',
    founding_code: 'NSW-SEP-2026', venues: venues }), ENV, J);
  var rowId = DB.venueplay_founding[DB.venueplay_founding.length - 1].id;
  return { client_reference_id: rowId, metadata: { tier: 'founding', row_id: rowId }, customer: 'cus_1', subscription: 'sub_1',
           created: Math.floor(Date.now() / 1000) };
}
async function run(session) { try { await vpaProvisionFromCheckout(ENV, session); return 'ok'; } catch (e) { return 'threw'; } }

(async function () {
  print('one venue, and the database blips once while it is being set up');
  reset();
  var s1 = await signup('bob@royalhotel.com.au', [{ name: 'Royal Hotel', seats: 80, postcode: '2000' }]);
  FAIL['vp_venue_settings:POST'] = 1;
  var a = await run(s1), b = await run(s1);
  check('CONTROL: the first run fails and the retry finishes the account', a === 'threw' && b === 'ok' && DB.vp_venues.length === 1 && DB.vp_venue_settings.length === 1, [a, b]);
  check('the customer IS welcomed, by the run that finished the job', toCustomer('bob@royalhotel.com.au').length === 1, sent.map(function (m) { return m.subject; }));
  check('and we are told about the signup', sent.length >= 2, sent.map(function (m) { return (m.to || [])[0]; }));
  var c = await run(s1);
  check('Stripe delivering the same event a third time does not welcome them twice', c === 'ok' && toCustomer('bob@royalhotel.com.au').length === 1, toCustomer('bob@royalhotel.com.au').length);

  print('the ordinary case');
  reset();
  var s2 = await signup('sue@anchor.com.au', [{ name: 'The Anchor', seats: 50, postcode: '2000' }]);
  await run(s2); await run(s2);
  check('nothing goes wrong: welcomed once, and only once on a duplicate delivery', toCustomer('sue@anchor.com.au').length === 1, toCustomer('sue@anchor.com.au').length);

  print('a group, resumed');
  reset();
  var s3 = await signup('kim@pubgroup.com.au', [{ name: 'The Crown', seats: 60, postcode: '2000' }, { name: 'The Rose', seats: 40, postcode: '2010' }]);
  FAIL['vp_venue_settings:POST'] = 1;
  var g1 = await run(s3), g2 = await run(s3);
  check('CONTROL: the group needed a second run', g1 === 'threw' && g2 === 'ok' && DB.vp_venues.length === 2, [g1, g2, DB.vp_venues.length]);
  check('the group owner is welcomed once', toCustomer('kim@pubgroup.com.au').length === 1, toCustomer('kim@pubgroup.com.au').length);

  print('an OLD checkout, delivered again months later');
  reset();
  var s4 = await signup('old@venue.com.au', [{ name: 'Old Venue', seats: 50, postcode: '2000' }]);
  s4.created = Math.floor(Date.now() / 1000) - 60 * 86400;
  await run(s4);
  check('does not send a welcome out of the blue', toCustomer('old@venue.com.au').length === 0, toCustomer('old@venue.com.au').length);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('welcome once: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
