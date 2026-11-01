/* vp-connbar.js  -- THE PHONE'S CONNECTION, AS A DOT, AND A BAR ONLY WHEN IT MATTERS. ONE ANSWER, EVERY PHONE.

   Dean, 1 Nov 2026: the "Connected" line under the logo pushed the game down on every phone. So the line
   becomes a small dot beside the venueplay mark (green when the phone is talking to the host, amber
   otherwise), and a slim "Reconnecting..." bar hangs under the header ONLY while the phone has lost the
   game, and goes the moment it is back. The bar sits over the page rather than in it, so nothing moves
   when it comes and goes.

   Every phone page already writes its state into #statusText ("Connected", "Reconnecting", "Waiting for
   the host"...) from a dozen places, and #statusDot is already green or not. This file does not ask the
   pages to change any of that: it watches #statusText and follows it, so a page that says
   "Reconnecting" from anywhere shows the bar, and one that says anything else hides it. The words stay
   in the page for screen readers and as the dot's tooltip; they are just no longer a line of their own.

   Loaded by venueplay/play.html (bingo), app/trivia/play.html and app/musical/play.html, which put
   #statusLine inside .brand. The look lives here, once, not in three copies. ES5, no dependencies.
   The observer watches text only (never attributes), and writes only to other elements, so nothing it
   does can wake it again. */
(function (root) {
  "use strict";
  var CSS =
    /* The brand row hugs the mark (it was the full header width, so the dot hung at the far right, under
       the menu button), and stays centred. */
    ".brand{position:relative;width:-webkit-fit-content;width:fit-content;margin-left:auto;margin-right:auto}" +
    /* The dot hangs just right of the mark, out of the flow, so the mark stays centred. */
    ".brand .venue{position:absolute;left:100%;top:50%;transform:translateY(-50%);margin:0 0 0 8px;gap:0}" +
    ".brand .venue .dot{width:8px;height:8px}" +
    /* The words: kept for screen readers, not drawn. */
    ".brand .venue #statusText{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
    ".vp-connbar{position:absolute;left:0;right:0;top:100%;display:flex;align-items:center;justify-content:center;gap:7px;" +
      "height:26px;font:600 12px/1 'Hanken Grotesk',system-ui,-apple-system,sans-serif;letter-spacing:.02em;color:#FFD27A;" +
      "background:rgba(40,28,6,.94);border-bottom:1px solid rgba(255,176,32,.35);pointer-events:none;z-index:9}" +
    ".vp-connbar[hidden]{display:none}" +
    ".vp-connbar i{width:7px;height:7px;border-radius:50%;background:#FFB020;box-shadow:0 0 8px #FFB020;animation:vpConnPulse 1.2s ease-in-out infinite}" +
    "@keyframes vpConnPulse{0%,100%{opacity:1}50%{opacity:.35}}" +
    "@media (prefers-reduced-motion: reduce){.vp-connbar i{animation:none}}" +
    "body.light .vp-connbar{background:rgba(255,244,222,.97);color:#8A5A00;border-bottom-color:rgba(176,112,0,.3)}";

  function isDown(text) { return /^\s*reconnecting/i.test(String(text || "")); }

  function init() {
    var d = root.document;
    if (!d || !d.getElementById) return null;
    var text = d.getElementById("statusText"), dot = d.getElementById("statusDot");
    if (!text || !dot) return null;
    if (d.getElementById("vpConnBar")) return d.getElementById("vpConnBar");
    try {
      var st = d.createElement("style");
      st.id = "vpConnBarCss";
      st.textContent = CSS;
      (d.head || d.documentElement).appendChild(st);
    } catch (e) {}
    var top = (d.querySelector && d.querySelector(".ptop")) || d.body;
    var bar = d.createElement("div");
    bar.id = "vpConnBar";
    bar.className = "vp-connbar";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.hidden = true;
    var i = d.createElement("i");
    var w = d.createElement("span");
    w.textContent = "Reconnecting…";
    bar.appendChild(i); bar.appendChild(w);
    top.appendChild(bar);
    function sync() {
      var t = String(text.textContent || "").trim();
      bar.hidden = !isDown(t);
      try { dot.setAttribute("title", t); dot.setAttribute("aria-label", t); dot.setAttribute("role", "img"); } catch (e) {}
    }
    try {
      if (typeof root.MutationObserver === "function") {
        new root.MutationObserver(sync).observe(text, { childList: true, characterData: true, subtree: true });
      }
    } catch (e) {}
    sync();
    return bar;
  }

  root.VPConnBar = { init: init, isDown: isDown };
  try {
    if (root.document && root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init);
    else init();
  } catch (e) {}
})(typeof window !== "undefined" ? window : this);
