/* RUNS the product, it does not word-search it. The testing audit of 27 Oct 2026 filed this suite
   as "reads-file" because its scanner looked for load() and this file executes the shipped code
   through (0, eval)(src) instead. Its prove-checks rows break product logic, not strings, and go
   red. Read and checked by hand, 27 Oct 2026 (fix/text-match-suites-27-oct). */
/* THE SUPPORT PHONE IN EVERY EMAIL A VENUE GETS, RUN (20 Oct 2026).

   Dean: VenuePlay has a support line, 07 5228 3667 (a Crazytel menu: 1 sales, 2 a venue running a
   game, 3 players, 4 accounts). It goes in the footer or support line of every email a venue gets,
   from ONE place in the billing Worker: VP_SUPPORT_PHONE and VP_SUPPORT_TEL, vpaVenueEmailFoot for
   the emails the Worker writes, vpaFillSupport for the site templates it fills.

   This RUNS the shipped senders against the REAL template files and reads the html handed to
   Resend: welcome (one venue and a group), the HQ welcome, the onboarding guide, the receipt, the
   payment reminder, the failed payment, the plan uplift, the leaving emails, and a help desk reply.
   It also checks the line does NOT go where it should not: a help desk reply to a player, and
   anything PartyPlay.

   Run from the repo root:  jsc venueplay-backend/worker/support-phone-emails.test.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
(0, eval)(src);

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }

var SHOW = '07 5228 3667', TEL = '+61752283667';
/* The number as the reader sees it: tags and comments gone, entities as text. */
function visible(html) { return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '.').replace(/\s+/g, ' '); }
function hasLine(html) {
  var h = String(html || '').replace(/<!--[\s\S]*?-->/g, ' ');
  return visible(h).indexOf(SHOW) !== -1 && new RegExp('<a [^>]*href="tel:\\' + TEL + '"[^>]*>' + SHOW + '</a>').test(h);
}
function noTag(html) { return !/\{\{\s*support_(phone|tel)\s*\}\}/.test(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ')); }

print('The support phone in the emails a venue gets');
print('');
/* The Worker's consts live inside the eval, so they are read the way an email reads them. */
var W_PHONE = vpaFillSupport('{{support_phone}}'), W_TEL = vpaFillSupport('{{support_tel}}');
check('the Worker holds the number once, as written for a person and as a tel: link',
      W_PHONE === SHOW && W_TEL === TEL, [W_PHONE, W_TEL]);

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

async function main() {

  sent = [];
  await vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 },
    [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false);
  check('welcome (one venue): the number, tappable, in the footer', hasLine(last().html), visible(last().html).slice(-400));
  check('welcome (one venue): no {{support_phone}} or {{support_tel}} left unfilled', noTag(last().html));

  sent = [];
  await vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@group.com', contact_name: 'Sam', plan: 'monthly' },
    [{ name: 'The Anchor', seats: 30, slug: 'the-anchor-2000' }, { name: 'The Crown', seats: 50, slug: 'the-crown-3000' }], true);
  check('welcome (group): the number, tappable', hasLine(last().html) && noTag(last().html), visible(last().html).slice(-400));

  sent = [];
  await vpaFireHqWelcome(ENV, { email: 'owner@pub.com', venueName: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220', comp: true });
  check('HQ welcome: the number, tappable, nothing unfilled', hasLine(last().html) && noTag(last().html), last().html ? visible(last().html).slice(-400) : 'not sent');

  sent = [];
  await vpbFireVenueOnboarding(ENV, { email: 'owner@pub.com', venueName: 'The Crown', slug: 'the-crown-3000' });
  check('onboarding guide: the number, tappable, nothing unfilled', hasLine(last().html) && noTag(last().html), last().html ? visible(last().html).slice(-400) : 'not sent');

  sent = [];
  await vpaFireInvoiceEmail(ENV, { id: 'in_1', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com', amount_paid: 12000,
    lines: { data: [{ description: '40 x Founding Membership', amount: 12000, quantity: 40 }] } });
  check('receipt: the number, tappable', hasLine(last().html), last().html ? visible(last().html).slice(-300) : 'not sent');
  check('receipt: and the ABN is still in its small print, after it', (last().html || '').lastIndexOf('VenuePlay, ABN 35 679 383 049') > (last().html || '').indexOf('tel:' + TEL));

  sent = [];
  await vpaFireUpcomingEmail(ENV, { id: 'in_2', customer: 'cus_1', customer_email: 'owner@pub.com', amount_due: 12000, next_payment_attempt: 1790000000,
    lines: { data: [{ description: '40 x Founding Membership', amount: 12000, quantity: 40 }] } });
  check('payment reminder: the number, tappable', hasLine(last().html), last().html ? visible(last().html).slice(-300) : 'not sent');

  sent = [];
  await vpaFirePaymentFailedEmail(ENV, { id: 'in_3', customer_email: 'owner@pub.com', amount_due: 12000, billing_reason: 'subscription_cycle', hosted_invoice_url: 'https://pay.example/y',
    lines: { data: [{ description: '40 x Founding Membership', amount: 12000 }] } });
  check('payment failed: the number, tappable', hasLine(last().html), last().html ? visible(last().html).slice(-300) : 'not sent');

  sent = [];
  await vpaFirePlanUpliftEmail(ENV, 'cus_1');
  check('plan moved up: the number, tappable', hasLine(last().html), last().html ? visible(last().html).slice(-300) : 'not sent');

  var bye = vpaGoodbyeHtml(ENV, { hello: 'Hi Sam,', name: 'The Royal Hotel', day: 'Friday', dated: '24 October 2026', rate: '$2.50', founding: true });
  check('leaving email: the number, tappable', hasLine(bye), visible(bye).slice(-300));
  check('leaving email: still no Gflam Group or ABN (Dean\'s call stands)', bye.indexOf('Gflam Group') === -1 && bye.indexOf('ABN') === -1);

  /* THE HELP DESK REPLY goes to whoever wrote in. A venue, or a venue that might be, gets the line;
     a player does not (the menu sends players to voicemail), and PartyPlay has no line at all. */
  var T = function (brand, category) { return { brand: brand, category: category, ticket_no: 1042 }; };
  check('help desk reply to a venue: the number, tappable', hasLine(helpReplyHtml(T('venueplay', 'venue_support'), 'Sorted.', 'support@venueplay.com.au')));
  check('help desk reply about a bill: the number', hasLine(helpReplyHtml(T('venueplay', 'accounts'), 'Sorted.', 'accounts@venueplay.com.au')));
  check('help desk reply to a sales enquiry (a venue that might be): the number', hasLine(helpReplyHtml(T('venueplay', 'sales'), 'Hello.', 'hello@venueplay.com.au')));
  var toPlayer = helpReplyHtml(T('venueplay', 'patron_support'), 'Ask the host.', 'support@venueplay.com.au');
  check('help desk reply to a PLAYER: no phone number, no tel: link', toPlayer.indexOf(SHOW) === -1 && toPlayer.indexOf('tel:') === -1, visible(toPlayer));
  var pp = helpReplyHtml(T('partyplay', 'venue_support'), 'Sorted.', 'support@partyplay.com.au');
  check('help desk reply from PartyPlay: no VenuePlay number', pp.indexOf(SHOW) === -1 && pp.indexOf('tel:') === -1, visible(pp));

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
}
var done = false, err = null;
main().then(function () { done = true; }, function (e) { err = e; done = true; });
for (var i = 0; i < 200 && !done; i++) drain();
if (err) { print('  FAIL the suite threw: ' + (err && err.stack || err)); fails++; }
if (!done) { print('  FAIL the suite never finished'); fails++; }
if (fails) throw new Error(fails + ' failed');
