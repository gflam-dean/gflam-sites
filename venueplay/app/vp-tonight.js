/* vp-tonight.js  -- THE PLAYER PHONE WHILE IT WAITS, ONE COPY FOR EVERY GAME (6 Nov 2026).

   Dean's final picks (reports/fri-6nov-live-fixes/host-mock-5/DEAN-PICKS.md, round 5):

   "YOU'RE IN" (the lobby):   VPTonight.lobby(box, o)
     "You're in, Sam" beside the green ring tick, centred, then the Tonight spot: this game badged NEXT with "Tonight 7pm"
     (its stored start; its prize after it only when the host set a real one), and any other game stored for tonight
     badged LATER or EARLIER with its time. Then the "THIS WEEK HERE" strip: today and the next six days, the venue's game
     nights marked. Tap a day and the Tonight spot shows that night's games ("Trivia night, ask for start time",
     "Members draw, 7:30pm"); tap Today to come back. Then the one lobby line. The venue's ad and our logo sit under it,
     drawn by the page (/app/vp-phonead.js, .pfoot).

   "NO GAME ON RIGHT NOW":   VPTonight.noGame(box, o)   (Dean's round 7)
     No "You're in" and no "No game here right now": it leads with "NEXT GAME HERE / Wednesday, Trivia 7pm", then the SMALL
     optional "Get a heads up by email" at the top (only when the page passes o.signup, a function that sends it; after a
     confirmed send the box closes, is not shown again on this phone, and nothing says "you're on the list"), then the
     week strip (tap a day and the lead line shows that night). The venue's ad and our logo sit at the bottom.

   DATA, read defensively. Only what the venue told the setup wizard (vp_venue_settings.setup_answers, migration 163),
   passed on by /join/info:
     week    [{"day":"wed","games":[{"game":"trivia","start":"19:00"}]}, ...]   which game on which night, an optional
             start (the setup wizard's game week, cleaned by the Worker as VPGameSetup.cleanWeek does)
     nights  ["wed","fri"], games ["trivia","musical"]   the older answers, used only when no week is stored
   With no week, the strip marks the nights only and says "Ask at the bar for start times". Nothing is invented.
   Every word from the venue or a player is set as text, never as HTML.

   THE VENUE'S OWN NIGHTS (INBOX 110, "What's on", 6 Nov 2026): o.events, the venue's DJs, gigs, club nights and
   specials from /join/info (cleaned by the Worker; the date rules are /app/vp-whatson.js, the same file the TV and
   the account page use). A day with one has a gold dot under its date in the strip; tapping it lists them beside our
   games, each badged with its start time. The lobby's Tonight spot lists tonight's after our game (three at most,
   then "+2 more tonight"); the no-game screen lists the picked day's under the strip. No events: nothing changes.

   o = { name, me:"trivia"|"musical"|"bingo", prize, wait, week, nights, games, events, signup(email, optin) -> Promise,
         signedUp, venue, now }   (now: a Date, for the suites; the phone's clock otherwise)

   ES5, no dependencies. Its look is /app/vp-phone.css section 6. tools/test-vp-tonight.js runs it. */
(function (root) {
  "use strict";
  var d = root.document;
  var DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  var LONG = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  var GAME_NAME = { trivia: "Trivia", musical: "Musical bingo", bingo: "Bingo", raffles: "Raffle", members: "Members draw" };
  var NIGHT_NAME = { trivia: "Trivia night", musical: "Musical bingo", bingo: "Bingo", raffles: "Raffle", members: "Members draw" };
  var TICK = '<div class="vp-tick" aria-hidden="true"><svg viewBox="0 0 26 26"><path d="M6 13.5l4.6 4.6L20 8.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';

  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function now(o) { return (o && o.now) || new Date(); }
  function dayKey(dt) { return DAYS[dt.getDay()]; }
  function addDays(dt, n) { var x = new Date(dt.getTime()); x.setDate(x.getDate() + n); return x; }

  /* "19:30" -> "7:30pm", "19:00" -> "7pm"; anything else is not a time and is left out. */
  function time12(t) {
    var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(t || ""));
    if (!m) return "";
    var h = +m[1], mm = m[2], ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return h + (mm === "00" ? "" : ":" + mm) + ap;
  }
  /* That night's games from the venue's week (the wizard's shape: [{day, games:[{game, start}]}]), or null when no week
     is stored: unknown, never guessed. */
  function gamesOn(o, key) {
    var wk = o && o.week;
    if (!Array.isArray(wk) || !wk.length) return null;   // the venue's own events are not games: eventsOn() below
    var out = [];
    wk.forEach(function (dd) {
      if (!dd || dd.day !== key || !Array.isArray(dd.games)) return;
      dd.games.forEach(function (x) {
        if (!x) return;
        /* "Something else" nights (game "other" with its own name, e.g. Karaoke) and several sessions of one game
           (count 2 to 4: "Bingo \u00d72"), from the wizard's game week (6 Nov 2026). */
        var nm = x.game === "other" ? String(x.name || "").trim().slice(0, 40) : GAME_NAME[x.game];
        if (!nm) return;
        var n = (+x.count >= 2 && +x.count <= 4) ? +x.count : 0;
        out.push({ game: x.game, label: nm + (n ? " \u00d7" + n : ""), night: x.game === "other" ? nm : NIGHT_NAME[x.game] + (n ? " \u00d7" + n : ""),
                   time: time12(x.start), start: time12(x.start) ? String(x.start).replace(/^(\d):/, "0$1:") : "" });
      });
    });
    return out;
  }
  function isNight(o, key) {
    var ng = gamesOn(o, key);
    if (ng) return ng.length > 0;
    return ((o && o.nights) || []).indexOf(key) !== -1;
  }
  /* The venue's own nights on that date (vp-whatson.js), or none when the page has not loaded it. */
  function eventsOn(o, dt) {
    var W = root.VPWhatsOn;
    if (!W || !o || !Array.isArray(o.events) || !o.events.length) return [];
    return W.on(o.events, W.today(dt));
  }
  /* The venue's nights as rows, one line each (title, then its line, cut with an ellipsis). cap: at most that many rows,
     the last saying "+N more" when there are more. */
  function eventRows(list, cap) {
    var rows = [], n = cap && list.length > cap ? cap - 1 : list.length;
    for (var i = 0; i < n; i++) {
      var e = list[i], t = time12(e.start);
      rows.push({ game: "", ev: true, badge: t || "On", name: e.title, sub: "" });   // the title only, on up to two lines (design review, 6 Nov)
    }
    if (n < list.length) rows.push({ game: "", ev: true, more: true, badge: "", name: "+" + (list.length - n) + " more", sub: "" });
    return rows;
  }
  function hasTimes(o) {
    var any = false;
    ((o && o.week) || []).forEach(function (dd) { ((dd && dd.games) || []).forEach(function (x) { if (x && time12(x.start)) any = true; }); });
    return any;
  }

  /* TONIGHT's rows in the lobby (Dean's round 7): this game badged NEXT, "Tonight 7pm" under it (its start, when stored;
     its prize after, when the host set a real one); any other game stored for tonight badged LATER (or EARLIER when it
     starts before this one), "Tonight 9pm". */
  function tonight(o) {
    var me = o.me, list = gamesOn(o, dayKey(now(o))) || [], mine = "", myTime = "";
    list.forEach(function (x) { if (x.game === me) { mine = x.start || ""; myTime = x.time || ""; } });
    var rows = [{ game: me, name: GAME_NAME[me] || "Game", badge: "Next", sub: "Tonight" + (myTime ? " " + myTime : "") + (o.prize ? ", " + o.prize : "") }];
    list.forEach(function (x) {
      if (x.game === me) return;
      rows.push({ game: x.game, name: x.label, badge: (mine && x.start && x.start < mine) ? "Earlier" : "Later", sub: "Tonight" + (x.time ? " " + x.time : "") });
    });
    return rows;
  }
  /* Another night's rows, for the spot when a day is tapped. */
  function nightRows(o, dt) {
    var key = dayKey(dt), badge = SHORT[key] + " " + dt.getDate(), list = gamesOn(o, key), evs = eventRows(eventsOn(o, dt), 3);
    if (list && list.length) return list.map(function (x) {
      return { game: x.game, badge: badge, name: x.night, sub: x.time ? x.time : "Ask for start time" };
    }).concat(evs);
    if (!list && isNight(o, key)) return [{ game: "", badge: badge, name: "Game night", sub: "Ask at the bar for what’s on and start times" }].concat(evs);
    if (evs.length) return evs;   // the venue's own nights, and no game: no "No games this night" over them
    return [{ game: "", badge: badge, name: "No games this night", sub: "" }];
  }
  /* The seven days from today. */
  function week(o) {
    var t = now(o), out = [];
    for (var i = 0; i < 7; i++) {
      var dt = addDays(t, i), k = dayKey(dt);
      out.push({ i: i, date: dt, key: k, label: i ? SHORT[k] : "Today", small: String(dt.getDate()), on: isNight(o, k), ev: eventsOn(o, dt).length > 0 });
    }
    return out;
  }

  /* TIGHT (design review, 6 Nov 2026): on a short phone, a tapped day with the venue's nights can be taller than the room
     above the ad. Then #app gets .vpt-tight and the banner is a little shorter at its bottom (its top stays where the
     content puts it), so our logo at the foot keeps its 12px. Measured after the browser has laid the page out. */
  function fit() {
    var go = function () {
      try {
        var app = d.getElementById && d.getElementById("app");
        if (!app || !app.classList) return;
        app.classList.remove("vpt-tight");
        if (d.documentElement && root.innerHeight && d.documentElement.scrollHeight > root.innerHeight + 1) app.classList.add("vpt-tight");
      } catch (e) {}
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(go); else if (root.setTimeout) root.setTimeout(go, 0);
  }
  function head(name) {
    var h = el("div", "vpt-head"); h.innerHTML = TICK;
    h.appendChild(el("div", "t", "You’re in" + (name ? ", " + name : "")));
    return h;
  }
  function paintRows(spot, rows, title) {
    spot.innerHTML = "";
    if (title) spot.appendChild(el("div", "nk", title));
    rows.forEach(function (r, i) {
      var row = el("div", "row" + (r.badge === "Later" || r.badge === "Earlier" ? " later" : "") + (r.ev ? " ev" : "") + (r.more ? " more" : "")); row.setAttribute("data-game", r.game || "");
      row.appendChild(el("span", "bd" + (i === 0 && r.badge === "Next" ? " next" : "") + (r.ev ? " t" : ""), r.badge));
      var g = el("div", "g"); g.appendChild(el("b", "", r.name)); if (r.sub) g.appendChild(el("span", "", r.sub));
      row.appendChild(g); spot.appendChild(row);
    });
  }
  /* THIS WEEK HERE: seven tappable days. onPick(day) repaints the spot. */
  function strip(o, picked, onPick) {
    var w = el("div", "vpt-week"), k = el("div", "k");
    k.appendChild(el("span", "", "This week here"));
    var days = week(o);
    if (!hasTimes(o)) k.appendChild(el("span", "ask", "Ask at the bar for start times"));
    else if (days.some(function (x) { return x.ev; })) k.appendChild(el("span", "ask", "Tap a day"));   // the venue's own nights are a tap away
    w.appendChild(k);
    var btns = [], row = el("div", "days" + (days.some(function (x) { return x.ev; }) ? " has-ev" : ""));
    days.forEach(function (dd) {
      var b = el("button", "d" + (dd.i === 0 ? " now" : "") + (dd.on ? " on" : "") + (dd.ev ? " ev" : "") + (dd.i === picked ? " picked" : ""));
      b.setAttribute("type", "button"); b.setAttribute("data-day", dd.key);
      b.setAttribute("aria-pressed", dd.i === picked ? "true" : "false");
      b.appendChild(el("b", "", dd.label)); b.appendChild(el("small", "", dd.small));
      b.onclick = function () {
        btns.forEach(function (x, j) { x.className = x.className.replace(/ picked\b/g, "") + (j === dd.i ? " picked" : ""); x.setAttribute("aria-pressed", j === dd.i ? "true" : "false"); });
        onPick(dd);
        fit();
      };
      btns.push(b); row.appendChild(b);
    });
    w.appendChild(row);
    return { el: w, days: days, buttons: btns };
  }

  function lobby(box, o) {
    if (!box) return;
    o = o || {}; box.innerHTML = "";
    box.appendChild(head(o.name));
    var spot = el("div", "vpt-night");
    /* The lobby as it opens is exactly Dean's round 7 lobby, so the venue's ad and our logo still fit a 664px screen.
       The venue's own nights are one tap away: the strip says "Tap a day", Today has its dot, and tapping Today lists
       tonight's beside our game (design review, 6 Nov 2026). */
    function today(tapped) {
      var evs = tapped ? eventsOn(o, now(o)) : [];
      var rows = tonight(o);
      if (evs.length) rows.forEach(function (r) { r.sub = String(r.sub || "").replace(/^Tonight,? ?/, ""); });   // the kicker says Tonight once
      paintRows(spot, rows.concat(eventRows(evs, 3)), evs.length ? "Tonight" : "");
    }
    today();
    box.appendChild(spot);
    var s = strip(o, 0, function (dd) {
      if (dd.i === 0) { today(true); return; }
      var rows = nightRows(o, dd.date);
      /* With the venue's own nights in it, the card says which day it is ("FRIDAY 13"): their rows carry a time, not a day. */
      paintRows(spot, rows, rows.some(function (r) { return r.ev; }) ? LONG[dd.key] + " " + dd.date.getDate() : "");
    });
    box.appendChild(s.el);
    box.appendChild(el("p", "vpt-wait", o.wait || "The game will start here when the host is ready."));
    fit();
    return s;
  }

  /* "Next game here: Wednesday, Trivia 7pm" for a day; "Tonight" for today; unknown games: the day and "ask at the bar". */
  function nightLine(o, dd) {
    var list = gamesOn(o, dd.key), day = dd.i === 0 ? "Tonight" : LONG[dd.key];
    if (list && list.length) return day + ", " + list.map(function (x) { return x.label + (x.time ? " " + x.time : ""); }).join(" and ");
    if (!list && dd.on) return day + ", ask at the bar for what\u2019s on";
    return day + ": no games";
  }
  function noGame(box, o) {
    if (!box) return;
    o = o || {}; box.innerHTML = "";
    /* Dean's round 7: no "You're in" and no "No game here right now". It leads with the NEXT game here (from today on),
       then the small optional sign-up, then the week; tapping a day puts that night in the lead line. */
    var days = week(o), first = -1;
    for (var i = 0; i < days.length; i++) { if (days[i].on) { first = i; break; } }
    var lead = el("div", "vpt-next"), k = el("span", "k"), line = el("span", "l");
    lead.appendChild(k); lead.appendChild(line);
    function paint(dd, picked) {
      k.textContent = picked ? (dd.i === 0 ? "Today" : LONG[dd.key] + " " + dd.date.getDate()) : "Next game here";
      line.textContent = nightLine(o, dd).replace(/^(Tonight|[A-Za-z]+day)(, |: )/, picked ? "" : "$1$2");
      if (picked && /^no games$/.test(line.textContent)) line.textContent = "No games on " + (dd.i === 0 ? "today" : LONG[dd.key]);   // one line (design review)
    }
    if (first >= 0) paint(days[first], false);
    else { k.textContent = "Next game here"; line.textContent = "Ask at the bar for the next game night"; }
    box.appendChild(lead);
    if (typeof o.signup === "function" && !o.signedUp) box.appendChild(signupBox(o));
    /* The venue's own nights for the picked day, under the strip (the first game night's to start, else today's). */
    var evBox = el("div", "vpt-night vpt-evs");
    function paintEvents(dd) {
      var list = eventsOn(o, dd.date);
      evBox.hidden = !list.length;
      if (list.length) paintRows(evBox, eventRows(list, 3), "");   // no label: the lead line names the day, and the ad below says What's on at <venue>
    }
    var start = first >= 0 ? first : 0;
    var s = strip(o, start, function (dd) { paint(dd, true); paintEvents(dd); });
    box.appendChild(s.el);
    paintEvents(days[start]);
    box.appendChild(evBox);
    fit();
    return s;
  }
  /* "Get a heads up by email": one field, the venue's optional offers tick, Sign me up. Closes once sent. */
  function signupBox(o) {
    var f = el("form", "vpt-sign"); f.setAttribute("novalidate", "");
    f.appendChild(el("div", "lb", "Get a heads up by email"));
    var r = el("div", "row1"), inp = el("input"), btn = el("button", "", "Sign me up");
    inp.setAttribute("type", "email"); inp.setAttribute("name", "email"); inp.setAttribute("autocomplete", "email");
    inp.setAttribute("placeholder", "Your email"); inp.setAttribute("aria-label", "Your email");
    btn.setAttribute("type", "submit");
    r.appendChild(inp); r.appendChild(btn); f.appendChild(r);
    var cb = null;
    if (o.offers !== false) {   // the venue's offers tick, only where the venue collects it (the page says)
      var tk = el("label", "tk"); cb = el("input");
      cb.setAttribute("type", "checkbox");
      tk.appendChild(cb); tk.appendChild(el("span", "", "Send me offers from " + (o.venue || "this venue") + ". I\u2019m 18 or over."));
      f.appendChild(tk);
    }
    var err = el("div", "err"); err.setAttribute("role", "status"); f.appendChild(err);
    f.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var v = String(inp.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err.textContent = "That email doesn’t look right."; return false; }
      btn.disabled = true; err.textContent = "";
      Promise.resolve(o.signup(v, !!(cb && cb.checked))).then(function () {
        if (f.parentNode) f.parentNode.removeChild(f);   // closes; the screen is the week again, nothing more is said
      }, function () { btn.disabled = false; err.textContent = "Could not send that. Try again in a moment."; });
      return false;
    };
    return f;
  }

  /* "JOIN {VENUE}'S LIST" IN THE MENU (Dean, 6 Nov 2026): a player who said no at the join screen can change their mind
     later, on every game's phone. One row in the menu; tapped, it opens the fields the venue collects (email, mobile),
     the same approved tick "Send me offers from {venue}. I'm 18 or over.", and "Join the list". The tick is what joining
     the list means, so the button sends only with it ticked. After a confirmed send the row goes for good (the page
     keeps that on the phone and does not draw it again).
       o = { venue, collect:{ email, mobile }, send(fields) -> Promise, done() }   fields = { email, mobile, optin:true } */
  function menuList(box, o) {
    if (!box) return null;
    o = o || {}; box.innerHTML = "";
    var c = o.collect || {};
    if (!(c.email || c.mobile) || typeof o.send !== "function") return null;
    var v = String(o.venue || "this venue");
    var row = el("button", "menuitem vpt-listrow", "Join " + v + "\u2019s list"); row.setAttribute("type", "button"); row.setAttribute("aria-expanded", "false");
    var f = el("form", "vpt-listform hidden"); f.setAttribute("novalidate", "");
    var em = null, mo = null;
    function field(type, ph, ac) { var i = el("input"); i.setAttribute("type", type); i.setAttribute("placeholder", ph); i.setAttribute("aria-label", ph); i.setAttribute("autocomplete", ac); f.appendChild(i); return i; }
    if (c.email) em = field("email", "Your email", "email");
    if (c.mobile) mo = field("tel", "Your mobile", "tel");
    var tk = el("label", "tk"), cb = el("input"); cb.setAttribute("type", "checkbox");
    tk.appendChild(cb); tk.appendChild(el("span", "", "Send me offers from " + v + ". I\u2019m 18 or over.")); f.appendChild(tk);
    var go = el("button", "go", "Join the list"); go.setAttribute("type", "submit"); f.appendChild(go);
    var err = el("div", "err"); err.setAttribute("role", "status"); f.appendChild(err);
    row.onclick = function () { var open = /\bhidden\b/.test(f.className); f.className = "vpt-listform" + (open ? "" : " hidden"); row.setAttribute("aria-expanded", open ? "true" : "false"); };
    f.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var ev = em ? String(em.value || "").trim() : "", mv = mo ? String(mo.value || "").trim() : "";
      if (!cb.checked) { err.textContent = "Tick the box to join the list."; return false; }
      if (ev && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev)) { err.textContent = "That email doesn\u2019t look right."; return false; }
      if (mv && !/^\+?[0-9 ]{8,18}$/.test(mv)) { err.textContent = "That mobile doesn\u2019t look right."; return false; }
      if (!ev && !mv) { err.textContent = c.email ? "Pop your email in first." : "Pop your mobile in first."; return false; }
      go.disabled = true; err.textContent = "";
      Promise.resolve(o.send({ email: ev, mobile: mv, optin: true })).then(function () {
        box.innerHTML = "";   // on the list: the row is gone
        if (typeof o.done === "function") o.done();
      }, function () { go.disabled = false; err.textContent = "Could not send that. Try again in a moment."; });
      return false;
    };
    box.appendChild(row); box.appendChild(f);
    return { row: row, form: f };
  }

  root.VPTonight = { lobby: lobby, noGame: noGame, menuList: menuList, tonight: tonight, nightRows: nightRows, week: week, time12: time12, eventsOn: eventsOn };
})(typeof window !== "undefined" ? window : this);
