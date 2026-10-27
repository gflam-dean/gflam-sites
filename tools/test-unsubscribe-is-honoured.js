/* Does asking us to stop actually stop us?

   Found 17 Sep 2026: unsubscribing WORKED. The page wrote a row to vp_unsubscribes and a live
   test landed one. Then nothing anywhere read it, so a venue could opt out and appear on the
   very next list we used to market to them. Spam Act, and the one fault here that carries a
   fine rather than an apology.

   This RUNS vpaHandleVenueMarketingExport. Only global fetch is replaced, so the real query
   vpaUnsubscribedSet builds, the real matching and the real CSV are all exercised.

   Run:  jsc tools/test-unsubscribe-is-honoured.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var LOGS = [];
console = { log: function (m) { LOGS.push(String(m)); } };
(0, eval)(src);

var ENV = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_KEY: 'k' };
var asked;

function arm(opts) {
  asked = [];
  vpaRequireAdmin = function () { return Promise.resolve({ id: 'a1', label: 'dean', role: 'owner' }); };
  vpaAudit = function (e, a, action, t, detail) { asked.push({ audit: action, detail: detail }); return Promise.resolve({}); };
  fetch = function (url) {
    url = String(url); asked.push(url);
    function ok(body) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); },
                               text: function () { return Promise.resolve(JSON.stringify(body)); } });
    }
    if (/vp_unsubscribes/.test(url)) {
      if (opts.unsubDown) return Promise.resolve({ ok: false, status: 500,
        json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('boom'); } });
      if (opts.unsubGarbage) return ok({ not: 'a list' });
      /* OFFSET THEN LIMIT, WITH THE SERVER'S OWN MAX-ROWS, the way PostgREST does it. This
         fake used to hand back the whole list whatever it was asked, which is why the suite
         was green over a read that silently stopped at 1,000 opt-outs: it could not model
         the one fault that mattered. Fourth suite in this repo found doing that. */
      var all = (opts.unsubscribed || []).map(function (e) { return { email: e }; });
      var off = /[?&]offset=(\d+)/.exec(url), lim = /[?&]limit=(\d+)/.exec(url);
      var from = off ? +off[1] : 0, want = Math.min(lim ? +lim[1] : 1000, 1000);
      return ok(all.slice(from, from + want));
    }
    if (/venueplay_founding/.test(url)) return ok(opts.venues || []);
    return ok([]);
  };
}

function run(opts) {
  arm(opts);
  var out = null;
  vpaHandleVenueMarketingExport({}, ENV, function (b, st) { return { body: b, status: st || 200 }; })
    .then(function (r) { out = r; })
    .catch(function (e) { out = { body: { error: 'THREW: ' + e }, status: 0 }; });
  drainMicrotasks();
  return out;
}
function venue(email, name) {
  return { venue_name: name || 'The Pub', contact_name: 'Pat', contact_email: email, mobile: '0400000000',
           postcode: '4220', created_at: '2026-08-01T00:00:00Z', status: 'card_on_file' };
}

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('asking us to stop actually stops us');

/* 1. The ordinary case: opted in, never opted out, still on the list. */
var r1 = run({ venues: [venue('pat@thepub.com.au')] });
check('opted in and still in: exported', r1.body.count === 1 && /pat@thepub\.com\.au/.test(r1.body.csv), r1.body);
check('opted in and still in: nothing held back', r1.body.held_back_unsubscribed === 0, r1.body.held_back_unsubscribed);

/* 2. THE FAULT. Opted in once, asked us to stop since. The later answer is the one that counts. */
var r2 = run({ venues: [venue('pat@thepub.com.au')], unsubscribed: ['pat@thepub.com.au'] });
check('asked us to stop: NOT in the file', !/pat@thepub\.com\.au/.test(r2.body.csv), r2.body.csv);
check('asked us to stop: count is zero', r2.body.count === 0, r2.body.count);
check('asked us to stop: and we are TOLD one was held back', r2.body.held_back_unsubscribed === 1, r2.body);
check('asked us to stop: the audit trail records it',
  asked.some(function (a) { return a && a.audit === 'venue_marketing_exported' && a.detail.held_back_unsubscribed === 1; }), asked);

/* 3. Addresses are not typed consistently by anybody, ever. */
var r3 = run({ venues: [venue('  PAT@ThePub.com.au ')], unsubscribed: ['pat@thepub.com.au'] });
check('different case and spacing: still held back', r3.body.count === 0 && r3.body.held_back_unsubscribed === 1, r3.body);
var r4 = run({ venues: [venue('pat@thepub.com.au')], unsubscribed: ['  PAT@THEPUB.COM.AU  '] });
check('shouty unsubscribe row: still matches', r4.body.count === 0, r4.body);

/* 4. Mixed list: one out, two in. The two must still get their mail. */
var r5 = run({ venues: [venue('a@x.com','A'), venue('b@x.com','B'), venue('c@x.com','C')], unsubscribed: ['b@x.com'] });
check('one of three out: the other two still export', r5.body.count === 2 && !/b@x\.com/.test(r5.body.csv), r5.body);

/* 5. FAILS CLOSED. vpaSelect answers [] for any non-2xx, so a database wobble would otherwise
      read as "nobody has ever unsubscribed" and export every single one of them. */
var r6 = run({ venues: [venue('pat@thepub.com.au')], unsubscribed: ['pat@thepub.com.au'], unsubDown: true });
check('cannot read the stop list: refuses, and exports NOTHING', !r6.body.csv && !!r6.body.error, r6.body);
check('cannot read the stop list: says why, in words a person can act on',
  /unsubscribe/i.test(r6.body.error || '') && /try again/i.test(r6.body.error || ''), r6.body.error);
check('cannot read the stop list: 503, not a silent success', r6.status === 503, r6.status);

/* 6. A reply that is not a list at all must not read as an empty one. */
var r7 = run({ venues: [venue('pat@thepub.com.au')], unsubGarbage: true });
check('stop list comes back malformed: refuses too', !r7.body.csv && !!r7.body.error, r7.body);

/* 7. It really did ask the table, rather than matching on something it already had. */
run({ venues: [venue('a@x.com')] });
check('it actually queries vp_unsubscribes',
  asked.some(function (a) { return typeof a === 'string' && /vp_unsubscribes\?select=email/.test(a); }), asked);

/* THE 1,001ST PERSON TO SAY STOP. The list was read in one bare fetch and PostgREST stops at
   1000 rows in silence, so everyone past it went back on the marketing export. 1,500
   opt-outs here, and the venue we care about sorts LAST, well past the first page. */
var many = [];
for (var i = 0; i < 1499; i++) many.push('a' + ('0000' + i).slice(-4) + '@example.com.au');
many.push('zz-last@thepub.com.au');
var r9 = run({ venues: [venue('zz-last@thepub.com.au')], unsubscribed: many });
check('1,500 opt-outs: the one past row 1,000 is STILL held back',
      !/zz-last@thepub\.com\.au/.test(r9.body.csv || '') && r9.body.held_back_unsubscribed === 1, r9.body);
check('and it took more than one page to know that',
      asked.filter(function (u) { return /vp_unsubscribes/.test(String(u)); }).length >= 2,
      asked.filter(function (u) { return /vp_unsubscribes/.test(String(u)); }).length);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('unsubscribe: ' + fails + ' failed'); }
