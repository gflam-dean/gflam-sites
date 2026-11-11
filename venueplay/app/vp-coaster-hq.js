/* ============================================================================
   HQ > PROSPECTS > COASTER VENUES (Dean, 4 Nov 2026, /live-here-now v2; migration 153). Loaded by
   app/hq.html with one line, after vp-prospects-hq.js, and drawn inside its pane (#paneProspects).

   All 10,000 drink coasters carry ONE QR. A player gives a first name, picks where they are playing from
   what is in venueplay (customers, prospects and coaster venues) or types a pub that is not listed, and
   lands on that place's board. This section is where HQ sees and runs those places:
     Coaster venues (no emails)   places Dean handed coasters to: name, suburb, postcode, logo. Not a
                                  venueplay venue, no login, no email address, so nothing is ever sent
                                  to them. "Make it a normal prospect" opens hq.html's own Set up a
                                  prospect form, pre-filled and carrying the coaster id
                                  (window.hqProspectPrefill); the Worker moves the board only after the
                                  prospect is fully set up, and from then the normal emails start.
     Venues players added (possible new leads)    "Can't find your venue? Add it" (INBOX 232): name,
                                  suburb, state, website, how many asked, lead_guard's name note. HQ adds
                                  it to the picker, keeps it as a possible lead, or marks it not a venue.
                                  Never cold email from here.
     Players at venues on our list                 venues from our licensed list (not on venueplay) with play.
     Venues on venueplay with coaster play         customers and prospects (a prospect with coaster play
                                  is a lead too, Dean item 9), each with its coaster sign-up switch (OFF
                                  until HQ turns it on).
   The billing Worker answers owner and accounts only: POST /admin/coaster/list, /add, /remove, /review,
   /optins. Before
   migration 153 it answers need_migration 153 and this says "not switched on yet" in plain words.
   House rules: no em dashes, lowercase venueplay, every name escaped, nothing under 15px.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_PROSPECTS_API || "https://api.venueplay.com.au";
  var S = { data: null, loading: false, busy: false, logo: null, msg: null };

  function cqEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return doc.getElementById(id); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function where(c) { return [c.suburb, [c.postcode, c.state].filter(Boolean).join(" ")].filter(Boolean).join(", "); }
  function playText(r, d) {
    var rd = (d && d.round_days) || 30, pd = (d && d.player_days) || 7;
    if (!r.rounds_30d && !r.players_7d) return "No rounds played in the last " + rd + " days";
    return plural(r.rounds_30d || 0, "round", "rounds") + " in the last " + rd + " days, " +
      plural(r.players_7d || 0, "player", "players") + " in the last " + pd + " days";
  }
  function logoHtml(c) {
    if (!/^https:\/\//i.test(String(c.logo_url || ""))) return '<span class="cqnologo">No logo</span>';
    return '<img class="cqlogo" alt="" src="' + cqEsc(c.logo_url) + '">';
  }
  function buttonsHtml(c) {
    return '<div class="cqacts">' +
      '<button type="button" class="btn pink" data-cq-switch="' + cqEsc(c.id) + '">Make it a normal prospect</button>' +
      '<button type="button" class="btn ghost" data-cq-remove="' + cqEsc(c.id) + '">Remove</button></div>';
  }

  /* ---- one coaster venue, one lead, one venueplay venue with play ---- */
  function coasterRowHtml(c, d) {
    return '<div class="panel pad cqrow" data-cq-id="' + cqEsc(c.id) + '"><div class="cqtop">' + logoHtml(c) +
      '<div class="cqname">' + cqEsc(c.name) + '</div><span class="cqtag">No emails</span></div>' +
      '<div class="cqline">' + cqEsc(where(c) || "Postcode not known") + '</div>' +
      '<div class="cqline cqplay">' + cqEsc(playText(c, d)) + '</div>' + buttonsHtml(c) + "</div>";
  }
  /* A venue a player added: a possible new lead for review. Never emailed from here. */
  var REVIEW = { "new": "New", kept: "Kept as a possible lead" };
  function leadRowHtml(l, d) {
    var site = /^https:\/\//i.test(String(l.website || "")) ? '<a href="' + cqEsc(l.website) + '" target="_blank" rel="noopener noreferrer">' + cqEsc(String(l.website).replace(/^https:\/\//i, "")) + "</a>" : "No website given";
    return '<div class="panel pad cqrow" data-cq-id="' + cqEsc(l.id) + '"><div class="cqtop">' +
      '<div class="cqname">' + cqEsc(l.name) + '</div><span class="cqtag">' + cqEsc(REVIEW[l.review] || "New") + "</span></div>" +
      '<div class="cqline">' + cqEsc([l.suburb, l.state].filter(Boolean).join(", ") || "Suburb not known") + " &middot; " + site + "</div>" +
      '<div class="cqline cqplay">Added by ' + cqEsc(plural(l.asks || 1, "player", "players")) + "</div>" +
      (l.guard_note ? '<div class="cqline cqwarn">Check: ' + cqEsc(l.guard_note) + "</div>" : "") +
      '<div class="cqacts"><button type="button" class="btn pink" data-cq-review="list" data-cq-for="' + cqEsc(l.id) + '">Add to the picker</button>' +
      (l.review === "kept" ? "" : '<button type="button" class="btn ghost" data-cq-review="keep" data-cq-for="' + cqEsc(l.id) + '">Keep as a possible lead</button>') +
      '<button type="button" class="btn ghost" data-cq-review="dismiss" data-cq-for="' + cqEsc(l.id) + '">Not a venue</button></div></div>';
  }
  var VSTATUS = { prospect: "a prospect", customer: "a customer", left: "archived", gone: "no longer on venueplay", listed: "not on venueplay" };
  function boardRowHtml(b, d) {
    var sw = "";
    if (b.kind === "venue" && b.status !== "gone" && b.status !== "left") {
      sw = '<div class="cqline">Sign-ups for ' + cqEsc(b.name || "this venue") + ' at the end of a round: <b>' + (b.optins ? "On" : "Off") + "</b></div>" +
        '<div class="cqacts"><button type="button" class="btn ' + (b.optins ? "ghost" : "pink") + '" data-cq-optins="' + (b.optins ? "off" : "on") + '" data-cq-for="' + cqEsc(b.venue_id) + '">' +
        (b.optins ? "Switch sign-ups off" : "Switch sign-ups on") + "</button></div>";
    }
    return '<div class="panel pad cqrow"><div class="cqtop"><div class="cqname">Coaster players at ' + cqEsc(b.name || "a venue") + "</div>" +
      '<span class="cqtag cqst-' + cqEsc(b.status) + '">' + cqEsc(VSTATUS[b.status] || b.status) + "</span></div>" +
      (b.kind === "listed" ? '<div class="cqline">' + cqEsc([b.suburb, b.state].filter(Boolean).join(", ")) + ", on our venue list</div>" : "") +
      '<div class="cqline cqplay">' + cqEsc(playText(b, d)) + "</div>" + sw + "</div>";
  }
  function addFormHtml() {
    return '<div class="panel pad cqadd"><div class="cqh3">Add a coaster venue</div>' +
      '<p class="cqp">A venue you have handed coasters to. Players can pick it and it gets its own board. It is not a venueplay venue and has no email address, so nothing is ever sent to it until you make it a normal prospect.</p>' +
      '<div class="formgrid">' +
      '<div class="field"><label for="cqName">Venue name</label><input type="text" id="cqName" maxlength="120" placeholder="e.g. The Royal Hotel" autocomplete="off"></div>' +
      '<div class="field"><label for="cqSuburb">Suburb</label><input type="text" id="cqSuburb" maxlength="60" placeholder="e.g. Paddington" autocomplete="off"></div>' +
      '<div class="field"><label for="cqPostcode">Postcode</label><input type="text" id="cqPostcode" maxlength="4" inputmode="numeric" class="mono" placeholder="e.g. 4064"></div>' +
      '<div class="field"><label for="cqLogo">Logo (optional, PNG or WebP, 1MB or less)</label><input type="file" id="cqLogo" accept="image/png,image/webp"></div>' +
      "</div>" +
      '<button type="button" class="btn pink" id="cqAdd">Add coaster venue</button>' +
      '<div class="cqmsg" id="cqMsg" role="status">' + (S.msg ? cqEsc(S.msg) : "") + "</div></div>";
  }
  function sectionHtml(d) {
    var head = '<div class="cqh2">Coaster venues (no emails)</div>';
    if (!d) return head + '<p class="cqp">Loading coaster venues...</p>';
    if (d.need_migration === 153) return head + '<div class="panel pad"><p class="cqp" style="margin:0">Coaster venues are not switched on yet. They start working once migration 153 has been run.</p></div>';
    if (d.error) return head + '<div class="panel pad"><p class="cqp" style="margin:0">' + cqEsc(d.error) + "</p></div>";
    var coaster = d.coaster || [], leads = d.leads || [];
    var venues = (d.boards || []).filter(function (b) { return b.kind === "venue"; });
    var listed = (d.boards || []).filter(function (b) { return b.kind === "listed"; });
    return head + addFormHtml() +
      '<div class="cqh3">Coaster venues <span class="mono">' + coaster.length + "</span></div>" +
      (coaster.length ? '<div class="cqlist">' + coaster.map(function (c) { return coasterRowHtml(c, d); }).join("") + "</div>"
        : '<p class="cqp">None yet. Add one above when you hand a venue its coasters.</p>') +
      '<div class="cqh3">Venues players added (possible new leads) <span class="mono">' + leads.length + "</span></div>" +
      '<p class="cqp">From "Can\'t find your venue? Add it" on the coaster page. Nothing here is ever emailed or sent to cold email. Add it to the picker so players can pick it (it becomes a coaster venue, still no emails), keep it as a possible lead, or mark it not a venue.</p>' +
      (leads.length ? '<div class="cqlist">' + leads.map(function (l) { return leadRowHtml(l, d); }).join("") + "</div>"
        : '<p class="cqp">No player has added a venue yet.</p>') +
      '<div class="cqh3">Players at venues on our list, not on venueplay <span class="mono">' + listed.length + "</span></div>" +
      (listed.length ? '<div class="cqlist">' + listed.map(function (b) { return boardRowHtml(b, d); }).join("") + "</div>"
        : '<p class="cqp">No coaster rounds at venues from our list in the last ' + cqEsc(d.round_days || 30) + " days.</p>") +
      '<div class="cqh3">Venues on venueplay with coaster play <span class="mono">' + venues.length + "</span></div>" +
      (venues.length ? '<div class="cqlist">' + venues.map(function (b) { return boardRowHtml(b, d); }).join("") + "</div>"
        : '<p class="cqp">No coaster rounds at venueplay customers or prospects in the last ' + cqEsc(d.round_days || 30) + " days.</p>");
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
        if (r.status === 404 && !j.error) j.need_migration = 153;   // a Worker without these routes is not switched on either
        if (!r.ok && !j.error && !j.need_migration) j.error = "That did not go through (" + r.status + "). Try again.";
        return j;
      });
    }).catch(function () { return { error: "Could not reach the server. Try again in a minute." }; });
  }

  /* ---- the section ---- */
  var CSS = "#coasterHq{margin-top:28px;font-size:15px}" +
    "#coasterHq .cqh2{font-weight:800;font-size:18px;color:#fff;margin:0 0 12px}" +
    "#coasterHq .cqh3{font-weight:800;font-size:16px;color:#fff;margin:22px 0 10px}" +
    "#coasterHq .cqp,#coasterHq .cqline{font-size:15px;color:var(--muted);line-height:1.5;margin:0 0 12px}" +
    "#coasterHq .cqline{margin:6px 0 0}#coasterHq .cqplay{color:var(--text)}#coasterHq .cqwarn{color:var(--roll)}" +
    "#coasterHq .cqline a{color:var(--text);text-decoration:underline;overflow-wrap:anywhere}" +
    "#coasterHq .cqlist{display:grid;gap:12px}" +
    "#coasterHq .cqtop{display:flex;align-items:center;gap:12px;flex-wrap:wrap}" +
    "#coasterHq .cqname{font-weight:800;font-size:16px;color:#fff;flex:1;min-width:0;overflow-wrap:anywhere}" +
    "#coasterHq .cqtag{font-size:15px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid rgba(245,165,36,.45);color:var(--roll);background:rgba(245,165,36,.1)}" +
    "#coasterHq .cqst-customer{border-color:rgba(53,208,127,.45);color:var(--win);background:rgba(53,208,127,.1)}" +
    "#coasterHq .cqst-prospect{border-color:rgba(255,31,142,.45);color:var(--pink);background:rgba(255,31,142,.1)}" +
    "#coasterHq .cqlogo{width:48px;height:48px;object-fit:contain;border-radius:8px;background:var(--ink-3)}" +
    "#coasterHq .cqnologo{font-size:15px;color:var(--faint)}" +
    "#coasterHq .cqacts{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}" +
    "#coasterHq .btn,#coasterHq .field label,#coasterHq input{font-size:15px}" +
    "#coasterHq .field label{text-transform:none;letter-spacing:0}" +
    "#coasterHq .cqadd .btn{margin-top:14px}" +
    "#coasterHq .cqmsg{font-size:15px;margin-top:12px;color:var(--roll);line-height:1.5}#coasterHq .cqmsg.ok{color:var(--win)}" +
    "@media (max-width:560px){#coasterHq .cqacts .btn{flex:1 1 100%}}";
  function mount() {
    if ($("coasterHq")) return $("coasterHq");
    var host = $("paneProspects"); if (!host) return null;
    var el = doc.createElement("div"); el.id = "coasterHq";
    el.innerHTML = "<style>" + CSS + '</style><div id="cqBody"></div>';
    host.appendChild(el);
    el.addEventListener("click", onClick);
    return el;
  }
  function draw() {
    var body = $("cqBody"); if (!body) return;
    var keep = {};
    ["cqName", "cqSuburb", "cqPostcode"].forEach(function (id) { if ($(id)) keep[id] = $(id).value; });
    body.innerHTML = sectionHtml(S.data);
    for (var id in keep) if ($(id)) $(id).value = keep[id];
    var f = $("cqLogo");
    if (f) f.addEventListener("change", function () {
      var file = this.files && this.files[0]; S.logo = null;
      if (!file) return;
      if (!/^image\/(png|webp)$/.test(file.type)) { say("Use a PNG or a WebP for the logo."); this.value = ""; return; }
      var rd = new root.FileReader();
      rd.onload = function () { S.logo = String(rd.result || ""); };
      rd.readAsDataURL(file);
    });
  }
  function say(text, good) { S.msg = text || null; var m = $("cqMsg"); if (m) { m.textContent = text || ""; m.className = "cqmsg" + (good ? " ok" : ""); } }
  function load() {
    if (S.loading) return S.loading;
    if (!mount()) return Promise.resolve(null);
    S.loading = post("/admin/coaster/list", {}).then(function (d) {
      S.loading = false;
      var el = $("coasterHq");
      if (d._status === 401 || d._status === 403) { if (el) el.hidden = true; return d; }   // not for this HQ role
      if (el) el.hidden = false;
      S.data = d; draw();
      return d;
    });
    return S.loading;
  }
  function find(id) {
    var d = S.data || {}, all = (d.coaster || []).concat(d.leads || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function add(btn) {
    var name = ($("cqName").value || "").trim(), suburb = ($("cqSuburb").value || "").trim(), pc = ($("cqPostcode").value || "").replace(/[^0-9]/g, "");
    if (!name) { say("Enter the venue name."); return null; }
    if (pc.length !== 4) { say("Enter the venue's 4-digit postcode."); return null; }
    var body = { name: name, suburb: suburb, postcode: pc };
    if (S.logo) body.logo = S.logo;
    btn.disabled = true; btn.textContent = "Adding...";
    return post("/admin/coaster/add", body).then(function (j) {
      btn.disabled = false; btn.textContent = "Add coaster venue";
      if (j.error || j.need_migration) { say(j.error || "Coaster venues are not switched on yet."); return j; }
      ["cqName", "cqSuburb", "cqPostcode"].forEach(function (id) { $(id).value = ""; });
      S.logo = null;
      S.msg = j.coaster.name + " is added as a coaster venue. Players can pick it now." + ((j.warnings || []).length ? " " + j.warnings.join(" ") : "");
      return load().then(function () { say(S.msg, !(j.warnings || []).length); return j; });
    });
  }
  function remove(btn, id) {
    var c = find(id); if (!c) return null;
    var what = c.kind === "lead" ? "Coaster players at " + c.name : c.name;
    /* Asked on the page (/app/vp-ask.js), never a native confirm(): a kiosk browser answers those no. */
    var ask = root.vpAsk ? root.vpAsk("Remove " + what + "? Its board and its rounds (first names only) go with it.", { yes: "Remove", no: "Keep it" }) : Promise.resolve(false);
    return Promise.resolve(ask).then(function (yes) {
      if (!yes) return null;
      btn.disabled = true; btn.textContent = "Removing...";
      return post("/admin/coaster/remove", { id: id });
    }).then(function (j) {
      if (!j) return null;
      if (j.error) { btn.disabled = false; btn.textContent = "Remove"; say(j.error); return j; }
      S.msg = what + " is removed." + ((j.warnings || []).length ? " " + j.warnings.join(" ") : "");
      return load().then(function () { say(S.msg, true); return j; });
    });
  }
  var REVIEWED = { list: " is in the picker now. Players can pick it.", keep: " is kept as a possible lead.", dismiss: " is marked not a venue." };
  function review(btn, id, action) {
    var c = find(id); if (!c) return null;
    btn.disabled = true;
    return post("/admin/coaster/review", { id: id, action: action }).then(function (j) {
      btn.disabled = false;
      if (j.error || j.need_migration) { say(j.error || "Coaster venues are not switched on yet."); return j; }
      S.msg = c.name + REVIEWED[action];
      return load().then(function () { say(S.msg, true); return j; });
    });
  }
  function optins(btn, venueId, on) {
    btn.disabled = true;
    return post("/admin/coaster/optins", { venue_id: venueId, on: on }).then(function (j) {
      btn.disabled = false;
      if (j.error || j.need_migration) { say(j.error || "Coaster venues are not switched on yet."); return j; }
      S.msg = on ? "Sign-ups are on. Players there see the venue's own sign-up at the end of a round." : "Sign-ups are off.";
      return load().then(function () { say(S.msg, true); return j; });
    });
  }
  function onClick(e) {
    var t = e.target && e.target.closest && e.target.closest("button"); if (!t) return;
    if (t.id === "cqAdd") { add(t); return; }
    var rv = t.getAttribute("data-cq-review");
    if (rv) { review(t, t.getAttribute("data-cq-for"), rv); return; }
    var oi = t.getAttribute("data-cq-optins");
    if (oi) { optins(t, t.getAttribute("data-cq-for"), oi === "on"); return; }
    var sw = t.getAttribute("data-cq-switch");
    if (sw) {
      var c = find(sw); if (!c) return;
      /* hq.html's own Set up a prospect form, never a second copy of it. */
      if (typeof root.hqProspectPrefill === "function") root.hqProspectPrefill({ name: c.name, postcode: c.postcode, coaster_id: c.id });
      return;
    }
    var rm = t.getAttribute("data-cq-remove");
    if (rm) remove(t, rm);
  }
  function start() {
    var nav = $("hqNav"); if (!nav) return;
    nav.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b && b.getAttribute("data-pane") === "prospects") load();
    });
  }

  root.VPCoaster = { load: load,
    _t: { sectionHtml: sectionHtml, coasterRowHtml: coasterRowHtml, leadRowHtml: leadRowHtml, boardRowHtml: boardRowHtml, S: S, onClick: onClick, mount: mount, add: add, remove: remove, find: find, review: review, optins: optins } };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else if (doc) start();
})(typeof window !== "undefined" ? window : this);
