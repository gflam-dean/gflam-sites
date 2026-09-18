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

  function isRobot() {
    try {
      if (navigator.webdriver === true) return true;
      // Headless Chrome used to be identifiable only this way, and some drivers still
      // present it. Cheap to check, and a false positive here costs one uncounted visit.
      if (/HeadlessChrome|Puppeteer|Playwright|jsdom/i.test(navigator.userAgent || '')) return true;
    } catch (e) { /* if we cannot tell, count them: a missed visit beats a missed venue */ }
    return false;
  }

  if (isRobot()) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);

  // window.dataLayer explicitly, not a bare `dataLayer`. Google's own snippet relies on
  // the implicit global, which only works because it runs at top level in a page. Inside a
  // file, under 'use strict', that is a ReferenceError waiting for the first person who
  // moves this code.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);
})();
