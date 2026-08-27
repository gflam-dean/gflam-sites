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
      var c = client.channel("vp-" + name, { config: { broadcast: { self: false } } });
      c.on("broadcast", { event: "msg" }, function (e) {
        var handle = function (m) {
          if (!m) return;
          /* mode is still honoured, because it is the one message a host sends
             deliberately to claim the screen. Everything else has to look like
             play. */
          if (m.t === "mode" || onAir(m)) goTo(game);
        };
        if (gate) gate(e.payload, handle); else handle(e.payload);
      });
      c.subscribe();
    });

    /* The page calls this from its own message handler, so we can tell a game
       being played from one that was abandoned mid-question. */
    return { seen: function () { lastOwn = Date.now(); } };
  }

  root.VPScreenRouter = { start: start, onAir: onAir };
}(typeof globalThis !== "undefined" ? globalThis : this));
