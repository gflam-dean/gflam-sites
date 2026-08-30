/* THE SONG DRAW, TESTED AGAINST THE PAGE ITSELF.

   A live night came back "most of the songs were boring and we didnt know". The
   cause was not the library: every playlist is ordered most-known first, and the
   draw took sixty at random across the whole list, so three quarters of a night
   came from the end of it.

   This reads host.html, lifts the real drawGameSet out of it, and runs it against
   the real library. It is written this way on purpose: a copy of the logic here
   would keep passing while the page changed underneath it.

   Run: jsc venueplay/app/musical/musical-draw.test.js
*/
var bad = 0;
function pass(n, c, extra){ print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

var CANDIDATES = [
  "venueplay/app/musical/host.html",
  "../musical/host.html",
  "/Users/dean.tindale/gflam-sites-current/venueplay/app/musical/host.html"
];
var LIBS = [
  "venueplay/data/musical-library.json",
  "../../data/musical-library.json",
  "/Users/dean.tindale/gflam-sites-current/venueplay/data/musical-library.json"
];
function firstReadable(list, min){
  for (var i=0;i<list.length;i++){
    try { var t = readFile(list[i]); if (t && t.length > min) return t; } catch(e){}
  }
  return null;
}
var html = firstReadable(CANDIDATES, 1000);
var libRaw = firstReadable(LIBS, 1000);
if (html === null || libRaw === null){ print("FAIL could not find host.html or the library"); throw new Error("no source"); }

/* Lift the two functions we are testing straight out of the page. */
function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return null;
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j+1); }
  }
  return null;
}
var fnDraw = grab("drawGameSet", html);
var fnRand = grab("cryptoInt", html);
pass("drawGameSet is still in the page", !!fnDraw);
pass("cryptoInt is still in the page", !!fnRand);
if (!fnDraw || !fnRand) throw new Error("missing functions");

/* The page's cryptoInt uses window.crypto, which jsc does not have. Substitute a
   deterministic generator with the SAME contract (an int in [0,max)), so the test
   is repeatable; nothing about the weighting depends on the source of randomness. */
var _seed = 12345;
function cryptoInt(max){ _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed % max; }
var G = { hitsOnly: true };

/* The two constants the draw reads, taken from the page rather than restated, so
   this test cannot drift away from what actually ships. */
function constFromPage(name, src, fallback){
  var m = new RegExp("var\\s+" + name + "\\s*=\\s*([0-9.]+)").exec(src);
  return m ? Number(m[1]) : fallback;
}
var HITS_ALPHA = constFromPage("HITS_ALPHA", html, null);
var GAME_SONGS = constFromPage("GAME_SONGS", html, null);
pass("the page still declares HITS_ALPHA", HITS_ALPHA !== null, "alpha " + HITS_ALPHA);
pass("the page still declares GAME_SONGS", GAME_SONGS !== null, GAME_SONGS + " songs a game");
if (HITS_ALPHA === null || GAME_SONGS === null) throw new Error("missing constants");
eval(fnDraw);

var lib = JSON.parse(libRaw);
var byId = {}; for (var i=0;i<lib.songs.length;i++) byId[lib.songs[i].id] = lib.songs[i];
function playlist(name){
  for (var i=0;i<lib.playlists.length;i++) if (lib.playlists[i].name === name) return lib.playlists[i];
  return null;
}
function asSongs(p){
  var out = [];
  for (var i=0;i<p.songIds.length;i++){ var s = byId[p.songIds[i]]; if (s) out.push(s); }
  return out;
}
function ranksOf(list, drawn){
  var pos = {}; for (var i=0;i<list.length;i++) pos[list[i].id] = i;
  var r = []; for (var j=0;j<drawn.length;j++) r.push(pos[drawn[j].id]);
  return r.sort(function(a,b){ return a-b; });
}
function median(a){ return a.length ? a[Math.floor(a.length/2)] : -1; }

var packs = ["2000s", "80s", "90s", "Pub Classics", "Aussie"];
for (var p = 0; p < packs.length; p++){
  var pl = playlist(packs[p]);
  if (!pl){ pass("playlist " + packs[p] + " exists", false); continue; }
  var list = asSongs(pl);

  G.hitsOnly = true;
  var drawn = drawGameSet(list);
  pass(packs[p] + ": a full game is dealt", drawn.length === GAME_SONGS, drawn.length + " songs");

  var ids = {}, dupes = 0;
  for (var d = 0; d < drawn.length; d++){ if (ids[drawn[d].id]) dupes++; ids[drawn[d].id] = 1; }
  pass(packs[p] + ": no song is dealt twice", dupes === 0);

  var r = ranksOf(list, drawn);
  var med = median(r), mid = Math.floor(list.length / 2);
  pass(packs[p] + ": the night leans on the well-known end",
       med < mid * 0.75, "median position " + med + " of " + list.length);

  var topThird = 0, third = Math.ceil(list.length / 3);
  for (var k = 0; k < r.length; k++) if (r[k] < third) topThird++;
  pass(packs[p] + ": at least half the night is from the top third",
       topThird >= GAME_SONGS / 2, topThird + " of " + GAME_SONGS);

  /* And the switch has to actually do something, or a host turning it off changes
     nothing and the setting is a lie. */
  G.hitsOnly = false;
  var flat = drawGameSet(list);
  var medFlat = median(ranksOf(list, flat));
  pass(packs[p] + ": turning the switch off reaches the whole list",
       medFlat > med, "median goes " + med + " -> " + medFlat);
}

print(bad ? ("  " + bad + " FAILED") : "ALL " + "CHECKS PASSED");
if (bad) throw new Error(bad + " failed");
