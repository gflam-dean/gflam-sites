/* GOOGLE ANALYTICS for VenuePlay. ONE COPY OF THE ID, ON PURPOSE.

   This used to be inlined into fourteen pages, which is fourteen copies of the same
   number and exactly what this repo's first rule exists to prevent. vp-pixel.js already
   said so in its own header. Change the id here and every page changes.

   WHY IT SITS IN THIS FOLDER: the release gate checks every script in /app serves as
   JavaScript and is not the homepage in disguise, which is how a tag fails silently.
   Cloudflare Pages answers a missing path with the homepage and a 200, so a tag that did
   not deploy would look fine and count nobody.

   ---------------------------------------------------------------------------------
   IT DOES NOT COUNT OUR OWN ROBOTS, AND THAT IS THE POINT OF THE FILE.

   Dean, 18 Sep 2026: "Can we also not include bots?"

   GA4 filters known spiders by itself. It cannot filter US, and we are the biggest
   source of fake traffic on this site by a distance:

     tools/verify-live.py    drives a REAL browser through three live pages every run,
                             and waits forty seconds on each one. To GA that is not a
                             bot, it is the most engaged visitor of the day
     tools/release-check.py  fetches production pages under --live
     tools/check-live.py     and anything else that pokes the site

   Filtering by IP address was the obvious fix and it is the wrong one: it breaks the
   moment a check runs from somewhere else, and it fails silently when it breaks.

   navigator.webdriver is set to true by every automated browser (Playwright, Puppeteer,
   Selenium, headless Chrome). It travels with the robot rather than with the network, so
   it keeps working from any machine, for ever, with no list to maintain.

   If you ever need to prove a page is still tagged, load it in a normal browser and look
   for the request to googletagmanager.com. The guard only suppresses automation.
   --------------------------------------------------------------------------------- */
(function () {
  'use strict';

  var MEASUREMENT_ID = 'G-E2CZM4BZCH';   // VenuePlay. PartyPlay is a separate property.

  /* OUR OWN PEOPLE, ON A SHARED IP.

     Dean, 19 Sep 2026, on why the obvious fix is not available: "i have Carrier Grade NAT
     shares a public IP across multiple subscribers."

     So GA4's internal-traffic filter is not merely unreliable here, it is dangerous.
     Activating a rule on a CGNAT address would exclude every other subscriber on that
     carrier too, silently, and excluded data is not recorded anywhere to notice.
     Google's own dialog calls the change "destructive and irreversible". It was left
     in Testing and must stay there.

     This travels with the BROWSER instead of the network, so it works from the office,
     from home, and from a phone on mobile data.

         venueplay.com.au/?noga=1     stop counting this browser, for good
         venueplay.com.au/?noga=0     start counting it again

     Set it once on each device the team uses. It survives until site data is cleared.
     If it is ever wrong it fails towards COUNTING you, which costs a few sessions of
     noise rather than hiding real venues. */
  var OPT_OUT = 'vpNoAnalytics';

  function teamOptOut() {
    try {
      var q = (location.search || '');
      if (/[?&]noga=1\b/.test(q)) { localStorage.setItem(OPT_OUT, '1'); return true; }
      if (/[?&]noga=0\b/.test(q)) { localStorage.removeItem(OPT_OUT); return false; }
      return localStorage.getItem(OPT_OUT) === '1';
    } catch (e) {
      return false;   // private window, blocked storage: count them
    }
  }

  function isRobot() {
    try {
      if (navigator.webdriver === true) return true;
      // Headless Chrome used to be identifiable only this way, and some drivers still
      // present it. Cheap to check, and a false positive here costs one uncounted visit.
      if (/HeadlessChrome|Puppeteer|Playwright|jsdom/i.test(navigator.userAgent || '')) return true;
    } catch (e) { /* if we cannot tell, count them: a missed visit beats a missed venue */ }
    return false;
  }

  /* NOT THE LIVE SITE, NOT COUNTED. A preview on localhost (the pages are opened that way
     to test them) went into the live property: 11 page views on 22 Sep, 28 Aug and 12 Sep,
     inflating Brisbane and /qld (GA audit, 25 Sep 2026). Only venueplay.com.au and its
     subdomains count. An empty hostname counts, so this fails towards counting. */
  function notLiveSite() {
    try {
      var h = String(location.hostname || '').toLowerCase();
      return !!h && !/(^|\.)venueplay\.com\.au$/.test(h);
    } catch (e) { return false; }
  }

  if (isRobot() || teamOptOut() || notLiveSite()) return;

  // window.dataLayer explicitly, not a bare `dataLayer`. Google's own snippet relies on
  // the implicit global, which only works because it runs at top level in a page. Inside a
  // file, under 'use strict', that is a ReferenceError waiting for the first person who
  // moves this code.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  /* A VISIT COUNTS WHEN A PERSON DOES SOMETHING. Dean, 25 Sep 2026: "Can we remove them from
     my report". Microsoft's mail scanners open every link in an email from Australian Azure
     data centres, so 29 of 30 "Australian" visits on 24 Sep were machines: they load the page
     and never touch it. So nothing is loaded or sent until the first mouse move, touch, key or
     wheel. A person reading does one of those within seconds; a scanner never does. Anything
     queued before then (nothing, normally) goes out with the tag when it loads. */
  var counting = false;
  var HUMAN = ['pointermove', 'pointerdown', 'mousemove', 'touchstart', 'keydown', 'wheel'];
  function startCounting() {
    if (counting) return;
    counting = true;
    for (var i = 0; i < HUMAN.length; i++) {
      try { window.removeEventListener(HUMAN[i], startCounting, true); } catch (e) {}
    }
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    document.head.appendChild(s);
    // unshift, so the config is ahead of any click queued in the same instant. Each entry is an
    // `arguments` object, exactly what gtag() pushes: gtag.js reads those as commands.
    function cmd() { return arguments; }
    window.dataLayer.unshift(cmd('config', MEASUREMENT_ID));
    window.dataLayer.unshift(cmd('js', new Date()));
  }
  for (var hi = 0; hi < HUMAN.length; hi++) {
    try { window.addEventListener(HUMAN[hi], startCounting, { capture: true, passive: true }); } catch (e) {}
  }

  /* ---------------------------------------------------------------------------------
     WHAT DID THEY ACTUALLY PRESS?

     Dean, 19 Sep 2026: "So people are landing on the page and not clicking anything?"
     Nobody could answer that, including me, and THAT was the real problem.

     The two main buttons on the homepage go to #claim and #modes. They are anchors that
     scroll the same page. GA4's own automatic click tracking only fires for links leaving
     the site, so an in-page anchor produces no event and no page view. Every press of
     "Get started" was invisible. 292 people saw that page in 30 days and we could not say
     whether one of them touched the button.

     One delegated listener on the document, so it works for anything added later and costs
     one handler rather than one per link.
     --------------------------------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var a;
    try {
      // .closest, because the click usually lands on a span INSIDE the anchor
      a = ev.target && ev.target.closest && ev.target.closest('a,button,summary');
    } catch (e) { return; }
    if (!a) return;
    /* WHICH QUESTIONS DO THEY OPEN? Dean, 25 Sep 2026: "is it showing what FAQ's they
       open? That would be super handy". A FAQ is a <details>, pressed on its <summary>,
       which is neither a link nor a button, so it was invisible. Counted on OPENING only:
       the click fires before the browser toggles, so a closed <details> is being opened. */
    if (a.tagName === 'SUMMARY' && a.parentNode && a.parentNode.tagName === 'DETAILS' && a.parentNode.open) return;

    var href = a.getAttribute('href') || '';
    var label = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label) label = a.getAttribute('aria-label') || '(no label)';

    var kind = 'other';
    if (a.tagName === 'SUMMARY') kind = 'faq';
    else if (href.charAt(0) === '#') kind = 'anchor';              // the invisible ones
    else if (/^mailto:/i.test(href)) kind = 'email';
    else if (/^tel:/i.test(href)) kind = 'phone';
    else if (/^https?:/i.test(href) && href.indexOf(location.host) === -1) kind = 'outbound';
    else if (href) kind = 'internal';
    else if (a.tagName === 'BUTTON') kind = 'button';

    /* WHICH PAGE THEY PRESSED IT ON, as its own field.
       Dean, 19 Sep: "We should do a different one for each state though so a nsw/get
       started etc". page_path carries it, but reading a report by combining two dimensions
       is the sort of thing nobody does twice. cta_state makes "NSW / Get started" one line.
       The homepage and the state pages sell the SAME product at DIFFERENT prices, so this
       is the comparison that matters: /nsw holds people 279 seconds and engages 76%, the
       homepage 69 seconds and 10%. */
    var seg = (location.pathname || '/').split('/')[1] || '';
    seg = seg.replace(/\.html$/, '').toLowerCase();
    var state = !seg ? 'home'
      : (/^(nsw|qld|vic|sa|wa|nt|tas|act)$/.test(seg) ? seg.toUpperCase() : seg);

    try {
      gtag('event', 'cta_click', {
        cta_label: label,
        cta_target: href || '(button)',
        cta_kind: kind,
        cta_state: state,
        page_path: location.pathname
      });
    } catch (e) { /* never let analytics break a click */ }
  }, true);   // capture, so it still counts when the handler below calls stopPropagation
})();
