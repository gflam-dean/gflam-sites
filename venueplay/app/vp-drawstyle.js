/* THE DRAW STYLES (12 Nov 2026): the raffle and members draw on the TV, in Dean's chosen "real" set
   (reports/draw-real-11nov, 10 Nov): TICKET ROLL (the raffle draw), FLIP BOARD (the members draw), RACE PLATE (an option in
   Game settings, for racing and footy rooms). SILENT: no sound of any kind until the real recordings are sourced.

   One file for both TV screens (/app/raffle/screen.html and /app/members/screen.html). A screen makes a stage inside a layer:

     var ctl = VPDrawStyle.create(layerEl, { style:"ticket"|"flip"|"race", mode:"raffle"|"members", digits:3, min:1, max:150,
                                             drawSecs:9, prize:"Meat tray", venueName:"The Mini Bar", logo:"https://..." });
     ctl.start();                       the build-up begins (1.2 s of intro, then the draw time, then the win)
     ctl.setPick({ number:147, name:"Jan H." })   the server's winner, as soon as the host has it. Until it is known the
                                        roll holds on its last near miss, so the winner is never invented on the wall
     ctl.showWin(pick)                  straight to the win picture (a screen that loaded after the draw started)
     ctl.setClock("Claim within 2:59")  the claim clock under the claim line
     ctl.destroy()

   The look is laid out once at 1920 x 1080 and scaled to the TV, so 720p is the same picture. Every frame is drawn from one
   pure function of the time (render(t)), so a still at any moment is exact (ctl.seek(t)) and the suites can step through it.
   The winner is only ever the one the server picked; the near misses before it are random numbers from the range.

   Presentation only: nothing here picks, stores or sends anything. Draw time: short 6 s, normal 9 s, long 12 s (a venue
   setting, VPDrawStyle.secs(key)). ES5 on purpose (older Samsung and LG sets). Every name and prize is set as TEXT. */
(function (root) {
  "use strict";
  var LEN = { short: 6, normal: 9, long: 12 };
  var INTRO = 1.2, WIN = 7.0, K = 4;
  var STYLES = { ticket: 1, flip: 1, race: 1 };
  function secs(key) { return LEN[key] || LEN.normal; }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var ease = {
    out: function (u) { return 1 - Math.pow(1 - u, 2); },
    inOut: function (u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; },
    brand: function (u) { var a = 0, b = 1, m, i; for (i = 0; i < 24; i++) { m = (a + b) / 2; var x = 3 * (1 - m) * (1 - m) * m * .22 + 3 * (1 - m) * m * m * .36 + m * m * m; if (x < u) a = m; else b = m; } m = (a + b) / 2; return 3 * (1 - m) * (1 - m) * m + 3 * (1 - m) * m * m + m * m * m; }
  };
  function pad(n, w, c) { var s = String(n); c = c || "0"; while (s.length < w) s = c + s; return s; }

  /* THE BUILD-UP. N items pass the centre; the last K are near misses the line stops on, each stop a little longer; the winner
     (item N) lands exactly at the end of the draw. A quick spin-up and a long slow-down, then K held stops. */
  function schedule(N, K, D, moveDur) {
    var Tc = D * 0.52, Ts = D - Tc, S = 400, tab = [], acc = 0, i;
    tab[0] = 0;
    function v(u) { return Math.min(1, u / 0.07) * Math.pow(1 - u, 1.5) + 0.012; }
    for (i = 1; i <= S; i++) { acc += v((i - .5) / S); tab[i] = acc; }
    for (i = 0; i <= S; i++) tab[i] = tab[i] / acc * (N - K);
    var w = [], ws = 0; for (i = 0; i < K; i++) { w.push(Math.pow(1.38, i)); ws += w[i]; }
    var steps = [], t0 = Tc;
    for (i = 0; i < K; i++) { var len = Ts * w[i] / ws, m = Math.min(moveDur, len * .5); steps.push({ hold: t0, move: t0 + len - m, end: t0 + len }); t0 += len; }
    function pos(td) {
      if (td <= 0) return 0;
      if (td < Tc) { var x = td / Tc * S, j = Math.floor(x), f = x - j; return tab[j] + (tab[Math.min(S, j + 1)] - tab[j]) * f; }
      var base = N - K;
      for (var k = 0; k < K; k++) { var s = steps[k]; if (td < s.move) return base + k; if (td < s.end) return base + k + ease.inOut((td - s.move) / (s.end - s.move)); }
      return N;
    }
    function vel(td) { var h = 1 / 240; return (pos(td + h) - pos(td - h)) / (2 * h); }
    return { pos: pos, vel: vel, steps: steps, Tc: Tc };
  }

  /* the claim line: ONE winner line everywhere (Dean, 10 Nov). Raffle: "Bring ticket 0472 to the host."; members: the card. */
  function claimLine(mode, numStr) { return mode === "members" ? "Bring your member card to the host." : "Bring ticket " + numStr + " to the host."; }

  var CSS = [
    ".vpds{position:absolute;inset:0;overflow:hidden;background:#0A0A0B}",
    ".vpds-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;color:#fff;font-family:'Hanken Grotesk','Manrope',sans-serif}",
    ".vpds-world{position:absolute;inset:0;transform-origin:960px 520px}",
    ".vpds-prize{position:absolute;left:0;right:0;text-align:center;font:400 120px/1 Anton,sans-serif;color:#fff}",
    ".vpds-claim{position:absolute;left:0;right:0;opacity:0;text-align:center;font:700 100px/1.1 'Hanken Grotesk',sans-serif;white-space:nowrap;color:#fff}",
    ".vpds-clock{position:absolute;left:0;right:0;bottom:34px;text-align:center;font:700 44px/1 'Hanken Grotesk',sans-serif;color:#FFD93D;opacity:0}",
    /* ticket roll */
    ".vpds-strip{position:absolute;left:0;top:0;width:1920px;height:1080px}",
    ".vpds-it{position:absolute;top:0;left:0;will-change:transform}",
    ".vpds-tk{width:600px;height:320px;background:#F1EDE6;border-left:3px dashed rgba(10,10,11,.28);box-sizing:border-box;display:flex;color:#0A0A0B}",
    ".vpds-tk .body{position:relative;flex:1;padding:26px 34px 0 38px;box-sizing:border-box;min-width:0}",
    ".vpds-tk .body:before{content:'';position:absolute;top:14px;right:12px;bottom:14px;left:16px;border:3px solid #FF1F8E;border-radius:4px}",
    ".vpds-tk .vn{position:relative;font:800 27px/1 'Hanken Grotesk',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vpds-tk .lb{position:relative;font:600 22px/1 'Hanken Grotesk',sans-serif;color:#55555E;margin-top:8px}",
    ".vpds-tk .no{position:relative;font:400 178px/1 Anton,sans-serif;margin-top:6px;letter-spacing:2px;white-space:nowrap}",
    ".vpds-tk .stub{position:relative;width:150px;border-left:3px dashed rgba(10,10,11,.34);display:flex;align-items:center;justify-content:center}",
    ".vpds-tk .stub:before,.vpds-tk .stub:after{content:'';position:absolute;left:-15px;width:26px;height:26px;border-radius:50%;background:#0A0A0B}",
    ".vpds-tk .stub:before{top:-13px}.vpds-tk .stub:after{bottom:-13px}",
    ".vpds-tk .sno{transform:rotate(-90deg);font:400 66px/1 Anton,sans-serif;white-space:nowrap}",
    ".vpds-tk .sl{position:absolute;top:22px;left:0;right:0;text-align:center;font:600 19px/1 'Hanken Grotesk',sans-serif;color:#55555E}",
    ".vpds-cd{width:560px;height:353px;border-radius:26px;background:#1B1B20;border:2px solid #34343C;box-sizing:border-box;position:relative;overflow:hidden;color:#fff}",
    ".vpds-cd img{position:absolute;left:30px;top:24px;height:74px;max-width:250px;object-fit:contain;object-position:left top}",
    ".vpds-cd .ml{position:absolute;right:32px;top:34px;font:600 26px/1 'Hanken Grotesk',sans-serif;color:#A4A4AE}",
    ".vpds-cd .nm{position:absolute;left:32px;right:32px;bottom:192px;font:700 54px/1 'Hanken Grotesk',sans-serif;white-space:nowrap;overflow:hidden}",
    ".vpds-cd .no{position:absolute;left:30px;bottom:28px;font:400 168px/1 Anton,sans-serif;letter-spacing:2px;white-space:nowrap}",
    ".vpds-cd .band{position:absolute;left:0;right:0;bottom:0;height:12px;background:#FF1F8E}",
    /* flip board */
    ".vpds-board{position:absolute;left:50%;background:#121215;border:2px solid #26262C;border-radius:16px;box-sizing:border-box;transform:translateX(-50%)}",
    ".vpds-screw{position:absolute;width:18px;height:18px;border-radius:50%;background:#2B2B32;border:1px solid #34343C}",
    ".vpds-row{position:absolute;display:flex}",
    ".vpds-m{position:relative;perspective:1600px;flex:none}",
    ".vpds-h{position:absolute;left:0;right:0;overflow:hidden;background:#1F1F24;-webkit-backface-visibility:hidden;backface-visibility:hidden}",
    ".vpds-h.t{top:0;border-radius:9px 9px 0 0;transform-origin:50% 100%}",
    ".vpds-h.b{background:#1B1B1F;border-radius:0 0 9px 9px;transform-origin:50% 0}",
    ".vpds-ch{position:absolute;left:0;right:0;text-align:center;color:#F2EEE7;white-space:pre}",
    ".vpds-sh{position:absolute;top:0;right:0;bottom:0;left:0;background:#000;opacity:0}",
    ".vpds-pin{position:absolute;width:8px;background:#3A3A42;border-radius:2px;z-index:3}",
    /* race plate */
    ".vpds-grp{position:absolute;left:240px;top:228px;width:1440px;transform-origin:720px 323px}",
    ".vpds-tier{position:absolute;left:0;width:1440px;-webkit-clip-path:polygon(28px 0,100% 0,calc(100% - 28px) 100%,0 100%);clip-path:polygon(28px 0,100% 0,calc(100% - 28px) 100%,0 100%)}",
    ".vpds-top{top:0;height:100px;background:#1A1A1F}",
    ".vpds-top span{position:absolute;left:80px;top:0;font:400 76px/100px Anton,sans-serif;color:#fff;white-space:nowrap}",
    ".vpds-stripe{top:100px;height:16px;background:#FF1F8E}",
    ".vpds-plate{top:116px;height:380px;background:#FFFFFF;overflow:hidden}",
    ".vpds-reel{position:absolute;top:0;right:0;bottom:0;left:0}",
    ".vpds-ri{position:absolute;left:0;right:0;height:380px;color:#0A0A0B;will-change:transform}",
    ".vpds-ri .no{position:absolute;top:0;line-height:380px;font-family:Anton,sans-serif;font-weight:400;letter-spacing:4px;white-space:nowrap}",
    ".vpds-raffle .vpds-ri .no{left:0;right:0;text-align:center}",
    ".vpds-members .vpds-ri .no{left:110px}",
    ".vpds-wname{position:absolute;right:120px;top:0;font:400 180px/380px Anton,sans-serif;color:#0A0A0B;opacity:0;white-space:nowrap}",
    ".vpds-bot{top:496px;height:150px;background:#1A1A1F}",
    ".vpds-bot>.vpds-claim{position:absolute;left:80px;right:auto;top:0;line-height:150px;text-align:left}"
  ].join("\n");
  function addCss() {
    var d = root.document; if (!d || d.getElementById("vpdsCss")) return;
    var s = d.createElement("style"); s.id = "vpdsCss"; s.appendChild(d.createTextNode(CSS)); (d.head || d.documentElement).appendChild(s);
  }
  function el(tag, cls, parent) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* shrink a one-line text until it fits its width (never cut) */
  function fitText(node, maxw, start, floor) {
    var f = start, sp = node.firstChild && node.firstChild.nodeType === 1 ? node.firstChild : node;
    node.style.fontSize = f + "px";
    while (sp.offsetWidth > maxw && f > floor) { f -= 2; node.style.fontSize = f + "px"; }
  }

  function create(host, o) {
    addCss();
    o = o || {};
    var style = STYLES[o.style] ? o.style : "ticket";
    var members = o.mode === "members";
    var n = Math.max(1, Math.min(6, o.digits | 0 || 3));
    var DRAW = o.drawSecs > 0 ? +o.drawSecs : LEN.normal, R = INTRO + DRAW, TOTAL = R + WIN;
    var lo = o.min | 0, hi = o.max | 0; if (!(hi > lo)) { lo = 1; hi = Math.pow(10, n) - 1; }
    var span = hi - lo + 1;
    var seed = (lo * 31 + hi * 17 + n) | 0, r = rng(seed || 472);
    var st = { picked: false, winNo: "", winName: "", N: 0, items: [], S: null, started: false, t0: 0, lost: 0, last: 0, raf: 0, dead: false, clockText: "", t: 0 };
    host.innerHTML = ""; host.classList.add("vpds");
    host.classList.remove("vpds-raffle", "vpds-members"); host.classList.add(members ? "vpds-members" : "vpds-raffle");
    var stage = el("div", "vpds-stage", host);
    var world = el("div", "vpds-world", stage);
    var prizeEl = el("div", "vpds-prize", stage);
    var claimEl = el("div", "vpds-claim", style === "race" ? null : stage);
    var clockEl = el("div", "vpds-clock", stage);
    var C = { members: members, n: n, DRAW: DRAW, R: R, st: st, world: world, prizeEl: prizeEl, claimEl: claimEl, o: o };
    var view = null;

    function randNo() { return pad(lo + Math.floor(r() * span), n, members ? " " : "0"); }
    /* items: random numbers; the near misses are random too (the winner is not known yet); item N is the winner, filled in on setPick */
    function buildItems(N) {
      st.N = N; st.items = [];
      for (var i = 0; i <= N + 3; i++) st.items.push({ no: randNo(), nm: "" });
      st.items[N] = { no: members ? "?" : "?", nm: "" };
    }
    function fit() {
      var w = host.clientWidth || 1280, h = host.clientHeight || 720, s = Math.min(w / 1920, h / 1080);
      stage.style.transform = "translate(" + Math.round((w - 1920 * s) / 2) + "px," + Math.round((h - 1080 * s) / 2) + "px) scale(" + s + ")";
    }

    prizeEl.textContent = o.prize || (members ? "Members jackpot" : "");
    var views = { ticket: ticketView, flip: flipView, race: raceView };
    view = views[style](C);
    fit();

    function winText() { return st.winNo; }
    function applyClaim() {
      var line = claimLine(o.mode, st.winNo);
      claimEl.textContent = ""; var sp = el("span", "", claimEl); sp.style.whiteSpace = "nowrap"; sp.textContent = line;
      if (claimEl.parentNode) fitText(claimEl, +claimEl.getAttribute("data-maxw") || 1800, 100, 56);
    }

    function render(t) {
      st.t = t;
      view.render(t);
      prizeEl.style.opacity = ease.out(seg(t, 0.2, 0.8));
      clockEl.style.opacity = (st.clockText && t >= R + 1.5) ? ease.out(seg(t, R + 1.5, R + 2.1)) : 0;
    }
    function tick(now) {
      if (st.dead) return;
      var raw = (now - st.t0) / 1000 - st.lost;
      var freeze = view.freezeT;
      if (!st.picked && raw > freeze) { st.lost += raw - freeze; raw = freeze; }
      render(Math.min(raw, TOTAL));
      st.raf = root.requestAnimationFrame(tick);
    }
    var ctl = {
      total: TOTAL, win: R, style: style,
      start: function () {
        if (st.started) return; st.started = true; buildItemsOnce();
        st.t0 = (root.performance && performance.now) ? performance.now() : Date.now();
        render(0); st.raf = root.requestAnimationFrame(tick);
        root.addEventListener("resize", fit);
      },
      seek: function (t) { buildItemsOnce(); if (st.raf) root.cancelAnimationFrame(st.raf); st.dead = false; render(clamp(t, 0, TOTAL)); },
      setPick: function (p) {
        if (!p) return; buildItemsOnce();
        st.winNo = pad(p.number == null ? "" : p.number, n, members ? " " : "0"); st.winName = p.name ? String(p.name) : "";
        st.items[st.N] = { no: st.winNo, nm: st.winName }; st.picked = true;
        view.refresh(); applyClaim(); render(st.t);
      },
      showWin: function (p) {
        buildItemsOnce(); this.setPick(p);
        if (st.raf) root.cancelAnimationFrame(st.raf); st.started = true; render(TOTAL);
        root.addEventListener("resize", fit);
      },
      setClock: function (s) { st.clockText = s || ""; clockEl.textContent = st.clockText; render(st.t); },
      isPicked: function () { return st.picked; },
      time: function () { return st.t; },
      destroy: function () { st.dead = true; if (st.raf) root.cancelAnimationFrame(st.raf); root.removeEventListener("resize", fit); host.innerHTML = ""; host.classList.remove("vpds"); }
    };
    var built = false;
    function buildItemsOnce() {
      if (built) return; built = true;
      var N = view.N; buildItems(N); st.S = schedule(N, K, DRAW, view.moveDur); view.S = st.S;
      view.freezeT = INTRO + st.S.steps[K - 1].move - 0.02; view.after();
    }
    view.freezeT = 1e9;
    /* the item count depends on the style (how many fit per second), known before the build */
    root.__vpdsLast = ctl;   // the last stage made, for the Chrome suite to read its clock
    return ctl;

    /* ------------------------------------------------------------------------------------------------ TICKET ROLL */
    function ticketView(c) {
      var POOL = 9, pitch = members ? 608 : 600, W = members ? 560 : 600, H = members ? 353 : 320;
      var v = { N: Math.round(c.DRAW * 5.2), moveDur: 0.26, freezeT: 1e9, S: null }, strip = el("div", "vpds-strip", c.world), els = [], k;
      var logo = o.logo || "", vname = o.venueName || "Raffle";
      var numFs = Math.min(178, Math.round(178 * 4 / Math.max(4, n)));
      for (k = 0; k < POOL; k++) {
        var d = el("div", "vpds-it", strip);
        if (members) {
          d.innerHTML = '<div class="vpds-cd"><img alt="" style="display:none"><div class="ml">Member</div><div class="nm"></div><div class="no"></div><div class="band"></div></div>';
          var im = d.querySelector("img"); if (logo) { im.src = logo; im.style.display = ""; }
          d.querySelector(".no").style.fontSize = Math.min(168, Math.round(168 * 4 / Math.max(4, n))) + "px";
        } else {
          d.innerHTML = '<div class="vpds-tk"><div class="body"><div class="vn"></div><div class="lb">Raffle ticket</div><div class="no"></div></div><div class="stub"><div class="sl">No.</div><div class="sno"></div></div></div>';
          d.querySelector(".vn").textContent = vname; d.querySelector(".no").style.fontSize = numFs + "px";
          d.querySelector(".sno").style.fontSize = Math.min(66, Math.round(66 * 4 / Math.max(4, n))) + "px";
        }
        els.push({ d: d, idx: -1, key: "", no: d.querySelector(".no"), s: d.querySelector(".sno"), nm: d.querySelector(".nm"), card: d.firstChild });
      }
      claimEl.style.top = (members ? 914 : 902) + "px"; prizeEl.style.top = (members ? 810 : 768) + "px"; if (members) prizeEl.style.fontSize = "90px";
      v.after = function () {};
      v.refresh = function () { for (var i = 0; i < els.length; i++) els[i].idx = -1; };
      v.render = function (t) {
        var S = v.S, items = st.items, N = st.N; if (!S) return;
        var td = t - INTRO, p = S.pos(clamp(td, 0, DRAW));
        var z = 0.80 + 0.20 * ease.inOut(seg(t, INTRO, R));
        var wl = seg(t, R + 0.15, R + 1.1), wle = ease.brand(wl), lift = (members ? 4 : -15) * wle;
        c.world.style.transform = "scale(" + z + ")"; c.world.style.opacity = ease.out(seg(t, 0, 0.5));
        var base = Math.floor(p) - 4, i, e;
        for (k = 0; k < POOL; k++) {
          i = base + k; e = els[k];
          if (i < 0 || i >= items.length) { e.d.style.visibility = "hidden"; continue; }
          e.d.style.visibility = "visible";
          var key = i + "|" + items[i].no + "|" + items[i].nm;
          if (e.key !== key) { e.key = key; var show = (i === N && !st.picked) ? "" : items[i].no; e.no.textContent = show; if (e.s) e.s.textContent = show; if (e.nm) e.nm.textContent = (i === N) ? items[i].nm : ""; }
          var x = (i - p) * pitch, y = 0, rot = 0, sc = 1, op = 1, sh = 0.35;
          if (i === N) { y = lift; sc = 1 + 0.8 * wle; rot = -1.2 * wle; sh = 0.35 + 0.4 * wle; e.d.style.zIndex = 5; } else e.d.style.zIndex = 1;
          if (i !== N && t > R) {
            var tear = ease.out(seg(t, R + 0.1, R + 0.4)), drop = Math.pow(seg(t, R + 0.3, R + 1.2), 2);
            var sg = i > N ? 1 : -1; x += sg * (40 * tear + 60 * drop); y = 760 * drop; rot = sg * 7 * drop; op = 1 - seg(t, R + 0.7, R + 1.2);
          }
          e.d.style.opacity = op;
          e.d.style.transform = "translate(" + (960 - W / 2 + x) + "px," + (470 - H / 2 + y) + "px) rotate(" + rot + "deg) scale(" + sc + ")";
          e.card.style.boxShadow = "0 " + (18 + 30 * (sh - .35)) + "px " + (40 + 60 * (sh - .35)) + "px rgba(0,0,0," + sh + ")";
        }
        var b = ease.brand(seg(t, R + 1.1, R + 1.7)); claimEl.style.opacity = b; claimEl.style.transform = "translateY(" + ((1 - b) * 18) + "px)";
      };
      return v;
    }

    /* ------------------------------------------------------------------------------------------------ FLIP BOARD */
    function flipView(c) {
      var FL = 0.11, v = { N: Math.round(c.DRAW * 3.6), moveDur: 0.13, freezeT: 1e9, S: null }, mods = [], nmods = [];
      var g = 18, pad0 = members ? 48 : 54, rowTarget = members ? 998 : 1134;
      var mw = Math.min(members ? 236 : 270, Math.floor((rowTarget - (n - 1) * g) / n)), mh = members ? 346 : 400;
      var rowW = n * mw + (n - 1) * g, nh = 124;
      var W = rowW + pad0 * 2, H = members ? pad0 * 2 + mh + 26 + nh : pad0 * 2 + mh;
      var bd = el("div", "vpds-board", c.world); bd.style.width = W + "px"; bd.style.height = H + "px"; bd.style.top = (members ? 160 : 168) + "px";
      [[18, 18], [W - 40, 18], [18, H - 40], [W - 40, H - 40]].forEach(function (p) { var s = el("div", "vpds-screw", bd); s.style.left = p[0] + "px"; s.style.top = p[1] + "px"; });
      var row = el("div", "vpds-row", bd); row.style.left = (W - rowW) / 2 + "px"; row.style.top = pad0 + "px"; row.style.display = "flex";
      function makeMod(parent, w, h, fs, anton, dy) {
        var gap = Math.round(h * 0.012) + 2, hh = (h - gap) / 2;
        var m = el("div", "vpds-m", parent); if (parent.children.length > 1 && parent === row) m.style.marginLeft = g + "px"; m.style.width = w + "px"; m.style.height = h + "px";
        function mk(cls, top) {
          var d = el("div", "vpds-h " + cls, m); d.style.height = hh + "px"; if (cls === "b") d.style.top = (hh + gap) + "px";
          var ch = el("div", "vpds-ch", d); ch.style.font = (anton ? 400 : 700) + " " + fs + "px/" + h + "px " + (anton ? "Anton" : "'Hanken Grotesk'") + ",sans-serif";
          ch.style.height = h + "px"; ch.style.top = (cls === "b" ? -(hh + gap) : 0) + dy + "px"; el("div", "vpds-sh", d);
          return { d: d, c: ch, s: d.lastChild };
        }
        var sT = mk("t"), sB = mk("b"), fT = mk("t"), fB = mk("b");
        [0, 1].forEach(function (q) { var p = el("div", "vpds-pin", m); p.style.height = Math.round(h * .06) + "px"; p.style.top = (hh + gap / 2 - h * .03) + "px"; p.style[q ? "right" : "left"] = "-3px"; });
        var last = [null, null];
        return { set: function (o2, n2, p, flut) {
          if (last[0] !== o2 || last[1] !== n2) { sT.c.textContent = n2; sB.c.textContent = o2; fT.c.textContent = o2; fB.c.textContent = n2; last = [o2, n2]; }
          var a = p < .5 ? Math.pow(p * 2, 1.5) : 1, b = p < .5 ? 0 : Math.pow((p - .5) * 2, 0.8);
          fT.d.style.visibility = p < .5 ? "visible" : "hidden"; fB.d.style.visibility = (p >= .5 && p < 1) ? "visible" : "hidden";
          fT.d.style.transform = "rotateX(" + (-90 * a) + "deg)"; fT.s.style.opacity = .55 * a;
          fB.d.style.transform = "rotateX(" + (90 * (1 - b)) + "deg)"; fB.s.style.opacity = .45 * (1 - b);
          sB.s.style.opacity = p < 1 ? .32 * (p < .5 ? a : (1 - b)) : 0;
          sB.d.style.transform = (p >= 1 && flut) ? "rotateX(" + flut + "deg)" : "";
          if (p >= 1) { sB.c.textContent = n2; last[0] = n2; fT.c.textContent = n2; }
        } };
      }
      var fs = Math.min(Math.round(mh * .86), Math.round(mw * 1.75));
      for (var k = 0; k < n; k++) mods.push(makeMod(row, mw, mh, fs, true, 0));
      if (members) {
        var nr = el("div", "vpds-row", bd); nr.style.left = (W - rowW) / 2 + "px"; nr.style.top = (pad0 + mh + 26) + "px";
        nmods.push(makeMod(nr, rowW, nh, 96, false, -17));
      }
      var bottom = (members ? 160 : 168) + H;
      prizeEl.style.top = (bottom + (members ? 20 : 24)) + "px"; if (members) prizeEl.style.fontSize = "90px";
      claimEl.style.top = (bottom + (members ? 132 : 174)) + "px";
      v.after = function () {};
      v.refresh = function () {};
      v.render = function (t) {
        var S = v.S, items = st.items, N = st.N; if (!S) return;
        var z = 0.84 + 0.16 * ease.inOut(seg(t, INTRO, R)); c.world.style.transform = "scale(" + z + ")";
        function state(td) {
          if (td <= 0) return { i: 0, p: 1, since: 9 };
          if (td >= DRAW) return { i: N, p: 1, since: td - DRAW };
          if (td < S.Tc) { var ps = S.pos(td), vv = S.vel(td), i = Math.floor(ps), f = ps - i, tc = vv > 0.05 ? f / vv : 9; return { i: i, p: clamp(tc / FL, 0, 1), since: tc - FL }; }
          for (var q = 0; q < S.steps.length; q++) { var s = S.steps[q], b = N - K + q;
            if (td < s.move) return { i: b, p: 1, since: td - (q ? S.steps[q - 1].end : S.Tc) };
            if (td < s.end) return { i: b + 1, p: (td - s.move) / (s.end - s.move), since: -1 }; }
          return { i: N, p: 1, since: 0 };
        }
        function flut(s) { return (s > 0 && s < 0.35) ? 5 * Math.exp(-s * 14) * Math.sin(s * 70) : 0; }
        function ch(i, k2) { var it = items[i]; if (i === N && !st.picked) return " "; return it.no.charAt(k2); }
        var td = t - INTRO, q;
        for (q = 0; q < mods.length; q++) {
          var s2 = state(td < S.Tc ? td - q * 0.014 : td);
          var oo = ch(Math.max(0, s2.i - 1), q), nn = ch(s2.i, q);
          mods[q].set(s2.p < 1 ? oo : nn, nn, s2.p, flut(s2.since));
        }
        for (q = 0; q < nmods.length; q++) {
          var s3 = state(td < S.Tc ? td - 0.03 : td);
          var o3 = s3.i - 1 >= 0 ? (s3.i - 1 === N ? items[N].nm : "") : "", n3 = s3.i === N ? (st.picked ? items[N].nm : "") : "";
          nmods[q].set(s3.p < 1 ? o3 : n3, n3, o3 === n3 ? 1 : s3.p, (o3 === n3 && s3.i < N) ? 0 : flut(s3.since));
        }
        var b2 = ease.brand(seg(t, R + 0.9, R + 1.5)); claimEl.style.opacity = b2; claimEl.style.transform = "translateY(" + ((1 - b2) * 18) + "px)";
      };
      return v;
    }

    /* ------------------------------------------------------------------------------------------------ RACE PLATE */
    function raceView(c) {
      var PITCH = 380, POOL = 5, v = { N: Math.round(c.DRAW * 4.6), moveDur: 0.2, freezeT: 1e9, S: null }, els = [];
      var grp = el("div", "vpds-grp", c.world);
      var top = el("div", "vpds-tier vpds-top", grp), tspan = el("span", "", top);
      var stripe = el("div", "vpds-tier vpds-stripe", grp);
      var plate = el("div", "vpds-tier vpds-plate", grp), reel = el("div", "vpds-reel", plate), wnm = el("div", "vpds-wname", plate);
      var bot = el("div", "vpds-tier vpds-bot", grp);
      claimEl.parentNode && claimEl.parentNode.removeChild(claimEl); bot.appendChild(claimEl); claimEl.setAttribute("data-maxw", "1290");
      prizeEl.parentNode.removeChild(prizeEl); tspan.appendChild(prizeEl);
      prizeEl.style.cssText = "position:static;display:inline;font:400 76px/100px Anton,sans-serif;text-align:left";
      var numFs = members ? Math.min(320, Math.floor(700 / (n * 0.47))) : Math.min(320, Math.floor(1300 / (n * 0.47)));
      for (var k = 0; k < POOL; k++) {
        var d = el("div", "vpds-ri", reel), no = el("div", "no", d); no.style.fontSize = numFs + "px";
        els.push({ d: d, idx: -1, key: "", no: no });
      }
      v.after = function () {};
      v.refresh = function () { for (var i = 0; i < els.length; i++) els[i].key = ""; wnm.textContent = st.winName; if (st.winName) fitText(wnm, 520, 180, 90); };
      v.render = function (t) {
        var S = v.S, items = st.items, N = st.N; if (!S) return;
        var td = t - INTRO, p = S.pos(clamp(td, 0, DRAW));
        var punch = t < R ? 0 : (t < R + 0.12 ? ease.out(seg(t, R, R + 0.12)) * 0.05 : 0.05 - 0.012 * ease.brand(seg(t, R + 0.12, R + 0.8)));
        var z = 0.82 + 0.18 * ease.inOut(seg(t, INTRO, R)) + punch; c.world.style.transform = "scale(" + z + ")";
        var a1 = ease.brand(seg(t, 0, 0.45)), a2 = ease.brand(seg(t, 0.15, 0.65));
        stripe.style.transform = "translateX(" + ((1 - a1) * -60) + "px)"; stripe.style.opacity = a1;
        top.style.transform = "translateX(" + ((1 - a1) * -60) + "px)"; top.style.opacity = a1;
        plate.style.transform = "translateX(" + ((1 - a2) * -60) + "px)"; plate.style.opacity = a2;
        var wn = ease.brand(seg(t, R + 0.15, R + 0.6)); wnm.style.opacity = wn; wnm.style.transform = "translateX(" + ((1 - wn) * 40) + "px)";
        var w = ease.brand(seg(t, R + 0.35, R + 0.85));
        bot.style.webkitClipPath = bot.style.clipPath = "polygon(28px 0," + (28 + 1412 * w) + "px 0," + (1412 * w) + "px 100%,0 100%)"; bot.style.visibility = w > 0 ? "visible" : "hidden";
        claimEl.style.opacity = ease.out(seg(t, R + 0.6, R + 1.0));
        var base = Math.floor(p) - 2;
        for (var q = 0; q < POOL; q++) {
          var i = base + q, e = els[q];
          if (i < 0 || i >= items.length) { e.d.style.visibility = "hidden"; continue; }
          e.d.style.visibility = "visible";
          var key = i + "|" + items[i].no + "|" + st.picked;
          if (e.key !== key) { e.key = key; e.no.textContent = (i === N && !st.picked) ? "" : items[i].no; }
          e.d.style.transform = "translateY(" + ((i - p) * PITCH) + "px)";
        }
      };
      return v;
    }
  }

  root.VPDrawStyle = { create: create, secs: secs, schedule: schedule, claimLine: claimLine, pad: pad, STYLES: STYLES, LEN: LEN, INTRO: INTRO, WIN: WIN, K: K };
})(typeof window !== "undefined" ? window : this);
