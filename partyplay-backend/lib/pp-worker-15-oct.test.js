/* THE WORKER'S HALF OF THE 15 OCT FIXES, run from the real Worker source.

   The pages' half is in pp-realtime-auth.test.js and pp-fixes-15-oct.test.js. This one drives the
   Worker's fetch() with a small fake PostgREST that keeps tables, honours the filters these routes
   use, and REFUSES a column the table does not have, the way the live database does before
   migration 16 has been run. So "the Worker still works without the migration" is tested, not
   assumed.

   Run from the repo root:  jsc partyplay-backend/lib/pp-worker-15-oct.test.js */
function findUp(rel) {
  var tries = [rel, "../../" + rel, "../" + rel];
  for (var i = 0; i < tries.length; i++) { try { if (readFile(tries[i]).length > 50) return tries[i]; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
load(findUp("partyplay-backend/worker/_test-sha256.js"));

/* ---------------- platform stubs, the same as partyplay-api.test.js ---------------- */
var _seed = 4242;
globalThis.crypto = {
  getRandomValues: function (arr) { for (var i = 0; i < arr.length; i++) { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; arr[i] = _seed >>> 0; } return arr; },
  subtle: {
    importKey: function (fmt, keyBytes) { return Promise.resolve({ _k: bytesToStr(keyBytes) }); },
    sign: function (alg, key, msgBytes) { var mac = SHA.hmac(key._k, bytesToStr(msgBytes)); return Promise.resolve({ _bytes: mac, byteLength: mac.length }); }
  }
};
function bytesToStr(b) { var s = ""; var a = b._raw || b; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; }
globalThis.TextEncoder = function () { this.encode = function (s) { var o = SHA.utf8(s); o._raw = o; return o; }; };
var _origU8 = Uint8Array;
globalThis.Uint8Array = function (x) { if (x && x._bytes) return x._bytes; return new _origU8(x); };
globalThis.Response = function (body, init) {
  init = init || {};
  this._body = body; this.status = init.status || 200; this.ok = this.status < 400;
  var h = init.headers || {};
  this.headers = { _h: h, set: function (k, v) { this._h[k] = v; }, get: function (k) { return this._h[k] || this._h[k.toLowerCase()] || null; } };
  this.json = function () { return Promise.resolve(JSON.parse(this._body)); };
  this.text = function () { return Promise.resolve(String(this._body)); };
};
globalThis.URL = function (u) {
  var m = /^https?:\/\/[^\/]+(\/[^?#]*)?(\?[^#]*)?/.exec(u) || [];
  this.pathname = m[1] || "/";
  var q = (m[2] || "").replace(/^\?/, "");
  this.searchParams = { get: function (k) {
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) { var kv = parts[i].split("="); if (decodeURIComponent(kv[0]) === k) return decodeURIComponent(kv[1] || ""); }
    return null; } };
};
globalThis.URLSearchParams = function (o) { this.toString = function () { var p = []; for (var k in o) p.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); return p.join("&"); }; };
globalThis.console = { log: function () {} };

/* ---------------- a small PostgREST ---------------- */
var DB = { tables: {}, cols: {}, calls: [] };
function table(name, cols, rows) { DB.tables[name] = rows || []; DB.cols[name] = cols; }
function parseQ(q) {
  var f = [], opts = {};
  q.split("&").forEach(function (kv) {
    if (!kv) return; var i = kv.indexOf("="), k = decodeURIComponent(kv.slice(0, i)), v = decodeURIComponent(kv.slice(i + 1));
    if (k === "select" || k === "order" || k === "limit" || k === "on_conflict") opts[k] = v; else f.push([k, v]);
  });
  return { f: f, opts: opts };
}
function match(row, f) {
  return f.every(function (c) {
    var col = c[0], v = c[1], val = row[col];
    if (v === "is.null") return val == null;
    if (v === "not.is.null") return val != null;
    if (v.indexOf("eq.") === 0) return String(val) === v.slice(3);
    if (v.indexOf("gt.") === 0) return String(val) > v.slice(3);
    if (v.indexOf("lt.") === 0) return String(val) < v.slice(3);
    return true;
  });
}
function pgFetch(url, init) {
  var rest = url.split("/rest/v1/")[1], name = rest.split("?")[0], q = parseQ(rest.split("?")[1] || "");
  var method = (init && init.method) || "GET", body = init && init.body ? JSON.parse(init.body) : null;
  DB.calls.push({ method: method, table: name, q: q, body: body });
  var cols = DB.cols[name] || [], rows = DB.tables[name] || [];
  function bad(col) { return { status: 400, body: JSON.stringify({ code: "42703", message: "column " + name + "." + col + " does not exist" }) }; }
  var named = q.f.map(function (c) { return c[0]; });
  if (q.opts.select && q.opts.select !== "*") named = named.concat(q.opts.select.split(","));
  for (var i = 0; i < named.length; i++) if (cols.indexOf(named[i]) < 0) return bad(named[i]);
  if (method === "GET") {
    var out = rows.filter(function (r) { return match(r, q.f); });
    if (q.opts.limit) out = out.slice(0, +q.opts.limit);
    if (q.opts.select && q.opts.select !== "*") out = out.map(function (r) { var o = {}; q.opts.select.split(",").forEach(function (c) { o[c] = r[c] === undefined ? null : r[c]; }); return o; });
    return { status: 200, body: JSON.stringify(out) };
  }
  var list = Array.isArray(body) ? body : [body];
  for (var j = 0; j < list.length; j++) for (var k in list[j]) if (cols.indexOf(k) < 0)
    return { status: 400, body: JSON.stringify({ code: "PGRST204", message: "Could not find the '" + k + "' column of '" + name + "' in the schema cache" }) };
  if (method === "PATCH") {
    var hit = rows.filter(function (r) { return match(r, q.f); });
    hit.forEach(function (r) { for (var k2 in body) r[k2] = body[k2]; });
    return { status: 200, body: JSON.stringify(hit) };
  }
  if (method === "POST") {
    var made = list.map(function (r) { var o = { id: "id" + (rows.length + 1), created_at: new Date().toISOString() }; for (var k3 in r) o[k3] = r[k3]; rows.push(o); return o; });
    return { status: 201, body: JSON.stringify(made) };
  }
  return { status: 200, body: "[]" };
}
var OUT = [];   // everything that is not the database: Stripe, Resend
globalThis.fetch = function (url, init) {
  var r;
  if (/\/rest\/v1\//.test(url)) r = pgFetch(url, init);
  else { OUT.push({ url: url, init: init }); r = /stripe/.test(url) ? { status: 200, body: JSON.stringify({ id: "cs_test_" + OUT.length, url: "https://checkout.stripe.com/x" }) } : { status: 200, body: JSON.stringify({ id: "re_1" }) }; }
  return Promise.resolve(new Response(r.body, { status: r.status }));
};

var m = { exports: {} };
(new Function("module", "globalThis", readFile(findUp("partyplay-backend/lib/pp-licence.js"))))(m, globalThis);
globalThis.PPLicence = m.exports;
var tk = { exports: {} };
(new Function("module", "globalThis", readFile(findUp("partyplay-backend/lib/pp-ticket.js"))))(tk, globalThis);
var PPTicket = tk.exports;
var wsrc = readFile(findUp("partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js")).replace(/^export default/m, "globalThis.WORKER =");
(new Function(wsrc))();
var WK = globalThis.WORKER;
var ENV = { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_1DAY: "price_1", STRIPE_PRICE_3DAY: "price_3",
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc-secret", RESEND_API_KEY: "re_test", SITE_ORIGIN: "https://partyplay.com.au",
  ADMIN_KEY: "admin-key-for-tests" };
function req(method, path, body, headers) {
  return { method: method, url: "https://api.partyplay.com.au" + path,
    headers: { _h: headers || {}, get: function (k) { return this._h[k] || this._h[k.toLowerCase()] || null; } },
    json: function () { return Promise.resolve(body || {}); },
    text: function () { return Promise.resolve(typeof body === "string" ? body : JSON.stringify(body || {})); },
    formData: function () { return Promise.resolve({ get: function (k) { return (body || {})[k]; } }); } };
}
function call(method, path, body, headers) {
  var out = null, err = null;
  WK.fetch(req(method, path, body, headers), ENV).then(function (r) { out = r; }, function (e) { err = e; });
  for (var i = 0; i < 60; i++) drainMicrotasks();
  if (err) throw err;
  var j = null; try { j = JSON.parse(out._body); } catch (e) {}
  return { status: out.status, json: j, text: String(out._body) };
}
var ran = 0, bad = 0;
function ok(name, cond, saw) { ran++; if (cond) print("  ok   " + name); else { bad++; print("  FAIL " + name + (saw === undefined ? "" : "   saw: " + String(saw).slice(0, 300))); } }

var LIC_COLS_OLD = ["id", "code", "host_key", "status", "activated_at", "expires_at", "created_at", "days", "party_name", "buyer_name", "buyer_email",
  "buyer_mobile", "marketing_optin", "price_cents", "stripe_session_id", "followup_sent_at", "is_comp"];
var LIC_COLS = LIC_COLS_OLD.concat(["sign_kid", "sign_public_jwk", "sign_private_jwk", "checkout_ip"]);
var PLAYER_COLS_OLD = ["id", "licence_id", "nickname", "token", "joined_at"], PLAYER_COLS = PLAYER_COLS_OLD.concat(["pid"]);
var HK = "0123456789abcdef0123456789abcdef0123", CODE = "QZXKMP";
function fresh(migrated) {
  DB.calls = []; OUT = [];
  var now = Date.now();
  table("pp_licences", migrated ? LIC_COLS : LIC_COLS_OLD, [{ id: "L1", code: CODE, host_key: HK, status: "paid", days: 1,
    activated_at: new Date(now - 3600e3).toISOString(), expires_at: new Date(now + 20 * 3600e3).toISOString(), created_at: new Date(now - 86400e3).toISOString() }]);
  table("pp_players", migrated ? PLAYER_COLS : PLAYER_COLS_OLD, []);
  table("pp_subscribers", ["id", "email", "opted_in", "unsubscribed_at", "opted_in_at", "source"], []);
  table("pp_album_requests", ["id", "email", "sent_at"], []);
}
var PID_A = "k1_" + "a".repeat(32), PID_B = "k1_" + "b".repeat(32);
var JWK_PUB = { kty: "EC", crv: "P-256", x: "xxxxxxxx", y: "yyyyyyyy" }, JWK_PRIV = { kty: "EC", crv: "P-256", x: "xxxxxxxx", y: "yyyyyyyy", d: "dddddddd" };

print("== the party's key ==");
fresh(true);
var r = call("GET", "/party/signing/public?code=" + CODE);
ok("a party with no key says so (screens then render as before)", r.status === 200 && r.json.exists === false, r.text);
ok("minting needs the host key", call("POST", "/party/signing/mint", { code: CODE, key: "wrong-key-wrong-key-wrong", kid: "p1_abcdefghij", public_jwk: JWK_PUB, private_jwk: JWK_PRIV }).status === 403);
ok("and a real key", call("POST", "/party/signing/mint", { code: CODE, key: HK, kid: "p1_abcdefghij", public_jwk: { kty: "RSA" }, private_jwk: JWK_PRIV }).status === 400);
r = call("POST", "/party/signing/mint", { code: CODE, key: HK, kid: "p1_abcdefghij", public_jwk: JWK_PUB, private_jwk: JWK_PRIV });
ok("CONTROL: the host's console mints one", r.status === 200 && r.json.exists && r.json.kid === "p1_abcdefghij", r.text);
var patch = DB.calls.filter(function (c) { return c.method === "PATCH" && c.table === "pp_licences"; })[0];
ok("written only onto a party with no key yet, so two consoles cannot make two", !!patch && patch.q.f.some(function (c) { return c[0] === "sign_kid" && c[1] === "is.null"; }));
r = call("POST", "/party/signing/mint", { code: CODE, key: HK, kid: "p1_zzzzzzzzzz", public_jwk: JWK_PUB, private_jwk: JWK_PRIV });
ok("a second console is handed the first one's key", r.json.kid === "p1_abcdefghij", r.text);
r = call("GET", "/party/signing/public?code=" + CODE);
ok("anybody may have the public half", r.json.exists === true && r.json.public_jwk.x === "xxxxxxxx");
ok("and ONLY the public half", r.json.private_jwk === undefined && !/dddddddd/.test(r.text), r.text);
ok("the private half needs the host key", call("POST", "/party/signing/private", { code: CODE, key: "wrong-key-wrong-key-wrong" }).status === 403);
r = call("POST", "/party/signing/private", { code: CODE, key: HK });
ok("CONTROL: with it, the console gets both", r.json.exists && r.json.private_jwk.d === "dddddddd", r.text);
fresh(false);
ok("before migration 16 the public route answers \"no key\" rather than failing", call("GET", "/party/signing/public?code=" + CODE).json.exists === false);
ok("and minting answers \"not set up\" rather than failing", call("POST", "/party/signing/mint", { code: CODE, key: HK, kid: "p1_abcdefghij", public_jwk: JWK_PUB, private_jwk: JWK_PRIV }).json.exists === false);

print("\n== joining with a key, and the guest list ==");
fresh(true);
r = call("POST", "/join", { code: CODE, nickname: "Alice", pid: PID_A });
ok("a join keeps the phone's key fingerprint", r.status === 200 && DB.tables.pp_players[0].pid === PID_A, r.text);
r = call("POST", "/join", { code: CODE, nickname: "Mallory", pid: PID_A });
ok("a second guest cannot take a pid somebody already holds", DB.tables.pp_players[1].pid == null, JSON.stringify(DB.tables.pp_players[1]));
var tokA = DB.tables.pp_players[0].token;
r = call("POST", "/join", { code: CODE, nickname: "Alice", prev: tokA, pid: PID_B, rejoin: true });
ok("a returning phone with a new key updates its own row", r.json.back === true && DB.tables.pp_players[0].pid === PID_B, r.text);
var before = DB.tables.pp_players.length;
r = call("POST", "/join", { code: CODE, nickname: "Ghost", prev: "NOTATOKENNOTATOKENNOTATO", pid: PID_A, rejoin: true });
ok("a re-registration from a phone that was never a guest adds NOBODY", r.status === 404 && DB.tables.pp_players.length === before, r.text);
ok("the guest list needs the host key", call("GET", "/party/players?code=" + CODE + "&key=wrong-key-wrong-key-wrong").status === 403);
r = call("GET", "/party/players?code=" + CODE + "&key=" + HK);
var al = r.json.players.filter(function (p) { return p.name === "Alice"; })[0];
ok("it lists who the Worker let in, with their key", r.json.players.length === 2 && al.pid === PID_B, r.text);
ok("and the ticket seed the console checks a bingo claim with", al.tseed === PPTicket.seed(tokA), al.tseed + " vs " + PPTicket.seed(tokA));
ok("never the token, which is the guest's album key", !/token/.test(r.text) && r.text.indexOf(tokA) < 0, r.text);
fresh(false);
r = call("POST", "/join", { code: CODE, nickname: "Bea", pid: PID_A });
ok("before migration 16 a join with a key still works (the key is just not kept)", r.status === 200 && DB.tables.pp_players.length === 1, r.text);
r = call("GET", "/party/players?code=" + CODE + "&key=" + HK);
ok("and so does the guest list, without keys", r.status === 200 && r.json.players.length === 1 && r.json.players[0].pid === null, r.text);

print("\n== a limit on checkouts from one address ==");
fresh(true);
var IPH = { "CF-Connecting-IP": "203.0.113.9" };
var made = 0;
for (var i = 0; i < 6; i++) { r = call("POST", "/checkout", { name: "Buyer " + i, email: "b" + i + "@example.com", days: 1 }, IPH); if (r.status === 200) made++; }
ok("CONTROL: six bookings from one address in an hour go through", made === 6, made);
var stripeBefore = OUT.filter(function (o) { return /stripe/.test(o.url); }).length;
r = call("POST", "/checkout", { name: "Buyer 7", email: "b7@example.com", days: 1 }, IPH);
ok("the seventh is refused, politely", r.status === 429 && /Too many bookings/.test(r.json.error), r.text);
ok("and makes no pending licence and no Stripe session", OUT.filter(function (o) { return /stripe/.test(o.url); }).length === stripeBefore &&
   DB.tables.pp_licences.length === 7, DB.tables.pp_licences.length);
ok("the address is kept only as a keyed hash", DB.tables.pp_licences.slice(1).every(function (l) { return /^[0-9a-f]{24}$/.test(l.checkout_ip) && l.checkout_ip.indexOf("203") < 0; }));
r = call("POST", "/checkout", { name: "Someone else", email: "s@example.com", days: 1 }, { "CF-Connecting-IP": "198.51.100.4" });
ok("somebody at another address is not affected", r.status === 200, r.text);
fresh(false);
r = call("POST", "/checkout", { name: "Pre migration", email: "p@example.com", days: 1 }, { "CF-Connecting-IP": "192.0.2.1" });
ok("before migration 16 a checkout still goes through", r.status === 200 && DB.tables.pp_licences.length === 2, r.text);

print("\n== unsubscribe links carry proof they came from us ==");
fresh(true);
DB.tables.pp_licences[0].expires_at = new Date(Date.now() - 9 * 86400e3).toISOString();
DB.tables.pp_licences[0].buyer_email = "host@example.com"; DB.tables.pp_licences[0].buyer_name = "Host";
r = call("POST", "/admin/followups", { key: ENV.ADMIN_KEY });
var mail = OUT.filter(function (o) { return /resend/.test(o.url); })[0];
var html = mail ? JSON.parse(mail.init.body).html : "";
var lm = /\/unsubscribe\?e=([^&"]+)&amp;t=([0-9a-f]+)|\/unsubscribe\?e=([^&"]+)&t=([0-9a-f]+)/.exec(html);
ok("the follow-up email's unsubscribe link carries a token", !!lm, html.slice(-400));
var tok = lm ? (lm[2] || lm[4]) : "";
var nudge = /async function sendNudgeEmail[\s\S]*?\n\}/.exec(wsrc);
ok("so does the expiry reminder's", !!nudge && /\/unsubscribe\?e=' \+ encodeURIComponent\(l\.buyer_email\) \+\s*'&t=' \+ \(await unsubToken\(env, l\.buyer_email\)\)/.test(nudge[0]));
r = call("POST", "/unsubscribe", { email: "host@example.com", t: "0000000000000000deadbeefdeadbeef" }, { "content-type": "application/json" });
ok("a made-up token is refused, and nothing is written", r.status === 403 && !DB.tables.pp_subscribers.length, r.text);
r = call("POST", "/unsubscribe", { email: "victim@example.com", t: tok }, { "content-type": "application/json" });
ok("somebody else's token is refused for this address", r.status === 403 && !DB.tables.pp_subscribers.length, r.text);
r = call("POST", "/unsubscribe", { email: "host@example.com", t: tok }, { "content-type": "application/json" });
ok("CONTROL: the email's own token takes them off", r.status === 200 && DB.tables.pp_subscribers.length === 1 && DB.tables.pp_subscribers[0].unsubscribed_at, r.text);
r = call("POST", "/unsubscribe", { email: "old-link@example.com" }, { "content-type": "application/json" });
ok("a link from an email sent before tokens still works after the click (Spam Act: 30 days at least)", r.status === 200 && DB.tables.pp_subscribers.length === 2, r.text);
r = call("GET", "/unsubscribe?e=host%40example.com&t=" + tok);
ok("the Worker's own page asks first, and its button carries the token", r.status === 200 && /Yes, unsubscribe/.test(r.text) && r.text.indexOf('name="t" value="' + tok + '"') > 0, r.text.slice(0, 200));

/* THE ONE-CLICK HEADERS (26 Oct 2026, Dean: "I need unsubscribe links on ALL marketing emails we
   send"). Gmail's and Apple Mail's own Unsubscribe button POSTs to the https address in
   List-Unsubscribe, so that address has to be the Worker, carry the same token, and work with the
   RFC 8058 body and nothing else. */
var hdrs = mail ? (JSON.parse(mail.init.body).headers || {}) : {};
var lu = hdrs["List-Unsubscribe"] || "";
ok("the follow-up carries List-Unsubscribe with the Worker's https address, the token, and the mailto",
   lu === "<https://partyplay-api.dean-tindale.workers.dev/unsubscribe?e=host%40example.com&t=" + tok + ">, <mailto:hello@partyplay.com.au?subject=unsubscribe>", lu);
ok("and List-Unsubscribe-Post: List-Unsubscribe=One-Click", hdrs["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", JSON.stringify(hdrs));
ok("so does the expiry reminder", !!nudge && /headers: await ppUnsubHeaders\(env, l\.buyer_email\)/.test(nudge[0]));
DB.tables.pp_subscribers = [];
var oneClick = lu.replace(/^<https:\/\/[^\/]+/, "").replace(/>.*$/, "");
r = call("POST", oneClick, "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded" });
ok("the mail app's one-click POST to that address takes them off", r.status === 200 && DB.tables.pp_subscribers.length === 1 &&
   DB.tables.pp_subscribers[0].email === "host@example.com" && DB.tables.pp_subscribers[0].unsubscribed_at, r.text.slice(0, 200));

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
