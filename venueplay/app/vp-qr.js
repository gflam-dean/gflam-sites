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
                                    opts.code    the code to show if there is no QR (found
                                                 on the page when not given)

   THE LIBRARY IS OURS NOW (1 Nov 2026). qrcode 1.4.4 is served from /app/vendor/, not from
   cdn.jsdelivr.net: a venue network that blocks or cannot reach a public CDN left the join
   square a blank white panel, glowing on the pub wall, with nothing to say why. Two more
   answers here for the day it still does not arrive:
     - A DRAW THAT HAD NO LIBRARY IS DONE AGAIN THE MOMENT IT ARRIVES (checked once a second,
       and on the window's load), so a script that lands late still gets its code drawn.
     - UNTIL THEN THE SQUARE SAYS WHAT TO DO, in the screen's own look: "Scan not available.
       Go to venueplay.com.au/play and type the code", with the code big. Only on the TV walls'
       QR boxes (.qrbig, .qrmini); a printed sign is left alone.
   Never throws: a screen missing its QR is a bad night, a screen throwing on every repaint
   is a black one. ES5. */
(function (root) {
  "use strict";
  var doc = root.document;
  var waiting = [];                       /* {el, url, size, opts}: drawn with no library */
  var timer = 0;
  var CODE_RE = /^[A-Z0-9]{6}$/;

  function boxOf(el) {
    var p = el && el.parentNode;
    if (!p || !p.className || typeof p.className !== "string") return null;
    return /(^|\s)(qrbig|qrmini)(\s|$)/.test(p.className) ? p : null;
  }

  /* The code to put in the square: given, or read off the address (room=, code=, tv=), or the
     code the same wall already shows beside the QR. */
  function codeFor(el, url, opts) {
    if (opts && opts.code && CODE_RE.test(String(opts.code).toUpperCase())) return String(opts.code).toUpperCase();
    var m = /[?&](room|code|tv)=([A-Za-z0-9]{6})(&|#|$)/.exec(url || "");
    if (m) return m[2].toUpperCase();
    var scope = el;
    for (var i = 0; i < 6 && scope && scope.parentNode; i++) {
      scope = scope.parentNode;
      if (!scope.querySelectorAll) continue;
      var cands = scope.querySelectorAll(".codeval, .tjc, [data-join-code]");
      for (var k = 0; k < cands.length; k++) {
        var t = (cands[k].textContent || "").replace(/\s+/g, "").toUpperCase();
        if (CODE_RE.test(t)) return t;
      }
    }
    return "";
  }

  function clearFallback(el) {
    var box = boxOf(el);
    if (!box) return;
    var fb = box.querySelector(".vpqr-fb");
    if (fb) box.removeChild(fb);
    if (box.getAttribute("data-vpqr-fb")) {
      box.style.background = box.getAttribute("data-vpqr-bg") || "";
      box.removeAttribute("data-vpqr-fb");
      box.removeAttribute("data-vpqr-bg");
    }
    el.style.visibility = "";
  }

  function showFallback(el, url, opts) {
    var box = boxOf(el);
    if (!box || !doc) return;
    var code = codeFor(el, url, opts);
    var pairing = /[?&]tv=/.test(url || "");
    var w = box.getBoundingClientRect ? box.getBoundingClientRect().width : 0;
    if (!w) w = box.offsetWidth || 300;
    var mini = w < 170;
    var fb = box.querySelector(".vpqr-fb");
    if (!fb) {
      fb = doc.createElement("div");
      fb.className = "vpqr-fb";
      box.appendChild(fb);
    }
    if (!box.getAttribute("data-vpqr-fb")) {
      box.setAttribute("data-vpqr-bg", box.style.background || "");
      box.setAttribute("data-vpqr-fb", "1");
    }
    /* Pixels, not cqw: an old television that cannot read container units must still read this. */
    box.style.background = "#121214";
    el.style.visibility = "hidden";
    var pad = Math.round(w * 0.07), body = Math.max(10, Math.round(w * (mini ? 0.1 : 0.062)));
    var big = Math.max(14, Math.round(w * (mini ? 0.17 : 0.14)));
    fb.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;text-align:center;padding:" + pad + "px;box-sizing:border-box;border:2px solid #FF1F8E;border-radius:inherit;" +
      "color:#E7E7EC;font-family:'Manrope',system-ui,sans-serif;font-weight:600;line-height:1.3;font-size:" + body + "px";
    if (!box.style.position && root.getComputedStyle && root.getComputedStyle(box).position === "static") box.style.position = "relative";
    var codeLine = code ? '<div style="margin-top:' + Math.round(big * 0.35) + 'px;font-family:\'JetBrains Mono\',ui-monospace,monospace;font-weight:700;' +
      'color:#FFC24B;letter-spacing:.08em;line-height:1;font-size:' + big + 'px">' + code + '</div>' : "";
    if (mini) {
      fb.innerHTML = '<div>venueplay.com.au/play</div>' + codeLine;
    } else if (pairing) {
      fb.innerHTML = '<div style="font-family:\'Hanken Grotesk\',sans-serif;font-weight:800;color:#fff;font-size:' + Math.round(body * 1.25) + 'px">Scan not available.</div>' +
        '<div style="margin-top:' + Math.round(body * 0.5) + 'px">On the host console, put in this screen\'s code</div>' + codeLine;
    } else {
      fb.innerHTML = '<div style="font-family:\'Hanken Grotesk\',sans-serif;font-weight:800;color:#fff;font-size:' + Math.round(body * 1.25) + 'px">Scan not available.</div>' +
        '<div style="margin-top:' + Math.round(body * 0.5) + 'px">Go to <b style="color:#FF1F8E;font-weight:700">venueplay.com.au/play</b> and type the code</div>' + codeLine;
    }
  }

  function remember(el, url, size, opts) {
    for (var i = 0; i < waiting.length; i++) {
      if (waiting[i].el === el) { waiting[i] = { el: el, url: url, size: size, opts: opts }; return; }
    }
    waiting.push({ el: el, url: url, size: size, opts: opts });
    if (!timer) timer = root.setInterval(retry, 1000);
  }

  function retry() {
    if (!root.QRCode) return;
    var list = waiting; waiting = [];
    if (timer) { root.clearInterval(timer); timer = 0; }
    for (var i = 0; i < list.length; i++) draw(list[i].el, list[i].url, list[i].size, list[i].opts);
  }

  function draw(el, url, size, opts) {
    if (!el || !url) return;
    opts = opts || {};
    if (!root.QRCode) {
      remember(el, url, size, opts);
      try { showFallback(el, url, opts); } catch (e) {}
      return;
    }
    try {
      root.QRCode.toCanvas(el, url, {
        width: size,
        margin: opts.margin == null ? 1 : opts.margin,
        errorCorrectionLevel: opts.level || 'M',
        color: { dark: '#0A0A0B', light: '#ffffff' }
      }, function (err) {
        try { if (err) showFallback(el, url, opts); else clearFallback(el); } catch (e) {}
      });
    } catch (e) {
      try { showFallback(el, url, opts); } catch (e2) {}
    }
  }

  if (root.addEventListener) root.addEventListener("load", retry);
  root.VPQR = { draw: draw, _waiting: function () { return waiting.length; } };
})(typeof window !== "undefined" ? window : this);
