/* ============================================================================
   HQ > PROSPECTS (Dean, 29 Oct 2026). Loaded by app/hq.html with one line.

   "Can we please put the prospects into HQ as a tab somewhere? ... if they haven't signed up they're
   not gonna sign up on the active list are they? And maybe we should have something that is like a
   follow-up on those ones like if they haven't accessed it within like ... three days it flags the
   venue ... so then we can actually give the person a call ... if it does have a phone number."

   A prospect is a venue set up by HQ's Set up a prospect or by the prospect autopilot (migration 125,
   vp_prospects) that has not signed up yet. The billing Worker decides both halves on every read
   (POST /admin/prospects, owner or accounts only): who is still a prospect (no card, not comp, not
   invoiced, not grouped, not archived) and who to ring:
     "Call requested"  they asked for a call in their reply: sales rings them, shown first
     "Call them"       nobody at the venue has signed in 3 days after setup (the Worker's
                       VPA_PROSPECT_FOLLOWUP_DAYS, the one place that number lives)
   "Called", with a note, stops the flag (POST /admin/prospect/called; Undo takes it back).
   A prospect who adds their card drops off this list and hq.html shows them with the active venues:
   hq.html leaves out of its Venues list and headline count every venue isProspect() names here, and
   draws them again when this file fires "vp-prospects".

   It owns its pane (#paneProspects) and its tab's count; hq.html's own pane switcher shows and hides
   the pane like any other ("prospects" is in its PANES). Kept apart from the help desk on purpose.
   House rules: no em dashes; a venue never sees this (HQ only, and the Worker answers HQ admins only).
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_PROSPECTS_API || "https://venueplay-api.dean-tindale.workers.dev";
  var S = { data: null, ids: {}, open: null, loading: false };

  function prEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* "Mon 26 Oct, 4:35pm", Brisbane (UTC+10 all year), worked out by hand so it reads the same everywhere. */
  function when(iso, withTime) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var d = new Date(t + 10 * 3600000), h = d.getUTCHours(), m = d.getUTCMinutes();
    var day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()];
    return withTime ? day + ", " + ((h % 12) || 12) + ":" + ("0" + m).slice(-2) + (h < 12 ? "am" : "pm") : day;
  }
  function ago(days) { return days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"; }

  /* ---- what one prospect row says, from what the Worker sent ---- */
  function flagHtml(p) {
    if (p.flag === "call_requested") return '<span class="badge prreq prflag">Call requested</span>';
    if (p.flag === "no_sign_in") return '<span class="badge roll prflag">Call them</span>';
    return "";
  }
  function phoneHtml(p) {
    if (p.phone && p.tel) return '<a class="prtel" href="' + prEsc(p.tel) + '">' + prEsc(p.phone) + "</a>";
    return '<span class="prnophone">No phone, email them</span>';
  }
  function welcomeText(w) {
    if (!w) return "Not recorded";
    if (w.status === "scheduled") return "Goes at " + when(w.send_at, true);
    if (w.status === "cancelled") return "Cancelled";
    if (w.status === "failed") return "Did not send";
    return "Sent " + when(w.send_at, true);
  }
  function signInText(p) {
    if (p.last_sign_in_at) return when(p.last_sign_in_at, true);
    return p.sign_in_known === false ? "Could not check just now" : "Never";
  }
  function sourceText(p) { return p.source === "autopilot" ? "Instantly autopilot" : "HQ"; }
  function siteHost(u) { return String(u || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, ""); }
  function cardHtml(p) {
    var why = p.flag === "call_requested" ? "They asked us to call them." + (p.phone ? "" : " No number on file: reply to their email for one.")
      : p.flag === "no_sign_in" ? "Nobody has signed in since they were set up " + ago(p.days_since_setup) + "." : "";
    var called = p.called
      ? '<div class="prcalled">Called ' + prEsc(when(p.called.at, true)) + (p.called.by ? " by " + prEsc(p.called.by) : "") +
        (p.called.note ? ': <span class="prnote">' + prEsc(p.called.note) + "</span>" : "") +
        ' <button type="button" class="mini" data-pr-undo="' + prEsc(p.venue_id) + '">Undo</button></div>'
      : "";
    var form = S.open === p.venue_id
      ? '<div class="prform"><label class="note" for="prNote">What was said (optional)</label>' +
        '<textarea id="prNote" maxlength="500" rows="2" placeholder="e.g. Spoke to Sam, trying it Friday"></textarea>' +
        '<div class="practs"><button type="button" class="btn pink sp" data-pr-save="' + prEsc(p.venue_id) + '">Save as called</button>' +
        '<button type="button" class="mini" data-pr-close="1">Cancel</button></div></div>'
      : '<div class="practs">' + (!p.called ? '<button type="button" class="mini' + (p.flag ? " win" : "") + '" data-pr-called="' + prEsc(p.venue_id) + '">Called</button>' : "") +
        '<button type="button" class="mini" data-pr-signin="' + prEsc(p.venue_id) + '">Resend sign-in link</button></div>';
    return '<div class="panel pad prcard' + (p.flag ? " flagged" : "") + (p.flag === "call_requested" ? " req" : "") + '" data-pr-id="' + prEsc(p.venue_id) + '">' +
      '<div class="prtop"><div class="prname">' + prEsc(p.name || "A venue") + "</div>" + flagHtml(p) + "</div>" +
      (why ? '<div class="prwhy">' + prEsc(why) + "</div>" : "") +
      '<div class="prgrid">' +
        '<div><span class="k">Contact</span>' + prEsc(p.contact_name || "No name given") + "</div>" +
        '<div><span class="k">Phone</span>' + phoneHtml(p) + "</div>" +
        '<div><span class="k">Email</span>' + (p.email ? '<a href="mailto:' + prEsc(p.email) + '">' + prEsc(p.email) + "</a>" : "None") + "</div>" +
        '<div><span class="k">Website</span>' + (/^https?:\/\//i.test(String(p.website || "")) ? '<a href="' + prEsc(p.website) + '" target="_blank" rel="noopener">' + prEsc(siteHost(p.website)) + "</a>" : "None") + "</div>" +
        '<div><span class="k">Set up</span>' + prEsc(when(p.created_at)) + " (" + prEsc(ago(p.days_since_setup)) + "), by " + prEsc(sourceText(p)) + "</div>" +
        '<div><span class="k">Welcome email</span>' + prEsc(welcomeText(p.welcome)) + "</div>" +
        '<div><span class="k">Last sign-in</span>' + prEsc(signInText(p)) + "</div>" +
        '<div><span class="k">Where</span>' + prEsc([p.postcode, p.state].filter(Boolean).join(" ") || "Not known") + "</div>" +
      "</div>" + called + form + "</div>";
  }
  function headHtml(d) {
    var n = (d.prospects || []).length, f = d.follow_up_count || 0;
    return '<div class="rowbetween"><div class="lblk" style="margin:0">Prospects <span class="mono">' + n + "</span>" +
      (f ? ' <span class="prsum">' + f + " to call</span>" : "") + "</div>" +
      '<button class="btn ghost sp" type="button" id="prRefresh">Refresh</button></div>' +
      '<div class="note" style="margin:0 0 14px">Venues we set up that have not signed up yet. When one adds their card it moves to Venues by itself. ' +
      "Anyone who asked for a call is flagged Call requested, and anyone who has not signed in " + prEsc(d.follow_up_days) +
      " days after setup is flagged Call them. Mark Called once you have rung them." +
      (d.signed_up ? " " + prEsc(d.signed_up) + " earlier prospect" + (d.signed_up === 1 ? " has" : "s have") + " signed up." : "") + "</div>";
  }
  function listHtml(d) {
    if (d.error) return '<div class="panel pad"><div class="empty" style="border:none;background:none">' + prEsc(d.error) + "</div></div>";
    var list = d.prospects || [];
    if (!list.length) return headHtml(d) + '<div class="panel pad"><div class="empty" style="border:none;background:none">No prospects waiting. Set one up from Venues.</div></div>';
    return headHtml(d) + '<div class="prlist">' + list.map(cardHtml).join("") + "</div>";
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
        if (r.status === 404 && !j.error) j.error = "Prospects is not on the Worker yet (deploy venueplay-api-FULL.js, after migration 125).";
        if (!r.ok && !j.error) j.error = "That did not go through (" + r.status + "). Try again.";
        return j;
      });
    }).catch(function () { return { error: "Could not reach the server. Try again in a minute." }; });
  }

  /* ---- the tab, the pane, the count ---- */
  function setCount(n) {
    var b = $("prTab"); if (!b) return;
    var sp = b.querySelector(".tabcount");
    if (!sp) { sp = doc.createElement("span"); sp.className = "hdbadge tabcount"; b.appendChild(sp); }
    sp.textContent = n > 99 ? "99+" : String(n || 0);
    sp.hidden = !n;
    sp.setAttribute("aria-label", (n || 0) + " to call");
  }
  function addPane() {
    if ($("paneProspects")) return;
    var host = $("paneVenues") ? $("paneVenues").parentNode : doc.body;
    var p = doc.createElement("div"); p.id = "paneProspects"; p.className = "hidden";
    p.innerHTML = "<style>" +
      ".prlist{display:grid;gap:12px}" +
      ".prcard{border-left:3px solid transparent}.prcard.flagged{border-left-color:var(--roll)}" +
      ".prtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.prname{font-weight:800;font-size:16px;color:#fff;flex:1;min-width:0;overflow-wrap:anywhere}" +
      ".prwhy{color:var(--roll);font-size:13px;margin-top:4px}" +
      ".prgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 18px;margin-top:12px;font-size:13.5px}" +
      ".prgrid > div{min-width:0;overflow-wrap:anywhere}.prgrid .k{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:2px}" +
      ".prgrid a{color:var(--text)}.prtel{font-weight:800;color:var(--pink)!important;text-decoration:none;font-size:15px}" +
      ".prnophone{color:var(--roll)}.prcalled{margin-top:12px;font-size:13px;color:var(--win)}.prnote{color:var(--text)}" +
      ".practs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.prform{margin-top:12px}.prform textarea{width:100%;margin-top:4px}" +
      ".prsum{color:var(--roll);letter-spacing:0;text-transform:none;font-weight:700;margin-left:6px}" +
      ".badge.roll{background:rgba(245,165,36,.14);color:var(--roll);border:1px solid rgba(245,165,36,.4)}" +
      ".badge.prreq{background:rgba(229,72,77,.16);color:#FF8A8E;border:1px solid rgba(229,72,77,.55)}.prcard.req{border-left-color:#E5484D}" +
      "</style><div id=\"prBody\"><div class=\"note\">Loading prospects...</div></div>";
    host.insertBefore(p, $("paneLive") || null);
    p.addEventListener("click", onClick);
  }
  function draw() {
    var body = $("prBody"); if (!body || !S.data) return;
    var keep = $("prNote") ? $("prNote").value : "";
    body.innerHTML = listHtml(S.data);
    if ($("prNote")) { $("prNote").value = keep; }
    var r = $("prRefresh"); if (r) r.addEventListener("click", function () { load(); });
  }
  function load() {
    if (S.loading) return S.loading;
    S.loading = post("/admin/prospects", {}).then(function (d) {
      S.loading = false;
      var tab = $("prTab");
      if (d._status === 401 || d._status === 403) { if (tab) tab.hidden = true; return d; }   // not for this HQ role
      if (tab) tab.hidden = false;
      S.data = d;
      S.ids = {};
      (d.prospects || []).forEach(function (p) { S.ids[p.venue_id] = true; });
      setCount(d.error ? 0 : (d.follow_up_count || 0));
      draw();
      try { doc.dispatchEvent(new root.CustomEvent("vp-prospects")); } catch (e) {}
      return d;
    });
    return S.loading;
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-pr-called")) { S.open = t.getAttribute("data-pr-called"); draw(); if ($("prNote")) $("prNote").focus(); return; }
    if (t.hasAttribute("data-pr-close")) { S.open = null; draw(); return; }
    // The same function as the Venues row's button (hq.html hqSigninLink), so both say the same thing.
    if (t.hasAttribute("data-pr-signin")) { if (typeof root.hqSigninLink === "function") root.hqSigninLink(t.getAttribute("data-pr-signin"), t); return; }
    var id = t.getAttribute("data-pr-save") || t.getAttribute("data-pr-undo");
    if (!id) return;
    var undo = t.hasAttribute("data-pr-undo");
    var note = undo ? "" : (($("prNote") || {}).value || "").trim();
    t.disabled = true; t.textContent = undo ? "Undoing..." : "Saving...";
    post("/admin/prospect/called", undo ? { venue_id: id, undo: true } : { venue_id: id, note: note }).then(function (j) {
      if (j.error) { t.disabled = false; t.textContent = undo ? "Undo" : "Save as called"; if (root.vpTell) root.vpTell(j.error); else t.title = j.error; return; }
      S.open = null; S.loading = false; load();
    });
  }
  function start() {
    if (!$("hqNav")) return;
    addPane();
    $("hqNav").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b && b.getAttribute("data-pane") === "prospects") load();
    });
    // Once HQ has signed in: the count belongs on the tab before anybody opens it.
    var tries = 0;
    (function wait() {
      try { if (root.VP && root.VP.getClient) { token().then(function (t) { if (t) load(); else if (tries++ < 40) root.setTimeout(wait, 500); }); return; } } catch (e) {}
      if (tries++ < 40) root.setTimeout(wait, 500);
    })();
  }

  root.VPProspects = { load: load, isProspect: function (id) { return !!S.ids[id]; },
    _t: { cardHtml: cardHtml, listHtml: listHtml, when: when, S: S } };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else if (doc) start();
})(typeof window !== "undefined" ? window : this);
