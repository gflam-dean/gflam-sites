/* HQ: REMOVE A LOGIN THAT BELONGS TO NO OTHER VENUE (Dean, 30 Oct 2026).

   Sarah's end-to-end test was held because her email "already has a VenuePlay login" from an earlier
   test, and clearing it meant the Supabase dashboard. HQ now offers it in three places:
     - a venue's Details: "Logins", then Show logins, each with Remove login where it can go
     - Players & data > "Remove a login": find one by its email, see every venue it is staff at
     - straight after a venue is archived: each of its logins that belongs to no other venue

   A PERMANENT DELETE, so: owner only (the billing Worker checks it again), a confirm that names the
   email (or, for a mobile-only login, the last three digits) before anything is sent, and the Worker
   refuses a login that is staff at any other venue or is a VenuePlay staff login. NOTHING HERE EVER
   RUNS BY ITSELF: every removal starts from a tap on a Remove login button or on the archive's own
   question, and Cancel sends nothing. hq.html calls VPLogins.init() with its own workerPost, vpAsk,
   vpTell and owner test, so this file has no login of its own and cannot reach the Worker without one.

   CHANGE MOBILE (INBOX 138, Dean, 8 Nov 2026): on a venue's Details, an Owner can change the mobile a venue
   login signs in with, for a venue that calls us. Typed into the row, checked with the sign-in page's rules,
   asked once (naming the login and every other venue it signs in at), then sent. The Worker refuses a
   number another login has, a venueplay staff login, and anyone but an Owner, and audits it.

   tools/test-remove-login-hq.js and tools/test-change-mobile.js run this file with a fake page and a fake Worker. */
(function (root) {
  "use strict";
  var doc = root.document;
  var H = { post: null, ask: null, tell: null, isOwner: function () { return false; } };
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function init(h) { H.post = h.post; H.ask = h.ask; H.tell = h.tell; if (h.isOwner) H.isOwner = h.isOwner; bindFind(); return api; }

  /* What the confirm names, and what is sent back as the confirm: the email, or "ending 123". */
  function who(l) { return l.email ? l.email : ("the mobile ending " + (l.phone_end || "?")); }
  function confirmValue(l) { return l.email ? String(l.email).toLowerCase() : ("ending " + (l.phone_end || "")); }
  function confirmText(l, venueName) {
    return "Remove the login " + who(l) + "?\n\n" +
      (venueName ? "It is only on " + venueName + ", so " + venueName + " will have no login with it. " : "It is not on any venue. ") +
      "This deletes the login for good. It cannot be undone. Nothing else about the venue changes, and the same email can be set up again later.";
  }

  function rowHtml(l, venueId) {
    var line = '<b>' + esc(who(l)) + '</b>' + (l.role ? ' <span class="note">(' + esc(l.role) + ')</span>' : '');
    var act = (l.can_remove && H.isOwner())
      ? ' <button class="mini roll" data-loginremove="' + esc(l.auth_user_id) + '" data-loginvenue="' + esc(venueId || "") + '">Remove login</button>'
      : (l.why_not ? '<div class="note" style="margin:2px 0 0">' + esc(l.why_not) + '</div>' : '');
    /* Change mobile (INBOX 138): an Owner, from a venue's own Details only (the Worker needs the venue). */
    var mob = (l.can_change_mobile && H.isOwner() && venueId)
      ? ' <button class="mini" data-loginmobile="' + esc(l.auth_user_id) + '" data-loginvenue="' + esc(venueId) + '">Change mobile</button>'
        + '<div class="vpmobform" style="display:none;margin:6px 0 0">'
        + '<input type="tel" inputmode="tel" autocomplete="off" placeholder="0400 000 000" aria-label="New mobile" style="max-width:180px"> '
        + '<button class="mini" data-loginmobilesave="' + esc(l.auth_user_id) + '" data-loginvenue="' + esc(venueId) + '">Save</button> '
        + '<button class="mini" data-loginmobilecancel="1">Cancel</button>'
        + '<div class="note" style="margin:4px 0 0">The old number stops signing in straight away. They sign in with the new one by text code next time.</div></div>'
      : '';
    return '<div class="vplogin" style="margin:6px 0">' + line + (l.email && l.phone_end ? ' <span class="note">mobile ending ' + esc(l.phone_end) + '</span>' : '') + act + mob + '</div>';
  }

  /* ---- a venue's Details ---- */
  var LAST = {};   // auth_user_id -> the login as last shown, so a tap removes exactly what was on screen
  function venueBlock(venueId, venueName) {
    var box = doc.querySelector('[data-vplogins="' + venueId + '"]'); if (!box) return;
    box.innerHTML = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)"><b>Logins</b> '
      + '<button class="mini" data-loginsshow="' + esc(venueId) + '">Show logins</button><div class="vploginlist"></div></div>';
    box.setAttribute("data-vpvenuename", venueName || "");
  }
  function showLogins(venueId) {
    var box = doc.querySelector('[data-vplogins="' + venueId + '"]'); if (!box) return Promise.resolve(null);
    var list = box.querySelector(".vploginlist"); list.innerHTML = '<div class="note">Looking…</div>';
    return H.post("/admin/logins", { venue_id: venueId }).then(function (r) {
      if (!r || r.error) { list.innerHTML = '<div class="note">' + esc((r && r.error) || "Could not load the logins.") + '</div>'; return r; }
      (r.logins || []).forEach(function (l) { LAST[l.auth_user_id] = l; });
      list.innerHTML = (r.logins || []).length ? r.logins.map(function (l) { return rowHtml(l, venueId); }).join("")
        : '<div class="note">This venue has no logins.</div>';
      return r;
    });
  }

  /* ---- the one removal: asked, then sent, never otherwise ---- */
  function remove(l, venueId, venueName) {
    return H.ask(confirmText(l, venueName)).then(function (ok) {
      if (!ok) return { cancelled: true };
      return H.post("/admin/login-remove", { auth_user_id: l.auth_user_id, venue_id: venueId || null, confirm: confirmValue(l) }).then(function (r) {
        if (!r || r.error) { H.tell("Not removed: " + ((r && r.error) || "no answer from the server.")); return r || {}; }
        H.tell("Removed the login " + who(l) + ".");
        return r;
      });
    });
  }

  /* ---- change the mobile a venue login signs in with: typed, asked, then sent, never otherwise ---- */
  /* The sign-in page's rules for an Australian mobile, from the one copy (vp-about-you.js mobileE164). */
  function toE164(raw) { var A = root.VPAboutYou; return (A && typeof A.mobileE164 === "function") ? A.mobileE164(raw) : ""; }
  function showMobile(e164) { var A = root.VPAboutYou; return (A && typeof A.mobileShow === "function") ? A.mobileShow(e164) : String(e164 || ""); }
  function mobileText(l, venueName, e164) {
    var others = (l.venues || []).filter(function (v) { return v && v.name && v.name !== venueName; }).map(function (v) { return v.name; });
    return "Change the mobile " + who(l) + " signs in with to " + showMobile(e164) + "?\n\n" +
      "The old number stops signing in straight away. They sign in with the new one by text code next time." +
      (others.length ? " It is the same login at " + others.slice(0, 3).join(", ") + (others.length > 3 ? " and " + (others.length - 3) + " more" : "") + ", so it changes there too." : "") +
      "\n\nOnly do this for the venue's own request.";
  }
  function changeMobile(l, venueId, venueName, raw) {
    var e164 = toE164(raw);
    if (!e164) { H.tell(String(raw || "").trim() ? "That doesn't look like an Australian mobile. It should start 04." : "Type the new mobile first."); return Promise.resolve({ invalid: true }); }
    return H.ask(mobileText(l, venueName, e164)).then(function (yes) {
      if (!yes) return { cancelled: true };
      return H.post("/admin/login-mobile", { auth_user_id: l.auth_user_id, venue_id: venueId, mobile: e164, confirm: confirmValue(l) }).then(function (r) {
        if (!r || r.error) { H.tell("Not changed: " + ((r && r.error) || "no answer from the server.")); return r || {}; }
        H.tell("Changed. " + (l.email || "That login") + " now signs in with " + showMobile(e164) + ".");
        return r;
      });
    });
  }

  /* ---- after an archive: offer each login that belongs to no other venue, one question each ---- */
  function afterArchive(venueId, venueName) {
    if (!H.isOwner()) return Promise.resolve([]);
    return H.post("/admin/logins", { venue_id: venueId }).then(function (r) {
      var can = ((r && r.logins) || []).filter(function (l) { return l.can_remove; });
      var done = [];
      return can.reduce(function (p, l) {
        return p.then(function () {
          return H.ask(venueName + " is archived. Its login " + who(l) + " belongs to no other venue.\n\nDo you also want to remove that login?").then(function (yes) {
            if (!yes) { done.push({ login: who(l), skipped: true }); return; }
            return remove(l, venueId, venueName).then(function (x) { done.push({ login: who(l), result: x }); });
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    });
  }

  /* ---- Players & data > Remove a login ---- */
  var FOUND = null;
  function find(email) {
    var out = doc.getElementById("rlResults"); if (out) out.innerHTML = '<div class="note">Looking…</div>';
    return H.post("/admin/login-find", { email: email }).then(function (r) {
      FOUND = (r && r.login) || null;
      if (!out) return r;
      if (!r || r.error) { out.innerHTML = '<div class="note">' + esc((r && r.error) || "Could not look that up.") + '</div>'; return r; }
      if (!FOUND) { out.innerHTML = '<div class="note">No venueplay login has that email.</div>'; return r; }
      var vs = FOUND.venues || [];
      out.innerHTML = rowHtml(FOUND, FOUND.venue_id) + '<div class="note" style="margin:2px 0 0">'
        + (vs.length ? 'Staff at: ' + vs.map(function (v) { return esc(v.name) + (v.role ? ' (' + esc(v.role) + ')' : ''); }).join(', ') : 'Not on any venue.')
        + '</div>';
      return r;
    });
  }
  function bindFind() {
    var b = doc.getElementById("rlFind"), q = doc.getElementById("rlQuery");
    if (!b || !q || b.getAttribute("data-bound")) return;
    b.setAttribute("data-bound", "1");
    b.addEventListener("click", function () { var v = String(q.value || "").trim(); if (v) find(v); });
  }

  /* One click handler for every button this file draws, wherever it is. */
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var s = t.closest("button[data-loginsshow]");
    if (s) { showLogins(s.getAttribute("data-loginsshow")); return; }
    var mb = t.closest("button[data-loginmobile]");
    if (mb) { var fm = mb.parentNode && mb.parentNode.querySelector(".vpmobform"); if (fm) fm.style.display = fm.style.display === "none" ? "block" : "none"; return; }
    var mc = t.closest("button[data-loginmobilecancel]");
    if (mc) { var fc = mc.closest(".vpmobform"); if (fc) fc.style.display = "none"; return; }
    var ms = t.closest("button[data-loginmobilesave]");
    if (ms) {
      var mid = ms.getAttribute("data-loginmobilesave"), mvid = ms.getAttribute("data-loginvenue");
      var ml = LAST[mid]; if (!ml || !mvid) return;
      var mform = ms.closest(".vpmobform"), inp = mform && mform.querySelector("input");
      var mholder = ms.closest("[data-vpvenuename]");
      ms.disabled = true;
      changeMobile(ml, mvid, mholder ? mholder.getAttribute("data-vpvenuename") : "", inp ? inp.value : "").then(function (r) {
        ms.disabled = false;
        if (r && r.ok) showLogins(mvid);
      });
      return;
    }
    var rm = t.closest("button[data-loginremove]");
    if (rm) {
      var id = rm.getAttribute("data-loginremove"), vid = rm.getAttribute("data-loginvenue") || null;
      var l = LAST[id] || (FOUND && FOUND.auth_user_id === id ? FOUND : null); if (!l) return;
      var holder = rm.closest("[data-vpvenuename]");
      var vname = holder ? holder.getAttribute("data-vpvenuename") : ((FOUND && FOUND.venues && FOUND.venues[0]) ? FOUND.venues[0].name : "");
      rm.disabled = true;
      remove(l, vid, vid ? vname : "").then(function (r) {
        rm.disabled = false;
        if (r && r.ok) { rm.closest(".vplogin").innerHTML = '<span class="note">Removed ' + esc(who(l)) + '.</span>'; }
      });
    }
  }
  if (doc && doc.addEventListener) doc.addEventListener("click", onClick);

  var api = { init: init, venueBlock: venueBlock, showLogins: showLogins, remove: remove, afterArchive: afterArchive, find: find,
              confirmText: confirmText, confirmValue: confirmValue, changeMobile: changeMobile, mobileText: mobileText, _onClick: onClick };
  root.VPLogins = api;
})(this);
