/* THE NO-CARD START ON THE OFFER PAGE (Dean, 5 Nov 2026; INBOX 80B, 81, 93, 96, as changed by 97).

   "Have a play for free": five boxes (venue, postcode, your name, mobile, email) and pub or club (Dean, 6 Nov 2026:
   asked here so a club has bingo, raffles and members draws open without HQ), a 6-digit code texted to
   the mobile, then one of two screens:
     made   (a venue name and a postcode are enough, Dean 6 Nov 2026; one not on our licensed list is flagged for HQ)
            "Your trivia night is ready." / "Your venue is set up with sample nights to try it." /
            "Your free month starts when you open your host console." then "To see it on your TV, go to venueplay.com.au/tv and type
            this code: ABC123", a slot for the try-it demo (JOB B1, fix/try-demo-10nov) and a way in.
     held   "Thanks, we'll check your venue and get you set up, usually within a business day."
            (the mobile or email is already on venueplay: one free month per mobile and per email).
   The billing Worker decides everything (POST /start/begin, /start/verify, /start/resend); this file only
   draws it. Nothing is made before the code passes, and nothing here is ever billed.

   The forms are REAL <form>s already in the page (venueplay/nsw.html, #start), each box with name= and
   autocomplete= (organization, postal-code, name, tel, email, one-time-code), the vp-details.js pattern, so
   iPhone and Android autofill fill them and the iPhone offers the code from the text. Each form's submit
   button is a real submit: a tap and the keyboard's Go both work, and nothing navigates.

   THE CODE BOXES: six boxes spaced out (Dean: "easy to read and type"). The FIRST carries
   autocomplete="one-time-code" and takes a whole code (autofill or paste) and spreads it across the six.

   NOT SWITCHED ON YET (the Worker answers off: true before migration 170 or without the SMS settings): the
   page falls back to Friday's stopgap, the Talk to us form set to "Set me up a free account", with what they
   typed already in it (window.VPFreeAccountEnquiry, nsw.html). So the button never leads nowhere.

   For the try-it demo (JOB B1): when an account is made this fires `vp-start-done` on document with
   { venue, tv_code, go_url, slug, players } and fills window.VPStart.done the same way. The demo draws into
   #st-try-slot, which is in the done screen and hidden until something is put in it.

   No em dashes, lowercase venueplay, trivia first. */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = root.VP_START_API || "https://api.venueplay.com.au";
  var WORDS = {
    held: "Thanks, we'll check your venue and get you set up, usually within a business day.",   // the Worker's words, character for character
    blip: "We couldn’t reach venueplay just then. Check your connection and press the button again.",
    resent: "We’ve sent a new code. It can take a minute to arrive.",
    six: "Type the 6 numbers from the text."
  };
  var S = { id: null, mobile: "", busy: false, ts: null, tsId: null, done: null };

  function $(id) { return doc.getElementById(id); }
  function show(step) {
    ["st-form", "st-code", "st-done", "st-held"].forEach(function (id) { var e = $(id); if (e) e.hidden = id !== step; });
    var e = $(step);
    if (e && e.scrollIntoView) { try { e.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (x) {} }
  }
  function err(id, text) {
    var e = $(id); if (!e) return;
    e.textContent = text || "";
    e.classList.toggle("show", !!text);
  }
  function busy(btn, on, label) {
    S.busy = on;
    if (!btn) return;
    btn.disabled = on;
    if (label) btn.textContent = label;
  }
  function post(path, body) {
    return root.fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j._status = r.status; return j; }); });
  }
  function val(id) { var e = $(id); return e ? String(e.value || "").trim() : ""; }

  /* ---- Cloudflare Turnstile, only when the Worker has a site key (the help desk's own switch) ---- */
  function turnstile() {
    var box = $("st-ts"); if (!box) return;
    root.fetch(API + "/help/config?brand=venueplay").then(function (r) { return r.json(); }).then(function (j) {
      var key = j && j.turnstile; if (!key) return;
      var sc = doc.createElement("script"); sc.async = true;
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      sc.onload = function () {
        if (!root.turnstile) return;
        S.ts = root.turnstile;
        try { S.tsId = S.ts.render(box, { sitekey: key, appearance: "interaction-only", theme: "dark", action: "start" }); } catch (e) {}
      };
      doc.head.appendChild(sc);
    }).catch(function () {});
  }
  function tsToken() {
    try { return S.ts && S.tsId != null ? (S.ts.getResponse(S.tsId) || "") : ""; } catch (e) { return ""; }
  }

  /* ---- step 1: the five boxes ---- */
  function details() {
    var k = doc.querySelector('#st-form input[name="venue-kind"]:checked');
    return { venue: val("st-venue"), postcode: val("st-postcode"), kind: k ? k.value : "", name: val("st-name"), mobile: val("st-mobile"), email: val("st-email") };
  }
  function begin(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return;
    err("st-err", "");
    var d = details(), btn = $("st-go");
    var miss = !d.venue ? ["st-venue", "Enter your venue’s name."] : !/^\d{4}$/.test(d.postcode) ? ["st-postcode", "Enter your venue’s 4-digit postcode."]
      : !d.kind ? ["st-kind-pub", "Choose pub or club."]
      : !d.name ? ["st-name", "Enter your name."] : !d.mobile ? ["st-mobile", "Enter your mobile. We text your code to it."]
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? ["st-email", "Enter your email."] : null;
    if (miss) { err("st-err", miss[1]); var m = $(miss[0]); if (m) m.focus(); return; }
    var body = { venue: d.venue, postcode: d.postcode, kind: d.kind, name: d.name, mobile: d.mobile, email: d.email,
      website: val("st-website"), turnstile: tsToken() };
    busy(btn, true, "Sending your code…");
    post("/start/begin", body).then(function (j) {
      busy(btn, false, "Have a play for free");
      if (j.ok && j.start_id) {
        S.id = j.start_id; S.mobile = d.mobile; S.kind = d.kind;
        var end = $("st-end"); if (end) end.textContent = String(d.mobile).replace(/\D/g, "").slice(-3);
        clearCode(); show("st-code");
        var c = $("st-c1"); if (c) c.focus();
        return;
      }
      // Not switched on, or a Worker from before the start (no route: 404): Friday's Talk to us form, filled in.
      if ((j.off || j._status === 404) && typeof root.VPFreeAccountEnquiry === "function") { root.VPFreeAccountEnquiry(d); return; }
      err("st-err", j.error || WORDS.blip);
      if (j.field) { var f = $(j.field === "kind" ? "st-kind-pub" : "st-" + j.field); if (f) f.focus(); }
      try { if (S.ts && S.tsId != null) S.ts.reset(S.tsId); } catch (e) {}
    }, function () { busy(btn, false, "Have a play for free"); err("st-err", WORDS.blip); });
  }

  /* ---- step 2: the code, six boxes ---- */
  function boxes() { var a = []; for (var i = 1; i <= 6; i++) a.push($("st-c" + i)); return a; }
  function clearCode() { boxes().forEach(function (b) { if (b) b.value = ""; }); err("st-cerr", ""); }
  function code() { return boxes().map(function (b) { return b ? String(b.value || "").replace(/\D/g, "").slice(0, 1) : ""; }).join(""); }
  function spread(from, digits) {
    var bs = boxes(), i = from;
    for (var k = 0; k < digits.length && i < 6; k++, i++) bs[i].value = digits[k];
    var next = bs[Math.min(i, 5)]; if (next) next.focus();
    if (code().length === 6) check();
  }
  function wireBoxes() {
    var bs = boxes();
    bs.forEach(function (b, i) {
      if (!b) return;
      b.addEventListener("input", function () {
        var dg = String(b.value || "").replace(/\D/g, "");
        if (dg.length > 1) { b.value = ""; spread(i, dg); return; }   // autofill or a paste: the whole code
        b.value = dg;
        if (dg && i < 5) bs[i + 1].focus();
        if (code().length === 6) check();
      });
      b.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !b.value && i > 0) { bs[i - 1].focus(); bs[i - 1].value = ""; e.preventDefault(); }
      });
      b.addEventListener("paste", function (e) {
        var t = ((e.clipboardData || root.clipboardData) || { getData: function () { return ""; } }).getData("text");
        var dg = String(t || "").replace(/\D/g, "");
        if (dg) { e.preventDefault(); spread(i, dg); }
      });
    });
  }
  function check(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return;
    var c = code();
    if (c.length !== 6) { err("st-cerr", WORDS.six); return; }
    err("st-cerr", "");
    var btn = $("st-check");
    busy(btn, true, "Checking…");
    post("/start/verify", { start_id: S.id, code: c, kind: S.kind }).then(function (j) {
      busy(btn, false, "Check my code");
      if (j.ok && j.outcome === "made") return done(j);
      if (j.ok) { var h = $("st-held-words"); if (h) h.textContent = j.message || WORDS.held; show("st-held"); return; }
      err("st-cerr", j.error || WORDS.blip);
      if (j.gone || j._status === 400) { clearCode(); var f = $("st-c1"); if (f) f.focus(); }
    }, function () { busy(btn, false, "Check my code"); err("st-cerr", WORDS.blip); });
  }
  function resend() {
    if (!S.id) return;
    post("/start/resend", { start_id: S.id }).then(function () { clearCode(); err("st-cerr", WORDS.resent); }, function () { err("st-cerr", WORDS.blip); });
  }

  /* ---- the done screen ---- */
  function done(j) {
    var d = { venue: j.venue || val("st-venue"), tv_code: j.tv_code || "", go_url: j.go_url || "", slug: j.slug || "", players: j.players || 10 };
    S.done = d;
    var tc = $("st-tvcode"); if (tc) tc.textContent = d.tv_code;
    var line = $("st-tvline"); if (line) line.hidden = !d.tv_code;
    var open = $("st-open"); if (open) open.setAttribute("href", d.go_url || "/app");
    show("st-done");
    root.VPStart.done = d;
    try { doc.dispatchEvent(new root.CustomEvent("vp-start-done", { detail: d })); } catch (e) {}
  }

  function mount() {
    var f = $("st-form"), c = $("st-code");
    if (!f || !c) return;
    f.addEventListener("submit", begin);
    c.addEventListener("submit", check);
    wireBoxes();
    var r = $("st-resend"); if (r) r.addEventListener("click", resend);
    var ch = $("st-change"); if (ch) ch.addEventListener("click", function () { S.id = null; show("st-form"); var v = $("st-venue"); if (v) v.focus(); });
    turnstile();
  }

  root.VPStart = { mount: mount, done: null, _state: S };
  /* AT ONCE: the page loads this script straight after the two forms, and the rest of the page (Stripe's script among it)
     can hold DOMContentLoaded back for seconds. A press in that time must never submit the form the browser's way, which
     would reload the page with their details in the address. (Each form also says onsubmit="return false" for the same
     reason, before this file has loaded.) */
  if ($("st-form") && $("st-code")) mount(); else doc.addEventListener("DOMContentLoaded", mount);
})(this);
