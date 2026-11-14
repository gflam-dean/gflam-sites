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
/* Dean, 7 Nov 2026 (round 3, note 25): the offer page no longer links to the full demo at all; the hero's
   sample night does that job. The demo still sends a visitor who came from an offer back to it (above). */
ok("the offer page has no link to the full demo (/see-a-night), in its HTML or written in by its script",
   OFFER.indexOf('href="/see-a-night') === -1 && OFFER.indexOf("'/see-a-night") === -1 && OFFER.indexOf('Play with a full night') === -1);
/* Dean, 15 Nov 2026 (INBOX 421): NO page, menu, button, footer, sitemap or llms.txt links to /see-a-night any more; the page itself stays
   deployed and reachable by its own address until Play a quick game replaces it. Every public page is read, link text or JS-built path alike. */
var LINK_PAGES = ["404", "add-card", "c", "go-venue", "help", "index", "leave-behind-club", "leave-behind-pub", "leave-behind-rsl", "leave-behind",
  "live-here-now", "nsw", "play", "privacy", "s", "screen-check", "signage", "terms", "training", "tv", "unsubscribe"].map(function (p) { return "venueplay/" + p + ".html"; })
  .concat(["venueplay/sitemap.xml", "venueplay/llms.txt", "venueplay/robots.txt", "venueplay/app/vp-subscribe.js", "venueplay/app/vp-demo-venue.js"]);
var LINKS_BACK = /href\s*=\s*["'][^"']*see-a-night|<loc>[^<]*see-a-night|["'`]\/see-a-night|venueplay\.com\.au\/see-a-night/i;
var linking = LINK_PAGES.filter(function (f) { var t; try { t = readFile(f); } catch (e) { return false; } return LINKS_BACK.test(t); });
ok("no public page, sitemap.xml or llms.txt links to /see-a-night (the page stays reachable by its address, unlisted)", linking.length === 0, linking.join(", "));
/* Dean, 15 Nov 2026 (INBOX 421, welcome email): NO email body links to /see-a-night either. Every Worker that builds an email, and the email
   templates, are read; the only places the word may appear are the sign-up source list and the analytics path normaliser. */
var EMAIL_SRC = ["venueplay-backend/worker/venueplay-api-FULL.js", "venueplay-backend/worker/venueplay-game.js", "venueplay-backend/worker/venueplay-room.js",
  "venueplay-backend/worker/venueplay-sms-hook.js", "venueplay/email/signature.html"];
var emailLinks = [];
EMAIL_SRC.forEach(function (f) { var t; try { t = readFile(f); } catch (e) { return; }
  t.split("\n").forEach(function (line, i) { if (!/see-a-night/i.test(line)) return;
    if (/const VPS_SOURCES = /.test(line) || /\|signage\|training\|screen-check\|live-here-now\|see-a-night\|offer-/.test(line)) return;   // the source list, the analytics path rule
    emailLinks.push(f + ":" + (i + 1)); }); });
ok("no email body, in any Worker or template, links to /see-a-night", emailLinks.length === 0, emailLinks.join(", "));
ok("the /see-a-night page itself is still deployed and plays (reachable by direct address)", PAGE.indexOf("<h1") >= 0 && PAGE.length > 5000);
ok("no page text on the demo names a state offer", !/on the "\s*\+\s*STATES/.test(PAGE));

if (BAR) {
  var timers = [], listeners = [];
  var cls = {}; var strip = { classList: { toggle: function(c, on){ cls[c] = !!on; } }, contains: function(){ return false; } };
  var els = { vpStartStrip: strip, vpStartGo: { href: "" }, vpStartX: { addEventListener: function(t, fn){ this.fn = fn; } },
              vpNextGo: { getAttribute: function(){ return "/offer-oct#claim"; } } };
  var store = {};
  var bodyCls = {};
  var document = { body: { classList: { toggle: function(c, on){ bodyCls[c] = !!on; } } },
                   getElementById: function(id){ return els[id]; }, querySelector: function(){ return null; },
                   addEventListener: function(t, fn){ listeners.push(fn); } };
  var sessionStorage = { getItem: function(k){ return store[k] || null; }, setItem: function(k, v){ store[k] = v; } };
  (new Function("document", "window", "sessionStorage", "setTimeout", BAR))(document, {}, sessionStorage, function(fn){ timers.push(fn); });
  ok("the bar points where the bottom button points (the visitor's offer)", els.vpStartGo.href === "/offer-oct#claim", els.vpStartGo.href);
  ok("the bar is not shown the instant the page opens", !cls.show);
  listeners.forEach(function(fn){ fn({ target: {} }); });
  ok("it shows once they start using the demo", cls.show === true);
  ok("...and tells the page, so the full-screen demo leaves room for it", bodyCls["vp-strip-on"] === true);
  els.vpStartX.fn();
  ok("the close button hides it, and it stays hidden for the visit", cls.show === false && store.vpStartStripHidden === "1");
}
/* "Nothing is there" (Dean, 26 Sep): the strip sat UNDER the full-screen demo. It must sit above it. */
var zStrip = +((/\.vp-startstrip\{[^}]*z-index:(\d+)/.exec(PAGE) || [])[1] || 0);
var zDemo = +((/\.vp-backdrop \{[\s\S]*?z-index:\s*(\d+)/.exec(PAGE) || [])[1] || 0);
ok("the strip sits above the full-screen demo (" + zStrip + " over " + zDemo + ")", zStrip > zDemo && zDemo > 0);
ok("the demo leaves room at the bottom while the strip shows", /body\.vp-strip-on \.vp-backdrop\{padding-bottom:\d+px\}/.test(PAGE));
/* "any demos need to start on trivia" (Dean, 26 Sep) */
ok("the full demo starts on trivia", /var currentMode = "trivia";/.test(PAGE) && /id="vpModeLabel">Trivia</.test(PAGE));
var opts = PAGE.match(/data-mode="([a-z]+)" data-label="[^"]*" aria-selected="(true|false)"/g) || [];
ok("trivia is first in the game menu and the one selected", opts.length > 3 && /data-mode="trivia"[\s\S]*aria-selected="true"/.test(opts[0]) &&
   opts.filter(function(o){ return /aria-selected="true"/.test(o); }).length === 1, opts[0]);
ok("then musical bingo, then bingo, as on the homepage", /"musical"/.test(opts[1] || "") && /"bingo"/.test(opts[2] || ""));

/* The offer badge on a phone (27 Sep 2026): the date must sit in the same flex item as its words. */
ok("the offer line is plain bold text with its date in one span (no pill, no dot)",
   /<p class="hero-offer">\$2\.50 a player if you join by <span class="vpc-day"[^>]*>\d{1,2} [A-Z][a-z]+<\/span>\.<\/p>/.test(OFFER));
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
