/* CHARADES AND WHO AM I: the secrecy is the whole game.
 *
 * These two are the only games where showing something to the wrong screen ruins
 * them, and that cannot be checked by looking at the page. So load the real
 * runners out of run.html, drive them, and read what they actually broadcast.
 *
 *   jsc lib/pp-run-games.test.js
 */
var src = readFile("/Users/dean.tindale/partyplay/site/run.html");
var body = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];

var sent = [], toasts = [], dom = {};
var g = {};
g.window = g;
g.document = {
  getElementById: function(id){ return dom[id] || (dom[id] = { innerHTML:"", addEventListener:function(){}, querySelector:function(){ return { addEventListener:function(){} }; } }); },
  createElement: function(){ return { className:"", innerHTML:"", querySelector:function(){ return { addEventListener:function(){} }; }, remove:function(){} }; },
  body: { appendChild:function(){} },
  addEventListener: function(){}
};
g.location = { search:"?code=ABCDEF&key=k", href:"", replace:function(){} };
g.localStorage = { getItem:function(){return null;}, setItem:function(){} };
g.sessionStorage = g.localStorage;
g.fetch = function(){ return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({}); } }); };
g.setTimeout = function(){ return 0; }; g.setInterval = function(){ return 0; };
g.clearTimeout = function(){}; g.clearInterval = function(){};
g.encodeURIComponent = encodeURIComponent;
g.navigator = { userAgent:"jsc", clipboard:{ writeText:function(){ return Promise.resolve(); } }, mediaDevices:{} };
g.screen = { width:1280, height:720 };
g.alert = function(){}; g.confirm = function(){ return true; };
g.Image = function(){}; g.FormData = function(){}; g.Blob = function(){};
g.requestAnimationFrame = function(){ return 0; };
g.addEventListener = function(){};
g.URLSearchParams = function(){ this.get=function(k){ return k==="code"?"ABCDEF":"k"; }; };
g.PPConfig = { API:"https://x", SUPA_URL:"https://y", SUPA_ANON:"z", channel:function(c){return "pp-"+c;} };
// The real one is loaded by a <script src>, which this harness does not follow.
g.PPQuiz = { CORRECT_POINTS: 100, SPEED_POINTS: 0, options: function(){ return []; } };

// expose the internals we want to drive
/* The runners live inside the page's own IIFE, so the export has to go INSIDE
   it, immediately before it closes, or none of these names are in scope. */
var EXPORT = "\n; globalThis.__X = { runCharades:runCharades, runGuessWho:runGuessWho," +
  " charadesGo:charadesGo, guessWhoGo:guessWhoGo, setSend:function(f){ send=f; }," +
  " setPlayers:function(p){ players=p; }, getG:function(){ return G; }, setToast:function(f){ toast=f; }," +
  " truthsTally:truthsTally, resend:function(){ if(G && G.resend) G.resend(); } };\n";
var cut = body.lastIndexOf("})();");
if (cut < 0) { print("could not find the end of the IIFE"); throw new Error("no IIFE"); }
var harness = body.slice(0, cut) + EXPORT + body.slice(cut);
try {
  (new Function("globalThis","window","document","location","localStorage","sessionStorage",
                "fetch","setTimeout","setInterval","clearTimeout","clearInterval",
                "URLSearchParams","PPConfig","PPQuiz","navigator","screen","alert","confirm","requestAnimationFrame", harness))
    (g, g, g.document, g.location, g.localStorage, g.sessionStorage, g.fetch,
     g.setTimeout, g.setInterval, g.clearTimeout, g.clearInterval, g.URLSearchParams, g.PPConfig, g.PPQuiz, g.navigator, g.screen, g.alert, g.confirm, g.requestAnimationFrame);
} catch (e) { print("LOAD FAILED: " + e); throw e; }

var X = g.__X;
X.setSend(function(o){ sent.push(o); });
X.setToast(function(t){ toasts.push(t); });
X.setPlayers(["Dean","Nicole","Sam"]);

var pass = 0, fail = 0;
function ok(c, m){ if(c) pass++; else { fail++; print("  FAIL  " + m); } }

// ---------------- charades ----------------
sent = [];
X.runCharades({ config:{ items:[{q:"Riding a horse"},{q:"Making a cup of tea"}] } });
X.charadesGo();
var word = sent.filter(function(m){ return m.t==="charades"; })[0];
var big  = sent.filter(function(m){ return m.t==="big"; }).pop();
ok(!!word, "charades: a word message is sent");
ok(word && word.word === "Riding a horse", "charades: sends the first word, got " + (word&&word.word));
ok(word && word.actor === "Dean", "charades: names an actor, got " + (word&&word.actor));
ok(big && String(big.text).indexOf("Riding a horse") < 0,
   "charades: THE WORD MUST NOT GO TO THE TELLY, big said: " + (big&&big.text));
ok(big && String(big.text).indexOf("Dean") >= 0, "charades: the telly names the actor");

X.charadesGo();
var word2 = sent.filter(function(m){ return m.t==="charades"; })[1];
ok(word2 && word2.actor === "Nicole", "charades: the turn moves on, got " + (word2&&word2.actor));
ok(word2 && word2.word === "Making a cup of tea", "charades: second word");

X.charadesGo();   // past the end
var last = sent.filter(function(m){ return m.t==="big"; }).pop();
ok(String(last.text).toLowerCase().indexOf("done") >= 0, "charades: ends cleanly, got " + last.text);

// ---------------- who am I ----------------
sent = [];
X.runGuessWho({ config:{ items:[{q:"Elvis Presley"},{q:"A kangaroo"}] } });
X.guessWhoGo();
var gw  = sent.filter(function(m){ return m.t==="guesswho"; })[0];
var gbig = sent.filter(function(m){ return m.t==="big"; }).pop();
ok(!!gw, "who am I: an answer message is sent");
ok(gw && gw.answer === "Elvis Presley", "who am I: sends the answer, got " + (gw&&gw.answer));
ok(gw && gw.guesser === "Dean", "who am I: names the guesser");
ok(gbig && String(gbig.text).indexOf("Elvis") >= 0,
   "who am I: the answer DOES go on the telly, got " + (gbig&&gbig.text));
ok(gbig && String(gbig.sub||"").indexOf("Dean") >= 0, "who am I: the telly warns the guesser off");

// nobody joined: must not deal a round to nobody
sent = []; toasts = [];
X.setPlayers([]);
X.runGuessWho({ config:{ items:[{q:"Elvis Presley"}] } });
X.guessWhoGo();
ok(sent.filter(function(m){ return m.t==="guesswho"; }).length === 0,
   "who am I: with nobody joined it deals nothing");
ok(toasts.length > 0, "who am I: and says why");

// -------- somebody walks in halfway through --------
// They used to stare at a waiting screen until the next round, with no idea
// whether it was broken.
sent = [];
X.setPlayers(["Dean","Nicole"]);
X.runCharades({ config:{ items:[{q:"Riding a horse"}] } });
X.charadesGo();
sent = [];                      // everything before the late joiner
X.resend();
var again = sent.filter(function(m){ return m.t==="charades"; })[0];
ok(!!again, "a late joiner is sent the current round");
ok(again && again.word === "Riding a horse", "with the right word, got " + (again&&again.word));
ok(again && again.actor === "Dean", "and the right actor, got " + (again&&again.actor));

sent = [];
X.runGuessWho({ config:{ items:[{q:"Elvis Presley"}] } });
X.guessWhoGo();
sent = [];
X.resend();
var gwAgain = sent.filter(function(m){ return m.t==="guesswho"; })[0];
ok(!!gwAgain && gwAgain.answer === "Elvis Presley", "who am I resends too");

// and it must say nothing at all before a round has started
sent = [];
X.runCharades({ config:{ items:[{q:"x"}] } });
X.resend();
ok(sent.filter(function(m){ return m.t==="charades"; }).length === 0,
   "nothing is resent before the first round");

// ---------------- two truths and a lie: the night total ----------------
// The tally used to be computed and discarded: everybody got a flat hundred, so
// spotting five lies scored the same as spotting one.
(function(){
  var V = [
    { name:"Dean",   right:true  },
    { name:"Dean",   right:true  },
    { name:"Dean",   right:true  },
    { name:"Nicole", right:true  },
    { name:"Sam",    right:false },
    { name:"Sam",    right:false }
  ];
  var rows = X.truthsTally(V);
  function scoreOf(n){ var r = rows.filter(function(x){ return x.name===n; })[0]; return r ? r.score : 0; }
  var P = 100;   // PPQuiz.CORRECT_POINTS
  ok(scoreOf("Dean") === 3 * P, "three right should score three lots, got " + scoreOf("Dean"));
  ok(scoreOf("Nicole") === P,   "one right scores one lot, got " + scoreOf("Nicole"));
  ok(scoreOf("Sam") === 0,      "nobody who got none appears, got " + scoreOf("Sam"));
  ok(scoreOf("Dean") > scoreOf("Nicole"), "the better guesser must finish ahead");
  ok(X.truthsTally([]).length === 0,   "no votes, no rows");
  ok(X.truthsTally(null).length === 0, "no votes at all does not throw");
})();

print(fail ? "FAILED " + fail + " of " + (pass+fail) : "ALL " + pass + " CHECKS PASSED");
