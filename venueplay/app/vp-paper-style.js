/* ONE LOOK FOR EVERYTHING venueplay PRINTS (Dean, INBOX 384/385, 14 Nov 2026). The musical bingo paper card uses it now and
   the trivia answer sheet uses it next, so the two look like one family. Black and white with grey tiles, and two shared parts:

   1. THE HEADER: a BLACK band, the title in white on the left, and the number big and black on a PINK block on the right
      (no word "Card" or "Sheet": the pink block says it is the number). head({...}) returns its HTML.
   2. THE PUB'S LOGO BOX: venue logos come square, tall and wide, so the logo goes in a FIXED box sized for the footer, CONTAINED
      (never stretched, never cut), as big as the box allows, centred top to bottom and starting on the box's left edge (where the
      frame's corner curve ends, INBOX 345). No logo, or one we cannot read: the venue's NAME in type in the same box.
      prepLogo(url) reads the picture once, gives back its real width and height, and applies the ink rule below.

   THE INK RULE (memory venue-logo-dark-to-light): only black and white ink ever change, and only so the logo shows on the paper
   under it. On white paper a logo made for a dark wall (light ink) has its WHITE ink printed black; on a dark band
   (opts.onDark) BLACK ink turns white. Every other colour is left exactly as the venue made it.

   Load it BEFORE /app/vp-print.js on any page that prints. Window: VPPaperStyle. */
(function () {
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  var CSS =
    '.vpp-head{display:flex;align-items:stretch;flex:none;background:#0A0A0B;color:#fff}' +
    '.vpp-head .vpp-hl{flex:1;min-width:0;padding:3.4mm 4mm 3.2mm}' +
    '.vpp-head .vpp-k{font-family:Manrope,Arial,sans-serif;font-weight:700;color:#C9C9D1;line-height:1.1}' +
    '.vpp-head .vpp-t{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:.95;letter-spacing:.005em;color:#fff;overflow-wrap:anywhere}' +
    '.vpp-num{flex:none;background:#FF1F8E;color:#0A0A0B;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm 2.5mm}' +
    '.vpp-num .vpp-n{font-family:Anton,Impact,sans-serif;font-weight:400;line-height:.92}' +
    '.vpp-num .vpp-sub{font-family:Manrope,Arial,sans-serif;font-weight:700;font-size:6.5pt;line-height:1.2;text-align:center;margin-top:1.2mm;color:#0A0A0B}' +
    '.vpp-logobox{flex:none;display:flex;align-items:center;justify-content:flex-start;overflow:hidden}' +
    '.vpp-logobox img{display:block;flex:none}' +
    '.vpp-logobox .vpp-vname{font:800 10pt "Hanken Grotesk",Arial,sans-serif;line-height:1.1;color:#0A0A0B;overflow-wrap:anywhere}';

  /* o: {kicker, title, titlePt, num, numPt, numW (mm), sub}. kicker/title/sub are plain text (escaped here). */
  function head(o) {
    o = o || {};
    return '<div class="vpp-head"><div class="vpp-hl">' +
      (o.kicker ? '<div class="vpp-k" style="font-size:8.5pt">' + esc(o.kicker) + '</div>' : '') +
      '<div class="vpp-t" style="font-size:' + (o.titlePt || 25) + 'pt;margin-top:.8mm">' + esc(o.title || '') + '</div></div>' +
      '<div class="vpp-num" style="width:' + (o.numW || 27) + 'mm"><div class="vpp-n" style="font-size:' + (o.numPt || 44) + 'pt">' + esc(o.num || '') + '</div>' +
      (o.sub ? '<div class="vpp-sub">' + esc(o.sub) + '</div>' : '') + '</div></div>';
  }

  /* The logo's drawn size inside a W x H mm box: the biggest that fits both ways, its own shape kept. */
  function fit(w, h, W, H) {
    if (!(w > 0 && h > 0)) return { w: W, h: H };
    var s = Math.min(W / w, H / h);
    return { w: +(w * s).toFixed(3), h: +(h * s).toFixed(3) };
  }

  /* logo: {url, w, h} from prepLogo, or null. box: {w, h} in mm. */
  function logoBox(logo, venue, box) {
    var W = box.w, H = box.h;
    var inner = '';
    if (logo && logo.url) {
      var f = fit(logo.w, logo.h, W, H);
      inner = '<img class="vpp-logo" alt="' + esc(venue || '') + '" src="' + esc(logo.url) + '" style="width:' + f.w + 'mm;height:' + f.h + 'mm">';
    } else if (venue) {
      inner = '<div class="vpp-vname">' + esc(venue) + '</div>';
    }
    return '<div class="vpp-logobox" style="width:' + W + 'mm;height:' + H + 'mm">' + inner + '</div>';
  }

  /* Read the picture, measure it, and apply the ink rule. Resolves {url, w, h, swapped} or null (no https logo, it failed, or
     it cannot be read: the caller prints the name). The picture is redrawn at up to 1200 px on its long side, plenty for print. */
  function prepLogo(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!/^(https:\/\/|data:image\/)/i.test(String(url || ''))) return resolve(null);
      var im = new Image(), t = setTimeout(function () { resolve(null); }, 5000);
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        clearTimeout(t);
        try {
          var nw = im.naturalWidth || 0, nh = im.naturalHeight || 0;
          if (!(nw > 0 && nh > 0)) return resolve(null);
          var k = Math.min(1, 1200 / Math.max(nw, nh)), W = Math.max(1, Math.round(nw * k)), H = Math.max(1, Math.round(nh * k));
          var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, W, H);
          var id = cx.getImageData(0, 0, W, H), px = id.data, sum = 0, n = 0, i;
          for (i = 0; i < px.length; i += 4) { if (px[i + 3] > 40) { sum += (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255; n++; } }
          var mean = n ? sum / n : 0;
          /* white paper: light ink (made for a dark wall) gets its WHITE turned black. dark band: BLACK ink turns white. */
          var swap = opts.onDark ? (n > 0 && mean < 0.28) : (n > 0 && mean > 0.72), changed = 0;
          if (swap) {
            for (i = 0; i < px.length; i += 4) {
              if (px[i + 3] <= 10) continue;
              var r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              if (mx - mn > 40) continue;                                  // a colour: never touched
              if (!opts.onDark && mn >= 200) { px[i] = 10; px[i + 1] = 10; px[i + 2] = 11; changed++; }
              else if (opts.onDark && mx <= 55) { px[i] = px[i + 1] = px[i + 2] = 255; changed++; }
            }
            cx.putImageData(id, 0, 0);
          }
          resolve({ url: swap ? cv.toDataURL('image/png') : url, w: nw, h: nh, swapped: changed });
        } catch (e) { resolve(null); }
      };
      im.onerror = function () { clearTimeout(t); resolve(null); };
      im.src = url;
    });
  }

  window.VPPaperStyle = { CSS: CSS, head: head, logoBox: logoBox, fit: fit, prepLogo: prepLogo, esc: esc };
})();
