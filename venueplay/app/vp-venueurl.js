/* vp-venueurl.js  -- WHICH VENUE IS IN THIS ADDRESS. ONE ANSWER, EVERY SCREEN.

   27 Sep 2026: Dean opened /tv?=hello-hotel. The stray "=" read as no venue, so the TV
   quietly showed the venue that browser last remembered. tv.html was fixed, and the same
   strict parser was still copied into the four game screens and the bingo phone, where a
   bad address fell back to memory and the cold-open bounce then wrote the WRONG venue
   into the address bar as if it had been typed.

   Running the old parser over 16 addresses found more: ?Venue=x (capitals) was ignored,
   ?unified=1&hello-hotel only ever tried the first part, "Hello Hotel" and hello_hotel
   came out as "hellohotel", and a stray "%" made decodeURIComponent throw, which killed
   tv.html's whole main script (no ads, no watchdog).

   So there is one reader, here, and every page calls it:
     - venue= or slug= (any capitals) wins
     - otherwise the first bare part that is not a known setting, forgiving a leading "="
     - decoded safely (a bad "%" falls back to the raw text), lowercased, spaces and
       underscores become hyphens, anything else outside a-z 0-9 - is dropped
     - "" when there is no venue, and the page decides what memory to fall back to.
   Tested by tools/test-venue-url.js, which runs THIS file. ES5, no dependencies. */
(function (root) {
  "use strict";
  var SETTINGS = { demo: 1, unified: 1, roomserver: 1, probe: 1, v: 1, t: 1, ads: 1, logo: 1,
                   tv: 1, room: 1, code: 1, from: 1, mode: 1 };
  function dec(s) { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { return s; } }
  function clean(s) {
    return dec(s).toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  }
  function slug(search) {
    if (search == null) search = (root.location && root.location.search) || "";
    var parts = String(search).replace(/^\?/, "").split("&"), i, p, eq, v;
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; eq = p.indexOf("=");
      if (eq > 0 && /^(venue|slug)$/.test(dec(p.slice(0, eq)).toLowerCase())) {
        v = clean(p.slice(eq + 1)); if (v) return v;
      }
    }
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; eq = p.indexOf("=");
      if (eq === 0) p = p.slice(1); else if (eq > 0) continue;
      v = clean(p);
      if (v && !SETTINGS.hasOwnProperty(v)) return v;
    }
    return "";
  }
  /* The address holds something that is neither a venue we could read nor a known setting
     (?probe=1 or ?unified=1 alone are fine). A page that then falls back to the remembered
     venue must say so, not pretend. */
  function unread(search) {
    if (search == null) search = (root.location && root.location.search) || "";
    if (slug(search)) return false;
    var parts = String(search).replace(/^\?/, "").split("&"), i, p, eq;
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; if (!p) continue; eq = p.indexOf("=");
      if (!SETTINGS.hasOwnProperty(clean(eq > 0 ? p.slice(0, eq) : p.slice(eq + 1)))) return true;
    }
    return false;
  }
  /* Call when a page is about to fall back to the venue it remembered. Warns, and returns
     true, only when the address held something unreadable. */
  function fellBack(search, remembered) {
    if (search == null) search = (root.location && root.location.search) || "";
    if (!unread(search)) return false;
    try { root.console.warn("VenuePlay: no venue could be read from the address \"" + search + "\", so this screen is showing the venue this browser remembered: " + remembered + ". Open /tv?venue=<your-venue> to choose."); } catch (e) {}
    return true;
  }
  root.VPVenueURL = { slug: slug, unread: unread, fellBack: fellBack };
})(window);
