/* A SCREEN THAT MISSED THE BROADCAST STILL CATCHES UP.

   Dean, 10 Sep 2026: "if someone adds a slide all the tvs get it?"

   Saving slides broadcasts screen_refresh, and every screen that is listening
   picks it up in a second. The screen that was off, asleep, or on a channel that
   had quietly dropped hears nothing, and nothing afterwards ever told it: the
   thirty second poll carries a reload instruction and an HQ command, never a word
   about the content. A venue that pulled a promo down would swear it worked,
   because the screen they were standing in front of updated.

   Two ways in, and this suite holds both:
     1. content_at on the poll that already runs. Costs nothing when the Worker
        sends it, and must do nothing at all when an older Worker does not.
     2. a slow ask on a timer, ads-only, as the backstop.
   Both must call loadScreen(), never a page reload: a reload is a black frame on
   a wall in front of a room.

   The real poll handler is lifted out of tv.html and run against stubs, rather
   than restated here: a copy keeps passing while the page changes.

   Run: jsc venueplay-backend/app/tv-stale-screen.test.js
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
var fnValidate = grab("validateVenue");
ok("validateVenue is still in tv.html", !!fnValidate);
if (!fnValidate) throw new Error("missing function");

/* The poll body is the inner ask(). Pull the whole of validateVenue in and drive it
   through a stubbed fetch, so the real ordering and the real guards are what run. */
var VENUE_SLUG = "the-mini-bar", CODE = "UZRHJU", TV_BUILD = "test", VP_GAME_API = "https://example.test";
var PAGE_LOADED_AT = 1000, lastCommandAt = 0, adsHoldUntil = 0, ADS_HOLD_MS = 60000;
var loadScreenCalls = 0, pageReloads = 0, badVenueShown = 0, forgotten = 0;
var reloadVenueScreen = function(){ loadScreenCalls++; };
function showBadVenue(){ badVenueShown++; }
function forgetVenue(){ forgotten++; }
function enterAds(){}
var els = {};
function el(){ return { classList:{ add:function(){}, remove:function(){}, contains:function(){ return false; } } }; }
function $(id){ if(!els[id]) els[id]=el(); return els[id]; }
var sessionStorage = { setItem:function(){}, getItem:function(){ return null; } };
var window = { __vpTvReload: function(){ pageReloads++; } };
var location = { reload: function(){ pageReloads++; } };
var intervals = [];
function setInterval(fn, ms){ intervals.push({ fn:fn, ms:ms }); return intervals.length; }
/* The "Setting up" window added 12 Sep 2026. validateVenue confirms the address on its first
   good reply and arms one timeout for the deadline, so both have to exist here or the real
   function throws before its first check. The timeouts are captured, not run, the same way
   the interval is: this suite is about the ORDER of the guards, not the clock. */
var VENUE_CONFIRMED = false, VENUE_PENDING_MS = 45000, tvMode = "ads";
var timeouts = [];
function setTimeout(fn, ms){ timeouts.push({ fn:fn, ms:ms }); return timeouts.length; }
function buildAds(){} function startAds(){}

var answer = null;
var asked = 0;
function fetch(){
  asked++;
  var a = answer;
  return Promise.resolve({ ok: a !== null, json: function(){ return Promise.resolve(a); } });
}
function encodeURIComponent(s){ return String(s); }

eval(fnValidate);
validateVenue();
var poll = intervals.length ? intervals[intervals.length-1].fn : null;
ok("the poll is still armed on a timer", !!poll);
ok("and it is the thirty second one", intervals.length && intervals[intervals.length-1].ms === 30000,
   intervals.length ? intervals[intervals.length-1].ms + "ms" : "none");

function pollOnce(reply){ answer = reply; poll(); drainMicrotasks(); }

print("== an older Worker that says nothing about the content ==");
loadScreenCalls = 0; pageReloads = 0;
pollOnce({ exists:true, name:"The Mini Bar" });
pollOnce({ exists:true, name:"The Mini Bar" });
pollOnce({ exists:true, name:"The Mini Bar" });
ok("nothing is refetched", loadScreenCalls === 0,
   "a Worker with no content_at must behave exactly as it does today");
ok("and nothing is reloaded", pageReloads === 0);

print("== a Worker that does send content_at ==");
loadScreenCalls = 0; pageReloads = 0;
pollOnce({ exists:true, content_at:"2026-09-10T09:00:00Z" });
ok("first sight is only remembered, not acted on", loadScreenCalls === 0,
   "otherwise every screen refetches the moment the field appears");
pollOnce({ exists:true, content_at:"2026-09-10T09:00:00Z" });
pollOnce({ exists:true, content_at:"2026-09-10T09:00:00Z" });
ok("an unchanged stamp costs nothing", loadScreenCalls === 0);

print("== the owner saves a slide while this screen was not listening ==");
pollOnce({ exists:true, content_at:"2026-09-10T09:04:12Z" });
ok("the screen notices and refetches its content", loadScreenCalls === 1,
   "this is the whole point: the TV that missed the broadcast catches up");
ok("it does NOT reload the page", pageReloads === 0,
   "a reload is a black frame on a wall in front of a room");
pollOnce({ exists:true, content_at:"2026-09-10T09:04:12Z" });
ok("and it does it once, not on every poll after", loadScreenCalls === 1, loadScreenCalls + " refetches");

print("== the old jobs still work ==");
loadScreenCalls = 0; pageReloads = 0; badVenueShown = 0;
pollOnce({ exists:false });
ok("one bad read does not condemn the venue", badVenueShown === 0,
   "it has to say so twice, thirty seconds apart");
pollOnce({ exists:false });
ok("two in a row does", badVenueShown === 1);
loadScreenCalls = 0;
pollOnce({ exists:true, reload_at:"2999-01-01T00:00:00Z", content_at:"2026-09-10T10:00:00Z" });
ok("an HQ reload instruction still reloads", pageReloads === 1);

print("== the slow backstop, for a Worker with no stamp at all ==");
var idx = html.indexOf("SCREEN_REFRESH_MS");
ok("there is a slow catch-up as well", idx > 0,
   "content_at needs a Worker change; until it lands nothing else tells a deaf screen");
var near = idx > 0 ? html.slice(idx, idx + 500) : "";
ok("it asks for the screen again rather than reloading the page", near.indexOf("loadScreen()") >= 0,
   "a reload is a black frame on a wall");
ok("it only runs while the ads are up", near.indexOf('tvMode==="ads"') >= 0,
   "it must never compete with a live game for the gateway");
var mins = /SCREEN_REFRESH_MS\s*=\s*(\d+)\*60\*1000/.exec(html);
ok("and it is minutes apart, not seconds", !!mins && parseInt(mins[1], 10) >= 5,
   "every screen in the country runs this; seconds would be a load test on ourselves");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
