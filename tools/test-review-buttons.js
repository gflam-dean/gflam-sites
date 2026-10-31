/* DEAN'S YES / NO / EDIT BUTTONS ON THE PROSPECT REVIEW EMAIL, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026).

   "can they just have a button to say yes no or edit maybe? I can't copy and paste a command every time
   I get this. It's too much." This runs the REAL billing Worker (tools/rig-billing-worker.js) through its
   REAL router against a fake vp_autopilot_reviews (migration 128) that answers PATCH with the rows it
   changed, the way PostgREST does with return=representation, and a REAL HMAC-SHA256 checked against
   Python. It proves:

     1. the Mac's doors (register, decisions, done) take the key and nothing else; a browser cannot send it
     2. the links are signed: folder, action, expiry and round all inside the signature; a tampered,
        expired, unknown or old-round link does nothing; no key on the Worker = every link refused
     3. a GET never writes (mail scanners fetch every link), and says what will happen and when
     4. a POST records the decision ONCE: a second tap, or another button, changes nothing
     5. Edit records the edited text; a long dash or an empty reply is refused on the page, kept, not saved
     6. the Mac sees each decision until it marks it done, and marking is once; a held yes opens a new
        round with new links, and the old links stop
     7. (31 Oct 2026) each page has ONLY the recommended button at the top (Edit when there is none) and all
        three at the bottom in the email's order, through the same one form and the same signed links

   Run from the repo root:  jsc tools/test-review-buttons.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }

URL = function (u) { u = String(u); var q = u.indexOf('?'); var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/'; this.searchParams = { get: function () { return null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };

load('tools/rig-billing-worker.js');
load('partyplay-backend/worker/_test-sha256.js');
TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { return { _s: String(s) }; };
crypto = { subtle: {
  importKey: function (fmt, k) { return Promise.resolve({ _k: k._s }); },
  sign: function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); },
  digest: function () { return Promise.resolve(new Uint8Array(32).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };

var KEY = 'k3y-' + 'abcdefghijklmnopqrstuvwxyz0123456789';   // 40 characters, assembled so it is no key's shape
var VECTOR = '0d40a8c71578eac85d2a9b3ffed0160e';            // Python: hmac('vp-review:'+KEY, folder|yes|1793000000|1)[:32]
var FOLDER = '2026-10-29-test-charlie-hotel';
var ROWS = [], WRITES = [], FAILDB = false, STALE = 0, NO_V2 = false;   // NO_V2: the live table before migration 130
var V2 = ['details', 'edited_postcode', 'edited_entity_type', 'edited_login_email'];   // STALE = n: the next n reads see the row before the other tap landed
var NOW = Date.parse('2026-10-29T08:00:00Z');
Date.now = function () { return NOW; };
var rigFetch = globalThis.fetch;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  var m = /\/rest\/v1\/vp_autopilot_reviews\??(.*)$/.exec(u);
  if (!m) return rigFetch(url, opts);
  if (method !== 'GET') WRITES.push({ method: method, url: u, body: opts && opts.body });
  if (FAILDB) return RS(503, 'down');
  var q = parseQ(m[1]);
  if (NO_V2 && method === 'GET' && /edited_(postcode|entity_type|login_email)|details/.test(q.select || '')) return RS(400, { code: '42703', message: 'column vp_autopilot_reviews.edited_postcode does not exist' });
  if (NO_V2 && method !== 'GET' && V2.some(function (k) { return k in JSON.parse(opts.body || '{}'); })) return RS(400, { code: 'PGRST204', message: "Could not find the 'details' column of 'vp_autopilot_reviews' in the schema cache" });
  if (method === 'GET') {
    // PostgREST returns every column; after migration 130 that includes the four new ones, null until written
    if (!NO_V2) ROWS.forEach(function (r) { V2.forEach(function (k) { if (!(k in r)) r[k] = null; }); });
    var rows = ROWS.filter(function (r) { return match(r, q); });
    rows.sort(function (a, b) { return String(a.decided_at) < String(b.decided_at) ? -1 : 1; });
    var off = parseInt(q.offset || '0', 10), lim = Math.min(parseInt(q.limit || '1000', 10), 1000);
    var out = JSON.parse(JSON.stringify(rows.slice(off, off + lim)));
    // select=a,b: only those columns come back, as PostgREST does (30 Oct 2026: the decisions read names the Edit boxes)
    if (q.select && q.select !== '*') { var cols = q.select.split(','); out = out.map(function (r) { var o = {}; cols.forEach(function (c) { if (c in r) o[c] = r[c]; }); return o; }); }
    if (STALE > 0 && q.folder) { STALE--; out.forEach(function (r) { r.decision = null; r.decided_at = null; }); }
    return RS(200, out);
  }
  if (method === 'POST') { var o = JSON.parse(opts.body);
    if (ROWS.some(function (r) { return r.folder === o.folder; })) return RS(409, { code: '23505' });
    ROWS.push(o); return RS(201, ''); }
  if (method === 'PATCH') { var p = JSON.parse(opts.body), hit = ROWS.filter(function (r) { return match(r, q); });
    hit.forEach(function (r) { for (var k in p) r[k] = p[k]; });
    return RS(200, JSON.parse(JSON.stringify(hit))); }
  return RS(405, {});
};

function req(path, body, headers, method, raw) {
  var h = {}; for (var k in (headers || {})) h[k.toLowerCase()] = headers[k];
  var txt = raw !== undefined ? raw : (body === undefined ? '' : JSON.stringify(body));
  return { method: method || 'POST', url: 'https://venueplay-api.dean-tindale.workers.dev' + path,
    headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(txt); } };
}
async function call(path, body, headers, method, raw) {
  var res = await _d.fetch(req(path, body, headers, method, raw), ENV);
  var parsed = null; try { parsed = JSON.parse(res.body); } catch (e) { parsed = null; }
  return { status: res.status, body: parsed || {}, html: typeof res.body === 'string' ? res.body : '', headers: res.headers || {} };
}
var AP = { 'X-Autopilot-Key': KEY };
var REPLY = 'Hi Rowan,\n\nThanks for getting back to me.\n\nIn short: VenuePlay turns the TV you already have into a games night, so you can have a play.\n\nCheers,\nHarry Finch\nVenuePlay\nvenueplay.com.au\n';
var REVIEW = { folder: FOLDER, company: 'Test Charlie <Hotel>', class: 'interested', their_words: 'Yes please, send it through. <b>Mick</b>',
  reply: REPLY, mailbox: 'harry@venueplaylive.com.au', reply_to: 'manager@testcharlie.example' };
function world() { ROWS = []; WRITES = []; FAILDB = false; NO_V2 = false; NOW = Date.parse('2026-10-29T08:00:00Z'); ENV.PROSPECT_AUTOPILOT_KEY = KEY; }
function pathOf(link) { return link.replace(/^https:\/\/[^/]+/, ''); }
function swap(link, k, v) { return link.replace(new RegExp('([?&]' + k + '=)[^&]*'), '$1' + v); }
function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]).replace(/%20/g, '+'); }).join('&'); }

(async function () {
  section('1. THE MAC\'S DOORS: the key, and nothing else');
  world(); delete ENV.PROSPECT_AUTOPILOT_KEY;
  var r = await call('/autopilot/review/register', REVIEW, AP);
  check('no key on the Worker: register is 503 "not switched on", nothing saved', r.status === 503 && /not switched on/.test(r.body.error) && !ROWS.length, r);
  world();
  r = await call('/autopilot/review/register', REVIEW, {});
  check('register with no key: 401, nothing saved', r.status === 401 && !ROWS.length && !WRITES.length, r);
  r = await call('/autopilot/review/register', REVIEW, { 'X-Autopilot-Key': KEY.slice(0, -1) + 'X' });
  check('register with a key one character off: 401, nothing saved', r.status === 401 && !ROWS.length, r);
  r = await call('/autopilot/decisions', undefined, { 'X-Autopilot-Key': KEY + 'x' }, 'GET');
  check('decisions with a wrong key: 401, nothing read out', r.status === 401 && !r.body.decisions, r);
  r = await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'queued' }, {});
  check('done with no key: 401', r.status === 401 && !WRITES.length, r);
  r = await call('/autopilot/review/register', { folder: '../etc/passwd', reply: REPLY }, AP);
  check('a folder that is not a folder name is refused', r.status === 400 && !ROWS.length, r);
  r = await call('/autopilot/review/register', null, AP, 'OPTIONS');
  check('a browser cannot send the key: X-Autopilot-Key is not an allowed CORS header', r.status === 204 && !/autopilot/i.test(String(r.headers['Access-Control-Allow-Headers'] || '')), r.headers);

  section('2. REGISTER: the row, and three signed links');
  r = await call('/autopilot/review/register', REVIEW, AP);
  var L = r.body.links || {};
  check('200 with round 1 and a link for yes, no and edit', r.status === 200 && r.body.round === 1 && !!L.yes && !!L.no && !!L.edit, r.body);
  check('one row, the reply and their words as given, expiry 7 days on', ROWS.length === 1 && ROWS[0].reply === REPLY && ROWS[0].their_words === REVIEW.their_words &&
    Date.parse(ROWS[0].expires_at) - NOW === 7 * 86400000, ROWS[0]);
  check('the links point at this Worker\'s review page', /^https:\/\/venueplay-api\.dean-tindale\.workers\.dev\/autopilot\/review\?f=2026-10-29-test-charlie-hotel&a=yes&r=1&x=\d+&t=[0-9a-f]{32}$/.test(L.yes || ''), L.yes);
  check('the key itself is in no link and no answer', JSON.stringify(r.body).indexOf(KEY) === -1);
  check('the token is the documented scheme, character for character (Python vector)', (await vpaReviewToken(ENV, FOLDER, 'yes', 1793000000, 1)) === VECTOR);
  var t1 = await vpaReviewToken(ENV, FOLDER, 'yes', 1793000000, 1);
  check('action, expiry, round and folder are each inside the signature',
    t1 !== (await vpaReviewToken(ENV, FOLDER, 'no', 1793000000, 1)) && t1 !== (await vpaReviewToken(ENV, FOLDER, 'yes', 1793000001, 1)) &&
    t1 !== (await vpaReviewToken(ENV, FOLDER, 'yes', 1793000000, 2)) && t1 !== (await vpaReviewToken(ENV, FOLDER + 'x', 'yes', 1793000000, 1)));
  var again = await call('/autopilot/review/register', Object.assign({}, REVIEW, { reply: REPLY + '\nPS hi\n' }), AP);
  check('registering again before Dean decides refreshes the text and keeps round 1', again.status === 200 && again.body.round === 1 && ROWS.length === 1 && /PS hi/.test(ROWS[0].reply), again.body);
  ROWS[0].reply = REPLY;

  section('3. A GET NEVER WRITES, and says what happens and when');
  WRITES = [];
  var g = await call(pathOf(L.yes), undefined, {}, 'GET');
  check('Yes page: 200, branded, the venue (escaped), their words (escaped), the reply', g.status === 200 && /VenuePlay prospect review/.test(g.html) &&
    g.html.indexOf('Test Charlie &lt;Hotel&gt;') !== -1 && g.html.indexOf('&lt;b&gt;Mick&lt;/b&gt;') !== -1 && g.html.indexOf('Thanks for getting back to me.') !== -1, g.html.slice(0, 300));
  check('Yes page: one big "Yes, send the standard reply" button that POSTs back to the same signed link', /<form method="POST" action="\/autopilot\/review\?f=2026-10-29-test-charlie-hotel&amp;a=yes&amp;r=1&amp;x=\d+&amp;t=[0-9a-f]{32}"/.test(g.html) && />Yes, send the standard reply<\/button>/.test(g.html));
  check('Yes page: says exactly what happens and when (5 minutes, the checks, 30 minutes after theirs, 8am to 5pm Monday to Friday, the email back)',
    /Within 5 minutes your Mac/.test(g.html) && /nobody has replied to them since/.test(g.html) && /30 minutes after their email arrived, between 8am and 5pm Monday to Friday/.test(g.html) &&
    /from harry@venueplaylive\.com\.au/.test(g.html) && /why it was held/.test(g.html));
  check('Yes page: Edit and No are one tap away', g.html.indexOf('a=edit') !== -1 && g.html.indexOf('a=no') !== -1);
  check('Yes page: phone width, not cached, not indexed, no referrer', /width=device-width/.test(g.html) && g.headers['cache-control'] === 'no-store' && g.headers['x-robots-tag'] === 'noindex' && g.headers['referrer-policy'] === 'no-referrer');
  var ge = await call(pathOf(L.edit), undefined, {}, 'GET');
  check('Edit page: a textarea filled with the reply, and Save and send', /<textarea name="reply"[^>]*>Hi Rowan,/.test(ge.html) && />Save and send<\/button>/.test(ge.html), ge.html.slice(-600));
  var gn = await call(pathOf(L.no), undefined, {}, 'GET');
  check('No page: an optional reason box and "No, do not send"; says nothing goes and no account is made', /<textarea class="short" name="reason"/.test(gn.html) && />No, do not send<\/button>/.test(gn.html) && /Nothing is sent to them and no account is made/.test(gn.html));
  check('no page has an em or en dash, or the word roster', [g.html, ge.html, gn.html].every(function (h) { return !/[\u2014\u2013]/.test(h) && !/roster/i.test(h); }));
  check('three GETs (a mail scanner) wrote NOTHING', WRITES.length === 0 && !ROWS[0].decision, WRITES);
  ROWS[0].class = 'question';
  g = await call(pathOf(L.yes), undefined, {}, 'GET');
  check('a question from a Mac with no recommendation: one neutral line (check the reply answers it, or tap Edit), never "will be held"', /They asked a question\. Check the reply below answers it/.test(g.html) && !/will be held/.test(g.html), g.html.slice(0, 200));
  ROWS[0].class = 'interested';

  section('4. BAD LINKS DO NOTHING');
  var tok = /t=([0-9a-f]{32})/.exec(L.yes)[1], flip = tok.slice(0, 31) + (tok.slice(31) === '0' ? '1' : '0');
  var b1 = await call(pathOf(swap(L.yes, 't', flip)), undefined, {}, 'POST', '');
  check('a token one character off: 403, nothing recorded', b1.status === 403 && !ROWS[0].decision && /does not work/.test(b1.html), b1.status);
  var b2 = await call(pathOf(swap(L.yes, 'a', 'no')), undefined, {}, 'POST', '');
  check('a Yes link edited to say No: 403, nothing recorded', b2.status === 403 && !ROWS[0].decision, b2.status);
  var b3 = await call(pathOf(swap(L.yes, 'x', '1999999999')), undefined, {}, 'POST', '');
  check('a later expiry written into the link: 403', b3.status === 403 && !ROWS[0].decision, b3.status);
  var b4 = await call(pathOf(swap(L.yes, 'f', '2026-10-29-someone-else')), undefined, {}, 'POST', '');
  check('another folder written into the link: 403', b4.status === 403 && !ROWS[0].decision, b4.status);
  ENV.PROSPECT_AUTOPILOT_KEY = '';
  var b5 = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  check('no key on the Worker: every link refused (503), nothing recorded', b5.status === 503 && !ROWS[0].decision, b5.status);
  ENV.PROSPECT_AUTOPILOT_KEY = KEY;
  NOW += 7 * 86400000 + 1000;
  var b6 = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  check('after 7 days: "run out" (410), nothing recorded', b6.status === 410 && !ROWS[0].decision && /run out/.test(b6.html), b6.status);
  NOW = Date.parse('2026-10-29T08:00:00Z');
  FAILDB = true;
  var b7 = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  FAILDB = false;
  check('the database down: "did not load", nothing recorded, never "done"', b7.status === 503 && !ROWS[0].decision && !/Got it/.test(b7.html), b7.status);

  section('5. A TAP RECORDS ONCE');
  var p1 = await call(pathOf(L.yes), undefined, { 'User-Agent': 'iPhone Safari' }, 'POST', '');
  check('Yes: "Got it", recorded yes with the time and the phone', p1.status === 200 && /Got it: Yes, send the standard reply/.test(p1.html) && ROWS[0].decision === 'yes' && !!ROWS[0].decided_at && ROWS[0].decided_agent === 'iPhone Safari', p1.html.slice(-500));
  check('the done page says the Mac picks it up within 5 minutes', /picks it up within 5 minutes/.test(p1.html));
  var at = ROWS[0].decided_at; NOW += 60000;
  var p2 = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  check('a second tap on Yes: same "Got it" page, nothing changed', p2.status === 200 && ROWS[0].decided_at === at && ROWS[0].decision === 'yes');
  var p3 = await call(pathOf(L.no), undefined, {}, 'POST', form({ reason: 'changed my mind' }));
  check('No after Yes: "You already chose: Yes", still yes, no reason written', /You already chose: Yes, send the standard reply/.test(p3.html) && ROWS[0].decision === 'yes' && !ROWS[0].reason, p3.html.slice(-500));
  var p4 = await call(pathOf(L.edit), undefined, {}, 'POST', form({ reply: REPLY + 'extra' }));
  check('Edit after Yes: refused the same way, the edited text not stored', /You already chose/.test(p4.html) && !ROWS[0].edited_reply);
  var g2 = await call(pathOf(L.edit), undefined, {}, 'GET');
  check('opening a link after deciding shows the decision, no buttons', /You already chose/.test(g2.html) && !/<form/.test(g2.html));

  section('6. THE MAC: sees it until done, done once');
  var d = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('the Mac sees the one decision: folder, round, yes', d.status === 200 && d.body.decisions.length === 1 && d.body.decisions[0].folder === FOLDER && d.body.decisions[0].round === 1 && d.body.decisions[0].decision === 'yes', d.body);
  var dn = await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'bogus' }, AP);
  check('a made-up result is refused', dn.status === 400 && !ROWS[0].applied_at, dn);
  dn = await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'held', note: 'someone already replied' }, AP);
  check('marked done: applied once, with its result and note', dn.status === 200 && dn.body.marked === true && !!ROWS[0].applied_at && ROWS[0].applied_result === 'held' && ROWS[0].applied_note === 'someone already replied', dn.body);
  var first = ROWS[0].applied_at; NOW += 60000;
  dn = await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'queued' }, AP);
  check('marking it again changes nothing (already: true)', dn.status === 200 && dn.body.already === true && ROWS[0].applied_at === first && ROWS[0].applied_result === 'held', dn.body);
  d = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('and the Mac no longer sees it', d.status === 200 && d.body.decisions.length === 0, d.body);
  var g3 = await call(pathOf(L.yes), undefined, {}, 'GET');
  check('the link now shows what the Mac did with it', /Your Mac has dealt with it: <b>held<\/b>\. someone already replied/.test(g3.html), g3.html.slice(-600));
  var noRe = await call('/autopilot/review/register', REVIEW, AP);
  check('registering a decided review without reopen is refused (409), the decision kept', noRe.status === 409 && ROWS[0].decision === 'yes', noRe.body);

  section('7. A HELD YES: a new round, new links, the old ones stop');
  var re = await call('/autopilot/review/register', Object.assign({ reopen: true }, REVIEW), AP);
  var L2 = re.body.links || {};
  check('reopen after it was applied: round 2, decision cleared, new links', re.status === 200 && re.body.round === 2 && ROWS[0].round === 2 && ROWS[0].decision === null && ROWS[0].applied_at === null && L2.edit && L2.edit !== L.edit, re.body);
  var old = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  check('a round-1 link now says "older email" and records nothing', old.status === 409 && /older email/.test(old.html) && ROWS[0].decision === null, old.status);

  section('8. EDIT: the text is stored; what a phone does to it is caught on the page');
  var dash = REPLY.replace('In short:', 'In short \u2014');
  var e1 = await call(pathOf(L2.edit), undefined, {}, 'POST', form({ reply: dash }));
  check('a long dash: 400, told why, their text kept in the box, nothing saved', e1.status === 400 && /long dash/.test(e1.html) && e1.html.indexOf('In short \u2014') !== -1 && ROWS[0].decision === null, e1.status);
  var e2 = await call(pathOf(L2.edit), undefined, {}, 'POST', form({ reply: '   ' }));
  check('an empty reply: 400, nothing saved', e2.status === 400 && /too short/.test(e2.html) && ROWS[0].decision === null, e2.status);
  var edited = REPLY.replace('Thanks for getting back to me.', 'Thanks Rowan. Yes, trivia teams can be up to six people.') + '\r\n';
  var e3 = await call(pathOf(L2.edit), undefined, {}, 'POST', form({ reply: edited }));
  check('Save and send: recorded edit, the edited text stored (line endings tidied, one newline at the end)', e3.status === 200 && ROWS[0].decision === 'edit' &&
    ROWS[0].edited_reply === edited.replace(/\r\n/g, '\n').trim() + '\n' && /Got it: Edited and send/.test(e3.html), ROWS[0].edited_reply);
  d = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('the Mac gets the edited text with the decision', d.body.decisions.length === 1 && d.body.decisions[0].decision === 'edit' && /up to six people/.test(d.body.decisions[0].edited_reply), d.body);

  section('8b. TWO PHONES AT ONCE: the page read the row before the other tap landed');
  world();
  r = await call('/autopilot/review/register', REVIEW, AP); L = r.body.links;
  ROWS[0].decision = 'no'; ROWS[0].decided_at = '2026-10-29T07:59:00.000Z'; ROWS[0].reason = 'first tap';
  STALE = 1;
  var race = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  STALE = 0;
  check('the second tap does not overwrite the first: still no, still its reason, and the page says what was chosen',
    ROWS[0].decision === 'no' && ROWS[0].reason === 'first tap' && /You already chose: No, do not send/.test(race.html), { row: ROWS[0], page: race.html.slice(-400) });

  section('10. THE RECOMMENDATION AND THE EDIT PAGE\'S BOXES (Dean, 30 Oct 2026; migration 130)');
  world();
  var SARAH = 'The email sarah+test9@gflam.com.au already has a VenuePlay login from an earlier test. Delete the old login in HQ (open the venue\'s Details, then Remove login), or tap Edit to use a different email.';
  var V2REV = Object.assign({}, REVIEW, { class: 'question', postcode: '', entity_type: 'for_profit', login_email: 'Sarah+Test9@gflam.com.au', state: '',
    recommend: 'edit', recommend_why: 'We still need their postcode and the account sorted before it can go. <i>x</i>', warnings: [SARAH, 'We guessed it is a pub from its name. If it is a club, tap Edit and choose Club.'] });
  r = await call('/autopilot/review/register', V2REV, AP); L = r.body.links || {};
  check('register keeps what the Mac found, checked: the recommendation, its reason, the plain warnings, the postcode, pub or club and the login email (lower case)',
    r.status === 200 && ROWS[0].details && ROWS[0].details.recommend === 'edit' && /We still need their postcode/.test(ROWS[0].details.recommend_why) && ROWS[0].details.warnings.length === 2 &&
    ROWS[0].details.postcode === '' && ROWS[0].details.entity_type === 'for_profit' && ROWS[0].details.login_email === 'sarah+test9@gflam.com.au', ROWS[0].details);
  var badr = await call('/autopilot/review/register', Object.assign({}, V2REV, { folder: FOLDER + '-b', postcode: '42a17x', entity_type: 'casino', login_email: 'not an email', recommend: 'maybe', warnings: new Array(30).join('w,').split(',') }), AP);
  var rb = ROWS.filter(function (x) { return x.folder === FOLDER + '-b'; })[0] || {};
  check('what the Mac sends is never trusted: a bad postcode, pub or club, email or recommendation is dropped, and the warnings are capped at 12',
    badr.status === 200 && rb.details && rb.details.postcode === '' && rb.details.entity_type === '' && rb.details.login_email === '' && rb.details.recommend === '' && rb.details.warnings.length <= 12, rb.details);
  g = await call(pathOf(L.yes), undefined, {}, 'GET');
  check('Yes page: "I recommend: Edit first." with its reason (escaped), then each warning', /<div class="rec edit"><b>I recommend: Edit first\.<\/b><br>We still need their postcode and the account sorted before it can go\. &lt;i&gt;x&lt;\/i&gt;<\/div>/.test(g.html) &&
    g.html.indexOf('<div class="warn">' + vpaEsc(SARAH) + '</div>') !== -1 && g.html.indexOf('rec edit') < g.html.indexOf(vpaEsc(SARAH)), g.html.slice(g.html.indexOf('<h2>What they wrote'), g.html.indexOf('<h2>What they wrote') + 900));
  ge = await call(pathOf(L.edit), undefined, {}, 'GET');
  check('Edit page: a Postcode box, a Pub / Club choice and a Login email box, filled from what the autopilot found, beside the reply',
    /<input type="text" name="postcode"[^>]*value=""/.test(ge.html) && /<input type="radio" name="entity" value="pub" checked>/.test(ge.html) && /<input type="radio" name="entity" value="club">/.test(ge.html) &&
    /<input type="email" name="login_email"[^>]*value="sarah\+test9@gflam\.com\.au"/.test(ge.html) && /<textarea name="reply"/.test(ge.html), ge.html.slice(-1800));
  var FORBID = ['--postcode', '--club', 'reply.txt', '--approve', '409', '+ Add venue'];
  var seen = FORBID.filter(function (w) { return [g.html, ge.html].some(function (h) { return h.indexOf(w) !== -1; }); });
  check('nothing on the review or Edit page is a command or a code (' + FORBID.join(', ') + ')', seen.length === 0, seen);
  WRITES = [];
  var e4 = await call(pathOf(L.edit), undefined, {}, 'POST', form({ reply: REPLY, postcode: '42 17', entity: 'club', login_email: 'x@y.example' }));
  check('a postcode that is not 4 numbers: 400, told so, what was typed kept in the boxes, nothing saved', e4.status === 400 && /postcode must be 4 numbers/.test(e4.html) &&
    /name="postcode"[^>]*value="42 17"/.test(e4.html) && /value="club" checked/.test(e4.html) && !ROWS[0].decision && WRITES.length === 0,
    { s: e4.status, w: WRITES.length, d: ROWS[0].decision, h: e4.html.slice(e4.html.indexOf('<div class="err">'), e4.html.indexOf('<div class="err">') + 200), b: e4.html.slice(e4.html.indexOf('<h2>Their account'), e4.html.indexOf('<h2>Their account') + 500) });
  var e5 = await call(pathOf(L.edit), undefined, {}, 'POST', form({ reply: REPLY, postcode: '4217', entity: 'club', login_email: 'not-an-email' }));
  check('a login email that is not an email: 400, nothing saved', e5.status === 400 && /does not look like an email/.test(e5.html) && !ROWS[0].decision, { s: e5.status, d: ROWS[0].decision, h: e5.html.slice(e5.html.indexOf('<div class="err">'), e5.html.indexOf('<div class="err">') + 200) });
  var e6 = await call(pathOf(L.edit), undefined, {}, 'POST', form({ reply: REPLY, postcode: ' 4217 ', entity: 'club', login_email: 'Sarah+Test10@GFLAM.com.au' }));
  check('Save and send: the edit is recorded with the postcode, Club (non_profit) and the email (lower case)', e6.status === 200 && ROWS[0].decision === 'edit' &&
    ROWS[0].edited_postcode === '4217' && ROWS[0].edited_entity_type === 'non_profit' && ROWS[0].edited_login_email === 'sarah+test10@gflam.com.au', ROWS[0]);
  d = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('the Mac gets the boxes with the decision', d.status === 200 && d.body.decisions[0].edited_postcode === '4217' && d.body.decisions[0].edited_entity_type === 'non_profit' &&
    d.body.decisions[0].edited_login_email === 'sarah+test10@gflam.com.au', d.body);
  await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'held', note: SARAH }, AP);
  re = await call('/autopilot/review/register', Object.assign({ reopen: true }, V2REV), AP);
  check('a held edit opens a new round with the boxes cleared, so an old answer is never applied twice', re.status === 200 && ROWS[0].round === 2 && ROWS[0].edited_postcode === null &&
    ROWS[0].edited_entity_type === null && ROWS[0].edited_login_email === null && ROWS[0].decision === null, ROWS[0]);
  var d2 = await call(pathOf(re.body.links.edit), undefined, {}, 'POST', form({ reply: REPLY, postcode: '', login_email: '' }));
  check('empty boxes are saved as nothing (the Mac then changes nothing but the reply)', d2.status === 200 && ROWS[0].decision === 'edit' && ROWS[0].edited_postcode === null &&
    ROWS[0].edited_entity_type === null && ROWS[0].edited_login_email === null, ROWS[0]);
  g3 = await call(pathOf(re.body.links.yes), undefined, {}, 'GET');

  section('11. BEFORE MIGRATION 130: everything works as it did, without the boxes');
  world(); NO_V2 = true;
  r = await call('/autopilot/review/register', V2REV, AP); L = r.body.links || {};
  check('register still saves the review (without what the table cannot hold) and gives the links', r.status === 200 && ROWS.length === 1 && !('details' in ROWS[0]) && !!L.edit, r.body);
  ge = await call(pathOf(L.edit), undefined, {}, 'GET');
  check('the Edit page has the reply and no boxes it could not save', ge.status === 200 && /<textarea name="reply"/.test(ge.html) && !/name="postcode"/.test(ge.html), ge.status);
  var e7 = await call(pathOf(L.edit), undefined, {}, 'POST', form({ reply: REPLY, postcode: '4217' }));
  check('an edit is still recorded', e7.status === 200 && ROWS[0].decision === 'edit' && !('edited_postcode' in ROWS[0]), ROWS[0]);
  d = await call('/autopilot/decisions', undefined, AP, 'GET');
  check('and the Mac still sees it, as before', d.status === 200 && d.body.decisions.length === 1 && d.body.decisions[0].decision === 'edit' && !('edited_postcode' in d.body.decisions[0]), d.body);
  await call('/autopilot/decisions/done', { folder: FOLDER, round: 1, result: 'held', note: 'x' }, AP);
  re = await call('/autopilot/review/register', Object.assign({ reopen: true }, V2REV), AP);
  check('a held one still reopens (round 2)', re.status === 200 && ROWS[0].round === 2 && ROWS[0].decision === null, re.body);
  NO_V2 = false;

  section('9. NO: the reason is kept');
  world();
  r = await call('/autopilot/review/register', REVIEW, AP); L = r.body.links;
  var n1 = await call(pathOf(L.no), undefined, {}, 'POST', form({ reason: 'They are a restaurant, not a pub' }));
  check('No: recorded no with the reason', n1.status === 200 && ROWS[0].decision === 'no' && ROWS[0].reason === 'They are a restaurant, not a pub' && /Got it: No, do not send/.test(n1.html), ROWS[0]);

  section('12. THE PAGE: ONLY THE RECOMMENDED BUTTON AT THE TOP, ALL THREE AT THE BOTTOM (Dean, 31 Oct 2026)');
  /* "what you recommend up the top just the button so if you recommend the normal email that just that one if you
     recommend edit email, just the edit button at the top." Read from the page the Worker serves: the top block and
     the bottom block, every control in each, what it is (this page's own submit, or a signed link) and its words. */
  var WORDS = { yes: 'Yes, send the standard reply', edit: 'Edit the reply first', no: 'No, do not send' };
  var CONFIRM = { yes: 'Yes, send the standard reply', edit: 'Save and send', no: 'No, do not send' };
  function unesc(x) { return String(x).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  function part(html, name) { var m = new RegExp('<div class="[a-z]+" data-vpa="' + name + '">([\\s\\S]*?)</div>').exec(html); return m ? m[1] : null; }
  function controls(p) {
    var out = [], re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/(?:button|a)>/g, m;
    while ((m = re.exec(p || ''))) {
      var at = m[2], inner = m[3];
      var get = function (k) { var x = new RegExp('\\b' + k + '="([^"]*)"').exec(at); return x ? unesc(x[1]) : null; };
      out.push({ tag: m[1], a: get('data-a'), href: get('href'), type: get('type'), rec: /Recommended/i.test(inner),
        words: inner.replace(/<span class="tag">[^<]*<\/span>/, '').replace(/<[^>]*>/g, '') });
    }
    return out;
  }
  function tags(p) { return (String(p || '').match(/<(a|button|input|form|textarea|select)\b/g) || []).length; }
  /* The one control at the top is the recommended one: on its own page, that page's confirm (a submit); on any other,
     the signed link to its page, exactly as registered. */
  function topSays(html, want, action, L) {
    var p = part(html, 'top'), c = controls(p);
    if (p === null || tags(p) !== 1 || c.length !== 1) return { ok: false, saw: p };
    var x = c[0], ok = x.a === want && x.rec && (want === action
      ? (x.tag === 'button' && x.type === 'submit' && x.words === CONFIRM[want])
      : (x.tag === 'a' && x.href === L[want] && x.words === WORDS[want]));
    return { ok: ok, saw: x };
  }
  function bottomSays(html, order, action, L) {
    var p = part(html, 'bottom'), c = controls(p);
    var ok = p !== null && tags(p) === 3 && c.length === 3 && c.map(function (x) { return x.a; }).join(',') === order.join(',') &&
      c.every(function (x, i) { return x.rec === (i === 0) && (x.a === action
        ? (x.tag === 'button' && x.type === 'submit' && x.words === CONFIRM[x.a])
        : (x.tag === 'a' && x.href === L[x.a] && x.words === WORDS[x.a])); });
    return { ok: ok, saw: c };
  }
  /* One form per page, posting to this page's own signed link, holding the top, the boxes and the bottom, so every
     submit on the page records through the same POST and nothing else does. */
  function oneForm(html, action, L) {
    var fo = html.indexOf('<form '), fc = html.indexOf('</form>');
    var act = /<form method="POST" action="([^"]*)"/.exec(html);
    var subs = [], re = /type="submit"/g, m;
    while ((m = re.exec(html))) subs.push(m.index);
    var boxes = action === 'edit' ? html.indexOf('<textarea name="reply"') : action === 'no' ? html.indexOf('<textarea class="short" name="reason"') : fo + 1;
    return (html.match(/<form\b/g) || []).length === 1 && (html.match(/<\/form>/g) || []).length === 1 && !!act && unesc(act[1]) === pathOf(L[action]) &&
      fo < html.indexOf('data-vpa="top"') && html.indexOf('data-vpa="bottom"') < fc && boxes > fo && boxes < fc &&
      subs.length >= 1 && subs.every(function (i) { return i > fo && i < fc; });
  }
  var CASES = [
    { name: 'recommend Yes', extra: { recommend: 'yes', recommend_why: 'They said yes and asked nothing else, so the standard reply covers it.' }, rec: 'yes', order: ['yes', 'edit', 'no'] },
    { name: 'recommend Edit', extra: { recommend: 'edit', recommend_why: 'They asked about trivia teams, which the standard reply does not cover. Tap Edit and answer it.' }, rec: 'edit', order: ['edit', 'yes', 'no'] },
    { name: 'no recommendation (a Mac from before 30 Oct): Edit, the safe one', extra: {}, rec: 'edit', order: ['edit', 'yes', 'no'] }
  ];
  var allPages = [], wroteOnGet = [], firstHtml = {};
  for (var ci = 0; ci < CASES.length; ci++) {
    var C = CASES[ci];
    world();
    r = await call('/autopilot/review/register', Object.assign({}, REVIEW, C.extra), AP); L = r.body.links || {};
    WRITES = [];
    var pages = {};
    for (var ai = 0; ai < 3; ai++) { var A = ['yes', 'edit', 'no'][ai]; pages[A] = (await call(pathOf(L[A]), undefined, {}, 'GET')).html; allPages.push(pages[A]); }
    if (WRITES.length || ROWS[0].decision) wroteOnGet.push({ c: C.name, w: WRITES, d: ROWS[0].decision });
    ['yes', 'edit', 'no'].forEach(function (A) {
      var t = topSays(pages[A], C.rec, A, L);
      check(C.name + ', the ' + A + ' page: the top has exactly one button, "' + (C.rec === A ? CONFIRM[C.rec] : WORDS[C.rec]) + '", labelled Recommended, ' +
        (C.rec === A ? 'this page\'s own confirm' : 'the signed ' + C.rec + ' link'), t.ok, t.saw);
    });
    var bad3 = ['yes', 'edit', 'no'].filter(function (A) { return !bottomSays(pages[A], C.order, A, L).ok; });
    check(C.name + ': the bottom of all three pages has all three, ' + C.order.join(', ') + ' (the email\'s order), only the first labelled Recommended, each the signed link or the page\'s own confirm',
      bad3.length === 0, bad3.length ? { page: bad3[0], saw: bottomSays(pages[bad3[0]], C.order, bad3[0], L).saw } : '');
    var badF = ['yes', 'edit', 'no'].filter(function (A) { return !oneForm(pages[A], A, L); });
    check(C.name + ': one form on each page, to its own signed link, holding the top, the boxes and the bottom', badF.length === 0, badF);
    firstHtml[C.rec + ci] = pages;
    if (ci === 0) {
      var fy = /<form method="POST" action="([^"]*)"/.exec(pages.yes);   // no form: the check below fails, it does not throw
      var tp = fy ? await call(unesc(fy[1]), undefined, {}, 'POST', '') : { status: 0, html: '' };
      check('recommend Yes: the top Yes confirm posts to the same signed link and records yes, once', tp.status === 200 && ROWS[0].decision === 'yes' && /Got it: Yes, send the standard reply/.test(tp.html), ROWS[0]);
    }
    if (ci === 1) {
      var fe = /<form method="POST" action="([^"]*)"/.exec(pages.edit);
      var te = !fe ? { status: 0, html: '' } : await call(unesc(fe[1]), undefined, {}, 'POST', form({ reply: REPLY.replace('Thanks for getting back to me.', 'Thanks Rowan. Teams can be up to six people.'), postcode: '4217', entity: 'pub', login_email: '' }));
      check('recommend Edit: Save and send from that one form (the top button or the bottom one) records the edited reply and its boxes', te.status === 200 && ROWS[0].decision === 'edit' && /up to six people/.test(ROWS[0].edited_reply || '') && ROWS[0].edited_postcode === '4217', ROWS[0]);
    }
  }
  check('every one of those nine GETs wrote NOTHING (a mail scanner still records nothing)', wroteOnGet.length === 0, wroteOnGet);
  world(); NO_V2 = true;
  r = await call('/autopilot/review/register', Object.assign({}, REVIEW, CASES[0].extra), AP); L = r.body.links || {};
  WRITES = [];
  var gv = await call(pathOf(L.no), undefined, {}, 'GET');
  var tv = topSays(gv.html, 'edit', 'no', L);
  check('before migration 130 (no recommendation kept): the top is Edit, the bottom Edit, Yes, No, nothing written', tv.ok && bottomSays(gv.html, ['edit', 'yes', 'no'], 'no', L).ok && WRITES.length === 0 && !ROWS[0].decision, tv.saw);
  NO_V2 = false;
  // The first tap quiets EVERY submit: on the recommended page there are two. Run the page's own onsubmit.
  var yp = firstHtml.yes0.yes, om = /onsubmit="([^"]*)"/.exec(yp), nsub = (yp.match(/type="submit"/g) || []).length;
  var btns = []; for (var bi = 0; bi < nsub; bi++) btns.push({ disabled: false, textContent: 'x' });
  var ranOk = false;
  try { (new Function(unesc(om ? om[1] : 'throw 1'))).call({ querySelectorAll: function (sel) { return sel === 'button[type=submit]' ? btns : []; } }); ranOk = true; } catch (e) { ranOk = false; }
  check('the page\'s onsubmit, run: both submits on the recommended page go to "Saving..." and off, so a second tap sends nothing', nsub === 2 && ranOk &&
    btns.every(function (b) { return b.disabled === true && b.textContent === 'Saving...'; }), { n: nsub, ran: ranOk, btns: btns });
  check('none of the new pages has an em or en dash, or the word roster', allPages.every(function (h) { return !/[\u2014\u2013]/.test(h) && !/roster/i.test(h); }));

  print('');
  print(bad ? 'FAILED: ' + bad + ' of ' + ran + ' checks failed' : 'ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); print('FAILED: threw'); });
