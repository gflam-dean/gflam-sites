/* THE NAME GOES WITH THE PLAYER. /play shows the bingo name box at once and asks the Worker in the
   background what the code is for, so a punter could type a name, be moved to trivia or musical, and
   be asked for it again (the "double join" on the live-test list; seen on Test Alpha 25 Sep 2026).
   Runs the REAL hopToApp from /play and the REAL takeHopName from both game phones.
   Run: jsc venueplay-backend/app/hop-name.test.js */
var bad = 0, ran = 0;
function ok(n, c, extra){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); } }
function find(rel){
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {} }
  throw new Error("cannot open " + rel);
}
function lift(text, name){
  var i = text.indexOf("function " + name + "(");
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = i; j < text.length; j++) {
    if (text[j] === "{") { d++; started = true; }
    else if (text[j] === "}") { d--; if (started && d === 0) return text.slice(i, j + 1); }
  }
  return null;
}
var PLAY = find("venueplay/play.html"), TRIV = find("venueplay/app/trivia/play.html"), MUS = find("venueplay/app/musical/play.html");

/* a browser, as far as these two functions can see one */
var store = {}, went = null, els = {};
var sessionStorage = { getItem: function(k){ return k in store ? store[k] : null; },
                       setItem: function(k, v){ store[k] = String(v); }, removeItem: function(k){ delete store[k]; } };
var window = { location: { replace: function(u){ went = u; } } };
function $(id){ return els[id] || null; }

var hop = lift(PLAY, "hopToApp");
ok("/play has hopToApp", !!hop);
eval(hop);
els.nameIn = { value: "  Tester Tom " };
hopToApp("/app/trivia/play?room=ABCDEF");
ok("the hop still goes where it was told", went === "/app/trivia/play?room=ABCDEF", went);
ok("the typed name is kept for the next page, trimmed", store.vpHopName === "Tester Tom", store.vpHopName);
ok("and it is NOT in the address (analytics records addresses)", went.indexOf("Tom") < 0);
store = {}; els.nameIn = { value: "" }; hopToApp("/app/musical/play?room=ABCDEF");
ok("control: nothing typed, nothing kept", !("vpHopName" in store));
ok("both hops on /play go through it",
   (PLAY.match(/hopToApp\(to\+"\?room="/g) || []).length === 2 && PLAY.indexOf('window.location.replace(to+"?room="') < 0);

[["trivia", TRIV], ["musical", MUS]].forEach(function(pair){
  var fn = lift(pair[1], "takeHopName");
  ok(pair[0] + " phone has takeHopName", !!fn);
  eval(fn);
  store = { vpHopName: "Tester Tom" }; els.nameIn = { value: "" };
  takeHopName();
  ok(pair[0] + ": the name typed on /play is filled in", els.nameIn.value === "Tester Tom", els.nameIn.value);
  ok(pair[0] + ": once only (a reload does not bring it back)", !("vpHopName" in store));
  store = { vpHopName: "Tester Tom" }; els.nameIn = { value: "Quiz Kings" };
  takeHopName();
  ok(pair[0] + ": never over a name already there", els.nameIn.value === "Quiz Kings", els.nameIn.value);
  ok(pair[0] + ": runs when the page loads", pair[1].indexOf("\n  takeHopName();") >= 0);
});

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
