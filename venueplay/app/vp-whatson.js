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
  /* A TYPED START TIME, ANY WAY A PERSON WRITES IT (Dean, 13 Nov 2026: "2:00 PM" typed on a weekly event saved with no
     time, because the box was a clock picker that holds nothing until every part is filled). "2pm", "2:30 PM",
     "2.30pm", "7 p.m.", "19:30", "07:30", "1930" -> "HH:MM". "" is no time. null is something that is not a start
     time, or one that could be morning or evening ("2:00", "7"): the form says so, in words, and saves nothing. */
  function parseTime(s) {
    s = String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
    if (!s) return "";
    var m = /^(\d{1,2})(?:\s*[:.h]?\s*([0-5]\d))?\s*([ap])\.?\s*m?\.?$/i.exec(s);
    if (m) {
      var h = +m[1]; if (h < 1 || h > 12) return null;
      return pad(h % 12 + (/^p/i.test(m[3]) ? 12 : 0)) + ":" + (m[2] || "00");
    }
    m = /^(\d{1,2})\s*[:.h]?\s*([0-5]\d)$/.exec(s);
    if (m && (s.length >= 4 || /[:.h]/.test(s))) {
      var hh = +m[1];
      if (hh > 23) return null;
      if (m[1].length === 2 && (m[1].charAt(0) === "0" || hh >= 12)) return pad(hh) + ":" + m[2];   // 07:30, 12:00, 19:30
      return null;   // "2:00" could be 2am or 2pm: ask
    }
    return null;
  }
  function timeProblem(s) {
    var t = parseTime(s);
    if (t !== null) return "";
    return /^\s*\d{1,2}\s*(?:[:.h]\s*[0-5]\d)?\s*$/.test(String(s)) ? "Add am or pm to the start time, like 7:30pm." : "I could not read that start time. Try 7:30pm.";
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
  /* A TICKED GAME OF OUR OWN (13 Nov 2026, "no double typing"). The venue's own venueplay nights are added to What's on by
     a tick, never retyped: the tick is stored here as an entry with a link instead of words, and the TV reads the day,
     time and jackpot from the venue's real schedule each time it draws, so they are always right.
       { id, link:"night",  day:"tue", game:"trivia" }   a night from Nights (trivia, musical bingo, bingo, raffles, members)
       { id, link:"draw",   ref:"Members draw" }         a members draw from Draws, by its name
       { id, link:"raffle", ref:"Meat raffle" }          a raffle from Draws, by its label
     A link has no title or date of its own, and is never a night of the venue's own: only the TV's night card uses it. */
  var LINKS = ["night", "draw", "raffle"], GAMES = ["trivia", "musical", "bingo", "raffles", "members"];
  function cleanLink(e) {
    if (LINKS.indexOf(e.link) === -1) return null;
    var o = { link: e.link };
    if (e.id != null && /^[A-Za-z0-9_-]{1,40}$/.test(String(e.id))) o.id = String(e.id);
    if (e.link === "night") {
      if (DAYS.indexOf(e.day) === -1 || GAMES.indexOf(e.game) === -1) return null;
      o.day = e.day; o.game = e.game;
    } else {
      var r = str(e.ref, 60); if (!r) return null;
      o.ref = r;
    }
    return o;
  }
  function clean1(e) {
    if (!e || typeof e !== "object") return null;
    if (e.link) return cleanLink(e);
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
    if (e.link) return false;
    if (e.date) return e.date === s;
    if (!e.day || dayKey(s) !== e.day) return false;
    return !(e.until && s > e.until);
  }
  /* Still to come (or on today)? A one-off after its date and a weekly one after its until date are over. */
  function current(e, t) {
    if (!e || e.link) return false;
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
  /* "Tonight", "Tomorrow", "Fri 13 Nov": a ONE-OFF date is always short day, date, short month, matching the screen
     (Dean, 10 Nov 2026: never "Friday 13" without the month). The third argument is kept for old callers and ignored. */
  function dayLabel(s, t) {
    if (s === t) return "Tonight";
    if (s === addDays(t, 1)) return "Tomorrow";
    var d = parse(s); if (!d) return "";
    var k = DAYS[d.getDay()];
    return SHORT[k] + " " + d.getDate() + " " + MON[d.getMonth()];
  }
  /* A REGULAR weekly night says its day in the plural, never one single date (Dean, 10 Nov 2026): "Fridays". */
  var PLURAL = { sun: "Sundays", mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays" };
  function weeklyLabel(k) { return PLURAL[k] || ""; }
  /* The day label of one tvSlides row: "Fridays" for a weekly night (and for our own game nights, which are weekly),
     else dayLabel's one date. */
  function rowLabel(date, ev, t) { var k = ev && (ev.game ? dayKey(date) : ev.day); return k && PLURAL[k] ? PLURAL[k] : dayLabel(date, t); }
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

  /* THE TV'S SLIDES (tv.html's ads loop). The next seven days, ONE CARD FOR EACH NIGHT (13 Nov 2026, "what if someone does
     it in three on my night?"): every entry on the same weekday (a weekly one) or the same date (a one-off) is one
     card, its things listed in time order whether the venue typed them as one entry or three:
       Tuesdays: 6:30pm Meat raffle / 7pm Members draw / Roast Night $10 (no time goes last).
     The venue's own venueplay nights join the same card when ticked (link entries, see cleanLink): they are read from
     its real schedule here, never typed. Slides:
       { type:"list", size, rows:[{ date, label, tonight, items:[...], ev }] }   up to 5 nights a slide, balanced
       { type:"feature", size, feature:{ date, label, ev }, rows:[...] }       a night with a picture, whole, and the week
     Nothing on at all: no "What's on" slide (no empty card on the wall). A night with more than 4 things continues on a
     card of its own so no thing is ever left out or squeezed under a size people cannot read. */
  var GAME_NIGHT = { trivia: "Trivia night", musical: "Musical bingo", bingo: "Bingo", raffles: "Raffle", members: "Members draw" };
  function normDay(s) { var k = String(s || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 3); return DAYS.indexOf(k) !== -1 ? k : ""; }
  function money(c) { var n = Math.round((+c || 0) / 100); return n > 0 ? "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : ""; }
  /* The venue's game week ([{ day:"wed", games:[{ game, start, count?, name? }] }], as /join/info and /screen hand it over)
     on one date: what a ticked night stands for. */
  function nightItems(week, k, game) {
    var out = [];
    if (!Array.isArray(week)) return out;
    week.forEach(function (d) {
      if (!d || d.day !== k || !Array.isArray(d.games)) return;
      d.games.forEach(function (g) {
        if (!g || g.game !== game) return;
        /* A "Something else" night (game "other", its own name, e.g. Karaoke) is the venue's, not ours: it is not a game of
           ours to tick. Several sessions of one game (count 2 to 4) say so: "Bingo ×2". */
        var nm = GAME_NIGHT[g.game]; if (!nm) return;
        var n = (+g.count >= 2 && +g.count <= 4) ? +g.count : 0;
        out.push({ title: nm + (n ? " ×" + n : ""), start: TIME_RE.test(String(g.start || "")) ? g.start : "", line: "Play on your phone", game: g.game, linked: true });
      });
    });
    return out;
  }
  /* What one tick stands for on weekday k, from the real schedule: ctx = { week, draws:[{name,draw_day,draw_time,current_jackpot_cents}], raffles:[{label,day,time}] }. */
  function linkedItems(link, k, ctx) {
    ctx = ctx || {};
    if (link.link === "night") return link.day === k ? nightItems(ctx.week, k, link.game) : [];
    var out = [], i, x, ref = String(link.ref || "").toLowerCase();
    if (link.link === "draw") {
      var ds = Array.isArray(ctx.draws) ? ctx.draws : [];
      for (i = 0; i < ds.length; i++) {
        x = ds[i]; if (!x || normDay(x.draw_day) !== k || String(x.name || "Members draw").toLowerCase() !== ref) continue;
        var tm = parseTime(x.draw_time), jp = money(x.current_jackpot_cents);
        out.push({ title: str(x.name, 60) || "Members draw", start: tm || "", line: jp ? "Jackpot " + jp : "", game: "members", linked: true });
      }
    } else if (link.link === "raffle") {
      var rs = Array.isArray(ctx.raffles) ? ctx.raffles : [];
      for (i = 0; i < rs.length; i++) {
        x = rs[i]; if (!x || normDay(x.day) !== k || str(x.label, 60).toLowerCase() !== ref) continue;
        out.push({ title: str(x.label, 60), start: parseTime(x.time) || "", line: "Tickets at the bar", game: "raffles", linked: true });
      }
    }
    return out;
  }
  var PER_CARD = 4;   // things on one night's card; more continue on a card of their own, so no word is squeezed under a readable size
  function itemOf(e) { return { id: e.id || "", title: e.title, start: e.start || "", line: e.line || "", image_url: e.image_url || "", weekly: !!e.day }; }
  /* The next 7 days as night cards: [{ date, label, tonight, items:[{title,start,line,...}], ev:items[0] }]. */
  function nightRows(events, t, week, ctx, max) {
    var list = clean(events), links = [], own = [], rows = [], i, j;
    ctx = ctx || {}; if (ctx.week === undefined) ctx = { week: week, draws: ctx.draws, raffles: ctx.raffles };
    list.forEach(function (e) { (e.link ? links : own).push(e); });
    for (i = 0; i < 7 && rows.length < (max || 12); i++) {
      var s = addDays(t, i), k = dayKey(s), items = [];
      own.forEach(function (e) { if (isOn(e, s)) items.push(itemOf(e)); });
      links.forEach(function (l) { linkedItems(l, k, ctx).forEach(function (x) { items.push(x); }); });
      if (!items.length) continue;
      items.sort(byStart);
      /* a night that is only weekly things (and our games) says "Tuesdays"; one with a one-off in it says its date */
      var label = items.every(function (x) { return x.weekly || x.linked; }) ? PLURAL[k] : dayLabel(s, t);
      for (j = 0; j < items.length && rows.length < (max || 12); j += PER_CARD) {
        var ch = items.slice(j, j + PER_CARD);
        rows.push({ date: s, label: j > 0 ? label + " (" + (j / PER_CARD + 1) + ")" : label, tonight: s === t, items: ch, ev: ch[0], more: j > 0 });
      }
    }
    return rows;
  }
  function tvSlides(events, t, week, ctx) {
    var up = nightRows(events, t, week, ctx), i, MAXROWS = 12;
    var out = [];
    if (!up.length) return out;
    function row(x) { return { date: x.date, label: x.label, tonight: x.tonight, items: x.items, ev: x.ev, more: x.more }; }
    var feats = [];
    up.forEach(function (x) { if (feats.length >= 3) return; var im = x.items.filter(function (it) { return it.image_url && !it.game; })[0]; if (im) feats.push({ date: x.date, label: x.label, tonight: x.tonight, ev: im }); });
    if (feats.length) {
      var pages = Math.ceil(up.length / 6), views = Math.max(pages, feats.length);
      for (i = 0; i < views; i++) {
        var p = i % pages;
        var rs = up.slice(p * 6, p * 6 + 6);
        out.push({ type: "feature", size: rs.length <= 2 ? "xl" : rs.length <= 3 ? "l" : "m", feature: feats[i % feats.length], rows: rs.map(row) });   // fewer rows, bigger words
      }
      return out;
    }
    var pg = Math.ceil(up.length / 5), per = Math.ceil(up.length / pg), size = per <= 2 ? "xl" : per === 3 ? "l" : "m";
    for (i = 0; i < up.length; i += per) out.push({ type: "list", size: size, rows: up.slice(i, i + per).map(row) });
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
  /* How long a title is, as a class (a hook for tests and styles; the TV fits the words by measuring, see fit()). */
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
        var tn = r.tonight || r.label === "Tonight", items = r.items || [r.ev];
        if (items.length > 1) {
          /* ONE CARD FOR THE NIGHT: its day, then each thing in time order, the times down one column. */
          h += '<div class="wo-row multi' + (tn ? " tonight" : "") + '">' +
            '<span class="wo-when2"><span class="wo-day">' + esc(r.label) + '</span></span><span class="wo-its">';
          items.forEach(function (it) {
            var wp = whenParts(it);
            h += '<span class="wo-it' + (it.game ? " game" : "") + '"><span class="wo-itt">' + esc(wp.time) + '</span>' +
              '<span class="wo-itw"><b>' + esc(it.title) + '</b>' + (wp.line ? '<i>' + esc(wp.line) + '</i>' : '') + '</span></span>';
          });
          h += '</span></div>';
          return;
        }
        var ev = items[0], wp1 = whenParts(ev);
        /* Day over time, then the title and its line; the list draws these as tiles across the wall (9 Nov 2026),
           the feature view as rows beside the picture. The time says the hours once ("2pm to 6pm"). */
        h += '<div class="wo-row ' + lenClass(ev.title) + (tn ? " tonight" : "") + (ev.game ? " game" : "") + '">' +
          '<span class="wo-when2"><span class="wo-day">' + esc(r.label) + '</span><span class="wo-time">' + esc(wp1.time) + '</span></span>' +
          '<span class="wo-what"><b>' + esc(ev.title) + '</b>' + (wp1.line ? '<i>' + esc(wp1.line) + '</i>' : '') + '</span></div>';
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
        '<div class="wb-cap"><div class="wb-when' + ((f.tonight || f.label === "Tonight") ? " tn" : "") + '">' + esc(f.label) + (tm ? " · " + esc(tm) : "") + '</div>' +
        '<div class="wb-title">' + esc(f.ev.title) + '</div></div></div>' +   // its name too, for a poster with no words on it (round 5)
        '<div class="wb-side">' + head + '<div class="wo-list">' + rowsHtml(sl.rows) + '</div></div></div>';
    }
    return "";
  }

  /* FIT ON THE WALL (13 Nov 2026, Dean: a 39 to 48 letter line ended "Raffles and..." on the TV). NOTHING IS EVER CUT.
     Called by tv.html once a slide is in the page (and again when the fonts arrive or the screen changes size), and by
     the editor's preview, which draws the very same card. Every word on a wall is set smaller by the same step until
     the whole wall fits (a title takes as many lines as it needs), down to a minimum size for each kind of word (the
     floors below, as a share of the wall's width, so they hold at 1920x1080 and 1280x720). A wall that still does not
     fit at the floors is marked data-wo-over="1" and fit() counts it: the editor says so in words before it can ever
     reach a TV ("This is too long for the TV, try under N characters"). Sizes are written as plain pixels on the words,
     so an older TV that cannot do container units reads them too. Skips a wall not laid out yet. */
  var FLOORS = [[".wo-what b", 1.8], [".wo-what i", 1.3], [".wo-time", 2], [".wo-day", 1.2], [".wo-itw b", 1.5], [".wo-itw i", 1.15], [".wo-itt", 1.5], [".wb-title", 1.7], [".wb-when", 1.5]];
  var WORDS = ".wo-what b, .wo-what i, .wo-time, .wo-day, .wo-itw b, .wo-itw i, .wo-itt, .wb-title, .wb-when";
  function spill(wall) {
    var i, els, r;
    els = wall.querySelectorAll(WORDS);
    for (i = 0; i < els.length; i++) if (els[i].scrollWidth > els[i].clientWidth + 1) return true;   // a word wider than its space
    els = wall.querySelectorAll(WORDS);
    for (i = 0; i < els.length; i++) {   // a word that runs out of the bottom or side of its card
      var row = els[i].closest ? els[i].closest(".wo-row") : null;
      if (!row) continue;
      var rb = row.getBoundingClientRect(), wb = els[i].getBoundingClientRect();
      if (wb.bottom > rb.bottom + 1.5 || wb.right > rb.right + 1.5) return true;
    }
    var cap = wall.querySelector(".wb-cap");
    if (cap && cap.offsetHeight > wall.clientWidth * 0.105) return true;                              // the poster's words climbing the picture
    var list = wall.querySelector(".wo-list");
    if (!list) return false;
    if (wall.className.indexOf("wo-tiles") !== -1) {
      var inn = wall.querySelector(".wo-in"), top = wall.querySelector(".wo-top");
      return list.offsetHeight + (top ? top.offsetHeight : 0) + wall.clientWidth * 0.018 > inn.clientHeight + 1;   // the tiles as tall as the room under the header
    }
    var side = wall.querySelector(".wb-side");
    return list.scrollHeight > list.clientHeight + 1 || (side ? side.scrollHeight > side.clientHeight + 1 : false);
  }
  function fitWall(wall) {
    var els = wall.querySelectorAll(WORDS), i, k, base = [], lo = 0.3;
    if (!wall.clientWidth || !wall.clientHeight || !els.length) return 0;
    var view = (wall.ownerDocument || document).defaultView;
    for (i = 0; i < els.length; i++) els[i].style.fontSize = "";
    wall.removeAttribute("data-wo-over"); wall.removeAttribute("data-wo-s");
    for (i = 0; i < els.length; i++) base.push(parseFloat(view.getComputedStyle(els[i]).fontSize) || 0);
    for (k = 0; k < FLOORS.length; k++) {
      var of = wall.querySelectorAll(FLOORS[k][0]);
      for (i = 0; i < of.length; i++) { var at = Array.prototype.indexOf.call(els, of[i]); if (at !== -1 && base[at] > 0) lo = Math.max(lo, (FLOORS[k][1] * wall.clientWidth / 100) / base[at]); }
    }
    if (lo > 1) lo = 1;
    function set(sc) { for (var j = 0; j < els.length; j++) if (base[j]) els[j].style.fontSize = (Math.floor(base[j] * sc * 100) / 100) + "px"; }
    var sc = 1;
    set(1);
    while (spill(wall) && sc > lo + 0.001) { sc = Math.max(lo, sc - 0.025); set(sc); }
    wall.setAttribute("data-wo-s", String(Math.round(sc * 1000) / 1000));
    if (spill(wall)) { wall.setAttribute("data-wo-over", "1"); return 1; }
    return 0;
  }
  /* fit(root): every What's on wall in root (or root itself). Returns how many walls cannot fit even at the floors. */
  function fit(root) {
    if (!root || !root.querySelectorAll) return 0;
    var walls = root.querySelectorAll(".wo-wall"), over = 0, i;
    if (!walls.length && root.className && String(root.className).indexOf("wo-wall") !== -1) walls = [root];
    for (i = 0; i < walls.length; i++) over += fitWall(walls[i]);
    return over;
  }

  /* THE EDITOR'S PREVIEW (13 Nov 2026): the TV's own card for the event as typed so far, drawn by the same tvSlides and
     tvHtml and fitted by the same fit(), at the TV's real size inside `stage` (the caller scales the stage to the page).
       previewCard(stage, draft, { events, editingId, today, venue, logo, schedule:{week,draws,raffles}, size:1728|1152 })
         -> { over:boolean, example:boolean, slide }
     The venue's other events and ticked games are in it, so a night with several things shows as the ONE card it will
     be. `over` means it still would not fit at the smallest sizes. size is the TV's safe box width: 1728 is a 1920x1080
     TV, 1152 a 1280x720 one. */
  function previewEvents(d, o) {
    var t = o.today || today(), list = clean(o.events || []).filter(function (e) { return !(o.editingId && e.id === o.editingId); });
    var ex = false, dr = { id: "__draft", title: (d.title && String(d.title).trim()) || "Your title here" };
    if (d.start) dr.start = d.start;
    if (d.line) dr.line = d.line;
    if (d.image_url) dr.image_url = d.image_url;
    if (d.day) { dr.day = d.day; }
    else {
      var dt = parse(d.date) ? d.date : t;
      if (dt < t) dt = t;
      if (dt > addDays(t, 6)) { for (var i = 0; i < 7; i++) if (dayKey(addDays(t, i)) === dayKey(dt)) { dt = addDays(t, i); break; } ex = true; }
      dr.date = dt;
    }
    var c = clean1(dr);
    if (c) { c.id = "__draft"; list.push(c); }
    return { list: list, example: ex, t: t };
  }
  function pickSlide(slides) {
    var feat = null, any = null, i, j, k;
    for (i = 0; i < slides.length; i++) {
      var rows = slides[i].rows || [], has = false;
      for (j = 0; j < rows.length; j++) for (k = 0; k < rows[j].items.length; k++) if (rows[j].items[k].id === "__draft") has = true;
      if (slides[i].type === "feature" && slides[i].feature.ev.id === "__draft") feat = feat || slides[i];
      if (has) any = any || slides[i];
    }
    return feat || any || slides[0] || null;
  }
  function previewCard(stage, d, o) {
    o = o || {};
    var pe = previewEvents(d, o), sc = o.schedule || {};
    var slides = tvSlides(pe.list, pe.t, sc.week, { week: sc.week, draws: sc.draws, raffles: sc.raffles }), slide = pickSlide(slides);
    var size = o.size === 1152 ? 1152 : 1728;
    stage.style.width = size + "px"; stage.style.height = Math.round(size * 9 / 16) + "px";
    stage.innerHTML = '<div class="ad-wo">' + tvHtml(slide, o.venue || "", o.logo || "", "") + '</div>';
    var over = fit(stage) > 0;
    return { over: over, example: pe.example, slide: slide };
  }
  function offStage(stage) {
    var off = stage._off;
    if (!off) {
      off = stage.ownerDocument.createElement("div"); off.className = "vpwo-stage";
      off.style.position = "absolute"; off.style.left = "-30000px"; off.style.top = "0"; off.style.visibility = "hidden";
      (stage.parentNode || stage.ownerDocument.body).appendChild(off); stage._off = off;
    }
    return off;
  }
  /* Would this event (and the venue's others) not fit at a size? Drawn off to the side, so the preview itself is untouched. */
  function overAt(stage, d, o) { var p = {}, k; for (k in o) p[k] = o[k]; return previewCard(offStage(stage), d, p).over; }
  /* What to tell someone whose event does not fit: the kind of words, and how many characters do. Searched by drawing
     the card again with the words cut shorter, at every size in o.sizes. */
  function safeLength(stage, d, o) {
    var sizes = o.sizes || [1728, 1152], off = offStage(stage);
    function bad(x) { for (var i = 0; i < sizes.length; i++) { var p = {}, k; for (k in o) p[k] = o[k]; p.size = sizes[i]; if (previewCard(off, x, p).over) return true; } return false; }
    function copy(x, t, l) { var c = {}, k; for (k in x) c[k] = x[k]; c.title = t; c.line = l; return c; }
    function longest(field) {
      var full = String(d[field] || ""), lo = 0, hi = full.length;   // hi never fits; lo (0) does
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (bad(field === "line" ? copy(d, d.title, full.slice(0, mid)) : copy(d, full.slice(0, mid), d.line))) hi = mid; else lo = mid; }
      return lo;
    }
    var title = String(d.title || ""), line = String(d.line || "");
    if (line && !bad(copy(d, title, ""))) { var n1 = longest("line"); n1 = n1 - 2;   // a little under the edge, so the number holds on every screen
      if (n1 < 6) return { field: "night", n: n1, text: "There is too much on this night to fit the TV. Shorten the title and the line, or take one thing off." }; return { field: "line", n: n1, text: "This line is too long for the TV, try under " + (n1 + 1) + " characters." }; }
    if (title && !bad(copy(d, "", line))) { var n2 = longest("title"); n2 = n2 - 2;
      if (n2 < 6) return { field: "night", n: n2, text: "There is too much on this night to fit the TV. Shorten the title and the line, or take one thing off." }; return { field: "title", n: n2, text: "This title is too long for the TV, try under " + (n2 + 1) + " characters." }; }
    if (title && !bad(copy(d, "", ""))) { var n3 = (function () { var lo = 0, hi = title.length; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (bad(copy(d, title.slice(0, m), ""))) hi = m; else lo = m; } return lo; })(); return { field: "both", n: n3, text: "This is too long for the TV. Shorten the title (try under " + (n3 + 1) + " characters) and the line." }; }
    return { field: "night", n: 0, text: "There is too much on this night to fit the TV. Shorten the words, or take one thing off." };
  }

  root.VPWhatsOn = { MAX: MAX, previewCard: previewCard, overAt: overAt, safeLength: safeLength, FLOORS: FLOORS, parseTime: parseTime, timeProblem: timeProblem, nightRows: nightRows, linkedItems: linkedItems, normDay: normDay, GAME_NIGHT: GAME_NIGHT, clean: clean, clean1: clean1, isOn: isOn, current: current, on: on, upcoming: upcoming, next: next,
    sorted: sorted, dayLabel: dayLabel, weeklyLabel: weeklyLabel, rowLabel: rowLabel, whenText: whenText, time12: time12, today: today, todayIn: todayIn, addDays: addDays,
    dayKey: dayKey, tvSlides: tvSlides, tvHtml: tvHtml, esc: esc, whenParts: whenParts, fit: fit };
})(typeof window !== "undefined" ? window : this);
