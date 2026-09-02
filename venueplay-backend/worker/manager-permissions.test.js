/* AN OWNER CAN SWITCH OFF A MANAGER'S RIGHTS. BOTH WORKERS HAVE TO AGREE.

   The billing console lets an owner turn "Draws & raffles" off for one manager.
   billing.html hid the sections and the billing Worker refused its own routes,
   but the GAME Worker asked only the role -- so that manager could still set a
   members-draw jackpot to any figure, import or wipe the members list, or
   archive a draw, by calling the route the hidden button would have called.

   A permission enforced in one of the two places that check it is not enforced.

   Run: jsc venueplay-backend/worker/manager-permissions.test.js
*/
var bad = 0;
var ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

var CANDIDATES = [
  "venueplay-backend/worker/venueplay-game.js",
  "venueplay-game.js",
  "/Users/dean.tindale/gflam-sites-current/venueplay-backend/worker/venueplay-game.js"
];
var src = null;
for (var i = 0; i < CANDIDATES.length; i++){
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 1000) { src = t; break; } } catch(e){}
}
if (!src) { print("FAIL could not find the game Worker"); throw new Error("no source"); }

print("\nTHE RULE ITSELF (the real staffCan, lifted out of the Worker)");

var m = src.match(/function staffCan\(staff, key\) \{[\s\S]*?\n\}/);
pass("staffCan exists in the Worker", !!m);
if (!m) { print("\n" + bad + " FAILED, " + ran + " run"); throw new Error("no staffCan"); }
eval(m[0]);

var OFF = { role: 'manager', permissions: { draws_raffles: false } };
var ON  = { role: 'manager', permissions: { draws_raffles: true } };
var EMPTY = { role: 'manager', permissions: {} };
var NULLP = { role: 'manager', permissions: null };
var OTHER = { role: 'manager', permissions: { advertising: false } };
var OWNER = { role: 'owner', permissions: null };
var ADMIN = { id: null, role: 'owner', is_admin: true };

pass("manager with the toggle OFF is refused",        staffCan(OFF,  'draws_raffles') === false);
pass("manager with the toggle ON is allowed",         staffCan(ON,   'draws_raffles') === true);
pass("manager with no keys set keeps full rights",    staffCan(EMPTY,'draws_raffles') === true);
pass("manager with a null perms column is allowed",   staffCan(NULLP,'draws_raffles') === true);
pass("a DIFFERENT key being off does not leak across",staffCan(OTHER,'draws_raffles') === true);
pass("the owner is never gated",                      staffCan(OWNER,'draws_raffles') === true);
pass("an HQ admin using View as is never gated",      staffCan(ADMIN,'draws_raffles') === true);
pass("same default as vpbCan: absent means allowed",  staffCan({role:'manager'}, 'draws_raffles') === true);

print("\nTHE COLUMN IS ACTUALLY FETCHED");
/* If requireStaff does not select the column, staff.permissions is undefined on every
   row, staffCan returns true for everyone, and all eight tests above still pass while
   the Worker enforces nothing. This is the check that cannot be faked. */
var rs = src.match(/async function requireStaff\([\s\S]*?\n\}/);
pass("requireStaff selects permissions", !!rs && /select=[^']*\bpermissions\b/.test(rs[0]),
     "a check reading a column it never asked for cannot fail");

print("\nEVERY MANAGER-GATED ROUTE CHECKS IT (so a new route cannot forget)");
var gates = src.match(/if \((\w+)\.role !== 'owner' && \1\.role !== 'manager'\) \{/g) || [];
pass("found the manager gates", gates.length >= 7, gates.length + " found");

var re = /if \((\w+)\.role !== 'owner' && \1\.role !== 'manager'\) \{/g, hit, checked = 0, missing = [];
while ((hit = re.exec(src)) !== null) {
  var after = src.slice(hit.index, hit.index + 700);
  if (new RegExp("staffCan\\(" + hit[1] + ",").test(after)) checked++;
  else {
    var fn = src.slice(0, hit.index).match(/(?:async )?function (\w+)\([^)]*\)\s*\{(?![\s\S]*(?:async )?function \w+\()/);
    missing.push(fn ? fn[1] : ("line " + src.slice(0, hit.index).split("\n").length));
  }
}
pass("every manager gate also checks the toggle", missing.length === 0,
     missing.length ? "NOT CHECKED: " + missing.join(", ") : checked + "/" + gates.length);

print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
