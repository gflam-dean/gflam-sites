/* vp-tonight.js  -- THE PLAYER PHONE WHILE IT WAITS, ONE COPY FOR EVERY GAME (6 Nov 2026).

   Dean picked two of the round 4 mock-ups (reports/fri-6nov-live-fixes/host-mock-4/REVIEW.html):

   OPTION C, the lobby ("You're in"):   VPTonight.lobby(box, o)
     "You're in, Sam" beside the green ring tick, then a TONIGHT card: the game this phone joined, badged NEXT, with its
     prize when the host has set one, and every other game the venue runs on tonight's weekday, badged LATER. Only one
     game tonight: the badge reads TONIGHT and there is no Later row. Then the one lobby line. The venue's ad
     (/app/vp-phonead.js) sits underneath, in its own fixed slot.

   OPTION B, nothing is on ("No game on right now"):   VPTonight.noGame(box, o)
     "You're in, Sam", then a NEXT GAME NIGHT card that turns, one at a time, through the venue's coming nights
     ("Wednesday" / "Trivia and Musical bingo"), and "Members draw" / "Scan the QR code again on the night." when the
     venue runs one. A phone that is already on the venue's list reads "You're on <venue>'s list. Change this from any
     of their emails." The one-field email sign-up is NOT here: no Worker route takes a sign-up from a phone with no
     game yet (to build: a /join/list route and its consent record).

   Only stored data: the nights and games the venue gave the setup wizard (vp_venue_settings.setup_answers, sent by
   /join/info as nights and games). No start times, and no record of which game runs on which night, so every night
   lists the venue's games. Every word from the venue or a player is set as text, never as HTML.

   o = { name, me:"trivia"|"musical"|"bingo", prize, wait, nights:["wed","fri"], games:["trivia","musical"],
         venue, onList, now }   (now: a Date, for the suites; the phone's own clock otherwise)

   ES5, no dependencies. Its look is /app/vp-phone.css section 6. tools/test-vp-tonight.js runs it. */
(function (root) {
  "use strict";
  var d = root.document;
  var DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  var GAME_NAME = { trivia: "Trivia", musical: "Musical bingo", bingo: "Bingo" };
  var PLAYED = ["trivia", "musical", "bingo"];   // games played on a phone; raffles and members draws are not "games later"
  var TICK = '<div class="vp-tick" aria-hidden="true"><svg viewBox="0 0 26 26"><path d="M6 13.5l4.6 4.6L20 8.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
  var _turn = null;

  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function games(o) { var g = (o && o.games) || []; return PLAYED.filter(function (k) { return g.indexOf(k) !== -1; }); }
  function today(o) { return DAYS[((o && o.now) || new Date()).getDay()]; }
  function joinNames(list) { list = list.map(function (k) { return GAME_NAME[k]; }); return list.length < 2 ? (list[0] || "") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]; }

  /* Tonight's rows: this game first, then every other game the venue plays, when tonight is one of its nights. */
  function tonight(o) {
    var me = o.me, rows = [{ game: me, name: GAME_NAME[me] || "Game", prize: o.prize || "" }];
    if (((o.nights || []).indexOf(today(o)) !== -1)) {
      games(o).forEach(function (k) { if (k !== me) rows.push({ game: k, name: GAME_NAME[k], prize: "" }); });
    }
    rows[0].badge = rows.length > 1 ? "Next" : "Tonight";
    for (var i = 1; i < rows.length; i++) rows[i].badge = "Later";
    return rows;
  }
  /* The coming nights, from today on, then "Members draw" when the venue runs one. */
  function upcoming(o) {
    var out = [], g = games(o), start = DAYS.indexOf(today(o)), nights = o.nights || [];
    for (var i = 0; i < 7; i++) {
      var k = DAYS[(start + i) % 7];
      if (nights.indexOf(k) !== -1) out.push({ big: DAY_NAME[k], line: g.length ? joinNames(g) : "Games night" });
    }
    if ((o.games || []).indexOf("members") !== -1) out.push({ big: "Members draw", line: "Scan the QR code again on the night." });
    if (!out.length) out.push({ big: "Game nights", line: "Scan the QR code on the TV again on the night." });
    return out;
  }

  function head(name) {
    var h = el("div", "vpt-head"); h.innerHTML = TICK;
    h.appendChild(el("div", "t", "You’re in" + (name ? ", " + name : "")));
    return h;
  }
  function stop() { if (_turn) { clearInterval(_turn); _turn = null; } }

  function lobby(box, o) {
    if (!box) return;
    stop(); o = o || {}; box.innerHTML = "";
    box.appendChild(head(o.name));
    var card = el("div", "vpt-night"); card.appendChild(el("div", "nk", "Tonight"));
    tonight(o).forEach(function (r, i) {
      var row = el("div", "row" + (i ? " later" : "")); row.setAttribute("data-game", r.game);
      row.appendChild(el("span", "bd" + (i ? "" : " next"), r.badge));
      var g = el("div", "g"); g.appendChild(el("b", "", r.name)); if (r.prize) g.appendChild(el("span", "", r.prize));
      row.appendChild(g); card.appendChild(row);
    });
    box.appendChild(card);
    box.appendChild(el("p", "vpt-wait", o.wait || "The game will start here when the host is ready."));
  }

  function noGame(box, o) {
    if (!box) return;
    stop(); o = o || {}; box.innerHTML = "";
    box.appendChild(head(o.name));
    var list = upcoming(o), card = el("div", "vpt-hero"), k = el("div", "k", "Next game night"), big = el("div", "d"), line = el("div", "g");
    card.appendChild(k); card.appendChild(big); card.appendChild(line);
    var dots = el("div", "vpt-dots"); list.forEach(function () { dots.appendChild(el("i")); });
    if (list.length > 1) card.appendChild(dots);
    var at = 0;
    function paint() {
      var e = list[at]; big.textContent = e.big; line.textContent = e.line;
      k.textContent = e.big === "Members draw" ? "Also at this venue" : "Next game night";
      for (var i = 0; i < dots.children.length; i++) dots.children[i].className = i === at ? "on" : "";
    }
    paint();
    if (list.length > 1) _turn = setInterval(function () { if (!box.isConnected && box.isConnected !== undefined) { stop(); return; } at = (at + 1) % list.length; paint(); }, 4000);
    box.appendChild(card);
    if (o.onList) {
      var v = String(o.venue || "this venue");
      box.appendChild(el("p", "vpt-onlist", "You’re on " + v + "’s list. Change this from any of their emails."));
    }
  }

  root.VPTonight = { lobby: lobby, noGame: noGame, stop: stop, tonight: tonight, upcoming: upcoming };
})(typeof window !== "undefined" ? window : this);
