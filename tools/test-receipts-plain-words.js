/* RECEIPTS AND BILLING EMAILS IN PLAIN WORDS, RUN (Dean, 30 Oct 2026).

   Dean: tax invoices are issued by Stripe, and the name a venue deals with is "VenuePlay, ABN
   35 679 383 049". Never "Gflam Group" on anything a venue sees, and never "founding".

   Three rules, each checked on the html the billing Worker hands to Resend:
     (a) a Stripe line written from the product name ("1 Player x Founding Membership (Monthly)
         (at $2.50 / month)") is printed in plain words, "VenuePlay plan (monthly)". The Stripe
         product keeps its name; only what our emails print changes (vpaPlainLineDesc).
     (b) the paid-invoice email DELIVERS Stripe's tax invoice (Dean, 31 Oct 2026: "I thought we were
         delivering the Stripe tax invoice"), so it says "Tax invoice. VenuePlay, ABN ...", its subject
         is "Your VenuePlay invoice <number> - $x", and "View invoice" opens Stripe's hosted invoice.
     (c) the business name line reads "VenuePlay, ABN 35 679 383 049".

   It RUNS the shipped senders (the receipt, the payment reminder, the declined card for a
   subscription and for an extras invoice, the plan moved up, the welcome) with only fetch and the
   database replaced, and reads what a venue would read: tags and comments gone, entities as text.
   The billing page's own words are run in Chrome by tools/billing-words-in-chrome.test.py.

   Run from the repo root:  jsc tools/test-receipts-plain-words.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
(0, eval)(src);

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
function visible(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
var NAME_LINE = 'VenuePlay, ABN 35 679 383 049';
function clean(where, text) {
  check(where + ': never "founding"', !/founding/i.test(text), (text.match(/.{0,40}founding.{0,40}/i) || [])[0]);
  check(where + ': never Gflam', !/gflam/i.test(text), (text.match(/.{0,40}gflam.{0,40}/i) || [])[0]);
}

var sent = [];
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var tpl = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(tpl); } }); }
  if (/api\.resend\.com/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e1' }); }, text: function () { return Promise.resolve('{}'); } }); }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
vpaInsert = function () { return Promise.resolve({}); };
vpaSelect = function (env, table, q) {
  if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', contact_email: 'owner@pub.com', payment_reminders: true }]);
  if (table === 'vp_venues') return Promise.resolve([{ id: 'v1', name: 'The Royal Hotel' }]);
  if (/plan_uplift_after_three_big_nights/.test(q || '')) return Promise.resolve([{ id: 'aud1', target: 'venue:v1', created_at: '2026-10-20T00:00:00Z', detail: { from: 40, to: 60, nights: [52, 55, 58], effective: 'next_invoice' } }]);
  return Promise.resolve([]);
};
var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au' };
function last() { return sent[sent.length - 1] || {}; }

/* The lines as Stripe writes them for a founding venue: the subscription line from the product
   name, a proration line, a big night, and a venue's free-month credit. */
var MONTHLY = '1 Player × Founding Membership (Monthly) (at $2.50 / month)';
var PRORATE = 'Remaining time on 12 × Founding Membership (Annual) after 01 Oct 2026';
var BIGNIGHT = 'Big night extra players - The Royal Hotel - 12 over 100 at $2.00';
function invoice(extra) {
  var o = { id: 'in_1', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com', amount_paid: 6650, amount_due: 6650,
    hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test_1', invoice_pdf: 'https://pay.stripe.com/invoice/acct_x/test_1/pdf',
    next_payment_attempt: 1790000000, billing_reason: 'subscription_cycle',
    lines: { data: [{ description: MONTHLY, amount: 250, quantity: 1 }, { description: PRORATE, amount: 4000, quantity: 12 }, { description: BIGNIGHT, amount: 2400, quantity: 12 }] } };
  for (var k in (extra || {})) o[k] = extra[k];
  return o;
}

async function main() {
  print('(a) A Stripe line is printed in plain words');
  var P = vpaPlainLineDesc;
  check('the subscription line: "1 Player × VenuePlay plan (monthly) (at $2.50 / month)"', P(MONTHLY) === '1 Player × VenuePlay plan (monthly) (at $2.50 / month)', P(MONTHLY));
  check('a proration line keeps its quantity and its date', P(PRORATE) === 'Remaining time on 12 × VenuePlay plan (annual) after 01 Oct 2026', P(PRORATE));
  check('the other product names Stripe has had: "Founding Monthly", "VenuePlay Founding Membership"',
        P('3 × Founding Monthly') === '3 × VenuePlay plan (monthly)' && P('VenuePlay Founding Membership') === 'VenuePlay plan', [P('3 × Founding Monthly'), P('VenuePlay Founding Membership')]);
  check('"founding rate" reads "your rate"; a stray "founding" goes', P('Held at the founding rate') === 'Held at your rate' && !/founding/i.test(P('Founding venue discount')), [P('Held at the founding rate'), P('Founding venue discount')]);
  check('"Gflam Group Pty Ltd" in a description reads VenuePlay', P('Gflam Group Pty Ltd subscription') === 'VenuePlay subscription', P('Gflam Group Pty Ltd subscription'));
  check('a line with nothing to change is left exactly as Stripe wrote it', P(BIGNIGHT) === BIGNIGHT && P('The Jolly Jess: 1 extra player, full month') === 'The Jolly Jess: 1 extra player, full month');
  check('the big-night count still reads Stripe\'s own line (12 extra players over 1 night)',
        (function () { var o = vpaOverageFromInvoice(invoice()); return o.nights === 1 && o.players === 12 && o.cents === 2400; })(), vpaOverageFromInvoice(invoice()));

  print('\n(b) and (c) The paid invoice, delivering Stripe\'s tax invoice');
  sent = [];
  await vpaFireInvoiceEmail(ENV, invoice());
  var r = last(), rt = visible(r.html);
  check('CONTROL: the receipt was sent, with its lines', !!r.html && rt.indexOf('What this is for') !== -1, r.subject);
  clean('receipt', rt + ' ' + (r.subject || ''));
  check('it is the tax invoice: "Tax invoice. VenuePlay, ABN 35 679 383 049. Prices include GST."', rt.indexOf('Tax invoice. ' + NAME_LINE + '. Prices include GST.') !== -1, rt.slice(-700));
  check('it is never called a receipt in its own small print', rt.indexOf('Receipt. VenuePlay') === -1);
  check('the subject: "Your VenuePlay invoice ABC-0001 - $66.50"', r.subject === 'Your VenuePlay invoice ABC-0001 - $66.50', r.subject);
  check('the inbox preview: "Paid $66.50. Your tax invoice ABC-0001 and what it covers are inside."', rt.indexOf('Paid $66.50. Your tax invoice ABC-0001 and what it covers are inside.') !== -1, rt.slice(0, 160));
  check('the body: "Here is your invoice ABC-0001, and exactly what it is for."', rt.indexOf('Here is your invoice ABC-0001, and exactly what it is for.') !== -1);
  check('the page title: "Your VenuePlay invoice"', /<title>Your VenuePlay invoice<\/title>/.test(r.html));
  check('the subscription line reads "1 Player × VenuePlay plan (monthly) (at $2.50 / month)"', rt.indexOf('1 Player × VenuePlay plan (monthly) (at $2.50 / month)') !== -1, rt.slice(0, 600));
  check('the proration line reads "VenuePlay plan (annual)"', rt.indexOf('12 × VenuePlay plan (annual)') !== -1);
  check('the big night is still counted on it: 12 extra players over 1 big night', rt.indexOf('12 extra players') !== -1 && rt.indexOf('1 big night') !== -1);
  check('Stripe\'s own invoice keeps its title: "View invoice" opens the hosted invoice', /<a href="https:\/\/invoice\.stripe\.com\/i\/acct_x\/test_1"[^>]*>View invoice<\/a>/.test(r.html));
  check('the business name line in the small print: "' + NAME_LINE + '"', rt.indexOf('venueplay.com.au · ' + NAME_LINE) !== -1, rt.slice(-300));

  print('\nThe payment reminder');
  sent = [];
  await vpaFireUpcomingEmail(ENV, invoice({ amount_paid: 0 }));
  var u = last(), ut = visible(u.html);
  check('CONTROL: the reminder was sent', !!u.html, u.subject);
  clean('payment reminder', ut + ' ' + (u.subject || ''));
  check('its lines are in plain words', ut.indexOf('1 Player × VenuePlay plan (monthly) (at $2.50 / month)') !== -1);
  check('the business name line: "' + NAME_LINE + '"', ut.indexOf('venueplay.com.au · ' + NAME_LINE) !== -1, ut.slice(-300));

  print('\nThe declined card');
  sent = [];
  await vpaFirePaymentFailedEmail(ENV, invoice({ billing_reason: 'subscription_cycle' }), undefined, { code: 'expired_card', message: '' });
  var f = last(), ft = visible(f.html);
  check('CONTROL: the declined-card email was sent', !!f.html, f.subject);
  clean('declined card (subscription)', ft + ' ' + (f.subject || ''));
  check('a subscription invoice says "for your VenuePlay subscription"', ft.indexOf('for your VenuePlay subscription') !== -1, ft.slice(0, 300));
  check('it carries the business name line now: "' + NAME_LINE + '"', ft.indexOf('venueplay.com.au · ' + NAME_LINE) !== -1, ft.slice(-300));
  sent = [];
  await vpaFirePaymentFailedEmail(ENV, invoice({ billing_reason: 'manual', lines: { data: [{ description: '2 × Founding Membership (Monthly) (at $2.50 / month)', amount: 500 }] } }), { moved: false }, { code: 'insufficient_funds', message: '' });
  var f2 = last(), f2t = visible(f2.html);
  clean('declined card (a line named from the product)', f2t);
  check('a charge named by its line names it in plain words: "for 2 × VenuePlay plan (monthly)"', f2t.indexOf('for 2 × VenuePlay plan (monthly) (at $2.50 / month)') !== -1, f2t.slice(0, 300));

  print('\nThe plan moved up');
  sent = [];
  await vpaFirePlanUpliftEmail(ENV, 'cus_1');
  var p = last(), pt = visible(p.html);
  check('CONTROL: the plan-moved-up email was sent', !!p.html, p.subject);
  clean('plan moved up', pt + ' ' + (p.subject || ''));
  check('the business name line: "' + NAME_LINE + '"', pt.indexOf('venueplay.com.au · ' + NAME_LINE) !== -1, pt.slice(-300));

  print('\nThe welcome, for a venue on the offer');
  sent = [];
  await vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 },
    [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false);
  var w = last(), wt = visible(w.html);
  check('CONTROL: the welcome was sent', !!w.html, w.subject);
  clean('welcome', wt + ' ' + (w.subject || ''));
  check('it names VenuePlay and the ABN', /VenuePlay · ABN 35 679 383 049|VenuePlay, ABN 35 679 383 049/.test(wt), wt.slice(-300));

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
}
var done = false, err = null;
main().then(function () { done = true; }, function (e) { err = e; done = true; });
for (var i = 0; i < 400 && !done; i++) drain();
if (err) { print('  FAIL the suite threw: ' + (err && err.stack || err)); fails++; }
if (!done) { print('  FAIL the suite never finished'); fails++; }
if (fails) throw new Error(fails + ' failed');
