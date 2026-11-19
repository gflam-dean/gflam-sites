/* HQ: RENAME VENUE (Jobs sheet "HQ Rename venue button", Dean 9 Nov 2026 after the Lunatic Hotel).

   On a venue's Details, an HQ Owner can change the venue's DISPLAY NAME: the name its TV, phones,
   consoles, paper cards, account page and emails show. The TV address and the join code are never
   touched, so every TV, QR code, printed card and saved link keeps working.

   One tap on "Rename venue", the name typed into the box (the current name filled in), a confirm that
   names the old and the new name, then POST /admin/venue-rename. The Worker checks the owner role
   again, refuses a name another venue already has until it is confirmed here, and audits the old and
   the new name. NOTHING HERE RUNS BY ITSELF: Cancel at any step sends nothing.

   hq.html calls VPRename.init() with its own workerPost, vpAsk, vpAskText, vpTell and owner test, so
   this file has no login of its own. tools/test-venue-rename.js runs it with a fake page and Worker.
   Move TV address (below, open question 32) is tools/test-venue-address.js. */
(function (root) {
  "use strict";
  var H = { post: null, ask: null, askText: null, tell: null, isOwner: function () { return false; } };
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function init(h) {
    H.post = h.post; H.ask = h.ask; H.askText = h.askText; H.tell = h.tell;
    if (h.isOwner) H.isOwner = h.isOwner;
    return api;
  }

  /* The same clean-up the Worker does (vpaCleanVenueName), so the confirm shows the name that will be saved. */
  function clean(raw) { return String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }

  /* Owner only: everyone else sees no button at all. */
  function button(v) {
    if (!v || !v.id || !H.isOwner()) return "";
    return '<button class="mini" data-rename="' + esc(v.id) + '">Rename venue</button>';
  }

  function confirmText(from, to) {
    return "Rename “" + from + "” to “" + to + "”?\n\n" +
      "The new name shows on its TV, phones, console, paper cards, account page and emails straight away. " +
      "The TV address and join code stay the same, so nothing needs setting up again.";
  }

  function sameText(to, same) {
    var names = same.map(function (o) { return o.name + (o.slug ? " (" + o.slug + ")" : ""); }).join(", ");
    return "Another venue is already called “" + to + "”: " + names + ".\n\nUse this name anyway?";
  }

  /* v: the HQ venue row ({id, name}). Resolves to the Worker's answer when renamed, else null. */
  function rename(v) {
    if (!v || !v.id) return Promise.resolve(null);
    if (!H.isOwner()) { H.tell("Only an HQ Owner can rename a venue."); return Promise.resolve(null); }
    var from = String(v.name || "");
    return H.askText("New name for " + (from || "this venue"), from).then(function (typed) {
      if (typed == null) return null;
      var to = clean(typed);
      if (!to) { H.tell("Type the new venue name."); return null; }
      if (to === from) { H.tell("That is already its name."); return null; }
      if (to.length > 120) { H.tell("That name is too long (120 characters at most)."); return null; }
      return H.ask(confirmText(from, to)).then(function (ok) {
        if (!ok) return null;
        var send = function (confirmSame) {
          var body = { venue_id: v.id, name: to };
          if (confirmSame) body.confirm_same_name = true;
          return H.post("/admin/venue-rename", body).then(function (r) {
            r = r || {};
            if (r.needs_confirm && !confirmSame) {
              return H.ask(sameText(to, r.same_name || [])).then(function (yes) { return yes ? send(true) : null; });
            }
            if (r.error || !r.ok) { H.tell("That did not save: " + (r.error || "no answer from the server.") + " The name is unchanged."); return null; }
            v.name = r.name;
            return r;
          });
        };
        return send(false);
      });
    });
  }

  /* ---- MOVE TV ADDRESS (Dean's open question 32, "yes, step 2"; migration 212) ----
     The Lunatic Hotel fix. The TV address (venueplay.com.au/tv?venue=<slug>) follows the new name, and the OLD
     address keeps working for ever: printed table talkers, TV bookmarks and the TV apps still open this venue, and
     the join code never changes. Owner only. Offered straight after a rename, and on its own button in Details.
     POST /admin/venue-address {venue_id, preview:true} answers the current address, the old ones and the address
     the name gives; {venue_id, slug} moves it. Cancel or No at any step sends nothing. */
  var SITE = "venueplay.com.au/tv?venue=";
  function addressButton(v) {
    if (!H.isOwner() || !v || !v.id) return "";
    return '<button class="mini" data-moveaddr="' + esc(v.id) + '">Move TV address</button>';
  }
  function cleanSlug(raw) {
    return String(raw == null ? "" : raw).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function moveText(from, to) {
    return "Move the TV address?\n\nNow: " + SITE + from + "\nNew: " + SITE + to + "\n\n" +
      "The old address keeps working: printed QR codes, bookmarks and the TV app still open this venue. " +
      "The join code stays the same. Any TV showing the venue reloads itself onto the new address.";
  }
  /* v: the HQ venue row. offered: true when asked straight after a rename (then a name that already matches says
     nothing). Resolves to the Worker's answer when moved, else null. */
  function moveAddress(v, offered) {
    if (!v || !v.id) return Promise.resolve(null);
    if (!H.isOwner()) { if (!offered) H.tell("Only an HQ Owner can move a TV address."); return Promise.resolve(null); }
    return H.post("/admin/venue-address", { venue_id: v.id, preview: true }).then(function (p) {
      p = p || {};
      if (p.error || !p.ok) { H.tell("Could not read the TV address: " + (p.error || "no answer from the server.")); return null; }
      if (offered && p.matches_name) return null;
      var first = offered
        ? H.ask("The TV address is still " + SITE + p.slug + ".\n\nMove it to " + SITE + p.proposed + " to match the new name? The old address keeps working.")
        : Promise.resolve(true);
      return first.then(function (go) {
        if (!go) return null;
        return H.askText("New TV address for " + (v.name || "this venue") + " (letters, numbers and hyphens)", p.proposed || p.slug).then(function (typed) {
          if (typed === null || typed === undefined) return null;
          var to = cleanSlug(typed);
          if (!to) { H.tell("Type the new TV address."); return null; }
          if (to === p.slug) { H.tell("That is already its TV address."); return null; }
          return H.ask(moveText(p.slug, to)).then(function (ok) {
            if (ok !== true) return null;
            return H.post("/admin/venue-address", { venue_id: v.id, slug: to }).then(function (r) {
              r = r || {};
              if (r.error || !r.ok) { H.tell("The TV address did not move: " + (r.error || "no answer from the server.") + " Nothing changed."); return null; }
              v.slug = r.to; delete ADDR[v.id];
              H.tell("Moved. The TV address is now " + SITE + r.to + ". " + SITE + r.from + " still opens this venue.");
              return r;
            });
          });
        });
      });
    });
  }
  /* Details shows the old addresses that still forward here: hq.html leaves <span data-oldaddr="VENUE ID"> beside the
     screen address and calls fillAddresses(id) after every draw. Any HQ role. Kept 20 seconds. */
  var ADDR = {};
  function addressSlot(v) { return (v && v.id) ? '<span class="oldaddr" data-oldaddr="' + esc(v.id) + '"></span>' : ""; }
  function drawAddresses(vid, p) {
    var el = root.document && root.document.querySelector('[data-oldaddr="' + String(vid).replace(/"/g, "") + '"]');
    if (!el) return;
    var olds = (p && p.old_addresses) || [];
    el.innerHTML = olds.length
      ? ' &middot; <b>Old addresses</b> (still open this venue) ' + olds.map(function (a) { return SITE + esc(a.slug); }).join(", ")
      : "";
  }
  function fillAddresses(vid) {
    if (!vid || !H.post) return;
    var c = ADDR[vid];
    if (c && Date.now() - c.at < 20000) { drawAddresses(vid, c.p); return; }
    H.post("/admin/venue-address", { venue_id: vid, preview: true }).then(function (p) {
      if (p && p.ok) { ADDR[vid] = { at: Date.now(), p: p }; drawAddresses(vid, p); }
    });
  }

  var api = { init: init, button: button, rename: rename, clean: clean, confirmText: confirmText,
              addressButton: addressButton, moveAddress: moveAddress, moveText: moveText, cleanSlug: cleanSlug,
              addressSlot: addressSlot, fillAddresses: fillAddresses };
  root.VPRename = api;
})(typeof window !== "undefined" ? window : this);
