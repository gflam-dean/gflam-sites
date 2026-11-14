/* ============================================================================
   A PHONE WAITING IN THE LOBBY NEVER SITS ON "You're in" FOR EVER (website audit part 1b, 13 Nov 2026).

   The phones' lobby screen is only ever told things by the host's console. When the night they joined is
   really gone (the host closed the lobby, the night was finished, or a console lost it), nothing told the
   phone, and it said "You're in" until somebody noticed. This asks the Worker, quietly, while the phone is
   on its lobby screen, whether the night it joined is still open. Twice in a row "gone" puts one clear
   screen over the lobby with a way back; a Worker that cannot be reached says nothing at all.

     VP_WAITWATCH.start({ api, session(), waiting(), forget(), every })
       session()  the night this phone joined (the session id), or ""
       waiting()  true while the phone is on its lobby screen
       forget()   let go of the old night (the page's own dropStaleJoin), so "Join" is a clean join
   ========================================================================== */
(function (root) {
  "use strict";
  var started = false;
  /* How the ended screen keeps looking for the venue's next game (17 Nov 2026, part B of lobby wording 417).
     The Worker's /play/live answers "what is open at this venue" from a copy kept a few seconds and shared by the whole room,
     the same call every table-talker phone already makes every 30 s. Gentle backoff, a hidden page asks nothing, a hard stop. */
  var NEXT_STEPS = [30000, 30000, 30000, 60000, 60000, 60000, 120000];   // then 120 s for ever, up to NEXT_MAX looks
  var NEXT_MAX = 100;                                                     // about 3.4 hours of looking, then it stays on the Join button
  /* The venue's own code from its slug: the same hash as venueplay/play.html venueCode() and the Worker's fnvVenueCode(). */
  function venueCode(slug) {
    var s = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, ""), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var A = "ACDEFGHJKMNPQRSTUVWXYZ2345679", out = "", x = h || 1;
    for (var j = 0; j < 6; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += A[x % A.length]; }
    return out;
  }
  function overlay(forget, canWatch) {
    var d = root.document;
    if (d.getElementById("vpGone")) return;
    var o = d.createElement("div");
    o.id = "vpGone"; o.setAttribute("role", "alert");
    o.style.cssText = "position:fixed;left:0;right:0;top:0;bottom:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 16px;text-align:center;background:var(--bg,#0b0b12);color:var(--text,#fff);font-family:inherit";
    var h = d.createElement("div"); h.style.cssText = "font-size:26px;font-weight:700;line-height:1.2"; h.textContent = "This game has ended";
    var p = d.createElement("div"); p.style.cssText = "font-size:16px;line-height:1.4;opacity:.85;max-width:320px";
    p.textContent = canWatch ? "When the next one starts, it'll show up here." : "When the next one starts, tap below to join.";
    var b = d.createElement("button"); b.type = "button"; b.id = "vpGoneBtn"; b.textContent = "Join";
    b.style.cssText = "min-height:48px;padding:0 28px;border:0;border-radius:12px;font-size:17px;font-weight:700;background:var(--accent,#ff2d87);color:#fff;font-family:inherit;cursor:pointer";
    b.addEventListener("click", function () { try { forget(); } catch (e) {} root.location.reload(); });
    o.appendChild(h); o.appendChild(p); o.appendChild(b);
    d.body.appendChild(o);
  }
  function start(opts) {
    if (started || !opts || !opts.api) return;
    started = true;
    var api = String(opts.api).replace(/\/$/, ""), every = opts.every || 20000, misses = 0, shown = false;
    var slug = "", endedCode = "";                     // the venue and the join code of the night this phone was in, learned from its own snapshots
    function visible() { return !(root.document.visibilityState && root.document.visibilityState !== "visible"); }
    function note(s) {
      if (s && typeof s.venue_slug === "string" && s.venue_slug) slug = s.venue_slug;
      if (s && typeof s.join_code === "string" && s.join_code) endedCode = s.join_code;
    }
    function look() {
      if (shown) return;
      var sid = ""; try { sid = opts.session() || ""; } catch (e) {}
      var wait = false; try { wait = !!opts.waiting(); } catch (e) {}
      if (!sid || !wait || !visible()) { misses = 0; return; }
      root.fetch(api + "/snapshot?session=" + encodeURIComponent(sid))
        .then(function (r) { return r.status === 404 ? { gone: true } : (r.ok ? r.json() : null); })
        .then(function (s) {
          if (s === null || shown) return;                       // could not tell: say nothing
          note(s);
          var gone = s.gone === true || !(s.status === "lobby" || s.status === "running" || s.status === "paused");
          if (!gone) { misses = 0; return; }
          if (++misses < 2) return;                              // twice in a row, never on one odd answer
          shown = true;
          if (!slug && opts.venue) { try { slug = opts.venue() || ""; } catch (e) {} }
          overlay(opts.forget || function () {}, !!slug);
          if (slug) watchNext();
        }, function () {});
    }
    /* THE ENDED SCREEN KEEPS LOOKING FOR THE VENUE'S NEXT GAME. Only a game that is open (lobby, running, paused) is ever
       offered by /play/live, and never the join code of the night that just ended, so a finished game cannot be reopened.
       A candidate is confirmed with one fresh read (the shared copy may be a few seconds old) and must name the same code twice. */
    function watchNext() {
      var code = venueCode(slug), step = 0, looks = 0, busy = false, lastAt = 0, timer = 0, done = false;
      function later() {
        if (done || looks >= NEXT_MAX) return;
        var ms = NEXT_STEPS[Math.min(step, NEXT_STEPS.length - 1)];
        timer = root.setTimeout(ask, ms + Math.floor(Math.random() * 3000));
      }
      function live(fresh) {
        return root.fetch(api + "/play/live?code=" + encodeURIComponent(code) + (fresh ? "&fresh=1" : ""))
          .then(function (r) { return r.ok ? r.json() : null; });
      }
      function candidate(d) {
        return !!(d && d.exists !== false && d.live === true && typeof d.join_code === "string" && d.join_code && d.join_code !== endedCode);
      }
      function ask() {
        if (done || busy) return;
        if (!visible()) { later(); return; }               // a hidden page asks nothing; it asks the moment it is shown again
        busy = true; looks++; step++; lastAt = Date.now();
        live(false).then(function (d) {
          if (!candidate(d)) { busy = false; later(); return; }
          return live(true).then(function (e) {
            busy = false;
            if (candidate(e) && e.join_code === d.join_code) openIt(e); else later();
          });
        }).then(null, function () { busy = false; later(); });
      }
      function openIt(d) {
        done = true;
        try { (opts.forget || function () {})(); } catch (e) {}   // a clean join, the same as the Join button
        var f = String(d.format || ""), to = "/play?venue=" + encodeURIComponent(slug);
        if (f.indexOf("trivia") === 0) to = "/app/trivia/play?room=" + encodeURIComponent(d.join_code);
        else if (f.indexOf("musical") === 0) to = "/app/musical/play?room=" + encodeURIComponent(d.join_code);
        if (opts.open) { try { opts.open(to, d); return; } catch (e) {} }
        root.location.replace(to);
      }
      try {
        if (root.document.addEventListener) root.document.addEventListener("visibilitychange", function () {
          if (done || busy || !visible() || Date.now() - lastAt < 10000) return;   // coming back to the page: look now, not at the next tick
          root.clearTimeout(timer); ask();
        });
      } catch (e) {}
      later();
    }
    root.setInterval(look, every + Math.floor(Math.random() * 4000));
  }
  root.VP_WAITWATCH = { start: start };
})(typeof window !== "undefined" ? window : this);
