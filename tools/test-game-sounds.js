/* GAME SOUNDS, PER GAME (Dean, 12 Nov 2026, INBOX 316 and 317; built 13 Nov 2026), RUN AND NOT WORD-SEARCHED.

   venueplay/app/vp-celebrate.js runs here in a small fake page with a fake Audio, and the game Worker's own key list
   (GAME_PREFS_KEYS, lifted out of venueplay-game.js and run) cleans what a console saves:

     1. THE SLOTS: timesup, podium and answerup hold Dean's Mixkit files, every file is on disk and small; the two paid
        picks (rafflesuspense, crowdcheer) are named EMPTY slots and play nothing
     2. THE SWITCH: nothing plays until the game's "Game sounds" is told ON; OFF again silences it; one game's switch
        never turns another game on; a non-boolean never turns it on (absent means OFF, so no existing venue changes)
     3. THE OLD RULES STILL HOLD: a phone needs a tap and the mute button; a TV (wall) needs neither; a demo page is silent
     4. THE SETTING: trivia, musical bingo and bingo each keep a boolean "sounds" through the Worker; junk is dropped;
        the shared settings panel lists "Game sounds" for those three, default Off, with a "?" line
     5. TODAY'S VENUES: no default anywhere says ON

   Run from the repo root:  jsc tools/test-game-sounds.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)) : '')); } }
function section(t) { print(''); print(t); }

var CEL = readFile('venueplay/app/vp-celebrate.js');
function page(demo, tapped) {
  var played = [], listeners = {};
  var doc = { documentElement: { getAttribute: function (k) { return (k === 'data-vp-demo' && demo) ? '1' : null; } }, body: {},
              addEventListener: function (ev, fn) { listeners[ev] = fn; }, removeEventListener: function () {} };
  function Audio() { var self = this; this.src = ''; this.volume = 1; this.play = function () { if (self.src.indexOf('data:') !== 0) played.push({ src: self.src, volume: self.volume }); return { catch: function () {} }; }; }
  var store = {};
  var root = { document: doc, Audio: Audio, localStorage: { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = String(v); } }, navigator: {} };
  (new Function('window', CEL + ';'))(root);
  if (tapped && listeners.pointerdown) listeners.pointerdown({});
  return { C: root.VPCelebrate, played: played, store: store };
}

section('1. THE SLOTS');
var P0 = page(false, false), S = P0.C.SOUNDS;
['timesup', 'podium', 'answerup'].forEach(function (k) {
  var f = S[k].replace(/^\//, '');
  var ok = true, size = 0; try { var d = readFile('venueplay/' + f, 'binary'); size = d.length; } catch (e) { ok = false; }
  check(k + ' is filled with a file on disk, under 250 KB (' + S[k] + ')', S[k].indexOf('/app/sounds/') === 0 && ok && size > 1000 && size < 250000, [S[k], size]);
});
check('rafflesuspense and crowdcheer are named, empty slots for the paid picks', S.hasOwnProperty('rafflesuspense') && S.rafflesuspense === '' && S.hasOwnProperty('crowdcheer') && S.crowdcheer === '');
var P1 = page(false, true); P1.C.setGameSounds('trivia', true); P1.C.setGameSounds('raffle', true); P1.C.setGameSounds('bingo', true);
check('an empty slot plays nothing even with its game ON', P1.C.sound('rafflesuspense') === false && P1.C.sound('crowdcheer') === false && P1.played.length === 0, P1.played);
check('an unknown slot plays nothing', P1.C.sound('nope') === false);

section('2. THE PER-GAME SWITCH');
var P2 = page(false, true);
check('nothing plays before anything says ON (a venue that never touched it)', P2.C.sound('timesup') === false && P2.C.sound('podium') === false && P2.played.length === 0, P2.played);
P2.C.setGameSounds('trivia', true);
check('trivia ON: time\'s up plays its file', P2.C.sound('timesup') === true && P2.played.length === 1 && P2.played[0].src === '/app/sounds/times-up.mp3', P2.played);
check('and the podium and the answer chime', P2.C.sound('podium') === true && P2.C.sound('answerup', { wall: true }) === true && P2.played[1].src === '/app/sounds/podium.mp3' && P2.played[2].src === '/app/sounds/answer-up.mp3', P2.played);
check('each plays at a moderate volume, never full scale', P2.played.every(function (p) { return p.volume > 0 && p.volume < 1; }), P2.played);
P2.C.setGameSounds('trivia', false);
var n2 = P2.played.length;
check('trivia OFF again: silent', P2.C.sound('timesup') === false && P2.C.sound('podium') === false && P2.played.length === n2);
P2.C.setGameSounds('trivia', 'yes'); P2.C.setGameSounds('trivia', 1);
check('anything that is not true turns it OFF, never on', P2.C.gameSounds('trivia') === false && P2.C.sound('timesup') === false);
P2.C.setGameSounds('bingo', true); P2.C.setGameSounds('musical', true);
check('another game ON never turns trivia on', P2.C.gameSounds('trivia') === false && P2.C.sound('timesup') === false);

section('3. THE OLD RULES STILL HOLD');
var P3 = page(false, false); P3.C.setGameSounds('trivia', true);
check('a phone that has not been tapped stays silent', P3.C.sound('timesup') === false);
check('a TV (wall) needs no tap', P3.C.sound('answerup', { wall: true }) === true);
var P4 = page(false, true); P4.C.setGameSounds('trivia', true); P4.C.setMuted(true);
check('a muted phone stays silent', P4.C.sound('timesup') === false && P4.C.sound('podium') === false);
var P5 = page(true, true); P5.C.setGameSounds('trivia', true);
check('a demo page is never heard', P5.C.sound('timesup') === false && P5.C.sound('answerup', { wall: true }) === false && P5.played.length === 0);

section('4. THE SETTING, THROUGH THE WORKER AND THE PANEL');
var GAMEW = readFile('venueplay-backend/worker/venueplay-game.js');
var lift = GAMEW.slice(GAMEW.indexOf('const GAME_PREFS_MAX_CHARS'), GAMEW.indexOf('async function handleGamePrefs'));
var WK = (new Function(lift + '; return { KEYS: GAME_PREFS_KEYS, clean: cleanGamePrefs };'))();
['trivia', 'musical', 'bingo'].forEach(function (g) {
  var on = WK.clean(g, { sounds: true }), off = WK.clean(g, { sounds: false }), junk = WK.clean(g, { sounds: 'yes' }), junk2 = WK.clean(g, { sounds: 1 });
  check(g + ': the Worker keeps sounds true and false', on.sounds === true && off.sounds === false, [on, off]);
  check(g + ': and drops anything that is not a boolean', !('sounds' in junk) && !('sounds' in junk2), [junk, junk2]);
});
['raffle', 'members'].forEach(function (g) { check(g + ' keeps no sounds key yet (no slot is wired to it)', !(WK.KEYS[g] && WK.KEYS[g].sounds)); });
var HELP = readFile('venueplay/app/vp-setup-help.js');
var H = (new Function('window', 'var root = window; ' + HELP + '; return window.VPSetupHelp || root.VPSetupHelp;'))({});
if (!H) { H = null; }
check('the shared settings panel loads', !!H && !!H.GAMES, typeof H);
if (H && H.GAMES) {
  ['trivia', 'musical', 'bingo'].forEach(function (g) {
    var game = H.GAMES.filter(function (x) { return x.key === g; })[0], st = game && game.settings.filter(function (s) { return s.key === 'sounds'; })[0];
    check(g + ' lists "Game sounds", an On/Off switch, default Off, with a help line', !!st && st.label === 'Game sounds' && st.kind === 'seg' && st.def === false && !!st.help, st);
  });
  check('today\'s defaults say nothing is ON (no sounds key is true)', ['trivia', 'musical', 'bingo', 'raffles', 'members'].every(function (g) { return H.defaults(g).sounds !== true; }));
  check('the defaults pass the Worker\'s own cleaning to OFF for every game that lists it', ['trivia', 'musical', 'bingo'].every(function (g) { return H.defaults(g).sounds === false && WK.clean(g, H.defaults(g)).sounds === false; }));
}

section('5. WIRED INTO THE PAGES');
var TRI = readFile('venueplay/app/trivia/host.html'), TV = readFile('venueplay/app/trivia/screen.html'), PH = readFile('venueplay/app/trivia/play.html');
check('the trivia console has the Game sounds switch and saves and applies it', /id="cfgSounds"/.test(TRI) && /p\.sounds\s*=\s*G\.sounds\s*===\s*true/.test(TRI) && /typeof p\.sounds\s*===\s*"boolean"/.test(TRI));
check('every question, start, lobby and podium the console sends carries the switch', (TRI.match(/sounds:G\.sounds===true/g) || []).length === 9);
check('the TV and the phone take the switch from the host\'s messages', /setGameSounds\("trivia", m\.sounds\)/.test(TV) && /setGameSounds\("trivia", m\.sounds\)/.test(PH));

print(''); print(bad ? ('FAIL ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error('failed');
