/* ============================================================================
   THE BIG SCREEN FOLLOWS THE NIGHT.

   Every game screen watches the venue's other game channels so one /tv link can
   follow whatever the host puts on. Each of the four screens carried its own
   copy of that logic, they drifted, and two faults came out of it:

   1. They hopped only on t:"mode". A host announces the mode ONCE, when their
      console subscribes. If the screen was showing another game at that moment,
      or the console had been opened earlier in the night, that single message was
      the only invitation it ever got. The raffle then drew its numbers with the
      wall still showing the finished quiz, because "drawing" is not "mode".

   2. A screen whose own phase was not "idle" refused to move, forever. A quiz
      the host walked away from without ending stays not-idle for the rest of the
      night, so nothing could ever take the screen back.

   So: hop on any traffic that means a game is genuinely on air, and treat our own
   game as live only while it is still saying something.
   ========================================================================== */
(function (root) {
  "use strict";

  var GAMES = ["bingo", "trivia", "musical", "raffle", "members"];
  /* No .html on any of these. Cloudflare Pages answers every .html URL with a
     308 to the extensionless one, so each hop was paying a whole extra round
     trip before the page even began to load. On pub wifi at eight o'clock that
     is the difference between the screen following the host and the room
     watching it think about it. */
  var URLS = {
    bingo:   "/tv?venue=",
    trivia:  "/app/trivia/screen?venue=",
    musical: "/app/musical/screen?venue=",
    raffle:  "/app/raffle/screen?venue=",
    members: "/app/members/screen?venue="
  };

  /* Presence and housekeeping, never "a game is on air". Opening a console
     announces host_here, session and players, and the screen must not jump to a
     game nobody has started. A denylist rather than an allowlist, so a message
     type nobody has invented yet still counts as gameplay. */
  var NOT_ON_AIR = {
    tv_here: 1, host_here: 1, session: 1, players: 1, idle: 1, rollcall: 1,
    tv_audio_blocked: 1, screen_refresh: 1, tv_reload: 1, to_ads: 1, mode: 1
  };

  /* t:"state" means "here is where things stand", which is as often "nothing is
     on" as "a game is running". The formats that can be live say so. */
  function onAir(m) {
    if (!m || !m.t) return false;
    if (NOT_ON_AIR[m.t]) return false;
    if (m.t === "state") return m.active === true || m.playing === true;
    return true;
  }

  var OWN_LIVE_MS = 90000;   // our game is only "live" while it is still talking

  function start(opts) {
    opts = opts || {};
    var client = opts.client, self = opts.self, slug = opts.slug;
    var code = opts.venueCode, gate = opts.gate, busy = opts.busy;
    if (!client || !self || !slug || typeof code !== "function") return { seen: function () {} };

    var lastOwn = 0, switched = false;

    function ourGameIsLive() {
      var claimed = false;
      try { claimed = !!(busy && busy()); } catch (e) { claimed = false; }
      return claimed && lastOwn && (Date.now() - lastOwn < OWN_LIVE_MS);
    }

    /* On the unified TV this page runs inside an iframe. Navigating ourselves is
       right for another game screen, because the frame simply shows that game.
       It is wrong for bingo: /tv inside the /tv frame is a television inside a
       television. So when we are embedded, ask the page that owns the frame. */
    var embedded = false;
    try { embedded = window.top !== window.self; } catch (e) { embedded = true; }

    function goTo(game) {
      if (switched || game === self) return;
      if (ourGameIsLive()) return;              // do not walk out on a game being played
      switched = true;
      if (embedded) {
        try {
          window.parent.postMessage({ vp: "show-game", game: game }, window.location.origin);
          return;
        } catch (e) { /* fall through and navigate, which is still better than nothing */ }
      }
      window.location.href = URLS[game] + encodeURIComponent(slug);
    }

    GAMES.forEach(function (game) {
      if (game === self) return;
      var name = game === "bingo" ? code(slug) : code(game + "-" + slug);
      /* A BRAND NEW CHANNEL ON EVERY RETRY. This used to hold ONE channel object and call
         c.subscribe() on it again after an error. supabase-js allows subscribe() exactly once
         per channel instance, so the retry threw "tried to join multiple times" inside its
         own timer, nothing caught it, no further retry was ever scheduled, and that channel
         was dead for the rest of the night. One ordinary wifi blip, and the wall stayed on
         the trivia podium while the host ran a raffle. Found by audit 20 Sep 2026 by running
         this file against the real supabase-js bundle. tv.html's own copy of this logic
         already rebuilt the channel; this one did not, which is what two copies of one
         answer costs. */
      var tries = 0, retry = null, c = null;
      function onMsg(e) {
        var handle = function (m) {
          if (!m) return;
          /* mode is still honoured, because it is the one message a host sends
             deliberately to claim the screen. Everything else has to look like
             play. */
          if (m.t === "mode" || onAir(m)) goTo(game);
        };
        if (gate) gate(e.payload, handle); else handle(e.payload);
      }
      /* SUBSCRIBE AND LISTEN TO THE ANSWER. A subscription that never connects looks exactly
         like a subscription with nothing to report. These are the channels the unified telly
         watches so it can switch to whichever game a host starts. It retries rather than just
         reporting, because there is no person looking at this screen to press anything: a
         telly on a wall has to heal itself. Backing off to a minute so a genuinely dead
         channel does not hammer anything all night. */
      function watch() {
        var mine = client.channel("vp-" + name, { config: { broadcast: { self: false } } });
        c = mine;
        mine.on("broadcast", { event: "msg" }, onMsg);
        mine.subscribe(function (status) {
          if (mine !== c) return;                // a status from a channel we already replaced
          if (status === "SUBSCRIBED") { tries = 0; return; }
          if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT" && status !== "CLOSED") return;
          if (retry) return;                    // one timer per channel, however many errors land
          tries++;
          var wait = Math.min(60000, 2000 * tries);
          try { console.log("[router] " + game + " channel " + status + ", retrying in " + (wait / 1000) + "s"); } catch (e) {}
          retry = setTimeout(function () {
            retry = null;
            /* LET GO OF IT BEFORE REMOVING IT. removeChannel makes the old channel report CLOSED
               inside this very call. While c still pointed at it, the guard above took that for
               news about the current channel and booked a second retry, and that one built a
               SECOND live channel beside the healthy one without removing it: every message
               handled twice, and one more channel for every blip. Found 20 Sep 2026 by giving
               the test's fake the real library's behaviour, which the first version lacked. */
            if (c === mine) c = null;
            try { client.removeChannel(mine); } catch (e) {}
            try { watch(); } catch (e) {
              // Whatever goes wrong building the next one, keep trying: a throw here used to
              // be the end of this channel for the night.
              retry = setTimeout(function () { retry = null; try { watch(); } catch (e2) {} }, 60000);
            }
          }, wait);
        });
      }
      watch();
    });

    /* The page calls this from its own message handler, so we can tell a game
       being played from one that was abandoned mid-question.

       PASS THE MESSAGE. Without it every scrap of traffic counts as proof our
       game is live, and the consoles now send a heartbeat every thirty seconds
       while they are merely OPEN - which is under the ninety second window, so
       lastOwn never went stale and ourGameIsLive() was true for the rest of the
       night. A host who finished a quiz and left the tab open owned the wall:
       start the raffle and the screen stayed on the podium. That is fault 2 in
       this file's own header, reintroduced by the heartbeats that fixed a
       different fault.

       onAir() is the judgement this file already makes, and it puts host_here,
       idle, session, players and a state with nothing playing on the wrong side
       of it. The screens were bypassing it. A caller that passes nothing keeps
       the old behaviour, so nothing breaks while the pages are updated. */
    return { seen: function (m) { if (arguments.length === 0 || onAir(m)) lastOwn = Date.now(); } };
  }

  root.VPScreenRouter = { start: start, onAir: onAir };
}(typeof globalThis !== "undefined" ? globalThis : this));
