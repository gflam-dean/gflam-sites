/* Does a phone actually move when the host changes game?
   Run: jsc venueplay/app/vp-follow.test.js                                     */
var pass=0, fail=0, notes=[];
function ok(c,m){ if(c) pass++; else { fail++; notes.push("  FAIL  "+m); } }

/* A fake page: a clock we control, a fetch that answers what we say, and a
   location that records where it was sent instead of going there. */
function harness(reply){
  var g = { went:null, calls:0, timers:[] };
  g.window = g;
  g.location = { replace: function(u){ g.went = u; } };
  g.fetch = function(){ g.calls++; return Promise.resolve({ ok:true, json:function(){ return Promise.resolve(reply); } }); };
  /* Real ids and a real clearTimeout, because the code under test cancels and
     reschedules. A stub that returns 0 made every cancel a no-op and the backoff
     was never actually exercised. */
  g.delays = []; var _id = 0;
  g.setTimeout  = function(fn, ms){ g.timers.push(fn); g.delays.push(ms); return ++_id; };
  g.setInterval = function(fn, ms){ g.timers.push(fn); g.delays.push(ms); return ++_id; };
  g.clearTimeout = function(){};
  g.encodeURIComponent = encodeURIComponent;
  (new Function("globalThis","window","location","fetch","setTimeout","setInterval","clearTimeout",
                readFile("/tmp/vp-work/venueplay/app/vp-follow.js")))
    (g, g, g.location, g.fetch, g.setTimeout, g.setInterval, g.clearTimeout);
  return g;
}
function run(label, reply, opts, expect){
  var g = harness(reply);
  g.VPFollow.start(opts);
  g.timers.forEach(function(fn){ fn(); });          // fire the poll
  return Promise.resolve().then(function(){}).then(function(){}).then(function(){}).then(function(){
    if (expect === null) ok(g.went === null, label + ": should have stayed put, went to " + g.went);
    else ok(g.went === expect, label + ": expected " + expect + ", got " + g.went);
  });
}

var R = "ABC123";
var chain = Promise.resolve()
  // the bug Dean hit: host starts the wrong game then the right one
  .then(function(){ return run("trivia player, host switches to musical",
        { format:"musical_bingo" }, { api:"https://x", room:R, format:"trivia" },
        "/app/musical/play.html?room=ABC123"); })
  .then(function(){ return run("musical player, host switches to trivia",
        { format:"trivia" }, { api:"https://x", room:R, format:"musical" },
        "/app/trivia/play.html?room=ABC123"); })
  .then(function(){ return run("trivia player, host switches to bingo",
        { format:"bingo90" }, { api:"https://x", room:R, format:"trivia" },
        "/play?room=ABC123"); })
  // and the things that must NOT move a phone
  .then(function(){ return run("same game: stay",
        { format:"trivia" }, { api:"https://x", room:R, format:"trivia" }, null); })
  .then(function(){ return run("nothing running yet: stay",
        { format:"" }, { api:"https://x", room:R, format:"trivia" }, null); })
  .then(function(){ return run("raffle has no player app: stay",
        { format:"raffle" }, { api:"https://x", room:R, format:"trivia" }, null); })
  .then(function(){ return run("members draw has no player app: stay",
        { format:"members_draw" }, { api:"https://x", room:R, format:"musical" }, null); })
  .then(function(){ return run("a format we do not know: stay",
        { format:"quizmaster9000" }, { api:"https://x", room:R, format:"trivia" }, null); })
  // the worker handing back a different room code for the live session
  .then(function(){ return run("hop uses the session's own room code",
        { format:"musical", room_code:"ZZZ999" }, { api:"https://x", room:R, format:"trivia" },
        "/app/musical/play.html?room=ZZZ999"); })
  // and it must not run at all without the basics
  .then(function(){
      var g = harness({ format:"musical" });
      g.VPFollow.start({ api:"", room:R, format:"trivia" });
      ok(g.timers.length === 0, "no api address: must not poll");
      g = harness({ format:"musical" });
      g.VPFollow.start({ api:"https://x", room:"", format:"trivia" });
      ok(g.timers.length === 0, "no room code: must not poll");
  })
  // one hop only, however many times it is asked
  .then(function(){
      var g = harness({ format:"musical" });
      g.VPFollow.start({ api:"https://x", room:R, format:"trivia" });
      g.timers.forEach(function(fn){ fn(); });
      return Promise.resolve().then(function(){}).then(function(){}).then(function(){}).then(function(){
        var first = g.went, before = g.calls;
        g.timers.forEach(function(fn){ fn(); });
        ok(g.went === first, "a second poll must not hop again");
      });
  })
  // every phone in the room runs this, so it must not ask forever at full speed
  .then(function(){
      var g = harness({ format:"trivia" });      // same game: nothing to do, every time
      g.VPFollow.start({ api:"https://x", room:R, format:"trivia" });
      var step = function(){
        var fns = g.timers.slice(); g.timers.length = 0;
        fns.forEach(function(fn){ fn(); });
        return Promise.resolve().then(function(){}).then(function(){}).then(function(){});
      };
      var p = Promise.resolve();
      for (var i = 0; i < 10; i++) p = p.then(step);
      return p.then(function(){
        var last = g.delays[g.delays.length - 1];
        ok(last === 30000, "should have eased off to 30s, last delay was " + last);
        ok(g.delays[1] === 8000, "should start brisk, second delay was " + g.delays[1]);
      });
  });

chain.catch(function(e){ fail++; notes.push("  THREW "+e); }).then(function(){
  notes.forEach(function(n){ print(n); });
  print(fail ? "FAILED " + fail + " of " + (pass+fail) : "ALL " + pass + " CHECKS PASSED");
});
