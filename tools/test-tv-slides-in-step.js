// Every TV in a venue shows the same slide at the same time (Tugun, 24 Oct 2026).
// Lifts adSlotAt out of the real tv.html and checks two walls switched on at different
// times land on the same slide, and that the boundaries fall where the seconds say.
var src = readFile("venueplay/tv.html");
var m = src.match(/function adSlotAt\(nowMs, durs\)\{[\s\S]*?\n  \}/);
var pass = 0, fail = 0;
function ok(name, c){ if(c){ pass++; print("  ok   " + name); } else { fail++; print("  FAIL " + name); } }
ok("tv.html has adSlotAt", !!m);
var adSlotAt = new Function(m[0] + "; return adSlotAt;")();
var d = [8000, 8000, 8000];            // three 8 s slides, 24 s loop
ok("two walls at the same instant agree", adSlotAt(1e12, d).i === adSlotAt(1e12, d).i);
var t = 24000 * 1000;                  // a loop boundary
ok("loop start is slide 1", adSlotAt(t, d).i === 0 && adSlotAt(t, d).left === 8000);
ok("8 s in is slide 2", adSlotAt(t + 8000, d).i === 1);
ok("23.9 s in is slide 3 with 100 ms left", adSlotAt(t + 23900, d).i === 2 && adSlotAt(t + 23900, d).left === 100);
ok("24 s in wraps to slide 1", adSlotAt(t + 24000, d).i === 0);
ok("uneven seconds: 5 then 10", adSlotAt(15000 * 7 + 6000, [5000, 10000]).i === 1);
ok("no slides falls back safely", adSlotAt(123, []).i === 0);
ok("a wall switched on joins on the clock's slide", /var at=adSlotAt\(Date\.now\(\), durs\);\s*var cur=at\.i;/.test(src));
ok("each change of slide reads the clock, not its own counter", /var now = adSlotAt\(Date\.now\(\), durs\);/.test(src) && /adIdx = now\.i;/.test(src) && !/adIdx = \(adIdx\+1\)%slides\.length/.test(src));
print((fail ? "FAILED " + fail + ", " : "ALL ") + pass + " CHECKS " + (fail ? "" : "PASSED"));
if (fail && typeof quit === "function") quit(1);
