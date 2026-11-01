/* ============================================================================
   HQ > REPORTS (Dean, 31 Oct 2026). Loaded by app/hq.html with one line; started by
   VPReports.init({ post, isOwner, showTest }) with hq.html's own workerPost, so this file has no
   login of its own.

   "we should definitely work on some sort of reports for us and also for the venue". One month,
   every venue: the totals for sales, who is trending down (worth a call), a row per venue, and the
   "What's new at VenuePlay" words that go into every venue's one email a month.

   The numbers are the billing Worker's (POST /admin/month-report, vprMonth): the same function
   that writes each venue's email and its own report page, so HQ and a venue cannot disagree.
   HQ shows the STORED copy (migration 136), made at 2am on the 1st, so opening this tab during a
   game night reads one row, never 13 months of every venue (Dean, 31 Oct 2026). "Refresh this month"
   (owner or accounts) works it out again on that tap and keeps it.
   Test venues (a test name or slug, or marked test in HQ) are left out of every total and shown
   in the table only when the header's "Show test venues" is ticked. Counts only, no player.
   The news: POST /admin/month-news (get, save, preview); saving is owner or accounts only, and
   until migration 133 is run the Worker says so and nothing is kept.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var H = { post: null, isOwner: function () { return false; }, showTest: function () { return false; } };
  var S = { month: null, data: null, loading: false, news: null };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WORDS = { bingo90: "bingo", musical_bingo: "musical bingo", trivia: "trivia", raffle: "raffle", members_draw: "members draw" };
  function rpEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  function n(x) { return Number(x || 0).toLocaleString("en-AU"); }
  function monthWords(m) { return m ? MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4) : ""; }
  function nightWords(d) { return d ? (+d.slice(8, 10)) + " " + MONTHS[+d.slice(5, 7) - 1] : ""; }
  function lastMonths() {
    var out = [], d = new Date(Date.now() + 8 * 3600 * 1000);       // Brisbane, on the 2am clock
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    for (var i = 0; i < 13; i++) { out.push(y + "-" + ("0" + m).slice(-2)); m--; if (!m) { m = 12; y--; } }
    return out;
  }
  function delta(c) {
    if (!c || (!c.now && !c.was)) return "&nbsp;";
    if (!c.was) return "new this month";
    if (c.was < 10 || Math.abs(c.now - c.was) > c.was * 3) return (c.now >= c.was ? "&#9650; " : "&#9660; ") + "from " + n(c.was) + " last month";
    var pct = Math.round((c.now - c.was) / c.was * 100);
    return (pct >= 0 ? "&#9650; " : "&#9660; ") + Math.abs(pct) + "% on last month";
  }

  function shell() {
    var pane = $("paneReports"); if (!pane || pane.getAttribute("data-built")) return;
    pane.setAttribute("data-built", "1");
    var months = lastMonths();
    pane.innerHTML =
      '<div class="rowbetween"><div class="lblk" style="margin:0">Monthly report, every venue</div>'
      + '<select id="rpMonth" class="sp" aria-label="Month">' + months.map(function (m, i) { return '<option value="' + m + '"' + (i === 1 ? " selected" : "") + '>' + rpEsc(monthWords(m)) + (i === 0 ? " (so far)" : "") + '</option>'; }).join("") + '</select>'
      + '<button class="mini" id="rpRefresh">Refresh</button></div>'
      + '<div id="rpBody"><div class="note">Adding it up&hellip;</div></div>'
      + '<div class="lblk">What\'s new at VenuePlay, in every venue\'s email</div>'
      + '<div class="panel pad" id="rpNews"><div class="note" style="margin:0">Loading&hellip;</div></div>';
    $("rpMonth").addEventListener("change", function () { S.month = this.value; load(); loadNews(); });
    $("rpRefresh").addEventListener("click", function () { load(); });
    S.month = $("rpMonth").value;
  }

  function madeLine(d) {
    var when = "";
    try { when = new Date(d.made_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) {}
    return '<div class="rowbetween" style="margin:0 0 12px"><div class="note" style="margin:0">'
      + (d.stored ? "Stored copy, made " + rpEsc(when) + (d.made_by ? " by " + rpEsc(d.made_by) : "") + "." : (d.totals ? "Worked out just now, " + rpEsc(when) + "." : ""))
      + (d.note ? ' <span style="color:var(--gold)">' + rpEsc(d.note) + '</span>' : "") + '</div>'
      + (d.can_refresh ? '<button class="mini sp" id="rpRemake" title="Reads every venue: best outside game nights">Refresh this month</button>' : "") + '</div>';
  }
  function bindRemake() { var b = $("rpRemake"); if (b) b.addEventListener("click", function () { load(true); }); }
  function render() {
    var d = S.data, box = $("rpBody"); if (!d || !box) return;
    if (!d.totals) {
      box.innerHTML = madeLine(d) + '<div class="panel pad"><p class="note" style="margin:0">Nothing stored for ' + rpEsc(monthWords(d.month)) + ' yet.'
        + (d.can_refresh ? ' Refresh this month works it out now (it reads every venue, so it is best outside a game night).' : ' An owner or accounts login can make it with Refresh this month.') + '</p></div>';
      bindRemake(); return;
    }
    var t = d.totals, c = d.compare;
    var tiles = [
      ["Venues with a night", n(t.venues_with_nights), "ran at least one game"],
      ["Nights", n(t.nights), delta(c.nights)],
      ["Players", n(t.player_visits), delta(c.player_visits)],
      ["Different phones", n(t.unique_phones), delta(c.unique_phones)],
      ["Came back", n(t.returning), t.returning_pct + "% of phones, 2+ nights"],
      ["Opt-ins", n(t.optins), delta(c.optins)],
      ["Slides shown", t.ads_counted ? n(t.ad_shows) : "&ndash;", t.ads_counted ? n(t.ad_venues) + " venues, about " + n(Math.round((t.ad_minutes || 0) / 60)) + " hours" : "not counted yet"]
    ];
    var fk = Object.keys(t.formats || {}).sort(function (a, b) { return t.formats[b].nights - t.formats[a].nights; });
    var sales = [];
    if (t.player_visits) sales.push("<b>" + n(t.player_visits) + " players</b> across <b>" + n(t.venues_with_nights) + " venues</b> in " + rpEsc(monthWords(d.month)) + ", " + n(t.nights) + " nights, about " + n(t.avg_per_night) + " a night.");
    if (t.unique_phones) sales.push("<b>" + n(t.unique_phones) + " different phones</b>; " + t.returning_pct + "% came back for a second night or more inside the month.");
    if (t.biggest_night) sales.push("Biggest night: <b>" + rpEsc(t.biggest_night.venue_name) + "</b>, " + n(t.biggest_night.players) + " players on " + rpEsc(nightWords(t.biggest_night.night)) + ".");
    if (fk.length) sales.push("Most run: " + fk.map(function (f) { return rpEsc(WORDS[f] || f) + " " + n(t.formats[f].nights) + " nights"; }).join(", ") + ".");
    if (t.optins) sales.push("<b>" + n(t.optins) + "</b> players opted in to hear from their venue.");
    var show = H.showTest();
    var rows = (d.venues || []).filter(function (v) { return show || !v.test; });
    var trend = function (v) {
      var col = v.trend.level === "stopped" ? "var(--roll)" : v.trend.level === "down" ? "var(--gold)" : v.trend.level === "up" ? "var(--win)" : "var(--muted)";
      return '<span style="color:' + col + ';font-weight:700">' + rpEsc(v.trend.level === "steady" ? "steady" : v.trend.level) + '</span>' + (v.trend.words ? '<div class="vt">' + rpEsc(v.trend.words) + '</div>' : "");
    };
    box.innerHTML = madeLine(d) +
      '<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' + tiles.map(function (x) { return '<div class="scard"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="d">' + x[2] + '</div></div>'; }).join("") + '</div>'
      + '<div class="lblk">For sales</div><div class="panel pad">' + (sales.length ? sales.map(function (s) { return '<p style="margin:0 0 8px">' + s + '</p>'; }).join("") : '<p class="note" style="margin:0">Nothing ran in this month.</p>') + '</div>'
      + '<div class="lblk">Worth a call: trending down</div><div class="panel pad">'
      + ((d.churn || []).length ? d.churn.map(function (x) { return '<p style="margin:0 0 8px"><b>' + rpEsc(x.name) + '</b> <span style="color:' + (x.level === "stopped" ? "var(--roll)" : "var(--gold)") + '">' + rpEsc(x.words) + '</span></p>'; }).join("") : '<p class="note" style="margin:0">Nobody is trending down against last month.</p>')
      + '</div>'
      + '<div class="lblk">Every venue' + (show ? ", test venues included" : "") + '</div>'
      + '<div class="panel"><div class="tscroll"><table><thead><tr><th>Venue</th><th>Nights</th><th>Players</th><th>A night</th><th>Phones</th><th>Came back</th><th>New</th><th>Opt-ins</th><th>Slides</th><th>Trend</th><th>Top team</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (v) {
          return '<tr><td><div class="vn">' + rpEsc(v.name) + (v.test ? ' <span class="vt">(test)</span>' : '') + '</div><div class="vt">' + rpEsc(Object.keys(v.formats || {}).map(function (f) { return WORDS[f] || f; }).join(", ")) + '</div></td>'
            + '<td class="mono">' + n(v.nights) + '<div class="vt">was ' + n(v.last.nights) + '</div></td><td class="mono">' + n(v.player_visits) + '<div class="vt">was ' + n(v.last.player_visits) + '</div></td>'
            + '<td class="mono">' + n(v.avg_per_night) + '</td><td class="mono">' + n(v.unique_phones) + '</td><td class="mono">' + n(v.returning) + '</td><td class="mono">' + n(v.new_phones) + '</td><td class="mono">' + n(v.optins) + '</td><td class="mono">' + (v.ads ? n(v.ads.shows) : "&ndash;") + '</td>'
            + '<td>' + trend(v) + '</td><td>' + rpEsc(v.top_team || "") + '</td></tr>';
        }).join("") : '<tr><td colspan="11" class="note">No venue ran a game in this month.</td></tr>')
      + '</tbody></table></div></div>'
      + '<div class="note">A night runs 2am to 2am where the venue is. Players are counted by phone, so one phone on two nights is one person who came back; printed cards count as players, not phones. Test players and test venues are left out of every total. '
      + rpEsc(d.ads_note || "") + '</div>';
    bindRemake();
  }

  function load(remake) {
    if (!H.post || !S.month) return;
    var box = $("rpBody"); if (box) box.innerHTML = '<div class="note">' + (remake ? "Working the month out across every venue&hellip;" : "Opening the stored report&hellip;") + '</div>';
    S.loading = true;
    var want = S.month;
    return H.post("/admin/month-report", remake ? { month: want, refresh: true } : { month: want }).then(function (r) {
      S.loading = false;
      if (want !== S.month) return;
      if (!r || r.error) { if (box) box.innerHTML = '<div class="note">' + rpEsc((r && r.error) || "Could not load the report.") + '</div>'; return; }
      S.data = r; render();
    });
  }

  /* ---- the news ---- */
  function newsForm(n0) {
    var items = (n0 && n0.items) || [];
    var slot = function (i) {
      var it = items[i] || {};
      return '<div style="margin:0 0 14px"><div class="note" style="margin:0 0 4px">Item ' + (i + 1) + (i ? " (optional)" : "") + '</div>'
        + '<input type="text" data-rpn="title" data-i="' + i + '" maxlength="80" placeholder="Heading, e.g. Custom bingo patterns are here" value="' + rpEsc(it.title || "") + '" style="width:100%;margin:0 0 6px">'
        + '<textarea data-rpn="text" data-i="' + i + '" maxlength="400" rows="2" placeholder="One or two short sentences" style="width:100%;margin:0 0 6px">' + rpEsc(it.text || "") + '</textarea>'
        + '<input type="text" data-rpn="link" data-i="' + i + '" maxlength="200" placeholder="Link (optional), venueplay.com.au only" value="' + rpEsc(it.link || "") + '" style="width:100%"></div>';
    };
    var can = H.isOwner();
    $("rpNews").innerHTML =
      '<p class="note" style="margin:0 0 12px">Goes under each venue\'s own numbers in the one email they get on the 1st, for <b>' + rpEsc(monthWords(S.month)) + '</b>. New features, a tip, dates coming up. Short is read; four items at most. No long dashes, never Gflam, links only to venueplay.com.au.</p>'
      + (n0 && n0.missing ? '<p class="note" style="color:var(--gold);margin:0 0 12px">' + rpEsc(n0.note) + '</p>' : '')
      + [0, 1, 2, 3].map(slot).join("")
      + '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:0 0 12px"><input type="checkbox" id="rpReady"' + (n0 && n0.ready ? " checked" : "") + (can ? "" : " disabled") + '> Ready to go out with the ' + rpEsc(monthWords(S.month)) + ' reports</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pink" id="rpSave"' + (can ? "" : " disabled") + '>Save</button><button class="btn ghost" id="rpPreview">Preview the email</button></div>'
      + '<div class="note" id="rpNewsMsg">' + (n0 && n0.updated_at ? "Last saved by " + rpEsc(n0.updated_by || "HQ") + "." : "") + (can ? "" : " Only an owner or accounts login can change this.") + '</div>'
      + '<iframe id="rpFrame" sandbox="" title="Email preview" style="display:none;width:100%;max-width:640px;height:900px;border:1px solid var(--line);border-radius:12px;background:#f4f4f7;margin-top:12px"></iframe>';
    $("rpSave").addEventListener("click", function () { saveNews(); });
    $("rpPreview").addEventListener("click", function () { previewNews(); });
  }
  function typed() {
    var items = [0, 1, 2, 3].map(function () { return {}; });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-rpn]"), function (el) { items[+el.getAttribute("data-i")][el.getAttribute("data-rpn")] = el.value; });
    return items.filter(function (it) { return (it.title || "").trim() || (it.text || "").trim() || (it.link || "").trim(); });
  }
  function loadNews() {
    if (!H.post || !$("rpNews")) return;
    var want = S.month;
    return H.post("/admin/month-news", { action: "get", month: want }).then(function (r) {
      if (want !== S.month) return;
      if (!r || r.error) { $("rpNews").innerHTML = '<div class="note" style="margin:0">' + rpEsc((r && r.error) || "Could not load the news.") + '</div>'; return; }
      S.news = r; newsForm(r);
    });
  }
  function saveNews() {
    var msg = $("rpNewsMsg"); msg.textContent = "Saving…";
    return H.post("/admin/month-news", { action: "save", month: S.month, items: typed(), ready: $("rpReady").checked }).then(function (r) {
      msg.textContent = (!r || r.error) ? ("Not saved. " + ((r && r.error) || "")) : ("Saved" + (r.ready ? ", ready to go out." : ", not marked ready yet."));
    });
  }
  function previewNews() {
    var msg = $("rpNewsMsg"); msg.textContent = "Building the preview…";
    return H.post("/admin/month-news", { action: "preview", month: S.month, items: typed() }).then(function (r) {
      if (!r || r.error) { msg.textContent = (r && r.error) || "Could not build the preview."; return; }
      msg.textContent = "Preview: " + r.subject + " (" + r.venue_name + "'s real month, with the words above).";
      var f = $("rpFrame"); f.style.display = "block"; f.srcdoc = r.html;
    });
  }

  var api = {
    init: function (h) { H.post = h.post; if (h.isOwner) H.isOwner = h.isOwner; if (h.showTest) H.showTest = h.showTest; return api; },
    open: function () { shell(); if (!S.data && !S.loading) { load(); loadNews(); } },
    repaint: function () { render(); }
  };
  root.VPReports = api;
})(window);
