/* THE CONSOLE SIDE OF "A CLOSED TAB MUST NOT LEAVE A GHOST, AND A TAKEOVER MUST NOT KICK THE ROOM"
   (Dean's live play, 6 Nov 2026, findings F, G, I, C, C2, D). Each is RUN from the shipped files against
   stubs for the browser; none is a text search.

     1. /app/vp-session.js: a night another page of this browser is running is not closed by this page's
        sign-out; one nobody has stamped for a minute is; a close that was waiting is sent (and answered)
        BEFORE the "already open on another device" question goes to the server; a close flagged but
        cancelled by a reopen is not sent.
     2. the bingo console tells the server "bingo" again when it reuses a session it remembers (finding F).
     3. the musical phone re-joins when the Worker says its night has ended (finding G).
     4. the musical TV says whether it can play sound, from the lobby and on every reply, and calls a clip
        that never moved blocked (findings C, C2); the console puts the sound on its own speaker at once
        and puts it back when the TV recovers.
     5. the musical TV's bottom left says how many songs have played, not "Song N" (finding D).

   Run: jsc tools/test-session-lifecycle-client.js */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 2000) return t; } catch (e) {} }
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
function settle() { for (var i = 0; i < 40; i++) drainMicrotasks(); }

var SESSION = find('venueplay/app/vp-session.js');
var BINGO_CONSOLE = find('venueplay/app/index.html');
var MPLAY = find('venueplay/app/musical/play.html');
var MHOST = find('venueplay/app/musical/host.html');
var MSCREEN = find('venueplay/app/musical/screen.html');

print('\n== 1. vp-session.js: who is holding a night, and the ghost "other device" ==');
function world() {
  var W = { store: {}, fetched: [], now: 1000000, uid: 'u1', live: { live: false }, closeStatus: 200, order: [] };
  var src = ['readOpenSessions', 'writeOpenSessions', 'currentUid', 'noteOpenSession', 'stampMine', 'heldByAnotherPage',
             'closeOpenSessions', 'closeSession', 'retryPendingCloses', 'drainPendingCloses', 'confirmTakeoverOnce']
    .map(function (n) { return lift(SESSION, n, 'vp-session.js'); }).join('\n');
  var f = new Function('W', 'var OPEN_KEY="vpOpenSessions", LEGACY_KEY="vpOpenSession", GAME_API="https://w", HELD_FOR_MS=60000, STAMP_EVERY_MS=20000;' +
    'var _mine={}, _stampIv=null, _ctx={ user:{ id:W.uid } };' +
    'var localStorage={ getItem:function(k){ return k in W.store ? W.store[k] : null; }, setItem:function(k,v){ W.store[k]=String(v); }, removeItem:function(k){ delete W.store[k]; } };' +
    'var Date={ now:function(){ return W.now; } };' +
    'function setInterval(){ return 1; } function clearInterval(){} function setTimeout(f){ return 1; } function clearTimeout(){}' +
    'function getClient(){ return { auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ access_token:"t", user:{ id:W.uid } } } }); } } }; }' +
    'function venueCode(){ return "CODE12"; }' +
    'function askOnPage(){ W.order.push("asked"); return Promise.resolve(true); }' +
    'function fetch(u, o){ W.fetched.push(u.replace("https://w","")); W.order.push(u.indexOf("/session/close")>=0 ? "close" : "live");' +
    '  if(u.indexOf("/session/close")>=0) return Promise.resolve({ status:W.closeStatus });' +
    '  return Promise.resolve({ ok:true, json:function(){ return Promise.resolve(W.live); } }); }' +
    src + ';return { note:noteOpenSession, closeAll:closeOpenSessions, closeOne:closeSession, retry:retryPendingCloses, ask:confirmTakeoverOnce, list:readOpenSessions, otherPage:function(){ _mine={}; }, mine:function(){ return _mine; } };');
  W.api = f(W);
  return W;
}
(function () {
  var W = world();
  W.api.note('S1', 'v1'); settle();
  W.api.otherPage();                       // the same browser, another tab: it did not note S1 itself
  W.api.closeAll(); settle();
  ok('a night another page stamped a moment ago is NOT closed by this page\'s sign-out', W.fetched.length === 0, JSON.stringify(W.fetched));
  W.now += 61000;                          // nobody has stamped it for a minute
  W.api.closeAll(); settle();
  ok('a night nobody has stamped for a minute is closed as before', W.fetched.length === 1 && /session\/close/.test(W.fetched[0]), JSON.stringify(W.fetched));
})();
(function () {
  var W = world();
  W.api.note('S2', 'v1'); settle();
  W.api.closeAll(); settle();
  ok('the page that holds a night closes it itself on sign-out', W.fetched.length === 1);
})();
(function () {
  var W = world();
  W.api.note('S3', 'v1'); settle();
  W.api.otherPage();
  W.api.note('S3', 'v1');                  // the takeover tab opens the same night: it is now this page's
  W.api.closeAll(); settle();
  ok('the tab that took the night over closes it itself on its own sign-out', W.fetched.length === 1);
  // flagged closing, then re-opened before the sweep's token arrives
  var W2 = world();
  W2.api.note('S4', 'v1'); settle();
  var l = W2.api.list(); l[0].closing = true; W2.store['vpOpenSessions'] = JSON.stringify(l);
  W2.api.retry();                          // starts: token is requested, not yet answered
  W2.api.note('S4', 'v1');                 // the lobby is taken over / reused: noteOpenSession clears the flag
  settle();
  ok('a close that was waiting is NOT sent once the night has been opened again', W2.fetched.length === 0, JSON.stringify(W2.fetched));
})();
(function () {
  var W = world();
  W.api.note('S5', 'v1'); settle();
  var l = W.api.list(); l[0].closing = true; W.store['vpOpenSessions'] = JSON.stringify(l);
  W.api.otherPage();
  W.live = { live: true, format: 'trivia' };
  var verdict = null; W.api.ask('test-alpha').then(function (v) { verdict = v; });
  settle();
  ok('the close that was waiting goes out BEFORE the server is asked whether another device has a night open', W.order[0] === 'close' && W.order[1] === 'live', W.order.join());
  ok('and, the ghost gone, the question is still asked only if the server still says live', W.order.indexOf('asked') === 2, W.order.join());
  var W3 = world();
  W3.live = { live: false };
  var v3 = null; W3.api.ask('test-alpha').then(function (v) { v3 = v; }); settle();
  ok('nothing waiting and nothing live: straight in with no question', v3 === true && W3.order.join() === 'live', W3.order.join());
})();

print('\n== 2. the bingo console says "bingo" again on a session it remembers (finding F) ==');
(function () {
  var posted = [], saved = 0, adopted = null;
  var G = { sessionId: 'S-OLD', joinCode: 'ACDEFG', caller: false };
  var __ctx = { venue: { id: 'v1' } };
  var VP = { gameApiPost: function (p, b) { posted.push(p + ':' + b.format); return Promise.resolve({ session_id: 'S-NEW', join_code: 'ACDEFG' }); }, noteOpenSession: function (id) { adopted = id; } };
  var window = { VP: VP };
  function sendState() {} function seatSoon() {} function saveGame() { saved++; } function renderJoinCounts() {} function bingoRoad() { return 'supabase'; }
  eval(lift(BINGO_CONSOLE, 'openServerSession', 'index.html'));
  openServerSession(); settle();
  ok('a remembered session is told "bingo" to the server again', posted.join() === '/session:bingo', posted.join());
  ok('and a different session coming back is adopted, noted and saved', G.sessionId === 'S-NEW' && adopted === 'S-NEW' && saved >= 1, JSON.stringify(G));
  posted.length = 0; G.sessionId = 'S-SAME';
  VP.gameApiPost = function (p, b) { posted.push(p); return Promise.resolve({ session_id: 'S-SAME', join_code: 'ACDEFG' }); };
  saved = 0; openServerSession(); settle();
  ok('the same session back changes nothing', G.sessionId === 'S-SAME' && saved === 0);
})();

print('\n== 3. the musical phone re-joins when its night has ended (finding G) ==');
(function () {
  var P = { token: 'tok', joined: true, room: 'ACDEFG' }, dropped = 0, rejoined = 0, cards = 0, _clock = 100000;
  var Date = { now: function () { return _clock; } };
  function dropStaleJoin() { dropped++; P.token = ''; }
  function rejoinNow() { rejoined++; P.token = 'fresh'; return Promise.resolve(); }
  function playerGet() { cards++; return Promise.resolve(cards === 1 ? { game: null, stale: true } : { game: null }); }
  function route() {} function loadMarks() {} function autoDaub() {}
  var PAT_FROM_WORKER = {};
  eval('var _staleAt=0;' + lift(MPLAY, 'fetchCard', 'musical/play.html'));
  fetchCard(); settle();
  ok('stale:true drops the dead night, re-joins under the same device and asks for the card again', dropped === 1 && rejoined === 1 && cards === 2, [dropped, rejoined, cards].join());
  cards = 0; dropped = 0; rejoined = 0; P.token = 'tok';
  playerGet = function () { cards++; return Promise.resolve({ game: null, stale: true }); };
  fetchCard(); settle(); fetchCard(); settle();
  ok('but never in a loop: a second stale inside twenty seconds waits', dropped === 0 && rejoined === 0, [dropped, rejoined].join());
  _clock += 21000; fetchCard(); settle();
  ok('and after twenty seconds it tries again', dropped === 1 && rejoined === 1, [dropped, rejoined].join());
})();

print('\n== 4. the TV says whether it can play sound, and the console acts at once (findings C, C2) ==');
(function () {
  var sent = [], warned = false;
  var navigator = { getAutoplayPolicy: function () { return 'disallowed'; } };
  var _audioWarned = false, _audioHeard = false;
  function tvSend(o) { sent.push(o); }
  eval(lift(MSCREEN, 'audioState', 'musical/screen.html'));
  ok('a browser that says autoplay is disallowed: the TV reports blocked BEFORE song 1', audioState() === 'blocked');
  navigator = { getAutoplayPolicy: function () { return 'allowed'; } };
  ok('allowed and nothing played yet: unknown, not a false "ok"', audioState() === 'unknown');
  _audioHeard = true; ok('a clip that really played: ok', audioState() === 'ok');
  _audioWarned = true; ok('a warned screen stays blocked in every reply', audioState() === 'blocked');
  ok('every host-triggered tv_here carries the sound state', /tvSend\(\{ t:"tv_here", audio:audioState\(\) \}\)/.test(MSCREEN) && /tvSend\(\{ t:"tv_here", hello:true, audio:\(typeof audioState==="function" \? audioState\(\) : "unknown"\) \}\)/.test(MSCREEN));
})();
(function () {
  var errs = [], kids = [], note = { cls: { hidden: true }, _t: '' };
  Object.defineProperty(note, 'textContent', { get: function () { return note._t + kids.map(function (k) { return k.textContent || ''; }).join(' '); }, set: function (v) { note._t = String(v); kids = []; } });
  note.classList = { add: function (c) { note.cls[c] = true; }, remove: function (c) { delete note.cls[c]; } };
  note.appendChild = function (k) { kids.push(k); return k; };
  var btn = { innerHTML: '' };
  var G = { hostMonitor: false, tvLastSeen: 1, status: 'running' };
  var audio = { muted: true, paused: false, src: '' };
  var _tvAudio = 'unknown', _autoMonitor = false, _soundAsked = false, _audioErrShown = false;
  function clearHostError() {}
  var document = { createElement: function () { var h = {}; return { style: {}, addEventListener: function (e, f) { h[e] = f; }, click: function () { h.click(); } }; },
                   createTextNode: function (t) { return { textContent: t }; } };
  function $(id) { return id === 'tvAudioNote' ? note : btn; }
  function soundIsOnlyHere() { return false; }
  var _ss = {}, sessionStorage = { getItem: function(k){ return Object.prototype.hasOwnProperty.call(_ss, k) ? _ss[k] : null; }, setItem: function(k, v){ _ss[k] = String(v); }, removeItem: function(k){ delete _ss[k]; } };
  function hostApplyFade() {}   // the Room volume graph is not built here
  function hostFadeLevel() { return 1; }
  function syncMonitorBtn() { btn.innerHTML = G.hostMonitor ? 'playing here' : 'on the TV'; }
  var _tvApp = '';   // a browser TV, not the venueplay TV app (INBOX 282.2)
  eval(['tvNoSoundWords', 'tvSoundYes', 'tvSoundNo', 'askTvSound', 'noteTvAudio', 'hostSetMute', 'hostTvOnlyChosen'].map(function (n) { return lift(MHOST, n, 'musical/host.html'); }).join('\n'));
  ok('host.html still defines hostSetMute and hostTvOnlyChosen (the console mutes the element AND the Room volume gain; INBOX 366), so the lifted code runs the real ones', /function hostSetMute\(/.test(MHOST) && /function hostTvOnlyChosen\(/.test(MHOST));
  noteTvAudio('blocked');
  var yes = kids.filter(function (k) { return k.id === 'tvSoundYes'; })[0], no = kids.filter(function (k) { return k.id === 'tvSoundNo'; })[0];
  ok('blocked: the console ASKS first (Dean, 6 Nov 13:10), "The TV can\'t play sound. Play the songs on this device?" Yes / No, and stays quiet until answered',
     G.hostMonitor === false && audio.muted === true && !note.cls.hidden && /The TV has no sound yet\. Click once on the TV screen to turn its sound on\. Or play the songs on this device\?/.test(note.textContent) && !!yes && !!no && yes.textContent === 'Yes' && no.textContent === 'No', JSON.stringify([G, note.textContent]));
  no.click();
  ok('No: this device stays quiet, and the bar says how to fix the TV', G.hostMonitor === false && audio.muted === true && /Click once on the TV screen to turn its sound on/.test(note.textContent));
  noteTvAudio('ok'); noteTvAudio('blocked');
  yes = kids.filter(function (k) { return k.id === 'tvSoundYes'; })[0];
  yes.click();
  ok('Yes: this device plays the songs, and the bar says so', G.hostMonitor === true && audio.muted === false && /coming out of THIS device/.test(note.textContent), JSON.stringify([G, note.textContent]));
  noteTvAudio('ok');
  ok('the TV recovers: the host speaker goes quiet again and the bar goes', G.hostMonitor === false && audio.muted === true && note.cls.hidden === true);
  G.hostMonitor = true; noteTvAudio('blocked');
  ok('a host already playing here is not asked, just told', /coming out of this device/.test(note.textContent) && kids.length === 0);
  noteTvAudio('ok');
  ok('a switch the host turned on themselves is left on', G.hostMonitor === true);
  ok('the button names the device when the TV is blocked', /Playing on THIS device only, the TV is blocked/.test(MHOST) && /noteTvAudio\(m\.audio\)/.test(MHOST));
  ok('and the bar markup exists on the console', /id="tvAudioNote"/.test(MHOST));
})();
(function () {
  var timers = [], warned = 0, paused = true, ct = 0;
  var clipAudio = { crossOrigin: '', src: '', paused: true, currentTime: 0, volume: 1, getAttribute: function () { return clipAudio.src; }, play: function () { return { then: function () { return { catch: function () {} }; } }; } };
  var _ac2 = null; function setTimeout(f, ms) { timers.push([f, ms]); } function audioOk() {} function audioBlocked() { warned++; } function buildBoost() {}
  var _clipFade = null, _hostPaused = false;   // no /app/vp-fade.js here: the clip plays as it always did (INBOX 260 moved the start into startClip)
  var _clipSeq = 0, _audioHeardSrc = '', TV_APP = '', refused = [];
  function playRefused(e) { refused.push(e); }
  eval(['playClip', 'startClip'].map(function (n) { return lift(MSCREEN, n, 'musical/screen.html'); }).join('\n'));
  playClip('https://x/a.m4a');
  var t = timers.filter(function (x) { return x[1] === 3000; })[0];
  ok('a clip is looked at again after three seconds', !!t, JSON.stringify(timers.map(function (x) { return x[1]; })));
  if (t) { t[0](); ok('a play() that left the clip sitting PAUSED with nothing heard is called blocked on a browser TV', warned === 1, String(warned)); }
  /* INBOX 282.2 (12 Nov 2026): a clip still loading after three seconds was called blocked while the Kogan played it. */
  warned = 0; timers.length = 0; clipAudio.paused = false; clipAudio.currentTime = 0;
  playClip('https://x/b.m4a');
  t = timers.filter(function (x) { return x[1] === 3000; })[0];
  if (t) t[0]();
  ok('a clip asked to play and still LOADING (not paused, at 0:00) is not blocked: it is looked at again', warned === 0 && timers.length === 2, [warned, timers.length].join());
  warned = 0; timers.length = 0; clipAudio.paused = true; TV_APP = 'tizen';
  playClip('https://x/c.m4a');
  t = timers.filter(function (x) { return x[1] === 3000; })[0];
  if (t) t[0]();
  ok('in the venueplay TV app the timer never says blocked (no click bar in an app)', warned === 0, String(warned));
})();

print('\n== 5. the TV\'s bottom left counts songs played (finding D) ==');
ok('"N songs played", not "Song N", on the left, and it is the ONLY count on the wall: no dashed slot (11 Nov), the "+N" chip is gone (Dean, 6 Nov 13:10)',
   /no\.textContent = all\.length>0 \? \(all\.length\+" song"/.test(MSCREEN) && /nx\.classList\.toggle\("hidden", true\); nx\.textContent="";/.test(MSCREEN) && /more\.classList\.toggle\("hidden", true\); more\.textContent="";/.test(MSCREEN) && !/"Song "\+total/.test(MSCREEN));

print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' client lifecycle checks failed');
