/* WOULD THIS BADGE HAVE SAVED THE AFTERNOON OF 5 SEP?
 *
 * A venue screen that has lost its realtime socket keeps rotating the venue's
 * advertising perfectly and hears nothing at all. HQ said "Live now" and "Active",
 * which describe the SESSION, not the screen, so the only way to discover a deaf
 * screen was to press Reload TV and watch nothing happen. Three separate faults
 * were each independently blocking that button, and every diagnosis had to start by
 * guessing whether the screen was receiving anything.
 *
 * So the thresholds have to be right, and the two states that must never be
 * confused are "never had a screen" and "had one and lost it".
 *
 *   jsc venueplay-backend/worker/screen-health.test.js
 */
function findFile(rel){
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var HQ = readFile(findFile("venueplay/app/hq.html"));
var W  = readFile(findFile("venueplay-backend/worker/venueplay-game.js"));

var pass = 0, fail = 0, failed = [];
function ok(label, good, detail){
  if (good) { pass++; print("  PASS  " + label + (detail ? "  (" + detail + ")" : "")); }
  else { fail++; failed.push(label); print("  FAIL  " + label + (detail ? "  (" + detail + ")" : "")); }
}

ok("found the real hq.html", HQ.indexOf("screenBadge") > 0);

// ---- the Worker end: is the heartbeat actually recorded? --------------------
ok("the Worker selects screen_seen_at on /venue", /select=name,screen_reload_at,screen_seen_at/.test(W));
ok("and writes it back", /screen_seen_at:\s*new Date\(\)\.toISOString\(\)/.test(W));
ok("throttled, so it is not a write per request",
   /Date\.now\(\)\s*-\s*last\s*>\s*25000/.test(W), "25s against a 30s poll");
ok("the write is awaited, not left dangling",
   /await sbPatch\(env, 'vp_venues'[\s\S]{0,120}screen_seen_at/.test(W),
   "an unawaited promise in a Worker can be cancelled when the response returns");
ok("a failed write never changes the answer",
   /screen_seen_at: new Date\(\)\.toISOString\(\)[\s\S]{0,160}catch \(e\)/.test(W));
ok("it only writes when the column is really there",
   /'screen_seen_at' in v/.test(W), "or a pre-migration paste writes a column that does not exist");

// ---- HQ end: the thresholds ------------------------------------------------
ok("HQ fetches the column in its own fault-tolerant query",
   /select\("id,screen_seen_at"\)/.test(HQ),
   "naming it in listVenues would 400 the whole venue list pre-migration");

// The decision, on real numbers. Mirrors the badge's own boundaries.
function state(seen, now, slug){
  if (!slug) return "";
  if (seen === undefined) return "";
  if (!seen) return "never";
  var mins = Math.floor((now - seen) / 60000);
  if (mins <= 2) return "ok";
  if (mins <= 15) return "quiet";
  return "down";
}
var NOW = 1788600000000, M = 60000;
var cases = [
  ["a venue with no screen address",      undefined, false, ""],
  ["column missing (pre-migration)",      undefined, true,  ""],
  ["never polled at all",                 null,      true,  "never"],
  ["polled 10 seconds ago",               NOW - 10000,   true, "ok"],
  ["polled 2 minutes ago",                NOW - 2*M,     true, "ok"],
  ["polled 3 minutes ago",                NOW - 3*M,     true, "quiet"],
  ["polled 15 minutes ago",               NOW - 15*M,    true, "quiet"],
  ["polled 16 minutes ago",               NOW - 16*M,    true, "down"],
  ["polled 4 hours ago",                  NOW - 240*M,   true, "down"],
];
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var got = state(c[1], NOW, c[2] ? "the-mini-bar" : null);
  ok("badge: " + c[0], got === c[3], "got '" + got + "', want '" + c[3] + "'");
}

/* THE DISTINCTION THAT MATTERS. "Never polled" is a venue that has not opened the
   TV link yet - a setup job. "Down" is a screen that WAS working and has stopped -
   somebody has to go and power cycle it. Calling the first one DOWN would send Dean
   to a pub that never had a screen. */
ok("never-polled and down are different states",
   state(null, NOW, "x") !== state(NOW - 240*M, NOW, "x"));
ok("a venue with no slug says nothing at all",
   state(NOW - 240*M, NOW, null) === "", "no screen address means no screen to report on");

// The wording has to tell Dean what to DO, not just that something is wrong.
ok("the down badge says it needs a power cycle at the venue",
   /power cycle at the venue/i.test(HQ));
ok("the never badge names the URL to open",
   /venueplay\.com\.au\/tv\?'\+esc\(v\.slug\)/.test(HQ));

print("");
if (fail) { print(fail + " OF " + (pass + fail) + " CHECKS FAILED: " + failed.join(", ")); throw new Error(fail + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
