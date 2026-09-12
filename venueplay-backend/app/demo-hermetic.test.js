/* A DEMO MUST NOT BORROW A REAL VENUE.

   /tv?demo=1, /play?demo=1 and /app/?demo=1 are what the sales pages show a prospect. The TV
   demo's own comment promises "no advertising or logo is ever fetched" and "no join code a
   stranger could use, which is the whole reason this is not simply pointed at a live demo
   venue". On 12 Sep 2026 I opened it on Dean's laptop and the wall said TEST ALPHA, with that
   venue's real derived join code beside it, because VENUE_SLUG falls back to
   localStorage.vpTvVenue and the demo never told it not to.

   A comment is a claim. This is the check.

   Run: jsc venueplay-backend/app/demo-hermetic.test.js */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var TV = find('venueplay/tv.html');

/* 1. THE RESOLVER ITSELF, RUN. Lift the VENUE_SLUG expression and give it the two worlds it
      has to tell apart: a browser that remembers a venue, and one that does not. */
function liftSlugResolver(src) {
  var i = src.indexOf("var VENUE_SLUG=(function(){");
  if (i < 0) throw new Error("tv.html no longer resolves VENUE_SLUG the same way");
  var j = src.indexOf("})();", i);
  return src.slice(i, j + 5);
}
var resolver = liftSlugResolver(TV);

function resolveWith(demo, remembered, urlSlug) {
  var VP_DEMO = demo;
  var remembers = null;
  var localStorage = {
    getItem: function (k) { return k === "vpTvVenue" ? remembered : null; },
    setItem: function (k, v) { if (k === "vpTvVenue") remembers = v; }
  };
  function tvVenueSlug() { return urlSlug || ""; }
  function rememberVenue(s) { if (s) localStorage.setItem("vpTvVenue", s); }
  var VENUE_SLUG;
  eval(resolver);
  return { slug: VENUE_SLUG, wrote: remembers };
}

pass("a browser with a remembered venue runs THAT venue normally",
     resolveWith(false, "wellshot-hotel", null).slug === "wellshot-hotel");
pass("a demo on that same browser borrows nothing, which is the live fault",
     resolveWith(true, "wellshot-hotel", null).slug === "",
     "it used to come back with the remembered slug, and the wall showed that pub's name");
pass("a demo ignores even an explicit venue in the URL",
     resolveWith(true, null, "wellshot-hotel").slug === "",
     "/tv?venue=x&demo=1 must still be a demo, not that venue");
pass("and a demo never writes a venue into the browser either",
     resolveWith(true, null, "wellshot-hotel").wrote === null);
pass("a normal screen with a venue in the URL still remembers it",
     resolveWith(false, null, "wellshot-hotel").wrote === "wellshot-hotel");
pass("a fresh browser with no venue anywhere resolves to nothing",
     resolveWith(false, null, null).slug === "");

/* 2. THE CODE ON THE WALL. With no slug the page invents a random code, which is correct for a
      paired screen and wrong for a demo: the demo script sends its own. What must never happen
      is a code DERIVED from a real venue, because that one is scannable. */
var codeBlock = TV.slice(TV.indexOf("var CODE=(function(){"), TV.indexOf("var CODE=(function(){") + 420);
pass("the join code is only derived from a venue when there IS one",
     /if\(VENUE_SLUG\) return venueCode\(VENUE_SLUG\)/.test(codeBlock),
     "and a demo now has none, so it cannot reach that line");

/* 3. THE ORDER MATTERS. VP_DEMO is read inside the VENUE_SLUG resolver, so it has to be
      decided before it. Declared after, it is undefined at that point and the guard is dead. */
pass("the demo flag is decided BEFORE the venue is resolved",
     TV.indexOf("var VP_DEMO") < TV.indexOf("var VENUE_SLUG=(function(){"),
     "declared after, the guard reads undefined and does nothing");
pass("and there is only one place that decides it",
     (TV.match(/=\s*\/\[\?&\]demo=1\/\.test/g) || []).length === 1,
     "two copies of the test is two answers to one question");

/* 4. THE NAME IN THE CORNER is set where setVenueName actually lives. Called from the demo
      block it is a ReferenceError swallowed by a try/catch: a line that looks like it works. */
var lvs = TV.slice(TV.indexOf("(function loadVenueScreen(){"));
lvs = lvs.slice(0, 1200);
pass("a demo puts an invented pub on the wall", /setVenueName\("The Rose and Crown"\)/.test(lvs));
pass("and it is set inside loadVenueScreen, where that function is in scope",
     TV.indexOf('setVenueName("The Rose and Crown")') > TV.indexOf("(function loadVenueScreen(){"));
pass("the demo returns before any venue fetch, so no logo or ads are pulled",
     /if\(DEMO\)\{ setVenueName\("The Rose and Crown"\); return; \}/.test(TV));
pass("the invented name is not a real venue of ours",
     TV.indexOf("Rose and Crown") > 0 && !/setVenueName\("(Wellshot|Tugun|The Jolly Jess|Test Alpha)/.test(TV));

/* 5. AND THE JOIN CORNER STAYS DOWN. A prospect scanning a demo QR would be told "no room" by
      the very product being sold to them. */
pass("the demo hides the join corner and keeps it hidden",
     /tvJoinCorner/.test(TV) && /MutationObserver/.test(TV.slice(TV.indexOf("function hideJoin"), TV.indexOf("function hideJoin") + 600)));

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
