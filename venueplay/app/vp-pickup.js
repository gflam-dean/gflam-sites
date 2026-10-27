/* ============================================================================
   PICK UP A RUNNING GAME FROM ANY DEVICE.

   Dean, 20 Oct 2026: "it would be shit to not be able to fix something to let a
   venue play a night on a night".

   The trivia and musical bingo consoles recovered a live game only from THIS
   tablet's localStorage (vpTriviaGame-<venue>, vpMusicGame-<venue>). A tablet
   that died mid-quiz left the host, signed in on any other device, on a fresh
   setup screen while the game was still running on the server and the room was
   still seated; a restart began again at question 1.

   VP_PICKUP is the one copy of the fix, for both consoles:

     find(post, venueId, format)   asks the game Worker (/host/running, staff at
                                   this venue only) whether a game of this format
                                   is running here. Resolves the running game,
                                   null for none, or undefined when it could not
                                   tell (old Worker, no network): the console
                                   then recovers the old way, from this tablet.
     decide(save, running)         'none'    nothing is running
                                   'restore' this tablet's own saved game, and
                                             nobody else has picked it up since:
                                             recover it silently, as always
                                   'ask'     running, but started or picked up
                                             somewhere else: ask the host
     ask(format)                   "A quiz is running at this venue. Pick it up?"
                                   on the page (VP.askOnPage, never a native
                                   confirm). Resolves true or false.
     take(post, venueId, run, cid) records on the server that this console now
                                   runs it (/host/running/take)
     arm(opts) / heard(cid)        A console that is replaced stands down. It
                                   asks the Worker who holds its game when it
                                   wakes, every two minutes, and when it hears
                                   another console's heartbeat (host_here carries
                                   the sender's console id). A heartbeat alone
                                   never stands anything down: anybody on the
                                   channel can send one, so only the Worker's
                                   answer counts.
     newId()                       a console id, from crypto.getRandomValues

   One console per game across devices is this file's question. One console per
   TABLET is vp-onetab.js's (tabs on one device), and one lobby per room is
   VP.confirmTakeover's. They do not overlap.

   Load after vp-session.js and vp-onetab.js:
       <script src="/app/vp-pickup.js"></script>
   ========================================================================== */
(function(root){
  "use strict";

  var CHECK_EVERY_MS = 120000;   // a console that slept through everything still finds out
  var HEARD_GAP_MS = 15000;      // a burst of heartbeats is one question to the Worker

  function newId(){
    var b = new Uint8Array(12), out = "c";
    try { root.crypto.getRandomValues(b); } catch (e) { for (var j = 0; j < b.length; j++) b[j] = (Date.now() >> (j % 8)) & 255; }
    for (var i = 0; i < b.length; i++) out += ("0" + b[i].toString(16)).slice(-2);
    return out;
  }

  /* undefined = could not tell. null = nothing running. Otherwise the running game. */
  function find(post, venueId, format){
    if (!post || !venueId) return Promise.resolve(undefined);
    return Promise.resolve().then(function(){ return post("/host/running", { venue_id: venueId, format: format }); })
      .then(function(r){ return (r && Object.prototype.hasOwnProperty.call(r, "running")) ? (r.running || null) : undefined; },
            function(){ return undefined; });
  }

  function decide(save, running){
    if (!running || !running.session_id || !running.game_id) return "none";
    if (save && save.sessionId === running.session_id && (!running.holder || running.holder === save.cid)) return "restore";
    return "ask";
  }

  function words(format){
    return format === "musical_bingo"
      ? { title: "A musical bingo game is running at this venue. Pick it up?",
          text: "It was started on another device. Picking it up here carries on the same game: the songs already played, the same cards. The other device stops running it." }
      : { title: "A quiz is running at this venue. Pick it up?",
          text: "It was started on another device. Picking it up here carries on the same quiz: the same question, scores and teams. The other device stops running it." };
  }

  function ask(format){
    var w = words(format);
    if (!(root.VP && root.VP.askOnPage)) return Promise.resolve(true);   // no dialog to ask with: picking it up beats a blank console
    return root.VP.askOnPage(w.title, w.text, "Pick it up here", "Not now");
  }

  function take(post, venueId, run, cid){
    return Promise.resolve().then(function(){
      return post("/host/running/take", { venue_id: venueId, game_id: run.game_id, console_id: cid });
    });
  }

  /* ---- KEEP ASKING WHEN THE FIRST LOOKUP GOT NO ANSWER (20 Oct 2026) ----
     On slow pub wifi the first "is a game running?" can take longer than the console waits (15 s),
     and find() then says "could not tell". The console falls back to this tablet's own save, which a
     NEW device does not have, so the host was left on the setup screen with the room seated and was
     never asked again. This keeps asking in the background and, if a running game turns up, asks the
     host the same question.
       opts: { post, venueId, format,
               stop()      true once the host has moved on (a lobby open, a game on this console):
                           checked before every try and again before the question goes up
               onFound(run) a running game turned up while still on the setup screen
               wait(ms)    returns a promise that resolves after ms (tests pass their own clock) }
     Stops for good on the first real answer (a game, or "nothing running"), or after the last
     try. Backoff: 5, 10, 20, 30 seconds, then every 60 seconds, for about ten minutes. */
  var RETRY_MS = [5000, 10000, 20000, 30000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000];
  function keepAsking(opts){
    var o = opts || {}, i = 0, done = false;
    var wait = o.wait || function(ms){ return new Promise(function(res){ root.setTimeout(res, ms); }); };
    function stopped(){ try { return done || !!(o.stop && o.stop()); } catch (e) { return true; } }
    function next(){
      if (stopped() || i >= RETRY_MS.length) { done = true; return Promise.resolve(null); }
      return wait(RETRY_MS[i++]).then(function(){
        if (stopped()) { done = true; return null; }
        return find(o.post, o.venueId, o.format).then(function(run){
          if (run === undefined) return next();              // still no answer: try again later
          var hostMovedOn = stopped();                       // read BEFORE done is set, or it is always true
          done = true;                                       // an answer: never ask again
          if (run && !hostMovedOn && o.onFound) { try { o.onFound(run); } catch (e) {} }
          return run;
        });
      });
    }
    return { promise: next(), cancel: function(){ done = true; } };
  }

  /* ---- standing down when replaced ---- */
  var W = null, down = false, lastHeard = 0, iv = null, listening = false;

  /* opts: { post, venueId, format, sessionId(), cid(), onMoved() } */
  function arm(opts){
    W = opts || null; down = false;
    if (!iv) iv = setInterval(function(){ check(); }, CHECK_EVERY_MS);
    if (!listening) {
      listening = true;
      try {
        root.addEventListener("pageshow", function(){ check(); });
        root.document.addEventListener("visibilitychange", function(){
          if (root.document.visibilityState === "visible") check();
        });
      } catch (e) {}
    }
  }

  /* Resolves true while this console still holds its game (or cannot tell), false once it has
     stood down. Never stands down on a failed read: a network blip is not a takeover. */
  var inflight = null;
  function check(){
    if (!W || down) return Promise.resolve(!down);
    var sid = W.sessionId && W.sessionId();
    if (!sid) return Promise.resolve(true);
    if (inflight) return inflight;   // waking fires pageshow AND visibilitychange: one question
    inflight = find(W.post, W.venueId, W.format).then(function(run){
      inflight = null;
      if (down) return false;
      var mine = W.cid && W.cid();
      // Re-read the session at the answer: the console may have moved on while we asked.
      if (run && run.session_id === (W.sessionId && W.sessionId()) && run.holder && run.holder !== mine) {
        down = true;
        try { if (W.onMoved) W.onMoved(run); } catch (e) {}
        return false;
      }
      return true;
    }, function(){ inflight = null; return true; });
    return inflight;
  }

  function heard(cid){
    if (!W || down || !cid) return;
    if (W.cid && cid === W.cid()) return;
    var now = Date.now();
    if (now - lastHeard < HEARD_GAP_MS) return;
    lastHeard = now;
    check();
  }

  /* The notice a replaced console shows, worded for a device rather than a tab. */
  function standDownNotice(format){
    var quiz = format === "musical_bingo" ? "game" : "quiz";
    if (root.VP_ONETAB && root.VP_ONETAB.moved) {
      root.VP_ONETAB.moved({
        title: "This " + quiz + " was picked up on another device",
        text: "Somebody picked it up on another device, so this one has stepped back and will not send anything. Use that device, or pick it up here again.",
        takeLabel: "Pick it up here",
        takingLabel: "Checking...",
        onTake: function(){ try { root.location.reload(); } catch (e) {} }
      });
    }
  }

  root.VP_PICKUP = {
    newId: newId, find: find, decide: decide, ask: ask, take: take, words: words, keepAsking: keepAsking, RETRY_MS: RETRY_MS,
    arm: arm, check: check, heard: heard, standDownNotice: standDownNotice,
    isDown: function(){ return down; }
  };
})(typeof window !== "undefined" ? window : this);
