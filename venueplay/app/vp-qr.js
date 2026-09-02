/* ONE QR CODE DRAWER, one argument order.

   There were five functions called drawQR and they did not agree on what their
   own arguments meant:

     tv.html          drawQR(el, url, size)
     signage.html     drawQR(el, url, px)
     musical/screen   drawQR(el, size, url)     <- url and size the other way round
     trivia/screen    drawQR(el2, size, url)    <- and again

   Two orders under one name is worse than two names. Move a working call from
   the bingo TV to the musical screen, which is exactly the sort of thing that
   happens when a fix has to be applied in four places, and it quietly renders a
   QR code of the string "220". It scans. It goes nowhere.

   (see-a-night.html also has a drawQR, but it draws a FAKE code out of a seeded
   random pattern for the marketing demo. Same name, unrelated job, left alone.)

   VPQR.draw(el, url, size, opts)   opts.margin  quiet zone, default 1
                                    opts.level   error correction, default 'M'
   Silent when the library or the element is not there: a screen missing its QR
   is a bad night, a screen throwing on every repaint is a black one. */
(function (root) {
  "use strict";

  function draw(el, url, size, opts) {
    if (!root.QRCode || !el || !url) return;
    opts = opts || {};
    try {
      root.QRCode.toCanvas(el, url, {
        width: size,
        margin: opts.margin == null ? 1 : opts.margin,
        errorCorrectionLevel: opts.level || 'M',
        color: { dark: '#0A0A0B', light: '#ffffff' }
      }, function () {});
    } catch (e) {}
  }

  root.VPQR = { draw: draw };
})(typeof window !== "undefined" ? window : this);
