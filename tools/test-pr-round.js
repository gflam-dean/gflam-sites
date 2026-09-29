/* PUNTERS RECKON, A WHOLE ROUND: two phones and the TV on one fake channel, the real referee deciding.
   Runs the real pr-game.js, pr-phone.js and pr-board.js. Every message on the channel is recorded, so
   the test can prove no answer travelled before it was found, and that each phone only hears its own
   results. The console's glue in app/trivia/host.html is checked for the same rules.
   Run: jsc tools/test-pr-round.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
function Node(){ var cls = {}; this.style = {}; this.textContent = ''; this._html = ''; this._l = {};
  this.classList = { add: function(){ for (var i = 0; i < arguments.length; i++) cls[arguments[i]] = 1; }, remove: function(c){ delete cls[c]; },
    contains: function(c){ return !!cls[c]; }, toggle: function(c, on){ if (on) cls[c] = 1; else delete cls[c]; } }; }
Node.prototype.addEventListener = function(t, f){ this._l[t] = f; };
/* One registry per mounted tree: whatever is written into any box inside it can be found from the top. */
function Host(reg){ Node.call(this); this.reg = reg || {}; }
Host.prototype = Object.create(Node.prototype);
Object.defineProperty(Host.prototype, 'innerHTML', { get: function(){ return this._html; }, set: function(h){ this._html = h; var re = /(?:data-([rib])="([^"]+)"|id="(pr[A-Za-z]+)")/g, m;
  while ((m = re.exec(h))) { var k = m[3] ? '#' + m[3] : m[1] + ':' + m[2]; this.reg[k] = new Host(this.reg); } } });
Host.prototype.querySelector = function(sel){ var m = /\[data-([rib])="([^"]+)"\]/.exec(sel); if (m) return this.reg[m[1] + ':' + m[2]] || null; return this.reg[sel] || null; };
var doc = { getElementById: function(){ return null; }, createElement: function(){ return {}; }, head: { appendChild: function(){} } };
var window = { document: doc, crypto: { getRandomValues: function(a){ a[0] = 3; return a; } } };
['ta-match.js', 'ta-boards.js', 'pr-game.js', 'pr-board.js', 'pr-phone.js'].forEach(function(f){
  (new Function('window', 'setInterval', 'clearInterval', readFile('venueplay/app/topanswers/' + f)))(window, function(){ return 1; }, function(){});
});

/* The channel: everything the host sends goes to the TV and both phones, and is recorded. */
var wire = [], toHost = [];
var tvEl = new Host(), tv = window.PRBoard.mount(tvEl, doc);
var phones = [{ pid: 'p1', name: 'Sam' }, { pid: 'p2', name: 'Jo' }].map(function(me){
  var el = new Host(), alive = 0, shown = 0;
  var ctl = window.PRPhone.mount(el, { send: function(o){ toHost.push(o); }, alive: function(){ alive++; }, me: function(){ return me; }, show: function(){ shown++; } }, doc);
  return { me: me, el: el, ctl: ctl, alive: function(){ return alive; }, shown: function(){ return shown; } };
});
function hostSend(o){ wire.push(JSON.parse(JSON.stringify(o))); tv.onMsg(o); phones.forEach(function(p){ p.ctl.onMsg(o); }); }

/* The host's side, exactly as the console glue does it (checked against host.html at the end). */
var board = window.TABoards.filter(function(b){ return b.id === 'bbq'; })[0];
var g = new window.PRGame.Game({ boards: [board], pick: function(){ return 0; } });
function hostHears(){ while (toHost.length) { var m = toHost.shift(); if (m.t !== 'pr_guess') continue;
  var r = g.guess(m.pid, m.name, m.text); hostSend(r.result); if (r.reveal) hostSend(r.reveal); } }
function type(p, text){ var inp = p.el.querySelector('#prIn'); inp.value = text; p.el.querySelector('#prForm')._l.submit({ preventDefault: function(){} }); hostHears(); }

hostSend(g.nextBoard(45));
ok('both phones get the board, show it, and mark themselves played', phones.every(function(p){ return p.shown() === 1 && p.alive() === 1; }));
ok('each phone can type', phones.every(function(p){ return !!p.el.querySelector('#prIn'); }));
type(phones[0], 'snags');
ok('Sam\'s phone shows +36 Sausages', /\+36 Sausages/.test(phones[0].el.innerHTML), phones[0].el.innerHTML.slice(0, 300));
ok('Jo\'s phone shows nothing of Sam\'s guess', !/snags|Sausages/.test(phones[1].el.innerHTML));
ok('the TV flipped Sausages, found by Sam', /Sausages/.test(tvEl.querySelector('[data-b="0"]').innerHTML) && /Sam/.test(tvEl.querySelector('[data-b="0"]').innerHTML));
type(phones[1], 'tofu');
ok('a miss says not on the board', /not on the board/.test(phones[1].el.innerHTML) && /<b>2<\/b> guesses left/.test(phones[1].el.innerHTML));
type(phones[1], 'rump'); type(phones[1], 'onion');
ok('three guesses and Jo is done', !phones[1].el.querySelector('#prIn') || /That is your guesses/.test(phones[1].el.innerHTML));
var end = g.endBoard(); hostSend(end.showall); hostSend(end.leaderboard);
ok('the board ends on both phones', phones.every(function(p){ return /Board over/.test(p.el.innerHTML); }));
ok('the leaderboard: Jo 38 (steak 24 + onions 14) above Sam 36', JSON.stringify(end.leaderboard.rows) === JSON.stringify([{ name: 'Jo', points: 38 }, { name: 'Sam', points: 36 }]), JSON.stringify(end.leaderboard.rows));

print('== what went down the wire ==');
var firstShow = -1; wire.forEach(function(m, i){ if (m.t === 'ta_showall' && firstShow < 0) firstShow = i; });
var early = wire.slice(0, firstShow).filter(function(m){ return m.t === 'ta_board' || m.t === 'pr_result' || m.t === 'ta_reveal'; })
  .map(JSON.stringify).join(' ');
ok('Prawns (nobody found it) never travelled before the end of the board', !/Prawns/.test(early));
ok('every result carries the pid of the one phone it is for', wire.filter(function(m){ return m.t === 'pr_result'; }).every(function(m){ return m.to === 'p1' || m.to === 'p2'; }));

print('== the console glue in app/trivia/host.html keeps the same rules ==');
var H = readFile('venueplay/app/trivia/host.html');
ok('a guess result goes back addressed (gsend of pr.result)', /gsend\(pr\.result\);/.test(H));
ok('only a FOUND answer is broadcast', /if\(pr\.reveal\)\{ bcast\(pr\.reveal\); \}/.test(H));
ok('the board with its answers is never sent anywhere', !/(bcast|gsend|send|to)\(G\.pr\.board\)/.test(H));
ok('Punters Reckon only appears with ?pr=1 (switched off for venues)', /if\(\/\[\?&\]pr=1\/\.test\(location\.search\)\)\{ var _pf=\$\("prField"\)/.test(H) && /id="prField" class="field hidden"|class="field hidden" id="prField"/.test(H));
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' punters reckon round checks failed');
