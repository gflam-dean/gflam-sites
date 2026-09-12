/* vp-fit.js  -- MAKE THE WALL FIT THE TELLY.

   THE FAULT, measured 13 Sep 2026 on the live trivia screen at 1920 wide:

     layer        content height     fits 1080?
     tvLobby         703px           yes
     tvQ            1020px           60px of slack, total
     tvReveal        468px           yes
     tvBoard         848px           yes
     tvPodium        947px           yes on paper

   Every size on these screens is in `cqw`, a container-query WIDTH unit. So the height
   of a wall is decided by how WIDE the television is and nothing ever checks whether the
   result fits. At 1920x1080 the question screen leaves 2.8% headroom. Televisions
   overscan by 3 to 5%. So it clips on a real telly, every time, and .tv{overflow:hidden}
   means it clips silently rather than scrolling.

   Dean, 13 Sep 2026: "TV doesnt look like it fits the whole screen in". In a browser
   window (1920x902) the question screen loses 59px off the top AND 59px off the bottom,
   which is how the podium ended up with WINNERS TONIGHT sliced in half.

   WHAT THIS DOES. After a layer is shown, measure what it actually painted. If it is
   taller or wider than the safe area, scale the layer down until it fits. Never scale UP:
   a wall that fits is already right, and enlarging it would undo the type hierarchy the
   designer chose.

   WHY A TRANSFORM AND NOT SMALLER FONTS. The layer is one centred flex column, so one
   transform on it shrinks the whole composition toward the middle and keeps every
   proportion. Reflowing type would re-wrap the question and change the line count, which
   changes the height, which changes the scale: a loop with no fixed point.

   OVERSCAN. Defaults to using the whole viewport, because a set-top box on a modern
   telly usually shows all of it. A venue whose TV crops the edges adds ?safe=5 to the
   screen link and loses 5% all round instead of losing the top of the question.

   NO ATTRIBUTE OBSERVER. Watching attributes while writing a style is an infinite loop,
   and it froze the renderer hard enough that Chrome could not screenshot it (28 Aug).
   This watches childList only, and will not write a transform it has already written. */
(function (w, d) {
  "use strict";

  var SAFE = 0;                                   /* per-cent inset, from ?safe= */
  try {
    var q = new RegExp("[?&]safe=(\\d{1,2})").exec(w.location.search || "");
    if (q) SAFE = Math.max(0, Math.min(20, parseInt(q[1], 10) || 0));
  } catch (e) {}

  var applied = {};                               /* id -> last scale written */

  function visibleLayers() {
    var out = [], all = d.querySelectorAll(".layer");
    for (var i = 0; i < all.length; i++) {
      var l = all[i];
      if (l.classList.contains("hidden")) continue;
      if (l.offsetParent === null && getComputedStyle(l).position !== "fixed") continue;
      out.push(l);
    }
    return out;
  }

  /* What did this layer actually paint? Measure the children, not the box: the box is
     inset:0 and always exactly the viewport, which tells us nothing. */
  function contentBox(layer) {
    var top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity, found = false;
    var kids = layer.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList && k.classList.contains("hidden")) continue;
      var cs = getComputedStyle(k);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var b = k.getBoundingClientRect();
      if (!b.height && !b.width) continue;
      found = true;
      if (b.top < top) top = b.top;
      if (b.bottom > bottom) bottom = b.bottom;
      if (b.left < left) left = b.left;
      if (b.right > right) right = b.right;
    }
    return found ? { h: bottom - top, w: right - left } : null;
  }

  function fitOne(layer) {
    var prev = applied[layer.id] || 1;

    /* Measure UNSCALED, or every pass would measure its own last answer and creep. */
    if (prev !== 1) {
      layer.style.transform = "";
      layer.offsetHeight;                          /* force the layout to settle */
    }

    var box = contentBox(layer);
    if (!box || box.h <= 0) { layer.style.transform = ""; applied[layer.id] = 1; return; }

    var inset = SAFE / 100;
    var availH = w.innerHeight * (1 - inset * 2);
    var availW = w.innerWidth * (1 - inset * 2);

    var scale = Math.min(availH / box.h, availW / box.w, 1);
    scale = Math.floor(scale * 1000) / 1000;       /* stop sub-pixel jitter re-writing */
    if (scale > 0.999) scale = 1;
    if (scale < 0.4) scale = 0.4;                  /* something is wrong; do not vanish */

    if (scale === prev) {                          /* already right: write nothing */
      if (scale !== 1) layer.style.transform = "scale(" + scale + ")";
      return;
    }

    if (scale === 1) layer.style.transform = "";
    else {
      layer.style.transformOrigin = "center center";
      layer.style.transform = "scale(" + scale + ")";
    }
    applied[layer.id] = scale;
  }

  /* SCHEDULING, AND WHY IT IS NOT JUST requestAnimationFrame.

     It was, and it deadlocked. A hidden tab never fires rAF, so `queued` was set to
     true and never cleared, and the fitter stopped for good: every later call returned
     at the guard. Found 13 Sep 2026 checking the deployed file on a background tab,
     which is also what a Fire Stick does when the launcher comes forward. A wall that
     silently stops fitting looks exactly like a wall that never fitted.

     So: ask for a frame, but also arm a timer. Whichever arrives first does the work
     and disarms the other. Nothing can leave the flag stuck. */
  var queued = false, fallbackId = 0;
  function runFit() {
    if (!queued) return;
    queued = false;
    if (fallbackId) { w.clearTimeout(fallbackId); fallbackId = 0; }
    var ls = visibleLayers();
    for (var i = 0; i < ls.length; i++) fitOne(ls[i]);
  }
  function fit() {
    if (queued) return;
    queued = true;
    try { w.requestAnimationFrame(runFit); } catch (e) {}
    fallbackId = w.setTimeout(runFit, 60);
  }

  w.VP_FIT = fit;

  function start() {
    fit();
    /* Web fonts land after first paint and change every measurement. */
    if (d.fonts && d.fonts.ready && d.fonts.ready.then) d.fonts.ready.then(fit);

    w.addEventListener("resize", fit, { passive: true });
    w.addEventListener("orientationchange", fit, { passive: true });

    /* A wall is put on air by toggling .hidden, which is a CLASS change. childList
       cannot see it, so the first version only caught it on the 1500ms safety tick:
       up to a second and a half of clipped question on screen at the exact moment the
       room is reading it. Measured on the live page, tvQ sat at 1020px with no
       transform while it was on air.

       attributeFilter is what makes this safe. The 28 Aug freeze was an observer
       watching ALL attributes while the callback wrote a style, and `style` is an
       attribute, so each write re-entered the observer. This watches "class" only, and
       this file never writes a class. Writing style.transform cannot retrigger it. */
    try {
      var mo = new MutationObserver(fit);
      var all = d.querySelectorAll(".layer");
      for (var i = 0; i < all.length; i++) {
        mo.observe(all[i], { childList: true, subtree: true, characterData: true,
                             attributes: true, attributeFilter: ["class"] });
      }
      /* and the parent, for a layer added after load */
      var tv = d.querySelector(".tv");
      if (tv) mo.observe(tv, { childList: true });
    } catch (e) {}

    /* Backstop only now, not the primary path. A screen runs unattended all night and
       measuring is cheap. */
    w.setInterval(fit, 1500);

    /* Coming back from hidden: re-measure, because anything queued while the tab was
       backgrounded may have been throttled. */
    d.addEventListener("visibilitychange", function () { if (!d.hidden) fit(); });
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start);
  else start();
})(window, document);
