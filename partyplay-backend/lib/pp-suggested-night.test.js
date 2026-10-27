/* A FIRST-TIME HOST GETS A WHOLE NIGHT IN ONE TAP.

   Audit, 30 Sep 2026: a host with ten unfamiliar games and nobody to ask stalls at the first
   decision. host.html now offers a suggested night when the party has no games. RUNS the real
   addSuggestedNight out of host.html against a fake Worker and the REAL pack files, and reads back
   what was added, in what order, with what content.

   Run: jsc partyplay-backend/lib/pp-suggested-night.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 100) return t; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); } }
  return null;
}
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 200); i++) p = p.then(function(){}); return p; }

var HOST = find("partyplay/host.html");
var fnNight = lift(HOST, "addSuggestedNight"), fnPick = lift(HOST, "pickSome");
pass("addSuggestedNight and pickSome came out of host.html", !!fnNight && !!fnPick);
pass("the offer only shows on a party with no games yet", /if\(!GAMES\.length\)\{[\s\S]{0,1200}id="suggestNight"/.test(HOST));
pass("and its button reaches the handler", /if\(el\.id === "suggestNight"\)\{[^\n]*addSuggestedNight\(el\)/.test(HOST));

var CODE = "ABS3KM", KEY = "k".repeat(24), GAMES = [], toasts = [], posts = [], rendered = 0;
function toast(m) { toasts.push(m); }
function render() { rendered++; }
function api(path, o) {
  if (o && o.method === "POST") { var b = JSON.parse(o.body); posts.push(b); GAMES.push({ id: posts.length, format: b.format, title: b.title, config: b.config }); return Promise.resolve({ ok: true }); }
  return Promise.resolve({ games: GAMES.slice() });
}
function fetch(u) {
  var body = null; try { body = find("partyplay" + u); } catch (e) {}
  return Promise.resolve({ ok: !!body, json: function () { return Promise.resolve(JSON.parse(body)); } });
}
eval(fnPick); eval(fnNight);
var btn = { disabled: true, textContent: "Adding..." };
addSuggestedNight(btn);
flush().then(function () {
  var order = posts.map(function (p) { return p.format; }).join(",");
  pass("six games, in running order: warm-up, talk, truths, quiz, bingo, prize draw", order === "headstails,whohere,truths,trivia,bingo90,draw", order);
  var who = posts[1] || {}, quiz = posts[3] || {};
  pass("who here has ever gets ten ready prompts", who.config && who.config.items && who.config.items.length === 10 && who.config.items.every(function (i) { return i.q && i.q.length > 3; }));
  pass("the quiz gets ten family questions, each with four options and its answer among them",
       quiz.config && quiz.config.items && quiz.config.items.length === 10 &&
       quiz.config.items.every(function (i) { return i.q && i.options && i.options.length === 4 && i.options.indexOf(i.a) >= 0; }));
  pass("the quiz is named so the host can tell it apart", quiz.title === "Family quiz");
  pass("every game is saved to this party with its key", posts.every(function (p) { return p.code === CODE && p.key === KEY; }));
  pass("the host is told it is ready, and the list redraws", toasts[toasts.length - 1] === "Your night is ready" && rendered === 1 && GAMES.length === 6, toasts.join(" / "));
  print("\n" + (ran - bad) + " of " + ran + " checks passed");
  if (bad) throw new Error(bad + " suggested night checks failed");
}).catch(function (e) { print("CRASH " + e); throw e; });
