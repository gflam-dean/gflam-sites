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

  function ask(api, code) {
    var f = root.fetch;
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

  /* o = { box, collect, info (known_info), kind:"person"|"team", venueName, nameIn, head, after(h) }
     Draws the boxes and the consent into o.box and calls o.after(h) (h: the boxes' html, "" when none), so the page adds
     its own notice under them. Answers h. */
  var _last = null, _known = null, _notice = null;
  function paint(o) {
    _last = o; o = o || {};
    var d = root.document, info = o.info || null, known = info && info.known && typeof info.known === "object" ? info.known : null;
    _known = known;
    var team = o.kind === "team", c = boxesFor(o.collect, known);
    var nameIn = o.nameIn || (d && d.getElementById("nameIn"));
    var fld = nameIn ? (nameIn.closest && nameIn.closest(".field")) || nameIn : null;
    var hello = known ? String(known.hello || "").trim() : "";
    var greet = d && d.getElementById("vpKnownHi");
    if (greet && greet.parentNode) greet.parentNode.removeChild(greet);
    if (fld) fld.style.display = "";
    if (known) {
      /* NOT CREEPY (Dean 16 Nov 2026, final): NO name, no hello, nothing we hold. The venue's normal join screen with only a
         field still to ask, the ticks and Join, and one small "Not my details" link that clears it. The name box is filled
         (the TV shows the name) and out of the way on the bingo and musical phones. */
      if (!team && nameIn && known.need.indexOf("first_name") < 0 && hello) { nameIn.value = hello.slice(0, 20); fld.style.display = "none"; }
      var g = d.createElement("p");
      g.id = "vpKnownHi"; g.className = "vp-notice";
      g.setAttribute("style", "margin:10px 0 0;font-size:14px;line-height:1.45;color:#9A9AA4");
      var nm = d.createElement("button");
      nm.type = "button"; nm.id = "vpKnownNotMe";
      nm.setAttribute("style", "background:none;border:0;padding:0;font:inherit;color:#C9C9D1;text-decoration:underline;cursor:pointer");
      nm.textContent = "Not my details";
      nm.addEventListener("click", function () {
        forget(known.ix);
        if (nameIn) { nameIn.value = ""; }
        var o2 = {}; for (var k in _last) o2[k] = _last[k];
        /* the normal empty form: every box, every consent box fresh (pre-ticked), as a new player sees it; the notice
           too when the Worker sent one */
        o2.info = info ? { known: null, consent: info.consent, organiser: info.organiser, notice: info.notice } : null;
        if (o2.info && info.consent && info.consent.mode === "three") o2.info.consent = { mode: "three", version: info.consent.version,
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
    if (o.box) {
      o.box.innerHTML = h;
      if (VC && typeof VC.render === "function") VC.render(o.box, o.collect, { venueName: o.venueName, consent: info && info.consent && info.consent.mode === "three" ? info.consent : null, known: !!known });
    }
    /* a venue asking for (nearly) everything plus the three boxes: the tighter join step (vp-phone.css, .vp-long) */
    var vj = d && d.getElementById("vJoin"), nBoxes = (h.match(/<input/g) || []).length;
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
    if (_notice) cap.notice_version = _notice;   // the notice this join showed (the Worker records it once)
    if (_known && kind === "team" && _known.need && _known.need.indexOf("first_name") < 0 && !(root.document && root.document.getElementById("xFirst"))) delete cap.first_name;
    return cap;
  }
  function isKnown() { return !!_known; }

  root.VPKnown = { keys: keys, keep: keep, forget: forget, addTo: addTo, ask: ask, withInfo: withInfo, paint: paint, capture: capture,
                   boxesFor: boxesFor, isKnown: isKnown, LS: LS, ASK_MS: ASK_MS };
})(typeof window !== "undefined" ? window : this);
