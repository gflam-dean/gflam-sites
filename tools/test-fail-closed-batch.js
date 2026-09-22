/* THREE THINGS THAT FAILED OPEN, from the audit of 20 Sep 2026.

   1. A manager's permissions could not be read, so they were treated as the OWNER.
   2. A player's typed "name" of =HYPERLINK(...) was a live formula in the venue's CSV.
   3. The contact form sent an email per request with no limits, on the invoice key.

   Each check RUNS the shipped function out of the billing Worker.

   Run:  jsc tools/test-fail-closed-batch.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 260) : '')); }
}
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
function J(o, st) { return { body: o, status: st || 200 }; }

print('A spreadsheet must not run what a stranger typed');
['=HYPERLINK("http://x","hi")', '+61400', '-1', '@SUM(A1)', '\tx', '\rx'].forEach(function (v) {
  var c = vpbCsvCell(v);
  check(JSON.stringify(v).slice(0, 22) + ' is neutralised', /^"?'/.test(c), c);
});
check('an ordinary name is left exactly as typed', vpbCsvCell('Margaret') === 'Margaret', vpbCsvCell('Margaret'));
check('an email is left alone', vpbCsvCell('pat@pub.com.au') === 'pat@pub.com.au');
check('a comma still gets quoted', vpbCsvCell('Smith, Pat') === '"Smith, Pat"', vpbCsvCell('Smith, Pat'));
check('a carriage return is quoted, it used to split the row', /^"/.test(vpbCsvCell('a\rb')), vpbCsvCell('a\rb'));

print('');
print('The contact form has limits');
var sentMail;
fetch = function (url, o) { if (/resend/.test(String(url))) sentMail++; return Promise.resolve({ ok: true,
  json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } }); };
function contact(body, ip) {
  sentMail = 0; var out = null;
  var req = { json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); },
              headers: { get: function (k) { return k.toLowerCase() === 'cf-connecting-ip' ? (ip || '203.0.113.9') : ''; } } };
  handleContact(req, { RESEND_API_KEY: 'k' }, J).then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drain(); return { out: out, sent: sentMail };
}
var c = contact({ name: 'Sam', email: 'sam@pub.com.au', message: 'Tell me more' });
check('a real enquiry is sent', c.sent === 1 && c.out.status === 200, c);
c = contact({ name: 'Sam', email: 'sam@pub.com.au', message: new Array(5002).join('x') });
check('a 5,000 character message is refused and nothing is sent', c.sent === 0 && c.out.status === 400, c);
c = contact({ name: new Array(300).join('n'), email: 'sam@pub.com.au', message: 'hi' });
check('a 300 character name is refused', c.sent === 0 && c.out.status === 400, c);
c = contact({ name: 'Sam', email: 'sam@@pub', message: 'hi' });
check('a malformed email is refused', c.sent === 0 && c.out.status === 400, c);
c = contact({ name: 'Bot', email: 'b@x.com', message: 'buy pills', website: 'http://spam' });
check('a filled honeypot is told ok and NOTHING is sent', c.sent === 0 && c.out.status === 200, c);

/* THE THROTTLE ITSELF, not only the size caps. A script hitting /contact repeatedly from one
   IP used to send one email per request, unlimited, on the same Resend key as every invoice
   and welcome email (audit, 20 Sep 2026). */
var flood = 0, blocked429 = 0, i;
for (i = 0; i < 8; i++) {
  var f = contact({ name: 'Sam', email: 'sam' + i + '@pub.com.au', message: 'msg ' + i }, '198.51.100.7');
  if (f.sent === 1) flood++;
  if (f.out && f.out.status === 429) blocked429++;
}
check('the sixth message from one network in the hour still sends', flood === 6, flood);
check('the seventh and eighth are refused with 429, nothing sent for either', blocked429 === 2 && flood === 6, { flood: flood, blocked429: blocked429 });
var other = contact({ name: 'Pat', email: 'pat@otherpub.com.au', message: 'hi from a different network' }, '192.0.2.44');
check('a DIFFERENT network is not caught by somebody else\'s flood', other.sent === 1 && other.out.status === 200, other);

print('');
print('Unreadable permissions are not owner permissions');
var PERMS_DOWN = false;
vpaVerifyJWT = function () { return Promise.resolve({ sub: 'user-1' }); };
vpaSelect = function (env, table, q) {
  if (table === 'vp_platform_admins') return Promise.resolve([]);
  if (table === 'vp_venue_staff') return Promise.resolve([{ venue_id: 'v1', role: 'manager', auth_user_id: 'user-1' }]);
  if (table === 'vp_venues') return Promise.resolve([{ id: 'v1', name: 'The Pub', founding_id: 'f1', group_id: null, status: 'active' }]);
  if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', contact_email: 'o@pub.com.au', status: 'card_on_file' }]);
  return Promise.resolve([]);
};
vpaSelectAll = function (env, table, q) {
  if (table === 'vp_venue_staff') {
    if (PERMS_DOWN) return Promise.reject(new Error('read vp_venue_staff page 0: 429'));
    return Promise.resolve([{ permissions: { billing: false, add_hosts: false } }]);
  }
  return Promise.resolve([]);
};
function owner() {
  var out = null;
  var req = { headers: { get: function () { return 'Bearer t'; } }, url: 'https://x/y' };
  vpbRequireOwner(req, { SUPABASE_URL: 'https://db', SUPABASE_JWT_SECRET: 's' })
    .then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drain(); return out;
}
/* The two exports the PAGES build themselves, lifted out of the shipped files and run.
   HQ's venue list is typed by strangers on the signup form; the draws download carries
   the winner's own typed name. Both used to hand a formula straight to Excel. */
(function () {
  var hq = readFile('venueplay/app/hq.html'), m = /function csvCell\(v\)\{[^\n]*\}\n/.exec(hq);
  var bl = readFile('venueplay/app/billing.html'), n = /    function cell\(s\)\{[^\n]*\}\n/.exec(bl);
  check('hq.html still has its own csvCell to test', !!m);
  check('billing.html still has its own draws cell() to test', !!n);
  if (m) { var hqCell = (0, eval)('(' + m[0].replace(/^function csvCell/, 'function') + ')');
    check('HQ export: =HYPERLINK is neutralised', /^"?'/.test(hqCell('=HYPERLINK("http://x","hi")')), hqCell('=HYPERLINK("http://x","hi")'));
    check('HQ export: a plain venue name is untouched', hqCell('Royal Hotel') === 'Royal Hotel'); }
  if (n) { var dlCell = (0, eval)('(' + n[0].trim().replace(/^function cell/, 'function') + ')');
    check('draws download: -1 is neutralised', /^"'/.test(dlCell('-1')), dlCell('-1'));
    check('draws download: @SUM is neutralised', /^"'/.test(dlCell('@SUM(A1)')), dlCell('@SUM(A1)'));
    check('draws download: a plain winner is untouched', dlCell('Pat Smith') === '"Pat Smith"'); }
})();

var o1 = owner();
if (o1 && !o1.error) {
  check('with the read working, a manager with billing:false is restricted', vpbCan(o1, 'billing') === false, o1.perms);
  PERMS_DOWN = true;
  var o2 = owner();
  check('with the read FAILING, they are refused, not promoted', !!(o2 && o2.error) && o2.status === 503, o2);
  check('and they are certainly not handed billing', !(o2 && !o2.error && vpbCan(o2, 'billing')), o2);
} else {
  check('vpbRequireOwner ran under this harness (the stubs match the shipped shape)', false, o1);
}

print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
