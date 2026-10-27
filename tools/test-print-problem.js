/* A CLOSED PRINT TAB IS NOT A BLOCKED ONE. Audit 27 Sep 2026: both consoles said "Your browser blocked
   the print window" for any failure, including a host who closed the "Getting ready" tab. Runs the real
   printProblem from the trivia and musical consoles.  Run: jsc tools/test-print-problem.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
["venueplay/app/trivia/host.html", "venueplay/app/musical/host.html"].forEach(function(f){
  var s = readFile(f), i = s.indexOf("function printProblem(w){"), d = 0, j = i, st = false;
  for (; j < s.length; j++){ if (s[j] === "{"){ d++; st = true; } else if (s[j] === "}"){ d--; if (st && d === 0) break; } }
  var fn = i > 0 ? (new Function(s.slice(i, j + 1) + "; return printProblem;"))() : null;
  var name = f.split("/")[2];
  ok(name + ": has printProblem", !!fn);
  if (!fn) return;
  ok(name + ": a closed tab says it was closed, not blocked", /was closed/.test(fn({ closed: true })) && !/blocked/.test(fn({ closed: true })));
  ok(name + ": no window at all is a blocked pop-up", /blocked/.test(fn(null)));
  ok(name + ": every print failure goes through it", s.indexOf("hostError(printProblem(w));") > 0 && s.indexOf("blocked the print window. Allow pop-ups for venueplay.com.au, then tap Print again.\");") < 0);
});
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
