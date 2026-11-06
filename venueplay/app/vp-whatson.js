/* vp-whatson.js  -- THE VENUE'S OWN "WHAT'S ON" GUIDE, ONE SET OF DATE RULES FOR EVERY SCREEN (INBOX 110, 6 Nov 2026).

   Promised to Revolver Upstairs for the Thu 12 Nov release. A venue adds its own nights on the account page (Screen tab,
   "What's on"): DJs, gigs, club nights, specials. Each is ONE night (a date) or EVERY WEEK (a weekday, optionally until a
   date), with a start time, an optional short line and an optional picture (uploaded like a promo slide). They show:
     - on the venue TV between games (tv.html: a "What's on" list slide, and a poster slide for a night with a picture)
     - on the players' phones in the "This week here" strip (/app/vp-tonight.js: tap a day, see that day's nights)
     - on the account page, in date order (/app/billing.html)
   All three ask THIS file what is on when, so a weekly night, a finished one-off and "Tonight" read the same everywhere.

   THE STORED SHAPE (vp_venue_screen.events, migration 177; the Worker cleans it on save and again on every public read):
     { id, title, date:"2026-11-14" }                     one night
     { id, title, day:"fri", until?:"2026-12-18" }        every week (until: the last night it runs, optional)
     + start?:"22:00"  line?:"Free entry before 10pm"  image_url?:"https://.../venue-ads/<venue>/<file>"
   Every word in it is the venue's: whoever draws it sets it as text, never as HTML (tvSlides escapes).

   A night drops off by itself once its day is over: one night after its date, a weekly one after its until date.
   "Today" is the venue's own date, which the caller passes in as "YYYY-MM-DD" (a TV knows its venue's time zone; a
   phone and the account page use their own clock, which is the venue's for anyone standing in it).

   ES5, no dependencies, old TVs included. tools/test-whats-on.js runs it. */
(function (root) {
  "use strict";
  var DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  var LONG = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/, TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var URL_OK = /^https?:\/\/[A-Za-z0-9._~:\/?#@!$&*+,;=%-]+$/;   // tv.html's own rule for a slide's picture (the Worker only stores our own storage's https address)
  var MAX = 30;                       // the Worker's VPB_MAX_EVENTS: the gate makes the two agree

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /* "YYYY-MM-DD" -> a Date at local noon (noon, so a daylight-saving change never moves it to another day). */
  function parse(s) {
    var m = DATE_RE.exec(String(s || ""));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    return (d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
  }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(s, n) { var d = parse(s); if (!d) return ""; d.setDate(d.getDate() + n); return ymd(d); }
  function today(now) { return ymd(now || new Date()); }
  /* The date it is in a time zone ("Australia/Melbourne"), for the TV. Falls back to the device's own date. */
  function todayIn(tz, now) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date()); }
    catch (e) { return today(now); }
  }
  function dayKey(s) { var d = parse(s); return d ? DAYS[d.getDay()] : ""; }

  /* "19:30" -> "7:30pm", "22:00" -> "10pm", "00:30" -> "12:30am"; anything else is no time. */
  function time12(t) {
    var m = TIME_RE.exec(String(t || ""));
    if (!m) return "";
    var h = +m[1], ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return h + (m[2] === "00" ? "" : ":" + m[2]) + ap;
  }
  /* An apostrophe inside a word is the curly one, the way the account page and phones set it ("What’s"), so the TV
     never shows two kinds (design review, 6 Nov). */
  function curly(s) { return String(s).replace(/(\w)'(\w)/g, "$1\u2019$2"); }
  function str(s, n) { return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }

  /* One stored night, read defensively: what is not right is left out, and a night with no title or no day is no night. */
  function clean1(e) {
    if (!e || typeof e !== "object") return null;
    var o = { title: curly(str(e.title, 60)) };
    if (!o.title) return null;
    if (e.id != null && /^[A-Za-z0-9_-]{1,40}$/.test(String(e.id))) o.id = String(e.id);
    if (parse(e.date)) o.date = String(e.date);
    else if (DAYS.indexOf(e.day) !== -1) { o.day = e.day; if (parse(e.until)) o.until = String(e.until); }
    else return null;
    if (TIME_RE.test(String(e.start || ""))) o.start = String(e.start);
    var line = curly(str(e.line, 48)); if (line) o.line = line;
    if (typeof e.image_url === "string" && URL_OK.test(e.image_url) && e.image_url.indexOf("&#") === -1 && e.image_url.length <= 600) o.image_url = e.image_url;
    return o;
  }
  function clean(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length && out.length < MAX; i++) { var c = clean1(arr[i]); if (c) out.push(c); }
    return out;
  }
  /* Is this night on, on this date? */
  function isOn(e, s) {
    if (!e) return false;
    if (e.date) return e.date === s;
    if (!e.day || dayKey(s) !== e.day) return false;
    return !(e.until && s > e.until);
  }
  /* Still to come (or on today)? A one-off after its date and a weekly one after its until date are over. */
  function current(e, t) {
    if (!e) return false;
    if (e.date) return e.date >= t;
    return !(e.until && e.until < t);
  }
  function byStart(a, b) { var x = a.start || "99:99", y = b.start || "99:99"; return x < y ? -1 : x > y ? 1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0); }
  /* The nights on one date, earliest start first (no start goes last). */
  function on(events, s) {
    var out = [], list = clean(events);
    for (var i = 0; i < list.length; i++) if (isOn(list[i], s)) out.push(list[i]);
    return out.sort(byStart);
  }
  /* Every night from date t for n days, in date then time order: [{ date:"YYYY-MM-DD", ev }]. max caps the list. */
  function upcoming(events, t, n, max) {
    var out = [], list = clean(events);
    n = n || 7;
    for (var i = 0; i < n; i++) {
      var s = addDays(t, i), day = [];
      for (var j = 0; j < list.length; j++) if (isOn(list[j], s)) day.push(list[j]);
      day.sort(byStart);
      for (var k = 0; k < day.length; k++) { out.push({ date: s, ev: day[k] }); if (max && out.length >= max) return out; }
    }
    return out;
  }
  /* The next date a night is on, from t (a weekly one's next weekday; "" when it is over). */
  function next(e, t) {
    e = clean1(e); if (!e || !current(e, t)) return "";
    if (e.date) return e.date;
    for (var i = 0; i < 7; i++) { var s = addDays(t, i); if (isOn(e, s)) return s; }
    return "";
  }
  /* The account page's list: every night still to come, by its next date then its start. */
  function sorted(events, t) {
    var list = clean(events).filter(function (e) { return current(e, t) && next(e, t); });
    return list.sort(function (a, b) {
      var x = next(a, t), y = next(b, t);
      return x < y ? -1 : x > y ? 1 : byStart(a, b);
    });
  }
  /* "Tonight", "Tomorrow", "Fri 13 Nov" (long: "Friday 13 Nov"). */
  function dayLabel(s, t, long) {
    if (s === t) return "Tonight";
    if (s === addDays(t, 1)) return "Tomorrow";
    var d = parse(s); if (!d) return "";
    var k = DAYS[d.getDay()];
    return (long ? LONG[k] : SHORT[k]) + " " + d.getDate() + " " + MON[d.getMonth()];
  }
  /* How a night's "when" reads on the account page: "Every Friday, 10pm (until 18 Dec)", "Sat 14 Nov, 8pm". */
  function whenText(e, t) {
    e = clean1(e); if (!e) return "";
    var tm = time12(e.start), w;
    if (e.date) { var d = parse(e.date); w = SHORT[DAYS[d.getDay()]] + " " + d.getDate() + " " + MON[d.getMonth()]; }
    else {
      w = "Every " + LONG[e.day];
      if (e.until) { var u = parse(e.until); tm = (tm ? tm + ", " : "") + "until " + u.getDate() + " " + MON[u.getMonth()]; }
    }
    return w + (tm ? ", " + tm : "");
  }

  /* THE TV'S SLIDES (tv.html's ads loop). The next seven days, in date then time order:
       { type:"list", rows:[{ date, label, ev }] }   up to 5 nights a slide, at most 2 slides (10 nights)
       { type:"poster", date, label, ev }             one for each night with a picture, the soonest 3
     week (Dean, 6 Nov 2026: "yes, list our game nights too"): the venue's game week from its setup answers
     ([{ day:"wed", games:[{ game:"trivia", start:"19:00" }] }], as /join/info and /screen hand it over). Each game
     night joins the list as a row of its own ({ game:"trivia" } on the ev), so the slide is one guide to the week.
     Nothing on at all: no "What's on" slide (no empty card on the wall). Seven days hold each weekly night once, so a
     weekly night with a picture is one poster, never one a week. */
  var GAME_NIGHT = { trivia: "Trivia night", musical: "Musical bingo", bingo: "Bingo", raffles: "Raffle", members: "Members draw" };
  function gameNights(week, s) {
    var out = [], k = dayKey(s);
    if (!Array.isArray(week)) return out;
    week.forEach(function (d) {
      if (!d || d.day !== k || !Array.isArray(d.games)) return;
      d.games.forEach(function (g) {
        if (!g) return;
        /* A "Something else" night (game "other", its own name, e.g. Karaoke) is the venue's, not ours: no phone line.
           Several sessions of one game (count 2 to 4) say so: "Bingo \u00d72". */
        var other = g.game === "other", nm = other ? str(g.name, 40) : GAME_NIGHT[g.game];
        if (!nm) return;
        var n = (+g.count >= 2 && +g.count <= 4) ? +g.count : 0;
        out.push({ title: nm + (n ? " \u00d7" + n : ""), start: TIME_RE.test(String(g.start || "")) ? g.start : "", line: other ? "" : "Play on your phone", game: g.game });
      });
    });
    return out;
  }
  /* ROUND 4 (Dean's design rounds, 6 Nov 2026): the What's on slide is "feature and week" when any night this week has
     a picture: the soonest picture whole on the left, the week's rows on the right, six a view. A busy week rotates
     through more views, so no row is ever left out; each view features the next picture in turn.
       { type:"feature", feature:{ date, label, ev }, rows:[{ date, label, ev }] }
     With no picture this week it is the plain list instead, five a slide, balanced (7 rows are 4 and 3), one size
     for the set (fewer rows, bigger words):
       { type:"list", size:"m"|"l"|"xl", rows:[...] }
     At most 12 rows (two views of six). */
  function tvSlides(events, t, week) {
    var list = clean(events), up = [], i, j, MAXROWS = 12;
    for (i = 0; i < 7 && up.length < MAXROWS; i++) {
      var s = addDays(t, i), day = gameNights(week, s);
      for (j = 0; j < list.length; j++) if (isOn(list[j], s)) day.push(list[j]);
      day.sort(byStart);
      for (j = 0; j < day.length && up.length < MAXROWS; j++) up.push({ date: s, ev: day[j] });
    }
    var out = [];
    if (!up.some(function (x) { return !x.ev.game; })) return out;   // our games alone are not the venue's What's on
    function row(x, long) { return { date: x.date, label: dayLabel(x.date, t, long), ev: x.ev }; }
    var feats = up.filter(function (x) { return x.ev.image_url && !x.ev.game; }).slice(0, 3);
    if (feats.length) {
      var pages = Math.ceil(up.length / 6), views = Math.max(pages, feats.length);
      for (i = 0; i < views; i++) {
        var p = i % pages;
        out.push({ type: "feature", feature: row(feats[i % feats.length], true), rows: up.slice(p * 6, p * 6 + 6).map(function (x) { return row(x); }) });
      }
      return out;
    }
    var pg = Math.ceil(up.length / 5), per = Math.ceil(up.length / pg), size = per <= 2 ? "xl" : per === 3 ? "l" : "m";
    for (i = 0; i < up.length; i += per) out.push({ type: "list", size: size, rows: up.slice(i, i + per).map(function (x) { return row(x); }) });
    return out;
  }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function cssUrl(u) { u = String(u || ""); return (URL_OK.test(u) && u.indexOf("&#") === -1) ? encodeURI(u).replace(/[()';]/g, "") : ""; }
  /* The HTML of one of tvSlides' slides, for tv.html (its look is tv.html's .wo-* rules, the trivia new look: a small
     kicker over a big Anton headline, flat rows, tonight marked by a pink bar). venue: the venue's name. Times are
     written as people say them, "9pm", never "9PM". (The venue's own colours and background are a later job.) */
  /* logo: the venue's own logo, the one it already uploads for its TV (vp_venue_screen.logo_url, as /screen hands it
     over); with none, its name stands in. Our own mark is tv.html's corner wordmark, always on the wall. */
  function tvHtml(sl, venue, logo) {
    if (!sl) return "";
    venue = typeof venue === "string" ? venue : "";
    var lg = cssUrl(logo), logoHtml = lg ? '<img class="wo-logo" alt="" src="' + lg + '">' : "";
    function rowsHtml(rows) {
      var h = "";
      rows.forEach(function (r) {
        var tn = r.label === "Tonight";
        /* The when on the left, day over time, so a row reads left to right with no empty middle (round 4, M2). */
        h += '<div class="wo-row' + (tn ? " tonight" : "") + (r.ev.game ? " game" : "") + '">' +
          '<span class="wo-when2"><span class="wo-day">' + esc(r.label) + '</span><span class="wo-time">' + esc(time12(r.ev.start)) + '</span></span>' +
          '<span class="wo-what"><b>' + esc(r.ev.title) + '</b>' + (r.ev.line ? '<i>' + esc(r.ev.line) + '</i>' : '') + '</span></div>';
      });
      return h;
    }
    var head = '<div class="wo-top">' + (logoHtml || (venue ? '<div class="wo-kick">' + esc(venue) + '</div>' : '')) + '<div class="wo-head">What’s on</div></div>';
    if (sl.type === "list") {
      return '<div class="wo-wall wo-' + (sl.size || "m") + '"><div class="wo-in">' + head + '<div class="wo-list">' + rowsHtml(sl.rows) + '</div></div></div>';
    }
    if (sl.type === "feature") {
      var f = sl.feature, bg = cssUrl(f.ev.image_url);
      if (!bg) return "";
      var tm = time12(f.ev.start);
      return '<div class="wo-wall wo-b"><div class="wb-feat"><div class="wb-art" style="background-image:url(' + bg + ')"></div>' +
        '<div class="wb-pic" style="background-image:url(' + bg + ')"></div>' +
        '<div class="wb-when' + (f.label === "Tonight" ? " tn" : "") + '">' + esc(f.label) + (tm ? " · " + esc(tm) : "") + '</div></div>' +
        '<div class="wb-side">' + head + '<div class="wo-list">' + rowsHtml(sl.rows) + '</div></div></div>';
    }
    return "";
  }

  root.VPWhatsOn = { MAX: MAX, clean: clean, clean1: clean1, isOn: isOn, current: current, on: on, upcoming: upcoming, next: next,
    sorted: sorted, dayLabel: dayLabel, whenText: whenText, time12: time12, today: today, todayIn: todayIn, addDays: addDays,
    dayKey: dayKey, tvSlides: tvSlides, tvHtml: tvHtml, esc: esc };
})(typeof window !== "undefined" ? window : this);
