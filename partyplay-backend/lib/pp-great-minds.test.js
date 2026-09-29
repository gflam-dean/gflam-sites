/* GREAT MINDS (PartyPlay's copy of Punters Reckon): one engine, family boards, played for real.

   Loads the REAL run.html runner, the real engine (partyplay/lib/pr-game.js) and the real boards,
   drives a board with two guests, and reads what went down the party channel. Every phone and the
   telly hear that channel, so the rule that matters is the one VenuePlay's round test holds too:
   no answer travels before somebody finds it.

     jsc partyplay-backend/lib/pp-great-minds.test.js
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

print("== one engine: PartyPlay's copies are VenuePlay's files, byte for byte ==");
["ta-match.js", "pr-game.js", "pr-board.js", "pr-phone.js"].forEach(function(f){
  ok(f + " is the same file in both products",
     readFile(ppFile("partyplay/lib/" + f)) === readFile(ppFile("venueplay/app/topanswers/" + f)));
});

var g = {};
g.window = g; g.globalThis = g;
g.crypto = { getRandomValues: function(a){ a[0] = 0; return a; } };
["partyplay/lib/ta-match.js", "partyplay/lib/pp-great-minds-boards.js", "partyplay/lib/pr-game.js", "partyplay/lib/pp-games.js"].forEach(function(f){
  (new Function("window", "globalThis", "module", readFile(ppFile(f))))(g, g, undefined);
});

print("== the boards are family boards, and each one plays fair ==");
var BANNED = /\b(beer|beers|wine|pokies?|pub|pubs|grog|booze|drunk|schooner|pint|vodka|rum|champagne|cocktails?|cigarettes?|smok\w*|hangover|alcohol|bet|betting|tab)\b/i;
var boards = g.TABoards, badWords = [], badSums = [], shared = [], selfMiss = [];
boards.forEach(function(b){
  var total = 0, seen = {};
  if (BANNED.test(b.q)) badWords.push(b.id + ": " + b.q);
  b.answers.forEach(function(a, i){
    total += a.pts;
    [a.a].concat(a.also || []).forEach(function(form){
      if (BANNED.test(form)) badWords.push(b.id + ": " + form);
      var k = g.TAMatch.norm(form);
      if (seen[k] !== undefined && seen[k] !== i) shared.push(b.id + ": " + form);
      seen[k] = i;
    });
    if (g.TAMatch.match(b, a.a) !== i) selfMiss.push(b.id + ": " + a.a);
  });
  if (total !== 100) badSums.push(b.id + " adds to " + total);
});
ok("at least 30 boards", boards.length >= 30, boards.length + " boards");
ok("nothing that does not belong at a kids' party", !badWords.length, badWords.join(", "));
ok("every board adds up to 100", !badSums.length, badSums.join(", "));
ok("no typed form belongs to two answers on one board", !shared.length, shared.join(", "));
ok("every answer scores when typed exactly", !selfMiss.length, selfMiss.join(", "));
ok("the game is called Great Minds, in one place", g.PPGames.name("topanswers") === "Great Minds");

print("== a board played through the real run.html runner ==");
var src = readFile(ppFile("partyplay/run.html"));
var body = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
var sent = [], dom = {}, timers = [];
g.document = {
  getElementById: function(id){ return dom[id] || (dom[id] = { innerHTML:"", addEventListener:function(){}, querySelector:function(){ return { addEventListener:function(){} }; } }); },
  createElement: function(){ return { className:"", innerHTML:"", querySelector:function(){ return { addEventListener:function(){} }; }, remove:function(){} }; },
  body: { appendChild:function(){} }, addEventListener: function(){}
};
g.location = { search:"?code=ABCDEF&key=k", href:"", replace:function(){} };
var store = {};
g.localStorage = { getItem:function(k){ return store[k] || null; }, setItem:function(k, v){ store[k] = String(v); } };
g.sessionStorage = g.localStorage;
g.fetch = function(){ return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({}); } }); };
g.setTimeout = function(f, ms){ timers.push({ f:f, ms:ms }); return timers.length; };
g.setInterval = function(){ return 0; }; g.clearTimeout = function(){}; g.clearInterval = function(){};
g.navigator = { userAgent:"jsc", clipboard:{ writeText:function(){ return Promise.resolve(); } }, mediaDevices:{} };
g.screen = { width:1280, height:720 };
g.alert = function(){}; g.confirm = function(){ return true; }; g.requestAnimationFrame = function(){ return 0; };
g.addEventListener = function(){};
g.URLSearchParams = function(){ this.get = function(k){ return k === "code" ? "ABCDEF" : "k"; }; };
g.PPConfig = { API:"https://x", SUPA_URL:"https://y", SUPA_ANON:"", channel:function(c){ return "pp-" + c; }, code:function(c){ return String(c || "").toUpperCase(); } };
g.PPQuiz = { CORRECT_POINTS: 100, SPEED_POINTS: 0, options: function(){ return []; } };
g.PPLicence = { isLive: function(){ return true; }, timeLeft: function(){ return "some time"; } };
var EXPORT = "\n; globalThis.__X = { runGreatMinds:runGreatMinds, gmPutUp:gmPutUp, gmEnd:gmEnd, gmFinish:gmFinish," +
  " onGreatMindsGuess:onGreatMindsGuess, setSend:function(f){ send=f; }, getG:function(){ return G; }," +
  " setToast:function(f){ toast=f; }, resend:function(){ if(G && G.resend) G.resend(); }, night:function(){ return NIGHT; } };\n";
var cut = body.lastIndexOf("})();");
(new Function("globalThis","window","document","location","localStorage","sessionStorage","fetch","setTimeout","setInterval",
  "clearTimeout","clearInterval","URLSearchParams","PPConfig","PPQuiz","PPLicence","PPGames","PRGame","navigator","screen","alert",
  "confirm","requestAnimationFrame","crypto", body.slice(0, cut) + EXPORT + body.slice(cut)))
  (g, g, g.document, g.location, g.localStorage, g.sessionStorage, g.fetch, g.setTimeout, g.setInterval, g.clearTimeout,
   g.clearInterval, g.URLSearchParams, g.PPConfig, g.PPQuiz, g.PPLicence, g.PPGames, g.PRGame, g.navigator, g.screen, g.alert,
   g.confirm, g.requestAnimationFrame, g.crypto);
var X = g.__X;
X.setSend(function(o){ sent.push(JSON.parse(JSON.stringify(o))); });
X.setToast(function(){});
ok("run.html sends a guess to the runner (the channel handler knows pr_guess)", /if\(m\.t==="pr_guess"\)\{ onGreatMindsGuess\(m\); \}/.test(src));
ok("and starts the game from its tile", /else if\(g\.format==="topanswers"\) runGreatMinds\(g\);/.test(src));

X.runGreatMinds({ format:"topanswers" });
X.gmPutUp();
var G = X.getG(), b = G.game.board, pub = sent.filter(function(m){ return m.t === "ta_board"; })[0];
ok("the board goes up with its question and a count, named Great Minds", pub && pub.q === b.q && pub.n === b.answers.length && pub.name === "Great Minds");
ok("the host's own screen lists the answers (only the tablet sees this)", dom.app.innerHTML.indexOf(b.answers[0].a) > 0);
var first = b.answers[0], second = b.answers[1];
X.onGreatMindsGuess({ t:"pr_guess", name:"Sam", round:1, text:first.a.toLowerCase() });
X.onGreatMindsGuess({ t:"pr_guess", name:"Jo", round:1, text:"zzzz nothing" });
X.onGreatMindsGuess({ t:"pr_guess", name:"Jo", round:1, text:second.a });
var results = sent.filter(function(m){ return m.t === "pr_result"; });
ok("each result is addressed to the one guest who guessed", results.length === 3 && results[0].to === "Sam" && results[1].to === "Jo" && results[0].hit === true && results[1].hit === false);
ok("a found answer flips on the telly with who found it", sent.some(function(m){ return m.t === "ta_reveal" && m.a === first.a && m.by === "Sam"; }));
X.onGreatMindsGuess({ t:"pr_guess", name:"Sam", round:7, text:second.a });
ok("a guess for an old board is ignored", sent.filter(function(m){ return m.t === "pr_result"; }).length === 3);
var before = sent.length; X.resend();
ok("a guest who walks in mid-board gets the board and what was FOUND, nothing more",
   sent.slice(before).length === 3 && sent.slice(before)[0].t === "ta_board" && sent.slice(before).slice(1).every(function(m){ return m.t === "ta_reveal"; }));
X.gmEnd();
var showAt = -1; sent.forEach(function(m, i){ if (m.t === "ta_showall" && showAt < 0) showAt = i; });
var early = sent.slice(0, showAt).filter(function(m){ return m.t !== "big"; }).map(JSON.stringify).join(" ");
var unfound = b.answers.slice(2).map(function(a){ return a.a; });
ok("no unfound answer went down the channel before the end of the board", unfound.every(function(a){ return early.indexOf('"' + a + '"') < 0; }), unfound.join(","));
ok("the end of the board turns the rest over", sent[showAt].rest.length === b.answers.length - 2);
var boardTimer = timers.filter(function(t){ return t.ms === 7000; }).pop();
boardTimer.f();
var lb = sent.filter(function(m){ return m.t === "board"; }).pop();
ok("the scores go up after the board has been read, in the telly's shape", lb && lb.rows[0].name === "Sam" && lb.rows[0].score === first.pts && typeof lb.rows[1].score === "number");
X.gmFinish(); X.gmFinish();
ok("Finish adds the scores to the night once, however many times it is pressed", X.night().Sam === first.pts && X.night().Jo === second.pts);

print("== the phone and the telly mount the shared parts ==");
var play = readFile(ppFile("partyplay/play.html")), tv = readFile(ppFile("partyplay/tv.html")), host = readFile(ppFile("partyplay/host.html"));
ok("the phone loads the shared phone part and mounts it", /<script src="\/lib\/pr-phone\.js"><\/script>/.test(play) && /GM = PRPhone\.mount\(\$\("app"\)/.test(play));
ok("the phone's id is its name, so pr_result.to finds it", /me: function\(\)\{ var n = \(load\(\)\|\|\{\}\)\.nickname \|\| ""; return \{ pid:n, name:n \}; \}/.test(play));
ok("a caption for the telly cannot wipe a phone that is mid-board", /if\(B \|\| Q \|\| H \|\| T \|\| W \|\| V \|\| PH \|\| CH \|\| GW \|\| GM\) return;/.test(play));
ok("the telly loads the shared board and mounts it in a size container", /<script src="\/lib\/pr-board\.js"><\/script>/.test(tv) && /container-type:inline-size/.test(tv) && /gmBoard = PRBoard\.mount\(\$\("gmwrap"\)\);/.test(tv));
ok("the tile stays hidden until ?gm=1 (the database refuses the format until migration 15 runs)",
   /hidden: !\/\[\?&\]gm=1\/\.test\(location\.search\)/.test(host) && /!TYPES\[k\]\.hidden/.test(host));

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " great minds checks failed");
