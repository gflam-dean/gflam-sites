/* Shrinking a photo in the browser before it goes anywhere.
 *
 * This is the whole reason the album is affordable. A modern phone photo is
 * around 3.2 MB; at 1600px on the long edge and JPEG 0.85 it is about 300 KB and
 * still looks right on a television and in a 6x4 print. Sixty photos a party goes
 * from 192 MB to 18 MB.
 *
 * It also fixes the thing that actually breaks uploads at parties: forty phones
 * on one house wifi, each trying to push 3 MB. Small files finish. Big ones sit
 * at 90% and the guest gives up and stops using the product.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPhoto = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_EDGE = 1600;
  var QUALITY = 0.85;
  var HARD_LIMIT = 5 * 1024 * 1024;

  function targetSize(w, h, maxEdge) {
    maxEdge = maxEdge || MAX_EDGE;
    if (w <= maxEdge && h <= maxEdge) return { w: w, h: h, scaled: false };
    var r = w > h ? maxEdge / w : maxEdge / h;
    return { w: Math.round(w * r), h: Math.round(h * r), scaled: true };
  }

  function niceSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* Resolves to a Blob ready to send. Rejects with something a person can read,
     because "NotReadableError" on a phone at a party helps nobody. */
  function shrink(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('That is not a photo.')); return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var t = targetSize(img.naturalWidth, img.naturalHeight, opts.maxEdge);
          var c = document.createElement('canvas');
          c.width = t.w; c.height = t.h;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, t.w, t.h);
          c.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (!blob) { reject(new Error('That photo would not open. Try another.')); return; }
            /* A photo that is somehow still enormous is sent anyway if it fits,
               and refused clearly if it does not. Better than silently dropping. */
            if (blob.size > HARD_LIMIT) { reject(new Error('That photo is too big to send.')); return; }
            resolve(blob);
          }, 'image/jpeg', opts.quality || QUALITY);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('That photo would not open. Try another.'));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That photo would not open. Try another.'));
      };
      img.src = url;
    });
  }

  return { shrink: shrink, targetSize: targetSize, niceSize: niceSize,
           MAX_EDGE: MAX_EDGE, QUALITY: QUALITY, HARD_LIMIT: HARD_LIMIT };
}));
