/* WHO IS THE OWNER, AND WHAT IS OWNER-ONLY.

   /account/portal signs the caller straight into the account's Stripe portal, where every
   invoice is readable and the card that pays the bill can be changed. It checked that the
   caller was staff and stopped there, while every other money route on this Worker called
   vpbOwnerOnly. A manager with all four toggles switched off could open it.

   In this Worker an OWNER is a staff row with NO permissions object (vpbIsOwner is
   `!o.perms`), which is not the same thing as role 'owner': a real account owner's row is
   often stored with role 'manager'. Any guard that reads the role word instead gets this
   backwards, so the rule is tested here against the real source, not a copy.

   The test lifts the real functions out of venueplay-api-FULL.js and runs them, then checks
   that the routes that must not be reachable by a restricted manager actually call them.

   Run: jsc venueplay-backend/worker/owner-only-routes.test.js
*/
var bad = 0;
var ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

var CANDIDATES = [
  "venueplay-backend/worker/venueplay-api-FULL.js",
  "venueplay-api-FULL.js"
];
var src = null;
for (var i = 0; i < CANDIDATES.length; i++){
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 1000) { src = t; break; } } catch(e){}
}
if (!src) { print("FAIL could not find the billing Worker"); throw new Error("no source"); }

print("\nTHE RULE ITSELF (the real functions, lifted out of the Worker)");

/* Count the braces rather than matching to the first "}". A lazy regex silently cut
   vpbOwnerOnly off at the closing brace of the object literal INSIDE it, and what it handed
   back still looked like a function, so the test would have been testing half a guard. */
function cut(name){
  var at = src.indexOf("function " + name + "(");
  if (at === -1) return null;
  var open = src.indexOf("{", at);
  if (open === -1) return null;
  var depth = 0;
  for (var j = open; j < src.length; j++){
    var ch = src.charAt(j);
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return null;
}
// Evalled at TOP LEVEL, not inside a helper: an eval inside a function declares the function in
// that function's scope and nothing below can see it.
var LIFTED = "";
["vpbIsOwner", "vpbOwnerOnly", "vpbCan", "vpbStaffGuard"].forEach(function(name){
  var body = cut(name);
  pass(name + " exists in the Worker", !!body);
  if (!body) { print("\n" + bad + " FAILED, " + ran + " run"); throw new Error("missing " + name); }
  LIFTED += body + "\n";
});
eval(LIFTED);

// json() stands in for the Worker's response helper: it returns a marker we can look at.
function json(body, status){ return { body: body, status: status || 200 }; }

var OWNER      = { perms: null };                                   // no permissions object = full access
var OWNER_UNDEF= { };                                               // migration 17 not run: also full access
var FULL_MGR   = { perms: null };                                   // legacy full-access login
var ALL_ON     = { perms: { advertising:true, draws_raffles:true, players_optin:true, add_hosts:true } };
var ALL_OFF    = { perms: { advertising:false, draws_raffles:false, players_optin:false, add_hosts:false } };
var HOSTS_ONLY = { perms: { advertising:false, draws_raffles:false, players_optin:false, add_hosts:true } };

print("\nvpbIsOwner: no permissions object means owner, an object means restricted");
pass("owner is an owner", vpbIsOwner(OWNER) === true);
pass("a row with no permissions column yet is an owner", vpbIsOwner(OWNER_UNDEF) === true);
pass("a manager with everything ON is still NOT the owner", vpbIsOwner(ALL_ON) === false);
pass("a manager with everything OFF is not the owner", vpbIsOwner(ALL_OFF) === false);

print("\nvpbOwnerOnly: the guard every money route uses");
pass("owner passes (null means carry on)", vpbOwnerOnly(OWNER, json) === null);
pass("manager with everything on is REFUSED", !!vpbOwnerOnly(ALL_ON, json));
pass("manager refusal is a 403", (vpbOwnerOnly(ALL_ON, json) || {}).status === 403);
pass("manager refusal says so in plain English",
     /Only the account owner/.test(((vpbOwnerOnly(ALL_ON, json) || {}).body || {}).error || ""));

print("\nvpbCan: a toggle that is missing means allowed, false means blocked");
pass("owner can do draws and raffles", vpbCan(OWNER, "draws_raffles") === true);
pass("manager with the toggle on can", vpbCan(ALL_ON, "draws_raffles") === true);
pass("manager with the toggle off cannot", vpbCan(ALL_OFF, "draws_raffles") === false);
pass("a toggle nobody has set yet is allowed", vpbCan({ perms: {} }, "draws_raffles") === true);

print("\nvpbStaffGuard: who may remove or re-scope a login");
var HOST_ROWS = [{ role:'host', permissions:null }];
var MGR_ROWS  = [{ role:'manager', permissions:{ advertising:true } }];
var FULL_ROWS = [{ role:'manager', permissions:null }];
pass("owner may touch a host", vpbStaffGuard(OWNER, HOST_ROWS, json) === null);
pass("owner may touch a manager", vpbStaffGuard(OWNER, MGR_ROWS, json) === null);
pass("manager with Add hosts may touch a host", vpbStaffGuard(HOSTS_ONLY, HOST_ROWS, json) === null);
pass("manager with Add hosts may NOT touch another manager", !!vpbStaffGuard(HOSTS_ONLY, MGR_ROWS, json));
pass("manager with Add hosts may NOT touch a full-access login", !!vpbStaffGuard(HOSTS_ONLY, FULL_ROWS, json));
pass("manager WITHOUT Add hosts may not touch a host", !!vpbStaffGuard(ALL_OFF, HOST_ROWS, json));
pass("a target with no rows at all is refused, never allowed by accident",
     !!vpbStaffGuard(HOSTS_ONLY, [], json));
pass("a mixed set (a host AND a manager) is refused as a whole",
     !!vpbStaffGuard(HOSTS_ONLY, [{ role:'host' }, { role:'manager' }], json));

print("\nTHE ROUTES THAT MUST CARRY THE GUARD");
function bodyOf(name){ return cut(name); }
function guarded(name){
  var b = bodyOf(name);
  pass(name + " is in the Worker", !!b);
  if (!b) return;
  pass(name + " calls vpbOwnerOnly", /vpbOwnerOnly\(o, json\)/.test(b));
}
// The Stripe portal: every invoice, and the card that pays the bill.
guarded("vpbBillingPortal");
// Changing what a manager may do is the owner's decision about their own account.
guarded("vpbSetManagerPerms");
// Money.
guarded("vpbSetPlayers");
guarded("vpbCancelVenue");

var rm = bodyOf("vpbRemoveHost");
pass("vpbRemoveHost is in the Worker", !!rm);
if (rm){
  pass("vpbRemoveHost goes through vpbStaffGuard", /vpbStaffGuard\(o, targetRows, json\)/.test(rm));
  pass("vpbRemoveHost still refuses to delete a full-access login",
       /full access to this account/.test(rm));
}
var sv = bodyOf("vpbSetStaffVenues");
pass("vpbSetStaffVenues is in the Worker", !!sv);
if (sv) pass("vpbSetStaffVenues goes through vpbStaffGuard", /vpbStaffGuard\(o, currentRows, json\)/.test(sv));

var dl = bodyOf("vpbDrawLog");
pass("vpbDrawLog is in the Worker", !!dl);
if (dl) pass("vpbDrawLog is gated by the Draws and raffles toggle", /vpbCan\(o, 'draws_raffles'\)/.test(dl));

print("\nEVERY NEW ROUTE IS REACHABLE (a route with no line in the dispatcher is dead code)");
["/account/manager-perms", "/account/draw-log", "/account/nights"].forEach(function(p){
  pass("the dispatcher routes " + p, src.indexOf("path === '" + p + "'") !== -1);
});

print("");
// The gate reads the LAST line and wants "ALL ... PASSED" on it. Say it the way every other
// suite here says it, or a green run is reported as a failure.
print(bad ? (bad + " FAILED, " + ran + " run") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
