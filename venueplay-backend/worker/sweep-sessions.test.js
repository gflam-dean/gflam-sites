/* THE NIGHTLY SWEEP, RUN RATHER THAN READ.

   The sweep is what closes a session a host walked away from. It ran every night
   for fifteen nights while a session at the-average-joe sat open from 26 August
   with four players who had actually played and three over the venue's cap, and
   every one of those runs reported a quiet night. The session's status was
   'cancelled'; the sweep asked for status in (lobby, running, paused); so it
   never asked about it at all.

   Nothing in the product writes 'cancelled'. It is in the table's CHECK
   constraint and has no producer, which is exactly the kind of value that gets
   left out of a whitelist, and any status added later would inherit the same
   fault in the same silence.

   So this suite lifts the REAL sweepStaleSessions out of the shipped Worker and
   runs it against a fake Supabase that records every request, because "it closed
   the session" and "it did not bill for it" are both claims about HTTP.

   Run: jsc venueplay-backend/worker/sweep-sessions.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var sweepSrc = lift(GAME, "sweepStaleSessions");
pass("the real sweep came out of the shipped Worker", !!sweepSrc,
     sweepSrc ? "" : "sweepStaleSessions was renamed or deleted");
if (!sweepSrc) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }

/* jsc has print, not console. The Worker logs, and without this the first log line
   throws a ReferenceError INSIDE the per-session catch, which logs again, throws again,
   and rejects the whole sweep. Two checks went red and the cause was this harness, not
   the Worker. Recording the lines rather than binning them, because what the sweep SAYS
   when it declines to bill is part of what is being tested. */
var logged = [];
var console = { log: function (m) { logged.push(String(m)); } };

/* The fake world. `table` is what vp_sessions holds. Every call is recorded. */
var asked, patched, billed, events;
var TABLE = [];
function enc(x){ return encodeURIComponent(x); }
function sbGet(env, table, query) {
  asked.push(table + "?" + query);
  // Honour the two filters the sweep actually sends, so the QUERY is under test too.
  var wantsUnended = /ended_at=is\.null/.test(query);
  var m = /opened_at=lt\.([^&]+)/.exec(query);
  var cutoff = m ? decodeURIComponent(m[1]) : null;
  var statusIn = /status=in\.\(([^)]*)\)/.exec(query);
  var out = [];
  for (var i = 0; i < TABLE.length; i++) {
    var r = TABLE[i];
    if (wantsUnended && r.ended_at) continue;
    if (statusIn && statusIn[1].split(",").indexOf(r.status) === -1) continue;
    if (cutoff && !(r.opened_at < cutoff)) continue;
    out.push({ id: r.id, venue_id: r.venue_id, opened_at: r.opened_at, status: r.status });
  }
  if (table === "vp_sessions" && /id=eq\./.test(query)) {
    var want = /id=eq\.([^&]+)/.exec(query)[1];
    for (var k = 0; k < TABLE.length; k++) if (TABLE[k].id === want) return Promise.resolve([TABLE[k]]);
    return Promise.resolve([]);
  }
  return Promise.resolve(out);
}
function sbPatch(env, table, filter, body) { patched.push(table + " " + filter); return Promise.resolve(); }
function getSession(env, id) {
  for (var i = 0; i < TABLE.length; i++) if (TABLE[i].id === id) return Promise.resolve(TABLE[i]);
  return Promise.reject(new Error("not found"));
}
function emitEvent() { events++; return Promise.resolve(); }
function chargeNightOverage(env, session) { billed.push(session.id); return Promise.resolve(); }
eval(sweepSrc);

function run(rows) {
  TABLE = rows; asked = []; patched = []; billed = []; events = 0; logged = [];
  var out;
  sweepStaleSessions({}).then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drainMicrotasks();
  return out;
}
function hoursAgo(h){ return new Date(Date.now() - h * 3600 * 1000).toISOString(); }

print("\nTHE ONE THAT WAS MISSED FOR FIFTEEN NIGHTS");
var r = run([{ id: "s-cancelled", venue_id: "v1", status: "cancelled", opened_at: hoursAgo(360), ended_at: null }]);
pass("a session with no end time is found whatever its status reads", r && r.found === 1,
     "found " + (r && r.found) + ": this is the exact row that sat open from 26 Aug");
pass("and it is closed", r && r.closed === 1);
pass("the query asks for NOT ENDED, not for a list of statuses",
     asked.length > 0 && /ended_at=is\.null/.test(asked[0]) && !/status=in\./.test(asked[0]),
     asked[0] ? asked[0].slice(0, 70) : "");
pass("closing it does NOT invent an invoice", billed.length === 0,
     "nothing in this product writes that status, so what it meant is not knowable");
pass("and it says so in the log, naming the status, rather than closing it in silence",
     logged.join(" ").indexOf("did NOT bill") !== -1 && logged.join(" ").indexOf("cancelled") !== -1,
     logged.length ? logged[0].slice(0, 80) : "nothing logged");

print("\nA REAL NIGHT STILL BILLS, WHICH IS THE POINT OF THE SWEEP");
r = run([{ id: "s-running", venue_id: "v1", status: "running", opened_at: hoursAgo(20), ended_at: null }]);
pass("a night the host walked away from is closed", r && r.closed === 1);
pass("and it IS billed, exactly as a host closing it would be", billed.length === 1 && billed[0] === "s-running");
pass("its games are finished too", patched.join(" ").indexOf("vp_games") !== -1);

r = run([{ id: "s-lobby", venue_id: "v1", status: "lobby", opened_at: hoursAgo(20), ended_at: null }]);
pass("a lobby left open overnight is closed and billed like any other night",
     r && r.closed === 1 && billed.length === 1);

print("\nWHAT IT MUST LEAVE ALONE");
r = run([{ id: "s-tonight", venue_id: "v1", status: "running", opened_at: hoursAgo(2), ended_at: null }]);
pass("tonight's game is not swept out from under the host", r && r.found === 0,
     "a long night is not an abandoned one");

r = run([{ id: "s-done", venue_id: "v1", status: "finished", opened_at: hoursAgo(100), ended_at: hoursAgo(99) }]);
pass("a session that really was closed is left alone", r && r.found === 0 && billed.length === 0);

/* Between listing and closing, a host can sign out. Without the second check the
   sweep would close it again and bill a second time for the same night. */
TABLE = [{ id: "s-race", venue_id: "v1", status: "running", opened_at: hoursAgo(20), ended_at: null }];
asked = []; patched = []; billed = []; events = 0;
var realGet = getSession;
getSession = function (env, id) {
  return Promise.resolve({ id: id, venue_id: "v1", status: "finished", opened_at: hoursAgo(20), ended_at: hoursAgo(1) });
};
var out2; sweepStaleSessions({}).then(function (x) { out2 = x; }); drainMicrotasks();
getSession = realGet;
pass("a session closed by the host in the meantime is not closed or billed twice",
     out2 && out2.closed === 0 && billed.length === 0);

print("\nWHEN THE DATABASE WILL NOT ANSWER");
var realGet2 = sbGet;
sbGet = function () { return Promise.reject(new Error("supabase is down")); };
var out3; sweepStaleSessions({}).then(function (x) { out3 = x; }); drainMicrotasks();
sbGet = realGet2;
pass("a failed sweep says so instead of printing what a quiet night prints",
     !!(out3 && out3.error), out3 && out3.error ? out3.error : "it returned a clean zero");

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("sweep: " + bad + " failed");
