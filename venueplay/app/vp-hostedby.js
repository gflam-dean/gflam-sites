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

   WHERE IT SITS (the new-look header: venue logo top left, venueplay top right, game name centred). Small,
   BESIDE the venue's logo, its middle on the logo's middle, so it never pushes the logo or our mark and
   adds nothing to the top band's height. With no venue logo the venue's name is top left instead, and the
   line sits UNDER the name (a long name beside it would reach the centre). Measured each second, as the
   venueplay mark is, because the venue logo arrives and resizes after load. It is a data-fit-avoid
   keep-out, so /app/vp-fit.js keeps the wall out from under it. The host's logo is drawn no bigger than
   the venue's own: no taller than the venue's logo (4.4% of the height under a venue's name), at most 5.2%
   of the screen's height and 8% of its width.

   A LOGO ONLY FROM OUR OWN STORAGE. A broadcast is signed at an enforcing venue, but not everywhere yet,
   so the TV takes a logo address only from our Supabase public bucket under venue-logos/hosts/ (where the
   billing Worker writes it), or a path on this site (the demo). Any other address and the line shows the
   name alone. The name is set as text, never as HTML. */
(function (w, d) {
  "use strict";

  var NAME_MAX = 40;
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
  var el = null, shown = null, timer = null;

  function css() {
    if (d.getElementById("vpHostedByCss")) return;
    var s = d.createElement("style");
    s.id = "vpHostedByCss";
    s.textContent =
      ".hostedby{position:fixed;z-index:60;pointer-events:none;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;" +
      "gap:.3vw;max-width:22vw;font-family:'Hanken Grotesk','Manrope',system-ui,sans-serif;color:#fff;" +
      "text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 10px rgba(0,0,0,.6)}" +
      ".hostedby[hidden]{display:none}" +
      ".hostedby .hb-lbl{font-weight:800;font-size:clamp(9px,.78vw,15px);line-height:1;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.72)}" +
      ".hostedby .hb-row{display:flex;align-items:center;gap:.6vw;max-width:100%;min-width:0}" +
      ".hostedby .hb-logo{display:block;max-height:5.2vh;max-width:8vw;width:auto;height:auto;object-fit:contain;flex:none;" +
      "filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))}" +
      ".hostedby .hb-logo[hidden]{display:none}" +
      ".hostedby .hb-name{font-weight:800;font-size:clamp(12px,1.2vw,23px);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}";
    (d.head || d.documentElement).appendChild(s);
  }

  function make() {
    if (el) return el;
    css();
    el = d.createElement("div");
    el.id = "hostedBy";
    el.className = "hostedby";
    el.setAttribute("data-fit-avoid", "");
    el.hidden = true;
    var lbl = d.createElement("span"); lbl.className = "hb-lbl"; lbl.textContent = "Hosted by";
    var row = d.createElement("span"); row.className = "hb-row";
    var img = d.createElement("img"); img.className = "hb-logo"; img.alt = ""; img.hidden = true;
    img.onload = function () { place(); };
    img.onerror = function () { img.hidden = true; place(); };
    var nm = d.createElement("span"); nm.className = "hb-name";
    row.appendChild(img); row.appendChild(nm);
    el.appendChild(lbl); el.appendChild(row);
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

  /* Beside the venue logo, middle on its middle; under the venue's name when there is no logo; else the
     corner. In px from the logo's own box, so it is right at 1280 and at 1920 alike. */
  var watched = null, placedAt = "";
  function place() {
    if (!el || el.hidden) return;
    var W = w.innerWidth || 1920, H = w.innerHeight || 1080;
    var inset = Math.max(14, Math.round(0.012 * W)), gap = Math.max(10, Math.round(0.011 * W));
    var logoEl = d.getElementById("venueLogo");
    /* The venue logo arrives, and is sized by its shape, after this line is first painted: follow it the
       moment it changes rather than on the next one-second tick. */
    if (logoEl && logoEl !== watched && typeof w.ResizeObserver === "function") {
      watched = logoEl;
      try { new w.ResizeObserver(function () { place(); }).observe(logoEl); } catch (e) {}
      try { logoEl.addEventListener("load", function () { place(); }); } catch (e) {}
    }
    var logo = visible(logoEl);
    var tag = visible(d.getElementById("venueNameTag"));
    /* Never bigger than the venue's own logo: a wide wordmark is short, so the host's logo is as short. */
    var img = el.querySelector(".hb-logo");
    if (img) img.style.maxHeight = Math.floor(Math.min(0.052 * H, logo ? logo.height : 0.044 * H)) + "px";
    var s = el.style, h = el.offsetHeight || 0;
    if (logo) {
      s.left = Math.round(logo.right + gap) + "px";
      s.top = Math.round(Math.max(inset, logo.top + logo.height / 2 - h / 2)) + "px";
    } else if (tag) {
      s.left = Math.round(tag.left) + "px";
      s.top = Math.round(tag.bottom + Math.max(8, 0.011 * H)) + "px";
    } else {
      s.left = inset + "px"; s.top = inset + "px";
    }
    var at = s.left + "," + s.top + "," + (img ? img.style.maxHeight : "") + "," + el.offsetWidth + "," + el.offsetHeight;
    if (at !== placedAt) {   // only when it moved: vp-fit re-measures the wall around the new keep-out
      placedAt = at;
      try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {}
    }
  }

  function paint(card) {
    var c = clean(card);
    var key = c ? JSON.stringify(c) : "";
    if (key === shown) return;
    shown = key;
    if (!c) { if (el) el.hidden = true; try { if (typeof w.VP_FIT === "function") w.VP_FIT(); } catch (e) {} return; }
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
