/* ============================================================================
   "9 PLAYERS LOVED TONIGHT": the room's ratings on the host's console, the one way (Dean, 1 Nov 2026).

   A venue sees only favourable feedback, as true counts: how many tapped "Loved it" and how many
   tapped "Good". Never "Not for me", never an average or a percentage (a share worked out from the
   good ones alone would mislead), and nothing at all when nobody has said either. HQ sees the rest.

   One read: GET /feedback/tally?session=<id> on the game Worker, which itself answers only
   { loved, good }. Loaded by the bingo console (index.html), musical/host.html and trivia/host.html.

     VPLoved.words({ loved: 9, good: 4 })  ->  "9 players loved tonight, and 4 said it was good."
     VPLoved.show(api, sessionId, el)      fills el (and unhides it) only when there is something to say
   ========================================================================== */
(function (root) {
  "use strict";
  function n(x) { x = parseInt(x, 10); return x > 0 ? x : 0; }
  function words(d) {
    var loved = n(d && d.loved), good = n(d && d.good);
    if (loved && good) return loved + (loved === 1 ? " player" : " players") + " loved tonight, and " + good + " said it was good.";
    if (loved) return loved + (loved === 1 ? " player" : " players") + " loved tonight.";
    if (good) return good + (good === 1 ? " player said" : " players said") + " tonight was good.";
    return "";
  }
  function show(api, sessionId, el) {
    if (!el || !sessionId || typeof fetch !== "function") return Promise.resolve("");
    return fetch(api + "/feedback/tally?session=" + encodeURIComponent(sessionId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var w = words(d || {});
        el.textContent = w;
        if (el.classList) el.classList.toggle("hidden", !w);
        if (!w && el.style) el.style.display = "none"; else if (el.style) el.style.display = "";
        return w;
      })
      .catch(function () { return ""; });
  }
  root.VPLoved = { words: words, show: show };
})(window);
