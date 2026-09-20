/* WHAT ACTUALLY GOES OUT IN THE WELCOME EMAIL?

   Audit, 20 Sep 2026. Two faults a paying customer would have seen on day one:
     - the GROUP welcome showed a raw {{VENUE_BLOCKS}} tag and no venues. A string replace
       swaps only the first match, and the first match was in the template's own
       documentation comment
     - every TV link was a bare /tv with no venue in it, beside copy that says "always use
       this full link, it is what tells the screen which venue it is"

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
check('the TV link NAMES THE VENUE', one.indexOf('/tv?the-royal-hotel-4220') !== -1,
      (one.match(/venueplay\.com\.au\/tv[^"<\s]*/g) || []).slice(0, 4));
check('and no bare /tv link is handed over as the one to open',
      !/href="https:\/\/venueplay\.com\.au\/tv"/.test(one), (one.match(/href="[^"]*\/tv[^"]*"/g) || []).slice(0, 4));

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
check('each venue gets its OWN screen link',
      grp.indexOf('/tv?the-anchor-2000') !== -1 && grp.indexOf('/tv?the-crown-3000') !== -1,
      (grp.match(/\/tv[^"<\s]*/g) || []).slice(0, 6));
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

print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
