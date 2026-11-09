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
  /* "2pm", "2:30 PM", "2 pm" -> "2pm" / "2:30pm" (the venue's own words in its line); anything else is "". */
  function normT(s) {
    var m = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(String(s || "").replace(/^\s+|\s+$/g, ""));
    if (!m || +m[1] < 1 || +m[1] > 12) return "";
    return +m[1] + (m[2] && m[2] !== "00" ? ":" + m[2] : "") + m[3].toLowerCase() + "m";
  }
  /* THE TIME ONCE (Dean, 9 Nov 2026: Lunatic Hotel's "2pm" with "2pm to 6pm" under it). A venue often writes the hours
     in its one line. When the line starts with the start time, that part moves up beside the start and comes off the
     line: start 14:00, line "2pm to 6pm" -> time "2pm to 6pm", no line; "2pm till late, free entry" -> "2pm to late"
     and "Free entry". A line that does not start with the start time is left exactly as the venue wrote it. */
  var RANGE_RE = /^\s*(?:from\s+)?(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)(?:\s*(?:to|-|\u2013|\u2014|until|till|til)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|late|close)\b)?[\s,.;:\u2013\u2014-]*([\s\S]*)$/i;
  function whenParts(e) {
    var t = time12(e && e.start), line = String((e && e.line) || "");
    if (!t || !line) return { time: t, line: line };
    var m = RANGE_RE.exec(line);
    if (!m || normT(m[1]) !== t) return { time: t, line: line };
    var end = m[2] ? (/^(late|close)$/i.test(m[2]) ? m[2].toLowerCase() : normT(m[2])) : "";
    var rest = m[3] || "";
    if (/^(starts?|start time|kick ?off|onwards?|on)[.!]?$/i.test(rest)) rest = "";   // "7:30pm start" says no more than 7:30pm
    if (rest) rest = rest.charAt(0).toUpperCase() + rest.slice(1);
    return { time: end ? t + " to " + end : t, line: rest };
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
        var rs = up.slice(p * 6, p * 6 + 6);
        out.push({ type: "feature", size: rs.length <= 2 ? "xl" : rs.length <= 3 ? "l" : "m", feature: row(feats[i % feats.length], true), rows: rs.map(function (x) { return row(x); }) });   // fewer rows, bigger words
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
  /* logoHow (9 Nov 2026, Dean: "a logo with a white background shows as a white square"): tv.html takes the logo's
     plain background off in the TV itself (VPLogo.forDark, the account page's own Remove background) and hands the
     result over as a blob: address. "clear": that see-through copy; "wait": still working on it, so the logo is held
     back rather than flash a white box; "plate": it could not be cleaned (no plain edge, or the picture could not be
     read), so it sits on a small rounded plate on purpose; anything else: as uploaded (it was see-through already). */
  var LOCAL_RE = /^(?:blob:https?:\/\/[A-Za-z0-9.:\/_-]+|data:image\/png;base64,[A-Za-z0-9+\/=]+)$/;
  /* How long a title is, as a class: the TV sets a long one smaller from the start (fit() below then fine-tunes it on
     the wall), so "Meat raffles and members draw" sits on a line where it can. */
  function lenClass(t) { var n = String(t || "").length; return n <= 14 ? "t1" : n <= 22 ? "t2" : n <= 32 ? "t3" : "t4"; }
  function tvHtml(sl, venue, logo, logoHow) {
    if (!sl) return "";
    venue = typeof venue === "string" ? venue : "";
    var lg = cssUrl(logo) || (LOCAL_RE.test(String(logo || "")) ? String(logo) : "");
    var lcls = logoHow === "wait" ? " wo-wait" : logoHow === "plate" ? " wo-plate" : "";
    var logoHtml = lg ? '<img class="wo-logo' + lcls + '" alt="" src="' + lg + '">' : "";
    function rowsHtml(rows) {
      var h = "";
      rows.forEach(function (r) {
        var tn = r.label === "Tonight", wp = whenParts(r.ev);
        /* Day over time, then the title and its line; the list draws these as tiles across the wall (9 Nov 2026),
           the feature view as rows beside the picture. The time says the hours once ("2pm to 6pm"). */
        h += '<div class="wo-row ' + lenClass(r.ev.title) + (tn ? " tonight" : "") + (r.ev.game ? " game" : "") + '">' +
          '<span class="wo-when2"><span class="wo-day">' + esc(r.label) + '</span><span class="wo-time">' + esc(wp.time) + '</span></span>' +
          '<span class="wo-what"><b>' + esc(r.ev.title) + '</b>' + (wp.line ? '<i>' + esc(wp.line) + '</i>' : '') + '</span></div>';
      });
      return h;
    }
    var head = '<div class="wo-top' + (logoHtml ? '' : ' k') + '">' + (logoHtml || (venue ? '<div class="wo-kick">' + esc(venue) + '</div>' : '')) + '<div class="wo-head">What’s on</div></div>';
    if (sl.type === "list") {
      /* THE LIST AS TILES (Dean, 9 Nov 2026: the rows filled the left half and left the right half empty). One tile a
         night across the whole width, every tile the same size: 1, 2 or 3 side by side, 4 as two by two, 5 as three
         over two. */
      return '<div class="wo-wall wo-tiles wo-' + (sl.size || "m") + ' wo-n' + Math.min(5, sl.rows.length) + '"><div class="wo-in">' + head + '<div class="wo-list">' + rowsHtml(sl.rows) + '</div></div></div>';
    }
    if (sl.type === "feature") {
      var f = sl.feature, bg = cssUrl(f.ev.image_url);
      if (!bg) return "";
      var tm = whenParts(f.ev).time;   // the hours once (9 Nov 2026)
      return '<div class="wo-wall wo-b wo-b' + (sl.size || "m") + '"><div class="wb-feat"><div class="wb-art" style="background-image:url(' + bg + ')"></div>' +
        '<div class="wb-pic" style="background-image:url(' + bg + ')"></div>' +
        '<div class="wb-when' + (f.label === "Tonight" ? " tn" : "") + '">' + esc(f.label) + (tm ? " · " + esc(tm) : "") + '</div>' +
        '<div class="wb-title">' + esc(f.ev.title) + '</div></div>' +   // its name too, for a poster with no words on it (round 5)
        '<div class="wb-side">' + head + '<div class="wo-list">' + rowsHtml(sl.rows) + '</div></div></div>';
    }
    return "";
  }

  /* FIT ON THE WALL (9 Nov 2026). Called by tv.html once a slide is in the page (and again when the fonts arrive or
     the screen changes size). A title or a time wider than its space is set smaller until it fits on one line, down to
     70% of its size; a title that cannot fit on one line even then goes onto two lines, sized so two are enough. Never
     cut. Each tile keeps its size whatever its words, so the tiles stay even. Skips anything not laid out yet. */
  function fit(root) {
    if (!root || !root.querySelectorAll) return 0;
    var n = 0, els = root.querySelectorAll(".wo-what b, .wo-time");
    for (var i = 0; i < els.length; i++) {
      var el = els[i], st = el.style;
      st.fontSize = ""; st.whiteSpace = ""; st.display = "";
      var w = el.clientWidth;
      if (!w || !root.ownerDocument || !root.ownerDocument.defaultView) continue;
      var fs = parseFloat(root.ownerDocument.defaultView.getComputedStyle(el).fontSize) || 0;
      if (!fs) continue;
      st.whiteSpace = "nowrap"; st.display = "block";
      var sw = el.scrollWidth;
      if (sw <= w + 1) { n++; continue; }
      var r = w / sw, title = el.tagName === "B";
      if (r >= 0.7 || !title) { st.fontSize = Math.max(fs * 0.5, Math.floor(fs * r * 0.97)) + "px"; n++; continue; }
      st.whiteSpace = ""; st.display = "";
      st.fontSize = Math.floor(fs * Math.max(0.55, Math.min(0.9, r * 1.8))) + "px"; n++;
    }
    return n;
  }

  root.VPWhatsOn = { MAX: MAX, clean: clean, clean1: clean1, isOn: isOn, current: current, on: on, upcoming: upcoming, next: next,
    sorted: sorted, dayLabel: dayLabel, whenText: whenText, time12: time12, today: today, todayIn: todayIn, addDays: addDays,
    dayKey: dayKey, tvSlides: tvSlides, tvHtml: tvHtml, esc: esc, whenParts: whenParts, fit: fit };
})(typeof window !== "undefined" ? window : this);
