/* A VENUE'S LOGO, MADE TO FIT BEFORE IT IS SENT (Dean, 19 Oct 2026: "over 1 MB" error; wants the
 * background taken off automatically).
 *
 * The billing Worker takes a PNG or a WebP of 1 MB or less (/account/logo-upload, VPB_MAX_LOGO_BYTES)
 * and judges the type by the bytes. A phone photo of a sign, or a logo exported from Canva at print
 * size, is 2 to 8 MB, and the page used to refuse it and tell a publican to "save a smaller PNG",
 * which is a job they have no tool for. So the browser does it:
 *
 *   load(file)                 any image the browser can open (PNG, JPG, WebP, HEIC on an iPhone),
 *                              turned the right way up
 *   toCanvas(img, maxSide)     scaled to fit MAX_SIDE (1200px) on its longest side, never enlarged
 *   removeBackground(id, tol)  a flat or near-flat background, taken off by flood fill from the
 *                              EDGES only: a white logo on white keeps the white inside its letters
 *                              (the inside of an O never touches the edge). tol is 0 to 100.
 *   encode(canvas)             PNG when anything is see-through (it stays a PNG), otherwise WebP;
 *                              made smaller step by step until it is under MAX_BYTES. A browser
 *                              that cannot write WebP (older Safari) gets a PNG, shrunk to fit.
 *
 * Nothing here talks to the network. It is plain functions so the test can run them on known
 * pixels in a real browser (tools/logo-tools-in-chrome.test.py).
 */
(function (root) {
  'use strict';

  var MAX_SIDE = 1200;
  // The Worker allows 1,048,576 bytes. Stay clear of it: a file 3 bytes under is still a file
  // that one changed header could push over.
  var MAX_BYTES = 950 * 1024;
  var MIN_SIDE = 200;   // never shrink below this to make it fit; the Worker wants 16+, a TV wants more

  function load(file) {
    if (root.createImageBitmap) {
      return root.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can open.')); };
      img.src = url;
    });
  }

  function size(img) { return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }; }

  function toCanvas(img, maxSide) {
    var s = size(img), m = maxSide || MAX_SIDE;
    var k = Math.min(1, m / Math.max(s.w, s.h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.w * k));
    c.height = Math.max(1, Math.round(s.h * k));
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function hasAlpha(id) {
    var d = id.data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  /* The background is the colour most of the border agrees on: border pixels are bucketed by
     colour (16 levels a channel) and the biggest bucket wins, then averaged, so a logo that
     touches one edge does not drag the guess towards itself. */
  function borderColour(id) {
    var w = id.width, h = id.height, d = id.data, buckets = {}, best = null;
    function take(x, y) {
      var i = (y * w + x) * 4;
      if (d[i + 3] < 16) return;   // already see-through: not a colour to remove
      var key = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4);
      var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
      if (!best || b.n > best.n) best = b;
    }
    for (var x = 0; x < w; x++) { take(x, 0); take(x, h - 1); }
    for (var y = 1; y < h - 1; y++) { take(0, y); take(w - 1, y); }
    if (!best) return null;
    return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, share: best.n / (2 * w + 2 * Math.max(0, h - 2)) };
  }

  /* Returns { image: ImageData (a copy), removed: pixels made see-through, bg: the colour taken,
     share: how much of the border was that colour }. tolerance 0..100: 0 takes only that exact
     colour, 100 takes anything within a wide margin of it. The edge of what is kept is softened
     over a few levels so the cut does not look like a jagged sticker. */
  function removeBackground(src, tolerance) {
    var w = src.width, h = src.height;
    var out = new ImageData(new Uint8ClampedArray(src.data), w, h);
    var d = out.data, bg = borderColour(src);
    if (!bg) return { image: out, removed: 0, bg: null, share: 0 };
    var tol = Math.max(0, Math.min(100, +tolerance || 0));
    var t = 6 + tol * 2.2;                       // RGB distance 6 (exact, allowing for JPEG noise) to 226
    var t2 = t * t, feather = Math.max(10, t * 0.5);
    var seen = new Uint8Array(w * h), stack = new Int32Array(w * h), sp = 0, removed = 0;
    function dist2(p) {
      var i = p * 4, r = d[i] - bg.r, g = d[i + 1] - bg.g, b = d[i + 2] - bg.b;
      return r * r + g * g + b * b;
    }
    function push(p) {
      if (seen[p]) return;
      seen[p] = 1;
      if (d[p * 4 + 3] < 16 || dist2(p) <= t2) { seen[p] = 2; stack[sp++] = p; }
    }
    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      var p = stack[--sp], px = p % w;
      if (d[p * 4 + 3] !== 0) { d[p * 4 + 3] = 0; removed++; }
      if (px > 0) push(p - 1);
      if (px < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < w * (h - 1)) push(p + w);
    }
    // Soften the boundary: a kept pixel beside a removed one fades with how close it is to the
    // background colour.
    for (var q = 0; q < w * h; q++) {
      if (seen[q] === 2) continue;
      var qx = q % w;
      var edge = (qx > 0 && seen[q - 1] === 2) || (qx < w - 1 && seen[q + 1] === 2) ||
                 (q >= w && seen[q - w] === 2) || (q < w * (h - 1) && seen[q + w] === 2);
      if (!edge) continue;
      var k = (Math.sqrt(dist2(q)) - t) / feather;
      if (k < 1) d[q * 4 + 3] = Math.round(d[q * 4 + 3] * Math.max(0.15, k));
    }
    return { image: out, removed: removed, bg: bg, share: bg.share };
  }

  function dataUrlBytes(u) {
    var i = u.indexOf(','), b64 = i >= 0 ? u.slice(i + 1) : u;
    var pad = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
    return Math.floor(b64.length * 3 / 4) - pad;
  }

  function scaled(canvas, k) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * k));
    c.height = Math.max(1, Math.round(canvas.height * k));
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  /* Resolves { dataUrl, type, bytes, width, height, transparent }, or rejects with words a
     publican can act on. Synchronous encoders (toDataURL) on purpose: the canvas is at most
     1200px, and a Promise around it keeps the caller's shape the same if that ever changes. */
  function encode(canvas) {
    return new Promise(function (resolve, reject) {
      var see = hasAlpha(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
      var c = canvas, tries = 0;
      while (tries++ < 12) {
        var url = null, type = null;
        if (!see) {
          var qs = [0.9, 0.8, 0.7, 0.6];
          for (var i = 0; i < qs.length; i++) {
            var u = c.toDataURL('image/webp', qs[i]);
            if (u.indexOf('data:image/webp') !== 0) break;   // this browser cannot write WebP
            if (dataUrlBytes(u) <= MAX_BYTES) { url = u; type = 'image/webp'; break; }
            url = null;
          }
        }
        if (!url) {
          var p = c.toDataURL('image/png');
          if (dataUrlBytes(p) <= MAX_BYTES) { url = p; type = 'image/png'; }
        }
        if (url) {
          return resolve({ dataUrl: url, type: type, bytes: dataUrlBytes(url), width: c.width, height: c.height, transparent: see });
        }
        if (Math.max(c.width, c.height) <= MIN_SIDE) break;
        c = scaled(c, 0.8);
      }
      reject(new Error('That picture is too detailed to make small enough. Try a simpler logo file.'));
    });
  }

  root.VPLogo = { MAX_SIDE: MAX_SIDE, MAX_BYTES: MAX_BYTES, load: load, toCanvas: toCanvas, hasAlpha: hasAlpha,
                  borderColour: borderColour, removeBackground: removeBackground, encode: encode, dataUrlBytes: dataUrlBytes };
}(typeof window !== 'undefined' ? window : this));
