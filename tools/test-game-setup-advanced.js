/* BASIC SETUP + ONE "ADVANCED SETTINGS", EVERYTHING SAVED TO THE VENUE (Dean, 28 Oct 2026: "We need to make
   all the games easier. Maybe we have an advanced settings tab for each game? But all of those settings that
   they change should be saved to the venue." Approved the same day: "Go for it").

   For all five consoles (bingo /app/index.html, trivia, musical bingo, raffle, members draw) this RUNS:
     1. the page's own markup, parsed into a tree: the Basic controls sit outside the one disclosure, the
        Advanced ones inside it, the removed ones are gone, and nothing the law needs before a paid game
        (bingo paid entry, the raffle free-entry note, Draw with its state rules screen) is ever inside it;
     2. the shared disclosure itself (VP.advanced in /app/vp-session.js): closed by default, remembered per
        browser and per game, and each console really hands its own disclosure to it;
     3. every setting's round trip: the console's own collect and apply functions, the shared VP.gamePrefs,
        and the REAL game Worker route /host/game-prefs (tools/rig-game-worker.js) with the REAL requireStaff,
        a Host-role login doing the saving, a fake database whose merge does what vp_set_game_prefs does;
     4. the fallbacks: the route not deployed (a failed fetch), a 404, the column not added yet (migration
        121 not run), the older saved columns (trivia_*, raffle_template) read while game_prefs is empty,
        this browser's old musical choices sent up once;
     5. the Worker's allow-list for each game, and the host's words on /session at a switched-off venue.

   Run: jsc tools/test-game-setup-advanced.js */
var RAN = 0, BAD = 0;   // not ran/bad: tools/rig-game-worker.js declares those and would reset them half way
function ok(n, c, saw) { RAN++; if (c) print('  ok   ' + n); else { BAD++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + (typeof saw === 'string' ? saw : JSON.stringify(saw)) : '')); } }
function section(t) { print(''); print(t); }

var PAGES = {
  bingo:   readFile('venueplay/app/index.html'),
  trivia:  readFile('venueplay/app/trivia/host.html'),
  musical: readFile('venueplay/app/musical/host.html'),
  raffle:  readFile('venueplay/app/raffle/host.html'),
  members: readFile('venueplay/app/members/host.html')
};
var SESSION = readFile('venueplay/app/vp-session.js');
for (var _k in PAGES) if (!PAGES[_k] || PAGES[_k].length < 20000) throw new Error('could not read the ' + _k + ' console');

function liftFrom(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
/* Run lifted code with every free name answered: the ones given, or a spy that does nothing. */
function runLifted(fnText, over) {
  function spy() { var f = function () { return spy(); }; return new Proxy(f, { get: function (t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (typeof k === 'symbol') return undefined; return spy(); }, set: function () { return true; } }); }
  var scope = new Proxy({}, {
    has: function (t, k) { if (typeof k === 'symbol') return false; if (k in over) return true; return !(k in globalThis); },
    get: function (t, k) { if (k === Symbol.unscopables) return undefined; return (k in over) ? over[k] : spy(); },
    set: function (t, k, v) { over[k] = v; return true; }
  });
  return (new Function('__scope', 'with(__scope){ return (' + fnText + '); }'))(scope);
}
// The expression a page's  var NAME=(...) ? VP.gamePrefs(...) : null;  builds, as written in the page.
function prefsExpr(src, name) {
  var m = new RegExp('var ' + name + '=(\\(window\\.VP && VP\\.gamePrefs\\) \\? VP\\.gamePrefs\\([\\s\\S]*?\\) : null);').exec(src);
  if (!m) throw new Error('cannot find ' + name + ' in the page');
  return m[1];
}
function lineWith(src, marker) {
  var i = src.indexOf(marker); if (i < 0) throw new Error('cannot find ' + marker);
  return src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i));
}

/* ======================= 1. the markup ======================= */
function tree(html) {
  var body = html.slice(html.indexOf('<body'));
  body = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  var VOID = { input: 1, br: 1, img: 1, meta: 1, link: 1, hr: 1, source: 1, path: 1, rect: 1 };
  var root = { tag: 'root', attrs: '', kids: [], parent: null }, cur = root, byId = {}, all = [];
  body.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, function (m, close, tag, attrs) {
    tag = tag.toLowerCase();
    if (close) { var c = cur; while (c && c.tag !== tag) c = c.parent; if (c && c.parent) cur = c.parent; return m; }
    var n = { tag: tag, attrs: attrs, kids: [], parent: cur };
    cur.kids.push(n); all.push(n);
    var id = /\bid="([^"]+)"/.exec(attrs); if (id) byId[id[1]] = n;
    if (!VOID[tag] && !/\/$/.test(attrs)) cur = n;
    return m;
  });
  return { byId: byId, all: all };
}
function cls(n) { var m = /\bclass="([^"]*)"/.exec(n.attrs); return m ? ' ' + m[1] + ' ' : ''; }
function inAdv(n) { for (var p = n && n.parent; p; p = p.parent) if (p.tag === 'details' && cls(p).indexOf(' vp-adv ') >= 0) return true; return false; }

var SPEC = {
  bingo: { adv: 'bingoAdv', basic: ['callerChk', 'patternSel', 'prizeInput', 'startBtn'], advanced: ['cardsSel', 'allowEarlyChk', 'patEditBtn'],
           removed: ['setupPlayers', 'setupCode', 'setupStats'], law: ['paidSel', 'paidNote', 'ticketsField'] },
  trivia: { adv: 'triviaAdv', basic: ['setSel', 'cfgCount', 'setupQs', 'paperPrintBtn', 'paperRound', 'startBtn'],
            advanced: ['cfgTime', 'cfgBase', 'cfgSpeed', 'cfgDouble', 'cfgDoubleLast', 'scBase', 'scMax'],
            removed: ['setupPlayers', 'setupCode'], law: [] },
  musical: { adv: 'musicalAdv', basic: ['plSearch', 'plGrid', 'patternSel', 'revealSel', 'prizeInput', 'paperPrintBtn', 'startBtn'],
             advanced: ['hitsChk'], removed: ['setupCode', 'setupPlayers', 'autoChk'], law: ['paidField', 'paidSel'] },
  raffle: { adv: 'raffleAdv', basic: ['prizePresets', 'rfPrize', 'addPrizeBtn', 'prizeList', 'rfStart', 'rfEnd', 'rfSkip', 'rangeLine'],
            advanced: ['rfTime', 'rfJackOn', 'rfJackAmt', 'rfJackWarn', 'rfAllowRedraw', 'drawLenWrap'], removed: [], law: ['drawBtn', 'freeEntryNote'] },
  members: { adv: 'membersAdv', basic: ['drawSel', 'drawBtn', 'runJackpot', 'runCap', 'memberList'],
             advanced: ['setName', 'setSince', 'setStart', 'setInc', 'setCur', 'setClaim', 'setDay', 'setTime', 'setMax', 'setMaxHint', 'capWarn', 'saveSettingsBtn'],
             removed: ['nameSeg', 'nameLock'], law: [] }
};
var T = {};
Object.keys(SPEC).forEach(function (g) {
  var s = SPEC[g], t = T[g] = tree(PAGES[g]);
  section('1. ' + g + ': Basic on the setup, Advanced behind one disclosure');
  var dets = t.all.filter(function (n) { return n.tag === 'details' && cls(n).indexOf(' vp-adv ') >= 0; });
  ok(g + ': exactly one "Advanced settings" disclosure, the shared one', dets.length === 1 && /\bid="([^"]+)"/.exec(dets[0].attrs)[1] === s.adv, dets.length);
  ok(g + ': it is closed in the markup (no open attribute)', dets.length === 1 && !/\bopen\b/.test(dets[0].attrs), dets[0] && dets[0].attrs);
  var sumIdx = PAGES[g].indexOf('id="' + s.adv + '"');
  ok(g + ': its summary says "Advanced settings"', /<summary><span>Advanced settings<small class="vp-adv-sub">/.test(PAGES[g].slice(sumIdx, sumIdx + 300)));
  var missing = s.basic.filter(function (id) { return !t.byId[id]; }), inside = s.basic.filter(function (id) { return t.byId[id] && inAdv(t.byId[id]); });
  ok(g + ': every Basic control is on the setup, outside the disclosure', !missing.length && !inside.length, { missing: missing, inside: inside });
  var notIn = s.advanced.filter(function (id) { return !t.byId[id] || !inAdv(t.byId[id]); });
  ok(g + ': every Advanced control is inside it', !notIn.length, notIn);
  var still = s.removed.filter(function (id) { return t.byId[id]; });
  ok(g + ': the removed controls are gone', !still.length, still);
  if (s.law.length) {
    var hidden = s.law.filter(function (id) { return !t.byId[id] || inAdv(t.byId[id]); });
    ok(g + ': what the law needs before a paid game is never inside it', !hidden.length, hidden);
  }
  // Every other script call on a removed id would throw at run time.
  var calls = s.removed.filter(function (id) { return new RegExp('\\$\\("' + id + '"\\)\\.').test(PAGES[g]); });
  ok(g + ': nothing in the page still writes to a removed control', !calls.length, calls);
  if (t.byId.downloadRecordBtn) ok(g + ': Download draw record is a footer link under the setup, outside both groups',
    cls(t.byId.downloadRecordBtn).indexOf(' vp-foot-link ') >= 0 && !inAdv(t.byId.downloadRecordBtn), cls(t.byId.downloadRecordBtn));
});
section('1b. the faults the audit found in the words');
var musPaid = PAGES.musical.slice(PAGES.musical.indexOf('id="paidField"'), PAGES.musical.indexOf('id="paperField"'));
ok('musical bingo: the Tonight note never calls it bingo or speaks of bingo rules (musical bingo is not bingo)', !/bingo/i.test(musPaid.replace(/<[^>]+>/g, ' ')) && /your venue runs the game/.test(musPaid), musPaid.replace(/\s+/g, ' ').slice(0, 300));
ok('raffle: no saved prize says "saves for this session" (it is the venue), nor "new prizes stay local"', !/saves for this session|stay local/.test(PAGES.raffle) && /saved for your venue/.test(liftFrom(PAGES.raffle, 'renderPresets')));
var jw = T.raffle.byId.rfJackWarn, ja = T.raffle.byId.rfJackAmt;
ok('raffle: the state jackpot warning sits beside the amount (same field)', jw && ja && jw.parent === ja.parent);
var cw = T.members.byId.capWarn, sm = T.members.byId.setMax;
ok('members: the maximum jackpot warning sits beside the maximum (same field)', cw && sm && cw.parent === sm.parent);
ok('trivia: Punters Reckon round type stays out of the host\'s setup (hidden, and not in Advanced)', T.trivia.byId.prField && /class="field hidden"/.test(T.trivia.byId.prField.attrs) && !inAdv(T.trivia.byId.prField));

/* ======================= 2. the shared disclosure ======================= */
section('2. VP.advanced: one component, closed by default, remembered per browser and per game');
function Store() { var d = {}; return { d: d, getItem: function (k) { return k in d ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; } }; }
function Node(tag) { this.tagName = tag; this.kids = []; this.on = {}; this.open = false; this.id = ''; this.textContent = ''; }
Node.prototype.appendChild = function (k) { this.kids.push(k); return k; };
Node.prototype.addEventListener = function (e, f) { (this.on[e] = this.on[e] || []).push(f); };
Node.prototype.fire = function (e) { (this.on[e] || []).forEach(function (f) { f({}); }); };
var TIMERS = [];
function fakeSetTimeout(f) { TIMERS.push(f); return TIMERS.length; }
function fakeClearTimeout(n) { if (n) TIMERS[n - 1] = null; }
function flush() { drainMicrotasks(); for (var r = 0; r < 5; r++) { var t = TIMERS.slice(); TIMERS.length = 0; t.forEach(function (f) { if (f) f(); }); drainMicrotasks(); } }
var CONSOLE_FETCH = function () { return Promise.reject(new Error('no fetch')); };
function loadSession(store) {
  var head = new Node('head'), body = new Node('body'), byId = {};
  var doc = { head: head, body: body, createElement: function (t) { return new Node(t); },
    getElementById: function (id) { var all = head.kids.concat(body.kids); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} };
  var win = { location: { pathname: '/app/', search: '', href: 'https://venueplay.com.au/app/' }, addEventListener: function () {} };
  (new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'setTimeout', 'clearTimeout', 'fetch', SESSION))(
    win, doc, store, Store(), win.location, fakeSetTimeout, fakeClearTimeout, function (u, o) { return CONSOLE_FETCH(u, o); });
  return { VP: win.VP, doc: doc, head: head };
}
var S1 = loadSession(Store());
ok('the disclosure\'s look is put in the page head once, as the page loads', S1.head.kids.filter(function (k) { return k.id === 'vpAdvCss'; }).length === 1);
var css = (S1.head.kids.filter(function (k) { return k.id === 'vpAdvCss'; })[0] || {}).textContent || '';
ok('a tap target at least 44px tall, its own chevron, a pink focus ring', /\.vp-adv>summary\{[^}]*min-height:44px/.test(css) && /::-webkit-details-marker\{display:none\}/.test(css) && /\.vp-adv>summary:focus-visible\{outline:2px solid var\(--pink/.test(css));
ok('nothing in it fixes a width, so it fits a phone', !/(?:^|[;{])\s*(?:min-)?width:\s*\d{3,}px/.test(css), css.match(/width:[^;}]+/g));
var store = Store(), S2 = loadSession(store), d1 = new Node('details');
S2.VP.advanced(d1, 'bingo');
ok('closed by default on a browser that has never opened it', d1.open === false);
d1.open = true; d1.fire('toggle');
ok('opening it is remembered for this game on this browser only (localStorage)', store.d['vpAdvOpen:bingo'] === '1', store.d);
var d2 = new Node('details'); S2.VP.advanced(d2, 'bingo');
var d3 = new Node('details'); S2.VP.advanced(d3, 'raffle');
ok('next time the bingo one opens as it was left, the raffle one stays closed', d2.open === true && d3.open === false);
d2.open = false; d2.fire('toggle');
var d4 = new Node('details'); S2.VP.advanced(d4, 'bingo');
ok('and closing it is remembered too', d4.open === false && store.d['vpAdvOpen:bingo'] === '0');
var broken = { getItem: function () { throw new Error('blocked'); }, setItem: function () { throw new Error('blocked'); } };
var S3 = loadSession(broken), d5 = new Node('details'), th = null;
try { S3.VP.advanced(d5, 'trivia'); d5.open = true; d5.fire('toggle'); } catch (e) { th = e; }
ok('a browser that blocks storage still gets a working, closed disclosure', !th && d5.open === true, th && th.message);
Object.keys(SPEC).forEach(function (g) {
  var line = lineWith(PAGES[g], 'VP.advanced($("' + SPEC[g].adv + '")'), got = [];
  runLifted('(function(){ ' + line + '\n})', { window: { VP: { advanced: function (el, game) { got.push([el, game]); } } },
    VP: { advanced: function (el, game) { got.push([el, game]); } }, $: function (id) { return id; } })();
  ok(g + ': the console hands its own disclosure to the shared component, under its own game', got.length === 1 && got[0][0] === SPEC[g].adv && got[0][1] === g, got);
});

/* ======================= 3. the Worker, for real ======================= */
load('tools/rig-game-worker.js');
var WSRC = SRC;
(0, eval)('requireStaff = async ' + liftFrom(WSRC, 'requireStaff') + ';');   // the rig stands requireStaff in; this suite runs the real one
// The Worker reads only .searchParams from a URL, as Object.fromEntries does in a Worker.
URL = function (u) { var q = String(u).split('?')[1] || '', pairs = [];
  q.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); pairs.push([decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))]); });
  pairs.get = function (k) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === k) return pairs[i][1]; return null; };
  this.searchParams = pairs; this.pathname = String(u).replace(/^https?:\/\/[^\/]+/, '').split('?')[0]; };
var NO_COLUMN = false, STAFF_ASKED = [];
var _rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (/\/rest\/v1\/rpc\/vp_set_game_prefs$/.test(u)) {
    if (NO_COLUMN) return resp(404, { message: 'Could not find the function public.vp_set_game_prefs' });
    var a = JSON.parse(opts.body); DB.vp_venue_settings = DB.vp_venue_settings || [];
    var row = DB.vp_venue_settings.filter(function (r) { return r.venue_id === a.p_venue_id; })[0];
    if (!row) { row = { venue_id: a.p_venue_id, game_prefs: {} }; DB.vp_venue_settings.push(row); }
    var cur = row.game_prefs[a.p_game] || {}; for (var k in a.p_prefs) cur[k] = a.p_prefs[k];
    row.game_prefs[a.p_game] = cur;
    return resp(200, JSON.parse(JSON.stringify(row.game_prefs)));
  }
  if (NO_COLUMN && /\/rest\/v1\/vp_venue_settings\?.*game_prefs/.test(u)) return resp(400, { code: '42703', message: 'column vp_venue_settings.game_prefs does not exist' });
  return _rigFetch(url, opts);
};
var VENUE2 = '33333333-3333-4333-8333-333333333333';
function resetDb(prefs) {
  DB.vp_venue_staff = [{ id: 'staff-h', auth_user_id: HOST, venue_id: VENUE, role: 'host', permissions: null }];
  DB.vp_venues = [{ id: VENUE, status: 'active', group_id: null }, { id: VENUE2, status: 'active', group_id: null }];
  DB.vp_platform_admins = [];
  DB.vp_venue_settings = [{ venue_id: VENUE, game_prefs: prefs || {} }];
  NO_COLUMN = false;
}
var ROUTE = 'up';   // 'up' | 'gone' (a failed fetch: the route is not deployed) | '404'
var POSTS = [], GETS = 0;
CONSOLE_FETCH = function (url, o) {
  if (ROUTE === 'gone') return Promise.reject(new TypeError('Failed to fetch'));
  if (ROUTE === '404') return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({ error: 'Not found' }); } });
  var method = (o && o.method) || 'GET';
  if (!/^https:\/\/w\/host\/game-prefs/.test(url)) return Promise.reject(new Error('unexpected ' + url));
  if (method === 'POST') { BODY = JSON.parse(o.body); POSTS.push(BODY); } else { BODY = {}; GETS++; }
  return handleGamePrefs({ method: method, url: url, headers: { get: function () { return 'Bearer tok'; } } }, ENV, json)
    .then(function (r) { return { ok: r.status < 300, status: r.status, json: function () { return Promise.resolve(r.body); } }; },
          function (e) { return { ok: false, status: e.status || 500, json: function () { return Promise.resolve({ error: String(e.message) }); } }; });
};
var SS = loadSession(Store());
function vpWith(extra) { var v = { gamePrefs: SS.VP.gamePrefs, advanced: function () {} }; for (var k in extra) v[k] = extra[k]; return v; }
function saved(g) { var r = (DB.vp_venue_settings || []).filter(function (x) { return x.venue_id === VENUE; })[0]; return r && r.game_prefs ? r.game_prefs[g] : undefined; }

/* A fake element, enough for a value, a tick, a class and a list of options. */
function E(v, opts) { var _v = v == null ? '' : String(v); Object.defineProperty(this, 'value', { get: function () { return _v; }, set: function (x) { _v = x == null ? '' : String(x); }, configurable: true }); this.checked = false; this.disabled = false; this.style = {}; this.textContent = ''; this.opts = opts || null; this._c = {};
  var me = this; this.classList = { add: function (c) { me._c[c] = 1; }, remove: function (c) { delete me._c[c]; }, contains: function (c) { return !!me._c[c]; },
    toggle: function (c, on) { if (on === undefined) on = !me._c[c]; if (on) me._c[c] = 1; else delete me._c[c]; } };
  this.children = []; this.innerHTML = ''; }
E.prototype.querySelector = function (q) { var m = /value="([^"]+)"/.exec(q); return (m && this.opts && this.opts.indexOf(m[1]) >= 0) ? {} : null; };
E.prototype.addEventListener = function () {};
E.prototype.appendChild = function (k) { this.children.push(k); return k; };
E.prototype.getAttribute = function () { return null; };
function Sel(opts, v) { E.call(this, v == null ? opts[0] : v, opts); var me = this, val = this.value;
  Object.defineProperty(this, 'value', { get: function () { return val; }, set: function (x) { x = String(x); if (me.opts.indexOf(x) >= 0) val = x; } }); }
Sel.prototype = Object.create(E.prototype);

/* Build one tablet of a console: its own lifted functions over its own fake page, and the controller its
   own  var _xxxPrefs=  line builds with the shared VP.gamePrefs. */
function tablet(g, scope, fns, varName, wire) {
  scope.VP_GAME_API = 'https://w';
  scope.window = scope.window || { VP: scope.VP };
  fns.forEach(function (f) { scope[f] = runLifted(liftFrom(PAGES[g], f), scope); });
  scope[varName] = runLifted(prefsExpr(PAGES[g], varName), scope);
  (wire || []).forEach(function (f) { scope[f] = runLifted(liftFrom(PAGES[g], f), scope); });
  return scope;
}
function getToken() { return Promise.resolve('tok'); }

/* ---------------- bingo ---------------- */
var PAT = ['one', 'two', 'full', 'corners', 'top', 'middle', 'bottom', 'c:44444444-4444-4444-8444-444444444444', '__newpat'];
function bingoTablet() {
  var els = { callerChk: new E(), patternSel: new Sel(PAT), prizeInput: new E(''), cardsSel: new Sel(['1', '2', '3', '4', '5', '6']),
              allowEarlyChk: new E(), allowEarlyLive: new E(), paidSel: new Sel(['', 'card', 'sheet']) };
  var sc = { G: { status: 'setup', allowEarly: false }, $: function (id) { return els[id] || null; }, NEW_PAT: '__newpat',
    __ctx: { venue: { id: VENUE } }, vpHostToken: getToken, rememberPat: function () {}, syncPatEdit: function () {}, renderConsole: function () {},
    VP: vpWith({}) };
  tablet('bingo', sc, ['clampCards', 'bingoPrefs', 'applyBingoPrefs'], '_bingoPrefs', ['queueBingoPrefs', 'startBingoPrefs']);
  sc._bingoPrefsFor = ''; sc.els = els; return sc;
}
section('3. bingo: every setting round-trips through /host/game-prefs, as a Host login');
resetDb({ musical: { pattern: 'corners' } }); POSTS = []; ROUTE = 'up';
var b1 = bingoTablet();
b1.queueBingoPrefs(); flush();
ok('nothing is saved before the venue\'s setup has been read', POSTS.length === 0);
b1.startBingoPrefs(); flush();
ok('a venue with nothing saved and no older values: nothing sent', POSTS.length === 0, POSTS);
b1.els.callerChk.checked = true; b1.els.patternSel.value = 'c:44444444-4444-4444-8444-444444444444'; b1.els.prizeInput.value = '  Meat tray  ';
b1.els.cardsSel.value = '3'; b1.G.allowEarly = true; b1.els.paidSel.value = 'card';
b1.queueBingoPrefs(); b1.queueBingoPrefs(); b1.queueBingoPrefs(); flush();
var sb = saved('bingo') || {};
ok('three quick changes are one save, a moment later', POSTS.length === 1, POSTS.length);
ok('the venue holds real balls, the pattern (its own), the prize, tickets each player and early calls', sb.caller === true && sb.pattern === 'c:44444444-4444-4444-8444-444444444444' &&
   sb.prize === 'Meat tray' && sb.cards === 3 && sb.allow_early === true, sb);
ok('paid or free for the night is NEVER saved (it starts on Free every night)', !('paid' in sb) && !('paidMode' in sb) && !/"(card|sheet)"/.test(JSON.stringify(POSTS)), POSTS);
ok('saving bingo leaves the venue\'s other games alone', saved('musical') && saved('musical').pattern === 'corners');
var b2 = bingoTablet(); b2.startBingoPrefs(); flush();
ok('a second tablet opens on all five', b2.els.callerChk.checked === true && b2.els.patternSel.value === 'c:44444444-4444-4444-8444-444444444444' &&
   b2.els.prizeInput.value === 'Meat tray' && b2.els.cardsSel.value === '3' && b2.G.allowEarly === true && b2.els.allowEarlyChk.checked === true && b2.els.allowEarlyLive.checked === true,
   { c: b2.els.callerChk.checked, p: b2.els.patternSel.value, z: b2.els.prizeInput.value, n: b2.els.cardsSel.value, a: b2.G.allowEarly });
ok('and Tickets on it is still Free', b2.els.paidSel.value === '');
var b3 = bingoTablet(); b3.G.status = 'lobby'; b3.startBingoPrefs(); flush();
ok('a lobby brought back is never re-set from the saved setup', b3.els.callerChk.checked === false && b3.els.prizeInput.value === '');
var b4 = bingoTablet(); b4.startBingoPrefs(); flush(); var before = GETS; b4.startBingoPrefs(); flush();
ok('read once per venue, not on every visit to the bingo tile', GETS === before && b4._bingoPrefsFor === VENUE, GETS - before);
var b5 = bingoTablet(); b5.els.patternSel.opts = PAT.slice(0, 7); resetDb({ bingo: { pattern: 'c:44444444-4444-4444-8444-444444444444', prize: 'Tab' } }); b5.startBingoPrefs(); flush();
ok('a pattern of their own that has since been deleted falls back to One line', b5.els.patternSel.value === 'one' && b5.els.prizeInput.value === 'Tab', b5.els.patternSel.value);
// the page's own listeners queue the save
var wired = [], wl = lineWith(PAGES.bingo, '["callerChk","patternSel","cardsSel","allowEarlyChk","allowEarlyLive"].forEach');
runLifted('(function(){ ' + wl + '\n})', { $: function (id) { return { addEventListener: function (ev, f) { wired.push(id + ':' + ev + ':' + (f === 'Q')); } }; }, queueBingoPrefs: 'Q' })();
ok('the page saves on a change to real balls, pattern, tickets each player and both early-call ticks', wired.join() === 'callerChk:change:true,patternSel:change:true,cardsSel:change:true,allowEarlyChk:change:true,allowEarlyLive:change:true', wired);
ok('and as the prize is typed', /\$\("prizeInput"\)\.addEventListener\("input", queueBingoPrefs\);/.test(PAGES.bingo));
ok('it starts once the venue\'s own patterns are in the list', /Promise\.resolve\(loadCustomPatterns\(\)\)\.then\(startBingoPrefs, startBingoPrefs\)/.test(liftFrom(PAGES.bingo, 'selectGame')));

/* ---------------- trivia ---------------- */
var SET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function triviaTablet(oldCols, search) {
  var setSel = { options: [SET_A, SET_B].map(function (id, i) { return { value: id, getAttribute: function (k) { return { 'data-count': i ? '20' : '200', 'data-title': i ? 'Pub Night' : 'Geography', 'data-own': i ? '1' : '0' }[k]; } }; }),
    selectedIndex: 0, addEventListener: function () {} };
  Object.defineProperty(setSel, 'value', { get: function () { return setSel.options[setSel.selectedIndex].value; } });
  var els = { setSel: setSel, cfgCount: new E('10'), cfgTime: new E('30'), cfgBase: new E('100'), cfgDoubleLast: new E('10'), setLastNote: new E(), scBase: new E(), scMax: new E(),
    setupQs: new E(), cfgSpeed: { children: [] }, cfgDouble: { children: [] }, doubleNote: new E() };
  els.setLastNote.style.display = 'none';
  var sc = { G: { status: 'setup', venueId: VENUE, speedBonus: true, doublePoints: false, doubleLast: 10 }, $: function (id) { return els[id] || null; },
    getToken: getToken, renderConsole: function () {}, paintRoundQs: function () {}, renderPaperSetup: function () {},
    setFromUrl: function () { return search || ''; },
    VP: vpWith({ loadSettings: function () { return Promise.resolve(oldCols || null); } }) };
  tablet('trivia', sc, ['syncSetCount', 'paintDouble', 'triviaPrefs', 'applyTriviaPrefs', 'triviaOldPrefs'], '_triviaPrefs', ['queueTriviaPrefs', 'startTriviaPrefs']);
  sc.els = els; return sc;
}
section('3. trivia: every setting round-trips, saved when it CHANGES, not only when a quiz starts');
resetDb({}); POSTS = [];
var t1 = triviaTablet(null); t1.startTriviaPrefs(); flush();
t1.els.setSel.selectedIndex = 1; t1.els.cfgCount.value = '15'; t1.els.cfgTime.value = '20'; t1.els.cfgBase.value = '250';
t1.G.speedBonus = false; t1.G.doublePoints = true; t1.G.doubleLast = 5;
t1.queueTriviaPrefs(); flush();
var st = saved('trivia') || {};
ok('a change is saved for the venue with no quiz started', POSTS.length === 1, POSTS.length);
ok('the venue holds the set, the count, time, points, speed bonus and double points', st.set_id === SET_B && st.count === 15 && st.time_s === 20 && st.base_points === 250 &&
   st.speed_bonus === false && st.double_points === true && st.double_last === 5, st);
var t2 = triviaTablet(null); t2.startTriviaPrefs(); flush();
ok('a second tablet opens on the same set and says it is last time\'s', t2.els.setSel.selectedIndex === 1 && t2.els.setLastNote.style.display === '', t2.els.setSel.selectedIndex);
ok('with the same count, time, points, speed bonus and double points', t2.els.cfgCount.value === '15' && t2.els.cfgTime.value === '20' && t2.els.cfgBase.value === '250' &&
   t2.G.speedBonus === false && t2.G.doublePoints === true && t2.G.doubleLast === 5 && t2.els.scMax.textContent === 375,
   { n: t2.els.cfgCount.value, t: t2.els.cfgTime.value, b: t2.els.cfgBase.value, s: t2.G.speedBonus, d: t2.G.doublePoints, l: t2.G.doubleLast });
var t3 = triviaTablet(null, SET_A); t3.startTriviaPrefs(); flush();
ok('"Run it now" from the builder (?set=) keeps the night it was sent with', t3.els.setSel.selectedIndex === 0 && t3.els.setLastNote.style.display === 'none');
// older columns: a venue that has only ever saved through a quiz start
resetDb({}); POSTS = [];
var t4 = triviaTablet({ trivia_time_limit_s: 45, trivia_base_points: 200, trivia_speed_bonus: false, trivia_double_points: true, trivia_double_last: 3 });
t4.startTriviaPrefs(); flush();
ok('nothing in game_prefs yet: the venue\'s older trivia_* columns fill the setup', t4.els.cfgTime.value === '45' && t4.els.cfgBase.value === '200' && t4.G.speedBonus === false &&
   t4.G.doublePoints === true && t4.G.doubleLast === 3, { t: t4.els.cfgTime.value, b: t4.els.cfgBase.value });
ok('and they are sent up once, so the venue keeps them', POSTS.length === 1 && saved('trivia') && saved('trivia').time_s === 45 && saved('trivia').double_last === 3, saved('trivia'));
var t5 = triviaTablet({ trivia_time_limit_s: 45 }); t5.startTriviaPrefs(); flush();
ok('once game_prefs has them, the older columns are not what is read', POSTS.length === 1 && t5.els.cfgTime.value === '45');
resetDb({ trivia: { time_s: 12 } });
var t6 = triviaTablet({ trivia_time_limit_s: 45 }); t6.startTriviaPrefs(); flush();
ok('game_prefs wins over the older columns', t6.els.cfgTime.value === '12', t6.els.cfgTime.value);
var tw = [], twl = lineWith(PAGES.trivia, '["cfgCount","cfgTime","cfgBase","cfgDoubleLast"].forEach');
runLifted('(function(){ ' + twl + '\n})', { $: function (id) { return { addEventListener: function (ev, f) { tw.push(id + ':' + ev + ':' + (f === 'Q')); } }; }, queueTriviaPrefs: 'Q' })();
ok('the page saves as the count, time, points and double count are typed', tw.join() === 'cfgCount:input:true,cfgTime:input:true,cfgBase:input:true,cfgDoubleLast:input:true', tw);
ok('and on the set, the speed bonus and double points', /queueTriviaPrefs\(\); \}\);/.test(PAGES.trivia) && (PAGES.trivia.match(/queueTriviaPrefs\(\);/g) || []).length >= 3);
ok('it starts once the question sets are in the list', /Promise\.resolve\(loadQuestionSets\(\)\)\.then\(startTriviaPrefs, startTriviaPrefs\)/.test(PAGES.trivia));
ok('the boot no longer fills the setup from the older columns on its own (that would beat game_prefs)', (PAGES.trivia.match(/VP\.loadSettings\(/g) || []).length === 1);

/* ---------------- musical ---------------- */
function musicalTablet(state) {
  var els = { patternSel: new Sel(['one', 'two', 'corners', 'full'], state.pattern || 'one'), prizeInput: new E(state.prize || ''), hitsChk: new E(), playlistSel: new E('p1'),
    revealSel: new E(state.reveal || 'end'), revealSelLive: new E(state.reveal || 'end'), paidSel: new Sel(['', 'paid']) };
  els.hitsChk.checked = state.hitsOnly !== false;
  var store = Store(); for (var k in (state.store || {})) store.d[k] = state.store[k];
  var sc = { G: { status: state.status || 'setup', venueId: VENUE, playlistId: 'p1', hitsOnly: els.hitsChk.checked, revealMode: state.reveal || 'end' },
    $: function (id) { return els[id] || null; }, getToken: getToken, PREFS_GAME: 'musical',
    PL_OPTS: [{ id: 'p1', name: 'Pub Classics' }, { id: '80s', name: '80s Party' }],
    playlistNameOf: function (id) { return { p1: 'Pub Classics', '80s': '80s Party' }[id] || ''; },
    document: { querySelectorAll: function () { return []; } }, localStorage: store, syncRevealBtn: function () {}, REVEAL_MODES: { instant: 1, '15': 1, end: 1, never: 1 },
    VP: vpWith({}) };
  tablet('musical', sc, ['selectPlaylist', 'syncRevealUI', 'setRevealMode', 'musicalPrefs', 'applyMusicalPrefs', 'musicalLocalPrefs'], '_prefs', ['queuePrefsSave', 'startVenuePrefs']);
  sc.els = els; sc.store = store; return sc;
}
section('3. musical bingo: every setting round-trips (it is not bingo: no bingo rules, Tonight never saved)');
resetDb({}); POSTS = [];
var m1 = musicalTablet({}); m1.startVenuePrefs(); flush();
ok('nothing saved and nothing remembered: nothing is sent', POSTS.length === 0, POSTS);
m1.selectPlaylist('80s'); m1.G.hitsOnly = false; m1.els.patternSel.value = 'corners'; m1.els.prizeInput.value = '$50 bar tab'; m1.els.paidSel.value = 'paid';
m1.setRevealMode('15'); flush();
var sm2 = saved('musical') || {};
ok('theme, well-known songs only, pattern, prize and reveal are saved for the venue, once', POSTS.length === 1 && sm2.playlist === '80s' && sm2.playlist_name === '80s Party' &&
   sm2.hits_only === false && sm2.pattern === 'corners' && sm2.prize === '$50 bar tab' && sm2.reveal === '15', [POSTS.length, sm2]);
ok('Tonight (free or tickets sold) is never saved', !/paid/.test(JSON.stringify(POSTS)), POSTS);
var m2 = musicalTablet({ store: { vpMusicHitsOnly: '1', vpMusicReveal: 'end' } }); m2.startVenuePrefs(); flush();
ok('a second tablet opens on the venue\'s choices, over this browser\'s own', m2.G.playlistId === '80s' && m2.els.hitsChk.checked === false && m2.els.patternSel.value === 'corners' &&
   m2.els.prizeInput.value === '$50 bar tab' && m2.G.revealMode === '15', { pl: m2.G.playlistId, h: m2.els.hitsChk.checked, r: m2.G.revealMode });
ok('and opening it does not send it straight back', POSTS.length === 1, POSTS.length);
resetDb({}); POSTS = [];
var m3 = musicalTablet({ store: { vpMusicHitsOnly: '0', vpMusicReveal: 'never' } }); m3.startVenuePrefs(); flush();
ok('this browser\'s old choices go up to a venue with none, once', POSTS.length === 1 && saved('musical').reveal === 'never' && saved('musical').hits_only === false, saved('musical'));
m3.startVenuePrefs(); flush();
ok('and only once: the venue has them now', POSTS.length === 1, POSTS.length);
var m4 = musicalTablet({ prize: 'Meat tray' }); resetDb({ musical: { prize: '$50 bar tab' } }); m4.startVenuePrefs(); flush();
ok('a prize the host has already typed is not overwritten', m4.els.prizeInput.value === 'Meat tray');
var m5 = musicalTablet({ status: 'running' }); resetDb({ musical: { playlist: '80s' } }); m5.startVenuePrefs(); flush();
ok('a game already running is never re-set from the saved setup', m5.G.playlistId === 'p1');

/* ---------------- raffle ---------------- */
function raffleTablet(template, recovered) {
  var els = {}; ['rfStart', 'rfEnd', 'rfTime', 'rfJackAmt', 'rfSkip', 'drawLenLbl', 'rfJackWrap', 'prizeField', 'prizePresets'].forEach(function (id) { els[id] = new E(''); });
  els.rfStart.value = '1'; els.rfEnd.value = '150'; els.rfTime.value = '180'; els.rfJackAmt.value = '500'; els.rfJackOn = new E(); els.rfAllowRedraw = new E(); els.rfAllowRedraw.checked = true;
  els.rfJackWrap.classList.add('hidden');
  var sc = { G: { venueId: VENUE, savedPrizes: [], drawLength: 4, recovered: !!recovered }, $: function (id) { return els[id] || null; }, getToken: getToken,
    renderPresets: function () {}, renderRange: function () {}, apiPost: function () { return Promise.reject(new Error('Only an owner or manager can save prizes')); },
    VP: vpWith({ loadSettings: function () { return Promise.resolve(template ? { raffle_template: template } : null); } }) };
  tablet('raffle', sc, ['show', 'dollarsText', 'mergeSavedPrizes', 'rafflePrefs', 'applyRafflePrefs', 'raffleOldPrefs'], '_rafflePrefs', ['queueRafflePrefs', 'startRafflePrefs', 'savePrize']);
  sc.els = els; return sc;
}
section('3. raffle: every setting round-trips; a Host\'s saved prize now reaches the venue; unsold tickets never saved');
resetDb({}); POSTS = [];
var r1 = raffleTablet(null); r1.startRafflePrefs(); flush();
r1.savePrize('Meat Tray'); flush();
ok('a prize a Host-role login types is saved for the venue (prize-add refuses a Host; game_prefs does not)', saved('raffle') && JSON.stringify(saved('raffle').prizes) === '["Meat Tray"]', saved('raffle'));
r1.els.rfStart.value = '100'; r1.els.rfEnd.value = '400'; r1.els.rfTime.value = '15'; r1.els.rfJackOn.checked = true; r1.els.rfJackAmt.value = '750.50';
r1.els.rfAllowRedraw.checked = false; r1.G.drawLength = 6; r1.els.rfSkip.value = '150-200, 312';
r1.queueRafflePrefs(); flush();
var sr = saved('raffle') || {};
ok('the venue holds the range, claim time, cash jackpot to the cent, redraw and spin length', sr.range_min === 100 && sr.range_max === 400 && sr.time_to_present === 30 &&
   sr.jackpot_on === true && sr.jackpot_amount_cents === 75050 && sr.allow_redraw === false && sr.spin_seconds === 6, sr);
ok('"Tickets that did not sell" is NEVER saved', !/150-200|312|excluded|unsold|skip/.test(JSON.stringify(POSTS)), POSTS);
var r2 = raffleTablet(null); r2.startRafflePrefs(); flush();
ok('a second tablet opens on all of it, prizes included', r2.els.rfStart.value === '100' && r2.els.rfEnd.value === '400' && r2.els.rfTime.value === '30' && r2.els.rfJackOn.checked === true &&
   r2.els.rfJackAmt.value === '750.50' && r2.els.rfAllowRedraw.checked === false && r2.G.drawLength === 6 && r2.G.savedPrizes[0] === 'Meat Tray',
   { s: r2.els.rfStart.value, e: r2.els.rfEnd.value, t: r2.els.rfTime.value, j: r2.els.rfJackAmt.value, p: r2.G.savedPrizes });
ok('with its unsold box empty', r2.els.rfSkip.value === '');
ok('a cash jackpot on: the prize list folds and the amount shows', !r2.els.rfJackWrap.classList.contains('hidden') && r2.els.prizeField.classList.contains('hidden'));
var r3 = raffleTablet(null, true); r3.startRafflePrefs(); flush();
ok('a raffle brought back mid-night keeps its own range and takes only the prize buttons', r3.els.rfEnd.value === '150' && r3.G.savedPrizes[0] === 'Meat Tray');
resetDb({}); POSTS = [];
var r4 = raffleTablet({ range_min: 1, range_max: 300, time_to_present: 90, spin_seconds: 8, allow_redraw: false, jackpot_on: true, jackpot_amount_cents: 20000, excluded_ranges: [[150, 200]] });
r4.startRafflePrefs(); flush();
ok('nothing in game_prefs: the older raffle_template fills the setup', r4.els.rfEnd.value === '300' && r4.els.rfTime.value === '90' && r4.G.drawLength === 8 && r4.els.rfAllowRedraw.checked === false && r4.els.rfJackAmt.value === '200');
ok('except last raffle\'s unsold tickets, which never come back', r4.els.rfSkip.value === '' && !('excluded_ranges' in (saved('raffle') || {})), r4.els.rfSkip.value);
ok('and it is sent up once, so the venue keeps it', POSTS.length === 1 && saved('raffle').range_max === 300);
ok('the page saves on the range, time, amount, jackpot, redraw and spin, and never on the unsold box',
   /\["rfStart","rfEnd","rfTime","rfJackAmt"\]\.forEach\(function\(id\)\{ \$\(id\)\.addEventListener\("input", queueRafflePrefs\); \}\);/.test(PAGES.raffle) && !/"rfSkip"[^\n]*queueRafflePrefs/.test(PAGES.raffle));
// A cash jackpot set behind the closed disclosure is still said on the line above Draw, with its state warning.
var rl = { textContent: '', innerHTML: '', kids: [], appendChild: function (k) { this.kids.push(k); } };
var rrScope = { G: { jackOn: true, jackAmt: 750.5, min: 1, max: 150 }, $: function (id) { return id === 'rangeLine' ? rl : new E(); },
  readInputs: function () {}, renderJackWarn: function () { return 'Above the $500 your state allows without a permit.'; }, validRange: function () { return true; },
  clearHostErrorIf: function () {}, drawnCount: function () { return 0; }, skippedCount: function () { return 0; }, remainingCount: function () { return 150; },
  skipsProblem: function () { return ''; }, parseSkips: function () { return []; }, scheduleIdleBroadcast: function () {},
  document: { createElement: function () { return { className: '', textContent: '' }; } } };
rrScope.dollarsText = runLifted(liftFrom(PAGES.raffle, 'dollarsText'), rrScope);
runLifted(liftFrom(PAGES.raffle, 'renderRange'), rrScope)();
ok('a cash jackpot is said above Draw, folded or not, with the state warning beside it', /^Cash jackpot \$750\.50 \u00b7 150 tickets/.test(rl.textContent) &&
   rl.kids.length === 1 && /your state allows/.test(rl.kids[0].textContent), [rl.textContent, rl.kids]);
rrScope.G.jackOn = false; rl.kids = []; runLifted(liftFrom(PAGES.raffle, 'renderRange'), rrScope)();
ok('CONTROL: no jackpot, no jackpot words', /^150 tickets/.test(rl.textContent) && !rl.kids.length, rl.textContent);
ok('a raffle brought back is known before the setup is read', /G\.recovered=!!recovered;\s*\n\s*startRafflePrefs\(\)/.test(PAGES.raffle));

/* ---------------- members ---------------- */
var D1 = 'dddddddd-0001-4ddd-8ddd-dddddddddddd', D2 = 'dddddddd-0002-4ddd-8ddd-dddddddddddd';
function membersTablet(today, draws) {
  var sc = { G: { venueId: VENUE, draws: draws || [{ id: D1, draw_day: 'Friday' }, { id: D2, draw_day: 'Saturday' }], currentDrawId: D1, round: null, busy: false },
    $: function () { return new E(); }, getToken: getToken, todayWeekday: function () { return today; },
    renderDrawSelect: function () {}, renderStats: function () {}, renderMembers: function () {}, renderSettings: function () {}, applyRoleGates: function () {}, VP: vpWith({}) };
  return tablet('members', sc, ['membersPrefs', 'applyMembersPrefs'], '_membersPrefs', ['queueMembersPrefs', 'startMembersPrefs']);
}
section('3. members draw: the draw it opens on is saved for the venue; the draw\'s own settings stay per draw');
resetDb({}); POSTS = [];
var w1 = membersTablet('Monday'); w1.startMembersPrefs(); flush();
w1.G.currentDrawId = D2; w1.queueMembersPrefs(); flush();
ok('picking a draw is saved for the venue', saved('members') && saved('members').draw_id === D2, saved('members'));
var w2 = membersTablet('Monday'); w2.startMembersPrefs(); flush();
ok('another tablet, on a day neither draw runs, opens on the venue\'s last draw', w2.G.currentDrawId === D2, w2.G.currentDrawId);
var w3 = membersTablet('Friday'); w3.startMembersPrefs(); flush();
ok('tonight\'s draw (by its draw day) still comes first', w3.G.currentDrawId === D1);
var w4 = membersTablet('Monday'); w4.G.round = { number: 7 }; w4.startMembersPrefs(); flush();
ok('a draw with a winner on screen is never switched under the host', w4.G.currentDrawId === D1);
var w5 = membersTablet('Monday', [{ id: D1, draw_day: 'Friday' }]); w5.startMembersPrefs(); flush();
ok('a saved draw that has since been removed is ignored', w5.G.currentDrawId === D1);
// the page's own change handler on Which draw
var dsrc = PAGES.members, di = dsrc.indexOf('$("drawSel").addEventListener("change", function(){'), dq = 0;
var dfn = dsrc.slice(dsrc.indexOf('function', di), (function () { var k = dsrc.indexOf('{', di), d = 0; do { if (dsrc[k] === '{') d++; else if (dsrc[k] === '}') d--; k++; } while (d > 0); return k; })());
var dsc = { G: { round: null, busy: false }, renderStats: function () {}, renderMembers: function () {}, renderSettings: function () {}, sendIdle: function () {},
  queueMembersPrefs: function () { dq++; }, hostError: function () {}, clearTimers: function () {}, hideWinnerCard: function () {}, drawBtnIdle: function () {} };
runLifted(dfn, dsc).call({ value: D2 });
ok('choosing a draw in Which draw saves it for the venue', dq === 1 && dsc.G.currentDrawId === D2, dq);
w1.G.currentDrawId = '__new'; POSTS = []; w1.queueMembersPrefs(); flush();
ok('"+ New draw" is not saved as a draw', POSTS.length === 0, POSTS);
ok('the draw settings are still saved per draw by their own route (owner or manager)', /apiPost\("\/host\/members\/settings"/.test(liftFrom(PAGES.members, 'saveSettings')));

/* ======================= 4. when the route or the column is not there ======================= */
section('4. the route not deployed, a 404, or migration 121 not run: the page carries on quietly');
[['gone', 'no route (the Worker not deployed yet)'], ['404', 'the route answers 404']].forEach(function (c) {
  resetDb({}); ROUTE = c[0]; POSTS = [];
  var mt = musicalTablet({ reveal: 'never', store: { vpMusicReveal: 'never' } }), th1 = null, res = null;
  try { mt.startVenuePrefs().then(function (r) { res = r; }); flush(); mt.setRevealMode('instant'); flush(); } catch (e) { th1 = e; }
  ok(c[1] + ': nothing breaks, this browser\'s choices stay, and it keeps working', !th1 && res === 'local' && mt.G.revealMode === 'instant' && mt.store.d.vpMusicReveal === 'instant', [th1 && th1.message, res, mt.G.revealMode]);
  var bt = bingoTablet(), th2 = null; bt.els.prizeInput.value = 'Tab';
  try { bt.startBingoPrefs(); flush(); bt.queueBingoPrefs(); flush(); } catch (e) { th2 = e; }
  ok(c[1] + ': bingo carries on with what is on the page', !th2 && bt.els.prizeInput.value === 'Tab' && bt._bingoPrefs.ready() === true);
  var tt = triviaTablet({ trivia_time_limit_s: 40 }); tt.startTriviaPrefs(); flush();
  ok(c[1] + ': trivia still reads the older columns', tt.els.cfgTime.value === '40');
});
ROUTE = 'up'; resetDb({}); NO_COLUMN = true; POSTS = [];
var nc = triviaTablet({ trivia_time_limit_s: 40 }), ncr = null, nth = null;
try { nc.startTriviaPrefs().then(function (r) { ncr = r; }); flush(); nc.queueTriviaPrefs(); flush(); } catch (e) { nth = e; }
ok('the column not added yet: nothing breaks, the older columns fill the setup, and no alarm', !nth && ncr === 'local' && nc.els.cfgTime.value === '40', [nth && nth.message, ncr]);
var rc = raffleTablet(null), rth = null; try { rc.startRafflePrefs(); flush(); rc.savePrize('Tab'); flush(); } catch (e) { rth = e; }
ok('the column not added yet: a raffle prize still goes on this tablet\'s buttons', !rth && rc.G.savedPrizes[0] === 'Tab');
var gp = SS.VP.gamePrefs.toString();
ok('the shared helper says nothing on the page when it cannot save (no alert, no error bar)', !/alert\(|hostError|statusBar|console\.error/.test(gp));
NO_COLUMN = false;

/* ======================= 5. the route's allow-list, and /session ======================= */
section('5. the Worker keeps only each game\'s own keys, checked, from any staff login at THAT venue');
function call(method, url, body) { var out = null; BODY = body || {};
  handleGamePrefs({ method: method, url: url, headers: { get: function () { return 'Bearer x'; } } }, ENV, json)
    .then(function (r) { out = r; }, function (e) { out = { status: e.status || 500, body: { error: e.message } }; }); drainMicrotasks(); return out; }
function post(game, prefs, venue) { return call('POST', 'https://w/host/game-prefs', { venue_id: venue || VENUE, game: game, prefs: prefs }); }
resetDb({});
var junk = { paid: true, paidMode: 'card', excluded_ranges: [[1, 2]], unsold: '3-4', permits: { qld: 'X' }, tonight: 'paid' };
function withJunk(o) { var x = {}; for (var k in junk) x[k] = junk[k]; for (var k2 in o) x[k2] = o[k2]; return x; }
var cases = {
  bingo: [{ caller: true, pattern: 'top', prize: 'Tab', cards: 6, allow_early: false }, { caller: 'yes', pattern: 'diagonal', cards: 7, allow_early: 1, prize: '   ' }, { pattern: 'c:not-a-uuid' }],
  trivia: [{ set_id: SET_A, count: 100, time_s: 5, base_points: 0, speed_bonus: true, double_points: false, double_last: 1 },
           { set_id: 'x', count: 0, time_s: 61, base_points: -1, speed_bonus: 'on', double_points: null, double_last: 101 }, { count: 1.5 }],
  raffle: [{ prizes: ['Meat Tray', 'Meat Tray', ' Tab '], range_min: 0, range_max: 999999, time_to_present: 0, jackpot_on: false, jackpot_amount_cents: 50050, allow_redraw: true, spin_seconds: 3 },
           { prizes: 'Meat Tray', range_min: -1, range_max: 1000000, time_to_present: 3601, jackpot_on: 'true', jackpot_amount_cents: 1.5, spin_seconds: 7 }, { spin_seconds: '4' }],
  members: [{ draw_id: D1 }, { draw_id: 'friday' }, { draw_id: 42 }],
  musical: [{ playlist: '80s', playlist_name: '80s Party', hits_only: true, pattern: 'full', prize: 'Tab', reveal: 'never' }, { playlist: 'a b<c>', hits_only: 'no', pattern: 'top', reveal: 'soon' }, { pattern: 'diagonal' }]
};
var KEYS = { bingo: 'caller,pattern,prize,cards,allow_early', trivia: 'set_id,count,time_s,base_points,speed_bonus,double_points,double_last',
  raffle: 'prizes,range_min,range_max,time_to_present,jackpot_on,jackpot_amount_cents,allow_redraw,spin_seconds', members: 'draw_id',
  musical: 'playlist,playlist_name,hits_only,pattern,prize,reveal' };
Object.keys(cases).forEach(function (g) {
  resetDb({});
  var good = post(g, withJunk(cases[g][0])), kept = JSON.parse(JSON.stringify(saved(g) || {}));   // a copy: the fake merges in place
  ok(g + ': every allowed key is kept, and nothing else (no paid-or-free, unsold tickets or permits)', good && good.status === 200 && Object.keys(kept).sort().join() === KEYS[g].split(',').sort().join(),
     [good && good.status, Object.keys(kept)]);
  var badr = post(g, cases[g][1]); var after = saved(g) || {};
  ok(g + ': a value of the wrong type or out of range is dropped, the saved one stands', JSON.stringify(after) === JSON.stringify(kept), [badr && badr.status, after]);
  var r3x = post(g, cases[g][2]);
  ok(g + ': a save with nothing allowed in it is refused and writes nothing', r3x && r3x.status === 400 && JSON.stringify(saved(g)) === JSON.stringify(kept), r3x && r3x.status);
  var gget = call('GET', 'https://w/host/game-prefs?venue_id=' + VENUE + '&game=' + g);
  ok(g + ': GET answers the venue\'s saved setup for that game', gget && gget.status === 200 && JSON.stringify(gget.body.prefs) === JSON.stringify(kept), gget && gget.body);
});
resetDb({});
post('raffle', { prizes: ['Meat Tray', 'Meat Tray', ' Tab ', '', 5] });
ok('raffle prizes: trimmed, no repeats, no blanks, text only', JSON.stringify(saved('raffle').prizes) === '["Meat Tray","Tab"]', saved('raffle'));
post('raffle', { prizes: 'abcdefghijklm'.split('') });
ok('raffle prizes: twelve at most', saved('raffle').prizes.length === 12);
ok('bingo: the venue\'s own pattern is kept by its id', (post('bingo', { pattern: 'c:44444444-4444-4444-8444-444444444444' }) || {}).status === 200 && saved('bingo').pattern === 'c:44444444-4444-4444-8444-444444444444');
var big = post('raffle', { prizes: [new Array(2100).join('x')] });
ok('more than it should ever hold is refused (413)', big && big.status === 413, big && big.status);
var unk = post('payroll', { a: 1 });
ok('a game it has no rules for is refused, by name', unk && unk.status === 400 && unk.body.error === 'Unknown game', unk && unk.body);
ok('a Host-role login saves (any staff role)', (post('bingo', { prize: 'Host saved' }) || {}).status === 200 && saved('bingo').prize === 'Host saved');
var other = post('bingo', { prize: 'Elsewhere' }, VENUE2);
ok('a login that is not staff at that venue is refused', other && other.status === 403 && !(DB.vp_venue_settings.filter(function (r) { return r.venue_id === VENUE2; })[0]), other && other.body);
DB.vp_venues[0].status = 'suspended';
var off = post('bingo', { prize: 'Off' });
ok('a switched-off venue cannot save, and the host is told in the host\'s words', off && off.status === 403 && /Your tab has run a bit long/.test(off.body.error) && saved('bingo').prize === 'Host saved', off && off.body);

section('5b. Open lobby (/session) answers a host in the host\'s words');
resetDb({}); DB.vp_venues[0].status = 'suspended';
var sess = null; BODY = { venue_id: VENUE, format: 'bingo' };
handleCreateSession({ method: 'POST', headers: { get: function () { return 'Bearer x'; } } }, ENV, json).then(function (r) { sess = r; }, function (e) { sess = { status: e.status, body: { error: e.message } }; });
drainMicrotasks();
ok('a host opening a lobby at a switched-off venue is told to settle up, not to "have a word with the staff"', sess && sess.status === 403 && /Your tab has run a bit long/.test(sess.body.error) && !/word with the staff/.test(sess.body.error), sess && sess.body);
DB.vp_venue_staff = [];
var stranger = null; BODY = { venue_id: VENUE, format: 'bingo' };
handleCreateSession({ method: 'POST', headers: { get: function () { return 'Bearer x'; } } }, ENV, json).then(function (r) { stranger = r; }, function (e) { stranger = { status: e.status, body: { error: e.message } }; });
drainMicrotasks();
ok('CONTROL: somebody who is not staff there learns nothing about the venue\'s account', stranger && stranger.status === 403 && /not staff at this venue/.test(stranger.body.error), stranger && stranger.body);

print('');
print(RAN - BAD + ' of ' + RAN + ' checks passed');
if (BAD) throw new Error(BAD + ' failed');
