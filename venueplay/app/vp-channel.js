/* vp-channel.js  -- A REALTIME CHANNEL THAT COMES BACK BY ITSELF. ONE ANSWER, EVERY PAGE.

   Audit, 27 Sep 2026. The venue screens (trivia, musical, raffle, members), the bingo channel
   on /tv and both phones said "Reconnecting" when their channel dropped, and then did nothing
   else. supabase-js retries a CHANNEL_ERROR or a TIMED_OUT itself, but a CLOSED channel stays
   closed: it never rejoins. So one wifi blip that ended in CLOSED left a wall deaf, or a phone
   tapping answers into a queue nothing would ever flush, for the rest of the night.

   Three pages had already been fixed by hand, each its own way (the trivia console, the router
   in vp-screen-router.js and the TV's four game channels), and a fourth copy per page is how
   this codebase gets faults. So the rules live here, once:

     1. A NEW CHANNEL PER RETRY. A channel can be subscribed once; subscribing it again throws.
     2. LET GO OF THE OLD ONE BEFORE REMOVING IT. removeChannel() makes the old channel report
        CLOSED inside that very call. If it is still "the current one" when that arrives, it
        reads as a fresh failure and books another retry: the flap that re-joined a venue TV
        3,588 times in half an hour (20 Sep 2026).
     3. A STATUS FROM A CHANNEL WE HAVE REPLACED OR LET GO IS HISTORY, NOT NEWS. That is also
        what stops Leave, or a phone moving to another code, from painting "Reconnecting" on
        the screen it moved to: the channel it hung up reports CLOSED afterwards.
     4. BACK OFF, 2s, 4s, 8s, 16s, then every 30s. One retry in flight at a time.
     5. IF IT HEALS BY ITSELF, CANCEL THE RETRY. Tearing down a channel that just came back is
        a gap of deafness for nothing.

   HOW A PAGE USES IT. keep() returns something shaped like a channel, so a page swaps one call
   and nothing else changes:

       var ch = window.VPChannel ? VPChannel.keep(client, name, opts) : client.channel(name, opts);
       ch.on("broadcast", { event:"msg" }, handler);   // re-attached to every rebuilt channel
       ch.subscribe(function(status){ ... });          // hears only the CURRENT channel
       ch.send(msg);                                   // goes down the current channel; throws if none
       ch.unsubscribe();                               // hang up for good: no more retries, no more news

   The page's status callback is told SUBSCRIBED when a channel joins and the drop status
   (CHANNEL_ERROR, TIMED_OUT, CLOSED) when the current one fails, exactly as before, so every
   page keeps clearing its own "subscribed" flag in its own words. It is never told about a
   channel it has already been told is gone.

   Tested by tools/test-channel-recovery-*.js, which run THIS file against a fake client that
   keeps the real library's two rules (subscribe once; removeChannel reports CLOSED at once).
   ES5, no dependencies.

   A WINDOW NOBODY CAN SEE (The Mini Bar, 23 Oct 2026). Dean ran the TV as a Chrome window on his
   Mac, behind the console. A covered window is "hidden" to Chrome, which throttles its timers
   and, after five minutes, freezes it between once-a-minute wake-ups. Measured on the live Mini
   Bar screen in a hidden tab: the realtime socket died at 4 min 20 s (the 30 s heartbeat could
   not be sent on time, close 1000), supabase-js 2.118 then REFUSES to reconnect while the page
   is hidden ("Not reconnecting as page is hidden!"), and the 2 s rebuild booked here fired
   91 SECONDS later. Every channel deaf, RECONNECTING on the wall, balls arriving when the
   window was next uncovered. Tugun's screen in the same Chrome sat in front, so it never did.
   Two answers, both here so every screen gets them:

     6. THE HEARTBEAT RUNS IN A WEB WORKER. clientOptions() asks supabase-js to send its
        heartbeat from a worker, which Chrome does not throttle with the page's own timers. The
        same hidden tab, the same seven and a half minutes: no drop at all. Nothing else in the
        library changes, and a browser with no Worker (or one that refuses a blob worker) gets
        the plain client it always had.
     7. THE MOMENT THE WINDOW IS SEEN AGAIN, A PENDING RETRY RUNS NOW. visibilitychange,
        pageshow, online and focus all poke every kept channel that is waiting on its timer, so
        a wall that comes back into view is rebuilt in the time of one join, not whenever the
        throttled timer gets round to it.
     8. A CHANNEL THE LIBRARY HANDS BACK IS NOT A NEW CHANNEL. supabase-js 2.11x returns the
        EXISTING channel for a topic it still holds, and holds the old one until the server
        acknowledges its leave. subscribe() on that object does nothing, silently, and the page
        would sit on Reconnecting with no retry booked. So a rebuild that gets its own old
        channel back waits a beat for the leave to land and asks again.

   BACK IN SECONDS AFTER THE SIGNAL RETURNS (live flight-mode test, Dean's iPhone, 1 Nov 2026: 10 to
   30 seconds of "Reconnecting" on this road after a 25 second drop). Rule 7 poked the CHANNEL, but a
   channel rejoins only over the library's SOCKET, and the socket was waiting out its own backoff
   (1, 2, 5, then every 10 s), or, worse, still called itself open on a connection flight mode had
   killed, where only the 25 s heartbeat could find it. So:

     9.  THE SOCKET IS WOKEN TOO. On online, pageshow, focus and the window being seen again, a socket
         that is down reconnects through the library's own timer NOW, and one that says it is open is
         asked for a heartbeat and replaced if it gets no answer in 2.5 s. A wake-up also forgets the
         channel's backoff, so the next rebuild is quick.
     10. A QUICKER LIBRARY. realtimeOptions() (in both clientOptions() and phoneOptions()) retries the
         socket at 0.25 and 1 s, then every 2 s with a little jitter so a pub's worth of phones do
         not all arrive in the same instant, and heartbeats every 15 s instead of 25. A phone that
         never hears an online event (iOS does not always send one) is then back within about 2.5 s
         of its signal. A failed attempt with no signal costs nothing: the phone's own radio refuses it. */
(function (root) {
  "use strict";
  var MIN_MS = 2000, MAX_MS = 30000, LINGER_MS = 200, LINGER_MAX = 50;
  var SOCKET_RETRY_MS = [250, 1000], SOCKET_RETRY_MAX_MS = 2000, HEARTBEAT_MS = 15000, HEARTBEAT_WAIT_MS = 2500;
  var AWAY_MS = 20000;     // back into view after this long: the socket is asked whether it is alive
  var alive = [];          // every keep() still alive, so a window coming back can poke them all

  function backoff(tries) { return Math.min(MAX_MS, MIN_MS * Math.pow(2, Math.min(tries, 4))); }
  function isDrop(s) { return s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED"; }
  function log(msg) { try { root.console && root.console.log("[venueplay] " + msg); } catch (e) {} }

  /* Rule 7. One listener per event, installed on the first keep(); a page with no document or
     no addEventListener (the test rigs, a worker) simply never pokes. */
  var wired = false, hiddenAt = 0;
  function pokeAll(why) {
    try { if (root.document && root.document.visibilityState === "hidden") return; } catch (e) {}
    var clients = [];
    for (var i = 0; i < alive.length; i++) {
      try { alive[i].poke(why); } catch (e) {}
      try { var c = alive[i].client(); if (c && clients.indexOf(c) < 0) clients.push(c); } catch (e) {}
    }
    /* Rule 9: then the socket under them. */
    for (var j = 0; j < clients.length; j++) { try { wakeSocket(clients[j], why); } catch (e) {} }
  }
  /* Rule 9. Only the library's public surface plus its own reconnect timer, all guarded: a library
     without any of it is left exactly as it was. */
  function hbRef(rt) {
    try { var a = rt.socketAdapter; if (a && "pendingHeartbeatRef" in a) return a.pendingHeartbeatRef; } catch (e) {}
    try { return rt.pendingHeartbeatRef; } catch (e) { return null; }
  }
  function reconnectNow(rt, why) {
    var t = null;
    try { t = rt.reconnectTimer; } catch (e) { t = null; }
    if (t && typeof t.reset === "function" && typeof t.scheduleTimeout === "function") {
      log("realtime socket: reconnecting now (" + why + ")");
      t.reset(); t.scheduleTimeout();               // the library's own path, at its first, shortest step
      return;
    }
    try { if (typeof rt.connect === "function") rt.connect(); } catch (e) {}
  }
  function wakeSocket(client, why) {
    var rt = client && client.realtime;
    if (!rt || typeof rt.connectionState !== "function") return;
    var state = "";
    try { state = rt.connectionState(); } catch (e) { return; }
    if (state === "closed") { reconnectNow(rt, why); return; }
    if (state !== "open") return;                    // connecting or closing: it is already on its way
    /* "focus", a fresh pageshow and a tab flicked away for a moment say nothing about the network. */
    if (why === "focus" || why === "pageshow-fresh") return;
    if (typeof rt.sendHeartbeat !== "function") return;
    /* ASK IT. A socket that lived through "no network" is often still called open by the browser and
       hears nothing ever again. A heartbeat answered in 2.5 s is a socket that works; one that is not is
       replaced by the library's own heartbeat-timeout path (a second heartbeat while one is pending). */
    /* ONE ALREADY OUT. After "online" it left before the network came back and its answer is never
       coming: a second heartbeat now is the library's own "timed out, reconnect" path. Otherwise it may
       simply be on its way, so it gets the same 2.5 s as a fresh one. */
    if (hbRef(rt)) {
      if (why === "online") { log("realtime socket: heartbeat outstanding through the drop, replacing it"); try { rt.sendHeartbeat(); } catch (e) {} return; }
      var held = hbRef(rt);
      setTimeout(function () { if (hbRef(rt) === held) { try { rt.sendHeartbeat(); } catch (e) {} } }, HEARTBEAT_WAIT_MS);
      return;
    }
    try { rt.sendHeartbeat(); } catch (e) { return; }
    var ref = hbRef(rt);
    if (!ref) return;
    setTimeout(function () {
      if (hbRef(rt) !== ref) return;                 // answered (or replaced): nothing to do
      log("realtime socket: no heartbeat answer in " + (HEARTBEAT_WAIT_MS / 1000) + "s after " + why + ", replacing it");
      try { rt.sendHeartbeat(); } catch (e) {}
    }, HEARTBEAT_WAIT_MS);
  }
  var lineT = null;
  function lineUp() { try { return !(root.navigator && root.navigator.onLine === false); } catch (e) { return true; } }
  function stopWatchingLine() { if (lineT) { clearTimeout(lineT); lineT = null; } }
  function watchLine() {
    stopWatchingLine();
    lineT = setTimeout(function () {
      lineT = null;
      if (lineUp()) { log("network back (no online event)"); pokeAll("online"); return; }
      watchLine();
    }, 1000);
  }
  function wire() {
    if (wired) return;
    wired = true;
    try {
      if (root.document && typeof root.document.addEventListener === "function") {
        root.document.addEventListener("visibilitychange", function () {
          var hidden = false;
          try { hidden = root.document.visibilityState === "hidden"; } catch (e) {}
          if (hidden) { hiddenAt = Date.now(); return; }
          var away = hiddenAt ? Date.now() - hiddenAt : 0;
          hiddenAt = 0;
          pokeAll(away >= AWAY_MS ? "visible" : "focus");
        });
      }
      if (typeof root.addEventListener === "function") {
        root.addEventListener("pageshow", function (e) { pokeAll(e && e.persisted ? "pageshow" : "pageshow-fresh"); });
        root.addEventListener("online", function () { stopWatchingLine(); pokeAll("online"); });
        /* "OFFLINE" WITHOUT "ONLINE". A phone that says it lost the network does not always say when it
           has it back, so after an offline the page looks at navigator.onLine once a second and acts on
           the change itself. One timer, only while offline. */
        root.addEventListener("offline", function () { watchLine(); });
        root.addEventListener("focus", function () { pokeAll("focus"); });
      }
    } catch (e) {}
  }

  /* Rule 6. The options a page hands supabase.createClient(). Only ever adds the worker
     heartbeat, and only where a blob worker can actually be made: a browser that cannot gets
     {} and the client it always had. supabase-js 2.118 THROWS from createClient when asked
     for a worker it cannot make, which would take the whole screen down, so the probe is here
     and not left to the library. */
  /* Rule 10. */
  function socketRetryMs(tries) {
    var base = SOCKET_RETRY_MS[tries - 1] || SOCKET_RETRY_MAX_MS;
    return Math.round(base * (0.85 + Math.random() * 0.3));
  }
  function realtimeOptions() { return { reconnectAfterMs: socketRetryMs, heartbeatIntervalMs: HEARTBEAT_MS }; }
  function clientOptions() {
    var rt = realtimeOptions();
    try {
      if (typeof root.Worker !== "function" || typeof root.Blob !== "function" ||
          !root.URL || typeof root.URL.createObjectURL !== "function") return { realtime: rt };
      var url = root.URL.createObjectURL(new root.Blob(["self.close()"], { type: "application/javascript" }));
      var w = new root.Worker(url);
      try { w.terminate(); } catch (e) {}
      try { root.URL.revokeObjectURL(url); } catch (e) {}
      rt.worker = true;
      return { realtime: rt };
    } catch (e) {
      return { realtime: realtimeOptions() };
    }
  }
  /* A PHONE: the quicker socket, no worker heartbeat. A phone's page is either on screen or frozen
     whole by the operating system, so a worker gains it nothing, and it is one less thing to go wrong
     on an old handset. */
  function phoneOptions() { return { realtime: realtimeOptions() }; }

  function keep(client, name, opts) {
    var onStatus = null;     // the page's own status callback
    var cur = null,          // the channel we are on now; null between a drop and its rebuild
        listeners = [],      // every .on(), replayed onto each new channel
        retryT = null, tries = 0, stopped = false,
        gone = null, lingered = 0;   // rule 8: the channel we last let go of, and how long we have waited for it

    function schedule() {
      if (retryT || stopped) return;               // one retry in flight, however many errors land
      var wait = backoff(tries); tries++;
      log(name + " dropped, rebuilding in " + (wait / 1000) + "s");
      retryT = setTimeout(rebuild, wait);
    }
    function rebuild() {
      retryT = null;
      if (stopped) return;
      var old = cur;
      cur = null;                                  // rule 2: let go BEFORE removing
      if (old) { try { client.removeChannel(old); } catch (e) {} }
      gone = old; lingered = 0;
      try { build(); }
      catch (e) { schedule(); }                    // a throw building the next one is not the end of it
    }
    function tell(status) {
      if (!onStatus) return;
      try { onStatus(status); } catch (e) { log(name + " status handler threw: " + e); }
    }
    function build() {
      var mine = client.channel(name, opts);
      if (gone && mine === gone) {                 // rule 8: the one we just hung up, not yet gone
        if (lingered++ < LINGER_MAX) {
          retryT = setTimeout(function () { retryT = null; if (stopped) return; try { build(); } catch (e) { schedule(); } }, LINGER_MS);
          return;
        }
        gone = null; throw new Error("venueplay: " + name + " was never released by the library");
      }
      gone = null;
      cur = mine;
      for (var i = 0; i < listeners.length; i++) mine.on(listeners[i][0], listeners[i][1], listeners[i][2]);
      mine.subscribe(function (status) {
        if (stopped || mine !== cur) return;       // rule 3
        if (status === "SUBSCRIBED") {
          tries = 0;
          if (retryT) { clearTimeout(retryT); retryT = null; }   // rule 5
          tell(status);
          return;
        }
        if (!isDrop(status)) return;
        tell(status);
        schedule();
      });
    }

    var kept = {
      on: function (type, filter, fn) {
        listeners.push([type, filter, fn]);
        if (cur) cur.on(type, filter, fn);
        return kept;
      },
      subscribe: function (cb) {
        onStatus = cb || null;
        if (!cur && !retryT && !stopped) { try { build(); } catch (e) { schedule(); } }
        return kept;
      },
      send: function (msg) {
        if (!cur) throw new Error("venueplay: " + name + " has no channel right now");
        return cur.send(msg);
      },
      unsubscribe: function () {
        stopped = true;
        if (retryT) { clearTimeout(retryT); retryT = null; }
        var old = cur; cur = null;                 // rule 2 again: its CLOSED is not news
        if (old) { try { client.removeChannel(old); } catch (e) {} }
        for (var i = alive.length - 1; i >= 0; i--) { if (alive[i] === kept) alive.splice(i, 1); }
        return Promise.resolve("ok");
      },
      current: function () { return cur; },
      retrying: function () { return !!retryT; },
      /* Rule 7: the window is seen again. A retry waiting on its timer runs now; a channel that
         is connected, or one with nothing booked, is left exactly as it is. */
      client: function () { return client; },
      poke: function (why) {
        if (stopped) return;
        if (why !== "focus" && why !== "pageshow-fresh") tries = 0;   // rule 9: the next rebuild is a quick one
        if (!retryT) return;
        clearTimeout(retryT); retryT = null;
        log(name + " rebuilding now (" + (why || "poked") + ")");
        rebuild();
      }
    };
    alive.push(kept);
    wire();
    return kept;
  }

  root.VPChannel = { keep: keep, backoff: backoff, clientOptions: clientOptions, phoneOptions: phoneOptions,
                     realtimeOptions: realtimeOptions, socketRetryMs: socketRetryMs, pokeAll: pokeAll };
})(typeof window !== "undefined" ? window : this);
