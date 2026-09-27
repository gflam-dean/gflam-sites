/* THE HOST CAN ACTUALLY SAVE THE ALBUM, AND A DELETED ALBUM SAYS IT WAS DELETED.

   Audit, 27 Sep 2026:
   - host.html's Download opened one tab per photo from a timer after a network call.
     Every pop-up blocker refuses that, so the host got one photo or none.
   - album.html said "Nobody took any photos" when the photos had been deleted on the
     thirty day schedule, to a guest who had taken plenty.

   RUNS the real downloadAll out of host.html and the real album.html script.

   Run: jsc partyplay-backend/lib/pp-photo-downloads.test.js
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
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 60); i++) p = p.then(function(){}); return p; }

/* ------------------------------------------------------------- host download */
var HOST = find("partyplay/host.html");
var dl = lift(HOST, "downloadAll");
pass("downloadAll came out of host.html", !!dl);
var CODE = "ABS3KM", KEY = "k".repeat(24), PPConfig = { API: "https://api" };
var toasts = [], saved = [], opened = [], fetched = [];
function toast(m) { toasts.push(m); }
function api() { return Promise.resolve({ photos: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] }); }
function fetch(u) {
  fetched.push(u);
  if (/id=p2/.test(u)) return Promise.resolve({ ok: false, status: 404 });
  return Promise.resolve({ ok: true, blob: function () { return Promise.resolve({ type: /p3/.test(u) ? "video/mp4" : "image/jpeg" }); } });
}
var window = { open: function (u) { opened.push(u); } };
var URL = { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} };
var document = { body: { appendChild: function () {} },
  createElement: function () { var a = { click: function () { saved.push(a.download); }, remove: function () {} }; return a; } };
function setTimeout(f) { Promise.resolve().then(f); return 0; }
eval(dl);
downloadAll();
flush(200).then(function () {
  pass("nothing is opened in a tab for a pop-up blocker to refuse", opened.length === 0, opened.length + " opened");
  pass("every photo is fetched, one after another", fetched.length === 3, JSON.stringify(fetched.map(function(u){ return u.slice(-5); })));
  pass("the two that came back are saved as files", JSON.stringify(saved) === JSON.stringify(["party-ABS3KM-1.jpg", "party-ABS3KM-3.mp4"]), JSON.stringify(saved));
  pass("and the host is told one would not download", /Saved 2, 1 would not download/.test(toasts[toasts.length - 1] || ""), toasts[toasts.length - 1]);
}).then(function () {
  /* ------------------------------------------------------------- album page */
  var src = find("partyplay/album.html");
  var body = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  function runAlbum(data) {
    var els = {};
    var doc = { getElementById: function (id) { return els[id] || (els[id] = { innerHTML: "", addEventListener: function(){} }); } };
    var f = function () { return Promise.resolve({ json: function () { return Promise.resolve(data); } }); };
    (new Function("window","document","location","fetch","PPConfig","URLSearchParams", body))
      ({}, doc, { search: "?share=abcdefabcdefabcdef" }, f, { API: "https://x" },
       function(){ this.get = function(){ return "abcdefabcdefabcdef"; }; });
    return flush(40).then(function () { return (els.app || {}).innerHTML || ""; });
  }
  return runAlbum({ party: "Sam's 40th", count: 0, photos: [], expired: true }).then(function (h) {
    pass("a deleted album says it was deleted", /have been deleted/.test(h) && !/Nobody took/.test(h), h.slice(0, 160));
    return runAlbum({ party: "Sam's 40th", count: 0, photos: [] });
  }).then(function (h) {
    pass("control: an album nobody used still says so", /Nobody took any photos/.test(h), h.slice(0, 120));
  });
}).then(function () {
  print("\n" + (ran - bad) + " of " + ran + " checks passed");
  if (bad) throw new Error(bad + " photo download checks failed");
}).catch(function (e) { print("CRASH " + (e && e.stack || e)); throw e; });
