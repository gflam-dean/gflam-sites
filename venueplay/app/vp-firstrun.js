/* THE FIRST RUN: a prospect's guided setup, one step per screen (Dean, 28 Oct 2026).

   "just a link: hey, I've set you up an account. Click here to access it, and then it actually asks
   them to add their mobile number and then to confirm the T&Cs and then it walks through everything."

   The prospect's welcome email (version 2) is one button. Everything it used to explain lives here,
   after the one-click sign-in, for a venue HQ set up as a prospect (vp_venues.terms_required, migration
   122) and for its owner or a manager only:

     1. Add your mobile   so they can also sign in by text (and get alerts). Skippable. The number goes
                          on their login ONLY after they type the code texted to it: Supabase Auth's own
                          phone change (updateUser, then verifyOtp type "phone_change"), which keeps the
                          new number pending until it is verified. Nothing here, and no Worker route,
                          ever writes an unverified number to a login.
     2. The Terms         the existing blocking Terms card (VP.termsCard), as this step. Next waits for
                          the tick; nobody can tick on their behalf.
     3. Your TV           their exact TV address with Copy, and a live preview of their slides
                          (/account/screen-get, the same read Your account > Screen makes).
     4. A first game      trivia in three taps, or musical bingo, opening that console for their venue.
     5. Your card         the card link for their own account (/account/card-link) and the price line,
                          plus "Need a hand? Tap here and Dean will call": a help desk ticket, "Please
                          call me", with their mobile. No typing needed.

   Progress is kept per venue on this device (localStorage "vpFirstRun:<venue id>"); closing it keeps
   the step, and "Setup guide" in the console header opens it again. Steps 1 and 2 also read the real
   state (the login's phone, the venue's compliance record), so a step already done says so.

   The 4 hour sign-out still applies: this is a page of the signed-in console, nothing more.
   Everything a person reads is set with textContent; nothing they or HQ typed is ever parsed as HTML. */
(function (root) {
  "use strict";
  var BILLING_API = "https://venueplay-api.dean-tindale.workers.dev";
  var KEY = "vpFirstRun:";
  var STEPS = ["mobile", "terms", "tv", "game", "card"];
  var TITLES = { mobile: "Add your mobile", terms: "Tick the Terms", tv: "Your TV", game: "Run your first game", card: "Add your card when you're ready" };

  var C = { ink: "#0A0A0B", ink2: "#141418", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#8A8A94", line: "rgba(255,255,255,.12)", ok: "#2BD47D" };
  var FONT = "font-family:Manrope,system-ui,sans-serif";
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var BTN = "display:inline-block;min-height:44px;padding:11px 20px;border-radius:10px;border:none;font:700 15px/1.4 " + HEAD + ";cursor:pointer;box-sizing:border-box";
  var BTN_PINK = BTN + ";background:" + C.pink + ";color:#FFFFFF";
  var BTN_GHOST = BTN + ";background:rgba(255,255,255,.08);color:" + C.text;
  var INPUT = "display:block;width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:" + C.ink2 + ";color:#FFFFFF;font:inherit;font-size:16px;margin:0 0 10px";
  var TEXT = "margin:0 0 14px;font-size:15px;line-height:1.55;color:" + C.muted;

  function isProspect(ctx) {
    var v = ctx && ctx.venue;
    return !!(v && v.terms_required === true && v.status !== "suspended" && (ctx.role === "owner" || ctx.role === "manager"));
  }
  function readState(storage, venueId) {
    var s = null;
    try { s = JSON.parse(storage.getItem(KEY + venueId) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object") s = {};
    var i = STEPS.indexOf(s.step); if (i < 0) s.step = STEPS[0];
    return s;
  }
  function writeState(storage, venueId, s) { try { storage.setItem(KEY + venueId, JSON.stringify(s)); } catch (e) {} }
  function wants(ctx, storage) {
    if (!isProspect(ctx)) return false;
    var st = readState(storage || root.localStorage, ctx.venue.id);
    return !st.done && !st.dismissed;
  }
  /* An Australian mobile as Auth stores it: +614XXXXXXXX. Anything else is refused before a text is sent. */
  function mobileE164(raw) {
    var d = String(raw || "").replace(/[^0-9]/g, "");
    if (/^04\d{8}$/.test(d)) return "+61" + d.slice(1);
    if (/^614\d{8}$/.test(d)) return "+" + d;
    if (/^4\d{8}$/.test(d)) return "+61" + d;
    return "";
  }
  function mobileShow(e164) {
    var d = String(e164 || "").replace(/[^0-9]/g, "");
    if (/^614\d{8}$/.test(d)) d = "0" + d.slice(2);
    return /^04\d{8}$/.test(d) ? d.slice(0, 4) + " " + d.slice(4, 7) + " " + d.slice(7) : String(e164 || "");
  }
  function money(n) { return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function open(ctx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document, storage = deps.storage || root.localStorage;
    var fetchFn = deps.fetch || (root.fetch && root.fetch.bind(root));
    var client = deps.client, VP = deps.VP || root.VP;
    var origin = deps.origin || (root.location && root.location.origin) || "https://venueplay.com.au";
    var every = deps.setInterval || (root.setInterval && root.setInterval.bind(root)), stop = deps.clearInterval || (root.clearInterval && root.clearInterval.bind(root));
    var go = deps.openUrl || function (u) { root.location.href = u; };
    var v = ctx.venue, state = readState(storage, v.id);
    /* Their mobile is already on (the name-and-mobile screen, vp-about-you.js, asks for it first since
       29 Oct 2026): the guide starts at the Terms rather than showing a step that is already done. */
    if (state.step === "mobile" && ctx.user && ctx.user.phone) { state.step = "terms"; state.mobile = "done"; }
    var timers = [];
    var me = { phone: "", email: "", token: "" };
    var started = null;   // their free month starts the first time they sign in (/account/prospect-start, below)

    function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
    function clearTimers() { timers.forEach(function (t) { try { stop(t); } catch (e) {} }); timers = []; }
    function save() { writeState(storage, v.id, state); }
    function token() {
      if (!client || !client.auth) return Promise.resolve("");
      return client.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ""; }, function () { return ""; });
    }
    function billing(path, body) {
      return token().then(function (tok) {
        return fetchFn(BILLING_API + path, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok, "X-VP-Venue": String(v.id) }, body: JSON.stringify(body || {}) })
          .then(function (res) { return res.json().catch(function () { return { error: "Something went wrong at our end. Try again in a minute." }; }); });
      }).catch(function () { return { error: "Could not reach VenuePlay. Check your connection and try again." }; });
    }
    function loadMe() {
      if (!client || !client.auth || !client.auth.getUser) return Promise.resolve(me);
      return client.auth.getUser().then(function (r) {
        var u = r && r.data && r.data.user;
        me.phone = (u && u.phone) ? String(u.phone) : ""; me.email = (u && u.email) ? String(u.email) : "";
        return me;
      }, function () { return me; });
    }

    // ---------------------------------------------------------------- the frame
    var old = doc.getElementById("vpFirstRun"); if (old && old.parentNode) old.parentNode.removeChild(old);
    /* OPAQUE, AND THE PAGE'S HEADER STOOD DOWN WHILE IT IS OPEN (Dean, 29 Oct 2026, at 390px): the console's Help /
       Setup guide / Account / Sign out showed through behind "Step 2 of 5" and Close. The sticky header is its own
       layer on an iPhone and can paint through a fixed overlay, so it is hidden until the guide closes. */
    var pageHeader = doc.querySelector ? doc.querySelector("header") : null;
    if (pageHeader && pageHeader.style && pageHeader.setAttribute) {
      if (pageHeader.getAttribute("data-vpfr") === null) pageHeader.setAttribute("data-vpfr", pageHeader.style.visibility || "");   // its own, once, so a second open restores the right one
      pageHeader.style.visibility = "hidden";
    }
    var shell = el("div", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;overflow-y:auto;background:#0A0A0B;" + FONT + ";color:" + C.text + ";padding:0 16px;box-sizing:border-box");
    shell.id = "vpFirstRun"; shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true"); shell.setAttribute("aria-label", "Getting started");
    var box = el("div", "max-width:480px;margin:0 auto;padding:28px 0 40px");
    shell.appendChild(box);
    var top = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px");
    var dots = el("div", "display:flex;gap:8px;align-items:center"); dots.id = "vpFrDots"; dots.setAttribute("aria-hidden", "true");
    var count = el("p", "margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:" + C.pink + ";font-weight:800"); count.id = "vpFrCount";
    var x = el("button", BTN_GHOST + ";min-height:40px;padding:8px 14px;font-size:14px", "Close"); x.id = "vpFrClose"; x.setAttribute("type", "button"); x.setAttribute("aria-label", "Close the setup guide");
    var left = el("div", "display:flex;flex-direction:column;gap:8px"); left.appendChild(count); left.appendChild(dots);
    top.appendChild(left); top.appendChild(x); box.appendChild(top);
    var card = el("div", "background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:16px;padding:22px 20px");
    var title = el("h2", "margin:0 0 12px;font-size:22px;font-weight:800;line-height:1.25;color:#FFFFFF;font-family:" + HEAD); title.id = "vpFrTitle";
    var body = el("div", ""); body.id = "vpFrBody";
    card.appendChild(title); card.appendChild(body); box.appendChild(card);
    var foot = el("div", "display:flex;gap:10px;justify-content:space-between;align-items:center;margin:16px 0 0");
    var back = el("button", BTN_GHOST, "Back"); back.id = "vpFrBack"; back.setAttribute("type", "button");
    var next = el("button", BTN_PINK, "Next"); next.id = "vpFrNext"; next.setAttribute("type", "button");
    foot.appendChild(back); foot.appendChild(next); box.appendChild(foot);
    doc.body.appendChild(shell);

    function msgLine(id) { var m = el("p", "margin:8px 0 0;font-size:14px;line-height:1.5;color:" + C.pinkSoft + ";min-height:1px", ""); m.id = id; m.setAttribute("role", "status"); return m; }
    function setNext(label, enabled) {
      next.textContent = label; next.disabled = !enabled;
      next.style.opacity = enabled ? "1" : ".45";
    }
    function close(finished) {
      clearTimers();
      if (finished) state.done = true; else state.dismissed = true;
      save();
      if (shell.parentNode) shell.parentNode.removeChild(shell);
      if (pageHeader && pageHeader.style && pageHeader.getAttribute) { pageHeader.style.visibility = pageHeader.getAttribute("data-vpfr") || ""; pageHeader.removeAttribute("data-vpfr"); }
      if (typeof deps.onClose === "function") deps.onClose(finished ? "done" : "closed");
    }

    // ---------------------------------------------------------------- the steps
    var STEP = {};
    STEP.mobile = function () {
      body.appendChild(el("p", TEXT, "Add your mobile so you can also sign in with a text code, and so we can text you if something at " + (v.name || "your venue") + " needs you."));
      setNext("Skip for now", true);
      var holder = el("div", ""); body.appendChild(holder);
      return loadMe().then(function () {
        if (me.phone) {
          holder.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700", "Done. " + mobileShow(me.phone) + " is on your login, so you can sign in by text."));
          state.mobile = "done"; save(); setNext("Next", true); return;
        }
        holder.appendChild(el("p", "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + C.faint, "We text it a code first. It only goes on your login once you type that code in."));
        var lbl = el("label", "display:block;font-size:13px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your mobile"); lbl.setAttribute("for", "vpFrMobile");
        var inp = el("input", INPUT); inp.id = "vpFrMobile"; inp.setAttribute("type", "tel"); inp.setAttribute("inputmode", "tel"); inp.setAttribute("autocomplete", "tel"); inp.setAttribute("placeholder", "04xx xxx xxx");
        var send = el("button", BTN_PINK, "Text me a code"); send.id = "vpFrSend"; send.setAttribute("type", "button");
        var codeWrap = el("div", "display:none;margin-top:14px");
        var clbl = el("label", "display:block;font-size:13px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "The 6-digit code we texted you"); clbl.setAttribute("for", "vpFrCode");
        var code = el("input", INPUT + ";letter-spacing:.3em"); code.id = "vpFrCode"; code.setAttribute("inputmode", "numeric"); code.setAttribute("autocomplete", "one-time-code"); code.setAttribute("maxlength", "6");
        var verify = el("button", BTN_PINK, "Confirm"); verify.id = "vpFrVerify"; verify.setAttribute("type", "button");
        var msg = msgLine("vpFrMsg");
        codeWrap.appendChild(clbl); codeWrap.appendChild(code); codeWrap.appendChild(verify);
        holder.appendChild(lbl); holder.appendChild(inp); holder.appendChild(send); holder.appendChild(codeWrap); holder.appendChild(msg);
        var pending = "";
        send.addEventListener("click", function () {
          var ph = mobileE164(inp.value);
          if (!ph) { msg.textContent = "That is not an Australian mobile. It should start 04."; return Promise.resolve(false); }
          send.disabled = true; msg.textContent = "";
          return client.auth.updateUser({ phone: ph }).then(function (r) {
            send.disabled = false;
            if (r && r.error) { msg.textContent = /already|registered|exists/i.test(String(r.error.message || "")) ? "That mobile is already on another VenuePlay login. Use another, or skip this for now." : "We could not text that number just now. Check it and try again."; return false; }
            pending = ph; codeWrap.style.display = "block"; send.textContent = "Text me another code";
            msg.textContent = "Code sent to " + mobileShow(ph) + ". It can take a minute.";
            return true;
          }, function () { send.disabled = false; msg.textContent = "We could not text that number just now. Check it and try again."; return false; });
        });
        verify.addEventListener("click", function () {
          var c = String(code.value || "").replace(/[^0-9]/g, "");
          if (!pending) { msg.textContent = "Tap Text me a code first."; return Promise.resolve(false); }
          if (c.length !== 6) { msg.textContent = "Type the 6-digit code from the text."; return Promise.resolve(false); }
          verify.disabled = true;
          return client.auth.verifyOtp({ phone: pending, token: c, type: "phone_change" }).then(function (r) {
            verify.disabled = false;
            var u = r && r.data && r.data.user;
            if (!r || r.error || !u || !u.phone) { msg.textContent = "That code did not match. Check the text and try again."; return false; }
            me.phone = String(u.phone); state.mobile = "done"; save();
            while (holder.firstChild) holder.removeChild(holder.firstChild);
            holder.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700", "Done. " + mobileShow(me.phone) + " is on your login, so you can sign in by text."));
            setNext("Next", true);
            return true;
          }, function () { verify.disabled = false; msg.textContent = "That code did not match. Check the text and try again."; return false; });
        });
      });
    };
    STEP.terms = function () {
      function accepted() { return !!v.compliance_accepted_at; }
      function done() {
        var d = doc.getElementById("vpTermsDone"); if (d) d.style.display = "none";
        setNext("Next", true);
      }
      if (accepted()) {
        body.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700",
          "Done. Section 6 of the Terms is accepted for " + (v.name || "your venue") + (v.compliance_accepted_by ? " by " + v.compliance_accepted_by : "") + "."));
        done(); return;
      }
      body.appendChild(el("p", TEXT, "One tick, once. It confirms your venue runs its own games under the gaming laws that apply to it. VenuePlay supplies the software."));
      setNext("Next", false);
      if (VP && VP.termsCard) {
        VP.termsCard(ctx);
        var tc = doc.getElementById("vpTermsCard");
        if (tc) { tc.style.margin = "0"; tc.style.width = "100%"; body.appendChild(tc); }
      }
      var t = every(function () { if (accepted()) { clearTimers(); done(); } }, 400);
      timers.push(t);
    };
    STEP.tv = function () {
      var url = origin.replace(/\/+$/, "") + "/tv?" + encodeURIComponent(v.slug || "");
      body.appendChild(el("p", TEXT, "Open this address in your TV's web browser (or on a laptop or streaming stick plugged into the TV) and leave it running."));
      var row = el("div", "display:flex;gap:8px;align-items:stretch;margin:0 0 16px");
      var addr = el("div", "flex:1;min-width:0;padding:11px 14px;border-radius:10px;border:1px solid " + C.line + ";background:" + C.ink + ";color:#FFFFFF;font:600 15px/1.4 ui-monospace,Menlo,monospace;word-break:break-all", url.replace(/^https?:\/\//, ""));
      addr.id = "vpFrTvUrl";
      var copy = el("button", BTN_PINK + ";flex:0 0 auto", "Copy"); copy.id = "vpFrCopy"; copy.setAttribute("type", "button");
      row.appendChild(addr); row.appendChild(copy); body.appendChild(row);
      copy.addEventListener("click", function () {
        var clip = deps.clipboard || (root.navigator && root.navigator.clipboard);
        var p = (clip && clip.writeText) ? clip.writeText(url) : Promise.reject(new Error("no clipboard"));
        return Promise.resolve(p).then(function () { copy.textContent = "Copied"; return true; }, function () { copy.textContent = "Select and copy"; return false; });
      });
      var frame = el("div", "position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;background:#000;border:1px solid " + C.line);
      frame.id = "vpFrPreview";
      var img = el("img", "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;display:none"); img.id = "vpFrSlide"; img.setAttribute("alt", "Your TV slide");
      var empty = el("p", "position:absolute;top:50%;left:0;right:0;margin:0;transform:translateY(-50%);text-align:center;font-size:14px;color:" + C.faint, "Loading your TV...");
      frame.appendChild(img); frame.appendChild(empty); body.appendChild(frame);
      var cap = el("p", "margin:10px 0 0;font-size:13.5px;line-height:1.5;color:" + C.faint, ""); cap.id = "vpFrCaption"; body.appendChild(cap);
      setNext("Next", true);
      return billing("/account/screen-get", { venue_id: v.id }).then(function (d) {
        var slides = ((d && d.slides) || []).filter(function (s) { return s && /^https:\/\//.test(String(s.image_url || "")); });
        if (!slides.length) {
          empty.textContent = "Your TV shows the VenuePlay screen";
          cap.textContent = "No slides yet. Add your own ads any time under Account and they show on the TV straight away.";
          return 0;
        }
        var i = 0;
        img.setAttribute("src", slides[0].image_url); img.style.display = "block"; empty.textContent = "";
        cap.textContent = slides.length === 1 ? "Your slide, as your TV shows it between games." : "Your " + slides.length + " slides, as your TV shows them between games.";
        if (slides.length > 1) timers.push(every(function () { i = (i + 1) % slides.length; img.setAttribute("src", slides[i].image_url); }, 4000));
        return slides.length;
      });
    };
    STEP.game = function () {
      var q = "?venue=" + encodeURIComponent(v.slug || "");
      body.appendChild(el("p", TEXT, "Trivia takes three taps: pick a question set, tap Open lobby, then Start once people have joined on their phones from the QR code on the TV."));
      var tri = el("button", BTN_PINK + ";width:100%;margin:0 0 10px", "Open trivia"); tri.id = "vpFrTrivia"; tri.setAttribute("type", "button");
      var mus = el("button", BTN_GHOST + ";width:100%", "Or try musical bingo"); mus.id = "vpFrMusical"; mus.setAttribute("type", "button");
      body.appendChild(tri); body.appendChild(mus);
      body.appendChild(el("p", "margin:12px 0 0;font-size:13.5px;line-height:1.5;color:" + C.faint, "Musical bingo: pick a playlist, tap Open lobby, then Deal, then Play. Come back to this guide any time from Setup guide at the top."));
      // Leaving for a game moves the guide on, so it reopens on the last step.
      function leave(path) { state.step = "card"; save(); clearTimers(); go(path + q); }
      tri.addEventListener("click", function () { leave("/app/trivia/host.html"); });
      mus.addEventListener("click", function () { leave("/app/musical/host.html"); });
      setNext("Next", true);
    };
    STEP.card = function () {
      var price = el("p", TEXT, "Your price is set on your usual crowd, not counted each time you play."); price.id = "vpFrPrice";
      body.appendChild(price);
      /* TWO EQUAL CHOICES (Dean, 29 Oct 2026, phase 2): "Add your card now" (not charged until the free month
         ends) or "Later" (a reminder email comes before it ends). Same size, side by side, no pressure. */
      var choices = el("div", "display:none;gap:10px;flex-wrap:wrap"); choices.id = "vpFrChoices";
      var cardBtn = el("a", BTN_PINK + ";text-decoration:none;text-align:center;flex:1 1 150px", "Add your card now"); cardBtn.id = "vpFrCard";
      /* SAME TAB (Dean, 29 Oct 2026): in a new tab, Stripe's back arrow landed on a fresh copy of the console
         that asked him to sign in all over again. Here Back (and Stripe's own back link, /app/) returns to
         this console, still signed in, and the guide reopens on this step. */
      cardBtn.setAttribute("rel", "noopener");
      var later = el("button", BTN_GHOST + ";flex:1 1 150px", "Later"); later.id = "vpFrLater"; later.setAttribute("type", "button");
      choices.appendChild(cardBtn); choices.appendChild(later);
      var cardMsg = msgLine("vpFrCardMsg");
      body.appendChild(choices); body.appendChild(cardMsg);
      cardBtn.addEventListener("click", function () { billing("/account/card-choice", { venue_id: v.id, choice: "now" }); });
      later.addEventListener("click", function () {
        billing("/account/card-choice", { venue_id: v.id, choice: "later" });
        cardMsg.style.color = C.ok;
        cardMsg.textContent = "No problem. We'll send you a reminder email to add your card before your free month ends.";
        return true;
      });
      body.appendChild(el("p", "margin:12px 0 22px;font-size:13px;line-height:1.5;color:" + C.faint, "The link is secure and goes to our payment provider, Stripe. Nothing is charged when you add it, and nothing until your free month ends."));
      var help = el("div", "border-top:1px solid " + C.line + ";padding-top:18px");
      help.appendChild(el("p", "margin:0 0 10px;font-size:15px;font-weight:700;color:#FFFFFF", "Need a hand?"));
      var callWrap = el("div", "display:none"); callWrap.id = "vpFrCallWrap";
      var clbl = el("label", "display:block;font-size:13px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your mobile, for the call"); clbl.setAttribute("for", "vpFrCallMobile");
      var cin = el("input", INPUT); cin.id = "vpFrCallMobile"; cin.setAttribute("type", "tel"); cin.setAttribute("inputmode", "tel"); cin.setAttribute("placeholder", "04xx xxx xxx");
      callWrap.appendChild(clbl); callWrap.appendChild(cin);
      var call = el("button", BTN_GHOST + ";width:100%", "Tap here and Dean will call"); call.id = "vpFrCall"; call.setAttribute("type", "button");
      var callMsg = msgLine("vpFrCallMsg");
      help.appendChild(callWrap); help.appendChild(call); help.appendChild(callMsg); body.appendChild(help);
      setNext("Finish", true);
      call.addEventListener("click", function () {
        var ph = me.phone || mobileE164(cin.value);
        if (!ph) { callWrap.style.display = "block"; call.textContent = "Call me on this number"; callMsg.textContent = cin.value ? "That is not an Australian mobile. It should start 04." : "Pop your mobile in and tap again."; return Promise.resolve(false); }
        call.disabled = true; callMsg.textContent = "";
        return billing("/help/venue/ticket", { venue_id: v.id, subject: "Please call me",
          message: "Please call me on " + mobileShow(ph) + ". Sent from the setup guide at " + (v.name || "the venue") + ", which HQ set up as a prospect.",
          category: "venue_support" }).then(function (j) {
          if (!j || j.error || !j.ok) { call.disabled = false; callMsg.textContent = (j && j.error) || "That did not send. Try again in a minute."; return false; }
          callWrap.style.display = "none";
          call.textContent = "Dean will call you";
          callMsg.style.color = C.ok;
          callMsg.textContent = "Thanks. Dean will call you on " + mobileShow(ph) + (j.ticket_no ? " (ticket " + j.ticket_no + ")." : ".");
          return true;
        });
      });
      return Promise.all([loadMe(), billing("/account/card-link", { venue_id: v.id })]).then(function (a) {
        var d = a[1];
        if (d && d.ok && d.has_card) { cardMsg.style.color = C.ok; cardMsg.textContent = "Your card is on. Thank you."; return "has_card"; }
        if (!d || !d.ok || !d.card_url) { cardMsg.textContent = (d && d.error) || "The card link could not load. Try again from Setup guide later."; return "error"; }
        price.textContent = "It's " + money(d.rate) + " a player a month on your usual crowd: " + d.seats + " players is " + money(d.monthly) + " a month. " +
          (d.ends_words ? "Your free month runs until " + d.ends_words + ", and your card won't be charged before then." : "Your first month is free, and your card won't be charged before it ends.") + " No lock-in.";
        cardBtn.setAttribute("href", d.card_url); choices.style.display = "flex";
        return "link";
      });
    };

    var api = {
      el: shell,
      step: function () { return state.step; },
      go: function (name) {
        if (STEPS.indexOf(name) < 0) return null;
        clearTimers();
        state.step = name; save();
        var i = STEPS.indexOf(name);
        count.textContent = "Step " + (i + 1) + " of " + STEPS.length;
        while (dots.firstChild) dots.removeChild(dots.firstChild);
        STEPS.forEach(function (s, k) { var d = el("span", "display:inline-block;width:" + (k === i ? "22px" : "8px") + ";height:8px;border-radius:4px;background:" + (k <= i ? C.pink : "rgba(255,255,255,.18)")); d.setAttribute("data-step", s); dots.appendChild(d); });
        title.textContent = TITLES[name];
        while (body.firstChild) body.removeChild(body.firstChild);
        back.style.visibility = i === 0 ? "hidden" : "visible";
        return STEP[name]();
      },
      next: function () {
        if (next.disabled) return null;
        var i = STEPS.indexOf(state.step);
        if (state.step === "mobile" && state.mobile !== "done") state.mobile = "skipped";
        if (i >= STEPS.length - 1) { close(true); return "done"; }
        return api.go(STEPS[i + 1]);
      },
      back: function () { var i = STEPS.indexOf(state.step); if (i > 0) return api.go(STEPS[i - 1]); return null; },
      close: function () { close(false); }
    };
    next.addEventListener("click", function () { api.next(); });
    back.addEventListener("click", function () { api.back(); });
    x.addEventListener("click", function () { api.close(); });
    state.dismissed = false; save();
    /* THE FREE MONTH STARTS NOW, the first time they are in (Dean, 29 Oct 2026, phase 2; migration 127). The
       Worker sets it once and never moves it; a second sign-in changes nothing. */
    started = billing("/account/prospect-start", { venue_id: v.id }).catch(function () { return null; });
    api.started = started;
    api.ready = api.go(state.step);
    return api;
  }

  root.VPFirstRun = { open: open, wants: wants, isProspect: isProspect, STEPS: STEPS, KEY: KEY, mobileE164: mobileE164 };
})(typeof window !== "undefined" ? window : this);
