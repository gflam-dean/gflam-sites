/* TOP ANSWERS TV: the board paints from messages alone, the same way every VenuePlay screen does.
   RUNS the real script out of app/topanswers/screen.html against a fake page. Run: jsc tools/test-ta-screen.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
var src = readFile('venueplay/app/topanswers/screen.html');
var body = src.match(/<script>([\s\S]*?)<\/script>/)[1];
var els = {};
function el(id){ if (els[id]) return els[id]; var cls = {}; return (els[id] = { id: id, textContent: '', innerHTML: '', style: {}, offsetWidth: 1,
  children: [], classList: { add: function(){ for (var i = 0; i < arguments.length; i++) cls[arguments[i]] = 1; }, remove: function(c){ delete cls[c]; },
  toggle: function(c, on){ if (on) cls[c] = 1; else delete cls[c]; }, contains: function(c){ return !!cls[c]; } } }); }
var xs = [el('x1'), el('x2'), el('x3')]; el('strikes').children = xs;
var doc = { getElementById: el };
var win = {};
(new Function('window', 'document', 'location', 'setTimeout', body))(win, doc, { search: '' }, function(){});
var on = win.TAScreen.onMsg;
on({ t: 'ta_board', round: 2, q: 'Name a pizza topping', n: 3,
     teams: [{ name: 'Quizzly Bears', score: 40 }, { name: 'Les Quizerables', score: 10 }], turn: 1 });
ok('the question and round are up', el('q').textContent === 'Name a pizza topping' && /round 2/.test(el('eyebrow').textContent));
ok('three hidden answers, numbered', (el('board').innerHTML.match(/class="slot"/g) || []).length === 3);
ok('and not one answer is on the page before it is found', !/Pepperoni|Cheese|Ham/.test(el('board').innerHTML));
ok('the board message itself carries no answers (every phone hears it)', !/answers\s*:/.test(src.match(/at\(0, function\(\)\{ onMsg\(\{ t:"ta_board"[^\n]*/)[0]));
ok('the team whose turn it is is lit', el('teamB').classList.contains('turn') && !el('teamA').classList.contains('turn') && el('tsA').textContent === 40);
el('slot1'); el('back1'); on({ t: 'ta_reveal', i: 1, a: 'Cheese', pts: 20 });
ok('a found answer flips, shows its text, and adds to the board total', el('slot1').classList.contains('open') && /Cheese/.test(el('back1').innerHTML) && el('pot').textContent === 20);
on({ t: 'ta_reveal', i: 1, a: 'Cheese', pts: 20 });
ok('the same answer found twice counts once', el('pot').textContent === 20);
on({ t: 'ta_strike', n: 2 });
ok('two strikes light two X marks', xs[0].classList.contains('on') && xs[1].classList.contains('on') && !xs[2].classList.contains('on'));
el('slot0'); el('slot2'); el('back0'); el('back2'); on({ t: 'ta_showall', rest: [{ i: 0, a: 'Pepperoni', pts: 30 }, { i: 2, a: 'Ham', pts: 16 }] });
ok('end of board: the rest turn over greyed, with their answers', el('slot0').classList.contains('missed') && /Pepperoni/.test(el('back0').innerHTML) && el('slot2').classList.contains('open') && !el('slot1').classList.contains('missed'));
ok('the board total is still only what was found', el('pot').textContent === 20);
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' top answers screen checks failed');
