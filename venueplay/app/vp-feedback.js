/* ============================================================================
   HOW WAS THAT? One tap, on the screen the player is already looking at.

   The end-of-game screens are dead ends: the room has just been told somebody
   won and there is nothing left to do until the host starts another round. That
   is the one moment a punter will answer a question, and the only moment we get
   any signal at all about whether the night was actually good. Metering says how
   many played. It has never said whether they would come back.

   THREE RULES THIS FOLLOWS.

   1. One tap, three options, then it is gone. Five options is a survey and a
      survey at a pub is nothing. There is no free text: a comment box on a
      channel anyone with the venue code can post to is a moderation problem
      waiting for a Saturday night, and it would drag personal data into a table
      that deliberately holds none.

   2. It never blocks anything. If the Worker is unreachable, if the venue is
      old, if anything at all goes wrong, the punter sees a normal end screen and
      never knows this existed.

   3. It asks ONCE per game. A regular who plays three rounds is not asked three
      times, because the third time is an annoyance and the answer is the same.

   Used by any player page with one line:
       VPFeedback.ask({ api: API, code: CODE, mount: "vWon",
                        sessionId: id, gameId: gid, format: "musical" });
   ========================================================================== */
(function (root) {
  "use strict";

  var LABELS = [
    { r: 3, face: "😄", word: "Loved it" },
    { r: 2, face: "🙂", word: "Good" },
    { r: 1, face: "😐", word: "Not for me" }
  ];

  function askedKey(o) { return "vpFb-" + (o.gameId || o.sessionId || o.code || "x"); }
  function alreadyAsked(o) {
    try { return !!localStorage.getItem(askedKey(o)); } catch (e) { return false; }
  }
  function markAsked(o) {
    try { localStorage.setItem(askedKey(o), "1"); } catch (e) {}
  }

  function styles() {
    if (document.getElementById("vpFbCss")) return;
    var el = document.createElement("style");
    el.id = "vpFbCss";
    el.textContent =
      ".vpfb{margin-top:22px;text-align:center}" +
      ".vpfb .q{font-size:13px;color:var(--muted,#9A9AA4);margin-bottom:10px}" +
      ".vpfb .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}" +
      ".vpfb button{background:var(--ink-3,#17171A);border:1px solid var(--line,rgba(255,255,255,.10));" +
      "color:var(--text,#E7E7EC);border-radius:12px;padding:11px 14px;font:600 13px/1.2 'Manrope',system-ui,sans-serif;" +
      "cursor:pointer;min-width:92px;-webkit-tap-highlight-color:transparent}" +
      ".vpfb button:active{transform:scale(.96);border-color:var(--pink,#FF1F8E)}" +
      ".vpfb .face{display:block;font-size:20px;margin-bottom:3px}" +
      ".vpfb .thanks{font-size:13px;color:var(--win,#35D07F);font-weight:700}";
    document.head.appendChild(el);
  }

  function ask(o) {
    o = o || {};
    var host = typeof o.mount === "string" ? document.getElementById(o.mount) : o.mount;
    if (!host || alreadyAsked(o)) return;
    if (host.querySelector && host.querySelector(".vpfb")) return;   // already on this screen
    styles();

    var wrap = document.createElement("div");
    wrap.className = "vpfb";
    var q = document.createElement("div");
    q.className = "q";
    q.textContent = "How was that?";
    var row = document.createElement("div");
    row.className = "row";

    LABELS.forEach(function (L) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", L.word);
      b.innerHTML = '<span class="face">' + L.face + "</span>" + L.word;
      b.addEventListener("click", function () {
        markAsked(o);
        wrap.innerHTML = '<div class="thanks">Thanks — that helps the venue</div>';
        /* Best effort, and deliberately so: the punter has already been thanked.
           A rating that does not arrive is worth less than a punter watching a
           spinner at the end of a game they just lost. */
        try {
          fetch(o.api + "/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: o.code || "", rating: L.r, source: "player",
              session_id: o.sessionId || undefined,
              game_id: o.gameId || undefined,
              format: o.format || undefined
            })
          }).catch(function () {});
        } catch (e) {}
      });
      row.appendChild(b);
    });

    wrap.appendChild(q);
    wrap.appendChild(row);
    host.appendChild(wrap);
  }

  root.VPFeedback = { ask: ask };
})(window);
