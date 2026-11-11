/* "CHANGE MY MOBILE" on the account page (INBOX 138, Dean, 8 Nov 2026).

   "Today a venue login sets its mobile once (first sign-in, text code checked) and can't change it later."
   Now it can, from People on the account page (billing.html):

     new number   typed, and checked with the sign-in page's rules (VPAboutYou.mobileE164, the one copy in
                  vp-about-you.js: an Australian mobile, stored as Auth stores a sign-in number, +614XXXXXXXX)
     text code    sent to the NEW number by Supabase Auth's own phone change (updateUser({ phone })), the
                  same flow the first-sign-in screen uses. Auth keeps the new number PENDING: the login
                  still signs in with the old one until the code is typed
     saved        only by verifyOtp({ type: "phone_change" }) with that code. From then on the old number
                  no longer signs in; the new one does, by text code. Their sign-in today carries on

   "Code not arriving? Send it again" asks Auth for a fresh code to the same new number (auth.resend, or the
   phone change again on an older client), and waits 30 seconds before it can be asked again.

   A number already on another venueplay login is refused by Auth and said plainly. HQ View as never sees
   this (billing.html does not mount it then): a Gflam admin changing a venue's mobile does it from HQ.
   Everything a person reads is set with textContent. No em dashes in anything a person reads.

   tools/test-change-mobile.js runs this file with a fake page and a fake Auth. */
(function (root) {
  "use strict";
  var RESEND_WAIT_MS = 30000;

  function toE164(raw) { var A = root.VPAboutYou; return (A && typeof A.mobileE164 === "function") ? A.mobileE164(raw) : ""; }
  function show(e164) { var A = root.VPAboutYou; return (A && typeof A.mobileShow === "function") ? A.mobileShow(e164) : String(e164 || ""); }
  function digits(s) { return String(s || "").replace(/[^0-9]/g, ""); }

  var WORDS = {
    noNumber: "Type your new mobile first.",
    notMobile: "That doesn't look like an Australian mobile. It should start 04.",
    same: "That's the mobile you sign in with now.",
    taken: "That mobile already signs in to venueplay on another login. Use a different mobile.",
    cantSend: "We couldn't text that number just now. Check it and try again.",
    noCode: "Type the 6-digit code from the text.",
    badCode: "That code didn't match. Check the text and try again.",
    resent: "Sent again. It can take a minute.",
    wait: "Give it 30 seconds, then you can ask again."
  };

  function mount(host, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document;
    var client = deps.client;
    var onChanged = typeof deps.onChanged === "function" ? deps.onChanged : function () {};
    var now = typeof deps.now === "function" ? deps.now : function () { return Date.now(); };
    if (!host || !client || !client.auth) return null;

    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(cls, id, text) { var b = el("button", cls, text); b.id = id; b.setAttribute("type", "button"); return b; }

    var current = String(deps.phone || "");
    var row = el("div", "hostrow"); row.id = "myMobileRow";
    var hn = el("div", "hn");
    var head = el("b", null, "Your mobile");
    var now1 = el("small", null, ""); now1.id = "myMobileNow";
    hn.appendChild(head); hn.appendChild(now1);
    var open = btn("edv", "myMobileBtn", "Change my mobile");
    row.appendChild(hn); row.appendChild(open);

    var panel = el("div", "cmpanel"); panel.id = "cmPanel"; panel.style.display = "none";
    row.appendChild(panel);

    var step1 = el("div", "cmstep"); step1.id = "cmStep1";
    var ml = el("label", "flabel", "New mobile"); ml.setAttribute("for", "cmMobile");
    var mobile = el("input", null); mobile.id = "cmMobile"; mobile.setAttribute("type", "tel"); mobile.setAttribute("inputmode", "tel");
    mobile.setAttribute("autocomplete", "tel"); mobile.setAttribute("placeholder", "0400 000 000");
    var a1 = el("div", "cmactions");
    var send = btn("go", "cmSend", "Text me a code");
    var cancel = btn("canxlink", "cmCancel", "Cancel");
    a1.appendChild(send); a1.appendChild(cancel);
    var why = el("p", "note cmnote", "We text a code to the new number. It only goes on your login once you type that code in.");
    step1.appendChild(ml); step1.appendChild(mobile); step1.appendChild(a1); step1.appendChild(why);

    var step2 = el("div", "cmstep"); step2.id = "cmStep2"; step2.style.display = "none";
    var cl = el("label", "flabel", "The 6-digit code we texted you"); cl.setAttribute("for", "cmCode");
    var code = el("input", "cmcode"); code.id = "cmCode"; code.setAttribute("inputmode", "numeric"); code.setAttribute("autocomplete", "one-time-code");
    code.setAttribute("maxlength", "6"); code.setAttribute("placeholder", "6-digit code");
    var a2 = el("div", "cmactions");
    var verify = btn("go", "cmVerify", "Confirm");
    var cancel2 = btn("canxlink", "cmCancel2", "Cancel");
    a2.appendChild(verify); a2.appendChild(cancel2);
    var sentTo = el("p", "note cmnote", ""); sentTo.id = "cmSentTo";
    var links = el("div", "cmactions");
    var resend = btn("canxlink", "cmResend", "Code not arriving? Send it again");
    var again = btn("canxlink", "cmAgain", "Use a different number");
    links.appendChild(resend); links.appendChild(again);
    step2.appendChild(cl); step2.appendChild(code); step2.appendChild(a2); step2.appendChild(sentTo); step2.appendChild(links);

    var msg = el("p", "note cmmsg", ""); msg.id = "cmMsg"; msg.setAttribute("role", "status");
    panel.appendChild(step1); panel.appendChild(step2); panel.appendChild(msg);
    host.appendChild(row);

    var pending = "", busy = false, lastSent = 0;
    function paintNow() { now1.textContent = current ? ("You sign in with " + show(current) + ".") : "No mobile on your login yet."; }
    paintNow();
    function say(t, good) { msg.textContent = t || ""; msg.className = "note cmmsg" + (good ? " ok" : ""); }
    function toStep1() { pending = ""; code.value = ""; step2.style.display = "none"; step1.style.display = "block"; try { mobile.focus(); } catch (e) {} }
    function close() { panel.style.display = "none"; mobile.value = ""; toStep1(); say(""); }
    function isTaken(err) { var m = String((err && err.message) || "") + " " + String((err && err.code) || ""); return /already|registered|exists|taken/i.test(m); }

    function ask() {
      if (busy) return Promise.resolve(false);
      var raw = mobile.value, ph = toE164(raw);
      if (!ph) { say(String(raw || "").trim() ? WORDS.notMobile : WORDS.noNumber); return Promise.resolve(false); }
      if (current && digits(current) === digits(ph)) { say(WORDS.same); return Promise.resolve(false); }
      busy = true; send.disabled = true; send.textContent = "Sending..."; say("");
      return Promise.resolve(client.auth.updateUser({ phone: ph })).then(function (r) {
        busy = false; send.disabled = false; send.textContent = "Text me a code";
        if (r && r.error) { say(isTaken(r.error) ? WORDS.taken : WORDS.cantSend); return false; }
        pending = ph; lastSent = now();
        step1.style.display = "none"; step2.style.display = "block";
        sentTo.textContent = "We sent it to " + show(ph) + ". It can take a minute.";
        try { code.focus(); } catch (e) {}
        return true;
      }, function () { busy = false; send.disabled = false; send.textContent = "Text me a code"; say(WORDS.cantSend); return false; });
    }

    function sendAgain() {
      if (!pending || busy) return Promise.resolve(false);
      if (now() - lastSent < RESEND_WAIT_MS) { say(WORDS.wait); return Promise.resolve(false); }
      busy = true; resend.disabled = true; say("");
      var p = (typeof client.auth.resend === "function")
        ? client.auth.resend({ type: "phone_change", phone: pending })
        : client.auth.updateUser({ phone: pending });
      return Promise.resolve(p).then(function (r) {
        busy = false; resend.disabled = false;
        if (r && r.error) { say(WORDS.cantSend); return false; }
        lastSent = now(); say(WORDS.resent, true); return true;
      }, function () { busy = false; resend.disabled = false; say(WORDS.cantSend); return false; });
    }

    function confirmCode() {
      if (busy || !pending) return Promise.resolve(false);
      var c = digits(code.value);
      if (c.length !== 6) { say(WORDS.noCode); return Promise.resolve(false); }
      busy = true; verify.disabled = true; verify.textContent = "Checking..."; say("");
      return Promise.resolve(client.auth.verifyOtp({ phone: pending, token: c, type: "phone_change" })).then(function (r) {
        busy = false; verify.disabled = false; verify.textContent = "Confirm";
        var u = r && r.data && r.data.user;
        if (!r || r.error || !u || !u.phone || digits(u.phone) !== digits(pending)) { say(WORDS.badCode); return false; }
        current = String(u.phone); pending = "";
        paintNow();
        panel.style.display = "none"; mobile.value = ""; code.value = ""; step2.style.display = "none"; step1.style.display = "block";
        var done = "Done. You now sign in with " + show(current) + ". Your old number no longer works.";
        now1.textContent = done;
        onChanged(current, done);
        return true;
      }, function () { busy = false; verify.disabled = false; verify.textContent = "Confirm"; say(WORDS.badCode); return false; });
    }

    open.addEventListener("click", function () {
      if (panel.style.display === "none") { panel.style.display = "block"; toStep1(); say(""); } else close();
    });
    send.addEventListener("click", ask);
    verify.addEventListener("click", confirmCode);
    resend.addEventListener("click", sendAgain);
    again.addEventListener("click", function () { toStep1(); say(""); });
    cancel.addEventListener("click", close);
    cancel2.addEventListener("click", close);
    mobile.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ask(); } });
    code.addEventListener("input", function () { code.value = digits(code.value).slice(0, 6); });
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); confirmCode(); } });

    return { el: row, ask: ask, confirmCode: confirmCode, sendAgain: sendAgain, close: close, current: function () { return current; } };
  }

  root.VPChangeMobile = { mount: mount, WORDS: WORDS, RESEND_WAIT_MS: RESEND_WAIT_MS };
})(typeof window !== "undefined" ? window : this);
