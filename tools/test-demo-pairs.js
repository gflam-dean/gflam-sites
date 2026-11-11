/* THE WEBSITE DEMOS: EVERY TV AND PHONE PAIR ON ONE TIMELINE (Dean, 12 Nov 2026, the live site after the release).

   Dean, watching the game demos on the home page and /see-a-night:
     1. MUSICAL BINGO: "the demo phone lags behind the demo TV". The wall was sent reveal:false, which it reads as its
        legacy mode and names the song 0.85 s later on its OWN timer; the phone marked the song 3.6 s in. So the room
        saw the title on the TV and the phone caught up nearly three seconds later, every song.
     2. BINGO: "the demo TV calls different numbers from what the demo phone shows". tv.html and play.html each ran
        their own setTimeout chain (first ball 5.4 s on the wall, 2.6 s on the phone; laps of different lengths), and
        the phone's ticket never completed, while the wall gave the game to a "Jess" nobody saw.
     3. THE DRAWS: "not the new look". The raffle and members walls played the old spinning tiles on timers of their own.

   Now every demo reads its script and its clock from /app/vp-demo-clock.js (BINGO, MUSICAL, RAFFLE, MEMBERS, as trivia
   already did), from the one start the sales page puts on every frame (?t0=).

   RUNS the shipped code: the real vp-demo-clock.js and the demo blocks lifted out of tv.html, play.html,
   app/musical/screen.html + play.html, app/raffle/screen.html and app/members/screen.html, each in a "frame" of its
   own (its own window, document and timers) on ONE fake wall clock, with onMsg recording what the page would paint.
   Then it samples the pair every 100 ms for several laps, the phone loading late:

     1. bingo: the TV and the phone on the same ball at every sample; the claim and the win in the same tick, and the
        win is the phone's own player and ticket; the ticket is a real 90-ball ticket whose top line completes on the
        last ball and no sooner; a phone that joins after the win shows the win
     2. musical bingo: the wall names each song in the same tick the phone marks it; the wall is never sent
        reveal:false (its own 0.85 s timer)
     3. the raffle and the members draw: two walls loaded 5.3 s apart (the room TV and "The big screen") show the
        same draw at every sample; every draw is the new look (ticket roll / flip board, a draw time, the server's
        pick before the winner, one winning ticket)

   Run: jsc tools/test-demo-pairs.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }

var CLOCK = readFile('venueplay/app/vp-demo-clock.js');
var TV = readFile('venueplay/tv.html');
var PLAY = readFile('venueplay/play.html');
var MSCREEN = readFile('venueplay/app/musical/screen.html');
var MPLAY = readFile('venueplay/app/musical/play.html');
var RSCREEN = readFile('venueplay/app/raffle/screen.html');
var MEMSCREEN = readFile('venueplay/app/members/screen.html');

/* The block that starts at `from` and ends where its braces close. */
function block(text, from, label) {
  var i = text.indexOf(from);
  if (i < 0) throw new Error('cannot find "' + from.slice(0, 50) + '" in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k);
}
function between(text, from, to, label) {
  var i = text.indexOf(from), j = text.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('cannot find the demo block in ' + label + ' - a test that cannot find its subject cannot fail');
  return text.slice(i, j);
}
var TV_BINGO = block(TV, 'if(DEMO && !DEMO_ADS_ONLY){', 'tv.html');
var PH_BINGO = block(PLAY, 'if(/[?&]demo=1/.test(window.location.search||"")){\n      document.documentElement.setAttribute("data-vp-demo","1");\n      P.room="VENUE2"', 'play.html');
var TV_MUSICAL = block(MSCREEN, 'if(VP_DEMO){\n    document.documentElement.setAttribute("data-vp-demo","1");\n    (function demoNight(){', 'musical/screen.html');
var PH_MUSICAL = between(MPLAY, '  var VP_DEMO = /[?&]demo=1/.test(window.location.search||"");', '  // ---- init: read ?room', 'musical/play.html');
var TV_RAFFLE = block(RSCREEN, 'if(VP_DEMO){\n    document.documentElement.setAttribute("data-vp-demo","1");\n    (function demoNight(){', 'raffle/screen.html');
var TV_MEMBERS = block(MEMSCREEN, 'if(VP_DEMO){\n    document.documentElement.setAttribute("data-vp-demo","1");\n    (function demoNight(){', 'members/screen.html');

/* ONE WALL CLOCK for every frame, and a timer list per frame that the clock drives. */
var NOW = 0;
var FakeDate = { now: function () { return NOW; } };
function el() {
  var c = {};
  var e = { style: {}, textContent: '', innerHTML: '', disabled: false, parentNode: null, src: '',
    classList: { add: function (x) { c[x] = 1; }, remove: function (x) { delete c[x]; }, contains: function (x) { return !!c[x]; }, toggle: function () {} },
    setAttribute: function () {}, getAttribute: function () { return null; }, appendChild: function (k) { return k; }, addEventListener: function () {} };
  e.parentNode = { style: {}, classList: e.classList };
  return e;
}
function frame(search, opts) {
  opts = opts || {};
  var timers = [], seq = 0, listeners = {}, els = {}, got = [];
  var doc = { hidden: false, documentElement: { setAttribute: function () {} }, body: {},
    getElementById: function (id) { return els[id] || (els[id] = el()); },
    addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); } };
  var win = { location: { search: search, pathname: '/x' }, top: {}, self: null,
    addEventListener: function (n, f) { (listeners['w:' + n] = listeners['w:' + n] || []).push(f); },
    VPSting: { on: opts.sting !== false, stopped: 0, stop: function () { this.stopped++; } } };
  win.self = win;
  function setInterval(fn, ms) { var t = { id: ++seq, fn: fn, ms: ms, next: NOW + ms, every: true }; timers.push(t); return t.id; }
  function setTimeout(fn, ms) { var t = { id: ++seq, fn: fn, ms: ms, next: NOW + (ms || 0), every: false }; timers.push(t); return t.id; }
  function clear(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', CLOCK)(win, doc, setInterval, setTimeout, clear, clear, FakeDate);
  return { win: win, doc: doc, got: got, els: els, set: setInterval, setT: setTimeout, clear: clear,
    pump: function () { if (doc.hidden) return; for (var g = 0; g < 50; g++) { var due = timers.filter(function (t) { return t.next <= NOW; }); if (!due.length) return;
      due.forEach(function (t) { if (t.every) t.next = NOW + t.ms; else clear(t.id); t.fn(); }); } } };
}
var MO = function () { this.observe = function () {}; };
var QUIET = { warn: function () {} };
function rec(f) { return function (m) { f.got.push({ at: NOW, m: JSON.parse(JSON.stringify(m)) }); }; }

function bingoTv(search, opts) {
  var f = frame(search, opts);
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'onMsg', 'DEMO_JOIN_CODE', 'DEMO', 'DEMO_ADS_ONLY', 'MutationObserver', 'console',
    TV_BINGO)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, rec(f), 'VENUE2', true, false, MO, QUIET);
  return f;
}
function bingoPhone(search, opts) {
  var f = frame(search, opts);
  var P = { cards: [] }; f.P = P; f.msg = '';
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'onMsg', 'P', '$', 'setMsg', 'VPVenueLogo', 'console',
    '(function(){' + PH_BINGO + '})();')(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock,
      function (m) { rec(f)(m); if (m.t === 'started') { P.won = false; P.claimPending = false; } if (m.t === 'cards') P.cards = m.cards; if (m.t === 'winner') { var me = (m.winners || []).filter(function (w) { return w.pid === P.pid; })[0]; if (me) P.won = true; } },
      P, function (id) { return f.doc.getElementById(id); }, function (h) { f.msg = h; }, { fit: function () {}, headerName: function () {} }, QUIET);
  return f;
}
function musicalTv(search, opts) {
  var f = frame(search, opts);
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'DEMO_JOIN_CODE', 'VP_DEMO', 'MutationObserver', 'console',
    TV_MUSICAL)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting, rec(f), 'VENUE2', true, MO, QUIET);
  return f;
}
function musicalPhone(search, opts) {
  var f = frame(search, opts);
  var P = {}; f.P = P;
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'P', '$', 'route', 'renderCard', 'cellTitle', 'setMsg', 'VPVenueLogo', 'console',
    '(function(){' + PH_MUSICAL + '})();')(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting,
      rec(f), P, function (id) { return f.doc.getElementById(id); },
      function () {}, function () {}, function (i) { return P.cells && P.cells[i] && P.cells[i].title; }, function () {}, { fit: function () {}, headerName: function () {} }, QUIET);
  return f;
}
function drawTv(src, label, search, opts) {
  var f = frame(search, opts);
  f.S = { endDrawn: [], endPend: null }; f.state = { drawnList: [] }; f.rows = [];
  /* The two lists the real screens keep: the raffle's "claimed" adds to S.endDrawn (its drawn row) and the members
     "winner" to state.drawnList, as app/raffle/screen.html and app/members/screen.html do. */
  function onMsg(m) {
    rec(f)(m);
    if (m.t === 'drawing') f.rows.push([m.prizeNo || 0, src === TV_RAFFLE ? f.S.endDrawn.length : f.state.drawnList.length]);
    if (m.t === 'claimed' && m.numbers) f.S.endDrawn.push({ nums: m.numbers });
    if (m.t === 'winner' && m.number != null) f.state.drawnList.push(String(m.number));
  }
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'onMsg', 'VP_DEMO', 'MutationObserver', 'console', 'S', 'state',
    src)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, onMsg, true, MO, QUIET, f.S, f.state);
  return f;
}
function last(f, types) { for (var i = f.got.length - 1; i >= 0; i--) if (types[f.got[i].m.t]) return f.got[i].m; return null; }
var T0 = 1762480000000;   // a fixed start (never derived from the real clock)

/* =============================================================================================== 1 */
print('1. bingo: the TV and the phone call the same numbers, at the same moment');
(function () {
  NOW = T0 + 30;
  var tv = bingoTv('?demo=1&t0=' + T0);
  NOW = T0 + 2850;                                       // the phone frame loads 2.85 s late (a heavy wall, a light phone, or the other way)
  var ph = bingoPhone('?demo=1&t0=' + T0);
  var C = tv.win.VPDemoClock.BINGO, LAP = C.lap(), miss = [], samples = 0, laps = {};
  for (NOW = T0 + 2850; NOW <= T0 + 3 * LAP + 1500; NOW += 100) {
    tv.pump(); ph.pump();
    var a = last(tv, { ball: 1, started: 1, idle: 1 }), b = last(ph, { ball: 1, started: 1 });
    var w = tv.win.VPDemoClock.where(T0, LAP, NOW); laps[w.lap] = 1;
    var an = a && a.t === 'ball' ? a.number : 0, bn = b && b.t === 'ball' ? b.number : 0;
    if (a && a.t === 'idle') continue;               // the wall back to its lobby after the win; the phone keeps its win screen
    samples++;
    if (an !== bn) miss.push(Math.round((NOW - T0) / 100) / 10 + 's TV ' + an + ' phone ' + bn);
  }
  show('the same ball on the TV and the phone at every 100 ms sample over ' + Object.keys(laps).length + ' laps (' + samples + ' samples), the phone loaded 2.85 s late',
    miss.length === 0 && samples > 300 && Object.keys(laps).length >= 3, miss.slice(0, 4).join(' | '));
  var tb = tv.got.filter(function (g) { return g.m.t === 'ball'; }), pb = ph.got.filter(function (g) { return g.m.t === 'ball' && g.m.number; });
  var lap2tv = tb.filter(function (g) { return g.at >= T0 + LAP && g.at < T0 + 2 * LAP; }), lap2ph = pb.filter(function (g) { return g.at >= T0 + LAP && g.at < T0 + 2 * LAP; });
  show('in the second lap each ball lands on both in the same tick (12 balls, the phone\'s claim re-send aside)',
    lap2tv.length === 12 && lap2tv.every(function (g, i) { return lap2ph[i] && lap2ph[i].m.number === g.m.number && lap2ph[i].at === g.at; }),
    JSON.stringify([lap2tv.map(function (g) { return [g.m.number, g.at - T0]; }).slice(0, 3), lap2ph.map(function (g) { return [g.m.number, g.at - T0]; }).slice(0, 3)]));
  show('the TV calls the balls in the order the phone does: 7, 42, 13 ... 19, 53', lap2tv.map(function (g) { return g.m.number; }).join(',') === C.BALLS.join(','), lap2tv.map(function (g) { return g.m.number; }).join(','));
  var claimTv = tv.got.filter(function (g) { return g.m.t === 'claim_pending'; }), winTv = tv.got.filter(function (g) { return g.m.t === 'winner'; }), winPh = ph.got.filter(function (g) { return g.m.t === 'winner'; });
  show('the TV\'s claim and win are the phone\'s own player and ticket ("' + C.PLAYER + '", #' + C.CARD_NO + ')',
    claimTv.length >= 3 && claimTv.every(function (g) { return g.m.name === C.PLAYER && g.m.cardNo === C.CARD_NO; }) && winTv.every(function (g) { return g.m.name === C.PLAYER && g.m.cardNo === C.CARD_NO; }),
    JSON.stringify(claimTv.slice(0, 1)) + JSON.stringify(winTv.slice(0, 1)));
  show('the win lands on the TV and the phone in the same tick, every lap', winTv.length >= 3 && winTv.length === winPh.length && winTv.every(function (g, i) { return g.at === winPh[i].at; }),
    JSON.stringify([winTv.map(function (g) { return g.at - T0; }), winPh.map(function (g) { return g.at - T0; })]));
  show('and the phone takes it as its own win (its pid is the winner\'s)', winPh.length && winPh[0].m.winners[0].pid === ph.P.pid && ph.P.pid === 'demo', JSON.stringify(winPh[0] && winPh[0].m));
  show('the TV\'s prize and the phone\'s are the same words, and not a dollar prize', tv.got.filter(function (g) { return g.m.t === 'started'; }).every(function (g) { return g.m.prize === C.PRIZE; }) && ph.got.filter(function (g) { return g.m.t === 'cards'; }).every(function (g) { return g.m.prize === C.PRIZE; }) && !/\$/.test(C.PRIZE), C.PRIZE);
  // a phone that joins after the win, and one that joins mid-claim
  NOW = T0 + C.winAt() + 600;
  var late = bingoPhone('?demo=1&t0=' + T0); late.pump();
  show('a phone that loads just after the win shows the win (the cards first, then the win)', late.P.won === true && late.P.cards.length === 1, JSON.stringify({ won: late.P.won, cards: late.P.cards.length }));
  NOW = T0 + C.claimAt() + 300;
  var mid = bingoPhone('?demo=1&t0=' + T0); mid.pump();
  show('one that loads during the claim shows "BINGO sent" on a ticket with all twelve balls called', mid.P.claimPending === true && /BINGO sent/.test(mid.msg) && last(mid, { ball: 1 }).called.length === 12, mid.msg);
})();
(function () {
  var C = (function () { var f = frame('?demo=1'); return f.win.VPDemoClock.BINGO; })();
  var T = C.TICKET, nums = [], ok = T.length === 3, why = [];
  T.forEach(function (row, r) {
    var n = row.filter(function (x) { return x != null; });
    if (n.length !== 5 || row.length !== 9) { ok = false; why.push('row ' + r + ' has ' + n.length); }
    row.forEach(function (x, c) { if (x == null) return; nums.push(x); var lo = c === 0 ? 1 : c * 10, hi = c === 8 ? 90 : c * 10 + 9; if (x < lo || x > hi) { ok = false; why.push(x + ' not in column ' + c); } });
  });
  for (var c = 0; c < 9; c++) { var col = T.map(function (r) { return r[c]; }).filter(function (x) { return x != null; }); if (!col.length) { ok = false; why.push('column ' + c + ' empty'); } for (var k = 1; k < col.length; k++) if (col[k] <= col[k - 1]) { ok = false; why.push('column ' + c + ' not ascending'); } }
  show('the demo ticket is a real 90-ball ticket: 3 rows of 5, every column its own decade, ascending', ok && nums.length === 15, why.join('; '));
  function doneAt(row) { var need = row.filter(function (x) { return x != null; }), k; for (k = 0; k < C.BALLS.length; k++) { var called = C.BALLS.slice(0, k + 1); if (need.every(function (x) { return called.indexOf(x) >= 0; })) return k; } return -1; }
  var d = T.map(doneAt);
  show('its top line completes on the LAST ball (53) and no line completes sooner, so the claim comes when the TV shows it', d[0] === C.BALLS.length - 1 && d[1] === -1 && d[2] === -1, JSON.stringify(d));
})();

/* =============================================================================================== 2 */
print('\n2. musical bingo: the TV names the song in the same moment the phone marks it');
(function () {
  NOW = T0 + 40;
  var tv = musicalTv('?demo=1&t0=' + T0);
  NOW = T0 + 1900;
  var ph = musicalPhone('?demo=1&t0=' + T0);
  var C = tv.win.VPDemoClock.MUSICAL, LAP = C.lap(), miss = [], samples = 0;
  for (NOW = T0 + 1900; NOW <= T0 + 3 * LAP; NOW += 100) {
    tv.pump(); ph.pump();
    // what the wall has NAMED this lap: every reveal since its last "started"
    var named = [];
    for (var i = tv.got.length - 1; i >= 0; i--) { var m = tv.got[i].m; if (m.t === 'started') break; if (m.t === 'reveal') named.push(m.title); }
    var marked = [];
    for (var j = 0; j < 25; j++) { var cell = ph.P.cells && ph.P.cells[j]; if (cell && cell.title && ph.P.daubs && ph.P.daubs[j] && cell.title !== 'Wonderwall') marked.push(cell.title); }
    var inSong = C.SONGS.filter(function (s) { return marked.indexOf(s.title) >= 0; }).map(function (s) { return s.title; });
    samples++;
    if (named.sort().join('|') !== inSong.sort().join('|')) miss.push(Math.round((NOW - T0) / 100) / 10 + 's TV named [' + named.join(', ') + '] phone marked [' + inSong.join(', ') + ']');
  }
  show('at every 100 ms sample over 3 laps (' + samples + '), the songs the TV has named are exactly the songs the phone has marked', miss.length === 0 && samples > 500, miss.slice(0, 3).join(' | '));
  var played = tv.got.filter(function (g) { return g.m.t === 'played'; });
  show('the wall is never sent reveal:false (its own 0.85 s timer, ahead of the phone); it waits for the script\'s reveal', played.length >= 10 && played.every(function (g) { return g.m.reveal === 'end'; }), JSON.stringify(played.slice(0, 1).map(function (g) { return g.m.reveal; })));
  var rv = tv.got.filter(function (g) { return g.m.t === 'reveal'; }).map(function (g) { return g.at - T0; }).slice(0, 5);
  show('the wall names song n at C.revealAt(n), 2.6 s into it', rv.length === 5 && rv.every(function (t, i) { return t >= C.revealAt(i) && t <= C.revealAt(i) + 100; }), JSON.stringify(rv));
})();

/* =============================================================================================== 3 */
print('\n3. the draws: the new look, on the one clock');
function drawPair(src, label, which) {
  NOW = T0 + 20;
  var a = drawTv(src, label, '?demo=1&t0=' + T0);
  NOW = T0 + 5300;                       // "The big screen" opened 5.3 s after the room TV
  var b = drawTv(src, label, '?demo=1&t0=' + T0);
  var C = a.win.VPDemoClock[which], LAP = C.lap(), miss = [], samples = 0;
  var TYPES = { state: 1, idle: 1, drawing: 1, winner: 1, claimed: 1, rollover: 1 };
  for (NOW = T0 + 5300; NOW <= T0 + 3 * LAP; NOW += 100) {
    a.pump(); b.pump();
    var x = last(a, TYPES), y = last(b, TYPES);
    samples++;
    var kx = x && (x.t + ':' + (x.number || (x.numbers || [])[0] || x.missedNumber || x.name || '')), ky = y && (y.t + ':' + (y.number || (y.numbers || [])[0] || y.missedNumber || y.name || ''));
    if (kx !== ky) miss.push(Math.round((NOW - T0) / 100) / 10 + 's room TV ' + kx + ' big screen ' + ky);
  }
  show(label + ': the room TV and "The big screen" (opened 5.3 s later) on the same draw at every 100 ms sample over 3 laps (' + samples + ')', miss.length === 0 && samples > 300, miss.slice(0, 3).join(' | '));
  return { a: a, b: b, C: C };
}
(function () {
  var r = drawPair(TV_RAFFLE, 'the raffle', 'RAFFLE'), a = r.a, C = r.C;
  var dr = a.got.filter(function (g) { return g.m.t === 'drawing'; });
  show('every raffle draw is the TICKET ROLL at the short draw time, with the raffle\'s name and "Prize n of 3"',
    dr.length >= 6 && dr.every(function (g, i) { return g.m.style === 'ticket' && g.m.drawSecs === 6 && g.m.raffle === C.NAME && g.m.prizeOf === 3 && g.m.prizeNo >= 1 && g.m.pad === 3 && g.m.max === 150; }),
    JSON.stringify(dr.slice(0, 1).map(function (g) { return g.m; })));
  var ok = true, why = '';
  a.got.forEach(function (g, i) { if (g.m.t !== 'winner') return; var p = null; for (var k = i - 1; k >= 0; k--) { if (a.got[k].m.t === 'pick') { p = a.got[k].m; break; } if (a.got[k].m.t === 'drawing') break; }
    if (!p || g.m.numbers.length !== 1 || p.numbers[0] !== g.m.numbers[0]) { ok = false; why = JSON.stringify([p, g.m]); } });
  show('each winning ticket is ONE ticket, told to the roll first by t:"pick" (as the console does), never invented', ok, why);
  var tix = a.got.filter(function (g) { return g.m.t === 'winner'; }).slice(0, 3).map(function (g) { return g.m.numbers[0]; }).join(',');
  show('the tickets are the ones the see-a-night host console shows (087, 042, 131)', tix === '87,42,131', tix);
  show('every draw\'s drawn row is that lap\'s draws before it, lap after lap (it does not grow from lap to lap)',
    a.rows.length >= 6 && a.rows.every(function (x) { return x[1] === x[0] - 1; }), JSON.stringify(a.rows));
})();
(function () {
  var r = drawPair(TV_MEMBERS, 'the members draw', 'MEMBERS'), a = r.a, C = r.C;
  var dr = a.got.filter(function (g) { return g.m.t === 'drawing'; });
  show('every members draw is the FLIP BOARD at the short draw time, with the draw\'s name and its members\' number range',
    dr.length >= 4 && dr.every(function (g) { return g.m.style === 'flip' && g.m.drawSecs === 6 && g.m.drawName === C.NAME && g.m.minNumber === 1 && g.m.maxNumber === 380; }), JSON.stringify(dr.slice(0, 1).map(function (g) { return g.m; })));
  var ok = true, why = '';
  a.got.forEach(function (g, i) { if (g.m.t !== 'winner') return; var p = null; for (var k = i - 1; k >= 0; k--) { if (a.got[k].m.t === 'pick') { p = a.got[k].m; break; } if (a.got[k].m.t === 'drawing') break; }
    if (!p || p.number !== g.m.number || p.name !== g.m.name) { ok = false; why = JSON.stringify([p, g.m]); } });
  show('each member drawn is told to the board first by t:"pick" with the same number and name', ok, why);
  var res = a.got.filter(function (g) { return g.m.t === 'rollover' || g.m.t === 'claimed'; }).slice(0, 2).map(function (g) { return g.m.t + ':' + (g.m.nextJackpotCents || g.m.amountCents); }).join(',');
  show('every members draw\'s drawn row is that lap\'s members before it, lap after lap', a.rows.length >= 4 && a.rows.every(function (x, i) { return x[1] === i % 2; }), JSON.stringify(a.rows));
  show('the first member is not there and the jackpot rolls over to $1,320; the second claims $1,320 (the host console\'s numbers)', res === 'rollover:132000,claimed:132000', res);
})();

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
