/* vp-papercheck.js -- THE HOST'S SCAN OF A PRINTED MUSICAL CARD, AND THE PLAYLIST LOCK (INBOX 335, 340, 345; 13 Nov 2026).

   The host holds a card up to the tablet's camera. The code on it (HTTPS://VENUEPLAY.COM.AU/C/<card set, number, playlist, seal>)
   is sent to the Worker (/host/paper/scan), which says one of: win, notyet, no_game, wrong_playlist, replaced, other_night,
   other_venue, not_card. This file draws the answer, one screen, no scroll, in the console's own colours and buttons.
   "Scan another" sits IN LINE with "Confirm winner" (Dean, 12 Nov 2026): the two buttons are one row.

   The camera is the browser's own: BarcodeDetector where the tablet has it, and our own copy of jsQR (/app/vendor, not a CDN: a
   pub's network may block one) where it does not. No app, no separate page, no outside service. If the camera is off or refused the
   typed card number (already on the console) still works, and the screen says so.

   Also here, pure and testable under jsc (tools/test-paper-scan-screens.js): describe() turns the Worker's answer into the words,
   and lockWords() the playlist lock bar and the red switch warning.

   Used by app/musical/host.html: VPPaperCheck.init({ scan(code) -> promise of the Worker's answer, onWin(res) -> index of the claim
   just added to the claims list, confirm(index), typed() }). */
(function (root) {
  "use strict";
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function togo(n) { return n === 1 ? "one song to go" : (n === 2 ? "two songs to go" : n + " songs to go"); }

  /* Which line a set of winning squares is, in words. */
  function lineWords(cells, fallback) {
    var c = (cells || []).slice().sort(function (a, b) { return a - b; });
    if (c.length === 5) {
      if (c[0] % 5 === 0 && c[4] === c[0] + 4 && c.join() === [c[0], c[0] + 1, c[0] + 2, c[0] + 3, c[0] + 4].join()) return "Row " + (c[0] / 5 + 1) + " across";
      if (c.join() === [c[0], c[0] + 5, c[0] + 10, c[0] + 15, c[0] + 20].join()) return "Column " + (c[0] + 1) + " down";
      if (c.join() === "0,6,12,18,24" || c.join() === "4,8,12,16,20") return "The diagonal";
      if (c.join() === "0,4,20,24") return "Four corners";
    }
    if (c.length === 4 && c.join() === "0,4,20,24") return "Four corners";
    if (c.length === 10) return "Two rows across";
    if (c.length === 25) return "Full house";
    return fallback || "A winning line";
  }

  /* The answer as words. res = the Worker's answer; ctx = {pattern: name of tonight's pattern}. Returns
     {tone: "yes"|"no"|"bad", badge, title, sub (html), warn (html or ""), list: [[left, right]], win: [], played: [], first: "confirm"|"scan"}.
     "first" is which button leads the row: a win leads with Confirm winner, everything else leads with Scan another. */
  function describe(res, ctx) {
    res = res || {}; ctx = ctx || {};
    var no = res.card_no ? pad2(res.card_no) : "";
    var pl = res.playlist_name ? esc(res.playlist_name) : "";
    var head = no ? "Card " + no + (pl ? ", " + pl : "") : "";
    var printed = res.printed_label ? esc(res.printed_label) : "";
    var out = { tone: "no", badge: "", title: head, sub: "", warn: "", list: [], win: [], played: res.played_cells || [], first: "scan", state: res.state || "" };
    switch (res.state) {
      case "win":
        out.tone = "yes"; out.badge = "&#10003; Winner"; out.first = "confirm"; out.win = res.winning_cells || [];
        out.sub = esc(lineWords(res.winning_cells, ctx.pattern)) + ", " + (ctx.pattern ? "the pattern tonight" : "a win") + "." + (printed ? " Printed " + printed + "." : "");
        out.list = (res.win_songs || []).map(function (s) { return [s.title, s.n ? ordinal(s.n) : ""]; });
        break;
      case "notyet":
        out.badge = "Not yet";
        out.sub = "Closest is " + esc(res.closest || "a line") + ": <b>" + togo(res.to_go || 0) + "</b>. Nothing is added to your claims. Tell them to play on.";
        out.list = (res.still_to_play || []).slice(0, 4).map(function (t) { return ["Still to play: " + t, ""]; });
        break;
      case "no_game":
        out.badge = "No game yet"; out.title = head || "Paper card";
        out.sub = "This is one of tonight's cards" + (printed ? ", printed " + printed : "") + ". <b>No musical game is running yet.</b> Start the game, then scan it.";
        break;
      case "wrong_playlist":
        out.tone = "bad"; out.badge = "&#10005; Wrong cards"; out.title = "Card " + no + " can't win this game";
        out.sub = "This card is from <b>" + pl + "</b>, but this game is playing <b>" + esc(res.game_playlist || "other songs") + "</b>.";
        out.warn = "Don't pay out. Tell the venueplay support line if your cards and your game ever disagree.";
        break;
      case "replaced":
        out.tone = "bad"; out.badge = "&#10005; Bin them"; out.title = "Card " + no + " was replaced";
        out.sub = "These cards were replaced" + (res.replaced_clock ? " at <b>" + esc(res.replaced_clock) + "</b>" : "") + ". They were printed" + (printed ? " <b>" + printed + "</b>" : "") + " from <b>" + pl + "</b>." +
          (res.tonight_playlist ? " Tonight's paper cards are <b>" + esc(res.tonight_playlist) + "</b>." : "");
        out.warn = "Bin them. Don't pay out. Ask them to swap it for one of tonight's cards.";
        break;
      case "other_night":
        out.tone = "bad"; out.badge = "&#10005; Wrong cards"; out.title = "Card " + no + " can't win tonight";
        out.sub = "This card was printed <b>" + printed + "</b> from <b>" + pl + "</b>." +
          (res.tonight_playlist ? " Tonight's paper cards are <b>" + esc(res.tonight_playlist) + "</b>" + (res.tonight_label ? ", printed " + esc(res.tonight_label) : "") + "." : "");
        out.warn = "Don't pay out. Ask them to swap it for one of tonight's cards.";
        break;
      case "other_venue":
        out.tone = "bad"; out.badge = "&#10005; Wrong cards"; out.title = "This card is from another venue";
        out.sub = "It is a real venueplay card, but it was not printed here.";
        out.warn = "Don't pay out. Ask them to swap it for one of tonight's cards.";
        break;
      case "mismatch":
        out.tone = "bad"; out.badge = "Can't check"; out.title = "This card can't be checked by scan";
        out.sub = "Type its number instead. venueplay has been told.";
        break;
      default:
        out.tone = "bad"; out.badge = "&#10005; Not a card"; out.title = "This isn't a venueplay card";
        out.sub = "The code did not match. It may be a copy, a different code, or not one of our cards. Try again, or type the number printed on the card.";
    }
    return out;
  }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* The playlist lock bar and the red warning, in words. st = {printed, playlist_name, locked, coded, printed_label}. */
  function lockWords(st, picked) {
    if (!st || !st.printed || !st.playlist_name) return null;
    var pl = st.playlist_name;
    var o = { bar: "Paper cards printed from <b>" + esc(pl) + "</b>" + (st.printed_label ? " (" + esc(st.printed_label) + ")" : "") + ". Every musical game tonight plays <b>" + esc(pl) + "</b>.",
              warnTitle: "", warn: "", blocked: "" };
    if (picked && picked !== pl) {
      if (st.locked) {
        o.blocked = "A game tonight has been played off your " + esc(pl) + " cards, so every game tonight plays " + esc(pl) + ". Next week is a fresh night.";
      } else {
        o.warnTitle = "Those paper cards would not work";
        o.warn = "You have <b>" + st.printed + " paper " + plural(st.printed, "card", "cards") + "</b> on the tables from <b>" + esc(pl) + "</b>. Switching to <b>" + esc(picked) +
          "</b> means those cards can't win. Collect them and print new ones.";
      }
    }
    return o;
  }

  var api = { describe: describe, lockWords: lockWords, lineWords: lineWords, togo: togo, ordinal: ordinal };
  root.VPPaperCheck = api;
  if (typeof document === "undefined") return;

  /* ------------------------------------------------------------ the screen ------------------------------------------------------------ */
  var CSS =
    ".ppc,.ppc *{box-sizing:border-box}" +
    ".ppc{position:fixed;inset:0;z-index:70;background:radial-gradient(1200px 600px at 80% -10%,rgba(255,31,142,.10),transparent 60%),#0A0A0B;color:#E7E7EC;display:flex;flex-direction:column;align-items:center;overflow:hidden;font-family:'Manrope',system-ui,sans-serif}" +
    ".ppc.hidden{display:none}" +
    ".ppc .ppctop{width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.10)}" +
    ".ppc .ppctop .h{font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:16px}" +
    ".ppc .x{width:44px;height:44px;border-radius:10px;background:#17171A;border:1px solid rgba(255,255,255,.10);color:#9A9AA4;font-size:18px;cursor:pointer}" +
    ".ppc .ppcpanel{width:100%;max-width:560px;padding:16px;display:flex;flex-direction:column;gap:14px;flex:1;min-height:0;overflow:hidden}" +
    ".ppc .ppcres{background:#121214;border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:16px}" +
    ".ppc .badge{display:inline-flex;align-items:center;gap:6px;font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:13px;border-radius:999px;padding:5px 11px;background:#17171A;color:#E7E7EC;border:1px solid rgba(255,255,255,.10)}" +
    ".ppc .yes{border-color:rgba(31,162,90,.5)}.ppc .yes .badge{background:rgba(31,162,90,.16);color:#5BD08F;border-color:rgba(31,162,90,.5)}" +
    ".ppc .bad{border-color:rgba(229,72,77,.55)}.ppc .bad .badge{background:rgba(229,72,77,.16);color:#FF8589;border-color:rgba(229,72,77,.55)}" +
    ".ppc .t{font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:22px;line-height:1.2;color:#fff;margin-top:10px}" +
    ".ppc .s{font-size:14px;color:#9A9AA4;margin-top:4px;line-height:1.45}.ppc .s b{color:#E7E7EC}" +
    ".ppc .w{font-size:14px;color:#FF8589;font-weight:700;margin-top:10px;line-height:1.4}" +
    ".ppc .ppcrow{display:flex;gap:14px;align-items:flex-start;margin-top:14px}" +
    ".ppc .map{display:grid;grid-template-columns:repeat(5,12px);gap:3px;flex:none;margin-top:3px}" +
    ".ppc .map i{width:12px;height:12px;border-radius:2px;background:#2A2A30}.ppc .map i.p{background:#4A4A52}.ppc .map i.w{background:#FF1F8E}.ppc .map i.f{background:#fff}" +
    ".ppc ol{list-style:none;flex:1;min-width:0}" +
    ".ppc ol li{display:flex;justify-content:space-between;gap:10px;font-size:14.5px;line-height:1.35;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.10)}.ppc ol li:last-child{border-bottom:0}" +
    ".ppc ol li span:first-child{font-weight:700;color:#fff;min-width:0}.ppc ol li span:last-child{color:#9A9AA4;white-space:nowrap;font-size:13px}" +
    ".ppc .btnrow{display:flex;gap:10px}" +
    ".ppc .b{flex:1;border:none;border-radius:10px;padding:16px 12px;font-family:'Hanken Grotesk',sans-serif;font-weight:700;font-size:15px;text-align:center;min-height:52px;cursor:pointer}" +
    ".ppc .b.pink{background:#FF1F8E;color:#0A0A0B;box-shadow:0 8px 20px rgba(255,31,142,.3)}.ppc .b.ghost{background:#17171A;color:#E7E7EC;border:1px solid rgba(255,255,255,.10)}" +
    ".ppc .ppcfoot{font-size:13px;color:#9A9AA4;text-align:center}.ppc .ppcfoot u{color:#E7E7EC;text-decoration-color:#FF1F8E;text-underline-offset:3px;cursor:pointer}" +
    ".ppc .cam{position:relative;border-radius:14px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.10);flex:1;min-height:0;display:flex;align-items:center;justify-content:center}" +
    ".ppc .cam video{width:100%;height:100%;object-fit:cover}" +
    ".ppc .cam .aim{position:absolute;inset:0;margin:auto;width:62%;aspect-ratio:1;max-height:78%;border:3px solid #FF1F8E;border-radius:18px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}" +
    ".ppc .say{font-size:14px;color:#9A9AA4;text-align:center;line-height:1.45}" +
    "@media (min-width:700px){.ppc .ppcpanel{max-width:620px;padding:28px 16px;gap:18px}.ppc .ppcres{padding:22px}.ppc .t{font-size:28px}.ppc .s{font-size:16px}.ppc ol li{font-size:17px;padding:7px 0}.ppc .map{grid-template-columns:repeat(5,16px)}.ppc .map i{width:16px;height:16px}.ppc .b{font-size:17px;min-height:60px}.ppc .ppcfoot{font-size:15px}.ppc .ppctop .h{font-size:18px}}" +
    ".plcard.pplock{opacity:.4;cursor:not-allowed}.plcard.pplock.on{opacity:1}" +
    ".pplockbar{margin:0 0 12px;padding:11px 14px;border:1px solid rgba(255,255,255,.18);border-radius:11px;background:#17171A;font-size:14px;line-height:1.45;color:#E7E7EC}" +
    ".pplockbar b{color:#fff}";

  function mapHtml(d) {
    var h = '<div class="map">';
    for (var i = 0; i < 25; i++) h += '<i class="' + (i === 12 ? "f" : (d.win.indexOf(i) >= 0 ? "w" : (d.played.indexOf(i) >= 0 ? "p" : ""))) + '"></i>';
    return h + "</div>";
  }

  var opts = null, el = null, stream = null, raf = 0, detector = null, jsq = null, canvas = null, busy = false, lastWinIdx = -1;

  function build() {
    if (el) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement("div"); el.className = "ppc hidden"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Paper card check");
    el.innerHTML = '<div class="ppctop"><div class="h">Paper card check</div><button type="button" class="x" aria-label="Close" data-a="close">&#x2715;</button></div><div class="ppcpanel" id="ppcPanel"></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-a"); if (!a) return;
      if (a === "close" || a === "back") close();
      else if (a === "again") startCamera();
      else if (a === "confirm") { var i = lastWinIdx; close(); if (opts && opts.confirm) opts.confirm(i); }
      else if (a === "type") { close(); if (opts && opts.typed) opts.typed(); }
    });
  }
  function panel() { return el.querySelector("#ppcPanel"); }
  function stopCamera() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
  }
  function close() { stopCamera(); busy = false; if (el) el.classList.add("hidden"); }
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "/app/vendor/jsQR-1.4.0.min.js";
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error("no decoder")); }; s.onerror = function () { rej(new Error("no decoder")); };
      document.head.appendChild(s);
    });
  }
  function sayNoCamera(why) {
    panel().innerHTML = '<div class="ppcres bad"><span class="badge">Camera is off</span><div class="t">Can\'t open the camera</div><div class="s">' + esc(why) +
      " Allow the camera for this page in your browser, or type the card number instead.</div></div>" +
      '<div class="btnrow"><button type="button" class="b pink" data-a="type">Type its number</button><button type="button" class="b ghost" data-a="again">Try the camera again</button></div>';
  }
  function startCamera() {
    build(); stopCamera(); busy = false;
    el.classList.remove("hidden");
    panel().innerHTML = '<div class="cam"><video playsinline muted autoplay></video><div class="aim"></div></div><div class="say">Hold the card so the square code on it fills the pink box.</div>' +
      '<div class="ppcfoot">Card won\'t scan? <u data-a="type">Type its number</u></div>';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { sayNoCamera("This browser has no camera access."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (s) {
      stream = s;
      var v = panel().querySelector("video"); if (!v) { stopCamera(); return; }
      v.srcObject = s; try { v.play(); } catch (e) {}
      var useNative = !!(window.BarcodeDetector);
      if (useNative) { try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { useNative = false; } }
      var p = useNative ? Promise.resolve(null) : loadJsQR().then(function (q) { jsq = q; canvas = document.createElement("canvas"); });
      p.then(function () { tick(v, useNative); }, function () { stopCamera(); sayNoCamera("The scanner could not start."); });
    }, function (e) {
      sayNoCamera(e && e.name === "NotAllowedError" ? "The camera was blocked." : "No camera was found.");
    });
  }
  function tick(v, native) {
    if (!stream) return;
    var got = function (txt) { if (txt && !busy) { busy = true; stopCamera(); asked(txt); } else raf = requestAnimationFrame(function () { tick(v, native); }); };
    if (v.readyState < 2) { raf = requestAnimationFrame(function () { tick(v, native); }); return; }
    if (native) {
      detector.detect(v).then(function (r) { got(r && r[0] && r[0].rawValue); }, function () { got(null); });
    } else {
      try {
        var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 640 / Math.max(w, h));
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        var cx = canvas.getContext("2d", { willReadFrequently: true }); cx.drawImage(v, 0, 0, canvas.width, canvas.height);
        var img = cx.getImageData(0, 0, canvas.width, canvas.height), r = jsq(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        setTimeout(function () { got(r && r.data); }, 0);
      } catch (e) { got(null); }
    }
  }
  function asked(code) {
    panel().innerHTML = '<div class="ppcres"><span class="badge">Checking</span><div class="t">Checking the card...</div></div>';
    Promise.resolve(opts.scan(code)).then(function (res) { show(res); }, function (e) {
      show({ state: "error", message: e && e.message ? e.message : "Could not check that card." });
    });
  }
  function show(res) {
    if (res && res.state === "error") {
      panel().innerHTML = '<div class="ppcres bad"><span class="badge">Not checked</span><div class="t">That did not go through</div><div class="s">' + esc(res.message) + "</div></div>" +
        '<div class="btnrow"><button type="button" class="b pink" data-a="again">Scan another</button><button type="button" class="b ghost" data-a="back">Back to the game</button></div>' +
        '<div class="ppcfoot">Card won\'t scan? <u data-a="type">Type its number</u></div>';
      return;
    }
    lastWinIdx = -1;
    if (res && res.state === "win" && opts.onWin) lastWinIdx = opts.onWin(res);
    var d = describe(res, { pattern: opts.pattern ? opts.pattern() : "" });
    var rows = d.list.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; }).join("");
    var body = '<div class="ppcres ' + d.tone + '"><span class="badge">' + d.badge + '</span><div class="t">' + esc(d.title) + '</div><div class="s">' + d.sub + "</div>" +
      (d.warn ? '<div class="w">' + d.warn + "</div>" : "") +
      ((d.win.length || d.played.length || rows) ? '<div class="ppcrow">' + ((d.win.length || d.played.length) ? mapHtml(d) : "") + (rows ? "<ol>" + rows + "</ol>" : "") + "</div>" : "") + "</div>";
    var btns = d.first === "confirm"
      ? '<button type="button" class="b pink" data-a="confirm">Confirm winner</button><button type="button" class="b ghost" data-a="again">Scan another</button>'
      : (d.state === "no_game" ? '<button type="button" class="b pink" data-a="back">Back to the game</button><button type="button" class="b ghost" data-a="again">Scan another</button>'
        : '<button type="button" class="b pink" data-a="again">Scan another</button><button type="button" class="b ghost" data-a="back">Back to the game</button>');
    panel().innerHTML = body + '<div class="btnrow">' + btns + '</div><div class="ppcfoot">Card won\'t scan? <u data-a="type">Type its number</u></div>';
  }

  api.init = function (o) { opts = o || {}; build(); };
  api.open = function () { if (!opts) return; startCamera(); };
  api.close = close;
  /* Check a code that was read some other way (and the way a test feeds the screen): the same path a camera read takes. */
  api.check = function (code) { if (!opts) return; build(); stopCamera(); el.classList.remove("hidden"); asked(code); };
  api.show = function (res) { build(); el.classList.remove("hidden"); show(res); };
})(typeof window !== "undefined" ? window : this);
