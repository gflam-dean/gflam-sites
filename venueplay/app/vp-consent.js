/* "YOUR DETAILS": ONE TICK, "Send me offers from {venue}" (Dean, 14 Nov 2026, INBOX 405 update 3, FINAL: no age words
   on the tick; "we decided that ages ago"). It was "Send me offers from {venue}. I'm 18 or over." from 4 Nov (consent version
   vpc-2-6nov); every sign-up already recorded under vpc-2-6nov, vpc-1 or before keeps its version in vp_captures.consent_version
   and is NOT rewritten: the new words are vpc-3-14nov and only sign-ups from now on carry it (PREVIOUS lists the old ones).
   The text below is the history of the 4 Nov wording, kept as written.
   (Dean, 4 Nov 2026, for the Friday 6 Nov release).

   History. The three player phones (bingo /play, musical bingo and trivia) once ended the details step
   with one tick, "I am 18 or over. Keep me posted on what is on at the venue". On 3 Nov that became two
   ticks ("I'm 18 or over" and "Keep me posted on what's on at the venue"), with 18+ needed only when the
   opt-in was ticked (consent version vpc-1). On 4 Nov Dean dropped the separate 18+ tick and folded it
   into the offers opt-in: one tick, in these words exactly,

     #xOptin  "Send me offers from {venue name}. I'm 18 or over."      consent version vpc-2-6nov

   {venue name} is the venue's display name from /join/info (P.venueName on each phone), or "this venue"
   when there is none.

     - OPTIONAL. Never ticked by default or by a script. Not ticking it changes nothing about playing:
       every game (trivia, musical bingo, bingo) joins exactly as before, with no 18+ question anywhere
       on this step and no separate 18+ screen added. The 18+ words are a condition of the OFFERS only,
       never of entry.
     - Ticking it = opted in to that venue's marketing AND confirmed 18 or over. It is recorded exactly
       as the opt-in was recorded before: marketing_optin true (the Worker stamps marketing_optin_at),
       and only with an email or mobile (consent with no way to reach the person is not kept). The
       capture also carries consent_version so each sign-up can be matched to the words the person saw.
       The Worker keeps only the fields it whitelists (gatedCapture), so until a column exists for it,
       consent_version is matched by marketing_optin_at against the release time instead (anything
       stamped after the 6 Nov release saw vpc-2-6nov).
     - The bingo phone's own age screen (play.html requireAge18) is a state gaming rule, not part of
       this step, and is left exactly as it was.

   The step is shown only when the venue collects the opt-in AND an email or mobile box (an offers tick
   with no way to reach you is pointless). No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  var VERSION = "vpc-3-14nov";
  var PREVIOUS = ["vpc-1", "vpc-2-6nov"];   // the words people agreed to before, kept recorded against their sign-ups
  var OPTIN_HEAD = "Send me offers from ";
  var OPTIN_TAIL = "";
  var NO_NAME = "this venue";
  /* The tick this module drew, held here rather than looked up by id: a page (or a test's stand-in DOM)
     that answers any id with an element must not turn "no tick on this step" into "ticked". A tick
     taken off the page (the details box redrawn) no longer counts. */
  var _optEl = null;
  function onPage(e) { return !!e && e.isConnected !== false; }

  /* The words of the one tick for this venue. A name that already ends in a full stop ("Club Inc.")
     does not get a second one. */
  function optinText(venueName) {
    var n = String(venueName == null ? "" : venueName).replace(/\s+/g, " ").trim().replace(/\.+$/, "");
    return OPTIN_HEAD + (n || NO_NAME) + OPTIN_TAIL;
  }

  function tick(id, text) {
    var l = document.createElement("label");
    l.className = "optin";
    var i = document.createElement("input");
    i.type = "checkbox"; i.id = id;
    var s = document.createElement("span");
    s.textContent = text;
    l.appendChild(i); l.appendChild(document.createTextNode(" ")); l.appendChild(s);
    return l;
  }

  /* Does this venue's details step offer the tick? */
  function offered(collect) {
    return !!(collect && collect.marketing_optin && (collect.email || collect.mobile));
  }

  /* Append the one tick to the details box. opts.venueName names the venue in the words. */
  function render(box, collect, opts) {
    _optEl = null; _three = null;
    if (box && opts && opts.consent && renderThree(box, opts.consent)) return;   // the three boxes replace the one tick
    if (opts && opts.known) return;   // a known phone is not asked the one tick again (it had it the first time)
    if (!box || !offered(collect)) return;
    var o = tick("xOptin", optinText(opts && opts.venueName));
    _optEl = o.querySelector("input");
    box.appendChild(o);
  }

  /* ONE BOX PER SENDER, LIKE MOSHTIX (Dean, 14 Nov 2026, INBOX 416 UPDATES 4 and 7; Sunday 22 Nov). Drawn only when the
     game Worker says so (POST /join/known answers consent.mode "three": ON from 21 Nov 2026, Dean). Then, in place of
     the one tick:

       Yes! Send me news and offers by SMS and email from:
       [ ] venueplay   [ ] {venue}   [ ] {host brand, only when a host who is not the account owner runs the game}
       Each one uses your details under its own privacy policy. Unsubscribe any time.

     UNTICKED until the player ticks a box (ACMA: a pre-ticked box is generally not express consent under the Spam Act;
     open question 26, pre-ticking waits for Dean's lawyer). Pre-ticking is ONE server setting, never the page: a box
     starts ticked only when the Worker sends consent.ticked === true (its CONSENT_PRETICK 'on'), with its own wording
     version. The parties and their names come from the Worker, never from the page. answers() hands back
     { venueplay:bool, venue:bool, host:bool } for the boxes drawn; the Worker keeps each as its own row and the venue's
     box as the venue's own tick. A box for a sender this player already answered shows its CURRENT answer (current:true
     ticked, current:false unticked); a sender it never answered (a new venue, a new host) is a fresh box, unticked
     unless consent.ticked (Dean 16 Nov 2026). */
  var THREE_VERSION = "vpc-5-22nov";          // unticked (this build)
  var THREE_PRETICK_VERSION = "vpc-4-22nov";  // the same words, a new sender pre-ticked: only when the Worker says ticked
  var THREE_HEAD = "Yes! Send me news and offers by SMS and email from:";
  var THREE_NOTE = "Each one uses your details under its own privacy policy. Unsubscribe any time.";
  var _three = null;   // [{ party, el }] while the block is on the page
  function renderThree(box, consent) {
    _three = null;
    if (!box || !consent || consent.mode !== "three" || !consent.parties || !consent.parties.length) return false;
    var wrap = document.createElement("div");
    wrap.className = "vpc3"; wrap.id = "xConsent3";
    var h = document.createElement("p");
    h.className = "vpc3-head"; h.setAttribute("style", "margin:12px 0 0;font-size:15px;line-height:1.35;color:#fff;font-weight:700;text-align:left");
    h.textContent = THREE_HEAD;
    wrap.appendChild(h);
    _three = [];
    /* the boxes side by side, wrapping (one screen, no scroll, with a venue that asks for everything) */
    var row = document.createElement("div");
    row.className = "vpc3-row"; row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:0 18px");
    wrap.appendChild(row);
    for (var i = 0; i < consent.parties.length && i < 3; i++) {
      var pt = consent.parties[i] || {}, party = String(pt.party || "");
      if (party !== "venueplay" && party !== "venue" && party !== "host") continue;
      var nm = String(pt.name == null ? "" : pt.name).replace(/\s+/g, " ").trim() || (party === "venue" ? NO_NAME : party);
      var l = tick("xC_" + party, nm);
      l.setAttribute("style", "margin-top:8px;align-items:center");
      var inp = l.querySelector("input");
      inp.checked = pt.current === true || (pt.current !== false && consent.ticked === true); inp.setAttribute("data-party", party);   // a sender already answered: its current answer; a new sender: unticked unless the Worker's one setting says ticked
      row.appendChild(l);
      _three.push({ party: party, el: inp });
    }
    var n = document.createElement("p");
    n.className = "vpc3-note"; n.setAttribute("style", "margin:8px 0 0;font-size:13px;line-height:1.4;color:#9A9AA4;text-align:left");
    n.textContent = THREE_NOTE;
    wrap.appendChild(n);
    box.appendChild(wrap);
    return true;
  }
  function threeOn() { return !!(_three && _three.length && _three.some(function (t) { return onPage(t.el); })); }
  /* The answers to the boxes on the page, or null when the block is not drawn. */
  function answers() {
    if (!threeOn()) return null;
    var out = {};
    _three.forEach(function (t) { if (onPage(t.el)) out[t.party] = t.el.checked === true; });
    return out;
  }

  /* Was consent given (offers from this venue)? From the one tick, or the venue's box of the three, ONLY, and only
     with a way to reach them. */
  function optedIn(cap) {
    if (threeOn()) {
      var v = _three.filter(function (t) { return t.party === "venue" && onPage(t.el); })[0];
      return !!(v && v.el.checked === true && cap && (cap.email || cap.mobile));
    }
    var o = _optEl;
    return !!(onPage(o) && o.checked === true && cap && (cap.email || cap.mobile));
  }

  /* Is the one offers tick on the screen now? The first-game notice speaks of "the offers box" only then (M2, 19 Nov 2026). */
  function tickOn() { return onPage(_optEl); }

  /* Kept so a page cached from before 6 Nov, paired with this file, still works: there is no 18+ gate
     on this step any more, so nobody is ever held at Join by it. */
  function ageOk() { return true; }
  function age18Done() {}

  root.VPConsent = { render: render, optedIn: optedIn, tickOn: tickOn, offered: offered, optinText: optinText, answers: answers, renderThree: renderThree,
                     THREE_VERSION: THREE_VERSION, THREE_PRETICK_VERSION: THREE_PRETICK_VERSION, THREE_HEAD: THREE_HEAD, THREE_NOTE: THREE_NOTE,
                     VERSION: VERSION, PREVIOUS: PREVIOUS, OPTIN_HEAD: OPTIN_HEAD, OPTIN_TAIL: OPTIN_TAIL, NO_NAME: NO_NAME,
                     ageOk: ageOk, age18Done: age18Done, AGE_NEEDED: "" };
})(typeof window !== "undefined" ? window : this);
