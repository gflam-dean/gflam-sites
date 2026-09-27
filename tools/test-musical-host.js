/* THE MUSICAL BINGO CONSOLE, RUN, not read. From the audit of 27 Sep 2026.

   1. A false "Lost the connection" on the console. openGameChannel removed the old channel while
      gch still pointed at it; supabase-js reports CLOSED to that channel INSIDE removeChannel, so
      the console read its own replacement as a drop the moment a lobby opened. No retry either,
      and the warning never came down. The fix is trivia/host.html's, and this is the running test
      from venueplay-backend/app/trivia/trivia-night.test.js section 7, against musical.
   2. Paper cards: the Print modal promised "printing again gives you the same cards", which is
      only true from the same playlist now that the Worker replaces a set from another playlist
      before the first game (tools/test-musical-print.js runs that side). And after a print the
      console never said which playlist the cards on the tables came from.
   5. Playlist cards said "312 songs" while a game plays GAME_SONGS of them.

   Every function here is lifted out of the page that ships and run.

   Run: jsc tools/test-musical-host.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || !why ? "" : "   " + why)); if(!c) bad++; }
var host = readFile("venueplay/app/musical/host.html");
pass("the musical console is readable", !!host && host.length > 20000);

function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return "";
}
// A statement that starts at `from` and runs to its matching close, e.g. one addEventListener call.
function grabCall(from, src){
  var i = src.indexOf(from); if (i < 0) return "";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "(" ){ depth++; started = true; }
    else if (src[j] === ")"){ depth--; if (started && depth === 0) return src.slice(i, j + 2); }
  }
  return "";
}

print("");
print("1. THE PLAYERS' CHANNEL: no false 'lost connection', and it really reconnects");
(function(){
  /* A fake realtime client that behaves like supabase-js: removeChannel() reports CLOSED to the
     old channel INSIDE the call. */
  var a = host.indexOf("  var _leaving=false;"), b = host.indexOf("  // ---- host game state (the Worker is authoritative");
  var SRC = (a > 0 && b > a) ? host.slice(a, b) : "";
  var LEAVE = grabCall('window.addEventListener("beforeunload", function(){ _leaving=true; })', host) +
              grabCall('window.addEventListener("pagehide", function(){ _leaving=true; })', host) +
              grabCall('window.addEventListener("pageshow", function(ev){', host);
  pass("the players' channel code is where the test expects it", !!SRC && SRC.indexOf("function openGameChannel(") > 0);
  pass("the page marks itself as leaving, and a pageshow takes that back", LEAVE.split("addEventListener").length - 1 === 3, LEAVE.slice(0, 200));
  var timers = [], shown = [], cleared = 0, chans = [], tid = 0, listeners = {};
  var client = { channel: function(name){ var c = { name: name, on: function(){ return c; }, subscribe: function(cb){ c.cb = cb; return c; } }; chans.push(c); return c; },
                 removeChannel: function(c){ if (c && c.cb) c.cb("CLOSED"); } };
  var env = { client: client, G: { status: "setup", joinCode: "ABC123" },
              hostError: function(m){ shown.push(m); }, clearHostError: function(){ cleared++; },
              gflush: function(){}, gsend: function(){}, onMsg: function(){},
              window: { addEventListener: function(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); } },
              setTimeout: function(fn, ms){ var t = { fn: fn, ms: ms, id: ++tid }; timers.push(t); return t.id; },
              clearTimeout: function(id){ timers = timers.filter(function(t){ return t.id !== id; }); } };
  var names = Object.keys(env);
  var api = (new Function(names.join(","), "var gch=null, gsub=false;" + SRC + LEAVE +
    "; return { open: openGameChannel, cur: function(){ return gch; }, sub: function(){ return gsub; }, leaving: function(){ return _leaving; } };")).apply(null, names.map(function(k){ return env[k]; }));
  function fire(){ var t = timers.slice(); timers = []; t.forEach(function(x){ x.fn(); }); }
  function emit(ev, arg){ (listeners[ev] || []).forEach(function(fn){ fn(arg); }); }

  api.open("ABC123"); api.cur().cb("SUBSCRIBED");
  api.open("ABC123");                       // printing, then opening the lobby, reopens it
  pass("replacing the channel is not mistaken for a drop: no reconnect, no warning booked", timers.length === 0, JSON.stringify(timers.map(function(t){ return t.ms; })));
  env.G.status = "running"; api.open("ABC123"); env.G.status = "setup";
  pass("...even mid-game (a reload restores a live game and reopens it)", timers.length === 0);
  fire();
  pass("opening a lobby shows no 'lost connection'", shown.length === 0, JSON.stringify(shown));

  env.G.status = "running"; shown.length = 0; timers = [];
  var healed = api.cur(), opened = chans.length;
  healed.cb("TIMED_OUT"); healed.cb("SUBSCRIBED"); fire();
  pass("a blip that heals inside 8 seconds says nothing", shown.length === 0, JSON.stringify(shown));
  pass("...and the retry it booked is cancelled, so a working channel is not torn down", chans.length === opened && api.cur() === healed);
  timers = []; api.cur().cb("CHANNEL_ERROR");
  pass("a drop stops the console sending into a dead socket", api.sub() === false);
  var waits = timers.map(function(t){ return t.ms; });
  pass("a real drop books a retry and an 8 second warning", waits.indexOf(8000) >= 0 && waits.some(function(ms){ return ms >= 2000 && ms !== 8000; }), JSON.stringify(waits));
  var before = chans.length; fire();
  pass("still down after 8 seconds in a live game: the host is told", shown.length === 1 && /hold off on the next song/.test(shown[0]), JSON.stringify(shown));
  pass("and the retry really opens a fresh channel", chans.length === before + 1);
  api.cur().cb("SUBSCRIBED");
  pass("when it comes back the warning is taken down, once", cleared === 1 && api.sub() === true);
  api.cur().cb("SUBSCRIBED");
  pass("a second SUBSCRIBED does not clear some other error the host is reading", cleared === 1);

  env.G.status = "lobby"; shown.length = 0; timers = [];
  api.cur().cb("TIMED_OUT"); fire();
  pass("in the lobby, a drop retries quietly and warns nobody", shown.length === 0 && chans.length === before + 2);

  env.G.status = "running"; api.cur().cb("SUBSCRIBED"); shown.length = 0; timers = [];
  emit("pagehide");
  pass("leaving the page marks it as leaving", api.leaving() === true);
  api.cur().cb("CLOSED");
  pass("the channel closing as the page goes is not a drop: no retry, no warning", timers.length === 0 && shown.length === 0);
  emit("pageshow", { persisted: true });
  pass("back from the back/forward cache: drops count again", api.leaving() === false);
  pass("...and the channel that closed while it was away is opened again", chans.length === before + 3);
  timers = []; api.cur().cb("CHANNEL_ERROR"); fire();
  pass("a real drop after that restore is reported, not ignored", shown.length === 1);
})();

print("");
print("2. PAPER CARDS: the Print modal tells the truth about which cards you get");
(function(){
  var fns = ["esc", "paperPrintIntro", "paperPrintedNote", "paperPrintOutcome"].map(function(n){ return grab(n, host); });
  pass("the paper wording has its own functions", fns.every(Boolean));
  var api = (new Function(fns.join("\n") + "; return { intro: paperPrintIntro, note: paperPrintedNote, outcome: paperPrintOutcome };"))();
  var t = api.intro(0, "", "Pub Classics").replace(/<[^>]+>/g, "");
  pass("first print: just how many", t === "How many cards? Up to 10 a night.", t);
  t = api.intro(3, "Pub Classics", "Pub Classics").replace(/<[^>]+>/g, "");
  pass("same playlist again: the same cards plus extra, and says which playlist", /printed 3 already from Pub Classics/.test(t) && /same playlist gives you the same cards, plus any extra/.test(t), t);
  t = api.intro(3, "Pub Classics", "80s Anthems").replace(/<[^>]+>/g, "");
  pass("a different playlist: does NOT promise the same cards", !/gives you the same cards/.test(t), t);
  pass("...says the earlier cards are replaced before the first game, and kept once one is played",
       /Before the first game, printing replaces the Pub Classics cards/.test(t) && /every game tonight plays Pub Classics/.test(t), t);
  pass("a playlist name is escaped before it goes into the modal", api.intro(1, "<b>x", "y").indexOf("<b>x") < 0);
  pass("after a print, the note under the button names the playlist", /printed tonight from 80s Anthems\./.test(api.note(4, "80s Anthems")), api.note(4, "80s Anthems"));
  pass("the note before any print is unchanged", /^Up to 10 a night, printed from the playlist above\./.test(api.note(0, "")));
  var o = api.outcome({ playlist_name: "Pub Classics", kept: true }, "80s Anthems");
  pass("kept mid-night: the host is told the cards are Pub Classics, not what they picked", /These cards are from Pub Classics, not 80s Anthems/.test(o), o);
  o = api.outcome({ playlist_name: "80s Anthems", replaced: true }, "80s Anthems");
  pass("replaced: the host is told to throw the earlier cards away", /Throw away any cards printed earlier tonight/.test(o), o);
  pass("an ordinary reprint says nothing extra", api.outcome({ playlist_name: "Pub Classics" }, "Pub Classics") === "");
  pass("the modal uses the wording, not the old promise", host.indexOf("printing again gives you the same cards, plus any extra") < 0 && host.indexOf("paperPrintIntro(had, had ? paperPrintedFrom() : \"\", picked)") > 0);
  pass("the print remembers which playlist it came from", host.indexOf("savePaperPrinted(r.cards.length, r.playlist_name||\"\")") > 0);
  pass("no em dash in any paper wording", !/\u2014/.test(fns.join("")));
})();

print("");
print("5. A PLAYLIST CARD SAYS HOW MANY SONGS A GAME PLAYS");
(function(){
  var m = /var GAME_SONGS=(\d+);/.exec(host);
  var GS = m ? +m[1] : 0;
  pass("GAME_SONGS is read from the page", GS > 0);
  var fn = grab("playlistCountLabel", host), render = grab("renderPlCards", host);
  pass("the count wording has one function, and the playlist cards use it", !!fn && render.indexOf("playlistCountLabel(o.count)") > 0);
  var label = (new Function("GAME_SONGS", fn + "; return playlistCountLabel;"))(GS);
  pass("312 songs shows " + GS + " of 312 songs", label(312) === GS + " of 312 songs", label(312));
  pass("a big library shows the thousands separator", label(17245) === GS + " of 17,245 songs", label(17245));
  pass("a playlist no bigger than a game shows just its size", label(GS) === GS + " songs" && label(40) === "40 songs", label(40));
  pass("Surprise Mix says how many it draws", label(null) === GS + " songs, random each game", label(null));
  /* Run the real renderPlCards against a tiny fake DOM, so a card that bypasses the label is caught. */
  var made = [];
  function el(){ var e = { className: "", textContent: "", children: [], attrs: {}, classList: { toggle: function(){} },
    appendChild: function(c){ e.children.push(c); }, setAttribute: function(k, v){ e.attrs[k] = v; }, addEventListener: function(){} }; made.push(e); return e; }
  var grid = el(); grid.innerHTML = "";
  var doc = { createElement: function(){ return el(); } };
  var PL = [{ id: "p1", name: "Pub Classics", count: 312 }, { id: "surprise", name: "Surprise Mix", count: null }];
  (new Function("$", "document", "PL_OPTS", "G", "GAME_SONGS", fn + render + "; renderPlCards('');"))(function(){ return grid; }, doc, PL, { playlistId: "p1" }, GS);
  var cts = made.filter(function(e){ return e.className === "ct"; }).map(function(e){ return e.textContent; });
  pass("the cards on screen say " + GS + " of 312 songs, and " + GS + " songs, random each game", cts[0] === GS + " of 312 songs" && cts[1] === GS + " songs, random each game", JSON.stringify(cts));
})();

print("");
print(bad ? ("  " + bad + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
