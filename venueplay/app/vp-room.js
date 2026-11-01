/* VenuePlay room client: one WebSocket to the venue's room on Cloudflare (see
 * venueplay-backend/worker/ROOM-SERVER.md).
 *
 * SAFE BY DEFAULT, AND THAT HAS TO MEAN MID-GAME TOO. If the Worker says the room is
 * not enabled (503), if the socket will not open, OR IF IT KEEPS DYING once it has been
 * open, onUnavailable fires ONCE and the page carries on with Supabase Realtime exactly
 * as today.
 *
 * Sustained failure is a decision, on a budget measured in seconds of the page being
 * AWAKE (a covered TV window or a locked phone is frozen, and the time it spent frozen
 * says nothing about the room):
 *
 *                  never open   was open
 *   tv, host          8s          6s      a game is running: less than one bingo ball
 *   phone             8s         30s      a phone walking to the bar loses signal; it
 *                                         comes back to the room rather than move a venue
 *   answers (vpa-)  2.5s          6s      the HTTP road is right there and nothing moves
 *
 * GIVING UP IS FINAL. Once the page has been handed to Supabase the room is closed for
 * good and never reconnects, because a room that came back later would deliver every
 * message twice: once down each road.
 *
 * ONE ROAD PER VENUE (31 Oct 2026, the room becomes the default). A room and a Supabase
 * channel do not cross, so a page that goes back to Supabase ON ITS OWN is a page talking
 * to nobody: a TV whose socket dropped for seven seconds, a phone that could not open one,
 * a console cached from before the switch. So leaving is not a private decision any more.
 * A page that gives up HANDS THE ROOM OVER (POST /room/handover): the room sends every
 * socket in it to Supabase as well and turns away anyone who asks for the next six hours,
 * so a phone that joins late, a console that reloads and a TV that comes back all land on
 * the same road. And a page that is in the room keeps one ear on the old road (watch()):
 * if it hears a bingo console, TV or phone there, that page is on the other road, and the
 * room is handed over to meet it. Messages are the same {t: ...} objects either way, so the
 * receiving side stays VPSign.gate(payload, onMsg).
 *
 * Usage:
 *   var room = VPRoom.connect(API_BASE, "vp-" + CODE, "tv", function (payload) {
 *     VPSign.gate(payload, onMsg);
 *   }, { onUnavailable: function (why, pending) { connectRealtime(); }, onState: function (s) {} });
 *   room.send({ t: "ball", n: 42 });     // queued until open, then sent
 *   room.handover("peer");               // this page heard somebody on the old road
 *   room.close();
 */
(function () {
  "use strict";
  var MAX_QUEUE = 50;
  var BACKOFF_MIN = 1000, BACKOFF_MAX = 30000;
  var BUDGETS = { tv: [8000, 6000], host: [8000, 6000], hq: [8000, 6000], phone: [8000, 30000] };
  var ROOM_BACKOFF_MAX = 8000;   // a venue's room: once it is back, the page is back within seconds
  var CHECK_AFTER_HIDDEN_MS = 20000, CHECK_MS = 4000;
  var ANSWERS_BUDGET = [2500, 6000];
  var MIN_TRIES = 2;             // never give up on a single failed look
  var SLEPT_MS = 5000;           // a timer this late was frozen: the page was asleep, not the room
  var PROBE_MS = 5000;           // a presence check that has not answered by now has failed
  var PING_MS = 25000, PING_MISSES = 2;
  /* A PHONE IS BACK IN SECONDS, NOT AFTER THE BACKOFF (live flight-mode test, 1 Nov 2026: 4 s back after a
     25 s drop, FORTY seconds after a one-minute one). Two things made the minute cost forty seconds:
       1. the browser kept the dead socket "open" and only the heartbeat found it, two missed 25 s pings
          later, and
       2. a wake-up (the network back, the screen back on) did nothing while a look at the room was
          already in flight, which is exactly when the network comes back: that look hung on a line that
          had just gone, for its full five seconds, and then the backoff had its turn.
     So a phone checks its socket every 10 s and calls it dead when a ping gets nothing back in 4 s,
     its backoff stops at 2 s, and every wake-up looks NOW, abandoning a look that is still waiting.
     Pings are answered by Cloudflare without waking the room, so they cost nothing in room time. */
  var PHONE_PING_MS = 10000, PONG_WAIT_MS = 4000, PHONE_BACKOFF_MAX = 2000;
  var TELL_RETRY = [0, 5000, 15000, 45000, 120000, 300000];
  var REASSERT_MS = 2 * 60 * 60 * 1000, REASSERT_FOR_MS = 12 * 60 * 60 * 1000;

  /* IS THE ROOM SERVER ON? One answer, in one place, for all three pages.
     ?roomserver=1 or 0 decides for this browser and STICKS (sessionStorage), because
     opening a console as an HQ admin bounces through hq.html and drops the query string.
     With no flag either way, DEFAULT_ON decides.
     Flipping the whole product between roads is this one constant. */
  var DEFAULT_ON = false;
  var _by = "";                  // how wanted() last decided: "flag" or "default"

  function wanted() {
    try {
      var m = /[?&]roomserver=([01])/.exec(location.search);
      if (m) { try { sessionStorage.setItem("vpRoomServer", m[1]); } catch (e) {} _by = "flag"; return m[1] === "1"; }
      var v = null;
      try { v = sessionStorage.getItem("vpRoomServer"); } catch (e) {}
      if (v === "1") { _by = "flag"; return true; }
      if (v === "0") { _by = "flag"; return false; }
      _by = "default";
      return DEFAULT_ON;
    } catch (e) { _by = "default"; return false; }
  }

  function now() { return Date.now(); }
  function makeCid() {
    var out = "";
    try {
      var c = (typeof crypto !== "undefined" && crypto && crypto.getRandomValues) ? crypto : null;
      if (c) { var a = new Uint8Array(12); c.getRandomValues(a); for (var i = 0; i < a.length; i++) out += ("0" + a[i].toString(16)).slice(-2); }
    } catch (e) { out = ""; }
    while (out.length < 24) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
  function offline() {
    try { return typeof navigator !== "undefined" && !!navigator && navigator.onLine === false; } catch (e) { return false; }
  }

  /* WHO IS ON THE OLD ROAD. Only bingo talks on a venue's main channel by the room's rules,
     but musical and trivia consoles and phones share that channel NAME on Supabase (their
     session code is the venue code), so their traffic must never read as a bingo page that
     missed the room. Consoles of those formats stamp fmt on everything; their phones do not
     sign a join; a page in the room stamps rw on anything it says on the old road. */
  var HOST_SAYS = { host_here: 1, ball: 1, started: 1, cards: 1, card: 1, rollcall: 1, state: 1, mode: 1,
                    winner: 1, claim_pending: 1, players: 1, session: 1, resume: 1, idle: 1 };
  function oldRoadPeer(m) {
    if (!m || typeof m !== "object" || typeof m.t !== "string" || m.rw) return false;
    if (m.fmt && m.fmt !== "bingo") return false;
    if (m.t === "tv_here") return true;
    if (HOST_SAYS[m.t]) return true;
    if ((m.t === "join" || m.t === "claim" || m.t === "leave") && m.pk && m.sig && /^k1_/.test(String(m.pid || ""))) return true;
    return false;
  }

  function post(url) {
    try { return fetch(url, { method: "POST" }); } catch (e) { return Promise.reject(e); }
  }
  function readJson(r) {
    try { return Promise.resolve(r && typeof r.json === "function" ? r.json() : null).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }

  function connect(apiBase, roomName, role, onMsg, opts) {
    opts = opts || {};
    var api = String(apiBase || "").replace(/\/+$/, "");
    var wsBase = api.replace(/^http/, "ws");
    var venueRoom = /^vp-/.test(String(roomName || ""));          // a venue's room, not a game's answers room
    var b = venueRoom ? (BUDGETS[role] || BUDGETS.phone) : ANSWERS_BUDGET;
    var budget = [opts.coldMs || b[0], opts.warmMs || b[1]];
    var handsOver = venueRoom && opts.handover !== false;
    /* A NEW PAGE AGAINST AN OLD WORKER STAYS ON SUPABASE. The site deploys itself from a push and
       the Worker is deployed by hand, so for a while new pages meet the old Worker, whose room
       cannot hand a venue over. Taking the room BY DEFAULT is only safe where it can, so the page
       asks and goes the old way unless the room says handover: true. ?roomserver=1 is a person
       choosing the room on purpose and keeps the old rule. */
    var needsHandover = venueRoom && _by === "default";
    var st = { state: "checking", ws: null, queue: [], backoff: BACKOFF_MIN, closed: false, timer: null,
               downSince: now(), everOpen: false, tries: 0, due: 0, why: "",
               pingT: null, misses: 0, pongSeen: false, tellT: null, tellI: -1, reT: null,
               lastIn: 0, hiddenAt: 0, checkT: null, gen: 0, looking: false };
    var phone = (role === "phone");
    var backoffMax = !venueRoom ? BACKOFF_MAX : phone ? PHONE_BACKOFF_MAX : ROOM_BACKOFF_MAX;
    /* ONE SOCKET PER PAGE, HOWEVER OFTEN IT RECONNECTS (1 Nov 2026: presence counted Dean's one phone
       twice). A socket the phone gave up on in flight mode cannot say goodbye, so the room kept it until
       Cloudflare noticed, and counted it beside the new one. Every socket this page opens carries the same
       random cid, and the room closes any older socket with it. Random and never relayed, deliberately NOT
       the pid: the host reads every pid out to the room, so a pid would let any phone close anyone else's. */
    var cid = makeCid();
    function setState(s) { st.state = s; if (opts.onState) { try { opts.onState(s); } catch (e) {} } }

    // Ask over HTTPS first: a WebSocket cannot tell a 503 from a dead network, and the
    // page needs to know "not enabled" so it can use Supabase instead, right now.
    function probe() {
      if (st.closed) return;
      st.tries++;
      var gen = ++st.gen;                              // a wake-up that starts a new look makes this one history
      st.looking = true;
      var settled = false;
      var late = setTimeout(function () { if (settled) return; settled = true; if (gen !== st.gen) return; st.looking = false; retry(); }, PROBE_MS);
      function done() { if (settled) return false; settled = true; clearTimeout(late); if (gen === st.gen) st.looking = false; return !st.closed && gen === st.gen; }
      fetch(api + "/room/presence?room=" + encodeURIComponent(roomName))
        .then(function (r) {
          var first = done();
          if (st.closed) return;
          /* AN ANSWER IS AN ANSWER, HOWEVER LATE. "Not enabled" arriving after this look was given up
             on still means not enabled, and acting on it now beats spending the whole budget asking
             again: on a slow line (or a loaded test machine) every look timed out and every page
             waited eight seconds for an answer it had already been given. */
          if (r.status === 503 || r.status === 404) {
            return readJson(r).then(function (d) { unavailable(d && d.handed_over ? "handed over" : "not enabled"); });
          }
          if (!first) return;                                      // a late yes: the next look will see it
          if (r.status !== 200) { retry(); return; }               // the room is unwell; the budget decides
          return readJson(r).then(function (d) {
            if (st.closed || gen !== st.gen) return;
            /* NOT OURS. A captive portal answers 200 as well, with its own page. */
            if (!d || typeof d !== "object" || typeof d.total !== "number") { retry(); return; }
            if (needsHandover && d.handover !== true) { unavailable("worker too old"); return; }
            if (opts.onPresence) { try { opts.onPresence(d); } catch (e) {} }
            open();
          });
        })
        .catch(function () { if (done()) retry(); });
    }

    function unavailable(why) {
      if (st.state === "unavailable") return;
      /* STOP EVERYTHING FIRST. The page is about to open a Supabase channel, and a room
         that reconnected afterwards would put every message down both roads: a ball
         called twice, a winner announced twice. */
      st.closed = true;
      st.why = why || "";
      clearTimeout(st.timer); clearTimeout(st.pingT);
      if (st.ws) { var w = st.ws; st.ws = null; try { w.close(1000, "handing over"); } catch (e) {} }
      /* WHAT WAS WAITING TO GO OUT GOES WITH THE PAGE. These were thrown away with the room, so
         the balls a host called in the seconds the socket was down never reached anyone. */
      var pending = [];
      for (var i = 0; i < st.queue.length; i++) { try { pending.push(JSON.parse(st.queue[i])); } catch (e) {} }
      st.queue = [];
      setState("unavailable");
      if (handsOver) {
        var leftOnItsOwn = (why === "lost" || why === "no answer" || why === "peer");
        /* The console also marks the room when the switch is on, so a venue that crossed while
           ROOM_OFF was set stays across when it is cleared, and keeps the mark for a long
           night. A TV or a phone that was simply told "not enabled" has nothing to add. */
        if (leftOnItsOwn || (role === "host" && why === "not enabled")) tell(0);
        if (role === "host" && why !== "worker too old") reassert(now());
      }
      if (opts.onUnavailable) { try { opts.onUnavailable(why, pending); } catch (e) {} }
    }

    /* TELL THE ROOM, SO EVERYONE ELSE COMES TOO. Best effort, a few times: the page that gave up
       is often the one on the bad network, and the moment it can reach us again is the moment
       the rest of the venue needs to move. 503, 404 and 400 are answers, not failures. */
    function tell(i) {
      clearTimeout(st.tellT);
      st.tellI = -1;
      if (i >= TELL_RETRY.length) return;
      st.tellI = i;
      st.tellT = setTimeout(function () {
        st.tellI = -1;
        post(api + "/room/handover?room=" + encodeURIComponent(roomName))
          .then(function (r) { if (!r || (r.status >= 500 && r.status !== 503)) tell(i + 1); })
          .catch(function () { tell(i + 1); });
      }, TELL_RETRY[i]);
    }
    function reassert(since) {
      clearTimeout(st.reT);
      st.reT = setTimeout(function () {
        if (now() - since > REASSERT_FOR_MS) return;
        post(api + "/room/handover?room=" + encodeURIComponent(roomName)).catch(function () {});
        reassert(since);
      }, REASSERT_MS);
    }

    function open() {
      if (st.closed) return;
      setState("connecting");
      var ws;
      try {
        ws = new WebSocket(wsBase + "/room/ws?room=" + encodeURIComponent(roomName) + "&role=" + encodeURIComponent(role) +
                           (venueRoom ? "&cid=" + cid : ""));
      } catch (e) { retry(); return; }
      st.ws = ws;
      /* A SOCKET THAT NEITHER OPENS NOR FAILS. Every budget below is armed by onclose or
         onerror, so a socket that simply HANGS armed nothing and the page sat on
         "connecting" for ever with no timer pending at all. That is what a venue's captive
         portal does, and what happens when wifi drops the moment the handshake starts. Give
         the handshake the rest of the budget and then treat silence as failure. */
      var budgetLeft = Math.max(500, (st.downSince || now()) +
                                     (st.everOpen ? budget[1] : budget[0]) - now());
      var handshake = setTimeout(function () {
        if (st.closed || st.ws !== ws || ws.readyState === 1) return;
        st.ws = null;                                 // let go first: its close is not news
        try { ws.close(); } catch (e) {}
        retry();
      }, budgetLeft);
      ws.onopen = function () {
        if (st.ws !== ws) return;
        clearTimeout(handshake);
        st.backoff = BACKOFF_MIN;
        st.everOpen = true;
        st.downSince = 0;
        st.misses = 0;
        setState("open");
        while (st.queue.length) { try { ws.send(st.queue.shift()); } catch (e) { break; } }
        beat();
      };
      ws.onmessage = function (ev) {
        if (st.ws !== ws) return;
        st.misses = 0;                                // anything at all is proof of life
        st.lastIn = now();
        if (ev.data === "pong") { st.pongSeen = true; return; }
        var obj;
        try { obj = JSON.parse(ev.data); } catch (e) { return; }
        if (!obj || typeof obj !== "object") return;
        if (obj.t === "room_handover") { unavailable("handed over"); return; }
        try { onMsg(obj); } catch (e) {}
      };
      ws.onclose = function (ev) {
        clearTimeout(handshake);
        if (st.ws !== ws) return;                     // a socket we already let go of
        st.ws = null;
        clearTimeout(st.pingT); clearTimeout(st.checkT);
        if (ev && ev.code === 4503) { unavailable("handed over"); return; }   // the room sent everyone across
        if (!st.closed) retry();
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    /* THE HEARTBEAT. Between games a socket can sit silent for an hour, and a venue's router
       will cut an idle connection without telling either end: the TV says connected and hears
       nothing when the first ball goes. Every 25 seconds the page says "ping" and the room
       (Cloudflare, without waking it) says "pong". Two pings with no answer is a dead socket.
       It only judges once a pong has been heard, so an older Worker that never answers is not
       hung up on every minute. Counted in pings, not seconds, so a frozen window that only
       wakes once a minute is not mistaken for a dead room. */
    function beat() {
      clearTimeout(st.pingT);
      if (phone && venueRoom) {
        /* A PHONE ASKS MORE OFTEN AND WAITS LESS. Not while the page is hidden: a locked phone is frozen,
           and the wake-up below looks the moment it is seen again. */
        st.pingT = setTimeout(function () {
          var ws = st.ws;
          if (st.closed || !ws || ws.readyState !== 1) return;
          if (!st.pongSeen) { try { ws.send("ping"); } catch (e) {} }   // an older Worker never answers: it is never judged
          else if (!hiddenNow()) checkAlive(PONG_WAIT_MS);
          beat();
        }, PHONE_PING_MS);
        return;
      }
      st.pingT = setTimeout(function () {
        var ws = st.ws;
        if (st.closed || !ws || ws.readyState !== 1) return;
        if (st.pongSeen && st.misses >= PING_MISSES) {
          st.ws = null;
          try { ws.close(); } catch (e) {}
          retry();
          return;
        }
        st.misses++;
        try { ws.send("ping"); } catch (e) {}
        beat();
      }, PING_MS);
    }

    function retry() {
      if (st.closed) return;
      var t = now();
      if (!st.downSince) { st.downSince = t; st.tries = 0; }
      /* OFFLINE IS NOT A BROKEN ROOM. A phone in flight mode, or one that has lost all signal,
         cannot reach Supabase either, so leaving the room gains nothing and leaving ALONE is the
         one thing that strands it: on 1 Nov 2026 Dean's phone went to flight mode for 25 seconds
         mid-game, gave the room up after six, came back on Supabase by itself, and sat on
         "waiting for the host" while the console carried on in the room. Time with no network at
         all is not spent from the budget; the browser's online event brings it straight back. */
      if (offline()) { st.downSince = t; st.tries = 0; }
      var b2 = st.everOpen ? budget[1] : budget[0];
      /* THE DECISION THAT WAS MISSING. Trying for ever is not "safe by default", it is a
         screen that says Reconnecting all night while the host wonders why the wall is
         stuck. Past the budget, hand the page to Supabase and stay out of the way. */
      if (t - st.downSince >= b2 && st.tries >= MIN_TRIES) { unavailable(st.everOpen ? "lost" : "no answer"); return; }
      setState("reconnecting");
      clearTimeout(st.timer);
      // Never sleep past the budget: a 30 second backoff would decide 24 seconds too late.
      var wait = Math.min(st.backoff, Math.max(0, st.downSince + b2 - t));
      st.due = t + wait;
      st.timer = setTimeout(function () {
        st.timer = null;
        /* FROZEN, NOT FAILED. Chrome freezes a covered window's timers to once a minute and a
           phone freezes a locked page completely, so this can fire minutes late. Those minutes
           were the page asleep, not the room failing, and spending the budget on them sent a
           TV in a covered window to Supabase on its first look back. Start the budget again. */
        if (now() - st.due > SLEPT_MS) { st.downSince = now(); st.tries = 0; }
        probe();
      }, wait);
      st.backoff = Math.min(backoffMax, st.backoff * 2);
    }

    /* THE WINDOW IS SEEN AGAIN, THE PHONE IS UNLOCKED, THE WIFI IS BACK: look now, with a fresh
       budget, instead of whenever the frozen timer gets round to it. */
    function hiddenNow() {
      try { return typeof document !== "undefined" && !!document && document.visibilityState === "hidden"; } catch (e) { return false; }
    }
    function wake() {
      if (st.closed || st.ws) return;                 // open or opening: nothing to wake
      if (!st.timer && !st.looking) return;           // nothing waiting (closed for good, or not started)
      if (hiddenNow()) return;
      /* A LOOK STILL IN FLIGHT IS ABANDONED, NOT WAITED ON. It left while the line was down and can hang
         for its whole five seconds; the network that just came back answers a new one in a fraction of
         that. Its answer, if it ever comes, is history (st.gen). */
      clearTimeout(st.timer); st.timer = null;
      st.downSince = now(); st.tries = 0; st.backoff = BACKOFF_MIN;
      probe();
    }
    /* A SOCKET THAT LIVED THROUGH "NO NETWORK" IS NOT TO BE TRUSTED. A phone in flight mode often
       never hears its socket close: the browser still calls it open, the room still counts it,
       and nothing more arrives down it. So when the network comes back, an open socket is
       replaced at once, and the page announces itself again on the new one (onState "open"),
       which is what makes the host send it the game as it stands. */
    function recycle() {
      var ws = st.ws;
      if (st.closed || !ws) return;
      st.ws = null;
      clearTimeout(st.pingT); clearTimeout(st.checkT);
      try { ws.close(); } catch (e) {}
      st.downSince = now(); st.tries = 0; st.backoff = BACKOFF_MIN;
      setState("reconnecting");
      clearTimeout(st.timer); st.timer = null;
      probe();
    }
    function tellNow(i) {
      st.tellI = -1;
      post(api + "/room/handover?room=" + encodeURIComponent(roomName))
        .then(function (r) { if (!r || (r.status >= 500 && r.status !== 503)) tell(i + 1); })
        .catch(function () { tell(i + 1); });
    }
    function backOnline() {
      if (st.closed) {
        /* A handover that could not be told while the network was down is told now. */
        if (st.tellI >= 0) { var i = st.tellI; clearTimeout(st.tellT); tellNow(i); }
        return;
      }
      if (st.ws && (st.ws.readyState === 1 || st.ws.readyState === 0)) { recycle(); return; }
      wake();
    }
    /* BACK INTO VIEW AFTER A WHILE: ask the room if it is still there. A ping that gets nothing at
       all in four seconds means the socket died while the page was away, and it is replaced now
       rather than after two missed heartbeats (most of a minute of balls). */
    function checkAlive(waitMs) {
      var ws = st.ws;
      if (st.closed || !ws || ws.readyState !== 1 || !st.pongSeen) return;
      var asked = now();
      try { ws.send("ping"); } catch (e) { recycle(); return; }
      clearTimeout(st.checkT);
      st.checkT = setTimeout(function () {
        if (st.ws !== ws || st.lastIn >= asked) return;
        /* A TIMER THAT FIRED LATE IS A FROZEN PAGE, NOT A DEAD SOCKET. Ask again rather than hang up. */
        if (now() - asked > (waitMs || CHECK_MS) + SLEPT_MS) return;
        recycle();
      }, waitMs || CHECK_MS);
    }
    /* THE NETWORK WENT. Nothing can be sent or heard, and the socket the browser still calls open will
       never say so. Let it go now, so the room is not left counting it and the page is already waiting
       to look when the network comes back. Time offline is not spent from the budget (retry). */
    function wentOffline() {
      if (st.closed || !venueRoom) return;
      var ws = st.ws;
      if (!ws) return;
      st.ws = null;
      clearTimeout(st.pingT); clearTimeout(st.checkT);
      try { ws.close(); } catch (e) {}
      retry();
    }
    function onVisibility() {
      var hidden = false;
      try { hidden = document.visibilityState === "hidden"; } catch (e) {}
      if (hidden) { st.hiddenAt = now(); return; }
      var away = st.hiddenAt ? now() - st.hiddenAt : 0;
      st.hiddenAt = 0;
      if (away >= CHECK_AFTER_HIDDEN_MS) checkAlive(phone ? PONG_WAIT_MS : CHECK_MS);
      wake();
    }
    try {
      if (typeof document !== "undefined" && document && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
        window.addEventListener("pageshow", wake);
        window.addEventListener("online", backOnline);
        window.addEventListener("offline", wentOffline);
        window.addEventListener("focus", wake);
      }
    } catch (e) {}

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
      clearTimeout(st.timer); clearTimeout(st.pingT); clearTimeout(st.tellT); clearTimeout(st.reT); clearTimeout(st.checkT);
      if (st.ws) { var w = st.ws; st.ws = null; try { w.close(1000, "page"); } catch (e) {} }
      setState("closed");
    }

    probe();
    return { send: send, close: close, state: function () { return st.state; },
             handover: function (why) { if (!st.closed) unavailable(why || "peer"); },
             why: function () { return st.why; } };
  }

  /* ONE EAR ON THE OLD ROAD. A page in the room listens, and only listens, on the Supabase
     channel of the same name. If a bingo console, TV or phone speaks there, it is a page on the
     other road (cached from before the switch, or one that gave up on the room by itself), and
     onPeer is told once so the page can hand the room over to meet it. hello(send) lets a
     console say host_here there so an old TV answers; the page stamps rw on what it says, so
     another page's ear does not take it for a peer. One channel on a connection the TV already
     holds; one connection for a console. Phones never listen: they are the many. */
  function watch(client, name, opts) {
    opts = opts || {};
    var ch = null, done = false, heard = false;
    try {
      ch = client.channel(name, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "msg" }, function (e) {
        if (done || heard) return;
        var p = e && e.payload;
        var judge = function (m) {
          if (done || heard || !oldRoadPeer(m)) return;
          heard = true;
          try { console.log("[venueplay] heard " + m.t + " on the old road: handing the room over"); } catch (x) {}
          if (opts.onPeer) { try { opts.onPeer(m); } catch (x) {} }
        };
        if (opts.gate) { try { opts.gate(p, judge); } catch (x) {} } else { judge(p); }
      });
      ch.subscribe(function (status) {
        if (done || status !== "SUBSCRIBED" || !opts.hello) return;
        try {
          opts.hello(function (payload) {
            if (done || !ch) return;
            try { ch.send({ type: "broadcast", event: "msg", payload: payload }); } catch (x) {}
          });
        } catch (x) {}
      });
    } catch (e) { ch = null; }
    return {
      heard: function () { return heard; },
      /* LET GO, AND WAIT UNTIL IT IS GONE. supabase-js hands back the SAME channel for a topic
         it still holds until the server acknowledges the leave, so the page's own channel on
         this name has to wait for it or it subscribes a channel that is leaving, silently. */
      release: function () {
        done = true;
        var c = ch; ch = null;
        if (!c) return Promise.resolve();
        var p = null;
        try { p = client.removeChannel(c); } catch (e) { p = null; }
        return Promise.resolve(p).catch(function () {}).then(function () {
          return new Promise(function (resolve) {
            var waited = 0;
            (function check() {
              var held = false;
              try { held = !!(client.getChannels && client.getChannels().indexOf(c) >= 0); } catch (e) { held = false; }
              if (!held || waited >= 3000) { resolve(); return; }
              waited += 100; setTimeout(check, 100);
            })();
          });
        });
      }
    };
  }

  /* SAY ONE THING INTO A ROOM AND LEAVE. For pages that are not in it, like Venue settings
     telling the TV a slide changed. A room that is off, or not there, just fails quietly: the
     same message has already gone down the old road. */
  function sayOnce(apiBase, roomName, payload) {
    try {
      var api = String(apiBase || "").replace(/\/+$/, "").replace(/^http/, "ws");
      var ws = new WebSocket(api + "/room/ws?room=" + encodeURIComponent(roomName) + "&role=hq");
      var bye = setTimeout(function () { try { ws.close(); } catch (e) {} }, 8000);
      ws.onopen = function () {
        try { ws.send(JSON.stringify(payload)); } catch (e) {}
        setTimeout(function () { clearTimeout(bye); try { ws.close(1000, "said"); } catch (e) {} }, 1200);
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    } catch (e) {}
  }

  window.VPRoom = { connect: connect, wanted: wanted, watch: watch, sayOnce: sayOnce, oldRoadPeer: oldRoadPeer,
                    defaultOn: function () { return DEFAULT_ON; },
                    byDefault: function () { return _by === "default"; } };
})();
