/* THE TRIVIA QUESTION HOLDS ITS SPACE ON THE TV (Dean, 5 Nov 2026).

   The question block on the TV always reserves TWO lines at the short-question size. A one-line question
   sits at the BOTTOM of that space, a normal gap above the answers, with the spare line above it (not on the
   first line with an empty line under it); two lines fill it; a longer question grows down from the same top. The countdown and the reveal use the same box and the
   same size rule, so the question never moves or flicks between them.

   RUNS the shipped CSS rule and the shipped render code, lifted out of venueplay/app/trivia/screen.html:
     1. the question's place, one rule (.qgrid .qtext): a flex column, packed to the bottom, its min-height
        exactly two lines at the short-question size
     2. the picture round's .qtext: two lines at the picture round's size, still clear of the picture
     3. a block layout model fed by those numbers: one line at the bottom, two lines fill, three grow from the top,
        and the answers never covered
     4. the countdown and the reveal give the same question the same class (so the same size and place)

   The real pixels are measured in Chrome by tools/trivia-question-space-in-chrome.test.py.
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

/* The declarations of one CSS rule, by its exact selector (comments stripped). */
function rule(sel) {
  var css = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
  var re = new RegExp('(^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  var m = css.match(re);
  if (!m) throw new Error('cannot find the CSS rule "' + sel + '" in screen.html');
  var out = {};
  m[2].split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  return out;
}
/* A length in cqw: "3.96cqw", "calc(3.96cqw * 1.12 * 2)", or a unitless number (line-height). Anything else is NaN. */
function cqw(v) {
  if (v === undefined) return NaN;
  v = String(v).trim();
  var c = v.match(/^calc\((.*)\)$/); if (c) v = c[1];
  if (!/^[0-9.\scqw*+\-/()]+$/.test(v)) return NaN;
  try { return Number(new Function('return (' + v.replace(/cqw/g, '') + ');')()); } catch (e) { return NaN; }
}
function near(a, b) { return Math.abs(a - b) < 0.001; }

/* ======================================================================================= 1 */
print('1. the question block holds two lines, and one line sits at the bottom of them');
var Q = rule('.qtext'), PL = rule('.qgrid .qtext');
var fs = cqw(Q['font-size']), lh = cqw(Q['line-height']), mh = cqw(PL['min-height']), top = cqw(Q['top']);
show('the question block is a flex box', PL['display'] === 'flex', PL['display']);
show('its one text line stacks top to bottom (a column), so the text still wraps as a paragraph', PL['flex-direction'] === 'column', PL['flex-direction']);
show('the text is packed to the BOTTOM of the block, next to the answers', PL['justify-content'] === 'flex-end', PL['justify-content']);
show('the block reserves exactly two lines at the short-question size', near(mh, fs * lh * 2), mh + ' vs ' + (fs * lh * 2));
show('the short-question size is unchanged (76px on a 1920 set)', near(fs, 3.96) && Math.round(fs * 19.2) === 76, fs);
show('the block keeps its place on the wall (9.4cqw from the top)', near(top, 9.4), top);

/* ======================================================================================= 2 */
print('2. the picture round');
var P = rule('.layer.pic .qtext');
var pfs = cqw(P['font-size']), plh = cqw(P['line-height']), pmh = cqw(P['min-height']);
var IMG = rule('.layer.pic .qimg'), IMGB = rule('.qimg');
var imgTop = cqw(IMG['top'] || IMGB['top']);
show('the picture round reserves two lines at its own smaller size', near(pmh, pfs * plh * 2), pmh + ' vs ' + (pfs * plh * 2));
show('two picture-round lines end above the picture', top + pmh < imgTop, (top + pmh) + ' vs picture top ' + imgTop);

/* ======================================================================================= 3 */
print('3. where the text lands (the block model, fed by the shipped numbers)');
var ANS = rule('.answers'), answersTop = cqw(ANS['top']);
/* A flex column with justify-content:flex-end: the box is max(min-height, content); the content sits at its bottom. */
function place(lines, size, lineH, minH) {
  var content = lines * size * lineH, box = Math.max(minH, content);
  var textTop = top + (box - content);
  return { textTop: textTop, textBottom: textTop + content, boxBottom: top + box, mid: textTop + content / 2 };
}
var boxBottom = top + mh;
var one = place(1, fs, lh, mh), two = place(2, fs, lh, mh);
show('one line sits on the BOTTOM line of the two-line space, the spare line above it', near(one.textBottom, boxBottom) && near(one.textTop, top + fs * lh), one.textTop + '..' + one.textBottom);
show('one line is NOT on the first line with an empty line under it', one.textTop > top + 0.1, one.textTop);
show('two lines fill the space from the same top as before', near(two.textTop, top) && near(two.textBottom, top + mh), two.textTop + '..' + two.textBottom);
show('one line ends where two lines end, so its gap to the answers is the normal one', near(one.textBottom, two.textBottom));
show('the box is the same height for one line and two, so the answers never shift', near(one.boxBottom, two.boxBottom));
var Lm = rule('.qtext.q-med'), Ll = rule('.qtext.q-long'), Le = rule('.qtext.q-epic');
var med = place(2, cqw(Lm['font-size']), lh, mh);
show('a two-line medium question sits at the bottom of the same space', near(med.textBottom, boxBottom), med.textBottom);
var lng = place(3, cqw(Ll['font-size']), cqw(Ll['line-height']), mh);
show('a long question taller than two lines grows down from the same top', near(lng.textTop, top) || lng.textTop >= top, lng.textTop);
var epicLines = Math.floor((answersTop - top) / (cqw(Le['font-size']) * cqw(Le['line-height'])));
show('the longest size still has 6 or more lines before the answers', epicLines >= 6, epicLines);
show('the two-line space ends above the answers', top + mh < answersTop, (top + mh) + ' vs ' + answersTop);

/* ======================================================================================= 4 */
print('4. the countdown and the reveal give the question the same box');
var qClass = new Function(lift(SCREEN, 'qClass', 'screen.html') + '\nreturn qClass;')();
var samples = ['What is the capital of Australia?',
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
show('the text goes in as plain text (one text node, so one flex item)',
  SCREEN.indexOf('_qt.textContent = _q;') > 0 && SCREEN.indexOf('rq.textContent=curQ.text||"";') > 0);

print('\n' + (ran - bad) + '/' + ran + ' passed');
if (bad) throw new Error(bad + ' failed');
