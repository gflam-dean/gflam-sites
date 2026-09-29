/* PUNTERS RECKON: the board on the TV. ONE copy, used by the trivia TV (app/trivia/screen.html) and the
   standalone demo (app/topanswers/screen.html), so the two can never paint it differently.

   Painted ONLY from messages, like every VenuePlay screen:
     {t:"ta_board", round, q, n, secs, endsAt, name}   n hidden answers, NOT the answers
     {t:"ta_reveal", i, a, pts, by}                    answer i was found (its text arrives only now)
     {t:"ta_showall", rest:[{i,a,pts}]}                end of board: the ones nobody found, greyed
   THE ANSWERS NEVER TRAVEL BEFORE THEY ARE FOUND: every phone at the venue listens on this channel.

   Sized in cqw (a WIDTH unit) inside the container, which must be a size container, like every wall. */
(function (root) {
  "use strict";
  var CSS =
    ".prb{position:absolute;inset:0;display:flex;flex-direction:column;padding:2.4cqw 3.4cqw}" +
    ".prb .eb{font-family:'Hanken Grotesk',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.22em;font-size:1.4cqw;color:#FF1F8E}" +
    ".prb .q{font-family:'Anton',sans-serif;text-transform:uppercase;font-size:3.6cqw;line-height:1.05;color:#fff;margin:.8cqw 0 1.8cqw;max-width:88cqw}" +
    ".prb .bd{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:1cqw 1.4cqw;grid-auto-flow:column}" +
    ".prb .slot{perspective:80cqw;min-height:0}" +
    ".prb .card{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .7s cubic-bezier(.3,1.4,.5,1)}" +
    ".prb .slot.open .card{transform:rotateX(180deg)}" +
    ".prb .face{position:absolute;inset:0;border-radius:.9cqw;display:flex;align-items:center;backface-visibility:hidden;-webkit-backface-visibility:hidden;padding:0 1.8cqw}" +
    ".prb .front{background:linear-gradient(160deg,#2A0F1E,#141417);border:1px solid rgba(255,31,142,.35);justify-content:center}" +
    ".prb .front .n{font-family:'Anton',sans-serif;font-size:3.4cqw;color:rgba(255,255,255,.28)}" +
    ".prb .back{transform:rotateX(180deg);background:linear-gradient(160deg,#FF1F8E,#C70F69);justify-content:space-between;gap:1cqw;box-shadow:0 0 3cqw rgba(255,31,142,.35)}" +
    ".prb .back .a{font-family:'Hanken Grotesk',sans-serif;font-weight:800;font-size:2.4cqw;color:#fff;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".prb .back .by{display:block;font-family:'Manrope',sans-serif;font-weight:600;font-size:1.05cqw;text-transform:none;color:rgba(255,255,255,.8);margin-top:.2cqw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".prb .back .p{font-family:'Anton',sans-serif;font-size:3cqw;color:#fff;background:rgba(0,0,0,.22);border-radius:.6cqw;padding:.2cqw 1cqw;flex:none}" +
    ".prb .slot.missed .back{background:linear-gradient(160deg,#3a3a42,#26262c);box-shadow:none}" +
    ".prb .ft{display:flex;align-items:center;justify-content:space-between;margin-top:1.8cqw;font-family:'Hanken Grotesk',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.1em;font-size:1.5cqw;color:#9A9AA4}" +
    ".prb .ft b{font-family:'Anton',sans-serif;font-size:3.2cqw;color:#fff;letter-spacing:0;margin-left:.8cqw}" +
    ".prb .ft .how{font-family:'Manrope',sans-serif;font-weight:600;text-transform:none;letter-spacing:0;font-size:1.4cqw}" +
    ".prb .ft .how b{font-family:inherit;font-size:inherit;color:#FFC24B;margin:0}";

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function mount(host, doc) {
    doc = doc || root.document;
    if (!doc.getElementById("prb-css")) {
      var st = doc.createElement("style"); st.id = "prb-css"; st.textContent = CSS; doc.head.appendChild(st);
    }
    host.innerHTML = '<div class="prb"><div class="eb" data-r="eb"></div><div class="q" data-r="q"></div>' +
      '<div class="bd" data-r="bd"></div><div class="ft"><span>Found<b data-r="found">0 of 0</b></span>' +
      '<span class="how">Type your answer on your phone. <b>3 guesses.</b></span><span>Time<b data-r="clock">--</b></span></div></div>';
    function r(k){ return host.querySelector('[data-r="' + k + '"]'); }
    var S = { n: 0, open: {}, found: 0, endsAt: 0, timer: null };
    function slot(i){ return host.querySelector('[data-i="' + i + '"]'); }
    function fill(i, a, pts, by){
      var b = host.querySelector('[data-b="' + i + '"]');
      if (b) b.innerHTML = '<span class="a">' + esc(a) + (by ? '<span class="by">' + esc(by) + '</span>' : '') + '</span><span class="p">' + (pts|0) + '</span>';
    }
    function tick(){
      var left = Math.max(0, Math.ceil((S.endsAt - Date.now()) / 1000));
      r("clock").textContent = S.endsAt ? left : "--";
      if (!left && S.timer) { clearInterval(S.timer); S.timer = null; }
    }
    function onMsg(m) {
      if (!m || !m.t) return false;
      if (m.t === "ta_board") {
        S.n = Math.max(0, Math.min(8, m.n|0)); S.open = {}; S.found = 0; S.endsAt = +m.endsAt || 0;
        r("eb").textContent = (m.name || "") + (m.round ? " · round " + m.round : "");
        r("q").textContent = m.q || "";
        var h = "";
        for (var k = 0; k < S.n; k++) {
          h += '<div class="slot" data-i="' + k + '"><div class="card"><div class="face front"><span class="n">' + (k + 1) +
               '</span></div><div class="face back" data-b="' + k + '"></div></div></div>';
        }
        var bd = r("bd"); bd.innerHTML = h; bd.style.gridTemplateRows = "repeat(" + Math.max(1, Math.ceil(S.n / 2)) + ",1fr)";
        r("found").textContent = "0 of " + S.n;
        if (S.timer) clearInterval(S.timer);
        S.timer = S.endsAt ? setInterval(tick, 250) : null; tick();
        return true;
      }
      if (m.t === "ta_reveal") {
        var i = m.i|0, el = slot(i); if (!el || S.open[i]) return true;
        fill(i, m.a, m.pts, m.by); S.open[i] = true; S.found += 1; el.classList.add("open");
        r("found").textContent = S.found + " of " + S.n;
        return true;
      }
      if (m.t === "ta_showall") {
        (m.rest || []).forEach(function (x) { var i = x.i|0, el = slot(i); if (el && !S.open[i]) { fill(i, x.a, x.pts); el.classList.add("missed", "open"); } });
        S.endsAt = 0; tick();
        return true;
      }
      return false;
    }
    return { onMsg: onMsg };
  }

  root.PRBoard = { mount: mount };
}(typeof window !== "undefined" ? window : this));
