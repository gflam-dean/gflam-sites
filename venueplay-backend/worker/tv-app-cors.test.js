/* THE SAMSUNG AND LG TV APPS CAN ASK THE TWO SET-UP QUESTIONS, AND NOTHING ELSE (2 Nov 2026).

   A Samsung (Tizen) or LG (webOS) app runs from the TV's own storage, so its requests say
   Origin: null (or file://). The game Worker reflected only venueplay.com.au origins and answered
   anything else with https://www.venueplay.com.au, which a browser refuses: measured live on
   31 Oct and again 1 Nov 2026,
       Origin: null -> access-control-allow-origin: https://www.venueplay.com.au   (refused)
   so the app could not look up a screen code. The two read-only set-up lookups now answer any
   origin. This suite lifts the real CORS block out of the shipped Worker and RUNS it:
     - GET /venue?code=..&probe=1 and GET /venues/like from Origin: null get "*"
     - their preflights (OPTIONS) too
     - GET /venue WITHOUT probe=1 (the heartbeat that writes) does NOT
     - every other route from Origin: null still gets the canonical site, never "*"
     - a venueplay.com.au origin is still reflected as itself on every route

   Run: jsc venueplay-backend/worker/tv-app-cors.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel, "../../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");

/* The block, from the shipped file: from reading the Origin header to the cors object. */
var a = GAME.indexOf("const reqOrigin = request.headers.get('Origin')");
var b = GAME.indexOf("const json = (obj", a);
pass("the CORS block is found in the shipped Worker", a > 0 && b > a);
var BLOCK = GAME.slice(a, b);

/* jsc has no URL; a small one, enough for pathname and searchParams. */
function MiniURL(u) {
  var m = /^https?:\/\/[^\/?#]+([^?#]*)(\?[^#]*)?/.exec(u);
  this.pathname = (m && m[1]) || "/";
  var q = (m && m[2]) ? m[2].slice(1) : "", map = {};
  q.split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); map[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
  this.searchParams = { get: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; } };
}
var run = new Function("request", "env", "URL", BLOCK + "\n;return cors;");
function corsFor(method, url, origin, env) {
  var req = { method: method, url: url, headers: { get: function (h) { return h === "Origin" ? origin : null; } } };
  return run(req, env || {}, MiniURL)["Access-Control-Allow-Origin"];
}
var G = "https://game.venueplay.com.au";

print("THE TV APPS' TWO LOOKUPS");
pass("GET /venue?code=..&probe=1 from Origin: null answers *", corsFor("GET", G + "/venue?code=4NJPNQ&probe=1", "null") === "*");
pass("GET /venues/like from Origin: null answers *", corsFor("GET", G + "/venues/like?slug=test-alpha", "null") === "*");
pass("GET /venues/like/ (a trailing slash) from file:// answers *", corsFor("GET", G + "/venues/like/?slug=test-alpha", "file://") === "*");
pass("their preflight (OPTIONS) answers * too", corsFor("OPTIONS", G + "/venue?code=4NJPNQ&probe=1", "null") === "*");

print("\nNOTHING ELSE IS WIDENED");
pass("GET /venue WITHOUT probe=1 (the heartbeat) from Origin: null is NOT *", corsFor("GET", G + "/venue?code=4NJPNQ", "null") === "https://www.venueplay.com.au");
pass("GET /venue?probe=0 from Origin: null is NOT *", corsFor("GET", G + "/venue?code=4NJPNQ&probe=0", "null") === "https://www.venueplay.com.au");
pass("POST /venue?probe=1 from Origin: null is NOT *", corsFor("POST", G + "/venue?code=4NJPNQ&probe=1", "null") === "https://www.venueplay.com.au");
["/host/session", "/join", "/venues/likes", "/venue/x", "/health"].forEach(function (p) {
  pass("GET " + p + " from Origin: null is NOT *", corsFor("GET", G + p + "?probe=1", "null") === "https://www.venueplay.com.au");
});
pass("an ALLOW_ORIGIN list still comes first for other origins", corsFor("GET", G + "/join", "null", { ALLOW_ORIGIN: "https://staging.example" }) === "https://staging.example");

print("\nOUR OWN SITE IS UNCHANGED");
pass("https://venueplay.com.au on a lookup is reflected, not *", corsFor("GET", G + "/venues/like?slug=x", "https://venueplay.com.au") === "https://venueplay.com.au");
pass("https://www.venueplay.com.au on a host route is reflected", corsFor("GET", G + "/host/session", "https://www.venueplay.com.au") === "https://www.venueplay.com.au");

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " failed");
