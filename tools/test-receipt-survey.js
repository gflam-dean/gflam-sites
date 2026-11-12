/* RE-PINNED to Dean's words (Dean via main INBOX 331, 12 Nov 2026): no "free" in any venue email. "Your first month is on us.
   It starts the first time you sign in", "your first month", and the welcome's slides line ends "You can keep them on or
   swap them out. I just wanted you to see how the slides work in between your games." (INBOX 336, 12 Nov) Every changed pin is listed in ~/venue-enrich/reports/email-words-12nov/REPINS.md. */
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
  h.replace(/<a href="(https:\/\/venueplay\.com\.au\/rate\/\?[^"]*&r=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, function (m, u, inner) { faces.push({ u: u.replace(/&amp;/g, '&'), w: visible(inner) }); });
  check('three faces, Loving it, Good, Not quite, each to venueplay.com.au/rate/ with r=3, 2, 1, this invoice and its signature',
    faces.length === 3 && /^[0-9a-f]{32}$/.test(tok) && [3, 2, 1].every(function (n, i) {
      return faces[i].u === 'https://venueplay.com.au/rate/?i=in_ABC123&r=' + n + '&n=ABC-0001&t=' + tok; }) &&
    /Loving it/.test(faces[0].w) && /Good/.test(faces[1].w) && /Not quite/.test(faces[2].w), faces);
  var other = ''; vpaRateToken(ENV, 'in_OTHER').then(function (x) { other = x; }); drain();
  check('the signature is for THIS invoice: another invoice gets another one', !!other && other !== tok);
  check('"or tap Send feedback" opens the same signed page with no face picked', h.indexOf('or tap <a href="https://venueplay.com.au/rate/?i=in_ABC123&n=ABC-0001&t=' + tok + '"') !== -1 && /Send feedback<\/a>\.<\/p>/.test(h), (h.match(/.{0,120}Send feedback.{0,20}/) || [])[0]);
  check('the faces fit one line on a 320px phone: 20px faces, 12px words that never wrap, 2px padding', (h.match(/padding:8px 2px[^"]*"><span style="display:block;font-size:20px/g) || []).length === 3 && (h.match(/font-size:12px;line-height:1\.25;font-weight:700;color:#0A0A0B;white-space:nowrap">/g) || []).length === 3);
  check('the GST and ABN line is 12px, under the GST box at full width (one line at 375px: measured 277px of 295)', /<\/table><\/td><\/tr><\/table><p style="margin:0 0 22px;font-size:12px;line-height:1\.4;color:#9a9aa4">Prices include GST\. venueplay, ABN 35 679 383 049\.<\/p>/.test(h));
  check('"Let us know how we\'re going", one tap and an optional comment, then "Thank you for being with us."; the Tuesday line is gone',
    t.indexOf("Let us know how we're going Tap a face. Add a comment if you like.") !== -1 && t.indexOf('Thank you for being with us.') !== -1 && !/Tuesday|backing us early/.test(t), t.slice(-600));
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
    /^mailto:support@venueplay\.com\.au\?subject=How%20we're%20going%3A%20Not%20quite%20\(ABC-0001\)&body=/.test(P.loc.href) && decodeURIComponent(P.loc.href).indexOf('The TV froze on Friday') !== -1 &&
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
  check('Stripe\'s plan line is one line: "24 players at $2.50 each, 4 December to 4 January", and the $60.00 above is not said again (round 8)',
    lp.plan === true && lp.each === '24 players at $2.50 each' && lp.covers === '4 December to 4 January' && visible(vpaInvoiceLinesHtml(INV)) === 'What this is for 24 players at $2.50 each, 4 December to 4 January' && !/venueplay plan/.test(vpaInvoiceLinesHtml(INV)), [lp, visible(vpaInvoiceLinesHtml(INV))]);
  var G2 = clone(INV, { lines: { data: [{ description: '80 Players × Founding Membership (Monthly) (at $2.50 / month)', amount: 20000, quantity: 80, period: { start: 1796306400, end: 1798984800 } }] } });
  var gv = visible(vpaInvoiceLinesHtml(G2));
  check('a group line that is not split stays the one plain line (the per-venue split, with its extras and totals, is vpbSplitPlanLine\'s and tools/test-group-invoice-lines.js, Dean\'s INBOX 75c layout)',
    gv === 'What this is for 80 players at $2.50 each, 4 December to 4 January', gv);
  var big = vpaLineParts({ description: 'Big night extra players - The Royal - 12 over 100 at $2.00', amount: 2400 });
  check('any other line keeps its own plain words', big.plan === false && big.what === 'Big night extra players - The Royal - 12 over 100 at $2.00' && big.covers === '', big);
  var tbl = vpaInvoiceLinesHtml(INV);
  check('one column: the line is its own row, with no amount column repeating the total',
    /<tr><td colspan="2" style="padding:7px 0;font-size:14px;[^"]*">24 players at \$2\.50 each, 4 December to 4 January<\/td><\/tr><\/table>/.test(tbl) && tbl.indexOf('$60.00') === -1, tbl.slice(0, 600));

  print('\n5. The 5-day keep is never said in an email (Dean, 7 Nov 2026)');
  check('there is no VPA_OFFER_GRACE_LIVE switch left in the Worker', (src.match(/VPA_OFFER_GRACE_LIVE/g) || []).length === 0);
  var W = { email: 'gm@pub.com', firstName: 'Sam', venueName: 'The Royal', seats: 10, offerCode: 'OFFER-NOV-2026' };
  var off = '', RAW = ''; vpaRenderProspectWelcome(ENV, W).then(function (x) { RAW += x; off = visible(x); }); drain();
  check('the welcome says the plan in numbers and the short no-card line, and never 5 days',
    /Your plan is set to 10 players ?, so that's \$25\.00 a month\. You can change it any time\./.test(off) && off.indexOf("There's no card on your account, so nothing can be charged. We'll remind you before your first month ends.") !== -1 && off.indexOf('5 days') === -1, off.slice(-900));
  var STD = Number((/const VPA_STANDARD_RATE = ([\d.]+)/.exec(src) || [])[1]);
  function withGrace(name, keep) { return new Function('VPA_STANDARD_RATE', 'VPA_PAUSED_KEEP_DAYS', 'return ' + liftFn(src, name).replace(/^function/, 'async function'))(STD, keep || 0); }
  var R = { kind: 'last', firstName: 'Sam', venueName: 'The Royal', endsWords: 'Wed 2 December', daysLeft: 2, offerRate: 2.5, cardUrl: 'https://venueplay.com.au/add-card?f=f1&t=x', cancelUrl: 'https://venueplay.com.au/prospect/cancel/?f=f1&t=x', email: 'gm@pub.com' };
  var roff = null, rstd = null;
  vpaRenderProspectReminder(ENV, R).then(function (x) { RAW += x.html; roff = visible(x.html); });
  vpaRenderProspectReminder(ENV, clone(R, { offerRate: 3 })).then(function (x) { RAW += x.html; rstd = visible(x.html); }); drain();
  check('the reminder: it pauses, the games switch off, the TV keeps its ads, and the offer price goes with the pause; never 5 days',
    roff.indexOf('Your account pauses: your games switch off and your TV keeps showing your ads. Nothing is lost, and adding a card switches it all back on.') !== -1 && roff.indexOf('That price ends with the pause') !== -1 && roff.indexOf('5 days') === -1, roff && roff.slice(0, 900));
  check('a venue not on an offer hears neither: it pauses, and a card switches it back on', rstd.indexOf('Your account pauses. Nothing is lost, and adding a card switches it all back on.') !== -1 && !/offer|5 days/.test(rstd.replace(/Unsubscribe[\s\S]*$/, '')), rstd && rstd.slice(0, 700));
  check('no raw IF tags or tokens are left in any of them (the html, comments included)', RAW.length > 5000 && !/IF:|ENDIF|\{\{/.test(RAW));

  /* 6. "We keep your paused account for N days" waits for Dean (round 5): VPA_PAUSED_KEEP_DAYS is 0, the line is out. */
  print('\n6. The paused-account days line is a placeholder, OFF until Dean decides');
  check('VPA_PAUSED_KEEP_DAYS is 0 in the Worker, and today\'s reminder has no "We keep your paused account" line',
    /const VPA_PAUSED_KEEP_DAYS = 0;/.test(src) && roff.indexOf('We keep your paused account') === -1 && RAW.indexOf('{{keep_days}}') === -1);
  var r30 = null; withGrace('vpaRenderProspectReminder', 30)(ENV, R).then(function (x) { r30 = visible(x.html); }); drain();
  check('given a number of days, the reminder says "We keep your paused account for 30 days."', !!r30 && r30.indexOf('We keep your paused account for 30 days.') !== -1, r30 && r30.slice(0, 800));

  /* 6b. THEIR FREE MONTH IN NUMBERS (Dean, 5 Nov 2026 round 7) on the one-week and last-day reminders. */
  print('\n6b. The reminders carry their real free-month numbers, or the first-night version, or nothing');
  function rem(kind, stats, days) { var out = null; vpaRenderProspectReminder(ENV, clone(R, { kind: kind, daysLeft: days || 8, stats: stats })).then(function (x) { out = visible(x.html); }); drain(); return out; }
  var ST = { ok: true, nights: 4, totalGames: 6, totalPlayers: 148, regulars: 21, biggest: { players: 47, at: '2026-11-27T09:30:00Z' } };
  var wk = rem('last', ST, 8);
  check('one week out, with numbers: "One week left", then "In your first month, The Royal ran:" over the tiles (6 games, 148 players), "Your biggest night had 47 players. Don\'t let that stop now." then the ask',
    wk.indexOf('One week left of your first month') !== -1 && wk.indexOf("ends on Wed 2 December. If you'd like to keep going, add your card before then and it won't be charged until your first month ends. In your first month, The Royal ran: 6 games 148 players Your biggest night had 47 players. Don't let that stop now. Would you like to keep it going? Add your card.") !== -1, wk.slice(0, 700));
  /* SUBSCRIBERS ARE COUNTED FROM THE SAME VIEW THE MONTHLY REPORT READS (v_vp_player_optins), run through vpaVenueStats. */
  var SEL0 = vpaSelect, SELA0 = vpaSelectAll, asked = [];
  vpaSelect = function (env, table) {
    if (table === 'vp_sessions') return Promise.resolve([{ id: 's1', started_at: '2026-11-20T09:00:00Z' }]);
    if (table === 'vp_games') return Promise.resolve([{ session_id: 's1', format: 'trivia' }]);
    if (table === 'vp_players') return Promise.resolve([{ session_id: 's1', device_id: 'd1' }, { session_id: 's1', device_id: 'd2' }]);
    return Promise.resolve([]); };
  vpaSelectAll = function (env, table, q) { asked.push(table + '?' + q); if (table === 'v_vp_player_optins') return Promise.resolve([{ venue_id: 'v1' }, { venue_id: 'v1' }]); return Promise.resolve([]); };
  var vs1 = null; vpaVenueStats(ENV, 'v1', 'Australia/Brisbane').then(function (x) { vs1 = x; }); drain();
  vpaSelectAll = function () { return Promise.reject(new Error('down')); };
  var vs2 = null; vpaVenueStats(ENV, 'v1', 'Australia/Brisbane').then(function (x) { vs2 = x; }); drain();
  vpaSelect = SEL0; vpaSelectAll = SELA0;
  check('subscribers: the venue\'s opt-ins from v_vp_player_optins (2 here), and null, never 0, when that cannot be read',
    vs1 && vs1.ok && vs1.subscribers === 2 && asked.some(function (a) { return a.indexOf('v_vp_player_optins?venue_id=eq.v1') === 0; }) && vs2 && vs2.subscribers === null, [vs1 && vs1.subscribers, vs2 && vs2.subscribers, asked]);
  var wkS = null; vpaRenderProspectReminder(ENV, clone(R, { kind: 'last', daysLeft: 8, stats: Object.assign({}, ST, { subscribers: 32 }) })).then(function (x) { wkS = x.html; }); drain();
  check('the numbers are email-safe tiles: solid pink cells (bgcolor and CSS), big white 24px numbers, 12px words, no images (but the logo of the shared foot); subscribers get a tile when there are some',
    (wkS.match(/<td width="33%" align="center" bgcolor="#FF1F8E" style="background:#FF1F8E;border-radius:12px;padding:14px 4px"><div style="font-size:24px;line-height:1\.1;font-weight:800;color:#ffffff">/g) || []).length === 3 &&
    visible(wkS).indexOf('ran: 6 games 148 players 32 subscribers') !== -1 && (wkS.replace(/<table role="presentation" data-vp-foot="block"[\s\S]*?<\/table>/g, '').match(/<img/g) || []).length === 1, visible(wkS).slice(0, 600));
  var wk0 = rem('last', { ok: true, nights: 0, totalGames: 0, totalPlayers: 0 }, 8);
  check('one week out with no games yet: "You haven\'t had your first night yet" and the sign-in button, no numbers',
    wk0.indexOf("You haven't had your first night yet, and there's still time.") !== -1 && /Open your venueplay/.test(wk0) && wk0.indexOf('In your first month') === -1, wk0.slice(0, 700));
  var wkX = rem('last', null, 8), wkY = rem('last', { ok: false }, 8);
  check('numbers that could not be read say nothing: no stats line and no first-night line', [wkX, wkY].every(function (t) { return t.indexOf('In your first month') === -1 && t.indexOf('first night') === -1; }));
  var fd = rem('final', ST, 1);
  check('the last day: "Today is the last day", "We\'d be sad to see you go.", their numbers, the pause tonight, what they keep for 90 days, Add my card',
    fd.indexOf("Today is the last day of your first month") !== -1 && fd.indexOf("We'd be sad to see you go. In your first month, The Royal ran: 6 games 148 players") !== -1 &&
    fd.indexOf("If there's no card by tonight Your account pauses tonight: your games switch off and your TV keeps showing your ads. Nothing is lost") !== -1 &&
    /Here's what you still have for the next 90 days: .*Your members list .*Your ad slides .*Your raffle and members draw history .*Your billing page, ready for your card .*Add my card/.test(fd), fd.slice(0, 1200));
  var e3 = rem('early', ST, 27);
  check('the day-3 note is as it was: no numbers, no last-day words', e3.indexOf("How's it going?") !== -1 && e3.indexOf('In your first month') === -1 && e3.indexOf('Today is the last day') === -1);
  check('the sweep reads the numbers only for the one-week and last-day emails', /stats: kind !== 'early' \? await vpaVenueStats\(env, v\.id/.test(src));

  /* 7. ONE BUTTON, ONE PLACE (Dean, 5 Nov 2026 round 5). Every button in every email a venue or staff gets is the same
     pink button (or the one quiet "Cancel, it's not for us"), centred in its own table. Rendered, not read. */
  print('\n7. Every button in every email is the same button, centred');
  var BTN = 'display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;line-height:1.2;padding:16px 34px;border-radius:10px';
  var QUIET = 'display:inline-block;background:#ffffff;color:#0A0A0B;text-decoration:none;font-size:17px;font-weight:700;line-height:1.2;padding:15px 33px;border-radius:10px;border:1px solid #d8d8e0';
  var WRAP = '<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:20px auto 0"><tr><td align="center"><a href="';
  var mails = {};
  function grab(name) { var m = sent[sent.length - 1]; mails[name] = m ? m.html : ''; sent = []; }
  sent = [];
  await vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'o@pub.com', plan: 'monthly', max_seats: 24 }, [{ name: 'The Royal', seats: 24 }], false); grab('welcome');
  await vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'o@pub.com', plan: 'monthly' }, [{ name: 'A', seats: 30 }, { name: 'B', seats: 50 }], true); grab('welcome-group');
  await vpaFireHqWelcome(ENV, { email: 'o@pub.com', venueName: 'The Royal', seats: 24, foundingId: 'f1' }); grab('welcome-hq');
  await vpbFireVenueOnboarding(ENV, { email: 'o@pub.com', venueName: 'The Crown', loginVenues: 2 }); grab('onboarding');
  var pw = ''; vpaRenderProspectWelcome(ENV, W).then(function (x) { pw = x; }); drain(); mails['welcome-prospect'] = pw;
  mails['prospect-reminder'] = RAW.slice(0, 0) || ''; vpaRenderProspectReminder(ENV, R).then(function (x) { mails['prospect-reminder'] = x.html; }); drain();
  await vpaFireUpcomingEmail(ENV, clone(INV, { amount_paid: 0 })); grab('upcoming');
  await vpaFireInvoiceEmail(ENV, INV); grab('receipt');
  await vpaFirePaymentFailedEmail(ENV, clone(INV, { billing_reason: 'subscription_cycle' }), undefined, { code: 'expired_card', message: '' }); grab('payment-failed');
  mails['help-reply'] = helpReplyHtml({ brand: 'venueplay', ticket_no: 1, category: 'venue_support', reply_token: 'abcdefghijkl' }, 'Hi,\n\nYes.', 'support@venueplay.com.au', 'Kayla', []);
  var bad = [], count = 0;
  Object.keys(mails).forEach(function (n) {
    var h = String(mails[n] || '');
    if (!h) { bad.push(n + ': not rendered'); return; }
    h.replace(/<a href="([^"]*)" style="([^"]*)">([^<]*)<\/a>/g, function (m, href, style, label, at) {
      if (!/border-radius/.test(style) || !/padding:/.test(style)) return m;   // a text link, not a button
      count++;
      if (style !== BTN && style !== QUIET) bad.push(n + ' "' + label + '": its own style');
      if (h.slice(Math.max(0, at - WRAP.length + 9), at) + '<a href="' !== WRAP) bad.push(n + ' "' + label + '": not centred in the button table');
      return m;
    });
  });
  check('every button in the welcome, group, HQ, onboarding, prospect welcome, reminder, upcoming payment, receipt, declined card and help reply is the one pink (or quiet) button, centred in its own table',
    bad.length === 0 && count >= 11, [count, bad]);
  check('the reminder\'s only quiet button is "Cancel, it\'s not for us", and nothing else is quiet',
    (mails['prospect-reminder'].match(/background:#ffffff;color:#0A0A0B[^"]*">Cancel, it's not for us</g) || []).length === 1 &&
    Object.keys(mails).every(function (n) { return (String(mails[n]).match(/background:#ffffff;color:#0A0A0B;text-decoration:none;font-size:17px/g) || []).length === (n === 'prospect-reminder' ? 1 : 0); }));
  check('the Worker has one button maker, and no hand-made pink button is left in it', /function vpaEmailButton\(href, label, quiet\)/.test(src) &&
    (src.match(/style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:1\dpx;font-weight:700;padding/g) || []).length === 0);

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (fails) throw new Error(fails + ' failed');
}
main().catch(function (e) { print('ERROR ' + e + '\n' + (e && e.stack)); throw e; });
drain();
