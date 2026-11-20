/* THE TV FOLLOWS THE HOST AFTER A GAME HAS FINISHED (20 Nov 2026, real night step 3g, Jobs 519, 521, 522).

   Live at The Mini Bar (signing enforced), each lifted from the shipped files and run:
     1. trivia ends on the podium, the host opens the Musical Bingo lobby: the phones moved, the TV stayed on trivia, because the
        trivia screen still counted its finished quiz as "our game is live" and refused the ONE signed t:"mode"
     2. a finished raffle, "Put the draws board on the TV": the TV stayed on the raffle winner, same reason
     3. leaving the finished trivia console replays its last answer (reveal): the wall went BACK from "Thanks for playing" to Q2

   The router is the real vp-screen-router.js on a fake realtime client; busy() is the expression the real screen hands it, and
   the helper functions are lifted from the real screen. A quiz or draw still being played must NOT be walked out on.

   Run from the repo root: jsc tools/test-tv-follows-finished-game.js
*/
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra !== undefined ? '   saw: ' + JSON.stringify(extra) : '')); } }
function find(rel) { var t = readFile(rel); if (!t || t.length < 2000) throw new Error('cannot open ' + rel); return t; }
function lift(text, name) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) return '';   // not there (yet): the checks below then fail on behaviour
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
function busyExpr(text) {
  var m = /VPScreenRouter\.start\(\{[\s\S]*?busy:\s*(function\(\)\s*\{[^}]*\}|\w+)\s*\n/.exec(text);
  if (!m) throw new Error('cannot find the busy() handed to the router');
  return m[1];
}

var NOW = 1e12;
var timers = [];
Date.now = function () { return NOW; };
var setTimeout = function (fn, ms) { timers.push(fn); return timers.length; };
var clearTimeout = function () {};
var navigatedTo = null;
var window = { location: { origin: 'https://venueplay.com.au' }, top: null, self: null };
window.top = window; window.self = window;
Object.defineProperty(window.location, 'href', { set: function (u) { navigatedTo = u; }, get: function () { return ''; } });
var console = { log: function () {} };
(new Function('window', 'setTimeout', 'clearTimeout', 'console', 'Date', find('venueplay/app/vp-screen-router.js')))
  .call(window, window, setTimeout, clearTimeout, console, Date);
var Router = globalThis.VPScreenRouter;

var channels = [];
function makeClient() {
  return { channel: function (name) {
    var ch = { name: name, handlers: [], on: function (t, f, fn) { ch.handlers.push(fn); return ch; },
      subscribe: function (cb) { cb('SUBSCRIBED'); return ch; }, unsubscribe: function () { return Promise.resolve('ok'); } };
    channels.push(ch); return ch; }, removeChannel: function () {} };
}
/* A screen of game `self` whose busy() is `busyFn`; returns a function that says a message on a game's channel. */
function screen(self, busyFn) {
  channels.length = 0; navigatedTo = null;
  var r = Router.start({ client: makeClient(), self: self, slug: 'the-mini-bar', venueCode: function (s) { return 'C-' + s; }, busy: busyFn });
  return function say(game, m) {
    if (game === self) { r.seen(m); return; }   // the screen's OWN traffic: the page tells its router (onMsg: _router.seen)
    channels.filter(function (c) { return c.name === 'vp-C-' + game + '-the-mini-bar' || (game === 'bingo' && c.name === 'vp-C-the-mini-bar'); })
      .forEach(function (c) { c.handlers.forEach(function (h) { h({ payload: m }); }); });
  };
}

var TS = find('venueplay/app/trivia/screen.html');
var RS = find('venueplay/app/raffle/screen.html');

/* ---- the trivia screen's own rules, as shipped ---- */
function triviaScreen(state, curQ) {
  var src = lift(TS, 'triviaLive') + lift(TS, 'staleAfterEnd');
  var f = new Function('state', 'curQ', src + 'var busy = ' + busyExpr(TS) + ';' +
    'return { busy: busy, stale: (typeof staleAfterEnd === "function") ? staleAfterEnd : function(){ return false; } };');
  return f(state, curQ);
}

print('\n== 1. trivia over (podium), the Musical Bingo console opens its lobby: the TV follows ==');
['podium', 'leaderboard'].forEach(function (ph) {
  var state = { phase: ph, done: ph === 'podium' || undefined };
  if (ph === 'leaderboard') state.done = true;   // the final scores board / Thanks for playing
  var t = triviaScreen(state, { qseq: 2 });
  var say = screen('trivia', t.busy);
  say('trivia', { t: 'podium' });                 // its own recent on-air traffic: inside the 90 s window
  say('musical', { t: 'mode', mode: 'musical' });
  ok('finished quiz (' + ph + '): the signed mode to musical is obeyed', /musical/.test(navigatedTo || ''), navigatedTo);
});
(function () {
  var state = { phase: 'question' };
  var t = triviaScreen(state, { qseq: 1 });
  var say = screen('trivia', t.busy);
  say('trivia', { t: 'question', qseq: 1 });
  say('musical', { t: 'mode', mode: 'musical' });
  ok('CONTROL: a question being played is NOT walked out on', navigatedTo === null, navigatedTo);
  state.phase = 'reveal';
  say('musical', { t: 'mode', mode: 'musical' });
  ok('CONTROL: an answer on screen mid quiz is NOT walked out on', navigatedTo === null, navigatedTo);
})();

print('\n== 3. leaving the finished console must not bring a question back ==');
(function () {
  var state = { phase: 'leaderboard', done: true };
  var t = triviaScreen(state, { qseq: 2 });
  ok('the replayed last answer (reveal, with the final flag) is ignored', t.stale({ t: 'reveal', qseq: 2, fin: { s: true }, leaderboard: [{}] }) === true);
  ok('the same question said again is ignored', t.stale({ t: 'question', qseq: 2 }) === true);
  ok('an ordinary between-questions board is ignored', t.stale({ t: 'leaderboard', title: 'Leaderboard', rows: [{}] }) === true);
  ok('the final scores board is still painted', t.stale({ t: 'leaderboard', title: 'Final scores', rows: [{}] }) === false);
  ok('a NEW game\'s first question (a different qseq) is taken', t.stale({ t: 'question', qseq: 1 }) === false);
  var live = triviaScreen({ phase: 'reveal' }, { qseq: 2 });
  ok('CONTROL: a reveal during a live quiz is taken as always', live.stale({ t: 'reveal', qseq: 2 }) === false);
})();
(function () {
  ok('the screen sets "done" at the podium, the final board, the finale stages and the nobody-joined end',
     /t==="podium"\)\{\s*state\.phase="podium"; state\.done=true;/.test(TS) && /state\.done=\/\^final\/i/.test(TS) &&
     /stage==="board"\)\{ state\.phase="leaderboard"; state\.done=true;/.test(TS) && /state\.phase="podium"; state\.done=true;/.test(TS) &&
     /state\.phase="leaderboard"; state\.done=true;\s*\n\s*if\(boardRollTimer\)/.test(TS));
  ok('and clears it for a new game (started, idle, lobby state, a new question)',
     /t==="started"\)\{ state\.done=false;/.test(TS) && /t==="idle"\)\{ state\.done=false;/.test(TS) &&
     /m\.phase==="lobby"\)\{ state\.done=false;/.test(TS) && /state\.phase="question"; state\.done=false;/.test(TS));
  ok('and the reveal/question/leaderboard handlers ask staleAfterEnd first',
     /t==="question"\)\{\s*\n\s*if\(staleAfterEnd\(m\)\) return;/.test(TS) && /t==="reveal"\)\{\s*\n\s*if\(staleAfterEnd\(m\)\) return;/.test(TS) &&
     /t==="leaderboard"\)\{\s*\n\s*if\(staleAfterEnd\(m\)\) return;/.test(TS));
})();

print('\n== 2. a finished raffle, "Put the draws board on the TV": the TV follows ==');
function raffleScreen(phase) {
  var S = { phase: phase };
  var f = new Function('S', lift(RS, 'raffleLive') + 'return ' + busyExpr(RS) + ';');
  return f(S);
}
['result'].forEach(function (ph) {
  var say = screen('raffle', raffleScreen(ph));
  say('raffle', { t: 'claimed', numbers: [61] });
  say('members', { t: 'mode', mode: 'members' });
  ok('prize collected (' + ph + '): the members draw mode is obeyed', /members/.test(navigatedTo || ''), navigatedTo);
});
['drawing', 'winner', 'redraw'].forEach(function (ph) {
  var say = screen('raffle', raffleScreen(ph));
  say('raffle', { t: ph === 'winner' ? 'winner' : 'drawing', numbers: [61] });
  say('members', { t: 'mode', mode: 'members' });
  ok('CONTROL: a draw still ' + ph + ' is NOT walked out on', navigatedTo === null, navigatedTo);
});

print('\n== signing is not weakened ==');
(function () {
  var SIGN = find('venueplay/app/vp-sign.js');
  var m = /EXEMPT\s*=\s*\{([^}]*)\}/.exec(SIGN);
  ok('to_ads and idle are still NOT exempt from signing', !!m && !/to_ads|idle/.test(m[1]), m && m[1]);
})();

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) quit(1);
