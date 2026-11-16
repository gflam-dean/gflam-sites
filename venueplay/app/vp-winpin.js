/* vp-winpin.js  -- THE WINNER CHECK PIN. ONE ANSWER, EVERY PHONE AND CONSOLE.

   Dean, 4 Nov 2026 ("just don't overcomplicate it"): a 4-digit PIN per round, the same for every
   player in that round and new every round. The WINNER'S PHONE shows it with their card or ticket
   number (trivia: team name and place), and the HOST CONSOLE shows "Round PIN 4821", so a host
   running two games, or handed a screenshot from last round, can check a winner in a glance.

   NEVER ON A TV. The PIN comes from the game Worker (/host/winner-pin, /player/winner-pin), which
   makes it from the round's id and a secret only the Worker holds, and gives it to a phone only once
   its own record shows that phone won the round. This file only ASKS for it and
   writes it on the page that asked. It never sends it anywhere: not into the channel, not into the
   room, not into any message a screen hears, because every one of those reaches the TV.
   winner-pin.test.js fails if this file ever calls a send.

   Use:
     VPWinPin.forPlayer(apiBase, playerToken, { game_id, stage })   -> Promise of "4821", or "" if none
     VPWinPin.forPlayer(apiBase, playerToken, { bingo:true, stage }) (bingo: the phone's newest draw)
     VPWinPin.forHost({ game_id, stage } or { draw_id, stage })      -> Promise of "4821", or ""
   stage is the PRIZE: the pattern being played ("one", "two", "full", a custom "c:..."), or "final" for
   trivia. Each prize has its own PIN (Dean, 5 Nov 2026), so a game that carries on gets a new one.
     VPWinPin.phoneLine(pin, "card 332")  -> "Show this to the host: PIN 4821, card 332"
     VPWinPin.hostLine(pin)               -> "Round PIN 4821"
     VPWinPin.paint(el, pin, "card 332")  writes the phone line into el, PIN in bold; hides el if no PIN
   A failure is never an error on screen: the win stands without a PIN, exactly as before.
   ES5, no dependencies (forHost uses VP.gameApiCall from vp-session.js). */
(function (root) {
  "use strict";
  var PIN_RE = /^[0-9]{4}$/;
  var cache = {};   // one answer per round per page: a phone that re-renders asks once

  function clean(j) { var p = j && j.pin; return (typeof p === "string" && PIN_RE.test(p)) ? p : ""; }
  function keyOf(who, body) { return who + ":" + (body.game_id || body.draw_id || (body.bingo ? "bingo" : "")) + ":" + (body.stage || ""); }

  function forPlayer(apiBase, token, body) {
    body = body || {};
    if (!token || !apiBase) return Promise.resolve("");
    var k = keyOf("p", body);
    if (cache[k] && !body.bingo) return cache[k];
    /* The Worker gives the PIN only once its own record shows this phone won. The phone hears "you won"
       from the host a moment after the host's confirm is written, so a first "not yet" is asked once
       more, two and a half seconds later. */
    function ask() {
      return fetch(apiBase + "/player/winner-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Player-Token": token },
        body: JSON.stringify(body)
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(clean, function () { return ""; });
    }
    var p = ask().then(function (pin) {
      return pin || new Promise(function (res) { setTimeout(function () { ask().then(res); }, 2500); });
    });
    p.then(function (pin) { if (!pin) delete cache[k]; });   // a miss is asked again next time
    cache[k] = p;
    return p;
  }

  function forHost(body) {
    body = body || {};
    var VP = root.VP;
    if (!VP || typeof VP.gameApiCall !== "function" || !(body.game_id || body.draw_id)) return Promise.resolve("");
    var k = keyOf("h", body);
    if (cache[k]) return cache[k];
    var p = VP.gameApiCall("/host/winner-pin", body, 5000)
      .then(function (r) { return (r && r.status === 200) ? clean(r.json) : ""; }, function () { return ""; });
    p.then(function (pin) { if (!pin) delete cache[k]; });
    cache[k] = p;
    return p;
  }

  function phoneLine(pin, what) {
    if (!PIN_RE.test(String(pin || ""))) return "";
    return "Show this to the host: PIN " + pin + (what ? ", " + what : "");
  }
  function hostLine(pin) { return PIN_RE.test(String(pin || "")) ? "Round PIN " + pin : ""; }

  /* Writes the phone line into el as text nodes (never innerHTML, so a team name cannot become
     markup), the PIN in bold. Empties el and gives it the "hidden" class when there is no PIN. */
  function paint(el, pin, what) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    if (!PIN_RE.test(String(pin || ""))) { if (!/(^|\s)hidden(\s|$)/.test(el.className)) el.className = (el.className + " hidden").replace(/^\s+/, ""); return; }
    el.className = el.className.replace(/(^|\s)hidden(?=\s|$)/g, " ").replace(/^\s+|\s+$/g, "");
    var d = el.ownerDocument || document, b = d.createElement("b");
    el.appendChild(d.createTextNode("Show this to the host: "));
    b.textContent = "PIN " + pin;
    b.setAttribute("data-winpin", pin);
    el.appendChild(b);
    if (what) el.appendChild(d.createTextNode(", " + what));
  }

  root.VPWinPin = { forPlayer: forPlayer, forHost: forHost, phoneLine: phoneLine, hostLine: hostLine, paint: paint };
})(typeof window !== "undefined" ? window : this);
