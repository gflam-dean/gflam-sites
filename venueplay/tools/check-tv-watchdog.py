#!/usr/bin/env python3
"""
Guard the venue TV's self-recovery. Run before pushing any change to tv.html:

    python3 tools/check-tv-watchdog.py

WHY THIS EXISTS
A venue screen runs unattended for weeks. Twice now it has gone black and stayed black,
and at any real number of venues nobody is going to walk over and refresh it. The watchdog
and the branded floor are what make that self-correcting, and both are easy to delete by
accident during an unrelated edit because neither does anything visible when things are working.

Exits non-zero and says what is missing if any of it has gone.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TV = os.path.join(HERE, "..", "tv.html")
src = open(TV, encoding="utf-8").read()

CHECKS = [
    ("branded floor is in the markup",
     'id="tvFloor"' in src,
     "The floor is the screen a venue sees when everything above it fails. Without it, a\n"
     "     failed ad rotation shows black again."),

    ("the floor sits UNDER the ads",
     re.search(r"#tvFloor\{z-index:0\}", src) and re.search(r"#tvAds\{z-index:1\}", src),
     "Both z-index rules must stay, or the floor covers the ads instead of backing them."),

    ("watchdog block is present",
     "WATCHDOG: DO NOT REMOVE" in src and "function watchdog()" in src,
     "Nothing repairs the screen without it."),

    ("watchdog judges the DOM, not our state flags",
     ".ad.show" in src and "function screenIsAlive()" in src,
     "The last fault had every slide built and none visible, with every internal flag\n"
     "     reporting healthy. Checking flags would have missed it."),

    ("reloads are rate limited",
     "vpTvReloadAt" in src and "MIN_GAP" in src,
     "Without the limit, a page that fails on load reloads forever."),

    ("reloads are blocked while offline",
     "navigator.onLine" in src,
     "Reloading with the wifi down replaces a branded screen with a browser error page."),

    ("the page reloads itself periodically",
     "MAX_AGE" in src and "max-age" in src,
     "This is how a deployed fix reaches venues nobody is going to visit."),

    ("nothing fires during a live game",
     re.search(r'function idle\(\)\{[^}]*tvMode === "ads"', src),
     "Every recovery path must be gated on tvMode, or a reload can interrupt a game."),

    ("remote reload command is wired",
     't.t==="tv_reload"' in src or 'm.t==="tv_reload"' in src,
     "This is the only way to push a recovery to every screen at once."),

    ("ad rebuilds always restart the rotation",
     not re.search(r"buildAds\(\);\s*if\(!hostConnected\)\s*startAds\(\)", src),
     "buildAds() clears the container and rebuilds every slide hidden. Any rebuild that\n"
     "     does not call startAds() leaves the screen black. This is the exact bug that\n"
     "     took the screen down, guarded by hostConnected, which is never reset to false."),
]

print("Checking the venue TV can still recover on its own\n")
bad = 0
for name, ok, why in CHECKS:
    print(("  PASS  " if ok else "  FAIL  ") + name)
    if not ok:
        bad += 1
        print("     -> " + why)

if bad:
    print("\n%d check(s) failed. Do not deploy tv.html until these are back." % bad)
    sys.exit(1)
print("\nAll good. The screen can still repair itself and pull down new code.")
