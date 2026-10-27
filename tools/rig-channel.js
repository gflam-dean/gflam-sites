/* A FAKE REALTIME CLIENT THAT BEHAVES LIKE THE REAL ONE WHERE IT MATTERS, AND A VIRTUAL CLOCK.

   Loaded by tools/test-channel-recovery-*.js (load('tools/rig-channel.js'), from the repo root).
   It is not a suite and prints nothing on its own.

   The rules of supabase-js it keeps, because a fake without them is how these faults shipped:
     - a channel can be subscribed ONCE; a second subscribe() throws
     - removeChannel(ch) tells that channel's callback CLOSED, synchronously, inside the call
     - ch.unsubscribe() tells it CLOSED a moment later, when the server acknowledges the leave
     - a channel that has CLOSED never rejoins by itself
     - a CHANNEL_ERROR or TIMED_OUT channel does try again by itself (the library's own rejoin),
       which is what lets a page's retry be cancelled because the channel healed
*/
var RIG = (function (G) {
  var NOW = 1e12, timers = [], tid = 1, uncaught = [];
  var realDateNow = Date.now;
  Date.now = function () { return NOW; };
  function setTimeout_(fn, ms) { var id = tid++; timers.push({ id: id, at: NOW + (ms || 0), fn: fn, every: 0 }); return id; }
  function setInterval_(fn, ms) { var id = tid++; timers.push({ id: id, at: NOW + ms, fn: fn, every: ms }); return id; }
  function clear_(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
  function advance(ms) {
    var end = NOW + ms;
    for (;;) {
      timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      var t = timers[0];
      if (!t || t.at > end) break;
      NOW = t.at;
      if (t.every) t.at += t.every; else timers.shift();
      try { t.fn(); } catch (e) { uncaught.push(String(e)); }   // what a browser would log and drop
    }
    NOW = end;
  }
  G.setTimeout = setTimeout_; G.clearTimeout = clear_; G.setInterval = setInterval_; G.clearInterval = clear_;

  var JOIN_MS = 40, LEAVE_MS = 20, SELF_HEAL_MS = 1000;
  function makeClient(world) {
    world = world || {};
    world.up = world.up !== false;              // is the network up
    world.dead = world.dead || function () { return false; };   // a channel name that can never join
    world.channels = [];
    world.joins = 0;
    function attempt(ch) {
      setTimeout_(function () {
        if (ch.removed || ch.closed) return;
        if (world.up && !world.dead(ch.name)) { ch.state = 'joined'; ch.cb('SUBSCRIBED'); }
        else { ch.state = 'errored'; ch.cb('TIMED_OUT'); }
      }, JOIN_MS);
    }
    var client = {
      channel: function (name, opts) {
        var ch = { name: name, opts: opts, removed: false, closed: false, state: 'new', cb: null, handlers: [], sent: [],
          on: function (type, filter, fn) { ch.handlers.push({ type: type, filter: filter, fn: fn }); return ch; },
          subscribe: function (cb) {
            if (ch.cb) throw new Error('tried to subscribe multiple times. subscribe can only be called a single time per channel instance');
            ch.cb = cb || function () {}; world.joins++; attempt(ch); return ch;
          },
          send: function (m) { if (ch.removed || ch.closed) throw new Error('send on a dead channel'); ch.sent.push(m); return Promise.resolve('ok'); },
          unsubscribe: function () {
            if (ch.removed || ch.closed) return Promise.resolve('ok');
            ch.closed = true;
            setTimeout_(function () { if (ch.cb) ch.cb('CLOSED'); }, LEAVE_MS);   // the server's ack of the leave
            return Promise.resolve('ok');
          } };
        world.channels.push(ch); return ch;
      },
      removeChannel: function (ch) {
        if (!ch || ch.removed) return Promise.resolve('ok');
        ch.removed = true;
        /* The real library does exactly this, there and then, EVEN IF the channel already
           closed: removeChannel runs unsubscribe, which fires the close bindings again. The
           fakes in test-tv-does-not-flap.js and test-router-heals-after-a-blip.js agree. */
        ch.closed = true;
        if (ch.cb) ch.cb('CLOSED');
        return Promise.resolve('ok');
      }
    };
    world.client = client;
    world.live = function (part) {
      return world.channels.filter(function (c) { return !c.removed && !c.closed && (!part || c.name.indexOf(part) !== -1); });
    };
    world.joined = function (part) { return world.live(part).filter(function (c) { return c.state === 'joined'; }); };
    /* The server ends a channel. CLOSED is final. An error is followed by the library's own
       rejoin a second later, if the network is back by then. */
    world.drop = function (ch, status) {
      if (!ch || ch.removed || ch.closed) return;
      if (status === 'CLOSED') { ch.closed = true; ch.state = 'closed'; ch.cb('CLOSED'); return; }
      ch.state = 'errored'; ch.cb(status);
      setTimeout_(function () { if (!ch.removed && !ch.closed && ch.state === 'errored') attempt(ch); }, SELF_HEAL_MS);
    };
    world.dropAll = function (status, part) { world.live(part).forEach(function (c) { world.drop(c, status); }); };
    /* A host message arriving on a channel. */
    world.emit = function (ch, payload) {
      ch.handlers.forEach(function (h) { if (h.type === 'broadcast') h.fn({ payload: payload }); });
    };
    return world;
  }

  /* The real shared script, run from the repo. */
  function loadHelper(win) {
    var src = readFile('venueplay/app/vp-channel.js');
    var f = new Function('window', 'setTimeout', 'clearTimeout', src + '\nreturn window.VPChannel;');
    return f(win, setTimeout_, clear_);
  }

  /* A named function out of a page, by its own braces. */
  function lift(src, name) {
    var m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
    if (!m) return null;
    return src.slice(m.index, braceEnd(src, src.indexOf('{', m.index)) + 1);
  }
  /* Plain brace counting, the way the other suites lift from tv.html. A quote-aware scan reads a
     regex like /data-cfemail="[^"]*"/ as an open string and loses its place. */
  function braceEnd(src, open) {
    var d = 0;
    for (var k = open; k < src.length; k++) {
      var c = src[k];
      if (c === '{') d++;
      else if (c === '}') { d--; if (!d) return k; }
    }
    return -1;
  }
  /* A <script src> tag, not a mention in a comment. */
  function loadsScript(html, file) {
    var re = /<script[^>]*?src=["']([^"']+)["'][^>]*>/g, m;
    while ((m = re.exec(html))) { if (m[1].split('?')[0].split('/').pop() === file) return true; }
    return false;
  }
  /* A fake element, enough for the status pill and a view. */
  function makeDom() {
    var made = {};
    function el(id) {
      var s = {};
      return made[id] = made[id] || { id: id, textContent: '', hidden: false, _attr: {},
        classList: { add: function (c) { s[c] = 1; }, remove: function (c) { delete s[c]; },
          toggle: function (c, on) { if (on === undefined) on = !s[c]; if (on) s[c] = 1; else delete s[c]; }, contains: function (c) { return !!s[c]; } },
        setAttribute: function (k, v) { this._attr[k] = String(v); } };
    }
    return { $: function (id) { return el(id); }, el: el, made: made,
      document: { getElementById: function (id) { return el(id); }, querySelector: function (sel) { return el(sel); },
        documentElement: el('html'), addEventListener: function () {} } };
  }

  var fails = 0, ran = 0;
  function check(name, ok, saw) {
    ran++;
    if (ok) print('  ok   ' + name);
    else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); }
  }
  function done(what) {
    if (uncaught.length) print('  (timers threw: ' + uncaught.slice(0, 3).join(' | ') + ')');
    if (fails) throw new Error(what + ': ' + fails + ' of ' + ran + ' failed');
    print('PASS ' + ran + ' checks');
  }
  return { advance: advance, now: function () { return NOW; }, pending: function () { return timers.filter(function (t) { return !t.every; }).length; },
           makeClient: makeClient, loadHelper: loadHelper, lift: lift, braceEnd: braceEnd, loadsScript: loadsScript,
           makeDom: makeDom, check: check, done: done, uncaught: uncaught,
           setTimeout: setTimeout_, clearTimeout: clear_, setInterval: setInterval_ };
})(this);
