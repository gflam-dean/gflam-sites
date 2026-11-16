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

var RH = readFile("venueplay/app/raffle/host.html");
print("\nRAFFLE: every winner message carries the draw look and the claim window");
(function(){
  var G = { round: { numbers: [42], prize: "Meat tray", remaining: 150, total: 180, allowRedraw: true }, min: 1, max: 150, jackOn: false, prizes: ["Meat tray", "Wine"], prizeIdx: 0, drawTime: "x", raffleId: "r1", raffles: [{ id: "r1", label: "Sunday meats" }] };
  var look = "ticket";
  var api = new Function("G", "styleKey", "raffleTitle", "drawSecsNow", "padWidth",
    [grab("addLookFields", RH), grab("winnerMsg", RH)].join("\n") + "\nreturn winnerMsg;")(G, function(){ return look; }, function(){ return "Sunday meats"; }, function(){ return 9; }, function(){ return 3; });
  var m = api(150);
  pass("the replay says the ticket roll", m.style === "ticket" && m.raffle === "Sunday meats" && m.drawSecs === 9, JSON.stringify(m));
  pass("it says which prize of how many (1 of 2)", m.prizeNo === 1 && m.prizeOf === 2, JSON.stringify(m));
  pass("time is what is left, total is the window the draw started with", m.time === 150 && m.total === 180, JSON.stringify(m));
  pass("the numbers and prize are the round's own", m.numbers[0] === 42 && m.prizeLabel === "Meat tray" && m.t === "winner");
  look = "";
  var m2 = api(0);
  pass("a classic-look venue sends no look fields (the plain winner screen stays)", m2.style === undefined && m2.prizeNo === undefined, JSON.stringify(m2));
  pass("the first send, the time-up resend and the hello replay all use winnerMsg", (RH.match(/winnerMsg\(/g) || []).length >= 4 && !/send\(\{ t:"winner"/.test(RH) && !/send\(\{\s*t:"winner"/.test(RH));
})();

var MEH = readFile("venueplay/app/members/host.html");
print("\nMEMBERS DRAW: every winner message carries the look, the draw and the jackpot");
(function(){
  var G = { round: { number: 107, name: "Willow,Mitchell", prizeCents: 20000, total: 180 }, drawTime: "normal" };
  var look = "flip", draw = { name: "Thursday draw", members: [] };
  var api = new Function("G", "curDraw", "currentLook", "VPDrawStyle", "activeMembers",
    grab("winnerMsg", MEH) + "\nreturn winnerMsg;")(G, function(){ return draw; }, function(){ return look; }, { secs: function(){ return 9; } },
    function(){ return [{ member_number: 101 }, { member_number: 112 }, { member_number: 105 }]; });
  var m = api(150);
  pass("the replay says the flip board, nine seconds", m.style === "flip" && m.drawSecs === 9, JSON.stringify(m));
  pass("and the jackpot it plays for, so the wall can say Playing for $200", m.jackpotCents === 20000 && m.drawName === "Thursday draw", JSON.stringify(m));
  pass("and the number range the board was built for", m.minNumber === 101 && m.maxNumber === 112, JSON.stringify(m));
  pass("claimSecs is what is left, claimTotal the whole window", m.claimSecs === 150 && m.claimTotal === 180 && m.number === 107, JSON.stringify(m));
  look = "";
  var m2 = api(0);
  pass("the old draw look sends no look fields", m2.style === undefined && m2.minNumber === undefined && m2.jackpotCents === 20000, JSON.stringify(m2));
  pass("the first send, the restored round and the hello replay all use winnerMsg", (MEH.match(/winnerMsg\(/g) || []).length >= 4 && !/send\(\{ t:"winner"/.test(MEH));
})();
print("\n" + ran + " checks, " + bad + " failed");
if (bad) throw new Error(bad + " failed");
print("ALL " + ran + " CHECKS PASSED");   // the line the gate reads (tools/passwording.py)
