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
   "hosted by <name>" as a smaller line centred under the game's name. The slide sits at one fixed height
   whatever the logos are (see BAND below). Measured each second, as the venueplay mark is, because the venue
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
  var el = null, shown = null, timer = null, watched = null, line = null, band = null;
  /* WHERE IT SITS (Dean picked option A, 11 Nov 2026, INBOX 220): the host's LOGO stays top left, after the venue's
     logo (or its name), and the words are a smaller line, "hosted by <name>", centred UNDER the game's name.
     THE SLIDE SITS AT THE SAME HEIGHT ON EVERY VARIANT. The title block is on the logos' centre line, which moves
     with the venue logo's shape (a crest is tall, a wide wordmark is short), so the room under it did too and the
     question dropped far more beside a wordmark than beside a crest. So a hosted slide is kept clear of ONE
     fixed band across the top (BAND of the screen's height, a vp-fit keep-out), whatever the logos are: the
     question and the timer land on the same line on a crest, a wordmark, no venue logo and no host logo, with a
     little clear room under the line. The game's name is marked data-fit-ignore so the fit does not treat it as
     part of the slide it is lifting the slide clear of. Nothing moves when there is no card. */
  var BAND = 0.172;

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
      /* the words: smaller than the game's name, centred under it, one line (a long name is cut with an ellipsis) */
      ".hb-line{position:fixed;z-index:60;pointer-events:none;display:block;text-align:center;font-family:'Hanken Grotesk','Manrope',system-ui,sans-serif;font-size:max(16px,2.78vh);line-height:1.2;color:rgba(255,255,255,.8);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.85)}" +
      ".hb-line[hidden]{display:none}" +
      ".hb-line b{font-weight:800;color:#fff}" +
      /* the keep-out: nothing painted, one fixed band across the top */
      ".hb-band{position:fixed;left:0;top:0;width:100%;pointer-events:none;visibility:visible;background:transparent}" +
      ".hb-band[hidden]{display:none}";
    (d.head || d.documentElement).appendChild(s);
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
    band = d.createElement("div"); band.id = "hostedByBand"; band.className = "hb-band"; band.hidden = true;
    band.setAttribute("data-fit-avoid", "");
    (d.body || d.documentElement).appendChild(band);
    return el;
  }

  function visible(x) {
    if (!x || x.hidden) return null;
    var cs = w.getComputedStyle ? w.getComputedStyle(x) : null;
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return null;
    var r = x.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? r : null;
  }

  var placedAt = "";
  function place() {
    if (!el || (el.hidden && (!line || line.hidden))) return;
    /* the game's name sits on the logos' line (VPTvGame.alignTitles, which the wall also runs each second); settle
       it first so the line is measured against the name where it will be painted */
    try { if (w.VPTvGame && w.VPTvGame.alignTitles) w.VPTvGame.alignTitles(); } catch (e) {}
    var W = w.innerWidth || 1920, H = w.innerHeight || 1080;
    var inset = Math.max(14, Math.round(0.012 * W)), gap = Math.max(16, Math.round(0.016 * W));
    var logoEl = d.getElementById("venueLogo");
    /* The venue logo arrives, and is sized by its shape, after this is first painted: follow it the moment it
       changes rather than on the next one-second tick. */
    if (logoEl && logoEl !== watched && typeof w.ResizeObserver === "function") {
      watched = logoEl;
      try { new w.ResizeObserver(function () { place(); }).observe(logoEl); } catch (e) {}
      try { logoEl.addEventListener("load", function () { place(); }); } catch (e) {}
    }
    var logo = visible(logoEl), tag = visible(d.getElementById("venueNameTag"));
    var tl = null, tls = d.querySelectorAll(".toplbl .tl-night");
    for (var t = 0; t < tls.length; t++) {
      var tr = visible(tls[t]);
      if (tr && (!tl || tr.top < tl.top)) tl = tr;
      var box = tls[t].parentNode;   /* the game's name is not part of the slide the fit lifts clear of the band */
      if (box && box.setAttribute && !box.hasAttribute("data-fit-ignore")) box.setAttribute("data-fit-ignore", "");
    }
    var img = el.querySelector(".hb-logo"), s = el.style, ih;
    if (!el.hidden) {
      /* The host's logo is 70% of the venue logo's height (a wide wordmark is short, so it is too), no wider than
         13% of the screen; beside a venue's NAME it is 4.4% of the height. NEVER SMALLER THAN 5% of the height
         (a smudge beside a wide wordmark or a name). */
      ih = Math.max(logo ? Math.round(0.7 * logo.height) : Math.round(0.044 * H), Math.round(0.05 * H));
      var anchor = logo || tag, left = anchor ? anchor.right + gap : inset;
      /* NEVER REACHES THE GAME'S NAME: it stops a gap short of the name as painted (TRIVIA is short, MUSICAL
         BINGO is long), and never past 13% of the screen's width beyond its own start. */
      var stop = Math.min(tl ? tl.left - gap : 0.42 * W, left + 0.13 * W);
      var mw = Math.round(Math.max(0.06 * W, stop - left));
      s.left = Math.round(left) + "px";
      s.maxWidth = mw + "px";
      img.style.height = Math.round(ih) + "px"; img.style.maxWidth = mw + "px";
      /* CENTRED ON THE LOGOS' LINE, BUT NEVER HIGHER THAN THE LOGOS THEMSELVES (15 Nov 2026): a TV that crops its
         edges would cut it. Its top is no higher than the higher of the venue's logo (or name) and our mark. */
      var h = el.offsetHeight || ih, mid = anchor ? anchor.top + anchor.height / 2 : inset + h / 2;
      var floor = anchor ? anchor.top : inset;
      try {
        var mk = w.VPVenueLogo && w.VPVenueLogo.markBox ? w.VPVenueLogo.markBox(d.querySelector(".tv-corner")) : null;
        if (mk && mk.height) floor = Math.min(floor, mk.top);
      } catch (e) {}
      s.top = Math.round(Math.max(inset, floor, mid - h / 2)) + "px";
      s.bottom = "auto";
    }
    var lk = "";
    if (line && !line.hidden && tl) {
      var lw = Math.round(0.5 * W), mx = tl.left + tl.width / 2;
      line.style.width = lw + "px"; line.style.maxWidth = lw + "px";
      line.style.left = Math.round(mx - lw / 2) + "px";
      line.style.top = Math.round(tl.bottom + Math.max(2, 0.004 * H)) + "px";
      lk = line.style.left + "," + line.style.top;
    }
    if (band && !band.hidden) { band.style.height = Math.round(BAND * H) + "px"; lk += "," + band.style.height; }
    var at = s.left + "," + s.top + "," + img.style.height + "," + el.offsetWidth + "," + el.offsetHeight + "," + lk;
    if (at !== placedAt) {
      placedAt = at;
      /* the band is a keep-out, and the line and the logo ride on the logos; re-fit the wall when they move */
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
      placedAt = "";
      var tls = d.querySelectorAll(".toplbl[data-fit-ignore]");
      for (var i = 0; i < tls.length; i++) tls[i].removeAttribute("data-fit-ignore");
      try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {}
      return;
    }
    make();
    var img = el.querySelector(".hb-logo");
    line.textContent = "";
    line.appendChild(d.createTextNode("hosted by "));
    var b = d.createElement("b"); b.textContent = c.name; line.appendChild(b);
    line.hidden = false; band.hidden = false;
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
                   place: place, _cards: function () { return cards; } };
})(window, document);
