/* Signing up: does the right person get a free month, and can one email open two bills?

   This RUNS handleCheckout. Nothing inside it is stubbed. The only thing replaced is global
   fetch, so the real query sbPriorAccounts builds, the real trial arithmetic and the real form
   that goes to Stripe are all exercised, and the assertions read the actual form fields.

   Run:  jsc tools/test-checkout-trial-and-duplicates.js
*/
var SRC = 'venueplay-backend/worker/venueplay-api-FULL.js';
var src = readFile(SRC)
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var LOGS = [];
console = { log: function (m) { LOGS.push(String(m)); } };

/* jsc is not a browser and not a Worker: it has no console, no URLSearchParams and no crypto.
   handleCheckout builds the whole Stripe request with URLSearchParams, so without this it threw
   before it reached a single decision and every check "failed" for the wrong reason. Encoding
   matches application/x-www-form-urlencoded, spaces as +, because the assertions read the body
   back out of it. */
URLSearchParams = function () { this._ = []; };
URLSearchParams.prototype.set = function (k, v) {
  for (var i = 0; i < this._.length; i++) if (this._[i][0] === String(k)) { this._[i][1] = String(v); return; }
  this._.push([String(k), String(v)]);
};
URLSearchParams.prototype.get = function (k) {
  for (var i = 0; i < this._.length; i++) if (this._[i][0] === String(k)) return this._[i][1];
  return null;
};
URLSearchParams.prototype.append = URLSearchParams.prototype.set;
URLSearchParams.prototype.toString = function () {
  var enc = function (x) { return encodeURIComponent(x).replace(/%20/g, '+'); };
  return this._.map(function (kv) { return enc(kv[0]) + '=' + enc(kv[1]); }).join('&');
};

(0, eval)(src);

var MONTHLY = 'price_f_m', ANNUAL = 'price_f_a', STD_M = 'price_s_m', STD_A = 'price_s_a';
function env(codes) {
  return {
    FOUNDING_CODES: (codes === undefined) ? 'NSW-SEP-2026,VIC-SEP-2026' : codes,
    STRIPE_PRICE_MONTHLY: MONTHLY, STRIPE_PRICE_ANNUAL: ANNUAL,
    STRIPE_PRICE_STANDARD_MONTHLY: STD_M, STRIPE_PRICE_STANDARD_ANNUAL: STD_A,
    STRIPE_SECRET_KEY: 'x', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_KEY: 'k',
    SITE_URL: 'https://venueplay.com.au',
  };
}

var sent, priorQuery, inserted;
function arm(prior) {
  sent = null; priorQuery = null; inserted = 0;
  fetch = function (url, opts) {
    url = String(url);
    function reply(body, ok) {
      return Promise.resolve({ ok: ok !== false, status: ok === false ? 500 : 200,
                               json: function () { return Promise.resolve(body); },
                               text: function () { return Promise.resolve(JSON.stringify(body)); } });
    }
    if (/checkout\/sessions/.test(url)) {
      sent = {};
      String(opts.body).split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        sent[decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      });
      return reply({ url: 'https://checkout.stripe.com/x', client_secret: 'cs_1' });
    }
    /* THE FAKE FILTERS LIKE POSTGREST DOES. It used to hand back every fixture whatever was
       asked for, so the query could be as wrong as it liked and the guard still got its rows.
       That is how a letter-for-letter email match lived here unnoticed: eq. is exact, ilike.
       ignores case and treats _ as any one character. */
    if (/venueplay_founding\?or=/.test(url)) {
      priorQuery = url;
      var m = /or=\(([^)]*)\)/.exec(url), conds = m ? m[1].split(',') : [];
      function hit(row) {
        return conds.some(function (c) {
          var p = /^(\w+)\.(eq|ilike)\.(.*)$/.exec(c); if (!p) return false;
          var have = String(row[p[1]] == null ? '' : row[p[1]]), want = decodeURIComponent(p[3]);
          if (p[2] === 'eq') return have === want;
          var rx = new RegExp('^' + want.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.') + '$', 'i');
          return rx.test(have);
        });
      }
      return reply((prior || []).filter(hit));
    }
    if (/venueplay_founding/.test(url) && opts && opts.method === 'POST') { inserted++; return reply([{ id: 'row_new' }]); }
    return reply([]);
  };
}

function signup(opts) {
  arm(opts.prior);
  var body = {
    email: opts.email || 'new@thepub.com.au',
    contact_name: 'Pat', mobile: opts.mobile || '0400000000',
    founding_code: ('code' in opts) ? opts.code : 'NSW-SEP-2026',
    plan: 'monthly',
    venues: opts.venues || [{ name: 'The Pub', seats: 50, postcode: opts.postcode || '2000' }],
  };
  /* text() as well as json(): vpaBody() reads the body as text so it can tell an
     empty body from a malformed one, and a real Request has both. */
  var req = { json: function () { return Promise.resolve(body); },
              text: function () { return Promise.resolve(JSON.stringify(body)); } };
  var out = null;
  handleCheckout(req, env(opts.codes), function (b, status) { return { body: b, status: status || 200 }; })
    .then(function (r) { out = r; })
    .catch(function (e) { out = { body: { error: 'THREW: ' + (e && (e.stack || e.message || e)) }, status: 0 }; });
  drainMicrotasks();
  return out;
}

var NOW = Math.floor(Date.now() / 1000), DAY = 86400;
function trialDays() { return sent ? Math.round((Number(sent['subscription_data[trial_end]']) - NOW) / DAY) : null; }
function iso(daysAgo) { return new Date(Date.now() - daysAgo * 86400000).toISOString(); }

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('signing up: the free month, and one bill per person');

/* 1. Nobody has been here before. A full month, and the founding price. */
var r1 = signup({});
check('brand new: a checkout session is created', !!(r1 && r1.body && r1.body.url), r1 && r1.body);
check('brand new: a full month free, not three days', trialDays() === 30, trialDays());
check('brand new: on the deal price', sent['line_items[0][price]'] === MONTHLY, sent['line_items[0][price]']);
check('brand new: not flagged as returning', sent['subscription_data[metadata][returning]'] === '0', sent['subscription_data[metadata][returning]']);

/* 2. THE ONE THAT WOULD HAVE BITTEN DEAN'S OWN TEST. An email that already has billing set up
      opened a SECOND subscription, and vpbRequireOwner reads venues[0].founding_id, so the
      duplicate never appeared on the billing page and could not be cancelled from the app. */
var r2 = signup({ prior: [{ id: 'old', venue_name: 'GFLAM GROUP PTY LTD', contact_email: 'new@thepub.com.au', mobile: '0400000000', created_at: iso(200), status: 'card_on_file', stripe_subscription_id: 'sub_live' }] });
/* The fixtures carry contact_email on purpose. The real query always selects it, and the guard
   now compares it, because the EMAIL is the billing identity and the mobile is not. A fixture
   missing that field quietly stops the guard firing and every check here passes. */
check('already has billing: refused', !!(r2 && r2.body && r2.body.error), r2 && r2.body);
check('already has billing: NO second subscription opened', sent === null, sent);
check('already has billing: told which account, and what to do instead',
  /GFLAM GROUP PTY LTD/.test(r2.body.error || '') && /Add a venue/.test(r2.body.error || ''), r2.body.error);
check('already has billing: answers 409, not a 500', r2.status === 409, r2.status);
/* And nothing is written down. The guard used to sit BELOW the insert, so every refused
   duplicate left a pending row behind, accumulating fastest on exactly the venue confused
   enough to be signing up twice, in the list HQ reads. */
check('already has billing: no pending row left behind', inserted === 0, inserted);

/* 3. Left two years ago and coming back. Every page promises a free month with no conditions,
      and this used to hand them three days and a charge they were told would not come. */
var r3 = signup({ prior: [{ id: 'old', venue_name: 'The Pub', contact_email: 'new@thepub.com.au', mobile: '0400000000', created_at: iso(730), status: 'cancelled', stripe_subscription_id: null }] });
check('gone two years, coming back: gets the full month', trialDays() === 30, trialDays());
check('gone two years, coming back: session created', !!(r3 && r3.body && r3.body.url), r3 && r3.body);

/* 4. Left two months ago and straight back. This is the loop the short trial is actually for. */
var r4 = signup({ prior: [{ id: 'old', venue_name: 'The Pub', contact_email: 'new@thepub.com.au', mobile: '0400000000', created_at: iso(60), status: 'cancelled', stripe_subscription_id: null }] });
check('left and re-signed inside a year: three days, not a month', trialDays() === 3, trialDays());
check('left and re-signed inside a year: flagged for HQ', sent['subscription_data[metadata][returning]'] === '1', sent['subscription_data[metadata][returning]']);

/* 5. A pending signup they abandoned is not an account and must not cost them the month. */
var r5 = signup({ prior: [] });
check('abandoned pending signup: still gets the full month', trialDays() === 30, trialDays());

/* 6. Dean, 17 Sep: the postcode does not decide the price. A Queensland venue on the NSW link
      pays the same as a Sydney one. */
var r6 = signup({ postcode: '4220', code: 'NSW-SEP-2026' });
check('QLD postcode on the NSW link: same deal price', sent['line_items[0][price]'] === MONTHLY, sent['line_items[0][price]']);
check('QLD postcode on the NSW link: the mismatch is still recorded for us',
  sent['subscription_data[metadata][state_matches_postcode]'] === '0', sent['subscription_data[metadata][state_matches_postcode]']);

/* 7. No code at all is a cold visitor, and pays standard. */
var r7 = signup({ code: '' });
check('no founding code: standard price', sent['line_items[0][price]'] === STD_M, sent['line_items[0][price]']);

/* 8. The lookup asks about the mobile as well as the email, or a second account is one new
      address away. */
signup({});
check('the prior-account lookup asks about the mobile too', /mobile\.eq/.test(priorQuery || ''), priorQuery);
check('the prior-account lookup ignores abandoned signups', /status=neq\.pending/.test(priorQuery || ''), priorQuery);

/* ---------------------------------------------------------------------------
   THE SAME RATE ON EVERY PATH.
   Checkout stopped pricing off the postcode on 17 Sep 2026. The card link HQ sends and the
   HQ welcome email, which quotes the rate IN WRITING, were left behind: a Queensland venue we
   set up by hand was charged and told $3.00 while the identical venue that signed itself up
   through the NSW page paid $2.50.
   --------------------------------------------------------------------------- */
print('the same rate on every path');

var TPL = '<p>{{venue_name}} {{player_count}} at {{player_rate}} = {{monthly_total}} '
        + '<a href="{{card_url}}">card</a> {{unsubscribe_url}}</p>';
var mailed;
function welcome(codes, postcode) {
  mailed = null;
  fetch = function (url) {
    if (/welcome-hq\.html/.test(String(url))) {
      return Promise.resolve({ ok: true, text: function () { return Promise.resolve(TPL); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); },
                             text: function () { return Promise.resolve('{}'); } });
  };
  vpaCardLink = function () { return Promise.resolve('https://venueplay.com.au/add-card?f=1&t=2'); };
  vpaSendEmail = function (e, to, subject, html) { mailed = { to: to, subject: subject, html: html }; return Promise.resolve(true); };
  var E = env(codes); E.RESEND_API_KEY = 'x';
  var done = false;
  vpaFireHqWelcome(E, { email: 'pat@thepub.com.au', venueName: 'The Pub', seats: 50,
                        plan: 'monthly', postcode: postcode, foundingId: 'f1', slug: 'the-pub' })
    .then(function () { done = true; });
  drainMicrotasks();
  return mailed;
}

var wNsw = welcome(undefined, '2000');
check('welcome email, NSW postcode: quotes the deal rate', /\$2\.50/.test(wNsw.html), wNsw && wNsw.html);
var wQld = welcome(undefined, '4220');
check('welcome email, QLD postcode: quotes the SAME rate', /\$2\.50/.test(wQld.html), wQld && wQld.html);
check('welcome email: the postcode changes nothing at all', wNsw.html === wQld.html);
check('welcome email: the total matches the rate it quotes', /\$125\.00/.test(wQld.html), wQld.html);

var wShut = welcome('', '2000');
check('deal closed: the welcome email quotes standard', /\$3\.00/.test(wShut.html) && /\$150\.00/.test(wShut.html), wShut.html);

/* The helper both the card link and that email now share. No postcode goes into it, which is
   the point: there is no argument left to get wrong. */
check('the deal is open while any code is live', vpaFoundingOpenNow({ FOUNDING_CODES: 'NSW-SEP-2026' }) === true);
check('the deal is shut when the last code comes out', vpaFoundingOpenNow({ FOUNDING_CODES: '' }) === false);
check('an unset variable is shut, not open', vpaFoundingOpenNow({}) === false);
check('whitespace is not a live code', vpaFoundingOpenNow({ FOUNDING_CODES: ' , ' }) === false);

/* ---------------------------------------------------------------------------
   MOVING PUBS. Dean, 17 Sep 2026: "if I move pubs and my phone number is still linked to an
   old pub you need to work that one out."
   --------------------------------------------------------------------------- */
print('moving pubs');

var OLD_PUB = { id: 'old', venue_name: 'The Old Pub', contact_email: 'pat@theoldpub.com.au',
                mobile: '0400000000', created_at: iso(120), status: 'card_on_file',
                stripe_subscription_id: 'sub_live' };

/* Their mobile is still on the pub they left. Different email, different venue, different
   owner paying. Refusing this is refusing a brand new customer over somebody else's account. */
var m1 = signup({ email: 'pat@thenewpub.com.au', mobile: '0400000000', prior: [OLD_PUB] });
check('moved pubs: signed up, not refused', !!(m1 && m1.body && m1.body.url), m1 && m1.body);
check('moved pubs: gets the full free month', trialDays() === 30, trialDays());
check('moved pubs: the old account is noted for us, not held against them',
  sent['subscription_data[metadata][mobile_on_other_accounts]'] === '1',
  sent['subscription_data[metadata][mobile_on_other_accounts]']);
check('moved pubs: not flagged as returning', sent['subscription_data[metadata][returning]'] === '0',
  sent['subscription_data[metadata][returning]']);

/* Same person, same login, second bill. Still refused: this is the fault the guard is for. */
var m2 = signup({ email: 'pat@theoldpub.com.au', mobile: '0400000000', prior: [OLD_PUB] });
check('same email with billing: still refused', !!(m2.body && m2.body.error), m2.body);
check('same email: the message covers a move, not just "add a venue"',
  /moved to a new venue/i.test(m2.body.error || ''), m2.body.error);
check('same email: it also covers a group adding another venue',
  /Add a venue/.test(m2.body.error || ''), m2.body.error);

/* A shared mobile must not cost the new venue its month either. Their own email has never
   been here, so nothing about them is "returning". */
var m3 = signup({ email: 'new@another.com.au', mobile: '0400000000',
                  prior: [{ id: 'o2', venue_name: 'The Old Pub', contact_email: 'pat@theoldpub.com.au',
                            mobile: '0400000000', created_at: iso(30), status: 'cancelled',
                            stripe_subscription_id: null }] });
check('a shared mobile on a RECENT account does not cost the new venue its month', trialDays() === 30, trialDays());

/* And the email rule still bites where it should: their own address, inside a year. */
var m4 = signup({ email: 'pat@theoldpub.com.au', mobile: '0400000000',
                  prior: [{ id: 'o3', venue_name: 'The Old Pub', contact_email: 'pat@theoldpub.com.au',
                            mobile: '0400000000', created_at: iso(30), status: 'cancelled',
                            stripe_subscription_id: null }] });
check('their own email, left and back inside a year: three days', trialDays() === 3, trialDays());

print(fails ? ('FAILED ' + fails) : 'PASS');
/* THE SAME PERSON, TYPED WITH A CAPITAL. A phone keyboard capitalises the first letter of an
   email. The account is stored as it was first typed, and the second signup must still be seen. */
print('one address however it is typed');
var LIVE_CAPS = [{ id: 'old', venue_name: 'The Royal Hotel', contact_email: 'Bob@RoyalHotel.com.au', mobile: '0411111111',
                   created_at: iso(40), status: 'card_on_file', stripe_subscription_id: 'sub_live' }];
var rc1 = signup({ email: 'bob@royalhotel.com.au', mobile: '0422222222', prior: LIVE_CAPS });
check('lower case against a stored capital: refused, not billed twice', rc1 && rc1.status === 409 && !sent, [rc1 && rc1.status, sent]);
check('lower case against a stored capital: no second row written', inserted === 0, inserted);
var rc2 = signup({ email: 'BOB@ROYALHOTEL.COM.AU', mobile: '0422222222', prior: LIVE_CAPS });
check('capitals against a stored mixed case: refused', rc2 && rc2.status === 409 && !sent, [rc2 && rc2.status, sent]);
var rc3 = signup({ email: 'rob@royalhotel.com.au', mobile: '0422222222', prior: LIVE_CAPS });
check('a DIFFERENT address one letter away is still let in', rc3 && rc3.status === 200 && !!sent, rc3 && rc3.status);
var rc4 = signup({ email: 'bob_smith@royalhotel.com.au', mobile: '0422222222',
                   prior: [{ id: 'o9', venue_name: 'X', contact_email: 'bobXsmith@royalhotel.com.au', mobile: '0433333333',
                             created_at: iso(40), status: 'card_on_file', stripe_subscription_id: 'sub_live' }] });
check('an underscore is a character, not a wildcard: a lookalike does not block anybody', rc4 && rc4.status === 200, rc4 && rc4.status);

/* What the welcome email will be told. It prints this date as the first payment, so it has to
   be the one Stripe was given and not one worked out somewhere else. */
print('the email and Stripe are given the same date');
signup({});
check('new venue: the date carried for the email IS the trial Stripe got', !!sent['metadata[trial_end]'] && sent['metadata[trial_end]'] === sent['subscription_data[trial_end]'], [sent['metadata[trial_end]'], sent['subscription_data[trial_end]']]);
signup({ prior: [{ id: 'old', venue_name: 'The Pub', contact_email: 'new@thepub.com.au', mobile: '0400000000', created_at: iso(60), status: 'cancelled', stripe_subscription_id: null }] });
check('returning venue: three days, and the email is told three days', trialDays() === 3 && sent['metadata[trial_end]'] === sent['subscription_data[trial_end]'] && sent['metadata[returning]'] === '1',
  [trialDays(), sent['metadata[trial_end]'], sent['metadata[returning]']]);

if (fails) { throw new Error('checkout: ' + fails + ' failed'); }
