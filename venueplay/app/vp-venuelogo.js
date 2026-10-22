/* vp-venuelogo.js -- HOW BIG A VENUE'S LOGO IS DRAWN, IN ONE PLACE.

   Dean, 21 Oct 2026: "their logo on their normal games seems to be a bit small so I think we
   should be able to make it a bit bigger if it's a square rather than a rectangle".

   THE FAULT. Every screen drew the logo in one fixed box: 120 x 56 pixels on the TV, 30 pixels
   tall on the phone. A box that shape is sized for a WIDE logo, so a square or round crest (Tugun
   Bowls Club's, Deepwater's) hit the height first and came out 56 x 56 on a 1920 television, under
   3% of the screen's width, while a wordmark of the same venue got 120 x 30. Same venue, same
   corner, half the ink.

   THE RULE. A logo is given the same AREA whatever its shape, then held inside a few limits:
     - equal area: width = sqrt(area x ratio), height = sqrt(area / ratio), so a square logo is
       square and a 4:1 wordmark is long and short, and the two weigh about the same on screen
     - a ceiling on the height, so a tall logo cannot run down the side of the wall
     - a ceiling on the width, so a very wide one cannot reach the middle of the screen
     - a floor on the height, so a very wide one still has letters big enough to read (unless
       the width ceiling forbids it)
   The TV sizes are fractions of the screen, so a 1280 Fire Stick and a 1920 telly look the same;
   the phone sizes are pixels, because a phone header is pixels.

   NOTHING ELSE MOVES FOR IT. The TV logo is a data-fit-avoid keep-out, and /app/vp-fit.js moves
   and scales the wall out from under it, so a bigger logo can never sit on a called number, the
   join code or the question. After a logo is sized, VP_FIT() is asked to re-measure straight away
   rather than on its next 1.5 second tick.

   USED BY: tv.html (bingo, and the TV between games) and app/trivia, musical, raffle and members
   screen.html, each of which makes its own fixed <img id="venueLogo"> in the top-left corner and
   then calls VPVenueLogo.fit(el, "tv"); and play.html, app/trivia/play.html and app/musical/
   play.html, which call VPVenueLogo.fit(img, "phone") on the logo in their header. The box those
   pages give the logo before this runs (120 x 56 on the TV, 30 tall on the phone) is only what
   shows if this file never arrives. tools/test-tv-logo-mark.js runs box() and every page's
   painter against this file; tools/venue-logo-in-chrome.test.py measures the painted logo
   against the wall in a real browser. */
(function (w, d) {
  "use strict";

  /* The limits. TV numbers are fractions of the screen's width (W) and height (H). */
  var TV = {
    side: 0.07,      /* a square logo is 7% of the screen wide: 134px on a 1920 TV (it was 56) */
    maxW: 0.15,      /* a wordmark stops at 15% of the width: 288px at 1920 */
    maxH: 0.13,      /* nothing taller than 13% of the height: 140px at 1080 */
    minH: 0.035,     /* a wordmark is at least 3.5% of the height tall (38px at 1080) */
    inset: 0.012     /* in from the corner: 23px at 1920, never under 14px */
  };
  var PHONE = { side: 56, maxW: 170, maxWvw: 0.5, maxH: 60, minH: 28 };   /* a square logo 56px (it was 30); a 4:1 wordmark 112 x 28 */

  /* Pure arithmetic: the box a logo of natural size nw x nh is drawn in, for limits L
     ({side, maxW, maxH, minH} in pixels). No natural size yet (the picture has not arrived) is
     treated as 2:1, the middle of the shapes venues actually upload. */
  function box(nw, nh, L) {
    var r = (nw > 0 && nh > 0) ? nw / nh : 2;
    var area = L.side * L.side;
    var bw = Math.sqrt(area * r), bh = Math.sqrt(area / r);
    if (bh > L.maxH) { bh = L.maxH; bw = bh * r; }
    if (bw > L.maxW) { bw = L.maxW; bh = bw / r; }
    if (bh < L.minH) { bh = Math.min(L.minH, L.maxW / r); bw = bh * r; }
    return { w: Math.round(bw), h: Math.round(bh) };
  }

  /* The limits, in pixels, for a screen of W x H (kind "tv") or a phone W wide (kind "phone"). */
  function limits(kind, W, H) {
    if (kind === "phone") {
      return { side: PHONE.side, maxH: PHONE.maxH, minH: PHONE.minH,
               maxW: Math.min(PHONE.maxW, Math.round((W || 390) * PHONE.maxWvw)) };
    }
    W = W || 1920; H = H || 1080;
    return { side: TV.side * W, maxW: TV.maxW * W, maxH: TV.maxH * H, minH: TV.minH * H,
             inset: Math.max(14, Math.round(TV.inset * W)) };
  }

  function size(img, kind) {
    var W = w.innerWidth || (d.documentElement && d.documentElement.clientWidth) || 0;
    var H = w.innerHeight || (d.documentElement && d.documentElement.clientHeight) || 0;
    var L = limits(kind, W, H);
    var b = box(img.naturalWidth || 0, img.naturalHeight || 0, L);
    var s = img.style;
    s.width = b.w + "px"; s.height = b.h + "px";
    s.maxWidth = b.w + "px"; s.maxHeight = b.h + "px";
    s.objectFit = "contain";
    if (kind !== "phone") { s.top = L.inset + "px"; s.left = L.inset + "px"; }
    try { if (w.VP_FIT) w.VP_FIT(); } catch (e) {}
    return b;
  }

  /* TRUE COLOURS, AND A BACKING ONLY WHEN THE LOGO WOULD VANISH (Dean, 21 Oct 2026: the logo "shows
     stark bright white"). Nothing here or on any screen filters, brightens, inverts or swaps a venue's
     logo: the only filter on the TV mark is a soft drop shadow, and Tugun's and Deepwater's own files ARE
     white artwork on a see-through background, so white is their true colour. What a dark screen cannot
     show is the opposite case, a black or navy logo on see-through, which disappears into the wall. So:
     read how light the logo's visible pixels are, and only if it is dark give it a pale plate behind.

     lightness(rgba) is the arithmetic, on a flat RGBA array: the average lightness (0 black, 1 white) of
     the pixels that are actually painted (alpha over a quarter), or null when nothing is. */
  function lightness(rgba) {
    var sum = 0, n = 0;
    for (var i = 0; i + 3 < rgba.length; i += 4) {
      var a = rgba[i + 3] / 255;
      if (a < 0.25) continue;
      sum += a * (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255; n += a;
    }
    return n ? sum / n : null;
  }
  var DARK = 0.18;   /* black, navy and charcoal get a plate; pure red (0.21) and every mid colour do not */

  /* Read the logo's pixels from a SEPARATE copy of the picture, asked for with CORS. The one on screen
     is never touched: a storage server that does not answer CORS just means no reading (cb gets null),
     and the logo shows exactly as before. readTone is also what the printed signs use
     (venueplay/signage.html), where the danger is the other way round: a WHITE logo on white paper. */
  function readTone(src, cb) {
    try {
      var probe = new w.Image();
      probe.crossOrigin = "anonymous";
      probe.onload = function () {
        var L = null, S = null;
        try {
          var c = d.createElement("canvas"); c.width = 48; c.height = 48;
          var x = c.getContext("2d"); x.drawImage(probe, 0, 0, 48, 48);
          var px = x.getImageData(0, 0, 48, 48).data;
          L = lightness(px); S = lightShare(px);
        } catch (e) { L = null; S = null; }
        cb(L, S);
      };
      probe.onerror = function () { cb(null, null); };
      probe.src = src;
    } catch (e) { cb(null, null); }
  }
  /* ON WHITE PAPER the question is not the average but how much of the ink is (near) white: Tugun's
     crest is white ribbons with black lettering, and the ribbons are what vanish. lightShare(rgba) is the
     share of the painted pixels that are lighter than 0.85, or null when nothing is painted. Measured
     22 Oct 2026: Deepwater's white recolour 1.0, Tugun's crest 0.83, a pure yellow 1.0; gold (0.78
     lightness) 0, red, navy, grey and black 0. Over LIGHT, the printed sign puts the logo on a dark plate. */
  function lightShare(rgba) {
    var light = 0, n = 0;
    for (var i = 0; i + 3 < rgba.length; i += 4) {
      var a = rgba[i + 3] / 255;
      if (a < 0.25) continue;
      if ((0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255 > 0.85) light += a;
      n += a;
    }
    return n ? light / n : null;
  }
  var LIGHT = 0.5;

  /* THE PRINTED SIGNS' ONE RULE FOR SHAPE (Dean, 23 Oct 2026: "as long as there's a system for when it
     does that"). A logo whose TRIMMED width is at least BAND_RATIO times its height is a wordmark: on the
     Column sign it moves from the right-hand column to a band across the top, and a venue that has not
     chosen a design gets the Top band sign. Narrower than that it is a badge, crest or stacked logo and
     stays in the column. One number, used by every sheet (poster, cards, tents) and by the default. */
  var BAND_RATIO = 2.2;
  function isWide(ratio) { return ratio >= BAND_RATIO; }

  /* analyse(src, cb): everything a printed sign needs to know about a logo, from ONE CORS read.
       ratio    width / height after see-through edges are trimmed (null if unreadable)
       trimmed  a PNG data URL of the logo without its see-through margin, so its size on the sign is
                the size of its ink, not of the canvas it was uploaded on (null if unreadable)
       boxed    the logo brings its own solid background (all four corners opaque): it is shown as a
                rounded card, never given a plate
       light    over half its ink is near white: it would vanish on white paper
       dark     its ink is dark (black, navy, charcoal): it would vanish on a black ground
     A logo that cannot be read (no CORS) gives cb(null) and is printed exactly as uploaded. */
  function analyse(src, cb) {
    try {
      var probe = new w.Image();
      probe.crossOrigin = "anonymous";
      probe.onload = function () {
        var out = null;
        try {
          var W = probe.naturalWidth, H = probe.naturalHeight, k = Math.min(1, 1000 / Math.max(W, H));
          var cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k));
          var c = d.createElement("canvas"); c.width = cw; c.height = ch;
          var x = c.getContext("2d"); x.drawImage(probe, 0, 0, cw, ch);
          var px = x.getImageData(0, 0, cw, ch).data;
          var A = function (i, j) { return px[(j * cw + i) * 4 + 3]; };
          var l = cw, t = ch, r = -1, b = -1, i, j;
          for (j = 0; j < ch; j++) for (i = 0; i < cw; i++) {
              if (px[(j * cw + i) * 4 + 3] > 25) { if (i < l) l = i; if (i > r) r = i; if (j < t) t = j; if (j > b) b = j; }
          }
          /* boxed: solid just inside all four corners of its ink (6% in, so a card with rounded corners
             counts and a round crest, whose corners are see-through, does not) */
          var ix = Math.round((r - l) * 0.06), iy = Math.round((b - t) * 0.06);
          var boxed = r > l && b > t && A(l + ix, t + iy) > 200 && A(r - ix, t + iy) > 200 && A(l + ix, b - iy) > 200 && A(r - ix, b - iy) > 200;
          if (r >= l && b >= t) {
            var tw = r - l + 1, th = b - t + 1, tc = d.createElement("canvas"); tc.width = tw; tc.height = th;
            tc.getContext("2d").drawImage(c, l, t, tw, th, 0, 0, tw, th);
            var L = lightness(px), S = lightShare(px);
            /* boxed: judge the INK, not the box it sits on, for light and dark */
            out = { ratio: tw / th, trimmed: tc.toDataURL("image/png"), boxed: boxed, L: L, share: S,
                    light: !boxed && S !== null && S > LIGHT,
                    dark: !boxed && L !== null && L < 0.35 && S !== null && S < 0.3 };
          }
        } catch (e) { out = null; }
        cb(out);
      };
      probe.onerror = function () { cb(null); };
      probe.src = src;
    } catch (e) { cb(null); }
  }
  function backing(img, kind) {
    var src = img.currentSrc || img.src;
    if (!src || img.__vpToneFor === src) return;
    img.__vpToneFor = src;
    readTone(src, function (L) {
      if ((img.currentSrc || img.src) !== src) return;          /* a newer logo has replaced it */
      plate(img, L !== null && L < DARK, kind);
    });
  }
  function plate(img, on, kind) {
    var s = img.style;
    img.setAttribute("data-backing", on ? "1" : "0");
    if (!on) { s.background = ""; s.padding = ""; s.borderRadius = ""; s.boxSizing = ""; }
    else {
      var p = Math.max(3, Math.round((parseFloat(s.height) || 40) * 0.07));
      s.boxSizing = "content-box"; s.padding = p + "px"; s.borderRadius = Math.round(p * 1.6) + "px";
      s.background = "rgba(255,255,255,.8)";
    }
    try { if (kind !== "phone" && w.VP_FIT) w.VP_FIT(); } catch (e) {}
  }

  /* Size this <img> now, again when its picture arrives (that is when its shape is known), and,
     on the TV, again when the screen changes size. Safe to call again on the same element. */
  function fit(img, kind) {
    if (!img) return null;
    kind = kind === "phone" ? "phone" : "tv";
    img.__vpLogoKind = kind;
    if (!img.__vpLogoWired) {
      img.__vpLogoWired = true;
      try { img.addEventListener("load", function () { size(img, img.__vpLogoKind); backing(img, img.__vpLogoKind); }); } catch (e) {}
      if (kind === "tv") {
        try { w.addEventListener("resize", function () { size(img, img.__vpLogoKind); }, { passive: true }); } catch (e) {}
      }
    }
    if (img.complete && img.naturalWidth) backing(img, kind);
    return size(img, kind);
  }

  w.VPVenueLogo = { box: box, limits: limits, fit: fit, lightness: lightness, lightShare: lightShare, readTone: readTone, analyse: analyse, isWide: isWide, BAND_RATIO: BAND_RATIO, DARK: DARK, LIGHT: LIGHT, TV: TV, PHONE: PHONE };
})(window, document);
