/* A PARTYPLAY BINGO WIN IS NUMBERS THAT WERE CALLED, NOT NUMBERS THAT WERE TAPPED.

   Audit, 27 Sep 2026: the phone judged a line from its own taps alone, and the host
   console put any claim on the telly as the winner. Tap five uncalled numbers and your
   name went up. A second bingo game the same night also opened with the first game's
   card already marked, because the saved marks were keyed by party and token only.

   This RUNS the real bingo functions out of play.html (with the real pp-ticket.js) and
   the real onClaim out of run.html.

   Run: jsc partyplay-backend/lib/pp-bingo-called.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){
  if (typeof c !== "boolean") throw new Error("condition must be a boolean for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
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
eval(find("partyplay/lib/pp-ticket.js"));
var PPTicket = globalThis.PPTicket;
var PLAY = find("partyplay/play.html"), RUN = find("partyplay/run.html");

/* ---------------------------------------------------------------- the phone */
var store = {}, painted = "";
var localStorage = { getItem: function (k) { return k in store ? store[k] : null; },
                     setItem: function (k, v) { store[k] = String(v); } };
var ME = { code: "ABS3KM", token: "tok-for-sam", nickname: "Sam" };
function load() { return ME; }
function $() { return { set innerHTML(h) { painted = h; } }; }
var B = null;
var names = ["esc", "bingoStart", "bingoCalled", "bingoCounted", "bingoWinNums", "bingoSave", "paintBingo"];
var src = names.map(function (n) { return lift(PLAY, n); });
pass("the phone's bingo functions came out of play.html", src.every(Boolean),
     names.filter(function (n, i) { return !src[i]; }).join(", "));
eval(src.join("\n"));

bingoStart({ t: "bingo", gid: "g1" });
var row0 = B.grid[0].filter(Boolean), all = PPTicket.numbersOf(B.grid);
row0.forEach(function (n) { B.marked[n] = 1; });
paintBingo();
pass("a whole line tapped, none of it called: no Line button", painted.indexOf('data-claim="line"') < 0);
row0.slice(0, 4).forEach(function (n) { B.called.push(n); });
paintBingo();
pass("four of the five called: still no Line button", painted.indexOf('data-claim="line"') < 0);
bingoCalled([row0[4], 999, "x"]);
paintBingo();
pass("the fifth arrives in a ball's called list: Line button", painted.indexOf('data-claim="line"') >= 0);
pass("and junk in that list is ignored", B.called.indexOf(999) < 0 && B.called.length === 5);
pass("the claim carries exactly that line", JSON.stringify(bingoWinNums("line")) === JSON.stringify(row0),
     JSON.stringify(bingoWinNums("line")));
bingoSave();

bingoStart({ t: "bingo", gid: "g1", called: [] });
pass("control: a reload in the SAME game keeps the marks", Object.keys(B.marked).length === 5);
bingoStart({ t: "bingo", gid: "g2" });
pass("a NEW bingo game tonight starts with a clean card", Object.keys(B.marked).length === 0 && B.called.length === 0,
     JSON.stringify(B.marked));
bingoStart({ t: "bingo", gid: "g3", called: [all[0], all[1]] });
pass("a late phone is told what has already been called", B.called.length === 2);

/* ---------------------------------------------------------------- the host */
var toasts = [], sent = [], G = null;
function toast(m) { toasts.push(m); }
function send(o) { sent.push(o); }
var oc = lift(RUN, "onClaim");
pass("onClaim came out of run.html", !!oc);
eval(oc);
G = { called: [3, 14, 25, 36, 47] };
onClaim("Sam", "line", [3, 14, 25, 36, 48]);
pass("a claim with an uncalled number does not go on the telly", sent.length === 0, JSON.stringify(sent));
pass("and the host is told which number", /48 has not been called/.test(toasts[0] || ""), toasts[0]);
onClaim("Sam", "line", []);
pass("a claim with no numbers does not go on the telly", sent.length === 0);
onClaim("Sam", "line", [3, 14, 25, 36, 47]);
pass("control: a real line goes on the telly", sent.length === 1 && sent[0].text === "Sam" && sent[0].sub === "Line",
     JSON.stringify(sent));
pass("the host sees the ball list with every ball", /send\(\{t:"big",text:String\(n\),sub:callName\(n\),called:G\.called\.slice\(\)\}\)/.test(RUN));
pass("the host passes the numbers through to onClaim", /onClaim\(m\.name, m\.kind, m\.nums\)/.test(RUN));

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " bingo called checks failed");
