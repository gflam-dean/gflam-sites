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
       forget()   let go of the old night (the page's own dropStaleJoin), so "Join again" is a clean join
   ========================================================================== */
(function (root) {
  "use strict";
  var started = false;
  function overlay(forget) {
    var d = root.document;
    if (d.getElementById("vpGone")) return;
    var o = d.createElement("div");
    o.id = "vpGone"; o.setAttribute("role", "alert");
    o.style.cssText = "position:fixed;left:0;right:0;top:0;bottom:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 16px;text-align:center;background:var(--bg,#0b0b12);color:var(--text,#fff);font-family:inherit";
    var h = d.createElement("div"); h.style.cssText = "font-size:26px;font-weight:700;line-height:1.2"; h.textContent = "This game has ended";
    var p = d.createElement("div"); p.style.cssText = "font-size:16px;line-height:1.4;opacity:.85;max-width:320px"; p.textContent = "The host has closed it. When the next one starts, tap below to join.";
    var b = d.createElement("button"); b.type = "button"; b.id = "vpGoneBtn"; b.textContent = "Join again";
    b.style.cssText = "min-height:48px;padding:0 28px;border:0;border-radius:12px;font-size:17px;font-weight:700;background:var(--accent,#ff2d87);color:#fff;font-family:inherit;cursor:pointer";
    b.addEventListener("click", function () { try { forget(); } catch (e) {} root.location.reload(); });
    o.appendChild(h); o.appendChild(p); o.appendChild(b);
    d.body.appendChild(o);
  }
  function start(opts) {
    if (started || !opts || !opts.api) return;
    started = true;
    var api = String(opts.api).replace(/\/$/, ""), every = opts.every || 20000, misses = 0, shown = false;
    function look() {
      if (shown) return;
      var sid = ""; try { sid = opts.session() || ""; } catch (e) {}
      var wait = false; try { wait = !!opts.waiting(); } catch (e) {}
      if (!sid || !wait || (root.document.visibilityState && root.document.visibilityState !== "visible")) { misses = 0; return; }
      root.fetch(api + "/snapshot?session=" + encodeURIComponent(sid))
        .then(function (r) { return r.status === 404 ? { gone: true } : (r.ok ? r.json() : null); })
        .then(function (s) {
          if (s === null || shown) return;                       // could not tell: say nothing
          var gone = s.gone === true || !(s.status === "lobby" || s.status === "running" || s.status === "paused");
          if (!gone) { misses = 0; return; }
          if (++misses < 2) return;                              // twice in a row, never on one odd answer
          shown = true; overlay(opts.forget || function () {});
        }, function () {});
    }
    root.setInterval(look, every + Math.floor(Math.random() * 4000));
  }
  root.VP_WAITWATCH = { start: start };
})(typeof window !== "undefined" ? window : this);
