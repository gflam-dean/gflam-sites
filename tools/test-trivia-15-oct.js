/* TRIVIA, THE FAULTS THE 14 OCT 2026 AUDIT FOUND BY PLAYING. Each one is RUN from the shipped file:
   the real function is lifted out of the page (or the real Worker is driven on the rig) and given
   stubs, never grepped for a word.

     1. the JOIN NOW card, the VenuePlay corner and the venue's logo sat over the wall (vp-fit keep-outs)
     2. a console reloaded mid-question had an empty Leaderboard panel; a healed phone showed
        "CORRECT! 0" and an old total; a re-joined phone said "NO ANSWER" for a question it answered
     3. a bingo phone's join counted as a trivia team; two teams with one name were indistinguishable
     4. lobby text, "You're back in" to a new joiner, YOUR OWN miscount, two identical theme chips,
        a paper score above the round quietly cut, "Not a trivia game" to a stranger, the podium
        dropped to the ads by "Start a new round", and paper carried into every later round

   Run: jsc tools/test-trivia-15-oct.js   (from the repo root) */
load('tools/rig-game-worker.js');   // the REAL Worker, network swapped for a fake PostgREST; gives show/ran/bad

function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
function liftAll(text, names, label) { return names.map(function (n) { return lift(text, n, label); }).join('\n'); }
async function flush() { for (var i = 0; i < 30; i++) await null; }

var FIT = readFile('venueplay/app/vp-fit.js');
var SCREEN = readFile('venueplay/app/trivia/screen.html');
var HOSTP = readFile('venueplay/app/trivia/host.html');
var PLAY = readFile('venueplay/app/trivia/play.html');
var BUILDER = readFile('venueplay/app/trivia/builder.html');

/* A tiny DOM: elements by id, made on first ask. */
function makeDom() {
  var els = {};
  function mk(id) {
    var cls = {};
    return { id: id, textContent: '', innerHTML: '', value: '', style: {}, hidden: false, checked: false, disabled: false,
      classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; },
                   toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = 1; else delete cls[c]; } },
      appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, removeAttribute: function () {}, getAttribute: function () { return null; } };
  }
  return { $: function (id) { return els[id] || (els[id] = mk(id)); }, els: els };
}

(async function () {

/* ======================================================================================= 1 */
print('\n== 1. nothing on the wall sits under the JOIN NOW card, the corner mark or the logo ==');
(function () {
  var w = {};
  eval(lift(FIT, 'solveFit', 'vp-fit.js'));
  // 1920x1080. The card: x 38-318, y 899-1042. The corner: x 1745-1874, y 38-102.
  var JOIN = { l: 38, t: 899, r: 318, b: 1042 }, CORNER = { l: 1745, t: 38, r: 1874, b: 102 };
  function hits(rects, fit) {
    var n = 0;
    rects.forEach(function (c) {
      var o = { l: 960 + fit.s * (c.l - 960), r: 960 + fit.s * (c.r - 960), t: 540 + fit.s * (c.t - 540) + fit.ty, b: 540 + fit.s * (c.b - 540) + fit.ty };
      [JOIN, CORNER].forEach(function (a) { if (o.l < a.r && o.r > a.l && o.t < a.b && o.b > a.t) n++; });
      if (o.t < 0 || o.b > 1080) n++;
    });
    return n;
  }
  // The reveal at 1920x1080 as measured on 14 Oct: the 5-row board ran to y 1010, columns 335-1585.
  var reveal = [{ l: 700, t: 90, r: 1220, b: 125 }, { l: 176, t: 160, r: 1745, b: 425 }, { l: 335, t: 470, r: 1585, b: 1010 }];
  ok0 = solveFit(reveal, [JOIN, CORNER], 1920, 1080, 960, 540, 1, 12, 15);
  show('the reveal board is moved and scaled clear of the card (it ran under it at 1920x1080)', hits(reveal, ok0) === 0, JSON.stringify(ok0));
  show('control: the same board with no keep-outs is left at full size', JSON.stringify(solveFit(reveal, [], 1920, 1080, 960, 540, 1, 12, 15)) === '{"s":1,"ty":0}');
  show('and it is not shrunk further than it needs to be (no smaller than 0.85)', ok0.s >= 0.85, String(ok0.s));
  // A two-line question at 1600x900-in-1920 terms: the wide line runs under the corner mark.
  var q = [{ l: 860, t: 20, r: 1060, b: 40 }, { l: 150, t: 60, r: 1770, b: 150 }, { l: 220, t: 200, r: 1700, b: 820 }, { l: 760, t: 860, r: 1160, b: 1060 }];
  var fq = solveFit(q, [JOIN, CORNER], 1920, 1080, 960, 540, 1, 12, 15);
  show('a two-line question is kept out from under the VenuePlay corner and on the screen', hits(q, fq) === 0, JSON.stringify(fq));
  // Something narrow in the middle shares no columns with either corner, so nothing moves.
  var mid = [{ l: 800, t: 300, r: 1120, b: 900 }];
  show('a wall that shares no columns with a corner is not touched', JSON.stringify(solveFit(mid, [JOIN, CORNER], 1920, 1080, 960, 540, 1, 12, 15)) === '{"s":1,"ty":0}');
})();
var ok0;
(function () {
  show('the JOIN NOW card is marked as a keep-out', /<div class="tv-join hidden" id="tvJoinCorner" data-fit-avoid>/.test(SCREEN));
  show('so is the VenuePlay corner, by what its children paint', /<div class="tv-corner" data-fit-avoid="kids">/.test(SCREEN));
  // The logo is created at run time: run the real paintVenueLogo and look at what it made.
  var made = null, document = { getElementById: function () { return null; },
    createElement: function () { made = { style: {}, attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } }; return made; },
    body: { appendChild: function () {} } };
  eval(lift(SCREEN, 'paintVenueLogo', 'trivia/screen.html'));
  paintVenueLogo('/logos/x.png');
  show('the venue logo the screen paints is marked as a keep-out', made && made.attrs['data-fit-avoid'] === '', made && JSON.stringify(made.attrs));
  show('Punters Reckon (a full-wall board) stops above the card instead', /#tvPR\{bottom:calc\(4\.6cqw \+ clamp\(44px,8cqw,110px\) \+ 2px\)\}/.test(SCREEN) && /id="tvPR" data-fit-self/.test(SCREEN));
  show('vp-fit only fits a data-fit-self layer to the screen', /layer\.hasAttribute\("data-fit-self"\) \? \[\] : avoidRects\(\)/.test(FIT));
})();

/* ======================================================================================= 2 */
print('\n== 2. the console refills its board mid-question; the phone believes the server ==');
await (async function () {
  var calls = [], G = { gameId: 'g1', board: [] }, painted = 0;
  function apiPost(path, body) { calls.push(path); return Promise.resolve({ leaderboard: [{ name: 'A', points: 300 }] }); }
  function renderBoard() { painted++; }
  eval(lift(HOSTP, 'readBoard', 'trivia/host.html'));
  readBoard(); await flush();
  show('a mid-question reload reads the board from /host/trivia/board, NOT /host/reveal', calls.join() === '/host/trivia/board', calls.join());
  show('and paints it', G.board.length === 1 && painted === 1);
  // and restoreTrivia's "asking" branch is what calls it
  var called = 0, sent = [];
  var G2 = { venueId: 'v', questionCount: 0, qtotal: 0, board: [] };
  // The snapshot half of the restore (restoreTriviaFrom since 20 Oct 2026: the same restore, whether the
  // pointer came from this tablet's save or from a pickup on another device).
  var src = lift(HOSTP, 'restoreTriviaFrom', 'trivia/host.html');
  var snap = { status: 'running', session_id: 's', join_code: 'ACDEFG', game: { format: 'trivia', game_id: 'g1', phase: 'asking', question_count: 10,
    question: { qseq: 3, qi: 3, text: 'Q', options: ['a', 'b', 'c', 'd'], ends_at: new Date(NOWMS + 20000).toISOString() } } };
  var f = new Function('G', 'localStorage', 'fetch', 'readBoard', 'send', 'openGameChannel', 'loadPaperRound', 'isDouble', 'remainingSecs', 'setInterval',
    'updateLive', 'clearTick', 'rebuildBoard', '$', 'renderConsole', 'clearTrivia', 'triviaKey', 'TRIVIA_SAVE_MAX_AGE', 'VP_GAME_API',
    src + '; var saveTrivia = function () {}; return restoreTriviaFrom({ v: 1, ts: NOWMS, sessionId: "s" });');
  var p = f(G2, { getItem: function () { return JSON.stringify({ v: 1, ts: NOWMS, sessionId: 's' }); } },
    function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(snap); } }); },
    function () { called++; }, function (o) { sent.push(o.t); }, function () {}, function () {}, function () { return false; }, function () { return 20; },
    function () { return 0; }, function () {}, function () {}, function () {}, function () { return { textContent: '' }; }, function () {}, function () {},
    function () { return 'k'; }, 6 * 3600 * 1000, 'https://x');
  await p; await flush();
  show('restoreTrivia asks for the board when it recovers an open question', called === 1 && sent.indexOf('question') >= 0, called + ' ' + sent.join(','));
})();

function phone(opts) {
  var dom = makeDom(), P = { gameId: 'g1', choice: opts.choice, q: { qseq: 3, options: ['a', 'b', 'c', 'd'], restored: !!opts.restored }, total: opts.total || 0, rank: 0, playersCount: 0, token: 'tok' };
  dom.$('vRes').classList.add('hidden');
  var gets = 0, rejoins = 0, urls = [];
  function playerGet(url) {
    gets++; urls.push(url);
    var r = opts.replies[gets - 1];
    if (r && r.status) { var e = new Error('x'); e.status = r.status; P.token = ''; return Promise.reject(e); }
    return Promise.resolve(r);
  }
  function rejoinNow() { rejoins++; P.token = 'tok2'; return Promise.resolve(); }
  var src = liftAll(PLAY, ['showResult', 'rankText', 'ordinal'], 'trivia/play.html');
  var f = new Function('P', '$', 'show', 'stopCd', 'esc', 'LETTERS', 'playerGet', 'rejoinNow', 'setTimeout',
    src + '; return showResult;');
  var showResult = f(P, dom.$, function (v) { dom.$(v).classList.remove('hidden'); }, function () {}, function (s) { return String(s); }, ['A', 'B', 'C', 'D'],
    playerGet, rejoinNow, function (fn) { fn(); });
  return { run: function (m) { showResult(m); }, dom: dom, P: P, urls: urls, gets: function () { return gets; }, rejoins: function () { return rejoins; } };
}
await (async function () {
  var reveal = { t: 'reveal', qseq: 3, correctIndex: 1, options: ['a', 'b', 'c', 'd'] };
  // a. healed token: the first read is a 401, the heal runs, the second read has the server's numbers
  var a = phone({ choice: 1, total: 290, replies: [{ status: 401 }, { total: 580, rank: 2, players_count: 3, last: { answered: true, is_correct: true, points_awarded: 290, qseq: 3 } }] });
  a.run(reveal); await flush();
  var d = a.dom.$;
  show('a 401 is healed and the score asked again with the new token', a.rejoins() === 1 && a.gets() === 2, a.rejoins() + ' ' + a.gets());
  show('the card shows the server\'s +290, 580 and 2nd of 3 (it said CORRECT! 0, 290, 3rd of 3)',
       d('pResTag').textContent === 'Correct!' && d('pResPts').textContent === '+290' && d('pResTot').textContent === 580 && d('pResRank').textContent === '2nd of 3',
       [d('pResTag').textContent, d('pResPts').textContent, d('pResTot').textContent, d('pResRank').textContent].join(' | '));
  // b. never reached the server at all: no number rather than a wrong 0
  var b = phone({ choice: 1, total: 290, replies: [{ status: 401 }, { status: 401 }] });
  b.run(reveal); await flush();
  show('if the server cannot be asked, a right answer shows no points rather than "+0"', b.dom.$('pResPts').textContent === '' && b.dom.$('pResTag').textContent === 'Correct!', b.dom.$('pResPts').textContent);
  // c. re-joined phone with no local note: the server says its last answer IS this question
  var c = phone({ choice: null, restored: true, replies: [{ total: 290, rank: 1, players_count: 2, last: { answered: true, answer_index: 1, is_correct: true, points_awarded: 290, qseq: 3 } }] });
  c.run(reveal); await flush();
  show('a re-joined phone that answered this question is told so, not "NO ANSWER"', c.dom.$('pResTag').textContent === 'Correct!' && c.dom.$('pResPts').textContent === '+290', c.dom.$('pResTag').textContent + ' ' + c.dom.$('pResPts').textContent);
  // d. control: its last answer was an EARLIER question, so this one really was not answered
  show('   it asked for its last answer (no last=0) because it came back into the question', c.urls.length === 1 && c.urls[0].indexOf('last=0') < 0, c.urls.join());
  var e = phone({ choice: null, restored: true, replies: [{ total: 290, rank: 1, players_count: 2, last: { answered: true, answer_index: 1, is_correct: true, points_awarded: 290, qseq: 2 } }] });
  e.run(reveal); await flush();
  show('control: an earlier question\'s answer is not passed off as this one', e.dom.$('pResTag').textContent === 'No answer' && e.dom.$('pResPts').textContent === '0', e.dom.$('pResTag').textContent);
  // what makes a phone "came back into it": the real renderQuestion marks P.q
  var rq = (function () {
    var dom = makeDom(), P = { colour: true };
    var f = new Function('P', '$', 'el', 'esc', 'LETTERS', 'stopCd', 'useGame', 'show', 'loadAns', 'paintPicked', 'tickCd', 'setInterval', 'document',
      lift(PLAY, 'renderQuestion', 'trivia/play.html') + '; return renderQuestion;');
    var r = f(P, dom.$, function () { return dom.$('x' + Math.random()); }, String, ['A', 'B', 'C', 'D'], function () {}, function () {}, function () {},
      function () { return null; }, function () {}, function () {}, function () { return 0; }, { createElement: function () { return dom.$('dp'); } });
    return function (m) { r(m); return P.q.restored; };
  })();
  show('   a question from a snapshot or a replay aimed at the phone is "came back"; a live one is not',
       rq({ qseq: 3, options: ['a'], ends_at: new Date(NOWMS + 9000).toISOString() }) === true && rq({ qseq: 3, options: ['a'], endsAt: NOWMS + 9000, to: 'p1' }) === true &&
       rq({ qseq: 3, options: ['a'], endsAt: NOWMS + 9000 }) === false);
  var live = phone({ choice: null, replies: [{ total: 0, rank: 2, players_count: 2, last: { answered: false } }] });
  live.run(reveal); await flush();
  show('   and a phone that watched the question live and did not tap still skips the lookup (last=0)', live.urls.length === 1 && /&last=0$/.test(live.urls[0]) && live.dom.$('pResTag').textContent === 'No answer', live.urls.join());
})();

/* ======================================================================================= 3 */
print('\n== 3. only trivia phones are trivia teams, and two of one name are told apart ==');
(function () {
  var G = { players: {}, order: [], status: 'lobby', roundType: 'trivia' }, gs = [], bc = [];
  var f = new Function('G', 'gsend', 'send', 'bcast', 'renderJoinCounts', 'playerCount', '$',
    liftAll(HOSTP, ['onMsg', 'uniqueTeamName'], 'trivia/host.html') + '; return onMsg;');
  var onMsg = f(G, function (o) { gs.push(o); }, function () {}, function (o) { bc.push(o); }, function () {}, function () { return G.order.length; },
    function () { return { classList: { add: function () {} }, textContent: '' }; });
  onMsg({ t: 'join', pid: 'bingo1', name: 'Bingo Betty', cards: 1 });
  show('a bingo phone answering the rollcall is not a trivia team', G.order.length === 0, G.order.join());
  onMsg({ t: 'join', pid: 'm1', name: 'Hummers' });
  show('nor is an untagged join from another page', G.order.length === 0);
  onMsg({ t: 'join', pid: 'p1', name: 'Quiz Kids', fmt: 'trivia' });
  show('control: a trivia phone is', G.order.length === 1 && G.players.p1.name === 'Quiz Kids');
  onMsg({ t: 'join', pid: 'p2', name: 'quiz kids', fmt: 'trivia' });
  show('a second "Quiz Kids" (any capitals) is "quiz kids 2" on the console', G.players.p2.name === 'quiz kids 2', G.players.p2.name);
  var rn = gs.filter(function (o) { return o.t === 'rename'; });
  show('and that phone, and only that phone, is told its name', rn.length === 1 && rn[0].to === 'p2' && rn[0].name === 'quiz kids 2', JSON.stringify(rn));
  gs = [];
  onMsg({ t: 'join', pid: 'p1', name: 'Quiz Kids', fmt: 'trivia' });
  show('the first one re-announcing keeps its name and is not renamed', G.players.p1.name === 'Quiz Kids' && gs.filter(function (o) { return o.t === 'rename'; }).length === 0);
  onMsg({ t: 'join', pid: 'p2', name: 'quiz kids 2', fmt: 'trivia' });
  show('the renamed phone coming back under its new name stays as it is', G.players.p2.name === 'quiz kids 2' && G.order.length === 2);
})();
await (async function () {
  // The phone: its join is tagged, and a rename re-registers it under the new name on the SAME device id.
  var sent = [], posts = [], dom = makeDom(), P = { pid: 'p2', name: 'Quiz Kids', room: 'ACDEFG', joined: true, token: 't1' }, AR = { hash: 'h' }, saved = {};
  dom.$('vWait');
  var f = new Function('P', 'AR', '$', 'send', 'playerPost', 'deviceId', 'saveName', 'saveToken', 'ansHash', 'window',
    liftAll(PLAY, ['announce', 'takeName', 'onMsg'], 'trivia/play.html') + '; return { announce: announce, onMsg: onMsg };');
  var api = f(P, AR, dom.$, function (o) { sent.push(o); }, function (path, body) { posts.push([path, body]); return Promise.resolve({ token: 't2' }); },
    function () { return 'dev-123456'; }, function (r, n) { saved.name = n; }, function (r, t) { saved.token = t; }, function () {}, { location: { search: '' } });
  api.announce();
  show('a trivia phone\'s join says fmt:"trivia"', sent[0] && sent[0].t === 'join' && sent[0].fmt === 'trivia', JSON.stringify(sent[0]));
  sent = [];
  api.onMsg({ t: 'rename', to: 'someone-else', name: 'Nope' });
  show('a rename aimed at another phone is ignored', P.name === 'Quiz Kids' && posts.length === 0);
  api.onMsg({ t: 'rename', to: 'p2', name: 'Quiz Kids 2' });
  await flush();
  show('its own rename is taken, saved and re-registered with /join on the same device id',
       P.name === 'Quiz Kids 2' && saved.name === 'Quiz Kids 2' && posts.length === 1 && posts[0][0] === '/join' && posts[0][1].name === 'Quiz Kids 2' && posts[0][1].pid === 'dev-123456',
       JSON.stringify(posts));
  show('the fresh token is kept and the phone re-announces under the new name', P.token === 't2' && saved.token === 't2' && sent.length === 1 && sent[0].name === 'Quiz Kids 2' && sent[0].fmt === 'trivia');
})();

/* ======================================================================================= 4 */
print('\n== 4. the smaller ones ==');
(function () {
  // a. lobby text
  var G = { status: 'lobby', order: ['a', 'b', 'c'] }, el = { style: {}, textContent: '' };
  var f = new Function('G', '$', 'playerCount', lift(HOSTP, 'paintLobbyWait', 'trivia/host.html') + '; return paintLobbyWait;');
  var paint = f(G, function () { return el; }, function () { return G.order.length; });
  paint(3);
  show('a. with the names already listed it no longer says "they pick a team name when you start"', !/pick a team name/.test(el.textContent) && /3 phones have scanned in/.test(el.textContent), el.textContent);
})();
await (async function () {
  // b. a brand-new joiner is "in", not "back in", and gets no "1st of 1"
  var dom = makeDom(), msgs = [], P = { joined: true, gameId: 'g1', q: null, ended: false, total: 0, rank: 0, pendingScore: true, name: 'New' };
  var f = new Function('P', '$', 'show', 'playerGet', 'renderQuestion', 'stopCd', 'lockOut', 'refreshTotals',
    liftAll(PLAY, ['applyPending', 'pullScore', 'showWait', 'rankText', 'ordinal'], 'trivia/play.html') + '; return applyPending;');
  var applyPending = f(P, dom.$, function () {}, function () { return Promise.resolve({ total: 0, rank: 1, players_count: 1 }); }, function () {}, function () {}, function () {}, function () {});
  applyPending(true); await flush();
  show('b. a phone that has just typed its name is told "You’re in", not "You\'re back in"', /^You’re in\./.test(dom.$('waitMsg').textContent), dom.$('waitMsg').textContent);
  show('   and is not told "1st of 1" before it has scored', dom.$('waitRank').classList.contains('hidden') && dom.$('waitScore').classList.contains('hidden'));
  P.pendingScore = true; applyPending(); await flush();
  show('   control: a phone coming back IS "back in"', /back in/.test(dom.$('waitMsg').textContent));
  P.pendingScore = true; P.total = 0; f(P, dom.$, function () {}, function () { return Promise.resolve({ total: 450, rank: 2, players_count: 5 }); }, function () {}, function () {}, function () {}, function () {})();
  await flush();
  show('   and a phone with points still sees its place', !dom.$('waitRank').classList.contains('hidden') && dom.$('waitRank').textContent === '2nd of 5', dom.$('waitRank').textContent);
})();
(function () {
  // c. YOUR OWN counts what the server says the host wrote
  var dom = makeDom(), G = { questions: [{ own: true }, { own: false, category: 'Movies & TV' }, { own: false, category: 'World History' }], libraryTitles: { 'Film & TV': true }, title: 'N', setId: 's' };
  dom.$('runBtn').style = {};
  var f = new Function('G', '$', lift(BUILDER, 'renderReady', 'trivia/builder.html') + '; return renderReady;');
  f(G, dom.$)();
  show('c. one written, two from the library: YOUR OWN 1 (it said 3)', dom.$('sumOwn').textContent === 1, String(dom.$('sumOwn').textContent));
  G.questions = [{ category: 'Movies & TV' }, { category: 'Film & TV' }];
  f(G, dom.$)();
  show('   an older Worker that sends no "own" falls back to the old guess', dom.$('sumOwn').textContent === 1, String(dom.$('sumOwn').textContent));
  // d. one chip per library title
  var themes = (new Function(lift(BUILDER, 'libraryThemes', 'trivia/builder.html') + '; return libraryThemes;'))()(
    [{ title: 'General Knowledge', question_count: 477 }, { title: 'General Knowledge', question_count: 1158 }, { title: 'Geography', question_count: 2720 }]);
  show('d. two "General Knowledge" library sets are one theme with 1,635 questions', themes.length === 2 && themes[0].title === 'General Knowledge' && themes[0].question_count === 1635, JSON.stringify(themes));
  show('   and the chips and category list are built from the merged list', /var rows=libraryThemes\(\(r&&r\.data\)\|\|\[\]\)/.test(BUILDER));
  // e. the console stops a score the round cannot hold
  var pp = (new Function(lift(HOSTP, 'paperScoreProblem', 'trivia/host.html') + '; return paperScoreProblem;'))();
  show('e. "9 right" on a 5-question round is stopped with words for the host', /9 right, but this round had 5 questions/.test(pp([{ no: 1, name: 'Oldies', correct: 9, double: 0 }], 5, 0)));
  show('   more doubled than right is stopped', /more right in the double points/.test(pp([{ no: 2, name: '', correct: 1, double: 2 }], 5, 5)));
  show('   control: 4 of 5, and a blank (no sheet), are fine', pp([{ no: 1, name: 'A', correct: 4, double: 0 }, { no: 2, name: 'B', correct: '', double: 0 }], 5, 0) === '');
})();
await (async function () {
  // g. "Start a new round" after the podium does not send the wall to the ads; the next lobby takes it
  var G = { status: 'ended', gameId: 'g1', pr: null }, bc = [], sent = [], timers = [];
  var f = new Function('G', 'bcast', 'send', 'clearTick', 'clearTrivia', 'renderConsole', 'apiPost', 'hostError', 'setTimeout', 'clearTimeout',
    'var PODIUM_HOLD_MS=600000;\n' + liftAll(HOSTP, ['holdPodium', 'releasePodium', 'endRound'], 'trivia/host.html') + '; return { endRound: endRound, releasePodium: releasePodium };');
  var api = f(G, function (o) { bc.push(o.t); }, function (o) { sent.push(o); }, function () {}, function () {}, function () {},
    function () { return Promise.resolve({}); }, function () {}, function (fn, ms) { timers.push([fn, ms]); return timers.length; }, function () {});
  api.endRound();
  show('g. "Start a new round" after the podium sends no idle (idle is /tv\'s "back to the ads")', bc.indexOf('idle') < 0, bc.join());
  api.releasePodium();
  show('   opening the next lobby puts the trivia wall on it, on the pairing channel only', sent.length === 1 && sent[0].t === 'state' && sent[0].phase === 'lobby' && bc.indexOf('state') < 0, JSON.stringify(sent));
  var G2 = { status: 'question', gameId: 'g1', pr: null }; bc = [];
  f(G2, function (o) { bc.push(o.t); }, function () {}, function () {}, function () {}, function () {}, function () { return Promise.resolve({}); }, function () {}, function () { return 0; }, function () {}).endRound();
  show('   control: ending mid-round still sends idle', bc.indexOf('idle') >= 0);
  var G3 = { status: 'ended', gameId: 'g1', pr: null }; bc = []; timers = [];
  var api3 = f(G3, function (o) { bc.push(o.t); }, function () {}, function () {}, function () {}, function () {}, function () { return Promise.resolve({}); }, function () {}, function (fn, ms) { timers.push([fn, ms]); return 1; }, function () {});
  api3.endRound(); timers[0][0]();
  show('   and if no lobby follows, the ads come back after the hold (' + (timers[0][1] / 60000) + ' minutes)', bc.indexOf('idle') >= 0 && timers[0][1] === 600000);
  show('   openLobby releases the hold', /releasePodium\(\);\s+\/\/ the last round's winners give way to this lobby/.test(HOSTP));
})();
(function () {
  // h. paper is decided per round
  var G = { gameId: '', paperRound: null }, info = { teams: 3, questions: 10 };
  var f = new Function('G', 'paperPrintedInfo', 'effectiveCount', lift(HOSTP, 'paperThisRound', 'trivia/host.html') + '; return paperThisRound;');
  var p = f(G, function () { return info; }, function () { return 10; });
  show('h. fresh sheets that match the round: this round is on paper', p() === true);
  info.usedBy = 'g-old';
  show('   sheets already played in an earlier round: not on paper unless the host ticks it', p() === false);
  G.paperRound = true;
  show('   the host ticking it is honoured', p() === true);
  G.paperRound = null; delete info.usedBy;
  var p20 = f(G, function () { return info; }, function () { return 20; });
  show('   sheets printed for 10 and a 20-question round: not on paper by default', p20() === false);
  show('   the console sends the choice with every round it starts', /paper:paperThisRound\(\)/.test(HOSTP));
})();

/* ======================================================================================= Worker */
print('\n== the Worker (driven on the rig) ==');
var SESSION = '33333333-3333-4333-8333-333333333333', OTHER = '55555555-5555-4555-8555-555555555555';
var SET = '44444444-4444-4444-8444-444444444444', GT = '66666666-6666-4666-8666-666666666666', GB = '77777777-7777-4777-8777-777777777777';
sha256Hex = async function (s) { return 'h-' + s; };
venueInFreeMonth = async function () { return false; };
checkWeeklyFormatLimit = async function () { return null; };
stampWeeklyFormat = async function () {};
function reset() {
  DB = { vp_sessions: [{ id: SESSION, venue_id: VENUE, join_code: 'ACDEFG', status: 'running', plan_cap_at_start: 0, paper: null },
                       { id: OTHER, venue_id: 'other-venue', join_code: 'HJKMNP', status: 'running', plan_cap_at_start: 0, paper: null }],
         vp_venues: [{ id: VENUE, name: 'Test Venue', status: 'active', created_at: '2026-01-01T00:00:00Z' }, { id: 'other-venue', name: 'Other', status: 'active' }],
         vp_players: [{ id: 'p-own', session_id: SESSION, token_hash: 'h-own', kicked: false, display_name: 'Own' },
                      { id: 'p-stranger', session_id: OTHER, token_hash: 'h-stranger', kicked: false, display_name: 'Stranger' }],
         vp_games: [{ id: GT, session_id: SESSION, seq: 1, format: 'trivia', status: 'running', config: { question_seqs: [1, 2, 3] } },
                    { id: GB, session_id: SESSION, seq: 2, format: 'bingo', status: 'running', config: {} }],
         vp_trivia_games: [{ game_id: GT, question_set_id: SET, current_seq: 3, phase: 'asking', question_ends_at: new Date(NOWMS + 10000).toISOString() }],
         vp_trivia_answers: [], vp_questions: [], vp_venue_settings: [], vp_asked_questions: [], vp_admin_audit: [],
         v_vp_trivia_leaderboard: [{ game_id: GT, player_id: 'p-own', display_name: 'Own', points: 580 }],
         vp_question_sets: [{ id: SET, title: 'General Knowledge', owner_venue_id: null, visibility: 'library', question_count: 6 }] };
  for (var i = 1; i <= 6; i++) DB.vp_questions.push({ id: 'q-' + i, set_id: SET, seq: i, question: 'Library question ' + i + ', with "quotes"', options: ['A', 'B', 'C', 'D'], correct_index: i % 4, points: 100, time_limit_s: 20 });
}
async function call(fn, body) { BODY = body; try { return await fn({}, ENV, json); } catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
function req(token, url) { return { url: url || 'https://w/x', headers: { get: function (h) { return h === 'X-Player-Token' ? token : null; } } }; }
async function callR(fn, request, body) { BODY = body || {}; try { return await fn(request, ENV, json); } catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; } }

// The fake PostgREST takes an in-list of plain values; the Worker now sends quoted ones for question texts.
var rigFetch = fetch, RPC = null;
fetch = async function (url, opts) {
  var u = String(url);
  if (RPC && u.indexOf('/rpc/vp_player_answer') >= 0) return resp(200, RPC);
  u = u.replace(/question=in\.\(([^)]*)\)/, function (all, list) {
    return 'question=in.(' + list.split(',').map(function (x) { var v = decodeURIComponent(x); if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'); return encodeURIComponent(v); }).join(',') + ')';
  });
  return rigFetch(u, opts);
};

reset();
var r = await callR(handlePlayerScore, req('stranger', 'https://w/player/score?game=' + GB));
show('/player/score: a phone from another venue asking about a BINGO game is told it is not in the game, not "Not a trivia game"', r.status === 403 && /not in this game/.test(r.body.error), r.status + ' ' + r.body.error);
r = await callR(handlePlayerScore, req('own', 'https://w/player/score?game=' + GB));
show('   control: a phone in that session still hears "Not a trivia game"', r.status === 400 && /Not a trivia game/.test(r.body.error));
DB.vp_trivia_answers.push({ id: 'a1', game_id: GT, question_id: 'q-3', player_id: 'p-own', answer_index: 3, answered_at: new Date(NOWMS).toISOString(), is_correct: true, points_awarded: 290, vp_questions: { seq: 3 } });
LOG = [];
r = await callR(handlePlayerScore, req('own', 'https://w/player/score?game=' + GT + '&q=3'));
show('/player/score says which question its last answer was (qseq 3), in the same one read', r.status === 200 && r.body.last && r.body.last.qseq === 3 && r.body.total === 580 &&
     LOG.some(function (l) { return /vp_trivia_answers\?.*select=answer_index,is_correct,points_awarded,answered_at,vp_questions\(seq\)/.test(l); }), JSON.stringify(r.body.last));

reset();
// The one-trip path first: the first 404 from the rig's rpc makes the Worker stop asking for good.
RPC = [{ status: 'not_trivia', player_id: 'p-stranger', session_id: OTHER }];
r = await callR(handlePlayerAnswer, req('stranger'), { game_id: GB, answer_index: 0 });
show('/player/answer (the one-trip path, before migration 99): the same stranger is told it is not in the game', r.status === 403 && /not in this game/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
RPC = [{ status: 'not_trivia', player_id: 'p-own', session_id: SESSION }];
r = await callR(handlePlayerAnswer, req('own'), { game_id: GB, answer_index: 0 });
show('   control: a phone in the game\'s own session still hears "Not a trivia game"', r.status === 400 && /Not a trivia game/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
RPC = null;
r = await callR(handlePlayerAnswer, req('stranger'), { game_id: GB, answer_index: 0 });
show('/player/answer (the slow path): a stranger posting a bingo game id is told it is not in the game', r.status === 403 && /not in this game/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
var M99 = readFile('venueplay-backend/supabase/venueplay-99-answer-membership-first.sql');
var step2 = M99.slice(M99.indexOf('-- 2. the game'), M99.indexOf('-- 3. the session'));
show('migration 99 tests membership (wrong_game) before format (not_trivia)', step2.indexOf("'wrong_game'") > 0 && step2.indexOf("'wrong_game'") < step2.indexOf("'not_trivia'"));

reset();
r = await callR(handleHostTriviaBoard, {}, { game_id: GT });
show('/host/trivia/board returns the running totals', r.status === 200 && r.body.leaderboard.length === 1 && r.body.leaderboard[0].points === 580, JSON.stringify(r.body));
show('   and changes nothing: the open question is still open', DB.vp_trivia_games[0].phase === 'asking');
show('   it is a routed /host/ route', /path === '\/host\/trivia\/board'\)\s+return await handleHostTriviaBoard/.test(SRC));

// paper: per round
function paperNight(paperFlag) {
  reset();
  DB.vp_sessions[0].status = 'lobby'; DB.vp_games = []; DB.vp_trivia_games = [];
  DB.vp_sessions[0].paper = { trivia: { teams: 2, round_size: 6, questions: 6 } };
  var b = { session_id: SESSION, format: 'trivia', question_set_id: SET, question_count: 6, base_points: 100, speed_bonus: false };
  if (paperFlag !== undefined) b.paper = paperFlag;
  return b;
}
r = await call(handleHostGame, paperNight(false));
show('h. sheets printed tonight but the host says this round is NOT on paper: answers are not held back', r.status === 200 && r.body.paper === false && !DB.vp_games[DB.vp_games.length - 1].config.defer_reveal, JSON.stringify(r.body).slice(0, 120));
r = await call(handleHostGame, paperNight(true));
show('   paper:true is a paper round', r.status === 200 && r.body.paper === true);
r = await call(handleHostGame, paperNight(undefined));
show('   an older console that says nothing keeps the old rule', r.status === 200 && r.body.paper === true);

// paper score above the round
reset();
DB.vp_sessions[0].paper = { trivia: { teams: 2, round_size: 3, questions: 3 } };
DB.vp_games = [{ id: GT, session_id: SESSION, seq: 1, format: 'trivia', status: 'finished', config: { defer_reveal: true, round_size: 3, paper_teams: 2, question_ids: ['q-1', 'q-2', 'q-3'], question_seqs: [1, 2, 3], base_points: 100 } }];
r = await call(handlePaperScore, { game_id: GT, round: 1, teams: [{ no: 1, name: 'Oldies', correct: 2, double: 0 }, { no: 2, name: 'Quiet', correct: 9, double: 0 }] });
show('e. "9 right" on a 3-question round is refused with the team named, and NO team is scored', r.status === 400 && /Quiet: 9 right, but round 1 had 3 questions/.test(r.body.error) && DB.vp_trivia_answers.length === 0, r.status + ' ' + JSON.stringify(r.body));
r = await call(handlePaperScore, { game_id: GT, round: 1, teams: [{ no: 1, name: 'Oldies', correct: 2, double: 0 }] });
show('   control: 2 right is scored', r.status === 200 && DB.vp_trivia_answers.length === 2, r.status + ' ' + DB.vp_trivia_answers.length);

// YOUR OWN: the set's questions say which came from the library
reset();
var MINE = '88888888-8888-4888-8888-888888888888';
DB.vp_question_sets.push({ id: MINE, title: 'Our night', owner_venue_id: VENUE, visibility: 'venue', question_count: 3 });
DB.vp_questions.push({ id: 'm1', set_id: MINE, seq: 1, question: 'Library question 2, with "quotes"', options: ['A', 'B', 'C', 'D'], correct_index: 0, category: 'Movies & TV' });
DB.vp_questions.push({ id: 'm2', set_id: MINE, seq: 2, question: 'Library question 5, with "quotes"', options: ['A', 'B', 'C', 'D'], correct_index: 0, category: 'World History' });
DB.vp_questions.push({ id: 'm3', set_id: MINE, seq: 3, question: 'Who pours the best schooner in town?', options: ['A', 'B', 'C', 'D'], correct_index: 0, category: 'Local' });
r = await callR(handleTriviaSetQuestions, req('', 'https://w/host/trivia/set/questions?set=' + MINE));
var own = r.body.questions ? r.body.questions.map(function (q) { return q.own; }) : null;
show('c. the set\'s questions say which the host wrote: library, library, own', JSON.stringify(own) === '[false,false,true]', JSON.stringify(own));

print('\n' + (bad ? 'FAIL ' + bad + ' of ' + ran : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
})().catch(function (e) { print('FAIL the suite threw: ' + e + '\n' + (e && e.stack)); throw e; });
