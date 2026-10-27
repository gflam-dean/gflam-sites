/* A SCREEN SHOWS THE VENUE IN ITS ADDRESS, HOWEVER THE ADDRESS WAS TYPED.
   27 Sep 2026: Dean opened /tv?=hello-hotel. The stray "=" made tv.html read no venue, so the screen
   quietly showed the last venue that browser remembered (Test Alpha) while he opened Hello Hotel's
   lobby. ?slug= had the same fault and only ever worked from memory. This RUNS the real
   tvVenueSlug() lifted from tv.html against every shape of address, with the real shared reader
   /app/vp-venueurl.js behind it (tv.html calls it since 27 Sep 2026; tools/test-venue-url.js covers
   the reader itself, the other five pages, and the shapes this file never had).
   Run: jsc tools/test-tv-reads-its-venue.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var TV = readFile("venueplay/tv.html");
var i = TV.indexOf("function tvVenueSlug(){"), d = 0, j = i, started = false;
for (; j < TV.length; j++) { if (TV[j] === "{") { d++; started = true; } else if (TV[j] === "}") { d--; if (started && d === 0) break; } }
var FN = i > 0 ? TV.slice(i, j + 1) : "";
ok("tv.html has tvVenueSlug", !!FN);
var SHARED = readFile("venueplay/app/vp-venueurl.js");
function slugFor(search){
  var window = { location: { search: search }, console: { warn: function(){} } };
  (new Function("window", SHARED))(window);
  return (new Function("window", "VPVenueURL", FN + "; return tvVenueSlug();"))(window, window.VPVenueURL);
}
[["?venue=hello-hotel", "hello-hotel", "the long form"],
 ["?hello-hotel", "hello-hotel", "the short form in the welcome email"],
 ["?=hello-hotel", "hello-hotel", "a stray '=' (what Dean typed)"],
 ["?slug=hello-hotel", "hello-hotel", "?slug= (what the test tabs used)"],
 ["?venue=Hello-Hotel&probe=1", "hello-hotel", "capitals and a second parameter"],
 ["?hello-hotel&probe=1", "hello-hotel", "short form with a second parameter"],
 ["", "", "control: no venue in the address falls through to memory"],
 ["?demo=1", "", "control: ?demo=1 is not a venue"],
 ["?probe=1", "", "control: ?probe=1 alone is not a venue"]
].forEach(function(t){ var got = slugFor(t[0]); ok(t[2] + ": " + (t[0] || "(nothing)") + " -> " + (t[1] || "(none)"), got === t[1], got); });
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
