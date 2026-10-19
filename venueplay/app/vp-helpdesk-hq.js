/* ============================================================================
   THE HELP DESK, INSIDE HQ (19 Oct 2026). Loaded by app/hq.html with one line.

   One desk for VenuePlay AND PartyPlay. Every ticket shows its brand. Tickets are for Gflam staff
   only: this page reads them through /admin/help/* on the billing Worker, which answers HQ
   admins (owner, accounts, staff) and nobody else, so a venue that somehow loaded this file
   would be shown nothing.

   What is here: a Help desk tab with a count of new tickets on it; the list with filters (brand,
   status, kind, came in by, venue, dates); a ticket opened in a panel (change status, kind,
   priority, brand, who has it; internal notes; reply by email from the address that matches the
   kind); Log a call (how phone calls get a category); the report for a date range with a CSV;
   and "Alert me on this device", which turns on phone alerts (Web Push, see vp-help-sw.js).

   It adds its own tab and pane, and leaves hq.html's own code alone: hq.html's pane switcher
   hides every pane it knows and turns the tab highlight over to ours; this file shows its pane
   when its tab is the one picked.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_HELP_API || "https://venueplay-api.dean-tindale.workers.dev";
  var CAT = { sales: "Sales", venue_support: "Venue support", patron_support: "Player support", accounts: "Accounts", general: "General" };
  var CAT_PP = { venue_support: "Host support", patron_support: "Guest support" };
  var CH = { patron_form: "Phone form", venue_form: "Venue form", web_form: "Website form", email: "Email", phone: "Phone call", manual: "Added by hand" };
  var ST = { "new": "New", open: "Open", waiting: "Waiting on them", closed: "Closed" };
  var BR = { venueplay: "VenuePlay", partyplay: "PartyPlay" };
  function catLabel(c, b) { return (b === "partyplay" && CAT_PP[c]) || CAT[c] || c; }
  function hdEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  function opts(map, blank) { var h = blank ? '<option value="">' + hdEsc(blank) + "</option>" : ""; for (var k in map) h += '<option value="' + hdEsc(k) + '">' + hdEsc(map[k]) + "</option>"; return h; }
  function when(iso) { var d = new Date(iso); if (isNaN(d)) return ""; return d.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
  function ymd(d) { return new Date(d.getTime() + 10 * 3600000).toISOString().slice(0, 10); }   // Brisbane date

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
        if (r.status === 404 && !j.error) j.error = "The help desk is not on the Worker yet (deploy venueplay-api-FULL.js, after migration 106).";
        if (!r.ok && !j.error) j.error = "That did not go through (" + r.status + "). Try again.";
        return j;
      });
    }).catch(function () { return { error: "Could not reach the server. Try again in a minute." }; });
  }

  var S = { tickets: [], venues: {}, assignees: [], allVenues: null, open: null };

  /* ---- the tab and its count ---- */
  function addTab() {
    var nav = $("hqNav"); if (!nav || $("hdTab")) return;
    var b = doc.createElement("button"); b.setAttribute("data-pane", "helpdesk"); b.id = "hdTab";
    b.innerHTML = 'Help desk <span id="hdBadge" class="hdbadge" hidden></span>';
    var lab = $("showTestWrap"); nav.insertBefore(b, lab || null);
    nav.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("button"); if (!t || !t.getAttribute("data-pane")) return;
      var mine = t.getAttribute("data-pane") === "helpdesk";
      if (mine) {
        // hq.html's own switcher does not know this pane: hide every pane it has, and ours shows.
        Array.prototype.forEach.call(doc.querySelectorAll('[id^="pane"]'), function (p) { if (p.id !== "paneHelpdesk") p.classList.add("hidden"); });
        Array.prototype.forEach.call(nav.querySelectorAll("button[data-pane]"), function (x) { x.classList.toggle("on", x === t); });
        showPane(true); load();
      } else showPane(false);
    });
  }
  function showPane(on) { var p = $("paneHelpdesk"); if (p) p.classList.toggle("hidden", !on); }
  function badge() {
    post("/admin/help/count", {}).then(function (j) {
      var b = $("hdBadge"); if (!b || j.error) return;
      b.hidden = !j.new; b.textContent = j.new + (j.urgent ? " (" + j.urgent + " urgent)" : "");
      b.classList.toggle("urgent", !!j.urgent);
      try { if (root.navigator.setAppBadge) { if (j.new) root.navigator.setAppBadge(j.new); else root.navigator.clearAppBadge(); } } catch (e) {}
    });
  }

  /* ---- the pane ---- */
  function addPane() {
    if ($("paneHelpdesk")) return;
    var host = $("paneVenues") ? $("paneVenues").parentNode : doc.body;
    var p = doc.createElement("div"); p.id = "paneHelpdesk"; p.className = "hidden";
    var today = ymd(new Date()), monthAgo = ymd(new Date(Date.now() - 30 * 86400000));
    p.innerHTML =
      /* HQ's own components throughout (panel, filterbar, scard, badge, field, btn, mini); this block
         only adds what HQ has no class for. HQ styles text, email and number inputs but not date
         ones, so those get HQ's input look here. */
      '<style>' +
      '.hdbadge{display:inline-block;min-width:19px;padding:1px 7px;margin-left:7px;border-radius:999px;background:#E5484D;color:#fff;font-size:11px;font-weight:800;line-height:17px;text-align:center;vertical-align:1px}' +
      '.navpills button.on .hdbadge{background:#fff;color:#C70F69}' +
      '.badge.pp{background:rgba(23,196,180,.14);color:#3FE0D0}.badge.urgent{background:rgba(229,72,77,.16);color:#FF6B6B}' +
      '.hdrow{cursor:pointer}.hdrow:hover td{background:rgba(255,255,255,.025)}.hdrow td .vt{display:block;margin-top:2px}' +
      '#paneHelpdesk input[type=date]{background:var(--ink-3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 11px;font-family:Manrope,sans-serif;font-size:13.5px;outline:none;color-scheme:dark}' +
      '#paneHelpdesk input[type=date]:focus{border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,31,142,.15)}' +
      '#paneHelpdesk textarea{min-height:96px;resize:vertical}' +
      '.hdgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 12px;align-items:end}' +
      '.hdgrid .field{margin-bottom:8px}' +
      '.hdmsg{white-space:pre-wrap;background:var(--ink-3);border:1px solid var(--line-2);border-radius:12px;padding:13px 14px;margin:12px 0 16px;font-size:13.5px;line-height:1.55}' +
      '.hdnote{background:var(--ink-3);border:1px solid var(--line-2);border-left:3px solid var(--line);border-radius:10px;padding:9px 12px;margin:0 0 8px;white-space:pre-wrap;font-size:13px}' +
      '.hdnote.reply{border-left-color:var(--pink)}.hdnote.email_in{border-left-color:var(--win)}.hdnote.change{background:none;border-color:transparent;color:var(--muted);font-size:12px;padding:3px 12px}' +
      '.hdnote .k{font-size:11px;color:var(--faint);margin-bottom:3px;white-space:normal}' +
      '.hdcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}' +
      '.hdrep{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:12px}' +
      '.hdrep table{min-width:0}.hdrep .panel .lblk{margin:14px 14px 4px}' +
      '.hdstats{grid-template-columns:repeat(4,1fr)}@media (max-width:700px){.hdstats{grid-template-columns:repeat(2,1fr)}}' +
      '.hdf{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}' +
      '.hwrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start;padding:12px 0;border-bottom:1px solid var(--line-2)}.hwrow:last-child{border-bottom:none}' +
      '.hwacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}' +
      '.hwchk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.hwchk input{width:auto}' +
      '.hwsteps{margin:10px 0 0 0;padding-left:14px;border-left:2px solid var(--line)}' +
      '.hwstat{font-size:11.5px;color:var(--faint);white-space:nowrap}.hwhide{opacity:.55}' +
      '.hwnum{font-family:JetBrains Mono,monospace;color:var(--faint);font-size:12px;margin-right:6px}' +
      '.hwtwo{display:grid;grid-template-columns:2fr 1fr;gap:4px 12px}.hwfaqadd{display:grid;grid-template-columns:1fr 2fr auto;gap:8px;margin-top:12px}' +
      '@media (max-width:700px){.hwrow{grid-template-columns:1fr}.hwacts{justify-content:flex-start}.hwtwo,.hwfaqadd{grid-template-columns:1fr}.hwsteps{padding-left:10px}}' +
      '#paneHelpdesk .filterbar select{min-width:0;width:auto;padding-right:34px}#paneHelpdesk .filterbar input[type=date]{width:150px}' +
      '</style>' +
      '<div class="rowbetween">' +
        '<div class="note" style="margin:0">Every ticket from both brands, newest first. Open one to work it.</div>' +
        '<button class="btn ghost sp" id="hdLogCall">+ Log a call</button>' +
        '<button class="btn ghost" id="hdAlert">Alert me on this device</button>' +
      '</div>' +
      '<div class="panel pad" style="margin-bottom:4px">' +
        '<div class="filterbar">' +
          '<select id="hdfBrand">' + opts(BR, "Both brands") + '</select>' +
          '<select id="hdfStatus"><option value="not_closed">Not closed</option>' + opts(ST, "Any status") + '</select>' +
          '<select id="hdfCat">' + opts(CAT, "Any kind") + '</select>' +
          '<select id="hdfCh">' + opts(CH, "Came in any way") + '</select>' +
          '<select id="hdfVenue"><option value="">Any venue</option></select>' +
          '<label class="hdf">From <input type="date" id="hdfFrom"></label><label class="hdf">to <input type="date" id="hdfTo"></label>' +
          '<button class="btn pink" id="hdfGo">Show</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel pad hidden" id="hdAlertBox" style="margin-bottom:14px"></div>' +
      '<div class="panel pad hidden" id="hdCallBox" style="margin-bottom:14px"></div>' +
      '<div class="lblk" id="hdLbl">Tickets</div>' +
      '<div class="panel"><div class="tscroll"><table><thead><tr><th>#</th><th>Brand</th><th>Kind</th><th>Came in by</th><th>Status</th><th>Venue or party</th><th>Subject</th><th>Arrived</th></tr></thead>' +
        '<tbody id="hdRows"><tr><td colspan="8" class="note">Loading...</td></tr></tbody></table></div></div>' +
      '<div class="panel pad hidden" id="hdTicket" style="margin-top:14px"></div>' +
      '<div class="lblk" style="margin-top:30px">Report</div>' +
      '<div class="panel pad"><div class="filterbar">' +
        '<label class="hdf">From <input type="date" id="hdrFrom" value="' + monthAgo + '"></label>' +
        '<label class="hdf">to <input type="date" id="hdrTo" value="' + today + '"></label>' +
        '<select id="hdrBrand">' + opts(BR, "Both brands") + '</select>' +
        '<button class="btn pink" id="hdrGo">Run report</button>' +
        '<button class="btn ghost" id="hdrCsv" disabled>Download CSV</button>' +
      '</div><div class="note" style="margin-top:9px">Tickets that arrived in these dates. Time to close counts the ones of those that are closed. The CSV has no names or email addresses in it.</div></div>' +
      '<div id="hdReport"></div>' +
      '<div class="lblk" style="margin-top:30px">Help words and guided steps</div>' +
      '<div class="panel pad"><div class="filterbar">' +
        '<select id="hwSet"><option value="venueplay:patron">VenuePlay players</option><option value="venueplay:venue">VenuePlay venues</option>' +
        '<option value="partyplay:guest">PartyPlay guests</option><option value="partyplay:host">PartyPlay hosts</option></select>' +
        '<button class="btn pink" id="hwGo">Open</button>' +
      '</div><div class="note" style="margin-top:9px">What the Help panel shows, for each brand and who is asking. Changes show on phones straight away. ' +
        'Steps move themselves up when they fix more, once each has about 20 answers; a pinned step stays where it is.</div></div>' +
      '<div id="hwBox"></div>';
    host.appendChild(p);
    $("hdfGo").addEventListener("click", load);
    $("hdRows").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-id]"); if (tr) openTicket(tr.getAttribute("data-id")); });
    $("hdLogCall").addEventListener("click", logCallForm);
    $("hdAlert").addEventListener("click", alertForm);
    $("hdrGo").addEventListener("click", report);
    $("hdrCsv").addEventListener("click", csv);
    $("hwGo").addEventListener("click", editorLoad);
  }

  function filters() {
    return { brand: $("hdfBrand").value, status: $("hdfStatus").value, category: $("hdfCat").value, channel: $("hdfCh").value,
             venue_id: $("hdfVenue").value, from: $("hdfFrom").value, to: $("hdfTo").value, with_venues: !S.allVenues };
  }
  function load() {
    var rows = $("hdRows"); if (!rows) return;
    post("/admin/help/list", filters()).then(function (j) {
      if (j.error) { rows.innerHTML = '<tr><td colspan="8" class="note">' + hdEsc(j.error) + "</td></tr>"; return; }
      S.tickets = j.tickets || []; S.venues = j.venues || {}; S.assignees = j.assignees || [];
      if (j.all_venues) { S.allVenues = j.all_venues; var sel = $("hdfVenue"), keep = sel.value;
        sel.innerHTML = '<option value="">Any venue</option>' + S.allVenues.map(function (v) { return '<option value="' + hdEsc(v.id) + '">' + hdEsc(v.name) + "</option>"; }).join(""); sel.value = keep; }
      var lbl = $("hdLbl"); if (lbl) lbl.textContent = S.tickets.length + (S.tickets.length === 1 ? " ticket" : " tickets");
      rows.innerHTML = S.tickets.length ? S.tickets.map(function (t) {
        var st = { "new": "gold", open: "live", waiting: "indep", closed: "idle" }[t.status] || "idle";
        return '<tr class="hdrow" data-id="' + hdEsc(t.id) + '"><td class="num">' + t.ticket_no + "</td>" +
          '<td><span class="badge hdbrand ' + (t.brand === "partyplay" ? "pp" : "grouped") + '">' + hdEsc(BR[t.brand] || t.brand) + "</span></td>" +
          '<td><span class="vn">' + hdEsc(catLabel(t.category, t.brand)) + "</span>" + (t.priority === "urgent" ? ' <span class="badge urgent">Urgent</span>' : "") + "</td>" +
          "<td>" + hdEsc(CH[t.channel] || t.channel) + '</td><td><span class="badge ' + st + '">' + hdEsc(ST[t.status] || t.status) + "</span></td>" +
          "<td>" + hdEsc(S.venues[t.venue_id] || (t.room_code ? (t.brand === "partyplay" ? "Party " : "Room ") + t.room_code : "")) + "</td>" +
          "<td>" + hdEsc(t.subject) + '</td><td class="vt" style="white-space:nowrap">' + hdEsc(when(t.created_at)) + "</td></tr>";
      }).join("") : '<tr><td colspan="8" class="note">No tickets match.</td></tr>';
    });
    badge();
  }

  /* ---- one ticket ---- */
  function openTicket(id, no) {
    var box = $("hdTicket"); box.classList.remove("hidden"); box.innerHTML = '<div class="note">Opening...</div>';
    post("/admin/help/get", no ? { ticket_no: no } : { id: id }).then(function (j) {
      if (j.error) { box.innerHTML = '<div class="note">' + hdEsc(j.error) + "</div>"; return; }
      var t = j.ticket; S.open = t;
      var from = t.category === "accounts" ? "accounts@" : (t.category === "venue_support" || t.category === "patron_support") ? "support@" : "hello@";
      from += t.brand + ".com.au";
      function fld(label, html) { return '<div class="field"><label>' + label + "</label>" + html + "</div>"; }
      box.innerHTML =
        '<div class="cxhead"><span class="badge hdbrand ' + (t.brand === "partyplay" ? "pp" : "grouped") + '">' + hdEsc(BR[t.brand]) + "</span>" +
          '<span class="cxname">#' + t.ticket_no + " " + hdEsc(t.subject) + "</span>" +
          (t.priority === "urgent" ? '<span class="badge urgent">Urgent</span>' : "") +
          '<button class="mini" id="hdClose" style="margin-left:auto">Close</button></div>' +
        '<div class="note" style="margin-top:0">' + hdEsc(CH[t.channel] || t.channel) + " &middot; " + hdEsc(when(t.created_at)) +
          (j.venue_name ? " &middot; <b>" + hdEsc(j.venue_name) + "</b>" : "") + (t.room_code ? " &middot; " + (t.brand === "partyplay" ? "party " : "room ") + hdEsc(t.room_code) : "") +
          (t.source_address ? " &middot; sent to " + hdEsc(t.source_address) : "") +
          '<br><b>' + hdEsc(t.contact_name || "") + "</b>" + (t.contact_email ? " " + hdEsc(t.contact_email) : "") +
          (t.contact_typed ? ' <span class="badge gold" title="HQ typed this address in; the customer did not give it in writing">typed by HQ</span>' : "") +
          (t.contact_phone ? " &middot; " + hdEsc(t.contact_phone) : "") + "</div>" +
        (t.contact_email_pending ? '<div class="restrict" id="hdPending">They asked for replies to go to <b>' + hdEsc(t.contact_email_pending) + "</b>. Nothing has been sent there. " +
          '<button class="mini" id="hdUsePending">Use ' + hdEsc(t.contact_email_pending) + '</button> <button class="mini" id="hdKeepContact">Keep ' + hdEsc(t.contact_email || "the original") + "</button></div>" : "") +
        '<div class="hdmsg">' + hdEsc(t.message || "(no message)") + "</div>" +
        '<div class="hdgrid">' +
          fld("Status", '<select id="hdtStatus">' + opts(ST) + "</select>") +
          fld("Kind", '<select id="hdtCat">' + Object.keys(CAT).map(function (k) { return '<option value="' + k + '">' + hdEsc(catLabel(k, t.brand)) + "</option>"; }).join("") + "</select>") +
          fld("Priority", '<select id="hdtPri"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>') +
          fld("Brand", '<select id="hdtBrand">' + opts(BR) + "</select>") +
          fld("Who has it", '<input type="text" id="hdtWho" list="hdWhoList" placeholder="Nobody yet" value="' + hdEsc(t.assigned_to || "") + '"><datalist id="hdWhoList">' + S.assignees.map(function (a) { return '<option value="' + hdEsc(a) + '">'; }).join("") + "</datalist>") +
          '<div class="field"><button class="btn pink" id="hdtSave" style="width:100%">Save changes</button></div>' +
        "</div>" +
        '<div class="lblk">History</div><div id="hdNotes">' + ((j.notes || []).map(function (n) {
          return '<div class="hdnote ' + hdEsc(n.kind) + '"><div class="k">' + hdEsc({ note: "Note", reply: "Emailed them", email_in: "They wrote", change: "Change" }[n.kind] || n.kind) + " &middot; " + hdEsc(n.author || "") + " &middot; " + hdEsc(when(n.created_at)) + "</div>" + hdEsc(n.body) + "</div>";
        }).join("") || '<div class="note">Nothing yet.</div>') + "</div>" +
        '<div class="hdcols" style="margin-top:14px">' +
          fld("Internal note, only HQ sees it", '<textarea id="hdtNote"></textarea><button class="btn ghost" id="hdtNoteGo" style="margin-top:8px">Add note</button>') +
          fld(t.contact_email ? "Email " + hdEsc(t.contact_email) + " from " + hdEsc(from) : "No email address on this ticket",
              '<textarea id="hdtReply"' + (t.contact_email ? "" : " disabled") + '></textarea><button class="btn pink" id="hdtReplyGo" style="margin-top:8px"' + (t.contact_email ? "" : " disabled") + ">Send reply</button>") +
        "</div>" +
        '<div class="errflash" id="hdtMsg"></div>';
      $("hdtStatus").value = t.status; $("hdtCat").value = t.category; $("hdtPri").value = t.priority; $("hdtBrand").value = t.brand;
      $("hdClose").addEventListener("click", function () { box.classList.add("hidden"); });
      $("hdtSave").addEventListener("click", function () {
        post("/admin/help/update", { id: t.id, status: $("hdtStatus").value, category: $("hdtCat").value, priority: $("hdtPri").value, brand: $("hdtBrand").value, assigned_to: $("hdtWho").value })
          .then(function (r) { if (r.error) { $("hdtMsg").textContent = r.error; $("hdtMsg").classList.add("show"); } else { openTicket(t.id); load(); } });
      });
      $("hdtNoteGo").addEventListener("click", function () {
        post("/admin/help/note", { id: t.id, body: $("hdtNote").value }).then(function (r) { if (r.error) { $("hdtMsg").textContent = r.error; $("hdtMsg").classList.add("show"); } else openTicket(t.id); });
      });
      /* A reply to an address HQ typed in: the Worker asks for that exact address to be confirmed
         (unless the owner is sending). The question is asked here, on the page, never in a native
         dialog, which can freeze a tab. */
      function sendReply(confirmTo) {
        var b = $("hdtReplyGo"); b.disabled = true; b.textContent = "Sending...";
        var body = { id: t.id, body: $("hdtReply").value }; if (confirmTo) body.confirm_to = confirmTo;
        post("/admin/help/reply", body).then(function (r) {
          b.disabled = false; b.textContent = "Send reply";
          if (r.confirm_needed) {
            var box2 = $("hdConfirm") || doc.createElement("div"); box2.id = "hdConfirm"; box2.className = "restrict";
            box2.innerHTML = hdEsc(r.error) + '<br><b>' + hdEsc(r.address) + '</b> <button class="btn pink" id="hdConfirmGo" style="padding:7px 12px;margin-left:8px">Yes, send it to this address</button>';
            $("hdtReplyGo").parentNode.appendChild(box2);
            $("hdConfirmGo").addEventListener("click", function () { box2.parentNode.removeChild(box2); sendReply(r.address); });
            return;
          }
          if (r.error) { $("hdtMsg").textContent = r.error; $("hdtMsg").classList.add("show"); } else { openTicket(t.id); load(); }
        });
      }
      $("hdtReplyGo").addEventListener("click", function () { sendReply(null); });
      function pending(use) {
        post("/admin/help/contact", { id: t.id, use: use }).then(function (r) {
          if (r.error) { $("hdtMsg").textContent = r.error; $("hdtMsg").classList.add("show"); } else openTicket(t.id);
        });
      }
      if ($("hdUsePending")) { $("hdUsePending").addEventListener("click", function () { pending(true); }); $("hdKeepContact").addEventListener("click", function () { pending(false); }); }
      badge();
      try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    });
  }

  /* ---- log a call ---- */
  function logCallForm() {
    var box = $("hdCallBox"); box.classList.toggle("hidden"); if (box.classList.contains("hidden")) return;
    var vOpts = (S.allVenues || []).map(function (v) { return '<option value="' + hdEsc(v.id) + '">' + hdEsc(v.name) + "</option>"; }).join("");
    function fld(label, html) { return '<div class="field"><label>' + label + "</label>" + html + "</div>"; }
    box.innerHTML = '<div class="cxhead"><span class="cxname">Log a call</span><span class="note" style="margin:0">Pick what kind of call it was while it is fresh. That is what the report counts.</span></div>' +
      '<div class="hdgrid">' +
      fld("Brand", '<select id="hdcBrand">' + opts(BR) + "</select>") +
      fld("What kind of call", '<select id="hdcCat">' + opts(CAT, "Pick one") + "</select>") +
      fld("Venue (VenuePlay)", '<select id="hdcVenue"><option value="">None</option>' + vOpts + "</select>") +
      fld("Party code (PartyPlay)", '<input type="text" id="hdcCode" maxlength="8" class="mono">') +
      fld("Their name", '<input type="text" id="hdcName">') + fld("Their phone", '<input type="text" id="hdcPhone" inputmode="tel">') +
      fld("Their email", '<input type="email" id="hdcEmail">') +
      fld("Priority", '<select id="hdcPri"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>') +
      fld("Status", '<select id="hdcStatus"><option value="open">Still to do</option><option value="closed">Sorted on the call</option></select>') + "</div>" +
      fld("Subject", '<input type="text" id="hdcSubject">') + fld("What was said", '<textarea id="hdcMsg"></textarea>') +
      '<button class="btn pink" id="hdcGo">Save the call</button><div class="errflash" id="hdcMsgOut"></div>';
    $("hdcGo").addEventListener("click", function () {
      post("/admin/help/log-call", { brand: $("hdcBrand").value, category: $("hdcCat").value, venue_id: $("hdcVenue").value, room_code: $("hdcCode").value,
        contact_name: $("hdcName").value, contact_phone: $("hdcPhone").value, contact_email: $("hdcEmail").value, priority: $("hdcPri").value,
        status: $("hdcStatus").value, subject: $("hdcSubject").value, message: $("hdcMsg").value }).then(function (r) {
        if (r.error) { $("hdcMsgOut").textContent = r.error; $("hdcMsgOut").classList.add("show"); return; }
        box.classList.add("hidden"); load();
      });
    });
  }

  /* ---- the report ---- */
  var lastReport = null;
  function table(title, obj, label) {
    var keys = Object.keys(obj || {}).sort(function (a, b) { return obj[b] - obj[a]; });
    return '<div class="panel"><div class="lblk">' + hdEsc(title) + '</div><table>' + (keys.length ? keys.map(function (k) { return "<tr><td>" + hdEsc(label ? label(k) : k) + '</td><td class="num" style="text-align:right">' + obj[k] + "</td></tr>"; }).join("") : '<tr><td class="note">None</td></tr>') + "</table></div>";
  }
  function report() {
    var out = $("hdReport"); out.innerHTML = '<div class="note">Counting...</div>';
    post("/admin/help/report", { from: $("hdrFrom").value, to: $("hdrTo").value, brand: $("hdrBrand").value }).then(function (j) {
      if (j.error) { out.innerHTML = '<div class="errflash show">' + hdEsc(j.error) + "</div>"; return; }
      lastReport = j; $("hdrCsv").disabled = false;
      var R = j.report;
      function card(k, v, d) { return '<div class="scard"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + "</div></div>"; }
      out.innerHTML =
        '<div class="stats hdstats" style="margin-top:14px">' +
          card("Tickets", R.total, R.total === 1 ? "1 ticket" : R.total + " tickets, " + hdEsc(j.from) + " to " + hdEsc(j.to)) +
          card("Closed", R.closed, R.total ? Math.round(100 * R.closed / R.total) + "% of them" : "&nbsp;") +
          card("Average to close", R.avg_hours_to_close != null ? R.avg_hours_to_close + "h" : "&ndash;", R.avg_hours_to_close != null ? R.avg_hours_to_close + " hours to close on average" : "none closed yet") +
          card("Longest", R.longest_hours_to_close != null ? R.longest_hours_to_close + "h" : "&ndash;", R.longest_ticket_no ? "ticket #" + R.longest_ticket_no : "&nbsp;") +
        "</div>" +

        '<div class="hdrep">' + table("By brand", R.by_brand, function (k) { return BR[k] || k; }) +
          table("By kind", R.by_brand_category, function (k) { var p = k.split(":"); return (BR[p[0]] || p[0]) + ": " + catLabel(p[1], p[0]); }) +
          table("By how it came in", R.by_channel, function (k) { return CH[k] || k; }) + table("By status", R.by_status, function (k) { return ST[k] || k; }) +
          '<div class="panel"><div class="lblk">Venues with the most</div><table>' + (R.top_venues.length ? R.top_venues.map(function (v) { return '<tr><td class="vn">' + hdEsc(v.name) + '</td><td class="num" style="text-align:right">' + v.count + "</td></tr>"; }).join("") : '<tr><td class="note">None</td></tr>') + "</table></div>" +
        "</div>" + triageTable(j.triage || []);
    });
  }
  function triageTable(rows) {
    var body = rows.length ? rows.map(function (r) {
      var steps = Object.keys(r.by_step || {}).sort(function (a, b) { return r.by_step[b] - r.by_step[a]; })
        .map(function (k) { return hdEsc(k) + " <b>" + r.by_step[k] + "</b>"; }).join("<br>");
      return '<tr><td><span class="badge hdbrand ' + (r.brand === "partyplay" ? "pp" : "grouped") + '">' + hdEsc(BR[r.brand] || r.brand) + "</span></td>" +
        '<td class="vn">' + hdEsc(r.title) + '</td><td class="num">' + r.started + '</td><td class="num" style="color:var(--win)">' + r.solved +
        '</td><td class="num">' + r.tickets + '</td><td class="num">' + r.left + '</td><td class="vt">' + (steps || "&ndash;") + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="note">Nobody used the guided steps in these dates.</td></tr>';
    return '<div class="lblk">Guided steps: solved without a ticket</div><div class="panel" id="hdTriage"><div class="tscroll"><table><thead><tr><th>Brand</th><th>Issue</th>' +
      '<th>Picked it</th><th>Solved, no ticket</th><th>Sent a ticket</th><th>Left</th><th>Which step fixed it</th></tr></thead><tbody>' + body + "</tbody></table></div></div>";
  }
  /* Same rule as HQ's own CSV: a cell that starts like a formula gets a leading quote. No contact
     details in the file: it is a count of the work, and a CSV travels further than this page. */
  function hdCsv(v) { v = (v == null ? "" : String(v)); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"'; return v; }
  function csv() {
    if (!lastReport) return;
    var rows = [["ticket", "brand", "created", "kind", "came in by", "status", "priority", "venue or party", "subject", "closed", "hours to close"]];
    lastReport.rows.forEach(function (t) {
      var h = t.closed_at ? Math.round(10 * (Date.parse(t.closed_at) - Date.parse(t.created_at)) / 3600000) / 10 : "";
      rows.push([t.ticket_no, BR[t.brand] || t.brand, t.created_at, catLabel(t.category, t.brand), CH[t.channel] || t.channel, ST[t.status] || t.status, t.priority,
                 lastReport.venues[t.venue_id] || t.room_code || "", t.subject, t.closed_at || "", h]);
    });
    var blob = new Blob([rows.map(function (r) { return r.map(hdCsv).join(","); }).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    var a = doc.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "help-desk-" + lastReport.from + "-to-" + lastReport.to + ".csv";
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
  }

  /* ---- the help words editor ---- */
  var HW = null;
  function hwSet() { var v = $("hwSet").value.split(":"); return { brand: v[0], audience: v[1] }; }
  function editorLoad() {
    var box = $("hwBox"); box.innerHTML = '<div class="note">Opening...</div>';
    var set = hwSet();
    post("/admin/help/content/get", set).then(function (j) {
      if (j.error) { box.innerHTML = '<div class="errflash show">' + hdEsc(j.error) + "</div>"; return; }
      HW = j; HW.set = set; editorDraw();
    });
  }
  function catOpts(brand, cur) { return Object.keys(CAT).map(function (k) { return '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + hdEsc(catLabel(k, brand)) + "</option>"; }).join(""); }
  function moveBtns(kind, id) { return '<button class="mini" data-hw="move" data-kind="' + kind + '" data-id="' + id + '" data-dir="up" title="Move up">&#8593;</button>' +
    '<button class="mini" data-hw="move" data-kind="' + kind + '" data-id="' + id + '" data-dir="down" title="Move down">&#8595;</button>'; }
  function editorDraw() {
    var box = $("hwBox"), b = HW.set.brand, steps = function (i) { return i.steps || []; };
    var stepTitle = {}; HW.issues.forEach(function (i) { steps(i).forEach(function (s) { stepTitle[s.id] = s.body; }); });
    var issuesHtml = HW.issues.map(function (i) {
      return '<div class="hwrow' + (i.hidden ? " hwhide" : "") + '" data-issue="' + i.id + '"><div>' +
        '<div class="hwtwo"><div class="field"><label>Issue, as the list shows it</label><input type="text" data-f="title" value="' + hdEsc(i.title) + '"></div>' +
        '<div class="field"><label>If not fixed, the ticket is</label><select data-f="category">' + catOpts(b, i.category) + "</select></div></div>" +
        '<div class="hwsteps">' + (steps(i).length ? steps(i).map(function (s, n) {
          return '<div class="hwrow' + (s.hidden ? " hwhide" : "") + '" data-step="' + s.id + '"><div><span class="hwnum">Step ' + (n + 1) + "</span>" +
            (s.flagged ? '<span class="badge urgent" title="Fixes under 5% after 30 tries">Rarely helps</span> ' : "") +
            '<input type="text" data-f="body" value="' + hdEsc(s.body) + '" style="margin-top:6px">' +
            '<div class="hwstat" style="margin-top:5px">' + (s.tries ? s.tries + " answers, fixed it " + s.rate + "%" : "no answers yet") + "</div></div>" +
            '<div class="hwacts"><label class="hwchk"><input type="checkbox" data-f="pinned"' + (s.pinned ? " checked" : "") + "> Pinned</label>" +
            '<label class="hwchk"><input type="checkbox" data-f="hidden"' + (s.hidden ? " checked" : "") + "> Hidden</label>" +
            moveBtns("step", s.id) + '<button class="mini" data-hw="save-step" data-id="' + s.id + '">Save</button></div></div>';
        }).join("") : '<div class="note" style="margin:6px 0">No steps: this goes straight to the contact form.</div>') +
        '<div style="margin-top:8px"><input type="text" placeholder="A new step, one short instruction" data-new-step="' + i.id + '" style="max-width:480px"> ' +
        '<button class="mini" data-hw="add-step" data-id="' + i.id + '">+ Add step</button></div></div></div>' +
        '<div class="hwacts"><label class="hwchk"><input type="checkbox" data-f="auto_order"' + (i.auto_order !== false ? " checked" : "") + "> Reorder steps automatically</label>" +
        '<label class="hwchk"><input type="checkbox" data-f="hidden"' + (i.hidden ? " checked" : "") + "> Hidden</label>" +
        moveBtns("issue", i.id) + '<button class="btn pink" data-hw="save-issue" data-id="' + i.id + '" style="padding:8px 14px">Save</button></div></div>';
    }).join("");
    var faqHtml = HW.faq.map(function (f) {
      return '<div class="hwrow' + (f.hidden ? " hwhide" : "") + '" data-faq="' + f.id + '"><div>' +
        '<div class="field"><label>Question</label><input type="text" data-f="question" value="' + hdEsc(f.question) + '"></div>' +
        '<div class="field"><label>Answer</label><textarea data-f="answer">' + hdEsc(f.answer) + "</textarea></div></div>" +
        '<div class="hwacts"><label class="hwchk"><input type="checkbox" data-f="hidden"' + (f.hidden ? " checked" : "") + "> Hidden</label>" +
        moveBtns("faq", f.id) + '<button class="btn pink" data-hw="save-faq" data-id="' + f.id + '" style="padding:8px 14px">Save</button></div></div>';
    }).join("");
    var logHtml = HW.reorders.length ? HW.reorders.map(function (l) {
      var iss = HW.issues.filter(function (i) { return i.id === l.issue_id; })[0];
      function names(ids) { return (ids || []).map(function (id, n) { return (n + 1) + ". " + hdEsc((stepTitle[id] || "(removed)").slice(0, 46)); }).join("<br>"); }
      return "<tr><td class=\"vt\" style=\"white-space:nowrap\">" + hdEsc(when(l.created_at)) + '</td><td class="vn">' + hdEsc(iss ? iss.title : "") + '</td><td class="vt">' + names(l.before_ids) +
        '</td><td class="vt">' + names(l.after_ids) + '</td><td class="vt">' + hdEsc(l.reason || "") + "</td><td>" +
        (l.undone_at ? '<span class="badge idle">Undone by ' + hdEsc(l.undone_by || "") + "</span>" : '<button class="mini" data-hw="undo" data-id="' + l.id + '">Undo</button>') + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="note">No automatic changes yet.</td></tr>';
    box.innerHTML =
      '<div class="lblk">What\'s your issue? (one step at a time)</div><div class="panel pad">' + (issuesHtml || '<div class="note">No issues yet.</div>') +
        '<div style="margin-top:12px"><input type="text" id="hwNewIssue" placeholder="A new issue, as people would say it" style="max-width:420px"> <button class="btn ghost" data-hw="add-issue">+ Add issue</button></div></div>' +
      '<div class="lblk">Questions and answers</div><div class="panel pad">' + (faqHtml || '<div class="note">No questions yet.</div>') +
        '<div class="hwfaqadd"><input type="text" id="hwNewQ" placeholder="New question"><input type="text" id="hwNewA" placeholder="Its answer"><button class="btn ghost" data-hw="add-faq">+ Add question</button></div></div>' +
      '<div class="lblk">Steps the desk moved by itself</div><div class="panel" id="hwLog"><div class="tscroll"><table><thead><tr><th>When</th><th>Issue</th><th>Before</th><th>After</th><th>Why</th><th></th></tr></thead><tbody>' + logHtml + "</tbody></table></div></div>" +
      '<div class="errflash" id="hwMsg"></div>';
  }
  function hwSay(m) { var n = $("hwMsg"); if (n) { n.textContent = m; n.classList.add("show"); } }
  function fields(row) { var o = {}; Array.prototype.forEach.call(row.querySelectorAll(":scope > div [data-f], :scope > .hwacts [data-f]"), function (e) {
    o[e.getAttribute("data-f")] = e.type === "checkbox" ? e.checked : e.value; }); return o; }
  doc.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-hw]"); if (!t || !$("hwBox") || !$("hwBox").contains(t)) return;
    var act = t.getAttribute("data-hw"), id = t.getAttribute("data-id"), set = HW && HW.set, req;
    if (act === "move") req = post("/admin/help/content/move", { kind: t.getAttribute("data-kind"), id: id, dir: t.getAttribute("data-dir") });
    else if (act === "save-faq") req = post("/admin/help/content/save", Object.assign({ kind: "faq", id: id }, fields(t.closest("[data-faq]"))));
    else if (act === "save-issue") { var row = t.closest("[data-issue]"), o = {};
      Array.prototype.forEach.call(row.querySelectorAll("[data-f]"), function (x) { if (x.closest("[data-step]")) return; o[x.getAttribute("data-f")] = x.type === "checkbox" ? x.checked : x.value; });
      req = post("/admin/help/content/save", Object.assign({ kind: "issue", id: id }, o)); }
    else if (act === "save-step") req = post("/admin/help/content/save", Object.assign({ kind: "step", id: id }, fields(t.closest("[data-step]"))));
    else if (act === "add-step") { var inp = doc.querySelector('[data-new-step="' + id + '"]'); req = post("/admin/help/content/save", { kind: "step", issue_id: id, body: inp.value }); }
    else if (act === "add-issue") req = post("/admin/help/content/save", { kind: "issue", brand: set.brand, audience: set.audience, title: $("hwNewIssue").value,
      category: set.audience === "venue" || set.audience === "host" ? "venue_support" : "patron_support" });
    else if (act === "add-faq") req = post("/admin/help/content/save", { kind: "faq", brand: set.brand, audience: set.audience, question: $("hwNewQ").value, answer: $("hwNewA").value });
    else if (act === "undo") req = post("/admin/help/reorder/undo", { id: id });
    if (!req) return;
    t.disabled = true;
    req.then(function (r) { t.disabled = false; if (r.error) { hwSay(r.error); return; } editorLoad(); });
  });

  /* ---- phone alerts ---- */
  function b64ToBytes(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  var SW = "/app/vp-help-sw.js", SCOPE = "/app/help-push/";
  function alertForm() {
    var box = $("hdAlertBox"); box.classList.toggle("hidden"); if (box.classList.contains("hidden")) return;
    var can = ("serviceWorker" in root.navigator) && ("PushManager" in root) && ("Notification" in root);
    var standalone = root.matchMedia && root.matchMedia("(display-mode: standalone)").matches;
    box.innerHTML = '<div class="cxhead"><span class="cxname">Alerts on this device</span></div>' +
      (can ? "" : '<div class="restrict" style="margin:0 0 12px">This browser cannot take alerts' + (/iPhone|iPad/.test(root.navigator.userAgent) && !standalone ? ". On an iPhone: tap Share, then Add to Home Screen, open HQ from that icon, and come back here." : ".") + "</div>") +
      '<div class="note" style="margin:0 0 12px">A buzz on this phone or computer when a ticket comes in. It says the brand, the kind and the number, never the person or their message.</div>' +
      '<div class="checklist" style="max-width:520px;margin-bottom:12px"><label class="checkitem"><input type="radio" name="hdaF" value="all" checked> Every ticket</label>' +
      '<label class="checkitem"><input type="radio" name="hdaF" value="urgent_sales"> Only urgent ones and sales</label></div>' +
      '<button class="btn pink" id="hdaOn"' + (can ? "" : " disabled") + '>Turn alerts on</button> <button class="btn ghost" id="hdaOff"' + (can ? "" : " disabled") + '>Turn alerts off on this device</button>' +
      '<div class="note" id="hdaMsg"></div>';
    if (!can) return;
    $("hdaOn").addEventListener("click", alertOn);
    $("hdaOff").addEventListener("click", alertOff);
  }
  function say(m) { var n = $("hdaMsg"); if (n) n.textContent = m; }
  function activeReg() {
    return root.navigator.serviceWorker.register(SW, { scope: SCOPE }).then(function (reg) {
      if (reg.active) return reg;
      return new Promise(function (res) { var w = reg.installing || reg.waiting; if (!w) return res(reg);
        w.addEventListener("statechange", function () { if (w.state === "activated") res(reg); }); });
    });
  }
  function alertOn() {
    var filter = (doc.querySelector('input[name="hdaF"]:checked') || {}).value || "all";
    say("Asking this device...");
    root.Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("Alerts were not allowed. Allow notifications for this site in the browser's settings, then try again.");
      return post("/admin/help/push/key", {});
    }).then(function (k) {
      if (k.error) throw new Error(k.error);
      return activeReg().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (old) { return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) }); });
      });
    }).then(function (sub) {
      var label = (root.navigator.userAgentData && root.navigator.userAgentData.platform) || root.navigator.platform || "";
      return post("/admin/help/push/subscribe", { endpoint: sub.endpoint, filter: filter, device_label: label }).then(function (r) {
        if (r.error) throw new Error(r.error);
        // The device's own secret, for the service worker to ask what woke it. Never leaves this device but to us.
        return root.caches.open("vp-help-push").then(function (c) {
          return c.put(SCOPE + "config", new Response(JSON.stringify({ api: API, endpoint: sub.endpoint, token: r.token })));
        });
      });
    }).then(function () { say("Alerts are on for this device."); })
      .catch(function (e) { say((e && e.message) || "That did not work. Try again."); });
  }
  function alertOff() {
    root.navigator.serviceWorker.getRegistration(SCOPE).then(function (reg) {
      if (!reg) return null;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return null;
        return post("/admin/help/push/unsubscribe", { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); });
      });
    }).then(function () { return root.caches.delete("vp-help-push"); })
      .then(function () { say("Alerts are off for this device."); })
      .catch(function () { say("Could not turn them off just now."); });
  }

  /* ---- start ---- */
  function start() {
    addTab(); addPane();
    badge(); setInterval(function () { if (!doc.hidden) badge(); }, 60000);
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) badge(); });
    // #help-1042 (from an alert email or a phone alert) opens that ticket.
    var m = /^#help-(\d+)$/.exec(root.location.hash || "");
    if (m || root.location.hash === "#helpdesk") { var tab = $("hdTab"); if (tab) tab.click(); if (m) openTicket(null, m[1]); }
    root.addEventListener("hashchange", function () {
      var h = /^#help-(\d+)$/.exec(root.location.hash || ""); if (!h) return;
      var tab = $("hdTab"); if (tab) tab.click(); openTicket(null, h[1]);
    });
  }
  /* Wait for HQ to have signed in and drawn its tabs (it shows #app once VP.requireAuth answers). */
  (function wait(n) {
    var app = $("app");
    if ($("hqNav") && app && app.style.display === "block") { try { start(); } catch (e) {} return; }
    if (n < 600) setTimeout(function () { wait(n + 1); }, 100);
  })(0);
})(window);
