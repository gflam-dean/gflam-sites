/* THE PODIUM ON A PHONE (Dean 12 Nov 2026, INBOX 313): a player in the lead or top 3 of a board gets the
   trivia night's podium moment on their own phone: who stands on which step comes from the trivia finale's
   own rule (VPTriviaFinale.podiumEntries: ties share a step), the confetti and the 'podium' sound slot from
   the one celebration file (VPCelebrate.burst, VPCelebrate.sound), then it hands back to the page, which
   shows the whole board with their row marked. Styles: /app/vp-podium.css. Used by /live-here-now.

   VPPodium.show(rows, opts): rows are the board's [{ place, name, points, you }], best first.
     opts.title  the line above the steps;  opts.onDone  called once, after opts.ms (default 3800) or a tap.
   Returns false (and calls nothing) when the player is not in the top 3. */
(function (root) {
  "use strict";
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function entries(rows) {
    var F = root.VPTriviaFinale;
    rows = Array.isArray(rows) ? rows : [];
    var src = rows.map(function (r) { return { name: r.name, points: r.points, you: !!r.you }; });
    return F && F.podiumEntries ? F.podiumEntries(src.slice(0, 4), src) : [];
  }
  function mine(rows) {
    var e = entries(rows);
    for (var i = 0; i < e.length; i++) if (e[i].p.you) return e[i].rank;
    return 0;
  }
  function show(rows, opts) {
    opts = opts || {};
    var d = root.document, e = entries(rows), me = mine(rows);
    if (!d || !d.body || !me) return false;
    var el = d.createElement("div");
    el.className = "vpp"; el.id = "vpPodium"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", opts.title || "The podium");
    var order = [2, 1, 3], html = '<p class="vpp-t">' + esc(opts.title || "") + '</p><div class="vpp-steps">';
    order.forEach(function (rank) {
      var on = e.filter(function (x) { return x.rank === rank; });
      if (!on.length) return;
      html += '<div class="vpp-col r' + rank + (on.some(function (x) { return x.p.you; }) ? ' you' : '') + '">' +
        on.map(function (x) { return '<b class="vpp-n">' + esc(x.p.name) + (x.p.you ? ' (you)' : '') + '</b><span class="vpp-p">' + esc(x.p.points) + '</span>'; }).join('') +
        '<div class="vpp-step">' + rank + '</div></div>';
    });
    el.innerHTML = html + '</div>';
    d.body.appendChild(el);
    var C = root.VPCelebrate, done = false;
    if (C) { C.burst(el, 40, { className: "vpp-confetti" }); C.sound("podium"); if (!C.muted()) C.buzz([60, 40, 60]); }
    function finish() { if (done) return; done = true; if (el.parentNode) el.parentNode.removeChild(el); if (opts.onDone) opts.onDone(); }
    el.addEventListener("click", finish);
    setTimeout(finish, opts.ms || 3800);
    return true;
  }
  root.VPPodium = { show: show, mine: mine };
})(typeof window !== "undefined" ? window : this);
