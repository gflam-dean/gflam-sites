/* "SEARCH BY VENUE NAME" ON THE SAMSUNG AND LG APPS FINDS A VENUE BY ITS WORDS (4 Nov 2026).

   Dean, LG simulator, 3 Nov 2026 ~7pm, against the live lookup (GET /venues/like?slug=):
     - "mini bar" did NOT find The Mini Bar; "the mini" did. It was a prefix on the whole name.
     - "test alph" found nothing; only the whole of "test alpha" did. Six letters at least, as a slug.
   The apps now send ?q=<what was typed>, matched on words. This suite lifts the real search code out
   of the shipped Worker (from FIND_MIN_LETTERS to handleVenueLike's routing line) and RUNS it against
   a fake database and a fake rate limiter:
     - every example Dean gave, and the ones in the brief ("minibar", "tugun", "test al");
     - three letters is enough, two is not, and "the" alone is not;
     - only ACTIVE venues, at most five, best first, "more" past that and never a count;
     - only name, postcode, state and slug come back, never an id, email, code or status;
     - the per-network rate limit answers 429 and the database is not asked;
     - ?slug= (the bingo TV finding its family of same-named pubs) is untouched.

   Run: jsc venueplay-backend/worker/tv-venue-search.test.js
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

var a = GAME.indexOf("const FIND_MIN_LETTERS");
var b = GAME.indexOf("async function handleVenueLike(request, env, json) {", a);
var c = GAME.indexOf("\n", GAME.indexOf("if (url.searchParams.get('q') !== null)", b));
pass("the name search is found in the shipped Worker", a > 0 && b > a && c > b);
var lim = /const FIND_MAX_PER_IP = (\d+);/.exec(GAME);
pass("a per-network limit on name searches is set", !!lim && +lim[1] > 0 && +lim[1] <= 30, lim && lim[1]);

/* jsc has no URL; a small one, enough for searchParams. */
function MiniURL(u) {
  var m = /^https?:\/\/[^\/?#]+([^?#]*)(\?[^#]*)?/.exec(u);
  this.pathname = (m && m[1]) || "/";
  var q = (m && m[2]) ? m[2].slice(1) : "", map = {};
  q.split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); map[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
  this.searchParams = { get: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; } };
}

var DB = [
  { slug: "the-mini-bar", name: "The Mini Bar", postcode: "2485", au_state: "NSW", status: "active", id: "v1", email: "x@y", join_code: "AAAAAA" },
  { slug: "test-alpha", name: "Test Alpha", postcode: "4000", au_state: "QLD", status: "active" },
  { slug: "test-bravo", name: "Test Bravo", postcode: "4000", au_state: "QLD", status: "active" },
  { slug: "tugun-bowls-club", name: "Tugun Bowls Club", postcode: "4224", au_state: "QLD", status: "active" },
  { slug: "the-bistro-tugun", name: "The Bistro, Tugun", postcode: "4224", au_state: "QLD", status: "active" },
  { slug: "paddys-tavern", name: "Paddy's Tavern", postcode: "4217", au_state: "QLD", status: "active" },
  { slug: "the-gone-hotel", name: "The Gone Hotel", postcode: "4000", au_state: "QLD", status: "cancelled" },
  { slug: "the-paused-pub", name: "The Paused Pub", postcode: "4000", au_state: "QLD", status: "suspended" },
  { slug: "royal-hotel-2000", name: "Royal Hotel", postcode: "2000", au_state: "NSW", status: "active" },
  { slug: "royal-hotel-3000", name: "Royal Hotel", postcode: "3000", au_state: "VIC", status: "active" },
  { slug: "royal-hotel-4000", name: "Royal Hotel", postcode: "4000", au_state: "QLD", status: "active" },
  { slug: "royal-hotel-5000", name: "Royal Hotel", postcode: "5000", au_state: "SA", status: "active" },
  { slug: "royal-hotel-6000", name: "Royal Hotel", postcode: "6000", au_state: "WA", status: "active" },
  { slug: "royal-hotel-7000", name: "Royal Hotel", postcode: "7000", au_state: "TAS", status: "active" },
  { slug: "aardvark-mini-golf", name: "Aardvark Mini Golf", postcode: "4000", au_state: "QLD", status: "active" },
  { slug: "the-royal-oak", name: "The Royal Oak", postcode: "4000", au_state: "QLD", status: "active" }
];
var calls = [], limited = false;
function sbGetAll(env, table, q) {
  calls.push(table + "?" + q);
  /* The real query asks for active rows; the fake hands back everything so the search's own
     status check is tested too (a database filter can be dropped by an edit). */
  return Promise.resolve(DB.slice());
}
function abuseIpHash() { return Promise.resolve("iphash"); }
function rateLimit(env, key, max, win) { calls.push("rl:" + key + ":" + max); return Promise.resolve({ ok: !limited }); }
function enc(s) { return encodeURIComponent(String(s)); }
function json(obj, status) { return { body: obj, status: status || 200 }; }

var SRC = (lim ? lim[0] : "") + "\n" + GAME.slice(a, c) + "\n  return 'SLUG-PATH';\n}\n";
var lift = new Function("sbGetAll", "abuseIpHash", "rateLimit", "enc", "URL",
  SRC + "\n;return { venueSearch: venueSearch, handleVenueLike: handleVenueLike, reset: function () { _findRows = null; } };");
var W = lift(sbGetAll, abuseIpHash, rateLimit, enc, MiniURL);

function names(typed) { return W.venueSearch(DB, typed).matches.map(function (m) { return m.name; }); }
function finds(typed, name) { return names(typed).indexOf(name) >= 0; }

print("DEAN'S EXAMPLES (LG simulator, 3 Nov)");
pass("'mini bar' finds The Mini Bar", finds("mini bar", "The Mini Bar"), names("mini bar").join(", "));
pass("'the mini' still finds The Mini Bar", finds("the mini", "The Mini Bar"));
pass("'minibar' (no space) finds The Mini Bar", finds("minibar", "The Mini Bar"));
pass("'testalph' (no space, part of a word) finds Test Alpha", finds("testalph", "Test Alpha"));
pass("'bistrotug' (no space, across the comma) finds The Bistro, Tugun", finds("bistrotug", "The Bistro, Tugun"));
pass("'MINI BAR' in capitals finds it", finds("MINI BAR", "The Mini Bar"));
pass("'  mini   bar.  ' with extra spaces and a full stop finds it", finds("  mini   bar.  ", "The Mini Bar"));
pass("'The Mini Bar' typed in full finds it, first", names("The Mini Bar")[0] === "The Mini Bar");
pass("'bar' (a word in the middle) finds it", finds("bar", "The Mini Bar"));
pass("'test alph' finds Test Alpha", finds("test alph", "Test Alpha"), names("test alph").join(", "));
pass("'test al' (partial words) finds Test Alpha", finds("test al", "Test Alpha"));
pass("'test al' does not offer Test Bravo", !finds("test al", "Test Bravo"));
pass("'tes' (three letters) finds Test Alpha", finds("tes", "Test Alpha"));
pass("'tugun' finds Tugun Bowls Club", finds("tugun", "Tugun Bowls Club"));
pass("'tugun' finds The Bistro, Tugun (a word at the end, after a comma)", finds("tugun", "The Bistro, Tugun"));
pass("'tugun bistro' (words in another order) finds The Bistro, Tugun", finds("tugun bistro", "The Bistro, Tugun"));
pass("'paddys' finds Paddy's Tavern (an apostrophe is not a space)", finds("paddys", "Paddy's Tavern"));
pass("'ini' (inside a word) finds nothing", names("ini").length === 0, names("ini").join(", "));

print("\nTHE SHORT-SEARCH RULE: THREE LETTERS");
var two = W.venueSearch(DB, "te");
pass("two letters asks for more and finds nothing", two.matches.length === 0 && /at least three letters/.test(two.why || ""), two.why);
var the = W.venueSearch(DB, "The ");
pass("'the' on its own asks for more", the.matches.length === 0 && /at least three/.test(the.why || ""));
pass("'the m' (one letter after 'the') asks for more", W.venueSearch(DB, "the m").matches.length === 0);
pass("'t a' (two letters across two words) asks for more", W.venueSearch(DB, "t a").matches.length === 0);

print("\nWHAT STOPS ANYONE LISTING EVERY VENUE");
pass("a cancelled venue is never offered", !finds("gone hotel", "The Gone Hotel"));
pass("a suspended venue is never offered", !finds("paused pub", "The Paused Pub"));
var roy = W.venueSearch(DB, "royal");
pass("at most five answers", roy.matches.length === 5, roy.matches.length);
pass("past five it says 'more', not how many", roy.more === true && !("count" in roy) && !("total" in roy));
pass("six Royal Hotels say 'more'; one Royal Oak does not", W.venueSearch(DB, "royal hotel").more === true && !W.venueSearch(DB, "royal oak").more);
var keys = Object.keys(W.venueSearch(DB, "mini bar").matches[0]).sort().join(",");
pass("only name, postcode, state and slug come back (no id, email, code or status)", keys === "name,postcode,slug,state", keys);
pass("the closest name comes first: 'royal oak' puts The Royal Oak first", names("royal oak")[0] === "The Royal Oak");

pass("'mini' puts The Mini Bar before Aardvark Mini Golf (a leading The does not count)", names("mini")[0] === "The Mini Bar", names("mini").join(", "));

print("\nTHE ROUTE, RUN");
function get(qs) {
  var req = { url: "https://game.venueplay.com.au/venues/like" + qs, headers: { get: function () { return null; } } };
  return W.handleVenueLike(req, {}, json);
}
var done = false;
calls = [];
get("?q=mini+bar").then(function (r) {
  pass("GET /venues/like?q=mini+bar answers The Mini Bar", r.status === 200 && r.body.matches.length === 1 && r.body.matches[0].slug === "the-mini-bar", JSON.stringify(r.body));
  pass("the database is asked for active venues only, paged (sbGetAll, ordered)", calls.some(function (x) { return /^vp_venues\?.*status=eq\.active.*order=/.test(x); }), calls.join(" | "));
  pass("and the per-network limit is counted", calls.some(function (x) { return /^rl:find:ip:iphash:/.test(x); }));
  calls = [];
  return get("?q=te");
}).then(function (r) {
  pass("?q=te (two letters) asks for more without asking the database or the limiter", r.body.matches.length === 0 && /three letters/.test(r.body.why) && calls.length === 0, calls.join(" | "));
  limited = true; calls = []; W.reset();
  return get("?q=test+alpha");
}).then(function (r) {
  pass("past the limit: 429, nothing found, the database not asked", r.status === 429 && r.body.matches.length === 0 && !calls.some(function (x) { return /^vp_venues/.test(x); }), JSON.stringify(r.body));
  limited = false;
  return get("?slug=test-alpha");
}).then(function (r) {
  pass("?slug= (the bingo TV's family lookup) still takes its own path", r === "SLUG-PATH");
  done = true;
}).catch(function (e) { pass("the route ran without throwing", false, String(e)); done = true; });

if (typeof drainMicrotasks === "function") drainMicrotasks();
if (!done) pass("the route finished", false);

/* The old six-letter rule and slug-prefix search stay only on ?slug=; ?q= is the apps'. */
pass("the slug family lookup is unchanged (exact slug or slug plus a dash)", GAME.indexOf("'or=(slug.eq.' + enc(typed) + ',slug.like.' + enc(typed + '-*') + ')'") > 0);

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " failed");
