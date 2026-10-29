/* vp-permits.js -- PERMITS AND AUTHORITIES, PAINTED AND SAVED IN ONE PLACE.

   A venue records any permit, licence or authority it holds for a kind of game: bingo on the
   Game settings page (app/settings.html), raffles and members draws under Your account > Draws
   (app/billing.html). Both pages call VPPermits.paint() below, so the cards, the words, the
   holder choice, what counts as recorded and the save are one piece of code (24 Oct 2026: they
   were two copies, and the Draws permits had drifted from the settings page's).

   Anisimoff Legal 9380, 1 Oct 2026, point 5: keeping a record of the permits, licences and
   authorities a venue holds, so a manual check is possible, is prudent. 8 Oct 2026, point 1(a):
   in Victoria we may not supply bingo tickets or a number generator to anyone without a minor
   gaming permit, so a Victorian venue recording its permit here is what lets us supply bingo at
   all. Point 7 of the NSW letter: a pub running a paid raffle for a charity does so under the
   charity's authority, so the second form of record is "a charity holds it, we run it for them".

   MUSICAL BINGO IS NOT BINGO. It is a free game, needs no permit, and nothing here names it: the
   bingo card is for number bingo only.

   The fields are those of vp_venues.permits (migration 100):
     number, holder (venue | npo), npo_name, authorised_on, expires, note
   A kind is RECORDED when it has a number, or a charity or non-profit is named with the date it
   authorised the venue. VPGaming.permitRecorded (vp-gaming.js) is that rule; the billing Worker
   applies the same one on save (/account/permits) and answers with it. Owner, or a manager with
   the draws right; the Worker enforces that.

   WHY A VENUE WOULD RECORD IT, BY STATE. One line each, from the lawyers' threshold tables
   (Anisimoff Legal 9380: NSW table, 1 Oct 2026; QLD, VIC, ACT and TAS tables, 8 Oct 2026). The
   regulator's name comes from VPGaming.states when that script is loaded, so the two cannot
   disagree about who to ring. WA, SA and NT have no letter yet, so they get the generic line.

     VPPermits.paint({ wrap, venue, kinds, worker, venueId, onSaved })
       wrap     the element the cards go in (emptied first)
       venue    the vp_venues row: au_state, permits, entity_type, number_bingo_on
       kinds    which of "bingo", "raffle", "members" to paint, in order
       worker   the billing Worker's base URL
       venueId  the venue the save is for
       onSaved  optional, called (kind, permits, recorded) after a save lands

   No bingo card for a venue that cannot run number bingo (an SA or NT pub, migration 116): the
   console does not show the game, so asking for a bingo permit would only confuse them. */
(function (root) {
  "use strict";

  var KINDS = { bingo: "Bingo", raffle: "Raffles", members: "Members draws" };
  var ORDER = ["bingo", "raffle", "members"];
  var SAVE_AS = { bingo: "bingo", raffle: "raffle", members: "members draw" };

  var WHY = {
    NSW: { bingo: "In New South Wales, paid housie is for registered clubs (club bingo: no cash prizes, $70 a game) or is run to raise money for a charity (charity housie). Record the club's or the charity's authority here. Social housie needs nothing, and cannot be run at a pub.",
           raffle: "In New South Wales, a pub may run a paid raffle for a charity under the charity's authority from {reg}, with the charity's written authorisation. Record the charity and the date it authorised you. A club's promotional raffle (up to $5,000, no cash prizes) needs no authority.",
           members: "In New South Wales, a free-entry members draw is a free lottery or a trade promotion. A trade promotion with over $10,000 in prizes needs an authority from {reg}. Record it here." },
    QLD: { bingo: "In Queensland, only an association may conduct bingo, and only a bingo centre needs a licence. Record the association and its category (category 1 up to $2,000 in ticket sales, category 2 up to $20,000) so it is on file.",
           raffle: "In Queensland, category 1 and 2 raffles (up to $50,000 in ticket sales) need no licence but must be run by an eligible association; category 3 (over $50,000) needs a licence from {reg}. Record the association or the licence.",
           members: "In Queensland, a free-entry members draw is a category 4 promotional game, which any business may run with no licence. Nothing to record unless you hold one." },
    VIC: { bingo: "In Victoria, paid bingo is for non-profits declared by {reg} that have notified it. Record your minor gaming permit or VGCCC declaration here: Victorian law bans supplying bingo tickets or a number generator to anyone without one, so we need to know you hold it.",
           raffle: "In Victoria, raffles are for non-profits; a prize pool over $23,060 needs a permit from {reg}. A for-profit venue needs the non-profit's written permission and a commercial organiser's licence. Record whichever applies.",
           members: "In Victoria, a free-entry members draw is a trade promotion and needs no permit. A draw run for a non-profit runs under that non-profit's permit; record it here." },
    ACT: { bingo: "In ACT, housie with a prize pool over $1,000 a session needs a permit from {reg}, and no minors may play. Record the permit here.",
           raffle: "In ACT, a raffle with a prize pool over $2,500 needs a permit from {reg}. Record it here.",
           members: "In ACT, a free trade promotion with prizes up to $3,000 is exempt. Above that, or a raffle over $2,500, needs a permit from {reg}. Record it here." },
    TAS: { bingo: "In Tasmania, bingo is run for non-profits and needs a minor gaming permit from {reg} unless it is social bingo (one fee a session, entry $30 or less, no prize over $300). Record the permit, and the non-profit it is for.",
           raffle: "In Tasmania, a raffle with a prize pool over $10,000 needs a minor gaming permit from {reg}; up to $10,000 needs none when the proceeds go to a non-profit. Record the permit or the non-profit.",
           members: "In Tasmania, a members draw is treated like a raffle: over $10,000 in prizes needs a minor gaming permit from {reg}. Record it, or the non-profit the draw is for." }
  };
  var WHY_GENERIC = "Record any permit, licence or authority {reg} has issued your venue for this game, so it is on file if anyone asks.";

  function regulatorFor(state) {
    var st = (root.VPGaming && VPGaming.states && VPGaming.states[state]) || null;
    return (st && st.regulator) ? st.regulator : "your state regulator";
  }
  function whyLine(state, kind) {
    var t = (WHY[state] || {})[kind] || WHY_GENERIC;
    return t.replace("{reg}", regulatorFor(state));
  }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  /* true, false, or null when vp-gaming.js is not on the page (the Worker answers on save). */
  function isRecorded(permits, kind) {
    if (root.VPGaming && typeof VPGaming.permitRecorded === "function") return VPGaming.permitRecorded({ permits: permits }, kind);
    return null;
  }
  function statusText(recorded) {
    if (recorded === true) return '<span class="vpp-status on">Recorded</span>';
    if (recorded === false) return '<span class="vpp-status">Not recorded</span>';
    return '';
  }
  /* WHICH STATES NEED A PERMIT, LICENCE OR AUTHORITY FOR A VENUE TO RUN EACH KIND (Dean, 24 Oct 2026:
     "only show a permit card where the state actually needs one"). ONE table, read by Game settings,
     Your account > Draws and HQ's venue view. Sourced from the WHY lines above and the lawyers' letters
     (Anisimoff Legal 9380: NSW 1 Oct 2026; QLD, VIC, ACT, TAS 8 Oct 2026):
       true           a permit, licence or authority is needed to run it (charged for) at all
       "conditional"  needed only above a threshold (a prize pool, a category, a kind of premises);
                      the card stays, and its WHY line says where the threshold is
       false          the state needs nothing for it: no card (unless one was saved, see notNeeded)
       "unclear"      no letter covers this state yet: the card stays until Dean decides
     NSW bingo: club bingo and charity housie need no authority (1 Oct letter), and a pub cannot run paid
     bingo at all. NSW raffle: a pub runs a paid raffle only under a charity's written authority. NSW
     members draw: a trade promotion needs an authority above $10,000 in prizes. QLD bingo: only a bingo
     centre needs a licence. QLD raffle: category 3 (over $50,000) needs a licence. QLD members draw: a
     category 4 promotional game, no licence. VIC bingo: a minor gaming permit, always. VIC raffle: a permit
     above $23,060. VIC members draw: a trade promotion, no permit. ACT: housie above $1,000 a session, a
     raffle above $2,500, a trade promotion above $3,000. TAS: bingo unless social, a raffle or members
     draw above $10,000. WA, SA, NT: no letter yet. */
  var NEEDS = {
    NSW: { bingo: false,         raffle: true,          members: "conditional" },
    QLD: { bingo: "conditional", raffle: "conditional", members: false },
    VIC: { bingo: true,          raffle: "conditional", members: false },
    ACT: { bingo: "conditional", raffle: "conditional", members: "conditional" },
    TAS: { bingo: "conditional", raffle: "conditional", members: "conditional" },
    WA:  { bingo: "unclear",     raffle: "unclear",     members: "unclear" },
    SA:  { bingo: "unclear",     raffle: "unclear",     members: "unclear" },
    NT:  { bingo: "unclear",     raffle: "unclear",     members: "unclear" }
  };
  /* A venue with no state recorded yet is asked about everything: "we do not know" is not "none needed". */
  function needs(state, kind) {
    var row = NEEDS[String(state || "").toUpperCase()];
    if (!row || !(kind in row)) return "unclear";
    return row[kind];
  }
  function bingoHidden(venue) {
    return !!(root.VPGaming && VPGaming.numberBingoHidden && VPGaming.numberBingoHidden(venue));
  }
  function hasSaved(venue, kind) {
    var p = venue && venue.permits;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { p = null; } }
    return !!(p && typeof p === "object" && p[kind] && typeof p[kind] === "object");
  }
  /* Why a kind needs no permit at this venue, or "" when it does (or might). */
  function notNeeded(venue, kind) {
    if (kind === "bingo" && bingoHidden(venue)) return "hidden";
    return needs(venue && venue.au_state, kind) === false ? "state" : "";
  }
  /* The kinds to show a card for: those the venue's state needs (or might), and ANY kind with a permit
     already saved, so saved data is never silently hidden: that card carries the clear note instead. */
  function kindsFor(venue, kinds) {
    return (kinds || ORDER).filter(function (k) { return KINDS[k] && (!notNeeded(venue, k) || hasSaved(venue, k)); });
  }
  var NOT_NEEDED = { state: "Your state does not need a permit for this. You can clear it.",
                     hidden: "Number bingo is not run at this venue, so no permit is needed. You can clear it." };

  /* ONE LOOK ON EVERY PAGE. The sizes are the Game settings page's own (.card, .lbl, .sublbl,
     .seg .opt, its inputs), written here so Your account paints the same card without carrying a
     copy of that stylesheet. The two option buttons share their width AND their height, so a
     longer label never makes one button taller than the other (Dean, 24 Oct 2026). */
  var CSS = ".vpp-card{background:var(--ink-2);border:1px solid var(--line-2);border-radius:16px;padding:20px;margin:0 0 16px}" +
    ".vpp-lbl{font-family:'Hanken Grotesk',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.14em;font-size:10.5px;color:var(--faint);margin:0 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
    ".vpp-status{font-size:10.5px;letter-spacing:.14em;color:var(--faint)}.vpp-status.on{color:var(--win)}" +
    ".vpp-sub{font-size:12px;color:var(--muted);margin:0 0 16px;line-height:1.5}" +
    ".vpp-seg{display:flex;gap:8px;margin:0 0 12px;align-items:stretch}" +
    ".vpp-seg .vpp-opt{flex:1 1 0;min-width:0;padding:11px 8px;border:1px solid var(--line);background:var(--ink-3);color:var(--muted);border-radius:10px;" +
    "font-family:'Hanken Grotesk',sans-serif;font-weight:700;font-size:12.5px;line-height:1.3;cursor:pointer;text-align:center;transition:.15s;display:flex;align-items:center;justify-content:center}" +
    ".vpp-seg .vpp-opt.on{background:var(--pink);color:#fff;border-color:transparent}" +
    ".vpp-field{margin:0 0 10px;min-width:0}.vpp-field label{display:block;font-size:12px;color:var(--muted);margin:0 0 4px}" +
    ".vpp-field input{width:100%;box-sizing:border-box;background:var(--ink-3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font-family:inherit;font-size:14px;margin:0}" +
    ".vpp-two{display:flex;gap:10px;flex-wrap:wrap}.vpp-two .vpp-field{flex:1 1 140px}" +
    /* iOS Safari keeps a date input at its natural width, off the card's edge at 390px, until its appearance
       is switched off (Dean, 29 Oct 2026). */
    ".vpp-field input[type=date]{-webkit-appearance:none;appearance:none;min-width:0;max-width:100%;min-height:42px;color-scheme:dark}" +
    ".vpp-field input[type=date]::-webkit-date-and-time-value{text-align:left}" +
    ".vpp-save{border:none;border-radius:12px;padding:11px 16px;font-family:'Hanken Grotesk',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:.15s;" +
    "background:var(--pink);color:#fff;box-shadow:0 8px 20px rgba(255,31,142,.3);text-transform:uppercase;letter-spacing:.04em}" +
    ".vpp-save:hover{background:var(--pink-deep)}.vpp-save:disabled{opacity:.5;cursor:not-allowed}" +
    ".vpp-notneeded{font-size:12px;color:var(--gold);margin:0 0 12px;line-height:1.5}" +
    ".vpp-clear{margin-left:10px;background:none;border:1px solid var(--line);color:var(--text);border-radius:12px;padding:10px 14px;font-family:'Hanken Grotesk',sans-serif;font-weight:700;font-size:13px;cursor:pointer}" +
    ".vpp-msg{min-height:20px;font-size:12.5px;margin:10px 0 0}.vpp-msg.ok{color:var(--win)}.vpp-msg.err{color:var(--roll)}" +
    "@media(max-width:640px){.vpp-seg .vpp-opt{min-height:44px}.vpp-save{min-height:44px}}";
  function style() {
    var d = root.document;
    if (!d || d.getElementById("vp-permits-css")) return;
    var s = d.createElement("style"); s.id = "vp-permits-css"; s.textContent = CSS;
    (d.head || d.documentElement).appendChild(s);
  }

  function field(cls, label, type, value, extra) {
    return '<div class="vpp-field' + (extra && extra.wrapCls ? ' ' + extra.wrapCls : '') + '"' + (extra && extra.hidden ? ' style="display:none"' : '') + '>' +
      '<label>' + esc(label) + '</label>' +
      '<input type="' + type + '" class="' + cls + '"' + (extra && extra.max ? ' maxlength="' + extra.max + '"' : '') +
      ' value="' + esc(value || "") + '"' + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '></div>';
  }
  function cardHTML(kind, p, state, recorded, why) {
    var npo = p.holder === "npo";
    return '<div class="card vpp-card permit" data-kind="' + kind + '"' + (why ? ' data-notneeded="' + why + '"' : '') + '>' +
      '<div class="lbl vpp-lbl">' + esc(KINDS[kind]) + '<span class="pstatus">' + statusText(recorded) + '</span></div>' +
      '<div class="sublbl vpp-sub">' + esc(whyLine(state, kind)) + '</div>' +
      (why ? '<div class="vpp-notneeded pnotneeded">' + esc(NOT_NEEDED[why]) + '</div>' : '') +
      '<div class="vpp-seg pholder">' +
        '<div class="vpp-opt opt' + (npo ? '' : ' on') + '" data-holder="venue">Our venue holds it</div>' +
        '<div class="vpp-opt opt' + (npo ? ' on' : '') + '" data-holder="npo">A charity holds it, we run it for them</div>' +
      '</div>' +
      field("pnumber", "Permit, licence or authority number", "text", p.number, { max: 80, ph: "As printed on the permit" }) +
      field("pnpo_name", "Charity or non-profit name", "text", p.npo_name, { max: 120, ph: "The organisation whose authority you run under", wrapCls: "pnpo", hidden: !npo }) +
      '<div class="vpp-two">' +
        field("pauthorised", "Authorised on", "date", p.authorised_on) +
        field("pexpires", "Expires (if it does)", "date", p.expires) +
      '</div>' +
      field("pnote", "Note", "text", p.note, { max: 500, ph: "Anything worth knowing, e.g. conditions on the permit" }) +
      '<button type="button" class="vpp-save psave">Save ' + esc(SAVE_AS[kind]) + ' permit</button>' +
      (why ? '<button type="button" class="vpp-clear pclear">Clear it</button>' : '') +
      '<div class="vpp-msg pmsg"></div>' +
    '</div>';
  }

  function permitFrom(card) {
    var holderEl = card.querySelector(".pholder .opt.on");
    return {
      number: card.querySelector(".pnumber").value.trim(),
      holder: holderEl ? holderEl.getAttribute("data-holder") : "venue",
      npo_name: card.querySelector(".pnpo_name").value.trim(),
      authorised_on: card.querySelector(".pauthorised").value || "",
      expires: card.querySelector(".pexpires").value || null,
      note: card.querySelector(".pnote").value.trim()
    };
  }

  function savePermit(o, card, btn) {
    var kind = card.getAttribute("data-kind"), msg = card.querySelector(".pmsg");
    msg.className = "vpp-msg pmsg"; msg.textContent = "";
    btn.disabled = true;
    root.VP.getClient().auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || null;
      /* X-VP-Venue names the venue. For HQ "View as" it is the whole answer; for a manager or
         owner the Worker only honours a venue they actually hold. */
      return fetch(o.worker + "/account/permits", { method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok, "X-VP-Venue": o.venueId },
        body: JSON.stringify({ venue_id: o.venueId, kind: kind, permit: permitFrom(card) }) })
        .then(function (res) { if (res.status === 404) return { error: "The billing service cannot record permits yet. Try again later." }; return res.json(); });
    }).then(function (j) {
      btn.disabled = false;
      if (!j || j.error) { msg.className = "vpp-msg pmsg err"; msg.textContent = (j && j.error) || "Could not save."; return; }
      o.permits = (j.permits && typeof j.permits === "object") ? j.permits : o.permits;
      var rec = j.recorded || {};
      var st = card.querySelector(".pstatus");
      if (st) st.innerHTML = statusText(!!rec[kind]);
      msg.className = "vpp-msg pmsg ok";
      msg.textContent = rec[kind] ? "Saved. This counts as recorded." : (o.permits[kind] ? "Saved, but it does not count as recorded yet: it needs a number, or a charity named with the date it authorised you." : "Cleared.");
      if (typeof o.onSaved === "function") { try { o.onSaved(kind, o.permits, rec); } catch (e) {} }
    }).catch(function () {
      btn.disabled = false; msg.className = "vpp-msg pmsg err"; msg.textContent = "Could not reach the billing service. Check your connection and try again.";
    });
  }

  function paint(o) {
    var wrap = o && o.wrap; if (!wrap) return [];
    style();
    var v = o.venue || {};
    o.permits = (v.permits && typeof v.permits === "object" && !Array.isArray(v.permits)) ? v.permits : {};
    var state = v.au_state || "";
    var kinds = kindsFor(v, o.kinds);
    wrap.innerHTML = kinds.map(function (kind) {
      return cardHTML(kind, o.permits[kind] || {}, state, isRecorded(o.permits, kind), notNeeded(v, kind));
    }).join("");
    wrap.querySelectorAll(".pholder").forEach(function (seg) {
      seg.addEventListener("click", function (e) {
        var opt = e.target.closest(".opt"); if (!opt) return;
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle("on", c === opt); });
        var card = seg.closest(".permit");
        card.querySelector(".pnpo").style.display = (opt.getAttribute("data-holder") === "npo") ? "" : "none";
      });
    });
    wrap.querySelectorAll(".psave").forEach(function (btn) {
      btn.addEventListener("click", function () { savePermit(o, btn.closest(".permit"), btn); });
    });
    /* Clear it: an all-empty permit is what the Worker treats as "clear this kind" (vpaCleanPermit). */
    wrap.querySelectorAll(".pclear").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest(".permit");
        ["pnumber", "pnpo_name", "pauthorised", "pexpires", "pnote"].forEach(function (c) { card.querySelector("." + c).value = ""; });
        var v0 = card.querySelector('.pholder [data-holder="venue"]'); if (v0) v0.click();
        savePermit(o, card, btn);
      });
    });
    return kinds;
  }

  root.VPPermits = { KINDS: KINDS, ORDER: ORDER, WHY: WHY, NEEDS: NEEDS, needs: needs, notNeeded: notNeeded, hasSaved: hasSaved, whyLine: whyLine, kindsFor: kindsFor,
                     statusText: statusText, permitFrom: permitFrom, paint: paint };
})(window);
