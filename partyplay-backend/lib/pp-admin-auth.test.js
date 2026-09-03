/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel,
               "/Users/dean.tindale/gflam-sites-current/" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

/* THE ADMIN CONSOLE'S SIGN-IN, AND THE HOUR IT USED TO DIE AT.
 *
 * A Supabase access token lasts about an hour. The console is a page somebody
 * leaves open all evening, so the first thing they clicked after that hour came
 * back as the Worker's bare word "no". It reads as the BUTTON refusing - "I am
 * unable to remove someone from the who can get in list, it just says no" - when
 * in fact the sign-in had quietly run out. The refresh token was being thrown
 * away at sign-in, so there was nothing left to recover with.
 *
 * This READS site/admin.html and runs its real script under stubs. It is written
 * that way on purpose: a copy of the logic here would pass forever while the
 * page rotted underneath it.
 *
 * Run: jsc lib/pp-admin-auth.test.js        (from the partyplay folder)
 */
var bad = 0;
function pass(n, c){ print((c ? "  ok   " : "  FAIL ") + n); if(!c) bad++; }

/* ---- the page, exactly as it ships ---------------------------------------- */
/* Find admin.html wherever this suite is run from. The release check runs it with a
   different working directory than the partyplay folder, and a test that only works
   from one cwd is a test that fails the moment it matters. The FIRST path is the copy
   that actually deploys (the gflam-sites repo); ~/partyplay/site is the older copy. */
var CANDIDATES = [
  "partyplay/admin.html",
  "../partyplay/admin.html",
  "/Users/dean.tindale/gflam-sites-current/partyplay/admin.html",
  ppFile("partyplay/admin.html"),
  "../gflam-sites-current/partyplay/admin.html",
  "site/admin.html"
];
var html = null, usedPath = null;
for (var ci = 0; ci < CANDIDATES.length; ci++) {
  try { var t = readFile(CANDIDATES[ci]); if (t && t.length > 1000) { html = t; usedPath = CANDIDATES[ci]; break; } }
  catch (e) { /* try the next one */ }
}
if (html === null) { print("FAIL could not locate admin.html from this working directory"); throw new Error("no admin.html"); }
var scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
var code = "";
for (var i = 0; i < scripts.length; i++) {
  var body = scripts[i].replace(/^<script>/, "").replace(/<\/script>$/, "");
  if (body.length > code.length) code = body;
}
if (code.length < 5000) { print("FAIL could not find the admin script in site/admin.html"); throw new Error("no script"); }

/* Reach two internals, and stop askKey from repainting a DOM we do not have. */
code = code.replace('(function(){\n  "use strict";',
  '(function(){\n  "use strict";\n  globalThis.__api=function(){return api.apply(null,arguments);};', 1);
code = code.replace('function askKey(msg){',
  'function askKey(msg){ globalThis.__asked = msg; return;', 1);

/* ---- stubs ---------------------------------------------------------------- */
var LS = {}, refreshCalls = 0, refreshOK = true;
globalThis.localStorage = { getItem:function(k){ return k in LS ? LS[k] : null; },
  setItem:function(k,v){ LS[k]=String(v); }, removeItem:function(k){ delete LS[k]; } };
var els = {};
function el(){ return { innerHTML:"", textContent:"", hidden:false, value:"", disabled:false,
  classList:{ add:function(){}, toggle:function(){}, remove:function(){} },
  addEventListener:function(){}, focus:function(){}, querySelectorAll:function(){ return []; } }; }
globalThis.document = { getElementById:function(i){ return els[i] || (els[i] = el()); },
  addEventListener:function(){}, createElement:el, body:el() };
globalThis.window = globalThis;
globalThis.PPConfig = { API:"https://api.test", SUPA_URL:"https://s.test", SUPA_ANON:"anon",
  channel:function(c){ return c; } };
globalThis.supabase = { createClient:function(){ return { auth:{
  refreshSession:function(){ refreshCalls++;
    return Promise.resolve(refreshOK ? { data:{ session:{ access_token:"NEW", refresh_token:"R2" } } }
                                     : { data:{ session:null } }); },
  signInWithOtp:function(){ return Promise.resolve({}); },
  verifyOtp:function(){ return Promise.resolve({}); } } }; } };

/* The Worker: only a fresh token or the shared key gets in. Anything else is the
   403 {"error":"no"} that started all this. */
globalThis.fetch = function(url, o){
  var h = o.headers || {};
  var ok = h["Authorization"] === "Bearer NEW" || h["X-Admin-Key"] === "SHAREDKEY";
  return Promise.resolve({ ok:ok, status: ok ? 200 : 403,
    json:function(){ return Promise.resolve(ok ? { ok:true, staff:[] } : { error:"no" }); } });
};

(0, eval)(code);

/* ---- the three paths ------------------------------------------------------ */
LS.ppAdminTok = "OLD"; LS.ppAdminRef = "R1"; delete LS.ppAdminKey;
refreshOK = true; refreshCalls = 0;
__api("/admin/staff").then(function(j){
  pass("expired token + good refresh -> retries and succeeds", !!(j && j.ok));
  pass("  the refresh token was actually spent", refreshCalls === 1);
  pass("  the new pair is stored for next time", LS.ppAdminTok === "NEW" && LS.ppAdminRef === "R2");

  LS.ppAdminTok = "OLD"; LS.ppAdminRef = "R1"; LS.ppAdminKey = "SHAREDKEY";
  refreshOK = false; refreshCalls = 0;
  return __api("/admin/staff/off", { method:"POST", body:"{}" });
}).then(function(j){
  pass("dead refresh + shared key -> Remove still works", !!(j && j.ok));
  pass("  the dead token was cleared out of the way", !LS.ppAdminTok);

  LS.ppAdminTok = "OLD"; LS.ppAdminRef = "R1"; delete LS.ppAdminKey;
  refreshOK = false; globalThis.__asked = null;
  return __api("/admin/staff/off", { method:"POST", body:"{}" }).then(
    function(){ pass("dead refresh + no key should not resolve", false); },
    function(e){
      pass("dead refresh + no key -> flagged handled, so no form prints it", e.handled === true);
      pass("  the bare word \"no\" never reaches the user", e.message !== "no");
      pass("  the user is told the sign-in ran out", /sign in again/i.test(globalThis.__asked || ""));
    });
}).then(function(){
  print(bad ? ("FAILED " + bad + " CHECKS") : ("ALL 9 CHECKS PASSED  (" + usedPath + ")"));
}).catch(function(e){ print("HARNESS ERROR: " + (e && e.message)); });
