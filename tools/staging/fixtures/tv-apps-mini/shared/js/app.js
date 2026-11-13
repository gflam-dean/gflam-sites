/* venueplay TV for Samsung (Tizen) and LG (webOS). One file, both TVs, ES5 only
   (the oldest supported sets run Chromium 68 and 69). Source of truth: ~/venueplay-tv-apps/shared;
   tools/build.py copies it into samsung/ and lg/.

   A copy of the Android TV app (au.com.venueplay.tv, ~/venueplay-tv-app):
     - asks once which venue this TV is for: type the six-character screen code from the
       host console with the remote (screen code only, Dean 5 Nov 2026: no search by venue name);
       nothing is saved until the venue is confirmed on screen
     - then opens https://venueplay.com.au/tv?venue=<slug> full screen, every launch
     - remembers the venue on the TV across power cycles (localStorage)
     - keeps the screen awake (Samsung: screen saver off; LG: says no to the screen saver)
     - shows a branded "Reconnecting" card, never a browser error page, when VenuePlay
       cannot be reached, and tries again by itself (3, 5, 10, 20, 30 s; at once when the
       network comes back)
     - hidden staff settings: hold OK (or BACK, where the TV lets the page see it) for 5 seconds: reload or change venue

   The same question the Android app and tv.html ask, of the same game Worker, on the
   venueplay.com.au domain:
     GET https://game.venueplay.com.au/venue?code=XXXXXX&probe=1   (probe=1: read only)

   How it differs from Android, because a TV web app cannot do what a WebView can:
     - The venue page is opened as the app's own page (top-level), because the site sends
       X-Frame-Options: SAMEORIGIN, so it cannot sit in a frame inside this one. This page
       stays one step back in the TV's history: #settings one back, #reload two back.
       venueplay/app/vp-tvapp.js on the site (loaded by tv.html) uses those to bring the staff
       settings and the Reconnecting card back while the venue screen is up.
     - A TV web app cannot change its user agent. The page is told it is inside the app by
       the address instead: &app=tizen|webos&appv=<version> (vp-tvapp.js sets window.VP_TV_APP; tv.html reads it as IN_APP). */
(function () {
  "use strict";

  var B = window.VP_BUILD || { platform: "browser", version: "1.0.0" };
  var PLATFORM = B.platform, VERSION = B.version;
  var APP_ID_WEBOS = "au.com.venueplay.tv";

  var SITE = "https://venueplay.com.au";
  var GAME_API = "https://game.venueplay.com.au";
  var PING = SITE + "/favicon-32.png";              // a tiny file: is the site answering at all?

  var CODE_ALPHA = "ACDEFGHJKMNPQRSTUVWXYZ2345679"; // same as tv.html CODE_ALPHA: no 0/O, 1/I/L, B/8
  /* settings page footer (excerpt) */
    small(p, "venueplay TV " + VERSION + ". No ads, no tracking. Privacy: venueplay.com.au/privacy    Help: support@venueplay.com.au");
})();
