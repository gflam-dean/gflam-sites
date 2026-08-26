/* ============================================================================
   FOLLOW THE HOST.

   A host who starts the wrong game and immediately starts the right one used to
   strand the room. The bingo page could send a phone OUT to trivia or musical,
   but nothing ever brought it back, and neither the trivia page nor the musical
   page watched for anything at all. Once a phone was on the wrong game's page it
   stayed there for the rest of the night with no way out but the Leave button,
   which most people never find.

   So: one watcher, shared by all three player pages, that asks the Worker what
   the host is running right now and moves the phone if it is somewhere else.

   The session's join code does not change when the host changes game, because
   the code lives on the session and the games are rows inside it. Only the PAGE
   has to change, so the hop carries the same ?room= straight across.

   Load it after the page's own script and start it with:
       VPFollow.start({ api: VP_GAME_API, room: room, format: "trivia" });
   ========================================================================== */
(function (root) {
  "use strict";

  /* One mapping, in one place. Two copies of this drifted apart once already and
     the result was a phone bouncing between two pages that each believed the
     other one was wrong. */
  var PAGES = [
    { match: /^trivia/,  page: "/app/trivia/play.html",  family: "trivia"  },
    { match: /^musical/, page: "/app/musical/play.html", family: "musical" },
    { match: /^bingo/,   page: "/play",                  family: "bingo"   }
  ];

  /* Raffle and members draws have no player app: there is nothing for a phone to
     do but watch the screen. Moving somebody to a page that cannot exist would be
     worse than leaving them where they are. */
  var NO_PLAYER_APP = /^(raffle|members)/;

  function familyOf(format) {
    var f = String(format || "").toLowerCase();
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].match.test(f)) return PAGES[i].family;
    return "";
  }
  function pageFor(family) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].family === family) return PAGES[i].page;
    return "";
  }

  function start(opts) {
    opts = opts || {};
    var api  = String(opts.api || "").replace(/\/$/, "");
    var room = String(opts.room || "").toUpperCase().trim();
    var mine = String(opts.format || "").toLowerCase();
    var every = opts.every || 8000;
    if (!api || !room || !mine) return;

    var hopped = false;

    function look() {
      if (hopped) return;
      fetch(api + "/join/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || hopped) return;
          var fmt = String(d.format || "");
          if (!fmt) return;                       // nothing running yet: stay put
          if (NO_PLAYER_APP.test(fmt.toLowerCase())) return;
          var fam = familyOf(fmt);
          if (!fam || fam === mine) return;       // already in the right place

          /* room_code is set when the code we asked about was the venue's
             permanent one and the live session has its own. Prefer it, or the
             phone lands on the right page pointing at the wrong channel. */
          var go = pageFor(fam);
          if (!go) return;
          hopped = true;
          window.location.replace(go + "?room=" + encodeURIComponent(d.room_code || room));
        })
        .catch(function () {});                   // a Worker blip must not disturb the game
    }

    /* Not immediately. The page has only just loaded because something sent the
       phone here, and asking in the same breath races the write that moved it. */
    setTimeout(look, 2500);
    setInterval(look, every);
  }

  root.VPFollow = { start: start, familyOf: familyOf, pageFor: pageFor };
}(typeof globalThis !== "undefined" ? globalThis : this));
