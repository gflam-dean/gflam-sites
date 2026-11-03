/* vp-tvapp.js: tv.html INSIDE THE SAMSUNG (TIZEN) AND LG (webOS) VENUEPLAY TV APPS (2 Nov 2026).

   Does nothing at all unless the address carries &app=tizen or &app=webos, which only the
   two TV apps add (~/venueplay-tv-apps/shared/js/app.js, Venue.screenUrl).
   A browser, the Android app and every other screen are untouched.

   Why it exists: on Android the app wraps tv.html in a WebView it controls (user agent,
   keys, error pages). A Samsung or LG web app cannot: the venue site refuses to sit in a
   frame (X-Frame-Options: SAMEORIGIN), so the app opens tv.html as its own page, with the
   app's own page one step back in the TV's history:
       history.go(-1)  -> the app's staff settings   (index.html#settings)
       history.go(-2)  -> the app reopens the screen (index.html#reload), showing its
                          branded Reconnecting card and retrying if the site is not answering
   This file puts back, on tv.html, the parts of the Android app that must live in the page:
     1. tells tv.html it is in the app (window.VP_TV_APP; tv.html's IN_APP test reads it,
        see IN_APP in tv.html), and hides the "Go fullscreen" button, as ScreenActivity does
     2. hold BACK (or OK) for 5 seconds: staff settings. A short BACK shows the hint and
        never closes the screen; a second BACK while the hint is up goes to the TV's home
        screen (both stores test that BACK leaves the app; the app keeps running)
     3. the network drops: a branded "Reconnecting" card over the page, never a blank or a
        browser error; when it comes back after more than two minutes, a clean reopen
     4. a reload while VenuePlay is not answering goes through the app (Reconnecting card,
        retries) instead of to a browser error page. Wraps window.__vpTvReload, so the
        watchdog's MIN_GAP limiter and reason logging still apply
     5. keeps the TV awake (Samsung screen saver off, LG screen saver answered no)
     6. back on screen after 30 minutes hidden (input switched, Home pressed): a fresh
        reopen, as the Android app's onStart does
   ES5, no dependencies. Load it in <head>, BEFORE tv.html's main script (for 4). */
(function () {
  "use strict";
  var q = window.location.search || "";
  var m = /[?&]app=(tizen|webos)(?:&|$)/i.exec(q);
  if (!m) return;
  var PLATFORM = m[1].toLowerCase();
  var vm = /[?&]appv=([0-9.]{1,20})(?:&|$)/.exec(q);
  var VERSION = vm ? vm[1] : "";
  window.VP_TV_APP = { platform: PLATFORM, version: VERSION, marker: "VenuePlayTV/" + VERSION + " (" + PLATFORM + ")" };
  try { document.documentElement.setAttribute("data-vp-tvapp", PLATFORM); } catch (e) {}

  var HOLD_MS = 5000, HIDDEN_RELOAD_MS = 30 * 60 * 1000, LONG_OFFLINE_MS = 2 * 60 * 1000;
  var HOLD_WORDS = PLATFORM === "tizen" ? "Hold OK for 5 seconds for settings" : "Hold BACK for 5 seconds for settings";
  var APP_ID_WEBOS = "au.com.venueplay.tv";

  function log(s) { try { console.info("[VenuePlayTV app] " + s); } catch (e) {} }
  function venueName() {
    try { var n = document.getElementById("venueNameTag"); if (n && n.textContent) return n.textContent.replace(/^\s+|\s+$/g, ""); } catch (e) {}
    return "";
  }

  // ---------------------------------------------------------------- back to the app
  var leaving = false;
  function toApp(why, steps) {
    if (leaving) return;
    leaving = true;
    log("back to the app: " + why);
    try { sessionStorage.setItem("vpTvReloadWhy", "tvapp-" + why); } catch (e) {}
    try { window.history.go(-steps); } catch (e) { leaving = false; return; }
    // If there was no app page behind us (tv.html opened some other way), stay put.
    setTimeout(function () { leaving = false; }, 3000);
  }
  function toSettings() { toApp("settings", 1); }
  function reopen(why) { toApp(why || "reopen", 2); }
  function toTvHome() {
    if (PLATFORM === "tizen") { try { window.tizen.application.getCurrentApplication().hide(); return; } catch (e) {} }
    if (PLATFORM === "webos") {
      try { if (window.webOSSystem && window.webOSSystem.platformBack) { window.webOSSystem.platformBack(); return; } } catch (e) {}
      try { if (window.PalmSystem && window.PalmSystem.platformBack) { window.PalmSystem.platformBack(); return; } } catch (e) {}
    }
    toSettings();   // no TV API reachable from this page: the app's settings has "Close the app"
  }

  function reach(cb) {
    var done = false, img = new Image();
    function end(ok) { if (!done) { done = true; cb(ok); } }
    var t = setTimeout(function () { end(false); }, 8000);
    img.onload = function () { clearTimeout(t); end(true); };
    img.onerror = function () { clearTimeout(t); end(false); };
    img.src = "/favicon-32.png?vptv=" + Date.now();
  }

  // ---------------------------------------------------------------- 4. reloads go through the app when needed
  var realReload = null;
  function guardedReload(why) {
    if (!realReload) return;
    reach(function (ok) {
      if (ok) realReload(why);           // the watchdog's own reload: MIN_GAP, reason, onLine check
      else reopen("reload-unreachable"); // the app shows Reconnecting and retries
    });
  }
  try {
    Object.defineProperty(window, "__vpTvReload", {
      configurable: true,
      get: function () { return realReload ? guardedReload : undefined; },
      set: function (fn) { realReload = typeof fn === "function" ? fn : null; }
    });
  } catch (e) { log("could not wrap __vpTvReload"); }

  // ---------------------------------------------------------------- the page furniture
  var css = "#tvFsBtn{display:none!important}" +
    "#vpAppCard{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483646;display:none;background:#0A0A0B;color:#E7E7EC;" +
    "font-family:Roboto,'LG Smart UI',TizenSans,SamsungOne,Helvetica,Arial,sans-serif;text-align:center}" +
    "#vpAppCard.on{display:block}#vpAppCard .in{position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%);-webkit-transform:translateY(-50%)}" +
    "#vpAppCard h1{margin:0;font-size:68px;color:#FFC24B}#vpAppCard p{margin:28px auto 0;max-width:1440px;font-size:38px;line-height:1.25}" +
    "#vpAppCard small{display:block;margin-top:40px;font-size:30px;color:#9A9AA4}" +
    "#vpAppHint{position:fixed;left:50%;bottom:72px;z-index:2147483647;display:none;transform:translateX(-50%);-webkit-transform:translateX(-50%);" +
    "padding:32px 48px;font:700 36px Roboto,'LG Smart UI',TizenSans,SamsungOne,Helvetica,Arial,sans-serif;color:#fff;white-space:nowrap;" +
    "background:rgba(18,18,20,.92);border:4px solid #FF1F8E;border-radius:28px}#vpAppHint.on{display:block}";
  var card, cardBody, cardSmall, hint;
  function build() {
    if (card || !document.body) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    card = document.createElement("div"); card.id = "vpAppCard";
    var inner = document.createElement("div"); inner.className = "in";
    var h = document.createElement("h1"); h.textContent = "Reconnecting";
    cardBody = document.createElement("p");
    cardSmall = document.createElement("small");
    inner.appendChild(h); inner.appendChild(cardBody); inner.appendChild(cardSmall); card.appendChild(inner);
    hint = document.createElement("div"); hint.id = "vpAppHint"; hint.setAttribute("role", "status");
    document.body.appendChild(card); document.body.appendChild(hint);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  // tv.html's own <style> can load after this file, so the button is also hidden directly.
  (function hideFs() {
    function off() { var b = document.getElementById("tvFsBtn"); if (b && b.style.display !== "none") b.style.display = "none"; }
    document.addEventListener("DOMContentLoaded", function () {
      off();
      try { new MutationObserver(off).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    });
  })();

  var hintTimer = 0, hintKind = "";
  function showHint(s, ms, kind) {
    build(); if (!hint) return;
    hint.textContent = s; hint.className = "on"; hintKind = kind || "";
    clearTimeout(hintTimer);
    if (ms > 0) hintTimer = setTimeout(hideHint, ms);
  }
  function hideHint() { clearTimeout(hintTimer); hintKind = ""; if (hint) hint.className = ""; }

  // ---------------------------------------------------------------- 3. the network drops
  var offlineSince = 0;
  function showOffline() {
    build(); if (!card) return;
    if (!offlineSince) offlineSince = Date.now();
    var nm = venueName();
    cardBody.textContent = "This TV has lost its internet connection. " + (nm ? nm + "'s screen" : "The venue screen") + " will come back by itself as soon as it is back.";
    cardSmall.textContent = HOLD_WORDS;
    card.className = "on";
  }
  window.addEventListener("offline", showOffline);
  window.addEventListener("online", function () {
    var away = offlineSince ? Date.now() - offlineSince : 0;
    setTimeout(function () {
      if (navigator.onLine === false) return;
      offlineSince = 0;
      if (away > LONG_OFFLINE_MS) { reopen("back-online"); return; }
      if (card) card.className = "";
    }, 1500);
  });
  if (navigator.onLine === false) document.addEventListener("DOMContentLoaded", showOffline);

  // ---------------------------------------------------------------- 2. the remote
  var BACKS = { 10009: 1, 461: 1, 27: 1, 8: 1 };
  var held = -1, heldSince = 0, holdTimer = 0, opened = false;
  function holdTick() {
    if (held < 0 || opened) return;
    var t = Date.now() - heldSince;
    if (t >= HOLD_MS) { opened = true; hideHint(); toSettings(); return; }
    if (t >= 1000) showHint("Keep holding for settings ... " + Math.ceil((HOLD_MS - t) / 1000), 0);
    holdTimer = setTimeout(holdTick, 200);
  }
  function onDown(e) {
    var k = e.keyCode;
    if (!(BACKS[k] || k === 13)) return;
    e.preventDefault();       // no stopPropagation: tv.html's own key listeners (audio unlock) still run
    if (held === k) return;   // the remote's own key repeat
    if (BACKS[k] && hintKind === "short") { hideHint(); toTvHome(); return; }
    held = k; heldSince = Date.now(); opened = false;
    clearTimeout(holdTimer); holdTimer = setTimeout(holdTick, 200);
  }
  function onUp(e) {
    if (e.keyCode !== held) return;
    e.preventDefault();
    clearTimeout(holdTimer);
    var was = opened; held = -1;
    if (!was) showHint("venueplay screen. " + HOLD_WORDS + ". BACK again for the TV home screen.", 3500, "short");
  }
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  // tv.html puts each game screen in a same-site frame. If a frame ever has the focus, the
  // remote's keys land in it, so the same two listeners go into every frame too.
  function hookFrames() {
    var fs = document.getElementsByTagName("iframe");
    for (var i = 0; i < fs.length; i++) {
      try {
        var w = fs[i].contentWindow;
        if (w && !w.__vpTvAppKeys) { w.__vpTvAppKeys = 1; w.addEventListener("keydown", onDown, true); w.addEventListener("keyup", onUp, true); }
      } catch (e) {}
    }
  }
  setInterval(hookFrames, 2000);

  // ---------------------------------------------------------------- 5. awake
  var ssBridge = null;
  function luna(uri, params, cb) {
    try {
      var b = new window.PalmServiceBridge();
      b.onservicecallback = function (msg) { try { if (cb) cb(JSON.parse(msg)); } catch (e) {} };
      b.call(uri, JSON.stringify(params || {}));
      return b;
    } catch (e) { return null; }
  }
  function keepAwake() {
    if (PLATFORM === "tizen") {
      try { window.webapis.appcommon.setScreenSaver(window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (e) {}
    } else if (!ssBridge) {
      ssBridge = luna("luna://com.webos.service.tvpower/power/registerScreenSaverRequest",
        { subscribe: true, clientName: APP_ID_WEBOS }, function (r) {
          if (r && r.timestamp != null) luna("luna://com.webos.service.tvpower/power/responseScreenSaverRequest",
            { clientName: APP_ID_WEBOS, ack: false, timestamp: r.timestamp });
        });
    }
  }
  keepAwake();

  // ---------------------------------------------------------------- 6. back from a long time hidden
  var hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    keepAwake();
    if (hiddenAt && Date.now() - hiddenAt > HIDDEN_RELOAD_MS) reopen("long-hidden");
    hiddenAt = 0;
  });

  log("armed: " + window.VP_TV_APP.marker);
})();
