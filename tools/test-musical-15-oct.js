/* MUSICAL FAULTS FROM THE 14 OCT LIVE AUDIT, FIXED 15 OCT 2026. Each is RUN from the shipped file.

     1. a second console tab on the same tablet silently restored the same game; the two diverged
        and the stale one kept the TV on NOW PLAYING after the night ended (/app/vp-onetab.js)
     2. the TV never left a running game whose console had gone quiet (musical screen)
     3. the phone lost every mark on reload
     4. a deliberate "Play next" tap four seconds in hit a dead button and vanished

   Run: jsc tools/test-musical-15-oct.js
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
var HOLD = find('venueplay/app/vp-hold.js');
var MHOST = find('venueplay/app/musical/host.html');
var THOST = find('venueplay/app/trivia/host.html');
var MSCREEN = find('venueplay/app/musical/screen.html');
var MPLAY = find('venueplay/app/musical/play.html');

/* ---------- a fake clock shared by every fake window ---------- */
var NOW = 1000000, timers = [];
function fakeSetTimeout(fn, ms) { timers.push({ at: NOW + (ms || 0), fn: fn }); return timers.length; }
function advance(ms) {
  var end = NOW + ms;
  for (;;) {
    timers.sort(function (a, b) { return a.at - b.at; });
    var t = timers[0];
    if (!t || t.at > end) break;
    timers.shift(); NOW = t.at; t.fn();
    drainMicrotasks();
  }
  NOW = end; drainMicrotasks();
}

/* ---------- 1. one live console per tablet ---------- */
print('\n== 1. one live console per tablet (vp-onetab.js, run for real in fake tabs) ==');
var BUS = [];   // every BroadcastChannel on the "device"
function makeTab(opts) {
  opts = opts || {};
  var store = {};
  var body = { kids: [], appendChild: function (e) { this.kids.push(e); byId[e.id] = e; } };
  var byId = {};
  function el(tag) {
    return { tag: tag, id: '', style: {}, kids: [], textContent: '', disabled: false, listeners: {},
      setAttribute: function () {}, appendChild: function (e) { this.kids.push(e); if (e.id) byId[e.id] = e; },
      addEventListener: function (n, f) { this.listeners[n] = f; } };
  }
  var win = {
    reloads: 0, listeners: {},
    sessionStorage: { getItem: function (k) { return k in store ? store[k] : null; },
                      setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    location: { reload: function () { win.reloads++; } },
    addEventListener: function (n, f) { win.listeners[n] = f; },
    document: { body: body, visibilityState: 'visible', listeners: {},
      createElement: el, getElementById: function (id) { return byId[id] || null; },
      addEventListener: function (n, f) { win.document.listeners[n] = f; } }
  };
  if (!opts.noBC) {
    win.BroadcastChannel = function (name) {
      var me = { name: name, onmessage: null, closed: false };
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
  // Run the real file in this "window". Math.random and Date.now are the real/fake ones.
  var realNow = Date.now; Date.now = function () { return NOW; };
  (new Function('window', 'setTimeout', ONETAB))(win, fakeSetTimeout);
  Date.now = realNow;
  win.API = win.VP_ONETAB;
  win.kill = function () { if (win._bc) win._bc.dead = true; };   // the page reloaded or closed
  return win;
}
// vp-onetab reads Date.now while running; keep it on the fake clock for the whole section.
var _realNow = Date.now; Date.now = function () { return NOW; };

(function () {
  var a = makeTab(), resolvedA = false;
  ok('the shared script defines VP_ONETAB', !!a.API && typeof a.API.claim === 'function' && typeof a.API.live === 'function');
  a.API.claim('musical:v1').then(function () { resolvedA = true; });
  advance(100);
  ok('a lone tab is not live until it has asked', resolvedA === false);
  advance(600);
  ok('nobody answered, so the lone tab is the live console', resolvedA === true && a.API.live() === true && a.API.state() === 'live');

  NOW += 5000;
  var b = makeTab(), resolvedB = false;
  b.API.claim('musical:v1').then(function () { resolvedB = true; });
  advance(800);
  ok('a second tab for the same console does NOT restore the game', resolvedB === false);
  ok('it shows the "already open in another tab" notice instead', !!b.document.getElementById('vpOneTab') &&
     /already open in another tab/.test(JSON.stringify(b.document.getElementById('vpOneTab').kids)));
  ok('and says nothing to the room while it waits', b.API.live() === false);
  ok('the first tab is untouched by being asked', a.API.live() === true && a.reloads === 0);

  var c = makeTab(), resolvedC = false;
  c.API.claim('trivia:v1').then(function () { resolvedC = true; });
  advance(800);
  ok('a DIFFERENT console (trivia beside musical) is not blocked', resolvedC === true && c.API.live() === true);

  // The host taps "Use this tab instead" on tab B.
  var btn = b.document.getElementById('vpOneTabTake');
  ok('the notice has a Use this tab instead button', !!btn && btn.textContent === 'Use this tab instead');
  btn.listeners.click();
  advance(400);
  ok('the old tab stands down at once: it stops talking', a.API.live() === false);
  ok('and reloads itself, so none of its stale timers survive', a.reloads === 1);
  ok('the tab that took over reloads to restore the game as the only console', b.reloads === 1);
  ok('the stood-down tab remembers why, for its notice', a.sessionStorage.getItem('vpOneTabDown') === 'musical:v1');

  // Both pages reload: the old one comes back into the notice, the new one becomes live.
  a.kill(); b.kill();
  NOW += 1000;
  var b2 = makeTab(), r2 = false;
  b2.API.claim('musical:v1').then(function () { r2 = true; });
  advance(700);
  ok('after the reload the new tab is the live console', r2 === true && b2.API.live() === true);
  var a2 = makeTab(), ra2 = false;
  a2.sessionStorage.setItem('vpOneTabDown', 'musical:v1');
  a2.API.claim('musical:v1').then(function () { ra2 = true; });
  advance(4100);   // a stood-down tab waits up to 4s for the taker (14 Oct 2026)
  ok('the old tab comes back to "moved to another tab", not to a second copy of the game',
     ra2 === false && /moved to another tab/.test(JSON.stringify(a2.document.getElementById('vpOneTab').kids)));

  // The live tab is closed; the stood-down one is reloaded by hand: nobody else is live, so it takes it.
  b2.kill(); a2.kill();
  var a3 = makeTab(), ra3 = false;
  a3.sessionStorage.setItem('vpOneTabDown', 'musical:v1');
  a3.API.claim('musical:v1').then(function () { ra3 = true; });
  advance(4100);
  ok('with the other tab closed, the flag alone never locks a console out', ra3 === true && a3.API.live() === true);

  /* THE RACE FOUND LIVE (14 Oct 2026): the stood-down tab reloads first, the taker 150ms later and
     slower to load. The old tab must wait for it, not take the game straight back. */
  a3.kill(); BUS.forEach(function (o) { o.dead = true; });
  NOW += 1000;
  var old4 = makeTab(), r4old = false;
  old4.sessionStorage.setItem('vpOneTabDown', 'musical:v4');
  old4.API.claim('musical:v4').then(function () { r4old = true; });
  advance(1500);                                    // the taker is still loading
  var new4 = makeTab(), r4new = false;
  new4.API.claim('musical:v4').then(function () { r4new = true; });
  advance(3000);
  ok('the tab that was stood down does not win the reload race and take the game back', r4old === false && old4.API.live() === false);
  ok('the tab whose button was pressed is the live console', r4new === true && new4.API.live() === true);
  ok('and the stood-down tab says the game moved', /moved to another tab/.test(JSON.stringify((old4.document.getElementById('vpOneTab') || {}).kids || '')));

  // An iPad tab that slept through the question: two tabs both live, then the old one wakes.
  BUS.forEach(function (o) { o.dead = true; });
  NOW += 1000;
  var old = makeTab(); old.API.claim('musical:v2'); advance(700);
  old._bc.dead = true;                                     // asleep: hears nothing
  NOW += 60000;
  var fresh = makeTab(); fresh.API.claim('musical:v2'); advance(700);
  ok('a sleeping tab cannot answer, so the new one goes live', fresh.API.live() === true);
  old._bc.dead = false;                                    // wakes up
  old.document.listeners.visibilitychange();
  advance(100);
  ok('when the sleeper wakes, the OLDER tab stands down', old.API.live() === false && old.reloads === 1);
  ok('and the newer one carries on', fresh.API.live() === true && fresh.reloads === 0);

  var nob = makeTab({ noBC: true }), rn = false;
  nob.API.claim('musical:v3').then(function () { rn = true; });
  drainMicrotasks();
  ok('a browser with no BroadcastChannel behaves exactly as before', rn === true && nob.API.live() === true);
})();
Date.now = _realNow;

print('\n== 1b. a stood-down console cannot send or call the Worker ==');
(function () {
  [['musical', MHOST], ['trivia', THOST]].forEach(function (pair) {
    var name = pair[0], H = pair[1];
    var src = lift(H, 'standingDown', name) + lift(H, 'rawSend', name) + lift(H, 'rawGsend', name);
    var live = true, sent = [];
    var f = new Function('window', 'VP_ONETAB', 'ch', 'gch',
      'var subscribed=true, gsub=true, sendQueue=[], gQueue=[];' + src + ' return { rawSend: rawSend, rawGsend: rawGsend };');
    var api = { live: function () { return live; } };
    var chan = { send: function (m) { sent.push(m.payload); } };
    var s = f({ VP_ONETAB: api }, api, chan, chan);
    s.rawSend({ t: 'state' }); s.rawGsend({ t: 'state' });
    ok(name + ': a live console sends', sent.length === 2);
    live = false; sent = [];
    s.rawSend({ t: 'state', active: true }); s.rawGsend({ t: 'played' });
    ok(name + ': a stood-down console sends nothing, so its stale heartbeat cannot reach the TV', sent.length === 0);
    ok(name + ': and its API calls are refused before they leave',
       /function apiPost\(path, body\)\{ if\(window\.VP_ONETAB && !VP_ONETAB\.live\(\)\) return Promise\.reject\(/.test(H));
    ok(name + ': the page loads the one shared copy', H.indexOf('<script src="/app/vp-onetab.js"></script>') > 0);
  });
  ok('musical restores its game only after the claim', /Promise\.all\(\[libReady, _oneTab\]\)\.then\(function\(\)\{[^\n]*\n\s*restoreMusic\(\)/.test(MHOST) &&
     /VP_ONETAB\.claim\("musical:"\+G\.venueId\)/.test(MHOST));
  ok('trivia restores its quiz only after the claim', /VP_ONETAB\.claim\("trivia:"\+G\.venueId\) : Promise\.resolve\(true\)\)\.then\(function\(\)\{ return restoreTrivia\(\)/.test(THOST));
})();

/* ---------- 2. the TV leaves a running game nobody is playing ---------- */
print('\n== 2. the musical screen checks a silent running game against the server ==');
function braceEnd(text, from) {   // index just past the function starting at text[from]
  var d = 0, k = text.indexOf('{', from);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return k;
}
function screenRig() {
  var i = MSCREEN.indexOf('var RUN_SILENCE_MS=');
  var j = MSCREEN.indexOf('setInterval(function(){', i);
  if (i < 0 || j < 0) throw new Error('the musical screen lost its running-game check');
  var fnStart = j + 'setInterval('.length;
  var tick = MSCREEN.slice(fnStart, braceEnd(MSCREEN, fnStart));
  var noteHost = lift(MSCREEN, 'noteHost', 'musical screen');
  var rig = { now: 0, went: null, asked: [], answer: null };
  var f = new Function('rig',
    'var Date={ now:function(){ return rig.now; } };' +
    'var VP_GAME_API="https://api"; var VENUE_SLUG="test-charlie"; function venueCode(s){ return "CODE"; }' +
    'var window={ location:{ set href(v){ rig.went=v; }, get href(){ return ""; } } };' +
    'function fetch(u){ rig.asked.push(u); var a=rig.answer; return Promise.resolve(a===null ? { ok:false, status:500 } : { ok:a.status===200, status:a.status, json:function(){ return Promise.resolve(a.body); } }); }' +
    'var state={ phase:"running" }; var _lobbySince=null, LOBBY_MAX_MS=3600000, LOBBY_SILENCE_MS=300000, _lastHostAt=0, _asking=false;' +
    noteHost + MSCREEN.slice(i, j) +
    'var tick=' + tick + ';' +
    'return { tick:tick, noteHost:noteHost, state:state, setIds:function(s,g){ _sessionId=s; _gameId=g; } };');
  rig.api = f(rig);
  return rig;
}
(function () {
  var r = screenRig();
  r.api.setIds('sess-1', 'game-1');
  r.now = 1000; r.api.noteHost();
  r.now = 1000 + 60 * 1000; r.api.tick(); drainMicrotasks();
  ok('a console that spoke a minute ago is left alone (no server call)', r.asked.length === 0 && r.went === null);
  r.answer = { status: 200, body: { status: 'lobby', game: null } };
  r.now = 1000 + 100 * 1000; r.api.tick(); drainMicrotasks();
  ok('after 90 seconds of silence it asks the session snapshot', r.asked.length === 1 && /\/snapshot\?session=sess-1$/.test(r.asked[0]), r.asked[0]);
  ok('the game it shows has ended (the night still open in its lobby): back to the ads', r.went === '/tv?venue=test-charlie', r.went);

  r = screenRig(); r.api.setIds('sess-1', 'game-1'); r.now = 0; r.api.noteHost();
  r.answer = { status: 200, body: { status: 'running', game: { format: 'musical_bingo', game_id: 'game-1' } } };
  r.now = 120000; r.api.tick(); drainMicrotasks();
  ok('a game still running (a locked iPad) keeps the wall', r.went === null && r.asked.length === 1);
  r.now = 150000; r.api.tick(); drainMicrotasks();
  ok('and is not asked again every tick', r.asked.length === 1);
  r.now = 120000 + 5 * 60000 + 1; r.api.tick(); drainMicrotasks();
  ok('only every five minutes', r.asked.length === 2);

  r = screenRig(); r.api.setIds('sess-1', 'game-1'); r.now = 0; r.api.noteHost();
  r.answer = { status: 200, body: { status: 'running', game: { format: 'musical_bingo', game_id: 'game-2' } } };
  r.now = 120000; r.api.tick(); drainMicrotasks();
  ok('a DIFFERENT game running is not the one on the wall: leave', r.went === '/tv?venue=test-charlie');

  r = screenRig(); r.api.setIds('sess-1', 'game-1'); r.now = 0; r.api.noteHost();
  r.answer = { status: 404, body: { error: 'Session not found' } };
  r.now = 120000; r.api.tick(); drainMicrotasks();
  ok('a session that no longer exists: leave', r.went === '/tv?venue=test-charlie');

  r = screenRig(); r.api.setIds('sess-1', 'game-1'); r.now = 0; r.api.noteHost();
  r.answer = null;   // the Worker is down
  r.now = 120000; r.api.tick(); drainMicrotasks();
  ok('no answer at all never clears the wall', r.went === null);

  r = screenRig(); r.now = 0; r.api.noteHost();   // a screen that never heard the session
  r.answer = { status: 200, body: { exists: true, live: false } };
  r.now = 120000; r.api.tick(); drainMicrotasks();
  ok('without a session id it asks /play/live, and "nothing on" leaves', /\/play\/live\?code=CODE$/.test(r.asked[0] || '') && r.went === '/tv?venue=test-charlie');

  ok('the screen learns the session from the console', /if\(typeof m\.session_id==="string" && m\.session_id\) _sessionId=m\.session_id;/.test(MSCREEN));
  ok('and the game from started/state', /if\(typeof m\.game_id==="string" && m\.game_id && \(m\.t==="started" \|\| m\.t==="state"\)\) _gameId=m\.game_id;/.test(MSCREEN));
})();

/* ---------- 3. the phone keeps its marks ---------- */
print('\n== 3. a musical phone keeps its marks through a reload ==');
(function () {
  var src = lift(MPLAY, 'markKey', 'play') + lift(MPLAY, 'saveMarks', 'play') + lift(MPLAY, 'loadMarks', 'play');
  var LS = {};
  function phone() {
    var P = { room: 'ROOM1', gameId: '', cardNo: null, daubs: { 12: true } };
    var api = (new Function('P', 'localStorage', 'location', src + ' return { save:saveMarks, load:loadMarks };'))(P,
      { getItem: function (k) { return k in LS ? LS[k] : null; }, setItem: function (k, v) { LS[k] = String(v); } },
      { search: '?room=ROOM1' });
    return { P: P, api: api };
  }
  var a = phone();
  a.P.gameId = 'g1'; a.P.cardNo = 7; a.P.daubs[0] = true; a.P.daubs[6] = true; a.api.save();
  var b = phone();                         // the page reloaded
  b.P.gameId = 'g1'; b.P.cardNo = 7; b.api.load();
  ok('after a reload the same card comes back with its marks', b.P.daubs[0] === true && b.P.daubs[6] === true && b.P.daubs[12] === true);
  delete b.P.daubs[6]; b.api.save();
  var c = phone(); c.P.gameId = 'g1'; c.P.cardNo = 7; c.api.load();
  ok('an unmarked square stays unmarked', c.P.daubs[0] === true && !c.P.daubs[6]);
  var d = phone(); d.P.gameId = 'g2'; d.P.cardNo = 7; d.api.load();
  ok('a new game never inherits the old marks', !d.P.daubs[0]);
  var e = phone(); e.P.gameId = 'g1'; e.P.cardNo = 8; e.api.load();
  ok('nor does a different card', !e.P.daubs[0]);
  ok('the card load restores them', /P\.cardNo=r\.card_no;\s*\n\s*loadMarks\(\);/.test(MPLAY));
  ok('a tap saves them', /cell\.classList\.add\("daub"\); \}\s*\n\s*saveMarks\(\);/.test(MPLAY));
})();

/* ---------- 4. Play next: a fumble is refused, a deliberate tap is asked ---------- */
print('\n== 4. Play next: a double tap is refused, a deliberate tap four seconds in is not lost ==');
(function () {
  var clock = 0, intervals = [];
  var doc = {};
  var win = {};
  (new Function('window', 'document', 'Date', 'setInterval', 'clearInterval', HOLD))(win,
    { getElementById: function (id) { return doc[id] || null; } },
    { now: function () { return clock; } },
    function (fn) { intervals.push(fn); return intervals.length; }, function () {});
  var VP_HOLD = win.VP_HOLD;
  ok('vp-hold exposes soft()', typeof VP_HOLD.soft === 'function');
  var btn = { id: 'playNextBtn', disabled: false, textContent: 'Play song' }; doc.playNextBtn = btn;
  var played = [], asked = [], answer = true;
  var G = { status: 'running', qIdx: -1, queue: [0, 1, 2, 3, 4, 5], played: {}, nowSong: null,
            songs: [{ title: 'A', previewUrl: 'a.m4a' }, { title: 'B', previewUrl: 'b.m4a' }, { title: 'C', previewUrl: 'c.m4a' },
                    { title: 'D', previewUrl: 'd.m4a' }, { title: 'E', previewUrl: 'e.m4a' }, { title: 'F', previewUrl: 'f.m4a' }] };
  var pending = null;   // set: vpAsk holds its answer until answerNow(), the way the real page waits for a tap
  var src = 'var SONG_HOLD_SECONDS=20, NO_CLIP_HOLD_SECONDS=1.2;' +
    MHOST.slice(MHOST.indexOf('var SKIP_ASK_SECONDS='), MHOST.indexOf('function holdLabel(')) +
    lift(MHOST, 'holdLabel', 'musical host') + lift(MHOST, 'playNext', 'musical host');
  var playNext = (new Function('$', 'VP_HOLD', 'G', 'vpAsk', 'songKey', 'playSong', 'syncPlayBtn', 'clearErrForAction', src + ' return playNext;'))(
    function (id) { return doc[id]; }, VP_HOLD, G,
    function (q) { asked.push(q); var a = answer;
      if (pending) { var held = { q: q, f: null }; pending.push(held); return { then: function (f) { held.f = f; } }; }
      return { then: function (f) { f(a); } }; }, function (s) { return s.title; },
    function (s) { played.push(s.title); G.played[s.title] = true; G.nowSong = s; }, function () {}, function () {});
  function tick() { intervals.forEach(function (f) { f(); }); }
  playNext(); tick();
  ok('the first tap plays a song and holds', played.join() === 'A' && VP_HOLD.busy(btn) && btn.disabled === true);
  clock += 300; tick(); playNext();
  ok('a double tap 0.3 seconds later is refused outright, no question', played.join() === 'A' && asked.length === 0);
  clock += 3700; tick();
  ok('four seconds in the button is awake again and says it can skip', btn.disabled === false && /tap to skip/.test(btn.textContent), btn.textContent);
  answer = false; playNext();
  ok('a deliberate tap asks before skipping the song on air', asked.length === 1 && /Skip "A"/.test(asked[0]) && played.join() === 'A');
  answer = true; playNext();
  ok('and plays the next song when the host says yes', played.join() === 'A,B', played.join());
  ok('the new song is held again', VP_HOLD.busy(btn) === true);
  ok('both hold paths pass the skip window', (MHOST.match(/SKIP_ASK_SECONDS\);/g) || []).length === 2);
  /* Live play test, 24 Oct 2026: 32 "Skip ...?" questions piled up from repeated taps, and each OK
     skipped another song. One question at a time, naming the song that is on. */
  clock += 4000; tick();
  pending = []; asked.length = 0;
  for (var t = 0; t < 6; t++) playNext();
  ok('six taps on "tap to skip" open ONE question, not six', asked.length === 1 && pending.length === 1, asked.length);
  ok('and it names the song that is on now', /Skip "B"/.test(asked[0]), asked[0]);
  pending[0].f(true);
  ok('one OK skips exactly one song', played.join() === 'A,B,C', played.join());
  clock += 4000; tick();
  pending = []; asked.length = 0;
  playNext();
  ok('CONTROL: once answered, the next deliberate tap asks again, about the new song', asked.length === 1 && /Skip "C"/.test(asked[0]), asked);
  var stale = pending[0]; pending = null;
  VP_HOLD.release(btn); playNext(); tick();   // the hold ran out and the host moved on with the question still up
  clock += 4000; tick();                      // D is on and past its skip window, so an OK would be obeyed
  stale.f(true);
  ok('an OK to a question about a song that has already gone skips nothing more', played.join() === 'A,B,C,D', played.join());
  // Bingo passes no window: its 5 second hold is unchanged.
  var bb = { id: 'nextBtn', disabled: false, textContent: '' }; doc.nextBtn = bb;
  VP_HOLD.hold(bb, 5, null, null); clock += 3000; tick();
  ok('a hold with no skip window (bingo) stays disabled the whole time', bb.disabled === true && VP_HOLD.soft(bb) === false);
})();

/* ---------- 5. nothing on the musical wall sits under the JOIN NOW card ---------- */
print('\n== 5. the musical wall keeps clear of the JOIN NOW card, the corner mark and the logo ==');
(function () {
  ok('the JOIN NOW card is a vp-fit keep-out', /<div class="tv-join hidden" id="tvJoinCorner" data-fit-avoid>/.test(MSCREEN));
  ok('so is the VenuePlay corner, by what its children paint', /<div class="tv-corner" data-fit-avoid="kids">/.test(MSCREEN));
  // The logo is made at run time: run the real paintVenueLogo and look at what it made.
  var made = null, document = { getElementById: function () { return null; },
    createElement: function () { made = { style: {}, attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } }; return made; },
    body: { appendChild: function () {} } };
  eval(lift(MSCREEN, 'paintVenueLogo', 'musical/screen.html'));
  paintVenueLogo('/logos/x.png');
  ok('the venue logo the screen paints is a keep-out', !!made && made.attrs['data-fit-avoid'] === '', made && JSON.stringify(made.attrs));
  // The strip must not be the flex item that gives, or it hides its own rows and vp-fit measures a wall that "fits".
  var css = MSCREEN.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the played strip is never squashed (it hid its last rows at 1280x720)', /#tvRun \.pboard\{flex-shrink:0\}/.test(css));
  ok('the screen loads the shared vp-fit', MSCREEN.indexOf('<script src="/app/vp-fit.js"></script>') > 0);
})();

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
