/* ============================================================================
   A DRAW CONSOLE TAKES THE TV ONLY WHEN THE HOST DOES SOMETHING, AND SAYS WHEN IT HAS NOT.

   Live play on The Mini Bar, 12 Nov 2026 (INBOX 282.8 and 286, FINDINGS R3, R6, R7, R8, D7):

   1. OPENING A CONSOLE TOOK THE TV. The raffle and members consoles sent t:"mode" the moment their
      channel subscribed, again whenever the tab came back into view, and again to every TV that
      said hello. So a manager opening the members draw just to change a setting put the draw on
      the wall, and it stayed there: the console's 30 second heartbeat kept the board's
      return-to-ads timer from ever running out. A tablet checking settings mid-trivia would have
      pulled the quiz off the wall.

   2. THE RAFFLE NEVER CAME BACK. Because the claim was made on page load and never again, a raffle
      console that was opened early in the night had spent its one claim. When a finished bingo game
      won the wall back (app/index.html re-sent mode:"bingo" to every TV hello after Finish game),
      nothing the raffle did afterwards could take it: its drawing traffic does not move a TV that is
      showing a bingo board. The members console was reopened each time, so it claimed afresh and
      looked as if it worked.

   3. NOBODY TOLD THE HOST. The console ran the whole draw while the room watched the last bingo
      winner, and nothing on the console said so.

   So, for the raffle and the members draw (one copy, both consoles):

     claim()      only from a real action: Draw, or the host's own "Put it on the TV" button.
                  {t:"mode", mode, claim:1}. A claim respects a game that is genuinely being played
                  on the TV (a bingo ball inside two minutes, a quiz mid-question): the 20 Sep and
                  30 Sep notes in vp-screen-router.js and tv.html are about exactly that, and this
                  does not undo them.
     claim(true)  the host's button after being told: force:1, which the TV obeys whatever is on.
     onAir()      this console has claimed the TV (or holds a live round). Only then does it answer a
                  TV hello with its mode, re-claim when the tab comes back, beat its heartbeat at the
                  screen, or send to_ads as the page goes. Not on air, the page is a settings page.
     release()    End game / Finish, back to ads.
     heard(m)     every tv_here. The TV and the game screens now say what is on the wall
                  (showing:"bingo" / "ads" / "raffle" / ...), so the console knows whether the draw
                  is really in front of the room.
     whenShowing(fn)  claim, then wait (up to a few seconds) for the draw screen to say it is up,
                  then run fn: the room sees the whole spin instead of a screen arriving mid-draw.

   The line it draws on the console, only when it matters:
     "The TV is not showing this draw. Bingo is still on it."  [Put the draw on the TV]

   Load it before the console's own script:  <script src="/app/vp-tvclaim.js"></script>
   ========================================================================== */
(function (root) {
  "use strict";

  var FRESH_MS = 45000;     // a "this is what I am showing" older than this is not known any more (heartbeat 30 s)
  var GRACE_MS = 6000;      // how long a claim is given to land before the host is told
  var WAIT_MS = 6000;       // whenShowing waits this long for the draw screen, then draws anyway

  var WHAT = {
    bingo: "Bingo is still on it.",
    trivia: "Trivia is on it.",
    musical: "Musical bingo is on it.",
    raffle: "The raffle is on it.",
    members: "The members draw is on it.",
    ads: "It is still showing your ads.",
    starting: "It has not switched over yet."
  };

  function make(opts) {
    opts = opts || {};
    var game = opts.game, send = opts.send || function () {};
    var now = opts.now || function () { return Date.now(); };
    var later = opts.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var live = opts.live || function () { return false; };     // a round in progress counts as on air (a reload mid-claim)
    var noun = opts.noun || "this draw";
    var button = opts.button || "Put the draw on the TV";
    /* THE "OPEN LOBBY" OF A DRAW. Before tonight's first draw a venue may want the raffle's prizes or the
       members draws board on the wall (a club puts the board up at 5pm for a 7:30 draw). That is now a tap,
       not a side effect of opening the page: this quiet button, shown while the console is not on air. */
    var idleButton = opts.idleButton || "";
    var claimed = false, claimAt = 0, lastTvAt = 0, lastShow = "", lastShowAt = 0, waiters = [];

    function onAir() { var l = false; try { l = !!live(); } catch (e) {} return claimed || l; }
    function showing() { return lastShow === game && (now() - lastShowAt) < FRESH_MS; }
    function tvKnown() { return (now() - lastTvAt) < FRESH_MS; }

    function why() {
      if (!lastTvAt || !tvKnown()) return "No TV has answered. Check the TV is switched on and showing venueplay.";
      if (lastShow && (now() - lastShowAt) < FRESH_MS && WHAT[lastShow]) return WHAT[lastShow];
      return WHAT.starting;
    }

    /* What the console should say right now: null for nothing. */
    function line() {
      if (showing()) return null;
      if (!onAir()) return idleButton ? { text: "", button: idleButton, idle: true } : null;
      if (claimAt && (now() - claimAt) < GRACE_MS) return null;   // give the TV its moment to switch
      return { text: "The TV is not showing " + noun + ". " + why(), button: button };
    }

    function render() {
      var box = opts.box;
      if (typeof box === "string" && typeof document !== "undefined") box = document.getElementById(box);
      if (!box) return;
      var l = line();
      if (!l) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      box.innerHTML = "";
      box.classList.toggle("idle", !!l.idle);
      if (l.text) { var p = document.createElement("span"); p.textContent = l.text; box.appendChild(p); }
      var b = document.createElement("button"); b.type = "button"; b.className = "btn ghost tvline-btn"; b.textContent = l.button;
      b.addEventListener("click", function () { claim(!l.idle); });   // the warning's button forces; the quiet one is an ordinary claim
      box.appendChild(b);
      box.classList.remove("hidden");
    }

    function claim(force) {
      claimed = true; claimAt = now();
      var m = { t: "mode", mode: game, claim: 1 };
      if (force) m.force = 1;
      try { send(m); } catch (e) {}
      render();
      later(render, GRACE_MS + 50);   // say so if it did not land
    }

    function release() { claimed = false; claimAt = 0; render(); }

    function heard(m) {
      if (!m || m.t !== "tv_here") return;
      lastTvAt = now();
      if (typeof m.showing === "string" && m.showing) { lastShow = m.showing; lastShowAt = now(); }
      if (showing() && waiters.length) { var w = waiters; waiters = []; w.forEach(function (fn) { try { fn(true); } catch (e) {} }); }
      render();
    }

    /* Claim, and run fn once the draw screen is up (or after WAIT_MS regardless). fn(true) = it is up. */
    function whenShowing(fn) {
      if (showing()) { claimed = true; render(); fn(true); return; }
      /* No TV has answered since the last claim: a venue running the draw without a screen tonight. Claim
         (a TV switched on now still comes over) but do not hold every draw for a screen that is not there. */
      if (claimed && claimAt && !tvKnown()) { claim(false); fn(false); return; }
      var done = false;
      var go = function (up) { if (done) return; done = true; fn(!!up); render(); };
      waiters.push(go);
      claim(false);
      later(function () { waiters = waiters.filter(function (w) { return w !== go; }); go(showing()); }, WAIT_MS);
    }

    return { onAir: onAir, claim: claim, release: release, heard: heard, whenShowing: whenShowing,
             showing: showing, line: line, render: render };
  }

  root.VPTvClaim = { make: make, FRESH_MS: FRESH_MS, GRACE_MS: GRACE_MS, WAIT_MS: WAIT_MS };
}(typeof globalThis !== "undefined" ? globalThis : this));
