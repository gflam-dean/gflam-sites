/* ============================================================================
   HELP: a short FAQ and a "Contact support" form, on any page, in one line.

   Dean, 19 Oct 2026: "In the patron app/game screen: add a small 'Help' link to a short FAQ,
   plus a 'Contact support' form that creates a ticket ... That gives you a record without phone
   calls." Then: VenuePlay AND PartyPlay, one help desk.

   ONE FILE FOR BOTH SITES. This exact file is also partyplay/lib/vp-help.js, and a suite fails if
   the two differ. A page says what it is with attributes on the script tag:

     VenuePlay phone pages (play, musical, trivia)
       <script src="/app/vp-help.js" data-mode="patron" data-brand="venueplay"></script>
     VenuePlay console, settings, account
       <script src="/app/vp-help.js" data-mode="venue" data-brand="venueplay"></script>
     PartyPlay guest phone
       <script src="/lib/vp-help.js" data-mode="guest" data-brand="partyplay"></script>
     PartyPlay host console
       <script src="/lib/vp-help.js" data-mode="host" data-brand="partyplay"></script>
     PartyPlay home page contact form, drawn into <div id="ppContact"></div>
       <script src="/lib/vp-help.js" data-mode="sales" data-brand="partyplay" data-mount="ppContact"></script>

   THREE RULES IT FOLLOWS.

   1. It never covers the game. The Help link sits IN THE PAGE FLOW, after everything else, never
      fixed over it, and on the phone pages it is also in the menu. The panel only covers the
      screen while somebody has opened it. tools/help-desk-pages.test.py checks this at phone
      width in a real browser, with the BINGO button on screen.

   2. It never breaks the page. Everything is inside a try; a missing FAQ file, a dead Worker or an
      old browser leaves the page exactly as it was.

   3. It reads nothing back. The form submits and is told a ticket number. There is no list of
      past requests anywhere: tickets are for Gflam staff only, and the Worker has no route that
      would give one to this page.

   The words live in /data/help-faq.json on each site, so Dean can change them without code.
   ========================================================================== */
(function (root) {
  "use strict";
  var doc = root.document;
  if (!doc || root.__vpHelp) return;
  root.__vpHelp = true;

  var me = doc.currentScript;
  function attr(k, d) { try { return (me && me.getAttribute(k)) || d; } catch (e) { return d; } }
  var MODE = attr("data-mode", "patron");
  var BRAND = attr("data-brand", "venueplay") === "partyplay" ? "partyplay" : "venueplay";
  var MOUNT = attr("data-mount", "");
  /* The help desk is one desk for both brands, on the VenuePlay billing Worker. Overridable for a
     test page with window.VP_HELP_API. */
  var API = root.VP_HELP_API || "https://venueplay-api.dean-tindale.workers.dev";
  var SUPPORT = "support@" + BRAND + ".com.au";
  var NAME = BRAND === "partyplay" ? "PartyPlay" : "VenuePlay";
  var FAQ_KEY = { patron: "patron", venue: "venue", guest: "guest", host: "host" }[MODE] || "";

  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function on(n, ev, fn) { n.addEventListener(ev, function (e) { try { fn(e); } catch (x) {} }); }
  function qs(k) { try { var m = new RegExp("[?&]" + k + "=([^&#]*)").exec(root.location.search || ""); return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : ""; } catch (e) { return ""; } }
  // Text with line breaks, built as nodes, so nothing from the FAQ file is ever read as HTML.
  function lines(n, s) { String(s || "").split("\n").forEach(function (l, i) { if (i) n.appendChild(el("br")); n.appendChild(doc.createTextNode(l)); }); return n; }

  function deviceId() {
    try {
      var k = "vpHelpDev", v = root.localStorage.getItem(k);
      if (!v) { var a = new Uint8Array(12); root.crypto.getRandomValues(a); v = Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); root.localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ""; }
  }

  /* ---- what this page knows about where the person is ---- */
  function roomCode() {
    if (BRAND === "partyplay") {
      var c = qs("code"); if (c) return c.toUpperCase();
      var inp = doc.getElementById("code"); return inp && inp.value ? String(inp.value).trim().toUpperCase() : "";
    }
    var lbl = doc.getElementById("roomLabel"), t = lbl ? String(lbl.textContent || "").trim().toUpperCase() : "";
    if (/^[A-Z0-9]{6}$/.test(t)) return t;
    var r = qs("room").toUpperCase(); return /^[A-Z0-9]{6}$/.test(r) ? r : "";
  }
  function venueSlug() {
    try { if (root.VPVenueURL && root.VPVenueURL.slug) return root.VPVenueURL.slug(root.location.search || "") || ""; } catch (e) {}
    return qs("venue");
  }
  function gameName() {
    var p = String(root.location.pathname || "");
    if (/musical/.test(p)) return "musical"; if (/trivia/.test(p)) return "trivia";
    return BRAND === "venueplay" ? "bingo" : "";
  }

  /* ---- styles: one block, prefixed, so nothing on the host page is touched ---- */
  function styles() {
    if (doc.getElementById("vphCss")) return;
    var pp = BRAND === "partyplay";
    var s = el("style"); s.id = "vphCss";
    s.textContent =
      ".vph-foot{text-align:center;padding:22px 16px calc(22px + env(safe-area-inset-bottom));clear:both}" +
      ".vph-link{background:none;border:none;color:#9A9AA4;font:600 13px/1.4 'Manrope',system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:8px 12px;-webkit-tap-highlight-color:transparent}" +
      ".vph-link:hover{color:#E7E7EC}" +
      ".vph-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center}" +
      "@media(min-width:640px){.vph-bg{align-items:center}}" +
      ".vph{background:" + (pp ? "#12101A" : "#121214") + ";color:#E7E7EC;width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:20px 18px calc(22px + env(safe-area-inset-bottom));font:400 15px/1.5 'Manrope',system-ui,sans-serif;box-shadow:0 -10px 40px rgba(0,0,0,.5);-webkit-overflow-scrolling:touch;text-align:left}" +
      "@media(min-width:640px){.vph{border-radius:18px}}" +
      ".vph h2{font:800 22px/1.2 'Hanken Grotesk',system-ui,sans-serif;color:#fff;margin:0}" +
      ".vph h3{font:800 16px/1.3 'Hanken Grotesk',system-ui,sans-serif;color:#fff;margin:22px 0 8px}" +
      ".vph .vph-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}" +
      ".vph .vph-x{background:#1E1E22;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:999px;width:38px;height:38px;font:700 20px/1 system-ui;cursor:pointer;flex:none}" +
      ".vph details{border-top:1px solid rgba(255,255,255,.08);padding:2px 0}" +
      ".vph summary{cursor:pointer;padding:11px 0;font-weight:700;color:#fff;list-style-position:outside}" +
      ".vph details p{margin:0 0 12px;color:#C9C9D1}" +
      ".vph label{display:block;font-size:13px;color:#9A9AA4;margin:12px 0 5px}" +
      ".vph input[type=text],.vph input[type=email],.vph input[type=tel],.vph textarea,.vph select{width:100%;box-sizing:border-box;background:#17171A;border:1px solid rgba(255,255,255,.14);color:#E7E7EC;border-radius:10px;padding:12px;font:400 16px/1.4 'Manrope',system-ui,sans-serif;outline:none;text-align:left}" +
      ".vph textarea{min-height:120px;resize:vertical}" +
      ".vph input:focus,.vph textarea:focus,.vph select:focus{border-color:#FF1F8E}" +
      ".vph .vph-chk{display:flex;gap:9px;align-items:flex-start;color:#C9C9D1;font-size:14px;margin-top:12px}" +
      ".vph .vph-chk input{width:18px;height:18px;margin:2px 0 0;accent-color:#FF1F8E;flex:none}" +
      ".vph .vph-go{margin-top:16px;width:100%;border:none;border-radius:12px;padding:15px;background:#FF1F8E;color:#0A0A0B;font:800 16px/1 'Hanken Grotesk',system-ui,sans-serif;cursor:pointer}" +
      ".vph .vph-go:disabled{opacity:.5;cursor:default}" +
      ".vph .vph-err{color:#FF6B8B;font-size:14px;margin-top:10px;min-height:1px}" +
      ".vph .vph-fine{font-size:12.5px;color:#8A8A94;margin-top:12px}" +
      ".vph .vph-fine a,.vph details a{color:#FF8AC4}" +
      ".vph .vph-done{background:#17171A;border:1px solid rgba(53,208,127,.4);border-radius:12px;padding:16px;margin-top:14px;color:#E7E7EC}" +
      ".vph .vph-done b{color:#35D07F}" +
      ".vph .vph-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}" +
      ".vph-inline{max-width:560px;margin:0 auto;text-align:left;font:400 15px/1.5 'Manrope',system-ui,sans-serif}" +
      ".vph-inline .vph{background:transparent;box-shadow:none;max-height:none;padding:0;border-radius:0;max-width:none}";
    doc.head.appendChild(s);
  }

  /* ---- the FAQ ---- */
  var faqP = null;
  function loadFaq() {
    if (!faqP) faqP = root.fetch("/data/help-faq.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; });
    return faqP;
  }

  /* ---- the form ---- */
  function field(label, input) { var w = el("div"); var l = el("label", "", label); if (input.id) l.setAttribute("for", input.id); w.appendChild(l); w.appendChild(input); return w; }
  function input(type, id, extra) { var i = el(type === "textarea" ? "textarea" : "input"); if (type !== "textarea") i.type = type; i.id = id; for (var k in (extra || {})) i.setAttribute(k, extra[k]); return i; }

  function buildForm(box) {
    var venueMode = MODE === "venue", sales = MODE === "sales";
    var f = el("form"); f.setAttribute("novalidate", ""); f.className = "vph-form";
    var hp = input("text", "vphWebsite", { name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    var hpw = el("div", "vph-hp"); hpw.appendChild(hp); f.appendChild(hpw);

    var name, email, phone, subject, kind, urgent;
    if (venueMode) {
      subject = input("text", "vphSubject", { maxlength: "200", placeholder: "e.g. TV not showing the game" });
      f.appendChild(field("What is it about?", subject));
      kind = el("select"); kind.id = "vphKind";
      [["venue_support", "Help with VenuePlay"], ["accounts", "Billing or an invoice"]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; kind.appendChild(op); });
      f.appendChild(field("Kind of request", kind));
    } else {
      name = input("text", "vphName", { maxlength: "120", autocomplete: "name", placeholder: sales ? "Your name" : "Optional" });
      f.appendChild(field(sales ? "Your name" : "Your name (optional)", name));
      email = input("email", "vphEmail", { maxlength: "200", autocomplete: "email", inputmode: "email", placeholder: "you@example.com" });
      f.appendChild(field("Your email, so we can reply", email));
      if (sales) { phone = input("tel", "vphPhone", { maxlength: "30", autocomplete: "tel", placeholder: "Optional" }); f.appendChild(field("Phone (optional)", phone)); }
    }
    var msg = input("textarea", "vphMsg", { maxlength: "4000", placeholder: venueMode ? "What is happening, and on which screen?" : "How can we help?" });
    f.appendChild(field("Message", msg));
    if (venueMode) {
      var replyTo = input("email", "vphReply", { maxlength: "200", placeholder: "Leave blank to use your account email" });
      f.appendChild(field("Reply to (optional)", replyTo));
      var c = el("label", "vph-chk"); urgent = input("checkbox", "vphUrgent"); c.appendChild(urgent);
      c.appendChild(doc.createTextNode("Happening now: a game night is going wrong"));
      f.appendChild(c);
    }
    var go = el("button", "vph-go", "Send"); go.type = "submit"; f.appendChild(go);
    var err = el("div", "vph-err"); err.setAttribute("role", "alert"); f.appendChild(err);
    var fine = el("div", "vph-fine");
    fine.appendChild(doc.createTextNode(venueMode ? "We reply by email. " : "We only use your email to reply to this message. "));
    var a = el("a", "", "Privacy policy"); a.href = "/privacy"; a.target = "_blank"; a.rel = "noopener"; fine.appendChild(a);
    fine.appendChild(doc.createTextNode(". Or email " + SUPPORT + "."));
    f.appendChild(fine);

    on(f, "submit", function (e) {
      e.preventDefault();
      err.textContent = "";
      var body, url = API + "/help/ticket", headers = { "Content-Type": "application/json" };
      var m = String(msg.value || "").trim();
      if (!m) { err.textContent = "Type your message first."; msg.focus(); return; }
      if (m.length > 4000) { err.textContent = "That is a bit long. Keep it under 4,000 characters."; return; }
      if (venueMode) {
        if (!String(subject.value || "").trim()) { err.textContent = "Give it a short subject."; subject.focus(); return; }
        body = { venue_id: venueId(), subject: subject.value, message: m, category: kind.value, urgent: !!urgent.checked, reply_email: replyTo.value };
        url = API + "/help/venue/ticket";
        if (!body.venue_id) { err.textContent = "Pick your venue first, then try again."; return; }
      } else {
        var em = String(email.value || "").trim();
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(em)) { err.textContent = "Put in your email so we can reply."; email.focus(); return; }
        if (sales && !String(name.value || "").trim()) { err.textContent = "Put in your name."; name.focus(); return; }
        body = { brand: BRAND, kind: sales ? "sales" : (MODE === "host" ? "host" : "patron"), name: name.value, email: em,
                 phone: phone ? phone.value : "", message: m, code: roomCode(), slug: BRAND === "venueplay" ? venueSlug() : "",
                 game: sales ? "" : gameName(), device: deviceId(), website: hp.value };
      }
      go.disabled = true; go.textContent = "Sending...";
      authHeader(venueMode).then(function (h) {
        if (h) headers.Authorization = h;
        return root.fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) });
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (!res.ok || !res.j || res.j.error) throw new Error((res.j && res.j.error) || "");
        var done = el("div", "vph-done");
        done.setAttribute("role", "status");
        var no = res.j.ticket_no;
        done.appendChild(el("b", "", "Thanks, we'll email you."));
        if (no) { done.appendChild(el("br")); done.appendChild(doc.createTextNode("Your ticket number is #" + no + ". Quote it if you write to us.")); }
        f.parentNode.replaceChild(done, f);
      }).catch(function (x) {
        go.disabled = false; go.textContent = "Send";
        err.textContent = (x && x.message) || ("We could not send that. Please try again, or email " + SUPPORT + ".");
      });
    });
    box.appendChild(f);
    return f;
  }

  function venueId() {
    try {
      var c = root.VP && root.VP.__helpCtx;
      if (c && c.currentVenueId) return c.currentVenueId;
      if (c && c.staff && c.staff.length) return c.staff[0].venue_id;
    } catch (e) {}
    return "";
  }
  function authHeader(need) {
    if (!need || !root.VP || !root.VP.getClient) return Promise.resolve("");
    try {
      return root.VP.getClient().auth.getSession().then(function (r) {
        var t = r && r.data && r.data.session && r.data.session.access_token; return t ? "Bearer " + t : "";
      }).catch(function () { return ""; });
    } catch (e) { return Promise.resolve(""); }
  }

  /* ---- the panel ---- */
  var lastFocus = null;
  function openPanel() {
    styles();
    if (doc.getElementById("vphBg")) return;
    lastFocus = doc.activeElement;
    var bg = el("div", "vph-bg"); bg.id = "vphBg";
    var p = el("div", "vph"); p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-labelledby", "vphTitle");
    var top = el("div", "vph-top"); var h = el("h2", "", MODE === "venue" ? "Help for venues" : MODE === "host" ? "Help for hosts" : "Help"); h.id = "vphTitle";
    var x = el("button", "vph-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close help");
    top.appendChild(h); top.appendChild(x); p.appendChild(top);
    var faqBox = el("div"); faqBox.id = "vphFaq"; p.appendChild(faqBox);
    p.appendChild(el("h3", "", MODE === "venue" || MODE === "host" ? "Contact support" : "Contact support"));
    buildForm(p);
    bg.appendChild(p); doc.body.appendChild(bg);
    function close() { try { bg.parentNode.removeChild(bg); } catch (e) {} doc.removeEventListener("keydown", esck); try { lastFocus && lastFocus.focus(); } catch (e) {} }
    function esck(e) { if (e.key === "Escape") close(); }
    on(x, "click", close);
    on(bg, "click", function (e) { if (e.target === bg) close(); });
    doc.addEventListener("keydown", esck);
    try { x.focus(); } catch (e) {}
    loadFaq().then(function (data) {
      var sec = data && data[FAQ_KEY];
      if (sec && sec.title) h.textContent = sec.title;
      (sec && sec.items || []).forEach(function (it) {
        var d = el("details"); var s = el("summary", "", it.q); d.appendChild(s); d.appendChild(lines(el("p"), it.a)); faqBox.appendChild(d);
      });
      if (!sec) faqBox.appendChild(lines(el("p", "vph-fine"), "Questions and answers could not load just now. You can still send us a message below."));
    });
  }
  root.VPHelp = { open: openPanel, mode: MODE, brand: BRAND };

  /* ---- where the way in goes, per page ---- */
  function footLink(container) {
    var w = el("div", "vph-foot"); w.id = "vphFoot";
    var b = el("button", "vph-link", "Help"); b.type = "button"; b.id = "vphLink";
    b.setAttribute("aria-haspopup", "dialog");
    on(b, "click", openPanel); w.appendChild(b); container.appendChild(w);
  }
  function mount() {
    styles();
    if (MODE === "sales") {
      var m = doc.getElementById(MOUNT); if (!m) return;
      var wrap = el("div", "vph-inline"); var p = el("div", "vph"); wrap.appendChild(p); buildForm(p); m.appendChild(wrap);
      return;
    }
    if (MODE === "venue") {
      // Into the header's own buttons, beside Account and Sign out.
      var acts = doc.querySelector("header .hactions");
      if (!acts) return;
      var b = el("button", "hact", "Help"); b.type = "button"; b.id = "vphLink"; b.setAttribute("aria-haspopup", "dialog");
      on(b, "click", openPanel);
      acts.insertBefore(b, acts.firstChild);
      // Which venue: the same context the page itself uses, never a guess.
      try { if (root.VP && root.VP.ready) root.VP.ready().then(function (c) { root.VP.__helpCtx = c; }).catch(function () {}); } catch (e) {}
      return;
    }
    if (MODE === "host") {
      var t = doc.querySelector(".top") || doc.body;
      var hb = el("button", "vph-link", "Help"); hb.type = "button"; hb.id = "vphLink"; hb.setAttribute("aria-haspopup", "dialog");
      hb.style.marginLeft = "auto"; on(hb, "click", openPanel);
      t.appendChild(hb);
      return;
    }
    // patron and guest: in the flow at the very end of the page, never over the game.
    var app = doc.getElementById("app") || doc.querySelector(".app");
    footLink(MODE === "guest" ? doc.body : (app || doc.body));
    // And in the phone's own menu, which is where people look.
    var menu = doc.getElementById("menuPanel");
    if (menu) {
      var mi = el("button", "menuitem", "Help and contact"); mi.type = "button"; mi.id = "vphMenu";
      on(mi, "click", function () { try { menu.classList.add("hidden"); } catch (e) {} openPanel(); });
      var leave = doc.getElementById("leaveBtn");
      if (leave && leave.parentNode === menu) menu.insertBefore(mi, leave); else menu.appendChild(mi);
    }
  }
  try {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { try { mount(); } catch (e) {} });
    else mount();
  } catch (e) {}
})(window);
