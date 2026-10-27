/* THE PARTYPLAY TELLY ONLY SHOWS A PARTY THAT EXISTS.
   Review, 28 Sep 2026: tv.html trusted any six characters, so a typo put a QR code and "Join the
   party" on the wall for a party nobody could join. RUNS the real checkCode() out of tv.html against
   a fake Worker. Run: jsc partyplay-backend/lib/pp-tv-code-check.test.js */
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }
function find(rel){ var t = [rel, "../" + rel, "../../" + rel]; for (var i = 0; i < t.length; i++){ try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} } throw new Error("cannot find " + rel); }
function lift(src, name){ var m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src); if(!m) return null; var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++){ if (src[j] === "{") d++; else if (src[j] === "}"){ d--; if (!d) return src.slice(m.index, j + 1); } } return null; }
var TV = find("partyplay/tv.html"), src = lift(TV, "checkCode");
pass("checkCode() came out of tv.html", !!src);
pass("connect() puts the lobby up first and THEN checks the code", /drawJoin\(\);\s*checkCode\(CODE\);/.test(TV));
function run(status, body){
  var asked = [], removed = [], noted = [], CODE = "ABS3KM";
  var fetch = function(u){ return Promise.resolve({ status: status, json: function(){ return Promise.resolve(body); } }); };
  var f = (new Function("fetch", "PPConfig", "localStorage", "askForCode", "document", "CODE",
    src + "\nreturn checkCode;"))
    (fetch, { API: "https://api" }, { removeItem: function(k){ removed.push(k); } }, function(m){ asked.push(m); },
     { querySelector: function(){ return { insertAdjacentHTML: function(w, h){ noted.push(h); } }; } }, CODE);
  return f(CODE).then(function(ok){ return { ok: ok, asked: asked, removed: removed, noted: noted }; });
}
run(404, { error: "No party with that code." }).then(function(r){
  pass("a code that is no party: the lobby comes down and the telly asks for the code again", r.ok === false && r.asked.length === 1);
  pass("...saying which code was wrong", /ABS3KM/.test(r.asked[0]) && /no party/i.test(r.asked[0]), r.asked[0]);
  pass("...and forgets it, so the bare address does not bring it straight back", r.removed.indexOf("ppTvCode") >= 0);
  return run(200, { code: "ABS3KM", status: "live" });
}).then(function(r){
  pass("control: a live party keeps the lobby up and asks nothing", r.ok === true && r.asked.length === 0 && r.noted.length === 0);
  return run(200, { code: "ABS3KM", status: "finished" });
}).then(function(r){
  pass("a finished party keeps the code up but says it has finished", r.ok === true && r.asked.length === 0 && /has finished/.test(r.noted[0] || ""));
  return run(500, {});
}).then(function(r){
  pass("the Worker failing is not a reason to take the lobby down", r.ok === true && r.asked.length === 0);
  print("\n" + (ran - bad) + " of " + ran + " checks passed");
  if (bad) throw new Error(bad + " tv code checks failed");
}).catch(function(e){ print("CRASH " + e + " " + (e && e.stack)); throw e; });
