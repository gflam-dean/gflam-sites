/* VenuePlay room client: one WebSocket to the venue's room on Cloudflare (see
 * venueplay-backend/worker/ROOM-SERVER.md).
 *
 * SAFE BY DEFAULT, AND THAT HAS TO MEAN MID-GAME TOO. If the Worker says the room is
 * not enabled (503), if the socket will not open, OR IF IT KEEPS DYING once it has been
 * open, onUnavailable fires ONCE and the page carries on with Supabase Realtime exactly
 * as today.
 *
 * That last case is the one that was missing, and it is the one a pub would notice. The
 * client used to re-probe for ever on a 1 to 30 second backoff, so a room that went away
 * mid-question left the page saying "Reconnecting" indefinitely with the host's balls
 * piling up in a queue, and nothing ever decided to go back to Supabase. Now sustained
 * failure is a decision, on a budget measured in seconds:
 *
 *   never been open   2.5s   nothing is in flight and Supabase is sitting right there,
 *                            so a slow first connect must not hold up a screen
 *   was open          6.0s   less than one bingo ball, and a game is running, so it is
 *                            worth a couple of retries before moving the room
 *
 * GIVING UP IS FINAL. Once the page has been handed to Supabase the room is closed for
 * good and never reconnects, because a room that came back later would deliver every
 * message twice: once down each road. Messages are the same {type: ...} objects the
 * pages already send and receive, so the receiving side stays
 *     VPSign.gate(payload, onMsg)
 * and the sending side stays whatever the page passes as rawSend.
 *
 * Usage:
 *   var room = VPRoom.connect(API_BASE, "vp-" + CODE, "tv", function (payload) {
 *     VPSign.gate(payload, onMsg);
 *   }, { onUnavailable: connectRealtime, onState: function (s) {} });
 *   room.send({ type: "ball", n: 42 });     // queued until open, then sent
 *   room.close();
 */
(function () {
  "use strict";
  var MAX_QUEUE = 50;
  var BACKOFF_MIN = 1000, BACKOFF_MAX = 30000;
  var GIVE_UP_COLD_MS = 2500;    // never managed to open one
  var GIVE_UP_WARM_MS = 6000;    // had one, lost it, a game is on

  /* IS THE ROOM SERVER ON? One answer, in one place, for all three pages.
     ?roomserver=1 or 0 decides for this browser and STICKS (sessionStorage), because
     opening a console as an HQ admin bounces through hq.html and drops the query string.
     With no flag either way, DEFAULT_ON decides.
     Flipping the whole product between roads is this one constant. */
  var DEFAULT_ON = false;

  function wanted() {
    try {
      var m = /[?&]roomserver=([01])/.exec(location.search);
      if (m) { try { sessionStorage.setItem("vpRoomServer", m[1]); } catch (e) {} return m[1] === "1"; }
      var v = null;
      try { v = sessionStorage.getItem("vpRoomServer"); } catch (e) {}
      if (v === "1") return true;
      if (v === "0") return false;
      return DEFAULT_ON;
    } catch (e) { return false; }
  }

  function connect(apiBase, roomName, role, onMsg, opts) {
    opts = opts || {};
    var api = String(apiBase || "").replace(/\/+$/, "");
    var wsBase = api.replace(/^http/, "ws");
    var st = { state: "checking", ws: null, queue: [], backoff: BACKOFF_MIN, closed: false, timer: null,
               downSince: Date.now(), everOpen: false };
    function setState(s) { st.state = s; if (opts.onState) { try { opts.onState(s); } catch (e) {} } }

    // Ask over HTTPS first: a WebSocket cannot tell a 503 from a dead network, and the
    // page needs to know "not enabled" so it can use Supabase instead, right now.
    function probe() {
      if (st.closed) return;
      fetch(api + "/room/presence?room=" + encodeURIComponent(roomName))
        .then(function (r) {
          if (r.status === 503 || r.status === 404) { unavailable("not enabled"); return; }
          open();
        })
        .catch(function () { retry(); });
    }

    function unavailable(why) {
      if (st.state === "unavailable") return;
      /* STOP EVERYTHING FIRST. The page is about to open a Supabase channel, and a room
         that reconnected afterwards would put every message down both roads: a ball
         called twice, a winner announced twice. */
      st.closed = true;
      clearTimeout(st.timer);
      if (st.ws) { try { st.ws.close(1000, "handing over"); } catch (e) {} st.ws = null; }
      setState("unavailable");
      if (opts.onUnavailable) { try { opts.onUnavailable(why); } catch (e) {} }
    }

    function open() {
      if (st.closed) return;
      setState("connecting");
      var ws;
      try {
        ws = new WebSocket(wsBase + "/room/ws?room=" + encodeURIComponent(roomName) + "&role=" + encodeURIComponent(role));
      } catch (e) { retry(); return; }
      st.ws = ws;
      /* A SOCKET THAT NEITHER OPENS NOR FAILS. Every budget below is armed by onclose or
         onerror, so a socket that simply HANGS armed nothing and the page sat on
         "connecting" for ever with no timer pending at all. That is not a theoretical
         state: it is what a venue's captive portal does, and what happens when wifi
         drops the moment the handshake starts. Give the handshake the rest of the budget
         and then treat silence as failure, which is what it is. */
      var budgetLeft = Math.max(500, (st.downSince || Date.now()) +
                                     (st.everOpen ? GIVE_UP_WARM_MS : GIVE_UP_COLD_MS) - Date.now());
      var handshake = setTimeout(function () {
        if (st.closed || st.ws !== ws || ws.readyState === 1) return;
        try { ws.close(); } catch (e) {}
        if (st.ws === ws) { st.ws = null; retry(); }
      }, budgetLeft);
      ws.onopen = function () {
        clearTimeout(handshake);
        st.backoff = BACKOFF_MIN;
        st.everOpen = true;
        st.downSince = 0;
        setState("open");
        while (st.queue.length) { try { ws.send(st.queue.shift()); } catch (e) { break; } }
      };
      ws.onmessage = function (ev) {
        var obj;
        try { obj = JSON.parse(ev.data); } catch (e) { return; }
        if (!obj || typeof obj !== "object") return;
        try { onMsg(obj); } catch (e) {}
      };
      ws.onclose = function () { clearTimeout(handshake); st.ws = null; if (!st.closed) retry(); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    function retry() {
      if (st.closed) return;
      var now = Date.now();
      if (!st.downSince) st.downSince = now;
      /* THE DECISION THAT WAS MISSING. Trying for ever is not "safe by default", it is a
         screen that says Reconnecting all night while the host wonders why the wall is
         stuck. Past the budget, hand the page to Supabase and stay out of the way. */
      var budget = st.everOpen ? GIVE_UP_WARM_MS : GIVE_UP_COLD_MS;
      if (now - st.downSince >= budget) { unavailable(st.everOpen ? "lost" : "no answer"); return; }
      setState("reconnecting");
      clearTimeout(st.timer);
      // Never sleep past the budget: a 30 second backoff would decide 24 seconds too late.
      var wait = Math.min(st.backoff, Math.max(0, st.downSince + budget - now));
      st.timer = setTimeout(probe, wait);
      st.backoff = Math.min(BACKOFF_MAX, st.backoff * 2);
    }

    function send(obj) {
      var s;
      try { s = JSON.stringify(obj); } catch (e) { return false; }
      if (st.ws && st.ws.readyState === 1) { try { st.ws.send(s); return true; } catch (e) {} }
      if (st.queue.length >= MAX_QUEUE) st.queue.shift();   // keep the newest; an old ball is no use
      st.queue.push(s);
      return false;
    }

    function close() {
      st.closed = true;
      clearTimeout(st.timer);
      if (st.ws) { try { st.ws.close(1000, "page"); } catch (e) {} }
      setState("closed");
    }

    probe();
    return { send: send, close: close, state: function () { return st.state; } };
  }

  window.VPRoom = { connect: connect, wanted: wanted, defaultOn: function () { return DEFAULT_ON; } };
})();
