/* THE 8 NOV EMAIL ROUND, RUN (Dean's notes, 5 Nov 2026 evening). RUNS the shipped billing Worker, the shipped
   /rate/ page script and the shipped vp-session.js functions; only fetch, the database and crypto are stubbed.

   1. The receipt is a RECEIPT that links Stripe's tax invoice ("View your tax invoice", the PDF beside it) and
      carries "Let us know how we're going": three faces, each a signed link for THIS invoice to
      venueplay.com.au/rate/, then "Thank you for being with us."
   2. The /rate/ page records nothing when it opens (mail scanners open links and run JavaScript); only Send
      sends, to POST /venue-rating, and until that route answers ok it hands the answer to the venue's mail app,
      addressed to support@, and says so.
   3. "Manage your plan" opens https://venueplay.com.au/app/billing.html#billing (Account > Billing), never a
      .dev host; signed out, vp-session.js notes the page and the console goes back to it ONCE after sign-in.
   4. "What this is for": Stripe's plan line in two plain lines with room between the words and the amount.
   5. THE 5-DAY GRACE wording is behind VPA_OFFER_GRACE_LIVE, OFF: today the welcome and the reminder say a pause
      ends the offer; switched on, they say Dean's words (5 days after the free month to add a card and keep it).

   Run from the repo root:  jsc tools/test-receipt-survey.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =').replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '').replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; }; AbortController.prototype.abort = function () {}; }
if (typeof clearTimeout === 'undefined') { clearTimeout = function () {}; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: { digest: function (a, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (f, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (a, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37) & 255; return a; } };
(0, eval)(src);

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function drain() { if (typeof drainMicrotasks === 'function') for (var i = 0; i < 60; i++) drainMicrotasks(); }
function visible(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
var sent = [];
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var t = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(t); } }); }
  if (/api\.resend\.com/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e1' }); } }); }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
vpaInsert = function () { return Promise.resolve({}); };
vpaSelect = function (env, table) { if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', payment_reminders: true }]); return Promise.resolve([]); };
var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au', CARD_LINK_SECRET: 's3cret', FOUNDING_CODES: 'OFFER-NOV-2026' };
var INV = { id: 'in_ABC123', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com', amount_paid: 6000, amount_due: 6000,
  hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test_1', invoice_pdf: 'https://pay.stripe.com/invoice/acct_x/test_1/pdf',
  next_payment_attempt: 1796342400, status_transitions: { paid_at: 1796342400 },
  lines: { data: [{ description: '24 Players × Founding Membership (Monthly) (at $2.50 / month)', amount: 6000, quantity: 24, period: { start: 1796306400, end: 1798984800 } }] } };
function clone(o, extra) { var c = JSON.parse(JSON.stringify(o)); for (var k in (extra || {})) c[k] = extra[k]; return c; }

async function main() {
  print('1. The receipt: a receipt, the tax invoice one tap away, and "Let us know how we\'re going"');
  sent = []; await vpaFireInvoiceEmail(ENV, INV); var r = sent[0] || {}, h = String(r.html || ''), t = visible(h);
  check('CONTROL: the receipt was sent', !!r.html, r);
  check('it says it is the receipt and the tax invoice is one tap away, and its subject says receipt', t.indexOf('Thanks, your payment has gone through. This is your receipt, and your tax invoice ABC-0001 is one tap away below.') !== -1 && r.subject === 'Your venueplay receipt: $60.00 paid', [r.subject, t.slice(0, 300)]);
  check('it says when it was paid, from Stripe\'s own paid_at', t.indexOf('Paid on ' + vpaFmtDate(1796342400)) !== -1, t.slice(0, 400));
  check('"View your tax invoice" is the one button, to Stripe\'s hosted invoice; the PDF is a small link beside it',
    (h.match(/<a href="https:\/\/invoice\.stripe\.com\/i\/acct_x\/test_1"[^>]*>View your tax invoice<\/a>/g) || []).length === 1 && /<a href="https:\/\/pay\.stripe\.com\/invoice\/acct_x\/test_1\/pdf"[^>]*>download it as a PDF<\/a>/.test(h));
  var tok = ''; vpaRateToken(ENV, 'in_ABC123').then(function (x) { tok = x; }); drain();
  var faces = [];
  h.replace(/<a href="(https:\/\/venueplay\.com\.au\/rate\/\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, function (m, u, inner) { faces.push({ u: u.replace(/&amp;/g, '&'), w: visible(inner) }); });
  check('three faces, Loving it, Good, Could be better, each to venueplay.com.au/rate/ with r=3, 2, 1, this invoice and its signature',
    faces.length === 3 && /^[0-9a-f]{32}$/.test(tok) && [3, 2, 1].every(function (n, i) {
      return faces[i].u === 'https://venueplay.com.au/rate/?i=in_ABC123&r=' + n + '&n=ABC-0001&t=' + tok; }) &&
    /Loving it/.test(faces[0].w) && /Good/.test(faces[1].w) && /Could be better/.test(faces[2].w), faces);
  var other = ''; vpaRateToken(ENV, 'in_OTHER').then(function (x) { other = x; }); drain();
  check('the signature is for THIS invoice: another invoice gets another one', !!other && other !== tok);
  check('"Let us know how we\'re going", one tap and an optional comment, then "Thank you for being with us."; the Tuesday line is gone',
    t.indexOf("Let us know how we're going Tap a face, add a comment if you like, and send.") !== -1 && t.indexOf('Thank you for being with us.') !== -1 && !/Tuesday|backing us early/.test(t), t.slice(-600));
  sent = []; await vpaFireInvoiceEmail({ RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay-api.workers.dev', CARD_LINK_SECRET: 's3cret' }, INV);
  check('the faces always point at venueplay.com.au, even when the Worker\'s SITE_URL is a .dev address', /https:\/\/venueplay\.com\.au\/rate\/\?i=in_ABC123/.test((sent[0] || {}).html || '') && !/workers\.dev\/rate/.test((sent[0] || {}).html || ''));
  sent = []; await vpaFireInvoiceEmail({ RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au' }, INV);
  var bare = String((sent[0] || {}).html || '');
  check('with no secret to sign with, the receipt still goes, without the faces (never an unsigned link)', !!bare && bare.indexOf('/rate/') === -1 && bare.indexOf('View your tax invoice') !== -1);

  print('\n2. The /rate/ page: nothing on load, Send sends, and until /venue-rating exists the mail app takes it');
  var page = readFile('venueplay/rate/index.html');
  var scripts = page.match(/<script>([\s\S]*?)<\/script>/g) || [];
  var code = scripts.length ? scripts[scripts.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
  check('the page has its one inline script, loads nothing else and has no analytics (the token is in the address)', scripts.length === 1 && !/<script[^>]+src=/i.test(page) && !/gtag|googletagmanager|fbq\(/.test(page) && /noindex/.test(page));
  function run(search, answer) {
    var els = {}, calls = [], faceEls = [];
    ['head', 'lede', 'ask', 'go', 'err', 'note'].forEach(function (id) {
      els[id] = { id: id, textContent: 'start', className: '', value: '', disabled: false, on: {}, parentNode: { insertBefore: function (n) { els.extra = n; } },
        addEventListener: function (tp, fn) { this.on[tp] = fn; } };
    });
    ['3', '2', '1'].forEach(function (v) { faceEls.push({ r: v, className: '', attrs: { 'data-r': v }, on: {}, getAttribute: function (k) { return this.attrs[k]; },
      setAttribute: function (k, x) { this.attrs[k] = x; }, addEventListener: function (tp, fn) { this.on[tp] = fn; } }); });
    var doc = { getElementById: function (id) { return els[id] || null; }, querySelectorAll: function () { return faceEls; },
      createElement: function () { return { appendChild: function (c) { this.child = c; } }; } };
    var loc = { search: search, href: 'https://venueplay.com.au/rate/' + search };
    var net = function (url, opts) { calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body, headers: (opts && opts.headers) || {} });
      if (answer === 'fail') return Promise.reject(new Error('offline'));
      if (answer === 404) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(answer); } }); };
    new Function('document', 'window', 'location', 'fetch', code)(doc, { location: loc }, loc, net);
    drain();
    return { els: els, faces: faceEls, calls: calls, loc: loc, send: function (note) { els.note.value = note || ''; els.go.on.click(); drain(); } };
  }
  var Q = '?i=in_ABC123&r=1&n=ABC-0001&t=0123456789abcdef0123456789abcdef';
  var P = run(Q, 404);
  check('opening the page sends NOTHING (no fetch, no mail app), however long it sits open', P.calls.length === 0 && P.loc.href.indexOf('mailto:') === -1, P.calls);
  check('the face they tapped in the email is the one picked', P.faces[2].className === 'on' && P.faces[2].attrs['aria-checked'] === 'true' && P.faces[0].className === '' && P.faces[1].className === '' && P.els.head.textContent !== 'How are we going?', P.faces.map(function (f) { return f.className; }));
  P.send('The TV froze on Friday');
  var post = P.calls[0] || {}, form = {};
  String(post.body || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) form[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  check('Send makes ONE POST to api.venueplay.com.au/venue-rating, as a form (no preflight), with the invoice, the face, the signature and the comment',
    P.calls.length === 1 && post.url === 'https://api.venueplay.com.au/venue-rating' && post.method === 'POST' && post.headers['Content-Type'] === 'application/x-www-form-urlencoded' &&
    form.i === 'in_ABC123' && form.r === '1' && form.t === '0123456789abcdef0123456789abcdef' && form.comment === 'The TV froze on Friday', post);
  check('the route is not built yet (404): the mail app opens to support@ with the face and the comment, and the page says to hit send there',
    /^mailto:support@venueplay\.com\.au\?subject=How%20we're%20going%3A%20Could%20be%20better%20\(ABC-0001\)&body=/.test(P.loc.href) && decodeURIComponent(P.loc.href).indexOf('The TV froze on Friday') !== -1 &&
    P.els.head.textContent === 'Nearly there' && /Hit send there/.test(P.els.lede.textContent) && P.els.ask.className === 'hidden' && !!P.els.extra, [P.loc.href.slice(0, 160), P.els.head.textContent]);
  var F = run(Q.replace('r=1', 'r=3'), 'fail'); F.send('');
  check('offline, the same: the mail app, never a "saved" it did not do', /^mailto:support@venueplay\.com\.au\?subject=How%20we're%20going%3A%20Loving%20it/.test(F.loc.href) && F.els.head.textContent !== 'Thank you', F.loc.href.slice(0, 120));
  var K = run(Q.replace('r=1', 'r=2'), { ok: true }); K.send('');
  check('once /venue-rating answers ok, it says "Thank you" and no mail app opens', K.els.head.textContent === 'Thank you' && K.loc.href.indexOf('mailto:') === -1, K.els.head.textContent);
  var N = run('?i=in_ABC123&t=0123456789abcdef0123456789abcdef', 404); N.send('');
  check('with no face in the address, nothing is picked and Send asks for one first', N.calls.length === 0 && N.els.err.className === 'err' && /Pick a face/.test(N.els.err.textContent) && N.els.head.textContent === 'How are we going?', [N.els.err.textContent, N.els.head.textContent]);

  print('\n3. Manage your plan opens Account > Billing, and sign-in brings them back to it');
  sent = []; await vpaFireUpcomingEmail({ RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay-api.workers.dev' }, clone(INV, { amount_paid: 0 }));
  var u = String((sent[0] || {}).html || '');
  check('"Manage your plan" is https://venueplay.com.au/app/billing.html#billing, even when SITE_URL is a .dev address',
    /<a href="https:\/\/venueplay\.com\.au\/app\/billing\.html#billing"[^>]*>Manage your plan<\/a>/.test(u), (u.match(/<a href="[^"]*"[^>]*>Manage your plan/) || [])[0]);
  var bh = readFile('venueplay/app/billing.html');
  check('...and billing.html opens the tab the # names, and "billing" is one of its tabs', /TAB_RE = \/\^\(billing\|/.test(bh) && /data-tab="billing"/.test(bh) && /function rememberedTab\(\)\{\s*var h = String\(location\.hash/.test(bh));
  var vs = readFile('venueplay/app/vp-session.js');
  function liftFn(srcText, name) { var m = new RegExp('function\\s+' + name + '\\s*\\(').exec(srcText); var i = srcText.indexOf('{', m.index), d = 0;
    for (var j = i; j < srcText.length; j++) { if (srcText[j] === '{') d++; else if (srcText[j] === '}') { d--; if (!d) return srcText.slice(m.index, j + 1); } } }
  var consts = /var AFTER_KEY = [^\n]+\n/.exec(vs)[0];
  function session(path, hash, now) {
    var store = {}, root = { location: { pathname: path, hash: hash, href: path + hash }, sessionStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } } };
    var api = new Function('root', 'Date', 'SIGNIN', consts + liftFn(vs, 'rememberAfterSignIn') + liftFn(vs, 'afterSignIn') + liftFn(vs, 'requireAuth').replace('return ready()', 'return __ready()') +
      'var __ready = function () { return Promise.resolve({ authed: false }); }; return { req: requireAuth, after: afterSignIn, store: function () { return root.sessionStorage; } };')(root, { now: function () { return now.t; } }, '/app/');
    return { root: root, api: api, store: store };
  }
  var clock = { t: 1000000 };
  var S = session('/app/billing.html', '#billing', clock); S.api.req({ roles: ['owner', 'manager'] }); drain();
  check('signed out on /app/billing.html#billing: off to the sign-in, with the page noted for after it', S.root.location.href === '/app/' && JSON.parse(S.store.vpAfterSignIn || '{}').to === '/app/billing.html#billing', [S.root.location.href, S.store]);
  clock.t += 60000;
  var back = S.api.after(), again = S.api.after();
  check('after the text code the console is told to go back there ONCE', back === '/app/billing.html#billing' && again === null, [back, again]);
  var X = session('/app/billing.html', '#billing', clock); X.api.req({}); drain(); clock.t += 31 * 60000;
  check('a note older than 30 minutes is not used', X.api.after() === null);
  var P2 = session('/app/billing', '#billing', clock); P2.api.req({}); drain();
  check('the live address, /app/billing#billing (Pages drops the .html with a 308 and keeps the #), is noted too', JSON.parse(P2.store.vpAfterSignIn || '{}').to === '/app/billing#billing' && P2.api.after() === '/app/billing#billing', P2.store);
  var I = session('/app/index.html', '', clock); I.api.req({}); drain();
  var I2 = session('/app/index', '', clock); I2.api.req({}); drain();
  var H2 = session('/app/hq', '#x', clock); H2.api.req({}); drain();
  var H = session('/app/hq.html', '', clock); H.api.req({}); drain();
  var E = session('/app/billing.html', '#"><script>', clock); E.api.req({}); drain();
  check('the console itself and HQ are never noted, and a hash that is not a plain tab name is dropped', !I.store.vpAfterSignIn && !I2.store.vpAfterSignIn && !H.store.vpAfterSignIn && !H2.store.vpAfterSignIn && JSON.parse(E.store.vpAfterSignIn || '{}').to === '/app/billing.html', [I.store, H.store, E.store]);
  var Z = session('/app/billing.html', '', clock); Z.store.vpAfterSignIn = JSON.stringify({ to: 'https://evil.example/app/billing.html', at: clock.t });
  check('only an /app/*.html page on this site is ever followed', Z.api.after() === null);
  var ix = readFile('venueplay/app/index.html');
  var staffAt = ix.indexOf('if(ctx.scope==="staff"){'), useAt = ix.indexOf('var back=VP.afterSignIn && VP.afterSignIn(); if(back){ window.location.replace(back); return; }');
  check('the console reads it first thing for a signed-in venue login, and vp-session exports it', staffAt !== -1 && useAt > staffAt && useAt - staffAt < 400 && /afterSignIn: afterSignIn,/.test(vs));

  print('\n4. "What this is for" in two plain lines, with room before the amount');
  var lp = vpaLineParts(INV.lines.data[0]);
  check('Stripe\'s plan line reads "venueplay plan, monthly" over "24 players at $2.50 each" and the dates it covers',
    lp.what === 'venueplay plan, monthly' && lp.detail === '24 players at $2.50 each' && lp.covers === vpaFmtDate(1796306400) + ' to ' + vpaFmtDate(1798984800), lp);
  var big = vpaLineParts({ description: 'Big night extra players - The Royal - 12 over 100 at $2.00', amount: 2400 });
  check('any other line keeps its own plain words', big.what === 'Big night extra players - The Royal - 12 over 100 at $2.00' && big.detail === '' && big.covers === '', big);
  var tbl = vpaInvoiceLinesHtml(INV);
  check('the words cell keeps 16px clear of the amount, which sits top right on one line',
    /<td valign="top" style="padding:10px 16px 10px 0">/.test(tbl) && /<td valign="top" align="right" style="padding:10px 0;width:1%;[^"]*white-space:nowrap">\$60\.00<\/td>/.test(tbl), tbl.slice(0, 600));

  print('\n5. The 5-day grace is in the emails, switched OFF until the billing change ships');
  check('VPA_OFFER_GRACE_LIVE is false in the Worker, declared once', (src.match(/const VPA_OFFER_GRACE_LIVE = /g) || []).length === 1 && /const VPA_OFFER_GRACE_LIVE = false;/.test(src));
  var W = { email: 'gm@pub.com', firstName: 'Sam', venueName: 'The Royal', seats: 10, offerCode: 'OFFER-NOV-2026' };
  var off = '', RAW = ''; vpaRenderProspectWelcome(ENV, W).then(function (x) { RAW += x; off = visible(x); }); drain();
  check('today the welcome says: add the card before the free month ends to keep $2.50, or it is paused and the offer ends; no 5 days',
    off.indexOf("To keep $2.50, add your card before your free month ends. If there's no card by then, your account is paused and the $2.50 offer ends.") !== -1 && off.indexOf('5 days') === -1, off.slice(-900));
  /* The same function, with the switch ON. A const made by the indirect eval cannot be reached from new Function's
     scope, so the two constants it reads come in as arguments, the standard rate read off the Worker. */
  var STD = Number((/const VPA_STANDARD_RATE = ([\d.]+)/.exec(src) || [])[1]);
  function withGrace(name) { return new Function('VPA_OFFER_GRACE_LIVE', 'VPA_STANDARD_RATE', 'return ' + liftFn(src, name).replace(/^function/, 'async function'))(true, STD); }
  var on = ''; withGrace('vpaRenderProspectWelcome')(ENV, W).then(function (x) { RAW += x; on = visible(x); }); drain();
  check('switched on, the welcome says Dean\'s words: 5 days after the free month ends to add the card and keep $2.50, then the offer ends',
    on.indexOf("If there's no card by then, your account is paused, and you have 5 days after your free month ends to add your card and keep $2.50. After that, the offer ends.") !== -1 && on.indexOf('your account is paused and the $2.50 offer ends') === -1, on.slice(-900));
  var R = { kind: 'last', firstName: 'Sam', venueName: 'The Royal', endsWords: 'Wed 2 December', daysLeft: 2, offerRate: 2.5, cardUrl: 'https://venueplay.com.au/add-card?f=f1&t=x', cancelUrl: 'https://venueplay.com.au/prospect/cancel/?f=f1&t=x', email: 'gm@pub.com' };
  var roff = null, ron = null, rstd = null;
  vpaRenderProspectReminder(ENV, R).then(function (x) { RAW += x.html; roff = visible(x.html); });
  withGrace('vpaRenderProspectReminder')(ENV, R).then(function (x) { RAW += x.html; ron = visible(x.html); }, function (e) { print('GRACE REMINDER THREW ' + e); });
  vpaRenderProspectReminder(ENV, clone(R, { offerRate: 3 })).then(function (x) { RAW += x.html; rstd = visible(x.html); }); drain();
  check('the reminder today: it pauses and the $2.50 offer ends; switched on: 5 days after the free month to add the card and keep $2.50',
    roff.indexOf('Your account pauses and the $2.50 offer ends.') !== -1 && roff.indexOf('5 days') === -1 &&
    ron.indexOf('You then have 5 days after your free month ends to add your card and keep $2.50') !== -1 && ron.indexOf('offer ends. Nothing is lost') === -1, [roff && roff.slice(0, 700), ron && ron.slice(0, 700)]);
  check('a venue not on an offer hears neither: it pauses, and a card switches it back on', rstd.indexOf('Your account pauses. Nothing is lost, and adding a card switches it all back on.') !== -1 && !/offer|5 days/.test(rstd.replace(/Unsubscribe[\s\S]*$/, '')), rstd && rstd.slice(0, 700));
  check('no raw IF tags or tokens are left in any of them (the html, comments included)', RAW.length > 5000 && !/IF:|ENDIF|\{\{/.test(RAW));

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (fails) throw new Error(fails + ' failed');
}
main().catch(function (e) { print('ERROR ' + e + '\n' + (e && e.stack)); throw e; });
drain();
