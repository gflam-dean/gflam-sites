/* THE VENUE LIST MUST NOT HAVE A CEILING.

   Every screen polls /venue?code= every thirty seconds, and that resolves
   through a map built from vp_venues. It was built with `limit=5000` and no
   status filter, so:

     * every venue EVER created counted, cancelled ones included. Three thousand
       trading plus three thousand churned is six thousand rows, and the map held
       five thousand - so live venues would stop resolving while cancelled ones
       held the slots, in whatever order Postgres returned them.
     * past the ceiling a venue's screen shows "not linked to an account" and its
       join code resolves to nothing. No error is raised anywhere. It is silent.

   Dean asked the right question about it: is that a total, including cancelled?
   It was.

   Run: jsc venueplay-backend/worker/venue-scale.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay-backend/worker/venueplay-game.js", "venueplay-game.js", "../worker/venueplay-game.js"];
var src = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 5000) { src = t; break; } } catch (e) {}
}
if (src === null) { print("FAIL could not find venueplay-game.js"); throw new Error("no source"); }

print("== no hard row ceiling on a table that only grows ==");
ok("the venue-code map is not capped at 5000",
   !/vp_venues',\s*'select=id,slug&limit=\d+'/.test(src),
   "a fixed limit here means venues past it silently stop working");
var rc = /async function refreshVenueCodes[\s\S]*?\n\}/.exec(src);
ok("refreshVenueCodes is still there", !!rc);
ok("it reads every page, not the first one", !!rc && /sbGetAll/.test(rc[0]),
   "must page until the rows run out");
ok("it ignores suspended venues", !!rc && /status=neq\.suspended/.test(rc[0]),
   "a venue that cannot run a game should not hold a code, or take up a slot");

print("== the pager stops on an EMPTY page, never a short one ==");
var pg = /async function sbGetAll[\s\S]*?\n\}/.exec(src);
ok("sbGetAll exists", !!pg);
ok("it stops only when nothing comes back", !!pg && /rows\.length === 0/.test(pg[0]),
   "stopping on a short page truncates silently if Supabase caps below the page size");
ok("it advances by what came back, not by what was asked for",
   !!pg && /offset \+= rows\.length/.test(pg[0]),
   "advancing by the requested size skips rows whenever a page comes back short");

print("== it actually pages, against a stubbed database ==");
/* 6,300 venues: what 3,000 trading and 3,300 cancelled looks like. */
var TOTAL = 6300, CAP = 1000, calls = 0;
function fakeGet(env, table, q) {
  calls++;
  var lim = parseInt(/limit=(\d+)/.exec(q)[1], 10);
  var off = parseInt(/offset=(\d+)/.exec(q)[1], 10);
  var n = Math.max(0, Math.min(Math.min(lim, CAP), TOTAL - off));
  var rows = []; for (var i = 0; i < n; i++) rows.push({ id: off + i, slug: "v" + (off + i) });
  return Promise.resolve(rows);
}
var sbGet = fakeGet;
eval(pg[0]);
var done = false, got = null;
sbGetAll({}, 'vp_venues', 'select=id,slug').then(function (r) { got = r; done = true; });
for (var spin = 0; spin < 100 && !done; spin++) { drainMicrotasks(); }
ok("all 6,300 venues come back, not the first 1,000 or 5,000",
   got && got.length === TOTAL, got ? ("got " + got.length) : "did not finish");
ok("and it took several pages to do it", calls > 1, calls + " request(s)");

/* Now the platform cap BELOW the page size, which broke the first version. */
CAP = 500; calls = 0; done = false; got = null;
sbGetAll({}, 'vp_venues', 'select=id,slug').then(function (r) { got = r; done = true; });
for (var spin = 0; spin < 100 && !done; spin++) { drainMicrotasks(); }
ok("still gets all 6,300 when the database caps pages below what we ask for",
   got && got.length === TOTAL, got ? ("got " + got.length) : "did not finish");

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
