/* vp-quick-config.js -- "PLAY A QUICK GAME": THE ONE PLACE FOR ITS WORDS AND ITS ORDER (Dean, 14 Nov 2026; INBOX 412).

   ONE SETTING EACH, easy to change:
     LABEL  the button's words everywhere it appears (every element with data-vpq-label gets them). Dean has not picked the
            final wording; change it here and every button follows.
     STEPS  the order of the steps AFTER the account is made. Today ["demo","games","choices"]. The later release that asks
            "What games do you run?" BEFORE the trivia is this one line: ["games","demo","choices"]. (The form and the text
            code always come first: the account has to exist to play on it.)
     PATH   where the flow starts (the page every old "see a night" link now goes to).
   Also here: the drop-off tracking (INBOX 412 UPDATE 8) and the tap counter (UPDATE 7). An event is one step name, an
   anonymous session id (random, this browser only), where it came from, and how many taps so far. NEVER a name, a mobile,
   a venue or an address. Once signed in, the Worker ties the session id to the venue from the sign-in, not from this file.
   No em dashes, lowercase venueplay. */
(function (root) {
  "use strict";
  var doc = root.document;
  var CFG = {
    LABEL: "Play a quick game",
    STEPS: ["demo", "games", "choices"],
    DEMO_GAMES: ["trivia"],     // the games that have a quick demo. "Play another game" shows only when there are two or more (add "musical" on 1 Dec)
    SKIP_AFTER_MS: 90000,        // a laptop visitor with nobody joined after this long is offered a way on
    PATH: "/quick",
    API: root.VP_START_API || "https://api.venueplay.com.au"
  };
  /* The step names the journey store accepts (kept identical to VPJ_EVENTS in the Worker; a suite compares them). */
  var EVENTS = ["page_opened", "button_tapped", "form_started", "form_sent", "account_made", "signed_in",
    "demo_q1", "demo_q2", "demo_q3", "demo_q4", "demo_q5", "podium_seen", "games_answered",
    "card_screen_seen", "card_added", "choice_another", "choice_info", "choice_setup", "page_left"];
  var SID_KEY = "vpqSid", TAP_KEY = "vpqTaps", LAST_KEY = "vpqLast", SRC_KEY = "vpqSrc";

  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  function get(k) { try { var s = ls(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function put(k, v) { try { var s = ls(); if (s) s.setItem(k, v); } catch (e) {} }
  function sid() {
    var s = get(SID_KEY);
    if (s && /^[a-f0-9]{24}$/.test(s)) return s;
    var a = new Uint8Array(12);
    try { root.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256); }
    s = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    put(SID_KEY, s);
    return s;
  }
  /* Where they came from: website, cold_email (a per-lead link), coaster. From ?src= or ?l= on the first page, then kept. */
  function source() {
    var q = root.location ? String(root.location.search || "") : "", m;
    if (/[?&]l=/.test(q)) { put(SRC_KEY, "cold_email"); return "cold_email"; }
    if ((m = /[?&]src=(website|coaster|cold_email)(&|$)/.exec(q))) { put(SRC_KEY, m[1]); return m[1]; }
    return get(SRC_KEY) || "website";
  }
  /* Taps: every press or tap on the page since this browser began the flow. The shots page and the funnel read it. */
  function taps() { return parseInt(get(TAP_KEY) || "0", 10) || 0; }
  var tapsOn = false;
  function countTaps() {
    if (tapsOn || !doc) return; tapsOn = true;
    doc.addEventListener("pointerdown", function (e) {
      if (e && e.target && e.target.closest && e.target.closest("[data-vpq-notap]")) return;   // the demo's own frame is not a tap on our flow
      put(TAP_KEY, String(taps() + 1));
    }, true);
  }
  /* THE ONE TRACKING DOOR (the contract with the 413 tracking build, 15 Nov 2026):
       window.vpTrackStep(step, props)   step: a name in EVENTS (the 412 UPDATE 8 names); props: optional small object (never a name,
                                         mobile, email or venue name). Returns true when the step was passed on.
     /app/vp-track.js (413, loaded first) defines window.vpTrackStepImpl, which keeps the step in the journey store
     (vp_journey_events). A page without it QUEUES the step in window.__vpTrackQueue for vp-track.js to flush. This build's own
     fallback route and table were retired when 413 landed (15 Nov 2026). The taps count rides
     along in props (413 keeps "taps"). */
  var seen = {};
  function track(step, extra) {
    if (EVENTS.indexOf(step) < 0) return false;
    if (seen[step] && step !== "page_left") return false;   // once per step per page
    seen[step] = true;
    put(LAST_KEY, step);
    return true;
  }
  function vpTrackStep(step, props) {
    if (!track(step, props)) return false;
    var p = {}, k; props = props || {};
    for (k in props) p[k] = props[k];
    if (p.taps == null) p.taps = taps();
    if (typeof root.vpTrackStepImpl === "function") { try { root.vpTrackStepImpl(step, p); } catch (e) {} }
    else { (root.__vpTrackQueue = root.__vpTrackQueue || []).push([step, p, Date.now()]); }
    return true;
  }
  root.vpTrackStep = vpTrackStep;
  function labels() {
    if (!doc) return;
    var els = doc.querySelectorAll("[data-vpq-label]");
    for (var i = 0; i < els.length; i++) els[i].textContent = CFG.LABEL;
  }
  function leave() {
    var done = false;
    function once() { if (done) return; done = true; track("page_left", { last: get(LAST_KEY) || "page_opened" }); }
    if (!doc) return;
    doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") once(); });
    root.addEventListener("pagehide", once);
  }
  if (doc) {
    var go = function () {
      labels();
      /* A tap on any quick-game button on any page: the funnel's "button tapped" (and the source, from ?src= on the link). */
      doc.addEventListener("click", function (e) {
        var a = e.target && e.target.closest ? e.target.closest("[data-vpq-label]") : null;
        if (!a) return;
        var m = /[?&]src=(website|coaster|cold_email)(&|$)/.exec(String(a.getAttribute("href") || ""));
        if (m) put(SRC_KEY, m[1]);
        track("button_tapped");
      }, true);
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", go); else go();
  }
  root.VPQuick = { cfg: CFG, EVENTS: EVENTS, track: track, taps: taps, countTaps: countTaps, sid: sid, source: source, leave: leave, labels: labels,
    /* The next step after `from` in the order, or "choices" at the end. */
    next: function (from) { var i = CFG.STEPS.indexOf(from); return i >= 0 && i + 1 < CFG.STEPS.length ? CFG.STEPS[i + 1] : "choices"; },
    first: function () { return CFG.STEPS[0]; } };
})(typeof window !== "undefined" ? window : this);
