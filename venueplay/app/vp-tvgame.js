/* vp-tvgame.js  -- THE PIECES EVERY GAME WALL SHARES, IN ONE PLACE (4 Nov 2026).

   Trivia got its new look first (3 Nov 2026), and two of its pieces are the same on every game wall:

     1. THE GAME'S NAME (Dean, 3 Nov 2026: "The title of the game needs to be clearer on each TV"). The name in
        Anton, white, at 2.6cqw (50px on a 1920 set, 33px on 1280), alone in the top line between the venue's
        logo (top left) and ours (top right), inside 20cqw to 80cqw, on the SAME centre line as the corner logos.
        Markup: <div class="toplbl"><span class="tl-night">Musical bingo</span></div> inside a .layer.
        VPTvGame.alignTitles() sets each one on the corner mark's centre line (measured, never a fixed offset).
     2. THE JOIN SCREEN (the approved v5 join): the QR big on the left, SCAN TO PLAY huge on the right, "or go to
        venueplay.com.au/play" under it, the code in a pink-edged box with CODE inside, no player count (the host
        console has it). Markup: a .layer.join holding .lobbyrow > .qrbig, .jright > .scanplay, .joinurl, .codebox.

   They lived inside app/trivia/screen.html, and the musical bingo wall needed exactly the same rules, so they
   moved here rather than be copied (the rule behind most faults in this codebase: one answer in one place).

   WHY A SCRIPT AND NOT A STYLESHEET. /app/vp-oldtv.js rewrites the cqw sizes for an older television, and it
   reads <style> elements only, never a linked .css file. So this adds one <style id="vpTvGameCss"> to the head
   the moment it runs. Load it in the <head> AFTER the page's own <style> and BEFORE /app/vp-oldtv.js, so an old
   set's first frame is already right and these rules win over the page's plainer lobby rules.

   Loaded by app/trivia/screen.html and app/musical/screen.html. Measured in Chrome by
   tools/trivia-newlook-in-chrome.test.py and tools/musical-newlook-in-chrome.test.py. ES5, no dependencies. */
(function (w, d) {
  "use strict";
  var CSS =
    ".toplbl{position:absolute;left:calc(20cqw);right:20cqw;top:2.5cqw;display:flex;align-items:baseline;justify-content:center;text-align:center;white-space:nowrap;overflow:hidden;color:#fff;line-height:1.15}\n" +
    ".toplbl .tl-night{font-family:'Anton',sans-serif;font-weight:400;font-size:2.6cqw;letter-spacing:.02em;text-transform:uppercase;color:#fff}\n" +
    ".srt{position:absolute;left:50%;top:50%;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}\n" +
    ".layer.join{display:block;padding:0;text-align:left}\n" +
    ".layer.join .lobbyname{display:none}\n" +
    ".layer.join .lobbyrow{position:absolute;left:calc(10.6cqw);top:11.46cqw;margin:0}\n" +
    ".layer.join .qrbig{width:31.25cqw;height:31.25cqw;padding:2.1cqw;border-radius:1.6cqw;box-shadow:none}\n" +
    ".layer.join .jright{position:absolute;left:calc(46.6cqw);right:5cqw;top:11.46cqw;height:31.25cqw;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}\n" +
    ".layer.join .scanplay{font-family:'Anton',sans-serif;text-transform:uppercase;font-size:7.8cqw;line-height:.92;color:#fff;margin:0;white-space:nowrap}\n" +
    ".layer.join .joinurl{font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:2.5cqw;line-height:1.2;color:#fff;margin-top:1.5cqw}\n" +
    ".layer.join .joinurl .jor{color:#8A8A95}\n" +
    ".layer.join .joinurl b{font-weight:800}\n" +
    ".layer.join .codebox{display:flex;align-items:center;margin-top:2.6cqw;padding:1.6cqw 2.4cqw;border:.16cqw solid var(--pink);border-radius:1.15cqw;background:#1A1A1F}\n" +
    ".layer.join .codelbl{font-family:'JetBrains Mono',monospace;font-weight:700;text-transform:uppercase;letter-spacing:.14em;font-size:1.67cqw;color:#8A8A95;margin-right:2.4cqw}\n" +
    ".layer.join .codeval{font-family:'JetBrains Mono',monospace;font-weight:500;font-size:7.8cqw;line-height:1;color:#fff;letter-spacing:.06em;background:none;border:none;padding:0;border-radius:0}\n" +
    ".layer.join .jsub{position:absolute;left:0;right:0;top:46cqw;margin:0;text-align:center}\n" +
    ".layer.join.ready .jsub{display:none}\n" +
    ".layer.join .hostline{position:absolute;left:0;right:0;top:49cqw;margin:0;text-align:center}\n";
  try {
    if (d && !d.getElementById("vpTvGameCss")) {
      var st = d.createElement("style");
      st.id = "vpTvGameCss";
      st.textContent = CSS;
      (d.head || d.documentElement).appendChild(st);
    }
  } catch (e) {}
  /* Each game name on the centre line of the venueplay corner mark, which itself moves to the middle of a
     square venue logo (VPVenueLogo.alignMark), so the logos and the name share one line. */
  function alignTitles() {
    try {
      var mk = d.querySelector(".tv-corner svg"); if (!mk) return;
      var mb = mk.getBoundingClientRect(); if (!(mb.height > 0)) return;
      var mid = mb.top + mb.height / 2, ls = d.querySelectorAll(".layer .toplbl");
      for (var i = 0; i < ls.length; i++) { var l = ls[i], h = l.offsetHeight; if (!h) continue;
        var lay = l.parentNode, lt = lay ? lay.getBoundingClientRect().top : 0;
        var top = Math.round(mid - lt - h / 2) + "px"; if (l.style.top !== top) l.style.top = top; }
    } catch (e) {}
  }
  w.VPTvGame = { css: CSS, alignTitles: alignTitles };
})(window, document);
