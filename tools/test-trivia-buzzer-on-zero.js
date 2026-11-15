/* THE TIME'S-UP BUZZER SOUNDS WHEN THE WALL SAYS 0 (Dean, 15 Nov 2026, The Mini Bar: "the times up buzzer did play",
   "not timed right").

   The TV played the buzzer only when the console's "lock" arrived. The console checks its clock every 500 ms and the
   lock then crosses the network, so the room saw 0 on the wall and heard the buzzer up to a second later. Now the
   ring's own tick that paints 0 sounds it, and the lock is only the fallback.

   RUNS the shipped trivia/screen.html functions (renderQuestion, tickRing, setRing, stopRing, hostNow, timesUp,
   buzzSay, renderReveal is not needed) and the REAL /app/vp-buzzer.js, on a fake clock that steps 50 ms at a time and
   fires the page's own ring interval at its own period. Records the clock when the ring first paints 0 and when the
   buzzer's first note starts, and asserts:
     - they are the same tick, and the buzzer is never heard before the wall reads 0
     - the host's clock is the one counted on (VPSign.hostNow): a TV whose own clock is 4 s out still buzzes on
       the wall's 0 and on the host's deadline
     - once per question: the late lock is silent; the next question sounds again
     - never on a replay after the clock ran out, never with the buzzer switched off, never on the sales demo,
       never after the answer went up early (renderReveal marks it)

   Run from the repo root:  jsc tools/test-trivia-buzzer-on-zero.js
*/
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in trivia/screen.html - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var SCREEN = readFile('venueplay/app/trivia/screen.html');
var BUZZER = readFile('venueplay/app/vp-buzzer.js');
function buzzerLib() { var w = {}; new Function('window', BUZZER)(w); return w.VPBuzzer; }
var BUZZ_SRC = /var BUZZ=(\{[^;]*\});/.exec(SCREEN)[1];

function rig(o) {
  o = o || {};
  var T = { now: 1791900000000, skew: o.skew || 0, iv: [], starts: [], zeroAt: null };
  var els = {};
  function $(id) {
    if (!els[id]) {
      var e = { id: id, style: {}, attrs: {}, children: [], className: '', innerHTML: '', src: '',
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
        setAttribute: function (k, v) { e.attrs[k] = v; }, removeAttribute: function () {}, appendChild: function (k) { e.children.push(k); return k; } };
      var tc = '';
      Object.defineProperty(e, 'textContent', { get: function () { return tc; }, set: function (v) { tc = String(v); if (id === 'tvCdNum' && tc === '0' && T.zeroAt === null) T.zeroAt = T.now; } });
      els[id] = e;
    }
    return els[id];
  }
  function Ctx() {
    this.state = 'running'; this.currentTime = 0; this.destination = {};
    function node() { return { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, frequency: { value: 0 },
      connect: function () {}, start: function () { T.starts.push(T.now); }, stop: function () {} }; }
    this.createGain = node; this.createOscillator = node; this.resume = function () { return Promise.resolve(); };
  }
  var BUZZ = new Function('return ' + BUZZ_SRC)(); BUZZ.on = o.off ? false : true;
  var env = {
    $: $, el: function () { return $('x' + Math.random()); }, esc: String, LETTERS: ['A', 'B', 'C', 'D'], RING_C: 2 * Math.PI * 44,
    VP_DEMO: !!o.demo, state: { phase: 'question', colour: true }, BUZZ: BUZZ, _ac: new Ctx(),
    /* the host's clock: VPSign.hostNow is this TV's clock less its skew (what vp-sign learns from signed messages) */
    window: { VPBuzzer: buzzerLib(), VPSign: { hostNow: function () { return T.now; } } },
    VPSign: { hostNow: function () { return T.now; } },
    Date: { now: function () { return T.now + T.skew; } },
    tvSend: function () {}, document: { createElement: function () { return $('c' + Math.random()); } },
    setInterval: function (f, ms) { var h = { f: f, ms: ms, next: T.now + ms, live: true }; T.iv.push(h); return h; },
    clearInterval: function (h) { if (h) h.live = false; }, setTimeout: function () { return 0; }, clearTimeout: function () {},
    show: function () {}, applyColour: function () {}, qClass: function () { return 'qtext'; }, ansLenClass: function () { return ''; },
    unlockAudio: function () {}
  };
  var src = 'var curQ=null, ringTimer=null, boardRollTimer=null;\n' +
    ['hostNow', 'setRing', 'stopRing', 'tickRing', 'renderQuestion', 'buzzSay', 'timesUp'].map(function (n) { return lift(SCREEN, n); }).join('') +
    '; return { q: renderQuestion, up: timesUp, cur: function(){ return curQ; } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  api.T = T; api.env = env;
  api.run = function (ms) {   // step the clock 50 ms at a time, firing the page's own intervals at their own period
    for (var t = 0; t < ms; t += 50) {
      T.now += 50;
      T.iv.slice().forEach(function (h) { if (h.live && h.next <= T.now) { h.next += h.ms; h.f(); } });
    }
  };
  return api;
}
function q(r, over) {
  var m = { t: 'question', qseq: 5, qi: 2, qtotal: 10, text: 'Q?', options: ['a', 'b', 'c', 'd'], secs: 20, endsAt: r.T.now + 20000 };
  for (var k in (over || {})) m[k] = over[k];
  return m;
}

print('the buzzer and the 0 on the wall');
var a = rig();
var m = q(a); a.q(m);
a.run(19000);
show('CONTROL: 19 s into a 20 s question the wall does not read 0 and nothing has sounded', a.T.zeroAt === null && a.T.starts.length === 0, a.T.zeroAt + ' / ' + a.T.starts.length);
a.run(2000);
show('the wall reads 0', a.T.zeroAt !== null, a.T.zeroAt);
show('the buzzer sounds (two notes, two voices each) with no lock from the console at all', a.T.starts.length === 4, a.T.starts.length);
show('in the same tick the wall paints 0: never before it, never after it', a.T.starts[0] === a.T.zeroAt, (a.T.starts[0] - a.T.zeroAt) + ' ms');
show('and within one ring tick (300 ms) of the host\'s deadline', a.T.zeroAt >= m.endsAt && a.T.zeroAt - m.endsAt <= 300, (a.T.zeroAt - m.endsAt) + ' ms after');
a.up();
show('the console\'s lock arriving a moment later is silent: once per question', a.T.starts.length === 4, a.T.starts.length);
a.T.zeroAt = null; var m2 = q(a, { qseq: 6 }); a.q(m2); a.run(21000);
show('the next question sounds again, on its own 0', a.T.starts.length === 8 && a.T.starts[4] === a.T.zeroAt, a.T.starts.length);

print('a TV whose own clock is out');
[4000, -4000].forEach(function (sk) {
  var s = rig({ skew: sk }); var ms = q(s); s.q(ms); s.run(22000);
  show('TV clock ' + (sk > 0 ? 'ahead' : 'behind') + ' by 4 s: the buzzer is on the wall\'s 0 and the host\'s deadline, not the TV\'s own clock',
       s.T.starts.length === 4 && s.T.starts[0] === s.T.zeroAt && s.T.zeroAt >= ms.endsAt && s.T.zeroAt - ms.endsAt <= 300, s.T.starts[0] + ' ' + s.T.zeroAt + ' ' + ms.endsAt);
});

print('never when it should not');
var b = rig(); b.q(q(b, { secs: 0, endsAt: b.T.now - 4000 })); b.run(3000); b.up();
show('a replay to a TV that reloaded after the clock ran out: the wall reads 0 and nothing sounds', b.T.zeroAt !== null && b.T.starts.length === 0, b.T.starts.length);
var c = rig({ off: true }); c.q(q(c)); c.run(21000);
show('the host switched the buzzer off: the wall reads 0, silent', c.T.zeroAt !== null && c.T.starts.length === 0, c.T.starts.length);
var dd = rig({ demo: true }); dd.q(q(dd)); dd.run(21000);
show('the sales-page demo: silent', dd.T.starts.length === 0, dd.T.starts.length);
var e = rig(); e.q(q(e)); e.run(10000); e.cur().buzzed = true;   /* what renderReveal does when the answer goes up early */
e.run(11000);
show('the answer went up before 0 (renderReveal marks the question): the old deadline is silent', e.T.starts.length === 0, e.T.starts.length);
var f = rig(); f.q(q(f)); f.run(21000); f.env.state.phase = 'reveal';
show('CONTROL: renderReveal really does mark it (the reveal sets curQ.buzzed)', /curQ\.buzzed=true;\s*\/\/ the host revealed/.test(lift(SCREEN, 'renderReveal')));

if (bad) throw new Error('buzzer on zero: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
