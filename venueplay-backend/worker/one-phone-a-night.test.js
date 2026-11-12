/* ONE PHONE IS ONE PLAYER A NIGHT, ACROSS GAMES (live play on The Mini Bar, 12 Nov 2026).

   Dean played trivia and then musical bingo on two phones at a two-player venue. The console said
   Players (4), "2 over the 2 your plan includes. The extra will be charged". His rule: one phone is
   one player for the night, whatever games it plays. This suite RUNS the shipped charge path
   (chargeNightOverage, applyOverageCharge and what they call, lifted out of the Worker) against a
   fake Supabase holding several sessions of one venue and a fake Stripe that records every POST,
   and says what was billed:

     a phone that plays trivia, then musical bingo, then bingo the same night   one player
     two phones                                                                 two players
     the same phones the NEXT night                                             counted again
     a phone that re-joins after a reconnect (two rows, one device id)          one player
     a second phone (or browser) for the same person                            two players (cannot be told apart)
     a new phone in the second game                                             only that one is billed
     the earlier games cannot be read                                           the old per-session count

   Pricing is not this suite's business ($2, $1 the third night in a row: overage-charge.test.js).

   Run: jsc venueplay-backend/worker/one-phone-a-night.test.js
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
var NAMES = ["isDemoSession", "chargeNightOverage", "applyOverageCharge", "playerIdsWhoPlayed", "countPlayersWhoPlayed",
             "countPlayers", "overageCeiling", "brisbaneNightKey", "venueInFreeMonth", "openInvoice", "settleInvoice",
             "stripeGet", "stripePost", "recordOverageCrash", "subscriptionPaymentMethod"];
var NEW_NAMES = ["earlierNightPlayers", "playerKeysWhoPlayed"].filter(function (n) { return !!lift(GAME, n); });
NAMES = NAMES.concat(NEW_NAMES);
var missing = NAMES.filter(function (n) { return !lift(GAME, n); });
pass("every function in the charge path came out of the shipped Worker", missing.length === 0, missing.join(", "));
if (missing.length) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }
var consts = /const OVERAGE_ACK_MARGIN = (\d+);[\s\S]*?const OVERAGE_ABSOLUTE_MAX = (\d+);/.exec(GAME);
pass("the approval margin constants came out too", !!consts);

/* jsc has no URLSearchParams; the Worker builds every Stripe body with one. */
function URLSearchParams() { this._p = []; }
URLSearchParams.prototype.set = function (k, v) { this._p = this._p.filter(function (kv) { return kv[0] !== k; }); this._p.push([k, String(v)]); };
URLSearchParams.prototype.toString = function () { return this._p.map(function (kv) { return encodeURIComponent(kv[0]) + "=" + encodeURIComponent(kv[1]); }).join("&"); };

/* ---- the fake world ------------------------------------------------------------- */
var logged = [];
var console = { log: function (m) { logged.push(String(m)); } };
var world, posts, patches, inserts, gets;
function enc(x) { return encodeURIComponent(x); }
function reset(w) {
  world = w; posts = []; patches = []; inserts = []; gets = []; logged = [];
}
function sbGet(env, table, query) {
  gets.push(table + "?" + query);
  var rows = world.tables[table] || [];
  if (world.sessionsReadFails && table === "vp_sessions") return Promise.reject(new Error("PostgREST 503 (test)"));
  var m = /(?:^|&)(id|session_id|game_id)=eq\.([^&]+)/.exec(query);
  if (m) rows = rows.filter(function (r) { return String(r[m[1]]) === decodeURIComponent(m[2]); });
  var vq = /(?:^|&)venue_id=eq\.([^&]+)/.exec(query);
  if (vq) rows = rows.filter(function (r) { return String(r.venue_id) === decodeURIComponent(vq[1]); });
  var inn = /(?:^|&)game_id=in\.\(([^)]*)\)/.exec(query);
  if (inn) { var ids = inn[1].split(","); rows = rows.filter(function (r) { return ids.indexOf(String(r.game_id)) !== -1; }); }
  // played_at=not.is.null and kicked=eq.false, since migration 87: a fake that ignored them
  // made every phone that opened the page look alive (22 Sep 2026).
  if (/(?:^|&)played_at=not\.is\.null/.test(query)) rows = rows.filter(function (r) { return r.played_at != null; });
  if (/(?:^|&)kicked=eq\.false/.test(query)) rows = rows.filter(function (r) { return !r.kicked; });
  return Promise.resolve(rows.map(function (r) { return Object.assign({}, r); }));
}
function sbGetAll(env, table, query) { return sbGet(env, table, query); }
function sbPatch(env, table, query, body) { patches.push({ table: table, query: query, body: body }); return Promise.resolve([]); }
function sbInsert(env, table, obj) { inserts.push({ table: table, row: obj }); return Promise.resolve([]); }
function upliftPlan(env, venue, acct, newMax) { world.uplifts = (world.uplifts || 0) + 1; return Promise.resolve(world.upliftResult === undefined ? newMax : world.upliftResult); }
function fetch(url, opts) {
  var path = url.replace("https://api.stripe.com/v1/", "");
  var method = (opts && opts.method) || "GET";
  var headers = (opts && opts.headers) || {};
  var body = {};
  if (opts && opts.body) opts.body.split("&").forEach(function (kv) { var p = kv.split("="); body[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
  var reply;
  if (method === "GET" && /^subscriptions\//.test(path)) reply = world.sub;
  else if (method === "GET" && /^customers\//.test(path)) reply = world.customer || { id: "cus_JESS", invoice_settings: { default_payment_method: null }, default_source: null };
  else if (method === "POST" && path === "invoiceitems") {
    posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] });
    /* Stripe refuses a parameter it does not know, and the whole item with it. This is the
       documented list for POST /v1/invoiceitems (docs.stripe.com/api/invoiceitems/create, read
       11 Sep 2026). `unit_amount` is NOT on it, and that is exactly what the first live overage
       night sent. */
    var known = ["amount", "currency", "customer", "customer_account", "description", "discountable", "discounts", "invoice",
                 "metadata", "period", "price_data", "pricing", "quantity", "quantity_decimal", "subscription",
                 "tax_behavior", "tax_code", "tax_rates", "unit_amount_decimal"];
    var unknown = Object.keys(body).filter(function (k) { return known.indexOf(k.replace(/\[.*$/, "")) === -1; });
    if (unknown.length) reply = { error: { message: "Received unknown parameter: " + unknown[0] } };
    else if (body.invoice !== undefined && body.invoice !== "in_test") reply = { error: { message: "No such invoice: " + body.invoice } };
    else if (body.invoice !== undefined && body.subscription !== undefined) reply = { error: { message: "You may not specify both invoice and subscription" } };
    else if (body.unit_amount_decimal !== undefined && body.quantity === undefined && body.quantity_decimal === undefined) reply = { error: { message: "unit_amount_decimal needs a quantity" } };
    else reply = world.itemReply || { id: "ii_test", object: "invoiceitem" };
  }
  else if (method === "POST" && path === "invoices") { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.invoiceReply || { id: "in_test", amount_due: 200, status: "draft" }; }
  else if (method === "POST" && /^invoices\/in_test\/finalize$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.finalizeReply || { id: "in_test", status: "open" }; }
  else if (method === "POST" && /^invoices\/in_test\/pay$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.payReply || { id: "in_test", status: "paid" }; }
  else if (method === "POST" && /^invoices\/in_test\/send$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = world.sendReply || { id: "in_test", status: "open" }; }
  else if (method === "POST" && /^invoices\/in_test\/void$/.test(path)) { posts.push({ path: path, body: body, idem: headers["Idempotency-Key"] }); reply = { id: "in_test", status: "void" }; }
  else reply = { error: { message: "unexpected call " + method + " " + path } };
  return Promise.resolve({ ok: !reply.error, status: reply.error ? 400 : 200, json: function () { return Promise.resolve(reply); } });
}

["session", "venue", "sub", "acct", "o", "founding", "peak", "cap"].forEach(function (n) {
  pass("nothing in this suite is called `" + n + "` (it would mask a scope bug in the Worker)", typeof this[n] === "undefined");
}, this);

/* Bring the real code in. eval at top level so the functions land in this scope. */
eval("var OVERAGE_ACK_MARGIN = " + consts[1] + "; var OVERAGE_ABSOLUTE_MAX = " + consts[2] + ";\n" +
     NAMES.map(function (n) { return lift(GAME, n); }).join("\n"));


var ENV = { STRIPE_SECRET_KEY: "sk_test_fake", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k" };
var VENUE = "6b1d4c2e-1f0a-4d7b-9c55-0a1b2c3d4e5f", FOUNDING = "a9e8d7c6-b5a4-4321-8fed-cba987654321";
var OLD = new Date(Date.now() - 45 * 86400000).toISOString();   // out of the free month
/* Thursday 12 Nov 2026, Brisbane: trivia opens 19:00, musical bingo 20:15, bingo 21:30, then Friday 19:00. */
var T_TRIVIA = "2026-11-12T09:00:00.000+00:00", T_MUSICAL = "2026-11-12T10:15:00.000+00:00",
    T_BINGO = "2026-11-12T11:30:00.000+00:00", T_NEXT = "2026-11-13T09:00:00.000+00:00",
    T_LATE = "2026-11-12T15:30:00.000+00:00";   // 1:30am Friday, still Thursday's night (2am rollover)

/* A world of sessions. Each session: { id, at, phones: [device ids, null for a row with no device id], fmt } */
function worldOf(sessions, o) {
  o = o || {};
  var t = { vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_trivia_answers: [] };
  sessions.forEach(function (s) {
    t.vp_sessions.push({ id: s.id, venue_id: VENUE, opened_at: s.at, created_at: s.at, started_at: s.at, is_demo: !!s.demo });
    var gid = "g-" + s.id;
    t.vp_games.push({ id: gid, session_id: s.id });
    s.phones.forEach(function (dev, i) {
      var pid = s.id + "-p" + i;
      t.vp_players.push({ id: pid, session_id: s.id, device_id: dev, kicked: false });
      if (s.fmt === "trivia") t.vp_trivia_answers.push({ game_id: gid, player_id: pid });
      else t.vp_cards.push({ game_id: gid, player_id: pid });
    });
  });
  t.vp_venues = [{ id: VENUE, name: "The Mini Bar", founding_id: FOUNDING, max_players: o.cap || 1, pending_players: null,
                   overage_streak: o.streak || 0, overage_streak_peaks: o.peaks || [], overage_streak_day: o.streakDay || null, created_at: OLD }];
  t.venueplay_founding = [{ id: FOUNDING, stripe_customer_id: "cus_MINI", stripe_subscription_id: "sub_1", bill_by_invoice: false }];
  return { sub: { id: "sub_1", status: "active", customer: "cus_MINI", metadata: { tier: "standard" }, items: { data: [{ id: "si_1", quantity: 1 }] },
                  default_payment_method: "pm_MINI" },
           tables: t, sessionsReadFails: !!o.sessionsReadFails };
}
function mkSess(id, at, cap) {
  return { id: id, venue_id: VENUE, plan_cap_at_start: cap || 1, status: "finished", opened_at: at, created_at: at,
           overage_approved: true, overage_approved_count: 10 };
}
/* Close one session the way both callers do; a throw is a red check. Returns the players billed (0 = nothing). */
function close(id, at, cap, label) {
  posts = []; patches = [];
  var threw = null;
  return chargeNightOverage(ENV, mkSess(id, at, cap)).catch(function (e) { threw = e; }).then(function () {
    pass(label + ": the charge path did not throw", threw === null, threw ? String(threw && (threw.message || threw)).slice(0, 160) : "");
    var it = posts.filter(function (p) { return p.path === "invoiceitems"; });
    return it.length ? Number(it[0].body.quantity) : 0;
  });
}
function streakPatch() { var p = patches.filter(function (x) { return x.table === "vp_venues"; }); return p.length ? p[p.length - 1].body : null; }

var steps = [];
function scenario(name, fn) { steps.push(function () { print("\n" + name); return fn(); }); }

scenario("one phone plays trivia, then musical bingo, then bingo, the same night (plan of 1)", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA"], fmt: "musical" },
                 { id: "s-bin", at: T_BINGO, phones: ["devA"], fmt: "bingo" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function (n) {
    pass("trivia: one phone on a plan of one is not over", n === 0, "billed " + n);
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("musical bingo: the same phone is still one player, nothing billed", n === 0, "billed " + n);
    return close("s-bin", T_BINGO, 1, "bingo");
  }).then(function (n) {
    pass("bingo: the same phone a third time is still one player, nothing billed", n === 0, "billed " + n);
  });
});

scenario("two phones play trivia then musical bingo then bingo (plan of 1, The Mini Bar's night)", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA", "devB"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA", "devB"], fmt: "musical" },
                 { id: "s-bin", at: T_BINGO, phones: ["devB", "devA"], fmt: "bingo" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function (n) {
    pass("trivia: two phones on a plan of one bill ONE extra player", n === 1, "billed " + n);
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("musical bingo: the same two phones are not billed again", n === 0, "billed " + n);
    var sp = streakPatch();
    pass("and the second game leaves the big-night run alone (not a quiet night, not another big one)", sp === null, JSON.stringify(sp));
    return close("s-bin", T_BINGO, 1, "bingo");
  }).then(function (n) {
    pass("bingo: the same two phones are not billed a third time", n === 0, "billed " + n);
  });
});

scenario("a NEW phone turns up for the second game", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA", "devB"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA", "devB", "devC"], fmt: "musical" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function (n) {
    pass("trivia: one extra", n === 1, "billed " + n);
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("musical bingo: only the NEW phone is billed (1, not 2)", n === 1, "billed " + n);
  });
});

scenario("the same two phones the NEXT night", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA", "devB"], fmt: "trivia" },
                 { id: "s-nxt", at: T_NEXT, phones: ["devA", "devB"], fmt: "trivia" }]));
  return close("s-tri", T_TRIVIA, 1, "Thursday").then(function (n) {
    pass("Thursday: one extra", n === 1, "billed " + n);
    return close("s-nxt", T_NEXT, 1, "Friday");
  }).then(function (n) {
    pass("Friday is a new night: the same phones count again, one extra", n === 1, "billed " + n);
  });
});

scenario("a game that runs past midnight is still the same night (2am rollover)", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA", "devB"], fmt: "trivia" },
                 { id: "s-late", at: T_LATE, phones: ["devA", "devB"], fmt: "musical" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function () {
    return close("s-late", T_LATE, 1, "musical at 1:30am");
  }).then(function (n) {
    pass("1:30am belongs to Thursday's night: not billed again", n === 0, "billed " + n);
  });
});

scenario("a phone that re-joins after a reconnect (two rows, one device id)", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA", "devA"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA", "devA"], fmt: "musical" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function (n) {
    pass("trivia: one phone, two rows, is one player", n === 0, "billed " + n);
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("musical bingo: still one player", n === 0, "billed " + n);
  });
});

scenario("a second phone (or another browser) for the same person", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA", "devA2"], fmt: "musical" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function () {
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("a different device id is a different player (it cannot be told apart): one extra", n === 1, "billed " + n);
  });
});

scenario("different people in different games: never billed MORE than before", function () {
  reset(worldOf([{ id: "s-tri", at: T_TRIVIA, phones: ["devA"], fmt: "trivia" },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devB"], fmt: "musical" }]));
  return close("s-tri", T_TRIVIA, 1, "trivia").then(function () {
    return close("s-mus", T_MUSICAL, 1, "musical bingo");
  }).then(function (n) {
    pass("a game inside its own plan is not billed for phones from another game (the host was never shown an extra)", n === 0, "billed " + n);
  });
});

scenario("a try-it demo earlier tonight never counts", function () {
  reset(worldOf([{ id: "s-demo", at: T_TRIVIA, phones: ["devA", "devB"], fmt: "trivia", demo: true },
                 { id: "s-mus", at: T_MUSICAL, phones: ["devA", "devB"], fmt: "musical" }]));
  return close("s-mus", T_MUSICAL, 1, "musical bingo").then(function (n) {
    pass("the real game is billed on its own phones (one extra), the demo did not use them up", n === 1, "billed " + n);
  });
});

scenario("the earlier games cannot be read: the old per-session count, never an outage", function () {
  reset(worldOf([{ id: "s-mus", at: T_MUSICAL, phones: ["devA", "devB"], fmt: "musical" }], { sessionsReadFails: true }));
  return close("s-mus", T_MUSICAL, 1, "musical bingo").then(function (n) {
    pass("billed exactly as before: one extra", n === 1, "billed " + n);
  });
});

steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  print("");
  print(bad ? bad + " OF " + ran + " CHECKS FAILED" : "ALL " + ran + " CHECKS PASSED");
}, function (e) {
  print("  HARNESS FAILURE: " + (e && (e.stack || e.message) || e));
  print("");
  print((bad + 1) + " OF " + (ran + 1) + " CHECKS FAILED");
});
