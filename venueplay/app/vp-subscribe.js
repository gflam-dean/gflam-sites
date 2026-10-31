/* ============================================================================
   THE MONTHLY EMAIL SIGN-UP (31 Oct 2026). Loaded by the sales pages that carry the form: the
   home page, the offer page (/nsw, /offer-<month>) and See a night.

   For the venue owner or manager who likes the look of VenuePlay but is not ready to ring us or
   open an account. The page draws the form in its OWN look (its own classes, so it reads as part
   of that page); this file only makes it work. Every form marked data-vps is wired:

     <form data-vps data-source="home">        source: home | offer | see-a-night
       input[name=email]                       required
       input[name=venue]                       optional
       input[name=website]                     the honeypot: hidden from people, a bot fills it
       [data-vps-ts]                           where Turnstile goes, only when the Worker has a key
       button[type=submit]
       [data-vps-err]                          the error line
       [data-vps-consent-text]                 the consent words, held to the Worker's VPS_CONSENT_TEXT
     </form>
     [data-vps-done] beside it, shown instead of the form once they are on the list ([data-vps-month]
     inside it gets next month's name).

   It posts to the billing Worker's POST /subscribe (api.venueplay.com.au), never to the database.
   Nothing on this page can tell anyone whether an address was already on the list or had
   unsubscribed: the Worker answers the same for both, and so does this.

   Low pressure on purpose: no pop-up, nothing that follows you down the page, no "we'll call you".
   House rules: no em dashes.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_SUBSCRIBE_API || "https://api.venueplay.com.au";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  var HAND = "hello@venueplay.com.au";

  /* The first email lands early next month, in Brisbane's calendar (UTC+10 all year). */
  function nextMonth(nowMs) {
    var d = new Date((nowMs || Date.now()) + 10 * 3600000);
    return MONTHS[(d.getUTCMonth() + 1) % 12];
  }

  /* The utm tags this visit came with: this page's own address first, then the ones the visitor
     landed with earlier in the visit (an offer email lands on /offer-nov, they read on and sign up
     from the home page). Kept for the visit only. */
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  function utmFrom(search) {
    var out = {}, any = false;
    String(search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
      var i = kv.indexOf("="); if (i < 1) return;
      var k = decodeURIComponent(kv.slice(0, i)).toLowerCase();
      if (UTM_KEYS.indexOf(k) < 0) return;
      var v = ""; try { v = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); } catch (e) { v = ""; }
      v = v.replace(/[\x00-\x1f]+/g, " ").trim().slice(0, 80);
      if (v) { out[k] = v; any = true; }
    });
    return any ? out : null;
  }
  function utm() {
    var here = utmFrom(root.location && root.location.search);
    try {
      if (here) root.sessionStorage.setItem("vpsUtm", JSON.stringify(here));
      else here = JSON.parse(root.sessionStorage.getItem("vpsUtm") || "null");
    } catch (e) {}
    return here || {};
  }

  /* ---- Cloudflare Turnstile, only when the Worker hands out a key (the same key and switch as the
     help forms, GET /help/config). Asked for the first time somebody starts typing, so a page view
     costs nothing. No key: nothing is loaded and the form is exactly as drawn. ---- */
  var tsKeyP = null, tsScriptP = null;
  function tsKey() {
    if (!tsKeyP) tsKeyP = root.fetch(API + "/help/config").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.turnstile) || null; }).catch(function () { return null; });
    return tsKeyP;
  }
  function tsScript() {
    if (root.turnstile) return Promise.resolve(root.turnstile);
    if (tsScriptP) return tsScriptP;
    tsScriptP = new Promise(function (res) {
      var sc = doc.createElement("script"); sc.async = true;
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      sc.onload = function () { res(root.turnstile || null); }; sc.onerror = function () { res(null); };
      doc.head.appendChild(sc);
    });
    return tsScriptP;
  }

  function showErr(f, text, mailto) {
    var e = f.querySelector("[data-vps-err]"); if (!e) return;
    e.textContent = text || "";
    if (mailto) {
      e.textContent = "We could not add you just now. Email ";
      var a = doc.createElement("a"); a.href = "mailto:" + HAND + "?subject=" + encodeURIComponent("Monthly email"); a.textContent = HAND;
      e.appendChild(a); e.appendChild(doc.createTextNode(" and we will add you by hand."));
    }
    e.classList.toggle("show", !!(text || mailto));
  }

  function wire(f) {
    if (f.getAttribute("data-vps-wired")) return;
    f.setAttribute("data-vps-wired", "1");
    var email = f.querySelector('input[name="email"]'), venue = f.querySelector('input[name="venue"]');
    var hp = f.querySelector('input[name="website"]'), btn = f.querySelector('button[type="submit"]');
    var done = f.parentNode && f.parentNode.querySelector("[data-vps-done]");
    var label = btn ? btn.textContent : "";
    var ts = { id: null, asked: false };
    function askTs() {
      if (ts.asked) return; ts.asked = true;
      var box = f.querySelector("[data-vps-ts]"); if (!box) return;
      tsKey().then(function (key) {
        if (!key) return;
        return tsScript().then(function (T) {
          if (!T) return;
          try { ts.id = T.render(box, { sitekey: key, appearance: "interaction-only", theme: "dark", action: "subscribe" }); } catch (e) {}
        });
      });
    }
    if (email) { email.addEventListener("focus", askTs); email.addEventListener("input", askTs); }

    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (btn && btn.disabled) return;
      var e = String((email && email.value) || "").trim();
      if (!e) { showErr(f, "Put in your email first."); if (email) email.focus(); return; }
      if (!EMAIL_RE.test(e) || e.length > 254) { showErr(f, "That email address does not look right."); if (email) email.focus(); return; }
      showErr(f, "");
      var body = { email: e, venue: String((venue && venue.value) || "").trim(), source: f.getAttribute("data-source") || "site",
                   utm: utm(), website: String((hp && hp.value) || "") };
      try { if (root.turnstile && ts.id !== null) body.turnstile = root.turnstile.getResponse(ts.id) || ""; } catch (x) {}
      if (btn) { btn.disabled = true; btn.textContent = "Adding you..."; }
      root.fetch(API + "/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
        })
        .catch(function () { return { _status: 0 }; })
        .then(function (j) {
          if (btn) { btn.disabled = false; btn.textContent = label; }
          if (j && j.ok) {
            f.hidden = true;
            if (done) {
              var m = done.querySelector("[data-vps-month]"); if (m) m.textContent = nextMonth();
              done.classList.add("show"); done.hidden = false;
            }
            try { if (typeof root.gtag === "function") root.gtag("event", "vp_subscribe", { source: body.source }); } catch (x) {}
            return;
          }
          try { if (root.turnstile && ts.id !== null) root.turnstile.reset(ts.id); } catch (x) {}
          /* Not on the Worker yet (404), the table not made yet (not_ready), or no answer at all: the
             person is told how to be added anyway, never left with a dead button. */
          if (!j || j.not_ready || j._status === 0 || j._status === 404 || j._status >= 500 && !j.error) { showErr(f, "", true); return; }
          showErr(f, j.error || "That did not go through. Please try again.");
        });
    });
  }

  function start() {
    Array.prototype.forEach.call(doc.querySelectorAll("form[data-vps]"), wire);
    utm();   // remember the tags this visit landed with, for a sign-up on a later page
  }
  root.VPSubscribe = { start: start, nextMonth: nextMonth, utmFrom: utmFrom };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : this);
