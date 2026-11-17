/* THE TWO BANK COUNTS ON THE SALES PAGES, READ LIVE (Dean, 11 Nov 2026, INBOX 233.1).

   The homepage said "39,392 questions" while the database held 39,412, and "6,740 songs", because both
   numbers were typed: into the page, and into /data/trivia-count.json and /data/music-count.json, which
   somebody had to remember to regenerate. Now the billing Worker's GET /library-counts answers them
   (vpbLibraryCounts: library questions counted in the database, songs counted in the library every host
   console plays from), cached for ten minutes like /trusted-logos, and this file paints them.

   Every element with data-vp-count="questions" or data-vp-count="songs" gets the live number, set once
   (no roll-up: Dean, 7 Nov 2026, the number "flicked up"). The element's own text is the FALLBACK and it
   is words, never a number ("Thousands"), so a page whose Worker is down, slow or answers nonsense still
   reads as a finished sentence: never blank, never NaN, never a stale figure. Index.html and nsw.html
   (every /offer-<month> page) both load this one file.

   Run by tools/test-library-counts.js against a small DOM. */
(function (w, d) {
  "use strict";
  var MAX = 10000000;   // a count past ten million is not a count, it is a fault
  /* UNDER A THOUSAND IS A FAULT TOO (16 Nov 2026). The words beside the number are "questions and counting"
     and the fallback says "Thousands"; the real banks hold tens of thousands. A count under 1,000 means the
     library lost most of its sets (or this is the test database, which holds 10 questions), so the page keeps
     its words rather than telling a pub we have "10 questions". */
  var MIN = 1000;

  function good(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= MIN && n < MAX; }

  function paint(counts) {
    var shown = 0, els = d.querySelectorAll ? d.querySelectorAll("[data-vp-count]") : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], key = el.getAttribute("data-vp-count");
      var n = counts && (key === "questions" ? counts.questions : key === "songs" ? counts.songs : null);
      if (!good(n)) continue;          // the fallback words stay
      el.textContent = n.toLocaleString("en-AU");
      shown++;
    }
    return shown;
  }

  function load(worker) {
    if (!w.fetch || !worker) return Promise.resolve(0);
    return w.fetch(String(worker).replace(/\/+$/, "") + "/library-counts")
      .then(function (r) { if (!r || !r.ok) throw new Error("http " + (r && r.status)); return r.json(); })
      .then(function (j) { return paint(j || {}); })
      .catch(function () { return 0; });
  }

  w.VPCounts = { load: load, paint: paint, good: good };
})(window, document);
