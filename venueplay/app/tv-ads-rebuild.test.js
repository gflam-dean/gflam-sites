/* THE AD LOOP DOES NOT FLASH, AND DOES NOT JUMP BACK TO THE FIRST SLIDE.

   Dean, watching the wall at The Mini Bar on 10 Sep 2026: "there is a glitch where
   it flashes when it goes back to the saturday slide", and "the tv also seems to
   start on the Saturday slide everytime i switch to that tab".

   One fault, two symptoms. Bringing the tab forward called buildAds() and startAds()
   again on byte-identical content. buildAds() cleared #tvAds and re-appended every
   slide, so the container passed through a state with nothing in it (the flash, and
   the exact thing screenIsAlive() reads as a dead screen), and startAds() then set
   adIdx back to 0, which is why the loop restarted on the first slide.

   Three rules come out of that, and this suite holds all three:
     1. a rebuild never empties the container, not even for an instant
     2. a rebuild does not restart the rotation when the content has not changed
     3. when the content has not changed, nothing is rebuilt at all

   The real functions are lifted out of tv.html and run against a stubbed DOM,
   rather than restated here: a copy keeps passing while the page changes.

   Run: jsc venueplay/app/tv-ads-rebuild.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay/tv.html", "../tv.html", "tv.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 10000) { html = t; break; } } catch (e) {}
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
var fnBuild = grab("buildAds"), fnSig = grab("adsSignature"), fnStart = grab("startAds"), fnStop = grab("stopAds");
ok("buildAds is still in tv.html", !!fnBuild);
ok("adsSignature is still in tv.html", !!fnSig);
ok("startAds is still in tv.html", !!fnStart);
if (!fnBuild || !fnSig || !fnStart || !fnStop) throw new Error("missing functions");

/* ---------------- a DOM small enough to run these and nothing more ---------------- */
var emptyFrames = 0;   // every moment the live container held no slides at all
function classList(node){
  return {
    add:    function(c){ if (node.className.indexOf(c) < 0) node.className = (node.className + " " + c).trim(); },
    remove: function(c){ node.className = node.className.split(" ").filter(function(x){ return x && x !== c; }).join(" "); },
    contains: function(c){ return node.className.split(" ").indexOf(c) >= 0; },
    toggle: function(c, on){ if (on) this.add(c); else this.remove(c); }
  };
}
function el(){
  var node = { className:"", style:{}, childNodes:[], live:false };
  node.classList = classList(node);
  node.appendChild = function(n){
    // Appending MOVES a node, exactly as a browser does. Without that, draining a detached
    // container with `while (pending.firstChild)` never finishes.
    if (n.parent && n.parent !== node) n.parent.removeChild(n);
    n.parent = node;
    node.childNodes.push(n);
    if (node.live) checkNotEmpty();
    return n;
  };
  node.removeChild = function(n){
    var i = node.childNodes.indexOf(n);
    if (i < 0) throw new Error("not a child");
    node.childNodes.splice(i, 1);
    if (node.live) checkNotEmpty();
    return n;
  };
  Object.defineProperty(node, "firstChild", { get: function(){ return node.childNodes[0] || null; } });
  var raw = "";
  Object.defineProperty(node, "innerHTML", {
    get: function(){ return raw; },
    set: function(v){ raw = String(v); node.childNodes = []; if (node.live) checkNotEmpty(); }
  });
  node.querySelector = function(sel){ return node.querySelectorAll(sel)[0] || null; };
  node.querySelectorAll = function(sel){
    var want = sel.split(".").filter(Boolean);
    return node.childNodes.filter(function(c){
      return want.every(function(w){ return c.classList.contains(w); });
    });
  };
  return node;
}
var host = el(); host.live = true;
function checkNotEmpty(){ if (host.childNodes.length === 0) emptyFrames++; }
function $(id){ return id === "tvAds" ? host : el(); }
var document = { createElement: function(){ return el(); } };

/* The venue's own content, and the two renderers that turn it into slides. Kept
   deliberately simple: this suite is about WHEN the slides are rebuilt, not what
   they say. entryClass and entryInner are stubbed so a slide's text is its id. */
var ADS = { slides: [], raffle: null, draws: [], rotationSecs: 7 };
function loopEntries(){
  var arr = ADS.slides.map(function(s){ return { type:"slide", slide:s }; });
  if (!arr.length) arr.push({ type:"holding" });
  return arr;
}
function entryClass(e){ return e.type === "holding" ? "ad-a" : "ad-b"; }
function entryInner(e){ return e.type === "holding" ? "<i>holding</i>" : "<b>" + e.slide.head + "</b>"; }

var adIdx = 0, adTimer = null, adBuilt = false, adFadeTimer = null, adsSig = null;
var timers = [];
function setTimeout(fn, ms){ timers.push({ fn:fn, ms:ms }); return timers.length; }
function clearTimeout(){}
function clearInterval(){}
eval(fnSig); eval(fnBuild); eval(fnStop); eval(fnStart);

function shownIndex(){
  for (var i = 0; i < host.childNodes.length; i++) if (host.childNodes[i].classList.contains("show")) return i;
  return -1;
}

/* ---------------- the venue's five slides ---------------- */
ADS.slides = [{head:"Saturday"},{head:"Sunday"},{head:"Meals"},{head:"Courtesy bus"},{head:"Members draw"}];

print("== the first build ==");
var first = buildAds();
ok("the first call actually builds the slides", first === true);
ok("all five are there", host.childNodes.length === 5, host.childNodes.length + " slides");
startAds();
ok("the rotation starts on the first slide", shownIndex() === 0);
ok("nothing was empty on the way", emptyFrames === 0);

/* One full slide change: advance() brings the next slide up OVER the old one and only
   takes the old one away when the cross-fade timer fires, so both are lit in between.
   Run both, or the wall looks like it never moved. */
function tickAdvance(){
  timers[adTimer - 1].fn();
  if (adFadeTimer) timers[adFadeTimer - 1].fn();
}
print("== the loop runs on ==");
tickAdvance();
tickAdvance();
ok("the wall is now on the third slide", shownIndex() === 2, "on slide " + shownIndex());

print("== bringing the tab forward, with nothing changed ==");
emptyFrames = 0;
var rebuilt = buildAds();
ok("an unchanged rotation is not rebuilt at all", rebuilt === false,
   "identical slides were thrown away and recreated: that is the flash");
ok("the container was never empty", emptyFrames === 0,
   "an empty #tvAds is what screenIsAlive() reads as a dead screen");
startAds();
ok("and the wall carries on from where it was", shownIndex() === 2,
   "it went back to slide " + shownIndex() + ": Dean's 'starts on the Saturday slide every time'");

print("== the same thing ten times over ==");
for (var k = 0; k < 10; k++) { buildAds(); startAds(); }
ok("ten wake-ups do not move the wall", shownIndex() === 2, "on slide " + shownIndex());
ok("and never blank it", emptyFrames === 0);

print("== the venue changes a slide ==");
emptyFrames = 0;
ADS.slides = [{head:"Saturday"},{head:"Sunday"},{head:"NEW meal deal"},{head:"Courtesy bus"},{head:"Members draw"}];
ok("a real change IS rebuilt", buildAds() === true);
ok("the swap never emptied the wall", emptyFrames === 0,
   "build the new set detached and swap it in; never clear then refill");
ok("the new slide is on the wall", host.childNodes[2].innerHTML.indexOf("NEW meal deal") >= 0);
startAds();
ok("a genuinely different set starts at the top", shownIndex() === 0);

print("== the watchdog does not trust what it can see ==");
emptyFrames = 0;
host.childNodes.forEach(function(c){ c.classList.remove("show"); });   // the fault: built, nothing lit
ok("a forced rebuild happens even though nothing changed", buildAds(true) === true,
   "the watchdog calls precisely because the DOM cannot be trusted");
ok("and it still never empties the wall", emptyFrames === 0);
startAds();
ok("the repair lights a slide", shownIndex() >= 0);

var wd = html.indexOf("cheap repair first");
ok("the watchdog repair asks for a forced rebuild",
   wd > 0 && html.slice(wd, wd + 400).indexOf("buildAds(true)") >= 0,
   "an unforced rebuild would skip the repair the watchdog exists to do");

print("== one bad slide still costs one slide ==");
emptyFrames = 0; adsSig = null;
ADS.slides = [{head:"Saturday"}, null, {head:"Sunday"}];
var goodEntryInner = entryInner;
entryInner = function(e){ if (!e.slide) throw new Error("bad row"); return goodEntryInner(e); };
buildAds();
entryInner = goodEntryInner;
ok("the good slides survive a bad row", host.childNodes.length === 2, host.childNodes.length + " slides");
ok("and the wall was never empty while it happened", emptyFrames === 0);

print("== a venue with nothing at all still sees something ==");
emptyFrames = 0; adsSig = null;
ADS.slides = [];
buildAds();
ok("the holding card goes up rather than an empty wall", host.childNodes.length === 1);
ok("never empty", emptyFrames === 0);

print("== every slide fails at once ==");
emptyFrames = 0; adsSig = null;
ADS.slides = [{head:"Saturday"},{head:"Sunday"}];
entryInner = function(e){ if (e.slide) throw new Error("all bad"); return goodEntryInner(e); };
buildAds();
entryInner = goodEntryInner;
ok("the room still sees something", host.childNodes.length === 1);
ok("and the fallback is NOT remembered as the venue's real slides", adsSig === null,
   "otherwise the first good poll after the outage would be skipped as unchanged");
ok("never empty", emptyFrames === 0);

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
