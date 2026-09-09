/* THE VENUE'S LOGO DOES NOT SIT ON AN ADVERTISING SLIDE.

   An ad slide is the venue's own paid artwork, sold to a local business, and our
   corner logo drew straight over the top of it. The VenuePlay wordmark already
   came off for the ads (enterAds hides #tvCorner) but the venue logo is a fixed
   element on the body, so it stayed on the wall over every slide.
   Reported by Dean running a real bingo night, 10 Sep 2026.

   The other half of it: the small venue-name caption hides whenever the venue HAS
   a logo, not whenever the logo happens to be on screen. Otherwise taking the logo
   off for the ads would bring the caption back on the ad slides, which is the same
   fault wearing a different hat.

   The real functions are lifted out of tv.html and run against a stubbed DOM,
   rather than restated here: a copy keeps passing while the page changes.

   Run: jsc venueplay/app/tv-logo.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
var CANDIDATES = ["venueplay/tv.html", "../tv.html", "tv.html"];
var html = null;
for (var i = 0; i < CANDIDATES.length; i++) {
  try { var t = readFile(CANDIDATES[i]); if (t && t.length > 10000) { html = t; break; } } catch (e) {}
}
if (html === null) { print("FAIL could not find tv.html"); throw new Error("no source"); }

function grab(name){
  var i = html.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
var fnApply = grab("applyVenueLogo"), fnSetLogo = grab("setVenueLogo"), fnSetName = grab("setVenueName");
ok("applyVenueLogo is still in tv.html", !!fnApply);
ok("setVenueLogo is still in tv.html", !!fnSetLogo);
ok("setVenueName is still in tv.html", !!fnSetName);
if (!fnApply || !fnSetLogo || !fnSetName) throw new Error("missing functions");

/* Every mode switch must tell the logo what the wall is showing, or the logo is
   simply whatever the last one left behind. */
["enterAds", "enterBingo", "enterEmbed", "enterHolding"].forEach(function(name){
  var body = grab(name);
  ok(name + " tells the logo which state the wall is in",
     !!body && body.indexOf("applyVenueLogo(") >= 0,
     "no applyVenueLogo() call: the logo would keep whatever the last mode left");
});

/* A DOM small enough to run these and nothing more. */
var made = {};
function el(){ return { id:"", src:"", style:{ cssText:"", display:"" }, textContent:"",
                        getAttribute:function(){ return this.src || null; } }; }
var document = {
  getElementById: function(id){ return made[id] || null; },
  createElement: function(){ return el(); },
  body: { appendChild: function(n){ made[n.id] = n; } }
};
made.venueNameTag = el();
made.tvCorner = el();
made.lobbyAt = el();
made.lobbyAtName = el();
function $(id){ return made[id] || (made[id] = el()); }

var tvMode = "ads";
var venueLogoUrl = "";
eval(fnApply); eval(fnSetLogo); eval(fnSetName);

function logoShown(){ var l = made.venueLogo; return !!l && l.style.display === "block"; }
function captionShown(){ return made.venueNameTag.style.display === "block"; }

print("== a venue with a logo ==");
tvMode = "bingo";
setVenueLogo("https://example.test/mini-bar.png");
setVenueName("The Mini Bar");
ok("the logo is on the wall during a game", logoShown());
ok("the caption stays off while the logo is up", !captionShown());

tvMode = "ads"; applyVenueLogo();
ok("the logo comes off the advertising slides", !logoShown(),
   "an ad slide is the venue's own paid artwork; our logo does not belong on it");
ok("and the caption does NOT come back on an ad slide", !captionShown(),
   "swapping one overlay for another is the same fault in a different hat");

tvMode = "bingo"; applyVenueLogo();
ok("the logo is back the moment a game starts", logoShown());

tvMode = "embed"; applyVenueLogo();
ok("the logo is on for an embedded game screen too", logoShown());

/* The order the page actually calls these in: the screen loads, the logo is set,
   then the name. The name must not undo the logo's decision. */
made = { venueNameTag: el(), tvCorner: el(), lobbyAt: el(), lobbyAtName: el() };
venueLogoUrl = ""; tvMode = "ads";
setVenueLogo("https://example.test/mini-bar.png");
setVenueName("The Mini Bar");
ok("loading the screen while the ads are up leaves nothing over the slide",
   !logoShown() && !captionShown(),
   "loadScreen sets the logo then the name, and both must respect the ads state");

print("== a venue with no logo ==");
made = { venueNameTag: el(), tvCorner: el(), lobbyAt: el(), lobbyAtName: el() };
venueLogoUrl = ""; tvMode = "ads";
setVenueLogo("");
setVenueName("The Average Joe");
ok("the caption names the venue when there is no logo", captionShown(),
   "a TV pointed at the wrong venue is otherwise only noticeable by its sound");
tvMode = "bingo"; applyVenueLogo();
ok("no logo means nothing to show in a game either", !logoShown());
ok("and the caption is still there", captionShown());

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
