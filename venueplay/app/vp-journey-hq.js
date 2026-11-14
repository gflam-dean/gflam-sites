/* ============================================================================
   HQ > JOURNEY (Dean, 15 Nov 2026; INBOX 413 and 412 UPDATE 8). Loaded by app/hq.html with one line; started by
   VPJourney.init({ post, canSee }) with hq.html's own workerPost, so this file has no login of its own.

   Three things, all from the Worker's own counts (POST /admin/journey-funnel, /admin/journey-campaigns, /admin/journey-venue):
     1. The weekly funnel, step by step: how many reached it, split by where they came from (website, cold email link, Coaster
        Trivia), what percent were lost, the median time to the next step, and beside every step the likely reason in plain
        English and a suggested fix. Under it the form detail (which box people stop at, mobile or email, searches that found
        nothing so missing venues get added) and where visitors come from (referrer family, state, device).
     2. Per campaign and email step: sent, clicked, visited, enquired, signed up, signed in, card. A mail scanner's click is not a
        click: it is counted apart.
     3. One venue's journey in order, on its row in HQ > Venues (VPJourney.venueBlock).
   The reasons are the Worker's (VPJ_FUNNEL), reviewed monthly in the sign-up audit (Recurring row 23). Owner and accounts only.
   No person is shown in the funnel: counts only. ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var H = { post: null, canSee: function () { return true; } };
  var S = { days: 7, loading: false };
  function jyEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  function n(x) { return Number(x || 0).toLocaleString("en-AU"); }
  function secs(s) { if (s == null) return "&nbsp;"; if (s < 90) return s + " s"; if (s < 5400) return Math.round(s / 60) + " min"; return Math.round(s / 3600) + " h"; }
  var REF = { google: "Google", facebook: "Facebook", instagram: "Instagram", coaster: "Coaster Trivia", email: "Webmail", direct: "Direct", other: "Other sites", unknown: "Unknown" };

  function shell() {
    var pane = $("paneJourney"); if (!pane || pane.getAttribute("data-built")) return;
    pane.setAttribute("data-built", "1");
    pane.innerHTML =
      '<div class="rowbetween"><div class="lblk" style="margin:0">Journey: where people drop off</div>'
      + '<select id="jyDays" class="sp" aria-label="Period"><option value="7" selected>Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>'
      + '<button class="mini" id="jyRefresh">Refresh</button></div>'
      + '<div class="panel pad" id="jyFunnel"><div class="note" style="margin:0">Counting&hellip;</div></div>'
      + '<div class="lblk">The sign-up form, box by box</div><div class="panel pad" id="jyForm"><div class="note" style="margin:0">&nbsp;</div></div>'
      + '<div class="lblk">Where visitors come from</div><div class="panel pad" id="jyWhere"><div class="note" style="margin:0">&nbsp;</div></div>'
      + '<div class="lblk">Emails: each campaign, each email</div><div class="panel" id="jyCamp" style="overflow-x:auto"><div class="note" style="margin:12px">Counting&hellip;</div></div>';
    $("jyDays").addEventListener("change", function () { S.days = +this.value; load(); });
    $("jyRefresh").addEventListener("click", load);
  }
  function funnelHtml(r) {
    var rows = (r.steps || []).map(function (s) {
      return '<tr><td><b>' + jyEsc(s.label) + '</b></td><td>' + n(s.reached) + '</td><td>' + n(s.website) + '</td><td>' + n(s.cold_email) + '</td><td>' + n(s.coaster) + '</td>'
        + '<td>' + (s.lost_pct == null ? "&nbsp;" : s.lost_pct + "%") + '</td><td>' + secs(s.median_secs_to_next) + '</td>'
        + '<td style="min-width:260px;white-space:normal;line-height:1.45">' + jyEsc(s.reason) + (s.fix ? '<br><span style="color:var(--muted)">Fix: ' + jyEsc(s.fix) + '</span>' : "") + '</td></tr>';
    }).join("");
    return '<div style="overflow-x:auto"><table><thead><tr><th>Step</th><th>Reached</th><th>Website</th><th>Cold email</th><th>Coaster</th><th>Lost</th><th>Median to next</th><th>Likely reason and a fix</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<p class="note">' + n(r.sessions) + ' visits in this period. ' + n(r.scanner_hits) + ' mail-scanner hits were left out (they are not people). "Lost" is against the step before. Median time is from reaching a step to reaching the next one.</p>';
  }
  function formHtml(f) {
    if (!f) return "";
    var ab = (f.abandoned_at || []).map(function (a) { return jyEsc(String(a.field).replace(/_/g, " ")) + " " + n(a.n) + (a.median_secs != null ? " (about " + a.median_secs + " s on it)" : ""); }).join(", ") || "none yet";
    var none = (f.searches_found_nothing || []).map(function (a) { return jyEsc(a.q) + (a.n > 1 ? " x" + a.n : ""); }).join(", ") || "none";
    var hl = f.highlight_matched + f.highlight_missed;
    return '<p style="margin:0 0 6px">Typed a first name <b>' + n(f.first_name_typed) + '</b> &middot; typed mobile or email <b>' + n(f.contact_typed) + '</b> (mobile ' + n(f.chose_mobile) + ', email ' + n(f.chose_email) + ') &middot; started a venue search <b>' + n(f.venue_search_started) + '</b></p>'
      + '<p style="margin:0 0 6px">Picked their venue from the list <b>' + n(f.venue_picked) + '</b> &middot; tapped "can\'t find it" <b>' + n(f.venue_not_found) + '</b> &middot; add-venue form shown ' + n(f.addvenue_shown) + ', name and suburb typed ' + n(f.addvenue_typed) + '</p>'
      + '<p style="margin:0 0 6px">Stopped at: ' + ab + '</p>'
      + '<p style="margin:0 0 6px">Searches that found nothing (add these venues to our list): ' + none + '</p>'
      + '<p class="note" style="margin:0">' + (hl ? 'Our lead data guessed their games right ' + n(f.highlight_matched) + ' of ' + n(hl) + ' times.' : 'No lead-code visitors have answered the games question yet.') + '</p>';
  }
  function whereHtml(w) {
    if (!w) return "";
    var one = function (o, map) { return Object.keys(o || {}).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return jyEsc((map && map[k]) || k) + " " + n(o[k]); }).join(", ") || "none yet"; };
    return '<p style="margin:0 0 6px">From: ' + one(w.ref, REF) + '</p><p style="margin:0 0 6px">State or country: ' + one(w.region) + '</p><p style="margin:0">Device: ' + one(w.device) + '</p>'
      + '<p class="note">Counted by visit, no one is named. Only the state or country is kept, never an address.</p>';
  }
  function campHtml(r) {
    var rows = (r.rows || []).map(function (c) {
      var lbl = Object.keys(c.links_clicked || {}).map(function (k) { return jyEsc(k) + " " + c.links_clicked[k]; }).join(", ");
      return '<tr><td><b>' + jyEsc(c.campaign) + '</b> &middot; email ' + n(c.email_step) + '</td><td>' + n(c.sent) + '</td><td>' + n(c.clicked) + '</td><td>' + n(c.visited) + '</td><td>' + n(c.enquired) + '</td><td>' + n(c.signed_up) + '</td><td>' + n(c.signed_in) + '</td><td>' + n(c.card) + '</td><td>' + n(c.scanner_only) + '</td><td style="white-space:normal">' + (lbl || "&nbsp;") + '</td></tr>';
    }).join("");
    if (!rows) return '<div class="note" style="margin:12px">No tracked links are loaded yet. They appear here once the codes for a campaign are loaded and the first email goes out.</div>';
    return '<table><thead><tr><th>Campaign and email</th><th>Sent</th><th>Clicked</th><th>Visited</th><th>Enquired</th><th>Signed up</th><th>Signed in</th><th>Card</th><th>Scanner only</th><th>Links clicked</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div class="note" style="margin:12px">Sent = leads with a link in that email. Clicked = a person opened it (a scanner does not count; "scanner only" is a lead whose only click was a scanner). Visited = clicked and then looked at or did something on the page.</div>';
  }
  function load() {
    if (!H.post || S.loading) return;
    S.loading = true;
    H.post("/admin/journey-funnel", { days: S.days }).then(function (r) {
      if (!r || r.error) { $("jyFunnel").innerHTML = '<div class="note" style="margin:0">' + jyEsc((r && r.error) || "Could not load the funnel.") + '</div>'; return; }
      $("jyFunnel").innerHTML = funnelHtml(r); $("jyForm").innerHTML = formHtml(r.form); $("jyWhere").innerHTML = whereHtml(r.where);
    }).then(function () { return H.post("/admin/journey-campaigns", {}); }).then(function (r) {
      $("jyCamp").innerHTML = (!r || r.error) ? '<div class="note" style="margin:12px">' + jyEsc((r && r.error) || "Could not load the campaigns.") + '</div>' : campHtml(r);
    }).then(function () { S.loading = false; }, function () { S.loading = false; });
  }
  /* One venue's journey, in order, inside its row in HQ > Venues. */
  function venueBlock(venueId) {
    var box = doc.querySelector('[data-vpjourney="' + venueId + '"]');
    if (!box || box.getAttribute("data-loaded") || !H.post || !H.canSee()) return;
    box.setAttribute("data-loaded", "1");
    box.innerHTML = '<div class="note" style="margin:10px 0 0">Journey&hellip;</div>';
    H.post("/admin/journey-venue", { venue_id: venueId }).then(function (r) {
      if (!r || r.error) { box.innerHTML = ""; return; }
      var j = r.journey || [];
      var when = function (t) { try { return new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
      box.innerHTML = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)"><b>Journey</b>'
        + (j.length ? '<ol style="margin:6px 0 0 18px;padding:0;line-height:1.55">' + j.map(function (x) { return '<li>' + jyEsc(when(x.at)) + ' &middot; ' + jyEsc(x.what) + (x.region ? ' <span style="color:var(--muted)">(' + jyEsc(x.region) + ')</span>' : "") + '</li>'; }).join("") + '</ol>'
          : '<div class="note" style="margin:6px 0 0">Nothing tracked for this venue yet (it did not come in through a tracked link or the quick game).</div>') + '</div>';
    });
  }
  root.VPJourney = {
    init: function (h) { H.post = h.post; if (h.canSee) H.canSee = h.canSee; return root.VPJourney; },
    open: function () { shell(); if (!S.loaded) { S.loaded = true; load(); } },
    venueBlock: venueBlock,
    funnelHtml: funnelHtml, formHtml: formHtml, campHtml: campHtml
  };
})(window);
