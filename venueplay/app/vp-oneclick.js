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

   Anything that goes wrong (used, expired, unknown, removed from the venue, a network fault) ends
   in the same place: the sign-in page, on the EMAIL option, with their address filled in and
   "That link has been used or has expired". Never an error code. */
(function (root) {
  "use strict";
  var API = "https://venueplay-api.dean-tindale.workers.dev";
  var SUPA_URL = "https://ijkzgmdtwtgfkedqspxm.supabase.co";
  var SUPA_ANON = "sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb";
  var METHOD_KEY = "vpSignInWith";      // this device's last way in: "email" | "sms" (index.html reads it)
  var PREFILL_KEY = "vpSignInPrefill";  // sessionStorage, read once by index.html and removed
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
    var doc = w.document, ls = w.localStorage, ss = w.sessionStorage;
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
    function toEmailSignIn() {
      try { ls.setItem(METHOD_KEY, "email"); } catch (e) {}
      try { if (got.e) ss.setItem(PREFILL_KEY, got.e); } catch (e) {}
      return leaveOtherSession().then(function () { w.location.replace("/app/?signin=email&gone=1"); });
    }
    if (!got.t) { toEmailSignIn(); return "no-token"; }

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
          if (!d || d.ok !== true || !d.token_hash) { toEmailSignIn(); return null; }
          return leaveOtherSession().then(function () { return sb().auth.verifyOtp({ token_hash: d.token_hash, type: d.type === "email" ? "email" : "magiclink" })
            .then(function (r) {
              if (!r || r.error || !r.data || !r.data.session) { toEmailSignIn(); return; }
              try { ls.setItem("vpShiftStart", String(Date.now())); } catch (e) {}   // a fresh 4h shift starts now
              try { ls.setItem(METHOD_KEY, "email"); } catch (e) {}                  // next time, the email option first
              try { if (d.venue_id) ls.setItem("vpCurrentVenue", String(d.venue_id)); ls.removeItem("vpVenuePick"); } catch (e) {}
              w.location.replace("/app/");
            });
          });
        })
        .catch(function () { toEmailSignIn(); });
    });
    return "ready";
  }

  root.VPOneClick = { start: start, parse: parse, METHOD_KEY: METHOD_KEY, PREFILL_KEY: PREFILL_KEY };
})(typeof window !== "undefined" ? window : this);
