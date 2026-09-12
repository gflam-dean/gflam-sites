/* WHAT HAPPENS AFTER SOMEBODY WINS. Driven through the real console, venueplay/app/index.html.

   Found on 12 Sep 2026 by driving the live console by hand: every bingo suite in the repo
   stops at the claim. bingo-win.test.js decides whether a ticket has won. bingo-console.test.js
   keeps the buttons still and asks the server for the headcount. NOTHING drove the host past
   "Confirm winner", and the end of a game is where the room is loudest and the prize is handed
   over. It works today (the wall read "WE HAVE A WINNER ... Card #332" and the winner's phone
   read "YOU WON!") and nothing in the gate would have noticed if it stopped.

   WHY THE ASSERTIONS ARE ABOUT MESSAGES. Broadcast bingo has no game server. The wall and every
   phone in the room are driven ENTIRELY by what this console sends on the venue channel, so a
   console whose own DOM is perfect and whose winner message is malformed is a silent room. send()
   is stubbed to capture, and the shape of each message is the thing under test.

   THREE THINGS THAT ARE TRUE AND EACH COST SOMETHING:
     - "Announce the win" is a DISABLED label on the Next number button, not a button. Anything
       waiting for it to be pressed waits forever. The only way out of the win state is the two
       buttons on the claim card.
     - The claim card is re-rendered on every state change (innerHTML is replaced), so a handler
       bound to a button dies on the next render. The listener is delegated to #claimQueue. This
       suite clicks through that listener, after several re-renders, or it proves nothing.
     - nextBall() refuses while a win is unannounced and says so, because the tie window is pinned
       to the ball the claim landed on and calling past it makes the console deaf.

   The real functions are lifted out of the page rather than restated, for the reason
   bingo-console.test.js gives: a copy keeps passing while the page changes underneath it.

   Run: jsc venueplay-backend/app/bingo-after-the-win.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

var CANDIDATES = ["venueplay/app/index.html", "index.html", "./index.html"];
var html = null;
for (var ci = 0; ci < CANDIDATES.length; ci++) {
  try { var t = readFile(CANDIDATES[ci]); if (t && t.length > 40000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find the bingo console index.html"); throw new Error("no source"); }

function grab(name){
  var i = html.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
function grabLine(prefix){
  var i = html.indexOf(prefix); if (i < 0) return null;
  var j = html.indexOf("\n", i); return html.slice(i, j < 0 ? html.length : j);
}
/* The delegated listener is a statement, not a function, so it is taken by balancing the
   parentheses of the addEventListener call itself. */
function grabCall(prefix){
  var i = html.indexOf(prefix); if (i < 0) return null;
  var k = html.indexOf("(", i + prefix.length - 1);
  if (k < 0) return null;
  var d = 0;
  for (var j = k; j < html.length; j++) {
    if (html[j] === "(") d++;
    else if (html[j] === ")") { d--; if (d === 0) return html.slice(i, j + 1) + ";"; }
  }
  return null;
}

print("== the end of a game is still written in the console ==");
var NEED = ["isCalled", "rowComplete", "completeRows", "cornerNums", "checkPattern",
            "calledArray", "playerCount", "sendState", "sendClaimPending",
            "winnerNames", "renderClaimCard", "renderClaimQueue", "syncNextBtn",
            "nextPattern", "hostConfirm", "hostConfirmAll", "hostReject",
            "announce", "keepPlaying", "finishGame", "nextBall", "onMsg"];
var SRC = {}, missing = [];
NEED.forEach(function(n){ SRC[n] = grab(n); if (!SRC[n]) missing.push(n); });
ok("every function the end of a game runs through is still there", missing.length === 0, missing.join(", "));

var LISTENER = grabCall('$("claimQueue").addEventListener');
ok("the claim queue still has a listener on it", !!LISTENER);

var PAT_NAMES_SRC = grabLine("var PATTERN_NAMES={");
var ALL_PAT_SRC = grabLine("var ALL_PATTERNS=[");
ok("the pattern names and the pattern list are still there", !!PAT_NAMES_SRC && !!ALL_PAT_SRC);
if (missing.length || !LISTENER || !PAT_NAMES_SRC || !ALL_PAT_SRC) {
  print(""); print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error("missing source");
}

/* ---------------- a DOM small enough to run the end of a game and nothing more ---------------- */
var made = {};
function el(id){
  var raw = "";
  var node = {
    id: id || "", textContent: "", value: "", disabled: false, style: { display:"", borderColor:"" },
    children: [], _on: {},
    appendChild: function(n){ this.children.push(n); },
    addEventListener: function(ev, fn){ this._on[ev] = this._on[ev] || []; this._on[ev].push(fn); },
    classList: {
      _s: {},
      add: function(c){ this._s[c] = true; },
      remove: function(c){ delete this._s[c]; },
      toggle: function(c, on){ if (on) this._s[c] = true; else delete this._s[c]; },
      contains: function(c){ return !!this._s[c]; }
    }
  };
  // innerHTML EMPTIES the element, exactly as a browser does. Without that, a listener bound to a
  // button would look like it survived a re-render, and this suite exists to catch that.
  Object.defineProperty(node, "innerHTML", {
    get: function(){ return raw; },
    set: function(v){ raw = String(v); node.children = []; }
  });
  return node;
}
function $(id){ if (!made[id]) made[id] = el(id); return made[id]; }
var document = { createElement: function(){ return el(); } };
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

var MSGS = [];
function send(o){ MSGS.push(o); }
function sent(t){ return MSGS.filter(function(m){ return m.t === t; }); }
function lastOf(t){ var l = sent(t); return l.length ? l[l.length-1] : null; }

var saves = 0;      function saveGame(){ saves++; }
var toasts = [];    function showToast(m){ toasts.push(m); }
var chimes = 0;     function claimChime(){ chimes++; }
var dealt = 0;      function dealCards(){ dealt++; }
var pushedCards = 0;
function sendCards(pid){ pushedCards++; var p = G.players[pid]; if (!p || !p.cards) return;
  send({ t:"cards", pid:pid, cards:p.cards.map(function(c){ return { cells:c.card, cardNo:c.cardNo }; }) }); }
function sendPlayers(){ send({ t:"players", count: playerCount() }); }
var VP_HOLD = { busy: function(){ return false; }, hold: function(){}, release: function(){} };
var window = { VP_HOLD: VP_HOLD };
var MAX_TIE = 8;
/* A guard that has been taken out must produce a NAMED red line, not an exception from a
   stub. So the server is a counter and a promise that never settles: nextBall gets all the
   way through, no ball lands, and the checks below say which guard went missing. */
var ballRequests = 0;
function serverBall(){ ballRequests++; return { then: function(){ return this; } }; }
function reportLocalBall(){}
function goLocalDraw(){}
function drawFromPool(){ throw new Error("nextBall drew a ball: a guard let it through"); }
function commitBall(){ throw new Error("nextBall committed a ball: a guard let it through"); }
function tvHere(){}
function renderLive(){ renderClaimQueue(); }
var consoleRenders = 0;
// The real renderConsole reaches renderClaimQueue through renderLive, which is the only part of
// it this suite is about. Everything else it does is board, player list and coach line.
function renderConsole(){ consoleRenders++; if (G.status === "running") renderLive(); }
function updateBoard(){}

var G;
eval(PAT_NAMES_SRC); eval(ALL_PAT_SRC);
// eval at GLOBAL scope: inside a callback these become locals and the page's own functions
// cannot see each other, which reads exactly like a missing function.
eval(NEED.map(function(n){ return SRC[n]; }).join("\n"));
eval(LISTENER);

var listenerBinds = $("claimQueue")._on.click ? $("claimQueue")._on.click.length : 0;
ok("the listener is delegated to the claim queue itself, bound once at load", listenerBinds === 1,
   listenerBinds + " click handlers on #claimQueue");
ok("no button carries its own listener, so a re-render cannot unwire the host",
   SRC.renderClaimQueue.indexOf("addEventListener") < 0,
   "renderClaimQueue replaces its own innerHTML on every state change");

/* Click the way a host does: find the button in the markup the console actually rendered, and
   put it through the delegated listener. A button that is not in the markup cannot be clicked. */
function findBtn(act, i){
  var q = $("claimQueue").innerHTML, re = /<button[^>]*>/g, m;
  while ((m = re.exec(q))) {
    var a = /data-act="([a-z]+)"/.exec(m[0]); if (!a || a[1] !== act) continue;
    var d = /data-i="(\d+)"/.exec(m[0]);
    if (i != null && (!d || parseInt(d[1], 10) !== i)) continue;
    return { act:a[1], i:(d ? d[1] : null) };
  }
  return null;
}
function click(act, i){
  var b = findBtn(act, i);
  if (!b) return false;
  var node = { getAttribute: function(k){ return k === "data-act" ? b.act : (k === "data-i" ? b.i : null); } };
  node.closest = function(){ return node; };
  $("claimQueue")._on.click[0]({ target: node });
  return true;
}
/* keepPlaying reads the select and the input the win card rendered. Take their values OUT OF THAT
   MARKUP, so the default next pattern under test is the one the host is actually shown. */
function syncWinCardControls(){
  var q = $("claimQueue").innerHTML;
  var s = /<option value="([a-z]+)" selected>/.exec(q);
  $("nextPatternSel").value = s ? s[1] : "";
  var p = /id="nextPrizeIn" value="([^"]*)"/.exec(q);
  $("nextPrizeIn").value = p ? p[1] : "";
}

/* ---------------- a real ticket, and a room ---------------- */
var CARD_A = [[ 4, 0,23, 0,45, 0,67, 0,88],
              [ 0,12,26,34, 0,58, 0,71, 0],
              [ 9, 0, 0,38,49,54, 0,79,90]];
var CARD_B = [[ 4, 0,23, 0,45, 0,67, 0,88],
              [ 0,15,27,35, 0,59, 0,72, 0],
              [ 8, 0, 0,39,48,55, 0,78,89]];
var CARD_C = [[ 1, 0,22, 0,44, 0,66, 0,81],
              [ 0,16,28,36, 0,57, 0,73, 0],
              [ 7, 0, 0,37,47,56, 0,77,82]];   // wins nothing on this draw
var DRAW = [4, 23, 45, 67, 88];                 // the last ball completes the top row of A and B

function room(cards){
  G = { code:"TUGUN", status:"running", pattern:"one", prize:"$100 house", defaultCards:1,
        allowEarly:false, paidMode:"", draw:DRAW.slice(), idx:DRAW.length-1, called:{},
        pool:[], players:{}, order:[], claims:[], claimIdx:-1, claimSeq:0, won:false,
        lastWins:[], prizesWon:[], startedAt:"2026-09-12T10:00:00Z", joinCode:"4821", sessionId:"s1" };
  for (var i = 0; i < DRAW.length; i++) G.called[DRAW[i]] = true;
  Object.keys(cards).forEach(function(pid){
    G.players[pid] = { name: cards[pid].name, cards: [{ card: cards[pid].card, cardNo: cards[pid].no }], paid: 0 };
    G.order.push(pid);
  });
  MSGS = []; toasts = []; saves = 0; chimes = 0; dealt = 0; pushedCards = 0; consoleRenders = 0;
  made.claimQueue.innerHTML = "";
}

/* ================= 1. ONE WINNER, ALL THE WAY THROUGH ================= */
print("");
print("== a claim arrives, the host confirms, and nothing is announced yet ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
ok("the claim is queued against the ball it was called on", G.claims.length === 1 && G.claimIdx === G.idx,
   G.claims.length + " claim(s), claimIdx " + G.claimIdx + " vs idx " + G.idx);
ok("the wall is told a bingo has been called", !!lastOf("claim_pending"), MSGS.map(function(m){return m.t;}).join(","));
ok("and it names who called", (lastOf("claim_pending")||{}).name === "Kate");
ok("the tablet chimes so the host looks up", chimes === 1, String(chimes));
var qHtml = $("claimQueue").innerHTML;
ok("the host is shown a Confirm winner button", !!findBtn("confirm", 0), qHtml.slice(0, 120));
ok("the card names the player and the ticket", qHtml.indexOf("Kate") >= 0 && qHtml.indexOf("#332") >= 0);

MSGS = [];
ok("the host taps Confirm winner and it goes through the delegated listener", click("confirm", 0));
ok("the winner is confirmed", G.lastWins.length === 1 && G.lastWins[0].name === "Kate");
ok("and the queue is empty", G.claims.length === 0);
ok("NOTHING is broadcast on confirm alone: the host has not decided play on or finish",
   MSGS.length === 0, MSGS.map(function(m){ return m.t; }).join(","));

print("== the Next number button becomes a label, not a way out ==");
ok("the big button is disabled while a win is unannounced", $("nextBtn").disabled === true);
ok("and it reads Announce the win", $("nextBtn").textContent === "Announce the win",
   "got '" + $("nextBtn").textContent + "'");
MSGS = []; toasts = [];
nextBall();
ok("tapping it draws no ball", G.draw.length === DRAW.length && MSGS.length === 0);
ok("and the console SAYS why, rather than doing nothing",
   toasts.length === 1 && toasts[0].indexOf("Announce the win first") === 0, toasts.join(" / "));
ok("it never even asks the server for a ball", ballRequests === 0, String(ballRequests));
ok("and the button still reads Announce the win afterwards",
   $("nextBtn").textContent === "Announce the win", "'" + $("nextBtn").textContent + "'");

print("== the win state offers exactly two ways out ==");
var win = $("claimQueue").innerHTML;
ok("the win card is up", win.indexOf("Kate won One line") >= 0, win.slice(0, 160));
ok("Keep playing is offered", !!findBtn("keepplaying"));
ok("Finish game is offered", !!findBtn("finish"));
ok("Confirm winner is gone, so there is nothing left to confirm", !findBtn("confirm"));
ok("it says the tickets and the numbers are kept", win.indexOf("Same tickets, same numbers") >= 0);
ok("the next pattern is pre-picked as the natural one after a line",
   /<option value="two" selected>/.test(win), win.slice(win.indexOf("nextPatternSel"), win.indexOf("nextPatternSel")+220));
ok("and the pattern just won is not offered again", win.indexOf('<option value="one"') < 0);
ok("the prize field carries this game's prize forward", /id="nextPrizeIn" value="\$100 house"/.test(win));

print("== Finish game leaves the win state and broadcasts the finish ==");
MSGS = [];
ok("the host taps Finish game", click("finish"));
var w = lastOf("winner");
ok("a winner message goes out", !!w, MSGS.map(function(m){ return m.t; }).join(","));
ok("exactly one message: the finish is the announcement", MSGS.length === 1, String(MSGS.length));
ok("it names the winner", w && w.name === "Kate" && w.pid === "p1");
ok("it carries the card number the wall prints", w && w.cardNo === 332, w && String(w.cardNo));
ok("it names the pattern that was won", w && w.pattern === "one");
ok("it carries the prize for that stage", w && w.prize === "$100 house", w && w.prize);
ok("winners[] carries the whole result, so a screen never has to guess",
   w && w.winners && w.winners.length === 1 && w.winners[0].name === "Kate");
ok("it is not a shared win", w && w.shared === false);
ok("cont is FALSE, which is how the wall knows the game is over", w && w.cont === false, w && String(w.cont));
ok("and there is no next pattern on it", w && w.next === undefined && w.nextPrize === undefined);
ok("the game is marked done", G.won === true);
ok("the confirmed list is cleared, so it cannot be announced twice", G.lastWins.length === 0);
ok("the tie window on that ball is shut", G.claimIdx === -1);
ok("the prize is on the record for the report", G.prizesWon.length === 1 &&
   G.prizesWon[0].winner_name === "Kate" && G.prizesWon[0].prize === "$100 house" &&
   G.prizesWon[0].card_no === 332 && G.prizesWon[0].shared === false,
   JSON.stringify(G.prizesWon));
ok("the console left the win state", !findBtn("finish") && !findBtn("keepplaying"),
   $("claimQueue").innerHTML.slice(0, 120));
ok("and the big button says the game is done, not Next number",
   $("nextBtn").disabled === true && $("nextBtn").textContent === "Game done",
   "'" + $("nextBtn").textContent + "'");
MSGS = []; toasts = [];
nextBall();
ok("a tap after the finish still draws no ball",
   MSGS.length === 0 && G.draw.length === DRAW.length && ballRequests === 0);
ok("and says the game is done", toasts.length === 1 && toasts[0].indexOf("That game is done") === 0, toasts.join(" / "));

/* ================= 2. KEEP PLAYING ================= */
print("");
print("== Keep playing starts a new pattern and KEEPS the tickets and the numbers ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
var TICKETS_BEFORE = G.players.p1.cards;
onMsg({ t:"claim", pid:"p1", cardNo:332 });
click("confirm", 0);
syncWinCardControls();
var drawBefore = G.draw.join(","), calledBefore = Object.keys(G.called).sort().join(",");
MSGS = [];
ok("the host taps Keep playing", click("keepplaying"));

var kw = lastOf("winner"), ks = lastOf("state");
ok("the win is announced first", !!kw);
ok("cont is TRUE, so the wall celebrates and goes back to the board", kw && kw.cont === true);
ok("the message carries the pattern the room plays for next", kw && kw.next === "two", kw && String(kw.next));
ok("and the prize for it", kw && kw.nextPrize === "$100 house", kw && String(kw.nextPrize));
ok("the announcement still carries the prize for the stage just WON, not the next one",
   kw && kw.prize === "$100 house" && kw.pattern === "one");
ok("a state message follows, so every phone repaints straight away", !!ks);
ok("the state names the new pattern", ks && ks.pattern === "two", ks && ks.pattern);
ok("the game is live again", ks && ks.active === true && G.won === false);

ok("THE CALLED NUMBERS ARE KEPT on the console", G.draw.join(",") === drawBefore &&
   Object.keys(G.called).sort().join(",") === calledBefore, G.draw.join(","));
ok("and the state message carries them, so no screen clears its board",
   ks && ks.called.join(",") === drawBefore, ks && ks.called.join(","));
ok("THE TICKETS ARE KEPT: the same ticket objects, untouched",
   G.players.p1.cards === TICKETS_BEFORE && G.players.p1.cards[0].cardNo === 332);
ok("nobody is re-dealt", dealt === 0 && pushedCards === 0, dealt + " deal(s), " + pushedCards + " card push(es)");
ok("no new game is broadcast: a started or a mode message here would reset every phone",
   sent("started").length === 0 && sent("mode").length === 0 && sent("cards").length === 0,
   MSGS.map(function(m){ return m.t; }).join(","));
ok("keepPlaying itself never deals", SRC.keepPlaying.indexOf("dealCards") < 0 &&
   SRC.keepPlaying.indexOf("freshPool") < 0);
ok("the stage just won is on the record against ITS prize", G.prizesWon.length === 1 &&
   G.prizesWon[0].pattern === "one" && G.prizesWon[0].prize === "$100 house");
ok("the console left the win state and is waiting for claims again",
   !findBtn("finish") && !findBtn("keepplaying") &&
   $("claimQueue").innerHTML.indexOf("No claims yet") >= 0, $("claimQueue").innerHTML.slice(0, 100));
ok("and the big button is live again", $("nextBtn").disabled === false &&
   $("nextBtn").textContent === "Next number", "'" + $("nextBtn").textContent + "'");
MSGS = [];
ok("a claim on the NEW pattern is now taken", (function(){
  G.called[12] = true; G.called[26] = true; G.called[34] = true; G.called[58] = true; G.called[71] = true;
  G.draw = G.draw.concat([12,26,34,58,71]); G.idx = G.draw.length - 1;
  onMsg({ t:"claim", pid:"p1", cardNo:332 });
  return G.claims.length === 1;
})(), G.claims.length + " claim(s) after two lines completed");

print("== the host is given a DIFFERENT next pattern and it is honoured ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
click("confirm", 0);
$("nextPatternSel").value = "corners"; $("nextPrizeIn").value = "$300 jackpot";
MSGS = [];
click("keepplaying");
ok("the pattern the host chose is what goes out", (lastOf("winner")||{}).next === "corners");
ok("and the prize they typed", (lastOf("winner")||{}).nextPrize === "$300 jackpot");
ok("the console is playing for it", G.pattern === "corners" && G.prize === "$300 jackpot");
ok("the state message agrees", (lastOf("state")||{}).pattern === "corners" &&
   (lastOf("state")||{}).prize === "$300 jackpot");

/* ================= 3. TWO WINNERS ON THE SAME BALL ================= */
print("");
print("== two people call on the same number, and a tie splits the prize ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 }, p2: { name:"Sam", card:CARD_B, no:87 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
onMsg({ t:"claim", pid:"p2", cardNo:87 });
ok("both claims are queued", G.claims.length === 2, String(G.claims.length));
ok("they are on the same ball", G.claimIdx === G.idx);
var cp = lastOf("claim_pending");
ok("the wall names both callers", cp && cp.names && cp.names.length === 2 &&
   cp.names.join(",") === "Kate,Sam", JSON.stringify(cp && cp.names));
var tie = $("claimQueue").innerHTML;
ok("the console says it is a tie, on the number it happened on",
   tie.indexOf("2 called on number 88") >= 0, tie.slice(0, 200));
ok("and that a tie splits the prize", tie.indexOf("a tie splits the prize") >= 0);
ok("one button settles it", !!findBtn("confirmall"));
ok("the split button names how many are valid", tie.indexOf("Split between the 2 valid") >= 0);

MSGS = [];
ok("the host taps the split button", click("confirmall"));
ok("both are confirmed", G.lastWins.length === 2 && G.claims.length === 0,
   G.lastWins.length + " win(s), " + G.claims.length + " claim(s)");
ok("still nothing broadcast until the host decides", MSGS.length === 0,
   MSGS.map(function(m){ return m.t; }).join(","));
var tw = $("claimQueue").innerHTML;
ok("the win card names both winners", tw.indexOf("Kate and Sam won One line") >= 0, tw.slice(0, 200));
ok("and says the prize is shared", tw.indexOf("2 winners share the prize") >= 0);

MSGS = [];
click("finish");
var t2 = lastOf("winner");
ok("the winner message says it is shared", t2 && t2.shared === true);
ok("winners[] carries both", t2 && t2.winners.length === 2 &&
   t2.winners[0].name === "Kate" && t2.winners[1].name === "Sam", JSON.stringify(t2 && t2.winners));
ok("each winner keeps their own card number, which is what they claim on",
   t2 && t2.winners[0].cardNo === 332 && t2.winners[1].cardNo === 87);
ok("the legacy top-level fields name the FIRST caller, for a screen on the old shape",
   t2 && t2.name === "Kate" && t2.cardNo === 332);
ok("the game is done", G.won === true && G.lastWins.length === 0);
ok("both prizes are on the record, both flagged shared", G.prizesWon.length === 2 &&
   G.prizesWon[0].shared === true && G.prizesWon[1].shared === true, JSON.stringify(G.prizesWon));

print("== a tie announces in CALL order, not in the order the host tapped ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 }, p2: { name:"Sam", card:CARD_B, no:87 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });   // Kate shouted first
onMsg({ t:"claim", pid:"p2", cardNo:87 });
ok("the host serves Sam first, because Sam is at the bar", click("confirm", 1));
ok("Sam is confirmed first", G.lastWins.length === 1 && G.lastWins[0].name === "Sam");
ok("Kate is still waiting, so the win card is NOT offered yet",
   !findBtn("finish") && !findBtn("keepplaying"), $("claimQueue").innerHTML.slice(0, 120));
ok("and the console says who is already confirmed",
   $("claimQueue").innerHTML.indexOf("Already confirmed: <b>Sam</b>") >= 0);
click("confirm", 0);
ok("now both are in", G.lastWins.length === 2);
MSGS = [];
click("finish");
var t3 = lastOf("winner");
ok("the announcement still leads with whoever CALLED first", t3 && t3.name === "Kate",
   t3 && t3.name);
ok("and winners[] is in call order", t3 && t3.winners.map(function(x){ return x.name; }).join(",") === "Kate,Sam",
   t3 && JSON.stringify(t3.winners));

print("== a tie can keep playing too ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 }, p2: { name:"Sam", card:CARD_B, no:87 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
onMsg({ t:"claim", pid:"p2", cardNo:87 });
var tickA = G.players.p1.cards, tickB = G.players.p2.cards;
click("confirmall");
syncWinCardControls();
var drawBefore2 = G.draw.join(",");
MSGS = [];
click("keepplaying");
var kw2 = lastOf("winner");
ok("both are announced and the game carries on", kw2 && kw2.shared === true && kw2.cont === true &&
   kw2.winners.length === 2);
ok("the room moves to the next pattern", G.pattern === "two" && kw2.next === "two");
ok("the numbers are kept", G.draw.join(",") === drawBefore2 &&
   (lastOf("state")||{}).called.join(",") === drawBefore2);
ok("both players keep their tickets", G.players.p1.cards === tickA && G.players.p2.cards === tickB);
ok("nobody is re-dealt", dealt === 0 && pushedCards === 0);

/* ================= 4. THE EDGES THAT COST SOMETHING ================= */
print("");
print("== the win card cannot be reached while anyone is still waiting ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 }, p2: { name:"Sam", card:CARD_B, no:87 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
onMsg({ t:"claim", pid:"p2", cardNo:87 });
click("confirm", 0);
ok("one confirmed, one queued: no Finish game button exists to tap", !findBtn("finish"));
ok("and no Keep playing either", !findBtn("keepplaying"));
ok("the queued player still has a Confirm winner button", !!findBtn("confirm", 0));
/* finishGame() itself has no claims guard. What keeps a host off it is that the win card is
   not RENDERED while anyone is queued, which is what the three checks above assert. If it is
   reached any other way, the player still waiting must not be swallowed with the game. */
MSGS = [];
finishGame();
ok("the player still waiting is still in the queue afterwards, by name",
   G.claims.length === 1 && G.claims[0].name === "Sam",
   G.claims.length + " claim(s) left: " + G.claims.map(function(c){ return c.name; }).join(","));
ok("and their ticket is still the one they claimed on", G.claims[0] && G.claims[0].cardNo === 87,
   G.claims[0] && String(G.claims[0].cardNo));

print("== nothing to announce means nothing is sent ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
MSGS = [];
finishGame();
ok("Finish game with no confirmed winner sends nothing", MSGS.length === 0 && G.won === false);
keepPlaying();
ok("Keep playing with no confirmed winner sends nothing", MSGS.length === 0 && G.pattern === "one");

print("== a player who has already won cannot win the same stage twice ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
click("confirm", 0);
MSGS = [];
onMsg({ t:"claim", pid:"p1", cardNo:332 });
ok("a second shout from a confirmed winner is not queued again", G.claims.length === 0,
   String(G.claims.length));
ok("and the win card is still the only thing on screen", !!findBtn("finish"));

print("== the listener still works after the card has been re-rendered many times ==");
room({ p1: { name:"Kate", card:CARD_A, no:332 } });
onMsg({ t:"claim", pid:"p1", cardNo:332 });
for (var r = 0; r < 5; r++) renderClaimQueue();
ok("Confirm still works after five re-renders", click("confirm", 0) && G.lastWins.length === 1);
for (var r2 = 0; r2 < 5; r2++) renderClaimQueue();
syncWinCardControls();
MSGS = [];
ok("Keep playing still works after five more", click("keepplaying") && !!lastOf("winner"));
ok("and it is still one listener on the queue, not one per render",
   $("claimQueue")._on.click.length === 1, String($("claimQueue")._on.click.length));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
