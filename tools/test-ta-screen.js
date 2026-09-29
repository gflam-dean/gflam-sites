/* PUNTERS RECKON TV: the board paints from messages alone, and never holds an answer before it is found.
   RUNS the real app/topanswers/pr-board.js (the one copy both TV pages mount) against a small fake page,
   fed by the real referee (pr-game.js). Run: jsc tools/test-ta-screen.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
/* A fake element that parses just enough of what pr-board writes: data-r, data-i and data-b nodes. */
function Node(){ var cls = {}; this.style = {}; this.textContent = ''; this._html = '';
  this.classList = { add: function(){ for (var i = 0; i < arguments.length; i++) cls[arguments[i]] = 1; }, remove: function(c){ delete cls[c]; },
    contains: function(c){ return !!cls[c]; }, toggle: function(c, on){ if (on) cls[c] = 1; else delete cls[c]; } }; }
var registry = {};
function HostEl(){ Node.call(this); }
Object.defineProperty(HostEl.prototype, 'innerHTML', {
  get: function(){ return this._html; },
  set: function(h){ this._html = h; var re = /data-([rib])="([^"]+)"/g, m;
    while ((m = re.exec(h))) { var k = m[1] + ':' + m[2]; if (!registry[k] || true) registry[k] = registry[k] && registry[k].keep ? registry[k] : new HostEl(); } }
});
HostEl.prototype.querySelector = function(sel){ var m = /\[data-([rib])="([^"]+)"\]/.exec(sel); return m ? (registry[m[1] + ':' + m[2]] || null) : null; };
var host = new HostEl();
var doc = { getElementById: function(){ return null; }, createElement: function(){ return { }; }, head: { appendChild: function(){} } };
var window = { document: doc, crypto: { getRandomValues: function(a){ a[0] = 1; return a; } } };
['ta-match.js', 'ta-boards.js', 'pr-game.js', 'pr-board.js'].forEach(function(f){
  (new Function('window', 'setInterval', 'clearInterval', readFile('venueplay/app/topanswers/' + f)))(window, function(){ return 1; }, function(){});
});
var B = window.PRBoard.mount(host, doc), q = function(k){ return host.querySelector('[data-' + k + ']'); };
var board = window.TABoards.filter(function(b){ return b.id === 'pizza'; })[0];
var g = new window.PRGame.Game({ boards: [board], pick: function(){ return 0; } });
var pub = g.nextBoard(45);
B.onMsg(pub);
ok('the question is up and the round is named', q('r="q"').textContent === board.q && /Punters Reckon · round 1/.test(q('r="eb"').textContent));
var html = q('r="bd"').innerHTML;
ok('one hidden card per answer', (html.match(/class="slot"/g) || []).length === board.answers.length);
ok('and not one answer on the page before it is found', !/Pepperoni|Cheese|Pineapple/.test(html));
ok('"found 0 of 7"', q('r="found"').textContent === '0 of ' + board.answers.length);
var r = g.guess('p1', 'Sam', 'salami');
B.onMsg(r.reveal);
ok('a found answer flips, with its text and who found it', q('i="0"').classList.contains('open') && /Pepperoni/.test(q('b="0"').innerHTML) && /Sam/.test(q('b="0"').innerHTML));
ok('and the count goes up', q('r="found"').textContent === '1 of ' + board.answers.length);
B.onMsg(r.reveal);
ok('the same reveal twice counts once', q('r="found"').textContent === '1 of ' + board.answers.length);
var end = g.endBoard();
B.onMsg(end.showall);
ok('end of board: the rest turn over greyed, with their answers', q('i="1"').classList.contains('missed') && /Cheese/.test(q('b="1"').innerHTML) && !q('i="0"').classList.contains('missed'));
B.onMsg(pub);
B.onMsg({ t: 'ta_reveal', i: 3, a: '<b>x</b>', pts: 1, by: '<i>y</i>' });
ok('answer text and names are escaped, never put on the page as markup', !/<b>x<\/b>|<i>y<\/i>/.test(q('b="3"').innerHTML) && /&lt;b&gt;x/.test(q('b="3"').innerHTML));
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' punters reckon screen checks failed');
