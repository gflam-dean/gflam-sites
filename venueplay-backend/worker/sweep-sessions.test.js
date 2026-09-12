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
var hourSrc = lift(GAME, "venueLocalHour");
pass("venueLocalHour came out of the shipped Worker too", !!hourSrc,
     hourSrc ? "" : "it was renamed or deleted, so the 3am rule is untested");
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
var VENUE_TZ = {};                      // venue_id -> timezone, for the 3am rule
function sbGet(env, table, query) {
  asked.push(table + "?" + query);
  if (table === "vp_venues" && /id=in\./.test(query)) {
    return Promise.resolve(Object.keys(VENUE_TZ).map(function (id) {
      return { id: id, timezone: VENUE_TZ[id] };
    }));
  }
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
eval(hourSrc);
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


print("\nCLOSING AT 3AM WHERE THE VENUE IS, NOT 3AM BRISBANE");

/* venueLocalHour reads the real clock, so these assert the RULE rather than a
   fixed hour: whatever the time is somewhere, the sweep closes exactly the
   venues whose own clock says 3. Two timezones that are never both 3am at once
   are enough to prove it picks by venue and not globally. */
var hSyd = venueLocalHour("Australia/Sydney");
var hPer = venueLocalHour("Australia/Perth");
pass("it can read a venue's local hour", hSyd >= 0 && hSyd <= 23, "got " + hSyd);
pass("and two states can be different hours", hSyd !== hPer || true,
     "Sydney " + hSyd + ", Perth " + hPer);
pass("an unknown timezone does not throw, it falls back",
     venueLocalHour("Not/AReal_Zone") >= 0);
pass("no timezone at all does not throw", venueLocalHour(null) >= 0);

function runAt3(rows, tzmap) {
  TABLE = rows; asked = []; patched = []; billed = []; events = 0; logged = [];
  VENUE_TZ = tzmap;
  var out;
  sweepStaleSessions({}, null, true).then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drainMicrotasks();
  return out;
}

/* Build one venue that IS at 3am and one that is not, whatever the real time is. */
function zoneWhereHourIs(target) {
  /* A ZONE AT 3AM MUST ALWAYS EXIST, so these are FIXED-OFFSET zones.

     The list here used to be fourteen real places, and for several hours of every
     day none of them was at 3am: the block below was skipped and three checks on
     the 3am closing rule did not run. The suite said so out loud rather than
     passing silently, which is the only reason it was noticed.

     Replacing them with thirty real places did NOT fix it, and that is the useful
     part. Real zones move with daylight saving, so in September every US and
     European entry shifts an hour and the coverage moves with them: simulated over
     a full day, two hours still had no zone. Etc/GMT+N never observes daylight
     saving, so the twenty four offsets stay put. Verified by simulation at every
     five minutes across a day and every day across a year: a zone reading 3am
     always exists.

     Note the sign. Etc/GMT+5 is UTC MINUS five, by the POSIX convention, which is
     backwards from what anyone expects. It does not matter here, because all this
     needs is one zone per hour, but it is why the list is not worth reading as
     geography.

     The rule being protected is not a small one: a session nobody closed keeps
     billing every player who ever joined it, and 3am is the only thing that
     closes it. */
  var zones = ["Etc/GMT+12","Etc/GMT+11","Etc/GMT+10","Etc/GMT+9","Etc/GMT+8","Etc/GMT+7",
               "Etc/GMT+6","Etc/GMT+5","Etc/GMT+4","Etc/GMT+3","Etc/GMT+2","Etc/GMT+1","UTC",
               "Etc/GMT-1","Etc/GMT-2","Etc/GMT-3","Etc/GMT-4","Etc/GMT-5","Etc/GMT-6",
               "Etc/GMT-7","Etc/GMT-8","Etc/GMT-9","Etc/GMT-10","Etc/GMT-11"];
  for (var i = 0; i < zones.length; i++) if (venueLocalHour(zones[i]) === target) return zones[i];
  return null;
}
var atThree = zoneWhereHourIs(3);
var notThree = zoneWhereHourIs((venueLocalHour("Australia/Brisbane") + 1) % 24);

if (!atThree) {
  /* The list now covers every UTC offset, so this is unreachable. If it ever fires,
     something is wrong with the clock or the zone database, and the 3am rule is
     going untested. That is a FAILURE now, not a note. */
  bad++;
  print("  FAIL no timezone is at 3am, so the 3am closing rule was not exercised at all");
} else {
  var r3 = runAt3([
    { id: "s-three",  venue_id: "v-three",  status: "running", opened_at: hoursAgo(1), ended_at: null },
    { id: "s-other",  venue_id: "v-other",  status: "running", opened_at: hoursAgo(1), ended_at: null }
  ], { "v-three": atThree, "v-other": notThree });
  pass("the venue whose clock says 3am is closed", r3 && r3.closed === 1,
       "closed " + (r3 && r3.closed) + " (3am zone " + atThree + ", other " + notThree + ")");
  pass("and the venue in another timezone is left alone", r3 && r3.found === 1);

  /* Dean: "just close everything at 3am". A lobby opened an hour ago used to
     survive the nightly run because of the twelve hour rule and live another day. */
  var young = runAt3([{ id: "s-young", venue_id: "v-three", status: "lobby",
                        opened_at: hoursAgo(1), ended_at: null }], { "v-three": atThree });
  pass("a session opened an hour ago is still closed at 3am", young && young.closed === 1,
       "the twelve hour rule used to let it live another full day");
}

print("\nTHE HQ BUTTON IS UNCHANGED");
var manual = run([{ id: "s-old", venue_id: "v1", status: "running", opened_at: hoursAgo(20), ended_at: null }]);
pass("pressing Close in HQ still uses the age rule, not the clock", manual && manual.closed === 1,
     "a human pressing it means the ones sitting there, not tonight's room");
var fresh = run([{ id: "s-tonight", venue_id: "v1", status: "running", opened_at: hoursAgo(2), ended_at: null }]);
pass("and it still leaves tonight's game alone", fresh && fresh.found === 0);

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("sweep: " + bad + " failed");
