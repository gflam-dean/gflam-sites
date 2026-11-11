/* MUSICAL BINGO, DEAN'S LIVE PLAY ON THE MINI BAR WITH THE KOGAN TV APP, 12 NOV 2026 (INBOX 282 items 2, 3 and 6).
   RUN, not read: every function here is lifted out of the page that ships and run.

   3. WRONG SONGS: New game after the host tapped another theme sent that theme's songs under the OLD theme's name, and
      the Worker reused a stored playlist by name. The name now comes from the theme the songs come from. A night with
      printed cards plays the printed set; the console then shows THAT playlist as on, and says why.
   6. "Next song in 15s" promised a next song that never came by itself. There is no auto-next (the host paces the
      night), so the button says when it is READY, not that a song is coming.
   2. The venueplay TV app has no pointer: the console never asks for a click on an app TV, and /tv hands the app's
      flag to the game screen inside it.

   Run: jsc tools/test-musical-live2-12nov.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || why === undefined ? "" : "   saw: " + why)); if(!c) bad++; }
var HOST = readFile("venueplay/app/musical/host.html");
var TV = readFile("venueplay/tv.html");
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

print("\n6. THE NEXT SONG BUTTON PROMISES NOTHING IT DOES NOT DO");
(function(){
  var holdLabel = new Function("SONG_HOLD_SECONDS", "SKIP_ASK_SECONDS", grab("holdLabel", HOST) + "\nreturn holdLabel;")(20, 2);
  var early = holdLabel(19), later = holdLabel(15);
  pass("no \"Next song in 15s\": the countdown is to when the button is ready", !/Next song in \d/.test(early + later) && /^Next song ready in 15s/.test(later), [early, later]);
  pass("after two seconds a tap can still skip, and says so", /tap to skip/.test(later) && !/tap to skip/.test(early), [early, later]);
})();

print("\n3. THE SONGS SENT ARE THE THEME THE CARDS SHOW, UNDER ITS OWN NAME");
(function(){
  var LIB = { plById: { pub: { id: "pub", name: "Pub Classics", songIds: ["a", "b"] }, eighties: { id: "eighties", name: "80s Anthems", songIds: ["c"] } },
              byId: { a: { id: "a", title: "Khe Sanh", artist: "Cold Chisel" }, b: { id: "b", title: "The Horses", artist: "Daryl Braithwaite" }, c: { id: "c", title: "Take On Me", artist: "a-ha" } }, songs: [] };
  var G = { playlistId: "eighties", playlistName: "80s Anthems", hitsOnly: false };
  var api = new Function("LIB", "G", "GAME_SONGS", "cryptoInt",
    [grab("playlistNameOf", HOST), grab("songsForPlaylist", HOST), grab("drawGameSet", HOST), grab("playlistPayload", HOST)].join("\n") + "\nreturn playlistPayload;")(LIB, G, 60, function(n){ return 0; });
  G.playlistId = "pub";   // the host tapped Pub Classics after an 80s game; New game does not read the select again
  var p = api();
  pass("New game after the host picked Pub Classics: the songs are Pub Classics", p.songs.map(function(s){ return s.title; }).join() === "Khe Sanh,The Horses", JSON.stringify(p.songs));
  pass("and they go to the Worker under the name Pub Classics, never the last game's 80s Anthems", p.name === "Pub Classics" && G.playlistName === "Pub Classics", p.name);
})();
(function(){
  var selected = [], said = [];
  var G = { playlistId: "pub", playlistName: "Pub Classics" };
  var PL_OPTS = [{ id: "pub", name: "Pub Classics" }, { id: "eighties", name: "80s Anthems" }];
  var show = new Function("G", "PL_OPTS", "selectPlaylist", "hostError", "playlistNameOf",
    grab("showDealtPlaylist", HOST) + "\nreturn showDealtPlaylist;")(G, PL_OPTS, function(id){ selected.push(id); G.playlistId = id; }, function(m){ said.push(m); },
    function(id){ return id === "pub" ? "Pub Classics" : "80s Anthems"; });
  show({ from_paper: false, playlist_name: "Pub Classics" });
  pass("dealt from the theme shown: nothing changes, nothing said", selected.length === 0 && said.length === 0);
  show({ from_paper: true, playlist_name: "80s Anthems" });
  pass("dealt from the printed cards (80s Anthems) while Pub Classics showed: the 80s card is shown as on", selected.join() === "eighties" && G.playlistName === "80s Anthems", selected.join());
  pass("and the host is told why", said.length === 1 && /printed cards: 80s Anthems/.test(said[0]), said.join());
})();

print("\n2. THE venueplay TV APP IS NEVER ASKED FOR A CLICK");
(function(){
  var hosted = [], note = { textContent: "", classList: { add: function(){}, remove: function(){} }, appendChild: function(k){ note.textContent += k.textContent || ""; return k; } };
  var btn = { innerHTML: "" };
  var G = { hostMonitor: false, tvLastSeen: Date.now(), status: "running" };
  var audio = { muted: true, paused: false, src: "" };
  var document = { createElement: function(){ return { style: {}, addEventListener: function(){} }; }, createTextNode: function(t){ return { textContent: t }; } };
  function $(id){ return id === "tvAudioNote" ? note : btn; }
  var src = ["tvNoSoundWords", "tvSoundYes", "tvSoundNo", "askTvSound", "noteTvAudio", "syncMonitorBtn", "soundIsOnlyHere"].map(function(n){ return grab(n, HOST); }).join("\n");
  var api = new Function("$", "G", "audio", "document", "hostError", "clearHostError", "tvHere",
    "var _tvAudio='unknown', _autoMonitor=false, _soundAsked=false, _audioErrShown=false, _tvApp='';\n" + src + "\n" + grab("onMsg", HOST) + "\nreturn { onMsg: onMsg };")(
    $, G, audio, document, function(m){ hosted.push(m); }, function(){}, function(){});
  api.onMsg({ t: "tv_audio_blocked", app: "tizen" });
  var all = hosted.join(" ") + " " + note.textContent;
  pass("the TV app has no sound: the console never says \"click\"", hosted.length === 1 && !/click/i.test(all), all);
  pass("it says it is the TV app, and offers this device", /The TV app has no sound yet/.test(hosted[0]) && /Yes under Now playing/.test(hosted[0]) && /Play the songs on this device\?/.test(note.textContent), all);
})();
(function(){
  var f = { src: "", style: {}, getAttribute: function(){ return f.src; } };
  var holdText = { textContent: "" };
  var win = { VP_TV_APP: { platform: "tizen" } };
  var stub = function(){};
  var enter = new Function("window", "document", "$", "stopReveal", "stopAds", "stopCelebrate", "cancelHolding", "hideBingoLayers", "applyVenueLogo",
    "sessionStorage", "VENUE_SLUG", "gameLabel", "showBingoLayer", "cancelEmbedWatch", "enterAds", "setTimeout", "EMBED_LOAD_MS", "VPSting", "VPEndShow",
    "var tvMode='ads', embedLoaded=false, embedT=null;\n" + grab("enterEmbed", TV) + "\nreturn enterEmbed;");
  function run(w){
    f.src = "";
    var e = enter(w, { getElementById: function(){ return f; } }, function(){ return { style: {}, classList: { add: stub, remove: stub }, textContent: "" }; },
      stub, stub, stub, stub, stub, stub, { setItem: stub }, "the-mini-bar", function(g){ return g; }, stub, stub, stub, function(){ return 0; }, 25000, undefined, undefined);
    e("musical");
    return f.src;
  }
  var inApp = run(win), inBrowser = run({});
  pass("/tv in the TV app hands &app=tizen to the musical bingo screen inside it", /^\/app\/musical\/screen\?venue=the-mini-bar.*&app=tizen$/.test(inApp), inApp);
  pass("CONTROL: a browser TV's game screen carries no app flag", inBrowser.indexOf("app=") < 0 && /^\/app\/musical\/screen\?venue=the-mini-bar/.test(inBrowser), inBrowser);
})();

print("");
print(bad ? (bad + " FAILED, " + ran + " run") : ("ALL " + ran + " CHECKS PASSED"));
if(bad) throw new Error(bad + " failed");
