/* TRIVIA, THE NEW LOOK AND THE TIME'S-UP BUZZER (Dean, 3 Nov 2026).

   RUNS the shipped code, lifted out of the pages, with stubs for the DOM and the sound card:

     1. the TV buzzer sounds ONCE, at the host's lock, only for a question that was live; never twice,
        never on a replay after the clock ran out, never after an early reveal, never when the host has
        switched it off, never on the sales-page demo; and a TV that cannot play sound says so to the
        console and puts nothing on the wall
     2. the reveal is the question's own grid: the same text with the same size rule, the same answer
        size, the right answer marked correct and the rest dimmed, and "31 /43 got it right"
     3. no empty-state text: a board with no rows paints nothing ("No scores yet" is gone); and with
        sixteen teams the top ten show, then the rest a page at a time with the leader kept at the top
     4. the podium stands second, first, third
     5. the console's Time's-up buzzer: OFF unless switched on, plays on the TV or on the console itself,
        both remembered for the venue and sent to the TV
     6. the phone result: the right answer green (RIGHT ANSWER, or RIGHT · YOURS), a wrong pick tagged
        YOURS, the rest dim, each with its count; the header shows the venue's name only when it has
        no logo

   Run: jsc tools/test-trivia-newlook.js   (from the repo root) */
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
var HOSTP = readFile('venueplay/app/trivia/host.html');
var PLAY = readFile('venueplay/app/trivia/play.html');
var BUZZER = readFile('venueplay/app/vp-buzzer.js');
function buzzerLib() { var w = {}; new Function('window', BUZZER)(w); return w.VPBuzzer; }   // the REAL shared sound

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
function all(e, out) { out = out || []; (e.children || []).forEach(function (k) { out.push(k); all(k, out); }); return out; }

(async function () {
/* ======================================================================================= 1 */
print('\n== 1. the time\'s-up buzzer: once, at the lock, for a live question only ==');
function tvRig(opts) {
  opts = opts || {};
  var dom = makeDom(), sent = [], starts = 0;
  function Ctx(state, resumeOk) {
    var self = this; this.state = state; this.currentTime = 0; this.destination = {};
    function node() { return { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, frequency: { value: 0 },
      connect: function () {}, start: function () { starts++; }, stop: function () {} }; }
    this.createGain = node; this.createOscillator = node;
    this.resume = function () { return resumeOk ? (self.state = 'running', Promise.resolve()) : Promise.reject(new Error('blocked')); };
  }
  var env = {
    $: dom.$, el: function (t, c, h) { var e = dom.mk(t, c); if (h != null) e.textContent = String(h); return e; },
    esc: function (s) { return String(s); }, LETTERS: ['A', 'B', 'C', 'D'],
    document: { createElement: function (t) { return dom.mk(t, ''); } },
    VP_DEMO: !!opts.demo, state: { phase: 'question', colour: true, title: '' },
    BUZZ: opts.asShipped ? new Function('return ' + /var BUZZ=(\{[^;]*\});/.exec(SCREEN)[1])() : { on: opts.off ? false : true, said: '' },
    window: { VPBuzzer: buzzerLib() },
    _ac: opts.noCtx ? null : new Ctx(opts.ctxState || 'running', !!opts.resumeOk),
    tvSend: function (o) { sent.push(o); }
  };
  var src = 'var curQ=null, answeredPids={}, ringTimer=null, boardRollTimer=null, RING_C=2*Math.PI*44, TV_BOARD_ROWS=' + /var TV_BOARD_ROWS = (\d+);/.exec(SCREEN)[1] + ', BOARD_PAGE_MS=4500, boardPageTimer=null, __iv=null;\n' +
    'function stopRing(){} function setRing(){} function tickRing(){} function show(){} function applyColour(){} function stopBoardPaging(){} function unlockAudio(){} function celebrate(){}\n' +
    'function setInterval(f){ __iv=f; return 1; } function setTimeout(){ return 0; } function clearTimeout(){} function clearInterval(){}\n' +
    liftAll(SCREEN, ['qClass', 'ansLenClass', 'renderQuestion', 'renderReveal', 'renderRows', 'boardPages', 'renderBoardPaged', 'sharedRanks', 'podiumEntries', 'renderPodium',
                     'buzzSay', 'timesUp'], 'trivia/screen.html') +
    '; return { q: renderQuestion, rev: renderReveal, rows: renderRows, board: renderBoardPaged, pod: renderPodium, up: timesUp, cur: function(){ return curQ; }, tick: function(){ if(__iv) __iv(); } };';
  var names = Object.keys(env);
  var api = new Function(names.join(','), src).apply(null, names.map(function (k) { return env[k]; }));
  api.dom = dom; api.sent = sent; api.env = env; api.starts = function () { return starts; };
  return api;
}
function liveQ(over) {
  var m = { t: 'question', qseq: 7, qi: 3, qtotal: 20, text: 'Which band released the album Back in Black?', options: ['AC/DC', 'Cold Chisel', 'INXS', 'Midnight Oil'],
            secs: 20, endsAt: Date.now() + 20000 };
  for (var k in (over || {})) m[k] = over[k];
  return m;
}
await (async function () {
  var a = tvRig();
  a.q(liveQ());
  a.up();
  show('a live question: the lock sounds the buzzer (two notes, two voices each)', a.starts() === 4, a.starts());
  show('and the console is told the TV\'s sound works', a.sent.length === 1 && a.sent[0].t === 'tv_here' && a.sent[0].sound === 'on', JSON.stringify(a.sent));
  a.up();
  show('a second lock for the same question is silent', a.starts() === 4, a.starts());
  a.q(liveQ({ qseq: 8 }));
  a.up();
  show('the next question sounds again', a.starts() === 8, a.starts());

  var b = tvRig();
  b.q(liveQ({ secs: 0, endsAt: Date.now() - 4000 }));   // a TV that reloaded after the clock ran out gets the question replayed, then a lock
  b.up();
  show('a replay after the clock ran out (secs 0) never sounds', b.starts() === 0, b.starts());

  var c = tvRig();
  c.q(liveQ());
  c.env.state.phase = 'reveal';
  c.rev({ t: 'reveal', correctIndex: 0, options: liveQ().options, split: [33, 5, 4, 1] });
  c.env.state.phase = 'question';                       // even if the phase were somehow question again
  c.up();
  show('the host revealed early: a later lock never sounds', c.starts() === 0, c.starts());

  var d = tvRig({ off: true });
  d.q(liveQ()); d.up();
  show('the host switched it off: silent', d.starts() === 0, d.starts());

  var z = tvRig({ asShipped: true });
  z.q(liveQ()); z.up();
  show('a TV the console has said nothing to is SILENT: the buzzer is off until the host switches it on', z.starts() === 0, z.starts());

  var e = tvRig({ demo: true });
  e.q(liveQ()); e.up();
  show('the sales-page demo is always silent', e.starts() === 0 && e.sent.length === 0, e.starts());

  var f = tvRig({ ctxState: 'suspended', resumeOk: false });
  f.q(liveQ());
  var threw = false; try { f.up(); } catch (x) { threw = true; }
  for (var i = 0; i < 20; i++) await null;
  show('sound blocked: nothing thrown, nothing played', !threw && f.starts() === 0, [threw, f.starts()]);
  show('and the console is told once: sound "off"', f.sent.length === 1 && f.sent[0].sound === 'off', JSON.stringify(f.sent));
  var wall = Object.keys(f.dom.els).filter(function (k) { return /sound|error|blocked/i.test(f.dom.els[k].textContent || ''); });
  show('nothing about it is written on the wall', wall.length === 0, wall.join());

  var g = tvRig({ ctxState: 'suspended', resumeOk: true });
  g.q(liveQ()); g.up();
  for (var j = 0; j < 20; j++) await null;
  show('a suspended sound card that resumes plays the buzzer', g.starts() === 4 && g.sent.length === 1 && g.sent[0].sound === 'on', [g.starts(), JSON.stringify(g.sent)]);
})();

/* ======================================================================================= 2 */
print('\n== 2. the reveal is the question\'s own grid ==');
(function () {
  var long = 'In which year did the Sydney Harbour Bridge open to traffic, after eight years of construction work?';
  var a = tvRig();
  a.q(liveQ({ text: long, options: ['1928', '1932', '1936', 'Never Gonna Give You Up and more'] }));
  var qt = a.dom.$('tvQText'), qa = a.dom.$('tvAnswers');
  a.env.state.phase = 'reveal';
  a.rev({ t: 'reveal', correctIndex: 1, options: ['1928', '1932', '1936', 'Never Gonna Give You Up and more'], split: [4, 31, 6, 2] });
  var rt = a.dom.$('tvRevQText'), ra = a.dom.$('tvRevAnswers');
  show('the reveal shows the question text', rt.textContent === long, rt.textContent);
  show('with the same size rule as the question', rt.className === qt.className && /q-long/.test(rt.className), [qt.className, rt.className]);
  show('and the answers at the same size as on the question', ra.className === qa.className && /alen-3/.test(ra.className), [qa.className, ra.className]);
  show('the same label line', a.dom.$('tvRevCount').textContent === 'Question 3 of 20', a.dom.$('tvRevCount').textContent);
  var cards = ra.children;
  show('four cards: the right one correct, the other three dim', cards.length === 4 && cards[1].classList.contains('correct') &&
       [0, 2, 3].every(function (i) { return cards[i].classList.contains('dim') && !cards[i].classList.contains('correct'); }), cards.map(function (c) { return c.className; }).join('|'));
  var tag = all(cards[1]).filter(function (k) { return k.className === 'rtag'; });
  show('the right card carries a RIGHT ANSWER tag', tag.length === 1 && /right answer/i.test(tag[0].textContent), tag.length);
  show('no "got it right" count is written in the clock\'s place (the right card carries it)', !a.dom.els.tvRevRight && !a.dom.els.tvRevOf, Object.keys(a.dom.els).join());
  var counts = cards.map(function (c) { return (all(c).filter(function (k) { return k.className === 'sc'; })[0] || {}).textContent; });
  show('only the right card keeps a count ("31 players"); the question is over, so the others show none', counts.join('|') === '|31 players||', counts.join('|'));
  var bars = cards.map(function (c) { return all(c).filter(function (k) { return k.className === 'split'; }).length; });
  show('and only the right card keeps its bar', bars.join() === '0,1,0,0', bars.join());
  var b = tvRig();
  b.q(liveQ()); b.rev({ t: 'reveal', correctIndex: 0, options: liveQ().options, split: [0, 0, 0, 0] });
  var bc = (all(b.dom.$('tvRevAnswers').children[0]).filter(function (k) { return k.className === 'sc'; })[0] || {}).textContent;
  show('nobody answered: the right card says "0 players", nothing else is written', bc === '0 players' && !b.dom.els.tvRevOf, bc);
})();

/* ======================================================================================= 3 */
print('\n== 3. no empty-state text on the wall ==');
(function () {
  var a = tvRig();
  a.board('Leaderboard', []);
  var box = a.dom.$('tvBoardRows');
  show('an empty leaderboard paints no rows and no words', box.children.length === 0, box.children.map(function (k) { return k.textContent; }).join('|'));
  a.rows(a.dom.$('tvRevBoard'), [], 5);
  show('nor does the reveal\'s board', a.dom.$('tvRevBoard').children.length === 0, a.dom.$('tvRevBoard').children.length);
  a.board('After question 3', [{ name: 'Table 6', points: 790 }, { name: 'Nans', points: 735 }]);
  var r = box.children;
  show('control: two teams are two rows, first marked top1, places without a "#"', r.length === 2 && r[0].classList.contains('top1') && r[0].children[0].textContent === '1', r.length && r[0].children[0].textContent);
})();

print('\n== 3b. sixteen teams: the top ten, then the rest a page at a time, the leader kept at the top ==');
(function () {
  var a = tvRig(), T = [];
  for (var i = 0; i < 16; i++) T.push({ name: 'Team ' + (i + 1), points: 1000 - i * 10 });
  a.board('After question 3', T);
  var box = a.dom.$('tvBoardRows'), pg = a.dom.$('tvBoardPage');
  function names() { return box.children.map(function (r) { return r.children[1].textContent; }); }
  show('page one is the top ten', box.children.length === 10 && names()[0] === 'Team 1' && names()[9] === 'Team 10', names().join());
  show('with "Page 1 of 2" under it', /^Page 1 of 2 . teams 1 to 10 of 16$/.test(pg.textContent) && !pg.classList.contains('hidden'), pg.textContent);
  a.tick();
  show('page two: the leader at the top, then 11 to 16', box.children.length === 7 && names()[0] === 'Team 1' && box.children[0].classList.contains('pinned') &&
       names()[1] === 'Team 11' && names()[6] === 'Team 16', names().join());
  show('with "Page 2 of 2 · teams 11 to 16"', /^Page 2 of 2 . teams 11 to 16 of 16$/.test(pg.textContent), pg.textContent);
  a.tick();
  show('and round again to page one', names()[9] === 'Team 10' && box.children.length === 10, names().join());
  var b = tvRig(); b.board('Final scores', T.slice(0, 10));
  show('ten teams or fewer: one page, no page line', b.dom.$('tvBoardRows').children.length === 10 && b.dom.$('tvBoardPage').classList.contains('hidden'));
  var c = tvRig(), T28 = []; for (var k = 0; k < 28; k++) T28.push({ name: 'T' + (k + 1), points: 999 - k });
  c.board('Final scores', T28);
  c.tick(); c.tick();
  show('twenty-eight teams: three pages, the last is the leader and 20 to 28', /^Page 3 of 3 . teams 20 to 28 of 28$/.test(c.dom.$('tvBoardPage').textContent) &&
       c.dom.$('tvBoardRows').children.length === 10, c.dom.$('tvBoardPage').textContent);
})();

/* ======================================================================================= 4 */
print('\n== 4. the podium stands second, first, third ==');
(function () {
  var a = tvRig();
  var B = [{ name: 'Q Nolans', points: 840 }, { name: 'Table 6', points: 790 }, { name: 'Nans', points: 735 }, { name: 'Last', points: 600 }];
  a.pod(B.slice(0, 3), B);
  var cols = a.dom.$('tvPodiumCols').children;
  show('three steps, left to right: second, first, third', cols.length === 3 && cols[0].classList.contains('second') && cols[1].classList.contains('first') && cols[2].classList.contains('third'),
       cols.map(function (c) { return c.className; }).join('|'));
  var names = cols.map(function (c) { return all(c).filter(function (k) { return k.className === 'pn'; })[0].textContent; });
  show('with the right team on each', names.join('|') === 'Table 6|Q Nolans|Nans', names.join('|'));
  var t = tvRig();
  var T = [{ name: 'A', points: 900 }, { name: 'B', points: 900 }, { name: 'C', points: 700 }];
  t.pod(T, T);
  var tc = t.dom.$('tvPodiumCols').children;
  show('a tie for first puts both winners on first steps, in the middle', tc.length === 3 && tc[0].classList.contains('first') && tc[1].classList.contains('first') && tc[2].classList.contains('third'),
       tc.map(function (c) { return c.className; }).join('|'));
})();

/* ======================================================================================= 5 */
print('\n== 5. the console: a compact Time\'s-up buzzer switch, OFF unless switched on, and where it plays ==');
(function () {
  function rig(stored, where) {
    var store = {}, sent = [], queued = 0, starts = 0;
    if (stored !== undefined) store['vpTriviaBuzzer:v1'] = stored;
    if (where !== undefined) store['vpTriviaBuzzWhere:v1'] = where;
    var G = { venueId: 'v1', buzzer: false, buzzWhere: 'tv', status: 'setup', speedBonus: true, doublePoints: false, doubleLast: 10 };
    var localStorage = { getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; }, setItem: function (k, v) { store[k] = v; } };
    function btn(v) { var c = {}; return { v: v, attrs: {}, getAttribute: function (k) { return k === 'data-v' ? v : this.attrs[k]; }, setAttribute: function (k, x) { this.attrs[k] = x; },
      classList: { toggle: function (x, on) { if (on) c[x] = 1; else delete c[x]; }, add: function (x) { c[x] = 1; }, contains: function (x) { return !!c[x]; } } }; }
    var seg = { children: [btn('on'), btn('off')] }, where_ = { children: [btn('tv'), btn('device')] }, note = { textContent: '', hid: true, classList: { add: function () { note.hid = true; }, remove: function () { note.hid = false; } } }, others = {};
    function $(id) { return id === 'cfgBuzzer' ? seg : id === 'cfgBuzzWhere' ? where_ : id === 'tvSoundNote' ? note : (others[id] = others[id] || { style: {} }); }
    function node() { return { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, frequency: { value: 0 }, connect: function () {}, start: function () { starts++; }, stop: function () {} }; }
    function AC() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createGain = node; this.createOscillator = node; this.resume = function () { return Promise.resolve(); }; }
    var win = { VPBuzzer: buzzerLib(), AudioContext: AC };
    var doc = { addEventListener: function () {} };
    var api = new Function('G', 'localStorage', '$', 'send', 'queueTriviaPrefs', 'setFromUrl', 'syncSetCount', 'paintRoundQs', 'paintDouble', 'window', 'document',
      liftAll(HOSTP, ['buzzKey', 'whereKey', 'tvBuzz', 'paintSeg', 'paintBuzzer', 'loadBuzzer', 'buzzChanged', 'setBuzzer', 'setBuzzWhere', 'unlockHostAudio', 'hostTimesUp', 'triviaPrefs', 'applyTriviaPrefs'], 'trivia/host.html') +
      'var _hac=null; return { load: loadBuzzer, set: setBuzzer, where: setBuzzWhere, up: hostTimesUp, tv: tvBuzz, collect: triviaPrefs, apply: applyTriviaPrefs };')(
      G, localStorage, $, function (o) { sent.push(o); }, function () { queued++; }, function () { return ''; }, function () {}, function () {}, function () {}, win, doc);
    api.G = G; api.store = store; api.sent = sent; api.note = note; api.queued = function () { return queued; }; api.starts = function () { return starts; };
    api.shown = function () { return seg.children.filter(function (b) { return b.classList.contains('on'); }).map(function (b) { return b.v; }).join() + '/' +
                                       where_.children.filter(function (b) { return b.classList.contains('on'); }).map(function (b) { return b.v; }).join(); };
    return api;
  }
  var a = rig(); a.load();
  show('nothing saved: OFF, playing on the TV, and the switch shows it', a.G.buzzer === false && a.shown() === 'off/tv' && a.tv() === false, [a.G.buzzer, a.shown()]);
  var b = rig('1', 'device'); b.load();
  show('this venue switched it on, on this device: remembered', b.G.buzzer === true && b.G.buzzWhere === 'device' && b.shown() === 'on/device', [b.G.buzzer, b.shown()]);
  a.set(true, true);
  show('tapping On tells the TV at once, keeps it for the venue, and saves the venue\'s setup', a.sent.length === 1 && a.sent[0].t === 'buzzer' && a.sent[0].on === true &&
       a.store['vpTriviaBuzzer:v1'] === '1' && a.queued() === 1 && a.shown() === 'on/tv', JSON.stringify([a.sent, a.store, a.queued()]));
  a.where('device', true);
  show('"This device": the TV is told to stay silent', a.sent.length === 2 && a.sent[1].on === false && a.tv() === false && a.store['vpTriviaBuzzWhere:v1'] === 'device', JSON.stringify(a.sent));
  show('and at the lock the console plays it itself (two notes, two voices)', a.up() === true && a.starts() === 4, a.starts());
  var t = rig('1', 'tv'); t.load();
  show('playing on the TV, the console stays silent at the lock', t.up() === false && t.starts() === 0 && t.tv() === true, t.starts());
  var o = rig('0', 'device'); o.load();
  show('switched off, nothing plays anywhere', o.up() === false && o.starts() === 0 && o.tv() === false);
  show('the venue\'s saved setup carries both', JSON.stringify([a.collect().buzzer, a.collect().buzzer_where, rig().collect().buzzer, rig().collect().buzzer_where]) === '[true,"device",false,"tv"]',
       JSON.stringify([a.collect(), rig().collect()]));
  var c = rig(); c.load(); c.G.status = 'question'; c.apply({ buzzer: true, buzzer_where: 'device' });
  show('the venue\'s saved choice wins on another tablet, even mid-quiz', c.G.buzzer === true && c.G.buzzWhere === 'device' && c.shown() === 'on/device', c.shown());
})();

/* ======================================================================================= 6 */
print('\n== 6. the phone: the result cards and the header ==');
(function () {
  function phone(choice) {
    var dom = makeDom();
    var P = { colour: true, q: { label: 'Question 3 of 20', text: 'Which band released Back in Black?', options: ['AC/DC', 'Cold Chisel', 'INXS', 'Midnight Oil'] } };
    var f = new Function('P', '$', 'el', 'esc', 'LETTERS', liftAll(PLAY, ['phoneQClass', 'phoneAnsClass', 'paintRevealCards'], 'trivia/play.html') + '; return paintRevealCards;');
    var paint = f(P, dom.$, function (t, c, h) { var e = dom.mk(t, c); if (h != null) e.textContent = String(h); return e; }, function (s) { return String(s); }, ['A', 'B', 'C', 'D']);
    paint({ t: 'reveal', correctIndex: 0, options: P.q.options, split: [33, 5, 4, 1] }, 0, choice);
    return dom;
  }
  function tagOf(c) { var t = all(c).filter(function (k) { return k.className === 'tg'; })[0]; return t ? t.textContent : ''; }
  var w = phone(1), cards = w.$('pResAnswers').children;
  show('a wrong pick: the right answer is green and tagged RIGHT ANSWER', cards[0].classList.contains('right') && /^right answer$/i.test(tagOf(cards[0])), [cards[0].className, tagOf(cards[0])]);
  show('your pick is outlined and tagged YOURS', cards[1].classList.contains('mine') && /^yours$/i.test(tagOf(cards[1])), [cards[1].className, tagOf(cards[1])]);
  show('the other two dim, with no tag', [2, 3].every(function (i) { return cards[i].classList.contains('dim') && !tagOf(cards[i]); }));
  var cnt = cards.map(function (c) { return (all(c).filter(function (k) { return k.className === 'cnt'; })[0] || {}).textContent; });
  show('each card shows how many picked it', cnt.join('|') === '33|5|4|1', cnt.join('|'));
  show('the ring says 33 right', w.$('pResRight').textContent === 33 && w.$('pResRing').style.visibility !== 'hidden', w.$('pResRight').textContent);
  show('the question and label are the ones the room saw', w.$('pResQ').textContent === 'Which band released Back in Black?' && w.$('pResCount').textContent === 'Question 3 of 20');
  var r = phone(0), rc = r.$('pResAnswers').children;
  show('a right pick: RIGHT · YOURS on the green card, no separate YOURS', rc[0].classList.contains('right') && /right .* yours/i.test(tagOf(rc[0])) && !rc.some(function (c) { return c.classList.contains('mine'); }), tagOf(rc[0]));
  var n = phone(null), nc = n.$('pResAnswers').children;
  show('no answer: the right one green, nothing tagged YOURS', nc[0].classList.contains('right') && !nc.some(function (c) { return c.classList.contains('mine'); }));

  var dom = makeDom();
  var hv = new Function('$', lift(PLAY, 'headerVenue', 'trivia/play.html') + '; return headerVenue;')(dom.$);
  hv('', 'The Pause Bar');
  show('no logo: the venue\'s name is shown top left', dom.$('hdrVenueName').textContent === 'The Pause Bar' && !dom.$('hdrVenueName').classList.contains('hidden'));
  hv('https://x/logo.png', 'The Pause Bar');
  show('a logo: the name is hidden (never both)', dom.$('hdrVenueName').classList.contains('hidden'));
  hv('', 'Pullman Penrith Panthers & Western Sydney Community Centre');
  show('a long name steps down a size, whole (never cut short)', dom.$('hdrVenueName').classList.contains('long') && dom.$('hdrVenueName').textContent.length > 50);
})();

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
})().catch(function (e) { print('FAIL ' + e); throw e; });
