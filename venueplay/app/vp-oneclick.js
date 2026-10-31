/* "OPEN YOUR VENUEPLAY": the one-time sign-in link in the prospect welcome (/app/go#t=...).
   Dean, 28 Oct 2026: "Can we do a link to click that automatically goes to that page so there's no
   signing in with an email to confuse them why they then get a text?"

   The token arrives in the FRAGMENT, which no browser sends to a server, and is wiped from the
   address bar before anything else happens. One tap posts it to the billing Worker
   (POST /auth/one-click), which marks the link used in one conditional update and hands back a
   Supabase magic-link hash for that login; verifyOtp turns it into a session on this device, the
   same session an email code makes. Then the console opens, signed in, for their venue.

   WHY A TAP AND NOT ON PAGE LOAD. Mail scanners (Microsoft Safe Links among them, and many venues
   are on Microsoft mail) open links in a real browser before the person does. Signing in on load
   would let the scanner use the one-time link, and it would be the scanner's browser that ended up
   signed in to the venue. A scanner opens the page; it does not tap the button.

   THE 4 HOUR SIGN-OUT STILL APPLIES (compliance: opt-in player data sits behind this login). A
   sign-in here starts the shift clock exactly as a typed code does (vpShiftStart), and
   vp-session.js enforces it on every page from then on.

   AFTER THE TAP (Dean, 29 Oct 2026: "it's got to be phone number"): the console's first screen asks
   their name and mobile (vp-about-you.js), and from then on they sign in with a text code. Nothing
   here records "email" as this device's way in any more; the old key is cleared.

   Anything that goes wrong (used, expired, unknown, removed from the venue, a network fault) ends
   on THIS page, never on an email form: "That sign-in link has already been used or has expired",
   with "Send me a new link" (POST /auth/one-click/resend, the old token and the address it went to;
   the Worker sends to the login's own email and answers the same whether or not anything exists)
   and "Sign in with my mobile instead". Never an error code. */
(function (root) {
  "use strict";
  var API = "https://api.venueplay.com.au";
  var SUPA_URL = "https://ijkzgmdtwtgfkedqspxm.supabase.co";
  var SUPA_ANON = "sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb";
  var METHOD_KEY = "vpSignInWith";      // RETIRED 29 Oct 2026: it made the sign-in page open on email. Cleared, never written.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function parse(hash) {
    var out = { t: "", e: "" };
    String(hash || "").replace(/^#/, "").split("&").forEach(function (kv) {
      var i = kv.indexOf("="); if (i < 0) return;
      var k = kv.slice(0, i), v = "";
      try { v = decodeURIComponent(kv.slice(i + 1)); } catch (e) { v = ""; }
      if (k === "t" && /^[A-Za-z0-9_-]{43}$/.test(v)) out.t = v;
      if (k === "e" && EMAIL_RE.test(v) && v.length <= 200) out.e = v.toLowerCase();
    });
    return out;
  }

  function start(w) {
    var doc = w.document, ls = w.localStorage;
    function $(id) { return doc.getElementById(id); }
    var got = parse(w.location.hash);
    // Out of the address bar, the history and any screenshot before anything else happens.
    try { w.history.replaceState(null, "", "/app/go"); } catch (e) {}

    /* A VENUE IS NEVER SENT TO HQ (Dean, 29 Oct 2026). This link is a venue's, but the browser that
       opens it may already hold somebody else's session, and an HQ admin's sent /app/ straight on to
       HQ. Whatever session this device had is dropped (this device only) before anything else, so
       the only way on from here is the venue's own sign-in. */
    var client = null;
    function sb() { if (!client) client = w.supabase.createClient(SUPA_URL, SUPA_ANON); return client; }
    function leaveOtherSession() {
      try {
        var p = sb().auth.signOut({ scope: "local" });
        return (p && p.then) ? p.then(function () {}, function () {}) : Promise.resolve();
      } catch (e) { return Promise.resolve(); }
    }
    try { ls.removeItem(METHOD_KEY); } catch (e) {}

    /* THE LINK IS SPENT: say so, and offer a new one. The session this device had is dropped first
       (as before), so "Sign in with my mobile instead" can never land an HQ session in HQ. */
    var goneShown = false;
    function showGone() {
      if (goneShown) return Promise.resolve();
      goneShown = true;
      return leaveOtherSession().then(function () {
        $("goReady").hidden = true; $("goGone").hidden = false;
        if (!got.t) {
          $("goneTitle").textContent = "Let's get you in";
          $("goneSub").textContent = got.e ? "Tap below and we will email you a link that opens your account. No password." : "Sign in with a text code to your mobile.";
          $("resendBtn").textContent = "Send me a sign-in link";
        }
        if (!got.t && !got.e) {
          $("resendBtn").hidden = true;
          $("mobileLink").textContent = "Sign in with my mobile";
          $("goneNote").textContent = "No mobile on your login yet? Email support@venueplay.com.au and we will send you a new link.";
        }
      });
    }
    function resend() {
      var rb = $("resendBtn"), rm = $("resendMsg");
      if (rb.disabled) return Promise.resolve(null);
      rb.disabled = true; rb.textContent = "Sending..."; rm.className = "okmsg"; rm.textContent = "";
      return w.fetch(API + "/auth/one-click/resend", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: got.t || undefined, e: got.e || undefined }) })
        .then(function (res) {
          if (res.status === 429) {
            rb.disabled = false; rb.textContent = got.t ? "Send me a new link" : "Send me a sign-in link";
            rm.className = "okmsg warn"; rm.textContent = "Lots of tries from this network just now. Wait a few minutes, then tap again.";
            return "busy";
          }
          // One answer whatever happened, so this page never says whether an address has a login.
          rb.hidden = true;
          rm.textContent = "Done. If " + (got.e ? got.e : "that address") + " is on a VenuePlay login, a new link is on its way. It can take a minute, so check your junk folder too.";
          return "sent";
        })
        .catch(function () {
          rb.disabled = false; rb.textContent = got.t ? "Send me a new link" : "Send me a sign-in link";
          rm.className = "okmsg warn"; rm.textContent = "We could not reach VenuePlay. Check your connection and try again.";
          return "offline";
        });
    }
    $("resendBtn").addEventListener("click", resend);
    if (!got.t) { showGone(); return "no-token"; }

    var btn = $("goBtn"), msg = $("goMsg");
    var busy = false;
    btn.addEventListener("click", function () {
      if (busy) return;   // one request per tap; the Worker refuses a second use anyway
      busy = true; btn.disabled = true; btn.textContent = "Opening..."; msg.textContent = "";
      w.fetch(API + "/auth/one-click", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: got.t }) })
        .then(function (res) {
          if (res.status === 429) { return { busy: true }; }
          return res.json().catch(function () { return {}; });
        })
        .then(function (d) {
          if (d && d.busy) {
            busy = false; btn.disabled = false; btn.textContent = "Open my VenuePlay";
            msg.textContent = "Lots of tries from this network just now. Wait a few minutes, then tap again.";
            return null;
          }
          if (!d || d.ok !== true || !d.token_hash) { showGone(); return null; }
          return leaveOtherSession().then(function () { return sb().auth.verifyOtp({ token_hash: d.token_hash, type: d.type === "email" ? "email" : "magiclink" })
            .then(function (r) {
              if (!r || r.error || !r.data || !r.data.session) { showGone(); return; }
              try { ls.setItem("vpShiftStart", String(Date.now())); } catch (e) {}   // a fresh 4h shift starts now
              try { if (d.venue_id) ls.setItem("vpCurrentVenue", String(d.venue_id)); ls.removeItem("vpVenuePick"); } catch (e) {}
              w.location.replace("/app/");
            });
          });
        })
        .catch(function () { showGone(); });
    });
    return "ready";
  }

  root.VPOneClick = { start: start, parse: parse, METHOD_KEY: METHOD_KEY };
})(typeof window !== "undefined" ? window : this);
