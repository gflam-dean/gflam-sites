/* THE DEMO SENDS A VENUE BACK TO THE OFFER IT CAME FROM, AT $2.50, WITH NO STATE WORDING.
   26 Sep 2026: /see-a-night still worked out the price from the state pages retired on 25 Sep, so a
   venue from /offer-oct was sent to the $3 homepage, and one from /nsw was told "the New South Wales
   offer". This RUNS the page's own routing script, and the new start bar's, against a fake browser.
   Run: jsc tools/test-demo-returns-to-offer.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var PAGE = readFile("venueplay/see-a-night.html"), OFFER = readFile("venueplay/nsw.html");
function scriptContaining(txt, marker){
  var re = /<script>([\s\S]*?)<\/script>/g, m;
  while ((m = re.exec(txt))) if (m[1].indexOf(marker) >= 0) return m[1];
  return null;
}
var ROUTE = scriptContaining(PAGE, 'SEND THEM BACK TO THE OFFER');
var BAR = scriptContaining(PAGE, 'vpStartStrip');
ok("the routing script is on the page", !!ROUTE);
ok("the start bar script is on the page", !!BAR);

function run(search, referrer){
  var els = { vpNextGo: { href: "/#claim", getAttribute: function(){ return this.href; } },
              vpNextTalk: { href: "/#contact" }, vpNextPrice: { innerHTML: "Then $3" } };
  var document = { referrer: referrer || "", getElementById: function(id){ return els[id]; },
    createElement: function(){ var a = {}; Object.defineProperty(a, "href", { set: function(v){
      var mm = /^https?:\/\/([^\/]+)(\/[^?#]*)?/.exec(v) || []; a.hostname = mm[1] || ""; a.pathname = mm[2] || "/"; } }); return a; } };
  var location = { search: search || "", hostname: "venueplay.com.au" };
  (new Function("document", "location", ROUTE))(document, location);
  return els;
}
if (ROUTE) {
  var a = run("?from=offer-nov");
  ok("from the November offer: back to /offer-nov", a.vpNextGo.href === "/offer-nov#claim", a.vpNextGo.href);
  ok("...and quoted $2.50", /\$2\.50/.test(a.vpNextPrice.innerHTML), a.vpNextPrice.innerHTML);
  var b = run("?from=nsw");
  ok("an old ?from=nsw link goes to the October offer", b.vpNextGo.href === "/offer-oct#claim", b.vpNextGo.href);
  ok("...with no state named in the price", !/New South Wales|NSW|Victoria|Queensland/.test(b.vpNextPrice.innerHTML), b.vpNextPrice.innerHTML);
  var c = run("", "https://venueplay.com.au/offer-oct");
  ok("arriving from /offer-oct (no ?from): back to /offer-oct at $2.50", c.vpNextGo.href === "/offer-oct#claim" && /\$2\.50/.test(c.vpNextPrice.innerHTML), c.vpNextGo.href);
  var d = run("", "https://venueplay.com.au/nsw");
  ok("arriving from /nsw (the October page): back to /offer-oct", d.vpNextGo.href === "/offer-oct#claim", d.vpNextGo.href);
  var e = run("", "https://www.google.com/");
  ok("control: from anywhere else the homepage and its $3 stand", e.vpNextGo.href === "/#claim" && e.vpNextPrice.innerHTML === "Then $3", e.vpNextGo.href);
  var f = run("?from=offer-xyz");
  ok("a made-up month changes nothing", f.vpNextGo.href === "/#claim", f.vpNextGo.href);
}
ok("the offer page opens the demo with its own month", /'\/see-a-night\?from=offer-' \+ key/.test(OFFER) && OFFER.indexOf('/see-a-night?from=offer-oct"') > 0);
ok("no page text on the demo names a state offer", !/on the "\s*\+\s*STATES/.test(PAGE));

if (BAR) {
  var timers = [], listeners = [];
  var cls = {}; var strip = { classList: { toggle: function(c, on){ cls[c] = !!on; } }, contains: function(){ return false; } };
  var els = { vpStartStrip: strip, vpStartGo: { href: "" }, vpStartX: { addEventListener: function(t, fn){ this.fn = fn; } },
              vpNextGo: { getAttribute: function(){ return "/offer-oct#claim"; } } };
  var store = {};
  var document = { getElementById: function(id){ return els[id]; }, querySelector: function(){ return null; },
                   addEventListener: function(t, fn){ listeners.push(fn); } };
  var sessionStorage = { getItem: function(k){ return store[k] || null; }, setItem: function(k, v){ store[k] = v; } };
  (new Function("document", "window", "sessionStorage", "setTimeout", BAR))(document, {}, sessionStorage, function(fn){ timers.push(fn); });
  ok("the bar points where the bottom button points (the visitor's offer)", els.vpStartGo.href === "/offer-oct#claim", els.vpStartGo.href);
  ok("the bar is not shown the instant the page opens", !cls.show);
  listeners.forEach(function(fn){ fn({ target: {} }); });
  ok("it shows once they start using the demo", cls.show === true);
  els.vpStartX.fn();
  ok("the close button hides it, and it stays hidden for the visit", cls.show === false && store.vpStartStripHidden === "1");
}
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
