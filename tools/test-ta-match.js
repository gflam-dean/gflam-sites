/* TOP ANSWERS: THE MATCHER FORGIVES A PHONE, NEVER SCORES THE WRONG ANSWER, AND EVERY BOARD IS SOUND.
   Runs the real ta-match.js against the real ta-boards.js. Run: jsc tools/test-ta-match.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
var window = {};
(new Function('window', readFile('venueplay/app/topanswers/ta-match.js')))(window);
(new Function('window', readFile('venueplay/app/topanswers/ta-boards.js')))(window);
var M = window.TAMatch, B = window.TABoards;
function board(id){ return B.filter(function(b){ return b.id === id; })[0]; }
function says(id, typed){ var b = board(id), i = M.match(b, typed); return i < 0 ? null : b.answers[i].a; }

print('== what a phone does to people ==');
ok('capitals and spaces', says('pub-find', '  BEER ') === 'Beer');
ok('"a" in front', says('pub-find', 'a pool table') === 'Pool table');
ok('a plural', says('pizza', 'olive') === 'Olives' && says('bbq', 'sausage') === 'Sausages');
ok('slang in the also list', says('bbq', 'snags') === 'Sausages' && says('pubfood', 'parma') === 'Parmi');
ok('one slipped key on a long word', says('animal', 'kangaroi') === 'Kangaroo', says('animal', 'kangaroi'));
ok('two letters swapped', says('animal', 'wobmat') === 'Wombat', says('animal', 'wobmat'));
ok('a doubled letter', says('pizza', 'pepperroni') === 'Pepperoni');
ok('punctuation and accents', says('fastfood', "McDonald's!!") === "McDonald's" && says('coffee', 'café latte') === null);
print('== and never the wrong answer ==');
ok('a short word with one slip is refused (bar is not car)', says('pub-find', 'car') === null);
ok('two slips is too many', says('animal', 'kangoraa') === null);
ok('nonsense scores nothing', says('pub-find', 'spaceship') === null && says('pub-find', '') === null);
ok('an answer from another board scores nothing here', says('pizza', 'kangaroo') === null);
var tie = { q: 't', answers: [{ a: 'Sheets', pts: 50, also: [] }, { a: 'Shoots', pts: 50, also: [] }] };
ok('two answers equally close: refused, never guessed', M.match(tie, 'shoets') === -1 && M.match(tie, 'sheets') === 0);

print('== every board is sound ==');
var ids = {}, problems = [];
B.forEach(function(b){
  if (ids[b.id]) problems.push('duplicate id ' + b.id); ids[b.id] = 1;
  var sum = b.answers.reduce(function(t, a){ return t + a.pts; }, 0);
  if (sum !== 100) problems.push(b.id + ' points add to ' + sum);
  if (b.answers.length < 5 || b.answers.length > 8) problems.push(b.id + ' has ' + b.answers.length + ' answers');
  for (var i = 1; i < b.answers.length; i++) if (b.answers[i].pts > b.answers[i-1].pts) problems.push(b.id + ' not in rank order at ' + b.answers[i].a);
  var owner = {};
  b.answers.forEach(function(a, i){
    [a.a].concat(a.also || []).forEach(function(f){
      var n = M.norm(f);
      if (!n) { problems.push(b.id + ' empty form in ' + a.a); return; }
      if (owner[n] !== undefined && owner[n] !== i) problems.push(b.id + ': "' + f + '" belongs to two answers');
      owner[n] = i;
      // a typed form must land on its own answer, including through the one-slip rule
      if (M.match(b, f) !== i) problems.push(b.id + ': typing "' + f + '" does not score ' + a.a);
    });
  });
  if (/—|–/.test(JSON.stringify(b))) problems.push(b.id + ' has a dash the house rules forbid');
});
ok(B.length + ' boards, all sound', problems.length === 0, problems.slice(0, 8).join(' | '));
ok('at least 30 boards to start', B.length >= 30, String(B.length));
/* "Footy" is AFL in Melbourne and league in Brisbane. Scoring it as either one tells half the country
   they are wrong in front of the room, so it scores as neither (seen live, 30 Sep 2026). */
var sportB = B.filter(function(b){ return b.id === 'sport'; })[0];
ok('"footy" on the sport board is not credited to one code', sportB && M.match(sportB, 'footy') === -1);
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' top answers checks failed');
