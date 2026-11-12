/* THE DRAW COUNTDOWN BAND AND FINAL TEN (13 Nov 2026, INBOX 299b, option 3 "Countdown band and a final ten"; mocks in
   reports/draw-moments-12nov). One overlay for BOTH draw TV screens (/app/raffle/screen.html, /app/members/screen.html):

     var c = VPDrawCount.make(tvEl, { mode:"raffle"|"members" });
     c.count(secsLeft, secsTotal)   a band along the bottom: "Draw in 4:59" over a pink bar that drains. From 10 seconds the
                                    screen dims and ONE huge yellow number counts down, with "Get to the screen" (members) or
                                    "Last tickets, now" (raffle). Call it again with the host's fresh figure to re-sync.
     c.cancel()                     takes the countdown away
     c.claim(secsLeft, secsTotal)   after the draw: the claim clock in the same band, big, over a yellow bar
     c.state()                      { kind:"count"|"claim"|"", secs, phase }
     c.destroy()

   OFF unless a host switched it on: the console only sends the count message when the venue's "Countdown before the draw"
   setting is on (game_prefs draw_countdown, default off), so a TV that never hears it draws nothing.
   SILENT: the sound slots are named and empty (SOUND below); nothing plays until real recordings are chosen (INBOX 316).
   The overlay is laid out once at 1920 x 1080 and scaled into the TV's safe box (the .tv box is already inside the 5% border),
   so 720p is the same picture. Every box has a fixed place: nothing moves when the digits change. */
(function (root) {
  "use strict";
  var FINAL_AT = 10;
  var SOUND = { tick: "", final: "" };   // named slots, empty on purpose (no sound chosen yet)
  function play(slot) { var u = SOUND[slot]; if (!u || !root.Audio) return; try { var a = new root.Audio(u); a.play(); } catch (e) {} }
  function fmt(secs) { secs = Math.max(0, Math.ceil(secs)); var m = Math.floor(secs / 60), s = secs % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  /* what the screen is in at this many seconds left: "band" until 10, "final" from 10 down to 1, "zero" at 0 */
  function phase(secs) { var c = Math.ceil(secs); return c <= 0 ? "zero" : (c <= FINAL_AT ? "final" : "band"); }
  function finalLine(mode) { return mode === "members" ? "Get to the screen" : "Last tickets, now"; }
  function clampFrac(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  var CSS = [
    ".vpdc{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:60;overflow:hidden}",
    ".vpdc *{box-sizing:border-box;margin:0;padding:0}",
    ".vpdc-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;color:#fff;font-family:'Hanken Grotesk','Manrope',sans-serif;line-height:normal;letter-spacing:normal;text-transform:none;text-align:left}",
    ".vpdc-dim{position:absolute;left:0;top:0;width:1920px;height:1080px;background:#0A0A0B;opacity:0}",
    ".vpdc-big{position:absolute;left:0;top:120px;width:1920px;text-align:center;font:400 560px/1 Anton,sans-serif;color:#FFD93D;opacity:0}",
    ".vpdc-line{position:absolute;left:0;top:760px;width:1920px;text-align:center;font:700 72px/1 'Hanken Grotesk',sans-serif;color:#fff;opacity:0}",
    ".vpdc-band{position:absolute;left:120px;top:924px;width:1680px;height:102px;background:#121215;border:2px solid #26262C;border-radius:18px;opacity:0}",
    ".vpdc-txt{position:absolute;left:0;top:6px;width:100%;text-align:center;font:400 60px/68px Anton,sans-serif;color:#fff;white-space:nowrap}",
    ".vpdc-txt b{font-weight:400;color:#FF1F8E}",
    ".vpdc-band.vpdc-claim .vpdc-txt b{color:#FFD93D}",
    ".vpdc-track{position:absolute;left:28px;right:28px;bottom:12px;height:10px;border-radius:5px;background:#26262C;overflow:hidden}",
    ".vpdc-fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#FF1F8E;transform-origin:0 50%}",
    ".vpdc-band.vpdc-claim .vpdc-fill{background:#FFD93D}"
  ].join("\n");
  function addCss() {
    var d = root.document; if (!d || d.getElementById("vpdcCss")) return;
    var s = d.createElement("style"); s.id = "vpdcCss"; s.appendChild(d.createTextNode(CSS)); (d.head || d.documentElement).appendChild(s);
  }
  function el(tag, cls, parent) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  function make(host, o) {
    addCss(); o = o || {};
    var mode = o.mode === "members" ? "members" : "raffle";
    var wrap = el("div", "vpdc", host), stage = el("div", "vpdc-stage", wrap);
    var dim = el("div", "vpdc-dim", stage), big = el("div", "vpdc-big", stage), line = el("div", "vpdc-line", stage);
    var band = el("div", "vpdc-band", stage), txt = el("div", "vpdc-txt", band), track = el("div", "vpdc-track", band), fill = el("div", "vpdc-fill", track);
    wrap.setAttribute("aria-hidden", "true"); wrap.setAttribute("data-vpdc", "1");
    var S = { kind: "", deadline: 0, total: 1, timer: 0, key: "", lastTick: -1, zeroAt: 0, dead: false, secs: 0, phase: "" };
    function fit() {
      var w = host.clientWidth || 1280, h = host.clientHeight || 720, s = Math.min(w / 1920, h / 1080);
      stage.style.transform = "translate(" + Math.round((w - 1920 * s) / 2) + "px," + Math.round((h - 1080 * s) / 2) + "px) scale(" + s + ")";
    }
    fit(); root.addEventListener("resize", fit);
    function left() { return (S.deadline - now()) / 1000; }
    function paint() {
      if (S.dead) return;
      var secs = S.kind ? left() : 0, ph = S.kind === "count" ? phase(secs) : (S.kind === "claim" ? "claim" : "");
      var shown = Math.max(0, Math.ceil(secs)), frac = S.kind ? clampFrac(secs / S.total) : 0;
      var key = S.kind + "|" + ph + "|" + shown + "|" + Math.round(frac * 400);
      S.secs = secs; S.phase = ph;
      if (key === S.key) return; S.key = key;
      if (!S.kind) { band.style.opacity = 0; dim.style.opacity = 0; big.style.opacity = 0; line.style.opacity = 0; return; }
      if (S.kind === "claim") {
        band.className = "vpdc-band vpdc-claim"; band.style.opacity = 1; dim.style.opacity = 0; big.style.opacity = 0; line.style.opacity = 0;
        txt.innerHTML = ""; txt.appendChild(root.document.createTextNode(shown > 0 ? "Claim within " : "Time is up. Waiting on the host."));
        if (shown > 0) { var cb = el("b", "", txt); cb.textContent = fmt(secs); }
        fill.style.transform = "scaleX(" + frac + ")";
        return;
      }
      band.className = "vpdc-band";
      if (ph === "band") {
        band.style.opacity = 1; dim.style.opacity = 0; big.style.opacity = 0; line.style.opacity = 0;
        txt.innerHTML = ""; txt.appendChild(root.document.createTextNode("Draw in ")); var b = el("b", "", txt); b.textContent = fmt(secs);
        fill.style.transform = "scaleX(" + frac + ")";
      } else {
        /* the final ten: the screen dims and one huge number takes it; the band steps out of the way */
        band.style.opacity = 0; dim.style.opacity = 0.95;
        big.textContent = ph === "zero" ? "0" : String(shown); big.style.opacity = 1;
        line.textContent = finalLine(mode); line.style.opacity = 1;
        if (S.lastTick !== shown) { S.lastTick = shown; play(ph === "zero" ? "final" : "tick"); }
        if (ph === "zero" && !S.zeroAt) S.zeroAt = now();
      }
    }
    function run() { if (!S.timer) S.timer = root.setInterval(function () { paint(); if (S.kind === "count" && S.zeroAt && now() - S.zeroAt > 8000) ctl.cancel(); }, 200); }
    var ctl = {
      count: function (secs, total) {
        secs = +secs; if (!(secs >= 0) || secs > 7200) return;
        var d = now() + secs * 1000;
        if (S.kind === "count" && Math.abs(d - S.deadline) < 1200) { if (total > 0) S.total = Math.max(S.total, +total); paint(); return; }   // a heartbeat within a second of ours changes nothing
        S.kind = "count"; S.deadline = d; S.total = Math.max(1, +total || secs); S.zeroAt = 0; S.lastTick = -1; S.key = ""; run(); paint();
      },
      claim: function (secs, total) {
        secs = +secs; if (!(secs > 0) || secs > 7200) return;
        S.kind = "claim"; S.deadline = now() + secs * 1000; S.total = Math.max(1, +total || secs); S.key = ""; run(); paint();
      },
      cancel: function () { S.kind = ""; S.key = ""; S.zeroAt = 0; paint(); if (S.timer) { root.clearInterval(S.timer); S.timer = 0; } },
      state: function () { return { kind: S.kind, secs: S.kind ? Math.max(0, Math.ceil(left())) : 0, phase: S.phase }; },
      destroy: function () { S.dead = true; if (S.timer) root.clearInterval(S.timer); root.removeEventListener("resize", fit); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
    return ctl;
  }
  /* THE CONSOLE'S SIDE (both draw consoles). The host picks minutes and taps Start; the console keeps the one clock, tells the TV the seconds left now and
     every 10 seconds (the TV counts on its own in between, so no clock has to agree with another), and at 0:00 calls onZero (the console's own draw).
       var h = VPDrawCount.host({ send:fn(msg), extra:fn()->{}, onZero:fn, onChange:fn(state) })
       h.start(300)   h.cancel(quiet)   h.resend()   h.running()   h.left()   h.destroy() */
  function host(o) {
    o = o || {};
    var H = { on: false, deadline: 0, total: 0, timer: 0, hb: 0 };
    function left() { return H.on ? Math.max(0, Math.ceil((H.deadline - now()) / 1000)) : 0; }
    function msg() { var m = { t: "count", secs: left(), total: H.total }, x = o.extra ? o.extra() : null, k; if (x) for (k in x) if (Object.prototype.hasOwnProperty.call(x, k)) m[k] = x[k]; return m; }
    function change() { if (o.onChange) o.onChange({ on: H.on, left: left(), total: H.total }); }
    function stop() { if (H.timer) { root.clearInterval(H.timer); H.timer = 0; } H.on = false; }
    var api = {
      start: function (secs) {
        secs = Math.round(+secs); if (!(secs >= 5 && secs <= 3600)) return false;
        stop(); H.on = true; H.total = secs; H.deadline = now() + secs * 1000; H.hb = now();
        if (o.send) o.send(msg());
        H.timer = root.setInterval(function () {
          if (!H.on) return;
          var l = left();
          if (l <= 0) { stop(); change(); if (o.onZero) o.onZero(); return; }
          if (now() - H.hb >= 10000) { H.hb = now(); if (o.send) o.send(msg()); }
          change();
        }, 500);
        change(); return true;
      },
      cancel: function (quiet) { var was = H.on; stop(); if (was && !quiet && o.send) o.send({ t: "count_off" }); change(); },   // quiet: the draw itself is about to take the TV
      resend: function () { if (H.on && o.send) o.send(msg()); },
      running: function () { return H.on; }, left: left,
      destroy: function () { stop(); }
    };
    return api;
  }
  root.VPDrawCount = { host: host, make: make, fmt: fmt, phase: phase, finalLine: finalLine, FINAL_AT: FINAL_AT, SOUND: SOUND };
})(typeof window !== "undefined" ? window : this);
