/* THE DRAW STYLES (12 Nov 2026): the raffle and members draw on the TV, in Dean's chosen "real" set
   (reports/draw-real-11nov, 10 Nov): TICKET ROLL (the raffle draw), FLIP BOARD (the members draw), RACE PLATE (an option in
   Game settings, for racing and footy rooms). SILENT: no sound of any kind until the real recordings are sourced.

   One file for both TV screens (/app/raffle/screen.html and /app/members/screen.html). A screen makes a stage inside a layer:

     var ctl = VPDrawStyle.create(layerEl, { style:"ticket"|"flip"|"race", mode:"raffle"|"members", digits:3, min:1, max:150,
                                             drawSecs:9, prize:"Meat tray", venueName:"The Mini Bar", logo:"https://..." });
     (more options: name = the raffle's or draw's own name, said on the ticket, the card and by the screen's title; prizeNo, prizeOf = "Prize 1 of 32";
      drawn = the numbers already drawn tonight, shown in a row along the bottom of the flip board, up to 10 with this draw's)
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
  var LEN = { fast: 3, short: 6, normal: 9, long: 12 };
  var INTRO = 1.2, WIN = 7.0, K = 4;
  var STYLES = { ticket: 1, flip: 1, race: 1 };
  function secs(key) { return LEN[key] || LEN.normal; }
  /* EVERY VENUE ON THE NEW LOOKS (Dean, 12 Nov 2026, INBOX 284): the usual look is the ticket roll for a raffle and the flip board for
     a members draw, unless the venue chose the race plate. Anything else stored ('' from the old "As now", 'now', 'as_is', 'classic',
     the other game's look) is the default, never the old draw. ONE rule for both consoles; migration 191 writes the same into every
     venue's saved settings. tools/test-draw-looks-switch.js */
  var DEFAULT_LOOK = { raffle: "ticket", members: "flip" };
  var CHOICES = { raffle: { ticket: 1, race: 1 }, members: { flip: 1, race: 1 } };
  function usual(mode, stored) {
    var m = mode === "members" ? "members" : "raffle";
    return (typeof stored === "string" && CHOICES[m].hasOwnProperty(stored)) ? stored : DEFAULT_LOOK[m];
  }
  /* the look for one draw: a real look for this game wins; anything else ("Usual", an old "classic") is the usual look */
  function lookFor(mode, usualLook, once) {
    var m = mode === "members" ? "members" : "raffle";
    return (typeof once === "string" && CHOICES[m].hasOwnProperty(once)) ? once : usual(m, usualLook);
  }
  /* THE WINNER TAKES THE SCREEN (13 Nov 2026, INBOX 285 option 2; OFF unless the venue's "Winner takes the screen" setting is on, game_prefs
     draw_winner_big, default off). A member's name from the members list is "Last,First" or "First Last": always say it First Last.
     THE ONE NAME RULE for every place a member's name is painted (the TV in every look, the members wall, the console's winner card). */
  function niceName(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    var i = s.indexOf(",");
    if (i > 0 && s.indexOf(",", i + 1) < 0) { var a = s.slice(0, i).trim(), b = s.slice(i + 1).trim(); if (a && b) s = b + " " + a; }
    return s;
  }
  /* the name on one or two rows of tiles: one row up to 11 letters, else split at the space nearest the middle */
  function nameLines(raw) {
    var s = niceName(raw).toUpperCase(); if (!s) return [];
    if (s.length <= 11 || s.indexOf(" ") < 0) return [s.slice(0, 16)];
    var mid = s.length / 2, best = -1, i;
    for (i = 0; i < s.length; i++) if (s.charAt(i) === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return [s.slice(0, best).slice(0, 16), s.slice(best + 1).slice(0, 16)];
  }
  /* named sound slots, EMPTY on purpose: Dean has not chosen a clean close-mic split-flap recording (13 Nov 2026), and crowd noise is not a stand-in.
     The flip board is built to work silent. */
  var SOUND = { "splitflap-clean-closemic": "" };
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
    /* SELF-CONTAINED (INBOX 207, 11 Nov 2026): every class here is vpds- and every box sets its own sizing, so no rule of the page
       that shows the look (a screen's own .body, its text-align, its box-sizing) can reach into it. tools/tv-drawstyle-real-pages-in-chrome.test.py */
    ".vpds *,.vpds *:before,.vpds *:after{box-sizing:border-box;margin:0;padding:0}",
    ".vpds-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;color:#fff;font-family:'Hanken Grotesk','Manrope',sans-serif;text-align:left;line-height:normal;letter-spacing:normal;text-transform:none;font-style:normal;font-weight:400;white-space:normal}",
    ".vpds-world{position:absolute;inset:0;transform-origin:960px 520px}",
    ".vpds-prize{position:absolute;left:0;right:0;text-align:center;font:400 120px/1 Anton,sans-serif;color:#fff}",
    ".vpds-claim{position:absolute;left:0;right:0;opacity:0;text-align:center;font:700 100px/1.1 'Hanken Grotesk',sans-serif;white-space:nowrap;color:#fff}",
    ".vpds-pno{position:absolute;left:0;right:0;top:118px;text-align:center;font:700 40px/1 'Hanken Grotesk',sans-serif;color:#C9C9D1;z-index:2}",
    ".vpds-drawn{position:absolute;left:0;right:0;bottom:14px;text-align:center;white-space:nowrap;font:700 30px/1 'Hanken Grotesk',sans-serif;color:#A4A4AE}",
    ".vpds-drawn span{display:inline-block;margin:0 6px;padding:8px 18px;border-radius:10px;background:#1F1F24;border:2px solid #34343C;color:#fff;font:400 44px/1 Anton,sans-serif;letter-spacing:1px;vertical-align:middle}",
    ".vpds-drawn span.vpds-new{border-color:#FF1F8E}",
    ".vpds-clock{position:absolute;left:0;right:0;bottom:34px;text-align:center;font:700 44px/1 'Hanken Grotesk',sans-serif;color:#FFD93D;opacity:0}",
    /* ticket roll */
    ".vpds-strip{position:absolute;left:0;top:0;width:1920px;height:1080px}",
    ".vpds-it{position:absolute;top:0;left:0;will-change:transform}",
    ".vpds-tk{width:600px;height:320px;background:#F1EDE6;box-sizing:border-box;display:flex;color:#0A0A0B}",
    ".vpds-tk .vpds-ticket-body{position:relative;flex:1;padding:26px 38px 0 34px;box-sizing:border-box;min-width:0}",
    ".vpds-tk .vpds-ticket-body:before{content:'';position:absolute;top:14px;right:16px;bottom:14px;left:12px;border:3px solid #FF1F8E;border-radius:4px}",
    ".vpds-tk .vpds-vn{position:relative;font:800 26px/1.1 'Hanken Grotesk',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vpds-tk .vpds-rn{position:relative;font:800 26px/1.1 'Hanken Grotesk',sans-serif;color:#C70F69;overflow-wrap:normal;word-break:normal}",
    ".vpds-tk .vpds-lb{position:relative;font:600 20px/1.1 'Hanken Grotesk',sans-serif;color:#55555E;margin-top:3px}",
    ".vpds-tk .vpds-no{position:relative;font:400 150px/1 Anton,sans-serif;margin-top:4px;letter-spacing:2px;white-space:nowrap}",
    /* THE STUB IS THE START OF THE TICKET (Dean, 13 Nov 2026, INBOX 355): a raffle book's stub is on the left, torn off at the perforation, and the two
       half-circle bites sit on that perforation line, top and bottom. The stub has its own number, so on the reel it always sits beside ITS ticket. */
    ".vpds-tk .vpds-stub{position:relative;flex:none;width:150px;border-right:3px dashed rgba(10,10,11,.34);display:flex;align-items:center;justify-content:center}",
    ".vpds-tk .vpds-stub:before,.vpds-tk .vpds-stub:after{content:'';position:absolute;right:-14.5px;width:26px;height:26px;border-radius:50%;background:#0A0A0B}",
    ".vpds-tk .vpds-stub:before{top:-13px}.vpds-tk .vpds-stub:after{bottom:-13px}",
    ".vpds-tk .vpds-sno{transform:rotate(-90deg);font:400 66px/1 Anton,sans-serif;white-space:nowrap}",
    ".vpds-tk .vpds-sl{position:absolute;top:20px;left:8px;right:8px;text-align:center;font:700 16px/1.25 'Hanken Grotesk',sans-serif;color:#55555E;overflow:hidden}",
    ".vpds-tk .vpds-sl b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800;color:#0A0A0B}",
    /* THE STUB'S WORDS FIT OR SHRINK, NEVER CUT (17 Nov 2026, staging play: "Saturday charit..." on the stub): they wrap at spaces, up to three
       lines, and fitWords() takes the size down until every word is whole on the stub. */
    ".vpds-tk .vpds-sl i{display:block;font-style:normal;white-space:normal;overflow-wrap:normal;word-break:normal;color:#C70F69}",
    ".vpds-cd{width:560px;height:353px;border-radius:26px;background:#1B1B20;border:2px solid #34343C;box-sizing:border-box;position:relative;overflow:hidden;color:#fff}",
    ".vpds-cd img{position:absolute;left:30px;top:24px;height:74px;max-width:250px;object-fit:contain;object-position:left top}",
    ".vpds-cd .vpds-ml{position:absolute;right:30px;top:36px;font:600 26px/1 'Hanken Grotesk',sans-serif;color:#A4A4AE}",
    ".vpds-cd .vpds-vt{position:absolute;left:30px;top:34px;max-width:300px;font:800 30px/1.1 'Hanken Grotesk',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vpds-cd .vpds-dnm{position:absolute;left:30px;right:30px;top:94px;font:700 28px/1.1 'Hanken Grotesk',sans-serif;color:#FF6BB8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vpds-cd .vpds-nm{position:absolute;left:32px;right:32px;top:128px;font:700 46px/1.1 'Hanken Grotesk',sans-serif;white-space:nowrap;overflow:hidden}",
    ".vpds-cd .vpds-no{position:absolute;left:30px;bottom:16px;font:400 150px/1 Anton,sans-serif;letter-spacing:2px;white-space:nowrap}",
    ".vpds-cd .vpds-band{position:absolute;left:0;right:0;bottom:0;height:12px;background:#FF1F8E}",
    /* flip board */
    ".vpds-board{position:absolute;left:50%;background:#121215;border:2px solid #26262C;border-radius:16px;box-sizing:border-box;transform:translateX(-50%)}",
    ".vpds-screw{position:absolute;width:18px;height:18px;border-radius:50%;background:#2B2B32;border:1px solid #34343C}",
    ".vpds-row{position:absolute;display:flex}",
    ".vpds-m{position:relative;perspective:1600px;flex:none}",
    ".vpds-h{position:absolute;left:0;right:0;overflow:hidden;background:#1F1F24;-webkit-backface-visibility:hidden;backface-visibility:hidden}",
    ".vpds-h.vpds-ht{top:0;border-radius:9px 9px 0 0;transform-origin:50% 100%}",
    ".vpds-h.vpds-hb{background:#1B1B1F;border-radius:0 0 9px 9px;transform-origin:50% 0}",
    ".vpds-ch{position:absolute;left:0;right:0;text-align:center;color:#F2EEE7;white-space:pre}",
    ".vpds-sh{position:absolute;top:0;right:0;bottom:0;left:0;background:#000;opacity:0}",
    ".vpds-pin{position:absolute;width:8px;background:#3A3A42;border-radius:2px;z-index:3}",
    /* race plate */
    ".vpds-grp{position:absolute;left:240px;top:228px;width:1440px;transform-origin:720px 323px}",
    ".vpds-tier{position:absolute;left:0;width:1440px}",
    ".vpds-top{top:0;height:100px;background:#1A1A1F}",
    ".vpds-top span{position:absolute;left:110px;top:0;font:400 76px/100px Anton,sans-serif;color:#fff;white-space:nowrap}",
    ".vpds-stripe{top:100px;height:16px;background:#FF1F8E}",
    ".vpds-plate{top:116px;height:380px;background:#FFFFFF;overflow:hidden}",
    ".vpds-reel{position:absolute;top:0;right:0;bottom:0;left:0}",
    ".vpds-ri{position:absolute;left:0;right:0;height:380px;color:#0A0A0B;will-change:transform}",
    ".vpds-ri .vpds-no{position:absolute;top:0;line-height:380px;font-family:Anton,sans-serif;font-weight:400;letter-spacing:4px;white-space:nowrap}",
    ".vpds-raffle .vpds-ri .vpds-no{left:0;right:0;text-align:center}",
    ".vpds-members .vpds-ri .vpds-no{left:110px}",
    ".vpds-wname{position:absolute;right:120px;top:0;font:400 180px/380px Anton,sans-serif;color:#0A0A0B;opacity:0;white-space:nowrap}",
    ".vpds-bot{top:496px;height:150px;background:#1A1A1F}",
    ".vpds-bot>.vpds-claim{position:absolute;left:110px;right:auto;top:0;line-height:150px;text-align:left}"
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
    var pnoEl = el("div", "vpds-pno", stage);
    if (o.prizeOf > 1 && o.prizeNo > 0) pnoEl.textContent = "Prize " + (o.prizeNo | 0) + " of " + (o.prizeOf | 0); else pnoEl.style.display = "none";
    var bigWin = style === "flip" && members && !!o.winnerBig;   // the winner takes the screen (off unless the venue switched it on)
    var drawnEl = (style === "flip" && !bigWin && !o.noClock) ? el("div", "vpds-drawn", stage) : null;   // the numbers-drawn strip goes with the new winner moment (INBOX 285a)
    var C = { big: bigWin, members: members, n: n, DRAW: DRAW, R: R, st: st, world: world, prizeEl: prizeEl, claimEl: claimEl, o: o };
    var view = null;

    function randNo() { return pad(lo + Math.floor(r() * span), n, members ? " " : "0"); }
    /* A number that is none of `avoid` (INBOX 355): the reel never shows the same ticket twice in a row, and the winner is never also a near miss.
       Random first; if the range is tight, the first free number in it; only a range of one ticket cannot help repeating. */
    function freshNo(avoid) {
      var k, no, v;
      for (k = 0; k < 40; k++) { no = randNo(); if (avoid.indexOf(no) < 0) return no; }
      for (v = lo; v <= hi; v++) { no = pad(v, n, members ? " " : "0"); if (avoid.indexOf(no) < 0) return no; }
      return randNo();
    }
    /* items: random numbers, none repeating inside the 8 before it; the near misses are random too (the winner is not known yet); item N is the winner, filled in on setPick */
    function buildItems(N) {
      st.N = N; st.items = [];
      var i, win = Math.min(8, Math.max(1, span - 2));
      for (i = 0; i <= N + 3; i++) {
        var avoid = []; for (var q = Math.max(0, i - win); q < i; q++) avoid.push(st.items[q].no);
        st.items.push({ no: freshNo(avoid), nm: "" });
      }
      st.items[N] = { no: "?", nm: "" };
    }
    /* the server's winner arrives after the near misses were drawn: any item that already shows that number is swapped for another, so the
       winning ticket is not seen going past just before it lands, and no two neighbours match */
    function clearWinFromReel() {
      var items = st.items, i, j;
      for (i = 0; i < items.length; i++) {
        if (i === st.N) continue;
        if (items[i].no !== st.winNo && !(i > 0 && items[i - 1].no === items[i].no)) continue;
        var avoid = [st.winNo]; for (j = Math.max(0, i - 3); j <= Math.min(items.length - 1, i + 3); j++) if (j !== i) avoid.push(items[j].no);
        items[i] = { no: freshNo(avoid), nm: "" };
      }
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
      if (claimEl.parentNode) fitText(claimEl, +claimEl.getAttribute("data-maxw") || 1800, style === "flip" ? 64 : (style === "ticket" ? (o.noClock ? 72 : 84) : 100), 40);
    }

    function render(t) {
      st.t = t;
      view.render(t);
      prizeEl.style.opacity = ease.out(seg(t, 0.2, 0.8)) * (view.prizeK ? view.prizeK(t) : 1);
      clockEl.style.opacity = (st.clockText && !o.noClock && t >= R + 1.5) ? ease.out(seg(t, R + 1.5, R + 2.1)) : 0;
      if (drawnEl) paintDrawn(t);
    }
    /* THE NUMBERS DRAWN SO FAR (flip board): they stay along the bottom, this draw's added when it lands; at most 10 */
    var drawnKey = "";
    function paintDrawn(t) {
      var prev = (o.drawn || []).slice(-9), showNew = st.picked && t >= R + 1.0, list = prev.slice();
      if (showNew) list.push(st.winNo.replace(/^\s+/, ""));
      list = list.slice(-10);
      var key = list.join(",") + "|" + (showNew ? 1 : 0);
      if (key !== drawnKey) {
        drawnKey = key; drawnEl.innerHTML = "";
        if (list.length) { var lb = el("b", "", drawnEl); lb.style.cssText = "margin-right:10px;font-weight:700"; lb.textContent = "Drawn"; }
        for (var i = 0; i < list.length; i++) { var c = el("span", showNew && i === list.length - 1 ? "vpds-new" : "", drawnEl); c.textContent = list[i]; }
      }
      drawnEl.style.opacity = list.length ? 1 : 0;
      if (showNew) { var last = drawnEl.lastChild; if (last && last.className) last.style.opacity = ease.out(seg(t, R + 1.0, R + 1.5)); }
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
        st.winNo = pad(p.number == null ? "" : p.number, n, members ? " " : "0"); st.winName = p.name ? (members ? niceName(p.name) : String(p.name)) : "";   /* a members-list name is ALWAYS First Last, every look, winner-takes-the-screen on or off (17 Nov) */
        st.items[st.N] = { no: st.winNo, nm: st.winName }; st.picked = true; clearWinFromReel();
        view.refresh(); applyClaim(); render(st.t);
      },
      showWin: function (p) {
        buildItemsOnce(); this.setPick(p);
        if (st.raf) root.cancelAnimationFrame(st.raf); st.started = true; render(TOTAL);
        root.addEventListener("resize", fit);
      },
      setClock: function (s) { st.clockText = s || ""; clockEl.textContent = st.clockText; render(st.t); },
      isPicked: function () { return st.picked; },
      showBlank: function () { st.blank = true; buildItemsOnce(); if (st.raf) root.cancelAnimationFrame(st.raf); st.started = true; render(INTRO + 0.01); root.addEventListener("resize", fit); },   // the empty board, for the countdown

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
    /* shrink a line of words until no word is wider than its box and it is no more than `lines` lines tall (never an ellipsis, never a cut word) */
    function fitWords(e, maxPx, minPx, lines) {
      if (!e || !e.textContent) return;
      for (var f = maxPx; f >= minPx; f--) {
        e.style.fontSize = f + "px"; e.style.lineHeight = "1.2";
        if (!e.clientWidth) return;                                 // not laid out (no layout yet): the next refresh measures again
        if (e.scrollWidth <= e.clientWidth + 1 && e.offsetHeight <= Math.ceil(f * 1.2 * lines) + 1) return;
      }
    }
    function ticketView(c) {
      var POOL = 9, pitch = members ? 608 : 636, W = members ? 560 : 600, H = members ? 353 : 320;
      var v = { N: Math.round(c.DRAW * 5.2), moveDur: 0.26, freezeT: 1e9, S: null }, strip = el("div", "vpds-strip", c.world), els = [], k;
      var logo = o.logo || "", vname = o.venueName || "";
      var numFs = Math.min(150, Math.round(150 * 4 / Math.max(4, n)));
      for (k = 0; k < POOL; k++) {
        var d = el("div", "vpds-it", strip);
        if (members) {
          d.innerHTML = '<div class="vpds-cd"><img alt="" style="display:none"><div class="vpds-vt"></div><div class="vpds-ml">Members draw</div><div class="vpds-dnm"></div><div class="vpds-nm"></div><div class="vpds-no"></div><div class="vpds-band"></div></div>';
          var im = d.querySelector("img"); if (logo) { im.src = logo; im.style.display = ""; } else d.querySelector(".vpds-vt").textContent = vname;
          d.querySelector(".vpds-dnm").textContent = o.name || ""; d.querySelector(".vpds-ml").style.top = logo ? "36px" : "40px";
          if (o.name) d.querySelector(".vpds-ml").style.display = "none";
          d.querySelector(".vpds-no").style.fontSize = Math.min(150, Math.round(150 * 4 / Math.max(4, n))) + "px";
        } else {
          d.innerHTML = '<div class="vpds-tk"><div class="vpds-stub"><div class="vpds-sl"><b></b><i></i></div><div class="vpds-sno"></div></div><div class="vpds-ticket-body"><div class="vpds-vn"></div><div class="vpds-lb">Raffle ticket</div><div class="vpds-rn"></div><div class="vpds-no"></div></div></div>';
          d.querySelector(".vpds-vn").textContent = vname; d.querySelector(".vpds-rn").textContent = o.name || "";
          d.querySelector(".vpds-sl b").textContent = vname; d.querySelector(".vpds-sl i").textContent = o.name || "";
          if (!vname) d.querySelector(".vpds-vn").style.display = "none"; if (!o.name) d.querySelector(".vpds-rn").style.display = "none"; d.querySelector(".vpds-no").style.fontSize = numFs + "px";
          d.querySelector(".vpds-sno").style.fontSize = Math.min(66, Math.round(66 * 4 / Math.max(4, n))) + "px";
        }
        if (!members) { fitWords(d.querySelector(".vpds-sl i"), 16, 9, 3); fitWords(d.querySelector(".vpds-rn"), 26, 15, 2); }
        els.push({ d: d, idx: -1, key: "", no: d.querySelector(".vpds-no"), s: d.querySelector(".vpds-sno"), nm: d.querySelector(".vpds-nm"), card: d.firstChild });
      }
      claimEl.style.top = (members ? 906 : 896) + "px"; clockEl.style.bottom = "12px"; clockEl.style.fontSize = "38px"; prizeEl.style.top = (members ? 810 : 768) + "px"; if (members) prizeEl.style.fontSize = "90px";
      if (o.noClock && !members) { claimEl.style.top = "820px"; prizeEl.style.top = "712px"; prizeEl.style.fontSize = "96px"; }   // the countdown band owns the bottom of the screen: the claim line and prize sit above it
      v.after = function () {};
      v.refresh = function () { for (var i = 0; i < els.length; i++) { els[i].idx = -1; if (!members) { fitWords(els[i].d.querySelector(".vpds-sl i"), 16, 9, 3); fitWords(els[i].d.querySelector(".vpds-rn"), 26, 15, 2); } } };
      if (!members && root.document && root.document.fonts && root.document.fonts.ready) root.document.fonts.ready.then(function () { if (!st.dead) v.refresh(); });   // the real font is wider than the stand-in
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
          if (i === N) { y = lift; sc = 1 + ((o.noClock && !members) ? 0.45 : 0.8) * wle; rot = -1.2 * wle; sh = 0.35 + 0.4 * wle; e.d.style.zIndex = 5; } else e.d.style.zIndex = 1;
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
      var rowW = n * mw + (n - 1) * g, nh = 124, big = !!c.big, withName = members && !big;
      var W = rowW + pad0 * 2, H = withName ? pad0 * 2 + mh + 26 + nh : pad0 * 2 + mh;
      var bd = el("div", "vpds-board", c.world); bd.style.width = W + "px"; bd.style.height = H + "px"; bd.style.top = (members ? 160 : 168) + "px";
      [[18, 18], [W - 40, 18], [18, H - 40], [W - 40, H - 40]].forEach(function (p) { var s = el("div", "vpds-screw", bd); s.style.left = p[0] + "px"; s.style.top = p[1] + "px"; });
      var row = el("div", "vpds-row", bd); row.style.left = (W - rowW) / 2 + "px"; row.style.top = pad0 + "px"; row.style.display = "flex";
      /* THE NAME ROW MUST SHOW WHOLE LETTERS AT ANY LENGTH (INBOX 426 item 6, 16 Nov 2026). It was 96 px type lifted 17 px, so the caps rode
         the top of the row, the seam sliced the foot of the letters and the descenders (g, j, y) had no room; and a long name ran past the
         flap's sides. Now the type is 88 px, centred on the seam like the digits (line-height is the row's height), and a name wider than
         the row steps down in size until it fits. */
      var meas = document.createElement("canvas").getContext("2d");
      function fitFs(txt, w, fs) {
        if (!txt || !meas) return fs;
        meas.font = "700 " + fs + "px 'Hanken Grotesk',sans-serif";
        var tw = meas.measureText(txt).width, room = w - 56;
        return tw > room ? Math.max(30, Math.floor(fs * room / tw)) : fs;
      }
      function makeMod(parent, w, h, fs, anton, dy) {
        var gap = Math.round(h * 0.012) + 2, hh = (h - gap) / 2;
        var m = el("div", "vpds-m", parent); if (parent.children.length > 1 && (parent === row || parent.__gap)) m.style.marginLeft = (parent.__gap || g) + "px"; m.style.width = w + "px"; m.style.height = h + "px";
        function mk(cls, top) {
          var d = el("div", "vpds-h " + cls, m); d.style.height = hh + "px"; if (cls === "vpds-hb") d.style.top = (hh + gap) + "px";
          var ch = el("div", "vpds-ch", d); ch.style.font = (anton ? 400 : 700) + " " + fs + "px/" + h + "px " + (anton ? "Anton" : "'Hanken Grotesk'") + ",sans-serif";
          ch.style.height = h + "px"; ch.style.top = (cls === "vpds-hb" ? -(hh + gap) : 0) + dy + "px"; el("div", "vpds-sh", d);
          return { d: d, c: ch, s: d.lastChild };
        }
        var sT = mk("vpds-ht"), sB = mk("vpds-hb"), fT = mk("vpds-ht"), fB = mk("vpds-hb");
        [0, 1].forEach(function (q) { var p = el("div", "vpds-pin", m); p.style.height = Math.round(h * .06) + "px"; p.style.top = (hh + gap / 2 - h * .03) + "px"; p.style[q ? "right" : "left"] = "-3px"; });
        function put(x, txt) { x.c.textContent = txt; if (!anton) x.c.style.fontSize = fitFs(txt, w, fs) + "px"; }
        var last = [null, null];
        return { m: m, set: function (o2, n2, p, flut) {
          if (last[0] !== o2 || last[1] !== n2) { put(sT, n2); put(sB, o2); put(fT, o2); put(fB, n2); last = [o2, n2]; }
          var a = p < .5 ? Math.pow(p * 2, 1.5) : 1, b = p < .5 ? 0 : Math.pow((p - .5) * 2, 0.8);
          fT.d.style.visibility = p < .5 ? "visible" : "hidden"; fB.d.style.visibility = (p >= .5 && p < 1) ? "visible" : "hidden";
          fT.d.style.transform = "rotateX(" + (-90 * a) + "deg)"; fT.s.style.opacity = .55 * a;
          fB.d.style.transform = "rotateX(" + (90 * (1 - b)) + "deg)"; fB.s.style.opacity = .45 * (1 - b);
          sB.s.style.opacity = p < 1 ? .32 * (p < .5 ? a : (1 - b)) : 0;
          sB.d.style.transform = (p >= 1 && flut) ? "rotateX(" + flut + "deg)" : "";
          if (p >= 1) { put(sB, n2); last[0] = n2; put(fT, n2); }
        } };
      }
      var fs = Math.min(Math.round(mh * .86), Math.round(mw * 1.75));
      for (var k = 0; k < n; k++) mods.push(makeMod(row, mw, mh, fs, true, 0));
      if (withName) {
        var nr = el("div", "vpds-row", bd); nr.style.left = (W - rowW) / 2 + "px"; nr.style.top = (pad0 + mh + 26) + "px";
        nmods.push(makeMod(nr, rowW, nh, 88, false, 0));
      }
      var bottom = (members ? 160 : 168) + H;
      prizeEl.style.top = (bottom + 16) + "px"; prizeEl.style.fontSize = (members ? 76 : 90) + "px";
      claimEl.style.top = (bottom + (members ? 16 + 76 + 12 : 16 + 90 + 12)) + "px"; claimEl.style.fontSize = "64px"; claimEl.setAttribute("data-maxw", "1700");
      clockEl.style.bottom = "88px"; clockEl.style.fontSize = "38px";
      v.after = function () {};
      /* THE WINNER TAKES THE SCREEN: after the number lands the board shrinks to the top and the name flips in on giant tiles, one letter
         after another, across one or two rows; yellow when the name is complete. Built when the server's winner is known. */
      var bigTiles = [], bigEnd = 0, bigTop = 300, bigBottom = 0, bigDone = false, T0 = R + 0.9, STAG = 0.09, FLIPD = 0.24;
      v.prizeK = big ? function (t) { return 1 - ease.brand(seg(t, R + 0.2, R + 0.7)); } : null;
      v.claimT0 = R + 0.9;
      v.refresh = function () {
        if (!big || !st.winName || bigTiles.length) return;
        var lines = nameLines(st.winName), gapT = 14, maxChars = 0, li, ci, k2 = 0;
        for (li = 0; li < lines.length; li++) maxChars = Math.max(maxChars, lines[li].length);
        var tw = Math.min(lines.length > 1 ? 170 : 200, Math.floor((1700 - (maxChars - 1) * gapT) / maxChars)), th = Math.min(lines.length > 1 ? 230 : 300, Math.round(tw * 1.5));
        var fs2 = Math.min(Math.round(th * .86), Math.round(tw * 1.75)), rowGap = 20;
        for (li = 0; li < lines.length; li++) {
          var chars = lines[li], rw = 0, rowEl = el("div", "vpds-row", c.world); rowEl.__gap = gapT;
          for (ci = 0; ci < chars.length; ci++) rw += (chars.charAt(ci) === " " ? Math.round(tw * .5) : tw) + (ci ? gapT : 0);
          rowEl.style.left = Math.round((1920 - rw) / 2) + "px"; rowEl.style.top = (bigTop + li * (th + rowGap)) + "px";
          for (ci = 0; ci < chars.length; ci++) {
            var chh = chars.charAt(ci);
            if (chh === " ") { var sp = el("div", "", rowEl); sp.style.cssText = "flex:none;width:" + Math.round(tw * .5) + "px;margin-left:" + gapT + "px"; continue; }
            var md = makeMod(rowEl, tw, th, fs2, true, 0); bigTiles.push({ mod: md, ch: chh, k: k2++ });
          }
        }
        bigEnd = T0 + (bigTiles.length - 1) * STAG + FLIPD; bigBottom = bigTop + lines.length * th + (lines.length - 1) * rowGap;
        v.claimT0 = bigEnd + 0.25; claimEl.style.top = (bigBottom + 36) + "px";
      };
      v.render = function (t) {
        var S = v.S, items = st.items, N = st.N; if (!S) return;
        if (big) {
          var tw2 = ease.brand(seg(t, R + 0.3, R + 1.0)), sc = 1 - 0.58 * tw2;
          bd.style.transformOrigin = "50% 0"; bd.style.top = (160 - 90 * tw2) + "px"; bd.style.transform = "translateX(-50%) scale(" + sc + ")";
          for (var bi = 0; bi < bigTiles.length; bi++) {
            var bt = bigTiles[bi], p0 = seg(t, T0 + bt.k * STAG, T0 + bt.k * STAG + FLIPD);
            bt.mod.set(p0 < 1 ? " " : bt.ch, bt.ch, p0, flut(t - (T0 + bt.k * STAG + FLIPD)));
          }
          var done = bigTiles.length > 0 && t >= bigEnd + 0.3;
          if (done !== bigDone) { bigDone = done; for (bi = 0; bi < bigTiles.length; bi++) { var cs = bigTiles[bi].mod.m.querySelectorAll(".vpds-ch"); for (var cj = 0; cj < cs.length; cj++) cs[cj].style.color = done ? "#FFD93D" : ""; } }
        }
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
        function ch(i, k2) { var it = items[i]; if (st.blank || (i === N && !st.picked)) return " "; return it.no.charAt(k2); }
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
        var b2 = ease.brand(seg(t, v.claimT0, v.claimT0 + 0.6)); claimEl.style.opacity = b2; claimEl.style.transform = "translateY(" + ((1 - b2) * 18) + "px)";
      };
      return v;
    }

    /* ------------------------------------------------------------------------------------------------ RACE PLATE */
    function raceView(c) {
      var PITCH = 380, POOL = 5, v = { N: Math.round(c.DRAW * 4.6), moveDur: 0.2, freezeT: 1e9, S: null }, els = [];
      var grp = el("div", "vpds-grp", c.world);
      /* ONE SLANT for the whole plate (Dean, 11 Nov: the bands did not line up). Every tier is cut from the same two slanted lines,
         so the top band, the pink rule, the white plate and the bottom band share left and right edges. The group is 646 tall;
         the lines lean SHIFT px over that height. clip(top, height, wipe) gives a tier's polygon (wipe 1 = full width). */
      var GH = 646, SHIFT = 64, GW = 1440;
      function lx(y) { return SHIFT * (1 - y / GH); }
      function rx(y) { return GW - SHIFT * (y / GH); }
      function clip(y0, h, w) {
        var a = lx(y0), b = a + (rx(y0) - a) * w, d = lx(y0 + h), e = d + (rx(y0 + h) - d) * w;
        return "polygon(" + a + "px 0," + b + "px 0," + e + "px 100%," + d + "px 100%)";
      }
      v.clip = clip; v.lx = lx; v.rx = rx;
      var top = el("div", "vpds-tier vpds-top", grp), tspan = el("span", "", top);
      var stripe = el("div", "vpds-tier vpds-stripe", grp);
      var plate = el("div", "vpds-tier vpds-plate", grp), reel = el("div", "vpds-reel", plate), wnm = el("div", "vpds-wname", plate);
      var bot = el("div", "vpds-tier vpds-bot", grp);
      [[top, 0, 100], [stripe, 100, 16], [plate, 116, 380], [bot, 496, 150]].forEach(function (q) { q[0].style.webkitClipPath = q[0].style.clipPath = clip(q[1], q[2], 1); });
      claimEl.parentNode && claimEl.parentNode.removeChild(claimEl); bot.appendChild(claimEl); claimEl.setAttribute("data-maxw", "1190");
      prizeEl.parentNode.removeChild(prizeEl); tspan.appendChild(prizeEl);
      prizeEl.style.cssText = "position:static;display:inline;font:400 76px/100px Anton,sans-serif;text-align:left";
      var numFs = members ? Math.min(320, Math.floor(700 / (n * 0.47))) : Math.min(320, Math.floor(1300 / (n * 0.47)));
      for (var k = 0; k < POOL; k++) {
        var d = el("div", "vpds-ri", reel), no = el("div", "vpds-no", d); no.style.fontSize = numFs + "px";
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
        bot.style.webkitClipPath = bot.style.clipPath = clip(496, 150, w); bot.style.visibility = w > 0 ? "visible" : "hidden";
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

  root.VPDrawStyle = { create: create, secs: secs, schedule: schedule, claimLine: claimLine, pad: pad, usual: usual, lookFor: lookFor, niceName: niceName, nameLines: nameLines, SOUND: SOUND, DEFAULT_LOOK: DEFAULT_LOOK, STYLES: STYLES, LEN: LEN, INTRO: INTRO, WIN: WIN, K: K };
})(typeof window !== "undefined" ? window : this);
