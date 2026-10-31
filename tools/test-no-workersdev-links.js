/* NO EMAIL A VENUE OR A PLAYER GETS CARRIES A workers.dev ADDRESS, RUN (31 Oct 2026).

   The fault: the prospect welcome "Your VenuePlay account for Lakeside Tavern" to a venue on Ozemail
   bounced, "smtp; 550 5.7.1 Policy-DT510: Rejected content policy violation" (Ozemail / Vocus content
   filter, verified in Resend). A plain reply to the same address with only venueplay.com.au links was
   delivered. The welcome's one link on another domain was "Cancel, it's not for us", on
   venueplay-api.dean-tindale.workers.dev, a host spam filters see abused every day.

   This RUNS the shipped billing Worker's email builders against the REAL template files and reads the
   html, text and headers handed to Resend, with the Worker's API_URL and API_ORIGIN both set to the
   workers.dev address (so any builder that still reads them shows up) and with neither set:
     1. every email a venue gets (welcomes, the HQ welcome, the onboarding guide, the prospect welcome
        in all three sign-in shapes, the three card reminders, the receipt, the payment reminder, the
        failed payment, the plan uplift, the leaving emails, a help desk reply, the win-back) carries no
        workers.dev address in its body or subject
     2. the cancel link is on https://venueplay.com.au/, signed, and lands on a page that exists
     3. NO .dev HOST ANYWHERE, headers included (Dean, 31 Oct 2026: "Don't put any .dev links into anything
        marketing or website or email customer facing"). The win-back's List-Unsubscribe header has to name
        the Worker (a mail app's one-click button POSTs to it and Cloudflare Pages cannot answer a POST), and
        it names it as https://api.venueplay.com.au, the Worker's custom domain, whatever API_ORIGIN holds.
        The review buttons in Dean's prospect emails are on api.venueplay.com.au too, and the staff welcome
        text names venueplay.com.au even with SITE_URL on a .dev preview
     4. venueplay/prospect/cancel/: its own script, run with a fake page and a fake network. Opening it
        never POSTs (a mail scanner that runs JavaScript cancels nobody); only the button does, once,
        with the signed token; it shows what the Worker answers

   tools/test-prospect-free-month.js runs the Worker's side of that page (reply=json, CORS, the token).

   Run from the repo root:  jsc tools/test-no-workersdev-links.js */
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };

/* jsc has no TextEncoder or WebCrypto. A stand-in HMAC: deterministic, and different for every input,
   which is all a link builder's test needs (the real HMAC is the Worker's own, unchanged). */
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof crypto === 'undefined') crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
(0, eval)(src);

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }

var WD = 'https://venueplay-api.dean-tindale.workers.dev';   // the old address, as a variable might still hold it
var API = 'https://api.venueplay.com.au';                      // the Worker's own name on our domain (31 Oct 2026)
/* Any host ending in .dev: workers.dev, pages.dev, web.dev, a staging.dev. Not a CSS class (.dev-tv) or prose (".dev links"). */
var DEV_HOST = /(^|[^a-z0-9.-])((?:[a-z0-9-]+\.)+dev)(?![a-z0-9-])/i;
function devHit(s) { var m = DEV_HOST.exec(String(s || '')); return m ? m[2] : ''; }
var sms = [];
var sent = [];
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var tpl = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(tpl); } }); }
  if (/api\.mobilemessage\.com\.au/.test(url)) { sms.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } }); }
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
var FID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
var BASE = { RESEND_API_KEY: 'k', CARD_LINK_SECRET: 'card-link-secret-for-tests-only-0123456789', VP_UNSUB_SECRET: 'unsub-secret-for-tests' };
function envWith(o) { var e = {}; for (var k in BASE) e[k] = BASE[k]; for (var k2 in o) e[k2] = o[k2]; return e; }
/* Production as it bounced: the site on the apex, and the Worker's own address in both variables a builder
   could reach for. And with nothing set at all, where every fallback is the workers.dev one. */
var ENVS = [
  { name: 'API_URL and API_ORIGIN set to workers.dev', env: envWith({ SITE_URL: 'https://venueplay.com.au', API_URL: WD, API_ORIGIN: WD }) },
  { name: 'nothing set', env: envWith({}) },
];
function emailOf(m) { return { subject: m.subject || '', html: m.html || '', text: m.text || '', headers: m.headers || {} }; }
function bodyHas(m, s) { return (m.subject + '\n' + m.html + '\n' + m.text).indexOf(s) !== -1; }
function bodyDev(m) { return devHit(m.subject) || devHit(m.html) || devHit(m.text); }
function headerHits(m, s) { var out = []; for (var k in m.headers) if (String(m.headers[k]).indexOf(s) !== -1) out.push(k); return out; }

/* Every builder, as a venue receives it. Each returns the emails it produced. */
async function lastSent(fn) { sent = []; await fn(); return sent.map(emailOf); }
function asEmail(subject, html, headers) { return [{ subject: subject, html: html || '', text: '', headers: headers || {} }]; }
function BUILDERS(ENV) {
  return [
    ['welcome (one venue)', function () { return lastSent(function () { return vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 }, [{ name: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220' }], false); }); }],
    ['welcome (a group)', function () { return lastSent(function () { return vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@group.com', contact_name: 'Sam', plan: 'monthly' }, [{ name: 'The Anchor', seats: 30, slug: 'the-anchor-2000' }, { name: 'The Crown', seats: 50, slug: 'the-crown-3000' }], true); }); }],
    ['HQ welcome', function () { return lastSent(function () { return vpaFireHqWelcome(ENV, { email: 'owner@pub.com', venueName: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220', comp: true }); }); }],
    ['onboarding guide', function () { return lastSent(function () { return vpbFireVenueOnboarding(ENV, { email: 'owner@pub.com', venueName: 'The Crown', slug: 'the-crown-3000' }); }); }],
    ['prospect welcome (text-code sign-in)', async function () { return asEmail(vpaProspectSubject('Lakeside Tavern'), await vpaRenderProspectWelcome(ENV, { email: 'laketavern@example.com.au', firstName: 'Sam', venueName: 'Lakeside Tavern', slides: 3, mobile: '0412 345 678', mobileLogin: true, foundingId: FID, seats: 10 })); }],
    ['prospect welcome (one-tap link)', async function () { return asEmail(vpaProspectSubject('Lakeside Tavern'), await vpaRenderProspectWelcome(ENV, { email: 'laketavern@example.com.au', firstName: 'Sam', venueName: 'Lakeside Tavern', slides: 0, signinToken: 'tok123', foundingId: FID, seats: 10 })); }],
    ['prospect welcome (no link)', async function () { return asEmail(vpaProspectSubject('Lakeside Tavern'), await vpaRenderProspectWelcome(ENV, { email: 'laketavern@example.com.au', venueName: 'Lakeside Tavern', foundingId: FID })); }],
  ].concat(['early', 'last', 'final'].map(function (kind) {
    return ['card reminder (' + kind + ')', async function () {
      var r = await vpaRenderProspectReminder(ENV, { kind: kind, email: 'laketavern@example.com.au', firstName: 'Sam', venueName: 'Lakeside Tavern', endsWords: 'Wed 2 Dec', daysLeft: 2, offerRate: 2.5,
        cardUrl: await vpaCardLink(ENV, FID), cancelUrl: await vpaProspectCancelLink(ENV, FID) });
      return r ? asEmail(r.subject, r.html) : [];
    }];
  })).concat([
    ['receipt', function () { return lastSent(function () { return vpaFireInvoiceEmail(ENV, { id: 'in_1', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com', amount_paid: 12000, lines: { data: [{ description: '40 x Founding Membership', amount: 12000, quantity: 40 }] } }); }); }],
    ['payment reminder', function () { return lastSent(function () { return vpaFireUpcomingEmail(ENV, { id: 'in_2', customer: 'cus_1', customer_email: 'owner@pub.com', amount_due: 12000, next_payment_attempt: 1790000000, lines: { data: [{ description: '40 x Founding Membership', amount: 12000, quantity: 40 }] } }); }); }],
    ['payment failed', function () { return lastSent(function () { return vpaFirePaymentFailedEmail(ENV, { id: 'in_3', customer_email: 'owner@pub.com', amount_due: 12000, billing_reason: 'subscription_cycle', hosted_invoice_url: 'https://pay.example/y', lines: { data: [{ description: '40 x Founding Membership', amount: 12000 }] } }); }); }],
    ['plan moved up', function () { return lastSent(function () { return vpaFirePlanUpliftEmail(ENV, 'cus_1'); }); }],
    ['cancellation confirmed', function () { return lastSent(function () { return vpaFireCancelConfirm(ENV, { venueId: 'v1', name: 'The Royal Hotel', ends: '18 September 2026', account: { contact_email: 'owner@pub.com' } }); }); }],
    ['last day (leaving)', async function () { return asEmail('Friday is your last day on VenuePlay', vpaGoodbyeHtml(ENV, { hello: 'Hi Sam,', name: 'The Royal Hotel', day: 'Friday', dated: '24 October 2026', rate: '$2.50', founding: true })); }],
    ['help desk reply', async function () { return asEmail('Re: help', helpReplyHtml({ brand: 'venueplay', category: 'venue_support', ticket_no: 1042 }, 'Sorted.', 'support@venueplay.com.au')); }],
    ['win-back (marketing)', async function () {
      var html = '<p>Keep The Royal Hotel on VenuePlay?</p>' + (await vpUnsubFooterHtml(ENV, 'owner@pub.com', 'winback'));
      return asEmail('Keep The Royal Hotel on VenuePlay?', vpaEmailDocument(html, 'Keep The Royal Hotel on VenuePlay?'), await vpUnsubHeaders(ENV, 'owner@pub.com', 'winback'));
    }],
  ]);
}

async function main() {
  print('No workers.dev address in any email a venue gets');
  for (var e = 0; e < ENVS.length; e++) {
    var ENV = ENVS[e].env;
    print(''); print('With ' + ENVS[e].name + ':');
    var list = BUILDERS(ENV), headerOnly = [];
    for (var i = 0; i < list.length; i++) {
      var name = list[i][0], got = [];
      try { got = await list[i][1](); } catch (x) { got = []; print('  (' + name + ' threw: ' + x + ')'); }
      var bad = got.filter(function (m) { return bodyHas(m, 'workers.dev') || bodyDev(m); });
      check(name + ': built, and no workers.dev or other .dev host in its subject, html or text', got.length > 0 && got.every(function (m) { return m.html.length > 200; }) && !bad.length,
        got.length ? (bad[0] ? (bodyDev(bad[0]) || bad[0].html.slice(Math.max(0, bad[0].html.indexOf('workers.dev') - 160), bad[0].html.indexOf('workers.dev') + 60)) : got.map(function (m) { return m.html.length; })) : 'nothing was built');
      got.forEach(function (m) { for (var k in m.headers) if (devHit(m.headers[k]) || String(m.headers[k]).indexOf('workers.dev') !== -1) headerOnly.push(name + ' / ' + k + ': ' + m.headers[k]); });
    }
    check('no email carries a .dev host in any header either (the List-Unsubscribe exception is gone: the header names api.venueplay.com.au)',
      headerOnly.length === 0, headerOnly);
    var wb = await vpUnsubHeaders(ENV, 'Owner@Pub.com', 'winback');
    check('the win-back\'s one-click List-Unsubscribe header is the Worker on https://api.venueplay.com.au/unsubscribe, with the token, then the mailto',
      /^<https:\/\/api\.venueplay\.com\.au\/unsubscribe\?e=owner%40pub\.com&t=[0-9a-f]{32}&c=winback>, <mailto:hello@venueplay\.com\.au\?subject=unsubscribe>$/.test(wb['List-Unsubscribe'] || '') &&
      wb['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', wb);
    var rv = await vpaReviewLinks(ENV, '2026-10-31-test-alpha', 1790000000, 1);
    var rvBad = Object.keys(rv).filter(function (k) { return rv[k].indexOf(API + '/autopilot/review?f=2026-10-31-test-alpha&a=' + k + '&r=1&x=1790000000&t=') !== 0 || devHit(rv[k]); });
    check('the Yes / No / Edit buttons in Dean\'s prospect review emails are on api.venueplay.com.au, never a .dev address',
      Object.keys(rv).length === 3 && rvBad.length === 0, rv);
  }

  print(''); print('API_ORIGIN is only ever a venueplay.com.au API host');
  [['the old workers.dev address', WD, API], ['a pages.dev preview', 'https://abc123.venueplay.pages.dev', API],
   ['the site itself (Pages cannot answer the one-click POST)', 'https://www.venueplay.com.au', API],
   ['api.venueplay.com.au with a trailing slash', 'https://api.venueplay.com.au/', API],
   ['another venueplay.com.au API host (a staging name)', 'https://api-staging.venueplay.com.au', 'https://api-staging.venueplay.com.au'],
   ['nothing set', '', API]].forEach(function (c) {
    check('API_ORIGIN = ' + c[0] + ': the Worker is named as ' + c[2], vpUnsubApi(envWith(c[1] ? { API_ORIGIN: c[1] } : {})) === c[2], vpUnsubApi(envWith(c[1] ? { API_ORIGIN: c[1] } : {})));
  });

  print(''); print('The text a new host or manager gets');
  /* jsc has no timers, AbortController or btoa: stand-ins, so the Worker's own code runs as it does on Cloudflare. */
  if (typeof AbortController === 'undefined') AbortController = function () { this.signal = {}; this.abort = function () {}; };
  if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; clearTimeout = function () {}; }
  if (typeof btoa === 'undefined') btoa = function (x) { return 'b64:' + x; };
  [['SITE_URL on www', 'https://www.venueplay.com.au'], ['SITE_URL on a .dev preview', 'https://abc123.venueplay.pages.dev'], ['no SITE_URL', '']].forEach(function (c) {
    sms = [];
    var e = envWith({ MOBILEMESSAGE_USERNAME: 'u', MOBILEMESSAGE_PASSWORD: 'p' }); if (c[1]) e.SITE_URL = c[1];
    var fin = false; vpaSendStaffWelcomeSms(e, '+61412345678', { venueName: 'The Royal Hotel', slug: 'the-royal-hotel-4220' }).then(function () { fin = true; });
    for (var i = 0; i < 50 && !fin; i++) drain();
    var msg = (((sms[0] || {}).messages || [])[0] || {}).message || '';
    check('with ' + c[0] + ': "To sign in visit venueplay.com.au/app", the TV link on venueplay.com.au, no .dev host',
      msg === 'The Royal Hotel has set you up on VenuePlay. To sign in visit venueplay.com.au/app. TV URL: venueplay.com.au/tv?the-royal-hotel-4220' && !devHit(msg), msg);
  });

  print(''); print('The cancel link');
  var a = await vpaProspectCancelLink(envWith({ API_URL: WD, API_ORIGIN: WD }), FID);
  check('with no SITE_URL (and the Worker\'s own address in API_URL): https://venueplay.com.au/prospect/cancel/, the account, a 32-character signature',
    /^https:\/\/venueplay\.com\.au\/prospect\/cancel\/\?f=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&t=[0-9a-f]{32}$/.test(a), a);
  var b = await vpaProspectCancelLink(envWith({ SITE_URL: 'https://venueplay.com.au/' }), FID);
  check('with SITE_URL the apex: the same address, and the same signature (the token check is unchanged)', b === a, b);
  var c = await vpaProspectCancelLink(envWith({ SITE_URL: WD }), FID);
  check('a SITE_URL that is not venueplay.com.au is never used for a link in an email', c.indexOf('https://venueplay.com.au/prospect/cancel/?') === 0, c);
  var d = await vpaProspectCancelLink(envWith({}), 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  check('signed per account: another account gets another signature', d.split('&t=')[1] !== a.split('&t=')[1] && /&t=[0-9a-f]{32}$/.test(d), [a, d]);
  var path = a.replace(/^https:\/\/venueplay\.com\.au/, '').split('?')[0];
  var page = ''; try { page = readFile('venueplay' + path + 'index.html'); } catch (x) {}
  check('the link lands on a page that exists in the site (venueplay' + path + 'index.html)', page.indexOf('Cancel VenuePlay for your venue?') !== -1, path);
  var w = await vpaRenderProspectWelcome(ENVS[0].env, { email: 'laketavern@example.com.au', venueName: 'Lakeside Tavern', foundingId: FID });
  var href = (/href="([^"]*prospect\/cancel[^"]*)"/.exec(w || '') || [])[1] || '';
  check('the prospect welcome\'s Cancel button is that link', href.replace(/&amp;/g, '&') === a, href);
  var u = (/href="([^"]*unsubscribe[^"]*)"/.exec(await vpUnsubFooterHtml(ENVS[0].env, 'Owner@Pub.com', 'winback')) || [])[1] || '';
  check('the win-back footer\'s Unsubscribe is venueplay.com.au/unsubscribe for that address', u === 'https://venueplay.com.au/unsubscribe?e=owner%40pub.com', u);

  print(''); print('venueplay/prospect/cancel/: opening it never cancels, the button does');
  var html = readFile('venueplay/prospect/cancel/index.html');
  var scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  var code = scripts.length ? scripts[scripts.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
  check('the page asks the Worker on api.venueplay.com.au and names no .dev host anywhere in it, comments included', code.indexOf('var VP_WORKER = "' + API + '";') !== -1 && !devHit(html) && html.indexOf('workers.dev') === -1, devHit(html) || 'no VP_WORKER line');
  check('the page has its one inline script and loads nothing else (no analytics: the token is in the address)', scripts.length === 1 && !/<script[^>]+src=/i.test(html) && !/gtag|googletagmanager|fbq\(/.test(html), scripts.length);
  function run(search, answers) {
    var els = {}, calls = [], queue = (answers || []).slice();
    ['head', 'lede', 'ask', 'go', 'err', 'foot'].forEach(function (id) {
      els[id] = { id: id, textContent: 'start', className: '', disabled: false, on: {}, addEventListener: function (t, fn) { this.on[t] = fn; } };
    });
    var doc = { getElementById: function (id) { return els[id] || null; } };
    var win = { location: { search: search } };
    var net = function (url, opts) {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body, headers: (opts && opts.headers) || {} });
      var a = queue.length ? queue.shift() : null;
      if (a === 'fail') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(a); } });
    };
    new Function('document', 'window', 'location', 'fetch', code)(doc, win, win.location, net);
    for (var i = 0; i < 50; i++) drain();
    return { els: els, calls: calls, click: function () { els.go.on.click(); for (var i = 0; i < 50; i++) drain(); } };
  }
  var ASK = { ok: true, state: 'ask', title: 'Cancel VenuePlay for Lakeside Tavern?', text: 'No problem at all.', foot: 'Questions? Call us.' };
  var DONE = { ok: true, state: 'done', title: 'All done', text: 'VenuePlay for Lakeside Tavern is cancelled.' };
  var q = '?f=' + FID + '&t=0123456789abcdef0123456789abcdef';
  var P = run(q, [ASK, DONE]);
  var posts = function (r) { return r.calls.filter(function (c) { return c.method !== 'GET'; }); };
  check('opening the page sends NO POST, only one GET asking the Worker what to say (reply=json)',
    posts(P).length === 0 && P.calls.length === 1 && P.calls[0].url === API + '/prospect/cancel?f=' + FID + '&t=0123456789abcdef0123456789abcdef&reply=json', P.calls);
  check('it shows the Worker\'s question and keeps the button', P.els.head.textContent === ASK.title && P.els.lede.textContent === ASK.text && P.els.ask.className === '', [P.els.head.textContent, P.els.ask.className]);
  check('nothing on the page clicks the button for them (no POST however long it sits open)', posts(P).length === 0 && P.calls.length === 1);
  P.click();
  var post = posts(P)[0] || {};
  var form = {}; String(post.body || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) form[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  check('the button sends ONE POST to the Worker\'s /prospect/cancel, as a form (no preflight), with the account, its signature and reply=json',
    posts(P).length === 1 && post.url === API + '/prospect/cancel' && post.headers['Content-Type'] === 'application/x-www-form-urlencoded' &&
    form.f === FID && form.t === '0123456789abcdef0123456789abcdef' && form.reply === 'json', post);
  check('and shows what the Worker answered, with the button gone', P.els.head.textContent === 'All done' && P.els.lede.textContent === DONE.text && P.els.ask.className === 'hidden', [P.els.head.textContent, P.els.ask.className]);

  var N = run('?f=' + FID, []);
  check('a link with no signature asks the Worker nothing and offers no button', N.calls.length === 0 && N.els.head.textContent === 'That link is not complete' && N.els.ask.className === 'hidden', [N.calls, N.els.head.textContent]);
  var B = run(q, [{ ok: true, state: 'bad', title: 'That link has not worked', text: 'Sorry.' }]);
  check('a link the Worker does not accept: its words, and no button', B.els.head.textContent === 'That link has not worked' && B.els.ask.className === 'hidden' && posts(B).length === 0);
  var O = run(q, ['fail', 'fail']);
  check('the Worker out of reach on load: the question still stands, with the button', O.els.head.textContent === 'start' && O.els.ask.className === '' && posts(O).length === 0, O.els.head.textContent);
  O.click();
  check('a POST that fails says so and gives the button back', posts(O).length === 1 && O.els.go.disabled === false && O.els.err.className === 'err' && /did not go through/.test(O.els.err.textContent), [O.els.go.disabled, O.els.err.className]);
  var pageText = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
  check('the page\'s own words: the Worker\'s question, "Yes, cancel it", no em dash', /<h1 id="head">Cancel VenuePlay for your venue\?<\/h1>/.test(pageText) &&
    pageText.indexOf('No problem at all, and thanks for having a look. There is no card on your account, so nothing has been charged and nothing will be. We will switch the account off and stop the reminders.') !== -1 &&
    />Yes, cancel it</.test(pageText) && !/[\u2014\u2013]/.test(html));

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
}
var done = false, err = null;
main().then(function () { done = true; }, function (e) { err = e; done = true; });
for (var i = 0; i < 400 && !done; i++) drain();
if (err) { print('  FAIL the suite threw: ' + (err && err.stack || err)); fails++; }
if (!done) { print('  FAIL the suite never finished'); fails++; }
if (fails) throw new Error(fails + ' failed');
