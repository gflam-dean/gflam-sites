/* THE PERSONAL TV-SLIDE PAGE, venueplay.com.au/look/<code> (build job 7, 5 Nov 2026).
   RUNS the page's own logic block and its render block (venueplay/look.html) against vp-offer.js and a fake
   browser: a venue whose website photos were poor never has its slides shown, an ended offer is never
   quoted or rolled on, a bad code is never fetched, and the venue's name only ever goes in as text.
   Run: jsc venueplay-backend/app/look-page.test.js (from the repo root) */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var PAGE = readFile("venueplay/look.html");
var OFFER_JS = readFile("venueplay/app/vp-offer.js");
function scriptContaining(marker){
  var re = /<script>([\s\S]*?)<\/script>/g, m;
  while ((m = re.exec(PAGE))) if (m[1].indexOf(marker) >= 0) return m[1];
  return null;
}
var LOGIC = scriptContaining("LOOK PAGE LOGIC"), RENDER = scriptContaining("LOOK PAGE RENDER");
ok("the logic block is on the page", !!LOGIC);
ok("the render block is on the page", !!RENDER);
var W = {};
(new Function("window", OFFER_JS))(W);
(new Function("window", LOGIC))(W);
var L = W.VPLook, OFFERS = W.VPOffer.OFFERS;
ok("the page loads vp-offer.js before its logic", PAGE.indexOf('<script src="/app/vp-offer.js"></script>') > 0 &&
   PAGE.indexOf('<script src="/app/vp-offer.js"></script>') < PAGE.indexOf("LOOK PAGE LOGIC"));

// Fixed clocks, never today's (CLAUDE.md): 15 Dec 2026 and 3 Jan 2027, Brisbane noon.
var DEC15 = Date.UTC(2026, 11, 15, 2, 0, 0), JAN3 = Date.UTC(2027, 0, 3, 2, 0, 0), NOV30_LATE = Date.UTC(2026, 10, 30, 13, 59, 0);
var CODE = "Ab3dEf6hIj9kLm2nOp5qRs";   // 22 characters, the shape look-publish.py makes

// ---- the code
ok("a 22-character URL-safe code is read from /look/<code>", L.codeFrom("/look/" + CODE, "") === CODE);
ok("...and with a trailing slash", L.codeFrom("/look/" + CODE + "/", "") === CODE);
ok("...and from ?c= on a plain file server", L.codeFrom("/look.html", "?c=" + CODE) === CODE);
ok("a short guess is refused, never fetched", L.codeFrom("/look/abc123", "") === null);
ok("a code with a dot or a slash is refused (no path tricks)", L.codeFrom("/look/" + CODE + "/../x", "") === null &&
   L.codeFrom("/look/..%2F" + CODE, "") === null && L.codeFrom("/look.html", "?c=" + CODE.slice(0, 20) + "..") === null);
ok("plain /look has no code", L.codeFrom("/look", "") === null);

// ---- poor photos
function sl(n, photos, social){
  var a = [];
  for (var i = 0; i < n; i++) a.push({ file: (i < 9 ? "0" : "") + (i + 1) + ".jpg", head: "Slide " + (i + 1), photo: i < photos, social: false });
  if (social) a.push({ file: (n < 9 ? "0" : "") + (n + 1) + ".jpg", head: "Follow us", photo: false, social: true });
  return a;
}
function man(slides, extra){
  var m = { v: 1, venue: "The Royal Hotel", mode: "slides", offer: "dec", slides: slides };
  for (var k in (extra || {})) m[k] = extra[k];
  return m;
}
var good = L.plan(man(sl(6, 3, true)), CODE, { offers: OFFERS, now: DEC15 });
ok("3 real photos of 6: their slides are shown", good.state === "slides" && good.slides.length === 7, good.state);
ok("...each from /look-data/<code>/", good.slides[0].src === "/look-data/" + CODE + "/01.jpg", good.slides[0].src);
var poor = L.plan(man(sl(6, 2, true)), CODE, { offers: OFFERS, now: DEC15 });
ok("2 real photos of 6 (the autopilot's needs_social_photos): the demo, no slide shown", poor.state === "demo" && poor.slides.length === 0, poor.state);
ok("no real photo at all: the demo", L.plan(man(sl(5, 0, true)), CODE, { offers: OFFERS, now: DEC15 }).state === "demo");
ok("2 slides, both photos: too few slides, the demo", L.plan(man(sl(2, 2)), CODE, { offers: OFFERS, now: DEC15 }).state === "demo");
ok("3 slides, all photos: shown", L.plan(man(sl(3, 3)), CODE, { offers: OFFERS, now: DEC15 }).state === "slides");
ok("a social slide counts as a slide but never as a photo to carry", L.poorPhotos(sl(2, 2, true)) === false && L.poorPhotos([{ social: true, photo: true }]) === true);
ok("photo must be exactly true (\"yes\" is not a photo)", L.plan(man(sl(4, 0).map(function(s){ s.photo = "yes"; return s; })), CODE, { offers: OFFERS, now: DEC15 }).state === "demo");
ok("a manifest saying demo is the demo whatever its slides say", L.plan(man(sl(6, 6), { mode: "demo" }), CODE, { offers: OFFERS, now: DEC15 }).state === "demo");
var odd = sl(4, 4); odd[1].file = "../../logos/x.jpg"; odd[2].file = "https://elsewhere.example/a.jpg";
var oddp = L.plan(man(odd), CODE, { offers: OFFERS, now: DEC15 });
ok("a file name that is not NN.jpg is dropped (and 2 left is the demo)", oddp.state === "demo", oddp.state);

// ---- missing
ok("no manifest: the missing page", L.plan(null, CODE, { offers: OFFERS, now: DEC15 }).state === "missing");
ok("a manifest with no venue name: missing", L.plan(man(sl(4, 4), { venue: "  " }), CODE, { offers: OFFERS, now: DEC15 }).state === "missing");
ok("an unknown manifest version: missing", L.plan(man(sl(4, 4), { v: 2 }), CODE, { offers: OFFERS, now: DEC15 }).state === "missing");

// ---- the offer
ok("December, December's row: $2.50 by 31 December, linked to /offer-dec",
   good.offer.show && good.offer.day === "31 December" && good.offer.href === "/offer-dec", JSON.stringify(good.offer));
ok("...and the game button goes straight to Play a quick game", good.night === "/quick?from=look", good.night);
var jan = L.plan(man(sl(4, 4)), CODE, { offers: OFFERS, now: JAN3 });
ok("in January the December offer has ended: no price, no roll-on to January", !jan.offer.show && jan.offer.ended && !jan.offer.href, JSON.stringify(jan.offer));
ok("...and the game button is the same with no offer", jan.night === "/quick?from=look", jan.night);
ok("no link on the page goes to the old see-a-night page (301 to /quick since 14 Nov)", PAGE.indexOf("href=\"/see-a-night") < 0 && PAGE.indexOf("'/see-a-night") < 0);
ok("every game link on the page is Play a quick game", (PAGE.match(/href=\"\/quick\?from=look\"/g) || []).length === 3, (PAGE.match(/href=\"\/quick\?from=look\"/g) || []).length);
ok("the Worker saying the code is closed hides the offer", !L.plan(man(sl(4, 4)), CODE, { offers: OFFERS, now: DEC15, workerOpen: false }).offer.show);
ok("the Worker unreachable (null): the dates stand", L.plan(man(sl(4, 4)), CODE, { offers: OFFERS, now: DEC15, workerOpen: null }).offer.show);
ok("a row marked ended (October) is never quoted", !L.offerFor("oct", OFFERS, Date.UTC(2026, 9, 5)).show);
ok("an unknown offer key is never quoted", !L.offerFor("xyz", OFFERS, DEC15).show && !L.offerFor(undefined, OFFERS, DEC15).show);
ok("Brisbane time: 11:59pm on 30 November still quotes November", L.offerFor("nov", OFFERS, NOV30_LATE).show);
ok("...and 12:01am on 1 December (Brisbane) does not", !L.offerFor("nov", OFFERS, NOV30_LATE + 2 * 60000).show);
ok("a December email published early (in November) still quotes December", L.offerFor("dec", OFFERS, NOV30_LATE).show);

// ---- the page's words (lowercase venueplay, no em dashes, no October, no phone, no .dev)
var text = PAGE.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
ok("no capitalised VenuePlay anywhere a reader sees", !/VenuePlay/.test(text));
ok("no em or en dash in the copy", !/[–—]/.test(PAGE));
ok("never October, never a phone number", !/October/i.test(PAGE) && !/\b0[2-8]\s?\d{4}\s?\d{4}\b|\b04\d{2}\s?\d{3}\s?\d{3}\b|5228/.test(PAGE));
ok("no .dev link", !/workers\.dev|pages\.dev|\.dev\//.test(PAGE));
ok("noindex and no-referrer are set on the page itself", /<meta name="robots" content="noindex,nofollow[^"]*">/.test(PAGE) && /<meta name="referrer" content="no-referrer">/.test(PAGE));
ok("the yes is offered, never announced (dean-sales-reply-tone)", /so you can have a play/.test(PAGE) && !/we are setting you up/i.test(PAGE));
var sizes = [], fm, fre = /font-size:\s*(\d+(?:\.\d+)?)px/g; while ((fm = fre.exec(PAGE))) sizes.push(+fm[1]);
var vars = [], vre = /--fs-[a-z0-9]+:\s*(\d+)px/g; while ((fm = vre.exec(PAGE))) vars.push(+fm[1]);
var clampMins = [], cre = /clamp\((\d+)px/g; while ((fm = cre.exec(PAGE))) clampMins.push(+fm[1]);
ok("nothing set under 15px", sizes.concat(vars).concat(clampMins).every(function(n){ return n >= 15; }) && /--fs-min:15px/.test(PAGE), sizes.concat(vars).join(","));
ok("every font shorthand uses a var, never a small fixed size", !/font:\s*\d+\s+(1[0-4]|[0-9])px/.test(PAGE));

// ---- the site config (_redirects serves the page, _headers keeps it out of search and Referers)
var RED = readFile("venueplay/_redirects"), HDR = readFile("venueplay/_headers");
ok("/look/* is rewritten (200) to the page", /^\/look\/\*\s+\/look\s+200\s*$/m.test(RED));
function hdrBlock(path){ var m = new RegExp("^" + path.replace(/[*.\/]/g, "\\$&") + "\\n((?:[ \\t]+.*\\n?)+)", "m").exec(HDR); return m ? m[1] : ""; }
["/look", "/look/*", "/look.html", "/look-data/*"].forEach(function(p){
  var b = hdrBlock(p);
  ok(p + " is X-Robots-Tag noindex and Referrer-Policy no-referrer", /X-Robots-Tag:\s*noindex/.test(b) && /Referrer-Policy:\s*no-referrer\s*$/m.test(b), b);
});
ok("look-data is in no sitemap", !/look/.test(readFile("venueplay/sitemap.xml")));

// ---- the render block, in a fake browser
function el(id){ return { id: id, hidden: true, textContent: "", innerHTML: "", attrs: {}, children: [], style: {}, classList: { add: function(){}, remove: function(){} },
  setAttribute: function(k, v){ this.attrs[k] = v; }, appendChild: function(c){ this.children.push(c); return c; }, addEventListener: function(){}, clientWidth: 960 }; }
function browser(pathname, responses){
  var ids = ["lkLoading","lkMissing","lkSlides","lkDemo","lkCards","lkOffer","lkStandard","lkMore","lkNight","lkOfferDay","lkOfferLink","lkShow","lkPrev","lkNext","lkCount","lkDemoBox","lkYesWhat"];
  var els = {}; ids.forEach(function(i){ els[i] = el(i); });
  var venues = [el("v1"), el("v2")], fetched = [];
  var doc = { title: "", getElementById: function(i){ return els[i]; }, querySelectorAll: function(s){ return s === ".lkVenue" ? venues : []; },
              createElement: function(t){ var e = el(t); e.tag = t; return e; }, createTextNode: function(t){ return { text: t }; } };
  var win = { VPLook: L, VPOffer: W.VPOffer, addEventListener: function(){}, matchMedia: function(){ return { matches: true }; } };
  function fakeFetch(url){
    fetched.push(url);
    var r = responses[url];
    if (r === "throw") return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: !!r, json: function(){ return Promise.resolve(r); } });
  }
  (new Function("window", "document", "location", "fetch", "VPOffer", "setInterval", "clearInterval", RENDER))
    (win, doc, { pathname: pathname, search: "" }, fakeFetch, W.VPOffer, function(){ return 1; }, function(){});
  return { els: els, venues: venues, doc: doc, fetched: fetched };
}
var DATA = "/look-data/" + CODE + "/look.json", API = "https://api.venueplay.com.au/founding?code=OFFER-DEC-2026";
var nasty = "<img src=x onerror=alert(1)> Bar";
var R = {}; R[DATA] = man(sl(4, 4), { venue: nasty }); R[API] = { open: true };
var b1 = browser("/look/" + CODE, R);
var b2 = browser("/look/short", {});
var R3 = {}; R3[DATA] = man(sl(6, 1)); R3[API] = { open: false };
var b3 = browser("/look/" + CODE, R3);
var b4 = browser("/look/" + CODE, {});
for (var di = 0; di < 20; di++) drainMicrotasks();
(function(){
  // b1: their slides (run the render on a real month: the page asks Date.now(), so only shape is checked here)
  ok("render: the manifest is fetched from /look-data/<code>/look.json", b1.fetched[0] === DATA, b1.fetched.join(" "));
  ok("render: the venue name goes in as text only", b1.venues[0].textContent === nasty && b1.venues[0].innerHTML === "", b1.venues[0].innerHTML);
  ok("render: the slides section is shown with one picture per slide", !b1.els.lkSlides.hidden && b1.els.lkShow.children.length === 4, b1.els.lkShow.children.length);
  ok("render: the pictures come only from this code's folder", b1.els.lkShow.children.every(function(c){ return c.src.indexOf("/look-data/" + CODE + "/") === 0; }));
  ok("render: a bad code fetches nothing and says the link isn't working", b2.fetched.length === 0 && !b2.els.lkMissing.hidden && b2.els.lkSlides.hidden);
  ok("render: poor photos show the demo, never a slide", !b3.els.lkDemo.hidden && b3.els.lkSlides.hidden && b3.els.lkShow.children.length === 0);
  var fr = b3.els.lkDemoBox.children[0] || {};
  ok("render: the demo is the real screen in its demo mode", fr.src === "/tv?demo=1&ads=1", fr.src);
  ok("render: the Worker closing the code shows the standard rate, not the offer", b3.els.lkOffer.hidden && !b3.els.lkStandard.hidden);
  ok("render: an unknown code (404) is the missing page", !b4.els.lkMissing.hidden && b4.els.lkSlides.hidden && b4.els.lkDemo.hidden);
})();
print(bad ? ("FAILED " + bad + " of " + ran) : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
