/* "PRODUCT UPDATES FROM VENUEPLAY?": a small card in the host console after sign-in (Dean, 5 Nov 2026,
   INBOX item 21a; migration 164).

   "when a host signs in (by phone), also ask for their EMAIL address, optional, for product updates about
   once a month. It needs a clear opt-in tick, unticked by default (Spam Act ...), and an unsubscribe link in
   every update. Store the consent with a timestamp. Hosts who skip it are never asked again on every
   sign-in: at most once a month."

   Shown only to a staff login (never HQ View as or an admin), and only when the billing Worker says
   POST /account/updates-ask -> { ask: true } (no answer yet, or a skip more than 30 days ago). Anything else,
   including an error, shows nothing. It never blocks the console: it sits at the foot of the screen and the
   console carries on behind it.

   The tick starts UNTICKED. Save with the tick off counts as "Not now", and then no email is sent to the
   Worker at all, even one typed into the box. CONSENT below is the Worker's VPB_HOST_UPDATES_CONSENT word for
   word, because the words stored with the consent must be the words ticked
   (tools/test-host-updates-optin.js holds them equal). Everything a person reads is set with textContent.
   No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  var BILLING_API = "https://api.venueplay.com.au";
  var CONSENT = "Yes, email me venueplay product updates, about once a month. I can unsubscribe at any time from any email.";
  var EMAIL_RE = /^[^@\s"<>,;()\\]+@[^@\s"<>,;()\\]+\.[^@\s"<>,;()\\]+$/;   // the Worker's VP_UNSUB_EMAIL_RE
  var C = { ink: "#0A0A0B", ink2: "#141418", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#8A8A94", line: "rgba(255,255,255,.12)" };
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var BTN = "flex:1 1 0;min-height:48px;padding:12px 18px;border-radius:12px;font:700 15px/1.4 " + HEAD + ";cursor:pointer;box-sizing:border-box;outline-color:" + C.pinkSoft;
  var BTN_PINK = BTN + ";border:none;background:" + C.pink + ";color:#0A0A0B";
  var BTN_QUIET = BTN + ";border:1px solid rgba(255,255,255,.22);background:transparent;color:#FFFFFF";
  var INPUT = "display:block;width:100%;box-sizing:border-box;min-height:48px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:" + C.ink + ";color:#FFFFFF;font:inherit;font-size:16px;margin:0 0 14px;outline-color:" + C.pink;
  var LABEL = "display:block;font-size:13px;font-weight:700;color:" + C.muted + ";margin:0 0 6px";
  var shownThisLoad = false;   // proceedVenue runs more than once a sign-in; ask once per page load

  function wants(ctx) {
    return !!(ctx && ctx.authed && !ctx.isAdmin && ctx.scope === "staff" && ctx.user && ctx.user.id && ctx.staff && ctx.staff.length);
  }
  function validEmail(raw) { var e = String(raw || "").trim().toLowerCase(); return e.length <= 254 && EMAIL_RE.test(e) ? e : ""; }

  function post(deps, path, body) {
    var client = deps.client, fetchFn = deps.fetch || (root.fetch && root.fetch.bind(root));
    if (!client || !client.auth || !fetchFn) return Promise.resolve({ error: "offline" });
    return client.auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
      return fetchFn(BILLING_API + path, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify(body || {}) }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) { j = j || {}; if (!res.ok && !j.error) j.error = "failed"; return j; });
      });
    }).catch(function () { return { error: "offline" }; });
  }

  /* Ask the Worker, and show the card only on { ask: true }. Resolves to the card's handle, or null. */
  function maybe(ctx, deps) {
    deps = deps || {};
    if (!wants(ctx) || (shownThisLoad && !deps.again)) return Promise.resolve(null);
    shownThisLoad = true;
    return post(deps, "/account/updates-ask", {}).then(function (r) {
      return (r && r.ask === true) ? open(ctx, deps) : null;
    }, function () { return null; });
  }

  function open(ctx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document;
    function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
    var old = doc.getElementById("vpUpdatesOptin"); if (old && old.parentNode) old.parentNode.removeChild(old);

    var shell = el("div", "position:fixed;left:0;right:0;bottom:0;z-index:9000;padding:0 12px 12px;box-sizing:border-box;font-family:Manrope,system-ui,sans-serif;color:" + C.text);
    shell.id = "vpUpdatesOptin"; shell.setAttribute("role", "region"); shell.setAttribute("aria-labelledby", "vpUoTitle");
    var card = el("div", "max-width:420px;margin:0 auto;background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:16px;padding:20px 18px;box-shadow:0 12px 40px rgba(0,0,0,.5)");
    shell.appendChild(card);
    var title = el("h2", "margin:0 0 6px;font-family:" + HEAD + ";font-weight:800;font-size:19px;line-height:1.25;color:#FFFFFF", "Product updates from venueplay?");
    title.id = "vpUoTitle";
    var sub = el("p", "margin:0 0 16px;font-size:14px;line-height:1.55;color:" + C.muted, "About once a month: new games, new features and tips for your nights. Optional.");
    sub.id = "vpUoSub";
    card.appendChild(title); card.appendChild(sub);

    var form = el("div", ""); form.id = "vpUoForm"; card.appendChild(form);
    var el1 = el("label", LABEL, "Your email"); el1.setAttribute("for", "vpUoEmail");
    var email = el("input", INPUT); email.id = "vpUoEmail"; email.setAttribute("type", "email"); email.setAttribute("autocomplete", "email");
    email.setAttribute("inputmode", "email"); email.setAttribute("maxlength", "254"); email.setAttribute("placeholder", "you@example.com");
    var tickRow = el("label", "display:flex;gap:10px;align-items:flex-start;margin:0 0 16px;font-size:14px;line-height:1.5;color:" + C.text + ";cursor:pointer");
    tickRow.setAttribute("for", "vpUoTick");
    var tick = el("input", "flex:0 0 auto;width:20px;height:20px;margin:1px 0 0;accent-color:" + C.pink);
    tick.id = "vpUoTick"; tick.setAttribute("type", "checkbox");
    tick.checked = false;   // UNTICKED by default: the tick is the consent (Spam Act)
    var tickText = el("span", "", CONSENT); tickText.id = "vpUoTickText";
    tickRow.appendChild(tick); tickRow.appendChild(tickText);
    var row = el("div", "display:flex;gap:10px");
    var save = el("button", BTN_PINK, "Save"); save.id = "vpUoSave"; save.setAttribute("type", "button");
    var later = el("button", BTN_QUIET, "Not now"); later.id = "vpUoLater"; later.setAttribute("type", "button");
    row.appendChild(save); row.appendChild(later);
    form.appendChild(el1); form.appendChild(email); form.appendChild(tickRow); form.appendChild(row);
    var msg = el("p", "margin:10px 0 0;font-size:14px;line-height:1.5;color:" + C.pinkSoft + ";min-height:1px", ""); msg.id = "vpUoMsg"; msg.setAttribute("role", "status");
    card.appendChild(msg);
    doc.body.appendChild(shell);

    var busy = false;
    function close() { if (shell.parentNode) shell.parentNode.removeChild(shell); }
    /* Not now (or Save with the tick off): the Worker records that we asked, and NO email goes with it. */
    function notNow() {
      if (busy) return Promise.resolve(false);
      busy = true; close();
      return post(deps, "/account/updates-optin", { opt_in: false }).then(function () { return true; });
    }
    function doSave() {
      if (busy) return Promise.resolve(false);
      if (!tick.checked) return notNow();
      var e = validEmail(email.value);
      if (!e) { msg.textContent = email.value ? "That email address doesn't look right. Check it and try again." : "Pop your email in first, or press Not now."; return Promise.resolve(false); }
      busy = true; save.disabled = true; later.disabled = true; save.textContent = "Saving..."; msg.textContent = "";
      return post(deps, "/account/updates-optin", { email: e, opt_in: true }).then(function (r) {
        busy = false; save.disabled = false; later.disabled = false; save.textContent = "Save";
        if (!r || r.error || !r.ok) { msg.textContent = (r && r.error && r.error !== "failed" && r.error !== "offline") ? String(r.error) : "That didn't save just now. Try again later."; return false; }
        if (form.parentNode) form.parentNode.removeChild(form);
        title.textContent = "You're on the list";
        sub.textContent = "Thanks. Updates go to " + e + ", about once a month. Every one has an unsubscribe link.";
        var done = el("button", BTN_PINK, "Done"); done.id = "vpUoDone"; done.setAttribute("type", "button");
        done.addEventListener("click", close);
        card.appendChild(done);
        return true;
      });
    }
    save.addEventListener("click", doSave);
    later.addEventListener("click", notNow);
    email.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doSave(); } });
    return { el: shell, save: doSave, notNow: notNow };
  }

  root.VPUpdatesOptin = { CONSENT: CONSENT, wants: wants, maybe: maybe, open: open, validEmail: validEmail };
})(typeof window !== "undefined" ? window : this);
