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
var ROWS = [], WRITES = [], FAILDB = false, STALE = 0;   // STALE = n: the next n reads see the row before the other tap landed
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
  if (method === 'GET') {
    var rows = ROWS.filter(function (r) { return match(r, q); });
    rows.sort(function (a, b) { return String(a.decided_at) < String(b.decided_at) ? -1 : 1; });
    var off = parseInt(q.offset || '0', 10), lim = Math.min(parseInt(q.limit || '1000', 10), 1000);
    var out = JSON.parse(JSON.stringify(rows.slice(off, off + lim)));
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
function world() { ROWS = []; WRITES = []; FAILDB = false; NOW = Date.parse('2026-10-29T08:00:00Z'); ENV.PROSPECT_AUTOPILOT_KEY = KEY; }
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
  check('Yes page: one big "Yes, send it" button that POSTs back to the same signed link', /<form method="POST" action="\/autopilot\/review\?f=2026-10-29-test-charlie-hotel&amp;a=yes&amp;r=1&amp;x=\d+&amp;t=[0-9a-f]{32}"/.test(g.html) && />Yes, send it<\/button>/.test(g.html));
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
  check('a question: the Yes page says to Edit and answer it, or the yes will be held', /does not answer/.test(g.html) && /will be held/.test(g.html));
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
  check('Yes: "Got it", recorded yes with the time and the phone', p1.status === 200 && /Got it: Yes, send it/.test(p1.html) && ROWS[0].decision === 'yes' && !!ROWS[0].decided_at && ROWS[0].decided_agent === 'iPhone Safari', p1.html.slice(-500));
  check('the done page says the Mac picks it up within 5 minutes', /picks it up within 5 minutes/.test(p1.html));
  var at = ROWS[0].decided_at; NOW += 60000;
  var p2 = await call(pathOf(L.yes), undefined, {}, 'POST', '');
  check('a second tap on Yes: same "Got it" page, nothing changed', p2.status === 200 && ROWS[0].decided_at === at && ROWS[0].decision === 'yes');
  var p3 = await call(pathOf(L.no), undefined, {}, 'POST', form({ reason: 'changed my mind' }));
  check('No after Yes: "You already chose: Yes", still yes, no reason written', /You already chose: Yes, send it/.test(p3.html) && ROWS[0].decision === 'yes' && !ROWS[0].reason, p3.html.slice(-500));
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

  section('9. NO: the reason is kept');
  world();
  r = await call('/autopilot/review/register', REVIEW, AP); L = r.body.links;
  var n1 = await call(pathOf(L.no), undefined, {}, 'POST', form({ reason: 'They are a restaurant, not a pub' }));
  check('No: recorded no with the reason', n1.status === 200 && ROWS[0].decision === 'no' && ROWS[0].reason === 'They are a restaurant, not a pub' && /Got it: No, do not send/.test(n1.html), ROWS[0]);

  print('');
  print(bad ? 'FAILED: ' + bad + ' of ' + ran + ' checks failed' : 'ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); print('FAILED: threw'); });
