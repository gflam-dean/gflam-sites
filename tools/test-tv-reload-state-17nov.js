/* A RELOADED CONSOLE OR TV KEEPS WHAT THE ROOM WAS WATCHING (Dean's gap 12 audit, 16 Nov 2026; fixed 17 Nov 2026).
   RUN, not read: functions lifted out of the pages that ship.
   Run: jsc tools/test-tv-reload-state-17nov.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || why === undefined ? "" : "   saw: " + why)); if(!c) bad++; }
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
var MH = readFile("venueplay/app/musical/host.html");

print("\nMUSICAL: a reloaded console remembers the song was revealed");
(function(){
  var songKey = new Function(grab("songKey", MH) + "\nreturn songKey;")();
  var rev = new Function("songKey", grab("revealedAfterRestore", MH) + "\nreturn revealedAfterRestore;")(songKey);
  var song = { song_id: "s1", title: "Khe Sanh", artist: "Cold Chisel" };
  pass("this device's save says the song was revealed: restored as revealed", rev({ rev: songKey(song) }, song) === true);
  pass("the save says still a mystery: restored as NOT revealed", rev({ rev: "" }, song) === false);
  pass("the save names an older song: this one is still a mystery", rev({ rev: "other" }, song) === false);
  pass("a game picked up from another device (no note): counts as revealed", rev({ sessionId: "x" }, song) === true && rev(null, song) === true);
  // the save itself
  var store = {};
  var G = { gameId: "g", sessionId: "s", status: "running", consoleId: "c", venueId: "v", nowSong: song, revealed: true };
  var save = new Function("G", "localStorage", "songKey", "musicKey", "clearLobby", grab("saveMusic", MH) + "\nreturn saveMusic;")(G,
    { setItem: function(k, v){ store[k] = v; } }, songKey, function(){ return "k"; }, function(){});
  save();
  pass("saveMusic writes the revealed song's key", JSON.parse(store.k).rev === songKey(song), store.k);
  G.revealed = false; save();
  pass("and an empty note while the song is still a mystery", JSON.parse(store.k).rev === "", store.k);
})();
print("\n" + ran + " checks, " + bad + " failed");
if (bad) throw new Error(bad + " failed");
