/* vp-trusted.js  -- THE "TRUSTED BY" STRIP ON THE MARKETING PAGES.

   Dean, 7 Aug 2026: a slow scroll of the logos of venues already running VenuePlay. Since
   20 Oct 2026 (migration 111) HQ chooses who is on it: "I dont want a venue to be able to put it
   on our website we should choose". The billing Worker's GET /trusted-logos answers the venues
   HQ switched on (HQ > Venues > Details > "Show logo on our website") that are active, have a
   logo they uploaded, and are not a test venue, with names and logo addresses and nothing else.

   This file decides only how it LOOKS, and whether it shows at all: fewer than MIN logos and the
   whole section stays hidden, so the homepage never shows one lonely logo in a long strip.

   One copy for index.html AND nsw.html. It used to be inline on index.html only, reading a
   database view straight from the browser; nsw.html had no strip. Both pages now load this and
   call VPTrusted.load(VP_WORKER), so the two cannot drift.

   Motion: CSS only, about six seconds per logo so it is slow whatever the count, pauses under the
   mouse, and stands still (wrapped and centred) for anyone who asked for reduced motion. */
(function (w, d) {
  "use strict";

  var MIN = 6;          /* below this, show nothing */
  var MAX = 60;

  var CSS =
    "#trusted .marquee{overflow:hidden;position:relative;margin-top:22px;" +
      "-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);" +
      "mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}" +
    "#trusted .track{display:flex;gap:48px;align-items:center;width:max-content;animation:vpTrustedScroll 45s linear infinite}" +
    "#trusted .marquee:hover .track{animation-play-state:paused}" +
    "#trusted .trustedlogo{height:64px;width:auto;max-width:210px;object-fit:contain;opacity:.9;flex:none}" +
    "@keyframes vpTrustedScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}" +
    "@media(prefers-reduced-motion:reduce){#trusted .track{animation:none;flex-wrap:wrap;justify-content:center;width:auto}" +
      "#trusted .track [aria-hidden=true]{display:none}}";

  /* Only what can be drawn: an https address and a name. Anything else is dropped, never
     painted, because these strings came from venues. */
  function usable(rows) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length && out.length < MAX; i++) {
      var r = rows[i];
      if (!r || typeof r.logo_url !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(r.logo_url)) continue;
      out.push({ name: String(r.name == null ? "" : r.name).slice(0, 120), logo_url: r.logo_url });
    }
    return out;
  }

  function addStyle() {
    if (d.getElementById("vpTrustedCss")) return;
    var st = d.createElement("style");
    st.id = "vpTrustedCss";
    st.textContent = CSS;
    (d.head || d.body).appendChild(st);
  }

  /* Paint the strip, or hide it. Returns how many logos are showing (0 = hidden). Built from
     nodes, not markup, so a venue's name or address can never become HTML. */
  function render(rows, section, track) {
    var list = usable(rows);
    if (!section || !track) return 0;
    if (list.length < MIN) { section.style.display = "none"; return 0; }
    addStyle();
    while (track.firstChild) track.removeChild(track.firstChild);
    /* Two copies back to back, and the animation moves exactly half the width, so the loop
       has no seam. The second copy is hidden from screen readers so each venue is read once. */
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < list.length; i++) {
        var img = d.createElement("img");
        img.className = "trustedlogo";
        img.src = list[i].logo_url;
        img.alt = pass ? "" : list[i].name;
        img.loading = "lazy";
        if (pass) img.setAttribute("aria-hidden", "true");
        track.appendChild(img);
      }
    }
    track.style.animationDuration = (list.length * 6) + "s";
    section.style.display = "";
    return list.length;
  }

  function load(worker) {
    var section = d.getElementById("trusted"), track = d.getElementById("trustedTrack");
    if (!section || !track || typeof w.fetch !== "function" || !worker) return Promise.resolve(0);
    return w.fetch(String(worker).replace(/\/+$/, "") + "/trusted-logos")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return render(j && j.logos, section, track); })
      .catch(function () { return render([], section, track); });
  }

  w.VPTrusted = { MIN: MIN, usable: usable, render: render, load: load };
})(window, document);
