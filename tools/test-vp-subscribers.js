/* THE MONTHLY EMAIL SIGN-UP, RUN AND NOT WORD-SEARCHED (31 Oct 2026; migration 134).

   For the venue that is "too scared to call us": one email a month from a small form on the sales
   pages. Runs the REAL billing Worker (tools/rig-billing-worker.js: only the network, Resend and the
   database are fakes) through its REAL router:
     1. POST /subscribe keeps one row: the address lower-cased, the venue, the page, the utm tags, the
        consent words and version, when, and the state from Cloudflare, never an address
     2. the same address again (any case) is the same answer, one row, no second email
     3. a bad address or an over-long venue is refused with nothing kept
     4. the honeypot: told it worked, nothing kept, nothing sent
     5. the limits: per network and per address
     6. an address on vp_unsubscribes that signs up again is BACK ON (Dean, 31 Oct 2026): fresh consent,
        resubscribed_at, its opt-out row kept as the record and still read by every other check; a later
        unsubscribe wins again, from either record, a tie is a stop; an unreadable list keeps nothing
     7. THE OFF SWITCH: nothing is sent unless SUBSCRIBE_EMAILS is exactly 'on'; on, one email from
        hello@, a real signed one-click List-Unsubscribe on api.venueplay.com.au, the unsubscribe link
        on venueplay.com.au, no .dev anywhere, no Gflam, no em dash, the venue's name escaped
     8. before migration 134: the form is told "not ready" and nothing is kept or sent; HQ says run it
     9. Turnstile, when its secret is set
    10. HQ > Subscribers: owner or accounts only; each row's state; counts by week and by page; the
        venue or prospect each one matches (by email, by domain but never a free mailbox, by whole name)
    11. the CSV: audited, a formula in a typed venue name cannot run in a spreadsheet, and nothing is
        exported when the unsubscribe list cannot be read
    12. the list the monthly email reads: active only, never anyone on vp_unsubscribes, never a live
        venue's contact (their report carries the news), paged past 1,000, and it THROWS rather than
        hand back a list it could not check
    13. nothing anywhere calls Instantly, opens a sales ticket or emails HQ: a subscriber is not a cold lead
    14. migration 134 has a column for every field the Worker writes

   Run from the repo root:  jsc tools/test-vp-subscribers.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }

URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {}; var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };

load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
/* A REAL HMAC for the unsubscribe token (the same stand-in the billing page rig uses), so
   the token in the List-Unsubscribe header can be checked against the one the route will accept. */
load('partyplay-backend/worker/_test-sha256.js');
if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
var __rnd = 11;
crypto = { subtle: {
  digest: function (alg, b) { var s = b && b._s !== undefined ? b._s : String(b); var h = SHA.sha256 ? SHA.sha256(s) : null;
    if (h) return Promise.resolve(new Uint8Array(h).buffer);
    var out = new Uint8Array(32), x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; out[i % 32] ^= x & 255; } return Promise.resolve(out.buffer); },
  importKey: function (fmt, k) { return Promise.resolve({ _k: k._s }); },
  sign: function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; } };
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; this.abort = function () {}; }; }

/* EVERY ADDRESS THE WORKER ASKED FOR, all suite long, so section 13 can say what was never called. */
var ASKED = [], MISSING = {}, TURNSTILE_SAYS = null;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url); ASKED.push(u);
  var t = /\/rest\/v1\/([a-z_]+)/.exec(u);
  if (t && MISSING[t[1]]) return RS(404, { code: 'PGRST205', message: "Could not find the table 'public." + t[1] + "' in the schema cache" });
  if (/challenges\.cloudflare\.com\/turnstile/.test(u)) { var tb = JSON.parse(opts.body); return RS(200, { success: TURNSTILE_SAYS === tb.response }); }
  return rigFetch(url, opts);
};
function U(n) { return '54000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(9), ACCTS = U(8), STAFF = U(7), OWNER = U(6);
function world() {
  DB = {}; sent.length = 0; FAIL = {}; MISSING = {}; TURNSTILE_SAYS = null;
  delete ENV.SUBSCRIBE_EMAILS; delete ENV.TURNSTILE_SECRET;
  ENV.VP_UNSUB_SECRET = 'subscribers-suite-secret';
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFF, label: 'Helper', role: 'staff' }];
  DB.vp_subscribers = []; DB.vp_unsubscribes = []; DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_prospects = []; DB.vp_admin_audit = []; DB.vp_help_tickets = [];
}
var IPN = 0;
function freshIp() { IPN++; return '203.0.113.' + IPN; }
function req(path, body, headers, cf) {
  var h = {}; Object.keys(headers || {}).forEach(function (k) { h[k.toLowerCase()] = headers[k]; });
  var txt = body === undefined ? '' : JSON.stringify(body);
  return { method: 'POST', url: 'https://api.venueplay.com.au' + path, cf: cf || undefined,
    headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
async function call(path, body, headers, cf) {
  var res = await _d.fetch(req(path, body, headers, cf), ENV);
  var parsed = null; try { parsed = res.body ? JSON.parse(res.body) : null; } catch (e) { parsed = res.body; }
  return { status: res.status, body: parsed || {} };
}
function sub(body, ip, cf) { return call('/subscribe', body, { 'cf-connecting-ip': ip || freshIp() }, cf); }
var AS = function (who) { return { Authorization: 'Bearer ' + who }; };
function rows() { return DB.vp_subscribers || []; }
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
/* The Worker's constants, read from the shipped file (a const in the Worker is not a global here). */
function K(name) { var m = new RegExp('^const ' + name + ' = ([^;]+);', 'm').exec(SRC); if (!m) throw new Error('cannot find ' + name + ' in the Worker'); return (0, eval)('(' + m[1] + ')'); }
var VPS_CONSENT_TEXT = K('VPS_CONSENT_TEXT'), VPS_CONSENT_VERSION = K('VPS_CONSENT_VERSION'), VPS_MAX_PER_IP = K('VPS_MAX_PER_IP'), VPS_MAX_PER_EMAIL = K('VPS_MAX_PER_EMAIL');

(async function () {
  section('1. A SIGN-UP KEEPS ONE ROW, WITH THE WORDS THEY AGREED TO');
  world();
  var r = await sub({ email: '  Kim@KirraBeachHotel.com.au ', venue: ' Kirra Beach Hotel ', source: 'home',
    utm: { utm_source: 'instantly', utm_campaign: 'nov-offer', gclid: 'nope', utm_term: '' }, website: '' }, '198.51.100.7',
    { country: 'AU', regionCode: 'QLD', region: 'Queensland' });
  check('POST /subscribe answers 200 {ok:true} and nothing else', r.status === 200 && JSON.stringify(r.body) === '{"ok":true}', r);
  var k = rows()[0] || {};
  check('one row, the address trimmed and lower-cased', rows().length === 1 && k.email === 'kim@kirrabeachhotel.com.au', rows());
  check('the venue as typed (trimmed), the page it came from', k.venue_name === 'Kirra Beach Hotel' && k.source === 'home', k);
  check('only the utm tags are kept, and only the ones with a value', JSON.stringify(k.utm) === '{"utm_source":"instantly","utm_campaign":"nov-offer"}', k.utm);
  check('the consent words kept are the Worker\'s own, with their version and the time', k.consent_text === VPS_CONSENT_TEXT
    && k.consent_version === VPS_CONSENT_VERSION && isFinite(Date.parse(k.consent_at)) && /Unsubscribe any time/.test(k.consent_text), k);
  check('Cloudflare\'s country and Australian state are kept, the network address is not', k.country === 'AU' && k.region === 'QLD'
    && JSON.stringify(k).indexOf('198.51.100.7') < 0, k);
  check('it is on the list (active), and with the switch off nothing is sent', k.status === 'active' && !k.held_reason && sent.length === 0 && !k.confirm_sent_at, [k.status, sent.length]);
  await sub({ email: 'other@thecommercial.com.au', source: 'somewhere-else' });
  check('a page the Worker does not know is kept as "site"; no venue is fine', (rows()[1] || {}).source === 'site' && (rows()[1] || {}).venue_name === null, rows()[1]);
  await sub({ email: 'outback@pub.com.au' }, null, { country: 'NZ', regionCode: 'AUK' });
  check('outside Australia only the country is kept', (rows()[2] || {}).country === 'NZ' && (rows()[2] || {}).region === null, rows()[2]);

  section('2. THE SAME ADDRESS AGAIN: SAME ANSWER, ONE ROW, NO SECOND EMAIL');
  world(); ENV.SUBSCRIBE_EMAILS = 'on';
  var a1 = await sub({ email: 'pat@royalhotel.com.au', source: 'offer' });
  var a2 = await sub({ email: 'PAT@RoyalHotel.com.au', venue: 'The Royal Hotel', source: 'home' });
  var a3 = await sub({ email: 'pat@royalhotel.com.au ', venue: 'Somewhere Else' });
  check('three tries, three identical answers', JSON.stringify(a1) === JSON.stringify(a2) && JSON.stringify(a2) === JSON.stringify(a3) && a1.status === 200, [a1, a2, a3]);
  check('still one row, still the first page it came from', rows().length === 1 && rows()[0].source === 'offer', rows());
  check('a venue left off the first time is kept the second time, and never overwritten after', rows()[0].venue_name === 'The Royal Hotel', rows()[0]);
  check('one confirmation email, not three', sent.length === 1, sent.length);

  section('3. A BAD ADDRESS OR AN OVER-LONG VENUE IS REFUSED, NOTHING KEPT');
  world();
  var bads = ['', 'kim@', 'no-at-sign.com.au', 'a@b', 'two@@at.com.au', 'kim@pub.com.au,evil@x.com', 'x'.repeat(250) + '@pub.com.au'];
  var refused = [];
  for (var i = 0; i < bads.length; i++) { var rb = await sub({ email: bads[i] }); refused.push(rb.status === 400 && !!rb.body.error); }
  check('each of ' + bads.length + ' bad addresses is a 400 with a plain reason', refused.every(Boolean), refused);
  var lv = await sub({ email: 'ok@pub.com.au', venue: 'V'.repeat(121) });
  check('a venue name over 120 characters is refused', lv.status === 400 && /too long/.test(lv.body.error || ''), lv);
  check('nothing was kept from any of them', rows().length === 0, rows());

  section('4. THE HONEYPOT: TOLD IT WORKED, NOTHING KEPT, NOTHING SENT');
  world(); ENV.SUBSCRIBE_EMAILS = 'on';
  var hp = await sub({ email: 'bot@spam.example', website: 'http://spam.example' });
  check('a filled website field answers {ok:true}', hp.status === 200 && hp.body.ok === true, hp);
  check('and keeps no row and sends no email', rows().length === 0 && sent.length === 0, [rows().length, sent.length]);

  section('5. THE LIMITS: PER NETWORK AND PER ADDRESS');
  world();
  var ip = freshIp(), st = [];
  for (var n = 0; n < VPS_MAX_PER_IP + 1; n++) st.push((await sub({ email: 'n' + n + '@limits.com.au' }, ip)).status);
  check('the network gets ' + VPS_MAX_PER_IP + ' sign-ups an hour, and the next is a 429', st.slice(0, VPS_MAX_PER_IP).every(function (s) { return s === 200; }) && st[VPS_MAX_PER_IP] === 429, st);
  check('the refused one kept nothing', rows().length === VPS_MAX_PER_IP, rows().length);
  check('another network is not held up by it', (await sub({ email: 'elsewhere@limits.com.au' })).status === 200);
  var es = [];
  for (var m = 0; m < VPS_MAX_PER_EMAIL + 1; m++) es.push((await sub({ email: 'same@target.com.au' })).status);
  check('one address can be tried ' + VPS_MAX_PER_EMAIL + ' times an hour from anywhere, then 429 (the form cannot flood an inbox)',
    es.slice(0, VPS_MAX_PER_EMAIL).every(function (s) { return s === 200; }) && es[VPS_MAX_PER_EMAIL] === 429, es);

  section('6. SOMEONE WHO UNSUBSCRIBED AND SIGNS UP AGAIN IS BACK ON, AND A LATER UNSUBSCRIBE WINS AGAIN');
  world(); ENV.SUBSCRIBE_EMAILS = 'on';
  DB.vp_unsubscribes = [{ id: 'u1', email: 'Stop@PubOnTheCorner.com.au', source: 'link', created_at: '2026-10-01T00:00:00Z' },
                        { id: 'u2', email: 'a_b@corner.com.au', source: 'manual', created_at: '2026-09-01T00:00:00Z' }];
  var u1Before = JSON.stringify(DB.vp_unsubscribes[0]);
  var fresh = await sub({ email: 'fresh@pubonthecorner.com.au' });
  var back = await sub({ email: 'stop@pubonthecorner.com.au', venue: 'Pub on the Corner' });
  check('an address on vp_unsubscribes (stored in another case) gets exactly the answer a new sign-up gets',
    JSON.stringify(back) === JSON.stringify(fresh) && back.status === 200, [back, fresh]);
  var h = rows().filter(function (x) { return x.email === 'stop@pubonthecorner.com.au'; })[0] || {};
  check('it is ACTIVE with fresh consent: a new consent_at after the unsubscribe, and a resubscribed_at', h.status === 'active' && !h.held_reason
    && Date.parse(h.consent_at) > Date.parse('2026-10-01T00:00:00Z') && h.resubscribed_at === h.consent_at && h.consent_text === VPS_CONSENT_TEXT, h);
  check('a first-time sign-up has no resubscribed_at', (rows().filter(function (x) { return x.email === 'fresh@pubonthecorner.com.au'; })[0] || {}).resubscribed_at === null);
  check('their vp_unsubscribes row is kept exactly as it was, as the record', DB.vp_unsubscribes.length === 2 && JSON.stringify(DB.vp_unsubscribes[0]) === u1Before, DB.vp_unsubscribes);
  check('with the switch on they get the one welcome, like anyone new', sent.length === 2 && sent[1].to[0] === 'stop@pubonthecorner.com.au', sent.map(function (x) { return x.to; }));
  var mlist = (await vpsMonthlyRecipients(ENV)).map(function (x) { return x.email; });
  check('they are on the monthly list', mlist.indexOf('stop@pubonthecorner.com.au') >= 0 && mlist.indexOf('fresh@pubonthecorner.com.au') >= 0, mlist);
  check('every other check still leaves them out: vp_unsubscribes still names them for the win-back, the venue export and cold outreach',
    (await vpaUnsubscribedSet(ENV))['stop@pubonthecorner.com.au'] === true);
  check('and the report sender is told they are back on for the monthly email (vpsBackOn)', (await vpsBackOn(ENV))['stop@pubonthecorner.com.au'] === true && !(await vpsBackOn(ENV))['fresh@pubonthecorner.com.au']);
  // A LATER UNSUBSCRIBE WINS AGAIN. Through the Worker's own one-click route, then dated so the order is plain.
  var tokS = await vpUnsubToken(ENV, 'stop@pubonthecorner.com.au');
  var uq = await _d.fetch({ method: 'POST', url: 'https://api.venueplay.com.au/unsubscribe?e=stop%40pubonthecorner.com.au&t=' + tokS + '&c=monthly-news',
    headers: { get: function () { return null; } }, text: function () { return Promise.resolve('List-Unsubscribe=One-Click'); } }, ENV);
  var t0 = Date.now();
  h.consent_at = h.resubscribed_at = new Date(t0 - 120000).toISOString();
  DB.vp_unsubscribes.filter(function (x) { return x.email === 'stop@pubonthecorner.com.au'; }).forEach(function (x) { x.created_at = new Date(t0 - 60000).toISOString(); });
  mlist = (await vpsMonthlyRecipients(ENV)).map(function (x) { return x.email; });
  check('they unsubscribe again (one-click, 200): off the monthly list straight away', uq.status === 200 && mlist.indexOf('stop@pubonthecorner.com.au') < 0, [uq.status, mlist]);
  check('and vpsBackOn no longer names them', !(await vpsBackOn(ENV))['stop@pubonthecorner.com.au']);
  sent.length = 0;
  await sub({ email: 'stop@pubonthecorner.com.au' });
  h = rows().filter(function (x) { return x.email === 'stop@pubonthecorner.com.au'; })[0] || {};
  mlist = (await vpsMonthlyRecipients(ENV)).map(function (x) { return x.email; });
  check('and a third time signing up brings them back again, consent now later than the latest stop, still one row',
    rows().filter(function (x) { return x.email === 'stop@pubonthecorner.com.au'; }).length === 1 && Date.parse(h.consent_at) >= t0 && mlist.indexOf('stop@pubonthecorner.com.au') >= 0 && sent.length === 1, [h, mlist]);
  // The latest stop is whichever record says later: the first row's last_unsubscribed_at, or the subscriber row's own unsubscribed_at.
  var later = new Date(Date.parse(h.consent_at) + 1000).toISOString();
  DB.vp_unsubscribes.forEach(function (x) { if (x.email === 'Stop@PubOnTheCorner.com.au') x.last_unsubscribed_at = later; });
  check('a repeat opt-out noted on the first row (last_unsubscribed_at, the trigger) after their consent: off again', (await vpsMonthlyRecipients(ENV)).every(function (x) { return x.email !== 'stop@pubonthecorner.com.au'; }));
  DB.vp_unsubscribes.forEach(function (x) { delete x.last_unsubscribed_at; });
  var fr = rows().filter(function (x) { return x.email === 'fresh@pubonthecorner.com.au'; })[0];
  fr.unsubscribed_at = new Date(Date.parse(fr.consent_at) + 1000).toISOString();
  check('the subscriber row\'s own unsubscribed_at after its consent: off as well, with nothing on vp_unsubscribes', (await vpsMonthlyRecipients(ENV)).every(function (x) { return x.email !== 'fresh@pubonthecorner.com.au'; }));
  fr.unsubscribed_at = fr.consent_at;
  check('a tie between consent and unsubscribe is a stop', (await vpsMonthlyRecipients(ENV)).every(function (x) { return x.email !== 'fresh@pubonthecorner.com.au'; }));
  DB.vp_unsubscribes.push({ id: 'u3', email: 'axb@corner.com.au', source: 'manual', created_at: '2026-09-01T00:00:00Z' });
  await sub({ email: 'A_B@corner.com.au' });
  await sub({ email: 'a.b@corner.com.au' });
  var ab = rows().filter(function (x) { return x.email === 'a_b@corner.com.au'; })[0] || {}, adot = rows().filter(function (x) { return x.email === 'a.b@corner.com.au'; })[0] || {};
  check('the match is the whole address, any case: a_b@ on the list comes back as re-subscribed; the _ is never a wildcard (axb@ on the list says nothing about a.b@)',
    !!ab.resubscribed_at && adot.status === 'active' && adot.resubscribed_at === null, [ab.resubscribed_at, adot.resubscribed_at]);
  sent.length = 0; FAIL['vp_unsubscribes:GET'] = 1;
  var down = await sub({ email: 'unsure@pub.com.au' });
  check('an unsubscribe list that cannot be read: 503, try again', down.status === 503 && /try again/i.test(down.body.error || ''), down);
  check('and nothing is kept or sent', !rows().some(function (x) { return x.email === 'unsure@pub.com.au'; }) && sent.length === 0);

  section('7. THE OFF SWITCH, AND THE ONE EMAIL WHEN IT IS ON');
  var tried = [['unset', undefined], ['ON', 'ON'], ['yes', 'yes'], ['1', '1'], ['off', 'off']];
  for (var t = 0; t < tried.length; t++) {
    world(); if (tried[t][1] !== undefined) ENV.SUBSCRIBE_EMAILS = tried[t][1];
    await sub({ email: 'switch' + t + '@pub.com.au' });
    check('SUBSCRIBE_EMAILS ' + tried[t][0] + ': the sign-up is kept and NOTHING is sent', rows().length === 1 && sent.length === 0, sent.length);
  }
  world(); ENV.SUBSCRIBE_EMAILS = ' on ';
  await sub({ email: 'Jo@TheBowlo.com.au', venue: '<b>Jo\'s</b> & Bowlo' });
  var e = sent[0] || {}, all = JSON.stringify(e);
  check('on: exactly one email, to the address that signed up', sent.length === 1 && JSON.stringify(e.to) === '["jo@thebowlo.com.au"]', sent.map(function (s) { return s.to; }));
  check('from hello@ on our own sending domain, replies to hello@venueplay.com.au', e.from === 'venueplay <hello@send.venueplay.com.au>' && e.reply_to === 'hello@venueplay.com.au', [e.from, e.reply_to]);
  var lu = (e.headers || {})['List-Unsubscribe'] || '';
  var tok = await vpUnsubToken(ENV, 'jo@thebowlo.com.au');
  check('List-Unsubscribe is a SIGNED one-click on api.venueplay.com.au, plus the mailto', lu.indexOf('<https://api.venueplay.com.au/unsubscribe?e=jo%40thebowlo.com.au&t=' + tok + '&c=subscriber>') === 0
    && /<mailto:hello@venueplay\.com\.au\?subject=unsubscribe>/.test(lu) && /^[0-9a-f]{32}$/.test(tok), lu);
  check('List-Unsubscribe-Post says One-Click, so the mail app shows its own button', (e.headers || {})['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', e.headers);
  var unsubPost = await (async function () { var res = await _d.fetch({ method: 'POST', url: 'https://api.venueplay.com.au/unsubscribe?e=jo%40thebowlo.com.au&t=' + tok + '&c=subscriber',
    headers: { get: function () { return null; } }, text: function () { return Promise.resolve('List-Unsubscribe=One-Click'); } }, ENV); return res; })();
  check('and pressing it really records the opt-out (the route accepts that token)', unsubPost.status === 200 && DB.vp_unsubscribes.some(function (x) { return x.email === 'jo@thebowlo.com.au'; }), unsubPost.status);
  check('the body links unsubscribe on venueplay.com.au and says why they got it', /href="https:\/\/www\.venueplay\.com\.au\/unsubscribe\?e=jo%40thebowlo\.com\.au"/.test(e.html || '')
    && /signed up for the venueplay monthly email/.test(e.html || ''), (e.html || '').slice(-700));
  check('no .dev address anywhere: subject, html, text or headers', !/\.dev\b/i.test(all) && !/workers\.dev/i.test(all));
  check('"VenuePlay, ABN 35 679 383 049", never Gflam', /VenuePlay, ABN 35 679 383 049/.test(e.html || '') && !/gflam/i.test(all));
  check('no em dash, no "call you", and it says nobody will ring them', !/\u2014|&mdash;/.test(all) && !/call you/i.test(all) && /nobody will ring you/i.test(e.html || ''));
  check('the venue name they typed is escaped, never markup', /for &lt;b&gt;Jo&#39;s&lt;\/b&gt; &amp; Bowlo/.test(e.html || '') && (e.html || '').indexOf('<b>Jo') < 0, (e.html || '').slice(0, 900));
  check('it has a plain-text part and a subject under 45 characters', !!e.text && e.text.length > 100 && (e.subject || '').length <= 45 && !!e.subject, [e.subject, (e.text || '').length]);
  check('the row says when the email went', !!(rows()[0] || {}).confirm_sent_at);
  check('it names next month (Brisbane), the one the first email lands in', /lands early (January|February|March|April|May|June|July|August|September|October|November|December)\./.test(e.html || '')
    && vpsNextMonthName(Date.parse('2026-10-31T13:59:00Z')) === 'November' && vpsNextMonthName(Date.parse('2026-10-31T14:00:00Z')) === 'December'
    && vpsNextMonthName(Date.parse('2026-12-15T00:00:00Z')) === 'January');
  world(); ENV.SUBSCRIBE_EMAILS = 'on'; delete ENV.VP_UNSUB_SECRET;
  await sub({ email: 'nosecret@pub.com.au' });
  check('on, but no VP_UNSUB_SECRET to sign the unsubscribe with: kept, and nothing sent', rows().length === 1 && sent.length === 0, sent.length);

  section('8. BEFORE MIGRATION 134 IS RUN');
  world(); ENV.SUBSCRIBE_EMAILS = 'on'; MISSING.vp_subscribers = true;
  var nr = await sub({ email: 'early@pub.com.au' });
  check('the form is told "not ready" (503), with hello@ to email instead', nr.status === 503 && nr.body.not_ready === true && /hello@venueplay\.com\.au/.test(nr.body.error || ''), nr);
  check('and nothing is sent', sent.length === 0);
  var hn = await call('/admin/subscribers', {}, AS(ADMIN));
  check('HQ is told to run migration 134', hn.status === 503 && hn.body.need_migration === 134 && /migration 134/.test(hn.body.error || ''), hn);
  var xn = await call('/admin/subscribers/export', {}, AS(ADMIN));
  check('and the export makes no file', xn.status === 503 && !xn.body.csv, xn);

  section('9. TURNSTILE, WHEN ITS SECRET IS SET');
  world(); ENV.TURNSTILE_SECRET = 'ts-secret'; TURNSTILE_SAYS = 'good-token';
  var tn = await sub({ email: 'ts1@pub.com.au' });
  var tb = await sub({ email: 'ts2@pub.com.au', turnstile: 'forged' });
  var tg = await sub({ email: 'ts3@pub.com.au', turnstile: 'good-token' });
  check('no token or a token Cloudflare rejects: 403, nothing kept', tn.status === 403 && tb.status === 403 && tn.body.turnstile === true, [tn, tb]);
  check('a token Cloudflare accepts: kept', tg.status === 200 && rows().length === 1 && rows()[0].email === 'ts3@pub.com.au', rows());

  section('10. HQ > SUBSCRIBERS');
  world();
  var V1 = U(101), V2 = U(102), V3 = U(103), V4 = U(104), V5 = U(105);
  DB.vp_venues = [{ id: V1, name: 'Deepwater Hotel', founding_id: 'f1', status: 'active' }, { id: V2, name: 'The Royal Arms', founding_id: 'f2', status: 'active' },
                  { id: V3, name: 'Kirra Prospect Tavern', founding_id: 'f3', status: 'active' }, { id: V4, name: 'Twin Pines', founding_id: 'f4', status: 'active' },
                  { id: V5, name: 'Twin Pines', founding_id: 'f5', status: 'active' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'Olive@DeepwaterHotel.com.au' }, { id: 'f2', contact_email: 'royal.arms@gmail.com' },
                           { id: 'f3', contact_email: 'boss@kirraprospect.com.au' }, { id: 'f4', contact_email: 'a@twinpines1.com.au' }, { id: 'f5', contact_email: 'b@twinpines2.com.au' }];
  DB.vp_prospects = [{ venue_id: V3, email: 'boss@kirraprospect.com.au' }];
  var now = Date.now(), WK = 7 * 86400000;
  function seedSub(id, email, extra) { var r = Object.assign({ id: id, email: email, venue_name: null, source: 'home', utm: {}, status: 'active', created_at: new Date(now - 3600000).toISOString() }, extra || {});
    if (!r.consent_at) r.consent_at = r.created_at; DB.vp_subscribers.push(r); }
  seedSub('s1', 'olive@deepwaterhotel.com.au');                                              // exact contact email
  seedSub('s2', 'bar.manager@kirraprospect.com.au', { source: 'offer' });                    // a prospect's domain
  seedSub('s3', 'someone@gmail.com', { venue_name: '  the ROYAL arms ', source: 'see-a-night' }); // free mailbox, the venue by its whole name
  seedSub('s4', 'royal.fan@gmail.com');                                                       // gmail, like f2's contact: never by domain
  seedSub('s5', 'held@pub.com.au', { status: 'held', held_reason: 'by hand', created_at: new Date(now - WK - 3600000).toISOString() });
  seedSub('s6', 'later.stop@pub.com.au', { created_at: new Date(now - 2 * WK - 3600000).toISOString() });
  seedSub('s7', 'twins@hotmail.com', { venue_name: 'Twin Pines' });                           // two venues share the name: no guess
  seedSub('s9', 'came.back@pub.com.au', { resubscribed_at: new Date(now - 3600000).toISOString() });   // unsubscribed in September, signed up again
  DB.vp_unsubscribes = [{ email: 'Later.Stop@Pub.com.au', created_at: new Date(now - 3600000).toISOString() }, { email: 'came.back@pub.com.au', created_at: '2026-09-01T00:00:00Z' }];
  var nob = await call('/admin/subscribers', {});
  var stf = await call('/admin/subscribers', {}, AS(STAFF));
  var own = await call('/admin/subscribers', {}, AS(OWNER));
  check('no sign-in 401; an HQ staff role 403; a venue owner who is not HQ 403', nob.status === 401 && stf.status === 403 && own.status === 403, [nob.status, stf.status, own.status]);
  var L = await call('/admin/subscribers', {}, AS(ADMIN));
  var A = await call('/admin/subscribers', {}, AS(ACCTS));
  check('the owner and accounts roles get the list', L.status === 200 && L.body.ok && A.status === 200 && (L.body.subscribers || []).length === 8, [L.status, A.status]);
  var by = {}; (L.body.subscribers || []).forEach(function (x) { by[x.id] = x; });
  check('states: on the list, held by hand, unsubscribed since (vp_unsubscribes, any case, later than their consent)',
    by.s1.state === 'active' && by.s5.state === 'held' && by.s5.held_reason === 'by hand' && by.s6.state === 'unsubscribed', [by.s1.state, by.s5.state, by.s6.state]);
  check('back after an unsubscribe: "resubscribed", with both dates for HQ to show', by.s9.state === 'resubscribed' && by.s9.unsubscribed_at === '2026-09-01T00:00:00.000Z' && by.s9.resubscribed_at === by.s9.consent_at, by.s9);
  check('counts: 6 on the list (1 of them re-subscribed), 1 held, 1 unsubscribed', L.body.counts.active === 6 && L.body.counts.resubscribed === 1 && L.body.counts.held === 1 && L.body.counts.unsubscribed === 1, L.body.counts);
  check('the exact email of an account\'s contact matches its venue, by email', by.s1.match && by.s1.match.venue_id === V1 && by.s1.match.by === 'email' && by.s1.match.kind === 'venue', by.s1.match);
  check('an address at a prospect\'s own domain matches that prospect, by domain', by.s2.match && by.s2.match.venue_id === V3 && by.s2.match.by === 'domain' && by.s2.match.kind === 'prospect', by.s2.match);
  check('a gmail address with a venue typed in any case matches that venue by its whole name', by.s3.match && by.s3.match.venue_id === V2 && by.s3.match.by === 'name', by.s3.match);
  check('a free mailbox never matches by domain (gmail like another venue\'s contact)', by.s4.match === null, by.s4.match);
  check('two venues with the typed name: no guess', by.s7.match === null, by.s7.match);
  check('matched count is 3', L.body.counts.matched === 3, L.body.counts.matched);
  var wk = L.body.by_week || [];
  check('twelve weeks, newest first, each starting on a Monday', wk.length === 12 && wk.every(function (w) { return new Date(w.week + 'T00:00:00Z').getUTCDay() === 1; }) && wk[0].week > wk[1].week, wk.slice(0, 3));
  check('this week by page: 6 sign-ups, 4 home, 1 offer, 1 See a night', wk[0].n === 6 && wk[0].by_source.home === 4 && wk[0].by_source.offer === 1 && wk[0].by_source['see-a-night'] === 1, wk[0]);
  check('last week 1, the week before 1, and the by-page totals add up', wk[1].n === 1 && wk[2].n === 1 && L.body.counts.by_source.home === 6, [wk[1], wk[2], L.body.counts.by_source]);
  check('it says whether the welcome email is on (it is off here)', L.body.emails_on === false);
  check('newest first', (L.body.subscribers || [])[(L.body.subscribers || []).length - 1].id === 's6', (L.body.subscribers || []).map(function (x) { return x.id; }));
  FAIL['vp_unsubscribes:GET'] = 1;
  var Ld = await call('/admin/subscribers', {}, AS(ADMIN));
  check('an unsubscribe list that cannot be read: HQ is told, never shown everyone as "on the list"', Ld.status === 503 && !Ld.body.subscribers, Ld);
  check('vpsMatch is the one place a match is made (pure: the same subscriber, the same answer)',
    JSON.stringify(vpsMatch({ email: 'olive@deepwaterhotel.com.au' }, DB.vp_venues, DB.venueplay_founding, DB.vp_prospects)) === JSON.stringify(by.s1.match));

  section('11. THE CSV');
  DB.vp_subscribers.push({ id: 's8', email: 'formula@pub.com.au', venue_name: '=HYPERLINK("http://x","click")', source: 'home', utm: { utm_source: 'fb' }, status: 'active', created_at: new Date(now).toISOString(), consent_at: new Date(now).toISOString() });
  var ex0 = await call('/admin/subscribers/export', {}, AS(STAFF));
  check('HQ staff role: 403 and no file', ex0.status === 403 && !ex0.body.csv, ex0.status);
  var X = await call('/admin/subscribers/export', {}, AS(ACCTS));
  var lines = String(X.body.csv || '').trim().split('\n');
  check('the accounts role gets every row plus a header', X.status === 200 && X.body.count === 9 && lines.length === 10 && /^Email,Venue \(as typed\),State,Signed up,Consent given,Last unsubscribed,Re-subscribed,Source/.test(lines[0]), lines[0]);
  check('each row says its state and its match', lines.some(function (l) { return /^olive@deepwaterhotel\.com\.au,,active,.*,Deepwater Hotel,venue,email$/.test(l); })
    && lines.some(function (l) { return /^held@pub\.com\.au,,held \(by hand\),/.test(l); })
    && lines.some(function (l) { return /^came\.back@pub\.com\.au,,resubscribed,[^,]+,([^,]+),2026-09-01T00:00:00\.000Z,\1,/.test(l); }), lines.slice(0, 4));
  check('a formula in a typed venue name is defused for the spreadsheet', lines.some(function (l) { return l.indexOf('"\'=HYPERLINK(""http://x"",""click"")"') >= 0; }), lines.filter(function (l) { return /formula/.test(l); }));
  check('the export is audited, with no addresses in the audit', DB.vp_admin_audit.some(function (a) { return a.action === 'subscribers_exported' && a.detail && a.detail.rows === 9; })
    && JSON.stringify(DB.vp_admin_audit).indexOf('@') < 0, DB.vp_admin_audit);
  FAIL['vp_unsubscribes:GET'] = 1;
  var Xd = await call('/admin/subscribers/export', {}, AS(ADMIN));
  check('an unsubscribe list that cannot be read: nothing is exported', Xd.status === 503 && !Xd.body.csv, Xd);

  section('12. THE LIST THE MONTHLY EMAIL READS');
  world();
  DB.vp_venues = [{ id: V1, name: 'Deepwater Hotel', founding_id: 'f1', status: 'active' }, { id: V2, name: 'Closed Pub', founding_id: 'f2', status: 'cancelled' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: ' Olive@DeepwaterHotel.com.au' }, { id: 'f2', contact_email: 'left@closedpub.com.au' }];
  DB.vp_subscribers = [
    { id: 'm1', email: 'keen@pub.com.au', venue_name: 'Keen Pub', status: 'active', consent_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
    { id: 'm2', email: 'held@pub.com.au', status: 'held', held_reason: 'by hand', consent_at: '2026-10-02T00:00:00Z', created_at: '2026-10-02T00:00:00Z' },
    { id: 'm3', email: 'stopped@pub.com.au', status: 'active', consent_at: '2026-10-03T00:00:00Z', created_at: '2026-10-03T00:00:00Z' },
    { id: 'm4', email: 'olive@deepwaterhotel.com.au', status: 'active', consent_at: '2026-10-04T00:00:00Z', created_at: '2026-10-04T00:00:00Z' },
    { id: 'm5', email: 'left@closedpub.com.au', status: 'active', consent_at: '2026-10-05T00:00:00Z', created_at: '2026-10-05T00:00:00Z' },
    { id: 'm6', email: 'gone@pub.com.au', status: 'active', unsubscribed_at: '2026-10-20T00:00:00Z', consent_at: '2026-10-06T00:00:00Z', created_at: '2026-10-06T00:00:00Z' },
    { id: 'm7', email: 'back@pub.com.au', status: 'active', consent_at: '2026-10-25T00:00:00Z', resubscribed_at: '2026-10-25T00:00:00Z', created_at: '2026-10-07T00:00:00Z' },
    { id: 'm8', email: 'again@pub.com.au', status: 'active', consent_at: '2026-10-07T00:00:00Z', created_at: '2026-10-08T00:00:00Z' }];
  DB.vp_unsubscribes = [{ email: 'STOPPED@pub.com.au' }, { email: 'back@pub.com.au', created_at: '2026-10-10T00:00:00Z' },
                        { email: 'again@pub.com.au', created_at: '2026-09-01T00:00:00Z', last_unsubscribed_at: '2026-10-15T00:00:00Z' }];
  var mr = await vpsMonthlyRecipients(ENV);
  check('only consent later than the latest unsubscribe: never held, never stopped since (any case, either record, an undated stop always wins); a re-subscriber is in',
    JSON.stringify(mr.map(function (x) { return x.id; })) === '["m1","m5","m7"]', mr);
  check('a live venue\'s contact is left out (their report carries the news); a cancelled venue\'s contact is not', !mr.some(function (x) { return x.id === 'm4'; }) && mr.some(function (x) { return x.id === 'm5'; }), mr);
  check('each comes back as id, email and venue', JSON.stringify(mr[0]) === '{"id":"m1","email":"keen@pub.com.au","venue_name":"Keen Pub"}', mr[0]);
  var threw = false; FAIL['vp_unsubscribes:GET'] = 1;
  try { await vpsMonthlyRecipients(ENV); } catch (x) { threw = true; }
  check('an unsubscribe list that cannot be read THROWS: the sender sends nobody', threw);
  world(); DB.vp_subscribers = [];
  for (var q = 0; q < 1200; q++) { var cq = new Date(Date.UTC(2026, 9, 1) + q * 1000).toISOString(); DB.vp_subscribers.push({ id: 'p' + q, email: 'p' + ('0000' + q).slice(-4) + '@pub.com.au', status: 'active', consent_at: cq, created_at: cq }); }
  DB.vp_unsubscribes = [{ email: 'p1150@pub.com.au' }];
  var big = await vpsMonthlyRecipients(ENV);
  check('1,200 subscribers (the fake stops at 1,000 a page like PostgREST): 1,199 come back, the stopped one past row 1,000 left out',
    big.length === 1199 && !big.some(function (x) { return x.email === 'p1150@pub.com.au'; }) && big.some(function (x) { return x.email === 'p1199@pub.com.au'; }), big.length);

  section('13. NEVER A COLD LEAD');
  check('across every sign-up above, the Worker never called Instantly', !ASKED.some(function (u) { return /instantly/i.test(u); }), ASKED.filter(function (u) { return /instantly/i.test(u); }));
  world(); ENV.SUBSCRIBE_EMAILS = 'on';
  DB.vp_venues = [{ id: V1, name: 'Deepwater Hotel', founding_id: 'f1', status: 'active' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'olive@deepwaterhotel.com.au' }];
  await sub({ email: 'manager@deepwaterhotel.com.au', venue: 'Deepwater Hotel' });
  check('a sign-up that matches a venue opens no sales ticket and writes no prospect', (DB.vp_help_tickets || []).length === 0 && (DB.vp_prospects || []).length === 0);
  check('and the only email it sends is the one to them: nothing to HQ, sales or the venue', sent.length === 1 && sent[0].to[0] === 'manager@deepwaterhotel.com.au', sent.map(function (s) { return s.to; }));

  section('14. MIGRATION 134 HOLDS WHAT THE WORKER WRITES');
  var sql = readFile('venueplay-backend/supabase/venueplay-134-subscribers.sql');
  var body = /create table if not exists public\.vp_subscribers \(([\s\S]*?)\n\);/.exec(sql);
  var cols = body ? body[1].split('\n').map(function (l) { return (/^\s+([a-z_]+)\s/.exec(l) || [])[1]; }).filter(Boolean) : [];
  world(); ENV.SUBSCRIBE_EMAILS = 'on';
  await sub({ email: 'cols@pub.com.au', venue: 'Cols', utm: { utm_source: 'x' } }, null, { country: 'AU', regionCode: 'NSW' });
  var keys = Object.keys(rows()[0] || {}).filter(function (k2) { return k2 !== 'id' && k2 !== 'created_at'; });
  check('every field the Worker writes (and patches) is a column of vp_subscribers', keys.length >= 10 && keys.concat(['confirm_sent_at', 'updated_at', 'unsubscribed_at', 'resubscribed_at']).every(function (k2) { return cols.indexOf(k2) >= 0; }), [keys, cols]);
  check('the table is locked: RLS on and anon and authenticated revoked, the view and the trigger function too',
    /alter table public\.vp_subscribers enable row level security;/.test(sql) && /revoke all on public\.vp_subscribers from public, anon, authenticated;/.test(sql)
    && /revoke all on public\.v_vp_subscribers_monthly from public, anon, authenticated;/.test(sql)
    && /revoke all on function public\.vp_subscribers_mark_unsubscribed\(\) from public, anon, authenticated;/.test(sql) && !/create policy/i.test(sql));
  check('the unsubscribe trigger can never stop an opt-out being written (it swallows its own errors), runs before the insert so a repeat is dated on the first row, and never deletes',
    /exception when others then\s+null;/.test(sql) && /before insert on public\.vp_unsubscribes/.test(sql) && /set last_unsubscribed_at = now\(\)/.test(sql)
    && /add column if not exists last_unsubscribed_at/.test(sql) && !/delete from public\.vp_unsubscribes/i.test(sql));
  check('the routes are in the router, /subscribe public and both HQ routes behind vpaRequireAdmin(owner, accounts)',
    /path === '\/subscribe'\) return await vpsHandleSubscribe/.test(SRC) && /async function vpsHandleAdminList[^]*?vpaRequireAdmin\(request, env, \['owner', 'accounts'\]\)/.test(SRC));

  if (bad) throw new Error('subscribers: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
