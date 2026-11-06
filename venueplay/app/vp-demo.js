/* vp-demo.js -- THE TRY-IT DEMO'S RULES, IN ONE PLACE (Dean, 5 Nov 2026; INBOX 82, 84b, 92c, 93).

   After the no-card start, a new venue plays a 5-question trivia round on ITS OWN venue through the one
   trivia engine: the real host console (/app/trivia/host.html?demo=auto|host), the real TV (/tv?venue=) and
   the real phone (/app/trivia/play.html). This file is what those pages and /app/try.html share, so the
   rules have one answer each:

     clampPlayers(v)        "How many players will join?": a whole number, default 1, up to 10 ("Up to 10
                            for the demo"). 50 typed is 10. The game Worker holds the same 10 at /join, and
                            never bills a demo whatever is typed (migration 172, is_demo).
     shouldReveal(left, answered, expected, joined)
                            THE AUTO RULE: an answer goes up when the 30-second timer runs out OR when that
                            many players have all answered, whichever comes first. "That many" is what they
                            said, or fewer if fewer joined (the round was started early).
     deviceKind(w, h, touch) phone, tablet or computer, from the screen and touch. Only a hint for the
                            wording: the page ASKS "Have you got another device handy?" rather than assume.
     plan(o)                which screens this device shows for the two choices and the device answer.
     prefillHash(d) / readPrefill(hash) / applyPrefill(doc, d)
                            the player's join screen filled from sign-up (name, email, mobile) on THEIR OWN
                            phone: carried in the address's #fragment, which is never sent to a server or
                            logged, and wiped from the address as soon as it is read. The offers tick is
                            NEVER ticked by this: consent is the player's own tap (vp-consent.js).
     playUrl / hostUrl / tvUrl   the three addresses, venueplay.com.au only.

   Plain ES5, no dependencies. Tested by tools/test-vp-demo.js (jsc) and tools/try-demo-in-chrome.test.py.
   No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  var MAX = 10, QUESTIONS = 5, SECONDS = 30;
  /* NO SECOND DEVICE, NO DEMO (Dean, 6 Nov 2026 ~11:40): "Have you got another device handy?" No goes straight
     into their account (the console home, where the setup wizard opens). The one-screen demo is not built, and the
     phone-only mini demo (the player and the game on one phone) is OFF: it is here, behind this switch, not finished
     or tested end to end. Turn it on only after tools/try-demo-in-chrome.test.py plays it green. */
  var PHONE_ONLY = false;
  var ORIGIN = "https://venueplay.com.au";
  /* The page's own origin (a local preview stays local), else venueplay.com.au. Never a .dev host. */
  function origin() {
    var o = ""; try { o = String(root.location && root.location.origin || ""); } catch (e) { o = ""; }
    return (/^https?:\/\//.test(o) && !/\.dev(:|$)/.test(o)) ? o : ORIGIN;
  }

  function clampPlayers(v) {
    var t = String(v == null ? "" : v).trim(), n = parseInt(t, 10);
    if (isNaN(n)) n = parseInt(t.replace(/[^0-9]/g, ""), 10);     // "about 6" is 6
    if (!isFinite(n) || n < 1) return 1;
    return n > MAX ? MAX : n;
  }

  function shouldReveal(left, answered, expected, joined) {
    if (!(left > 0)) return true;                                  // the 30 seconds are up
    var want = clampPlayers(expected);
    var j = parseInt(joined, 10);
    if (j > 0 && j < want) want = j;                               // started with fewer: all of THEM
    return (parseInt(answered, 10) || 0) >= want;                  // everyone in has answered
  }

  function deviceKind(w, h, touch) {
    w = +w || 0; h = +h || 0;
    var short = Math.min(w || h, h || w);
    if (short && short < 600) return "phone";
    if (touch && Math.max(w, h) <= 1366) return "tablet";
    return "computer";
  }

  /* o.mode "player" (1, the game runs itself) or "host" (2, another device is the console);
     o.device "phone" | "tablet" | "computer"; o.other: they have another device handy.
     -> { tv: this screen shows the TV, player: this screen is the player, driver: this screen runs the
          game itself (hidden console, auto), hostLink: show the host console link, playerQr: show the QR
          for their phone, tvCode: show "open venueplay.com.au/tv and type this code", skip: no second device,
          so no demo, straight into their account. o.phoneOnly forces the switched-off phone-only demo (tests). } */
  function plan(o) {
    o = o || {};
    var host = o.mode === "host", phone = o.device === "phone";
    var p = { tv: false, player: false, driver: false, hostLink: false, playerQr: false, tvCode: false, phoneOnly: false, skip: false };
    if (!o.other && !(phone && (o.phoneOnly === true || PHONE_ONLY))) { p.skip = true; return p; }   // no second device: straight to the account
    if (phone) {
      p.player = true;
      if (o.other) { p.tvCode = true; if (host) p.hostLink = true; else p.driver = true; }
      else { p.phoneOnly = true; p.driver = true; }                // the phone-only mini demo: question, answers, score, result
    } else {
      p.tv = true; p.playerQr = true;                              // this screen is the TV, their phone joins by QR
      if (host) p.hostLink = true; else p.driver = true;
    }
    return p;
  }

  /* base64url of a small JSON, by hand: no btoa on every engine, and none of the fields can hold more than
     plain text. */
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function utf8(s) { return encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }); }
  function deUtf8(s) {
    var t = ""; for (var i = 0; i < s.length; i++) t += "%" + ("0" + s.charCodeAt(i).toString(16)).slice(-2);
    try { return decodeURIComponent(t); } catch (e) { return ""; }
  }
  function enc64(s) {
    s = utf8(s); var out = "";
    for (var i = 0; i < s.length; i += 3) {
      var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
      var n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (isNaN(b) ? "" : B64[(n >> 6) & 63]) + (isNaN(c) ? "" : B64[n & 63]);
    }
    return out;
  }
  function dec64(t) {
    t = String(t || ""); if (!/^[A-Za-z0-9_-]*$/.test(t)) return "";
    var out = "", buf = 0, bits = 0;
    for (var i = 0; i < t.length; i++) {
      buf = (buf << 6) | B64.indexOf(t[i]); bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
    }
    return deUtf8(out);
  }
  function cleanDetails(d) {
    d = d || {};
    var name = String(d.name || d.first_name || "").replace(/\s+/g, " ").trim().split(" ")[0].slice(0, 20);
    var email = String(d.email || "").trim().slice(0, 120);
    var mobile = String(d.mobile || "").replace(/[^0-9+ ]/g, "").trim().slice(0, 20);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) email = "";
    return { n: name, e: email, m: mobile };
  }
  function prefillHash(d) {
    var c = cleanDetails(d);
    if (!c.n && !c.e && !c.m) return "";
    return "#vpdemo=" + enc64(JSON.stringify(c));
  }
  function readPrefill(hash) {
    var m = /(?:^#|&)vpdemo=([A-Za-z0-9_-]+)/.exec(String(hash || ""));
    if (!m) return null;
    var o = null; try { o = JSON.parse(dec64(m[1])); } catch (e) { o = null; }
    if (!o || typeof o !== "object") return null;
    var c = cleanDetails({ name: o.n, email: o.e, mobile: o.m });
    return (c.n || c.e || c.m) ? c : null;
  }
  /* Read once, then take it out of the address (history.replaceState), so it is not left in the phone's
     history or shared by a copied link. */
  var _held = null;
  function takePrefill(loc, hist) {
    if (_held) return _held;
    loc = loc || root.location; hist = hist || root.history;
    var d = readPrefill(loc && loc.hash);
    if (d) {
      _held = d;
      try { if (hist && hist.replaceState) hist.replaceState(null, "", String(loc.pathname || "") + String(loc.search || "")); } catch (e) {}
    }
    return _held;
  }
  /* Fill what is on the page and empty: the team name box (trivia: a team name, their first name is a
     fair start), email and mobile. Never a box the person has typed in, and never the offers tick. */
  function applyPrefill(doc, d) {
    doc = doc || root.document; d = d || _held;
    if (!doc || !d) return 0;
    var n = 0;
    function put(id, v) { var e = doc.getElementById(id); if (e && v && !e.value) { e.value = v; n++; } }
    put("nameIn", d.n); put("xEmail", d.e); put("xMobile", d.m);
    return n;
  }

  function code(c) { return String(c || "").toUpperCase().replace(/[^ACDEFGHJKMNPQRSTUVWXYZ2345679]/g, "").slice(0, 6); }
  function playUrl(joinCode, details) { return origin() + "/app/trivia/play.html?room=" + encodeURIComponent(code(joinCode)) + (details ? prefillHash(details) : ""); }
  function hostUrl(n) { return origin() + "/app/trivia/host.html?demo=host&n=" + clampPlayers(n); }
  function tvUrl(slug) { return "/tv?venue=" + encodeURIComponent(String(slug || "")) + "&intro=0"; }

  root.VPDemo = { PHONE_ONLY: PHONE_ONLY, MAX: MAX, QUESTIONS: QUESTIONS, SECONDS: SECONDS, clampPlayers: clampPlayers, shouldReveal: shouldReveal,
                  deviceKind: deviceKind, plan: plan, prefillHash: prefillHash, readPrefill: readPrefill, takePrefill: takePrefill,
                  applyPrefill: applyPrefill, playUrl: playUrl, hostUrl: hostUrl, tvUrl: tvUrl, code: code,
                  _reset: function () { _held = null; } };
})(typeof window !== "undefined" ? window : this);
