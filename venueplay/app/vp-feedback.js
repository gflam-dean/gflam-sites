/* ============================================================================
   HOW WAS THAT? One tap, on the screen the player is already looking at.

   The end-of-game screens are dead ends: the room has just been told somebody
   won and there is nothing left to do until the host starts another round. That
   is the one moment a punter will answer a question, and the only moment we get
   any signal at all about whether the night was actually good. Metering says how
   many played. It has never said whether they would come back.

   THREE RULES THIS FOLLOWS.

   1. One tap, three options. Five options is a survey and a survey at a pub is
      nothing. The tap is anonymous (vp_game_feedback holds no person). What a
      player chooses to add afterwards (the follow-up below, Dean 1 Nov 2026)
      goes to the billing Worker's /help/feedback, rate-limited and honeypotted,
      into vp_feedback_notes (migration 137). The one tick is the player's own
      "venueplay can email me about this feedback", on Good and Not for me only.

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

  /* ASKED ONCE PER GAME, and the caller says what a game is.

     Broadcast bingo has no game id and no session id on the phone at all, so it
     would fall back to the room code -- which is permanent, printed on the table
     talker. One rating and that punter is never asked again, on any night, at
     that venue. A page with no server handle passes its own key instead (bingo
     uses the room and the date, so it asks once a night). */
  function askedKey(o) { return "vpFb-" + (o.key || o.gameId || o.sessionId || o.code || "x"); }
  function alreadyAsked(o) {
    try { return !!localStorage.getItem(askedKey(o)); } catch (e) { return false; }
  }
  function markAsked(o) {
    try { localStorage.setItem(askedKey(o), "1"); } catch (e) {}
  }

  /* THE FOLLOW-UP (Dean, 1 Nov 2026). Every rating gets one short question, tailored to it, all
     of it optional and one tap away from gone ("No thanks"):
       Loved it     What did you love?               tags, a line
       Good         What would make it better?       tags, a line, an email to be answered about it
       Not for me   Sorry to hear that. What went wrong?   the same as Good
     The email only with its own tick, and only ever into a help-desk ticket (the billing Worker,
     POST /help/feedback). Never asked after "Loved it".

     NO TICKS FOR THE VENUE (Dean, 2 Nov 2026): the player is under no obligation to tick anything.
     A venue sees only COUNTS of "Loved it" and "Good"; every word and tag here goes to the venueplay
     team only, and the form says so.

     The tag keys must match VPF_TAGS in venueplay-api-FULL.js word for word: the Worker drops any
     it does not know. tools/test-player-look.js compares the two lists. */
  var TAGS = {
    3: [["host", "The host"], ["questions", "The questions"], ["music", "The music"], ["prizes", "The prizes"], ["easy_join", "Easy to join"], ["other", "Something else"]],
    2: [["faster", "A faster pace"], ["easier_join", "Easier to join"], ["prizes", "Better prizes"], ["screen", "The screen or sound"], ["variety", "More variety"], ["other", "Something else"]],
    1: [["couldnt_join", "Couldn't join"], ["too_slow", "Too slow"], ["screen", "Screen problems"], ["didnt_like", "Didn't like the game"], ["other", "Something else"]]
  };
  var ASK = { 3: "What did you love?", 2: "What would make it better?", 1: "Sorry to hear that. What went wrong?" };
  function helpApi() { return root.VP_HELP_API || "https://api.venueplay.com.au"; }
  function deviceId() {
    try {
      var k = "vpHelpDev", v = root.localStorage.getItem(k);
      if (!v) { var a = new Uint8Array(12); root.crypto.getRandomValues(a); v = Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); root.localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ""; }
  }

  /* What the follow-up sends, from what is on the form. Pure, so it can be tested on its own: the
     email only with its own tick and never after "Loved it"; nothing for the venue, nothing to share,
     no name, whatever the form holds. */
  function payload(rating, f) {
    f = f || {};
    var email = (rating <= 2 && f.consent === true) ? String(f.email || "").trim() : "";
    return {
      tags: (f.tags || []).slice(0, 6), note: String(f.note || "").trim().slice(0, 300),
      consent: !!email, email: email || undefined
    };
  }

  function styles() {
    if (document.getElementById("vpFbCss")) return;
    var el = document.createElement("style");
    el.id = "vpFbCss";
    el.textContent =
      ".vpfb{margin-top:22px;text-align:center}" +
      ".vpl-fb .vpfb{margin-top:18px}" +
      ".vpfb .q{font-size:13px;color:var(--muted,#9A9AA4);margin-bottom:10px}" +
      ".vpfb .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}" +
      ".vpfb button{background:var(--ink-3,#17171A);border:1px solid var(--line,rgba(255,255,255,.10));" +
      "color:var(--text,#E7E7EC);border-radius:12px;padding:10px 12px;font:600 13px/1.2 'Manrope',system-ui,sans-serif;" +
      "cursor:pointer;min-width:92px;-webkit-tap-highlight-color:transparent}" +
      ".vpfb button:active{transform:scale(.96);border-color:var(--pink,#FF1F8E)}" +
      ".vpfb .face{display:block;font-size:20px;margin-bottom:3px}" +
      ".vpfb .row button{flex:1 1 0;min-width:0;max-width:122px;padding:10px 6px}" +
      ".vpfb .thanks{font-size:13px;color:var(--win,#35D07F);font-weight:700}" +
      ".vpfb .more{margin:2px auto 0;max-width:380px;text-align:left}" +
      ".vpfb .more .q{text-align:center;color:var(--text,#E7E7EC);font-weight:700;font-size:14px}" +
      ".vpfb .chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:10px}" +
      ".vpfb .chips button{min-width:0;min-height:38px;padding:9px 12px;border-radius:999px;font-size:13px}" +
      ".vpfb .chips button[aria-pressed=true]{border-color:var(--pink,#FF1F8E);background:rgba(255,31,142,.14);color:#fff}" +
      "body.light .vpfb .chips button[aria-pressed=true]{color:#191420}" +
      ".vpfb textarea,.vpfb input[type=email],.vpfb input[type=text]{width:100%;box-sizing:border-box;background:var(--ink-2,#121214);color:var(--text,#E7E7EC);" +
      "border:1px solid var(--line,rgba(255,255,255,.10));border-radius:10px;padding:10px 12px;font:500 14px/1.35 'Manrope',system-ui,sans-serif;margin-bottom:8px}" +
      ".vpfb textarea{min-height:64px;resize:vertical}" +
      ".vpfb label.tick{display:flex;gap:10px;align-items:flex-start;min-height:38px;font-size:13px;color:var(--text,#E7E7EC);line-height:1.35;margin:4px 0 10px;cursor:pointer}" +
      ".vpfb label.tick input{width:20px;height:20px;flex:none;margin:0;accent-color:#FF1F8E}" +
      ".vpfb .who{font-size:12px;color:var(--faint,#8A8A94);margin:0 0 10px;text-align:center}" +
      ".vpfb .acts{display:flex;gap:8px;justify-content:center;margin-top:4px}" +
      ".vpfb .acts .send{background:var(--pink,#FF1F8E);border-color:var(--pink,#FF1F8E);color:#fff;min-width:120px}" +
      ".vpfb .acts .skip{background:transparent;min-width:0}" +
      ".vpfb .hide{display:none!important}";
    document.head.appendChild(el);
  }

  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function tick(text) {
    var l = node("label", "tick"), i = document.createElement("input"); i.type = "checkbox"; i.checked = false;
    l.appendChild(i); l.appendChild(node("span", "", text)); return { label: l, box: i };
  }

  /* The follow-up form, built from text nodes only. */
  function followUp(wrap, o, rating, feedbackId) {
    var more = node("div", "more");
    more.appendChild(node("div", "q", ASK[rating]));
    var chips = node("div", "chips"), picked = [];
    TAGS[rating].forEach(function (t) {
      var b = node("button", "", t[1]); b.type = "button"; b.setAttribute("aria-pressed", "false"); b.setAttribute("data-tag", t[0]);
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on ? "true" : "false");
        var i = picked.indexOf(t[0]); if (on && i < 0) picked.push(t[0]); if (!on && i >= 0) picked.splice(i, 1);
      });
      chips.appendChild(b);
    });
    more.appendChild(chips);
    var note = node("textarea"); note.maxLength = 300; note.placeholder = "Anything else? (optional)"; note.setAttribute("aria-label", "Anything else");
    more.appendChild(note);
    var f = { mail: null, email: null };
    if (rating <= 2) {
      f.mail = tick("venueplay can email me about this feedback (only about this)");
      f.email = node("input"); f.email.type = "email"; f.email.maxLength = 200; f.email.placeholder = "Your email"; f.email.setAttribute("aria-label", "Your email");
      f.email.classList.add("hide");
      f.mail.box.addEventListener("change", function () { f.email.classList.toggle("hide", !f.mail.box.checked); });
      more.appendChild(f.mail.label); more.appendChild(f.email);
    }
    more.appendChild(node("div", "who", "Only the venueplay team reads this."));
    var acts = node("div", "acts"), send = node("button", "send", "Send"), skip = node("button", "skip", "No thanks");
    send.type = "button"; skip.type = "button";
    acts.appendChild(skip); acts.appendChild(send); more.appendChild(acts);
    function done(text) { wrap.textContent = ""; wrap.appendChild(node("div", "thanks", text)); }
    skip.addEventListener("click", function () { done(rating === 1 ? "Thanks for telling us" : "Thanks, that helps the venue"); });
    send.addEventListener("click", function () {
      var body = payload(rating, {
        tags: picked, note: note.value,
        consent: !!(f.mail && f.mail.box.checked), email: f.email ? f.email.value : ""
      });
      body.feedback_id = feedbackId; body.device = deviceId(); body.website = "";
      done(rating === 1 ? "Thanks for telling us" : "Thanks, that helps");
      try {
        fetch(helpApi() + "/help/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .catch(function () {});
      } catch (e) {}
    });
    wrap.textContent = ""; wrap.appendChild(more);
  }

  function ask(o) {
    o = o || {};
    var host = typeof o.mount === "string" ? document.getElementById(o.mount) : o.mount;
    if (!host || alreadyAsked(o)) return;
    /* On a page with the new look the rating sits in its own slot, under the thanks (/app/vp-playerlook.js). */
    var slot = (root.VPLook && root.VPLook.feedbackSlot && root.VPLook.feedbackSlot(host)) || host;
    if (slot.querySelector && slot.querySelector(".vpfb")) return;   // already on this screen
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
      b.setAttribute("data-rate", String(L.r));
      b.innerHTML = '<span class="face">' + L.face + "</span>" + L.word;
      b.addEventListener("click", function () {
        markAsked(o);
        wrap.innerHTML = '<div class="thanks">' + (L.r === 1 ? "Thanks for telling us" : "Thanks, that helps the venue") + '</div>';
        /* Best effort, and deliberately so: the punter has already been thanked. The Worker hands
           back the rating's id, and only then is the follow-up offered: it is kept against THAT
           rating, so it cannot be posted for one nobody made. An older Worker sends no id, and
           the thanks simply stays. */
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
          }).then(function (r) { return r && r.ok ? r.json() : null; })
            .then(function (j) { if (j && j.id) followUp(wrap, o, L.r, j.id); })
            .catch(function () {});
        } catch (e) {}
      });
      row.appendChild(b);
    });

    wrap.appendChild(q);
    wrap.appendChild(row);
    slot.appendChild(wrap);
  }

  root.VPFeedback = { ask: ask, payload: payload, TAGS: TAGS };
})(window);
