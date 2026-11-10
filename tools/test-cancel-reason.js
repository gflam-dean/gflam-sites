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
   5. The free-month cancel page (venueplay/prospect/cancel/) asks the same seven, from the Worker's
      one list, optional; recorded the same way; shown on the prospect in HQ (Dean, 10 Nov 2026).

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

/* ---------- 5. the free-month cancel page asks the same seven (Dean, 10 Nov 2026, INBOX 131) ----------
   venueplay/prospect/cancel/ ("Cancel, it's not for us", the link in every trial email) asked nothing.
   Now: the Worker's JSON question carries the seven from VPA_CANCEL_REASONS, the page draws them, the
   POST carries what they picked and typed, and the Worker records it the way a paid cancel does
   (reason / reason_label / reason_detail). Optional throughout: the cancel happens whatever they say. */
print('the free-month cancel page');
check('the list a page shows is the seven, in order, in the stored words, never the retired two',
      JSON.stringify(vpaCancelReasonList()) === JSON.stringify(SEVEN.map(function (k) { return { key: k, label: VPA_CANCEL_REASONS[k] }; })), vpaCancelReasonList());
/* jsc has no URL or Response: the smallest stand-ins the cancel route reads (the same as test-prospect-free-month.js). */
if (typeof URL === 'undefined') URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {};
  this.pathname = (q >= 0 ? u.slice(0, q) : u).replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
if (typeof Response === 'undefined') Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.text = function () { return Promise.resolve(body); }; };
var P_ENV = { SUPABASE_URL: 'https://example.invalid', SITE_URL: 'https://venueplay.com.au' };
var pRow, pVenue, pAudit, pFetch;
function parm() {
  pRow = { venue_id: 'pv1', founding_id: 'fid1', cancelled_at: null };
  pVenue = { id: 'pv1', name: 'Lakeside Tavern', status: 'active', suspended_reason: null };
  pAudit = []; pFetch = [];
  vpaProspectCancelToken = function (env, fid) { return Promise.resolve(fid ? 'tok' + fid : ''); };
  vpaProspectRowFor = function () { return Promise.resolve(pRow); };
  vpaSelect = function (env, table) { return Promise.resolve(table === 'vp_venues' ? [pVenue] : []); };
  vpaProspectPatch = function (env, id, patch) { for (var k in patch) pRow[k] = patch[k]; return Promise.resolve(true); };
  fetch = function (url, o) { pFetch.push([String(url), o && o.method, o && o.body]);
    if (/vp_venues/.test(url) && o && o.method === 'PATCH') { var b = JSON.parse(o.body); for (var k in b) pVenue[k] = b[k]; }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve(''); } }); };
  vpaAudit = function (env, actor, action, target, detail) { pAudit.push({ action: action, target: target, detail: detail }); return Promise.resolve(true); };
}
function pcall(method, qs, body) {
  var req = { method: method, url: 'https://api.venueplay.com.au/prospect/cancel' + (qs ? '?' + qs : ''),
              headers: { get: function () { return null; } }, text: function () { return Promise.resolve(body || ''); } };
  var out = null;
  vpaProspectCancel(req, P_ENV, function (b) { return { json: b }; })
    .then(function (r) { out = r; }, function (e) { out = { json: { error: 'THREW ' + e } }; });
  drainMicrotasks();
  return out;
}
parm();
var ask = pcall('GET', 'f=fid1&t=tokfid1&reply=json');
check('the page\'s question (GET, reply=json) carries the seven, and writes nothing',
      ask && ask.json && ask.json.state === 'ask' && JSON.stringify(ask.json.reasons) === JSON.stringify(vpaCancelReasonList()) && !pRow.cancelled_at && !pAudit.length, ask && ask.json);
parm();
var plainPage = null;
vpaProspectCancel({ method: 'GET', url: 'https://api.venueplay.com.au/prospect/cancel?f=fid1&t=tokfid1', headers: { get: function () { return null; } }, text: function () { return Promise.resolve(''); } }, P_ENV, null)
  .then(function (r) { return r.text(); }).then(function (t) { plainPage = t; });
drainMicrotasks();
check('an old link opening the Worker\'s own page asks the same seven, optional, above the same button',
      !!plainPage && SEVEN.every(function (k) { return plainPage.indexOf('<option value="' + k + '">' + vpaEsc(VPA_CANCEL_REASONS[k]) + '</option>') !== -1; })
      && /name="reason_detail"/.test(plainPage) && /Pick one \(optional\)/.test(plainPage) && plainPage.indexOf('trial') === -1 && /Yes, cancel it/.test(plainPage), plainPage && plainPage.slice(0, 300));
var pBase = null;
['', 'reason=closing&reason_detail=' + encodeURIComponent('  Sold to\nnew owners  '), 'reason=constructor', 'reason_detail=just+a+note'].forEach(function (extra, i) {
  parm();
  var r = pcall('POST', '', 'f=fid1&t=tokfid1&reply=json' + (extra ? '&' + extra : ''));
  var shape = JSON.stringify([r && r.json, pVenue.status, pVenue.suspended_reason, !!pRow.cancelled_at, pFetch.map(function (c) { return c[0] + ' ' + c[1] + ' ' + c[2]; })]);
  if (i === 0) {
    pBase = shape;
    check('no reason: cancelled and switched off as before, and the reason is recorded as not given',
          r && r.json && r.json.state === 'done' && pVenue.status === 'suspended' && pVenue.suspended_reason === 'cancelled' && !!pRow.cancelled_at
          && pAudit.length === 1 && pAudit[0].action === 'prospect_cancelled' && pAudit[0].detail.reason === null && pAudit[0].detail.reason_label === null
          && pAudit[0].detail.reason_detail === null && pAudit[0].detail.name === 'Lakeside Tavern', [r && r.json, pAudit]);
  } else {
    check('"' + extra.slice(0, 30) + '": the same cancel as giving no reason', shape === pBase, { got: shape, want: pBase });
  }
  if (i === 1) check('a reason and a note are recorded the way a paid cancel records them',
          pAudit[0].detail.reason === 'closing' && pAudit[0].detail.reason_label === VPA_CANCEL_REASONS.closing && pAudit[0].detail.reason_detail === 'Sold to new owners', pAudit[0].detail);
  if (i === 2) check('a made-up reason is "Something else", never refused', pAudit[0].detail.reason === 'other' && pAudit[0].detail.reason_label === 'Something else', pAudit[0].detail);
  if (i === 3) check('a note with no reason is kept', pAudit[0].detail.reason === null && pAudit[0].detail.reason_detail === 'just a note', pAudit[0].detail);
});

/* The page itself, run with a fake page and network: it draws the Worker's list, sends what was picked. */
var CPAGE = readFile('venueplay/prospect/cancel/index.html');
var cscripts = CPAGE.match(/<script>([\s\S]*?)<\/script>/g) || [];
var ccode = cscripts.length ? cscripts[cscripts.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
function crun(answers, pickVal, noteVal) {
  var els = {}, calls = [], q = answers.slice();
  ['head', 'lede', 'ask', 'go', 'err', 'foot', 'why', 'whyPick', 'whyMore'].forEach(function (id) {
    els[id] = { id: id, textContent: '', className: id === 'why' ? 'why hidden' : '', innerHTML: '', value: '', disabled: false, on: {},
                addEventListener: function (t, fn) { this.on[t] = fn; } };
  });
  var doc = { getElementById: function (id) { return els[id] || null; } };
  var win = { location: { search: '?f=fid1&t=tokfid1' } };
  var net = function (url, o) { calls.push({ url: String(url), method: (o && o.method) || 'GET', body: o && o.body });
    var a = q.length ? q.shift() : null;
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(a); } }); };
  new Function('document', 'window', 'location', 'fetch', ccode)(doc, win, win.location, net);
  drainMicrotasks();
  els.whyPick.value = pickVal || ''; els.whyMore.value = noteVal || '';
  els.go.on.click(); drainMicrotasks();
  var post = calls.filter(function (c) { return c.method === 'POST'; })[0] || {};
  var form = {}; String(post.body || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) form[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  return { els: els, form: form };
}
var ASKJ = { ok: true, state: 'ask', title: 'Cancel venueplay for Lakeside Tavern?', text: 'x', reasons: vpaCancelReasonList() };
var DONEJ = { ok: true, state: 'done', title: 'All done', text: 'y' };
var C1 = crun([ASKJ, DONEJ], 'switched', '  We moved to another quiz app  ');
var drawn = [], ore = /<option value="([a-z_]*)">([^<]*)<\/option>/g, om;
while ((om = ore.exec(C1.els.whyPick.innerHTML))) drawn.push([om[1], om[2]]);
check('the page shows the question once the Worker sends the list, with the seven in its words',
      C1.els.why.className === 'why' && drawn.length === 8 && drawn[0][0] === '' &&
      drawn.slice(1).every(function (o, i) { return o[0] === SEVEN[i] && o[1] === esc(VPA_CANCEL_REASONS[SEVEN[i]]); }), drawn);
check('the button posts what they picked and typed, with the account and its signature',
      C1.form.f === 'fid1' && C1.form.t === 'tokfid1' && C1.form.reply === 'json' && C1.form.reason === 'switched'
      && C1.form.reason_detail === 'We moved to another quiz app', C1.form);
var C2 = crun([ASKJ, DONEJ], '', '');
check('skipping both still cancels: the POST goes, with no reason fields', C2.form.f === 'fid1' && C2.form.t === 'tokfid1'
      && !('reason' in C2.form) && !('reason_detail' in C2.form), C2.form);
var C3 = crun([{ ok: true, state: 'ask', title: 'Cancel?', text: 'x' }, DONEJ], '', '');
check('a Worker that sends no list: no question shown, and the button still cancels', C3.els.why.className === 'why hidden' && C3.form.f === 'fid1', C3.els.why.className);
var cText = CPAGE.replace(/<!--[\s\S]*?-->/g, '');
check('the page has no reason words of its own (one list, the Worker\'s)',
      SEVEN.every(function (k) { return cText.indexOf(VPA_CANCEL_REASONS[k]) === -1 && cText.indexOf(VPA_CANCEL_REASONS[k].replace('’', '&rsquo;')) === -1 && cText.indexOf(VPA_CANCEL_REASONS[k].replace('’', '\\u2019')) === -1; }));
check('both fields say optional and nothing on the page talks price or discounts',
      /what&rsquo;s the main reason\? \(optional\)<\/label>/.test(cText) && /like to tell us\? \(optional\)<\/label>/.test(cText)
      && !/\$\d|discount|cheaper|felt fair|special rate|half price|% off/i.test(cText.replace(/\/\*[\s\S]*?\*\//g, '')));

/* HQ > Prospects shows it on a cancelled prospect, from the Worker's cancel_reason. */
var PRJS = readFile('venueplay/app/vp-prospects-hq.js');
eval(lift(PRJS, 'prEsc'));
eval(lift(PRJS, 'whyHtml'));
var w1 = whyHtml({ cancel_reason: { reason: 'closing', label: VPA_CANCEL_REASONS.closing, note: 'New owners <March>' } });
check('a cancelled prospect\'s reason and note show in HQ, escaped',
      w1.indexOf(prEsc(VPA_CANCEL_REASONS.closing)) === 0 && w1.indexOf('New owners &lt;March&gt;') !== -1 && w1.indexOf('<March>') === -1, w1);
check('a skipped reason reads "Not given"', /Not given/.test(whyHtml({ cancel_reason: null })));
check('the card draws it only for a cancelled prospect', /\(st === "cancelled" \? '<div><span class="k">Why they cancelled<\/span><span data-pr-why="1">' \+ whyHtml\(p\)/.test(PRJS));

/* The Worker's prospects list attaches the newest prospect_cancelled reason to each cancelled prospect. */
var PROWS = [
  { venue_id: 'pa', founding_id: 'fa', created_at: '2026-11-01T00:00:00Z', cancelled_at: '2026-11-05T00:00:00Z', first_signin_at: '2026-11-01T01:00:00Z' },
  { venue_id: 'pb', founding_id: 'fb', created_at: '2026-11-01T00:00:00Z', cancelled_at: '2026-11-06T00:00:00Z', first_signin_at: '2026-11-01T01:00:00Z' },
  { venue_id: 'pc', founding_id: 'fc', created_at: '2026-11-01T00:00:00Z', first_signin_at: '2026-11-01T01:00:00Z' }];
var AUD = [
  { action: 'prospect_cancelled', target: 'venue:pa', created_at: '2026-11-05T00:00:00Z', detail: { reason: 'players', reason_label: VPA_CANCEL_REASONS.players, reason_detail: 'Too quiet' } },
  { action: 'prospect_cancelled', target: 'venue:pa', created_at: '2026-10-01T00:00:00Z', detail: { reason: 'expensive', reason_label: 'old' } },
  { action: 'prospect_unpaused', target: 'venue:pb', created_at: '2026-11-07T00:00:00Z', detail: { reason: 'expensive' } },
  { action: 'prospect_cancelled', target: 'venue:pb', created_at: '2026-11-06T00:00:00Z', detail: { name: 'B', reason: null } }];
var auditAsked = '';
vpaSelectAll = function (env, table, q) {
  if (table === 'vp_prospects') return Promise.resolve(PROWS);
  if (table === 'vp_venues') return Promise.resolve(PROWS.map(function (r) { return { id: r.venue_id, name: r.venue_id, status: 'active', founding_id: r.founding_id }; }));
  if (table === 'vp_admin_audit') { auditAsked = q; return Promise.resolve(AUD); }
  return Promise.resolve([]);
};
vpaProspectOfferCodes = function () { return Promise.resolve({}); };
vpaProspectLastSignIn = function () { return Promise.resolve({ at: Date.parse('2026-11-01T01:00:00Z'), known: true }); };
vpaProspectRateInfo = function () { return {}; };
var PD = null;
vpaProspectsData(ENV, {}).then(function (d) { PD = d; }, function (e) { PD = { error: 'THREW ' + e }; });
drainMicrotasks();
var byV = {}; ((PD && PD.prospects) || []).forEach(function (p) { byV[p.venue_id] = p; });
check('HQ\'s list asks only for prospect_cancelled rows of the cancelled ones',
      /^action=eq\.prospect_cancelled&target=in\.\(/.test(auditAsked) && auditAsked.indexOf('venue%3Apa') !== -1 && auditAsked.indexOf('venue%3Apc') === -1, auditAsked);
check('a cancelled prospect carries its newest reason and note',
      byV.pa && JSON.stringify(byV.pa.cancel_reason) === JSON.stringify({ reason: 'players', label: VPA_CANCEL_REASONS.players, note: 'Too quiet' }), byV.pa && byV.pa.cancel_reason);
check('one that skipped it carries null (HQ: Not given); another action\'s row is never read as the reason',
      byV.pb && byV.pb.cancel_reason === null, byV.pb && byV.pb.cancel_reason);
check('a prospect still in its free month carries no cancel reason', byV.pc && !('cancel_reason' in byV.pc), byV.pc);

if (fails) { throw new Error('cancel reason: ' + fails + ' failed'); }
print('PASS');
