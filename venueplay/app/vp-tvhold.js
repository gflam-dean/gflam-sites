/* vp-tvhold.js -- "venueplay tv", THE TV SET-UP AND BETWEEN-GAMES CARD, ONE COPY (Dean, 3 Nov 2026).

   The approved lockup (logo kit: vector/venueplay-tv-stacked-neon-triangle.svg): the big neon play triangle,
   the solid wordmark and a solid pink "tv", and ONE muted line under it. tv.html (its holding cards and the
   floor) and the trivia and musical bingo screens (their lobby before the host is there) all draw it from
   here, so it is the same card, in the same place, everywhere a TV is waiting:
     "Setting up this screen"  while the screen connects;
     "Waiting for the host"    once it is set up and no game is on (Dean: "so the venue knows it's on them");
     "Scan to play"            while a join code is on the wall.
   The venue's OWN logo is never on this card: it is top left, in the box every game screen draws it in.

   THE LOGO NEVER MOVES: it is placed against the wall, not the text, at the approved render's size and place
   (66.65% of the wall wide, centred 49.8% down), and the TV apps' welcome screen puts it in the same place
   (~/venueplay-tv-apps shared/css/app.css). Two <svg>s in one frame: the triangle's carries the kit glow as a
   CSS drop-shadow (sigma 3.5px and 10.5px at 1920 wide), so the glow can breathe (2.6 s, glow only) while the
   shape, the wordmark and "tv" stay still. The line sits at the logo's bottom edge plus a gap (49.8% + half
   of 66.65cqw x 2456.2/6098 + 1.5cqw), so it can never ride up into it.

   THE INTRO (Dean, 3 Nov 2026, option C changed): the big triangle switches on with two catches, then
   "venueplay" and "tv" come up together, then the line, then a little later the venue's own logo arrives top
   left. 2.6 s, under 3 flashes a second, silent; nothing for reduced motion. Driven by attributes on <html>,
   not by animations on the card, so a card rebuilt mid-intro (the line cross-fade) carries on where the
   intro is instead of starting again. VPTvHold.intro({t0}) runs it; t0 lets the TV app's welcome hand over
   to tv.html mid-intro (&vpi=<the app's start, ms>) without starting again.

   The styles go in as a <style> from this script, loaded in <head> before /app/vp-oldtv.js, so the first
   frame is right and an older TV's engine has them rewritten like every other style on the page.
   The drawing comes from venueplay/brand/vp-mark.svg (#tv-tri, #tv-word) by tools/sync-brand-mark.py.
   Plain ES5. */
(function (w, d) {
  "use strict";
  var LOGO = '<svg class="tvl-tri" viewBox="-102 -2148.2 6098 2456.2" fill="none" aria-hidden="true" focusable="false" data-vp-mark="tv-tri"><path fill="#FF1F8E" fill-rule="evenodd" d="M2523.1 -1056.8C2523.1 -1036.6 2533.9 -1017.9 2551.5 -1008.0C2569.1 -998.0 2590.7 -998.3 2608.0 -1008.6L3344.6 -1449.9C3361.6 -1460.0 3371.9 -1478.3 3371.9 -1498.0C3371.9 -1517.7 3361.6 -1536.0 3344.6 -1546.1L2608.0 -1987.4C2590.7 -1997.7 2569.1 -1998.0 2551.5 -1988.0C2533.9 -1978.1 2523.1 -1959.4 2523.1 -1939.2L2523.1 -1056.8ZM2627.8 -1142.5L3221.2 -1498.0L2627.8 -1853.5L2627.8 -1142.5Z"/><path fill="#FFD6EA" fill-rule="evenodd" d="M2561.8 -1056.8C2561.8 -1050.5 2565.2 -1044.7 2570.6 -1041.7C2576.1 -1038.6 2582.7 -1038.7 2588.1 -1041.9L3324.7 -1483.1C3330.0 -1486.2 3333.2 -1491.9 3333.2 -1498.0C3333.2 -1504.1 3330.0 -1509.8 3324.7 -1512.9L2588.1 -1954.1C2582.7 -1957.3 2576.1 -1957.4 2570.6 -1954.3C2565.2 -1951.3 2561.8 -1945.5 2561.8 -1939.2L2561.8 -1056.8ZM2589.0 -1074.2L3296.6 -1498.0L2589.0 -1921.8L2589.0 -1074.2Z"/></svg>' +
             '<svg class="tvl-word" viewBox="-102 -2148.2 6098 2456.2" fill="none" role="img" aria-label="venueplay tv" data-vp-mark="tv-word"><path fill="currentColor" d="M198 -0L-1 -489L185 -489L312 -77L241 -77L367 -489L551 -489L352 -0L198 -0ZM821 11Q739 11 676 -22Q613 -54 577 -112Q541 -170 541 -245Q541 -319 576 -376Q611 -434 672 -468Q732 -501 808 -501Q882 -501 940 -470Q997 -438 1030 -382Q1062 -327 1062 -256Q1062 -241 1060 -226Q1059 -210 1054 -190L623 -188L623 -300L985 -303L907 -254Q906 -295 895 -322Q884 -348 863 -362Q842 -376 810 -376Q777 -376 753 -360Q729 -344 716 -315Q703 -286 703 -245Q703 -203 717 -174Q731 -144 757 -129Q783 -114 821 -114Q857 -114 884 -126Q912 -138 934 -163L1025 -72Q989 -31 938 -10Q886 11 821 11ZM1429 -0L1429 -276Q1429 -310 1409 -330Q1389 -349 1358 -349Q1337 -349 1320 -340Q1304 -331 1295 -315Q1286 -299 1286 -276L1218 -308Q1218 -367 1244 -410Q1270 -452 1316 -476Q1361 -499 1419 -499Q1472 -499 1514 -474Q1555 -450 1579 -409Q1603 -368 1603 -316L1603 -0L1429 -0ZM1112 -0L1112 -489L1286 -489L1286 -0L1112 -0ZM1903 11Q1834 11 1780 -16Q1727 -44 1696 -94Q1666 -143 1666 -206L1666 -489L1840 -489L1840 -206Q1840 -186 1848 -171Q1856 -156 1870 -148Q1884 -140 1903 -140Q1931 -140 1948 -158Q1966 -176 1966 -206L1966 -489L2140 -489L2140 -206Q2140 -142 2110 -93Q2080 -44 2026 -16Q1973 11 1903 11ZM2460 11Q2378 11 2315 -22Q2252 -54 2216 -112Q2180 -170 2180 -245Q2180 -319 2215 -376Q2250 -434 2310 -468Q2371 -501 2447 -501Q2521 -501 2578 -470Q2636 -438 2668 -382Q2701 -327 2701 -256Q2701 -241 2700 -226Q2698 -210 2693 -190L2262 -188L2262 -300L2624 -303L2546 -254Q2545 -295 2534 -322Q2523 -348 2502 -362Q2481 -376 2449 -376Q2416 -376 2392 -360Q2368 -344 2355 -315Q2342 -286 2342 -245Q2342 -203 2356 -174Q2370 -144 2396 -129Q2422 -114 2460 -114Q2496 -114 2524 -126Q2551 -138 2573 -163L2664 -72Q2628 -31 2576 -10Q2525 11 2460 11ZM3042 10Q2995 10 2955 -7Q2915 -24 2889 -54Q2863 -83 2857 -122L2857 -360Q2863 -399 2890 -430Q2916 -462 2956 -480Q2995 -499 3042 -499Q3113 -499 3167 -466Q3221 -434 3252 -376Q3282 -318 3282 -244Q3282 -171 3252 -114Q3221 -56 3167 -23Q3113 10 3042 10ZM2751 207L2751 -489L2925 -489L2925 -366L2896 -248L2921 -129L2921 207L2751 207ZM3009 -145Q3038 -145 3060 -158Q3082 -171 3094 -194Q3106 -216 3106 -245Q3106 -274 3094 -296Q3082 -318 3060 -331Q3038 -344 3010 -344Q2983 -344 2961 -332Q2939 -319 2927 -296Q2915 -274 2915 -245Q2915 -216 2927 -194Q2939 -171 2960 -158Q2982 -145 3009 -145ZM3338 -0L3338 -729L3512 -729L3512 -0L3338 -0ZM4331 1L4135 -489L4321 -489L4441 -86L4368 -86L4489 -489L4675 -489L4474 1L4331 1ZM4215 207L4360 -112L4474 1L4390 207L4215 207ZM3802 10Q3734 10 3681 -23Q3628 -56 3598 -114Q3568 -171 3568 -244Q3568 -318 3598 -376Q3628 -434 3681 -466Q3734 -499 3802 -499Q3848 -499 3886 -482Q3924 -466 3948 -436Q3973 -406 3978 -368L3978 -122Q3973 -83 3948 -54Q3924 -24 3886 -7Q3848 10 3802 10ZM3721 -113C3721 -107 3724 -102 3729 -99C3734 -96 3740 -96 3745 -99L3966 -231C3971 -234 3974 -239 3974 -245C3974 -251 3971 -256 3966 -259L3745 -391C3740 -394 3734 -394 3729 -391C3724 -388 3721 -383 3721 -377L3721 -113ZM3928 -0L3928 -131L3978 -140L3978 -360L3928 -369L3928 -489L4099 -489L4099 -0L3928 -0Z"/><path fill="#FF1F8E" d="M3720 -113C3720 -107 3724 -101 3729 -98C3734 -95 3741 -95 3746 -98L3966 -231C3971 -234 3975 -239 3975 -245C3975 -251 3971 -256 3966 -259L3746 -392C3741 -395 3734 -395 3729 -392C3724 -389 3720 -383 3720 -377L3720 -113Z"/><path fill="#FF1F8E" d="M5052 -0L5052 -691L5226 -691L5226 -0L5052 -0ZM4944 -344L4944 -489L5334 -489L5334 -344L4944 -344ZM5542 -0L5343 -489L5529 -489L5656 -77L5585 -77L5711 -489L5895 -489L5696 -0L5542 -0Z"/></svg>';
  var LINES = { setup: "Setting up this screen", waiting: "Waiting for the host", scan: "Scan to play" };
  var CSS = '.tvhold{position:absolute;inset:0;pointer-events:none} .tvlogo{position:absolute;left:50%;top:49.8%;width:66.65cqw;transform:translate(-50%,-50%);line-height:0} .tvlogo svg{display:block;width:100%;height:auto;overflow:visible} .tvlogo .tvl-word{color:#fff} .tvlogo .tvl-tri{position:absolute;left:0;top:0;height:100%; filter:drop-shadow(0 0 .365cqw rgba(255,31,142,.95)) drop-shadow(0 0 1.095cqw rgba(255,31,142,.55))} @keyframes vpTriBreath{ 0%,100%{filter:drop-shadow(0 0 .365cqw rgba(255,31,142,.95)) drop-shadow(0 0 1.095cqw rgba(255,31,142,.55))} 50%    {filter:drop-shadow(0 0 .365cqw rgba(255,31,142,.95)) drop-shadow(0 0 2.2cqw rgba(255,31,142,.9))} } .tvlogo.breathe .tvl-tri{animation:vpTriBreath 2.6s ease-in-out infinite} @media (prefers-reduced-motion:reduce){ .tvlogo .tvl-tri{animation:none!important} } .tvline{position:absolute;left:6%;right:6%;top:calc(49.8% + 14.92cqw);text-align:center; font-family:"Hanken Grotesk",sans-serif;font-weight:500;font-size:clamp(16px,2.1cqw,44px);line-height:1.3;color:#8A8A95; text-wrap:balance;word-break:normal;overflow-wrap:normal;hyphens:none} .tvline.scan{color:#fff;font-weight:700} @keyframes vpLineIn{from{opacity:0}to{opacity:1}} @keyframes vpLineOut{from{opacity:1}to{opacity:0}} .tvline.in{animation:vpLineIn .3s ease forwards} .tvline.out{animation:vpLineOut .3s ease forwards}' +
    /* the intro: html attributes, so every card on the page (and one rebuilt mid-intro) is at the same moment */
    ' html[data-tvi-tri="0"] .tvlogo .tvl-tri{opacity:.13;filter:none}' +
    ' html[data-tvi-tri="a"] .tvlogo .tvl-tri{opacity:.75}' +
    ' html[data-tvi-tri="b"] .tvlogo .tvl-tri{opacity:1}' +
    ' html[data-tvi-tri="c"] .tvlogo .tvl-tri{opacity:.08;filter:none}' +
    ' html[data-tvi-tri="d"] .tvlogo .tvl-tri{opacity:.7}' +
    ' html[data-tvi-breath="off"] .tvlogo .tvl-tri{animation:none}' +
    ' .tvlogo .tvl-word{transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1)}' +
    ' html[data-tvi-word="hide"] .tvlogo .tvl-word{opacity:0;transform:translateY(1.35cqw)}' +
    ' .tvhold .tvline{transition:opacity .3s ease}' +
    ' html[data-tvi-line="hide"] .tvhold .tvline{opacity:0}' +
    /* a game screen's lobby before the host is there: the same card over the wall, the venueplay corner off */
    ' .tvhold-card{position:absolute;inset:0;z-index:12;background:#0A0A0B}' +
    ' .tvhold-card[hidden]{display:none}' +
    ' body.tvhold-on .tv-corner{visibility:hidden}';
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  /* line: the words under the logo, HTML-escaped by the caller (or one of LINES). o.scan: they are "Scan to
     play". o.kind: data-vpb, what this card is. breathe: the triangle's glow breathes. */
  function html(line, breathe, o) {
    o = o || {};
    return '<div class="tvhold"' + (o.kind ? ' data-vpb="' + esc(o.kind) + '"' : '') + '><div class="tvlogo' + (breathe ? ' breathe' : '') + '" data-vp-tvlogo="stacked">' + LOGO + '</div>' +
           '<div class="tvline' + (o.scan ? ' scan' : '') + '">' + line + '</div></div>';
  }
  try { if (!d.getElementById("vpTvHoldCss")) { var st = d.createElement("style"); st.id = "vpTvHoldCss"; st.textContent = CSS; (d.head || d.documentElement).appendChild(st); } } catch (e) {}

  /* ---- the intro: [ms, what, state]. Two catches of the tube, then on; the words at 750, the line at 1300,
     the venue's logo at 2300, all over at 2600. ---- */
  var STEPS = [[0, "tri", "0"], [120, "tri", "a"], [180, "tri", "0"], [380, "tri", "b"], [470, "tri", "c"], [700, "tri", "d"], [780, "tri", ""],
               [750, "word", ""], [1000, "breath", ""], [1300, "line", ""]];
  var LOGO_AT = 2300, DONE_AT = 2600, logoReady = true, logoWaiters = [];
  function set(k, v) { try { if (v) d.documentElement.setAttribute("data-tvi-" + k, v); else d.documentElement.removeAttribute("data-tvi-" + k); } catch (e) {} }
  function reduced() { try { return !!(w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function readyLogo() { logoReady = true; var f = logoWaiters; logoWaiters = []; for (var i = 0; i < f.length; i++) { try { f[i](); } catch (e) {} } }
  function intro(o) {
    o = o || {};
    var now = Date.now(), t0 = +o.t0 || now, at = now - t0;
    if (reduced() || at < 0 || at >= DONE_AT) { try { d.documentElement.setAttribute("data-tvi", "done"); } catch (e) {} return false; }
    logoReady = false;
    d.documentElement.setAttribute("data-tvi", "on");
    var cur = { tri: "0", word: "hide", breath: "off", line: "hide" }, k;
    for (var i = 0; i < STEPS.length; i++) { if (STEPS[i][0] <= at) cur[STEPS[i][1]] = STEPS[i][2]; }
    for (k in cur) set(k, cur[k]);
    for (var j = 0; j < STEPS.length; j++) (function (s) { if (s[0] > at) setTimeout(function () { set(s[1], s[2]); }, s[0] - at); })(STEPS[j]);
    setTimeout(readyLogo, Math.max(0, LOGO_AT - at));
    setTimeout(function () { set("tri", ""); set("word", ""); set("breath", ""); set("line", ""); d.documentElement.setAttribute("data-tvi", "done"); }, DONE_AT - at);
    return true;
  }
  /* THE GAME SCREENS' LOBBY BEFORE THE HOST (Dean, 3 Nov 2026): "Waiting for the host to connect" on the
     trivia and musical bingo lobby is this card, with "Waiting for the host" under it, so a TV waiting for a
     game looks the same whichever page it is on. lobby(tvEl, on): put the card up over the wall (once) or take
     it down. The venue's own logo (#venueLogo, top left) stays above it, in its usual box. */
  function lobby(tv, on) {
    try {
      if (!tv) return;
      var c = d.getElementById("tvHoldCard");
      if (!c && on) { c = d.createElement("div"); c.id = "tvHoldCard"; c.className = "tvhold-card"; c.setAttribute("aria-live", "polite"); c.innerHTML = html(LINES.waiting, true, { kind: "lobby" }); tv.appendChild(c); }
      if (c) c.hidden = !on;
      if (d.body) d.body.classList.toggle("tvhold-on", !!on);
    } catch (e) {}
  }
  w.VPTvHold = {
    lobby: lobby,
    html: html, LINES: LINES, LOGO: LOGO, intro: intro, DONE_AT: DONE_AT, LOGO_AT: LOGO_AT, STEPS: STEPS,
    /* the venue's top-left logo waits for its moment in the intro; at once when there is none */
    logoReady: function () { return logoReady; },
    onLogoReady: function (f) { if (logoReady) { try { f(); } catch (e) {} } else logoWaiters.push(f); }
  };
})(window, document);
