/* THE MUSICAL BINGO SETUP, AS DEAN ASKED FOR IT ON 28 OCT 2026.

   a. Auto play is gone: "the host isn't gonna be like oh I've only got eight seconds to talk; get rid
      of it." A clip ending starts no countdown and plays nothing.
   b. "Reveal the song on the TV" sits on the same row as "Winning pattern", two columns at desktop,
      one at phone width.
   c. No "Players 0" box in setup: before the lobby opens it could only ever say 0.
   d. The setup (theme, well-known songs only, pattern, prize, reveal) is saved for the VENUE through
      the game Worker's /host/game-prefs into vp_venue_settings.game_prefs (migration 121). Since the
      same day every game uses one shared mechanism (VP.gamePrefs), and the round trip for all five is
      tools/test-game-setup-advanced.js; here, only that signing in starts it.

   The functions are lifted out of the page and the Worker that ship and RUN. (b) and (c) are the
   page's own markup and stylesheet, parsed into a tree, since the layout is the thing asked for.

   Run: jsc tools/test-musical-setup-saved.js */
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + saw : '')); } }
function section(t) { print(''); print(t); }
var HOST = readFile('venueplay/app/musical/host.html');
var WORKER = readFile('venueplay-backend/worker/venueplay-game.js');
if (!HOST || HOST.length < 20000 || !WORKER) throw new Error('could not read the musical console or the game Worker');

function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
function liftCallback(src, marker) {
  var i = src.indexOf(marker);
  if (i < 0) throw new Error('cannot find ' + marker);
  var s = src.indexOf('function', i), d = 0, k = src.indexOf('{', s);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(s, k);
}
/* Run lifted code with every free name answered: the ones given, or a spy that records the call. */
function runLifted(fnText, over, log) {
  function spy(path) {
    var f = function () { log.push(path); return spy(path + '()'); };
    return new Proxy(f, { get: function (t, k) {
      if (k === Symbol.toPrimitive) return function () { return ''; };
      if (typeof k === 'symbol') return undefined;
      return spy(path + '.' + String(k));
    }, set: function () { return true; } });
  }
  var scope = new Proxy({}, {
    has: function (t, k) { if (typeof k === 'symbol') return false; if (k in over) return true; return !(k in globalThis); },
    get: function (t, k) { if (k === Symbol.unscopables) return undefined; return (k in over) ? over[k] : spy(String(k)); },
    set: function (t, k, v) { over[k] = v; return true; }
  });
  return (new Function('__scope', 'with(__scope){ return (' + fnText + '); }'))(scope);
}

/* ---------------- the page's markup as a tree ---------------- */
var body = HOST.slice(HOST.indexOf('<body'));
body = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
var VOID = { input: 1, br: 1, img: 1, meta: 1, link: 1, hr: 1, source: 1 };
var root = { tag: 'root', attrs: '', kids: [], parent: null }, cur = root, byId = {};
body.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, function (m, close, tag, attrs) {
  tag = tag.toLowerCase();
  if (close) { var c = cur; while (c && c.tag !== tag) c = c.parent; if (c && c.parent) cur = c.parent; return m; }
  var n = { tag: tag, attrs: attrs, kids: [], parent: cur };
  cur.kids.push(n);
  var id = /\bid="([^"]+)"/.exec(attrs); if (id) byId[id[1]] = n;
  if (!VOID[tag] && !/\/$/.test(attrs)) cur = n;
  return m;
});
function cls(n) { var m = /\bclass="([^"]*)"/.exec(n.attrs); return m ? ' ' + m[1] + ' ' : ''; }
function up(n, c) { while (n && cls(n).indexOf(' ' + c + ' ') < 0) n = n.parent; return n; }

section('a. Auto play is gone');
ok('no Auto play switch in setup or in the live panel', !byId.autoChk && !byId.autoChkLive);
var endedLog = [], intervals = 0, played = 0;
var G = { status: 'running', revealMode: 'end', claims: [], won: false, nowSong: { previewUrl: 'x.m4a' }, revealed: false };
var ended = runLifted(liftCallback(HOST, 'audio.addEventListener("ended",'), {
  G: G, $: function () { return { style: {}, classList: { contains: function () { return true; } } }; },
  setPlayPause: function () {}, syncRevealBtn: function () {},
  setInterval: function () { intervals++; return 1; }, setTimeout: function () { intervals++; return 1; },
  playNext: function () { played++; }, peekNextInQueue: function () { return { title: 'B' }; }
}, endedLog);
ended();
ok('a clip ending starts no countdown and plays nothing', intervals === 0 && played === 0 && !endedLog.some(function (l) { return /auto|playNext/i.test(l); }), endedLog.join(' '));
ok('a clip ending still reveals the song when the TV reveals on the clip end', G.revealed === true);
var gone = ['maybeAutoNext', 'cancelAuto', 'setAutoPlay', 'syncAutoUI'].filter(function (f) { try { lift(HOST, f); return true; } catch (e) { return false; } });
ok('none of the auto play functions is left to call', gone.length === 0, gone.join(','));
ok('the musical game state has no autoPlay', !/\bautoPlay\s*:/.test(lift(HOST, 'beginRound') + HOST.slice(HOST.indexOf('var G={'), HOST.indexOf('var G={') + 4000)));

section('b. Reveal sits beside the winning pattern');
var pRow = byId.patternSel && up(byId.patternSel, 'fieldrow'), rRow = byId.revealSel && up(byId.revealSel, 'fieldrow');
ok('"Winning pattern" and "Reveal the song on the TV" are in the same row', !!pRow && pRow === rRow);
ok('each is its own field in that row, nothing else in it', pRow && pRow.kids.length === 2 && pRow.kids.every(function (k) { return cls(k).indexOf(' field ') >= 0; }),
   pRow && pRow.kids.map(function (k) { return k.tag + cls(k); }).join('|'));
var css = HOST.slice(HOST.indexOf('<style'), HOST.indexOf('</style>'));
ok('two equal columns at desktop', /\.fieldrow\{[^}]*display:grid;[^}]*grid-template-columns:1fr 1fr/.test(css));
ok('one column at phone width', /@media \(max-width:640px\)\{\s*\.fieldrow\{grid-template-columns:1fr\}/.test(css));
ok('the live panel keeps its own reveal control', !!byId.revealSelLive && !up(byId.revealSelLive, 'fieldrow'));

section('c. No Players box in setup');
ok('the setup panel has no setupPlayers box', !byId.setupPlayers);
ok('the live Playing count and the Players list are still there', !!byId.livePlayers && !!byId.playerCount);
var counts = [];
function El2(id) { this.id = id; this.style = {}; this.innerHTML = ''; var me = this; Object.defineProperty(this, 'textContent', { set: function (v) { counts.push(me.id + '=' + v); }, get: function () { return ''; } }); }
var rj = runLifted(lift(HOST, 'renderJoinCounts'), { $: function (id) { return byId[id] ? new El2(id) : null; }, playerCount: function () { return 7; }, playerCap: function () { return 0; },
  G: { status: 'lobby' }, inFirstMonth: function () { return false; } }, []);
rj();
ok('a join updates the live counts and reaches for no setup box', counts.indexOf('livePlayers=7') >= 0 && !counts.some(function (c) { return /setupPlayers/.test(c); }), counts.join(','));

section('d. The setup is saved for the venue (the round trip itself: tools/test-game-setup-advanced.js, all five games)');
// The console really starts this when it signs in.
var bootLog = [], started = 0;
var ready = runLifted(liftCallback(HOST, 'VP.ready().then('), {
  VP: { holdGate: function () { return false; }, enforceShift: function () {}, setGameActive: function () {} },
  libReady: Promise.resolve(), startVenuePrefs: function () { started++; return Promise.resolve(); },
  window: {}, $: function () { return { textContent: '', value: '' }; }, G: { claims: [] }, tv: ''
}, bootLog);
ready({ authed: true, currentVenueId: 'venue-1', role: 'host', venue: { id: 'venue-1', slug: 'test-alpha', status: 'active' } });
drainMicrotasks();
ok('signing in reads this venue\'s saved setup into the console', started === 1, bootLog.slice(0, 6).join(' '));

print('');
print(ran - bad + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' failed');
