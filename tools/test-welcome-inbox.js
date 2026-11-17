/* THE WELCOME LANDS IN THE INBOX (INBOX 414, Dean 16 Nov 2026: "no wonder we aren't getting prospects between
   emails not being delivered and our delayed replies").

   Runs the REAL billing Worker's email builders with a fake Resend and checks what a mail server is handed:
     1. the prospect welcome's From: the first name they met in the cold thread ("Harry at venueplay"), on
        hello@send.venueplay.com.au, never Dean's name, plain "venueplay" when there is no plain sender name
     2. List-Unsubscribe (the Worker's https one-click address on api.venueplay.com.au, the signed token, the
        campaign, then the mailto) and List-Unsubscribe-Post: List-Unsubscribe=One-Click, also when it is booked
     3. a text/plain part that carries the sign-in link and the unsubscribe link
     4. no .dev host and no public link shortener anywhere (html, text, headers); every web link on our domain
     5. image to text: two small logos with alt text against real words
     6. the quiet-prospect nudge: one-click header and a footer Unsubscribe link; an unsubscribed address (or a
        list we cannot read) gets nothing and no link is made or retired
     7. transactional mail stays WITHOUT the header (Google: "Transactional messages are excluded"): the plain
        sign-in link and the HQ welcome

   Run from the repo root:  jsc tools/test-welcome-inbox.js */
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof crypto === 'undefined') crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; clearTimeout = function () {}; }
(0, eval)(src);

var bad = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 500))); } }
function section(t) { print(''); print(t); }

var sent = [], patches = [];
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var tpl = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(tpl); } }); }
  if (/api\.resend\.com\/emails$/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e' + sent.length }); } }); }
  if (opts && opts.method === 'PATCH') patches.push(url);
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
var UNSUB = {}, UNSUB_BROKEN = false, MINTED = 0;
vpaUnsubscribedSet = function () { if (UNSUB_BROKEN) return Promise.reject(new Error('read failed')); return Promise.resolve(UNSUB); };
vpaInsert = function () { return Promise.resolve({}); };
vpaAudit = function () { return Promise.resolve(); };
vpaAuthGetUser = function (env, id) { return Promise.resolve({ id: id, email: 'Sam@LakesideTavern.example', user_metadata: { full_name: 'Sam Lee' } }); };
vpaSelect = function (env, table) {
  if (table === 'vp_venue_staff') return Promise.resolve([{ venue_id: 'v1', role: 'owner' }]);
  if (table === 'vp_signin_links') return Promise.resolve([]);
  if (table === 'vp_venues') return Promise.resolve([{ id: 'v1', name: 'Lakeside Tavern' }]);
  return Promise.resolve([]);
};
vpaProspectLinkWindow = function () { return Promise.resolve(null); };
vpaMintSigninLinkFor = function () { MINTED++; return Promise.resolve({ token: 'abcdefabcdefabcdefabcdefabcdefab', expiresAt: Date.now() + 90 * 86400000, shortened: false }); };

var ENV = { RESEND_API_KEY: 'k', VP_UNSUB_SECRET: 'unsub-secret-for-tests', CARD_LINK_SECRET: 'card-link-secret-for-tests-only-0123456789',
  SITE_URL: 'https://venueplay.com.au', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 's' };
var TO = 'laketavern@example.com.au';
var DEV_HOST = /(^|[^a-z0-9.-])((?:[a-z0-9-]+\.)+dev)(?![a-z0-9-])/i;
var SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|lnkd\.in)\//i;
function hosts(html) { var out = [], re = /href="(https?:\/\/[^"\/?#]+)/gi, m; while ((m = re.exec(html))) out.push(m[1].replace(/^https?:\/\//i, '').toLowerCase()); return out; }
function visible(html) { return String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim(); }
function allOf(m) { return (m.subject || '') + '\n' + (m.html || '') + '\n' + (m.text || '') + '\n' + JSON.stringify(m.headers || {}); }
var OUR = /^(www\.)?venueplay\.com\.au$|^api\.venueplay\.com\.au$/;
var LU = /^<https:\/\/api\.venueplay\.com\.au\/unsubscribe\?e=laketavern%40example\.com\.au&t=[0-9a-f]{32}&c=prospect-welcome>, <mailto:hello@venueplay\.com\.au\?subject=unsubscribe>$/;
function welcome(o) {
  var b = { email: TO, firstName: 'Sam', venueName: 'Lakeside Tavern', signinToken: 'abcdefabcdefabcdefabcdefabcdefab', seats: 10, slides: 0 };
  for (var k in (o || {})) b[k] = o[k];
  sent = []; return vpaFireProspectWelcome(ENV, b).then(function (r) { return { r: r, m: sent[0] || {} }; });
}

(async function () {
  section('1. The welcome comes from the name they met, on hello@, never Dean');
  var h = await welcome({ senderName: 'Harry Finch', senderEmail: 'harry@venueplay.online' });
  check('Harry\'s prospect: From "Harry at venueplay <hello@send.venueplay.com.au>" (first name only), replies to hello@venueplay.com.au',
    h.r.ok && h.m.from === 'Harry at venueplay <hello@send.venueplay.com.au>' && h.m.reply_to === 'hello@venueplay.com.au', [h.m.from, h.m.reply_to]);
  check('the cold mailbox itself appears nowhere in what is sent', allOf(h.m).indexOf('harry@venueplay.online') === -1);
  var k = await welcome({ senderName: 'kayla', senderEmail: 'kayla@venueplay.online' });
  check('a lowercase name is written as a name: "Kayla at venueplay"', k.m.from === 'Kayla at venueplay <hello@send.venueplay.com.au>', k.m.from);
  var d = await welcome({ senderName: 'Dean Tindale', senderEmail: 'dean@venueplay.online' });
  check('one of Dean\'s boxes: plain "venueplay", never Dean\'s own name on the From line', d.m.from === 'venueplay <hello@send.venueplay.com.au>', d.m.from);
  /* Dean, 17 Nov 2026, of emails signed "Cheers, Dean": "You can just say cheers". */
  check('Harry\'s prospect: the welcome is signed "Cheers, Harry, the venueplay team" (first name only)', /Cheers,<br>Harry<br>the venueplay team<br>/.test(h.m.html || '') && !/Finch/.test(h.m.html || ''), (h.m.html || '').slice((h.m.html || '').indexOf('Cheers'), (h.m.html || '').indexOf('Cheers') + 80));
  check('one of Dean\'s boxes: the welcome is signed "Cheers, the venueplay team", no Dean in the HTML, the text part, the subject or the From (Dean, 17 Nov: "You can just say cheers")',
    /Cheers,<br>the venueplay team<br>/.test(d.m.html || '') && !/Dean|Tindale/.test((d.m.html || '') + (d.m.text || '') + (d.m.subject || '') + d.m.from) && /Cheers,?\s+the venueplay team/.test(d.m.text || ''), (d.m.html || '').slice((d.m.html || '').indexOf('Cheers'), (d.m.html || '').indexOf('Cheers') + 80));
  var d2 = await welcome({ senderName: 'Sales Desk', senderEmail: 'dean@venueplay.com.au' });
  check('Dean\'s own dean@ mailbox under another name: still "Cheers, the venueplay team"', /Cheers,<br>the venueplay team<br>/.test(d2.m.html || '') && !/Sales<br>/.test(d2.m.html || ''), (d2.m.html || '').slice((d2.m.html || '').indexOf('Cheers'), (d2.m.html || '').indexOf('Cheers') + 80));
  var n = await welcome({});
  check('no sender given: plain "venueplay <hello@send.venueplay.com.au>"', n.m.from === 'venueplay <hello@send.venueplay.com.au>', n.m.from);
  var x = await welcome({ senderName: 'Harry', senderEmail: 'harry@gmail.com' });
  check('a sender on a mailbox that is not ours is not used as a name', x.m.from === 'venueplay <hello@send.venueplay.com.au>', x.m.from);
  var y = await welcome({ senderName: 'Harry <a@b>', senderEmail: 'harry@venueplay.online' });
  check('a name that is not plain letters never reaches the From line', y.m.from === 'venueplay <hello@send.venueplay.com.au>', y.m.from);
  check('the From line has one address and no "VenuePlay" capitals (lowercase name rule)', [h.m, k.m, d.m, n.m].every(function (m) { return (m.from.match(/@/g) || []).length === 1 && !/VenuePlay/.test(m.from); }));

  section('2. List-Unsubscribe on the welcome, one-click (RFC 8058)');
  var hd = h.m.headers || {};
  check('List-Unsubscribe: the https one-click address on api.venueplay.com.au with its signed token and c=prospect-welcome, then the mailto', LU.test(hd['List-Unsubscribe'] || ''), hd);
  check('List-Unsubscribe-Post: List-Unsubscribe=One-Click', hd['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', hd);
  check('the token in the header is the one the Worker checks for that address', (hd['List-Unsubscribe'] || '').indexOf('&t=' + (await vpUnsubToken(ENV, TO)) + '&') !== -1);
  check('only those two extra headers (nothing else rides along)', Object.keys(hd).sort().join(',') === 'List-Unsubscribe,List-Unsubscribe-Post', Object.keys(hd));
  sent = []; var booked = await vpaFireProspectWelcome(ENV, { email: TO, venueName: 'Lakeside Tavern', signinToken: 'abcdefabcdefabcdefabcdefabcdefab', sendAtMs: Date.now() + 90 * 60000 });
  check('a welcome booked for later keeps both headers and its scheduled_at', booked.ok && !!sent[0].scheduled_at && LU.test((sent[0].headers || {})['List-Unsubscribe'] || ''), sent[0] && sent[0].headers);

  section('3. A text part alongside the HTML');
  var t = h.m.text || '';
  check('a text/plain part is sent, and it is real words (over 300 characters)', t.length > 300, t.length);
  check('the text part carries the sign-in link', t.indexOf('venueplay.com.au/') !== -1 && /abcdefabcdefabcdefabcdefabcdefab/.test(t), t.slice(0, 600));
  check('the text part carries the unsubscribe link', /venueplay\.com\.au\/unsubscribe\?e=laketavern%40example\.com\.au/.test(t), t.slice(-600));
  check('the text part has no leftover {{placeholders}} or HTML tags', !/\{\{|<\/?(td|div|table|a)\b/i.test(t), (t.match(/\{\{[^}]*\}\}|<\/?(td|div|table|a)\b[^>]*>/i) || [''])[0]);

  section('4. No .dev host, no public link shortener, every web link on our domain');
  [['welcome (Harry)', h.m], ['welcome (no sender)', n.m], ['welcome (booked)', sent[0]]].forEach(function (p) {
    var all = allOf(p[1]), dv = DEV_HOST.exec(all);
    check(p[0] + ': no .dev host in the subject, html, text or headers', !dv, dv && dv[2]);
    check(p[0] + ': no public link shortener', !SHORTENERS.test(all), (all.match(SHORTENERS) || [''])[0]);
    var hs = hosts(p[1].html), off = hs.filter(function (x) { return !OUR.test(x); });
    check(p[0] + ': every web link in the html is on venueplay.com.au (' + hs.length + ' links)', hs.length >= 3 && !off.length, off);
  });

  section('5. Image to text');
  var imgs = h.m.html.match(/<img\b[^>]*>/gi) || [];
  check('at most two images (the logo), each with alt text and a venueplay.com.au address', imgs.length <= 2 && imgs.every(function (i) { return /\balt="[^"]+"/.test(i) && /src="https:\/\/venueplay\.com\.au\//.test(i); }), imgs);
  var words = visible(h.m.html).split(' ').length;
  check('real words against those images: over 120 visible words', words > 120, words);

  section('6. The nudge to a quiet prospect');
  sent = []; patches = []; MINTED = 0; UNSUB = {}; UNSUB_BROKEN = false;
  var nz = await vpaSendSigninLink(ENV, 'u1', 'v1', { hqCap: true, nudge: 'Hi Sam,\n\nJust checking you got your venueplay account.\n\nCheers,\nKayla', subject: 'Your venueplay is ready when you are' });
  var nm = sent[0] || {}, nh = nm.headers || {};
  check('it goes, with List-Unsubscribe c=prospect-nudge and the one-click Post header',
    nz.ok && sent.length === 1 && /^<https:\/\/api\.venueplay\.com\.au\/unsubscribe\?e=sam%40lakesidetavern\.example&t=[0-9a-f]{32}&c=prospect-nudge>, <mailto:/.test(nh['List-Unsubscribe'] || '') && nh['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', [nz, nh]);
  check('its footer has an Unsubscribe link on venueplay.com.au, in the html and the text', /href="https:\/\/venueplay\.com\.au\/unsubscribe\?e=sam%40lakesidetavern\.example"[^>]*>Unsubscribe<\/a> from reminders like this one/.test(nm.html || '') && /unsubscribe\?e=sam%40lakesidetavern\.example/.test(nm.text || ''), (nm.html || '').slice(-1500));
  check('its text part exists and no .dev host is anywhere in it', (nm.text || '').length > 100 && !DEV_HOST.test(allOf(nm)));
  sent = []; patches = []; MINTED = 0; UNSUB = { 'sam@lakesidetavern.example': true };
  var nu = await vpaSendSigninLink(ENV, 'u1', 'v1', { hqCap: true, nudge: 'Hi Sam,\n\nJust checking you got your venueplay account.', subject: 'Your venueplay is ready when you are' });
  check('an unsubscribed address: no email, reason "unsubscribed"', !nu.ok && nu.reason === 'unsubscribed' && sent.length === 0, nu);
  check('and no link was made or retired, so the link they have still works', MINTED === 0 && patches.length === 0, { minted: MINTED, patches: patches });
  sent = []; patches = []; MINTED = 0; UNSUB = {}; UNSUB_BROKEN = true;
  var nb = await vpaSendSigninLink(ENV, 'u1', 'v1', { hqCap: true, nudge: 'Hi Sam,\n\nJust checking you got your venueplay account.', subject: 'Your venueplay is ready when you are' });
  check('an unsubscribe list that cannot be read: no email ("unsub_unread"), nothing minted', !nb.ok && nb.reason === 'unsub_unread' && sent.length === 0 && MINTED === 0, nb);
  UNSUB_BROKEN = false;

  section('7. Transactional mail stays without the header');
  sent = []; UNSUB = { 'sam@lakesidetavern.example': true };
  var sl = await vpaSendSigninLink(ENV, 'u1', 'v1', {});
  check('the plain sign-in link still goes to an unsubscribed address (it is the account, not marketing)', sl.ok && sent.length === 1, sl);
  check('and it carries no List-Unsubscribe header (Google: "Transactional messages are excluded")', sent[0] && !sent[0].headers, sent[0] && sent[0].headers);
  check('it has a text part and is from plain "venueplay" on hello@', sent[0] && (sent[0].text || '').length > 100 && sent[0].from === 'venueplay <hello@send.venueplay.com.au>', sent[0] && sent[0].from);
  UNSUB = {};
  sent = []; await vpaFireHqWelcome(ENV, { email: 'owner@pub.example', venueName: 'The Royal Hotel', seats: 40, slug: 'the-royal-hotel-4220', comp: true });
  check('the HQ welcome (a venue we onboarded on request) carries no List-Unsubscribe header', sent.length === 1 && !sent[0].headers, sent[0] && sent[0].headers);

  print('');
  print(bad ? ('welcome inbox: ' + bad + ' of ' + ran + ' failed') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('welcome inbox: ' + bad + ' of ' + ran + ' failed');
})().catch(function (e) { print('  FAIL the suite stopped: ' + (e && e.message)); throw e; });
if (typeof drainMicrotasks === 'function') drainMicrotasks();
