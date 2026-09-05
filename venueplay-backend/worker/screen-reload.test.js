/* A SCREEN THAT RELOADS FOR EVER IS WORSE THAN ONE THAT NEVER RELOADS.
 *
 * The pull works by comparing a timestamp HQ sets against the page's own load
 * time. Get the comparison the wrong way round, or forget that the poll repeats
 * every thirty seconds, and a single press of the button puts a venue's screen
 * into a reload loop in front of a room. So the decision is tested on its own.
 *
 *   jsc venueplay-backend/worker/screen-reload.test.js
 */
function findFile(rel){
  var tries = [rel, "../" + rel, "../../" + rel, "venueplay/tv.html"];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var TV = readFile(findFile("venueplay/tv.html"));

var pass = 0, fail = 0, failed = [];
function ok(label, good, detail){
  if (good) { pass++; print("  PASS  " + label + (detail ? "  (" + detail + ")" : "")); }
  else { fail++; failed.push(label); print("  FAIL  " + label + (detail ? "  (" + detail + ")" : "")); }
}

/* THE FILE UNDER TEST IS THE ONE WE SHIP. Twice in this project a suite has passed
   against a copy nobody deploys. */
ok("found the real tv.html", TV.indexOf("PAGE_LOADED_AT") > 0 && TV.indexOf("hq-asked") > 0);

// The decision, lifted as prose rather than re-implemented: re-implementing it is how
// founding-gate.test.js came to pass with the Worker's own gate deleted.
var m = TV.match(/if\(d\.reload_at\)\{([\s\S]{0,700}?)\n          \}/);
ok("the pull block is in tv.html", !!m);
var block = m ? m[1] : "";
ok("it compares against the page's own load time", /asked\s*>\s*PAGE_LOADED_AT/.test(block),
   "must be strictly greater, or the same request reloads on every poll");
ok("it guards against an unparseable date", /isFinite\(asked\)/.test(block));
ok("it returns after reloading", /return;/.test(block));

// Now the behaviour, on the real numbers.
function shouldReload(reload_at, pageLoadedAt){
  if (!reload_at) return false;
  var asked = Date.parse(reload_at);
  if (!isFinite(asked) || !(asked > pageLoadedAt)) return false;
  return true;
}
var LOADED = Date.parse("2026-09-05T10:00:00Z");
var cases = [
  ["no timestamp at all",                    null,                        false],
  ["a reload asked for BEFORE this page loaded", "2026-09-05T09:59:00Z",  false],
  ["asked at the exact load moment",         "2026-09-05T10:00:00Z",      false],
  ["asked one second after loading",         "2026-09-05T10:00:01Z",      true ],
  ["asked an hour after loading",            "2026-09-05T11:00:00Z",      true ],
  ["a nonsense timestamp",                   "not-a-date",                false],
  ["an empty string",                        "",                          false],
];
for (var i = 0; i < cases.length; i++) {
  var c = cases[i], got = shouldReload(c[1], LOADED);
  ok("reload? " + c[0], got === c[2], "got " + got + ", want " + c[2]);
}

/* THE LOOP. A screen reloads, comes back with a NEW load time, and polls again. The
   same stored timestamp must not fire a second time - that is the whole difference
   between a reload and a reload loop. */
var askedAt = "2026-09-05T10:00:01Z";
var firstLoad = LOADED;
ok("the first poll after the request reloads", shouldReload(askedAt, firstLoad) === true);
var secondLoad = Date.parse(askedAt) + 500;      // the page that came back
ok("and the reloaded page does NOT reload again", shouldReload(askedAt, secondLoad) === false,
   "this is the reload loop guard");
var thirdLoad = secondLoad + 30000;              // thirty seconds later, next poll
ok("nor thirty seconds after that", shouldReload(askedAt, thirdLoad) === false);

// The Worker must actually send the field, and by that name.
var W = readFile(findFile("venueplay-backend/worker/venueplay-game.js"));
ok("the Worker returns reload_at on /venue", /reload_at:\s*v\.screen_reload_at/.test(W));
ok("the Worker selects the column it returns", /select=name,screen_reload_at/.test(W));
ok("POST /screen/reload is routed", /path === '\/screen\/reload'/.test(W));
ok("and it is HQ-admin gated", /handleScreenReload[\s\S]{0,900}vp_platform_admins/.test(W));

/* PASTED BEFORE THE MIGRATION. /venue is what a screen polls to check its venue
   still exists, and two failures put a full-screen "not linked to an account" card
   over the venue's advertising. Selecting a column the database does not have yet
   would do that to every venue at once, so the select has to fall back. */
ok("selecting the new column has a fallback",
   /select=name,screen_reload_at[\s\S]{0,400}catch\(\(\) => null\)[\s\S]{0,300}select=name&limit=1/.test(W),
   "or a Worker pasted before migration 63 blanks every screen");

print("");
/* The gate looks for "ALL ... PASSED" on the last line. Printing a lowercase
   "19 of 19 checks passed" made release-check report this suite as FAILING while
   every assertion in it passed - a suite whose success the gate cannot recognise
   is as good as a broken one. */
if (fail) {
  print(fail + " OF " + (pass + fail) + " CHECKS FAILED: " + failed.join(", "));
  throw new Error(fail + " failed");
}
print("ALL " + pass + " CHECKS PASSED");
