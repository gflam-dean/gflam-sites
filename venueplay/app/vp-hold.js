/* ============================================================================
   HOLD A DRAW BUTTON WHILE THE ROOM IS STILL WATCHING THE LAST DRAW.

   A fumbled double tap on a bar tablet used to draw TWO bingo balls, and the TV
   abandons the first reveal mid-flight, so the room hears one number called with
   two on the board. Musical had the same fault with a worse ending: the second
   tap started song B while the Worker had recorded song A, so a card completing
   on a song nobody heard was certified a valid win.

   Both consoles got a 1.2 second guard, written separately, in two files. This
   is the one copy of it, with the hold sized to the game (Dean, 8 Sep 2026):

       bingo         5 seconds   a ball is read out and daubed in about that
       musical      20 seconds   a clip is 30 seconds; nobody skips inside 20
       musical, no clip   1.2    nothing is playing, so the host moves straight on

   The raffle and members draws hold on the SERVER (the Worker refuses a second
   draw inside the spin plus two seconds) and lock their own buttons until the
   winner is resolved, so they do not use this.

   The hold is a flag, not the button. Other code re-enables these buttons when
   it redraws the console, so a disabled button is cosmetic; busy() is the guard
   and the caller must check it before drawing. The label counts down so a host
   can see the button is holding on purpose rather than broken.

   Load it before the page's own script:
       <script src="/app/vp-hold.js"></script>
   Then:
       if (VP_HOLD.busy(btn)) return;
       ...draw...
       VP_HOLD.hold(btn, 5, function(left){ return "Next number in " + left + "s"; }, syncNextBtn);
   ========================================================================== */
(function(){
  var holds = {};   // button id -> { until, timer }

  function key(btn){ return btn && btn.id ? btn.id : null; }

  function busy(btn){
    var k = key(btn); if (!k || !holds[k]) return false;
    if (Date.now() >= holds[k].until) { release(btn); return false; }
    return true;
  }

  function release(btn){
    var k = key(btn); if (!k || !holds[k]) return;
    if (holds[k].timer) clearInterval(holds[k].timer);
    delete holds[k];
  }

  /* seconds: how long to hold. label(secondsLeft) -> text for the button while it
     holds; done() runs once when the hold ends and should put the button back the
     way the page wants it (the page knows its own labels, this does not). */
  function hold(btn, seconds, label, done){
    var k = key(btn); if (!k) return;
    release(btn);
    var ms = Math.max(0, (+seconds || 0) * 1000);
    var until = Date.now() + ms;
    var h = { until: until, timer: null };
    holds[k] = h;
    function tick(){
      var left = Math.ceil((h.until - Date.now()) / 1000);
      var b = document.getElementById(k);
      if (left <= 0) {
        release(b || btn);
        if (b) b.disabled = false;
        if (typeof done === "function") { try { done(); } catch (e) {} }
        return;
      }
      if (b) { b.disabled = true; if (typeof label === "function") b.textContent = label(left); }
    }
    tick();
    // Under a second and there is nothing to count; the flag alone does the work.
    h.timer = setInterval(tick, ms < 1500 ? Math.max(50, ms) : 250);
  }

  window.VP_HOLD = { hold: hold, busy: busy, release: release };
})();
