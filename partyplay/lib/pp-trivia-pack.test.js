/* The ready-made rounds have to be usable questions, not just JSON.

   Three things can quietly ruin a round: an answer that is not among its own
   options (nobody can ever get it right), a duplicate option (two identical
   buttons), and a licence block that got dropped on the way through. The last
   one has happened before on this exact bank.
*/
var PASS = 0, FAIL = 0;
function check(name, ok, detail) {
  if (ok) { PASS++; } else { FAIL++; print('  FAIL ' + name + (detail ? ': ' + detail : '')); }
}

var idx = JSON.parse(readFile('/Users/dean.tindale/gflam-sites-current/partyplay/data/trivia/index.json'));
check('the index lists categories', idx.categories && idx.categories.length >= 8,
      'got ' + (idx.categories ? idx.categories.length : 0));
check('the index carries the licence', !!idx.license);
check('the index carries attributions', !!(idx.attributions && idx.attributions.length));

var totalQ = 0, badAnswer = 0, dupOption = 0, noLicence = 0, tooFew = 0, longQ = 0;
idx.categories.forEach(function (c) {
  var pack = JSON.parse(readFile('/Users/dean.tindale/gflam-sites-current/partyplay/' + c.file));
  if (!pack.license || !pack.attributions || !pack.attributions.length) noLicence++;
  if (pack.questions.length < 40) tooFew++;
  pack.questions.forEach(function (q) {
    totalQ++;
    if (q.options.indexOf(q.answer) < 0) badAnswer++;
    var seen = {};
    q.options.forEach(function (o) {
      var k = String(o).trim().toLowerCase();
      if (seen[k]) dupOption++;
      seen[k] = 1;
    });
    if (q.q.length > 180) longQ++;
  });
});

check('every pack carries the licence and credits', noLicence === 0, noLicence + ' packs missing it');
check('every pack has enough for four rounds', tooFew === 0, tooFew + ' packs under 40');
check('every answer is among its own options', badAnswer === 0, badAnswer + ' broken');
check('no question shows the same option twice', dupOption === 0, dupOption + ' duplicates');
check('no question is too long for a phone', longQ === 0, longQ + ' over 180 chars');
check('there are enough questions overall', totalQ >= 1500, totalQ + ' total');

/* And they must survive the thing that actually renders them. A bank question
   carries its own options, which pp-quiz must use verbatim rather than
   inventing decoys from the other answers in the round. */
var quizSrc = readFile('/Users/dean.tindale/gflam-sites-current/partyplay/lib/pp-quiz.js');
var module = { exports: {} };
(new Function('module', 'exports', quizSrc))(module, module.exports);
var PPQuiz = module.exports;

var sample = JSON.parse(readFile('/Users/dean.tindale/gflam-sites-current/partyplay/data/trivia/music.json'));
var items = sample.questions.slice(0, 10).map(function (q) {
  return { q: q.q, a: q.answer, options: q.options.slice() };
});
var kept = 0, correctPresent = 0, stable = true;
for (var i = 0; i < items.length; i++) {
  var o = PPQuiz.options(items, i, 12345);
  if (!o.derived) kept++;                       // used the pack's own options
  if (o.options.indexOf(items[i].a) >= 0) correctPresent++;
  var again = PPQuiz.options(items, i, 12345);  // same seed, same order, or the
  if (again.options.join('|') !== o.options.join('|')) stable = false;  // TV and phones disagree
}
check('pack options are used, not replaced by decoys', kept === items.length, kept + ' of ' + items.length);
check('the right answer is always on screen', correctPresent === items.length);
check('the same seed gives the same order every time', stable);

print(FAIL === 0 ? ('ALL ' + PASS + ' CHECKS PASSED (' + totalQ + ' questions)')
                 : (FAIL + ' FAILED of ' + (PASS + FAIL)));

/* The charades and Who am I word packs. Different content, same failure modes:
   a duplicate word means the same turn twice, an empty one is a dead turn, and
   a word long enough to wrap on a phone is unreadable to the person acting. */
['charades', 'guesswho'].forEach(function (kind) {
  var wi = JSON.parse(readFile('/Users/dean.tindale/gflam-sites-current/partyplay/data/words/' + kind + '-index.json'));
  check(kind + ' index lists categories', wi.categories && wi.categories.length >= 4,
        'got ' + (wi.categories ? wi.categories.length : 0));
  var all = {}, empty = 0, tooLong = 0, dupWithin = 0, words = 0;
  wi.categories.forEach(function (c) {
    var pack = JSON.parse(readFile('/Users/dean.tindale/gflam-sites-current/partyplay/' + c.file));
    var seen = {};
    check(kind + '/' + c.slug + ' has enough for a turn each', pack.words.length >= 15,
          pack.words.length + ' words');
    pack.words.forEach(function (w) {
      words++;
      var k = String(w).trim().toLowerCase();
      if (!k) empty++;
      if (String(w).length > 34) tooLong++;
      if (seen[k]) dupWithin++;
      seen[k] = 1;
      all[k] = (all[k] || 0) + 1;
    });
  });
  check(kind + ' has no empty words', empty === 0, empty + ' empty');
  check(kind + ' has nothing too long to act or read', tooLong === 0, tooLong + ' over 34 chars');
  check(kind + ' repeats nothing inside a category', dupWithin === 0, dupWithin + ' repeated');
  check(kind + ' has a decent total', words >= 100, words + ' words');
});

print(FAIL === 0 ? ('ALL ' + PASS + ' CHECKS PASSED') : (FAIL + ' FAILED of ' + (PASS + FAIL)));
