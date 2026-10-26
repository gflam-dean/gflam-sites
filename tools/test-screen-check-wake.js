/* WAKING A WALL REJOINS THE CLOCK, AND THE SCREEN CHECK CAN TELL THAT FROM A RESTART (27 Oct 2026).

   Live at 09:08 on wellshot-hotel: /screen-check's "waking does not jump back to the first slide"
   went red. It recorded the lit slide, simulated visibilitychange, waited 1.5 s and expected the
   same slide. Wellshot runs 7 x 10 s + 1 x 15 s, read off the clock since 24 Oct, so a boundary
   inside that window is a legitimate advance and read as "the loop restarted". Tugun (8 s) passed
   in the same run. A real restart is still the fault the check exists for.

   This RUNS the real startAds out of tv.html against a modelled wall and a set clock, wakes it
   across a boundary, and runs screen-check.html's real wakeVerdict over what is lit:
     - a wake lands on the slot the clock says, never slide one       (red if tv.html restarts on wake)
     - the verdict passes the clock's slot and the one before it, and fails the first slide when
       the clock says otherwise                                         (red if the verdict is loosened)

   Run: jsc tools/test-screen-check-wake.js */
var TV = readFile("venueplay/tv.html"), SC = readFile("venueplay/screen-check.html");
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + JSON.stringify(saw) : "")); } }

var mSlot = TV.match(/function adSlotAt\(nowMs, durs\)\{[\s\S]*?\n  \}/);
var mStart = TV.match(/function startAds\(\)\{[\s\S]*?\n  \}/);
var mVerdict = SC.match(/function wakeVerdict\(lit, want, n\) \{[\s\S]*?\n  \}/);
ok("tv.html has adSlotAt and startAds", !!mSlot && !!mStart);
ok("tv.html publishes its clock for the screen check (window.__vpAdClock)", /window\.__vpAdClock\s*=\s*\{\s*durs:/.test(TV));
ok("screen-check.html has wakeVerdict and asks the wall's clock", !!mVerdict && /__vpAdClock/.test(SC) && /wakeVerdict\(litSlots\(d\)/.test(SC));
if (!(mSlot && mStart && mVerdict)) { print("FAILED " + bad + ", " + ran + " run"); quit(1); }

var NOW = 0;
Date.now = function(){ return NOW; };

/* A modelled wall: the slides tv.html's startAds touches, the pieces of the page it reaches for. */
function wall(secs){
  var slides = secs.map(function(s){
    var cls = {};
    return { cls: cls, style: {},
             classList: { toggle: function(c, on){ if (on) cls[c] = 1; else delete cls[c]; }, add: function(c){ cls[c] = 1; }, remove: function(c){ delete cls[c]; } } };
  });
  var env = {
    window: {}, adBuilt: true, adIdx: 0, adTimer: null, adFadeTimer: null,
    ADS: { rotationSecs: 7 },
    $: function(id){ return { querySelectorAll: function(){ return slides; } }; },
    buildAds: function(){}, stopAds: function(){},
    loopEntries: function(){ return secs.map(function(s){ return { type: "slide", slide: { seconds: s } }; }); },
    setTimeout: function(){ return 1; }, clearTimeout: function(){},
    adSlotAt: new Function(mSlot[0] + "; return adSlotAt;")()
  };
  env.start = new Function("env", "with (env) { " + mStart[0] + "; return startAds; }")(env);
  env.lit = function(){ var out = []; slides.forEach(function(s, i){ if (s.cls.show) out.push(i); }); return out; };
  return env;
}
var wakeVerdict = new Function(mVerdict[0] + "; return wakeVerdict;")();

print("\nWellshot: 7 x 10 s and one 15 s slide, woken across a boundary");
var W = wall([10, 10, 10, 10, 10, 10, 10, 15]);     // 85 s loop
var LOOP = 85000;
NOW = LOOP * 1234 + 30000 + 9400;                   // slot 3, 600 ms before slot 4
W.start();
ok("switched on: the clock's slot is lit (slot 3)", W.lit().length === 1 && W.lit()[0] === 3, W.lit());
ok("the wall published its clock, with the live durations", W.window.__vpAdClock && W.window.__vpAdClock.durs.join() === "10000,10000,10000,10000,10000,10000,10000,15000" && W.window.__vpAdClock.slot().i === 3);
NOW += 1500;                                        // the screen check's wait: the boundary fell inside it
W.start();                                          // the wake handler: buildAds(); startAds();
ok("woken 1.5 s later: the wall rejoins the clock's slot (4), it does not restart at slide one", W.lit().length === 1 && W.lit()[0] === 4, W.lit());
var v = wakeVerdict(W.lit(), W.window.__vpAdClock.slot().i, 8);
ok("and the screen check's verdict on that wall is a pass", v.ok, v);

print("\nTugun: 8 x 8 s, woken with no boundary in the window");
var T = wall([8, 8, 8, 8, 8, 8, 8, 8]);
NOW = 64000 * 777 + 16000 + 1000;                   // slot 2, 7 s left
T.start(); var before = T.lit().slice();
NOW += 1500; T.start();
ok("the same slide stays lit", T.lit().join() === before.join() && before[0] === 2, [before, T.lit()]);
ok("and the verdict passes it", wakeVerdict(T.lit(), T.window.__vpAdClock.slot().i, 8).ok);

print("\nthe verdict itself");
ok("the clock's slot is right", wakeVerdict([4], 4, 8).ok);
ok("the slot before it is right too: the boundary fell inside the window", wakeVerdict([3], 4, 8).ok && /boundary/.test(wakeVerdict([3], 4, 8).why));
ok("both lit mid cross-fade is right", wakeVerdict([3, 4], 4, 8).ok);
ok("the FIRST slide while the clock says slot 4 is the restart: red", !wakeVerdict([0], 4, 8).ok && /RESTARTED/.test(wakeVerdict([0], 4, 8).why), wakeVerdict([0], 4, 8));
ok("any other slide is wrong too", !wakeVerdict([6], 4, 8).ok);
ok("the first slide when the clock says slot 0 is right", wakeVerdict([0], 0, 8).ok);
ok("the first slide when the clock says slot 1 is the one before: right", wakeVerdict([0], 1, 8).ok);
ok("slide one after the wrap, when the clock says slot 0: right", wakeVerdict([7], 0, 8).ok);
ok("one slide: nothing to rejoin", wakeVerdict([0], 0, 1).ok);
ok("a restarted Wellshot wall is caught", !wakeVerdict([0], W.window.__vpAdClock.slot().i, 8).ok);

print("");
print((bad ? "FAILED " + bad + ", " : "ALL ") + ran + " CHECKS " + (bad ? "" : "PASSED"));
if (bad && typeof quit === "function") quit(1);
