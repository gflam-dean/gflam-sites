/* THE SALES-PAGE DEMOS: THE TV AND THE PHONE ON THE SAME QUESTION (Dean, 7 Nov 2026).

   Dean, playing the trivia demo on the offer page: "the AC/DC question seems to be a different question on the
   phone", the phone "seems to be lagging", and "The leaderboard running after every question is not good".

   The cause: the wall (app/trivia/screen.html ?demo=1) and the phone (app/trivia/play.html ?demo=1) each ran their
   own setTimeout chain from their own load. The phone added 900 ms on top (d(900, round)), the wall loads a dozen
   more scripts first, and a hidden tab throttled each chain differently, so nothing held them together. Now both
   take the script and the clock from /app/vp-demo-clock.js and one start time (?t0=, which the sales page puts on
   both frames).

   RUNS the shipped code: the real vp-demo-clock.js, and the demo blocks lifted out of the four pages, each in a
   "frame" of its own (its own window, document and timers) on ONE fake wall clock, with onMsg recording what the
   page would paint. Then it samples both frames every 100 ms for several laps:

     1. the clock itself: one start, a late frame joins where the night is, a tab back from hiding jumps to the
        step it is on and does not replay the ones it missed
     2. trivia: TV and phone on the same question (and the same clock) at every sample, across loop restarts,
        with the phone frame loading 3.7 s late and after 25 s hidden; a page on its own starts at its load
     3. trivia: the leaderboard only at the end of the round, after the podium, once a lap; never between
        questions; after an answer, the next question
     4. musical bingo: TV and phone on the same song at every sample, the same way, and the played list does
        not grow from lap to lap

   Run: jsc tools/test-demo-sync.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }

var CLOCK = readFile('venueplay/app/vp-demo-clock.js');
var TSCREEN = readFile('venueplay/app/trivia/screen.html');
var TPLAY = readFile('venueplay/app/trivia/play.html');
var MSCREEN = readFile('venueplay/app/musical/screen.html');
var MPLAY = readFile('venueplay/app/musical/play.html');
var NSW = readFile('venueplay/nsw.html');
var INDEX = readFile('venueplay/index.html');
var SAN = readFile('venueplay/see-a-night.html');

/* The block that starts at `from` and ends where its braces close. */
function block(text, from, label) {
  var i = text.indexOf(from);
  if (i < 0) throw new Error('cannot find "' + from.slice(0, 40) + '" in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k);
}
function between(text, from, to, label) {
  var i = text.indexOf(from), j = text.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('cannot find the demo block in ' + label + ' - a test that cannot find its subject cannot fail');
  return text.slice(i, j);
}
var TV_TRIVIA = block(TSCREEN, 'if(VP_DEMO){\n    document.documentElement.setAttribute("data-vp-demo","1");\n    (function demoQuiz(){', 'trivia/screen.html');
var PH_TRIVIA = between(TPLAY, '  var VP_DEMO = /[?&]demo=1/.test(window.location.search||"");', '  // ---- init: read ?room', 'trivia/play.html');
var TV_MUSICAL = block(MSCREEN, 'if(VP_DEMO){\n    document.documentElement.setAttribute("data-vp-demo","1");\n    (function demoNight(){', 'musical/screen.html');
var PH_MUSICAL = between(MPLAY, '  var VP_DEMO = /[?&]demo=1/.test(window.location.search||"");', '  // ---- init: read ?room', 'musical/play.html');

/* ONE WALL CLOCK for every frame, and a timer list per frame that the clock drives. */
var NOW = 0;
var FakeDate = { now: function () { return NOW; } };
function el() {
  var c = {};
  var e = { style: {}, textContent: '', disabled: false, parentNode: null, src: '',
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
  var win = { location: { search: search, pathname: '/x' }, top: {}, self: null, __vpDemoAutoplay: true,
    addEventListener: function (n, f) { (listeners['w:' + n] = listeners['w:' + n] || []).push(f); },
    VPSting: { on: opts.sting !== false, stopped: 0, stop: function () { this.stopped++; } } };
  win.self = win;
  function setInterval(fn, ms) { var t = { id: ++seq, fn: fn, ms: ms, next: NOW + ms, every: true }; timers.push(t); return t.id; }
  function setTimeout(fn, ms) { var t = { id: ++seq, fn: fn, ms: ms, next: NOW + (ms || 0), every: false }; timers.push(t); return t.id; }
  function clear(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', CLOCK)(win, doc, setInterval, setTimeout, clear, clear, FakeDate);
  return { win: win, doc: doc, got: got, els: els, set: setInterval, setT: setTimeout, clear: clear,
    /* Run every timer that is due. hidden: timers do not fire (a hidden, frozen tab). */
    pump: function () { if (doc.hidden) return; for (var g = 0; g < 50; g++) { var due = timers.filter(function (t) { return t.next <= NOW; }); if (!due.length) return;
      due.forEach(function (t) { if (t.every) t.next = NOW + t.ms; else clear(t.id); t.fn(); }); } },
    wake: function () { doc.hidden = false; (listeners.visibilitychange || []).forEach(function (f) { f(); }); } };
}

/* The trivia wall: onMsg records. The phone: onMsg records; answer() is the page's tap, recorded. */
function triviaTv(search, opts) {
  var f = frame(search, opts);
  var MO = function () { this.observe = function () {}; };
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'DEMO_JOIN_CODE', 'VP_DEMO', 'MutationObserver', 'console',
    TV_TRIVIA)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting, function (m) { f.got.push({ at: NOW, m: m }); }, 'VENUE2', true, MO, { warn: function () {} });
  return f;
}
function triviaPhone(search, opts) {
  var f = frame(search, opts);
  var P = {};
  f.P = P;
  var body = '(function(){' + PH_TRIVIA + '})();';
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'P', '$', 'answer', 'showWait', 'headerVenue', 'VPVenueLogo', 'el', 'stopCd', 'show', 'deviceId', 'fetch', 'console',
    body)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting,
      function (m) { f.got.push({ at: NOW, m: m }); }, P, function (id) { return f.doc.getElementById(id); },
      function (i) { f.got.push({ at: NOW, m: { t: 'tap', i: i } }); }, function () {}, function () {}, { fit: function () {} }, el, function () {}, function () {}, function () { return 'd'; }, function () {}, { warn: function () {} });
  return f;
}
function musicalTv(search, opts) {
  var f = frame(search, opts);
  var MO = function () { this.observe = function () {}; };
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'DEMO_JOIN_CODE', 'VP_DEMO', 'MutationObserver', 'console',
    TV_MUSICAL)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting, function (m) { f.got.push({ at: NOW, m: m }); }, 'VENUE2', true, MO, { warn: function () {} });
  return f;
}
function musicalPhone(search, opts) {
  var f = frame(search, opts);
  var P = {};
  f.P = P;
  var body = '(function(){' + PH_MUSICAL + '})();';
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date', 'VPDemoClock', 'VPSting', 'onMsg', 'P', '$', 'route', 'renderCard', 'cellTitle', 'setMsg', 'VPVenueLogo', 'console',
    body)(f.win, f.doc, f.set, f.setT, f.clear, f.clear, FakeDate, f.win.VPDemoClock, f.win.VPSting,
      function (m) { f.got.push({ at: NOW, m: m }); }, P, function (id) { return f.doc.getElementById(id); },
      function () {}, function () {}, function (i) { return P.cells && P.cells[i] && P.cells[i].title; }, function () {}, { fit: function () {}, headerName: function () {} }, { warn: function () {} });
  return f;
}

/* What a frame shows now: the last question (or song) it was sent, and the last screen-changing message. */
var SCREENS = { question: 1, reveal: 1, leaderboard: 1, podium: 1, idle: 1, started: 1, played: 1, winner: 1, claim_pending: 1, lock: 1 };
function now(f) {
  var q = null, s = null;
  for (var i = f.got.length - 1; i >= 0; i--) {
    var m = f.got[i].m;
    if (!s && SCREENS[m.t]) s = m;
    if (!q && (m.t === 'question' || m.t === 'played')) q = m;
    if (q && s) break;
  }
  return { q: q, s: s };
}
var T0 = 1762480000000;   // a fixed start (never derived from the real clock)

/* =============================================================================================== 1 */
print('1. the clock: one start, a late frame joins where the night is, a tab back from hiding');
(function () {
  NOW = T0;
  var f = frame('?demo=1&t0=' + T0);
  var C = f.win.VPDemoClock;
  show('?t0= is the start', C.epoch('?demo=1&t0=' + T0) === T0, C.epoch('?demo=1&t0=' + T0));
  show('no ?t0= (a demo page opened on its own): the night starts when the page loads', C.epoch('?demo=1') === T0);
  show('a ?t0= in the future is a pasted link, not a sales page: ignored', C.epoch('?demo=1&t0=' + (T0 + 60000)) === T0);
  show('a ?t0= more than a week old: ignored', C.epoch('?demo=1&t0=' + (T0 - 8 * 86400000)) === T0);
  var w = C.where(T0, 1000, T0 + 3500);
  show('3.5 s into 1 s laps: lap 3, 500 ms in, the lap started at 3 s', w.lap === 3 && w.p === 500 && w.base === T0 + 3000, JSON.stringify(w));
  var S = [{ at: 0, key: true }, { at: 100 }, { at: 200, key: true }, { at: 300 }, { at: 400 }];
  var d = C.due(S, -1, 350);
  show('a fresh lap at 350 ms starts at the last key step due (200), not at 0, and runs to 300', d.from === 2 && d.to === 4, JSON.stringify(d));
  d = C.due(S, 2, 120);
  show('nothing is due before its time', d.from === 2 && d.to === 2, JSON.stringify(d));
  // A real run: late join and a hidden tab.
  var log = [];
  var steps = [{ at: 0, key: true, always: true, fn: function () { log.push('setup'); } }, { at: 1000, key: true, fn: function () { log.push('q1'); } },
               { at: 1500, fn: function () { log.push('r1'); } }, { at: 2000, key: true, fn: function () { log.push('q2'); } }, { at: 2500, fn: function () { log.push('r2'); } }];
  NOW = T0 + 2200;
  var r = C.run({ lap: 3000, steps: steps, epoch: T0 });
  show('a frame that loads 2.2 s in: the opening (session, mode) and then the question it is on, nothing in between', log.join() === 'setup,q2', log.join());
  show('and the start-of-game show gives way at once, since the night is past it', f.win.VPSting.stopped === 1, f.win.VPSting.stopped);
  NOW = T0 + 2600; f.pump();
  show('then on, step by step', log.join() === 'setup,q2,r2', log.join());
  NOW = T0 + 3000 + 1700; f.doc.hidden = true; f.pump(); f.wake();
  show('hidden through a lap restart, back 1.7 s into the next lap: the opening, then the question it is on, then its answer', log.slice(3).join() === 'setup,q1,r1', log.join());
})();

/* =============================================================================================== 2 */
print('\n2. trivia: the TV and the phone on the same question at every moment');
function sameAllAlong(tv, ph, from, to, label) {
  var miss = [], samples = 0, laps = {};
  for (NOW = from; NOW <= to; NOW += 100) {
    tv.pump(); ph.pump();
    var a = now(tv), b = now(ph);
    if (!a.q || !b.q) continue;
    samples++;
    var C = tv.win.VPDemoClock, w = C.where(C.epoch(tv.win.location.search), C.TRIVIA.lap(), NOW); laps[w.lap] = 1;
    // Between the podium and the next lap's first question both are off the questions: compare only while the TV is on one.
    var onQ = a.s && (a.s.t === 'question' || a.s.t === 'reveal' || a.s.t === 'lock');
    if (!onQ) continue;
    if (a.q.text !== b.q.text || a.q.qi !== b.q.qi || a.q.endsAt !== b.q.endsAt) miss.push(Math.round((NOW - from) / 100) / 10 + 's TV "' + a.q.text.slice(0, 24) + '" phone "' + b.q.text.slice(0, 24) + '"');
  }
  return { miss: miss, samples: samples, laps: Object.keys(laps).length };
}
(function () {
  NOW = T0 + 50;
  var tv = triviaTv('?demo=1&t0=' + T0), ph = triviaPhone('?demo=1&t0=' + T0);
  var C = tv.win.VPDemoClock.TRIVIA, LAP = C.lap();
  var r = sameAllAlong(tv, ph, T0 + 50, T0 + 3 * LAP + 2000, 'together');
  show('loaded together: the same question, the same number and the same clock at every 100 ms sample over ' + r.laps + ' laps (' + r.samples + ' samples)', r.miss.length === 0 && r.samples > 500 && r.laps >= 4, r.miss.slice(0, 3).join(' | '));
  var asked = ph.got.filter(function (g) { return g.m.t === 'question'; }).map(function (g) { return g.m.qi; }).join(',');
  show('and the phone asks 8, 9, 10 of 10 every lap, never one twice', /^8,9,10,8,9,10,8,9,10/.test(asked), asked);
  var acdcTv = tv.got.filter(function (g) { return g.m.t === 'question' && /Back in Black/.test(g.m.text); }).map(function (g) { return g.at; });
  var acdcPh = ph.got.filter(function (g) { return g.m.t === 'question' && /Back in Black/.test(g.m.text); }).map(function (g) { return g.at; });
  show('the AC/DC question lands on both in the same 200 ms tick, every lap', acdcTv.length >= 3 && acdcTv.length === acdcPh.length && acdcTv.every(function (t, i) { return Math.abs(t - acdcPh[i]) <= 200; }), JSON.stringify([acdcTv, acdcPh]));
  var rv = ph.got.filter(function (g) { return g.m.t === 'reveal'; });
  show('the phone\'s answer comes with the wall\'s (same answer, within one tick)', rv.length >= 9 && rv.every(function (g) { var t = tv.got.filter(function (x) { return x.m.t === 'reveal' && Math.abs(x.at - g.at) <= 200; })[0]; return t && t.m.correctIndex === g.m.correctIndex; }), rv.length);

  // A SLOW PHONE: its frame finishes loading 3.7 s after the TV's.
  NOW = T0 + 100;
  var tv2 = triviaTv('?demo=1&t0=' + T0);
  for (NOW = T0 + 100; NOW < T0 + 3800; NOW += 100) tv2.pump();
  var ph2 = triviaPhone('?demo=1&t0=' + T0);
  r = sameAllAlong(tv2, ph2, NOW, T0 + 2 * LAP + 5000, 'slow');
  show('a phone that loads 3.7 s late: on the TV\'s question at every sample from then on', r.miss.length === 0 && r.samples > 300, r.miss.slice(0, 3).join(' | '));

  // A phone that loads in the middle of the second question, and one that loads after the round.
  NOW = T0 + LAP + C.qAt(1) + 7000;
  var ph3 = triviaPhone('?demo=1&t0=' + T0);
  var n3 = now(ph3);
  show('a phone that loads 7 s into question 9 shows question 9 and its answer at once, not question 8 and not a lobby', n3.q && n3.q.qi === 9 && n3.s.t === 'reveal', JSON.stringify(n3.s && n3.s.t) + ' ' + (n3.q && n3.q.qi));

  // A HIDDEN TAB: no timers at all for 25 s, then visible again.
  NOW = T0 + 50;
  var tv4 = triviaTv('?demo=1&t0=' + T0), ph4 = triviaPhone('?demo=1&t0=' + T0);
  for (NOW = T0 + 50; NOW < T0 + C.qAt(0) + 2000; NOW += 100) { tv4.pump(); ph4.pump(); }
  ph4.doc.hidden = true;
  for (; NOW < T0 + C.qAt(0) + 27000; NOW += 100) { tv4.pump(); ph4.pump(); }
  tv4.pump(); ph4.wake();   // the same instant on both: the TV has been ticking all along, the phone wakes
  var a4 = now(tv4), b4 = now(ph4);
  show('a phone tab hidden for 25 s and shown again is on the TV\'s question straight away', a4.q && b4.q && a4.q.text === b4.q.text && a4.s.t === b4.s.t, JSON.stringify([a4.q && a4.q.qi, a4.s && a4.s.t, b4.q && b4.q.qi, b4.s && b4.s.t]));
  r = sameAllAlong(tv4, ph4, NOW, NOW + LAP + 3000, 'hidden');
  show('and stays on it, through the next loop restart', r.miss.length === 0 && r.samples > 200, r.miss.slice(0, 3).join(' | '));

  // NO ?t0= (the page opened on its own): it starts its own night from zero when it loads, as it always did.
  NOW = T0 + 777;
  var tv5 = triviaTv('?demo=1');
  for (; NOW < T0 + 777 + C.qAt(0) + 300; NOW += 100) tv5.pump();
  var q5 = tv5.got.filter(function (g) { return g.m.t === 'question'; });
  show('a wall opened on its own (no ?t0=) starts from the top when it loads: question 8 at ' + C.qAt(0) + ' ms', q5.length === 1 && q5[0].m.qi === 8 && q5[0].at - (T0 + 777) <= C.qAt(0) + 200 && q5[0].at - (T0 + 777) >= C.qAt(0), q5.length && (q5[0].at - T0 - 777));

  // The pages that frame them put ONE start on both.
  show('nsw.html puts the same ?t0= on the TV and the phone frame', /var bust="&t0="\+Date\.now\(\);[\s\S]{0,120}tv\.setAttribute\("src", WALL\[mode\]\+bust\)[\s\S]{0,300}ph\.setAttribute\("src", PHONE\[mode\]\+bust\)/.test(NSW));
  show('index.html too', /var bust="&t0="\+Date\.now\(\);[\s\S]{0,120}tv\.setAttribute\("src", WALL\[mode\]\+bust\)[\s\S]{0,300}ph\.setAttribute\("src", PHONE\[mode\]\+bust\)/.test(INDEX));
  // see-a-night: RUN its address function.
  var src = block(SAN, 'function realScreenSrc(view) {', 'see-a-night.html') + '\n' + block(SAN, 'function realScreenPath(view) {', 'see-a-night.html');
  var rs = new Function('PAGE_EXT', 'DEMO_T0', src + '\nreturn realScreenSrc;')('', 1234567890123);
  show('see-a-night gives the trivia TV, the trivia phone, the musical TV and phone the same start',
    rs('trivia-tv') === '/app/trivia/screen?demo=1&t0=1234567890123' && rs('trivia-phone') === '/app/trivia/play?demo=1&t0=1234567890123' &&
    rs('musical-tv') === '/app/musical/screen?demo=1&t0=1234567890123' && rs('musical-phone') === '/app/musical/play?demo=1&t0=1234567890123',
    [rs('trivia-tv'), rs('trivia-phone')].join(' '));
  show('see-a-night makes that start once for the page, not once per frame', (SAN.match(/var DEMO_T0 = Date\.now\(\);/g) || []).length === 1);
})();

/* =============================================================================================== 3 */
print('\n3. trivia: the leaderboard only at the end of the round');
(function () {
  NOW = T0 + 50;
  var tv = triviaTv('?demo=1&t0=' + T0);
  var C = tv.win.VPDemoClock.TRIVIA, LAP = C.lap();
  for (; NOW < T0 + 3 * LAP + 100; NOW += 100) tv.pump();
  var seq = tv.got.map(function (g) { return g.m.t; }).filter(function (t) { return t === 'question' || t === 'reveal' || t === 'leaderboard' || t === 'podium' || t === 'idle'; });
  var lap = seq.join(',').split('idle')[0];
  show('one lap: question, answer, question, answer, question, answer, the podium, then the leaderboard', lap === 'question,reveal,question,reveal,question,reveal,podium,leaderboard,', lap);
  var boards = tv.got.filter(function (g) { return g.m.t === 'leaderboard'; });
  show('one leaderboard a lap (3 laps, 3 boards)', boards.length === 3, boards.length);
  show('it is the whole board, "Final scores", all sixteen teams', boards.every(function (b) { return b.m.title === 'Final scores' && b.m.rows.length === 16; }), JSON.stringify(boards.map(function (b) { return b.m.title; })));
  var after = true;
  seq.forEach(function (t, i) { if (t === 'reveal' && seq[i + 1] !== 'question' && seq[i + 1] !== 'podium') after = false; });
  show('after every answer comes the next question, or at the round\'s end the podium: never the scores', after, seq.slice(0, 10).join(','));
  var pod = tv.got.filter(function (g) { return g.m.t === 'podium'; }).map(function (g) { return g.at; });
  show('the leaderboard comes after the podium each lap, 6.5 s after it', boards.every(function (b, i) { return pod[i] && b.at - pod[i] >= 6000 && b.at - pod[i] <= 7000; }), JSON.stringify([pod, boards.map(function (b) { return b.at; })]));
  var lastQ = tv.got.filter(function (g) { return g.m.t === 'question'; })[2];
  show('the podium comes after the round\'s last question (10 of 10)', lastQ && lastQ.m.qi === 10 && lastQ.m.qtotal === 10 && lastQ.at < pod[0], lastQ && lastQ.m.qi);
  show('and the wall never rolls to the scores by itself in the demo (the 5.2 s roll is off on ?demo=1)', /if\(state\.phase==="reveal" && !VP_DEMO\)/.test(TSCREEN) || TSCREEN.indexOf('boardRollTimer=setTimeout') < 0);
})();

/* =============================================================================================== 4 */
print('\n4. musical bingo: the TV and the phone on the same song');
(function () {
  NOW = T0 + 50;
  var tv = musicalTv('?demo=1&t0=' + T0);
  for (NOW = T0 + 50; NOW < T0 + 2900; NOW += 100) tv.pump();
  var ph = musicalPhone('?demo=1&t0=' + T0);   // the phone frame loads 2.85 s late
  var C = tv.win.VPDemoClock.MUSICAL, LAP = C.lap(), miss = [], samples = 0;
  for (; NOW < T0 + 3 * LAP + 1000; NOW += 100) {
    tv.pump(); ph.pump();
    var a = now(tv), b = now(ph);
    if (!a.q || !b.q || a.s.t === 'idle' || a.s.t === 'started') continue;
    samples++;
    if (a.q.title !== b.q.title || a.q.played.length !== b.q.played.length) miss.push(NOW - T0);
  }
  show('a phone loaded 2.85 s late: the same song, with the same played list, at every sample over 3 laps (' + samples + ')', miss.length === 0 && samples > 300, miss.slice(0, 5).join(','));
  var lens = tv.got.filter(function (g) { return g.m.t === 'played'; }).map(function (g) { return g.m.played.length; }).join(',');
  show('the wall\'s played list starts again every lap (it used to grow: 6, 7, 8 on the second lap)', /^1,2,3,4,5,1,2,3,4,5,1,2,3,4,5/.test(lens), lens);
  var wins = [tv, ph].map(function (f) { return f.got.filter(function (g) { return g.m.t === 'winner'; }).map(function (g) { return g.at; }); });
  show('the win lands on both in the same tick, every lap', wins[0].length === 3 && wins[1].length === 3 && wins[0].every(function (t, i) { return Math.abs(t - wins[1][i]) <= 200; }), JSON.stringify(wins));
  // Late into the third song: the card shows the first two daubed.
  NOW = T0 + LAP + C.songAt(2) + 1000;
  var ph2 = musicalPhone('?demo=1&t0=' + T0);
  var d = Object.keys(ph2.P.daubs || {}).length;
  show('a phone that loads during the third song shows the free square and the first two songs daubed', d === 3, d);
})();

print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' failed');
