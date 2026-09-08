/* VenuePlay room client: one WebSocket to the venue's room on Cloudflare (see
 * venueplay-backend/worker/ROOM-SERVER.md).
 *
 * WRITTEN OVERNIGHT 9 SEP 2026. NOT WIRED INTO ANY PAGE YET. Test on The Mini Bar
 * behind ?room=1 before any page loads it by default.
 *
 * SAFE BY DEFAULT. If the Worker says the room server is not enabled (503), or the
 * socket cannot be opened, onUnavailable fires once and the page carries on with
 * Supabase Realtime exactly as today. Messages are the same {type: ...} objects the
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

  function connect(apiBase, roomName, role, onMsg, opts) {
    opts = opts || {};
    var api = String(apiBase || "").replace(/\/+$/, "");
    var wsBase = api.replace(/^http/, "ws");
    var st = { state: "checking", ws: null, queue: [], backoff: BACKOFF_MIN, closed: false, timer: null };
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
      ws.onopen = function () {
        st.backoff = BACKOFF_MIN;
        setState("open");
        while (st.queue.length) { try { ws.send(st.queue.shift()); } catch (e) { break; } }
      };
      ws.onmessage = function (ev) {
        var obj;
        try { obj = JSON.parse(ev.data); } catch (e) { return; }
        if (!obj || typeof obj !== "object") return;
        try { onMsg(obj); } catch (e) {}
      };
      ws.onclose = function () { st.ws = null; if (!st.closed) retry(); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    function retry() {
      if (st.closed) return;
      setState("reconnecting");
      clearTimeout(st.timer);
      st.timer = setTimeout(probe, st.backoff);
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

  window.VPRoom = { connect: connect };
})();
