/* THE BINGO CONSOLE DOES NOT MOVE UNDER THE HOST'S FINGER, AND THE NUMBER IT
   SHOWS AT THE END OF THE NIGHT IS THE ONE THE BILL IS WORKED OUT FROM.

   All three of these came out of a real bingo night at The Mini Bar, 10 Sep 2026.

   1. The called-numbers strip was empty on the first ball and one row tall on the
      second, so the prize line and the Next number button dropped down the screen
      the moment the second number landed. A host tapping where the button WAS is a
      mis-tap in a live room, and there is no undo on a called ball. Same class of
      fault: the over-plan banner appearing above the whole console mid-game.
   2. The end-of-night card counted players on the tablet and then said in small
      print that the bill used a different number. It asks the server now.
   3. The Next number button could be dead and silent across a game boundary,
      because the five second ball hold is keyed to the button rather than to the
      game, and because a ball request still in flight leaves G.calling true.

   The real functions are lifted out of index.html and run against a stubbed DOM,
   rather than restated here: a copy keeps passing while the page changes.

   Run: jsc venueplay/app/bingo-console.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay/app/index.html", "index.html", "./index.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 40000) { html = t; break; } } catch (e) {}
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
var fnLive = grab("renderLive"), fnBanner = grab("renderOverBanner"),
    fnGuards = grab("clearCallGuards"), fnCount = grab("serverPlayerCount");
ok("renderLive is still in the console", !!fnLive);
ok("renderOverBanner is still in the console", !!fnBanner);
ok("clearCallGuards is still in the console", !!fnGuards);
ok("serverPlayerCount is still in the console", !!fnCount);
if (!fnLive || !fnBanner || !fnGuards || !fnCount) throw new Error("missing functions");

/* ---------------- a DOM small enough to run these and nothing more ---------------- */
var made = {};
function el(){
  var node = { className:"", textContent:"", style:{ display:"" }, children:[],
               appendChild:function(n){ this.children.push(n); } };
  // Setting innerHTML empties the element, exactly as a browser does. Without that a
  // strip that never clears looks like a strip that never grows, and this suite would
  // pass over the very bug it exists to catch.
  var raw = "";
  Object.defineProperty(node, "innerHTML", {
    get: function(){ return raw; },
    set: function(v){ raw = String(v); node.children = []; }
  });
  return node;
}
function $(id){ if(!made[id]) made[id] = el(); return made[id]; }
var document = { createElement: function(){ return el(); } };
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
var PATTERN_NAMES = { one:"One line", two:"Two lines", full:"Full house" };
var G = { idx:-1, draw:[], pattern:"one", prize:"$100 house", status:"running", calling:false, order:[] };
var claimQueueDrawn = 0;
function renderClaimQueue(){ claimQueueDrawn++; }
var counted = 0;
function playerCount(){ return counted; }
var cap = 0;
function playerCap(){ return cap; }
var firstMonth = false;
function inFirstMonth(){ return firstMonth; }
var toasts = [];
function showToast(m){ toasts.push(m); }
var released = [];
var window = { VP_HOLD: { release: function(b){ released.push(b); } } };
var VP_HOLD = window.VP_HOLD;

eval(fnLive); eval(fnBanner); eval(fnGuards);

/* ---------------- 1. the strip holds its height from ball one ---------------- */
print("== nothing below the called strip ever moves ==");
function stripSlots(){ return $("livePrev").children.length; }
function visibleChips(){
  var c = $("livePrev").children, n = 0;
  for (var i = 0; i < c.length; i++) if (c[i].className.indexOf("ghost") < 0) n++;
  return n;
}
G.draw = []; G.idx = -1; renderLive();
var atStart = stripSlots();
ok("the strip is full height before a single ball is called", atStart === 2,
   "it had " + atStart + " slots: everything under it moves when a ball lands");

G.draw = [7]; G.idx = 0; renderLive();
ok("still the same height on the first ball", stripSlots() === atStart, stripSlots() + " slots");
ok("and nothing is shown in it yet", visibleChips() === 0);

G.draw = [7, 42]; G.idx = 1; renderLive();
ok("still the same height on the second ball", stripSlots() === atStart, stripSlots() + " slots");
ok("the first ball is now shown below the big number", visibleChips() === 1);
ok("and it is the right ball", $("livePrev").children[0].textContent === 7,
   "got " + $("livePrev").children[0].textContent);

G.draw = [7, 42, 13, 66, 5]; G.idx = 4; renderLive();
ok("still the same height forty balls later", stripSlots() === atStart);
ok("two previous balls are shown by then", visibleChips() === 2);
ok("newest first", $("livePrev").children[0].textContent === 66 && $("livePrev").children[1].textContent === 13,
   $("livePrev").children[0].textContent + ", " + $("livePrev").children[1].textContent);

/* ---------------- 2. the over-plan banner never appears mid-game ---------------- */
print("== the over-plan banner waits for a gap in play ==");
cap = 10; counted = 14; toasts = [];
G.status = "lobby"; _overToldLive = false;
renderOverBanner();
ok("in the lobby, over the plan, the banner is up", $("overBanner").style.display === "",
   "display was '" + $("overBanner").style.display + "'");
ok("it names the numbers", $("overBanner").innerHTML.indexOf("14") >= 0 && $("overBanner").innerHTML.indexOf("10") >= 0);

made.overBanner.style.display = "none"; toasts = [];
G.status = "running"; _overToldLive = false; counted = 14;
renderOverBanner();
ok("a player joining mid-game does NOT drop a banner in above the console",
   $("overBanner").style.display === "none",
   "the banner appearing pushes the Next number button down the screen between taps");
ok("the host is told in a toast instead, which moves nothing", toasts.length === 1, toasts.join(" / "));
renderOverBanner(); renderOverBanner();
ok("and told once, not on every join", toasts.length === 1, toasts.length + " toasts");

G.status = "setup"; counted = 4;
renderOverBanner();
ok("back under the plan between games, the banner goes", $("overBanner").style.display === "none");

/* ---------------- 3. a new game starts with a live button ---------------- */
print("== the Next number button is never dead across a game boundary ==");
G.calling = true; released = [];
clearCallGuards();
ok("a ball request left in flight no longer gags the next game", G.calling === false,
   "nextBall returns on G.calling without saying a word");
ok("the last game's five second hold is released off the button", released.length === 1,
   "otherwise the new game's button reads 'Next number in 3s' and a tap does nothing");

["openLobby", "cancelLobby", "startGame", "newGame", "endGame"].forEach(function(name){
  var body = grab(name);
  ok(name + " clears the call guards", !!body && body.indexOf("clearCallGuards()") >= 0,
     "a hold or a request from the last game must not carry into this one");
});

/* ---------------- 4. the night card asks the server ---------------- */
print("== players joined is the server's number ==");
var VP_GAME_API = "https://example.test";
var timers = 0;
function setTimeout(){ timers++; return timers; }
function clearTimeout(){}
var fetchPlan = null, fetched = [];
function fetch(url){
  fetched.push(url);
  if (fetchPlan === "throw") return Promise.reject(new Error("offline"));
  if (fetchPlan === "notok") return Promise.resolve({ ok:false, json:function(){ return Promise.resolve(null); } });
  return Promise.resolve({ ok:true, json:function(){ return Promise.resolve(fetchPlan); } });
}
eval(fnCount);

var got;
function run(plan, sid){
  fetchPlan = plan; got = "pending";
  serverPlayerCount(sid).then(function(n){ got = n; });
  drainMicrotasks();
  return got;
}
ok("the server's count is what comes back", run({ player_count: 23 }, "abc") === 23, String(got));
ok("zero is a real answer, not a missing one", run({ player_count: 0 }, "abc") === 0, String(got));
ok("it asks the snapshot route for that session",
   fetched.length > 0 && fetched[fetched.length-1].indexOf("/snapshot?session=abc") >= 0,
   fetched[fetched.length-1]);
ok("no session means no server number", run({ player_count: 9 }, null) === null, String(got));
ok("a refused answer falls back to the tablet", run("notok", "abc") === null, String(got));
ok("a dead connection falls back to the tablet", run("throw", "abc") === null, String(got));
ok("a reply with no count in it falls back to the tablet", run({ ok:true }, "abc") === null, String(got));
ok("and so does a count that is not a number", run({ player_count: "lots" }, "abc") === null, String(got));

var card = grab("showNightCard");
ok("the night card takes the session it is reporting on",
   !!card && /function showNightCard\(sessionId\)/.test(card));
ok("the night card asks the server for the headcount",
   !!card && card.indexOf("serverPlayerCount(sessionId)") >= 0);
ok("the tablet caveat is removable, so it goes when the server number lands",
   !!card && card.indexOf('id="nightCounted"') >= 0 && card.indexOf("removeChild") >= 0,
   "a number shown as the billed one has to be the billed one");
ok("the caveat is still written, for when the server cannot be reached",
   !!card && card.indexOf("Counted on this tablet") >= 0);
var end = grab("endGame");
ok("End game keeps the session id long enough to report on it",
   !!end && end.indexOf("showNightCard(_sid)") >= 0);

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
