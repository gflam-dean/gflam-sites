/* GREAT MINDS: NOBODY BUT THE HOST CAN READ THE ANSWERS BEFORE THE PARTY (15 Oct 2026).

   The family boards, answers and all, were a public script (/lib/pp-great-minds-boards.js) that
   run.html loaded and anybody else could fetch. 22 of them are VenuePlay Punters Reckon boards too,
   so it also gave away the pub game's answers. They now live in the PartyPlay Worker (PP_GM_BOARDS)
   and run.html asks GET /party/gm/boards with the host key. The runner's half (it asks, once, and
   plays what it was sent) is in pp-great-minds.test.js; this is the Worker's half and the pages'.

   RUNS the Worker source's fetch() with a fake PostgREST holding one paid party, and reads every
   page a guest, the telly or a stranger can load, and every script those pages load.

   Run from the repo root:  jsc partyplay-backend/lib/pp-gm-boards.test.js
   With -- --reply it also prints the Worker's real reply on a line starting REPLY, for a play-test. */
function findUp(rel) {
  var tries = [rel, "../../" + rel, "../" + rel];
  for (var i = 0; i < tries.length; i++) { try { if (readFile(tries[i]).length > 50) return tries[i]; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
var ran = 0, bad = 0;
function ok(name, cond, saw) { ran++; if (cond) print("  ok   " + name); else { bad++; print("  FAIL " + name + (saw === undefined ? "" : "   saw: " + String(saw).slice(0, 300))); } }

/* ---------------- just enough platform for the Worker ---------------- */
globalThis.crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) & 255; return a; } };
globalThis.Response = function (body, init) {
  init = init || {};
  this._body = body; this.status = init.status || 200; this.ok = this.status < 400;
  var h = init.headers || {};
  this.headers = { _h: h, set: function (k, v) { this._h[k] = v; }, get: function (k) { return this._h[k] || null; } };
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
globalThis.console = { log: function () {} };
var HK = "0123456789abcdef0123456789abcdef0123", CODE = "QZXKMP";
var LICENCES = [{ id: "L1", code: CODE, host_key: HK, status: "paid", days: 1 }, { id: "L2", code: "PNDNGX", host_key: HK, status: "pending", days: 1 }];
var READS = [];
globalThis.fetch = function (url) {
  READS.push(String(url));
  var rest = String(url).split("/rest/v1/")[1] || "", name = rest.split("?")[0], q = rest.split("?")[1] || "", body = "[]";
  if (name === "pp_licences") {
    var code = (/code=eq\.([^&]+)/.exec(q) || [])[1], st = (/status=eq\.([^&]+)/.exec(q) || [])[1];
    body = JSON.stringify(LICENCES.filter(function (l) { return l.code === code && (!st || l.status === st); }));
  }
  return Promise.resolve(new Response(body, { status: 200 }));
};
var m = { exports: {} };
(new Function("module", "globalThis", readFile(findUp("partyplay-backend/lib/pp-licence.js"))))(m, globalThis);
globalThis.PPLicence = m.exports;
var WSRC = readFile(findUp("partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js"));
(new Function(WSRC.replace(/^export default/m, "globalThis.WORKER =")))();
var WK = globalThis.WORKER;
var ENV = { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_1DAY: "price_1", STRIPE_PRICE_3DAY: "price_3",
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc-secret", RESEND_API_KEY: "re_test", SITE_ORIGIN: "https://partyplay.com.au",
  ADMIN_KEY: "admin-key-for-tests" };
function call(method, path) {
  var out = null, err = null;
  var r = { method: method, url: "https://api.partyplay.com.au" + path, headers: { get: function (k) { return /origin/i.test(k) ? "https://partyplay.com.au" : null; } } };
  WK.fetch(r, ENV).then(function (x) { out = x; }, function (e) { err = e; });
  for (var i = 0; i < 60; i++) drainMicrotasks();
  if (err) throw err;
  var j = null; try { j = JSON.parse(out._body); } catch (e) {}
  return { status: out.status, json: j, text: String(out._body), headers: out.headers._h };
}
var _bs = WSRC.indexOf("\nconst PP_GM_BOARDS = [");
var BOARDS = _bs < 0 ? [] : (new Function(WSRC.slice(_bs, WSRC.indexOf("\n];\n", _bs) + 3) + "\nreturn PP_GM_BOARDS;"))();
// A reply gives a board away if it names its question or three of its answers.
function anyAnswer(text) { return BOARDS.some(function (b) { return text.indexOf(b.q) >= 0 || b.answers.filter(function (a) { return text.indexOf('"' + a.a + '"') >= 0; }).length >= 3; }); }

print("== the PartyPlay Worker hands the boards to the host key, and to nobody else ==");
ok("the boards are in the Worker: at least 30, each adding to 100", BOARDS.length >= 30 && BOARDS.every(function (b) { return b.answers.reduce(function (t, a) { return t + a.pts; }, 0) === 100; }), BOARDS.length);
var r = call("GET", "/party/gm/boards?code=" + CODE);
ok("no host key: refused, and not one answer in the reply", r.status === 403 && !anyAnswer(r.text), r.status + " " + r.text.slice(0, 120));
r = call("GET", "/party/gm/boards?code=" + CODE + "&key=" + "f".repeat(36));
ok("a wrong host key: refused, no answers", r.status === 403 && !anyAnswer(r.text), r.status + " " + r.text.slice(0, 120));
r = call("GET", "/party/gm/boards?code=ZZZZZZ&key=" + HK);
ok("a party that does not exist: 404, no answers", r.status === 404 && !anyAnswer(r.text), r.status + " " + r.text.slice(0, 120));
r = call("GET", "/party/gm/boards?code=PNDNGX&key=" + HK);
ok("an unpaid party: 404, no answers", r.status === 404 && !anyAnswer(r.text), r.status + " " + r.text.slice(0, 120));
READS = [];
var good = call("GET", "/party/gm/boards?code=" + CODE + "&key=" + HK);
ok("the host key: 200 with every board and its answers", good.status === 200 && good.json && JSON.stringify(good.json.boards) === JSON.stringify(BOARDS), good.status + " " + good.text.slice(0, 120));
ok("one read, of the party's own row: no table of boards to keep in step", READS.length === 1 && /pp_licences\?code=eq\.QZXKMP&status=eq\.paid/.test(READS[0]), READS.join(" | "));
ok("the reply carries the site's CORS header, so the host's tablet can read it", /partyplay/.test(String(good.headers["Access-Control-Allow-Origin"] || good.headers["access-control-allow-origin"] || "")), JSON.stringify(good.headers));
r = call("POST", "/party/gm/boards?code=" + CODE + "&key=" + HK);
ok("only GET is a route", r.status === 404, r.status);
if (typeof arguments !== "undefined" && arguments[0] === "--reply") print("REPLY " + good.text);

print("== nothing a guest, the telly or a stranger loads holds a board ==");
var pages = ["partyplay/run.html", "partyplay/play.html", "partyplay/tv.html", "partyplay/host.html", "partyplay/index.html", "partyplay/practice.html", "partyplay/start.html", "partyplay/setup.html"];
var served = pages.slice(), missingFiles = [];
pages.forEach(function (p) {
  var t; try { t = readFile(findUp(p)); } catch (e) { missingFiles.push(p); return; }
  var re = /<script[^>]+src="\/([^"?]+\.js)/g, mm;
  while ((mm = re.exec(t))) { if (served.indexOf("partyplay/" + mm[1]) < 0) served.push("partyplay/" + mm[1]); }
});
var leaks = [], gone = [];
served.forEach(function (p) {
  var t; try { t = readFile(findUp(p)); } catch (e) { gone.push(p); return; }
  BOARDS.forEach(function (b) {
    var n = b.answers.filter(function (a) { return t.indexOf('"' + a.a + '", pts: ' + a.pts) >= 0 || t.indexOf('"a":"' + a.a + '","pts":' + a.pts) >= 0; }).length;
    if (t.indexOf(b.q) >= 0 || n >= 3) leaks.push(p + ": " + b.id);
  });
});
ok("read " + served.length + " served files: no board's question or answers in any", served.length >= 15 && !leaks.length && !missingFiles.length, leaks.concat(missingFiles).slice(0, 6).join(", "));
ok("every script those pages load exists (none still asks for the old boards file)", !gone.length, gone.join(", "));
var oldGone = true; try { oldGone = readFile("partyplay/lib/pp-great-minds-boards.js").length < 50; } catch (e) { oldGone = true; }
ok("/lib/pp-great-minds-boards.js is no longer served", oldGone);

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if (bad) throw new Error(bad + " great minds board checks failed");
