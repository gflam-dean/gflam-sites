/* "YOUR DETAILS": ONE TICK, "Send me offers from {venue}. I'm 18 or over." (Dean, 4 Nov 2026, for the
   Friday 6 Nov release).

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
  var VERSION = "vpc-2-6nov";
  var OPTIN_HEAD = "Send me offers from ";
  var OPTIN_TAIL = ". I'm 18 or over.";
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
    _optEl = null;
    if (!box || !offered(collect)) return;
    var o = tick("xOptin", optinText(opts && opts.venueName));
    _optEl = o.querySelector("input");
    box.appendChild(o);
  }

  /* Was consent given (offers from this venue, and 18 or over)? From the one tick ONLY, and only with
     a way to reach them. */
  function optedIn(cap) {
    var o = _optEl;
    return !!(onPage(o) && o.checked === true && cap && (cap.email || cap.mobile));
  }

  /* Kept so a page cached from before 6 Nov, paired with this file, still works: there is no 18+ gate
     on this step any more, so nobody is ever held at Join by it. */
  function ageOk() { return true; }
  function age18Done() {}

  root.VPConsent = { render: render, optedIn: optedIn, offered: offered, optinText: optinText,
                     VERSION: VERSION, OPTIN_HEAD: OPTIN_HEAD, OPTIN_TAIL: OPTIN_TAIL, NO_NAME: NO_NAME,
                     ageOk: ageOk, age18Done: age18Done, AGE_NEEDED: "" };
})(typeof window !== "undefined" ? window : this);
