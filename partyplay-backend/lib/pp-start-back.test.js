/* BACK FROM STRIPE PUTS THE PAY BUTTON BACK.
   start.html disables Pay and says "Taking you to Stripe..." on the way out. A browser that restores
   the page from its back/forward cache shows it exactly as left, so a buyer who pressed Back to change
   the plan had a dead button (audit, 27 Sep 2026). RUNS the page's real pageshow handler.
   Run: jsc partyplay-backend/lib/pp-start-back.test.js */
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }
function find(rel){ var t = [rel, "../" + rel, "../../" + rel]; for (var i = 0; i < t.length; i++){ try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} } throw new Error("cannot find " + rel); }
var SRC = find("partyplay/start.html");
var m = /window\.addEventListener\("pageshow", function\(ev\)\{[\s\S]*?\n  \}\);/.exec(SRC);
pass("the pageshow handler is in start.html", !!m);
var handlers = {}, refreshed = 0, cleared = 0;
var go = { disabled: true, textContent: "Taking you to Stripe..." };
var window = { addEventListener: function(t, f){ handlers[t] = f; } };
(new Function("window", "go", "refresh", "clearErr", m[0]))(window, go,
  function(){ refreshed++; go.textContent = "Continue to pay $50"; }, function(){ cleared++; });
handlers.pageshow({ persisted: false });
pass("an ordinary first load changes nothing", go.disabled === true && refreshed === 0);
handlers.pageshow({ persisted: true });
pass("a Back restore puts the button back and says the price again", go.disabled === false && go.textContent === "Continue to pay $50" && refreshed === 1);
pass("and clears any old error", cleared === 1);
print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " start page checks failed");
