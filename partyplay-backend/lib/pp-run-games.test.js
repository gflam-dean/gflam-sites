/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

/* CHARADES AND WHO AM I: the secrecy is the whole game.
 *
 * These two are the only games where showing something to the wrong screen ruins
 * them, and that cannot be checked by looking at the page. So load the real
 * runners out of run.html, drive them, and read what they actually broadcast.
 *
 *   jsc lib/pp-run-games.test.js
 */
var src = readFile(ppFile("partyplay/run.html"));
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
/* pick() rejection-samples crypto.getRandomValues, and jsc has no crypto at all, so
   flip() threw before it could be tested. FLIPS lets a check say which side comes up:
   0 is heads, 1 is tails, and an empty queue falls back to something random. */
var FLIPS = [];
g.crypto = { getRandomValues: function(a){
  a[0] = FLIPS.length ? FLIPS.shift() : (Math.random() < 0.5 ? 0 : 1);
  return a;
} };
g.addEventListener = function(){};
g.URLSearchParams = function(){ this.get=function(k){ return k==="code"?"ABCDEF":"k"; }; };
g.PPConfig = { API:"https://x", SUPA_URL:"https://y", SUPA_ANON:"z", channel:function(c){return "pp-"+c;} };
// The real one is loaded by a <script src>, which this harness does not follow.
g.PPQuiz = { CORRECT_POINTS: 100, SPEED_POINTS: 0, options: function(){ return []; } };
// Same again for the licence library, which decides whether the party is still on.
g.PPLicence = { isLive: function(l){ return Date.now() < l.endsAt; },
                timeLeft: function(){ return "some time"; } };

// expose the internals we want to drive
/* The runners live inside the page's own IIFE, so the export has to go INSIDE
   it, immediately before it closes, or none of these names are in scope. */
var EXPORT = "\n; globalThis.__X = { runCharades:runCharades, runGuessWho:runGuessWho," +
  " charadesGo:charadesGo, guessWhoGo:guessWhoGo, setSend:function(f){ send=f; }," +
  " setPlayers:function(p){ players=p; }, getG:function(){ return G; }, setToast:function(f){ toast=f; }," +
  " truthsTally:truthsTally, resend:function(){ if(G && G.resend) G.resend(); }, runHeads:runHeads, flip:flip, truthsEnd:truthsEnd, setG:function(o){ G=o; }, licenceTick:licenceTick, setParty:function(p){ PARTY=p; }, getParty:function(){ return PARTY; } };\n";
var cut = body.lastIndexOf("})();");
if (cut < 0) { print("could not find the end of the IIFE"); throw new Error("no IIFE"); }
var harness = body.slice(0, cut) + EXPORT + body.slice(cut);
try {
  (new Function("globalThis","window","document","location","localStorage","sessionStorage",
                "fetch","setTimeout","setInterval","clearTimeout","clearInterval",
                "URLSearchParams","PPConfig","PPQuiz","PPLicence","navigator","screen","alert","confirm","requestAnimationFrame","crypto", harness))
    (g, g, g.document, g.location, g.localStorage, g.sessionStorage, g.fetch,
     g.setTimeout, g.setInterval, g.clearTimeout, g.clearInterval, g.URLSearchParams, g.PPConfig, g.PPQuiz, g.PPLicence, g.navigator, g.screen, g.alert, g.confirm, g.requestAnimationFrame, g.crypto);
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


// ---------------- heads or tails: you cannot win before the first flip ----------
/* THE CONSOLE OPENED ON "Winner: Sam". paintHeads drew the winner panel whenever one
   player was left standing, and with a single guest joined that is true before a coin
   has been flipped. There was no Flip it button, so the game could not be played at all,
   and the rule that says an untouched phone cannot take the prize never ran, because it
   lives in flip(). Found 15 Sep 2026 by opening the game with one phone in the party. */
(function(){
  function app(){ return dom["app"] ? String(dom["app"].innerHTML) : ""; }

  sent = []; FLIPS = [];
  X.setPlayers(["Sam"]);
  X.runHeads({});
  ok(app().indexOf("Winner") < 0,
     "one player: nobody has won anything yet, console said: " + app().slice(0,160));
  ok(app().indexOf('id="flip"') < 0, "one player: there is nothing to flip");
  ok(app().indexOf("needs two") >= 0, "one player: the host is told why");
  ok(sent.filter(function(m){ return m.t==="heads"; }).length === 0,
     "one player: the phones are not told to pick when there is no game");
  ok(sent.filter(function(m){ return m.t==="big"; }).length === 0,
     "one player: the television is not told to pick either");

  sent = []; FLIPS = [];
  X.setPlayers(["Sam","Jordan","Dean"]);
  X.runHeads({});
  ok(app().indexOf('id="flip"') >= 0, "three players: the game can be played");
  ok(app().indexOf("Winner") < 0, "three players: no winner before the first flip");
  ok(sent.filter(function(m){ return m.t==="heads"; }).length === 1, "three players: the phones are told");

  /* And the last one standing having never touched their phone is still not a winner,
     on the CONSOLE as well as in the caption. Only Sam ever picks; the moment a tails
     comes up Sam is out and Jordan is left, having played nothing. */
  sent = []; FLIPS = [];
  X.setPlayers(["Sam","Jordan"]);
  X.runHeads({});
  var G = X.getG(), guard = 0;
  while(!G.over && guard++ < 60){
    G.picks = { Sam:"heads" }; G.everPicked = { Sam:true };
    FLIPS = [ guard < 3 ? 0 : 1 ];        // two heads to prove it does not end early, then tails
    X.flip();
  }
  ok(G.over, "the round finishes");
  ok(G.winner === null, "a player who never picked is not the winner, got " + G.winner);
  ok(app().indexOf("Jordan") < 0, "and the console does not name them, said: " + app().slice(-200));
  ok(app().indexOf("never picked") >= 0, "the console says why there is no winner");
  var lastBig = sent.filter(function(m){ return m.t==="big"; }).pop();
  ok(lastBig && String(lastBig.text).indexOf("All out") >= 0,
     "and the television agrees, said: " + (lastBig && lastBig.text));
})();

// -------- two truths and a lie: the room has to be told who won ---------------
/* THE TALLY WAS WORKED OUT, BANKED AND THROWN AWAY. The end of the round sent
   {t:"lobby"} and nothing else, so the television dropped back to the join code in
   the middle of the party and no phone learned anything. Spotting five lies looked
   exactly like spotting none, which is the whole point of the game. Found 15 Sep 2026
   by playing a round with two phones and watching the telly at the end. */
(function(){
  sent = [];
  X.setG({ mode:"truths", phase:"play", turn:2, subs:[], repaint:function(){},
           votes:[ {turn:0,name:"Sam",right:true}, {turn:0,name:"Jordan",right:false},
                   {turn:1,name:"Sam",right:true}, {turn:1,name:"Dean",right:true} ] });
  X.truthsEnd();
  var board = sent.filter(function(m){ return m.t==="board"; })[0];
  var cap   = sent.filter(function(m){ return m.t==="big"; }).pop();
  ok(!!board, "the phones are sent the tally");
  ok(board && board.rows && board.rows.length === 2,
     "everyone who caught one is on it, got " + (board && board.rows && board.rows.length));
  ok(board && board.rows[0].name === "Sam",
     "best spotter first, got " + (board && board.rows[0] && board.rows[0].name));
  ok(board && board.rows[0].score > board.rows[1].score,
     "two right must beat one right, got " + (board && board.rows[0].score) + " v " + (board && board.rows[1].score));
  ok(!!cap && String(cap.text).indexOf("Sam") >= 0,
     "the television names the winner, said: " + (cap && cap.text));
  ok(sent.filter(function(m){ return m.t==="lobby"; }).length === 0,
     "no lobby at the end, or it clears the phones and the caption wipes the board");

  // and nobody catching a lie is a result too, not a blank wall
  sent = [];
  X.setG({ mode:"truths", phase:"play", turn:1, subs:[], repaint:function(){},
           votes:[ {turn:0,name:"Sam",right:false} ] });
  X.truthsEnd();
  var board2 = sent.filter(function(m){ return m.t==="board"; })[0];
  var cap2   = sent.filter(function(m){ return m.t==="big"; }).pop();
  ok(board2 && board2.rows.length === 0, "nobody caught one, so nobody is on the board");
  ok(cap2 && String(cap2.sub).toLowerCase().indexOf("nobody caught") >= 0,
     "and the wall says so rather than going blank, said: " + (cap2 && cap2.sub));
})();

// ---------- when the twenty four hours runs out, the room has to be told ----------
/* THE CONSOLE KNEW AND THE ROOM DID NOT. The licence tick flipped the host's own screen
   to "That is a wrap" and sent nothing, so the television held its last caption and every
   phone held its last screen for ever, while the person holding the tablet was the only
   one who could see the party had ended. And there was no warning before it either: the
   clock counted down and then the screen simply changed. Found 15 Sep 2026 by reading the
   one path a play-through cannot reach in under a day. */
(function(){
  function party(minsLeft){
    return { status:"live", code:"ABCDEF",
             startsAt:new Date(Date.now()-3600000).toISOString(),
             endsAt:new Date(Date.now()+minsLeft*60000).toISOString() };
  }

  // Plenty of time left: say nothing to anybody.
  sent = []; toasts = [];
  X.setParty(party(120));
  X.licenceTick();
  ok(sent.length === 0, "two hours left: the room is not told anything");
  ok(toasts.length === 0, "two hours left: the host is not nagged either");
  ok(X.getParty().status === "live", "and the party is still live");

  // Half an hour: the HOST is told, and only the host.
  sent = []; toasts = [];
  X.setParty(party(25));
  X.licenceTick();
  ok(toasts.length === 1 && /half an hour/i.test(toasts[0]),
     "half an hour left: the host is warned, got " + JSON.stringify(toasts));
  ok(sent.length === 0,
     "and it does NOT go on the wall: thirty guests do not need a countdown");
  X.licenceTick();
  ok(toasts.length === 1, "and it is said once, not every thirty seconds");

  // Ten minutes: a second, sharper warning.
  sent = []; toasts = [];
  X.licenceTick();                      // still the same party object, now inside 10m? no
  X.setParty(party(8));
  X.licenceTick();
  ok(toasts.length === 1 && /ten minutes/i.test(toasts[0]),
     "ten minutes left: warned again, got " + JSON.stringify(toasts));
  ok(sent.length === 0, "still nothing on the wall");

  // And when it is actually over, every surface is told before the console changes.
  sent = []; toasts = [];
  X.setParty(party(-1));
  X.licenceTick();
  var lob = sent.filter(function(m){ return m.t==="lobby"; });
  var big = sent.filter(function(m){ return m.t==="big"; });
  ok(lob.length === 1, "time up: the phones are told to let go of whatever they held");
  ok(big.length === 1 && /wrap/i.test(big[0].text),
     "time up: the wall says so, got " + JSON.stringify(big));
  ok(sent.indexOf(lob[0]) < sent.indexOf(big[0]),
     "lobby BEFORE the caption, or a phone holding a game swallows it");
  ok(X.getParty().status === "finished", "and only then does the console change");
})();

print(fail ? "FAILED " + fail + " of " + (pass+fail) : "ALL " + pass + " CHECKS PASSED");
