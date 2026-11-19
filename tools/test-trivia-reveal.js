/* THE TRIVIA REVEAL MOMENT (Dean, 5 Nov 2026, INBOX items 26 to 28).

   On the TV reveal: the timer's spot becomes a solid green disc with the right answer's letter (as big and bold as
   idea 3's) and a tick; the right card glows once, then stays lit (was 3 pulses until INBOX 778(a), 19 Nov 2026); the wrong cards KEEP THEIR OWN
   COLOURS and stay readable, softened to about 40 to 45%, never grey; nothing moves; picture questions get the same
   disc; motion under 3 flashes a second, silent, and none at all under prefers-reduced-motion.

   RUNS the shipped renderReveal (lifted out of venueplay/app/trivia/screen.html, on a small stub DOM) and reads the
   shipped CSS rules:
     1. the disc carries the right answer's letter for A, B, C and D, and no disc for a reveal without a valid answer
     2. the wrong cards: softened to 40 to 45%, their own colour classes kept, no grey filter anywhere on them
     3. the disc: green, in the ring's exact spot (and the picture ring's), the letter at least idea 3's 9.5cqw
     4. the motion: ONE glow, then held lit (INBOX 778(a), 19 Nov 2026: it pulsed 3 times and the room saw the answer
        go green, then again, then again), nothing infinite, all of it off under prefers-reduced-motion
     5. once per reveal: a replay of the answer already up (a TV that loaded on the answer, the console back from
        sleep, the answer replayed over a round's podium) is not played again; a new question's answer is

   The painted result is measured in Chrome by tools/trivia-reveal-in-chrome.test.py.
   Run: jsc tools/test-trivia-reveal.js   (from the repo root) */
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

var SCREEN = readFile('venueplay/app/trivia/screen.html');
var STYLE = SCREEN.slice(SCREEN.indexOf('<style'), SCREEN.indexOf('</style>'));
if (STYLE.length < 1000) throw new Error('cannot find the <style> block in screen.html');
var CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
function rule(sel) {
  var re = new RegExp('(^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  var m = CSS.match(re);
  if (!m) throw new Error('cannot find the CSS rule "' + sel + '" in screen.html');
  var out = {};
  m[2].split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  return out;
}
function num(v) { var m = /^(-?[0-9.]+)/.exec(String(v || '').trim()); return m ? Number(m[1]) : NaN; }

/* A small DOM: elements by id made on first ask, created elements kept as children. */
function makeDom() {
  var els = {};
  function mk(tag, cls) {
    var c = {};
    (cls || '').split(/\s+/).forEach(function (x) { if (x) c[x] = 1; });
    var e = { tag: tag, textContent: '', style: {}, hidden: false, children: [], attrs: {},
      classList: { add: function (x) { c[x] = 1; }, remove: function (x) { delete c[x]; }, contains: function (x) { return !!c[x]; },
                   toggle: function (x, on) { if (on === undefined) on = !c[x]; if (on) c[x] = 1; else delete c[x]; } },
      appendChild: function (k) { e.children.push(k); return k; }, addEventListener: function () {},
      setAttribute: function (k, v) { e.attrs[k] = String(v); }, removeAttribute: function (k) { delete e.attrs[k]; },
      getAttribute: function (k) { return e.attrs.hasOwnProperty(k) ? e.attrs[k] : null; } };
    Object.defineProperty(e, 'className', { get: function () { return Object.keys(c).join(' '); },
      set: function (v) { c = {}; String(v).split(/\s+/).forEach(function (x) { if (x) c[x] = 1; }); } });
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html || ''; }, set: function (v) { e._html = v; if (v === '') e.children = []; } });
    return e;
  }
  return { $: function (id) { return els[id] || (els[id] = mk('div', '')); }, mk: mk, els: els };
}

function rig() {
  var dom = makeDom();
  dom.$('tvRevMark').className = 'vp-revmark hidden';   // as the page ships it
  var env = { $: dom.$, el: function (t, c, h) { var e = dom.mk(t, c); if (h != null) e.textContent = String(h); return e; },
    esc: function (s) { return String(s); }, LETTERS: ['A', 'B', 'C', 'D'], document: { createElement: function (t) { return dom.mk(t, ''); } },
    state: { phase: 'reveal', colour: true, title: '' } };
  var src = 'var curQ=null, boardRollTimer=null;\n' +
    'function show(){} function applyColour(){} function setTimeout(){ return 0; } function clearTimeout(){} function renderBoardPaged(){}\n' +
    'function stopRing(){} function setRing(){} function tickRing(){} function stopBoardPaging(){} function unlockAudio(){} function celebrate(){} function timesUp(){}\n' +
    liftAll(SCREEN, ['qClass', 'ansLenClass', 'renderReveal', 'renderRows', 'sharedRanks'], 'trivia/screen.html') +
    '; return { rev: function(q, m){ curQ=q; renderReveal(m); }, again: function(m){ renderReveal(m); }, cur: function(){ return curQ; } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  api.dom = dom;
  return api;
}
var OPTS = ['AC/DC', 'Cold Chisel', 'INXS', 'Midnight Oil'];
function reveal(a, ci) { a.rev({ qseq: 1, text: 'Which band released the album Back in Black?', options: OPTS, label: 'Question 3 of 20' },
                              { t: 'reveal', qseq: 1, correctIndex: ci, options: OPTS, split: [1, 1, 1, 1], leaderboard: [] }); }

/* ======================================================================================= 1 */
print('1. the green disc carries the right answer\'s letter');
['A', 'B', 'C', 'D'].forEach(function (L, ci) {
  var a = rig(); reveal(a, ci);
  var mk = a.dom.$('tvRevMark'), lt = a.dom.$('tvRevLetter');
  show('right answer ' + L + ': the disc shows "' + L + '" and is on the wall', lt.textContent === L && !mk.classList.contains('hidden'), lt.textContent + ' / ' + mk.className);
  var cards = a.dom.$('tvRevAnswers').children;
  show('right answer ' + L + ': the same card is the green one, the other three are softened', cards.length === 4 &&
    cards.every(function (c, i) { return c.classList.contains(i === ci ? 'correct' : 'dim') && !c.classList.contains(i === ci ? 'dim' : 'correct'); }),
    cards.map(function (c) { return c.className; }).join(' | '));
});
[undefined, -1, 4, null].forEach(function (bad) {
  var a = rig(); reveal(a, bad);
  show('a reveal with no valid answer (' + bad + ') shows NO disc and no letter', a.dom.$('tvRevMark').classList.contains('hidden') && a.dom.$('tvRevLetter').textContent === '');
});
(function () {
  var a = rig(); reveal(a, undefined); reveal(a, 2);
  show('a good reveal after a bad one brings the disc back with the right letter', !a.dom.$('tvRevMark').classList.contains('hidden') && a.dom.$('tvRevLetter').textContent === 'C');
})();
show('the disc sits inside the reveal layer, in the page itself', (function () {
  var r = SCREEN.indexOf('id="tvReveal"'), m = SCREEN.indexOf('id="tvRevMark"'), nxt = SCREEN.indexOf('<div class="layer', r + 10);
  return r > 0 && m > r && m < nxt && SCREEN.indexOf('<div class="vp-revmark hidden" id="tvRevMark" aria-hidden="true">') > 0;
})());

/* ======================================================================================= 2 */
print('2. the wrong cards keep their colours and stay readable');
var DIM = rule('#tvRevAnswers .ans.dim');
show('softened to between 40% and 45% (Dean: readable from across the room)', num(DIM['opacity']) >= 0.40 && num(DIM['opacity']) <= 0.45, DIM['opacity']);
show('never grey: no filter on a softened card', !('filter' in DIM), JSON.stringify(DIM));
show('and no grey filter on any .dim card anywhere on the wall', !/\.dim[^{]*\{[^}]*(grayscale|saturate\(0)/.test(CSS));
show('the four answer colours are the countdown\'s (coral, blue, amber, violet), so a card keeps its colour class',
  rule('.ans.c0')['--c'] === '#FF5A4E' && rule('.ans.c1')['--c'] === '#4D8DFF' && rule('.ans.c2')['--c'] === '#FFA53D' && rule('.ans.c3')['--c'] === '#A57BFF');
(function () {
  var a = rig(); reveal(a, 1);
  var cards = a.dom.$('tvRevAnswers').children;
  show('on the reveal every card keeps its own colour class c0 to c3', cards.every(function (c, i) { return c.classList.contains('c' + i); }), cards.map(function (c) { return c.className; }).join(' | '));
})();

/* ======================================================================================= 3 */
print('3. the disc');
var MK = rule('.vp-revmark'), LT = rule('.vp-revletter'), RING = rule('.layer.qgrid:not(.pic) .qfoot'), RW = rule('.ringwrap'), QF = rule('.qfoot');
show('a solid green disc, the product\'s right-answer green', /background:\s*#2FD08A/i.test('background:' + MK['background']) && MK['border-radius'] === '50%', MK['background']);
show('in the ring\'s exact spot (same top, right and size as the final layout\'s ring)',
  MK['top'] === RING['top'] && MK['right'] === QF['right'] && MK['width'] === RW['width'] && MK['height'] === RW['height'], JSON.stringify([MK['top'], MK['right'], MK['width'], MK['height']]));
show('the letter as big and bold as idea 3\'s B (Anton, at least 9.5cqw), dark on the green', /Anton/.test(LT['font-family']) && num(LT['font-size']) >= 9.5 && LT['color'] === '#0A0A0B', JSON.stringify(LT));
var PMK = rule('.layer.pic .vp-revmark'), PRW = rule('.layer.pic .ringwrap');
show('a picture question gets the same disc, in its smaller ring\'s spot', PMK['top'] === QF['top'] && PMK['width'] === PRW['width'] && PMK['height'] === PRW['height'], JSON.stringify(PMK));

/* ======================================================================================= 4 */
print('4. the motion');
var GL = rule('#tvRevAnswers .ans.correct');
var g = /vpGlow\s+([0-9.]+)s\s+\S+\s+(\d+)/.exec(GL['animation'] || '');
show('the right card glows ONCE, then holds lit (not 3 pulses, not infinite; INBOX 778(a))', !!g && g[2] === '1' && !/infinite/.test(GL['animation']), GL['animation']);
show('under 3 flashes a second', !!g && 1 / Number(g[1]) < 3, g && g[1]);
show('and holds its glow after the pulses (the lit shadow is the card\'s own)', /6cqw 1cqw/.test(GL['box-shadow'] || ''), GL['box-shadow']);
show('nothing on the reveal pulses for ever', !/vpGlow[^;}]*infinite|vpRevIn[^;}]*infinite|vpTickIn[^;}]*infinite/.test(CSS));
var RM = /@media \(prefers-reduced-motion:reduce\)\{\.vp-revmark,\.vp-revtick,#tvRevAnswers \.ans\.correct\{animation:none\}\}/.test(CSS);
show('prefers-reduced-motion: the disc, the tick and the glow do not move at all', RM);

/* ======================================================================================= 5 */
print('5. once per reveal (INBOX 778(a), 19 Nov 2026)');
/* The replay guard at the top of onMsg's reveal branch, lifted as written and run as a function of (m, curQ, state). */
var GUARD = (function () {
  var i = SCREEN.indexOf('else if(m.t==="reveal"){');
  if (i < 0) throw new Error('cannot find the reveal branch of onMsg in screen.html');
  var mm = /\n\s*if\((!m\.fin[^\n]*)\) return;/.exec(SCREEN.slice(i, i + 1600));
  if (!mm) throw new Error('cannot find the replay guard in the reveal branch - a test that cannot find its subject cannot fail');
  return new Function('m', 'curQ', 'state', 'return !!(' + mm[1] + ');');
})();
function R(q, ci, fin) { var m = { t: 'reveal', qseq: q, correctIndex: ci, options: OPTS, split: [1, 1, 1, 1], leaderboard: [] }; if (fin) m.fin = true; return m; }
(function () {
  var a = rig(); a.rev(null, R(5, 2));   // a TV that loaded while the answer was up: the replay is its first sight
  var c = a.cur();
  show('a TV that first sees the answer (no question before it) remembers which question it is', !!c && c.qseq === 5, c && c.qseq);
  show('so the same answer replayed to it is NOT played again (no second glow, no second disc)', GUARD(R(5, 2), c, { phase: 'reveal' }));
  show('nor after its board rolled up', GUARD(R(5, 2), c, { phase: 'leaderboard' }));
})();
(function () {
  var a = rig(); a.rev({ text: 'A question sent without its number', options: OPTS }, R(6, 1));   // a question message with no qseq
  var c = a.cur();
  show('a question that came without its number takes the answer\'s number, so its replay is not played again either',
    !!c && c.qseq === 6 && c.text === 'A question sent without its number' && GUARD(R(6, 1), c, { phase: 'reveal' }), c && c.qseq);
})();
(function () {
  var a = rig(); reveal(a, 1); var c = a.cur();
  show('the live TV: the same answer replayed (polls, the console back from sleep) is not played again', GUARD(R(1, 1), c, { phase: 'reveal' }));
  show('the same answer replayed over the round\'s podium leaves the podium up', GUARD(R(1, 1), c, { phase: 'podium' }));
  show('a qseq that arrives as text is still the same question', GUARD(R('1', 1), c, { phase: 'reveal' }));
  show('the NEXT question\'s answer IS played', !GUARD(R(2, 1), c, { phase: 'reveal' }) && !GUARD(R(2, 1), c, { phase: 'podium' }));
  show('a corrected answer for the same question IS played', !GUARD(R(1, 3), c, { phase: 'reveal' }));
  show('the answer while the question is still on the wall IS played (the reveal itself)', !GUARD(R(1, 1), c, { phase: 'question' }));
  show('the night\'s last answer (fin) is left to the finale, as before', !GUARD(R(1, 1, true), c, { phase: 'reveal' }));
})();
(function () {
  var a = rig();
  a.rev({ qseq: 4, text: 'An older question', options: ['W', 'X', 'Y', 'Z'], label: 'Question 4 of 20' }, R(5, 0));
  var cards = a.dom.$('tvRevAnswers').children, c = a.cur();
  show('an answer for a question this wall never saw shows ITS options, not the last question\'s cards',
    cards.length === 4 && cards[0].children.some(function (k) { return k.textContent === 'AC/DC'; }) && c.qseq === 5,
    cards.map(function (k) { return k.children.map(function (x) { return x.textContent; }).join('/'); }).join(' | '));
})();

print('\n' + (bad ? ((ran - bad) + ' of ' + ran + ' checks passed') : ('ALL ' + ran + ' CHECKS PASSED')));
if (bad) throw new Error(bad + ' failed');
