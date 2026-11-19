/* Signing up ONE venue by itself follows the Add a venue player limits (Dean, 14 Nov 2026, INBOX 418):
   over 100 players is allowed and emails sales@ once; over 200 is not self-serve (nothing saved, Stripe never asked).
   A group signing up (two or more venues) has no per-venue limit and no flag.

   Runs the REAL handleCheckout and vpaProvisionFromCheckout on tools/rig-billing-worker.js.
   Run from the repo root:  jsc tools/test-signup-player-limits.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
function reset() { DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; }
function flagMails() { return sent.filter(function (m) { return (m.to || []).indexOf('sales@venueplay.com.au') !== -1 && /signed up with/.test(m.subject || ''); }); }
function founding() { return DB.venueplay_founding || []; }
async function checkout(email, venues) {
  return await handleCheckout(REQ({ name: 'Bob', email: email, mobile: '0412 345 678', postcode: '2000', plan: 'monthly',
    venues: venues, compliance_accepted: true }), ENV, J);
}
function sessionFor() {
  var rowId = founding()[founding().length - 1].id;
  return { client_reference_id: rowId, metadata: { tier: 'standard', row_id: rowId }, customer: 'cus_1', subscription: 'sub_1',
           created: Math.floor(Date.now() / 1000) };
}
async function signupAndProvision(email, venues) {
  var r = await checkout(email, venues);
  if (r.status !== 200) return r;
  var s = sessionFor();
  await vpaProvisionFromCheckout(ENV, s);
  r.session = s;
  return r;
}

(async function () {
  print('one venue by itself');
  var cases = [[100, false], [101, true], [200, true]];
  for (var i = 0; i < cases.length; i++) {
    reset();
    var n = cases[i][0], flag = cases[i][1];
    var r = await signupAndProvision('pub' + n + '@example.com.au', [{ name: 'The Pub ' + n, seats: n, postcode: '2000' }]);
    check(n + ' players: signs up and the venue is made', r.status === 200 && (DB.vp_venues || []).length === 1, [r.status, (DB.vp_venues || []).length]);
    check(n + ' players: ' + (flag ? 'one email to sales@' : 'no email to sales@'), flagMails().length === (flag ? 1 : 0), sent.map(function (m) { return m.subject; }));
    if (flag) {
      var m = flagMails()[0];
      check(n + ' players: the alert names the venue, the players and the account, with an HQ link',
        /The Pub/.test(m.html) && m.html.indexOf(String(n) + ' players') !== -1 && /pub\d+@example\.com\.au/.test(m.html) && /hq\.html/.test(m.html), m.html);
      await vpaProvisionFromCheckout(ENV, r.session);
      check(n + ' players: Stripe sending the same event again sends no second alert', flagMails().length === 1, flagMails().length);
    }
  }

  reset();
  var r201 = await checkout('big@example.com.au', [{ name: 'Big Barn', seats: 201, postcode: '2000' }]);
  check('201 players: refused with the sales@ line', r201.status === 400 && /For more than 200 players, email sales@venueplay\.com\.au/.test(r201.body.error || ''), r201);
  check('201 players: nothing saved, Stripe never asked, nobody mailed', founding().length === 0 && stripeCalls.length === 0 && sent.length === 0, [founding().length, stripeCalls.length, sent.length]);
  check('201 players: the public page words carry no phone number', !/\d{2} \d{4} \d{4}/.test(r201.body.error || ''), r201.body.error);

  print('a group signing up');
  reset();
  var g = await signupAndProvision('grp@example.com.au', [{ name: 'The Crown', seats: 500, postcode: '2000' }, { name: 'The Rose', seats: 40, postcode: '2010' }]);
  check('group with a 500 player venue: signs up, both venues made', g.status === 200 && (DB.vp_venues || []).length === 2, [g.status, (DB.vp_venues || []).length]);
  check('group with a 500 player venue: no email to sales@', flagMails().length === 0, sent.map(function (m) { return m.subject; }));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('signup player limits: ' + fails + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
