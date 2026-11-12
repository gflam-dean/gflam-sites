/* vp-hostedby.js -- "HOSTED BY" ON THE TV, IN ONE PLACE (Dean, 6 Nov 2026, INBOX 120; migration 181).

   A venue's trivia host, or their trivia company, shows "Hosted by <name>" and their logo on the TV during
   the nights they run. The card belongs to the host's login (it follows them to every venue); each venue's
   owner switches it on per game on Account > People.

   TWO HALVES, one file, so the console and the TV can never disagree about the shape of the card:

   THE CONSOLE (app/trivia/host.html, app/musical/host.html)
     VPHostedBy.load(gameApi, venueId, getToken, fmt, onChange)  asks the game Worker's /host/hosted-by once
         the console knows its venue. Nothing to show (or no answer) is null, and a game never waits on it.
     VPHostedBy.tag(msg, fmt)  a copy of a "mode" message with hosted_by: { name, logo } | null on it. Every
         other message is handed back untouched. The console signs after tagging, so the card rides inside
         the signature the TV already checks.

   THE TV (app/trivia/screen.html, app/musical/screen.html)
     VPHostedBy.fromMessage(m)  paints or clears the line when a message CARRIES hosted_by, and does nothing
         when it does not, so a console from before this file changes nothing on the wall.
     VPHostedBy.paint(card)     { name, logo } or null. The sales demo calls it with ?hostedby=.

   WHERE IT SITS (Dean picked this, 11 Nov 2026): the host's logo top left after the venue's logo, and
   "hosted by <name>" as a smaller line centred under the game's name, the two as one block on the venue logo's
   middle line. The slide sits at one fixed height whatever the logos are (see the bands below). Measured each second, as the venueplay mark is, because the venue
   logo arrives and resizes after load.

   A LOGO ONLY FROM OUR OWN STORAGE. A broadcast is signed at an enforcing venue, but not everywhere yet,
   so the TV takes a logo address only from our Supabase public bucket under venue-logos/hosts/ (where the
   billing Worker writes it), or a path on this site (the demo). Any other address and the line shows the
   name alone. The name is set as text, never as HTML. */
(function (w, d) {
  "use strict";

  var NAME_MAX = 32;   /* two lines at most beside the venue logo (design review 2, 6 Nov 2026) */
  var LOGO_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/venue-logos\/hosts\/[A-Za-z0-9\/._-]+$/;
  var SITE_RE = /^\/[A-Za-z0-9][A-Za-z0-9\/._-]*$/;

  function cleanName(v) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }
  function cleanLogo(v) {
    var s = String(v == null ? "" : v);
    return (s.length <= 500 && (LOGO_RE.test(s) || SITE_RE.test(s))) ? s : "";
  }
  /* The one shape a card has, wherever it came from. null when there is no name to show. */
  function clean(card) {
    if (!card || typeof card !== "object") return null;
    var name = cleanName(card.name);
    if (!name) return null;
    return { name: name, logo: cleanLogo(card.logo != null ? card.logo : card.logo_url) };
  }

  /* ---------------------------------------------------------------- the console */
  var cards = { trivia: null, musical: null }, loaded = false;

  function load(gameApi, venueId, getToken, fmt, onChange) {
    if (!venueId || !gameApi || typeof fetch !== "function") return Promise.resolve(null);
    return Promise.resolve(getToken ? getToken() : "").then(function (t) {
      if (!t) return null;
      return fetch(gameApi + "/host/hosted-by?venue_id=" + encodeURIComponent(venueId), { headers: { "Authorization": "Bearer " + t } })
        .then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (dd) {
      var was = JSON.stringify(cards[fmt] || null);
      cards = { trivia: clean(dd && dd.trivia), musical: clean(dd && dd.musical) };
      loaded = true;
      if (onChange && JSON.stringify(cards[fmt] || null) !== was) { try { onChange(cards[fmt]); } catch (e) {} }
      return cards[fmt];
    }).catch(function () { return null; });
  }

  function tag(msg, fmt) {
    if (!msg || typeof msg !== "object" || msg.t !== "mode" || !loaded) return msg;
    var o = {};
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) o[k] = msg[k];
    var c = cards[fmt] || null;
    o.hosted_by = c ? { name: c.name, logo: c.logo } : null;
    return o;
  }

  /* ---------------------------------------------------------------- the TV */
  var el = null, shown = null, timer = null, watched = null, line = null, band = null, podBand = null, boardBand = null;
  /* WHERE IT SITS (Dean picked option A, 11 Nov 2026, INBOX 220; his second look, INBOX 249): the host's LOGO stays top
     left, after the venue's logo (or its name) with a thin divider, and the words are a smaller line, "hosted by <name>",
     centred UNDER the game's name.
     ONE BLOCK ON ONE MIDDLE LINE (INBOX 249). The game's name and the line under it are one block, and that block's
     middle is the venue logo's middle (or its name's, or our mark's when it has neither). The host's logo is centred on
     the same line. A round crest is tall, so its middle has room for the block. A wide wordmark or a name is short, and
     its middle is too near the top for a two-line block, so the HEADER DROPS (the venue's logo or name, our mark and the
     block, all together) just far enough for the block's top to sit at the logo's own distance from the top. Nothing
     moves when there is no card.
     THE SLIDE SITS AT THE SAME HEIGHT ON EVERY VARIANT: one fixed band across the top (a vp-fit keep-out), worked out
     from the LOWEST the block can reach (a crest as tall as a venue logo may be drawn, 13% of the height), plus clear
     room under it. The winners slide sits a little lower (its own keep-out) and the final scores where Dean approved
     them (17.2% of the height). The game's name is marked data-fit-ignore so the fit does not treat it as part of
     the slide it is lifting the slide clear of. */
  var LOGO_MAX_H = 0.13;  /* the tallest a venue's logo is drawn (VPVenueLogo TV.maxH) */
  var UNDER = 0.022;      /* clear room under the lowest the block can sit */
  var POD = 0.03;         /* the winners slide, this much lower than the final scores (Dean, 11 Nov: "down a little more") */
  var BOARD = 0.172;      /* the final scores: where they were when Dean said "leave it" */
  var drop = 0;           /* how far the header is dropped now (px) */

  function css() {
    if (d.getElementById("vpHostedByCss")) return;
    var s = d.createElement("style");
    s.id = "vpHostedByCss";
    s.textContent =
      ".hostedby{position:fixed;z-index:60;pointer-events:none;display:flex;align-items:center;min-width:0;" +
      "font-family:'Hanken Grotesk','Manrope',system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 10px rgba(0,0,0,.6)}" +
      ".hostedby[hidden]{display:none}" +
      ".hostedby .hb-logo{display:block;width:auto;object-fit:contain;flex:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))}" +
      ".hostedby .hb-logo[hidden]{display:none}" +
      /* a thin divider before the host's logo, so it never reads as part of the venue's own wordmark */
      ".hostedby{gap:max(10px,1.1vh);padding-left:max(12px,1.4vh);border-left:2px solid rgba(255,255,255,.28)}" +
      /* the words: smaller than the game's name, centred under it, one line (a long name is cut with an ellipsis) */
      ".hb-line{position:fixed;z-index:60;pointer-events:none;display:block;text-align:center;font-family:'Hanken Grotesk','Manrope',system-ui,sans-serif;font-size:max(16px,2.78vh);line-height:1.2;color:rgba(255,255,255,.8);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.85)}" +
      ".hb-line[hidden]{display:none}" +
      ".hb-line b{font-weight:800;color:#fff}" +
      /* the keep-outs: nothing painted, fixed bands across the top */
      ".hb-band{position:fixed;left:0;top:0;width:100%;pointer-events:none;visibility:visible;background:transparent}" +
      ".hb-band[hidden]{display:none}";
    (d.head || d.documentElement).appendChild(s);
  }

  function mkBand(id, only) {
    var b = d.createElement("div"); b.id = id; b.className = "hb-band"; b.hidden = true;
    b.setAttribute("data-fit-avoid", "");
    if (only) b.setAttribute("data-fit-only", only);
    (d.body || d.documentElement).appendChild(b);
    return b;
  }

  function make() {
    if (el) return el;
    css();
    el = d.createElement("div");
    el.id = "hostedBy";
    el.className = "hostedby";
    el.hidden = true;
    var img = d.createElement("img"); img.className = "hb-logo"; img.alt = ""; img.hidden = true;
    img.onload = function () { place(); };
    img.onerror = function () { img.hidden = true; place(); };
    el.appendChild(img);
    (d.body || d.documentElement).appendChild(el);
    line = d.createElement("div"); line.id = "hostedByLine"; line.className = "hb-line"; line.hidden = true;
    (d.body || d.documentElement).appendChild(line);
    band = mkBand("hostedByBand", "");
    podBand = mkBand("hostedByBandWin", "tvPodium");
    boardBand = mkBand("hostedByBandBoard", "tvBoard");
    return el;
  }

  function visible(x) {
    if (!x || x.hidden) return null;
    var cs = w.getComputedStyle ? w.getComputedStyle(x) : null;
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return null;
    var r = x.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? r : null;
  }

  function on() { return !!(line && !line.hidden); }
  /* THE TV SAFE BOX (Dean via main, INBOX 321.2, 12 Nov 2026): on a page with /app/vp-tvsafe.css every place and size
     here is of the safe box (the window less 5% each side), the way /app/vp-venuelogo.js sizes the venue's logo. sf()
     is 0 without the sheet, which is the window, as before. */
  function sf() { try { return w.VPVenueLogo && w.VPVenueLogo.safeShare ? w.VPVenueLogo.safeShare() : 0; } catch (e) { return 0; } }
  function SB() {
    var W = w.innerWidth || 1920, H = w.innerHeight || 1080, k = sf();
    return { x: k * W, y: k * H, W: W * (1 - 2 * k), H: H * (1 - 2 * k) };
  }
  function inset() { var b = SB(); return b.y + Math.max(14, Math.round(0.012 * b.W)); }   /* the venue logo's own distance from the top */
  function gapUnder() { return Math.max(2, Math.round(0.004 * SB().H)); }
  function corner() { return d.querySelector(".tv-corner"); }
  /* The middle line: the venue logo's, its name's when it has none, our mark's when neither is up. */
  function anchor() {
    var lg = visible(d.getElementById("venueLogo")), tg = visible(d.getElementById("venueNameTag"));
    var a = lg || tg;
    if (!a) { try { a = w.VPVenueLogo && w.VPVenueLogo.markBox ? w.VPVenueLogo.markBox(corner()) : null; } catch (e) { a = null; } }
    return a && a.height ? a : null;
  }
  var nameH = 0;   /* the game name's height, kept from when it was last on screen */
  function block() {
    var tls = d.querySelectorAll(".toplbl .tl-night");
    for (var i = 0; i < tls.length; i++) { var h = tls[i].offsetHeight; if (h) { nameH = h; break; } }
    var lh = line ? line.offsetHeight : 0;
    return { name: nameH, line: lh, gap: gapUnder(), h: nameH + gapUnder() + lh };
  }
  /* Where the game's name box (.toplbl) goes, as a viewport y, so the block's middle is on the middle line. Read by
     VPTvGame.alignTitles; null when there is no card (the name goes on our mark's line, as always). */
  function titleTop(lbl) {
    if (!on()) return null;
    var a = anchor(); if (!a) return null;
    var sp = lbl.querySelector ? lbl.querySelector(".tl-night") : null;
    var sr = sp ? sp.getBoundingClientRect() : null, lr = lbl.getBoundingClientRect();
    var off = (sr && sr.height) ? sr.top - lr.top : 0, nh = (sr && sr.height) ? sr.height : nameH;
    var lh = line ? line.offsetHeight : 0;
    return a.top + a.height / 2 - (nh + gapUnder() + lh) / 2 - off;
  }

  /* Move the venue's logo, our mark and (through alignName) the venue's name down by px together. */
  function setDrop(px) {
    if (px === drop) return;
    drop = px;
    var v = px ? px + "px" : "";
    var cn = corner(), lg = d.getElementById("venueLogo");
    if (cn) cn.style.marginTop = v;
    if (lg) lg.style.marginTop = v;
    try { if (w.VPVenueLogo && w.VPVenueLogo.alignName) w.VPVenueLogo.alignName(cn); } catch (e) {}
  }

  var placedAt = "";
  function place() {
    if (!el || !on()) return;
    var sb = SB(), W = sb.W, H = sb.H, T = inset();   /* the safe box's width and height (the window's with no sheet) */
    var gap = Math.max(16, Math.round(0.016 * W));
    var logoEl = d.getElementById("venueLogo");
    /* The venue logo arrives, and is sized by its shape, after this is first painted: follow it the moment it
       changes rather than on the next one-second tick. */
    if (logoEl && logoEl !== watched && typeof w.ResizeObserver === "function") {
      watched = logoEl;
      try { new w.ResizeObserver(function () { place(); }).observe(logoEl); } catch (e) {}
      try { logoEl.addEventListener("load", function () { place(); }); } catch (e) {}
    }
    /* the drop: just enough for the block's top to be at the logo's own distance from the top, never up */
    var bk = block(), a0 = anchor();
    if (a0 && bk.name) {
      var mid0 = a0.top + a0.height / 2 - drop;
      setDrop(Math.max(0, Math.round(T + bk.h / 2 - mid0)));
    }
    /* the game's name on the line (VPTvGame.alignTitles reads titleTop above), then the words under it */
    try { if (w.VPTvGame && w.VPTvGame.alignTitles) w.VPTvGame.alignTitles(); } catch (e) {}
    var logo = visible(logoEl), tag = visible(d.getElementById("venueNameTag"));
    var tl = null, tls = d.querySelectorAll(".toplbl .tl-night");
    for (var t = 0; t < tls.length; t++) {
      var tr = visible(tls[t]);
      if (tr && (!tl || tr.top < tl.top)) tl = tr;
      var box = tls[t].parentNode;   /* the game's name is not part of the slide the fit lifts clear of the band */
      if (box && box.setAttribute && !box.hasAttribute("data-fit-ignore")) box.setAttribute("data-fit-ignore", "");
    }
    var img = el.querySelector(".hb-logo"), s = el.style, ih;
    var an = logo || tag, mid = an ? an.top + an.height / 2 : (a0 ? a0.top + a0.height / 2 : T + bk.h / 2);
    if (!el.hidden) {
      /* The host's logo is 70% of the venue logo's height (a wide wordmark is short, so it is too), no wider than
         13% of the screen; beside a venue's NAME it is 4.4% of the height. NEVER SMALLER THAN 5% of the height
         (a smudge beside a wide wordmark or a name). */
      ih = Math.max(logo ? Math.round(0.7 * logo.height) : Math.round(0.044 * H), Math.round(0.05 * H));
      var left = an ? an.right + gap : sb.x + Math.max(14, Math.round(0.012 * W));
      /* NEVER REACHES THE GAME'S NAME: it stops a gap short of the name as painted (TRIVIA is short, MUSICAL
         BINGO is long), and never past 13% of the screen's width beyond its own start. */
      var stop = Math.min(tl ? tl.left - gap : sb.x + 0.42 * W, left + 0.13 * W);
      var mw = Math.round(Math.max(0.06 * W, stop - left));
      s.left = Math.round(left) + "px";
      s.maxWidth = mw + "px";
      img.style.height = Math.round(ih) + "px"; img.style.maxWidth = mw + "px";
      /* CENTRED ON THE SAME MIDDLE LINE, never higher than the venue logo's own distance from the top (a TV that
         crops its edges would cut it) */
      var h = el.offsetHeight || ih;
      s.top = Math.round(Math.max(T, mid - h / 2)) + "px";
      s.bottom = "auto";
    }
    var lk = "";
    if (tl) {
      var lw = Math.round(0.5 * W), mx = tl.left + tl.width / 2;
      line.style.width = lw + "px"; line.style.maxWidth = lw + "px";
      line.style.left = Math.round(mx - lw / 2) + "px";
      line.style.top = Math.round(tl.bottom + bk.gap) + "px";
      lk = line.style.left + "," + line.style.top;
    }
    /* THE BAND, from the lowest the block can reach: its middle on the tallest venue logo's middle (or as low as the
       drop puts it), whichever is lower, so it is the same on every variant at a given screen size */
    var lowest = T + Math.max(LOGO_MAX_H * H / 2, bk.h / 2) + bk.h / 2;
    var lb = visible(line); if (lb && lb.bottom > lowest) lowest = lb.bottom;
    var bh = Math.round(lowest + UNDER * H);
    band.style.height = bh + "px"; band.hidden = false;
    var bb = Math.max(bh, Math.round(sb.y + BOARD * H));
    boardBand.style.height = bb + "px"; boardBand.hidden = false;
    podBand.style.height = Math.round(bb + POD * H) + "px"; podBand.hidden = false;
    lk += "," + bh;
    var at = s.left + "," + s.top + "," + img.style.height + "," + el.offsetWidth + "," + el.offsetHeight + "," + lk + "," + drop;
    if (at !== placedAt) {
      placedAt = at;
      /* the bands are keep-outs, and the line and the logo ride on the logos; re-fit the wall when they move */
      try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {}
    }
  }

  function paint(card) {
    var c = clean(card);
    var key = c ? JSON.stringify(c) : "";
    if (key === shown) return;
    shown = key;
    if (!c) {
      if (el) el.hidden = true;
      if (line) line.hidden = true;
      if (band) band.hidden = true;
      if (podBand) podBand.hidden = true;
      if (boardBand) boardBand.hidden = true;
      setDrop(0);
      placedAt = "";
      var tls = d.querySelectorAll(".toplbl[data-fit-ignore]");
      for (var i = 0; i < tls.length; i++) tls[i].removeAttribute("data-fit-ignore");
      try { if (w.VPTvGame && w.VPTvGame.alignTitles) w.VPTvGame.alignTitles(); } catch (e) {}
      try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {}
      return;
    }
    make();
    var img = el.querySelector(".hb-logo");
    line.textContent = "";
    line.appendChild(d.createTextNode("hosted by "));
    var b = d.createElement("b"); b.textContent = c.name; line.appendChild(b);
    line.hidden = false;
    if (c.logo) { img.hidden = false; img.src = c.logo; } else { img.hidden = true; img.removeAttribute("src"); }
    el.hidden = !c.logo;
    place();
    if (!timer) {
      timer = setInterval(place, 1000);   // the venue logo arrives and resizes after load
      if (w.addEventListener) w.addEventListener("resize", place);
    }
  }

  function fromMessage(m) {
    if (!m || typeof m !== "object" || !Object.prototype.hasOwnProperty.call(m, "hosted_by")) return;
    paint(m.hosted_by);
  }

  /* The sales demo: ?hostedby=<name>&hostlogo=/path/on/this/site. Never a URL from elsewhere. */
  function fromQuery(search) {
    var q = String(search || "");
    var n = /[?&]hostedby=([^&]*)/.exec(q), l = /[?&]hostlogo=([^&]*)/.exec(q);
    if (!n) return null;
    var dec = function (v) { try { return decodeURIComponent(String(v).replace(/\+/g, " ")); } catch (e) { return ""; } };
    var logo = l ? dec(l[1]) : "";
    return clean({ name: dec(n[1]), logo: SITE_RE.test(logo) ? logo : "" });
  }

  w.VPHostedBy = { load: load, tag: tag, paint: paint, fromMessage: fromMessage, fromQuery: fromQuery, clean: clean,
                   place: place, titleTop: titleTop, _cards: function () { return cards; } };
})(window, document);
