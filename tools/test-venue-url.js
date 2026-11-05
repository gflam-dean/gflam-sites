/* EVERY SCREEN AND THE BINGO PHONE READ THE VENUE FROM THE ADDRESS ONE WAY: /app/vp-venueurl.js.
   27 Sep 2026: Dean opened /tv?=hello-hotel and the stray "=" read as no venue, so the TV showed
   the browser's remembered venue. tv.html was fixed and the same strict parser stayed in four
   game screens and play.html, where the cold-open bounce then wrote the REMEMBERED venue into the
   address as if it had been typed. Running tv.html's parser over 16 addresses found five more
   shapes it got wrong, and a stray "%" that threw and killed tv.html's whole main script.
   This RUNS the real vp-venueurl.js over every shape, then RUNS each page's own venue code (lifted
   from the page, with the real shared file behind it), and checks every page loads the script
   before it uses it and no longer carries a parser of its own.
   Run: jsc tools/test-venue-url.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var SRC = readFile("venueplay/app/vp-venueurl.js");
var warned = [];
function load(){
  var win = { location: { search: "" }, console: { warn: function(m){ warned.push(String(m)); } } };
  (new Function("window", SRC))(win);
  return win;
}
var W = load(), U = W.VPVenueURL || {};
function fb(s, m){ try { return U.fellBack(s, m); } catch (e) { return "THREW " + e; } }
ok("vp-venueurl.js defines VPVenueURL.slug", !!(U && typeof U.slug === "function"));

var SHAPES = [
  ["?venue=hello-hotel", "hello-hotel", "the long form"],
  ["?hello-hotel", "hello-hotel", "the short form in the welcome email"],
  ["?=hello-hotel", "hello-hotel", "a stray '=' (what Dean typed)"],
  ["?slug=hello-hotel", "hello-hotel", "?slug="],
  ["?venue=Hello-Hotel&probe=1", "hello-hotel", "capitals in the value and a second parameter"],
  ["?hello-hotel&probe=1", "hello-hotel", "short form with a second parameter"],
  ["?probe=1&venue=hello-hotel", "hello-hotel", "venue= that is not first"],
  ["?Venue=hello-hotel", "hello-hotel", "capital V in the key"],
  ["?SLUG=hello-hotel", "hello-hotel", "capitals in ?slug="],
  ["?unified=1&hello-hotel", "hello-hotel", "a bare venue after ?unified=1"],
  ["?roomserver=1&hello-hotel", "hello-hotel", "a bare venue after ?roomserver=1"],
  ["?unified&hello-hotel", "hello-hotel", "a bare venue after a bare setting"],
  ["?unified=1&=hello-hotel", "hello-hotel", "a stray '=' after a setting"],
  ["?venue=Hello Hotel", "hello-hotel", "a typed space"],
  ["?venue=Hello%20Hotel", "hello-hotel", "an encoded space"],
  ["?venue=Hello+Hotel", "hello-hotel", "a '+' space"],
  ["?hello_hotel", "hello-hotel", "an underscore"],
  ["?venue=hello-hotel%", "hello-hotel", "a stray '%' does not throw"],
  ["?hello-hotel%", "hello-hotel", "a stray '%' on the short form"],
  ["?venue=%E0%A4%A", "e0a4a", "a broken escape falls back to the raw text instead of throwing"],
  ["?venue=&hello-hotel", "hello-hotel", "an empty venue= falls through to the bare part"],
  ["?=Hello%20Hotel", "hello-hotel", "a stray '=' and an encoded space"],
  ["hello-hotel", "hello-hotel", "a search with no leading '?'"],
  ["?the-grand-hotel-4210", "the-grand-hotel-4210", "a postcode slug"],
  ["", "", "control: nothing in the address"],
  ["?", "", "control: a bare '?'"],
  ["?demo=1", "", "control: ?demo=1 is not a venue"],
  ["?probe=1", "", "control: ?probe=1 alone is not a venue"],
  ["?unified=1", "", "control: ?unified=1 alone is not a venue"],
  ["?roomserver=1&probe=1", "", "control: two settings are not a venue"],
  ["?room=ABC234", "", "control: ?room= on the phone is not a venue"],
  ["?demo", "", "control: a bare known setting is not a venue"],
  ["?t&v=123", "", "control: bare 't' and v= are settings"],
  ["?%", "", "control: a lone '%' is no venue and does not throw"]
];
SHAPES.forEach(function(t){
  var got; try { got = U.slug(t[0]); } catch (e) { got = "THREW " + e; }
  ok("slug: " + t[2] + ": " + (t[0] || "(nothing)") + " -> " + (t[1] || "(none)"), got === t[1], got);
});

// unread(): the address held something that is neither a venue nor a known setting
[["?%", true], ["?venue=", true], ["?=", true], ["?hello-hotel%%%%&&", false],
 ["?probe=1", false], ["?unified=1", false], ["", false], ["?=hello-hotel", false], ["?demo=1", false]
].forEach(function(t){
  var got; try { got = U.unread(t[0]); } catch (e) { got = "THREW " + e; }
  ok("unread(" + (t[0] || "(nothing)") + ") is " + t[1], got === t[1], got);
});
warned = [];
ok("fellBack warns for an unreadable address", fb("?venue=", "test-alpha") === true && warned.length === 1 && warned[0].indexOf("test-alpha") >= 0, warned.join(" | "));
warned = [];
ok("fellBack stays quiet for ?probe=1", fb("?probe=1", "test-alpha") === false && warned.length === 0, warned.join(" | "));

// ---- every page: loads the script before it uses it, and has no parser of its own ----
var PAGES = ["venueplay/tv.html", "venueplay/play.html", "venueplay/app/trivia/screen.html",
             "venueplay/app/musical/screen.html", "venueplay/app/raffle/screen.html",
             "venueplay/app/members/screen.html"];
function strip(s){ return s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1"); }
var TEXT = {};
PAGES.forEach(function(p){
  var raw = readFile(p), body = strip(raw); TEXT[p] = raw;
  var tag = body.search(/<script[^>]*\ssrc=["']\/app\/vp-venueurl\.js["'][^>]*>\s*<\/script>/);
  var use = body.indexOf("VPVenueURL.slug(");
  ok(p + " loads /app/vp-venueurl.js in a real script tag", tag >= 0);
  ok(p + " calls VPVenueURL.slug after that tag", use > tag && tag >= 0, "tag@" + tag + " use@" + use);
  var own = /venue=\(\[\^&\]\+\)|\(\?:venue\|slug\)=|decodeURIComponent\(raw\)|split\("&"\)\[0\]/.exec(body);
  ok(p + " has no venue parser of its own", !own, own && own[0]);
});

// ---- RUN each page's real venue code with the real shared file behind it ----
function lift(src, from, to){ var i = src.indexOf(from), j = src.indexOf(to, i); return (i >= 0 && j > i) ? src.slice(i, j) : ""; }
function store(v){ var m = { vpTvVenue: v }; return { getItem: function(k){ return m.hasOwnProperty(k) ? m[k] : null; }, setItem: function(k, x){ m[k] = String(x); }, removeItem: function(k){ delete m[k]; }, _m: m }; }
var MEM = "test-alpha";
var RUNS = [
  ["?=hello-hotel", "hello-hotel", false, "/tv?venue=hello-hotel"],
  ["?unified=1&hello-hotel", "hello-hotel", false, "/tv?venue=hello-hotel"],
  ["?Venue=Hello%20Hotel", "hello-hotel", false, "/tv?venue=hello-hotel"],
  ["?venue=hello-hotel%", "hello-hotel", false, "/tv?venue=hello-hotel"],
  ["?venue=", MEM, true, "/tv?venue="],
  ["", MEM, false, "/tv?venue=" + MEM]
];
["trivia", "musical", "raffle", "members"].forEach(function(g){
  var p = "venueplay/app/" + g + "/screen.html";
  var body = lift(TEXT[p], "  var VP_DEMO =", "  var CODE=(function(){");
  ok(p + ": venue code lifted", !!body);
  RUNS.forEach(function(r){
    warned = [];
    var win = load(), replaced = null;
    win.location = { search: r[0], replace: function(u){ replaced = u; } };
    var got;
    try {
      got = (new Function("window", "VPVenueURL", "localStorage", "sessionStorage", "console",
        "var out = {}; (function(){ try { " + body + " } finally { out.slug = VENUE_SLUG; out.unread = VENUE_UNREAD; } })(); return out;"))
        (win, win.VPVenueURL, store(MEM), store(""), win.console);
    } catch (e) { got = { slug: "THREW " + e }; }
    ok(g + " screen " + (r[0] || "(nothing)") + " shows " + r[1] + " and bounces to " + r[3],
       got.slug === r[1] && !!got.unread === r[2] && replaced === r[3] && (r[2] ? warned.length === 1 : warned.length === 0),
       JSON.stringify(got) + " bounce=" + replaced + " warned=" + warned.length);
  });
});

// tv.html: its real venue code, with memory behind it
var tvBody = lift(TEXT["venueplay/tv.html"], "  function tvVenueSlug(){", "  // ---- stable code");
ok("tv.html: venue code lifted", !!tvBody);
RUNS.forEach(function(r){
  warned = [];
  var win = load(); win.location = { search: r[0] };
  var got;
  try { got = (new Function("window", "VPVenueURL", "localStorage", "console", tvBody + "; return VENUE_SLUG;"))(win, win.VPVenueURL, store(MEM), win.console); }
  catch (e) { got = "THREW " + e; }
  /* BARE /tv NEVER SHOWS THE REMEMBERED VENUE (live fault, 1 Nov 2026), and since 2 Nov 2026 does not even offer
     it ("Show it again" is gone; a venue keys its screen code in again). Where the game screens fall back to
     memory, tv.html reads NO venue and never reads the memory, so it has nothing to warn about either. */
  var want = r[1] === MEM ? "" : r[1];
  ok("tv.html " + (r[0] || "(nothing)") + " shows " + (want || "the setup screen") + ", never the remembered " + MEM,
     got === want && got !== MEM && warned.length === 0, got + " warned=" + warned.length);
});

// play.html: the bingo phone's venue link
var playFn = lift(TEXT["venueplay/play.html"], "  function venueSlugFromURL(){", "  function venueCode(slug){");
ok("play.html: venueSlugFromURL lifted", !!playFn);
var playWrong = [];
SHAPES.forEach(function(t){
  var win = load(); win.location = { search: t[0] };
  var got; try { got = (new Function("window", "VPVenueURL", playFn + "; return venueSlugFromURL();"))(win, win.VPVenueURL); } catch (e) { got = "THREW " + e; }
  if (got !== t[1]) playWrong.push((t[0] || "(nothing)") + " -> " + got);
});
ok("play.html reads all " + SHAPES.length + " address shapes right", playFn && !playWrong.length, playWrong.join(", "));

// ---- /app/vp-tvpaired.js: the venue THIS SCREEN was paired to by its own screen code (5 Nov 2026) ----
/* Two keys on purpose: vpTvVenue is any /tv?venue= visit (Dean, 1 Nov 2026: the prospect's slides, "a random
   person"), vpTvPaired only a code typed on this screen (Dean, 5 Nov 2026: "I don't want them to ask for the
   code again on the TV, no way"). This RUNS the real file, with the real vp-venueurl.js and vp-tvtype.js. */
var PSRC = readFile("venueplay/app/vp-tvpaired.js"), TSRC = readFile("venueplay/app/vp-tvtype.js");
function paired(mem){
  var win = load(); win.localStorage = store(""); delete win.localStorage._m.vpTvVenue;
  if (mem) for (var k in mem) win.localStorage._m[k] = mem[k];
  win.sessionStorage = store(""); delete win.sessionStorage._m.vpTvVenue;
  win.setTimeout = function(){ return 0; }; win.clearTimeout = function(){};
  (new Function("window", TSRC))(win); (new Function("window", PSRC))(win);
  return win;
}
var P0 = paired().VPTvPaired;
ok("vp-tvpaired.js defines VPTvPaired with save, slug, clear, forget, target, go", !!P0 && ["save","slug","clear","forget","target","go","openedPaired","appStore"].every(function(f){ return typeof P0[f] === "function"; }));
(function(){
  var w = paired(), P = w.VPTvPaired;
  ok("nothing paired: slug() is empty", P.slug() === "");
  ok("save() writes vpTvPaired as {slug, at}", P.save("Test-Alpha") === true && JSON.parse(w.localStorage._m.vpTvPaired).slug === "test-alpha" && JSON.parse(w.localStorage._m.vpTvPaired).at > 0, w.localStorage._m.vpTvPaired);
  ok("and slug() reads it back", P.slug() === "test-alpha");
  ok("save() never touches vpTvVenue", !("vpTvVenue" in w.localStorage._m));
  P.forget("some-other-venue");
  ok("forget(another venue) keeps the pairing (a mistyped /tv?venue= must not unpair the real venue)", P.slug() === "test-alpha");
  P.forget("test-alpha");
  ok("forget(the paired venue) clears it (two strikes: it no longer exists)", P.slug() === "" && !("vpTvPaired" in w.localStorage._m));
  P.save("test-alpha"); P.clear();
  ok("clear() (Change venue) clears it", P.slug() === "");
})();
[["junk", "not json"], ["a bare slug, the old shape", "test-alpha"], ["no slug", '{"at":1}'], ["a slug that is not one", '{"slug":"<script>","at":1}']].forEach(function(t){
  var P = paired({ vpTvPaired: t[1] }).VPTvPaired;
  ok("vpTvPaired holding " + t[0] + " reads as not paired", P.slug() === "", P.slug());
});
ok("vpTvVenue alone is never read as paired (the 1 Nov fault)", paired({ vpTvVenue: "indypendent-hotel" }).VPTvPaired.slug() === "");
var PT = [
  ["", "/tv?venue=test-alpha", "bare /tv opens the paired venue"],
  ["?intro=0", "/tv?venue=test-alpha&intro=0", "bare /tv keeps its other settings"],
  ["?demo=1", "", "?demo=1 stays hermetic"],
  ["?demo=1&ads=1", "", "the ads-only demo stays hermetic"],
  ["?probe=1", "", "a probe is not a screen"],
  ["?venue=other-venue", "", "an address that names a venue keeps it"],
  ["?other-venue", "", "the short form keeps it too"],
  ["?venue=", "", "an unreadable address is not overridden"],
  ["?fbclid=abc", "/tv?venue=test-alpha&fbclid=abc", "a tracking tag does not stop it"]
];
PT.forEach(function(t){
  var w = paired({ vpTvPaired: '{"slug":"test-alpha","at":1}' }), got;
  try { got = w.VPTvPaired.target(t[0], "/tv", ""); } catch (e) { got = "THREW " + e; }
  ok("target: " + t[2] + ": " + (t[0] || "(nothing)") + " -> " + (t[1] || "stay"), got === t[1], got);
});
(function(){
  var w = paired({ vpTvVenue: "other-venue" }), got = "x";
  try { got = w.VPTvPaired.target("", "/tv", ""); } catch (e) { got = "THREW " + e; }
  ok("target: never paired, another venue remembered: bare /tv stays the setup card", got === "", got);
  var w2 = paired({ vpTvPaired: '{"slug":"test-alpha","at":1}' }), went = null;
  w2.document = { documentElement: { style: {} } };
  var r = w2.VPTvPaired.go({ search: "", pathname: "/tv", hash: "", replace: function(u){ went = u; } });
  ok("go(): bare /tv moves on to the paired venue's address", r === true && went === "/tv?venue=test-alpha", went);
  ok("go(): and marks this tab's next venue screen as opened from bare /tv", w2.VPTvPaired.openedPaired("test-alpha") === true);
  ok("openedPaired() is read once (a reload is an ordinary open)", w2.VPTvPaired.openedPaired("test-alpha") === false);
  w2.VPTvPaired.go({ search: "", pathname: "/tv", hash: "", replace: function(){} });
  ok("openedPaired() is for THAT venue only", w2.VPTvPaired.openedPaired("other-venue") === false);
  var w3 = paired({ vpTvPaired: '{"slug":"test-alpha","at":1}' }), went3 = null;
  w3.VPTvPaired.go({ search: "?demo=1", pathname: "/tv", hash: "", replace: function(u){ went3 = u; } });
  ok("go(): a demo is never moved and never marked", went3 === null && w3.VPTvPaired.openedPaired("test-alpha") === false, went3);
})();
// "Get the app": only the store this TV's own setup line names, and only with a live address (Dean, 5 Nov 2026)
[["googletv", "play"], ["chromecast", "play"], ["samsung", ""], ["lg", ""], ["firetv", ""], ["pc", ""], ["mobile", ""], ["unknown", ""], ["app", ""]].forEach(function(t){
  var got; try { got = P0.appStore(t[0]); } catch (e) { got = "THREW " + e; }
  ok("get the app: a " + t[0] + " browser " + (t[1] ? "is offered " + t[1] : "is offered nothing"), got === t[1], got);
});
(function(){
  var w = paired(); w.VPTvType.STORES.samsung.url = "https://example.invalid/samsung";
  ok("get the app: a Samsung TV is offered Samsung Apps the day its address is in STORES", w.VPTvPaired.appStore("samsung") === "samsung", w.VPTvPaired.appStore("samsung"));
})();

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
