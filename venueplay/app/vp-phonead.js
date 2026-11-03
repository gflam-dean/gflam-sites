/* vp-phonead.js  -- THE VENUE'S OWN AD ON THE PLAYER'S PHONE, IN ONE PLACE (4 Nov 2026).

   Dean, 3 Nov 2026 (late): "the venue ad sits in ONE fixed spot on every phone screen that shows one" (the lobby,
   "not this time", after the game, "no game on right now"), "one shared position, not per page". So there is one
   slot, <div id="vpAd" hidden></div>, placed in the page just above our logo at the foot, and the page only says
   WHEN it shows: VPPhoneAd.show(true) on a screen that carries the ad, show(false) on any other (the card, the code
   and name steps). Its look is /app/vp-phone.css (section 5).

   What it shows: "What's on at <venue>" and the venue's own TV slides, the same pictures its TV loops, swipeable,
   one every six seconds. Only picture slides with a plain https address, and only those in date (a slide's own
   starts/ends, YYYY-MM-DD, against the phone's date, the rule tv.html uses). No slides: nothing at all, never an
   empty box or a placeholder. The slides come with the join lookup (/join/info, "slides"), so this costs the phone
   no extra request.

   VPPhoneAd.set(slides, venueName)   what to show (call again whenever the venue's answer arrives)
   VPPhoneAd.show(on)                 whether this screen carries it
   VPPhoneAd.pick(slides, today)      the slides that would show (for the suites)

   ES5, no dependencies. tools/musical-newlook-in-chrome.test.py measures the slot on every screen that shows it. */
(function (root) {
  "use strict";
  var d = root.document, _slides = [], _name = "", _want = false, _timer = null, _sig = "";
  var URL_OK = /^https:\/\/[A-Za-z0-9._~:\/?#@!$&*+,;=%-]+$/;

  function today() {
    var t = new Date(), m = t.getMonth() + 1, dd = t.getDate();
    return t.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function pick(slides, t) {
    var out = [];
    if (!slides || !slides.length) return out;
    t = t || today();
    for (var i = 0; i < slides.length && out.length < 8; i++) {
      var s = slides[i];
      if (!s || typeof s !== "object" || !s.image_url) continue;
      var u = String(s.image_url);
      if (!URL_OK.test(u) || u.indexOf("&#") !== -1) continue;
      if (s.starts && t < String(s.starts)) continue;
      if (s.ends && t > String(s.ends)) continue;
      out.push(u);
    }
    return out;
  }
  function box() { return d && d.getElementById ? d.getElementById("vpAd") : null; }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }
  function paint() {
    var el = box(); if (!el) return;
    var urls = pick(_slides);
    var on = _want && urls.length > 0;
    el.hidden = !on;
    if (!on) { stop(); return; }
    var sig = _name + "\u0001" + urls.join("\u0001");
    if (sig === _sig && el.firstChild) return;
    _sig = sig; stop();
    el.innerHTML = "";
    var k = d.createElement("div"); k.className = "k";
    k.textContent = _name ? ("What's on at " + _name) : "What's on";
    var rail = d.createElement("div"); rail.className = "rail";
    var dots = d.createElement("div"); dots.className = "dots";
    for (var i = 0; i < urls.length; i++) {
      var sl = d.createElement("div"); sl.className = "slide";
      var im = d.createElement("img"); im.alt = ""; im.src = urls[i]; im.setAttribute("loading", "lazy");
      im.onerror = (function (s) { return function () { if (s.parentNode) s.parentNode.removeChild(s); }; })(sl);
      sl.appendChild(im); rail.appendChild(sl);
      var dt = d.createElement("i"); if (i === 0) dt.className = "on"; dots.appendChild(dt);
    }
    el.appendChild(k); el.appendChild(rail);
    if (urls.length > 1) el.appendChild(dots);
    function at() { var w = rail.clientWidth || 1; return Math.round(rail.scrollLeft / w); }
    function mark() { var n = at(), ds = dots.children; for (var j = 0; j < ds.length; j++) ds[j].className = j === n ? "on" : ""; }
    rail.addEventListener("scroll", mark);
    var still = false;
    try { still = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (urls.length > 1 && !still) {
      _timer = setInterval(function () {
        try { var n = (at() + 1) % rail.children.length; rail.scrollTo({ left: n * rail.clientWidth, behavior: "smooth" }); } catch (e) {}
      }, 6000);
    }
  }
  root.VPPhoneAd = {
    set: function (slides, venueName) { _slides = Array.isArray(slides) ? slides.slice(0, 40) : []; _name = String(venueName || "").trim(); paint(); },
    show: function (on) { _want = !!on; paint(); },
    pick: pick
  };
})(typeof window !== "undefined" ? window : this);
