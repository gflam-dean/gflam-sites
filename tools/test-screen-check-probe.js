/* OUR SCREEN TEST MUST NOT LOOK LIKE A VENUE'S TV.
   25 Sep 2026: verify-live.py renders /screen-check for Tugun and Wellshot, which loads the real
   /tv, whose poll wrote the venue's heartbeat. HQ then showed Tugun's screen alive at 14:30 and
   18:05, and a TV that may not exist was reported as switched off. The Worker already answers a
   probe=1 poll without writing (screen-probe.test.js); the page never passed it on.
   This builds the TV's REAL poll address, lifted from tv.html, as a real screen and as the test.
   Run: jsc tools/test-screen-check-probe.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var TV = readFile("venueplay/tv.html"), SC = readFile("venueplay/screen-check.html");

var m = TV.match(/fetch\((VP_GAME_API\+"\/venue\?code="\+encodeURIComponent\(CODE\)[^\n]*?)\)\s*\n\s*\.then/);
ok("the TV's heartbeat poll is where this test expects it", !!m);
function pollUrl(search){
  var VP_GAME_API = "https://w", CODE = "ABC123", VENUE_SLUG = "tugun-bowls", TV_BUILD = "b1";
  var location = { search: search };
  return eval(m[1]);
}
if (m) {
  var real = pollUrl("?venue=tugun-bowls");
  ok("a real screen's poll is NOT a probe (it must record the heartbeat)", real.indexOf("probe") < 0, real);
  var tool = pollUrl("?venue=tugun-bowls&probe=1");
  ok("the screen test's poll carries probe=1", /[?&]probe=1(&|$)/.test(tool), tool);
  ok("probe=true is not probe=1 (a typo fails safe: it records)", pollUrl("?venue=x&probe=true").indexOf("probe") < 0);
  ok("probe=10 is not probe=1", pollUrl("?probe=10").indexOf("probe") < 0);
}
ok("/screen-check loads the TV with probe=1",
   /stage\.src\s*=\s*'\/tv\?venue='\s*\+\s*encodeURIComponent\(VENUE\)\s*\+\s*'&probe=1'/.test(SC));

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
