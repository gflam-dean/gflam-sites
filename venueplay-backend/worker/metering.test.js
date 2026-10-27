/* THE BILLING TAB'S NUMBERS, RUN against the real handleMetering out of the Worker.

   Why this suite exists: HQ's billing tab read vp_billing_usage, a table nothing has ever
   written a row to, and so reported "no metered usage yet" on a business with 39 games played
   and two real overage charges collected. The replacement computes the figure live. A figure
   on a billing screen that disagrees with the figure on the invoice is worse than no figure,
   so what is checked here is AGREEMENT with the charging path, not just plausibility.

   Nothing is mocked except the database and the clock. countPlayers, countPlayersWhoPlayed
   and overageCeiling are the Worker's own, lifted verbatim, which is the point: if somebody
   changes how a head is counted for billing, this moves with it or goes red. */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) { var t = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} }
  throw new Error("cannot find " + rel); }
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); } }
  return null;
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");

var OVERAGE_ACK_MARGIN = (function () { var m = /OVERAGE_ACK_MARGIN\s*=\s*(\d+)/.exec(GAME); return m ? +m[1] : 10; })();
var OVERAGE_ABSOLUTE_MAX = (function () { var m = /OVERAGE_ABSOLUTE_MAX\s*=\s*(\d+)/.exec(GAME); return m ? +m[1] : 500; })();
eval(lift(GAME, "countPlayers"));
eval(lift(GAME, "countPlayersWhoPlayed"));
eval(lift(GAME, "overageCeiling"));
eval(lift(GAME, "handleMetering"));

pass("the endpoint exists in the Worker at all",
     /path === '\/admin\/metering'/.test(GAME), "and is routed, not just defined");

/* A FAKE DATABASE THAT ANSWERS THE REAL QUERIES. Each table is keyed by what the handler
   asks for, so a handler that asked for the wrong table gets nothing and the checks go red
   rather than quietly passing on a default. */
var DB, asked;
function rowsFor(table, q) {
  asked.push(table);
  var all = DB[table] || [];
  // in.(a,b,c) on whichever column the handler filtered by
  var m = /(\w+)=in\.\(([^)]*)\)/.exec(q);
  if (m) {
    var want = m[2].split(",");
    all = all.filter(function (r) { return want.indexOf(String(r[m[1]])) >= 0; });
  }
  var g = /(\w+)=gte\.([^&]+)/.exec(q);
  if (g) all = all.filter(function (r) { return String(r[g[1]] || "") >= decodeURIComponent(g[2]); });
  var e = /kicked=eq\.false/.test(q);
  if (e) all = all.filter(function (r) { return !r.kicked; });
  return Promise.resolve(all.slice());
}
sbGet = function (env, t, q) { return rowsFor(t, q); };
sbGetAll = function (env, t, q) { return rowsFor(t, q); };
enc = function (s) { return encodeURIComponent(String(s)); };
requireScreenAdmin = function () { return Promise.resolve({ ok: true }); };
var json = function (o, status) { return { _json: o, status: status || 200 }; };
/* jsc has no URL, and the Worker runtime does. Rather than change the handler to suit the
   test (which would be testing something Cloudflare does not run), give jsc the small part
   of URL the handler uses. A stub in the test is honest; a weakened handler is not. */
if (typeof URL === "undefined") {
  URL = function (href) {
    var q = String(href).split("?")[1] || "";
    this.searchParams = { get: function (k) {
      var parts = q.split("&");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (decodeURIComponent(kv[0]) === k) return decodeURIComponent(kv[1] || "");
      }
      return null;
    } };
  };
}
function req(qs) { return { url: "https://x/admin/metering" + (qs || "") }; }
var NOW = new Date().toISOString().slice(0, 7);

function reset() { asked = []; DB = { vp_venues: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_trivia_answers: [] }; }

/* ---- 1. the fault that started this: games played, and the screen says nothing ---- */
reset();
DB.vp_venues = [{ id: "v1", name: "The Jolly Jess", slug: "the-jolly-jess", max_players: 1 }];
DB.vp_sessions = [{ id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z", status: "finished", plan_cap_at_start: 1, overage_approved_count: 0 }];
DB.vp_players = [{ id: "p1", session_id: "s1", device_id: "d1" }, { id: "p2", session_id: "s1", device_id: "d2" }];
DB.vp_games = [{ id: "g1", session_id: "s1" }];
DB.vp_cards = [{ game_id: "g1", player_id: "p1" }, { game_id: "g1", player_id: "p2" }];

handleMetering(req(), {}, json).then(function (res) {
  var r = res._json;
  pass("a month with games produces a row, which is the whole bug",
       r.ok === true && r.rows.length === 1, JSON.stringify(r.rows));
  var row = r.rows[0];
  pass("it is the right venue and the right month",
       row.venue_id === "v1" && row.period_month === NOW + "-01", row.period_month);
  pass("two phones that both played count as two", row.peak_billable_players === 2);
  pass("and one of them is over a plan of one", row.overage_players === 1,
       "plan_cap " + row.plan_cap);
  pass("it names the night, so a figure can be traced to a game",
       row.peak_night === NOW + "-04", String(row.peak_night));
  pass("and says nothing was charged", /nothing was charged/.test(r.note));

  /* ---- 2. AGREEMENT WITH THE MONEY: a phone that opened the page but never played ----
     This is the exact distinction chargeNightOverage makes, and the reason a venue was once
     invoiced for a room bigger than the host was looking at. If this screen counted joins,
     it would quote a number we would never charge. */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 1 }];
  DB.vp_sessions = [{ id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z", plan_cap_at_start: 1 }];
  DB.vp_players = [{ id: "p1", session_id: "s1", device_id: "d1" },
                   { id: "p2", session_id: "s1", device_id: "d2" },
                   { id: "p3", session_id: "s1", device_id: "d3" }];
  DB.vp_games = [{ id: "g1", session_id: "s1" }];
  DB.vp_cards = [{ game_id: "g1", player_id: "p1" }, { game_id: "g1", player_id: "p2" }];
  return handleMetering(req(), {}, json);
}).then(function (res) {
  var row = res._json.rows[0];
  pass("a phone that opened the page and never played is not billed",
       row.peak_billable_players === 2, "3 joined, 2 were dealt in");

  /* ---- 3. one patron, several joins. Billing on rows charged a venue twice for a crowd
       that ran trivia and then musical bingo in one night. ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 10 }];
  DB.vp_sessions = [{ id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z", plan_cap_at_start: 10 }];
  DB.vp_players = [{ id: "p1", session_id: "s1", device_id: "d1" },
                   { id: "p2", session_id: "s1", device_id: "d1" },
                   { id: "p3", session_id: "s1", device_id: "d2" }];
  return handleMetering(req(), {}, json);
}).then(function (res) {
  pass("one phone joining twice is one person, not two",
       res._json.rows[0].peak_billable_players === 2, "d1 twice and d2 once makes 2");

  /* ---- 4. the peak rule: two busy nights in a month is one charge, the biggest ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 5 }];
  DB.vp_sessions = [
    { id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z", plan_cap_at_start: 5 },
    { id: "s2", venue_id: "v1", opened_at: NOW + "-11T09:00:00Z", plan_cap_at_start: 5 }];
  DB.vp_players = [{ id: "a", session_id: "s1", device_id: "1" }, { id: "b", session_id: "s1", device_id: "2" },
                   { id: "c", session_id: "s2", device_id: "3" }, { id: "d", session_id: "s2", device_id: "4" },
                   { id: "e", session_id: "s2", device_id: "5" }];
  return handleMetering(req(), {}, json);
}).then(function (res) {
  var r = res._json.rows;
  pass("two nights in one month make ONE row", r.length === 1, r.length + " rows");
  pass("and it holds the biggest night, not the sum", r[0].peak_billable_players === 3,
       "2 and 3 is a peak of 3, never 5");
  pass("and counts the nights behind it", r[0].nights === 2);
  pass("the peak night is the big one", r[0].peak_night === NOW + "-11", String(r[0].peak_night));

  /* ---- 5. a raffle night. No vp_players at all: not a big night, not a charge, not a
       missing row either, because "we ran something and nobody was metered" is a real answer. ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 5 }];
  DB.vp_sessions = [{ id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z", plan_cap_at_start: 5 }];
  return handleMetering(req(), {}, json);
}).then(function (res) {
  var r = res._json.rows;
  pass("a raffle night is a zero, not an overage", r.length === 1 && r[0].peak_billable_players === 0
       && r[0].overage_players === 0, JSON.stringify(r));

  /* ---- 6. the ceiling. A venue must never be quoted more than the host approved, for the
       same reason it is never CHARGED more: the count is made hours after the tap. ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 2 }];
  DB.vp_sessions = [{ id: "s1", venue_id: "v1", opened_at: NOW + "-04T09:00:00Z",
                      plan_cap_at_start: 2, overage_approved_count: 4 }];
  DB.vp_players = [];
  for (var i = 0; i < 40; i++) DB.vp_players.push({ id: "p" + i, session_id: "s1", device_id: "d" + i });
  return handleMetering(req(), {}, json);
}).then(function (res) {
  var peak = res._json.rows[0].peak_billable_players;
  var ceiling = overageCeiling({ overage_approved_count: 4 }, 2);
  pass("a flood is clamped to what the host approved, exactly as the charge is",
       peak === ceiling && peak < 40, peak + " billed of 40 joined, ceiling " + ceiling);

  /* ---- 7. no sessions at all. The honest empty answer, which is NOT the same sentence as
       "the table is empty because nothing writes it". ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 5 }];
  return handleMetering(req(), {}, json);
}).then(function (res) {
  pass("a genuinely quiet window says so and returns no rows",
       res._json.ok === true && res._json.rows.length === 0 && res._json.sessions === 0);

  /* ---- 8. it asks the right tables, and only in bulk. Five queries whatever the size:
       the per-session shape was two round trips a session and the gateway ceiling is real. ---- */
  reset();
  DB.vp_venues = [{ id: "v1", name: "Jess", max_players: 5 }];
  DB.vp_sessions = [];
  DB.vp_players = [];
  for (var k = 0; k < 30; k++) {
    DB.vp_sessions.push({ id: "s" + k, venue_id: "v1", opened_at: NOW + "-0" + (k % 9 + 1) + "T09:00:00Z", plan_cap_at_start: 5 });
    DB.vp_players.push({ id: "q" + k, session_id: "s" + k, device_id: "z" + k });
  }
  return handleMetering(req(), {}, json);
}).then(function (res) {
  pass("thirty sessions cost the same few queries as one", asked.length <= 5,
       asked.length + " queries: " + asked.join(", "));
  pass("and it reads vp_players, which is the meter", asked.indexOf("vp_players") >= 0);
  /* The first version of this scanned the whole file and went red on the paragraph above
     handleMetering, which EXPLAINS that vp_billing_usage is dead. A check that cannot tell a
     comment from a query is the same fault as one that cannot tell a string from a call, which
     is how check-stripe-fields gave a false all-clear last week. Scan the code. */
  var CODE = GAME.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  pass("it never reads vp_billing_usage, the table nothing writes",
       asked.indexOf("vp_billing_usage") < 0 && CODE.indexOf("vp_billing_usage") < 0,
       "comments about it are fine; a query for it is not");
  pass("and never vp_game_reports, which is the retention list and not a meter",
       asked.indexOf("vp_game_reports") < 0);

  /* ---- 9. months is bounded. An unbounded lookback on a growing business is the query
       that is fine all through a launch and then is not. ---- */
  return handleMetering(req("?months=999"), {}, json);
}).then(function (res) {
  pass("an absurd lookback is capped", res._json.months === 24, String(res._json.months));
  return handleMetering(req("?months=notanumber"), {}, json);
}).then(function (res) {
  pass("and nonsense falls back to a default rather than NaN", res._json.months === 6, String(res._json.months));
  finish();
}, function (e) {
  pass("the metering checks did not crash", false, String((e && e.stack) || e));
  finish();
});

function finish() { print(""); print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED")); }
