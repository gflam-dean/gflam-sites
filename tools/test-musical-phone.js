/* THE MUSICAL BINGO PHONE, RUN, not read. From the audit of 27 Sep 2026.

   3. The phone's channel ignored CLOSED and never set subscribed back to false, so after a drop
      the dot stayed green and join and BINGO went into a dead socket. Now a drop queues, shows
      Reconnecting, rebuilds the channel with a backoff, and says a pending BINGO again when it
      is back.
   4. The player's NAME was kept in sessionStorage while pid and token were in localStorage.
      iOS discards a backgrounded tab, sessionStorage goes with it, and connect() only restores a
      player holding BOTH a name and a token, so the punter was asked for their name mid-song.

   The functions are lifted out of the page that ships and run against fakes.

   Run: jsc tools/test-musical-phone.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || !why ? "" : "   " + why)); if(!c) bad++; }
var play = readFile("venueplay/app/musical/play.html");
pass("the musical phone page is readable", !!play && play.length > 20000);

function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return "";
}
function fakeStore(){ var d = {}; return { getItem: function(k){ return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
  setItem: function(k, v){ d[k] = String(v); }, removeItem: function(k){ delete d[k]; }, clear: function(){ d = {}; } }; }
function els(){ var m = {}; return function(id){ if (!m[id]) m[id] = { textContent: "", classList: { on: false, add: function(){ this.on = true; }, remove: function(){ this.on = false; } } }; return m[id]; }; }

print("");
print("3. A DROPPED CHANNEL IS NOTICED, REBUILT, AND A BINGO IS SAID AGAIN");
(function(){
  var a = play.indexOf("  var chRetryT=null, chTries=0;");
  var SRC = a > 0 ? grab("openChannel", play.slice(a)) : "";
  pass("the phone's channel code is where the test expects it", !!SRC);
  var send = grab("send", play), flush = grab("flushQueue", play);
  pass("send and flushQueue are lifted from the page", !!send && !!flush);
  var timers = [], tid = 0, chans = [], sent = [], fetched = 0;
  var client = { channel: function(name){ var c = { name: name, on: function(){ return c; }, subscribe: function(cb){ c.cb = cb; return c; },
                   send: function(m){ if (c.dead) return; sent.push(m.payload); } }; chans.push(c); return c; },
                 removeChannel: function(c){ c.dead = true; if (c && c.cb) c.cb("CLOSED"); } };
  var P = { room: "ABC123", pid: "pid1", name: "Sam", joined: true, claimPending: false, claimId: "", claimMsg: null, won: false, ended: false };
  var $ = els();
  var env = { client: client, P: P, $: $, window: {}, fetchCard: function(){ fetched++; }, onMsg: function(){},
              setTimeout: function(fn, ms){ var t = { fn: fn, ms: ms, id: ++tid }; timers.push(t); return t.id; },
              clearTimeout: function(id){ timers = timers.filter(function(t){ return t.id !== id; }); } };
  var names = Object.keys(env);
  var api = (new Function(names.join(","), "var ch=null, subscribed=false, sendQueue=[];" + send + flush + "var chRetryT=null, chTries=0;" + SRC +
    "; return { open: openChannel, send: send, cur: function(){ return ch; }, sub: function(){ return subscribed; }, q: function(){ return sendQueue; } };")).apply(null, names.map(function(k){ return env[k]; }));
  function fire(){ var t = timers.slice(); timers = []; t.forEach(function(x){ x.fn(); }); }

  api.open("ABC123"); api.cur().cb("SUBSCRIBED");
  pass("connected: the dot is green and the seat is announced", $("statusDot").classList.on && sent.some(function(m){ return m.t === "join"; }));
  var first = api.cur(); sent.length = 0;
  first.dead = true; first.cb("CLOSED");
  pass("CLOSED is a drop: the phone stops sending into the dead socket", api.sub() === false);
  pass("...and the dot goes off and says Reconnecting", !$("statusDot").classList.on && $("statusText").textContent === "Reconnecting");
  api.send({ t: "join", pid: "pid1", name: "Sam" });
  pass("a send while it is down is queued, not lost", api.q().length === 1 && sent.length === 0);
  var waits = timers.map(function(t){ return t.ms; });
  pass("a rebuild is booked with a backoff", waits.length === 1 && waits[0] >= 2000, JSON.stringify(waits));
  first.cb("CLOSED");
  pass("a second CLOSED does not book a second rebuild", timers.length === 1);
  fire();
  pass("the rebuild really opens a fresh channel", chans.length === 2 && api.cur() !== first);
  first.cb("SUBSCRIBED");
  pass("the old channel speaking up afterwards is ignored", api.sub() === false);
  P.claimPending = true; P.claimId = "claim-1"; P.claimMsg = { t: "claim", claim_id: "claim-1", pid: "pid1", name: "Sam" };
  api.cur().cb("SUBSCRIBED");
  pass("back: the queued send goes out", sent.some(function(m){ return m.t === "join"; }) && api.q().length === 0);
  pass("...and the BINGO still waiting on the host is said again", sent.filter(function(m){ return m.t === "claim" && m.claim_id === "claim-1"; }).length === 1, JSON.stringify(sent));
  pass("...and the dot is green again", $("statusDot").classList.on && api.sub() === true);

  sent.length = 0; P.claimPending = false;
  api.cur().cb("TIMED_OUT");
  var cur = api.cur(), before = chans.length;
  cur.cb("SUBSCRIBED"); fire();
  pass("a blip that heals by itself cancels the rebuild, so the working channel is kept", chans.length === before && api.cur() === cur);
  pass("no pending claim, nothing claimed again", !sent.some(function(m){ return m.t === "claim"; }));
  P.claimPending = true; P.won = true; sent.length = 0;
  api.cur().cb("CHANNEL_ERROR"); fire(); api.cur().cb("SUBSCRIBED");
  pass("a claim already decided is not said again", !sent.some(function(m){ return m.t === "claim"; }));
  timers = [];
  for (var k = 0; k < 8; k++){ api.cur().cb("CHANNEL_ERROR"); var w = timers.length ? timers[0].ms : 0; fire(); }
  pass("the backoff tops out at 30 seconds", w === 30000, String(w));
  pass("pressBingo keeps the claim so a reconnect can say it", play.indexOf("P.claimMsg={ t:\"claim\", claim_id:r.claim_id") > 0 && play.indexOf("send(P.claimMsg);") > 0);
})();

print("");
print("4. A DISCARDED TAB COMES BACK AS THE SAME PLAYER, WITHOUT BEING ASKED FOR A NAME");
(function(){
  var fns = ["loadPid", "savePid", "loadName", "saveName", "loadToken", "saveToken", "loadSess", "saveSess", "connect"].map(function(n){ return grab(n, play); });
  pass("the identity functions and connect() are lifted from the page", fns.every(Boolean));
  var local = fakeStore(), session = fakeStore();
  function boot(){
    var P = { room: "", pid: "", name: "", joined: false, token: "", sessionId: "" };
    var routed = 0, info = 0;
    (new Function("localStorage", "sessionStorage", "P", "$", "window", "randId", "openChannel", "loadJoinInfo", "route", "VP_GAME_API",
      fns.join("\n") + "; return connect;"))(local, session, P, els(), {}, function(){ return "newpid"; }, function(){}, function(){ info++; }, function(){ routed++; }, "")("ABC123");
    return { P: P, askedForName: info > 0 };
  }
  var s = (new Function("localStorage", "sessionStorage", fns.join("\n") + "; return { saveName: saveName, savePid: savePid, saveToken: saveToken };"))(local, session);
  s.savePid("ABC123", "pid-sam"); s.saveToken("ABC123", "tok-sam"); s.saveName("ABC123", "Sam");
  var r = boot();
  pass("a reload with the tab still alive: Sam is back in", r.P.joined === true && r.P.name === "Sam");
  session.clear();   // iOS discarded the backgrounded tab: sessionStorage is gone, localStorage is not
  r = boot();
  pass("after iOS discards the tab: the same pid and token", r.P.pid === "pid-sam" && r.P.token === "tok-sam");
  pass("...and the name, so Sam is back in without being asked for it mid-song", r.P.joined === true && r.P.name === "Sam" && !r.askedForName, JSON.stringify(r.P));
  local.clear(); session.clear(); session.setItem("vp-mname-ABC123", "Old"); local.setItem("vp-mtoken-ABC123", "tok-old");
  r = boot();
  pass("a name saved by the previous build (sessionStorage) is still read", r.P.joined === true && r.P.name === "Old");
  local.clear(); session.clear();
  r = boot();
  pass("control: a phone that never joined is asked for a name", r.P.joined === false && r.askedForName);
})();

print("");
print(bad ? ("  " + bad + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
