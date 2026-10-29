/* A STAND-IN FOR supabase-js, FOR THE REAL PAGES IN A REAL BROWSER (tools/test-console-in-chrome.py).

   Served in place of https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 by the test's local server, and
   nothing else on the page is changed. It gives the pages exactly what they use:
     auth      a signed-in host (the console) or nobody (a phone)
     from()    the few tables vp-session.js reads, answered from window.__FAKE_DB (written by the server)
     channel() realtime broadcast, carried between tabs of this browser by BroadcastChannel, so a console
               tab and a phone tab really talk to each other, through the real vp-channel.js
   Never shipped: it lives under tools/. */
(function () {
  var DB = window.__FAKE_DB || {};
  var SIGNED_IN = !!window.__FAKE_SIGNED_IN;
  /* PER-TAB OVERRIDES (29 Oct 2026, tools/phone-signin-in-chrome.test.py), set before the page's own scripts
     with Page.addScriptToEvaluateOnNewDocument: window.__FAKE_TEST = { signedIn, phone, persist }.
       phone    the signed-in login's mobile as Auth stores it ("61400000001" by default: every real host
                login has one, and a login with none is asked for it first by vp-about-you.js)
       persist  sign-in, sign-out and a verified phone change survive a page load (localStorage), so a
                one-off link that signs in on /app/go arrives signed in on /app/
     Auth calls are recorded in window.__FAKE_AUTH_CALLS. */
  var T = window.__FAKE_TEST || {};
  var PST = { get: function (k) { try { return T.persist ? localStorage.getItem("__fake_" + k) : null; } catch (e) { return null; } },
              set: function (k, v) { try { if (T.persist) localStorage.setItem("__fake_" + k, v); } catch (e) {} } };
  if ("signedIn" in T) SIGNED_IN = !!T.signedIn;
  if (PST.get("in") !== null) SIGNED_IN = PST.get("in") === "1";
  var PHONE = ("phone" in T) ? String(T.phone || "") : "61400000001";
  if (PST.get("phone") !== null) PHONE = PST.get("phone");
  var PENDING = "", META = { name: "Test Host" };
  var CALLS = window.__FAKE_AUTH_CALLS = [];
  function Query(table) { this.t = table; this.f = []; this.one = false; this.lim = null; this.write = false; this.ord = null; }
  Query.prototype.select = function () { return this; };
  Query.prototype.eq = function (k, v) { this.f.push(function (r) { return String(r[k]) === String(v); }); return this; };
  Query.prototype.neq = function (k, v) { this.f.push(function (r) { return String(r[k]) !== String(v); }); return this; };
  Query.prototype.in = function (k, vs) { this.f.push(function (r) { return vs.map(String).indexOf(String(r[k])) >= 0; }); return this; };
  Query.prototype.is = function (k, v) { this.f.push(function (r) { return (r[k] == null) === (v == null); }); return this; };
  Query.prototype.ilike = Query.prototype.like = function () { return this; };
  /* ORDER, the way PostgREST does it, for the HQ screens that read the audit newest first
     (19 Oct 2026). Nulls last. Unordered reads keep the stored order, as before. */
  Query.prototype.order = function (k, o) { (this.ord = this.ord || []).push({ k: k, asc: !(o && o.ascending === false) }); return this; };
  Query.prototype.range = function () { return this; };
  Query.prototype.limit = function (n) { this.lim = n; return this; };
  Query.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
  Query.prototype.single = function () { this.one = 'single'; return this; };
  Query.prototype.upsert = Query.prototype.insert = Query.prototype.update = Query.prototype.delete = function () { this.write = true; return this; };
  /* LIVE TABLES. A table named in window.__LIVE_TABLES is read from the test's server (/__db/<table>)
     on every query, so what the real Worker writes (an audit row from /admin/audit) is what the page
     reads back, as it would be live. Added 19 Oct 2026 for tools/hq-lists-in-chrome.test.py. */
  Query.prototype.then = function (res, rej) {
    var self = this;
    if (window.__LIVE_TABLES && window.__LIVE_TABLES.indexOf(this.t) >= 0 && !this.write) {
      return fetch('/__db/' + this.t).then(function (r) { return r.json(); })
        .then(function (rows) { DB[self.t] = rows || []; return self._answer(); }).then(res, rej);
    }
    return Promise.resolve(this._answer()).then(res, rej);
  };
  Query.prototype._answer = function () {
    var rows = (DB[this.t] || []).filter(function (r) { return this.f.every(function (f) { return f(r); }); }, this);
    if (this.ord) {
      var ord = this.ord;
      rows = rows.slice().sort(function (a, b) {
        for (var i = 0; i < ord.length; i++) {
          var x = a[ord[i].k], y = b[ord[i].k];
          if (x == null && y == null) continue; if (x == null) return 1; if (y == null) return -1;
          if (x < y) return ord[i].asc ? -1 : 1; if (x > y) return ord[i].asc ? 1 : -1;
        }
        return 0;
      });
    }
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return this.write ? { data: null, error: null } : (this.one ? { data: rows[0] || null, error: null } : { data: rows, error: null, count: rows.length });
  };
  function session() {
    return SIGNED_IN ? { access_token: 'fake-token', user: { id: window.__FAKE_UID, email: 'host@test.local', phone: PHONE, user_metadata: META } } : null;
  }
  function client() {
    var chans = [];
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session() }, error: null }); },
        getUser: function () { var s = session(); return Promise.resolve({ data: { user: s && s.user }, error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function (o) { CALLS.push({ fn: "signOut", args: o || null }); if (T.persist) { SIGNED_IN = false; PST.set("in", "0"); } return Promise.resolve({ error: null }); },
        signInWithOtp: function (a) { CALLS.push({ fn: "signInWithOtp", args: a }); return Promise.resolve({ error: null }); },
        updateUser: function (a) {
          CALLS.push({ fn: "updateUser", args: a });
          if (a && a.phone === "+61400000009") return Promise.resolve({ data: null, error: { message: "Phone number already registered by another user", code: "phone_exists" } });
          if (a && a.data) { for (var k in a.data) META[k] = a.data[k]; }
          if (a && a.phone) PENDING = a.phone;
          return Promise.resolve({ data: { user: session() && session().user }, error: null });
        },
        verifyOtp: function (a) {
          CALLS.push({ fn: "verifyOtp", args: a });
          if (a && a.token_hash) {   // the one-off link: a session on this device
            SIGNED_IN = true; PST.set("in", "1");
            return Promise.resolve({ data: { session: session(), user: session().user }, error: null });
          }
          if (a && a.type === "phone_change") {
            if (a.phone === PENDING && a.token === "123456") { PHONE = PENDING.replace("+", ""); PST.set("phone", PHONE); return Promise.resolve({ data: { user: session().user }, error: null }); }
            return Promise.resolve({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
          }
          return Promise.resolve({ data: {}, error: null });
        }
      },
      /* Any query method this stand-in does not model (gte, lt, not, or, csv...) chains and filters
         nothing, so an admin page that narrows a read differently still gets its rows rather than a
         TypeError. Added 19 Oct 2026 for the admin pages (tools/browser-rig/admin_site.py). */
      from: function (t) {
        var q = new Query(t);
        return typeof Proxy === 'undefined' ? q : new Proxy(q, { get: function (o, k) {
          if (k in o) return o[k];
          if (typeof k === 'string') return function () { return this; };
          return undefined;
        } });
      },
      rpc: function () { return Promise.resolve({ data: null, error: null }); },
      channel: function (name) {
        var handlers = [], bc = null, statusCb = null;
        var ch = {
          on: function (type, filter, cb) { handlers.push({ type: type, ev: filter && filter.event, cb: cb }); return ch; },
          subscribe: function (cb) {
            statusCb = cb;
            bc = new BroadcastChannel('fake-rt:' + name);
            bc.onmessage = function (e) { handlers.forEach(function (h) { if (h.type === 'broadcast' && (!h.ev || h.ev === e.data.event)) { try { h.cb({ event: e.data.event, payload: e.data.payload }); } catch (err) { setTimeout(function () { throw err; }); } } }); };
            setTimeout(function () { if (cb) cb('SUBSCRIBED'); }, 5);
            return ch;
          },
          send: function (m) { if (bc) bc.postMessage({ event: m.event, payload: JSON.parse(JSON.stringify(m.payload)) }); return Promise.resolve('ok'); },
          unsubscribe: function () { if (bc) { bc.close(); bc = null; } if (statusCb) setTimeout(function () { statusCb('CLOSED'); }); return Promise.resolve('ok'); },
          track: function () { return Promise.resolve('ok'); }
        };
        chans.push(ch);
        return ch;
      },
      removeChannel: function (ch) { return ch && ch.unsubscribe ? ch.unsubscribe() : Promise.resolve(); },
      getChannels: function () { return chans; }
    };
  }
  window.supabase = { createClient: function () { return client(); } };
})();
