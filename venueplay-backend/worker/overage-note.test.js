/* THE EXTRA-PLAYERS NOTE ON THE RECEIPT AND THE PAYMENT REMINDER (INBOX 94, Dean, 5 Nov 2026).

   The receipt says "Includes 12 extra players over 1 big night" and the payment reminder says
   "A busy month: this bill includes extra players". Both are worked out by vpaOverageFromInvoice
   from Stripe's own invoice lines. It only knew the OLD wording, "Big night extra players - ...".
   Since 11 Sep 2026 the game Worker writes every big night as "<venue> - Extra Player - DD/MM/YYYY"
   (quantity x $2.00, or x $1.00 with " (3rd big night, plan moved up)"), so every big night since
   then reached the venue with no note at all, and the reminder never said it was a busy month.

   The trap the fix must not fall into: the billing page writes an ADDED PLAYER with the very same
   words, "<venue> - Extra Player - DD/MM/YYYY", at the plan rate ($2.50 or $3.00). That is a plan
   change, not a big night. The only thing that tells them apart is Stripe's own unit price
   ($2.00 a big night, $1.00 the third in a row), which is also the rule fix/group-invoice-lines-10nov
   uses (vpbExtraLine), so the receipt and the group split can never disagree on a line.

   It RUNS the shipped billing Worker (the receipt and the reminder, with only fetch and the
   database replaced) and reads what a venue would read. The descriptions are made by running the
   game Worker's and the billing page's OWN expressions, so a change to the writer is a change here.

   Run from the repo root:  jsc venueplay-backend/worker/overage-note.test.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var GAME = readFile('venueplay-backend/worker/venueplay-game.js');
var BILLSRC = src;
src = src.replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
(0, eval)(src);

var fails = 0, ran = 0;
function check(name, ok, saw) {
  if (typeof ok !== 'boolean') throw new Error('condition must be a boolean: ' + name);
  ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); }
}
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
function visible(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();   // "(<b>18</b>)" reads "(18)"
}

/* THE WRITERS, RUN. Each description expression is lifted out of its Worker and evaluated with
   the values it is given there, so these fixtures are what Stripe is really handed. */
var gameExpr = /description: (\(venue\.name \|\| 'Venue'\) \+ ' - Extra Player - ' \+ when \+[\s\S]*?\(halfPrice \? ' \(3rd big night, plan moved up\)' : ''\)),\n/.exec(GAME);
check('CONTROL: the game Worker\'s big-night description is found', !!gameExpr);
function bigNightDesc(name, when, halfPrice) {
  var venue = { name: name };
  return eval(gameExpr ? gameExpr[1].replace(/\/\*[\s\S]*?\*\//g, '') : '"missing"');
}
var addExpr = /description: (\(label \|\| 'Venue'\) \+ ' - Extra Player - ' \+\s*new Date\(Date\.now\(\) \+ 36000000\)\.toISOString\(\)\.slice\(0, 10\)\.split\('-'\)\.reverse\(\)\.join\('\/'\)),\n/.exec(BILLSRC);
check('CONTROL: the billing page\'s added-player description is found', !!addExpr);
function addedDesc(label) { return eval(addExpr ? addExpr[1] : '"missing"'); }

var ROYAL_NIGHT = bigNightDesc('The Royal Hotel', '07/11/2026', false);
check('CONTROL: the game Worker writes "The Royal Hotel - Extra Player - 07/11/2026"', ROYAL_NIGHT === 'The Royal Hotel - Extra Player - 07/11/2026', ROYAL_NIGHT);
var ROYAL_THIRD = bigNightDesc('The Royal Hotel', '09/11/2026', true);
check('CONTROL: the third night in a row adds " (3rd big night, plan moved up)"', ROYAL_THIRD === 'The Royal Hotel - Extra Player - 09/11/2026 (3rd big night, plan moved up)', ROYAL_THIRD);
var ROYAL_ADDED = addedDesc('The Royal Hotel');
check('CONTROL: an added player is written with the same words', /^The Royal Hotel - Extra Player - \d\d\/\d\d\/\d{4}$/.test(ROYAL_ADDED), ROYAL_ADDED);
var DASHED_NIGHT = bigNightDesc('Bar - Grill - Kitchen', '03/11/2026', false);
var BIGNAME_NIGHT = bigNightDesc('Big Night', '12/09/2026', false);
var OLD = 'Big night extra players - The Royal Hotel - 12 over 100 at $2.00';
var OLD_NO_COUNT = 'Big night extra players - The Jolly Jess - 2026-09-10';
var PLAN = '100 Player × Founding Membership (Monthly) (at $2.50 / month)';

function L(description, quantity, amount, more) {
  var o = { description: description, quantity: quantity, amount: amount };
  for (var k in (more || {})) o[k] = more[k];
  return o;
}
function inv(lines, more) {
  var total = lines.reduce(function (n, l) { return n + l.amount; }, 0);
  var o = { id: 'in_1', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com',
    amount_paid: total, amount_due: total, hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test_1',
    invoice_pdf: 'https://pay.stripe.com/invoice/acct_x/test_1/pdf', next_payment_attempt: 1794000000,
    billing_reason: 'manual', lines: { data: lines } };
  for (var k in (more || {})) o[k] = more[k];
  return o;
}
function ov(i) { var o = vpaOverageFromInvoice(i); return { nights: o.nights, players: o.players, cents: o.cents }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var sent = [];
fetch = function (url, opts) {
  url = String(url);
  if (/api\.resend\.com/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e1' }); }, text: function () { return Promise.resolve('{}'); } }); }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
vpaInsert = function () { return Promise.resolve({}); };
vpaSelect = function (env, table) {
  if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', contact_email: 'owner@pub.com', payment_reminders: true }]);
  return Promise.resolve([]);
};
var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au' };
function last() { return sent[sent.length - 1] || {}; }
/* Every amount cell in "What this is for", in cents, so the lines can be added up. */
function lineCells(html) {
  var box = /What this is for<\/p>([\s\S]*?)<\/table><\/td><\/tr><\/table>/.exec(html || '');
  var out = [], re = /text-align:right;white-space:nowrap;border-bottom:1px solid #f0f0f3">\$(\d+)\.(\d\d)<\/td>/g, m;
  while (box && (m = re.exec(box[1]))) out.push(parseInt(m[1], 10) * 100 + parseInt(m[2], 10));
  return out;
}
function sum(a) { return a.reduce(function (n, x) { return n + x; }, 0); }

async function main() {
  print('1. The line the game Worker writes today is read');
  var night = inv([L(ROYAL_NIGHT, 12, 2400)]);
  check('"The Royal Hotel - Extra Player - 07/11/2026", 12 x $2.00: 1 night, 12 players, $24.00',
        same(ov(night), { nights: 1, players: 12, cents: 2400 }), ov(night));
  var third = inv([L(ROYAL_THIRD, 15, 1500)]);
  check('the third night in a row, 15 x $1.00: 1 night, 15 players, $15.00 (counted by Stripe\'s quantity, not $2 a head)',
        same(ov(third), { nights: 1, players: 15, cents: 1500 }), ov(third));
  check('a big night with no quantity on the line (the third night) is still counted from its $1.00 rate',
        same(ov(inv([L(ROYAL_THIRD, undefined, 700)])), { nights: 1, players: 7, cents: 700 }), ov(inv([L(ROYAL_THIRD, undefined, 700)])));

  print('\n2. The old wording still reads, so old invoices are unchanged');
  check('"Big night extra players - The Royal Hotel - 12 over 100 at $2.00": 1 night, 12 players, $24.00',
        same(ov(inv([L(OLD, 1, 2400)])), { nights: 1, players: 12, cents: 2400 }), ov(inv([L(OLD, 1, 2400)])));
  check('the oldest line with no count: $6.00 at $2 a head is 3 players',
        same(ov(inv([L(OLD_NO_COUNT, undefined, 600)])), { nights: 1, players: 3, cents: 600 }), ov(inv([L(OLD_NO_COUNT, undefined, 600)])));

  print('\n3. A venue name with " - " in it, or one that starts "Big Night"');
  check('"Bar - Grill - Kitchen - Extra Player - 03/11/2026", 4 x $2.00: 1 night, 4 players, $8.00',
        same(ov(inv([L(DASHED_NIGHT, 4, 800)])), { nights: 1, players: 4, cents: 800 }), ov(inv([L(DASHED_NIGHT, 4, 800)])));
  check('a pub called "Big Night" is counted once, by its quantity, 16 x $2.00',
        same(ov(inv([L(BIGNAME_NIGHT, 16, 3200)])), { nights: 1, players: 16, cents: 3200 }), ov(inv([L(BIGNAME_NIGHT, 16, 3200)])));

  print('\n4. Nothing that is not a big night is counted as one');
  check('an ADDED player (same words, $2.50 each) is not a big night', same(ov(inv([L(ROYAL_ADDED, 2, 500)])), { nights: 0, players: 0, cents: 0 }), ov(inv([L(ROYAL_ADDED, 2, 500)])));
  check('an added player at the $3.00 rate is not a big night', same(ov(inv([L(ROYAL_ADDED, 1, 300)])), { nights: 0, players: 0, cents: 0 }));
  check('the older added-player words ("The Jolly Jess: 1 extra player, full month") are not a big night',
        same(ov(inv([L('The Jolly Jess: 1 extra player, full month', 1, 250)])), { nights: 0, players: 0, cents: 0 }));
  check('the plan line, a $0 line and a Stripe proration are not big nights',
        same(ov(inv([L(PLAN, 100, 25000), L(ROYAL_NIGHT, 3, 0), L(ROYAL_NIGHT, 3, 600, { proration: true })])), { nights: 0, players: 0, cents: 0 }));
  check('an invoice with no lines is no big night', same(ov({}), { nights: 0, players: 0, cents: 0 }) && same(ov({ lines: { data: [] } }), { nights: 0, players: 0, cents: 0 }));

  print('\n5. The receipt for a big night, as the venue reads it');
  sent = [];
  await vpaFireInvoiceEmail(ENV, night);
  var r = last(), rt = visible(r.html);
  check('CONTROL: the receipt was sent', !!r.html, r.subject);
  check('it says "Includes 12 extra players over 1 big night · $24.00 at $2/head."',
        rt.indexOf('Includes 12 extra players over 1 big night · $24.00 at $2/head.') !== -1, rt.slice(0, 500));
  check('it suggests a bigger plan, as it always has under a big night', rt.indexOf('Running over most weeks?') !== -1);
  check('the amount paid is still $24.00 and the subject unchanged', rt.indexOf('Amount paid $24.00') !== -1 && r.subject === 'Your venueplay invoice ABC-0001 - $24.00', r.subject);
  check('Stripe\'s own line is printed as Stripe wrote it', rt.indexOf('The Royal Hotel - Extra Player - 07/11/2026 $24.00') !== -1, rt);

  sent = [];
  await vpaFireInvoiceEmail(ENV, third);
  var r3 = visible(last().html);
  check('the third night says "$15.00 at $1/head", never "$2/head" for a night charged at $1',
        r3.indexOf('Includes 15 extra players over 1 big night · $15.00 at $1/head') !== -1 && r3.indexOf('$2/head') === -1, r3.slice(0, 500));
  check('and still says the plan has moved up', r3.indexOf('Your plan has moved up') !== -1);

  sent = [];
  await vpaFireInvoiceEmail(ENV, inv([L(ROYAL_ADDED, 2, 500), L(PLAN, 100, 25000)], { billing_reason: 'subscription_cycle' }));
  var ra = visible(last().html);
  check('a receipt for ADDED players says nothing about big nights', !!last().html && ra.indexOf('big night') === -1 && ra.indexOf('Running over most weeks?') === -1, ra.slice(0, 400));

  print('\n6. Several extra lines on one bill: the payment reminder');
  /* A group's renewal: the plan, two Royal nights the card declined on the night (moved onto the
     renewal by vpaMoveExtrasToMonthly, same words and quantity), one Bar - Grill night, the third
     night in a row at the Royal, and two players added on the billing page. */
  var lines = [L(PLAN, 100, 25000), L(bigNightDesc('The Royal Hotel', '01/11/2026', false), 5, 1000),
               L(bigNightDesc('The Royal Hotel', '04/11/2026', false), 3, 600), L(DASHED_NIGHT, 4, 800),
               L(bigNightDesc('The Royal Hotel', '06/11/2026', true), 6, 600), L(ROYAL_ADDED, 2, 500)];
  var renewal = inv(lines, { billing_reason: 'upcoming', amount_paid: 0 });
  check('4 big nights, 18 extra players, $30.00 (the added players and the plan left out)',
        same(ov(renewal), { nights: 4, players: 18, cents: 3000 }), ov(renewal));
  sent = [];
  await vpaFireUpcomingEmail(ENV, renewal);
  var u = last(), ut = visible(u.html);
  check('CONTROL: the reminder was sent', !!u.html, u.subject);
  check('it says "A busy month: this bill includes extra players."', ut.indexOf('A busy month: this bill includes extra players.') !== -1, ut.slice(0, 600));
  check('"You went over your plan on 4 nights this cycle (18 extra players), adding $30.00"',
        ut.indexOf('You went over your plan on 4 nights this cycle (18 extra players), adding $30.00') !== -1, ut.slice(0, 900));
  check('the rate is said truly: $2/head, and $1/head on the third night in a row',
        ut.indexOf('adding $30.00 at $2/head ($1/head on the 3rd big night in a row)') !== -1, ut.slice(0, 900));

  print('\n7. The totals add up');
  var cells = lineCells(u.html);
  check('every line on the bill is printed once', cells.length === lines.length, cells);
  check('the lines printed add up to the amount due, $285.00', sum(cells) === renewal.amount_due && ut.indexOf('Amount due $285.00') !== -1, [sum(cells), renewal.amount_due]);
  var bigCents = lines.filter(function (l) { return / - Extra Player - /.test(l.description) && (l.amount / l.quantity === 200 || /plan moved up/.test(l.description)); })
                      .reduce(function (n, l) { return n + l.amount; }, 0);
  check('the note\'s $30.00 is exactly the big-night lines, no more and no less', vpaOverageFromInvoice(renewal).cents === bigCents && bigCents === 3000, bigCents);
  check('the note\'s 18 players is exactly the quantities on those lines', vpaOverageFromInvoice(renewal).players === 5 + 3 + 4 + 6);
  var rc = lineCells(r.html);
  check('the receipt\'s lines add up to what was paid', sum(rc) === night.amount_paid && rc.length === 1, rc);

  print('\n8. Old invoices read exactly as before');
  sent = [];
  await vpaFireInvoiceEmail(ENV, inv([L(PLAN, 1, 250), L(OLD, 1, 2400)]));
  var ro = visible(last().html);
  check('an old big-night line still says "Includes 12 extra players over 1 big night · $24.00 at $2/head."',
        ro.indexOf('Includes 12 extra players over 1 big night · $24.00 at $2/head.') !== -1, ro.slice(0, 400));
  sent = [];
  await vpaFireInvoiceEmail(ENV, inv([L(PLAN, 1, 250)]));
  var rp = visible(last().html);
  check('a plain plan receipt has no extra-players note', !!last().html && rp.indexOf('extra player') === -1 && rp.indexOf('big night') === -1, rp.slice(0, 400));
}

main().then(function () {}, function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
for (var i = 0; i < 50; i++) drain();
print('');
print(fails ? (fails + ' OF ' + ran + ' FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
