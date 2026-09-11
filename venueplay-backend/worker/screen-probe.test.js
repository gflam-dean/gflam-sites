/* A MONITORING TOOL MUST NOT BE ABLE TO FAKE THE THING IT MONITORS.

   On 11 Sep 2026 daily-venue-audit.py was changed to sweep all seventeen active venues
   instead of the one slug that had been hardcoded in it. That was the right fix to the
   wrong-sized problem: the tool polls GET /venue, and that route records the screen
   heartbeat, so ONE run of the audit wrote screen_seen_at for the whole fleet and set
   screen_version to 'daily-audit' on every venue.

   HQ's SCREEN OK / SCREEN DOWN badge reads screen_seen_at. It is the thing that catches
   a venue's TV going black, which has happened twice. After that audit run it would have
   shown seventeen healthy screens whether or not a single TV was switched on, and the
   real screen_version - which is how a stale screen is spotted - was gone.

   Measured live before this fix, on test-charlie:
       BEFORE  ('2026-09-11T09:28:38', 'daily-audit')
       AFTER   ('2026-09-11T10:11:53', 'daily-audit')     one probe, one write

   So: probe=1 gets a read-only answer. Everything else about the reply is identical,
   because the audit still has to prove the route works and the code resolves to the
   right venue. It just cannot leave a footprint.

   This suite lifts the real venueLookupThreeTrips() out of the shipped Worker and runs it against
   a fake database that records every PATCH. The claims are about writes: a normal poll
   writes, a probe does not, and a probe still gets the same venue back.

   Run: jsc venueplay-backend/worker/screen-probe.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");

/* THE GUARD IS IN THE SHIPPED FILE, not a copy of it. If somebody deletes the probe
   check, these claims are the ones that go red. */
pass("the Worker reads a probe flag at all", /searchParams\.get\('probe'\)/.test(GAME));
pass("and the heartbeat write is gated on it",
     /if \('screen_seen_at' in v && !isProbe\)/.test(GAME),
     "not gated means every probe writes");

/* THE PATH THIS SUITE MISSED THE FIRST TIME, and the whole reason it is written down.
   The fleet does not use venueLookupThreeTrips. Every screen poll goes to the
   vp_screen_poll RPC, which finds the venue, reads the row AND writes the heartbeat
   inside one database call, so guarding the fallback guarded nothing that matters.
   The first version of this suite passed, in full, while a probe against the deployed
   Worker wrote to a real venue row on staging. Only running it against the real thing
   found that. So: a probe must not be allowed to reach the RPC at all. */
pass("a probe never takes the one-trip RPC path",
     /if \(!screenPollRpcMissing && !isProbe\) \{/.test(GAME),
     "the RPC writes the heartbeat in the database, where no Worker guard can reach it");
pass("and the probe flag is read before that decision",
     GAME.indexOf("const isProbe") < GAME.indexOf("if (!screenPollRpcMissing && !isProbe)"),
     "reading it after the branch would make the guard dead code");

/* Now RUN it. A regex says the line exists; only running it says the line works. */
var patches = [];
function fakeEnv() { return {}; }
var sbGetCalls = 0;
function sbGet(env, table, q) {
  sbGetCalls++;
  if (/select=name,screen_reload_at/.test(q)) {
    return Promise.resolve([{ name: "The Jolly Jess", slug: "the-jolly-jess", status: "active",
                              screen_seen_at: "2026-09-01T00:00:00.000Z", screen_version: "real-screen-v9",
                              screen_reload_at: null, screen_command: null, screen_command_at: null }]);
  }
  return Promise.resolve([{ id: "venue-1" }]);
}
function sbPatch(env, table, where, body) { patches.push({ where: where, body: body }); return Promise.resolve({}); }
function enc(s) { return encodeURIComponent(String(s)); }
function venueByCode() { return Promise.resolve("venue-1"); }

/* Lift venueLookupThreeTrips() out of the Worker and give it the fakes above. */
function lift(src, name) {
  var i = src.indexOf("async function " + name + "(");
  if (i < 0) throw new Error("no function " + name);
  var depth = 0, started = false, j = i;
  for (; j < src.length; j++) {
    var c = src[j];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
var fnSrc = lift(GAME, "venueLookupThreeTrips");
pass("the route under test was found in the shipped Worker", fnSrc.length > 200, fnSrc.length + " chars");

eval(fnSrc);

/* jsc has no URLSearchParams. Only .get() is used by the code under test, and the
   shim is deliberately dumb so it cannot quietly disagree with the real thing. */
function params(qs) {
  var m = {};
  String(qs || "").split("&").forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf("="), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
    m[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return { get: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; } };
}

function run(qs, ver) {
  patches = [];
  var url = { searchParams: params(qs) };
  return venueLookupThreeTrips(fakeEnv(), url, "", ver);
}

/* 1. A REAL SCREEN. Last seen ten days ago, so the heartbeat is due. */
run("code=ABC123", "real-screen-v9").then(function (v) {
  pass("a normal poll still gets its venue back", !!v && v.name === "The Jolly Jess");
  pass("and it records the heartbeat", patches.length === 1,
       patches.length ? JSON.stringify(patches[0].body) : "nothing was written");
  pass("writing both the time and the screen version",
       patches.length === 1 && !!patches[0].body.screen_seen_at && patches[0].body.screen_version === "real-screen-v9");

  /* 2. THE AUDIT. Same venue, same route, probe=1. */
  return run("probe=1&code=ABC123", "daily-audit");
}).then(function (v) {
  pass("a probe still gets the same venue back", !!v && v.name === "The Jolly Jess",
       "the audit must still be able to prove the code resolves");
  pass("a probe leaves NO footprint", patches.length === 0,
       patches.length ? "it wrote " + JSON.stringify(patches[0].body) : "");

  /* 3. THE FAULT AS IT HAPPENED: the real screen version must survive the audit. */
  return run("probe=1&code=ABC123", "daily-audit");
}).then(function () {
  pass("and cannot overwrite screen_version with the tool's own name", patches.length === 0,
       "HQ spots a stale screen by its version; a probe must not become that version");

  /* 4. probe must be exactly 1. Anything else is a real screen, so a typo in a tool
        fails SAFE: it writes, the same as today, rather than silently going blind. */
  return run("probe=true&code=ABC123", "real-screen-v9");
}).then(function () {
  pass("probe=true is NOT a probe, so a typo fails safe", patches.length === 1,
       "a wrong value must not silently stop every heartbeat in the fleet");

  if (ran !== 12) { print("\nONLY " + ran + " OF 12 RAN"); throw new Error("incomplete"); }
  if (bad) { print("\n" + bad + " OF " + ran + " FAILED"); throw new Error(bad + " failed"); }
  print("\nALL " + ran + " CHECKS PASSED");
}).catch(function (e) {
  print("\nTHREW: " + (e && e.message || e));
  throw e;
});
