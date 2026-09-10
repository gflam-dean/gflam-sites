/* THE VENUE TV, RUN AND WATCHED FRAME BY FRAME.

   Dean, 10 Sep 2026, after three faults reached the wall at The Mini Bar:
   "So again we are going through old problems that we have solved so can we stop them
   from happening again? these tests dont seem to cover much."

   He is right. Most of the TV suites written today search the SOURCE of tv.html for a
   line of text. A line of text existing is not the same as the wall looking right, so
   they stayed green while the screen misbehaved. All three of today's faults were about
   what was VISIBLE and WHEN:

     1. the ad loop flashed on every lap, because the cross-fade cleared z-index at the
        end and handed stacking back to DOM order, and DOM order is wrong for exactly one
        transition: the wrap from the last slide to the first
     2. a second ball called during the 2.1 second reveal abandoned the first one
     3. bringing the tab forward rebuilt the ad loop, which emptied the container for a
        frame

   So this suite RUNS the screen. It lifts the real functions out of tv.html, gives them a
   stub DOM that models what a viewer would actually see (opacity through the 0.8s CSS fade,
   and the effective stacking order including DOM order when z-index is auto), drives a fake
   clock in 20 ms steps, and records what is on the wall at every step. A failure can then
   say which slides were painting, at what opacity, in what order, and at what millisecond.

   The real functions are lifted, never restated, so a copy cannot keep passing while the
   page changes.

   Run: jsc venueplay/app/tv-screen.test.js
*/

var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "\n         " + extra : "")); }
}

/* ============================ the page under test ============================ */
var CANDIDATES = ["venueplay/tv.html", "../tv.html", "tv.html", "../../venueplay/tv.html"];
var html = null;
for (var ci = 0; ci < CANDIDATES.length; ci++) {
  try { var t = readFile(CANDIDATES[ci]); if (t && t.length > 10000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find tv.html"); throw new Error("no source"); }

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
  var i = html.indexOf(prefix);
  if (i < 0) return null;
  var j = html.indexOf("\n", i);
  return html.slice(i, j < 0 ? html.length : j);
}
/* The body of one branch of onMsg, so the ball path is driven by the page's own handler
   rather than by four lines copied in here that could drift away from it. */
function grabBranch(marker){
  var i = html.indexOf(marker);
  if (i < 0) return null;
  var s = i + marker.length - 1, d = 0;
  for (var j = s; j < html.length; j++) {
    if (html[j] === "{") d++;
    else if (html[j] === "}") { d--; if (d === 0) return html.slice(s + 1, j); }
  }
  return null;
}

var NEED = ["adsSignature","buildAds","stopAds","startAds","loopEntries","entryClass","entryInner",
            "slideVisible","todayStr","hasRaffle","accentClass","accentHex","esc","escBr",
            "landBall","revealBall","renderRun","calledSet","updateBoard","hideBingoLayers",
            "showBingoLayer","applyBingo","hideGameFrame","applyVenueLogo","stopCelebrate",
            "cancelHolding","cancelEmbedWatch","gameLabel","enterAds","enterBingo","enterEmbed",
            "enterHolding"];
var SRC = {}, missing = [];
for (var ni = 0; ni < NEED.length; ni++) {
  SRC[NEED[ni]] = grab(NEED[ni]);
  if (!SRC[NEED[ni]]) missing.push(NEED[ni]);
}
ok("every function this suite runs is still in tv.html", missing.length === 0,
   "missing: " + missing.join(", ") + ". A renamed function must be renamed here too, or this suite is testing nothing.");
if (missing.length) throw new Error("missing functions");

var BALL_BRANCH = grabBranch('if(m.t==="ball"){');
ok("the ball message handler is still in tv.html", !!BALL_BRANCH,
   "this suite drives balls through the page's own handler, not a copy of it");
if (!BALL_BRANCH) throw new Error("no ball branch");

/* ============================ the clock ============================ */
var now = 0, seq = 0, pendingT = {};
function setTimeout(fn, ms){ var id = ++seq; pendingT[id] = { fn: fn, at: now + (ms || 0), id: id }; return id; }
function clearTimeout(id){ if (id) delete pendingT[id]; }
function setInterval(fn, ms){ return setTimeout(function(){}, 1e12); }   // the page arms two we do not drive
function clearInterval(id){ clearTimeout(id); }
Date.now = function(){ return now; };

var TICK = 20;
function fireDue(){
  for (;;) {
    var next = null;
    for (var k in pendingT) {
      var tm = pendingT[k];
      if (tm.at > now) continue;
      if (!next || tm.at < next.at || (tm.at === next.at && tm.id < next.id)) next = tm;
    }
    if (!next) return;
    delete pendingT[next.id];
    try { next.fn(); } catch (e) { print("  (a timer threw: " + e + ")"); }
  }
}
function run(ms){
  var end = now + ms;
  while (now < end) { now = Math.min(end, now + TICK); fireDue(); record(); }
}

/* ============================ a DOM you can SEE ============================ */
var FADE = 800;            // .ad{transition:opacity .8s ease}
var emptyFrames = 0;

function opacityAt(node, t){
  var evs = node.fades;
  if (!evs || !evs.length) return 0;
  var e = null;
  for (var i = 0; i < evs.length; i++) { if (evs[i].t <= t) e = evs[i]; else break; }
  if (!e) return 0;
  var p = (t - e.t) / FADE; if (p > 1) p = 1;
  return e.from + (e.to - e.from) * p;
}
function noteFade(node, on){
  node.fades.push({ t: now, from: opacityAt(node, now), to: on ? 1 : 0 });
}
function classList(node){
  return {
    add: function(c){
      if (this.contains(c)) return;
      node.className = (node.className + " " + c).trim();
      if (c === "show" && node.isAd) noteFade(node, true);
    },
    remove: function(c){
      if (!this.contains(c)) return;
      node.className = node.className.split(" ").filter(function(x){ return x && x !== c; }).join(" ");
      if (c === "show" && node.isAd) noteFade(node, false);
    },
    contains: function(c){ return node.className.split(" ").indexOf(c) >= 0; },
    toggle: function(c, on){ if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); }
  };
}
function el(id){
  var node = { id: id || "", className: "", style: {}, childNodes: [], fades: [], isAd: false,
               live: false, parent: null, rect: null, attrs: {}, textContent: "", offsetWidth: 100 };
  node.classList = classList(node);
  node.appendChild = function(n){
    if (n.parent && n.parent !== node) n.parent.removeChild(n);
    n.parent = node;
    if (node.live) n.isAd = true;
    node.childNodes.push(n);
    if (node.live) checkNotEmpty();
    return n;
  };
  node.removeChild = function(n){
    var i = node.childNodes.indexOf(n);
    if (i < 0) throw new Error("not a child");
    node.childNodes.splice(i, 1); n.parent = null;
    if (node.live) checkNotEmpty();
    return n;
  };
  Object.defineProperty(node, "firstChild", { get: function(){ return node.childNodes[0] || null; } });
  var raw = "";
  Object.defineProperty(node, "innerHTML", {
    get: function(){ return raw; },
    set: function(v){ raw = String(v); node.childNodes = []; if (node.live) checkNotEmpty(); }
  });
  node.getAttribute = function(k){ return node.attrs[k] === undefined ? null : node.attrs[k]; };
  node.setAttribute = function(k, v){ node.attrs[k] = String(v); };
  node.addEventListener = function(){};
  /* A node inside anything carrying .hidden measures zero, exactly as display:none does.
     This matters: it is how a reveal that outlives its game finds no landing spot. */
  node.getBoundingClientRect = function(){
    var n = node;
    while (n) { if (n.classList.contains("hidden")) return { left: 0, top: 0, width: 0, height: 0 }; n = n.parent; }
    return node.rect || { left: 0, top: 0, width: 0, height: 0 };
  };
  node.querySelector = function(sel){ return node.querySelectorAll(sel)[0] || null; };
  node.querySelectorAll = function(sel){
    var want = sel.split(".").filter(Boolean);
    return node.childNodes.filter(function(c){
      return want.every(function(w){ return c.classList.contains(w); });
    });
  };
  return node;
}
var byId = {};
function $(id){ if (!byId[id]) byId[id] = el(id); return byId[id]; }

var adsHost = $("tvAds"); adsHost.live = true;
function checkNotEmpty(){ if (adsHost.childNodes.length === 0) emptyFrames++; }

var BLAYERS_T = ["tvLobby","tvRun","tvClaim","tvWin","tvHold"];
BLAYERS_T.forEach(function(k){ $(k).className = "layer hidden"; });
$("tvJoinCorner").className = "hidden";
$("ballReveal").className = "ballreveal hidden";
$("adsRoot").className = "";
$("gameFrame").setAttribute("src", "");
Object.defineProperty($("gameFrame"), "src", {
  get: function(){ return $("gameFrame").getAttribute("src"); },
  set: function(v){ $("gameFrame").setAttribute("src", v); }
});

/* The resting called-number ball. In the page #cbNum IS the .cbnum inside #tvRun, and the
   .curball is its parent, so the reveal lands on the same element renderRun writes to. */
var curball = el("curball"); curball.className = "curball"; curball.parent = $("tvRun");
curball.rect = { left: 140, top: 520, width: 260, height: 260 };
$("cbNum").className = "cbnum"; $("cbNum").parent = curball; $("cbNum").textContent = "--";
$("brBall").parent = $("ballReveal");
$("brBall").rect = { left: 660, top: 240, width: 600, height: 600 };

var document = {
  createElement: function(){ return el(""); },
  getElementById: function(id){ return byId[id] || null; },
  querySelector: function(sel){
    if (sel === "#tvRun .cbnum") return $("cbNum");
    if (sel === "#tvRun .curball") return curball;
    return null;
  }
};
var window = {};
var sessionStorage = { setItem: function(){}, getItem: function(){ return null; } };

/* ============================ what a viewer sees ============================ */
function zOf(node){
  var z = node.style.zIndex;
  if (z === undefined || z === null || z === "") return 0;   // auto: falls back to DOM order
  var n = parseInt(z, 10);
  return isNaN(n) ? 0 : n;
}
var frames = [];
function wallDesc(){
  if ($("gameFrame").style.display === "block") return "the game screen";
  for (var i = 0; i < BLAYERS_T.length; i++) if (!$(BLAYERS_T[i]).classList.contains("hidden")) return BLAYERS_T[i];
  return null;
}
function snapshot(){
  var kids = adsHost.childNodes, on = [];
  for (var i = 0; i < kids.length; i++) {
    var op = opacityAt(kids[i], now);
    if (op > 0.005) on.push({ i: i, op: op, z: zOf(kids[i]) });
  }
  var top = null;
  on.forEach(function(s){ if (!top || s.z > top.z || (s.z === top.z && s.i > top.i)) top = s; });
  var full = false;
  on.forEach(function(s){ if (s.op > 0.995) full = true; });
  return {
    t: now, slides: kids.length, on: on, top: top ? top.i : -1, idx: adIdx, full: full,
    adsHidden: $("adsRoot").classList.contains("hidden"),
    layer: wallDesc(),
    mode: tvMode,
    rest: String($("cbNum").textContent),
    restOp: $("cbNum").style.opacity === undefined || $("cbNum").style.opacity === "" ? "1" : String($("cbNum").style.opacity),
    revealUp: !$("ballReveal").classList.contains("hidden"),
    xform: $("brBall").style.transform === undefined ? "" : String($("brBall").style.transform),
    flying: !!ballInFlight, flyNum: inFlightNum
  };
}
function record(){ frames.push(snapshot()); }
function mark(){ return frames.length; }
function since(m){ return frames.slice(m); }

function paintDesc(f){
  if (!f.on.length) return "nothing was painting";
  return f.on.map(function(s){
    return "slide #" + s.i + " (opacity " + s.op.toFixed(2) + ", stack " + s.z + ")";
  }).join(" and ") + ", top of the stack is #" + f.top;
}
function at(f, what){ return "at " + f.t + " ms " + what; }

/* first frame in the list that fails the test, or null */
function firstBad(list, test){
  for (var i = 0; i < list.length; i++) if (!test(list[i])) return list[i];
  return null;
}

/* ============================ the page's own code ============================ */
eval(grabLine("var ACCENT={"));
eval(grabLine("var ACCENT_COLOR={"));
eval(grabLine("var GAME_LABELS={"));
eval(grabLine("var BLAYERS=["));

/* Venue content. This is the wall Dean is looking at: four promo slides, then the members
   draw card, which loopEntries puts LAST. Last in the document is exactly what made the
   wrap from the members draw back to Saturday the one transition that painted wrong. */
var ADS = { rotationSecs: 7, slides: [], draws: [], raffle: null };
var VENUE_TZ = "Australia/Brisbane";
/* The weekday is a caption on the members draw card, not something this suite asserts,
   so it is fixed here rather than depending on the machine's timezone data. */
function todayAU(){ return "friday"; }
var PATTERN_NAMES = { one: "One line", two: "Two lines", full: "Full house" };

var adIdx = 0, adTimer = null, adBuilt = false, adFadeTimer = null, adsSig = null;
var tvMode = "ads", venueLogoUrl = "", VENUE_SLUG = "the-mini-bar";
var state = { phase: "lobby", pattern: "one", prize: "a $50 bar tab", called: [], winner: null,
              claimName: "Player", claimCount: 1, celebrated: false };
var revealT1 = null, revealT2 = null, ballInFlight = false, inFlightNum = 0;
var celebrateTimer = null, holdT = null, HOLD_MAX_MS = 5 * 60 * 1000;
var embedT = null, embedLoaded = false, EMBED_LOAD_MS = 25000;
var reloadWhenIdle = false, reloadIdleTimer = null, STUCK_MS = 3 * 60 * 1000;
var lastBingoAt = 0, lastHostAt = 0, hostConnected = true;
var joinCode = "UZRHJU", playURL = "https://venueplay.com.au/play?room=UZRHJU";

/* Not what this suite is about: QR drawing, confetti, and the pairing card. */
function renderLobby(){}
function renderClaim(){}
function renderWin(){}
function celebrate(){}
function hidePairPanel(){ $("pairPanel").classList.add("hidden"); }
function showPairPanel(){ $("pairPanel").classList.remove("hidden"); }

for (var ei = 0; ei < NEED.length; ei++) eval(SRC[NEED[ei]]);
/* Lifted if the page has it. stopReveal() is the proposed home for "put the big ball away
   on a mode switch"; the suite must keep running whether or not it exists yet. */
var OPTIONAL = ["stopReveal"];
for (var oi = 0; oi < OPTIONAL.length; oi++) { var os = grab(OPTIONAL[oi]); if (os) eval(os); }

/* Balls arrive through the page's own onMsg branch, lifted whole. */
function hostCallsBall(number, called){
  var m = { t: "ball", number: number, called: called };
  eval(BALL_BRANCH);
  record();
}

/* ================================================================================
   A.  THE AD LOOP, RUN FOR MORE THAN TWO FULL LAPS
   ================================================================================ */
print("== A. the ad loop, watched for two and a half laps ==");
ADS.slides = [
  { head: "Saturday night", tag: "Live music", sub: "From 8pm", accent: "gold" },
  { head: "Sunday session", tag: "Roast", sub: "Noon till late", accent: "green" },
  { head: "Meals from 5", accent: "blue" },
  { head: "Courtesy bus", sub: "Ask at the bar", accent: "pink" }
];
ADS.draws = [{ day: "Friday", jackpot: "$3,400", time: "7pm" }];

buildAds(); startAds(); record();
ok("the venue's five cards are on the wall, members draw last",
   adsHost.childNodes.length === 5 && adsHost.childNodes[4].innerHTML.indexOf("members draw") >= 0,
   adsHost.childNodes.length + " cards built");

var aStart = mark();
run(90000);                                   // 5 cards x 7s = 35s a lap, so this is two and a half laps
var aFrames = since(aStart);

ok("the container is never empty, not for one frame", emptyFrames === 0,
   emptyFrames + " moments with nothing in #tvAds. An empty #tvAds is the flash, and it is also " +
   "exactly what screenIsAlive() reads as a dead screen.");

var f1 = firstBad(aFrames, function(f){ return f.on.length > 0; });
ok("something is painting at every single moment", !f1,
   f1 ? at(f1, "the wall had gone to the floor colour: " + paintDesc(f1)) : "");

/* The whole point of a cross-fade rather than fade-out-then-in: the card underneath stays
   fully opaque while the new one arrives, so the room never sees the wall dip. */
/* Skipped for the first 800 ms: the page's own entry is a fade up from the floor colour. */
var f2 = firstBad(aFrames.filter(function(f){ return f.t >= 900; }), function(f){ return f.full; });
ok("at least one card is at FULL opacity at every moment", !f2,
   f2 ? at(f2, "every card was part faded, so the whole wall dipped towards the floor colour: " + paintDesc(f2)) : "");

var f3 = firstBad(aFrames, function(f){ return f.on.length <= 2; });
ok("never more than two cards painting at once", !f3,
   f3 ? at(f3, paintDesc(f3)) : "");

/* THE ONE THAT BROKE. If the card arriving is painting at all, nothing may paint over it.
   Clearing z-index at the end of the fade hands stacking back to DOM order, and the members
   draw card is later in the document than Saturday, so on the wrap it painted on top while
   still fading out. */
function currentCardIsOnTop(f){
  var arriving = null;
  f.on.forEach(function(s){ if (s.i === f.idx) arriving = s; });
  if (!arriving) return true;                 // it has not started fading in yet: nothing to cover
  return f.top === f.idx;
}
var f4 = firstBad(aFrames, currentCardIsOnTop);
ok("the card leaving NEVER paints over the card arriving", !f4,
   f4 ? at(f4, "the card on its way out covered the one coming in. " + paintDesc(f4) +
        ", and the card that should be on top is #" + f4.idx) : "");

/* And prove it at the lap boundary specifically, because every other transition looked fine
   by luck: the incoming card is later in the document for all of them except this one. */
var wraps = [];
for (var wi = 1; wi < aFrames.length; wi++) {
  if (aFrames[wi].idx === 0 && aFrames[wi - 1].idx === 4) wraps.push(aFrames[wi].t);
}
ok("the loop really did wrap from the members draw back to Saturday, twice", wraps.length >= 2,
   "only " + wraps.length + " wraps in 90 seconds, so the lap boundary was never tested");

var wrapBad = null;
wraps.forEach(function(wt){
  if (wrapBad) return;
  var win = aFrames.filter(function(f){ return f.t >= wt && f.t <= wt + 1800; });
  wrapBad = firstBad(win, function(f){
    var arriving = null;
    f.on.forEach(function(s){ if (s.i === 0) arriving = s; });
    if (!arriving) return true;
    return f.top === 0;
  });
});
ok("on the wrap, the members draw card stays UNDER the Saturday card the whole way out", !wrapBad,
   wrapBad ? at(wrapBad, "the members draw card reappeared over the Saturday card. " + paintDesc(wrapBad)) : "");

/* ================================================================================
   D.  A REBUILD WHILE THE LOOP IS RUNNING
   ================================================================================ */
print("");
print("== D. a rebuild in the middle of the loop ==");
var beforeIdx = adIdx;
emptyFrames = 0;
var dStart = mark();
var didBuild = buildAds(); record();
startAds(); record();
run(3000);
var dFrames = since(dStart);

ok("nothing is rebuilt when the venue's content has not changed", didBuild === false,
   "identical cards were thrown away and recreated, which is the flash");
ok("the loop keeps its place across a rebuild", adIdx === beforeIdx,
   "it jumped from card #" + beforeIdx + " to #" + adIdx + ": Dean's 'starts on the Saturday slide every time'");
ok("the container is never empty through a rebuild", emptyFrames === 0,
   emptyFrames + " empty moments");
var d1 = firstBad(dFrames, function(f){ return f.full; });
ok("the wall never dips through a rebuild", !d1, d1 ? at(d1, paintDesc(d1)) : "");

/* The watchdog forces a rebuild precisely because it does not trust the DOM it can see. */
emptyFrames = 0;
var d2Start = mark();
ok("a forced rebuild does happen even on unchanged content", buildAds(true) === true,
   "the watchdog's repair would do nothing at all");
record(); startAds(); record();
run(1200);
ok("a forced rebuild never empties the wall", emptyFrames === 0, emptyFrames + " empty moments");
var d3 = firstBad(since(d2Start).filter(function(f){ return f.t >= frames[d2Start].t + 900; }),
                  function(f){ return f.full; });
ok("a forced rebuild has the wall back to full brightness within a second", !d3,
   d3 ? at(d3, paintDesc(d3)) : "");

/* A resumed or rebuilt rotation must also start with the card you can see on top, or the
   very next hand over paints the wrong way round. */
var d4 = firstBad(dFrames.concat(since(d2Start)), currentCardIsOnTop);
ok("a rebuild or a resume leaves the card you can see on top of the stack", !d4,
   d4 ? at(d4, "after a rebuild the wrong card was on top. " + paintDesc(d4) +
        ", and the card that should be on top is #" + d4.idx) : "");

/* ================================================================================
   B.  CALLING BALLS, INCLUDING FASTER THAN THE REVEAL
   ================================================================================ */
print("");
print("== B. balls, one after another, faster than the 2.1 second reveal ==");
enterBingo();
state.phase = "running";
var bStart = mark();

/* one ball on its own */
hostCallsBall(7, [7]);
run(2600);
var b1 = since(bStart);
ok("after the reveal lands, the resting ball shows the number that was called",
   String($("cbNum").textContent) === "7", "it shows " + $("cbNum").textContent);
ok("and the big ball is put away, with no transform left on it",
   $("ballReveal").classList.contains("hidden") && String($("brBall").style.transform || "") === "",
   "reveal up: " + (!$("ballReveal").classList.contains("hidden")) + ", transform: '" + ($("brBall").style.transform || "") + "'");
ok("nothing else is left in flight", ballInFlight === false && inFlightNum === 0);

/* THE PAGE'S OWN RULE, from the comment in renderRun: while a ball is travelling, the
   resting ball must keep showing the number it is about to replace. If the destination
   already reads the new number there is nothing to overtake, just the same number twice. */
function noDoubleNumber(list){
  return firstBad(list, function(f){ return !(f.flying && f.flyNum && f.rest === String(f.flyNum)); });
}
var b2 = noDoubleNumber(b1);
ok("the resting ball never shows the number that is still in the air", !b2,
   b2 ? at(b2, "the resting ball already read " + b2.rest + " while the " + b2.flyNum +
        " was still flying towards it, so the room saw the same number twice") : "");

/* the second ball lands mid flight, which is what migration 76 made possible */
var raceStart = mark();
hostCallsBall(23, [7, 23]);
run(900);
hostCallsBall(41, [7, 23, 41]);        // a third, straight away
run(40);
hostCallsBall(52, [7, 23, 41, 52]);    // and a fourth on top of that
run(3000);
hostCallsBall(66, [7, 23, 41, 52, 66]);// then one after a proper pause
run(3000);
var bRace = since(raceStart);

ok("after the last ball settles the resting ball shows the last number called",
   String($("cbNum").textContent) === "66", "it shows " + $("cbNum").textContent);
ok("no ball is left in flight at the end", ballInFlight === false);
ok("the reveal layer is put away at the end", $("ballReveal").classList.contains("hidden"));

/* Never backwards. This is the fault Dean saw: a resting ball still carrying an older
   number while a newer one glides down on top of it. */
var order = { "--": -1, "7": 0, "23": 1, "41": 2, "52": 3, "66": 4 };
var seen = -1, backwards = null;
bRace.forEach(function(f){
  if (backwards) return;
  var v = order[f.rest];
  if (v === undefined) return;
  if (v < seen) backwards = f;
  if (v > seen) seen = v;
});
ok("the resting ball never goes backwards to an older number", !backwards,
   backwards ? at(backwards, "the resting ball dropped back to " + backwards.rest +
        " after it had already shown a later number") : "");

var b2b = noDoubleNumber(bRace);
ok("and it still does not when the balls come faster than the reveal", !b2b,
   b2b ? at(b2b, "the resting ball already read " + (b2b?b2b.rest:"") + " while the " + (b2b?b2b.flyNum:"") +
        " was still flying towards it, so the room saw the same number twice") : "");

/* A hidden reveal must not be parked mid glide, or the next pop starts from the wrong place. */
var b3 = firstBad(bRace, function(f){ return f.revealUp || f.xform === ""; });
ok("the big ball is never left mid glide while hidden", !b3,
   b3 ? at(b3, "the reveal was hidden with transform '" + b3.xform + "' still on it") : "");

/* The resting ball has one 180 ms handover where it fades out and back. Any longer than
   that and there is a blank hole where the called number should be. */
var invisibleFrom = null, worst = 0, worstAt = 0;
bRace.forEach(function(f){
  var vis = parseFloat(f.restOp);
  if (isNaN(vis)) vis = 1;
  if (vis < 0.05) { if (invisibleFrom === null) invisibleFrom = f.t; }
  else if (invisibleFrom !== null) {
    var len = f.t - invisibleFrom;
    if (len > worst) { worst = len; worstAt = invisibleFrom; }
    invisibleFrom = null;
  }
});
if (invisibleFrom !== null) { var tail = bRace[bRace.length - 1].t - invisibleFrom; if (tail > worst) { worst = tail; worstAt = invisibleFrom; } }
ok("the resting called number is never blank for more than the 180 ms handover", worst <= 260,
   "it was invisible for " + worst + " ms starting at " + worstAt + " ms, so the room saw an empty ball");

/* ================================================================================
   C.  IN AND OUT OF A GAME
   ================================================================================ */
print("");
print("== C. from the ads into a game and back ==");
var cStart = mark();
enterAds(); record();
run(2000);
ok("coming out of bingo puts the ads straight back up",
   !$("adsRoot").classList.contains("hidden") && frames[frames.length - 1].full,
   "the wall came back as: " + paintDesc(frames[frames.length - 1]));
ok("no bingo layer is left over the ads",
   BLAYERS_T.every(function(k){ return $(k).classList.contains("hidden"); }),
   "still up: " + BLAYERS_T.filter(function(k){ return !$(k).classList.contains("hidden"); }).join(", "));

/* THE STALE BALL. A reveal armed during a game must not still be painting once the ads are
   back: #ballReveal sits at z-index 15, right over #adsRoot at z-index 1, so a leftover ball
   is a giant number over the venue's own advertising. */
var midStart = mark();
enterBingo(); state.phase = "running";
hostCallsBall(9, [7, 23, 41, 52, 66, 9]);
run(600);                       // the game ends while the ball is still in the air
enterAds(); record();
run(3000);
var cMid = since(midStart);
var stale = firstBad(cMid, function(f){ return !(f.mode === "ads" && f.revealUp); });
ok("a ball still in the air when the game ends never paints over the ads", !stale,
   stale ? at(stale, "the ads were up and the big bingo ball was still on the screen over the top of them") : "");

var c1 = firstBad(cMid, function(f){
  if (f.mode !== "ads") return true;
  return f.on.length > 0 && !f.adsHidden;
});
ok("the wall shows something at every moment on the way back to the ads", !c1,
   c1 ? at(c1, "nothing was on the wall. " + paintDesc(c1) + ", ads hidden: " + c1.adsHidden) : "");

/* And through an embedded game that never loads, which is the black rectangle case. */
var eStart = mark();
enterEmbed("trivia"); record();
run(30000);                     // it never fires load, so the 25s watchdog drops back to the ads
var eFrames = since(eStart);
var e1 = firstBad(eFrames, function(f){
  if (f.layer) return true;                       // the Starting card or a bingo layer is up
  if (f.mode === "ads") return f.on.length > 0 && !f.adsHidden;
  return false;
});
ok("a game screen that never loads still leaves something on the wall the whole time", !e1,
   e1 ? at(e1, "the wall was black. mode " + e1.mode + ", layer " + e1.layer + ", " + paintDesc(e1)) : "");
ok("and it falls back to the ads rather than sitting on the Starting card", tvMode === "ads",
   "it is still in mode " + tvMode);
ok("the ads are painting again after the fallback", frames[frames.length - 1].full,
   paintDesc(frames[frames.length - 1]));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
