/* THE FINAL TRIVIA WALL: THE QUESTION ON THE RING'S CENTRE LINE (Dean, 5 Nov 2026).

   Dean's final layout (reports/fb-cover-6nov/layout/LAYOUT-FINAL.css, INBOX items 22 and 23):
     - the timer ring stays full size and moves up, so the gap from the venueplay logo to the ring equals the
       gap from the ring to the answers
     - the question, one, two or three lines, is vertically CENTRED on the ring's centre line
     - the answers sit at a fixed spot a normal gap under the ring, the same for every question
     - "Question N of 20" goes under the answers, on the right
     - the countdown and the reveal use identical positions; picture questions keep their own layout

   RUNS the shipped CSS rules and render code, lifted out of venueplay/app/trivia/screen.html:
     1. the four rules carry Dean's numbers, and skip the picture round
     2. the arithmetic they encode: the question's top is the ring's centre line, the answers clear the ring,
        "Question N of 20" clears the answers and stays on the wall
     3. a block model fed by those numbers: 1 to 4 lines centred on the ring, clear of the header and the answers
     4. the countdown and the reveal give the question the same box (same class, same layer type)

   The painted pixels (logo-to-ring gap, the visible ring, the text) are measured in Chrome by
   tools/trivia-question-space-in-chrome.test.py.
   Run: jsc tools/test-trivia-question-space.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}

var SCREEN = readFile('venueplay/app/trivia/screen.html');
var STYLE = SCREEN.slice(SCREEN.indexOf('<style'), SCREEN.indexOf('</style>'));
if (STYLE.length < 1000) throw new Error('cannot find the <style> block in screen.html');
var CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

/* The declarations of one CSS rule, by its exact selector (comments stripped; the selector must start a rule). */
function rule(sel) {
  var re = new RegExp('(^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  var m = CSS.match(re);
  if (!m) throw new Error('cannot find the CSS rule "' + sel + '" in screen.html');
  var out = {};
  m[2].split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  return out;
}
/* A length in cqw ("3.96cqw", "calc(3.96cqw * 1.12)") or a unitless number. Only digits, cqw and arithmetic are
   evaluated (this file's own regex guards the Function), anything else is NaN. */
function cqw(v) {
  if (v === undefined) return NaN;
  v = String(v).trim();
  var c = v.match(/^calc\((.*)\)$/); if (c) v = c[1];
  if (!/^[0-9.\scqw*+\-/()]+$/.test(v)) return NaN;
  try { return Number(new Function('return (' + v.replace(/cqw/g, '') + ');')()); } catch (e) { return NaN; }
}
function near(a, b, tol) { return Math.abs(a - b) < (tol || 0.001); }

var Q = rule('.qtext'), RW = rule('.ringwrap'), A = rule('.answers'), ANS = rule('.ans'), TL = rule('.toplbl'), TLN = rule('.toplbl .tl-night');
var FQ = rule('.layer.qgrid:not(.pic) .qfoot'), FT = rule('.layer.qgrid:not(.pic) .qtext'),
    FA = rule('.layer.qgrid:not(.pic) .answers'), FR = rule('.layer.qgrid:not(.pic) .qround');
var ringTop = cqw(FQ['top']), ringH = cqw(RW['height']), ringMid = ringTop + ringH / 2, ringBottom = ringTop + ringH;
var ansTop = cqw(FA['top']), cardH = cqw(ANS['height']), rowGap = cqw((A['gap'] || '').split(/\s+/)[0]);
var ansBottom = ansTop + 2 * cardH + rowGap;
var headerBottom = cqw(TL['top']) + cqw(TLN['font-size']) * 1.15;   // the TRIVIA line: Anton at its size, line-height 1.15

/* ======================================================================================= 1 */
print('1. the final layout rules carry Dean\'s numbers');
show('the ring moves up to 7.55cqw (145px on a 1920 set)', near(ringTop, 7.55), FQ['top']);
show('the ring stays full size (14.58cqw, 280px)', near(ringH, 14.58), RW['height']);
show('the question\'s top is the ring\'s centre line (14.84cqw)', near(cqw(FT['top']), ringMid, 0.006), FT['top'] + ' vs ' + ringMid);
show('and the question is pulled up by half its own height, so it is CENTRED on that line', /^translateY\(-50%\)$/.test(FT['transform'] || ''), FT['transform']);
show('the answers sit at a fixed 24.11cqw', near(ansTop, 24.11), FA['top']);
show('"Question N of 20" sits at 50.1cqw, right-aligned to the answers\' right edge',
  near(cqw(FR['top']), 50.1) && FR['text-align'] === 'right' && FR['right'] === A['right'] && FR['width'] === 'auto', JSON.stringify(FR));
show('all four rules skip the picture round (it keeps its own layout)',
  ['.qfoot', '.qtext', '.answers', '.qround'].every(function (s) { return CSS.indexOf('.layer.qgrid:not(.pic) ' + s + '{') >= 0; }));
show('the picture round\'s own rules are still there', CSS.indexOf('.layer.pic .qtext{font-size:2.5cqw;line-height:1.14}') >= 0 && CSS.indexOf('.layer.pic .answers{top:37.6cqw;') >= 0);
show('the mock-only rule that hid the counts did NOT come into the product', CSS.indexOf('.rcount,#tvAnsCount,#tvAnsOf,.cnt{display:none') < 0);
show('the countdown and the reveal both carry .qgrid, so the rules hold on both',
  SCREEN.indexOf('<div class="layer hidden qgrid" id="tvQ">') > 0 && SCREEN.indexOf('<div class="layer hidden qgrid" id="tvReveal">') > 0);

/* ======================================================================================= 2 */
print('2. what the numbers add up to');
var gapUnder = ansTop - ringBottom;
show('the answers clear the ring\'s box, a normal gap under it (about 2cqw)', gapUnder > 1.5 && gapUnder < 2.6, gapUnder);
show('"Question N of 20" sits under the answers', cqw(FR['top']) > ansBottom, cqw(FR['top']) + ' vs answers end ' + ansBottom);
show('and stays on a 16:9 wall (above 56.25cqw less its own line)', cqw(FR['top']) + 2 < 56.25, cqw(FR['top']));

/* ======================================================================================= 3 */
print('3. where the text lands (the block model, fed by the shipped numbers)');
function placed(lines, size, lineH) { var h = lines * size * lineH; return { top: ringMid - h / 2, bottom: ringMid + h / 2, mid: ringMid }; }
var base = cqw(Q['font-size']), baseLH = cqw(Q['line-height']);
var Lm = rule('.qtext.q-med'), Ll = rule('.qtext.q-long'), Le = rule('.qtext.q-epic');
[[1, base, baseLH, 'one short line'], [2, base, baseLH, 'two short lines'], [3, cqw(Ll['font-size']), cqw(Ll['line-height']), 'three long lines'],
 [4, cqw(Ll['font-size']), cqw(Ll['line-height']), 'four long lines (the library\'s longest, 188 characters)'],
 [4, cqw(Le['font-size']), cqw(Le['line-height']), 'four epic lines']].forEach(function (c) {
  var p = placed(c[0], c[1], c[2]);
  show(c[3] + ': centred on the ring, clear of the TRIVIA line and of the answers',
    near(p.mid, ringMid) && p.top > headerBottom && p.bottom < ansTop - 0.5, p.top.toFixed(2) + '..' + p.bottom.toFixed(2) + ' header ' + headerBottom.toFixed(2) + ' answers ' + ansTop);
});
show('a two-line medium question is centred on the same line', near(placed(2, cqw(Lm['font-size']), baseLH).mid, ringMid));

/* ======================================================================================= 4 */
print('4. the countdown and the reveal give the question the same box');
var qClass = new Function(lift(SCREEN, 'qClass', 'screen.html') + '\nreturn qClass;')();
var samples = ['Who wrote Hamlet?',
  'Which Australian band released the album "Back in Black" in 1980, and who was its new singer?',
  new Array(30).join('a long question about the history of the cricket '),
  new Array(10).join('words and more words ')];
samples.forEach(function (s) {
  show('"' + s.slice(0, 28) + '..." keeps the qtext box on both screens', /^qtext( |$)/.test(qClass(s)), qClass(s));
});
show('the countdown sets the box from the question text', SCREEN.indexOf('_qt.className = qClass(_q);') > 0);
show('the reveal sets the same box from the same text', SCREEN.indexOf('rq.className=qClass(curQ.text);') > 0);
show('both screens hold the question in a .qtext element',
  SCREEN.indexOf('<div class="qtext" id="tvQText">') > 0 && SCREEN.indexOf('<div class="qtext" id="tvRevQText">') > 0);

print('\n' + (ran - bad) + '/' + ran + ' passed');
if (bad) throw new Error(bad + ' failed');
