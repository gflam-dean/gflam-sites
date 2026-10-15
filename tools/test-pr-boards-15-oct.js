/* PUNTERS RECKON: NOBODY BUT THE HOST CAN READ THE ANSWERS BEFORE A NIGHT (15 Oct 2026).

   The boards, answers and all, were a public script (/app/topanswers/ta-boards.js). No phone and no
   TV loaded it, but anybody could fetch it and read every answer before a night. Dean: "Move the
   punters reckon". They now live in the game Worker (PR_BOARDS) and the console asks for them with
   the host's login (GET /host/pr/boards).

   RUNS the shipped code:
     1. the WHOLE game Worker's fetch handler (its router, the new handler, the real verifyHostJwt and
        requireStaff and assertVenueActive), with only the signature maths and the database stubbed;
     2. the console's prLoadBoards / startPR / restorePR lifted out of app/trivia/host.html, against a
        fake Worker that answers with what (1) answered;
     3. the demo page's own inline script (app/topanswers/screen.html), with a fake TV board;
     4. every file the site serves, read for any real board.

   Run from the repo root:  jsc tools/test-pr-boards-15-oct.js
   With -- --reply it also prints the Worker's real reply on a line starting REPLY, for a play-test's fake route. */
load('tools/pr-boards-from-worker.js');
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   -> ' + extra : '')); } }
function drain() { for (var i = 0; i < 30; i++) drainMicrotasks(); }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var BOARDS = prBoardsFromWorker();

/* ---------------------------------------------------------------- 1. the Worker */
print('== the game Worker hands the boards to staff at the venue, and to nobody else ==');
var GAME = readFile('venueplay-backend/worker/venueplay-game.js').replace(/^export default/m, 'var _default =').replace(/^export class/m, 'class');
function FakeURL(u) { var m = /^(https?:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?/.exec(u); this.href = u; this.origin = m[1]; this.pathname = m[2] || '/';
  var q = {}; String(m[3] || '').replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
  this.searchParams = { get: function (k) { return (k in q) ? q[k] : null; }, has: function (k) { return k in q; } }; }
function FakeResponse(body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
var DB = { staff: [], admins: [], venues: [], reads: [] };
/* Only these are stood in for. Declared AFTER the Worker's own, so in this one function scope they
   replace them: the signature maths (jsc has no WebCrypto) and the database. */
var STUBS = '\nasync function verifyJwtHS256(token, secret, env) { var m = /^good:(.+)$/.exec(token); if (!m) throw httpError(401, "Invalid token signature"); return { sub: m[1] }; }\n' +
  'async function sbGet(env, table, q) { return __db(table, q); }\n';
var worker = (new Function('URL', 'Response', '__db', 'console', GAME + STUBS + '\nreturn _default;'))(FakeURL, FakeResponse, function (table, q) {
  DB.reads.push(table + '?' + q);
  function has(col) { var m = new RegExp('(?:^|&)' + col + '=eq\\.([^&]+)').exec(q); return m ? decodeURIComponent(m[1]) : null; }
  if (table === 'vp_venue_staff') return Promise.resolve(DB.staff.filter(function (r) { return r.auth_user_id === has('auth_user_id') && r.venue_id === has('venue_id') && /owner|manager|host/.test(r.role); }));
  if (table === 'vp_platform_admins') return Promise.resolve(DB.admins.filter(function (r) { return r.auth_user_id === has('auth_user_id'); }));
  if (table === 'vp_venues') return Promise.resolve(DB.venues.filter(function (r) { return r.id === has('id'); }));
  return Promise.resolve([]);
}, { log: function () {} });

var VENUE = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
var HOST = '33333333-3333-4333-8333-333333333333', MARKETING = '44444444-4444-4444-8444-444444444444', ADMIN = '55555555-5555-4555-8555-555555555555';
DB.staff = [{ id: 's1', auth_user_id: HOST, venue_id: VENUE, role: 'host' }, { id: 's2', auth_user_id: MARKETING, venue_id: VENUE, role: 'marketing' }];
DB.admins = [{ auth_user_id: ADMIN, role: 'owner' }];
DB.venues = [{ id: VENUE, status: 'active', group_id: null }, { id: OTHER, status: 'active', group_id: null }];

function call(method, path, token) {
  var h = { Origin: 'https://www.venueplay.com.au' }; if (token) h.Authorization = 'Bearer ' + token;
  var req = { method: method, url: 'https://venueplay-game.example.workers.dev' + path, headers: { get: function (k) { return h[k] || null; } } };
  var out = null; worker.fetch(req, { SUPABASE_JWT_SECRET: 'x' }).then(function (r) { out = r; }, function (e) { out = { status: 'threw', body: String(e) }; });
  drain();
  var parsed = null; try { parsed = JSON.parse(out.body); } catch (e) {}
  return { status: out.status, body: out.body || '', json: parsed };
}
function anyAnswer(text) { return BOARDS.some(function (b) { return b.answers.some(function (a) { return text.indexOf('"' + a.a + '"') >= 0 && text.indexOf(b.q) >= 0; }); }); }

var r = call('GET', '/host/pr/boards?venue_id=' + VENUE, null);
ok('no login: 401, and not one answer in the reply', r.status === 401 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
r = call('GET', '/host/pr/boards?venue_id=' + VENUE, 'forged-token');
ok('a token that does not verify: 401, no answers', r.status === 401 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
r = call('GET', '/host/pr/boards?venue_id=' + OTHER, 'good:' + HOST);
ok('a real host asking about ANOTHER venue: 403, no answers', r.status === 403 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
r = call('GET', '/host/pr/boards?venue_id=' + VENUE, 'good:' + MARKETING);
ok('a marketing login at the venue is not a host: 403, no answers', r.status === 403 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
r = call('GET', '/host/pr/boards?venue_id=not-a-uuid', 'good:' + HOST);
ok('a venue id that is not one is refused before the database is asked', r.status === 400 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
DB.reads = [];
var good = call('GET', '/host/pr/boards?venue_id=' + VENUE, 'good:' + HOST);
ok('the venue\'s own host: 200 with every board and its answers', good.status === 200 && good.json && good.json.boards && good.json.boards.length === BOARDS.length &&
   JSON.stringify(good.json.boards) === JSON.stringify(BOARDS), good.status + ' ' + good.body.slice(0, 120));
ok('the staff check asked about the venue in the request', DB.reads.some(function (q) { return /^vp_venue_staff\?/.test(q) && q.indexOf('venue_id=eq.' + VENUE) >= 0 && q.indexOf('auth_user_id=eq.' + HOST) >= 0; }), DB.reads.join(' | '));
ok('one read for the staff row and one for the venue: no table of boards to keep in step', DB.reads.length === 2, DB.reads.join(' | '));
var adm = call('GET', '/host/pr/boards?venue_id=' + VENUE, 'good:' + ADMIN);
ok('an HQ admin using View as gets them too, as for every host route', adm.status === 200 && adm.json && adm.json.boards.length === BOARDS.length, adm.status + ' ' + adm.body.slice(0, 100));
DB.venues[0].status = 'suspended';
r = call('GET', '/host/pr/boards?venue_id=' + VENUE, 'good:' + HOST);
ok('a suspended venue gets none', r.status === 403 && !anyAnswer(r.body), r.status + ' ' + r.body.slice(0, 120));
DB.venues[0].status = 'active';
r = call('POST', '/host/pr/boards?venue_id=' + VENUE, 'good:' + HOST);
ok('only GET is a route', r.status === 404, String(r.status));
ok('there are boards to play, each adding to 100', BOARDS.length >= 30 && BOARDS.every(function (b) { return b.answers.reduce(function (t, a) { return t + a.pts; }, 0) === 100; }), BOARDS.length + ' boards');
if (typeof arguments !== 'undefined' && arguments[0] === '--reply') print('REPLY ' + good.body);   // for a play-test's fake route

/* ---------------------------------------------------------------- 2. the console */
print('== the console gets its boards from the Worker, with the host\'s login ==');
var TH = readFile('venueplay/app/trivia/host.html');
ok('the console no longer loads a script of boards', !/ta-boards\.js"><\/script>/.test(TH) && !/<script[^>]+ta-boards/.test(TH));
function consoleRig(workerReply) {
  var S = { fetches: [], errors: [], sessions: 0, games: [], ls: {}, sent: [] };
  S.G = { venueId: VENUE, sessionId: 'sess-1', roundType: 'pr' };
  var code = lift(TH, 'readApi', 'host.html') + lift(TH, 'prLoadBoards', 'host.html') + lift(TH, 'startPR', 'host.html') + lift(TH, 'restorePR', 'host.html') +
    'return { prLoadBoards: prLoadBoards, startPR: startPR, restorePR: restorePR };';
  var win = { PRGame: { NAME: 'Punters Reckon', Game: function (o) { S.games.push(o); this.boards = (o && o.boards) || []; this.load = function () {}; this.replay = function () { return null; }; } } };
  var fns = (new Function('G', 'window', 'VP_GAME_API', 'getToken', 'fetch', 'openSession', 'hostError', 'localStorage', '$', 'document', 'renderConsole', 'bcast', 'send', 'savePRNight', 'clearPRNight', 'prNightKey', 'prKey', 'openGameChannel', 'TRIVIA_SAVE_MAX_AGE', 'AbortController', 'setTimeout', 'clearTimeout', code))(
    S.G, win, 'https://game.example', function () { return Promise.resolve('host-token'); },
    function (url, opts) { S.fetches.push({ url: url, auth: opts && opts.headers && opts.headers.Authorization });
      if (/\/snapshot\?/.test(url)) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ session_id: 'sess-1', join_code: 'ABC123', status: 'running' }); } });
      var w = workerReply(); return Promise.resolve({ ok: w.status === 200, status: w.status, json: function () { return Promise.resolve(JSON.parse(w.body)); } }); },
    function () { S.sessions++; return Promise.resolve(); }, function (m) { S.errors.push(m); },
    { getItem: function (k) { return (k in S.ls) ? S.ls[k] : null; }, setItem: function (k, v) { S.ls[k] = String(v); }, removeItem: function (k) { delete S.ls[k]; } },
    function () { return { classList: { remove: function () {}, toggle: function () {} }, textContent: '', disabled: false }; }, { querySelectorAll: function () { return []; } },
    function () {}, function (m) { S.sent.push(m); }, function (m) { S.sent.push(m); }, function () {}, function () { S.cleared = true; },
    function () { return 'vpPRNight-' + VENUE; }, function () { return 'vpPR:sess-1'; }, function () {}, 12 * 3600 * 1000,
    undefined, function (f) { return 0; }, function () {});
  S.fns = fns; return S;
}
var S = consoleRig(function () { return good; });
S.fns.startPR(); drain();
ok('startPR asks /host/pr/boards for this venue, with the host\'s login', S.fetches.length === 1 && S.fetches[0].url === 'https://game.example/host/pr/boards?venue_id=' + VENUE && S.fetches[0].auth === 'Bearer host-token', JSON.stringify(S.fetches));
ok('and the referee is built with exactly the boards the Worker sent', S.games.length === 1 && JSON.stringify(S.games[0].boards) === JSON.stringify(BOARDS) && S.sessions === 1, S.games.length + ' games, ' + S.sessions + ' sessions');
ok('nothing the console broadcast carries a board\'s answers', !anyAnswer(JSON.stringify(S.sent)), JSON.stringify(S.sent).slice(0, 200));
S.fns.prLoadBoards(); drain();
ok('the boards are asked for once a night, not on every board', S.fetches.length === 1, S.fetches.length + ' fetches');

var refused = { status: 403, body: JSON.stringify({ error: 'Not authorised: you are not staff at this venue' }) };
S = consoleRig(function () { return refused; });
S.fns.startPR(); drain();
ok('boards refused: the host is told why, and no night is opened for a game that cannot be played', S.sessions === 0 && S.games.length === 0 && S.errors.length === 1 && /not staff/.test(S.errors[0]), JSON.stringify(S.errors) + ' sessions ' + S.sessions);

print('== a console reloaded mid-night gets its boards back, or says it could not ==');
S = consoleRig(function () { return good; });
S.ls['vpPRNight-' + VENUE] = JSON.stringify({ v: 1, ts: Date.now(), sessionId: 'sess-1' });
var back = null; S.fns.restorePR().then(function (v) { back = v; }); drain();
ok('the night comes back, with the Worker\'s boards', back === true && S.games.length === 1 && JSON.stringify(S.games[0].boards) === JSON.stringify(BOARDS), String(back) + ' ' + S.games.length);
S = consoleRig(function () { return refused; });
S.ls['vpPRNight-' + VENUE] = JSON.stringify({ v: 1, ts: Date.now(), sessionId: 'sess-1' });
back = null; S.fns.restorePR().then(function (v) { back = v; }); drain();
ok('boards refused on reload: not restored, the host is told, and the night is KEPT for the next reload', back === false && S.games.length === 0 && S.errors.length === 1 && !S.cleared && !!S.ls['vpPRNight-' + VENUE], String(back) + ' ' + JSON.stringify(S.errors) + ' cleared=' + !!S.cleared);

/* ---------------------------------------------------------------- 3. the demo page */
print('== the public demo page plays its own demo board, not a real one ==');
var SH = readFile('venueplay/app/topanswers/screen.html');
ok('the demo page loads no script of boards', !/ta-boards/.test(SH.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
var inline = /<script>\s*([\s\S]*?)<\/script>/.exec(SH)[1];
var tvMsgs = [], timers = [];
var dw = {}; (new Function('window', readFile('venueplay/app/topanswers/ta-match.js')))(dw);
(new Function('window', readFile('venueplay/app/topanswers/pr-game.js')))(dw);
dw.PRBoard = { mount: function () { return { onMsg: function (m) { tvMsgs.push(JSON.parse(JSON.stringify(m))); } }; } };
(new Function('window', 'document', 'location', 'setTimeout', inline))(dw, { getElementById: function () { return {}; } }, { search: '?demo=1' },
  function (f, ms) { timers.push([ms, f]); });
timers.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (t) { t[1](); });
var demoBoard = tvMsgs[0] || {}, reveals = tvMsgs.filter(function (m) { return m.t === 'ta_reveal'; }), shown = tvMsgs.filter(function (m) { return m.t === 'ta_showall'; })[0];
ok('?demo=1 plays a whole board: the board, finds as they come, and the rest at the end', demoBoard.t === 'ta_board' && reveals.length === 5 && shown && shown.rest.length === 2,
   tvMsgs.map(function (m) { return m.t + (m.a ? ':' + m.a : ''); }).join(' '));
ok('the demo board is in no night\'s set', !BOARDS.some(function (b) { return b.q === demoBoard.q; }), demoBoard.q);

/* ---------------------------------------------------------------- 4. what a stranger can fetch */
print('== nothing the site serves holds a real board ==');
/* jsc cannot list a folder, so: the pages that make up a night, and every script each one loads.
   (The by-play test also fetched the served JS as a stranger would.) */
var served = ['venueplay/app/trivia/host.html', 'venueplay/app/trivia/play.html', 'venueplay/app/trivia/screen.html', 'venueplay/tv.html',
  'venueplay/app/topanswers/screen.html', 'venueplay/app/topanswers/ta-match.js', 'venueplay/app/topanswers/pr-game.js',
  'venueplay/app/topanswers/pr-board.js', 'venueplay/app/topanswers/pr-phone.js'];
['venueplay/app/trivia/host.html', 'venueplay/app/trivia/play.html', 'venueplay/app/trivia/screen.html', 'venueplay/tv.html', 'venueplay/app/topanswers/screen.html'].forEach(function (p) {
  var re = /<script[^>]+src="\/([^"?]+\.js)/g, m, t = readFile(p);
  while ((m = re.exec(t))) { if (served.indexOf('venueplay/' + m[1]) < 0) served.push('venueplay/' + m[1]); }
});
var leaks = [], missing = [];
served.forEach(function (p) {
  var t; try { t = readFile(p); } catch (e) { missing.push(p); return; }
  BOARDS.forEach(function (b) {
    var answers = b.answers.filter(function (a) { return t.indexOf('"' + a.a + '", pts: ' + a.pts) >= 0 || t.indexOf('"a":"' + a.a + '","pts":' + a.pts) >= 0; }).length;
    if (t.indexOf(b.q) >= 0 || answers >= 3) leaks.push(p + ': ' + b.id);
  });
});
ok('read ' + served.length + ' served files: no real board\'s question or answers in any', !leaks.length && served.length >= 12, leaks.slice(0, 6).join(', '));
/* Absent, or a stub with no board in it: a stale Cloudflare copy of the old file outlived two full purges
   (15 Oct 2026), so the path now serves a note that replaces it on the next revalidation. */
var gone = true; try { var _o = readFile('venueplay/app/topanswers/ta-boards.js'); gone = !_o || (!/pts\s*:/.test(_o) && !/\bq\s*:/.test(_o)); } catch (e) { gone = true; }
ok('/app/topanswers/ta-boards.js is no longer served', gone);
/* PartyPlay's family boards (22 of them are these boards too) are checked the same way in
   partyplay-backend/lib/pp-gm-boards.test.js. */

print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' punters reckon board checks failed');
