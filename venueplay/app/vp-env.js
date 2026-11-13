/* vp-env.js  -- WHICH venueplay IS THIS PAGE TALKING TO (INBOX 357B / 326, 13 Nov 2026). ES5 on purpose: old TVs load it.

   ONE PLACE for the addresses a page talks to. Two sets:

     LIVE     what every page already uses. The live site does NOT load this file: nothing on live changes.
     STAGING  the test copy: staging.venueplay.com.au, api-staging, game-staging, and the TEST database
              (the old Supabase project). Set here, never typed into a page.

   HOW STAGING USES IT (tools/staging/make-staging-site.py): it copies venueplay/ to a staging folder, swaps every LIVE
   address below for its STAGING twin, and puts <script src="/app/vp-env.js"> first in every page. So the pages stay
   byte-for-byte the pages a release ships, apart from those addresses, and a release is tested as itself.

   THE TRIPWIRE (runs only on a staging host): any request that still names a LIVE address (the live database, the live
   api, the live game Worker) is refused and logged, for fetch, XMLHttpRequest and WebSocket. A page that was missed by the
   swap, or a new hard-coded address, fails loudly on staging instead of quietly reading or writing a real venue.
   A live site address (www.venueplay.com.au) may be READ (a picture, a template) but never written to.

   On any other host this file does nothing except say VPEnv.name = "live".

   TO CHANGE THE STAGING NAMES edit the block between the two STAGING markers (tools/staging/staging-config.json holds
   the Worker side and a test keeps the two in agreement). The anon key is the TEST project's public (publishable) key:
   it is safe to keep in a page, exactly like the live one; main fills it in after the keys are rotated. */
(function (root) {
  "use strict";

  var LIVE = {
    name: "live",
    site: "https://www.venueplay.com.au",
    api: "https://api.venueplay.com.au",
    game: "https://game.venueplay.com.au",
    supabaseUrl: "https://ijkzgmdtwtgfkedqspxm.supabase.co",
    supabaseAnon: "sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb"
  };
  /* VPENV-STAGING-BEGIN */
  var STAGING = {
    name: "staging",
    host: "staging.venueplay.com.au",
    site: "https://staging.venueplay.com.au",
    api: "https://api-staging.venueplay.com.au",
    game: "https://game-staging.venueplay.com.au",
    supabaseUrl: "https://gpoolavkghnxedzrmtmc.supabase.co",
    supabaseAnon: "TEST_ANON_KEY_NOT_SET_YET"
  };
  /* VPENV-STAGING-END */

  function hostOf(u) {
    var m = /^[a-z]+:\/\/([^\/?#:]+)/i.exec(String(u == null ? "" : u));
    return m ? m[1].toLowerCase() : "";
  }
  var LIVE_HOSTS = [hostOf(LIVE.supabaseUrl), hostOf(LIVE.api), hostOf(LIVE.game)];
  var LIVE_SITE_HOSTS = [hostOf(LIVE.site), "venueplay.com.au"];

  var here = (root.location && root.location.hostname) ? String(root.location.hostname).toLowerCase() : "";
  var staging = here === STAGING.host || /^[a-z0-9-]*-staging\.venueplay\.com\.au$/.test(here);

  function copy(a) { var o = {}, k; for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k]; } return o; }
  var env = copy(staging ? STAGING : LIVE);
  env.live = LIVE;                       // the live set, for tools and tests that need to compare
  env.blocked = [];                      // what the tripwire refused (staging only)
  env.isStaging = staging;
  /* Which of the two is a given address? Used by the tripwire and its test. */
  env.isLiveBackend = function (url) { return LIVE_HOSTS.indexOf(hostOf(url)) >= 0; };
  env.isLiveSite = function (url) { return LIVE_SITE_HOSTS.indexOf(hostOf(url)) >= 0; };
  env.shouldBlock = function (url, method) {
    if (!staging) return false;
    if (env.isLiveBackend(url)) return true;
    var m = String(method || "GET").toUpperCase();
    return env.isLiveSite(url) && m !== "GET" && m !== "HEAD";
  };
  root.VPEnv = env;
  if (!staging) return;

  function refuse(kind, url, method) {
    var line = "[vp-env] STAGING refused " + kind + " " + String(method || "GET").toUpperCase() + " " + String(url).slice(0, 120) + " (a live address)";
    env.blocked.push(line);
    try { root.console && root.console.error && root.console.error(line); } catch (e) { /* logging never breaks a page */ }
  }

  /* fetch */
  if (typeof root.fetch === "function") {
    var realFetch = root.fetch;
    root.fetch = function (input, init) {
      var url = (input && typeof input === "object" && input.url) ? input.url : input;
      var method = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
      if (env.shouldBlock(url, method)) {
        refuse("fetch", url, method);
        return Promise.reject(new TypeError("vp-env: a live address is not reachable from staging"));
      }
      return realFetch.apply(this, arguments);
    };
  }
  /* XMLHttpRequest */
  if (root.XMLHttpRequest && root.XMLHttpRequest.prototype && root.XMLHttpRequest.prototype.open) {
    var realOpen = root.XMLHttpRequest.prototype.open;
    root.XMLHttpRequest.prototype.open = function (method, url) {
      if (env.shouldBlock(url, method)) {
        refuse("xhr", url, method);
        throw new Error("vp-env: a live address is not reachable from staging");
      }
      return realOpen.apply(this, arguments);
    };
  }
  /* WebSocket (Supabase Realtime): the host is the same as the database's */
  if (typeof root.WebSocket === "function") {
    var RealWS = root.WebSocket;
    var GuardedWS = function (url, protocols) {
      if (env.shouldBlock(String(url).replace(/^ws/i, "http"), "GET")) {
        refuse("websocket", url, "GET");
        throw new Error("vp-env: a live address is not reachable from staging");
      }
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    GuardedWS.prototype = RealWS.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { GuardedWS[k] = RealWS[k]; });
    root.WebSocket = GuardedWS;
  }
  /* sendBeacon writes too */
  if (root.navigator && typeof root.navigator.sendBeacon === "function") {
    var realBeacon = root.navigator.sendBeacon;
    root.navigator.sendBeacon = function (url) {
      if (env.shouldBlock(url, "POST")) { refuse("beacon", url, "POST"); return false; }
      return realBeacon.apply(root.navigator, arguments);
    };
  }
  /* The tab says so, so nobody mistakes the test copy for the real one. */
  try {
    var tag = function () { if (root.document && root.document.title && root.document.title.indexOf("[staging]") !== 0) root.document.title = "[staging] " + root.document.title; };
    if (root.document) { root.document.addEventListener("DOMContentLoaded", tag); tag(); }
  } catch (e) { /* cosmetic */ }
})(typeof window !== "undefined" ? window : this);
