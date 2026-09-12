/* THE ONCE-A-WEEK RULE, AND WHEN THE HOST FINDS OUT.

   venueplay-game.js checkWeeklyFormatLimit refuses a NEW trivia or musical bingo night inside
   a rolling 7 days, and it does it on the GAME START route. Start is pressed AFTER the lobby
   is open, AFTER the QR is on the TV and AFTER the room has scanned in. So a host who is going
   to be refused learns it in front of a full room.

   Trivia got a console-side warning for this months ago. Musical bingo never did, even though
   the Worker rule covers both, so a musical host still got the whole fault. That is found here
   rather than by a venue, on 12 Sep 2026.

   THE THREE THINGS THIS SUITE IS ACTUALLY FOR:

     1. The rule is mirrored CORRECTLY. Off-by-one on the 8 hour resume grace and a host picking
        a night back up after a handover is locked out of their own game; off-by-one on the week
        and a venue is warned off a night they are entitled to.

     2. BOTH consoles ask the SAME rule. The whole reason musical was missed is that the rule
        was written inside one console. If either stops loading /app/vp-weekly.js, or starts
        restating the numbers itself, that is the fault coming back and it fails here.

     3. The escape hatch does not read as permission. "Open anyway" used to HIDE the warning and
        re-enable the button, which is the console telling the host it is fine. It is not fine:
        the Worker takes no override and still refuses at Start. The banner has to stay up.

   Run: jsc venueplay-backend/app/weekly-before-the-room.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}

function read(cands){
  for (var i = 0; i < cands.length; i++) {
    try { var t = readFile(cands[i]); if (t && t.length > 200) return t; } catch (e) {}
  }
  return null;
}
var LIB = read(["venueplay/app/vp-weekly.js", "../../venueplay/app/vp-weekly.js"]);
var TRIVIA = read(["venueplay/app/trivia/host.html", "../../venueplay/app/trivia/host.html"]);
var MUSICAL = read(["venueplay/app/musical/host.html", "../../venueplay/app/musical/host.html"]);
var WORKER = read(["venueplay-backend/worker/venueplay-game.js", "../worker/venueplay-game.js"]);
if (!LIB || !TRIVIA || !MUSICAL || !WORKER) {
  print("FAIL could not read one of: vp-weekly.js, trivia host, musical host, game Worker");
  throw new Error("no source");
}

/* ---- 1. the rule itself, run rather than read ---- */
var globalThisRef = this;
(new Function(LIB))();
var W = globalThisRef.VPWeekly || VPWeekly;

print("== the rule mirrors the Worker ==");
var HOUR = 3600e3, DAY = 24 * HOUR;
var NOW = Date.parse("2026-09-12T08:00:00Z");
function at(hoursAgo){ return new Date(NOW - hoursAgo * HOUR).toISOString(); }

ok("a venue that has never run the format is not warned",
   W.check({ last_trivia_at: null }, "trivia", NOW) === null);
ok("no venue row at all is not warned", W.check(null, "trivia", NOW) === null);

ok("one hour ago is the SAME night, so no warning (a handover restart)",
   W.check({ last_trivia_at: at(1) }, "trivia", NOW) === null);
ok("seven hours ago is still inside the 8 hour resume grace",
   W.check({ last_trivia_at: at(7.9) }, "trivia", NOW) === null);
ok("nine hours ago is a NEW night inside the week, so warn",
   W.check({ last_trivia_at: at(9) }, "trivia", NOW) !== null);
ok("six days ago still warns",
   W.check({ last_trivia_at: at(6 * 24) }, "trivia", NOW) !== null);
ok("eight days ago does not: the week is up",
   W.check({ last_trivia_at: at(8 * 24) }, "trivia", NOW) === null);
ok("exactly seven days is over the line, so no warning",
   W.check({ last_trivia_at: new Date(NOW - 7 * DAY).toISOString() }, "trivia", NOW) === null);

/* A row timestamped in the future means this device's clock disagrees with the server's.
   Guessing there produces a warning nobody can act on, so it says nothing and lets the
   Worker decide. */
ok("a last-played time in the FUTURE says nothing rather than guessing",
   W.check({ last_trivia_at: at(-5) }, "trivia", NOW) === null);
ok("rubbish in the column says nothing rather than throwing",
   W.check({ last_trivia_at: "not a date" }, "trivia", NOW) === null);

print("== it reads the right column for each format ==");
ok("trivia reads last_trivia_at",
   W.check({ last_trivia_at: at(24) }, "trivia", NOW) !== null &&
   W.check({ last_musical_at: at(24) }, "trivia", NOW) === null);
ok("musical reads last_musical_at",
   W.check({ last_musical_at: at(24) }, "musical", NOW) !== null &&
   W.check({ last_trivia_at: at(24) }, "musical", NOW) === null);
ok("a venue that ran trivia is NOT warned off musical bingo",
   W.check({ last_trivia_at: at(24) }, "musical", NOW) === null,
   "they are separate weekly slots");

print("== what it tells the host ==");
var w = W.check({ last_trivia_at: at(24) }, "trivia", NOW);
ok("it names the format", w && w.text.indexOf("Trivia") === 0, w && w.text);
var wm = W.check({ last_musical_at: at(24) }, "musical", NOW);
ok("and names musical bingo properly, not 'Musical'",
   wm && wm.text.indexOf("Musical bingo") === 0, wm && wm.text);
ok("the next day is a day a person can read, not an ISO date",
   w && /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/.test(w.nextDay), w && w.nextDay);
ok("and it is AFTER the week is up",
   w && Date.parse(w.nextIso) >= NOW - 24 * HOUR, w && w.nextIso);
ok("a bare date inside a server message is made readable too",
   W.friendlyMsg("available from 2026-09-19").indexOf("Saturday 19 September") >= 0,
   W.friendlyMsg("available from 2026-09-19"));
ok("friendlyMsg leaves a message with no date alone",
   W.friendlyMsg("Trivia runs once a week per venue.") === "Trivia runs once a week per venue.");

print("== the numbers are the Worker's numbers ==");
ok("the week matches the Worker", W.WEEK === 7 * 24 * 60 * 60 * 1000);
ok("the resume grace matches the Worker", W.RESUME_GRACE === 8 * 60 * 60 * 1000);
ok("and the Worker still has a RESUME_GRACE of 8 hours",
   /RESUME_GRACE\s*=\s*8\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(WORKER),
   "if the Worker changed, this mirror is now lying to hosts");

/* ---- 2. both consoles, one rule ---- */
function strip(t){
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
var CONSOLES = [["trivia", TRIVIA, "start the round"], ["musical", MUSICAL, "start the game"]];

print("");
print("== both consoles warn BEFORE the room is in, and both ask the same rule ==");
CONSOLES.forEach(function (c) {
  var name = c[0], src = c[1], startWords = c[2], body = strip(src);
  /* THE TAG, not the string. The first version of this looked for "/app/vp-weekly.js"
     anywhere in the file, and a COMMENT inside weeklyPreCheck names the path, so deleting
     the script tag left the check green: prove-checks called it BLIND straight away.
     Same trap as the metering suite earlier the same day. */
  ok(name + ": loads /app/vp-weekly.js",
     /<script src="\/app\/vp-weekly\.js"/.test(src),
     "the shared rule is not loaded, so VPWeekly is undefined and the warning never renders");
  ok(name + ": has a banner to put the warning in", src.indexOf('id="weekBanner"') >= 0);
  ok(name + ": asks VPWeekly rather than restating the rule",
     /VPWeekly\.check\(/.test(body));
  ok(name + ": does not write the 7 day week itself",
     body.indexOf("7*24*3600*1000") < 0 && body.indexOf("7 * 24 * 3600 * 1000") < 0,
     "a second copy of the limit drifts from the Worker");
  ok(name + ": does not write the 8 hour grace itself",
     body.indexOf("8*3600*1000") < 0 && body.indexOf("8 * 3600 * 1000") < 0);
  ok(name + ": parks the start button while the hold is on", /weekHold/.test(body));
  ok(name + ": a game already running is never blocked",
     /G\.status\s*!==\s*"setup"/.test(body),
     "a recovered live game must not be held by a warning about starting one");

  /* The escape hatch. It must exist, and it must not read as permission. */
  var i = body.indexOf("weekAnyway");
  ok(name + ": offers a way through, because this warning can be wrong", i >= 0);
  var hatch = i < 0 ? "" : body.slice(i, i + 1400);
  ok(name + ': the button does not say "Open anyway"',
     src.indexOf(">Open anyway<") < 0, "that reads as a promise the Worker will not keep");
  ok(name + ": pressing it does NOT hide the warning",
     hatch.indexOf('style.display="none"') < 0 && hatch.indexOf("style.display='none'") < 0,
     "hiding the warning is the console telling the host it is fine, and it is not");
  ok(name + ": and it says where the real decision happens",
     /enforced by the server/.test(hatch), "the host has to know the Worker still decides");
  ok(name + ": naming the moment it happens, after the room has scanned in",
     hatch.indexOf(startWords) >= 0 && /scanned in/.test(hatch));
});

print("");
print("== the Worker is still the referee, and still refuses on START ==");
ok("the Worker checks the weekly limit on the game start route",
   /checkWeeklyFormatLimit\(env, session, isTrivia\)/.test(WORKER));
ok("and answers 429 so the console can tell this apart from a crash",
   /limitMsg[\s\S]{0,80}429/.test(WORKER));
ok("it covers BOTH formats, which is why both consoles need the warning",
   /isTrivia \|\| isMusical/.test(WORKER));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
