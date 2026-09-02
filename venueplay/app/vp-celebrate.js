/* ============================================================================
   THE WIN SOUND, IN ONE PLACE.

   The same C-E-G-C arpeggio and sparkle chord was written out eight times: on
   both bingo surfaces, both musical surfaces, both trivia surfaces, the raffle
   screen and the members screen. Three of those eight had already drifted from
   each other. Nobody had broken anything yet, but the next person to improve
   the win sound would have improved one of three copies and left a venue with
   two different celebrations depending on which game was on.

   TWO PROFILES, because the difference between them is real and must be kept:

     pa      A SCREEN plays through the venue's television and PA. It runs the
             notes into a master gain and a DynamicsCompressor so the sound
             stays full across a loud room without clipping, and its sparkle
             chord carries a low C the phones leave out.

     phone   A PHONE is six inches from one person's face. No compressor, lower
             peaks, straight to the speaker.

   Both are reproduced here EXACTLY as they were: same frequencies, same
   spacing, same envelopes, same peaks. This is a refactor, so the room should
   not be able to hear that it happened.

   Callers keep their own playFanfare() and simply hand off, so no call site
   changed. If this file fails to load, those wrappers do nothing and the game
   carries on in silence: a missing celebration is cosmetic, a thrown error
   during a win is not.
   ========================================================================== */
(function (root) {
  "use strict";

  var _ac = null;

  /* USE THE PAGE'S OWN CONTEXT WHEN IT HAS ONE.

     Every one of these pages already holds an AudioContext that it resumes on
     the first tap or key, because a kiosk browser will not make a sound until
     a gesture has happened. If this module quietly made a SECOND context, that
     one would still be suspended, and the win fanfare would be silent on
     exactly the Fire Stick screens the product ships on - while working
     perfectly on the laptop anyone tested it on.

     So the caller hands its context in. Making our own is the fallback, not
     the normal path. */
  function context(given) {
    if (given) {
      try { if (given.state === "suspended") given.resume(); } catch (e) {}
      return given;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!_ac) _ac = new AC();
    if (_ac.state === "suspended") _ac.resume();
    return _ac;
  }

  /* The two profiles, as data rather than as two functions, so a difference
     between them is visible on one screen instead of buried in a diff. */
  var PROFILE = {
    pa: {
      master: 0.6, compress: true, step: 0.12,
      arp:   { notes: [523.25, 659.25, 783.99, 1046.50], dur: 0.55, peak: 0.5, type: "triangle" },
      chord: { notes: [523.25, 1046.50, 1318.51, 1567.98], dur: 1.05, peak: 0.5, peakRest: 0.32, type: "sine" }
    },
    phone: {
      master: null, compress: false, step: 0.11,
      arp:   { notes: [523.25, 659.25, 783.99, 1046.50], dur: 0.5, tail: 0.55, peak: 0.3, type: "triangle" },
      chord: { notes: [1046.50, 1318.51, 1567.98], dur: 0.9, tail: 0.95, peak: 0.2, type: "sine" }
    }
  };

  function fanfare(opts) {
    try {
      var p = PROFILE[(opts && opts.profile) === "pa" ? "pa" : "phone"];
      var ctx = context(opts && opts.ctx);
      if (!ctx) return;
      var now = ctx.currentTime;

      /* On the PA path everything lands on a master gain and then a compressor.
         On a phone it goes straight out, which is what it always did. */
      var out = ctx.destination;
      if (p.master !== null) {
        var master = ctx.createGain();
        master.gain.value = p.master;
        if (p.compress) {
          var comp = ctx.createDynamicsCompressor();
          master.connect(comp); comp.connect(ctx.destination);
        } else {
          master.connect(ctx.destination);
        }
        out = master;
      }

      function tone(freq, start, dur, peak, type, tail) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || "triangle";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g); g.connect(out);
        o.start(start); o.stop(start + (tail == null ? dur + 0.05 : tail));
      }

      var a = p.arp, i;
      for (i = 0; i < a.notes.length; i++) {
        tone(a.notes[i], now + i * p.step, a.dur, a.peak, a.type, a.tail);
      }
      var c = p.chord, tc = now + a.notes.length * p.step, j;
      for (j = 0; j < c.notes.length; j++) {
        var peak = (c.peakRest != null && j > 0) ? c.peakRest : c.peak;
        tone(c.notes[j], tc, c.dur, peak, c.type, c.tail);
      }
    } catch (e) { /* a celebration is never worth an exception mid-win */ }
  }

  /* ---- CONFETTI ----------------------------------------------------------

     Five copies of this existed, in two versions, and the whole difference was
     data: the TV used five brand colours and a 3800ms lifetime, the trivia
     screen six colours and 3900ms. One of them also built its div through a
     local helper instead of createElement, which is the same thing written
     twice.

     So the colours and the lifetime are arguments and the behaviour is not.
     Each caller passes its own host element, because a screen drops confetti
     over its own container and nothing else.

     The random source is handed in too. These pages draw from a CSPRNG rather
     than Math.random, and a shared module has no business quietly downgrading
     that on a product that runs gambling-adjacent games. */
  var DEFAULT_COLOURS = ["#FF1F8E", "#FFC24B", "#35D07F", "#FFFFFF", "#C70F69"];

  function burst(host, count, opts) {
    try {
      if (!host) return;
      opts = opts || {};
      var colours = opts.colours || DEFAULT_COLOURS;
      var life = opts.lifeMs || 3800;
      var rnd = opts.rand || function (n) { return Math.floor(Math.random() * n); };
      for (var i = 0; i < count; i++) {
        var c = document.createElement("div");
        c.className = opts.className || "confetti";
        c.style.left = rnd(100) + "%";
        c.style.background = colours[i % colours.length];
        c.style.animationDelay = (rnd(400) / 1000) + "s";
        c.style.animationDuration = (2.1 + rnd(180) / 100) + "s";
        host.appendChild(c);
        (function (el) {
          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, life);
        })(c);
      }
    } catch (e) { /* confetti is never worth an exception mid-win */ }
  }

  root.VPCelebrate = { fanfare: fanfare, burst: burst };
})(window);
