/* ============================================================================
   MUSICAL BINGO CLIPS FADE IN AND OUT (Dean, 11 Nov 2026, INBOX 260:
   "that would absolutely change the game").

   Every clip fades IN over its first 1.5 seconds and OUT over its last 2.5, and
   when the host taps Next or Pause mid-clip the clip fades out in half a second
   instead of cutting. The TV (app/musical/screen.html) and the console's own
   player (app/musical/host.html) both use this one copy.

   The level is a number from 0 to 1 that the PAGE puts on its own audio: the
   gain node after the Room volume boost when that graph is built (gain = Room
   volume x level), or the <audio> element's volume before it is. So the fade
   scales the Room volume slider and never overrides it.

   The in and out fades follow the clip's OWN clock (currentTime and duration),
   not the wall clock: a clip held by a TV that blocks sound, or paused by the
   host, holds its level, and a clip that starts again from 0 fades in again.
   Only the quick half-second fade on Next or Pause runs on the wall clock.

   ES5 only, no Web Audio of its own, no AudioWorklet: this runs on the Tizen and
   webOS televisions (Chromium 68/69). The clips themselves, their 30 seconds and
   where they come from, are not touched.

       <script src="/app/vp-fade.js"></script>
       var f = VPFade.create({ el: audioEl, apply: function(level){ ... } });
       f.start();                       // a new clip is about to play: level from 0
       f.out(function(){ ... }, "switch" | "pause");   // quick fade, then do it
       f.resume();                      // Play after a Pause: back up in half a second
       f.stop();                        // the clip is gone: drop anything waiting
   ========================================================================== */
(function(root){
  var FADE_IN = 1.5, FADE_OUT = 2.5, QUICK = 0.5, ASSUME = 30, SHARE = 0.8, TICK_MS = 40;

  function clamp01(x){ x = Number(x); if (!(x > 0)) return 0; return x > 1 ? 1 : x; }
  /* Ears hear loudness, not amplitude: a straight line sounds like it jumps in and
     then sits; the square of it sounds like an even rise. */
  function shape(x){ x = clamp01(x); return x * x; }

  /* The clip's own envelope at t seconds into a clip dur seconds long.
     A length the browser does not know yet is the 30 second preview. A clip
     shorter than its two fades shrinks both in proportion, so together they
     take 80% of it and it still rises, peaks and falls. */
  function envelope(t, dur, fi, fo){
    if (fi === undefined || fi === null) fi = FADE_IN;
    if (fo === undefined || fo === null) fo = FADE_OUT;
    dur = Number(dur); if (!(dur > 0) || !isFinite(dur)) dur = ASSUME;
    t = Number(t); if (!(t > 0)) t = 0; if (t > dur) t = dur;
    if (fi + fo > dur * SHARE){ var k = dur * SHARE / (fi + fo); fi *= k; fo *= k; }
    var a = fi > 0 ? t / fi : 1, b = fo > 0 ? (dur - t) / fo : 1;
    return shape(Math.min(a, b, 1));
  }
  /* A straight ramp from `from` to `to` that began at t0 and lasts secs. */
  function ramp(from, to, t0, secs, now){
    if (!(secs > 0)) return to;
    var p = (now - t0) / secs; if (!(p > 0)) p = 0; if (p > 1) p = 1;
    return from + (to - from) * p;
  }

  function create(o){
    o = o || {};
    var el = o.el, apply = o.apply || function(){};
    var fi = o.fadeIn === undefined ? FADE_IN : o.fadeIn, fo = o.fadeOut === undefined ? FADE_OUT : o.fadeOut;
    var quick = o.quick === undefined ? QUICK : o.quick;
    var now = o.now || function(){ return Date.now() / 1000; };
    var setT = o.setTimeout || function(f, ms){ return setTimeout(f, ms); };
    var clrT = o.clearTimeout || function(h){ clearTimeout(h); };
    var setI = o.setInterval || function(f, ms){ return setInterval(f, ms); };
    var clrI = o.clearInterval || function(h){ clearInterval(h); };

    // m: the quick fade's multiplier, a straight line from mFrom to mTo (shaped when used)
    var mFrom = 1, mTo = 1, mT0 = 0, mSecs = 0;
    var pend = null, pendKind = "", pendT = null, tick = null;

    function m(){ return ramp(mFrom, mTo, mT0, mSecs, now()); }
    function rampTo(to){
      var cur = m(), dist = Math.abs(to - cur);
      mFrom = cur; mTo = to; mT0 = now(); mSecs = quick * dist;   // part way already: the rest of the half second
    }
    function level(){
      var e = el ? envelope(el.currentTime, el.duration, fi, fo) : 1;
      return e * shape(m());
    }
    function push(){ try{ apply(level()); }catch(e){} }
    function audible(){
      if (!el) return false;
      if (el.paused || el.ended || el.muted) return false;
      var s = el.getAttribute ? el.getAttribute("src") : el.src;
      return !!s;
    }
    function running(){ return !!pend || (el && !el.paused && !el.ended); }
    function onTick(){
      push();
      if (!running() && tick !== null){ clrI(tick); tick = null; }
    }
    function ensureTick(){ if (tick === null) tick = setI(onTick, TICK_MS); }
    function drop(){ if (pendT !== null){ clrT(pendT); pendT = null; } pend = null; pendKind = ""; }

    // A NEW CLIP: whatever was waiting is dropped, and the level starts from 0 (the clip is at 0:00).
    function start(){ drop(); mFrom = mTo = 1; mSecs = 0; push(); ensureTick(); }

    /* FADE OUT QUICKLY, THEN cb. A clip nobody can hear (paused, muted, none) needs no
       fade: cb runs now, inside the host's own tap. A switch waiting to happen is never
       replaced by a pause: the next song still lands, and the page decides whether it
       plays (the TV's _hostPaused, the console's flush). Returns false when it did not take cb. */
    function out(cb, kind){
      kind = kind || "switch";
      if (pend && pendKind === "switch" && kind !== "switch") return false;
      drop();
      if (!audible()){ if (cb) cb(); return true; }
      rampTo(0);
      pend = cb || function(){}; pendKind = kind;
      pendT = setT(fire, Math.round(mSecs * 1000) + 20);
      ensureTick();
      return true;
    }
    function fire(){
      pendT = null;
      var cb = pend; pend = null; pendKind = "";
      mFrom = mTo = 0; mSecs = 0; push();
      if (cb) cb();
    }
    // Run a waiting switch now (the console's Pause tapped inside the half second).
    function flush(){ if (pend && pendT !== null){ clrT(pendT); fire(); return true; } return false; }

    /* PLAY AFTER A PAUSE: back up over the rest of half a second. A waiting pause is
       cancelled; a waiting switch is left alone (it plays the next song itself). */
    function resume(){
      if (pend && pendKind === "switch") return false;
      drop(); rampTo(1); push(); ensureTick(); return true;
    }
    // THE CLIP IS GONE (end of game, a win, a stopped console): nothing left waiting, nothing left at 0.
    function stop(){ drop(); mFrom = mTo = 1; mSecs = 0; if (tick !== null){ clrI(tick); tick = null; } }

    /* Anything that plays the element directly (a claim's Play on, a click to turn the TV's sound
       on, the console's sound switch) must never play it at 0: the quick fade comes back up. */
    if (el && el.addEventListener){
      el.addEventListener("play", function(){
        if (pend && pendKind === "pause") drop();
        if (!pend && (mTo < 1 || m() < 1)) rampTo(1);
        push(); ensureTick();
      });
      el.addEventListener("seeked", push);
    }

    return {
      start: start, out: out, flush: flush, resume: resume, stop: stop, level: level,
      pending: function(){ return pend ? pendKind : ""; },
      _tick: onTick
    };
  }

  root.VPFade = { create: create, envelope: envelope, ramp: ramp, shape: shape,
                  FADE_IN: FADE_IN, FADE_OUT: FADE_OUT, QUICK: QUICK };
})(typeof window !== "undefined" ? window : this);
