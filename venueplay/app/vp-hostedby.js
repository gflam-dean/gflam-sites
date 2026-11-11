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

   WHERE IT SITS (the new-look header: venue logo top left, venueplay top right, game name centred). Two
   placements for Dean to compare, "top" (the default) and "bottom"; see MODE below. Either way the header is
   exactly the height it is without the line, so the game's name and the slide never move for it. Measured
   each second, as the venueplay mark is, because the venue logo arrives and resizes after load.

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
  var el = null, shown = null, timer = null, watched = null;
  /* WHERE, two ways for Dean to compare (design review, 6 Nov 2026). The default is "top"; ?hostedat=bottom
     on a screen's link (or VPHostedBy.mode = "bottom") shows the other.
       top     beside the venue's logo, on its line: [divider] [host logo, the venue logo's height] HOSTED BY /
               the name. Kept inside the logo's own band and NOT a vp-fit keep-out, so the header is the
               same height as without it and the game's name and the slide do not move at all.
       bottom  one line along the bottom edge, left-aligned with the venue's logo: HOSTED BY [logo] the name,
               clear of the bottom for overscan (40px at 720). A vp-fit keep-out, so a slide that reaches the
               bottom (the podium) is lifted clear of it; the header never changes. */
  var MODE = /[?&]hostedat=bottom(&|$)/.test(String((w.location && w.location.search) || "")) ? "bottom" : "top";

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
      ".hostedby .hb-text{display:flex;flex-direction:column;justify-content:center;min-width:0}" +
      ".hostedby .hb-lbl{font-weight:800;font-size:max(11px,1.67vh);line-height:1.1;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.86);white-space:nowrap}" +
      ".hostedby .hb-name{font-weight:800;font-size:max(16px,2.78vh);line-height:1.15;min-width:0;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}" +
      /* top: a thin divider so the host never reads as part of the venue's own wordmark */
      ".hostedby.hb-top{gap:max(10px,1.1vh);padding-left:max(12px,1.4vh);border-left:2px solid rgba(255,255,255,.28)}" +
      ".hostedby.hb-top .hb-text{gap:max(2px,.35vh)}" +
      /* bottom: one line, label, logo, name */
      ".hostedby.hb-bottom{gap:max(10px,1.3vh)}" +
      ".hostedby.hb-bottom .hb-text{flex-direction:row;align-items:center;gap:max(10px,1.3vh)}" +
      ".hostedby.hb-bottom .hb-name{font-size:max(16px,2.6vh);-webkit-line-clamp:1;white-space:nowrap;text-overflow:ellipsis;display:block}";
    (d.head || d.documentElement).appendChild(s);
  }

  function make() {
    if (el) return el;
    css();
    el = d.createElement("div");
    el.id = "hostedBy";
    el.className = "hostedby hb-" + MODE;
    if (MODE === "bottom") el.setAttribute("data-fit-avoid", "");
    el.hidden = true;
    var img = d.createElement("img"); img.className = "hb-logo"; img.alt = ""; img.hidden = true;
    img.onload = function () { place(); };
    img.onerror = function () { img.hidden = true; place(); };
    var txt = d.createElement("span"); txt.className = "hb-text";
    var lbl = d.createElement("span"); lbl.className = "hb-lbl"; lbl.textContent = "Hosted by";
    var nm = d.createElement("span"); nm.className = "hb-name";
    if (MODE === "bottom") { el.appendChild(lbl); el.appendChild(img); el.appendChild(nm); }
    else { txt.appendChild(lbl); txt.appendChild(nm); el.appendChild(img); el.appendChild(txt); }
    (d.body || d.documentElement).appendChild(el);
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
    if (!el || el.hidden) return;
    var W = w.innerWidth || 1920, H = w.innerHeight || 1080;
    var inset = Math.max(14, Math.round(0.012 * W)), gap = Math.max(16, Math.round(0.016 * W));
    var logoEl = d.getElementById("venueLogo");
    /* The venue logo arrives, and is sized by its shape, after this line is first painted: follow it the
       moment it changes rather than on the next one-second tick. */
    if (logoEl && logoEl !== watched && typeof w.ResizeObserver === "function") {
      watched = logoEl;
      try { new w.ResizeObserver(function () { place(); }).observe(logoEl); } catch (e) {}
      try { logoEl.addEventListener("load", function () { place(); }); } catch (e) {}
    }
    var logo = visible(logoEl), tag = visible(d.getElementById("venueNameTag"));
    var img = el.querySelector(".hb-logo"), s = el.style, ih;
    if (MODE === "bottom") {
      ih = Math.round(Math.max(30, 0.052 * H));
      img.style.height = ih + "px"; img.style.maxWidth = Math.round(0.14 * W) + "px";
      s.left = Math.round(logo ? logo.left : (tag ? tag.left : inset)) + "px";   /* the venue logo's or name's own margin */
      s.top = "auto";
      s.bottom = Math.round(Math.max(40, 0.056 * H)) + "px";
      s.maxWidth = Math.round(0.5 * W) + "px";
    } else {
      /* The host's logo is 70% of the venue logo's height, so the venue's own logo stays the bigger one (a wide
         wordmark is short, so it is too), no wider than 13% of the screen; beside a venue's NAME it is 4.4% of
         the height. */
      /* NEVER SMALLER THAN ITS OWN WORDS (15 Nov 2026, the pictures for Dean): beside a wide venue wordmark or a
         venue's name the 70% rule made the host's logo about 20px tall at 720, a smudge. So it is at least as tall
         as HOSTED BY over one line of the name, and still 70% of a tall venue logo (a crest) when that is bigger. */
      var lblEl = el.querySelector(".hb-lbl"), nmEl = el.querySelector(".hb-name"), txtH = 0;
      try {   /* HOSTED BY over ONE line of the name: a long name that wraps does not blow the logo up beside a name */
        var gp = parseFloat(w.getComputedStyle(el.querySelector(".hb-text")).rowGap) || 0, nfs = parseFloat(w.getComputedStyle(nmEl).fontSize) || 0;
        txtH = Math.round(lblEl.offsetHeight + gp + 1.15 * nfs);
      } catch (e) {}
      ih = Math.max(logo ? Math.round(0.7 * logo.height) : Math.round(0.044 * H), txtH);
      img.style.height = Math.round(ih) + "px"; img.style.maxWidth = Math.round(0.13 * W) + "px";
      var anchor = logo || tag, left = anchor ? anchor.right + gap : inset;
      s.left = Math.round(left) + "px";
      /* NEVER REACHES THE GAME'S NAME: it stops a gap short of the name as painted (TRIVIA is short, MUSICAL
         BINGO is long), and never past 28% of the screen's width beyond its own start. A long name wraps to two
         lines and is then cut with an ellipsis. */
      var tl = null, tls = d.querySelectorAll(".toplbl .tl-night");
      for (var t = 0; t < tls.length; t++) { var tr = visible(tls[t]); if (tr && (!tl || tr.left < tl.left)) tl = tr; }
      var stop = Math.min(tl ? tl.left - gap : 0.42 * W, left + 0.28 * W);
      s.maxWidth = Math.round(Math.max(0.1 * W, stop - left)) + "px";
      /* CENTRED ON THE LOGOS' LINE, BUT NEVER HIGHER THAN THE LOGOS THEMSELVES (15 Nov 2026). Beside a short
         anchor (a wide wordmark, a venue's name) the two-line block is taller than the anchor, and centring it
         put HOSTED BY 14px from the top of a 720 TV, above the venue's logo and our mark, where a TV that crops
         its edges cuts it. So its top is no higher than the higher of the venue's logo (or name) and the
         venueplay mark; beside a crest, which is taller than the block, nothing changes. */
      var h = el.offsetHeight || 0, mid = anchor ? anchor.top + anchor.height / 2 : inset + h / 2;
      var floor = anchor ? anchor.top : inset;
      try {
        var mk = w.VPVenueLogo && w.VPVenueLogo.markBox ? w.VPVenueLogo.markBox(d.querySelector(".tv-corner")) : null;
        if (mk && mk.height) floor = Math.min(floor, mk.top);
      } catch (e) {}
      s.top = Math.round(Math.max(inset, floor, mid - h / 2)) + "px";
      s.bottom = "auto";
    }
    var at = MODE + s.left + "," + s.top + "," + s.bottom + "," + img.style.height + "," + el.offsetWidth + "," + el.offsetHeight;
    if (at !== placedAt) {
      placedAt = at;
      /* only "bottom" is a keep-out; re-fit the wall around it when it moves */
      if (MODE === "bottom") { try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {} }
    }
  }

  function paint(card) {
    var c = clean(card);
    var key = c ? JSON.stringify(c) : "";
    if (key === shown) return;
    shown = key;
    if (!c) { if (el) el.hidden = true; if (MODE === "bottom") { try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {} } return; }
    make();
    var img = el.querySelector(".hb-logo"), nm = el.querySelector(".hb-name");
    nm.textContent = c.name;
    if (c.logo) { img.hidden = false; img.src = c.logo; } else { img.hidden = true; img.removeAttribute("src"); }
    el.hidden = false;
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
