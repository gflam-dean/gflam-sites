/* TWO ROYAL HOTELS MUST NOT BE THE SAME VENUE.

   The join code is a hash of the slug, so two venues sharing a slug share a code,
   and the game Worker refuses a code it cannot attribute: both venues lose the
   ability to be joined at all. The slug is also printed on table talkers, so it
   cannot be corrected afterwards.

   Australia has 100 Royal Hotels, 68 Commercials and 37 Railways in the venue
   database, so this is not a rare path. This lifts the real vpaUniqueSlug out of
   the Worker and runs it against a pretend database.

   Run: jsc venueplay-backend/worker/slug-ladder.test.js
*/
var bad = 0;
function pass(n, c, extra){ print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

var CANDIDATES = [
  "venueplay-backend/worker/venueplay-api-FULL.js",
  "venueplay-api-FULL.js"
];
var src = null;
for (var i = 0; i < CANDIDATES.length; i++){
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 1000) { src = t; break; } } catch(e){}
}
if (!src) { print("FAIL could not find the Worker"); throw new Error("no source"); }

function grab(name){
  var i = src.indexOf("async function " + name + "(");
  if (i < 0) return null;
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}
var fnTaken = grab("vpaSlugTaken"), fnSlug = grab("vpaUniqueSlug");
pass("vpaUniqueSlug is still in the Worker", !!fnSlug);
pass("vpaSlugTaken is still in the Worker", !!fnTaken);
if (!fnSlug || !fnTaken) throw new Error("missing functions");

/* The pretend database: whatever we say is already taken. */
var TAKEN = {};
function vpaSelect(env, table, q){
  var m = /slug=eq\.([^&]+)/.exec(q);
  var slug = m ? decodeURIComponent(m[1]) : "";
  return Promise.resolve(TAKEN[slug] ? [{ id: "x" }] : []);
}
eval(fnTaken);
eval(fnSlug);

function run(base, postcode, taken){
  TAKEN = {};
  (taken || []).forEach(function(t){ TAKEN[t] = true; });
  var out = null;
  vpaUniqueSlug({}, base, "seed-uuid-abcdef", postcode).then(function(r){ out = r; });
  drainMicrotasks();
  return out;
}

pass("a name nobody has taken is used as it is",
     run("royal-hotel", "2026", []) === "royal-hotel");

pass("the second Royal Hotel is separated by its postcode",
     run("royal-hotel", "2026", ["royal-hotel"]) === "royal-hotel-2026",
     run("royal-hotel", "2026", ["royal-hotel"]));

pass("a third Royal in the SAME postcode still gets its own name",
     run("royal-hotel", "2026", ["royal-hotel", "royal-hotel-2026"]) === "royal-hotel-2026-2",
     run("royal-hotel", "2026", ["royal-hotel", "royal-hotel-2026"]));

var many = ["royal-hotel", "royal-hotel-2026"];
for (var n = 2; n <= 9; n++) many.push("royal-hotel-2026-" + n);
var last = run("royal-hotel", "2026", many);
pass("nine of them in one postcode still resolves to something unique",
     last.indexOf("royal-hotel-2026-") === 0 && many.indexOf(last) === -1, last);

pass("no postcode still separates rather than colliding",
     run("royal-hotel", "", ["royal-hotel"]) === "royal-hotel-2",
     run("royal-hotel", "", ["royal-hotel"]));

pass("a postcode is digits only, four of them",
     run("royal-hotel", "NSW 2026 ", ["royal-hotel"]) === "royal-hotel-2026",
     run("royal-hotel", "NSW 2026 ", ["royal-hotel"]));

pass("an empty name does not produce a bare dash",
     run("", "2026", []).indexOf("venue-") === 0, run("", "2026", []));

/* The fault the old version had: it checked ONCE, so if the fallback name was
   also taken it handed it out anyway. */
pass("it never returns a name it was told is taken",
     ["royal-hotel", "royal-hotel-2026", "royal-hotel-2026-2"]
       .indexOf(run("royal-hotel", "2026", ["royal-hotel", "royal-hotel-2026", "royal-hotel-2026-2"])) === -1);

print(bad ? ("  " + bad + " FAILED") : "ALL CHECKS PASSED");
if (bad) throw new Error(bad + " failed");
