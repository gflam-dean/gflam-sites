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
  // Repo-relative and named in full. A list that guesses wrong first still
  // WORKS, but jsc writes "Could not open file" to stderr and the release
  // check reads the LAST line of the run, so a harmless miss reads as a
  // failed suite.
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var BILL = find("venueplay-backend/worker/venueplay-api-FULL.js");

function lift(src, name) {
  // The optional `async ` matters: without it the lifted text starts at `function`
  // and every `await` inside becomes a syntax error, which reads as the Worker
  // being malformed rather than the harness being wrong.
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
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

print("\nEVERY FORMAT CAN ACTUALLY BE BILLED");
/* Overage counts only players who PLAYED, to stop a venue being charged twice for
   one crowd across two formats. But vp_cards is written only inside /host/game and
   the musical starter, and the bingo console never calls /host/game: broadcast
   bingo has no server game at all, so a night survives a Worker outage. The set
   came back EMPTY, peak was 0, and chargeNightOverage returned before billing a
   cent. The flagship format was free, and the three-big-nights plan uplift could
   never fire for a bingo-only venue. Found by audit 5 Sep 2026, and it was my own
   regression from fixing the double-count. */
var pw = lift(GAME, "playerIdsWhoPlayed");
var cw = lift(GAME, "countPlayersWhoPlayed");
var cp = lift(GAME, "countPlayers");
pass("the Worker has the who-played counters", !!pw && !!cw && !!cp);
if (pw && cw && cp) {
  var GAMES = [], CARDS = [], ANSWERS = [];
  globalThis.sbGet = function (e, t) {
    return Promise.resolve(t === "vp_games" ? GAMES : t === "vp_cards" ? CARDS
                         : t === "vp_trivia_answers" ? ANSWERS : []);
  };
  globalThis.enc = function (x) { return String(x); };
  eval(pw); eval(cw); eval(cp);
  function roster(n){ var r=[]; for (var i=0;i<n;i++) r.push({id:"p"+i, device_id:"d"+i}); return r; }

  // Synchronous drain: these promises resolve immediately, so collect and report.
  var results = {};
  function scenario(name, games, cards, answers, size, then) {
    GAMES = games; CARDS = cards; ANSWERS = answers;
    return playerIdsWhoPlayed({}, "s").then(function (set) {
      results[name] = countPlayersWhoPlayed(roster(size), set);
      if (then) then();
    });
  }
  scenario("bingo", [{id:"g1"}], [], [], 180, function () {
    scenario("trivia", [{id:"g1"}], [], [{player_id:"p0"},{player_id:"p1"},{player_id:"p2"}], 180, function () {
      scenario("musical", [{id:"g1"}], [{player_id:"p0"},{player_id:"p1"}], [], 180, function () {
        scenario("nogames", [], [], [], 50, function () {
          pass("broadcast bingo, 180 phones and no cards, counts 180 not 0",
               results.bingo === 180, "counted " + results.bingo);
          pass("trivia still counts only those who answered", results.trivia === 3,
               "counted " + results.trivia + " of 180 joined");
          pass("musical still counts only those dealt a card", results.musical === 2,
               "counted " + results.musical + " of 180 joined");
          pass("no game rows at all counts everyone, not nobody", results.nogames === 50,
               "counted " + results.nogames);
          print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
        });
      });
    });
  });
  // The tail print happens inside the chain above.
  var _deferred = true;
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

/* The verdict is printed by the async chain above, which resolves after every
   synchronous check in this file has run. Two summaries confused the release
   check, which reads only the LAST line. */

print("\nAN INCREASE IS QUOTED BEFORE IT IS CHARGED");
/* The billing page's only price sentence said "a full month at $2.30 per player".
   True for monthly. For ANNUAL the charge is rate x 12 x the fraction of the year
   left, so adding 50 players with ten months to run is $1,149.95 against the $115
   implied, taken on one click with no confirmation and no amount. The decrease path
   already named its credit; the charge named nothing. */
var adj = lift(BILL, 'vpbAdjustPlayerBilling');
pass("the charge function exists", !!adj);
pass("it supports a dry run", !!adj && /dryRun/.test(adj),
     "the page cannot state the figure without one");
pass("the dry run posts nothing", !!adj &&
     (adj.match(/if \(dryRun\) return \{ kind: 'quote'/g) || []).length === 2,
     "one exit before each Stripe post, monthly and annual");
var setp = lift(BILL, 'vpbSetPlayers');
pass("the endpoint honours preview", !!setp && /previewOnly/.test(setp));
pass("the reply names the amount charged", !!setp && /charge_cents/.test(setp),
     "so the page can tell the venue what just happened");
var page = find("venueplay/app/billing.html");
pass("the page asks for a quote before an increase", /preview:true/.test(page));
pass("and confirms with the figure", /confirm\(words\)/.test(page));
pass("the price sentence is plan-aware", /d\.plan === "annual"/.test(page),
     "one sentence for both plans was wrong by a factor of twelve");

print("\nAN IDEMPOTENCY KEY DESCRIBES THE MOVE, NOT THE DESTINATION");
/* venueId:players:periodEnd omits direction and size. 100 -> 50 -> 100 -> 50 inside
   Stripe's 24 hour window reused the first decrease's key, so the second credit
   never happened and the venue ended on 50 players having paid a year for capacity
   it gave back. Reverse it and the venue ends on 150 having paid nothing. */
['up', 'down', 'restore'].forEach(function (dir) {
  pass("the " + dir + " key carries its direction and delta",
       // Plain indexOf, not a built regex: escaping a paren through two layers
       // of quoting got it wrong and the error read as a malformed Worker.
       (setp || '').indexOf("':" + dir + "' + (") !== -1,
       "same target number, opposite move, must not share a key");
});

print("\nTHE FREE MONTH HAS ONE DEFINITION, AND IT IS STRIPE'S");
/* There were four: created_at + 30 days in the game Worker, sub.status === trialing
   in the billing Worker, a CALENDAR month in the bingo console, and Stripe's own
   trial_end set when the card is added. For an HQ-onboarded venue created_at is
   when HQ BUILT the venue, so a card added on day 20 gives a Stripe trial to day
   50 while the charge path stopped protecting them on day 30. Days 30 to 50 were
   billed inside a window the welcome email calls free. */
var chg = lift(GAME, 'applyOverageCharge');
pass("the charge path exists", !!chg);
pass("it reads the subscription status", !!chg && /subStatus/.test(chg));
pass("and refuses to charge a trialing subscription",
     !!chg && /subStatus === 'trialing'/.test(chg),
     "Stripe is the only one of the four that knows when the trial ends");

print("\nTHE THIRD-NIGHT HALF PRICE REQUIRES THE UPLIFT IT PAYS FOR");
/* $1 a head exists because the venue moves up a plan and pays more every month
   after. upliftPlan returns null without erroring when a reduction is already
   scheduled, when the venue raised its own cap, or when Stripe failed and was
   rolled back. The charge went out at $1 before any of that was known and the
   streak reset regardless, so a venue holding a scheduled reduction paid $20
   instead of $40 every third big night, for ever. */
pass("the uplift is attempted before the rate is decided",
     !!chg && chg.indexOf('upliftedTo = await upliftPlan') < chg.indexOf('const rateDollars'),
     "otherwise the discount is given before anyone knows if it was earned");
pass("half price requires the uplift to have happened",
     !!chg && /halfPrice = thirdInARow && upliftedTo != null/.test(chg));
pass("and the streak only resets when it did", !!chg && /if \(!halfPrice\) \{/.test(chg),
     "a reset without an uplift lets the discount repeat for ever");

print("\nA FAILED ANNUAL UPLIFT CHARGE IS ROLLED BACK");
/* On an annual plan the quantity update carries proration_behavior 'none', so the
   pro-rata invoiceitem is the ONLY thing that collects money before renewal. When
   it failed, quantityOk stayed true: the venue kept the bigger plan, paid nothing
   for it until renewal, and stopped paying per head too. */
var up = lift(GAME, 'upliftPlan');
pass("upliftPlan exists", !!up);
pass("a failed pro-rata sets quantityOk false", !!up &&
     /annual pro rata FAILED[\s\S]{0,600}?quantityOk = false/.test(up),
     "so the rollback below actually runs");
pass("and it leaves an audit row naming the failure", !!up &&
     /plan_uplift_rolled_back_charge_failed/.test(up),
     "the old one recorded effective: next_invoice, indistinguishable from monthly");
