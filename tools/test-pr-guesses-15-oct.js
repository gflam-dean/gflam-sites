/* PUNTERS RECKON: A GUESS MUST COME FROM THE PHONE WHOSE PID IT NAMES (audit, 14 Oct 2026).

   The trivia console scored any {t:"pr_guess", pid, name, text} on the players' channel, so anybody
   with the anon key could score guesses to a real team under its pid, burn its three guesses, put the
   results on its phone, and add teams of their own to the leaderboard.

   RUNS the shipped code: the phone's sendPR / prKeyFor / send / prForMe lifted out of
   app/trivia/play.html, the console's onPRGuess / prGuess / prSeen lifted out of app/trivia/host.html,
   the real vp-phonekey.js on each side, and the real referee (pr-game.js, ta-match.js, and the boards
   out of the game Worker, where they have lived since 15 Oct 2026).
   tools/rig-fake-webcrypto.js stands in for WebCrypto (only a private key's holder can sign for it).

   Run from the repo root:  jsc tools/test-pr-guesses-15-oct.js
*/
load('tools/rig-fake-webcrypto.js');
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   -> ' + extra : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
function drain() { for (var i = 0; i < 12; i++) drainMicrotasks(); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function LS() { var d = {}; return { getItem: function (k) { return (k in d) ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; } }; }

var PK = readFile('venueplay/app/vp-phonekey.js');
var TP = readFile('venueplay/app/trivia/play.html');
var TH = readFile('venueplay/app/trivia/host.html');
function phoneKeyLib(ls) { var w = { crypto: crypto }; (new Function('window', 'localStorage', 'TextEncoder', 'btoa', 'atob', PK))(w, ls, TextEncoder, btoa, atob); return w.VPPhoneKey; }

/* The referee, exactly as the console loads it. */
var RW = { document: {}, crypto: { getRandomValues: function (a) { a[0] = 3; return a; } } };
load('tools/pr-boards-from-worker.js');
RW.TABoards = prBoardsFromWorker();
['ta-match.js', 'pr-game.js'].forEach(function (f) {
  (new Function('window', readFile('venueplay/app/topanswers/' + f)))(RW);
});
var BOARD = RW.TABoards.filter(function (b) { return b.id === 'bbq'; })[0];

/* A phone: its own browser (own localStorage), the shipped glue. */
function phone(name) {
  var ls = LS(), lib = phoneKeyLib(ls), wire = [];
  var P = { room: '72USMR', pid: 'rnd' + name, prPid: '', name: name, joined: true };
  var ch = { send: function (x) { wire.push(copy(x.payload)); } };
  var code = 'var _prKey=null, _prChain=Promise.resolve();\n' + lift(TP, 'send', 'play.html') + lift(TP, 'prKeyFor', 'play.html') +
    lift(TP, 'sendPR', 'play.html') + lift(TP, 'prForMe', 'play.html') + 'return { send: send, prKeyFor: prKeyFor, sendPR: sendPR, prForMe: prForMe };';
  var f = (new Function('window', 'VPPhoneKey', 'P', 'subscribed', 'ch', 'sendQueue', code))({ VPPhoneKey: lib }, lib, P, true, ch, []);
  f.prKeyFor(P.room); drain();
  return { P: P, f: f, wire: wire, guess: function (text, round) { f.sendPR({ t: 'pr_guess', pid: P.prPid || P.pid, name: P.name, round: round || 1, text: text }); drain(); return wire[wire.length - 1]; } };
}

/* The console: its own browser, the shipped glue. */
var HLS = LS(), HLIB = phoneKeyLib(HLS), out = [];
var G = { roundType: 'pr', pr: null, prFeed: [], sessionId: 'sess-1', prSeenN: null };
function newGame() { G.pr = new RW.PRGame.Game({ boards: [BOARD], pick: function () { return 0; }, match: RW.TAMatch.match }); G.pr.nextBoard(45); }
var hcode = lift(TH, 'onPRGuess', 'host.html') + lift(TH, 'prGuess', 'host.html') + lift(TH, 'prSeenKey', 'host.html') +
  lift(TH, 'prSeen', 'host.html') + lift(TH, 'savePRSeen', 'host.html') + 'return { onPRGuess: onPRGuess };';
var chainDecl = /var _prChain=Promise\.resolve\(\);\n  function onPRGuess\(/.test(TH);
var HOST;
function bootConsole() {   // a (re)loaded console page: fresh closure, same localStorage
  G.prSeenN = null;
  HOST = (new Function('window', 'VPPhoneKey', 'G', 'gsend', 'bcast', 'savePR', 'renderConsole', 'setTimeout', 'localStorage',
    'var _prChain=Promise.resolve();\n' + hcode))({ VPPhoneKey: HLIB }, HLIB, G, function (o) { out.push(copy(o)); }, function (o) { out.push(copy(o)); },
    function () {}, function () {}, function () { return 1; }, HLS);
}
bootConsole(); newGame();
function hears(m) { HOST.onPRGuess(copy(m)); drain(); }
function score(pid) { return (G.pr.scores[pid] || { pts: 0 }).pts; }
function left(pid) { return G.pr.guesses[pid] ? G.pr.guesses[pid].left : 3; }

print('\n== a real phone ==');
ok('the console declares its guess chain right above the handler', chainDecl);
var sam = phone('Sam');
ok('the phone made a signing pid of its own (k1_), separate from its trivia pid', /^k1_/.test(sam.P.prPid) && sam.P.prPid !== sam.P.pid, sam.P.prPid);
var g1 = sam.guess('snags');
ok('its guess goes out signed, under that pid', g1 && g1.pid === sam.P.prPid && typeof g1.sig === 'string' && typeof g1.n === 'number', JSON.stringify(g1));
hears(g1);
ok('the console scores it: Sausages, 36, to Sam', score(sam.P.prPid) === 36 && G.pr.scores[sam.P.prPid].name === 'Sam', JSON.stringify(G.pr.scores));
var res = out.filter(function (m) { return m.t === 'pr_result'; }).pop();
ok('the result goes back addressed to that pid', res && res.to === sam.P.prPid && res.hit === true);
ok('and Sam\'s phone takes it as its own', sam.f.prForMe(res));
ok('another phone does not', !phone('Jo').f.prForMe(res));
sam.f.send({ t: 'join', pid: sam.P.pid, name: 'Sam' }); drain();
ok('the phone\'s join names its signing pid (prk) so a reload can be told its guesses left', sam.wire[sam.wire.length - 1].prk === sam.P.prPid);

print('\n== what a stranger on the channel can no longer do ==');
var before = JSON.stringify(G.pr.scores), leftBefore = left(sam.P.prPid);
hears({ t: 'pr_guess', pid: sam.P.prPid, name: 'Sam', round: 1, text: 'steak' });
ok('an unsigned guess under Sam\'s pid scores nothing', JSON.stringify(G.pr.scores) === before, JSON.stringify(G.pr.scores));
ok('and does not burn one of Sam\'s guesses', left(sam.P.prPid) === leftBefore, left(sam.P.prPid) + '');
out.length = 0;
var forged2 = null;   // Mallory signs properly, with HER OWN key, over SAM's pid
phoneKeyLib(LS()).ensure('pr-72USMR').then(function (id) { return id.sign({ t: 'pr_guess', name: 'Sam', round: 1, text: 'steak' }); }).then(function (m) { forged2 = m; }); drain();
forged2.pid = sam.P.prPid;
hears(forged2);
ok('a guess signed with somebody else\'s key and Sam\'s pid is dropped', JSON.stringify(G.pr.scores) === before && left(sam.P.prPid) === leftBefore, JSON.stringify(G.pr.scores));
ok('and nothing is sent to Sam\'s phone', out.filter(function (m) { return m.to === sam.P.prPid; }).length === 0);
var miss = copy(sam.guess('tofu')); hears(miss);
ok('(control) Sam\'s real miss uses one of Sam\'s guesses', left(sam.P.prPid) === leftBefore - 1, left(sam.P.prPid) + '');
leftBefore = left(sam.P.prPid);
hears(miss);
ok('Sam\'s own real miss, played back, does not burn another', left(sam.P.prPid) === leftBefore, left(sam.P.prPid) + '');
bootConsole();                         // the host reloads the console mid-board
hears(miss);
ok('after a console reload, that miss played back still does not burn a guess', left(sam.P.prPid) === leftBefore, left(sam.P.prPid) + '');
var g2 = copy(sam.guess('rump')); var tampered = copy(g2); tampered.text = 'onion';
hears(tampered);
ok('a real guess with its text changed in flight is dropped', score(sam.P.prPid) === 36 && left(sam.P.prPid) === leftBefore);
var renamed = copy(g2); renamed.name = 'Mallory rules';
hears(renamed);
ok('so is one with its name changed', score(sam.P.prPid) === 36);
hears({ t: 'pr_guess', pid: 'zz-invented-team', name: 'Fake Team', round: 1, text: 'snags' });
ok('an invented team with an old-style random pid cannot join the board', !G.pr.scores['zz-invented-team'], JSON.stringify(G.pr.scores));
hears(g2);
ok('(control) the untouched real guess still scores', score(sam.P.prPid) === 60, score(sam.P.prPid) + '');

print('\n== an old board ==');
var jo = phone('Jo'); var jg = jo.guess('snags', 1);
G.pr.endBoard(); G.pr.nextBoard(45);   // round 2
hears(jg);
ok('a signed guess for the previous board is not scored on this one', score(jo.P.prPid) === 0);

if (bad) throw new Error('punters reckon guesses, 15 Oct: ' + bad + ' of ' + ran + ' failed');
print('\nALL ' + ran + ' CHECKS PASSED');
