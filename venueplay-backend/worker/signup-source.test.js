/* THE GFLAM BANNER: THE RIGHT OFFER, AND A COUNT DEAN CAN TRUST (4 Nov 2026).

   Dean: "if someone lands on the Gflam group website and clicks the venueplay banner, send them
   to a discount link because they've come from us ... is there a way to tell how many people
   actually sign up through that?" The link is venueplay.com.au/gflam.

   This RUNS the code, it does not grep it:
     1. venueplay/app/vp-offer.js picks the row live TODAY for /gflam (Brisbane calendar month,
        the year from the code), so the group site never needs editing at a month's end
     2. venueplay/_redirects serves /gflam from the offer page
     3. venueplay/app/vp-subscribe.js tags a visit to /gflam utm_source=gflam.com.au and keeps
        the tag for the visit, so a sign-up on a later page still carries it
     4. the billing Worker's handleCheckout, run for real with only fetch replaced, writes one
        signup_source audit row and puts the source on the Stripe session
     5. the HQ count (vpaSignupSourceTally, and the route end to end) counts a venue once,
        "signed up" only when the card went in, this month by Brisbane, test venues left out,
        and REFUSES to show a number when the database does not answer

   Run: jsc venueplay-backend/worker/signup-source.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, saw) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (!c && saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); if (!c) bad++; }
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 50) return t; } catch (e) {} }
  throw new Error('cannot find ' + rel);
}
function utc(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0); }

print('1. /gflam shows the offer that is live today');
var offerRoot = {};
(new Function('window', find('venueplay/app/vp-offer.js')))(offerRoot);
var VO = offerRoot.VPOffer;
pass('vp-offer.js exports forDate and isGflam', !!(VO && VO.forDate && VO.isGflam));
pass('4 November 2026 (Brisbane) is the November offer', VO.forDate(utc(2026, 11, 4, 2)) === 'nov', VO.forDate(utc(2026, 11, 4, 2)));
pass('11:59pm on 30 November in Brisbane is still November', VO.forDate(utc(2026, 11, 30, 13, 59)) === 'nov', VO.forDate(utc(2026, 11, 30, 13, 59)));
pass('midnight on 1 December in Brisbane (2pm 30 Nov UTC) is December', VO.forDate(utc(2026, 11, 30, 14, 0)) === 'dec', VO.forDate(utc(2026, 11, 30, 14, 0)));
pass('January 2027 is the January offer', VO.forDate(utc(2027, 1, 10)) === 'jan');
pass('October 2026 (marked ended) gives no offer', VO.forDate(utc(2026, 10, 20)) === null, VO.forDate(utc(2026, 10, 20)));
pass('November 2027 does not reuse the 2026 November row', VO.forDate(utc(2027, 11, 4)) === null, VO.forDate(utc(2027, 11, 4)));
pass('a month with no row (April 2027) gives no offer', VO.forDate(utc(2027, 4, 4)) === null);
var g = VO.forPath('/gflam', utc(2026, 11, 4, 2));
pass('/gflam on 4 November shows the November row and its code', g.key === 'nov' && g.row.code === 'OFFER-NOV-2026', g);
pass('/gflam/ (trailing slash) is the same', VO.forPath('/gflam/', utc(2026, 12, 3)).key === 'dec');
var past = VO.forPath('/gflam', utc(2027, 4, 4));
pass('/gflam past the last row shows an ENDED row (the page then quotes the standard rate)', past.row && past.row.ended === true, past);
pass('/offer-dec still shows December whatever the date', VO.forPath('/offer-dec', utc(2026, 11, 4)).key === 'dec');
pass('/nsw is still October', VO.forPath('/nsw', utc(2026, 11, 4)).key === 'oct');
pass('/gflamx is not the gflam link', VO.isGflam('/gflamx') === false && VO.isGflam('/gflam') === true);

print('\n2. the address is served');
var red = find('venueplay/_redirects');
pass('_redirects serves /gflam from the offer page (a 200 rewrite, the address stays /gflam)', /^\/gflam\s+\/nsw\s+200\s*$/m.test(red));

print('\n3. a visit to /gflam is tagged, and the tag lasts the visit');
function subscribePage(pathname, search, store) {
  var w = { location: { pathname: pathname, search: search || '' },
            sessionStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
            document: { readyState: 'complete', querySelectorAll: function () { return []; } },
            fetch: function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); } };
  (new Function('window', find('venueplay/app/vp-subscribe.js')))(w);
  return w.VPSubscribe;
}
var store = {};
var s1 = subscribePage('/gflam', '', store);
var u1 = s1.utm();
pass('landing on /gflam gives utm_source=gflam.com.au', u1.utm_source === 'gflam.com.au' && u1.utm_medium === 'banner' && u1.utm_campaign === 'group-site', u1);
var u2 = subscribePage('/', '', store).utm();
pass('the home page later in the same visit still carries it', u2.utm_source === 'gflam.com.au', u2);
var u3 = subscribePage('/gflam', '?utm_source=gflam.com.au&utm_campaign=xmas', {}).utm();
pass('tags typed onto the link win', u3.utm_campaign === 'xmas', u3);
var u4 = subscribePage('/offer-nov', '', {}).utm();
pass('an untagged visit to /offer-nov is not counted as gflam', !u4.utm_source, u4);
var nsw = find('venueplay/nsw.html'), home = find('venueplay/index.html');
pass('the offer page sends the visit\'s tags with the sign-up', /embedded: wantEmbedded, utm: \(window\.VPSubscribe && VPSubscribe\.utm\) \? VPSubscribe\.utm\(\) : \{\} \}/.test(nsw));
pass('the home page does too (tags only, no offer)', /embedded: wantEmbedded, utm: \(window\.VPSubscribe && VPSubscribe\.utm\) \? VPSubscribe\.utm\(\) : \{\} \}/.test(home));

print('\n4. the billing Worker records where the sign-up came from');
var src = find('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, error: function () {}, warn: function () {} };
URLSearchParams = function () { this._ = []; };
URLSearchParams.prototype.set = function (k, v) {
  for (var i = 0; i < this._.length; i++) if (this._[i][0] === String(k)) { this._[i][1] = String(v); return; }
  this._.push([String(k), String(v)]);
};
URLSearchParams.prototype.get = function (k) { for (var i = 0; i < this._.length; i++) if (this._[i][0] === String(k)) return this._[i][1]; return null; };
URLSearchParams.prototype.append = URLSearchParams.prototype.set;
URLSearchParams.prototype.toString = function () {
  var enc = function (x) { return encodeURIComponent(x).replace(/%20/g, '+'); };
  return this._.map(function (kv) { return enc(kv[0]) + '=' + enc(kv[1]); }).join('&');
};
(0, eval)(src);

function reply(body, ok) {
  return Promise.resolve({ ok: ok !== false, status: ok === false ? 500 : 200,
    json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });
}
var sent, audits;
function signup(utm) {
  sent = null; audits = [];
  fetch = function (url, opts) {
    url = String(url);
    if (/checkout\/sessions/.test(url)) {
      sent = {};
      String(opts.body).split('&').forEach(function (kv) { var i = kv.indexOf('='); sent[decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
      return reply({ url: 'https://checkout.stripe.com/x', client_secret: 'cs_1' });
    }
    if (/vp_admin_audit/.test(url) && opts && opts.method === 'POST') { audits.push(JSON.parse(opts.body)); return reply(null); }
    if (/venueplay_founding/.test(url) && opts && opts.method === 'POST') return reply([{ id: 'row_new' }]);
    return reply([]);
  };
  var body = { email: 'pat@thepubhotel.com.au', name: 'Pat', mobile: '0400000000', founding_code: 'OFFER-DEC-2099',
    plan: 'monthly', venues: [{ name: 'The Pub', seats: 50, postcode: '4000' }], compliance_accepted: true };
  if (utm !== undefined) body.utm = utm;
  var req = { json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } };
  var out = null;
  handleCheckout(req, { FOUNDING_CODES: 'OFFER-DEC-2099', STRIPE_PRICE_MONTHLY: 'pm', STRIPE_PRICE_ANNUAL: 'pa',
    STRIPE_PRICE_STANDARD_MONTHLY: 'sm', STRIPE_PRICE_STANDARD_ANNUAL: 'sa', STRIPE_SECRET_KEY: 'x',
    SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_KEY: 'k', SITE_URL: 'https://venueplay.com.au' },
    function (b, st) { return { body: b, status: st || 200 }; })
    .then(function (r) { out = r; }).catch(function (e) { out = { body: { error: 'THREW: ' + e }, status: 0 }; });
  drainMicrotasks();
  return out;
}
var r = signup({ utm_source: 'gflam.com.au', utm_medium: 'banner', utm_campaign: 'group-site' });
pass('a sign-up from /gflam reaches the card step', !!(r && r.body && r.body.url), r && r.body);
var srcRows = audits.filter(function (a) { return a.action === 'signup_source'; });
pass('one signup_source row is written for it', srcRows.length === 1, audits);
pass('the row names the account and the source', srcRows[0] && srcRows[0].target === 'account:row_new' && srcRows[0].detail.utm_source === 'gflam.com.au' && srcRows[0].detail.utm_campaign === 'group-site', srcRows[0]);
pass('the Stripe session carries the source', sent && sent['metadata[utm_source]'] === 'gflam.com.au' && sent['subscription_data[metadata][utm_source]'] === 'gflam.com.au', sent && sent['metadata[utm_source]']);
signup(undefined);
pass('an untagged sign-up writes no source row (nothing is guessed)', audits.filter(function (a) { return a.action === 'signup_source'; }).length === 0, audits);
pass('and its Stripe source is blank', sent && sent['metadata[utm_source]'] === '', sent && sent['metadata[utm_source]']);
signup({ utm_source: 'x'.repeat(500) + '<script>' });
var long = audits.filter(function (a) { return a.action === 'signup_source'; })[0];
pass('a silly long tag is cut to 80 characters', long && long.detail.utm_source.length === 80, long && long.detail.utm_source.length);

print('\n5. the count in HQ');
var NOW = utc(2026, 11, 20, 2);
var T = vpaSignupSourceTally([
  { target: 'account:1', detail: { utm_source: 'gflam.com.au', venue: 'A' }, created_at: '2026-11-19T00:00:00Z' },
  { target: 'account:1', detail: { utm_source: 'gflam.com.au', venue: 'A' }, created_at: '2026-11-19T00:01:00Z' },
  { target: 'account:2', detail: { utm_source: 'gflam.com.au', venue: 'B' }, created_at: '2026-11-18T00:00:00Z' },
  { target: 'account:3', detail: { utm_source: 'www.gflam.com.au', venue: 'C' }, created_at: '2026-10-31T13:30:00Z' },
  { target: 'account:4', detail: { utm_source: 'gflam.com.au', venue: 'Test Alpha' }, created_at: '2026-11-18T00:00:00Z' },
  { target: 'account:5', detail: { utm_source: 'instantly', venue: 'E' }, created_at: '2026-11-18T00:00:00Z' }
], [
  { id: 1, venue_name: 'A', stripe_subscription_id: 'sub_a' },
  { id: 2, venue_name: 'B', stripe_subscription_id: null },
  { id: 3, venue_name: 'C', stripe_subscription_id: 'sub_c' },
  { id: 4, venue_name: 'Test Alpha', stripe_subscription_id: 'sub_t' },
  { id: 5, venue_name: 'E', stripe_subscription_id: 'sub_e' }
], NOW);
var G = T.sources.filter(function (x) { return x.source === 'gflam.com.au'; })[0];
pass('gflam.com.au and www.gflam.com.au are one source', !!G && T.sources.filter(function (x) { return /gflam/.test(x.source); }).length === 1, T.sources);
pass('signed up all time = 2 (A and C; B never added a card; the test venue is left out)', G && G.signed_up.all === 2, G && G.signed_up);
pass('signed up this month = 1 (C started 11:30pm on 31 October in Brisbane, so it is October)', G && G.signed_up.month === 1, G && G.signed_up);
pass('started = 3 all time, 2 this month (a retry of the same account counts once)', G && G.started.all === 3 && G.started.month === 2, G && G.started);
pass('another source is kept apart', T.sources.some(function (x) { return x.source === 'instantly' && x.signed_up.all === 1; }));
pass('the month is Brisbane\'s', T.month === '2026-11', T.month);

function route(auditsOk) {
  fetch = function (url) {
    url = String(url);
    if (/vp_admin_audit/.test(url)) return auditsOk ? reply([{ target: 'account:7', detail: { utm_source: 'gflam.com.au' }, created_at: new Date().toISOString() }]) : reply({ message: 'down' }, false);
    if (/venueplay_founding\?id=in\.\(7\)/.test(url)) return reply([{ id: 7, venue_name: 'Seven', stripe_subscription_id: 'sub_7' }]);
    return reply([]);
  };
  vpaRequireAdmin = function () { return Promise.resolve({ role: 'owner', label: 'Dean' }); };
  var out = null;
  vpaHandleSignupSources({}, {}, function (b, st) { return { body: b, status: st || 200 }; })
    .then(function (x) { out = x; }).catch(function (e) { out = { body: { error: 'THREW ' + e }, status: 0 }; });
  drainMicrotasks();
  return out;
}
var ok1 = route(true);
var g1 = ok1 && ok1.body && (ok1.body.sources || []).filter(function (x) { return x.source === 'gflam.com.au'; })[0];
pass('the HQ route counts a real sign-up end to end', g1 && g1.signed_up.all === 1 && g1.signed_up.month === 1, ok1 && ok1.body);
var down = route(false);
pass('when the database does not answer, HQ gets an error, never a 0', down && down.status === 503 && !down.body.sources, down);

var hqjs = find('venueplay/app/vp-reports-hq.js');
var hqRoot = { document: { getElementById: function () { return null; } } };
(new Function('window', hqjs))(hqRoot);
var html = hqRoot.VPReports.sourcesHtml({ sources: [{ source: 'gflam.com.au', started: { month: 3, all: 5 }, signed_up: { month: 1, all: 4 }, recent: [] }] });
pass('HQ says "Signed up from gflam.com.au: 1 this month, 4 all time"', html.indexOf('Signed up from gflam.com.au: <b>1</b> this month, <b>4</b> all time.') !== -1, html.slice(0, 160));
var none = hqRoot.VPReports.sourcesHtml({ sources: [] });
pass('with no rows yet it says 0 and 0, from the Worker\'s own answer', none.indexOf('<b>0</b> this month, <b>0</b> all time') !== -1);
pass('no em dashes in what HQ shows', html.indexOf('—') === -1);

print('\n' + (bad ? bad + ' FAILED, ' + ran + ' checks' : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
