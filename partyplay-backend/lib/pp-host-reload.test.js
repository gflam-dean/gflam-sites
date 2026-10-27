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
    " getG:function(){ return G; }, fromRoom:fromRoom, openPick:openPick, setCh:function(c){ ch=c; }, status:onChannelStatus };\n";
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

/* ---------------------------------------------------------------- a hello lost on the way --
   Found 18 Oct 2026, in a browser: the telly reloaded straight after the host's console did, its one
   tv-here went out while the console was still joining the channel, nobody heard it, and the telly
   sat on the join screen in the middle of Who here has ever. A broadcast is gone if nobody is
   listening, so the telly must keep asking and the host must answer every time.

   This RUNS tv.html's own script against the console above over a pretend channel that can lose
   the first N messages either way, with the telly's clock held so its retries are fired by hand.
   "The same picture" is what a second telly that heard everything has on its screen. */
var TV_BODY = readFile(ppFile("partyplay/tv.html")).match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
function bootTv(net){
  var T = { timers:[], gm:[], recv:null, statusCb:null, said:0, net:net };
  var els = {};
  T.els = els;
  var doc = {
    getElementById:function(id){ if (id === "screen" || id === "who") return els[id] || (els[id] = { innerHTML:"", hidden:true, style:{} }); return els[id] || null; },
    createElement:function(){ var n = { style:{}, setAttribute:function(){}, remove:function(){ delete els[n.id]; } }; return n; },
    body:{ appendChild:function(n){ els[n.id] = n; } },
    querySelector:function(){ return null; }, addEventListener:function(){}
  };
  var chan = {
    on:function(a, b, f){ T.recv = f; return chan; },
    subscribe:function(cb){ T.statusCb = cb; return chan; },
    send:function(env){ T.said++; if (T.net) T.net.toHost(env.payload); }
  };
  var sb = { createClient:function(){ return { channel:function(){ return chan; } }; } };
  var cfg = { API:"https://x", SUPA_URL:"https://y", SUPA_ANON:"z", channel:function(c){ return "pp-" + c; }, code:function(c){ return String(c || "").toUpperCase(); } };
  var loc = { origin:"https://partyplay.com.au", search:"?code=ABCDEF" };
  var ls = { getItem:function(){ return null; }, setItem:function(){}, removeItem:function(){} };
  function USP(){ this.get = function(k){ return k === "code" ? "ABCDEF" : null; }; }
  function f(){ return Promise.resolve({ status:200, json:function(){ return Promise.resolve({ status:"live" }); } }); }
  function st(fn, ms){ T.timers.push({ f:fn, ms:ms, live:true }); return T.timers.length; }
  function ct(id){ if (id && T.timers[id - 1]) T.timers[id - 1].live = false; }
  var PRB = { mount:function(){ return { onMsg:function(m){ T.gm.push(m.t + ":" + (m.q || m.i || "")); } }; } };
  (new Function("document","supabase","PPConfig","location","localStorage","URLSearchParams","fetch","setTimeout","clearTimeout",
    "navigator","QRCode","window","PRBoard","getComputedStyle", TV_BODY))
    (doc, sb, cfg, loc, ls, USP, f, st, ct, {}, null, {}, PRB, function(){ return {}; });
  T.hear = function(m){ if (T.recv) { T.recv({ payload:JSON.parse(JSON.stringify(m)) }); drain(); } };
  /* a Great Minds board is the last board put up and what has been found on it since */
  T.screen = function(){
    var s = els.screen ? els.screen.innerHTML : "";
    if (/class="join"/.test(s)) return "JOIN SCREEN";
    if (!/id="gmwrap"/.test(s)) return s;
    var board = "", found = {};
    T.gm.forEach(function(x){ if (/^ta_board:/.test(x)) { board = x; found = {}; } else found[x] = 1; });
    return "GM " + board + " " + Object.keys(found).sort().join(",");
  };
  /* fire the telly's waiting retries, oldest first, as the clock would; never the 20 s "lost" note */
  T.tick = function(rounds){
    var fired = [];
    for (var r = 0; r < rounds; r++) {
      var next = null;
      for (var i = 0; i < T.timers.length; i++) if (T.timers[i].live && T.timers[i].ms !== 20000) { next = T.timers[i]; break; }
      if (!next) break;
      next.live = false; fired.push(next.ms); next.f(); drain();
    }
    return fired;
  };
  T.waiting = function(){ return T.timers.some(function(t){ return t.live && t.ms !== 20000; }); };
  return T;
}
/* One channel between one console and one telly; dropHost / dropTv lose that many messages next. */
function wire(host){
  var net = { host:host, tv:null, dropToHost:0, dropToTv:0, lostToHost:0, lostToTv:0 };
  net.toHost = function(m){ if (net.dropToHost > 0) { net.dropToHost--; net.lostToHost++; return; } if (net.host) { net.host.X.fromRoom(JSON.parse(JSON.stringify(m))); drain(); } };
  net.toTv = function(m){ if (net.dropToTv > 0) { net.dropToTv--; net.lostToTv++; return; } if (net.tv) net.tv.hear(m); };
  host.X.setCh({ send:function(env){ net.toTv(env.payload); } });
  return net;
}
function watcher(msgs){ var W = bootTv(null); W.statusCb("SUBSCRIBED"); msgs.forEach(function(m){ W.hear(m); }); return W; }

print("== the telly asks again until somebody answers ==");
var LONE = bootTv(null);
LONE.statusCb("SUBSCRIBED");
var gaps = LONE.tick(7);
ok("with no host listening it says hello again, backing off 1, 2, 4, 8 s and then every 15", JSON.stringify(gaps) === "[1000,2000,4000,8000,15000,15000,15000]", JSON.stringify(gaps));
ok("and has said it every time (8 hellos for 7 waits)", LONE.said === 8, String(LONE.said));
LONE.hear({ t:"big", text:"Who here has ever been to Bali?" });
ok("the first picture from the host stops it", !LONE.waiting() && LONE.tick(3).length === 0);
LONE.hear({ t:"rollcall" });
ok("a console joining the channel (its rollcall) starts it asking again", LONE.said === 9 && LONE.waiting(), String(LONE.said));
LONE.hear({ t:"players", names:["Sam"] });
ok("a names list is not the picture, so it keeps asking", LONE.waiting());
LONE.hear({ t:"lobby" });
ok("the join screen is a picture too", !LONE.waiting());

CASES.forEach(function(C){
  var store = {};
  var A = openPage(store);
  A.X.setPlayers(["Sam", "Jordan"]);
  A.sent = [];
  A.start(C.id);
  C.play.forEach(function(b){ A.tap(b); });
  var heard = A.sent.slice();
  var everything = watcher(heard).screen();        // a telly that heard the whole game

  /* THE TELLY RELOADS STRAIGHT AFTER THE HOST: its first three hellos are lost */
  if (C.resume) {
    var B = openPage(store);
    var net = wire(B);
    B.X.status("SUBSCRIBED"); drain();              // the console is back; what it flushes reaches no telly yet
    var expect = watcher(heard.concat(B.sent)).screen();
    net.dropToHost = 3;
    var T = bootTv(net); net.tv = T;
    T.statusCb("SUBSCRIBED");
    ok(C.name + ": telly reloads after the host, first hello lost, so it is still on the join screen for now", T.screen() === "JOIN SCREEN" && net.lostToHost === 1, T.screen().slice(0, 60));
    T.tick(6);
    ok(C.name + ": it keeps asking and gets the game back, not the join screen", T.screen() === expect && expect === everything && net.lostToHost === 3,
       "lost " + net.lostToHost + ", have [" + T.screen().slice(0, 70) + "] want [" + everything.slice(0, 70) + "]");
    ok(C.name + ": and stops asking once it has it", !T.waiting());
  }

  /* THE OTHER ORDER: the telly is up, the host reloads, and everything the console sends on
     reconnecting is lost except its rollcall */
  var store2 = JSON.parse(JSON.stringify(store));
  var T2 = watcher(heard);
  var B2 = openPage(store2);
  var net2 = wire(B2); net2.tv = T2; T2.net = net2;
  var want2 = watcher(heard.concat(B2.sent)).screen();
  var burst = B2.sent.length;
  net2.dropToTv = burst;                           // the whole burst it flushes on joining
  ok(C.name + ": host reloads under a telly that is up (" + burst + " of its messages will be lost)", burst > 0);
  B2.X.status("SUBSCRIBED"); drain();
  T2.tick(6);
  ok(C.name + ": the telly still ends up on the console's picture", T2.screen() === want2 && net2.lostToTv === burst,
     "have [" + T2.screen().slice(0, 70) + "] want [" + want2.slice(0, 70) + "]");
  ok(C.name + ": and it is the picture the game should show (" + (C.resume ? "the game" : "the join screen") + ")",
     C.resume ? want2 === everything : want2 === "JOIN SCREEN", want2.slice(0, 70));
});

print("== the host answers every hello the same way ==");
CASES.filter(function(C){ return C.resume; }).forEach(function(C){
  var store = {};
  var H = openPage(store);
  H.X.setPlayers(["Sam", "Jordan"]);
  H.start(C.id);
  C.play.forEach(function(b){ H.tap(b); });
  var gBefore = JSON.stringify(H.X.getG(), function(k, v){ return /T$/.test(k) ? undefined : v; });
  var answers = [];
  for (var i = 0; i < 4; i++) { var n = H.sent.length; H.X.fromRoom({ t:"tv-here" }); drain(); answers.push(JSON.stringify(H.sent.slice(n))); }
  ok(C.name + ": four hellos, four identical answers", answers.every(function(a){ return a === answers[0]; }) && answers[0] !== "[]", answers[0].slice(0, 80));
  ok(C.name + ": every answer is for the telly only (or the names), so no phone acts on it twice",
     JSON.parse(answers[0]).every(function(m){ return m.tvOnly || m.t === "players"; }), answers[0].slice(0, 80));
  ok(C.name + ": and answering changed nothing in the game", JSON.stringify(H.X.getG(), function(k, v){ return /T$/.test(k) ? undefined : v; }) === gBefore);
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
