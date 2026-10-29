/* ============================================================================
   THE HELP DESK, INSIDE HQ (19 Oct 2026). Loaded by app/hq.html with one line.

   One desk for VenuePlay AND PartyPlay. Every ticket shows its brand. Tickets are for Gflam staff
   only: this page reads them through /admin/help/* on the billing Worker, which answers HQ
   admins (owner, accounts, staff) and nobody else, so a venue that somehow loaded this file
   would be shown nothing.

   MADE EASIER (Dean, 29 Oct 2026: "helpdesk needs to be easier to use with templates we can use to
   reply and just all round easier to use tbh"). What changed, and why:
     - four sections, one at a time: Tickets, Saved replies, Report, Help words. The report and the
       help words editor used to sit under the ticket list on one long page.
     - the list starts on "Needs reply", with a count on each of Needs reply, Waiting on them,
       Closed and All, urgent first and then newest. A search box finds a name, an email, a subject,
       a number or a venue; the rarer filters fold away under "More filters" and apply as you pick.
     - each ticket is a card, not an 8-column table, so it reads on a phone without sideways scrolling.
     - a ticket opens in place of the list, with "Back to tickets" (and the phone's own Back button).
       Its "Close" button used to close the PANEL, beside a Status field whose Closed closed the
       TICKET; now there is "Close ticket", and the panel is left by Back.
     - the conversation reads top to bottom: what they wrote, then every reply, note and email, with
       the desk's own lines ("Opened by Dean", "Acknowledgement sent") one quiet grey line each.
     - the reply box is under the conversation, with "Use a saved reply", "Send and close" and
       "Send". An internal note is a separate tab of the same box, so a note is never typed into
       the reply by mistake. Status, kind, priority, brand and who has it fold into "Ticket details".
     - beside the ticket: who they are (email, a phone to tap), their venue, and their other tickets.
   Kept as it was: reply matching, the acknowledgement, phone alerts, the typed-address confirm, the
   held reply address, Log a call, the report and its CSV, the help words editor.

   SAVED REPLIES. Picked in a ticket, the fill-ins ({first_name}, {venue}, {ticket_no}, {tv_link},
   {party_code}) are filled from that ticket and the words drop into the reply box at the cursor, to
   be changed before sending. Only the replies for that ticket's kind of customer are offered:
   venues, players, or PartyPlay. The support line is for venues only; the page refuses to send it
   on any other ticket and so does the Worker. HQ keeps them in Saved replies (migration 126); until
   that table exists the starter set below is used (the same rows the migration seeds,
   tools/test-help-saved-replies.js holds them to one answer) and editing says so.

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
  var ST = { "new": "New", open: "Needs reply", waiting: "Waiting on them", closed: "Closed" };
  var BR = { venueplay: "VenuePlay", partyplay: "PartyPlay" };
  var VIEWS = [["needs", "Needs reply", ["new", "open"]], ["waiting", "Waiting on them", ["waiting"]], ["closed", "Closed", ["closed"]], ["all", "All", null]];
  var AUD = { venue: "VenuePlay venues", player: "VenuePlay players", partyplay: "PartyPlay", any: "Everyone" };
  function catLabel(c, b) { return (b === "partyplay" && CAT_PP[c]) || CAT[c] || c; }
  function hdEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  function opts(map, blank) { var h = blank ? '<option value="">' + hdEsc(blank) + "</option>" : ""; for (var k in map) h += '<option value="' + hdEsc(k) + '">' + hdEsc(map[k]) + "</option>"; return h; }
  function when(iso) { var d = new Date(iso); if (isNaN(d)) return ""; return d.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
  function ago(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    if (h < 48) return "yesterday";
    return new Date(t).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" });
  }
  function ymd(d) { return new Date(d.getTime() + 10 * 3600000).toISOString().slice(0, 10); }   // Brisbane date

  /* ---- saved replies: the starter set (the same rows migration 126 seeds) ---- */
  var SEED = [
    { key: "venue-tv", audience: "venue", title: "TV not showing the game",
      body: "Hi {first_name},\n\nThanks for letting us know. Here's how to get the TV at {venue} going again:\n\n1. On the TV, open {tv_link}.\n2. Reload the page.\n3. Make it full screen, with nothing covering the window. If the browser is hidden behind another window or tab, it slows right down and shows RECONNECTING.\n\nThen start your game from the console as normal and it should appear on the TV within a few seconds. If it still won't show, reply here or call us on 07 5228 3667 (press 2 if a game is on) and we'll sort it out with you.\n\nCheers," },
    { key: "venue-join", audience: "venue", title: "Players can't join",
      body: "Hi {first_name},\n\nPlayers join on their own phones, with no app to download:\n\n1. Scan the QR code on the TV with the phone camera, or\n2. Go to venueplay.com.au/play and type the venue code shown on the TV.\n\nIf someone gets stuck, check the code on their phone matches the TV and ask them to reload the page. Once your host starts the game, everyone who has joined sees it straight away.\n\nIf it's still not working, reply and tell us what their phone says, and we'll take a look.\n\nCheers," },
    { key: "venue-billing", audience: "venue", title: "How billing works",
      body: "Hi {first_name},\n\nHappy to explain. Your plan is priced per player, based on the max players per session you've set for {venue}. It isn't based on how many people are in the room: only people who join a game, on their phone or on paper, count as players.\n\nYour plan never stops anyone joining. If a night runs bigger, each extra player is $2 for that night, and your host has to OK it on screen first, so there are no surprises.\n\nYour Account page shows your plan, your next payment and your invoices. For anything else about a bill, just reply here.\n\nCheers," },
    { key: "venue-signin", audience: "venue", title: "Signing in",
      body: "Hi {first_name},\n\nThere's no password to remember. To sign in:\n\n1. Go to venueplay.com.au/app\n2. Put in your mobile number (or your email, if that's how your login was set up).\n3. We send you a code. Type it in and you're in.\n\nIf the code doesn't arrive within a minute, check it's the number on your account and ask for a new code. If your number has changed, reply with the new one and we'll update it for you.\n\nCheers," },
    { key: "venue-refund", audience: "venue", title: "Refund or cancel request",
      body: "Hi {first_name},\n\nThanks for letting us know. Refunds and cancellations are looked after by our accounts team, so I've passed this on and they'll come back to you within one business day.\n\nIf you'd like to cancel, the account owner can also do it any time from the Account page. A monthly plan runs to the end of the current month, and an annual plan to the end of the period already paid for.\n\nCheers," },
    { key: "venue-call", audience: "venue", title: "We'll call you",
      body: "Hi {first_name},\n\nThanks for getting in touch. This one is easier to sort over the phone, so we'll give you a call shortly. If there's a better time or number to reach you, just reply and let us know.\n\nIf you need us sooner, call 07 5228 3667 and mention ticket {ticket_no}.\n\nCheers," },
    { key: "player-join", audience: "player", title: "Player: can't join or game not showing",
      body: "Hi {first_name},\n\nSorry you had trouble. Here's the quickest way in:\n\n1. Scan the QR code on the venue's big screen with your phone camera, or\n2. Go to venueplay.com.au/play and type the code shown on the screen.\n\nThere's no app to download. If your game isn't showing once the host has started, check the code matches the screen and reload the page. Keep your screen on during the game, as some phones pause the page when they lock.\n\nOn the night, the host in the room is always the quickest help.\n\nCheers," },
    { key: "player-prize", audience: "player", title: "Player: a prize question",
      body: "Hi {first_name},\n\nThanks for your message. Prizes are offered and given out by the venue running the game, and they're always claimed from the host on the night. VenuePlay supplies the game software only, so the best people to help with a prize are the host or the manager at {venue}.\n\nCheers," },
    { key: "player-details", audience: "player", title: "Player: remove my details",
      body: "Hi {first_name},\n\nHappy to help. Could you reply with the name of the venue you played at, and the email or mobile you gave them? Once we have those, we'll take you off that venue's list.\n\nCheers," },
    { key: "pp-lost", audience: "partyplay", title: "PartyPlay: lost party code or email",
      body: "Hi {first_name},\n\nNo worries, we'll get you back in. Could you reply with the email address you used when you bought your party? We'll find it and send your party code and link again.\n\nIt's worth a quick look in your junk or promotions folder too, as it sometimes lands there.\n\nCheers," },
    { key: "pp-join", audience: "partyplay", title: "PartyPlay: guests can't join",
      body: "Hi {first_name},\n\nLet's get your guests in. Put the party screen on your TV or laptop, then guests scan the code on it, or go to partyplay.com.au/play and type {party_code}. They just pick a nickname, with no app and no sign up.\n\nIf a guest sees \"no party with that code\", check it letter by letter against the TV and make sure the party screen is open. Up to 50 guests can play.\n\nCheers," },
    { key: "pp-refund", audience: "partyplay", title: "PartyPlay: refund request",
      body: "Hi {first_name},\n\nThanks for getting in touch. Here's how refunds work: within 7 days of buying, before you press start, it's a full refund. After 7 days, before you press start, your licence stays ready for you for a year. Once a party has started, we can't refund it.\n\nI've passed your request to our accounts team and they'll come back to you within one business day.\n\nCheers," },
    { key: "any-sorted", audience: "any", title: "All sorted, I'll close this",
      body: "Hi {first_name},\n\nGreat to hear it's all sorted. I'll close this one off now. If anything else comes up, just reply to this email and it'll come straight back to us.\n\nCheers," }
  ];

  /* Which saved replies a ticket is offered, and whether the support line may go to it: a venue, or
     one that might be (a VenuePlay ticket about a venue, a bill or a sale). The same rule as the
     Worker's helpPhoneAllowed and the email signature. */
  function audienceFor(t) { return t.brand === "partyplay" ? "partyplay" : t.category === "patron_support" ? "player" : "venue"; }
  function phoneOk(t) { return t.brand !== "partyplay" && ["venue_support", "accounts", "sales"].indexOf(t.category) !== -1; }
  function hasPhone(s) { return String(s || "").replace(/\D/g, "").indexOf("752283667") !== -1 || /\btel:/i.test(String(s || "")); }
  var FILLIN = /\{[a-z][a-z_]{1,24}\}/;
  function fillReply(text, t, ctx) {
    var first = String(t.contact_name || "").trim().split(/\s+/)[0] || "";
    var aud = audienceFor(t);
    var map = {
      first_name: first || "there",
      venue: ctx.venue_name || (aud === "venue" ? "your venue" : "the venue"),
      ticket_no: t.ticket_no ? String(t.ticket_no) : "",
      tv_link: ctx.venue_slug ? "your venue's TV link, venueplay.com.au/tv?" + ctx.venue_slug : "your venue's TV link (it is on your Account page)",
      party_code: t.room_code ? "the party code " + t.room_code : "your party code"
    };
    return String(text || "").replace(/\{([a-z_]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(map, k) && map[k] ? map[k] : m; });
  }

  /* For tools/test-help-saved-replies.js, which runs these against the migration's rows. Nothing secret. */
  root.VPHelpdeskReplies = { SEED: SEED, fillReply: fillReply, audienceFor: audienceFor, phoneOk: phoneOk, hasPhone: hasPhone };

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
        if (r.status === 404 && !j.error) { j.error = "The help desk is not on the Worker yet (deploy venueplay-api-FULL.js, after migration 106)."; j.notThere = true; }
        if (!r.ok && !j.error) j.error = "That did not go through (" + r.status + "). Try again.";
        return j;
      });
    }).catch(function () { return { error: "Could not reach the server. Try again in a minute." }; });
  }

  var S = { all: [], venues: {}, assignees: [], allVenues: null, open: null, view: "needs", q: "", replies: null, repliesStored: false, repliesWhy: "" };

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
      } else {
        showPane(false);
        // Back on Venues: an open venue's tickets may have changed in the desk meanwhile.
        if (t.getAttribute("data-pane") === "venues") setTimeout(function () {
          Array.prototype.forEach.call(doc.querySelectorAll("tr.detail:not(.hidden) [data-vphd]"), function (d) { venueTickets(d.getAttribute("data-vphd")); });
        }, 0);
      }
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
      '.hdbadge[hidden]{display:none}' +
      /* 29 Oct 2026: a badge with nothing to count is hidden; .hdbadge's display beat the hidden
         attribute, so HQ showed a red 0 on Help desk and Cancelled. */
      '.hdbadge{display:inline-block;min-width:19px;padding:1px 7px;margin-left:7px;border-radius:999px;background:#E5484D;color:#fff;font-size:11px;font-weight:800;line-height:17px;text-align:center;vertical-align:1px}' +
      '.navpills button.on .hdbadge{background:#fff;color:#C70F69}' +
      '.badge.pp{background:rgba(23,196,180,.14);color:#3FE0D0}.badge.urgent{background:rgba(229,72,77,.16);color:#FF6B6B}' +
      '#paneHelpdesk input[type=date]{background:var(--ink-3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 11px;font-family:Manrope,sans-serif;font-size:13.5px;outline:none;color-scheme:dark}' +
      '#paneHelpdesk input[type=date]:focus{border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,31,142,.15)}' +
      /* nor search boxes: the same look for the ticket search */
      '#paneHelpdesk input[type=search]{width:100%;background:var(--ink-3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 11px;font-family:Manrope,sans-serif;font-size:13.5px;outline:none;-webkit-appearance:none;appearance:none}' +
      '#paneHelpdesk input[type=search]:focus{border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,31,142,.15)}' +
      '#paneHelpdesk textarea{min-height:96px;resize:vertical}' +
      /* the section switch and the status chips: HQ's pill shape, one size down */
      '.hdsegs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}' +
      '.hdsegs button{border:1px solid var(--line);background:var(--ink-3);color:var(--muted);border-radius:999px;padding:8px 14px;font-family:"Hanken Grotesk",sans-serif;font-weight:700;font-size:12.5px;cursor:pointer;transition:.15s;min-height:36px}' +
      '.hdsegs button.on{background:#fff;color:#0A0A0B;border-color:transparent}.hdsegs button:hover{color:#fff}.hdsegs button.on:hover{color:#0A0A0B}' +
      '.hdsegs .n{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.08);font-size:11px;line-height:18px}' +
      '.hdsegs button.on .n{background:rgba(10,10,11,.1)}.hdsegs .n.hot,.hdsegs button.on .n.hot{background:#E5484D;color:#fff}' +
      '.hdhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}.hdhead .sp{margin-left:auto}' +
      '.hdsearch{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hdsearch input[type=search]{flex:1 1 220px;min-width:0;max-width:none}' +
      '.hdsearch select{width:auto;min-width:0;padding-right:34px}' +
      '.hdmore{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin-top:10px}.hdmore select,.hdmore input{width:100%}' +
      '.hdf{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}' +
      /* the list: one card-row per ticket */
      '#hdRows .hdrow{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center;padding:13px 16px;border-bottom:1px solid var(--line-2);cursor:pointer}' +
      '#hdRows .hdrow:last-child{border-bottom:none}#hdRows .hdrow:hover{background:rgba(255,255,255,.025)}' +
      '.hdrow .t1{display:flex;align-items:baseline;gap:8px;min-width:0}.hdrow .no{font-family:"JetBrains Mono",monospace;color:var(--faint);font-size:12px;flex:none}' +
      '.hdrow .subj{color:#fff;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.hdrow .t2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px;color:var(--muted);margin-top:4px}' +
      '.hdrow .side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:11.5px;color:var(--faint);white-space:nowrap}' +
      '.hdrow.urg{box-shadow:inset 3px 0 0 #E5484D}' +
      '.hdempty{padding:26px 16px;text-align:center;color:var(--faint);font-size:13px}' +
      /* one ticket */
      '.hdtk{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}' +
      '@media (max-width:900px){.hdtk{grid-template-columns:1fr}.hdside{order:-1}}' +
      '.hdtk .panel.pad{padding:16px}' +
      '.hdmsg{white-space:pre-wrap;word-wrap:break-word;background:var(--ink-3);border:1px solid var(--line-2);border-left:3px solid var(--win);border-radius:12px;padding:12px 14px;margin:0 0 10px;font-size:13.5px;line-height:1.55}' +
      '.hdnote{white-space:pre-wrap;word-wrap:break-word;background:var(--ink-3);border:1px solid var(--line-2);border-left:3px solid var(--line);border-radius:12px;padding:11px 14px;margin:0 0 10px;font-size:13.5px;line-height:1.55}' +
      '.hdnote.reply{border-left-color:var(--pink)}.hdnote.email_in{border-left-color:var(--win)}.hdnote.note{border-left-color:var(--gold);background:rgba(255,194,75,.05)}' +
      '.hdnote .k,.hdmsg .k{font-size:11px;color:var(--faint);margin-bottom:4px;white-space:normal;font-weight:600}' +
      /* the desk's own lines: one quiet grey line, no box */
      '.hdnote.change{background:none;border:none;color:var(--faint);font-size:11.5px;padding:2px 2px 2px 14px;margin:0 0 8px;line-height:1.4;white-space:normal}' +
      '.hdnote.change .k{display:inline;font-weight:400;margin:0}' +
      '.hdcomp .hdsegs{margin:0 0 10px}.hdcomp textarea{min-height:150px}' +
      '.hdpick{display:flex;gap:8px;align-items:center;margin-bottom:8px}.hdpick select{flex:1;min-width:0}' +
      '.hdacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
      '.hdhint{font-size:11.5px;color:var(--faint);margin-top:6px;line-height:1.45}' +
      '.hdquick{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line-2)}' +
      '.hdside .hdwho{font-size:13.5px;line-height:1.6;color:var(--text);word-break:break-word}.hdside .hdwho b{color:#fff}' +
      '.hdside .hdwho a{color:var(--pink);text-decoration:none}.hdside .lblk{margin:0 0 8px}.hdside .hdwho+.lblk{margin-top:18px}' +
      '.hdpast{display:block;width:100%;text-align:left;background:none;border:none;border-top:1px solid var(--line-2);padding:9px 0;color:var(--text);font:inherit;font-size:12.5px;cursor:pointer}' +
      '.hdpast:hover{color:#fff}.hdpast .no{font-family:"JetBrains Mono",monospace;color:var(--faint);margin-right:6px}' +
      '.hddet summary{cursor:pointer;font-family:"Hanken Grotesk",sans-serif;font-weight:700;font-size:12.5px;color:var(--muted);padding:4px 0;list-style:none}' +
      '.hddet summary::-webkit-details-marker{display:none}.hddet summary:before{content:"+ ";color:var(--pink)}.hddet[open] summary:before{content:"\\2212  "}' +
      '.hdgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;align-items:end;margin-top:10px}' +
      '.hdgrid .field{margin-bottom:8px}' +
      '.hdok{font-size:12.5px;color:var(--win);font-weight:700;background:rgba(53,208,127,.08);border:1px solid rgba(53,208,127,.25);border-radius:10px;padding:10px 12px;margin:0 0 12px}' +
      /* saved replies manager */
      '.hsrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start;padding:14px 0;border-bottom:1px solid var(--line-2)}.hsrow:last-child{border-bottom:none}' +
      '.hsitem{border-bottom:1px solid var(--line-2);padding:12px 0}.hsitem:last-child{border-bottom:none}' +
      '.hsitem>summary{cursor:pointer;list-style:none;display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:start}.hsitem>summary::-webkit-details-marker{display:none}' +
      '.hsitem>summary b{color:#fff;font-size:13.5px}.hsitem>summary .hsedit{font-family:"Hanken Grotesk",sans-serif;font-weight:700;font-size:12px;color:var(--pink)}' +
      '.hsitem[open]>summary .hsbody{display:none}.hsitem[open]>summary .hsedit{color:var(--faint)}.hsitem .hsrow{border:none;padding:10px 0 0}' +
      '.hsrow .hstwo{display:grid;grid-template-columns:2fr 1fr;gap:4px 12px}.hsrow textarea{min-height:120px}' +
      '.hsacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}' +
      '.hsbody{white-space:pre-wrap;font-size:12.5px;color:var(--muted);line-height:1.5;margin-top:6px;max-height:7.5em;overflow:hidden}' +
      /* the report and the help words editor, unchanged */
      '.hdcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}' +
      '.hdrep{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:12px}' +
      '.hdrep table{min-width:0}.hdrep .panel .lblk{margin:14px 14px 4px}' +
      '.hdstats{grid-template-columns:repeat(4,1fr)}@media (max-width:700px){.hdstats{grid-template-columns:repeat(2,1fr)}}' +
      '.hwrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start;padding:12px 0;border-bottom:1px solid var(--line-2)}.hwrow:last-child{border-bottom:none}' +
      '.hwacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}' +
      '.hwchk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.hwchk input{width:auto}' +
      '.hwsteps{margin:10px 0 0 0;padding-left:14px;border-left:2px solid var(--line)}' +
      '.hwstat{font-size:11.5px;color:var(--faint);white-space:nowrap}.hwhide{opacity:.55}' +
      '.hwnum{font-family:JetBrains Mono,monospace;color:var(--faint);font-size:12px;margin-right:6px}' +
      '.hwtwo{display:grid;grid-template-columns:2fr 1fr;gap:4px 12px}.hwfaqadd{display:grid;grid-template-columns:1fr 2fr auto;gap:8px;margin-top:12px}' +
      '@media (max-width:700px){.hwrow{grid-template-columns:1fr}.hwacts{justify-content:flex-start}.hwtwo,.hwfaqadd{grid-template-columns:1fr}.hwsteps{padding-left:10px}' +
        '.hsrow{grid-template-columns:1fr}.hsacts{justify-content:flex-start}.hsrow .hstwo{grid-template-columns:1fr}' +
        /* a thumb's worth, whatever font has loaded (39 px without the web fonts, 29 Oct 2026) */
        '.hdacts .btn,.hdpick select,.vphd .vphdh .btn{min-height:44px}' +
        '#hdRows .hdrow{padding:12px 14px}.hdacts .btn{flex:1 1 auto}.hdhead .sp{margin-left:0}' +
        '.hdhead>.btn{padding:8px 12px;font-size:12.5px}.hdsegs button{padding:7px 12px}}' +
      /* a venue's own tickets, in that venue's HQ details (Dean, 29 Oct 2026) */
      '.vphd{margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)}.vphd .vphdh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}' +
      '.vphd .vphdh .btn{margin-left:auto}.vphd .lblk{margin:10px 0 2px}.vphd .hdpast{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:40px}' +
      '.vphd .hdpast .subj{flex:1 1 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff}.vphd .hdpast .age{color:var(--faint);font-size:11.5px;white-space:nowrap}' +
      '.vphd .vphdnone{font-size:12.5px;color:var(--faint);padding:6px 0}' +
      '#paneHelpdesk .filterbar select{min-width:0;width:auto;padding-right:34px}#paneHelpdesk .filterbar input[type=date]{width:150px}' +
      '</style>' +
      '<div class="hdhead">' +
        '<div class="hdsegs" id="hdSecs" style="margin:0">' +
          '<button data-sec="tickets" class="on">Tickets</button><button data-sec="replies">Saved replies</button>' +
          '<button data-sec="report">Report</button><button data-sec="words">Help words</button></div>' +
        '<button class="btn ghost sp" id="hdLogCall">+ Log a call</button>' +
        '<button class="btn ghost" id="hdAlert">Alerts on this device</button>' +
      '</div>' +
      '<div class="panel pad hidden" id="hdAlertBox" style="margin-bottom:14px"></div>' +
      '<div class="panel pad hidden" id="hdCallBox" style="margin-bottom:14px"></div>' +

      /* TICKETS */
      '<div id="hdSecTickets">' +
        '<div id="hdListWrap">' +
          '<div class="hdok hidden" id="hdDone"></div>' +
          '<div class="hdsegs" id="hdViews">' + VIEWS.map(function (v) { return '<button data-view="' + v[0] + '"' + (v[0] === "needs" ? ' class="on"' : "") + ">" + v[1] + ' <span class="n" data-n="' + v[0] + '">0</span></button>'; }).join("") + "</div>" +
          '<div class="panel pad" style="margin-bottom:12px">' +
            '<div class="hdsearch">' +
              '<input type="search" id="hdfQ" placeholder="Search a name, email, subject, venue or number" autocomplete="off">' +
              '<select id="hdfBrand">' + opts(BR, "Both brands") + "</select>" +
              '<button class="mini" id="hdfMore" type="button">More filters</button>' +
            "</div>" +
            '<div class="hdmore hidden" id="hdfMoreBox">' +
              '<select id="hdfCat">' + opts(CAT, "Any kind") + "</select>" +
              '<select id="hdfCh">' + opts(CH, "Came in any way") + "</select>" +
              '<select id="hdfVenue"><option value="">Any venue</option></select>' +
              '<label class="hdf">From <input type="date" id="hdfFrom"></label><label class="hdf">to <input type="date" id="hdfTo"></label>' +
            "</div>" +
          "</div>" +
          '<div class="panel"><div id="hdRows"><div class="hdempty">Loading...</div></div></div>' +
        "</div>" +
        '<div class="hidden" id="hdTicket"></div>' +
      "</div>" +

      /* SAVED REPLIES */
      '<div id="hdSecReplies" class="hidden"><div id="hsBox"><div class="note">Opening...</div></div></div>' +

      /* REPORT */
      '<div id="hdSecReport" class="hidden">' +
      '<div class="panel pad"><div class="filterbar">' +
        '<label class="hdf">From <input type="date" id="hdrFrom" value="' + monthAgo + '"></label>' +
        '<label class="hdf">to <input type="date" id="hdrTo" value="' + today + '"></label>' +
        '<select id="hdrBrand">' + opts(BR, "Both brands") + '</select>' +
        '<button class="btn pink" id="hdrGo">Run report</button>' +
        '<button class="btn ghost" id="hdrCsv" disabled>Download CSV</button>' +
      '</div><div class="note" style="margin-top:9px">Tickets that arrived in these dates. Time to close counts the ones of those that are closed. The CSV has no names or email addresses in it.</div></div>' +
      '<div id="hdReport"></div></div>' +

      /* HELP WORDS */
      '<div id="hdSecWords" class="hidden">' +
      '<div class="panel pad"><div class="filterbar">' +
        '<select id="hwSet"><option value="venueplay:patron">VenuePlay players</option><option value="venueplay:venue">VenuePlay venues</option>' +
        '<option value="partyplay:guest">PartyPlay guests</option><option value="partyplay:host">PartyPlay hosts</option></select>' +
        '<button class="btn pink" id="hwGo">Open</button>' +
      '</div><div class="note" style="margin-top:9px">What the Help panel shows, for each brand and who is asking. Changes show on phones straight away. ' +
        'Steps move themselves up when they fix more, once each has about 20 answers; a pinned step stays where it is.</div></div>' +
      '<div id="hwBox"></div></div>';
    host.appendChild(p);
    $("hdSecs").addEventListener("click", function (e) { var b = e.target.closest("button[data-sec]"); if (b) section(b.getAttribute("data-sec")); });
    $("hdViews").addEventListener("click", function (e) { var b = e.target.closest("button[data-view]"); if (!b) return; S.view = b.getAttribute("data-view"); draw(); });
    $("hdfQ").addEventListener("input", function () { S.q = this.value; draw(); });
    $("hdfMore").addEventListener("click", function () { var m = $("hdfMoreBox"); m.classList.toggle("hidden"); this.textContent = m.classList.contains("hidden") ? "More filters" : "Fewer filters"; });
    ["hdfBrand", "hdfCat", "hdfCh", "hdfVenue", "hdfFrom", "hdfTo"].forEach(function (id) { $(id).addEventListener("change", load); });
    $("hdRows").addEventListener("click", function (e) { var r = e.target.closest("[data-id]"); if (r) openTicket(r.getAttribute("data-id"), null, true); });
    $("hdLogCall").addEventListener("click", logCallForm);
    $("hdAlert").addEventListener("click", alertForm);
    $("hdrGo").addEventListener("click", report);
    $("hdrCsv").addEventListener("click", csv);
    $("hwGo").addEventListener("click", editorLoad);
    /* The phone's Back button leaves a ticket for the list, not HQ for the last page. */
    root.addEventListener("popstate", function () { if (S.open && !/^#help-\d+$/.test(root.location.hash || "")) backToList(true); });
  }
  function section(name) {
    Array.prototype.forEach.call($("hdSecs").querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-sec") === name); });
    $("hdSecTickets").classList.toggle("hidden", name !== "tickets");
    $("hdSecReplies").classList.toggle("hidden", name !== "replies");
    $("hdSecReport").classList.toggle("hidden", name !== "report");
    $("hdSecWords").classList.toggle("hidden", name !== "words");
    if (name === "replies") repliesLoad(true);
  }

  function filters() {
    // Status is not asked for: every status comes back, so each chip can show its count.
    return { brand: $("hdfBrand").value, status: "", category: $("hdfCat").value, channel: $("hdfCh").value,
             venue_id: $("hdfVenue").value, from: $("hdfFrom").value, to: $("hdfTo").value, with_venues: !S.allVenues };
  }
  function load() {
    var rows = $("hdRows"); if (!rows) return;
    VCACHE = {};   // the desk changed something: a venue's details asks again next time it draws
    post("/admin/help/list", filters()).then(function (j) {
      if (j.error) { rows.innerHTML = '<div class="hdempty">' + hdEsc(j.error) + "</div>"; return; }
      S.all = j.tickets || []; S.venues = j.venues || {}; S.assignees = j.assignees || [];
      if (j.all_venues) { S.allVenues = j.all_venues; var sel = $("hdfVenue"), keep = sel.value;
        sel.innerHTML = '<option value="">Any venue</option>' + S.allVenues.map(function (v) { return '<option value="' + hdEsc(v.id) + '">' + hdEsc(v.name) + "</option>"; }).join(""); sel.value = keep; }
      draw();
    });
    badge();
    repliesLoad(false);
  }
  function inView(t, v) { var def = VIEWS.filter(function (x) { return x[0] === v; })[0]; return !def || !def[2] || def[2].indexOf(t.status) !== -1; }
  function placeOf(t) { return S.venues[t.venue_id] || (t.room_code ? (t.brand === "partyplay" ? "Party " : "Room ") + t.room_code : ""); }
  function matches(t, q) {
    if (!q) return true;
    q = q.toLowerCase().replace(/^#/, "");
    return [t.ticket_no, t.subject, t.contact_name, t.contact_email, t.contact_phone, placeOf(t), t.room_code].some(function (x) { return x != null && String(x).toLowerCase().indexOf(q) !== -1; });
  }
  function draw() {
    var rows = $("hdRows"); if (!rows) return;
    VIEWS.forEach(function (v) {
      var n = S.all.filter(function (t) { return inView(t, v[0]); }).length, el = doc.querySelector('[data-n="' + v[0] + '"]');
      if (el) { el.textContent = n; el.classList.toggle("hot", v[0] === "needs" && n > 0); }
    });
    Array.prototype.forEach.call($("hdViews").querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-view") === S.view); });
    var list = S.all.filter(function (t) { return inView(t, S.view) && matches(t, S.q); });
    /* Needs reply: urgent first, then the newest. Everything else: the most recently touched first. */
    list.sort(function (a, b) {
      if (S.view === "needs") { var u = (b.priority === "urgent") - (a.priority === "urgent"); if (u) return u; return String(b.created_at).localeCompare(String(a.created_at)); }
      return String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at));
    });
    var none = { needs: "Nothing needs a reply. Nice work.", waiting: "Nobody owes us a reply.", closed: "No closed tickets in these filters.", all: "No tickets match." }[S.view];
    rows.innerHTML = list.length ? list.map(function (t) {
      var st = { "new": "gold", open: "gold", waiting: "indep", closed: "idle" }[t.status] || "idle";
      var bits = [];
      if (t.contact_name) bits.push(hdEsc(t.contact_name));
      if (placeOf(t)) bits.push(hdEsc(placeOf(t)));
      return '<div class="hdrow' + (t.priority === "urgent" && t.status !== "closed" ? " urg" : "") + '" data-id="' + hdEsc(t.id) + '" role="button" tabindex="0">' +
        '<div style="min-width:0"><div class="t1"><span class="no">#' + t.ticket_no + '</span><span class="subj">' + hdEsc(t.subject || "(no subject)") + "</span></div>" +
        '<div class="t2">' + bits.join(" &middot; ") + (bits.length ? " " : "") +
          '<span class="badge hdbrand ' + (t.brand === "partyplay" ? "pp" : "grouped") + '">' + hdEsc(BR[t.brand] || t.brand) + "</span>" +
          '<span class="vn">' + hdEsc(catLabel(t.category, t.brand)) + "</span>" +
          (t.priority === "urgent" ? '<span class="badge urgent">Urgent</span>' : "") + "</div></div>" +
        '<div class="side"><span class="badge ' + st + '">' + hdEsc(t.status === "new" ? "New" : ST[t.status] || t.status) + '</span><span title="' + hdEsc(when(t.created_at)) + '">' + hdEsc(ago(t.created_at)) + "</span></div></div>";
    }).join("") : '<div class="hdempty">' + hdEsc(S.q ? "No tickets match that search." : none) + "</div>";
  }
  function done(msg) { var d = $("hdDone"); if (!d) return; d.textContent = msg; d.classList.toggle("hidden", !msg); }
  function backToList(fromPop) {
    S.open = null;
    $("hdTicket").classList.add("hidden"); $("hdTicket").innerHTML = "";
    $("hdListWrap").classList.remove("hidden");
    if (!fromPop && /^#help-\d+$/.test(root.location.hash || "")) { try { root.history.replaceState(null, "", root.location.pathname + root.location.search + "#helpdesk"); } catch (e) {} }
    draw();
    try { root.scrollTo(0, $("paneHelpdesk").getBoundingClientRect().top + root.pageYOffset - 70); } catch (e) {}
  }

  /* ---- one ticket ---- */
  function openTicket(id, no, fromList) {
    section("tickets"); done("");
    var box = $("hdTicket"); box.classList.remove("hidden"); $("hdListWrap").classList.add("hidden");
    box.innerHTML = '<div class="panel pad"><div class="note" style="margin:0">Opening...</div></div>';
    post("/admin/help/get", no ? { ticket_no: no } : { id: id }).then(function (j) {
      if (j.error) { box.innerHTML = '<div class="panel pad"><button class="mini" id="hdBack">Back to tickets</button><div class="note">' + hdEsc(j.error) + "</div></div>"; $("hdBack").addEventListener("click", function () { backToList(false); }); return; }
      var t = j.ticket; S.open = t;
      if (fromList) { try { root.history.pushState({ hd: t.ticket_no }, "", "#help-" + t.ticket_no); } catch (e) {} }
      var known = (S.allVenues || []).filter(function (v) { return v.id === t.venue_id; })[0] || {};
      var ctx = { venue_name: j.venue_name || known.name || S.venues[t.venue_id] || "", venue_slug: j.venue_slug || known.slug || "" };
      var from = t.category === "accounts" ? "accounts@" : (t.category === "venue_support" || t.category === "patron_support") ? "support@" : "hello@";
      from += t.brand + ".com.au";
      var st = { "new": "gold", open: "gold", waiting: "indep", closed: "idle" }[t.status] || "idle";
      function fld(label, html) { return '<div class="field"><label>' + label + "</label>" + html + "</div>"; }
      var KIND = { note: "Note, only HQ sees it", reply: "You emailed them", email_in: "They wrote" };
      var history = (j.notes || []).map(function (n) {
        if (n.kind === "change") return '<div class="hdnote change">' + hdEsc(n.body) + ' <span class="k">&middot; ' + hdEsc(when(n.created_at)) + "</span></div>";
        return '<div class="hdnote ' + hdEsc(n.kind) + '"><div class="k">' + hdEsc(KIND[n.kind] || n.kind) + " &middot; " + hdEsc(n.author || "") + " &middot; " + hdEsc(when(n.created_at)) + "</div>" + hdEsc(n.body) + "</div>";
      }).join("");
      var email = String(t.contact_email || "").toLowerCase();
      var past = S.all.filter(function (x) { return x.id !== t.id && ((email && String(x.contact_email || "").toLowerCase() === email) || (t.venue_id && x.venue_id === t.venue_id)); })
        .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 6);
      var aud = audienceFor(t), mine = repliesFor(t);
      box.innerHTML =
        '<div class="hdhead"><button class="mini" id="hdBack">Back to tickets</button></div>' +
        '<div class="cxhead"><span class="badge hdbrand ' + (t.brand === "partyplay" ? "pp" : "grouped") + '">' + hdEsc(BR[t.brand]) + "</span>" +
          '<span class="cxname">#' + t.ticket_no + " " + hdEsc(t.subject) + "</span>" +
          '<span class="badge ' + st + '">' + hdEsc(ST[t.status] || t.status) + "</span>" +
          (t.priority === "urgent" ? '<span class="badge urgent">Urgent</span>' : "") + "</div>" +
        '<div class="hdtk"><div>' +
          (t.contact_email_pending ? '<div class="restrict" id="hdPending" style="margin:0 0 12px">They asked for replies to go to <b>' + hdEsc(t.contact_email_pending) + "</b>. Nothing has been sent there. " +
            '<button class="mini" id="hdUsePending">Use ' + hdEsc(t.contact_email_pending) + '</button> <button class="mini" id="hdKeepContact">Keep ' + hdEsc(t.contact_email || "the original") + "</button></div>" : "") +
          '<div class="panel pad">' +
            '<div class="hdmsg"><div class="k">They wrote &middot; ' + hdEsc(CH[t.channel] || t.channel) + " &middot; " + hdEsc(when(t.created_at)) + "</div>" + hdEsc(t.message || "(no message)") + "</div>" +
            '<div id="hdNotes">' + history + "</div>" +
          "</div>" +
          '<div class="panel pad hdcomp" style="margin-top:12px">' +
            '<div class="hdsegs" id="hdMode"><button data-mode="reply" class="on">Reply to them</button><button data-mode="note">Internal note</button></div>' +
            '<div id="hdReplyBox">' +
              (t.contact_email ? "" : '<div class="restrict" style="margin:0 0 10px">No email address on this ticket, so there is nobody to reply to. Add a note, or close it.</div>') +
              '<div class="hdpick"><select id="hdtPick"' + (t.contact_email ? "" : " disabled") + '><option value="">Use a saved reply...</option>' +
                mine.map(function (r, i) { return '<option value="' + i + '">' + hdEsc(r.title) + "</option>"; }).join("") + "</select></div>" +
              '<textarea id="hdtReply" placeholder="Type your reply, or pick a saved reply above"' + (t.contact_email ? "" : " disabled") + "></textarea>" +
              '<div class="hdhint">' + (t.contact_email ? "Goes to " + hdEsc(t.contact_email) + " from " + hdEsc(from) + ", signed with your name." : "") +
                (phoneOk(t) ? "" : " This is a " + (t.brand === "partyplay" ? "PartyPlay" : "player") + " ticket, so the support phone line cannot go in it.") + "</div>" +
              '<div class="hdacts"><button class="btn pink" id="hdtReplyClose"' + (t.contact_email && t.status !== "closed" ? "" : " disabled") + ">Send and close</button>" +
                '<button class="btn ghost" id="hdtReplyGo"' + (t.contact_email ? "" : " disabled") + ">Send</button></div>" +
            "</div>" +
            '<div id="hdNoteBox" class="hidden"><textarea id="hdtNote" placeholder="Only HQ sees this"></textarea>' +
              '<div class="hdacts"><button class="btn ghost" id="hdtNoteGo">Add note</button></div></div>' +
            '<div class="errflash" id="hdtMsg"></div>' +
            '<div class="hdquick">' +
              (t.status === "closed" ? '<button class="mini" id="hdReopen">Reopen</button>' : '<button class="mini" id="hdCloseT">Close ticket without replying</button>') +
              (t.status !== "waiting" && t.status !== "closed" ? '<button class="mini" id="hdWaitT">Waiting on them</button>' : "") +
            "</div>" +
          "</div>" +
          '<details class="panel pad hddet" style="margin-top:12px"><summary>Ticket details</summary><div class="hdgrid">' +
            fld("Status", '<select id="hdtStatus">' + opts(ST) + "</select>") +
            fld("Kind", '<select id="hdtCat">' + Object.keys(CAT).map(function (k) { return '<option value="' + k + '">' + hdEsc(catLabel(k, t.brand)) + "</option>"; }).join("") + "</select>") +
            fld("Priority", '<select id="hdtPri"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>') +
            fld("Brand", '<select id="hdtBrand">' + opts(BR) + "</select>") +
            fld("Who has it", '<input type="text" id="hdtWho" list="hdWhoList" placeholder="Nobody yet" value="' + hdEsc(t.assigned_to || "") + '"><datalist id="hdWhoList">' + S.assignees.map(function (a) { return '<option value="' + hdEsc(a) + '">'; }).join("") + "</datalist>") +
            '<div class="field"><button class="btn pink" id="hdtSave" style="width:100%">Save changes</button></div>' +
          "</div></details>" +
        "</div>" +
        '<div class="hdside"><div class="panel pad">' +
          '<div class="lblk">Who</div><div class="hdwho"><b>' + hdEsc(t.contact_name || "No name given") + "</b>" +
            (t.contact_email ? '<br><a href="mailto:' + hdEsc(t.contact_email) + '">' + hdEsc(t.contact_email) + "</a>" : "") +
            (t.contact_typed ? ' <span class="badge gold" title="HQ typed this address in; the customer did not give it in writing">typed by HQ</span>' : "") +
            (t.contact_phone ? '<br><a href="tel:' + hdEsc(String(t.contact_phone).replace(/[^\d+]/g, "")) + '">' + hdEsc(t.contact_phone) + "</a>" : "") +
            (ctx.venue_name ? "<br>" + hdEsc(ctx.venue_name) : "") + (t.room_code ? "<br>" + (t.brand === "partyplay" ? "Party " : "Room ") + hdEsc(t.room_code) : "") +
            (t.source_address ? '<br><span style="color:var(--faint)">Sent to ' + hdEsc(t.source_address) + "</span>" : "") +
            '<br><span style="color:var(--faint)">' + hdEsc(catLabel(t.category, t.brand)) + " &middot; " + hdEsc(CH[t.channel] || t.channel) + "</span></div>" +
          '<div class="lblk">Their other tickets</div><div id="hdPast">' + (past.length ? past.map(function (x) {
            return '<button class="hdpast" data-no="' + x.ticket_no + '"><span class="no">#' + x.ticket_no + "</span>" + hdEsc(x.subject || "") + ' <span class="badge ' + ({ "new": "gold", open: "gold", waiting: "indep", closed: "idle" }[x.status] || "idle") + '">' + hdEsc(ST[x.status] || x.status) + "</span></button>";
          }).join("") : '<div class="note" style="margin:0">None.</div>') + "</div>" +
        "</div></div>" +
        "</div>";
      $("hdtStatus").value = t.status; $("hdtCat").value = t.category; $("hdtPri").value = t.priority; $("hdtBrand").value = t.brand;
      $("hdBack").addEventListener("click", function () { if (root.history.state && root.history.state.hd) { try { root.history.back(); return; } catch (e) {} } backToList(false); });
      $("hdPast").addEventListener("click", function (e) { var b = e.target.closest("[data-no]"); if (b) openTicket(null, b.getAttribute("data-no"), true); });
      $("hdMode").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-mode]"); if (!b) return; var m = b.getAttribute("data-mode");
        Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
        $("hdReplyBox").classList.toggle("hidden", m !== "reply"); $("hdNoteBox").classList.toggle("hidden", m !== "note");
      });
      function say(m) { var e = $("hdtMsg"); e.textContent = m; e.classList.toggle("show", !!m); }
      /* The reply box grows to fit what is in it (a saved reply is a dozen lines), up to most of a screen. */
      function fit(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 4, Math.max(260, Math.round(root.innerHeight * 0.7))) + "px"; }
      $("hdtReply").addEventListener("input", function () { fit(this); });
      /* A saved reply goes in where the cursor is, filled from this ticket, ready to change. */
      $("hdtPick").addEventListener("change", function () {
        var r = mine[+this.value]; this.value = ""; if (!r) return;
        var ta = $("hdtReply"), text = fillReply(r.body, t, ctx);
        var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
        var pre = ta.value.slice(0, a), post2 = ta.value.slice(b);
        ta.value = pre + (pre && !/\n\s*$/.test(pre) ? "\n\n" : "") + text + post2;
        fit(ta); ta.focus(); say("");
        var left = FILLIN.exec(ta.value); if (left) say("Fill in " + left[0] + " before sending.");
      });
      function update(patch, then) {
        post("/admin/help/update", Object.assign({ id: t.id }, patch)).then(function (r) { if (r.error) say(r.error); else then(); });
      }
      $("hdtSave").addEventListener("click", function () {
        update({ status: $("hdtStatus").value, category: $("hdtCat").value, priority: $("hdtPri").value, brand: $("hdtBrand").value, assigned_to: $("hdtWho").value },
          function () { openTicket(t.id); load(); });
      });
      function after(msg) { done(msg); load(); if (root.history.state && root.history.state.hd) { try { root.history.back(); return; } catch (e) {} } backToList(false); }
      if ($("hdCloseT")) $("hdCloseT").addEventListener("click", function () { update({ status: "closed" }, function () { after("Ticket " + t.ticket_no + " closed."); }); });
      if ($("hdReopen")) $("hdReopen").addEventListener("click", function () { update({ status: "open" }, function () { openTicket(t.id); load(); }); });
      if ($("hdWaitT")) $("hdWaitT").addEventListener("click", function () { update({ status: "waiting" }, function () { after("Ticket " + t.ticket_no + " is waiting on them."); }); });
      $("hdtNoteGo").addEventListener("click", function () {
        post("/admin/help/note", { id: t.id, body: $("hdtNote").value }).then(function (r) { if (r.error) say(r.error); else openTicket(t.id); });
      });
      /* A reply to an address HQ typed in: the Worker asks for that exact address to be confirmed
         (unless the owner is sending). The question is asked here, on the page, never in a native
         dialog, which can freeze a tab. */
      function sendReply(confirmTo, close) {
        var text = $("hdtReply").value;
        var left = FILLIN.exec(text); if (left) { say("Fill in " + left[0] + " before sending."); return; }
        if (!phoneOk(t) && hasPhone(text)) { say("The support line is for venues only. Take the phone number out of this reply before sending."); return; }
        var b = $(close ? "hdtReplyClose" : "hdtReplyGo"), label = b.textContent; b.disabled = true; b.textContent = "Sending...";
        var body = { id: t.id, body: $("hdtReply").value }; if (confirmTo) body.confirm_to = confirmTo;
        if (close) body.close = true;
        post("/admin/help/reply", body).then(function (r) {
          b.disabled = false; b.textContent = label;
          if (r.confirm_needed) {
            var box2 = $("hdConfirm") || doc.createElement("div"); box2.id = "hdConfirm"; box2.className = "restrict";
            box2.innerHTML = hdEsc(r.error) + '<br><b>' + hdEsc(r.address) + '</b> <button class="btn pink" id="hdConfirmGo" style="padding:7px 12px;margin-left:8px">Yes, send it to this address</button>';
            $("hdtReplyGo").parentNode.appendChild(box2);
            $("hdConfirmGo").addEventListener("click", function () { box2.parentNode.removeChild(box2); sendReply(r.address, close); });
            return;
          }
          if (r.error) { say(r.error); return; }
          /* An older Worker does not know "close": it answers waiting, and the close is asked for on its own. */
          if (close && r.status !== "closed") update({ status: "closed" }, function () { after("Sent, and ticket " + t.ticket_no + " closed."); });
          else if (close) after("Sent, and ticket " + t.ticket_no + " closed.");
          else after("Sent to " + t.contact_email + ". Ticket " + t.ticket_no + " is now waiting on them.");
        });
      }
      $("hdtReplyGo").addEventListener("click", function () { sendReply(null, false); });
      $("hdtReplyClose").addEventListener("click", function () { sendReply(null, true); });
      function pending(use) {
        post("/admin/help/contact", { id: t.id, use: use }).then(function (r) { if (r.error) say(r.error); else openTicket(t.id); });
      }
      if ($("hdUsePending")) { $("hdUsePending").addEventListener("click", function () { pending(true); }); $("hdKeepContact").addEventListener("click", function () { pending(false); }); }
      badge();
      try { root.scrollTo(0, $("paneHelpdesk").getBoundingClientRect().top + root.pageYOffset - 70); } catch (e) {}
    });
  }

  /* ---- saved replies ---- */
  function repliesFor(t) {
    var aud = audienceFor(t), list = S.replies || SEED;
    return list.filter(function (r) { return (r.audience === aud || r.audience === "any") && (phoneOk(t) || !hasPhone(r.body)); });
  }
  /* The list comes from the Worker when migration 126 has run; until then (or on an older Worker,
     which has no such route) the starter set in this file is used, and editing says why not. */
  function repliesLoad(draw2) {
    post("/admin/help/replies/list", {}).then(function (j) {
      if (!j.error && !j.missing && Array.isArray(j.replies)) { S.replies = j.replies; S.repliesStored = true; S.repliesWhy = ""; }
      else { S.replies = null; S.repliesStored = false;
        S.repliesWhy = j.missing ? "Migration 126 has not been run yet." : j.notThere ? "The billing Worker does not have saved replies yet." : (j.error || ""); }
      if (draw2 || !$("hdSecReplies").classList.contains("hidden")) repliesDraw();
    });
  }
  function repliesDraw() {
    var box = $("hsBox"), list = S.replies || SEED, can = S.repliesStored;
    var groups = ["venue", "player", "partyplay", "any"].map(function (a) {
      var rows = list.filter(function (r) { return r.audience === a; });
      if (!rows.length) return "";
      return '<div class="lblk">' + hdEsc(AUD[a]) + '</div><div class="panel pad">' + rows.map(function (r) {
        var id = r.id || r.key;
        if (!can) return '<div class="hsitem"><b style="color:#fff">' + hdEsc(r.title) + '</b><div class="hsbody">' + hdEsc(r.body) + "</div></div>";
        /* Folded to its name and first lines; a tap opens the editor. */
        return '<details class="hsitem"><summary><div><b>' + hdEsc(r.title) + '</b><div class="hsbody">' + hdEsc(r.body) + '</div></div><span class="hsedit">Edit</span></summary>' +
          '<div class="hsrow" data-reply="' + hdEsc(id) + '"><div>' +
          '<div class="hstwo"><div class="field"><label>Name, as the picker shows it</label><input type="text" data-f="title" maxlength="80" value="' + hdEsc(r.title) + '"></div>' +
          '<div class="field"><label>Offered on</label><select data-f="audience">' + Object.keys(AUD).map(function (k) { return '<option value="' + k + '"' + (k === r.audience ? " selected" : "") + ">" + hdEsc(AUD[k]) + "</option>"; }).join("") + "</select></div></div>" +
          '<div class="field"><label>Words</label><textarea data-f="body">' + hdEsc(r.body) + "</textarea></div></div>" +
          '<div class="hsacts"><button class="mini" data-hs="move" data-id="' + hdEsc(id) + '" data-dir="up" title="Move up">&#8593;</button>' +
          '<button class="mini" data-hs="move" data-id="' + hdEsc(id) + '" data-dir="down" title="Move down">&#8595;</button>' +
          '<button class="mini" data-hs="delete" data-id="' + hdEsc(id) + '">Delete</button>' +
          '<button class="btn pink" data-hs="save" data-id="' + hdEsc(id) + '" style="padding:8px 14px">Save</button></div></div></details>';
      }).join("") + "</div>";
    }).join("");
    box.innerHTML =
      '<div class="panel pad"><div class="note" style="margin:0">Ready-made replies to drop into a ticket and change before sending. ' +
        "In a ticket, only the ones for that kind of customer are offered. These fill themselves in from the ticket: " +
        "<b>{first_name}</b>, <b>{venue}</b>, <b>{ticket_no}</b>, <b>{tv_link}</b> and <b>{party_code}</b>. " +
        "Your name and our details are added under every reply, so end with a sign-off like Cheers. The support phone line can only go in a reply for venues.</div>" +
        (can ? "" : '<div class="restrict" id="hsNotYet">These are the starter replies, built in. ' + hdEsc(S.repliesWhy) + " Once it is, you can add, change, delete and reorder them here.</div>") +
      "</div>" + groups +
      (can ? '<div class="lblk">Add a saved reply</div><div class="panel pad"><div class="hsrow" style="border:none;padding:0"><div>' +
        '<div class="hstwo"><div class="field"><label>Name, as the picker shows it</label><input type="text" id="hsNewTitle" maxlength="80" placeholder="e.g. Raffle prize question"></div>' +
        '<div class="field"><label>Offered on</label><select id="hsNewAud">' + opts(AUD) + "</select></div></div>" +
        '<div class="field"><label>Words</label><textarea id="hsNewBody" placeholder="Hi {first_name},"></textarea></div></div>' +
        '<div class="hsacts"><button class="btn pink" data-hs="add" style="padding:8px 14px">+ Add saved reply</button></div></div></div>' : "") +
      '<div class="errflash" id="hsMsg"></div>';
    /* Each editor's box is as tall as its words when it opens. */
    Array.prototype.forEach.call(box.querySelectorAll("details.hsitem"), function (d) {
      d.addEventListener("toggle", function () { var ta = d.querySelector("textarea"); if (d.open && ta) { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 4) + "px"; } });
    });
  }
  function hsSay(m) { var n = $("hsMsg"); if (n) { n.textContent = m; n.classList.toggle("show", !!m); } }
  doc.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-hs]"); if (!t || !$("hsBox") || !$("hsBox").contains(t)) return;
    var act = t.getAttribute("data-hs"), id = t.getAttribute("data-id"), req;
    function f(row, k) { var x = row.querySelector('[data-f="' + k + '"]'); return x ? x.value : ""; }
    if (act === "save") { var row = t.closest("[data-reply]"); req = post("/admin/help/replies/save", { id: id, title: f(row, "title"), audience: f(row, "audience"), body: f(row, "body") }); }
    else if (act === "add") req = post("/admin/help/replies/save", { title: $("hsNewTitle").value, audience: $("hsNewAud").value, body: $("hsNewBody").value });
    else if (act === "move") req = post("/admin/help/replies/move", { id: id, dir: t.getAttribute("data-dir") });
    else if (act === "delete") {
      /* Two taps, on the page: never a native dialog, which can freeze a tab. */
      if (t.getAttribute("data-sure") !== "1") { t.setAttribute("data-sure", "1"); t.textContent = "Tap again to delete"; t.classList.add("urgent"); return; }
      req = post("/admin/help/replies/delete", { id: id });
    }
    if (!req) return;
    t.disabled = true; hsSay("");
    req.then(function (r) { t.disabled = false; if (r.error) { hsSay(r.error); return; } repliesLoad(true); });
  });

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

  /* ---- a venue's own tickets, in HQ > Venues > Details (Dean, 29 Oct 2026) ----
     hq.html leaves <div class="vphd" data-vphd="VENUE ID"> in the open venue's details and calls
     VPHelpdesk.venueTickets(id) after every draw. Open ones first (urgent, then newest) with their
     status and age; then the last few closed. A tap opens that ticket in the help desk; "New ticket
     for this venue" opens Log a call with the venue already picked. The Worker's own list route,
     filtered to the venue (HQ only, like the rest of the desk). Kept 20 seconds, because HQ redraws
     the venues table on every change and must not ask the Worker each time. */
  var VCACHE = {};
  function venueTickets(vid) {
    var el = doc.querySelector('[data-vphd="' + String(vid).replace(/"/g, "") + '"]'); if (!el) return;
    var c = VCACHE[vid];
    if (c && Date.now() - c.at < 20000) { drawVenue(el, vid, c.j); return; }
    if (!el.innerHTML) el.innerHTML = '<div class="vphdh"><b>Help desk</b></div><div class="vphdnone">Looking for tickets...</div>';
    post("/admin/help/list", { venue_id: vid, status: "" }).then(function (j) {
      if (!j.error) VCACHE[vid] = { at: Date.now(), j: j };
      var now = doc.querySelector('[data-vphd="' + String(vid).replace(/"/g, "") + '"]'); if (now) drawVenue(now, vid, j);
    });
  }
  function drawVenue(el, vid, j) {
    var head = '<div class="vphdh"><b>Help desk</b><button class="btn ghost" data-vphdnew="' + hdEsc(vid) + '">New ticket for this venue</button></div>';
    if (j.error) { el.innerHTML = head + '<div class="vphdnone">' + hdEsc(j.error) + "</div>"; return; }
    /* Dean's spec: each row is the number, what it was about, the date and the status, nothing else.
       Open ones first, then the latest few closed; newest first within each. */
    var all = (j.tickets || []).filter(function (t) { return t.venue_id === vid; });
    function newest(a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }
    var open = all.filter(function (t) { return t.status !== "closed"; }).sort(newest);
    var past = all.filter(function (t) { return t.status === "closed"; }).sort(newest);
    function day(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }); }
    function row(t) {
      var st = { "new": "gold", open: "gold", waiting: "indep", closed: "idle" }[t.status] || "idle";
      return '<button class="hdpast" data-vphdno="' + t.ticket_no + '"><span class="no">#' + t.ticket_no + '</span><span class="subj">' + hdEsc(t.subject || "(no subject)") + "</span>" +
        '<span class="age">' + hdEsc(day(t.created_at)) + '</span><span class="badge ' + st + '">' + hdEsc(t.status === "new" ? "New" : ST[t.status] || t.status) + "</span></button>";
    }
    var rows = open.concat(past.slice(0, 5));
    el.innerHTML = head + (rows.length ? rows.map(row).join("") : '<div class="vphdnone">No tickets for this venue yet.</div>') +
      (past.length > 5 ? '<div class="vphdnone">Showing the latest 5 of ' + past.length + " closed tickets.</div>" : "");
  }
  function venueClicks() {
    doc.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-vphdno],[data-vphdnew]"); if (!a || !a.closest(".vphd")) return;
      var tab = $("hdTab"); if (!tab) return;
      var no = a.getAttribute("data-vphdno"), vid = a.getAttribute("data-vphdnew");
      tab.click();
      if (no) { openTicket(null, no, true); return; }
      // Log a call needs the venue list, which the first load of the desk brings.
      (function ready(n) {
        if (!S.allVenues && n < 100) { setTimeout(function () { ready(n + 1); }, 100); return; }
        if (S.open) backToList(false);
        var box = $("hdCallBox"); if (!box.classList.contains("hidden")) box.classList.add("hidden");
        logCallForm();
        $("hdcBrand").value = "venueplay"; $("hdcVenue").value = vid;
        try { root.scrollTo(0, box.getBoundingClientRect().top + root.pageYOffset - 80); } catch (x) {}
        $("hdcCat").focus();
      })(0);
    });
  }
  root.VPHelpdesk = { venueTickets: venueTickets };

  /* ---- start ---- */
  function start() {
    addTab(); addPane(); venueClicks();
    // A venue's details already open when this script started: fill its tickets now.
    var pre = doc.querySelector("tr.detail:not(.hidden) [data-vphd]"); if (pre) venueTickets(pre.getAttribute("data-vphd"));
    badge(); setInterval(function () { if (!doc.hidden) badge(); }, 60000);
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) badge(); });
    // #help-1042 (from an alert email or a phone alert) opens that ticket.
    var m = /^#help-(\d+)$/.exec(root.location.hash || "");
    if (m || root.location.hash === "#helpdesk") { var tab = $("hdTab"); if (tab) tab.click(); if (m) openTicket(null, m[1]); }
    root.addEventListener("hashchange", function () {
      var h = /^#help-(\d+)$/.exec(root.location.hash || ""); if (!h || (S.open && String(S.open.ticket_no) === h[1])) return;
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
