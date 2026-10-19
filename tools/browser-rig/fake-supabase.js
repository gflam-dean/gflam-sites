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
  function Query(table) { this.t = table; this.f = []; this.one = false; this.lim = null; this.write = false; }
  Query.prototype.select = function () { return this; };
  Query.prototype.eq = function (k, v) { this.f.push(function (r) { return String(r[k]) === String(v); }); return this; };
  Query.prototype.neq = function (k, v) { this.f.push(function (r) { return String(r[k]) !== String(v); }); return this; };
  Query.prototype.in = function (k, vs) { this.f.push(function (r) { return vs.map(String).indexOf(String(r[k])) >= 0; }); return this; };
  Query.prototype.is = function (k, v) { this.f.push(function (r) { return (r[k] == null) === (v == null); }); return this; };
  Query.prototype.ilike = Query.prototype.like = function () { return this; };
  Query.prototype.order = function () { return this; };
  Query.prototype.range = function () { return this; };
  Query.prototype.limit = function (n) { this.lim = n; return this; };
  Query.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
  Query.prototype.single = function () { this.one = 'single'; return this; };
  Query.prototype.upsert = Query.prototype.insert = Query.prototype.update = Query.prototype.delete = function () { this.write = true; return this; };
  Query.prototype.then = function (res, rej) {
    var rows = (DB[this.t] || []).filter(function (r) { return this.f.every(function (f) { return f(r); }); }, this);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    var out = this.write ? { data: null, error: null } : (this.one ? { data: rows[0] || null, error: null } : { data: rows, error: null, count: rows.length });
    return Promise.resolve(out).then(res, rej);
  };
  function session() {
    return SIGNED_IN ? { access_token: 'fake-token', user: { id: window.__FAKE_UID, email: 'host@test.local', user_metadata: { name: 'Test Host' } } } : null;
  }
  function client() {
    var chans = [];
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session() }, error: null }); },
        getUser: function () { var s = session(); return Promise.resolve({ data: { user: s && s.user }, error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function () { return Promise.resolve({ error: null }); },
        signInWithOtp: function () { return Promise.resolve({ error: null }); },
        verifyOtp: function () { return Promise.resolve({ data: {}, error: null }); }
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
