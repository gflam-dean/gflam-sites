/* THE COASTER ROUND'S WORKER ROUTES, RUN (/live-here-now v2, Dean 4 Nov 2026; migration 153).

   Dean's spec (reports/live-here-now-v2/DEAN-NOTES.md, later items override earlier):
     - first name at the start, so the end is personalised; first names only, never a surname or
       a contact detail on a board
     - "What venue are you at?": type three letters of the pub's name; the search lists ONLY what
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
    if (x.v.indexOf("gte.") === 0) return String(v) >= x.v.slice(4);
    if (x.v.indexOf("in.(") === 0) return x.v.slice(4, -1).split(",").indexOf(String(v)) >= 0;
    if (x.v.indexOf("ilike.") === 0) {   /* PostgREST ilike: * is any run of letters, case ignored */
      var pat = x.v.slice(6).toLowerCase().split("*").map(function (t) { return t.replace(/[.?+^$()[\]{}|\\]/g, "\\$&"); }).join(".*");
      return v != null && new RegExp("^" + pat + "$").test(String(v).toLowerCase());
    }
    throw new Error("fake db: unknown filter " + x.c + "=" + x.v);
  });
}
function pick(r, sel) {
  if (sel === "*") return JSON.parse(JSON.stringify(r));
  var o = {}; sel.split(",").forEach(function (c) { o[c] = r[c] === undefined ? null : JSON.parse(JSON.stringify(r[c])); }); return o;
}
function query(table, q) {
  if (DB.missing && table.indexOf("vp_coaster_") === 0) { var e = new Error("A database error occurred (x)"); e.status = 502; throw e; }
  if (DB.noLeadCols && table === "vp_coaster_venues" && /lead_status|board_until/.test(q)) { var e2 = new Error("A database error occurred (x)"); e2.status = 502; throw e2; }
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
    if (DB.noLeadCols && table === "vp_coaster_venues" && "lead_status" in obj) throw httpErr(502, "A database error occurred (x)");
    if (DB.no198 && table === "vp_coaster_contacts") throw httpErr(502, "A database error occurred (x)");
    if (table === "vp_coaster_contacts" && (DB[table] || []).some(function (r) { return r.board === obj.board && r.mobile === obj.mobile; })) throw httpErr(409, "dup");
    var t = DB[table] = DB[table] || [];
    var row = JSON.parse(JSON.stringify(obj));
    if (!row.id) row.id = nextId();
    if (table === "vp_coaster_plays") {
      if (DB.forceCodeClash && DB.forceCodeClash-- > 0) throw httpErr(409, "That was already starting. Please try again.");
      if (t.some(function (r) { return r.code === row.code; })) throw httpErr(409, "That was already starting. Please try again.");
      row.answers = row.answers || []; row.points = row.points || 0; row.correct = row.correct || 0; row.ms_total = row.ms_total || 0; row.finished_at = row.finished_at || null;
    }
    if (table === "vp_coaster_venues") {
      if (row.kind === "lead" && t.some(function (r) { return r.kind === "lead" && !r.venue_id && r.name_key === row.name_key && String(r.suburb || "").toLowerCase() === String(row.suburb || "").toLowerCase() && r.au_state === row.au_state; })) throw httpErr(409, "dup");
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
function sbInsertAny(env, table, obj, ret) {
  if (table === "vp_captures" && DB.no174 && "consent_version" in obj) { calls.push("INSERT " + table + " (refused: no column)"); return Promise.reject(httpErr(502, "A database error occurred (x)")); }
  return sbInsert(env, table, obj, ret);
}
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
  /* a venue's own website: it says the venue's name; another site says something else; one is down */
  if (u === "https://realpub.com.au") return Promise.resolve({ ok: true, text: function () { return Promise.resolve("<title>The Wandering Dingo Tavern, Fitzroy</title>"); } });
  /* redirects: to the venue's own page (fine), to the machine itself, to plain http, an endless chain */
  var HOP = { "https://short.com.au/a": "https://realpub.com.au", "https://evil.com.au/a": "https://127.0.0.1/admin", "https://evil.com.au/b": "http://realpub.com.au",
    "https://evil.com.au/c": "//169.254.169.254/latest", "https://evil.com.au/d": "https://localhost.localdomain/x", "https://loop.com.au/1": "/2", "https://loop.com.au/2": "/3",
    "https://loop.com.au/3": "/4", "https://loop.com.au/4": "/5", "https://loop.com.au/5": "https://realpub.com.au" };
  if (HOP[u]) return Promise.resolve({ ok: false, status: 302, headers: { get: function (k) { return /location/i.test(k) ? HOP[u] : null; } } });
  if (u === "https://shop.com.au") return Promise.resolve({ ok: true, text: function () { return Promise.resolve("<title>Cheap shoes for everyone</title>"); } });
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

function srcOf(block) { return SEARCH + "\n" + lift("triviaAnswerPoints") + lift("cleanName") + lift("praffleParts") + lift("phoneSlides") + lift("praffleTz") +
  lift("assertUuid") + lift("venueCollectCfg") + lift("gatedCapture") + (uu ? uu[0] : "") + "\n" + block +
  "\n;return { search: coasterSearch, venues: handleCoasterVenues, lead: handleCoasterLead, start: handleCoasterStart, answer: handleCoasterAnswer, board: handleCoasterBoardRoute, optin: handleCoasterOptin, ask: handleCoasterAsk, guard: coasterLeadGuard, site: coasterWebsite, search2: coasterSearch, safe: coasterSafeUrl, hop: coasterNextHop, siteNames: coasterWebsiteNames, same: coasterSameVenue, open: coasterLeadBoardOpen, sweep: sweepCoasterPlays, night: coasterNight, first: coasterFirstName, key: coasterNameKey, points: triviaAnswerPoints, mobile: coasterMobile, reset: function () { _coasterRows = null; _coasterBank = null; } };"; }
var SRC = srcOf(BLOCK);
var W = new Function("sbGet", "sbGetAll", "sbInsert", "sbPatchReturning", "sbDelete", "abuseIpHash", "rateLimit", "enc", "URL", "fetch", "Date",
  "randomTokenHex", "genCode", "sha256Hex", "readJson", "httpError", "setTimeout", "clearTimeout", "AbortController", SRC)(
  sbGet, sbGetAll, sbInsertAny, sbPatchReturning, sbDelete, abuseIpHash, rateLimit, enc, MiniURL, fakeFetch, FixedDate,
  randomTokenHex, genCode, sha256Hex, readJsonOf, httpErr, function () { return 0; }, function () {}, function () { this.signal = {}; this.abort = function () {}; });

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
      { id: "77777777-7777-4777-8777-777777777776", name: "Royal Hotel", postcode: "7000", au_state: "TAS", status: "active" },
      /* INBOX 307: venueplay venues whose names have no pub, club or hotel word, and one with an accommodation
         word: every active venueplay venue is in the picker, whatever its name. */
      { id: "88888888-8888-4888-8888-888888888881", name: "The Lunatic", postcode: "4217", au_state: "QLD", status: "active" },
      { id: "88888888-8888-4888-8888-888888888882", name: "Revolver Upstairs", postcode: "3181", au_state: "VIC", status: "active" },
      { id: "88888888-8888-4888-8888-888888888883", name: "Zeta Motel", postcode: "4350", au_state: "QLD", status: "active" }
    ],
    vp_venue_screen: [{ venue_id: V_MINI, slug: "the-mini-bar", slides: [{ image_url: "https://x.supabase.co/storage/v1/object/public/slides/a.png", starts: "2026-11-01", ends: "2026-12-31" }, { image_url: "http://insecure.example/b.png" }, { image_url: "https://x.supabase.co/c.png&#" }, { note: "no picture" }], logo_url: "https://x.supabase.co/storage/v1/object/public/venue-logos/mini.png" }],
    vp_coaster_venues: [
      { id: C_TUGUN, kind: "coaster", name: "Tugun Tavern", name_key: "tugun tavern", suburb: "Tugun", postcode: "4224", au_state: "QLD", timezone: "Australia/Brisbane", logo_url: "https://x.supabase.co/storage/v1/object/public/venue-logos/coaster/t.png", venue_id: null },
      { id: C_SWITCHED, kind: "coaster", name: "Switched Arms", name_key: "switched arms", suburb: "Burleigh", postcode: "4220", au_state: "QLD", timezone: "Australia/Brisbane", venue_id: V_MINI },
      { id: L_OLD, kind: "lead", name: "Leady Larry's", name_key: "leady larrys", venue_id: null }
    ],
    vp_coaster_plays: [],
    /* Our licensed venues list (migration 171). Only HOTEL, PUB, TAVERN, RSL or CLUB names may show. */
    vp_licensed_venues: [
      { id: 101, name: "Royal Hotel", suburb: "Bowral", postcode: "2576", au_state: "NSW" },
      { id: 102, name: "Royal Hotel", suburb: "Mudgee", postcode: "2850", au_state: "NSW" },
      { id: 103, name: "Royal Hotel", suburb: "Ballarat", postcode: "3350", au_state: "VIC" },
      { id: 104, name: "Royal Hotel", suburb: "Sydney", postcode: "2000", au_state: "NSW" },   // the same pub as a venueplay venue
      { id: 105, name: "Royal Cafe", suburb: "Bowral", postcode: "2576", au_state: "NSW" },
      { id: 106, name: "Royal Bowling Greens", suburb: "Perth", postcode: "6000", au_state: "WA" },
      { id: 107, name: "Bodalla Pub", suburb: "Bodalla", postcode: "2545", au_state: "NSW" },
      { id: 108, name: "Elwood RSL", suburb: "Elwood", postcode: "3184", au_state: "VIC" },
      { id: 109, name: "Kalgoorlie Tavern", suburb: "Kalgoorlie", postcode: "6430", au_state: "WA" },
      { id: 110, name: "Grand Clubhouse", suburb: "Darwin", postcode: "0800", au_state: "NT" },
      { id: 111, name: "Glenelg Golf Club", suburb: "Glenelg", postcode: "5045", au_state: "SA" }
    ],
    vp_sessions: [
      { id: "s1", venue_id: "77777777-7777-4777-8777-777777777773", status: "running", created_at: "2026-11-06T09:00:00.000Z" },
      { id: "s2", venue_id: "77777777-7777-4777-8777-777777777774", status: "lobby", created_at: "2026-11-05T09:00:00.000Z" },
      { id: "s3", venue_id: "77777777-7777-4777-8777-777777777775", status: "ended", created_at: "2026-11-06T09:30:00.000Z" }
    ],
    vp_venue_settings: [
      { venue_id: V_MINI, collect_first_name: true, collect_email: true, collect_mobile: false, collect_marketing_optin: true },
      { venue_id: V_PERTH, collect_first_name: true, collect_email: true, collect_mobile: true, collect_marketing_optin: true }
    ],
    vp_coaster_optin_venues: [{ venue_id: V_MINI }],
    vp_captures: []
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
      Object.keys(m[0]).sort().join(",") === "exact,name,on,place,postcode,state,suburb", Object.keys(m[0]));
    pass("...and it is marked ON venueplay (it has a venueplay login)", m[0].on === true, m[0]);
    pass("the database is asked for ACTIVE venueplay venues, paged and ordered", calls.some(function (c) { return /^GETALL vp_venues\?status=eq\.active.*order=/.test(c); }), calls);
    pass("and for coaster venues not yet switched to a prospect", calls.some(function (c) { return /^GETALL vp_coaster_venues\?kind=eq\.coaster&venue_id=is\.null.*order=/.test(c); }), calls);
    pass("and the per-network limit is counted", calls.some(function (c) { return /^rl:coaster:find:iphash:30:60$/.test(c); }), calls);
    return get(W.venues, "?q=tug");
  }).then(function (r) {
    var m = r.body.matches;
    pass("'tug' finds the coaster venue Tugun Tavern, with its suburb and postcode, as 'c:<id>'",
      m.length === 1 && m[0].place === "c:" + C_TUGUN && m[0].suburb === "Tugun" && m[0].postcode === "4224", m);
    pass("...and it is NOT marked on venueplay (a coaster venue has no login)", m.length === 1 && m[0].on === false, m);
    return get(W.venues, "?q=lea");
  }).then(function (r) {
    pass("a pub another player typed in (a lead) is never offered to anyone else", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=switched");
  }).then(function (r) {
    pass("a coaster venue switched to a normal prospect is not listed twice (its venue is)", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=gone");
  }).then(function (r) {
    pass("a cancelled venue is never offered", r.body.matches.length === 0, r.body);
    calls = [];
    return get(W.venues, "?q=royal");
  }).then(function (r) {
    var m = r.body.matches;
    pass("at most eight picks, then 'more', never a count", m.length === 8 && r.body.more === true && !("count" in r.body), r.body);
    pass("venueplay venues come first at the same closeness, then our list", m.slice(0, 6).every(function (x) { return x.on === true; }) && m.slice(6).every(function (x) { return x.on === false; }), m.map(function (x) { return x.place; }));
    pass("our list is read for THIS search only, narrowed by the typed word (ilike), ordered, at most 60 rows",
      calls.some(function (c) { return /^GET vp_licensed_venues\?name=ilike\.\*royal\*&select=id,name,suburb,postcode,au_state&order=name\.asc,id\.asc&limit=60$/.test(c); }), calls);
    pass("a venue on our list shows its suburb and state, never its postcode, as 'l:<id>'",
      m.slice(6).every(function (x) { return /^l:\d+$/.test(x.place) && x.suburb && x.state && x.postcode === ""; }), m.slice(6));
    pass("the same pub on venueplay AND on our list shows once, as on venueplay (Royal Hotel 2000)",
      !m.some(function (x) { return x.place === "l:104"; }) && m.some(function (x) { return x.place === "v:77777777-7777-4777-8777-777777777771"; }), m);
    pass("'game on now' only where a game is open (lobby, running, paused) and opened in the last 10 hours",
      m.filter(function (x) { return x.live; }).map(function (x) { return x.place; }).join() === "v:77777777-7777-4777-8777-777777777773", m.filter(function (x) { return x.live; }));
    pass("...asked in ONE read for the venueplay picks only", calls.filter(function (c) { return /^GET vp_sessions\?venue_id=in\./.test(c) && /status=in\.\(lobby,running,paused\)/.test(c) && /created_at=gte\./.test(c); }).length === 1, calls);
    return get(W.venues, "?q=royal ca");
  }).then(function (r) {
    pass("a name without HOTEL, PUB, TAVERN, RSL or CLUB on our list never shows ('Royal Cafe')", !r.body.matches.some(function (x) { return /cafe/i.test(x.name); }), r.body);
    return get(W.venues, "?q=royal bow");
  }).then(function (r) {
    pass("...nor 'Royal Bowling Greens'", !r.body.matches.some(function (x) { return /bowling/i.test(x.name); }), r.body);
    return get(W.venues, "?q=clubhouse");
  }).then(function (r) {
    pass("the target words are whole words: 'Grand Clubhouse' is not a club", r.body.matches.length === 0, r.body);
    return get(W.venues, "?q=bodalla");
  }).then(function (r) {
    var m = r.body.matches;
    pass("'bodalla' finds Bodalla Pub on our list, not on venueplay", m.length === 1 && m[0].place === "l:107" && m[0].on === false && m[0].suburb === "Bodalla" && m[0].state === "NSW", m);
    return get(W.venues, "?q=elwood");
  }).then(function (r) {
    pass("an RSL is on the list ('Elwood RSL')", r.body.matches.length === 1 && r.body.matches[0].place === "l:108", r.body);
    return get(W.venues, "?q=kalg");
  }).then(function (r) {
    pass("a tavern is on the list ('Kalgoorlie Tavern')", r.body.matches.length === 1 && r.body.matches[0].place === "l:109", r.body);
    DB.vp_licensed_venues = null;
    W.reset();
    return get(W.venues, "?q=royal");
  }).then(function (r) {
    pass("our list missing or empty: the search still answers with venueplay venues", r.status === 200 && r.body.matches.length === 6 && r.body.matches.every(function (x) { return x.on; }), r.body);
    fresh();
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
  print("\nCAN'T FIND YOUR VENUE? ADD IT: A POSSIBLE NEW LEAD FOR HQ, NEVER A BOARD");
  fresh(); NOW = FRI_830PM;
  var ADD = { name: "The Drunken Duck & Co", suburb: "Fitzroy", state: "VIC", website: "drunkenduck.com.au" };
  return post(W.lead, ADD).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "The Drunken Duck & Co"; })[0];
    pass("an added venue is kept for HQ's review as kind 'lead' with its suburb, state and website", r.status === 200 && r.body.added === true && !!row && row.kind === "lead" &&
      row.suburb === "Fitzroy" && row.au_state === "VIC" && row.website === "https://drunkenduck.com.au" && row.timezone === "Australia/Melbourne", [r.body, row]);
    pass("INBOX 396: an added venue that cannot be confirmed (no licence row, a website that is not up) is 'unverified' with a trivia-only board for 30 days, and the player is handed it",
      row.lead_status === "unverified" && row.checked_by === "none" && RealDate.parse(row.board_until) === NOW + 30 * 86400000 && r.body.place === "c:" + row.id, [r.body, row]);
    pass("its key drops 'the', case, '&' and punctuation", row && row.name_key === "drunken duck and co", row && row.name_key);
    pass("the key is the same words HQ keeps (coasterNameKey)", W.key("The Drunken Duck & Co") === "drunken duck and co");
    pass("a fine pub name carries no lead_guard note", row && row.guard_note == null, row);
    pass("the add limit is counted per network over 10 minutes", calls.some(function (c) { return /^rl:coaster:lead:iphash:6:600$/.test(c); }), calls);
    return post(W.lead, { name: "drunken duck and co", suburb: "fitzroy", state: "VIC" });
  }).then(function (r) {
    var rows = DB.vp_coaster_venues.filter(function (x) { return x.kind === "lead" && x.name_key === "drunken duck and co"; });
    pass("a mate adding the same venue another way counts one more ask on the SAME row", r.body.added === true && rows.length === 1 && rows[0].asks === 2, rows);
    return post(W.lead, { name: "Drunken Duck & Co", suburb: "Byron Bay", state: "NSW" });
  }).then(function (r) {
    pass("the same name in another suburb is another venue", DB.vp_coaster_venues.filter(function (x) { return x.name_key === "drunken duck and co"; }).length === 2, r.body);
    return post(W.lead, { name: "Bean There Cafe", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "Bean There Cafe"; })[0];
    pass("lead_guard's name rule is noted for HQ: a cafe name is kept with its note, never refused to the player", r.status === 200 && row && /cafe name/.test(row.guard_note || ""), row);
    pass("lead_guard, like ~/venue-enrich/lead_guard.py: a strong venue word rescues a name, a food bar is no bar, a test venue is flagged",
      W.guard("Royal Hotel Restaurant") === "" && W.guard("Coffee Club") !== "" && W.guard("Pizza Bar") !== "" && W.guard("Thai Restaurant & Bar") === "" &&
      /fixture/.test(W.guard("Test Alpha Hotel")) && W.guard("The Mini Bar") === "", [W.guard("Coffee Club"), W.guard("Pizza Bar"), W.guard("Thai Restaurant & Bar")]);
    return post(W.lead, { name: "ab", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    pass("fewer than three letters is refused, and says which box", r.status === 400 && r.body.field === "name", r);
    return post(W.lead, { name: "Some Pub", suburb: "", state: "QLD" });
  }).then(function (r) {
    pass("no suburb is refused, and says which box", r.status === 400 && r.body.field === "suburb", r);
    return post(W.lead, { name: "Some Pub", suburb: "Tugun", state: "XX" });
  }).then(function (r) {
    pass("a state that is not one of the eight is refused", r.status === 400 && r.body.field === "state", r);
    return post(W.lead, { name: "Some Pub", suburb: "Tugun", state: "QLD", website: "not a site" });
  }).then(function (r) {
    pass("a website that does not look like one is refused (it is optional: empty is fine)", r.status === 400 && r.body.field === "website" && W.site("") === "" && W.site("http://x.com.au/a") === "https://x.com.au/a", r);
    return post(W.lead, { name: "The Big Shit Pub", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    var rudeRow = DB.vp_coaster_venues.filter(function (x) { return /shit/i.test(x.name); })[0];
    var tk = (DB.vp_help_tickets || [])[0];
    pass("INBOX 396: a rude name is FLAGGED, never refused to the player: kept hidden (no board, no place handed out)", r.status === 200 && r.body.added === true && !("place" in r.body) && !!rudeRow && rudeRow.lead_status === "flagged" && rudeRow.board_until == null && /rude/.test(rudeRow.guard_note), [r.body, rudeRow]);
    pass("...and Dean gets an HQ help-desk ticket for it, one ticket, nothing about the player", (DB.vp_help_tickets || []).length === 1 && tk.brand === "venueplay" && tk.channel === "manual" && /flagged/.test(tk.subject) && /Tugun/.test(tk.message) && !("contact_email" in tk), tk);
    return post(W.lead, { name: "The Big Shit Pub", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    pass("the same flagged name again adds an ask, never a second ticket, still no board", (DB.vp_help_tickets || []).length === 1 && !("place" in r.body) && DB.vp_coaster_venues.filter(function (x) { return /shit/i.test(x.name); })[0].asks === 2, r.body);
    return get(W.venues, "?q=big sh");
  }).then(function (r) {
    pass("a flagged name is never in anyone's search", r.body.matches.length === 0, r.body);
    fresh(); limited = true;
    return post(W.lead, { name: "Some Pub", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    pass("over the limit: 429 and nothing kept", r.status === 429 && DB.vp_coaster_venues.length === 3, r);
    fresh(); DB.missing = true;
    return post(W.lead, { name: "Some Pub", suburb: "Tugun", state: "QLD" });
  }).then(function (r) {
    pass("before migration 153: 503 { off: true }", r.status === 503 && r.body.off === true, r);
  });
});

var P1;
step(function () {
  print("\nSTARTING A ROUND: A FIRST NAME, NOTHING ELSE");
  fresh(); NOW = FRI_830PM;
  return post(W.start, { mobile: "0412 345 678", name: "  sam   smith-jones 0412 345 678", place: "v:" + V_MINI, qids: five(0) }).then(function (r) {
    P1 = r.body;
    var row = DB.vp_coaster_plays[0];
    pass("a round starts and answers its id, a secret, a challenge code and the venue's name and logo",
      r.status === 200 && !!P1.play && !!P1.token && /^[A-Z0-9]{6}$/.test(P1.code) && P1.venue.name === "The Mini Bar" && /mini\.png$/.test(P1.venue.logo_url), r.body);
    pass("INBOX 405 update 4.7: the round also hands the venue's own phone ad: only https picture slides, as the join lookup gives the real game (a plain http one, a hash-escaped one and a slide with no picture are dropped); a venue with none gets an empty list",
      Array.isArray(P1.venue.slides) && P1.venue.slides.length === 1 && P1.venue.slides[0].image_url === "https://x.supabase.co/storage/v1/object/public/slides/a.png" && P1.venue.slides[0].starts === "2026-11-01", P1.venue);
    pass("only the FIRST word of the name is kept, capitalised: 'Sam' (no surname, no number)", row.first_name === "Sam" && P1.name === "Sam", row.first_name);
    pass("the row holds nothing about the person but that first name",
      Object.keys(row).sort().join(",") === "answers,asked_at,board,code,correct,finished_at,first_name,from_code,id,ms_total,night,points,qids,started_at,token_hash,week", Object.keys(row).sort());
    pass("the secret is kept only as its hash", row.token_hash !== P1.token && row.token_hash.length === 64 && JSON.stringify(row).indexOf(P1.token) < 0);
    pass("tonight is the venue's own night (8:30pm Friday in NSW is Friday 6 Nov), this week is Monday 2 Nov", row.night === "2026-11-06" && row.week === "2026-11-02", [row.night, row.week]);
    pass("the round is limited per network", calls.some(function (c) { return /^rl:coaster:start:iphash:40:600$/.test(c); }), calls);
    pass("the questions are checked against the page's own file", fetched[0] === "https://venueplay.com.au/data/live-here-now.json", fetched);
    return post(W.start, { mobile: "0412 345 678", name: "", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("no first name: refused", r.status === 400 && /first name/.test(r.body.error), r);
    return post(W.start, { mobile: "0412 345 678", name: "Fuckface", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("a rude name goes on the board as 'Player', as on the TV", r.status === 200 && DB.vp_coaster_plays[1].first_name === "Player", DB.vp_coaster_plays[1] && DB.vp_coaster_plays[1].first_name);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "v:" + V_MINI, qids: ["nope", "x", "y", "z", "w"] });
  }).then(function (r) {
    pass("questions that are not on the coaster are refused", r.status === 400, r);
    var dup = five(0); dup[4] = dup[0];
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "v:" + V_MINI, qids: dup });
  }).then(function (r) {
    pass("the same question twice is refused", r.status === 400, r);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "v:" + V_MINI, qids: five(0).slice(0, 4) });
  }).then(function (r) {
    pass("four questions is refused", r.status === 400, r);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "v:" + V_GONE, qids: five(0) });
  }).then(function (r) {
    pass("a cancelled venue has no board", r.status === 404, r);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "c:" + C_SWITCHED, qids: five(0) });
  }).then(function (r) {
    pass("a coaster venue since switched to a prospect plays on that venue's board", r.status === 200 && r.body.place === "v:" + V_MINI, r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "c:" + C_TUGUN, qids: five(0) });
  }).then(function (r) {
    pass("a coaster venue has its own board, with its logo and suburb", r.status === 200 && r.body.place === "c:" + C_TUGUN && r.body.venue.suburb === "Tugun" && /t\.png$/.test(r.body.venue.logo_url), r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "c:" + L_OLD, qids: five(0) });
  }).then(function (r) {
    pass("a venue a player added (a lead) has NO board: it waits for HQ", r.status === 404 && r.body.place_gone === true && !DB.vp_coaster_plays.some(function (x) { return x.board === "c:" + L_OLD; }), r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:107", qids: five(0) });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[DB.vp_coaster_plays.length - 1];
    pass("a venue on our list has its own board 'l:<id>', its night on its state's clock, no logo, and is not 'on venueplay'",
      r.status === 200 && r.body.place === "l:107" && r.body.venue.name === "Bodalla Pub" && r.body.venue.logo_url === "" && r.body.venue.on === false && row.board === "l:107" && row.night === "2026-11-06", [r.body, row && row.night]);
    pass("...and no sign-up box: it is not a venueplay venue", !("optin" in r.body), r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:105", qids: five(0) });
  }).then(function (r) {
    pass("a list id whose name has none of the target words has no board ('Royal Cafe')", r.status === 404, r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:99999", qids: five(0) });
  }).then(function (r) {
    pass("a list id that is not there has no board", r.status === 404, r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:0", qids: five(0) });
  }).then(function (r) {
    pass("a made-up place is refused before the database is asked", r.status === 404, r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Mia", code: P1.code, place: "c:" + C_TUGUN, qids: five(10) });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[DB.vp_coaster_plays.length - 1];
    pass("a mate on the challenge link gets the SAME five questions and the SAME board, whatever the phone sent",
      r.status === 200 && r.body.place === "v:" + V_MINI && JSON.stringify(r.body.qids) === JSON.stringify(five(0)) && row.from_code === P1.code, r.body);
    pass("and a challenge code of their own to pass on", r.body.code !== P1.code);
    return post(W.start, { mobile: "0412 345 678", name: "Mia", code: "ZZZZZZ" });
  }).then(function (r) {
    pass("a challenge code that does not exist says so", r.status === 404 && r.body.gone === true, r);
    DB.forceCodeClash = 2;
    return post(W.start, { mobile: "0412 345 678", name: "Kai", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("a clashing challenge code is drawn again, not a failed round", r.status === 200, r);
    fresh(); limited = true;
    return post(W.start, { mobile: "0412 345 678", name: "Kai", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("over the limit: 429 and no round", r.status === 429 && DB.vp_coaster_plays.length === 0, r);
    fresh(); DB.missing = true;
    return post(W.start, { mobile: "0412 345 678", name: "Kai", place: "v:" + V_MINI, qids: five(0) });
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
  print("\nTHE RING RUNS OUT (INBOX 310-312): TIME'S UP IS AN ANSWER, AND NO QUESTION COUNTS MORE THAN ITS 20 SECONDS");
  fresh(); NOW = FRI_830PM;
  var q = five(0), R, start0;
  return post(W.start, { mobile: "0412 345 678", name: "Kim", place: "v:" + V_MINI, qids: q }).then(function (r) {
    R = r.body; start0 = NOW;
    NOW = start0 + 20900;   // the ring hit 0 at 20 s, the phone showed Time's up, then sent it
    return post(W.answer, { play: R.play, token: R.token, i: 0, a: -1 });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[0];
    pass("the phone's Time's up (a -1) is taken: not right, no points", r.status === 200 && r.body.correct === false && r.body.points === 0 && row.answers[0] === -1, r.body);
    pass("...and it counts as 20 seconds, not 20.9", row.ms_total === 20000, row.ms_total);
    NOW = NOW + 1300 + 22000;   // a right answer 22 s in: inside the 3 s allowance for the moment and the network
    return post(W.answer, { play: R.play, token: R.token, i: 1, a: rightOf(q[1]) });
  }).then(function (r) {
    pass("a right answer just after the ring (inside the allowance) still scores the base 100", r.body.correct === true && r.body.points === 100, r.body);
    NOW = NOW + 1300 + 23500;
    return post(W.answer, { play: R.play, token: R.token, i: 2, a: rightOf(q[2]) });
  }).then(function (r) {
    pass("a right answer 23.5 s in (past the allowance) scores as time's up", r.body.correct === false && r.body.points === 0, r.body);
    pass("each of the three counts at most 20 seconds (60 s in all)", DB.vp_coaster_plays[0].ms_total === 60000, DB.vp_coaster_plays[0].ms_total);
  });
});

step(function () {
  print("\nANSWERING: TIMED AND SCORED HERE, BY THE TRIVIA NIGHT'S OWN RULE");
  fresh(); NOW = FRI_830PM;
  var q = five(0), R, start0;
  return post(W.start, { mobile: "0412 345 678", name: "Sam", place: "v:" + V_MINI, qids: q }).then(function (r) {
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
    /* Two taps landing at the same moment (both read the round before either writes): one scores. */
    NOW += 100;
    var x1 = post(W.answer, { play: R.play, token: R.token, i: 1, a: rightOf(q[1]) });
    var x2 = post(W.answer, { play: R.play, token: R.token, i: 1, a: rightOf(q[1]) });
    return Promise.all([x1, x2]);
  }).then(function (both) {
    var st = both.map(function (r) { return r.status; }).sort().join(",");
    pass("two taps at the same moment: one is scored, the other refused (a compare-and-set on the answers)",
      st === "200,409" && DB.vp_coaster_plays[0].answers.length === 2, [st, DB.vp_coaster_plays[0].answers]);
    /* Put the round back to one answer, so the timings below read as written. */
    var row = DB.vp_coaster_plays[0];
    row.answers = row.answers.slice(0, 1); row.points = 145; row.correct = 1; row.ms_total = 2000; row.asked_at = new RealDate(start0 + 2000).toISOString();
    NOW = start0 + 2000;
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
    pass("a right answer a minute late (the ring gave it 20 seconds) scores as time's up: nothing", r.body.points === 0 && r.body.correct === false, r.body);
    pass("the running total comes back", r.body.total === 145 + 125 + 0 + 0, r.body.total);
    NOW = NOW + 1300 + 4000;
    return post(W.answer, { play: R.play, token: R.token, i: 4, a: rightOf(q[4]) });
  }).then(function (r) {
    var row = DB.vp_coaster_plays[0];
    pass("the fifth answer finishes the round: 3 of 5, 410 points", r.body.done === true && r.body.score.correct === 3 && r.body.score.points === 410 && !!row.finished_at, r.body);
    pass("the total time is each question's own, at most its 20 seconds (2 + 10 + 5 + 20 + 4 = 41 s; INBOX 311, never 2062)", row.ms_total === 41000 && r.body.score.secs === 41, row.ms_total);
    pass("the round's place on tonight's board comes back with it: 1st", r.body.board && r.body.board.rank === 1 && r.body.board.period === "tonight", r.body.board);
    return post(W.answer, { play: R.play, token: R.token, i: 4, a: 0 });
  }).then(function (r) {
    pass("a finished round takes no more answers", r.status === 409, r);
    return post(W.answer, { play: R.play, token: R.token, i: 5, a: 0 });
  }).then(function (r) {
    pass("a sixth question is refused", r.status === 400, r);
    return post(W.answer, { play: R.play, token: R.token, i: 0, a: -2 });
  }).then(function (r) {
    pass("an answer below -1 is refused", r.status === 400, r);
    return post(W.answer, { play: "not-a-uuid", token: R.token, i: 0, a: 0 }).then(function (x) { return x; }, function (e) { return { status: e.status }; });
  }).then(function (r) {
    pass("a round id that is not an id is refused before the database", r.status === 400, r);
  });
});

function playRound(name, place, qidsStart, rights, gapMs) {
  var R, q = five(qidsStart || 0);
  return post(W.start, { mobile: "0412 345 678", name: name, place: place, qids: q }).then(function (r) {
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
  print("\nAN ADDED VENUE IS A FREE LEAD THAT CAN PLAY (INBOX 396, migration 194)");
  fresh(); NOW = FRI_830PM;
  var id1, id2, id3;
  return post(W.lead, { name: "Bodalla Pub", suburb: "Bodalla", state: "NSW" }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "Bodalla Pub" && x.kind === "lead"; })[0];
    pass("auto-check 1: a name on our licensed list (same telling words, same state) is VERIFIED by the licence list: a real venue, board stays, no expiry",
      row && row.lead_status === "verified" && row.checked_by === "licence list" && row.board_until == null && r.body.place === "c:" + row.id, [r.body, row]);
    id1 = row.id;
    return post(W.lead, { name: "The Wandering Dingo Tavern", suburb: "Fitzroy", state: "VIC", website: "realpub.com.au" });
  }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "The Wandering Dingo Tavern"; })[0];
    pass("auto-check 2: not on the list, but its own website loads and says its name: VERIFIED by the website", row && row.lead_status === "verified" && row.checked_by === "website" && r.body.place === "c:" + row.id, [r.body, row]);
    return post(W.lead, { name: "Dingo Palace", suburb: "Fitzroy", state: "VIC", website: "shop.com.au" });
  }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "Dingo Palace"; })[0];
    pass("auto-check 3: a website that does not say the venue's name proves nothing: UNVERIFIED, a trivia-only board for 30 days", row && row.lead_status === "unverified" && !!r.body.place, [r.body, row]);
    id2 = row.id;
    return post(W.lead, { name: "Made Up Arms", suburb: "Nowhere", state: "QLD", website: "https://10.0.0.5/admin" });
  }).then(function (r) {
    var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "Made Up Arms"; })[0];
    pass("a website that points at an address inside a network is never fetched (no private hosts): UNVERIFIED", row && row.lead_status === "unverified" && fetched.indexOf("https://10.0.0.5/admin") < 0, [fetched, row]);
    id3 = row.id;
    pass("the same words on a licensed venue in ANOTHER state is not a match", W.same("royal oak", "royal oak hotel") === true && W.same("oak tree", "royal oak hotel") === false);
    return post(W.start, { mobile: "0412 345 678", name: "Pat", place: "c:" + id2, qids: five(0) });
  }).then(function (r) {
    pass("a round can be played on an unverified lead's board (trivia only: no venueplay login, no sign-up questions)", r.status === 200 && !!r.body.play && r.body.venue && r.body.venue.name === "Dingo Palace" && r.body.venue.on === false && !r.body.optin, r.body);
    return get(W.venues, "?q=dingo");
  }).then(function (r) {
    var names = r.body.matches.map(function (m) { return m.name; });
    pass("search: the VERIFIED lead is findable by the next player (not on venueplay yet); the UNVERIFIED one is not", names.indexOf("The Wandering Dingo Tavern") >= 0 && names.indexOf("Dingo Palace") < 0 && r.body.matches.every(function (m) { return m.on === false; }), r.body);
    NOW = NOW + 31 * 86400000;
    return post(W.start, { mobile: "0412 345 678", name: "Pat", place: "c:" + id2, qids: five(0) });
  }).then(function (r) {
    pass("after its 30 days an unverified board is closed (the place is gone) and a verified one is not", r.status === 404 && r.body.place_gone === true, r);
    return post(W.start, { mobile: "0412 345 678", name: "Pat", place: "c:" + id1, qids: five(0) });
  }).then(function (r) {
    pass("...a verified lead's board is still open after 31 days", r.status === 200 && !!r.body.play, r);
    DB.vp_coaster_plays.push({ id: "z1", board: "c:" + id2, first_name: "Pat", started_at: new RealDate(NOW - 86400000).toISOString() });
    DB.vp_coaster_plays.push({ id: "z2", board: "c:" + id1, first_name: "Pat", started_at: new RealDate(NOW - 86400000).toISOString() });
    return W.sweep({}, NOW);
  }).then(function (r) {
    var left = DB.vp_coaster_venues.filter(function (x) { return x.kind === "lead"; }).map(function (x) { return x.name; });
    pass("the nightly sweep DELETES unverified leads whose 30 days are up, with their rounds; verified, flagged and legacy leads stay", r.ok === true && left.indexOf("Dingo Palace") < 0 && left.indexOf("Made Up Arms") < 0 &&
      left.indexOf("Bodalla Pub") >= 0 && left.indexOf("The Wandering Dingo Tavern") >= 0 && left.indexOf("Leady Larry's") >= 0 &&
      !DB.vp_coaster_plays.some(function (x) { return x.board === "c:" + id2; }) && DB.vp_coaster_plays.some(function (x) { return x.board === "c:" + id1; }) && r.leads_deleted === 2, [r, left]);
    pass("a lead from before migration 194 (never checked) has no board", W.open({ kind: "lead", venue_id: null }, NOW) === false && W.open({ lead_status: "flagged", venue_id: null }, NOW) === false &&
      W.open({ lead_status: "unverified", board_until: new RealDate(NOW + 1000).toISOString(), venue_id: null }, NOW) === true);
    pass("never cold-emailed: a lead is only a vp_coaster_venues row (no vp_venues, vp_prospects, vp_venue_staff or send-list write, no email call)",
      !calls.some(function (c) { return /^(INSERT|PATCH) (vp_venues|vp_prospects|vp_venue_staff|vp_licensed_venues|vp_outbox)/.test(c); }) && !/resend|sendEmail|instantly/i.test(GAME.slice(GAME.indexOf("async function handleCoasterLead("), GAME.indexOf("/* POST /coaster/start {"))), calls.slice(-6));
    fresh(); NOW = FRI_830PM; DB.vp_coaster_venues = [];
    DB.noLeadCols = true;
    return post(W.lead, { name: "Early Bird Tavern", suburb: "Tugun", state: "QLD" }).then(function (r) {
      var row = DB.vp_coaster_venues.filter(function (x) { return x.name === "Early Bird Tavern"; })[0];
      pass("BEFORE migration 194 runs: an added venue is kept for HQ exactly as before (no board, no place), and nothing throws", r.status === 200 && r.body.added === true && !("place" in r.body) && !!row && !("lead_status" in row), [r, row]);
      DB.vp_coaster_venues.push({ id: C_TUGUN, kind: "coaster", name: "Tugun Tavern", name_key: "tugun tavern", suburb: "Tugun", postcode: "4224", au_state: "QLD", timezone: "Australia/Brisbane", venue_id: null });
      return post(W.start, { mobile: "0412 345 678", name: "Pat", place: "c:" + C_TUGUN, qids: five(0) });
    }).then(function (r) {
      pass("...and a coaster venue's board still plays before migration 194 (the place lookup never needs the new columns)", r.status === 200 && !!r.body.play, r);
      DB.noLeadCols = false;
    });
  });
});

step(function () {
  print("\nTHE WEBSITE CHECK CANNOT BE POINTED AT A MACHINE OF OURS (SSRF, INBOX 396)");
  fresh(); NOW = FRI_830PM;
  var bad = ["http://realpub.com.au", "https://user@realpub.com.au", "https://user:pw@realpub.com.au", "https://2130706433", "https://2130706433/", "https://0x7f000001/", "https://0177.0.0.1/",
    "https://127.0.0.1", "https://10.0.0.5/admin", "https://169.254.169.254/latest", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://localhost", "https://localhost.localdomain",
    "https://printer.local", "https://db.internal", "https://nas.home", "https://x.lan", "https://x.arpa", "https://realpub", "https://realpub.com.au:8443", "https://realpub.com.au:22/",
    "https://real%2epub.com.au", "ftp://realpub.com.au", "file:///etc/passwd", "https://", "https://.com.au", "https://-x.com.au", "https://1.2.3.4.5", "https://999.999.999.999"];
  pass("every bad form of address is refused by the guard (" + bad.length + " of them: http, userinfo, decimal/hex/octal/dotted IPs, IPv6, localhost, local names, odd ports, encoded dots, other schemes)",
    bad.every(function (u) { return W.safe(u) === null; }), bad.filter(function (u) { return W.safe(u) !== null; }));
  pass("a real site passes, normalised to lower case with its path", W.safe("https://RealPub.com.au/menu?x=1") === "https://realpub.com.au/menu?x=1" && W.safe("https://realpub.com.au:443/") === "https://realpub.com.au/");
  pass("redirects are resolved and re-checked: relative paths stay on the host, http, IPs and local names are refused",
    W.hop("https://a.com.au/x/y", "/z") === "https://a.com.au/z" && W.hop("https://a.com.au/x/y", "z") === "https://a.com.au/x/z" && W.hop("https://a.com.au/x", "//b.com.au/q") === "https://b.com.au/q" &&
    W.hop("https://a.com.au/x", "http://b.com.au") === null && W.hop("https://a.com.au/x", "https://127.0.0.1") === null && W.hop("https://a.com.au/x", "//169.254.169.254/") === null &&
    W.hop("https://a.com.au/x", "javascript:alert(1)") === null && W.hop("https://a.com.au/x", "") === null);
  var words = ["wandering", "dingo"];
  return W.siteNames("https://realpub.com.au", words).then(function (ok) {
    pass("a site that says the venue's words is confirmed (manual redirect mode: the fetch is asked not to follow)", ok === true && fetched.indexOf("https://realpub.com.au") >= 0, fetched);
    return W.siteNames("https://short.com.au/a", words);
  }).then(function (ok) {
    pass("a redirect to the venue's own page is followed by hand and confirms", ok === true, fetched);
    fetched.length = 0;
    return W.siteNames("https://evil.com.au/a", words);
  }).then(function (ok) {
    pass("a redirect to 127.0.0.1 is never fetched, and is not confirmed", ok === false && fetched.every(function (u) { return u.indexOf("127.0.0.1") < 0; }), fetched);
    return W.siteNames("https://evil.com.au/b", words);
  }).then(function (ok) {
    pass("a redirect to plain http is never fetched, and is not confirmed", ok === false && fetched.every(function (u) { return u.indexOf("http://") !== 0; }), fetched);
    return W.siteNames("https://evil.com.au/c", words);
  }).then(function (ok) {
    pass("a protocol-relative redirect to the metadata address is never fetched", ok === false && fetched.every(function (u) { return u.indexOf("169.254") < 0; }), fetched);
    return W.siteNames("https://evil.com.au/d", words);
  }).then(function (ok) {
    pass("a redirect to a localhost name is never fetched", ok === false && fetched.every(function (u) { return u.indexOf("localhost") < 0; }), fetched);
    fetched.length = 0;
    return W.siteNames("https://loop.com.au/1", words);
  }).then(function (ok) {
    pass("a chain of 4 redirects is not followed to the end: not confirmed, and at most 4 requests made", ok === false && fetched.length <= 4 && fetched.indexOf("https://realpub.com.au") < 0, fetched);
    return W.siteNames("https://shop.com.au", words);
  }).then(function (ok) {
    pass("a site that does not say the venue's words proves nothing", ok === false);
    var g = GAME.slice(GAME.indexOf("async function coasterWebsiteNames("), GAME.indexOf("/* A rude name goes to Dean"));
    pass("the fetch is in manual redirect mode, capped at 200 KB, with a 3 second timeout, and only a boolean leaves it",
      /redirect: 'manual'/.test(g) && !/redirect: 'follow'/.test(g) && /COASTER_SITE_BYTES = 200000/.test(GAME) && /, 3000\)/.test(g) && !/return t\b|return text\b/.test(g));
    fresh(); NOW = FRI_830PM; fetched.length = 0; limited = false;
    return post(W.lead, { name: "Dingo Hut", suburb: "Fitzroy", state: "VIC", website: "https://127.0.0.1/admin" });
  }).then(function (r) {
    pass("end to end: a lead whose website is an IP is added as unverified and the address is never fetched", r.status === 200 && fetched.indexOf("https://127.0.0.1/admin") < 0 && DB.vp_coaster_venues.filter(function (x) { return x.name === "Dingo Hut"; })[0].lead_status === "unverified", fetched);
    pass("the website check is rate limited per network per day, and a repeat add never fetches again", calls.some(function (c) { return /^rl:coaster:sitecheck:iphash:6:86400$/.test(c); }), calls);
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
  print("\nTHE DETAILS STEP ASKS FIRST (INBOX 309.1c): GET /coaster/ask");
  fresh(); NOW = FRI_830PM; calls = [];
  return get(W.ask, "?place=" + encodeURIComponent("v:" + V_MINI)).then(function (r) {
    pass("a venue HQ switched on: what it collects and the tick, before any round", r.status === 200 && JSON.stringify(r.body.optin) === JSON.stringify({ email: true, mobile: false, marketing_optin: true, last_name: false }), r.body);
    pass("...and it is limited per network like the search", calls.some(function (c) { return /^rl:coaster:find:iphash:30:60$/.test(c); }), calls);
    return get(W.ask, "?place=" + encodeURIComponent("v:" + V_PERTH));
  }).then(function (r) {
    pass("a venue not switched on: nothing to ask", r.status === 200 && r.body.optin === null, r.body);
    return get(W.ask, "?place=" + encodeURIComponent("c:" + C_TUGUN));
  }).then(function (r) {
    pass("a coaster venue (not on venueplay): nothing to ask, never an email for a venue we cannot give it to", r.status === 200 && r.body.optin === null, r.body);
    return get(W.ask, "?place=rubbish");
  }).then(function (r) {
    pass("a place that is not one: nothing to ask", r.status === 200 && r.body.optin === null, r.body);
    pass("asking stores nothing", DB.vp_coaster_plays.length === 0 && DB.vp_captures.length === 0);
  });
});

step(function () {
  print("\nTHE PLAYER'S DETAILS AT A VENUEPLAY VENUE (Dean 15 Nov 2026): FIRST NAME + MOBILE ALWAYS, EMAIL AND TICK ONLY WHERE HQ SWITCHED IT ON");
  fresh(); NOW = FRI_830PM;
  var mini, perth;
  return post(W.start, { mobile: "0412 345 678", name: "Sam", place: "v:" + V_MINI, qids: five(0) }).then(function (r) {
    mini = r.body;
    pass("a round at a venue HQ switched on carries the sign-up box: what the venue collects (email, no mobile) and the tick",
      r.status === 200 && JSON.stringify(mini.optin) === JSON.stringify({ email: true, mobile: false, marketing_optin: true, last_name: false }), mini.optin);
    pass("the round's row on the board never holds the mobile", DB.vp_coaster_plays.every(function (p) { return !("mobile" in p) && JSON.stringify(p).indexOf("412345678") < 0; }), DB.vp_coaster_plays);
    return post(W.start, { mobile: "0412 345 678", name: "Sam", place: "v:" + V_PERTH, qids: five(0) });
  }).then(function (r) {
    perth = r.body;
    pass("a venue NOT switched on gets no box (every existing venue starts OFF)", r.status === 200 && !("optin" in perth), perth);
    calls = [];
    return post(W.optin, { play: mini.play, token: mini.token, email: "Sam@Example.com ", mobile: "0412 345 678", marketing_optin: true, consent_version: "vpc-2-6nov", last_name: "Smith" });
  }).then(function (r) {
    var c = DB.vp_captures[0];
    pass("the sign-up is kept for THAT venue, source 'coaster', with the consent words' version", r.status === 200 && r.body.stored === true && c && c.venue_id === V_MINI &&
      c.source === "coaster" && c.email === "sam@example.com" && c.marketing_optin === true && c.consent_version === "vpc-2-6nov", c);
    pass("the mobile is always kept, in the one +61 form, even where the venue's settings do not collect one", c && c.mobile === "+61412345678", c);
    pass("the round's first name goes with it (INBOX 309.1c); a last name only where the venue collects one", c && c.first_name === "Sam" && !("last_name" in c), c);
    pass("it cannot prove the phone was in the room, so it is kept with during_game false, like every such sign-up", c && c.during_game === false, c);
    pass("the sign-up limit is counted per network", calls.some(function (x) { return /^rl:coaster:optin:iphash:10:600$/.test(x); }), calls);
    return post(W.optin, { play: mini.play, token: mini.token, mobile: "0412 345 678", email: "jo@example.com", marketing_optin: false });
  }).then(function (r) {
    var c = DB.vp_captures[1];
    pass("no tick: the email is kept, the opt-in is not (never ticked for them)", r.body.stored === true && c && !c.marketing_optin && !("consent_version" in c), c);
    return post(W.optin, { play: mini.play, token: "wrong", mobile: "0412 345 678", email: "x@example.com", marketing_optin: true });
  }).then(function (r) {
    pass("someone else's round: refused, nothing kept", r.status === 403 && DB.vp_captures.length === 2, r);
    return post(W.optin, { play: perth.play, token: perth.token, mobile: "0498 765 432", email: "x@example.com", marketing_optin: true });
  }).then(function (r) {
    var c = DB.vp_captures[2];
    pass("at a venue NOT switched on: the first name and mobile are kept for it, never the email or a tick", r.status === 200 && r.body.stored === true && c && c.venue_id === V_PERTH &&
      c.mobile === "+61498765432" && c.first_name === "Sam" && !("email" in c) && !c.marketing_optin && !("consent_version" in c), c);
    return post(W.optin, { play: perth.play, token: perth.token, mobile: "+61 498 765 432" });
  }).then(function (r) {
    pass("the same phone again with nothing new: kept once, not once a round", r.body.stored === true && DB.vp_captures.length === 3, DB.vp_captures.length);
    return post(W.optin, { play: mini.play, token: mini.token, email: "nope", mobile: "0412 345 678", marketing_optin: true });
  }).then(function (r) {
    pass("an email that does not look right is refused", r.status === 400, r);
    return post(W.optin, { play: mini.play, token: mini.token, email: "a@example.com", marketing_optin: true });
  }).then(function (r) {
    pass("no mobile: refused at the Worker too, nothing kept", r.status === 400 && r.body.field === "mobile" && DB.vp_captures.length === 3, r);
    DB.no174 = true;
    return post(W.optin, { play: mini.play, token: mini.token, mobile: "0412 345 678", email: "late@example.com", marketing_optin: true, consent_version: "vpc-2-6nov" });
  }).then(function (r) {
    var c = DB.vp_captures[3];
    pass("before migration 174's column: kept without the version rather than lost", r.body.stored === true && c && c.email === "late@example.com" && c.marketing_optin === true && !("consent_version" in c), c);
    DB.no174 = false; DB.vp_coaster_optin_venues = [];
    return post(W.optin, { play: mini.play, token: mini.token, mobile: "0412 345 678", email: "after@example.com", marketing_optin: true });
  }).then(function (r) {
    pass("switched off again in HQ: no email and no tick kept any more (the mobile is already held once)", r.body.stored === true && DB.vp_captures.length === 4 &&
      DB.vp_captures.every(function (c) { return c.email !== "after@example.com"; }), DB.vp_captures);
  });
});

step(function () {
  print("\nTHE MOBILE (Dean 15 Nov 2026): REQUIRED AT EVERY BOARD, AUSTRALIAN FORMATS WITH SPACES, CHECKED BY THE WORKER");
  fresh(); NOW = FRI_830PM;
  ["0412 345 678", "0412345678", "+61 412 345 678", "+61412345678", "61412345678", "412 345 678", "(04) 1234-5678", "0412.345.678"].forEach(function (m) {
    pass("'" + m + "' is a mobile: +61412345678", W.mobile(m) === "+61412345678", W.mobile(m));
  });
  ["", "0412 345 67", "0412 345 6789", "0212345678", "+64211234567", "07 5228 3667", "+0412345678", "0412a345678", "1300 123 456"].forEach(function (m) {
    pass("'" + m + "' is not an Australian mobile", W.mobile(m) === "", W.mobile(m));
  });
  return post(W.start, { name: "Sam", place: "v:" + V_MINI, qids: five(0) }).then(function (r) {
    pass("no mobile: no round on the board ('Type your mobile.')", r.status === 400 && r.body.field === "mobile" && r.body.error === "Type your mobile." && DB.vp_coaster_plays.length === 0, r);
    return post(W.start, { name: "Sam", mobile: "0412 345", place: "v:" + V_MINI, qids: five(0) });
  }).then(function (r) {
    pass("a short mobile: refused with the words to fix it", r.status === 400 && /starts 04 and has 10 digits/.test(r.body.error || "") && DB.vp_coaster_plays.length === 0, r);
    return post(W.start, { name: "Sam", mobile: "+61 412 345 678", place: "c:" + C_TUGUN, qids: five(0) });
  }).then(function (r) {
    pass("+61 with spaces plays", r.status === 200 && !!r.body.play, r.body);
    var code = r.body.code;
    return post(W.start, { name: "Jo", code: code }).then(function (r2) {
      pass("a mate's challenge link needs a mobile too", r2.status === 400 && r2.body.field === "mobile", r2);
    });
  });
});

step(function () {
  print("\nA BOARD WITH NO VENUEPLAY ACCOUNT: FIRST NAME + MOBILE FOR VENUEPLAY ONLY (migration 198), NEVER A VENUE'S");
  fresh(); NOW = FRI_830PM;
  var lead, tug;
  return post(W.lead, { name: "The Wandering Dingo Tavern", suburb: "Fitzroy", state: "VIC", website: "realpub.com.au" }).then(function (r) {
    pass("the added venue has its own board", r.status === 200 && /^c:/.test(r.body.place || ""), r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Sam", place: r.body.place, qids: five(0) });
  }).then(function (r) {
    lead = r.body;
    pass("a round on the added venue's board: no sign-up box (no venue to give it to)", r.status === 200 && !r.body.optin && r.body.venue && r.body.venue.on === false, r.body);
    return post(W.optin, { play: lead.play, token: lead.token, mobile: "0412 345 678", email: "sam@example.com", marketing_optin: true });
  }).then(function (r) {
    var c = (DB.vp_coaster_contacts || [])[0], lid = lead.place.slice(2);
    pass("kept in vp_coaster_contacts against the lead row: board, first name, mobile, the round", r.status === 200 && r.body.stored === true && c && c.board === lead.place &&
      c.coaster_venue_id === lid && c.first_name === "Sam" && c.mobile === "+61412345678" && c.play_id === lead.play, c);
    pass("...and nothing else of theirs: no email, no tick, never in vp_captures", c && !("email" in c) && !("marketing_optin" in c) && DB.vp_captures.length === 0, c);
    return post(W.optin, { play: lead.play, token: lead.token, mobile: "0412 345 678" });
  }).then(function (r) {
    pass("the same phone again: kept once (one row per board and mobile)", r.body.stored === true && DB.vp_coaster_contacts.length === 1, DB.vp_coaster_contacts);
    return post(W.start, { mobile: "0400 000 001", name: "Kim", place: "c:" + C_TUGUN, qids: five(0) });
  }).then(function (r) {
    tug = r.body;
    return post(W.optin, { play: tug.play, token: tug.token, mobile: "0400 000 001" });
  }).then(function (r) {
    var c = DB.vp_coaster_contacts[1];
    pass("a coaster venue (not on venueplay) keeps them for venueplay the same way", r.body.stored === true && c && c.board === "c:" + C_TUGUN && c.mobile === "+61400000001", c);
    DB.no198 = true;
    return post(W.optin, { play: tug.play, token: tug.token, mobile: "0400 000 002" });
  }).then(function (r) {
    pass("before migration 198: nothing kept, no error (the round plays the same)", r.status === 200 && r.body.stored === false && DB.vp_coaster_contacts.length === 2, r);
    DB.no198 = false;
    var opt = GAME.slice(GAME.indexOf("async function coasterKeepContact("), GAME.indexOf("/* GET /coaster/board?"));
    pass("the venueplay-only store writes vp_coaster_contacts and nothing a venue reads (no vp_captures, no venue id)", /sbInsert\(env, 'vp_coaster_contacts'/.test(opt) && opt.indexOf("vp_captures") < 0 && !/[^_]venue_id\s*:/.test(opt));
    pass("nothing in either Worker reads vp_coaster_contacts back (no list, no export, no send)", (GAME.match(/vp_coaster_contacts/g) || []).length === (opt.match(/vp_coaster_contacts/g) || []).length + (GAME.slice(GAME.indexOf("/* POST /coaster/optin {"), GAME.indexOf("async function handleCoasterOptin(")).match(/vp_coaster_contacts/g) || []).length &&
      find("venueplay-backend/worker/venueplay-api-FULL.js").indexOf("vp_coaster_contacts") < 0);
  });
});

step(function () {
  print("\nTHE DETAILS STEP NAMES THE VENUE OF A MATE'S CHALLENGE: GET /coaster/ask?code=");
  fresh(); NOW = FRI_830PM;
  var mini;
  return post(W.start, { mobile: "0412 345 678", name: "Sam", place: "v:" + V_MINI, qids: five(0) }).then(function (r) {
    mini = r.body;
    return get(W.ask, "?code=" + mini.code);
  }).then(function (r) {
    pass("a challenge code answers the venue's name, that it is a venueplay venue, and its sign-up box", r.status === 200 && r.body.venue && r.body.venue.name === "The Mini Bar" && r.body.venue.owner === true && r.body.optin && r.body.optin.email === true, r.body);
    return post(W.start, { mobile: "0412 345 678", name: "Sam", place: "c:" + C_TUGUN, qids: five(0) });
  }).then(function (r) {
    return get(W.ask, "?code=" + r.body.code);
  }).then(function (r) {
    pass("a coaster venue's challenge: named, not a venueplay venue, no box", r.status === 200 && r.body.venue && r.body.venue.name === "Tugun Tavern" && r.body.venue.owner === false && r.body.optin === null, r.body);
    return get(W.ask, "?code=ZZZZZZ");
  }).then(function (r) {
    pass("a code that is not one: nothing named, nothing to ask", r.status === 200 && r.body.optin === null && !r.body.venue, r.body);
    return get(W.ask, "?place=" + encodeURIComponent("v:" + V_PERTH));
  }).then(function (r) {
    pass("a picked venueplay venue says it is one (the details go to it)", r.body.venue && r.body.venue.owner === true, r.body);
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
   "if (method === 'GET'  && path === '/coaster/board')      return await handleCoasterBoardRoute(request, env, json);",
   "if (method === 'POST' && path === '/coaster/optin')      return await handleCoasterOptin(request, env, json);",
   "if (method === 'GET'  && path === '/coaster/ask')        return await handleCoasterAsk(request, env, json);"].forEach(function (l) {
    pass("the router sends " + l.split("'")[3] + " to its handler", router.indexOf(l) >= 0);
  });
  var o0 = BLOCK.indexOf("async function coasterOptinAsk("), o1 = BLOCK.indexOf("/* GET /coaster/board?", o0);
  pass("the venue's sign-up is one piece of the block (coasterOptinAsk, handleCoasterOptin)", o0 > 0 && o1 > o0 && BLOCK.slice(o0, o1).indexOf("async function handleCoasterOptin(") > 0);
  var outside = (BLOCK.slice(0, o0) + BLOCK.slice(o1)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/phoneSlides/g, "");
  pass("outside the venue's own sign-up, the only contact detail in the coaster block is the round's mobile check (coasterMobileError), never an email or a surname",
    !/email|phone|surname|last_name/i.test(outside) && outside.replace("const mobileErr = coasterMobileError(b.mobile);", "").replace("if (mobileErr) return json({ error: mobileErr, field: 'mobile' }, 400);", "").search(/mobile/i) < 0, outside.match(/.{0,60}mobile.{0,60}/i));   // phoneSlides is the join lookup's own slide filter, the venue's ad, no person's detail
  pass("the sign-up goes through the phones' own gate (gatedCapture) and the venue's own settings (venueCollectCfg), never a copy",
    /gatedCapture\(gate, /.test(BLOCK) && /venueCollectCfg\(env, where\.venue_id\)/.test(BLOCK) && BLOCK.indexOf("function gatedCapture") < 0);
  return Promise.resolve();
});

step(function () {
  print("\nTHE PICKER'S LIST (Dean 12 Nov, INBOX 304-307): EVERY VENUEPLAY VENUE, AND ONLY PUBS AND CLUBS FROM OUR LIST");
  fresh(); NOW = FRI_830PM;
  DB.vp_licensed_venues = DB.vp_licensed_venues.concat([
      /* INBOX 304/305: the family words, and the accommodation hotels left out (the country "X Hotel" kept). */
      { id: 120, name: "Zeta Hotel", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 121, name: "Zeta Leagues", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 122, name: "Zeta Bowls", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 123, name: "Zeta Arms", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 124, name: "Zeta Inn", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 125, name: "Hilton Zeta Hotel", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 126, name: "Novotel Zeta", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 127, name: "Zeta Motor Inn", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 128, name: "Zeta Suites Hotel", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 129, name: "Zeta Backpackers Hotel", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 130, name: "Zeta Serviced Apartments", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 131, name: "Zetabowls Cafe", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 132, name: "Quest Zeta Hotel", suburb: "Zeta", postcode: "2650", au_state: "NSW" },
      { id: 133, name: "Zeta Bowling Greens", suburb: "Zeta", postcode: "2650", au_state: "NSW" }
  ]);
  var active = DB.vp_venues.filter(function (v) { return v.status === "active"; });
  var missing = [];
  var chainP = Promise.resolve();
  active.forEach(function (v) {
    chainP = chainP.then(function () { W.reset(); return get(W.venues, "?q=" + encodeURIComponent(v.name)); }).then(function (r) {
      if (!r.body.matches.some(function (m) { return m.place === "v:" + v.id && m.on === true; })) missing.push(v.name);
    });
  });
  return chainP.then(function () {
    pass("EVERY active venueplay venue (" + active.length + ") is in the picker under its own name, whatever the name", active.length >= 10 && missing.length === 0, missing);
    pass("...including The Mini Bar, The Lunatic and Revolver Upstairs (no pub, club or hotel word)",
      ["The Mini Bar", "The Lunatic", "Revolver Upstairs"].every(function (n) { return active.some(function (v) { return v.name === n; }) && missing.indexOf(n) < 0; }), missing);
    W.reset();
    return get(W.venues, "?q=zeta");
  }).then(function (r) {
    var names = r.body.matches.map(function (m) { return m.name; });
    pass("a venueplay venue with an accommodation word ('Zeta Motel') is never dropped", r.body.matches.some(function (m) { return m.place === "v:88888888-8888-4888-8888-888888888883"; }), names);
    pass("our list keeps the country pub called 'X Hotel' ('Zeta Hotel')", names.indexOf("Zeta Hotel") >= 0, names);
    pass("our list keeps leagues, bowls, arms and inn names (whole words)",
      ["Zeta Leagues", "Zeta Bowls", "Zeta Arms", "Zeta Inn"].every(function (n) { return names.indexOf(n) >= 0; }), names);
    pass("our list drops the hotel chains (Hilton, Novotel, Quest)", !names.some(function (n) { return /hilton|novotel|quest/i.test(n); }), names);
    pass("our list drops motor inns, suites, backpackers and serviced apartments", !names.some(function (n) { return /motor inn|suites|backpackers|serviced/i.test(n); }), names);
    pass("whole words only: 'Zetabowls Cafe' and 'Zeta Bowling Greens' are not bowls clubs", !names.some(function (n) { return /zetabowls|bowling/i.test(n); }), names);
    pass("exactly the venueplay venue and the five kept names", names.length === 6, names);
    calls = [];
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:125", qids: five(0) });
  }).then(function (r) {
    pass("a chain hotel's board 'l:<id>' is refused even when typed in by address", r.status >= 400 && !DB.vp_coaster_plays.length, [r.status, r.body]);
    return post(W.start, { mobile: "0412 345 678", name: "Jo", place: "l:120", qids: five(0) });
  }).then(function (r) {
    pass("...while the kept country pub's board opens", r.status === 200 && r.body.place === "l:120", [r.status, r.body]);
  });
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
