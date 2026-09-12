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
/* It must RETURN before the venue fetch. Everything below that point in loadVenueScreen reads
   a real venue: its slides, its logo, its poll. The check is that the return is inside the demo
   block and before any of it, not the exact shape of the line, which has already changed once. */
var demoEnd = TV.indexOf("return;", demoAt);
var venueFetchAt = TV.indexOf("var hdr={ apikey:SUPA_ANON", demoAt);
pass("the demo returns before any venue fetch, so no logo or ads are pulled",
     demoEnd > 0 && venueFetchAt > 0 && demoEnd < venueFetchAt,
     "everything past that return in loadVenueScreen reads a real venue");
pass("the invented name is not a real venue of ours",
     TV.indexOf("Rose and Crown") > 0 && !/setVenueName\("(Wellshot|Tugun|The Jolly Jess|Test Alpha)/.test(TV));

/* 4b. THE PUB HAS SOMETHING TO ADVERTISE. The screen earns its keep between games, and a demo
       that only ever shows a game leaves that out. Worse, with no slides at all loopEntries()
       falls through to the holding slide, whose own words are "Screen not showing your promos
       or game? Email hello@venueplay.com.au" - a message written to tell a VENUE their screen
       is broken. A prospect was being shown a troubleshooting line. Found by Dean asking
       "that invented pub has all the advertising etc needed for all those nights?" */
/* ANCHORED ON THE RIGHT BLOCK. There are two `if(DEMO){` in this page: the scripted night, and
   the one inside loadVenueScreen that dresses the invented pub. Taking the first match tested
   the wrong one and reported "0 slides" about a block that was never going to have any. */
var demoAt = TV.indexOf('setVenueName("The Rose and Crown")');
var demoBlock = TV.slice(TV.lastIndexOf("if(DEMO){", demoAt), demoAt + 2600);
var slideCount = (demoBlock.match(/head:"/g) || []).length;
pass("the demo pub runs a rotation, not a single slide", slideCount >= 3, slideCount + " slides");
pass("it has the weekly draws board", /ADS\.draws\s*=\s*\[/.test(demoBlock) && /jackpot:/.test(demoBlock));
pass("and a raffle, so both auto slides are on a sales page at all",
     /ADS\.raffle\s*=\s*\{/.test(demoBlock));
pass("the ads are actually built and started, not just assigned",
     /buildAds\(true\)/.test(demoBlock) && /startAds\(\)/.test(demoBlock),
     "ADS is read by buildAds; setting it alone paints nothing");
/* THE SLIDES MUST NEVER EXPIRE. slideVisible() drops a slide outside its starts/ends window, so
   a dated demo slide would quietly vanish on a particular day and the loop could empty itself
   back to the holding slide. Nothing would go red; the sales page would just get worse. */
pass("no demo slide carries a date that could expire it",
     !/(starts|ends):/.test(demoBlock),
     "a dated slide disappears on its own one day and nothing says so");
pass("the demo never shows the broken-screen holding slide",
     slideCount >= 3, "with slides present loopEntries() cannot fall through to it");
/* And it is still hermetic: the ads are literals in the page, not a fetch. */
pass("the ad content is invented in the page, not fetched from a venue",
     demoBlock.indexOf("fetch(") < 0,
     "a demo that fetches is a demo that can show somebody's real promos");

/* 5. AND THE JOIN CORNER STAYS DOWN. A prospect scanning a demo QR would be told "no room" by
      the very product being sold to them. */
pass("the demo hides the join corner and keeps it hidden",
     /tvJoinCorner/.test(TV) && /MutationObserver/.test(TV.slice(TV.indexOf("function hideJoin"), TV.indexOf("function hideJoin") + 600)));

/* 6. A DEMONSTRATION IS WATCHED, NOT HEARD.

   Dean, 12 Sep 2026: "Maybe get rid of the sound on the demo". The win fanfare is written for
   a pub PA at the moment somebody shouts bingo. On /see-a-night it came out of a visitor's
   laptop, unasked, about once a minute for as long as the tab was open, and because the modal
   opens on a click the browser's autoplay rule did not stop it.

   RUN, not grepped. Load the real vp-celebrate.js with a fake AudioContext and count the
   oscillators it creates. A check that greps for the word "demo" would pass on a guard that
   was spelled wrong or placed after the noise. */
var CEL = find('venueplay/app/vp-celebrate.js');

function loadCelebrate(demoFlag) {
  var made = 0;
  function node() {
    return { type:"", frequency:{value:0}, gain:{ value:0, setValueAtTime:function(){}, exponentialRampToValueAtTime:function(){}, linearRampToValueAtTime:function(){} },
             connect:function(){}, start:function(){}, stop:function(){}, threshold:{value:0}, knee:{value:0},
             ratio:{value:0}, attack:{value:0}, release:{value:0} };
  }
  var ctx = { currentTime:0, state:"running", resume:function(){}, destination:{},
              createOscillator:function(){ made++; return node(); },
              createGain:node, createDynamicsCompressor:node };
  var root = {
    AudioContext: function(){ return ctx; },
    document: { documentElement: { getAttribute: function(k){ return k === "data-vp-demo" ? (demoFlag ? "1" : null) : null; } } }
  };
  (new Function("root", "window", "self", CEL + "\nreturn root.VPCelebrate;"))(root, root, root);
  return { api: root.VPCelebrate, oscillators: function(){ return made; }, ctx: ctx };
}

var normal = loadCelebrate(false);
pass("the celebrate library still loads and exposes fanfare", !!(normal.api && normal.api.fanfare));
normal.api.fanfare({ profile:"pa", ctx:normal.ctx });
pass("a REAL win still makes a noise, which is the point of it",
     normal.oscillators() > 0, normal.oscillators() + " oscillator(s)");

var demo = loadCelebrate(true);
demo.api.fanfare({ profile:"pa", ctx:demo.ctx });
demo.api.fanfare({ profile:"phone", ctx:demo.ctx });
pass("a demo makes none, on the venue PA profile or the phone one",
     demo.oscillators() === 0, demo.oscillators() + " oscillator(s) on a demo page");

/* ONLY THE SOUND. The confetti is the part worth watching and wakes nobody up. */
pass("the confetti still fires on a demo", typeof demo.api.burst === "function" &&
     CEL.indexOf("isDemoPage") < CEL.indexOf("function burst"),
     "the guard is on fanfare, not on burst");
var burstFn = CEL.slice(CEL.indexOf("function burst"));
pass("and burst carries no demo guard of its own", burstFn.indexOf("isDemoPage") < 0);

/* THE GUARD IS FIRST. Placed after the context is built it would still be silent, but placed
   after the oscillators start it would not, and both read the same in a diff. */
var ff = CEL.slice(CEL.indexOf("function fanfare"), CEL.indexOf("function fanfare") + 200);
pass("and it is the first thing fanfare does", /function fanfare\([^)]*\)\s*\{\s*if \(isDemoPage\(\)\) return;/.test(ff));

/* AND THE HOST CONSOLE'S OWN CHIME, which does not go through this library at all, so the
   guard above cannot cover it. It is the console's own oscillator plus a vibrate. */
var APP = find('venueplay/app/index.html');
var chime = APP.slice(APP.indexOf("function claimChime"), APP.indexOf("function claimChime") + 900);
pass("the host console's claim chime is silent in a demo too",
     /data-vp-demo/.test(chime) && chime.indexOf("data-vp-demo") < chime.indexOf("createOscillator"),
     "it has its own oscillator; vp-celebrate's guard does not reach it");
pass("and it does not buzz a phone either",
     chime.indexOf("data-vp-demo") < chime.indexOf("navigator.vibrate"),
     "a website that vibrates somebody's phone is worse than one that beeps");

/* NOR DOES IT BUZZ. A vibration is a noise to somebody reading a website, and a worse one
   than a beep because it cannot be muted. The first pass silenced the fanfare and missed three
   navigator.vibrate calls in play.html, one of which is not even a win: it fires on an ordinary
   transition, so a visitor holding their phone would have felt it over and over. So: NO page
   may call navigator.vibrate directly. It goes through a helper that asks the flag first. */
["venueplay/play.html", "venueplay/app/index.html", "venueplay/tv.html"].forEach(function (rel) {
  var src = find(rel);
  var name = rel.split("/").pop();
  var direct = (src.match(/navigator\.vibrate\s*\(/g) || []).length;
  var guarded = (src.match(/data-vp-demo[\s\S]{0,400}?navigator\.vibrate\s*\(/g) || []).length;
  pass(name + " buzzes only from behind the demo guard", direct === guarded,
       direct + " call(s), " + guarded + " behind a guard");
});
var PLAY = find('venueplay/play.html');
pass("play.html asks the question once, not at each call site",
     (PLAY.match(/function buzz\(/g) || []).length === 1 &&
     (PLAY.match(/navigator\.vibrate\s*\(/g) || []).length === 1,
     "three call sites was three chances to miss one");
var buzzFn = PLAY.slice(PLAY.indexOf("function buzz("), PLAY.indexOf("function buzz(") + 320);
pass("and the guard is before the buzz, not after it",
     buzzFn.indexOf("data-vp-demo") < buzzFn.indexOf("navigator.vibrate"));

/* EVERY DEMO PAGE STAMPS THE FLAG the guards read. A page that forgot would be loud again. */
["venueplay/tv.html", "venueplay/play.html", "venueplay/app/index.html"].forEach(function (rel) {
  var src = find(rel);
  pass(rel.split("/").pop() + " stamps data-vp-demo when it is demonstrating",
       /setAttribute\("data-vp-demo"\s*,\s*"1"\)/.test(src));
});

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
