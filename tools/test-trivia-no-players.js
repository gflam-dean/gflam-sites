/* TRIVIA WITH NOBODY JOINED (live fault, Fri 6 Nov 2026, The Mini Bar).

   Dean ran trivia with no phones joined and tapped Reveal leaderboard. The console said "Scores
   could not be loaded ... Check your connection", which was wrong: the connection was fine and
   there were simply no players. This RUNS the real finish(), finishNow(), finishOutcome() and
   reveal() lifted out of venueplay/app/trivia/host.html, with the server and the channel faked, and
   asserts what the host sees and what the TV is sent:
     - nobody joined, server answered with an empty board: the plain "Nobody has joined" line, a
       "nobody" message for the TV, no error bar, no podium;
     - phones present but the fetch failed: the real "could not be loaded" error, and no "nobody";
     - the between-question auto follow-up with nobody joined: NOTHING is sent, the answer stays up
       (not an empty board, not Thanks for playing, and not the join screen: Jobs 523, real night 20 Nov
       2026, when SCAN TO PLAY filled the wall between Q1 and Q2); with players, mid-round, nothing follows the answer (Dean, 7 Nov 2026: "The
       leaderboard should show every round only"); at the end of a round that is not the last (a
       phone night has a round every 10 questions) the podium, then "Leaderboard after round N".

   Run from the repo root:  jsc tools/test-trivia-no-players.js
*/
var HOST = readFile('venueplay/app/trivia/host.html');
function lift(name) {
  var i = HOST.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in host.html - a test that cannot find its subject cannot fail');
  var d = 0, k = HOST.indexOf('{', i);
  do { if (HOST[k] === '{') d++; else if (HOST[k] === '}') d--; k++; } while (d > 0 && k < HOST.length);
  return HOST.slice(i, k) + '\n';
}
var NOBODY_LINE = (HOST.match(/var NOBODY_MSG="([^"]+)"/) || [])[1];
var SRC = ['finishOutcome', 'finish', 'finishNow', 'startFinale', 'reveal', 'roundOf', 'roundEnds', 'roundShow'].map(lift).join('\n') +
  '\nvar ROUND_BOARD_MS=' + (HOST.match(/var ROUND_BOARD_MS=(\d+);/) || [0, 'NaN'])[1] + ';';

var ran = 0, bad = 0;
function show(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }

/* One console: the page's own functions over a fake game state, server and channel. */
function makeConsole(o) {
  var G = { board: o.board || [], gameId: 'g1', status: 'reveal', noPlayersNote: false, qtotal: o.qtotal || 10, split: [], defer: false, rs: o.rs || 10, roundBoard: o.roundBoard,
            current: { qseq: o.qseq || 10, qi: o.qseq || 10, options: ['a', 'b', 'c', 'd'] } };
  var sent = [], errors = [], timers = [], renders = 0;
  var players = o.players | 0;
  function playerCount() { return players; }
  function clearTick() {} function clearAuto() {} function armFinale() {} function withFin(o) { return o; }
  var window = {};   // no finale module here: startFinale takes its plain-podium path (the full end of the night is tools/test-trivia-endnight.js)
  function clearErrForAction() {}
  function saveTrivia() {}
  function isDouble() { return false; }
  function remainingSecs() { return 0; } function hostAnswerUp() {}   // reveal()'s all-in sound slot (INBOX 282.5): the clock has closed here
  function renderConsole() { renders++; }
  function hostError(m) { errors.push(m); }
  function bcast(m) { sent.push(m); }
  function send(m) { m = Object.assign({ tvOnly: true }, m); sent.push(m); }   // the TV's channel alone
  function setTimeout(f, ms) { timers.push(f); return timers.length; }
  function clearTimeout(id) { if (id) timers[id - 1] = function () {}; }
  function apiPost(path) {
    if (o.fetchFails) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve({ leaderboard: o.fetchBoard || [], correct_index: 1, qseq: G.current.qseq, split: [] });
  }
  eval(SRC);
  return { G: G, sent: sent, errors: errors, timers: timers, finish: finish, reveal: reveal, renders: function () { return renders; },
           types: function () { return sent.map(function (m) { return m.t; }).join(','); }, setPlayers: function (n) { players = n; } };
}
async function flush() { for (var i = 0; i < 40; i++) await null; }

(async function () {
  print('the host decision');
  var C = makeConsole({});
  var fo = (function () { return eval(lift('finishOutcome') + ';finishOutcome'); })();
  show('a board with rows is the podium', fo(3, 4, true) === 'podium');
  show('an empty board, nobody joined, the server answered: nobody', fo(0, 0, true) === 'nobody');
  show('an empty board, nobody joined, but the fetch failed: the real error', fo(0, 0, false) === 'error');
  show('an empty board, players present, fetch failed: the real error', fo(0, 5, false) === 'error');
  show('an empty board, players present, server answered empty: not "nobody"', fo(0, 5, true) === 'error');

  print('Reveal leaderboard with nobody joined (the Mini Bar fault)');
  C = makeConsole({ players: 0, board: [], fetchBoard: [] });
  C.finish(); await flush();
  show('the host gets the plain line, word for word',
       NOBODY_LINE === 'Nobody has joined this game yet, so there are no scores to show. Players join with the code on the TV.', NOBODY_LINE);
  show('and the console is told to show it', C.G.noPlayersNote === true);
  show('no error bar at all', C.errors.length === 0, JSON.stringify(C.errors));
  show('the TV is sent "nobody", not a podium or a board', C.types() === 'nobody', C.types());
  show('the real end: no between flag, so the TV says Thanks for playing', C.sent[0] && C.sent[0].between !== true, JSON.stringify(C.sent[0]));
  show('the night is not ended, so the button stays for a late joiner', C.G.status === 'reveal', C.G.status);
  show('the console repainted', C.renders() >= 1);

  print('no game id, so nothing proves the board is really empty');
  C = makeConsole({ players: 0, board: [], gameId: '' }); C.G.gameId = '';
  C.finish(); await flush();
  show('no game id and no fetch: nothing proves the board is really empty, so it is the real error, not "nobody"',
       C.errors.length === 1 && /could not be loaded/.test(C.errors[0]) && C.types() === '', C.errors.join('|') + ' / ' + C.types());

  print('a real fetch failure with players present');
  C = makeConsole({ players: 4, board: [], fetchFails: true });
  C.finish(); await flush();
  show('the real "could not be loaded" message', C.errors.length === 1 && /^Scores could not be loaded, so the podium was not put on the screen\./.test(C.errors[0]), C.errors.join('|'));
  show('nothing calm goes to the TV and no podium either', C.types() === '', C.types());
  show('no "nobody joined" line', C.G.noPlayersNote === false);
  show('the night is not ended', C.G.status === 'reveal');

  print('players present, scores come back on the retry');
  C = makeConsole({ players: 4, board: [], fetchBoard: [{ name: 'A', points: 300 }, { name: 'B', points: 200 }, { name: 'C', points: 100 }] });
  C.finish(); await flush();
  show('the podium goes out first, on its own (the full end of the night is tools/test-trivia-endnight.js)', C.types() === 'podium', C.types());
  show('the night ends and there is no error', C.G.status === 'ended' && C.errors.length === 0);

  print('the host taps again after someone joins');
  C = makeConsole({ players: 0, board: [], fetchBoard: [] });
  C.finish(); await flush();
  C.setPlayers(2);
  show('the first tap left the calm line up', C.G.noPlayersNote === true);
  C.finish(); await flush();
  show('the next tap clears the line, and with phones in but no scores it is the real error, not "nobody"',
       C.G.noPlayersNote === false && C.errors.length === 1 && /could not be loaded/.test(C.errors[0]), C.errors.join('|'));

  print('the between-question auto follow-up');
  C = makeConsole({ players: 0, qseq: 3, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  show('reveal went to the TV first, and tells the TV not to roll to a board by itself', C.types() === 'reveal' && C.sent[0].board === false, C.types() + ' ' + JSON.stringify(C.sent[0]));
  C.timers.slice().forEach(function (f) { f(); });
  show('with nobody joined the 5 second follow-up sends NOTHING: the answer stays up, never the join screen, an empty board or Thanks for playing (Jobs 523)', C.types() === 'reveal', C.types());

  print('the scores only at the end of a round (Dean, 7 Nov 2026)');
  C = makeConsole({ players: 3, qseq: 3, fetchBoard: [{ name: 'A', points: 100 }] });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice().forEach(function (f) { f(); });
  show('mid-round with players: the answer stays up, no leaderboard after it', C.types() === 'reveal' && C.sent[0].board === false, C.types());
  C = makeConsole({ players: 3, qseq: 9, qtotal: 20, fetchBoard: [{ name: 'A', points: 100 }] });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice().forEach(function (f) { f(); });
  show('question 9 of 20: still mid-round, nothing follows', C.types() === 'reveal', C.types());
  var B4 = [{ name: 'A', points: 100 }, { name: 'B', points: 90 }, { name: 'C', points: 80 }, { name: 'D', points: 70 }];
  C = makeConsole({ players: 3, qseq: 10, qtotal: 20, fetchBoard: B4 });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice(0, 1).forEach(function (f) { f(); });
  show('a 20-question night, question 10 (the end of round 1): the podium, the top three, round 1, on the TV only',
       C.types() === 'reveal,podium' && C.sent[1].tvOnly === true && C.sent[1].round === 1 && C.sent[1].top.length === 3, C.types() + ' ' + JSON.stringify(C.sent[1]));
  C.timers.slice(1).forEach(function (f) { f(); });
  show('then the whole leaderboard, "Leaderboard after round 1", every team, on the TV only',
       C.types() === 'reveal,podium,leaderboard' && C.sent[2].title === 'Leaderboard after round 1' && C.sent[2].rows.length === 4 && C.sent[2].tvOnly === true, C.types() + ' ' + (C.sent[2] && C.sent[2].title));
  show('ten seconds after the podium', /var ROUND_BOARD_MS=10000;/.test(HOST));
  C = makeConsole({ players: 3, qseq: 10, qtotal: 20, fetchBoard: B4 });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice(0, 1).forEach(function (f) { f(); }); C.G.status = 'question';
  C.timers.slice(1).forEach(function (f) { f(); });
  show('the host went on before the board: it never lands on the next question', C.types() === 'reveal,podium', C.types());
  C = makeConsole({ players: 3, qseq: 10, qtotal: 20, fetchBoard: B4, roundBoard: false });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice().forEach(function (f) { f(); });
  show('"Show the leaderboard after each round" switched off: no podium and no board at the round end', C.types() === 'reveal', C.types());
  C = makeConsole({ players: 0, qseq: 10, qtotal: 20, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  C.timers.slice().forEach(function (f) { f(); });
  show('the end of round 1 with nobody joined: nothing follows the answer, never an empty podium or the join screen (Jobs 523)', C.types() === 'reveal', C.types());
  C = makeConsole({ players: 0, qseq: 10, fetchBoard: [] });
  C.G.status = 'question'; C.reveal(); await flush();
  show('after the last question nothing is scheduled: the host reveals by hand', C.timers.length === 0, C.timers.length + ' timers');

  print('the TV listens for it');
  var SCREEN = readFile('venueplay/app/trivia/screen.html');
  show('"nobody" is a host message the TV recognises', /HOST_TYPES=\{[^}]*\bnobody:1/.test(SCREEN));
  var bi = SCREEN.indexOf('m.t==="nobody"){'), bj = SCREEN.indexOf('else if(m.t==="podium")', bi);
  var BLOCK = bi < 0 || bj < 0 ? '' : SCREEN.slice(bi, bj).replace(/\/\*[\s\S]*?\*\//g, '');   // the TV's own handler, comments left out
  show('the TV has a handler for it', BLOCK.length > 50);
  show('the TV paints "Thanks for playing" for it', /renderBoardPaged\("Thanks for playing", \[\]\)/.test(BLOCK), BLOCK.slice(0, 120));
  /* BETWEEN QUESTIONS (Dean, 15 Nov 2026; Jobs 523, 20 Nov 2026): the TV's own handlers, run on a fake wall. */
  var fnB = '';
  var li = SCREEN.indexOf('else if(m.t==="leaderboard"){'), lj = SCREEN.indexOf('else if(m.t==="nobody"', li);
  var LB = SCREEN.slice(li, lj);
  /* THE ROLL AFTER A REVEAL, run for real: the TV's renderReveal() and its leaderboard branch, on a fake wall whose
     timers are fired by hand. The reveal can carry an empty board that the console fills a moment later. */
  var li = SCREEN.indexOf('else if(m.t==="leaderboard"){'), lj = SCREEN.indexOf('else if(m.t==="nobody"', li);
  var LBSRC = 'function onLb(m){ if(false){} ' + SCREEN.slice(li, lj) + ' }';
  /* and the two "nobody" branches after it, for the between-questions message an older console may still send */
  var NBSRC = 'function onNb(m){ if(false){} ' + SCREEN.slice(lj, SCREEN.indexOf('else if(m.t==="podium")', lj)) + ' }';
  function wall() {
    var els = {}, painted = [], shown = [], timers = [];
    function mk(id) { var c = {}; return { id:id, textContent:'', innerHTML:'', className:'', style:{}, children:[], parentNode:null, nextSibling:null,
      classList:{ add:function(x){ c[x]=1; }, remove:function(x){ delete c[x]; }, toggle:function(x,on){ if(on) c[x]=1; else delete c[x]; }, contains:function(x){ return !!c[x]; } },
      appendChild:function(k){ this.children.push(k); return k; }, setAttribute:function(){}, removeAttribute:function(){}, getAttribute:function(){ return null; } }; }
    function $(id) { return els[id] || (els[id] = mk(id)); }
    var env = { $:$, el:function(){ return mk('x'); }, esc:String, LETTERS:['A','B','C','D'], VP_DEMO:false, state:{ phase:'reveal' },
      show:function(w){ shown.push(w); }, qClass:function(){ return 'qtext'; }, ansLenClass:function(){ return ''; }, applyColour:function(){},
      renderRows:function(){}, stopRing:function(){}, triviaEndShow:function(){},
      renderBoardPaged:function(t, rows){ painted.push([t, (rows || []).length]); },
      setTimeout:function(f){ timers.push(f); return timers.length; }, clearTimeout:function(){}, clearInterval:function(){} };
    var src = 'function staleAfterEnd(){ return false; }   /* the finished-quiz guard: tools/test-tv-follows-finished-game.js */\nvar curQ={ options:["a","b","c","d"], label:"Question 1", text:"Q?" }, boardRollTimer=null, rollRows=null, celebrateTimer=null;\n' +
      fnB + '\n' + (function(){ var i=SCREEN.indexOf('function renderReveal('), dd=0, k=SCREEN.indexOf('{',i); do{ if(SCREEN[k]==='{')dd++; else if(SCREEN[k]==='}')dd--; k++; }while(dd>0); return SCREEN.slice(i,k); })() +
      '\n' + LBSRC + '\n' + NBSRC + '\n; return { rev: renderReveal, lb: onLb, nb: onNb, roll: function(){ var f=__t.pop(); if(f) f(); }, $: $ };';
    var names = Object.keys(env).concat(['__t', 'renderLobby']);
    var vals = names.map(function (k) { return k === '__t' ? timers : k === 'renderLobby' ? function(){} : env[k]; });
    var api = new Function(names.join(','), src).apply(null, vals);
    api.painted = painted; api.shown = shown; api.state = env.state;
    return api;
  }
  var REV = { t:'reveal', qseq:1, correctIndex:1, options:['a','b','c','d'], split:[0,1,0,0] };
  var w1 = wall(); w1.rev(Object.assign({ leaderboard: [] }, REV));
  w1.lb({ t:'leaderboard', title:'Leaderboard', rows:[{ name:'Quiz Kids', points:100 }] });   // the console's own board, while the roll is pending
  w1.roll();
  show('the reveal carried an empty board and the console\'s filled one came during the wait: the wall rolls to the FILLED board',
       JSON.stringify(w1.painted) === '[["Leaderboard",1]]', JSON.stringify(w1.painted));
  var w2 = wall(); w2.rev(Object.assign({ leaderboard: [] }, REV)); w2.roll();
  show('no rows anywhere: no board is painted at all (never a LEADERBOARD title with nothing under it); the answer stays up',
       w2.painted.length === 0 && w2.shown.indexOf('tvBoard') < 0 && w2.shown.indexOf('tvLobby') < 0, JSON.stringify([w2.painted, w2.shown]));
  var w3 = wall(); w3.state.phase = 'reveal'; w3.lb({ t:'leaderboard', title:'Leaderboard', rows:[] });
  show('an empty leaderboard message (not the final scores) paints nothing', w3.painted.length === 0 && w3.shown.indexOf('tvBoard') < 0, JSON.stringify([w3.painted, w3.shown]));
  var w4 = wall(); w4.rev(Object.assign({ leaderboard: [{ name:'A', points:100 }, { name:'B', points:0 }] }, REV)); w4.roll();
  show('CONTROL: a reveal that carries its board still rolls to it', JSON.stringify(w4.painted) === '[["Leaderboard",2]]', JSON.stringify(w4.painted));
  /* JOBS 523 (real night 20 Nov 2026, The Mini Bar, 0 phones): between Q1's answer and Q2 the wall showed the join screen,
     SCAN TO PLAY. A "nobody" with between:true (an older console still open on a tablet sends it) changes NOTHING on the
     wall: the answer stays up, no join screen, no board, no Thanks for playing, and the quiz is still on. */
  var w5 = wall(); w5.rev(Object.assign({ leaderboard: [] }, REV)); w5.shown.length = 0;
  w5.nb({ t:'nobody', between:true }); w5.roll();
  show('between questions with nobody joined, the wall stays on the answer: no join screen, no board (Jobs 523)',
       w5.shown.length === 0 && w5.painted.length === 0, JSON.stringify([w5.shown, w5.painted]));
  show('and the quiz is still on (the phase is still the reveal, not the lobby, not done)', w5.state.phase === 'reveal' && w5.state.done !== true, JSON.stringify(w5.state));
  var w6 = wall(); w6.rev(Object.assign({ leaderboard: [] }, REV)); w6.shown.length = 0;
  w6.nb({ t:'nobody' });
  show('CONTROL: the real end (no between flag) still says Thanks for playing', JSON.stringify(w6.painted) === '[["Thanks for playing",0]]' && w6.shown.indexOf('tvBoard') >= 0 && w6.state.done === true, JSON.stringify([w6.shown, w6.painted]));
  show('the TV has no between-questions join screen any more (betweenJoin gone)', SCREEN.indexOf('function betweenJoin(') < 0);

  show('and it never paints an error word on the wall for it', !/could not|error|failed|connection/i.test(BLOCK), BLOCK);
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (bad) throw new Error('no players: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
