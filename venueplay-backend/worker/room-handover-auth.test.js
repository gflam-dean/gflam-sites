/* WHO MAY HAND A VENUE'S ROOM OVER (6 Nov 2026, security review B1, finding F2).

   POST /room/handover had no sign in and no rate limit. A room's name is on /play/live for
   anyone, so a stranger could close every socket at a venue in the middle of a game, and do it
   again every six hours. Now the game Worker's roomHandoverAuth decides, and handleRoomHandover
   hands over only on signed: true (venueplay-room-handover.test.js holds that half).

   This runs the REAL roomHandoverAuth, rateLimit and requireStaff, lifted out of
   venueplay-game.js, against a scripted database and a scripted sign in, and then the real
   handleRoomHandover with it, end to end:
     - no sign in: not signed (refused upstream, 401, an ask only)
     - a sign in that does not verify: not signed
     - signed in, but not staff at THIS venue: not signed
     - the real caller, a console signed in as staff at the venue: signed
     - an HQ admin: signed
     - a burst from one network past the limit: limited (429), signed or not
     - a players' room only goes with the venue when it is that venue's session

   Run: jsc venueplay-backend/worker/room-handover-auth.test.js */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var t = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} }
  throw new Error("cannot open " + rel);
}
function fnbody(src, name) {
  var m = new RegExp("\\n\\s*(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
function constLine(src, name) {
  var m = new RegExp("\\nconst " + name + "\\s*=[^\\n]*").exec(src);
  return m ? m[0].replace(/^\nconst /, "var ") : null;
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");

/* ---- the scripted world ---- */
var NOW = 1000000;
var Date = { now: function () { return NOW; } };
var VENUE = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
var HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ELSEWHERE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
var reads = [];
var DB = {
  vp_venues: function (q) { return /slug=eq\.test-alpha/.test(q) ? [{ id: VENUE }] : []; },
  vp_venue_staff: function (q) {
    if (/auth_user_id=eq\.aaaaaaaa/.test(q) && (!/venue_id=/.test(q) || q.indexOf("venue_id=eq." + VENUE) >= 0)) return [{ id: "s1", role: "host", venue_id: VENUE }];
    if (/auth_user_id=eq\.dddddddd/.test(q) && (!/venue_id=/.test(q) || q.indexOf("venue_id=eq." + OTHER) >= 0)) return [{ id: "s2", role: "owner", venue_id: OTHER }];
    return [];
  },
  vp_platform_admins: function (q) { return /auth_user_id=eq\.cccccccc/.test(q) ? [{ auth_user_id: ADMIN, role: "owner" }] : []; },
  vp_sessions: function (q) { return (/join_code=eq\.QQQQQQ/.test(q) && (!/venue_id=/.test(q) || q.indexOf(VENUE) >= 0)) ? [{ id: "sess", venue_id: VENUE }] : []; }
};
function sbGet(env, table, query) { reads.push(table + "?" + query); return Promise.resolve(DB[table] ? DB[table](query) : []); }
function httpError(status, msg) { var e = new Error(msg); e.status = status; return e; }
/* The sign in: "Bearer ok:<uid>" verifies as that user, anything else is refused the way
   verifyJwtHS256 refuses (token-refusal.test.js holds the real decoder to that). */
function verifyHostJwt(request) {
  var h = request.headers.get("Authorization") || "", m = /^Bearer\s+ok:(\S+)$/.exec(h);
  if (!m) return Promise.reject(httpError(401, "Invalid token"));
  return Promise.resolve(m[1]);
}
function sha256Hex(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return Promise.resolve("h" + h); }
function assertVenueActive() { return Promise.resolve(); }
var CODES = {};
function venueByCode(env, code) { return Promise.resolve(CODES[code] || null); }

/* ---- the real code ---- */
["UUID_RE", "JOIN_CODE_RE", "HANDOVER_MAX_PER_IP", "ROOM_FORMATS", "ROOM_SLUG_RE"].forEach(function (n) {
  var l = constLine(GAME, n); pass("the Worker still defines " + n, !!l); if (l) (0, eval)(l);
});
var rlMem = new Map(), rlSweptAt = 0;
["rateLimit", "requireStaff", "assertUuid", "enc", "roomHandoverAuth", "roomVenueCode", "roomVenueRooms", "handleRoomHandover", "roomHandOverAll", "roomStub"].forEach(function (n) {
  var b = fnbody(GAME, n); pass("the Worker still defines " + n, !!b); if (b) (0, eval)(b);
});
pass("the router passes roomHandoverAuth to the handover route",
     /path === '\/room\/handover'\)\s*return await handleRoomHandover\(request, env, json, roomHandoverAuth\)/.test(GAME));

function URL(u) {
  var m = /^[a-z]+:\/\/[^\/]+(\/[^?]*)?(\?(.*))?$/.exec(u);
  this.pathname = (m && m[1]) || "/";
  var q = {}; ((m && m[3]) || "").split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
  this.searchParams = { get: function (k) { return q.hasOwnProperty(k) ? q[k] : null; } };
}
function Response(body, init) { this.status = (init && init.status) || 200; this._json = body ? JSON.parse(body) : null; }
Response.prototype.json = function () { return Promise.resolve(this._json); };
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }
var ROOM_NAME_RE = /^[A-Za-z0-9-]{3,90}$/;
function req(url, auth, ip) {
  var h = { "cf-connecting-ip": ip || "203.0.113.7" };
  if (auth) h.Authorization = auth;
  return { url: url, method: "POST", headers: { get: function (k) { return h.hasOwnProperty(k) ? h[k] : null; } } };
}
var roomCalls = [];
var ENV = { IP_HASH_SALT: "t", ROOM: { idFromName: function (n) { return n; },
  get: function (id) { return { fetch: function (u) { roomCalls.push(id + " " + u); return Promise.resolve(json(/\/ask$/.test(u) ? { ok: true, asked: 1 } : { ok: true, closed: 2 })); } }; } } };

(async function () {
  var five = roomVenueRooms("test-alpha");
  CODES[five[0].slice(3)] = VENUE;
  var bingo = five[0];
  function fresh() { rlMem.clear(); roomCalls = []; reads = []; }

  print("== who is signed ==");
  fresh();
  var a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo), ENV, bingo, "");
  pass("no Authorization header: not signed, and the database is not even asked", a.signed === false && reads.length === 0, JSON.stringify(a));
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer rubbish"), ENV, bingo, "");
  pass("a sign in that does not verify: not signed", a.signed === false);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + STRANGER), ENV, bingo, "test-alpha");
  pass("signed in, but staff nowhere: not signed", a.signed === false);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + ELSEWHERE), ENV, bingo, "test-alpha");
  pass("signed in as staff at ANOTHER venue: not signed for this one", a.signed === false);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST), ENV, bingo, "test-alpha");
  pass("the real caller, a console signed in as staff at the venue it names: signed", a.signed === true && a.user === HOST, JSON.stringify(a));
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST), ENV, bingo, "");
  pass("the same console with no venue named: the room's own code is the venue's, signed", a.signed === true);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + ELSEWHERE), ENV, bingo, "");
  pass("staff at another venue naming this venue's room by its code: not signed", a.signed === false);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + ADMIN), ENV, bingo, "test-alpha");
  pass("an HQ admin (View as): signed", a.signed === true);
  a = await roomHandoverAuth(req("https://w/room/handover?room=vp-QQQQQQ", "Bearer ok:" + HOST), ENV, "vp-QQQQQQ", "");
  pass("a session's own join code is found to be the venue's: signed", a.signed === true);
  a = await roomHandoverAuth(req("https://w/room/handover?room=vp-WWWWWW", "Bearer ok:" + ELSEWHERE), ENV, "vp-WWWWWW", "");
  pass("a room no venue owns (a TV paired by its own code) takes staff somewhere: signed", a.signed === true);
  a = await roomHandoverAuth(req("https://w/room/handover?room=vp-WWWWWW", "Bearer ok:" + STRANGER), ENV, "vp-WWWWWW", "");
  pass("and is refused to a sign in that is staff nowhere", a.signed === false);
  a = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST), ENV, bingo, "no-such-venue");
  pass("a venue that does not exist: not signed", a.signed === false);

  print("== a players' room goes with the venue only when it is the venue's ==");
  a = await roomHandoverAuth(req("https://w/room/handover?room=vp-QQQQQQ", "Bearer ok:" + HOST), ENV, "vp-QQQQQQ", "test-alpha");
  pass("this venue's session code: extra", a.signed === true && a.extra === true);
  a = await roomHandoverAuth(req("https://w/room/handover?room=vp-ZZZZZZ", "Bearer ok:" + HOST), ENV, "vp-ZZZZZZ", "test-alpha");
  pass("somebody else's room named beside this venue: not extra", a.signed === true && a.extra === false);

  print("== the rate limit, per network ==");
  fresh();
  var n = 0, first429 = -1;
  for (var i = 0; i < HANDOVER_MAX_PER_IP + 5; i++) {
    var r = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "", "198.51.100.9"), ENV, bingo, "");
    if (r.limited) { if (first429 < 0) first429 = i; } else n++;
  }
  pass("a burst from one network is cut off at HANDOVER_MAX_PER_IP a minute", n === HANDOVER_MAX_PER_IP && first429 === HANDOVER_MAX_PER_IP, n + " let through, first refused at " + first429);
  var sgn = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST, "198.51.100.9"), ENV, bingo, "test-alpha");
  pass("and a sign in does not get round it on the same network", sgn.limited === true);
  var other = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST, "192.0.2.44"), ENV, bingo, "test-alpha");
  pass("another network is not punished for it", other.signed === true);
  NOW += 61000;
  var later = await roomHandoverAuth(req("https://w/room/handover?room=" + bingo, "Bearer ok:" + HOST, "198.51.100.9"), ENV, bingo, "test-alpha");
  pass("a minute later the venue's own console is through again", later.signed === true);
  pass("HANDOVER_MAX_PER_IP leaves room for a venue: at least 12 a minute", HANDOVER_MAX_PER_IP >= 12);

  print("== end to end: the route with the real check ==");
  fresh();
  var u = await handleRoomHandover(req("https://w/room/handover?room=" + bingo + "&venue=test-alpha"), ENV, json, roomHandoverAuth);
  pass("an unsigned request is refused 401", u.status === 401 && u._json.handed_over === false, JSON.stringify(u._json));
  pass("and closes nothing: the venue's five rooms are only asked", roomCalls.length === 5 && roomCalls.every(function (c) { return /\/ask$/.test(c); }), roomCalls.join(" | "));
  fresh();
  var st = await handleRoomHandover(req("https://w/room/handover?room=" + bingo + "&venue=test-alpha", "Bearer ok:" + STRANGER), ENV, json, roomHandoverAuth);
  pass("a stranger with an account of their own is refused the same way", st.status === 401 && !roomCalls.some(function (c) { return /\/handover/.test(c); }));
  fresh();
  var ok2 = await handleRoomHandover(req("https://w/room/handover?room=" + bingo + "&venue=test-alpha", "Bearer ok:" + HOST), ENV, json, roomHandoverAuth);
  pass("the venue's own console hands all five rooms over, as before", ok2.status === 200 && ok2._json.rooms === 5 &&
       roomCalls.filter(function (c) { return /\/handover$/.test(c); }).length === 5, roomCalls.join(" | "));
  fresh();
  var last = null;
  for (var k = 0; k <= HANDOVER_MAX_PER_IP; k++) last = await handleRoomHandover(req("https://w/room/handover?room=" + bingo), ENV, json, roomHandoverAuth);
  pass("a burst through the route ends in 429", last.status === 429, String(last.status));

  print("");
  print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
  if (bad) throw new Error("room handover auth: " + bad + " failed");
})().catch(function (e) { print("CRASH " + (e && e.stack || e)); throw e; });
