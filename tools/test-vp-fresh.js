/* A VENUE SCREEN NEVER RUNS AN OLD RELEASE (Dean, live play on The Mini Bar with the Kogan TV app, 12 Nov 2026,
   INBOX 282.9). RUN, not read: /app/vp-fresh.js with a stand-in site, and tv.html's own handler lifted out and run.

   The Kogan showed the old musical intro, no fades and the old raffle look. Every file is served no-cache, so a LOAD is
   always live; but a TV loads /tv once and keeps it for days, and nothing told it a release had gone out (TV_BUILD is a
   constant from 1 Nov). Now the screen fingerprints the site at load and every 10 minutes, and reloads when it changes:
   at once on the ads, otherwise when the game ends.

   Run: jsc tools/test-vp-fresh.js   (from the repo root) */
var ran = 0, bad = 0;
function pass(n, c, saw){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "   saw: " + saw)); if(!c) bad++; }
function drain(){ drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); }
var FRESH = readFile("venueplay/app/vp-fresh.js");
var TV = readFile("venueplay/tv.html");
var W = {}; (new Function("window", FRESH))(W);
var F = W.VPFresh;

/* The site: the page's HTML and each script's ETag, changeable between looks. */
function Site(){
  var s = { html: "<html>tv v1</html>", tags: { "/app/a.js": 'W/"a1"', "/app/b.js": 'W/"b1"' }, down: false, calls: [] };
  s.fetch = function(u, o){
    s.calls.push([u, o && o.method || "GET", o && o.cache]);
    if(s.down) return Promise.reject(new Error("offline"));
    if(o && o.method === "HEAD") return Promise.resolve({ ok: true, status: 200, headers: { get: function(k){ return k === "etag" ? s.tags[u] : null; } } });
    return Promise.resolve({ ok: true, status: 200, text: function(){ return Promise.resolve(s.html); } });
  };
  return s;
}
function Timers(){ var t = { q: [] }; t.set = function(f, ms){ t.q.push([f, ms]); return t.q.length; }; t.run = function(){ var x = t.q.shift(); if(x) x[0](); drain(); return !!x; }; return t; }

print("\n1. THE FINGERPRINT: the page and every script it loaded from this site");
(function(){
  var doc = { getElementsByTagName: function(){ return [
    { getAttribute: function(){ return "/app/a.js"; } }, { getAttribute: function(){ return null; } },
    { getAttribute: function(){ return "https://cdn.example.com/x.js"; } }, { getAttribute: function(){ return "https://venueplay.com.au/app/b.js"; } } ]; } };
  var own = F.ownScripts(doc, "https://venueplay.com.au");
  pass("this site's scripts are named, another site's and inline ones are not", own.join() === "/app/a.js,https://venueplay.com.au/app/b.js", own.join());
  var s = Site(), fp = null;
  F.fingerprint({ fetch: s.fetch, page: "/tv?venue=the-mini-bar&app=tizen", scripts: ["/app/a.js", "/app/b.js"] }).then(function(x){ fp = x; }); drain();
  pass("the page is fetched with no cache, the scripts asked by HEAD with no cache", s.calls.length === 3 && s.calls[0][0] === "/tv?venue=the-mini-bar&app=tizen" && s.calls[0][2] === "no-store" && s.calls[1][1] === "HEAD" && s.calls[2][2] === "no-store", JSON.stringify(s.calls));
  pass("a fingerprint is the page hash and each script's tag", fp === F.fnv("<html>tv v1</html>") + '|"a1"|"b1"', fp);
})();

print("\n2. LOOKING EVERY 10 MINUTES");
(function(){
  var s = Site(), t = Timers(), told = [];
  var h = F.start({ fetch: s.fetch, setTimeout: t.set, page: "/tv", scripts: ["/app/a.js", "/app/b.js"], onNew: function(){ told.push(1); } });
  drain();
  pass("the first look is the base, and the next look is set for 10 minutes", h.base() !== null && t.q.length === 1 && t.q[0][1] === 600000, [h.base(), JSON.stringify(t.q.map(function(x){ return x[1]; }))]);
  t.run();
  pass("nothing released: nothing said", told.length === 0 && t.q.length === 1);
  s.down = true; t.run();
  pass("a look that cannot reach the site says nothing and looks again", told.length === 0 && t.q.length === 1);
  s.down = false; s.tags["/app/b.js"] = 'W/"b2"'; t.run();
  pass("a SCRIPT changed on the site (vp-sting.js, say): the page is told", told.length === 1, told.length);
  pass("and told once: no more looks after that", t.q.length === 0, t.q.length);
  var s2 = Site(), t2 = Timers(), told2 = 0;
  F.start({ fetch: s2.fetch, setTimeout: t2.set, page: "/tv", scripts: ["/app/a.js"], onNew: function(){ told2++; } }); drain();
  s2.html = "<html>tv v2</html>"; t2.run();
  pass("the PAGE changed on the site: the page is told", told2 === 1, told2);
})();

print("\n3. TV.HTML: RELOAD ON THE ADS, WAIT FOR THE GAME OTHERWISE (its own handler, lifted out and run)");
(function(){
  pass("tv.html loads /app/vp-fresh.js before its own script", /<script src="\/app\/vp-fresh\.js"><\/script>/.test(TV) && TV.indexOf("/app/vp-fresh.js") < TV.indexOf("VPFresh.start("));
  var i = TV.indexOf("    if(window.VPFresh) VPFresh.start("), j = TV.indexOf("} });", i);
  pass("CONTROL: the handler is found", i > 0 && j > i);
  var src = TV.slice(i, j + 5);
  function run(mode){
    var r = { reloads: [], armed: 0, why: "" }, onNew = null;
    var win = { VPFresh: { start: function(o){ onNew = o.onNew; } }, __vpTvReload: function(w){ r.reloads.push(w); } };
    var env = { reloadWhenIdle: false };
    var fn = new Function("window", "VPFresh", "tvMode", "sessionStorage", "location", "armStuckReload", "env",
      "var reloadWhenIdle=false;\n" + src.replace(/^\s*/, "") + "\nreturn function(){ return reloadWhenIdle; };");
    var idle = fn(win, win.VPFresh, mode, { setItem: function(k, v){ r.why = v; } }, { reload: function(){ r.reloads.push("bare"); } }, function(){ r.armed++; }, env);
    onNew();
    r.idle = idle();
    return r;
  }
  var a = run("ads");
  pass("a new release seen on the ads: reload now, through the watchdog's reload (its rate limit kept)", a.reloads.join() === "new-release" && a.why === "new-release", JSON.stringify(a));
  var g = run("embed");
  pass("seen during a game: no reload now; it waits for the ads (reloadWhenIdle) with the stuck timer armed", g.reloads.length === 0 && g.idle === true && g.armed === 1, JSON.stringify(g));
})();

print("");
print(bad ? (bad + " FAILED, " + ran + " run") : ("ALL " + ran + " CHECKS PASSED"));
if(bad) throw new Error(bad + " failed");
