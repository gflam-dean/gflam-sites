/* THE COASTER ROUND'S WORKER ROUTES, RUN (/live-here-now v2, Dean 4 Nov 2026; migration 153).

   Dean's spec (reports/live-here-now-v2/DEAN-NOTES.md, later items override earlier):
     - first name at the start, so the end is personalised; first names only, never a surname or
       a contact detail on a board
     - "Where are you playing?": type three letters of the pub's name; the search lists ONLY what
       is in venueplay (customers, prospects and coaster venues added in HQ), never the cold list;
       a pub that is not listed is typed in and kept as a lead for Dean
     - points like real venueplay trivia: right answers score, plus a speed bonus, the same rule
       as the trivia game ("Correct! +130"); ties go to the faster total time
     - a board PER VENUE, "Tonight" and "This week", resetting by itself
     - "Challenge your mates": a link that puts friends on the same five questions and board

   This lifts the real coaster block out of the shipped venueplay-game.js (from COASTER_BANK_URL to
   the next section), with the real helpers it calls (the TV app's venue search, triviaAnswerPoints,
   cleanName, the venue calendar), and RUNS every route against a fake database that honours
   filters, order, offset and limit and the tables' unique keys, a fake rate limiter, a fixed clock
   and the page's real question file (venueplay/data/live-here-now.json).

   Run: jsc venueplay-backend/worker/coaster-round.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || extra === undefined ? "" : "   saw: " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400))); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel, "../../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var BANKFILE = find("venueplay/data/live-here-now.json");
var BANK = JSON.parse(BANKFILE).q;

/* ---- the real code, lifted ---- */
function lift(n) {
  var i = GAME.indexOf("\nasync function " + n + "("); if (i < 0) i = GAME.indexOf("\nfunction " + n + "(");
  if (i < 0) throw new Error("no function " + n);
  var d = 0, k = GAME.indexOf("{", i);
  for (; k < GAME.length; k++) { var ch = GAME[k]; if (ch === "{") d++; else if (ch === "}") { d--; if (!d) { k++; break; } } }
  return GAME.slice(i, k) + "\n";
}
var a0 = GAME.indexOf("const COASTER_BANK_URL");
var a1 = GAME.indexOf("/* The TV's &tvk=", a0);
pass("the coaster block is in the shipped Worker", a0 > 0 && a1 > a0);
var BLOCK = GAME.slice(a0, a1);
var f0 = GAME.indexOf("const FIND_MIN_LETTERS"), f1 = GAME.indexOf("async function handleVenueFind(", f0);
pass("the TV app's venue search is in the shipped Worker", f0 > 0 && f1 > f0);
var SEARCH = GAME.slice(f0, f1);
var uu = /const UUID_RE = [^\n]*\n/.exec(GAME);

/* ---- a fake database ---- */
var DB, calls, limited, NOW, fetched, uid = 0;
function nextId() { uid++; var h = ("00000000" + uid.toString(16)).slice(-8); return h + "-0000-4000-8000-" + ("000000000000" + uid.toString(16)).slice(-12); }
function parseQ(q) {
  var out = { f: [], order: [], limit: null, offset: 0, select: "*" };
  q.split("&").forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf("="), k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
    if (k === "select") out.select = v;
    else if (k === "order") out.order = v.split(",").map(function (o) { var p = o.split("."); return { c: p[0], desc: p[1] === "desc" }; });
    else if (k === "limit") out.limit = +v;
    else if (k === "offset") out.offset = +v;
    else out.f.push({ c: k, v: v });
  });
  return out;
}
function arrStr(x) { return "{" + (x || []).join(",") + "}"; }
function matches(r, f) {
  return f.every(function (x) {
    var v = r[x.c];
    if (x.v === "is.null") return v === null || v === undefined;
    if (x.v === "not.is.null") return !(v === null || v === undefined);
    if (x.v.indexOf("eq.") === 0) { var w = x.v.slice(3); return Array.isArray(v) ? arrStr(v) === w : String(v) === w; }
    if (x.v.indexOf("lt.") === 0) return String(v) < x.v.slice(3);
    throw new Error("fake db: unknown filter " + x.c + "=" + x.v);
  });
}
function pick(r, sel) {
  if (sel === "*") return JSON.parse(JSON.stringify(r));
  var o = {}; sel.split(",").forEach(function (c) { o[c] = r[c] === undefined ? null : JSON.parse(JSON.stringify(r[c])); }); return o;
}
function query(table, q) {
  if (DB.missing && table.indexOf("vp_coaster_") === 0) { var e = new Error("A database error occurred (x)"); e.status = 502; throw e; }
  var p = parseQ(q), rows = (DB[table] || []).filter(function (r) { return matches(r, p.f); });
  if (p.order.length) rows.sort(function (a, b) {
    for (var i = 0; i < p.order.length; i++) { var o = p.order[i], x = a[o.c], y = b[o.c]; if (x === y) continue; var c = x < y ? -1 : 1; return o.desc ? -c : c; }
    return 0;
  });
  rows = rows.slice(p.offset);
  if (p.limit != null) rows = rows.slice(0, p.limit);
  return { p: p, rows: rows };
}
function sbGet(env, table, q) { calls.push("GET " + table + "?" + q); return Promise.resolve().then(function () { var r = query(table, q); return r.rows.map(function (x) { return pick(x, r.p.select); }); }); }
function sbGetAll(env, table, q) {
  calls.push("GETALL " + table + "?" + q);
  return Promise.resolve().then(function () {
    if (!/order=/.test(q)) throw new Error("sbGetAll without an order");
    var out = [], off = 0;
    for (;;) { var r = query(table, q + "&offset=" + off + "&limit=3"); if (!r.rows.length) break; out = out.concat(r.rows.map(function (x) { return pick(x, r.p.select); })); off += 3; }
    return out;
  });
}
function httpErr(s, m) { var e = new Error(m); e.status = s; return e; }
function sbInsert(env, table, obj, ret) {
  calls.push("INSERT " + table);
  return Promise.resolve().then(function () {
    if (DB.missing && table.indexOf("vp_coaster_") === 0) throw httpErr(502, "A database error occurred (x)");
    var t = DB[table] = DB[table] || [];
    var row = JSON.parse(JSON.stringify(obj));
    if (!row.id) row.id = nextId();
    if (table === "vp_coaster_plays") {
      if (DB.forceCodeClash && DB.forceCodeClash-- > 0) throw httpErr(409, "That was already starting. Please try again.");
      if (t.some(function (r) { return r.code === row.code; })) throw httpErr(409, "That was already starting. Please try again.");
      row.answers = row.answers || []; row.points = row.points || 0; row.correct = row.correct || 0; row.ms_total = row.ms_total || 0; row.finished_at = row.finished_at || null;
    }
    if (table === "vp_coaster_venues") {
      if (row.kind === "lead" && t.some(function (r) { return r.kind === "lead" && !r.venue_id && r.name_key === row.name_key; })) throw httpErr(409, "dup");
      row.venue_id = row.venue_id || null;
    }
    t.push(row);
    return ret ? [JSON.parse(JSON.stringify(row))] : null;
  });
}
function sbPatchReturning(env, table, filter, obj) {
  calls.push("PATCH " + table + "?" + filter);
  return Promise.resolve().then(function () {
    var r = query(table, filter), out = [];
    r.rows.forEach(function (row) { Object.keys(obj).forEach(function (k) { row[k] = JSON.parse(JSON.stringify(obj[k])); }); out.push(JSON.parse(JSON.stringify(row))); });
    return out;
  });
}
function sbDelete(env, table, filter) {
  calls.push("DELETE " + table + "?" + filter);
  return Promise.resolve().then(function () {
    if (DB.missing && table.indexOf("vp_coaster_") === 0) throw httpErr(502, "x");
    var p = parseQ(filter); DB[table] = (DB[table] || []).filter(function (r) { return !matches(r, p.f); });
  });
}
function abuseIpHash() { return Promise.resolve("iphash"); }
function rateLimit(env, key, max, win) { calls.push("rl:" + key + ":" + max + ":" + win); return Promise.resolve({ ok: !limited }); }
function enc(s) { return encodeURIComponent(String(s)); }
function json(obj, status) { return { body: obj, status: status || 200 }; }
var tokN = 0, codeN = 0;
function randomTokenHex() { tokN++; return ("secret" + tokN + "xxxxxxxxxxxxxxxxxxxxxxxxxx").slice(0, 32); }
function genCode() { codeN++; return ("CODE" + "ACDEFGHJKMNPQRSTUVWXYZ2345679".charAt(codeN % 29) + "ACDEFGHJKMNPQRSTUVWXYZ2345679".charAt(Math.floor(codeN / 29) % 29)).slice(0, 6); }
function sha256Hex(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; var x = h.toString(16); while (x.length < 64) x = x + x; return Promise.resolve(x.slice(0, 64)); }
function readJsonOf(req) { return Promise.resolve(req.body || {}); }
function fakeFetch(u) {
  fetched.push(u);
  if (u === "https://venueplay.com.au/data/live-here-now.json") return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(BANKFILE)); } });
  return Promise.resolve({ ok: false });
}
function MiniURL(u) {
  var m = /^https?:\/\/[^\/?#]+([^?#]*)(\?[^#]*)?/.exec(u);
  this.pathname = (m && m[1]) || "/";
  var q = (m && m[2]) ? m[2].slice(1) : "", map = {};
  q.split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); map[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
  this.searchParams = { get: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; } };
}
var RealDate = Date;
function FixedDate(x) { if (!(this instanceof FixedDate)) return new RealDate(NOW).toString(); return arguments.length ? new RealDate(x) : new RealDate(NOW); }
FixedDate.now = function () { return NOW; }; FixedDate.UTC = RealDate.UTC; FixedDate.parse = RealDate.parse; FixedDate.prototype = RealDate.prototype;

var SRC = SEARCH + "\n" + lift("triviaAnswerPoints") + lift("cleanName") + lift("praffleParts") + lift("praffleTz") +
  lift("assertUuid") + (uu ? uu[0] : "") + "\n" + BLOCK +
  "\n;return { search: coasterSearch, venues: handleCoasterVenues, lead: handleCoasterLead, start: handleCoasterStart, answer: handleCoasterAnswer, board: handleCoasterBoardRoute, sweep: sweepCoasterPlays, night: coasterNight, first: coasterFirstName, key: coasterNameKey, points: triviaAnswerPoints, reset: function () { _coasterRows = null; _coasterBank = null; } };";
var W = new Function("sbGet", "sbGetAll", "sbInsert", "sbPatchReturning", "sbDelete", "abuseIpHash", "rateLimit", "enc", "URL", "fetch", "Date",
  "randomTokenHex", "genCode", "sha256Hex", "readJson", "httpError", SRC)(
  sbGet, sbGetAll, sbInsert, sbPatchReturning, sbDelete, abuseIpHash, rateLimit, enc, MiniURL, fakeFetch, FixedDate,
  randomTokenHex, genCode, sha256Hex, readJsonOf, httpErr);

var V_MINI = "11111111-1111-4111-8111-111111111111", V_PERTH = "22222222-2222-4222-8222-222222222222", V_GONE = "33333333-3333-4333-8333-333333333333";
var C_TUGUN = "44444444-4444-4444-8444-444444444444", C_SWITCHED = "55555555-5555-4555-8555-555555555555", L_OLD = "66666666-6666-4666-8666-666666666666";
function fresh() {
  DB = {
    vp_venues: [
      { id: V_MINI, slug: "the-mini-bar", name: "The Mini Bar", postcode: "2485", au_state: "NSW", status: "active", timezone: "Australia/Sydney", email: "x@y", join_code: "AAAAAA" },
      { id: V_PERTH, slug: "the-swan", name: "The Swan Hotel", postcode: "6000", au_state: "WA", status: "active", timezone: "Australia/Perth" },
      { id: V_GONE, slug: "the-gone", name: "The Gone Hotel", postcode: "4000", au_state: "QLD", status: "cancelled", timezone: "Australia/Brisbane" },
      { id: "77777777-7777-4777-8777-777777777771", name: "Royal Hotel", postcode: "2000", au_state: "NSW", status: "active" },
      { id: "77777777-7777-4777-8777-777777777772", name: "Royal Hotel", postcode: "3000", au_state: "VIC", status: "active" },
      { id: "77777777-7777-4777-8777-777777777773", name: "Royal Hotel", postcode: "4000", au_state: "QLD", status: "active" },
      { id: "77777777-7777-4777-8777-777777777774", name: "Royal Hotel", postcode: "5000", au_state: "SA", status: "active" },
      { id: "77777777-7777-4777-8777-777777777775", name: "Royal Hotel", postcode: "6000", au_state: "WA", status: "active" },
      { id: "77777777-7777-4777-8777-777777777776", name: "Royal Hotel", postcode: "7000", au_state: "TAS", status: "active" }
    ],
    vp_venue_screen: [{ venue_id: V_MINI, slug: "the-mini-bar", logo_url: "https://x.supabase.co/storage/v1/object/public/venue-logos/mini.png" }],
    vp_coaster_venues: [
      { id: C_TUGUN, kind: "coaster", name: "Tugun Tavern", name_key: "tugun tavern", suburb: "Tugun", postcode: "4224", au_state: "QLD", timezone: "Australia/Brisbane", logo_url: "https://x.supabase.co/storage/v1/object/public/venue-logos/coaster/t.png", venue_id: null },
      { id: C_SWITCHED, kind: "coaster", name: "Switched Arms", name_key: "switched arms", suburb: "Burleigh", postcode: "4220", au_state: "QLD", timezone: "Australia/Brisbane", venue_id: V_MINI },
      { id: L_OLD, kind: "lead", name: "Leady Larry's", name_key: "leady larrys", venue_id: null }
    ],
    vp_coaster_plays: []
  };
  calls = []; limited = false; fetched = []; W.reset();
}
function get(fn, qs) { return fn({ url: "https://game.venueplay.com.au/coaster/x" + qs, headers: { get: function () { return null; } } }, {}, json); }
function post(fn, body) { return fn({ url: "https://game.venueplay.com.au/coaster/x", body: body, headers: { get: function () { return null; } } }, {}, json); }
function five(n) { var o = []; for (var i = 0; i < 5; i++) o.push(BANK[(n || 0) + i][0]); return o; }
function rightOf(id) { for (var i = 0; i < BANK.length; i++) if (BANK[i][0] === id) return BANK[i][3]; return -1; }
/* Brisbane Fri 6 Nov 2026, 8:30pm = 10:30 UTC. */
var FRI_830PM = RealDate.UTC(2026, 10, 6, 10, 30);

var steps = [];
function step(f) { steps.push(f); }

step(function () {
  print("\nTHE SEARCH: THREE LETTERS, ONLY WHAT IS IN VENUEPLAY");
  fresh(); NOW = FRI_830PM;
  return get(W.venues, "?q=min").then(function (r) {
    var m = r.body.matches;
    pass("'min' finds The Mini Bar, a venueplay venue, as its board 'v:<id>'", r.status === 200 && m.length === 1 && m[0].name === "The Mini Bar" && m[0].place === "v:" + V_MINI, r.body);
    pass("only the place, name, suburb, postcode, state and whether it was typed in full come back (no slug, email, code or status)",
      Object.keys(m[0]).sort().join(",") === "exact,name,place,postcode,state,suburb", Object.keys(m[0]));
    pass("the database is asked for ACTIVE venueplay venues, paged and ordered", calls.some(function (c) { return /^GETALL vp_venues\?status=eq\.active.*order=/.test(c); }), calls);
    pass("and for coaster venues not yet switched to a prospect", calls.some(function (c) { return /^GETALL vp_coaster_venues\?kind=eq\.coaster&venue_id=is\.null.*order=/.test(c); }), calls);
    pass("and the per-network limit is counted", calls.some(function (c) { return /^rl:coaster:find:iphash:30:60$/.test(c); }), calls);
    return get(W.venues, "?q=tug");
  }).then(function (r) {
    var m = r.body.matches;
    pass("'tug' finds the coaster venue Tugun Tavern, with its suburb and postcode, as 'c:<id>'",
      m.length === 1 && m[0].place === "c:" + C_TUGUN && m[0].suburb === "Tugun" && m[0].postcode === "4224", m);
    return get(W.venues, "?q=lea");
  }).then(function (r) {
    pass("a pub another player typed in (a lead) is never offered to anyone else", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=switched");
  }).then(function (r) {
    pass("a coaster venue switched to a normal prospect is not listed twice (its venue is)", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=gone");
  }).then(function (r) {
    pass("a cancelled venue is never offered", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=royal");
  }).then(function (r) {
    pass("at most five answers, then 'more', never a count", r.body.matches.length === 5 && r.body.more === true && !("count" in r.body), r.body);
    calls = [];
    return get(W.venues, "?q=mi");
  }).then(function (r) {
    pass("two letters asks for three and asks the database nothing", r.body.matches.length === 0 && /three letters/.test(r.body.why || "") && !calls.some(function (c) { return /^GET/.test(c); }), [r.body, calls]);
    pass("'the' alone is not three letters", W.search([{ place: "v:x", name: "The Mini Bar" }], "the ").matches.length === 0);
    pass("words in another order and no spaces still find it ('bar mini', 'minibar')",
      W.search([{ place: "v:x", name: "The Mini Bar" }], "bar mini").matches.length === 1 && W.search([{ place: "v:x", name: "The Mini Bar" }], "minibar").matches.length === 1);
    fresh(); limited = true;
    return get(W.venues, "?q=mini");
  }).then(function (r) {
    pass("over the limit: 429, and the database is not asked", r.status === 429 && !calls.some(function (c) { return /^GET/.test(c); }), [r, calls]);
    fresh(); DB.missing = true;
    return get(W.venues, "?q=mini");
  }).then(function (r) {
    pass("before migration 153 the search still lists venueplay venues", r.status === 200 && r.body.matches.length === 1 && r.body.matches[0].name === "The Mini Bar", r.body);
  });
});

step(function () {
  print("\nNOT LISTED? TYPE IT: A LEAD FOR DEAN");
  fresh(); NOW = FRI_830PM;
  return post(W.lead, { name: "The Drunken Duck & Co" }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "The Drunken Duck & Co"; })[0];
    pass("a typed pub is kept as a lead (kind 'lead') and the player gets its board", r.status === 200 && !!row && row.kind === "lead" && r.body.place === "c:" + row.id, [r.body, row]);
    pass("its key drops 'the', case, '&' and punctuation", row && row.name_key === "drunken duck and co", row && row.name_key);
    pass("the key is the same words HQ keeps (coasterNameKey)", W.key("The Drunken Duck & Co") === "drunken duck and co");
    pass("the lead limit is counted per network over 10 minutes", calls.some(function (c) { return /^rl:coaster:lead:iphash:6:600$/.test(c); }), calls);
    return post(W.lead, { name: "drunken duck and co" });
  }).then(function (r) {
    var rows = DB.vp_coaster_venues.filter(function (x) { return x.kind === "lead" && x.name_key === "drunken duck and co"; });
    pass("a mate typing the same pub another way lands on the SAME board (one lead row)", rows.length === 1 && r.body.place === "c:" + rows[0].id, [rows.length, r.body]);
    return post(W.lead, { name: "The Mini Bar" });
  }).then(function (r) {
    pass("typing a listed pub in full gives that pub's board, not a lead", r.body.place === "v:" + V_MINI && r.body.listed === true && !DB.vp_coaster_venues.some(function (x) { return x.name === "The Mini Bar"; }), r.body);
    return post(W.lead, { name: "ab" });
  }).then(function (r) {
    pass("fewer than three letters is refused", r.status === 400, r);
    return post(W.lead, { name: "The Big Shit Pub" });
  }).then(function (r) {
    pass("a rude name is refused and nothing is kept", r.status === 400 && !DB.vp_coaster_venues.some(function (x) { return /shit/i.test(x.name); }), r);
    fresh(); limited = true;
    return post(W.lead, { name: "Some Pub" });
  }).then(function (r) {
    pass("over the limit: 429 and nothing kept", r.status === 429 && DB.vp_coaster_venues.length === 3, r);
    fresh(); DB.missing = true;
    return post(W.lead, { name: "Some Pub" });
  }).then(function (r) {
    pass("before migration 153: 503 { off: true }, so the page plays the old way", r.status === 503 && r.body.off === true, r);
  });
});

var P1;
step(function () {
  print("\nSTARTING A ROUND: A FIRST NAME, NOTHING ELSE");
  fresh(); NOW = FRI_830PM;
  return post(W.start, { name: "  sam   smith-jones 0412 345 678", place: "v:" + V_MINI, qids: five(0) }).then(function (r) {
    P1 = r.body;
    var row = DB.vp_coaster_plays[0];
    pass("a round starts and answers its id, a secret, a challenge code and the venue's name and logo",
      r.status === 200 && !!P1.play && !!P1.token && /^[A-Z0-9]{6}$/.test(P1.code) && P1.venue.name === "The Mini Bar" && /mini\.png$/.test(P1.venue.logo_url), r.body);
    pass("only the FIRST word of the name is kept, capitalised: 'Sam' (no surname, no number)", row.first_name === "Sam" && P1.name === "Sam", row.first_name);
    pass("the row holds nothing about the person but that first name",
      Object.keys(row).sort().join(",") === "answers,asked_at,board,code,correct,finished_at,first_name,from_code,id,ms_total,night,points,qids,started_at,token_hash,week", Object.keys(row).sort());
    pass("the secret is kept only as its hash", row.token_hash !== P1.token && row.token_hash.length === 64 && JSON.stringify(row).indexOf(P1.token) < 0);
    pass("tonight is the venue's own night (8:30pm Friday in NSW is Friday 6 Nov), this week is Monday 2 Nov", row.night === "2026-11-06" && row.week === "2026-11-02", [row.night, row.week]);
    pass("the round is limited per network", calls.some(function (c) { return /^rl:coaster:start:iphash:40:600$/.test(c); }), calls);
    pass("the questions are checked against the page's own file", fetched[0] === "https://venueplay.com.au/data/live-here-now.json", fetched);
    return post(W.start, { name: "", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("no first name: refused", r.status === 400 && /first name/.test(r.body.error), r);
    return post(W.start, { name: "Fuckface", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("a rude name goes on the board as 'Player', as on the TV", r.status === 200 && DB.vp_coaster_plays[1].first_name === "Player", DB.vp_coaster_plays[1] && DB.vp_coaster_plays[1].first_name);
    return post(W.start, { name: "Jo", place: "v:" + V_MINI, qids: ["nope", "x", "y", "z", "w"] });
  }).then(function (r) {
    pass("questions that are not on the coaster are refused", r.status === 400, r);
    var dup = five(0); dup[4] = dup[0];
    return post(W.start, { name: "Jo", place: "v:" + V_MINI, qids: dup });
  }).then(function (r) {
    pass("the same question twice is refused", r.status === 400, r);
    return post(W.start, { name: "Jo", place: "v:" + V_MINI, qids: five(0).slice(0, 4) });
  }).then(function (r) {
    pass("four questions is refused", r.status === 400, r);
    return post(W.start, { name: "Jo", place: "v:" + V_GONE, qids: five(0) });
  }).then(function (r) {
    pass("a cancelled venue has no board", r.status === 404, r);
    return post(W.start, { name: "Jo", place: "c:" + C_SWITCHED, qids: five(0) });
  }).then(function (r) {
    pass("a coaster venue since switched to a prospect plays on that venue's board", r.status === 200 && r.body.place === "v:" + V_MINI, r.body);
    return post(W.start, { name: "Jo", place: "c:" + C_TUGUN, qids: five(0) });
  }).then(function (r) {
    pass("a coaster venue has its own board, with its logo and suburb", r.status === 200 && r.body.place === "c:" + C_TUGUN && r.body.venue.suburb === "Tugun" && /t\.png$/.test(r.body.venue.logo_url), r.body);
    return post(W.start, { name: "Jo", place: "c:" + L_OLD, qids: five(0) });
  }).then(function (r) {
    pass("a typed-in pub has a board too, and shows no logo", r.status === 200 && r.body.place === "c:" + L_OLD && r.body.venue.logo_url === "", r.body);
    return post(W.start, { name: "Mia", code: P1.code, place: "c:" + C_TUGUN, qids: five(10) });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[DB.vp_coaster_plays.length - 1];
    pass("a mate on the challenge link gets the SAME five questions and the SAME board, whatever the phone sent",
      r.status === 200 && r.body.place === "v:" + V_MINI && JSON.stringify(r.body.qids) === JSON.stringify(five(0)) && row.from_code === P1.code, r.body);
    pass("and a challenge code of their own to pass on", r.body.code !== P1.code);
    return post(W.start, { name: "Mia", code: "ZZZZZZ" });
  }).then(function (r) {
    pass("a challenge code that does not exist says so", r.status === 404 && r.body.gone === true, r);
    DB.forceCodeClash = 2;
    return post(W.start, { name: "Kai", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("a clashing challenge code is drawn again, not a failed round", r.status === 200, r);
    fresh(); limited = true;
    return post(W.start, { name: "Kai", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("over the limit: 429 and no round", r.status === 429 && DB.vp_coaster_plays.length === 0, r);
    fresh(); DB.missing = true;
    return post(W.start, { name: "Kai", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("before migration 153: 503 { off: true }", r.status === 503 && r.body.off === true, r);
  });
});

step(function () {
  print("\nTHE VENUE'S NIGHT AND WEEK");
  var a = W.night("Australia/Brisbane", RealDate.UTC(2026, 10, 6, 18, 59));   // Sat 4:59am Brisbane
  var b = W.night("Australia/Brisbane", RealDate.UTC(2026, 10, 6, 19, 1));    // Sat 5:01am Brisbane
  pass("4:59am Saturday is still Friday night; 5:01am is Saturday", a.night === "2026-11-06" && b.night === "2026-11-07", [a, b]);
  var c = W.night("Australia/Perth", RealDate.UTC(2026, 10, 6, 20, 30));      // Sat 4:30am Perth, 6:30am Brisbane
  pass("in Perth it is Perth's clock: 4:30am Saturday there is still Friday night", c.night === "2026-11-06", c);
  var d = W.night("Australia/Sydney", RealDate.UTC(2026, 10, 8, 17, 0));      // Mon 4am Sydney (UTC+11)
  pass("Sunday night running past midnight stays in last week (week of Mon 2 Nov)", d.night === "2026-11-08" && d.week === "2026-11-02", d);
  var e = W.night("Australia/Sydney", RealDate.UTC(2026, 10, 8, 19, 0));      // Mon 6am Sydney
  pass("Monday after 5am starts the new week (Mon 9 Nov)", e.week === "2026-11-09" && e.night === "2026-11-09", e);
  pass("the two Brisbane fixtures really are a minute either side of 5am", RealDate.UTC(2026, 10, 6, 19, 1) - RealDate.UTC(2026, 10, 6, 18, 59) === 120000);
  return Promise.resolve();
});

step(function () {
  print("\nANSWERING: TIMED AND SCORED HERE, BY THE TRIVIA NIGHT'S OWN RULE");
  fresh(); NOW = FRI_830PM;
  var q = five(0), R, start0;
  return post(W.start, { name: "Sam", place: "v:" + V_MINI, qids: q }).then(function (r) {
    R = r.body; start0 = NOW;
    NOW = start0 + 2000;   // two seconds in: 18 of 20 seconds left
    return post(W.answer, { play: R.play, token: R.token, i: 0, a: rightOf(q[0]) });
  }).then(function (r) {
    var want = W.points(true, 100, 20, true, 1, start0 + 20000, start0 + 2000);
    pass("a right answer two seconds in scores 145, exactly what triviaAnswerPoints pays (base 100 + speed)", r.status === 200 && r.body.correct === true && r.body.points === 145 && want === 145, r.body);
    pass("the right answer's letter comes back for the reveal", r.body.right === rightOf(q[0]));
    pass("the answer is limited per network", calls.some(function (c) { return /^rl:coaster:answer:iphash:250:600$/.test(c); }));
    return post(W.answer, { play: R.play, token: R.token, i: 0, a: rightOf(q[0]) });
  }).then(function (r) {
    pass("the same question again (a double tap or a replay) is refused and scored once", r.status === 409 && DB.vp_coaster_plays[0].points === 145, [r, DB.vp_coaster_plays[0].points]);
    return post(W.answer, { play: R.play, token: "not-the-secret", i: 1, a: 0 });
  }).then(function (r) {
    pass("the wrong secret cannot answer someone's round", r.status === 403, r);
    return post(W.answer, { play: R.play, token: R.token, i: 3, a: 0 });
  }).then(function (r) {
    pass("questions answer in order: question 4 before 2 is refused", r.status === 409, r);
    /* Question 2 went up 1.3 s after the answer (the reveal pause), so 11.3 s later is 10 s of thinking. */
    NOW = NOW + 1300 + 10000;
    return post(W.answer, { play: R.play, token: R.token, i: 1, a: rightOf(q[1]) });
  }).then(function (r) {
    pass("the next question's clock starts after the 1.3 second reveal: 10 seconds of thinking is 125", r.body.points === 125, r.body);
    NOW = NOW + 1300 + 5000;
    return post(W.answer, { play: R.play, token: R.token, i: 2, a: (rightOf(q[2]) + 1) % 4 });
  }).then(function (r) {
    pass("a wrong answer scores nothing, however fast", r.body.correct === false && r.body.points === 0, r.body);
    NOW = NOW + 1300 + 60000;
    return post(W.answer, { play: R.play, token: R.token, i: 3, a: rightOf(q[3]) });
  }).then(function (r) {
    pass("a slow right answer (a minute: there is no countdown) still scores the base 100", r.body.points === 100, r.body);
    pass("the running total comes back", r.body.total === 145 + 125 + 0 + 100, r.body.total);
    NOW = NOW + 1300 + 4000;
    return post(W.answer, { play: R.play, token: R.token, i: 4, a: rightOf(q[4]) });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[0];
    pass("the fifth answer finishes the round: 4 of 5, 510 points", r.body.done === true && r.body.score.correct === 4 && r.body.score.points === 510 && !!row.finished_at, r.body);
    pass("the total time is the thinking time only (2 + 10 + 5 + 60 + 4 = 81 s)", row.ms_total === 81000 && r.body.score.secs === 81, row.ms_total);
    pass("the round's place on tonight's board comes back with it: 1st", r.body.board && r.body.board.rank === 1 && r.body.board.period === "tonight", r.body.board);
    return post(W.answer, { play: R.play, token: R.token, i: 4, a: 0 });
  }).then(function (r) {
    pass("a finished round takes no more answers", r.status === 409, r);
    return post(W.answer, { play: R.play, token: R.token, i: 5, a: 0 });
  }).then(function (r) {
    pass("a sixth question is refused", r.status === 400, r);
    return post(W.answer, { play: "not-a-uuid", token: R.token, i: 0, a: 0 }).then(function (x) { return x; }, function (e) { return { status: e.status }; });
  }).then(function (r) {
    pass("a round id that is not an id is refused before the database", r.status === 400, r);
  });
});

function playRound(name, place, qidsStart, rights, gapMs) {
  var R, q = five(qidsStart || 0);
  return post(W.start, { name: name, place: place, qids: q }).then(function (r) {
    R = r.body; var i = 0;
    function next() {
      if (i >= 5) return Promise.resolve(R);
      NOW += (i ? 1300 : 0) + gapMs;
      var a = rights[i] ? rightOf(q[i]) : (rightOf(q[i]) + 1) % 4; i++;
      return post(W.answer, { play: R.play, token: R.token, i: i - 1, a: a }).then(function (x) { R.last = x.body; return next(); });
    }
    return next();
  });
}

step(function () {
  print("\nTHE BOARD: TONIGHT AND THIS WEEK, FIRST NAMES ONLY, TIES TO THE FASTER");
  fresh(); NOW = FRI_830PM;
  var all = [true, true, true, true, true], A, B, C;
  return playRound("Ava", "v:" + V_MINI, 0, all, 20000).then(function (r) { A = r;   // slow: every answer on 20 s, 500
    return playRound("Ben", "v:" + V_MINI, 0, all, 20000); }).then(function (r) { B = r;   // the same 500, but...
    return playRound("Cal", "v:" + V_MINI, 0, [true, true, true, true, false], 1000); }).then(function (r) { C = r;
    return playRound("Dee", "c:" + C_TUGUN, 0, all, 1000);
  }).then(function () {
    /* Ben's rounds took the same time as Ava's; make Ben faster by hand to test the tie-break on real rows. */
    DB.vp_coaster_plays.filter(function (x) { return x.first_name === "Ben"; })[0].ms_total = 50000;
    return get(W.board, "?place=v:" + V_MINI + "&period=tonight&play=" + B.play);
  }).then(function (r) {
    var rows = r.body.rows;
    pass("tonight's board lists this venue's rounds only (not the coaster venue's)", r.status === 200 && rows.length === 3 && rows.every(function (x) { return x.name !== "Dee"; }), rows);
    pass("points first: Cal's fast 4 of 5 (592) is above two slow perfect rounds (500)", rows[0].name === "Cal" && rows[0].points > rows[1].points, rows);
    pass("equal points go to the faster total time: Ben (50 s) above Ava (100 s)", rows[1].name === "Ben" && rows[2].name === "Ava" && rows[1].points === rows[2].points, rows);
    pass("each row is a place, a first name, points and how many right: nothing else",
      Object.keys(rows[0]).sort().join(",") === "correct,name,place,points,you", Object.keys(rows[0]));
    pass("'you' marks only the round whose id was given", rows[1].you === true && !rows[0].you && !rows[2].you, rows);
    pass("and the player's own place comes back: Ben is 2nd", r.body.rank === 2, r.body.rank);
    pass("the venue's name comes with it, for 'Tonight at The Mini Bar'", r.body.venue && r.body.venue.name === "The Mini Bar", r.body.venue);
    pass("the board read is limited per network", calls.some(function (c) { return /^rl:coaster:board:iphash:120:600$/.test(c); }));
    var plays = DB.vp_coaster_plays.filter(function (x) { return x.first_name === "Ava"; })[0];
    plays.night = "2026-11-05";   // Ava played last night, same week
    return get(W.board, "?place=v:" + V_MINI + "&period=tonight");
  }).then(function (r) {
    pass("last night's round is not on tonight's board", r.body.rows.length === 2 && r.body.rows.every(function (x) { return x.name !== "Ava"; }), r.body.rows);
    pass("without a round id nobody is 'you'", r.body.rows.every(function (x) { return x.you === false; }));
    return get(W.board, "?place=v:" + V_MINI + "&period=week");
  }).then(function (r) {
    pass("but it is on this week's board", r.body.period === "week" && r.body.rows.length === 3 && r.body.rows.some(function (x) { return x.name === "Ava"; }), r.body);
    var n = 0; function more() { if (n >= 11) return Promise.resolve(); n++; return playRound("P" + n, "v:" + V_MINI, 0, [true, false, false, false, false], 1000).then(more); }
    return more();
  }).then(function () {
    return get(W.board, "?place=v:" + V_MINI + "&period=tonight");
  }).then(function (r) {
    pass("the board shows the top ten, and says how many played", r.body.rows.length === 10 && r.body.players === 13, [r.body.rows.length, r.body.players]);
    return get(W.board, "?place=v:" + V_GONE + "&period=tonight");
  }).then(function (r) {
    pass("no board for a place that is not on venueplay", r.status === 404, r);
  });
});

step(function () {
  print("\nKEPT 35 DAYS, THEN GONE");
  fresh(); NOW = FRI_830PM;
  DB.vp_coaster_plays = [
    { id: "a", board: "v:" + V_MINI, first_name: "Old", started_at: new RealDate(NOW - 36 * 86400000).toISOString() },
    { id: "b", board: "v:" + V_MINI, first_name: "New", started_at: new RealDate(NOW - 34 * 86400000).toISOString() }
  ];
  return W.sweep({}, NOW).then(function (r) {
    pass("the nightly sweep deletes rounds older than 35 days and keeps the rest", r.ok === true && DB.vp_coaster_plays.length === 1 && DB.vp_coaster_plays[0].first_name === "New", DB.vp_coaster_plays);
    DB.missing = true;
    return W.sweep({}, NOW);
  }).then(function (r) {
    pass("before migration 153 the sweep says so and throws nothing", !!r.error, r);
    var sched = GAME.slice(GAME.indexOf("async scheduled(event, env, ctx) {"), GAME.indexOf("async scheduled(event, env, ctx) {") + 4000);
    pass("the Worker's nightly trigger runs the sweep", /ctx\.waitUntil\(sweepCoasterPlays\(env\)/.test(sched));
  });
});

step(function () {
  print("\nONE COPY OF EACH RULE, AND THE ROUTES ARE WIRED");
  pass("the coaster scores with triviaAnswerPoints and never restates it", /triviaAnswerPoints\(correct, COASTER_BASE, COASTER_SECS, true, 1,/.test(BLOCK) && BLOCK.indexOf("0.5") < 0);
  pass("the coaster search matches with the TV app's venueSearchScore", /venueSearchScore\(q, r\.name\)/.test(BLOCK) && BLOCK.indexOf("startsWith") < 0);
  pass("names go through the TV's cleanName", /cleanName\(/.test(BLOCK));
  var router = GAME.slice(GAME.indexOf("if (method === 'GET' && path === '/health')"), GAME.indexOf("return json({ error: 'not found' }, 404);"));
  ["if (method === 'GET'  && path === '/coaster/venues')     return await handleCoasterVenues(request, env, json);",
   "if (method === 'POST' && path === '/coaster/lead')       return await handleCoasterLead(request, env, json);",
   "if (method === 'POST' && path === '/coaster/start')      return await handleCoasterStart(request, env, json);",
   "if (method === 'POST' && path === '/coaster/answer')     return await handleCoasterAnswer(request, env, json);",
   "if (method === 'GET'  && path === '/coaster/board')      return await handleCoasterBoardRoute(request, env, json);"].forEach(function (l) {
    pass("the router sends " + l.split("'")[3] + " to its handler", router.indexOf(l) >= 0);
  });
  pass("nothing in the coaster block asks for an email, a mobile or a surname", !/email|mobile|phone|surname|last_name/i.test(BLOCK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
  return Promise.resolve();
});

var chain = Promise.resolve();
steps.forEach(function (s) { chain = chain.then(s); });
var finished = false;
chain.then(function () { finished = true; }, function (e) { pass("the run finished without throwing", false, String(e && e.stack || e)); finished = true; });
drainMicrotasks();
if (!finished) pass("the run finished", false);
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
