/* vp-known.js -- A KNOWN PHONE: NEVER ASKED THE SAME DETAILS TWICE AT A VENUE (Dean, 14 Nov 2026, INBOX 416; Sunday 22 Nov).

   "If they have already given us their details via trivia they do not get asked the same details over a raffle or
   anything else." ONE copy for the three player phones (bingo /play, musical bingo, trivia).

   THE KEY. The first time a phone gives a first name and a mobile at a venue, the game Worker answers /join (or the
   bingo phone's /capture) with known_key, a random 256-bit key. This file keeps it in localStorage ("vpKnownKeys", eight
   at most, newest first) and sends the keys with every later join. The Worker keeps only a hash of each key, against
   ONE venue, so a key never opens another venue's details. Nothing else about the person is kept on the phone.

   THE JOIN SCREEN. Beside /join/info (cached per code, so it cannot know this phone) the page asks POST /join/known
   with the keys, through VPKnown.withInfo(p, api, code). The answer:
     known    null, or { hello, need, ix }: a FIRST NAME for the hello and the NAMES of the fields still to ask (a field
              the venue added since), never a value we hold. Dean: never sound creepy, no "is this still alan@...?",
              no masked mobile; a first-name hello at most.
     consent  { mode:"single" } (today's one tick) or { mode:"three", parties } (/app/vp-consent.js renderThree).
     organiser  the name in the join line: "Your details go to {organiser} to run tonight's game and contact winners."
   VPKnown.paint(o) then draws the screen: for a known phone, the heading says "Welcome back, Alan" with a "Not me" link,
   the name box is filled and hidden on the bingo and musical phones (the name IS the first name), and only the missing
   boxes are drawn. "Not me" forgets that key on this phone and draws the full form again.

   Asked for at most ASK_MS: a slow answer never holds the join screen, it is simply the full form.
   Everything a person reads is set with textContent. No em dashes. */
(function (root) {
  "use strict";
  var LS = "vpKnownKeys", MAX = 8, ASK_MS = 1500;
  var FIELDS = ["first_name", "last_name", "email", "mobile", "postcode"];
  var LINE_HEAD = "Your details go to ", LINE_TAIL = " to run tonight's game and contact winners. ";
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
  function line(name) {
    var n = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
    return LINE_HEAD + (n || "the venue you are playing at") + LINE_TAIL;
  }

  /* o = { box, collect, info (known_info), kind:"person"|"team", venueName, nameIn, head, after(h) }
     Draws the boxes and the consent into o.box and calls o.after(h) (h: the boxes' html, "" when none), so the page adds
     its own notice under them. Answers h. */
  var _last = null, _known = null;
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
    if (known && hello) {
      if (!team && nameIn && known.need.indexOf("first_name") < 0) { nameIn.value = hello.slice(0, 20); fld.style.display = "none"; }
      if (o.head) o.head.textContent = "Welcome back, " + hello;
      var g = d.createElement("p");
      g.id = "vpKnownHi"; g.className = "vp-notice";
      g.setAttribute("style", "margin:6px 0 0;font-size:15px;line-height:1.45;color:#9A9AA4");
      if (!o.head) { g.appendChild(d.createTextNode("Welcome back, " + hello + ". ")); }
      var nm = d.createElement("button");
      nm.type = "button"; nm.id = "vpKnownNotMe";
      nm.setAttribute("style", "background:none;border:0;padding:0;font:inherit;color:#fff;text-decoration:underline;cursor:pointer");
      nm.textContent = "Not me";
      nm.addEventListener("click", function () {
        forget(known.ix);
        if (nameIn) { nameIn.value = ""; }
        var o2 = {}; for (var k in _last) o2[k] = _last[k];
        o2.info = info ? { known: null, consent: info.consent, organiser: info.organiser } : null;
        if (o2.info && info.consent && info.consent.mode === "three") o2.info.consent = { mode: "three", version: info.consent.version, parties: info.consent.all || info.consent.parties };
        if (o.head && o.headWords) o.head.textContent = o.headWords;
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
    if (typeof o.after === "function") { try { o.after(h, info); } catch (e) {} }
    return h;
  }
  /* The join body's extras: the keys, the three boxes' answers, and for a known team phone, no team name as a first
     name (the Worker fills the real one from the venue's row). */
  function capture(cap, kind) {
    cap = cap || {}; kind = kind || (_last && _last.kind);
    var VC = root.VPConsent, a = (VC && typeof VC.answers === "function") ? VC.answers() : null;
    if (a) cap.consent = a;
    if (_known && kind === "team" && _known.need && _known.need.indexOf("first_name") < 0 && !(root.document && root.document.getElementById("xFirst"))) delete cap.first_name;
    return cap;
  }
  function isKnown() { return !!_known; }

  root.VPKnown = { keys: keys, keep: keep, forget: forget, addTo: addTo, ask: ask, withInfo: withInfo, paint: paint, capture: capture,
                   boxesFor: boxesFor, line: line, isKnown: isKnown, LS: LS, ASK_MS: ASK_MS };
})(typeof window !== "undefined" ? window : this);
