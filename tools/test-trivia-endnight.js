/* THE END OF A TRIVIA NIGHT (Dean, 5 Nov 2026, INBOX 77, 78 and 79).

   The host taps ONCE. The TV then runs the reveal by itself: with the Game setting "Suspense reveal at the end
   of the night" ON (the default) the suspense screen, 3rd, 2nd, "And the winner is...", the winner, the whole
   leaderboard 60 s after the winner for 2 minutes, then back to the slides; OFF, straight to the whole
   leaderboard. The last answer stays 30 s; with no tap the suspense screen comes by itself and the reveal starts
   90 s after it. Between rounds, the whole leaderboard, unless "Show the leaderboard after each round" is off.
   The console shows a big live preview of the TV, one tap, and a small quiet "Show the whole leaderboard now".

   RUNS, as shipped:
     1. /app/vp-trivia-finale.js, the one timeline (both settings, ties, two teams, the clock words, defaults)
     2. the TV (trivia/screen.html): onMsg, renderReveal, renderPodium and the finale engine, on a stub DOM with a
        fake clock: the ON and OFF sequences step by step, a tap, the skip, a TV reloaded mid-show, a replayed
        last answer, a new game stopping the show, the between-rounds board switch, nobody scored, ties
     3. the console (trivia/host.html): renderRun, finish, the finale functions, replayState, the preview, the
        Game settings read, on a stub DOM with a fake clock: one tap, the automatic steps, the quiet skip, the
        small lines, the phones told only when the TV has said, the save for a reload
     4. Game settings (settings.html): the two switches, their defaults, the save (and to a whole group)
     5. the game Worker keeps the two new keys (and only booleans)

   The painted result is in tools/trivia-endnight-in-chrome.test.py.
   Run: jsc tools/test-trivia-endnight.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
function liftAll(text, names, label) { return names.map(function (n) { return lift(text, n, label); }).join('\n'); }

var MODULE = readFile('venueplay/app/vp-trivia-finale.js');
var SCREEN = readFile('venueplay/app/trivia/screen.html');
var HOST = readFile('venueplay/app/trivia/host.html');
var SETTINGS = readFile('venueplay/app/settings.html');
var WORKER = readFile('venueplay-backend/worker/venueplay-game.js');

function loadModule() { var w = {}; new Function('window', MODULE)(w); return w.VPTriviaFinale; }
var F = loadModule();

/* A fake clock: setTimeout / setInterval run when advance() passes them, in time order. */
function makeClock() {
  var c = { now: 1000000, q: [], id: 0 };
  c.Date = { now: function () { return c.now; } };
  c.setTimeout = function (fn, ms) { var t = { id: ++c.id, at: c.now + Math.max(0, Number(ms) || 0), fn: fn }; c.q.push(t); return t.id; };
  c.setInterval = function (fn, ms) { var t = { id: ++c.id, at: c.now + Math.max(1, Number(ms) || 1), fn: fn, every: Math.max(1, Number(ms) || 1) }; c.q.push(t); return t.id; };
  c.clearTimeout = c.clearInterval = function (id) { c.q = c.q.filter(function (t) { return t.id !== id; }); };
  c.advance = function (ms) {
    var end = c.now + ms;
    for (var guard = 0; guard < 100000; guard++) {
      c.q.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      var t = c.q[0];
      if (!t || t.at > end) break;
      c.now = t.at;
      if (t.every) t.at += t.every; else c.q.shift();
      t.fn();
    }
    c.now = end;
  };
  return c;
}

/* A small DOM: elements by id made on first ask, created elements kept as children, click handlers kept. */
function makeDom() {
  var els = {};
  function mk(tag, cls) {
    var c = {};
    (cls || '').split(/\s+/).forEach(function (x) { if (x) c[x] = 1; });
    var e = { tag: tag, textContent: '', style: {}, hidden: false, children: [], attrs: {}, on: {},
      classList: { add: function (x) { c[x] = 1; }, remove: function (x) { delete c[x]; }, contains: function (x) { return !!c[x]; },
                   toggle: function (x, on) { if (on === undefined) on = !c[x]; if (on) c[x] = 1; else delete c[x]; } },
      appendChild: function (k) { e.children.push(k); return k; },
      addEventListener: function (t, fn) { e.on[t] = fn; },
      setAttribute: function (k, v) { e.attrs[k] = String(v); }, removeAttribute: function (k) { delete e.attrs[k]; },
      getAttribute: function (k) { return e.attrs.hasOwnProperty(k) ? e.attrs[k] : null; } };
    Object.defineProperty(e, 'className', { get: function () { return Object.keys(c).join(' '); },
      set: function (v) { c = {}; String(v).split(/\s+/).forEach(function (x) { if (x) c[x] = 1; }); } });
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html || ''; }, set: function (v) { e._html = v; if (v === '') e.children = []; } });
    Object.defineProperty(e, 'id', { get: function () { return e.attrs.id || ''; }, set: function (v) { e.attrs.id = v; els[v] = e; } });
    return e;
  }
  return { $: function (id) { return els[id] || (els[id] = mk('div', '')); }, mk: mk, els: els };
}
function walk(e, out) { out = out || []; out.push(e); (e.children || []).forEach(function (k) { walk(k, out); }); return out; }
function textOf(e) { return walk(e).map(function (x) { return (x.textContent || '') + ' ' + (x._html || ''); }).join(' '); }

var BOARD = [
  { name: 'Quiz Khalifa', points: 1480 }, { name: 'The Quizzly Bears', points: 1420 }, { name: 'Beer Necessities', points: 1355 },
  { name: 'Les Quizerables', points: 1290 }, { name: 'Tequila Mockingbird', points: 1240 }, { name: 'Paste Eaters', points: 1185 }
];

/* =================================================================================== 1 */
print('\n== 1. the one timeline (/app/vp-trivia-finale.js) ==');
(function () {
  var on = F.plan(true, BOARD), off = F.plan(false, BOARD);
  function at(p, s) { return F.stageStart(p, s); }
  show('the last answer stays up 30 seconds', F.MS.lastAnswer === 30000, F.MS.lastAnswer);
  show('the suspense screen waits 90 seconds for the tap, then the TV reveals by itself', F.MS.cover === 90000 && at(on, 'cover') === -90000, at(on, 'cover'));
  show('ON: 3rd, 2nd, "And the winner is...", the winner, in that order', at(on, 'third') === 0 && at(on, 'second') > 0 && at(on, 'drum') > at(on, 'second') && at(on, 'winner') > at(on, 'drum'),
       JSON.stringify(on));
  show('ON: the whole leaderboard 60 seconds after the winner', at(on, 'board') - at(on, 'winner') === 60000, at(on, 'board') - at(on, 'winner'));
  show('ON: the whole leaderboard stays 2 minutes, then back to the slides', at(on, 'ads') - at(on, 'board') === 120000, at(on, 'ads') - at(on, 'board'));
  show('OFF: straight to the whole leaderboard, no podium steps at all', JSON.stringify(off.map(function (s) { return s.stage; })) === '["board","ads"]' && at(off, 'board') === 0,
       JSON.stringify(off));
  show('OFF: the leaderboard stays 2 minutes, then the slides', at(off, 'ads') === 120000, at(off, 'ads'));
  show('no "top 3 together" step anywhere (item 78)', !/together|top3/i.test(JSON.stringify(on) + JSON.stringify(off)));
  var two = F.plan(true, BOARD.slice(0, 2));
  show('two teams: no 3rd place step', at(two, 'third') === null && at(two, 'second') === 0, JSON.stringify(two));
  var tie = F.plan(true, [{ name: 'A', points: 9 }, { name: 'B', points: 9 }, { name: 'C', points: 5 }]);
  show('a tie for first: 3rd, then straight to "And the winners are..." (no 2nd place)', at(tie, 'second') === null && at(tie, 'third') === 0 && F.title('drum', true).text === 'And the winners are',
       JSON.stringify(tie));
  show('nobody scored: no podium, the board (the calm end is the console\'s, item 49)', at(F.plan(true, []), 'cover') === null);
  show('before the reveal starts it is "wait": the last answer stays', F.stageAt(on, -120000).stage === 'wait' && F.stageAt(on, -120000).next === 30000, JSON.stringify(F.stageAt(on, -120000)));
  show('stageAt: in the 2nd place step, 3 s to "And the winner is..."', F.stageAt(on, at(on, 'drum') - 3000).stage === 'second' && F.stageAt(on, at(on, 'drum') - 3000).next === 3000);
  show('stageAt: past the end it is the slides, with nothing after', F.stageAt(on, 999999).stage === 'ads' && F.stageAt(on, 999999).next === null);
  show('the phones hear how they placed at the winner (ON) and at the leaderboard (OFF)', F.phonesAt(on) === at(on, 'winner') && F.phonesAt(off) === 0);
  show('the show only moves forward: a later start never wins', F.forward(5000, 9000) === 5000 && F.forward(5000, 1000) === 1000 && F.forward(undefined, 7) === 7);
  show('the console\'s clock words: 0:30, 1:30, 2:00, 0:05', F.clock(30000) === '0:30' && F.clock(90000) === '1:30' && F.clock(120000) === '2:00' && F.clock(4100) === '0:05');
  show('the reveal starts 30 s + 90 s after the last answer (ON), 30 s (OFF)', F.runAtFromReveal(1000, true) === 121000 && F.runAtFromReveal(1000, false) === 31000);
  var d = F.prefs(null), d2 = F.prefs({ end_suspense: false, round_board: false }), d3 = F.prefs({ end_suspense: 'no', round_board: 0 });
  show('Game settings defaults: both ON for a venue that never touched them', d.end_suspense === true && d.round_board === true);
  show('Game settings: a venue\'s OFF is kept', d2.end_suspense === false && d2.round_board === false);
  show('Game settings: anything not a true/false is the default', d3.end_suspense === true && d3.round_board === true);
  show('TV words: "And the winners are", "In third place", "In second place", "And the winner is", "Winners tonight"',
       F.title('cover').text === 'And the winners are' && F.title('cover').dots && F.title('third').text === 'In third place' && F.title('second').text === 'In second place' &&
       F.title('drum', false).text === 'And the winner is' && F.title('winner').text + ' ' + F.title('winner').tail === 'Winners tonight');
  // The podium order lives in the module AND in screen.html (a suite lifts the screen's): they must agree.
  var sp = new Function(lift(SCREEN, 'podiumEntries', 'trivia/screen.html') + '; return podiumEntries;')();
  var cases = [BOARD, BOARD.slice(0, 2), [{ name: 'A', points: 9 }, { name: 'B', points: 9 }, { name: 'C', points: 9 }, { name: 'D', points: 9 }, { name: 'E', points: 1 }],
               [{ name: 'A', points: 9 }, { name: 'B', points: 5 }, { name: 'C', points: 5 }, { name: 'D', points: 1 }], []];
  show('the module and the TV agree on who stands on the steps (ties, two teams, four-way tie, nobody)',
       cases.every(function (c) { return JSON.stringify(sp(null, c)) === JSON.stringify(F.podiumEntries(null, c)); }));
})();

/* =================================================================================== 2 */
print('\n== 2. the TV runs the show by itself (trivia/screen.html) ==');
function tvRig(opts) {
  opts = opts || {};
  var dom = makeDom(), clk = makeClock(), celebrated = 0, sounds = 0;
  var win = { VPTriviaFinale: loadModule(), location: { href: '' } };
  var env = {
    $: dom.$, el: function (t, c, h) { var e = dom.mk(t, c); if (h != null) { e.textContent = String(h); e._html = String(h); } return e; },
    esc: function (s) { return String(s == null ? '' : s); }, LETTERS: ['A', 'B', 'C', 'D'],
    document: { createElement: function (t) { return dom.mk(t, ''); } },
    window: win, Date: clk.Date, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, setInterval: clk.setInterval, clearInterval: clk.clearInterval,
    state: { phase: 'lobby', hostSeen: false, colour: true, title: '' },
    VENUE_SLUG: opts.slug === undefined ? 'test-alpha' : opts.slug, VP_PREVIEW: !!opts.preview, VP_DEMO: false, JOIN_ON_RESULTS: false,
    LAYERS: ['tvLobby', 'tvQ', 'tvReveal', 'tvPaper', 'tvBoard', 'tvPodium', 'tvPR'],
    _router: { seen: function () {} }, _adsKeep: { idle: 1, tv_here: 1, host_here: 1, session: 1, players: 1 },
    CODE_RE: /^[A-Z0-9]{6}$/,
    celebrateHook: function () { celebrated++; }, soundHook: function () { sounds++; }
  };
  var src = 'var curQ=null, celebrateTimer=null, answeredPids={}, ringTimer=null, boardRollTimer=null, FIN=null, BOARD_PAGE_MS=10000, boardPageTimer=null, TV_BOARD_ROWS=10, joinCode="", _prBoard=null, _endSaw=false, _ac=null;\n' +
    'var HOST_TYPES={}; var BUZZ={ on:false, said:"" };\n' +
    'function stopRing(){} function setRing(){} function tickRing(){} function applyColour(){} function unlockAudio(){} function paintNight(){} function alignTitle(){}\n' +
    'function celebrate(){ celebrateHook(); } function triviaEndShow(){} function timesUp(){} function answerUp(){} function noteHost(){} function tvSend(){} function cancelBackToAds(){} function scheduleBackToAds(){}\n' +
    'function renderLobby(){} function renderPaper(){} function drawLobbyQR(){} function paintLobbyName(){} function paintAnsOf(){} function countKeys(){ return 0; }\n' +
    'function renderQuestion(m){ curQ={ qseq:m.qseq, options:m.options||[], text:m.text||"" }; show("tvQ"); }\n' +
    liftAll(SCREEN, ['show', 'stopBoardPaging', 'qClass', 'ansLenClass', 'sameReveal', 'renderReveal', 'renderRows', 'boardPages', 'renderBoardPaged', 'sharedRanks', 'podiumEntries',
                     'podiumTitle', 'renderPodium', 'finaleClear', 'finaleFrom', 'finaleTick', 'finalePaint', 'endShowThen', 'onMsg'], 'trivia/screen.html') +
    lift(SCREEN, 'playFanfare', 'trivia/screen.html').replace('VPCelebrate.fanfare(', 'soundHook(') +
    '; return { msg: onMsg, fin: function(){ return FIN; }, fanfare: playFanfare, roll: function(){ return boardRollTimer; } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  win.VPCelebrate = {};   // so playFanfare reaches its call
  api.dom = dom; api.clk = clk; api.env = env; api.win = win;
  api.layer = function () { return env.LAYERS.filter(function (l) { return !dom.$(l).classList.contains('hidden'); }).join(','); };
  api.title = function () { return dom.$('tvPodTitle').innerHTML.replace(/<[^>]*>/g, ''); };
  api.cols = function () { return dom.$('tvPodiumCols').children; };
  api.covered = function () { return api.cols().filter(function (c) { return c.classList.contains('hid'); }).map(function (c) { return c.getAttribute('data-rank'); }).sort().join(''); };
  api.celebrated = function () { return celebrated; }; api.sounds = function () { return sounds; };
  return api;
}
var Q10 = { t: 'question', qseq: 10, qi: 10, qtotal: 10, text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'] };
function lastReveal(s, e, rows) { return { t: 'reveal', qseq: 10, correctIndex: 1, options: Q10.options, split: [1, 5, 1, 0], leaderboard: rows || BOARD, fin: { s: s, e: e }, board: false }; }
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -120000));
  show('ON: the last answer is up after the reveal', a.layer() === 'tvReveal', a.layer());
  a.clk.advance(6000);
  show('ON: the last answer does NOT roll to the leaderboard after 5 s (the end of the night follows)', a.layer() === 'tvReveal', a.layer());
  a.clk.advance(23000);
  show('ON: still the last answer at 29 s', a.layer() === 'tvReveal', a.layer());
  a.clk.advance(1100);
  show('ON: at 30 s the suspense screen comes up by itself: the podium, every step covered', a.layer() === 'tvPodium' && a.covered() === '123', a.layer() + ' covered ' + a.covered());
  show('ON: its words are "And the winners are..."', a.title() === 'And the winners are...', a.title());
  show('no JOIN NOW card on the podium (item 78)', a.dom.$('tvJoinCorner').classList.contains('hidden'));
  show('no confetti while the steps are covered', a.celebrated() === 0, a.celebrated());
  a.clk.advance(89000);
  show('ON: 89 s later, still waiting for the tap', a.covered() === '123', a.covered());
  a.clk.advance(1100);
  show('ON: 90 s with no tap, the TV reveals by itself: "In third place", 3rd uncovered', a.title() === 'In third place' && a.covered() === '12', a.title() + ' / ' + a.covered());
  var third = a.cols().filter(function (c) { return c.getAttribute('data-rank') === '3'; })[0];
  show('3rd place\'s team is on its step: Beer Necessities', !!third && /Beer Necessities/.test(textOf(third)) && third.classList.contains('landed'), third && textOf(third));
  a.clk.advance(7000);
  show('ON: 7 s later "In second place", 2nd uncovered', a.title() === 'In second place' && a.covered() === '1', a.title() + ' / ' + a.covered());
  a.clk.advance(7000);
  show('ON: then "And the winner is...", the winner still covered', a.title() === 'And the winner is...' && a.covered() === '1', a.title() + ' / ' + a.covered());
  show('no fanfare or confetti yet at "And the winner is..."', a.celebrated() === 0, a.celebrated());
  a.clk.advance(5000);
  show('ON: then "Winners tonight", every step uncovered', a.title() === 'Winners tonight' && a.covered() === '', a.title() + ' / ' + a.covered());
  show('the winner gets the confetti, once', a.celebrated() === 1, a.celebrated());
  a.clk.advance(59000);
  show('ON: the winner stays up for the minute', a.layer() === 'tvPodium', a.layer());
  a.clk.advance(1100);
  show('ON: 60 s after the winner, the whole leaderboard, the existing board (item 79)', a.layer() === 'tvBoard' && a.dom.$('tvBoardTitle').textContent === 'Final scores', a.layer() + ' ' + a.dom.$('tvBoardTitle').textContent);
  show('the whole leaderboard has every team on it', a.dom.$('tvBoardRows').children.length === BOARD.length, a.dom.$('tvBoardRows').children.length);
  a.clk.advance(119000);
  show('ON: the leaderboard stays for the 2 minutes', a.layer() === 'tvBoard' && a.win.location.href === '', a.win.location.href);
  a.clk.advance(1100);
  show('ON: then the TV goes back to the venue\'s slides by itself', a.win.location.href === '/tv?venue=test-alpha', a.win.location.href);
  var all = textOf(a.dom.$('tvPodium')) + textOf(a.dom.$('tvBoard'));
  show('no counts on the wall: no "players", "answered" or "teams" anywhere in the show', !/players|answered|\bteams\b/i.test(all));
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(false, -30000));
  a.clk.advance(29000);
  show('OFF: the last answer stays 30 s', a.layer() === 'tvReveal', a.layer());
  a.clk.advance(1100);
  show('OFF: then straight to the whole leaderboard, no podium', a.layer() === 'tvBoard' && a.dom.$('tvBoardTitle').textContent === 'Final scores' && a.cols().length === 0, a.layer());
  a.clk.advance(120000);
  show('OFF: 2 minutes later, back to the slides', a.win.location.href === '/tv?venue=test-alpha', a.win.location.href);
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -120000));
  a.clk.advance(40000);
  a.msg({ t: 'finale', s: true, rows: BOARD, e: 0 });   // the host's ONE tap
  show('the tap during the suspense screen starts the reveal now: "In third place"', a.title() === 'In third place', a.title());
  a.msg({ t: 'finale', s: true, rows: BOARD, e: -60000 });   // a late copy of an older message
  show('the show never goes back (a stale message is ignored)', a.title() === 'In third place', a.title());
  a.msg({ t: 'finale', s: true, rows: BOARD, e: F.stageStart(F.plan(true, BOARD), 'board') });   // "Show the whole leaderboard now"
  show('the skip puts the whole leaderboard up at once', a.layer() === 'tvBoard', a.layer());
  a.clk.advance(120000 + 100);
  show('and the slides 2 minutes after the skip', a.win.location.href === '/tv?venue=test-alpha', a.win.location.href);
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -10000));
  a.clk.advance(1000);
  a.msg({ t: 'finale', s: true, rows: BOARD, e: 0 });
  show('a tap while the last answer is still up goes straight to "In third place" (one tap, no second)', a.title() === 'In third place' && a.layer() === 'tvPodium', a.title());
})();
(function () {
  var a = tvRig();
  a.msg({ t: 'finale', s: true, rows: BOARD, e: 16000 });
  show('a TV that reloads mid-show lands on the right step ("And the winner is..." at 16 s)', a.layer() === 'tvPodium' && a.title() === 'And the winner is...' && a.covered() === '1',
       a.layer() + ' ' + a.title() + ' ' + a.covered());
  a.clk.advance(3100);
  show('and carries on from there: the winner at 19 s', a.title() === 'Winners tonight', a.title());
  var b = tvRig(); b.msg({ t: 'finale', s: true, rows: BOARD, e: 100000 });
  show('a TV reloaded during the leaderboard shows the leaderboard', b.layer() === 'tvBoard', b.layer());
  var c = tvRig(); c.msg({ t: 'finale', s: true, rows: BOARD, e: 250000 });
  show('a TV reloaded after the show goes back to the slides', c.win.location.href === '/tv?venue=test-alpha', c.win.location.href);
  var d = tvRig(); d.msg({ t: 'finale', s: true, rows: BOARD, e: -50000 });
  show('a TV reloaded during the suspense screen shows it, covered', d.title() === 'And the winners are...' && d.covered() === '123', d.title());
  var e = tvRig(); e.msg(lastReveal(true, -100000));
  show('a TV reloaded during the last 30 s gets the last answer back', e.layer() === 'tvReveal', e.layer());
  e.clk.advance(10100);
  show('and the suspense screen when its 30 s are up', e.title() === 'And the winners are...' && e.layer() === 'tvPodium', e.layer());
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -120000));
  a.clk.advance(30000 + 90000 + 7000 + 100);   // into 2nd place
  a.msg(lastReveal(true, a.clk.now - (a.fin().runAt)));   // the console woke up and re-sent the last answer
  show('a replayed last answer does not paint over the show', a.layer() === 'tvPodium' && a.title() === 'In second place', a.layer() + ' ' + a.title());
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -120000));
  a.clk.advance(40000);
  a.msg({ t: 'started', title: 'Trivia' });
  a.clk.advance(400000);
  show('a new game stops the show: nothing more paints and the TV is not sent to the slides', a.fin() === null && a.win.location.href === '', a.win.location.href);
  var b = tvRig(); b.msg(lastReveal(true, -120000)); b.msg({ t: 'idle' });
  b.clk.advance(400000);
  show('idle stops it too', b.fin() === null && b.layer() !== 'tvPodium');
})();
(function () {
  var a = tvRig(); a.msg(Q10); a.msg(lastReveal(true, -120000, []));
  a.clk.advance(400000);
  show('nobody scored: no podium, no confetti, ever (item 49 owns that screen)', a.fin() === null && a.layer() === 'tvReveal' && a.celebrated() === 0, a.layer());
})();
(function () {
  var rows = [{ name: 'Twin A', points: 900 }, { name: 'Twin B', points: 900 }, { name: 'Third', points: 500 }, { name: 'Fourth', points: 100 }];
  var a = tvRig(); a.msg({ t: 'finale', s: true, rows: rows, e: 0 });
  show('a tie for first: both stand on the winner\'s steps, covered, after 3rd', a.covered() === '11' && a.title() === 'In third place', a.covered());
  a.clk.advance(F.MS.third + 100);
  show('a tie for first: "And the winners are..." (no 2nd place step)', a.title() === 'And the winners are...', a.title());
})();
(function () {
  var Q = { t: 'question', qseq: 3, qi: 3, qtotal: 10, text: 'Q3', options: ['a', 'b', 'c', 'd'] };
  var a = tvRig(); a.msg(Q); a.msg({ t: 'reveal', qseq: 3, correctIndex: 0, options: Q.options, split: [1, 1, 1, 1], leaderboard: BOARD });
  a.clk.advance(5300);
  show('between questions, the leaderboard ON: the board follows the answer by itself', a.layer() === 'tvBoard' && a.dom.$('tvBoardTitle').textContent === 'Leaderboard', a.layer());
  var b = tvRig(); b.msg(Q); b.msg({ t: 'reveal', qseq: 3, correctIndex: 0, options: Q.options, split: [1, 1, 1, 1], leaderboard: BOARD, board: false });
  b.clk.advance(30000);
  show('between questions, the leaderboard switched OFF: the answer stays, no board', b.layer() === 'tvReveal', b.layer());
})();
(function () {
  var a = tvRig({ preview: true });
  a.fanfare();
  var b = tvRig();
  b.fanfare();
  show('the console\'s preview is silent (no fanfare); the TV still plays it', a.sounds() === 0 && b.sounds() === 1, a.sounds() + '/' + b.sounds());
  a.msg({ t: 'board_test_noop' });
  a.msg({ t: 'leaderboard', title: 'Leaderboard', rows: BOARD });
  show('the preview shows no JOIN NOW card, even on the leaderboard', a.dom.$('tvJoinCorner').classList.contains('hidden'));
  var c = tvRig({ slug: '' });
  c.msg({ t: 'finale', s: false, rows: BOARD, e: 999999 });
  show('the preview (no venue) never navigates away at the end', c.win.location.href === '', c.win.location.href);
})();
(function () {
  var a = tvRig(); a.msg({ t: 'podium', top: BOARD.slice(0, 3), rows: BOARD });
  show('an older console\'s podium message still paints the full podium, uncovered, "Winners tonight"', a.layer() === 'tvPodium' && a.covered() === '' && a.title() === 'Winners tonight' && a.celebrated() === 1,
       a.covered() + ' ' + a.title());
})();
(function () {
  /* EVERY ROUND ENDS ON THE PODIUM (Dean, 7 Nov 2026): a round's podium says which round, the night's says Winners tonight. */
  var a = tvRig(); a.msg({ t: 'podium', top: BOARD.slice(0, 3), rows: BOARD, round: 2 });
  show('a round\'s podium (round 2): the steps, uncovered, "Top three after round 2"', a.layer() === 'tvPodium' && a.covered() === '' && a.title() === 'Top three after round 2', a.title());
  a.msg({ t: 'leaderboard', title: 'Leaderboard after round 2', rows: BOARD });
  show('then the round\'s whole leaderboard', a.layer() === 'tvBoard' && a.dom.$('tvBoardTitle').textContent === 'Leaderboard after round 2', a.layer());
  var b = tvRig(); b.msg({ t: 'podium', top: BOARD.slice(0, 3), rows: BOARD, round: '<b>x</b>' });
  show('a round number that is not a number is never written as markup: "Winners tonight"', b.title() === 'Winners tonight', b.dom.$('tvPodTitle').innerHTML);
})();
var VP_DEMO_SCRIPT = SCREEN.slice(SCREEN.indexOf('function demoQuiz('), SCREEN.indexOf('function demoQuiz(') + 6000);
show('the sales-page demo (?demo=1) still plays its podium and final scores', /m\(\{ t:"podium"/.test(VP_DEMO_SCRIPT) && /title:"Final scores"/.test(VP_DEMO_SCRIPT));

/* =================================================================================== 3 */
print('\n== 3. the host console: one tap, a big live preview, a quiet skip (trivia/host.html) ==');
function hostRig(opts) {
  opts = opts || {};
  var dom = makeDom(), clk = makeClock(), tv = [], phones = [], posted = [], store = {};
  var win = { VPTriviaFinale: loadModule(), location: { origin: 'https://venueplay.com.au' } };
  var G = { roundType: 'trivia', pr: null, status: 'reveal', gameId: 'g1', sessionId: 's1', consoleId: 'c1', qtotal: 10, venueId: 'v1',
            current: { qseq: 10, qi: 10, text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctIndex: 1, imageUrl: '' },
            board: BOARD.slice(), split: [1, 5, 1, 0], defer: false, endSuspense: opts.off ? false : undefined, roundBoard: undefined, order: ['p1', 'p2'] };
  var env = {
    G: G, $: dom.$, el: function (t, c, h) { var e = dom.mk(t, c); if (h != null) { e.textContent = String(h); e._html = String(h); } return e; },
    esc: function (s) { return String(s == null ? '' : s); }, LETTERS: ['A', 'B', 'C', 'D'], window: win,
    Date: clk.Date, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, setInterval: clk.setInterval, clearInterval: clk.clearInterval,
    localStorage: { setItem: function (k, v) { store[k] = v; }, getItem: function (k) { return store[k] || null; }, removeItem: function (k) { delete store[k]; } },
    rawSend: function (o) { tv.push(JSON.parse(JSON.stringify(o))); },
    gsend: function (o) { phones.push(JSON.parse(JSON.stringify(o))); },
    VPTriviaFinale: win.VPTriviaFinale
  };
  var src = 'var _pv={ win:null, ready:false }; var DEMO=false;\n' +
    'function bcast(o){ send(o); gsend(o); } function clearTick(){} function hostError(m){ throw new Error("hostError: "+m); } function renderConsole(){ renderRun(); }\n' +
    'function isDouble(){ return false; } function nextUpPanel(){ return null; } function endBtn(l){ return el("button","btn ghost",l); } function answeredCount(){ return 0; }\n' +
    'function playerCount(){ return G.order.length; } function remainingSecs(){ return 0; } function renderPRRun(){} function renderPaperRun(){ return false; }\n' +
    'function reveal(){} function addTime(){} function nextQuestion(){} function vpAsk(){ return { then:function(){} }; } var endRoundCalls=0; function endRound(){ endRoundCalls++; stopFinale(); G.status="setup"; }\n' +
    'function apiPost(){ throw new Error("no network in this suite"); }\n' +
    'function paintBuzzer(){} function buzzKey(){ return "b"; } function whereKey(){ return "w"; }\n' +
    liftAll(HOST, ['send', 'triviaKey', 'saveTrivia', 'renderRun', 'finish', 'finishOutcome', 'finishNow', 'replayState', 'applyTriviaPrefs',
                   'finSuspense', 'finSteps', 'finStage', 'finPastAds', 'finMsg', 'withFin', 'sendFinale', 'armFinale', 'restoreFinale', 'startFinale',
                   'finTap', 'autoFinish', 'finSkip', 'finTicker', 'stopFinale', 'finTick', 'finLineText', 'paintFinLine', 'previewFeed', 'previewShow', 'endRoundBtn'], 'trivia/host.html') +
    '; return { tap: finTap, render: renderRun, arm: armFinale, withFin: withFin, replay: replayState, prefs: applyTriviaPrefs, restore: restoreFinale, tick: finTick, save: saveTrivia, ends: function(){ return endRoundCalls; } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  api.G = G; api.dom = dom; api.clk = clk; api.tv = tv; api.phones = phones; api.posted = posted; api.store = store; api.win = win;
  api.btn = function (id) { var b = dom.els[id]; return (b && walk(dom.$('runBody')).indexOf(b) >= 0) ? b : null; };
  api.btnText = function () { return walk(dom.$('runBody')).filter(function (e) { return e.tag === 'button'; }).map(function (e) { return e.textContent; }); };
  api.line = function () { var l = dom.els.finLine; return (l && walk(dom.$('runBody')).indexOf(l) >= 0) ? l.textContent : null; };
  api.lastTv = function (t) { for (var i = tv.length - 1; i >= 0; i--) if (tv[i].t === t) return tv[i]; return null; };
  api.lastReveal = function () {   // what reveal() does on the last answer, as shipped
    api.arm(); var o = api.withFin({ t: 'reveal', qseq: 10, correctIndex: 1, options: G.current.options, split: G.split, leaderboard: G.board });
    env.rawSend(o); api.render();
  };
  return api;
}
(function () {
  var h = hostRig();
  h.lastReveal();
  var rv = h.lastTv('reveal');
  show('the last answer tells the TV the show is coming (fin, ON, starting in 2:00) and no board after it', rv && rv.fin && rv.fin.s === true && rv.fin.e === -120000 && rv.board === false,
       JSON.stringify(rv && rv.fin));
  show('the console keeps "Reveal leaderboard" on the last answer (the one tap)', h.btnText().indexOf('Reveal leaderboard') >= 0, JSON.stringify(h.btnText()));
  show('with the small line "Final scores come up in 0:30"', h.line() === 'Final scores come up in 0:30', h.line());
  show('the big live preview of the TV is up', !h.dom.$('tvPreview').classList.contains('hidden'));
  show('the preview is the real TV page, connected to nothing (screen.html?preview=1)', h.dom.$('tvPreviewFrame').getAttribute('src') === '/app/trivia/screen.html?preview=1',
       h.dom.$('tvPreviewFrame').getAttribute('src'));
  var got = []; h.dom.$('tvPreviewFrame').contentWindow = { postMessage: function (m, origin) { got.push([m, origin]); } };
  h.dom.$('tvPreviewFrame').on.load();
  show('when the preview loads it is brought up to date with what the TV shows (the last answer, with its fin)',
       got.length >= 1 && got[0][0].vpPreview.t === 'reveal' && !!got[0][0].vpPreview.fin && got[0][1] === 'https://venueplay.com.au', JSON.stringify(got[0]));
  show('the preview is never told to put the leaderboard over the last answer', got.every(function (g) { return g[0].vpPreview.t !== 'leaderboard'; }));
  h.clk.advance(20100);
  show('the line counts down: "Final scores come up in 0:10"', h.line() === 'Final scores come up in 0:10', h.line());
  h.clk.advance(10000);
  show('at 0:30 with no tap the console takes the step itself: the suspense screen is on the TV', h.G.status === 'ended' && !!h.lastTv('finale') && h.lastTv('finale').e === -90000,
       h.G.status + ' ' + JSON.stringify(h.lastTv('finale') && h.lastTv('finale').e));
  show('the preview got the same finale message as the TV', got.some(function (g) { return g[0].vpPreview.t === 'finale'; }));
  var go = h.btn('finGo');
  show('the one tap: a big pink "Reveal leaderboard", pulsing', !!go && go.textContent === 'Reveal leaderboard' && go.classList.contains('pink') && go.classList.contains('big') && go.classList.contains('finpulse'),
       go && go.className);
  show('with the small line "TV reveals by itself in 1:30 if you don\'t tap"', h.line() === "TV reveals by itself in 1:30 if you don't tap", h.line());
  show('the phones are not told how they placed yet', h.phones.filter(function (p) { return p.t === 'podium'; }).length === 0);
  show('no skip button while nothing is being revealed yet', !h.btn('finSkip'));
  h.clk.advance(20000);
  var before = h.tv.length;
  go = h.btn('finGo'); go.on.click();
  var fm = h.lastTv('finale');
  show('the tap starts the reveal NOW: the TV is told e=0', h.tv.length > before && fm.e === 0 && fm.s === true, JSON.stringify(fm && fm.e));
  show('after the tap there is no other big button: no "Reveal 2nd place", no drumroll, no "Reveal the winner", no "Reveal the top 3"',
       !h.btn('finGo') && !h.btnText().some(function (t) { return /2nd place|drumroll|Reveal the winner|top 3/i.test(t); }), JSON.stringify(h.btnText()));
  var sk = h.btn('finSkip');
  show('a small, quiet "Show the whole leaderboard now" (secondary style, not big, not pink)', !!sk && sk.textContent === 'Show the whole leaderboard now' && sk.classList.contains('ghost') &&
       !sk.classList.contains('big') && !sk.classList.contains('pink'), sk && sk.className);
  show('the line says when the whole leaderboard comes: "Whole leaderboard on the TV in 1:19"', h.line() === 'Whole leaderboard on the TV in 1:19', h.line());
  var again = h.btn('finAgain');
  show('"Start a new round" stays, quiet while the TV reveals', !!again && again.classList.contains('ghost'), again && again.className);
  h.clk.advance(18900);
  show('the phones are not told before the winner is on the TV', h.phones.filter(function (p) { return p.t === 'podium'; }).length === 0);
  h.clk.advance(600);
  var pp = h.phones.filter(function (p) { return p.t === 'podium'; });
  show('the phones hear how they placed once the winner is on the TV, once', pp.length === 1 && pp[0].rows.length === BOARD.length, pp.length);
  h.clk.advance(5000);
  show('the phones are told only once', h.phones.filter(function (p) { return p.t === 'podium'; }).length === 1);
  var runAtAfterTap = h.G.finale.runAt;
  h.clk.advance(3000); h.tap();
  show('a second tap while the reveal runs never restarts it (the start only moves forward)', h.G.finale.runAt === runAtAfterTap, h.G.finale.runAt - runAtAfterTap);
  var saved = JSON.parse(h.store['vpTriviaGame-v1'] || '{}');
  show('the end-of-night clock is saved on this tablet (a reload carries on)', saved.fin && saved.fin.runAt === h.G.finale.runAt && saved.fin.ended === true && saved.fin.ph === true, JSON.stringify(saved.fin));
  h.btn('finSkip').on.click();
  fm = h.lastTv('finale');
  show('"Show the whole leaderboard now" jumps the TV to the leaderboard', F.stageAt(F.plan(true, BOARD), fm.e).stage === 'board', fm.e);
  show('the skip button goes once the leaderboard is up', !h.btn('finSkip'));
  show('the line: "Back to your slides in 2:00"', h.line() === 'Back to your slides in 2:00', h.line());
  show('"Start a new round" is the main button again once the leaderboard is up', h.btn('finAgain') && h.btn('finAgain').classList.contains('pink'));
  h.clk.advance(120500);
  show('after the 2 minutes: "The TV is back on your slides."', h.line() === 'The TV is back on your slides.', h.line());
  var n = h.tv.length; h.replay(null);
  show('a TV that says hello after the show is NOT put back on it (it stays on the slides)', h.tv.length === n, JSON.stringify(h.tv.slice(n)));
})();
(function () {
  var h = hostRig();
  h.lastReveal();
  h.clk.advance(5000);
  h.btnText();
  var main = walk(h.dom.$('runBody')).filter(function (e) { return e.tag === 'button' && e.textContent === 'Reveal leaderboard'; })[0];
  main.on.click();
  var fm = h.lastTv('finale');
  show('ON, a tap while the last answer is up: straight into 3rd place (e=0), no suspense wait', fm && fm.e === 0 && h.G.status === 'ended' && F.stageAt(F.plan(true, BOARD), fm.e).stage === 'third',
       JSON.stringify(fm && fm.e));
  h.clk.advance(F.MS.cover + 5000);
  show('the automatic step never fires after the tap (the TV is not sent back)', h.tv.filter(function (m) { return m.t === 'finale'; }).length === 1, h.tv.filter(function (m) { return m.t === 'finale'; }).length);
})();
(function () {
  var h = hostRig({ off: true });
  h.lastReveal();
  var rv = h.lastTv('reveal');
  show('OFF: the last answer says the leaderboard is 30 s away (fin s:false, e=-30000)', rv.fin.s === false && rv.fin.e === -30000, JSON.stringify(rv.fin));
  h.clk.advance(30100);
  var fm = h.lastTv('finale');
  show('OFF: with no tap, the whole leaderboard at 0:30 by itself', fm && fm.s === false && F.stageAt(F.plan(false, BOARD), fm.e).stage === 'board', JSON.stringify(fm));
  show('OFF: no "Reveal leaderboard" to tap and no skip once the leaderboard is up', !h.btn('finGo') && !h.btn('finSkip'), JSON.stringify(h.btnText()));
  show('OFF: the phones are told straight away', h.phones.filter(function (p) { return p.t === 'podium'; }).length === 1);
})();
(function () {
  var h = hostRig({ off: true });
  h.lastReveal(); h.clk.advance(2000);
  walk(h.dom.$('runBody')).filter(function (e) { return e.tag === 'button' && e.textContent === 'Reveal leaderboard'; })[0].on.click();
  var fm = h.lastTv('finale');
  show('OFF: the one tap puts the whole leaderboard up now', fm && fm.e === 0 && fm.s === false, JSON.stringify(fm));
})();
(function () {
  var h = hostRig();
  h.lastReveal(); h.clk.advance(30100);   // the suspense screen
  var runAt = h.G.finale.runAt, saved = JSON.parse(h.store['vpTriviaGame-v1']).fin;
  var r = hostRig(); r.G.status = 'reveal'; r.clk.now = h.clk.now;
  r.restore(saved);
  show('a console reloaded during the suspense screen comes back to it, same clock', r.G.status === 'ended' && r.G.finale.runAt === runAt && r.G.finale.s === true, r.G.status);
  r.replay(null);
  var fm = r.lastTv('finale');
  show('and a TV that says hello is handed where the show is (e counts from the same start)', fm && fm.e === r.clk.now - runAt, JSON.stringify(fm));
  var p = hostRig(); p.G.status = 'reveal';
  p.restore(null);
  show('a console picked up with no saved clock starts the 30 s again (the TV never stuck)', p.G.finale && p.G.finale.runAt === p.clk.now + 120000, p.G.finale && (p.G.finale.runAt - p.clk.now));
})();
(function () {
  var h = hostRig();
  h.lastReveal(); h.clk.advance(30100);
  h.btn('finGo').on.click();
  var n = h.phones.length;
  h.replay('p1');
  show('a phone that rejoins before the winner is NOT told how it placed', h.phones.length === n, JSON.stringify(h.phones.slice(n)));
  h.clk.advance(20000);
  n = h.phones.length; h.replay('p1');
  show('a phone that rejoins after the winner is told, aimed at that phone only', h.phones.length === n + 1 && h.phones[n].t === 'podium' && h.phones[n].to === 'p1', JSON.stringify(h.phones.slice(n)));
  h.btn('finAgain').on.click();
  show('"Start a new round" ends it and takes the preview down', h.ends() === 1 && h.G.finale === null && h.dom.$('tvPreview').classList.contains('hidden'));
})();
(function () {
  var h = hostRig(); h.G.status = 'question';
  h.prefs({});
  show('Game settings defaults on the console: suspense ON, leaderboard between rounds ON', h.G.endSuspense === true && h.G.roundBoard === true);
  h.prefs({ end_suspense: false, round_board: false, time_s: 20 });
  show('the console takes the venue\'s OFF for both, even mid-quiz', h.G.endSuspense === false && h.G.roundBoard === false);
  var o = h.withFin({ t: 'reveal' });
  show('leaderboard OFF: every reveal tells the TV no board follows', o.board === false && !o.fin, JSON.stringify(o));
  h.prefs({ round_board: true });
  o = h.withFin({ t: 'reveal' });
  show('leaderboard ON: a reveal mid-night is as before (the board follows)', !('board' in o) && !o.fin, JSON.stringify(o));
  var rs = HOST.slice(HOST.indexOf('function reveal('), HOST.indexOf('function finish('));
  /* (run for real, switch on and off, in tools/test-trivia-no-players.js: since 7 Nov 2026 the board comes at a round's end only) */
  show('reveal(): the round\'s podium and leaderboard are sent only with the switch on', /var rEnd = !isLast && roundEnds\(qnow\) && G\.roundBoard!==false/.test(rs));
  show('reveal(): the last answer arms the end of the night and every reveal goes out through withFin', /armFinale\(\)/.test(rs) && /var rv = withFin\(\{ t:"reveal"/.test(rs) && /bcast\(rv\)/.test(rs));
})();
show('the console loads the shared timeline', /<script src="\/app\/vp-trivia-finale\.js"><\/script>/.test(HOST));
show('the TV loads the shared timeline', /<script src="\/app\/vp-trivia-finale\.js"><\/script>/.test(SCREEN));
show('closing the console mid-show does not pull the TV off it (pagehide leaves it)', /if\(G\.finale && !finPastAds\(\)\) return;\s*\/\/ the end-of-night show/.test(HOST));

(function () {
  var m = SCREEN.match(/var HOST_TYPES=\{[^}]*\};\s*HOST_TYPES\.finale=\d;/);
  var HT = m ? new Function(m[0] + '; return HOST_TYPES;')() : {};
  show('the TV listens to the console\'s finale message (it is a host message type)', !!m && HT.finale === 1 && HT.reveal === 1 && HT.podium === 1, m && JSON.stringify(HT.finale));
})();

/* =================================================================================== 4 */
print('\n== 4. Game settings: two switches, both ON (settings.html) ==');
function setRig(saved, opts) {
  opts = opts || {};
  var dom = makeDom(), saves = [], ok = opts.fail ? false : true;
  var sw1 = dom.mk('div', 'sw on'); sw1.setAttribute('data-tk', 'round_board');
  var sw2 = dom.mk('div', 'sw on'); sw2.setAttribute('data-tk', 'end_suspense');
  var win = { VPTriviaFinale: loadModule(), VP: null };
  var VP = { gamePrefs: function (game, o) {
    return { start: function () { if (saved) o.apply(saved); return { then: function (f) { f(); } }; },
             saveNow: function () { saves.push({ game: game, venue: o.venueId, prefs: o.collect() }); return { then: function (f) { return f(ok); } }; } };
  } };
  win.VP = VP;
  var PromiseStub = { all: function (arr) { return { then: function (f) { return f(arr.map(function (x) { var v; x.then(function (r) { v = r; }); return v; })); } }; } };
  var env = { $: dom.$, window: win, VP: VP, VPTriviaFinale: win.VPTriviaFinale, Promise: PromiseStub,
    document: { querySelectorAll: function (q) { return q === '.sw[data-tk]' ? [sw1, sw2] : []; } },
    venueId: 'v1', scope: opts.group ? 'group' : 'venue', groupVenues: opts.group ? [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] : [] };
  var start = SETTINGS.indexOf('var triviaShow=');
  var vars = SETTINGS.slice(start, SETTINGS.indexOf('function triviaPrefsFor(', start));
  var src = vars + liftAll(SETTINGS, ['triviaPrefsFor', 'paintTriviaShow', 'loadTriviaShow', 'saveTriviaShow', 'flipTrivia'], 'settings.html') +
    '; return { load: loadTriviaShow, flip: flipTrivia, now: function(){ return triviaShow; } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  api.sw1 = sw1; api.sw2 = sw2; api.saves = saves; api.dom = dom;
  return api;
}
(function () {
  show('the page has the Trivia section with both switches, ON as shipped', /id="secTrivia"/.test(SETTINGS) && /class="sw on" data-tk="round_board"/.test(SETTINGS) && /class="sw on" data-tk="end_suspense"/.test(SETTINGS));
  show('the words: "Show the leaderboard after each round" and "Suspense reveal at the end of the night"',
       />Show the leaderboard after each round</.test(SETTINGS) && />Suspense reveal at the end of the night</.test(SETTINGS));
  show('no "Top 3 together" or "Whole leaderboard" choice on the page (item 78)', !/Top 3 together|Top 3, one at a time/.test(SETTINGS));
  var a = setRig({});
  a.load();
  show('a venue that never saved: both switches ON', a.sw1.classList.contains('on') && a.sw2.classList.contains('on') && a.sw2.getAttribute('aria-checked') === 'true');
  show('ON: the help says 3rd, then 2nd, then the winner, by itself', /3rd place, then 2nd/.test(a.dom.$('trSuspenseHelp').textContent), a.dom.$('trSuspenseHelp').textContent);
  var b = setRig({ end_suspense: false, set_id: 'x' });
  b.load();
  show('a venue that switched the suspense off sees it off, and the help says straight to the leaderboard',
       !b.sw2.classList.contains('on') && b.sw1.classList.contains('on') && /straight to the whole leaderboard/.test(b.dom.$('trSuspenseHelp').textContent), b.dom.$('trSuspenseHelp').textContent);
  show('OFF: the footnote has no "60 seconds after the winner"', !/60 seconds/.test(b.dom.$('trFoot').textContent), b.dom.$('trFoot').textContent);
  var c = setRig({});
  c.load(); c.flip(c.sw1);
  show('flicking a switch saves at once, the two keys only (never the console\'s trivia setup)',
       c.saves.length === 1 && c.saves[0].game === 'trivia' && JSON.stringify(c.saves[0].prefs) === '{"end_suspense":true,"round_board":false}', JSON.stringify(c.saves));
  var junkSw = c.dom.mk('div', 'sw on'); junkSw.setAttribute('data-tk', 'time_s');
  c.flip(junkSw);
  show('a switch with any other key writes nothing and saves nothing', c.saves.length === 1 && c.now().time_s === undefined, c.saves.length + ' ' + JSON.stringify(c.now()));
  show('and says "Saved."', c.dom.$('trMsg').textContent === 'Saved.', c.dom.$('trMsg').textContent);
  var d = setRig({}, { group: true });
  d.load(); d.flip(d.sw2);
  show('"Whole group": saved to every venue in the group, and says so', d.saves.length === 3 && d.saves.map(function (s) { return s.venue; }).join() === 'v1,v2,v3' &&
       d.dom.$('trMsg').textContent === 'Saved for all 3 venues.', d.dom.$('trMsg').textContent);
  var e = setRig({}, { fail: true });
  e.load(); e.flip(e.sw2);
  show('a save that fails says so plainly', /did not save/.test(e.dom.$('trMsg').textContent) && /err/.test(e.dom.$('trMsg').className), e.dom.$('trMsg').textContent);
})();

/* =================================================================================== 5 */
print('\n== 5. the game Worker keeps the two switches (venueplay-game.js) ==');
(function () {
  var i = WORKER.indexOf('const GAME_PREFS_MAX_CHARS'), j = WORKER.indexOf('async function handleGamePrefs(');
  if (i < 0 || j < 0) throw new Error('cannot find the game-prefs rules in venueplay-game.js');
  var clean = new Function(WORKER.slice(i, j) + '; return cleanGamePrefs;')();
  var out = clean('trivia', { end_suspense: false, round_board: false, time_s: 20 });
  show('end_suspense and round_board are kept for trivia', out.end_suspense === false && out.round_board === false && out.time_s === 20, JSON.stringify(out));
  var junk = clean('trivia', { end_suspense: 'off', round_board: 1 });
  show('only true/false is kept (anything else dropped)', !('end_suspense' in junk) && !('round_board' in junk), JSON.stringify(junk));
  show('not kept for another game', !('end_suspense' in clean('bingo', { end_suspense: true })));
})();

print('\n' + (bad ? 'FAILED ' + bad + ' of ' + ran : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' check(s) failed');
