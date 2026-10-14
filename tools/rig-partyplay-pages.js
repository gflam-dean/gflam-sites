/* A RIG, not a test (15 Oct 2026). Runs the REAL inline script of a PartyPlay page (run.html,
   play.html, tv.html) in jsc, with the page's own copies of lib/pp-sign.js and lib/pp-phonekey.js,
   on a fake realtime channel shared by every page in the room, against a small fake Worker.

   What it stands in for, and nothing more:
     the channel     one bus; a message goes to every OTHER page on the same channel name, in
                     order, when the test calls room.flush() (self:false, like Supabase)
     the Worker      the routes the pages call, kept in memory (partyplay-api.test.js and
                     pp-realtime-auth.test.js test the real Worker's routes separately)
     the DOM         elements are plain objects; innerHTML is a string a check can read
     WebCrypto       tools/rig-fake-webcrypto.js, which keeps the one property signing relies on
                     (only the private key's holder can make a signature that verifies) and
                     proves nothing about ECDSA. The real curve is exercised in a real browser:
                     see the play-test notes in the 15 Oct report.

   Needs, loaded first: tools/rig-fake-webcrypto.js (crypto, TextEncoder, btoa, atob), and
   pp-config.js, pp-ticket.js, pp-quiz.js, pp-games.js, pp-licence.js as globals. */
var PPRig = (function () {
  function find(rel) {
    var tries = [rel, "../../" + rel, "../" + rel];
    for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 50) return tries[i]; } catch (e) {} }
    throw new Error("cannot find " + rel);
  }
  function src(rel) { return readFile(find(rel)); }
  function settle(n) { for (var i = 0; i < (n || 30); i++) drainMicrotasks(); }

  /* ------------------------------------------------------------- the channel */
  function Room() {
    var chans = [], q = [];
    this.chans = chans; this.log = [];
    this.supabaseFor = function (page) {
      return { createClient: function () { return { channel: function (name) {
        var c = { name: name, page: page, handlers: [], status: null, gone: false,
          on: function (a, b, cb) { c.handlers.push(cb); return c; },
          subscribe: function (cb) { c.status = cb; chans.push(c); return c; },
          unsubscribe: function () { c.gone = true; if (c.status) c.status("CLOSED"); },
          send: function (m) { if (!c.gone) q.push({ from: c, payload: JSON.parse(JSON.stringify(m.payload)) }); return Promise.resolve("ok"); } };
        return c; } }; } };
    };
    var self = this;
    /* Anybody can shout into a channel: that is the whole problem being fixed. */
    this.inject = function (name, payload) { q.push({ from: { name: name, page: "stranger" }, payload: JSON.parse(JSON.stringify(payload)) }); };
    this.subscribeAll = function () { chans.forEach(function (c) { if (c.status && !c.subscribed) { c.subscribed = true; c.status("SUBSCRIBED"); } }); settle(); };
    this.flush = function () {
      for (var round = 0; round < 60; round++) {
        settle();
        if (!q.length) { settle(); if (!q.length) return; }
        var m = q.shift();
        self.log.push({ from: m.from.page, payload: m.payload });
        chans.forEach(function (c) {
          if (c === m.from || c.gone || c.name !== m.from.name) return;
          c.handlers.forEach(function (h) { try { h({ payload: JSON.parse(JSON.stringify(m.payload)) }); } catch (e) { print("  rig: handler threw " + e); } });
        });
      }
    };
  }

  /* ------------------------------------------------------------- the Worker */
  function Worker() {
    var W = this;
    W.parties = {};           // code -> { key, status, players:[{name,token,pid}], sign:null, games:[] }
    W.calls = [];
    W.down = {};              // path -> true: that route answers 500 / is not deployed
    W.add = function (code, key, opts) {
      W.parties[code] = { key: key, status: "live", players: [], sign: null, games: (opts && opts.games) || [] };
      return W.parties[code];
    };
    function q(url) {
      var out = {}, s = url.split("?")[1] || "";
      s.split("&").forEach(function (kv) { if (!kv) return; var i = kv.indexOf("="); out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
      return out;
    }
    function tseed(token) { return PPTicket.seed(token); }
    W.fetch = function (url, init) {
      var path = url.replace(/^https?:\/\/[^\/]+/, "").split("?")[0], qs = q(url);
      var body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      W.calls.push({ path: path, qs: qs, body: body });
      function ans(status, j) { return Promise.resolve({ ok: status < 400, status: status, json: function () { return Promise.resolve(j); } }); }
      if (W.down[path]) return ans(404, { error: "not found" });
      var code = PPConfig.code(qs.code || body.code), p = W.parties[code];
      var host = function (k) { return p && p.key === k; };
      if (path === "/licence") return p ? ans(200, { code: code, status: p.status, days: 1 }) : ans(PPConfig.valid(code) ? 404 : 400, { error: "no" });
      if (path === "/party/signing/public") return ans(200, p && p.sign ? { exists: true, kid: p.sign.kid, public_jwk: p.sign.public_jwk } : { exists: false });
      if (path === "/party/signing/private") return host(body.key) ? ans(200, p.sign ? { exists: true, kid: p.sign.kid, public_jwk: p.sign.public_jwk, private_jwk: p.sign.private_jwk } : { exists: false }) : ans(403, { error: "Not your party to change." });
      if (path === "/party/signing/mint") {
        if (!host(body.key)) return ans(403, { error: "Not your party to change." });
        if (!p.sign) p.sign = { kid: body.kid, public_jwk: body.public_jwk, private_jwk: body.private_jwk };
        return ans(200, { exists: true, kid: p.sign.kid, public_jwk: p.sign.public_jwk, private_jwk: p.sign.private_jwk });
      }
      if (path === "/party/players") return host(qs.key) ? ans(200, { players: p.players.map(function (r) { return { name: r.name, pid: r.pid || null, tseed: tseed(r.token) }; }) }) : ans(403, { error: "Not your party to change." });
      if (path === "/games") return host(qs.key) ? ans(200, { games: p.games, party: { code: code, status: p.status, days: 1, timeLeft: "23 hours", startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-10-16T00:00:00Z" } }) : (p ? ans(403, { error: "Not your party to change." }) : ans(404, { error: "No party with that code." }));
      if (path === "/join") {
        if (!p) return ans(404, { error: "No party with that code." });
        var me = p.players.filter(function (r) { return r.token === body.prev; })[0];
        if (body.rejoin === true && !me) return ans(404, { error: "not a guest" });
        var pidOk = /^k1_/.test(body.pid || "") && !p.players.some(function (r) { return r.pid === body.pid && r !== me; });
        if (me) { if (pidOk) me.pid = body.pid; return ans(200, { ok: true, token: me.token, nickname: me.name, back: true }); }
        var name = String(body.nickname || "").trim(), n = 2, base = name;
        while (p.players.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })) name = base + " " + (n++);
        var tok = "TOK" + code + p.players.length + "XXXXXXXXXXXXXXXXXXXX".slice(0, 24 - 3 - code.length - String(p.players.length).length);
        p.players.push({ name: name, token: tok, pid: pidOk ? body.pid : null });
        return ans(200, { ok: true, token: tok, nickname: name });
      }
      return ans(200, {});
    };
  }

  /* ------------------------------------------------------------- the DOM */
  function Dom() {
    var els = {}, self = this;
    self.clicks = []; self.body = [];
    function el(id) {
      var e = { id: id || "", innerHTML: "", textContent: "", value: "", hidden: false, disabled: false, style: {},
        attrs: {}, children: [],
        classList: { add: function () {}, remove: function () {} },
        addEventListener: function (t, f) { (e["on" + t] = e["on" + t] || []).push(f); },
        setAttribute: function (k, v) { e.attrs[k] = v; }, getAttribute: function (k) { return e.attrs[k]; },
        hasAttribute: function (k) { return k in e.attrs; },
        querySelector: function (sel) { var m = /#([\w-]+)/.exec(sel); return m ? self.get(m[1]) : el(""); },
        appendChild: function (c) { e.children.push(c); return c; },
        remove: function () { e.removed = true; if (e.id && els[e.id] === e) delete els[e.id]; },
        focus: function () {}, submit: function () { e.submitted = true; }, scrollIntoView: function () {},
        closest: function () { return null; } };
      return e;
    }
    self.el = el;
    self.get = function (id) { return els[id] || (els[id] = el(id)); };
    self.has = function (id) { return !!els[id] && !els[id].removed; };
    self.document = {
      getElementById: function (id) { return self.get(id); },
      createElement: function () { return el(""); },
      querySelector: function (sel) { var m = /#([\w-]+)/.exec(sel); return m ? self.get(m[1]) : null; },
      querySelectorAll: function () { return []; },
      addEventListener: function (t, f) { if (t === "click") self.clicks.push(f); },
      body: { firstChild: null, appendChild: function (c) { self.body.push(c); if (c.id) els[c.id] = c; return c; },
              insertBefore: function (c) { self.body.push(c); if (c.id) els[c.id] = c; return c; } },
      head: { appendChild: function () {} },
      hidden: false
    };
    /* A tap on a button with this id, or on an element carrying these data- attributes. */
    self.tap = function (id, data) {
      var t = el(id); t.attrs = data || {};
      if (id) t.attrs.id = id;
      t.closest = function () { return t; };
      self.clicks.forEach(function (f) { try { f({ target: t, preventDefault: function () {} }); } catch (e) { print("  rig: click threw " + e + " " + (e.stack || "")); } });
      settle();
    };
  }

  /* ------------------------------------------------------------- a page */
  function Store() { var s = {}; return { getItem: function (k) { return k in s ? s[k] : null; },
    setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; }, _s: s }; }
  function USP(search) {
    var o = {}; String(search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
      if (!kv) return; var i = kv.indexOf("="); if (i < 0) { o[decodeURIComponent(kv)] = ""; return; }
      o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
    this.get = function (k) { return k in o ? o[k] : null; };
  }
  var LIBSIGN = null, LIBKEY = null;
  function libInstance(which, win, fetch, store, timers) {
    var code = which === "sign" ? (LIBSIGN = LIBSIGN || src("partyplay/lib/pp-sign.js")) : (LIBKEY = LIBKEY || src("partyplay/lib/pp-phonekey.js"));
    (new Function("window", "fetch", "setTimeout", "setInterval", "clearTimeout", "localStorage", "console", code))
      (win, fetch, timers.setTimeout, timers.setInterval, timers.clearTimeout, store, { warn: function () {}, error: function () {}, log: function () {} });
    return which === "sign" ? win.PPSign : win.PPPhoneKey;
  }

  /* opts: { search, store, sign:true|false, keys:true|false, worker, room, exportNames:[] } */
  function boot(rel, opts) {
    var html = src(rel);
    var scripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    var body = scripts[scripts.length - 1].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    var dom = new Dom(), store = opts.store || new Store();
    if (opts.before) opts.before(dom);     // a test's watcher on an element, in place before the page runs
    var timers = { list: [],
      setTimeout: function (f, ms) { timers.list.push({ f: f, ms: ms || 0 }); return timers.list.length; },
      setInterval: function () { return 0; }, clearTimeout: function () {} };
    /* Run what is waiting on the clock, once (a test says when time passes). */
    timers.run = function (maxMs) { var l = timers.list; timers.list = []; l.forEach(function (t) { if (maxMs == null || t.ms <= maxMs) { try { t.f(); } catch (e) { print("  rig: timer threw " + e); } } else timers.list.push(t); }); settle(); };
    var win = { crypto: crypto, location: { search: opts.search || "", pathname: "/" + rel.replace(/^.*\//, "").replace(/\.html$/, ""), origin: "https://partyplay.com.au", href: "" },
                navigator: { userAgent: "jsc" }, document: dom.document };
    /* The shared libraries a page loads with <script src>, which in a browser are on window. */
    ["PPConfig", "PPTicket", "PPQuiz", "PPGames", "PPLicence", "PRGame", "PRPhone", "PRBoard"].forEach(function (k) { if (typeof globalThis[k] !== "undefined") win[k] = globalThis[k]; });
    var fetch = opts.worker ? opts.worker.fetch : function () { return Promise.reject(new Error("offline")); };
    win.fetch = fetch;
    if (opts.sign !== false) win.PPSign = libInstance("sign", win, fetch, store, timers);
    if (opts.keys !== false) win.PPPhoneKey = libInstance("key", win, fetch, store, timers);
    var sup = opts.room ? opts.room.supabaseFor(opts.name || rel) : { createClient: function () { throw new Error("no channel"); } };
    var names = opts.exportNames || [];
    var EXPORT = "\n;window.__X = {" + names.map(function (n) { return JSON.stringify(n) + ":function(){ return (" + n + ").apply(null, arguments); }"; }).join(",") +
                 (opts.extra ? (names.length ? "," : "") + opts.extra : "") + "};\n";
    var cut = body.lastIndexOf("})();");
    var harness = body.slice(0, cut) + EXPORT + body.slice(cut);
    var location = win.location;
    location.replace = function () {};
    var params = ["window", "document", "location", "localStorage", "sessionStorage", "fetch", "setTimeout", "setInterval",
                  "clearTimeout", "clearInterval", "URLSearchParams", "navigator", "alert", "confirm", "supabase", "PPPhoneKey", "console"];
    var f = new Function(params.join(","), harness);
    f(win, dom.document, location, store, store, fetch, timers.setTimeout, timers.setInterval, timers.clearTimeout, function () {},
      USP, win.navigator, function () {}, function () { return true; }, sup, win.PPPhoneKey,
      { warn: function () {}, error: function (e) { print("  page error: " + e); }, log: function () {} });
    settle();
    return { win: win, dom: dom, store: store, timers: timers, x: win.__X, app: function () { return dom.get("app").innerHTML; } };
  }

  return { boot: boot, Room: Room, Worker: Worker, Store: Store, settle: settle, find: find, src: src };
})();
