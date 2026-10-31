/* ============================================================================
   HQ > SUBSCRIBERS (31 Oct 2026; migration 134). Loaded by app/hq.html with one line.

   Who asked for the monthly VenuePlay email from the sales pages (home, the offer page, See a
   night), how many a week and from which page, and any venue or prospect each one looks like.
   This tab IS the quiet notice: a sign-up sends Dean nothing, it simply appears here.

   NOT A COLD LEAD. A subscriber opted in to one email a month. A match to a venue or a prospect is
   shown so HQ knows who they are; it is never a reason to ring, email, follow or add them to an
   Instantly campaign, and nothing on this tab does any of those.

   The billing Worker decides everything (POST /admin/subscribers, owner or accounts only): each
   row's state (on the list; re-subscribed, back after an unsubscribe, with both dates; unsubscribed; held by hand),
   its match, and the counts. Export CSV is POST /admin/subscribers/export, audited.

   It owns its pane (#paneSubscribers) and its tab's count (sign-ups in the last 7 days); hq.html's
   own pane switcher shows and hides the pane like any other ("subscribers" is in its PANES). When
   HQ gets its sub menus this tab moves under Sales by moving its one button.
   House rules: no em dashes; HQ only.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_SUBSCRIBERS_API || "https://api.venueplay.com.au";
  var S = { data: null, loading: false, filter: "all" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SOURCE = { home: "Home page", offer: "Offer page", "see-a-night": "See a night", site: "Other" };
  var STATE = { active: "On the list", resubscribed: "Re-subscribed", held: "Held", unsubscribed: "Unsubscribed" };

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function $(id) { return doc.getElementById(id); }
  /* "Sat 31 Oct, 4:35pm", Brisbane (UTC+10 all year). */
  function when(iso, withTime) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var d = new Date(t + 10 * 3600000), h = d.getUTCHours(), m = d.getUTCMinutes();
    var day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()];
    return withTime ? day + ", " + ((h % 12) || 12) + ":" + ("0" + m).slice(-2) + (h < 12 ? "am" : "pm") : day;
  }
  function weekLabel(w) { var t = Date.parse(w + "T00:00:00Z"); if (!isFinite(t)) return w; var d = new Date(t); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; }
  function sourceText(s) { return SOURCE[s] || s || "Other"; }

  function matchHtml(m) {
    if (!m) return '<span class="note" style="margin:0">No match</span>';
    var how = m.by === "email" ? "same email" : m.by === "domain" ? "same email domain" : "same venue name";
    return '<span class="badge ' + (m.kind === "prospect" ? "vpsb-pro" : "vpsb-ven") + '">' + (m.kind === "prospect" ? "Prospect" : "Venue") + "</span> "
      + "<b>" + esc(m.name) + "</b>" + (m.status && m.status !== "active" ? ' <span class="note" style="margin:0">(' + esc(m.status) + ")</span>" : "")
      + ' <span class="note" style="margin:0">by ' + how + "</span>";
  }
  function stateHtml(r) {
    return '<span class="badge vpsb-' + esc(r.state) + '" data-vps-state="' + esc(r.state) + '">' + esc(STATE[r.state] || r.state) + "</span>"
      + (r.state === "resubscribed" ? '<div class="note" data-vps-dates style="margin:4px 0 0">Unsubscribed ' + esc(when(r.unsubscribed_at, true)) + ', signed up again ' + esc(when(r.resubscribed_at, true)) + '. Back on for the monthly email only.</div>' : "")
      + (r.state === "unsubscribed" && r.unsubscribed_at ? '<div class="note" data-vps-dates style="margin:4px 0 0">Unsubscribed ' + esc(when(r.unsubscribed_at, true)) + (r.resubscribed_at ? ', after signing up again ' + esc(when(r.resubscribed_at, true)) : "") + '.</div>' : "")
      + (r.state === "held" ? '<div class="note" style="margin:4px 0 0">Held by hand: kept, and sent nothing.' + (r.held_reason ? " (" + esc(r.held_reason) + ")" : "") + '</div>' : "");
  }
  function utmText(u) {
    if (!u) return "";
    return [u.utm_source, u.utm_medium, u.utm_campaign].filter(Boolean).join(" / ");
  }
  function rowHtml(r) {
    return '<tr data-vps-row="' + esc(r.email) + '">'
      + '<td><b>' + esc(r.email) + "</b>" + (r.venue_name ? '<div class="note" style="margin:2px 0 0">' + esc(r.venue_name) + "</div>" : "") + "</td>"
      + "<td>" + esc(when(r.created_at, true)) + "</td>"
      + "<td>" + esc(sourceText(r.source)) + (utmText(r.utm) ? '<div class="note" style="margin:2px 0 0">' + esc(utmText(r.utm)) + "</div>" : "") + "</td>"
      + "<td>" + esc(r.region || r.country || "") + "</td>"
      + "<td>" + stateHtml(r) + "</td>"
      + '<td data-vps-match>' + matchHtml(r.match) + "</td></tr>";
  }
  function weeksHtml(d) {
    var srcs = (d.sources || ["home", "offer", "see-a-night", "site"]);
    var weeks = (d.by_week || []).slice(0, 8);
    return '<div class="panel"><div class="tscroll"><table class="vpsweeks"><thead><tr><th>Week of</th><th>Sign-ups</th>'
      + srcs.map(function (s) { return "<th>" + esc(sourceText(s)) + "</th>"; }).join("") + "</tr></thead><tbody>"
      + weeks.map(function (w) {
        return '<tr data-vps-week="' + esc(w.week) + '"><td>' + esc(weekLabel(w.week)) + "</td><td><b>" + (w.n || 0) + "</b></td>"
          + srcs.map(function (s) { return "<td>" + ((w.by_source && w.by_source[s]) || 0) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  function listHtml(d) {
    if (d.error) return '<div class="panel pad"><div class="empty" style="border:none;background:none" id="vpsErr">' + esc(d.error) + "</div></div>";
    var c = d.counts || {};
    var rows = (d.subscribers || []).filter(function (r) {
      return S.filter === "all" ? true : S.filter === "matched" ? !!r.match : S.filter === "active" ? (r.state === "active" || r.state === "resubscribed") : r.state === S.filter;
    });
    return '<div class="rowbetween" style="margin-bottom:12px"><div class="lblk" style="margin:0">Monthly email subscribers</div>'
      + '<span class="sp"></span><button class="btn ghost" id="vpsExport">Export CSV</button> <button class="btn ghost" id="vpsRefresh">Refresh</button></div>'
      + '<div class="note" style="margin:0 0 12px">People who asked for the one VenuePlay email a month from the website. They get the "What\'s new at VenuePlay" news with the monthly report, nothing else. '
      + "<b>Not cold leads:</b> never add them to Instantly, and a match is for knowing who they are, not a reason to contact them."
      + (d.emails_on ? "" : " The welcome email is <b>off</b> (SUBSCRIBE_EMAILS), so new sign-ups are kept and sent nothing yet.") + "</div>"
      + '<div class="stats" style="margin-bottom:14px">'
      + '<div class="scard"><div class="k">On the list</div><div class="v g" id="vpsActive">' + (c.active || 0) + '</div><div class="d">get the monthly email</div></div>'
      + '<div class="scard"><div class="k">Re-subscribed</div><div class="v" id="vpsResub">' + (c.resubscribed || 0) + '</div><div class="d">back after unsubscribing</div></div>'
      + '<div class="scard"><div class="k">Unsubscribed</div><div class="v" id="vpsUnsub">' + (c.unsubscribed || 0) + '</div><div class="d">since signing up</div></div>'
      + '<div class="scard"><div class="k">Matched</div><div class="v" id="vpsMatched">' + (c.matched || 0) + '</div><div class="d">look like a venue or prospect</div></div>'
      + "</div>"
      + weeksHtml(d)
      + '<div class="filterbar" style="margin:14px 0 10px"><select id="vpsFilter">'
      + [["all", "Everyone"], ["active", "On the list"], ["resubscribed", "Re-subscribed"], ["unsubscribed", "Unsubscribed"], ["held", "Held"], ["matched", "Matched to a venue or prospect"]]
        .map(function (o) { return '<option value="' + o[0] + '"' + (S.filter === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("")
      + '</select><span class="note" id="vpsMsg" style="margin:0"></span></div>'
      + (rows.length
        ? '<div class="panel"><div class="tscroll"><table class="vpstable"><thead><tr><th>Email and venue</th><th>Signed up</th><th>From</th><th>Where</th><th>Status</th><th>Looks like</th></tr></thead><tbody id="vpsRows">'
          + rows.map(rowHtml).join("") + "</tbody></table></div></div>"
        : '<div class="panel pad"><div class="empty" style="border:none;background:none">Nobody here yet.</div></div>');
  }

  /* ---- the Worker ---- */
  function token() {
    try { return root.VP.getClient().auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ""; }); }
    catch (e) { return Promise.resolve(""); }
  }
  function post(path, body) {
    return token().then(function (t) {
      var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t;
      return root.fetch(API + path, { method: "POST", headers: h, body: JSON.stringify(body || {}) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j._status = r.status;
        if (r.status === 404 && !j.error) j.error = "Subscribers is not on the Worker yet (deploy venueplay-api-FULL.js, after migration 134).";
        if (!r.ok && !j.error) j.error = "That did not go through (" + r.status + "). Try again.";
        return j;
      });
    }).catch(function () { return { error: "Could not reach the server. Try again in a minute." }; });
  }

  function setCount(d) {
    var b = $("vpsTab"); if (!b) return;
    var week = Date.now() - 7 * 86400000;
    var n = ((d && d.subscribers) || []).filter(function (r) { return Date.parse(r.created_at) >= week && (r.state === "active" || r.state === "resubscribed"); }).length;
    var sp = b.querySelector(".tabcount");
    if (!sp) { sp = doc.createElement("span"); sp.className = "hdbadge tabcount"; b.appendChild(sp); }
    sp.textContent = n > 99 ? "99+" : String(n);
    sp.hidden = !n;
    sp.setAttribute("aria-label", n + " new this week");
  }
  function addPane() {
    if ($("paneSubscribers")) return;
    var host = $("paneVenues") ? $("paneVenues").parentNode : doc.body;
    var p = doc.createElement("div"); p.id = "paneSubscribers"; p.className = "hidden";
    p.innerHTML = "<style>"
      + ".badge.vpsb-active{background:rgba(53,208,127,.12);color:var(--win);border:1px solid rgba(53,208,127,.4)}"
      + ".badge.vpsb-held{background:rgba(245,165,36,.14);color:var(--roll);border:1px solid rgba(245,165,36,.4)}"
      + ".badge.vpsb-resubscribed{background:rgba(53,208,127,.12);color:var(--win);border:1px dashed rgba(53,208,127,.55)}"
      + ".badge.vpsb-unsubscribed{background:rgba(154,154,164,.10);color:var(--faint);border:1px solid rgba(154,154,164,.3)}"
      + ".badge.vpsb-pro{background:rgba(255,31,142,.12);color:var(--pink);border:1px solid rgba(255,31,142,.45)}"
      + ".badge.vpsb-ven{background:rgba(255,255,255,.06);color:var(--text);border:1px solid rgba(255,255,255,.18)}"
      + ".vpstable td,.vpsweeks td{vertical-align:top;overflow-wrap:anywhere}"
      + "#paneSubscribers .stats{grid-template-columns:repeat(4,minmax(0,1fr))}"
      + "@media (max-width:640px){#paneSubscribers .stats{grid-template-columns:repeat(2,minmax(0,1fr))}}"
      + "</style><div id=\"vpsBody\"><div class=\"note\">Loading subscribers...</div></div>";
    host.insertBefore(p, $("paneLive") || null);
    p.addEventListener("click", onClick);
    p.addEventListener("change", function (e) { if (e.target && e.target.id === "vpsFilter") { S.filter = e.target.value; draw(); } });
  }
  function draw() { var body = $("vpsBody"); if (body && S.data) body.innerHTML = listHtml(S.data); }
  function load() {
    if (S.loading) return S.loading;
    S.loading = post("/admin/subscribers", {}).then(function (d) {
      S.loading = false;
      var tab = $("vpsTab");
      if (d._status === 401 || d._status === 403) { if (tab) tab.hidden = true; return d; }   // not for this HQ role
      if (tab) tab.hidden = false;
      S.data = d; setCount(d); draw();
      return d;
    });
    return S.loading;
  }
  function exportCsv(btn) {
    var msg = $("vpsMsg");
    btn.disabled = true; btn.textContent = "Getting it...";
    return post("/admin/subscribers/export", {}).then(function (r) {
      btn.disabled = false; btn.textContent = "Export CSV";
      if (r.error) { if (msg) msg.textContent = r.error; return r; }
      try {
        var blob = new root.Blob([r.csv], { type: "text/csv;charset=utf-8" });
        var a = doc.createElement("a"); a.href = root.URL.createObjectURL(blob);
        a.download = "venueplay-subscribers-" + new Date().toISOString().slice(0, 10) + ".csv";
        doc.body.appendChild(a); a.click();
        root.setTimeout(function () { root.URL.revokeObjectURL(a.href); a.remove(); }, 0);
      } catch (e) {}
      if (msg) msg.textContent = r.count + (r.count === 1 ? " subscriber" : " subscribers") + " exported.";
      S.lastCsv = r.csv;
      return r;
    });
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest("button"); if (!t) return;
    if (t.id === "vpsRefresh") { load(); return; }
    if (t.id === "vpsExport") { exportCsv(t); }
  }
  function start() {
    if (!$("hqNav")) return;
    addPane();
    $("hqNav").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b && b.getAttribute("data-pane") === "subscribers") load();
    });
    var tries = 0;
    (function wait() {
      try { if (root.VP && root.VP.getClient) { token().then(function (t) { if (t) load(); else if (tries++ < 40) root.setTimeout(wait, 500); }); return; } } catch (e) {}
      if (tries++ < 40) root.setTimeout(wait, 500);
    })();
  }

  root.VPSubscribers = { load: load, _t: { S: S, listHtml: listHtml, matchHtml: matchHtml } };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else if (doc) start();
})(typeof window !== "undefined" ? window : this);
