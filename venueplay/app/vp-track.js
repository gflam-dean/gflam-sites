/* vp-track.js -- JOURNEY TRACKING for venueplay (Dean, 15 Nov 2026; INBOX 413 and 412 UPDATE 8). ONE FILE, first party, no cross-site tracking.

   WHAT IT DOES
     1. The tracked link. A link in an email looks like a normal one: venueplay.com.au/offer-nov/MPYXPG (the page's own address and a
        short code). _redirects serves the page for it; this file reads the code from the path, keeps it in a first-party cookie
        (vp_lc, 90 days) so a later page or visit still knows it, and tells the Worker "this link was opened".
     2. Steps. window.vpTrackStep(step, props) sends one anonymous event. A batch goes out a moment later (or when the page is left).
     3. The quiet pre-fill. window.vpTrackLookup() asks the Worker what a code lets the page pre-fill (their own venue first, the
        games our lead data says they run, a first name). No code, or a code nobody knows, gives {found:false}: the page shows its plain form.

   WHAT AN EVENT HOLDS: a random session id (this tab), the step name, the page path (a code is cut out of it), the referrer HOST, a few
   small facts (which box, how long, mobile or email). The Worker adds the state or country Cloudflare reports and the device kind.
   NEVER: a name, mobile, email, venue name, IP address or fingerprint. A signed-in page may pass its login token so the Worker can tie
   the session to the venue from the sign-in itself; the token goes in a header, never in an event.

   WHO IS NOT COUNTED: browsers that say Do Not Track (nothing is sent; the pre-fill still works), our own robots (navigator.webdriver, as
   vp-analytics.js), and the team's own browsers (?noga=1, the same switch as vp-analytics.js). Mail scanners that fetch the page without
   running scripts never get here at all; ones that do are classed by the Worker.

   THE CONTRACT WITH PLAY A QUICK GAME (vp-quick-config.js): that file's window.vpTrackStep queues calls in window.__vpTrackQueue until
   window.vpTrackStepImpl exists. This file defines vpTrackStepImpl and flushes the queue. Pages that do not load vp-quick-config.js get
   vpTrackStep from here.

   PUBLIC SURFACE
     vpTrackStep(step, props)     true when the step was taken; false for a name the store does not know
     vpTrackCode()                the code for this browser ("MPYXPG") or ""
     vpTrackLookup()              Promise of {found, venue, first_name, games, state}
     vpTrackSource()              "website" | "cold_email" | "coaster"
     vpTrackWatchForm(map)        map = { inputId: "first_name" | "contact" | "venue" | ... }: sends field_* once, and form_abandon
                                  (field, ms on it) if the page is left before the step "form_sent" */
(function (root) {
  "use strict";
  var doc = root.document, nav = root.navigator || {};
  var API = root.VP_TRACK_API || root.VP_START_API || "https://api.venueplay.com.au";
  /* Kept identical to VPJ_EVENTS in the Worker minus the four the Worker or this file make themselves; a suite compares the lists. */
  var STEPS = ["page_opened", "button_tapped", "form_started", "form_sent", "account_made", "signed_in",
    "demo_q1", "demo_q2", "demo_q3", "demo_q4", "demo_q5", "podium_seen", "games_answered", "card_screen_seen", "card_added",
    "choice_another", "choice_info", "choice_setup", "page_left",
    "field_first_name", "field_contact", "field_venue", "contact_kind", "venue_search", "venue_search_none", "venue_picked",
    "venue_not_found", "addvenue_shown", "addvenue_typed", "form_abandon", "highlight_result",
    "enquiry_sent", "first_game"];
  var CODE_PATH = /^\/(?:offer-[a-z]+(?:-countdown)?|nsw|home|quick|gflam|coaster)\/([A-Za-z0-9]{5,7})\/?$/;
  var COOKIE = "vp_lc", SID_KEY = "vpjSid", REF_KEY = "vpjRef", HIT_KEY = "vpjHit", HUMAN_KEY = "vpjHuman", LOOK_KEY = "vpjLook";
  var queue = [], timer = null, mem = {}, lastField = null, fieldSince = 0, formDone = false, watched = {};

  function ss(k, v) {
    try { if (v === undefined) return root.sessionStorage.getItem(k); root.sessionStorage.setItem(k, v); return v; }
    catch (e) { if (v === undefined) return mem[k] || null; mem[k] = v; return v; }
  }
  function dnt() { return nav.doNotTrack === "1" || root.doNotTrack === "1" || nav.msDoNotTrack === "1"; }
  function robot() { try { return nav.webdriver === true || /HeadlessChrome|Puppeteer|Playwright|jsdom/i.test(nav.userAgent || ""); } catch (e) { return false; } }
  function teamOptOut() { try { return root.localStorage.getItem("vpNoAnalytics") === "1"; } catch (e) { return false; } }
  function off() { return dnt() || teamOptOut(); }

  function readCookie() {
    var m = /(?:^|;\s*)vp_lc=([A-Za-z0-9]{5,7})(?:;|$)/.exec((doc && doc.cookie) || "");
    return m ? m[1].toUpperCase() : "";
  }
  function writeCookie(c) {
    try { doc.cookie = COOKIE + "=" + c + "; max-age=" + (90 * 86400) + "; path=/; SameSite=Lax" + (root.location && root.location.protocol === "https:" ? "; Secure" : ""); } catch (e) {}
  }
  /* The code: from the path first (a fresh click), else the cookie. Written to the cookie when it came from the path. */
  function code() {
    var m = CODE_PATH.exec((root.location && root.location.pathname) || "");
    if (m) { var c = m[1].toUpperCase(); if (readCookie() !== c) writeCookie(c); return c; }
    return readCookie();
  }
  function source() {
    if (code()) return "cold_email";
    var s = ""; try { s = root.localStorage.getItem("vpqSrc") || ""; } catch (e) {}
    if (!s && root.location && /[?&]src=coaster\b/.test(root.location.search || "")) s = "coaster";
    return s === "coaster" ? "coaster" : "website";
  }
  function sid() {
    var s = ss(SID_KEY);
    if (s && /^[a-f0-9]{24}$/.test(s)) return s;
    var a = new Uint8Array(12);
    try { root.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256); }
    s = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return ss(SID_KEY, s);
  }
  function refHost() {
    var r = ss(REF_KEY);
    if (r !== null && r !== undefined) return r;
    var h = ""; try { h = new root.URL(doc.referrer).hostname; } catch (e) {}
    return ss(REF_KEY, h || "") || "";
  }

  function enqueue(e, p, token, venue) {
    queue.push({ e: e, p: p || {}, t: Date.now(), token: token || "", venue: venue || "" });
    if (queue.length >= 12) { flush(false); return; }
    if (!timer) timer = root.setTimeout(function () { flush(false); }, 1500);
  }
  /* Send what is queued. Two batches at most: one with the login token (so the Worker can tie the venue), one without. */
  function flush(leaving) {
    if (timer) { root.clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var q = queue; queue = [];
    var now = Date.now(), auth = [], anon = [];
    q.forEach(function (x) { (x.token ? auth : anon).push(x); });
    [anon, auth].forEach(function (list, i) {
      if (!list.length) return;
      var body = { sid: sid(), src: source(), ref: refHost(), path: root.location ? root.location.pathname : "", events: list.map(function (x) { return { e: x.e, p: x.p, age: Math.min(300000, now - x.t) }; }) };
      var c = code(); if (c) body.code = c;
      if (robot()) body.wd = true;
      var payload = JSON.stringify(body);
      try {
        if (i === 0 && leaving && nav.sendBeacon) { nav.sendBeacon(API + "/track", new root.Blob([payload], { type: "text/plain" })); return; }
        var h = { "Content-Type": "text/plain" };
        if (i === 1) { h.Authorization = "Bearer " + list[0].token; if (list[0].venue) h["X-VP-Venue"] = list[0].venue; h["Content-Type"] = "application/json"; }
        root.fetch(API + "/track", { method: "POST", headers: h, body: payload, keepalive: true }).catch(function () {});
      } catch (e) {}
    });
  }

  function vpTrackStep(step, props) {
    if (STEPS.indexOf(step) < 0) return false;
    if (off()) return false;
    if (robot()) return false;
    props = props && typeof props === "object" ? props : {};
    var token = typeof props.token === "string" ? props.token : "", venue = typeof props.venue === "string" ? props.venue : "";
    var clean = {};
    for (var k in props) { if (k !== "token" && k !== "venue" && Object.prototype.hasOwnProperty.call(props, k)) clean[k] = props[k]; }
    if (step === "form_sent") formDone = true;
    enqueue(step, clean, token, venue);
    return true;
  }

  function lookup() {
    var c = code();
    if (!c) return Promise.resolve({ found: false });
    var cached = ss(LOOK_KEY + c);
    if (cached) { try { return Promise.resolve(JSON.parse(cached)); } catch (e) {} }
    return root.fetch(API + "/track/lookup?c=" + encodeURIComponent(c)).then(function (r) { return r.json(); }).then(function (j) {
      var out = j && j.found ? { found: true, venue: String(j.venue || ""), first_name: String(j.first_name || ""), games: j.games || [], state: String(j.state || "") } : { found: false };
      ss(LOOK_KEY + c, JSON.stringify(out));
      return out;
    }).catch(function () { return { found: false }; });
  }

  /* Boxes: field_* the first time one is touched; form_abandon (the last box touched, ms on it) if the page is left before form_sent. */
  function watchForm(map) {
    if (!doc || !map) return;
    Object.keys(map).forEach(function (id) {
      var el = doc.getElementById(id), name = map[id];
      if (!el || watched[id]) return;
      watched[id] = true;
      el.addEventListener("input", function () {
        if (lastField !== name) { lastField = name; fieldSince = Date.now(); }
        if (!watched["sent:" + name]) { watched["sent:" + name] = true; vpTrackStep("field_" + name); }
      });
    });
  }
  function leaving() {
    if (lastField && !formDone && !watched.abandoned) {
      watched.abandoned = true;
      vpTrackStep("form_abandon", { field: lastField, ms: Date.now() - fieldSince });
    }
    flush(true);
  }

  /* The queue the Play a quick game page filled before this file loaded. */
  function drain() {
    var q = root.__vpTrackQueue;
    if (!q || !q.length) return;
    root.__vpTrackQueue = [];
    q.forEach(function (x) {
      if (STEPS.indexOf(x[0]) < 0 || off() || robot()) return;
      var p = x[2] ? x[1] : x[1], token = typeof p.token === "string" ? p.token : "", clean = {};
      for (var k in p) { if (k !== "token" && k !== "venue") clean[k] = p[k]; }
      queue.push({ e: x[0], p: clean, t: x[2] || Date.now(), token: token, venue: typeof p.venue === "string" ? p.venue : "" });
    });
    if (queue.length && !timer) timer = root.setTimeout(function () { flush(false); }, 1500);
  }

  /* The link opened, the page seen, and the first sign of a person (so a soft scanner flag can be lifted). */
  function start() {
    var c = code();
    if (robot()) {
      // Our own robots and headless scanners: only the link hit is sent, flagged, so the Worker can log a scanner as a scanner.
      if (c && !dnt() && !ss(HIT_KEY + c)) { ss(HIT_KEY + c, "1"); queue.push({ e: "link_hit", p: {}, t: Date.now(), token: "", venue: "" }); flush(false); }
      return;
    }
    if (off()) return;
    if (c && !ss(HIT_KEY + c)) { ss(HIT_KEY + c, "1"); enqueue("link_hit"); }
    enqueue("page_view");
    drain();
    var human = function () {
      if (ss(HUMAN_KEY)) return; ss(HUMAN_KEY, "1");
      enqueue("human");
      ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (t) { doc.removeEventListener(t, human, true); });
    };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (t) { doc.addEventListener(t, human, { capture: true, passive: true }); });
    doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") leaving(); });
    root.addEventListener("pagehide", leaving);
  }

  root.vpTrackStepImpl = function (step, props) { vpTrackStep(step, props); };
  if (typeof root.vpTrackStep !== "function") root.vpTrackStep = vpTrackStep;
  root.vpTrackCode = code;
  root.vpTrackLookup = lookup;
  root.vpTrackSource = source;
  root.vpTrackWatchForm = watchForm;
  root.__vpTrackSteps = STEPS;
  if (doc) { if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start(); }
})(typeof window !== "undefined" ? window : this);
