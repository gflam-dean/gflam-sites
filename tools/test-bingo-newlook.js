/* NUMBER BINGO, THE NEW LOOK: THE RULES UNDER IT (Dean, 3 Nov 2026; built 12 Nov 2026 on feature/newlook-bingo-12nov).

   RUNS the shipped code, lifted out of the pages with small stubs, and reads the pages' markup and CSS:

     1. the claim button's words follow the pattern ("I've got a line" only on a one-line game; two lines, full house, a named row,
        four corners and a venue's own pattern each say so), never a fixed word that contradicts the pattern
     2. the called-number block on the phone: the newest number in the ring, "N of 90 called", the five before it newest first
     3. tickets: the closest ticket first (order and a class, the tickets stay in the page in their own order), each ticket's
        "N to go" on its own right, and the label's text still reads as before for the older suites
     4. the phone is the shared new-look frame (/app/vp-phone.css), nothing under 15px in the new look's own CSS (phone and
        console), no em dash, venueplay in lowercase
     5. the wall: the shared join screen, the game name and round in the title line, the called number in a ring, NO player or
        answered count anywhere on any bingo wall layer, the F winner ring "BINGO ON n" with NO card number showing, and no
        ring at all on a real-balls night
     6. the 18+ tick is still there (Victoria and the ACT: Anisimoff Legal, 8 Oct 2026), only restyled
     7. PRESENTATION ONLY: the draw, ticket, mark and claim code the look sits on is untouched (the same functions, by name)

   Run: jsc tools/test-bingo-newlook.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var PLAY = readFile('venueplay/play.html');
var TV = readFile('venueplay/tv.html');
var CON = readFile('venueplay/app/index.html');
function between(t, a, b) { var i = t.indexOf(a); if (i < 0) throw new Error('no marker ' + a); var j = t.indexOf(b, i); return t.slice(i, j < 0 ? t.length : j); }

print('\n== 1. the claim words follow the pattern ==');
(function () {
  var P = { pattern: 'one' }, PATS = {};
  var PATTERN_NAMES = { one: 'One line', two: 'Two lines', full: 'Full house', corners: 'Four corners', top: 'Top line', middle: 'Middle line', bottom: 'Bottom line' };
  var src = lift(PLAY, 'patName', 'play.html') + lift(PLAY, 'claimWords', 'play.html') + 'return claimWords;';
  var cw = new Function('P', 'PATS', 'PATTERN_NAMES', src)(P, PATS, PATTERN_NAMES);
  function w(k) { P.pattern = k; return cw(); }
  show('one line: "I’ve got a line"', w('one') === 'I’ve got a line', w('one'));
  show('two lines: "I’ve got two lines", never "a line"', w('two') === 'I’ve got two lines', w('two'));
  show('full house: "Full house"', w('full') === 'Full house', w('full'));
  show('a named row says which: top, middle, bottom', w('top') === 'I’ve got the top line' && w('middle') === 'I’ve got the middle line' && w('bottom') === 'I’ve got the bottom line');
  show('four corners says so', w('corners') === 'I’ve got four corners', w('corners'));
  PATS['c:11111111-1111-1111-1111-111111111111'] = { name: 'Any 3 & up' };
  show('a venue’s own pattern is named: "I’ve got Any 3 & up"', w('c:11111111-1111-1111-1111-111111111111') === 'I’ve got Any 3 & up', w('c:11111111-1111-1111-1111-111111111111'));
  show('only the one-line game ever says "a line"', ['two', 'full', 'top', 'middle', 'bottom', 'corners'].every(function (k) { return !/a line$/.test(w(k)); }));
  show('the button is painted from the pattern every time the cards are painted, and starts as the one-line words', /paintClaimWords\(\);\s*paintRow2\(\);/.test(PLAY) && />I&#39;ve got a line<\/button>/.test(PLAY));
})();

print('\n== 2. the called number: a ring, the count, the last five ==');
(function () {
  var P = { called: [7, 42, 13, 88, 31, 64, 5, 77, 26, 90, 19, 53] };
  var lc = new Function('P', lift(PLAY, 'lastCalledHtml', 'play.html') + 'return lastCalledHtml;')(P);
  var h = lc();
  show('the newest number is in the ring', /<span class="lcring"><span class="lcnum">53<\/span><\/span>/.test(h), h);
  show('"12 of 90 called" (the run-up suites read .lcsub)', /<span class="lcsub">12 of 90 called<\/span>/.test(h), h);
  var chips = (h.match(/<span class="lcprev">(\d+)<\/span>/g) || []).map(function (x) { return +/>(\d+)</.exec(x)[1]; });
  show('the five before it, newest first: 19 90 26 77 5', chips.join(',') === '19,90,26,77,5', chips.join(','));
  P.called = [4, 9];
  var h2 = lc(); var c2 = (h2.match(/lcprev/g) || []).length;
  show('early in a game it shows only what there is (one before)', c2 === 1 && /lcnum">9</.test(h2), h2);
  P.called = [];
  show('before the first ball: "No numbers called yet"', /No numbers called yet/.test(lc()));
})();

print('\n== 3. tickets: closest first, "N to go" on the right ==');
(function () {
  show('the label has the ticket on the left and "N to go" on the right, and its text still reads "... · N to go"', /<span class="tkn"><\/span><span class="tksep"> · <\/span><span class="tkg"><\/span>/.test(PLAY) && /querySelector\("\.tkg"\)\.textContent=_g/.test(PLAY));
  show('the closest ticket is picked and classed .best, ties to the lower ticket', /te\.classList\.toggle\("best", oi===_best && _bt<99\)/.test(PLAY));
  show('the order is CSS order (never a rebuild), and not in the pages layout where the page is the ticket’s place', /te\.style\.order = \(lay==="pages"\) \? "" :/.test(PLAY));
  show('the page still builds the tickets in their own order (data-ti, data-card, data-n untouched)', /tk\.setAttribute\("data-ti",i\)/.test(PLAY) && /cell\.setAttribute\("data-card",i\); cell\.setAttribute\("data-n",n\)/.test(PLAY));
  show('"Highlight my lines" is a menu switch, off by default, remembered on this phone (vp-bhl), drawn in the gutter from the real cells', /id="hlChk"/.test(PLAY) && /localStorage\.getItem\("vp-bhl"\)==="1"/.test(PLAY) && /function drawLines\(tk\)/.test(PLAY));
})();

print('\n== 4. the shared frame, no tiny text, no em dash, lowercase venueplay ==');
(function () {
  show('the phone loads /app/vp-phone.css and has the option 5 header, the six code boxes, the pattern pill and the PRIZE label, the bottom sheet menu and our logo at the foot', /href="\/app\/vp-phone\.css"/.test(PLAY) && /id="hdrVenueName"/.test(PLAY) && /id="codeBoxes"/.test(PLAY) && /id="hdrPat"/.test(PLAY) && /class="vp-plabel">Prize</.test(PLAY) && /class="vp-menu hidden" id="menuPanel"/.test(PLAY) && /<div class="pfoot">/.test(PLAY));
  show('no separate "Connected" word and no player name in the header: the old .cardhead is hidden in the new look', /#vCard \.cardhead,#vCard \.cardctl\{display:none\}/.test(PLAY));
  var css = between(PLAY, 'THE NEW LOOK, NUMBER BINGO (Dean', '</style>');
  var small = (css.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).filter(function (x) { return parseFloat(/(\d+(?:\.\d+)?)px/.exec(x)[1]) < 15; });
  show('the phone’s new-look CSS has nothing under 15px', small.length === 0, small.join(' '));
  var small2 = (css.match(/clamp\(\s*(\d+(?:\.\d+)?)px/g) || []).filter(function (x) { return parseFloat(/(\d+(?:\.\d+)?)px/.exec(x)[1]) < 15; });
  show('and no clamp() that starts under 15px', small2.length === 0, small2.join(' '));
  var ccss = between(CON, 'THE NEW LOOK, NUMBER BINGO CALLER CONSOLE', '</style>');
  var small3 = (ccss.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).filter(function (x) { return parseFloat(/(\d+(?:\.\d+)?)px/.exec(x)[1]) < 15; });
  show('the console new-look CSS has nothing under 15px, and every rule in it is scoped to #bingoView', small3.length === 0 && ccss.split('\n').filter(function (l) { return /\{/.test(l) && !/^\s*\/?\*/.test(l); }).every(function (l) { return /^\s+#bingoView/.test(l); }), small3.join(' '));
  var all = [css, ccss, between(TV, 'THE NEW LOOK, NUMBER BINGO (Dean', '.in-tvapp #tvFsBtn')].join('\n');
  show('no em dash in any new-look block', all.indexOf('—') < 0);
  show('venueplay is lowercase in everything the new look adds to the phone', !/VenuePlay/.test(PLAY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '')));
})();

print('\n== 5. the wall ==');
(function () {
  var layers = ['tvLobby', 'tvRun', 'tvClaim', 'tvWin'].map(function (id) {
    var i = TV.indexOf('id="' + id + '"'); var j = TV.indexOf('<!-- BINGO:', i + 10); return TV.slice(i, j < 0 ? i + 6000 : j);
  }).join('\n');
  show('the join screen is the shared one: .layer.join, SCAN TO PLAY, the code in its box, the game name in the title line', /class="layer join hidden" id="tvLobby"/.test(TV) && /class="scanplay">Scan to play/.test(TV) && /<script src="\/app\/vp-tvgame\.js">/.test(TV) && /class="toplbl jtitle"><span class="tl-night">Bingo</.test(TV));
  show('the running wall: pattern and prize in the title line (same ids), the ring, "Last five", the count, the board', /<b id="tvPattern">/.test(TV) && /id="tvPrize"/.test(TV) && /class="curball"/.test(TV) && /Last five/.test(TV) && /id="tvBallCount"/.test(TV) && /id="tvBoard"/.test(TV));
  show('NO player or answered count on any bingo wall layer (Dean, 4 Nov 2026)', !/players|playing now|answered|tvPlayers|playerCount/i.test(layers.replace(/Playing for/g, '')), '');
  show('the win screen is F: a ring with the number, "BINGO ON n", the name, WINS and the prize', /id="winRing"/.test(TV) && /id="winOn"/.test(TV) && /id="winEye"/.test(TV) && /id="winsLabel"/.test(TV));
  show('and the card number is never visible on the wall', /#tvWin #winCardPart\{display:none!important\}/.test(TV));
  var stub = {};
  function $(id) { return stub[id] || (stub[id] = { style: {}, textContent: '', innerHTML: '' }); }
  var state = { called: [4, 23, 41], claimOn: 23, pattern: 'one', prize: 'Meat tray', winner: null };
  var PATTERN_NAMES = { one: 'One line' }, PATS = {};
  var src = lift(TV, 'patName', 'tv.html') + lift(TV, 'joinNames', 'tv.html') + lift(TV, 'lastCalledNo', 'tv.html') + lift(TV, 'renderWin', 'tv.html') + 'return renderWin;';
  var rw = new Function('$', 'state', 'PATTERN_NAMES', 'PATS', src)($, state, PATTERN_NAMES, PATS);
  state.winner = { name: 'Ann', cardNo: 332, prize: 'Meat tray', pattern: 'one' };
  rw();
  show('a phone win: the ring shows the number the claim was called on, the eyebrow says "Bingo on 23", the name and the prize', $('winOn').textContent === 23 && $('winRing').style.display === '' && $('winEye').textContent === 'Bingo on 23' && $('winName').textContent === 'Ann' && $('winPrizeVal').textContent === 'Meat tray', [$('winOn').textContent, $('winEye').textContent]);
  state.winner = { caller: true, pattern: 'one', prize: 'Meat tray' };
  rw();
  show('a real-balls win has no number and no ring, only the pattern and the prize', $('winRing').style.display === 'none' && $('winEye').textContent === 'Bingo' && $('winName').textContent === 'One line');
  state.winner = { name: 'Ann', number: 41, prize: 'x', pattern: 'one' };
  rw();
  show('a winner message that carries the number wins over the board', $('winOn').textContent === 41);
  show('claim time records the number once, and nothing else changes there', /state\.claimOn=lastCalledNo\(\);/.test(TV));
})();

print('\n== 6. the 18+ tick is still asked where the state asks ==');
(function () {
  show('the tick, its words and its button are in the page, in the new look', /id="age18Chk"/.test(PLAY) && /> I am 18 or over<\/label>/.test(PLAY) && /id="age18Btn"/.test(PLAY) && /font:400 44px\/1\.02 Anton/.test(PLAY));
})();

print('\n== 7. presentation only: the logic the look sits on is untouched ==');
(function () {
  ['cryptoInt', 'cardShort', 'cardMeetsPattern', 'calledSet', 'pressBingo', 'rowMissing', 'updateTension', 'pageForCalled', 'structureKey'].forEach(function (f) {
    show('play.html still has ' + f + '()', PLAY.indexOf('function ' + f + '(') >= 0);
  });
  ['buildBoard', 'updateBoard', 'revealBall', 'landBall', 'renderRun', 'renderClaim', 'calledSet'].forEach(function (f) {
    show('tv.html still has ' + f + '()', TV.indexOf('function ' + f + '(') >= 0);
  });
})();

print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error('bingo new look: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
