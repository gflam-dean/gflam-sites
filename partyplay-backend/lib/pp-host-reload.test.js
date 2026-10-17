/* THE HOST'S TABLET RELOADS IN THE MIDDLE OF A GAME, AND THE TELLY MUST NOT NOTICE.

   Found 17 Oct 2026 driving a pretend party in a browser: reload the host console half way
   through Who am I? and the telly went to the join code and stayed there until the host
   pressed Got it. Two halves. The reloaded console landed on the games list, and drawing the
   list sends {t:"lobby"}, which is the telly's join screen and every phone's "Watch the big
   screen". Then the host tapped Start on Who am I? again, the console and the phones picked the
   round back up, and the telly was told nothing, because runRestore only re-sent the PHONES'
   message, which the telly ignores. Charades and Who here has ever had the same hole.

   This RUNS run.html twice against one tablet's storage, the way a reload does: the first copy
   plays a game into the middle, the second copy is the page loading again (its own load(), its
   own /games fetch) and must put the room back where it was. What the telly shows is worked out
   by playing every message through the same rules tv.html uses, so "the wall" here is the wall.

   For every PartyPlay game:
     - the ones that save where they are up to come straight back into the game, send no lobby,
       and the telly ends up on the picture it had (and gets it again if the telly reloads too);
     - reopened from the list by hand, the telly gets its picture back as well;
     - the ones that start again when reopened (heads or tails, the draw, the playlist, two
       truths, guess the photo) are NOT reopened by themselves: the console comes back to the
       list, as it always did, because restarting them unasked would wipe the room.

     jsc partyplay-backend/lib/pp-host-reload.test.js
*/
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   -> " + extra : "")); if (!c) bad++; }
function drain(){ for (var i = 0; i < 40; i++) drainMicrotasks(); }

var SRC = readFile(ppFile("partyplay/run.html"));
var BODY = SRC.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
var CUT = BODY.lastIndexOf("})();");
if (CUT < 0) throw new Error("no IIFE in run.html");

var libs = {};
libs.window = libs; libs.globalThis = libs;
var _seq = 7; libs.crypto = { getRandomValues:function(a){ for (var i = 0; i < a.length; i++) a[i] = (_seq = (_seq * 1103515245 + 12345) >>> 0); return a; } };
var _ws = readFile(ppFile("partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js")), _bs = _ws.indexOf("\nconst PP_GM_BOARDS = [");
if (_bs < 0) throw new Error("PP_GM_BOARDS is not in the PartyPlay Worker");
var GMB = (new Function(_ws.slice(_bs, _ws.indexOf("\n];\n", _bs) + 3) + "\nreturn PP_GM_BOARDS;"))();
["partyplay/lib/ta-match.js", "partyplay/lib/pr-game.js", "partyplay/lib/pp-games.js"].forEach(function(f){
  (new Function("window", "globalThis", "module", readFile(ppFile(f))))(libs, libs, undefined);
});
var _ppq = { exports:{} }; (new Function("module", readFile(ppFile("partyplay/lib/pp-quiz.js"))))(_ppq);

var GAMES = [
  { id:"g1", format:"guesswho", title:"", config:{ items:[{q:"Taylor Swift"},{q:"Captain Cook"},{q:"Kylie Minogue"}] } },
  { id:"g2", format:"charades", title:"", config:{ items:[{q:"Jaws"},{q:"Titanic"},{q:"Frozen"}] } },
  { id:"g3", format:"whohere",  title:"", config:{ items:[{q:"Who here has ever been to Bali?"},{q:"Who here has ever sung karaoke?"}] } },
  { id:"g4", format:"trivia",   title:"Quiz", config:{ items:[{q:"Capital of Australia?",a:"Canberra"},{q:"Largest planet?",a:"Jupiter"},{q:"Two plus two?",a:"Four"}] } },
  { id:"g5", format:"bingo90",  title:"", config:{} },
  { id:"g6", format:"headstails", title:"", config:{} },
  { id:"g7", format:"draw",     title:"", config:{} },
  { id:"g8", format:"playlist", title:"", config:{} },
  { id:"g9", format:"truths",   title:"", config:{} },
  { id:"g10", format:"howwell", title:"How well do you know Sam", config:{ items:[{q:"First car?",a:"Corolla"},{q:"Pet?",a:"Dog"},{q:"Team?",a:"Lions"}] } },
  { id:"g11", format:"topanswers", title:"", config:{} },
  { id:"g12", format:"photos",  title:"", config:{ items:[{q:"Who is this?", a:"Sam", url:""}] } }
];

/* One copy of the page. `store` is the tablet's localStorage, shared between copies: that is
   the only thing a reload keeps. */
function openPage(store){
  var P = { sent:[], clicks:[], dom:{} };
  var g = {};
  g.window = g;
  function el(id){ return P.dom[id] || (P.dom[id] = { id:id, innerHTML:"", textContent:"", disabled:false, href:"", style:{},
    addEventListener:function(){}, querySelector:function(){ return { addEventListener:function(){}, textContent:"" }; }, remove:function(){}, focus:function(){} }); }
  g.document = {
    getElementById: el,
    createElement: function(){ return { className:"", innerHTML:"", style:{}, setAttribute:function(){}, querySelector:function(){ return { addEventListener:function(){} }; }, remove:function(){} }; },
    body: { appendChild:function(){}, insertBefore:function(){}, firstChild:null },
    addEventListener: function(t, f){ if (t === "click") P.clicks.push(f); }
  };
  g.location = { search:"?code=ABCDEF&key=k", pathname:"/run", href:"", replace:function(){} };
  g.localStorage = { getItem:function(k){ return store.hasOwnProperty(k) ? store[k] : null; },
                     setItem:function(k, v){ store[k] = String(v); }, removeItem:function(k){ delete store[k]; } };
  g.sessionStorage = g.localStorage;
  g.fetch = function(url){
    url = String(url);
    var j = /\/games\?/.test(url) ? { party:{ code:"ABCDEF", status:"live", days:1, timeLeft:"23 hours left", startWarning:"Go?",
                                              startsAt:new Date(Date.now()-3600e3).toISOString(), endsAt:new Date(Date.now()+20*3600e3).toISOString() },
                                      games: JSON.parse(JSON.stringify(GAMES)) }
          : /\/party\/gm\/boards\?/.test(url) ? { boards: GMB } : {};
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve(j); } });
  };
  g.setTimeout = function(){ return 1; }; g.setInterval = function(){ return 1; };
  g.clearTimeout = function(){}; g.clearInterval = function(){};
  g.navigator = { userAgent:"jsc" };
  g.screen = { width:1280, height:720 };
  g.alert = function(){}; g.confirm = function(){ return true; }; g.requestAnimationFrame = function(){ return 0; };
  var flips = 0;
  g.crypto = { getRandomValues:function(a){ a[0] = (flips++ * 2654435761) >>> 0; return a; } };
  g.URLSearchParams = function(){ this.get = function(k){ return k === "code" ? "ABCDEF" : k === "key" ? "k" : null; }; };
  g.PPConfig = { API:"https://x", SUPA_URL:"https://y", SUPA_ANON:"", channel:function(c){ return "pp-" + c; }, code:function(c){ return String(c || "").toUpperCase(); } };
  g.PPQuiz = { CORRECT_POINTS:100, SPEED_POINTS:0, options:function(){ return { options:["a","b","c","d"], correct:"a" }; },
               score:function(){ return []; }, winners:_ppq.exports.winners };
  g.PPLicence = { isLive:function(){ return true; }, timeLeft:function(){ return "23 hours left"; } };
  g.PPGames = libs.PPGames; g.PRGame = libs.PRGame;
  var EXPORT = "\n; globalThis.__X = { setSend:function(f){ send=f; }, setToast:function(f){ toast=f; }, setPlayers:function(p){ players=p; }," +
    " getG:function(){ return G; }, fromRoom:fromRoom, openPick:openPick };\n";
  /* send() is swapped for a recorder only AFTER load() has run, so the opening burst is caught
     by sendHook's own recorder below instead: everything the page sends goes through sendHook. */
  var harness = BODY.slice(0, CUT) + EXPORT + BODY.slice(CUT);
  harness = harness.replace("function sendHook(o){", "function sendHook(o){ __REC(o);");
  if (harness.indexOf("__REC(o)") < 0) throw new Error("sendHook is not in run.html");
  (new Function("globalThis","window","document","location","localStorage","sessionStorage","fetch","setTimeout","setInterval",
    "clearTimeout","clearInterval","URLSearchParams","PPConfig","PPQuiz","PPLicence","PPGames","PRGame","navigator","screen","alert",
    "confirm","requestAnimationFrame","crypto","__REC", harness))
    (g, g, g.document, g.location, g.localStorage, g.sessionStorage, g.fetch, g.setTimeout, g.setInterval, g.clearTimeout,
     g.clearInterval, g.URLSearchParams, g.PPConfig, g.PPQuiz, g.PPLicence, g.PPGames, g.PRGame, g.navigator, g.screen, g.alert,
     g.confirm, g.requestAnimationFrame, g.crypto, function(o){ P.sent.push(JSON.parse(JSON.stringify(o))); });
  P.X = g.__X;
  P.X.setToast(function(){});
  drain();                                  // load(): the /games fetch, then the list or the game
  P.tap = function(id){
    var node = { id:id, hasAttribute:function(){ return false; }, getAttribute:function(){ return null; } };
    var ev = { target:{ closest:function(){ return node; } } };
    P.clicks.forEach(function(f){ f(ev); }); drain();
  };
  P.start = function(gameId){
    var i = -1; GAMES.forEach(function(x, j){ if (x.id === gameId) i = j; });
    var node = { id:"", hasAttribute:function(a){ return a === "data-run"; }, getAttribute:function(){ return String(i); } };
    var ev = { target:{ closest:function(){ return node; } } };
    P.clicks.forEach(function(f){ f(ev); }); drain();
  };
  return P;
}

/* What the telly shows after these messages, by tv.html's own rules (onMsg): lobby is the join
   screen, big is a caption, board a scores board, ta_board a Great Minds board (its reveals are
   what has been found on it). tvOnly copies count; phones' own messages do not reach the wall. */
function wall(msgs){
  var w = "nothing yet";
  msgs.forEach(function(m){
    if (m.t === "lobby") w = "JOIN SCREEN";
    else if (m.t === "big") w = "caption: " + m.text + " / " + (m.sub || "");
    else if (m.t === "board") w = "board: " + m.title;
    else if (m.t === "queue") w = "queue: " + (m.songs || []).length;
    else if (m.t === "photoscreen") w = "photo " + m.n;
    else if (m.t === "ta_board") w = "great minds: " + m.q;
    else if (m.t === "ta_showall") w = w + " (all shown)";
  });
  return w;
}

var CASES = [
  { id:"g1", name:"Who am I?",          resume:true,  play:["warnok", "gwstart", "gwnext"] },
  { id:"g2", name:"Charades",           resume:true,  play:["warnok", "charstart", "charnext"] },
  { id:"g3", name:"Who here has ever",  resume:true,  play:["whonext"] },
  { id:"g4", name:"Trivia",             resume:true,  play:["next", "reveal", "next"] },
  { id:"g10", name:"How well do you know", resume:true, play:["next"] },
  { id:"g5", name:"Bingo",              resume:true,  play:["call", "call", "call"] },
  { id:"g11", name:"Great Minds",       resume:true,  play:["gmnext"] },
  { id:"g6", name:"Heads or tails",     resume:false, play:["flip"] },
  { id:"g7", name:"Prize draw",         resume:false, play:["drawnow"] },
  { id:"g8", name:"The playlist",       resume:false, play:[] },
  { id:"g9", name:"Two truths and a lie", resume:false, play:[] },
  { id:"g12", name:"Guess the photo",   resume:false, play:["photonext"] }
];

CASES.forEach(function(C){
  print("== " + C.name + ": the host's tablet reloads mid-game ==");
  var store = {};
  var A = openPage(store);
  A.X.setPlayers(["Sam", "Jordan"]);
  A.sent = [];
  A.start(C.id);
  C.play.forEach(function(b){ A.tap(b); });
  var before = wall(A.sent);
  ok(C.name + ": the game put something on the telly to begin with", before !== "nothing yet" && before !== "JOIN SCREEN", before);

  var B = openPage(store);                        // the reload: the page runs again on the same tablet
  var after = wall(A.sent.concat(B.sent));
  if (C.resume) {
    ok(C.name + ": the reloaded console goes back into the game", !!B.X.getG(), B.dom.app && B.dom.app.innerHTML.slice(0, 80));
    ok(C.name + ": and sends no join screen to the room", B.sent.every(function(m){ return m.t !== "lobby"; }),
       B.sent.map(function(m){ return m.t; }).join(","));
    ok(C.name + ": the telly is on the picture it had", after === before, "before [" + before + "] after [" + after + "]");

    /* the telly reloads too: it says tv-here and must be handed the same picture */
    var n = B.sent.length;
    B.X.fromRoom({ t:"tv-here" }); drain();
    var tvBack = wall(B.sent.slice(n));
    ok(C.name + ": a telly that reloads after it gets the same picture back", tvBack === before, "got [" + tvBack + "]");

    /* the host goes back to the list and opens the game again by hand */
    var D = openPage(store);
    D.tap("back");
    ok(C.name + ": Back to games still puts the join screen up", wall(D.sent) === "JOIN SCREEN", wall(D.sent));
    var E = openPage(store);
    ok(C.name + ": and a reload after Back to games stays on the list", !E.X.getG() && E.sent.some(function(m){ return m.t === "lobby"; }));
    D.start(C.id);
    var reopened = wall(D.sent);
    ok(C.name + ": opened again from the list, the telly gets its picture back", reopened === before,
       "before [" + before + "] reopened [" + reopened + "]");
  } else {
    ok(C.name + ": not reopened by itself, because reopening starts it again", !B.X.getG());
    ok(C.name + ": the console is back on the list, and the telly with it", wall(B.sent) === "JOIN SCREEN", wall(B.sent));
    ok(C.name + ": and nothing of the game was sent to the room", B.sent.every(function(m){ return m.t === "lobby" || m.t === "rollcall" || m.t === "players"; }),
       B.sent.map(function(m){ return m.t; }).join(","));
  }
});

print("== which game a reload reopens (openPick, run) ==");
var P0 = openPage({});
var pick = P0.X.openPick, now = Date.now(), G2 = JSON.parse(JSON.stringify(GAMES));
ok("the game that was open, while the party is live", (pick({ id:"g1", at:now }, G2, "live", now) || {}).id === "g1");
ok("not once the party has finished", pick({ id:"g1", at:now }, G2, "finished", now) === null);
ok("not a game saved more than twelve hours ago", pick({ id:"g1", at:now - 13*3600e3 }, G2, "live", now) === null);
ok("not a game that has since been deleted", pick({ id:"gone", at:now }, G2, "live", now) === null);
ok("not a game that starts again when it is opened", pick({ id:"g6", at:now }, G2, "live", now) === null && pick({ id:"g9", at:now }, G2, "live", now) === null);
ok("nothing saved, nothing reopened", pick(null, G2, "live", now) === null);

print("");
print((ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " host reload checks failed");
