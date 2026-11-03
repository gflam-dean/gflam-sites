/* "YOUR DETAILS": TWO SEPARATE TICKS (3 Nov 2026, for the 4 Nov release).

   The three player phones (bingo /play, musical bingo and trivia) used to end the details step with
   ONE tick: "I am 18 or over. Keep me posted on what is on at the venue". That bundled a condition of
   entry with marketing consent, and marketing consent must be optional and must not be bundled with
   anything else (Spam Act 2003, Australian Privacy Principle 7). Found in the new-look review,
   ~/venue-enrich/reports/new-look-games-3nov/NOTES.md ("Your details: two separate ticks").

   Now, wherever the details step offers the opt-in, it shows two ticks, built here ONCE for all three
   phones:

     #x18     "I'm 18 or over"                             REQUIRED to join from this step. A gate on
                                                           this phone only: nothing new is stored, the
                                                           Worker is not asked to accept anything.
     #xOptin  "Keep me posted on what's on at the venue"   OPTIONAL, never ticked by default or by a
                                                           script. marketing_optin is set from this
                                                           tick ONLY, and only with an email or mobile.

   No double ask. Where the bingo phone's own age screen (play.html requireAge18, the state rule) has
   already been ticked for this room tonight, the 18+ tick is left out, and if that screen is ticked
   after the details step is on screen, VPConsent.age18Done() takes the 18+ tick down.

   The details step is shown only when the venue collects the opt-in AND an email or mobile box (a
   tick to be kept posted with no way to reach you is pointless; the bingo phone already worked this
   way, the other two now match). No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  var AGE_TEXT = "I'm 18 or over";
  var OPTIN_TEXT = "Keep me posted on what's on at the venue";
  var AGE_NEEDED = "Tick I'm 18 or over to join.";
  var _ageDone = false;
  /* The ticks this module drew, held here rather than looked up by id: a page (or a test's stand-in
     DOM) that answers any id with an element must not turn "no 18+ tick on this step" into "18+ not
     ticked". A tick taken off the page (the details box redrawn) no longer counts. */
  var _ageEl = null, _optEl = null;
  function onPage(e) { return !!e && e.isConnected !== false; }

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

  /* Does this venue's details step offer the opt-in? Then it shows both ticks. */
  function offered(collect) {
    return !!(collect && collect.marketing_optin && (collect.email || collect.mobile));
  }

  /* Append the ticks to the details box. opts.age18 is true when this phone's own age screen has
     already been ticked for this room tonight (bingo only). */
  function render(box, collect, opts) {
    _ageEl = null; _optEl = null;
    if (!box || !offered(collect)) return;
    if (opts && opts.age18) _ageDone = true;
    if (!_ageDone) {
      var a = tick("x18", AGE_TEXT);
      _ageEl = a.querySelector("input");
      a.className = "optin age18";
      a.querySelector("input").required = true;
      a.querySelector("input").addEventListener("change", function () {
        var e = document.getElementById("joinErr");
        if (this.checked && e && e.textContent === AGE_NEEDED) e.textContent = "";
      });
      box.appendChild(a);
    }
    var o = tick("xOptin", OPTIN_TEXT);
    _optEl = o.querySelector("input");
    box.appendChild(o);
  }

  /* The age screen was ticked: the 18+ tick on the details step comes down (never asked twice). */
  function age18Done() {
    _ageDone = true;
    var l = _ageEl && _ageEl.parentNode;
    if (l && l.parentNode) l.parentNode.removeChild(l);
    _ageEl = null;
  }

  /* May this player continue from the details step? Only with the 18+ tick, where it is shown. */
  function ageOk() {
    if (_ageDone) return true;
    return !onPage(_ageEl) || _ageEl.checked === true;
  }

  /* Was marketing consent given? From the opt-in tick ONLY, and only with a way to reach them. */
  function optedIn(cap) {
    var o = _optEl;
    return !!(onPage(o) && o.checked === true && cap && (cap.email || cap.mobile));
  }

  root.VPConsent = { render: render, age18Done: age18Done, ageOk: ageOk, optedIn: optedIn,
                     offered: offered, AGE_TEXT: AGE_TEXT, OPTIN_TEXT: OPTIN_TEXT, AGE_NEEDED: AGE_NEEDED };
})(typeof window !== "undefined" ? window : this);
