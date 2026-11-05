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
   WHERE EACH ONE IS (29 Oct 2026, migration 127): a status chip on every card, from the Worker's own
   answer (vpaProspectStatus), never worked out here: Not signed in yet / Free month (X days left) /
   Card added / Paused / Cancelled, with the first sign-in and the free month's end. The last three days
   of a free month are highlighted. Card added venues come back in their own list (card_added): they are
   customers now, so isProspect() never names them and hq.html keeps them in Venues. Filter and sort by
   status here; the default order is the Worker's (who to ring first).
   VIEW AS (1 Nov 2026): every card with a venue row has View as, which calls hq.html's own viewAs (window.hqViewAs),
   the one the Venues row uses, so a prospect with no card opens as themselves exactly as a customer does.
   House rules: no em dashes; a venue never sees this (HQ only, and the Worker answers HQ admins only).
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_PROSPECTS_API || "https://api.venueplay.com.au";
  /* expanded: the rows opened by their status chip (Dean, 4 Nov 2026: compact rows); editing: the row whose Edit details
     form is open; byId: every row the tab shows, for hq.html's one send button (it words the email and text from it). */
  var S = { data: null, ids: {}, byId: {}, open: null, editing: null, expanded: {}, loading: false, filter: "all", sort: "call" };

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
    /* The yellow "Call them" only when there is a number to ring (Dean, 3 Nov 2026). The Worker only sends the
       flag with a phone now; this holds the same line if an older Worker still sends it without one. */
    if (p.flag === "no_sign_in" && p.tel) return '<span class="badge roll prflag">Call them</span>';
    return "";
  }
  /* ---- where the prospect is: the Worker says which (p.status), this only words it ---- */
  var STATUS = {
    not_signed_in: { label: "Not signed in yet", cls: "prst-none", rank: 0 },
    free_month: { label: "Free month", cls: "prst-free", rank: 1 },
    paused: { label: "Paused", cls: "prst-paused", rank: 2 },
    card_added: { label: "Card added", cls: "prst-card", rank: 3 },
    cancelled: { label: "Cancelled", cls: "prst-cancel", rank: 4 }
  };
  var FILTERS = ["all", "not_signed_in", "free_month", "last_days", "card_added", "paused", "cancelled"];
  function statusOf(p) { return STATUS[p && p.status] ? p.status : "not_signed_in"; }
  function daysLeftText(n) {
    if (n == null) return "";
    if (n <= 0) return "ended";
    return n === 1 ? "last day" : n + " days left";
  }
  /* THE CHIP (Dean, 4 Nov 2026): "Not signed in · 5 days", "Free month · 12 days left". Short enough for a phone row. */
  var CHIP = { not_signed_in: "Not signed in", free_month: "Free month", paused: "Paused", card_added: "Card added", cancelled: "Cancelled" };
  function statusLabel(p) {
    var st = statusOf(p), t = CHIP[st];
    if (st === "not_signed_in") { var n = p.days_since_setup; if (n != null && isFinite(n)) t += " \u00b7 " + (n <= 0 ? "today" : n === 1 ? "1 day" : n + " days"); }
    if (st === "free_month" && p.days_left != null) t += " \u00b7 " + daysLeftText(p.days_left);
    return t;
  }
  /* The chip is the row's button: it opens the details and actions, and closes them again. */
  function statusHtml(p) {
    var st = statusOf(p), open = !!S.expanded[p.venue_id];
    return '<button type="button" class="badge prst ' + STATUS[st].cls + (p.last_days && st === "free_month" ? " prst-last" : "") +
      '" data-pr-status="' + prEsc(st) + '" data-pr-toggle="' + prEsc(p.venue_id) + '" aria-expanded="' + (open ? "true" : "false") +
      '" title="' + (open ? "Hide" : "Show") + ' details and actions">' + prEsc(statusLabel(p)) + "</button>";
  }
  function firstSignInText(p) {
    if (p.first_signin_at) return when(p.first_signin_at, true);
    if (statusOf(p) === "not_signed_in") return "Not yet";
    return p.last_sign_in_at ? "Not recorded (last " + when(p.last_sign_in_at) + ")" : "Not recorded";
  }
  function freeMonthText(p) {
    var st = statusOf(p);
    if (p.free_month_ends_at) {
      var d = when(p.free_month_ends_at);
      if (st === "paused") return "Ended " + d + ", paused " + when(p.paused_at);
      if (st === "free_month" && p.days_left != null && p.days_left > 0) return d + " (" + daysLeftText(p.days_left) + ")";
      return (Date.parse(p.free_month_ends_at) < Date.now() ? "Ended " : "") + d;
    }
    if (st === "not_signed_in") return "Starts at their first sign-in";
    if (st === "cancelled") return "Cancelled " + when(p.cancelled_at);
    return "Not recorded yet";
  }
  function phoneHtml(p) {
    if (p.phone && p.tel) return '<a class="prtel" href="' + prEsc(p.tel) + '">' + prEsc(p.phone) + "</a>";
    if (p.mobile && p.tel) return '<a class="prtel" href="' + prEsc(p.tel) + '">' + prEsc(p.mobile) + "</a>";
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
  /* Edit details (Dean, 4 Nov 2026): name, email, mobile and phone, checked again by the Worker (POST /admin/prospect/update). */
  function editHtml(p) {
    var f = function (id, label, val, type, hint) {
      return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" value="' + prEsc(val || "") + '" autocomplete="off"' +
        (type === "tel" ? ' inputmode="tel" class="mono"' : "") + ">" + (hint ? '<div class="note">' + hint + "</div>" : "") + "</div>";
    };
    return '<div class="predit" data-pr-editform="' + prEsc(p.venue_id) + '">' +
      f("prEdName", "Contact name", p.contact_name, "text", "") +
      f("prEdEmail", "Email", p.email, "email", "Their login. Changing it moves their sign-in to the new address, and any link sent to the old one stops working.") +
      f("prEdMobile", "Mobile", p.mobile, "tel", "An Australian mobile, 04... It goes on the call list and gets the text follow-ups.") +
      f("prEdPhone", "Phone to call", p.phone, "tel", "A mobile, or a landline with its area code (02, 03, 07, 08).") +
      '<div class="prerr" id="prEdErr" role="alert" hidden></div>' +
      '<div class="practs"><button type="button" class="btn pink sp" data-pr-edit-save="' + prEsc(p.venue_id) + '">Save details</button>' +
      '<button type="button" class="mini" data-pr-edit-close="1">Cancel</button></div></div>';
  }
  function cardHtml(p) {
    /* Card added is a customer, and Cancelled said no: neither gets a Called button unless they asked for a call. */
    var st = statusOf(p), done = st === "card_added" || (st === "cancelled" && p.flag !== "call_requested");
    var why = p.flag === "call_requested" ? "They asked us to call them." + (p.tel ? "" : " No number on file: reply to their email for one.")
      : (p.flag === "no_sign_in" && p.tel) ? "Nobody has signed in since they were set up " + ago(p.days_since_setup) + "." : "";
    /* No phone: never yellow. Say what happens instead (the autopilot drafts a follow-up email for Dean's yes). */
    var quietNoPhone = !p.tel && (p.email_follow_up || (p.flag === "no_sign_in"));
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
      : S.editing === p.venue_id ? editHtml(p)
      : (function () {
          /* ONE SEND BUTTON (Dean, 4 Nov 2026): "Resend their account email" and "Resend sign-in link" looked the same.
             "Send them a new sign-in link" (hq.html hqSigninLink) emails it and, with a mobile, texts it too; a fresh
             30 days. Not after Cancel (they said no). View as is hq.html's own viewAs (window.hqViewAs). */
          var acts = (p.tel ? '<a class="mini prcall" href="' + prEsc(p.tel) + '">Call ' + prEsc(p.phone || p.mobile || "") + "</a>" : "") +
            (st !== "cancelled" ? '<button type="button" class="mini prsend" data-pr-signin="' + prEsc(p.venue_id) + '">Send them a new sign-in link' +
              '<span class="prvia">' + (p.mobile ? "by email and text" : "email only, add a mobile to text it too") + "</span></button>" : "") +
            '<button type="button" class="mini" data-pr-edit="' + prEsc(p.venue_id) + '">Edit details</button>' +
            (!p.called && !done ? '<button type="button" class="mini' + (p.flag ? " win" : "") + '" data-pr-called="' + prEsc(p.venue_id) + '">Called</button>' : "") +
            (p.venue_id ? '<button type="button" class="mini" data-pr-viewas="' + prEsc(p.venue_id) + '">View as</button>' : "");
          return acts ? '<div class="practs">' + acts + "</div>" : "";
        })();
    var last = st === "free_month" && p.last_days;
    var yellow = p.flag === "call_requested" || (p.flag === "no_sign_in" && p.tel);
    var open = !!S.expanded[p.venue_id];
    var sub = [p.contact_name, p.mobile || p.phone].filter(Boolean).join(" \u00b7 ");
    return '<div class="panel pad prcard' + (yellow ? " flagged" : "") + (p.flag === "call_requested" ? " req" : "") + (last ? " last3" : "") + (open ? " open" : "") +
      '" data-pr-id="' + prEsc(p.venue_id) + '" data-pr-st="' + prEsc(st) + '">' +
      '<div class="prtop"><div class="prname">' + prEsc(p.name || "A venue") + (sub ? '<span class="prsub">' + prEsc(sub) + "</span>" : "") + "</div>" + statusHtml(p) + flagHtml(p) + "</div>" +
      '<div class="prmore"' + (open ? "" : " hidden") + ">" +
      (why ? '<div class="prwhy">' + prEsc(why) + "</div>" : "") +
      (quietNoPhone ? '<div class="prquiet" data-pr-quiet="1">' + prEsc("Nobody has signed in since they were set up " + ago(p.days_since_setup) +
        ". No phone on file, so a follow-up email is drafted for Dean to approve.") + "</div>" : "") +
      (last ? '<div class="prlast" data-pr-last="1">' + prEsc(p.days_left === 1 ? "Last day of their free month, and no card yet." :
        p.days_left + " days left in their free month, and no card yet.") + "</div>" : "") +
      '<div class="prgrid">' +
        '<div><span class="k">Contact</span>' + prEsc(p.contact_name || "No name given") + "</div>" +
        '<div><span class="k">Phone</span>' + phoneHtml(p) + "</div>" +
        '<div><span class="k">Mobile</span>' + (p.mobile ? prEsc(p.mobile) : '<span class="prnophone">None, so no texts</span>') + "</div>" +
        '<div><span class="k">Email</span>' + (p.email ? '<a href="mailto:' + prEsc(p.email) + '">' + prEsc(p.email) + "</a>" : "None") + "</div>" +
        '<div><span class="k">Website</span>' + (/^https?:\/\//i.test(String(p.website || "")) ? '<a href="' + prEsc(p.website) + '" target="_blank" rel="noopener">' + prEsc(siteHost(p.website)) + "</a>" : "None") + "</div>" +
        '<div><span class="k">Set up</span>' + prEsc(when(p.created_at)) + " (" + prEsc(ago(p.days_since_setup)) + "), by " + prEsc(sourceText(p)) + "</div>" +
        '<div><span class="k">Welcome email</span>' + prEsc(welcomeText(p.welcome)) + "</div>" +
        (done ? "" : '<div><span class="k">Last sign-in</span>' + prEsc(signInText(p)) + "</div>") +
        '<div><span class="k">First sign-in</span><span data-pr-first="1">' + prEsc(firstSignInText(p)) + "</span></div>" +
        '<div><span class="k">Free month ends</span><span data-pr-ends="1">' + prEsc(freeMonthText(p)) + "</span></div>" +
        '<div><span class="k">Where</span>' + prEsc([p.postcode, p.state].filter(Boolean).join(" ") || "Not known") + "</div>" +
      "</div>" + called + form + "</div></div>";
  }
  function headHtml(d) {
    var n = (d.prospects || []).length, f = d.follow_up_count || 0;
    return '<div class="rowbetween"><div class="lblk" style="margin:0">Prospects <span class="mono">' + n + "</span>" +
      (f ? ' <span class="prsum">' + f + " to call</span>" : "") + "</div>" +
      '<button class="btn ghost sp" type="button" id="prRefresh">Refresh</button></div>' +
      '<div class="note" style="margin:0 0 14px">Venues we set up that have not signed up yet. When one adds their card it moves to Venues by itself. ' +
      "Anyone who asked for a call is flagged Call requested, and anyone who has not signed in " + prEsc(d.follow_up_days) +
      " days after setup is flagged Call them when we have their phone number. With no number, a follow-up email is drafted for Dean to approve instead. Mark Called once you have rung them. The free month starts at their first sign-in;" +
      " its last " + prEsc(d.last_days || 3) + " days are highlighted." +
      (d.free_month_ready === false ? " Free months are not recorded until migration 127 is run." : "") +
      (d.signed_up ? " " + prEsc(d.signed_up) + " earlier prospect" + (d.signed_up === 1 ? " has" : "s have") + " signed up." : "") + "</div>";
  }
  /* Everyone the tab can show: the prospects (the Worker's order, who to ring first), then Card added. */
  function allOf(d) { return (d.prospects || []).concat(d.card_added || []); }
  function matches(p, f) {
    if (f === "all") return true;
    if (f === "last_days") return statusOf(p) === "free_month" && !!p.last_days;
    return statusOf(p) === f;
  }
  function filterLabel(f) { return f === "all" ? "All statuses" : f === "last_days" ? "Last " + ((S.data && S.data.last_days) || 3) + " days of free month" : STATUS[f].label; }
  function sorted(list, how) {
    var out = list.map(function (p, i) { return { p: p, i: i }; });
    var setup = function (x) { return Date.parse(x.p.created_at) || 0; };
    var cmp = {
      call: function (a, b) { return a.i - b.i; },
      status: function (a, b) { return (STATUS[statusOf(a.p)].rank - STATUS[statusOf(b.p)].rank) || (dl(a.p) - dl(b.p)) || a.i - b.i; },
      days_left: function (a, b) { return (dl(a.p) - dl(b.p)) || (STATUS[statusOf(a.p)].rank - STATUS[statusOf(b.p)].rank) || a.i - b.i; },
      newest: function (a, b) { return (setup(b) - setup(a)) || a.i - b.i; }
    }[how] || function (a, b) { return a.i - b.i; };
    return out.sort(cmp).map(function (x) { return x.p; });
  }
  /* Fewest days left first; a prospect with no free month running sorts after every one that has. */
  function dl(p) { return statusOf(p) === "free_month" && p.days_left != null ? p.days_left : 9999; }
  function barHtml(all) {
    var opts = FILTERS.map(function (f) {
      var n = all.filter(function (p) { return matches(p, f); }).length;
      return '<option value="' + f + '"' + (S.filter === f ? " selected" : "") + ">" + prEsc(filterLabel(f)) + " (" + n + ")</option>";
    }).join("");
    var sorts = [["call", "Who to call first"], ["status", "Status"], ["days_left", "Fewest days left"], ["newest", "Newest set up"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (S.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
    return '<div class="filterbar prbar"><label class="prlbl" for="prFilter">Show</label><select id="prFilter">' + opts + "</select>" +
      '<label class="prlbl" for="prSort">Sort by</label><select id="prSort">' + sorts + "</select></div>";
  }
  function listHtml(d) {
    if (d.error) return '<div class="panel pad"><div class="empty" style="border:none;background:none">' + prEsc(d.error) + "</div></div>";
    var all = allOf(d);
    if (!all.length) return headHtml(d) + '<div class="panel pad"><div class="empty" style="border:none;background:none">No prospects waiting. Set one up from Venues.</div></div>';
    if (FILTERS.indexOf(S.filter) === -1) S.filter = "all";
    var list = sorted(all.filter(function (p) { return matches(p, S.filter); }), S.sort);
    return headHtml(d) + barHtml(all) + (list.length
      ? '<div class="prlist">' + list.map(cardHtml).join("") + "</div>"
      : '<div class="panel pad"><div class="empty" style="border:none;background:none">No prospects are ' + prEsc(filterLabel(S.filter)) + ' right now.</div></div>');
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
      ".prlist{gap:8px}.prcard.panel.pad{padding:10px 14px}.prcard.open{padding:14px}" +
      ".prtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.prname{font-weight:800;font-size:15px;color:#fff;flex:1;min-width:0;overflow-wrap:anywhere}" +
      ".prsub{display:block;font-weight:500;font-size:12.5px;color:var(--muted);margin-top:1px}" +
      "button.badge.prst{cursor:pointer;font:inherit;font-size:12px;font-weight:700;line-height:1.2;padding:5px 10px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}" +
      "button.badge.prst:focus-visible{outline:2px solid var(--pink);outline-offset:2px}" +
      "button.badge.prst::after{content:\"\\25BE\";font-size:10px;opacity:.8}button.badge.prst[aria-expanded=true]::after{content:\"\\25B4\"}" +
      ".prmore{margin-top:10px;border-top:1px solid var(--line-2,rgba(255,255,255,.08));padding-top:10px}" +
      ".prsend{display:inline-flex;flex-direction:column;align-items:flex-start;line-height:1.2}.prvia{font-size:11px;font-weight:500;color:var(--muted);margin-top:2px}" +
      ".prcall{text-decoration:none;font-weight:800;color:var(--pink)!important}" +
      ".predit{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px 16px}.predit .practs,.predit .prerr{grid-column:1/-1}" +
      ".predit input{width:100%}.predit .note{margin-top:3px;font-size:12px}.prerr{color:#FF8A8E;font-weight:700;font-size:13px}" +
      ".prwhy{color:var(--roll);font-size:13px;margin-top:4px}" +
      ".prgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 18px;margin-top:12px;font-size:13.5px}" +
      ".prgrid > div{min-width:0;overflow-wrap:anywhere}.prgrid .k{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:2px}" +
      ".prgrid a{color:var(--text)}.prtel{font-weight:800;color:var(--pink)!important;text-decoration:none;font-size:15px}" +
      ".prnophone{color:var(--muted)}.prquiet{color:var(--muted);font-size:13px;margin-top:4px}.prcalled{margin-top:12px;font-size:13px;color:var(--win)}.prnote{color:var(--text)}" +
      ".practs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.prform{margin-top:12px}.prform textarea{width:100%;margin-top:4px}" +
      ".prsum{color:var(--roll);letter-spacing:0;text-transform:none;font-weight:700;margin-left:6px}" +
      ".badge.roll{background:rgba(245,165,36,.14);color:var(--roll);border:1px solid rgba(245,165,36,.4)}" +
      ".badge.prreq{background:rgba(229,72,77,.16);color:#FF8A8E;border:1px solid rgba(229,72,77,.55)}.prcard.req{border-left-color:#E5484D}" +
      ".prbar{margin:0 0 14px}.prbar select{min-width:0;flex:1 1 180px;max-width:280px}.prlbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}" +
      ".badge.prst-none{background:rgba(255,255,255,.06);color:var(--muted);border:1px solid rgba(255,255,255,.14)}" +
      ".badge.prst-free{background:rgba(53,208,127,.12);color:var(--win);border:1px solid rgba(53,208,127,.4)}" +
      ".badge.prst-free.prst-last{background:rgba(245,165,36,.18);color:var(--roll);border-color:rgba(245,165,36,.65)}" +
      ".badge.prst-card{background:rgba(255,31,142,.12);color:var(--pink);border:1px solid rgba(255,31,142,.45)}" +
      ".badge.prst-paused{background:rgba(229,72,77,.12);color:#FF8A8E;border:1px solid rgba(229,72,77,.4)}" +
      ".badge.prst-cancel{background:rgba(154,154,164,.10);color:var(--faint);border:1px solid rgba(154,154,164,.3);text-decoration:line-through}" +
      ".prcard.last3{border-left-color:var(--roll);box-shadow:inset 0 0 0 1px rgba(245,165,36,.35)}" +
      ".prlast{display:inline-block;margin-top:8px;padding:5px 10px;border-radius:8px;background:rgba(245,165,36,.14);color:var(--roll);font-weight:700;font-size:13px}" +
      "@media (max-width:560px){.prbar select{max-width:none;flex-basis:100%}.prlbl{flex-basis:100%;margin-top:4px}.prname{flex-basis:100%}.practs > *{flex:1 1 auto}}" +
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
    var f = $("prFilter"); if (f) f.addEventListener("change", function () { S.filter = this.value; draw(); });
    var o = $("prSort"); if (o) o.addEventListener("change", function () { S.sort = this.value; draw(); });
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
      S.byId = {};
      allOf(d).forEach(function (p) { S.byId[p.venue_id] = p; });
      setCount(d.error ? 0 : (d.follow_up_count || 0));
      draw();
      try { doc.dispatchEvent(new root.CustomEvent("vp-prospects")); } catch (e) {}
      return d;
    });
    return S.loading;
  }
  function editSave(t) {
    var id = t.getAttribute("data-pr-edit-save"), p = S.byId[id] || {};
    var v = function (k) { return (($(k) || {}).value || "").trim(); };
    var body = { venue_id: id }, want = { contact_name: v("prEdName"), email: v("prEdEmail"), mobile: v("prEdMobile"), phone: v("prEdPhone") };
    Object.keys(want).forEach(function (k) { if (want[k] !== String(p[k] || "")) body[k] = want[k]; });
    var err = $("prEdErr");
    var say = function (m) { if (err) { err.textContent = m; err.hidden = !m; } };
    if (Object.keys(body).length === 1) { S.editing = null; draw(); return; }
    t.disabled = true; t.textContent = "Saving...";
    post("/admin/prospect/update", body).then(function (j) {
      if (j.error) { t.disabled = false; t.textContent = "Save details"; say(j.error); return; }
      S.editing = null; S.loading = false;
      load().then(function () { if (j.warnings && j.warnings.length && root.vpTell) root.vpTell("Saved.\n\n" + j.warnings.join("\n")); });
    });
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-pr-toggle")) { var tid = t.getAttribute("data-pr-toggle"); if (S.expanded[tid]) delete S.expanded[tid]; else S.expanded[tid] = true; draw(); return; }
    if (t.hasAttribute("data-pr-edit")) { S.editing = t.getAttribute("data-pr-edit"); S.open = null; draw(); if ($("prEdName")) $("prEdName").focus(); return; }
    if (t.hasAttribute("data-pr-edit-close")) { S.editing = null; draw(); return; }
    if (t.hasAttribute("data-pr-edit-save")) { editSave(t); return; }
    if (t.hasAttribute("data-pr-called")) { S.open = t.getAttribute("data-pr-called"); S.editing = null; draw(); if ($("prNote")) $("prNote").focus(); return; }
    if (t.hasAttribute("data-pr-close")) { S.open = null; draw(); return; }
    // View as: hq.html's own viewAs (window.hqViewAs), the one the Venues row calls. Never a second copy here.
    if (t.hasAttribute("data-pr-viewas")) { if (typeof root.hqViewAs === "function") root.hqViewAs(t.getAttribute("data-pr-viewas"), t); return; }
    // The same function as the Venues row's button (hq.html hqSigninLink), so both say the same thing; the row tells it
    // their email, mobile and booked welcome, so it can say how the link will go before it goes.
    if (t.hasAttribute("data-pr-signin")) { var sid = t.getAttribute("data-pr-signin"); if (typeof root.hqSigninLink === "function") root.hqSigninLink(sid, t, S.byId[sid]); return; }
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

  root.VPProspects = { load: load, isProspect: function (id) { return !!S.ids[id]; }, get: function (id) { return S.byId[id] || null; },
    _t: { cardHtml: cardHtml, listHtml: listHtml, when: when, S: S, statusLabel: statusLabel, onClick: onClick, editHtml: editHtml } };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else if (doc) start();
})(typeof window !== "undefined" ? window : this);
