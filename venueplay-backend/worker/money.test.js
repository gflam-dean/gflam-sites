/* THE MONEY, TESTED. Nothing else in this repo decides what a venue is charged.

   PartyPlay has 699 checks across ten suites. VenuePlay's billing had none, and
   three money faults have already come out of it: a charge that never happened,
   a credit banked twice, and a discount with no guard. This is the first suite
   that reads the real functions out of both Workers and checks the arithmetic.

   Everything here is PURE: rates, the ceiling on what a night can cost, and
   which night a game belongs to. Nothing calls Stripe.

   Run: jsc venueplay-backend/worker/money.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = ["venueplay-backend/worker/" + rel, rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var GAME = find("venueplay-game.js");
var BILL = find("venueplay-api-FULL.js");

function lift(src, name) {
  var m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}

print("\nTHE TWO WORKERS AGREE ON THE PRICE");
/* upliftRate in the game Worker carries the comment "Mirrors vpbRate in the
   billing Worker; keep the two in step." That is a comment relying on somebody
   remembering. One venue is charged by the game Worker when a night runs over,
   and by the billing Worker on its invoice. If the two ever disagree, a venue is
   quoted one number and charged another, and nothing anywhere would say so. */
var upliftSrc = lift(GAME, "upliftRate");
var rateSrc = lift(BILL, "vpbRate");
var strictSrc = lift(BILL, "vpbRateStrict");
pass("the game Worker has upliftRate", !!upliftSrc);
pass("the billing Worker has vpbRate", !!rateSrc);
pass("the billing Worker has vpbRateStrict", !!strictSrc);

if (upliftSrc && rateSrc && strictSrc) {
  eval(upliftSrc);
  var vpbIsFoundingPrice = function (env, priceId) { return priceId === "founding"; };
  eval(rateSrc);
  eval(strictSrc);
  var cases = [
    ["founding", "annual",  2.30],
    ["standard", "annual",  2.85],
    ["founding", "monthly", 2.50],
    ["standard", "monthly", 3.00]
  ];
  cases.forEach(function (c) {
    var tier = c[0], plan = c[1], want = c[2];
    var a = upliftRate(tier, plan === "annual");
    var b = vpbRate({}, tier === "founding" ? "founding" : "standard", plan);
    var s = vpbRateStrict({}, tier === "founding" ? "founding" : "standard", plan);
    pass(tier + " " + plan + " is $" + want.toFixed(2) + " in both Workers",
         a === want && b === want && s === want,
         "game " + a + ", billing " + b + ", strict " + s);
  });

  /* A price we cannot identify must not be guessed at. vpbRate shows the
     founding figure because it is display only; vpbRateStrict returns null so a
     caller about to move real money has to stop. */
  pass("an unknown price is refused by the strict rate", vpbRateStrict({}, null, "monthly") === null,
       "guessing a rate here charges the wrong number");
  pass("and the display rate still shows something", vpbRate({}, null, "monthly") === 2.50);
}

print("\nWHAT A SINGLE NIGHT CAN COST");
/* /join needs no login, so a flood cannot be ruled out by authorisation. The
   ceiling is what stops a venue being billed for players who were never there. */
var ceilSrc = lift(GAME, "overageCeiling");
pass("overageCeiling exists", !!ceilSrc);
if (ceilSrc) {
  eval("var OVERAGE_ACK_MARGIN = 10, OVERAGE_ABSOLUTE_MAX = 500;");
  eval(ceilSrc);
  pass("a host who approved 60 is billed at most 75",
       overageCeiling({ overage_approved_count: 60 }, 40) === 75, "60 + 25%");
  pass("a small room approved at 20 gets the flat margin, not a percentage",
       overageCeiling({ overage_approved_count: 20 }, 20) === 30, "20 + 10");
  pass("no recorded approval falls back to the plan cap",
       overageCeiling({}, 40) === 50, "the smallest defensible reading");
  pass("nothing can exceed the absolute backstop",
       overageCeiling({ overage_approved_count: 100000 }, 40) === 500,
       "a join flood cannot bill a venue into the thousands");
  pass("the ceiling always sits above the cap", overageCeiling({}, 1) > 1);
}

print("\nWHICH NIGHT A GAME BELONGS TO");
/* A session finishing at 12:30am belongs to the night it started, or a venue
   running one Saturday reads as two consecutive big nights and gets moved up a
   plan for it. */
var nightSrc = lift(GAME, "brisbaneNightKey");
pass("brisbaneNightKey exists", !!nightSrc);
if (nightSrc) {
  eval(nightSrc);
  // Brisbane is UTC+10 with no daylight saving.
  var satEvening = Date.UTC(2026, 8, 5, 11, 0);    // 9pm Sat Brisbane
  var sunHalf1 = Date.UTC(2026, 8, 5, 14, 30);     // 12:30am Sun Brisbane
  var sunLate = Date.UTC(2026, 8, 5, 17, 0);       // 3am Sun Brisbane
  pass("9pm Saturday and 12:30am Sunday are the SAME night",
       brisbaneNightKey(satEvening) === brisbaneNightKey(sunHalf1),
       brisbaneNightKey(satEvening) + " vs " + brisbaneNightKey(sunHalf1));
  pass("3am Sunday is a different night",
       brisbaneNightKey(satEvening) !== brisbaneNightKey(sunLate),
       "the boundary is 2am, not midnight");
}

print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
