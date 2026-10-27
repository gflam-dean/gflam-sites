/* THE MUSICAL BINGO SETUP, AS DEAN ASKED FOR IT ON 28 OCT 2026.

   a. Auto play is gone: "the host isn't gonna be like oh I've only got eight seconds to talk; get rid
      of it." A clip ending starts no countdown and plays nothing.
   b. "Reveal the song on the TV" sits on the same row as "Winning pattern", two columns at desktop,
      one at phone width.
   c. No "Players 0" box in setup: before the lobby opens it could only ever say 0.
   d. The setup (theme, well-known songs only, pattern, prize, reveal) is saved for the VENUE: the
      console sends it with the game start, the game Worker turns it into the vp_venue_settings row
      through the game Worker's /host/game-prefs into vp_venue_settings.game_prefs (migration 121),
      and a fresh console on another tablet opens on it.

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

section('d. The setup is saved for the venue and comes back on another tablet');
/* The real Worker route, lifted, behind a fake database whose merge does what vp_set_game_prefs does
   (migration 121): one game's keys merged into that game's object, the other games left alone. */
var wStart = WORKER.indexOf('const GAME_PREFS_MAX_CHARS');
var wEnd = WORKER.indexOf('async function handleGamePrefs(');
if (wStart < 0 || wEnd < 0) throw new Error('cannot find the game-prefs route in the Worker');
var routeSrc = WORKER.slice(wStart, wEnd) + 'async ' + lift(WORKER.slice(wEnd), 'handleGamePrefs');
var DB, staffAsked, rpcCalls, routeUp;
function resetServer(prefs) { DB = { 'venue-1': { game_prefs: prefs || {} } }; staffAsked = []; rpcCalls = []; routeUp = true; }
// jsc has no URL; the Worker reads only .searchParams, as Object.fromEntries does in a Worker.
function FakeURL(u) { var q = String(u).split('?')[1] || '', pairs = [];
  q.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); pairs.push([decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))]); });
  this.searchParams = pairs; }
var handle = (new Function('verifyHostJwt', 'requireStaff', 'readJson', 'sbGet', 'sbRpc', 'enc', 'URL',
  routeSrc + '\nreturn handleGamePrefs;'))(
  function () { return Promise.resolve('user-1'); },
  function (env, uid, venueId, aud) { staffAsked.push(venueId + ':' + aud); return Promise.resolve({ role: 'host' }); },
  function (req) { return Promise.resolve(req._body); },
  function (env, table, q) { var m = /venue_id=eq\.([^&]+)/.exec(q); var r = DB[decodeURIComponent(m[1])]; return Promise.resolve(r ? [r] : []); },
  function (env, fn, a) {
    rpcCalls.push(a);
    var row = DB[a.p_venue_id] = DB[a.p_venue_id] || { game_prefs: {} };
    var cur = row.game_prefs[a.p_game] || {}; for (var k in a.p_prefs) cur[k] = a.p_prefs[k];
    row.game_prefs[a.p_game] = cur; return Promise.resolve(row.game_prefs);
  },
  encodeURIComponent, FakeURL);
function jsonResp(body, status) { return { ok: (status || 200) < 300, status: status || 200, json: function () { return Promise.resolve(body); } }; }
function callRoute(method, url, body) {
  // A Worker without the route answers outside it, which a browser sees as a failed fetch.
  if (!routeUp) return Promise.reject(new TypeError('Failed to fetch'));
  var req = { method: method, url: url, _body: body };
  return handle(req, {}, jsonResp).catch(function (e) { return jsonResp({ error: String(e && e.message) }, (e && e.status) || 500); });
}
function Sel(v, opts) { this.value = v; this.opts = opts || []; this.checked = false; this.style = {}; this.on = {}; }
Sel.prototype.querySelector = function (q) { var m = /value="([^"]+)"/.exec(q); return m && this.opts.indexOf(m[1]) >= 0 ? {} : null; };
Sel.prototype.addEventListener = function (ev, f) { this.on[ev] = f; };
var posts;
function tablet(state) {
  var els = {
    patternSel: new Sel(state.pattern || 'one', ['one', 'two', 'corners', 'full']),
    prizeInput: new Sel(state.prize || ''), hitsChk: new Sel(''), playlistSel: new Sel('p1'),
    revealSel: new Sel(state.reveal || 'end'), revealSelLive: new Sel(state.reveal || 'end'), revealBtn: null
  };
  els.hitsChk.checked = state.hitsOnly !== false;
  var store = state.store || {}, timers = [];
  var g = { status: 'setup', venueId: 'venue-1', playlistId: 'p1', hitsOnly: els.hitsChk.checked, revealMode: state.reveal || 'end' };
  var over = {
    G: g, $: function (id) { return els[id] || null; }, VP_GAME_API: 'https://w',
    PREFS_GAME: 'musical', _prefsReady: false, _prefsApplying: false, _prefsTimer: null,
    PL_OPTS: [{ id: 'p1', name: 'Pub Classics' }, { id: '80s', name: '80s Party' }, { id: 'all', name: 'All songs' }],
    playlistNameOf: function (id) { var o = over.PL_OPTS.filter(function (x) { return x.id === id; })[0]; return o ? o.name : ''; },
    document: { querySelectorAll: function () { return []; } },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    syncRevealBtn: function () {}, REVEAL_MODES: { instant: 1, '15': 1, end: 1, never: 1 },
    getToken: function () { return Promise.resolve('tok'); },
    setTimeout: function (f) { timers.push(f); return timers.length; }, clearTimeout: function (n) { timers[n - 1] = null; },
    fetch: function (url, o) {
      var m = (o && o.method) || 'GET', b = o && o.body ? JSON.parse(o.body) : undefined;
      if (m === 'POST') posts.push(b);
      return callRoute(m, url, b);
    }
  };
  ['selectPlaylist', 'syncRevealUI', 'setRevealMode', 'musicalPrefs', 'applyMusicalPrefs', 'prefsUrl', 'loadVenuePrefs',
   'saveVenuePrefsNow', 'queuePrefsSave', 'hadLocalPrefs', 'startVenuePrefs'].forEach(function (f) { over[f] = runLifted(lift(HOST, f), over, []); });
  return { G: g, els: els, f: over, store: store, flush: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (x) { if (x) x(); }); drainMicrotasks(); } };
}
// Tablet one, at a venue that has saved nothing and a browser that remembers nothing.
resetServer({ bingo: { caller: true } }); posts = [];
var A = tablet({});
A.f.selectPlaylist('p1'); A.flush();
ok('the page\'s own defaults are never saved before the venue\'s setup has been read', posts.length === 0);
A.f.startVenuePrefs(); drainMicrotasks();
ok('nothing saved and nothing remembered: nothing is sent', posts.length === 0 && A.f._prefsReady === true, JSON.stringify(posts));
// The host sets up: 80s, every song, four corners, a $50 tab, reveal after 15 seconds.
A.f.selectPlaylist('80s'); A.G.hitsOnly = false; A.els.hitsChk.checked = false; A.els.patternSel.value = 'corners';
A.els.prizeInput.value = '$50 bar tab'; A.f.setRevealMode('15'); A.flush();
var saved = DB['venue-1'].game_prefs.musical || {};
ok('a change is saved for the venue a moment later, once, not once per tap', posts.length === 1, posts.length);
var askedA = staffAsked.slice();
var T = tablet({}); resetServer({}); posts = [];
T.f.startVenuePrefs(); drainMicrotasks(); T.f.selectPlaylist('80s'); T.flush();
ok('picking a theme on its own is saved for the venue', posts.length === 1 && DB['venue-1'].game_prefs.musical && DB['venue-1'].game_prefs.musical.playlist === '80s', JSON.stringify(posts));
resetServer({ bingo: { caller: true }, musical: saved });
ok('the venue now holds the whole setup', saved.playlist === '80s' && saved.playlist_name === '80s Party' && saved.hits_only === false &&
   saved.pattern === 'corners' && saved.prize === '$50 bar tab' && saved.reveal === '15', JSON.stringify(saved));
ok('any staff login can save: the route asks only that it is staff at this venue', askedA.length >= 1 && askedA.every(function (x) { return x === 'venue-1:host'; }), askedA.join(','));
ok('saving musical leaves the venue\'s other games alone', DB['venue-1'].game_prefs.bingo && DB['venue-1'].game_prefs.bingo.caller === true);
// Tablet two: this browser remembered hits-only and "when the clip ends"; the venue's choices win.
posts = [];
var B = tablet({ store: { vpMusicHitsOnly: '1', vpMusicReveal: 'end' } });
B.f.startVenuePrefs(); drainMicrotasks(); B.flush();
ok('a second tablet opens on the venue\'s theme, songs, pattern, prize and reveal',
   B.G.playlistId === '80s' && B.els.hitsChk.checked === false && B.G.hitsOnly === false && B.els.patternSel.value === 'corners' &&
   B.els.prizeInput.value === '$50 bar tab' && B.G.revealMode === '15' && B.els.revealSel.value === '15',
   JSON.stringify({ pl: B.G.playlistId, hits: B.els.hitsChk.checked, pat: B.els.patternSel.value, prize: B.els.prizeInput.value, rev: B.G.revealMode }));
ok('and opening it does not send it straight back', posts.length === 0, posts.length);
// A venue with nothing saved yet, on a browser that remembers: sent up once, so nobody loses it.
resetServer({}); posts = [];
var C = tablet({ reveal: 'never', hitsOnly: false, store: { vpMusicHitsOnly: '0', vpMusicReveal: 'never' } });
C.f.startVenuePrefs(); drainMicrotasks();
ok('this browser\'s remembered choices go up to the venue once', posts.length === 1 && DB['venue-1'].game_prefs.musical.reveal === 'never' && DB['venue-1'].game_prefs.musical.hits_only === false,
   JSON.stringify(DB['venue-1'].game_prefs));
// The route is not there yet (the Worker or migration 121 not live): the page keeps working on this browser.
resetServer({}); routeUp = false; posts = [];
var D = tablet({ reveal: 'never', store: { vpMusicReveal: 'never' } });
var threw = null; try { D.f.startVenuePrefs(); drainMicrotasks(); D.f.setRevealMode('instant'); D.flush(); } catch (e) { threw = e; }
ok('no route yet: nothing breaks and this browser\'s choices stay', !threw && D.G.revealMode === 'instant' && D.store.vpMusicReveal === 'instant' && D.f._prefsReady === true, threw);
var E = tablet({ prize: 'Meat tray' }); resetServer({ musical: { prize: '$50 bar tab' } });
E.f.startVenuePrefs(); drainMicrotasks();
ok('a prize the host has already typed is not overwritten', E.els.prizeInput.value === 'Meat tray');
var F = tablet({}); F.G.status = 'running'; resetServer({ musical: { playlist: '80s' } });
F.f.startVenuePrefs(); drainMicrotasks();
ok('a game already running is never re-set from the saved setup', F.G.playlistId === 'p1');

/* The route itself. */
resetServer({});
var got = [];
function post(body) { var r = null; callRoute('POST', 'https://w/host/game-prefs', body).then(function (x) { return x.json().then(function (j) { r = { status: x.status, j: j }; }); }); drainMicrotasks(); return r; }
var r1 = post({ venue_id: 'venue-1', game: 'musical', prefs: { pattern: 'corners', paid: true, tickets_unsold: 40, permits: { qld: 'X1' }, reveal: 'soon', playlist: 'a b<c>' } });
var m1 = DB['venue-1'].game_prefs.musical || {};
ok('the route keeps only the keys it allows, each one checked', r1 && r1.status === 200 && m1.pattern === 'corners' && !('reveal' in m1) && !('playlist' in m1), JSON.stringify(m1));
ok('never paid-or-free, unsold tickets or permits', !('paid' in m1) && !('tickets_unsold' in m1) && !('permits' in m1));
var rp = post({ venue_id: 'venue-1', game: 'musical', prefs: { pattern: 'diagonal', prize: 'Tab' } });
ok('a pattern that does not exist is not stored', rp && rp.status === 200 && DB['venue-1'].game_prefs.musical.pattern === 'corners' && DB['venue-1'].game_prefs.musical.prize === 'Tab', JSON.stringify(DB['venue-1'].game_prefs.musical));
var r2 = post({ venue_id: 'venue-1', game: 'musical', prefs: { prize: new Array(3000).join('x') } });
ok('more than it should ever hold is refused', r2 && r2.status === 413, r2 && r2.status);
var r3 = post({ venue_id: 'venue-1', game: 'payroll', prefs: { pattern: 'one' } });
ok('a game it does not know is refused', r3 && r3.status === 400, r3 && r3.status);
var r4 = post({ venue_id: 'venue-1', game: 'musical', prefs: { paid: true } });
ok('nothing allowed in it: nothing written', r4 && r4.status === 400 && rpcCalls.length === 2, r4 && r4.status);
var g1 = null; callRoute('GET', 'https://w/host/game-prefs?venue_id=venue-1&game=musical').then(function (x) { return x.json().then(function (j) { g1 = j; }); }); drainMicrotasks();
var g2 = null; callRoute('GET', 'https://w/host/game-prefs?venue_id=venue-1&game=payroll').then(function (x) { g2 = x.status; }); drainMicrotasks();
ok('GET for a game it does not know is refused', g2 === 400, g2);
ok('GET answers this venue\'s musical setup', g1 && g1.prefs && g1.prefs.pattern === 'corners', JSON.stringify(g1));

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
