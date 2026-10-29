/* "YOUR NAME AND MOBILE": the first screen after the one-off sign-in link (Dean, 29 Oct 2026).

   "we don't actually get the email addresses of the host so it's got to be phone number... when they
   sign up on boarding they get a link that is a one off link that gets them to ask the first question
   name and phone number... Automatic sign in they click it once that's it"

   Shown to a signed-in venue login (owner, manager or host) whose login has NO mobile on it, before
   anything else in the console: the one-off link (/app/go) signs them in, and this asks two things.

     name    goes on their login (Auth user_metadata.full_name, with the phone change below) and on
             their venue staff rows (POST /account/my-name), so HQ and the Hosts list show who they are.
     mobile  goes on their login ONLY after they type the code texted to it: Supabase Auth's own phone
             change (updateUser, then verifyOtp type "phone_change"), which keeps the new number pending
             until it is verified. It is stored as Auth stores every sign-in number (+614XXXXXXXX, the
             same toE164 the sign-in page uses), so from then on they sign in with it by text code.

   WHY THE TEXT CODE BEFORE IT IS SAVED. That number becomes the key to the venue's account and the opt-in
   player data behind it. A typo saved unchecked would either lock them out at the 4 hour sign-out (their
   one-off link is spent by then) or hand the login to whoever owns the mistyped number. One code now also
   proves texts reach them before they depend on it.

   WHEN TEXTS DO NOT ARRIVE (the 21 Oct outage): once a code has been asked for, "Code not arriving? Carry
   on for now" saves the name and lets them in for this sign-in only. It asks again next time.

   HQ View as never sees it (the console only calls it for a staff login). The 4 hour sign-out is not
   touched: this is a screen of the signed-in console, nothing more. Everything a person reads is set with
   textContent; nothing they typed is ever parsed as HTML. No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  var BILLING_API = "https://venueplay-api.dean-tindale.workers.dev";
  var LATER = "vpAboutYouLater:";   // sessionStorage, per login: "carry on for now" holds for this sign-in only
  /* "This sign-in" is this shift: the flag holds the shift's start (vpShiftStart, set at every sign-in), so a
     new sign-in in the same tab, after the 4 hour sign-out, asks again. */
  function shiftNow(shift) {
    if (shift && typeof shift.getItem === "function") { try { return shift.getItem("vpShiftStart") || ""; } catch (e) { return ""; } }
    try { return (root.localStorage && root.localStorage.getItem("vpShiftStart")) || ""; } catch (e) { return ""; }
  }

  var C = { ink: "#0A0A0B", ink2: "#141418", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#8A8A94", line: "rgba(255,255,255,.12)", ok: "#2BD47D" };
  var FONT = "font-family:Manrope,system-ui,sans-serif";
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var BTN = "display:block;width:100%;min-height:48px;padding:13px 20px;border-radius:12px;border:none;font:700 15px/1.4 " + HEAD + ";cursor:pointer;box-sizing:border-box;outline-color:" + C.pinkSoft;
  var BTN_PINK = BTN + ";background:" + C.pink + ";color:#0A0A0B";
  var INPUT = "display:block;width:100%;box-sizing:border-box;min-height:48px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:" + C.ink + ";color:#FFFFFF;font:inherit;font-size:16px;margin:0 0 14px;outline-color:" + C.pink;
  var LABEL = "display:block;font-size:13px;font-weight:700;color:" + C.muted + ";margin:0 0 6px";

  /* An Australian mobile as Auth stores a sign-in number: +614XXXXXXXX. Anything else is refused before a
     text is sent. Same answer as the sign-in page's toE164 for every 04 number. */
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
  function cleanName(raw) { return String(raw || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60); }
  function nameGuess(ctx) {
    var u = ctx && ctx.user, m = (u && u.user_metadata) || {};
    var n = cleanName(m.full_name || m.name || "");
    if (n) return n;
    var mine = ((ctx && ctx.staff) || []).filter(function (s) { return s && s.display_name; })[0];
    n = cleanName(mine && mine.display_name);
    return /^(manager|owner|host)$/i.test(n) ? "" : n;
  }

  /* Who sees it: a venue login, signed in, with no mobile on it, that has not said "carry on" this sign-in. */
  function wants(ctx, storage, shift) {
    if (!ctx || !ctx.authed || ctx.isAdmin || ctx.scope !== "staff" || !ctx.user || !ctx.user.id) return false;
    if (ctx.user.phone) return false;
    var later = null; try { later = (storage || root.sessionStorage).getItem(LATER + ctx.user.id); } catch (e) {}
    return later === null || later !== "shift:" + shiftNow(shift);
  }

  function open(ctx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document, storage = deps.storage || root.sessionStorage;
    var fetchFn = deps.fetch || (root.fetch && root.fetch.bind(root));
    var client = deps.client;
    var done = typeof deps.onDone === "function" ? deps.onDone : function () {};
    var v = (ctx && ctx.venue) || {};

    function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
    function saveName(name) {
      if (!client || !client.auth || !fetchFn) return Promise.resolve({ error: "offline" });
      return client.auth.getSession().then(function (r) {
        var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
        return fetchFn(BILLING_API + "/account/my-name", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
          body: JSON.stringify({ name: name }) }).then(function (res) { return res.json().catch(function () { return {}; }); });
      }).catch(function () { return { error: "offline" }; });
    }

    var old = doc.getElementById("vpAboutYou"); if (old && old.parentNode) old.parentNode.removeChild(old);
    var shell = el("div", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9100;overflow-y:auto;background:#0A0A0B;" + FONT + ";color:" + C.text + ";padding:0 16px;box-sizing:border-box");
    shell.id = "vpAboutYou"; shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true"); shell.setAttribute("aria-labelledby", "vpAyTitle");
    var box = el("div", "max-width:420px;margin:0 auto;padding:9vh 0 40px");
    shell.appendChild(box);
    /* The same mark as the sign-in page above it, so this reads as the next step of signing in. */
    var logo = el("div", "display:flex;align-items:center;justify-content:center;gap:11px;margin:0 0 18px");
    var mark = doc.createElementNS ? doc.createElementNS("http://www.w3.org/2000/svg", "svg") : null;
    if (mark && mark.setAttribute) {
      mark.setAttribute("width", "26"); mark.setAttribute("height", "30"); mark.setAttribute("viewBox", "0 0 26 30"); mark.setAttribute("aria-hidden", "true");
      mark.setAttribute("style", "filter:drop-shadow(0 0 4px rgba(255,31,142,.9)) drop-shadow(0 0 12px rgba(255,31,142,.4))");
      var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M2 3 L24 15 L2 27 Z"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "#FF1F8E"); path.setAttribute("stroke-width", "2.6"); path.setAttribute("stroke-linejoin", "round");
      mark.appendChild(path); logo.appendChild(mark);
    }
    logo.appendChild(el("span", "font-family:" + HEAD + ";font-weight:800;font-size:22px;color:#FFFFFF", "VenuePlay"));
    box.appendChild(logo);
    var title = el("h1", "margin:0 0 10px;font-family:Anton,sans-serif;font-weight:400;text-transform:uppercase;font-size:32px;line-height:1.05;color:#FFFFFF;text-align:center", "You're in");
    title.id = "vpAyTitle";
    var sub = el("p", "margin:0 0 22px;font-size:15px;line-height:1.55;color:" + C.muted + ";text-align:center",
      "Welcome to VenuePlay" + (v.name ? " at " + v.name : "") + ". Two quick things, then you're done: your name, and the mobile you'll sign in with from now on.");
    sub.id = "vpAySub";
    box.appendChild(title); box.appendChild(sub);
    var card = el("div", "background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:16px;padding:22px 20px");
    box.appendChild(card);

    var form = el("div", ""); form.id = "vpAyForm"; card.appendChild(form);
    var nl = el("label", LABEL, "Your name"); nl.setAttribute("for", "vpAyName");
    var name = el("input", INPUT); name.id = "vpAyName"; name.setAttribute("type", "text"); name.setAttribute("autocomplete", "name"); name.setAttribute("maxlength", "60"); name.setAttribute("placeholder", "First and last name");
    name.value = nameGuess(ctx);
    var ml = el("label", LABEL, "Your mobile"); ml.setAttribute("for", "vpAyMobile");
    var mobile = el("input", INPUT); mobile.id = "vpAyMobile"; mobile.setAttribute("type", "tel"); mobile.setAttribute("inputmode", "tel"); mobile.setAttribute("autocomplete", "tel"); mobile.setAttribute("placeholder", "0400 000 000");
    var send = el("button", BTN_PINK, "Text me a code"); send.id = "vpAySend"; send.setAttribute("type", "button");
    var why = el("p", "margin:12px 0 0;font-size:13px;line-height:1.5;color:" + C.faint, "We text a code to check it's yours. It only goes on your login once you type that code in.");
    form.appendChild(nl); form.appendChild(name); form.appendChild(ml); form.appendChild(mobile); form.appendChild(send); form.appendChild(why);

    var codeWrap = el("div", "display:none"); codeWrap.id = "vpAyCodeWrap"; card.appendChild(codeWrap);
    var cl = el("label", LABEL, "The 6-digit code we texted you"); cl.setAttribute("for", "vpAyCode");
    var code = el("input", INPUT + ";font:700 24px/1.2 'JetBrains Mono',ui-monospace,monospace;text-align:center;letter-spacing:.3em"); code.id = "vpAyCode";
    code.setAttribute("inputmode", "numeric"); code.setAttribute("autocomplete", "one-time-code"); code.setAttribute("maxlength", "6"); code.setAttribute("placeholder", "------");
    var verify = el("button", BTN_PINK, "Confirm"); verify.id = "vpAyVerify"; verify.setAttribute("type", "button");
    var sentTo = el("p", "margin:12px 0 0;font-size:13px;line-height:1.5;color:" + C.faint, ""); sentTo.id = "vpAySentTo";
    var links = el("div", "display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px");
    function linkBtn(id, text) { var b = el("button", "background:none;border:none;padding:4px 0;color:" + C.pinkSoft + ";font:600 13.5px/1.4 Manrope,system-ui,sans-serif;text-decoration:underline;cursor:pointer", text); b.id = id; b.setAttribute("type", "button"); return b; }
    var again = linkBtn("vpAyAgain", "Change the number");
    var later = linkBtn("vpAyLater", "Code not arriving? Carry on for now");
    links.appendChild(again); links.appendChild(later);
    codeWrap.appendChild(cl); codeWrap.appendChild(code); codeWrap.appendChild(verify); codeWrap.appendChild(sentTo); codeWrap.appendChild(links);

    var msg = el("p", "margin:12px 0 0;font-size:14px;line-height:1.5;color:" + C.pinkSoft + ";min-height:1px", ""); msg.id = "vpAyMsg"; msg.setAttribute("role", "status");
    card.appendChild(msg);
    doc.body.appendChild(shell);

    var pending = "", sending = false, verifying = false;
    function finish(how) { if (shell.parentNode) shell.parentNode.removeChild(shell); done(how); }

    function ask() {
      var n = cleanName(name.value), ph = mobileE164(mobile.value);
      if (!n) { msg.textContent = "Pop your name in first."; return Promise.resolve(false); }
      if (!ph) { msg.textContent = mobile.value ? "That doesn't look like an Australian mobile. It should start 04." : "Pop your mobile in so we can text you a code."; return Promise.resolve(false); }
      if (sending) return Promise.resolve(false);
      sending = true; send.disabled = true; send.textContent = "Sending..."; msg.textContent = "";
      return client.auth.updateUser({ phone: ph, data: { full_name: n } }).then(function (r) {
        sending = false; send.disabled = false; send.textContent = "Text me a code";
        if (r && r.error) {
          var m = String(r.error.message || "") + " " + String(r.error.code || "");
          msg.textContent = /already|registered|exists/i.test(m)
            ? "That mobile already signs in to VenuePlay on another login. Call us on 07 5228 3667 or email support@venueplay.com.au and we'll join them up."
            : "We couldn't text that number just now. Check it and try again.";
          return false;
        }
        pending = ph;
        form.style.display = "none"; codeWrap.style.display = "block";
        sentTo.textContent = "We sent it to " + mobileShow(ph) + ". It can take a minute.";
        try { code.focus(); } catch (e) {}
        return true;
      }, function () { sending = false; send.disabled = false; send.textContent = "Text me a code"; msg.textContent = "We couldn't text that number just now. Check it and try again."; return false; });
    }
    function confirmCode() {
      var c = String(code.value || "").replace(/[^0-9]/g, "");
      if (c.length !== 6) { msg.textContent = "Type the 6-digit code from the text."; return Promise.resolve(false); }
      if (verifying) return Promise.resolve(false);
      verifying = true; verify.disabled = true; verify.textContent = "Checking..."; msg.textContent = "";
      return client.auth.verifyOtp({ phone: pending, token: c, type: "phone_change" }).then(function (r) {
        verifying = false; verify.disabled = false; verify.textContent = "Confirm";
        var u = r && r.data && r.data.user;
        if (!r || r.error || !u || !u.phone) { msg.textContent = "That code didn't match. Check the text and try again."; return false; }
        if (ctx.user) ctx.user.phone = String(u.phone);
        var n = cleanName(name.value);
        return saveName(n).then(function () { showDone(String(u.phone), n); return true; });
      }, function () { verifying = false; verify.disabled = false; verify.textContent = "Confirm"; msg.textContent = "That code didn't match. Check the text and try again."; return false; });
    }
    function showDone(phone, n) {
      while (card.firstChild) card.removeChild(card.firstChild);
      title.textContent = "All set" + (n ? ", " + n.split(" ")[0] : "");
      sub.textContent = "From now on, sign in with " + mobileShow(phone) + " and we'll text you a code. Nothing to remember.";
      var go = el("button", BTN_PINK, "Let's go"); go.id = "vpAyGo"; go.setAttribute("type", "button");
      go.addEventListener("click", function () { finish("done"); });
      card.appendChild(go);
      try { go.focus(); } catch (e) {}
    }
    function carryOn() {
      var n = cleanName(name.value);
      try { storage.setItem(LATER + ctx.user.id, "shift:" + shiftNow(deps.shift)); } catch (e) {}
      return saveName(n).then(function () { finish("later"); return true; });
    }

    send.addEventListener("click", ask);
    verify.addEventListener("click", confirmCode);
    again.addEventListener("click", function () { pending = ""; codeWrap.style.display = "none"; form.style.display = "block"; code.value = ""; msg.textContent = ""; try { mobile.focus(); } catch (e) {} });
    later.addEventListener("click", carryOn);
    mobile.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ask(); } });
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); try { mobile.focus(); } catch (x) {} } });
    code.addEventListener("input", function () { code.value = String(code.value || "").replace(/\D/g, "").slice(0, 6); msg.textContent = ""; });
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); confirmCode(); } });
    try { (name.value ? mobile : name).focus(); } catch (e) {}

    return { el: shell, ask: ask, confirmCode: confirmCode, carryOn: carryOn };
  }

  root.VPAboutYou = { open: open, wants: wants, mobileE164: mobileE164, mobileShow: mobileShow, cleanName: cleanName, LATER: LATER };
})(typeof window !== "undefined" ? window : this);
