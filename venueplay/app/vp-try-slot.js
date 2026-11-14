/* vp-try-slot.js -- THE TRY-IT DEMO'S FIRST QUESTION, IN THE NO-CARD START'S DONE SCREEN (Dean, 5 Nov 2026; INBOX 82, 87).

   The done screen (/offer-nov, app/vp-start.js, JOB A) leaves #st-try-slot for this and fires "vp-start-done" with
   { venue, tv_code, go_url, slug, players }. This asks once: "It's your first time here. How would you like to try
   it?" with "As a player" and "As the host too". A choice is remembered for 30 minutes (localStorage vpTryNext,
   a fixed /app/try.html address and nothing else) and the one-tap sign-in (go_url, /app/go) opens the demo
   instead of the console (vp-oneclick.js, nextAfterSignIn). The demo then asks how many players and whether
   another device is handy (/app/try.html). Nothing is sent and nothing is stored but that one address.
   No em dashes, lowercase venueplay. */
(function (root) {
  "use strict";
  var KEY = "vpTryNext";
  var doc = root.document;
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function draw(d) {
    var slot = doc.getElementById("st-try-slot");
    if (!slot || slot.getAttribute("data-drawn") === "1") return false;
    slot.setAttribute("data-drawn", "1");
    slot.innerHTML = "";
    slot.appendChild(el("h3", "st-h", "It's your first time here. How would you like to try it?"));
    function choice(id, mode, head, line) {
      var b = el("button", "btn btn-primary st-try"); b.type = "button"; b.id = id;
      b.setAttribute("style", "display:block;width:100%;text-align:left;margin:0 0 10px;white-space:normal;min-height:48px");
      var h = el("b", "", head); h.setAttribute("style", "display:block;font-size:17px");
      var s = el("span", "", line); s.setAttribute("style", "display:block;font-weight:500;font-size:15px;opacity:.9");
      b.appendChild(h); b.appendChild(s);
      b.addEventListener("click", function () {
        try { root.localStorage.setItem(KEY, JSON.stringify({ path: "/app/try.html?mode=" + mode, at: Date.now() })); } catch (e) {}
        root.location.href = (d && d.go_url) || "/app/try.html?mode=" + mode;
      });
      slot.appendChild(b);
    }
    choice("st-try-player", "player", "As a player", "This screen shows the TV and your phone is the player. The game runs itself.");
    choice("st-try-host", "host", "As the host too", "Got another device? Use it as the host console.");
    slot.appendChild(el("p", "st-small", "A 5-question trivia round on your own venue. Up to 10 for the demo, and nothing is charged."));
    slot.hidden = false;
    var open = doc.getElementById("st-open");
    if (open) open.textContent = "Skip the demo, open my host console";
    return true;
  }
  if (doc) {
    doc.addEventListener("vp-start-done", function (e) { draw((e && e.detail) || {}); });
    if (root.VPStart && root.VPStart.done) draw(root.VPStart.done);
  }
  /* What /app/go opens after the one-tap sign-in: the demo only if it was chosen here in the last 30 minutes, and
     only one of the fixed addresses (never anything read from a link; the quick game's own is checked first, below). Spent once read. */
  function nextAfterSignIn(ls, now) {
    var raw = null; try { raw = ls && ls.getItem(KEY); if (raw) ls.removeItem(KEY); } catch (e) { raw = null; }
    if (!raw) return "/app/";
    var o = null; try { o = JSON.parse(raw); } catch (e) { o = null; }
    /* PLAY A QUICK GAME (INBOX 412): its one fixed address, exactly, inside the same 30 minutes. */
    if (o && o.path === "/app/try.html?quick=1") { var qa = (now || Date.now()) - Number(o.at || 0); return (qa >= 0 && qa <= 30 * 60 * 1000) ? o.path : "/app/"; }
    if (!o || !/^\/app\/try\.html\?mode=(player|host)$/.test(String(o.path || ""))) return "/app/";
    var age = (now || Date.now()) - Number(o.at || 0);
    return (age >= 0 && age <= 30 * 60 * 1000) ? o.path : "/app/";
  }
  root.VPTrySlot = { draw: draw, nextAfterSignIn: nextAfterSignIn, KEY: KEY };
})(typeof window !== "undefined" ? window : this);
