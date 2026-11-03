/* vp-supabase-oldtv.js  -- LIVE GAME MESSAGES ON AN OLDER TELEVISION (2 Nov 2026).

   THE FAULT. Every venue screen loads /app/vendor/supabase-js-2.118.0.min.js. That build is
   written with optional chaining (a?.b), nullish coalescing (a ?? b), logical assignment
   (a ||= b), class fields and private fields, so it needs Chromium 85 or newer just to PARSE.
   Samsung Tizen 5.5 (2020 sets, Chromium 69) and 6.0 (2021, Chromium 76), and LG webOS 5 (2020,
   Chromium 68) and webOS 6 (2021, Chromium 79) throw a SyntaxError on the first line, the whole
   library is thrown away, `supabase` is never defined, and the wall sits on "Reconnecting" and
   the ads for the whole night: it never hears the host. vp-oldtv.js already fixed the LAYOUT on
   those sets (container units); this fixes the CONNECTION.

   WHAT THIS DOES. Loaded straight after the 2.118.0 tag on every TV screen (tv.html and every
   app/<format>/screen.html). On any engine where 2.118.0 loaded, `supabase.createClient` exists
   and this returns at once: a modern screen is untouched, byte for byte, and downloads nothing
   more. Only where 2.118.0 failed to load does it write ONE more script tag, synchronously, so
   the library is there before the page's own script runs, exactly as if it had been the tag:

     /app/vendor/supabase-js-2.83.0.min.js   the newest supabase-js 2.x that parses as ES2017
                                             (tools/old-tv-syntax.test.py proves it), the same
                                             createClient / channel / broadcast API the screens use

   It defines globalThis first (Chromium 71) because that build reads it.

   PREFERRED LATER: the SAME version, 2.118.0, transpiled to ES2017 (tools/build-oldtv-supabase.md
   in the TV apps folder has the one command). Then only OLD below changes.

   TESTING ON A NEW BROWSER: ?oldsupa=1 throws the modern library away and loads the old-engine
   one, so a modern Chrome or an Android TV WebView runs the exact code an old TV runs.
   ES5, no dependencies. */
(function (w, d) {
  "use strict";
  var OLD = "/app/vendor/supabase-js-2.83.0.min.js";
  var force = /[?&]oldsupa=1(?:&|#|$)/.test((w.location && w.location.search) || "");
  var loaded = false;
  try { loaded = !!(w.supabase && typeof w.supabase.createClient === "function"); } catch (e) { loaded = false; }
  if (loaded && !force) { w.VPOldSupabase = { active: false }; return; }
  if (!("globalThis" in w)) {   // written as a string: the old-TV syntax check reads every bare use
    try { Object.defineProperty(w, "globalThis", { value: w, writable: true, configurable: true }); } catch (e) { w["globalThis"] = w; }
  }
  if (force) { try { w.supabase = undefined; } catch (e) {} }
  w.VPOldSupabase = { active: true, file: OLD, forced: force };
  try { console.log("[venueplay] older TV engine: loading " + OLD); } catch (e) {}
  // document.write from a parser-blocking script runs the new script before the next tag, so
  // the page's own scripts see `supabase` just as they would have with the first tag.
  d.write("<script src=\"" + OLD + "\"><\/script>");
})(window, document);
