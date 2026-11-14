/* vp-quick.js -- THE QUICK GAME'S FORM, CODE AND SIGN-IN (Dean, 14 Nov 2026; INBOX 412). The page is /quick (venueplay/quick.html).
   First name, mobile, venue (picker over our licensed list, or typed with a suburb), the text code, then the account is made by
   the Worker (/quick/begin, then /start/verify) and the one-tap sign-in link opens the demo on their own account
   (/app/try.html?quick=1, through the same 30 minute hand-off the offer page uses: VPTrySlot). The words and the order of the steps
   are in vp-quick-config.js. Nothing is stored here but what that hand-off needs. No em dashes, lowercase venueplay. */
(function (root) {
  "use strict";
  var doc = root.document, Q = root.VPQuick, API = Q.cfg.API;
  var WORDS = { blip: "We couldn’t reach venueplay just then. Check your connection and press the button again.",
    resent: "We’ve sent a new code. It can take a minute to arrive.", six: "Type the 6 numbers from the text.",
    name: "Enter your first name.", mobile: "Enter your mobile (04...). We text your code to it.", venue: "Enter your venue’s name." };
  var S = { id: null, mobile: "", pc: "", suburb: "", busy: false, ts: null, tsId: null, timer: null, typed: "", started: false };
  function $(id) { return doc.getElementById(id); }
  function val(id) { var e = $(id); return e ? String(e.value || "").trim() : ""; }
  function err(id, t) { var e = $(id); if (e) e.textContent = t || ""; }
  function show(id) { ["qForm", "qCode", "qHeld", "qMade"].forEach(function (x) { $(x).hidden = x !== id; }); }
  function post(path, body) {
    return root.fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j._status = r.status; return j; }); });
  }
  function busy(btn, on, label) { S.busy = on; if (btn) { btn.disabled = on; if (label) btn.textContent = label; } }

  /* Cloudflare Turnstile, only when the Worker has a site key (the help desk's own switch) */
  function turnstile() {
    var box = $("qTs"); if (!box) return;
    root.fetch(API + "/help/config?brand=venueplay").then(function (r) { return r.json(); }).then(function (j) {
      var key = j && j.turnstile; if (!key) return;
      var sc = doc.createElement("script"); sc.async = true; sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      sc.onload = function () { if (!root.turnstile) return; S.ts = root.turnstile; try { S.tsId = S.ts.render(box, { sitekey: key, appearance: "interaction-only", theme: "dark", action: "quick" }); } catch (e) {} };
      doc.head.appendChild(sc);
    }).catch(function () {});
  }
  function tsToken() { try { return S.ts && S.tsId != null ? (S.ts.getResponse(S.tsId) || "") : ""; } catch (e) { return ""; } }

  /* ---- the venue picker ---- */
  function hidePick() { var p = $("qPick"); p.hidden = true; p.innerHTML = ""; $("qVenue").setAttribute("aria-expanded", "false"); }
  function drawPick(list) {
    var p = $("qPick"); p.innerHTML = "";
    list.forEach(function (m) {
      var li = doc.createElement("li"), b = doc.createElement("button"); b.type = "button"; b.setAttribute("role", "option");
      b.textContent = m.name; var s = doc.createElement("small"); s.textContent = [m.suburb, m.state, m.postcode].filter(Boolean).join(" ");
      b.appendChild(s);
      b.addEventListener("click", function () {
        $("qVenue").value = m.name; S.pc = m.postcode || ""; S.suburb = m.suburb || ""; S.typed = m.name;
        $("qSuburbRow").hidden = true; $("qPostRow").hidden = true; hidePick(); var mo = $("qMobile"); if (!val("qMobile") && mo) mo.focus();
      });
      li.appendChild(b); p.appendChild(li);
    });
    p.hidden = !list.length; $("qVenue").setAttribute("aria-expanded", list.length ? "true" : "false");
  }
  function search() {
    var q = val("qVenue");
    if (q === S.typed) return; S.typed = q; S.pc = "";   // typing again un-picks
    if (q.replace(/[^A-Za-z0-9]/g, "").length < 3) { hidePick(); return; }
    root.fetch(API + "/quick/venues?q=" + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      if (val("qVenue") !== q) return;
      var m = (j && j.matches) || [];
      drawPick(m);
      $("qSuburbRow").hidden = m.length > 0 && !S.notListed ? true : false;   // no match: ask the suburb
      if (m.length) { $("qSuburbRow").hidden = !S.notListed; }
    }).catch(function () { hidePick(); });
  }

  /* ---- step 1: the three boxes ---- */
  function begin(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return;
    var d = { name: val("qName"), mobile: val("qMobile"), venue: val("qVenue") };
    var miss = !d.name ? ["qName", WORDS.name] : !/^[0-9 +()-]{8,20}$/.test(d.mobile) ? ["qMobile", WORDS.mobile] : !d.venue ? ["qVenue", WORDS.venue] : null;
    if (miss) { err("qErr", miss[1]); var m = $(miss[0]); if (m) m.focus(); return; }
    err("qErr", "");
    var body = { name: d.name, mobile: d.mobile, venue: d.venue, postcode: S.pc || val("qPost"), suburb: S.suburb || val("qSuburb"),
      website: val("qWeb"), turnstile: tsToken() };
    var lead = /[?&]l=([A-Za-z0-9_-]{16,64})(&|$)/.exec(root.location.search || ""); if (lead) body.lead = lead[1];
    var btn = $("qGo"); busy(btn, true, "Sending your code...");
    Q.track("form_sent");
    post("/quick/begin", body).then(function (j) {
      busy(btn, false, "Text me my code");
      if (j.ok && j.start_id) {
        S.id = j.start_id; S.mobile = d.mobile;
        $("qEnd").textContent = String(d.mobile).replace(/\D/g, "").slice(-3);
        clearCode(); show("qCode"); var c = $("qc1"); if (c) c.focus();
        return;
      }
      if (j.need_postcode) { $("qPostRow").hidden = false; err("qErr", j.error || ""); var p = $("qPost"); if (p) p.focus(); return; }
      err("qErr", j.error || WORDS.blip);
      if (j.field) { var f = $(({ name: "qName", mobile: "qMobile", venue: "qVenue", postcode: "qPost" })[j.field] || "qVenue"); if (f) f.focus(); }
      try { if (S.ts && S.tsId != null) S.ts.reset(S.tsId); } catch (e) {}
    }, function () { busy(btn, false, "Text me my code"); err("qErr", WORDS.blip); });
  }

  /* ---- step 2: the code ---- */
  function boxes() { var a = []; for (var i = 1; i <= 6; i++) a.push($("qc" + i)); return a; }
  function clearCode() { boxes().forEach(function (b) { b.value = ""; }); err("qCerr", ""); }
  function code() { return boxes().map(function (b) { return String(b.value || "").replace(/\D/g, "").slice(0, 1); }).join(""); }
  function spread(from, digits) {
    var bs = boxes(), i = from;
    for (var k = 0; k < digits.length && i < 6; k++, i++) bs[i].value = digits[k];
    var next = bs[Math.min(i, 5)]; if (next) next.focus();
    if (code().length === 6) check();
  }
  function wireBoxes() {
    var bs = boxes();
    bs.forEach(function (b, i) {
      b.addEventListener("input", function () {
        var dg = String(b.value || "").replace(/\D/g, "");
        if (dg.length > 1) { b.value = ""; spread(i, dg); return; }   // autofill or a paste: the whole code
        b.value = dg; if (dg && i < 5) bs[i + 1].focus();
        if (code().length === 6) check();
      });
      b.addEventListener("keydown", function (e) { if (e.key === "Backspace" && !b.value && i > 0) { bs[i - 1].focus(); bs[i - 1].value = ""; e.preventDefault(); } });
      b.addEventListener("paste", function (e) {
        var t = ((e.clipboardData || root.clipboardData) || { getData: function () { return ""; } }).getData("text");
        var dg = String(t || "").replace(/\D/g, ""); if (dg) { e.preventDefault(); spread(i, dg); }
      });
    });
  }
  function check(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return;
    var c = code();
    if (c.length !== 6) { err("qCerr", WORDS.six); return; }
    err("qCerr", "");
    var btn = $("qCheck"); busy(btn, true, "Checking...");
    post("/start/verify", { start_id: S.id, code: c }).then(function (j) {
      busy(btn, false, "Start my game");
      if (j.ok && j.outcome === "made") return made(j);
      if (j.ok) { var h = $("qHeldWords"); if (h) h.textContent = j.message || h.textContent; show("qHeld"); return; }
      if (j.gone || j._status === 400) { clearCode(); var f = $("qc1"); if (f) f.focus(); }
      err("qCerr", j.error || WORDS.blip);
    }, function () { busy(btn, false, "Start my game"); err("qCerr", WORDS.blip); });
  }
  function resend() {
    if (!S.id || S.resending || (S.resentAt && Date.now() - S.resentAt < 20000)) return;
    S.resending = true; S.resentAt = Date.now();
    post("/start/resend", { start_id: S.id }).then(function () { S.resending = false; clearCode(); err("qCerr", WORDS.resent); }, function () { S.resending = false; S.resentAt = 0; err("qCerr", WORDS.blip); });
  }

  /* ---- the account is made: sign in by the one-tap link, and land on the demo (the 30 minute hand-off VPTrySlot reads) ---- */
  function made(j) {
    Q.track("account_made");
    show("qMade");
    var path = "/app/try.html?quick=1";
    try { root.localStorage.setItem("vpTryNext", JSON.stringify({ path: path, at: Date.now() })); } catch (e) {}
    root.setTimeout(function () { root.location.href = j.go_url || path; }, 250);
  }

  function mount() {
    Q.countTaps(); Q.leave(); Q.track("page_opened");
    $("qForm").addEventListener("submit", begin);
    $("qCode").addEventListener("submit", check);
    wireBoxes();
    $("qResend").addEventListener("click", resend);
    $("qChange").addEventListener("click", function () { S.id = null; show("qForm"); $("qVenue").focus(); });
    ["qName", "qMobile", "qVenue"].forEach(function (id) { $(id).addEventListener("input", function () { if (!S.started) { S.started = true; Q.track("form_started"); } }); });
    $("qVenue").addEventListener("input", function () { root.clearTimeout(S.timer); S.timer = root.setTimeout(search, 220); });
    doc.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".row")) hidePick(); });
    turnstile();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount); else mount();
})(this);
