/* ONE LIVE BINGO NIGHT PER TABLET, 15 OCT 2026. Everything here is RUN from the shipped files.

   /app is both the games menu and the bingo console, so bingo cannot lock its page to one tab the
   way trivia and musical do (tools/test-musical-15-oct.js). It locks only once a night is open:
     1. vp-onetab.js grew watch / quiet claim / notice / release, run for real in fake tabs
     2. the bingo console's own connect, openLobby, selectGame, senders, saveGame and End game,
        lifted out of venueplay/app/index.html and run in two fake tabs on one fake tablet with a
        fake room channel that records who said what
   The rig: every tab is the real vp-onetab.js in its own fake window, one BroadcastChannel bus,
   one shared localStorage (same origin), a per-tab sessionStorage, and one fake clock.

   Run: jsc tools/test-bingo-tab-15-oct.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var ONETAB = find('venueplay/app/vp-onetab.js');
var CONSOLE = find('venueplay/app/index.html');

/* ---------- a fake clock and a fake tablet ---------- */
var NOW = 1000000, timers = [];
function fakeSetTimeout(fn, ms) { timers.push({ at: NOW + (ms || 0), fn: fn }); return timers.length; }
function advance(ms) {
  var end = NOW + ms;
  drainMicrotasks();
  for (;;) {
    timers.sort(function (a, b) { return a.at - b.at; });
    var t = timers[0];
    if (!t || t.at > end) break;
    timers.shift(); NOW = t.at; t.fn();
    drainMicrotasks();
  }
  NOW = end; drainMicrotasks();
}
var _realNow = Date.now; Date.now = function () { return NOW; };

var BUS = [];
var LOCAL = {};   // the tablet's localStorage: one origin, every tab shares it
var localStorage = { getItem: function (k) { return k in LOCAL ? LOCAL[k] : null; },
                     setItem: function (k, v) { LOCAL[k] = String(v); }, removeItem: function (k) { delete LOCAL[k]; } };
function textOf(node) { if (!node) return ''; var s = node.textContent || ''; (node.kids || []).forEach(function (k) { s += ' ' + textOf(k); }); return s; }
function makeTab(opts) {
  opts = opts || {};
  var store = opts.session || {};
  var byId = {};
  function el(tag) {
    var e = { tag: tag, id: '', style: {}, kids: [], textContent: '', disabled: false, listeners: {}, parentNode: null,
      setAttribute: function () {}, addEventListener: function (n, f) { this.listeners[n] = f; },
      appendChild: function (c) { this.kids.push(c); c.parentNode = this; if (c.id) byId[c.id] = c; },
      removeChild: function (c) { var i = this.kids.indexOf(c); if (i >= 0) this.kids.splice(i, 1); if (c.id && byId[c.id] === c) delete byId[c.id]; } };
    return e;
  }
  var body = el('body');
  body.appendChild = function (c) { this.kids.push(c); c.parentNode = this; byId[c.id] = c;
    (function reg(n) { (n.kids || []).forEach(function (k) { if (k.id) byId[k.id] = k; reg(k); }); })(c); };
  var win = {
    reloads: 0, listeners: {}, store: store,
    sessionStorage: { getItem: function (k) { return k in store ? store[k] : null; },
                      setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    location: { reload: function () { win.reloads++; } },
    addEventListener: function (n, f) { win.listeners[n] = f; },
    document: { body: body, visibilityState: 'visible', listeners: {},
      createElement: el, getElementById: function (id) { return byId[id] || null; },
      addEventListener: function (n, f) { win.document.listeners[n] = f; } }
  };
  // re-register nested ids appended after the box went into the body
  var _gid = win.document.getElementById;
  win.document.getElementById = function (id) {
    var r = _gid(id); if (r) return r;
    var hit = null;
    (function walk(n) { (n.kids || []).forEach(function (k) { if (!hit && k.id === id) hit = k; walk(k); }); })(body);
    return hit;
  };
  if (!opts.noBC) {
    win.BroadcastChannel = function (name) {
      var me = { name: name, onmessage: null };
      me.postMessage = function (data) {
        var copy = JSON.parse(JSON.stringify(data));
        BUS.forEach(function (o) {
          if (o === me || o.name !== name || o.dead) return;
          fakeSetTimeout(function () { if (o.onmessage && !o.dead) o.onmessage({ data: copy }); }, 1);
        });
      };
      BUS.push(me); win._bc = me;
      return me;
    };
  }
  (new Function('window', 'setTimeout', ONETAB))(win, fakeSetTimeout);
  win.API = win.VP_ONETAB;
  win.kill = function () { if (win._bc) win._bc.dead = true; };
  return win;
}
function noticeOf(w) { return w.document.getElementById('vpOneTab'); }
function resetBus() { BUS.forEach(function (o) { o.dead = true; }); NOW += 1000; }

/* ================= 1. vp-onetab.js: the calls bingo needs ================= */
print('\n== 1. vp-onetab.js: watch, quiet claim, notice, release (run for real in fake tabs) ==');
(function () {
  var a = makeTab(), held = null;
  ok('the shared script offers watch, release, notice and available', typeof a.API.watch === 'function' &&
     typeof a.API.release === 'function' && typeof a.API.notice === 'function' && a.API.available() === true);
  a.API.watch('bingo:v1').then(function (h) { held = h; });
  advance(100);
  ok('a tab that is still asking is not yet idle (the console treats asking as quiet)', a.API.state() === 'asking');
  advance(600);
  ok('watch with nobody holding the night: not held, and this tab takes nothing', held === false && a.API.state() === 'idle' && a.API.live() === true);

  var b = makeTab(), rb = false;
  b.API.claim('bingo:v1').then(function () { rb = true; });
  advance(700);
  ok('a watching tab does not stop another tab claiming the night', rb === true && b.API.state() === 'live');
  ok('and the watcher, hearing the claim, goes quiet', a.API.state() === 'blocked' && a.API.live() === false);
  ok('quietly: no notice over its menu', !noticeOf(a));

  var c = makeTab(), hc = null;
  c.API.watch('bingo:v1').then(function (h) { hc = h; });
  advance(700);
  ok('a new tab that only watches finds the night held, and goes quiet', hc === true && c.API.live() === false);
  ok('with no notice: the menu stays usable', !noticeOf(c));

  var d = makeTab(), rd = false;
  d.API.claim('bingo:v1', { quiet: true }).then(function () { rd = true; });
  advance(700);
  ok('a quiet claim behind the live tab never resolves and puts up no notice', rd === false && d.API.live() === false && !noticeOf(d));

  var backs = 0;
  ok('notice() puts it up on demand', c.API.notice({ back: 'Back to the games menu', onBack: function () { backs++; } }) === true &&
     /already open in another tab/.test(textOf(noticeOf(c))));
  var back = c.document.getElementById('vpOneTabBack');
  ok('with a second button back to the menu', !!back && back.textContent === 'Back to the games menu');
  back.listeners.click();
  ok('which takes the notice down and runs the menu', !noticeOf(c) && backs === 1);
  ok('notice() does nothing in the live tab', b.API.notice() === false && !noticeOf(b));

  // A blocked claim asks afresh when asked again (the live tab may have gone).
  var e = makeTab(), re = false;
  e.API.claim('bingo:v1', { back: 'Back' }).then(function () { re = true; });
  advance(700);
  ok('a non-quiet claim behind the live tab shows the notice', re === false && !!noticeOf(e));

  b.API.release('bingo:v1');
  advance(50);
  ok('release: the live tab stops being the live one', b.API.state() === 'idle' && b.API.live() === true);
  ok('and every tab waiting behind it is free again', a.API.live() && c.API.live() && d.API.live() && e.API.live());
  ok('the notice comes down on its own', !noticeOf(e));

  var ra = false;
  a.API.claim('bingo:v1').then(function () { ra = true; });
  advance(700);
  ok('after a release any tab can claim the next night', ra === true && a.API.state() === 'live');
  ok('and the tab that released it is quiet behind the new one', b.API.live() === false && b.API.state() === 'blocked');
  ok('release by a tab that does not hold the night changes nothing', (b.API.release('bingo:v1'), a.API.state() === 'live'));

  var other = makeTab(), ro = false;
  other.API.claim('musical:v1').then(function () { ro = true; });
  advance(700);
  ok('a bingo night does not block a musical console', ro === true);

  // The reload race, with bingo's quiet claim: the stood-down tab reloads first and must wait.
  resetBus();
  var old = makeTab({ session: { vpOneTabDown: 'bingo:v9' } }), rOld = false;
  old.API.claim('bingo:v9', { quiet: true }).then(function () { rOld = true; });
  advance(1500);
  var taker = makeTab(), rT = false;
  taker.API.claim('bingo:v9', { quiet: true }).then(function () { rT = true; });
  advance(3000);
  ok('the reload race: the stood-down tab does not take the night back', rOld === false && old.API.live() === false);
  ok('the tab whose button was pressed holds the night', rT === true && taker.API.state() === 'live');
  ok('and the stood-down tab, asked for the notice, says the game moved',
     old.API.notice() === true && /moved to another tab/.test(textOf(noticeOf(old))));

  var nob = makeTab({ noBC: true }), wn = null, cn = false;
  nob.API.watch('bingo:v1').then(function (h) { wn = h; });
  nob.API.claim('bingo:v1').then(function () { cn = true; });
  drainMicrotasks();
  ok('no BroadcastChannel: available() is false, watch says free and claim resolves at once',
     nob.API.available() === false && wn === false && cn === true && nob.API.live() === true);
})();

/* ================= 2. the bingo console in two tabs ================= */
print('\n== 2. the bingo console (lifted from venueplay/app/index.html) in two tabs on one tablet ==');
var NAMES = ['oneTabOn', 'oneTabKey', 'standingDown', 'rawSend', 'send', 'flushQueue', 'onRoomMsg',
             'gameOpenHere', 'touchGame', 'clampCards', 'gameKey', 'saveGame', 'savedNightOpen', 'resumeAfterClaim',
             'oneTabNoticeOpts', 'restoreGame', 'restoreNightFields', 'freshPool', 'reassertToTv', 'openLobby', 'openLobbyClaimed',
             'cancelLobby', 'endGame', 'connect', 'selectGame', 'landAfterConnect'];
var SRC = NAMES.map(function (n) { return lift(CONSOLE, n, 'index.html'); }).join('');
var ROOM = [];   // every broadcast that left any tab: { tab, t }
function makeConsole(name, win) {
  var els = {};
  function elem(id) {
    if (!els[id]) els[id] = { id: id, value: '', textContent: '', innerHTML: '', style: {}, checked: false,
      classList: { _c: {}, add: function (c) { this._c[c] = 1; }, remove: function (c) { delete this._c[c]; },
                   toggle: function (c, on) { if (on) this._c[c] = 1; else delete this._c[c]; }, contains: function (c) { return !!this._c[c]; } } };
    return els[id];
  }
  var env = {
    window: win, VP_ONETAB: win.VP_ONETAB, localStorage: localStorage, name: name,
    document: { getElementById: elem, querySelectorAll: function () { return []; } },
    ROOM: ROOM
  };
  var body =
    'var $=function(id){ return document.getElementById(id); };' +
    'var G={ code:"", status:"setup", pattern:"one", prize:"the prize", defaultCards:1, allowEarly:false, paidMode:"",' +
    '  draw:[], idx:-1, called:{}, pool:[], players:{}, order:[], claims:[], claimIdx:-1, claimSeq:0, won:false, lastWins:[], prizesWon:[], startedAt:null };' +
    'var NIGHT={ games:0, peak:0, prizes:[], startedAt:null }; var SAVE_MAX_AGE=6*60*60*1000, STALE_GAME_MS=3*60*60*1000, lastGameTouch=Date.now();' +
    'var VP=null, VPRoom=null, VPChannel=null, _useRoom=false, _roomTried=false, _room=null, VP_GAME_API="x";' +
    'var ch=null, subscribed=false, sendQueue=[], currentGame="", _hostPicked=false, overageAcked=false, overageApproved=0;' +
    'var __ctx={ venue:{ id:"venue-1" } }; var GAME_PATHS={};' +
    'var lobbiesOpened=0, menus=0, heard=[], nights=0;' +
    'var client={ channel:function(){ var c={ handler:null, cb:null,' +
    '  on:function(a,b,h){ this.handler=h; return this; }, subscribe:function(cb){ this.cb=cb; return this; },' +
    '  send:function(m){ ROOM.push({ tab:name, t:m.payload.t, p:m.payload }); } }; return c; } };' +
    'function go(){} function buildBoard(){} function renderConsole(){} function syncNextBtn(){} function clearCallGuards(){}' +
    'function sendState(){ send({ t:"state", active:(G.status==="running"), called:G.draw.slice() }); }' +
    'function sendClaimPending(){} function showToast(){} function renderClaimQueue(){} function announce(){}' +
    'function postReport(){} function showNightCard(){ nights++; } function blockedByHold(){ return false; }' +
    'function showGameSelect(){ currentGame=""; menus++; }' +
    'function openLobbyNow(){ lobbiesOpened++; G.status="lobby"; send({ t:"mode", mode:"bingo" }); sendState(); saveGame(); }' +
    'function onMsg(m){ heard.push(m.t); }' +
    // The server's ticket and claim record (19 Oct 2026): a restored night asks it again later. Not this suite's subject.
    'function claimCheck(){} function claimRetrySoon(){} function flushClaimLog(){} function recordTabletTickets(){} function dealSoon(){} function recordDecision(){}' +
    SRC +
    'return { G:function(){ return G; }, connect:connect, openLobby:openLobby, cancelLobby:cancelLobby, endGame:endGame,' +
    '  selectGame:selectGame, send:send, rawSend:rawSend, saveGame:saveGame, standingDown:standingDown,' +
    '  subscribe:function(){ ch.cb("SUBSCRIBED"); }, deliver:function(p){ ch.handler({ payload:p }); },' +
    '  stats:function(){ return { lobbies:lobbiesOpened, menus:menus, heard:heard, nights:nights, currentGame:currentGame }; } };';
  var keys = Object.keys(env);
  var f = Function.apply(null, keys.concat([body]));
  return f.apply(null, keys.map(function (k) { return env[k]; }));
}
function from(tab) { return ROOM.filter(function (m) { return m.tab === tab; }).map(function (m) { return m.t; }); }

(function () {
  resetBus(); LOCAL = {}; ROOM = [];
  // A night already running on this tablet: two balls called, Ann holding a ticket.
  var CODE = 'ABC234';
  var TICKET = [[1, 0, 23, 0, 45, 0, 67, 0, 89]];
  LOCAL['vpHostGame-' + CODE] = JSON.stringify({ v: 1, ts: NOW, status: 'running', pattern: 'one', prize: '$50 tab',
    draw: [5, 17], idx: 1, called: { 5: true, 17: true }, players: { p1: { name: 'Ann', cards: TICKET } }, order: ['p1'],
    claims: [], lastWins: [], won: false, drawId: 'draw-1', drawMode: 'server', sessionId: 'sess-1', joinCode: 'JOIN1' });

  // ---- tab 1 reloads onto the running night ----
  var w1 = makeTab(), t1 = makeConsole('tab1', w1);
  t1.connect(CODE);
  t1.subscribe();                      // the channel is up before the other tabs have answered
  t1.send({ t: 'host_here' });         // the 30s heartbeat, mid-ask
  advance(100);
  ok('tab 1 says nothing to the room while it asks the other tabs', from('tab1').length === 0, from('tab1').join(','));
  ok('and has not restored the night yet', t1.G().status !== 'running');
  advance(600);
  ok('nobody else holds it: tab 1 restores the running night', t1.G().status === 'running' && t1.G().idx === 1 && t1.G().drawId === 'draw-1');
  var said1 = from('tab1');
  ok('then says the hellos connect would have said: host_here, the game back on the TV, and a roll call',
     said1[0] === 'host_here' && said1.indexOf('mode') > 0 && said1.indexOf('state') > 0 && said1[said1.length - 1] === 'rollcall', said1.join(','));
  ok('and lands on the live bingo board', t1.stats().currentGame === 'bingo');

  // ---- tab 2 opens /app on the same tablet ----
  var w2 = makeTab(), t2 = makeConsole('tab2', w2);
  t2.connect(CODE);
  t2.subscribe();
  advance(800);
  ok('tab 2 does NOT restore the night another tab is running', t2.G().status === 'setup' && t2.G().draw.length === 0);
  ok('it lands on the games menu, with no notice over it', t2.stats().menus >= 1 && !noticeOf(w2));
  ok('and its connect said nothing to the room: no host_here, no roll call', from('tab2').length === 0, from('tab2').join(','));
  t2.send({ t: 'host_here' }); t2.rawSend({ t: 'to_ads' }); t2.send({ t: 'idle' });
  ok('its heartbeat, pagehide and idle all go nowhere', from('tab2').length === 0, from('tab2').join(','));
  t2.deliver({ t: 'join', pid: 'p2', name: 'Bob' });
  ok('a phone joining is not processed by the tab behind (it is tab 1\'s room)', t2.stats().heard.length === 0);
  t1.deliver({ t: 'join', pid: 'p2', name: 'Bob' });
  ok('while the live tab still hears the room', t1.stats().heard.join(',') === 'join');
  t2.saveGame();
  ok('a save from the tab behind does not delete the live tab\'s saved night', !!LOCAL['vpHostGame-' + CODE] &&
     JSON.parse(LOCAL['vpHostGame-' + CODE]).status === 'running');

  t2.selectGame('bingo');
  advance(700);
  ok('tapping Bingo in tab 2 shows the "already open in another tab" notice',
     /already open in another tab/.test(textOf(noticeOf(w2))));
  var back = w2.document.getElementById('vpOneTabBack');
  ok('with a way back to the menu', !!back);
  var m0 = t2.stats().menus; back.listeners.click();
  ok('which goes back to the menu', t2.stats().menus === m0 + 1 && !noticeOf(w2));
  t2.openLobby();
  advance(700);
  ok('Open lobby in tab 2 opens nothing and puts the notice up', t2.stats().lobbies === 0 && !!noticeOf(w2));
  ok('and still said nothing to the room', from('tab2').length === 0, from('tab2').join(','));
  ok('tab 1 is untouched throughout', w1.API.state() === 'live' && w1.reloads === 0 && t1.G().status === 'running');

  // ---- Use this tab instead ----
  w2.document.getElementById('vpOneTabTake').listeners.click();
  advance(400);
  ok('Use this tab instead: tab 1 stands down at once', w1.API.live() === false && w1.reloads === 1);
  var before = from('tab1').length;
  t1.send({ t: 'state' }); t1.send({ t: 'host_here' });
  ok('and the stood-down tab sends nothing more', from('tab1').length === before);
  ok('tab 2 reloads to take the night', w2.reloads === 1);

  // Both pages reload. The stood-down one is FAST (the race seen live); the taker loads 1.5s later.
  w1.kill(); w2.kill();
  var w1b = makeTab({ session: w1.store }), t1b = makeConsole('tab1b', w1b);
  t1b.connect(CODE); t1b.subscribe();
  advance(1500);
  var w2b = makeTab({ session: w2.store }), t2b = makeConsole('tab2b', w2b);
  t2b.connect(CODE); t2b.subscribe();
  advance(4000);
  ok('the reload race: the stood-down tab does not take the night back', t1b.G().status !== 'running' && w1b.API.live() === false);
  ok('and said nothing to the room while it waited', from('tab1b').length === 0, from('tab1b').join(','));
  ok('the tab whose button was pressed restored the SAME night: same balls, same ticket, same draw',
     t2b.G().status === 'running' && t2b.G().draw.join(',') === '5,17' && t2b.G().drawId === 'draw-1' &&
     JSON.stringify(t2b.G().players.p1.cards) === JSON.stringify(TICKET) && t2b.G().sessionId === 'sess-1');
  var said2 = from('tab2b');
  ok('and called the TV and the phones back to itself', said2.indexOf('mode') >= 0 && said2.indexOf('rollcall') >= 0, said2.join(','));
  t1b.selectGame('bingo');
  advance(700);
  ok('tapping Bingo on the old tab says the game moved', /moved to another tab/.test(textOf(noticeOf(w1b))));

  // ---- End game lets either tab open the next night ----
  t2b.endGame();
  advance(50);
  ok('End game finishes the night on the live tab', t2b.G().status === 'setup' && from('tab2b').indexOf('idle') >= 0);
  ok('and frees the tab behind it, notice and all', w1b.API.live() === true && !noticeOf(w1b));
  t1b.openLobby();
  advance(700);
  ok('the OTHER tab can now open the next lobby', t1b.stats().lobbies === 1 && t1b.G().status === 'lobby' && from('tab1b').indexOf('mode') >= 0);
  ok('and the tab that ended the night is now the one behind', w2b.API.live() === false);
  t2b.openLobby();
  advance(700);
  ok('so its Open lobby shows the notice instead of a second lobby', t2b.stats().lobbies === 0 && !!noticeOf(w2b));
  t1b.cancelLobby();
  advance(50);
  ok('Close lobby lets go of it too', w1b.API.state() === 'idle' && w2b.API.live() === true && !noticeOf(w2b));
  t2b.openLobby();
  advance(700);
  ok('and then the first tab can open one again', t2b.stats().lobbies === 1 && w2b.API.state() === 'live');

  // ---- a menu tab never holds a night ----
  resetBus(); LOCAL = {}; ROOM = [];
  var wm = makeTab(), tm = makeConsole('menu', wm);
  tm.connect('XYZ234'); tm.subscribe();
  advance(700);
  ok('a lone tab with nothing saved only watches: it holds nothing', wm.API.state() === 'idle');
  ok('and once the ask is over it says host_here as before', from('menu').join(',') === 'host_here', from('menu').join(','));
  var wn = makeTab(), tn = makeConsole('menu2', wn), rn = false;
  tn.connect('XYZ234'); tn.subscribe();
  advance(700);
  tn.openLobby();
  advance(700);
  ok('so a second tab can still open the lobby', tn.stats().lobbies === 1 && wn.API.state() === 'live');
  ok('and the menu tab goes quiet behind it', wm.API.live() === false);
})();

/* ================= 2b. the Open lobby button asks the tabs before the gaming rules ================= */
print('\n== 2b. the Open lobby button asks the other tabs BEFORE the state gaming rules ==');
(function () {
  var at = CONSOLE.indexOf('$("startBtn").addEventListener("click", function(){');
  if (at < 0) throw new Error('the Open lobby button lost its listener');
  var k = CONSOLE.indexOf('function(){', at), d = 0, j = CONSOLE.indexOf('{', k);
  do { if (CONSOLE[j] === '{') d++; else if (CONSOLE[j] === '}') d--; j++; } while (d > 0 && j < CONSOLE.length);
  var HANDLER = CONSOLE.slice(k, j);
  function rig(win) {
    var log = [];
    var f = new Function('window', 'VP_ONETAB', 'setTimeout', 'log',
      'var _startBusy=false; var G={ status:"setup", paidMode:"" }; var __ctx={ venue:{ id:"venue-1" } };' +
      lift(CONSOLE, 'oneTabOn', 'index.html') + lift(CONSOLE, 'oneTabKey', 'index.html') +
      'function oneTabNoticeOpts(){ return {}; } function startGame(){ log.push("start"); } function openLobby(){ log.push("openLobby"); }' +
      'var VPGaming = window.VPGaming = { gateFor:function(g, go){ log.push("rules"); go(); } };' +
      'return ' + HANDLER + ';');
    return { click: f(win, win.VP_ONETAB, fakeSetTimeout, log), log: log };
  }
  resetBus();
  var live = makeTab(); live.API.claim('bingo:venue-1'); advance(700);
  var behind = makeTab(), r = rig(behind);
  behind.API.watch('bingo:venue-1'); advance(700);
  r.click(); advance(700);
  ok('a tab behind the live one does not put up the gaming rules or declare the night', r.log.length === 0, r.log.join(','));
  ok('it shows the notice instead', !!noticeOf(behind));
  live.API.release('bingo:venue-1'); advance(50);
  advance(1300);   // past the double-tap guard
  r.click(); advance(700);
  ok('once the night is free, the same tap claims it, then the rules, then the lobby', r.log.join(',') === 'rules,openLobby' && behind.API.state() === 'live', r.log.join(','));
})();

/* ================= 3. no BroadcastChannel: exactly as before ================= */
print('\n== 3. no BroadcastChannel: the console behaves exactly as it did before ==');
(function () {
  resetBus(); LOCAL = {}; ROOM = [];
  LOCAL['vpHostGame-OLD234'] = JSON.stringify({ v: 1, ts: NOW, status: 'running', pattern: 'one', prize: 'x',
    draw: [9], idx: 0, called: { 9: true }, players: {}, order: [], claims: [], lastWins: [], won: false });
  var w = makeTab({ noBC: true }), t = makeConsole('old', w);
  t.connect('OLD234');
  ok('the saved game is restored inside connect itself, before anything is asked', t.G().status === 'running' && t.G().draw.join(',') === '9');
  t.subscribe();
  ok('and the subscribe says host_here and the roll call at once', from('old')[0] === 'host_here' && from('old').indexOf('rollcall') > 0, from('old').join(','));
  t.endGame();
  ok('End game still ends the night', t.G().status === 'setup' && from('old').indexOf('idle') >= 0);
  t.openLobby();
  ok('and Open lobby opens at once, with nothing to ask', t.stats().lobbies === 1);
})();

/* ================= 4. the page is wired ================= */
print('\n== 4. the page loads the one shared copy ==');
ok('index.html loads /app/vp-onetab.js before its own script', CONSOLE.indexOf('<script src="/app/vp-onetab.js"></script>') > 0 &&
   CONSOLE.indexOf('<script src="/app/vp-onetab.js"></script>') < CONSOLE.indexOf('function rawSend('));
ok('the room listeners go through the gate', /function\(e\)\{ onRoomMsg\(e\.payload\); \}/.test(CONSOLE) && /function\(payload\)\{ onRoomMsg\(payload\); \}/.test(CONSOLE));

Date.now = _realNow;
print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
