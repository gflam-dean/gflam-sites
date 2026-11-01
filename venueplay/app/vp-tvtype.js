/* vp-tvtype.js  -- WHAT KIND OF TV IS THIS. ONE LIST, EVERY PAGE (1 Nov 2026).

   Dean, 1 Nov 2026: we do not know what televisions our venues use, so we cannot tell whether a
   Samsung or LG app is worth building. Each venue screen now works out a COARSE device type from
   its own browser and says it once per page load on the /venue poll it already makes. HQ counts
   them, the /tv setup card shows the setup line that fits, and support sees a venue's TV type.

   WHAT LEAVES THE TV: one short code from the list below (for example "samsung"), and a random
   id for this TV (localStorage vpTvDev) so two screens at one venue count as two. NEVER the user
   agent string itself, never a model number, never anything about a person. The table is worked
   out here, in the browser; the Worker and the database only ever see the code.

   THE LIST IS HERE AND NOWHERE ELSE. tv.html detects with it, hq.html names the codes with it,
   and the Worker and the database only check a code's SHAPE (^[a-z]{2,12}$), so adding a type is
   one line here. An unknown code shows in HQ as "Unknown".

   Plain ES5: this runs on the oldest televisions we support (see vp-oldtv.js).
   Tested by tools/test-tv-type.js against real user agent strings for each TV family. */
(function (root) {
  "use strict";

  /* code -> label, in the order HQ lists them. */
  var LABELS = [
    ["app",        "venueplay app"],
    ["samsung",    "Samsung (Tizen)"],
    ["lg",         "LG (webOS)"],
    ["firetv",     "Fire TV"],
    ["googletv",   "Google TV / Android TV"],
    ["chromecast", "Chromecast"],
    ["sony",       "Sony (other smart TV)"],
    ["philips",    "Philips (other smart TV)"],
    ["hisense",    "Hisense (other smart TV)"],
    ["tcl",        "TCL (other smart TV)"],
    ["othertv",    "Other smart TV"],
    ["apple",      "Apple TV / AirPlay"],
    ["pc",         "Laptop or PC"],
    ["mobile",     "Phone or tablet"],
    ["unknown",    "Unknown"]
  ];
  var BY_CODE = {};
  for (var i = 0; i < LABELS.length; i++) BY_CODE[LABELS[i][0]] = LABELS[i][1];

  function label(code) { return BY_CODE.hasOwnProperty(code) ? BY_CODE[code] : BY_CODE.unknown; }
  function isCode(code) { return typeof code === "string" && BY_CODE.hasOwnProperty(code); }

  /* THE TABLE. Order matters: the first rule that matches wins.
       ua      navigator.userAgent
       uaData  navigator.userAgentData, if the browser has it ({ mobile, platform })
       touch   navigator.maxTouchPoints (an iPad says "Macintosh" and has touch) */
  function detect(ua, uaData, touch) {
    ua = String(ua || "");
    var d = uaData && typeof uaData === "object" ? uaData : null;
    var android = /\bAndroid\b/.test(ua);

    // 1. our own Google Play app: ScreenActivity.java adds VenuePlayTV/<version>
    if (/\bVenuePlayTV\//.test(ua)) return "app";
    // 2. Amazon Fire TV: every Fire TV model code starts AFT (AFTMM, AFTKA, AFTSSS...). The
    //    Kindle Fire TABLETS are KF.. and fall through to a tablet below.
    if (/\bAFT[A-Z0-9]{1,6}\b/.test(ua) || /\bFire ?TV\b/i.test(ua)) return "firetv";
    // 3. Chromecast: the old cast-only stick (CrKey) and Chromecast with Google TV (model "Chromecast")
    if (/\bCrKey\//.test(ua) || (android && /;\s*Chromecast\b/.test(ua))) return "chromecast";
    // 4. Samsung Tizen (the TV browser and its web apps)
    if (/\bTizen\b/i.test(ua)) return "samsung";
    // 5. LG webOS ("Web0S" with a zero on the sets) and the NetCast sets before it
    if (/\bWeb0S\b/.test(ua) || /\bwebOS\b.*\b(SmartTV|TV)\b/i.test(ua) || /\bNetCast\b/i.test(ua) || /\bLG Browser\b/.test(ua)) return "lg";
    // 6. anything Android that says it is a television, or is a known TV maker's Android set
    var tvWords = /\b(Android ?TV|Google ?TV|GoogleTV|Smart ?TV|SMART-TV|SmartTV|BRAVIA|SHIELD Android TV|MIBOX\w*|MiTV\w*|AndroidTV|DTV|ATV|HbbTV|TV Safari)\b/i;
    //    (a maker's name alone only counts when the browser does not also say Mobile: Sony and TCL make phones)
    if (android && (tvWords.test(ua) || /;\s*TV\b/.test(ua) || (/\b(Sony|Philips|Hisense|TCL|Mi Box)\b/i.test(ua) && !/\bMobile\b/.test(ua)))) return "googletv";
    // 7. the TV makers' own non-Android systems
    if (/\b(BRAVIA|SonyCEBrowser|SonyDTV|Sony)\b/i.test(ua) && !/\b(Xperia|iPhone|Mobile)\b/.test(ua)) return "sony";
    if (/\b(Philips|NETTV|NetTV|Saphi)\b/i.test(ua)) return "philips";
    if (/\b(VIDAA|Hisense|HiSmart)\b/i.test(ua)) return "hisense";
    if (/\bTCL\b/.test(ua)) return "tcl";
    // 8. Apple TV: there is no browser on tvOS, so this only matches a web view that says so
    if (/\b(AppleTV|Apple ?TV|tvOS)\b/i.test(ua)) return "apple";
    // 9. any other smart TV marker
    if (/\b(SmartTV|SMART-TV|Smart TV|HbbTV|Opera TV|OMI\/|Viera|AQUOS|Panasonic|Roku|TV Safari|CE-HTML|NETRANGE|Espial|Vewd|PhilipsTV|Toshiba|Grundig|Sharp)\b/i.test(ua)) return "othertv";
    // 10. phones and tablets
    if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "mobile";
    if (/\bMacintosh\b/.test(ua) && (+touch || 0) > 1) return "mobile";   // iPadOS asks for the desktop site
    if (android) return "mobile";                                            // phones and tablets; a TV said so above
    if (/\b(Mobile|Windows Phone|BlackBerry|KFAPWI|Kindle|Silk)\b/.test(ua)) return "mobile";
    if (d && d.mobile === true) return "mobile";
    // 11. laptops and desktops
    if (/\b(Windows NT|Macintosh|Mac OS X|CrOS|X11|Linux x86_64|Ubuntu|Fedora)\b/.test(ua)) return "pc";
    if (d && /^(Windows|macOS|Linux|Chrome OS|ChromeOS)$/.test(String(d.platform || ""))) return "pc";
    return "unknown";
  }

  /* THE SETUP LINE THAT FITS (tv.html, the "Set up this screen" card, only on a screen with no
     venue linked). app: "show" or "hide" the Google Play half; head/text: the browser half's
     words, or null to keep what the page already says. House rules: venueplay lowercase, no
     long dashes, no phone number, no web address but venueplay.com.au. */
  function setup(code) {
    var browser = function (head) {
      return { app: "hide", head: head, text: "Put in the six-character screen code from your host console, then save this page as the TV&rsquo;s home page or a bookmark." };
    };
    switch (code) {
      case "app":        return { app: "hide", head: null, text: null };
      case "googletv":   return { app: "show", head: "Or use this TV&rsquo;s web browser", text: null, appHead: "This TV has Google Play. <b>Get the venueplay TV app</b>" };
      case "chromecast": return { app: "show", head: "Or use a web browser", text: null, appHead: "This Chromecast has Google Play. <b>Get the venueplay TV app</b>" };
      case "firetv":     return browser("On this Fire TV, use its web browser");
      case "samsung":    return browser("On this Samsung TV, use its Internet app");
      case "lg":         return browser("On this LG TV, use its Web Browser");
      case "sony":       return browser("On this Sony TV, use its web browser");
      case "philips":    return browser("On this Philips TV, use its web browser");
      case "hisense":    return browser("On this Hisense TV, use its web browser");
      case "tcl":        return browser("On this TCL TV, use its web browser");
      case "othertv":    return browser("On this smart TV, use its web browser");
      case "apple":      return { app: "hide", head: "Showing this through AirPlay?", text: "Put in the six-character screen code from your host console, and keep the device you are sharing from awake and plugged in." };
      case "pc":         return { app: "show", head: "Or use this computer&rsquo;s browser", text: "Put in the six-character screen code from your host console. If this computer is plugged into the TV, go fullscreen." };
      case "mobile":     return { app: "show", head: "On a phone or tablet?", text: "This page is for the TV. Open venueplay.com.au/tv on the TV itself, or put in the screen code here to try it." };
      default:           return { app: "show", head: null, text: null };
    }
  }

  var api = { LABELS: LABELS, label: label, isCode: isCode, detect: detect, setup: setup };
  root.VPTvType = api;
})(typeof window !== "undefined" ? window : this);
