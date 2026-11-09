/* GROUP INVOICES AND RECEIPTS BROKEN DOWN PER VENUE, RUN (INBOX 44b, Dean, 5 Nov 2026).

   Dean: a group's invoice and receipt should say "<venue>: N players at $X", in a way that does NOT
   change the amount charged.

   How a group is billed (read from the billing Worker, not from Stripe): ONE subscription per account,
   ONE item, quantity = every venue's billed players (vpbAccountTotal), so Stripe writes ONE plan line.
   The split prints that line per venue, and only when the venues add up to it exactly.

   What this runs, with only fetch and the database replaced (no Stripe, no live key, nothing sent):
     (a) the split itself: the rows are the line's own cents, for monthly and annual, and it says
         nothing at all whenever it cannot be exact (drift, one venue, a tiered amount, two plan lines);
     (b) THE TOTAL NEVER CHANGES: every case is rendered BEFORE (the split switched off, which is the
         receipt main sends today) and AFTER, and the amount paid, the subject, the subtotal, GST and
         total, and the sum of every "What this is for" row are identical: a plain 3-venue group, a new
         pub's pro rata stub, the group player limit (a big night, added players, a pending reduction,
         a venue cancelling), free months, a percentage and a dollar discount, annual with a proration;
     (c) the receipt and the payment reminder SHOW the per-venue lines;
     (d) Stripe is touched only behind VPB_GROUP_INVOICE_LINES=1, only on invoice.created, only for a
         draft, and only with description and metadata: never an amount, quantity, price, item or
         coupon. Off (the default), nothing reaches Stripe. invoice.paid makes the same Stripe calls
         with the flag on or off;
     (e) vpbAccountTotal, which sets the Stripe quantity, still sums exactly what it summed before.

   Run from the repo root:  jsc tools/test-group-invoice-lines.js
   An example receipt, before and after:  jsc tools/test-group-invoice-lines.js -- --dump-example
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
/* jsc has no URLSearchParams; vpbStripePost builds its form with one. Same encoding the Worker gets. */
if (typeof URLSearchParams === 'undefined') {
  URLSearchParams = function () { this._k = []; this._v = {}; };
  URLSearchParams.prototype.set = function (k, v) { if (!(k in this._v)) this._k.push(k); this._v[k] = String(v); };
  URLSearchParams.prototype.toString = function () { var self = this; return this._k.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(self._v[k]).replace(/%20/g, '+'); }).join('&'); };
}
(0, eval)(src);

var DUMP = (typeof arguments !== 'undefined' && arguments[0] === '--dump-example');
var fails = 0, ran = 0;
function check(name, ok, saw) {
  ran++;
  if (DUMP) { if (!ok) fails++; return; }
  if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 500))); }
}
function say(t) { if (!DUMP) print(t); }
function visible(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------------------------------------------------------------- the world ---------------------------------------------------------------- */
var sent = [], stripe = [], audits = [], selects = [];
var WORLD = { venues: [], selectThrows: false, stripeReply: null };
fetch = function (url, opts) {
  url = String(url); opts = opts || {};
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var tpl = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(tpl); } }); }
  if (/api\.resend\.com/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e1' }); }, text: function () { return Promise.resolve('{}'); } }); }
  if (/api\.stripe\.com/.test(url)) {
    stripe.push({ url: url, method: opts.method || 'GET', body: opts.body || '', idem: (opts.headers || {})['Idempotency-Key'] || null });
    var reply = WORLD.stripeReply || { id: 'in_ok', object: 'invoice' };
    return Promise.resolve({ ok: !reply.error, status: reply.error ? 400 : 200, json: function () { return Promise.resolve(reply); } });
  }
  // vpbAccountTotal reads vp_venues with its own fetch, so it is answered from the same world.
  if (/\/rest\/v1\/vp_venues\?/.test(url)) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(WORLD.venues); } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
vpaInsert = function (env, table, row) { audits.push({ table: table, row: row }); return Promise.resolve({}); };
vpaPatch = function () { return Promise.resolve({}); };
vpaSelect = function (env, table, q) {
  selects.push(table + '?' + q);
  if (WORLD.selectThrows && table === 'vp_venues') return Promise.reject(new Error('database down'));
  if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', contact_email: 'accounts@group.com.au', payment_reminders: true, plan: 'monthly' }]);
  if (table === 'vp_venues') return Promise.resolve(WORLD.venues);
  return Promise.resolve([]);
};
var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 's', STRIPE_SECRET_KEY: 'test-key-not-real' };
function envOn() { var e = {}; for (var k in ENV) e[k] = ENV[k]; e.VPB_GROUP_INVOICE_LINES = '1'; return e; }

/* Three pubs on one account, the shape Dean asked about. */
function V(id, name, max, extra) { var o = { id: id, name: name, postcode: '4224', max_players: max, pending_players: null, cancel_at_period_end: false, status: 'active' }; for (var k in (extra || {})) o[k] = extra[k]; return o; }
var ROYAL = V('v-royal', 'The Royal Hotel', 20), GRAND = V('v-grand', 'The Grand Hotel', 15), TUGUN = V('v-tugun', 'Tugun Tavern', 10);
var PLAN_M = '45 Players × Founding Membership (Monthly) (at $2.50 / month)';
function planLine(qty, unit, desc, extra) {
  var o = { id: 'il_plan', type: 'subscription', description: desc || (qty + ' Players × Founding Membership (Monthly) (at $' + (unit / 100).toFixed(2) + ' / month)'),
            amount: qty * unit, quantity: qty, proration: false, price: { id: 'price_m', unit_amount: unit, recurring: { interval: 'month' } } };
  for (var k in (extra || {})) o[k] = extra[k];
  return o;
}
function itemLine(desc, cents, qty) { return { id: 'il_' + cents, type: 'invoiceitem', invoice_item: 'ii_' + cents, description: desc, amount: cents, quantity: qty || 1, proration: false }; }
function inv(lines, extra) {
  var sum = lines.reduce(function (n, l) { return n + l.amount; }, 0);
  var o = { id: 'in_group', number: 'VP-0044', customer: 'cus_group', customer_email: 'accounts@group.com.au', status: 'paid',
            amount_paid: sum, amount_due: sum, subtotal: sum, total: sum, billing_reason: 'subscription_cycle', subscription: 'sub_group',
            hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test_44', invoice_pdf: 'https://pay.stripe.com/invoice/acct_x/test_44/pdf',
            next_payment_attempt: 1795000000, lines: { data: lines } };
  for (var k in (extra || {})) o[k] = extra[k];
  return o;
}

/* What a venue reads about the money on a rendered email: everything a total could hide in. */
function money(r) {
  var html = (r && r.html) || '', t = visible(html);
  // Only the "What this is for" table: its rows each carry the row rule, and nothing else on the page does.
  var at = html.indexOf('What this is for'), table = at < 0 ? '' : html.slice(at, html.indexOf('</table>', at));
  var rows = [], m, re = /<tr( data-vp="([a-z]+)")?><td style="padding:[^"]*border-bottom:1px solid #f0f0f3">([^<]*)<\/td><td style="padding:[^"]*border-bottom:1px solid #f0f0f3">(-?)\$([0-9]+\.[0-9]{2})<\/td><\/tr>/g;
  while ((m = re.exec(table))) rows.push({ kind: m[2] || 'line', words: visible(m[3]), cents: (m[4] ? -1 : 1) * Math.round(parseFloat(m[5]) * 100) });
  var charges = rows.filter(function (x) { return x.kind === 'line' || x.kind === 'extra'; });
  function after(label) { var i = t.indexOf(label); if (i < 0) return null; var mm = /\$([0-9,]+\.[0-9]{2})/.exec(t.slice(i + label.length)); return mm ? mm[1] : null; }
  return {
    subject: r && r.subject,
    big: after('Amount paid') || after('Amount due'),
    subtotal: after('Subtotal (excluding GST)'), gst: after('GST '), total: after('Total paid'),
    rowsSum: charges.reduce(function (n, x) { return n + x.cents; }, 0),
    rows: charges, all: rows, text: t,
  };
}
/* The sums printed on a split table are the sums of its charges: each "Total for <venue>" is its block,
   "Total for all venues" is every charge once, and less what came off it is exactly what was paid. */
function sumsHold(mm, paidCents) {
  var block = 0, bad = [], seenTotal = null, less = 0;
  mm.all.forEach(function (x) {
    if (x.kind === 'line') block = x.cents;
    else if (x.kind === 'extra') block += x.cents;
    else if (x.kind === 'sum') { if (x.cents !== block) bad.push(['venue total', x.words, x.cents, block]); }
    else if (x.kind === 'total') seenTotal = x.cents;
    else if (x.kind === 'less') less += -x.cents;
  });
  if (seenTotal === null) bad.push('no account total');
  else {
    if (seenTotal !== mm.rowsSum) bad.push(['account total', seenTotal, mm.rowsSum]);
    if (seenTotal - less !== paidCents) bad.push(['less what came off', seenTotal, less, paidCents]);
  }
  return bad;
}
var realSplit = vpbInvoiceVenueSplit;
async function render(kind, invoice, splitOn) {
  sent = []; selects = [];
  vpbInvoiceVenueSplit = splitOn ? realSplit : function () { return Promise.resolve(null); };
  try {
    if (kind === 'receipt') await vpaFireInvoiceEmail(ENV, invoice); else await vpaFireUpcomingEmail(ENV, invoice);
  } finally { vpbInvoiceVenueSplit = realSplit; }
  return sent[sent.length - 1] || null;
}
/* THE CORE PROMISE: before and after, the money a venue reads is the same, to the cent. */
async function sameMoney(name, kind, invoice, venues, expectRows) {
  WORLD.venues = venues;
  var b = await render(kind, invoice, false), a = await render(kind, invoice, true);
  if (!b && !a) { check(name + ': no email before and none after (nothing was due)', true); return null; }
  var mb = money(b), ma = money(a);
  check(name + ': the amount is identical before and after (' + mb.big + ')', !!mb.big && mb.big === ma.big, [mb.big, ma.big]);
  check(name + ': the subject is identical', mb.subject === ma.subject, [mb.subject, ma.subject]);
  check(name + ': subtotal, GST and total are identical', mb.subtotal === ma.subtotal && mb.gst === ma.gst && mb.total === ma.total,
        [mb.subtotal, mb.gst, mb.total, ma.subtotal, ma.gst, ma.total]);
  // An unsplit single plan line prints no amount (Dean, 5 Nov 2026 round 8: the amount is already above), so its cents are the invoice's own line.
  var lineSum = ((invoice.lines && invoice.lines.data) || []).reduce(function (n, l) { return n + Number(l.amount || 0); }, 0);
  var cents = function (x) { return x.rowsSum > 0 ? x.rowsSum : lineSum; };
  check(name + ': the lines add up to the same cents (' + cents(mb) + ')', cents(mb) === cents(ma) && cents(mb) > 0, [cents(mb), cents(ma)]);
  if (expectRows) {
    var missing = expectRows.filter(function (w) { return ma.text.indexOf(w) === -1; });
    check(name + ': it shows the per-venue lines (' + expectRows.length + ')', missing.length === 0, missing);
    var due = Number(invoice.amount_paid) > 0 ? Number(invoice.amount_paid) : Number(invoice.amount_due || 0);
    var sb = sumsHold(ma, due);
    check(name + ': every venue total, the account total and what came off add up to what Stripe charged (' + due + ')', sb.length === 0, sb);
    check(name + ': and no longer the single group line', /\b\d+ players at \$[0-9.]+ each/.test(mb.text) && ma.all.length >= expectRows.length && ma.all.some(function (x) { return x.kind === 'total'; }), ma.text.slice(0, 300));
  } else {
    check(name + ': nothing new is said, the email is byte for byte what it was', b.html === a.html, ma.text.slice(0, 300));
    check(name + ': and it carries none of the split table\'s markers, so it is the same bytes main sends', a.html.indexOf('data-vp=') === -1);
  }
  return { before: b, after: a, mb: mb, ma: ma };
}

async function main() {
  var ROWS3 = ['The Grand Hotel: 15 players at $2.50 each', 'The Royal Hotel: 20 players at $2.50 each', 'Tugun Tavern: 10 players at $2.50 each'];

  say('(a) The split itself');
  var s = vpbSplitPlanLine(inv([planLine(45, 250)]), [ROYAL, GRAND, TUGUN]);
  check('a 3-venue group of 45 players at $2.50 splits into 3 rows', !!s && s.rows.length === 3, s);
  check('the rows are the plan line\'s own cents: 3750 + 5000 + 2500 = 11250', !!s && s.rows.map(function (r) { return r.cents; }).join(',') === '3750,5000,2500' && s.cents === 11250, s && s.rows);
  check('in Dean\'s words, "<venue>: N players at $X", sorted by name', !!s && s.rows.map(function (r) { return r.words; }).join('|') === ROWS3.join('|'), s && s.rows.map(function (r) { return r.words; }));
  check('one player reads "1 player"', (function () { var x = vpbSplitPlanLine(inv([planLine(21, 250)]), [ROYAL, V('v1', 'The Snug', 1)]); return !!x && x.rows[0].words === 'The Royal Hotel: 20 players at $2.50 each' && x.rows[1].words === 'The Snug: 1 player at $2.50 each'; })());
  check('a venue cancelling at period end is not billed and is not listed', (function () { var x = vpbSplitPlanLine(inv([planLine(45, 250)]), [ROYAL, GRAND, TUGUN, V('v-gone', 'Gone Inn', 8, { cancel_at_period_end: true })]); return !!x && x.rows.length === 3 && x.rows.every(function (r) { return r.name !== 'Gone Inn'; }); })());
  check('a pending reduction is billed at its new number (15 -> 10), the same as the Stripe quantity', (function () { var x = vpbSplitPlanLine(inv([planLine(40, 250)]), [ROYAL, V('v-grand', 'The Grand Hotel', 15, { pending_players: 10 }), TUGUN]); return !!x && x.rows[0].words === 'The Grand Hotel: 10 players at $2.50 each' && x.cents === 10000; })());
  check('annual: "at $27.60 each a year", the line\'s own unit', (function () { var x = vpbSplitPlanLine(inv([planLine(45, 2760, '45 Players × Founding Membership (Annual) (at $27.60 / year)', { price: { unit_amount: 2760, recurring: { interval: 'year' } } })]), [ROYAL, GRAND, TUGUN]); return !!x && x.rows[1].words === 'The Royal Hotel: 20 players at $27.60 each a year' && x.cents === 124200; })());
  check('the newer Stripe line shape (parent.subscription_item_details, no type) is found', (function () { var l = planLine(45, 250); delete l.type; l.parent = { type: 'subscription_item_details', subscription_item_details: { subscription_item: 'si_1' } }; return !!vpbSplitPlanLine(inv([l]), [ROYAL, GRAND, TUGUN]); })());
  check('two Royal Hotels on one account are told apart by postcode', (function () { var x = vpbSplitPlanLine(inv([planLine(30, 250)]), [V('a', 'Royal Hotel', 20, { postcode: '2711' }), V('b', 'Royal Hotel', 10, { postcode: '2550' })]); return !!x && x.rows[0].words === 'Royal Hotel (2550): 10 players at $2.50 each' && x.rows[1].words === 'Royal Hotel (2711): 20 players at $2.50 each'; })());
  say('\n    ...and it says NOTHING new whenever it cannot be exact');
  check('our table says 44, Stripe billed 45: no split', vpbSplitPlanLine(inv([planLine(45, 250)]), [ROYAL, GRAND, V('v-tugun', 'Tugun Tavern', 9)]) === null);
  check('one venue: no split (Stripe\'s line already says it)', vpbSplitPlanLine(inv([planLine(20, 250)]), [ROYAL]) === null);
  check('an amount that is not quantity x one price (tiered, or not ours): no split', vpbSplitPlanLine(inv([planLine(45, 250, null, { amount: 11251, price: { unit_amount: null } })]), [ROYAL, GRAND, TUGUN]) === null);
  check('a price unit that disagrees with the line amount: no split', vpbSplitPlanLine(inv([planLine(45, 250, null, { price: { unit_amount: 300 } })]), [ROYAL, GRAND, TUGUN]) === null);
  check('two plan lines on one invoice: no split', vpbSplitPlanLine(inv([planLine(45, 250), planLine(45, 250)]), [ROYAL, GRAND, TUGUN]) === null);
  check('only a proration line (a mid-cycle change): no split', vpbSplitPlanLine(inv([planLine(45, 250, 'Remaining time on 45 × Founding Membership (Monthly) after 10 Nov 2026', { proration: true })]), [ROYAL, GRAND, TUGUN]) === null);
  check('an extras invoice (only invoice items): no split', vpbSplitPlanLine(inv([itemLine('Big night extra players - The Royal Hotel - 12 over 20 at $2.00', 2400, 12)]), [ROYAL, GRAND, TUGUN]) === null);
  check('a database that fails gives null, never a throw', await (async function () { WORLD.selectThrows = true; try { return (await vpbInvoiceVenueSplit(ENV, inv([planLine(45, 250)]))) === null; } finally { WORLD.selectThrows = false; } })());

  say('\n(b) and (c) THE TOTAL NEVER CHANGES, and the receipt shows the venues');
  var ex = await sameMoney('3-venue group, monthly', 'receipt', inv([planLine(45, 250, PLAN_M)]), [ROYAL, GRAND, TUGUN], ROWS3);
  if (ex) {
    check('3-venue group: the receipt still says $112.50 paid', ex.ma.big === '112.50', ex.ma.big);
    check('3-venue group: the three rows are $37.50, $50.00 and $25.00, then the account total', ex.ma.all.filter(function (r) { return r.kind === 'total'; }).map(function (r) { return r.cents; }).join() === '11250' && ex.ma.rows.map(function (r) { return r.cents; }).join(',') === '3750,5000,2500', ex.ma.rows);
  }
  // A new pub's pro rata stub: Tugun is inside its free month. The plan line bills it in full and the
  // free days come off as a customer credit (vpbAddVenue), which Stripe applies to the invoice total.
  await sameMoney('pro rata stub (a new pub, 8 of 31 days credited)', 'receipt',
    inv([planLine(45, 250, PLAN_M)], { starting_balance: -645, amount_paid: 11250 - 645, amount_due: 11250 - 645 }), [ROYAL, GRAND, V('v-tugun', 'Tugun Tavern', 10, { free_month_at: '2026-11-15T00:00:00Z' })], ROWS3);
  // The group player limit is PER VENUE: a big night at The Royal is its own line, as are added players.
  await sameMoney('the player limit: a big night, added players, a pending reduction and a venue cancelling', 'receipt',
    inv([planLine(40, 250), itemLine('The Royal Hotel - Extra Player - 31/10/2026', 2400, 12), itemLine('The Grand Hotel - Extra Player - 02/11/2026', 1250, 5)]),
    [ROYAL, V('v-grand', 'The Grand Hotel', 15, { pending_players: 10 }), TUGUN, V('v-gone', 'Gone Inn', 8, { cancel_at_period_end: true })],
    ['The Grand Hotel: 10 players at $2.50 each', 'Players added: 5 x $2.50 (02/11/2026)', 'Total for The Grand Hotel $37.50', 'The Royal Hotel: 20 players at $2.50 each', 'Extra players: 12 x $2.00 (31/10/2026)', 'Total for The Royal Hotel $74.00', 'Tugun Tavern: 10 players at $2.50 each', 'Total for all venues $136.50']);
  // DEAN'S EXAMPLE (INBOX 75c), with the 3rd-time rate: The Royal had 2 extras at $2, Tugun its 3rd big
  // night in a row at $1 (the plan moved up), a 33.3% discount and a free-month credit on top.
  ex = await sameMoney('Dean\'s layout: extras per venue, the 3rd-time $1 rate, a discount and a credit', 'receipt',
    inv([planLine(45, 250, PLAN_M), itemLine('The Royal Hotel - Extra Player - 31/10/2026', 400, 2),
         itemLine('Tugun Tavern - Extra Player - 01/11/2026 (3rd big night, plan moved up)', 300, 3)],
        { total_discount_amounts: [{ amount: 3746 }], starting_balance: -645, amount_paid: 11950 - 3746 - 645, amount_due: 11950 - 3746 - 645 }),
    [ROYAL, GRAND, TUGUN],
    ['The Royal Hotel: 20 players at $2.50 each $50.00 Extra players: 2 x $2.00 (31/10/2026) $4.00 Total for The Royal Hotel $54.00',
     'Tugun Tavern: 10 players at $2.50 each $25.00 Extra players: 3 x $1.00 (01/11/2026, 3rd big night, plan moved up) $3.00 Total for Tugun Tavern $28.00',
     'The Grand Hotel: 15 players at $2.50 each $37.50 The Royal Hotel', 'Total for all venues $119.50 Discount -$37.46 Credit on your account -$6.45']);
  var deanEx = ex;
  check('Dean\'s layout: the email still says $75.59 paid', !!ex && ex.ma.big === '75.59', ex && ex.ma.big);
  check('the 3rd-time rate is read off Stripe\'s line ($1.00), never assumed', !!ex && ex.ma.rows.some(function (r) { return r.words === 'Extra players: 3 x $1.00 (01/11/2026, 3rd big night, plan moved up)' && r.cents === 300; }));
  // A third big night whose uplift did NOT happen is charged $2 with no suffix (chargeNightOverage): shown as $2.
  check('a 3rd night that did not move the plan up is $2.00, as Stripe charged it', (function () { var x = vpbSplitPlanLine(inv([planLine(45, 250), itemLine('Tugun Tavern - Extra Player - 01/11/2026', 600, 3)]), [ROYAL, GRAND, TUGUN]); var t = x && x.rows.filter(function (r) { return r.name === 'Tugun Tavern'; })[0]; return !!t && t.extras.length === 1 && t.extras[0].words === 'Extra players: 3 x $2.00 (01/11/2026)' && t.total === 3100; })());
  check('extras for a venue not on this account stay where Stripe put them', (function () { var x = vpbSplitPlanLine(inv([planLine(45, 250), itemLine('Old Pub - Extra Player - 01/11/2026', 400, 2)]), [ROYAL, GRAND, TUGUN]); return !!x && x.taken.length === 0; })());
  check('extras naming one of two same-named venues stay where Stripe put them', (function () { var x = vpbSplitPlanLine(inv([planLine(30, 250), itemLine('Royal Hotel - Extra Player - 01/11/2026', 400, 2)]), [V('a', 'Royal Hotel', 20, { postcode: '2711' }), V('b', 'Royal Hotel', 10, { postcode: '2550' })]); return !!x && x.taken.length === 0; })());
  check('an amount that does not divide by its quantity is not read as extras', vpbExtraLine({ description: 'Tugun Tavern - Extra Player - 01/11/2026', amount: 401, quantity: 2 }) === null);
  // An old balance OWED rides this bill (Stripe adds a positive starting balance): the lines less what came off
  // cannot reach what was paid, so the account rows are left off rather than show a sum Stripe did not charge.
  WORLD.venues = [ROYAL, GRAND, TUGUN];
  var owed = await render('receipt', inv([planLine(45, 250, PLAN_M)], { starting_balance: 500, amount_paid: 11750, amount_due: 11750 }), true);
  var mo = money(owed);
  check('a balance owed riding the bill: the venues are shown, but no account total that would not match $117.50',
        !!owed && mo.big === '117.50' && ROWS3.every(function (w) { return mo.text.indexOf(w) !== -1; }) && !mo.all.some(function (r) { return r.kind === 'total' || r.kind === 'less'; }), mo.all);
  await sameMoney('extras for a venue not on the account', 'receipt', inv([planLine(45, 250, PLAN_M), itemLine('Old Pub - Extra Player - 01/11/2026', 400, 2)]), [ROYAL, GRAND, TUGUN], ROWS3.concat(['Old Pub - Extra Player - 01/11/2026']));
  await sameMoney('the account\'s own free month ($0 invoice)', 'receipt', inv([planLine(45, 250, PLAN_M)], { amount_paid: 0, amount_due: 0, starting_balance: -11250 }), [ROYAL, GRAND, TUGUN], null);
  await sameMoney('a 33.3% discount', 'receipt', inv([planLine(45, 250, PLAN_M)], { total_discount_amounts: [{ amount: 3746, discount: 'di_1' }], amount_paid: 7504, amount_due: 7504 }), [ROYAL, GRAND, TUGUN], ROWS3);
  await sameMoney('a $10 off discount', 'receipt', inv([planLine(45, 250, PLAN_M)], { total_discount_amounts: [{ amount: 1000, discount: 'di_2' }], amount_paid: 10250, amount_due: 10250 }), [ROYAL, GRAND, TUGUN], ROWS3);
  await sameMoney('a 100% (comp) discount', 'receipt', inv([planLine(45, 250, PLAN_M)], { total_discount_amounts: [{ amount: 11250, discount: 'di_3' }], amount_paid: 0, amount_due: 0 }), [ROYAL, GRAND, TUGUN], null);
  await sameMoney('annual, with a proration line beside it', 'receipt',
    inv([planLine(45, 2760, '45 Players × Founding Membership (Annual) (at $27.60 / year)', { price: { unit_amount: 2760, recurring: { interval: 'year' } } }),
         planLine(5, 2760, 'Remaining time on 5 × Founding Membership (Annual) after 10 Nov 2026', { id: 'il_pr', proration: true, amount: 11040, price: { unit_amount: 2760, recurring: { interval: 'year' } } })]),
    [ROYAL, GRAND, TUGUN], ['The Royal Hotel: 20 players at $27.60 each a year', 'Remaining time on 5 × venueplay plan (annual) after 10 Nov 2026']);
  await sameMoney('drift (our table 44, Stripe 45)', 'receipt', inv([planLine(45, 250, PLAN_M)]), [ROYAL, GRAND, V('v-tugun', 'Tugun Tavern', 9)], null);
  await sameMoney('a single venue', 'receipt', inv([planLine(20, 250, '20 Players × Founding Membership (Monthly) (at $2.50 / month)')]), [ROYAL], null);
  await sameMoney('the payment reminder, 3-venue group', 'reminder', inv([planLine(45, 250, PLAN_M)], { amount_paid: 0, status: 'draft' }), [ROYAL, GRAND, TUGUN], ROWS3);
  await sameMoney('the payment reminder, with a discount and a big night', 'reminder',
    inv([planLine(45, 250, PLAN_M), itemLine('Tugun Tavern - Extra Player - 04/11/2026', 800, 4)], { amount_paid: 0, amount_due: 8304, total_discount_amounts: [{ amount: 3746 }], status: 'draft' }),
    [ROYAL, GRAND, TUGUN], ROWS3.concat(['Extra players: 4 x $2.00 (04/11/2026)', 'Total for Tugun Tavern $33.00', 'Discount -$37.46']));
  // Every case at once, many shapes: the rendered lines always add up to what they did.
  var shapes = 0, bad = [];
  for (var a = 1; a <= 6; a++) for (var b = 0; b <= 5; b++) for (var c = 0; c <= 4; c++) {
    var vs = [V('x1', 'Alpha Arms', a * 7), V('x2', 'Bravo Bar', b * 3), V('x3', 'Charlie Club', c * 11)];
    var q = a * 7 + b * 3 + c * 11;
    [250, 300, 2760, 3420].forEach(function (unit) {
      var x = vpbSplitPlanLine(inv([planLine(q, unit)]), vs);
      var listed = vs.filter(function (v) { return v.max_players > 0; }).length;
      shapes++;
      if (listed >= 2 && (!x || x.cents !== q * unit || x.rows.reduce(function (n, r) { return n + r.cents; }, 0) !== q * unit)) bad.push([a, b, c, unit]);
      if (listed < 2 && x !== null) bad.push(['one venue split', a, b, c, unit]);
    });
  }
  check('across ' + shapes + ' group shapes and four prices, every split adds up to the line to the cent', bad.length === 0, bad.slice(0, 5));

  say('\n    The receipt is still safe to read');
  WORLD.venues = [V('e1', 'Bar <b>&</b> "Grill"', 5), GRAND];
  var esc = await render('receipt', inv([planLine(20, 250)]), true);
  check('a venue name is escaped, never HTML', !!esc && esc.html.indexOf('<b>&</b>') === -1 && esc.html.indexOf('Bar &lt;b&gt;&amp;&lt;/b&gt;') !== -1, esc && esc.html.slice(0, 0));
  check('the per-venue receipt says no "founding" and no Gflam', !!ex && !/founding|gflam/i.test(ex.ma.text + ' ' + ex.ma.subject));

  say('\n(d) Stripe is touched only behind VPB_GROUP_INVOICE_LINES, and only with words');
  var DRAFT = inv([planLine(45, 250, PLAN_M)], { status: 'draft', amount_paid: 0, description: null, metadata: {} });
  WORLD.venues = [ROYAL, GRAND, TUGUN];
  async function created(env, invoice) { stripe = []; audits = []; await vpaHandleStripeEvent(env, { id: 'evt_c', type: 'invoice.created', data: { object: invoice } }); }
  await created(ENV, DRAFT);
  check('OFF (the default): invoice.created sends nothing to Stripe', stripe.length === 0, stripe);
  check('OFF: and writes no invoice_venue_lines row', audits.filter(function (x) { return x.row.action === 'invoice_venue_lines'; }).length === 0);
  await created((function () { var e = envOn(); e.VPB_GROUP_INVOICE_LINES = 'true'; return e; })(), DRAFT);
  check('only "1" turns it on ("true" stays off)', stripe.length === 0, stripe);
  await created(envOn(), DRAFT);
  check('ON: one POST, to this draft invoice only', stripe.length === 1 && stripe[0].method === 'POST' && stripe[0].url === 'https://api.stripe.com/v1/invoices/in_group', stripe);
  var form = {}; (stripe[0] ? stripe[0].body : '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); form[decodeURIComponent(p[0].replace(/\+/g, ' '))] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
  var keys = Object.keys(form);
  check('ON: it writes ONLY the description and metadata', keys.length > 0 && keys.every(function (k) { return k === 'description' || /^metadata\[vp_[a-z_0-9]+\]$/.test(k); }), keys);
  check('ON: never an amount, quantity, price, item, line, coupon, discount, tax or balance', !keys.some(function (k) { return /amount|quantit|price|item|line(?!s_)|coupon|discount|tax|balance|auto_advance|collection|due/.test(k.replace(/^metadata\[vp_lines_[a-z]+\]$/, '')); }), keys);
  check('ON: the memo says each venue: "Players by venue: The Grand Hotel: 15 players at $2.50 ($37.50); ..."',
        form.description === 'Players by venue: The Grand Hotel: 15 players at $2.50 each ($37.50); The Royal Hotel: 20 players at $2.50 each ($50.00); Tugun Tavern: 10 players at $2.50 each ($25.00).', form.description);
  await created(envOn(), inv([planLine(45, 250, PLAN_M), itemLine('Tugun Tavern - Extra Player - 01/11/2026 (3rd big night, plan moved up)', 300, 3)], { status: 'draft' }));
  var xform = stripe[0] ? decodeURIComponent(stripe[0].body.replace(/\+/g, ' ')) : '';
  check('ON: the memo carries each venue\'s extras and its total, as Stripe has them',
        xform.indexOf('Tugun Tavern: 10 players at $2.50 each ($25.00), extra players: 3 x $1.00 (01/11/2026, 3rd big night, plan moved up) ($3.00), total for Tugun Tavern $28.00.') !== -1, xform.slice(0, 400));
  check('ON: still only description and metadata with extras on the bill', !!stripe[0] && stripe[0].body.split('&').every(function (kv) { var k = decodeURIComponent(kv.split('=')[0]); return k === 'description' || /^metadata\[vp_[a-z_0-9]+\]$/.test(k); }));
  check('ON: the metadata carries 3 venues and the unit, readable back', form['metadata[vp_lines_n]'] === '3' && form['metadata[vp_lines_unit]'] === '250' && JSON.parse(form['metadata[vp_venue_2]']).n === 'The Royal Hotel' && JSON.parse(form['metadata[vp_venue_2]']).p === 20, form);
  check('ON: keyed once per invoice, so a retried event cannot write twice', stripe[0] && stripe[0].idem === 'vplines:in_group', stripe[0] && stripe[0].idem);
  check('ON: it is written down', audits.some(function (x) { return x.row.action === 'invoice_venue_lines' && x.row.detail.outcome === 'written' && x.row.detail.cents === 11250; }), audits.map(function (x) { return x.row.action; }));
  // Read back: the receipt uses what Stripe was told, not a fresh database read.
  var md = {}; keys.forEach(function (k) { var m2 = /^metadata\[(.+)\]$/.exec(k); if (m2) md[m2[1]] = form[k]; });
  var paidBack = inv([planLine(45, 250, PLAN_M)], { metadata: md, description: form.description });
  WORLD.venues = [ROYAL, GRAND, V('v-tugun', 'Tugun Tavern', 12)];   // the table moved on after the invoice was made
  var back = await render('receipt', paidBack, true);
  check('the receipt reads the rows Stripe was given, even after the table has moved on', !!back && ROWS3.every(function (w) { return visible(back.html).indexOf(w) !== -1; }) && !selects.some(function (q) { return /^vp_venues\?.*pending_players/.test(q); }), selects);
  check('metadata that no longer adds up is ignored (falls back to the table, which here also disagrees: no split)', (function () { var m3 = {}; for (var k in md) m3[k] = md[k]; m3.vp_venue_1 = JSON.stringify({ v: 'v-grand', n: 'The Grand Hotel', p: 14 }); return vpbSplitFromMetadata(inv([planLine(45, 250)], { metadata: m3 })) === null; })());
  WORLD.venues = [ROYAL, GRAND, TUGUN];
  await created(envOn(), inv([planLine(45, 250, PLAN_M)], { status: 'open' }));
  check('ON: a finalised (open) invoice is never touched', stripe.length === 0, stripe);
  await created(envOn(), inv([planLine(45, 250, PLAN_M)], { status: 'paid' }));
  check('ON: a paid invoice is never touched', stripe.length === 0, stripe);
  WORLD.venues = [ROYAL];
  await created(envOn(), inv([planLine(20, 250)], { status: 'draft' }));
  check('ON: a single venue is never touched', stripe.length === 0, stripe);
  WORLD.venues = [ROYAL, GRAND, V('v-tugun', 'Tugun Tavern', 9)];
  await created(envOn(), DRAFT);
  check('ON: drift (44 vs 45) is never written', stripe.length === 0, stripe);
  WORLD.venues = [ROYAL, GRAND, TUGUN];
  await created(envOn(), inv([planLine(45, 250, PLAN_M)], { status: 'draft', description: 'PO 7781 from the accounts team' }));
  check('ON: somebody else\'s memo is kept; only metadata is added', stripe.length === 1 && stripe[0].body.indexOf('description=') === -1 && stripe[0].body.indexOf('vp_lines_n') !== -1, stripe[0] && stripe[0].body);
  await created(envOn(), inv([planLine(45, 250, PLAN_M)], { status: 'draft', description: 'Players by venue: old words' }));
  check('ON: our own older memo is refreshed', stripe.length === 1 && stripe[0].body.indexOf('description=') !== -1);
  WORLD.stripeReply = { error: { message: 'No such invoice' } };
  var threw = false; try { await created(envOn(), DRAFT); } catch (e) { threw = true; }
  WORLD.stripeReply = null;
  check('ON: a Stripe refusal never throws (Stripe holds a draft until the webhook answers) and is written down',
        !threw && audits.some(function (x) { return x.row.action === 'invoice_venue_lines' && /^not written: No such invoice/.test(x.row.detail.outcome); }), audits.map(function (x) { return x.row.detail && x.row.detail.outcome; }));
  WORLD.selectThrows = true; threw = false; try { await created(envOn(), DRAFT); } catch (e) { threw = true; }
  WORLD.selectThrows = false;
  check('ON: a database failure never throws and writes nothing to Stripe', !threw && stripe.length === 0, stripe);
  var many = []; for (var i = 1; i <= 45; i++) many.push(V('m' + i, 'A very long venue name for the memo test number ' + i, 1));
  WORLD.venues = many;
  await created(envOn(), inv([planLine(45, 250, '45 Players × Founding Membership (Monthly) (at $2.50 / month)')], { status: 'draft' }));
  var mform = stripe[0] ? decodeURIComponent(stripe[0].body.replace(/\+/g, ' ')) : '';
  check('ON: 45 venues: the memo stays short and says how many more', stripe.length === 1 && /and \d+ more venues, listed on your venueplay invoice email\./.test(mform) && (/description=([^&]*)/.exec(mform) || ['', ''])[1].length <= 1500, mform.slice(0, 120));
  check('ON: past 40 venues, no metadata rows (Stripe allows 50 keys); the email reads the table', stripe.length === 1 && mform.indexOf('vp_venue_') === -1);
  WORLD.venues = [ROYAL, GRAND, TUGUN];
  // invoice.paid: exactly the same Stripe calls with the flag on as off. Nothing new happens at payment.
  async function paidCalls(env) { stripe = []; await vpaHandleStripeEvent(env, { id: 'evt_p', type: 'invoice.paid', data: { object: inv([planLine(45, 250, PLAN_M)]) } }); return JSON.stringify(stripe); }
  var off = await paidCalls(ENV), on = await paidCalls(envOn());
  check('invoice.paid makes the same Stripe calls with the flag on as off', off === on, [off.slice(0, 200), on.slice(0, 200)]);
  check('and none of them writes to an invoice', !/\/v1\/invoices\//.test(on) || JSON.parse(on).every(function (c) { return !(c.method === 'POST' && /\/v1\/invoices\//.test(c.url)); }), on.slice(0, 300));

  say('\n(e) The Stripe quantity is summed exactly as before');
  function oldTotal(vs) { return vs.reduce(function (n, v) { if (v.cancel_at_period_end) return n; var billed = (v.pending_players != null) ? parseInt(v.pending_players, 10) : parseInt(v.max_players, 10); return n + (billed || 0); }, 0); }
  var fixtures = [[ROYAL, GRAND, TUGUN], [ROYAL, V('g', 'G', 15, { pending_players: 10 }), V('c', 'C', 8, { cancel_at_period_end: true })], [V('z', 'Z', null, { pending_players: 0 })], [V('n', 'N', '12'), V('m', 'M', 'x')], []];
  var parity = [];
  for (var f = 0; f < fixtures.length; f++) { WORLD.venues = fixtures[f]; var t = await vpbAccountTotal(ENV, 'f1'); if (t !== oldTotal(fixtures[f])) parity.push([f, t, oldTotal(fixtures[f])]); }
  check('vpbAccountTotal returns the old sum on every fixture (cancelling, pending, zero, strings, empty)', parity.length === 0, parity);
  WORLD.venues = [ROYAL, V('g', 'The Grand Hotel', 15, { pending_players: 10 }), TUGUN, V('c', 'Gone Inn', 8, { cancel_at_period_end: true })];
  var tq = await vpbAccountTotal(ENV, 'f1'), sp = vpbSplitPlanLine(inv([planLine(tq, 250)]), WORLD.venues);
  check('the split and the Stripe quantity read the same rule: the rows add to vpbAccountTotal (' + tq + ')', !!sp && sp.players === tq && sp.rows.reduce(function (n, r) { return n + r.players; }, 0) === tq, sp);

  if (DUMP && deanEx) {
    print('<!-- BEFORE -->\n' + deanEx.before.html + '\n<!-- AFTER -->\n' + deanEx.after.html);
    return;
  }
  print('\n' + (fails ? fails + ' OF ' + ran + ' FAILED' : 'ALL ' + ran + ' CHECKS PASSED'));
}
var done = false, err = null;
main().then(function () { done = true; }, function (e) { err = e; done = true; });
if (typeof drainMicrotasks === 'function') drainMicrotasks();
if (err) { print('FAIL the suite threw: ' + (err && err.stack || err)); throw err; }
if (!done) { print('FAIL the suite did not finish'); throw new Error('not finished'); }
if (fails) throw new Error(fails + ' failed');
