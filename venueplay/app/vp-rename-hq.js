/* HQ: RENAME VENUE (Jobs sheet "HQ Rename venue button", Dean 9 Nov 2026 after the Lunatic Hotel).

   On a venue's Details, an HQ Owner can change the venue's DISPLAY NAME: the name its TV, phones,
   consoles, paper cards, account page and emails show. The TV address and the join code are never
   touched, so every TV, QR code, printed card and saved link keeps working.

   One tap on "Rename venue", the name typed into the box (the current name filled in), a confirm that
   names the old and the new name, then POST /admin/venue-rename. The Worker checks the owner role
   again, refuses a name another venue already has until it is confirmed here, and audits the old and
   the new name. NOTHING HERE RUNS BY ITSELF: Cancel at any step sends nothing.

   hq.html calls VPRename.init() with its own workerPost, vpAsk, vpAskText, vpTell and owner test, so
   this file has no login of its own. tools/test-venue-rename.js runs it with a fake page and Worker. */
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

  var api = { init: init, button: button, rename: rename, clean: clean, confirmText: confirmText };
  root.VPRename = api;
})(typeof window !== "undefined" ? window : this);
