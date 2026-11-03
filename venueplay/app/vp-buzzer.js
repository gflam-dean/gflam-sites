/* vp-buzzer.js  -- THE TIME'S-UP BUZZER, ONE COPY (Dean, 3 Nov 2026).

   A short, tasteful "time" cue for trivia when the question clock reaches 0: two soft notes, 0.8 s, a
   gentle attack and a quick decay, at a moderate fixed level (never full scale). Made here with the Web
   Audio API, so there is no sound file to host or licence.

   It plays on the TV (app/trivia/screen.html) or on the host's own phone or tablet (app/trivia/host.html,
   for a venue that runs its sound from a device plugged into the PA), whichever the host chose. Both call
   VPBuzzer.play(ctx, say): say("on") once it has played, say("off") when the browser will not let it
   (no sound card, or autoplay blocked until the screen is pressed). It never throws and never draws
   anything: a blocked buzzer is silent, and the caller decides who to tell.

   ES5, no dependencies (tools/old-tv-syntax.test.py holds the TV's scripts to it). */
(function (w) {
  "use strict";
  function notes(ctx) {
    var t0 = ctx.currentTime + 0.03, out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(ctx.destination);
    [[587.33, 0, 0.36], [440, 0.3, 0.5]].forEach(function (n) {
      [["triangle", 1], ["sine", 0.5]].forEach(function (v) {
        var o = ctx.createOscillator(), g = ctx.createGain(), at = t0 + n[1];
        o.type = v[0]; o.frequency.value = v[0] === "sine" ? n[0] / 2 : n[0];
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(v[1], at + 0.025);   // soft attack
        g.gain.exponentialRampToValueAtTime(0.0001, at + n[2]);  // quick decay
        o.connect(g); g.connect(out); o.start(at); o.stop(at + n[2] + 0.05);
      });
    });
  }
  function play(ctx, say) {
    say = say || function () {};
    try {
      if (!ctx) { say("off"); return; }
      if (ctx.state === "running") { notes(ctx); say("on"); return; }
      var p = null; try { p = ctx.resume(); } catch (e) {}
      if (p && p.then) {
        p.then(function () { if (ctx.state === "running") { notes(ctx); say("on"); } else say("off"); }, function () { say("off"); });
      } else say("off");
    } catch (e) { say("off"); }
  }
  w.VPBuzzer = { play: play, notes: notes };
})(window);
