/* ONE ROOM, ONE CONSOLE, ONE IDENTITY PER PHONE (break test, 14 Oct 2026).

   Four faults found by PLAYING a trivia night at Test Alpha while a bingo lobby opened beside it:
     1. a phone bounced through the bingo page came back to trivia with a dead token, and every
        answer after that was acked by the room and thrown away at Reveal ("CORRECT! 0");
     2. the trivia page kept the old token's fingerprint for the answers room even after a re-join;
     3. a phone on the bingo page took trivia's "started" for a bingo round and stopped looking
        for where the room had gone;
     4. a second console opened a lobby over a live game with no warning.
   Each is RUN here from the shipped files, against stubs for the browser.

   Run: jsc tools/test-one-room-one-identity.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 2000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var BINGO = find('venueplay/play.html');
var TRIVIA = find('venueplay/app/trivia/play.html');
var MUSICAL = find('venueplay/app/musical/play.html');
var SESSION = find('venueplay/app/vp-session.js');

print('\n== one token, every page that holds one for the room gets the fresh one ==');
[['bingo', BINGO, 'vp-token-'], ['trivia', TRIVIA, 'vp-ttoken-'], ['musical', MUSICAL, 'vp-mtoken-']].forEach(function (pg) {
  var store = { 'vp-ttoken-ROOM': 'dead-trivia', 'vp-mtoken-OTHER': 'other-room' };
  var localStorage = {
    getItem: function (k) { return (k in store) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
  var OWN_TOKEN_KEY = pg[2];
  eval(lift(pg[1], 'shareToken', pg[0]));
  shareToken('ROOM', 'fresh');
  ok(pg[0] + ': its own copy is written', store[pg[2] + 'ROOM'] === 'fresh', JSON.stringify(store));
  ok(pg[0] + ': the trivia copy it found is replaced, not left dead', store['vp-ttoken-ROOM'] === 'fresh', JSON.stringify(store));
  ok(pg[0] + ': another room is untouched', store['vp-mtoken-OTHER'] === 'other-room');
});
var copies = [BINGO, TRIVIA, MUSICAL].map(function (t) { return lift(t, 'shareToken', ''); });
ok('shareToken is identical on all three phone pages', copies[0] === copies[1] && copies[1] === copies[2]);
ok('the bingo page writes its token only through shareToken', !/localStorage\.setItem\("vp-token-"\+/.test(BINGO));

print('\n== a token the Worker no longer knows is dropped and the phone re-joins ==');
[['trivia', TRIVIA], ['musical', MUSICAL]].forEach(function (pg) {
  var P = { token: 'dead' }, dropped = 0, rejoined = 0, thrown = null;
  function dropStaleJoin() { dropped++; P.token = ''; }
  function rejoinNow() { rejoined++; }
  function setTimeout(f) { f(); }
  eval(lift(pg[1], 'deadToken', pg[0]));
  try { deadToken({ status: 401 }, '/player/score'); } catch (e) { thrown = e; }
  ok(pg[0] + ': a 401 drops the dead token and re-joins', dropped === 1 && rejoined === 1, 'dropped ' + dropped + ', rejoined ' + rejoined);
  ok(pg[0] + ': and the caller still hears the failure', thrown && thrown.status === 401);
  P.token = 'x'; dropped = 0;
  try { deadToken({ status: 401 }, '/join'); } catch (e) {}
  ok(pg[0] + ': a refused /join does not loop into another join', dropped === 0);
  try { deadToken({ status: 409 }, '/player/answer'); } catch (e) {}
  ok(pg[0] + ': a 409 (too late) is not mistaken for a dead token', dropped === 0);
  ok(pg[0] + ': playerPost and playerGet both go through it',
     (pg[1].match(/catch\(function\(e\)\{ return deadToken\(e, path\); \}\)/g) || []).length === 2);
});

print('\n== the answers room hears the NEW fingerprint after a re-join ==');
(function () {
  var P = { token: 'old', sessionId: 's', room: 'R' }, AR = { hash: 'oldhash' };
  var localStorage = { removeItem: function () {} };
  eval(lift(TRIVIA, 'dropStaleJoin', 'trivia'));
  dropStaleJoin();
  ok('dropping a token forgets its fingerprint', AR.hash === '', 'AR.hash = ' + AR.hash);
  ok('a fresh token re-computes the fingerprint', /P\.token=r\.token; saveToken\(P\.room, P\.token\);\s*AR\.hash=""; ansHash\(\);/.test(TRIVIA));
})();

print('\n== a trivia round starting is not a bingo round ==');
(function () {
  var i = BINGO.indexOf('  function onMsg(m){');
  var head = BINGO.slice(i, BINGO.indexOf('if(!m||!m.t) return;', i));
  var looked = 0, lastPlay = 0, VP_LOOK_NOW = function () { looked++; }, PLAY_TYPES = { started: 1 };
  var fn = new Function('m', 'VP_LOOK_NOW', 'PLAY_TYPES', 'state',
    head.replace('  function onMsg(m){', '').replace(/lastPlay = Date\.now\(\)/, 'state.lastPlay = 1') + ' return "fell through";');
  var st = { lastPlay: 0 };
  var r = fn({ t: 'started', question_count: 10 }, VP_LOOK_NOW, PLAY_TYPES, st);
  ok('trivia\'s started asks where the room is and is not counted as bingo play', looked === 1 && st.lastPlay === 0 && r !== 'fell through', 'looked ' + looked + ', lastPlay ' + st.lastPlay);
  r = fn({ t: 'started', pattern: 'one_line' }, VP_LOOK_NOW, PLAY_TYPES, st);
  ok('bingo\'s own started is still bingo play', st.lastPlay === 1 && r === 'fell through');
  ok('a busy bingo page keeps asking instead of stopping for the night',
     (BINGO.match(/if\(playingHere\(\)\)\{ if\(\+\+tries<225\) setTimeout\(look, 8000\); return; \}/g) || []).length === 2);
})();

print('\n== a second console is asked before it takes the room ==');
(function () {
  function run(answer, confirmSays) {
    var asked = null, result = null, pending = [], native = false;
    var root = { confirm: function (t) { native = true; asked = t; return confirmSays; } };
    /* Asked on the page since 19 Oct 2026 (a native confirm() froze the console under automation and is
       answered "no" by kiosk browsers). The real dialog is driven in Chrome by console-in-chrome.test.py;
       here it is the question and the answer that matter. */
    function askOnPage(title, text) { asked = title + ' ' + text; return { then: function (f) { f(confirmSays); } }; }
    var GAME_API = 'https://w';
    function venueCode() { return 'CODE12'; }
    function setTimeout() {}
    function fetch() {
      return { then: function (f) { var v = f({ ok: true, json: function () { return answer; } });
        return { then: function (g) { g(v); } }; } };
    }
    var Promise = function (ex) { ex(function (v) { result = v; }); };
    eval(lift(SESSION, 'confirmTakeoverOnce', 'vp-session.js'));   // the question itself; one-at-a-time is checked below
    confirmTakeoverOnce('test-alpha');
    return { asked: asked, result: result, native: native };
  }
  var a = run({ live: true, format: 'trivia' }, false);
  ok('a live trivia night elsewhere: the host is asked, and No leaves it alone', a.asked && /trivia night/.test(a.asked) && a.result === false, JSON.stringify(a));
  var b = run({ live: true, format: 'bingo90' }, true);
  ok('Yes goes ahead', b.result === true && /bingo game/.test(b.asked || ''));
  ok('and never with a native browser dialog', !a.native && !b.native, JSON.stringify([a.native, b.native]));
  // Two taps while the question is up: ONE question, and both taps get its answer.
  (function () {
    var asks = 0, answers = [], held = null;
    var root = { confirm: function () { return true; } };
    var GAME_API = 'https://w';
    function venueCode() { return 'CODE12'; }
    function setTimeout() {}
    function fetch() { return { then: function (f) { var v = f({ ok: true, json: function () { return { live: true, format: 'trivia' }; } }); return { then: function (g) { g(v); } }; } }; }
    function askOnPage() { asks++; return { then: function (f) { held = f; } }; }
    eval(lift(SESSION, 'confirmTakeover', 'vp-session.js').replace('function confirmTakeover', 'var _takeoverAsk = null; function confirmTakeover'));
    eval(lift(SESSION, 'confirmTakeoverOnce', 'vp-session.js'));
    var p1 = confirmTakeover('test-alpha'), p2 = confirmTakeover('test-alpha');
    ok('a second tap while the takeover question is up asks nothing new and shares the first answer', asks === 1 && p1 === p2, asks);
  })();
  var c = run({ live: false }, false);
  ok('nothing open: no question, straight in', c.asked === null && c.result === true, JSON.stringify(c));
  [['bingo', find('venueplay/app/index.html'), /VP\.confirmTakeover\(slug\)\.then/],
   ['trivia', find('venueplay/app/trivia/host.html'), /VP\.confirmTakeover\(_slug\)[\s\S]{0,300}apiPost\("\/session"/],
   ['musical', find('venueplay/app/musical/host.html'), /VP\.confirmTakeover\(_slug\)[\s\S]{0,300}apiPost\("\/session"/]
  ].forEach(function (c) { ok(c[0] + ' console asks before it opens a session', c[2].test(c[1])); });
})();

print('\n== a console re-opening its own night says which game it is ==');
[['trivia', find('venueplay/app/trivia/host.html')], ['musical', find('venueplay/app/musical/host.html')]].forEach(function (c) {
  var posted = [];
  var G = { sessionId: 's1', joinCode: 'ABC', venueId: 'v1' };
  function apiPost(path, body) { posted.push(path + ':' + body.format); return { catch: function () {} }; }
  var Promise = { resolve: function (v) { return v; } };
  eval(lift(c[1], 'openSession', c[0] + ' host'));
  var r = openSession();
  ok(c[0] + ': an owned night tells the server its format again', posted.join() === '/session:' + c[0], posted.join());
  ok(c[0] + ': and still hands back the same session', r && r.session_id === 's1');
});

print('\n== a phone\'s pick is not broadcast to the room ==');
ok('the "answered" broadcast carries no choice', !/t:"answer", pid:P\.pid, qseq:qseq, choice/.test(TRIVIA) && /t:"answer", pid:P\.pid, qseq:qseq \}/.test(TRIVIA));

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
