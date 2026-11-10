/* WHY ARE YOU CANCELLING (Dean, 10 Nov 2026: "When a venue clicks Cancel, ASK them why they're
   cancelling, a short reason picker plus an optional note, and record it for HQ").

   Four things, each RUN rather than read:
   1. vpbCancelVenue out of the shipped Worker, against fakes that record every call. The
      reason is stored with its exact label and the note, and THE CANCELLATION ITSELF IS THE
      SAME whatever they pick or skip: the same venue write, the same Stripe sync, the same
      alert and confirm emails, the same answer. Billing is tier one; a reason must never
      change what happens to the money.
   2. Anything odd ("constructor", a made-up key, nothing at all) still cancels.
   3. The page's seven choices are the Worker's seven, word for word, and the dialog says
      nothing about price, discounts or what would be "fair".
   4. HQ's Details panel shows the reason and their note for a venue that is leaving.

   Run:  jsc tools/test-cancel-reason.js
*/
var SRC = 'venueplay-backend/worker/venueplay-api-FULL.js';
var src = readFile(SRC)
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);   // the shipped Worker, run in this process so its own functions are what is tested
/* The Worker's const is not visible out here, so read the same literal from the same file. */
var VPA_CANCEL_REASONS = (0, eval)('(' + /const VPA_CANCEL_REASONS = (\{[\s\S]*?\n\});/.exec(src)[1] + ')');

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

var ENV = { SUPABASE_URL: 'https://example.invalid' };
var row, calls, audits;
function arm() {
  row = { id: 'v1', name: 'The Royal Hotel', slug: 'the-royal', status: 'active', suspended_reason: null,
          cancel_at_period_end: false, max_players: 100, postcode: '4220', created_at: '2026-01-01T00:00:00Z' };
  calls = []; audits = [];
  vpbRequireOwner = function () {
    var v = {}; for (var k in row) v[k] = row[k];
    return Promise.resolve({ account: { id: 'acct_1', plan: 'monthly', stripe_subscription_id: 'sub_1', contact_name: 'Jo' },
                             venues: [v], perms: null, adminActor: null, authUserId: 'user_1' });
  };
  vpbOwnerOnly = function () { return null; };
  vpaSelect = function () { return Promise.resolve([]); };
  vpaPatch = function (env, table, q, body) {
    calls.push(['patch', table, q, JSON.stringify(body)]);
    if (table === 'vp_venues') for (var k in body) row[k] = body[k];
    return Promise.resolve({});
  };
  vpaSyncAccountQuantity = function (env, acct, sub) {
    calls.push(['stripe-sync', acct, sub]);
    return Promise.resolve({ periodEnd: 1790000000, monthly: '$250.00', priceId: 'price_x',
                             sub: { items: { data: [{ price: { unit_amount: 250 } }] } } });
  };
  vpaInsert = function (env, table, body) { audits.push(body); return Promise.resolve({}); };
  vpaFireCancelAlert = function (env, o) {
    calls.push(['alert', o.venueId, o.name, o.undo, o.ends, o.players, o.monthly]);
    calls.alertReason = o.reason; calls.alertDetail = o.reasonDetail;
    return Promise.resolve();
  };
  vpaFireCancelConfirm = function (env, o) {
    calls.push(['confirm', o.venueId, o.name, o.ends, o.endTs, o.timezone, o.players, o.rateCents, o.rate, o.founding, o.contactName]);
    return Promise.resolve();
  };
}
function press(body) {
  var req = { json: function () { return Promise.resolve(body); },
              text: function () { return Promise.resolve(JSON.stringify(body)); } };
  var out = null;
  vpbCancelVenue(req, ENV, function (b, status) { return { body: b, status: status || 200 }; })
    .then(function (r) { out = r; }, function (e) { out = { body: { error: 'THREW ' + e }, status: 0 }; });
  drainMicrotasks();
  return out;
}
function run(body) { arm(); var r = press(body); return { r: r, calls: calls, audit: audits[0] || null, row: row }; }

/* ---------- 1. the cancellation is the same, whatever they say ---------- */
print('skip the reason: the baseline cancellation');
var base = run({ venue_id: 'v1' });
check('it cancels', base.r && base.r.status === 200 && base.r.body.ok === true && base.r.body.cancelling === true, base.r);
check('the venue is flagged to cancel at period end', base.row.cancel_at_period_end === true && base.row.status === 'active', base.row);
check('Stripe is synced once, for this account and subscription',
      base.calls.filter(function (c) { return c[0] === 'stripe-sync'; }).length === 1
      && JSON.stringify(base.calls.filter(function (c) { return c[0] === 'stripe-sync'; })[0]) === JSON.stringify(['stripe-sync', 'acct_1', 'sub_1']), base.calls);
check('the alert and the confirm email both go', base.calls.some(function (c) { return c[0] === 'alert'; })
      && base.calls.some(function (c) { return c[0] === 'confirm'; }), base.calls);
check('the reason is recorded as not given', base.audit && base.audit.detail.reason === null && base.audit.detail.reason_label === null
      && base.audit.detail.reason_detail === null, base.audit);

var SEVEN = ['not_using', 'expensive', 'players', 'closing', 'switched', 'pausing', 'other'];
SEVEN.forEach(function (k) {
  var t = run({ venue_id: 'v1', reason: k, reason_detail: '  Our  quiz\nnight moved.  ' });
  check(k + ': the same venue write, Stripe sync, emails and answer as skipping',
        JSON.stringify(t.calls) === JSON.stringify(base.calls) && JSON.stringify(t.r) === JSON.stringify(base.r),
        { got: t.calls, want: base.calls });
  check(k + ': stored with the exact words the page showed',
        t.audit && t.audit.action === 'venue_cancel_scheduled' && t.audit.target === 'venue:v1'
        && t.audit.detail.reason === k && t.audit.detail.reason_label === VPA_CANCEL_REASONS[k], t.audit);
  check(k + ': their note is kept, tidied to one line',
        t.audit && t.audit.detail.reason_detail === 'Our  quiz night moved.', t.audit && t.audit.detail);
  check(k + ': the alert to us carries it', t.calls.alertReason === k && t.calls.alertDetail === 'Our  quiz night moved.',
        [t.calls.alertReason, t.calls.alertDetail]);
});

/* ---------- 2. nothing a form sends can stop them leaving ---------- */
print('odd answers still cancel');
[['constructor', 'other'], ['__proto__', 'other'], ['made_up', 'other'], ['trial', 'trial'], ['dislike', 'dislike']].forEach(function (p) {
  var t = run({ venue_id: 'v1', reason: p[0] });
  check('"' + p[0] + '" cancels the same and is stored as ' + p[1],
        JSON.stringify(t.calls) === JSON.stringify(base.calls) && t.audit && t.audit.detail.reason === p[1]
        && typeof t.audit.detail.reason_label === 'string' && t.audit.detail.reason_label === VPA_CANCEL_REASONS[p[1]], t.audit);
});
var longNote = run({ venue_id: 'v1', reason: 'other', reason_detail: new Array(3001).join('x') });
check('a very long note is cut to 2000 characters, never refused', longNote.r.status === 200
      && longNote.audit.detail.reason_detail.length === 2000, longNote.audit && longNote.audit.detail.reason_detail.length);
var undo = run({ venue_id: 'v1', undo: true, reason: 'expensive', reason_detail: 'x' });
check('an undo records no reason', undo.audit && undo.audit.action === 'venue_cancel_undone' && undo.audit.detail.reason === null
      && undo.audit.detail.reason_detail === null, undo.audit);

/* ---------- 3. the page and the Worker say the same seven things ---------- */
print('the billing page');
var PAGE = readFile('venueplay/app/billing.html');
var a = PAGE.indexOf('function askWhy('), b = PAGE.indexOf('function showMsg(', a);
var dlg = PAGE.slice(a, b);
check('the dialog is found', a > 0 && b > a);
function unq(s) { return s.replace(/\\u2019/g, '’').replace(/&rsquo;/g, '’'); }
var opts = [], re = /<option value="([a-z_]+)">([^<]+)<\/option>/g, m;
while ((m = re.exec(dlg))) opts.push([m[1], unq(m[2])]);
check('seven choices, in order', JSON.stringify(opts.map(function (o) { return o[0]; })) === JSON.stringify(SEVEN), opts);
check('each choice reads exactly as the Worker stores it',
      opts.length === 7 && opts.every(function (o) { return VPA_CANCEL_REASONS[o[0]] === o[1]; }), opts);
check('the heading asks for the main reason', /Before you go, what\\u2019s the main reason\?/.test(dlg));
check('the note box is always there and says optional',
      /id="whyMoreWrap" class="dlgmore">/.test(dlg) && /\(optional\)<\/label>/.test(dlg) && !/moreWrap\.style\.display/.test(dlg));
var copy = dlg.replace(/\/\*[\s\S]*?\*\//g, '');
check('nothing in the dialog talks price, discounts or what is fair',
      !/\$\d|discount|cheaper|felt fair|special rate|half price|% off/i.test(copy), (copy.match(/\$\d|discount|cheaper|felt fair|special rate|half price|% off/i) || [])[0]);
check('the reason and the note are what the page posts',
      /api\("\/account\/cancel-venue", \{ venue_id:v\.id, reason:reason, reason_detail:detail \}\)/.test(PAGE));
check('lowercase venueplay and no em dashes in the choices', opts.every(function (o) { return !/VenuePlay|—/.test(o[1]); }));

/* ---------- 4. HQ shows it on the venue ---------- */
print('HQ, the venue Details panel');
var HQ = readFile('venueplay/app/hq.html');
function lift(s, name) {
  var mm = new RegExp('function\\s+' + name + '\\s*\\(').exec(s); if (!mm) return null;
  var i = s.indexOf('{', mm.index), d = 0;
  for (var j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(mm.index, j + 1); } }
  return null;
}
var S = { cancelAudit: [] }, leaving = {};
eval(lift(HQ, 'esc'));   // HQ's own escaper, not a copy of it
function isCancelling(v) { return !!leaving[v.id]; }
function hasLeft(v) { return v.status === 'suspended' && v.suspended_reason === 'ended'; }
function cxWhen(iso) { return iso ? iso.slice(0, 10) : ''; }
eval(lift(HQ, 'cxVenueId'));
var body = lift(HQ, 'cxReasonHtml');
check('cxReasonHtml is in hq.html', !!body);
eval(body);
S.cancelAudit = [
  { action: 'venue_cancel_scheduled', target: 'venue:v1', created_at: '2026-11-10T01:00:00Z',
    detail: { reason: 'closing', reason_label: VPA_CANCEL_REASONS.closing, reason_detail: 'New owners <from> March' } },
  { action: 'venue_cancel_scheduled', target: 'venue:v1', created_at: '2026-06-01T01:00:00Z',
    detail: { reason: 'expensive', reason_label: 'old words' } },
  { action: 'venue_cancel_scheduled', target: 'venue:v3', created_at: '2026-11-09T01:00:00Z', detail: { reason: null } },
];
leaving = { v1: true, v3: true };
var h1 = cxReasonHtml({ id: 'v1', status: 'active' });
check('a cancelling venue shows the newest reason, in the words they picked',
      h1.indexOf('Why they cancelled') >= 0 && h1.indexOf(esc(VPA_CANCEL_REASONS.closing)) >= 0 && h1.indexOf('old words') < 0, h1);
check('and their note, escaped', h1.indexOf('New owners &lt;from&gt; March') >= 0 && h1.indexOf('<from>') < 0, h1);
var h3 = cxReasonHtml({ id: 'v3', status: 'active' });
check('a skipped reason reads "Not given"', /Not given/.test(h3), h3);
var h4 = cxReasonHtml({ id: 'v4', status: 'suspended', suspended_reason: 'ended' });
check('a venue that left before we asked reads "Not given"', /Not given/.test(h4), h4);
check('an active venue that is staying shows nothing', cxReasonHtml({ id: 'v2', status: 'active' }) === '');
leaving = {};
check('a venue that undid its cancellation shows nothing', cxReasonHtml({ id: 'v1', status: 'active' }) === '');
check('the Details panel draws it', /'<b>Created<\/b> '\+esc\(fmtWhen\(v\.created_at\)\)\+\n\s+cxReasonHtml\(v\)\+/.test(HQ));

if (fails) { throw new Error('cancel reason: ' + fails + ' failed'); }
print('PASS');
