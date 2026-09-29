/* PUNTERS RECKON: the phone's part. One copy, mounted into the trivia phone (app/trivia/play.html).

   The phone never learns an answer it did not name: the board message carries only the question and a
   count, and each phone is told only whether ITS OWN guess scored (pr_result, addressed with `to`).
   It sends {t:"pr_guess", pid, name, round, text} to the host console, which decides with pr-game.js.

   host is an element; opts = { send(obj), alive(), me() -> {pid, name}, show() }. ES5. */
(function (root) {
  "use strict";
  var CSS =
    ".prp{display:flex;flex-direction:column;gap:14px}" +
    ".prp .eb{font-family:'Hanken Grotesk',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.18em;font-size:12px;color:#FF1F8E}" +
    ".prp .q{font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:22px;line-height:1.25;color:#fff}" +
    ".prp .row{display:flex;gap:8px}" +
    ".prp input{flex:1;min-width:0;background:#17171A;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:12px;padding:15px 14px;font:inherit;font-size:17px}" +
    ".prp button{border:0;border-radius:12px;padding:0 18px;background:#FF1F8E;color:#fff;font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:16px}" +
    ".prp button:disabled{opacity:.45}" +
    ".prp .left{font-size:14px;color:#9A9AA4}" +
    ".prp .left b{color:#FFC24B}" +
    ".prp ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".prp li{display:flex;justify-content:space-between;gap:10px;background:#121214;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 13px;font-size:15px}" +
    ".prp li.hit{border-color:rgba(53,208,127,.55);background:rgba(53,208,127,.10)}" +
    ".prp li .pts{font-weight:800;color:#35D07F;white-space:nowrap}" +
    ".prp li.miss .pts{color:#9A9AA4;font-weight:600}" +
    ".prp .done{font-size:15px;color:#E7E7EC;background:rgba(255,194,75,.10);border:1px solid rgba(255,194,75,.35);border-radius:10px;padding:12px 13px}";

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function mount(host, opts, doc) {
    doc = doc || root.document;
    if (!doc.getElementById("prp-css")) { var st = doc.createElement("style"); st.id = "prp-css"; st.textContent = CSS; doc.head.appendChild(st); }
    var S = { round: 0, left: 0, tries: [], open: false, endsAt: 0 };
    function paint() {
      var me = opts.me(), q = S.q || "";
      var list = S.tries.map(function (t) {
        var cls = t.hit ? "hit" : (t.pending ? "" : "miss");
        var right = t.pending ? "checking" : (t.hit ? ("+" + (t.pts|0) + " " + esc(t.a)) : (t.why === "already" ? "already got it" : (t.why === "time" ? "too late" : "not on the board")));
        return '<li class="' + cls + '"><span>' + esc(t.text) + '</span><span class="pts">' + right + '</span></li>';
      }).join("");
      var canType = S.open && S.left > 0;
      host.innerHTML = '<div class="prp"><div class="eb">' + esc(S.name || "Punters Reckon") + (S.round ? " · round " + S.round : "") + '</div>' +
        '<div class="q">' + esc(q) + '</div>' +
        (canType ? '<form class="row" id="prForm" action="#" autocomplete="off"><input id="prIn" name="guess" maxlength="40" autocomplete="off" autocapitalize="off" enterkeyhint="go" placeholder="What would the punters say?"><button id="prGo" type="submit">Go</button></form>' : '') +
        '<div class="left">' + (S.open ? (S.left > 0 ? '<b>' + S.left + '</b> guess' + (S.left === 1 ? '' : 'es') + ' left. Think like the room.' : 'That is your guesses. Watch the telly.') : '') + '</div>' +
        (S.done ? '<div class="done">Board over. The answers are on the telly.</div>' : '') +
        '<ul>' + list + '</ul></div>';
      var inp = host.querySelector("#prIn"), form = host.querySelector("#prForm");
      if (inp && form) {
        var fire = function () {
          var text = String(inp.value || "").trim(); if (!text || !S.open || S.left <= 0) return;
          S.tries.unshift({ text: text, pending: true });
          opts.send({ t: "pr_guess", pid: me.pid, name: me.name, round: S.round, text: text.slice(0, 40) });
          paint();
        };
        /* A FORM, NOT A KEY LISTENER. A phone keyboard's Go key, Enter on a laptop and the Go button all
           arrive as ONE submit event. A keydown listener for "Enter" missed real keystrokes when this was
           tried in a browser on 29 Sep 2026: the guess just sat in the box. */
        form.addEventListener("submit", function (e) { if (e && e.preventDefault) e.preventDefault(); fire(); });
        try { inp.focus(); } catch (e) {}
      }
    }
    function onMsg(m) {
      if (!m || !m.t) return false;
      if (m.t === "ta_board") {
        S = { round: m.round|0, q: m.q, name: m.name, left: 3, tries: [], open: true, endsAt: +m.endsAt || 0, done: false };
        if (opts.alive) opts.alive();            // holding a board: a billable player, like a trivia question
        if (opts.show) opts.show();
        paint(); return true;
      }
      if (m.t === "pr_result") {
        var me = opts.me();
        if (m.to !== me.pid || (m.round|0) !== S.round) return true;   // someone else's, or an old board
        var t = null;
        for (var i = 0; i < S.tries.length; i++) { if (S.tries[i].pending && S.tries[i].text.slice(0, 40) === String(m.text || "")) { t = S.tries[i]; break; } }
        if (!t) { t = { text: m.text }; S.tries.unshift(t); }
        t.pending = false; t.hit = !!m.hit; t.a = m.a; t.pts = m.pts; t.why = m.why;
        if (typeof m.left === "number") S.left = m.left;
        if (m.why === "time") S.open = false;
        paint(); return true;
      }
      if (m.t === "ta_showall") { S.open = false; S.done = true; paint(); return true; }
      return false;
    }
    return { onMsg: onMsg };
  }
  root.PRPhone = { mount: mount };
}(typeof window !== "undefined" ? window : this));
