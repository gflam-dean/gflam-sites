/* vp-known.js -- A KNOWN PHONE: NEVER ASKED THE SAME DETAILS TWICE AT A VENUE (Dean, 14 Nov 2026, INBOX 416; Sunday 22 Nov).

   "If they have already given us their details via trivia they do not get asked the same details over a raffle or
   anything else." ONE copy for the three player phones (bingo /play, musical bingo, trivia).

   THE KEY. The first time a phone gives a first name and a mobile at a venue, the game Worker answers /join (or the
   bingo phone's /capture) with known_key, a random 256-bit key. This file keeps it in localStorage ("vpKnownKeys", eight
   at most, newest first) and sends the keys with every later join. The Worker keeps only a hash of each key, against
   venueplay's row: each venue it is used at receives ONLY the fields that venue asks (the Worker decides, server side). Nothing else about the person is kept on the phone.

   THE JOIN SCREEN. Beside /join/info (cached per code, so it cannot know this phone) the page asks POST /join/known
   with the keys, through VPKnown.withInfo(p, api, code). The answer:
     known    null, or { hello, need, ix }: a FIRST NAME for the hello and the NAMES of the fields still to ask (a field
              the venue added since), never a value we hold. Dean: never sound creepy, no "is this still alan@...?",
              no masked mobile; a first-name hello at most.
     consent  { mode:"single" } (today's one tick) or { mode:"three", parties } (/app/vp-consent.js renderThree).
     organiser  the name in the join line: "Your details go to {organiser} to run tonight's game and contact winners."
   VPKnown.paint(o) then draws the screen: for a known phone, the venue's normal join screen with only the missing boxes,
   the ticks and Join, and a small "Not my details" link (Dean 16 Nov 2026: no name, nothing we hold); the name box is
   filled and hidden on the bingo and musical phones. "Not my details" forgets that key on this phone and draws the normal
   empty form again.
   The first-game notice (info.notice) is drawn once per player, as the Worker says.
   ONE NUMBER PER PLAYER (Dean 17 Nov 2026, replacing the typed-in second number): with known.mobile_masked the line is "Playing
   as Sarah, 04.. ... 123" with "Not my number" (only when known.change_number) and "Not me". "Not my number" asks the
   new number, the Worker texts a code to it (POST /join/number/start), the player types it back (/join/number/verify)
   and the new number replaces the old one at every venue. A number is never typed into a join any more.

   Asked for at most ASK_MS: a slow answer never holds the join screen, it is simply the full form.
   Everything a person reads is set with textContent. No em dashes. */
(function (root) {
  "use strict";
  var LS = "vpKnownKeys", MAX = 8, ASK_MS = 1500;
  var FIELDS = ["first_name", "last_name", "email", "mobile", "postcode"];
  function okKey(k) { return typeof k === "string" && /^[0-9a-f]{64}$/.test(k); }
  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function keys() {
    var s = store(); if (!s) return [];
    try { var a = JSON.parse(s.getItem(LS) || "[]"); return Array.isArray(a) ? a.filter(okKey).slice(0, MAX) : []; } catch (e) { return []; }
  }
  function save(a) { var s = store(); if (!s) return; try { s.setItem(LS, JSON.stringify(a.slice(0, MAX))); } catch (e) {} }
  /* The key a join handed back, kept newest first. Anything else is ignored. */
  function keep(reply) {
    var k = reply && reply.known_key;
    if (!okKey(k)) return false;
    var a = keys().filter(function (x) { return x !== k; });
    a.unshift(k); save(a); return true;
  }
  function forget(ix) { var a = keys(); if (ix >= 0 && ix < a.length) { a.splice(ix, 1); save(a); } }
  /* The keys go on every join body, read at send time (a key kept after the first send is on the next one). */
  function addTo(body) { if (body) { var k = keys(); if (k.length) body.known_keys = k; } return body; }

  var _api = "", _code = "";
  function ask(api, code) {
    var f = root.fetch;
    _api = String(api || ""); _code = String(code || "");
    if (typeof f !== "function" || !code) return Promise.resolve(null);
    var asked = f(api + "/join/known", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code, keys: keys() }) })
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { return (j && typeof j === "object" && !j.error) ? j : null; })
      .catch(function () { return null; });
    var late = new Promise(function (ok) { (root.setTimeout || function (fn) { fn(); })(function () { ok(null); }, ASK_MS); });
    return Promise.race([asked, late]);
  }
  /* /join/info's answer with this phone's /join/known answer on it as known_info. A failed or slow known ask is null. */
  function withInfo(p, api, code) {
    var k = ask(api, code);
    return Promise.resolve(p).then(function (r) {
      return k.then(function (kn) { if (r && typeof r === "object") r.known_info = kn; return r; });
    });
  }
  /* The fields to draw: what the venue asks, less what a known phone already gave. */
  function boxesFor(collect, known) {
    var c = {}, k;
    for (k in (collect || {})) c[k] = collect[k];
    if (known && Array.isArray(known.need)) FIELDS.forEach(function (f) { c[f] = !!(collect && collect[f]) && known.need.indexOf(f) >= 0; });
    return c;
  }

  /* The masked number for "Playing as": the Worker's mobile_masked, or the masked mobile of a one-tap row (an older
     Worker). Only the masked form ("04.. ... 123") ever reaches the phone. */
  function playingMask(known) {
    if (!known) return "";
    if (typeof known.mobile_masked === "string" && known.mobile_masked) return known.mobile_masked;
    var c = Array.isArray(known.confirm) ? known.confirm.filter(function (x) { return x && x.field === "mobile" && x.masked; })[0] : null;
    return c ? String(c.masked) : "";
  }
  function post(path, body) {
    var f = root.fetch;
    if (typeof f !== "function" || !_api) return Promise.resolve({ status: 0, j: null });
    return f(_api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
      .catch(function () { return { status: 0, j: null }; });
  }
  /* "NOT MY NUMBER" (Dean 17 Nov 2026): the new number, a code texted to it, the code typed back. The line turns into
     a small form in place (no new screen, no scroll); Cancel puts the line back. On the right code the number on the
     line is the new one, everywhere. Every word set with textContent. */
  function numberPanel(g, known) {
    var d = root.document;
    var BTN = "flex:0 0 auto;min-height:40px;padding:0 12px;border-radius:10px;font:700 15px/1.2 Manrope,system-ui,sans-serif;cursor:pointer;background:#FF1F8E;color:#0A0A0B;border:1.5px solid #FF1F8E";
    var IN = "flex:1 1 auto;min-width:0;min-height:40px;padding:0 10px;border-radius:10px;border:1.5px solid #2A2A31;background:#17171A;color:#fff;font:16px/1.2 Manrope,system-ui,sans-serif";
    var LINK = "flex:0 0 auto;background:none;border:0;padding:12px 0;margin:-12px 0;font:inherit;font-size:15px;color:#C9C9D1;text-decoration:underline;cursor:pointer";
    var changeId = "", newNum = "", errTimer = 0;
    while (g.firstChild || (g.children && g.children.length)) g.removeChild(g.firstChild || g.children[0]);
    /* 320 x 568 fit (Dean 18 Nov 2026): the form is THREE short things, not five. Top line: the prompt, "Send again" and
       "Cancel" side by side (they used to be their own line under the form). Under it the number box and its button. A
       problem ("That code is not right", "Please wait") takes the place of the top line for a few seconds, so it never
       adds a line; typing clears it. Every state keeps the Join button in view. */
    g.style.marginTop = "6px"; g.style.fontSize = "15px";
    /* the bingo host-wait note is not needed while the form is open: out of the way here, back when the line is repainted */
    var hn = d.getElementById("joinHostNote"); if (hn) hn.style.display = "none";
    var top = d.createElement("div"); top.setAttribute("style", "display:flex;flex-wrap:wrap;align-items:center;gap:0 8px");
    var say = d.createElement("span"); say.id = "vpNumSay"; say.setAttribute("style", "flex:1 1 auto;min-width:0;color:#E7E7EC");
    var row = d.createElement("div"); row.setAttribute("style", "display:flex;gap:8px;margin-top:6px");
    var inp = d.createElement("input"); inp.id = "vpNumIn"; inp.setAttribute("style", IN);
    var go = d.createElement("button"); go.type = "button"; go.id = "vpNumGo"; go.setAttribute("style", BTN);
    var err = d.createElement("span"); err.id = "vpNumErr"; err.setAttribute("role", "alert"); err.setAttribute("style", "display:none;color:#FF8FA3");
    var again = d.createElement("button"); again.type = "button"; again.id = "vpNumAgain"; again.setAttribute("style", LINK); again.textContent = "Resend";
    var cancel = d.createElement("button"); cancel.type = "button"; cancel.id = "vpNumCancel"; cancel.setAttribute("style", LINK); cancel.textContent = "Cancel";
    row.appendChild(inp); row.appendChild(go);
    top.appendChild(say); top.appendChild(err); top.appendChild(cancel);
    g.appendChild(top); g.appendChild(row);
    cancel.addEventListener("click", function () { if (_last) paint(_last); });
    /* the one line for a problem or a note: it hides the prompt and the two links until it is cleared */
    function setErr(t) {
      try { if (errTimer) root.clearTimeout(errTimer); } catch (e) {}
      errTimer = 0;
      err.textContent = t || "";
      var on = !!t;
      err.style.display = on ? "block" : "none";
      say.style.display = on ? "none" : "";
      cancel.style.display = on ? "none" : "";
      again.style.display = on ? "none" : "";
      if (on && typeof root.setTimeout === "function") errTimer = root.setTimeout(function () { setErr(""); }, 4500);
    }
    inp.addEventListener("input", function () { if (err.textContent) setErr(""); });
    function stepNumber() {
      say.textContent = "Your new mobile";
      if (again.parentNode === top) top.removeChild(again);
      inp.value = ""; inp.setAttribute("type", "tel"); inp.setAttribute("inputmode", "tel"); inp.setAttribute("autocomplete", "tel"); inp.setAttribute("maxlength", "16");
      inp.setAttribute("aria-label", "Your new mobile"); inp.setAttribute("placeholder", "04xx xxx xxx");
      go.textContent = "Text me a code";
      try { inp.focus(); } catch (e) {}
    }
    var waitUntil = 0;
    function stepCode(masked, wait) {
      say.textContent = "Sent to " + masked;
      inp.value = ""; inp.setAttribute("type", "text"); inp.setAttribute("inputmode", "numeric"); inp.setAttribute("autocomplete", "one-time-code"); inp.setAttribute("maxlength", "6");
      inp.setAttribute("aria-label", "The code in the text"); inp.setAttribute("placeholder", "6 numbers");
      go.textContent = "Confirm";
      if (again.parentNode !== top) top.insertBefore(again, cancel);
      waitUntil = Date.now() + (wait > 0 ? wait : 30) * 1000;
      try { inp.focus(); } catch (e) {}
    }
    function busy(on) { go.disabled = !!on; if (on) go.setAttribute("aria-busy", "true"); else go.removeAttribute && go.removeAttribute("aria-busy"); }
    function send(isAgain) {
      if (isAgain && Date.now() < waitUntil) { setErr("Please wait " + Math.ceil((waitUntil - Date.now()) / 1000) + " seconds, then try again."); return; }
      setErr(""); busy(true);
      var body = { code: _code, keys: keys(), mobile: newNum };
      if (isAgain && changeId) body.change_id = changeId;
      post("/join/number/start", body).then(function (r) {
        busy(false);
        if (r.j && r.j.ok && r.j.change_id) { changeId = String(r.j.change_id); stepCode(String(r.j.to || ""), +r.j.resend_in || 30); if (isAgain) setErr("New code sent."); return; }
        if (isAgain && r.status === 410) { changeId = ""; stepNumber(); }
        setErr((r.j && typeof r.j.error === "string") ? r.j.error : "We could not send a text just now. Please try again.");
      });
    }
    go.addEventListener("click", function () {
      if (go.disabled) return;
      if (!changeId) {
        newNum = String(inp.value || "").replace(/[^0-9+]/g, "");
        if (!/^(\+?61|0)?4[0-9]{8}$/.test(newNum)) { setErr("Please check the mobile number."); return; }
        send(false); return;
      }
      var code = String(inp.value || "").replace(/[^0-9]/g, "");
      if (code.length !== 6) { setErr("The code is the six numbers in the text."); return; }
      setErr(""); busy(true);
      post("/join/number/verify", { code: _code, keys: keys(), change_id: changeId, sms_code: code }).then(function (r) {
        busy(false);
        if (r.j && r.j.ok && r.j.masked) {
          known.mobile_masked = String(r.j.masked);
          if (Array.isArray(known.confirm)) known.confirm.forEach(function (x) { if (x && x.field === "mobile") x.masked = known.mobile_masked; });
          if (_last) paint(_last);
          var pa = root.document.getElementById("vpPlayingAs");
          if (pa) pa.textContent = pa.textContent + ". Done.";
          return;
        }
        if (r.status === 410 && !(r.j && r.j.expired)) { changeId = ""; stepNumber(); }
        setErr((r.j && typeof r.j.error === "string") ? r.j.error : "We could not check the code just now. Please try again.");
      });
    });
    again.addEventListener("click", function () { send(true); });
    stepNumber();
  }

  /* o = { box, collect, info (known_info), kind:"person"|"team", venueName, nameIn, head, after(h) }
     Draws the boxes and the consent into o.box and calls o.after(h) (h: the boxes' html, "" when none), so the page adds
     its own notice under them. Answers h. */
  var _last = null, _known = null, _notice = null, _use = {};
  function paint(o) {
    _last = o; o = o || {};
    var d = root.document, info = o.info || null, known = info && info.known && typeof info.known === "object" ? info.known : null;
    _known = known;
    var team = o.kind === "team", c = boxesFor(o.collect, known);
    var nameIn = o.nameIn || (d && d.getElementById("nameIn"));
    var fld = nameIn ? (nameIn.closest && nameIn.closest(".field")) || nameIn : null;
    var hello = known ? String(known.hello || "").trim() : "";
    var hostNote = d && d.getElementById("joinHostNote"); if (hostNote) hostNote.style.display = "";   // back after a number change is closed or done
    var greet = d && d.getElementById("vpKnownHi");
    if (greet && greet.parentNode) greet.parentNode.removeChild(greet);
    if (fld) fld.style.display = "";
    if (known) {
      /* The venue's normal join screen with only a field still to ask, the ticks and Join. The name box is filled (the TV
         shows the name) and out of the way on the bingo and musical phones.
         ONE NUMBER PER PLAYER (Dean 17 Nov 2026): when the Worker sends the masked number, one line "Playing as Sarah,
         04.. ... 123" with a small "Not my number" (only when the Worker says change_number: texts can be sent) and
         "Not me". Without a number (an older Worker), the 16 Nov line: one small "Not my details", no name. */
      if (!team && nameIn && known.need.indexOf("first_name") < 0 && hello) { nameIn.value = hello.slice(0, 20); fld.style.display = "none"; }
      var mm = playingMask(known);
      var g = d.createElement("p");
      g.id = "vpKnownHi"; g.className = "vp-notice";
      g.setAttribute("style", "margin:10px 0 0;font-size:14px;line-height:1.45;color:#9A9AA4;text-align:left");
      var LINK = "background:none;border:0;padding:6px 0;margin:-6px 0;font:inherit;color:#C9C9D1;text-decoration:underline;cursor:pointer";
      if (mm) {
        var pa = d.createElement("span"); pa.id = "vpPlayingAs";
        pa.setAttribute("style", "color:#E7E7EC");
        pa.textContent = "Playing as " + (hello ? hello.slice(0, 20) + ", " : "") + mm;
        g.appendChild(pa);
        g.appendChild(d.createElement("br"));
        if (known.change_number === true) {
          var nn = d.createElement("button"); nn.type = "button"; nn.id = "vpKnownNotNum"; nn.setAttribute("style", LINK);
          nn.textContent = "Not my number";
          nn.addEventListener("click", function () { numberPanel(g, known); });
          g.appendChild(nn);
          g.appendChild(d.createTextNode("   "));
        }
      }
      var nm = d.createElement("button");
      nm.type = "button"; nm.id = "vpKnownNotMe";
      nm.setAttribute("style", mm ? LINK : "background:none;border:0;padding:0;font:inherit;color:#C9C9D1;text-decoration:underline;cursor:pointer");
      nm.textContent = mm ? "Not me" : "Not my details";
      nm.addEventListener("click", function () {
        forget(known.ix);
        if (nameIn) { nameIn.value = ""; }
        var o2 = {}; for (var k in _last) o2[k] = _last[k];
        /* the normal empty form: every box, every consent box fresh (unticked unless the Worker says ticked), as a new
           player sees it; the notice too when the Worker sent one */
        o2.info = info ? { known: null, consent: info.consent, organiser: info.organiser, notice: info.notice } : null;
        if (o2.info && info.consent && info.consent.mode === "three") o2.info.consent = { mode: "three", version: info.consent.version, ticked: info.consent.ticked === true,
          parties: (info.consent.parties || []).map(function (p) { return { party: p.party, name: p.name }; }) };
        paint(o2);
        try { if (nameIn && !team) nameIn.focus(); } catch (e) {}
      });
      g.appendChild(nm);
      var at = (o.box && o.box.parentNode === (fld && fld.parentNode)) ? o.box : null;
      if (at) at.parentNode.insertBefore(g, at); else if (o.box) o.box.parentNode.insertBefore(g, o.box);
    }
    var VD = root.VPDetails, VC = root.VPConsent;
    var h = (VD && typeof VD.html === "function") ? VD.html(c, { firstBox: team }) : "";
    _use = {};
    var confirm = (known && Array.isArray(known.confirm)) ? known.confirm.filter(function (x) { return x && (x.field === "mobile" || x.field === "email") && x.masked; }) : [];
    /* the mobile is never a row of its own now: it is the "Playing as" line, and the number on it is the one used
       (the Worker still passes it to a venue that did not have it only with that venue's offers box ticked) */
    if (confirm.some(function (x) { return x.field === "mobile"; }) && playingMask(known)) _use.mobile = true;
    confirm = confirm.filter(function (x) { return x.field !== "mobile"; });
    if (o.box) {
      o.box.innerHTML = h;
      /* AN EMAIL WE HOLD, NOT YET THIS VENUE'S (Dean 16 Nov 2026): one row, masked by the Worker, and one tap.
         "Use this" passes it to this venue (only with its offers box ticked, the Worker checks); "Different email" turns
         the row into the normal empty box. No tap: nothing is passed. (The mobile is the "Playing as" line, above.) */
      var vname = String((info && info.organiser) || o.venueName || "this venue");
      confirm.forEach(function (x) {
        var row = d.createElement("div");
        row.className = "vpk-use"; row.id = "vpkUse_" + x.field;
        row.setAttribute("style", "margin-top:10px;padding:8px 10px;border:1px solid #2A2A31;border-radius:12px;text-align:left");
        var t = d.createElement("div");
        t.setAttribute("style", "font-size:15px;line-height:1.35;color:#E7E7EC");
        t.textContent = (x.field === "mobile" ? "Mobile" : "Email") + " for " + vname + ": " + String(x.masked);
        row.appendChild(t);
        var bs = d.createElement("div"); bs.setAttribute("style", "display:flex;gap:8px;margin-top:6px");
        var BTN = "flex:1 1 0;min-height:38px;border-radius:10px;font:700 15px/1.2 Manrope,system-ui,sans-serif;cursor:pointer;";
        var yes = d.createElement("button"); yes.type = "button"; yes.id = "vpkUseYes_" + x.field; yes.textContent = "Use this";
        yes.setAttribute("aria-pressed", "false");
        yes.setAttribute("style", BTN + "background:#17171A;color:#fff;border:1.5px solid #FF1F8E");
        var no = d.createElement("button"); no.type = "button"; no.id = "vpkUseNo_" + x.field; no.textContent = "Different email";
        no.setAttribute("style", BTN + "background:#17171A;color:#C9C9D1;border:1.5px solid #2A2A31");
        yes.addEventListener("click", function () {
          _use[x.field] = true; yes.setAttribute("aria-pressed", "true");
          yes.setAttribute("style", BTN + "background:#FF1F8E;color:#0A0A0B;border:1.5px solid #FF1F8E");
        });
        no.addEventListener("click", function () {
          delete _use[x.field];
          var c1 = {}; c1[x.field] = true;
          var holder = d.createElement("div");
          holder.innerHTML = VD && typeof VD.html === "function" ? VD.html(c1, {}) : "";
          var box1 = holder.firstElementChild || holder.firstChild || (holder.children && holder.children[0]);
          if (box1 && row.parentNode) row.parentNode.replaceChild(box1, row); else if (row.parentNode) row.parentNode.removeChild(row);
          try { var inp = d.getElementById(x.field === "mobile" ? "xMobile" : "xEmail"); if (inp) inp.focus(); } catch (e) {}
        });
        bs.appendChild(yes); bs.appendChild(no); row.appendChild(bs);
        o.box.appendChild(row);
      });
      if (VC && typeof VC.render === "function") VC.render(o.box, o.collect, { venueName: o.venueName, consent: info && info.consent && info.consent.mode === "three" ? info.consent : null, known: !!known && !confirm.length && !_use.mobile });
    }
    /* a venue asking for (nearly) everything plus the three boxes: the tighter join step (vp-phone.css, .vp-long) */
    var vj = d && d.getElementById("vJoin"), nBoxes = (h.match(/<input/g) || []).length + 2 * confirm.length + (_use.mobile ? 2 : 0);   // a one-tap row is about two boxes tall; the "Playing as" line with its links, where the mobile row was, counts the same
    if (vj && vj.classList) vj.classList.toggle("vp-long", !!(VC && typeof VC.answers === "function" && VC.answers()) && nBoxes >= 3);
    /* THE FIRST-GAME NOTICE (Dean 16 Nov 2026): one line, once per player; the Worker sends it until the phone's row says
       this version was seen, and the join records it (notice_version). Words and link from the Worker's one constant. */
    _notice = null;
    var nt = info && info.notice && typeof info.notice === "object" && (info.notice.text || info.notice.link) ? info.notice : null;
    if (o.box && nt) {
      var np = d.createElement("p");
      np.id = "vpJoinNotice"; np.className = "vp-joinnote";   // its own class: the bingo page makes .collectnote links white
      np.setAttribute("style", "margin:10px 0 0;font-size:13px;line-height:1.4;color:#9A9AA4;text-align:left");
      /* the link sits inside the line (Dean 16 Nov 2026: "venueplay's terms and privacy policy" is the link) */
      var split = typeof nt.before === "string" && typeof nt.after === "string";
      np.appendChild(d.createTextNode(split ? nt.before : String(nt.text) + " "));
      var na = d.createElement("a");
      na.href = /^\/[a-z0-9\/-]*$/.test(String(nt.href || "")) ? String(nt.href) : "/privacy"; na.target = "_blank"; na.rel = "noopener";
      na.setAttribute("style", "color:inherit;font-weight:inherit;text-decoration:none;padding:6px 0;margin:-6px 0");   // Dean 16 Nov: quiet, exactly like the line around it; still a real link
      na.textContent = String(nt.link || "Privacy policy");
      np.appendChild(na);
      if (split) np.appendChild(d.createTextNode(nt.after));
      /* the offers sentence only beside the offers tick (M2, 19 Nov 2026): never a box that is not on the screen */
      if (split && typeof nt.box === "string" && nt.box && VC && typeof VC.tickOn === "function" && VC.tickOn()) np.appendChild(d.createTextNode(nt.box));
      o.box.appendChild(np);
      _notice = String(nt.version || "");
    }
    if (typeof o.after === "function") { try { o.after(h, info); } catch (e) {} }
    return h;
  }
  /* The join body's extras: the keys, the three boxes' answers, and for a known team phone, no team name as a first
     name (the Worker fills the real one from the venue's row). */
  function capture(cap, kind) {
    cap = cap || {}; kind = kind || (_last && _last.kind);
    var VC = root.VPConsent, a = (VC && typeof VC.answers === "function") ? VC.answers() : null;
    if (a) cap.consent = a;
    var uf = Object.keys(_use).filter(function (f) { return _use[f] === true; });
    if (uf.length) cap.use_fields = uf;   // Use this was tapped on these held contact details (the Worker decides with the venue's box)
    /* the venue's own tick with a held detail: the page's optedIn needs a typed contact, so ask the tick itself */
    if (uf.length && !cap.marketing_optin && VC && typeof VC.optedIn === "function" && VC.optedIn({ mobile: "held" })) { cap.marketing_optin = true; cap.consent_version = VC.VERSION; }
    if (_notice) cap.notice_version = _notice;   // the notice this join showed (the Worker records it once)
    if (_known && kind === "team" && _known.need && _known.need.indexOf("first_name") < 0 && !(root.document && root.document.getElementById("xFirst"))) delete cap.first_name;
    return cap;
  }
  function isKnown() { return !!_known; }

  root.VPKnown = { keys: keys, keep: keep, forget: forget, addTo: addTo, ask: ask, withInfo: withInfo, paint: paint, capture: capture,
                   boxesFor: boxesFor, isKnown: isKnown, playingMask: playingMask, LS: LS, ASK_MS: ASK_MS };
})(typeof window !== "undefined" ? window : this);
