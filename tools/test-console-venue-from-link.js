/* A CONSOLE RUNS AT THE VENUE ITS LINK NAMES, OR SAYS PLAINLY THAT IT CANNOT.
   27 Sep 2026: a trivia console at ?venue=test-alpha opened a live lobby at Karina Bay Surf Club (a real
   venue) because another tab had switched this browser to it; nothing read ?venue=. This loads the REAL
   venueplay/app/vp-session.js with a fake browser and a fake database and asks VP.ready() which venue
   it chose, for each kind of link.  Run: jsc tools/test-console-venue-from-link.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var SRC = readFile("venueplay/app/vp-session.js");
var A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
var VENUES = [{ id: A, slug: "test-alpha", name: "Test Alpha", status: "active" },
              { id: B, slug: "karina-bay-surf-club", name: "Karina Bay Surf Club", status: "active" },
              { id: C, slug: "someone-else", name: "Someone Else", status: "active" }];
function q(rows){ var b = { _rows: rows, select: function(){ return b; }, order: function(){ return b; }, limit: function(){ return b; },
  eq: function(k, v){ b._rows = b._rows.filter(function(r){ return String(r[k]) === String(v); }); return b; },
  "in": function(k, vs){ b._rows = b._rows.filter(function(r){ return vs.indexOf(r[k]) >= 0; }); return Promise.resolve({ data: b._rows }); },
  maybeSingle: function(){ return Promise.resolve({ data: b._rows[0] || null }); },
  then: function(res, rej){ return Promise.resolve({ data: b._rows }).then(res, rej); } }; return b; }
function run(path, search, stored, who){
  var store = { vpCurrentVenue: stored }, sess = {};
  var body = { kids: [], appendChild: function(e){ this.kids.push(e); } };
  var readable = who.admin ? VENUES : VENUES.filter(function(v){ return who.staff.indexOf(v.id) >= 0; });   // RLS
  var db = { vp_platform_admins: who.admin ? [{ auth_user_id: "u1", role: "owner", label: "HQ" }] : [],
             vp_venue_staff: who.staff.map(function(id){ return { auth_user_id: "u1", venue_id: id, role: "owner" }; }),
             vp_venues: readable, vp_venue_settings: [] };
  var client = { auth: { getSession: function(){ return Promise.resolve({ data: { session: { user: { id: "u1" } } } }); } },
                 from: function(t){ return q((db[t] || []).slice()); } };
  var window = { location: { pathname: path, search: search }, supabase: { createClient: function(){ return client; } },
                 localStorage: { getItem: function(k){ return k in store ? store[k] : null; }, setItem: function(k, v){ store[k] = v; }, removeItem: function(k){ delete store[k]; } },
                 sessionStorage: { getItem: function(k){ return k in sess ? sess[k] : null; }, setItem: function(k, v){ sess[k] = v; }, removeItem: function(k){ delete sess[k]; } },
                 setTimeout: function(){ return 0; }, clearTimeout: function(){}, fetch: function(){ return Promise.reject(new Error("no")); } };
  var document = { getElementById: function(id){ return null; }, createElement: function(){ return { style: {}, addEventListener: function(){}, appendChild: function(){} }; }, body: body, documentElement: body };
  var localStorage = window.localStorage, sessionStorage = window.sessionStorage, location = window.location;
  (new Function("window", "document", "localStorage", "sessionStorage", "location", SRC))(window, document, localStorage, sessionStorage, location);
  var out = null; window.VP.ready().then(function(ctx){ out = { id: ctx.currentVenueId, refused: ctx.urlVenueRefused || null, banner: body.kids.length, stored: store.vpCurrentVenue }; });
  drainMicrotasks();
  return out;
}
var admin = { admin: true, staff: [] }, host = { admin: false, staff: [A, B] }, oneVenue = { admin: false, staff: [A] };
var r = run("/app/trivia/host", "?venue=test-alpha", B, admin);
ok("the Karina Bay case: stored on Karina Bay, link says test-alpha -> runs at Test Alpha", r && r.id === A, JSON.stringify(r));
ok("...and remembers it, the same as picking it", r && r.stored === A);
r = run("/app/musical/host.html", "?venue=" + A, B, host);
ok("a venue id in the link works too (settings, billing links)", r && r.id === A, JSON.stringify(r));
r = run("/app/trivia/host", "?venue=someone-else", A, oneVenue);
ok("a venue this login cannot run: stays at its own venue", r && r.id === A, JSON.stringify(r));
ok("...and SAYS so on screen, instead of silently carrying on", r && r.refused === "someone-else" && r.banner === 1, JSON.stringify(r));
r = run("/app/trivia/host", "", B, admin);
ok("control: no ?venue= keeps the browser's choice", r && r.id === B, JSON.stringify(r));
r = run("/app/trivia/screen", "?venue=test-alpha", B, admin);
ok("a TV page on the same laptop does NOT move the host's console", r && r.id === B && r.stored === B, JSON.stringify(r));
r = run("/app/", "?venue=test-alpha", B, admin);
ok("the bingo console (/app/) honours it too", r && r.id === A, JSON.stringify(r));
r = run("/app/trivia/host", "?venue=Test_Alpha", B, admin);
ok("a hand-typed slug with capitals or underscores still finds the venue", r && r.id === A, JSON.stringify(r));
print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
