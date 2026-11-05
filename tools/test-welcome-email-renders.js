/* RUNS the product, it does not word-search it. The testing audit of 27 Oct 2026 filed this suite
   as "reads-file" because its scanner looked for load() and this file executes the shipped code
   through (0, eval)(src) instead. Its prove-checks rows break product logic, not strings, and go
   red. Read and checked by hand, 27 Oct 2026 (fix/text-match-suites-27-oct). */
/* WHAT ACTUALLY GOES OUT IN THE WELCOME EMAIL?

   Audit, 20 Sep 2026. Two faults a paying customer would have seen on day one:
     - the GROUP welcome showed a raw {{VENUE_BLOCKS}} tag and no venues. A string replace
       swaps only the first match, and the first match was in the template's own
       documentation comment
     - every TV link was a bare /tv with no venue in it, beside copy that said "always use
       this full link". (Dean, 5 Nov 2026: the opposite is now right. Bare /tv, plus the screen code.)

   This RUNS the shipped vpaFireWelcome against the REAL template files and reads the html
   it hands to Resend. Not a copy of the template, not a model of the sender.

   Run:  jsc tools/test-welcome-email-renders.js
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
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 300) : '')); }
}
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }

var sent;
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) {
    var tpl = readFile('venueplay/emails/' + m[1]);
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve(tpl); } });
  }
  if (/api\.resend\.com/.test(url)) {
    try { sent = JSON.parse(opts.body); } catch (e) { sent = { html: String(opts && opts.body) }; }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 'e1' }); },
                             text: function () { return Promise.resolve('{}'); } });
  }
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); },
                           text: function () { return Promise.resolve('{}'); } });
};
vpaInsert = function () { return Promise.resolve({}); };
vpaSelect = function () { return Promise.resolve([]); };

var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au' };
var SESSION = { metadata: { tier: 'founding' } };
function words(html) { return String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
.replace(/<\/(p|td|tr|h1|div)>|<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function visible(html) { return String(html || '').replace(/<!--[\s\S]*?-->/g, ''); }

print('What a new customer is actually sent');
print('');

sent = null;
vpaFireWelcome(ENV, SESSION, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 },
  [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false);
drain();
var one = visible(sent && sent.html);
check('the single-venue welcome is sent at all', !!one, sent);
check('no raw {{token}} reaches the customer', !/\{\{[^}]+\}\}/.test(one), (one.match(/\{\{[^}]+\}\}/g) || []).slice(0, 5));
check('the TV steps (Dean, 5 Nov 2026): Google TV or Android TV gets the app and the screen code; any other TV opens venueplay.com.au/tv, types the code, goes full screen; never a /tv?slug link',
      words(one).indexOf("Google TV or Android TV: get the venueplay TV app from Google Play, open it and type the six-character screen code from your host console. That is it, it remembers your venue. Any other TV, a Fire Stick or a laptop on HDMI: open venueplay.com.au/tv in the TV's web browser, type the screen code, then go full screen with nothing covering the window.") !== -1 && !/\/tv\?/.test(String(sent && sent.html)),
      (one.match(/venueplay\.com\.au\/tv[^"<\s]*/g) || []).slice(0, 4));
check('the sign-in step: phone, venueplay.com.au/app, a text code, start a game from the host console; the join code is NOT a TV step, it shows once a game is open',
      words(one).indexOf("Sign in and start a game. On your phone, go to venueplay.com.au/app and we text you a code. Then start a game from the host console. The players' join code shows on the host console, and on the TV once a game is open.") !== -1 && words(one).indexOf('a join code appears') === -1 && words(one).indexOf('Open the TV link') === -1, words(one).slice(0, 700));
check('the heading is "Welcome to venueplay" in 21px on one line (nowrap), and the email points at the in-app guide in one line',
      /<h1 [^>]*font-size:21px[^>]*white-space:nowrap">Welcome to venueplay<\/h1>/.test(one) && words(one).indexOf("When you first sign in, we'll walk you through it.") !== -1 && one.indexOf('Your screens') === -1);
check('the plan box is trimmed: no "three times in a row", no "Changing your maximum" paragraph, a one-line pointer to the billing page and Terms, and a MONTHLY customer sees no annual paragraph',
      words(one).indexOf('three times in a row') === -1 && words(one).indexOf('Changing your maximum') === -1 && words(one).indexOf('On an annual plan') === -1 &&
      words(one).indexOf('Busy nights and changing your maximum: see your billing page and our Terms.') !== -1 && /href="https:\/\/venueplay\.com\.au\/app\/billing\.html"[^>]*>billing page</.test(one) && /href="https:\/\/venueplay\.com\.au\/terms"[^>]*>Terms</.test(one) &&
      words(one).indexOf('$2') !== -1 && words(one).indexOf('No lock-in') !== -1 && words(one).indexOf('free until') !== -1, words(one).slice(-900));
sent = null;
vpaFireWelcome(ENV, SESSION, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'annual', max_seats: 40 },
  [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false);
drain();
var annual = words(sent && sent.html);
check('an ANNUAL customer does see the annual paragraph, with the pro rata line and the credit, and no "we do not refund it"; no raw IF tags left',
      annual.indexOf('On an annual plan, added players are pro rata to your renewal.') !== -1 && annual.indexOf('held as a credit that comes off your next renewal on its own') !== -1 && annual.indexOf('refund') === -1 && !/IF:|ENDIF/.test(String(sent && sent.html)), annual.slice(-900));
sent = null;
vpaFireWelcome(ENV, SESSION, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 },
  [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false);
drain();
check('the button opens the bare https://venueplay.com.au/tv, and says nothing about a home page',
      /href="https:\/\/venueplay\.com\.au\/tv"/.test(String(sent && sent.html)) && one.indexOf('home page') === -1, (String(sent && sent.html).match(/href="[^"]*\/tv[^"]*"/g) || []).slice(0, 4));

sent = null;
vpaFireWelcome(ENV, SESSION, { contact_email: 'owner@group.com', contact_name: 'Sam', plan: 'monthly' },
  [{ name: 'The Anchor', seats: 30, slug: 'the-anchor-2000' },
   { name: 'The Crown', seats: 50, slug: 'the-crown-3000' }], true);
drain();
var grp = visible(sent && sent.html);
check('the group welcome is sent at all', !!grp, sent);
check('no raw {{VENUE_BLOCKS}} or any other token reaches the customer',
      !/\{\{[^}]+\}\}/.test(grp), (grp.match(/\{\{[^}]+\}\}/g) || []).slice(0, 5));
check('BOTH venues are actually in the email', grp.indexOf('The Anchor') !== -1 && grp.indexOf('The Crown') !== -1);
check('every venue card points at the bare /tv, and the group steps say to type each venue\'s screen code; no /tv?slug anywhere',
      words(grp).indexOf("type that venue's screen code, then go full screen with nothing covering the window.") !== -1 && words(grp).indexOf("from that venue's host console") !== -1 && !/\/tv\?/.test(String(sent && sent.html)) && (String(sent && sent.html).match(/href="https:\/\/venueplay\.com\.au\/tv"/g) || []).length >= 2,
      (grp.match(/\/tv[^"<\s]*/g) || []).slice(0, 6));
check('the group heading fits one line and the group email points at the in-app guide',
      /<h1 [^>]*font-size:21px[^>]*white-space:nowrap">Welcome to venueplay<\/h1>/.test(grp) && words(grp).indexOf("When you first sign in, we'll walk you through it.") !== -1 && words(grp).indexOf('screen link') === -1);
check('the venue cards are VISIBLE, not injected into a comment',
      (String(sent && sent.html).match(/<!--[\s\S]*?-->/g) || []).join('').indexOf('The Anchor') === -1);

print('');
/* THE DATE IN THE EMAIL IS THE DATE STRIPE WILL CHARGE. A venue coming back inside twelve months
   gets a three day trial, and the email used to promise them thirty regardless. */
print('');
print('The first payment date is the real one');
function fmt(ts) { return vpaFmtDate(ts); }
var NOWS = Math.floor(Date.now() / 1000), D3 = NOWS + 3 * 86400, D30 = NOWS + 30 * 86400;
function welcome(meta, group) {
  sent = null;
  vpaFireWelcome(ENV, { metadata: meta }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 },
    group ? [{ name: 'The Anchor', seats: 40, slug: 'the-anchor' }, { name: 'The Crown', seats: 60, slug: 'the-crown' }]
          : [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], !!group);
  drain();
  return visible(sent && sent.html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}
var back = welcome({ tier: 'founding', trial_end: String(D3), returning: '1' });
check('a returning venue is told the THREE DAY date', back.indexOf('free until ' + fmt(D3)) !== -1, back.match(/free until [^,.]*/));
check('and is never shown the thirty day one', fmt(D30) === fmt(D3) || back.indexOf(fmt(D30)) === -1, fmt(D30));
check('and is not told it has a free month it did not get', !/first month is free/i.test(back), (back.match(/[^.]*free[^.]*\./i) || [])[0]);
check('it is told why, in words', /free month was used on your earlier account/.test(back));
var backGrp = welcome({ tier: 'founding', trial_end: String(D3), returning: '1' }, true);
check('the same for a returning GROUP', backGrp.indexOf('free until ' + fmt(D3)) !== -1 && !/first month is free/i.test(backGrp), backGrp.match(/free until [^,.]*/));
var fresh = welcome({ tier: 'founding', trial_end: String(D30), returning: '0' });
check('a new venue is still told a free month, to the right day', /first month is free/i.test(fresh) && fresh.indexOf('free until ' + fmt(D30)) !== -1, fresh.match(/free until [^,.]*/));
var olds = welcome({ tier: 'founding' });
check('a checkout made before the date was carried still gets a date, not a blank', olds.indexOf('free until ' + fmt(D30)) !== -1, olds.match(/free until [^,.]*/));
var stale = welcome({ tier: 'founding', trial_end: String(NOWS - 86400) });
check('a date already gone is never printed as the first payment', stale.indexOf(fmt(NOWS - 86400)) === -1, stale.match(/free until [^,.]*/));

/* AN ANNUAL VENUE IS CHARGED FOR THE YEAR, so the email must say the year's figure. */
print('');
print('An annual venue is told what it will really be charged');
function welcomePlan(plan, group) {
  sent = null;
  vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: plan, max_seats: 80 },
    group ? [{ name: 'The Anchor', seats: 80, slug: 'the-anchor' }, { name: 'The Crown', seats: 20, slug: 'the-crown' }]
          : [{ name: 'The Royal Hotel', seats: 80, slug: 'the-royal-hotel-4220' }], !!group);
  drain();
  return visible(sent && sent.html).replace(/<[^>]*>/g, ' ').replace(/&middot;/g, '.').replace(/\s+/g, ' ');
}
var yr = welcomePlan('annual');
check('annual, 80 players at $2.30: the yearly charge, $2,208.00, is in the email', yr.indexOf('$2,208.00 a year') !== -1, (yr.match(/first payment[^.]*\./) || [])[0]);
check('and it is never presented as "$184.00 a month" on its own', !/\$184\.00 a month\. /.test(yr) && yr.indexOf('billed yearly') !== -1, (yr.match(/first payment[^.]*\./) || [])[0]);
var mo = welcomePlan('monthly');
check('monthly, 80 players at $2.50: $200.00 a month, and no mention of a year', mo.indexOf('$200.00 a month') !== -1 && mo.indexOf('a year') === -1, (mo.match(/first payment[^.]*\./) || [])[0]);
var yg = welcomePlan('annual', true);
check('an annual GROUP: the group total for the year ($2,760.00) and each venue\'s own', yg.indexOf('$2,760.00 a year') !== -1 && yg.indexOf('$2,208.00 a year') !== -1 && yg.indexOf('$552.00 a year') !== -1, (yg.match(/\$[0-9,.]+ a year/g) || []));
check('no raw token left behind on any of them', !/\{\{/.test(yr + mo + yg));

print('');
print('The email an owner gets when they add a venue (Dean, 5 Nov 2026: to the owner, nothing to forward)');
sent = null;
vpbFireVenueOnboarding(ENV, { email: 'owner@pub.com', venueName: 'The Crown', slug: 'the-crown-3000' });
drain();
var ob = words(sent && sent.html);
check('the subject is "The Crown is set up on venueplay", never "forward this on"', sent && sent.subject === 'The Crown is set up on venueplay', sent && sent.subject);
check('it is written to the owner: "The Crown is set up.", add hosts in Account > People, each host is texted their own sign-in link, nothing to forward',
      ob.indexOf('The Crown is set up.') !== -1 && ob.indexOf('Add your hosts in Account > People. Each host gets a text with their own sign-in link, so there is nothing to forward.') !== -1 && !/Ready to forward|straight on to whoever|forward this on|Forwardable/i.test(visible(sent && sent.html)), ob.slice(0, 500));
check('it carries the same TV steps (Google TV or Android TV app; any other TV at venueplay.com.au/tv, screen code, full screen) and the host console step, no join code as a TV step, no /tv?slug link',
      ob.indexOf("Google TV or Android TV: get the venueplay TV app from Google Play, open it and type the six-character screen code from your host console. That is it, it remembers your venue. Any other TV, a Fire Stick or a laptop on HDMI: open venueplay.com.au/tv in the TV's web browser, type the screen code, then go full screen with nothing covering the window.") !== -1 &&
      ob.indexOf("Sign in and start a game.") !== -1 && ob.indexOf('a join code appears') === -1 && !/\/tv\?/.test(String(sent && sent.html)) && !/\{\{[^}]+\}\}/.test(String(sent && sent.html)), ob.slice(300, 1200));
check('it points at the in-app guide in one line and ends with the help line',
      ob.indexOf("When you first sign in, we'll walk you through it.") !== -1 && ob.indexOf('If you need any help, let us know.') !== -1 && ob.indexOf('press 2') !== -1);

print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
