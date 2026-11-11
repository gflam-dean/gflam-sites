/* MUSICAL BINGO, DEAN'S LIVE PLAY ON THE MINI BAR, 11 NOV 2026 (INBOX 252), RUN, not read.

   1. Paper cards asked twice: he printed 4, then Start game asked "Paper cards tonight?" again. The number printed
      is the number playing until he changes it (Change under Print paper cards); Start game and New game never ask.
   2. After Start the console landed halfway down the page: it lands at the top now (room code, Now playing).
   4. The TV's LISTEN screen showed the song twice (the count bottom left and an empty dashed box on the right):
      no dashed slot any more; the strip is only the songs already played.
   8. A browser TV that blocks sound: the TV itself says "Click anywhere on this screen to turn the sound on" and
      keeps saying it until the sound is on; one click plays the song that is on. The console says what to do in
      plain words ("Click once on the TV screen to turn its sound on, or tap Yes ..."), not "autoplay is blocked".

   Every function here is lifted out of the page that ships and run.

   Run: jsc tools/test-musical-live-11nov.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || why === undefined ? "" : "   saw: " + why)); if(!c) bad++; }
var HOST = readFile("venueplay/app/musical/host.html");
var SCREEN = readFile("venueplay/app/musical/screen.html");
function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("cannot find " + name);
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error("unclosed " + name);
}
function fakeStore(){ var m = {}; return { getItem: function(k){ return k in m ? m[k] : null; }, setItem: function(k, v){ m[k] = String(v); }, removeItem: function(k){ delete m[k]; }, _m: m }; }

print("\n1. PAPER CARDS ARE ASKED ONCE");
(function(){
  var fns = ["paperKey", "paperRead", "paperPrinted", "savePaperPrinted", "paperPlaying", "savePaperPlaying"].map(function(n){ return grab(n, HOST); }).join("\n");
  var G = { sessionId: "s1" }, localStorage = fakeStore();
  var api = new Function("G", "localStorage", fns + "\nreturn { print: savePaperPrinted, printed: paperPrinted, playing: paperPlaying, set: savePaperPlaying };")(G, localStorage);
  api.print(4, "80s");
  pass("he prints 4: 4 are playing, without being asked again", api.printed() === 4 && api.playing() === 4, api.playing());
  api.set(2);
  pass("Change to 2: 2 are playing, 4 still printed", api.playing() === 2 && api.printed() === 4, [api.playing(), api.printed()]);
  api.set(0);
  pass("Change to 0 (nobody on paper this game) is kept as 0", api.playing() === 0, api.playing());
  api.set(9);
  pass("never more playing than were printed", api.playing() === 4, api.playing());
  api.print(6, "80s");
  pass("a new print: all of the new cards play until changed", api.playing() === 6 && api.printed() === 6, api.playing());
  G.sessionId = "s2";
  pass("a new night (another session) starts with none", api.printed() === 0 && api.playing() === 0, api.playing());
})();
(function(){
  /* beginRound, the real one, with the Worker and the page around it stood in. */
  var bodies = [], modals = 0, scrolled = [], hosted = [];
  var env = {
    $: function(){ return { disabled: false, textContent: "", classList: { add: function(){}, remove: function(){}, toggle: function(){} } }; },
    G: { sessionId: "s1", pattern: "one", prize: "Meat tray", autoDaub: true, busy: false, status: "lobby" },
    clearErrForAction: function(){}, openSession: function(){ return Promise.resolve(); },
    paperPrinted: function(){ return 4; }, paperPlaying: function(){ return 4; },
    paperModal: function(){ modals++; return Promise.resolve(4); },
    askPaperDeclared: function(){ modals++; return Promise.resolve(4); },
    bcast: function(){}, PAT_TO_WORKER: { one: "one_line" }, playlistPayload: function(){ return { name: "x", songs: [] }; },
    apiPost: function(path, body){ bodies.push([path, body]); return Promise.resolve({ game_id: "g1", songs: [] }); },
    LIB: { byTitleArtist: {}, byTitle: {} }, taKey: function(){ return ""; }, normTitle: function(t){ return t; },
    shuffledQueue: function(){ return []; }, clearClaims: function(){}, playerCount: function(){ return 0; },
    endBtnHold: function(){}, saveMusic: function(){}, stopAudio: function(){}, VP_HOLD: { release: function(){} },
    syncPlayBtn: function(){}, sendState: function(){}, renderConsole: function(){}, hostError: function(m){ hosted.push(m); },
    window: { scrollTo: function(x, y){ scrolled.push([x, y]); } }
  };
  var names = Object.keys(env);
  var src = grab("beginRound", HOST) + "\n" + grab("landAtTop", HOST);
  var run = new Function(names.join(","), src + "\nreturn beginRound;").apply(null, names.map(function(k){ return env[k]; }));
  run(null, "Start game"); drainMicrotasks();
  var g = bodies.filter(function(b){ return b[0] === "/host/game"; })[0];
  pass("Start game with 4 printed: no pop-up at all", modals === 0, modals);
  pass("and the game is started with the 4 paper cards", !!g && g[1].paper_count === 4, JSON.stringify(g));
  pass("the game is running, no error", env.G.status === "running" && hosted.length === 0, [env.G.status, hosted]);

  print("\n2. AFTER START THE CONSOLE IS AT THE TOP");
  pass("Start game lands the page at the top (0,0), where the room code and Now playing are", scrolled.length === 1 && scrolled[0][0] === 0 && scrolled[0][1] === 0, JSON.stringify(scrolled));
  scrolled.length = 0; env.G.status = "lobby";
  env.apiPost = null;
  var run2 = new Function(names.join(","), src + "\nreturn beginRound;").apply(null, names.map(function(k){ return k === "apiPost" ? function(){ return Promise.reject(new Error("Musical bingo runs once a week per venue.")); } : env[k]; }));
  run2(null, "Start game"); drainMicrotasks();
  pass("a Start the Worker refuses does not jump the page (the error bar does its own)", scrolled.length === 0, JSON.stringify(scrolled));
})();
(function(){
  /* The Change control is in the page, under Print paper cards, and renderPaper shows the number playing. */
  pass("the console has a Change control beside \"Playing this game\" under Print paper cards",
       /id="paperPlayRow"[^>]*>Playing this game: <b id="paperPlayN">/.test(HOST) && /id="paperPlayChange">Change<\/button>/.test(HOST));
  var els = {}; function $(id){ return els[id] || (els[id] = { id: id, textContent: "", classList: { _h: {}, toggle: function(c, on){ if(on) this._h[c] = 1; else delete this._h[c]; }, contains: function(c){ return !!this._h[c]; } } }); }
  var G = { sessionId: "s1", status: "lobby" };
  var render = new Function("$", "G", "paperPrinted", "paperPlaying", "paperPrintedNote", "paperPrintedFrom",
    grab("renderPaper", HOST) + "\nreturn renderPaper;")($, G, function(){ return 4; }, function(){ return 3; }, function(){ return ""; }, function(){ return ""; });
  render();
  pass("printed 4, playing 3: the console says \"Playing this game: 3 paper cards\" with Change", !$("paperPlayRow").classList.contains("hidden") && $("paperPlayN").textContent === "3 paper cards", $("paperPlayN").textContent);
  var render0 = new Function("$", "G", "paperPrinted", "paperPlaying", "paperPrintedNote", "paperPrintedFrom",
    grab("renderPaper", HOST) + "\nreturn renderPaper;")($, G, function(){ return 0; }, function(){ return 0; }, function(){ return ""; }, function(){ return ""; });
  render0();
  pass("nothing printed: no \"Playing this game\" line", $("paperPlayRow").classList.contains("hidden"));
  pass("no \"Paper cards tonight\" question left in the console", HOST.indexOf('paperModal("Paper cards tonight"') < 0 && HOST.indexOf("askPaperDeclared()") < 0);
})();

print("\n4. THE TV'S LISTEN SCREEN SAYS THE SONG ONCE");
(function(){
  function el(id){ var c = {}; return { id: id, textContent: "", className: "", children: [], set innerHTML(v){ this.children = []; }, appendChild: function(k){ this.children.push(k); },
    insertBefore: function(){}, classList: { toggle: function(x, on){ if(on) c[x] = 1; else delete c[x]; }, add: function(x){ c[x] = 1; }, contains: function(x){ return !!c[x]; } } }; }
  var E = {}; function $(id){ return E[id] || (E[id] = el(id)); }
  var document = { createElement: function(t){ return el(t); } };
  var src = SCREEN.slice(SCREEN.indexOf("  var TV_BOARD_MAX=5;"), SCREEN.indexOf("  function renderRun(){"));
  var state = { played: [] };
  var api = new Function("$", "document", "state", "var _pendingSong=null;\n" + src + "\nreturn function(p){ _pendingSong=p; renderBoard(); };")($, document, state);
  state.played = ["Song 1"]; api({ title: "Song 1" });
  pass("song 1 on LISTEN: no dashed slot, no count, nothing named (the wall says Listen)", $("tvBoardNext").classList.contains("hidden") && $("tvSongNo").textContent === "" && $("tvBoard").children.length === 0,
       [$("tvBoardNext").classList.contains("hidden"), $("tvBoardNext").textContent, $("tvSongNo").textContent]);
  var s = []; for (var i = 1; i <= 15; i++) s.push("Song " + i);
  state.played = s.slice(); api({ title: "Song 15" });
  var t = $("tvBoard").children;
  pass("song 15 on LISTEN: the last five played on the strip, no dashed slot after them", t.length === 5 && t[4].textContent === "Song 14" && $("tvBoardNext").classList.contains("hidden"), [t.length, $("tvBoardNext").textContent]);
  pass("and \"14 songs played\" bottom left, said once", $("tvSongNo").textContent === "14 songs played", $("tvSongNo").textContent);
  pass("no tile outlined as current while the song is held back", t.every(function(x){ return x.className === "ptok"; }));
})();

print("\n8. A TV THAT BLOCKS SOUND SAYS HOW TO TURN IT ON, AND ONE CLICK DOES");
(function(){
  var body = { kids: [], appendChild: function(k){ this.kids.push(k); k.parentNode = body; } };
  var byId = {};
  var listeners = {};
  var sent = [], timers = [];
  var document = {
    body: body,
    getElementById: function(id){ var k = body.kids.filter(function(x){ return x.id === id; })[0]; return k || null; },
    createElement: function(){ var a = {}; var e = { id: "", textContent: "", setAttribute: function(k, v){ a[k] = v; }, getAttribute: function(k){ return a[k]; },
      remove: function(){ body.kids = body.kids.filter(function(x){ return x !== e; }); } }; return e; },
    addEventListener: function(ev, f){ (listeners[ev] = listeners[ev] || []).push(f); }
  };
  var plays = 0, pauses = 0, playOk = true;
  var clipAudio = { _src: "", paused: true, ended: false, currentTime: 0, getAttribute: function(){ return this._src || null; },
    play: function(){ plays++; var self = this; return { then: function(f){ if(playOk){ self.paused = false; f(); } return { catch: function(){} }; } }; },
    pause: function(){ pauses++; this.paused = true; } };
  var state = { phase: "running" };
  var navigator = { getAutoplayPolicy: function(){ return policy; } }, policy = "disallowed";
  var src = SCREEN.slice(SCREEN.indexOf("  var _audioWarned=false"), SCREEN.indexOf("  /* ============ LOUDER THAN THE LAPTOP CAN GO"));
  var api = new Function("document", "clipAudio", "state", "navigator", "tvSend", "setTimeout", "unlockAudio", "buildBoost", "_ac2",
    src + "\nreturn { blocked: audioBlocked, ok: audioOk, tap: soundTap, early: soundBarIfBlocked, paused: function(v){ _hostPaused=v; }, stateOf: audioState };")(
    document, clipAudio, state, navigator, function(m){ sent.push(m); }, function(f, ms){ timers.push([f, ms]); }, function(){}, function(){}, null);
  function bar(){ return document.getElementById("audioWarn"); }

  api.early();
  pass("the browser says before song 1 that it will refuse sound: the TV asks for the click from the lobby", !!bar() && bar().textContent === "Click anywhere on this screen to turn the sound on", bar() && bar().textContent);
  api.ok(); policy = "allowed"; sent.length = 0;
  api.early();
  pass("a TV that can play sound shows nothing", !bar());

  clipAudio._src = "data:clip"; playOk = false; policy = "disallowed";
  api.blocked();
  pass("song refused: the TV says \"Click anywhere on this screen to turn the sound on\"", !!bar() && bar().textContent === "Click anywhere on this screen to turn the sound on", bar() && bar().textContent);
  pass("and tells the console, once", sent.filter(function(m){ return m.t === "tv_audio_blocked"; }).length === 1, JSON.stringify(sent));
  var st = (bar() && bar().getAttribute("style")) || "";
  pass("along the bottom edge, full width, off the title (the 10 Nov sign-off)", /position:fixed;bottom:0;left:0;right:0/.test(st) && !/top:/.test(st), st);
  pass("big enough to read from the bar (2vw, 38px at 1920) and in the body font", /clamp\(18px,2vw,48px\)/.test(st) && /Hanken Grotesk/.test(st), st);
  pass("it stays up until the sound is on: no timer takes it down", timers.length === 0 && !!bar(), timers.length);
  api.blocked();
  pass("a second refusal does not stack a second bar", body.kids.filter(function(k){ return k.id === "audioWarn"; }).length === 1);

  api.paused(true); var p0 = plays;
  api.tap();
  pass("a click while the host has the song paused (a claim) does not start it", plays === p0 && !!bar(), plays - p0);
  policy = "allowed"; api.blocked(); api.tap();
  pass("though the click itself turns the sound on (the browser says allowed now): the bar goes, the song stays paused", plays === p0 && !bar(), plays - p0);
  policy = "disallowed"; api.blocked();
  api.paused(false); playOk = true; sent.length = 0;
  api.tap();
  pass("one click: the song that is on plays", plays === p0 + 1 && clipAudio.paused === false);
  pass("the bar goes", !bar());
  pass("and the console is told the TV has sound", sent.some(function(m){ return m.t === "tv_here" && m.audio === "ok"; }), JSON.stringify(sent));
  pass("the screen now reports ok", api.stateOf() === "ok");
  var p1 = plays; api.tap();
  pass("a click when nothing is wrong does nothing", plays === p1);

  /* Between songs: the click is what the browser wanted. */
  clipAudio._src = ""; policy = "disallowed"; playOk = false; api.blocked(); policy = "allowed";
  api.tap();
  pass("blocked between songs: the click turns it on (the browser says allowed) and the bar goes", !bar());
  policy = "disallowed"; api.blocked(); api.tap();
  pass("but while the browser still says no, the bar stays", !!bar());
  pass("the click listener is on the whole screen, for a mouse and for a remote's keys", (listeners.pointerdown || []).length === 1 && (listeners.keydown || []).length === 1);
})();
(function(){
  /* The first tap's warm-up play() must never pause a REAL clip. */
  var plays = 0, pauses = 0;
  var clipAudio = { getAttribute: function(){ return "data:clip"; }, play: function(){ plays++; return { then: function(f){ f(); return { catch: function(){} }; } }; }, pause: function(){ pauses++; } };
  var f = new Function("clipAudio", "var _clipUnlocked=false;\n" + grab("unlockClip", SCREEN) + "\nreturn unlockClip;")(clipAudio);
  f();
  pass("a click during a song does not pause it (the warm-up skips a real clip)", plays === 0 && pauses === 0, [plays, pauses]);
  var clip2 = { getAttribute: function(){ return null; }, play: function(){ plays++; return { then: function(f){ f(); return { catch: function(){} }; } }; }, pause: function(){ pauses++; } };
  var f2 = new Function("clipAudio", "var _clipUnlocked=false;\n" + grab("unlockClip", SCREEN) + "\nreturn unlockClip;")(clip2);
  f2();
  pass("CONTROL: with no clip loaded the warm-up still runs", plays === 1 && pauses === 1, [plays, pauses]);
  pass("the /tv frame's forwarded tap turns the sound on too", /e\.data\.vp === "unlock-audio"\)\{ unlockClip\(\); unlockAudio\(\); soundTap\(\); \}/.test(SCREEN));
})();
(function(){
  /* THE CONSOLE: plain words, the real control names. */
  var hosted = [], kids = [], note = { cls: { hidden: true }, _t: "" };
  Object.defineProperty(note, "textContent", { get: function(){ return note._t + kids.map(function(k){ return k.textContent || ""; }).join(" "); }, set: function(v){ note._t = String(v); kids = []; } });
  note.classList = { add: function(c){ note.cls[c] = true; }, remove: function(c){ delete note.cls[c]; } };
  note.appendChild = function(k){ kids.push(k); return k; };
  var btn = { innerHTML: "" }, cleared = 0;
  var G = { hostMonitor: false, tvLastSeen: Date.now(), status: "running" };
  var audio = { muted: true, paused: false, src: "" };
  var document = { createElement: function(){ var h = {}; return { style: {}, addEventListener: function(e, f){ h[e] = f; }, click: function(){ h.click(); } }; },
                   createTextNode: function(t){ return { textContent: t }; } };
  function $(id){ return id === "tvAudioNote" ? note : btn; }
  var src = ["tvSoundYes", "tvSoundNo", "askTvSound", "noteTvAudio", "syncMonitorBtn", "soundIsOnlyHere"].map(function(n){ return grab(n, HOST); }).join("\n");
  var onMsgSrc = grab("onMsg", HOST);
  var api = new Function("$", "G", "audio", "document", "hostError", "clearHostError", "tvHere",
    "var _tvAudio='unknown', _autoMonitor=false, _soundAsked=false, _audioErrShown=false;\n" + src + "\n" + onMsgSrc + "\nreturn { onMsg: onMsg, note: noteTvAudio, sync: syncMonitorBtn };")(
    $, G, audio, document, function(m){ hosted.push(m); }, function(){ cleared++; }, function(){});
  api.onMsg({ t: "tv_audio_blocked" });
  var said = hosted[hosted.length - 1] || "";
  pass("the console banner says what to do: \"Click once on the TV screen to turn its sound on, or tap Yes under Now playing ...\"",
       said === "The TV has no sound yet. Click once on the TV screen to turn its sound on, or tap Yes under Now playing to play the songs from this device.", said);
  pass("no \"autoplay\" and no \"monitor switch\" in anything the host reads", !/autoplay|monitor switch/i.test(said + " " + note.textContent + " " + btn.innerHTML), said + " | " + note.textContent);
  pass("under Now playing: the same instruction and the Yes it names", /Click once on the TV screen to turn its sound on\. Or play the songs on this device\?/.test(note.textContent) && kids.some(function(k){ return k.id === "tvSoundYes" && k.textContent === "Yes"; }), note.textContent);
  pass("the sound button no longer says \"Sound is on the TV\" while it is not", /The TV has no sound yet/.test(btn.innerHTML) && !/Sound is on the TV/.test(btn.innerHTML), btn.innerHTML);
  kids.filter(function(k){ return k.id === "tvSoundNo"; })[0].click();
  pass("No: the click instruction stays, and a TV app's remote is named", /^Click once on the TV screen to turn its sound on\. On a TV app, press any key on the remote once\.$/.test(note.textContent), note.textContent);
  api.note("ok");
  pass("the TV's sound comes on: the note and the banner both go", note.cls.hidden === true && cleared === 1, [note.cls.hidden, cleared]);
  pass("and the button says the sound is on the TV again", /Sound is on the TV/.test(btn.innerHTML), btn.innerHTML);
  G.hostMonitor = true; hosted.length = 0;
  api.onMsg({ t: "tv_audio_blocked" });
  pass("a host already playing here is told the TV has no sound and how to turn it on, not asked to tap Yes",
       hosted[0] === "The TV has no sound yet, so the songs are coming out of this device. Click once on the TV screen to turn its sound on.", hosted[0]);
})();

print("");
print(bad ? (bad + " FAILED, " + ran + " run") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
