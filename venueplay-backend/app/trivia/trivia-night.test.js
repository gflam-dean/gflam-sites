/* WHAT A TRIVIA NIGHT MUST STILL DO, TESTED AGAINST THE PAGES THAT SHIP.

   Every check here comes from the 7 Sep trivia review or from the picture round
   Dean asked for on 9 Sep. Where the behaviour is a function, the function is
   lifted out of the page and run, so this cannot pass against a page that has
   quietly lost it. Where the behaviour needs a host, a TV and forty phones in a
   room, the check is structural and says which fault it is guarding.

   Run: jsc venueplay-backend/app/trivia/trivia-night.test.js   (from the repo root)
*/
var bad = 0;
function pass(n, c, why){ print((c ? "  ok   " : "  FAIL ") + n + (c || !why ? "" : "   " + why)); if(!c) bad++; }

function firstReadable(paths, min){
  for (var i = 0; i < paths.length; i++){
    try { var t = readFile(paths[i]); if (t && t.length > min) return t; } catch(e){}
  }
  return null;
}
function page(name){
  return firstReadable([ "venueplay/app/trivia/" + name,
                         "../" + name,
                         name ], 2000);
}
var builder = page("builder.html");
var host    = page("host.html");
var play    = page("play.html");
var screen  = page("screen.html");
pass("all four trivia pages are readable", !!(builder && host && play && screen));
if (!(builder && host && play && screen)) { print("  0 FAILED"); throw new Error("missing pages"); }

/* Lift a function body straight out of the page. */
function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return null;
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}
function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

print("");
print("1. TIES SHARE THE STEP (review finding 7: two teams on 850 were split by database order)");

var fnRankHost = grab("sharedRanks", host);
var fnRankTv   = grab("sharedRanks", screen);
pass("host.html still ranks the board itself", !!fnRankHost);
pass("screen.html still ranks the board itself", !!fnRankTv);
if (!fnRankHost || !fnRankTv) throw new Error("sharedRanks missing");

(function(){
  eval(fnRankHost);
  var rows = [{points:900},{points:850},{points:850},{points:700}];
  pass("host: two teams on 850 both read =2", same(sharedRanks(rows), ["1","=2","=2","4"]), JSON.stringify(sharedRanks(rows)));
  pass("host: no tie, no equals sign", same(sharedRanks([{points:9},{points:8},{points:7}]), ["1","2","3"]));
  pass("host: an empty board does not throw", same(sharedRanks([]), []));
  pass("host: everyone on zero shares first", same(sharedRanks([{points:0},{points:0}]), ["=1","=1"]));
})();
(function(){
  eval(fnRankTv);
  var rows = [{points:900},{points:850},{points:850},{points:700}];
  pass("TV: the same rows give the same ranks as the host console", same(sharedRanks(rows), ["1","=2","=2","4"]), JSON.stringify(sharedRanks(rows)));
  // The TV reads points off a public broadcast, so it must survive strings and rubbish.
  pass("TV: points arriving as text still rank", same(sharedRanks([{points:"9"},{points:"9"},{points:"1"}]), ["=1","=1","3"]));
})();

print("");
print("2. THE PODIUM SHOWS EVERYONE ON THE STEP (finding 7: one of the tied pair was not shown at all)");
var fnPodium = grab("podiumEntries", screen);
pass("screen.html still works out who stands on the podium", !!fnPodium);
if (fnPodium){
  eval(fnPodium);
  var tie = [{name:"A",points:900},{name:"B",points:850},{name:"C",points:850},{name:"D",points:700}];
  var e = podiumEntries(tie.slice(0,3), tie);
  pass("both teams on 850 stand on the podium", e.length === 3 && e[1].rank === 2 && e[2].rank === 2, JSON.stringify(e.map(function(x){ return x.p.name + ":" + x.rank; })));
  pass("nobody past third gets a column", e.filter(function(x){ return x.rank > 3; }).length === 0);
  var clean = [{name:"A",points:9},{name:"B",points:8},{name:"C",points:7},{name:"D",points:6}];
  pass("a clean 1-2-3 is still three columns", podiumEntries(clean.slice(0,3), clean).length === 3);
  pass("a two team game does not throw", podiumEntries([{name:"A",points:5}], [{name:"A",points:5}]).length === 1);
  pass("no scores at all does not throw", podiumEntries([], []).length === 0);
  var four = [{name:"A",points:9},{name:"B",points:9},{name:"C",points:9},{name:"D",points:9},{name:"E",points:9}];
  pass("a five way tie is capped at four columns so the wall never overflows", podiumEntries(four.slice(0,3), four).length <= 4);
}

print("");
print("3. THE PHONE NEVER SAYS RANK 0 (finding 8)");
var fnRankText = grab("rankText", play), fnOrdinal = grab("ordinal", play);
pass("play.html still has rankText", !!fnRankText);
pass("play.html still has ordinal", !!fnOrdinal);
if (fnRankText && fnOrdinal){
  eval(fnOrdinal); eval(fnRankText);
  var P = { rank:0, playersCount:0 };
  pass("no rank yet prints nothing at all", rankText() === "", "got '" + rankText() + "'");
  P.rank = 3; P.playersCount = 11;
  pass("third of eleven reads '3rd of 11'", rankText() === "3rd of 11", rankText());
  P.playersCount = 0;
  pass("an unknown field size still names the place", rankText() === "3rd", rankText());
  P.rank = 1; P.playersCount = 2;
  pass("first reads '1st of 2'", rankText() === "1st of 2", rankText());
}

print("");
print("4. THE ONCE A WEEK MESSAGE IS IN ENGLISH (finding 2: the host was shown 2026-09-14)");
var fnDay = grab("friendlyDay", host), fnMsg = grab("friendlyMsg", host);
pass("host.html still translates the date", !!(fnDay && fnMsg));
if (fnDay && fnMsg){
  var DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  eval(fnDay); eval(fnMsg);
  pass("2026-09-14 becomes Monday 14 September", friendlyDay("2026-09-14") === "Monday 14 September", friendlyDay("2026-09-14"));
  pass("the Worker's whole sentence is rewritten in place",
       friendlyMsg("Your next trivia night is available from 2026-09-14.") === "Your next trivia night is available from Monday 14 September.",
       friendlyMsg("Your next trivia night is available from 2026-09-14."));
  pass("a message with no date is left alone", friendlyMsg("Pick a question set first") === "Pick a question set first");
  pass("rubbish in does not throw", friendlyDay("") === "" && friendlyMsg(null) === "");
}

print("");
print("5. THE PICTURE ROUND, END TO END (Dean, 9 Sep: 'I dont think opus ever did do it')");
pass("builder: a host can choose a photo", builder.indexOf('id="ownImgFile"') > 0);
pass("builder: the photo is shrunk on the device before it goes anywhere", builder.indexOf("function shrinkImage(") > 0);
pass("builder: it is uploaded to the game Worker", builder.indexOf("/host/trivia/image-upload") > 0);
pass("builder: a missing upload route falls back to pasting a link, in plain English",
     builder.indexOf("Paste a picture link (https://...) in the box below instead.") > 0);
pass("builder: pasting a link is still possible", builder.indexOf('id="ownImg"') > 0);
pass("builder: the question list shows which questions have a picture", builder.indexOf("qthumb") > 0);
pass("host: the picture is on the question card, so the host can describe it (finding 10)",
     host.indexOf('(q.imageUrl?\'<img class="qimg-h" alt="" src="\'+esc(q.imageUrl)') > 0);
pass("host: and on the reveal card too", host.indexOf('(q2.imageUrl?\'<img class="qimg-h" alt="" src="\'+esc(q2.imageUrl)') > 0);
pass("host: a picture that will not load hides itself rather than leaving a broken box",
     host.split("onerror=\\\"this.style.display=\\'none\\'\\\"").length >= 3 || host.split("this.style.display=").length >= 3);
pass("host: the picture rides along on a reload recovery too", host.indexOf("imageUrl:q.image_url") > 0);
pass("TV: the picture is drawn with the question", screen.indexOf('id="tvQImg"') > 0);
pass("TV: a picture question gets the picture round layout", screen.indexOf('lay.classList.toggle("pic", hasPic)') > 0);
pass("TV: a picture that fails to load drops back to the text layout instead of a blank wall",
     screen.indexOf("l.classList.remove('pic')") > 0);
pass("TV: only a real http link is treated as a picture", screen.indexOf("/^https?:\\/\\//i.test(String(m.imageUrl))") > 0);
pass("phone: the picture sits above the answers", play.indexOf('id="pqImg"') > 0 && play.indexOf('id="pqImg"') < play.indexOf('id="pAnswers"'));
pass("phone: a broken picture hides itself and the question carries on", play.indexOf("onerror=\"this.classList.add('hidden')\"") > 0);

print("");
print("6. FOUR COLOURED ANSWER BUTTONS CAN ACTUALLY BE TURNED ON (finding 1)");
pass("the host settings panel has the colour toggle", host.indexOf('id="cfgColour"') > 0);
pass("and the click handler has an element to listen to", host.indexOf('#cfgColour button') > 0);
(function(){
  // The whole fault was a handler listening for an element nobody had written.
  var ids = host.match(/document\.querySelectorAll\("#(\w+) button"\)/g) || [];
  var missing = [];
  for (var i = 0; i < ids.length; i++){
    var id = /#(\w+) button/.exec(ids[i])[1];
    if (host.indexOf('id="' + id + '"') < 0) missing.push(id);
  }
  pass("every settings toggle the console listens to exists in the markup", missing.length === 0, missing.join(", "));
})();
pass("colour is on by default", host.indexOf("speedBonus:true, colour:true") > 0);

print("");
print("7. NOBODY ENDS THE NIGHT BY ACCIDENT (finding 3)");
(function(){
  var fn = grab("endBtn", host);
  pass("host.html still builds its End round buttons in one place", !!fn);
  pass("and every one of them asks first", !!fn && fn.indexOf("confirm(") > 0);
})();

print("");
print("8. A PHONE THAT SLEPT COMES BACK INTO THE GAME (findings 4, 5, 8)");
pass("the team name is kept where a backgrounded tab cannot eat it", play.indexOf('localStorage.setItem("vp-tname-"') > 0);
pass("a returning phone rebuilds from the snapshot", play.indexOf("rebuildFromSnapshot()") > 0 && play.indexOf("function applyPending(") > 0);
pass("a phone that woke mid question lands on that question, not the waiting screen",
     play.indexOf('g.phase==="asking" || g.phase==="locked"') > 0);
pass("'Answer in!' waits for the server to say so", play.indexOf("function sayIn(){") > 0 && play.indexOf("playerPost(\"/player/answer\"").valueOf() > 0);
pass("an answer that did not get through can be tapped again", play.indexOf("Didn't get through. Tap your answer again.") > 0);
pass("a missed deadline says so plainly", play.indexOf("Too late, next one!") > 0);
pass("the result screen names the correct answer", play.indexOf('id="pResCa"') > 0);
pass("the result stays up until the next question starts", play.indexOf("Leave the result screen up") > 0);

print("");
print("9. THE WALL NEVER SHOWS THE PLAYER COUNT (locked design rule)");
pass("screen.html has no player count element", screen.indexOf('id="lobbyPlaying"') < 0);
pass("screen.html does not track a player count at all", screen.indexOf("state.playerCount") < 0);
pass("a players message is accepted and ignored, so an old host cannot break the wall", screen.indexOf('if(m.t==="players"){ return; }') > 0);

print("");
print("10. EVERY TEAM CAN SEE ITSELF (finding 13)");
pass("the TV pages through the whole board", screen.indexOf("function renderBoardPaged(") > 0);
pass("paging stops the moment another layer shows, so it cannot paint over a question",
     screen.indexOf('if(which!=="tvBoard") stopBoardPaging();') > 0);
pass("the host board scrolls the full list rather than stopping at eight", host.indexOf("All \"+G.board.length+\" teams") > 0);

print("");
print("11. THE NIGHT IS NAMED ON THE WALL (finding 15)");
pass("the TV lobby has a name element it can repaint", screen.indexOf('id="lobbyName"') > 0);
pass("the host sends the night's name with the mode", host.indexOf('t:"mode", mode:"trivia", title:G.setTitle') > 0);
pass("a name that never arrives still reads Trivia Night", screen.indexOf('|| "Trivia Night"') > 0);
pass("the builder no longer claims a 37,000 question bank", builder.indexOf("37,000") < 0);

print("");
print("12. MORE TIME IS ASKED OF THE SERVER, NEVER FAKED (finding 9)");
pass("the host has a +10 seconds button", host.indexOf('"+10 seconds"') > 0);
pass("it moves the real deadline through the Worker", host.indexOf('/host/question/add-time') > 0);
pass("a Worker without the route tells the host plainly instead of lying to the room",
     host.indexOf("Extra time is not switched on at the server yet") > 0);
pass("the phone follows the new deadline", play.indexOf('m.t==="time"') > 0);
pass("the TV ring follows it too", screen.indexOf('m.t==="time"') > 0);

print("");
print("13. THE BUILDER IS THREE STEPS AND ENDS AT RUN IT NOW (Dean, 9 Sep: 'easier on the host')");
pass("there are three numbered steps", builder.indexOf('data-step="1"') > 0 && builder.indexOf('data-step="2"') > 0 && builder.indexOf('data-step="3"') > 0);
pass("one tap on a theme builds a whole night", builder.indexOf("function quickNight(") > 0 && builder.indexOf("count:20") > 0);
pass("the last step hands the host straight to the console with the night already picked",
     builder.indexOf('run.href="/app/trivia/host.html?set="') > 0);
pass("and the console picks that night up", host.indexOf("function setFromUrl(") > 0);
pass("a signed out host is given a way in (finding 14)", builder.indexOf("Go to sign in") > 0);
pass("a typo can be fixed instead of retyped (finding 14)", builder.indexOf("function startEdit(") > 0);
pass("a removed question can be put back", builder.indexOf("function showUndo(") > 0);
pass("a half written question survives a mis-tap", builder.indexOf("function saveDraft(") > 0 && builder.indexOf("function restoreDraft(") > 0);
pass("the builder says the questions run in a random order (finding 12)", builder.indexOf("random order") > 0);
pass("an empty night cannot be run", builder.indexOf("it cannot run") > 0);

print("");
print("14. NOTHING IN THESE PAGES USES AN EM DASH (the gate rejects them)");
(function(){
  var files = { "builder.html":builder, "host.html":host, "play.html":play, "screen.html":screen };
  var hits = [];
  var EM = String.fromCharCode(8212);   // built, not typed, so this file never carries one itself
  for (var k in files){ if (files[k].indexOf(EM) >= 0) hits.push(k); }
  pass("no em dash in any trivia page", hits.length === 0, hits.join(", "));
})();

print("");
print(bad ? ("  " + bad + " FAILED") : "ALL " + "CHECKS PASSED");
if (bad) throw new Error(bad + " failed");
